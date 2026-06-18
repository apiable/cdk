/**
 * Supplementary coverage (TA) for the S3 logs-storage parity tier, beyond the frozen-contract
 * scenarios. These drive the real reducers + gate at the unit edges the contract specs exercise only
 * end-to-end: the bucket-policy grant extraction, the tenant-name normalisation, the principal-LIST
 * fail-open fix, the by-value write-account capture with the deploying account dropped, the
 * self-referential bucket-ARN canonicalisation, the wildcard sentinel, narrowing (a removed partner),
 * and the malformed/edge inputs. Every case runs the real engine — no diff logic is re-declared.
 */
import {
  gate,
  normaliseLogical,
  reduceCloudFormation,
  reduceTerraformShowJson,
  TENANT_TOKEN,
} from '@apiable/parity-gate'

const REGION = 'eu-central-1'
const PARTNER = '034444869755'
const DEPLOY = '111111111111'
const arnRoot = (account: string): string => `arn:aws:iam::${account}:root`

// ── tenant-name normalisation (S3-3) ───────────────────────────────────────────────────────────

describe('S3 tenant-name normalisation', () => {
  it('collapses the tenant segment of a concrete bucket name to the tenant token', () => {
    expect(normaliseLogical('apiable-logs-staging')).toBe(`apiable-logs-${TENANT_TOKEN}`)
  })

  it('collapses the tenant segment of the write-role name, preserving the -s3-role suffix', () => {
    expect(normaliseLogical('apiable-logs-staging-s3-role')).toBe(`apiable-logs-${TENANT_TOKEN}-s3-role`)
  })

  it('collapses a tenant segment carried as an unresolved parameter reference', () => {
    expect(normaliseLogical('apiable-logs-@ref:TenantName-s3-role')).toBe(`apiable-logs-${TENANT_TOKEN}-s3-role`)
  })

  it('collapses the tenant segment inside a bucket object ARN, preserving the object path', () => {
    expect(normaliseLogical('arn:aws:s3:::apiable-logs-staging/*')).toBe(`arn:aws:s3:::apiable-logs-${TENANT_TOKEN}/*`)
  })

  it('reconciles a hyphenated tenant name across the placeholder and concrete forms', () => {
    expect(normaliseLogical('apiable-logs-my-tenant-s3-role')).toBe(`apiable-logs-${TENANT_TOKEN}-s3-role`)
    expect(normaliseLogical('apiable-logs-@ref:TenantName-s3-role')).toBe(normaliseLogical('apiable-logs-my-tenant-s3-role'))
  })

  it('leaves a non-logs bucket name untouched', () => {
    expect(normaliseLogical('some-other-bucket-staging')).toBe('some-other-bucket-staging')
  })
})

// ── bucket-policy grant extraction by value (S3-2) ──────────────────────────────────────────────

const cfnBucketPolicy = (principal: unknown): unknown => ({
  Resources: {
    Bucket: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'apiable-logs-staging' } },
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
    expect(grant?.ref).toBe(`grant:bucket-policy:apiable-logs-${TENANT_TOKEN}`)
    expect(grant?.actions).toEqual(['s3:*'])
  })

  it('captures the bounded cross-account writer by value, dropping the incidental deploying account', () => {
    const model = reduceCloudFormation(cfnBucketPolicy({ AWS: [arnRoot(DEPLOY), arnRoot(PARTNER)] }), 'cfn', REGION, DEPLOY)
    expect(model.values[`bucket-policy-write-accounts:s3-bucket-policy:apiable-logs-${TENANT_TOKEN}`]).toBe(PARTNER)
  })

  it('reduces a single (non-list) bucket-policy principal without dropping it (the fail-open the list fix closes)', () => {
    const model = reduceCloudFormation(cfnBucketPolicy({ AWS: arnRoot(PARTNER) }), 'cfn', REGION, DEPLOY)
    expect(model.values[`bucket-policy-write-accounts:s3-bucket-policy:apiable-logs-${TENANT_TOKEN}`]).toBe(PARTNER)
    const grant = model.grants.find((entry) => entry.ref.startsWith('grant:bucket-policy'))
    expect(grant?.principal).toBe(`arn:aws:iam::{account}:root`)
  })

  it('flags a wildcard write principal with the wildcard sentinel in the by-value write-account set', () => {
    const model = reduceCloudFormation(cfnBucketPolicy({ AWS: '*' }), 'cfn', REGION, DEPLOY)
    expect(model.values[`bucket-policy-write-accounts:s3-bucket-policy:apiable-logs-${TENANT_TOKEN}`]).toBe('*')
  })

  it('emits no write-account value when the policy grants only the deploying account itself', () => {
    const model = reduceCloudFormation(cfnBucketPolicy({ AWS: arnRoot(DEPLOY) }), 'cfn', REGION, DEPLOY)
    expect(model.values[`bucket-policy-write-accounts:s3-bucket-policy:apiable-logs-${TENANT_TOKEN}`]).toBeUndefined()
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
              { address: 'aws_s3_bucket.this', type: 'aws_s3_bucket', values: { bucket: 'apiable-logs-staging' } },
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
    expect(cfnGrant?.resources).toContain(`s3-bucket:apiable-logs-${TENANT_TOKEN}`)
  })
})

// ── malformed / edge inputs ─────────────────────────────────────────────────────────────────────

describe('S3 reducer edge inputs', () => {
  it('reduces a bucket with no policy to a well-formed model carrying the bucket node only', () => {
    const model = reduceCloudFormation({ Resources: { Bucket: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'apiable-logs-staging' } } } }, 'cfn', REGION)
    expect(model.wellFormed).toBe(true)
    expect(model.graph.nodes.some((node) => node.kind === 's3-bucket')).toBe(true)
    expect(model.grants.filter((entry) => entry.ref.startsWith('grant:bucket-policy'))).toEqual([])
  })

  it('does not mistake a Service principal in a bucket policy for an account grant', () => {
    const model = reduceCloudFormation(cfnBucketPolicy({ Service: 'logging.s3.amazonaws.com' }), 'cfn', REGION, DEPLOY)
    expect(model.values[`bucket-policy-write-accounts:s3-bucket-policy:apiable-logs-${TENANT_TOKEN}`]).toBeUndefined()
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
