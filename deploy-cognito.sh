#!/usr/bin/env bash

checkMandatoryParameter () {
  if [ -z "$1" ]
    then
      echo $2
      echo "$EXAMPLE"
      exit 0
  fi
}

EXAMPLE="./deploy-cognito.sh 034444869755 eu-central-1 staging no-reply@apiable.io apiable.io"
checkMandatoryParameter "$1" "aws-accountid must be set" && AWS_ACCOUNTID=$1
checkMandatoryParameter "$2" "aws-region must be set" && AWS_REGION=$2
checkMandatoryParameter "$3" "poolname must be set" && STACKNAME=$3
checkMandatoryParameter "$4" "from email must be set" && FROM_EMAIL=$4
checkMandatoryParameter "$5" "ses-verified-domain must be set" && SES_VERIFIED_DOMAIN=$5

CDK_BIN_FILE="bin/apiable-cdk.ts"
rm $CDK_BIN_FILE

cat <<EOT >> $CDK_BIN_FILE
import * as cdk from 'aws-cdk-lib'
import { Cognito } from '../lib/cognito'

const app = new cdk.App()
// eslint-disable-next-line no-new
new Cognito(app, "Cognito", {
    stackName: "auth-portal-$STACKNAME",
    description: "Cognito Pool for Apiable $STACKNAME Portal",
    env: {
        account: "$AWS_ACCOUNTID",
        region: "$AWS_REGION"
    }
})
EOT
CONTEXT_OPTS="--context stackname=$STACKNAME --context from-email=$FROM_EMAIL --context ses-verified-domain=$SES_VERIFIED_DOMAIN --require-approval never --outputs-file ./cdk-outputs.json"
cdk synth -q $CONTEXT_OPTS
cdk deploy $CONTEXT_OPTS

