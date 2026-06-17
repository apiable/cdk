/**
 * ATDD — Story 013-1-12: console-explainer programmatic structure scaffolding.
 * Frozen contract: contract-013-1-12-console-explainer-structure-scaffolding.md
 *
 * Structure half ONLY of the hybrid explainer — the descriptor is derived from / cross-checked
 * against what the construct actually synthesizes (Jest + aws-cdk-lib/assertions). The markdown
 * content (Epic 4 / Story 4.6) and the renderer/UI (Story 4.5) are OUT of scope.
 */
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { Construct } from 'constructs'
import * as iam from 'aws-cdk-lib/aws-iam'
import { GatewayRoleStack, GATEWAY_ROLE_COMPONENT } from '@apiable/cdk-gateway-role'
import { describeResources, ResourceDescriptor } from '@apiable/cdk-console-explainer'

const ENV = { account: '111111111111', region: 'eu-central-1' }

const pilotStack = (): GatewayRoleStack => new GatewayRoleStack(new cdk.App(), 'Pilot', { env: ENV })

const pilotDescriptors = (): readonly ResourceDescriptor[] =>
  describeResources(pilotStack(), GATEWAY_ROLE_COMPONENT).resources

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
    // the pilot's resources: an IAM role, its inline gateway-management policy, and the role-ARN output
    expect(descriptors.map((d) => d.kind).sort()).toEqual(['iam-policy', 'iam-role', 'resource-output'])
  })

  // contract: S2 — enumeration matches the construct's REAL synthesized resources, both directions
  it('S2: descriptors match the pilot role construct’s actual resources (role, inline gateway policy, ARN output) — no omission, no invention', () => {
    const stack = pilotStack()
    const template = Template.fromStack(stack).toJSON()
    const descriptors = describeResources(stack, GATEWAY_ROLE_COMPONENT).resources

    // every created resource the audit cares about appears, exactly once
    const cfnTypeForKind: Record<string, string> = {
      'iam-role': 'AWS::IAM::Role',
      'iam-policy': 'AWS::IAM::Policy',
    }
    const synthesizedResourceTypes = Object.values(template.Resources as Record<string, { Type: string }>)
      .map((r) => r.Type)
      .sort()
    const enumeratedResourceTypes = descriptors
      .filter((d) => d.kind !== 'resource-output')
      .map((d) => cfnTypeForKind[d.kind])
      .sort()
    expect(enumeratedResourceTypes).toEqual(synthesizedResourceTypes)

    // every synthesized output appears as a resource-output descriptor, exactly once
    const outputLogicalIds = Object.keys(template.Outputs ?? {}).sort()
    const enumeratedOutputIdentities = descriptors
      .filter((d) => d.kind === 'resource-output')
      .map((d) => d.identity)
      .sort()
    expect(enumeratedOutputIdentities).toEqual(outputLogicalIds)

    // no invention: total enumerated count equals synthesized resources + outputs
    const synthesizedCount =
      Object.keys(template.Resources ?? {}).length + Object.keys(template.Outputs ?? {}).length
    expect(descriptors).toHaveLength(synthesizedCount)
  })

  // contract: S3 — every content key non-empty + unique within the construct
  it('S3: every descriptor has a non-empty contentKey and the keys are unique within the construct', () => {
    const keys = pilotDescriptors().map((d) => d.contentKey)

    for (const key of keys) expect(key.trim().length).toBeGreaterThan(0)
    expect(new Set(keys).size).toBe(keys.length)
  })

  // contract: S4 — console deep-link shape derivable from kind+identity; omitted when no console representation
  it('S4: a console-representable resource exposes a deep-link shape derived from its kind+identity; others omit it (never empty/fabricated)', () => {
    const descriptors = pilotDescriptors()

    const role = descriptors.find((d) => d.kind === 'iam-role')
    expect(role?.consoleDeepLink).toEqual({ service: 'iam', resourcePath: role?.identity })

    // a stack output has no console representation — the deep-link is omitted, not empty/fabricated
    const output = descriptors.find((d) => d.kind === 'resource-output')
    expect(output).toBeDefined()
    expect(output).not.toHaveProperty('consoleDeepLink')

    // no descriptor carries an empty or partially-filled deep-link
    for (const descriptor of descriptors) {
      if (descriptor.consoleDeepLink !== undefined) {
        expect(descriptor.consoleDeepLink.service.length).toBeGreaterThan(0)
        expect(descriptor.consoleDeepLink.resourcePath.length).toBeGreaterThan(0)
      }
    }
  })

  // contract: S5 — BOUNDARY (Epic 4 seam): descriptor carries structure only, never the "why" prose
  it('S5: a descriptor contains no explanatory copy — structure only; the "why" is addressed by the contentKey, side-loaded by Epic 4', () => {
    const descriptors = pilotDescriptors()

    const structureOnlyKeys = ['kind', 'identity', 'contentKey', 'consoleDeepLink']
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
        super(scope, id, { env: ENV })
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
  })
})
