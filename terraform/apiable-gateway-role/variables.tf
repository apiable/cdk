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

variable "egress_cidr" {
  description = "CIDR Apiable calls from; the role refuses every request originating outside it"
  type        = string
  default     = "63.180.116.108/32"

  # A stale or mistyped value locks Apiable out rather than over-granting, so it fails closed and
  # silently — surfacing later as AccessDenied, not at apply time. The shape is checked here.
  validation {
    condition     = can(regex("^([0-9]{1,3}\\.){3}[0-9]{1,3}/([0-9]|[1-2][0-9]|3[0-2])$", var.egress_cidr))
    error_message = "egress_cidr must be one IPv4 CIDR block, for example 203.0.113.4/32."
  }
}
