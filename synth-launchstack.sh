#!/usr/bin/env bash
#
# Synthesize the versioned launch-stack CloudFormation template for an Apiable construct and write
# it to the per-version, immutable path. Pass the construct's component name (defaults to the
# gateway-role pilot); the package dir is lib/<component-without-the-apiable-prefix>.
#
# The S3 upload and npm publish are owned by DevOps and run elsewhere; this script proves the
# pipeline locally by producing the exact artifact those steps consume.
set -euo pipefail

cd "$(dirname "$0")"

CONSTRUCT_NAME="${1:-apiable-gateway-role}"
PKG_DIR="lib/${CONSTRUCT_NAME#apiable-}"
LAUNCHSTACK_BUCKET="${LAUNCHSTACK_BUCKET:-apiable-launchstack-templates}"
VERSION="$(node -p "require('./${PKG_DIR}/package.json').version")"

OUT_DIR="dist/launchstack/${CONSTRUCT_NAME}/${VERSION}"
OUT_FILE="${OUT_DIR}/template.yaml"
mkdir -p "${OUT_DIR}"

npx cdk synth \
  --app "npx ts-node --prefer-ts-exts scripts/launchstack-app.ts" \
  "${CONSTRUCT_NAME}" > "${OUT_FILE}"

echo "synthesized: ${OUT_FILE}"
echo "publish destination (DevOps-owned bucket): s3://${LAUNCHSTACK_BUCKET}/${CONSTRUCT_NAME}/${VERSION}/template.yaml"
