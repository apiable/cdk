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
# (launchStackCodeKey). dist/launchstack/ mirrors both key-for-key, so the upload is a plain sync.
#
# Only template.yaml and *.zip are published. The template.json twin beside a template is an input
# to the parity specs, which read it locally; nothing fetches it over HTTP, so it stays out of the
# public store.
#
# Write-once is enforced by launchstack-overwrite-guard.sh, run below before any upload — it refuses
# the whole publish if any already-published key's content differs from its local artifact, by content
# identity (sha256), never by size. --size-only on the sync calls further down is unrelated to that
# guarantee: it exists only so a byte-identical re-run stays a true no-op, since dist/ is gitignored
# and re-synthesized on every run, so every artifact's mtime is newer than the published object and the
# default mtime comparison would re-upload all of them every time regardless of content.
#
# apiable-lambda-authorizer publishes first, separately: its Function.Code is fetched from this store by
# key with no version pin unless publish-launchstack-authorizer.sh sets one — an unpinned reference
# resolves whatever is `current`, and current moves on any PutObject at that key regardless of whether
# it went through the guard below. That dedicated script re-synthesizes the template pinned to the code
# zip's actual published object version before this script's general sweep ever sees it; by the time the
# guard below runs, that construct's artifacts already match what it just published and are a no-op.
#
# No --acl: the store serves anonymous reads from its bucket policy, and object ACLs are disabled.
# No --delete: a retired version's object costs cents a year and may be mid-deploy in a customer's
# console; orphans are swept deliberately, never as a side effect of a promotion.
set -euo pipefail

cd "$(dirname "$0")"

export LAUNCHSTACK_BUCKET="${LAUNCHSTACK_BUCKET:-apiable-launchstack-templates}"
SRC_DIR="dist/launchstack"

if [[ ! -d "${SRC_DIR}" ]]; then
  echo "no ${SRC_DIR} — run synth-launchstack.sh for each construct first" >&2
  exit 1
fi

bash publish-launchstack-authorizer.sh

if ! bash launchstack-overwrite-guard.sh; then
  echo "publish aborted — overwrite guard refused (see above); no published artifact was touched" >&2
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
