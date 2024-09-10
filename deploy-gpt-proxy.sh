#!/usr/bin/env bash

checkMandatoryParameter () {
  if [ -z "$1" ] && [ -z "$2" ]
    then
      echo $3
      echo "$EXAMPLE"
      exit 0
  fi
}

EXAMPLE="./deploy-gpt-proxy.sh 034444869755 eu-west-2 dev $API_KEY apikey_76djf6HGgf6jG6jh46Hghffi"
checkMandatoryParameter "$1" "$AWS_ACCOUNT_ID" "aws-account-id must be passed as a first parameter or exported through environment variable 'export AWS_ACCOUNT_ID=1234'" && AWS_ACCOUNT_ID=$1
checkMandatoryParameter "$2" "$AWS_REGION" "aws-region must be passed as a second parameter or exported through environment variable 'export AWS_REGION=eu-central-1'" && AWS_REGION=$2
checkMandatoryParameter "$3" "$STACKNAME" "stackname must be passed as a third parameter or exported through environment variable 'export STACKNAME=staging'" && STACKNAME=$3
checkMandatoryParameter "$4" "$APIKEY" "apikey must be passed as a fourth parameter or exported through environment variable 'export APIKEY=1234'" && APIKEY=$4
checkMandatoryParameter "$5" "$ASSISTANT_ID" "assistant-id must be passed as a fifth parameter or exported through environment variable 'export ASSISTANT_ID=1234'" && ASSISTANT_ID=$5

CDK_BIN_FILE="bin/apiable-cdk.ts"
rm $CDK_BIN_FILE

cat <<EOT >> $CDK_BIN_FILE
import * as cdk from 'aws-cdk-lib'
import { GptProxy } from '../lib/gpt-proxy'

const app = new cdk.App()
// eslint-disable-next-line no-new
new GptProxy(app, "GptProxy", {
    stackName: "$STACKNAME-gpt-proxy",
    description: "Gpt Proxy to connect to chatGpt Engine $STACKNAME and write proper log stream for billing",
    env: {
        account: "$AWS_ACCOUNT_ID",
        region: "$AWS_REGION",
        apikey: "$APIKEY",
        stackname: "$STACKNAME",
        assistantId: "$ASSISTANT_ID"
    }
})
EOT
CONTEXT_OPTS="--require-approval never --outputs-file ./cdk-outputs.json"
echo $CONTEXT_OPTS
cdk diff $CONTEXT_OPTS
cdk synth -q $CONTEXT_OPTS
cdk deploy $CONTEXT_OPTS

