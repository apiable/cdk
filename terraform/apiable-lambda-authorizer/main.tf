data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# Least-privilege execution role: logging only. The greenfield authorizer reads no user pool via
# adminGetUser and assumes no cross-account role, so it carries no sts:AssumeRole and no baked-in account.
resource "aws_iam_role" "authz" {
  name = "apiable-${var.name}-authz-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  # Channel-stable identity the release-time parity gate keys this role on, identical to the CDK/CFN channels.
  tags = {
    "apiable:logical-id" = "apiable-lambda-authorizer-role"
  }
}

# Logs-only grant. The CDK channel embeds the identical document as a Policies entry on the role; the
# parity gate reduces both to the same inline-policy node, so the embedded and standalone shapes compare equal.
resource "aws_iam_role_policy" "logs" {
  name = "logs"
  role = aws_iam_role.authz.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "*"
      }
    ]
  })
}

resource "aws_lambda_function" "authz" {
  function_name = "apiable-${var.name}-authz"
  runtime       = "nodejs22.x"
  handler       = "index.handler"
  role          = aws_iam_role.authz.arn
  timeout       = 30

  filename         = data.archive_file.authz.output_path
  source_code_hash = data.archive_file.authz.output_base64sha256

  environment {
    variables = {
      APIABLE_AWS_AUTHZ_USERPOOLID = var.user_pool_id
      # Per-method required-scope map: empty by default, so an unmapped method denies (deny-by-default).
      REQUIRED_SCOPE_MAP = jsonencode(var.required_scope_map)
    }
  }

  # Channel-stable identity the release-time parity gate keys this function on, identical to the CDK/CFN channels.
  tags = {
    "apiable:logical-id" = "apiable-lambda-authorizer-fn"
  }
}

# Package the whole lambda/ tree (handler + vendored node_modules) so the bundled aws-jwt-verify
# dependency ships in the deployment artifact — the nodejs22.x managed runtime carries only @aws-sdk/*.
data "archive_file" "authz" {
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/.build/authz.zip"
}

resource "aws_lambda_permission" "apigateway_invoke" {
  statement_id  = "ApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.authz.function_name
  principal     = "apigateway.amazonaws.com"
  # Scope to the account's APIs in this region rather than the specific authorizer ARN, so the permission
  # does not depend on the authorizer resource (which references the function), avoiding a create-time cycle.
  source_arn = "arn:aws:execute-api:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:*"
}

# TOKEN authorizer attached to the existing REST API. The result cache masks per-token decisions, so the
# TTL defaults to 0 and a non-zero value is an explicit opt-in.
resource "aws_api_gateway_authorizer" "authz" {
  name                             = "apiable-${var.name}-authz"
  rest_api_id                      = var.rest_api_id
  type                             = "TOKEN"
  identity_source                  = "method.request.header.Authorization"
  authorizer_uri                   = "arn:aws:apigateway:${data.aws_region.current.name}:lambda:path/2015-03-31/functions/${aws_lambda_function.authz.arn}/invocations"
  authorizer_result_ttl_in_seconds = var.results_cache_ttl_seconds
}
