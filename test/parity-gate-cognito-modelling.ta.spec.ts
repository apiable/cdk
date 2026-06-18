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
