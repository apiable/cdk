#!/usr/bin/env bash
#
# Synthesize the versioned launch-stack CloudFormation template for the
# apiable-gateway-role construct and write it to the per-version, immutable path.
#
# The S3 upload and npm publish are owned by DevOps and run elsewhere; this script
# proves the pipeline locally by producing the exact artifact those steps consume.
set -euo pipefail

cd "$(dirname "$0")"

CONSTRUCT_NAME="apiable-gateway-role"
LAUNCHSTACK_BUCKET="${LAUNCHSTACK_BUCKET:-apiable-launchstack-templates}"
VERSION="$(node -p "require('./lib/gateway-role/package.json').version")"

OUT_DIR="dist/launchstack/${CONSTRUCT_NAME}/${VERSION}"
OUT_FILE="${OUT_DIR}/template.yaml"
mkdir -p "${OUT_DIR}"

npx cdk synth \
  --app "npx ts-node --prefer-ts-exts scripts/launchstack-app.ts" \
  "${CONSTRUCT_NAME}" > "${OUT_FILE}"

echo "synthesized: ${OUT_FILE}"
echo "publish destination (DevOps-owned bucket): s3://${LAUNCHSTACK_BUCKET}/${CONSTRUCT_NAME}/${VERSION}/template.yaml"
