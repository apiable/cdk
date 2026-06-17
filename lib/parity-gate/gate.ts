/**
 * The release-time parity gate. Reduces are done by the channel reducers; this orchestrates the
 * comparison: it first rejects any artifact that is not well-formed (before any diff), then runs
 * the three tiers, the secret-wiring check, and the OAuth2/OIDC conformance check across the
 * channels, collecting cosmetic differences as warnings. The gate passes only when no tier
 * diverges; a divergence fails the release with a report naming the divergent piece and the
 * disagreeing channel(s).
 */
import { ChannelModel, Divergence, GateResult } from './model'
import {
  compareGrants,
  compareGraph,
  compareSecrets,
  compareValues,
  cosmeticWarnings,
} from './compare'
import { checkOAuthConformance } from './oauth-conformance'

const oauthDivergences = (models: readonly ChannelModel[]): Divergence[] =>
  models.flatMap((model) =>
    model.oauth === undefined
      ? []
      : checkOAuthConformance(model.oauth).map((issue) => ({
          tier: 'oauth' as const,
          detail: `${issue.rule}: ${issue.detail}`,
          channels: [model.channel],
        })),
  )

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
