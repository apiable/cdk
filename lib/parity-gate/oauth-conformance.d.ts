/**
 * Static OAuth2 / OIDC conformance check on the configuration a channel emits. This is a
 * structural check on the declared configuration — no network call — so it runs identically
 * across all three channels: the same emitted flows, scopes, and (when present) discovery
 * document are checked against RFC 6749 (OAuth2), RFC 6750 (Bearer token usage), and the
 * OpenID Connect 1.0 discovery shape.
 */
import { OAuthConfig } from './model';
export interface ConformanceIssue {
    readonly rule: 'RFC6749' | 'RFC6750' | 'OIDC1.0';
    readonly detail: string;
}
/** Conformance issues with an emitted OAuth2 configuration; an empty list means it conforms. */
export declare const checkOAuthConformance: (oauth: OAuthConfig) => ConformanceIssue[];
