variable "name" {
  description = "Tenant identifier the logs bucket and its write role are scoped to (apiable-logs-<name>)"
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.name))
    error_message = "name must be lowercase letters, digits, and hyphens."
  }
}

variable "partner_account" {
  description = "AWS account allowed to write logs to the bucket and assume the log-writing role"
  type        = string
  default     = "034444869755"

  # Bound to exactly one account so parameterising the write principal cannot widen who may write to
  # the bucket or assume the role: a wildcard, a comma-list, or an extra principal all fail this check.
  validation {
    condition     = can(regex("^[0-9]{12}$", var.partner_account))
    error_message = "partner_account must be exactly one 12-digit AWS account id."
  }
}

variable "log_source" {
  description = "Which ingestion path feeds the stream: apigateway_direct (API Gateway writes to it) or cloudwatch_logs (a CloudWatch Logs subscription filter feeds it). Fixed at create time."
  type        = string
  default     = "apigateway_direct"

  validation {
    condition     = contains(["apigateway_direct", "cloudwatch_logs"], var.log_source)
    error_message = "log_source must be either apigateway_direct or cloudwatch_logs."
  }
}
