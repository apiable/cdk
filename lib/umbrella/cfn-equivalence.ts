/**
 * Logical-identifier-normalised CloudFormation equivalence for the umbrella strangler refactor.
 *
 * The refactor deliberately re-parents resources under kit constructs, which renames their CFN
 * logical ids while their real (physical) names are held constant. So "no observable change" is
 * proven by resource property + published-export equivalence with logical-id renames tolerated — a
 * raw whole-template comparison is the wrong oracle because it false-fails on the rename.
 *
 * A cross-resource reference is normalised by *what it points at* — the target resource's shape, not
 * its renameable logical id — so a consistent rename is tolerated while a reference re-pointed at a
 * different resource (a policy re-attached to another role, a stream re-wired to another bucket) reads
 * as drift. By-value identity (a trusted account, an ARN, a principal) is compared as the literal it
 * is, so an IAM trust/principal re-target is a property change the whole-shape comparison reports.
 */

type CfnResource = { Type: string; Properties?: unknown; [k: string]: unknown }

type CfnOutput = { Value?: unknown; Export?: { Name?: unknown }; Condition?: unknown; [k: string]: unknown }

type CfnTemplate = {
  Resources?: Record<string, CfnResource>
  Outputs?: Record<string, CfnOutput>
  Parameters?: Record<string, unknown>
}

/** A resource compared by what a customer can observe: its type and its resolved properties. */
export interface ResourceShape {
  readonly type: string
  readonly properties: unknown
}

/**
 * A published cross-stack value other stacks import: its export name, its value, and the Output-level
 * `Condition` that gates whether the export exists at all in a given environment.
 */
export interface PublishedExport {
  readonly name: unknown
  readonly value: unknown
  readonly condition?: unknown
}

/** One observable difference between a baseline template and a candidate template. */
export interface CfnDifference {
  readonly kind: 'resource-removed' | 'resource-added' | 'export-changed' | 'export-removed' | 'export-added'
  readonly detail: string
}

/** Deterministic serialization with recursively-sorted object keys, so key order never registers. */
const canonical = (value: unknown): string => {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort)
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      )
    }
    return v
  }
  return JSON.stringify(sort(value))
}

/**
 * The load-bearing top-level resource attributes that carry observable behaviour (siblings of `Type`
 * and `Properties`) — a `DependsOn` re-target, a flip of `DeletionPolicy`/`UpdateReplacePolicy` on a
 * stateful resource, or a changed `Condition`/`CreationPolicy`/`UpdatePolicy` all change what the stack
 * does, so they enter the comparison shape. `DependsOn` is reference-normalised by its target's shape;
 * the rest are compared by value. `Metadata` is cosmetic (its `aws:cdk:path` changes on every rename)
 * and is excluded so the rename tolerance holds.
 */
const TOP_LEVEL_SHAPE_ATTRIBUTES = [
  'DependsOn',
  'Condition',
  'DeletionPolicy',
  'UpdateReplacePolicy',
  'CreationPolicy',
  'UpdatePolicy',
] as const

/**
 * Resolves a logical-id reference to a token that encodes *what the reference points at* — the target
 * resource's shape (its type + recursively reference-normalised properties AND its load-bearing
 * top-level attributes), never its renameable logical-id identity. Two references to differently-shaped
 * targets get different tokens, so a re-target (a policy re-attached to another role, a stream re-wired
 * to another bucket, a reference re-pointed from a durable resource to a disposable near-twin) changes
 * the referrer's canonical shape and registers as drift; a consistent logical-id rename leaves the
 * target's shape unchanged, so the token is stable and the rename is tolerated.
 */
const targetTokenResolver = (resources: Record<string, CfnResource>) => {
  const logicalIds = new Set(Object.keys(resources))
  const cache = new Map<string, string>()

  // `resolving` breaks reference cycles (a target whose own properties reference back to the referrer):
  // a target already on the resolution stack anchors on its type alone, which terminates while keeping
  // the cycle's shape distinct from an acyclic target of the same type. Only the full token computed
  // with an empty stack is cached — a token computed inside a cycle is truncated to its referrer's
  // context, so caching it would leak that context's `ref-cycle` truncation into an unrelated resolve.
  const shapeToken = (id: string, resolving: Set<string>): string => {
    if (resolving.size === 0) {
      const cached = cache.get(id)
      if (cached !== undefined) return cached
    }
    const target = resources[id]
    if (!target) return 'ref→<unknown>'
    if (resolving.has(id)) return `ref-cycle→${target.Type}`
    const token = `ref→${canonical(shapeOf(target, new Set(resolving).add(id)))}`
    if (resolving.size === 0) cache.set(id, token)
    return token
  }

  // The single source of truth for a resource's comparison shape — its type, its reference-normalised
  // properties, and each present load-bearing top-level attribute (`DependsOn` reference-normalised by
  // target shape; the rest by value; `Metadata` excluded). BOTH the referent token (`shapeToken`, with
  // the cycle-extended stack) and the owner shape (`resourceShapes`, with a fresh stack) build through
  // this, so the two paths can never drift apart: a reference re-pointed between two resources that
  // differ only in a top-level attribute now changes the referent token, just as it changes the owner.
  const shapeOf = (resource: CfnResource, resolving: Set<string>): Record<string, unknown> => {
    const shape: Record<string, unknown> = {
      type: resource.Type,
      properties: normalise(resource.Properties ?? null, resolving),
    }
    for (const attr of TOP_LEVEL_SHAPE_ATTRIBUTES) {
      if (resource[attr] === undefined) continue
      shape[attr] = attr === 'DependsOn' ? normaliseDependsOn(resource[attr], resolving) : resource[attr]
    }
    return shape
  }

  // A `DependsOn` is a logical id or a list of them; each id-reference rewrites to its target-shape
  // token (a non-id entry normalises as ordinary data). Shared by the `normalise` walk (a `DependsOn`
  // nested inside a walked object) and `shapeOf` (the top-level `DependsOn`, the only valid CFN
  // placement), so the dependency-declaration reference form normalises identically in both paths.
  const normaliseDependsOn = (dep: unknown, resolving: Set<string>): unknown =>
    (Array.isArray(dep) ? dep : [dep]).map((d) =>
      typeof d === 'string' && logicalIds.has(d) ? shapeToken(d, resolving) : normalise(d, resolving),
    )

  /**
   * Rewrites every cross-resource logical-id reference to its target-shape token, across every form a
   * CloudFormation template can express one: `{Ref}`, array- and string-form `{Fn::GetAtt}`,
   * `Fn::Sub`-embedded `${LogicalId}` and `${LogicalId.Attr}`, `DependsOn`, and the CDK default-policy
   * `PolicyName` echo.
   */
  const normalise = (value: unknown, resolving: Set<string>): unknown => {
    const walk = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(walk)
      if (v && typeof v === 'object') {
        const obj = v as Record<string, unknown>
        const keys = Object.keys(obj)
        if (keys.length === 1 && typeof obj.Ref === 'string' && logicalIds.has(obj.Ref)) {
          return { Ref: shapeToken(obj.Ref, resolving) }
        }
        if (keys.length === 1 && obj['Fn::GetAtt'] !== undefined) {
          const getAtt = obj['Fn::GetAtt']
          if (Array.isArray(getAtt)) {
            const [target, ...rest] = getAtt as unknown[]
            if (typeof target === 'string' && logicalIds.has(target)) {
              return { 'Fn::GetAtt': [shapeToken(target, resolving), ...rest.map(walk)] }
            }
          } else if (typeof getAtt === 'string') {
            const dot = getAtt.indexOf('.')
            const target = dot >= 0 ? getAtt.slice(0, dot) : getAtt
            if (dot >= 0 && logicalIds.has(target)) {
              return { 'Fn::GetAtt': `${shapeToken(target, resolving)}${getAtt.slice(dot)}` }
            }
          }
        }
        if (keys.length === 1 && obj['Fn::Sub'] !== undefined) {
          return { 'Fn::Sub': normaliseSub(obj['Fn::Sub'], resolving) }
        }
        const out: Record<string, unknown> = {}
        for (const k of keys) {
          if (k === 'PolicyName' && typeof obj[k] === 'string' && logicalIds.has(obj[k] as string)) {
            out[k] = shapeToken(obj[k] as string, resolving)
          } else if (k === 'DependsOn') {
            out[k] = normaliseDependsOn(obj[k], resolving)
          } else {
            out[k] = walk(obj[k])
          }
        }
        return out
      }
      return v
    }
    return walk(value)
  }

  // `Fn::Sub` is either a string or `[template, { var: value }]`. An embedded `${LogicalId}` OR
  // `${LogicalId.Attr}` reference rewrites to the target-shape token (the head before the first `.` is
  // the logical id, the suffix the attribute, mirroring string-form `Fn::GetAtt`), so a consistent
  // rename of the target is tolerated while a re-target reads as drift. A `${!Literal}` escape (head
  // `!Literal`, never a logical id) and a non-resource `${Param}` are left untouched.
  const normaliseSub = (sub: unknown, resolving: Set<string>): unknown => {
    const rewriteString = (s: string): string =>
      s.replace(/\$\{([^}]+)\}/g, (match, inner: string) => {
        const trimmed = inner.trim()
        const dot = trimmed.indexOf('.')
        const head = dot >= 0 ? trimmed.slice(0, dot) : trimmed
        return logicalIds.has(head) ? `\${${shapeToken(head, resolving)}${dot >= 0 ? trimmed.slice(dot) : ''}}` : match
      })
    if (typeof sub === 'string') return rewriteString(sub)
    if (Array.isArray(sub)) {
      const [template, vars, ...rest] = sub as unknown[]
      const head = typeof template === 'string' ? rewriteString(template) : normalise(template, resolving)
      return [head, normalise(vars, resolving), ...rest.map((r) => normalise(r, resolving))]
    }
    return normalise(sub, resolving)
  }

  return {
    // The public reference-normaliser (fresh resolution stack) — rewrites every cross-resource
    // reference in an arbitrary value to its target-shape token. Used for export values.
    normalise: (value: unknown): unknown => normalise(value, new Set<string>()),
    // A resource's full comparison shape (fresh resolution stack), so the multiset key and the
    // referent token are built by one helper and cannot diverge.
    shapeOf: (resource: CfnResource): Record<string, unknown> => shapeOf(resource, new Set<string>()),
  }
}

/**
 * The multiset of resource shapes, keyed by type + reference-normalised properties + load-bearing
 * top-level attributes, so that a rename of a resource's logical id (and of any reference to it) does
 * not register as a change, while a reference re-pointed at a different resource does (its target-shape
 * token changes). The shape is built by the resolver's `shapeOf` — the same helper the referent token
 * uses — so a re-target between two resources differing only in a top-level attribute is caught
 * symmetrically whether the resource is compared as an owner or reached through a reference.
 */
export const resourceShapes = (template: CfnTemplate): Map<string, number> => {
  const resources = template.Resources ?? {}
  const resolver = targetTokenResolver(resources)
  const counts = new Map<string, number>()
  for (const resource of Object.values(resources)) {
    const key = canonical(resolver.shapeOf(resource))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/**
 * Published exports keyed by export name — the contract dependent stacks import via `Fn::ImportValue`.
 * The key is the export name (a string name as-is; an intrinsic name — `Fn::Sub`/`Fn::Join` — canonicalised
 * through the resolver so its embedded references normalise and a logical-id rename is tolerated, rather
 * than the export being skipped). The value carries both the normalised `Value` and the Output-level
 * `Condition` (by value), so an export that gains or changes a `Condition` — which can make it silently
 * disappear in some environments and break a dependent stack's `Fn::ImportValue` — registers as drift.
 */
export const publishedExports = (template: CfnTemplate): Map<string, string> => {
  const resolver = targetTokenResolver(template.Resources ?? {})
  const exports = new Map<string, string>()
  for (const output of Object.values(template.Outputs ?? {})) {
    const exportName = output.Export?.Name
    if (exportName === undefined) continue
    const key = typeof exportName === 'string' ? exportName : canonical(resolver.normalise(exportName))
    exports.set(key, canonical({ value: resolver.normalise(output.Value), condition: output.Condition }))
  }
  return exports
}

/**
 * Observable differences between a baseline and a candidate template: resources whose type+properties
 * are not matched in both directions, and published exports that are renamed, dropped, or re-valued.
 * Logical-id-only renames produce no difference. An empty result means equivalent.
 */
export const cfnDifferences = (baseline: CfnTemplate, candidate: CfnTemplate): CfnDifference[] => {
  const differences: CfnDifference[] = []

  const baseResources = resourceShapes(baseline)
  const candResources = resourceShapes(candidate)
  for (const [key, count] of baseResources) {
    const candCount = candResources.get(key) ?? 0
    if (candCount < count) {
      const { type } = JSON.parse(key) as { type: string }
      differences.push({ kind: 'resource-removed', detail: `${type} (×${count - candCount})` })
    }
  }
  for (const [key, count] of candResources) {
    const baseCount = baseResources.get(key) ?? 0
    if (baseCount < count) {
      const { type } = JSON.parse(key) as { type: string }
      differences.push({ kind: 'resource-added', detail: `${type} (×${count - baseCount})` })
    }
  }

  const baseExports = publishedExports(baseline)
  const candExports = publishedExports(candidate)
  for (const [name, value] of baseExports) {
    if (!candExports.has(name)) differences.push({ kind: 'export-removed', detail: name })
    else if (candExports.get(name) !== value) differences.push({ kind: 'export-changed', detail: name })
  }
  for (const name of candExports.keys()) {
    if (!baseExports.has(name)) differences.push({ kind: 'export-added', detail: name })
  }

  return differences
}

/** True when the candidate is observably equivalent to the baseline (logical-id renames tolerated). */
export const isCfnEquivalent = (baseline: CfnTemplate, candidate: CfnTemplate): boolean =>
  cfnDifferences(baseline, candidate).length === 0

/**
 * Strangler-progression gate: a step that would observably change an existing stack does not ship.
 * Returns the candidate template unchanged when equivalent; throws with the differences otherwise.
 * The validation *methodology* (which sample stack, which tool) is Phase-A-owned; this is the gating
 * behaviour the methodology plugs into.
 */
export const assertNoStranglerDrift = <T extends CfnTemplate>(baseline: CfnTemplate, candidate: T): T => {
  const differences = cfnDifferences(baseline, candidate)
  if (differences.length > 0) {
    const summary = differences.map((d) => `${d.kind}: ${d.detail}`).join('; ')
    throw new Error(`strangler step blocked — it would drift an existing stack: ${summary}`)
  }
  return candidate
}
