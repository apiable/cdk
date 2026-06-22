/**
 * Test automation (TA) — Story 013-1-20: edge & error paths beyond the frozen acceptance specs for the
 * hardened cognito surface. Strengthens the gate against the fail-OPEN directions the hardening could
 * have opened: the lambda-enforcement gap in the other leg, the discovery sentinel collapsing a real
 * divergence, and the literal-pool anchor coinciding two genuinely different pools.
 */
import { reduceCloudFormation, reduceTerraformShowJson, gate, NO_HOSTED_DOMAIN } from '@apiable/parity-gate'

const REGION = 'eu-central-1'
const TAG = 'apiable:logical-id'
const POOL_ID = 'apiable-authz-pool'
const FN_ID = 'apiable-pretoken-fn'

// ── lambda-function declared-id enforcement (T2 / NEW-2) ───────────────────────────────────────

describe('cognito surface (TA) — pre-token lambda declared-id enforcement', () => {
  const cfnPoolWithFn = (fnTagged: boolean): unknown => ({
    Resources: {
      Pool: { Type: 'AWS::Cognito::UserPool', Properties: { UserPoolName: 'authz', UserPoolTags: { [TAG]: POOL_ID }, LambdaConfig: { PreTokenGeneration: { 'Fn::GetAtt': ['Fn', 'Arn'] } } } },
      Fn: { Type: 'AWS::Lambda::Function', Properties: { FunctionName: 'pretokengen', ...(fnTagged ? { Tags: [{ Key: TAG, Value: FN_ID }] } : {}) } },
    },
  })

  it('keys a tagged pre-token function by its declared id, not its tenant-scoped name', () => {
    const model = reduceCloudFormation(cfnPoolWithFn(true), 'cfn', REGION)
    expect(model.graph.nodes.some((node) => node.ref === `lambda-function:${FN_ID}`)).toBe(true)
    expect(model.graph.nodes.some((node) => node.ref === 'lambda-function:pretokengen')).toBe(false)
  })

  it('surfaces a tag-less pre-token function as a missing-declared-id node, not a silent name fallback (the other leg: tag-less in CFN, tagged in TF)', () => {
    // The CFN/CDK channels are tag-less, the Terraform channel tagged — the mirror of the S3 acceptance
    // fixture, so the enforcement gap cannot hide in whichever leg the acceptance spec did not exercise.
    const tfTagged: unknown = {
      planned_values: { root_module: { resources: [
        { address: 'aws_cognito_user_pool.authz', type: 'aws_cognito_user_pool', values: { name: 'authz', tags: { [TAG]: POOL_ID }, lambda_config: [{ pre_token_generation: 'arn:aws:lambda:eu-central-1:034444869755:function:pretokengen' }] } },
        { address: 'aws_lambda_function.pretokengen', type: 'aws_lambda_function', values: { function_name: 'pretokengen', tags: { [TAG]: FN_ID } } },
      ] } },
      configuration: { root_module: { resources: [
        { address: 'aws_cognito_user_pool.authz', type: 'aws_cognito_user_pool', expressions: { lambda_config: [{ pre_token_generation: { references: ['aws_lambda_function.pretokengen.arn', 'aws_lambda_function.pretokengen'] } }] } },
      ], outputs: {} } },
    }
    const result = gate([
      reduceCloudFormation(cfnPoolWithFn(false), 'cdk', REGION),
      reduceCloudFormation(cfnPoolWithFn(false), 'cfn', REGION),
      reduceTerraformShowJson(tfTagged, 'terraform', REGION),
    ])
    expect(result.passed).toBe(false)
    expect(result.divergences.some((entry) => entry.tier === 'graph' && entry.detail.includes('no-declared-logical-id'))).toBe(true)
  })
})

// ── discovery sentinel must not collapse a real domain divergence (T3 / F-F fail-CLOSED guard) ──

describe('cognito surface (TA) — discovery sentinel boundary', () => {
  const cfnPool = (withDomain: boolean): unknown => ({
    Resources: {
      Pool: { Type: 'AWS::Cognito::UserPool', Properties: { UserPoolName: 'authz', UserPoolTags: { [TAG]: POOL_ID } } },
      ...(withDomain ? { Domain: { Type: 'AWS::Cognito::UserPoolDomain', Properties: { Domain: 'authz-portal', UserPoolId: { Ref: 'Pool' } } } } : {}),
    },
  })

  it('FAILS when one channel publishes a hosted domain and another does not — the {none} sentinel is not equal to a real host', () => {
    const result = gate([
      reduceCloudFormation(cfnPool(true), 'cdk', REGION),
      reduceCloudFormation(cfnPool(true), 'cfn', REGION),
      reduceCloudFormation(cfnPool(false), 'terraform', REGION),
    ])
    expect(result.passed).toBe(false)
    const authorize = result.divergences.find((entry) => entry.tier === 'value' && entry.detail.includes('oauth-discovery-authorize'))
    expect(authorize?.channels).toEqual(['terraform'])
    // The divergence is a real host vs the sentinel, never a present-vs-absent presence vote.
    expect(authorize?.detail).toContain(NO_HOSTED_DOMAIN)
    expect(authorize?.detail).toContain('authz-portal')
  })

  it('emits the issuer and jwks rows by value for every pool, domained or not (always present, never the sentinel)', () => {
    const domainless = reduceCloudFormation(cfnPool(false), 'cfn', REGION)
    expect(domainless.values[`oauth-discovery-issuer:cognito-user-pool:${POOL_ID}`]).toContain('cognito-idp')
    expect(domainless.values[`oauth-discovery-jwks:cognito-user-pool:${POOL_ID}`]).toContain('jwks.json')
    expect(domainless.values[`oauth-discovery-issuer:cognito-user-pool:${POOL_ID}`]).not.toBe(NO_HOSTED_DOMAIN)
  })
})

// ── literal-pool anchor must not coincide two genuinely different pools (T4 / F-G fail-CLOSED guard) ──

describe('cognito surface (TA) — literal-pool anchor boundary', () => {
  const tfResourceServer = (literalPoolId: string): unknown => ({
    planned_values: { root_module: { resources: [
      { address: 'aws_cognito_resource_server.rs', type: 'aws_cognito_resource_server', values: { identifier: 'apiable', name: 'apiable', user_pool_id: literalPoolId, scope: [{ scope_name: 'read' }] } },
    ] } },
    configuration: { root_module: { resources: [], outputs: {} } },
  })

  it('anchors a literal-bound resource-server to the literal pool discriminator (not a bare ref)', () => {
    const model = reduceTerraformShowJson(tfResourceServer(POOL_ID), 'terraform', REGION)
    expect(model.graph.nodes.some((node) => node.ref === `cognito-resource-server:of-pool:${POOL_ID}:apiable`)).toBe(true)
    expect(model.graph.nodes.some((node) => node.ref === 'cognito-resource-server:apiable')).toBe(false)
  })

  it('keeps two resource-servers on DIFFERENT literal pools as distinct anchors — a genuine cross-pool difference is not collapsed', () => {
    const onPoolA = reduceTerraformShowJson(tfResourceServer(POOL_ID), 'terraform', REGION)
    const onPoolB = reduceTerraformShowJson(tfResourceServer('apiable-other-pool'), 'terraform', REGION)
    const refA = onPoolA.graph.nodes.find((node) => node.kind === 'cognito-resource-server')?.ref
    const refB = onPoolB.graph.nodes.find((node) => node.kind === 'cognito-resource-server')?.ref
    expect(refA).not.toEqual(refB)
  })

  it('FAILS when a literal-bound resource-server names a different pool than a reference-bound one in another channel', () => {
    // CDK/CFN reference Pool (declared id apiable-authz-pool); Terraform inlines a DIFFERENT literal pool id.
    const cfnRefBound: unknown = {
      Resources: {
        Pool: { Type: 'AWS::Cognito::UserPool', Properties: { UserPoolName: 'authz', UserPoolTags: { [TAG]: POOL_ID } } },
        RS: { Type: 'AWS::Cognito::UserPoolResourceServer', Properties: { Identifier: 'apiable', Name: 'apiable', UserPoolId: { Ref: 'Pool' }, Scopes: [{ ScopeName: 'read' }] } },
      },
    }
    const result = gate([
      reduceCloudFormation(cfnRefBound, 'cdk', REGION),
      reduceCloudFormation(cfnRefBound, 'cfn', REGION),
      reduceTerraformShowJson(tfResourceServer('apiable-other-pool'), 'terraform', REGION),
    ])
    expect(result.passed).toBe(false)
    expect(result.divergences.some((entry) => entry.tier === 'graph' && entry.detail.includes('cognito-resource-server'))).toBe(true)
  })
})
