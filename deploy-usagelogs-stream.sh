#!/usr/bin/env bash

source _deploy.sh

export EXAMPLE="./deploy-usagelogs-stream.sh 034444869755 eu-west-3 arn:aws:s3:::apiable-logs-staging staging"

checkMandatoryParameter "$1" "$AWS_ACCOUNT_ID" "-" "aws-account-id must be passed as a first parameter or exported through environment variable 'export AWS_ACCOUNT_ID=1234'" && AWS_ACCOUNT_ID=$1
checkMandatoryParameter "$2" "$AWS_REGION" "-" "aws-region must be passed as a second parameter or exported through environment variable 'export AWS_REGION=eu-central-1'" && AWS_REGION=$2
checkMandatoryParameter "$3" "$LOGS_BUCKET_ARN" "-" "logs-bucket-arn must be passed as a third parameter or exported through environment variable 'export LOGS_BUCKET_ARN=arn:aws:s3:::bucket-name'" && LOGS_BUCKET_ARN=$3
checkMandatoryParameter "$4" "$STACKNAME" "-" "stackname must be passed as a third parameter or exported through environment variable 'export STACKNAME=staging'" && STACKNAME=$4

CDK_BIN_FILE="bin/apiable-cdk.ts"
rm $CDK_BIN_FILE

cat <<EOT >> $CDK_BIN_FILE
import * as cdk from 'aws-cdk-lib'
import { LogsStream } from '../lib/logs-stream'

const app = new cdk.App()
// eslint-disable-next-line no-new
new LogsStream(app, "LogsStream", {
    stackName: "usagelogs-stream-apiable-$STACKNAME",
    description: "Usage Logs stream for Apiable Portal $STACKNAME",
    env: {
        account: "$AWS_ACCOUNT_ID",
        region: "$AWS_REGION",
        logsBucketArn: "$LOGS_BUCKET_ARN",
        prefix: "apiable/aws",
        name: "usagelogs-$STACKNAME"
    }
})
EOT
CONTEXT_OPTS="--require-approval never --outputs-file ./cdk-outputs.json"
echo $CONTEXT_OPTS
cdk diff $CONTEXT_OPTS
cdk synth -q $CONTEXT_OPTS
cdk deploy $CONTEXT_OPTS

