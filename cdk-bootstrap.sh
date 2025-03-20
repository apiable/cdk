#!/usr/bin/env bash

checkMandatoryParameter () {
  if [ -z "$1" ] && [ -z "$2" ]
    then
      echo $3
      echo "$EXAMPLE"
      exit 0
  fi
}

EXAMPLE="./cdk-bootstrap.sh 034444869755 eu-central-1"
checkMandatoryParameter "$1" "$AWS_ACCOUNT_ID" "aws-account-id must be passed as a first parameter or exported through environment variable 'export AWS_ACCOUNT_ID=1234'" && AWS_ACCOUNT_ID=$1
checkMandatoryParameter "$2" "$AWS_REGION" "aws-region must be passed as a second parameter or exported through environment variable 'export AWS_REGION=eu-central-1'" && AWS_REGION=$2

CDK_BIN_FILE="bin/apiable-cdk.ts"
rm $CDK_BIN_FILE


#!/usr/bin/env bash

set -e  # Exit on error

# Check and report script usage
print_usage() {
  echo "Usage: ./cdk-bootstrap.sh <aws-account-id> <aws-region>"
  echo "  or set environment variables:"
  echo "    export AWS_ACCOUNT_ID=1234"
  echo "    export AWS_REGION=eu-central-1"
  echo "    ./cdk-bootstrap.sh"
}

# Check mandatory parameter
checkMandatoryParameter() {
  if [ -z "$1" ] && [ -z "$2" ]; then
    echo "Error: $3"
    print_usage
    exit 1
  fi
}

# Parse parameters
if [ "$1" == "-h" ] || [ "$1" == "--help" ]; then
  print_usage
  exit 0
fi

# Check required parameters
checkMandatoryParameter "$1" "$AWS_ACCOUNT_ID" "aws-account-id must be passed as a first parameter or exported through environment variable 'export AWS_ACCOUNT_ID=1234'"
checkMandatoryParameter "$2" "$AWS_REGION" "aws-region must be passed as a second parameter or exported through environment variable 'export AWS_REGION=eu-central-1'"

# Set parameters
AWS_ACCOUNT_ID=${1:-$AWS_ACCOUNT_ID}
AWS_REGION=${2:-$AWS_REGION}

echo "Using AWS Account ID: $AWS_ACCOUNT_ID"
echo "Using AWS Region: $AWS_REGION"

# Ensure bin directory exists
BIN_DIR="bin"
if [ ! -d "$BIN_DIR" ]; then
  echo "Creating bin directory..."
  mkdir -p "$BIN_DIR"
fi

# Create CDK bootstrap file
CDK_BIN_FILE="$BIN_DIR/apiable-cdk.ts"
echo "Creating CDK bootstrap file: $CDK_BIN_FILE"

if [ -f "$CDK_BIN_FILE" ]; then
  echo "Removing existing file..."
  rm "$CDK_BIN_FILE"
fi

# Generate CDK bootstrap file
cat <<EOT >> "$CDK_BIN_FILE"
import * as cdk from 'aws-cdk-lib'
import { GatewayRole } from '../lib/gatewayrole'

const app = new cdk.App()
// eslint-disable-next-line no-new
new GatewayRole(app, "GatewayRole", {
    stackName: "gatewayrole",
    description: "Gateway Management Role for Apiable",
    env: {
        account: "$AWS_ACCOUNT_ID",
        region: "$AWS_REGION"
    }
})
EOT

# Run CDK commands
CONTEXT_OPTS="--context stackname=cdk-bootstrap --require-approval never --outputs-file ./cdk-outputs.json"
echo "Running CDK diff..."
cdk diff $CONTEXT_OPTS || { echo "CDK diff failed"; exit 1; }

echo "Running CDK bootstrap..."
cdk bootstrap $CONTEXT_OPTS || { echo "CDK bootstrap failed"; exit 1; }

echo "CDK bootstrap completed successfully!"
cat <<EOT >> $CDK_BIN_FILE
import * as cdk from 'aws-cdk-lib'
import { GatewayRole } from '../lib/gatewayrole'

const app = new cdk.App()
// eslint-disable-next-line no-new
new GatewayRole(app, "GatewayRole", {
    stackName: "gatewayrole",
    description: "Gateway Management Role for Apiable",
    env: {
        account: "$AWS_ACCOUNT_ID",
        region: "$AWS_REGION"
    }
})
EOT
CONTEXT_OPTS="--context stackname=cdk-bootstrap --require-approval never --outputs-file ./cdk-outputs.json"
echo "cdk bootstrap $CONTEXT_OPTS"
cdk diff $CONTEXT_OPTS
cdk bootstrap $CONTEXT_OPTS

