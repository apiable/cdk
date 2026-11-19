# apiable-cognito-pool-role (Terraform)

Hand-rolled HCL module that provisions the `apiable-cognito-pool-role-<user pool id>` IAM role, the Terraform channel of the user pool role, equivalent to the one-click CFN stack in `lib/cognito-pool-role`.

The role lets Apiable list the pool's resource servers and read, update, create and delete app clients in the one user pool named, from Apiable's address only, and only for a request that carries the External ID it is deployed with. It creates nothing in the pool and changes nothing about it.

## Usage

```hcl
module "apiable_cognito_pool_role" {
  source       = "./terraform/apiable-cognito-pool-role"
  region       = "eu-central-1"
  user_pool_id = "eu-central-1_AbCdEfGhI"
  external_id  = "<the External ID your API Portal shows>"
  # trust_account defaults to the Apiable account; override only with a single 12-digit account id.
}
```

The pool must be in `region`; a pool id from another region is refused at plan time.
