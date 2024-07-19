import * as cdk from 'aws-cdk-lib'
import { UsageLogs } from '../lib/usagelogs'

const app = new cdk.App()
// eslint-disable-next-line no-new
new UsageLogs(app, "UsageLogs", {
    stackName: "usagelogs-apiable-alex",
    description: "Usage Logs for Apiable Portal alex",
    env: {
        account: "228289654720",
        region: "eu-central-1"
    }
})
