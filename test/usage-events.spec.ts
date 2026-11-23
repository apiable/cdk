/**
 * The usage-events construct: the logs bucket and the usage-log delivery stream composed in one stack,
 * the stream writing into the bucket the same stack creates.
 */
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { LOGS_BUCKET_LOGICAL_ID, LOGS_WRITE_ROLE_LOGICAL_ID } from '@apiable/cdk-logs-bucket'
import { FIREHOSE_ROLE_LOGICAL_ID } from '@apiable/cdk-usagelogs-stream'
import { UsageEvents, UsageEventsStack } from '@apiable/cdk-usage-events'

type Json = Record<string, unknown>
type Resource = { Type: string; Properties: Json }

const synthTemplate = (props: { partnerAccount?: string; logSource?: string } = {}): Json => {
  const stack = new cdk.Stack(new cdk.App(), 'Test')
  new UsageEvents(stack, 'UsageEvents', { name: 'staging', ...props })
  return Template.fromStack(stack).toJSON()
}
const synth = (props: { partnerAccount?: string; logSource?: string } = {}): Record<string, Resource> =>
  synthTemplate(props).Resources as Record<string, Resource>

const ofType = (resources: Record<string, Resource>, type: string): [string, Resource][] =>
  Object.entries(resources).filter(([, resource]) => resource.Type === type)

const sole = (resources: Record<string, Resource>, type: string): [string, Resource] => {
  const matches = ofType(resources, type)
  expect(matches).toHaveLength(1)
  return matches[0]
}

const declaredId = (resource: Resource): unknown =>
  ((resource.Properties.Tags ?? []) as { Key: string; Value: unknown }[]).find((tag) => tag.Key === 'apiable:logical-id')?.Value

describe('the usage-events construct provisions the whole customer-side pipeline in one stack', () => {
  // contract: 024-3-6 S1
  it('creates the bucket, its policy, the write role, the delivery stream, its role and its log group, and nothing else', () => {
    const resources = synth()
    const types = Object.values(resources).map((resource) => resource.Type).sort()

    expect(types).toEqual(
      [
        'AWS::IAM::Policy',
        'AWS::IAM::Role',
        'AWS::IAM::Role',
        'AWS::KinesisFirehose::DeliveryStream',
        'AWS::Logs::LogGroup',
        'AWS::Logs::LogStream',
        'AWS::S3::Bucket',
        'AWS::S3::BucketPolicy',
      ].sort(),
    )
    expect(types.some((type) => type.startsWith('AWS::ApiGateway') || type.startsWith('AWS::Organizations'))).toBe(false)
  })

  // contract: 024-3-6 S1
  it('names the bucket for the tenant and the stream for API Gateway, delivering under the usage-log prefixes', () => {
    const resources = synth()
    const [, bucket] = sole(resources, 'AWS::S3::Bucket')
    const [, stream] = sole(resources, 'AWS::KinesisFirehose::DeliveryStream')
    const destination = stream.Properties.ExtendedS3DestinationConfiguration as Json

    expect(bucket.Properties.BucketName).toBe('apiable-logs-staging')
    expect(stream.Properties.DeliveryStreamName).toBe('amazon-apigateway-usagelogs')
    expect(destination.Prefix).toBe('apiable/aws/logs/')
    expect(destination.ErrorOutputPrefix).toBe('apiable/aws/errors/')
  })
})

describe('the stream can only write to the bucket the stack created', () => {
  // contract: 024-3-6 S3
  it("binds the stream's destination to the composed bucket", () => {
    const resources = synth()
    const [bucketId] = sole(resources, 'AWS::S3::Bucket')
    const [, stream] = sole(resources, 'AWS::KinesisFirehose::DeliveryStream')

    expect((stream.Properties.ExtendedS3DestinationConfiguration as Json).BucketARN).toEqual({ 'Fn::GetAtt': [bucketId, 'Arn'] })
  })

  // contract: 024-3-6 S3
  it("grants the delivery role S3 access on the composed bucket and its objects only", () => {
    const resources = synth()
    const [bucketId] = sole(resources, 'AWS::S3::Bucket')
    const deliveryRole = ofType(resources, 'AWS::IAM::Role').map(([, role]) => role).find((role) => declaredId(role) === FIREHOSE_ROLE_LOGICAL_ID)
    const statements = ((deliveryRole?.Properties.Policies as { PolicyDocument: { Statement: Json[] } }[])[0].PolicyDocument.Statement)
    const s3Statement = statements.find((statement) => (statement.Action as string[]).some((action) => action.startsWith('s3:')))

    expect(s3Statement?.Resource).toEqual([
      { 'Fn::GetAtt': [bucketId, 'Arn'] },
      { 'Fn::Join': ['', [{ 'Fn::GetAtt': [bucketId, 'Arn'] }, '/*']] },
    ])
  })

  // contract: 024-3-6 S3
  it('gives the bucket, the write role and the delivery role their own distinct declared ids', () => {
    const resources = synth()
    const [, bucket] = sole(resources, 'AWS::S3::Bucket')
    const roleIds = ofType(resources, 'AWS::IAM::Role').map(([, role]) => declaredId(role))

    expect(declaredId(bucket)).toBe(LOGS_BUCKET_LOGICAL_ID)
    expect(roleIds.sort()).toEqual([FIREHOSE_ROLE_LOGICAL_ID, LOGS_WRITE_ROLE_LOGICAL_ID].sort())
    expect(new Set([declaredId(bucket), ...roleIds]).size).toBe(3)
  })
})

describe('a partner account that is not exactly one account is refused', () => {
  // contract: 024-3-6 S4
  it.each([
    ['empty', ''],
    ['a wildcard', '*'],
    ['a list', '034444869755,111111111111'],
    ['eleven digits', '03444486975'],
  ])('refuses %s', (_label, partnerAccount) => {
    expect(() => synth({ partnerAccount })).toThrow('partnerAccount must be exactly one 12-digit AWS account id')
  })

  it('accepts exactly one 12-digit account as the partner-account default', () => {
    const parameters = synthTemplate({ partnerAccount: '222222222222' }).Parameters as Record<string, Json>

    expect(parameters.ApiablePartnerAccount.Default).toBe('222222222222')
  })
})

describe('the log source selects the stream processing', () => {
  it('builds the CloudWatch path with the decompress-then-extract processors', () => {
    const [, stream] = sole(synth({ logSource: 'cloudwatch_logs' }), 'AWS::KinesisFirehose::DeliveryStream')
    const processors = ((stream.Properties.ExtendedS3DestinationConfiguration as Json).ProcessingConfiguration as Json).Processors as Json[]

    expect(processors.map((processor) => processor.Type)).toEqual(['Decompression', 'CloudWatchLogProcessing'])
  })

  it('builds the direct path with no processing block', () => {
    const [, stream] = sole(synth(), 'AWS::KinesisFirehose::DeliveryStream')

    expect((stream.Properties.ExtendedS3DestinationConfiguration as Json).ProcessingConfiguration).toBeUndefined()
  })
})

describe('the stack with a concrete tenant', () => {
  it('synthesizes with no tenant-name parameter when the name is given', () => {
    const template = Template.fromStack(new UsageEventsStack(new cdk.App(), 'Concrete', { name: 'acme', logSource: 'apigateway_direct' })).toJSON()

    expect(Object.keys(template.Parameters ?? {}).filter((name) => name !== 'BootstrapVersion')).toEqual(['ApiablePartnerAccount'])
  })
})
