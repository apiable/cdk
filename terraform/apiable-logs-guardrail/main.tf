data "aws_caller_identity" "current" {}

locals {
  # Single operator-owned source of the sanctioned destination set: every enforcement layer below
  # (the Org SCP NotResource, each sanctioned bucket policy, the exported allow-list output) derives
  # from this one list. The set is concrete bucket ARNs, never a name-prefix wildcard — a wildcard
  # such as arn:aws:s3:::apiable-logs-* would admit an attacker-named apiable-logs-evil bucket.
  sanctioned_bucket_arns = [for name in var.sanctioned_logging_buckets : "arn:aws:s3:::${name}"]
  sanctioned_object_arns = [for arn in local.sanctioned_bucket_arns : "${arn}/*"]
}

# Authoritative control. Denies the firehose delivery path s3:Put* to anything outside the sanctioned
# set, attached at the Org OU spanning the tenant + logging accounts so it holds above every channel —
# including a hand-rolled one. The Deny is scoped by aws:PrincipalArn to the delivery-role pattern, so
# it constrains only the distrusted delivery path and never a legitimate non-firehose writer.
resource "aws_organizations_policy" "firehose_destination_guardrail" {
  name        = "apiable-firehose-destination-guardrail"
  description = "Deny the usage-firehose delivery role any s3:Put* outside the sanctioned logging buckets"
  type        = "SERVICE_CONTROL_POLICY"

  content = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DenyFirehoseWriteOutsideSanctionedBuckets"
        Effect = "Deny"
        Action = [
          "s3:PutObject",
          "s3:PutObjectAcl",
          "s3:PutObjectTagging",
        ]
        NotResource = local.sanctioned_object_arns
        Condition = {
          ArnLike = {
            "aws:PrincipalArn" = var.firehose_role_arn_pattern
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
