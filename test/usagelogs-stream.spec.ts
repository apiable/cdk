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
        S3DestinationConfiguration: Match.objectLike({
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
        S3DestinationConfiguration: Match.objectLike({ Prefix: `${DEFAULT_USAGELOGS_PREFIX}/logs/` }),
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
