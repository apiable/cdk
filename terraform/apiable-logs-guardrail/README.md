# apiable-logs-guardrail (Terraform)

Operator-owned, deploy-time guardrail that constrains where the usage-firehose may write on the
central logging account. It is the **deploy-time discharge** of 013-1-21's accepted destination-bucket
fail-OPEN: the release parity gate cannot witness a deploy-time destination value across channels, so
the destination-bucket security control lives here, **above** the per-tenant distribution channel —
not inside it.

This module is owned by the central logging-account / Organization operator, never by a per-tenant
stream channel. All three channels (CDK construct, one-click CFN, hand-rolled Terraform) are equally
constrained precisely because enforcement is operator-side, independent of how — or whether — a given
channel scopes its own delivery role.

## What it does

1. **Single source of truth** — `local.sanctioned_bucket_arns`, computed from
   `var.sanctioned_logging_buckets`. The SCP `NotResource`, every sanctioned bucket policy, and the
   exported allow-list output all derive from this one list. Entries are concrete bucket names, never
   a glob: a `apiable-logs-*` wildcard would admit an attacker-named `apiable-logs-evil` bucket.
2. **Authoritative Organizations SCP** — denies the firehose delivery role any `s3:PutObject` /
   `s3:PutObjectAcl` / `s3:PutObjectTagging` to a resource outside the sanctioned set, scoped by
   `aws:PrincipalArn` to the delivery-role pattern so it does not over-deny other account writers.
   Attached at the Org OU spanning the tenant + logging accounts, so it holds for every channel.
3. **Defence-in-depth bucket policy** — on each sanctioned bucket, only a sanctioned firehose delivery
   role may `PutObject`, and only from the central account within the Apiable Org
   (`aws:SourceAccount` + `aws:PrincipalOrgID`).

## Usage

```hcl
module "apiable_logs_guardrail" {
  source                        = "./terraform/apiable-logs-guardrail"
  sanctioned_logging_buckets    = ["apiable-logs-prod"]
  sanctioned_delivery_role_arns = ["arn:aws:iam::111111111111:role/apiable-usagelogs-firehose"]
  org_target_id                 = "ou-root-loggingou"
  org_id                        = "o-exampleorgid"
}
```

## Why a bucket policy alone is not enough

A resource policy on the *sanctioned* bucket protects that bucket but does not stop a delivery role
from writing to a *different* (attacker-controlled) bucket. The Org SCP is what denies writing
*elsewhere*; the bucket policy is the second layer that denies a foreign role writing *here*.
