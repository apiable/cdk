# Instructions
## CDK Basic installation
### Install CDK
If it is the first time running CDK on AWS, then you need to install the CDK toolkit following the instructions here: [https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html)

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