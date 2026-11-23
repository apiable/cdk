#!/usr/bin/env bash
#
# Test-automation coverage (013-1-28 [TA], extended by 013-1-29) for verify-launchstack-published.sh's
# zip-artifact path AND launchstack-overwrite-guard.sh's producer-side write-once guard, end-to-end
# against a local HTTP server standing in for S3 — no AWS account needed, mirroring 013-1-25's own
# tamper-test methodology for its template-only predecessor
# (_bmad-output/test-artifacts/atdd-013-1-25-verify-launchstack-published.sh).
#
# Exercises the REAL scripts (never a reimplementation of their logic), so this test verifies actual
# behaviour, not a copy that could silently drift from it. A bare `python3 -m http.server` does not set
# Content-Type reliably for `.yaml` or any Cache-Control header at all, so the stand-in server below sets
# both explicitly — the same headers publish-launchstack.sh sets on the real store — otherwise this
# would fail its own happy path for reasons S3 would never produce.
#
# `aws s3 sync` (the actual upload half of publish-launchstack.sh) needs a real S3-compatible API this
# harness does not provide, so the 013-1-29 checks below exercise launchstack-overwrite-guard.sh
# directly — the fail-closed half, and the one a corrupted/tampered publish would actually be caught by.
#
# Usage: bash test-verify-launchstack-published.sh
set -uo pipefail
cd "$(dirname "$0")"

SCRATCH="$(mktemp -d)"
SERVER_PID=""
cleanup() {
  [[ -n "${SERVER_PID}" ]] && kill "${SERVER_PID}" 2>/dev/null
  rm -rf "${SCRATCH}"
}
trap cleanup EXIT

# The shared tree's instruction set is a gateway-role set, and a set is held to its own construct's shape.
CONSTRUCT="apiable-gateway-role"
VERSION="9.9.9"
ARTIFACT_DIR="${SCRATCH}/dist/launchstack/${CONSTRUCT}/${VERSION}"
SERVE_DIR="${SCRATCH}/served/${CONSTRUCT}/${VERSION}"
mkdir -p "${ARTIFACT_DIR}" "${SERVE_DIR}"

# The committed list names the real store's 2.0.0, which the stand-in does not serve; every run here
# reads an empty list unless a check names its own.
printf '[]\n' > "${SCRATCH}/still-offered-none.json"
export STILL_OFFERED="${SCRATCH}/still-offered-none.json"

cat > "${ARTIFACT_DIR}/template.yaml" <<'YAML'
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  Fn:
    Type: AWS::Lambda::Function
YAML

python3 -c "
import zipfile
with zipfile.ZipFile('${ARTIFACT_DIR}/authorizer.zip', 'w') as zf:
    zf.writestr('index.mjs', 'export const handler = async () => ({})')
with zipfile.ZipFile('${ARTIFACT_DIR}/terraform.zip', 'w') as zf:
    zf.writestr('main.tf', 'resource \"null_resource\" \"this\" {}\n')
    zf.writestr('variables.tf', 'variable \"region\" { type = string }\n')
"
# The shape the portal serves from: named construct + version, the three load-bearing fields, and the
# three tokens the portal fills.
cat > "${ARTIFACT_DIR}/console-instructions.json" <<'JSON'
{"construct":"apiable-gateway-role","version":"9.9.9","region":"{region}","roleName":"apiable-test-role-{region}","trustAccount":"{trust-account}","trustDocument":{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"sts:AssumeRole","Principal":{"AWS":"arn:aws:iam::{trust-account}:root"},"Condition":{"StringEquals":{"sts:ExternalId":"{external-id}"}}}]},"permissionDocument":{"Version":"2012-10-17","Statement":[]}}
JSON
for artifact in template.yaml authorizer.zip terraform.zip console-instructions.json; do
  cp "${ARTIFACT_DIR}/${artifact}" "${SERVE_DIR}/${artifact}"
done

PORT=$(python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1]); s.close()")

# A minimal server that sets the real store's headers (Content-Type + immutable Cache-Control) per
# extension — the property under test, not incidental to it.
cat > "${SCRATCH}/serve.py" <<PYEOF
import http.server, os

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        if self.path.endswith('.yaml'):
            self.send_header('Content-Type', 'application/x-yaml')
        elif self.path.endswith('.zip'):
            self.send_header('Content-Type', 'application/zip')
        elif self.path.endswith('.json'):
            self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        super().end_headers()

os.chdir('${SCRATCH}/served')
http.server.HTTPServer(('127.0.0.1', ${PORT}), Handler).serve_forever()
PYEOF
python3 "${SCRATCH}/serve.py" >/dev/null 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 20); do
  curl -sf -o /dev/null "http://127.0.0.1:${PORT}/${CONSTRUCT}/${VERSION}/template.yaml" && break
  sleep 0.2
done

pass=0
fail_count=0
check() {
  local desc="$1" expect_exit="$2"
  shift 2
  local out
  out=$("$@" 2>&1)
  local actual=$?
  if [[ "${actual}" -eq "${expect_exit}" ]]; then
    echo "  PASS: ${desc}"
    pass=$((pass + 1))
  else
    echo "  FAIL: ${desc} (expected exit ${expect_exit}, got ${actual})"
    echo "${out}" | tail -20
    fail_count=$((fail_count + 1))
  fi
}

# An exit code alone cannot tell a refusal-for-the-right-reason from an unreachable stand-in, which also
# exits 1. Every negative check asserts the message too, so a dead server fails instead of passing.
check_message() {
  local desc="$1" expect_exit="$2" expect_msg="$3"
  shift 3
  local out
  out=$("$@" 2>&1)
  local actual=$?
  if [[ "${actual}" -eq "${expect_exit}" ]] && [[ "${out}" == *"${expect_msg}"* ]]; then
    echo "  PASS: ${desc}"
    pass=$((pass + 1))
  else
    echo "  FAIL: ${desc} (expected exit ${expect_exit} and message '${expect_msg}', got exit ${actual})"
    echo "${out}" | tail -20
    fail_count=$((fail_count + 1))
  fi
}

check_contains() {
  local desc="$1" haystack="$2" needle="$3"
  if [[ "${haystack}" == *"${needle}"* ]]; then
    echo "  PASS: ${desc}"
    pass=$((pass + 1))
  else
    echo "  FAIL: ${desc} (missing '${needle}')"
    echo "${haystack}" | tail -20
    fail_count=$((fail_count + 1))
  fi
}

# Readiness that fails loudly. A silently-exhausted wait leaves a check asserting against nothing.
cat > "${SCRATCH}/wait-status.sh" <<'WAITEOF'
#!/usr/bin/env bash
url="$1"; want="$2"
for _ in $(seq 1 40); do
  [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${url}")" == "${want}" ]] && exit 0
  sleep 0.2
done
exit 1
WAITEOF
chmod +x "${SCRATCH}/wait-status.sh"

echo "=== S1/S2/S6: valid template + zip + module archive + instruction set served with the real store's headers -> exit 0 ==="
# contract: 024-3-3 S5
check "happy path passes" 0 \
  env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash verify-launchstack-published.sh

verify_main() {
  env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash verify-launchstack-published.sh
}
guard_main() {
  env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash launchstack-overwrite-guard.sh
}
clear_records() {
  find "${SCRATCH}" -name publish-check.json -delete
}
# What publish-launchstack.sh does to a record verify wrote: puts it at its key in the store.
publish_records() {
  (cd "${SCRATCH}/dist/launchstack" && find . -name publish-check.json) | while IFS= read -r rel; do
    mkdir -p "$(dirname "${SCRATCH}/served/${rel}")"
    cp "${SCRATCH}/dist/launchstack/${rel}" "${SCRATCH}/served/${rel}"
  done
}
# The record of the files in $1 at construct $2 and version $3, written independently of the script
# under test: compact, fields in a fixed order, artifacts in file order, one trailing newline.
expected_record() {
  python3 -c "
import hashlib, json, os, sys
d, construct, version = sys.argv[1:4]
kinds = {'template.yaml': 'template', 'terraform.zip': 'module', 'console-instructions.json': 'instructions'}
artifacts = [{'file': f, 'kind': kinds.get(f, 'zip'), 'sha256': hashlib.sha256(open(os.path.join(d, f), 'rb').read()).hexdigest()}
             for f in sorted(os.listdir(d)) if f in kinds or f.endswith('.zip')]
sys.stdout.write(json.dumps({'construct': construct, 'version': version, 'result': 'passed', 'artifacts': artifacts}, separators=(',', ':')) + '\n')
" "$@"
}
RECORD="${ARTIFACT_DIR}/publish-check.json"
RECORD_KEY="${CONSTRUCT}/${VERSION}/publish-check.json"

echo "=== a passing run records its check beside the artifacts, and the next run fetches it back ==="
expected_record "${ARTIFACT_DIR}" "${CONSTRUCT}" "${VERSION}" > "${SCRATCH}/expected-record.json"
# contract: 024-3-3 S7
check "the passing run writes one record per construct version, listing each artifact's kind and the digest of its bytes" 0 \
  cmp "${RECORD}" "${SCRATCH}/expected-record.json"
one_record_only() {
  [[ "$(find "${SCRATCH}/dist" -name publish-check.json | wc -l | tr -d ' ')" == "1" ]]
}
# contract: 024-3-3 S7
check "the passing run writes no other record" 0 one_record_only
publish_records
# contract: 024-3-3 S7
check_message "the next run fetches the published record back and passes it" 0 "✓ ${RECORD_KEY}" verify_main
# contract: 024-3-3 S10
check "the next run reproduces the record byte for byte" 0 \
  cmp "${RECORD}" "${SCRATCH}/expected-record.json"
guard_uploads_no_record() {
  local out
  out=$(guard_main 2>/dev/null) || return 1
  [[ "${out}" != *publish-check.json* ]]
}
# contract: 024-3-3 S10
check "the guard skips a byte-identical published record" 0 guard_uploads_no_record
sed 's/"result":"passed"/"result":"passed" /' "${SCRATCH}/expected-record.json" > "${RECORD}"
# contract: 024-3-3 S10
check_message "the guard refuses a changed record at a published key" 1 \
  "${RECORD_KEY} — already published with DIFFERENT content" guard_main
cp "${SCRATCH}/expected-record.json" "${RECORD}"
printf 'export const extra = 1\n' > "${SCRATCH}/extra.js"
python3 -c "
import zipfile, sys
with zipfile.ZipFile(sys.argv[1], 'w') as zf:
    zf.write(sys.argv[2], 'index.js')
" "${ARTIFACT_DIR}/extra.zip" "${SCRATCH}/extra.js"
# contract: 024-3-3 S10
check_message "the guard refuses a new artifact at a version whose check is already recorded, naming the construct and version" 1 \
  "${CONSTRUCT} ${VERSION} — its publish check is already recorded" guard_main
rm -f "${ARTIFACT_DIR}/extra.zip"
mv "${ARTIFACT_DIR}/authorizer.zip" "${SCRATCH}/authorizer.zip.recorded"
rm -f "${RECORD}"
# contract: 024-3-3 S10
check "a version that loses a recorded file still verifies, and records the smaller set locally" 0 verify_main
# contract: 024-3-3 S10
check_message "the guard refuses the changed record of a version that lost a recorded file, naming the construct and version" 1 \
  "${RECORD_KEY} — already published with DIFFERENT content" guard_main
mv "${SCRATCH}/authorizer.zip.recorded" "${ARTIFACT_DIR}/authorizer.zip"
cp "${SCRATCH}/expected-record.json" "${RECORD}"

echo "=== a published record that does not match its address or its artifacts fails the run, the reason named ==="
# Corrupts the record on both sides, so only the record arm can refuse it.
refuses_record() {
  local desc="$1" expect_msg="$2" from="$3" to="$4"
  sed "s/${from}/${to}/" "${SCRATCH}/expected-record.json" > "${RECORD}"
  cp "${RECORD}" "${SERVE_DIR}/publish-check.json"
  check_message "${desc}" 1 "${RECORD_KEY} — ${expect_msg}" verify_main
  cp "${SCRATCH}/expected-record.json" "${RECORD}"
  cp "${SCRATCH}/expected-record.json" "${SERVE_DIR}/publish-check.json"
}
# contract: 024-3-3 S9
refuses_record "a record naming another construct fails the run" \
  "names construct apiable-other-construct, published under ${CONSTRUCT}" '"construct":"apiable-gateway-role"' '"construct":"apiable-other-construct"'
# contract: 024-3-3 S9
refuses_record "a record naming another version fails the run" \
  "names version 9.9.8, published under ${VERSION}" '"version":"9.9.9"' '"version":"9.9.8"'
# contract: 024-3-3 S9
refuses_record "a record whose result is not passed fails the run" \
  "result is failed, not passed" '"result":"passed"' '"result":"failed"'
TEMPLATE_SHA="$(python3 -c "import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" "${ARTIFACT_DIR}/template.yaml")"
# contract: 024-3-3 S9
refuses_record "a record whose listed digest differs from its artifact's fails the run" \
  "template.yaml digest 000000000000… differs from its artifact's ${TEMPLATE_SHA:0:12}…" "${TEMPLATE_SHA}" "$(printf '0%.0s' $(seq 1 64))"

echo "=== a run with any failing artifact records nothing ==="
clear_records
cp "${SERVE_DIR}/authorizer.zip" "${SCRATCH}/authorizer.zip.good"
head -c 50 "${SCRATCH}/authorizer.zip.good" > "${SERVE_DIR}/authorizer.zip"
# contract: 024-3-3 S8
check_message "a run with a failing artifact fails, naming it" 1 \
  "${CONSTRUCT}/${VERSION}/authorizer.zip — served body differs" verify_main
no_record_written() {
  [[ -z "$(find "${SCRATCH}/dist" -name publish-check.json)" ]]
}
# contract: 024-3-3 S8
check "a run with a failing artifact writes no record" 0 no_record_written
cp "${SCRATCH}/authorizer.zip.good" "${SERVE_DIR}/authorizer.zip"

echo "=== an earlier version on the still-offered list is fetched, held to its committed digest, parsed and recorded, never uploaded ==="
LISTED_VERSION="8.0.0"
LISTED_SERVED="${SCRATCH}/served/${CONSTRUCT}/${LISTED_VERSION}"
mkdir -p "${LISTED_SERVED}"
cp "${ARTIFACT_DIR}/template.yaml" "${ARTIFACT_DIR}/terraform.zip" "${LISTED_SERVED}/"
# Writes a still-offered list to $1 naming every file served for the listed version at its digest.
# A second argument is the version to list, a third replaces every digest.
write_list() {
  python3 -c "
import hashlib, json, os, sys
out, d, version = sys.argv[1:4]
digest = sys.argv[4] if len(sys.argv) > 4 else None
kinds = {'template.yaml': 'template', 'terraform.zip': 'module'}
artifacts = [{'file': f, 'kind': kinds[f], 'sha256': digest or hashlib.sha256(open(os.path.join(d, f), 'rb').read()).hexdigest()} for f in sorted(kinds)]
json.dump([{'construct': '${CONSTRUCT}', 'version': version, 'artifacts': artifacts}], open(out, 'w'))
" "$1" "${LISTED_SERVED}" "${2:-${LISTED_VERSION}}" ${3:+"$3"}
}
verify_listed() {
  env STILL_OFFERED="$1" SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash verify-launchstack-published.sh
}
write_list "${SCRATCH}/list.json"
# contract: 024-3-3 S22
check_message "a listed version whose files are served at their committed digests verifies clean" 0 \
  "✓ ${CONSTRUCT}/${LISTED_VERSION}/terraform.zip (still offered)" verify_listed "${SCRATCH}/list.json"
expected_record "${LISTED_SERVED}" "${CONSTRUCT}" "${LISTED_VERSION}" > "${SCRATCH}/expected-listed-record.json"
# contract: 024-3-3 S22
check "the listed version is recorded like a built one" 0 \
  cmp "${SCRATCH}/dist/launchstack/${CONSTRUCT}/${LISTED_VERSION}/publish-check.json" "${SCRATCH}/expected-listed-record.json"
guard_uploads_only_the_listed_record() {
  local out
  out=$(guard_main 2>/dev/null) || return 1
  [[ "$(grep "/${LISTED_VERSION}/" <<< "${out}")" == "${CONSTRUCT}/${LISTED_VERSION}/publish-check.json" ]]
}
# contract: 024-3-3 S22
check "of a listed version, the publish uploads the record and no artifact" 0 guard_uploads_only_the_listed_record
publish_records
# contract: 024-3-3 S22
check_message "the next run fetches the listed version's record back and passes it" 0 \
  "✓ ${CONSTRUCT}/${LISTED_VERSION}/publish-check.json" verify_listed "${SCRATCH}/list.json"
clear_records

write_list "${SCRATCH}/list-wrong-digest.json" "${LISTED_VERSION}" "$(printf 'a%.0s' $(seq 1 64))"
# contract: 024-3-3 S22
check_message "a listed file whose served bytes differ from its committed digest fails, naming it" 1 \
  "${CONSTRUCT}/${LISTED_VERSION}/template.yaml — served body differs from the digest committed in" verify_listed "${SCRATCH}/list-wrong-digest.json"
# contract: 024-3-3 S8
check "a failing listed file records nothing for any version" 0 no_record_written

cp "${LISTED_SERVED}/template.yaml" "${SCRATCH}/listed-template.good"
printf "AWSTemplateFormatVersion: '2010-09-09'\nDescription: nothing to create\n" > "${LISTED_SERVED}/template.yaml"
write_list "${SCRATCH}/list-unparsable.json"
# contract: 024-3-3 S22
check_message "a listed file that does not parse as its kind fails, naming it" 1 \
  "${CONSTRUCT}/${LISTED_VERSION}/template.yaml — served body is not a well-formed CloudFormation template" verify_listed "${SCRATCH}/list-unparsable.json"
cp "${SCRATCH}/listed-template.good" "${LISTED_SERVED}/template.yaml"

mv "${LISTED_SERVED}/terraform.zip" "${SCRATCH}/listed-module.good"
# contract: 024-3-3 S22
check_message "a listed file the store does not serve fails, naming it" 1 \
  "${CONSTRUCT}/${LISTED_VERSION}/terraform.zip — anonymous fetch returned 404" verify_listed "${SCRATCH}/list.json"
mv "${SCRATCH}/listed-module.good" "${LISTED_SERVED}/terraform.zip"

write_list "${SCRATCH}/list-built.json" "${VERSION}"
# contract: 024-3-3 S22
check_message "a version both listed and built fails, naming the construct and version" 1 \
  "${CONSTRUCT} ${VERSION} is on the still-offered list and also built" verify_listed "${SCRATCH}/list-built.json"

printf '[{"construct":"%s","version":"%s","artifacts":[]}]' "${CONSTRUCT}" "${LISTED_VERSION}" > "${SCRATCH}/list-no-files.json"
# contract: 024-3-3 S22
check_message "a listed version that names no artifact file fails, naming it" 1 \
  "${CONSTRUCT} ${LISTED_VERSION} names no artifact file" verify_listed "${SCRATCH}/list-no-files.json"
printf '[{"construct":"%s","version":"..","artifacts":[{"file":"template.yaml","kind":"template","sha256":"%s"}]}]' "${CONSTRUCT}" "${TEMPLATE_SHA}" > "${SCRATCH}/list-climbing.json"
# contract: 024-3-3 S22
check_message "a listed version that is not a single key segment fails, naming it" 1 \
  "a still-offered entry needs a construct and version" verify_listed "${SCRATCH}/list-climbing.json"
# contract: 024-3-3 S22
check_message "a still-offered list that cannot be read fails" 1 \
  "the still-offered list ${SCRATCH}/no-such-list.json is not well-formed" verify_listed "${SCRATCH}/no-such-list.json"
clear_records
rm -rf "${LISTED_SERVED}"

# Publishes a corrupted artifact on both sides (so the fidelity hash still matches and only the shape
# arm can red), asserts the gate refuses it AND names the reason, then restores the good artifact.
# The message assertion is what makes each case non-vacuous: an exit code alone cannot tell a shape
# refusal from a dead stand-in, and a predicate whose failure never reached the caller would print
# no reason at all.
refuses_artifact() {
  local artifact="$1" desc="$2" expect_msg="$3" corrupted="$4"
  cp "${ARTIFACT_DIR}/${artifact}" "${SCRATCH}/${artifact}.good"
  cp "${corrupted}" "${ARTIFACT_DIR}/${artifact}"
  cp "${corrupted}" "${SERVE_DIR}/${artifact}"
  check_message "${desc}" 1 "${expect_msg}" \
    env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash verify-launchstack-published.sh
  cp "${SCRATCH}/${artifact}.good" "${ARTIFACT_DIR}/${artifact}"
  cp "${SCRATCH}/${artifact}.good" "${SERVE_DIR}/${artifact}"
}

echo "=== a module archive whose main.tf is not at the archive root -> fails closed, reason named ==="
python3 -c "
import zipfile
with zipfile.ZipFile('${SCRATCH}/nested.zip', 'w') as zf:
    zf.writestr('${CONSTRUCT}/main.tf', 'resource \"null_resource\" \"this\" {}\n')
"
# contract: 024-3-3 S5
refuses_artifact terraform.zip "a module archive with main.tf nested below the root fails closed" \
  "main.tf is not at the archive root" "${SCRATCH}/nested.zip"

echo "=== a console instruction set the gate must refuse, each with the reason named ==="
GOOD_SET="${ARTIFACT_DIR}/console-instructions.json"
sed 's/"construct":"apiable-gateway-role"/"construct":"other-construct"/' "${GOOD_SET}" > "${SCRATCH}/set-other-construct.json"
# contract: 024-3-3 S5
refuses_artifact console-instructions.json "an instruction set naming another construct than its key fails closed" \
  "names other-construct@9.9.9 but is published under apiable-gateway-role/9.9.9" "${SCRATCH}/set-other-construct.json"
sed 's/"version":"9.9.9"/"version":"9.9.8"/' "${GOOD_SET}" > "${SCRATCH}/set-other-version.json"
refuses_artifact console-instructions.json "an instruction set naming a different version than its key fails closed" \
  "names apiable-gateway-role@9.9.8 but is published under apiable-gateway-role/9.9.9" "${SCRATCH}/set-other-version.json"
python3 -c "
import json, sys
doc = json.load(open(sys.argv[1]))
del doc['permissionDocument']
json.dump(doc, open(sys.argv[2], 'w'))
" "${GOOD_SET}" "${SCRATCH}/set-no-policy.json"
refuses_artifact console-instructions.json "an instruction set missing a load-bearing field fails closed" \
  "carries no permissionDocument" "${SCRATCH}/set-no-policy.json"
sed 's/{region}/eu-west-1/g; s/{trust-account}/034444869755/g' "${GOOD_SET}" > "${SCRATCH}/set-resolved.json"
refuses_artifact console-instructions.json "an instruction set with its tokens already resolved fails closed" \
  "carries no {region} token for the portal to fill" "${SCRATCH}/set-resolved.json"
sed 's/{external-id}/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/g' "${GOOD_SET}" > "${SCRATCH}/set-external-id-baked.json"
refuses_artifact console-instructions.json "an instruction set with one portal's external ID baked in fails closed" \
  "carries no {external-id} token for the portal to fill" "${SCRATCH}/set-external-id-baked.json"
printf '{"construct": "apiable-gateway-role",' > "${SCRATCH}/set-malformed.json"
refuses_artifact console-instructions.json "an instruction set that is not JSON fails closed" \
  "not JSON" "${SCRATCH}/set-malformed.json"

echo "=== a set is held to the tokens its own version takes: the published 2.0.0 set beside a current one ==="
# 2.0.0 takes no external ID and stays published, so a store can hold its set beside a current one.
# The 2.0.0 set is the published one, committed as a fixture; the current set is that set at the
# package's version with the one trust condition the version adds.
V2_SET="test/fixtures/parity-gate/gateway-role-v2-console-instructions.json"
CURRENT_VERSION="$(node -p "require('./lib/gateway-role/package.json').version")"
TWO_SRC="${SCRATCH}/two-versions/dist/launchstack"
TWO_DIST="${TWO_SRC}/apiable-gateway-role"
TWO_SERVED="${SCRATCH}/served/apiable-gateway-role"
mkdir -p "${TWO_DIST}/2.0.0" "${TWO_DIST}/${CURRENT_VERSION}" "${TWO_SERVED}/2.0.0" "${TWO_SERVED}/${CURRENT_VERSION}"
# Writes the 2.0.0 set to $2 as version $1; with a third argument, with the external-ID condition on its trust.
set_at_version() {
  python3 -c "
import json, sys
doc = json.load(open(sys.argv[1]))
doc['version'] = sys.argv[2]
if len(sys.argv) > 4:
    doc['trustDocument']['Statement'][0]['Condition'] = {'StringEquals': {'sts:ExternalId': '{external-id}'}}
json.dump(doc, open(sys.argv[3], 'w'))
" "${V2_SET}" "$@"
}
publish_two() {
  cp "$1" "${TWO_DIST}/$2/console-instructions.json"
  cp "$1" "${TWO_SERVED}/$2/console-instructions.json"
}
verify_two() {
  env SRC_DIR="${TWO_SRC}" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash verify-launchstack-published.sh
}
set_at_version "${CURRENT_VERSION}" "${SCRATCH}/set-current.json" with-token
publish_two "${V2_SET}" 2.0.0
publish_two "${SCRATCH}/set-current.json" "${CURRENT_VERSION}"
check "the published 2.0.0 set beside a current set verifies clean" 0 verify_two
clear_records

set_at_version 2.0.0 "${SCRATCH}/set-v2-with-token.json" with-token
publish_two "${SCRATCH}/set-v2-with-token.json" 2.0.0
check_message "a 2.0.0 set that carries the external-ID token fails closed" 1 \
  "apiable-gateway-role/2.0.0/console-instructions.json — local artifact is not a well-formed console instruction set: carries an {external-id} token, and its version takes no external ID" \
  verify_two
publish_two "${V2_SET}" 2.0.0

set_at_version "${CURRENT_VERSION}" "${SCRATCH}/set-current-without-token.json"
publish_two "${SCRATCH}/set-current-without-token.json" "${CURRENT_VERSION}"
check_message "a current set without the external-ID token fails closed" 1 \
  "apiable-gateway-role/${CURRENT_VERSION}/console-instructions.json — local artifact is not a well-formed console instruction set: carries no {external-id} token for the portal to fill" \
  verify_two

# The rule cannot be applied when the generator does not answer, so the verifier has to stop there.
# The tree is the one the last case left, a current set without its token: a verifier that went on
# with no answer would pass it.
mkdir "${SCRATCH}/no-npx"
printf '#!/usr/bin/env bash\nexit 1\n' > "${SCRATCH}/no-npx/npx"
chmod +x "${SCRATCH}/no-npx/npx"
verify_two_with_no_generator() {
  env PATH="${SCRATCH}/no-npx:${PATH}" SRC_DIR="${TWO_SRC}" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash verify-launchstack-published.sh
}
check_message "the verifier stops when the generator cannot be asked which versions take the external ID" 1 \
  "could not ask the generator which versions take the external ID" \
  verify_two_with_no_generator

# The question is asked with no cloud credential in its environment, wherever the verifier runs. A
# recording npx, first on the path, writes down the environment it is given and hands the question to
# the real one, so the tree of the first case here has to verify clean again. Every stand-in value
# carries one marker, so a value that reached the question under any name is found.
# The names in the recording are held to a list, both ways: the four the verifier gives the question,
# and the three the recording npx's own shell has set by the time it writes them down. PWD, SHLVL and
# _ are those three under bash 3.2 on macOS and under bash 5.2 on Linux alike.
GENERATOR_ENV="${SCRATCH}/generator-env.txt"
GENERATOR_NAMES="$(printf '%s\n' PATH HOME SET_VERSIONS npm_config_update_notifier PWD SHLVL _)"
mkdir "${SCRATCH}/recording-npx"
cat > "${SCRATCH}/recording-npx/npx" <<EOF
#!/usr/bin/env bash
env > "${GENERATOR_ENV}"
exec "$(command -v npx)" "\$@"
EOF
chmod +x "${SCRATCH}/recording-npx/npx"
publish_two "${SCRATCH}/set-current.json" "${CURRENT_VERSION}"
asks_the_generator_with_no_credential() {
  env PATH="${SCRATCH}/recording-npx:${PATH}" \
    AWS_ACCESS_KEY_ID=stand-in-key-id AWS_SECRET_ACCESS_KEY=stand-in-secret-key AWS_SESSION_TOKEN=stand-in-session-token \
    STORE_PUBLISHER_TOKEN=stand-in-of-another-name \
    SRC_DIR="${TWO_SRC}" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash verify-launchstack-published.sh || return 1
  grep -q '^SET_VERSIONS=' "${GENERATOR_ENV}" || { echo "the question did not reach the recording npx with its versions"; return 1; }
  if grep -F 'stand-in' "${GENERATOR_ENV}"; then
    echo "the question was asked with the values above in its environment"
    return 1
  fi
  local recorded outside missing
  recorded="$(sed 's/=.*//' "${GENERATOR_ENV}")"
  outside="$(grep -vxF -f <(echo "${GENERATOR_NAMES}") <<< "${recorded}" | paste -sd ' ' -)"
  missing="$(grep -vxF -f <(echo "${recorded}") <<< "${GENERATOR_NAMES}" | paste -sd ' ' -)"
  if [[ -n "${outside}${missing}" ]]; then
    echo "the question was asked under names outside its list: ${outside:-none}; names of the list it was not given: ${missing:-none}"
    return 1
  fi
  grep -qx 'npm_config_update_notifier=false' "${GENERATOR_ENV}" || { echo "the question was asked without the npm setting"; return 1; }
}
check "the generator is asked in an environment of its own, with none of the credentials the verifier runs with" 0 asks_the_generator_with_no_credential
clear_records

echo "=== the rule is the construct's own: the user pool role takes the external ID from its first version ==="
# 1.0.0 of the gateway role takes no external ID; 1.0.0 of the user pool role does, and its set also
# leaves the user pool id for the portal. The set is the 2.0.0 gateway set renamed, with the user pool
# role's tokens added as each case asks, which is enough for the shape the verifier checks.
POOL_SRC="${SCRATCH}/pool-role/dist/launchstack"
POOL_DIST="${POOL_SRC}/apiable-cognito-pool-role/1.0.0"
POOL_SERVED="${SCRATCH}/served/apiable-cognito-pool-role/1.0.0"
mkdir -p "${POOL_DIST}" "${POOL_SERVED}"
pool_set() {
  python3 -c "
import json, sys
doc = json.load(open(sys.argv[1]))
doc['construct'] = 'apiable-cognito-pool-role'
doc['version'] = '1.0.0'
if 'with-token' in sys.argv[3:]:
    doc['trustDocument']['Statement'][0]['Condition'] = {'StringEquals': {'sts:ExternalId': '{external-id}'}}
if 'no-pool' not in sys.argv[3:]:
    doc['userPoolId'] = '{user-pool-id}'
json.dump(doc, open(sys.argv[2], 'w'))
" "${V2_SET}" "$@"
}
publish_pool() {
  cp "$1" "${POOL_DIST}/console-instructions.json"
  cp "$1" "${POOL_SERVED}/console-instructions.json"
}
verify_pool() {
  env SRC_DIR="${POOL_SRC}" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash verify-launchstack-published.sh
}
pool_set "${SCRATCH}/pool-with-token.json" with-token
publish_pool "${SCRATCH}/pool-with-token.json"
check "a user pool role 1.0.0 set that carries the external-ID token verifies clean" 0 verify_pool
pool_set "${SCRATCH}/pool-without-token.json"
publish_pool "${SCRATCH}/pool-without-token.json"
check_message "a user pool role 1.0.0 set without the external-ID token fails closed" 1 \
  "apiable-cognito-pool-role/1.0.0/console-instructions.json — local artifact is not a well-formed console instruction set: carries no {external-id} token for the portal to fill" \
  verify_pool
pool_set "${SCRATCH}/pool-without-pool.json" with-token no-pool
publish_pool "${SCRATCH}/pool-without-pool.json"
check_message "a user pool role 1.0.0 set without the user-pool-id token fails closed" 1 \
  "apiable-cognito-pool-role/1.0.0/console-instructions.json — local artifact is not a well-formed console instruction set: carries no {user-pool-id} token for the portal to fill" \
  verify_pool

echo "=== a CloudFormation template the gate must refuse, each with the reason named ==="
printf "AWSTemplateFormatVersion: '2010-09-09'\nDescription: a template with nothing to create\n" > "${SCRATCH}/template-no-resources.yaml"
# contract: 024-3-3 S5
refuses_artifact template.yaml "a template with no Resources fails closed" \
  "parsed but carries no Resources" "${SCRATCH}/template-no-resources.yaml"
printf "AWSTemplateFormatVersion: '2010-09-09'\nResources: [unclosed\n" > "${SCRATCH}/template-not-yaml.yaml"
refuses_artifact template.yaml "a template that is not YAML fails closed" \
  "not a well-formed CloudFormation template" "${SCRATCH}/template-not-yaml.yaml"
printf "Description: a template with no marker at all\n" > "${SCRATCH}/template-no-marker.yaml"
refuses_artifact template.yaml "a template with no template-shape marker fails closed" \
  "no template-shape marker" "${SCRATCH}/template-no-marker.yaml"

echo "=== S5: corrupted served zip (truncated) -> fails closed ==="
cp "${SERVE_DIR}/authorizer.zip" "${SCRATCH}/authorizer.zip.bak"
head -c 50 "${SERVE_DIR}/authorizer.zip" > "${SCRATCH}/truncated.zip"
cp "${SCRATCH}/truncated.zip" "${SERVE_DIR}/authorizer.zip"
# contract: 024-3-3 S5
check_message "corrupted served zip fails closed, naming it" 1 \
  "${CONSTRUCT}/${VERSION}/authorizer.zip — served body differs" \
  env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash verify-launchstack-published.sh
cp "${SCRATCH}/authorizer.zip.bak" "${SERVE_DIR}/authorizer.zip"

# A code archive built and served identically, but not a zip, is refused by its parse, naming it.
# contract: 024-3-3 S5
refuses_artifact authorizer.zip "a code archive that is not a readable zip fails closed, naming it" \
  "${CONSTRUCT}/${VERSION}/authorizer.zip — local artifact is not a well-formed" "${SCRATCH}/truncated.zip"

echo "=== S5: missing served artifact (404) -> fails closed ==="
rm "${SERVE_DIR}/authorizer.zip"
# contract: 024-3-3 S5
check_message "missing served artifact fails closed, naming it" 1 \
  "${CONSTRUCT}/${VERSION}/authorizer.zip — anonymous fetch returned 404" \
  env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash verify-launchstack-published.sh
cp "${SCRATCH}/authorizer.zip.bak" "${SERVE_DIR}/authorizer.zip"

echo "=== S5: served zip with the wrong Content-Type -> fails closed ==="
cat > "${SCRATCH}/serve-wrong-type.py" <<PYEOF
import http.server, os

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Content-Type', 'text/plain')
        self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        super().end_headers()

os.chdir('${SCRATCH}/served')
http.server.HTTPServer(('127.0.0.1', ${PORT} + 1), Handler).serve_forever()
PYEOF
python3 "${SCRATCH}/serve-wrong-type.py" >/dev/null 2>&1 &
WRONG_TYPE_PID=$!
for _ in $(seq 1 20); do
  curl -sf -o /dev/null "http://127.0.0.1:$((PORT + 1))/${CONSTRUCT}/${VERSION}/template.yaml" && break
  sleep 0.2
done
check "wrong Content-Type fails closed" 1 \
  env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:$((PORT + 1))" TEMPLATE_STORE_SCHEME="http" bash verify-launchstack-published.sh
kill "${WRONG_TYPE_PID}" 2>/dev/null

echo "=== 013-1-29 S1: overwrite guard passes clean — nothing changed, plus a brand-new version ==="
check "guard passes when published content is unchanged" 0 \
  env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash launchstack-overwrite-guard.sh
NEW_VERSION_DIR="${SCRATCH}/dist/launchstack/${CONSTRUCT}/9.9.10"
mkdir -p "${NEW_VERSION_DIR}"
cp "${ARTIFACT_DIR}/template.yaml" "${NEW_VERSION_DIR}/template.yaml"
check "guard passes a brand-new, not-yet-published version" 0 \
  env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash launchstack-overwrite-guard.sh
rm -rf "${NEW_VERSION_DIR}"

echo "=== overwrite guard against an existence-MASKING store (403 for a missing key, as S3 answers) ==="
# The real store grants anonymous GetObject on every key but never ListBucket, so S3 refuses to
# disclose that a key is absent: a GET for a not-yet-published version answers 403, not 404. A plain
# http.server answers 404 and so models the store we wish we had, never the one the publish pipeline
# actually talks to. This stand-in masks 404 as 403 so the guard's real production input is exercised.
cat > "${SCRATCH}/serve-masking.py" <<PYEOF
import http.server, os

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        if self.path.endswith('.yaml'):
            self.send_header('Content-Type', 'application/x-yaml')
        elif self.path.endswith('.zip'):
            self.send_header('Content-Type', 'application/zip')
        elif self.path.endswith('.json'):
            self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        super().end_headers()

    def send_error(self, code, message=None, explain=None):
        if code == 404:
            code, message, explain = 403, 'Forbidden', 'Access Denied'
        super().send_error(code, message, explain)

os.chdir('${SCRATCH}/served')
http.server.HTTPServer(('127.0.0.1', ${PORT} + 2), Handler).serve_forever()
PYEOF
python3 "${SCRATCH}/serve-masking.py" >/dev/null 2>&1 &
MASKING_PID=$!
for _ in $(seq 1 20); do
  curl -sf -o /dev/null "http://127.0.0.1:$((PORT + 2))/${CONSTRUCT}/${VERSION}/template.yaml" && break
  sleep 0.2
done

"${SCRATCH}/wait-status.sh" "http://127.0.0.1:$((PORT + 2))/${CONSTRUCT}/${VERSION}/template.yaml" 200 \
  || { echo "  FAIL: masking stand-in never came up — the checks below would pass on a dead server"; fail_count=$((fail_count + 1)); }

# A key absent from a masking store must reach stdout, which is the list publish-launchstack.sh uploads —
# an exit code alone would still pass if the key were classified correctly and then silently dropped.
MASKED_NEW_DIR="${SCRATCH}/dist/launchstack/${CONSTRUCT}/9.9.11"
mkdir -p "${MASKED_NEW_DIR}"
cp "${ARTIFACT_DIR}/template.yaml" "${MASKED_NEW_DIR}/template.yaml"
expected_record "${MASKED_NEW_DIR}" "${CONSTRUCT}" 9.9.11 > "${MASKED_NEW_DIR}/publish-check.json"
check "guard reads a masked 403 as not-yet-published and passes" 0 \
  env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:$((PORT + 2))" TEMPLATE_STORE_SCHEME="http" bash launchstack-overwrite-guard.sh
masked_stdout=$(env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:$((PORT + 2))" TEMPLATE_STORE_SCHEME="http" bash launchstack-overwrite-guard.sh 2>/dev/null)
check_contains "the masked key reaches stdout as an artifact to upload" \
  "${masked_stdout}" "${CONSTRUCT}/9.9.11/template.yaml"
# contract: 024-3-3 S10
check_contains "a masked (403) record key reads as not yet published and reaches stdout to upload" \
  "${masked_stdout}" "${CONSTRUCT}/9.9.11/publish-check.json"
rm -rf "${MASKED_NEW_DIR}"

# Reading 403 as absence must not soften the write-once refusal for a key that genuinely IS published.
cp "${ARTIFACT_DIR}/template.yaml" "${SCRATCH}/template.yaml.maskbak"
printf '# masked-store tamper\n' >> "${ARTIFACT_DIR}/template.yaml"
check_message "guard still refuses changed content at a published key on a masking store" 1 \
  "already published with DIFFERENT content" \
  env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:$((PORT + 2))" TEMPLATE_STORE_SCHEME="http" bash launchstack-overwrite-guard.sh
cp "${SCRATCH}/template.yaml.maskbak" "${ARTIFACT_DIR}/template.yaml"
rm -f "${SCRATCH}/template.yaml.maskbak"

# An all-masked store is indistinguishable from a broken anonymous read grant, so it must refuse rather
# than report a clear it never earned. Served from a directory with nothing in it: every key answers 403.
mkdir -p "${SCRATCH}/empty-served"
cat > "${SCRATCH}/serve-allmasked.py" <<PYEOF
import http.server, os

class Handler(http.server.SimpleHTTPRequestHandler):
    def send_error(self, code, message=None, explain=None):
        if code == 404:
            code, message, explain = 403, 'Forbidden', 'Access Denied'
        super().send_error(code, message, explain)

    def log_message(self, *args):
        pass

os.chdir('${SCRATCH}/empty-served')
http.server.HTTPServer(('127.0.0.1', ${PORT} + 4), Handler).serve_forever()
PYEOF
python3 "${SCRATCH}/serve-allmasked.py" >/dev/null 2>&1 &
ALLMASKED_PID=$!
"${SCRATCH}/wait-status.sh" "http://127.0.0.1:$((PORT + 4))/anything" 403 \
  || { echo "  FAIL: all-masked stand-in never came up"; fail_count=$((fail_count + 1)); }
check_message "guard refuses when every key is masked and none is readable" 1 \
  "anonymous read grant cannot be confirmed intact" \
  env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:$((PORT + 4))" TEMPLATE_STORE_SCHEME="http" bash launchstack-overwrite-guard.sh
check "the empty-store escape hatch is explicit, not implicit" 0 \
  env LAUNCHSTACK_ALLOW_EMPTY_STORE=1 SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:$((PORT + 4))" TEMPLATE_STORE_SCHEME="http" bash launchstack-overwrite-guard.sh
kill "${ALLMASKED_PID}" 2>/dev/null
kill "${MASKING_PID}" 2>/dev/null

echo "=== a status that is neither present nor absent still fails closed ==="
# Throttling (503) and server faults must never be read as "safe to publish" — only 200 and 403/404
# carry existence information; everything else is unknown.
cat > "${SCRATCH}/serve-503.py" <<PYEOF
import http.server

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_error(503, 'Slow Down')

    def log_message(self, *args):
        pass

http.server.HTTPServer(('127.0.0.1', ${PORT} + 3), Handler).serve_forever()
PYEOF
python3 "${SCRATCH}/serve-503.py" >/dev/null 2>&1 &
THROTTLE_PID=$!
"${SCRATCH}/wait-status.sh" "http://127.0.0.1:$((PORT + 3))/probe" 503 \
  || { echo "  FAIL: 503 stand-in never came up — the check below would pass on a dead server"; fail_count=$((fail_count + 1)); }
check_message "guard refuses on an unknown status (503) rather than treating it as absent" 1 \
  "unexpected status 503" \
  env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:$((PORT + 3))" TEMPLATE_STORE_SCHEME="http" bash launchstack-overwrite-guard.sh
kill "${THROTTLE_PID}" 2>/dev/null

# The record probe for a version with a new artifact is its own request: a fault there must refuse too,
# never read as "no record yet". Artifacts answer as the masking store does; every record key faults.
cat > "${SCRATCH}/serve-record-fault.py" <<PYEOF
import http.server, os

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.endswith('/publish-check.json'):
            self.send_error(500, 'Internal Error')
            return
        super().do_GET()

    def send_error(self, code, message=None, explain=None):
        if code == 404:
            code, message, explain = 403, 'Forbidden', 'Access Denied'
        super().send_error(code, message, explain)

    def log_message(self, *args):
        pass

os.chdir('${SCRATCH}/served')
http.server.HTTPServer(('127.0.0.1', ${PORT} + 5), Handler).serve_forever()
PYEOF
python3 "${SCRATCH}/serve-record-fault.py" >/dev/null 2>&1 &
RECORD_FAULT_PID=$!
"${SCRATCH}/wait-status.sh" "http://127.0.0.1:$((PORT + 5))/${CONSTRUCT}/${VERSION}/publish-check.json" 500 \
  || { echo "  FAIL: record-fault stand-in never came up — the check below would pass on a dead server"; fail_count=$((fail_count + 1)); }
clear_records
FAULTED_NEW_DIR="${SCRATCH}/dist/launchstack/${CONSTRUCT}/9.9.12"
mkdir -p "${FAULTED_NEW_DIR}"
cp "${ARTIFACT_DIR}/template.yaml" "${FAULTED_NEW_DIR}/template.yaml"
# contract: 024-3-3 S10
check_message "guard refuses a new artifact when its version's record probe answers neither present nor absent" 1 \
  "${CONSTRUCT}/9.9.12/publish-check.json — unexpected status 500 probing the published store; refusing (cannot tell whether its check is recorded)" \
  env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:$((PORT + 5))" TEMPLATE_STORE_SCHEME="http" bash launchstack-overwrite-guard.sh
rm -rf "${FAULTED_NEW_DIR}"
kill "${RECORD_FAULT_PID}" 2>/dev/null

echo "=== the guard follows a store redirect on the record probe, as it does on the artifact fetch ==="
# S3's region-neutral endpoint can answer 307 to its regional one. The record probe must judge the final
# answer, so a redirect never aborts a publish and never hides a record that is already there.
cat > "${SCRATCH}/serve-redirect.py" <<PYEOF
import http.server

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(307)
        self.send_header('Location', 'http://127.0.0.1:${PORT}' + self.path)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def log_message(self, *args):
        pass

http.server.HTTPServer(('127.0.0.1', ${PORT} + 6), Handler).serve_forever()
PYEOF
python3 "${SCRATCH}/serve-redirect.py" >/dev/null 2>&1 &
REDIRECT_PID=$!
"${SCRATCH}/wait-status.sh" "http://127.0.0.1:$((PORT + 6))/${CONSTRUCT}/${VERSION}/template.yaml" 307 \
  || { echo "  FAIL: redirecting stand-in never came up — the checks below would pass on a dead server"; fail_count=$((fail_count + 1)); }
clear_records
REDIRECT_NEW_DIR="${SCRATCH}/dist/launchstack/${CONSTRUCT}/9.9.13"
REDIRECT_SERVED_RECORD="${SCRATCH}/served/${CONSTRUCT}/9.9.13/publish-check.json"
mkdir -p "${REDIRECT_NEW_DIR}" "$(dirname "${REDIRECT_SERVED_RECORD}")"
cp "${ARTIFACT_DIR}/template.yaml" "${REDIRECT_NEW_DIR}/template.yaml"
redirect_guard() {
  env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:$((PORT + 6))" TEMPLATE_STORE_SCHEME="http" bash launchstack-overwrite-guard.sh
}
# contract: 024-3-3 S10
check "guard passes a new version whose record probe is redirected to a store without the record" 0 redirect_guard
expected_record "${REDIRECT_NEW_DIR}" "${CONSTRUCT}" 9.9.13 > "${REDIRECT_SERVED_RECORD}"
# contract: 024-3-3 S10
check_message "guard refuses a new artifact when the redirected record probe finds its version already recorded" 1 \
  "${CONSTRUCT} 9.9.13 — its publish check is already recorded" redirect_guard
rm -rf "${REDIRECT_NEW_DIR}" "$(dirname "${REDIRECT_SERVED_RECORD}")"
kill "${REDIRECT_PID}" 2>/dev/null

echo "=== apiable-usage-events: its template and module archive are verified and recorded like every construct ==="
UE_CONSTRUCT="apiable-usage-events"
UE_VERSION="$(node -p "require('./lib/usage-events/package.json').version")"
bash synth-launchstack.sh "${UE_CONSTRUCT}" >/dev/null 2>&1 || { echo "  FAIL: could not synthesize ${UE_CONSTRUCT}"; fail_count=$((fail_count + 1)); }
UE_SRC="${SCRATCH}/ue-dist/launchstack"
UE_DIR="${UE_SRC}/${UE_CONSTRUCT}/${UE_VERSION}"
UE_SERVED="${SCRATCH}/served/${UE_CONSTRUCT}/${UE_VERSION}"
mkdir -p "${UE_DIR}" "${UE_SERVED}"
for artifact in template.yaml terraform.zip; do
  cp "dist/launchstack/${UE_CONSTRUCT}/${UE_VERSION}/${artifact}" "${UE_DIR}/${artifact}"
  cp "${UE_DIR}/${artifact}" "${UE_SERVED}/${artifact}"
done
verify_usage_events() {
  env SRC_DIR="${UE_SRC}" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash verify-launchstack-published.sh
}
# contract: 024-3-6 S6
check_message "the usage-events template and module archive fetch anonymously and parse" 0 \
  "${UE_CONSTRUCT}/${UE_VERSION}/terraform.zip" verify_usage_events
expected_record "${UE_DIR}" "${UE_CONSTRUCT}" "${UE_VERSION}" > "${SCRATCH}/ue-expected-record.json"
# contract: 024-3-6 S6
check "one passing record for usage-events lists its template and module archive with their digests" 0 \
  cmp "${UE_DIR}/publish-check.json" "${SCRATCH}/ue-expected-record.json"
ue_record_names_both() {
  python3 -c "
import json, sys
record = json.load(open(sys.argv[1]))
assert [(a['file'], a['kind']) for a in record['artifacts']] == [('template.yaml', 'template'), ('terraform.zip', 'module')], record
" "${UE_DIR}/publish-check.json"
}
# contract: 024-3-6 S6
check "the usage-events record names the template and the module, and nothing else" 0 ue_record_names_both
rm -f "${UE_DIR}/publish-check.json"
python3 -c "
import zipfile
with zipfile.ZipFile('${SCRATCH}/ue-malformed.zip', 'w') as zf:
    zf.writestr('${UE_CONSTRUCT}/main.tf', 'resource \"null_resource\" \"this\" {}\n')
"
cp "${SCRATCH}/ue-malformed.zip" "${UE_DIR}/terraform.zip"
cp "${SCRATCH}/ue-malformed.zip" "${UE_SERVED}/terraform.zip"
# contract: 024-3-6 S6
check_message "a malformed usage-events module archive fails the run, naming it" 1 \
  "main.tf is not at the archive root" verify_usage_events
ue_no_record() {
  [[ ! -e "${UE_DIR}/publish-check.json" ]]
}
# contract: 024-3-6 S6
check "a malformed usage-events module archive records nothing for usage-events" 0 ue_no_record
rm -rf "${UE_SRC}" "${SCRATCH}/served/${UE_CONSTRUCT}"

echo "=== apiable-usage-events: its hand-build set is held to its own shape and recorded under instructions ==="
# The set synth just wrote, beside the published 2.0.0 gateway-role set, in one run: each construct's
# set is held to its own construct's shape.
UE_SET_SRC="${SCRATCH}/ue-set-dist/launchstack"
UE_SET_DIR="${UE_SET_SRC}/${UE_CONSTRUCT}/${UE_VERSION}"
UE_SET_SERVED="${SCRATCH}/served/${UE_CONSTRUCT}/${UE_VERSION}"
UE_SET_KEY="${UE_CONSTRUCT}/${UE_VERSION}/console-instructions.json"
GOOD_UE_SET="${SCRATCH}/ue-set-good.json"
cp "dist/launchstack/${UE_CONSTRUCT}/${UE_VERSION}/console-instructions.json" "${GOOD_UE_SET}"
mkdir -p "${UE_SET_DIR}" "${UE_SET_SERVED}" "${UE_SET_SRC}/apiable-gateway-role/2.0.0" "${SCRATCH}/served/apiable-gateway-role/2.0.0"
cp "${V2_SET}" "${UE_SET_SRC}/apiable-gateway-role/2.0.0/console-instructions.json"
cp "${V2_SET}" "${SCRATCH}/served/apiable-gateway-role/2.0.0/console-instructions.json"
publish_ue_set() {
  cp "$1" "${UE_SET_DIR}/console-instructions.json"
  cp "$1" "${UE_SET_SERVED}/console-instructions.json"
}
verify_ue_set() {
  env SRC_DIR="${UE_SET_SRC}" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash verify-launchstack-published.sh
}
publish_ue_set "${GOOD_UE_SET}"
# contract: 024-3-8 S7
check_message "a good usage-events set fetches anonymously, matches its bytes and parses as a usage-events set" 0 \
  "${UE_SET_KEY}" verify_ue_set
expected_record "${UE_SET_DIR}" "${UE_CONSTRUCT}" "${UE_VERSION}" > "${SCRATCH}/ue-set-expected-record.json"
# contract: 024-3-8 S7
check "the passing record lists the usage-events set under instructions with its digest" 0 \
  cmp "${UE_SET_DIR}/publish-check.json" "${SCRATCH}/ue-set-expected-record.json"
gateway_set_recorded_beside() {
  [[ -e "${UE_SET_SRC}/apiable-gateway-role/2.0.0/publish-check.json" ]]
}
# contract: 024-3-8 S7
check "the gateway role's set in the same run is judged by its own rule and passes" 0 gateway_set_recorded_beside
clear_records

# Writes the good set with one change to $1: a python expression over `doc` (the parsed set) or, with
# a `text:` prefix, a replacement over its serialised text.
ue_set_variant() {
  python3 -c "
import json, sys
out, change = sys.argv[1], sys.argv[2]
text = open(sys.argv[3]).read()
if change.startswith('text:'):
    old, new = change[5:].split('=>')
    open(out, 'w').write(text.replace(old, new))
else:
    doc = json.loads(text)
    exec(change)
    open(out, 'w').write(json.dumps(doc, indent=2) + '\n')
" "$1" "$2" "${GOOD_UE_SET}"
}
ue_set_records_nothing() {
  [[ ! -e "${UE_SET_DIR}/publish-check.json" ]]
}
# Publishes the variant on both sides (so only the shape arm can red), asserts the reason and that no
# record is written, then restores the good set.
refuses_ue_set() {
  local desc="$1" reason="$2" change="$3"
  ue_set_variant "${SCRATCH}/ue-set-variant.json" "${change}"
  publish_ue_set "${SCRATCH}/ue-set-variant.json"
  check_message "${desc}" 1 \
    "${UE_SET_KEY} — local artifact is not a well-formed console instruction set: ${reason}" verify_ue_set
  check "${desc}: no record is written for the version" 0 ue_set_records_nothing
  clear_records
  publish_ue_set "${GOOD_UE_SET}"
}
# contract: 024-3-8 S8
refuses_ue_set "a usage-events set that is not JSON fails closed" "not JSON" "text:\"resources\"=>\"resources"
# contract: 024-3-8 S8
refuses_ue_set "a usage-events set naming another construct fails closed" \
  "names apiable-other@${UE_VERSION} but is published under ${UE_CONSTRUCT}/${UE_VERSION}" "doc['construct'] = 'apiable-other'"
# contract: 024-3-8 S8
refuses_ue_set "a usage-events set naming another version fails closed" \
  "names ${UE_CONSTRUCT}@9.0.0 but is published under ${UE_CONSTRUCT}/${UE_VERSION}" "doc['version'] = '9.0.0'"
# contract: 024-3-8 S8
refuses_ue_set "a usage-events set with an empty list fails closed" "carries no resources" "doc['resources'] = []"
# contract: 024-3-8 S8
for field in kind cfnType identity; do
  refuses_ue_set "a usage-events entry with no ${field} fails closed" "resource 2 carries no ${field}" "del doc['resources'][2]['${field}']"
done
# contract: 024-3-8 S8
refuses_ue_set "a usage-events entry whose document is not an object fails closed" \
  "resource 0 carries no document object" "doc['resources'][0]['document'] = ['not', 'an', 'object']"
# contract: 024-3-8 S8
refuses_ue_set "a usage-events set that records no log-source path fails closed" "records no log-source path" "del doc['documents']"
# contract: 024-3-8 S8
for token in region tenant-name partner-account; do
  refuses_ue_set "a usage-events set already filled in for {${token}} fails closed" \
    "carries no {${token}} token for the portal to fill" "text:{${token}}=>filled-in"
done
# contract: 024-3-8 S8
refuses_ue_set "a usage-events set still carrying a deploy-time reference fails closed" \
  "still carries the deploy-time reference Fn::GetAtt" "doc['resources'][1]['document']['Bucket'] = {'Fn::GetAtt': ['Bucket', 'Arn']}"
# contract: 024-3-8 S8
for token in trust-account external-id; do
  refuses_ue_set "a usage-events set carrying {${token}} fails closed" \
    "carries the token {${token}}, which the portal does not know" "doc['resources'][0]['document']['Note'] = '{${token}}'"
done
# contract: 024-3-8 S8
refuses_ue_set "a usage-events set carrying a twelve-digit account number fails closed" \
  "carries a twelve-digit account number" "doc['resources'][2]['document']['Description'] = 'trusts arn:aws:iam::034444869755:root'"

ue_set_tree() {
  local construct="$1" version="$2" set_file="$3"
  rm -rf "${SCRATCH}/ue-set-alt" "${SCRATCH}/served/${construct}/${version}"
  mkdir -p "${SCRATCH}/ue-set-alt/launchstack/${construct}/${version}" "${SCRATCH}/served/${construct}/${version}"
  cp "${set_file}" "${SCRATCH}/ue-set-alt/launchstack/${construct}/${version}/console-instructions.json"
  cp "${set_file}" "${SCRATCH}/served/${construct}/${version}/console-instructions.json"
}
verify_ue_set_alt() {
  env SRC_DIR="${SCRATCH}/ue-set-alt/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash verify-launchstack-published.sh
}
alt_records_nothing() {
  [[ -z "$(find "${SCRATCH}/ue-set-alt" -name publish-check.json)" ]]
}
ue_set_variant "${SCRATCH}/ue-set-mystery.json" "doc['construct'] = 'apiable-mystery'; doc['version'] = '1.0.0'"
ue_set_tree apiable-mystery 1.0.0 "${SCRATCH}/ue-set-mystery.json"
# contract: 024-3-8 S8
check_message "a console set for a construct with no known shape fails, naming the construct" 1 \
  "no console-set shape is known for apiable-mystery" verify_ue_set_alt
ue_set_variant "${SCRATCH}/ue-set-at-gateway.json" "doc['version'] = '9.8.7'"
ue_set_tree apiable-gateway-role 9.8.7 "${SCRATCH}/ue-set-at-gateway.json"
# contract: 024-3-8 S8
check_message "a well-formed usage-events set at the gateway role's address fails, naming the address and the set's construct" 1 \
  "apiable-gateway-role/9.8.7/console-instructions.json — local artifact is not a well-formed console instruction set: names ${UE_CONSTRUCT}@9.8.7 but is published under apiable-gateway-role/9.8.7" \
  verify_ue_set_alt
# contract: 024-3-8 S8
check "the usage-events set at the gateway role's address records nothing" 0 alt_records_nothing
ue_set_variant "${SCRATCH}/ue-set-1.1.0.json" "doc['version'] = '1.1.0'"
ue_set_tree "${UE_CONSTRUCT}" 1.1.0 "${SCRATCH}/ue-set-1.1.0.json"
# contract: 024-3-8 S8
check_message "a usage-events set at 1.1.0 passes with no {external-id} token" 0 \
  "${UE_CONSTRUCT}/1.1.0/console-instructions.json" verify_ue_set_alt
rm -rf "${SCRATCH}/ue-set-alt" "${SCRATCH}/served/${UE_CONSTRUCT}" "${SCRATCH}/served/apiable-mystery" "${SCRATCH}/served/apiable-gateway-role/9.8.7" "${UE_SET_SRC}"
clear_records

echo "=== 013-1-29 S2: overwrite guard refuses changed content at a published key — same byte size ==="
cp "${ARTIFACT_DIR}/template.yaml" "${SCRATCH}/template.yaml.bak"
python3 -c "
content = open('${ARTIFACT_DIR}/template.yaml').read()
tampered = content.replace(\"'2010-09-09'\", \"'2010-09-08'\")
assert tampered != content and len(tampered) == len(content), 'tamper must change content but preserve length'
open('${ARTIFACT_DIR}/template.yaml', 'w').write(tampered)
"
check "guard refuses same-size changed content (content identity, never size)" 1 \
  env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash launchstack-overwrite-guard.sh
cp "${SCRATCH}/template.yaml.bak" "${ARTIFACT_DIR}/template.yaml"

echo "=== 013-1-29 S2: overwrite guard refuses changed content at a published key — different byte size ==="
printf '# tamper\n' >> "${ARTIFACT_DIR}/template.yaml"
check "guard refuses different-size changed content" 1 \
  env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash launchstack-overwrite-guard.sh
cp "${SCRATCH}/template.yaml.bak" "${ARTIFACT_DIR}/template.yaml"
rm -f "${SCRATCH}/template.yaml.bak"

echo "=== the user pool role as synthesized: each artifact fetched without credentials, and a published version never replaced ==="
# The three artifacts synth-all-launchstack.sh wrote for the user pool role at its current version, in a
# tree of their own and served by the stand-in store.
REAL_POOL_VERSION="$(node -p "require('./lib/cognito-pool-role/package.json').version")"
REAL_POOL_SYNTH="dist/launchstack/apiable-cognito-pool-role/${REAL_POOL_VERSION}"
REAL_POOL_SRC="${SCRATCH}/real-pool/dist/launchstack"
REAL_POOL_DIST="${REAL_POOL_SRC}/apiable-cognito-pool-role/${REAL_POOL_VERSION}"
REAL_POOL_SERVED="${SCRATCH}/served/apiable-cognito-pool-role/${REAL_POOL_VERSION}"
REAL_POOL_ARTIFACTS=(template.yaml terraform.zip console-instructions.json)
mkdir -p "${REAL_POOL_DIST}" "${REAL_POOL_SERVED}"
for artifact in "${REAL_POOL_ARTIFACTS[@]}"; do
  if [[ ! -s "${REAL_POOL_SYNTH}/${artifact}" ]]; then
    echo "  FAIL: ${REAL_POOL_SYNTH}/${artifact} is missing: run synth-all-launchstack.sh first"
    fail_count=$((fail_count + 1))
  fi
  cp "${REAL_POOL_SYNTH}/${artifact}" "${REAL_POOL_DIST}/" 2>/dev/null
done
serve_real_pool() {
  for artifact in "${REAL_POOL_ARTIFACTS[@]}"; do cp "${REAL_POOL_DIST}/${artifact}" "${REAL_POOL_SERVED}/"; done
}
verify_real_pool() {
  env SRC_DIR="${REAL_POOL_SRC}" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash verify-launchstack-published.sh
}
guard_real_pool() {
  env SRC_DIR="${REAL_POOL_SRC}" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash launchstack-overwrite-guard.sh
}
# The guard's stdout is the upload list; $1 is what it must be, one key per line.
guard_real_pool_lists() {
  local listed
  listed="$(guard_real_pool 2>/dev/null)" || return 1
  [[ "${listed}" == "$1" ]] || { echo "the guard listed for upload: '${listed}', expected: '$1'"; return 1; }
}

rm -f "${REAL_POOL_SERVED}"/*
check "a version nothing has published yet lists each of its three artifacts for upload" 0 guard_real_pool_lists \
  "$(printf 'apiable-cognito-pool-role/%s/console-instructions.json\napiable-cognito-pool-role/%s/template.yaml\napiable-cognito-pool-role/%s/terraform.zip' "${REAL_POOL_VERSION}" "${REAL_POOL_VERSION}" "${REAL_POOL_VERSION}")"

serve_real_pool
check "the template, the module and the hand-build set each fetch without credentials and match what was synthesized" 0 verify_real_pool
# The passing run recorded its check beside the artifacts; publishing puts that record in the store too.
cp "${REAL_POOL_DIST}/publish-check.json" "${REAL_POOL_SERVED}/"
check "a version published with the same bytes lists nothing for upload" 0 guard_real_pool_lists ""

rm -f "${REAL_POOL_SERVED}/terraform.zip"
check_message "a release whose module archive cannot be fetched is stopped" 1 \
  "apiable-cognito-pool-role/${REAL_POOL_VERSION}/terraform.zip — anonymous fetch returned 404" \
  verify_real_pool
serve_real_pool

for artifact in "${REAL_POOL_ARTIFACTS[@]}"; do
  cp "${REAL_POOL_DIST}/${artifact}" "${SCRATCH}/real-pool-${artifact}.good"
  printf '\n' >> "${REAL_POOL_DIST}/${artifact}"
  check_message "a published ${artifact} is never replaced by different bytes at the same version" 1 \
    "apiable-cognito-pool-role/${REAL_POOL_VERSION}/${artifact} — already published with DIFFERENT content" \
    guard_real_pool
  cp "${SCRATCH}/real-pool-${artifact}.good" "${REAL_POOL_DIST}/${artifact}"
done

if [[ "${fail_count}" -gt 0 ]]; then
  echo "${fail_count} check(s) failed"
  exit 1
fi
echo "all ${pass} checks passed"
