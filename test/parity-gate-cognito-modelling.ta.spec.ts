/**
 * Supplementary coverage (TA) for the cognito modelling work beyond the frozen 013-1-16 contract
 * scenarios: the edge/error paths of the resource-server scope set, the cognito reference edges
 * (legacy pre-token attribute, an authorizer bound to a different API), the M7 implicit-flow mapping,
 * the per-client OAuth fallback to the single slot, and the TF output-edge attribute-order
 * determinism the `referencesOf` change pins. Every case drives the real reducers / gate.
 */
import { reduceCloudFormation, reduceTerraformShowJson, gate, checkOAuthConformance } from '@apiable/parity-gate'

const REGION = 'eu-central-1'

// ── resource-server scope set (M1) edge cases ─────────────────────────────────────────────────

const cfnResourceServer = (scopeNames: readonly string[]): unknown => ({
  Resources: {
    RS: {
      Type: 'AWS::Cognito::UserPoolResourceServer',
      Properties: { Identifier: 'apiable', Name: 'apiable', UserPoolId: 'authz', Scopes: scopeNames.map((scopeName) => ({ ScopeName: scopeName, ScopeDescription: 'd' })) },
    },
  },
})

describe('cognito modelling (TA) — resource-server scope set', () => {
  it('reduces the scope-name set sorted and de-duplicated, so channel emission order does not matter', () => {
    const model = reduceCloudFormation(cfnResourceServer(['write', 'read', 'read']), 'cfn', REGION)
    expect(model.values['resource-server-scopes:cognito-resource-server:apiable']).toBe('read,write')
  })

  it('reduces a scopeless resource-server to an empty scope set (present-but-empty, not absent)', () => {
    const model = reduceCloudFormation(cfnResourceServer([]), 'cfn', REGION)
    expect(model.values['resource-server-scopes:cognito-resource-server:apiable']).toBe('')
  })

  it('agrees on an equal scope set across channels regardless of declared order', () => {
    const result = gate([
      reduceCloudFormation(cfnResourceServer(['read', 'write']), 'cdk', REGION),
      reduceCloudFormation(cfnResourceServer(['write', 'read']), 'cfn', REGION),
      reduceTerraformShowJson(
        { planned_values: { root_module: { resources: [{ address: 'aws_cognito_resource_server.rs', type: 'aws_cognito_resource_server', values: { identifier: 'apiable', name: 'apiable', scope: [{ scope_name: 'write' }, { scope_name: 'read' }] } }] } }, configuration: { root_module: { resources: [], outputs: {} } } },
        'terraform',
        REGION,
      ),
    ])
    expect(result.divergences.find((entry) => entry.detail.includes('resource-server-scopes'))).toBeUndefined()
  })
})

// ── cognito reference edges (M3) edge cases ───────────────────────────────────────────────────

describe('cognito modelling (TA) — reference edges', () => {
  it('builds a pool→pre-token-function edge from the LEGACY PreTokenGeneration attribute, not only the versioned config', () => {
    const cfn: unknown = {
      Resources: {
        Pool: { Type: 'AWS::Cognito::UserPool', Properties: { UserPoolName: 'authz', LambdaConfig: { PreTokenGeneration: { 'Fn::GetAtt': ['Fn', 'Arn'] } } } },
        Fn: { Type: 'AWS::Lambda::Function', Properties: { FunctionName: 'pretokengen' } },
      },
    }
    const model = reduceCloudFormation(cfn, 'cfn', REGION)
    expect(model.graph.edges.some((edge) => edge.relation === 'pre-token-generation' && edge.to === 'lambda-function:pretokengen')).toBe(true)
  })

  it('fails when one channel leaves the authorizer UNBOUND from its rest-api (authorizes-api edge present vs absent)', () => {
    const authorizer = (bindApi: boolean): unknown => ({
      Resources: {
        Api: { Type: 'AWS::ApiGateway::RestApi', Properties: { Name: 'api' } },
        Authz: { Type: 'AWS::ApiGateway::Authorizer', Properties: { Name: 'authz', Type: 'COGNITO_USER_POOLS', IdentitySource: 'method.request.header.Authorization', ...(bindApi ? { RestApiId: { Ref: 'Api' } } : {}) } },
      },
    })
    const result = gate([
      reduceCloudFormation(authorizer(true), 'cdk', REGION),
      reduceCloudFormation(authorizer(true), 'cfn', REGION),
      reduceCloudFormation(authorizer(false), 'terraform', REGION),
    ])
    expect(result.passed).toBe(false)
    expect(result.divergences.some((entry) => entry.tier === 'graph' && entry.detail.includes('authorizes-api'))).toBe(true)
  })
})

// ── OAuth conformance vocabulary (M7) ─────────────────────────────────────────────────────────

describe('cognito modelling (TA) — OAuth flow vocabulary', () => {
  it("maps Cognito's implicit spelling to the RFC implicit grant (accepted, not false-flagged)", () => {
    expect(checkOAuthConformance({ flows: ['implicit'], scopes: [] })).toEqual([])
  })

  it('still flags a genuinely unregistered flow even alongside a valid Cognito code flow', () => {
    const issues = checkOAuthConformance({ flows: ['code', 'device_code'], scopes: [] })
    expect(issues.some((issue) => issue.rule === 'RFC6749' && issue.detail.includes('device_code'))).toBe(true)
  })
})

// ── per-client OAuth slot fallback + TF output-edge determinism ────────────────────────────────

describe('cognito modelling (TA) — OAuth slot fallback and edge determinism', () => {
  it('conformance-checks a hand-built model that sets only the single oauth slot (no oauthByClient map)', () => {
    const single = (channel: 'cdk' | 'cfn' | 'terraform') => ({
      channel,
      wellFormed: true,
      graph: { nodes: [], edges: [] },
      values: {},
      grants: [],
      secrets: [],
      oauth: { flows: ['magic_link'], scopes: [] },
      cosmetics: {},
    })
    const result = gate([single('cdk'), single('cfn'), single('terraform')])
    expect(result.divergences.some((entry) => entry.tier === 'oauth' && entry.detail.includes('magic_link'))).toBe(true)
  })

  it('keeps the TF output-edge attribute stable when the reference list names the bare address before the attribute', () => {
    const planFor = (refs: readonly string[]): unknown => ({
      planned_values: { root_module: { resources: [{ address: 'aws_iam_role.this', type: 'aws_iam_role', values: { name: 'r' } }] } },
      configuration: { root_module: { resources: [], outputs: { role_arn: { expression: { references: refs } } } } },
    })
    // Whether the bare address or the `.arn` attribute is named first, the edge attribute is `arn`.
    const attrFirst = reduceTerraformShowJson(planFor(['aws_iam_role.this.arn', 'aws_iam_role.this']), 'terraform', REGION)
    const bareFirst = reduceTerraformShowJson(planFor(['aws_iam_role.this', 'aws_iam_role.this.arn']), 'terraform', REGION)
    const edgeOf = (model: ReturnType<typeof reduceTerraformShowJson>) => model.graph.edges.find((edge) => edge.relation.startsWith('exports:'))
    expect(edgeOf(attrFirst)?.relation).toBe('exports:arn')
    expect(edgeOf(bareFirst)?.relation).toBe('exports:arn')
  })
})

// ── flow-gated discovery conformance (M4) edge cases ───────────────────────────────────────────

const TAG = 'apiable:logical-id'

describe('cognito modelling (TA) — flow-gated discovery conformance', () => {
  it('still requires the hosted-UI endpoints when a client declares BOTH an interactive and a machine flow', () => {
    // requiresHostedUi is OR-based: an interactive flow alongside client-credentials still needs the endpoints
    const issues = checkOAuthConformance({ flows: ['code', 'client_credentials'], scopes: [], discovery: { issuer: 'https://i', jwksUri: 'https://j' } })
    expect(issues.some((issue) => issue.detail.includes('authorization_endpoint'))).toBe(true)
  })

  it('accepts a machine-to-machine client whose pool DOES publish endpoints (present-but-not-required is conformant)', () => {
    const issues = checkOAuthConformance({
      flows: ['client_credentials'],
      scopes: [],
      discovery: { issuer: 'https://i', jwksUri: 'https://j', authorizationEndpoint: 'https://a', tokenEndpoint: 'https://t', bearerMethod: 'header' },
    })
    expect(issues).toEqual([])
  })

  it('requires the endpoints for an implicit client (interactive), not only authorization-code', () => {
    const issues = checkOAuthConformance({ flows: ['implicit'], scopes: [], discovery: { issuer: 'https://i', jwksUri: 'https://j' } })
    expect(issues.some((issue) => issue.detail.includes('token_endpoint'))).toBe(true)
  })
})

// ── cross-channel discovery value rows (DISC) ──────────────────────────────────────────────────

const cfnPoolWithDomain = (domain: string | undefined): unknown => ({
  Resources: {
    Pool: { Type: 'AWS::Cognito::UserPool', Properties: { UserPoolName: 'authz', UserPoolTags: { [TAG]: 'authz-pool' } } },
    ...(domain === undefined ? {} : { Domain: { Type: 'AWS::Cognito::UserPoolDomain', Properties: { Domain: domain, UserPoolId: { Ref: 'Pool' } } } }),
  },
})

describe('cognito modelling (TA) — cross-channel discovery value rows', () => {
  it('emits the pool issuer region-normalised, so a channel reduced with vs without a concrete region reads the same host', () => {
    const issuerKey = 'oauth-discovery-issuer:cognito-user-pool:authz-pool'
    const withRegion = reduceCloudFormation(cfnPoolWithDomain(undefined), 'cfn', REGION)
    const noRegion = reduceCloudFormation(cfnPoolWithDomain(undefined), 'cdk')
    expect(withRegion.values[issuerKey]).toBe(noRegion.values[issuerKey])
    expect(withRegion.values[issuerKey]).toContain('{region}')
  })

  it('emits no sign-in/token rows for a domainless pool, but does for a domained one', () => {
    const authorizeKey = 'oauth-discovery-authorize:cognito-user-pool:authz-pool'
    const domainless = reduceCloudFormation(cfnPoolWithDomain(undefined), 'cfn', REGION)
    const domained = reduceCloudFormation(cfnPoolWithDomain('authz-portal'), 'cfn', REGION)
    expect(domainless.values[authorizeKey]).toBeUndefined()
    expect(domained.values[authorizeKey]).toContain('authz-portal')
  })
})

// ── per-client OAuth keyed by channel-local id (OBC) ───────────────────────────────────────────

describe('cognito modelling (TA) — per-client OAuth keyed by channel-local id', () => {
  it('keeps BOTH of two nameless clients in the per-client map, so the first unregistered flow is not swallowed', () => {
    const twoNameless: unknown = {
      Resources: {
        Pool: { Type: 'AWS::Cognito::UserPool', Properties: { UserPoolName: 'authz', UserPoolTags: { [TAG]: 'authz-pool' } } },
        ClientOne: { Type: 'AWS::Cognito::UserPoolClient', Properties: { UserPoolId: { Ref: 'Pool' }, AllowedOAuthFlows: ['magic_link'], AllowedOAuthScopes: ['apiable/read'] } },
        ClientTwo: { Type: 'AWS::Cognito::UserPoolClient', Properties: { UserPoolId: { Ref: 'Pool' }, AllowedOAuthFlows: ['client_credentials'], AllowedOAuthScopes: ['apiable/read'] } },
      },
    }
    const model = reduceCloudFormation(twoNameless, 'cfn', REGION)
    expect(Object.keys(model.oauthByClient ?? {}).length).toBe(2)
  })
})

// ── resource-server pool anchoring (the genuine same-pool dup backstop) ────────────────────────

describe('cognito modelling (TA) — resource-server pool anchoring', () => {
  it('still collides two same-Identifier resource-servers on the SAME pool (the within-channel backstop)', () => {
    const samePoolDup: unknown = {
      Resources: {
        Pool: { Type: 'AWS::Cognito::UserPool', Properties: { UserPoolName: 'authz', UserPoolTags: { [TAG]: 'authz-pool' } } },
        RsOne: { Type: 'AWS::Cognito::UserPoolResourceServer', Properties: { UserPoolId: { Ref: 'Pool' }, Identifier: 'apiable', Name: 'a', Scopes: [{ ScopeName: 'read', ScopeDescription: 'r' }] } },
        RsTwo: { Type: 'AWS::Cognito::UserPoolResourceServer', Properties: { UserPoolId: { Ref: 'Pool' }, Identifier: 'apiable', Name: 'b', Scopes: [{ ScopeName: 'write', ScopeDescription: 'w' }] } },
      },
    }
    const result = gate([
      reduceCloudFormation(samePoolDup, 'cdk', REGION),
      reduceCloudFormation(samePoolDup, 'cfn', REGION),
      reduceCloudFormation(samePoolDup, 'terraform', REGION),
    ])
    expect(result.passed).toBe(false)
    expect(result.divergences.some((entry) => entry.detail.includes('duplicate declared identity') && entry.detail.includes('of-pool:authz-pool:apiable'))).toBe(true)
  })
})
