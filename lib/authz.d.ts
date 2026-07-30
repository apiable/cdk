import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
export interface Env extends cdk.StackProps {
    account: string;
    region: string;
    name: string;
    userpoolId: string;
    assumeRoleArn: string;
    authMethod?: string;
    apiGatewayAssumeRoleArn: string;
    apiGatewayRegion?: string;
}
export interface Props extends cdk.StackProps {
    env: Env;
}
export declare class AuthZ extends cdk.Stack {
    constructor(scope: Construct, id: string, props: Props);
}
