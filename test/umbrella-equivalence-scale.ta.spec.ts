/**
 * Supplementary coverage for story 013-1-22 beyond the frozen-contract scale scenarios: the
 * adversarially-ordered deep-chain resolution (across both the plain `Ref` and the `Ref`+top-level-
 * `DependsOn` axes), surrogate distinctness/collapse on isolated subtrees, a harder lattice, and a
 * mixed deep-chain + cycle + lattice graph. Every case drives the real `@apiable/umbrella` equivalence
 * engine — no resolution logic is re-declared here.
 *
 * The deep-chain cases are built in REVERSE-INSERTION order on purpose: the deepest link is declared
 * first, so the resolver meets the top of the chain before any descendant is resolved. A resolver that
 * recursed across resources would descend the full live depth here and throw a raw V8 `RangeError`
 * (a reverse-ordered chain crosses the native call-stack floor — smaller still under a Jest worker
 * thread — around depth ~1300-1900); these run an order of magnitude deeper than that. They stay O(nodes)
 * and crash-free only because the engine pre-resolves the reference graph through an explicit work-stack,
 * so the live recursion never spans more than one resource's own property tree regardless of insertion
 * order. An insertion-ordered chain would memoise bottom-up to O(1) live depth and pass even a naive
 * resolver — so it would NOT exercise this, which is why these are reverse-ordered.
 */
import { cfnDifferences, isCfnEquivalent, assertNoStranglerDrift, resourceShapes } from '@apiable/umbrella'

type CfnResource = { Type: string; Properties?: unknown; [k: string]: unknown }
type Tmpl = { Resources?: Record<string, CfnResource> }
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const NODE_COUNT = (t: Tmpl): number => Object.keys(t.Resources ?? {}).length

/**
 * A linear `Ref` chain `depth` links deep declared in REVERSE-INSERTION order (deepest link first,
 * `Leaf` last). The top of the chain is resolved before any link below it, so a cross-resource-recursing
 * resolver descends the full depth live and `RangeError`s; the work-stack pre-resolve keeps it O(nodes).
 */
const reverseRefChain = (depth: number): Tmpl => {
  const resources: Record<string, CfnResource> = {}
  for (let i = depth; i >= 1; i--) {
    resources[`Link${i}`] = { Type: 'AWS::IAM::Role', Properties: { RoleName: `link-${i}`, Below: { Ref: i === 1 ? 'Leaf' : `Link${i - 1}` } } }
  }
  resources.Leaf = { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'leaf' } }
  return { Resources: resources }
}

/**
 * The same reverse-ordered chain where each link ALSO carries a top-level `DependsOn` to the resource it
 * references — the `DependsOn` axis, which reference-normalises through the same resolver path, so a
 * naive resolver expands the target twice per level and crosses the native floor a little shallower.
 */
const reverseRefDependsChain = (depth: number): Tmpl => {
  const resources: Record<string, CfnResource> = {}
  for (let i = depth; i >= 1; i--) {
    const below = i === 1 ? 'Leaf' : `Link${i - 1}`
    resources[`Link${i}`] = { Type: 'AWS::IAM::Role', DependsOn: below, Properties: { RoleName: `link-${i}`, Below: { Ref: below } } }
  }
  resources.Leaf = { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'leaf' } }
  return { Resources: resources }
}

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

const elapsedMs = (fn: () => void): number => {
  const started = Date.now()
  fn()
  return Date.now() - started
}

describe('013-1-22 umbrella equivalence at scale (TA)', () => {
  it('an adversarially reverse-ordered Ref chain far deeper than the native call-stack floor resolves without a raw RangeError, in time proportional to node count', () => {
    // 12_000 deep, declared deepest-first: an order of magnitude past the ~1300-1900 depth at which a
    // cross-resource-recursing resolver RangeErrors. The work-stack pre-resolve keeps live recursion to
    // one resource's own property tree, so it neither throws nor slows — O(nodes), not O(nodes × depth).
    const baseline = reverseRefChain(12_000)
    const candidate = clone(baseline)
    let threw = false
    const ms = elapsedMs(() => {
      try {
        expect(cfnDifferences(baseline, candidate)).toEqual([])
      } catch (e) {
        threw = true
        throw e
      }
    })
    expect(threw).toBe(false)
    expect(isCfnEquivalent(baseline, candidate)).toBe(true)
    expect(ms).toBeLessThan(4000)
  })

  it('the same reverse-ordered chain on the DependsOn axis (each link also DependsOn the resource it references) resolves without a raw RangeError, proportional to node count', () => {
    // The DependsOn axis normalises through the same resolver path, so a naive resolver crosses the
    // native floor a little shallower here; the work-stack pre-resolve makes the doubled coupling free.
    const baseline = reverseRefDependsChain(12_000)
    const candidate = clone(baseline)
    let threw = false
    const ms = elapsedMs(() => {
      try {
        expect(cfnDifferences(baseline, candidate)).toEqual([])
      } catch (e) {
        threw = true
        throw e
      }
    })
    expect(threw).toBe(false)
    expect(isCfnEquivalent(baseline, candidate)).toBe(true)
    expect(ms).toBeLessThan(4000)
  })

  it('a retarget at the deep tail of a reverse-ordered chain is still caught as drift (the depth did not collapse detection)', () => {
    const baseline = reverseRefChain(5_000)
    const candidate = clone(baseline)
    ;(candidate.Resources as Record<string, CfnResource>).Leaf.Properties = { BucketName: 'retargeted-leaf' }
    expect(cfnDifferences(baseline, candidate).length).toBeGreaterThan(0)
    expect(() => assertNoStranglerDrift(baseline, candidate)).toThrow(/strangler step blocked/)
  })

  it('two isolated subtrees of identical shape collapse to one surrogate; a single shape change re-separates them', () => {
    // Twins: same Type + Properties, referenced by two distinct consumers. Identical shape ⇒ the
    // multiset counts them together and a self-compare is equivalent.
    const twins = (variantTag: string): Tmpl => ({
      Resources: {
        TwinA: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'twin', Tags: [{ Key: 'role', Value: variantTag }] } },
        TwinB: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'twin', Tags: [{ Key: 'role', Value: variantTag }] } },
        ConsumerA: { Type: 'AWS::Lambda::Function', Properties: { FunctionName: 'ca', B: { Ref: 'TwinA' } } },
        ConsumerB: { Type: 'AWS::Lambda::Function', Properties: { FunctionName: 'cb', B: { Ref: 'TwinB' } } },
      },
    })
    const baseline = twins('same')
    expect(cfnDifferences(baseline, clone(baseline))).toEqual([])
    // the two identical bucket shapes share one multiset key (collapsed surrogate)
    const buckets = [...resourceShapes(baseline).entries()].filter(([key]) => key.includes('AWS::S3::Bucket'))
    expect(buckets).toHaveLength(1)
    expect(buckets[0][1]).toBe(2)

    // change ONLY TwinB's shape: the surrogate re-separates and the consumer references differ
    const candidate = clone(baseline)
    ;(candidate.Resources as Record<string, CfnResource>).TwinB.Properties = { BucketName: 'twin', Tags: [{ Key: 'role', Value: 'changed' }] }
    expect(cfnDifferences(baseline, candidate).length).toBeGreaterThan(0)
  })

  it('a harder lattice (levels=16, ~150 nodes) still completes promptly', () => {
    const baseline = fanOutLattice(16)
    expect(NODE_COUNT(baseline)).toBeGreaterThanOrEqual(150)
    const candidate = clone(baseline)
    const ms = elapsedMs(() => {
      expect(assertNoStranglerDrift(baseline, candidate)).toBe(candidate)
    })
    expect(ms).toBeLessThan(1500)
  })

  it('a mixed graph (deep chain feeding a lattice with an embedded cycle) resolves once and stays self-equivalent', () => {
    const baseline = fanOutLattice(10)
    const resources = baseline.Resources as Record<string, CfnResource>
    // graft a deep chain whose tail feeds the lattice root, and a small cycle off a leaf
    resources.ChainLeaf = { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'chain-leaf' } }
    for (let i = 1; i <= 50; i++) {
      resources[`Chain${i}`] = { Type: 'AWS::IAM::Role', Properties: { RoleName: `chain-${i}`, Below: { Ref: i === 1 ? 'ChainLeaf' : `Chain${i - 1}` } } }
    }
    ;(resources.N0_0.Properties as Record<string, unknown>).Feed = { Ref: 'Chain50' }
    resources.CycleX = { Type: 'AWS::IAM::Role', Properties: { RoleName: 'cycle-x', Peer: { Ref: 'CycleY' } } }
    resources.CycleY = { Type: 'AWS::IAM::Role', Properties: { RoleName: 'cycle-y', Peer: { Ref: 'CycleX' } } }
    const candidate = clone(baseline)
    const ms = elapsedMs(() => {
      expect(cfnDifferences(baseline, candidate)).toEqual([])
    })
    expect(ms).toBeLessThan(1500)
    // a retarget INTO the embedded cycle is still caught
    const drifted = clone(baseline)
    ;(drifted.Resources as Record<string, CfnResource>).CycleX.Properties = { RoleName: 'cycle-x', Peer: { Ref: 'ChainLeaf' } }
    expect(cfnDifferences(baseline, drifted).length).toBeGreaterThan(0)
  })
})
