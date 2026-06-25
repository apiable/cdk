/**
 * The three comparison tiers plus the secret and cosmetic handling. Each comparator takes the
 * reduced channel models and reports divergences naming the divergent piece and the channels at
 * odds. The tiers are independent: a graph difference, a load-bearing-value difference, and a
 * permission-semantics difference are each detected on their own terms.
 */
import { Channel, ChannelModel, Divergence } from './model'

/** Each channel's signature for one keyed item; an absent channel maps to the sentinel. */
type SignatureByChannel = Map<Channel, string>
const ABSENT = '∅'

/**
 * The channels whose signature differs from the modal (most common) one. Ties break towards the
 * earliest channel in the supplied order, so the result is deterministic. An empty result means
 * every channel agrees.
 */
const divergentChannels = (signatures: SignatureByChannel, channels: readonly Channel[]): Channel[] => {
  const present = channels.map((channel) => [channel, signatures.get(channel) ?? ABSENT] as const)
  const counts = new Map<string, number>()
  for (const [, signature] of present) counts.set(signature, (counts.get(signature) ?? 0) + 1)
  if (counts.size <= 1) return []
  let modal = present[0][1]
  let best = -1
  for (const [, signature] of present) {
    const count = counts.get(signature) ?? 0
    if (count > best) {
      best = count
      modal = signature
    }
  }
  return present.filter(([, signature]) => signature !== modal).map(([channel]) => channel)
}

const summarise = (label: string, valueByChannel: Map<Channel, string>, channels: readonly Channel[]): string => {
  const parts = channels.map((channel) => `${channel}=${valueByChannel.get(channel) ?? ABSENT}`)
  return `${label} (${parts.join(', ')})`
}

const channelsOf = (models: readonly ChannelModel[]): Channel[] => models.map((model) => model.channel)

/** Tier (i): the resource graph — same node set and same edges, keyed by logical reference. */
export const compareGraph = (models: readonly ChannelModel[]): Divergence[] => {
  const channels = channelsOf(models)
  const divergences: Divergence[] = []

  const nodeRefs = new Set(models.flatMap((model) => model.graph.nodes.map((node) => node.ref)))
  for (const ref of [...nodeRefs].sort()) {
    const presence: SignatureByChannel = new Map(
      models.map((model) => [model.channel, model.graph.nodes.some((node) => node.ref === ref) ? 'present' : ABSENT]),
    )
    const diverging = divergentChannels(presence, channels)
    if (diverging.length > 0) {
      divergences.push({ tier: 'graph', detail: summarise(`resource ${ref}`, presence, channels), channels: diverging })
    }
  }

  const edgeKey = (edge: { from: string; relation: string; to: string }): string => `${edge.from} -[${edge.relation}]-> ${edge.to}`
  const edgeKeys = new Set(models.flatMap((model) => model.graph.edges.map(edgeKey)))
  for (const key of [...edgeKeys].sort()) {
    const presence: SignatureByChannel = new Map(
      models.map((model) => [model.channel, model.graph.edges.map(edgeKey).includes(key) ? 'present' : ABSENT]),
    )
    const diverging = divergentChannels(presence, channels)
    if (diverging.length > 0) {
      divergences.push({ tier: 'graph', detail: summarise(`connection ${key}`, presence, channels), channels: diverging })
    }
  }
  return divergences
}

/** Tier (ii): the load-bearing scalar settings — equality by value, never mere presence. */
export const compareValues = (models: readonly ChannelModel[]): Divergence[] => {
  const channels = channelsOf(models)
  const keys = new Set(models.flatMap((model) => Object.keys(model.values)))
  const divergences: Divergence[] = []
  for (const key of [...keys].sort()) {
    const valueByChannel: SignatureByChannel = new Map(
      models.flatMap((model) => (key in model.values ? [[model.channel, model.values[key]] as const] : [])),
    )
    const diverging = divergentChannels(valueByChannel, channels)
    if (diverging.length > 0) {
      divergences.push({ tier: 'value', detail: summarise(`setting ${key}`, valueByChannel, channels), channels: diverging })
    }
  }
  return divergences
}

/**
 * One grant statement canonicalised to a stable string. Two statements with the same effect,
 * resources, principal, condition, and source scope but actions in a different order sign alike;
 * a difference in any of those — including a widened principal or a different invoke source —
 * signs differently.
 */
const grantSignature = (grant: ChannelModel['grants'][number]): string =>
  JSON.stringify({
    effect: grant.effect,
    actions: [...grant.actions].sort(),
    resources: [...grant.resources].sort(),
    principal: grant.principal ?? null,
    condition: grant.condition ?? null,
    sourceArn: grant.sourceArn ?? null,
  })

/**
 * Tier (iii): the permission semantics — actions, resources, principal, condition, and source
 * scope. Several grants legitimately share one ref (a trust policy with more than one statement),
 * so a channel's signature for a ref is the sorted multiset of every grant on it, never the first.
 * A second statement that widens who may assume a role shares the ref but enlarges the multiset,
 * so it diverges instead of being silently dropped.
 */
export const compareGrants = (models: readonly ChannelModel[]): Divergence[] => {
  const channels = channelsOf(models)
  const refs = new Set(models.flatMap((model) => model.grants.map((grant) => grant.ref)))
  const divergences: Divergence[] = []
  for (const ref of [...refs].sort()) {
    const signatureByChannel: SignatureByChannel = new Map()
    for (const model of models) {
      const grants = model.grants.filter((candidate) => candidate.ref === ref)
      if (grants.length === 0) continue
      signatureByChannel.set(model.channel, JSON.stringify(grants.map(grantSignature).sort()))
    }
    const diverging = divergentChannels(signatureByChannel, channels)
    if (diverging.length > 0) {
      divergences.push({ tier: 'permission', detail: summarise(`grant ${ref}`, signatureByChannel, channels), channels: diverging })
    }
  }
  return divergences
}

/**
 * Secrets are compared for presence and wiring only — the value is never in the model, so a
 * value difference cannot fail the gate. A secret some channels wire but another does not fails.
 */
export const compareSecrets = (models: readonly ChannelModel[]): Divergence[] => {
  const channels = channelsOf(models)
  const refs = new Set(models.flatMap((model) => model.secrets.map((secret) => secret.ref)))
  const divergences: Divergence[] = []
  for (const ref of [...refs].sort()) {
    const wiringByChannel: SignatureByChannel = new Map(
      models.map((model) => {
        const secret = model.secrets.find((candidate) => candidate.ref === ref)
        return [model.channel, secret === undefined ? ABSENT : secret.wired ? 'wired' : 'unwired']
      }),
    )
    const diverging = divergentChannels(wiringByChannel, channels)
    if (diverging.length > 0) {
      divergences.push({ tier: 'secret', detail: summarise(`secret ${ref} wiring`, wiringByChannel, channels), channels: diverging })
    }
  }
  return divergences
}

/** Cosmetic differences (descriptions, runtime patch revisions, log retention) — warnings only. */
export const cosmeticWarnings = (models: readonly ChannelModel[]): string[] => {
  const channels = channelsOf(models)
  const keys = new Set(models.flatMap((model) => Object.keys(model.cosmetics)))
  const warnings: string[] = []
  for (const key of [...keys].sort()) {
    const valueByChannel: SignatureByChannel = new Map(
      models.flatMap((model) => (key in model.cosmetics ? [[model.channel, model.cosmetics[key]] as const] : [])),
    )
    if (divergentChannels(valueByChannel, channels).length > 0) {
      warnings.push(summarise(`cosmetic ${key} differs`, valueByChannel, channels))
    }
  }
  return warnings
}
