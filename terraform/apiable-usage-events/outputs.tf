output "bucket_name" {
  description = "Name of the logs S3 bucket"
  value       = aws_s3_bucket.this.bucket
}

output "bucket_arn" {
  description = "ARN of the logs S3 bucket"
  value       = aws_s3_bucket.this.arn
}

output "s3_assume_role_arn" {
  description = "ARN of the role the partner account assumes to write logs"
  value       = aws_iam_role.this.arn
}

output "firehose_arn" {
  description = "ARN of the usage-log Kinesis Firehose delivery stream an API Gateway stage writes its access logs to"
  value       = aws_kinesis_firehose_delivery_stream.this.arn
}
