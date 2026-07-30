import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
/**
 * Author-declared, channel-identical identities the release-time parity gate keys the cognito pools and
 * the pre-token function on (the `apiable:logical-id` tag), so each compares equal across the CDK,
 * published-CFN, and Terraform channels regardless of its generated name, account, region, or tenant
 * segment. The hand-rolled Terraform module declares the identical literals; an enforced pool that omits
 * the tag surfaces as an explicit parity divergence rather than being inferred from its name.
 */
export declare const AUTHN_POOL_LOGICAL_ID = "apiable-authn-pool";
export declare const AUTHZ_POOL_LOGICAL_ID = "apiable-authz-pool";
export declare const PRE_TOKEN_FUNCTION_LOGICAL_ID = "apiable-pretoken-fn";
export interface Env extends cdk.StackProps {
    account: string;
    region: string;
    name: string;
    domain?: string;
    fromEmail?: string;
}
export interface Props extends cdk.StackProps {
    env: Env;
}
export declare class Cognito extends cdk.Stack {
    constructor(scope: Construct, id: string, props: Props);
}
