#!/usr/bin/env bash

checkMandatoryParameter () {
  if [ -z "$1" ] && [ -z "$2" ]
    then
      echo $3
      echo "$EXAMPLE"
      exit 0
  fi
}

EXAMPLE="./deploy-cognito.sh 034444869755 eu-central-1 dev no-reply@apiable.io"
checkMandatoryParameter "$1" "$AWS_ACCOUNT_ID" "aws-account-id must be passed as a first parameter or exported through environment variable 'export AWS_ACCOUNT_ID=1234'" && AWS_ACCOUNT_ID=$1
checkMandatoryParameter "$2" "$AWS_REGION" "aws-region must be passed as a second parameter or exported through environment variable 'export AWS_REGION=eu-central-1'" && AWS_REGION=$2
checkMandatoryParameter "$3" "$POOLNAME" "poolname must be passed as a third parameter or exported through environment variable 'export POOLNAME=staging'" && POOLNAME=$3
checkMandatoryParameter "$4" "$FROM_EMAIL" "from email must be passed as a fourth parameter or exported through environment variable 'export FROM_EMAIL=no-reply@apiable.io'" && FROM_EMAIL=$4

CDK_BIN_FILE="bin/apiable-cdk.ts"
rm $CDK_BIN_FILE

cat <<EOT >> $CDK_BIN_FILE
import * as cdk from 'aws-cdk-lib'
import { Cognito } from '../lib/cognito'

const app = new cdk.App()
// eslint-disable-next-line no-new
new Cognito(app, "Cognito", {
    stackName: "auth-portal-$POOLNAME",
    description: "Cognito Pool for Apiable $POOLNAME Portal",
    env: {
        account: "$AWS_ACCOUNT_ID",
        region: "$AWS_REGION",
        name: "$POOLNAME",
        domain: "$POOLNAME.apiable.io",
        fromEmail: "$FROM_EMAIL"
    }
})
EOT
CONTEXT_OPTS="--require-approval never --outputs-file ./cdk-outputs.json"
echo $CONTEXT_OPTS
cdk diff $CONTEXT_OPTS
cdk synth -q $CONTEXT_OPTS
cdk deploy $CONTEXT_OPTS

