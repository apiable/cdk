# apiable-usage-events (Terraform)

Hand-rolled HCL module that provisions the customer-side usage-log pipeline in one apply: the
`apiable-logs-<name>` S3 bucket with its cross-account resource policy and the
`apiable-logs-<name>-s3-role` partner write role, and the `amazon-apigateway-usagelogs` Kinesis
Firehose delivery stream with its `apiable-usagelogs-firehose` delivery role and diagnostics log group,
writing into that same bucket. It is the Terraform channel of the one-click CFN stack in
`lib/usage-events`, and it is self-contained: the published archive carries this directory only.

## Usage

```hcl
module "apiable_usage_events" {
  source = "https://<launch-stack bucket>.s3.amazonaws.com/apiable-usage-events/1.0.0/terraform.zip"
  name   = "staging"
  # partner_account defaults to the Apiable account; override only with a single 12-digit account id.
  # log_source defaults to apigateway_direct; cloudwatch_logs feeds the stream from a subscription filter.
}
```

| Input | Default | Rule |
| --- | --- | --- |
| `name` | none | lowercase letters, digits, hyphens |
| `partner_account` | `034444869755` | exactly one 12-digit account |
| `log_source` | `apigateway_direct` | `apigateway_direct` or `cloudwatch_logs`; fixed at create time |

| Output | What it is |
| --- | --- |
| `bucket_name`, `bucket_arn` | the logs bucket |
| `s3_assume_role_arn` | the role the partner account assumes to read and write the bucket |
| `firehose_arn` | the stream an API Gateway stage writes its access logs to |

The stream writes under `apiable/aws/logs/` (errors under `apiable/aws/errors/`). The stream name and
prefix are fixed, not inputs: Apiable reads the bucket under that prefix, and a changed value would stop
metering with no error in either account. The API Gateway stage's access-log setting is not managed
here; point it at `firehose_arn`.

## One pipeline per tenant account

This module is for an account that does not run the pipeline yet. The bucket name is globally unique
and the role and stream names are unique per account, so in an account that already runs
`apiable-logs-bucket` and `apiable-usagelogs-stream` (by CloudFormation or Terraform) the create
collides on those names. Keep the existing two stacks there; there is no adoption mode.

The bucket is retained, not auto-emptied (`force_destroy = false`, `prevent_destroy = true`).
Switching `log_source` on an existing stream replaces the stream (see the `lifecycle` block); delivery
stops for the duration of the swap.
