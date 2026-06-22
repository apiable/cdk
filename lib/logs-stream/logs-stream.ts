import * as cdk from 'aws-cdk-lib'
import { CfnOutput, CfnParameter, RemovalPolicy } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as kinesisfirehose from 'aws-cdk-lib/aws-kinesisfirehose'
import * as logs from 'aws-cdk-lib/aws-logs'
import { publishOutputs } from '@apiable/cdk-ssm-composition'
import { LOGS_BUCKET_ARN_PARAMETER } from '@apiable/parity-gate'
import { BUCKET_ARN_PATTERN_SOURCE, CONSTRUCT_NAME, TOKENS_CONSTRUCT_NAME } from './launch-stack-url'

/**
 * Logical id of the storage-location parameter the published template scopes the stream's destination by.
 * The parity gate owns the canonical spelling (it keys the destination-bucket parameter-identity reduction
 * on it), so the construct sources it from there and re-exports it for the launch-stack/test consumers.
 */
export { LOGS_BUCKET_ARN_PARAMETER }

/** Logical id of the stream-name parameter the published template scopes the stream's physical names by. */
export const STREAM_NAME_PARAMETER = 'StreamName'

/** Logical id of the destination-prefix parameter the published template routes records under. */
export const PREFIX_PARAMETER = 'DestinationPrefix'

/** Kebab kit-component segment the usage-log distribution publishes its outputs under. */
export const USAGELOGS_STREAM_COMPONENT = 'usagelogs-stream'

/** Kebab kit-component segment the api-key-token distribution publishes its outputs under. */
export const USAGETOKENS_STREAM_COMPONENT = 'usagetokens-stream'

/**
 * Author-declared, channel-identical identity the release-time parity gate keys the delivery role on
 * (the `apiable:logical-id` tag), so the same role compares equal across the CDK, published-CFN, and
 * Terraform channels regardless of its generated name, account, or region. The hand-rolled Terraform
 * module declares the identical literal. The firehose delivery stream is not a parity-gate taggable
 * primary, so only the role carries the declared id. The two distributions of the shared stream each
 * carry their own value so the token role is labelled for the token distribution, never as the usage-log
 * one — the role is a separate physical resource per stream, so the ids do not collide within a channel.
 */
export const FIREHOSE_ROLE_LOGICAL_ID = 'apiable-usagelogs-firehose-role'

/** The token distribution's delivery-role declared identity (see {@link FIREHOSE_ROLE_LOGICAL_ID}). */
export const FIREHOSE_ROLE_LOGICAL_ID_TOKENS = 'apiable-usagetokens-firehose-role'

/** Stream-name prefix the API gateway requires to attach to and write access logs to the stream. */
const GATEWAY_STREAM_NAME_PREFIX = 'amazon-apigateway-'

/** S3 key prefix the usage-log stream writes its records under when none is supplied. */
export const DEFAULT_USAGELOGS_PREFIX = 'apiable/aws'

/** S3 key prefix the api-key-token stream writes its records under — the routing signal the downstream pipeline keys off. */
export const DEFAULT_USAGETOKENS_PREFIX = 'apiable/aws/apikey-token'

/**
 * The delivery-role declared identity derived from a concrete stream name. Each distribution carries
 * its own id so the parity gate never sees two distributions collide on one declared id: the usage-log
 * variant gets the usage-log id, the token variant the token id, and any other variant a distinct
 * variant-derived id (`apiable-<variant>-firehose-role`) — never a silent fall-back to the usage-log id,
 * which would mislabel a new distribution as the usage-log one and collide on the gate. A tokenised
 * (published one-click) name carries no variant signal, so the published stack passes the id explicitly.
 */
export const firehoseRoleLogicalIdForName = (name: string): string => {
  if (cdk.Token.isUnresolved(name)) return FIREHOSE_ROLE_LOGICAL_ID
  // the variant is the leading segment of the name (`usagetokens-staging` → `usagetokens`)
  const variant = name.split('-')[0]
  if (variant === 'usagetokens') return FIREHOSE_ROLE_LOGICAL_ID_TOKENS
  if (variant === 'usagelogs') return FIREHOSE_ROLE_LOGICAL_ID
  return `apiable-${variant}-firehose-role`
}

export interface LogsStreamConstructProps {
  /** ARN of the log-storage bucket the stream writes to — a deploy-time input, never baked in. */
  readonly logsBucketArn: string
  /** Resource-name token the stream's physical names are scoped by (e.g. `usagelogs-staging`). */
  readonly name: string
  /** S3 key prefix the stream writes its `logs/` and `errors/` records under. Defaults to the usage-log prefix. */
  readonly prefix?: string
  /**
   * Tenant key the construct publishes its composition parameters under. Set together with
   * {@link publishComposition} to wire the SSM composition seam; omitting it leaves the seam off so an
   * existing customer's stack gains no new parameter resource.
   */
  readonly tenant?: string
  /**
   * Opt in to publishing the stream's firehose ARN to the shared parameter space at
   * `/apiable/{tenant}/{component}/firehose-arn`. Off by default: the seam is wired only for new kit
   * deployments, never auto-retrofitted onto an existing stack.
   */
  readonly publishComposition?: boolean
  /** Kit-component segment the composition key addresses this distribution under. Defaults to the usage-log component. */
  readonly compositionComponent?: string
  /**
   * Channel-stable `apiable:logical-id` the delivery role carries for the parity gate. Defaults to the
   * value derived from {@link name} (the token distribution's id when the name is a token-variant name,
   * the usage-log id otherwise); the published token stack supplies it explicitly since a tokenised name
   * carries no variant signal.
   */
  readonly firehoseRoleLogicalId?: string
}

/**
 * Apiable gateway usage-log delivery stream as a reusable construct: a Kinesis Firehose delivery
 * stream that writes to the customer's configured log-storage bucket, the delivery role the firehose
 * service assumes, and the CloudWatch log group/stream the delivery diagnostics go to.
 *
 * The storage location is a deploy-time input and the delivery role trusts only the firehose service
 * principal (no customer- or cross-account trust knob), so the artifact fixes no customer- or
 * deployment-specific identifier. This is the shared shape published under two distribution identities
 * (usage-log and api-key-token) that differ only by the default stream name and destination prefix.
 */
export class LogsStreamConstruct extends Construct {
  public readonly deliveryStream: kinesisfirehose.CfnDeliveryStream
  public readonly deliveryRole: iam.Role
  public readonly firehoseArnOutput: CfnOutput

  constructor(scope: Construct, id: string, props: LogsStreamConstructProps) {
    super(scope, id)

    if (!props.logsBucketArn) throw new Error('logsBucketArn is required to scope the delivery stream destination')
    if (!props.name) throw new Error('name is required to scope the delivery stream resources')

    const { logsBucketArn, name } = props
    const prefix = props.prefix ?? DEFAULT_USAGELOGS_PREFIX
    // A construct id may not contain a token, so a parameterised (published one-click) name falls back
    // to a static id while the physical names keep the full `${name}` interpolation (a CFN Sub). A
    // concrete name (the standalone/umbrella path) embeds in the id exactly as the existing deploy expects.
    const idSuffix = cdk.Token.isUnresolved(name) ? '' : `-${name}`

    const log = new logs.LogGroup(this, `firehose-log${idSuffix}`, {
      logGroupName: `/aws/firehose/logs-${name}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    })
    const stream = new logs.LogStream(this, `firehose-log-stream${idSuffix}`, {
      logGroup: log,
      logStreamName: `firehose-log-stream-${name}`,
      removalPolicy: RemovalPolicy.DESTROY,
    })

    this.deliveryRole = new iam.Role(this, 'FirehoseRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
      roleName: `apiable-${name}-firehose`,
      inlinePolicies: {
        FirehosePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                's3:AbortMultipartUpload',
                's3:GetBucketLocation',
                's3:GetObject',
                's3:ListBucket',
                's3:ListBucketMultipartUploads',
                's3:PutObject',
              ],
              resources: [logsBucketArn, `${logsBucketArn}/*`],
            }),
            new iam.PolicyStatement({
              actions: ['logs:PutLogEvents'],
              resources: [log.logGroupArn],
            }),
          ],
        }),
      },
    })
    // Declare the channel-stable identity on the role itself (never the stack — a stack-wide tag
    // propagates one id onto every resource and collapses them), so the parity gate compares it by
    // declared id rather than its name-derived discriminator. 'apiable:logical-id' is the gate's tag key.
    const firehoseRoleLogicalId = props.firehoseRoleLogicalId ?? firehoseRoleLogicalIdForName(name)
    cdk.Tags.of(this.deliveryRole).add('apiable:logical-id', firehoseRoleLogicalId)

    const streamConstructId = cdk.Token.isUnresolved(name)
      ? GATEWAY_STREAM_NAME_PREFIX.replace(/-$/, '')
      : `${GATEWAY_STREAM_NAME_PREFIX}${name}`
    this.deliveryStream = new kinesisfirehose.CfnDeliveryStream(this, streamConstructId, {
      deliveryStreamName: `${GATEWAY_STREAM_NAME_PREFIX}${name}`, // the name MUST start with amazon-apigateway-
      deliveryStreamType: 'DirectPut',
      s3DestinationConfiguration: {
        bucketArn: logsBucketArn,
        roleArn: this.deliveryRole.roleArn,
        prefix: `${prefix}/logs/`,
        errorOutputPrefix: `${prefix}/errors/`,
        bufferingHints: {
          intervalInSeconds: 300,
          sizeInMBs: 5,
        },
        cloudWatchLoggingOptions: {
          enabled: true,
          logGroupName: log.logGroupName,
          logStreamName: stream.logStreamName,
        },
        compressionFormat: 'UNCOMPRESSED', // UNCOMPRESSED | GZIP | ZIP | Snappy | HADOOP_SNAPPY
      },
    })

    // A concrete name embeds in the output logical id exactly as the standalone deploy expects; a
    // parameterised (token) name cannot be a logical id, so the published template uses a stable id.
    // The id names this distribution once (no doubled `usagelogs-usagelogs-` prefix); pin it so the
    // output key is stable and name-derived rather than carrying CDK's construct-path + hash suffix.
    const outputId = cdk.Token.isUnresolved(name) ? 'FirehoseArn' : `firehose-arn-${name}`
    this.firehoseArnOutput = new CfnOutput(this, outputId, { value: this.deliveryStream.attrArn })
    this.firehoseArnOutput.overrideLogicalId(outputId.replace(/[^A-Za-z0-9]/g, ''))

    if (props.publishComposition) {
      if (!props.tenant) throw new Error('tenant is required to publish composition parameters')
      publishOutputs(this, {
        tenant: props.tenant,
        component: props.compositionComponent ?? USAGELOGS_STREAM_COMPONENT,
        outputs: [{ name: 'firehose-arn', value: this.deliveryStream.attrArn }],
      })
    }
  }
}

/** Stack name conventions, declared-but-unused account/region carried for interface parity with the deploy scripts. */
export interface Env extends cdk.StackProps {
  account: string
  region: string
  logsBucketArn: string
  prefix: string
  name: string
}

export interface Props extends cdk.StackProps {
  env: Env
}

/**
 * Thin stack wrapper around {@link LogsStreamConstruct} for standalone CFN synth and umbrella
 * composition. The constructor contract — a Stack taking `Props { env: Env }` — is the one the
 * `deploy-*.sh` generators and the umbrella's `buildLogsStreamStack` pass, held constant so an
 * existing custom-deployed stream is unchanged.
 */
export class LogsStream extends cdk.Stack {
  public readonly logsStream: LogsStreamConstruct

  constructor(scope: Construct, id: string, props: Props) {
    const { logsBucketArn, prefix, name } = props.env

    super(scope, id, props)

    this.logsStream = new LogsStreamConstruct(this, 'LogsStream', { logsBucketArn, prefix, name })
  }
}

export interface LogsStreamStackProps extends cdk.StackProps {
  /**
   * ARN of the log-storage bucket the stream writes to. Omitting it (the published one-click path)
   * surfaces it as a deploy-time CFN parameter the launch link pre-fills.
   */
  readonly logsBucketArn?: string
  /** Resource-name token the stream's physical names are scoped by. Defaults to the usage-log name. */
  readonly name?: string
  /** S3 key prefix the stream writes under. Defaults to the usage-log prefix. */
  readonly prefix?: string
  /** Forwarded to {@link LogsStreamConstructProps.tenant}. */
  readonly tenant?: string
  /** Forwarded to {@link LogsStreamConstructProps.publishComposition}. */
  readonly publishComposition?: boolean
  /** Forwarded to {@link LogsStreamConstructProps.compositionComponent}. */
  readonly compositionComponent?: string
  /**
   * Default the stream-name parameter falls back to when {@link name} is omitted. Defaults to the
   * usage-log distribution's name; the token distribution supplies its own.
   */
  readonly defaultName?: string
  /**
   * Default the destination-prefix parameter falls back to when {@link prefix} is omitted. Defaults to
   * the usage-log distribution's prefix; the token distribution supplies its own.
   */
  readonly defaultPrefix?: string
  /** Forwarded to {@link LogsStreamConstructProps.firehoseRoleLogicalId} for this distribution's parity identity. */
  readonly firehoseRoleLogicalId?: string
}

/** Resource-name token the published one-click stream is scoped by when no name is supplied. */
export const DEFAULT_USAGELOGS_NAME = 'usagelogs'

/** Resource-name token the published one-click token stream is scoped by when no name is supplied. */
export const DEFAULT_USAGETOKENS_NAME = 'usagetokens'

/**
 * Stack wrapper that surfaces the storage location as a deploy-time CFN parameter for the published
 * one-click template; the stream name + prefix default to this distribution's values (the usage-log
 * distribution's unless overridden for the token distribution).
 */
export class LogsStreamStack extends cdk.Stack {
  public readonly logsStream: LogsStreamConstruct

  constructor(scope: Construct, id: string, props: LogsStreamStackProps = {}) {
    super(scope, id, props)

    const defaultName = props.defaultName ?? DEFAULT_USAGELOGS_NAME
    const defaultPrefix = props.defaultPrefix ?? DEFAULT_USAGELOGS_PREFIX

    let logsBucketArn = props.logsBucketArn
    if (logsBucketArn === undefined) {
      const logsBucketArnParameter = new CfnParameter(this, LOGS_BUCKET_ARN_PARAMETER, {
        type: 'String',
        minLength: 1,
        allowedPattern: BUCKET_ARN_PATTERN_SOURCE,
        description: 'ARN of the log-storage S3 bucket the delivery stream writes to',
        constraintDescription: 'must be a valid S3 bucket ARN (arn:aws:s3:::<bucket>)',
      })
      logsBucketArnParameter.overrideLogicalId(LOGS_BUCKET_ARN_PARAMETER)
      logsBucketArn = logsBucketArnParameter.valueAsString
    }

    // The stream name + destination prefix are deploy-time named values too; omitting them keeps this
    // distribution's defaults, so a one-click deploy with only the storage location reproduces the
    // existing stream while a customer can still override either.
    let name = props.name
    if (name === undefined) {
      const streamNameParameter = new CfnParameter(this, STREAM_NAME_PARAMETER, {
        type: 'String',
        default: defaultName,
        minLength: 1,
        description: 'Resource-name token the stream is scoped by (amazon-apigateway-<name>)',
      })
      streamNameParameter.overrideLogicalId(STREAM_NAME_PARAMETER)
      name = streamNameParameter.valueAsString
    }

    let prefix = props.prefix
    if (prefix === undefined) {
      const prefixParameter = new CfnParameter(this, PREFIX_PARAMETER, {
        type: 'String',
        default: defaultPrefix,
        minLength: 1,
        description: 'S3 key prefix the stream writes its logs/ and errors/ records under',
      })
      prefixParameter.overrideLogicalId(PREFIX_PARAMETER)
      prefix = prefixParameter.valueAsString
    }

    this.logsStream = new LogsStreamConstruct(this, 'LogsStream', {
      logsBucketArn,
      name,
      prefix,
      tenant: props.tenant,
      publishComposition: props.publishComposition,
      compositionComponent: props.compositionComponent,
      firehoseRoleLogicalId: props.firehoseRoleLogicalId,
    })
  }
}

/**
 * Build the usage-log-stream stack as published in the launch-stack template: no `env`, so the region
 * resolves to AWS::Region and the storage location stays a deploy-time parameter.
 *
 * Single source of the publish-time synth config so the artifact a customer one-clicks is exactly what
 * the published-stack spec asserts.
 */
export const buildPublishedStack = (app: cdk.App): LogsStreamStack =>
  new LogsStreamStack(app, CONSTRUCT_NAME, {
    description: 'Apiable gateway usage-log delivery stream — one-click provisioning',
    analyticsReporting: false,
    // an asset-less stream must install into an un-bootstrapped account, so drop the bootstrap-version rule
    synthesizer: new cdk.DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
  })

/**
 * Build the api-key-token-stream stack as published in the launch-stack template: the same shared
 * stream as {@link buildPublishedStack}, published under the token distribution identity — its
 * stream-name and destination-prefix parameters default to the token values and its delivery role
 * carries the token parity identity. The tokenised name carries no variant signal, so the token role id
 * is supplied explicitly here.
 */
export const buildPublishedTokensStack = (app: cdk.App): LogsStreamStack =>
  new LogsStreamStack(app, TOKENS_CONSTRUCT_NAME, {
    description: 'Apiable gateway api-key-token delivery stream — one-click provisioning',
    analyticsReporting: false,
    defaultName: DEFAULT_USAGETOKENS_NAME,
    defaultPrefix: DEFAULT_USAGETOKENS_PREFIX,
    firehoseRoleLogicalId: FIREHOSE_ROLE_LOGICAL_ID_TOKENS,
    compositionComponent: USAGETOKENS_STREAM_COMPONENT,
    // an asset-less stream must install into an un-bootstrapped account, so drop the bootstrap-version rule
    synthesizer: new cdk.DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
  })
