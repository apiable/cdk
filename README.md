# Instructions
## CDK Basic installation
### Install CDK
If it is the first time running CDK on AWS, then you need to install the CDK toolkit following the instructions here: [https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html)

## Gateway Management Role installation
### Export the paramaters
```bash
export AWS_ACCOUNT_ID=<your_account_id>
export AWS_REGION=<your_region>
```
### Deploy the stack
```bash
./deploy-gatewayrole.sh
```
### Get the Role Arn
You can find the role arn in the output of the stack.

## AuthZ Gateway Authorizer installation
### Export the paramaters
```bash
export AWS_ACCOUNT_ID=<your_account_id>
export AWS_REGION=<your_region>
export STACKNAME=<your_pool_name>
export APIABLE_AWS_AUTHZ_USERPOOLID=<your_authz_userpool_id>
export APIABLE_AWS_AUTHZ_ASSUME_ROLE_ARN=<your_authz_assume_role_arn>
export AUTH_METHOD=JWT
```

### Deploy the stack
```bash
./deploy-authz.sh
```

## Cognito Pool installation
### Export the paramaters
```bash
export AWS_ACCOUNT_ID=<your_account_id>
export AWS_REGION=<your_region>
export POOLNAME=<your_pool_name>
export FROM_EMAIL=<your_from_email>
export SES_VERIFIED_DOMAIN=<your_ses_verified_domain>
```
### Deploy the stack
```bash
./deploy-cognito.sh
```

## Logging Reporting installation (for advanced reports and usage)
### Export the paramaters
```bash
export AWS_ACCOUNT_ID=<your_account_id>
export AWS_REGION=<your_region>
export STACKNAME=<your_pool_name>
```
### Deploy the stack
```bash
./deploy-usagelogs.sh
```




