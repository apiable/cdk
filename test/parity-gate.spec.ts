/**
 * Supplementary coverage for the parity gate beyond the frozen contract scenarios: reducer
 * edge/error paths, the authorizer and source-scoping rows the gateway-role pilot does not carry,
 * the extra-resource graph case, version precedence, logical normalisation, and the report
 * formatter. Every case drives the real reducers / gate, never a re-declaration of the diff logic.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  ChannelModel,
  formatGateReport,
  gate,
  normaliseLogical,
  reduceCloudFormation,
  reduceTerraformShowJson,
} from '@apiable/parity-gate'
import { VALUE_BEARING_KINDS } from '../lib/parity-gate/canonical'

const cfnAuthorizer = (type: string): unknown => ({
  Resources: {
    Authz: {
      Type: 'AWS::ApiGateway::Authorizer',
      Properties: { Name: 'authz', Type: type, IdentitySource: 'method.request.header.Authorization' },
    },
  },
})

const cfnInvokePermission = (scoped: boolean): unknown => ({
  Resources: {
    Invoke: {
      Type: 'AWS::Lambda::Permission',
      Properties: {
        Principal: 'cognito-idp.amazonaws.com',
        Action: 'lambda:InvokeFunction',
        FunctionName: 'pretokengen',
        ...(scoped ? { SourceArn: 'arn:aws:cognito-idp:eu-central-1:034444869755:userpool/authz' } : {}),
      },
    },
  },
})

const tfPoolBothForms = (): unknown => ({
  planned_values: {
    root_module: {
      resources: [
        {
          address: 'aws_cognito_user_pool.authz',
          type: 'aws_cognito_user_pool',
          values: {
            name: 'authz',
            user_pool_tier: 'ESSENTIALS',
            tags: { 'apiable:logical-id': 'authz-pool' },
            lambda_config: [
              {
                pre_token_generation: 'arn:aws:lambda:eu-central-1:034444869755:function:pretokengen',
                pre_token_generation_config: [{ lambda_version: 'V3_0', lambda_arn: 'arn:aws:lambda:eu-central-1:034444869755:function:pretokengen' }],
              },
            ],
          },
        },
      ],
    },
  },
  configuration: { root_module: { resources: [], outputs: {} } },
})

describe('parity gate — logical normalisation', () => {
  it('collapses account ids and AWS regions to logical tokens, leaving other text intact', () => {
    expect(normaliseLogical('arn:aws:iam::034444869755:root')).toBe('arn:aws:iam::{account}:root')
    expect(normaliseLogical('arn:aws:apigateway:eu-central-1::/*', 'eu-central-1')).toBe('arn:aws:apigateway:{region}::/*')
    expect(normaliseLogical('apiable-gateway-managment-role')).toBe('apiable-gateway-managment-role')
  })
})

describe('parity gate — reducer well-formedness and version precedence', () => {
  it('marks an artifact with no resources as not well-formed', () => {
    expect(reduceCloudFormation({ Resources: {} }, 'cfn').wellFormed).toBe(false)
    expect(reduceTerraformShowJson({ planned_values: { root_module: { resources: [] } } }, 'terraform').wellFormed).toBe(false)
  })

  it('prefers the explicit pre_token_generation_config version over the legacy attribute', () => {
    const model = reduceTerraformShowJson(tfPoolBothForms(), 'terraform', 'eu-central-1')
    expect(model.values['pretokengen-version:cognito-user-pool:authz-pool']).toBe('V3_0')
  })
})

describe('parity gate — tiers beyond the role pilot', () => {
  it('fails on an authorizer-type divergence (a load-bearing value)', () => {
    const result = gate([
      reduceCloudFormation(cfnAuthorizer('TOKEN'), 'cdk'),
      reduceCloudFormation(cfnAuthorizer('TOKEN'), 'cfn'),
      reduceCloudFormation(cfnAuthorizer('REQUEST'), 'terraform'),
    ])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find((entry) => entry.tier === 'value' && entry.detail.includes('authorizer-type'))
    expect(divergence?.channels).toEqual(['terraform'])
  })

  it('fails when one channel leaves an invoke grant unscoped (source_arn) at equal resource count', () => {
    const result = gate([
      reduceCloudFormation(cfnInvokePermission(true), 'cdk'),
      reduceCloudFormation(cfnInvokePermission(true), 'cfn'),
      reduceCloudFormation(cfnInvokePermission(false), 'terraform'),
    ])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find((entry) => entry.tier === 'permission')
    expect(divergence?.detail).toContain('grant:invoke')
    expect(divergence?.channels).toEqual(['terraform'])
  })

  it('detects an EXTRA resource in one channel, not only a missing one', () => {
    const role = (id: string): unknown => ({ Type: 'AWS::IAM::Role', Properties: { RoleName: id, Tags: [{ Key: 'apiable:logical-id', Value: id }] } })
    const base: ChannelModel = reduceCloudFormation({ Resources: { R: role('r') } }, 'cdk')
    const withExtra = reduceCloudFormation({ Resources: { R: role('r'), Extra: role('extra') } }, 'terraform')
    const result = gate([base, { ...base, channel: 'cfn' }, withExtra])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find((entry) => entry.tier === 'graph' && entry.detail.includes('iam-role:extra'))
    expect(divergence?.channels).toEqual(['terraform'])
  })
})

const cfnRole = (principal: unknown): unknown => ({
  Resources: {
    Role: {
      Type: 'AWS::IAM::Role',
      Properties: {
        RoleName: 'apiable-gateway-managment-role',
        Tags: [{ Key: 'apiable:logical-id', Value: 'gateway-managment-role' }],
        AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: principal, Action: 'sts:AssumeRole' }] },
      },
    },
  },
})

// The trust-account value is keyed per role node (by its declared id), so a second role cannot clobber the first.
const TRUST_ACCOUNT_KEY = 'role-trust-account:iam-role:gateway-managment-role'

describe('parity gate — trust target (who may assume the role)', () => {
  it('captures the trusted account by value as a load-bearing setting, not a logical token', () => {
    const model = reduceCloudFormation(cfnRole({ AWS: 'arn:aws:iam::034444869755:root' }), 'cfn')
    expect(model.values[TRUST_ACCOUNT_KEY]).toBe('034444869755')
  })

  it('omits the trust-account setting when the role trusts a service principal, not an account', () => {
    const model = reduceCloudFormation(cfnRole({ Service: 'lambda.amazonaws.com' }), 'cfn')
    expect(model.values[TRUST_ACCOUNT_KEY]).toBeUndefined()
  })

  it('captures multiple trusted accounts by value, sorted so the key is channel-stable', () => {
    const model = reduceCloudFormation(cfnRole({ AWS: ['arn:aws:iam::222222222222:root', 'arn:aws:iam::111111111111:root'] }), 'cfn')
    expect(model.values[TRUST_ACCOUNT_KEY]).toBe('111111111111,222222222222')
  })

  it('reads an account named through a federated identity-provider trust by value', () => {
    const model = reduceCloudFormation(cfnRole({ Federated: 'arn:aws:iam::555555555555:saml-provider/corp' }), 'cfn')
    expect(model.values[TRUST_ACCOUNT_KEY]).toBe('555555555555')
  })

  it('does not mistake a service principal hostname that embeds digits for a trusted account', () => {
    const model = reduceCloudFormation(cfnRole({ Service: '123456789012.dkr.ecr.eu-central-1.amazonaws.com' }), 'cfn')
    expect(model.values[TRUST_ACCOUNT_KEY]).toBeUndefined()
  })
})

// A role whose trust carries the given full statements (with conditions), for the condition tier.
const cfnRoleWithStatements = (statements: readonly unknown[]): unknown => ({
  Resources: {
    Role: {
      Type: 'AWS::IAM::Role',
      Properties: {
        RoleName: 'apiable-conditional-role',
        Tags: [{ Key: 'apiable:logical-id', Value: 'conditional-role' }],
        AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: statements },
      },
    },
  },
})

const conditionalTrust = (condition: unknown): unknown => ({
  Effect: 'Allow',
  Principal: { AWS: 'arn:aws:iam::034444869755:root' },
  Action: 'sts:AssumeRole',
  Condition: condition,
})

describe('parity gate — trust condition (a load-bearing assume-role guard)', () => {
  it('fails when one channel drops the external-id condition guarding who may assume the role', () => {
    const guarded = cfnRoleWithStatements([conditionalTrust({ StringEquals: { 'sts:ExternalId': 'apiable-tenant' } })])
    const unguarded = cfnRoleWithStatements([
      { Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::034444869755:root' }, Action: 'sts:AssumeRole' },
    ])
    const result = gate([
      reduceCloudFormation(guarded, 'cdk'),
      reduceCloudFormation(guarded, 'cfn'),
      reduceCloudFormation(unguarded, 'terraform'),
    ])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find((entry) => entry.tier === 'permission')
    expect(divergence?.detail).toContain('grant:assume-role')
    expect(divergence?.channels).toEqual(['terraform'])
  })

  it('treats the same condition emitted in a different key order as equal (canonicalised)', () => {
    const orderA = cfnRoleWithStatements([
      conditionalTrust({ StringEquals: { 'sts:ExternalId': 'apiable-tenant', 'aws:PrincipalTag/team': 'platform' } }),
    ])
    const orderB = cfnRoleWithStatements([
      conditionalTrust({ StringEquals: { 'aws:PrincipalTag/team': 'platform', 'sts:ExternalId': 'apiable-tenant' } }),
    ])
    const result = gate([
      reduceCloudFormation(orderA, 'cdk'),
      reduceCloudFormation(orderA, 'cfn'),
      reduceCloudFormation(orderB, 'terraform'),
    ])
    expect(result.passed).toBe(true)
    expect(result.divergences.find((entry) => entry.tier === 'permission')).toBeUndefined()
  })
})

// ── Cross-role trust pooling: two roles' trusts must never share one comparison ────────────────

// A trust statement on a fixed account-root, optionally guarded by an sts:ExternalId condition. The
// guard is invisible to the by-value trusted-account read, so a role keeps the same trusted account
// whether or not it carries the guard — only the per-role grant ref can tell the two apart.
const SHARED_TRUST_ACCOUNT = '034444869755'
const assumeRoot = (guarded: boolean): unknown => ({
  Effect: 'Allow',
  Principal: { AWS: `arn:aws:iam::${SHARED_TRUST_ACCOUNT}:root` },
  Action: 'sts:AssumeRole',
  ...(guarded ? { Condition: { StringEquals: { 'sts:ExternalId': 'apiable-tenant' } } } : {}),
})
const cfnTrustRole = (logicalId: string, roleName: string, guarded: boolean): unknown => ({
  Type: 'AWS::IAM::Role',
  Properties: {
    RoleName: roleName,
    Tags: [{ Key: 'apiable:logical-id', Value: logicalId }],
    AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [assumeRoot(guarded)] },
  },
})
const cfnTwoTrustRoles = (guardedRole: 'a' | 'b'): unknown => ({
  Resources: {
    RoleA: cfnTrustRole('role-a', 'apiable-role-a', guardedRole === 'a'),
    RoleB: cfnTrustRole('role-b', 'apiable-role-b', guardedRole === 'b'),
  },
})
const tfTrustRole = (address: string, logicalId: string, roleName: string, guarded: boolean): unknown => ({
  address,
  type: 'aws_iam_role',
  values: {
    name: roleName,
    tags: { 'apiable:logical-id': logicalId },
    assume_role_policy: JSON.stringify({ Version: '2012-10-17', Statement: [assumeRoot(guarded)] }),
  },
})
const tfTwoTrustRoles = (guardedRole: 'a' | 'b'): unknown => ({
  planned_values: {
    root_module: {
      resources: [
        tfTrustRole('aws_iam_role.a', 'role-a', 'apiable-role-a', guardedRole === 'a'),
        tfTrustRole('aws_iam_role.b', 'role-b', 'apiable-role-b', guardedRole === 'b'),
      ],
    },
  },
  configuration: { root_module: { resources: [], outputs: {} } },
})

describe('parity gate — cross-role trust pooling (two roles never share one trust comparison)', () => {
  it('fails when one channel moves an external-id guard from one role onto its sibling, both roles trusting one account', () => {
    // CFN/CDK guard role-a; Terraform guards role-b instead — role-a's guard is dropped (widened). Both
    // roles trust the same account in every channel, so the value tier and the pooled assume-role multiset
    // both agree; only filing each trust under its owning role's ref surfaces the moved guard.
    const result = gate([
      reduceCloudFormation(cfnTwoTrustRoles('a'), 'cdk'),
      reduceCloudFormation(cfnTwoTrustRoles('a'), 'cfn'),
      reduceTerraformShowJson(tfTwoTrustRoles('b'), 'terraform'),
    ])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find((entry) => entry.tier === 'permission')
    expect(divergence?.detail).toContain('grant:assume-role:iam-role:role-a')
    expect(divergence?.channels).toEqual(['terraform'])
  })

  const assumeRoleRefs = (model: ReturnType<typeof reduceCloudFormation>): string[] =>
    model.grants.filter((grant) => grant.ref.startsWith('grant:assume-role')).map((grant) => grant.ref).sort()

  it('files each role’s trust under its own node ref in both reducers, so two roles’ assume-role grants never share one ref', () => {
    expect(assumeRoleRefs(reduceCloudFormation(cfnTwoTrustRoles('a'), 'cfn'))).toEqual([
      'grant:assume-role:iam-role:role-a',
      'grant:assume-role:iam-role:role-b',
    ])
    expect(assumeRoleRefs(reduceTerraformShowJson(tfTwoTrustRoles('a'), 'terraform'))).toEqual([
      'grant:assume-role:iam-role:role-a',
      'grant:assume-role:iam-role:role-b',
    ])
  })

  it('agrees when two roles carry matching trusts across all channels — the per-role ref raises no false alarm', () => {
    // role-a guarded, role-b unguarded, identically in every channel: the per-role suffix must not invent a divergence
    const result = gate([
      reduceCloudFormation(cfnTwoTrustRoles('a'), 'cdk'),
      reduceCloudFormation(cfnTwoTrustRoles('a'), 'cfn'),
      reduceTerraformShowJson(tfTwoTrustRoles('a'), 'terraform'),
    ])
    expect(result.passed).toBe(true)
    expect(result.divergences.find((entry) => entry.tier === 'permission')).toBeUndefined()
  })
})

describe('parity gate — report', () => {
  it('renders a failing result naming the tier and the divergent detail', () => {
    const result = gate([
      reduceCloudFormation(cfnAuthorizer('TOKEN'), 'cdk'),
      reduceCloudFormation(cfnAuthorizer('TOKEN'), 'cfn'),
      reduceCloudFormation(cfnAuthorizer('REQUEST'), 'terraform'),
    ])
    const report = formatGateReport(result)
    expect(report).toContain('PARITY FAILED')
    expect(report).toContain('authorizer-type')
  })
})

// ── Supplementary grant/trust edge coverage beyond the contract scenarios ──────────────────────

const cfnInlinePolicy = (statements: readonly unknown[]): unknown => ({
  Resources: {
    Policy: {
      Type: 'AWS::IAM::RolePolicy',
      Properties: { PolicyName: 'p', RoleName: 'r', PolicyDocument: { Version: '2012-10-17', Statement: statements } },
    },
  },
})

describe('parity gate — grant multiset (count and inline policies)', () => {
  it('fails when one channel repeats an identical trust statement (a count difference, same content)', () => {
    const single = cfnRoleWithStatements([
      { Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::034444869755:root' }, Action: 'sts:AssumeRole' },
    ])
    const doubled = cfnRoleWithStatements([
      { Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::034444869755:root' }, Action: 'sts:AssumeRole' },
      { Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::034444869755:root' }, Action: 'sts:AssumeRole' },
    ])
    const result = gate([
      reduceCloudFormation(single, 'cdk'),
      reduceCloudFormation(single, 'cfn'),
      reduceCloudFormation(doubled, 'terraform'),
    ])
    expect(result.passed).toBe(false)
    expect(result.divergences.find((entry) => entry.tier === 'permission')?.channels).toEqual(['terraform'])
  })

  it('catches a second inline-policy statement on a shared service ref that one channel widens', () => {
    const narrow = cfnInlinePolicy([{ Effect: 'Allow', Action: 's3:GetObject', Resource: 'arn:aws:s3:::bucket/scoped/*' }])
    const widened = cfnInlinePolicy([
      { Effect: 'Allow', Action: 's3:GetObject', Resource: 'arn:aws:s3:::bucket/scoped/*' },
      { Effect: 'Allow', Action: 's3:GetObject', Resource: 'arn:aws:s3:::bucket/*' },
    ])
    const result = gate([
      reduceCloudFormation(narrow, 'cdk'),
      reduceCloudFormation(narrow, 'cfn'),
      reduceCloudFormation(widened, 'terraform'),
    ])
    expect(result.passed).toBe(false)
    // Both statements share the s3 service ref; the multiset (not the first match) surfaces the widening.
    expect(result.divergences.find((entry) => entry.tier === 'permission')?.detail).toContain('grant:s3')
  })

  it('agrees when several inline statements on a shared ref match across channels (order-insensitive)', () => {
    const orderA = cfnInlinePolicy([
      { Effect: 'Allow', Action: 's3:GetObject', Resource: 'arn:aws:s3:::bucket/a/*' },
      { Effect: 'Allow', Action: 's3:PutObject', Resource: 'arn:aws:s3:::bucket/b/*' },
    ])
    const orderB = cfnInlinePolicy([
      { Effect: 'Allow', Action: 's3:PutObject', Resource: 'arn:aws:s3:::bucket/b/*' },
      { Effect: 'Allow', Action: 's3:GetObject', Resource: 'arn:aws:s3:::bucket/a/*' },
    ])
    const result = gate([
      reduceCloudFormation(orderA, 'cdk'),
      reduceCloudFormation(orderA, 'cfn'),
      reduceCloudFormation(orderB, 'terraform'),
    ])
    expect(result.passed).toBe(true)
  })
})

describe('parity gate — per-resource identity by declared id (two roles do not collapse)', () => {
  it('keys each role by its declared apiable:logical-id so a two-role artifact yields two distinct nodes, the name demoted to a cosmetic', () => {
    const twoRoles: unknown = {
      Resources: {
        RoleA: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'apiable-role-a', Tags: [{ Key: 'apiable:logical-id', Value: 'role-a' }] } },
        RoleB: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'apiable-role-b', Tags: [{ Key: 'apiable:logical-id', Value: 'role-b' }] } },
      },
    }
    const model = reduceCloudFormation(twoRoles, 'cfn')
    const roleNodes = model.graph.nodes.filter((node) => node.kind === 'iam-role').map((node) => node.ref)
    expect(roleNodes).toEqual(['iam-role:role-a', 'iam-role:role-b'])
    // the name carries no identity under the declared id, so it is a per-node cosmetic, never a load-bearing value
    expect(model.values['role-name:iam-role:role-a']).toBeUndefined()
    expect(model.cosmetics['name:iam-role:role-a']).toBe('apiable-role-a')
    expect(model.cosmetics['name:iam-role:role-b']).toBe('apiable-role-b')
  })
})

describe('parity gate — declared-id collision forcing (two attached policies kept distinct by parent)', () => {
  it('anchors two same-service inline policies to their own role, so they do not collapse onto one shared service key', () => {
    const role = (id: string): unknown => ({
      Type: 'AWS::IAM::Role',
      Properties: { Tags: [{ Key: 'apiable:logical-id', Value: id }], AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] } },
    })
    const policy = (name: string, role: string, resource: string): unknown => ({
      Type: 'AWS::IAM::Policy',
      Properties: { PolicyName: name, Roles: [{ Ref: role }], PolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: resource }] } },
    })
    const artifact: unknown = {
      Resources: {
        RoleA: role('role-a'),
        PolicyA: policy('pa', 'RoleA', 'arn:aws:s3:::bucket-a/*'),
        RoleB: role('role-b'),
        PolicyB: policy('pb', 'RoleB', 'arn:aws:s3:::bucket-b/*'),
      },
    }
    const model = reduceCloudFormation(artifact, 'cfn')
    // both policies grant the same s3 service: the inferred discriminator collapsed them onto one
    // iam-inline-policy:s3 node; the parent anchor keeps each filed under its own role.
    const policyRefs = new Set(model.graph.nodes.filter((node) => node.kind === 'iam-inline-policy').map((node) => node.ref))
    expect(policyRefs).toEqual(new Set(['iam-inline-policy:policy-of:role-a:s3', 'iam-inline-policy:policy-of:role-b:s3']))
  })
})

describe('parity gate — mixed AWS + federated trust in one statement', () => {
  it('reads both the direct and the federated account from a single trust statement', () => {
    const model = reduceCloudFormation(
      cfnRole({ AWS: 'arn:aws:iam::111111111111:root', Federated: 'arn:aws:iam::222222222222:saml-provider/corp' }),
      'cfn',
    )
    expect(model.values[TRUST_ACCOUNT_KEY]).toBe('111111111111,222222222222')
  })
})

describe('parity gate — within-channel identity collision (a primary id must be unique per channel)', () => {
  it('fails when two roles share one declared id and the clobbered loser is widened to a foreign trust account', () => {
    // Two distinct roles carry the SAME declared id, so both reduce to iam-role:dup and the second
    // (last-written) clobbers the first's role-trust-account value last-write-wins. RoleA is processed
    // first, so it is the loser; widening RoleA in terraform is hidden behind RoleB's safe value (and
    // the grant principal tokenises the account, so the permission tier sees nothing). Only catching the
    // within-channel collision itself surfaces the escalation, which would otherwise ship parity-OK.
    const twoRolesOneId = (roleATrust: string): unknown => ({
      Resources: {
        RoleA: {
          Type: 'AWS::IAM::Role',
          Properties: {
            Tags: [{ Key: 'apiable:logical-id', Value: 'dup' }],
            AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${roleATrust}:root` }, Action: 'sts:AssumeRole' }] },
          },
        },
        RoleB: {
          Type: 'AWS::IAM::Role',
          Properties: {
            Tags: [{ Key: 'apiable:logical-id', Value: 'dup' }],
            AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::222222222222:root' }, Action: 'sts:AssumeRole' }] },
          },
        },
      },
    })
    const result = gate([
      reduceCloudFormation(twoRolesOneId('111111111111'), 'cdk'),
      reduceCloudFormation(twoRolesOneId('111111111111'), 'cfn'),
      reduceCloudFormation(twoRolesOneId('999988887777'), 'terraform'), // RoleA — the clobbered loser — widened
    ])
    expect(result.passed).toBe(false)
    const collision = result.divergences.find((entry) => entry.detail.includes('iam-role:dup'))
    expect(collision).toBeDefined()
  })

  it('keys two same-Identifier resource-servers on different pools as distinct (no clobber), catching a widening on the right one', () => {
    // Same-Identifier resource-servers on different pools are two distinct resources; anchoring each to its
    // bound pool's declared id keeps them distinct, so a widening on one is caught on its own pool-anchored
    // key instead of being clobbered last-write-wins behind the other's value.
    const twoResourceServers = (firstScopes: readonly string[]): unknown => ({
      Resources: {
        PoolA: { Type: 'AWS::Cognito::UserPool', Properties: { UserPoolName: 'pool-a', UserPoolTags: { 'apiable:logical-id': 'pool-a' } } },
        PoolB: { Type: 'AWS::Cognito::UserPool', Properties: { UserPoolName: 'pool-b', UserPoolTags: { 'apiable:logical-id': 'pool-b' } } },
        RsA: {
          Type: 'AWS::Cognito::UserPoolResourceServer',
          Properties: { UserPoolId: { Ref: 'PoolA' }, Identifier: 'https://api.apiable.io', Name: 'api', Scopes: firstScopes.map((scope) => ({ ScopeName: scope, ScopeDescription: scope })) },
        },
        RsB: {
          Type: 'AWS::Cognito::UserPoolResourceServer',
          Properties: { UserPoolId: { Ref: 'PoolB' }, Identifier: 'https://api.apiable.io', Name: 'api', Scopes: [{ ScopeName: 'read', ScopeDescription: 'read' }] },
        },
      },
    })
    // Equivalent across channels → no false collision and no resource-server divergence.
    const equivalent = gate([
      reduceCloudFormation(twoResourceServers(['read']), 'cdk'),
      reduceCloudFormation(twoResourceServers(['read']), 'cfn'),
      reduceCloudFormation(twoResourceServers(['read']), 'terraform'),
    ])
    expect(equivalent.passed).toBe(true)

    // RsA (on pool-a) is scope-widened in terraform → caught on its own pool-anchored key, not hidden.
    const result = gate([
      reduceCloudFormation(twoResourceServers(['read']), 'cdk'),
      reduceCloudFormation(twoResourceServers(['read']), 'cfn'),
      reduceCloudFormation(twoResourceServers(['read', 'admin']), 'terraform'),
    ])
    expect(result.passed).toBe(false)
    const widened = result.divergences.find(
      (entry) => entry.tier === 'value' && entry.detail.includes('resource-server-scopes:cognito-resource-server:of-pool:pool-a:https://api.apiable.io'),
    )
    expect(widened?.channels).toEqual(['terraform'])
  })

  it('fails on two user-pool clients that collapse onto one name within a channel (the other primary kind)', () => {
    const twoClients: unknown = {
      Resources: {
        PoolA: { Type: 'AWS::Cognito::UserPool', Properties: { UserPoolName: 'pool-a' } },
        PoolB: { Type: 'AWS::Cognito::UserPool', Properties: { UserPoolName: 'pool-b' } },
        ClientA: { Type: 'AWS::Cognito::UserPoolClient', Properties: { UserPoolId: { Ref: 'PoolA' }, ClientName: 'web' } },
        ClientB: { Type: 'AWS::Cognito::UserPoolClient', Properties: { UserPoolId: { Ref: 'PoolB' }, ClientName: 'web' } },
      },
    }
    const result = gate([
      reduceCloudFormation(twoClients, 'cdk'),
      reduceCloudFormation(twoClients, 'cfn'),
      reduceCloudFormation(twoClients, 'terraform'),
    ])
    expect(result.passed).toBe(false)
    expect(result.divergences.some((entry) => entry.detail.includes('cognito-user-pool-client:web'))).toBe(true)
  })

  it('does not flag the legitimate case where each channel carries the same id exactly once', () => {
    // the same declared id appearing once per channel is the normal cross-channel identity, never a
    // within-channel collision — the guard must stay silent so it raises no false divergence
    const oneRole: unknown = {
      Resources: {
        Role: { Type: 'AWS::IAM::Role', Properties: { Tags: [{ Key: 'apiable:logical-id', Value: 'unique' }], AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] } } },
      },
    }
    const result = gate([
      reduceCloudFormation(oneRole, 'cdk'),
      reduceCloudFormation(oneRole, 'cfn'),
      reduceCloudFormation(oneRole, 'terraform'),
    ])
    expect(result.passed).toBe(true)
    expect(result.divergences.some((entry) => entry.detail.includes('duplicate declared identity'))).toBe(false)
  })
})

const cfnOneBucketTwoPolicies = (policyAWriter: string): unknown => ({
  Resources: {
    LogsBucket: {
      Type: 'AWS::S3::Bucket',
      Properties: { BucketName: 'apiable-logs', Tags: [{ Key: 'apiable:logical-id', Value: 'logs' }] },
    },
    PolicyA: {
      Type: 'AWS::S3::BucketPolicy',
      Properties: {
        Bucket: { Ref: 'LogsBucket' },
        PolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${policyAWriter}:root` }, Action: 's3:PutObject', Resource: 'arn:aws:s3:::apiable-logs/*' }] },
      },
    },
    PolicyB: {
      Type: 'AWS::S3::BucketPolicy',
      Properties: {
        Bucket: { Ref: 'LogsBucket' },
        PolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::222222222222:root' }, Action: 's3:PutObject', Resource: 'arn:aws:s3:::apiable-logs/*' }] },
      },
    },
  },
})

const cfnOneNameTwoAuthorizers = (authAType: string): unknown => ({
  Resources: {
    AuthZA: { Type: 'AWS::ApiGateway::Authorizer', Properties: { Name: 'authz', Type: authAType, IdentitySource: 'method.request.header.Authorization' } },
    AuthZB: { Type: 'AWS::ApiGateway::Authorizer', Properties: { Name: 'authz', Type: 'TOKEN', IdentitySource: 'method.request.header.Authorization' } },
  },
})

// Every kind whose reducer writes a `values[...]` / `out[...]` row, read from the reducer source by
// tracking the kind context of each row write. The structural coupling that makes VALUE_BEARING_KINDS
// impossible to drift out of sync with the value-writing sites.
const valueWritingKindsIn = (source: string): Set<string> => {
  const kinds = new Set<string>()
  let currentKind: string | undefined
  for (const line of source.split('\n')) {
    const kindMatch = line.match(/kind === '([^']+)'/)
    if (kindMatch !== null) currentKind = kindMatch[1]
    if (/(?<![.\w])(?:values|out)\[/.test(line) && currentKind !== undefined) kinds.add(currentKind)
  }
  return kinds
}

describe('parity gate — within-channel uniqueness covers value-bearing attached kinds', () => {
  it('fails when one bucket carries two bucket-policies and the clobbered loser widens who may write', () => {
    // AWS permits one policy per bucket, so two on one bucket are a duplicate identity, not two
    // resources: both reduce to s3-bucket-policy:logs and PolicyB (last) clobbers PolicyA's
    // bucket-policy-write-accounts value. Widening PolicyA (the loser) in terraform is hidden behind
    // PolicyB's safe value, and the account-level widening tokenises away in the grant tier — so only
    // catching the within-channel collision surfaces the extra cross-account writer.
    const result = gate([
      reduceCloudFormation(cfnOneBucketTwoPolicies('111111111111'), 'cdk'),
      reduceCloudFormation(cfnOneBucketTwoPolicies('111111111111'), 'cfn'),
      reduceCloudFormation(cfnOneBucketTwoPolicies('999988887777'), 'terraform'),
    ])
    expect(result.passed).toBe(false)
    const collision = result.divergences.find((entry) => entry.detail.includes('duplicate declared identity s3-bucket-policy:logs'))
    expect(collision).toBeDefined()
  })

  it('fails when two authorizers share one Name and the clobbered loser widens its authorizer-type', () => {
    // An authorizer is self-keyed by Name, so two same-Name authorizers collapse onto
    // apigateway-authorizer:authz and AuthZB (last) clobbers AuthZA's authorizer-type value. Widening
    // AuthZA (the loser) in terraform is hidden behind AuthZB's TOKEN; the within-channel guard is the
    // only witness.
    const result = gate([
      reduceCloudFormation(cfnOneNameTwoAuthorizers('TOKEN'), 'cdk'),
      reduceCloudFormation(cfnOneNameTwoAuthorizers('TOKEN'), 'cfn'),
      reduceCloudFormation(cfnOneNameTwoAuthorizers('REQUEST'), 'terraform'),
    ])
    expect(result.passed).toBe(false)
    const collision = result.divergences.find((entry) => entry.detail.includes('duplicate declared identity apigateway-authorizer:authz'))
    expect(collision).toBeDefined()
  })

  it('guards every kind that writes a load-bearing value row, so a new value row cannot bypass the uniqueness check', () => {
    // Structural coupling: a future reducer that adds a values[...] / out[...] row for a new kind must
    // also add that kind to VALUE_BEARING_KINDS or this fails — the durable anti-drift on the invariant.
    for (const file of ['cfn-reducer.ts', 'terraform-reducer.ts']) {
      const source = readFileSync(join(__dirname, '..', 'lib', 'parity-gate', file), 'utf8')
      const valueWritingKinds = valueWritingKindsIn(source)
      // The scan is non-vacuous and sees both write mechanisms: collectValues (the cognito/authorizer
      // rows) and the two direct writes (iam-role trust account, s3-bucket-policy write accounts).
      expect(valueWritingKinds.has('iam-role')).toBe(true)
      expect(valueWritingKinds.has('s3-bucket-policy')).toBe(true)
      expect(valueWritingKinds.has('apigateway-authorizer')).toBe(true)
      for (const kind of valueWritingKinds) {
        expect(VALUE_BEARING_KINDS.has(kind)).toBe(true)
      }
    }
  })
})
