# apiable-lambda-authorizer (Terraform)

Hand-rolled HCL module that provisions the scope-enforcing gateway authorizer for the
`client_credentials` (machine-to-machine) flow: a TOKEN Lambda authorizer attached to an existing API
Gateway REST API, its least-privilege (logs-only) execution role, the API Gateway invoke permission,
and the `AWS::ApiGateway::Authorizer` wiring — the Terraform channel of the authorizer, equivalent to
the one-click CFN stack in `lib/lambda-authorizer`.

## Usage

```hcl
module "apiable_lambda_authorizer" {
  source       = "./terraform/apiable-lambda-authorizer"
  name         = "staging"
  user_pool_id = "eu-central-1_abc123"  # the Leaf B gateway pool whose tokens are validated
  rest_api_id  = "cqo3riplm6"           # the existing API Gateway REST API to attach to

  # Per-method required-scope map; a method absent from the map denies (deny-by-default).
  required_scope_map = {
    "GET /products" = "apiable/cicd"
  }
}
```

## Deny-by-default scope gate is the security crux

The authorizer gates each request on a per-method required-scope map. A method absent from the map, or
one whose required value is empty, **denies** — never allow-by-default. This is the load-bearing
per-method control, because the IAM policy flattens a `{proxy+}` route to `apiId/stage/*` (no per-method
IAM enforcement on a proxy route). `required_scope_map` is empty by default, so an un-configured
authorizer denies every request.

## Token trust boundary

The handler validates each access token's signature, issuer, expiry, and `token_use=access` against the
gateway pool — an ID/sign-in token or a token from another issuer is rejected. It logs only the caller
id and the allow/deny outcome, never the token, the claims, or the API key, and carries no committed
secret.

## Least-privilege execution role

The role grants only its own logging (`logs:CreateLogGroup` / `CreateLogStream` / `PutLogEvents`). The
greenfield authorizer reads no user pool via `adminGetUser` and assumes no cross-account role, so it
carries no `sts:AssumeRole` and no baked-in account.

## Channel-stable identity

The authorizer function and its role each carry an `apiable:logical-id` tag
(`apiable-lambda-authorizer-fn`, `apiable-lambda-authorizer-role`) identical to the CDK and one-click
CFN channels, so the release-time parity gate keys them by declared identity regardless of generated
name, account, or region.

## Attaches to an existing REST API

`rest_api_id` is a fixed input — the authorizer attaches to the customer's existing API Gateway rather
than provisioning one. The usage-plan / API-key wiring on the gateway side belongs to the
gateway/usage-plan construct.
