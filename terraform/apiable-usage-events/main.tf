data "aws_caller_identity" "current" {}

# Apiable reads the bucket under this prefix, and an API Gateway stage attaches to the stream by this
# name, so neither is an input: a changed value stops metering with no error in either account.
locals {
  stream_name = "usagelogs"
  prefix      = "apiable/aws"
}

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
        Sid    = "Permissions"
        Effect = "Allow"
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

resource "aws_cloudwatch_log_group" "firehose" {
  name              = "/aws/firehose/logs-${local.stream_name}"
  retention_in_days = 7
}

resource "aws_cloudwatch_log_stream" "firehose" {
  name           = "firehose-log-stream-${local.stream_name}"
  log_group_name = aws_cloudwatch_log_group.firehose.name
}

resource "aws_iam_role" "firehose" {
  name = "apiable-${local.stream_name}-firehose"

  # Channel-stable identity the release-time parity gate keys this role on, identical to the CDK/CFN channels.
  tags = {
    "apiable:logical-id" = "apiable-usagelogs-firehose-role"
  }

  # Trusted only as the firehose delivery service — never any account; there is no cross-account trust knob.
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "firehose.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "firehose" {
  name = "FirehosePolicy"
  role = aws_iam_role.firehose.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:AbortMultipartUpload",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:PutObject",
        ]
        Resource = [aws_s3_bucket.this.arn, "${aws_s3_bucket.this.arn}/*"]
      },
      {
        # PutLogEvents authorises against a log STREAM ARN. The provider's log-group `arn` drops the
        # `:*` that CloudFormation's Arn carries, so the bare ARN matches no stream and Firehose could
        # not write its delivery errors. `:*` names every stream in the group, as the CDK channel does.
        Effect   = "Allow"
        Action   = "logs:PutLogEvents"
        Resource = "${aws_cloudwatch_log_group.firehose.arn}:*"
      }
    ]
  })
}

# Firehose refuses to add source decompression to a stream that does not already have it, and
# CloudWatchLogProcessing can only be enabled with the Decompression processor, so flipping
# log_source has to REPLACE the stream, never update it in place. The replacement keeps the name and
# therefore the ARN, so an API Gateway stage or subscription filter pointing at it stays valid.
resource "terraform_data" "log_source_mode" {
  input = var.log_source
}

resource "aws_kinesis_firehose_delivery_stream" "this" {
  # The name MUST start with amazon-apigateway- — API Gateway access logging requires it.
  name        = "amazon-apigateway-${local.stream_name}"
  destination = "extended_s3"

  extended_s3_configuration {
    role_arn            = aws_iam_role.firehose.arn
    bucket_arn          = aws_s3_bucket.this.arn
    prefix              = "${local.prefix}/logs/"
    error_output_prefix = "${local.prefix}/errors/"
    buffering_interval  = 300
    buffering_size      = 5
    compression_format  = "UNCOMPRESSED"

    # cloudwatch_logs mode only: gunzip the CWL envelope, then unwrap it to the bare log messages.
    # DataMessageExtraction also discards CONTROL_MESSAGE records, so the health-check message
    # CloudWatch emits when a subscription filter is created never reaches S3 as a bogus row.
    dynamic "processing_configuration" {
      for_each = var.log_source == "cloudwatch_logs" ? [1] : []

      content {
        enabled = true

        processors {
          type = "Decompression"

          parameters {
            parameter_name  = "CompressionFormat"
            parameter_value = "GZIP"
          }
        }

        processors {
          type = "CloudWatchLogProcessing"

          parameters {
            parameter_name  = "DataMessageExtraction"
            parameter_value = "true"
          }
        }
      }
    }

    cloudwatch_logging_options {
      enabled         = true
      log_group_name  = aws_cloudwatch_log_group.firehose.name
      log_stream_name = aws_cloudwatch_log_stream.firehose.name
    }
  }

  lifecycle {
    replace_triggered_by = [terraform_data.log_source_mode]
  }
}
