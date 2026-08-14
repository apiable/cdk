#!/usr/bin/env bash
#
# Content-identity overwrite guard for the launch-stack publish pipeline: decides, per artifact, whether
# publish-launchstack.sh may upload it at all. Run BEFORE any upload — the producer-side half of
# write-once; the bucket policy's conditional-write enforcement (infra) is the store-side half that
# holds even against a caller that skips this script entirely and calls the S3 API directly.
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
# Output contract: all narration goes to stderr. On exit 0, stdout carries exactly the artifacts that
# are new (not yet published) — one relative path per line, the upload list for the caller. An
# already-published, byte-identical artifact is deliberately NOT on that list: re-uploading it would be
# pointless, and once the store enforces conditional writes, attempting it would fail outright (an
# `If-None-Match: *` PutObject only succeeds when the key does not exist yet). Exit 1: at least one
# already-published key differs from its local artifact — the publish this guards must not proceed for
# ANY key until the conflicting change ships under a new version instead.
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

# while-read, not mapfile: this script also runs on a macOS operator machine (bash 3.2). The glob
# (*template.yaml, not an exact 'template.yaml') matches publish-launchstack.sh's own
# --include '*template.yaml' sync pattern, so nothing the sync would upload can fall outside what this
# guard inspects first.
ARTIFACTS=()
while IFS= read -r line; do
  ARTIFACTS+=("${line}")
done < <(find "${SRC_DIR}" -type f \( -name '*template.yaml' -o -name '*.zip' \) | sort)

if [[ ${#ARTIFACTS[@]} -eq 0 ]]; then
  echo "no artifacts under ${SRC_DIR} — nothing to guard" >&2
  exit 0
fi

# sha256sum on the Linux runner, shasum on a macOS operator machine. `return 1` (never `exit`): every
# call site below captures this via command substitution, which runs in a subshell — an `exit` here
# would only kill that subshell and the caller would silently see an empty string, not a failure. Fails
# closed on both "no hashing tool" and "the tool ran but printed nothing": either would otherwise
# resolve to an empty digest, and an empty digest matching another empty digest would wrongly pass a
# genuinely changed artifact as identical.
sha256_of() {
  local digest=""
  if command -v sha256sum >/dev/null 2>&1; then
    digest=$(sha256sum "$1" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    digest=$(shasum -a 256 "$1" | awk '{print $1}')
  else
    echo "launchstack-overwrite-guard.sh: neither sha256sum nor shasum is available — cannot verify content identity" >&2
    return 1
  fi
  if [[ -z "${digest}" ]]; then
    echo "launchstack-overwrite-guard.sh: sha256 of $1 came back empty — refusing to treat that as a match" >&2
    return 1
  fi
  echo "${digest}"
}

echo "overwrite guard: checking ${#ARTIFACTS[@]} local artifact(s) against ${TEMPLATE_STORE_HOST}" >&2

refused=0
new_artifacts=()
saw_present=0
saw_masked=0
for src in "${ARTIFACTS[@]}"; do
  key="${src#"${SRC_DIR}"/}"
  url="${TEMPLATE_STORE_SCHEME}://${TEMPLATE_STORE_HOST}/${key}"

  # One request serves both the existence check and the content fetch, so there is no window between
  # a separate status probe and a separate body fetch for the store to change underneath the guard.
  published_body="$(mktemp)"
  code=$(curl -sSL -o "${published_body}" -w '%{http_code}' --max-time 20 "${url}")

  # Every object here is anonymously readable, so a key that exists answers 200 and S3 masks a missing
  # one as 403 for a caller that cannot list the bucket. 200 and 403 therefore mean present and absent.
  # Any other status is unknown and refuses, so throttling or a server fault is never read as publishable.
  # The all-masked check after the loop covers the case where that reading is not safe.
  case "${code}" in
    404|403)
      [[ "${code}" == "403" ]] && saw_masked=$((saw_masked + 1))
      echo "  • ${key} — not yet published (new version, will publish)" >&2
      new_artifacts+=("${key}")
      rm -f "${published_body}"
      continue
      ;;
    200)
      saw_present=$((saw_present + 1))
      ;;
    *)
      echo "  ✗ ${key} — unexpected status ${code} probing the published store; refusing (cannot verify content identity)" >&2
      refused=$((refused + 1))
      rm -f "${published_body}"
      continue
      ;;
  esac

  if ! published_sha=$(sha256_of "${published_body}") || ! local_sha=$(sha256_of "${src}"); then
    rm -f "${published_body}"
    echo "  ✗ ${key} — could not compute a hash to compare (see above); refusing" >&2
    refused=$((refused + 1))
    continue
  fi
  rm -f "${published_body}"

  if [[ "${published_sha}" == "${local_sha}" ]]; then
    echo "  • ${key} — already published, byte-identical (no-op)" >&2
  else
    echo "  ✗ ${key} — already published with DIFFERENT content (published ${published_sha:0:12}…, local ${local_sha:0:12}…) — a published version is write-once; ship this change under a new version instead" >&2
    refused=$((refused + 1))
  fi
done

if [[ "${refused}" -gt 0 ]]; then
  echo "overwrite guard REFUSED: ${refused} key(s) would silently replace already-published content — publish aborted before any upload" >&2
  exit 1
fi

# Reading 403 as absence is only sound while the store's anonymous read grant is intact. Every way to
# break it — a public-access-block flip, a default-encryption switch to a CMK the anonymous principal
# cannot use, a bucket-policy apply still propagating — masks the WHOLE store, so every key answers 403
# and the content-drift comparison silently never runs. A run that saw a 403 and never once saw a 200 is
# indistinguishable from that, so it refuses rather than reporting a clear it did not earn. A normal run
# synthesizes every construct and most sit at already-published versions, so it always has a 200.
# Bootstrapping a genuinely empty store is the one legitimate all-absent case: set
# LAUNCHSTACK_ALLOW_EMPTY_STORE=1 for it, deliberately.
if [[ "${saw_masked}" -gt 0 && "${saw_present}" -eq 0 && "${LAUNCHSTACK_ALLOW_EMPTY_STORE:-0}" != "1" ]]; then
  echo "overwrite guard REFUSED: every probed key was masked (403) and none was readable (200), so the store's anonymous read grant cannot be confirmed intact — refusing rather than treating the whole store as empty. Set LAUNCHSTACK_ALLOW_EMPTY_STORE=1 only when publishing into a genuinely empty store." >&2
  exit 1
fi

echo "overwrite guard clear: no already-published key would be replaced (${#new_artifacts[@]} new)" >&2
# `${arr[@]+"${arr[@]}"}` — bash 3.2 (the macOS system shell) treats an empty array as unset under
# `set -u`, so a bare expansion aborts the all-no-op run: the one path an operator re-publish takes.
for key in ${new_artifacts[@]+"${new_artifacts[@]}"}; do
  echo "${key}"
done
