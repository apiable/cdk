# apiable-usagelogs-stream (Terraform)

Hand-rolled HCL module that provisions the gateway usage-log Kinesis Firehose delivery stream
(`amazon-apigateway-<name>`), its `apiable-<name>-firehose` delivery role + inline policy, and the
CloudWatch log group/stream the delivery diagnostics go to — the Terraform channel of the usage-log
stream, equivalent to the one-click CFN stack in `lib/logs-stream`.

## Usage

```hcl
module "apiable_usagelogs_stream" {
  source          = "./terraform/apiable-usagelogs-stream"
  name            = "usagelogs-staging"
  logs_bucket_arn = "arn:aws:s3:::apiable-logs-staging"
  # prefix defaults to the usage-log destination prefix apiable/aws.
  # log_source defaults to apigateway_direct; see "Ingestion paths" below.
}
```

The delivery role trusts only the firehose service principal — there is no customer- or cross-account
trust value to set — and grants only writing to the configured storage bucket and emitting its own
delivery diagnostics, identical across all three channels.

## Ingestion paths

`log_source` selects how access logs reach the stream. The same choice is a `LogSource` deploy-time
parameter on the one-click CFN template, so all channels offer both routes.

| `log_source` | How records arrive | Processors |
| --- | --- | --- |
| `apigateway_direct` (default) | API Gateway writes plain-text access logs straight to the stream | none |
| `cloudwatch_logs` | a CloudWatch Logs subscription filter feeds the stream | `Decompression` then `CloudWatchLogProcessing` |

A subscription filter delivers records gzipped and wrapped in a CloudWatch Logs envelope, which the
`UNCOMPRESSED` write format would otherwise land in the bucket verbatim for the parser to choke on.
The two native processors gunzip the envelope and unwrap it to the bare log messages, so the bucket
receives the same plain rows the direct path writes. No Lambda is involved.
`DataMessageExtraction` also discards `CONTROL_MESSAGE` records, so the health-check message
CloudWatch emits when a subscription filter is created never lands as a bogus row.

On `cloudwatch_logs` the customer supplies the other half in their own account, once: an IAM role
CloudWatch Logs uses to put to the stream, and a subscription filter on the API Gateway access-log
group pointing at the stream ARN. The access-log format itself is unchanged, and must stay the flat
JSON row the parser reads.

The stream name is unaffected by the choice. `amazon-apigateway-` is required only because API
Gateway insists on it when it writes to a stream directly; a subscription filter has no such rule,
but the prefix is kept in both modes so the name stays a fixed contract across channels.

## Delivery window

Records buffer and flush to the storage bucket under `<prefix>/logs/` when either the time threshold
(300s) or the size threshold (5 MB) is first reached, mirroring the CDK `bufferingHints`. Delivery
errors land under `<prefix>/errors/`. The write format is `UNCOMPRESSED`.

## Existing streams — do not apply in place

The delivery-stream name `amazon-apigateway-<name>` and the role name `apiable-<name>-firehose` are a
fixed contract with already-provisioned tenants, identical across all three channels. Do **not**
`terraform apply` this module for a `name` that already holds the stream — whether provisioned by the
one-click CFN stack or a prior apply: the create collides on the existing names.

Switching `log_source` on a stream that already exists is a **replacement, not an update**. Firehose
refuses to add source decompression to a stream that does not already carry it (`Enabling source
decompression is not supported for existing stream with no Lambda function attached`) and refuses
`CloudWatchLogProcessing` without it, so an in-place update fails and rolls back. The module declares
`replace_triggered_by` on the mode so Terraform destroys and re-creates instead of attempting that
update. The replacement keeps the same name and therefore the same ARN, so references to the stream
survive, but delivery stops for the duration and records produced in that window are lost. Removing
the CloudWatch path from a stream is the same one-way door in reverse.

To bring an existing stream under Terraform management, import it before applying rather than
re-creating it:

```bash
terraform import aws_kinesis_firehose_delivery_stream.this amazon-apigateway-<name>
terraform import aws_iam_role.firehose apiable-<name>-firehose
terraform import aws_iam_role_policy.firehose apiable-<name>-firehose:FirehosePolicy
terraform import aws_cloudwatch_log_group.firehose /aws/firehose/logs-<name>
terraform import aws_cloudwatch_log_stream.firehose /aws/firehose/logs-<name>:firehose-log-stream-<name>
```
