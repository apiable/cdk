#!/usr/bin/env bash
#
# Holds check-gateway-role-module.sh to its purpose, with the real engine: it passes on the module as
# committed, and it fails on each changed copy of the module made below, at the check that is there
# for that change.
#   - Three copies change what the role trusts or grants, and fail the regen check: the trust's
#     Condition commented out, a second trust statement with no condition, a blanket allow added to
#     the permission policy.
#   - Six copies loosen one rule on an input, and fail at the refusal that feeds the module that
#     input: the external_id check made to pass whatever it is given, a wildcard, or a list; the
#     variable given a default, an ID or a blank; the trust_account check made to pass a wildcard.
# So a script that stops making one of its checks fails this test: each refusal, the reason it
# requires of a refusal, and the regen check all have a copy here that has to fail at that check.
#
# Needs terraform and an initialised module, which the parity workflow provides. Each copy shares the
# module's provider plugins through a link, so nothing is downloaded and no cloud account is called.
#
# Usage: bash test-check-gateway-role-module.sh
set -uo pipefail
cd "$(dirname "$0")"

MODULE_DIR="$(pwd)/terraform/apiable-gateway-role"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "${SCRATCH}"' EXIT

pass=0
fail_count=0

# An exit code alone cannot tell a refusal for the right reason from a script that never ran, so
# every case asserts a message too.
expect() {
  local desc="$1" expect_exit="$2" expect_msg="$3" module="$4"
  local out
  out=$(bash check-gateway-role-module.sh "${module}" 2>&1)
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

# Copies the module to ${SCRATCH}/$1 and applies the change of that name to it. The text each change
# replaces must occur exactly once, so a module that has moved on fails here and not silently.
changed_copy() {
  local copy="${SCRATCH}/$1"
  mkdir "${copy}"
  cp "${MODULE_DIR}"/*.tf "${MODULE_DIR}/.terraform.lock.hcl" "${copy}/"
  ln -s "${MODULE_DIR}/.terraform" "${copy}/.terraform"
  python3 - "$1" "${copy}" <<'PY' || { echo "  FAIL: could not make the copy '$1'"; fail_count=$((fail_count + 1)); }
import sys

CONDITION = '        Condition = { StringEquals = { "sts:ExternalId" = var.external_id } }\n'
EXTERNAL_ID_VARIABLE = 'variable "external_id" {\n'
EXTERNAL_ID_CHECK = 'var.external_id))\n'
TRUST_ACCOUNT_CHECK = 'var.trust_account))\n'
CHANGES = {
    'condition-commented-out': ('main.tf', CONDITION, '        # ' + CONDITION.lstrip()),
    'second-trust-statement': (
        'main.tf',
        CONDITION + '      }\n',
        CONDITION + '      },\n      {\n        Effect    = "Allow"\n        Principal = { AWS = "arn:aws:iam::${var.trust_account}:root" }\n        Action    = "sts:AssumeRole"\n      }\n',
    ),
    'blanket-allow': (
        'main.tf',
        '      {\n        Sid    = "ReadRestApisOnly"\n',
        '      {\n        Effect   = "Allow"\n        Action   = "apigateway:*"\n        Resource = "*"\n      },\n      {\n        Sid    = "ReadRestApisOnly"\n',
    ),
    'check-always-passes': ('variables.tf', EXTERNAL_ID_CHECK, 'var.external_id)) || true\n'),
    'check-passes-a-wildcard': ('variables.tf', EXTERNAL_ID_CHECK, 'var.external_id)) || var.external_id == "*"\n'),
    'check-passes-a-list': ('variables.tf', EXTERNAL_ID_CHECK, 'var.external_id)) || length(split(",", var.external_id)) > 1\n'),
    'default-is-an-id': ('variables.tf', EXTERNAL_ID_VARIABLE, EXTERNAL_ID_VARIABLE + '  default = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"\n'),
    'default-is-blank': ('variables.tf', EXTERNAL_ID_VARIABLE, EXTERNAL_ID_VARIABLE + '  default = ""\n'),
    'trust-account-check-passes-a-wildcard': ('variables.tf', TRUST_ACCOUNT_CHECK, 'var.trust_account)) || var.trust_account == "*"\n'),
}

name, copy = sys.argv[1:3]
file, old, new = CHANGES[name]
path = copy + '/' + file
text = open(path).read()
if text.count(old) != 1:
    sys.exit('the text this change replaces occurs %d times in %s' % (text.count(old), file))
open(path, 'w').write(text.replace(old, new))
PY
}

# $1 the changed copy, $2 the message of the check it has to fail at.
fails_at() {
  changed_copy "$1"
  expect "the copy '$1' fails" 1 "$2" "${SCRATCH}/$1"
}

echo "=== the module as committed passes every engine check ==="
expect "the module as committed passes" 0 "the committed fixture reduces to the freshly regenerated plan" "${MODULE_DIR}"

echo "=== a module whose trust or permissions differ from the committed fixture fails the regen check ==="
for name in condition-commented-out second-trust-statement blanket-allow; do
  fails_at "${name}" "the committed terraform fixture is STALE"
done

echo "=== a module with one rule on an input loosened fails at the refusal that feeds it that input ==="
fails_at check-always-passes "expected a blank external_id to be refused, but the plan succeeded"
fails_at check-passes-a-wildcard "expected a wildcard external_id to be refused, but the plan succeeded"
fails_at check-passes-a-list "expected a list of two external IDs to be refused, but the plan succeeded"
fails_at default-is-an-id "expected a plan with no external_id to be refused, but the plan succeeded"
fails_at default-is-blank "a plan with no external_id was refused, but not for the reason expected"
fails_at trust-account-check-passes-a-wildcard "expected a wildcard trust_account to be refused, but the plan succeeded"

if [[ "${fail_count}" -gt 0 ]]; then
  echo "${fail_count} check(s) failed"
  exit 1
fi
echo "all ${pass} checks passed"
