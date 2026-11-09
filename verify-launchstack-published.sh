#!/usr/bin/env bash
#
# Verify every synthesized launch-stack artifact — the CloudFormation template, a code artifact such
# as the lambda-authorizer's zip, a Terraform module archive, and the gateway role's console
# instruction set — is anonymously fetchable at the address the portal (or the template itself)
# composes for it, and that the served bytes are the bytes that were synthesized.
#
# Key grammar contract: portal/backend/src/main/kotlin/io/apiable/domain/onboarding/
# PublishedArtifactAddress.kt — `<construct>/<version>/template.yaml`, `<construct>/<version>/
# terraform.zip`, `<construct>/<version>/console-instructions.json` and `<construct>/<version>/
# publish-check.json` under the bucket; a code artifact publishes alongside them at the same version
# segment (launchStackCodeKey). A change to any of these grammars must change this script in the
# same PR.
#
# The inventory is derived from dist/launchstack/, so it can never drift from what was published.
# Only template.yaml, *.zip, console-instructions.json and publish-check.json are checked, matching
# what publish-launchstack.sh uploads — the template.json twin beside a template is a local
# parity-spec input and is deliberately not in the store.
#
# Earlier versions the portal still offers but the pipeline no longer builds are listed in
# launchstack-still-offered.json; their bytes cannot be rebuilt, so each is held to its committed
# digest and never uploaded.
#
# The portal serves only what a publish-check.json covers, so records are written into dist/ only
# when every artifact passed, and the next run fetches them back and checks them.
#
# Fetches carry no credentials: the CloudFormation console, `terraform init`, the portal and (for a
# code artifact) the Lambda service provisioning in the customer's account all fetch
# unauthenticated, so anonymous read is the behaviour under test.
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
STILL_OFFERED="${STILL_OFFERED:-launchstack-still-offered.json}"

if [[ ! -d "${SRC_DIR}" ]]; then
  echo "no ${SRC_DIR} — run synth-launchstack.sh for each construct first" >&2
  exit 1
fi

# while-read, not mapfile: this script also runs on a macOS operator machine (bash 3.2).
ARTIFACTS=()
RECORDS=()
while IFS= read -r line; do
  if [[ "${line}" == */publish-check.json ]]; then
    RECORDS+=("${line}")
  else
    ARTIFACTS+=("${line}")
  fi
done < <(find "${SRC_DIR}" -type f \( -name 'template.yaml' -o -name '*.zip' -o -name 'console-instructions.json' -o -name 'publish-check.json' \) | sort)

if [[ ${#ARTIFACTS[@]} -eq 0 ]]; then
  echo "no artifacts under ${SRC_DIR} — nothing to verify, which is itself a synth failure" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
# Each verified artifact as `key<TAB>kind<TAB>sha256`: what the records are written from and held to.
VERIFIED="${WORK}/verified"
: > "${VERIFIED}"

publish_check() {
  node -r ts-node/register/transpile-only scripts/publish-check.ts "$@"
}

LISTED="${WORK}/listed"
if ! publish_check still-offered "${STILL_OFFERED}" "${LISTED}"; then
  echo "the still-offered list ${STILL_OFFERED} is not well-formed (see above) — nothing can be recorded" >&2
  exit 1
fi

# Which versions take the external ID is the generator's rule, so the generator is asked: once, for the
# version of every instruction set in this run. No list of versions lives in this script.
# The question gets an environment of its own: the path, the home directory and the versions, and no
# cloud credential, wherever this script runs. npm cannot tell there that it is in CI, so it is told
# not to look for a newer version of itself.
SET_VERSIONS=""
while IFS= read -r key; do
  if [[ "${key}" == */console-instructions.json ]]; then
    version_dir="${key%/console-instructions.json}"
    SET_VERSIONS="${SET_VERSIONS} ${version_dir##*/}"
  fi
done < <(printf '%s\n' "${ARTIFACTS[@]}"; cut -f1 "${LISTED}")
VERSIONS_TAKING_EXTERNAL_ID=""
if [[ -n "${SET_VERSIONS}" ]]; then
  if ! VERSIONS_TAKING_EXTERNAL_ID=$(env -i PATH="${PATH}" HOME="${HOME}" SET_VERSIONS="${SET_VERSIONS}" npm_config_update_notifier=false \
    npx ts-node --transpile-only -r tsconfig-paths/register --prefer-ts-exts -e "
      import { requiresExternalId } from './lib/gateway-role/console-instructions'
      for (const version of (process.env.SET_VERSIONS ?? '').split(' ').filter(Boolean)) {
        if (requiresExternalId(version)) console.log(version)
      }
    "); then
    echo "could not ask the generator which versions take the external ID — the instruction sets cannot be verified" >&2
    exit 1
  fi
fi

echo "verifying ${#ARTIFACTS[@]} published artifacts, $(wc -l < "${LISTED}" | tr -d ' ') still-offered and ${#RECORDS[@]} recorded checks against ${TEMPLATE_STORE_HOST}"

failures=0

fail() {
  echo "  ✗ $1" >&2
  failures=$((failures + 1))
}

# sha256sum on the Linux runner, shasum on a macOS operator machine. Resolve one ONCE, at top level,
# and hard-fail the whole run if neither exists — a check whose entire purpose is a digest comparison
# must never degrade to comparing two empty strings (which are equal), waving through the corruption
# it exists to catch. sha256_of runs inside $(...), a subshell, so it cannot exit the script from
# there; this guard and the call-site digest-shape check below are what enforce fail-closed.
if command -v sha256sum >/dev/null 2>&1; then
  sha256_bin() { sha256sum "$1"; }
elif command -v shasum >/dev/null 2>&1; then
  sha256_bin() { shasum -a 256 "$1"; }
else
  echo "neither sha256sum nor shasum is available — cannot verify artifact fidelity" >&2
  exit 1
fi
sha256_of() { sha256_bin "$1" | awk '{print $1}'; }

# A local artifact's well-formedness, and the served body's, are checked by the same predicate per
# kind, so the two passes below (local, then served) can never drift apart into checking different
# things for the same key. Each predicate leaves its reason in parse_error on failure, captured by a
# plain command substitution — never through a pipeline, so a refusal reaches the caller whether or
# not pipefail is in effect.
is_wellformed_template() {
  grep -qE 'AWSTemplateFormatVersion|^Resources:|^Parameters:' <(head -20 "$1") \
    || { parse_error="no template-shape marker in the first 20 lines"; return 1; }
  if ! parse_error=$(node -e "
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
    " "$1" 2>&1); then
    return 1
  fi
}

# `unzip -t` decompresses every entry and checks its CRC — a stronger integrity proof than a magic-byte
# sniff, and cheap at this artifact's size. Works on an extension-less temp path; unzip reads the zip's
# own internal structure, never the filename.
is_wellformed_zip() {
  parse_error=$(unzip -tqq "$1" 2>&1) && [[ -n "$(unzip -l "$1" 2>/dev/null | tail -1)" ]]
}

# A module archive is what `terraform init` unpacks, and init needs the root module's main.tf at the
# archive root — a module nested one directory down is a valid zip that fails every apply.
is_wellformed_module_zip() {
  is_wellformed_zip "$1" || return 1
  unzip -Z1 "$1" 2>/dev/null | grep -qx 'main.tf' || { parse_error="main.tf is not at the archive root"; return 1; }
}

# The portal serves an instruction set only when its construct and version equal the key it fetched it
# at and the tokens it fills are present; the same shape check runs here so a mislabelled or
# already-resolved file never reaches the store. The region and the trust account are tokens in every
# set. The external ID is a token in a set exactly when its version takes one. $2 is the artifact's key.
is_wellformed_instructions() {
  local version="${2#*/}"
  version="${version%%/*}"
  local takes_external_id="false"
  grep -qxF -- "${version}" <<< "${VERSIONS_TAKING_EXTERNAL_ID}" && takes_external_id="true"
  if ! parse_error=$(node -e "
    const fs = require('fs');
    try {
      let doc;
      try {
        doc = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
      } catch (e) {
        throw new Error('not JSON: ' + String(e.message).split('\n')[0]);
      }
      const [construct, version] = process.argv[2].split('/');
      if (!doc || typeof doc !== 'object' || doc.construct !== construct || doc.version !== version) {
        throw new Error('names ' + (doc && doc.construct) + '@' + (doc && doc.version) + ' but is published under ' + construct + '/' + version);
      }
      for (const field of ['roleName', 'trustDocument', 'permissionDocument']) {
        if (doc[field] === undefined) throw new Error('carries no ' + field);
      }
      const text = JSON.stringify(doc);
      for (const token of ['{region}', '{trust-account}']) {
        if (!text.includes(token)) throw new Error('carries no ' + token + ' token for the portal to fill');
      }
      const takesExternalId = process.argv[3] === 'true';
      if (takesExternalId && !text.includes('{external-id}')) {
        throw new Error('carries no {external-id} token for the portal to fill');
      }
      if (!takesExternalId && text.includes('{external-id}')) {
        throw new Error('carries an {external-id} token, and its version takes no external ID');
      }
    } catch (e) {
      console.error(String(e.message).split('\n')[0]);
      process.exit(1);
    }
  " "$1" "$2" "${takes_external_id}" 2>&1); then
    return 1
  fi
}

is_wellformed_artifact() {
  local kind="$1" file="$2" key="$3"
  parse_error=""
  case "${kind}" in
    template) is_wellformed_template "${file}" ;;
    zip) is_wellformed_zip "${file}" ;;
    module) is_wellformed_module_zip "${file}" ;;
    instructions) is_wellformed_instructions "${file}" "${key}" ;;
  esac
}

kind_of() {
  case "$1" in
    */terraform.zip) kind="module"; kind_label="Terraform module archive"; content_type_pattern="zip" ;;
    *.zip) kind="zip"; kind_label="code zip"; content_type_pattern="zip" ;;
    */console-instructions.json) kind="instructions"; kind_label="console instruction set"; content_type_pattern="json" ;;
    */publish-check.json) kind="record"; kind_label="publish-check record"; content_type_pattern="json" ;;
    *) kind="template"; kind_label="CloudFormation template"; content_type_pattern="yaml" ;;
  esac
}

# Fetches $1 anonymously into body_file and checks the headers a versioned address must carry. On a
# non-200 it fails, removes the body and returns 1; a header failure is counted but the body is kept,
# so the caller still compares and parses it and every reason is named.
fetch_served() {
  local key="$1" url="${TEMPLATE_STORE_SCHEME}://${TEMPLATE_STORE_HOST}/$1" header_file code content_type cache_control
  body_file="$(mktemp "${WORK}/body.XXXXXX")"
  header_file="$(mktemp "${WORK}/headers.XXXXXX")"
  code=$(curl -sSL -o "${body_file}" -D "${header_file}" -w '%{http_code}' --max-time 20 "${url}")

  if [[ "${code}" != "200" ]]; then
    fail "${key} — anonymous fetch returned ${code} (expected 200) — ${url}"
    rm -f "${body_file}" "${header_file}"
    return 1
  fi

  content_type=$(grep -i '^content-type:' "${header_file}" | tail -1 | tr -d '\r' | cut -d: -f2- | xargs)
  cache_control=$(grep -i '^cache-control:' "${header_file}" | tail -1 | tr -d '\r' | cut -d: -f2- | xargs)
  rm -f "${header_file}"

  if ! echo "${content_type}" | grep -qi "${content_type_pattern}"; then
    fail "${key} — Content-Type '${content_type}' is not a ${kind_label}"
  fi

  if ! echo "${cache_control}" | grep -qE 'immutable|max-age=[0-9]{7,}'; then
    fail "${key} — Cache-Control '${cache_control}' does not mark a versioned address as stable"
  fi
}

# Fail closed on a malformed digest: an empty or partial hash on both sides would compare equal and
# read as a faithful upload. Require a real 64-hex sha256 on each before the comparison means anything.
compare_digest() {
  local key="$1" served_sha="$2" expected_sha="$3" expected_label="$4"
  if [[ ! "${served_sha}" =~ ^[0-9a-f]{64}$ || ! "${expected_sha}" =~ ^[0-9a-f]{64}$ ]]; then
    fail "${key} — could not compute a sha256 to compare (served '${served_sha}', ${expected_label} '${expected_sha}')"
  elif [[ "${served_sha}" != "${expected_sha}" ]]; then
    fail "${key} — served body differs from the ${expected_label} (served ${served_sha:0:12}…, ${expected_label} ${expected_sha:0:12}…)"
  fi
}

report_clean() {
  # Only an artifact that cleared every check is reported clean — a key must never print both a
  # failure and a tick, or a real failure reads as noise beside a green line.
  if [[ ${failures} -eq $2 ]]; then
    echo "  ✓ $1"
  fi
}

for src in "${ARTIFACTS[@]}"; do
  key="${src#"${SRC_DIR}"/}"
  before=${failures}
  kind_of "${key}"

  # A truncated or marker-less local artifact would hash-match an equally broken published
  # object, so the source is checked before it is trusted as the oracle.
  if [[ ! -s "${src}" ]]; then
    fail "${key} — local artifact is empty; synth produced nothing to publish"
    continue
  fi
  is_wellformed_artifact "${kind}" "${src}" "${key}" || { fail "${key} — local artifact is not a well-formed ${kind_label}: ${parse_error}"; continue; }

  fetch_served "${key}" || continue

  served_sha=$(sha256_of "${body_file}")
  compare_digest "${key}" "${served_sha}" "$(sha256_of "${src}")" "synthesized artifact"

  # Matching the source hash only proves the upload was faithful, not that what was uploaded is
  # usable — a corrupt artifact hash-matches its equally corrupt source. So the served bytes are
  # parsed the way the real consumer parses them: the CloudFormation console for a template, the
  # Lambda service unpacking a deployment package for a code zip, `terraform init` for a module
  # archive, the portal for an instruction set. This is deliberately a local parse rather than
  # cloudformation:ValidateTemplate: the publishing identity is scoped to S3 alone, and a check that
  # degrades to "skipped" on AccessDenied would wave through exactly what it exists to catch.
  is_wellformed_artifact "${kind}" "${body_file}" "${key}" || fail "${key} — served body is not a well-formed ${kind_label}: ${parse_error}"

  rm -f "${body_file}"
  [[ ${failures} -eq ${before} ]] && printf '%s\t%s\t%s\n' "${key}" "${kind}" "${served_sha}" >> "${VERIFIED}"
  report_clean "${key}" "${before}"
done

# A version both built and listed would be recorded from two sources of truth that need not agree.
# fd 3, so no command in the body can read the list from stdin.
while IFS=$'\t' read -r key kind committed_sha <&3; do
  before=${failures}
  version_dir="${key%/*}"
  if [[ -d "${SRC_DIR}/${version_dir}" ]] && find "${SRC_DIR}/${version_dir}" -type f ! -name 'publish-check.json' | grep -q .; then
    fail "${key} — ${version_dir%/*} ${version_dir#*/} is on the still-offered list and also built; a version is one or the other"
    continue
  fi
  kind_of "${key}"
  fetch_served "${key}" || continue
  served_sha=$(sha256_of "${body_file}")
  compare_digest "${key}" "${served_sha}" "${committed_sha}" "digest committed in ${STILL_OFFERED}"
  is_wellformed_artifact "${kind}" "${body_file}" "${key}" || fail "${key} — served body is not a well-formed ${kind_label}: ${parse_error}"
  rm -f "${body_file}"
  [[ ${failures} -eq ${before} ]] && printf '%s\t%s\t%s\n' "${key}" "${kind}" "${served_sha}" >> "${VERIFIED}"
  report_clean "${key} (still offered)" "${before}"
done 3< "${LISTED}"

# A published record is trusted only once its served bytes are the local record's and they parse as
# the record of exactly the artifacts verified beside it in this run.
SERVED_RECORDS="${WORK}/served-records"
: > "${SERVED_RECORDS}"
for src in ${RECORDS[@]+"${RECORDS[@]}"}; do
  key="${src#"${SRC_DIR}"/}"
  kind_of "${key}"
  fetch_served "${key}" || continue
  compare_digest "${key}" "$(sha256_of "${body_file}")" "$(sha256_of "${src}")" "local record"
  printf '%s\t%s\n' "${key}" "${body_file}" >> "${SERVED_RECORDS}"
done
if [[ -s "${SERVED_RECORDS}" ]]; then
  RECORD_FAULTS="${WORK}/record-faults"
  if ! publish_check check "${VERIFIED}" "${SERVED_RECORDS}" "${RECORD_FAULTS}"; then
    fail "the published records could not be checked (see above)"
  else
    while IFS= read -r fault; do
      fail "${fault}"
    done < "${RECORD_FAULTS}"
    while IFS=$'\t' read -r key _; do
      grep -qF "${key} — " "${RECORD_FAULTS}" || echo "  ✓ ${key}"
    done < "${SERVED_RECORDS}"
  fi
fi

if [[ ${failures} -gt 0 ]]; then
  echo "${failures} verification failure(s) — artifacts are not correctly published; no publish check recorded" >&2
  exit 1
fi

if ! publish_check write "${VERIFIED}" "${SRC_DIR}"; then
  echo "the publish-check records could not be written (see above)" >&2
  exit 1
fi
cut -f1 "${VERIFIED}" | sed 's|/[^/]*$||' | sort -u | while IFS= read -r version_dir; do
  echo "  recorded ${version_dir}/publish-check.json"
done

echo "all ${#ARTIFACTS[@]} artifacts and $(wc -l < "${LISTED}" | tr -d ' ') still-offered artifacts fetch anonymously, match their expected bytes, and are cache-stable; ${#RECORDS[@]} published record(s) checked"
