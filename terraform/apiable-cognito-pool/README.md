# apiable-cognito-pool (Terraform)

Hand-rolled HCL module that provisions the `apiable-<name>` machine-to-machine Cognito user pool on a
V3-capable feature plan, its `apiable` resource server with an `admin` scope, a `client_credentials`
app client bound to exactly that scope, and the V3_0 Pre Token Generation trigger that stamps the
Apiable claims into the access token — the Terraform channel of the cognito pool, equivalent to the
one-click CFN stack in `lib/cognito-pool`.

## Usage

```hcl
module "apiable_cognito_pool" {
  source = "./terraform/apiable-cognito-pool"
  name   = "staging"
  # feature_plan defaults to ESSENTIALS; set PLUS for the higher tier. LITE is rejected — V3_0
  # PreTokenGen requires Cognito Essentials or Plus.
}
```

## Feature plan is load-bearing

V3_0 Pre Token Generation runs only on the ESSENTIALS or PLUS feature plan; on LITE it silently
no-ops. `feature_plan` is validated to ESSENTIALS or PLUS so the apply fails loudly rather than
provisioning a pool whose trigger never fires.

## Pre Token Generation claims

The pool's V3_0 trigger injects `apiable_api_key` and `apiable_plan_resources` into the access token.
Both ship empty — there is no machine-to-machine source for either yet (no user, so no user-attribute
pipeline) — and `APIABLE_API_KEY` / `APIABLE_PLAN_RESOURCES` are set explicitly to the empty string so
the empty is intentional rather than a silent fallthrough. An empty `apiable_plan_resources` makes the
downstream authorizer grant the invoked API on a scope-pass; an empty `apiable_api_key` means the
consumer sends no `usageIdentifierKey`. The live entitlement is the native `scope` claim, issued by
Cognito from the app client's bound scopes. Per-client binding (both claims) is deferred to a dedicated
binding story.

## Channel-stable identity

The pool and the trigger function each carry an `apiable:logical-id` tag (`apiable-cognito-pool`,
`apiable-cognito-pool-pretoken-fn`) identical to the CDK and one-click CFN channels, so the
release-time parity gate keys them by declared identity regardless of generated name, account, or
region.

## Existing pools — do not apply in place

The pool name `apiable-<name>` and the hosted-UI domain prefix `apiable-<name>` are a fixed contract
with already-provisioned tenants and are identical across all three channels. Do **not**
`terraform apply` this module for a `name` already provisioned by the one-click CFN stack or a prior
apply — import the existing resources before applying rather than re-creating them.
