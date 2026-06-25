variable "region" {
  description = "AWS region the gateway-management role is provisioned in"
  type        = string
}

variable "trust_account" {
  description = "AWS account authorised to assume the gateway-management role"
  type        = string
  default     = "034444869755"

  # Bound to exactly one account so parameterising the trust target cannot widen who may
  # assume the role: a wildcard, a comma-list, or an extra principal all fail this check.
  validation {
    condition     = can(regex("^[0-9]{12}$", var.trust_account))
    error_message = "trust_account must be exactly one 12-digit AWS account id."
  }
}
