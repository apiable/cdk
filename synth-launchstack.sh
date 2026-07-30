#!/usr/bin/env bash
#
# Synthesize the versioned launch-stack CloudFormation template for an Apiable construct and write
# it to the per-version, immutable path. Pass the construct's component name (defaults to the
# gateway-role pilot); the package dir is lib/<component-without-the-apiable-prefix>, overridden for
# the shared logs-stream construct whose folder serves both usage-log and api-key-token distributions.
#
# The S3 upload and npm publish are owned by DevOps and run elsewhere; this script proves the
# pipeline locally by producing the exact artifact those steps consume.
set -euo pipefail

cd "$(dirname "$0")"

CONSTRUCT_NAME="${1:-apiable-gateway-role}"
case "${CONSTRUCT_NAME}" in
  apiable-usagelogs-stream | apiable-usagetokens-stream) PKG_DIR="lib/logs-stream" ;;
  *) PKG_DIR="lib/${CONSTRUCT_NAME#apiable-}" ;;
esac
LAUNCHSTACK_BUCKET="${LAUNCHSTACK_BUCKET:-apiable-launchstack-templates}"
VERSION="$(node -p "require('./${PKG_DIR}/package.json').version")"

OUT_DIR="dist/launchstack/${CONSTRUCT_NAME}/${VERSION}"
OUT_FILE="${OUT_DIR}/template.yaml"
mkdir -p "${OUT_DIR}"

# --no-notices is load-bearing, not cosmetic: the template is captured from stdout, and the CLI
# writes its notices advisory to stdout as well whenever it has un-acknowledged notices to show.
# That text lands after the template body and CloudFormation rejects the whole file as malformed
# YAML. A developer box whose notices are already acknowledged never reproduces it.
npx cdk synth --no-notices \
  --app "npx ts-node -r tsconfig-paths/register --prefer-ts-exts scripts/launchstack-app.ts" \
  "${CONSTRUCT_NAME}" > "${OUT_FILE}"

# The published YAML is the only artifact a customer's console parses, and no test reads it — the
# parity specs read the JSON twin below — so assert its well-formedness at the source.
node -e "
  const yaml = require('js-yaml');
  try {
    const doc = yaml.load(require('fs').readFileSync(process.argv[1], 'utf8'));
    if (!doc || typeof doc !== 'object' || !doc.Resources) {
      throw new Error('parsed but carries no Resources — not a CloudFormation template');
    }
  } catch (e) {
    console.error('not a well-formed CloudFormation template: ' + String(e.message).split('\n')[0]);
    process.exit(1);
  }
" "${OUT_FILE}" || { echo "synth wrote an unusable ${OUT_FILE} — refusing to continue" >&2; exit 1; }

# Co-locate the structured JSON twin the parity specs read; JSON scalars never line-fold the way a YAML reader can reject.
cp "cdk.out/${CONSTRUCT_NAME}.template.json" "${OUT_DIR}/template.json"

echo "synthesized: ${OUT_FILE} (+ template.json)"
echo "publish destination (DevOps-owned bucket): s3://${LAUNCHSTACK_BUCKET}/${CONSTRUCT_NAME}/${VERSION}/template.yaml"
