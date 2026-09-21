#!/usr/bin/env bash
#
# Validate an Apiable Terraform module with the real engine — the init, fmt-check and validate steps
# cdk's publish job runs before synth-launchstack.sh archives the module. Pass the construct's
# component name (defaults to the gateway-role pilot); the version comes from the same source the
# CFN synth reads, so the Terraform and one-click channels move in lockstep.
#
# The module publishes through the launch-stack store, as <construct>/<version>/terraform.zip beside
# the template: synth-launchstack.sh writes the archive, publish-launchstack.sh uploads it and
# verify-launchstack-published.sh proves it fetches anonymously. Never through a git tag or a
# module registry.
set -euo pipefail

cd "$(dirname "$0")"

CONSTRUCT_NAME="${1:-apiable-gateway-role}"
case "${CONSTRUCT_NAME}" in
  apiable-gateway-role) VERSION="$(node -p "require('./lib/gateway-role/package.json').version")" ;;
  apiable-logs-bucket) VERSION="$(node -p "require('./lib/logs-bucket/package.json').version")" ;;
  apiable-cognito-pool) VERSION="$(node -p "require('./lib/cognito-pool/package.json').version")" ;;
  apiable-lambda-authorizer) VERSION="$(node -p "require('./lib/lambda-authorizer/package.json').version")" ;;
  apiable-usagelogs-stream | apiable-usagetokens-stream) VERSION="$(node -p "require('./lib/logs-stream/package.json').version")" ;;
  *) echo "unknown construct: ${CONSTRUCT_NAME}" >&2; exit 1 ;;
esac
MODULE_DIR="terraform/${CONSTRUCT_NAME}"

terraform -chdir="${MODULE_DIR}" init -backend=false -input=false
terraform -chdir="${MODULE_DIR}" fmt -check
terraform -chdir="${MODULE_DIR}" validate

echo "validated: ${MODULE_DIR} — archived by synth-launchstack.sh as ${CONSTRUCT_NAME}/${VERSION}/terraform.zip"
