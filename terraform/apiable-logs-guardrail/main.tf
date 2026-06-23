data "aws_caller_identity" "current" {}

locals {
  # Single operator-owned source of the sanctioned destination set; every layer below derives from it.
  # Concrete bucket ARNs only, never a wildcard (arn:aws:s3:::apiable-logs-* would admit an attacker bucket).
  sanctioned_bucket_arns = [for name in var.sanctioned_logging_buckets : "arn:aws:s3:::${name}"]
  sanctioned_object_arns = [for arn in local.sanctioned_bucket_arns : "${arn}/*"]
}

# Authoritative control, attached at the Org OU spanning the tenant + logging accounts so it holds above
# every channel — including a hand-rolled one. The Deny is principal-UNSCOPED on purpose: it denies the
# write to any destination outside the sanctioned set for every principal in the logging-account family,
# carving out only operator_writer_arns. A renamed delivery role a distrusted channel hand-rolls is thus
# denied by default — the control trusts an operator-owned closed allow-list, never the role's own name
# (a name the distrusted channel chooses). The allow-list family scope (this is the metering logging
# account, not a general-purpose workload account) keeps the carve-out small and known.
resource "aws_organizations_policy" "firehose_destination_guardrail" {
  name        = "apiable-firehose-destination-guardrail"
  description = "Deny any logging-family principal s3:Put* outside the sanctioned buckets, except the operator carve-out"
  type        = "SERVICE_CONTROL_POLICY"

  content = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DenyWriteOutsideSanctionedBuckets"
        Effect = "Deny"
        Action = [
          "s3:PutObject",
          "s3:PutObjectAcl",
          "s3:PutObjectTagging",
        ]
        NotResource = local.sanctioned_object_arns
        Condition = {
          StringNotLike = {
            "aws:PrincipalArn" = var.operator_writer_arns
          }
        }
      }
    ]
  })
}

resource "aws_organizations_policy_attachment" "firehose_destination_guardrail" {
  policy_id = aws_organizations_policy.firehose_destination_guardrail.id
  target_id = var.org_target_id
}

# Defence-in-depth. On each sanctioned bucket, the only principal allowed to PutObject is a sanctioned
# firehose delivery role, and only from the central account within the Apiable Org — so a delivery role
# from outside the Org that guesses a sanctioned ARN is still denied at the destination.
resource "aws_s3_bucket_policy" "sanctioned" {
  for_each = toset(var.sanctioned_logging_buckets)

  bucket = each.value

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowSanctionedFirehoseDeliveryOnly"
        Effect    = "Allow"
        Principal = { AWS = var.sanctioned_delivery_role_arns }
        Action    = "s3:PutObject"
        Resource  = "arn:aws:s3:::${each.value}/*"
        Condition = {
          StringEquals = {
            "aws:SourceAccount"  = data.aws_caller_identity.current.account_id
            "aws:PrincipalOrgID" = var.org_id
          }
        }
      }
    ]
  })
}
