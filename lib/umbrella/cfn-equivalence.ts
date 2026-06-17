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

const stable = (value: unknown): string => JSON.stringify(value, Object.keys(value as object ?? {}).sort())

/** The multiset of resource shapes, keyed by type+properties so logical-id renames do not register. */
export const resourceShapes = (template: CfnTemplate): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const resource of Object.values(template.Resources ?? {})) {
    const key = JSON.stringify({ type: resource.Type, properties: resource.Properties ?? null })
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/** Published exports keyed by export name — the contract dependent stacks import via `Fn::ImportValue`. */
export const publishedExports = (template: CfnTemplate): Map<string, string> => {
  const exports = new Map<string, string>()
  for (const output of Object.values(template.Outputs ?? {})) {
    const exportName = output.Export?.Name
    if (typeof exportName === 'string') {
      exports.set(exportName, stable(output.Value))
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
