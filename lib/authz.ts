import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as iam from 'aws-cdk-lib/aws-iam'
import {  fromContextOrError } from './utils'
import * as path from 'path'


export class AuthZ extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props)
    const stackname = fromContextOrError(this.node, 'stackname')
    console.log("Creating AuthZ Lambda:", stackname)
    new lambda.Function(this, 'Function', {
      functionName: `${stackname}-authz`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, './assets/lambdas/authorization')),
    })
  }
}
