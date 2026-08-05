#!/usr/bin/env bash
#
# Content-identity overwrite guard for the launch-stack publish pipeline: refuses to let a changed
# local artifact replace an already-published versioned key, run BEFORE publish-launchstack.sh's
# `aws s3 sync` ever uploads anything — the producer-side half of write-once; verify-launchstack-
# published.sh proves the same content-identity property post-upload.
#
# Key grammar contract: portal/backend/src/main/kotlin/io/apiable/domain/onboarding/
# OnboardingLaunchStackUrlGenerator.kt::templateHttpsUrl — `<construct>/<version>/template.yaml`
# under the bucket; a code artifact publishes alongside it at the same version segment.
#
# Reads the currently-published store the same way every real consumer does: an anonymous GET against
# the public HTTPS endpoint, never an authenticated S3 API call — the bucket already serves every
# object anonymously, so this needs no IAM grant beyond what publishing already has. The override
# contract (SRC_DIR / TEMPLATE_STORE_HOST / TEMPLATE_STORE_SCHEME) matches verify-launchstack-
# published.sh exactly, so the same local test double stands in for both.
#
# Content identity is decided by sha256 of the downloaded bytes, never by size and never by S3's ETag:
# ETag is only a plain content MD5 for a single-part upload — a future multipart upload (an artifact
# past the CLI's multipart threshold) turns it into a `<hash>-<parts>` composite that isn't comparable
# to a local hash at all. Downloading and hashing avoids that failure mode and matches the fidelity
# check verify-launchstack-published.sh already performs on the other side of the same upload.
#
# Exit 0: every local artifact is either not yet published (a new version) or byte-identical to what's
# already published (no-op). Exit 1: at least one already-published key differs from its local artifact
# — the publish this guards must not proceed for ANY key until the conflicting change ships under a new
# version instead.
set -uo pipefail

cd "$(dirname "$0")"

LAUNCHSTACK_BUCKET="${LAUNCHSTACK_BUCKET:-apiable-launchstack-templates}"
TEMPLATE_STORE_HOST="${TEMPLATE_STORE_HOST:-${LAUNCHSTACK_BUCKET}.s3.amazonaws.com}"
# Overridable only so a local test double (no TLS) can stand in for the real store; the real store is
# always https, so this must never be set in CI or by an operator against the genuine bucket.
TEMPLATE_STORE_SCHEME="${TEMPLATE_STORE_SCHEME:-https}"
SRC_DIR="${SRC_DIR:-dist/launchstack}"

if [[ ! -d "${SRC_DIR}" ]]; then
  echo "no ${SRC_DIR} — run synth-launchstack.sh for each construct first" >&2
  exit 1
fi

# while-read, not mapfile: this script also runs on a macOS operator machine (bash 3.2).
ARTIFACTS=()
while IFS= read -r line; do
  ARTIFACTS+=("${line}")
done < <(find "${SRC_DIR}" -type f \( -name 'template.yaml' -o -name '*.zip' \) | sort)

if [[ ${#ARTIFACTS[@]} -eq 0 ]]; then
  echo "no artifacts under ${SRC_DIR} — nothing to guard" >&2
  exit 0
fi

# sha256sum on the Linux runner, shasum on a macOS operator machine.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

echo "overwrite guard: checking ${#ARTIFACTS[@]} local artifact(s) against ${TEMPLATE_STORE_HOST}"

refused=0
for src in "${ARTIFACTS[@]}"; do
  key="${src#"${SRC_DIR}"/}"
  url="${TEMPLATE_STORE_SCHEME}://${TEMPLATE_STORE_HOST}/${key}"

  # One request serves both the existence check and the content fetch, so there is no window between
  # a separate status probe and a separate body fetch for the store to change underneath the guard.
  published_body="$(mktemp)"
  code=$(curl -sSL -o "${published_body}" -w '%{http_code}' --max-time 20 "${url}")

  case "${code}" in
    404)
      echo "  • ${key} — not yet published (new version, will publish)"
      rm -f "${published_body}"
      continue
      ;;
    200)
      ;;
    *)
      echo "  ✗ ${key} — unexpected status ${code} probing the published store; refusing (cannot verify content identity)" >&2
      refused=$((refused + 1))
      rm -f "${published_body}"
      continue
      ;;
  esac

  published_sha=$(sha256_of "${published_body}")
  local_sha=$(sha256_of "${src}")
  rm -f "${published_body}"

  if [[ "${published_sha}" == "${local_sha}" ]]; then
    echo "  • ${key} — already published, byte-identical (no-op)"
  else
    echo "  ✗ ${key} — already published with DIFFERENT content (published ${published_sha:0:12}…, local ${local_sha:0:12}…) — a published version is write-once; ship this change under a new version instead" >&2
    refused=$((refused + 1))
  fi
done

if [[ "${refused}" -gt 0 ]]; then
  echo "overwrite guard REFUSED: ${refused} key(s) would silently replace already-published content — publish aborted before any upload" >&2
  exit 1
fi

echo "overwrite guard clear: no already-published key would be replaced"
