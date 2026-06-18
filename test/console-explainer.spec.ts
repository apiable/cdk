/**
 * Supplementary coverage for the Console-explainer resource enumeration (Story 013-1-12) — edge
 * cases and integration scenarios beyond the frozen acceptance contract: multi-resource constructs,
 * the content-key collision guard, unmapped resource types, token-named resources, per-component key
 * namespacing, and empty stacks. Synth-level; no live AWS account. Structure half only — no renderer,
 * no markdown content.
 */
import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as sns from 'aws-cdk-lib/aws-sns'
import { LogsBucketStack, LOGS_BUCKET_COMPONENT } from '@apiable/cdk-logs-bucket'
import { describeResources, ResourceDescriptor } from '@apiable/cdk-console-explainer'

const ENV = { account: '111111111111', region: 'eu-central-1' }

const stackOf = (build: (scope: Construct) => void, id = 'S'): cdk.Stack => {
  class Wrapper extends cdk.Stack {
    constructor(scope: Construct) {
      super(scope, id, { env: ENV })
      build(this)
    }
  }
  return new Wrapper(new cdk.App())
}

describe('multi-resource construct (logs-bucket)', () => {
  const enumeration = (): readonly ResourceDescriptor[] =>
    describeResources(new LogsBucketStack(new cdk.App(), 'LB', { name: 'staging', env: ENV }), LOGS_BUCKET_COMPONENT)
      .resources

  it('enumerates the bucket, its resource policy, the write role, the inline write policy, and all three outputs', () => {
    const byKind = enumeration().reduce<Record<string, number>>((acc, d) => {
      acc[d.kind] = (acc[d.kind] ?? 0) + 1
      return acc
    }, {})
    // the bucket's resource policy (the cross-account write grant) surfaces as its own kind — it is
    // security-load-bearing and must not silently drop from the audit
    expect(byKind).toEqual({ bucket: 1, 'bucket-policy': 1, 'iam-role': 1, 'iam-policy': 1, 'resource-output': 3 })
  })

  it('surfaces the bucket policy carrying its raw CFN type', () => {
    const bucketPolicy = enumeration().find((d) => d.kind === 'bucket-policy')
    expect(bucketPolicy).toBeDefined()
    expect(bucketPolicy?.cfnType).toBe('AWS::S3::BucketPolicy')
  })

  it('derives an s3 deep-link for the bucket and an iam deep-link for the write role, by physical name', () => {
    const descriptors = enumeration()
    expect(descriptors.find((d) => d.kind === 'bucket')?.consoleDeepLink).toEqual({
      service: 's3',
      resourcePath: 'apiable-logs-staging',
    })
    expect(descriptors.find((d) => d.kind === 'iam-role')?.consoleDeepLink).toEqual({
      service: 'iam',
      resourcePath: 'apiable-logs-staging-s3-role',
    })
  })

  it('keeps every content key unique across the richer resource set', () => {
    const keys = enumeration().map((d) => d.contentKey)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('content-key collision guard', () => {
  it('fails loudly when two enumerated resources would collapse to the same content key', () => {
    // two roles whose names differ only by a character the key segment drops collide after kebab-collapse
    const build = (scope: Construct): void => {
      new iam.Role(scope, 'RoleA', { assumedBy: new iam.AccountPrincipal('222222222222'), roleName: 'apiable.role' })
      new iam.Role(scope, 'RoleB', { assumedBy: new iam.AccountPrincipal('222222222222'), roleName: 'apiable-role' })
    }
    expect(() => describeResources(stackOf(build), 'collide')).toThrow(/duplicate content key/)
  })
})

describe('unmapped resource types', () => {
  it('surfaces a synthesized resource of an unmodelled type as a generic descriptor carrying its raw CFN type — never drops it', () => {
    const descriptors = describeResources(
      stackOf((scope) => {
        new sns.Topic(scope, 'Topic', { topicName: 'unmodelled' })
      }),
      'misc',
    ).resources
    // an SNS topic is not a kind the explainer models by name, but it must still appear in the audit —
    // it surfaces as `other` carrying the raw AWS::* type, never silently vanishing
    const topic = descriptors.find((d) => d.cfnType === 'AWS::SNS::Topic')
    expect(topic).toBeDefined()
    expect(topic?.kind).toBe('other')
    // no console deep-link is fabricated for a kind the explainer has no console mapping for
    expect(topic).not.toHaveProperty('consoleDeepLink')
  })
})

describe('token-named resource', () => {
  it('falls back to the logical id and omits the deep-link when the physical name is an unresolved token', () => {
    // a bucket with no explicit bucketName synthesizes without a Name property (a token at synth time)
    const descriptors = describeResources(
      stackOf((scope) => {
        new s3.Bucket(scope, 'AutoNamedBucket')
      }),
      'auto',
    ).resources
    const bucket = descriptors.find((d) => d.kind === 'bucket')
    expect(bucket).toBeDefined()
    // identity falls back to the synthesized logical id, not a fabricated name
    expect(bucket?.identity).toMatch(/AutoNamedBucket/)
    expect(bucket).not.toHaveProperty('consoleDeepLink')
  })
})

describe('per-component key namespacing', () => {
  it('namespaces content keys under the supplied component so two constructs never share a key', () => {
    const build = (scope: Construct): void => {
      new iam.Role(scope, 'R', { assumedBy: new iam.AccountPrincipal('222222222222'), roleName: 'shared-name' })
    }
    const a = describeResources(stackOf(build, 'A'), 'component-a').resources
    const b = describeResources(stackOf(build, 'B'), 'component-b').resources
    expect(a[0].contentKey).toBe('component-a/iam-role/shared-name')
    expect(b[0].contentKey).toBe('component-b/iam-role/shared-name')
    expect(a[0].contentKey).not.toBe(b[0].contentKey)
  })
})

describe('empty stack', () => {
  it('returns an empty enumeration for a stack that creates no enumerable resources', () => {
    const enumeration = describeResources(stackOf(() => undefined), 'empty')
    expect(enumeration.component).toBe('empty')
    expect(enumeration.resources).toEqual([])
  })
})

describe('component validation', () => {
  it('fails loudly on a malformed component segment rather than producing unaddressable content keys', () => {
    const build = (scope: Construct): void => {
      new iam.Role(scope, 'R', { assumedBy: new iam.AccountPrincipal('222222222222'), roleName: 'a-role' })
    }
    for (const bad of ['', 'Has Space', 'UPPER', 'slash/inside', '-leading', 'trailing-']) {
      expect(() => describeResources(stackOf(build), bad)).toThrow(/component/)
    }
  })

  it('accepts a well-formed lower-kebab component', () => {
    const build = (scope: Construct): void => {
      new iam.Role(scope, 'R', { assumedBy: new iam.AccountPrincipal('222222222222'), roleName: 'a-role' })
    }
    expect(() => describeResources(stackOf(build), 'gateway-role')).not.toThrow()
  })
})
