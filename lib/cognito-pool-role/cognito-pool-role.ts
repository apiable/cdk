import * as cdk from 'aws-cdk-lib'
import { CfnOutput, CfnParameter } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as iam from 'aws-cdk-lib/aws-iam'
import { publishOutputs } from '@apiable/cdk-ssm-composition'
import { EXTERNAL_ID_PARAMETER, USER_POOL_ID_PARAMETER } from '../parity-gate/canonical'
import {
  ACCOUNT_ID_PATTERN,
  ACCOUNT_ID_PATTERN_SOURCE,
  CIDR_PATTERN,
  CIDR_PATTERN_SOURCE,
  DEFAULT_APIABLE_EGRESS_CIDR,
  DEFAULT_APIABLE_TRUST_ACCOUNT,
  EXTERNAL_ID_PATTERN_SOURCE,
} from '../gateway-role/launch-stack-url'

/** Component name; the first path segment of every published artifact key. */
export const CONSTRUCT_NAME = 'apiable-cognito-pool-role'

/** Logical id of the trust-account parameter; the launch-stack URL pre-fills `param_<this>`. */
export const TRUST_ACCOUNT_PARAMETER = 'ApiableTrustAccount'

/** Logical id of the egress-CIDR parameter; the launch-stack URL pre-fills `param_<this>`. */
export const EGRESS_CIDR_PARAMETER = 'ApiableEgressCidr'

export { EXTERNAL_ID_PARAMETER, USER_POOL_ID_PARAMETER }

/** Kebab kit-component segment this construct publishes its outputs under. */
export const COGNITO_POOL_ROLE_COMPONENT = 'cognito-pool-role'

/** The role's channel-stable identity (the `apiable:logical-id` tag); the Terraform module declares the identical literal. */
export const COGNITO_POOL_ROLE_LOGICAL_ID = 'apiable-cognito-pool-role'

/** Prefix of the role's name; the user pool id completes it, so one account holds one such role per pool. */
export const ROLE_NAME_PREFIX = 'apiable-cognito-pool-role-'

/** IAM's limit on a role name, which bounds the pool id the name is built from. */
const ROLE_NAME_MAX_LENGTH = 64

/** The longest user pool id the role name has room for. */
export const USER_POOL_ID_MAX_LENGTH = ROLE_NAME_MAX_LENGTH - ROLE_NAME_PREFIX.length

/** One Amazon Cognito user pool id: its Region, an underscore, and the pool's own suffix. */
export const USER_POOL_ID_PATTERN_SOURCE = '^[a-z]{2}(-[a-z]+)+-[0-9]_[0-9a-zA-Z]+$'

/** Compiled form of {@link USER_POOL_ID_PATTERN_SOURCE} for runtime validation. */
export const USER_POOL_ID_PATTERN = new RegExp(USER_POOL_ID_PATTERN_SOURCE)

/** The Region a user pool id names: everything before its underscore. */
export const regionOfUserPoolId = (userPoolId: string): string => userPoolId.split('_')[0]

/**
 * The only operations the role allows, all on the one pool: list the pool's resource servers, and read,
 * update, create and delete an app client. Listing the pool's clients, reading the pool itself, the
 * client-secret operations, resource-server writes and user administration are left out on purpose.
 */
export const APP_CLIENT_ACTIONS: readonly string[] = [
  'cognito-idp:ListResourceServers',
  'cognito-idp:DescribeUserPoolClient',
  'cognito-idp:UpdateUserPoolClient',
  'cognito-idp:CreateUserPoolClient',
  'cognito-idp:DeleteUserPoolClient',
]

export interface CognitoPoolRoleProps {
  /** AWS account authorised to assume the role. Omitting it defaults to Apiable's account. */
  readonly trustAccount?: string
  /**
   * CIDR Apiable's calls originate from; the role refuses every request from outside it. Omitting it
   * defaults to Apiable's published egress address.
   */
  readonly egressCidr?: string
  /**
   * The user pool the role manages app clients in. Omitting it declares a deploy-time parameter for it,
   * as the published template does. A pool id given here must name the Region the stack deploys to.
   */
  readonly userPoolId?: string
  /** Tenant key the construct publishes its composition parameters under, with {@link publishComposition}. */
  readonly tenant?: string
  /** Opt in to publishing the role ARN at `/apiable/{tenant}/cognito-pool-role/role-arn`. Off by default. */
  readonly publishComposition?: boolean
}

/**
 * Role that lets Apiable manage app clients in one Amazon Cognito user pool, and that only the API Portal
 * holding the External ID it is deployed with can assume. Deploying it creates nothing in the pool and
 * changes nothing about it.
 */
export class CognitoPoolRole extends Construct {
  public readonly role: iam.Role
  public readonly trustAccountParameter: CfnParameter
  public readonly egressCidrParameter: CfnParameter
  public readonly externalIdParameter: CfnParameter
  public readonly userPoolIdParameter?: CfnParameter
  public readonly roleArnOutput: CfnOutput

  constructor(scope: Construct, id: string, props: CognitoPoolRoleProps = {}) {
    super(scope, id)

    if (props.trustAccount !== undefined && !ACCOUNT_ID_PATTERN.test(props.trustAccount)) {
      throw new Error('trustAccount must be exactly one 12-digit AWS account id')
    }
    if (props.egressCidr !== undefined && !CIDR_PATTERN.test(props.egressCidr)) {
      throw new Error('egressCidr must be one IPv4 CIDR block, for example 203.0.113.4/32')
    }

    const stack = cdk.Stack.of(this)
    const region = stack.region

    if (props.userPoolId !== undefined && !cdk.Token.isUnresolved(props.userPoolId)) {
      if (!USER_POOL_ID_PATTERN.test(props.userPoolId) || props.userPoolId.length > USER_POOL_ID_MAX_LENGTH) {
        throw new Error('userPoolId must be one Amazon Cognito user pool id, for example eu-central-1_AbCdEfGhI')
      }
      if (!cdk.Token.isUnresolved(region) && regionOfUserPoolId(props.userPoolId) !== region) {
        throw new Error(`userPoolId ${props.userPoolId} names another Region than the stack's, ${region}`)
      }
    }

    this.trustAccountParameter = new CfnParameter(this, TRUST_ACCOUNT_PARAMETER, {
      type: 'String',
      default: props.trustAccount ?? DEFAULT_APIABLE_TRUST_ACCOUNT,
      allowedPattern: ACCOUNT_ID_PATTERN_SOURCE,
      minLength: 12,
      maxLength: 12,
      description: 'AWS account authorised to assume the Apiable user pool role',
      constraintDescription: 'must be exactly one 12-digit AWS account id',
    })
    this.trustAccountParameter.overrideLogicalId(TRUST_ACCOUNT_PARAMETER)

    this.egressCidrParameter = new CfnParameter(this, EGRESS_CIDR_PARAMETER, {
      type: 'String',
      default: props.egressCidr ?? DEFAULT_APIABLE_EGRESS_CIDR,
      allowedPattern: CIDR_PATTERN_SOURCE,
      description: 'CIDR Apiable calls from; the role refuses every request originating outside it',
      constraintDescription: 'must be an IPv4 CIDR block, for example 203.0.113.4/32',
    })
    this.egressCidrParameter.overrideLogicalId(EGRESS_CIDR_PARAMETER)

    // No default: the ID is each API Portal's own, so there is no value to default to.
    this.externalIdParameter = new CfnParameter(this, EXTERNAL_ID_PARAMETER, {
      type: 'String',
      allowedPattern: EXTERNAL_ID_PATTERN_SOURCE,
      description: 'External ID your API Portal shows; the role refuses every request to assume it that does not carry this ID',
      constraintDescription: 'must be the External ID your API Portal shows, a lowercase version 4 UUID',
    })
    this.externalIdParameter.overrideLogicalId(EXTERNAL_ID_PARAMETER)

    let userPoolId: string
    if (props.userPoolId !== undefined) {
      userPoolId = props.userPoolId
    } else {
      this.userPoolIdParameter = new CfnParameter(this, USER_POOL_ID_PARAMETER, {
        type: 'String',
        allowedPattern: USER_POOL_ID_PATTERN_SOURCE,
        maxLength: USER_POOL_ID_MAX_LENGTH,
        description: 'Id of the Amazon Cognito user pool, in this account and Region, whose app clients your API Portal manages',
        constraintDescription: 'must be one user pool id, for example eu-central-1_AbCdEfGhI',
      })
      this.userPoolIdParameter.overrideLogicalId(USER_POOL_ID_PARAMETER)
      userPoolId = this.userPoolIdParameter.valueAsString
    }

    this.role = new iam.Role(this, 'CognitoPoolRole', {
      assumedBy: new iam.AccountPrincipal(this.trustAccountParameter.valueAsString),
      externalIds: [this.externalIdParameter.valueAsString],
      roleName: `${ROLE_NAME_PREFIX}${userPoolId}`,
      description: 'Role for Apiable to manage app clients in one Amazon Cognito user pool',
    })
    // On the role, never the stack: a stack-wide tag would give every resource the same identity.
    cdk.Tags.of(this.role).add('apiable:logical-id', COGNITO_POOL_ROLE_LOGICAL_ID)

    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ApiableAppClientsOnOnePool',
        effect: iam.Effect.ALLOW,
        actions: [...APP_CLIENT_ACTIONS],
        resources: [`arn:aws:cognito-idp:${region}:${stack.account}:userpool/${userPoolId}`],
      }),
    )
    // Every operation but the five is refused outright, so a wider Allow added later reaches no other
    // operation without a new version of this role. Which pool the five reach is the Allow's alone.
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'DenyAllButAppClientOperations',
        effect: iam.Effect.DENY,
        notActions: [...APP_CLIENT_ACTIONS],
        resources: ['*'],
      }),
    )
    // The assumed credentials work from Apiable's address only; from anywhere else every call is refused.
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'DenyOutsideApiableEgress',
        effect: iam.Effect.DENY,
        actions: ['cognito-idp:*'],
        resources: ['*'],
        conditions: {
          NotIpAddress: { 'aws:SourceIp': this.egressCidrParameter.valueAsString },
        },
      }),
    )

    this.roleArnOutput = new CfnOutput(this, 'CognitoPoolRoleArn', {
      value: this.role.roleArn,
    })

    if (props.publishComposition) {
      if (!props.tenant) throw new Error('tenant is required to publish composition parameters')
      publishOutputs(this, {
        tenant: props.tenant,
        component: COGNITO_POOL_ROLE_COMPONENT,
        outputs: [{ name: 'role-arn', value: this.role.roleArn }],
      })
    }
  }
}

export interface CognitoPoolRoleStackProps extends cdk.StackProps {
  /** Forwarded to {@link CognitoPoolRoleProps.trustAccount}. */
  readonly trustAccount?: string
  /** Forwarded to {@link CognitoPoolRoleProps.userPoolId}. */
  readonly userPoolId?: string
  /** Forwarded to {@link CognitoPoolRoleProps.tenant}. */
  readonly tenant?: string
  /** Forwarded to {@link CognitoPoolRoleProps.publishComposition}. */
  readonly publishComposition?: boolean
}

/** Thin stack wrapper so the construct synthesizes standalone into the published template. */
export class CognitoPoolRoleStack extends cdk.Stack {
  public readonly cognitoPoolRole: CognitoPoolRole

  constructor(scope: Construct, id: string, props: CognitoPoolRoleStackProps = {}) {
    super(scope, id, props)
    this.cognitoPoolRole = new CognitoPoolRole(this, 'CognitoPoolRole', {
      trustAccount: props.trustAccount,
      userPoolId: props.userPoolId,
      tenant: props.tenant,
      publishComposition: props.publishComposition,
    })
  }
}

/**
 * Build the stack as published in the launch-stack template: no `env`, so the Region and account resolve
 * at deployment, and the pool id, the trusted account and the External ID stay deploy-time parameters.
 */
export const buildPublishedStack = (app: cdk.App): CognitoPoolRoleStack =>
  new CognitoPoolRoleStack(app, CONSTRUCT_NAME, {
    description: 'Apiable user pool role - one-click provisioning',
    analyticsReporting: false,
    // an asset-less role must install into an un-bootstrapped account, so drop the bootstrap-version rule
    synthesizer: new cdk.DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
  })
