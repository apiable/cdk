#!/usr/bin/env bash
#
# The engine checks on the user pool role Terraform module, run with the real engine on the directory
# it is given, which must already be initialised:
#   - a wildcard trust_account is refused,
#   - an external_id that is missing, blank, a wildcard or a list is refused,
#   - a user_pool_id that is missing or malformed is refused, and one from another region than the
#     role's is refused before any role is planned,
#   - the committed plan fixture the parity specs read still reduces to a fresh plan of the module.
#
# No cloud account is called. The module reads the deploying account, so the provider's STS endpoint
# is pointed at a local stand-in that answers that one question with a placeholder account; every plan
# runs without a refresh, and the provider still wants keys to be present, so placeholder ones are set
# for this script alone.
#
# Usage: bash check-cognito-pool-role-module.sh <module-dir>
set -euo pipefail

if [[ $# -ne 1 || ! -d "$1" ]]; then
  echo "usage: check-cognito-pool-role-module.sh <module-dir>" >&2
  exit 2
fi
MODULE_DIR="$(cd "$1" && pwd)"
cd "$(dirname "$0")"

REGION="${AWS_REGION:-eu-central-1}"
FIXTURE="test/fixtures/parity-gate/terraform-cognito-pool-role-show.json"
EXTERNAL_ID="a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
OTHER_EXTERNAL_ID="f6e5d4c3-b2a1-4c8d-9e0f-5d4c3b2a1f0e"
USER_POOL_ID="${REGION}_AbCdEfGhI"
PLACEHOLDER_ACCOUNT="111122223333"
# Placeholder keys always, whatever the caller's environment holds, so no real credential is ever used.
export AWS_ACCESS_KEY_ID=testing
export AWS_SECRET_ACCESS_KEY=testing
unset AWS_SESSION_TOKEN AWS_PROFILE

WORK="$(mktemp -d)"
OVERRIDE="${MODULE_DIR}/ci_provider_override.tf"
STUB_PID=""
cleanup() {
  [[ -n "${STUB_PID}" ]] && kill "${STUB_PID}" 2>/dev/null
  rm -f "${OVERRIDE}"
  rm -rf "${WORK}"
}
trap cleanup EXIT

# The STS stand-in: every request is answered as GetCallerIdentity for the placeholder account.
python3 - "${WORK}/port" "${PLACEHOLDER_ACCOUNT}" <<'PY' &
import http.server, sys
port_file, account = sys.argv[1], sys.argv[2]
body = (
    '<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetCallerIdentityResult>'
    f'<Arn>arn:aws:iam::{account}:user/ci</Arn><UserId>AIDACI</UserId><Account>{account}</Account>'
    '</GetCallerIdentityResult><ResponseMetadata><RequestId>ci</RequestId></ResponseMetadata></GetCallerIdentityResponse>'
).encode()
class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length') or 0))
        self.send_response(200)
        self.send_header('Content-Type', 'text/xml')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args):
        pass
server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
with open(port_file, 'w') as f:
    f.write(str(server.server_address[1]))
server.serve_forever()
PY
STUB_PID=$!
disown "${STUB_PID}"
for _ in $(seq 1 50); do [[ -s "${WORK}/port" ]] && break; sleep 0.1; done
[[ -s "${WORK}/port" ]] || { echo "the STS stand-in did not start" >&2; exit 1; }

cat > "${OVERRIDE}" <<EOF2
provider "aws" {
  region                      = "${REGION}"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
  endpoints {
    sts = "http://127.0.0.1:$(cat "${WORK}/port")"
  }
}
EOF2

plan() {
  terraform -chdir="${MODULE_DIR}" plan -input=false -refresh=false -no-color "$@"
}

# A plan that has to fail, and for the stated reason. The engine wraps its diagnostics and prefixes
# every line of them, so the output is folded to one line before the reason is looked for.
refused() {
  local what="$1" reason="$2"
  shift 2
  if plan "$@" >/dev/null 2>"${WORK}/plan-err.log"; then
    echo "expected ${what} to be refused, but the plan succeeded" >&2
    exit 1
  fi
  local folded
  folded="$(sed 's/^[^[:alnum:]]*//' "${WORK}/plan-err.log" | tr '\n' ' ' | tr -s ' ')"
  if [[ "${folded}" != *"${reason}"* ]]; then
    echo "${what} was refused, but not for the reason expected (${reason}):" >&2
    cat "${WORK}/plan-err.log" >&2
    exit 1
  fi
  echo "refused, as it must be: ${what}"
}

POOL=(-var "region=${REGION}" -var "user_pool_id=${USER_POOL_ID}")
refused "a wildcard trust_account" "12-digit AWS account id" \
  "${POOL[@]}" -var "external_id=${EXTERNAL_ID}" -var 'trust_account=*'
refused "a plan with no external_id" "No value for required variable" \
  "${POOL[@]}"
refused "a blank external_id" "lowercase version 4 UUID" \
  "${POOL[@]}" -var 'external_id='
refused "a wildcard external_id" "lowercase version 4 UUID" \
  "${POOL[@]}" -var 'external_id=*'
refused "a list of two external IDs" "lowercase version 4 UUID" \
  "${POOL[@]}" -var "external_id=${EXTERNAL_ID},${OTHER_EXTERNAL_ID}"
refused "a plan with no user_pool_id" "No value for required variable" \
  -var "region=${REGION}" -var "external_id=${EXTERNAL_ID}"
refused "a malformed user_pool_id" "must be one user pool id" \
  -var "region=${REGION}" -var "external_id=${EXTERNAL_ID}" -var 'user_pool_id=*'
refused "a user_pool_id from another region" "user pool in the region the role is for" \
  -var "region=${REGION}" -var "external_id=${EXTERNAL_ID}" -var 'user_pool_id=us-west-2_AbCdEfGhI'

# The fresh plan is compared with the committed fixture by meaning, never byte for byte.
plan "${POOL[@]}" -var trust_account=034444869755 -var "external_id=${EXTERNAL_ID}" -out="${WORK}/tfplan.bin" >/dev/null
terraform -chdir="${MODULE_DIR}" show -json "${WORK}/tfplan.bin" > "${WORK}/tf-show.json"
if [[ "${WRITE_FIXTURE:-}" == "1" ]]; then
  cp "${WORK}/tf-show.json" "${FIXTURE}"
  echo "wrote ${FIXTURE}"
fi
npx ts-node scripts/parity-tf-regen-check.ts "${WORK}/tf-show.json" "${FIXTURE}" "${REGION}"
