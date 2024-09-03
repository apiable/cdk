# Instructions
## CDK Basic installation
### Install CDK
If it is the first time running CDK on AWS, then you need to install the CDK toolkit following the instructions here: [https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html)

## Gateway Management Role installation
### Export the paramaters
```bash
export AWS_ACCOUNT_ID=<your_account_id>
export AWS_REGION=<your_region>
```
### Deploy the stack
```bash
./deploy-gatewayrole.sh
```
### Get the Role Arn
You can find the role arn in the output of the stack.

## AuthZ Gateway Authorizer installation
### Export the paramaters
```bash
export AWS_ACCOUNT_ID=<your_account_id>
export AWS_REGION=<your_region>
export STACKNAME=<your_pool_name>
export APIABLE_AWS_AUTHZ_USERPOOLID=<your_authz_userpool_id>
export APIABLE_AWS_AUTHZ_ASSUME_ROLE_ARN=<your_authz_assume_role_arn>
export AUTH_METHOD=JWT
```

### Deploy the stack
```bash
./deploy-authz.sh
```

## Cognito Pool installation
### Export the paramaters
```bash
export AWS_ACCOUNT_ID=<your_account_id>
export AWS_REGION=<your_region>
export POOLNAME=<your_pool_name>
export FROM_EMAIL=<your_from_email>
export SES_VERIFIED_DOMAIN=<your_ses_verified_domain>
```
### Deploy the stack
```bash
./deploy-cognito.sh
```

## Logging Reporting installation (for advanced reports and usage)
### Export the paramaters
```bash
export AWS_ACCOUNT_ID=<your_account_id>
export AWS_REGION=<your_region>
export STACKNAME=<your_stack_name>
```
### Deploy the S3 bucket (if not exists, otherwise skip this step)
```bash
./deploy-logs-bucket.sh
```

### Export the paramater of logs bucket
```bash
export AWS_ACCOUNT_ID=<your_account_id>
export AWS_REGION=<your_region>
export LOGS_BUCKET_ARN=<logs_bucket_arn_from_previous_step>
export STACKNAME=<your_stack_name>
```
### Deploy the Usagelogs firehose stream
```bash
./deploy-usagelogs-stream.sh
```
### Enable the logs in the API Gateway
- Go to the API Gateway console
- Select the API
- Go to the Stages
- Select the Stage
- Go to the Logs/Tracing and click Edit
Paste following pattern in the Log format field:
```json
{"api_id": "$context.apiId","api_key": "$context.identity.apiKey","key_id": "$context.identity.apiKeyId","ip": "$context.identity.sourceIp","method": "$context.httpMethod","uri": "$context.path","response_size":"$context.responseLength","response_status": "$context.status","resource_id": "$context.resourceId","request_id": "$context.requestId","request_latency": "$context.responseLatency","request_time":"$context.requestTimeEpoch","stage": "$context.stage", "usage_prompt_tokens": "$context.responseOverride.header.usageprompttokens", "usage_completion_tokens": "$context.responseOverride.header.usagecompletiontokens", "usage_total_tokens": "$context.responseOverride.header.usagetotaltokens"}
```
- Save the changes

### Export the paramater of logs bucket
```bash
export AWS_ACCOUNT_ID=<your_account_id>
export AWS_REGION=<your_region>
export LOGS_BUCKET_ARN=<logs_bucket_arn_from_previous_step>
export STACKNAME=<your_stack_name>
```
### Deploy the Usagelogs firehose stream
```bash
./deploy-usagelogs-stream.sh
```





