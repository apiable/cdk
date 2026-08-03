#!/usr/bin/env bash
#
# Publish the synthesized launch-stack templates — and any construct's code artifact, e.g. the
# lambda-authorizer's zip (013-1-28: too large for CloudFormation's inline ZipFile) — to the store the
# portal addresses. Run synth-launchstack.sh for every construct first; this script only uploads what
# is on disk.
#
# Key grammar contract: portal/backend/src/main/kotlin/io/apiable/domain/onboarding/
# OnboardingLaunchStackUrlGenerator.kt::templateHttpsUrl — `<construct>/<version>/template.yaml`
# under the bucket; a code artifact publishes alongside it at the same version segment
# (launchStackCodeKey). dist/launchstack/ mirrors both key-for-key, so the upload is a plain sync.
#
# Only template.yaml and *.zip are published. The template.json twin beside a template is an input
# to the parity specs, which read it locally; nothing fetches it over HTTP, so it stays out of the
# public store.
#
# --size-only, not the default mtime comparison: dist/ is gitignored and re-synthesized on every
# run, so every artifact's mtime is newer than the published object and a default sync would
# re-upload all of them every time. A version's bytes never change once published — a fix ships as
# a new version — so size is a sufficient discriminator here, and verify-launchstack-published.sh
# compares the served bytes against the source hash afterwards to catch anything it lets through
# (both artifact kinds' zip/synth steps are byte-deterministic, so an unrelated re-run never drifts).
#
# No --acl: the store serves anonymous reads from its bucket policy, and object ACLs are disabled.
# No --delete: a retired version's object costs cents a year and may be mid-deploy in a customer's
# console; orphans are swept deliberately, never as a side effect of a promotion.
set -euo pipefail

cd "$(dirname "$0")"

LAUNCHSTACK_BUCKET="${LAUNCHSTACK_BUCKET:-apiable-launchstack-templates}"
SRC_DIR="dist/launchstack"

if [[ ! -d "${SRC_DIR}" ]]; then
  echo "no ${SRC_DIR} — run synth-launchstack.sh for each construct first" >&2
  exit 1
fi

# One `aws s3 sync` sets one Content-Type for everything it includes, and the two artifact kinds need
# different ones — so each kind gets its own scoped sync rather than one call with a wrong header.
sync_pattern() {
  local pattern="$1" content_type="$2"
  shift 2
  aws s3 sync "${SRC_DIR}/" "s3://${LAUNCHSTACK_BUCKET}/" \
    --exclude '*' --include "${pattern}" \
    --content-type "${content_type}" \
    --cache-control 'public, max-age=31536000, immutable' \
    --size-only \
    --no-progress \
    "$@"
}

sync_pattern '*template.yaml' 'application/x-yaml'
sync_pattern '*.zip' 'application/zip'

# The pass must be a no-op when nothing changed: a second comparison that still wants to transfer
# something means the sync is not converging, and every promotion would churn the store.
pending=0
pending=$((pending + $(sync_pattern '*template.yaml' 'application/x-yaml' --dryrun | grep -c '^(dryrun)' || true)))
pending=$((pending + $(sync_pattern '*.zip' 'application/zip' --dryrun | grep -c '^(dryrun)' || true)))
if [[ "${pending}" -ne 0 ]]; then
  echo "sync did not converge — ${pending} transfer(s) still pending after publishing" >&2
  exit 1
fi

echo "published ${SRC_DIR}/**/{template.yaml,*.zip} to s3://${LAUNCHSTACK_BUCKET}/ (idempotent: 0 pending transfers)"
