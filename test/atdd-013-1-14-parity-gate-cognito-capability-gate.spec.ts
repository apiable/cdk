/**
 * Acceptance specs — Story 013-1-14: close the parity check's grant & trust fail-open holes.
 * Frozen contract: contract-013-1-14-parity-gate-cognito-capability.md
 *
 * One un-skipped spec per contract scenario (S1–S8), each driving the real reducers + gate against
 * multi-statement / multi-role / federated-trust / divergent-invoke-source / cross-role-trust artifacts.
 * Every failing scenario is a forcing fixture: it cannot go green while a non-first grant is dropped, a
 * federated account is blanked, a second role's trust is clobbered, an invoke source is reduced to mere
 * presence, or two roles' trusts pool so a cross-role swap nets out. The CDK and CFN channels are reduced
 * from CloudFormation and the Terraform channel from `terraform show -json`, so a divergence is proven
 * across both reducers, not one shape compared to itself.
 *
 * Shares compareGrants + the trust reduction + both reducers with sibling 013-1-15 (S3) and
 * 013-1-16 (cognito modelling); whichever slice lands second re-runs the other's failing fixtures.
 */
import { gate, reduceCloudFormation, reduceTerraformShowJson } from '@apiable/parity-gate'

const INTENDED_TRUST_ACCOUNT = '034444869755'
const WIDENED_TRUST_ACCOUNT = '999988887777'
const REGION = 'eu-central-1'

// ── CloudFormation builders (the CDK + CFN channels share this reducer) ───────────────────────

const cfnTrustStatement = (principal: unknown): unknown => ({
  Effect: 'Allow',
  Principal: principal,
  Action: 'sts:AssumeRole',
})

/** A role whose trust policy carries the given statements verbatim. The declared id is the role name, so
 * the iam-role node ref is the channel-stable `iam-role:<roleName>` the enforced declared-id engine keys on. */
const cfnRole = (statements: readonly unknown[], roleName = 'apiable-managed-role'): unknown => ({
  Resources: {
    Role: {
      Type: 'AWS::IAM::Role',
      Properties: {
        RoleName: roleName,
        Tags: [{ Key: 'apiable:logical-id', Value: roleName }],
        AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: statements },
      },
    },
  },
})

/** Two roles, each trusting its own account-root, in one artifact. */
const cfnTwoRoles = (firstAccount: string, secondAccount: string): unknown => ({
  Resources: {
    RoleA: {
      Type: 'AWS::IAM::Role',
      Properties: {
        RoleName: 'apiable-role-a',
        Tags: [{ Key: 'apiable:logical-id', Value: 'apiable-role-a' }],
        AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [cfnTrustStatement({ AWS: `arn:aws:iam::${firstAccount}:root` })] },
      },
    },
    RoleB: {
      Type: 'AWS::IAM::Role',
      Properties: {
        RoleName: 'apiable-role-b',
        Tags: [{ Key: 'apiable:logical-id', Value: 'apiable-role-b' }],
        AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [cfnTrustStatement({ AWS: `arn:aws:iam::${secondAccount}:root` })] },
      },
    },
  },
})

const cfnInvokePermission = (sourceArn: string | undefined): unknown => ({
  Resources: {
    Invoke: {
      Type: 'AWS::Lambda::Permission',
      Properties: {
        Principal: 'cognito-idp.amazonaws.com',
        Action: 'lambda:InvokeFunction',
        FunctionName: 'pretokengen',
        ...(sourceArn !== undefined ? { SourceArn: sourceArn } : {}),
      },
    },
  },
})

// ── Terraform `show -json` builders (the Terraform channel's own reducer) ──────────────────────

const tfResource = (address: string, type: string, values: Record<string, unknown>): unknown => ({ address, type, values })

const tfPlan = (resources: readonly unknown[]): unknown => ({
  planned_values: { root_module: { resources } },
  configuration: { root_module: { resources: [], outputs: {} } },
})

const tfRole = (statements: readonly unknown[], name = 'apiable-managed-role', address = 'aws_iam_role.this'): unknown =>
  tfResource(address, 'aws_iam_role', {
    name,
    tags: { 'apiable:logical-id': name },
    assume_role_policy: JSON.stringify({ Version: '2012-10-17', Statement: statements }),
  })

const tfTrustStatement = (principal: unknown): unknown => ({ Effect: 'Allow', Principal: principal, Action: 'sts:AssumeRole' })

const tfInvokePermission = (sourceArn: string | undefined): unknown =>
  tfResource('aws_lambda_permission.invoke', 'aws_lambda_permission', {
    principal: 'cognito-idp.amazonaws.com',
    action: 'lambda:InvokeFunction',
    function_name: 'pretokengen',
    ...(sourceArn !== undefined ? { source_arn: sourceArn } : {}),
  })

// ── Harness ───────────────────────────────────────────────────────────────────────────────────

const gateOf = (cdk: unknown, cfn: unknown, terraformPlan: unknown): ReturnType<typeof gate> =>
  gate([
    reduceCloudFormation(cdk, 'cdk', REGION),
    reduceCloudFormation(cfn, 'cfn', REGION),
    reduceTerraformShowJson(terraformPlan, 'terraform', REGION),
  ])

const permissionDivergence = (result: ReturnType<typeof gate>) =>
  result.divergences.find((entry) => entry.tier === 'permission')
const valueDivergence = (result: ReturnType<typeof gate>, fragment: string) =>
  result.divergences.find((entry) => entry.tier === 'value' && entry.detail.includes(fragment))

describe('013-1-14 parity check — grant & trust fail-open closure', () => {
  // contract: S1 — equivalent roles, trusts, and invoke permissions across all three channels → agreement
  it('S1: equivalent roles + trusts + invoke permissions across all three channels → parity holds', () => {
    const cfn = cfnRole([cfnTrustStatement({ AWS: `arn:aws:iam::${INTENDED_TRUST_ACCOUNT}:root` })])
    const tf = tfPlan([tfRole([tfTrustStatement({ AWS: `arn:aws:iam::${INTENDED_TRUST_ACCOUNT}:root` })])])
    const result = gateOf(cfn, cfn, tf)
    expect(result.passed).toBe(true)
    expect(result.divergences).toEqual([])
  })

  // contract: S2 — a role legitimately trusts several statements, identical across channels → agreement (no drop)
  it('S2: a role whose trust has several matching statements across all channels → agreement, no statement dropped', () => {
    const cfnStatements = [
      cfnTrustStatement({ AWS: `arn:aws:iam::${INTENDED_TRUST_ACCOUNT}:root` }),
      cfnTrustStatement({ Service: 'lambda.amazonaws.com' }),
    ]
    const tfStatements = [
      tfTrustStatement({ AWS: `arn:aws:iam::${INTENDED_TRUST_ACCOUNT}:root` }),
      tfTrustStatement({ Service: 'lambda.amazonaws.com' }),
    ]
    const result = gateOf(cfnRole(cfnStatements), cfnRole(cfnStatements), tfPlan([tfRole(tfStatements)]))
    expect(result.passed).toBe(true)
    expect(permissionDivergence(result)).toBeUndefined()
  })

  // contract: S3 — a second trust statement widening who may assume the role is caught (SEC-B — FORCING, HIGH)
  it('S3: a second trust statement permitting any account to assume the role (one channel) → the check FAILS naming the divergent trust', () => {
    const narrowCfn = cfnRole([cfnTrustStatement({ AWS: `arn:aws:iam::${INTENDED_TRUST_ACCOUNT}:root` })])
    const widenedTf = tfPlan([
      tfRole([
        tfTrustStatement({ AWS: `arn:aws:iam::${INTENDED_TRUST_ACCOUNT}:root` }),
        tfTrustStatement({ AWS: '*' }),
      ]),
    ])
    const result = gateOf(narrowCfn, narrowCfn, widenedTf)
    expect(result.passed).toBe(false)
    const divergence = permissionDivergence(result)
    expect(divergence?.detail).toContain('grant:assume-role')
    expect(divergence?.channels).toEqual(['terraform'])
  })

  // contract: S4 — a divergent account named through a federated trust is caught (V-SEC-1)
  it('S4: two channels trusting a federated identity provider whose named account differs → the check FAILS on the trusted account', () => {
    const intendedCfn = cfnRole([cfnTrustStatement({ Federated: `arn:aws:iam::${INTENDED_TRUST_ACCOUNT}:saml-provider/corp` })])
    const divergentTf = tfPlan([tfRole([tfTrustStatement({ Federated: `arn:aws:iam::${WIDENED_TRUST_ACCOUNT}:saml-provider/corp` })])])
    const result = gateOf(intendedCfn, intendedCfn, divergentTf)
    expect(result.passed).toBe(false)
    const divergence = valueDivergence(result, 'role-trust-account')
    expect(divergence?.detail).toContain(WIDENED_TRUST_ACCOUNT)
    expect(divergence?.channels).toEqual(['terraform'])
  })

  // contract: S5 — a second role's trusted account is not overwritten by the first (M5 — FORCING)
  it('S5: a two-role artifact whose second role trusts a different account across channels → the check FAILS on the second role (no last-write clobber)', () => {
    const intendedCfn = cfnTwoRoles(INTENDED_TRUST_ACCOUNT, '111111111111')
    const secondDivergesTf = tfPlan([
      tfRole([tfTrustStatement({ AWS: `arn:aws:iam::${INTENDED_TRUST_ACCOUNT}:root` })], 'apiable-role-a', 'aws_iam_role.a'),
      tfRole([tfTrustStatement({ AWS: `arn:aws:iam::${WIDENED_TRUST_ACCOUNT}:root` })], 'apiable-role-b', 'aws_iam_role.b'),
    ])
    const result = gateOf(intendedCfn, intendedCfn, secondDivergesTf)
    expect(result.passed).toBe(false)
    // The divergence is the SECOND role's trust account, keyed per role node so the first does not mask it.
    const divergence = valueDivergence(result, 'role-trust-account:iam-role:apiable-role-b')
    expect(divergence?.detail).toContain(WIDENED_TRUST_ACCOUNT)
    expect(divergence?.channels).toEqual(['terraform'])
    // The first role's trust account agrees and must NOT be reported.
    expect(valueDivergence(result, 'role-trust-account:iam-role:apiable-role-a')).toBeUndefined()
  })

  // contract: S6 — an invoke permission scoped to a different source is caught (M6)
  it('S6: two channels whose function-invoke permission is scoped to different sources → the check FAILS on the divergent source (by value, not presence)', () => {
    const sourceACfn = cfnInvokePermission('arn:aws:cognito-idp:eu-central-1:034444869755:userpool/pool-a')
    const sourceBTf = tfPlan([tfInvokePermission('arn:aws:cognito-idp:eu-central-1:034444869755:userpool/pool-b')])
    const result = gateOf(sourceACfn, sourceACfn, sourceBTf)
    expect(result.passed).toBe(false)
    const divergence = permissionDivergence(result)
    expect(divergence?.detail).toContain('grant:invoke')
    expect(divergence?.channels).toEqual(['terraform'])
  })

  // contract: S7 — tightening the grant comparison does not disturb existing verdicts (regression)
  it('S7: the gateway access-role pilot verdict is unchanged after the grant/trust changes — no new false alarm, no newly-missed divergence', () => {
    const pilotName = 'apiable-gateway-management-role'
    const pilotCfn = cfnRole([cfnTrustStatement({ AWS: `arn:aws:iam::${INTENDED_TRUST_ACCOUNT}:root` })], pilotName)
    const pilotTf = tfPlan([tfRole([tfTrustStatement({ AWS: `arn:aws:iam::${INTENDED_TRUST_ACCOUNT}:root` })], pilotName)])
    const agree = gateOf(pilotCfn, pilotCfn, pilotTf)
    expect(agree.passed).toBe(true)

    // And a genuine single-statement trust-account divergence is still caught (not newly missed).
    const divergentTf = tfPlan([tfRole([tfTrustStatement({ AWS: `arn:aws:iam::${WIDENED_TRUST_ACCOUNT}:root` })], pilotName)])
    const caught = gateOf(pilotCfn, pilotCfn, divergentTf)
    expect(caught.passed).toBe(false)
    expect(valueDivergence(caught, 'role-trust-account')?.channels).toEqual(['terraform'])
  })

  // contract: S8 — a divergence between two different roles' trusts is caught, not pooled away (F2)
  it('S8: two roles both trusting the same account, one role widened in a single channel (extra any-principal statement) → the check FAILS per role, never pooled into one comparison that nets out the swap', () => {
    // Both roles trust the SAME account in every channel, so the per-role trusted-account value row is
    // identical everywhere and only the per-role grant ref can catch the swap. CFN/CDK widen role-b with an
    // extra {AWS:'*'}; Terraform widens role-a instead. Pooled under one `grant:assume-role` ref the two
    // multisets are equal and the gate passes (fail-open); filed per owning role each side diverges.
    const root = (account: string): unknown => ({ AWS: `arn:aws:iam::${account}:root` })
    const cfnRolesWidened = (wildcardRole: 'a' | 'b'): unknown => ({
      Resources: {
        RoleA: {
          Type: 'AWS::IAM::Role',
          Properties: {
            RoleName: 'apiable-role-a',
            Tags: [{ Key: 'apiable:logical-id', Value: 'apiable-role-a' }],
            AssumeRolePolicyDocument: {
              Version: '2012-10-17',
              Statement: [cfnTrustStatement(root(INTENDED_TRUST_ACCOUNT)), ...(wildcardRole === 'a' ? [cfnTrustStatement({ AWS: '*' })] : [])],
            },
          },
        },
        RoleB: {
          Type: 'AWS::IAM::Role',
          Properties: {
            RoleName: 'apiable-role-b',
            Tags: [{ Key: 'apiable:logical-id', Value: 'apiable-role-b' }],
            AssumeRolePolicyDocument: {
              Version: '2012-10-17',
              Statement: [cfnTrustStatement(root(INTENDED_TRUST_ACCOUNT)), ...(wildcardRole === 'b' ? [cfnTrustStatement({ AWS: '*' })] : [])],
            },
          },
        },
      },
    })
    const tfRolesWidened = (wildcardRole: 'a' | 'b'): unknown =>
      tfPlan([
        tfRole(
          [tfTrustStatement(root(INTENDED_TRUST_ACCOUNT)), ...(wildcardRole === 'a' ? [tfTrustStatement({ AWS: '*' })] : [])],
          'apiable-role-a',
          'aws_iam_role.a',
        ),
        tfRole(
          [tfTrustStatement(root(INTENDED_TRUST_ACCOUNT)), ...(wildcardRole === 'b' ? [tfTrustStatement({ AWS: '*' })] : [])],
          'apiable-role-b',
          'aws_iam_role.b',
        ),
      ])
    const result = gateOf(cfnRolesWidened('b'), cfnRolesWidened('b'), tfRolesWidened('a'))
    expect(result.passed).toBe(false)
    // Caught on role-a's OWN grant ref: its trust is widened only in terraform, so terraform is the outlier
    // there — never pooled with role-b's opposite widening, which would net the two swaps out to agreement.
    const divergence = permissionDivergence(result)
    expect(divergence?.detail).toContain('grant:assume-role:iam-role:apiable-role-a')
    expect(divergence?.channels).toEqual(['terraform'])
  })
})
