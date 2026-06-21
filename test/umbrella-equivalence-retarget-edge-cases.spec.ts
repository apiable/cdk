/**
 * Test-automation coverage (Story 013-1-17) — edge/error paths of the target-shape reference
 * normalisation beyond the frozen contract's acceptance scenarios. Exercises the strangler engine on
 * boundary template shapes: a reference to a non-resource id, references nested in arrays, a retarget
 * that collapses two distinct referrers, and the assertNoStranglerDrift value/throw contract
 * under a retarget. The real `@apiable/umbrella` engine is the oracle; no policy logic is re-declared.
 */
import { cfnDifferences, isCfnEquivalent, assertNoStranglerDrift, resourceShapes } from '@apiable/umbrella'

type CfnResource = { Type: string; Properties?: unknown; [k: string]: unknown }
type Tmpl = { Resources?: Record<string, CfnResource>; Outputs?: Record<string, { Value?: unknown; Export?: { Name?: unknown } }> }
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

describe('013-1-17 retarget engine — edge & error paths', () => {
  it('a {Ref} to a parameter / pseudo id (not a template resource) is left untouched — no false drift, no crash', () => {
    // AWS::Region and a stack Parameter are referenced by Ref but are not in Resources; the resolver
    // must leave them as-is so an unrelated logical-id rename does not perturb them.
    const baseline: Tmpl = {
      Resources: {
        Bucket: { Type: 'AWS::S3::Bucket', Properties: { BucketName: { Ref: 'AWS::Region' }, Tag: { Ref: 'EnvParam' } } },
      },
    }
    const candidate = clone(baseline)
    expect(cfnDifferences(baseline, candidate)).toEqual([])
    expect(isCfnEquivalent(baseline, candidate)).toBe(true)
  })

  it('a reference nested inside an array property is normalised (retarget within a list → drift)', () => {
    const tmpl = (roleId: 'RoleA' | 'RoleB'): Tmpl => ({
      Resources: {
        RoleA: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'a' } },
        RoleB: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'b' } },
        Policy: { Type: 'AWS::IAM::Policy', Properties: { Roles: [{ Ref: 'RoleA' }, { Ref: roleId }] } },
      },
    })
    expect(cfnDifferences(tmpl('RoleA'), tmpl('RoleB')).length).toBeGreaterThan(0)
  })

  it('two distinct referrers that retarget to the SAME resource collapse in the multiset → drift', () => {
    // baseline: P1→RoleA, P2→RoleB (two distinct policy shapes). candidate: both →RoleA (one shape ×2).
    const baseline: Tmpl = {
      Resources: {
        RoleA: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'a' } },
        RoleB: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'b' } },
        P1: { Type: 'AWS::IAM::Policy', Properties: { Roles: [{ Ref: 'RoleA' }] } },
        P2: { Type: 'AWS::IAM::Policy', Properties: { Roles: [{ Ref: 'RoleB' }] } },
      },
    }
    const candidate = clone(baseline)
    ;(candidate.Resources as Record<string, CfnResource>).P2.Properties = { Roles: [{ Ref: 'RoleA' }] }
    const diffs = cfnDifferences(baseline, candidate)
    expect(diffs.some((d) => d.kind === 'resource-removed')).toBe(true)
    expect(diffs.some((d) => d.kind === 'resource-added')).toBe(true)
  })

  it('assertNoStranglerDrift returns the candidate unchanged for a pure rename, but throws naming the type on a retarget', () => {
    const renameBase: Tmpl = { Resources: { Gw: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'r' } }, Pol: { Type: 'AWS::IAM::Policy', Properties: { Roles: [{ Ref: 'Gw' }] } } } }
    // a consistent rename of the role logical id + its Ref (the id token only, not the type) →
    // the gate finds no drift and returns the candidate unchanged
    const renamed: Tmpl = JSON.parse(JSON.stringify(renameBase).split('Gw').join('RenamedGw'))
    expect(assertNoStranglerDrift(renameBase, renamed)).toBe(renamed)

    const retargetBase: Tmpl = {
      Resources: {
        RoleA: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'a' } },
        RoleB: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'b' } },
        Policy: { Type: 'AWS::IAM::Policy', Properties: { Roles: [{ Ref: 'RoleA' }] } },
      },
    }
    const retargeted = clone(retargetBase)
    ;(retargeted.Resources as Record<string, CfnResource>).Policy.Properties = { Roles: [{ Ref: 'RoleB' }] }
    expect(() => assertNoStranglerDrift(retargetBase, retargeted)).toThrow(/strangler step blocked/)
    expect(() => assertNoStranglerDrift(retargetBase, retargeted)).toThrow(/AWS::IAM::Policy/)
  })

  it('resourceShapes is stable under a consistent logical-id rename (multiset identity)', () => {
    const base: Tmpl = { Resources: { Gw: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'x' } }, Pol: { Type: 'AWS::IAM::Policy', Properties: { Roles: [{ Ref: 'Gw' }] } } } }
    const renamed: Tmpl = JSON.parse(JSON.stringify(base).split('Gw').join('RenamedGw'))
    expect([...resourceShapes(renamed).entries()].sort()).toEqual([...resourceShapes(base).entries()].sort())
  })
})
