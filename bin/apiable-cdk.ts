import * as cdk from 'aws-cdk-lib'
import { GptProxy } from '../lib/gpt-proxy'

const app = new cdk.App()
// eslint-disable-next-line no-new
new GptProxy(app, "GptProxy", {
    stackName: "aidemo-gpt-proxy",
    description: "Gpt Proxy to connect to chatGpt Engine aidemo and write proper log stream for billing",
    env: {
        account: "034444869755",
        region: "eu-west-2",
        apikey: "sk-svcacct-NmVZbszlwnMNRa2OKmi0kieBxImeQ49p-266J5tZ6_cFd7QZuvyYL1El0MyuqHeOOmK1T3BlbkFJaKLbiKiG4rBCjp89HIROfkZsKZb68Xa9Z9Uq46d09Myw-aorYb4Yl0P46bDozOdWP-UA",
        stackname: "aidemo",
        assistantId: "asst_PLda8IjH1A5pQQFnfs3AGJ6K"
    }
})
