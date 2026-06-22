/**
 * Supplementary coverage for story 013-1-22 beyond the frozen-contract scale scenarios: the
 * depth-ceiling graceful-degrade floor, surrogate distinctness/collapse on isolated subtrees, a
 * harder lattice, and a mixed deep-chain + cycle + lattice graph. Every case drives the real
 * `@apiable/umbrella` equivalence engine — no resolution logic is re-declared here.
 */
import { cfnDifferences, isCfnEquivalent, assertNoStranglerDrift, resourceShapes } from '@apiable/umbrella'

type CfnResource = { Type: string; Properties?: unknown; [k: string]: unknown }
type Tmpl = { Resources?: Record<string, CfnResource> }
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const NODE_COUNT = (t: Tmpl): number => Object.keys(t.Resources ?? {}).length

const refChain = (depth: number): Tmpl => {
  const resources: Record<string, CfnResource> = { Leaf: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'leaf' } } }
  for (let i = 1; i <= depth; i++) {
    resources[`Link${i}`] = { Type: 'AWS::IAM::Role', Properties: { RoleName: `link-${i}`, Below: { Ref: i === 1 ? 'Leaf' : `Link${i - 1}` } } }
  }
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
  it('a chain past the depth-ceiling completes via the graceful floor (no raw RangeError, still proportional)', () => {
    // 12_000 > RESOLUTION_DEPTH_CEILING (10_000): the deepest references degrade to a stable
    // depth-capped anchor rather than recursing until V8 throws; the run still completes promptly.
    const baseline = refChain(12_000)
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
