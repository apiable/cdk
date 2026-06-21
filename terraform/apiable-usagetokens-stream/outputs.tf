output "firehose_arn" {
  description = "ARN of the api-key-token Kinesis Firehose delivery stream"
  value       = aws_kinesis_firehose_delivery_stream.this.arn
}
