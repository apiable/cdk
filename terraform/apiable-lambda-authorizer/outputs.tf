output "authorizer_function_arn" {
  description = "ARN of the scope-enforcing authorizer Lambda"
  value       = aws_lambda_function.authz.arn
}

output "authorizer_role_arn" {
  description = "ARN of the authorizer Lambda execution role"
  value       = aws_iam_role.authz.arn
}

output "authorizer_id" {
  description = "Id of the TOKEN authorizer"
  value       = aws_api_gateway_authorizer.authz.id
}
