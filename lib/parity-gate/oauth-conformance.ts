/**
 * Static OAuth2 / OIDC conformance check on the configuration a channel emits. This is a
 * structural check on the declared configuration — no network call — so it runs identically
 * across all three channels: the same emitted flows, scopes, and (when present) discovery
 * document are checked against RFC 6749 (OAuth2), RFC 6750 (Bearer token usage), and the
 * OpenID Connect 1.0 discovery shape.
 */
import { OAuthConfig, OidcDiscovery } from './model'

/** The grant types registered by RFC 6749; an emitted flow outside this set is non-conformant. */
const RFC6749_GRANT_FLOWS: ReadonlySet<string> = new Set([
  'authorization_code',
  'implicit',
  'client_credentials',
  'password',
  'refresh_token',
])

/**
 * Cognito's `AllowedOAuthFlows` vocabulary mapped to the RFC 6749 grant-type names: `code` is the
 * authorization-code grant and `implicit` the implicit grant. The value tier compares the raw
 * emitted spelling (both channels emit `code`, so they still match by value); this mapping runs only
 * at the conformance boundary so a real Cognito authorization-code client is recognised as a
 * registered grant type rather than false-flagged. A flow already in the RFC spelling passes through.
 */
const COGNITO_FLOW_TO_RFC6749: Readonly<Record<string, string>> = {
  code: 'authorization_code',
  implicit: 'implicit',
}

const toRfc6749Flow = (flow: string): string => COGNITO_FLOW_TO_RFC6749[flow] ?? flow

/**
 * The RFC 6749 grants that sign a user in interactively through the hosted sign-in UI — the
 * authorization-code and implicit flows. Only a client declaring one of these needs the pool to
 * publish hosted sign-in / token endpoints; a machine-to-machine (client-credentials) client mints
 * tokens directly and legitimately advertises no hosted-UI endpoint.
 */
const INTERACTIVE_FLOWS: ReadonlySet<string> = new Set(['authorization_code', 'implicit'])

export interface ConformanceIssue {
  readonly rule: 'RFC6749' | 'RFC6750' | 'OIDC1.0'
  readonly detail: string
}

/** Discovery fields every conformant pool publishes: the issuer and the signing-key set. */
const ALWAYS_REQUIRED_DISCOVERY: readonly (readonly [keyof OidcDiscovery, string])[] = [
  ['issuer', 'issuer'],
  ['jwksUri', 'jwks_uri'],
]

/** Discovery fields a pool publishes only when it serves an interactive (hosted sign-in) client. */
const INTERACTIVE_DISCOVERY: readonly (readonly [keyof OidcDiscovery, string])[] = [
  ['authorizationEndpoint', 'authorization_endpoint'],
  ['tokenEndpoint', 'token_endpoint'],
]

/**
 * Conformance of an emitted discovery document. The issuer and key set are required of every pool;
 * the sign-in / token endpoints are required only when a client signs users in interactively
 * (`requiresHostedUi`), so a domainless machine-to-machine pool is conformant without them rather
 * than false-failed for lacking endpoints it has no interactive client to serve.
 */
const checkDiscovery = (discovery: OidcDiscovery, requiresHostedUi: boolean): ConformanceIssue[] => {
  const issues: ConformanceIssue[] = []
  const required = requiresHostedUi ? [...ALWAYS_REQUIRED_DISCOVERY, ...INTERACTIVE_DISCOVERY] : ALWAYS_REQUIRED_DISCOVERY
  for (const [key, name] of required) {
    const value = discovery[key]
    if (typeof value !== 'string' || value.length === 0) {
      issues.push({ rule: 'OIDC1.0', detail: `discovery document is missing ${name}` })
      continue
    }
    if (!value.startsWith('https://')) {
      issues.push({ rule: 'OIDC1.0', detail: `discovery ${name} must use https` })
    }
  }
  if (discovery.bearerMethod !== undefined && discovery.bearerMethod !== 'header') {
    issues.push({
      rule: 'RFC6750',
      detail: `bearer token presentation "${discovery.bearerMethod}" is not the Authorization-header form`,
    })
  }
  return issues
}

/** Conformance issues with an emitted OAuth2 configuration; an empty list means it conforms. */
export const checkOAuthConformance = (oauth: OAuthConfig): ConformanceIssue[] => {
  const issues: ConformanceIssue[] = []
  if (oauth.flows.length === 0) {
    issues.push({ rule: 'RFC6749', detail: 'no OAuth2 flow is declared' })
  }
  for (const flow of oauth.flows) {
    if (!RFC6749_GRANT_FLOWS.has(toRfc6749Flow(flow))) {
      issues.push({ rule: 'RFC6749', detail: `"${flow}" is not a registered OAuth2 grant type` })
    }
  }
  if (oauth.discovery !== undefined) {
    const requiresHostedUi = oauth.flows.some((flow) => INTERACTIVE_FLOWS.has(toRfc6749Flow(flow)))
    issues.push(...checkDiscovery(oauth.discovery, requiresHostedUi))
  }
  return issues
}
