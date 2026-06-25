import * as cdk from 'aws-cdk-lib'
import { GatewayRoleStack, GATEWAY_ROLE_COMPONENT } from '../gateway-role'
import { LogsBucketStack, LOGS_BUCKET_COMPONENT } from '../logs-bucket'
import { Cognito } from '../cognito'
import { AuthZ } from '../authz'
import { LogsStream } from '../logs-stream'
import { readUpstreamOutput } from '@apiable/cdk-ssm-composition'

/** Kebab kit-component segments the composition keys address each construct under (single-sourced from each construct). */
export const compositionComponent = {
  gatewayRole: GATEWAY_ROLE_COMPONENT,
  logsBucket: LOGS_BUCKET_COMPONENT,
} as const

/**
 * The umbrella deployment for an existing custom-deployed Apiable tenant. Each component is a
 * single CloudFormation stack the customer deploys with one of the `deploy-*.sh` generators.
 *
 * The umbrella delegates each stack to its library export and never re-implements a resource:
 * `gatewayrole` and `logs-bucket` delegate to the kit `Construct`-wrapper stacks
 * (`GatewayRoleStack` / `LogsBucketStack`); `cognito`, `authz`, and `usagelogs-stream` delegate to
 * the library stack classes. The synthesized CloudFormation is identical to what the generators
 * produced inline, so an existing customer sees no change.
 */
export type UmbrellaComponent =
  | 'gatewayrole'
  | 'logs-bucket'
  | 'usagelogs-stream'
  | 'cognito'
  | 'authz'

/** Account + region every umbrella component is deployed into. */
export interface UmbrellaAccountEnv {
  readonly account: string
  readonly region: string
}

export interface GatewayRoleConfig {
  readonly env: UmbrellaAccountEnv
}

export interface LogsBucketConfig {
  /** Tenant/stack identifier the bucket is scoped to (`apiable-logs-<name>`). */
  readonly name: string
  readonly env: UmbrellaAccountEnv
}

/** Stream variant the firehose stack serves; selects stack-name and resource-name conventions. */
export type LogsStreamVariant = 'usagelogs' | 'usagetokens'

export interface LogsStreamConfig {
  /** Stream variant — `usagelogs` (the access-log firehose) or `usagetokens` (the api-key-token firehose). */
  readonly variant: LogsStreamVariant
  /** Stack/resource identifier suffix (e.g. `staging`); composed with the variant into names. */
  readonly stackSuffix: string
  /** ARN of the logs bucket the firehose writes to (cross-stack, hand-relayed today). */
  readonly logsBucketArn: string
  readonly env: UmbrellaAccountEnv
}

/** S3 key prefix each stream variant writes its records under. */
const logsStreamPrefix: Record<LogsStreamVariant, string> = {
  usagelogs: 'apiable/aws',
  usagetokens: 'apiable/aws/apikey-token',
}

const logsStreamDescription: Record<LogsStreamVariant, string> = {
  usagelogs: 'Usage Logs stream for Apiable Portal',
  usagetokens: 'Usage Tokens Logs stream for Apiable Portal',
}

export interface CognitoConfig {
  /** Pool/stack identifier; the user pool is `portal-<name>`. */
  readonly name: string
  readonly domain?: string
  readonly fromEmail?: string
  readonly env: UmbrellaAccountEnv
}

export interface AuthZConfig {
  /** Stack identifier; the authorizer lambda is `<name>-authz`. */
  readonly name: string
  readonly userpoolId: string
  readonly assumeRoleArn: string
  readonly authMethod?: string
  readonly apiGatewayAssumeRoleArn: string
  readonly apiGatewayRegion?: string
  readonly env: UmbrellaAccountEnv
}

/** Stack name each component carries, held constant so an existing customer's stack is unchanged. */
export const umbrellaStackName = {
  gatewayrole: () => 'gatewayrole',
  logsBucket: (name: string) => `apiable-${name}-logs-bucket`,
  logsStream: (variant: LogsStreamVariant, suffix: string) => `${variant}-stream-apiable-${suffix}`,
  cognito: (poolName: string) => `auth-portal-${poolName}`,
  authz: (name: string) => `auth-portal-authz-${name}`,
}

/** Resource-name token the firehose stack scopes its physical names by (e.g. `usagelogs-staging`). */
const logsStreamResourceName = (variant: LogsStreamVariant, suffix: string): string => `${variant}-${suffix}`

export const buildGatewayRoleStack = (app: cdk.App, config: GatewayRoleConfig): cdk.Stack =>
  new GatewayRoleStack(app, 'GatewayRole', {
    stackName: umbrellaStackName.gatewayrole(),
    description: 'Gateway Management Role for Apiable',
    env: config.env,
  })

export const buildLogsBucketStack = (app: cdk.App, config: LogsBucketConfig): cdk.Stack =>
  new LogsBucketStack(app, 'LogsBucket', {
    stackName: umbrellaStackName.logsBucket(config.name),
    description: 'Apiable S3 Bucket to write logs into',
    name: config.name,
    env: config.env,
  })

export const buildLogsStreamStack = (app: cdk.App, config: LogsStreamConfig): cdk.Stack =>
  new LogsStream(app, 'LogsStream', {
    stackName: umbrellaStackName.logsStream(config.variant, config.stackSuffix),
    description: `${logsStreamDescription[config.variant]} ${config.stackSuffix}`,
    env: {
      account: config.env.account,
      region: config.env.region,
      logsBucketArn: config.logsBucketArn,
      prefix: logsStreamPrefix[config.variant],
      name: logsStreamResourceName(config.variant, config.stackSuffix),
    },
  })

export const buildCognitoStack = (app: cdk.App, config: CognitoConfig): cdk.Stack =>
  new Cognito(app, 'Cognito', {
    stackName: umbrellaStackName.cognito(config.name),
    description: `Cognito Pool for Apiable ${config.name} Portal`,
    env: {
      account: config.env.account,
      region: config.env.region,
      name: config.name,
      domain: config.domain,
      fromEmail: config.fromEmail,
    },
  })

export const buildAuthZStack = (app: cdk.App, config: AuthZConfig): cdk.Stack =>
  new AuthZ(app, 'AuthZ', {
    stackName: umbrellaStackName.authz(config.name),
    description: `AuthZ Lambda for Apiable Gateway Authorization ${config.name}`,
    env: {
      account: config.env.account,
      region: config.env.region,
      name: config.name,
      userpoolId: config.userpoolId,
      assumeRoleArn: config.assumeRoleArn,
      authMethod: config.authMethod,
      apiGatewayAssumeRoleArn: config.apiGatewayAssumeRoleArn,
      apiGatewayRegion: config.apiGatewayRegion,
    },
  })

/**
 * New-deploy composition variants. A new kit deployment is keyed by a concrete tenant, so each
 * upstream component publishes its declared outputs to the shared parameter space and each downstream
 * component resolves its dependency by key — replacing the `cdk-outputs.json` + README copy/paste
 * relay the existing-customer builders above still use. The composition seam is wired here by default
 * (default-on for new deploys); the existing-customer builders never enable it, so an installed stack
 * is never auto-retrofitted with new parameter resources.
 */
export const buildGatewayRoleStackComposed = (app: cdk.App, config: GatewayRoleConfig & { tenant: string }): cdk.Stack =>
  new GatewayRoleStack(app, 'GatewayRole', {
    stackName: umbrellaStackName.gatewayrole(),
    description: 'Gateway Management Role for Apiable',
    env: config.env,
    tenant: config.tenant,
    publishComposition: true,
  })

export const buildLogsBucketStackComposed = (app: cdk.App, config: LogsBucketConfig): cdk.Stack =>
  new LogsBucketStack(app, 'LogsBucket', {
    stackName: umbrellaStackName.logsBucket(config.name),
    description: 'Apiable S3 Bucket to write logs into',
    name: config.name,
    env: config.env,
    publishComposition: true,
  })

/**
 * Read-side resolvers for the cross-component dependencies the composition seam carries: the logs
 * firehose consumes the logs-bucket ARN, and a future gateway-role consumer reads the gateway-role
 * ARN. They compose the same key the writer publishes under and read it by value from the shared
 * parameter space.
 *
 * `resolveLogsBucketArn` is forward-scaffolding: the firehose construct still takes the upstream ARN
 * as a string prop and is re-pointed onto this SSM read when it is extracted into a kit `Construct`.
 * Wiring the legacy stack here would regress the zero-drift equivalence, so the consumer-side wiring
 * lands with that construct-extraction story.
 *
 * `resolveGatewayRoleArn` has no live consumer: the extracted lambda-authorizer reads `apiable_api_key`
 * straight off the verified token claim and makes no cross-account `sts:AssumeRole`, so it needs no
 * gateway-role ARN. The resolver stays available for a future construct that does.
 */
export const resolveLogsBucketArn = (scope: cdk.Stack, tenant: string): string =>
  readUpstreamOutput(scope, { tenant, component: compositionComponent.logsBucket, output: 'bucket-arn' })

export const resolveGatewayRoleArn = (scope: cdk.Stack, tenant: string): string =>
  readUpstreamOutput(scope, { tenant, component: compositionComponent.gatewayRole, output: 'role-arn' })
