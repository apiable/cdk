/**
 * Logical-identifier-normalised CloudFormation equivalence for the umbrella strangler refactor.
 *
 * The refactor deliberately re-parents resources under kit constructs, which renames their CFN
 * logical ids while their real (physical) names are held constant. So "no observable change" is
 * proven by resource property + published-export equivalence with logical-id renames tolerated — a
 * raw whole-template comparison is the wrong oracle because it false-fails on the rename.
 */

type CfnTemplate = {
  Resources?: Record<string, { Type: string; Properties?: unknown; [k: string]: unknown }>
  Outputs?: Record<string, { Value?: unknown; Export?: { Name?: unknown }; [k: string]: unknown }>
  Parameters?: Record<string, unknown>
}

/** A resource compared by what a customer can observe: its type and its resolved properties. */
export interface ResourceShape {
  readonly type: string
  readonly properties: unknown
}

/** A published cross-stack value other stacks import: its export name and its value. */
export interface PublishedExport {
  readonly name: string
  readonly value: unknown
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
 * Rewrite every cross-resource logical-id reference (`{Ref}`, `{Fn::GetAtt}`, `DependsOn`) and the
 * CDK default-policy `PolicyName` (which echoes the role's logical id) to a single placeholder, so a
 * pure logical-id rename of a referenced resource does not register as a property difference. The
 * referent's own identity is still compared via its type + (placeholder-normalised) properties.
 */
const normaliseLogicalRefs = (value: unknown, logicalIds: Set<string>): unknown => {
  const PLACEHOLDER = '__logical-ref__'
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>
      const keys = Object.keys(obj)
      if (keys.length === 1 && obj.Ref !== undefined && typeof obj.Ref === 'string' && logicalIds.has(obj.Ref)) {
        return { Ref: PLACEHOLDER }
      }
      if (keys.length === 1 && Array.isArray(obj['Fn::GetAtt'])) {
        const [target, ...rest] = obj['Fn::GetAtt'] as unknown[]
        if (typeof target === 'string' && logicalIds.has(target)) {
          return { 'Fn::GetAtt': [PLACEHOLDER, ...rest.map(walk)] }
        }
      }
      const out: Record<string, unknown> = {}
      for (const k of keys) {
        if (k === 'PolicyName' && typeof obj[k] === 'string' && logicalIds.has(obj[k] as string)) {
          out[k] = PLACEHOLDER
        } else if (k === 'DependsOn') {
          const dep = obj[k]
          out[k] = (Array.isArray(dep) ? dep : [dep]).map((d) => (typeof d === 'string' && logicalIds.has(d) ? PLACEHOLDER : d))
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

/**
 * The multiset of resource shapes, keyed by type + logical-id-normalised properties so that a rename
 * of a resource's logical id (and of any reference to it) does not register as a change.
 */
export const resourceShapes = (template: CfnTemplate): Map<string, number> => {
  const logicalIds = new Set(Object.keys(template.Resources ?? {}))
  const counts = new Map<string, number>()
  for (const resource of Object.values(template.Resources ?? {})) {
    const properties = normaliseLogicalRefs(resource.Properties ?? null, logicalIds)
    const key = canonical({ type: resource.Type, properties })
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/** Published exports keyed by export name — the contract dependent stacks import via `Fn::ImportValue`. */
export const publishedExports = (template: CfnTemplate): Map<string, string> => {
  const logicalIds = new Set(Object.keys(template.Resources ?? {}))
  const exports = new Map<string, string>()
  for (const output of Object.values(template.Outputs ?? {})) {
    const exportName = output.Export?.Name
    if (typeof exportName === 'string') {
      exports.set(exportName, canonical(normaliseLogicalRefs(output.Value, logicalIds)))
    }
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
