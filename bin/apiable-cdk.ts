import * as cdk from 'aws-cdk-lib'
import { AuthZ } from '../lib/authz'

const app = new cdk.App()
// eslint-disable-next-line no-new
new AuthZ(app, "AuthZ", {
    stackName: "auth-portal-authz-dev",
    description: "AuthZ Lambda for Apiable Gateway Authorization dev",
    env: {
        account: "034444869755",
        region: "eu-central-1"
    }
})
