import * as cdk from 'aws-cdk-lib'
import { AuthZ } from '../lib/authz'

const app = new cdk.App()
// eslint-disable-next-line no-new
new AuthZ(app, "AuthZ", {
    stackName: "auth-portal-authz-demo",
    description: "AuthZ Lambda for Apiable Gateway Authorization demo",
    env: {
        account: "034444869755",
        region: "eu-north-1"
    }
})
