/**
 * Acceptance specs — Story 013-1-16: teach the parity check cognito's non-security shape (modelling).
 * Frozen contract: contract-013-1-16-parity-gate-cognito-modelling.md
 *
 * One un-skipped spec per contract scenario (S1–S8), each driving the real reducers + gate against
 * faithful multi-resource cognito/authorizer artifacts: user pools (each carrying the author-declared
 * `apiable:logical-id` the gate keys identity on), the clients and resource-servers bound to them, the
 * scopes a resource-server exposes, the OAuth flows a client declares, and the discovery configuration.
 * The CDK and CFN channels are reduced from CloudFormation and the Terraform channel from
 * `terraform show -json`, so each property is proven across both reducers, not one shape compared to
 * itself. Every modelling fixture is a forcing fixture: it cannot go green while a resource-server
 * scope set is dropped or clobbered, a pool binding is invisible, a conformant authorization-code or
 * machine-to-machine client is false-FAILed, or a divergent discovery endpoint is never compared.
 *
 * Shares the declared-id engine / collectValues / the cognito edges / oauthFrom / both reducers with
 * siblings 013-1-14 (grant & trust security core), 013-1-15 (storage tier), and 013-1-18 (declared id);
 * those slices' fixtures are re-run alongside this one.
 */
import * as fs from 'fs'
import * as path from 'path'
import { gate, reduceCloudFormation, reduceTerraformShowJson } from '@apiable/parity-gate'

const REGION = 'eu-central-1'
const TAG = 'apiable:logical-id'
const AUTHZ_POOL = 'apiable-authz-pool'
const AUTHN_POOL = 'apiable-authn-pool'
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${AUTHZ_POOL}`

// ── CloudFormation builders (the CDK + CFN channels share this reducer) ────────────────────────

interface CognitoShape {
  readonly scopes?: readonly string[]
  readonly clientFlows?: readonly string[]
  readonly clientPool?: string // logical id of the pool the client/resource-server binds to
  readonly withDomain?: boolean
  readonly domain?: string // the hosted-UI domain prefix, so a divergent endpoint host can be forced
}

/**
 * A faithful cognito authorization stack as a CloudFormation template: a user pool carrying its declared
 * id, a pre-token function the pool customises tokens with, a hosted-UI domain, a resource-server
 * exposing named scopes, an OAuth client declaring flows, a REST API and the authorizer bound to the pool.
 */
const cfnCognitoStack = (shape: CognitoShape = {}): unknown => {
  const scopes = shape.scopes ?? ['read', 'write']
  const clientFlows = shape.clientFlows ?? ['code']
  const poolId = shape.clientPool ?? 'AuthzPool'
  const domain = shape.domain ?? 'authz-portal'
  return {
    Resources: {
      AuthzPool: {
        Type: 'AWS::Cognito::UserPool',
        Properties: {
          UserPoolName: 'authz',
          UserPoolTier: 'ESSENTIALS',
          UserPoolTags: { [TAG]: AUTHZ_POOL },
          LambdaConfig: { PreTokenGenerationConfig: { LambdaVersion: 'V3_0', LambdaArn: { 'Fn::GetAtt': ['PreTokenFn', 'Arn'] } } },
        },
      },
      PreTokenFn: { Type: 'AWS::Lambda::Function', Properties: { FunctionName: 'pretokengen', Runtime: 'nodejs20.x' } },
      ...(shape.withDomain === false
        ? {}
        : { AuthzDomain: { Type: 'AWS::Cognito::UserPoolDomain', Properties: { Domain: domain, UserPoolId: { Ref: 'AuthzPool' } } } }),
      AuthzResourceServer: {
        Type: 'AWS::Cognito::UserPoolResourceServer',
        Properties: {
          Identifier: 'apiable',
          Name: 'apiable',
          UserPoolId: { Ref: poolId },
          Scopes: scopes.map((scopeName) => ({ ScopeName: scopeName, ScopeDescription: `${scopeName} access` })),
        },
      },
      AuthzClient: {
        Type: 'AWS::Cognito::UserPoolClient',
        Properties: {
          ClientName: 'authz-client',
          UserPoolId: { Ref: poolId },
          AllowedOAuthFlows: [...clientFlows],
          AllowedOAuthScopes: ['apiable/read'],
          GenerateSecret: true,
        },
      },
      AuthzApi: { Type: 'AWS::ApiGateway::RestApi', Properties: { Name: 'authz-api' } },
      AuthzAuthorizer: {
        Type: 'AWS::ApiGateway::Authorizer',
        Properties: {
          Name: 'authz-authorizer',
          Type: 'COGNITO_USER_POOLS',
          IdentitySource: 'method.request.header.Authorization',
          RestApiId: { Ref: 'AuthzApi' },
          ProviderARNs: [{ 'Fn::GetAtt': ['AuthzPool', 'Arn'] }],
        },
      },
    },
  }
}

/** Two pools (authentication + authorization), EACH exposing an `apiable` resource-server, so the gate
 * proves two same-identifier resource-servers on different pools are distinct (no false collision). */
const cfnTwoPools = (authzScopes: readonly string[]): unknown => ({
  Resources: {
    AuthnPool: { Type: 'AWS::Cognito::UserPool', Properties: { UserPoolName: 'authn', UserPoolTags: { [TAG]: AUTHN_POOL } } },
    AuthnResourceServer: {
      Type: 'AWS::Cognito::UserPoolResourceServer',
      Properties: { Identifier: 'apiable', Name: 'apiable', UserPoolId: { Ref: 'AuthnPool' }, Scopes: [{ ScopeName: 'login', ScopeDescription: 'login' }] },
    },
    AuthzPool: { Type: 'AWS::Cognito::UserPool', Properties: { UserPoolName: 'authz', UserPoolTags: { [TAG]: AUTHZ_POOL } } },
    AuthzResourceServer: {
      Type: 'AWS::Cognito::UserPoolResourceServer',
      Properties: { Identifier: 'apiable', Name: 'apiable', UserPoolId: { Ref: 'AuthzPool' }, Scopes: authzScopes.map((scopeName) => ({ ScopeName: scopeName, ScopeDescription: scopeName })) },
    },
  },
})

// ── Terraform `show -json` builders (the Terraform channel's own reducer) ──────────────────────

const tfRef = (target: string): { references: string[] } => ({ references: [`${target}.arn`, target] })

/**
 * The equivalent cognito stack as `terraform show -json`: planned_values carries the concrete scalars
 * (scope names, pool tier, oauth flows, the declared-id tag) and configuration carries the reference
 * expressions the graph edges are read from (a plan leaves a computed pool id unknown, so the binding
 * is read from the refs).
 */
const tfCognitoStack = (shape: CognitoShape = {}): unknown => {
  const scopes = shape.scopes ?? ['read', 'write']
  const clientFlows = shape.clientFlows ?? ['code']
  const poolAddress = shape.clientPool ?? 'aws_cognito_user_pool.authz'
  const domain = shape.domain ?? 'authz-portal'
  const planned = [
    {
      address: 'aws_cognito_user_pool.authz',
      type: 'aws_cognito_user_pool',
      values: {
        name: 'authz',
        user_pool_tier: 'ESSENTIALS',
        tags: { [TAG]: AUTHZ_POOL },
        lambda_config: [{ pre_token_generation_config: [{ lambda_version: 'V3_0', lambda_arn: 'arn:aws:lambda:eu-central-1:034444869755:function:pretokengen' }] }],
      },
    },
    { address: 'aws_lambda_function.pretokengen', type: 'aws_lambda_function', values: { function_name: 'pretokengen', runtime: 'nodejs20.x' } },
    ...(shape.withDomain === false
      ? []
      : [{ address: 'aws_cognito_user_pool_domain.authz', type: 'aws_cognito_user_pool_domain', values: { domain } }]),
    {
      address: 'aws_cognito_resource_server.authz',
      type: 'aws_cognito_resource_server',
      values: { identifier: 'apiable', name: 'apiable', scope: scopes.map((scopeName) => ({ scope_name: scopeName, scope_description: `${scopeName} access` })) },
    },
    {
      address: 'aws_cognito_user_pool_client.authz',
      type: 'aws_cognito_user_pool_client',
      values: { name: 'authz-client', allowed_oauth_flows: [...clientFlows], allowed_oauth_scopes: ['apiable/read'], generate_secret: true },
    },
    { address: 'aws_api_gateway_rest_api.authz', type: 'aws_api_gateway_rest_api', values: { name: 'authz-api' } },
    {
      address: 'aws_api_gateway_authorizer.authz',
      type: 'aws_api_gateway_authorizer',
      values: { name: 'authz-authorizer', type: 'COGNITO_USER_POOLS', identity_source: 'method.request.header.Authorization' },
    },
  ]
  const config = [
    { address: 'aws_cognito_user_pool.authz', type: 'aws_cognito_user_pool', expressions: { lambda_config: [{ pre_token_generation_config: [{ lambda_arn: tfRef('aws_lambda_function.pretokengen') }] }] } },
    ...(shape.withDomain === false
      ? []
      : [{ address: 'aws_cognito_user_pool_domain.authz', type: 'aws_cognito_user_pool_domain', expressions: { user_pool_id: tfRef('aws_cognito_user_pool.authz') } }]),
    { address: 'aws_cognito_resource_server.authz', type: 'aws_cognito_resource_server', expressions: { user_pool_id: tfRef(poolAddress) } },
    { address: 'aws_cognito_user_pool_client.authz', type: 'aws_cognito_user_pool_client', expressions: { user_pool_id: tfRef(poolAddress) } },
    { address: 'aws_api_gateway_authorizer.authz', type: 'aws_api_gateway_authorizer', expressions: { rest_api_id: tfRef('aws_api_gateway_rest_api.authz'), provider_arns: tfRef('aws_cognito_user_pool.authz') } },
  ]
  return { planned_values: { root_module: { resources: planned } }, configuration: { root_module: { resources: config, outputs: {} } } }
}

/** The two-pool stack as terraform: each pool carries its declared id; each resource-server binds to its
 * own pool, so the pool-anchored ref keeps the two `apiable` resource-servers distinct across channels. */
const tfTwoPools = (authzScopes: readonly string[]): unknown => ({
  planned_values: {
    root_module: {
      resources: [
        { address: 'aws_cognito_user_pool.authn', type: 'aws_cognito_user_pool', values: { name: 'authn', tags: { [TAG]: AUTHN_POOL } } },
        { address: 'aws_cognito_resource_server.authn', type: 'aws_cognito_resource_server', values: { identifier: 'apiable', name: 'apiable', scope: [{ scope_name: 'login' }] } },
        { address: 'aws_cognito_user_pool.authz', type: 'aws_cognito_user_pool', values: { name: 'authz', tags: { [TAG]: AUTHZ_POOL } } },
        { address: 'aws_cognito_resource_server.authz', type: 'aws_cognito_resource_server', values: { identifier: 'apiable', name: 'apiable', scope: authzScopes.map((scopeName) => ({ scope_name: scopeName })) } },
      ],
    },
  },
  configuration: {
    root_module: {
      resources: [
        { address: 'aws_cognito_resource_server.authn', type: 'aws_cognito_resource_server', expressions: { user_pool_id: tfRef('aws_cognito_user_pool.authn') } },
        { address: 'aws_cognito_resource_server.authz', type: 'aws_cognito_resource_server', expressions: { user_pool_id: tfRef('aws_cognito_user_pool.authz') } },
      ],
      outputs: {},
    },
  },
})

// ── Harness ───────────────────────────────────────────────────────────────────────────────────

const gateOf = (cdk: unknown, cfn: unknown, terraformPlan: unknown): ReturnType<typeof gate> =>
  gate([
    reduceCloudFormation(cdk, 'cdk', REGION),
    reduceCloudFormation(cfn, 'cfn', REGION),
    reduceTerraformShowJson(terraformPlan, 'terraform', REGION),
  ])

const divergenceOn = (result: ReturnType<typeof gate>, tier: string, fragment: string) =>
  result.divergences.find((entry) => entry.tier === tier && entry.detail.includes(fragment))

describe('013-1-16 parity check — cognito modelling + CI', () => {
  // contract: S1 — equivalent cognito artifacts across all three channels → agreement
  it('S1: equivalent pools + clients + resource-servers + scopes + OAuth flows + discovery across all channels → parity holds', () => {
    const result = gateOf(cfnCognitoStack(), cfnCognitoStack(), tfCognitoStack())
    expect(result.passed).toBe(true)
    expect(result.divergences).toEqual([])
  })

  // contract: S2 — a divergent resource-server scope set is caught (M1), including the two-pool forcing
  // fixture: same-identifier resource-servers on different pools must not falsely collapse, and a widening
  // on one must be caught on its own pool-anchored key.
  it('S2: a resource-server exposing a different named-scope set across channels → the check FAILS on the divergent scope set', () => {
    // Single-pool: a divergent scope set across channels fails on the scope-set value.
    const result = gateOf(cfnCognitoStack({ scopes: ['read', 'write'] }), cfnCognitoStack({ scopes: ['read', 'write'] }), tfCognitoStack({ scopes: ['read'] }))
    expect(result.passed).toBe(false)
    const divergence = divergenceOn(result, 'value', 'resource-server-scopes')
    expect(divergence).toBeDefined()
    expect(divergence?.channels).toEqual(['terraform'])

    // M1 forcing fixture: two pools each exposing an `apiable` resource-server anchor to distinct pools, so
    // they never clobber each other the way Identifier-only keying did → equivalent channels are PARITY OK.
    const equivalent = gateOf(cfnTwoPools(['admin']), cfnTwoPools(['admin']), tfTwoPools(['admin']))
    expect(equivalent.passed).toBe(true)
    expect(equivalent.divergences).toEqual([])

    // The authorization pool's resource-server is widened with a `superadmin` scope in terraform only →
    // caught on its own pool-anchored key, not hidden behind the authentication pool's resource-server.
    const widened = gateOf(cfnTwoPools(['admin']), cfnTwoPools(['admin']), tfTwoPools(['admin', 'superadmin']))
    expect(widened.passed).toBe(false)
    const widenedDivergence = divergenceOn(widened, 'value', `resource-server-scopes:cognito-resource-server:of-pool:${AUTHZ_POOL}:apiable`)
    expect(widenedDivergence).toBeDefined()
    expect(widenedDivergence?.channels).toEqual(['terraform'])
  })

  // contract: S3 — a resource bound to a different or no pool is caught (M3)
  it('S3: a client/resource-server/token-customisation function bound to a different (or no) pool across channels → the check FAILS on the binding', () => {
    // The CDK + CFN channels bind the resource-server + client to AuthzPool; the Terraform channel
    // binds them to a SECOND pool, so the cognito reference graph diverges on the binding edge.
    const tfTwoPool = tfCognitoStack({ clientPool: 'aws_cognito_user_pool.other' }) as {
      planned_values: { root_module: { resources: { address: string; type: string; values: Record<string, unknown> }[] } }
    }
    tfTwoPool.planned_values.root_module.resources.push({ address: 'aws_cognito_user_pool.other', type: 'aws_cognito_user_pool', values: { name: 'other', tags: { [TAG]: 'apiable-other-pool' } } })
    const result = gateOf(cfnCognitoStack(), cfnCognitoStack(), tfTwoPool)
    expect(result.passed).toBe(false)
    const divergence = divergenceOn(result, 'graph', 'bound-to-pool')
    expect(divergence).toBeDefined()
  })

  // contract: S4 — a conformant authorization-code client is not false-failed; a bad flow still is (M7, fail-CLOSED fix)
  it('S4: an authorization-code client in the platform native spelling is accepted as conformant (not false-failed); an unregistered flow is still flagged', () => {
    // Cognito's native `code` flow must be accepted as the authorization-code grant — not false-FAILed.
    const conformant = gateOf(cfnCognitoStack({ clientFlows: ['code'] }), cfnCognitoStack({ clientFlows: ['code'] }), tfCognitoStack({ clientFlows: ['code'] }))
    expect(conformant.passed).toBe(true)
    expect(conformant.divergences.find((entry) => entry.tier === 'oauth')).toBeUndefined()

    // A genuinely unregistered flow is still flagged non-conformant on every channel.
    const bad = gateOf(cfnCognitoStack({ clientFlows: ['magic_link'] }), cfnCognitoStack({ clientFlows: ['magic_link'] }), tfCognitoStack({ clientFlows: ['magic_link'] }))
    expect(bad.passed).toBe(false)
    expect(bad.divergences.some((entry) => entry.tier === 'oauth' && entry.detail.includes('magic_link'))).toBe(true)
  })

  // contract: S5 — discovery checked the right way per client type (M4, re-cut): an interactive client must
  // publish endpoints; a machine-to-machine / domainless pool is conformant WITHOUT them; a divergent
  // endpoint across channels fails parity.
  it('S5: discovery is derived for the real channels and checked per client type — interactive must publish endpoints, a domainless machine pool is conformant, a divergent endpoint fails parity', () => {
    // (a) The discovery document is derived for the real interactive client from the pool id + region + domain.
    const cdkModel = reduceCloudFormation(cfnCognitoStack(), 'cdk', REGION)
    const clientOauth = Object.values(cdkModel.oauthByClient ?? {})[0]
    expect(clientOauth?.discovery?.issuer).toBe(ISSUER)
    expect(clientOauth?.discovery?.authorizationEndpoint).toBe(`https://authz-portal.auth.${REGION}.amazoncognito.com/oauth2/authorize`)
    expect(clientOauth?.discovery?.tokenEndpoint).toBe(`https://authz-portal.auth.${REGION}.amazoncognito.com/oauth2/token`)

    // (b) [M4 fix] A domainless pool whose only client is machine-to-machine (client-credentials) is
    // conformant WITHOUT hosted-UI sign-in/token endpoints — it is NOT false-failed for lacking them.
    const machine = gateOf(
      cfnCognitoStack({ clientFlows: ['client_credentials'], withDomain: false }),
      cfnCognitoStack({ clientFlows: ['client_credentials'], withDomain: false }),
      tfCognitoStack({ clientFlows: ['client_credentials'], withDomain: false }),
    )
    expect(machine.passed).toBe(true)
    expect(machine.divergences.find((entry) => entry.tier === 'oauth')).toBeUndefined()

    // (c) [M4 guard] An INTERACTIVE (authorization-code) client whose channels omit the hosted-UI domain is
    // still reported non-conformant — the carve-out is gated on flow type, not blanket-removed.
    const interactiveNoDomain = gateOf(
      cfnCognitoStack({ clientFlows: ['code'], withDomain: false }),
      cfnCognitoStack({ clientFlows: ['code'], withDomain: false }),
      tfCognitoStack({ clientFlows: ['code'], withDomain: false }),
    )
    expect(interactiveNoDomain.passed).toBe(false)
    expect(interactiveNoDomain.divergences.some((entry) => entry.tier === 'oauth')).toBe(true)

    // (d) [DISC] CDK + CFN mint/redeem tokens at `authz-portal`; the Terraform module at `evil-portal`.
    // The discovery endpoints are compared CROSS-channel, so the divergent host FAILS parity.
    const divergentEndpoint = gateOf(cfnCognitoStack(), cfnCognitoStack(), tfCognitoStack({ domain: 'evil-portal' }))
    expect(divergentEndpoint.passed).toBe(false)
    expect(divergenceOn(divergentEndpoint, 'value', 'oauth-discovery-authorize')).toBeDefined()
    expect(divergenceOn(divergentEndpoint, 'value', 'oauth-discovery-token')).toBeDefined()
  })

  // contract: S6 — the Terraform channel is regenerated, not diffed against a stale snapshot (F1)
  it('S6: the committed Terraform description is reduced to a model and a fresh regenerated plan reduces to the SAME model (by meaning, not byte-diff)', () => {
    // The committed fixture is the reference. A freshly regenerated plan (here: the same plan with
    // churned tf/provider metadata + reordered resources) must reduce to the same model — by meaning,
    // never byte-for-byte — so a stale committed fixture cannot let the only independent channel pass.
    const committed = tfCognitoStack()
    const regenerated = JSON.parse(JSON.stringify(committed)) as {
      format_version?: string
      terraform_version?: string
      planned_values: { root_module: { resources: unknown[] } }
    }
    regenerated.format_version = '1.2'
    regenerated.terraform_version = '1.99.0-churn'
    regenerated.planned_values.root_module.resources = [...regenerated.planned_values.root_module.resources].reverse()

    const committedModel = reduceTerraformShowJson(committed, 'terraform', REGION)
    const regeneratedModel = reduceTerraformShowJson(regenerated, 'terraform', REGION)
    // Reduce-to-the-same-model: the meaning is identical despite the byte churn + reordering.
    expect(regeneratedModel.values).toEqual(committedModel.values)
    expect([...regeneratedModel.graph.nodes].sort((a, b) => a.ref.localeCompare(b.ref))).toEqual(
      [...committedModel.graph.nodes].sort((a, b) => a.ref.localeCompare(b.ref)),
    )
    expect([...regeneratedModel.graph.edges].map((edge) => `${edge.from}-${edge.relation}->${edge.to}`).sort()).toEqual(
      [...committedModel.graph.edges].map((edge) => `${edge.from}-${edge.relation}->${edge.to}`).sort(),
    )
    // A genuinely stale fixture (a dropped scope) does NOT reduce to the regenerated model.
    const staleModel = reduceTerraformShowJson(tfCognitoStack({ scopes: ['read'] }), 'terraform', REGION)
    expect(staleModel.values).not.toEqual(committedModel.values)
  })

  // contract: S7 — order-independent verdict; an incomplete channel set does not pass (determinism)
  it('S7: an incomplete channel set does not pass vacuously, multiple OAuth clients are all compared, and explicit-vs-default does not false-FAIL', () => {
    // An incomplete channel set (only one channel present) must NOT pass vacuously.
    const onlyOne = gate([reduceCloudFormation(cfnCognitoStack(), 'cdk', REGION)])
    expect(onlyOne.passed).toBe(false)

    // The verdict does not flip on channel ordering.
    const ordered = gateOf(cfnCognitoStack(), cfnCognitoStack(), tfCognitoStack())
    const reordered = gate([
      reduceTerraformShowJson(tfCognitoStack(), 'terraform', REGION),
      reduceCloudFormation(cfnCognitoStack(), 'cfn', REGION),
      reduceCloudFormation(cfnCognitoStack(), 'cdk', REGION),
    ])
    expect(reordered.passed).toBe(ordered.passed)
    expect(ordered.passed).toBe(true)

    // A second OAuth client carrying an unregistered flow must NOT be lost to a single OAuth slot.
    const twoClientCfn = cfnCognitoStack() as { Resources: Record<string, unknown> }
    twoClientCfn.Resources.SecondClient = {
      Type: 'AWS::Cognito::UserPoolClient',
      Properties: { ClientName: 'second-client', UserPoolId: { Ref: 'AuthzPool' }, AllowedOAuthFlows: ['magic_link'], AllowedOAuthScopes: ['apiable/read'] },
    }
    const multiClient = gate([reduceCloudFormation(twoClientCfn, 'cdk', REGION), reduceCloudFormation(twoClientCfn, 'cfn', REGION), reduceCloudFormation(twoClientCfn, 'terraform', REGION)])
    expect(multiClient.divergences.some((entry) => entry.tier === 'oauth' && entry.detail.includes('magic_link'))).toBe(true)

    // [OBC] Two clients sharing one name must BOTH be conformance-checked — the first's unregistered
    // flow is not swallowed by the second (the per-client map is keyed by channel-local id, not the
    // de-duplicating node ref). The bad flow surfaces on the oauth tier, not only as a name collision.
    const sameNamedClients: unknown = {
      Resources: {
        AuthzPool: { Type: 'AWS::Cognito::UserPool', Properties: { UserPoolName: 'authz', UserPoolTags: { [TAG]: AUTHZ_POOL } } },
        ClientOne: { Type: 'AWS::Cognito::UserPoolClient', Properties: { ClientName: 'dup', UserPoolId: { Ref: 'AuthzPool' }, AllowedOAuthFlows: ['magic_link'], AllowedOAuthScopes: ['apiable/read'] } },
        ClientTwo: { Type: 'AWS::Cognito::UserPoolClient', Properties: { ClientName: 'dup', UserPoolId: { Ref: 'AuthzPool' }, AllowedOAuthFlows: ['client_credentials'], AllowedOAuthScopes: ['apiable/read'] } },
      },
    }
    const obc = gate([reduceCloudFormation(sameNamedClients, 'cdk', REGION), reduceCloudFormation(sameNamedClients, 'cfn', REGION), reduceCloudFormation(sameNamedClients, 'terraform', REGION)])
    expect(obc.divergences.some((entry) => entry.tier === 'oauth' && entry.detail.includes('magic_link'))).toBe(true)

    // An explicit generate-secret=false in one channel vs an omitted default in another must NOT diverge.
    const explicitFalseCfn = cfnCognitoStack() as { Resources: Record<string, { Properties?: Record<string, unknown> }> }
    if (explicitFalseCfn.Resources.AuthzClient.Properties !== undefined) explicitFalseCfn.Resources.AuthzClient.Properties.GenerateSecret = false
    const tfOmitted = tfCognitoStack() as { planned_values: { root_module: { resources: { type: string; values: Record<string, unknown> }[] } } }
    const tfClient = tfOmitted.planned_values.root_module.resources.find((resource) => resource.type === 'aws_cognito_user_pool_client')
    if (tfClient !== undefined) delete tfClient.values.generate_secret
    const secretResult = gate([reduceCloudFormation(explicitFalseCfn, 'cdk', REGION), reduceCloudFormation(explicitFalseCfn, 'cfn', REGION), reduceTerraformShowJson(tfOmitted, 'terraform', REGION)])
    expect(divergenceOn(secretResult, 'value', 'generate-secret')).toBeUndefined()
  })

  // contract: S8 — existing verdicts unchanged (regression)
  it('S8: the gateway access-role pilot + sibling tiers keep their verdicts after the modelling changes — no new false alarm, no newly-missed divergence', () => {
    const REPO_ROOT = path.resolve(__dirname, '..')
    const tfFixture = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'test/fixtures/parity-gate/terraform-gateway-role-show.json'), 'utf8'))
    const pilotTf = reduceTerraformShowJson(tfFixture, 'terraform', REGION)
    // The role-pilot terraform channel still reduces to a well-formed model with its trust row intact,
    // keyed by the role's author-declared id (the channel-stable identity the gate compares by).
    expect(pilotTf.wellFormed).toBe(true)
    expect(pilotTf.values['role-trust-account:iam-role:apiable-gateway-role']).toBe('034444869755')

    // A genuine single-channel trust divergence is still caught (not newly missed) on a role artifact.
    const role = (account: string): unknown => ({
      Resources: {
        Role: {
          Type: 'AWS::IAM::Role',
          Properties: { RoleName: 'apiable-managed-role', AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${account}:root` }, Action: 'sts:AssumeRole' }] } },
        },
      },
    })
    const caught = gateOf(role('034444869755'), role('034444869755'), { planned_values: { root_module: { resources: [{ address: 'aws_iam_role.this', type: 'aws_iam_role', values: { name: 'apiable-managed-role', assume_role_policy: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::999988887777:root' }, Action: 'sts:AssumeRole' }] }) } }] } }, configuration: { root_module: { resources: [], outputs: {} } } })
    expect(caught.passed).toBe(false)
    expect(divergenceOn(caught, 'value', 'role-trust-account')?.channels).toEqual(['terraform'])
  })
})
