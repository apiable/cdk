#!/usr/bin/env bash
#
# The engine checks on the gateway-role Terraform module, run with the real engine on the directory
# it is given, which must already be initialised:
#   - a wildcard trust_account is refused,
#   - an external_id that is missing, blank, a wildcard or a list is refused,
#   - the committed plan fixture the parity specs read still reduces to a fresh plan of the module.
# The parity workflow and the publish job both call this one script, so the module that is archived
# is held to the same checks as the module that was compared.
#
# No cloud account is called: every plan runs without a refresh, under a provider override that skips
# credential validation, the account lookup and the metadata service. The provider still wants keys
# to be present, so the caller sets placeholder ones for this script alone.
#
# Usage: bash check-gateway-role-module.sh <module-dir>
set -euo pipefail

if [[ $# -ne 1 || ! -d "$1" ]]; then
  echo "usage: check-gateway-role-module.sh <module-dir>" >&2
  exit 2
fi
MODULE_DIR="$(cd "$1" && pwd)"
cd "$(dirname "$0")"

REGION="${AWS_REGION:-eu-central-1}"
FIXTURE="test/fixtures/parity-gate/terraform-gateway-role-show.json"
EXTERNAL_ID="a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
OTHER_EXTERNAL_ID="f6e5d4c3-b2a1-4c8d-9e0f-5d4c3b2a1f0e"

WORK="$(mktemp -d)"
OVERRIDE="${MODULE_DIR}/ci_provider_override.tf"
cleanup() {
  rm -f "${OVERRIDE}"
  rm -rf "${WORK}"
}
trap cleanup EXIT

cat > "${OVERRIDE}" <<EOF
provider "aws" {
  region                      = "${REGION}"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
}
EOF

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

refused "a wildcard trust_account" "12-digit AWS account id" \
  -var "region=${REGION}" -var "external_id=${EXTERNAL_ID}" -var 'trust_account=*'
refused "a plan with no external_id" "No value for required variable" \
  -var "region=${REGION}"
refused "a blank external_id" "lowercase version 4 UUID" \
  -var "region=${REGION}" -var 'external_id='
refused "a wildcard external_id" "lowercase version 4 UUID" \
  -var "region=${REGION}" -var 'external_id=*'
refused "a list of two external IDs" "lowercase version 4 UUID" \
  -var "region=${REGION}" -var "external_id=${EXTERNAL_ID},${OTHER_EXTERNAL_ID}"

# The fresh plan is compared with the committed fixture by meaning, never byte for byte.
plan -var "region=${REGION}" -var trust_account=034444869755 -var "external_id=${EXTERNAL_ID}" -out="${WORK}/tfplan.bin" >/dev/null
terraform -chdir="${MODULE_DIR}" show -json "${WORK}/tfplan.bin" > "${WORK}/tf-show.json"
npx ts-node scripts/parity-tf-regen-check.ts "${WORK}/tf-show.json" "${FIXTURE}" "${REGION}"
