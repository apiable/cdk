import * as cdk from 'aws-cdk-lib'
import { UsageLogs } from '../lib/usagelogs'

const app = new cdk.App()
// eslint-disable-next-line no-new
new UsageLogs(app, "UsageLogs", {
    stackName: "usagelogs-apiable-dev",
    description: "Usage Logs for Apiable Portal dev",
    env: {
        account: "034444869755",
        region: "eu-west-1"
    }
})
