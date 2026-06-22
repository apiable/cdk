output "userpool_id" {
  description = "Id of the Cognito user pool"
  value       = aws_cognito_user_pool.this.id
}

output "issuer_uri" {
  description = "OIDC issuer URI of the Cognito user pool"
  value       = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.this.id}"
}

output "client_id" {
  description = "Id of the client_credentials app client"
  value       = aws_cognito_user_pool_client.apiable.id
}
