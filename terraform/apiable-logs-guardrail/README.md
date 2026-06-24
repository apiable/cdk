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
2. **Authoritative Organizations SCP** — a **principal-unscoped** Deny on `s3:Put*` to any resource
   outside the sanctioned set, attached at the logging OU spanning the tenant + logging accounts. The
   Deny is *not* keyed on the delivery-role name (a name a distrusted channel chooses and could forge);
   it bites by default on every principal and carves out only a **closed operator allow-list** via
   `StringNotLike aws:PrincipalArn = operator_writer_arns` (service-linked roles, break-glass admin). A
   hand-rolled channel that renames its delivery role is therefore denied whatever it is named, and only
   the operator can widen the carve-out — which the variable validation pins to concrete-account ARNs so
   a wildcard-account entry cannot silently exempt everyone.
3. **Defence-in-depth bucket policy** — on each sanctioned bucket, only a sanctioned firehose delivery
   role may `PutObject`, and only from the central account within the Apiable Org
   (`aws:SourceAccount` + `aws:PrincipalOrgID`).

## Usage

```hcl
module "apiable_logs_guardrail" {
  source                        = "./terraform/apiable-logs-guardrail"
  sanctioned_logging_buckets    = ["apiable-logs-prod"]
  sanctioned_delivery_role_arns = ["arn:aws:iam::111111111111:role/apiable-usagelogs-firehose"]
  # The closed operator carve-out: principals exempt from the Deny (StringNotLike aws:PrincipalArn).
  # Account-scoped ARNs only — a wildcard account would exempt every principal. Empty = no exemptions.
  operator_writer_arns          = ["arn:aws:iam::111111111111:role/aws-service-role/backup.amazonaws.com/AWSServiceRoleForBackup"]
  org_target_id                 = "ou-root-loggingou"
  org_id                        = "o-exampleorgid"
}
```

Attach `org_target_id` to a **logging-scoped OU**, not the Org root, in a multi-account Org: a root
attachment applies the Deny org-wide, denying `s3:Put*` everywhere except the sanctioned bucket. (A
single-account Org whose root is the only attach point is the deliberate exception.)

## Why a bucket policy alone is not enough

A resource policy on the *sanctioned* bucket protects that bucket but does not stop a delivery role
from writing to a *different* (attacker-controlled) bucket. The Org SCP is what denies writing
*elsewhere*; the bucket policy is the second layer that denies a foreign role writing *here*.
