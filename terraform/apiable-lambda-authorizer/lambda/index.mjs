// Scope-enforcing Lambda authorizer for the client_credentials (machine-to-machine) flow. Built from
// the Phase A0 minimal core, NOT the legacy authorizer. It does exactly four things:
//   1. verify the access token (signature / issuer / expiry / token_use=access) at the gateway edge,
//   2. gate on the OAuth `scope` claim with a per-method required-scope map (DENY-BY-DEFAULT),
//   3. emit an Allow policy naming only the routes the token's scopes satisfy, narrowed by apiable_plan_resources,
//   4. return usageIdentifierKey from apiable_api_key so the consumer never sends x-api-key.
//
// Deliberately excluded (each is a brownfield-only increment, not the greenfield core): credit-metering,
// the user-pool admin lookup, the API-key fallback, in-memory caches, and user-pool-sign-in mode.
//
// getServiceArn / generatePolicyStatement / buildAuthResponse are the audit-blessed policy-generation
// core (the production authorizer's, minus the resource-string logging — never log claims). verifyScope
// is deny-by-default: it grants only when the method maps to an explicit, non-empty required scope the
// token carries.

import { CognitoJwtVerifier } from 'aws-jwt-verify'

// The pool whose issuer + JWKS validate the access token. client_credentials issues an ACCESS token
// (no ID token); tokenUse 'access' rejects an ID token, clientId null accepts any app client in the pool.
const USER_POOL_ID = process.env.APIABLE_AWS_AUTHZ_USERPOOLID

// Per-method required-scope map: { "<HTTP_METHOD> <resourcePath>": "apiable/<scope>", ... }. A method
// absent from the map, or one whose required value is empty, DENIES (deny-by-default). The required
// value carries the apiable/ prefix. Parsed once at cold start; an unparseable value denies every request.
const REQUIRED_SCOPE_MAP = parseRequiredScopeMap(process.env.REQUIRED_SCOPE_MAP)

function parseRequiredScopeMap(raw) {
  if (!raw) {
    return {}
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed
    }
    console.log('authorizer: required-scope map is not a JSON object; treating every method as unmapped (deny)')
    return null
  } catch {
    console.log('authorizer: required-scope map is not valid JSON; treating every method as unmapped (deny)')
    return null
  }
}

// The verifier is created lazily on first use so the module imports without a configured pool (and so
// unit tests can exercise the pure policy/scope core without constructing a real verifier).
let cachedVerifier
function getVerifier() {
  if (!cachedVerifier) {
    cachedVerifier = CognitoJwtVerifier.create({
      userPoolId: USER_POOL_ID,
      clientId: null,
      tokenUse: 'access',
    })
  }
  return cachedVerifier
}

export const defaultDenyAllPolicy = {
  principalId: 'user',
  policyDocument: {
    Version: '2012-10-17',
    Statement: [{ Action: 'execute-api:Invoke', Effect: 'Deny', Resource: '*' }],
  },
}

// --- preserved policy-generation core (production authorizer; audit Decision 6) ---

function generatePolicyStatement(methodArn, action) {
  const statement = {}
  statement.Action = 'execute-api:Invoke'
  statement.Effect = action
  statement.Resource = methodArn
  return statement
}

function buildAuthResponse(principalId, policyStatements) {
  const authResponse = {}
  authResponse.principalId = principalId
  const policyDocument = {}
  policyDocument.Version = '2012-10-17'
  policyDocument.Statement = policyStatements
  authResponse.policyDocument = policyDocument
  return authResponse
}

// API Gateway caches the returned policy per token and reuses it for every route of the API, so the policy
// must hold for every route: it names exactly the routes the token's scopes satisfy, never the stage.
const MAX_ROUTE_ARN_LENGTH = 512
const MAX_POLICY_ARNS_LENGTH = 4096

// The exact inverse of routeKeyFromMethodArn on the called API and stage, or null when the key cannot be
// named exactly: a wildcard character would allow more than the key names, and an address that does not
// read back as its key (a ':' in the path, a bad shape) or is over AWS's 512-character cap is left out.
function routeArn(routeKey, methodArn) {
  const match = /^(\S+) (\/\S*)$/.exec(routeKey)
  if (!match) {
    return null
  }
  const parts = methodArn.split(':')
  const pathParts = parts[5].split('/')
  const arn = `${parts.slice(0, 5).join(':')}:${pathParts[0]}/${pathParts[1]}/${match[1]}${match[2]}`
  if (arn.length > MAX_ROUTE_ARN_LENGTH || /[*?]/.test(arn)) {
    return null
  }
  try {
    return routeKeyFromMethodArn(arn) === routeKey ? arn : null
  } catch {
    return null
  }
}

// IAM wildcard match without backtracking: on a mismatch only the most recent '*' takes one more
// character, so a pattern with many '*' stays O(pattern x arn). '?' is one code point.
export function arnPatternMatches(pattern, arn) {
  const p = Array.from(pattern)
  const s = Array.from(arn)
  let pi = 0
  let si = 0
  let star = -1
  let resume = 0
  while (si < s.length) {
    if (pi < p.length && p[pi] !== '*' && (p[pi] === '?' || p[pi] === s[si])) {
      pi++
      si++
    } else if (pi < p.length && p[pi] === '*') {
      star = pi++
      resume = si
    } else if (star !== -1) {
      pi = star + 1
      si = ++resume
    } else {
      return false
    }
  }
  while (pi < p.length && p[pi] === '*') {
    pi++
  }
  return pi === p.length
}

// Every route the token's scopes satisfy, as an address on the called API and stage, kept only where a
// plan-resource pattern reaches it. An empty plan claim yields the stage pattern, which keeps every route.
export function allowedRouteArns(providedScope, requiredScopeMap, planResources, methodArn) {
  const planPatterns = getServiceArn(planResources, methodArn)
  return Object.keys(requiredScopeMap || {})
    .filter((routeKey) => verifyScope(providedScope, requiredScopeMap, routeKey))
    .map((routeKey) => routeArn(routeKey, methodArn))
    .filter((arn) => arn !== null && planPatterns.some((pattern) => arnPatternMatches(pattern, arn)))
}

// Throws when there is nothing to allow, so the caller refuses with the shared deny-all policy untouched.
// Over the size bound only the called address is allowed, and only when it is itself in the list.
export function generateIAMPolicy(user, allowedArns, methodArn) {
  let resources = allowedArns
  if (allowedArns.join('').length > MAX_POLICY_ARNS_LENGTH) {
    if (!allowedArns.includes(methodArn)) {
      throw new Error('the allowed routes exceed the policy size bound and the called route is not among them')
    }
    console.log(`authorizer: policy over the size bound - sub=${user} route="${routeKeyFromMethodArn(methodArn)}" allowing the called route only`)
    resources = [methodArn]
  }
  if (resources.length === 0) {
    throw new Error("no route the token's scopes allow")
  }
  return buildAuthResponse(user, [generatePolicyStatement(resources, 'Allow')])
}

// Deny-by-default: returns true only when the method maps to an explicit, non-empty required scope that
// the token carries. An unset/empty required scope, a method absent from the map, or an unparseable map
// (requiredScopeMap === null) all DENY. It gates the called route and decides every route the returned
// policy names.
export function verifyScope(providedScope, requiredScopeMap, routeKey) {
  if (!requiredScopeMap) {
    return false
  }
  const required = requiredScopeMap[routeKey]
  if (!required) {
    return false
  }
  const provided = (providedScope || '').split(' ')
  const requiredScopes = required.split(' ')
  for (const scope of requiredScopes) {
    if (!scope || !provided.includes(scope)) {
      return false
    }
  }
  return true
}

export function getServiceArn(resources, methodArn) {
  let resourcePolicies = []
  let resourcePoliciesFilteredUnique = []
  if (!!resources) {
    resourcePolicies = resources
      .replaceAll(' ', '') // remove all spaces (should normally not contain any)
      .replaceAll('ANY', '*') // replace ANY with *, which the gateway will understand
      .replaceAll(/{[^}]+}/g, '*') // replace path-patterns with * e.g. {proxy+}
      .replaceAll(/{[^}]}/g, '*') // replace path-patterns with * e.g. {proxy}
      .replaceAll('//;', '/*;') // base path '/' like GET//; becomes /*
      .replaceAll('/*/*', '/*') // collapse stared method and path to /*
      .split(';')
    resourcePoliciesFilteredUnique = [...new Set(resourcePolicies)]
  }

  // Get the last part, such as cqo3riplm6/prod/GET/products
  const parts = methodArn.split(':')
  if (parts.length === 6) {
    const pathParts = parts[5].split('/')
    const resourcePolicyArns = []
    if (pathParts.length >= 4) {
      if (resourcePoliciesFilteredUnique.length > 0) {
        for (let i = 0; i < resourcePoliciesFilteredUnique.length; i++) {
          parts[5] = resourcePoliciesFilteredUnique[i]
          resourcePolicyArns.push(parts.join(':'))
        }
      } else {
        // No specific resources on the token: grant the invoked API (apiId/stage/*).
        parts[5] = `${pathParts[0]}/${pathParts[1]}/*`
        resourcePolicyArns.push(parts.join(':'))
      }
      return resourcePolicyArns
    }
  }

  throw new Error(`Unexpected method ARN received: ${methodArn}`)
}

// The required-scope-map key for a method ARN: "<HTTP_METHOD> <resourcePath>" derived from the ARN's
// trailing apiId/stage/METHOD/path segment, e.g. "GET /products". Keying off the method + path (not the
// raw ARN) keeps the map account/region/apiId-agnostic.
export function routeKeyFromMethodArn(methodArn) {
  const parts = methodArn.split(':')
  if (parts.length !== 6) {
    throw new Error(`Unexpected method ARN received: ${methodArn}`)
  }
  const pathParts = parts[5].split('/')
  if (pathParts.length < 4) {
    throw new Error(`Unexpected method ARN received: ${methodArn}`)
  }
  const method = pathParts[2]
  const resourcePath = `/${pathParts.slice(3).join('/')}`
  return `${method} ${resourcePath}`
}

// --- end preserved core ---

export const handler = async (event) => {
  const token = (event.authorizationToken || '').replace('Bearer ', '')
  if (!token) {
    throw new Error('Unauthorized') // -> 401
  }

  let payload
  try {
    payload = await getVerifier().verify(token) // signature, issuer, expiry, token_use=access
  } catch (e) {
    console.log(`authorizer: deny - token verification failed: ${e.message}`)
    throw new Error('Unauthorized') // -> 401
  }

  // A malformed/absent methodArn denies through the same explicit 403 channel (fail-closed), rather than
  // an uncaught throw that API Gateway would surface as a 500.
  let routeKey
  try {
    routeKey = routeKeyFromMethodArn(event.methodArn)
  } catch (e) {
    console.log(`authorizer: deny - client=${payload.client_id} sub=${payload.sub} malformed method arn: ${e.message}`)
    return defaultDenyAllPolicy // -> 403
  }

  if (!verifyScope(payload.scope || '', REQUIRED_SCOPE_MAP, routeKey)) {
    console.log(`authorizer: deny - client=${payload.client_id} sub=${payload.sub} route="${routeKey}" required scope not present`)
    return defaultDenyAllPolicy // -> 403
  }

  let policy
  try {
    policy = generateIAMPolicy(payload.sub, allowedRouteArns(payload.scope || '', REQUIRED_SCOPE_MAP, payload.apiable_plan_resources || '', event.methodArn), event.methodArn)
  } catch (e) {
    console.log(`authorizer: deny - client=${payload.client_id} sub=${payload.sub} route="${routeKey}" policy generation failed: ${e.message}`)
    return defaultDenyAllPolicy // -> 403
  }
  if (payload.apiable_api_key) {
    policy.usageIdentifierKey = payload.apiable_api_key
  }
  console.log(`authorizer: allow - client=${payload.client_id} sub=${payload.sub} route="${routeKey}"`)
  return policy
}
