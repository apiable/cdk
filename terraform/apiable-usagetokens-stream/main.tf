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
    "apiable:logical-id" = "apiable-usagetokens-firehose-role"
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

    cloudwatch_logging_options {
      enabled         = true
      log_group_name  = aws_cloudwatch_log_group.firehose.name
      log_stream_name = aws_cloudwatch_log_stream.firehose.name
    }
  }
}
