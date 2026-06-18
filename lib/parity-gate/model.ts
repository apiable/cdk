/**
 * The comparable resource model the release-time parity gate diffs the distribution channels on.
 *
 * Each channel (the CDK construct, the published CloudFormation template, and the hand-rolled
 * Terraform module) is reduced to a {@link ChannelModel}, then compared on three tiers:
 *   (i)   the resource graph — same nodes and edges, keyed by logical reference, never by
 *         account- or region-specific identifiers;
 *   (ii)  the load-bearing scalar settings — equality by value (the access-token customisation
 *         version, the pool feature tier, the OAuth flows/scopes, the authorizer type and the
 *         request location it reads the caller credential from, and the account a role is
 *         configured to trust — who may assume it);
 *   (iii) the permission semantics — an access-grant comparison a resource-count check misses.
 *
 * Severity is encoded structurally by where a reducer routes a setting: a load-bearing scalar
 * lands in {@link ChannelModel.values} and a divergence there fails the gate, while a cosmetic
 * lands in {@link ChannelModel.cosmetics} and only ever warns. Secret references land in
 * {@link ChannelModel.secrets} carrying presence/wiring, never a value.
 */

/** A distribution channel a published infrastructure component ships through. */
export type Channel = 'cdk' | 'cfn' | 'terraform'

/**
 * A resource reduced to a channel-independent identity: a canonical kind plus a discriminator
 * built only from account/region-agnostic attributes, so the same component carries the same
 * ref whether it was synthesized, published as CloudFormation, or planned by Terraform.
 */
export interface ResourceNode {
  readonly ref: string
  readonly kind: string
}

/** A directed connection between two resource nodes, addressed by logical reference. */
export interface ResourceEdge {
  readonly from: string
  readonly to: string
  readonly relation: string
}

export interface ResourceGraph {
  readonly nodes: readonly ResourceNode[]
  readonly edges: readonly ResourceEdge[]
}

/**
 * Load-bearing scalar settings keyed by a stable logical name. An absent key means the channel
 * does not express that setting at all, which is distinct from a present-but-empty value.
 */
export type LoadBearingValues = Readonly<Record<string, string>>

/**
 * One access grant reduced to its permission semantics. `resources` and `principal` are
 * normalised to logical references — account and region tokens replaced — never raw ARNs, so
 * two channels deployed to different accounts still compare equal.
 *
 * Several grants legitimately share one {@link ref} — a trust policy may carry more than one
 * statement, all keyed `grant:assume-role`. The ref is the grouping key; the identity of the
 * grouped grants is the multiset of their full signatures, so a second statement that widens who
 * may assume the role is a divergence, never a dropped duplicate.
 */
export interface PermissionGrant {
  readonly ref: string
  readonly effect: string
  readonly actions: readonly string[]
  readonly resources: readonly string[]
  readonly principal?: string
  /**
   * A statement's `Condition`, canonicalised to a stable string. Load-bearing on a trust
   * statement: two statements that differ only in their condition (one keyed to an external id,
   * one open) are distinct grants the comparison must tell apart.
   */
  readonly condition?: string
  /**
   * The normalised source an invoke grant is scoped to — the single resource permitted to invoke
   * the function (the least-privilege form). Compared by value: a grant scoped to a different
   * source, or left unscoped while another channel pins one, is broader and diverges. Absent when
   * the grant carries no source scope.
   */
  readonly sourceArn?: string
}

/** A secret reference. The value is never captured — only whether it is present and wired through. */
export interface SecretRef {
  readonly ref: string
  readonly wired: boolean
}

/** OIDC discovery / endpoint references an emitted configuration points at, for static conformance. */
export interface OidcDiscovery {
  readonly issuer?: string
  readonly authorizationEndpoint?: string
  readonly tokenEndpoint?: string
  readonly jwksUri?: string
  readonly responseTypesSupported?: readonly string[]
  readonly subjectTypesSupported?: readonly string[]
  readonly idTokenSigningAlgValuesSupported?: readonly string[]
  /** How a bearer token is presented; RFC 6750 requires the `Authorization: Bearer` header form. */
  readonly bearerMethod?: string
}

/** The OAuth2 configuration a channel emits, for static RFC 6749 / 6750 / OIDC 1.0 conformance. */
export interface OAuthConfig {
  readonly flows: readonly string[]
  readonly scopes: readonly string[]
  readonly discovery?: OidcDiscovery
}

/**
 * One channel's artifact reduced to the comparable model the gate diffs. `wellFormed` is the
 * pre-diff gate: an artifact that does not parse or validate fails before any comparison runs.
 */
export interface ChannelModel {
  readonly channel: Channel
  readonly wellFormed: boolean
  readonly graph: ResourceGraph
  readonly values: LoadBearingValues
  readonly grants: readonly PermissionGrant[]
  readonly secrets: readonly SecretRef[]
  readonly oauth?: OAuthConfig
  /**
   * Every OAuth client's emitted configuration, keyed by the client's channel-stable ref, so a
   * channel that declares more than one client runs the conformance check on each — a single
   * {@link oauth} slot would conformance-check only the last client reduced. The value-tier
   * `oauth-flows`/`oauth-scopes` rows are already namespaced per client ref independently.
   */
  readonly oauthByClient?: Readonly<Record<string, OAuthConfig>>
  /** Cosmetic settings — descriptions, runtime patch revisions, log retention — only ever warn. */
  readonly cosmetics: Readonly<Record<string, string>>
}

/** The tier a divergence was found on, for the report. */
export type DivergenceTier = 'wellformed' | 'graph' | 'value' | 'permission' | 'secret' | 'oauth'

/** A single disagreement between channels, naming the divergent piece and the channels at odds. */
export interface Divergence {
  readonly tier: DivergenceTier
  readonly detail: string
  readonly channels: readonly Channel[]
}

/**
 * The gate outcome. `passed` is false on any divergence; cosmetic-only differences surface as
 * `warnings` and never flip `passed`.
 */
export interface GateResult {
  readonly passed: boolean
  readonly divergences: readonly Divergence[]
  readonly warnings: readonly string[]
}

/**
 * The logical placeholders divergence-blind identifiers normalise to. Account ids and regions
 * collapse to these so incidental account/region differences never read as a divergence.
 */
export const ACCOUNT_TOKEN = '{account}'
export const REGION_TOKEN = '{region}'

const ACCOUNT_ID = /(?<!\d)\d{12}(?!\d)/g
const AWS_REGION = /[a-z]{2}-[a-z]+-\d(?![\w-])/g

/**
 * Replace account ids and AWS regions in a value with logical tokens, so the comparison key is
 * the logical reference. An explicit `region` is replaced first to catch regions that are not in
 * the generic `xx-yyyy-n` shape (none today, but the channel supplies the deployed region).
 */
export const normaliseLogical = (value: string, region?: string): string => {
  const withRegion = region ? value.split(region).join(REGION_TOKEN) : value
  return withRegion.replace(AWS_REGION, REGION_TOKEN).replace(ACCOUNT_ID, ACCOUNT_TOKEN)
}

/**
 * The 12-digit AWS account ids in a value, by value — the same definition {@link normaliseLogical}
 * blanks, but preserved rather than tokenised. The account a role is configured to trust is read
 * this way: who may assume the role is load-bearing and compared by value (tier ii), distinct from
 * the incidental account a resource is deployed into, which normalises to {@link ACCOUNT_TOKEN}.
 */
export const accountIdsIn = (value: string): readonly string[] => value.match(ACCOUNT_ID) ?? []

/**
 * Qualify each load-bearing value key with its resource's logical ref, so two resources of the
 * same kind do not collapse onto one global key and clobber each other last-write-wins. The ref is
 * channel-stable (built from account/region-agnostic attributes), so the same resource carries the
 * same qualified key in every channel and the value comparison stays per resource.
 */
export const namespaceByRef = (values: LoadBearingValues, ref: string): LoadBearingValues =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [`${key}:${ref}`, value]))

const POOL_KIND_PREFIX = 'cognito-user-pool:'

/** The pool's channel-stable discriminator from its node ref (`cognito-user-pool:authz` → `authz`). */
export const poolNameFromRef = (poolRef: string): string =>
  poolRef.startsWith(POOL_KIND_PREFIX) ? poolRef.slice(POOL_KIND_PREFIX.length) : poolRef

/**
 * The OIDC discovery document for a Cognito user pool, single-sourced so both channel reducers derive
 * an identical document for an equivalent pool (a divergence in the derivation, not the artifact, would
 * false-fail or false-pass parity). The issuer is the Cognito IdP endpoint keyed by the channel-stable
 * pool name; the JWKS is the issuer's well-known path; the authorize/token endpoints come from the
 * hosted-UI domain prefix when one is published. Returning it for a real client makes the gate's
 * discovery conformance run against the channel's own configuration rather than only a synthetic fixture.
 */
export const cognitoDiscovery = (poolName: string, region: string | undefined, domainPrefix: string | undefined): OidcDiscovery => {
  const regionToken = region ?? REGION_TOKEN
  const issuer = `https://cognito-idp.${regionToken}.amazonaws.com/${poolName}`
  const base = { issuer, jwksUri: `${issuer}/.well-known/jwks.json`, bearerMethod: 'header' as const }
  if (domainPrefix === undefined) return base
  const hosted = `https://${domainPrefix}.auth.${regionToken}.amazoncognito.com`
  return { ...base, authorizationEndpoint: `${hosted}/oauth2/authorize`, tokenEndpoint: `${hosted}/oauth2/token` }
}
