/**
 * TA (013-1-23) — edge/boundary coverage for the real-channel reconciliation helpers introduced to wire
 * the cognito + authorizer channels through the parity gate, beyond the governed S1–S6 scenarios. Focus:
 * the fail-CLOSED boundaries of the new tenant-token canonicalisations (the security floor must not widen).
 *
 * These exercise the reducers + gate against faithful synthetic cognito/authorizer artifacts (the 1-16/1-20
 * harness shape), so a boundary that the real published templates happen not to hit is still pinned.
 */
import { gate, reduceCloudFormation, reduceTerraformShowJson, HOSTED_DOMAIN_TENANT_TOKEN } from '@apiable/parity-gate'

const REGION = 'eu-central-1'
const TAG = 'apiable:logical-id'
const POOL_ID = 'apiable-authz-pool'

// ── hosted-domain canonicalisation boundaries (NEW-1 floor) ──────────────────────────────────────

interface DomainShape {
  readonly cfnDomain: unknown
  readonly tfDomain: string
  readonly tfBoundToTenantVar: boolean
}

const cfnPool = (domain: unknown): unknown => ({
  Resources: {
    Pool: { Type: 'AWS::Cognito::UserPool', Properties: { UserPoolName: 'authz', UserPoolTags: { [TAG]: POOL_ID } } },
    Domain: { Type: 'AWS::Cognito::UserPoolDomain', Properties: { Domain: domain, UserPoolId: { Ref: 'Pool' } } },
  },
})

const tfPool = (domain: string, boundToTenantVar: boolean): unknown => ({
  planned_values: {
    root_module: {
      resources: [
        { address: 'aws_cognito_user_pool.authz', type: 'aws_cognito_user_pool', values: { name: 'authz', tags: { [TAG]: POOL_ID } } },
        { address: 'aws_cognito_user_pool_domain.authz', type: 'aws_cognito_user_pool_domain', values: { domain } },
      ],
    },
  },
  configuration: {
    root_module: {
      resources: [
        {
          address: 'aws_cognito_user_pool_domain.authz',
          type: 'aws_cognito_user_pool_domain',
          expressions: {
            user_pool_id: { references: ['aws_cognito_user_pool.authz.id', 'aws_cognito_user_pool.authz'] },
            domain: boundToTenantVar ? { references: ['var.name'] } : { references: [] },
          },
        },
      ],
      outputs: {},
    },
  },
})

const authorizeRow = (model: ReturnType<typeof reduceCloudFormation>): string | undefined => model.values[`oauth-discovery-authorize:cognito-user-pool:${POOL_ID}`]

const cfnJoinDomain = { 'Fn::Join': ['', ['apiable-', { Ref: 'TenantName' }]] }

describe('013-1-23 TA — hosted-domain canonicalisation boundaries (NEW-1 floor)', () => {
  it('the conventional apiable-<tenant> domain canonicalises to the shared token on BOTH channels (CFN Fn::Join + TF literal bound to var.name)', () => {
    const cfn = reduceCloudFormation(cfnPool(cfnJoinDomain), 'cfn', REGION)
    const tf = reduceTerraformShowJson(tfPool('apiable-staging', true), 'terraform', REGION)
    expect(authorizeRow(cfn)).toContain(HOSTED_DOMAIN_TENANT_TOKEN)
    expect(authorizeRow(tf)).toContain(HOSTED_DOMAIN_TENANT_TOKEN)
    expect(authorizeRow(cfn)).toBe(authorizeRow(tf))
  })

  it('a TF domain that is apiable-prefixed but NOT bound to the tenant input does not get the token (fail-closed: an unwitnessed literal keeps its identity)', () => {
    // A hand-rolled module hardcoding `apiable-evil` without wiring var.name is not the conventional
    // deploy-time tenant rendering, so it must NOT be collapsed — it keeps its literal and can diverge.
    const tf = reduceTerraformShowJson(tfPool('apiable-evil', false), 'terraform', REGION)
    expect(authorizeRow(tf)).not.toContain(HOSTED_DOMAIN_TENANT_TOKEN)
    expect(authorizeRow(tf)).toContain('apiable-evil')
  })

  it('a substituted non-apiable host (bound to var.name or not) stays a literal and FAILS the gate on both discovery endpoints', () => {
    // The same tenant on CFN, a substituted token-minting host on TF → the discovery endpoints diverge.
    for (const boundToVar of [true, false]) {
      const result = gate([
        reduceCloudFormation(cfnPool(cfnJoinDomain), 'cdk', REGION),
        reduceCloudFormation(cfnPool(cfnJoinDomain), 'cfn', REGION),
        reduceTerraformShowJson(tfPool('evil-portal', boundToVar), 'terraform', REGION),
      ])
      expect(result.passed).toBe(false)
      expect(result.divergences.find((e) => e.tier === 'value' && e.detail.includes('oauth-discovery-authorize'))?.channels).toEqual(['terraform'])
      expect(result.divergences.find((e) => e.tier === 'value' && e.detail.includes('oauth-discovery-token'))?.channels).toEqual(['terraform'])
    }
  })

  it('two channels both rendering the conventional domain (one via Fn::Join, one via the literal) reconcile — no false-FAIL', () => {
    const result = gate([
      reduceCloudFormation(cfnPool(cfnJoinDomain), 'cdk', REGION),
      reduceCloudFormation(cfnPool(cfnJoinDomain), 'cfn', REGION),
      reduceTerraformShowJson(tfPool('apiable-staging', true), 'terraform', REGION),
    ])
    expect(result.divergences.find((e) => e.detail.includes('oauth-discovery'))).toBeUndefined()
  })
})

// ── authorizer tenant-name canonicalisation boundaries ───────────────────────────────────────────

const cfnAuthorizer = (name: unknown): unknown => ({
  Resources: {
    Authorizer: {
      Type: 'AWS::ApiGateway::Authorizer',
      Properties: { Name: name, Type: 'TOKEN', IdentitySource: 'method.request.header.Authorization', RestApiId: { Ref: 'RestApiId' } },
    },
  },
})

const tfAuthorizer = (name: string): unknown => ({
  planned_values: {
    root_module: {
      resources: [
        {
          address: 'aws_api_gateway_authorizer.authz',
          type: 'aws_api_gateway_authorizer',
          values: { name, type: 'TOKEN', identity_source: 'method.request.header.Authorization' },
        },
      ],
    },
  },
  configuration: { root_module: { resources: [], outputs: {} } },
})

const authorizerRef = (model: ReturnType<typeof reduceCloudFormation>): string | undefined =>
  model.graph.nodes.find((node) => node.kind === 'apigateway-authorizer')?.ref

const cfnJoinAuthorizerName = { 'Fn::Join': ['', ['apiable-', { Ref: 'TenantName' }, '-authz']] }

describe('013-1-23 TA — authorizer tenant-name canonicalisation boundaries', () => {
  it('the conventional apiable-<tenant>-authz name reconciles across channels (CFN parameter rendering ⇄ TF concrete tenant)', () => {
    const cfnRef = authorizerRef(reduceCloudFormation(cfnAuthorizer(cfnJoinAuthorizerName), 'cfn', REGION))
    const tfRef = authorizerRef(reduceTerraformShowJson(tfAuthorizer('apiable-staging-authz'), 'terraform', REGION))
    expect(cfnRef).toBe(tfRef)
    expect(cfnRef).toContain('-authz')
  })

  it('a non-conventional authorizer name keeps its identity (a substituted authorizer name does not collapse to the tenant token)', () => {
    const evilRef = authorizerRef(reduceTerraformShowJson(tfAuthorizer('evil-authorizer'), 'terraform', REGION))
    const conventionalRef = authorizerRef(reduceTerraformShowJson(tfAuthorizer('apiable-staging-authz'), 'terraform', REGION))
    expect(evilRef).not.toBe(conventionalRef)
    expect(evilRef).toContain('evil-authorizer')
  })

  it('a substituted authorizer (non-conventional name) FAILS the gate on the graph identity, never silently reconciled', () => {
    const result = gate([
      reduceCloudFormation(cfnAuthorizer(cfnJoinAuthorizerName), 'cdk', REGION),
      reduceCloudFormation(cfnAuthorizer(cfnJoinAuthorizerName), 'cfn', REGION),
      reduceTerraformShowJson(tfAuthorizer('evil-authorizer'), 'terraform', REGION),
    ])
    expect(result.passed).toBe(false)
    expect(result.divergences.some((e) => e.tier === 'graph' && e.detail.includes('apigateway-authorizer'))).toBe(true)
  })
})
