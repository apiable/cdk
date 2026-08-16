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
- Enable **Custom access logging** and paste the Firehose stream ARN as the **Access log destination ARN**

Paste the following pattern in the **Log format** field, as a **single line** — Firehose delivers one record per entry and Apiable parses one JSON object per line, so a multi-line format breaks ingestion:

```json
{"api_id": "$context.apiId","api_key": "$context.identity.apiKey","key_id": "$context.identity.apiKeyId","ip": "$context.identity.sourceIp","method": "$context.httpMethod","uri": "$context.path","response_size": "$context.responseLength","response_status": "$context.status","resource_id": "$context.resourceId","request_id": "$context.requestId","request_latency": "$context.responseLatency","request_time": "$context.requestTimeEpoch","stage": "$context.stage","plan_id": "$context.authorizer.apiable_plan_id","subscription_id": "$context.authorizer.apiable_subscription_id"}
```

> **Never remove `subscription_id`.** Apiable discards any log row that has no `subscription_id` key at all, before it reads anything else in the row. Delete the key and every call goes unmetered — with no error in the AWS account and no usage in the portal. Keep it even when your authorizer does not populate it: API Gateway writes a dash for an unresolved `$context.authorizer` value, and Apiable treats that as "resolve the subscription from `key_id`". What breaks attribution is an absent key, not an empty value. The same applies to `plan_id`.

**Metering tokens for LLM and AI APIs.** If you bill on tokens rather than calls, there is a token variant of this format that adds `usage_prompt_tokens`, `usage_completion_tokens`, and `usage_total_tokens` from response headers. It still carries `plan_id` and `subscription_id`. Ask support@apiable.io which format fits your pricing before you set it up.

**Canonical source:** https://www.apiable.io/docs/integrations/api-gateways/aws-usage-logs — the customer-facing page is the format Apiable actually ingests. If this README and that page ever disagree, the page wins.

- Save the changes





