#!/usr/bin/env bash
#
# Publish the synthesized launch-stack templates — and any construct's code artifact, e.g. the
# lambda-authorizer's zip (too large for CloudFormation's inline ZipFile) — to the store the portal
# addresses. Run synth-launchstack.sh for every construct first; this script only uploads what is on
# disk.
#
# Key grammar contract: portal/backend/src/main/kotlin/io/apiable/domain/onboarding/
# OnboardingLaunchStackUrlGenerator.kt::templateHttpsUrl — `<construct>/<version>/template.yaml`
# under the bucket; a code artifact publishes alongside it at the same version segment
# (launchStackCodeKey). dist/launchstack/ mirrors both key-for-key.
#
# Only template.yaml and *.zip are published. The template.json twin beside a template is an input
# to the parity specs, which read it locally; nothing fetches it over HTTP, so it stays out of the
# public store.
#
# Write-once has two independent layers, and this script is only the first: launchstack-overwrite-
# guard.sh decides, per artifact, whether it is new (upload) or already published byte-identical
# (skip) — it refuses the whole publish if any already-published key differs from its local artifact,
# by content identity (sha256), never by size. Every upload this script performs for a NEW key also
# carries `--if-none-match '*'`, so the store itself refuses the write if the key was created by
# anything else between the guard's check and this PutObject — and the bucket policy's conditional-
# write enforcement (infra) independently requires that header on every PutObject to this bucket,
# closing the guard-bypass gap a raw API call using the publishing credentials would otherwise have:
# no caller, guarded or not, can ever create a second version at an already-populated key.
#
# No --acl: the store serves anonymous reads from its bucket policy, and object ACLs are disabled.
# No delete: a retired version's object costs cents a year and may be mid-deploy in a customer's
# console; orphans are swept deliberately, never as a side effect of a promotion.
set -euo pipefail

cd "$(dirname "$0")"

export LAUNCHSTACK_BUCKET="${LAUNCHSTACK_BUCKET:-apiable-launchstack-templates}"
SRC_DIR="dist/launchstack"

if [[ ! -d "${SRC_DIR}" ]]; then
  echo "no ${SRC_DIR} — run synth-launchstack.sh for each construct first" >&2
  exit 1
fi

# The `||` (not a bare assignment) is deliberate: a plain `var=$(cmd)` under `set -e` does not reliably
# abort on `cmd`'s failure across bash versions, but a command that is the left side of `||` is an
# explicit, unambiguous exemption — so the failure is always caught here, not silently ignored.
guard_output=$(bash launchstack-overwrite-guard.sh) || {
  echo "publish aborted — overwrite guard refused (see above); no published artifact was touched" >&2
  exit 1
}

NEW_ARTIFACTS=()
while IFS= read -r key; do
  [[ -n "${key}" ]] && NEW_ARTIFACTS+=("${key}")
done <<< "${guard_output}"

if [[ ${#NEW_ARTIFACTS[@]} -eq 0 ]]; then
  echo "published ${SRC_DIR}/**/{template.yaml,*.zip} to s3://${LAUNCHSTACK_BUCKET}/ (idempotent: 0 new artifacts)"
  exit 0
fi

for key in "${NEW_ARTIFACTS[@]}"; do
  src="${SRC_DIR}/${key}"
  case "${key}" in
    *.zip) content_type="application/zip" ;;
    *) content_type="application/x-yaml" ;;
  esac
  aws s3api put-object \
    --bucket "${LAUNCHSTACK_BUCKET}" \
    --key "${key}" \
    --body "${src}" \
    --content-type "${content_type}" \
    --cache-control 'public, max-age=31536000, immutable' \
    --if-none-match '*' \
    >/dev/null
  echo "published ${key}"
done

echo "published ${#NEW_ARTIFACTS[@]} new artifact(s) to s3://${LAUNCHSTACK_BUCKET}/"
