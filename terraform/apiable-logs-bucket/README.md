# apiable-logs-bucket (Terraform)

Hand-rolled HCL module that provisions the `apiable-logs-<name>` S3 bucket, its cross-account
resource policy, and the `apiable-logs-<name>-s3-role` write role — the Terraform channel of the
logs bucket, equivalent to the one-click CFN stack in `lib/logs-bucket`.

## Usage

```hcl
module "apiable_logs_bucket" {
  source = "./terraform/apiable-logs-bucket"
  name   = "staging"
  # partner_account defaults to the Apiable account; override only with a single 12-digit account id.
}
```

The tenant account (whichever account runs `terraform apply`) is granted on the bucket alongside
the partner account, mirroring the one-click channel's `AWS::AccountId` grant.

## Retention posture

The bucket is retained, not auto-emptied (`force_destroy = false`, `prevent_destroy = true`),
mirroring the CDK `RETAIN_ON_UPDATE_OR_DELETE` removal policy. This module introduces no S3
lifecycle/expiry rule — a new retention rule is deferred to the analytics redesign.

## Existing buckets — do not apply in place

The bucket name `apiable-logs-<name>` is a fixed contract with already-provisioned tenants and is
identical across all three channels. Do **not** `terraform apply` this module for a `name` that
already holds the bucket — whether provisioned by the one-click CFN stack or a prior apply: the
create collides on the existing globally-unique bucket name (`BucketAlreadyExists`).

To bring an existing bucket under Terraform management, import it before applying rather than
re-creating it:

```bash
terraform import aws_s3_bucket.this apiable-logs-<name>
terraform import aws_s3_bucket_policy.this apiable-logs-<name>
terraform import aws_iam_role.this apiable-logs-<name>-s3-role
terraform import aws_iam_role_policy.s3_access apiable-logs-<name>-s3-role:s3-access
```
