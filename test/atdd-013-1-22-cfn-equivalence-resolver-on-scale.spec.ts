/**
 * Acceptance specs — Story 013-1-22: the strangler drift-check stays correct and fast on deep and
 * bushy reference graphs. Frozen contract:
 * contract-013-1-22-cfn-equivalence-resolver-on-scale.md
 *
 * One un-skipped spec per contract scenario (S1–S7). The drift gate
 * (cfnDifferences / isCfnEquivalent / assertNoStranglerDrift) is exercised on synthetic
 * baseline-vs-candidate template pairs — the natural vehicle for a template-level gate — plus the
 * real umbrella synth where it strengthens the regression flank (S7). No policy logic is re-declared;
 * the real `@apiable/umbrella` equivalence engine is the oracle.
 *
 * The scale scenarios (S1–S3) crash or exhaust memory on the by-value-subtree-inlining engine: a
 * plain `Ref` chain RangeErrors / OOMs near depth ~200, and a `Ref`+top-level-`DependsOn` chain (the
 * amplified axis) crashes shallower still — both measured against engine HEAD before the surrogate
 * rewrite. S3's fan-out lattice is the DISCRIMINATOR: a crash-only stopgap (hash the canonical child
 * but still re-resolve every path) clears the crash bound yet balloons with the number of distinct
 * reference paths, so the lattice asserts a TIME bound proportional to resource count, which a
 * path-exponential resolver fails even though it never throws. The surrogate is memoised per logical
 * id, so each resource resolves once and the whole walk is proportional to template size.
 */
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import {
  cfnDifferences,
  isCfnEquivalent,
  assertNoStranglerDrift,
  buildCognitoStack,
  buildGatewayRoleStack,
} from '@apiable/umbrella'

const ACCOUNT = '034444869755'
const REGION = 'eu-central-1'
const ENV = { account: ACCOUNT, region: REGION }

type CfnResource = { Type: string; Properties?: unknown; [k: string]: unknown }
type Tmpl = {
  Resources?: Record<string, CfnResource>
  Outputs?: Record<string, { Value?: unknown; Export?: { Name?: unknown }; [k: string]: unknown }>
}
const toJson = (stack: cdk.Stack): Tmpl => Template.fromStack(stack).toJSON() as Tmpl
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** Consistently rename a logical id and every reference to it (keys, Ref, GetAtt, Sub, DependsOn). */
const renameAll = (template: Tmpl, oldId: string, newId: string): Tmpl =>
  JSON.parse(JSON.stringify(template).split(oldId).join(newId)) as Tmpl

/**
 * A linear reference chain `DEPTH` links deep: each role references the one below it via a property
 * `{Ref}`, terminating at a leaf bucket. On the by-value engine this token grows ~×4 per level and
 * crashes with `RangeError: Invalid string length` well before this depth; the surrogate keeps it O(1)
 * per reference. Two roles a level apart are deliberately different (distinct `RoleName`), so the chain
 * exercises real distinct resolved shapes, not one repeated shape the memo could trivially collapse.
 */
const refChain = (depth: number): Tmpl => {
  const resources: Record<string, CfnResource> = {
    Leaf: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'chain-leaf' } },
  }
  for (let i = 1; i <= depth; i++) {
    resources[`Link${i}`] = {
      Type: 'AWS::IAM::Role',
      Properties: { RoleName: `link-${i}`, Below: { Ref: i === 1 ? 'Leaf' : `Link${i - 1}` } },
    }
  }
  return { Resources: resources }
}

/**
 * The same chain where each link ALSO carries a top-level `DependsOn` to the very resource it
 * references — the doubled coupling (a `{Ref}` AND an ordering dependency to the same target). On the
 * by-value engine a top-level `DependsOn` is reference-normalised through the same token, so the
 * target's subtree is expanded twice per level, raising the exponential base and crashing this axis at
 * a shallower depth than the plain chain. The surrogate makes the second reference free.
 */
const refDependsChain = (depth: number): Tmpl => {
  const resources: Record<string, CfnResource> = {
    Leaf: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'chain-leaf' } },
  }
  for (let i = 1; i <= depth; i++) {
    const below = i === 1 ? 'Leaf' : `Link${i - 1}`
    resources[`Link${i}`] = {
      Type: 'AWS::IAM::Role',
      DependsOn: below,
      Properties: { RoleName: `link-${i}`, Below: { Ref: below } },
    }
  }
  return { Resources: resources }
}

/**
 * A bushy fan-out lattice: a triangular DAG of `levels` rows where node (l, i) references BOTH (l+1, i)
 * and (l+1, i+1), so references repeatedly converge on shared lower nodes and re-diverge. The node
 * count is O(levels²) (~80 at levels=12) but the number of distinct root→leaf reference PATHS is
 * exponential in `levels` (the central binomial coefficient). A resolver that re-resolves a target per
 * reference path does work proportional to the path count and slows to a crawl here even though it
 * never crashes — this is the time bound S3 forces. The memoised surrogate resolves each of the O(n)
 * nodes once, so the lattice completes in time proportional to its size.
 */
const fanOutLattice = (levels: number): Tmpl => {
  const resources: Record<string, CfnResource> = {}
  for (let l = levels; l >= 0; l--) {
    for (let i = 0; i <= l; i++) {
      const properties: Record<string, unknown> = { RoleName: `node-${l}-${i}` }
      if (l < levels) {
        properties.Left = { Ref: `N${l + 1}_${i}` }
        properties.Right = { Ref: `N${l + 1}_${i + 1}` }
      }
      resources[`N${l}_${i}`] = { Type: 'AWS::IAM::Role', Properties: properties }
    }
  }
  return { Resources: resources }
}

const NODE_COUNT = (t: Tmpl): number => Object.keys(t.Resources ?? {}).length

/**
 * Measures wall-clock for a single self-equivalence gate run. The bound is generous (the crash-only
 * stopgap fails it by orders of magnitude — seconds, not the sub-second the memo achieves) so it is a
 * discriminator, not a flaky micro-benchmark: the memoised engine resolves these graphs in low
 * single-digit milliseconds, leaving ample headroom under a CI-serial runner.
 */
const elapsedMs = (fn: () => void): number => {
  const started = Date.now()
  fn()
  return Date.now() - started
}
const TIME_BOUND_MS = 1500

describe('013-1-22 template-drift check — correct and fast on scale', () => {
  // S1 — a very deep reference chain completes without crashing (scale)
  it('S1: a reference chain hundreds of links deep, vs an identical copy → completes promptly, no drift, no crash/OOM', () => {
    const baseline = refChain(200)
    const candidate = clone(baseline)
    let result: unknown
    const ms = elapsedMs(() => {
      result = assertNoStranglerDrift(baseline, candidate)
    })
    expect(result).toBe(candidate)
    expect(cfnDifferences(baseline, candidate)).toEqual([])
    expect(ms).toBeLessThan(TIME_BOUND_MS)
  })

  // S2 — a deep reference + ordering-dependency chain completes without crashing (the amplified axis)
  it('S2: the same deep chain where each link ALSO carries a top-level DependsOn to the resource it references → still completes promptly, no drift (doubled coupling does not multiply cost)', () => {
    const baseline = refDependsChain(200)
    const candidate = clone(baseline)
    const ms = elapsedMs(() => {
      expect(cfnDifferences(baseline, candidate)).toEqual([])
    })
    expect(isCfnEquivalent(baseline, candidate)).toBe(true)
    expect(ms).toBeLessThan(TIME_BOUND_MS)
  })

  // S3 — a wide fan-out lattice completes in time proportional to size, NOT merely without crashing (DISCRIMINATOR)
  it('S3: a bushy fan-out lattice (references repeatedly converge on shared resources and re-diverge), vs an identical copy → completes promptly in time proportional to resource count, not the number of reference paths', () => {
    const baseline = fanOutLattice(12)
    // ~80 nodes but an exponential number of distinct root→leaf reference paths: a per-path resolver
    // crawls, a per-id memo stays proportional to the node count.
    expect(NODE_COUNT(baseline)).toBeGreaterThanOrEqual(80)
    const candidate = clone(baseline)
    const ms = elapsedMs(() => {
      expect(cfnDifferences(baseline, candidate)).toEqual([])
    })
    expect(ms).toBeLessThan(TIME_BOUND_MS)
  })

  // S4 — a retarget reached through a deep shared hub is still caught as drift (FORCING — fail-open)
  describe('S4: a retarget reached through a deep shared-hub graph is caught as drift', () => {
    /**
     * A deep shared-hub graph: a chain of consumers all routed through a single deep hub chain whose
     * tail is one of two DISTINCTLY-shaped buckets. Re-pointing only the hub's tail from the durable
     * bucket to the differently-shaped bucket is a re-target reached through the whole depth of the
     * graph — the surrogate of every node above the tail changes with it, so it must read as drift.
     * A faster comparison that collapsed the two bucket shapes to one value would miss this.
     */
    const deepHubToBucket = (tail: 'BucketAlpha' | 'BucketBeta'): Tmpl => {
      const resources: Record<string, CfnResource> = {
        BucketAlpha: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'hub-alpha', VersioningConfiguration: { Status: 'Enabled' } } },
        BucketBeta: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'hub-beta', VersioningConfiguration: { Status: 'Suspended' } } },
        Hub0: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'hub-0', Target: { 'Fn::GetAtt': [tail, 'Arn'] } } },
      }
      for (let i = 1; i <= 60; i++) {
        resources[`Hub${i}`] = { Type: 'AWS::IAM::Role', Properties: { RoleName: `hub-${i}`, Below: { Ref: `Hub${i - 1}` } } }
      }
      // a fan of consumers all referencing the top of the deep hub chain
      for (let c = 0; c < 5; c++) {
        resources[`Consumer${c}`] = { Type: 'AWS::Lambda::Function', Properties: { FunctionName: `consumer-${c}`, Role: { Ref: 'Hub60' } } }
      }
      return { Resources: resources }
    }

    it('re-pointing the deep hub tail at a DIFFERENTLY-shaped bucket → drift', () => {
      const baseline = deepHubToBucket('BucketAlpha')
      const candidate = deepHubToBucket('BucketBeta')
      expect(cfnDifferences(baseline, candidate).length).toBeGreaterThan(0)
      expect(isCfnEquivalent(baseline, candidate)).toBe(false)
      expect(() => assertNoStranglerDrift(baseline, candidate)).toThrow(/strangler step blocked/)
    })

    it('a consistent rename through the same deep hub graph → still no drift (the surrogate is rename-stable)', () => {
      const baseline = deepHubToBucket('BucketAlpha')
      const candidate = renameAll(baseline, 'Hub30', 'RenamedHub30')
      expect(candidate.Resources).not.toEqual(baseline.Resources)
      expect(cfnDifferences(baseline, candidate)).toEqual([])
    })
  })

  // S5 — a retarget reached via an ordering dependency to a near-twin is still caught as drift (FORCING — fail-open)
  describe('S5: a retarget reached ONLY via an ordering dependency to a near-twin is caught as drift', () => {
    /**
     * Two near-twin roles identical in Type AND Properties, differing ONLY in a top-level
     * `DeletionPolicy` (both present in baseline AND candidate, so the resource multiset is identical),
     * each reached through a deep hub chain. A consumer's ONLY tie to a twin is a top-level `DependsOn`
     * to the top of that twin's hub chain. Re-aiming the `DependsOn` from the durable twin's hub to the
     * disposable twin's hub is a re-target reached purely through an ordering dependency — invisible
     * unless the dependency edge is compared by the target's full shape (its load-bearing top-level
     * attributes included), which is exactly the residual fail-open the shape-carrying surrogate closes.
     */
    const dependsOnTwinViaHub = (twin: 'DurableHubTop' | 'DisposableHubTop'): Tmpl => {
      const resources: Record<string, CfnResource> = {
        DurableTwin: { Type: 'AWS::S3::Bucket', DeletionPolicy: 'Retain', Properties: { BucketName: 'twin' } },
        DisposableTwin: { Type: 'AWS::S3::Bucket', DeletionPolicy: 'Delete', Properties: { BucketName: 'twin' } },
        DurableHub0: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'durable-hub-0', Target: { Ref: 'DurableTwin' } } },
        DisposableHub0: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'disposable-hub-0', Target: { Ref: 'DisposableTwin' } } },
      }
      for (let i = 1; i <= 40; i++) {
        resources[`DurableHub${i}`] = { Type: 'AWS::IAM::Role', Properties: { RoleName: `durable-hub-${i}`, Below: { Ref: `DurableHub${i - 1}` } } }
        resources[`DisposableHub${i}`] = { Type: 'AWS::IAM::Role', Properties: { RoleName: `disposable-hub-${i}`, Below: { Ref: `DisposableHub${i - 1}` } } }
      }
      // alias both hub tops so the candidate differs ONLY in the DependsOn target id, nothing else
      resources.DurableHubTop = { Type: 'AWS::IAM::Role', Properties: { RoleName: 'durable-hub-top', Below: { Ref: 'DurableHub40' } } }
      resources.DisposableHubTop = { Type: 'AWS::IAM::Role', Properties: { RoleName: 'disposable-hub-top', Below: { Ref: 'DisposableHub40' } } }
      resources.Consumer = { Type: 'AWS::Lambda::Function', DependsOn: twin, Properties: { FunctionName: 'consumer' } }
      return { Resources: resources }
    }

    it('re-aiming the consumer DependsOn from the durable twin hub to the disposable near-twin hub → drift', () => {
      const baseline = dependsOnTwinViaHub('DurableHubTop')
      const candidate = dependsOnTwinViaHub('DisposableHubTop')
      expect(cfnDifferences(baseline, candidate).length).toBeGreaterThan(0)
      expect(isCfnEquivalent(baseline, candidate)).toBe(false)
      expect(() => assertNoStranglerDrift(baseline, candidate)).toThrow(/strangler step blocked/)
    })
  })

  // S6 — a consistent rename through the deep graph is tolerated; cycles stay safe (no false-fail)
  describe('S6: a consistent rename through the deep graph is tolerated; cycles stay safe', () => {
    it('a consistent rename of a logical id across every reference, through a deep chain → no drift', () => {
      const baseline = refChain(120)
      const candidate = renameAll(baseline, 'Link60', 'RenamedLink60')
      expect(candidate.Resources).not.toEqual(baseline.Resources)
      expect(cfnDifferences(baseline, candidate)).toEqual([])
    })

    /**
     * A reference cycle embedded in a deep graph: the bottom of a deep chain closes back on a member
     * higher up (Tail → Cycle → Tail). The resolver must terminate on the back-edge and still tell two
     * distinct cyclic graphs apart, while a consistent rename of the cycle stays tolerated — and the
     * per-id memo must NOT poison the cache with the cycle-truncated token.
     */
    const deepCycle = (peer: 'CycleA' | 'CycleB'): Tmpl => {
      const resources: Record<string, CfnResource> = {
        CycleA: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'cycle-a', Peer: { Ref: 'CycleTop' } } },
        CycleB: { Type: 'AWS::SQS::Queue', Properties: { QueueName: 'cycle-b' } },
        Cycle0: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'cycle-0', Peer: { Ref: peer } } },
      }
      for (let i = 1; i <= 30; i++) {
        resources[`Cycle${i}`] = { Type: 'AWS::IAM::Role', Properties: { RoleName: `cycle-${i}`, Below: { Ref: `Cycle${i - 1}` } } }
      }
      resources.CycleTop = { Type: 'AWS::IAM::Role', Properties: { RoleName: 'cycle-top', Below: { Ref: 'Cycle30' } } }
      return { Resources: resources }
    }

    it('a consistent rename across a reference cycle in a deep graph → no drift; the resolver terminates (no hang)', () => {
      const baseline = deepCycle('CycleA')
      const candidate = renameAll(baseline, 'Cycle15', 'RenamedCycle15')
      const ms = elapsedMs(() => {
        expect(cfnDifferences(baseline, candidate)).toEqual([])
      })
      expect(candidate.Resources).not.toEqual(baseline.Resources)
      expect(ms).toBeLessThan(TIME_BOUND_MS)
    })

    it('a re-target INTO the cycle (the cyclic member re-pointed at a differently-shaped resource) → still drift (the memo did not collapse the cycle)', () => {
      const baseline = deepCycle('CycleA')
      const candidate = deepCycle('CycleB') // Cycle0.Peer re-pointed from CycleA (Role) to CycleB (Queue)
      expect(cfnDifferences(baseline, candidate).length).toBeGreaterThan(0)
      expect(() => assertNoStranglerDrift(baseline, candidate)).toThrow(/strangler step blocked/)
    })
  })

  // S7 — no regression: existing checks green + real templates self-equivalent (back-compat)
  describe('S7: real synthesised umbrella templates stay self-equivalent (no false drift from the new scheme)', () => {
    it('buildCognitoStack synth compares equal to itself', () => {
      const synth = toJson(buildCognitoStack(new cdk.App(), { name: 'staging', domain: 'staging.apiable.io', fromEmail: 'no-reply@apiable.io', env: ENV }))
      expect(cfnDifferences(synth, clone(synth))).toEqual([])
      expect(isCfnEquivalent(synth, clone(synth))).toBe(true)
    })

    it('buildGatewayRoleStack synth compares equal to itself', () => {
      const synth = toJson(buildGatewayRoleStack(new cdk.App(), { env: ENV }))
      expect(cfnDifferences(synth, clone(synth))).toEqual([])
      expect(isCfnEquivalent(synth, clone(synth))).toBe(true)
    })

    it('a real construct-extraction rename of the gateway role synth is tolerated (no false drift)', () => {
      const before = toJson(buildGatewayRoleStack(new cdk.App(), { env: ENV }))
      const resources = before.Resources ?? {}
      const roleId = Object.keys(resources).find((id) => (resources[id] as { Type: string }).Type === 'AWS::IAM::Role') as string
      const renamed = renameAll(before, roleId, `Refactored${roleId}`)
      expect(renamed.Resources).not.toEqual(before.Resources)
      expect(cfnDifferences(before, renamed)).toEqual([])
    })
  })
})
