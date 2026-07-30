import * as cdk from 'aws-cdk-lib'
import { CfnOutput, CfnParameter } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as path from 'path'
import { publishOutputs } from '@apiable/cdk-ssm-composition'
import {
  CONSTRUCT_NAME,
  FEATURE_PLANS_WITH_V3,
  FeaturePlan,
  TENANT_NAME_PATTERN,
  TENANT_NAME_PATTERN_SOURCE,
} from './launch-stack-url'

/** Logical id of the tenant-name parameter the published template scopes the pool by. */
export const TENANT_NAME_PARAMETER = 'TenantName'

/** Kebab kit-component segment this construct publishes its outputs under. */
export const COGNITO_POOL_COMPONENT = 'cognito-pool'

/** Resource-server identifier and the single admin scope the machine clients bind to. */
export const RESOURCE_SERVER_IDENTIFIER = 'apiable'
export const ADMIN_SCOPE_NAME = 'admin'

/** Cognito hard cap: scopes per app client. Bound sets stay well under it. */
export const MAX_SCOPES_PER_CLIENT = 50

/** The verbatim error a non-V3-capable feature plan fails with — never a silent fallback to V1/V2. */
export const TIER_GUARD_ERROR = 'V3_0 PreTokenGen requires Cognito Essentials or Plus'

/**
 * Author-declared, channel-identical identities the release-time parity gate keys the pool and the
 * pre-token function on (the `apiable:logical-id` tag), so each compares equal across the CDK,
 * published-CFN, and Terraform channels regardless of its generated name, account, region, or tenant
 * segment. The hand-rolled Terraform module declares the identical literals; a pool that omits the tag
 * surfaces as an explicit parity divergence rather than being inferred from its name.
 */
export const COGNITO_POOL_LOGICAL_ID = 'apiable-cognito-pool'
export const PRE_TOKEN_FUNCTION_LOGICAL_ID = 'apiable-cognito-pool-pretoken-fn'

export interface CognitoPoolProps {
  /** Tenant/stack identifier the pool is scoped to — the pool is named `apiable-<name>`. */
  readonly name: string
  /**
   * Cognito feature plan the pool is provisioned on. Required and self-declared: V3_0 Pre Token
   * Generation runs only on ESSENTIALS or PLUS, so LITE (or any other value) fails the deploy loudly
   * rather than silently degrading to a V1 trigger that cannot enrich a machine-to-machine token.
   */
  readonly featurePlan: FeaturePlan
  /**
   * Opt in to publishing this construct's non-secret declared outputs (user-pool id, issuer URI) to
   * the shared parameter space at `/apiable/{name}/cognito-pool/{output}`, so the authorizer can
   * resolve `userpoolId` by key. Off by default. Client secrets are never published through this seam.
   */
  readonly publishComposition?: boolean
}

/**
 * Apiable machine-to-machine Cognito pool as a reusable construct: a single sign-in-disabled user pool
 * on a V3-capable feature plan, an `apiable` resource server with an `admin` scope, a `client_credentials`
 * app client bound to exactly that scope, and a V3_0 Pre Token Generation trigger that stamps the Apiable
 * claims into the access token. The consumers are OAuth2 app clients, not Cognito users, so there is no
 * user-attribute ceiling.
 *
 * `aws-cdk-lib` 2.137 cannot express the feature plan or the V3_0 trigger version through the L2
 * `UserPool`, so both are set as raw CloudFormation on the underlying `CfnUserPool` (the escape hatch);
 * bumping the lib re-synthesizes every construct, so the override is kept local to this pool.
 */
export class CognitoPool extends Construct {
  public readonly pool: cognito.UserPool
  public readonly resourceServer: cognito.UserPoolResourceServer
  public readonly client: cognito.UserPoolClient
  public readonly preTokenFunction: lambda.Function

  constructor(scope: Construct, id: string, props: CognitoPoolProps) {
    super(scope, id)

    if (!props.name) throw new Error('name is required to scope the cognito pool')
    if (!cdk.Token.isUnresolved(props.name) && !TENANT_NAME_PATTERN.test(props.name)) {
      throw new Error('name must be lowercase letters, digits, and hyphens')
    }
    // Fail-loud tier guard: a plan that cannot run V3_0 never degrades to a V1 trigger that would ship
    // tokens unable to carry the enrichment and quietly break downstream scope enforcement.
    if (!(FEATURE_PLANS_WITH_V3 as readonly string[]).includes(props.featurePlan)) {
      throw new Error(TIER_GUARD_ERROR)
    }

    const { name, featurePlan } = props
    const account = cdk.Stack.of(this).account
    const region = cdk.Stack.of(this).region

    // Machine-to-machine pool: no human sign-in (modelled on the existing AuthZ pool, not the sign-in
    // pool). Consumers are OAuth2 app clients, so self-sign-up is off and there are no sign-in aliases.
    this.pool = new cognito.UserPool(this, 'Pool', {
      userPoolName: `apiable-${name}`,
      deletionProtection: false,
      mfa: cognito.Mfa.OFF,
      selfSignUpEnabled: false,
      accountRecovery: cognito.AccountRecovery.NONE,
    })
    // Declare the channel-stable identity on the pool itself — never the stack, which collapses every
    // resource onto one id — so the parity gate keys it by declared id, not its tenant-scoped name.
    cdk.Tags.of(this.pool).add('apiable:logical-id', COGNITO_POOL_LOGICAL_ID)

    const cfnPool = this.pool.node.defaultChild as cognito.CfnUserPool
    // ESSENTIALS/PLUS is mandatory for V3_0 Pre Token Generation; not expressible via the L2 UserPool.
    cfnPool.addPropertyOverride('UserPoolTier', featurePlan)

    const adminScope = new cognito.ResourceServerScope({
      scopeName: ADMIN_SCOPE_NAME,
      scopeDescription: 'Full Access to the Apiable APIs',
    })

    this.resourceServer = this.pool.addResourceServer('ResourceServer', {
      userPoolResourceServerName: RESOURCE_SERVER_IDENTIFIER,
      identifier: RESOURCE_SERVER_IDENTIFIER,
      scopes: [adminScope],
    })

    // Render the hosted-UI domain as `apiable-<name>` identically on every channel (the published CFN
    // and Terraform channels cannot string-substitute a token name, so the CDK channel must not either).
    // A reserved Cognito substring (`aws`) fails the deploy identically across channels; cross-channel
    // reserved-name normalisation is a separate concern owned by the parity-gate capability slice.
    this.pool.addDomain('CognitoDomain', { cognitoDomain: { domainPrefix: `apiable-${name}` } })

    // The machine consumer: client_credentials, bound to exactly the admin scope. Cognito issues the
    // `scope` claim natively from this allowed set — the pool cannot widen the bound scopes.
    this.client = new cognito.UserPoolClient(this, 'Client', {
      userPool: this.pool,
      userPoolClientName: 'apiable',
      generateSecret: true,
      oAuth: {
        flows: { clientCredentials: true },
        scopes: [cognito.OAuthScope.resourceServer(this.resourceServer, adminScope)],
      },
    })

    this.preTokenFunction = new lambda.Function(this, 'PreTokenGen', {
      functionName: `apiable-${name}-pretokengen`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../assets/lambdas/cognito-pool-pretokengen')),
      environment: {
        // Both claim sources have no machine-to-machine producer yet (no user => no user-attribute), so
        // both ship empty and are set explicitly to make the empty intentional. apiable_plan_resources
        // empty makes the authorizer grant the invoked API on a scope-pass; apiable_api_key empty means
        // the consumer sends no usageIdentifierKey. Per-client binding is deferred to a dedicated binding
        // story. The live entitlement is the native `scope` claim.
        APIABLE_API_KEY: '',
        APIABLE_PLAN_RESOURCES: '',
      },
    })
    cdk.Tags.of(this.preTokenFunction).add('apiable:logical-id', PRE_TOKEN_FUNCTION_LOGICAL_ID)

    // Attach the trigger as raw CloudFormation: the L2 UserPool at this CDK version cannot set V3_0.
    cfnPool.addPropertyOverride(
      'LambdaConfig.PreTokenGenerationConfig.LambdaArn',
      this.preTokenFunction.functionArn,
    )
    cfnPool.addPropertyOverride('LambdaConfig.PreTokenGenerationConfig.LambdaVersion', 'V3_0')

    // Cognito must be allowed to invoke the trigger. Scope to the account's user pools rather than this
    // pool's ARN so the permission does not depend on the pool, which would create a create-time cycle
    // with the LambdaConfig above; the permission must exist before Cognito validates the trigger.
    const cognitoInvokePermission = new lambda.CfnPermission(this, 'CognitoInvokePreTokenGen', {
      action: 'lambda:InvokeFunction',
      functionName: this.preTokenFunction.functionArn,
      principal: 'cognito-idp.amazonaws.com',
      sourceArn: `arn:aws:cognito-idp:${region}:${account}:userpool/*`,
    })
    cfnPool.node.addDependency(cognitoInvokePermission)

    const suffix = cdk.Token.isUnresolved(name) ? '' : name
    new CfnOutput(this, `UserPoolId${suffix}`, {
      value: this.pool.userPoolId,
      description: 'The id of the Cognito user pool',
    })
    new CfnOutput(this, `IssuerUri${suffix}`, {
      value: `https://cognito-idp.${region}.amazonaws.com/${this.pool.userPoolId}`,
      description: 'The OIDC issuer URI of the Cognito user pool',
    })
    new CfnOutput(this, `ClientId${suffix}`, {
      value: this.client.userPoolClientId,
      description: 'The id of the client_credentials app client',
    })

    if (props.publishComposition) {
      if (cdk.Token.isUnresolved(name)) {
        throw new Error('a concrete tenant name is required to publish composition parameters')
      }
      // Non-secret outputs only — publishOutputs refuses secret outputs, so the client secret is never
      // relayed through the plaintext parameter seam.
      publishOutputs(this, {
        tenant: name,
        component: COGNITO_POOL_COMPONENT,
        outputs: [
          { name: 'userpool-id', value: this.pool.userPoolId },
          { name: 'issuer-uri', value: `https://cognito-idp.${region}.amazonaws.com/${this.pool.userPoolId}` },
          { name: 'client-id', value: this.client.userPoolClientId },
        ],
      })
    }
  }
}

export interface CognitoPoolStackProps extends cdk.StackProps {
  /**
   * Tenant/stack identifier the pool is scoped to. Omitting it (the published one-click path) surfaces
   * the name as a deploy-time CFN parameter the launch link pre-fills.
   */
  readonly name?: string
  /**
   * Cognito feature plan. Forwarded to {@link CognitoPoolProps.featurePlan}; defaults to ESSENTIALS
   * (the lowest V3-capable tier) so the published one-click stack provisions a working V3_0 pool.
   */
  readonly featurePlan?: FeaturePlan
  /** Forwarded to {@link CognitoPoolProps.publishComposition} (requires a concrete {@link name}). */
  readonly publishComposition?: boolean
}

/** Thin stack wrapper so the construct synthesizes standalone into the published template. */
export class CognitoPoolStack extends cdk.Stack {
  public readonly cognitoPool: CognitoPool

  constructor(scope: Construct, id: string, props: CognitoPoolStackProps = {}) {
    super(scope, id, props)

    let name = props.name
    if (name === undefined) {
      const tenantNameParameter = new CfnParameter(this, TENANT_NAME_PARAMETER, {
        type: 'String',
        minLength: 1,
        allowedPattern: TENANT_NAME_PATTERN_SOURCE,
        description: 'Tenant identifier the cognito pool is scoped to (apiable-<name>)',
        constraintDescription: 'must be lowercase letters, digits, and hyphens',
      })
      tenantNameParameter.overrideLogicalId(TENANT_NAME_PARAMETER)
      name = tenantNameParameter.valueAsString
    }

    this.cognitoPool = new CognitoPool(this, 'CognitoPool', {
      name,
      featurePlan: props.featurePlan ?? 'ESSENTIALS',
      publishComposition: props.publishComposition,
    })
  }
}

/**
 * Build the cognito-pool stack as published in the launch-stack template: no `env`, so the account
 * resolves to AWS::AccountId, the region to AWS::Region, and the tenant name stays a deploy-time
 * parameter. Single source of the publish-time synth config so the artifact a customer one-clicks is
 * exactly what the published-stack spec asserts.
 */
export const buildPublishedStack = (app: cdk.App): CognitoPoolStack =>
  new CognitoPoolStack(app, CONSTRUCT_NAME, {
    description: 'Apiable Cognito machine-to-machine pool with V3_0 token customisation - one-click provisioning',
    analyticsReporting: false,
    synthesizer: new cdk.DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
  })
