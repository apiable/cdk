/**
 * ATDD — Story 013-1-12: console-explainer programmatic structure scaffolding.
 * Frozen contract: contract-013-1-12-console-explainer-structure-scaffolding.md
 *
 * Structure half ONLY of the hybrid explainer — the descriptor is derived from / cross-checked
 * against what the construct actually synthesizes (Jest + aws-cdk-lib/assertions). The markdown
 * content (Epic 4 / Story 4.6) and the renderer/UI (Story 4.5) are OUT of scope.
 *
 * The scenarios assert the descriptor against the PUBLISHED (no-`env`) artifact each construct ships
 * via `buildPublishedStack` — the exact shape Epic 4 consumes — so the spec validates what is shipped,
 * not an env-bearing synth that flips identities, content keys, and deep-links. In the published shape
 * every physical name is a deploy-time token, so every console deep-link is correctly omitted (S4's
 * omit-never-fabricate clause); the positive deep-link derivation is proven on a fixed-name construct
 * in the supplementary suite.
 */
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { Construct } from 'constructs'
import * as iam from 'aws-cdk-lib/aws-iam'
import { buildPublishedStack, GATEWAY_ROLE_COMPONENT } from '@apiable/cdk-gateway-role'
import {
  buildPublishedStack as buildPublishedLogsBucketStack,
  LOGS_BUCKET_COMPONENT,
} from '@apiable/cdk-logs-bucket'
import { describeResources, ResourceDescriptor } from '@apiable/cdk-console-explainer'

/** The pilot construct as published in its one-click launch-stack template (no `env`). */
const pilotStack = (): cdk.Stack => buildPublishedStack(new cdk.App())

const pilotDescriptors = (): readonly ResourceDescriptor[] =>
  describeResources(pilotStack(), GATEWAY_ROLE_COMPONENT).resources

/** The two CFN resource types whose CFN type the audit pins on the pilot. */
const cfnTypeForKind: Record<string, string> = {
  'iam-role': 'AWS::IAM::Role',
  'iam-policy': 'AWS::IAM::Policy',
}

/**
 * The accuracy oracle, exercised per construct: the enumeration accounts for EVERY synthesized
 * resource (one descriptor each, raw CFN type carried) and EVERY synthesized output, and invents
 * nothing the construct does not create. Running it on the construct that synthesizes a droppable
 * resource (logs-bucket's `AWS::S3::BucketPolicy`) is what reds the spec if a resource is silently
 * dropped from the audit.
 */
const assertEnumerationMatchesSynth = (stack: cdk.Stack, component: string): void => {
  const template = Template.fromStack(stack).toJSON()
  const descriptors = describeResources(stack, component).resources

  // every synthesized resource surfaces exactly once, carrying its raw CFN type — nothing is dropped
  const synthesizedResourceTypes = Object.values(template.Resources as Record<string, { Type: string }>)
    .map((r) => r.Type)
    .sort()
  const enumeratedResourceTypes = descriptors
    .filter((d) => d.kind !== 'resource-output')
    .map((d) => d.cfnType)
    .sort()
  expect(enumeratedResourceTypes).toEqual(synthesizedResourceTypes)

  // every synthesized output appears as a resource-output descriptor, exactly once
  const outputLogicalIds = Object.keys(template.Outputs ?? {}).sort()
  const enumeratedOutputIdentities = descriptors
    .filter((d) => d.kind === 'resource-output')
    .map((d) => d.identity)
    .sort()
  expect(enumeratedOutputIdentities).toEqual(outputLogicalIds)

  // no invention: total enumerated count equals synthesized resources + outputs (bidirectional)
  const synthesizedCount =
    Object.keys(template.Resources ?? {}).length + Object.keys(template.Outputs ?? {}).length
  expect(descriptors).toHaveLength(synthesizedCount)
}

describe('013-1-12 console-explainer resource descriptors — structure contract', () => {
  // contract: S1 — typed enumeration, one descriptor per resource, each with kind + identity + content key
  it('S1: a construct yields a typed list of {kind, identity, contentKey} descriptors, one per created resource', () => {
    const descriptors = pilotDescriptors()

    expect(descriptors.length).toBeGreaterThan(0)
    for (const descriptor of descriptors) {
      expect(typeof descriptor.kind).toBe('string')
      expect(descriptor.identity.length).toBeGreaterThan(0)
      expect(descriptor.contentKey.length).toBeGreaterThan(0)
    }
    // the pilot's published resources: an IAM role, its inline gateway-management policy, and the role-ARN output
    expect(descriptors.map((d) => d.kind).sort()).toEqual(['iam-policy', 'iam-role', 'resource-output'])
  })

  // contract: S2 — enumeration matches the construct's REAL synthesized resources, both directions
  it('S2: descriptors match the pilot role construct’s actual resources (role, inline gateway policy, ARN output) — no omission, no invention', () => {
    assertEnumerationMatchesSynth(pilotStack(), GATEWAY_ROLE_COMPONENT)
  })

  // contract: S2 — the oracle holds on a construct that synthesizes a resource the explainer could drop
  it('S2: the accuracy oracle holds on the logs-bucket construct, whose AWS::S3::BucketPolicy must not silently drop from the audit', () => {
    const logsBucket = buildPublishedLogsBucketStack(new cdk.App())
    assertEnumerationMatchesSynth(logsBucket, LOGS_BUCKET_COMPONENT)

    // the security-load-bearing bucket policy surfaces with its own kind, not dropped
    const descriptors = describeResources(logsBucket, LOGS_BUCKET_COMPONENT).resources
    const bucketPolicy = descriptors.find((d) => d.cfnType === 'AWS::S3::BucketPolicy')
    expect(bucketPolicy).toBeDefined()
    expect(bucketPolicy?.kind).toBe('bucket-policy')
  })

  // contract: S3 — every content key non-empty + unique within the construct
  it('S3: every descriptor has a non-empty contentKey and the keys are unique within the construct', () => {
    const keys = pilotDescriptors().map((d) => d.contentKey)

    for (const key of keys) expect(key.trim().length).toBeGreaterThan(0)
    expect(new Set(keys).size).toBe(keys.length)
  })

  // contract: S4 — console deep-link shape derivable from kind+identity; omitted when not derivable
  it('S4: the published artifact’s token-named resources omit the deep-link (never empty/fabricated), as do outputs', () => {
    const descriptors = pilotDescriptors()

    // a stack output has no console representation — the deep-link is omitted, not empty/fabricated
    const output = descriptors.find((d) => d.kind === 'resource-output')
    expect(output).toBeDefined()
    expect(output).not.toHaveProperty('consoleDeepLink')

    // the published role's physical name is a deploy-time token (region-parameterised), so its
    // deep-link is not derivable and is correctly omitted rather than fabricated from the token
    const role = descriptors.find((d) => d.kind === 'iam-role')
    expect(role).toBeDefined()
    expect(role).not.toHaveProperty('consoleDeepLink')

    // no descriptor carries an empty or partially-filled deep-link
    for (const descriptor of descriptors) {
      if (descriptor.consoleDeepLink !== undefined) {
        expect(descriptor.consoleDeepLink.service.length).toBeGreaterThan(0)
        expect(descriptor.consoleDeepLink.resourcePath.length).toBeGreaterThan(0)
      }
    }
  })

  // contract: S4 — the deep-link IS derived from kind+identity when the resource has a fixed, addressable name
  it('S4: a console-representable resource with a fixed physical name exposes a deep-link derived from its kind+identity', () => {
    // a construct that fixes a physical name has a console-addressable identity, so the deep-link is
    // derivable (not fabricated) — proving S4's positive clause the published token-named shape omits
    class FixedNameStack extends cdk.Stack {
      constructor(scope: Construct, id: string) {
        super(scope, id)
        new iam.Role(this, 'FixedRole', {
          assumedBy: new iam.AccountPrincipal('222222222222'),
          roleName: 'apiable-fixed-name-role',
        })
      }
    }

    const role = describeResources(new FixedNameStack(new cdk.App(), 'Fixed'), 'fixed').resources.find(
      (d) => d.kind === 'iam-role',
    )
    expect(role?.consoleDeepLink).toEqual({ service: 'iam', resourcePath: 'apiable-fixed-name-role' })
  })

  // contract: S5 — BOUNDARY (Epic 4 seam): descriptor carries structure only, never the "why" prose
  it('S5: a descriptor contains no explanatory copy — structure only; the "why" is addressed by the contentKey, side-loaded by Epic 4', () => {
    const descriptors = pilotDescriptors()

    const structureOnlyKeys = ['kind', 'cfnType', 'identity', 'contentKey', 'consoleDeepLink']
    for (const descriptor of descriptors) {
      // only the structural fields are present — no description/why/copy/prose carrier
      expect(Object.keys(descriptor).every((key) => structureOnlyKeys.includes(key))).toBe(true)
    }
  })

  // contract: S6 — a newly added construct is auto-adopted via the stable interface, no consumer-side change
  it('S6: a new construct exposing the same interface is discovered by an iterating consumer with no change on the consuming (Epic 4) side', () => {
    // a brand-new construct the explainer has never seen, defining a resource that synthesizes
    class NewConstructStack extends cdk.Stack {
      constructor(scope: Construct, id: string) {
        super(scope, id)
        new iam.Role(this, 'NewlyAddedRole', {
          assumedBy: new iam.AccountPrincipal('222222222222'),
          roleName: 'apiable-newly-added-role',
        })
      }
    }

    // the consumer iterates the SAME interface used for every other construct — no per-construct code
    const enumerate = (stack: cdk.Stack, component: string): readonly ResourceDescriptor[] =>
      describeResources(stack, component).resources

    const descriptors = enumerate(new NewConstructStack(new cdk.App(), 'New'), 'newly-added')
    const role = descriptors.find((d) => d.kind === 'iam-role')
    expect(role).toBeDefined()
    expect(role?.identity).toBe('apiable-newly-added-role')
    expect(role?.contentKey).toBe('newly-added/iam-role/apiable-newly-added-role')
    expect(role?.consoleDeepLink).toEqual({ service: 'iam', resourcePath: 'apiable-newly-added-role' })
  })
})
