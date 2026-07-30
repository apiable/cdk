/**
 * The three comparison tiers plus the secret and cosmetic handling. Each comparator takes the
 * reduced channel models and reports divergences naming the divergent piece and the channels at
 * odds. The tiers are independent: a graph difference, a load-bearing-value difference, and a
 * permission-semantics difference are each detected on their own terms.
 */
import { ChannelModel, Divergence } from './model';
/** Tier (i): the resource graph — same node set and same edges, keyed by logical reference. */
export declare const compareGraph: (models: readonly ChannelModel[]) => Divergence[];
/** Tier (ii): the load-bearing scalar settings — equality by value, never mere presence. */
export declare const compareValues: (models: readonly ChannelModel[]) => Divergence[];
/**
 * Tier (iii): the permission semantics — actions, resources, principal, condition, and source
 * scope. Several grants legitimately share one ref (a trust policy with more than one statement),
 * so a channel's signature for a ref is the sorted multiset of every grant on it, never the first.
 * A second statement that widens who may assume a role shares the ref but enlarges the multiset,
 * so it diverges instead of being silently dropped.
 */
export declare const compareGrants: (models: readonly ChannelModel[]) => Divergence[];
/**
 * Secrets are compared for presence and wiring only — the value is never in the model, so a
 * value difference cannot fail the gate. A secret some channels wire but another does not fails.
 */
export declare const compareSecrets: (models: readonly ChannelModel[]) => Divergence[];
/** Cosmetic differences (descriptions, runtime patch revisions, log retention) — warnings only. */
export declare const cosmeticWarnings: (models: readonly ChannelModel[]) => string[];
