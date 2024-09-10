import * as cdk from 'aws-cdk-lib'
import {CfnOutput} from 'aws-cdk-lib'
import {Construct} from 'constructs'
import * as iam from 'aws-cdk-lib/aws-iam'


export class GatewayRole extends cdk.Stack {

  constructor(scope: Construct, id: string, props: cdk.StackProps) {

    super(scope, id, props)
    const region = props.env?.region || null

    if(!region) throw new Error("region must be set in the stack props")

    const name = `apiable-gateway-managment-role`

    const gatewayRole = new iam.Role(this, `${name}-role`, {
      assumedBy: new iam.AccountPrincipal('034444869755'),
      roleName: name,
      description: `Role for Apiable to manage the API Gateway`,
    })

    gatewayRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [`arn:aws:apigateway:${region}::/*`],
        actions: [
          'apigateway:*'
        ]
      })
    )

    new CfnOutput(this, `${name}-arn`, { value: gatewayRole.roleArn });

  }
}
