#!/usr/bin/env bash
#
# Publishes the apiable-lambda-authorizer construct's code + template as a PINNED pair: the published
# template's Function.Code.S3ObjectVersion is set to the code zip's actual published S3 object version,
# so a customer's deploy resolves the specific vetted bytes regardless of what any later PutObject makes
# `current` at that key — the overwrite guard and the bucket's Object Lock protect prior versions from
# deletion or retention-bypass, but neither one stops a new version from being written and becoming
# current, which is the gap this pin closes for the one construct whose code is fetched from this store.
#
# Self-contained by design: synth → guard+publish the code zip alone → read back its now-current object
# version → re-synth the template with that pin → guard+publish the template. All within one process, so
# there is no cross-CI-step env var handoff to get wrong. publish-launchstack.sh calls this before its
# own general sweep; the general sweep's guard then sees this construct's artifacts as already published
# and byte-identical, and skips them (no double-publish, no conflicting write).
set -euo pipefail

cd "$(dirname "$0")"

CONSTRUCT_NAME="apiable-lambda-authorizer"
# Exported (not just set) so a caller's override reaches launchstack-overwrite-guard.sh and
# launchstack-read-object-version.sh below — both read the identical override contract from their own
# environment, and both run as child processes of this script.
export LAUNCHSTACK_BUCKET="${LAUNCHSTACK_BUCKET:-apiable-launchstack-templates}"
export TEMPLATE_STORE_HOST="${TEMPLATE_STORE_HOST:-${LAUNCHSTACK_BUCKET}.s3.amazonaws.com}"
# Overridable only so a local test double (no TLS) can stand in for the real store; the real store is
# always https, so this must never be set in CI or by an operator against the genuine bucket.
export TEMPLATE_STORE_SCHEME="${TEMPLATE_STORE_SCHEME:-https}"

# Phase 1: synth unpinned. This is what produces the deterministic zip; the template.yaml it also writes
# here is a throwaway, unconditionally overwritten pinned in Phase 3 below.
bash synth-launchstack.sh "${CONSTRUCT_NAME}"

VERSION="$(node -p "require('./lib/lambda-authorizer/package.json').version")"
CODE_KEY="${CONSTRUCT_NAME}/${VERSION}/authorizer.zip"

# Phase 2: guard + publish the code zip alone, ahead of the template — the template synthesized in
# Phase 3 must reference an object version that already exists on the store.
if ! bash launchstack-overwrite-guard.sh; then
  echo "publish-launchstack-authorizer.sh: aborted — overwrite guard refused (see above)" >&2
  exit 1
fi
aws s3 sync "dist/launchstack/${CONSTRUCT_NAME}/" "s3://${LAUNCHSTACK_BUCKET}/${CONSTRUCT_NAME}/" \
  --exclude '*' --include '*.zip' \
  --content-type 'application/zip' \
  --cache-control 'public, max-age=31536000, immutable' \
  --size-only \
  --no-progress

# Phase 3: read back the code zip's now-current object version — correct whether it was just uploaded
# above or was already published byte-identical (the guard made this run a no-op), since either way this
# is the version a pinned template must reference.
code_object_version="$(bash launchstack-read-object-version.sh "${CODE_KEY}")" || {
  echo "publish-launchstack-authorizer.sh: could not determine the code object version to pin — aborting" >&2
  exit 1
}

LAUNCHSTACK_CODE_OBJECT_VERSION="${code_object_version}" bash synth-launchstack.sh "${CONSTRUCT_NAME}"

if ! bash launchstack-overwrite-guard.sh; then
  echo "publish-launchstack-authorizer.sh: aborted — overwrite guard refused the pinned template (see above)" >&2
  exit 1
fi
aws s3 sync "dist/launchstack/${CONSTRUCT_NAME}/" "s3://${LAUNCHSTACK_BUCKET}/${CONSTRUCT_NAME}/" \
  --exclude '*' --include '*template.yaml' \
  --content-type 'application/x-yaml' \
  --cache-control 'public, max-age=31536000, immutable' \
  --size-only \
  --no-progress

echo "published ${CONSTRUCT_NAME}/${VERSION} pinned to code object version ${code_object_version}"
