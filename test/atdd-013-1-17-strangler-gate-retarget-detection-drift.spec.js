"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Acceptance specs — Story 013-1-17: the strangler drift-gate catches a reference re-target while
 * tolerating a consistent logical-id rename. Frozen contract:
 * contract-013-1-17-strangler-gate-retarget-detection.md
 *
 * One un-skipped spec per contract scenario (S1, S2, S3, S5, S6 — S4 retired by architect ruling
 * 2026-06-21: the IAM retarget is covered by S3 by-reference-or-by-value + S6 by-value literal, the
 * whole-shape oracle subsumes a separate IAM-semantic tier). The strangler drift-gate
 * (cfnDifferences / isCfnEquivalent / assertNoStranglerDrift) is exercised on synthetic
 * baseline-vs-candidate template pairs — the natural test vehicle for a template-level drift gate —
 * plus the real umbrella synth where it strengthens the regression flank. No policy logic is
 * re-declared here; the real `@apiable/umbrella` equivalence engine is the oracle.
 *
 * The S3 retarget cases are RED on the pre-A1 engine (every reference collapses to one shared
 * placeholder, so a re-target canonicalises identically and cfnDifferences returns []); proven by a
 * stash-revert of the engine fix during build.
 */
const cdk = require("aws-cdk-lib");
const assertions_1 = require("aws-cdk-lib/assertions");
const umbrella_1 = require("@apiable/umbrella");
const ACCOUNT = '034444869755';
const REGION = 'eu-central-1';
const ENV = { account: ACCOUNT, region: REGION };
const toJson = (stack) => assertions_1.Template.fromStack(stack).toJSON();
const clone = (v) => JSON.parse(JSON.stringify(v));
/**
 * Two roles of DISTINCT shape and a policy attached to the first. The shape distinction is what a
 * re-target between them exposes: re-attaching the policy to the second role changes the policy's
 * target-shape token, so the re-target is observable drift (it is not two interchangeable clones,
 * which would be an un-observable physical-name collision the gate rightly tolerates).
 */
const policyAttachedTo = (roleId) => ({
    Resources: {
        RoleA: {
            Type: 'AWS::IAM::Role',
            Properties: {
                RoleName: 'role-alpha',
                AssumeRolePolicyDocument: { Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] },
            },
        },
        RoleB: {
            Type: 'AWS::IAM::Role',
            Properties: {
                RoleName: 'role-beta',
                AssumeRolePolicyDocument: { Statement: [{ Effect: 'Allow', Principal: { Service: 'firehose.amazonaws.com' }, Action: 'sts:AssumeRole' }] },
            },
        },
        AppPolicy: {
            Type: 'AWS::IAM::Policy',
            Properties: {
                PolicyName: 'app-policy',
                Roles: [{ Ref: roleId }],
                PolicyDocument: { Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: '*' }] },
            },
        },
    },
});
/** Two buckets of distinct shape and a stream whose destination ARN is taken from one of them by GetAtt. */
const streamWiredTo = (bucketId) => ({
    Resources: {
        BucketA: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'logs-alpha' } },
        BucketB: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'logs-beta' } },
        Stream: {
            Type: 'AWS::KinesisFirehose::DeliveryStream',
            Properties: {
                DeliveryStreamName: 'a-stream',
                S3DestinationConfiguration: { BucketARN: { 'Fn::GetAtt': [bucketId, 'Arn'] } },
            },
        },
    },
});
/** A role whose trust policy names a principal account by value — the by-value re-target flank of S3. */
const roleTrustingAccount = (account) => ({
    Resources: {
        AuthZRole: {
            Type: 'AWS::IAM::Role',
            Properties: {
                RoleName: 'authz-role',
                AssumeRolePolicyDocument: {
                    Statement: [{ Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${account}:root` }, Action: 'sts:AssumeRole' }],
                },
            },
        },
    },
});
/**
 * Two roles of distinct shape and a consumer whose ONLY tie to a role is a top-level `DependsOn` — the
 * dependency-declaration reference form. Re-aiming the `DependsOn` from one role to the other is a
 * re-target the gate must catch; a consistent rename of the depended-on role must stay tolerated.
 */
const dependsOnRole = (roleId) => ({
    Resources: {
        RoleA: {
            Type: 'AWS::IAM::Role',
            Properties: { RoleName: 'role-alpha', AssumeRolePolicyDocument: { Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] } },
        },
        RoleB: {
            Type: 'AWS::IAM::Role',
            Properties: { RoleName: 'role-beta', AssumeRolePolicyDocument: { Statement: [{ Effect: 'Allow', Principal: { Service: 'firehose.amazonaws.com' }, Action: 'sts:AssumeRole' }] } },
        },
        Consumer: { Type: 'AWS::Lambda::Function', DependsOn: roleId, Properties: { FunctionName: 'consumer' } },
    },
});
/** A stateful bucket carrying a top-level `DeletionPolicy` — flipping Retain→Delete is a data-durability drift. */
const bucketWithDeletionPolicy = (policy) => ({
    Resources: {
        LogsBucket: { Type: 'AWS::S3::Bucket', DeletionPolicy: policy, UpdateReplacePolicy: policy, Properties: { BucketName: 'logs' } },
    },
});
/**
 * Two distinctly-shaped buckets (both present in baseline AND candidate, so the resource multiset is
 * identical) and a consumer whose only tie to a bucket is an `Fn::Sub`-embedded attribute reference
 * `${Bucket.Arn}`. Re-aiming only the Sub body from one bucket to the other is the forcing construction
 * for the new Sub-attribute normalisation: if the `Fn::Sub` were ignored (its body treated as opaque
 * text), the consumer's shape would be identical in both templates → no drift; only correct Sub-attr
 * normalisation resolves the embedded id to its target's distinct shape token and reports the re-target.
 */
const subAttrWiredTo = (bucketId) => ({
    Resources: {
        BucketAlpha: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'sub-alpha' } },
        BucketBeta: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'sub-beta' } },
        Consumer: {
            Type: 'AWS::Lambda::Function',
            Properties: { FunctionName: 'sub-consumer', Environment: { Variables: { BucketArn: { 'Fn::Sub': 'destination=${' + bucketId + '.Arn}' } } } },
        },
    },
});
/**
 * Two buckets identical in Type AND Properties, differing ONLY in a top-level `DeletionPolicy`
 * (durable `Retain` vs disposable `Delete`) — both present in baseline AND candidate, so the resource
 * multiset is identical. A consumer ties to one of them through BOTH a direct `{Ref}` and an
 * `{Fn::GetAtt}`. Re-pointing the consumer's references from the durable bucket to the disposable
 * near-twin is observable drift (a reference re-aimed at a resource with a different deletion behaviour),
 * but it is invisible unless the referent token carries the target's load-bearing top-level attributes:
 * if the token were keyed over Type+Properties only, both buckets would yield the identical token and
 * the consumer's shape would match in both templates → no drift (the residual fail-open this closes).
 */
const refToNearTwin = (bucketId) => ({
    Resources: {
        DurableBucket: { Type: 'AWS::S3::Bucket', DeletionPolicy: 'Retain', Properties: { BucketName: 'twin' } },
        DisposableBucket: { Type: 'AWS::S3::Bucket', DeletionPolicy: 'Delete', Properties: { BucketName: 'twin' } },
        Consumer: {
            Type: 'AWS::Lambda::Function',
            Properties: {
                FunctionName: 'twin-consumer',
                Environment: {
                    Variables: {
                        BucketRef: { Ref: bucketId }, // direct Ref to the near-twin
                        BucketArn: { 'Fn::GetAtt': [bucketId, 'Arn'] }, // Fn::GetAtt to the near-twin
                    },
                },
            },
        },
    },
});
/**
 * A published export whose Output carries (or does not carry) a top-level `Condition`. The `Condition`
 * decides whether the export exists in a given environment, so an export that *gains* a `Condition` (same
 * name + same value) can silently vanish where the condition is false and break a dependent stack's
 * `Fn::ImportValue` — it must read as drift. A consistent logical-id rename under a *stable* `Condition`
 * is not observable and must stay tolerated.
 */
const exportWithCondition = (condition) => ({
    Resources: { GatewayRole: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'gw' } } },
    Outputs: {
        RoleArnOut: {
            Value: { 'Fn::GetAtt': ['GatewayRole', 'Arn'] },
            ...(condition !== undefined ? { Condition: condition } : {}),
            Export: { Name: 'gateway-role-arn' },
        },
    },
});
/**
 * A published export whose `Export.Name` is itself an intrinsic (`Fn::Sub`), the legal CFN form for a
 * stack-name-scoped export name. Such an export must still be compared (its presence AND a re-target of
 * its value), not skipped because the name is not a plain string.
 */
const intrinsicNamedExport = (value) => ({
    Resources: { Bucket: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'b' } } },
    Outputs: {
        Out: { Value: value, Export: { Name: { 'Fn::Sub': '${AWS::StackName}-shared' } } },
    },
});
/**
 * Two distinctly-shaped resources and a consumer wired to one of them through a STRING-form
 * `{Fn::GetAtt: 'Logical.Attr'}` (the short form). Re-pointing the string-GetAtt from one to the other is
 * a re-target the gate must catch; the no-over-block side is already covered by `everyReferenceForm` S2.
 */
const stringGetAttWiredTo = (target) => ({
    Resources: {
        BucketA: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'logs-alpha' } },
        BucketB: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'logs-beta' } },
        Consumer: {
            Type: 'AWS::Lambda::Function',
            Properties: { FunctionName: 'consumer', Environment: { Variables: { BucketArn: { 'Fn::GetAtt': `${target}.Arn` } } } },
        },
    },
});
/**
 * Two distinctly-shaped roles and a policy whose CDK default-policy `PolicyName` echoes one role's
 * logical id. Re-pointing only the `PolicyName` echo from one role to the other is a re-target the gate
 * must catch (the echo resolves to its target's shape token); the no-over-block side is covered by S2.
 */
const policyNameEchoOf = (roleId) => ({
    Resources: {
        RoleA: {
            Type: 'AWS::IAM::Role',
            Properties: { RoleName: 'role-alpha', AssumeRolePolicyDocument: { Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] } },
        },
        RoleB: {
            Type: 'AWS::IAM::Role',
            Properties: { RoleName: 'role-beta', AssumeRolePolicyDocument: { Statement: [{ Effect: 'Allow', Principal: { Service: 'firehose.amazonaws.com' }, Action: 'sts:AssumeRole' }] } },
        },
        DefaultPolicy: {
            Type: 'AWS::IAM::Policy',
            Properties: { PolicyName: roleId, Roles: [{ Ref: roleId }], PolicyDocument: { Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: '*' }] } },
        },
    },
});
/**
 * A resource graph exercising EVERY reference form the template can express, so S2 proves no form is
 * left un-normalised: direct {Ref}, attribute {Fn::GetAtt} short (string) AND long (array) form,
 * {Fn::Sub}-embedded ${Logical} AND ${Logical.Attr}, DependsOn, and the default-policy PolicyName echo.
 */
const everyReferenceForm = () => ({
    Resources: {
        TargetRole: {
            Type: 'AWS::IAM::Role',
            Properties: { RoleName: 'target-role', AssumeRolePolicyDocument: { Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] } },
        },
        TargetBucket: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'target-bucket' } },
        Consumer: {
            Type: 'AWS::Lambda::Function',
            DependsOn: 'TargetRole',
            Properties: {
                FunctionName: 'consumer',
                Role: { 'Fn::GetAtt': ['TargetRole', 'Arn'] }, // long-form GetAtt (array)
                Environment: {
                    Variables: {
                        RoleRef: { Ref: 'TargetRole' }, // direct Ref
                        BucketArnShort: { 'Fn::GetAtt': 'TargetBucket.Arn' }, // short-form GetAtt (string)
                        BucketUri: { 'Fn::Sub': 'arn:aws:s3:::${TargetBucket}/data' }, // Fn::Sub-embedded id (bare)
                        RoleArnSub: { 'Fn::Sub': 'role-is-${TargetRole.Arn}' }, // Fn::Sub-embedded attribute ref ${Id.Attr}
                        LiteralKept: { 'Fn::Sub': 'kept-${!Literal}-escape' }, // ${!Literal} escape — never a ref, rename-invariant
                    },
                },
            },
        },
        ConsumerPolicy: {
            Type: 'AWS::IAM::Policy',
            Properties: {
                PolicyName: 'TargetRole', // CDK default-policy name echoes the role logical id
                Roles: [{ Ref: 'TargetRole' }],
                PolicyDocument: { Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: { 'Fn::GetAtt': ['TargetBucket', 'Arn'] } }] },
            },
        },
    },
});
/**
 * A reference cycle: two resources each reference the other (Alpha→Beta via Ref, Beta→Alpha via
 * DependsOn). The shape-token resolver must terminate on the cycle and still tell two distinct cyclic
 * graphs apart — so a rename of the cycle is tolerated while a re-target into the cycle is caught.
 */
const cyclicPair = (extraTarget) => ({
    Resources: {
        Alpha: { Type: 'AWS::IAM::Role', DependsOn: 'Beta', Properties: { RoleName: 'alpha', Peer: { Ref: extraTarget } } },
        Beta: { Type: 'AWS::IAM::Policy', Properties: { PolicyName: 'beta', Roles: [{ Ref: 'Alpha' }] } },
        Gamma: { Type: 'AWS::SQS::Queue', Properties: { QueueName: 'gamma' } },
    },
});
/** Consistently rename a logical id and every reference to it (keys, Ref, GetAtt, Sub, DependsOn, PolicyName echo). */
const renameAll = (template, oldId, newId) => JSON.parse(JSON.stringify(template).split(oldId).join(newId));
describe('013-1-17 strangler drift-gate — retarget detection', () => {
    // S1 — a consistent rename with no observable change reports no drift (happy)
    it('S1: a consistent rename of a resource logical id (+ every reference to it), no real change → no drift', () => {
        const baseline = everyReferenceForm();
        const candidate = renameAll(baseline, 'TargetRole', 'RenamedTargetRole');
        // the raw templates differ (the rename touched keys, Ref, GetAtt, Sub, DependsOn, PolicyName)
        expect(candidate.Resources).not.toEqual(baseline.Resources);
        expect((0, umbrella_1.cfnDifferences)(baseline, candidate)).toEqual([]);
        expect((0, umbrella_1.isCfnEquivalent)(baseline, candidate)).toBe(true);
    });
    // S2 — the rename tolerance covers EVERY form of reference (edge / boundary — no over-block)
    describe('S2: a consistent rename is tolerated through every reference form', () => {
        it.each([
            ['the referenced role (direct Ref, long-form GetAtt, DependsOn, PolicyName echo)', 'TargetRole', 'RenamedRole'],
            ['the referenced bucket (short-form GetAtt, Fn::Sub-embedded id)', 'TargetBucket', 'RenamedBucket'],
        ])('renaming %s → still no drift', (_label, oldId, newId) => {
            const baseline = everyReferenceForm();
            const candidate = renameAll(baseline, oldId, newId);
            expect(candidate.Resources).not.toEqual(baseline.Resources);
            expect((0, umbrella_1.cfnDifferences)(baseline, candidate)).toEqual([]);
        });
        it('the umbrella synth: a real construct-extraction rename of the gateway role is tolerated', () => {
            const before = toJson((0, umbrella_1.buildGatewayRoleStack)(new cdk.App(), { env: ENV }));
            const resources = before.Resources ?? {};
            const oldId = Object.keys(resources).find((id) => resources[id].Type === 'AWS::IAM::Role');
            const renamed = renameAll(before, oldId, `Refactored${oldId}`);
            expect(renamed.Resources).not.toEqual(before.Resources);
            expect((0, umbrella_1.cfnDifferences)(before, renamed)).toEqual([]);
        });
        it('a consistent rename across a reference cycle is tolerated (the resolver terminates on the cycle)', () => {
            const baseline = cyclicPair('Beta');
            const candidate = renameAll(baseline, 'Alpha', 'RenamedAlpha');
            expect(candidate.Resources).not.toEqual(baseline.Resources);
            expect((0, umbrella_1.cfnDifferences)(baseline, candidate)).toEqual([]);
        });
        it('renaming a top-level-DependsOn target → still no drift (the dependency-declaration reference form)', () => {
            const baseline = dependsOnRole('RoleA');
            const candidate = renameAll(baseline, 'RoleA', 'RenamedRoleA');
            expect(candidate.Resources).not.toEqual(baseline.Resources);
            expect((0, umbrella_1.cfnDifferences)(baseline, candidate)).toEqual([]);
        });
        it('renaming a target referenced by an Fn::Sub attribute form ${Id.Arn} → still no drift (no over-block)', () => {
            const baseline = everyReferenceForm();
            const candidate = renameAll(baseline, 'TargetRole', 'RenamedRole');
            // the rename touches the ${TargetRole.Arn} Sub body; the ${!TargetRole} literal escape is left intact
            expect(candidate.Resources).not.toEqual(baseline.Resources);
            expect((0, umbrella_1.cfnDifferences)(baseline, candidate)).toEqual([]);
        });
        it('renaming a near-twin target (+ its {Ref} and {Fn::GetAtt}) whose only distinction is DeletionPolicy → still no drift', () => {
            const baseline = refToNearTwin('DurableBucket');
            const candidate = renameAll(baseline, 'DurableBucket', 'RenamedDurableBucket');
            expect(candidate.Resources).not.toEqual(baseline.Resources);
            expect((0, umbrella_1.cfnDifferences)(baseline, candidate)).toEqual([]);
        });
        it('renaming an exported resource under a STABLE Output Condition → still no drift (the Condition is unchanged)', () => {
            const baseline = exportWithCondition('IsProd');
            const candidate = renameAll(baseline, 'GatewayRole', 'RenamedGatewayRole');
            expect(candidate.Resources).not.toEqual(baseline.Resources);
            expect((0, umbrella_1.cfnDifferences)(baseline, candidate)).toEqual([]);
        });
    });
    // S3 — a re-target (by reference OR by value, incl an IAM trust/principal/resource) is caught
    //       (FORCING — A1/A2 + whole-shape, HIGH fail-open closure; RED on the pre-A1 engine)
    describe('S3: a reference re-pointed at a different target is caught as drift', () => {
        it('a policy re-attached to a DIFFERENT role → drift', () => {
            const baseline = policyAttachedTo('RoleA');
            const candidate = policyAttachedTo('RoleB');
            expect((0, umbrella_1.cfnDifferences)(baseline, candidate).length).toBeGreaterThan(0);
            expect((0, umbrella_1.isCfnEquivalent)(baseline, candidate)).toBe(false);
            expect(() => (0, umbrella_1.assertNoStranglerDrift)(baseline, candidate)).toThrow(/strangler step blocked/);
        });
        it('an export/stream re-wired (via Fn::GetAtt) to a DIFFERENT bucket → drift', () => {
            const baseline = streamWiredTo('BucketA');
            const candidate = streamWiredTo('BucketB');
            expect((0, umbrella_1.cfnDifferences)(baseline, candidate).length).toBeGreaterThan(0);
            expect(() => (0, umbrella_1.assertNoStranglerDrift)(baseline, candidate)).toThrow(/strangler step blocked/);
        });
        it('a role trust re-aimed at a different principal account named BY VALUE → drift', () => {
            const baseline = roleTrustingAccount('111111111111');
            const candidate = roleTrustingAccount('222222222222');
            expect((0, umbrella_1.cfnDifferences)(baseline, candidate).length).toBeGreaterThan(0);
            expect(() => (0, umbrella_1.assertNoStranglerDrift)(baseline, candidate)).toThrow(/strangler step blocked/);
        });
        it('a policy statement resource re-aimed (via Fn::GetAtt) at a different resource → drift', () => {
            const baseline = everyReferenceForm();
            const candidate = clone(baseline);
            // re-aim the statement Resource from TargetBucket to TargetRole (a different existing resource)
            const policy = candidate.Resources.ConsumerPolicy;
            policy.Properties.PolicyDocument.Statement[0].Resource = { 'Fn::GetAtt': ['TargetRole', 'Arn'] };
            expect((0, umbrella_1.cfnDifferences)(baseline, candidate).length).toBeGreaterThan(0);
        });
        it('a re-target through Fn::Sub (embedded id re-pointed at a different resource) → drift', () => {
            const baseline = everyReferenceForm();
            const candidate = clone(baseline);
            const consumer = candidate.Resources.Consumer;
            // the Sub-embedded ${TargetBucket} re-pointed at ${TargetRole} (a differently-shaped resource)
            consumer.Properties.Environment.Variables.BucketUri = { 'Fn::Sub': 'arn:aws:s3:::${TargetRole}/data' };
            expect((0, umbrella_1.cfnDifferences)(baseline, candidate).length).toBeGreaterThan(0);
        });
        it('a re-target through ONLY an Fn::Sub body (the only difference is which bucket the ${Bucket.Arn} points at) → drift', () => {
            // Both buckets exist in both templates, so the multiset is identical and the sole difference is
            // the consumer's Sub-embedded target. The new Sub-attribute normalisation resolves ${Bucket.Arn}
            // to its target's distinct shape token, so the re-target is reported as a property change.
            const baseline = subAttrWiredTo('BucketAlpha');
            const candidate = subAttrWiredTo('BucketBeta');
            expect((0, umbrella_1.cfnDifferences)(baseline, candidate).length).toBeGreaterThan(0);
            expect(() => (0, umbrella_1.assertNoStranglerDrift)(baseline, candidate)).toThrow(/strangler step blocked/);
        });
        it('a top-level DependsOn re-aimed at a DIFFERENT role → drift', () => {
            const baseline = dependsOnRole('RoleA');
            const candidate = dependsOnRole('RoleB');
            expect((0, umbrella_1.cfnDifferences)(baseline, candidate).length).toBeGreaterThan(0);
            expect(() => (0, umbrella_1.assertNoStranglerDrift)(baseline, candidate)).toThrow(/strangler step blocked/);
        });
        it('a re-target INTO a reference cycle (a cyclic member re-pointed at a different resource) → drift', () => {
            const baseline = cyclicPair('Beta');
            const candidate = cyclicPair('Gamma'); // Alpha.Peer re-pointed from Beta (Policy) to Gamma (Queue)
            expect((0, umbrella_1.cfnDifferences)(baseline, candidate).length).toBeGreaterThan(0);
        });
        it('a {Ref} + {Fn::GetAtt} re-pointed to a near-twin differing ONLY in DeletionPolicy → drift (the referent token carries top-level attrs)', () => {
            const baseline = refToNearTwin('DurableBucket');
            const candidate = refToNearTwin('DisposableBucket');
            expect((0, umbrella_1.cfnDifferences)(baseline, candidate).length).toBeGreaterThan(0);
            expect((0, umbrella_1.isCfnEquivalent)(baseline, candidate)).toBe(false);
            expect(() => (0, umbrella_1.assertNoStranglerDrift)(baseline, candidate)).toThrow(/strangler step blocked/);
        });
        it('a string-form {Fn::GetAtt:"Bucket.Arn"} re-pointed at a different bucket → drift', () => {
            const baseline = stringGetAttWiredTo('BucketA');
            const candidate = stringGetAttWiredTo('BucketB');
            expect((0, umbrella_1.cfnDifferences)(baseline, candidate).length).toBeGreaterThan(0);
            expect(() => (0, umbrella_1.assertNoStranglerDrift)(baseline, candidate)).toThrow(/strangler step blocked/);
        });
        it('a PolicyName echo re-pointed from one role to a different role → drift', () => {
            const baseline = policyNameEchoOf('RoleA');
            const candidate = policyNameEchoOf('RoleB');
            expect((0, umbrella_1.cfnDifferences)(baseline, candidate).length).toBeGreaterThan(0);
            expect(() => (0, umbrella_1.assertNoStranglerDrift)(baseline, candidate)).toThrow(/strangler step blocked/);
        });
        it('a published export that GAINS an Output Condition (same name + same value) → drift (the export can vanish where the condition is false)', () => {
            const baseline = exportWithCondition(undefined);
            const candidate = exportWithCondition('IsProd');
            expect((0, umbrella_1.cfnDifferences)(baseline, candidate)).toContainEqual({ kind: 'export-changed', detail: 'gateway-role-arn' });
            expect(() => (0, umbrella_1.assertNoStranglerDrift)(baseline, candidate)).toThrow(/strangler step blocked/);
        });
        it('a published export whose Output Condition CHANGES (same name + same value) → drift', () => {
            const baseline = exportWithCondition('IsProd');
            const candidate = exportWithCondition('IsStaging');
            expect((0, umbrella_1.cfnDifferences)(baseline, candidate)).toContainEqual({ kind: 'export-changed', detail: 'gateway-role-arn' });
        });
        it('an intrinsic-named export (Fn::Sub Export.Name) whose value is re-targeted → drift (the export is compared, not skipped)', () => {
            const baseline = intrinsicNamedExport('v1');
            const candidate = intrinsicNamedExport('v2');
            expect((0, umbrella_1.cfnDifferences)(baseline, candidate).some((d) => d.kind === 'export-changed')).toBe(true);
            expect(() => (0, umbrella_1.assertNoStranglerDrift)(baseline, candidate)).toThrow(/strangler step blocked/);
        });
    });
    // S5 — the gate stays unwired from any live baseline until the closure lands (guardrail)
    // Asserted as a static-source invariant: assertNoStranglerDrift / isCfnEquivalent / cfnDifferences
    // are reachable only from test specs and the lib barrel — never a deploy step, CI workflow, or the
    // parity harness — so the fail-open cannot ship against a real before/after pair.
    it('S5: the strangler API is not wired to any real baseline (deploy / CI / parity harness)', () => {
        const fs = require('fs');
        const path = require('path');
        const repoRoot = path.resolve(__dirname, '..');
        const API = ['assertNoStranglerDrift', 'isCfnEquivalent', 'cfnDifferences'];
        const callers = [];
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'cdk.out')
                    continue;
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(full);
                    continue;
                }
                if (!/\.(ts|js|sh|ya?ml)$/.test(entry.name))
                    continue;
                // the engine's own definitions and its barrel re-export are not "wiring to a baseline"
                if (full.endsWith(path.join('lib', 'umbrella', 'cfn-equivalence.ts')))
                    continue;
                if (full.endsWith(path.join('lib', 'umbrella', 'index.ts')))
                    continue;
                const text = fs.readFileSync(full, 'utf8');
                if (API.some((sym) => text.includes(sym)))
                    callers.push(path.relative(repoRoot, full));
            }
        };
        walk(repoRoot);
        // every caller must be a test spec — no deploy-*.sh, no .github workflow, no parity-gate harness
        const nonTestCallers = callers.filter((f) => !/\.spec\.ts$/.test(f));
        expect(nonTestCallers).toEqual([]);
    });
    // S6 — the existing drift verdicts are unchanged (regression)
    describe('S6: the existing drift verdicts are unchanged', () => {
        it('a resource added → still drift', () => {
            const baseline = policyAttachedTo('RoleA');
            const candidate = clone(baseline);
            candidate.Resources['Extra'] = { Type: 'AWS::SQS::Queue', Properties: { QueueName: 'extra' } };
            expect((0, umbrella_1.cfnDifferences)(baseline, candidate)).toContainEqual({ kind: 'resource-added', detail: 'AWS::SQS::Queue (×1)' });
            expect(() => (0, umbrella_1.assertNoStranglerDrift)(baseline, candidate)).toThrow(/strangler step blocked/);
        });
        it('a resource removed → still drift', () => {
            const baseline = policyAttachedTo('RoleA');
            const candidate = clone(baseline);
            delete candidate.Resources['RoleB'];
            expect((0, umbrella_1.cfnDifferences)(baseline, candidate).some((d) => d.kind === 'resource-removed')).toBe(true);
        });
        it('a published export renamed / dropped / re-valued → still drift', () => {
            const baseline = { Resources: { B: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'b' } } }, Outputs: { Out: { Value: 'v', Export: { Name: 'shared' } } } };
            const reValued = clone(baseline);
            reValued.Outputs['Out'].Value = 'changed';
            expect((0, umbrella_1.cfnDifferences)(baseline, reValued)).toContainEqual({ kind: 'export-changed', detail: 'shared' });
            const dropped = clone(baseline);
            delete dropped.Outputs['Out'];
            expect((0, umbrella_1.cfnDifferences)(baseline, dropped)).toContainEqual({ kind: 'export-removed', detail: 'shared' });
        });
        it('a scalar property changed (a load-bearing literal inside a trust document, e.g. a trusted account) → still drift', () => {
            const baseline = roleTrustingAccount('111111111111');
            const changed = roleTrustingAccount('999999999999');
            expect((0, umbrella_1.cfnDifferences)(baseline, changed).length).toBeGreaterThan(0);
        });
        it('a stateful resource DeletionPolicy / UpdateReplacePolicy flipped Retain → Delete → drift (data-durability)', () => {
            const baseline = bucketWithDeletionPolicy('Retain');
            const candidate = bucketWithDeletionPolicy('Delete');
            expect((0, umbrella_1.cfnDifferences)(baseline, candidate).length).toBeGreaterThan(0);
            expect(() => (0, umbrella_1.assertNoStranglerDrift)(baseline, candidate)).toThrow(/strangler step blocked/);
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXRkZC0wMTMtMS0xNy1zdHJhbmdsZXItZ2F0ZS1yZXRhcmdldC1kZXRlY3Rpb24tZHJpZnQuc3BlYy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImF0ZGQtMDEzLTEtMTctc3RyYW5nbGVyLWdhdGUtcmV0YXJnZXQtZGV0ZWN0aW9uLWRyaWZ0LnNwZWMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQTs7Ozs7Ozs7Ozs7Ozs7OztHQWdCRztBQUNILG1DQUFrQztBQUNsQyx1REFBaUQ7QUFDakQsZ0RBQWtIO0FBRWxILE1BQU0sT0FBTyxHQUFHLGNBQWMsQ0FBQTtBQUM5QixNQUFNLE1BQU0sR0FBRyxjQUFjLENBQUE7QUFDN0IsTUFBTSxHQUFHLEdBQUcsRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsQ0FBQTtBQVFoRCxNQUFNLE1BQU0sR0FBRyxDQUFDLEtBQWdCLEVBQVEsRUFBRSxDQUFDLHFCQUFRLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFBO0FBQzdFLE1BQU0sS0FBSyxHQUFHLENBQUksQ0FBSSxFQUFLLEVBQUUsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQU0sQ0FBQTtBQUVoRTs7Ozs7R0FLRztBQUNILE1BQU0sZ0JBQWdCLEdBQUcsQ0FBQyxNQUF5QixFQUFRLEVBQUUsQ0FBQyxDQUFDO0lBQzdELFNBQVMsRUFBRTtRQUNULEtBQUssRUFBRTtZQUNMLElBQUksRUFBRSxnQkFBZ0I7WUFDdEIsVUFBVSxFQUFFO2dCQUNWLFFBQVEsRUFBRSxZQUFZO2dCQUN0Qix3QkFBd0IsRUFBRSxFQUFFLFNBQVMsRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxTQUFTLEVBQUUsRUFBRSxPQUFPLEVBQUUsc0JBQXNCLEVBQUUsRUFBRSxNQUFNLEVBQUUsZ0JBQWdCLEVBQUUsQ0FBQyxFQUFFO2FB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QU0sUUFBUSxHQUFHLG1CQUFtQixDQUFDLGNBQWMsQ0FBQyxDQUFBO1lBQ3BELE1BQU0sT0FBTyxHQUFHLG1CQUFtQixDQUFDLGNBQWMsQ0FBQyxDQUFBO1lBQ25ELE1BQU0sQ0FBQyxJQUFBLHlCQUFjLEVBQUMsUUFBUSxFQUFFLE9BQU8sQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUNyRSxDQUFDLENBQUMsQ0FBQTtRQUVGLEVBQUUsQ0FBQyw0R0FBNEcsRUFBRSxHQUFHLEVBQUU7WUFDcEgsTUFBTSxRQUFRLEdBQUcsd0JBQXdCLENBQUMsUUFBUSxDQUFDLENBQUE7WUFDbkQsTUFBTSxTQUFTLEdBQUcsd0JBQXdCLENBQUMsUUFBUSxDQUFDLENBQUE7WUFDcEQsTUFBTSxDQUFDLElBQUEseUJBQWMsRUFBQyxRQUFRLEVBQUUsU0FBUyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxDQUFBO1lBQ3JFLE1BQU0sQ0FBQyxHQUFHLEVBQUUsQ0FBQyxJQUFBLGlDQUFzQixFQUFDLFFBQVEsRUFBRSxTQUFTLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyx3QkFBd0IsQ0FBQyxDQUFBO1FBQzdGLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQyxDQUFDLENBQUE7QUFDSixDQUFDLENBQUMsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQWNjZXB0YW5jZSBzcGVjcyDigJQgU3RvcnkgMDEzLTEtMTc6IHRoZSBzdHJhbmdsZXIgZHJpZnQtZ2F0ZSBjYXRjaGVzIGEgcmVmZXJlbmNlIHJlLXRhcmdldCB3aGlsZVxuICogdG9sZXJhdGluZyBhIGNvbnNpc3RlbnQgbG9naWNhbC1pZCByZW5hbWUuIEZyb3plbiBjb250cmFjdDpcbiAqIGNvbnRyYWN0LTAxMy0xLTE3LXN0cmFuZ2xlci1nYXRlLXJldGFyZ2V0LWRldGVjdGlvbi5tZFxuICpcbiAqIE9uZSB1bi1za2lwcGVkIHNwZWMgcGVyIGNvbnRyYWN0IHNjZW5hcmlvIChTMSwgUzIsIFMzLCBTNSwgUzYg4oCUIFM0IHJldGlyZWQgYnkgYXJjaGl0ZWN0IHJ1bGluZ1xuICogMjAyNi0wNi0yMTogdGhlIElBTSByZXRhcmdldCBpcyBjb3ZlcmVkIGJ5IFMzIGJ5LXJlZmVyZW5jZS1vci1ieS12YWx1ZSArIFM2IGJ5LXZhbHVlIGxpdGVyYWwsIHRoZVxuICogd2hvbGUtc2hhcGUgb3JhY2xlIHN1YnN1bWVzIGEgc2VwYXJhdGUgSUFNLXNlbWFudGljIHRpZXIpLiBUaGUgc3RyYW5nbGVyIGRyaWZ0LWdhdGVcbiAqIChjZm5EaWZmZXJlbmNlcyAvIGlzQ2ZuRXF1aXZhbGVudCAvIGFzc2VydE5vU3RyYW5nbGVyRHJpZnQpIGlzIGV4ZXJjaXNlZCBvbiBzeW50aGV0aWNcbiAqIGJhc2VsaW5lLXZzLWNhbmRpZGF0ZSB0ZW1wbGF0ZSBwYWlycyDigJQgdGhlIG5hdHVyYWwgdGVzdCB2ZWhpY2xlIGZvciBhIHRlbXBsYXRlLWxldmVsIGRyaWZ0IGdhdGUg4oCUXG4gKiBwbHVzIHRoZSByZWFsIHVtYnJlbGxhIHN5bnRoIHdoZXJlIGl0IHN0cmVuZ3RoZW5zIHRoZSByZWdyZXNzaW9uIGZsYW5rLiBObyBwb2xpY3kgbG9naWMgaXNcbiAqIHJlLWRlY2xhcmVkIGhlcmU7IHRoZSByZWFsIGBAYXBpYWJsZS91bWJyZWxsYWAgZXF1aXZhbGVuY2UgZW5naW5lIGlzIHRoZSBvcmFjbGUuXG4gKlxuICogVGhlIFMzIHJldGFyZ2V0IGNhc2VzIGFyZSBSRUQgb24gdGhlIHByZS1BMSBlbmdpbmUgKGV2ZXJ5IHJlZmVyZW5jZSBjb2xsYXBzZXMgdG8gb25lIHNoYXJlZFxuICogcGxhY2Vob2xkZXIsIHNvIGEgcmUtdGFyZ2V0IGNhbm9uaWNhbGlzZXMgaWRlbnRpY2FsbHkgYW5kIGNmbkRpZmZlcmVuY2VzIHJldHVybnMgW10pOyBwcm92ZW4gYnkgYVxuICogc3Rhc2gtcmV2ZXJ0IG9mIHRoZSBlbmdpbmUgZml4IGR1cmluZyBidWlsZC5cbiAqL1xuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJ1xuaW1wb3J0IHsgVGVtcGxhdGUgfSBmcm9tICdhd3MtY2RrLWxpYi9hc3NlcnRpb25zJ1xuaW1wb3J0IHsgYnVpbGRHYXRld2F5Um9sZVN0YWNrLCBjZm5EaWZmZXJlbmNlcywgaXNDZm5FcXVpdmFsZW50LCBhc3NlcnROb1N0cmFuZ2xlckRyaWZ0IH0gZnJvbSAnQGFwaWFibGUvdW1icmVsbGEnXG5cbmNvbnN0IEFDQ09VTlQgPSAnMDM0NDQ0ODY5NzU1J1xuY29uc3QgUkVHSU9OID0gJ2V1LWNlbnRyYWwtMSdcbmNvbnN0IEVOViA9IHsgYWNjb3VudDogQUNDT1VOVCwgcmVnaW9uOiBSRUdJT04gfVxuXG50eXBlIEpzb24gPSBSZXR1cm5UeXBlPFRlbXBsYXRlWyd0b0pTT04nXT5cbnR5cGUgQ2ZuUmVzb3VyY2UgPSB7IFR5cGU6IHN0cmluZzsgUHJvcGVydGllcz86IHVua25vd247IFtrOiBzdHJpbmddOiB1bmtub3duIH1cbnR5cGUgVG1wbCA9IHtcbiAgUmVzb3VyY2VzPzogUmVjb3JkPHN0cmluZywgQ2ZuUmVzb3VyY2U+XG4gIE91dHB1dHM/OiBSZWNvcmQ8c3RyaW5nLCB7IFZhbHVlPzogdW5rbm93bjsgRXhwb3J0PzogeyBOYW1lPzogdW5rbm93biB9OyBbazogc3RyaW5nXTogdW5rbm93biB9PlxufVxuY29uc3QgdG9Kc29uID0gKHN0YWNrOiBjZGsuU3RhY2spOiBKc29uID0+IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjaykudG9KU09OKClcbmNvbnN0IGNsb25lID0gPFQ+KHY6IFQpOiBUID0+IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkodikpIGFzIFRcblxuLyoqXG4gKiBUd28gcm9sZXMgb2YgRElTVElOQ1Qgc2hhcGUgYW5kIGEgcG9saWN5IGF0dGFjaGVkIHRvIHRoZSBmaXJzdC4gVGhlIHNoYXBlIGRpc3RpbmN0aW9uIGlzIHdoYXQgYVxuICogcmUtdGFyZ2V0IGJldHdlZW4gdGhlbSBleHBvc2VzOiByZS1hdHRhY2hpbmcgdGhlIHBvbGljeSB0byB0aGUgc2Vjb25kIHJvbGUgY2hhbmdlcyB0aGUgcG9saWN5J3NcbiAqIHRhcmdldC1zaGFwZSB0b2tlbiwgc28gdGhlIHJlLXRhcmdldCBpcyBvYnNlcnZhYmxlIGRyaWZ0IChpdCBpcyBub3QgdHdvIGludGVyY2hhbmdlYWJsZSBjbG9uZXMsXG4gKiB3aGljaCB3b3VsZCBiZSBhbiB1bi1vYnNlcnZhYmxlIHBoeXNpY2FsLW5hbWUgY29sbGlzaW9uIHRoZSBnYXRlIHJpZ2h0bHkgdG9sZXJhdGVzKS5cbiAqL1xuY29uc3QgcG9saWN5QXR0YWNoZWRUbyA9IChyb2xlSWQ6ICdSb2xlQScgfCAnUm9sZUInKTogVG1wbCA9PiAoe1xuICBSZXNvdXJjZXM6IHtcbiAgICBSb2xlQToge1xuICAgICAgVHlwZTogJ0FXUzo6SUFNOjpSb2xlJyxcbiAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgUm9sZU5hbWU6ICdyb2xlLWFscGhhJyxcbiAgICAgICAgQXNzdW1lUm9sZVBvbGljeURvY3VtZW50OiB7IFN0YXRlbWVudDogW3sgRWZmZWN0OiAnQWxsb3cnLCBQcmluY2lwYWw6IHsgU2VydmljZTogJ2xhbWJkYS5hbWF6b25hd3MuY29tJyB9LCBBY3Rpb246ICdzdHM6QXNzdW1lUm9sZScgfV0gfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBSb2xlQjoge1xuICAgICAgVHlwZTogJ0FXUzo6SUFNOjpSb2xlJyxcbiAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgUm9sZU5hbWU6ICdyb2xlLWJldGEnLFxuICAgICAgICBBc3N1bWVSb2xlUG9saWN5RG9jdW1lbnQ6IHsgU3RhdGVtZW50OiBbeyBFZmZlY3Q6ICdBbGxvdycsIFByaW5jaXBhbDogeyBTZXJ2aWNlOiAnZmlyZWhvc2UuYW1hem9uYXdzLmNvbScgfSwgQWN0aW9uOiAnc3RzOkFzc3VtZVJvbGUnIH1dIH0sXG4gICAgICB9LFxuICAgIH0sXG4gICAgQXBwUG9saWN5OiB7XG4gICAgICBUeXBlOiAnQVdTOjpJQU06OlBvbGljeScsXG4gICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgIFBvbGljeU5hbWU6ICdhcHAtcG9saWN5JyxcbiAgICAgICAgUm9sZXM6IFt7IFJlZjogcm9sZUlkIH1dLFxuICAgICAgICBQb2xpY3lEb2N1bWVudDogeyBTdGF0ZW1lbnQ6IFt7IEVmZmVjdDogJ0FsbG93JywgQWN0aW9uOiAnczM6R2V0T2JqZWN0JywgUmVzb3VyY2U6ICcqJyB9XSB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxufSlcblxuLyoqIFR3byBidWNrZXRzIG9mIGRpc3RpbmN0IHNoYXBlIGFuZCBhIHN0cmVhbSB3aG9zZSBkZXN0aW5hdGlvbiBBUk4gaXMgdGFrZW4gZnJvbSBvbmUgb2YgdGhlbSBieSBHZXRBdHQuICovXG5jb25zdCBzdHJlYW1XaXJlZFRvID0gKGJ1Y2tldElkOiAnQnVja2V0QScgfCAnQnVja2V0QicpOiBUbXBsID0+ICh7XG4gIFJlc291cmNlczoge1xuICAgIEJ1Y2tldEE6IHsgVHlwZTogJ0FXUzo6UzM6OkJ1Y2tldCcsIFByb3BlcnRpZXM6IHsgQnVja2V0TmFtZTogJ2xvZ3MtYWxwaGEnIH0gfSxcbiAgICBCdWNrZXRCOiB7IFR5cGU6ICdBV1M6OlMzOjpCdWNrZXQnLCBQcm9wZXJ0aWVzOiB7IEJ1Y2tldE5hbWU6ICdsb2dzLWJldGEnIH0gfSxcbiAgICBTdHJlYW06IHtcbiAgICAgIFR5cGU6ICdBV1M6OktpbmVzaXNGaXJlaG9zZTo6RGVsaXZlcnlTdHJlYW0nLFxuICAgICAgUHJvcGVydGllczoge1xuICAgICAgICBEZWxpdmVyeVN0cmVhbU5hbWU6ICdhLXN0cmVhbScsXG4gICAgICAgIFMzRGVzdGluYXRpb25Db25maWd1cmF0aW9uOiB7IEJ1Y2tldEFSTjogeyAnRm46OkdldEF0dCc6IFtidWNrZXRJZCwgJ0FybiddIH0gfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbn0pXG5cbi8qKiBBIHJvbGUgd2hvc2UgdHJ1c3QgcG9saWN5IG5hbWVzIGEgcHJpbmNpcGFsIGFjY291bnQgYnkgdmFsdWUg4oCUIHRoZSBieS12YWx1ZSByZS10YXJnZXQgZmxhbmsgb2YgUzMuICovXG5jb25zdCByb2xlVHJ1c3RpbmdBY2NvdW50ID0gKGFjY291bnQ6IHN0cmluZyk6IFRtcGwgPT4gKHtcbiAgUmVzb3VyY2VzOiB7XG4gICAgQXV0aFpSb2xlOiB7XG4gICAgICBUeXBlOiAnQVdTOjpJQU06OlJvbGUnLFxuICAgICAgUHJvcGVydGllczoge1xuICAgICAgICBSb2xlTmFtZTogJ2F1dGh6LXJvbGUnLFxuICAgICAgICBBc3N1bWVSb2xlUG9saWN5RG9jdW1lbnQ6IHtcbiAgICAgICAgICBTdGF0ZW1lbnQ6IFt7IEVmZmVjdDogJ0FsbG93JywgUHJpbmNpcGFsOiB7IEFXUzogYGFybjphd3M6aWFtOjoke2FjY291bnR9OnJvb3RgIH0sIEFjdGlvbjogJ3N0czpBc3N1bWVSb2xlJyB9XSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbn0pXG5cbi8qKlxuICogVHdvIHJvbGVzIG9mIGRpc3RpbmN0IHNoYXBlIGFuZCBhIGNvbnN1bWVyIHdob3NlIE9OTFkgdGllIHRvIGEgcm9sZSBpcyBhIHRvcC1sZXZlbCBgRGVwZW5kc09uYCDigJQgdGhlXG4gKiBkZXBlbmRlbmN5LWRlY2xhcmF0aW9uIHJlZmVyZW5jZSBmb3JtLiBSZS1haW1pbmcgdGhlIGBEZXBlbmRzT25gIGZyb20gb25lIHJvbGUgdG8gdGhlIG90aGVyIGlzIGFcbiAqIHJlLXRhcmdldCB0aGUgZ2F0ZSBtdXN0IGNhdGNoOyBhIGNvbnNpc3RlbnQgcmVuYW1lIG9mIHRoZSBkZXBlbmRlZC1vbiByb2xlIG11c3Qgc3RheSB0b2xlcmF0ZWQuXG4gKi9cbmNvbnN0IGRlcGVuZHNPblJvbGUgPSAocm9sZUlkOiAnUm9sZUEnIHwgJ1JvbGVCJyk6IFRtcGwgPT4gKHtcbiAgUmVzb3VyY2VzOiB7XG4gICAgUm9sZUE6IHtcbiAgICAgIFR5cGU6ICdBV1M6OklBTTo6Um9sZScsXG4gICAgICBQcm9wZXJ0aWVzOiB7IFJvbGVOYW1lOiAncm9sZS1hbHBoYScsIEFzc3VtZVJvbGVQb2xpY3lEb2N1bWVudDogeyBTdGF0ZW1lbnQ6IFt7IEVmZmVjdDogJ0FsbG93JywgUHJpbmNpcGFsOiB7IFNlcnZpY2U6ICdsYW1iZGEuYW1hem9uYXdzLmNvbScgfSwgQWN0aW9uOiAnc3RzOkFzc3VtZVJvbGUnIH1dIH0gfSxcbiAgICB9LFxuICAgIFJvbGVCOiB7XG4gICAgICBUeXBlOiAnQVdTOjpJQU06OlJvbGUnLFxuICAgICAgUHJvcGVydGllczogeyBSb2xlTmFtZTogJ3JvbGUtYmV0YScsIEFzc3VtZVJvbGVQb2xpY3lEb2N1bWVudDogeyBTdGF0ZW1lbnQ6IFt7IEVmZmVjdDogJ0FsbG93JywgUHJpbmNpcGFsOiB7IFNlcnZpY2U6ICdmaXJlaG9zZS5hbWF6b25hd3MuY29tJyB9LCBBY3Rpb246ICdzdHM6QXNzdW1lUm9sZScgfV0gfSB9LFxuICAgIH0sXG4gICAgQ29uc3VtZXI6IHsgVHlwZTogJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIERlcGVuZHNPbjogcm9sZUlkLCBQcm9wZXJ0aWVzOiB7IEZ1bmN0aW9uTmFtZTogJ2NvbnN1bWVyJyB9IH0sXG4gIH0sXG59KVxuXG4vKiogQSBzdGF0ZWZ1bCBidWNrZXQgY2FycnlpbmcgYSB0b3AtbGV2ZWwgYERlbGV0aW9uUG9saWN5YCDigJQgZmxpcHBpbmcgUmV0YWlu4oaSRGVsZXRlIGlzIGEgZGF0YS1kdXJhYmlsaXR5IGRyaWZ0LiAqL1xuY29uc3QgYnVja2V0V2l0aERlbGV0aW9uUG9saWN5ID0gKHBvbGljeTogJ1JldGFpbicgfCAnRGVsZXRlJyk6IFRtcGwgPT4gKHtcbiAgUmVzb3VyY2VzOiB7XG4gICAgTG9nc0J1Y2tldDogeyBUeXBlOiAnQVdTOjpTMzo6QnVja2V0JywgRGVsZXRpb25Qb2xpY3k6IHBvbGljeSwgVXBkYXRlUmVwbGFjZVBvbGljeTogcG9saWN5LCBQcm9wZXJ0aWVzOiB7IEJ1Y2tldE5hbWU6ICdsb2dzJyB9IH0sXG4gIH0sXG59KVxuXG4vKipcbiAqIFR3byBkaXN0aW5jdGx5LXNoYXBlZCBidWNrZXRzIChib3RoIHByZXNlbnQgaW4gYmFzZWxpbmUgQU5EIGNhbmRpZGF0ZSwgc28gdGhlIHJlc291cmNlIG11bHRpc2V0IGlzXG4gKiBpZGVudGljYWwpIGFuZCBhIGNvbnN1bWVyIHdob3NlIG9ubHkgdGllIHRvIGEgYnVja2V0IGlzIGFuIGBGbjo6U3ViYC1lbWJlZGRlZCBhdHRyaWJ1dGUgcmVmZXJlbmNlXG4gKiBgJHtCdWNrZXQuQXJufWAuIFJlLWFpbWluZyBvbmx5IHRoZSBTdWIgYm9keSBmcm9tIG9uZSBidWNrZXQgdG8gdGhlIG90aGVyIGlzIHRoZSBmb3JjaW5nIGNvbnN0cnVjdGlvblxuICogZm9yIHRoZSBuZXcgU3ViLWF0dHJpYnV0ZSBub3JtYWxpc2F0aW9uOiBpZiB0aGUgYEZuOjpTdWJgIHdlcmUgaWdub3JlZCAoaXRzIGJvZHkgdHJlYXRlZCBhcyBvcGFxdWVcbiAqIHRleHQpLCB0aGUgY29uc3VtZXIncyBzaGFwZSB3b3VsZCBiZSBpZGVudGljYWwgaW4gYm90aCB0ZW1wbGF0ZXMg4oaSIG5vIGRyaWZ0OyBvbmx5IGNvcnJlY3QgU3ViLWF0dHJcbiAqIG5vcm1hbGlzYXRpb24gcmVzb2x2ZXMgdGhlIGVtYmVkZGVkIGlkIHRvIGl0cyB0YXJnZXQncyBkaXN0aW5jdCBzaGFwZSB0b2tlbiBhbmQgcmVwb3J0cyB0aGUgcmUtdGFyZ2V0LlxuICovXG5jb25zdCBzdWJBdHRyV2lyZWRUbyA9IChidWNrZXRJZDogJ0J1Y2tldEFscGhhJyB8ICdCdWNrZXRCZXRhJyk6IFRtcGwgPT4gKHtcbiAgUmVzb3VyY2VzOiB7XG4gICAgQnVja2V0QWxwaGE6IHsgVHlwZTogJ0FXUzo6UzM6OkJ1Y2tldCcsIFByb3BlcnRpZXM6IHsgQnVja2V0TmFtZTogJ3N1Yi1hbHBoYScgfSB9LFxuICAgIEJ1Y2tldEJldGE6IHsgVHlwZTogJ0FXUzo6UzM6OkJ1Y2tldCcsIFByb3BlcnRpZXM6IHsgQnVja2V0TmFtZTogJ3N1Yi1iZXRhJyB9IH0sXG4gICAgQ29uc3VtZXI6IHtcbiAgICAgIFR5cGU6ICdBV1M6OkxhbWJkYTo6RnVuY3Rpb24nLFxuICAgICAgUHJvcGVydGllczogeyBGdW5jdGlvbk5hbWU6ICdzdWItY29uc3VtZXInLCBFbnZpcm9ubWVudDogeyBWYXJpYWJsZXM6IHsgQnVja2V0QXJuOiB7ICdGbjo6U3ViJzogJ2Rlc3RpbmF0aW9uPSR7JyArIGJ1Y2tldElkICsgJy5Bcm59JyB9IH0gfSB9LFxuICAgIH0sXG4gIH0sXG59KVxuXG4vKipcbiAqIFR3byBidWNrZXRzIGlkZW50aWNhbCBpbiBUeXBlIEFORCBQcm9wZXJ0aWVzLCBkaWZmZXJpbmcgT05MWSBpbiBhIHRvcC1sZXZlbCBgRGVsZXRpb25Qb2xpY3lgXG4gKiAoZHVyYWJsZSBgUmV0YWluYCB2cyBkaXNwb3NhYmxlIGBEZWxldGVgKSDigJQgYm90aCBwcmVzZW50IGluIGJhc2VsaW5lIEFORCBjYW5kaWRhdGUsIHNvIHRoZSByZXNvdXJjZVxuICogbXVsdGlzZXQgaXMgaWRlbnRpY2FsLiBBIGNvbnN1bWVyIHRpZXMgdG8gb25lIG9mIHRoZW0gdGhyb3VnaCBCT1RIIGEgZGlyZWN0IGB7UmVmfWAgYW5kIGFuXG4gKiBge0ZuOjpHZXRBdHR9YC4gUmUtcG9pbnRpbmcgdGhlIGNvbnN1bWVyJ3MgcmVmZXJlbmNlcyBmcm9tIHRoZSBkdXJhYmxlIGJ1Y2tldCB0byB0aGUgZGlzcG9zYWJsZVxuICogbmVhci10d2luIGlzIG9ic2VydmFibGUgZHJpZnQgKGEgcmVmZXJlbmNlIHJlLWFpbWVkIGF0IGEgcmVzb3VyY2Ugd2l0aCBhIGRpZmZlcmVudCBkZWxldGlvbiBiZWhhdmlvdXIpLFxuICogYnV0IGl0IGlzIGludmlzaWJsZSB1bmxlc3MgdGhlIHJlZmVyZW50IHRva2VuIGNhcnJpZXMgdGhlIHRhcmdldCdzIGxvYWQtYmVhcmluZyB0b3AtbGV2ZWwgYXR0cmlidXRlczpcbiAqIGlmIHRoZSB0b2tlbiB3ZXJlIGtleWVkIG92ZXIgVHlwZStQcm9wZXJ0aWVzIG9ubHksIGJvdGggYnVja2V0cyB3b3VsZCB5aWVsZCB0aGUgaWRlbnRpY2FsIHRva2VuIGFuZFxuICogdGhlIGNvbnN1bWVyJ3Mgc2hhcGUgd291bGQgbWF0Y2ggaW4gYm90aCB0ZW1wbGF0ZXMg4oaSIG5vIGRyaWZ0ICh0aGUgcmVzaWR1YWwgZmFpbC1vcGVuIHRoaXMgY2xvc2VzKS5cbiAqL1xuY29uc3QgcmVmVG9OZWFyVHdpbiA9IChidWNrZXRJZDogJ0R1cmFibGVCdWNrZXQnIHwgJ0Rpc3Bvc2FibGVCdWNrZXQnKTogVG1wbCA9PiAoe1xuICBSZXNvdXJjZXM6IHtcbiAgICBEdXJhYmxlQnVja2V0OiB7IFR5cGU6ICdBV1M6OlMzOjpCdWNrZXQnLCBEZWxldGlvblBvbGljeTogJ1JldGFpbicsIFByb3BlcnRpZXM6IHsgQnVja2V0TmFtZTogJ3R3aW4nIH0gfSxcbiAgICBEaXNwb3NhYmxlQnVja2V0OiB7IFR5cGU6ICdBV1M6OlMzOjpCdWNrZXQnLCBEZWxldGlvblBvbGljeTogJ0RlbGV0ZScsIFByb3BlcnRpZXM6IHsgQnVja2V0TmFtZTogJ3R3aW4nIH0gfSxcbiAgICBDb25zdW1lcjoge1xuICAgICAgVHlwZTogJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsXG4gICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgIEZ1bmN0aW9uTmFtZTogJ3R3aW4tY29uc3VtZXInLFxuICAgICAgICBFbnZpcm9ubWVudDoge1xuICAgICAgICAgIFZhcmlhYmxlczoge1xuICAgICAgICAgICAgQnVja2V0UmVmOiB7IFJlZjogYnVja2V0SWQgfSwgLy8gZGlyZWN0IFJlZiB0byB0aGUgbmVhci10d2luXG4gICAgICAgICAgICBCdWNrZXRBcm46IHsgJ0ZuOjpHZXRBdHQnOiBbYnVja2V0SWQsICdBcm4nXSB9LCAvLyBGbjo6R2V0QXR0IHRvIHRoZSBuZWFyLXR3aW5cbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxufSlcblxuLyoqXG4gKiBBIHB1Ymxpc2hlZCBleHBvcnQgd2hvc2UgT3V0cHV0IGNhcnJpZXMgKG9yIGRvZXMgbm90IGNhcnJ5KSBhIHRvcC1sZXZlbCBgQ29uZGl0aW9uYC4gVGhlIGBDb25kaXRpb25gXG4gKiBkZWNpZGVzIHdoZXRoZXIgdGhlIGV4cG9ydCBleGlzdHMgaW4gYSBnaXZlbiBlbnZpcm9ubWVudCwgc28gYW4gZXhwb3J0IHRoYXQgKmdhaW5zKiBhIGBDb25kaXRpb25gIChzYW1lXG4gKiBuYW1lICsgc2FtZSB2YWx1ZSkgY2FuIHNpbGVudGx5IHZhbmlzaCB3aGVyZSB0aGUgY29uZGl0aW9uIGlzIGZhbHNlIGFuZCBicmVhayBhIGRlcGVuZGVudCBzdGFjaydzXG4gKiBgRm46OkltcG9ydFZhbHVlYCDigJQgaXQgbXVzdCByZWFkIGFzIGRyaWZ0LiBBIGNvbnNpc3RlbnQgbG9naWNhbC1pZCByZW5hbWUgdW5kZXIgYSAqc3RhYmxlKiBgQ29uZGl0aW9uYFxuICogaXMgbm90IG9ic2VydmFibGUgYW5kIG11c3Qgc3RheSB0b2xlcmF0ZWQuXG4gKi9cbmNvbnN0IGV4cG9ydFdpdGhDb25kaXRpb24gPSAoY29uZGl0aW9uOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBUbXBsID0+ICh7XG4gIFJlc291cmNlczogeyBHYXRld2F5Um9sZTogeyBUeXBlOiAnQVdTOjpJQU06OlJvbGUnLCBQcm9wZXJ0aWVzOiB7IFJvbGVOYW1lOiAnZ3cnIH0gfSB9LFxuICBPdXRwdXRzOiB7XG4gICAgUm9sZUFybk91dDoge1xuICAgICAgVmFsdWU6IHsgJ0ZuOjpHZXRBdHQnOiBbJ0dhdGV3YXlSb2xlJywgJ0FybiddIH0sXG4gICAgICAuLi4oY29uZGl0aW9uICE9PSB1bmRlZmluZWQgPyB7IENvbmRpdGlvbjogY29uZGl0aW9uIH0gOiB7fSksXG4gICAgICBFeHBvcnQ6IHsgTmFtZTogJ2dhdGV3YXktcm9sZS1hcm4nIH0sXG4gICAgfSxcbiAgfSxcbn0pXG5cbi8qKlxuICogQSBwdWJsaXNoZWQgZXhwb3J0IHdob3NlIGBFeHBvcnQuTmFtZWAgaXMgaXRzZWxmIGFuIGludHJpbnNpYyAoYEZuOjpTdWJgKSwgdGhlIGxlZ2FsIENGTiBmb3JtIGZvciBhXG4gKiBzdGFjay1uYW1lLXNjb3BlZCBleHBvcnQgbmFtZS4gU3VjaCBhbiBleHBvcnQgbXVzdCBzdGlsbCBiZSBjb21wYXJlZCAoaXRzIHByZXNlbmNlIEFORCBhIHJlLXRhcmdldCBvZlxuICogaXRzIHZhbHVlKSwgbm90IHNraXBwZWQgYmVjYXVzZSB0aGUgbmFtZSBpcyBub3QgYSBwbGFpbiBzdHJpbmcuXG4gKi9cbmNvbnN0IGludHJpbnNpY05hbWVkRXhwb3J0ID0gKHZhbHVlOiBzdHJpbmcpOiBUbXBsID0+ICh7XG4gIFJlc291cmNlczogeyBCdWNrZXQ6IHsgVHlwZTogJ0FXUzo6UzM6OkJ1Y2tldCcsIFByb3BlcnRpZXM6IHsgQnVja2V0TmFtZTogJ2InIH0gfSB9LFxuICBPdXRwdXRzOiB7XG4gICAgT3V0OiB7IFZhbHVlOiB2YWx1ZSwgRXhwb3J0OiB7IE5hbWU6IHsgJ0ZuOjpTdWInOiAnJHtBV1M6OlN0YWNrTmFtZX0tc2hhcmVkJyB9IH0gfSxcbiAgfSxcbn0pXG5cbi8qKlxuICogVHdvIGRpc3RpbmN0bHktc2hhcGVkIHJlc291cmNlcyBhbmQgYSBjb25zdW1lciB3aXJlZCB0byBvbmUgb2YgdGhlbSB0aHJvdWdoIGEgU1RSSU5HLWZvcm1cbiAqIGB7Rm46OkdldEF0dDogJ0xvZ2ljYWwuQXR0cid9YCAodGhlIHNob3J0IGZvcm0pLiBSZS1wb2ludGluZyB0aGUgc3RyaW5nLUdldEF0dCBmcm9tIG9uZSB0byB0aGUgb3RoZXIgaXNcbiAqIGEgcmUtdGFyZ2V0IHRoZSBnYXRlIG11c3QgY2F0Y2g7IHRoZSBuby1vdmVyLWJsb2NrIHNpZGUgaXMgYWxyZWFkeSBjb3ZlcmVkIGJ5IGBldmVyeVJlZmVyZW5jZUZvcm1gIFMyLlxuICovXG5jb25zdCBzdHJpbmdHZXRBdHRXaXJlZFRvID0gKHRhcmdldDogJ0J1Y2tldEEnIHwgJ0J1Y2tldEInKTogVG1wbCA9PiAoe1xuICBSZXNvdXJjZXM6IHtcbiAgICBCdWNrZXRBOiB7IFR5cGU6ICdBV1M6OlMzOjpCdWNrZXQnLCBQcm9wZXJ0aWVzOiB7IEJ1Y2tldE5hbWU6ICdsb2dzLWFscGhhJyB9IH0sXG4gICAgQnVja2V0QjogeyBUeXBlOiAnQVdTOjpTMzo6QnVja2V0JywgUHJvcGVydGllczogeyBCdWNrZXROYW1lOiAnbG9ncy1iZXRhJyB9IH0sXG4gICAgQ29uc3VtZXI6IHtcbiAgICAgIFR5cGU6ICdBV1M6OkxhbWJkYTo6RnVuY3Rpb24nLFxuICAgICAgUHJvcGVydGllczogeyBGdW5jdGlvbk5hbWU6ICdjb25zdW1lcicsIEVudmlyb25tZW50OiB7IFZhcmlhYmxlczogeyBCdWNrZXRBcm46IHsgJ0ZuOjpHZXRBdHQnOiBgJHt0YXJnZXR9LkFybmAgfSB9IH0gfSxcbiAgICB9LFxuICB9LFxufSlcblxuLyoqXG4gKiBUd28gZGlzdGluY3RseS1zaGFwZWQgcm9sZXMgYW5kIGEgcG9saWN5IHdob3NlIENESyBkZWZhdWx0LXBvbGljeSBgUG9saWN5TmFtZWAgZWNob2VzIG9uZSByb2xlJ3NcbiAqIGxvZ2ljYWwgaWQuIFJlLXBvaW50aW5nIG9ubHkgdGhlIGBQb2xpY3lOYW1lYCBlY2hvIGZyb20gb25lIHJvbGUgdG8gdGhlIG90aGVyIGlzIGEgcmUtdGFyZ2V0IHRoZSBnYXRlXG4gKiBtdXN0IGNhdGNoICh0aGUgZWNobyByZXNvbHZlcyB0byBpdHMgdGFyZ2V0J3Mgc2hhcGUgdG9rZW4pOyB0aGUgbm8tb3Zlci1ibG9jayBzaWRlIGlzIGNvdmVyZWQgYnkgUzIuXG4gKi9cbmNvbnN0IHBvbGljeU5hbWVFY2hvT2YgPSAocm9sZUlkOiAnUm9sZUEnIHwgJ1JvbGVCJyk6IFRtcGwgPT4gKHtcbiAgUmVzb3VyY2VzOiB7XG4gICAgUm9sZUE6IHtcbiAgICAgIFR5cGU6ICdBV1M6OklBTTo6Um9sZScsXG4gICAgICBQcm9wZXJ0aWVzOiB7IFJvbGVOYW1lOiAncm9sZS1hbHBoYScsIEFzc3VtZVJvbGVQb2xpY3lEb2N1bWVudDogeyBTdGF0ZW1lbnQ6IFt7IEVmZmVjdDogJ0FsbG93JywgUHJpbmNpcGFsOiB7IFNlcnZpY2U6ICdsYW1iZGEuYW1hem9uYXdzLmNvbScgfSwgQWN0aW9uOiAnc3RzOkFzc3VtZVJvbGUnIH1dIH0gfSxcbiAgICB9LFxuICAgIFJvbGVCOiB7XG4gICAgICBUeXBlOiAnQVdTOjpJQU06OlJvbGUnLFxuICAgICAgUHJvcGVydGllczogeyBSb2xlTmFtZTogJ3JvbGUtYmV0YScsIEFzc3VtZVJvbGVQb2xpY3lEb2N1bWVudDogeyBTdGF0ZW1lbnQ6IFt7IEVmZmVjdDogJ0FsbG93JywgUHJpbmNpcGFsOiB7IFNlcnZpY2U6ICdmaXJlaG9zZS5hbWF6b25hd3MuY29tJyB9LCBBY3Rpb246ICdzdHM6QXNzdW1lUm9sZScgfV0gfSB9LFxuICAgIH0sXG4gICAgRGVmYXVsdFBvbGljeToge1xuICAgICAgVHlwZTogJ0FXUzo6SUFNOjpQb2xpY3knLFxuICAgICAgUHJvcGVydGllczogeyBQb2xpY3lOYW1lOiByb2xlSWQsIFJvbGVzOiBbeyBSZWY6IHJvbGVJZCB9XSwgUG9saWN5RG9jdW1lbnQ6IHsgU3RhdGVtZW50OiBbeyBFZmZlY3Q6ICdBbGxvdycsIEFjdGlvbjogJ3MzOkdldE9iamVjdCcsIFJlc291cmNlOiAnKicgfV0gfSB9LFxuICAgIH0sXG4gIH0sXG59KVxuXG4vKipcbiAqIEEgcmVzb3VyY2UgZ3JhcGggZXhlcmNpc2luZyBFVkVSWSByZWZlcmVuY2UgZm9ybSB0aGUgdGVtcGxhdGUgY2FuIGV4cHJlc3MsIHNvIFMyIHByb3ZlcyBubyBmb3JtIGlzXG4gKiBsZWZ0IHVuLW5vcm1hbGlzZWQ6IGRpcmVjdCB7UmVmfSwgYXR0cmlidXRlIHtGbjo6R2V0QXR0fSBzaG9ydCAoc3RyaW5nKSBBTkQgbG9uZyAoYXJyYXkpIGZvcm0sXG4gKiB7Rm46OlN1Yn0tZW1iZWRkZWQgJHtMb2dpY2FsfSBBTkQgJHtMb2dpY2FsLkF0dHJ9LCBEZXBlbmRzT24sIGFuZCB0aGUgZGVmYXVsdC1wb2xpY3kgUG9saWN5TmFtZSBlY2hvLlxuICovXG5jb25zdCBldmVyeVJlZmVyZW5jZUZvcm0gPSAoKTogVG1wbCA9PiAoe1xuICBSZXNvdXJjZXM6IHtcbiAgICBUYXJnZXRSb2xlOiB7XG4gICAgICBUeXBlOiAnQVdTOjpJQU06OlJvbGUnLFxuICAgICAgUHJvcGVydGllczogeyBSb2xlTmFtZTogJ3RhcmdldC1yb2xlJywgQXNzdW1lUm9sZVBvbGljeURvY3VtZW50OiB7IFN0YXRlbWVudDogW3sgRWZmZWN0OiAnQWxsb3cnLCBQcmluY2lwYWw6IHsgU2VydmljZTogJ2xhbWJkYS5hbWF6b25hd3MuY29tJyB9LCBBY3Rpb246ICdzdHM6QXNzdW1lUm9sZScgfV0gfSB9LFxuICAgIH0sXG4gICAgVGFyZ2V0QnVja2V0OiB7IFR5cGU6ICdBV1M6OlMzOjpCdWNrZXQnLCBQcm9wZXJ0aWVzOiB7IEJ1Y2tldE5hbWU6ICd0YXJnZXQtYnVja2V0JyB9IH0sXG4gICAgQ29uc3VtZXI6IHtcbiAgICAgIFR5cGU6ICdBV1M6OkxhbWJkYTo6RnVuY3Rpb24nLFxuICAgICAgRGVwZW5kc09uOiAnVGFyZ2V0Um9sZScsXG4gICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgIEZ1bmN0aW9uTmFtZTogJ2NvbnN1bWVyJyxcbiAgICAgICAgUm9sZTogeyAnRm46OkdldEF0dCc6IFsnVGFyZ2V0Um9sZScsICdBcm4nXSB9LCAvLyBsb25nLWZvcm0gR2V0QXR0IChhcnJheSlcbiAgICAgICAgRW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICBWYXJpYWJsZXM6IHtcbiAgICAgICAgICAgIFJvbGVSZWY6IHsgUmVmOiAnVGFyZ2V0Um9sZScgfSwgLy8gZGlyZWN0IFJlZlxuICAgICAgICAgICAgQnVja2V0QXJuU2hvcnQ6IHsgJ0ZuOjpHZXRBdHQnOiAnVGFyZ2V0QnVja2V0LkFybicgfSwgLy8gc2hvcnQtZm9ybSBHZXRBdHQgKHN0cmluZylcbiAgICAgICAgICAgIEJ1Y2tldFVyaTogeyAnRm46OlN1Yic6ICdhcm46YXdzOnMzOjo6JHtUYXJnZXRCdWNrZXR9L2RhdGEnIH0sIC8vIEZuOjpTdWItZW1iZWRkZWQgaWQgKGJhcmUpXG4gICAgICAgICAgICBSb2xlQXJuU3ViOiB7ICdGbjo6U3ViJzogJ3JvbGUtaXMtJHtUYXJnZXRSb2xlLkFybn0nIH0sIC8vIEZuOjpTdWItZW1iZWRkZWQgYXR0cmlidXRlIHJlZiAke0lkLkF0dHJ9XG4gICAgICAgICAgICBMaXRlcmFsS2VwdDogeyAnRm46OlN1Yic6ICdrZXB0LSR7IUxpdGVyYWx9LWVzY2FwZScgfSwgLy8gJHshTGl0ZXJhbH0gZXNjYXBlIOKAlCBuZXZlciBhIHJlZiwgcmVuYW1lLWludmFyaWFudFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0sXG4gICAgQ29uc3VtZXJQb2xpY3k6IHtcbiAgICAgIFR5cGU6ICdBV1M6OklBTTo6UG9saWN5JyxcbiAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgUG9saWN5TmFtZTogJ1RhcmdldFJvbGUnLCAvLyBDREsgZGVmYXVsdC1wb2xpY3kgbmFtZSBlY2hvZXMgdGhlIHJvbGUgbG9naWNhbCBpZFxuICAgICAgICBSb2xlczogW3sgUmVmOiAnVGFyZ2V0Um9sZScgfV0sXG4gICAgICAgIFBvbGljeURvY3VtZW50OiB7IFN0YXRlbWVudDogW3sgRWZmZWN0OiAnQWxsb3cnLCBBY3Rpb246ICdzMzpHZXRPYmplY3QnLCBSZXNvdXJjZTogeyAnRm46OkdldEF0dCc6IFsnVGFyZ2V0QnVja2V0JywgJ0FybiddIH0gfV0gfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbn0pXG5cbi8qKlxuICogQSByZWZlcmVuY2UgY3ljbGU6IHR3byByZXNvdXJjZXMgZWFjaCByZWZlcmVuY2UgdGhlIG90aGVyIChBbHBoYeKGkkJldGEgdmlhIFJlZiwgQmV0YeKGkkFscGhhIHZpYVxuICogRGVwZW5kc09uKS4gVGhlIHNoYXBlLXRva2VuIHJlc29sdmVyIG11c3QgdGVybWluYXRlIG9uIHRoZSBjeWNsZSBhbmQgc3RpbGwgdGVsbCB0d28gZGlzdGluY3QgY3ljbGljXG4gKiBncmFwaHMgYXBhcnQg4oCUIHNvIGEgcmVuYW1lIG9mIHRoZSBjeWNsZSBpcyB0b2xlcmF0ZWQgd2hpbGUgYSByZS10YXJnZXQgaW50byB0aGUgY3ljbGUgaXMgY2F1Z2h0LlxuICovXG5jb25zdCBjeWNsaWNQYWlyID0gKGV4dHJhVGFyZ2V0OiAnQmV0YScgfCAnR2FtbWEnKTogVG1wbCA9PiAoe1xuICBSZXNvdXJjZXM6IHtcbiAgICBBbHBoYTogeyBUeXBlOiAnQVdTOjpJQU06OlJvbGUnLCBEZXBlbmRzT246ICdCZXRhJywgUHJvcGVydGllczogeyBSb2xlTmFtZTogJ2FscGhhJywgUGVlcjogeyBSZWY6IGV4dHJhVGFyZ2V0IH0gfSB9LFxuICAgIEJldGE6IHsgVHlwZTogJ0FXUzo6SUFNOjpQb2xpY3knLCBQcm9wZXJ0aWVzOiB7IFBvbGljeU5hbWU6ICdiZXRhJywgUm9sZXM6IFt7IFJlZjogJ0FscGhhJyB9XSB9IH0sXG4gICAgR2FtbWE6IHsgVHlwZTogJ0FXUzo6U1FTOjpRdWV1ZScsIFByb3BlcnRpZXM6IHsgUXVldWVOYW1lOiAnZ2FtbWEnIH0gfSxcbiAgfSxcbn0pXG5cbi8qKiBDb25zaXN0ZW50bHkgcmVuYW1lIGEgbG9naWNhbCBpZCBhbmQgZXZlcnkgcmVmZXJlbmNlIHRvIGl0IChrZXlzLCBSZWYsIEdldEF0dCwgU3ViLCBEZXBlbmRzT24sIFBvbGljeU5hbWUgZWNobykuICovXG5jb25zdCByZW5hbWVBbGwgPSAodGVtcGxhdGU6IFRtcGwsIG9sZElkOiBzdHJpbmcsIG5ld0lkOiBzdHJpbmcpOiBUbXBsID0+XG4gIEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkodGVtcGxhdGUpLnNwbGl0KG9sZElkKS5qb2luKG5ld0lkKSkgYXMgVG1wbFxuXG5kZXNjcmliZSgnMDEzLTEtMTcgc3RyYW5nbGVyIGRyaWZ0LWdhdGUg4oCUIHJldGFyZ2V0IGRldGVjdGlvbicsICgpID0+IHtcbiAgLy8gUzEg4oCUIGEgY29uc2lzdGVudCByZW5hbWUgd2l0aCBubyBvYnNlcnZhYmxlIGNoYW5nZSByZXBvcnRzIG5vIGRyaWZ0IChoYXBweSlcbiAgaXQoJ1MxOiBhIGNvbnNpc3RlbnQgcmVuYW1lIG9mIGEgcmVzb3VyY2UgbG9naWNhbCBpZCAoKyBldmVyeSByZWZlcmVuY2UgdG8gaXQpLCBubyByZWFsIGNoYW5nZSDihpIgbm8gZHJpZnQnLCAoKSA9PiB7XG4gICAgY29uc3QgYmFzZWxpbmUgPSBldmVyeVJlZmVyZW5jZUZvcm0oKVxuICAgIGNvbnN0IGNhbmRpZGF0ZSA9IHJlbmFtZUFsbChiYXNlbGluZSwgJ1RhcmdldFJvbGUnLCAnUmVuYW1lZFRhcmdldFJvbGUnKVxuICAgIC8vIHRoZSByYXcgdGVtcGxhdGVzIGRpZmZlciAodGhlIHJlbmFtZSB0b3VjaGVkIGtleXMsIFJlZiwgR2V0QXR0LCBTdWIsIERlcGVuZHNPbiwgUG9saWN5TmFtZSlcbiAgICBleHBlY3QoY2FuZGlkYXRlLlJlc291cmNlcykubm90LnRvRXF1YWwoYmFzZWxpbmUuUmVzb3VyY2VzKVxuICAgIGV4cGVjdChjZm5EaWZmZXJlbmNlcyhiYXNlbGluZSwgY2FuZGlkYXRlKSkudG9FcXVhbChbXSlcbiAgICBleHBlY3QoaXNDZm5FcXVpdmFsZW50KGJhc2VsaW5lLCBjYW5kaWRhdGUpKS50b0JlKHRydWUpXG4gIH0pXG5cbiAgLy8gUzIg4oCUIHRoZSByZW5hbWUgdG9sZXJhbmNlIGNvdmVycyBFVkVSWSBmb3JtIG9mIHJlZmVyZW5jZSAoZWRnZSAvIGJvdW5kYXJ5IOKAlCBubyBvdmVyLWJsb2NrKVxuICBkZXNjcmliZSgnUzI6IGEgY29uc2lzdGVudCByZW5hbWUgaXMgdG9sZXJhdGVkIHRocm91Z2ggZXZlcnkgcmVmZXJlbmNlIGZvcm0nLCAoKSA9PiB7XG4gICAgaXQuZWFjaChbXG4gICAgICBbJ3RoZSByZWZlcmVuY2VkIHJvbGUgKGRpcmVjdCBSZWYsIGxvbmctZm9ybSBHZXRBdHQsIERlcGVuZHNPbiwgUG9saWN5TmFtZSBlY2hvKScsICdUYXJnZXRSb2xlJywgJ1JlbmFtZWRSb2xlJ10sXG4gICAgICBbJ3RoZSByZWZlcmVuY2VkIGJ1Y2tldCAoc2hvcnQtZm9ybSBHZXRBdHQsIEZuOjpTdWItZW1iZWRkZWQgaWQpJywgJ1RhcmdldEJ1Y2tldCcsICdSZW5hbWVkQnVja2V0J10sXG4gICAgXSkoJ3JlbmFtaW5nICVzIOKGkiBzdGlsbCBubyBkcmlmdCcsIChfbGFiZWw6IHN0cmluZywgb2xkSWQ6IHN0cmluZywgbmV3SWQ6IHN0cmluZykgPT4ge1xuICAgICAgY29uc3QgYmFzZWxpbmUgPSBldmVyeVJlZmVyZW5jZUZvcm0oKVxuICAgICAgY29uc3QgY2FuZGlkYXRlID0gcmVuYW1lQWxsKGJhc2VsaW5lLCBvbGRJZCwgbmV3SWQpXG4gICAgICBleHBlY3QoY2FuZGlkYXRlLlJlc291cmNlcykubm90LnRvRXF1YWwoYmFzZWxpbmUuUmVzb3VyY2VzKVxuICAgICAgZXhwZWN0KGNmbkRpZmZlcmVuY2VzKGJhc2VsaW5lLCBjYW5kaWRhdGUpKS50b0VxdWFsKFtdKVxuICAgIH0pXG5cbiAgICBpdCgndGhlIHVtYnJlbGxhIHN5bnRoOiBhIHJlYWwgY29uc3RydWN0LWV4dHJhY3Rpb24gcmVuYW1lIG9mIHRoZSBnYXRld2F5IHJvbGUgaXMgdG9sZXJhdGVkJywgKCkgPT4ge1xuICAgICAgY29uc3QgYmVmb3JlID0gdG9Kc29uKGJ1aWxkR2F0ZXdheVJvbGVTdGFjayhuZXcgY2RrLkFwcCgpLCB7IGVudjogRU5WIH0pKVxuICAgICAgY29uc3QgcmVzb3VyY2VzID0gYmVmb3JlLlJlc291cmNlcyA/PyB7fVxuICAgICAgY29uc3Qgb2xkSWQgPSBPYmplY3Qua2V5cyhyZXNvdXJjZXMpLmZpbmQoKGlkKSA9PiAocmVzb3VyY2VzW2lkXSBhcyB7IFR5cGU6IHN0cmluZyB9KS5UeXBlID09PSAnQVdTOjpJQU06OlJvbGUnKSBhcyBzdHJpbmdcbiAgICAgIGNvbnN0IHJlbmFtZWQgPSByZW5hbWVBbGwoYmVmb3JlIGFzIFRtcGwsIG9sZElkLCBgUmVmYWN0b3JlZCR7b2xkSWR9YClcbiAgICAgIGV4cGVjdChyZW5hbWVkLlJlc291cmNlcykubm90LnRvRXF1YWwoYmVmb3JlLlJlc291cmNlcylcbiAgICAgIGV4cGVjdChjZm5EaWZmZXJlbmNlcyhiZWZvcmUsIHJlbmFtZWQpKS50b0VxdWFsKFtdKVxuICAgIH0pXG5cbiAgICBpdCgnYSBjb25zaXN0ZW50IHJlbmFtZSBhY3Jvc3MgYSByZWZlcmVuY2UgY3ljbGUgaXMgdG9sZXJhdGVkICh0aGUgcmVzb2x2ZXIgdGVybWluYXRlcyBvbiB0aGUgY3ljbGUpJywgKCkgPT4ge1xuICAgICAgY29uc3QgYmFzZWxpbmUgPSBjeWNsaWNQYWlyKCdCZXRhJylcbiAgICAgIGNvbnN0IGNhbmRpZGF0ZSA9IHJlbmFtZUFsbChiYXNlbGluZSwgJ0FscGhhJywgJ1JlbmFtZWRBbHBoYScpXG4gICAgICBleHBlY3QoY2FuZGlkYXRlLlJlc291cmNlcykubm90LnRvRXF1YWwoYmFzZWxpbmUuUmVzb3VyY2VzKVxuICAgICAgZXhwZWN0KGNmbkRpZmZlcmVuY2VzKGJhc2VsaW5lLCBjYW5kaWRhdGUpKS50b0VxdWFsKFtdKVxuICAgIH0pXG5cbiAgICBpdCgncmVuYW1pbmcgYSB0b3AtbGV2ZWwtRGVwZW5kc09uIHRhcmdldCDihpIgc3RpbGwgbm8gZHJpZnQgKHRoZSBkZXBlbmRlbmN5LWRlY2xhcmF0aW9uIHJlZmVyZW5jZSBmb3JtKScsICgpID0+IHtcbiAgICAgIGNvbnN0IGJhc2VsaW5lID0gZGVwZW5kc09uUm9sZSgnUm9sZUEnKVxuICAgICAgY29uc3QgY2FuZGlkYXRlID0gcmVuYW1lQWxsKGJhc2VsaW5lLCAnUm9sZUEnLCAnUmVuYW1lZFJvbGVBJylcbiAgICAgIGV4cGVjdChjYW5kaWRhdGUuUmVzb3VyY2VzKS5ub3QudG9FcXVhbChiYXNlbGluZS5SZXNvdXJjZXMpXG4gICAgICBleHBlY3QoY2ZuRGlmZmVyZW5jZXMoYmFzZWxpbmUsIGNhbmRpZGF0ZSkpLnRvRXF1YWwoW10pXG4gICAgfSlcblxuICAgIGl0KCdyZW5hbWluZyBhIHRhcmdldCByZWZlcmVuY2VkIGJ5IGFuIEZuOjpTdWIgYXR0cmlidXRlIGZvcm0gJHtJZC5Bcm59IOKGkiBzdGlsbCBubyBkcmlmdCAobm8gb3Zlci1ibG9jayknLCAoKSA9PiB7XG4gICAgICBjb25zdCBiYXNlbGluZSA9IGV2ZXJ5UmVmZXJlbmNlRm9ybSgpXG4gICAgICBjb25zdCBjYW5kaWRhdGUgPSByZW5hbWVBbGwoYmFzZWxpbmUsICdUYXJnZXRSb2xlJywgJ1JlbmFtZWRSb2xlJylcbiAgICAgIC8vIHRoZSByZW5hbWUgdG91Y2hlcyB0aGUgJHtUYXJnZXRSb2xlLkFybn0gU3ViIGJvZHk7IHRoZSAkeyFUYXJnZXRSb2xlfSBsaXRlcmFsIGVzY2FwZSBpcyBsZWZ0IGludGFjdFxuICAgICAgZXhwZWN0KGNhbmRpZGF0ZS5SZXNvdXJjZXMpLm5vdC50b0VxdWFsKGJhc2VsaW5lLlJlc291cmNlcylcbiAgICAgIGV4cGVjdChjZm5EaWZmZXJlbmNlcyhiYXNlbGluZSwgY2FuZGlkYXRlKSkudG9FcXVhbChbXSlcbiAgICB9KVxuXG4gICAgaXQoJ3JlbmFtaW5nIGEgbmVhci10d2luIHRhcmdldCAoKyBpdHMge1JlZn0gYW5kIHtGbjo6R2V0QXR0fSkgd2hvc2Ugb25seSBkaXN0aW5jdGlvbiBpcyBEZWxldGlvblBvbGljeSDihpIgc3RpbGwgbm8gZHJpZnQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBiYXNlbGluZSA9IHJlZlRvTmVhclR3aW4oJ0R1cmFibGVCdWNrZXQnKVxuICAgICAgY29uc3QgY2FuZGlkYXRlID0gcmVuYW1lQWxsKGJhc2VsaW5lLCAnRHVyYWJsZUJ1Y2tldCcsICdSZW5hbWVkRHVyYWJsZUJ1Y2tldCcpXG4gICAgICBleHBlY3QoY2FuZGlkYXRlLlJlc291cmNlcykubm90LnRvRXF1YWwoYmFzZWxpbmUuUmVzb3VyY2VzKVxuICAgICAgZXhwZWN0KGNmbkRpZmZlcmVuY2VzKGJhc2VsaW5lLCBjYW5kaWRhdGUpKS50b0VxdWFsKFtdKVxuICAgIH0pXG5cbiAgICBpdCgncmVuYW1pbmcgYW4gZXhwb3J0ZWQgcmVzb3VyY2UgdW5kZXIgYSBTVEFCTEUgT3V0cHV0IENvbmRpdGlvbiDihpIgc3RpbGwgbm8gZHJpZnQgKHRoZSBDb25kaXRpb24gaXMgdW5jaGFuZ2VkKScsICgpID0+IHtcbiAgICAgIGNvbnN0IGJhc2VsaW5lID0gZXhwb3J0V2l0aENvbmRpdGlvbignSXNQcm9kJylcbiAgICAgIGNvbnN0IGNhbmRpZGF0ZSA9IHJlbmFtZUFsbChiYXNlbGluZSwgJ0dhdGV3YXlSb2xlJywgJ1JlbmFtZWRHYXRld2F5Um9sZScpXG4gICAgICBleHBlY3QoY2FuZGlkYXRlLlJlc291cmNlcykubm90LnRvRXF1YWwoYmFzZWxpbmUuUmVzb3VyY2VzKVxuICAgICAgZXhwZWN0KGNmbkRpZmZlcmVuY2VzKGJhc2VsaW5lLCBjYW5kaWRhdGUpKS50b0VxdWFsKFtdKVxuICAgIH0pXG4gIH0pXG5cbiAgLy8gUzMg4oCUIGEgcmUtdGFyZ2V0IChieSByZWZlcmVuY2UgT1IgYnkgdmFsdWUsIGluY2wgYW4gSUFNIHRydXN0L3ByaW5jaXBhbC9yZXNvdXJjZSkgaXMgY2F1Z2h0XG4gIC8vICAgICAgIChGT1JDSU5HIOKAlCBBMS9BMiArIHdob2xlLXNoYXBlLCBISUdIIGZhaWwtb3BlbiBjbG9zdXJlOyBSRUQgb24gdGhlIHByZS1BMSBlbmdpbmUpXG4gIGRlc2NyaWJlKCdTMzogYSByZWZlcmVuY2UgcmUtcG9pbnRlZCBhdCBhIGRpZmZlcmVudCB0YXJnZXQgaXMgY2F1Z2h0IGFzIGRyaWZ0JywgKCkgPT4ge1xuICAgIGl0KCdhIHBvbGljeSByZS1hdHRhY2hlZCB0byBhIERJRkZFUkVOVCByb2xlIOKGkiBkcmlmdCcsICgpID0+IHtcbiAgICAgIGNvbnN0IGJhc2VsaW5lID0gcG9saWN5QXR0YWNoZWRUbygnUm9sZUEnKVxuICAgICAgY29uc3QgY2FuZGlkYXRlID0gcG9saWN5QXR0YWNoZWRUbygnUm9sZUInKVxuICAgICAgZXhwZWN0KGNmbkRpZmZlcmVuY2VzKGJhc2VsaW5lLCBjYW5kaWRhdGUpLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuKDApXG4gICAgICBleHBlY3QoaXNDZm5FcXVpdmFsZW50KGJhc2VsaW5lLCBjYW5kaWRhdGUpKS50b0JlKGZhbHNlKVxuICAgICAgZXhwZWN0KCgpID0+IGFzc2VydE5vU3RyYW5nbGVyRHJpZnQoYmFzZWxpbmUsIGNhbmRpZGF0ZSkpLnRvVGhyb3coL3N0cmFuZ2xlciBzdGVwIGJsb2NrZWQvKVxuICAgIH0pXG5cbiAgICBpdCgnYW4gZXhwb3J0L3N0cmVhbSByZS13aXJlZCAodmlhIEZuOjpHZXRBdHQpIHRvIGEgRElGRkVSRU5UIGJ1Y2tldCDihpIgZHJpZnQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBiYXNlbGluZSA9IHN0cmVhbVdpcmVkVG8oJ0J1Y2tldEEnKVxuICAgICAgY29uc3QgY2FuZGlkYXRlID0gc3RyZWFtV2lyZWRUbygnQnVja2V0QicpXG4gICAgICBleHBlY3QoY2ZuRGlmZmVyZW5jZXMoYmFzZWxpbmUsIGNhbmRpZGF0ZSkubGVuZ3RoKS50b0JlR3JlYXRlclRoYW4oMClcbiAgICAgIGV4cGVjdCgoKSA9PiBhc3NlcnROb1N0cmFuZ2xlckRyaWZ0KGJhc2VsaW5lLCBjYW5kaWRhdGUpKS50b1Rocm93KC9zdHJhbmdsZXIgc3RlcCBibG9ja2VkLylcbiAgICB9KVxuXG4gICAgaXQoJ2Egcm9sZSB0cnVzdCByZS1haW1lZCBhdCBhIGRpZmZlcmVudCBwcmluY2lwYWwgYWNjb3VudCBuYW1lZCBCWSBWQUxVRSDihpIgZHJpZnQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBiYXNlbGluZSA9IHJvbGVUcnVzdGluZ0FjY291bnQoJzExMTExMTExMTExMScpXG4gICAgICBjb25zdCBjYW5kaWRhdGUgPSByb2xlVHJ1c3RpbmdBY2NvdW50KCcyMjIyMjIyMjIyMjInKVxuICAgICAgZXhwZWN0KGNmbkRpZmZlcmVuY2VzKGJhc2VsaW5lLCBjYW5kaWRhdGUpLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuKDApXG4gICAgICBleHBlY3QoKCkgPT4gYXNzZXJ0Tm9TdHJhbmdsZXJEcmlmdChiYXNlbGluZSwgY2FuZGlkYXRlKSkudG9UaHJvdygvc3RyYW5nbGVyIHN0ZXAgYmxvY2tlZC8pXG4gICAgfSlcblxuICAgIGl0KCdhIHBvbGljeSBzdGF0ZW1lbnQgcmVzb3VyY2UgcmUtYWltZWQgKHZpYSBGbjo6R2V0QXR0KSBhdCBhIGRpZmZlcmVudCByZXNvdXJjZSDihpIgZHJpZnQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBiYXNlbGluZSA9IGV2ZXJ5UmVmZXJlbmNlRm9ybSgpXG4gICAgICBjb25zdCBjYW5kaWRhdGUgPSBjbG9uZShiYXNlbGluZSlcbiAgICAgIC8vIHJlLWFpbSB0aGUgc3RhdGVtZW50IFJlc291cmNlIGZyb20gVGFyZ2V0QnVja2V0IHRvIFRhcmdldFJvbGUgKGEgZGlmZmVyZW50IGV4aXN0aW5nIHJlc291cmNlKVxuICAgICAgY29uc3QgcG9saWN5ID0gKGNhbmRpZGF0ZS5SZXNvdXJjZXMgYXMgUmVjb3JkPHN0cmluZywgeyBQcm9wZXJ0aWVzOiB7IFBvbGljeURvY3VtZW50OiB7IFN0YXRlbWVudDogeyBSZXNvdXJjZTogdW5rbm93biB9W10gfSB9IH0+KS5Db25zdW1lclBvbGljeVxuICAgICAgcG9saWN5LlByb3BlcnRpZXMuUG9saWN5RG9jdW1lbnQuU3RhdGVtZW50WzBdLlJlc291cmNlID0geyAnRm46OkdldEF0dCc6IFsnVGFyZ2V0Um9sZScsICdBcm4nXSB9XG4gICAgICBleHBlY3QoY2ZuRGlmZmVyZW5jZXMoYmFzZWxpbmUsIGNhbmRpZGF0ZSkubGVuZ3RoKS50b0JlR3JlYXRlclRoYW4oMClcbiAgICB9KVxuXG4gICAgaXQoJ2EgcmUtdGFyZ2V0IHRocm91Z2ggRm46OlN1YiAoZW1iZWRkZWQgaWQgcmUtcG9pbnRlZCBhdCBhIGRpZmZlcmVudCByZXNvdXJjZSkg4oaSIGRyaWZ0JywgKCkgPT4ge1xuICAgICAgY29uc3QgYmFzZWxpbmUgPSBldmVyeVJlZmVyZW5jZUZvcm0oKVxuICAgICAgY29uc3QgY2FuZGlkYXRlID0gY2xvbmUoYmFzZWxpbmUpXG4gICAgICBjb25zdCBjb25zdW1lciA9IChjYW5kaWRhdGUuUmVzb3VyY2VzIGFzIFJlY29yZDxzdHJpbmcsIHsgUHJvcGVydGllczogeyBFbnZpcm9ubWVudDogeyBWYXJpYWJsZXM6IHsgQnVja2V0VXJpOiB1bmtub3duIH0gfSB9IH0+KS5Db25zdW1lclxuICAgICAgLy8gdGhlIFN1Yi1lbWJlZGRlZCAke1RhcmdldEJ1Y2tldH0gcmUtcG9pbnRlZCBhdCAke1RhcmdldFJvbGV9IChhIGRpZmZlcmVudGx5LXNoYXBlZCByZXNvdXJjZSlcbiAgICAgIGNvbnN1bWVyLlByb3BlcnRpZXMuRW52aXJvbm1lbnQuVmFyaWFibGVzLkJ1Y2tldFVyaSA9IHsgJ0ZuOjpTdWInOiAnYXJuOmF3czpzMzo6OiR7VGFyZ2V0Um9sZX0vZGF0YScgfVxuICAgICAgZXhwZWN0KGNmbkRpZmZlcmVuY2VzKGJhc2VsaW5lLCBjYW5kaWRhdGUpLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuKDApXG4gICAgfSlcblxuICAgIGl0KCdhIHJlLXRhcmdldCB0aHJvdWdoIE9OTFkgYW4gRm46OlN1YiBib2R5ICh0aGUgb25seSBkaWZmZXJlbmNlIGlzIHdoaWNoIGJ1Y2tldCB0aGUgJHtCdWNrZXQuQXJufSBwb2ludHMgYXQpIOKGkiBkcmlmdCcsICgpID0+IHtcbiAgICAgIC8vIEJvdGggYnVja2V0cyBleGlzdCBpbiBib3RoIHRlbXBsYXRlcywgc28gdGhlIG11bHRpc2V0IGlzIGlkZW50aWNhbCBhbmQgdGhlIHNvbGUgZGlmZmVyZW5jZSBpc1xuICAgICAgLy8gdGhlIGNvbnN1bWVyJ3MgU3ViLWVtYmVkZGVkIHRhcmdldC4gVGhlIG5ldyBTdWItYXR0cmlidXRlIG5vcm1hbGlzYXRpb24gcmVzb2x2ZXMgJHtCdWNrZXQuQXJufVxuICAgICAgLy8gdG8gaXRzIHRhcmdldCdzIGRpc3RpbmN0IHNoYXBlIHRva2VuLCBzbyB0aGUgcmUtdGFyZ2V0IGlzIHJlcG9ydGVkIGFzIGEgcHJvcGVydHkgY2hhbmdlLlxuICAgICAgY29uc3QgYmFzZWxpbmUgPSBzdWJBdHRyV2lyZWRUbygnQnVja2V0QWxwaGEnKVxuICAgICAgY29uc3QgY2FuZGlkYXRlID0gc3ViQXR0cldpcmVkVG8oJ0J1Y2tldEJldGEnKVxuICAgICAgZXhwZWN0KGNmbkRpZmZlcmVuY2VzKGJhc2VsaW5lLCBjYW5kaWRhdGUpLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuKDApXG4gICAgICBleHBlY3QoKCkgPT4gYXNzZXJ0Tm9TdHJhbmdsZXJEcmlmdChiYXNlbGluZSwgY2FuZGlkYXRlKSkudG9UaHJvdygvc3RyYW5nbGVyIHN0ZXAgYmxvY2tlZC8pXG4gICAgfSlcblxuICAgIGl0KCdhIHRvcC1sZXZlbCBEZXBlbmRzT24gcmUtYWltZWQgYXQgYSBESUZGRVJFTlQgcm9sZSDihpIgZHJpZnQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBiYXNlbGluZSA9IGRlcGVuZHNPblJvbGUoJ1JvbGVBJylcbiAgICAgIGNvbnN0IGNhbmRpZGF0ZSA9IGRlcGVuZHNPblJvbGUoJ1JvbGVCJylcbiAgICAgIGV4cGVjdChjZm5EaWZmZXJlbmNlcyhiYXNlbGluZSwgY2FuZGlkYXRlKS5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbigwKVxuICAgICAgZXhwZWN0KCgpID0+IGFzc2VydE5vU3RyYW5nbGVyRHJpZnQoYmFzZWxpbmUsIGNhbmRpZGF0ZSkpLnRvVGhyb3coL3N0cmFuZ2xlciBzdGVwIGJsb2NrZWQvKVxuICAgIH0pXG5cbiAgICBpdCgnYSByZS10YXJnZXQgSU5UTyBhIHJlZmVyZW5jZSBjeWNsZSAoYSBjeWNsaWMgbWVtYmVyIHJlLXBvaW50ZWQgYXQgYSBkaWZmZXJlbnQgcmVzb3VyY2UpIOKGkiBkcmlmdCcsICgpID0+IHtcbiAgICAgIGNvbnN0IGJhc2VsaW5lID0gY3ljbGljUGFpcignQmV0YScpXG4gICAgICBjb25zdCBjYW5kaWRhdGUgPSBjeWNsaWNQYWlyKCdHYW1tYScpIC8vIEFscGhhLlBlZXIgcmUtcG9pbnRlZCBmcm9tIEJldGEgKFBvbGljeSkgdG8gR2FtbWEgKFF1ZXVlKVxuICAgICAgZXhwZWN0KGNmbkRpZmZlcmVuY2VzKGJhc2VsaW5lLCBjYW5kaWRhdGUpLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuKDApXG4gICAgfSlcblxuICAgIGl0KCdhIHtSZWZ9ICsge0ZuOjpHZXRBdHR9IHJlLXBvaW50ZWQgdG8gYSBuZWFyLXR3aW4gZGlmZmVyaW5nIE9OTFkgaW4gRGVsZXRpb25Qb2xpY3kg4oaSIGRyaWZ0ICh0aGUgcmVmZXJlbnQgdG9rZW4gY2FycmllcyB0b3AtbGV2ZWwgYXR0cnMpJywgKCkgPT4ge1xuICAgICAgY29uc3QgYmFzZWxpbmUgPSByZWZUb05lYXJUd2luKCdEdXJhYmxlQnVja2V0JylcbiAgICAgIGNvbnN0IGNhbmRpZGF0ZSA9IHJlZlRvTmVhclR3aW4oJ0Rpc3Bvc2FibGVCdWNrZXQnKVxuICAgICAgZXhwZWN0KGNmbkRpZmZlcmVuY2VzKGJhc2VsaW5lLCBjYW5kaWRhdGUpLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuKDApXG4gICAgICBleHBlY3QoaXNDZm5FcXVpdmFsZW50KGJhc2VsaW5lLCBjYW5kaWRhdGUpKS50b0JlKGZhbHNlKVxuICAgICAgZXhwZWN0KCgpID0+IGFzc2VydE5vU3RyYW5nbGVyRHJpZnQoYmFzZWxpbmUsIGNhbmRpZGF0ZSkpLnRvVGhyb3coL3N0cmFuZ2xlciBzdGVwIGJsb2NrZWQvKVxuICAgIH0pXG5cbiAgICBpdCgnYSBzdHJpbmctZm9ybSB7Rm46OkdldEF0dDpcIkJ1Y2tldC5Bcm5cIn0gcmUtcG9pbnRlZCBhdCBhIGRpZmZlcmVudCBidWNrZXQg4oaSIGRyaWZ0JywgKCkgPT4ge1xuICAgICAgY29uc3QgYmFzZWxpbmUgPSBzdHJpbmdHZXRBdHRXaXJlZFRvKCdCdWNrZXRBJylcbiAgICAgIGNvbnN0IGNhbmRpZGF0ZSA9IHN0cmluZ0dldEF0dFdpcmVkVG8oJ0J1Y2tldEInKVxuICAgICAgZXhwZWN0KGNmbkRpZmZlcmVuY2VzKGJhc2VsaW5lLCBjYW5kaWRhdGUpLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuKDApXG4gICAgICBleHBlY3QoKCkgPT4gYXNzZXJ0Tm9TdHJhbmdsZXJEcmlmdChiYXNlbGluZSwgY2FuZGlkYXRlKSkudG9UaHJvdygvc3RyYW5nbGVyIHN0ZXAgYmxvY2tlZC8pXG4gICAgfSlcblxuICAgIGl0KCdhIFBvbGljeU5hbWUgZWNobyByZS1wb2ludGVkIGZyb20gb25lIHJvbGUgdG8gYSBkaWZmZXJlbnQgcm9sZSDihpIgZHJpZnQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBiYXNlbGluZSA9IHBvbGljeU5hbWVFY2hvT2YoJ1JvbGVBJylcbiAgICAgIGNvbnN0IGNhbmRpZGF0ZSA9IHBvbGljeU5hbWVFY2hvT2YoJ1JvbGVCJylcbiAgICAgIGV4cGVjdChjZm5EaWZmZXJlbmNlcyhiYXNlbGluZSwgY2FuZGlkYXRlKS5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbigwKVxuICAgICAgZXhwZWN0KCgpID0+IGFzc2VydE5vU3RyYW5nbGVyRHJpZnQoYmFzZWxpbmUsIGNhbmRpZGF0ZSkpLnRvVGhyb3coL3N0cmFuZ2xlciBzdGVwIGJsb2NrZWQvKVxuICAgIH0pXG5cbiAgICBpdCgnYSBwdWJsaXNoZWQgZXhwb3J0IHRoYXQgR0FJTlMgYW4gT3V0cHV0IENvbmRpdGlvbiAoc2FtZSBuYW1lICsgc2FtZSB2YWx1ZSkg4oaSIGRyaWZ0ICh0aGUgZXhwb3J0IGNhbiB2YW5pc2ggd2hlcmUgdGhlIGNvbmRpdGlvbiBpcyBmYWxzZSknLCAoKSA9PiB7XG4gICAgICBjb25zdCBiYXNlbGluZSA9IGV4cG9ydFdpdGhDb25kaXRpb24odW5kZWZpbmVkKVxuICAgICAgY29uc3QgY2FuZGlkYXRlID0gZXhwb3J0V2l0aENvbmRpdGlvbignSXNQcm9kJylcbiAgICAgIGV4cGVjdChjZm5EaWZmZXJlbmNlcyhiYXNlbGluZSwgY2FuZGlkYXRlKSkudG9Db250YWluRXF1YWwoeyBraW5kOiAnZXhwb3J0LWNoYW5nZWQnLCBkZXRhaWw6ICdnYXRld2F5LXJvbGUtYXJuJyB9KVxuICAgICAgZXhwZWN0KCgpID0+IGFzc2VydE5vU3RyYW5nbGVyRHJpZnQoYmFzZWxpbmUsIGNhbmRpZGF0ZSkpLnRvVGhyb3coL3N0cmFuZ2xlciBzdGVwIGJsb2NrZWQvKVxuICAgIH0pXG5cbiAgICBpdCgnYSBwdWJsaXNoZWQgZXhwb3J0IHdob3NlIE91dHB1dCBDb25kaXRpb24gQ0hBTkdFUyAoc2FtZSBuYW1lICsgc2FtZSB2YWx1ZSkg4oaSIGRyaWZ0JywgKCkgPT4ge1xuICAgICAgY29uc3QgYmFzZWxpbmUgPSBleHBvcnRXaXRoQ29uZGl0aW9uKCdJc1Byb2QnKVxuICAgICAgY29uc3QgY2FuZGlkYXRlID0gZXhwb3J0V2l0aENvbmRpdGlvbignSXNTdGFnaW5nJylcbiAgICAgIGV4cGVjdChjZm5EaWZmZXJlbmNlcyhiYXNlbGluZSwgY2FuZGlkYXRlKSkudG9Db250YWluRXF1YWwoeyBraW5kOiAnZXhwb3J0LWNoYW5nZWQnLCBkZXRhaWw6ICdnYXRld2F5LXJvbGUtYXJuJyB9KVxuICAgIH0pXG5cbiAgICBpdCgnYW4gaW50cmluc2ljLW5hbWVkIGV4cG9ydCAoRm46OlN1YiBFeHBvcnQuTmFtZSkgd2hvc2UgdmFsdWUgaXMgcmUtdGFyZ2V0ZWQg4oaSIGRyaWZ0ICh0aGUgZXhwb3J0IGlzIGNvbXBhcmVkLCBub3Qgc2tpcHBlZCknLCAoKSA9PiB7XG4gICAgICBjb25zdCBiYXNlbGluZSA9IGludHJpbnNpY05hbWVkRXhwb3J0KCd2MScpXG4gICAgICBjb25zdCBjYW5kaWRhdGUgPSBpbnRyaW5zaWNOYW1lZEV4cG9ydCgndjInKVxuICAgICAgZXhwZWN0KGNmbkRpZmZlcmVuY2VzKGJhc2VsaW5lLCBjYW5kaWRhdGUpLnNvbWUoKGQpID0+IGQua2luZCA9PT0gJ2V4cG9ydC1jaGFuZ2VkJykpLnRvQmUodHJ1ZSlcbiAgICAgIGV4cGVjdCgoKSA9PiBhc3NlcnROb1N0cmFuZ2xlckRyaWZ0KGJhc2VsaW5lLCBjYW5kaWRhdGUpKS50b1Rocm93KC9zdHJhbmdsZXIgc3RlcCBibG9ja2VkLylcbiAgICB9KVxuICB9KVxuXG4gIC8vIFM1IOKAlCB0aGUgZ2F0ZSBzdGF5cyB1bndpcmVkIGZyb20gYW55IGxpdmUgYmFzZWxpbmUgdW50aWwgdGhlIGNsb3N1cmUgbGFuZHMgKGd1YXJkcmFpbClcbiAgLy8gQXNzZXJ0ZWQgYXMgYSBzdGF0aWMtc291cmNlIGludmFyaWFudDogYXNzZXJ0Tm9TdHJhbmdsZXJEcmlmdCAvIGlzQ2ZuRXF1aXZhbGVudCAvIGNmbkRpZmZlcmVuY2VzXG4gIC8vIGFyZSByZWFjaGFibGUgb25seSBmcm9tIHRlc3Qgc3BlY3MgYW5kIHRoZSBsaWIgYmFycmVsIOKAlCBuZXZlciBhIGRlcGxveSBzdGVwLCBDSSB3b3JrZmxvdywgb3IgdGhlXG4gIC8vIHBhcml0eSBoYXJuZXNzIOKAlCBzbyB0aGUgZmFpbC1vcGVuIGNhbm5vdCBzaGlwIGFnYWluc3QgYSByZWFsIGJlZm9yZS9hZnRlciBwYWlyLlxuICBpdCgnUzU6IHRoZSBzdHJhbmdsZXIgQVBJIGlzIG5vdCB3aXJlZCB0byBhbnkgcmVhbCBiYXNlbGluZSAoZGVwbG95IC8gQ0kgLyBwYXJpdHkgaGFybmVzcyknLCAoKSA9PiB7XG4gICAgY29uc3QgZnMgPSByZXF1aXJlKCdmcycpIGFzIHR5cGVvZiBpbXBvcnQoJ2ZzJylcbiAgICBjb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpIGFzIHR5cGVvZiBpbXBvcnQoJ3BhdGgnKVxuICAgIGNvbnN0IHJlcG9Sb290ID0gcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uJylcbiAgICBjb25zdCBBUEkgPSBbJ2Fzc2VydE5vU3RyYW5nbGVyRHJpZnQnLCAnaXNDZm5FcXVpdmFsZW50JywgJ2NmbkRpZmZlcmVuY2VzJ11cbiAgICBjb25zdCBjYWxsZXJzOiBzdHJpbmdbXSA9IFtdXG4gICAgY29uc3Qgd2FsayA9IChkaXI6IHN0cmluZyk6IHZvaWQgPT4ge1xuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBmcy5yZWFkZGlyU3luYyhkaXIsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KSkge1xuICAgICAgICBpZiAoZW50cnkubmFtZSA9PT0gJ25vZGVfbW9kdWxlcycgfHwgZW50cnkubmFtZSA9PT0gJy5naXQnIHx8IGVudHJ5Lm5hbWUgPT09ICdjZGsub3V0JykgY29udGludWVcbiAgICAgICAgY29uc3QgZnVsbCA9IHBhdGguam9pbihkaXIsIGVudHJ5Lm5hbWUpXG4gICAgICAgIGlmIChlbnRyeS5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgICAgd2FsayhmdWxsKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cbiAgICAgICAgaWYgKCEvXFwuKHRzfGpzfHNofHlhP21sKSQvLnRlc3QoZW50cnkubmFtZSkpIGNvbnRpbnVlXG4gICAgICAgIC8vIHRoZSBlbmdpbmUncyBvd24gZGVmaW5pdGlvbnMgYW5kIGl0cyBiYXJyZWwgcmUtZXhwb3J0IGFyZSBub3QgXCJ3aXJpbmcgdG8gYSBiYXNlbGluZVwiXG4gICAgICAgIGlmIChmdWxsLmVuZHNXaXRoKHBhdGguam9pbignbGliJywgJ3VtYnJlbGxhJywgJ2Nmbi1lcXVpdmFsZW5jZS50cycpKSkgY29udGludWVcbiAgICAgICAgaWYgKGZ1bGwuZW5kc1dpdGgocGF0aC5qb2luKCdsaWInLCAndW1icmVsbGEnLCAnaW5kZXgudHMnKSkpIGNvbnRpbnVlXG4gICAgICAgIGNvbnN0IHRleHQgPSBmcy5yZWFkRmlsZVN5bmMoZnVsbCwgJ3V0ZjgnKVxuICAgICAgICBpZiAoQVBJLnNvbWUoKHN5bSkgPT4gdGV4dC5pbmNsdWRlcyhzeW0pKSkgY2FsbGVycy5wdXNoKHBhdGgucmVsYXRpdmUocmVwb1Jvb3QsIGZ1bGwpKVxuICAgICAgfVxuICAgIH1cbiAgICB3YWxrKHJlcG9Sb290KVxuICAgIC8vIGV2ZXJ5IGNhbGxlciBtdXN0IGJlIGEgdGVzdCBzcGVjIOKAlCBubyBkZXBsb3ktKi5zaCwgbm8gLmdpdGh1YiB3b3JrZmxvdywgbm8gcGFyaXR5LWdhdGUgaGFybmVzc1xuICAgIGNvbnN0IG5vblRlc3RDYWxsZXJzID0gY2FsbGVycy5maWx0ZXIoKGYpID0+ICEvXFwuc3BlY1xcLnRzJC8udGVzdChmKSlcbiAgICBleHBlY3Qobm9uVGVzdENhbGxlcnMpLnRvRXF1YWwoW10pXG4gIH0pXG5cbiAgLy8gUzYg4oCUIHRoZSBleGlzdGluZyBkcmlmdCB2ZXJkaWN0cyBhcmUgdW5jaGFuZ2VkIChyZWdyZXNzaW9uKVxuICBkZXNjcmliZSgnUzY6IHRoZSBleGlzdGluZyBkcmlmdCB2ZXJkaWN0cyBhcmUgdW5jaGFuZ2VkJywgKCkgPT4ge1xuICAgIGl0KCdhIHJlc291cmNlIGFkZGVkIOKGkiBzdGlsbCBkcmlmdCcsICgpID0+IHtcbiAgICAgIGNvbnN0IGJhc2VsaW5lID0gcG9saWN5QXR0YWNoZWRUbygnUm9sZUEnKVxuICAgICAgY29uc3QgY2FuZGlkYXRlID0gY2xvbmUoYmFzZWxpbmUpXG4gICAgICA7KGNhbmRpZGF0ZS5SZXNvdXJjZXMgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pWydFeHRyYSddID0geyBUeXBlOiAnQVdTOjpTUVM6OlF1ZXVlJywgUHJvcGVydGllczogeyBRdWV1ZU5hbWU6ICdleHRyYScgfSB9XG4gICAgICBleHBlY3QoY2ZuRGlmZmVyZW5jZXMoYmFzZWxpbmUsIGNhbmRpZGF0ZSkpLnRvQ29udGFpbkVxdWFsKHsga2luZDogJ3Jlc291cmNlLWFkZGVkJywgZGV0YWlsOiAnQVdTOjpTUVM6OlF1ZXVlICjDlzEpJyB9KVxuICAgICAgZXhwZWN0KCgpID0+IGFzc2VydE5vU3RyYW5nbGVyRHJpZnQoYmFzZWxpbmUsIGNhbmRpZGF0ZSkpLnRvVGhyb3coL3N0cmFuZ2xlciBzdGVwIGJsb2NrZWQvKVxuICAgIH0pXG5cbiAgICBpdCgnYSByZXNvdXJjZSByZW1vdmVkIOKGkiBzdGlsbCBkcmlmdCcsICgpID0+IHtcbiAgICAgIGNvbnN0IGJhc2VsaW5lID0gcG9saWN5QXR0YWNoZWRUbygnUm9sZUEnKVxuICAgICAgY29uc3QgY2FuZGlkYXRlID0gY2xvbmUoYmFzZWxpbmUpXG4gICAgICBkZWxldGUgKGNhbmRpZGF0ZS5SZXNvdXJjZXMgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pWydSb2xlQiddXG4gICAgICBleHBlY3QoY2ZuRGlmZmVyZW5jZXMoYmFzZWxpbmUsIGNhbmRpZGF0ZSkuc29tZSgoZCkgPT4gZC5raW5kID09PSAncmVzb3VyY2UtcmVtb3ZlZCcpKS50b0JlKHRydWUpXG4gICAgfSlcblxuICAgIGl0KCdhIHB1Ymxpc2hlZCBleHBvcnQgcmVuYW1lZCAvIGRyb3BwZWQgLyByZS12YWx1ZWQg4oaSIHN0aWxsIGRyaWZ0JywgKCkgPT4ge1xuICAgICAgY29uc3QgYmFzZWxpbmU6IFRtcGwgPSB7IFJlc291cmNlczogeyBCOiB7IFR5cGU6ICdBV1M6OlMzOjpCdWNrZXQnLCBQcm9wZXJ0aWVzOiB7IEJ1Y2tldE5hbWU6ICdiJyB9IH0gfSwgT3V0cHV0czogeyBPdXQ6IHsgVmFsdWU6ICd2JywgRXhwb3J0OiB7IE5hbWU6ICdzaGFyZWQnIH0gfSB9IH1cbiAgICAgIGNvbnN0IHJlVmFsdWVkID0gY2xvbmUoYmFzZWxpbmUpXG4gICAgICA7KHJlVmFsdWVkLk91dHB1dHMgYXMgUmVjb3JkPHN0cmluZywgeyBWYWx1ZTogdW5rbm93biB9PilbJ091dCddLlZhbHVlID0gJ2NoYW5nZWQnXG4gICAgICBleHBlY3QoY2ZuRGlmZmVyZW5jZXMoYmFzZWxpbmUsIHJlVmFsdWVkKSkudG9Db250YWluRXF1YWwoeyBraW5kOiAnZXhwb3J0LWNoYW5nZWQnLCBkZXRhaWw6ICdzaGFyZWQnIH0pXG4gICAgICBjb25zdCBkcm9wcGVkID0gY2xvbmUoYmFzZWxpbmUpXG4gICAgICBkZWxldGUgKGRyb3BwZWQuT3V0cHV0cyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilbJ091dCddXG4gICAgICBleHBlY3QoY2ZuRGlmZmVyZW5jZXMoYmFzZWxpbmUsIGRyb3BwZWQpKS50b0NvbnRhaW5FcXVhbCh7IGtpbmQ6ICdleHBvcnQtcmVtb3ZlZCcsIGRldGFpbDogJ3NoYXJlZCcgfSlcbiAgICB9KVxuXG4gICAgaXQoJ2Egc2NhbGFyIHByb3BlcnR5IGNoYW5nZWQgKGEgbG9hZC1iZWFyaW5nIGxpdGVyYWwgaW5zaWRlIGEgdHJ1c3QgZG9jdW1lbnQsIGUuZy4gYSB0cnVzdGVkIGFjY291bnQpIOKGkiBzdGlsbCBkcmlmdCcsICgpID0+IHtcbiAgICAgIGNvbnN0IGJhc2VsaW5lID0gcm9sZVRydXN0aW5nQWNjb3VudCgnMTExMTExMTExMTExJylcbiAgICAgIGNvbnN0IGNoYW5nZWQgPSByb2xlVHJ1c3RpbmdBY2NvdW50KCc5OTk5OTk5OTk5OTknKVxuICAgICAgZXhwZWN0KGNmbkRpZmZlcmVuY2VzKGJhc2VsaW5lLCBjaGFuZ2VkKS5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbigwKVxuICAgIH0pXG5cbiAgICBpdCgnYSBzdGF0ZWZ1bCByZXNvdXJjZSBEZWxldGlvblBvbGljeSAvIFVwZGF0ZVJlcGxhY2VQb2xpY3kgZmxpcHBlZCBSZXRhaW4g4oaSIERlbGV0ZSDihpIgZHJpZnQgKGRhdGEtZHVyYWJpbGl0eSknLCAoKSA9PiB7XG4gICAgICBjb25zdCBiYXNlbGluZSA9IGJ1Y2tldFdpdGhEZWxldGlvblBvbGljeSgnUmV0YWluJylcbiAgICAgIGNvbnN0IGNhbmRpZGF0ZSA9IGJ1Y2tldFdpdGhEZWxldGlvblBvbGljeSgnRGVsZXRlJylcbiAgICAgIGV4cGVjdChjZm5EaWZmZXJlbmNlcyhiYXNlbGluZSwgY2FuZGlkYXRlKS5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbigwKVxuICAgICAgZXhwZWN0KCgpID0+IGFzc2VydE5vU3RyYW5nbGVyRHJpZnQoYmFzZWxpbmUsIGNhbmRpZGF0ZSkpLnRvVGhyb3coL3N0cmFuZ2xlciBzdGVwIGJsb2NrZWQvKVxuICAgIH0pXG4gIH0pXG59KVxuIl19