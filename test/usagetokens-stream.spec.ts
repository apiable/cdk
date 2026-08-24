/**
 * Edge / integration coverage for the apiable-usagetokens-stream distribution beyond the frozen
 * contract scenarios: caller overrides, the opt-in composition seam under the token component, and the
 * published-template immutability (re-synth equivalence) for the token identity.
 */
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import {
  LogsStream,
  LogsStreamStack,
  buildPublishedTokensStack,
  DEFAULT_USAGETOKENS_PREFIX,
  USAGETOKENS_STREAM_COMPONENT,
  FIREHOSE_ROLE_LOGICAL_ID_TOKENS,
} from '@apiable/cdk-usagetokens-stream'

const ACCOUNT = '111111111111'
const REGION = 'eu-central-1'
const LOGS_BUCKET_ARN = 'arn:aws:s3:::apiable-logs-test'
const USAGETOKENS_NAME = 'usagetokens-test'

const concreteTokens = (over: { prefix?: string; name?: string } = {}): Template =>
  Template.fromStack(
    new LogsStream(new cdk.App(), 'apiable-usagetokens-stream', {
      stackName: 'usagetokens-stream-apiable-test',
      description: 'Usage Tokens Logs stream for Apiable Portal test',
      env: {
        account: ACCOUNT,
        region: REGION,
        logsBucketArn: LOGS_BUCKET_ARN,
        prefix: over.prefix ?? DEFAULT_USAGETOKENS_PREFIX,
        name: over.name ?? USAGETOKENS_NAME,
      },
    }),
  )

describe('apiable-usagetokens-stream — caller overrides', () => {
  it('routes records under a caller-supplied prefix when one is given (override beats the token default)', () => {
    const t = concreteTokens({ prefix: 'tenant/custom/path' })
    t.hasResourceProperties(
      'AWS::KinesisFirehose::DeliveryStream',
      Match.objectLike({
        ExtendedS3DestinationConfiguration: Match.objectLike({
          Prefix: 'tenant/custom/path/logs/',
          ErrorOutputPrefix: 'tenant/custom/path/errors/',
        }),
      }),
    )
  })

  it('scopes the role + log group physical names by a caller-supplied name', () => {
    const t = concreteTokens({ name: 'usagetokens-prod' })
    t.hasResourceProperties('AWS::IAM::Role', Match.objectLike({ RoleName: 'apiable-usagetokens-prod-firehose' }))
    t.hasResourceProperties('AWS::Logs::LogGroup', Match.objectLike({ LogGroupName: '/aws/firehose/logs-usagetokens-prod' }))
    // a concrete token name still resolves the correct token declared id
    t.hasResourceProperties(
      'AWS::IAM::Role',
      Match.objectLike({ Tags: Match.arrayWith([Match.objectLike({ Key: 'apiable:logical-id', Value: FIREHOSE_ROLE_LOGICAL_ID_TOKENS })]) }),
    )
  })
})

describe('apiable-usagetokens-stream — composition seam (opt-in, default-off, token component)', () => {
  const composed = (props: { publishComposition?: boolean; tenant?: string } = {}): Template =>
    Template.fromStack(
      new LogsStreamStack(new cdk.App(), 'apiable-usagetokens-stream', {
        logsBucketArn: LOGS_BUCKET_ARN,
        name: USAGETOKENS_NAME,
        prefix: DEFAULT_USAGETOKENS_PREFIX,
        compositionComponent: USAGETOKENS_STREAM_COMPONENT,
        env: { account: ACCOUNT, region: REGION },
        ...props,
      }),
    )

  it('default-off: an existing token stack gains no composition parameter resource', () => {
    composed().resourceCountIs('AWS::SSM::Parameter', 0)
  })

  it('opt-in: publishes the token firehose ARN under the TOKEN component key', () => {
    const t = composed({ publishComposition: true, tenant: 'staging' })
    t.resourceCountIs('AWS::SSM::Parameter', 1)
    t.hasResourceProperties(
      'AWS::SSM::Parameter',
      Match.objectLike({ Name: '/apiable/staging/usagetokens-stream/firehose-arn' }),
    )
  })

  it('opt-in without a concrete tenant throws (no silently-wrong key)', () => {
    expect(() => composed({ publishComposition: true })).toThrow(/tenant is required/)
  })
})

describe('apiable-usagetokens-stream — published-template immutability', () => {
  it('re-synthesizing the published token template produces an equivalent artifact', () => {
    const a = Template.fromStack(buildPublishedTokensStack(new cdk.App())).toJSON()
    const b = Template.fromStack(buildPublishedTokensStack(new cdk.App())).toJSON()
    expect(a.Resources).toEqual(b.Resources)
    expect(a.Parameters).toEqual(b.Parameters)
  })
})
