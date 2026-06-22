/**
 * Acceptance specs — Story 013-1-20: harden the parity gate's cognito modelling surface + suite reliability.
 * Frozen contract: contract-013-1-20-parity-gate-cognito-surface-hardening.md
 *
 * One un-skipped spec per contract scenario (S1–S6), each driving the real reducers + gate against
 * faithful synthetic cognito artifacts. Extends the 1-16 harness shapes (a user pool carrying its
 * declared id, the pre-token function, a hosted-UI domain, a resource-server, an OAuth client) rather
 * than re-rolling the builders.
 *
 * NEW-1 scope (deferred, contract S1/S2): the domain is compared CHANNEL-IDENTICAL and a substituted
 * token-minting host stays caught by value; the same-tenant-different-rendering equivalence is deferred
 * to 013-1-7/1-8 (no published cognito template to ground-truth). No equivalence-normalisation here.
 */
import { gate, reduceCloudFormation, reduceTerraformShowJson, NO_HOSTED_DOMAIN } from '@apiable/parity-gate'

const REGION = 'eu-central-1'
const TAG = 'apiable:logical-id'
const AUTHZ_POOL = 'apiable-authz-pool'
const PRE_TOKEN_FN = 'apiable-pretoken-fn'

interface CognitoShape {
  readonly withDomain?: boolean
  readonly domain?: string
  readonly lambdaTagged?: boolean // whether the pre-token function carries its declared-id tag
  readonly literalPoolId?: string // a resource-server bound by an inlined literal pool id instead of a ref
}

/** A faithful cognito authorization stack as CloudFormation (the CDK + CFN channels share this reducer). */
const cfnCognitoStack = (shape: CognitoShape = {}): unknown => {
  const domain = shape.domain ?? 'authz-portal'
  const lambdaTags = shape.lambdaTagged === false ? {} : { Tags: [{ Key: TAG, Value: PRE_TOKEN_FN }] }
  const resourceServerPool = shape.literalPoolId !== undefined ? shape.literalPoolId : { Ref: 'AuthzPool' }
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
      PreTokenFn: { Type: 'AWS::Lambda::Function', Properties: { FunctionName: 'pretokengen', Runtime: 'nodejs20.x', ...lambdaTags } },
      ...(shape.withDomain === false
        ? {}
        : { AuthzDomain: { Type: 'AWS::Cognito::UserPoolDomain', Properties: { Domain: domain, UserPoolId: { Ref: 'AuthzPool' } } } }),
      AuthzResourceServer: {
        Type: 'AWS::Cognito::UserPoolResourceServer',
        Properties: {
          Identifier: 'apiable',
          Name: 'apiable',
          UserPoolId: resourceServerPool,
          Scopes: [{ ScopeName: 'read', ScopeDescription: 'read access' }],
        },
      },
      AuthzClient: {
        Type: 'AWS::Cognito::UserPoolClient',
        Properties: { ClientName: 'authz-client', UserPoolId: { Ref: 'AuthzPool' }, AllowedOAuthFlows: ['code'], AllowedOAuthScopes: ['apiable/read'], GenerateSecret: true },
      },
    },
  }
}

const tfRef = (target: string): { references: string[] } => ({ references: [`${target}.arn`, target] })

/** The equivalent cognito stack as `terraform show -json`. */
const tfCognitoStack = (shape: CognitoShape = {}): unknown => {
  const domain = shape.domain ?? 'authz-portal'
  const lambdaTags = shape.lambdaTagged === false ? {} : { tags: { [TAG]: PRE_TOKEN_FN } }
  const literalPoolBinding = shape.literalPoolId !== undefined
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
    { address: 'aws_lambda_function.pretokengen', type: 'aws_lambda_function', values: { function_name: 'pretokengen', runtime: 'nodejs20.x', ...lambdaTags } },
    ...(shape.withDomain === false ? [] : [{ address: 'aws_cognito_user_pool_domain.authz', type: 'aws_cognito_user_pool_domain', values: { domain } }]),
    {
      address: 'aws_cognito_resource_server.authz',
      type: 'aws_cognito_resource_server',
      values: { identifier: 'apiable', name: 'apiable', scope: [{ scope_name: 'read', scope_description: 'read access' }], ...(literalPoolBinding ? { user_pool_id: shape.literalPoolId } : {}) },
    },
    {
      address: 'aws_cognito_user_pool_client.authz',
      type: 'aws_cognito_user_pool_client',
      values: { name: 'authz-client', allowed_oauth_flows: ['code'], allowed_oauth_scopes: ['apiable/read'], generate_secret: true },
    },
  ]
  const config = [
    { address: 'aws_cognito_user_pool.authz', type: 'aws_cognito_user_pool', expressions: { lambda_config: [{ pre_token_generation_config: [{ lambda_arn: tfRef('aws_lambda_function.pretokengen') }] }] } },
    ...(shape.withDomain === false ? [] : [{ address: 'aws_cognito_user_pool_domain.authz', type: 'aws_cognito_user_pool_domain', expressions: { user_pool_id: tfRef('aws_cognito_user_pool.authz') } }]),
    // A literal-bound resource-server carries no user_pool_id reference expression — only the planned literal value.
    ...(literalPoolBinding ? [] : [{ address: 'aws_cognito_resource_server.authz', type: 'aws_cognito_resource_server', expressions: { user_pool_id: tfRef('aws_cognito_user_pool.authz') } }]),
    { address: 'aws_cognito_user_pool_client.authz', type: 'aws_cognito_user_pool_client', expressions: { user_pool_id: tfRef('aws_cognito_user_pool.authz') } },
  ]
  return { planned_values: { root_module: { resources: planned } }, configuration: { root_module: { resources: config, outputs: {} } } }
}

const gateOf = (cdk: unknown, cfn: unknown, terraformPlan: unknown): ReturnType<typeof gate> =>
  gate([
    reduceCloudFormation(cdk, 'cdk', REGION),
    reduceCloudFormation(cfn, 'cfn', REGION),
    reduceTerraformShowJson(terraformPlan, 'terraform', REGION),
  ])

const divergenceOn = (result: ReturnType<typeof gate>, tier: string, fragment: string) =>
  result.divergences.find((entry) => entry.tier === tier && entry.detail.includes(fragment))

describe('013-1-20 parity check — cognito surface hardening', () => {
  // contract: S1 — an identical hosted sign-in domain reconciles across all three channels (no false-FAIL)
  it('S1: a user pool whose hosted sign-in domain is identical across package/one-click/terraform → parity holds (an equivalent domain is not a divergence)', () => {
    const result = gateOf(cfnCognitoStack(), cfnCognitoStack(), tfCognitoStack())
    expect(result.passed).toBe(true)
    expect(result.divergences).toEqual([])
  })

  // contract: S2 — a substituted token-minting host is caught BY VALUE (FORCING — NEW-1 security floor)
  it('S2: two channels whose hosted sign-in domain resolves to a DIFFERENT host → the check FAILS on BOTH the authorize and the token discovery endpoints (a substituted token-minting host can never pass; the evil-portal regression stays caught)', () => {
    const divergentEndpoint = gateOf(cfnCognitoStack(), cfnCognitoStack(), tfCognitoStack({ domain: 'evil-portal' }))
    expect(divergentEndpoint.passed).toBe(false)
    expect(divergenceOn(divergentEndpoint, 'value', 'oauth-discovery-authorize')?.channels).toEqual(['terraform'])
    expect(divergenceOn(divergentEndpoint, 'value', 'oauth-discovery-token')?.channels).toEqual(['terraform'])
  })

  // contract: S3 — a tag-less pre-token function surfaces a clean missing-id divergence (FORCING — NEW-2/F-C)
  it('S3: the pre-token function carries its declared identity in one channel but is tag-less in another → an explicit missing-declared-identity divergence on that function (NOT a silent fallback to its tenant-scoped name); both tagged → one node ref', () => {
    // Tagged in CDK + CFN, tag-less in Terraform → the function has no channel-stable identity in TF, so
    // it surfaces an explicit missing-declared-identity graph divergence rather than falling back to its name.
    const tagless = gateOf(cfnCognitoStack(), cfnCognitoStack(), tfCognitoStack({ lambdaTagged: false }))
    expect(tagless.passed).toBe(false)
    expect(divergenceOn(tagless, 'graph', 'no-declared-logical-id')).toBeDefined()

    // Both channels tagged → the function reconciles to a single node ref (no divergence on the function).
    const bothTagged = gateOf(cfnCognitoStack(), cfnCognitoStack(), tfCognitoStack())
    expect(bothTagged.divergences.find((entry) => entry.detail.includes('lambda-function'))).toBeUndefined()
  })

  // contract: S4 — both reducers emit the same discovery fact set for an equivalent domained pool (F-F)
  it('S4: one equivalent domained pool reduced through both channels → identical set of discovery facts (no present-vs-absent asymmetry; an unresolved fact emitted as an explicit "none" sentinel, never omitted)', () => {
    const discoveryKeys = (model: ReturnType<typeof reduceCloudFormation>): string[] =>
      Object.keys(model.values).filter((key) => key.startsWith('oauth-discovery-')).sort()

    // A domained pool: the CFN and TF reducers (which resolve the domain by structurally different paths)
    // emit the SAME set of discovery keys, so the cross-channel comparison is present-vs-present.
    const cfnDomained = reduceCloudFormation(cfnCognitoStack(), 'cfn', REGION)
    const tfDomained = reduceTerraformShowJson(tfCognitoStack(), 'terraform', REGION)
    expect(discoveryKeys(tfDomained)).toEqual(discoveryKeys(cfnDomained))
    expect(discoveryKeys(cfnDomained)).toContain('oauth-discovery-authorize:cognito-user-pool:apiable-authz-pool')

    // A domainless pool still emits the authorize/token rows — as the explicit "none" sentinel, not omitted —
    // so the key set is identical to the domained one and a present-vs-absent asymmetry can never arise.
    const cfnDomainless = reduceCloudFormation(cfnCognitoStack({ withDomain: false }), 'cfn', REGION)
    const tfDomainless = reduceTerraformShowJson(tfCognitoStack({ withDomain: false }), 'terraform', REGION)
    expect(discoveryKeys(cfnDomainless)).toEqual(discoveryKeys(cfnDomained))
    expect(discoveryKeys(tfDomainless)).toEqual(discoveryKeys(cfnDomained))
    expect(cfnDomainless.values['oauth-discovery-authorize:cognito-user-pool:apiable-authz-pool']).toBe(NO_HOSTED_DOMAIN)
    // Two equivalent domainless channels carrying the sentinel reconcile (no false-FAIL on the value tier).
    const domainless = gateOf(cfnCognitoStack({ withDomain: false }), cfnCognitoStack({ withDomain: false }), tfCognitoStack({ withDomain: false }))
    expect(divergenceOn(domainless, 'value', 'oauth-discovery')).toBeUndefined()
  })

  // contract: S5 — a resource server bound by a literal pool id anchors to the same pool as a ref-bound one (F-G)
  it('S5: a resource server bound to the same pool by reference in one channel and by an inlined literal pool id in another → the same pool anchor (no phantom divergence from the literal binding being treated as a bare ref)', () => {
    // CDK + CFN bind the resource-server to AuthzPool by reference; the Terraform channel inlines the pool's
    // literal id (the same value the pool's declared id resolves to). The resource-server must anchor to the
    // SAME pool ref in all three — no phantom graph divergence from the literal binding dropping the anchor.
    const referenced = reduceCloudFormation(cfnCognitoStack(), 'cfn', REGION)
    const refServerNode = referenced.graph.nodes.find((node) => node.kind === 'cognito-resource-server')
    expect(refServerNode?.ref).toBe(`cognito-resource-server:of-pool:${AUTHZ_POOL}:apiable`)

    const result = gateOf(cfnCognitoStack(), cfnCognitoStack(), tfCognitoStack({ literalPoolId: AUTHZ_POOL }))
    expect(divergenceOn(result, 'graph', 'cognito-resource-server')).toBeUndefined()
  })

  // contract: S6 — the gate's own verification suite returns a stable verdict on every run (F-E reliability)
  it('S6: a pure fixture→gate() verdict is identical on every run under the configured runner (no intermittent red on equivalent literal inputs)', () => {
    // The pinned-runner determinism is enforced by jest.config.js (maxWorkers + isolatedModules); this spec
    // asserts the gate itself is referentially stable — the same literal inputs produce the same verdict and
    // the same divergence set every time, so a green is never a coin-flip of worker scheduling.
    const verdicts = Array.from({ length: 20 }, () => {
      const result = gateOf(cfnCognitoStack(), cfnCognitoStack(), tfCognitoStack({ domain: 'evil-portal' }))
      return { passed: result.passed, divergences: result.divergences.map((entry) => `${entry.tier}:${entry.detail}`).sort() }
    })
    const first = verdicts[0]
    expect(first.passed).toBe(false)
    for (const verdict of verdicts) expect(verdict).toEqual(first)
  })
})
