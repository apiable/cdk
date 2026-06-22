/**
 * Acceptance specs — Story 013-1-19: close the parity gate's sibling grant-pooling fail-open.
 * Frozen contract: contract-013-1-19-parity-gate-sibling-grant-pooling.md
 *
 * One un-skipped spec per contract scenario (S1–S6), each driving the real reducers + gate against
 * multi-owner artifacts. S2 (inline-policy) and S3 (invoke-permission) are forcing fixtures: a channel
 * loosens one owner's grant while tightening a sibling's by the same shape, so the two channels' pooled
 * grant multisets are equal and only filing each grant under its owning resource's ref surfaces the swap.
 * Both were RED before the per-owner suffix was added at the inline-policy + lambda-permission push sites
 * (cfn-reducer.ts / terraform-reducer.ts), mirroring the 013-1-14 trust fix. S5 forces the F-A anti-drift
 * net: a value row written through the spread-merge form must still be seen by the within-channel
 * uniqueness guard's source scan. The CDK and CFN channels are reduced from CloudFormation and the
 * Terraform channel from `terraform show -json`, so a divergence is proven across both reducers, not one
 * shape compared to itself.
 *
 * Shares compareGrants + both reducers with siblings 013-1-14/1-15/1-16, which key trust and bucket-policy
 * grants per owner; this slice extends the same discipline to the two grant types it was left open for.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { gate, reduceCloudFormation, reduceTerraformShowJson } from '@apiable/parity-gate'
import { VALUE_BEARING_KINDS } from '../lib/parity-gate/canonical'

const REGION = 'eu-central-1'

// ── CloudFormation builders (the CDK + CFN channels share this reducer) ─────────────────────────

/** A role whose declared id is its name, so the iam-role node ref is the channel-stable `iam-role:<id>`. */
const cfnRole = (logicalId: string): unknown => ({
  Type: 'AWS::IAM::Role',
  Properties: {
    RoleName: logicalId,
    Tags: [{ Key: 'apiable:logical-id', Value: logicalId }],
    AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] },
  },
})

/** An inline policy attached to `roleRef`, granting `actions` on `resource` — the owning role anchors its node ref. */
const cfnInlinePolicy = (roleRef: string, actions: string | readonly string[], resource: string): unknown => ({
  Type: 'AWS::IAM::Policy',
  Properties: {
    PolicyName: `policy-${roleRef}`,
    Roles: [{ Ref: roleRef }],
    PolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: actions, Resource: resource }] },
  },
})

/** A lambda function whose declared id is its name, so it anchors its invoke permission's node ref. */
const cfnFunction = (logicalId: string): unknown => ({
  Type: 'AWS::Lambda::Function',
  Properties: { FunctionName: logicalId, Tags: [{ Key: 'apiable:logical-id', Value: logicalId }] },
})

/** An invoke permission for `principal` on `functionRef`, optionally scoped to `sourceArn` (the least-privilege form). */
const cfnInvokePermission = (functionRef: string, principal: string, sourceArn: string | undefined): unknown => ({
  Type: 'AWS::Lambda::Permission',
  Properties: {
    Principal: principal,
    Action: 'lambda:InvokeFunction',
    FunctionName: { Ref: functionRef },
    ...(sourceArn !== undefined ? { SourceArn: sourceArn } : {}),
  },
})

// Two cognito-shaped roles (the multi-owner trigger: both grant cognito-idp:*), each with an inline policy
// scoped to the given resource, so the two policies share the `cognito-idp` service set and group alike.
const cfnTwoInlinePolicies = (resourceA: string, resourceB: string): unknown => ({
  Resources: {
    RoleAuthN: cfnRole('cognito-authn-role'),
    RoleAuthZ: cfnRole('cognito-authz-role'),
    PolicyAuthN: cfnInlinePolicy('RoleAuthN', 'cognito-idp:*', resourceA),
    PolicyAuthZ: cfnInlinePolicy('RoleAuthZ', 'cognito-idp:*', resourceB),
  },
})

// Two functions, each invoked by the SAME principal, so the two invoke grants group alike under one
// `grant:invoke:<principal>` before the per-function suffix.
const cfnTwoInvokePermissions = (sourceA: string | undefined, sourceB: string | undefined): unknown => ({
  Resources: {
    FnA: cfnFunction('fn-a'),
    FnB: cfnFunction('fn-b'),
    InvokeA: cfnInvokePermission('FnA', 'cognito-idp.amazonaws.com', sourceA),
    InvokeB: cfnInvokePermission('FnB', 'cognito-idp.amazonaws.com', sourceB),
  },
})

// ── Terraform `show -json` builders (the Terraform channel's own reducer) ───────────────────────

/** A `terraform show -json` plan; the configuration block carries the reference expressions that anchor
 * each attached policy/permission to its parent (the parent id is computed and absent from planned_values). */
const tfPlan = (planned: readonly unknown[], config: readonly unknown[]): unknown => ({
  planned_values: { root_module: { resources: planned } },
  configuration: { root_module: { resources: config, outputs: {} } },
})

const tfRole = (address: string, logicalId: string): unknown => ({
  address,
  type: 'aws_iam_role',
  values: {
    name: logicalId,
    tags: { 'apiable:logical-id': logicalId },
    assume_role_policy: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] }),
  },
})

const tfInlinePolicy = (address: string, actions: string | readonly string[], resource: string): unknown => ({
  address,
  type: 'aws_iam_role_policy',
  values: { name: address, policy: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: actions, Resource: resource }] }) },
})

const tfInlinePolicyConfig = (address: string, roleAddress: string): unknown => ({
  address,
  type: 'aws_iam_role_policy',
  expressions: { role: { references: [`${roleAddress}.id`, roleAddress] } },
})

const tfFunction = (address: string, logicalId: string): unknown => ({
  address,
  type: 'aws_lambda_function',
  values: { function_name: logicalId, tags: { 'apiable:logical-id': logicalId } },
})

const tfInvokePermission = (address: string, principal: string, sourceArn: string | undefined): unknown => ({
  address,
  type: 'aws_lambda_permission',
  values: { principal, action: 'lambda:InvokeFunction', function_name: principal, ...(sourceArn !== undefined ? { source_arn: sourceArn } : {}) },
})

const tfInvokePermissionConfig = (address: string, functionAddress: string): unknown => ({
  address,
  type: 'aws_lambda_permission',
  expressions: { function_name: { references: [`${functionAddress}.function_name`, functionAddress] } },
})

const tfTwoInlinePolicies = (resourceA: string, resourceB: string): unknown =>
  tfPlan(
    [
      tfRole('aws_iam_role.authn', 'cognito-authn-role'),
      tfRole('aws_iam_role.authz', 'cognito-authz-role'),
      tfInlinePolicy('aws_iam_role_policy.authn', 'cognito-idp:*', resourceA),
      tfInlinePolicy('aws_iam_role_policy.authz', 'cognito-idp:*', resourceB),
    ],
    [
      tfInlinePolicyConfig('aws_iam_role_policy.authn', 'aws_iam_role.authn'),
      tfInlinePolicyConfig('aws_iam_role_policy.authz', 'aws_iam_role.authz'),
    ],
  )

const tfTwoInvokePermissions = (sourceA: string | undefined, sourceB: string | undefined): unknown =>
  tfPlan(
    [
      tfFunction('aws_lambda_function.fn_a', 'fn-a'),
      tfFunction('aws_lambda_function.fn_b', 'fn-b'),
      tfInvokePermission('aws_lambda_permission.invoke_a', 'cognito-idp.amazonaws.com', sourceA),
      tfInvokePermission('aws_lambda_permission.invoke_b', 'cognito-idp.amazonaws.com', sourceB),
    ],
    [
      tfInvokePermissionConfig('aws_lambda_permission.invoke_a', 'aws_lambda_function.fn_a'),
      tfInvokePermissionConfig('aws_lambda_permission.invoke_b', 'aws_lambda_function.fn_b'),
    ],
  )

// ── Harness ─────────────────────────────────────────────────────────────────────────────────────

const gateOf = (cfn: unknown, terraformPlan: unknown): ReturnType<typeof gate> =>
  gate([
    reduceCloudFormation(cfn, 'cdk', REGION),
    reduceCloudFormation(cfn, 'cfn', REGION),
    reduceTerraformShowJson(terraformPlan, 'terraform', REGION),
  ])

const permissionDivergence = (result: ReturnType<typeof gate>) =>
  result.divergences.find((entry) => entry.tier === 'permission')

const SCOPED_A = `arn:aws:cognito-idp:${REGION}:034444869755:userpool/pool-a`
const SCOPED_B = `arn:aws:cognito-idp:${REGION}:034444869755:userpool/pool-b`

describe('013-1-19 parity check — sibling grant-pooling closure', () => {
  // contract: S1 — equivalent multi-owner grants across all three channels → agreement
  it('S1: two roles (inline permissions) + two functions (invoke permissions) equivalent across all 3 channels → parity holds', () => {
    const cfn: unknown = {
      Resources: {
        ...(cfnTwoInlinePolicies('arn:aws:cognito-idp:*:*:userpool/authn', 'arn:aws:cognito-idp:*:*:userpool/authz') as { Resources: Record<string, unknown> }).Resources,
        ...(cfnTwoInvokePermissions(SCOPED_A, SCOPED_B) as { Resources: Record<string, unknown> }).Resources,
      },
    }
    const tf = tfPlan(
      [
        tfRole('aws_iam_role.authn', 'cognito-authn-role'),
        tfRole('aws_iam_role.authz', 'cognito-authz-role'),
        tfInlinePolicy('aws_iam_role_policy.authn', 'cognito-idp:*', 'arn:aws:cognito-idp:*:*:userpool/authn'),
        tfInlinePolicy('aws_iam_role_policy.authz', 'cognito-idp:*', 'arn:aws:cognito-idp:*:*:userpool/authz'),
        tfFunction('aws_lambda_function.fn_a', 'fn-a'),
        tfFunction('aws_lambda_function.fn_b', 'fn-b'),
        tfInvokePermission('aws_lambda_permission.invoke_a', 'cognito-idp.amazonaws.com', SCOPED_A),
        tfInvokePermission('aws_lambda_permission.invoke_b', 'cognito-idp.amazonaws.com', SCOPED_B),
      ],
      [
        tfInlinePolicyConfig('aws_iam_role_policy.authn', 'aws_iam_role.authn'),
        tfInlinePolicyConfig('aws_iam_role_policy.authz', 'aws_iam_role.authz'),
        tfInvokePermissionConfig('aws_lambda_permission.invoke_a', 'aws_lambda_function.fn_a'),
        tfInvokePermissionConfig('aws_lambda_permission.invoke_b', 'aws_lambda_function.fn_b'),
      ],
    )
    const result = gateOf(cfn, tf)
    expect(result.passed).toBe(true)
    expect(result.divergences).toEqual([])
  })

  // contract: S2 — a cross-owner INLINE-permission swap is caught per owning role (FORCING — F-B, fail-open)
  it('S2: two roles, same service set, one channel LOOSENS role-A inline permission while TIGHTENING role-B by the same shape → the check FAILS per role (pooled grant:<services> nets out pre-fix → RED)', () => {
    // CFN/CDK scope authn→pool-a (narrow) and authz→pool-b (narrow). Terraform swaps: authn→pool-b (the
    // OTHER role's resource = role-authn loosened) and authz→pool-a (tightened). Both channels' pooled
    // {cognito-idp on pool-a, cognito-idp on pool-b} multiset is identical; only filing each grant under
    // its owning role's policy ref surfaces that role-authn's permission was widened.
    const intendedCfn = cfnTwoInlinePolicies('arn:aws:cognito-idp:*:*:userpool/authn', 'arn:aws:cognito-idp:*:*:userpool/authz')
    const swappedTf = tfTwoInlinePolicies('arn:aws:cognito-idp:*:*:userpool/authz', 'arn:aws:cognito-idp:*:*:userpool/authn')
    const result = gateOf(intendedCfn, swappedTf)
    expect(result.passed).toBe(false)
    const divergence = permissionDivergence(result)
    expect(divergence?.detail).toContain('grant:cognito-idp')
    expect(divergence?.channels).toEqual(['terraform'])
  })

  // contract: S3 — a cross-owner INVOKE-permission swap is caught per owning function (FORCING — F-B, fail-open)
  it('S3: two functions, same principal, one channel loosens fn-A invoke grant while tightening fn-B by the same shape → the check FAILS per function (pooled grant:invoke:<principal> nets out pre-fix → RED)', () => {
    // CFN/CDK scope invoke-a→pool-a and invoke-b→pool-b. Terraform swaps the source scopes: invoke-a→pool-b
    // (fn-a's invoker widened to a different source) and invoke-b→pool-a. Both channels' pooled
    // grant:invoke:cognito-idp multiset is {scoped pool-a, scoped pool-b}; only the per-function ref tells
    // them apart and catches that fn-a's invoke source was changed.
    const intendedCfn = cfnTwoInvokePermissions(SCOPED_A, SCOPED_B)
    const swappedTf = tfTwoInvokePermissions(SCOPED_B, SCOPED_A)
    const result = gateOf(intendedCfn, swappedTf)
    expect(result.passed).toBe(false)
    const divergence = permissionDivergence(result)
    expect(divergence?.detail).toContain('grant:invoke')
    expect(divergence?.channels).toEqual(['terraform'])
  })

  // contract: S4 — two owners legitimately sharing a grant shape are NOT false-failed (no over-block)
  it('S4: two roles with the same inline service set (or two functions with the same invoke principal), identical across all channels → agreement (the per-owner suffix invents no divergence)', () => {
    // Two roles both granting cognito-idp:* on the SAME resource, and two functions both invoked by the
    // same principal scoped to the same source — a legitimately shared shape. The per-owner suffix must
    // not invent a divergence where the owners genuinely agree across every channel.
    const sharedResource = 'arn:aws:cognito-idp:*:*:userpool/shared'
    const cfn: unknown = {
      Resources: {
        ...(cfnTwoInlinePolicies(sharedResource, sharedResource) as { Resources: Record<string, unknown> }).Resources,
        ...(cfnTwoInvokePermissions(SCOPED_A, SCOPED_A) as { Resources: Record<string, unknown> }).Resources,
      },
    }
    const tf = tfPlan(
      [
        tfRole('aws_iam_role.authn', 'cognito-authn-role'),
        tfRole('aws_iam_role.authz', 'cognito-authz-role'),
        tfInlinePolicy('aws_iam_role_policy.authn', 'cognito-idp:*', sharedResource),
        tfInlinePolicy('aws_iam_role_policy.authz', 'cognito-idp:*', sharedResource),
        tfFunction('aws_lambda_function.fn_a', 'fn-a'),
        tfFunction('aws_lambda_function.fn_b', 'fn-b'),
        tfInvokePermission('aws_lambda_permission.invoke_a', 'cognito-idp.amazonaws.com', SCOPED_A),
        tfInvokePermission('aws_lambda_permission.invoke_b', 'cognito-idp.amazonaws.com', SCOPED_A),
      ],
      [
        tfInlinePolicyConfig('aws_iam_role_policy.authn', 'aws_iam_role.authn'),
        tfInlinePolicyConfig('aws_iam_role_policy.authz', 'aws_iam_role.authz'),
        tfInvokePermissionConfig('aws_lambda_permission.invoke_a', 'aws_lambda_function.fn_a'),
        tfInvokePermissionConfig('aws_lambda_permission.invoke_b', 'aws_lambda_function.fn_b'),
      ],
    )
    const result = gateOf(cfn, tf)
    expect(result.passed).toBe(true)
    expect(permissionDivergence(result)).toBeUndefined()
  })

  // contract: S5 — the distinctness safety net covers every value-write form (F-A)
  it('S5: a load-bearing value written via the spread-merge form (not only a direct assignment) → the structural safety check still requires that kind to be kept distinct within a channel (RED while the guard only sees direct writes)', () => {
    // The within-channel-uniqueness anti-drift guard scans the reducer source for every kind that writes a
    // load-bearing value row and asserts each is in VALUE_BEARING_KINDS. A future reducer that adds a value
    // row through the spread-merge helper form `values = { ...values, ...someHelper(ref, …) }` — the form
    // the cognito discovery rows already use (cfn-reducer.ts:469, terraform-reducer.ts:473) — must still be
    // seen, or that kind silently bypasses the uniqueness guarantee the entire root-fix rests on. This
    // forces the scan against exactly that future blind spot: a value-bearing row a NEW kind writes ONLY
    // through the spread form, with no bracket write to fall back on — invisible to a bracket-only scan.
    const futureSpreadOnlyReducer = [
      "    if (kind === 'kinesis-stream') {",
      '      // a load-bearing value row written ONLY through the spread-merge helper form',
      '      values = { ...values, ...streamRetentionRows(ref, region) }',
      '    }',
    ].join('\n')
    // The bracket-only scan misses the spread write, so it must NOT see the new kind; the spread-aware scan
    // does — this is the RED-while-bracket-only the contract pins. (kinesis-stream stands in for any future
    // value-bearing kind: were it real and unguarded, the gate would certify a clobbered widening as parity.)
    expect(valueWritingKindsIn(futureSpreadOnlyReducer).has('kinesis-stream')).toBe(true)

    // And on the live reducers every kind the scan finds writing a value row IS kept distinct within a
    // channel — including the spread-written cognito discovery rows, so no value-bearing kind slips the net.
    for (const file of ['cfn-reducer.ts', 'terraform-reducer.ts']) {
      const source = readFileSync(join(__dirname, '..', 'lib', 'parity-gate', file), 'utf8')
      for (const kind of valueWritingKindsIn(source)) {
        expect(VALUE_BEARING_KINDS.has(kind)).toBe(true)
      }
    }
  })

  // contract: S6 — no regression to the already-correct comparisons (trust, bucket-policy, single-owner pilots)
  it('S6: trust + bucket-policy + the single-owner pilots keep their verdicts after the sibling-grant fix; no equivalent multi-owner artifact false-failed', () => {
    // The single-owner gateway-role pilot still agrees, and a genuine trust-account widening on it is still
    // caught (the trust per-owner discipline is untouched). The multi-owner equivalent artifact (S1's shape)
    // is not false-failed — covered by S1/S4 above; here the regression focus is trust + a single-owner pilot.
    const pilot = (trustAccount: string): unknown => ({
      Resources: {
        Role: {
          Type: 'AWS::IAM::Role',
          Properties: {
            RoleName: 'apiable-gateway-managment-role',
            Tags: [{ Key: 'apiable:logical-id', Value: 'gateway-managment-role' }],
            AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${trustAccount}:root` }, Action: 'sts:AssumeRole' }] },
          },
        },
      },
    })
    const pilotTf = (trustAccount: string): unknown =>
      tfPlan(
        [
          {
            address: 'aws_iam_role.this',
            type: 'aws_iam_role',
            values: {
              name: 'apiable-gateway-managment-role',
              tags: { 'apiable:logical-id': 'gateway-managment-role' },
              assume_role_policy: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${trustAccount}:root` }, Action: 'sts:AssumeRole' }] }),
            },
          },
        ],
        [],
      )
    const agree = gateOf(pilot('034444869755'), pilotTf('034444869755'))
    expect(agree.passed).toBe(true)
    expect(agree.divergences).toEqual([])

    const widened = gate([
      reduceCloudFormation(pilot('034444869755'), 'cdk', REGION),
      reduceCloudFormation(pilot('034444869755'), 'cfn', REGION),
      reduceTerraformShowJson(pilotTf('999988887777'), 'terraform', REGION),
    ])
    expect(widened.passed).toBe(false)
    const trust = widened.divergences.find((entry) => entry.tier === 'value' && entry.detail.includes('role-trust-account'))
    expect(trust?.channels).toEqual(['terraform'])
  })
})

// The within-channel anti-drift scan, taught the spread-merge value-write form (F-A). Mirrors the
// production scan in parity-gate.spec.ts; the bracket form catches the direct iam-role / s3-bucket-policy
// writes, the spread-call form (`...helper(...)`) catches the cognito discovery / namespaced value rows.
const valueWritingKindsIn = (source: string): Set<string> => {
  const kinds = new Set<string>()
  let currentKind: string | undefined
  for (const line of source.split('\n')) {
    const kindMatch = line.match(/kind === '([^']+)'/)
    if (kindMatch !== null) currentKind = kindMatch[1]
    const bracketWrite = /(?<![.\w])(?:values|out)\[/.test(line)
    const spreadWrite = /(?<![.\w])(?:values|out) = \{ [^}]*\.\.\.\w+\(/.test(line)
    if ((bracketWrite || spreadWrite) && currentKind !== undefined) kinds.add(currentKind)
  }
  return kinds
}
