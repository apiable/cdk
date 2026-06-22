// Scope-enforcing Lambda authorizer for the client_credentials (machine-to-machine) flow. Built from
// the Phase A0 minimal core, NOT the legacy authorizer. It does exactly four things:
//   1. verify the access token (signature / issuer / expiry / token_use=access) at the gateway edge,
//   2. gate on the OAuth `scope` claim with a per-method required-scope map (DENY-BY-DEFAULT),
//   3. emit a per-method Allow policy from apiable_plan_resources via the preserved getServiceArn core,
//   4. return usageIdentifierKey from apiable_api_key so the consumer never sends x-api-key.
//
// Deliberately excluded (each is a brownfield-only increment, not the greenfield core): credit-metering,
// the adminGetUser user-pool lookup, the API-key/HYBRID fallback, in-memory caches, user-pool-sign-in.
//
// getServiceArn / generatePolicyStatement / buildAuthResponse / verifyScope are the audit-blessed
// policy-generation core, preserved from the production authorizer minus the resource-string logging
// (never log claims). Only the auth-flow plumbing and the deny-by-default inversion are new.

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

export function generateIAMPolicy(user, planResources, methodArn) {
  const policyStatements = []
  policyStatements.push(generatePolicyStatement(getServiceArn(planResources, methodArn), 'Allow'))
  return buildAuthResponse(user, policyStatements)
}

// Deny-by-default: returns true only when the method maps to an explicit, non-empty required scope that
// the token carries. An unset/empty required scope, a method absent from the map, or an unparseable map
// all DENY — the inversion of the spike's fail-OPEN verifyScope (sharp edge: an empty required → allow).
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

  const routeKey = routeKeyFromMethodArn(event.methodArn)
  if (!verifyScope(payload.scope || '', REQUIRED_SCOPE_MAP, routeKey)) {
    console.log(`authorizer: deny - client=${payload.client_id} sub=${payload.sub} route="${routeKey}" required scope not present`)
    return defaultDenyAllPolicy // -> 403
  }

  const policy = generateIAMPolicy(payload.sub, payload.apiable_plan_resources || '', event.methodArn)
  if (payload.apiable_api_key) {
    policy.usageIdentifierKey = payload.apiable_api_key
  }
  console.log(`authorizer: allow - client=${payload.client_id} sub=${payload.sub} route="${routeKey}"`)
  return policy
}
