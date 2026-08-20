resource "aws_cloudwatch_log_group" "firehose" {
  name              = "/aws/firehose/logs-${var.name}"
  retention_in_days = 7
}

resource "aws_cloudwatch_log_stream" "firehose" {
  name           = "firehose-log-stream-${var.name}"
  log_group_name = aws_cloudwatch_log_group.firehose.name
}

resource "aws_iam_role" "firehose" {
  name = "apiable-${var.name}-firehose"

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
        Resource = [var.logs_bucket_arn, "${var.logs_bucket_arn}/*"]
      },
      {
        Effect   = "Allow"
        Action   = "logs:PutLogEvents"
        Resource = aws_cloudwatch_log_group.firehose.arn
      }
    ]
  })
}

# Firehose refuses to add source decompression to a stream that does not already have it
# ("Enabling source decompression is not supported for existing stream with no Lambda function
# attached"), and CloudWatchLogProcessing "can only be enabled with DecompressionProcessor".
# Flipping log_source therefore has to REPLACE the stream, never update it in place. The stream ARN
# is derived from its name, so a replacement under the same name hands back an identical ARN and any
# subscription filter or API Gateway stage pointing at it stays valid across the swap.
resource "terraform_data" "log_source_mode" {
  input = var.log_source
}

resource "aws_kinesis_firehose_delivery_stream" "this" {
  # The name MUST start with amazon-apigateway- — API Gateway access logging requires it.
  name        = "amazon-apigateway-${var.name}"
  destination = "extended_s3"

  extended_s3_configuration {
    role_arn            = aws_iam_role.firehose.arn
    bucket_arn          = var.logs_bucket_arn
    prefix              = "${var.prefix}/logs/"
    error_output_prefix = "${var.prefix}/errors/"
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
