# apiable-gateway-role (Terraform)

Hand-rolled HCL module that provisions the `apiable-gateway-managment-role-<region>` IAM role — the Terraform channel of the gateway-management role, equivalent to the one-click CFN stack in `lib/gateway-role`.

## Usage

```hcl
module "apiable_gateway_role" {
  source = "./terraform/apiable-gateway-role"
  region = "eu-central-1"
  # trust_account defaults to the Apiable account; override only with a single 12-digit account id.
}
```

## Existing roles — do not apply in place

The role name `apiable-gateway-managment-role-<region>` is a fixed contract with already-provisioned tenants and is identical across both channels. Do **not** `terraform apply` this module into an account + region that already holds the role — whether provisioned by the one-click CFN stack or a prior apply: the create collides on the existing role name (`EntityAlreadyExists`).

To bring an existing role under Terraform management, import it before applying rather than re-creating it:

```bash
terraform import aws_iam_role.this apiable-gateway-managment-role-<region>
terraform import aws_iam_role_policy.apigateway_management apiable-gateway-managment-role-<region>:apigateway-management
```
