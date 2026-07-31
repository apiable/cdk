resource "aws_iam_role" "this" {
  # Fixed contract with already-provisioned tenants; the name is not parameterised.
  name        = "apiable-gateway-management-role-${var.region}"
  description = "Role for Apiable to manage the API Gateway"

  # Channel-stable identity the release-time parity gate keys this role on, identical to the CDK/CFN channels.
  tags = {
    "apiable:logical-id" = "apiable-gateway-role"
  }

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

  # Apiable manages credentials, never the APIs themselves. Statement-for-statement identical to the
  # CDK and published-CFN channels; the release-time parity gate compares them.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadRestApisOnly"
        Effect = "Allow"
        Action = "apigateway:GET"
        Resource = [
          "arn:aws:apigateway:${var.region}::/restapis",
          "arn:aws:apigateway:${var.region}::/restapis/*"
        ]
      },
      {
        Sid    = "ManageApiKeysAndUsagePlans"
        Effect = "Allow"
        Action = ["apigateway:GET", "apigateway:POST", "apigateway:PATCH", "apigateway:DELETE"]
        Resource = [
          "arn:aws:apigateway:${var.region}::/apikeys",
          "arn:aws:apigateway:${var.region}::/apikeys/*",
          "arn:aws:apigateway:${var.region}::/usageplans",
          "arn:aws:apigateway:${var.region}::/usageplans/*"
        ]
      },
      {
        Sid      = "TagUsagePlans"
        Effect   = "Allow"
        Action   = "apigateway:PUT"
        Resource = "arn:aws:apigateway:${var.region}::/tags/*"
      },
      {
        Sid    = "DenyHttpAndWebSocketApis"
        Effect = "Deny"
        Action = "apigateway:*"
        Resource = [
          "arn:aws:apigateway:${var.region}::/apis",
          "arn:aws:apigateway:${var.region}::/apis/*"
        ]
      },
      {
        # Fail-closed egress pin: a leaked set of assumed credentials is inert off this address.
        Sid       = "DenyOutsideApiableEgress"
        Effect    = "Deny"
        Action    = "apigateway:*"
        Resource  = "*"
        Condition = { NotIpAddress = { "aws:SourceIp" = var.egress_cidr } }
      }
    ]
  })
}
