output "role_arn" {
  description = "ARN of the user pool role"
  value       = aws_iam_role.this.arn
}
