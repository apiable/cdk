import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as iam from 'aws-cdk-lib/aws-iam'
import {  fromContextOrError } from './utils'
import * as path from 'path'
import {CfnOutput} from "aws-cdk-lib";

/**
 * The managed Node runtime the lambdas in this repo target. `nodejs20.x` was deprecated on
 * 2026-04-30, with creation disabled from 2027-02-01 and updates from 2027-03-03, so a customer
 * one-clicking a template that still named it would eventually get a stack that will not create.
 *
 * Built by hand rather than taken from `lambda.Runtime`, because aws-cdk-lib 2.137.0 predates the
 * constant (its newest is NODEJS_20_X) and that version is pinned as a peerDependency of every
 * construct package, so moving off it is its own change. Constructing a Runtime directly is CDK's
 * supported escape hatch for exactly this. The Terraform channel names the same string literally.
 */
const NODEJS_RUNTIME = new lambda.Runtime('nodejs22.x', lambda.RuntimeFamily.NODEJS, {
  // mirrors how aws-cdk-lib declares its own managed node runtimes; without it CDK refuses
  // `Code.fromInline` with "Inline source not allowed for nodejs22.x"
  supportsInlineCode: true,
})

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

export class AuthZ extends cdk.Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)


    const { account, region, name, userpoolId, assumeRoleArn, authMethod: authMethodProp, apiGatewayAssumeRoleArn, apiGatewayRegion } = props.env

    const authMethod = authMethodProp || 'JWT'

    console.log("Creating AuthZ Lambda:", name)

    if(!account) {
      throw new Error("account must be set in the stack props")
    }

    const policyLogs = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [`*`],
      actions: [
        'logs:*'
      ]
    })

    /* allows the lambda to assume roles in the Apiable account, in case the cognito pool is in Apiable AWS */
    const policyAssumeRoleApiable = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [`arn:aws:iam::034444869755:role/*`],
      actions: [
        'sts:AssumeRole'
      ]
    })

    /* allows the lambda to assume roles in the Client account, in case the cognito pool is in Client AWS  */
    const policyAssumeRole = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [`arn:aws:iam::${account}:role/*`],
      actions: [
        'sts:AssumeRole'
      ]
    })

    const role = new iam.Role(this, `${name}-authz-lambda-role`, {
      roleName: `${name}-authz-lambda-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        logs: new iam.PolicyDocument({
          statements: [policyLogs]
        }),
        assumeRole: new iam.PolicyDocument({
          statements: [policyAssumeRole, policyAssumeRoleApiable]
        })
      }
    })

    const environment: Record<string, string> = {
      AUTH_METHOD: authMethod,
      AUTH_REGION: region,
      APIABLE_AWS_AUTHZ_USERPOOLID: userpoolId,
      APIABLE_AWS_AUTHZ_ASSUME_ROLE_ARN: assumeRoleArn,
      APIABLE_AWS_AUTHZ_API_GATEWAY_ASSUME_ROLE_ARN: apiGatewayAssumeRoleArn,
      APIABLE_AWS_AUTHZ_CREDIT_SIGNING_KEY: "replace-me-with-your-key",
    }
    if (apiGatewayRegion !== undefined) {
      environment.APIABLE_AWS_AUTHZ_API_GATEWAY_REGION = apiGatewayRegion
    }

    const l = new lambda.Function(this, 'Function', {
      functionName: `${name}-authz`,
      runtime: NODEJS_RUNTIME,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, './assets/lambdas/authorization')),
      role,
      environment,
      timeout: cdk.Duration.seconds(30)
    })

    new CfnOutput(this, `${name}-authz-lambda-arn`, {
      exportName: `${name}-authz-lambda-arn`,
      value: l.functionArn
    });
    new CfnOutput(this, `${name}-authz-lambda-role-arn`, {
      exportName: `${name}-authz-lambda-role-arn`,
      value: role.roleArn
    });
  }
}
