import * as cdk from 'aws-cdk-lib'
import { CfnOutput, CfnParameter } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as iam from 'aws-cdk-lib/aws-iam'
import {
  ACCOUNT_ID_PATTERN,
  ACCOUNT_ID_PATTERN_SOURCE,
  DEFAULT_APIABLE_TRUST_ACCOUNT,
} from './launch-stack-url'

/** Logical id of the trust-account parameter; the launch-stack URL pre-fills `param_<this>`. */
export const TRUST_ACCOUNT_PARAMETER = 'ApiableTrustAccount'

export interface GatewayRoleProps {
  /**
   * AWS account authorised to assume the gateway-management role. Omitting it defaults to
   * Apiable's account, reproducing the role existing customers already run.
   */
  readonly trustAccount?: string
}

/**
 * Role that authorises Apiable to manage a customer's API gateway, as a reusable construct.
 *
 * The trusted account is a single bounded deployment parameter and the region resolves to
 * the deployment region, so no customer- or Apiable-specific identifier is fixed in the
 * synthesized artifact.
 */
export class GatewayRole extends Construct {
  public readonly role: iam.Role
  public readonly trustAccountParameter: CfnParameter
  public readonly roleArnOutput: CfnOutput

  constructor(scope: Construct, id: string, props: GatewayRoleProps = {}) {
    super(scope, id)

    if (props.trustAccount !== undefined && !ACCOUNT_ID_PATTERN.test(props.trustAccount)) {
      throw new Error('trustAccount must be exactly one 12-digit AWS account id')
    }

    const region = cdk.Stack.of(this).region

    this.trustAccountParameter = new CfnParameter(this, TRUST_ACCOUNT_PARAMETER, {
      type: 'String',
      default: props.trustAccount ?? DEFAULT_APIABLE_TRUST_ACCOUNT,
      allowedPattern: ACCOUNT_ID_PATTERN_SOURCE,
      minLength: 12,
      maxLength: 12,
      description: 'AWS account authorised to assume the Apiable gateway-management role',
      constraintDescription: 'must be exactly one 12-digit AWS account id',
    })
    // Pin the logical id so the launch-stack URL's `param_ApiableTrustAccount` addresses it.
    this.trustAccountParameter.overrideLogicalId(TRUST_ACCOUNT_PARAMETER)

    const name = `apiable-gateway-managment-role-${region}`

    this.role = new iam.Role(this, 'GatewayManagementRole', {
      assumedBy: new iam.AccountPrincipal(this.trustAccountParameter.valueAsString),
      roleName: name,
      description: 'Role for Apiable to manage the API Gateway',
    })

    this.role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [`arn:aws:apigateway:${region}::/*`],
        actions: ['apigateway:*'],
      }),
    )

    this.roleArnOutput = new CfnOutput(this, 'GatewayManagementRoleArn', {
      value: this.role.roleArn,
    })
  }
}

export interface GatewayRoleStackProps extends cdk.StackProps {
  /** Forwarded to {@link GatewayRoleProps.trustAccount}. */
  readonly trustAccount?: string
}

/** Thin stack wrapper so the construct synthesizes standalone into the published template. */
export class GatewayRoleStack extends cdk.Stack {
  public readonly gatewayRole: GatewayRole

  constructor(scope: Construct, id: string, props: GatewayRoleStackProps = {}) {
    super(scope, id, props)
    this.gatewayRole = new GatewayRole(this, 'GatewayRole', { trustAccount: props.trustAccount })
  }
}
