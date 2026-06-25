output "firehose_arn" {
  description = "ARN of the usage-log Kinesis Firehose delivery stream"
  value       = aws_kinesis_firehose_delivery_stream.this.arn
}
