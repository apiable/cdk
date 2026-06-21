# apiable-usagetokens-stream (Terraform)

Hand-rolled HCL module that provisions the gateway api-key-token Kinesis Firehose delivery stream
(`amazon-apigateway-<name>`), its `apiable-<name>-firehose` delivery role + inline policy, and the
CloudWatch log group/stream the delivery diagnostics go to — the Terraform channel of the api-key-token
distribution of the shared usage stream, equivalent to the one-click CFN stack in `lib/logs-stream`. It
is the same shape as the usage-log distribution, differing only by the default destination prefix
(`apiable/aws/apikey-token`) — the routing path the downstream ingestion pipeline keys off to
distinguish token-attribution events from usage logs.

## Usage

```hcl
module "apiable_usagetokens_stream" {
  source          = "./terraform/apiable-usagetokens-stream"
  name            = "usagetokens-staging"
  logs_bucket_arn = "arn:aws:s3:::apiable-logs-staging"
  # prefix defaults to the token destination prefix apiable/aws/apikey-token.
}
```

The delivery role trusts only the firehose service principal — there is no customer- or cross-account
trust value to set — and grants only writing to the configured storage bucket and emitting its own
delivery diagnostics, identical across all three channels.

## Delivery window

Records buffer and flush to the storage bucket under `<prefix>/logs/` when either the time threshold
(300s) or the size threshold (5 MB) is first reached, mirroring the CDK `bufferingHints`. Delivery
errors land under `<prefix>/errors/`. The write format is `UNCOMPRESSED`.

## Existing streams — do not apply in place

The delivery-stream name `amazon-apigateway-<name>` and the role name `apiable-<name>-firehose` are a
fixed contract with already-provisioned tenants, identical across all three channels. Do **not**
`terraform apply` this module for a `name` that already holds the stream — whether provisioned by the
one-click CFN stack or a prior apply: the create collides on the existing names.

To bring an existing stream under Terraform management, import it before applying rather than
re-creating it:

```bash
terraform import aws_kinesis_firehose_delivery_stream.this amazon-apigateway-<name>
terraform import aws_iam_role.firehose apiable-<name>-firehose
terraform import aws_iam_role_policy.firehose apiable-<name>-firehose:FirehosePolicy
terraform import aws_cloudwatch_log_group.firehose /aws/firehose/logs-<name>
terraform import aws_cloudwatch_log_stream.firehose /aws/firehose/logs-<name>:firehose-log-stream-<name>
```
