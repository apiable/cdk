import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as iam from 'aws-cdk-lib/aws-iam'
import {  fromContextOrError } from './utils'
import * as path from 'path'
import {CfnOutput} from "aws-cdk-lib";


export class AuthZ extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props)
    const stackname = fromContextOrError(this.node, 'stackname')
    const account = props.env?.account || 'undefined'
    console.log("Creating AuthZ Lambda:", stackname)

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

    const policyAssumeRole = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [`arn:aws:iam::${account}:role/*`],
      actions: [
        'sts:AssumeRole'
      ]
    })

    const role = new iam.Role(this, `${stackname}-authz-lambda-role`, {
      roleName: `${stackname}-authz-lambda-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        logs: new iam.PolicyDocument({
          statements: [policyLogs]
        }),
        assumeRole: new iam.PolicyDocument({
          statements: [policyAssumeRole]
        })
      }
    })

    const l = new lambda.Function(this, 'Function', {
      functionName: `${stackname}-authz`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, './assets/lambdas/authorization')),
      role
    })

    new CfnOutput(this, `${stackname}-authz-lambda-arn`, {
      exportName: `${stackname}-authz-lambda-arn`,
      value: l.functionArn
    });
    new CfnOutput(this, `${stackname}-authz-lambda-role-arn`, {
      exportName: `${stackname}-authz-lambda-role-arn`,
      value: role.roleArn
    });
  }
}
