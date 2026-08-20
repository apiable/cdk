/**
 * Build-time guards and distribution-shape coverage for the LogsStream construct, beyond the
 * synth contract asserted in the construct contract spec. Exercises the shared shape both the
 * usage-log and (forward-looking) api-key-token distributions select via name + prefix.
 */
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import {
  LogsStream,
  LogsStreamStack,
  LogsStreamConstruct,
  FIREHOSE_ROLE_LOGICAL_ID,
  DEFAULT_USAGELOGS_NAME,
  DEFAULT_USAGELOGS_PREFIX,
  LOG_SOURCE_PARAMETER,
  LOG_SOURCE_APIGATEWAY_DIRECT,
  LOG_SOURCE_CLOUDWATCH_LOGS,
  LOG_SOURCE_VALUES,
} from '@apiable/cdk-usagelogs-stream'

const REGION = 'eu-central-1'
const ACCOUNT = '111111111111'
const BUCKET_ARN = 'arn:aws:s3:::apiable-logs-test'

const concrete = (env: Partial<{ logsBucketArn: string; prefix: string; name: string }> = {}): cdk.Stack =>
  new LogsStream(new cdk.App(), 's', {
    env: {
      account: ACCOUNT,
      region: REGION,
      logsBucketArn: env.logsBucketArn ?? BUCKET_ARN,
      prefix: env.prefix ?? DEFAULT_USAGELOGS_PREFIX,
      name: env.name ?? 'usagelogs-test',
    },
  })

describe('LogsStream construct — build-time guards', () => {
  it('rejects a blank storage location', () => {
    expect(() => concrete({ logsBucketArn: '' })).toThrow(/logsBucketArn is required/)
  })

  it('rejects a blank resource name', () => {
    expect(() => concrete({ name: '' })).toThrow(/name is required/)
  })

  it('a construct used directly under a stack still throws on a blank storage location', () => {
    const app = new cdk.App()
    const stack = new cdk.Stack(app, 'host')
    expect(() => new LogsStreamConstruct(stack, 'S', { logsBucketArn: '', name: 'usagelogs-test' })).toThrow(
      /logsBucketArn is required/,
    )
  })
})

describe('LogsStream construct — delivery identity is least-privilege and service-trusted', () => {
  it('grants the firehose role write only on the configured bucket and its objects, never a wildcard resource', () => {
    const t = Template.fromStack(concrete())
    const role = Object.values(t.findResources('AWS::IAM::Role'))[0] as {
      Properties: { Policies: { PolicyDocument: { Statement: { Resource: unknown; Action: unknown }[] } }[] }
    }
    const s3Statement = role.Properties.Policies[0].PolicyDocument.Statement.find(
      (s) => Array.isArray(s.Action) && (s.Action as string[]).some((a) => a.startsWith('s3:')),
    )
    expect(JSON.stringify(s3Statement?.Resource)).toContain(BUCKET_ARN)
    expect(JSON.stringify(s3Statement?.Resource)).not.toContain('"*"')
  })

  it('carries the declared parity identity on the role and on no other resource', () => {
    const t = Template.fromStack(concrete())
    t.hasResourceProperties(
      'AWS::IAM::Role',
      Match.objectLike({
        Tags: Match.arrayWith([Match.objectLike({ Key: 'apiable:logical-id', Value: FIREHOSE_ROLE_LOGICAL_ID })]),
      }),
    )
    // the delivery stream is not a parity-gate taggable primary — it carries no declared-id tag
    const streamJson = JSON.stringify(Object.values(t.findResources('AWS::KinesisFirehose::DeliveryStream'))[0])
    expect(streamJson).not.toContain('apiable:logical-id')
  })
})

describe('LogsStream construct — shared shape selects routing by name + prefix', () => {
  it('the api-key-token distribution routing (the 1-6 reuse) re-pins only name + prefix, same stream shape', () => {
    const t = Template.fromStack(
      concrete({ name: 'usagetokens-test', prefix: 'apiable/aws/apikey-token' }),
    )
    t.hasResourceProperties(
      'AWS::KinesisFirehose::DeliveryStream',
      Match.objectLike({
        DeliveryStreamName: 'amazon-apigateway-usagetokens-test',
        ExtendedS3DestinationConfiguration: Match.objectLike({
          Prefix: 'apiable/aws/apikey-token/logs/',
          ErrorOutputPrefix: 'apiable/aws/apikey-token/errors/',
          BufferingHints: { IntervalInSeconds: 300, SizeInMBs: 5 },
          CompressionFormat: 'UNCOMPRESSED',
        }),
      }),
    )
    t.hasResourceProperties('AWS::IAM::Role', Match.objectLike({ RoleName: 'apiable-usagetokens-test-firehose' }))
  })

  it('the token distribution output key names itself once and correctly (no usagelogs- mislabel)', () => {
    const t = Template.fromStack(concrete({ name: 'usagetokens-test', prefix: 'apiable/aws/apikey-token' }))
    const keys = Object.keys(t.findOutputs('*'))
    expect(keys).toHaveLength(1)
    expect(keys[0]).toBe('firehosearnusagetokenstest')
    expect(keys[0]).not.toMatch(/usagelogs/i)
  })
})

describe('LogsStreamStack — published one-click defaults', () => {
  it('with an explicit name + bucket, the stream is the concrete usage-log stream', () => {
    const t = Template.fromStack(
      new LogsStreamStack(new cdk.App(), 'pub', {
        logsBucketArn: BUCKET_ARN,
        name: DEFAULT_USAGELOGS_NAME,
        prefix: DEFAULT_USAGELOGS_PREFIX,
        env: { account: ACCOUNT, region: REGION },
      }),
    )
    t.hasResourceProperties(
      'AWS::KinesisFirehose::DeliveryStream',
      Match.objectLike({
        DeliveryStreamName: `amazon-apigateway-${DEFAULT_USAGELOGS_NAME}`,
        ExtendedS3DestinationConfiguration: Match.objectLike({ Prefix: `${DEFAULT_USAGELOGS_PREFIX}/logs/` }),
      }),
    )
  })

  it('the published path surfaces the stream name + prefix as deploy-time parameters defaulting to usage-log values', () => {
    const t = Template.fromStack(
      new LogsStreamStack(new cdk.App(), 'pub', { env: { account: ACCOUNT, region: REGION } }), // nothing supplied → all params
    )
    t.hasParameter('StreamName', Match.objectLike({ Default: DEFAULT_USAGELOGS_NAME }))
    t.hasParameter('DestinationPrefix', Match.objectLike({ Default: DEFAULT_USAGELOGS_PREFIX }))
  })

  it('surfaces a stable token output id when the name is parameterised (not name-derived per deploy)', () => {
    const t = Template.fromStack(
      new LogsStreamStack(new cdk.App(), 'pub', { env: { account: ACCOUNT, region: REGION } }), // no name → param path
    )
    expect(Object.keys(t.findOutputs('*'))).toContain('FirehoseArn')
  })
})

/**
 * The ingestion-path choice the published template offers. The direct path is what API Gateway has
 * always written to; the CloudWatch path is fed by a subscription filter, whose records arrive gzipped
 * and wrapped in a CloudWatch envelope and so need Firehose's two native processors to come out as the
 * same plain rows. Both live in one template, selected at deploy time.
 */
describe('LogsStream construct — the ingestion path the stream is built for', () => {
  const published = (props: Record<string, unknown> = {}): Template =>
    Template.fromStack(
      new LogsStreamStack(new cdk.App(), 'pub', { env: { account: ACCOUNT, region: REGION }, ...props }),
    )

  const concreteStream = (logSource?: string): Record<string, Record<string, unknown>> => {
    const t = published({
      logsBucketArn: BUCKET_ARN,
      name: DEFAULT_USAGELOGS_NAME,
      prefix: DEFAULT_USAGELOGS_PREFIX,
      ...(logSource === undefined ? {} : { logSource }),
    })
    const stream = Object.values(t.findResources('AWS::KinesisFirehose::DeliveryStream'))[0] as {
      Properties: Record<string, Record<string, unknown>>
    }
    return stream.Properties
  }

  it('offers both paths as a constrained deploy-time parameter, defaulting to the direct one', () => {
    // constrained, because a typo would otherwise deploy a silently direct-path stream that a
    // subscription filter can never feed; defaulted, so an unchanged one-click keeps today's stream
    published().hasParameter(
      LOG_SOURCE_PARAMETER,
      Match.objectLike({ Default: LOG_SOURCE_APIGATEWAY_DIRECT, AllowedValues: [...LOG_SOURCE_VALUES] }),
    )
  })

  it('one published template serves both paths, choosing the processors at deploy time', () => {
    const destination = published().toJSON().Resources as Record<string, { Type: string; Properties: Record<string, Record<string, unknown>> }>
    const stream = Object.values(destination).find((r) => r.Type === 'AWS::KinesisFirehose::DeliveryStream')
    const branches = (stream?.Properties.ExtendedS3DestinationConfiguration.ProcessingConfiguration as {
      'Fn::If': unknown[]
    })['Fn::If']
    expect(branches[0]).toBe('IsCloudWatchLogSource')
    expect(JSON.stringify(branches[1])).toContain('Decompression')
    // the direct path drops the block entirely rather than sending an empty one
    expect(branches[2]).toEqual({ Ref: 'AWS::NoValue' })
  })

  it('a direct-path stream carries no processing block, and needs no condition to say so', () => {
    expect(concreteStream(LOG_SOURCE_APIGATEWAY_DIRECT).ExtendedS3DestinationConfiguration.ProcessingConfiguration)
      .toBeUndefined()
    const t = published({ logsBucketArn: BUCKET_ARN, name: DEFAULT_USAGELOGS_NAME, logSource: LOG_SOURCE_APIGATEWAY_DIRECT })
    expect(t.toJSON().Conditions).toBeUndefined()
  })

  it('the standalone stack, which offers no choice, still builds the direct-path stream it always did', () => {
    // LogsStream (the deploy-*.sh / umbrella path) passes no log source at all, so the construct default
    // is what keeps an existing custom deploy byte-identical rather than gaining an empty Fn::If
    const stream = Object.values(
      Template.fromStack(concrete()).findResources('AWS::KinesisFirehose::DeliveryStream'),
    )[0] as { Properties: Record<string, Record<string, unknown>> }
    expect(stream.Properties.ExtendedS3DestinationConfiguration.ProcessingConfiguration).toBeUndefined()
    expect(Template.fromStack(concrete()).toJSON().Conditions).toBeUndefined()
  })

  it('a CloudWatch-sourced stream gunzips first and unwraps second, with no Lambda anywhere', () => {
    // order matters: CloudWatchLogProcessing reads the envelope Decompression produces, and Firehose
    // refuses the pair in either other arrangement
    expect(concreteStream(LOG_SOURCE_CLOUDWATCH_LOGS).ExtendedS3DestinationConfiguration.ProcessingConfiguration)
      .toEqual({
        Enabled: true,
        Processors: [
          { Type: 'Decompression', Parameters: [{ ParameterName: 'CompressionFormat', ParameterValue: 'GZIP' }] },
          {
            Type: 'CloudWatchLogProcessing',
            Parameters: [{ ParameterName: 'DataMessageExtraction', ParameterValue: 'true' }],
          },
        ],
      })
    const t = published({ logsBucketArn: BUCKET_ARN, name: DEFAULT_USAGELOGS_NAME, logSource: LOG_SOURCE_CLOUDWATCH_LOGS })
    t.resourceCountIs('AWS::Lambda::Function', 0)
  })

  it('the path does not rename the stream or retune its destination, so the ARN and routing survive a switch', () => {
    const direct = concreteStream(LOG_SOURCE_APIGATEWAY_DIRECT)
    const cloudwatch = concreteStream(LOG_SOURCE_CLOUDWATCH_LOGS)
    expect(cloudwatch.DeliveryStreamName).toEqual(direct.DeliveryStreamName)
    expect(cloudwatch.DeliveryStreamType).toEqual(direct.DeliveryStreamType)
    const { ProcessingConfiguration: _dropped, ...cloudwatchDestination } = cloudwatch.ExtendedS3DestinationConfiguration
    expect(cloudwatchDestination).toEqual(direct.ExtendedS3DestinationConfiguration)
  })
})
