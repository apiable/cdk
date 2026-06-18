/**
 * The release-time parity gate. Reduces are done by the channel reducers; this orchestrates the
 * comparison: it first rejects any artifact that is not well-formed (before any diff), then runs
 * the three tiers, the secret-wiring check, and the OAuth2/OIDC conformance check across the
 * channels, collecting cosmetic differences as warnings. The gate passes only when no tier
 * diverges; a divergence fails the release with a report naming the divergent piece and the
 * disagreeing channel(s).
 */
import { ChannelModel, Divergence, GateResult, OAuthConfig } from './model'
import {
  compareGrants,
  compareGraph,
  compareSecrets,
  compareValues,
  cosmeticWarnings,
} from './compare'
import { checkOAuthConformance } from './oauth-conformance'

/**
 * Every OAuth configuration a channel emits, for the conformance check. A channel reduced from a
 * real artifact carries one config per client in {@link ChannelModel.oauthByClient}, so each client
 * is checked; a hand-built model that sets only the single {@link ChannelModel.oauth} slot is honoured
 * too. Both populated means the per-client map is authoritative (the single slot is its last entry).
 */
const oauthConfigsOf = (model: ChannelModel): readonly OAuthConfig[] => {
  const byClient = model.oauthByClient !== undefined ? Object.values(model.oauthByClient) : []
  if (byClient.length > 0) return byClient
  return model.oauth === undefined ? [] : [model.oauth]
}

const oauthDivergences = (models: readonly ChannelModel[]): Divergence[] =>
  models.flatMap((model) =>
    oauthConfigsOf(model).flatMap((oauth) =>
      checkOAuthConformance(oauth).map((issue) => ({
        tier: 'oauth' as const,
        detail: `${issue.rule}: ${issue.detail}`,
        channels: [model.channel],
      })),
    ),
  )

/** Every distribution channel the parity gate must compare; a set missing any of them is incomplete. */
const REQUIRED_CHANNELS: readonly ChannelModel['channel'][] = ['cdk', 'cfn', 'terraform']

/** Run the parity gate across the reduced channel models. */
export const gate = (models: readonly ChannelModel[]): GateResult => {
  const malformed = models.filter((model) => !model.wellFormed)
  if (malformed.length > 0) {
    // An artifact that does not parse or validate fails before any comparison runs.
    return {
      passed: false,
      divergences: malformed.map((model) => ({
        tier: 'wellformed',
        detail: `the ${model.channel} artifact is not well-formed`,
        channels: [model.channel],
      })),
      warnings: [],
    }
  }

  // An incomplete channel set cannot pass vacuously: with a channel absent there is nothing to
  // diverge from, so a single-channel (or empty) run would otherwise report agreement it never proved.
  const present = new Set(models.map((model) => model.channel))
  const missing = REQUIRED_CHANNELS.filter((channel) => !present.has(channel))
  if (missing.length > 0) {
    return {
      passed: false,
      divergences: missing.map((channel) => ({
        tier: 'wellformed',
        detail: `the ${channel} channel is absent — the parity set is incomplete`,
        channels: [channel],
      })),
      warnings: [],
    }
  }

  const divergences: Divergence[] = [
    ...compareGraph(models),
    ...compareValues(models),
    ...compareGrants(models),
    ...compareSecrets(models),
    ...oauthDivergences(models),
  ]

  return { passed: divergences.length === 0, divergences, warnings: cosmeticWarnings(models) }
}

/** Render a gate result as a release report — the divergences, then any cosmetic warnings. */
export const formatGateReport = (result: GateResult): string => {
  const lines: string[] = []
  if (result.passed) {
    lines.push('PARITY OK — all channels agree on graph, load-bearing values, permissions, and OAuth conformance.')
  } else {
    lines.push(`PARITY FAILED — ${result.divergences.length} divergence(s):`)
    for (const divergence of result.divergences) {
      lines.push(`  [${divergence.tier}] ${divergence.detail} — disagreeing: ${divergence.channels.join(', ')}`)
    }
  }
  for (const warning of result.warnings) lines.push(`  warning: ${warning}`)
  return lines.join('\n')
}
