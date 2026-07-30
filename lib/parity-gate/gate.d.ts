/**
 * The release-time parity gate. Reduces are done by the channel reducers; this orchestrates the
 * comparison: it first rejects any artifact that is not well-formed (before any diff), then runs
 * the three tiers, the secret-wiring check, and the OAuth2/OIDC conformance check across the
 * channels, collecting cosmetic differences as warnings. The gate passes only when no tier
 * diverges; a divergence fails the release with a report naming the divergent piece and the
 * disagreeing channel(s).
 */
import { ChannelModel, GateResult } from './model';
/** Run the parity gate across the reduced channel models. */
export declare const gate: (models: readonly ChannelModel[]) => GateResult;
/** Render a gate result as a release report — the divergences, then any cosmetic warnings. */
export declare const formatGateReport: (result: GateResult) => string;
