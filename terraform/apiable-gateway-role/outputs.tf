output "role_arn" {
  description = "ARN of the gateway-management role"
  value       = aws_iam_role.this.arn
}
