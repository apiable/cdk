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
