#!/usr/bin/env bash
#
# Verify every synthesized launch-stack template is anonymously fetchable at the address the
# portal composes for it, and that the served bytes are the bytes that were synthesized.
#
# Key grammar contract: portal/backend/src/main/kotlin/io/apiable/domain/onboarding/
# OnboardingLaunchStackUrlGenerator.kt::templateHttpsUrl — `<construct>/<version>/template.yaml`
# under the bucket. A change to that grammar must change this script in the same PR.
#
# The inventory is derived from dist/launchstack/, so it can never drift from what was published.
# Only template.yaml is checked, matching what publish-launchstack.sh uploads — the template.json
# twin beside it is a local parity-spec input and is deliberately not in the store.
# Fetches carry no credentials: the CloudFormation console fetches on the customer's behalf, so
# anonymous read is the behaviour under test.
#
# Redirects are followed because the console follows them. The region-neutral
# `<bucket>.s3.amazonaws.com` host answers 307 to the region-specific host until a new bucket's
# name propagates through S3's global DNS, and a runner outside the bucket's region can see that
# redirect at any time. Headers are read from the last response in the chain, not the first.
#
# Exits non-zero on the first failure class found, so a promotion blocks rather than shipping a
# Launch Stack button that 404s in a customer's browser.
set -uo pipefail

cd "$(dirname "$0")"

LAUNCHSTACK_BUCKET="${LAUNCHSTACK_BUCKET:-apiable-launchstack-templates}"
TEMPLATE_STORE_HOST="${TEMPLATE_STORE_HOST:-${LAUNCHSTACK_BUCKET}.s3.amazonaws.com}"
SRC_DIR="dist/launchstack"

if [[ ! -d "${SRC_DIR}" ]]; then
  echo "no ${SRC_DIR} — run synth-launchstack.sh for each construct first" >&2
  exit 1
fi

# while-read, not mapfile: this script also runs on a macOS operator machine (bash 3.2).
TEMPLATES=()
while IFS= read -r line; do
  TEMPLATES+=("${line}")
done < <(find "${SRC_DIR}" -type f -name 'template.yaml' | sort)

if [[ ${#TEMPLATES[@]} -eq 0 ]]; then
  echo "no templates under ${SRC_DIR} — nothing to verify, which is itself a synth failure" >&2
  exit 1
fi

echo "verifying ${#TEMPLATES[@]} published templates against ${TEMPLATE_STORE_HOST}"

failures=0

fail() {
  echo "  ✗ $1" >&2
  failures=$((failures + 1))
}

# sha256sum on the Linux runner, shasum on a macOS operator machine.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

for src in "${TEMPLATES[@]}"; do
  key="${src#"${SRC_DIR}"/}"
  url="https://${TEMPLATE_STORE_HOST}/${key}"
  before=${failures}

  # A truncated or marker-less local artifact would hash-match an equally broken published
  # object, so the source is checked before it is trusted as the oracle.
  if [[ ! -s "${src}" ]]; then
    fail "${key} — local artifact is empty; synth produced nothing to publish"
    continue
  fi
  if ! head -20 "${src}" | grep -qE 'AWSTemplateFormatVersion|^Resources:|^Parameters:'; then
    fail "${key} — local artifact has no template-shape marker"
    continue
  fi

  body_file="$(mktemp)"
  header_file="$(mktemp)"
  code=$(curl -sSL -o "${body_file}" -D "${header_file}" -w '%{http_code}' --max-time 20 "${url}")

  if [[ "${code}" != "200" ]]; then
    fail "${key} — anonymous fetch returned ${code} (expected 200) — ${url}"
    rm -f "${body_file}" "${header_file}"
    continue
  fi

  content_type=$(grep -i '^content-type:' "${header_file}" | tail -1 | tr -d '\r' | cut -d: -f2- | xargs)
  cache_control=$(grep -i '^cache-control:' "${header_file}" | tail -1 | tr -d '\r' | cut -d: -f2- | xargs)

  if ! echo "${content_type}" | grep -qi 'yaml'; then
    fail "${key} — Content-Type '${content_type}' is not a YAML template"
  fi

  if ! echo "${cache_control}" | grep -qE 'immutable|max-age=[0-9]{7,}'; then
    fail "${key} — Cache-Control '${cache_control}' does not mark a versioned address as stable"
  fi

  served_sha=$(sha256_of "${body_file}")
  source_sha=$(sha256_of "${src}")
  if [[ "${served_sha}" != "${source_sha}" ]]; then
    fail "${key} — served body differs from the synthesized artifact (served ${served_sha:0:12}…, source ${source_sha:0:12}…)"
  fi

  rm -f "${body_file}" "${header_file}"

  # Only a template that cleared every check above is reported clean — a key must never print
  # both a failure and a tick, or a real failure reads as noise beside a green line.
  if [[ ${failures} -eq ${before} ]]; then
    echo "  ✓ ${key}"
  fi
done

if [[ ${failures} -gt 0 ]]; then
  echo "${failures} verification failure(s) — templates are not correctly published" >&2
  exit 1
fi

echo "all ${#TEMPLATES[@]} templates fetch anonymously, match their source bytes, and are cache-stable"
