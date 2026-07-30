import * as cdk from 'aws-cdk-lib'
import { CfnOutput, CfnParameter } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as path from 'path'
import { readUpstreamOutput } from '@apiable/cdk-ssm-composition'
import { CONSTRUCT_NAME, TENANT_NAME_PATTERN, TENANT_NAME_PATTERN_SOURCE } from './launch-stack-url'

/** Logical id of the tenant-name parameter the published template scopes the authorizer by. */
export const TENANT_NAME_PARAMETER = 'TenantName'

/** Logical id of the gateway-pool id parameter the published template validates tokens against. */
export const USER_POOL_ID_PARAMETER = 'UserPoolId'

/** Logical id of the REST API id parameter the published template attaches the authorizer to. */
export const REST_API_ID_PARAMETER = 'RestApiId'

/** Kebab kit-component segment the cognito-pool construct publishes its outputs under (the SSM read seam). */
export const COGNITO_POOL_COMPONENT = 'cognito-pool'

/** Name of the cognito-pool output that carries the gateway-pool id (resolved by the SSM read seam). */
export const COGNITO_POOL_USERPOOL_ID_OUTPUT = 'userpool-id'

/** The authorizer type: a TOKEN authorizer reads the bearer token from the Authorization header. */
export const AUTHORIZER_TYPE = 'TOKEN'

/** Identity source of the TOKEN authorizer — the bearer token's header. */
export const AUTHORIZER_IDENTITY_SOURCE = 'method.request.header.Authorization'

/**
 * Default result-cache TTL (seconds). The authorizer result cache masks per-token decisions, so the
 * default is 0 — a non-zero TTL is opt-in via a prop.
 */
export const DEFAULT_RESULTS_CACHE_TTL_SECONDS = 0

/**
 * Author-declared, channel-identical identities the release-time parity gate keys the authorizer
 * function and its execution role on (the `apiable:logical-id` tag), so each compares equal across the
 * CDK, published-CFN, and Terraform channels regardless of its generated name, account, region, or
 * tenant segment. The hand-rolled Terraform module declares the identical literals; a resource that
 * omits the tag surfaces as an explicit parity divergence rather than being inferred from its name.
 */
export const AUTHORIZER_FUNCTION_LOGICAL_ID = 'apiable-lambda-authorizer-fn'
export const AUTHORIZER_ROLE_LOGICAL_ID = 'apiable-lambda-authorizer-role'

/** A per-method required-scope map: route key (`"<METHOD> <resourcePath>"`) → required `apiable/<scope>`. */
export type RequiredScopeMap = Readonly<Record<string, string>>

export interface LambdaAuthorizerProps {
  /** Tenant/stack identifier the authorizer is scoped to — resources are named `apiable-<name>-authz`. */
  readonly name: string
  /** Id of the API Gateway REST API the TOKEN authorizer is attached to. */
  readonly restApiId: string
  /**
   * Id of the Leaf B gateway pool whose `client_credentials` access tokens this authorizer validates.
   * Optional only when {@link resolveUserPoolIdFromComposition} resolves it from the shared parameter
   * space; otherwise it is required. Supplying it directly is the existing-customer override/fallback,
   * so the zero-drift path stays untouched.
   */
  readonly userPoolId?: string
  /**
   * Resolve the gateway-pool id from the cognito-pool construct's published output by key
   * (`/apiable/<name>/cognito-pool/userpool-id`) instead of a hand-relayed string prop. Off by default;
   * the {@link userPoolId} prop remains the override/fallback so 1-9's zero-drift path is untouched.
   */
  readonly resolveUserPoolIdFromComposition?: boolean
  /**
   * Per-method required-scope map. A method absent from the map, or one whose required value is empty,
   * DENIES (deny-by-default) at runtime. Required values carry the `apiable/` prefix. Empty by default
   * — with no mapped method the authorizer denies every request, the fail-closed posture.
   */
  readonly requiredScopeMap?: RequiredScopeMap
  /**
   * Result-cache TTL in seconds. The authorizer result cache masks per-token decisions, so this
   * defaults to 0; a non-zero value is an explicit opt-in.
   */
  readonly resultsCacheTtlSeconds?: number
}

/**
 * Apiable scope-enforcing gateway authorizer as a reusable construct: a TOKEN Lambda authorizer that
 * validates `client_credentials` (machine-to-machine) access tokens against a Leaf B gateway pool,
 * gates each request on a per-method required-scope map (deny-by-default), and emits the per-method IAM
 * policy from the token's `apiable_plan_resources` claim. Greenfield-clean — it carries none of the
 * legacy credit-metering, `adminGetUser`, or API-key fallback layers, and its execution role grants
 * only its own logging.
 *
 * The authorizer attaches to an existing API Gateway REST API (its id is a prop / deploy-time
 * parameter), so the construct emits the `AWS::ApiGateway::Authorizer` resource directly rather than
 * provisioning a gateway; the usage-plan / API-key wiring on the gateway side belongs to the
 * gateway/usage-plan construct.
 */
export class LambdaAuthorizer extends Construct {
  public readonly role: iam.Role
  public readonly authorizerFunction: lambda.Function
  public readonly authorizer: apigateway.CfnAuthorizer

  constructor(scope: Construct, id: string, props: LambdaAuthorizerProps) {
    super(scope, id)

    if (!props.name) throw new Error('name is required to scope the lambda authorizer')
    if (!cdk.Token.isUnresolved(props.name) && !TENANT_NAME_PATTERN.test(props.name)) {
      throw new Error('name must be lowercase letters, digits, and hyphens')
    }
    if (!props.restApiId) throw new Error('restApiId is required to attach the authorizer')

    const { name, restApiId } = props
    const region = cdk.Stack.of(this).region

    const userPoolId = props.resolveUserPoolIdFromComposition
      ? readUpstreamOutput(this, {
          tenant: name,
          component: COGNITO_POOL_COMPONENT,
          output: COGNITO_POOL_USERPOOL_ID_OUTPUT,
        })
      : props.userPoolId
    if (userPoolId === undefined) {
      throw new Error('userPoolId is required (supply it directly or set resolveUserPoolIdFromComposition)')
    }

    // Least-privilege execution role: logging only. The greenfield authorizer reads no user pool via
    // adminGetUser and assumes no cross-account role, so it carries no sts:AssumeRole and no baked-in
    // account — only the logs grant its own diagnostics need.
    this.role = new iam.Role(this, 'Role', {
      roleName: `apiable-${name}-authz-lambda-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        logs: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
              resources: ['*'],
            }),
          ],
        }),
      },
    })
    cdk.Tags.of(this.role).add('apiable:logical-id', AUTHORIZER_ROLE_LOGICAL_ID)

    this.authorizerFunction = new lambda.Function(this, 'Function', {
      functionName: `apiable-${name}-authz`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../assets/lambdas/authorization-cc')),
      role: this.role,
      environment: {
        APIABLE_AWS_AUTHZ_USERPOOLID: userPoolId,
        // Per-method required-scope map: empty by default, so an unmapped method denies (deny-by-default).
        REQUIRED_SCOPE_MAP: JSON.stringify(props.requiredScopeMap ?? {}),
      },
      timeout: cdk.Duration.seconds(30),
    })
    cdk.Tags.of(this.authorizerFunction).add('apiable:logical-id', AUTHORIZER_FUNCTION_LOGICAL_ID)

    // Allow API Gateway to invoke the authorizer Lambda. Scope to the account's APIs in this region
    // rather than the specific authorizer ARN, so the permission does not depend on the authorizer
    // resource (which references the function), avoiding a create-time cycle.
    const account = cdk.Stack.of(this).account
    this.authorizerFunction.addPermission('ApiGatewayInvoke', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${region}:${account}:*`,
    })

    // TOKEN authorizer attached to the existing REST API. The result cache masks per-token decisions,
    // so the TTL defaults to 0 and a non-zero value is an explicit opt-in.
    const authorizerUri = `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${this.authorizerFunction.functionArn}/invocations`
    this.authorizer = new apigateway.CfnAuthorizer(this, 'Authorizer', {
      restApiId,
      name: `apiable-${name}-authz`,
      type: AUTHORIZER_TYPE,
      identitySource: AUTHORIZER_IDENTITY_SOURCE,
      authorizerUri,
      authorizerResultTtlInSeconds: props.resultsCacheTtlSeconds ?? DEFAULT_RESULTS_CACHE_TTL_SECONDS,
    })

    const suffix = cdk.Token.isUnresolved(name) ? '' : name
    new CfnOutput(this, `AuthorizerFunctionArn${suffix}`, {
      value: this.authorizerFunction.functionArn,
      description: 'The ARN of the scope-enforcing authorizer Lambda',
    })
    new CfnOutput(this, `AuthorizerRoleArn${suffix}`, {
      value: this.role.roleArn,
      description: 'The ARN of the authorizer Lambda execution role',
    })
    new CfnOutput(this, `AuthorizerId${suffix}`, {
      value: this.authorizer.ref,
      description: 'The id of the TOKEN authorizer',
    })
  }
}

export interface LambdaAuthorizerStackProps extends cdk.StackProps {
  /**
   * Tenant/stack identifier the authorizer is scoped to. Omitting it (the published one-click path)
   * surfaces the name as a deploy-time CFN parameter the launch link pre-fills.
   */
  readonly name?: string
  /**
   * Id of the Leaf B gateway pool. Omitting it (the published one-click path) surfaces it as a
   * deploy-time CFN parameter the launch link pre-fills.
   */
  readonly userPoolId?: string
  /**
   * Id of the API Gateway REST API to attach to. Omitting it (the published one-click path) surfaces it
   * as a deploy-time CFN parameter the launch link pre-fills.
   */
  readonly restApiId?: string
  /** Forwarded to {@link LambdaAuthorizerProps.requiredScopeMap}. */
  readonly requiredScopeMap?: RequiredScopeMap
  /** Forwarded to {@link LambdaAuthorizerProps.resultsCacheTtlSeconds}. */
  readonly resultsCacheTtlSeconds?: number
}

/** Thin stack wrapper so the construct synthesizes standalone into the published template. */
export class LambdaAuthorizerStack extends cdk.Stack {
  public readonly lambdaAuthorizer: LambdaAuthorizer

  constructor(scope: Construct, id: string, props: LambdaAuthorizerStackProps = {}) {
    super(scope, id, props)

    let name = props.name
    if (name === undefined) {
      const tenantNameParameter = new CfnParameter(this, TENANT_NAME_PARAMETER, {
        type: 'String',
        minLength: 1,
        allowedPattern: TENANT_NAME_PATTERN_SOURCE,
        description: 'Tenant identifier the authorizer is scoped to (apiable-<name>-authz)',
        constraintDescription: 'must be lowercase letters, digits, and hyphens',
      })
      tenantNameParameter.overrideLogicalId(TENANT_NAME_PARAMETER)
      name = tenantNameParameter.valueAsString
    }

    let userPoolId = props.userPoolId
    if (userPoolId === undefined) {
      const userPoolIdParameter = new CfnParameter(this, USER_POOL_ID_PARAMETER, {
        type: 'String',
        minLength: 1,
        description: 'Id of the Leaf B gateway pool whose client_credentials tokens the authorizer validates',
      })
      userPoolIdParameter.overrideLogicalId(USER_POOL_ID_PARAMETER)
      userPoolId = userPoolIdParameter.valueAsString
    }

    let restApiId = props.restApiId
    if (restApiId === undefined) {
      const restApiIdParameter = new CfnParameter(this, REST_API_ID_PARAMETER, {
        type: 'String',
        minLength: 1,
        description: 'Id of the API Gateway REST API the authorizer is attached to',
      })
      restApiIdParameter.overrideLogicalId(REST_API_ID_PARAMETER)
      restApiId = restApiIdParameter.valueAsString
    }

    this.lambdaAuthorizer = new LambdaAuthorizer(this, 'LambdaAuthorizer', {
      name,
      userPoolId,
      restApiId,
      requiredScopeMap: props.requiredScopeMap,
      resultsCacheTtlSeconds: props.resultsCacheTtlSeconds,
    })
  }
}

/**
 * Build the lambda-authorizer stack as published in the launch-stack template: no `env`, so the account
 * resolves to AWS::AccountId, the region to AWS::Region, and the tenant name + gateway-pool id + REST
 * API id stay deploy-time parameters. Single source of the publish-time synth config so the artifact a
 * customer one-clicks is exactly what the published-stack spec asserts.
 */
export const buildPublishedStack = (app: cdk.App): LambdaAuthorizerStack =>
  new LambdaAuthorizerStack(app, CONSTRUCT_NAME, {
    description:
      'Apiable scope-enforcing gateway authorizer (client_credentials machine-to-machine flow) - one-click provisioning',
    analyticsReporting: false,
    synthesizer: new cdk.DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
  })
