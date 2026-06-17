resource "aws_iam_role" "this" {
  # Fixed contract with already-provisioned tenants; the name is not parameterised.
  name        = "apiable-gateway-managment-role-${var.region}"
  description = "Role for Apiable to manage the API Gateway"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${var.trust_account}:root" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "apigateway_management" {
  name = "apigateway-management"
  role = aws_iam_role.this.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "apigateway:*"
        Resource = "arn:aws:apigateway:${var.region}::/*"
      }
    ]
  })
}
