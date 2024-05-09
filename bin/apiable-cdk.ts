import * as cdk from 'aws-cdk-lib'
import { Cognito } from '../lib/cognito'

const app = new cdk.App()
// eslint-disable-next-line no-new
new Cognito(app, "Cognito", {
    stackName: "auth-portal-demo2",
    description: "Cognito Pool for Apiable demo2 Portal",
    env: {
        account: "034444869755",
        region: "eu-central-1"
    }
})
