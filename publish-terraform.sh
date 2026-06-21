#!/usr/bin/env bash
#
# Validate an Apiable Terraform module and print the version + git tag it publishes under. Pass the
# construct's component name (defaults to the gateway-role pilot); the version comes from the same
# source the CFN synth reads, so the Terraform and one-click channels move in lockstep.
#
# The git tag push and the module-registry publish are owned by DevOps and run elsewhere; this
# script proves the pipeline locally by validating the module a customer applies.
set -euo pipefail

cd "$(dirname "$0")"

CONSTRUCT_NAME="${1:-apiable-gateway-role}"
case "${CONSTRUCT_NAME}" in
  apiable-gateway-role) VERSION="$(node -p "require('./lib/gateway-role/package.json').version")" ;;
  apiable-logs-bucket) VERSION="$(node -p "require('./lib/logs-bucket/package.json').version")" ;;
  apiable-usagelogs-stream) VERSION="$(node -p "require('./lib/logs-stream/package.json').version")" ;;
  *) echo "unknown construct: ${CONSTRUCT_NAME}" >&2; exit 1 ;;
esac
MODULE_DIR="terraform/${CONSTRUCT_NAME}"
TAG="${CONSTRUCT_NAME}-terraform/v${VERSION}"

terraform -chdir="${MODULE_DIR}" init -backend=false -input=false
terraform -chdir="${MODULE_DIR}" fmt -check
terraform -chdir="${MODULE_DIR}" validate

echo "validated: ${MODULE_DIR}"
echo "publish tag (DevOps-owned): ${TAG}"
