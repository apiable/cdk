#!/usr/bin/env bash
#
# Verify every synthesized launch-stack template — and code artifact, e.g. the lambda-authorizer's
# zip (013-1-28) — is anonymously fetchable at the address the portal (or the template itself)
# composes for it, and that the served bytes are the bytes that were synthesized.
#
# Key grammar contract: portal/backend/src/main/kotlin/io/apiable/domain/onboarding/
# OnboardingLaunchStackUrlGenerator.kt::templateHttpsUrl — `<construct>/<version>/template.yaml`
# under the bucket; a code artifact publishes alongside it at the same version segment
# (launchStackCodeKey). A change to either grammar must change this script in the same PR.
#
# The inventory is derived from dist/launchstack/, so it can never drift from what was published.
# Only template.yaml and *.zip are checked, matching what publish-launchstack.sh uploads — the
# template.json twin beside a template is a local parity-spec input and is deliberately not in the
# store. Fetches carry no credentials: the CloudFormation console (and, for a code artifact, the
# Lambda service provisioning in the customer's account) fetches unauthenticated, so anonymous read
# is the behaviour under test.
#
# Redirects are followed because the console follows them. The region-neutral
# `<bucket>.s3.amazonaws.com` host answers 307 to the region-specific host until a new bucket's
# name propagates through S3's global DNS, and a runner outside the bucket's region can see that
# redirect at any time. Headers are read from the last response in the chain, not the first.
#
# Exits non-zero on the first failure class found, so a promotion blocks rather than shipping a
# Launch Stack button that 404s — or a function whose code CloudFormation cannot fetch — in a
# customer's account.
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
  echo "no artifacts under ${SRC_DIR} — nothing to verify, which is itself a synth failure" >&2
  exit 1
fi

echo "verifying ${#ARTIFACTS[@]} published artifacts against ${TEMPLATE_STORE_HOST}"

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

# A local artifact's well-formedness, and the served body's, are checked by the same predicate per
# kind — YAML template vs. code zip — so the two passes below (local, then served) can never drift
# apart into checking different things for the same key.
is_wellformed_template() {
  grep -qE 'AWSTemplateFormatVersion|^Resources:|^Parameters:' <(head -20 "$1") &&
    parse_error=$(node -e "
      const yaml = require('js-yaml');
      try {
        const doc = yaml.load(require('fs').readFileSync(process.argv[1], 'utf8'));
        if (!doc || typeof doc !== 'object' || !doc.Resources) {
          throw new Error('parsed but carries no Resources — not a CloudFormation template');
        }
      } catch (e) {
        console.error(String(e.message).split('\n')[0]);
        process.exit(1);
      }
    " "$1" 2>&1)
}

# `unzip -t` decompresses every entry and checks its CRC — a stronger integrity proof than a magic-byte
# sniff, and cheap at this artifact's size. Works on an extension-less temp path; unzip reads the zip's
# own internal structure, never the filename.
is_wellformed_zip() {
  parse_error=$(unzip -tqq "$1" 2>&1) && [[ -n "$(unzip -l "$1" 2>/dev/null | tail -1)" ]]
}

for src in "${ARTIFACTS[@]}"; do
  key="${src#"${SRC_DIR}"/}"
  url="${TEMPLATE_STORE_SCHEME}://${TEMPLATE_STORE_HOST}/${key}"
  before=${failures}
  case "${key}" in
    *.zip) kind="zip"; kind_label="code zip"; content_type_pattern="zip" ;;
    *) kind="template"; kind_label="CloudFormation template"; content_type_pattern="yaml" ;;
  esac

  # A truncated or marker-less local artifact would hash-match an equally broken published
  # object, so the source is checked before it is trusted as the oracle.
  if [[ ! -s "${src}" ]]; then
    fail "${key} — local artifact is empty; synth produced nothing to publish"
    continue
  fi
  parse_error=""
  if [[ "${kind}" == "zip" ]]; then
    is_wellformed_zip "${src}" || { fail "${key} — local artifact is not a well-formed zip: ${parse_error}"; continue; }
  else
    is_wellformed_template "${src}" || { fail "${key} — local artifact has no template-shape marker"; continue; }
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

  if ! echo "${content_type}" | grep -qi "${content_type_pattern}"; then
    fail "${key} — Content-Type '${content_type}' is not a ${kind_label}"
  fi

  if ! echo "${cache_control}" | grep -qE 'immutable|max-age=[0-9]{7,}'; then
    fail "${key} — Cache-Control '${cache_control}' does not mark a versioned address as stable"
  fi

  served_sha=$(sha256_of "${body_file}")
  source_sha=$(sha256_of "${src}")
  if [[ "${served_sha}" != "${source_sha}" ]]; then
    fail "${key} — served body differs from the synthesized artifact (served ${served_sha:0:12}…, source ${source_sha:0:12}…)"
  fi

  # Matching the source hash only proves the upload was faithful, not that what was uploaded is
  # usable — a corrupt artifact hash-matches its equally corrupt source. So the served bytes are
  # parsed the way the real consumer parses them: the CloudFormation console for a template, the
  # Lambda service unpacking a deployment package for a code zip. This is deliberately a local parse
  # rather than cloudformation:ValidateTemplate: the publishing identity is scoped to S3 alone, and a
  # check that degrades to "skipped" on AccessDenied would wave through exactly what it exists to catch.
  parse_error=""
  if [[ "${kind}" == "zip" ]]; then
    is_wellformed_zip "${body_file}" || fail "${key} — served body is not a well-formed zip: ${parse_error}"
  else
    is_wellformed_template "${body_file}" || fail "${key} — served body is not a well-formed CloudFormation template: ${parse_error}"
  fi

  rm -f "${body_file}" "${header_file}"

  # Only an artifact that cleared every check above is reported clean — a key must never print
  # both a failure and a tick, or a real failure reads as noise beside a green line.
  if [[ ${failures} -eq ${before} ]]; then
    echo "  ✓ ${key}"
  fi
done

if [[ ${failures} -gt 0 ]]; then
  echo "${failures} verification failure(s) — artifacts are not correctly published" >&2
  exit 1
fi

echo "all ${#ARTIFACTS[@]} artifacts fetch anonymously, match their source bytes, and are cache-stable"
