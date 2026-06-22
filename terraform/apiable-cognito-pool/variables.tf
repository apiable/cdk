variable "name" {
  description = "Tenant identifier the cognito pool is scoped to (apiable-<name>)"
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.name))
    error_message = "name must be lowercase letters, digits, and hyphens."
  }
}

variable "feature_plan" {
  description = "Cognito feature plan; must be ESSENTIALS or PLUS for V3_0 PreTokenGen"
  type        = string
  default     = "ESSENTIALS"

  # V3_0 PreTokenGen runs only on ESSENTIALS or PLUS; LITE (or anything else) fails loudly rather than
  # silently degrading to a V1 trigger that cannot enrich a machine-to-machine access token.
  validation {
    condition     = contains(["ESSENTIALS", "PLUS"], var.feature_plan)
    error_message = "feature_plan must be ESSENTIALS or PLUS: V3_0 PreTokenGen requires Cognito Essentials or Plus."
  }
}
