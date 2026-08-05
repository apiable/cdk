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
> **Existing `gatewayrole` stacks:** do not re-deploy an existing stack with this code. The IAM role name is unchanged and the already-provisioned role keeps working as-is; the restructured template gives the role a new logical id, so an in-place re-deploy collides on the unchanged role name (`EntityAlreadyExists`). Provision new tenants via the one-click `apiable-gateway-role` stack instead.

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
> **Existing logs buckets:** do not re-deploy an existing stack with this code. The bucket name `apiable-logs-<name>` is unchanged and the already-provisioned bucket keeps working as-is (it is retained, not replaced); the restructured template gives the bucket a new logical id, so an in-place re-deploy collides on the unchanged, globally-unique bucket name (`BucketAlreadyExists`). Provision new tenants via the one-click `apiable-logs-bucket` stack instead.

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
{"api_id": "$context.apiId","api_key": "$context.identity.apiKey","key_id": "$context.identity.apiKeyId","ip": "$context.identity.sourceIp","method": "$context.httpMethod","uri": "$context.path","response_size": "$context.responseLength","response_status": "$context.status","resource_id": "$context.resourceId","request_id": "$context.requestId","request_latency": "$context.responseLatency","request_time": "$context.requestTimeEpoch","stage": "$context.stage","plan_id": "$context.authorizer.apiable_plan_id","subscription_id": "$context.authorizer.apiable_subscription_id"}
```
- Save the changes

> **`subscription_id` is mandatory.** Ingestion discards any row whose `subscription_id` key is absent or blank before it reads `key_id`, so a format without it meters nothing and reports no error at either end. Keep the key even when the stage runs an authorizer that does not set the Apiable claims: API Gateway writes `-` for an unresolved `$context.authorizer.*` value, and ingestion treats `-` as "resolve the subscription from `key_id`". An absent key breaks attribution; an empty value does not.

## Token metering installation (only for LLM / AI APIs billed on tokens)

Skip this section unless you bill on token consumption. It adds a **second** Firehose stream alongside the one above, writing to `apiable/aws/apikey-token` rather than `apiable/aws`, and it carries its own log format.

### Export the paramater of logs bucket
```bash
export AWS_ACCOUNT_ID=<your_account_id>
export AWS_REGION=<your_region>
export LOGS_BUCKET_ARN=<logs_bucket_arn_from_previous_step>
export STACKNAME=<your_stack_name>
```
### Deploy the Usagetokens firehose stream
```bash
./deploy-usagetokenslogs-stream.sh
```
### Log format for the token stream
Rows on this stream are identified by `key_id` and do not carry `subscription_id`. Use this format only for stages pointed at the token stream:
```json
{"api_id": "$context.apiId","api_key": "$context.identity.apiKey","key_id": "$context.identity.apiKeyId","ip": "$context.identity.sourceIp","method": "$context.httpMethod","uri": "$context.path","response_size": "$context.responseLength","response_status": "$context.status","resource_id": "$context.resourceId","request_id": "$context.requestId","request_latency": "$context.responseLatency","request_time": "$context.requestTimeEpoch","stage": "$context.stage","usage_prompt_tokens": "$context.responseOverride.header.usageprompttokens","usage_completion_tokens": "$context.responseOverride.header.usagecompletiontokens","usage_total_tokens": "$context.responseOverride.header.usagetotaltokens"}
```





