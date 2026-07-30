"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const fs_1 = require("fs");
const path_1 = require("path");
const parity_gate_1 = require("@apiable/parity-gate");
const canonical_1 = require("../lib/parity-gate/canonical");
const REGION = 'eu-central-1';
// ── CloudFormation builders (the CDK + CFN channels share this reducer) ─────────────────────────
/** A role whose declared id is its name, so the iam-role node ref is the channel-stable `iam-role:<id>`. */
const cfnRole = (logicalId) => ({
    Type: 'AWS::IAM::Role',
    Properties: {
        RoleName: logicalId,
        Tags: [{ Key: 'apiable:logical-id', Value: logicalId }],
        AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] },
    },
});
/** An inline policy attached to `roleRef`, granting `actions` on `resource` — the owning role anchors its node ref. */
const cfnInlinePolicy = (roleRef, actions, resource) => ({
    Type: 'AWS::IAM::Policy',
    Properties: {
        PolicyName: `policy-${roleRef}`,
        Roles: [{ Ref: roleRef }],
        PolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: actions, Resource: resource }] },
    },
});
/** A lambda function whose declared id is its name, so it anchors its invoke permission's node ref. */
const cfnFunction = (logicalId) => ({
    Type: 'AWS::Lambda::Function',
    Properties: { FunctionName: logicalId, Tags: [{ Key: 'apiable:logical-id', Value: logicalId }] },
});
/** An invoke permission for `principal` on `functionRef`, optionally scoped to `sourceArn` (the least-privilege form). */
const cfnInvokePermission = (functionRef, principal, sourceArn) => ({
    Type: 'AWS::Lambda::Permission',
    Properties: {
        Principal: principal,
        Action: 'lambda:InvokeFunction',
        FunctionName: { Ref: functionRef },
        ...(sourceArn !== undefined ? { SourceArn: sourceArn } : {}),
    },
});
// Two cognito-shaped roles (the multi-owner trigger: both grant cognito-idp:*), each with an inline policy
// scoped to the given resource, so the two policies share the `cognito-idp` service set and group alike.
const cfnTwoInlinePolicies = (resourceA, resourceB) => ({
    Resources: {
        RoleAuthN: cfnRole('cognito-authn-role'),
        RoleAuthZ: cfnRole('cognito-authz-role'),
        PolicyAuthN: cfnInlinePolicy('RoleAuthN', 'cognito-idp:*', resourceA),
        PolicyAuthZ: cfnInlinePolicy('RoleAuthZ', 'cognito-idp:*', resourceB),
    },
});
// Two functions, each invoked by the SAME principal, so the two invoke grants group alike under one
// `grant:invoke:<principal>` before the per-function suffix.
const cfnTwoInvokePermissions = (sourceA, sourceB) => ({
    Resources: {
        FnA: cfnFunction('fn-a'),
        FnB: cfnFunction('fn-b'),
        InvokeA: cfnInvokePermission('FnA', 'cognito-idp.amazonaws.com', sourceA),
        InvokeB: cfnInvokePermission('FnB', 'cognito-idp.amazonaws.com', sourceB),
    },
});
// ── Terraform `show -json` builders (the Terraform channel's own reducer) ───────────────────────
/** A `terraform show -json` plan; the configuration block carries the reference expressions that anchor
 * each attached policy/permission to its parent (the parent id is computed and absent from planned_values). */
const tfPlan = (planned, config) => ({
    planned_values: { root_module: { resources: planned } },
    configuration: { root_module: { resources: config, outputs: {} } },
});
const tfRole = (address, logicalId) => ({
    address,
    type: 'aws_iam_role',
    values: {
        name: logicalId,
        tags: { 'apiable:logical-id': logicalId },
        assume_role_policy: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] }),
    },
});
const tfInlinePolicy = (address, actions, resource) => ({
    address,
    type: 'aws_iam_role_policy',
    values: { name: address, policy: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: actions, Resource: resource }] }) },
});
const tfInlinePolicyConfig = (address, roleAddress) => ({
    address,
    type: 'aws_iam_role_policy',
    expressions: { role: { references: [`${roleAddress}.id`, roleAddress] } },
});
const tfFunction = (address, logicalId) => ({
    address,
    type: 'aws_lambda_function',
    values: { function_name: logicalId, tags: { 'apiable:logical-id': logicalId } },
});
const tfInvokePermission = (address, principal, sourceArn) => ({
    address,
    type: 'aws_lambda_permission',
    values: { principal, action: 'lambda:InvokeFunction', function_name: principal, ...(sourceArn !== undefined ? { source_arn: sourceArn } : {}) },
});
const tfInvokePermissionConfig = (address, functionAddress) => ({
    address,
    type: 'aws_lambda_permission',
    expressions: { function_name: { references: [`${functionAddress}.function_name`, functionAddress] } },
});
const tfTwoInlinePolicies = (resourceA, resourceB) => tfPlan([
    tfRole('aws_iam_role.authn', 'cognito-authn-role'),
    tfRole('aws_iam_role.authz', 'cognito-authz-role'),
    tfInlinePolicy('aws_iam_role_policy.authn', 'cognito-idp:*', resourceA),
    tfInlinePolicy('aws_iam_role_policy.authz', 'cognito-idp:*', resourceB),
], [
    tfInlinePolicyConfig('aws_iam_role_policy.authn', 'aws_iam_role.authn'),
    tfInlinePolicyConfig('aws_iam_role_policy.authz', 'aws_iam_role.authz'),
]);
const tfTwoInvokePermissions = (sourceA, sourceB) => tfPlan([
    tfFunction('aws_lambda_function.fn_a', 'fn-a'),
    tfFunction('aws_lambda_function.fn_b', 'fn-b'),
    tfInvokePermission('aws_lambda_permission.invoke_a', 'cognito-idp.amazonaws.com', sourceA),
    tfInvokePermission('aws_lambda_permission.invoke_b', 'cognito-idp.amazonaws.com', sourceB),
], [
    tfInvokePermissionConfig('aws_lambda_permission.invoke_a', 'aws_lambda_function.fn_a'),
    tfInvokePermissionConfig('aws_lambda_permission.invoke_b', 'aws_lambda_function.fn_b'),
]);
// ── Harness ─────────────────────────────────────────────────────────────────────────────────────
const gateOf = (cfn, terraformPlan) => (0, parity_gate_1.gate)([
    (0, parity_gate_1.reduceCloudFormation)(cfn, 'cdk', REGION),
    (0, parity_gate_1.reduceCloudFormation)(cfn, 'cfn', REGION),
    (0, parity_gate_1.reduceTerraformShowJson)(terraformPlan, 'terraform', REGION),
]);
const permissionDivergence = (result) => result.divergences.find((entry) => entry.tier === 'permission');
const SCOPED_A = `arn:aws:cognito-idp:${REGION}:034444869755:userpool/pool-a`;
const SCOPED_B = `arn:aws:cognito-idp:${REGION}:034444869755:userpool/pool-b`;
describe('013-1-19 parity check — sibling grant-pooling closure', () => {
    // contract: S1 — equivalent multi-owner grants across all three channels → agreement
    it('S1: two roles (inline permissions) + two functions (invoke permissions) equivalent across all 3 channels → parity holds', () => {
        const cfn = {
            Resources: {
                ...cfnTwoInlinePolicies('arn:aws:cognito-idp:*:*:userpool/authn', 'arn:aws:cognito-idp:*:*:userpool/authz').Resources,
                ...cfnTwoInvokePermissions(SCOPED_A, SCOPED_B).Resources,
            },
        };
        const tf = tfPlan([
            tfRole('aws_iam_role.authn', 'cognito-authn-role'),
            tfRole('aws_iam_role.authz', 'cognito-authz-role'),
            tfInlinePolicy('aws_iam_role_policy.authn', 'cognito-idp:*', 'arn:aws:cognito-idp:*:*:userpool/authn'),
            tfInlinePolicy('aws_iam_role_policy.authz', 'cognito-idp:*', 'arn:aws:cognito-idp:*:*:userpool/authz'),
            tfFunction('aws_lambda_function.fn_a', 'fn-a'),
            tfFunction('aws_lambda_function.fn_b', 'fn-b'),
            tfInvokePermission('aws_lambda_permission.invoke_a', 'cognito-idp.amazonaws.com', SCOPED_A),
            tfInvokePermission('aws_lambda_permission.invoke_b', 'cognito-idp.amazonaws.com', SCOPED_B),
        ], [
            tfInlinePolicyConfig('aws_iam_role_policy.authn', 'aws_iam_role.authn'),
            tfInlinePolicyConfig('aws_iam_role_policy.authz', 'aws_iam_role.authz'),
            tfInvokePermissionConfig('aws_lambda_permission.invoke_a', 'aws_lambda_function.fn_a'),
            tfInvokePermissionConfig('aws_lambda_permission.invoke_b', 'aws_lambda_function.fn_b'),
        ]);
        const result = gateOf(cfn, tf);
        expect(result.passed).toBe(true);
        expect(result.divergences).toEqual([]);
    });
    // contract: S2 — a cross-owner INLINE-permission swap is caught per owning role (FORCING — F-B, fail-open)
    it('S2: two roles, same service set, one channel LOOSENS role-A inline permission while TIGHTENING role-B by the same shape → the check FAILS per role (pooled grant:<services> nets out pre-fix → RED)', () => {
        // CFN/CDK scope authn→pool-a (narrow) and authz→pool-b (narrow). Terraform swaps: authn→pool-b (the
        // OTHER role's resource = role-authn loosened) and authz→pool-a (tightened). Both channels' pooled
        // {cognito-idp on pool-a, cognito-idp on pool-b} multiset is identical; only filing each grant under
        // its owning role's policy ref surfaces that role-authn's permission was widened.
        const intendedCfn = cfnTwoInlinePolicies('arn:aws:cognito-idp:*:*:userpool/authn', 'arn:aws:cognito-idp:*:*:userpool/authz');
        const swappedTf = tfTwoInlinePolicies('arn:aws:cognito-idp:*:*:userpool/authz', 'arn:aws:cognito-idp:*:*:userpool/authn');
        const result = gateOf(intendedCfn, swappedTf);
        expect(result.passed).toBe(false);
        const divergence = permissionDivergence(result);
        expect(divergence?.detail).toContain('grant:cognito-idp');
        expect(divergence?.channels).toEqual(['terraform']);
    });
    // contract: S3 — a cross-owner INVOKE-permission swap is caught per owning function (FORCING — F-B, fail-open)
    it('S3: two functions, same principal, one channel loosens fn-A invoke grant while tightening fn-B by the same shape → the check FAILS per function (pooled grant:invoke:<principal> nets out pre-fix → RED)', () => {
        // CFN/CDK scope invoke-a→pool-a and invoke-b→pool-b. Terraform swaps the source scopes: invoke-a→pool-b
        // (fn-a's invoker widened to a different source) and invoke-b→pool-a. Both channels' pooled
        // grant:invoke:cognito-idp multiset is {scoped pool-a, scoped pool-b}; only the per-function ref tells
        // them apart and catches that fn-a's invoke source was changed.
        const intendedCfn = cfnTwoInvokePermissions(SCOPED_A, SCOPED_B);
        const swappedTf = tfTwoInvokePermissions(SCOPED_B, SCOPED_A);
        const result = gateOf(intendedCfn, swappedTf);
        expect(result.passed).toBe(false);
        const divergence = permissionDivergence(result);
        expect(divergence?.detail).toContain('grant:invoke');
        expect(divergence?.channels).toEqual(['terraform']);
    });
    // contract: S4 — two owners legitimately sharing a grant shape are NOT false-failed (no over-block)
    it('S4: two roles with the same inline service set (or two functions with the same invoke principal), identical across all channels → agreement (the per-owner suffix invents no divergence)', () => {
        // Two roles both granting cognito-idp:* on the SAME resource, and two functions both invoked by the
        // same principal scoped to the same source — a legitimately shared shape. The per-owner suffix must
        // not invent a divergence where the owners genuinely agree across every channel.
        const sharedResource = 'arn:aws:cognito-idp:*:*:userpool/shared';
        const cfn = {
            Resources: {
                ...cfnTwoInlinePolicies(sharedResource, sharedResource).Resources,
                ...cfnTwoInvokePermissions(SCOPED_A, SCOPED_A).Resources,
            },
        };
        const tf = tfPlan([
            tfRole('aws_iam_role.authn', 'cognito-authn-role'),
            tfRole('aws_iam_role.authz', 'cognito-authz-role'),
            tfInlinePolicy('aws_iam_role_policy.authn', 'cognito-idp:*', sharedResource),
            tfInlinePolicy('aws_iam_role_policy.authz', 'cognito-idp:*', sharedResource),
            tfFunction('aws_lambda_function.fn_a', 'fn-a'),
            tfFunction('aws_lambda_function.fn_b', 'fn-b'),
            tfInvokePermission('aws_lambda_permission.invoke_a', 'cognito-idp.amazonaws.com', SCOPED_A),
            tfInvokePermission('aws_lambda_permission.invoke_b', 'cognito-idp.amazonaws.com', SCOPED_A),
        ], [
            tfInlinePolicyConfig('aws_iam_role_policy.authn', 'aws_iam_role.authn'),
            tfInlinePolicyConfig('aws_iam_role_policy.authz', 'aws_iam_role.authz'),
            tfInvokePermissionConfig('aws_lambda_permission.invoke_a', 'aws_lambda_function.fn_a'),
            tfInvokePermissionConfig('aws_lambda_permission.invoke_b', 'aws_lambda_function.fn_b'),
        ]);
        const result = gateOf(cfn, tf);
        expect(result.passed).toBe(true);
        expect(permissionDivergence(result)).toBeUndefined();
    });
    // contract: S5 — the distinctness safety net covers every value-write form (F-A)
    it('S5: a load-bearing value written via the spread-merge form (not only a direct assignment) → the structural safety check still requires that kind to be kept distinct within a channel (RED while the guard only sees direct writes)', () => {
        // The within-channel-uniqueness anti-drift guard scans the reducer source for every kind that writes a
        // load-bearing value row and asserts each is in VALUE_BEARING_KINDS. A future reducer that adds a value
        // row through the spread-merge helper form `values = { ...values, ...someHelper(ref, …) }` — the form
        // the cognito discovery rows already use (the `discoveryValueRows` spread in both reducers) — must still
        // be seen, or that kind silently bypasses the uniqueness guarantee the entire root-fix rests on. This
        // forces the scan against exactly that future blind spot: a value-bearing row a NEW kind writes ONLY
        // through the spread form, with no bracket write to fall back on — invisible to a bracket-only scan.
        const futureSpreadOnlyReducer = [
            "    if (kind === 'kinesis-stream') {",
            '      // a load-bearing value row written ONLY through the spread-merge helper form',
            '      values = { ...values, ...streamRetentionRows(ref, region) }',
            '    }',
        ].join('\n');
        // The bracket-only scan misses the spread write, so it must NOT see the new kind; the spread-aware scan
        // does — this is the RED-while-bracket-only the contract pins. (kinesis-stream stands in for any future
        // value-bearing kind: were it real and unguarded, the gate would certify a clobbered widening as parity.)
        expect(valueWritingKindsIn(futureSpreadOnlyReducer).has('kinesis-stream')).toBe(true);
        // And on the live reducers every kind the scan finds writing a value row IS kept distinct within a
        // channel — including the spread-written cognito discovery rows, so no value-bearing kind slips the net.
        for (const file of ['cfn-reducer.ts', 'terraform-reducer.ts']) {
            const source = (0, fs_1.readFileSync)((0, path_1.join)(__dirname, '..', 'lib', 'parity-gate', file), 'utf8');
            for (const kind of valueWritingKindsIn(source)) {
                expect(canonical_1.VALUE_BEARING_KINDS.has(kind)).toBe(true);
            }
        }
    });
    // contract: S6 — no regression to the already-correct comparisons (trust, bucket-policy, single-owner pilots)
    it('S6: trust + bucket-policy + the single-owner pilots keep their verdicts after the sibling-grant fix; no equivalent multi-owner artifact false-failed', () => {
        // The single-owner gateway-role pilot still agrees, and a genuine trust-account widening on it is still
        // caught (the trust per-owner discipline is untouched). The multi-owner equivalent artifact (S1's shape)
        // is not false-failed — covered by S1/S4 above; here the regression focus is trust + a single-owner pilot.
        const pilot = (trustAccount) => ({
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
        });
        const pilotTf = (trustAccount) => tfPlan([
            {
                address: 'aws_iam_role.this',
                type: 'aws_iam_role',
                values: {
                    name: 'apiable-gateway-managment-role',
                    tags: { 'apiable:logical-id': 'gateway-managment-role' },
                    assume_role_policy: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${trustAccount}:root` }, Action: 'sts:AssumeRole' }] }),
                },
            },
        ], []);
        const agree = gateOf(pilot('034444869755'), pilotTf('034444869755'));
        expect(agree.passed).toBe(true);
        expect(agree.divergences).toEqual([]);
        const widened = (0, parity_gate_1.gate)([
            (0, parity_gate_1.reduceCloudFormation)(pilot('034444869755'), 'cdk', REGION),
            (0, parity_gate_1.reduceCloudFormation)(pilot('034444869755'), 'cfn', REGION),
            (0, parity_gate_1.reduceTerraformShowJson)(pilotTf('999988887777'), 'terraform', REGION),
        ]);
        expect(widened.passed).toBe(false);
        const trust = widened.divergences.find((entry) => entry.tier === 'value' && entry.detail.includes('role-trust-account'));
        expect(trust?.channels).toEqual(['terraform']);
    });
});
// The within-channel anti-drift scan, taught the spread-merge value-write form (F-A). Mirrors the
// production scan in parity-gate.spec.ts; the bracket form catches the direct iam-role / s3-bucket-policy
// writes, the spread-call form (`...helper(...)`) catches the cognito discovery / namespaced value rows.
const valueWritingKindsIn = (source) => {
    const kinds = new Set();
    let currentKind;
    for (const line of source.split('\n')) {
        const kindMatch = line.match(/kind === '([^']+)'/);
        if (kindMatch !== null)
            currentKind = kindMatch[1];
        const bracketWrite = /(?<![.\w])(?:values|out)\[/.test(line);
        const spreadWrite = /(?<![.\w])(?:values|out) = \{ [^}]*\.\.\.\w+\(/.test(line);
        if ((bracketWrite || spreadWrite) && currentKind !== undefined)
            kinds.add(currentKind);
    }
    return kinds;
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXRkZC0wMTMtMS0xOS1wYXJpdHktZ2F0ZS1zaWJsaW5nLWdyYW50LXBvb2xpbmctZ2F0ZS5zcGVjLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXRkZC0wMTMtMS0xOS1wYXJpdHktZ2F0ZS1zaWJsaW5nLWdyYW50LXBvb2xpbmctZ2F0ZS5zcGVjLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBaUJHO0FBQ0gsMkJBQWlDO0FBQ2pDLCtCQUEyQjtBQUMzQixzREFBMEY7QUFDMUYsNERBQWtFO0FBRWxFLE1BQU0sTUFBTSxHQUFHLGNBQWMsQ0FBQTtBQUU3QixtR0FBbUc7QUFFbkcsNEdBQTRHO0FBQzVHLE1BQU0sT0FBTyxHQUFHLENBQUMsU0FBaUIsRUFBVyxFQUFFLENBQUMsQ0FBQztJQUMvQyxJQUFJLEVBQUUsZ0JBQWdCO0lBQ3RCLFVBQVUsRUFBRTtRQUNWLFFBQVEsRUFBRSxTQUFTO1FBQ25CLElBQUksRUFBRSxDQUFDLEVBQUUsR0FBRyxFQUFFLG9CQUFvQixFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsQ0FBQztRQUN2RCx3QkFBd0IsRUFBRSxFQUFFLE9BQU8sRUFBRSxZQUFZLEVBQUUsU0FBUyxFQUFFLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLFNBQVMsRUFBRSxFQUFFLE9BQU8sRUFBRSxzQkFBc0IsRUFBRSxFQUFFLE1BQU0sRUFBRSxnQkFBZ0IsRUFBRSxDQUFDLEVBQUU7S0FDaEs7Q0FDRixDQUFDLENBQUE7QUFFRix1SEFBdUg7QUFDdkgsTUFBTSxlQUFlLEdBQUcsQ0FBQyxPQUFlLEVBQUUsT0FBbUMsRUFBRSxRQUFnQixFQUFXLEVBQUUsQ0FBQyxDQUFDO0lBQzVHLElBQUksRUFBRSxrQkFBa0I7SUFDeEIsVUFBVSxFQUFFO1FBQ1YsVUFBVSxFQUFFLFVBQVUsT0FBTyxFQUFFO1FBQy9CLEtBQUssRUFBRSxDQUFDLEVBQUUsR0FBRyxFQUFFLE9BQU8sRUFBRSxDQUFD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QUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsSUFBSSxLQUFLLE9BQU8sSUFBSSxLQUFLLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLENBQUE7UUFDeEgsTUFBTSxDQUFDLEtBQUssRUFBRSxRQUFRLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFBO0lBQ2hELENBQUMsQ0FBQyxDQUFBO0FBQ0osQ0FBQyxDQUFDLENBQUE7QUFFRixrR0FBa0c7QUFDbEcsMEdBQTBHO0FBQzFHLHlHQUF5RztBQUN6RyxNQUFNLG1CQUFtQixHQUFHLENBQUMsTUFBYyxFQUFlLEVBQUU7SUFDMUQsTUFBTSxLQUFLLEdBQUcsSUFBSSxHQUFHLEVBQVUsQ0FBQTtJQUMvQixJQUFJLFdBQStCLENBQUE7SUFDbkMsS0FBSyxNQUFNLElBQUksSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7UUFDdEMsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxDQUFBO1FBQ2xELElBQUksU0FBUyxLQUFLLElBQUk7WUFBRSxXQUFXLEdBQUcsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBQ2xELE1BQU0sWUFBWSxHQUFHLDRCQUE0QixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUM1RCxNQUFNLFdBQVcsR0FBRyxnREFBZ0QsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDL0UsSUFBSSxDQUFDLFlBQVksSUFBSSxXQUFXLENBQUMsSUFBSSxXQUFXLEtBQUssU0FBUztZQUFFLEtBQUssQ0FBQyxHQUFHLENBQUMsV0FBVyxDQUFDLENBQUE7SUFDeEYsQ0FBQztJQUNELE9BQU8sS0FBSyxDQUFBO0FBQ2QsQ0FBQyxDQUFBIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBBY2NlcHRhbmNlIHNwZWNzIOKAlCBTdG9yeSAwMTMtMS0xOTogY2xvc2UgdGhlIHBhcml0eSBnYXRlJ3Mgc2libGluZyBncmFudC1wb29saW5nIGZhaWwtb3Blbi5cbiAqIEZyb3plbiBjb250cmFjdDogY29udHJhY3QtMDEzLTEtMTktcGFyaXR5LWdhdGUtc2libGluZy1ncmFudC1wb29saW5nLm1kXG4gKlxuICogT25lIHVuLXNraXBwZWQgc3BlYyBwZXIgY29udHJhY3Qgc2NlbmFyaW8gKFMx4oCTUzYpLCBlYWNoIGRyaXZpbmcgdGhlIHJlYWwgcmVkdWNlcnMgKyBnYXRlIGFnYWluc3RcbiAqIG11bHRpLW93bmVyIGFydGlmYWN0cy4gUzIgKGlubGluZS1wb2xpY3kpIGFuZCBTMyAoaW52b2tlLXBlcm1pc3Npb24pIGFyZSBmb3JjaW5nIGZpeHR1cmVzOiBhIGNoYW5uZWxcbiAqIGxvb3NlbnMgb25lIG93bmVyJ3MgZ3JhbnQgd2hpbGUgdGlnaHRlbmluZyBhIHNpYmxpbmcncyBieSB0aGUgc2FtZSBzaGFwZSwgc28gdGhlIHR3byBjaGFubmVscycgcG9vbGVkXG4gKiBncmFudCBtdWx0aXNldHMgYXJlIGVxdWFsIGFuZCBvbmx5IGZpbGluZyBlYWNoIGdyYW50IHVuZGVyIGl0cyBvd25pbmcgcmVzb3VyY2UncyByZWYgc3VyZmFjZXMgdGhlIHN3YXAuXG4gKiBCb3RoIHdlcmUgUkVEIGJlZm9yZSB0aGUgcGVyLW93bmVyIHN1ZmZpeCB3YXMgYWRkZWQgYXQgdGhlIGlubGluZS1wb2xpY3kgKyBsYW1iZGEtcGVybWlzc2lvbiBwdXNoIHNpdGVzXG4gKiAoY2ZuLXJlZHVjZXIudHMgLyB0ZXJyYWZvcm0tcmVkdWNlci50cyksIG1pcnJvcmluZyB0aGUgMDEzLTEtMTQgdHJ1c3QgZml4LiBTNSBmb3JjZXMgdGhlIEYtQSBhbnRpLWRyaWZ0XG4gKiBuZXQ6IGEgdmFsdWUgcm93IHdyaXR0ZW4gdGhyb3VnaCB0aGUgc3ByZWFkLW1lcmdlIGZvcm0gbXVzdCBzdGlsbCBiZSBzZWVuIGJ5IHRoZSB3aXRoaW4tY2hhbm5lbFxuICogdW5pcXVlbmVzcyBndWFyZCdzIHNvdXJjZSBzY2FuLiBUaGUgQ0RLIGFuZCBDRk4gY2hhbm5lbHMgYXJlIHJlZHVjZWQgZnJvbSBDbG91ZEZvcm1hdGlvbiBhbmQgdGhlXG4gKiBUZXJyYWZvcm0gY2hhbm5lbCBmcm9tIGB0ZXJyYWZvcm0gc2hvdyAtanNvbmAsIHNvIGEgZGl2ZXJnZW5jZSBpcyBwcm92ZW4gYWNyb3NzIGJvdGggcmVkdWNlcnMsIG5vdCBvbmVcbiAqIHNoYXBlIGNvbXBhcmVkIHRvIGl0c2VsZi5cbiAqXG4gKiBTaGFyZXMgY29tcGFyZUdyYW50cyArIGJvdGggcmVkdWNlcnMgd2l0aCBzaWJsaW5ncyAwMTMtMS0xNC8xLTE1LzEtMTYsIHdoaWNoIGtleSB0cnVzdCBhbmQgYnVja2V0LXBvbGljeVxuICogZ3JhbnRzIHBlciBvd25lcjsgdGhpcyBzbGljZSBleHRlbmRzIHRoZSBzYW1lIGRpc2NpcGxpbmUgdG8gdGhlIHR3byBncmFudCB0eXBlcyBpdCB3YXMgbGVmdCBvcGVuIGZvci5cbiAqL1xuaW1wb3J0IHsgcmVhZEZpbGVTeW5jIH0gZnJvbSAnZnMnXG5pbXBvcnQgeyBqb2luIH0gZnJvbSAncGF0aCdcbmltcG9ydCB7IGdhdGUsIHJlZHVjZUNsb3VkRm9ybWF0aW9uLCByZWR1Y2VUZXJyYWZvcm1TaG93SnNvbiB9IGZyb20gJ0BhcGlhYmxlL3Bhcml0eS1nYXRlJ1xuaW1wb3J0IHsgVkFMVUVfQkVBUklOR19LSU5EUyB9IGZyb20gJy4uL2xpYi9wYXJpdHktZ2F0ZS9jYW5vbmljYWwnXG5cbmNvbnN0IFJFR0lPTiA9ICdldS1jZW50cmFsLTEnXG5cbi8vIOKUgOKUgCBDbG91ZEZvcm1hdGlvbiBidWlsZGVycyAodGhlIENESyArIENGTiBjaGFubmVscyBzaGFyZSB0aGlzIHJlZHVjZXIpIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG4vKiogQSByb2xlIHdob3NlIGRlY2xhcmVkIGlkIGlzIGl0cyBuYW1lLCBzbyB0aGUgaWFtLXJvbGUgbm9kZSByZWYgaXMgdGhlIGNoYW5uZWwtc3RhYmxlIGBpYW0tcm9sZTo8aWQ+YC4gKi9cbmNvbnN0IGNmblJvbGUgPSAobG9naWNhbElkOiBzdHJpbmcpOiB1bmtub3duID0+ICh7XG4gIFR5cGU6ICdBV1M6OklBTTo6Um9sZScsXG4gIFByb3BlcnRpZXM6IHtcbiAgICBSb2xlTmFtZTogbG9naWNhbElkLFxuICAgIFRhZ3M6IFt7IEtleTogJ2FwaWFibGU6bG9naWNhbC1pZCcsIFZhbHVlOiBsb2dpY2FsSWQgfV0sXG4gICAgQXNzdW1lUm9sZVBvbGljeURvY3VtZW50OiB7IFZlcnNpb246ICcyMDEyLTEwLTE3JywgU3RhdGVtZW50OiBbeyBFZmZlY3Q6ICdBbGxvdycsIFByaW5jaXBhbDogeyBTZXJ2aWNlOiAnbGFtYmRhLmFtYXpvbmF3cy5jb20nIH0sIEFjdGlvbjogJ3N0czpBc3N1bWVSb2xlJyB9XSB9LFxuICB9LFxufSlcblxuLyoqIEFuIGlubGluZSBwb2xpY3kgYXR0YWNoZWQgdG8gYHJvbGVSZWZgLCBncmFudGluZyBgYWN0aW9uc2Agb24gYHJlc291cmNlYCDigJQgdGhlIG93bmluZyByb2xlIGFuY2hvcnMgaXRzIG5vZGUgcmVmLiAqL1xuY29uc3QgY2ZuSW5saW5lUG9saWN5ID0gKHJvbGVSZWY6IHN0cmluZywgYWN0aW9uczogc3RyaW5nIHwgcmVhZG9ubHkgc3RyaW5nW10sIHJlc291cmNlOiBzdHJpbmcpOiB1bmtub3duID0+ICh7XG4gIFR5cGU6ICdBV1M6OklBTTo6UG9saWN5JyxcbiAgUHJvcGVydGllczoge1xuICAgIFBvbGljeU5hbWU6IGBwb2xpY3ktJHtyb2xlUmVmfWAsXG4gICAgUm9sZXM6IFt7IFJlZjogcm9sZVJlZiB9XSxcbiAgICBQb2xpY3lEb2N1bWVudDogeyBWZXJzaW9uOiAnMjAxMi0xMC0xNycsIFN0YXRlbWVudDogW3sgRWZmZWN0OiAnQWxsb3cnLCBBY3Rpb246IGFjdGlvbnMsIFJlc291cmNlOiByZXNvdXJjZSB9XSB9LFxuICB9LFxufSlcblxuLyoqIEEgbGFtYmRhIGZ1bmN0aW9uIHdob3NlIGRlY2xhcmVkIGlkIGlzIGl0cyBuYW1lLCBzbyBpdCBhbmNob3JzIGl0cyBpbnZva2UgcGVybWlzc2lvbidzIG5vZGUgcmVmLiAqL1xuY29uc3QgY2ZuRnVuY3Rpb24gPSAobG9naWNhbElkOiBzdHJpbmcpOiB1bmtub3duID0+ICh7XG4gIFR5cGU6ICdBV1M6OkxhbWJkYTo6RnVuY3Rpb24nLFxuICBQcm9wZXJ0aWVzOiB7IEZ1bmN0aW9uTmFtZTogbG9naWNhbElkLCBUYWdzOiBbeyBLZXk6ICdhcGlhYmxlOmxvZ2ljYWwtaWQnLCBWYWx1ZTogbG9naWNhbElkIH1dIH0sXG59KVxuXG4vKiogQW4gaW52b2tlIHBlcm1pc3Npb24gZm9yIGBwcmluY2lwYWxgIG9uIGBmdW5jdGlvblJlZmAsIG9wdGlvbmFsbHkgc2NvcGVkIHRvIGBzb3VyY2VBcm5gICh0aGUgbGVhc3QtcHJpdmlsZWdlIGZvcm0pLiAqL1xuY29uc3QgY2ZuSW52b2tlUGVybWlzc2lvbiA9IChmdW5jdGlvblJlZjogc3RyaW5nLCBwcmluY2lwYWw6IHN0cmluZywgc291cmNlQXJuOiBzdHJpbmcgfCB1bmRlZmluZWQpOiB1bmtub3duID0+ICh7XG4gIFR5cGU6ICdBV1M6OkxhbWJkYTo6UGVybWlzc2lvbicsXG4gIFByb3BlcnRpZXM6IHtcbiAgICBQcmluY2lwYWw6IHByaW5jaXBhbCxcbiAgICBBY3Rpb246ICdsYW1iZGE6SW52b2tlRnVuY3Rpb24nLFxuICAgIEZ1bmN0aW9uTmFtZTogeyBSZWY6IGZ1bmN0aW9uUmVmIH0sXG4gICAgLi4uKHNvdXJjZUFybiAhPT0gdW5kZWZpbmVkID8geyBTb3VyY2VBcm46IHNvdXJjZUFybiB9IDoge30pLFxuICB9LFxufSlcblxuLy8gVHdvIGNvZ25pdG8tc2hhcGVkIHJvbGVzICh0aGUgbXVsdGktb3duZXIgdHJpZ2dlcjogYm90aCBncmFudCBjb2duaXRvLWlkcDoqKSwgZWFjaCB3aXRoIGFuIGlubGluZSBwb2xpY3lcbi8vIHNjb3BlZCB0byB0aGUgZ2l2ZW4gcmVzb3VyY2UsIHNvIHRoZSB0d28gcG9saWNpZXMgc2hhcmUgdGhlIGBjb2duaXRvLWlkcGAgc2VydmljZSBzZXQgYW5kIGdyb3VwIGFsaWtlLlxuY29uc3QgY2ZuVHdvSW5saW5lUG9saWNpZXMgPSAocmVzb3VyY2VBOiBzdHJpbmcsIHJlc291cmNlQjogc3RyaW5nKTogdW5rbm93biA9PiAoe1xuICBSZXNvdXJjZXM6IHtcbiAgICBSb2xlQXV0aE46IGNmblJvbGUoJ2NvZ25pdG8tYXV0aG4tcm9sZScpLFxuICAgIFJvbGVBdXRoWjogY2ZuUm9sZSgnY29nbml0by1hdXRoei1yb2xlJyksXG4gICAgUG9saWN5QXV0aE46IGNmbklubGluZVBvbGljeSgnUm9sZUF1dGhOJywgJ2NvZ25pdG8taWRwOionLCByZXNvdXJjZUEpLFxuICAgIFBvbGljeUF1dGhaOiBjZm5JbmxpbmVQb2xpY3koJ1JvbGVBdXRoWicsICdjb2duaXRvLWlkcDoqJywgcmVzb3VyY2VCKSxcbiAgfSxcbn0pXG5cbi8vIFR3byBmdW5jdGlvbnMsIGVhY2ggaW52b2tlZCBieSB0aGUgU0FNRSBwcmluY2lwYWwsIHNvIHRoZSB0d28gaW52b2tlIGdyYW50cyBncm91cCBhbGlrZSB1bmRlciBvbmVcbi8vIGBncmFudDppbnZva2U6PHByaW5jaXBhbD5gIGJlZm9yZSB0aGUgcGVyLWZ1bmN0aW9uIHN1ZmZpeC5cbmNvbnN0IGNmblR3b0ludm9rZVBlcm1pc3Npb25zID0gKHNvdXJjZUE6IHN0cmluZyB8IHVuZGVmaW5lZCwgc291cmNlQjogc3RyaW5nIHwgdW5kZWZpbmVkKTogdW5rbm93biA9PiAoe1xuICBSZXNvdXJjZXM6IHtcbiAgICBGbkE6IGNmbkZ1bmN0aW9uKCdmbi1hJyksXG4gICAgRm5COiBjZm5GdW5jdGlvbignZm4tYicpLFxuICAgIEludm9rZUE6IGNmbkludm9rZVBlcm1pc3Npb24oJ0ZuQScsICdjb2duaXRvLWlkcC5hbWF6b25hd3MuY29tJywgc291cmNlQSksXG4gICAgSW52b2tlQjogY2ZuSW52b2tlUGVybWlzc2lvbignRm5CJywgJ2NvZ25pdG8taWRwLmFtYXpvbmF3cy5jb20nLCBzb3VyY2VCKSxcbiAgfSxcbn0pXG5cbi8vIOKUgOKUgCBUZXJyYWZvcm0gYHNob3cgLWpzb25gIGJ1aWxkZXJzICh0aGUgVGVycmFmb3JtIGNoYW5uZWwncyBvd24gcmVkdWNlcikg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbi8qKiBBIGB0ZXJyYWZvcm0gc2hvdyAtanNvbmAgcGxhbjsgdGhlIGNvbmZpZ3VyYXRpb24gYmxvY2sgY2FycmllcyB0aGUgcmVmZXJlbmNlIGV4cHJlc3Npb25zIHRoYXQgYW5jaG9yXG4gKiBlYWNoIGF0dGFjaGVkIHBvbGljeS9wZXJtaXNzaW9uIHRvIGl0cyBwYXJlbnQgKHRoZSBwYXJlbnQgaWQgaXMgY29tcHV0ZWQgYW5kIGFic2VudCBmcm9tIHBsYW5uZWRfdmFsdWVzKS4gKi9cbmNvbnN0IHRmUGxhbiA9IChwbGFubmVkOiByZWFkb25seSB1bmtub3duW10sIGNvbmZpZzogcmVhZG9ubHkgdW5rbm93bltdKTogdW5rbm93biA9PiAoe1xuICBwbGFubmVkX3ZhbHVlczogeyByb290X21vZHVsZTogeyByZXNvdXJjZXM6IHBsYW5uZWQgfSB9LFxuICBjb25maWd1cmF0aW9uOiB7IHJvb3RfbW9kdWxlOiB7IHJlc291cmNlczogY29uZmlnLCBvdXRwdXRzOiB7fSB9IH0sXG59KVxuXG5jb25zdCB0ZlJvbGUgPSAoYWRkcmVzczogc3RyaW5nLCBsb2dpY2FsSWQ6IHN0cmluZyk6IHVua25vd24gPT4gKHtcbiAgYWRkcmVzcyxcbiAgdHlwZTogJ2F3c19pYW1fcm9sZScsXG4gIHZhbHVlczoge1xuICAgIG5hbWU6IGxvZ2ljYWxJZCxcbiAgICB0YWdzOiB7ICdhcGlhYmxlOmxvZ2ljYWwtaWQnOiBsb2dpY2FsSWQgfSxcbiAgICBhc3N1bWVfcm9sZV9wb2xpY3k6IEpTT04uc3RyaW5naWZ5KHsgVmVyc2lvbjogJzIwMTItMTAtMTcnLCBTdGF0ZW1lbnQ6IFt7IEVmZmVjdDogJ0FsbG93JywgUHJpbmNpcGFsOiB7IFNlcnZpY2U6ICdsYW1iZGEuYW1hem9uYXdzLmNvbScgfSwgQWN0aW9uOiAnc3RzOkFzc3VtZVJvbGUnIH1dIH0pLFxuICB9LFxufSlcblxuY29uc3QgdGZJbmxpbmVQb2xpY3kgPSAoYWRkcmVzczogc3RyaW5nLCBhY3Rpb25zOiBzdHJpbmcgfCByZWFkb25seSBzdHJpbmdbXSwgcmVzb3VyY2U6IHN0cmluZyk6IHVua25vd24gPT4gKHtcbiAgYWRkcmVzcyxcbiAgdHlwZTogJ2F3c19pYW1fcm9sZV9wb2xpY3knLFxuICB2YWx1ZXM6IHsgbmFtZTogYWRkcmVzcywgcG9saWN5OiBKU09OLnN0cmluZ2lmeSh7IFZlcnNpb246ICcyMDEyLTEwLTE3JywgU3RhdGVtZW50OiBbeyBFZmZlY3Q6ICdBbGxvdycsIEFjdGlvbjogYWN0aW9ucywgUmVzb3VyY2U6IHJlc291cmNlIH1dIH0pIH0sXG59KVxuXG5jb25zdCB0ZklubGluZVBvbGljeUNvbmZpZyA9IChhZGRyZXNzOiBzdHJpbmcsIHJvbGVBZGRyZXNzOiBzdHJpbmcpOiB1bmtub3duID0+ICh7XG4gIGFkZHJlc3MsXG4gIHR5cGU6ICdhd3NfaWFtX3JvbGVfcG9saWN5JyxcbiAgZXhwcmVzc2lvbnM6IHsgcm9sZTogeyByZWZlcmVuY2VzOiBbYCR7cm9sZUFkZHJlc3N9LmlkYCwgcm9sZUFkZHJlc3NdIH0gfSxcbn0pXG5cbmNvbnN0IHRmRnVuY3Rpb24gPSAoYWRkcmVzczogc3RyaW5nLCBsb2dpY2FsSWQ6IHN0cmluZyk6IHVua25vd24gPT4gKHtcbiAgYWRkcmVzcyxcbiAgdHlwZTogJ2F3c19sYW1iZGFfZnVuY3Rpb24nLFxuICB2YWx1ZXM6IHsgZnVuY3Rpb25fbmFtZTogbG9naWNhbElkLCB0YWdzOiB7ICdhcGlhYmxlOmxvZ2ljYWwtaWQnOiBsb2dpY2FsSWQgfSB9LFxufSlcblxuY29uc3QgdGZJbnZva2VQZXJtaXNzaW9uID0gKGFkZHJlc3M6IHN0cmluZywgcHJpbmNpcGFsOiBzdHJpbmcsIHNvdXJjZUFybjogc3RyaW5nIHwgdW5kZWZpbmVkKTogdW5rbm93biA9PiAoe1xuICBhZGRyZXNzLFxuICB0eXBlOiAnYXdzX2xhbWJkYV9wZXJtaXNzaW9uJyxcbiAgdmFsdWVzOiB7IHByaW5jaXBhbCwgYWN0aW9uOiAnbGFtYmRhOkludm9rZUZ1bmN0aW9uJywgZnVuY3Rpb25fbmFtZTogcHJpbmNpcGFsLCAuLi4oc291cmNlQXJuICE9PSB1bmRlZmluZWQgPyB7IHNvdXJjZV9hcm46IHNvdXJjZUFybiB9IDoge30pIH0sXG59KVxuXG5jb25zdCB0Zkludm9rZVBlcm1pc3Npb25Db25maWcgPSAoYWRkcmVzczogc3RyaW5nLCBmdW5jdGlvbkFkZHJlc3M6IHN0cmluZyk6IHVua25vd24gPT4gKHtcbiAgYWRkcmVzcyxcbiAgdHlwZTogJ2F3c19sYW1iZGFfcGVybWlzc2lvbicsXG4gIGV4cHJlc3Npb25zOiB7IGZ1bmN0aW9uX25hbWU6IHsgcmVmZXJlbmNlczogW2Ake2Z1bmN0aW9uQWRkcmVzc30uZnVuY3Rpb25fbmFtZWAsIGZ1bmN0aW9uQWRkcmVzc10gfSB9LFxufSlcblxuY29uc3QgdGZUd29JbmxpbmVQb2xpY2llcyA9IChyZXNvdXJjZUE6IHN0cmluZywgcmVzb3VyY2VCOiBzdHJpbmcpOiB1bmtub3duID0+XG4gIHRmUGxhbihcbiAgICBbXG4gICAgICB0ZlJvbGUoJ2F3c19pYW1fcm9sZS5hdXRobicsICdjb2duaXRvLWF1dGhuLXJvbGUnKSxcbiAgICAgIHRmUm9sZSgnYXdzX2lhbV9yb2xlLmF1dGh6JywgJ2NvZ25pdG8tYXV0aHotcm9sZScpLFxuICAgICAgdGZJbmxpbmVQb2xpY3koJ2F3c19pYW1fcm9sZV9wb2xpY3kuYXV0aG4nLCAnY29nbml0by1pZHA6KicsIHJlc291cmNlQSksXG4gICAgICB0ZklubGluZVBvbGljeSgnYXdzX2lhbV9yb2xlX3BvbGljeS5hdXRoeicsICdjb2duaXRvLWlkcDoqJywgcmVzb3VyY2VCKSxcbiAgICBdLFxuICAgIFtcbiAgICAgIHRmSW5saW5lUG9saWN5Q29uZmlnKCdhd3NfaWFtX3JvbGVfcG9saWN5LmF1dGhuJywgJ2F3c19pYW1fcm9sZS5hdXRobicpLFxuICAgICAgdGZJbmxpbmVQb2xpY3lDb25maWcoJ2F3c19pYW1fcm9sZV9wb2xpY3kuYXV0aHonLCAnYXdzX2lhbV9yb2xlLmF1dGh6JyksXG4gICAgXSxcbiAgKVxuXG5jb25zdCB0ZlR3b0ludm9rZVBlcm1pc3Npb25zID0gKHNvdXJjZUE6IHN0cmluZyB8IHVuZGVmaW5lZCwgc291cmNlQjogc3RyaW5nIHwgdW5kZWZpbmVkKTogdW5rbm93biA9PlxuICB0ZlBsYW4oXG4gICAgW1xuICAgICAgdGZGdW5jdGlvbignYXdzX2xhbWJkYV9mdW5jdGlvbi5mbl9hJywgJ2ZuLWEnKSxcbiAgICAgIHRmRnVuY3Rpb24oJ2F3c19sYW1iZGFfZnVuY3Rpb24uZm5fYicsICdmbi1iJyksXG4gICAgICB0Zkludm9rZVBlcm1pc3Npb24oJ2F3c19sYW1iZGFfcGVybWlzc2lvbi5pbnZva2VfYScsICdjb2duaXRvLWlkcC5hbWF6b25hd3MuY29tJywgc291cmNlQSksXG4gICAgICB0Zkludm9rZVBlcm1pc3Npb24oJ2F3c19sYW1iZGFfcGVybWlzc2lvbi5pbnZva2VfYicsICdjb2duaXRvLWlkcC5hbWF6b25hd3MuY29tJywgc291cmNlQiksXG4gICAgXSxcbiAgICBbXG4gICAgICB0Zkludm9rZVBlcm1pc3Npb25Db25maWcoJ2F3c19sYW1iZGFfcGVybWlzc2lvbi5pbnZva2VfYScsICdhd3NfbGFtYmRhX2Z1bmN0aW9uLmZuX2EnKSxcbiAgICAgIHRmSW52b2tlUGVybWlzc2lvbkNvbmZpZygnYXdzX2xhbWJkYV9wZXJtaXNzaW9uLmludm9rZV9iJywgJ2F3c19sYW1iZGFfZnVuY3Rpb24uZm5fYicpLFxuICAgIF0sXG4gIClcblxuLy8g4pSA4pSAIEhhcm5lc3Mg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbmNvbnN0IGdhdGVPZiA9IChjZm46IHVua25vd24sIHRlcnJhZm9ybVBsYW46IHVua25vd24pOiBSZXR1cm5UeXBlPHR5cGVvZiBnYXRlPiA9PlxuICBnYXRlKFtcbiAgICByZWR1Y2VDbG91ZEZvcm1hdGlvbihjZm4sICdjZGsnLCBSRUdJT04pLFxuICAgIHJlZHVjZUNsb3VkRm9ybWF0aW9uKGNmbiwgJ2NmbicsIFJFR0lPTiksXG4gICAgcmVkdWNlVGVycmFmb3JtU2hvd0pzb24odGVycmFmb3JtUGxhbiwgJ3RlcnJhZm9ybScsIFJFR0lPTiksXG4gIF0pXG5cbmNvbnN0IHBlcm1pc3Npb25EaXZlcmdlbmNlID0gKHJlc3VsdDogUmV0dXJuVHlwZTx0eXBlb2YgZ2F0ZT4pID0+XG4gIHJlc3VsdC5kaXZlcmdlbmNlcy5maW5kKChlbnRyeSkgPT4gZW50cnkudGllciA9PT0gJ3Blcm1pc3Npb24nKVxuXG5jb25zdCBTQ09QRURfQSA9IGBhcm46YXdzOmNvZ25pdG8taWRwOiR7UkVHSU9OfTowMzQ0NDQ4Njk3NTU6dXNlcnBvb2wvcG9vbC1hYFxuY29uc3QgU0NPUEVEX0IgPSBgYXJuOmF3czpjb2duaXRvLWlkcDoke1JFR0lPTn06MDM0NDQ0ODY5NzU1OnVzZXJwb29sL3Bvb2wtYmBcblxuZGVzY3JpYmUoJzAxMy0xLTE5IHBhcml0eSBjaGVjayDigJQgc2libGluZyBncmFudC1wb29saW5nIGNsb3N1cmUnLCAoKSA9PiB7XG4gIC8vIGNvbnRyYWN0OiBTMSDigJQgZXF1aXZhbGVudCBtdWx0aS1vd25lciBncmFudHMgYWNyb3NzIGFsbCB0aHJlZSBjaGFubmVscyDihpIgYWdyZWVtZW50XG4gIGl0KCdTMTogdHdvIHJvbGVzIChpbmxpbmUgcGVybWlzc2lvbnMpICsgdHdvIGZ1bmN0aW9ucyAoaW52b2tlIHBlcm1pc3Npb25zKSBlcXVpdmFsZW50IGFjcm9zcyBhbGwgMyBjaGFubmVscyDihpIgcGFyaXR5IGhvbGRzJywgKCkgPT4ge1xuICAgIGNvbnN0IGNmbjogdW5rbm93biA9IHtcbiAgICAgIFJlc291cmNlczoge1xuICAgICAgICAuLi4oY2ZuVHdvSW5saW5lUG9saWNpZXMoJ2Fybjphd3M6Y29nbml0by1pZHA6KjoqOnVzZXJwb29sL2F1dGhuJywgJ2Fybjphd3M6Y29nbml0by1pZHA6KjoqOnVzZXJwb29sL2F1dGh6JykgYXMgeyBSZXNvdXJjZXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IH0pLlJlc291cmNlcyxcbiAgICAgICAgLi4uKGNmblR3b0ludm9rZVBlcm1pc3Npb25zKFNDT1BFRF9BLCBTQ09QRURfQikgYXMgeyBSZXNvdXJjZXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IH0pLlJlc291cmNlcyxcbiAgICAgIH0sXG4gICAgfVxuICAgIGNvbnN0IHRmID0gdGZQbGFuKFxuICAgICAgW1xuICAgICAgICB0ZlJvbGUoJ2F3c19pYW1fcm9sZS5hdXRobicsICdjb2duaXRvLWF1dGhuLXJvbGUnKSxcbiAgICAgICAgdGZSb2xlKCdhd3NfaWFtX3JvbGUuYXV0aHonLCAnY29nbml0by1hdXRoei1yb2xlJyksXG4gICAgICAgIHRmSW5saW5lUG9saWN5KCdhd3NfaWFtX3JvbGVfcG9saWN5LmF1dGhuJywgJ2NvZ25pdG8taWRwOionLCAnYXJuOmF3czpjb2duaXRvLWlkcDoqOio6dXNlcnBvb2wvYXV0aG4nKSxcbiAgICAgICAgdGZJbmxpbmVQb2xpY3koJ2F3c19pYW1fcm9sZV9wb2xpY3kuYXV0aHonLCAnY29nbml0by1pZHA6KicsICdhcm46YXdzOmNvZ25pdG8taWRwOio6Kjp1c2VycG9vbC9hdXRoeicpLFxuICAgICAgICB0ZkZ1bmN0aW9uKCdhd3NfbGFtYmRhX2Z1bmN0aW9uLmZuX2EnLCAnZm4tYScpLFxuICAgICAgICB0ZkZ1bmN0aW9uKCdhd3NfbGFtYmRhX2Z1bmN0aW9uLmZuX2InLCAnZm4tYicpLFxuICAgICAgICB0Zkludm9rZVBlcm1pc3Npb24oJ2F3c19sYW1iZGFfcGVybWlzc2lvbi5pbnZva2VfYScsICdjb2duaXRvLWlkcC5hbWF6b25hd3MuY29tJywgU0NPUEVEX0EpLFxuICAgICAgICB0Zkludm9rZVBlcm1pc3Npb24oJ2F3c19sYW1iZGFfcGVybWlzc2lvbi5pbnZva2VfYicsICdjb2duaXRvLWlkcC5hbWF6b25hd3MuY29tJywgU0NPUEVEX0IpLFxuICAgICAgXSxcbiAgICAgIFtcbiAgICAgICAgdGZJbmxpbmVQb2xpY3lDb25maWcoJ2F3c19pYW1fcm9sZV9wb2xpY3kuYXV0aG4nLCAnYXdzX2lhbV9yb2xlLmF1dGhuJyksXG4gICAgICAgIHRmSW5saW5lUG9saWN5Q29uZmlnKCdhd3NfaWFtX3JvbGVfcG9saWN5LmF1dGh6JywgJ2F3c19pYW1fcm9sZS5hdXRoeicpLFxuICAgICAgICB0Zkludm9rZVBlcm1pc3Npb25Db25maWcoJ2F3c19sYW1iZGFfcGVybWlzc2lvbi5pbnZva2VfYScsICdhd3NfbGFtYmRhX2Z1bmN0aW9uLmZuX2EnKSxcbiAgICAgICAgdGZJbnZva2VQZXJtaXNzaW9uQ29uZmlnKCdhd3NfbGFtYmRhX3Blcm1pc3Npb24uaW52b2tlX2InLCAnYXdzX2xhbWJkYV9mdW5jdGlvbi5mbl9iJyksXG4gICAgICBdLFxuICAgIClcbiAgICBjb25zdCByZXN1bHQgPSBnYXRlT2YoY2ZuLCB0ZilcbiAgICBleHBlY3QocmVzdWx0LnBhc3NlZCkudG9CZSh0cnVlKVxuICAgIGV4cGVjdChyZXN1bHQuZGl2ZXJnZW5jZXMpLnRvRXF1YWwoW10pXG4gIH0pXG5cbiAgLy8gY29udHJhY3Q6IFMyIOKAlCBhIGNyb3NzLW93bmVyIElOTElORS1wZXJtaXNzaW9uIHN3YXAgaXMgY2F1Z2h0IHBlciBvd25pbmcgcm9sZSAoRk9SQ0lORyDigJQgRi1CLCBmYWlsLW9wZW4pXG4gIGl0KCdTMjogdHdvIHJvbGVzLCBzYW1lIHNlcnZpY2Ugc2V0LCBvbmUgY2hhbm5lbCBMT09TRU5TIHJvbGUtQSBpbmxpbmUgcGVybWlzc2lvbiB3aGlsZSBUSUdIVEVOSU5HIHJvbGUtQiBieSB0aGUgc2FtZSBzaGFwZSDihpIgdGhlIGNoZWNrIEZBSUxTIHBlciByb2xlIChwb29sZWQgZ3JhbnQ6PHNlcnZpY2VzPiBuZXRzIG91dCBwcmUtZml4IOKGkiBSRUQpJywgKCkgPT4ge1xuICAgIC8vIENGTi9DREsgc2NvcGUgYXV0aG7ihpJwb29sLWEgKG5hcnJvdykgYW5kIGF1dGh64oaScG9vbC1iIChuYXJyb3cpLiBUZXJyYWZvcm0gc3dhcHM6IGF1dGhu4oaScG9vbC1iICh0aGVcbiAgICAvLyBPVEhFUiByb2xlJ3MgcmVzb3VyY2UgPSByb2xlLWF1dGhuIGxvb3NlbmVkKSBhbmQgYXV0aHrihpJwb29sLWEgKHRpZ2h0ZW5lZCkuIEJvdGggY2hhbm5lbHMnIHBvb2xlZFxuICAgIC8vIHtjb2duaXRvLWlkcCBvbiBwb29sLWEsIGNvZ25pdG8taWRwIG9uIHBvb2wtYn0gbXVsdGlzZXQgaXMgaWRlbnRpY2FsOyBvbmx5IGZpbGluZyBlYWNoIGdyYW50IHVuZGVyXG4gICAgLy8gaXRzIG93bmluZyByb2xlJ3MgcG9saWN5IHJlZiBzdXJmYWNlcyB0aGF0IHJvbGUtYXV0aG4ncyBwZXJtaXNzaW9uIHdhcyB3aWRlbmVkLlxuICAgIGNvbnN0IGludGVuZGVkQ2ZuID0gY2ZuVHdvSW5saW5lUG9saWNpZXMoJ2Fybjphd3M6Y29nbml0by1pZHA6KjoqOnVzZXJwb29sL2F1dGhuJywgJ2Fybjphd3M6Y29nbml0by1pZHA6KjoqOnVzZXJwb29sL2F1dGh6JylcbiAgICBjb25zdCBzd2FwcGVkVGYgPSB0ZlR3b0lubGluZVBvbGljaWVzKCdhcm46YXdzOmNvZ25pdG8taWRwOio6Kjp1c2VycG9vbC9hdXRoeicsICdhcm46YXdzOmNvZ25pdG8taWRwOio6Kjp1c2VycG9vbC9hdXRobicpXG4gICAgY29uc3QgcmVzdWx0ID0gZ2F0ZU9mKGludGVuZGVkQ2ZuLCBzd2FwcGVkVGYpXG4gICAgZXhwZWN0KHJlc3VsdC5wYXNzZWQpLnRvQmUoZmFsc2UpXG4gICAgY29uc3QgZGl2ZXJnZW5jZSA9IHBlcm1pc3Npb25EaXZlcmdlbmNlKHJlc3VsdClcbiAgICBleHBlY3QoZGl2ZXJnZW5jZT8uZGV0YWlsKS50b0NvbnRhaW4oJ2dyYW50OmNvZ25pdG8taWRwJylcbiAgICBleHBlY3QoZGl2ZXJnZW5jZT8uY2hhbm5lbHMpLnRvRXF1YWwoWyd0ZXJyYWZvcm0nXSlcbiAgfSlcblxuICAvLyBjb250cmFjdDogUzMg4oCUIGEgY3Jvc3Mtb3duZXIgSU5WT0tFLXBlcm1pc3Npb24gc3dhcCBpcyBjYXVnaHQgcGVyIG93bmluZyBmdW5jdGlvbiAoRk9SQ0lORyDigJQgRi1CLCBmYWlsLW9wZW4pXG4gIGl0KCdTMzogdHdvIGZ1bmN0aW9ucywgc2FtZSBwcmluY2lwYWwsIG9uZSBjaGFubmVsIGxvb3NlbnMgZm4tQSBpbnZva2UgZ3JhbnQgd2hpbGUgdGlnaHRlbmluZyBmbi1CIGJ5IHRoZSBzYW1lIHNoYXBlIOKGkiB0aGUgY2hlY2sgRkFJTFMgcGVyIGZ1bmN0aW9uIChwb29sZWQgZ3JhbnQ6aW52b2tlOjxwcmluY2lwYWw+IG5ldHMgb3V0IHByZS1maXgg4oaSIFJFRCknLCAoKSA9PiB7XG4gICAgLy8gQ0ZOL0NESyBzY29wZSBpbnZva2UtYeKGknBvb2wtYSBhbmQgaW52b2tlLWLihpJwb29sLWIuIFRlcnJhZm9ybSBzd2FwcyB0aGUgc291cmNlIHNjb3BlczogaW52b2tlLWHihpJwb29sLWJcbiAgICAvLyAoZm4tYSdzIGludm9rZXIgd2lkZW5lZCB0byBhIGRpZmZlcmVudCBzb3VyY2UpIGFuZCBpbnZva2UtYuKGknBvb2wtYS4gQm90aCBjaGFubmVscycgcG9vbGVkXG4gICAgLy8gZ3JhbnQ6aW52b2tlOmNvZ25pdG8taWRwIG11bHRpc2V0IGlzIHtzY29wZWQgcG9vbC1hLCBzY29wZWQgcG9vbC1ifTsgb25seSB0aGUgcGVyLWZ1bmN0aW9uIHJlZiB0ZWxsc1xuICAgIC8vIHRoZW0gYXBhcnQgYW5kIGNhdGNoZXMgdGhhdCBmbi1hJ3MgaW52b2tlIHNvdXJjZSB3YXMgY2hhbmdlZC5cbiAgICBjb25zdCBpbnRlbmRlZENmbiA9IGNmblR3b0ludm9rZVBlcm1pc3Npb25zKFNDT1BFRF9BLCBTQ09QRURfQilcbiAgICBjb25zdCBzd2FwcGVkVGYgPSB0ZlR3b0ludm9rZVBlcm1pc3Npb25zKFNDT1BFRF9CLCBTQ09QRURfQSlcbiAgICBjb25zdCByZXN1bHQgPSBnYXRlT2YoaW50ZW5kZWRDZm4sIHN3YXBwZWRUZilcbiAgICBleHBlY3QocmVzdWx0LnBhc3NlZCkudG9CZShmYWxzZSlcbiAgICBjb25zdCBkaXZlcmdlbmNlID0gcGVybWlzc2lvbkRpdmVyZ2VuY2UocmVzdWx0KVxuICAgIGV4cGVjdChkaXZlcmdlbmNlPy5kZXRhaWwpLnRvQ29udGFpbignZ3JhbnQ6aW52b2tlJylcbiAgICBleHBlY3QoZGl2ZXJnZW5jZT8uY2hhbm5lbHMpLnRvRXF1YWwoWyd0ZXJyYWZvcm0nXSlcbiAgfSlcblxuICAvLyBjb250cmFjdDogUzQg4oCUIHR3byBvd25lcnMgbGVnaXRpbWF0ZWx5IHNoYXJpbmcgYSBncmFudCBzaGFwZSBhcmUgTk9UIGZhbHNlLWZhaWxlZCAobm8gb3Zlci1ibG9jaylcbiAgaXQoJ1M0OiB0d28gcm9sZXMgd2l0aCB0aGUgc2FtZSBpbmxpbmUgc2VydmljZSBzZXQgKG9yIHR3byBmdW5jdGlvbnMgd2l0aCB0aGUgc2FtZSBpbnZva2UgcHJpbmNpcGFsKSwgaWRlbnRpY2FsIGFjcm9zcyBhbGwgY2hhbm5lbHMg4oaSIGFncmVlbWVudCAodGhlIHBlci1vd25lciBzdWZmaXggaW52ZW50cyBubyBkaXZlcmdlbmNlKScsICgpID0+IHtcbiAgICAvLyBUd28gcm9sZXMgYm90aCBncmFudGluZyBjb2duaXRvLWlkcDoqIG9uIHRoZSBTQU1FIHJlc291cmNlLCBhbmQgdHdvIGZ1bmN0aW9ucyBib3RoIGludm9rZWQgYnkgdGhlXG4gICAgLy8gc2FtZSBwcmluY2lwYWwgc2NvcGVkIHRvIHRoZSBzYW1lIHNvdXJjZSDigJQgYSBsZWdpdGltYXRlbHkgc2hhcmVkIHNoYXBlLiBUaGUgcGVyLW93bmVyIHN1ZmZpeCBtdXN0XG4gICAgLy8gbm90IGludmVudCBhIGRpdmVyZ2VuY2Ugd2hlcmUgdGhlIG93bmVycyBnZW51aW5lbHkgYWdyZWUgYWNyb3NzIGV2ZXJ5IGNoYW5uZWwuXG4gICAgY29uc3Qgc2hhcmVkUmVzb3VyY2UgPSAnYXJuOmF3czpjb2duaXRvLWlkcDoqOio6dXNlcnBvb2wvc2hhcmVkJ1xuICAgIGNvbnN0IGNmbjogdW5rbm93biA9IHtcbiAgICAgIFJlc291cmNlczoge1xuICAgICAgICAuLi4oY2ZuVHdvSW5saW5lUG9saWNpZXMoc2hhcmVkUmVzb3VyY2UsIHNoYXJlZFJlc291cmNlKSBhcyB7IFJlc291cmNlczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfSkuUmVzb3VyY2VzLFxuICAgICAgICAuLi4oY2ZuVHdvSW52b2tlUGVybWlzc2lvbnMoU0NPUEVEX0EsIFNDT1BFRF9BKSBhcyB7IFJlc291cmNlczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfSkuUmVzb3VyY2VzLFxuICAgICAgfSxcbiAgICB9XG4gICAgY29uc3QgdGYgPSB0ZlBsYW4oXG4gICAgICBbXG4gICAgICAgIHRmUm9sZSgnYXdzX2lhbV9yb2xlLmF1dGhuJywgJ2NvZ25pdG8tYXV0aG4tcm9sZScpLFxuICAgICAgICB0ZlJvbGUoJ2F3c19pYW1fcm9sZS5hdXRoeicsICdjb2duaXRvLWF1dGh6LXJvbGUnKSxcbiAgICAgICAgdGZJbmxpbmVQb2xpY3koJ2F3c19pYW1fcm9sZV9wb2xpY3kuYXV0aG4nLCAnY29nbml0by1pZHA6KicsIHNoYXJlZFJlc291cmNlKSxcbiAgICAgICAgdGZJbmxpbmVQb2xpY3koJ2F3c19pYW1fcm9sZV9wb2xpY3kuYXV0aHonLCAnY29nbml0by1pZHA6KicsIHNoYXJlZFJlc291cmNlKSxcbiAgICAgICAgdGZGdW5jdGlvbignYXdzX2xhbWJkYV9mdW5jdGlvbi5mbl9hJywgJ2ZuLWEnKSxcbiAgICAgICAgdGZGdW5jdGlvbignYXdzX2xhbWJkYV9mdW5jdGlvbi5mbl9iJywgJ2ZuLWInKSxcbiAgICAgICAgdGZJbnZva2VQZXJtaXNzaW9uKCdhd3NfbGFtYmRhX3Blcm1pc3Npb24uaW52b2tlX2EnLCAnY29nbml0by1pZHAuYW1hem9uYXdzLmNvbScsIFNDT1BFRF9BKSxcbiAgICAgICAgdGZJbnZva2VQZXJtaXNzaW9uKCdhd3NfbGFtYmRhX3Blcm1pc3Npb24uaW52b2tlX2InLCAnY29nbml0by1pZHAuYW1hem9uYXdzLmNvbScsIFNDT1BFRF9BKSxcbiAgICAgIF0sXG4gICAgICBbXG4gICAgICAgIHRmSW5saW5lUG9saWN5Q29uZmlnKCdhd3NfaWFtX3JvbGVfcG9saWN5LmF1dGhuJywgJ2F3c19pYW1fcm9sZS5hdXRobicpLFxuICAgICAgICB0ZklubGluZVBvbGljeUNvbmZpZygnYXdzX2lhbV9yb2xlX3BvbGljeS5hdXRoeicsICdhd3NfaWFtX3JvbGUuYXV0aHonKSxcbiAgICAgICAgdGZJbnZva2VQZXJtaXNzaW9uQ29uZmlnKCdhd3NfbGFtYmRhX3Blcm1pc3Npb24uaW52b2tlX2EnLCAnYXdzX2xhbWJkYV9mdW5jdGlvbi5mbl9hJyksXG4gICAgICAgIHRmSW52b2tlUGVybWlzc2lvbkNvbmZpZygnYXdzX2xhbWJkYV9wZXJtaXNzaW9uLmludm9rZV9iJywgJ2F3c19sYW1iZGFfZnVuY3Rpb24uZm5fYicpLFxuICAgICAgXSxcbiAgICApXG4gICAgY29uc3QgcmVzdWx0ID0gZ2F0ZU9mKGNmbiwgdGYpXG4gICAgZXhwZWN0KHJlc3VsdC5wYXNzZWQpLnRvQmUodHJ1ZSlcbiAgICBleHBlY3QocGVybWlzc2lvbkRpdmVyZ2VuY2UocmVzdWx0KSkudG9CZVVuZGVmaW5lZCgpXG4gIH0pXG5cbiAgLy8gY29udHJhY3Q6IFM1IOKAlCB0aGUgZGlzdGluY3RuZXNzIHNhZmV0eSBuZXQgY292ZXJzIGV2ZXJ5IHZhbHVlLXdyaXRlIGZvcm0gKEYtQSlcbiAgaXQoJ1M1OiBhIGxvYWQtYmVhcmluZyB2YWx1ZSB3cml0dGVuIHZpYSB0aGUgc3ByZWFkLW1lcmdlIGZvcm0gKG5vdCBvbmx5IGEgZGlyZWN0IGFzc2lnbm1lbnQpIOKGkiB0aGUgc3RydWN0dXJhbCBzYWZldHkgY2hlY2sgc3RpbGwgcmVxdWlyZXMgdGhhdCBraW5kIHRvIGJlIGtlcHQgZGlzdGluY3Qgd2l0aGluIGEgY2hhbm5lbCAoUkVEIHdoaWxlIHRoZSBndWFyZCBvbmx5IHNlZXMgZGlyZWN0IHdyaXRlcyknLCAoKSA9PiB7XG4gICAgLy8gVGhlIHdpdGhpbi1jaGFubmVsLXVuaXF1ZW5lc3MgYW50aS1kcmlmdCBndWFyZCBzY2FucyB0aGUgcmVkdWNlciBzb3VyY2UgZm9yIGV2ZXJ5IGtpbmQgdGhhdCB3cml0ZXMgYVxuICAgIC8vIGxvYWQtYmVhcmluZyB2YWx1ZSByb3cgYW5kIGFzc2VydHMgZWFjaCBpcyBpbiBWQUxVRV9CRUFSSU5HX0tJTkRTLiBBIGZ1dHVyZSByZWR1Y2VyIHRoYXQgYWRkcyBhIHZhbHVlXG4gICAgLy8gcm93IHRocm91Z2ggdGhlIHNwcmVhZC1tZXJnZSBoZWxwZXIgZm9ybSBgdmFsdWVzID0geyAuLi52YWx1ZXMsIC4uLnNvbWVIZWxwZXIocmVmLCDigKYpIH1gIOKAlCB0aGUgZm9ybVxuICAgIC8vIHRoZSBjb2duaXRvIGRpc2NvdmVyeSByb3dzIGFscmVhZHkgdXNlICh0aGUgYGRpc2NvdmVyeVZhbHVlUm93c2Agc3ByZWFkIGluIGJvdGggcmVkdWNlcnMpIOKAlCBtdXN0IHN0aWxsXG4gICAgLy8gYmUgc2Vlbiwgb3IgdGhhdCBraW5kIHNpbGVudGx5IGJ5cGFzc2VzIHRoZSB1bmlxdWVuZXNzIGd1YXJhbnRlZSB0aGUgZW50aXJlIHJvb3QtZml4IHJlc3RzIG9uLiBUaGlzXG4gICAgLy8gZm9yY2VzIHRoZSBzY2FuIGFnYWluc3QgZXhhY3RseSB0aGF0IGZ1dHVyZSBibGluZCBzcG90OiBhIHZhbHVlLWJlYXJpbmcgcm93IGEgTkVXIGtpbmQgd3JpdGVzIE9OTFlcbiAgICAvLyB0aHJvdWdoIHRoZSBzcHJlYWQgZm9ybSwgd2l0aCBubyBicmFja2V0IHdyaXRlIHRvIGZhbGwgYmFjayBvbiDigJQgaW52aXNpYmxlIHRvIGEgYnJhY2tldC1vbmx5IHNjYW4uXG4gICAgY29uc3QgZnV0dXJlU3ByZWFkT25seVJlZHVjZXIgPSBbXG4gICAgICBcIiAgICBpZiAoa2luZCA9PT0gJ2tpbmVzaXMtc3RyZWFtJykge1wiLFxuICAgICAgJyAgICAgIC8vIGEgbG9hZC1iZWFyaW5nIHZhbHVlIHJvdyB3cml0dGVuIE9OTFkgdGhyb3VnaCB0aGUgc3ByZWFkLW1lcmdlIGhlbHBlciBmb3JtJyxcbiAgICAgICcgICAgICB2YWx1ZXMgPSB7IC4uLnZhbHVlcywgLi4uc3RyZWFtUmV0ZW50aW9uUm93cyhyZWYsIHJlZ2lvbikgfScsXG4gICAgICAnICAgIH0nLFxuICAgIF0uam9pbignXFxuJylcbiAgICAvLyBUaGUgYnJhY2tldC1vbmx5IHNjYW4gbWlzc2VzIHRoZSBzcHJlYWQgd3JpdGUsIHNvIGl0IG11c3QgTk9UIHNlZSB0aGUgbmV3IGtpbmQ7IHRoZSBzcHJlYWQtYXdhcmUgc2NhblxuICAgIC8vIGRvZXMg4oCUIHRoaXMgaXMgdGhlIFJFRC13aGlsZS1icmFja2V0LW9ubHkgdGhlIGNvbnRyYWN0IHBpbnMuIChraW5lc2lzLXN0cmVhbSBzdGFuZHMgaW4gZm9yIGFueSBmdXR1cmVcbiAgICAvLyB2YWx1ZS1iZWFyaW5nIGtpbmQ6IHdlcmUgaXQgcmVhbCBhbmQgdW5ndWFyZGVkLCB0aGUgZ2F0ZSB3b3VsZCBjZXJ0aWZ5IGEgY2xvYmJlcmVkIHdpZGVuaW5nIGFzIHBhcml0eS4pXG4gICAgZXhwZWN0KHZhbHVlV3JpdGluZ0tpbmRzSW4oZnV0dXJlU3ByZWFkT25seVJlZHVjZXIpLmhhcygna2luZXNpcy1zdHJlYW0nKSkudG9CZSh0cnVlKVxuXG4gICAgLy8gQW5kIG9uIHRoZSBsaXZlIHJlZHVjZXJzIGV2ZXJ5IGtpbmQgdGhlIHNjYW4gZmluZHMgd3JpdGluZyBhIHZhbHVlIHJvdyBJUyBrZXB0IGRpc3RpbmN0IHdpdGhpbiBhXG4gICAgLy8gY2hhbm5lbCDigJQgaW5jbHVkaW5nIHRoZSBzcHJlYWQtd3JpdHRlbiBjb2duaXRvIGRpc2NvdmVyeSByb3dzLCBzbyBubyB2YWx1ZS1iZWFyaW5nIGtpbmQgc2xpcHMgdGhlIG5ldC5cbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgWydjZm4tcmVkdWNlci50cycsICd0ZXJyYWZvcm0tcmVkdWNlci50cyddKSB7XG4gICAgICBjb25zdCBzb3VyY2UgPSByZWFkRmlsZVN5bmMoam9pbihfX2Rpcm5hbWUsICcuLicsICdsaWInLCAncGFyaXR5LWdhdGUnLCBmaWxlKSwgJ3V0ZjgnKVxuICAgICAgZm9yIChjb25zdCBraW5kIG9mIHZhbHVlV3JpdGluZ0tpbmRzSW4oc291cmNlKSkge1xuICAgICAgICBleHBlY3QoVkFMVUVfQkVBUklOR19LSU5EUy5oYXMoa2luZCkpLnRvQmUodHJ1ZSlcbiAgICAgIH1cbiAgICB9XG4gIH0pXG5cbiAgLy8gY29udHJhY3Q6IFM2IOKAlCBubyByZWdyZXNzaW9uIHRvIHRoZSBhbHJlYWR5LWNvcnJlY3QgY29tcGFyaXNvbnMgKHRydXN0LCBidWNrZXQtcG9saWN5LCBzaW5nbGUtb3duZXIgcGlsb3RzKVxuICBpdCgnUzY6IHRydXN0ICsgYnVja2V0LXBvbGljeSArIHRoZSBzaW5nbGUtb3duZXIgcGlsb3RzIGtlZXAgdGhlaXIgdmVyZGljdHMgYWZ0ZXIgdGhlIHNpYmxpbmctZ3JhbnQgZml4OyBubyBlcXVpdmFsZW50IG11bHRpLW93bmVyIGFydGlmYWN0IGZhbHNlLWZhaWxlZCcsICgpID0+IHtcbiAgICAvLyBUaGUgc2luZ2xlLW93bmVyIGdhdGV3YXktcm9sZSBwaWxvdCBzdGlsbCBhZ3JlZXMsIGFuZCBhIGdlbnVpbmUgdHJ1c3QtYWNjb3VudCB3aWRlbmluZyBvbiBpdCBpcyBzdGlsbFxuICAgIC8vIGNhdWdodCAodGhlIHRydXN0IHBlci1vd25lciBkaXNjaXBsaW5lIGlzIHVudG91Y2hlZCkuIFRoZSBtdWx0aS1vd25lciBlcXVpdmFsZW50IGFydGlmYWN0IChTMSdzIHNoYXBlKVxuICAgIC8vIGlzIG5vdCBmYWxzZS1mYWlsZWQg4oCUIGNvdmVyZWQgYnkgUzEvUzQgYWJvdmU7IGhlcmUgdGhlIHJlZ3Jlc3Npb24gZm9jdXMgaXMgdHJ1c3QgKyBhIHNpbmdsZS1vd25lciBwaWxvdC5cbiAgICBjb25zdCBwaWxvdCA9ICh0cnVzdEFjY291bnQ6IHN0cmluZyk6IHVua25vd24gPT4gKHtcbiAgICAgIFJlc291cmNlczoge1xuICAgICAgICBSb2xlOiB7XG4gICAgICAgICAgVHlwZTogJ0FXUzo6SUFNOjpSb2xlJyxcbiAgICAgICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICBSb2xlTmFtZTogJ2FwaWFibGUtZ2F0ZXdheS1tYW5hZ21lbnQtcm9sZScsXG4gICAgICAgICAgICBUYWdzOiBbeyBLZXk6ICdhcGlhYmxlOmxvZ2ljYWwtaWQnLCBWYWx1ZTogJ2dhdGV3YXktbWFuYWdtZW50LXJvbGUnIH1dLFxuICAgICAgICAgICAgQXNzdW1lUm9sZVBvbGljeURvY3VtZW50OiB7IFZlcnNpb246ICcyMDEyLTEwLTE3JywgU3RhdGVtZW50OiBbeyBFZmZlY3Q6ICdBbGxvdycsIFByaW5jaXBhbDogeyBBV1M6IGBhcm46YXdzOmlhbTo6JHt0cnVzdEFjY291bnR9OnJvb3RgIH0sIEFjdGlvbjogJ3N0czpBc3N1bWVSb2xlJyB9XSB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pXG4gICAgY29uc3QgcGlsb3RUZiA9ICh0cnVzdEFjY291bnQ6IHN0cmluZyk6IHVua25vd24gPT5cbiAgICAgIHRmUGxhbihcbiAgICAgICAgW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGFkZHJlc3M6ICdhd3NfaWFtX3JvbGUudGhpcycsXG4gICAgICAgICAgICB0eXBlOiAnYXdzX2lhbV9yb2xlJyxcbiAgICAgICAgICAgIHZhbHVlczoge1xuICAgICAgICAgICAgICBuYW1lOiAnYXBpYWJsZS1nYXRld2F5LW1hbmFnbWVudC1yb2xlJyxcbiAgICAgICAgICAgICAgdGFnczogeyAnYXBpYWJsZTpsb2dpY2FsLWlkJzogJ2dhdGV3YXktbWFuYWdtZW50LXJvbGUnIH0sXG4gICAgICAgICAgICAgIGFzc3VtZV9yb2xlX3BvbGljeTogSlNPTi5zdHJpbmdpZnkoeyBWZXJzaW9uOiAnMjAxMi0xMC0xNycsIFN0YXRlbWVudDogW3sgRWZmZWN0OiAnQWxsb3cnLCBQcmluY2lwYWw6IHsgQVdTOiBgYXJuOmF3czppYW06OiR7dHJ1c3RBY2NvdW50fTpyb290YCB9LCBBY3Rpb246ICdzdHM6QXNzdW1lUm9sZScgfV0gfSksXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICAgIFtdLFxuICAgICAgKVxuICAgIGNvbnN0IGFncmVlID0gZ2F0ZU9mKHBpbG90KCcwMzQ0NDQ4Njk3NTUnKSwgcGlsb3RUZignMDM0NDQ0ODY5NzU1JykpXG4gICAgZXhwZWN0KGFncmVlLnBhc3NlZCkudG9CZSh0cnVlKVxuICAgIGV4cGVjdChhZ3JlZS5kaXZlcmdlbmNlcykudG9FcXVhbChbXSlcblxuICAgIGNvbnN0IHdpZGVuZWQgPSBnYXRlKFtcbiAgICAgIHJlZHVjZUNsb3VkRm9ybWF0aW9uKHBpbG90KCcwMzQ0NDQ4Njk3NTUnKSwgJ2NkaycsIFJFR0lPTiksXG4gICAgICByZWR1Y2VDbG91ZEZvcm1hdGlvbihwaWxvdCgnMDM0NDQ0ODY5NzU1JyksICdjZm4nLCBSRUdJT04pLFxuICAgICAgcmVkdWNlVGVycmFmb3JtU2hvd0pzb24ocGlsb3RUZignOTk5OTg4ODg3Nzc3JyksICd0ZXJyYWZvcm0nLCBSRUdJT04pLFxuICAgIF0pXG4gICAgZXhwZWN0KHdpZGVuZWQucGFzc2VkKS50b0JlKGZhbHNlKVxuICAgIGNvbnN0IHRydXN0ID0gd2lkZW5lZC5kaXZlcmdlbmNlcy5maW5kKChlbnRyeSkgPT4gZW50cnkudGllciA9PT0gJ3ZhbHVlJyAmJiBlbnRyeS5kZXRhaWwuaW5jbHVkZXMoJ3JvbGUtdHJ1c3QtYWNjb3VudCcpKVxuICAgIGV4cGVjdCh0cnVzdD8uY2hhbm5lbHMpLnRvRXF1YWwoWyd0ZXJyYWZvcm0nXSlcbiAgfSlcbn0pXG5cbi8vIFRoZSB3aXRoaW4tY2hhbm5lbCBhbnRpLWRyaWZ0IHNjYW4sIHRhdWdodCB0aGUgc3ByZWFkLW1lcmdlIHZhbHVlLXdyaXRlIGZvcm0gKEYtQSkuIE1pcnJvcnMgdGhlXG4vLyBwcm9kdWN0aW9uIHNjYW4gaW4gcGFyaXR5LWdhdGUuc3BlYy50czsgdGhlIGJyYWNrZXQgZm9ybSBjYXRjaGVzIHRoZSBkaXJlY3QgaWFtLXJvbGUgLyBzMy1idWNrZXQtcG9saWN5XG4vLyB3cml0ZXMsIHRoZSBzcHJlYWQtY2FsbCBmb3JtIChgLi4uaGVscGVyKC4uLilgKSBjYXRjaGVzIHRoZSBjb2duaXRvIGRpc2NvdmVyeSAvIG5hbWVzcGFjZWQgdmFsdWUgcm93cy5cbmNvbnN0IHZhbHVlV3JpdGluZ0tpbmRzSW4gPSAoc291cmNlOiBzdHJpbmcpOiBTZXQ8c3RyaW5nPiA9PiB7XG4gIGNvbnN0IGtpbmRzID0gbmV3IFNldDxzdHJpbmc+KClcbiAgbGV0IGN1cnJlbnRLaW5kOiBzdHJpbmcgfCB1bmRlZmluZWRcbiAgZm9yIChjb25zdCBsaW5lIG9mIHNvdXJjZS5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCBraW5kTWF0Y2ggPSBsaW5lLm1hdGNoKC9raW5kID09PSAnKFteJ10rKScvKVxuICAgIGlmIChraW5kTWF0Y2ggIT09IG51bGwpIGN1cnJlbnRLaW5kID0ga2luZE1hdGNoWzFdXG4gICAgY29uc3QgYnJhY2tldFdyaXRlID0gLyg/PCFbLlxcd10pKD86dmFsdWVzfG91dClcXFsvLnRlc3QobGluZSlcbiAgICBjb25zdCBzcHJlYWRXcml0ZSA9IC8oPzwhWy5cXHddKSg/OnZhbHVlc3xvdXQpID0gXFx7IFtefV0qXFwuXFwuXFwuXFx3K1xcKC8udGVzdChsaW5lKVxuICAgIGlmICgoYnJhY2tldFdyaXRlIHx8IHNwcmVhZFdyaXRlKSAmJiBjdXJyZW50S2luZCAhPT0gdW5kZWZpbmVkKSBraW5kcy5hZGQoY3VycmVudEtpbmQpXG4gIH1cbiAgcmV0dXJuIGtpbmRzXG59XG4iXX0=