/**
 * Supplementary coverage (TA) for the S3 logs-storage parity tier, beyond the frozen-contract
 * scenarios. These drive the real reducers + gate at the unit edges the contract specs exercise only
 * end-to-end: the bucket-policy grant extraction, the principal-LIST fail-open fix, the by-value
 * write-account capture with the deploying account dropped, the self-referential bucket-ARN
 * canonicalisation, the wildcard sentinel, narrowing (a removed partner), and the malformed/edge
 * inputs. Every case runs the real engine — no diff logic is re-declared.
 */
import { gate, reduceCloudFormation, reduceTerraformShowJson } from '@apiable/parity-gate'

const TAG = 'apiable:logical-id'
const BUCKET_ID = 'logs-bucket'
const REGION = 'eu-central-1'
const PARTNER = '034444869755'
const DEPLOY = '111111111111'
const arnRoot = (account: string): string => `arn:aws:iam::${account}:root`

// ── bucket-policy grant extraction by value (S3-2) ──────────────────────────────────────────────

const cfnBucketPolicy = (principal: unknown): unknown => ({
  Resources: {
    Bucket: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'apiable-logs-staging', Tags: [{ Key: TAG, Value: BUCKET_ID }] } },
    Policy: {
      Type: 'AWS::S3::BucketPolicy',
      Properties: {
        Bucket: { Ref: 'Bucket' },
        PolicyDocument: {
          Version: '2012-10-17',
          Statement: [
            { Sid: 'Permissions', Effect: 'Allow', Principal: principal, Action: 's3:*', Resource: [{ 'Fn::GetAtt': ['Bucket', 'Arn'] }] },
          ],
        },
      },
    },
  },
})

describe('S3 bucket-policy grant extraction', () => {
  it('emits a bucket-policy grant keyed by the bucket it secures', () => {
    const model = reduceCloudFormation(cfnBucketPolicy({ AWS: [arnRoot(DEPLOY), arnRoot(PARTNER)] }), 'cfn', REGION, DEPLOY)
    const grant = model.grants.find((entry) => entry.ref.startsWith('grant:bucket-policy'))
    expect(grant?.ref).toBe(`grant:bucket-policy:${BUCKET_ID}`)
    expect(grant?.actions).toEqual(['s3:*'])
  })

  it('captures the bounded cross-account writer by value, dropping the incidental deploying account', () => {
    const model = reduceCloudFormation(cfnBucketPolicy({ AWS: [arnRoot(DEPLOY), arnRoot(PARTNER)] }), 'cfn', REGION, DEPLOY)
    expect(model.values[`bucket-policy-write-accounts:s3-bucket-policy:${BUCKET_ID}`]).toBe(PARTNER)
  })

  it('reduces a single (non-list) bucket-policy principal without dropping it (the fail-open the list fix closes)', () => {
    const model = reduceCloudFormation(cfnBucketPolicy({ AWS: arnRoot(PARTNER) }), 'cfn', REGION, DEPLOY)
    expect(model.values[`bucket-policy-write-accounts:s3-bucket-policy:${BUCKET_ID}`]).toBe(PARTNER)
    const grant = model.grants.find((entry) => entry.ref.startsWith('grant:bucket-policy'))
    expect(grant?.principal).toBe(`arn:aws:iam::{account}:root`)
  })

  it('flags a wildcard write principal with the wildcard sentinel in the by-value write-account set', () => {
    const model = reduceCloudFormation(cfnBucketPolicy({ AWS: '*' }), 'cfn', REGION, DEPLOY)
    expect(model.values[`bucket-policy-write-accounts:s3-bucket-policy:${BUCKET_ID}`]).toBe('*')
  })

  it('emits the {none} sentinel when the policy grants only the deploying account itself', () => {
    const model = reduceCloudFormation(cfnBucketPolicy({ AWS: arnRoot(DEPLOY) }), 'cfn', REGION, DEPLOY)
    // No external writer: the key is still emitted as an explicit {none}, never dropped, so a deploy-only
    // narrowing compares present-vs-present against a channel that grants a partner.
    expect(model.values[`bucket-policy-write-accounts:s3-bucket-policy:${BUCKET_ID}`]).toBe('{none}')
  })
})

// ── narrowing (a removed partner) is a divergence too ───────────────────────────────────────────

describe('S3 bucket-policy narrowing', () => {
  it('fails when one channel drops the bounded partner from the write grant (a narrowed set diverges)', () => {
    const bothWriters = reduceCloudFormation(cfnBucketPolicy({ AWS: [arnRoot(DEPLOY), arnRoot(PARTNER)] }), 'cdk', REGION, DEPLOY)
    const cfn = reduceCloudFormation(cfnBucketPolicy({ AWS: [arnRoot(DEPLOY), arnRoot(PARTNER)] }), 'cfn', REGION, DEPLOY)
    const deployOnly = reduceCloudFormation(cfnBucketPolicy({ AWS: arnRoot(DEPLOY) }), 'terraform', REGION, DEPLOY)
    const result = gate([bothWriters, cfn, deployOnly])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find((entry) => entry.detail.includes('bucket-policy-write-accounts'))
    expect(divergence?.channels).toEqual(['terraform'])
  })
})

// ── self-referential bucket-ARN canonicalisation (CFN GetAtt ↔ TF literal) ───────────────────────

describe('S3 self-referential bucket-ARN canonicalisation', () => {
  it('reduces a CFN GetAtt bucket ARN and a TF literal bucket ARN to the same canonical resource', () => {
    const cfn = reduceCloudFormation(cfnBucketPolicy({ AWS: [arnRoot(DEPLOY), arnRoot(PARTNER)] }), 'cfn', REGION, DEPLOY)
    const tf = reduceTerraformShowJson(
      {
        planned_values: {
          root_module: {
            resources: [
              { address: 'aws_s3_bucket.this', type: 'aws_s3_bucket', values: { bucket: 'apiable-logs-staging', tags: { [TAG]: BUCKET_ID }, tags_all: { [TAG]: BUCKET_ID } } },
              {
                address: 'aws_s3_bucket_policy.this',
                type: 'aws_s3_bucket_policy',
                values: {
                  policy: JSON.stringify({
                    Version: '2012-10-17',
                    Statement: [{ Sid: 'Permissions', Effect: 'Allow', Principal: { AWS: [arnRoot(DEPLOY), arnRoot(PARTNER)] }, Action: 's3:*', Resource: ['arn:aws:s3:::apiable-logs-staging'] }],
                  }),
                },
              },
            ],
          },
        },
        configuration: {
          root_module: {
            resources: [
              { address: 'aws_s3_bucket.this', type: 'aws_s3_bucket', expressions: {} },
              { address: 'aws_s3_bucket_policy.this', type: 'aws_s3_bucket_policy', expressions: { bucket: { references: ['aws_s3_bucket.this.id', 'aws_s3_bucket.this'] } } },
            ],
            outputs: {},
          },
        },
      },
      'terraform',
      REGION,
      DEPLOY,
    )
    const cfnGrant = cfn.grants.find((entry) => entry.ref.startsWith('grant:bucket-policy'))
    const tfGrant = tf.grants.find((entry) => entry.ref.startsWith('grant:bucket-policy'))
    expect(cfnGrant?.resources).toEqual(tfGrant?.resources)
    expect(cfnGrant?.resources).toContain(`s3-bucket:${BUCKET_ID}`)
  })
})

// ── malformed / edge inputs ─────────────────────────────────────────────────────────────────────

describe('S3 reducer edge inputs', () => {
  it('reduces a bucket with no policy to a well-formed model carrying the bucket node only', () => {
    const model = reduceCloudFormation({ Resources: { Bucket: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'apiable-logs-staging', Tags: [{ Key: TAG, Value: BUCKET_ID }] } } } }, 'cfn', REGION)
    expect(model.wellFormed).toBe(true)
    expect(model.graph.nodes.some((node) => node.kind === 's3-bucket')).toBe(true)
    expect(model.grants.filter((entry) => entry.ref.startsWith('grant:bucket-policy'))).toEqual([])
  })

  it('treats a Service principal as no external account grant — the {none} sentinel, not a real account', () => {
    const model = reduceCloudFormation(cfnBucketPolicy({ Service: 'logging.s3.amazonaws.com' }), 'cfn', REGION, DEPLOY)
    expect(model.values[`bucket-policy-write-accounts:s3-bucket-policy:${BUCKET_ID}`]).toBe('{none}')
  })

  it('keys the bucket-policy node by the bucket even when the bucket reference cannot be resolved', () => {
    const model = reduceCloudFormation(
      { Resources: { Policy: { Type: 'AWS::S3::BucketPolicy', Properties: { Bucket: { Ref: 'Missing' }, PolicyDocument: { Version: '2012-10-17', Statement: [] } } } } },
      'cfn',
      REGION,
    )
    expect(model.graph.nodes.some((node) => node.kind === 's3-bucket-policy')).toBe(true)
  })
})

// ── {none} sentinel: an empty external-writer set is an explicit value, compared like any other ─────

describe('S3 bucket-policy {none} presence-vs-value sentinel', () => {
  const deployOnly = (channel: 'cdk' | 'cfn' | 'terraform') => reduceCloudFormation(cfnBucketPolicy({ AWS: arnRoot(DEPLOY) }), channel, REGION, DEPLOY)

  it('all three channels narrowed to deploy-only agree on {none} → parity holds (the sentinel does not false-FAIL)', () => {
    const result = gate([deployOnly('cdk'), deployOnly('cfn'), deployOnly('terraform')])
    expect(result.divergences.filter((entry) => entry.detail.includes('bucket-policy-write-accounts'))).toEqual([])
  })

  it('a deploy-only {none} channel diverges from a wildcard-granting channel — {none} is never "any account"', () => {
    const result = gate([deployOnly('cdk'), deployOnly('cfn'), reduceCloudFormation(cfnBucketPolicy({ AWS: '*' }), 'terraform', REGION, DEPLOY)])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find((entry) => entry.tier === 'value' && entry.detail.includes('bucket-policy-write-accounts'))
    expect(divergence?.channels).toEqual(['terraform'])
  })
})

// ── canonicalOutputAttr: a bucket's name-identifier output reconciles across channels ───────────────

describe('S3 bucket-name output reconciliation across channels', () => {
  const cfnBucketWithOutputs = (): unknown => ({
    Resources: { Bucket: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'apiable-logs-staging', Tags: [{ Key: TAG, Value: BUCKET_ID }] } } },
    Outputs: { BucketName: { Value: { Ref: 'Bucket' } }, BucketArn: { Value: { 'Fn::GetAtt': ['Bucket', 'Arn'] } } },
  })
  const tfBucketWithOutputs = (): unknown => ({
    planned_values: { root_module: { resources: [{ address: 'aws_s3_bucket.this', type: 'aws_s3_bucket', values: { bucket: 'apiable-logs-staging', tags: { [TAG]: BUCKET_ID }, tags_all: { [TAG]: BUCKET_ID } } }] } },
    configuration: {
      root_module: {
        resources: [{ address: 'aws_s3_bucket.this', type: 'aws_s3_bucket', expressions: {} }],
        outputs: {
          bucket_name: { expression: { references: ['aws_s3_bucket.this.bucket', 'aws_s3_bucket.this'] } },
          bucket_arn: { expression: { references: ['aws_s3_bucket.this.arn', 'aws_s3_bucket.this'] } },
        },
      },
    },
  })

  it('a bucket-name export reconciles whether the channel addresses it by CFN Ref or TF .bucket (both → output:s3-bucket.name)', () => {
    const cfn = reduceCloudFormation(cfnBucketWithOutputs(), 'cfn', REGION)
    const tf = reduceTerraformShowJson(tfBucketWithOutputs(), 'terraform', REGION)
    expect(cfn.graph.nodes.some((n) => n.ref === 'output:s3-bucket.name')).toBe(true)
    expect(tf.graph.nodes.some((n) => n.ref === 'output:s3-bucket.name')).toBe(true)
  })

  it('a bucket-arn export keeps its arn attribute — canonicalisation touches only the name identifier', () => {
    const cfn = reduceCloudFormation(cfnBucketWithOutputs(), 'cfn', REGION)
    const tf = reduceTerraformShowJson(tfBucketWithOutputs(), 'terraform', REGION)
    expect(cfn.graph.nodes.some((n) => n.ref === 'output:s3-bucket.arn')).toBe(true)
    expect(tf.graph.nodes.some((n) => n.ref === 'output:s3-bucket.arn')).toBe(true)
  })
})
