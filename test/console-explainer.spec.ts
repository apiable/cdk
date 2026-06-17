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

  it('enumerates the bucket, the write role, the inline write policy, and all three outputs', () => {
    const byKind = enumeration().reduce<Record<string, number>>((acc, d) => {
      acc[d.kind] = (acc[d.kind] ?? 0) + 1
      return acc
    }, {})
    expect(byKind).toEqual({ bucket: 1, 'iam-role': 1, 'iam-policy': 1, 'resource-output': 3 })
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
  it('skips a synthesized resource of a kind the explainer does not model — never invents a descriptor for it', () => {
    const descriptors = describeResources(
      stackOf((scope) => {
        new sns.Topic(scope, 'Topic', { topicName: 'unmodelled' })
      }),
      'misc',
    ).resources
    // an SNS topic is not an enumerated kind; only its synthesized output (if any) would appear, never a topic descriptor
    expect(descriptors.every((d) => d.kind !== 'bucket' && d.identity !== 'unmodelled')).toBe(true)
    expect(descriptors.some((d) => d.kind === 'iam-role')).toBe(false)
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
