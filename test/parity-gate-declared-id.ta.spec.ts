/**
 * Supplementary coverage for story 013-1-18 beyond the frozen contract scenarios: the declared-id
 * read mechanics per channel (CFN Tags list vs the UserPool UserPoolTags map; TF tags / tags_all),
 * the per-channel-unique missing sentinel, the enforced-vs-forward-compatible scoping, the empty-tag
 * boundary, and the bucket-primary value clobber. Every case drives the real reducers, never a copy
 * of the identity logic.
 */
import { ChannelModel, gate, reduceCloudFormation, reduceTerraformShowJson } from '@apiable/parity-gate'

const TAG = 'apiable:logical-id'
const refsOfKind = (model: ChannelModel, kind: string): string[] =>
  model.graph.nodes.filter((node) => node.kind === kind).map((node) => node.ref)

describe('declared-id identity (TA) — read mechanics per channel', () => {
  it('reads a user pool id from the UserPoolTags map (CFN) and a function id from the Tags list', () => {
    const model = reduceCloudFormation(
      {
        Resources: {
          Pool: { Type: 'AWS::Cognito::UserPool', Properties: { UserPoolName: 'authz', UserPoolTags: { [TAG]: 'authz-pool' } } },
          Fn: { Type: 'AWS::Lambda::Function', Properties: { FunctionName: 'pretokengen', Tags: [{ Key: TAG, Value: 'pretoken-fn' }] } },
        },
      },
      'cfn',
    )
    expect(refsOfKind(model, 'cognito-user-pool')).toEqual(['cognito-user-pool:authz-pool'])
    expect(refsOfKind(model, 'lambda-function')).toEqual(['lambda-function:pretoken-fn'])
  })

  it('reads the declared id from tags_all when a Terraform resource sets no tags block of its own', () => {
    const model = reduceTerraformShowJson(
      {
        planned_values: { root_module: { resources: [{ address: 'aws_s3_bucket.b', type: 'aws_s3_bucket', values: { bucket: 'apiable-logs-acme', tags_all: { [TAG]: 'logs-bucket' } } }] } },
        configuration: { root_module: { resources: [], outputs: {} } },
      },
      'terraform',
      'eu-central-1',
    )
    expect(refsOfKind(model, 's3-bucket')).toEqual(['s3-bucket:logs-bucket'])
  })

  it('reads the declared id from tags_all per-tag even when the resource carries an empty tags block', () => {
    // an empty `tags: {}` is present-but-without-the-key; a whole-map fallback would miss the id, so the
    // read is per-tag and still reaches tags_all
    const model = reduceTerraformShowJson(
      {
        planned_values: { root_module: { resources: [{ address: 'aws_s3_bucket.b', type: 'aws_s3_bucket', values: { bucket: 'apiable-logs-acme', tags: {}, tags_all: { [TAG]: 'logs-bucket' } } }] } },
        configuration: { root_module: { resources: [], outputs: {} } },
      },
      'terraform',
      'eu-central-1',
    )
    expect(refsOfKind(model, 's3-bucket')).toEqual(['s3-bucket:logs-bucket'])
  })

  it('treats a present-but-empty declared id as missing on an enforced primary (no bare-kind collapse)', () => {
    const model = reduceCloudFormation(
      { Resources: { Role: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'r', Tags: [{ Key: TAG, Value: '' }] } } } },
      'cfn',
    )
    expect(refsOfKind(model, 'iam-role')[0]).toContain('no-declared-logical-id')
  })
})

describe('declared-id identity (TA) — enforcement scope and the missing sentinel', () => {
  it('gives two tag-less enforced roles in one channel distinct per-local-id sentinels, never one collapsed node', () => {
    const model = reduceCloudFormation(
      {
        Resources: {
          RoleOne: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'one' } },
          RoleTwo: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'two' } },
        },
      },
      'cfn',
    )
    expect(new Set(refsOfKind(model, 'iam-role')).size).toBe(2)
  })

  it('gives a tag-less enforced cognito pool the per-local-id missing sentinel, not a name-based fall-back', () => {
    // the cognito pool is an enforced declared-id kind (its resource-servers, clients, and domain anchor
    // their identity to it), so a tag-less one surfaces the missing sentinel rather than keying by its name
    const model = reduceCloudFormation(
      { Resources: { Pool: { Type: 'AWS::Cognito::UserPool', Properties: { UserPoolName: 'authz' } } } },
      'cfn',
    )
    expect(refsOfKind(model, 'cognito-user-pool')[0]).toContain('no-declared-logical-id')
  })
})

describe('declared-id identity (TA) — bucket primary value clobber closed by the declared id', () => {
  it('catches a widened write grant on the second of two buckets that collide by tenant name', () => {
    const arnRoot = (account: string): string => `arn:aws:iam::${account}:root`
    // two buckets whose names differ only by tenant segment, each with its own resource policy; the
    // second bucket's write grant is widened in one channel. The declared id keys each policy's
    // write-accounts per bucket, so the widening is not clobbered by the first bucket's value.
    const twoBuckets = (secondWriter: string): unknown => ({
      Resources: {
        BucketA: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'apiable-logs-acme', Tags: [{ Key: TAG, Value: 'bucket-a' }] } },
        PolicyA: {
          Type: 'AWS::S3::BucketPolicy',
          Properties: { Bucket: { Ref: 'BucketA' }, PolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: arnRoot('034444869755') }, Action: 's3:*', Resource: 'arn:aws:s3:::apiable-logs-acme/*' }] } },
        },
        BucketB: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'apiable-logs-beta', Tags: [{ Key: TAG, Value: 'bucket-b' }] } },
        PolicyB: {
          Type: 'AWS::S3::BucketPolicy',
          Properties: { Bucket: { Ref: 'BucketB' }, PolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: arnRoot(secondWriter) }, Action: 's3:*', Resource: 'arn:aws:s3:::apiable-logs-beta/*' }] } },
        },
      },
    })
    const result = gate([
      reduceCloudFormation(twoBuckets('034444869755'), 'cdk'),
      reduceCloudFormation(twoBuckets('034444869755'), 'cfn'),
      reduceCloudFormation(twoBuckets('999988887777'), 'terraform'), // BucketB's writer widened to a different account
    ])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find((entry) => entry.tier === 'value' && entry.detail.includes('bucket-policy-write-accounts:s3-bucket-policy:bucket-b'))
    expect(divergence?.channels).toEqual(['terraform'])
  })
})
