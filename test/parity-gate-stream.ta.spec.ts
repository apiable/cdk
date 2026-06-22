/**
 * Supplementary coverage (TA) for the Firehose usage-stream parity tier, beyond the frozen-contract
 * scenarios. These drive the real reducers + gate at the unit edges the contract specs exercise only
 * end-to-end: the firehose-delivery-stream collectValues extraction (destination prefix / error prefix /
 * compression / cloudwatch-logging-enabled), the parent-anchor discriminator keeping two distributions
 * distinct by their delivery role, and the fail-closed behaviour when a destination block is dropped or a
 * value is present in one channel and absent in another. Every case runs the real engine — no diff logic
 * is re-declared.
 */
import { gate, reduceCloudFormation, reduceTerraformShowJson } from '@apiable/parity-gate'

const TAG = 'apiable:logical-id'
const REGION = 'eu-central-1'
const ROLE_ID = 'apiable-usagelogs-firehose-role'
const STREAM_REF = `firehose-delivery-stream:of-role:${ROLE_ID}`

// ── synthetic single-stream CFN artifact (role + delivery stream) ────────────────────────────────

interface StreamShape {
  readonly prefix?: string
  readonly errorPrefix?: string
  readonly compression?: string
  readonly cwLoggingEnabled?: boolean
  readonly roleId?: string
  readonly omitDestination?: boolean
  // When set, the Terraform stream's destination + grant point at this hardcoded literal bucket with NO
  // var.logs_bucket_arn binding (the re-pointed-destination exploit); otherwise the conventional parameter.
  readonly tfExfilBucket?: string
}

// The delivery role's S3-write inline policy on the destination logs bucket — the destination's security
// representation the parameter-identity reduction compares by value. CFN embeds it via the role's Policies
// array (CDK inlinePolicies); Terraform declares a separate aws_iam_role_policy. The destination ARN reads
// as the LogsBucketArn parameter ref (CFN) and the var.logs_bucket_arn-bound literal (TF) by default.
const s3WriteStatement = (bucketArn: unknown): unknown => ({
  Effect: 'Allow',
  Action: ['s3:GetObject', 's3:PutObject'],
  Resource: [bucketArn, typeof bucketArn === 'string' ? `${bucketArn}/*` : { 'Fn::Join': ['', [bucketArn, '/*']] }],
})

const cfnStream = (shape: StreamShape = {}): unknown => {
  const destination = {
    BucketARN: { Ref: 'LogsBucketArn' },
    RoleARN: { 'Fn::GetAtt': ['FirehoseRole', 'Arn'] },
    Prefix: shape.prefix ?? 'apiable/aws/logs/',
    ErrorOutputPrefix: shape.errorPrefix ?? 'apiable/aws/errors/',
    CompressionFormat: shape.compression ?? 'UNCOMPRESSED',
    CloudWatchLoggingOptions: { Enabled: shape.cwLoggingEnabled ?? true, LogGroupName: 'lg', LogStreamName: 'ls' },
  }
  return {
    Parameters: { LogsBucketArn: { Type: 'String' } },
    Resources: {
      FirehoseRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'firehose.amazonaws.com' }, Action: 'sts:AssumeRole' }] },
          Policies: [{ PolicyName: 'FirehosePolicy', PolicyDocument: { Version: '2012-10-17', Statement: [s3WriteStatement({ Ref: 'LogsBucketArn' })] } }],
          Tags: [{ Key: TAG, Value: shape.roleId ?? ROLE_ID }],
        },
      },
      Stream: {
        Type: 'AWS::KinesisFirehose::DeliveryStream',
        Properties: {
          DeliveryStreamName: 'amazon-apigateway-usagelogs',
          DeliveryStreamType: 'DirectPut',
          ...(shape.omitDestination ? {} : { S3DestinationConfiguration: destination }),
        },
      },
    },
  }
}

// ── synthetic single-stream Terraform artifact ───────────────────────────────────────────────────

const TF_LOGS_BUCKET = 'arn:aws:s3:::apiable-logs-ci'

const tfStream = (shape: StreamShape = {}): unknown => {
  const bucketArn = shape.tfExfilBucket ?? TF_LOGS_BUCKET
  // The exfil case wires the destination to a hardcoded literal with no var reference; the legitimate case
  // binds the conventional var.logs_bucket_arn (the configuration reference is the binding witness).
  const bucketReferences = shape.tfExfilBucket !== undefined ? [] : ['var.logs_bucket_arn']
  const destination: Record<string, unknown> = {
    bucket_arn: bucketArn,
    role_arn: 'arn:aws:iam::111111111111:role/apiable-usagelogs-firehose',
    prefix: shape.prefix ?? 'apiable/aws/logs/',
    error_output_prefix: shape.errorPrefix ?? 'apiable/aws/errors/',
    compression_format: shape.compression ?? 'UNCOMPRESSED',
    cloudwatch_logging_options: [{ enabled: shape.cwLoggingEnabled ?? true, log_group_name: 'lg', log_stream_name: 'ls' }],
  }
  return {
    planned_values: {
      root_module: {
        resources: [
          {
            address: 'aws_iam_role.firehose',
            type: 'aws_iam_role',
            values: {
              name: 'apiable-usagelogs-firehose',
              tags: { [TAG]: shape.roleId ?? ROLE_ID },
              tags_all: { [TAG]: shape.roleId ?? ROLE_ID },
              assume_role_policy: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'firehose.amazonaws.com' }, Action: 'sts:AssumeRole' }] }),
            },
          },
          {
            address: 'aws_iam_role_policy.firehose',
            type: 'aws_iam_role_policy',
            values: { name: 'FirehosePolicy', policy: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:GetObject', 's3:PutObject'], Resource: [bucketArn, `${bucketArn}/*`] }] }) },
          },
          {
            address: 'aws_kinesis_firehose_delivery_stream.this',
            type: 'aws_kinesis_firehose_delivery_stream',
            values: { name: 'amazon-apigateway-usagelogs', destination: 'extended_s3', ...(shape.omitDestination ? {} : { extended_s3_configuration: [destination] }) },
          },
        ],
      },
    },
    configuration: {
      root_module: {
        resources: [
          { address: 'aws_iam_role.firehose', type: 'aws_iam_role', expressions: {} },
          { address: 'aws_iam_role_policy.firehose', type: 'aws_iam_role_policy', expressions: { role: { references: ['aws_iam_role.firehose.id', 'aws_iam_role.firehose'] } } },
          {
            address: 'aws_kinesis_firehose_delivery_stream.this',
            type: 'aws_kinesis_firehose_delivery_stream',
            expressions: { extended_s3_configuration: [{ role_arn: { references: ['aws_iam_role.firehose.arn', 'aws_iam_role.firehose'] }, bucket_arn: { references: bucketReferences } }] },
          },
        ],
        outputs: {},
      },
    },
  }
}

describe('firehose-delivery-stream collectValues extraction (CFN)', () => {
  const values = reduceCloudFormation(cfnStream(), 'cfn', REGION).values
  it('extracts the destination routing prefix as a load-bearing value row keyed by the stream node', () => {
    expect(values[`destination-prefix:${STREAM_REF}`]).toBe('apiable/aws/logs/')
  })
  it('extracts the destination error prefix', () => {
    expect(values[`destination-error-prefix:${STREAM_REF}`]).toBe('apiable/aws/errors/')
  })
  it('extracts the compression format', () => {
    expect(values[`compression-format:${STREAM_REF}`]).toBe('UNCOMPRESSED')
  })
  it('extracts whether server-side cloudwatch logging is enabled', () => {
    expect(values[`cloudwatch-logging-enabled:${STREAM_REF}`]).toBe('true')
  })
})

describe('firehose-delivery-stream collectValues extraction (Terraform)', () => {
  const values = reduceTerraformShowJson(tfStream(), 'terraform', REGION, '111111111111').values
  it('extracts the same routing/compression/logging rows from the extended_s3_configuration block', () => {
    expect(values[`destination-prefix:${STREAM_REF}`]).toBe('apiable/aws/logs/')
    expect(values[`destination-error-prefix:${STREAM_REF}`]).toBe('apiable/aws/errors/')
    expect(values[`compression-format:${STREAM_REF}`]).toBe('UNCOMPRESSED')
    expect(values[`cloudwatch-logging-enabled:${STREAM_REF}`]).toBe('true')
  })
})

describe('firehose-delivery-stream parent-anchor by the delivery role', () => {
  it('keys the stream node by its delivery role declared id, not its tenant-scoped stream name', () => {
    const node = reduceCloudFormation(cfnStream(), 'cfn', REGION).graph.nodes.find((n) => n.kind === 'firehose-delivery-stream')
    expect(node?.ref).toBe(STREAM_REF)
  })

  it('emits a delivers-via edge from the stream to its delivery role', () => {
    const edges = reduceCloudFormation(cfnStream(), 'cfn', REGION).graph.edges
    expect(edges.some((e) => e.from === STREAM_REF && e.to === `iam-role:${ROLE_ID}` && e.relation === 'delivers-via')).toBe(true)
  })

  it('keeps two streams of one kind distinct when each carries its own delivery role (no false collision)', () => {
    const usagelogs = reduceCloudFormation(cfnStream({ roleId: 'apiable-usagelogs-firehose-role' }), 'cdk', REGION).graph.nodes
    const usagetokens = reduceCloudFormation(cfnStream({ roleId: 'apiable-usagetokens-firehose-role' }), 'cfn', REGION).graph.nodes
    const a = usagelogs.find((n) => n.kind === 'firehose-delivery-stream')?.ref
    const b = usagetokens.find((n) => n.kind === 'firehose-delivery-stream')?.ref
    expect(a).not.toEqual(b)
  })
})

describe('firehose-delivery-stream parent-anchor (Terraform)', () => {
  it('keys the stream node by its delivery role and emits the delivers-via edge from the configuration references', () => {
    const model = reduceTerraformShowJson(tfStream(), 'terraform', REGION, '111111111111')
    const node = model.graph.nodes.find((n) => n.kind === 'firehose-delivery-stream')
    expect(node?.ref).toBe(STREAM_REF)
    expect(model.graph.edges.some((e) => e.from === STREAM_REF && e.to === `iam-role:${ROLE_ID}` && e.relation === 'delivers-via')).toBe(true)
  })
})

describe('firehose role embedded inline policy reduces like a separate policy resource', () => {
  // The firehose role embeds its FirehosePolicy (CDK inlinePolicies), so the CFN reducer extracts it to
  // the same iam-inline-policy node + grants a separate AWS::IAM::Policy / aws_iam_role_policy yields —
  // without which the role's S3 write grant is invisible to the gate.
  const cfnStreamWithPolicy = (): unknown => {
    const artifact = cfnStream() as { Resources: Record<string, { Type: string; Properties: Record<string, unknown> }> }
    artifact.Resources.FirehoseRole.Properties.Policies = [
      {
        PolicyName: 'FirehosePolicy',
        PolicyDocument: {
          Version: '2012-10-17',
          Statement: [
            { Effect: 'Allow', Action: ['s3:PutObject', 's3:GetObject'], Resource: [{ Ref: 'LogsBucketArn' }, { 'Fn::Join': ['', [{ Ref: 'LogsBucketArn' }, '/*']] }] },
          ],
        },
      },
    ]
    return artifact
  }

  it('emits an iam-inline-policy node anchored to the role for an embedded policy', () => {
    const model = reduceCloudFormation(cfnStreamWithPolicy(), 'cfn', REGION)
    expect(model.graph.nodes.some((n) => n.ref === `iam-inline-policy:policy-of:${ROLE_ID}:s3` && n.kind === 'iam-inline-policy')).toBe(true)
    expect(model.graph.edges.some((e) => e.relation === 'attached-to-role' && e.to === `iam-role:${ROLE_ID}`)).toBe(true)
  })

  it('reduces the embedded policy S3 grant on the deploy-time logs-bucket PARAMETER to the shared parameter token, preserving the object path', () => {
    const model = reduceCloudFormation(cfnStreamWithPolicy(), 'cfn', REGION)
    const grant = model.grants.find((g) => g.ref.startsWith('grant:s3:iam-inline-policy:policy-of:'))
    // The grant on `{Ref: LogsBucketArn}` reduces to the parameter token (not a constant that erases the
    // destination's identity), so a grant on a DIFFERENT bucket would keep that bucket's identity and diverge.
    expect(grant?.resources).toContain('{logs-bucket-param}')
    expect(grant?.resources).toContain('{logs-bucket-param}/*')
  })

  it('keeps a grant on a literal exfil bucket as its own identity — it does NOT collapse to the parameter token', () => {
    const artifact = cfnStream() as { Resources: Record<string, { Type: string; Properties: Record<string, unknown> }> }
    artifact.Resources.FirehoseRole.Properties.Policies = [
      {
        PolicyName: 'FirehosePolicy',
        PolicyDocument: {
          Version: '2012-10-17',
          Statement: [{ Effect: 'Allow', Action: ['s3:PutObject'], Resource: ['arn:aws:s3:::attacker-exfil-bucket'] }],
        },
      },
    ]
    const model = reduceCloudFormation(artifact, 'cfn', REGION)
    const grant = model.grants.find((g) => g.ref.startsWith('grant:s3:iam-inline-policy:policy-of:'))
    expect(grant?.resources).toContain('arn:aws:s3:::attacker-exfil-bucket')
    expect(grant?.resources).not.toContain('{logs-bucket-param}')
  })
})

describe('firehose-delivery-stream by-value drift is caught cross-channel', () => {
  it('FAILS the gate when one channel writes records under a different destination prefix', () => {
    const result = gate([
      reduceCloudFormation(cfnStream(), 'cdk', REGION),
      reduceCloudFormation(cfnStream(), 'cfn', REGION),
      reduceTerraformShowJson(tfStream({ prefix: 'apiable/aws/hijacked/logs/' }), 'terraform', REGION, '111111111111'),
    ])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find((entry) => entry.detail.includes('destination-prefix'))
    expect(divergence?.channels).toEqual(['terraform'])
  })

  it('FAILS the gate when one channel ships a different compression format', () => {
    const result = gate([
      reduceCloudFormation(cfnStream(), 'cdk', REGION),
      reduceCloudFormation(cfnStream(), 'cfn', REGION),
      reduceTerraformShowJson(tfStream({ compression: 'GZIP' }), 'terraform', REGION, '111111111111'),
    ])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find((entry) => entry.detail.includes('compression-format'))
    expect(divergence?.channels).toEqual(['terraform'])
  })
})

describe('firehose-delivery-stream fail-closed: an under-specified stream cannot silently pass', () => {
  it('FAILS when a stream attribute is present in two channels and absent in the third (cw-logging dropped)', () => {
    // The TF stream omits the cloudwatch_logging_options block entirely, so its cloudwatch-logging-enabled
    // row is absent while the CFN channels carry it — a present-vs-absent divergence, never collapsed.
    const tfNoLogging = tfStream()
    const stream = (tfNoLogging as { planned_values: { root_module: { resources: { type: string; values: Record<string, unknown> }[] } } }).planned_values.root_module.resources.find(
      (r) => r.type === 'aws_kinesis_firehose_delivery_stream',
    )
    delete (stream?.values.extended_s3_configuration as Record<string, unknown>[])[0].cloudwatch_logging_options
    const result = gate([reduceCloudFormation(cfnStream(), 'cdk', REGION), reduceCloudFormation(cfnStream(), 'cfn', REGION), reduceTerraformShowJson(tfNoLogging, 'terraform', REGION, '111111111111')])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find((entry) => entry.detail.includes('cloudwatch-logging-enabled'))
    expect(divergence?.channels).toEqual(['terraform'])
  })

  it('FAILS when a stream attribute is present in two channels and absent in the third (destination prefix dropped)', () => {
    const tfNoPrefix = tfStream()
    const stream = (tfNoPrefix as { planned_values: { root_module: { resources: { type: string; values: Record<string, unknown> }[] } } }).planned_values.root_module.resources.find(
      (r) => r.type === 'aws_kinesis_firehose_delivery_stream',
    )
    delete (stream?.values.extended_s3_configuration as Record<string, unknown>[])[0].prefix
    const result = gate([reduceCloudFormation(cfnStream(), 'cdk', REGION), reduceCloudFormation(cfnStream(), 'cfn', REGION), reduceTerraformShowJson(tfNoPrefix, 'terraform', REGION, '111111111111')])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find((entry) => entry.detail.includes('destination-prefix'))
    expect(divergence?.channels).toEqual(['terraform'])
  })

  it('reduces a stream whose entire destination block is absent to a well-formed model carrying no value rows', () => {
    const model = reduceCloudFormation(cfnStream({ omitDestination: true }), 'cfn', REGION)
    expect(model.wellFormed).toBe(true)
    expect(Object.keys(model.values).some((key) => key.startsWith('destination-prefix'))).toBe(false)
    // an absent destination block leaves the stream un-anchored to a role, but still a recognised kind
    expect(model.graph.nodes.some((node) => node.kind === 'firehose-delivery-stream')).toBe(true)
  })
})

describe('firehose-delivery-stream destination bucket is caught by value (the parameter-identity reduction)', () => {
  // The fail-OPEN this story closes: a Terraform leg re-pointed to an attacker-controlled bucket while the
  // CFN/CDK channels stay on the conventional LogsBucketArn parameter MUST fail the gate, not be certified
  // equivalent. The destination's security representation is the delivery role's S3 write grant multiset.
  it('FAILS the gate when the Terraform destination is re-pointed to a literal exfil bucket (CFN/CDK on the parameter)', () => {
    const result = gate([
      reduceCloudFormation(cfnStream(), 'cdk', REGION),
      reduceCloudFormation(cfnStream(), 'cfn', REGION),
      reduceTerraformShowJson(tfStream({ tfExfilBucket: 'arn:aws:s3:::attacker-exfil-bucket' }), 'terraform', REGION, '111111111111'),
    ])
    expect(result.passed).toBe(false)
    // the divergent channel is named, and the exfil bucket keeps its own identity (never the parameter token)
    const grantDivergence = result.divergences.find((entry) => entry.tier === 'permission')
    expect(grantDivergence?.channels).toEqual(['terraform'])
    expect(JSON.stringify(result.divergences)).toContain('attacker-exfil-bucket')
  })

  it('FAILS the gate when one channel hardcodes the legitimate bucket as a literal where the others parameterise it', () => {
    // A channel that bakes a concrete bucket where the other channels keep the deploy-time parameter is a
    // divergence — hardcoding removes the deployer's control over where records land, even on the right bucket.
    const result = gate([
      reduceCloudFormation(cfnStream(), 'cdk', REGION),
      reduceCloudFormation(cfnStream(), 'cfn', REGION),
      reduceTerraformShowJson(tfStream({ tfExfilBucket: TF_LOGS_BUCKET }), 'terraform', REGION, '111111111111'),
    ])
    expect(result.passed).toBe(false)
    expect(result.divergences.some((entry) => entry.tier === 'permission')).toBe(true)
  })

  it('PASSES on the matching parameter↔parameter destination (the real legitimate case — no false-FAIL)', () => {
    // CFN @ref:LogsBucketArn and TF var.logs_bucket_arn-bound literal both reduce to {logs-bucket-param}, so
    // the delivery role's S3 grant multiset reconciles cross-channel and the gate certifies the channels match.
    const result = gate([
      reduceCloudFormation(cfnStream(), 'cdk', REGION),
      reduceCloudFormation(cfnStream(), 'cfn', REGION),
      reduceTerraformShowJson(tfStream(), 'terraform', REGION, '111111111111'),
    ])
    expect(result.divergences).toEqual([])
    expect(result.passed).toBe(true)
  })
})

describe('firehose-delivery-stream equivalent across channels → parity holds', () => {
  it('an equivalent stream in all three channels does not false-FAIL on any value row', () => {
    const result = gate([reduceCloudFormation(cfnStream(), 'cdk', REGION), reduceCloudFormation(cfnStream(), 'cfn', REGION), reduceTerraformShowJson(tfStream(), 'terraform', REGION, '111111111111')])
    const streamDivergences = result.divergences.filter(
      (entry) => entry.detail.includes('destination-prefix') || entry.detail.includes('compression-format') || entry.detail.includes('cloudwatch-logging-enabled') || entry.detail.includes('firehose-delivery-stream'),
    )
    expect(streamDivergences).toEqual([])
  })
})
