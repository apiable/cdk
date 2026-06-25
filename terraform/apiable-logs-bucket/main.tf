data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "this" {
  # Tenant-scoped name, fixed contract with already-provisioned tenants.
  bucket        = "apiable-logs-${var.name}"
  force_destroy = false

  # Channel-stable identity the release-time parity gate keys this bucket on, identical to the CDK/CFN channels.
  tags = {
    "apiable:logical-id" = "apiable-logs-bucket"
  }

  # Mirrors the CDK RETAIN_ON_UPDATE_OR_DELETE posture; no S3 lifecycle/expiry rule is introduced.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_policy" "this" {
  bucket = aws_s3_bucket.this.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "Permissions"
        Effect    = "Allow"
        Principal = {
          AWS = [
            "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root",
            "arn:aws:iam::${var.partner_account}:root",
          ]
        }
        Action   = "s3:*"
        Resource = [aws_s3_bucket.this.arn, "${aws_s3_bucket.this.arn}/*"]
      }
    ]
  })
}

resource "aws_iam_role" "this" {
  name        = "apiable-logs-${var.name}-s3-role"
  description = "Role for partner account to Access the S3 Bucket"

  # Channel-stable identity the release-time parity gate keys this role on, identical to the CDK/CFN channels.
  tags = {
    "apiable:logical-id" = "apiable-logs-write-role"
  }

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${var.partner_account}:root" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "s3_access" {
  name = "s3-access"
  role = aws_iam_role.this.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "s3:*"
        Resource = [aws_s3_bucket.this.arn, "${aws_s3_bucket.this.arn}/*"]
      }
    ]
  })
}
