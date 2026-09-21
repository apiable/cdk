#!/usr/bin/env bash
#
# Synthesize the versioned launch-stack artifacts for an Apiable construct and write them to the
# per-version, immutable path: the CloudFormation template, the Terraform module archive for a
# construct with a module under terraform/, and for the gateway role the hand-build console
# instruction set. Pass the construct's component name (defaults to the gateway-role pilot); the
# package dir is lib/<component-without-the-apiable-prefix>, overridden for the shared logs-stream
# construct whose folder serves both usage-log and api-key-token distributions.
#
# The S3 upload and npm publish are owned by DevOps and run elsewhere; this script proves the
# pipeline locally by producing the exact artifacts those steps consume.
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

publish_destination() {
  echo "publish destination (DevOps-owned bucket): s3://${LAUNCHSTACK_BUCKET}/${CONSTRUCT_NAME}/${VERSION}/$1"
}

# A plain `zip` embeds each entry's mtime and Unix permission bits, so re-zipping unchanged source on
# a later run (or after a fresh git checkout, which does not preserve original mtimes) would produce
# different bytes even though the content is identical — and the publish/verify write-once discipline
# hashes these artifacts, so spurious byte drift would either wrongly re-publish or wrongly fail-closed.
# Python's zipfile gives explicit control over both (fixed date_time, fixed external_attr) without
# reimplementing the zip format by hand; every GitHub-hosted Ubuntu runner ships python3 alongside zip.
# The files to include arrive as NUL-separated paths on stdin and are stored relative to the root dir.
write_deterministic_zip() {
  local root_dir="$1" out_zip="$2"
  command -v python3 >/dev/null 2>&1 || { echo "python3 is required to build a deterministic ${out_zip}" >&2; exit 1; }
  python3 -c "
import os, sys, zipfile
root_dir, out_zip = sys.argv[1], sys.argv[2]
paths = sorted(p.decode() for p in sys.stdin.buffer.read().split(b'\0') if p)
if not paths:
    sys.exit('no files to zip into ' + out_zip)
with zipfile.ZipFile(out_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
    for full in paths:
        info = zipfile.ZipInfo(os.path.relpath(full, root_dir).replace(os.sep, '/'), date_time=(2020, 1, 1, 0, 0, 0))
        info.external_attr = 0o644 << 16
        with open(full, 'rb') as f:
            zf.writestr(info, f.read())
" "${root_dir}" "${out_zip}"
}

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
publish_destination template.yaml

# apiable-lambda-authorizer's handler (8,635 B) is too large for CloudFormation's inline ZipFile (the
# 4,096-byte cap), so its published template references a code artifact in this same store instead of
# Apiable's private CDK asset-staging bucket a customer account cannot read (see launchStackCodeKey).
# Zips the same directory the construct's Lambda code references (handler + vendored node_modules) —
# the deployed code is identical; only where it lives moves.
if [[ "${CONSTRUCT_NAME}" == "apiable-lambda-authorizer" ]]; then
  CODE_SRC_DIR="lib/assets/lambdas/authorization-cc"
  CODE_ZIP="${OUT_DIR}/authorizer.zip"
  find "${CODE_SRC_DIR}" -type f -print0 | write_deterministic_zip "${CODE_SRC_DIR}" "${CODE_ZIP}"
  echo "zipped: ${CODE_ZIP} (deterministic, from ${CODE_SRC_DIR})"
  publish_destination authorizer.zip
fi

# The Terraform channel ships the module as an archive at the same versioned address as the template:
# Terraform and OpenTofu fetch a zip URL as a module source with no registry and no credentials, and
# the version lives in the path rather than in a `version` argument an archive source cannot take.
# Only tracked files ship — a local `terraform init` leaves .terraform/ and a lock file beside the
# module, and the parity workflow writes plan output there; none of that is the module a customer
# applies. A root module without main.tf at the archive root fails `terraform init`, so it is refused.
MODULE_DIR="terraform/${CONSTRUCT_NAME}"
if [[ -d "${MODULE_DIR}" ]]; then
  MODULE_ZIP="${OUT_DIR}/terraform.zip"
  git ls-files --error-unmatch -- "${MODULE_DIR}/main.tf" >/dev/null 2>&1 \
    || { echo "${MODULE_DIR} has no tracked main.tf — not a root module that can be published" >&2; exit 1; }
  git ls-files -z -- "${MODULE_DIR}" | write_deterministic_zip "${MODULE_DIR}" "${MODULE_ZIP}"
  echo "zipped: ${MODULE_ZIP} (deterministic, tracked files of ${MODULE_DIR})"
  publish_destination terraform.zip
else
  echo "no ${MODULE_DIR} — ${CONSTRUCT_NAME} publishes no Terraform module archive"
fi

# The hand-build console channel publishes the generator's template-mode set beside the template, so
# the portal serves the instruction set the release-time parity gate compared — never a copy of it.
if [[ "${CONSTRUCT_NAME}" == "apiable-gateway-role" ]]; then
  CONSOLE_FILE="${OUT_DIR}/console-instructions.json"
  npx ts-node -r tsconfig-paths/register --prefer-ts-exts scripts/console-instructions-publish.ts \
    "${OUT_DIR}/template.json" "${VERSION}" "${CONSOLE_FILE}"
  publish_destination console-instructions.json
fi
