import * as cdk from 'aws-cdk-lib'
import { GatewayRole } from '../lib/gatewayrole'

const app = new cdk.App()
// eslint-disable-next-line no-new
new GatewayRole(app, "GatewayRole", {
    stackName: "gatewayrole",
    description: "Gateway Management Role for Apiable",
    env: {
        account: "034444869755",
        region: "eu-west-2"
    }
})
