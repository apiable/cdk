import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
interface GptProxyPropsEnv extends cdk.StackProps {
    account: string;
    region: string;
    stackname: string;
    apikey: string;
    assistantId: string;
}
interface GptProxyProps extends cdk.StackProps {
    env: GptProxyPropsEnv;
}
export declare class GptProxy extends cdk.Stack {
    constructor(scope: Construct, id: string, props: GptProxyProps);
}
export {};
