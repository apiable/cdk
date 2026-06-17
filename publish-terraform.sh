#!/usr/bin/env bash
#
# Validate the apiable-gateway-role Terraform module and print the version + git tag it
# publishes under. The version comes from the same source the CFN synth reads
# (lib/gateway-role/package.json), so the Terraform and one-click channels move in lockstep.
#
# The git tag push and the module-registry publish are owned by DevOps and run elsewhere;
# this script proves the pipeline locally by validating the module a customer applies.
set -euo pipefail

cd "$(dirname "$0")"

CONSTRUCT_NAME="apiable-gateway-role"
MODULE_DIR="terraform/${CONSTRUCT_NAME}"
VERSION="$(node -p "require('./lib/gateway-role/package.json').version")"
TAG="${CONSTRUCT_NAME}-terraform/v${VERSION}"

terraform -chdir="${MODULE_DIR}" init -backend=false -input=false
terraform -chdir="${MODULE_DIR}" fmt -check
terraform -chdir="${MODULE_DIR}" validate

echo "validated: ${MODULE_DIR}"
echo "publish tag (DevOps-owned): ${TAG}"
