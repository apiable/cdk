variable "name" {
  description = "Resource-name token the stream's physical names are scoped by (e.g. usagelogs-staging)"
  type        = string

  validation {
    condition     = can(regex("^[a-zA-Z0-9-]+$", var.name))
    error_message = "name must be letters, digits, and hyphens."
  }
}

variable "logs_bucket_arn" {
  description = "ARN of the log-storage S3 bucket the usage-log delivery stream writes to"
  type        = string

  validation {
    condition     = can(regex("^arn:aws:s3:::[a-z0-9.-]+$", var.logs_bucket_arn))
    error_message = "logs_bucket_arn must be a valid S3 bucket ARN (arn:aws:s3:::<bucket>)."
  }
}

variable "prefix" {
  description = "S3 key prefix the stream writes its logs/ and errors/ records under"
  type        = string
  default     = "apiable/aws"
}

variable "log_source" {
  description = <<-DESC
    Which ingestion path feeds this stream.

      apigateway_direct : API Gateway writes plain-text access logs straight to Firehose (today's path).
      cloudwatch_logs   : a CloudWatch Logs subscription filter feeds the stream; Firehose natively
                          gunzips the CWL envelope and extracts the log messages, so S3 receives the
                          same plain rows the parser already reads.

    The two modes are mutually exclusive and cannot be switched in place — see the lifecycle block
    on aws_kinesis_firehose_delivery_stream.this.
  DESC
  type        = string
  default     = "apigateway_direct"

  validation {
    condition     = contains(["apigateway_direct", "cloudwatch_logs"], var.log_source)
    error_message = "log_source must be either apigateway_direct or cloudwatch_logs."
  }
}
