variable "name" {
  description = "Tenant identifier the authorizer is scoped to (apiable-<name>-authz)"
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.name))
    error_message = "name must be lowercase letters, digits, and hyphens."
  }
}

variable "user_pool_id" {
  description = "Id of the Leaf B gateway pool whose client_credentials tokens the authorizer validates"
  type        = string
}

variable "rest_api_id" {
  description = "Id of the API Gateway REST API the authorizer is attached to"
  type        = string
}

variable "required_scope_map" {
  description = "Per-method required-scope map (route key -> apiable/<scope>); a method absent from the map denies (deny-by-default)"
  type        = map(string)
  default     = {}
}

variable "results_cache_ttl_seconds" {
  description = "Authorizer result-cache TTL in seconds; defaults to 0 because the cache masks per-token decisions"
  type        = number
  default     = 0
}
