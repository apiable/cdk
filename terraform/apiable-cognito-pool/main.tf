data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

resource "aws_cognito_user_pool" "this" {
  # Tenant-scoped name, fixed contract with already-provisioned tenants.
  name = "apiable-${var.name}"

  deletion_protection      = "INACTIVE"
  mfa_configuration        = "OFF"
  # ESSENTIALS/PLUS is mandatory for V3_0 Pre Token Generation; LITE cannot enrich an access token.
  user_pool_tier           = var.feature_plan
  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  lambda_config {
    pre_token_generation_config {
      lambda_arn     = aws_lambda_function.pretokengen.arn
      lambda_version = "V3_0"
    }
  }

  # Channel-stable identity the release-time parity gate keys this pool on, identical to the CDK/CFN channels.
  tags = {
    "apiable:logical-id" = "apiable-cognito-pool"
  }
}

resource "aws_cognito_resource_server" "apiable" {
  user_pool_id = aws_cognito_user_pool.this.id
  identifier   = "apiable"
  name         = "apiable"

  scope {
    scope_name        = "admin"
    scope_description = "Full Access to the Apiable APIs"
  }
}

resource "aws_cognito_user_pool_domain" "this" {
  user_pool_id = aws_cognito_user_pool.this.id
  domain       = "apiable-${var.name}"
}

resource "aws_cognito_user_pool_client" "apiable" {
  user_pool_id = aws_cognito_user_pool.this.id
  name         = "apiable"

  generate_secret                      = true
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["client_credentials"]
  # Bound to exactly the admin scope; Cognito issues the `scope` claim natively from this set.
  allowed_oauth_scopes                 = ["${aws_cognito_resource_server.apiable.identifier}/admin"]

  depends_on = [aws_cognito_resource_server.apiable]
}

resource "aws_lambda_function" "pretokengen" {
  function_name = "apiable-${var.name}-pretokengen"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  role          = aws_iam_role.pretokengen.arn

  filename         = data.archive_file.pretokengen.output_path
  source_code_hash = data.archive_file.pretokengen.output_base64sha256

  environment {
    variables = {
      # No machine-to-machine source for apiable_plan_resources yet; empty grants the invoked API on a
      # scope-pass. Per-method resource binding is deferred; the live entitlement is the native `scope`.
      APIABLE_PLAN_RESOURCES = ""
    }
  }

  # Channel-stable identity the release-time parity gate keys this function on, identical to the CDK/CFN channels.
  tags = {
    "apiable:logical-id" = "apiable-cognito-pool-pretoken-fn"
  }
}

data "archive_file" "pretokengen" {
  type        = "zip"
  source_file = "${path.module}/lambda/index.mjs"
  output_path = "${path.module}/.build/pretokengen.zip"
}

resource "aws_iam_role" "pretokengen" {
  name = "apiable-${var.name}-pretokengen-role"

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
}

resource "aws_iam_role_policy_attachment" "pretokengen_basic" {
  role       = aws_iam_role.pretokengen.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_permission" "cognito_invoke" {
  statement_id  = "CognitoInvokePreTokenGen"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.pretokengen.function_name
  principal     = "cognito-idp.amazonaws.com"
  # Scope to the account's user pools rather than this pool's ARN, so the permission does not depend on
  # the pool, which would create a create-time cycle with the lambda_config above.
  source_arn = "arn:aws:cognito-idp:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:userpool/*"
}
