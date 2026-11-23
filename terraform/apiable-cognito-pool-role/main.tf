data "aws_caller_identity" "current" {}

resource "aws_iam_role" "this" {
  # One role per pool: the pool id completes the name.
  name        = "apiable-cognito-pool-role-${var.user_pool_id}"
  description = "Role for Apiable to manage app clients in one Amazon Cognito user pool"

  # Channel-stable identity the release-time parity gate keys this role on, identical to the CDK/CFN channels.
  tags = {
    "apiable:logical-id" = "apiable-cognito-pool-role"
  }

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${var.trust_account}:root" }
        Action    = "sts:AssumeRole"
        Condition = { StringEquals = { "sts:ExternalId" = var.external_id } }
      }
    ]
  })

  lifecycle {
    # A pool id names its own Region; one from another Region than the role's would leave the role inert.
    precondition {
      condition     = split("_", var.user_pool_id)[0] == var.region
      error_message = "user_pool_id must name a user pool in the region the role is for."
    }
  }
}

resource "aws_iam_role_policy" "app_client_management" {
  name = "app-client-management"
  role = aws_iam_role.this.id

  # Statement-for-statement identical to the CDK and published-CFN channels; the release-time parity gate compares them.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ApiableAppClientsOnOnePool"
        Effect = "Allow"
        Action = [
          "cognito-idp:ListResourceServers",
          "cognito-idp:DescribeUserPoolClient",
          "cognito-idp:UpdateUserPoolClient",
          "cognito-idp:CreateUserPoolClient",
          "cognito-idp:DeleteUserPoolClient"
        ]
        Resource = "arn:aws:cognito-idp:${var.region}:${data.aws_caller_identity.current.account_id}:userpool/${var.user_pool_id}"
      },
      {
        Sid    = "DenyAllButAppClientOperations"
        Effect = "Deny"
        NotAction = [
          "cognito-idp:ListResourceServers",
          "cognito-idp:DescribeUserPoolClient",
          "cognito-idp:UpdateUserPoolClient",
          "cognito-idp:CreateUserPoolClient",
          "cognito-idp:DeleteUserPoolClient"
        ]
        Resource = "*"
      },
      {
        Sid       = "DenyOutsideApiableEgress"
        Effect    = "Deny"
        Action    = "cognito-idp:*"
        Resource  = "*"
        Condition = { NotIpAddress = { "aws:SourceIp" = var.egress_cidr } }
      }
    ]
  })
}
