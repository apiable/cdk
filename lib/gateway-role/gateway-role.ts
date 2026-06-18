import * as cdk from 'aws-cdk-lib'
import { CfnOutput, CfnParameter } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as iam from 'aws-cdk-lib/aws-iam'
import { publishOutputs } from '@apiable/cdk-ssm-composition'
import {
  ACCOUNT_ID_PATTERN,
  ACCOUNT_ID_PATTERN_SOURCE,
  CONSTRUCT_NAME,
  DEFAULT_APIABLE_TRUST_ACCOUNT,
} from './launch-stack-url'

/** Logical id of the trust-account parameter; the launch-stack URL pre-fills `param_<this>`. */
export const TRUST_ACCOUNT_PARAMETER = 'ApiableTrustAccount'

/** Kebab kit-component segment this construct publishes its outputs under. */
export const GATEWAY_ROLE_COMPONENT = 'gateway-role'

/**
 * Author-declared, channel-identical identity the release-time parity gate keys the role on (the
 * `apiable:logical-id` tag), so the same role compares equal across the CDK, published-CFN, and
 * Terraform channels regardless of its generated name, account, or region. The hand-rolled Terraform
 * module declares the identical literal.
 */
export const GATEWAY_ROLE_LOGICAL_ID = 'apiable-gateway-role'

export interface GatewayRoleProps {
  /**
   * AWS account authorised to assume the gateway-management role. Omitting it defaults to
   * Apiable's account, reproducing the role existing customers already run.
   */
  readonly trustAccount?: string
  /**
   * Tenant key the construct publishes its composition parameters under. Set together with
   * {@link publishComposition} to wire the SSM composition seam; omitting it leaves the seam off so
   * an existing customer's stack gains no new parameter resource.
   */
  readonly tenant?: string
  /**
   * Opt in to publishing this construct's declared outputs to the shared parameter space at
   * `/apiable/{tenant}/gateway-role/{output}`. Off by default: the seam is wired only for new kit
   * deployments, never auto-retrofitted onto an existing stack.
   */
  readonly publishComposition?: boolean
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
    // Declare the channel-stable identity on the role itself (never the stack — a stack-wide tag
    // propagates one id onto every resource and collapses them), so the parity gate compares it by
    // declared id rather than its region-suffixed name. 'apiable:logical-id' is the gate's tag key.
    cdk.Tags.of(this.role).add('apiable:logical-id', GATEWAY_ROLE_LOGICAL_ID)

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

    if (props.publishComposition) {
      if (!props.tenant) throw new Error('tenant is required to publish composition parameters')
      publishOutputs(this, {
        tenant: props.tenant,
        component: GATEWAY_ROLE_COMPONENT,
        outputs: [{ name: 'role-arn', value: this.role.roleArn }],
      })
    }
  }
}

export interface GatewayRoleStackProps extends cdk.StackProps {
  /** Forwarded to {@link GatewayRoleProps.trustAccount}. */
  readonly trustAccount?: string
  /** Forwarded to {@link GatewayRoleProps.tenant}. */
  readonly tenant?: string
  /** Forwarded to {@link GatewayRoleProps.publishComposition}. */
  readonly publishComposition?: boolean
}

/** Thin stack wrapper so the construct synthesizes standalone into the published template. */
export class GatewayRoleStack extends cdk.Stack {
  public readonly gatewayRole: GatewayRole

  constructor(scope: Construct, id: string, props: GatewayRoleStackProps = {}) {
    super(scope, id, props)
    this.gatewayRole = new GatewayRole(this, 'GatewayRole', {
      trustAccount: props.trustAccount,
      tenant: props.tenant,
      publishComposition: props.publishComposition,
    })
  }
}

/**
 * Build the gateway-role stack as published in the launch-stack template: no `env`, so the
 * region resolves at deployment and the trusted account stays a deploy-time parameter.
 *
 * Single source of the publish-time synth config so the artifact a customer one-clicks is
 * exactly what the published-stack spec asserts.
 */
export const buildPublishedStack = (app: cdk.App): GatewayRoleStack =>
  new GatewayRoleStack(app, CONSTRUCT_NAME, {
    description: 'Apiable gateway-management role — one-click provisioning',
    analyticsReporting: false,
    // an asset-less role must install into an un-bootstrapped account, so drop the bootstrap-version rule
    synthesizer: new cdk.DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
  })
