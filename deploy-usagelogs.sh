#!/usr/bin/env bash

checkMandatoryParameter () {
  if [ -z "$1" ] && [ -z "$2" ]
    then
      echo $3
      echo "$EXAMPLE"
      exit 0
  fi
}

EXAMPLE="./deploy-usagelogs.sh 034444869755 eu-central-1"
checkMandatoryParameter "$1" "$AWS_ACCOUNT_ID" "aws-account-id must be passed as a first parameter or exported through environment variable 'export AWS_ACCOUNT_ID=1234'" && AWS_ACCOUNT_ID=$1
checkMandatoryParameter "$2" "$AWS_REGION" "aws-region must be passed as a second parameter or exported through environment variable 'export AWS_REGION=eu-central-1'" && AWS_REGION=$2
checkMandatoryParameter "$3" "$STACKNAME" "stackname must be passed as a third parameter or exported through environment variable 'export STACKNAME=staging'" && STACKNAME=$3

CDK_BIN_FILE="bin/apiable-cdk.ts"
rm $CDK_BIN_FILE

cat <<EOT >> $CDK_BIN_FILE
import * as cdk from 'aws-cdk-lib'
import { UsageLogs } from '../lib/usagelogs'

const app = new cdk.App()
// eslint-disable-next-line no-new
new UsageLogs(app, "UsageLogs", {
    stackName: "usagelogs-apiable-$STACKNAME"",
    description: "Usage Logs for Apiable Portal $STACKNAME"",
    env: {
        account: "$AWS_ACCOUNT_ID",
        region: "$AWS_REGION"
    }
})
EOT
CONTEXT_OPTS="--require-approval never --outputs-file ./cdk-outputs.json"
echo $CONTEXT_OPTS
cdk diff $CONTEXT_OPTS
cdk synth -q $CONTEXT_OPTS
cdk deploy $CONTEXT_OPTS

