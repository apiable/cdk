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

export interface ConformanceIssue {
  readonly rule: 'RFC6749' | 'RFC6750' | 'OIDC1.0'
  readonly detail: string
}

const REQUIRED_DISCOVERY: readonly (readonly [keyof OidcDiscovery, string])[] = [
  ['issuer', 'issuer'],
  ['authorizationEndpoint', 'authorization_endpoint'],
  ['tokenEndpoint', 'token_endpoint'],
  ['jwksUri', 'jwks_uri'],
]

const checkDiscovery = (discovery: OidcDiscovery): ConformanceIssue[] => {
  const issues: ConformanceIssue[] = []
  for (const [key, name] of REQUIRED_DISCOVERY) {
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
    if (!RFC6749_GRANT_FLOWS.has(flow)) {
      issues.push({ rule: 'RFC6749', detail: `"${flow}" is not a registered OAuth2 grant type` })
    }
  }
  if (oauth.discovery !== undefined) issues.push(...checkDiscovery(oauth.discovery))
  return issues
}
