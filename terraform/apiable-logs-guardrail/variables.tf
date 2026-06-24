variable "sanctioned_logging_buckets" {
  description = "Names of the sanctioned apiable-logs-* destination buckets — the single source every enforcement layer derives from"
  type        = list(string)

  validation {
    condition     = length(var.sanctioned_logging_buckets) > 0
    error_message = "at least one sanctioned logging bucket name is required."
  }

  # Each entry is a concrete bucket name, never a glob — a wildcard would let an attacker-named bucket
  # match the allow-list and defeat the guardrail.
  validation {
    condition     = alltrue([for name in var.sanctioned_logging_buckets : can(regex("^[a-z0-9.-]+$", name)) && !strcontains(name, "*")])
    error_message = "sanctioned bucket names must be concrete S3 bucket names (lowercase letters, digits, dots, hyphens), never a wildcard."
  }
}

variable "sanctioned_delivery_role_arns" {
  description = "ARNs of the sanctioned firehose delivery roles allowed to write to the sanctioned buckets (bucket-policy principals)"
  type        = list(string)

  validation {
    condition     = length(var.sanctioned_delivery_role_arns) > 0 && alltrue([for arn in var.sanctioned_delivery_role_arns : can(regex("^arn:aws:iam::[0-9]{12}:role/.+$", arn))])
    error_message = "each sanctioned delivery-role ARN must be a concrete IAM role ARN."
  }
}

# Closed operator carve-out: the known logging-account principals that legitimately write to S3 outside
# the sanctioned buckets (service-linked roles, break-glass admin). The SCP Deny exempts exactly these
# via StringNotLike aws:PrincipalArn; everything else — including a renamed hand-rolled delivery role — is
# denied by default. Each entry must name a CONCRETE 12-digit account: a role-path glob is allowed
# (arn:aws:iam::123456789012:role/*) but a wildcard account (arn:aws:iam::*:*) would match every
# principal via StringNotLike and turn the Deny into NotApplicable — a total fail-OPEN. Empty is allowed:
# it means no exemptions.
variable "operator_writer_arns" {
  description = "aws:PrincipalArn allow-list (StringNotLike) of operator principals exempt from the firehose-destination Deny — the closed carve-out, account-scoped, never a wildcard account"
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for arn in var.operator_writer_arns : can(regex("^arn:aws:iam::[0-9]{12}:[a-z-]+/", arn)) && arn != "*"])
    error_message = "operator_writer_arns must be IAM principal ARNs scoped to a concrete 12-digit account (e.g. arn:aws:iam::123456789012:role/usage-delivery or .../role/*), never a wildcard account such as arn:aws:iam::*:* that would exempt every principal."
  }
}

variable "org_target_id" {
  description = "Organizations OU or account id the SCP attaches to (spans the tenant + logging accounts). Attach to a logging-scoped OU, not the Org root, in a multi-account Org — a root attachment denies org-wide except the sanctioned bucket."
  type        = string

  validation {
    condition     = can(regex("^(ou-[0-9a-z-]+|r-[0-9a-z]+|[0-9]{12})$", var.org_target_id))
    error_message = "org_target_id must be an OU id (ou-...), the root id (r-...), or a 12-digit account id."
  }
}

variable "org_id" {
  description = "AWS Organization id used in the bucket-policy aws:PrincipalOrgID condition"
  type        = string

  validation {
    condition     = can(regex("^o-[0-9a-z]+$", var.org_id))
    error_message = "org_id must be a valid AWS Organization id (o-...)."
  }
}
