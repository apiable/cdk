import * as cdk from 'aws-cdk-lib'
import { CfnOutput, CfnParameter, RemovalPolicy } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as kinesisfirehose from 'aws-cdk-lib/aws-kinesisfirehose'
import * as logs from 'aws-cdk-lib/aws-logs'
import { publishOutputs } from '@apiable/cdk-ssm-composition'
import { BUCKET_ARN_PATTERN_SOURCE, CONSTRUCT_NAME } from './launch-stack-url'

/** Logical id of the storage-location parameter the published template scopes the stream's destination by. */
export const LOGS_BUCKET_ARN_PARAMETER = 'LogsBucketArn'

/** Kebab kit-component segment the usage-log distribution publishes its outputs under. */
export const USAGELOGS_STREAM_COMPONENT = 'usagelogs-stream'

/**
 * Author-declared, channel-identical identity the release-time parity gate keys the delivery role on
 * (the `apiable:logical-id` tag), so the same role compares equal across the CDK, published-CFN, and
 * Terraform channels regardless of its generated name, account, or region. The hand-rolled Terraform
 * module declares the identical literal. The firehose delivery stream is not a parity-gate taggable
 * primary, so only the role carries the declared id.
 */
export const FIREHOSE_ROLE_LOGICAL_ID = 'apiable-usagelogs-firehose-role'

/** Stream-name prefix the API gateway requires to attach to and write access logs to the stream. */
const GATEWAY_STREAM_NAME_PREFIX = 'amazon-apigateway-'

/** S3 key prefix the usage-log stream writes its records under when none is supplied. */
export const DEFAULT_USAGELOGS_PREFIX = 'apiable/aws'

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

    const log = new logs.LogGroup(this, `firehose-log-${name}`, {
      logGroupName: `/aws/firehose/logs-${name}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    })
    const stream = new logs.LogStream(this, `firehose-log-stream-${name}`, {
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
    cdk.Tags.of(this.deliveryRole).add('apiable:logical-id', FIREHOSE_ROLE_LOGICAL_ID)

    this.deliveryStream = new kinesisfirehose.CfnDeliveryStream(this, `${GATEWAY_STREAM_NAME_PREFIX}${name}`, {
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
}

/** Resource-name token the published one-click stream is scoped by when no name is supplied. */
export const DEFAULT_USAGELOGS_NAME = 'usagelogs'

/**
 * Stack wrapper that surfaces the storage location as a deploy-time CFN parameter for the published
 * one-click template; the stream name + prefix default to the usage-log distribution's values.
 */
export class LogsStreamStack extends cdk.Stack {
  public readonly logsStream: LogsStreamConstruct

  constructor(scope: Construct, id: string, props: LogsStreamStackProps = {}) {
    super(scope, id, props)

    let logsBucketArn = props.logsBucketArn
    if (logsBucketArn === undefined) {
      const logsBucketArnParameter = new CfnParameter(this, LOGS_BUCKET_ARN_PARAMETER, {
        type: 'String',
        minLength: 1,
        allowedPattern: BUCKET_ARN_PATTERN_SOURCE,
        description: 'ARN of the log-storage S3 bucket the usage-log delivery stream writes to',
        constraintDescription: 'must be a valid S3 bucket ARN (arn:aws:s3:::<bucket>)',
      })
      logsBucketArnParameter.overrideLogicalId(LOGS_BUCKET_ARN_PARAMETER)
      logsBucketArn = logsBucketArnParameter.valueAsString
    }

    this.logsStream = new LogsStreamConstruct(this, 'LogsStream', {
      logsBucketArn,
      name: props.name ?? DEFAULT_USAGELOGS_NAME,
      prefix: props.prefix ?? DEFAULT_USAGELOGS_PREFIX,
      tenant: props.tenant,
      publishComposition: props.publishComposition,
      compositionComponent: props.compositionComponent,
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
