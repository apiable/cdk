/**
 * Type declarations for the greenfield authorizer handler asset, so the construct tests can import its
 * real functions under `noImplicitAny` (jest transpiles the `.mjs` directly; this only types the import).
 */

/** An API Gateway TOKEN-authorizer event. */
export interface AuthorizerEvent {
  authorizationToken?: string
  methodArn?: string
}

/** A single IAM policy statement in the authorizer response. */
export interface PolicyStatement {
  Action: string
  Effect: 'Allow' | 'Deny'
  Resource: string | string[]
}

/** The IAM policy the authorizer returns to API Gateway. */
export interface AuthResponse {
  principalId: string
  policyDocument: {
    Version: string
    Statement: PolicyStatement[]
  }
  usageIdentifierKey?: string
}

/** A per-method required-scope map: route key (`"<METHOD> <resourcePath>"`) → required `apiable/<scope>`. */
export type RequiredScopeMap = Record<string, string> | null

/** The static deny-all policy returned on a scope/structure denial (→ gateway 403). */
export const defaultDenyAllPolicy: AuthResponse

/**
 * The addresses on the called API and stage of every route the token's scopes satisfy, kept where a
 * plan-resource pattern reaches them.
 */
export function allowedRouteArns(
  providedScope: string,
  requiredScopeMap: RequiredScopeMap,
  planResources: string,
  methodArn: string,
): string[]

/**
 * Build an Allow policy for the allowed route addresses; over the size bound, for the called address
 * alone. Throws when nothing is left to allow, so a refusal never reuses or mutates `defaultDenyAllPolicy`.
 */
export function generateIAMPolicy(user: string, allowedArns: string[], methodArn: string): AuthResponse

/** Deny-by-default scope gate: true only when the route maps to an explicit, non-empty scope the token carries. */
export function verifyScope(
  providedScope: string,
  requiredScopeMap: RequiredScopeMap,
  routeKey: string,
): boolean

/** Translate the semicolon `apiable_plan_resources` claim into the per-method execute-api ARNs. */
export function getServiceArn(resources: string, methodArn: string): string[]

/** Derive the required-scope-map key (`"<METHOD> <resourcePath>"`) from a method ARN. */
export function routeKeyFromMethodArn(methodArn: string): string

/** The Lambda entrypoint: verify the token, gate on scope (deny-by-default), emit the scope-satisfied routes' policy. */
export function handler(event: AuthorizerEvent): Promise<AuthResponse>
