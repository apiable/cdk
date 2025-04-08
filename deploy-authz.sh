#!/usr/bin/env bash

source _deploy.sh

export EXAMPLE="./deploy-authz.sh 034444869755 eu-central-1 eu-central-1_sGgtSTd9j arn:aws:iam::034444869755:role/ApiableCognitoAuthZ-portal-dev JWT dev arn:aws:iam::034444869755:role/ApiableGetaway eu-central-1"

checkMandatoryParameter "$1" "$AWS_ACCOUNT_ID" "-" "aws-account-id must be passed as a first parameter or exported through environment variable 'export AWS_ACCOUNT_ID=1234'" && AWS_ACCOUNT_ID=$1
checkMandatoryParameter "$2" "$AWS_REGION" "-" "aws-region must be passed as a second parameter or exported through environment variable 'export AWS_REGION=eu-central-1'" && AWS_REGION=$2
checkMandatoryParameter "$3" "$APIABLE_AWS_AUTHZ_USERPOOLID" "-" "authz-userpool-id must be passed as a third parameter or exported through environment variable 'export APIABLE_AWS_AUTHZ_USERPOOLID=eu-central-1_123456789'" && APIABLE_AWS_AUTHZ_USERPOOLID=$3
checkMandatoryParameter "$4" "$APIABLE_AWS_AUTHZ_ROLE_ARN" "-" "authz-assume-role-arn must be passed as a forth parameter or exported through environment variable 'export APIABLE_AWS_AUTHZ_ROLE_ARN=arn:aws:iam::123456789012:role/role-name'" && APIABLE_AWS_AUTHZ_ROLE_ARN=$4
checkMandatoryParameter "$5" "$AUTH_METHOD" "JWT" "auth-method must be passed as a fifth parameter or exported through environment variable 'export AUTH_METHOD=JWT'" && AUTH_METHOD=$5
checkMandatoryParameter "$6" "$STACKNAME" "-" "stackname must be passed as a sixth parameter or exported through environment variable 'export STACKNAME=staging'" && STACKNAME=$6
checkMandatoryParameter "$7" "$APIABLE_AWS_AUTHZ_API_GATEWAY_ASSUME_ROLE_ARN" "-" "authz-api-gateway-assume-role-arn must be passed as a seventh parameter or exported through environment variable 'export APIABLE_AWS_AUTHZ_API_GATEWAY_ASSUME_ROLE_ARN=arn:aws:iam::123456789012:role/role-name'" && APIABLE_AWS_AUTHZ_API_GATEWAY_ASSUME_ROLE_ARN=$7

CDK_BIN_FILE="bin/apiable-cdk.ts"
rm $CDK_BIN_FILE

cat <<EOT >> $CDK_BIN_FILE
import * as cdk from 'aws-cdk-lib'
import { AuthZ } from '../lib/authz'

const app = new cdk.App()
// eslint-disable-next-line no-new
new AuthZ(app, "AuthZ", {
    stackName: "auth-portal-authz-$STACKNAME",
    description: "AuthZ Lambda for Apiable Gateway Authorization $STACKNAME",
    env: {
        account: "$AWS_ACCOUNT_ID",
        region: "$AWS_REGION",
        name: "$STACKNAME",
        userpoolId: "$APIABLE_AWS_AUTHZ_USERPOOLID",
        assumeRoleArn: "$APIABLE_AWS_AUTHZ_ROLE_ARN",
        authMethod: "$AUTH_METHOD",
        apiGatewayAssumeRoleArn: "$APIABLE_AWS_AUTHZ_API_GATEWAY_ASSUME_ROLE_ARN"
    }
})
EOT
CONTEXT_OPTS="--require-approval never --outputs-file ./cdk-outputs.json"
echo $CONTEXT_OPTS
cdk diff $CONTEXT_OPTS
cdk synth -q $CONTEXT_OPTS
cdk deploy $CONTEXT_OPTS

