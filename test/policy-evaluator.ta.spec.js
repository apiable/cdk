"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * TA — additional coverage for the firehose-destination guardrail oracle (test/support/policy-evaluator.ts).
 *
 * The evaluator is the trust anchor of the 013-1-24 acceptance specs: if it false-allows or false-denies,
 * every Sx scenario silently lies. These cases exercise the evaluator's decision edges directly — the
 * principal-unscoped Deny with its operator carve-out (which must catch a renamed hand-rolled role yet
 * NOT over-deny an exempt operator principal), the write-equivalent action coverage, the bucket-policy
 * conditions, default-deny, glob behaviour, and fail-closed on an unmodelled condition operator — beyond
 * the six contract scenarios' channel-level assertions.
 */
const policy_evaluator_1 = require("./support/policy-evaluator");
const FIREHOSE_ROLE = 'arn:aws:iam::111111111111:role/apiable-usagelogs-firehose';
// A logging-account service-linked role the operator legitimately exempts (the closed carve-out).
const OPERATOR_WRITER = 'arn:aws:iam::111111111111:role/aws-service-role/backup.amazonaws.com/AWSServiceRoleForBackup';
// A hand-rolled in-Org delivery role named OUTSIDE the apiable-*-firehose convention — the F1 escape.
const RENAMED_HANDROLLED_ROLE = 'arn:aws:iam::111111111111:role/usage-delivery';
const SANCTIONED_OBJ = 'arn:aws:s3:::apiable-logs-prod/x';
const EXFIL_OBJ = 'arn:aws:s3:::attacker-exfil-bucket/x';
// The guardrail SCP as the module renders it: a principal-UNSCOPED Deny on s3:Put* that exempts only the
// operator carve-out via StringNotLike aws:PrincipalArn — so it cannot be evaded by a role's chosen name.
const SCP = {
    Version: '2012-10-17',
    Statement: [
        {
            Sid: 'DenyWriteOutsideSanctionedBuckets',
            Effect: 'Deny',
            Action: ['s3:Put*'],
            NotResource: ['arn:aws:s3:::apiable-logs-prod/*'],
            Condition: { StringNotLike: { 'aws:PrincipalArn': [OPERATOR_WRITER] } },
        },
    ],
};
const BUCKET_POLICY = {
    Version: '2012-10-17',
    Statement: [
        {
            Sid: 'AllowSanctionedFirehoseDeliveryOnly',
            Effect: 'Allow',
            Principal: { AWS: [FIREHOSE_ROLE] },
            Action: 's3:PutObject',
            Resource: 'arn:aws:s3:::apiable-logs-prod/*',
            Condition: { StringEquals: { 'aws:SourceAccount': '111111111111', 'aws:PrincipalOrgID': 'o-exampleorgid' } },
        },
    ],
};
const inOrg = (over) => ({
    principalArn: FIREHOSE_ROLE,
    action: 's3:PutObject',
    resourceArn: SANCTIONED_OBJ,
    sourceAccount: '111111111111',
    principalOrgId: 'o-exampleorgid',
    ...over,
});
describe('013-1-24 guardrail oracle — the carve-out gates the Deny, the role name does not', () => {
    it('an operator carve-out principal writing outside the allow-list is NOT denied (no false-deny of a known writer)', () => {
        expect((0, policy_evaluator_1.evaluateScp)(SCP, inOrg({ principalArn: OPERATOR_WRITER, resourceArn: EXFIL_OBJ }))).toBe('NotApplicable');
    });
    it('the sanctioned firehose role writing INSIDE the allow-list is not denied by the SCP', () => {
        expect((0, policy_evaluator_1.evaluateScp)(SCP, inOrg({ resourceArn: SANCTIONED_OBJ }))).toBe('NotApplicable');
    });
    it('the sanctioned firehose role writing OUTSIDE the allow-list is denied by the SCP', () => {
        expect((0, policy_evaluator_1.evaluateScp)(SCP, inOrg({ resourceArn: EXFIL_OBJ }))).toBe('Deny');
    });
    it('a hand-rolled role named OUTSIDE apiable-*-firehose (not in the carve-out) is STILL denied outside the allow-list (closes the F1 name-escape)', () => {
        // The role name buys no exemption: only membership of the operator-owned carve-out does, and a
        // hand-rolled channel cannot add itself — so a renamed delivery role is denied by default.
        expect((0, policy_evaluator_1.evaluateScp)(SCP, inOrg({ principalArn: RENAMED_HANDROLLED_ROLE, resourceArn: EXFIL_OBJ }))).toBe('Deny');
    });
});
describe('013-1-24 guardrail oracle — the carve-out exempts ONLY its listed principal, never everyone (F-R1)', () => {
    // The tightest LEGAL carve-out the variable validation now admits: a single concrete-account principal.
    // The fail-OPEN this closes is a carve-out of arn:aws:iam::*:* (or ::*:role/*), which StringNotLike would
    // match against EVERY principal, turning the Deny into NotApplicable for all writers — a total fail-open.
    // The validation rejects those wildcard-account carve-outs (proven by the CI no-widen leg); here we prove
    // the EFFECT a legal carve-out has: it exempts exactly the named principal and no one else.
    const TIGHT_CARVE_OUT = 'arn:aws:iam::123456789012:role/usage-delivery';
    const scpWithCarveOut = (carveOut) => ({
        Version: '2012-10-17',
        Statement: [
            {
                Sid: 'DenyWriteOutsideSanctionedBuckets',
                Effect: 'Deny',
                Action: ['s3:Put*'],
                NotResource: ['arn:aws:s3:::apiable-logs-prod/*'],
                Condition: { StringNotLike: { 'aws:PrincipalArn': carveOut } },
            },
        ],
    });
    it('the exact carved-out principal writing outside the allow-list is exempt (NotApplicable)', () => {
        const scp = scpWithCarveOut([TIGHT_CARVE_OUT]);
        expect((0, policy_evaluator_1.evaluateScp)(scp, inOrg({ principalArn: TIGHT_CARVE_OUT, resourceArn: EXFIL_OBJ }))).toBe('NotApplicable');
    });
    it('a DIFFERENT attacker principal sharing the carved-out role NAME is STILL denied — the carve-out is the exact ARN, not the name', () => {
        // A same-named role in a different account, the exact bypass a name-keyed carve-out would have let
        // through: it is not the carved-out ARN, so the StringNotLike does not exempt it and the Deny bites.
        const scp = scpWithCarveOut([TIGHT_CARVE_OUT]);
        const attacker = 'arn:aws:iam::999988887777:role/usage-delivery';
        expect((0, policy_evaluator_1.evaluateScp)(scp, inOrg({ principalArn: attacker, resourceArn: EXFIL_OBJ }))).toBe('Deny');
    });
    it('an arbitrary attacker principal is STILL denied under the tightest legal carve-out (the carve-out is not "everyone")', () => {
        const scp = scpWithCarveOut([TIGHT_CARVE_OUT]);
        expect((0, policy_evaluator_1.evaluateScp)(scp, inOrg({ principalArn: RENAMED_HANDROLLED_ROLE, resourceArn: EXFIL_OBJ }))).toBe('Deny');
    });
    it('the fail-OPEN a wildcard-account carve-out WOULD cause is exhibited at the oracle (which is why the variable validation rejects it)', () => {
        // This proves the threat the F-R1 validation guards against is real: were arn:aws:iam::*:* ever to reach
        // the rendered SCP, StringNotLike would match every principal and the Deny would never apply. The
        // variable validation (and the CI no-widen leg) prevent this value from ever being deployed.
        const scp = scpWithCarveOut(['arn:aws:iam::*:*']);
        expect((0, policy_evaluator_1.evaluateScp)(scp, inOrg({ principalArn: RENAMED_HANDROLLED_ROLE, resourceArn: EXFIL_OBJ }))).toBe('NotApplicable');
    });
});
describe('013-1-24 guardrail oracle — write-equivalent actions are covered', () => {
    // s3:Put* sweeps every object-write verb: PutObject + its ACL/tagging exfil vectors AND the object-lock
    // verbs (legal-hold / retention) a narrow PutObject-only enumeration would have missed.
    it.each([
        's3:PutObject',
        's3:PutObjectAcl',
        's3:PutObjectTagging',
        's3:PutObjectLegalHold',
        's3:PutObjectRetention',
    ])('the firehose role is denied %s outside the allow-list', (action) => {
        expect((0, policy_evaluator_1.evaluateScp)(SCP, inOrg({ action, resourceArn: EXFIL_OBJ }))).toBe('Deny');
    });
    it('a read action outside the allow-list is NOT denied by this guardrail (it governs writes only)', () => {
        expect((0, policy_evaluator_1.evaluateScp)(SCP, inOrg({ action: 's3:GetObject', resourceArn: EXFIL_OBJ }))).toBe('NotApplicable');
    });
});
describe('013-1-24 guardrail oracle — bucket-policy conditions gate the Allow', () => {
    it('the sanctioned role from the right account + org is allowed', () => {
        expect((0, policy_evaluator_1.evaluateResourcePolicy)(BUCKET_POLICY, inOrg({}))).toBe('Allow');
    });
    it('the same role from the WRONG org is not allowed (aws:PrincipalOrgID gates)', () => {
        expect((0, policy_evaluator_1.evaluateResourcePolicy)(BUCKET_POLICY, inOrg({ principalOrgId: 'o-attacker' }))).toBe('NotApplicable');
    });
    it('the same role from the WRONG source account is not allowed (aws:SourceAccount gates)', () => {
        expect((0, policy_evaluator_1.evaluateResourcePolicy)(BUCKET_POLICY, inOrg({ sourceAccount: '999988887777' }))).toBe('NotApplicable');
    });
    it('a foreign role (not a named principal) is not allowed even from the right org', () => {
        const foreign = 'arn:aws:iam::999988887777:role/apiable-usagelogs-firehose';
        expect((0, policy_evaluator_1.evaluateResourcePolicy)(BUCKET_POLICY, inOrg({ principalArn: foreign }))).toBe('NotApplicable');
    });
    it('a missing condition context value (no org id presented) is not allowed (fail-closed)', () => {
        expect((0, policy_evaluator_1.evaluateResourcePolicy)(BUCKET_POLICY, inOrg({ principalOrgId: undefined }))).toBe('NotApplicable');
    });
});
describe('013-1-24 guardrail oracle — end-to-end deny-overrides', () => {
    const context = { scp: SCP, bucketPolicies: { 'apiable-logs-prod': BUCKET_POLICY } };
    it('wrong-org write to the SANCTIONED bucket is denied overall (bucket-policy backstop, SCP silent)', () => {
        // The SCP does not deny (the destination is on the allow-list), so the bucket policy is the layer
        // that refuses the wrong-org principal — proving the second layer is load-bearing, not decorative.
        expect((0, policy_evaluator_1.evaluateScp)(SCP, inOrg({ principalOrgId: 'o-attacker' }))).toBe('NotApplicable');
        expect((0, policy_evaluator_1.evaluateDelivery)(context, inOrg({ principalOrgId: 'o-attacker' }))).toBe('Denied');
    });
    it('a write to a bucket with NO governing policy is denied (default-deny, not a hole)', () => {
        expect((0, policy_evaluator_1.evaluateDelivery)(context, inOrg({ resourceArn: 'arn:aws:s3:::apiable-logs-unmanaged/x' }))).toBe('Denied');
    });
    it('an unmodelled condition operator on a Deny fails closed (treated as drift, the request is denied)', () => {
        const scpWithUnknownOp = {
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Deny',
                    Action: 's3:PutObject',
                    NotResource: ['arn:aws:s3:::apiable-logs-prod/*'],
                    Condition: { DateGreaterThan: { 'aws:CurrentTime': '2000-01-01T00:00:00Z' } },
                },
            ],
        };
        // An operator the evaluator does not model must not silently skip the Deny — the statement still bites.
        expect((0, policy_evaluator_1.evaluateScp)(scpWithUnknownOp, inOrg({ resourceArn: EXFIL_OBJ }))).toBe('Deny');
    });
    it('an empty NotResource on a Deny names every resource (a bare exfil-everything Deny bites)', () => {
        // AWS: NotResource [] excludes nothing, so the Deny applies to all resources; the evaluator must not
        // treat the empty list as matching nothing (that would fail open on a real-but-malformed Deny).
        const scpDenyAll = {
            Version: '2012-10-17',
            Statement: [{ Effect: 'Deny', Action: 's3:PutObject', NotResource: [] }],
        };
        expect((0, policy_evaluator_1.evaluateScp)(scpDenyAll, inOrg({ resourceArn: SANCTIONED_OBJ }))).toBe('Deny');
    });
});
describe('013-1-24 guardrail oracle — identity (channel) policy', () => {
    it('a channel role with no S3 grant is not permitted (NotApplicable → denied by the caller)', () => {
        expect((0, policy_evaluator_1.evaluateIdentityPolicy)({ Version: '2012-10-17', Statement: [] }, inOrg({}))).toBe('NotApplicable');
    });
    it('a channel role scoped to the sanctioned bucket permits the sanctioned write', () => {
        const scoped = {
            Version: '2012-10-17',
            Statement: [{ Effect: 'Allow', Action: 's3:PutObject', Resource: 'arn:aws:s3:::apiable-logs-prod/*' }],
        };
        expect((0, policy_evaluator_1.evaluateIdentityPolicy)(scoped, inOrg({}))).toBe('Allow');
    });
    it('a widened channel role (Resource "*") still cannot beat the SCP for an out-of-list write', () => {
        const widened = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:PutObject', Resource: '*' }] };
        expect((0, policy_evaluator_1.evaluateDelivery)({ scp: SCP, identityPolicy: widened }, inOrg({ resourceArn: EXFIL_OBJ }))).toBe('Denied');
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicG9saWN5LWV2YWx1YXRvci50YS5zcGVjLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsicG9saWN5LWV2YWx1YXRvci50YS5zcGVjLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUE7Ozs7Ozs7OztHQVNHO0FBQ0gsaUVBTW1DO0FBRW5DLE1BQU0sYUFBYSxHQUFHLDJEQUEyRCxDQUFBO0FBQ2pGLGtHQUFrRztBQUNsRyxNQUFNLGVBQWUsR0FBRyw4RkFBOEYsQ0FBQTtBQUN0SCxzR0FBc0c7QUFDdEcsTUFBTSx1QkFBdUIsR0FBRywrQ0FBK0MsQ0FBQTtBQUMvRSxNQUFNLGNBQWMsR0FBRyxrQ0FBa0MsQ0FBQTtBQUN6RCxNQUFNLFNBQVMsR0FBRyxzQ0FBc0MsQ0FBQTtBQUV4RCx5R0FBeUc7QUFDekcsMEdBQTBHO0FBQzFHLE1BQU0sR0FBRyxHQUFHO0lBQ1YsT0FBTyxFQUFFLFlBQVk7SUFDckIsU0FBUyxFQUFFO1FBQ1Q7WUFDRSxHQUFHLEVBQUUsbUNBQW1DO1lBQ3hDLE1BQU0sRUFBRSxNQUFNO1lBQ2QsTUFBTSxFQUFFLENBQUMsU0FBUyxDQUFDO1lBQ25CLFdBQVcsRUFBRSxDQUFDLGtDQUFrQyxDQUFDO1lBQ2pELFNBQVMsRUFBRSxFQUFFLGFBQWEsRUFBRSxFQUFFLGtCQUFrQixFQUFFLENBQUMsZUFBZSxDQUFDLEVBQUUsRUFBRTtTQUN4RTtLQUNGO0NBQ0YsQ0FBQTtBQUVELE1BQU0sYUFBYSxHQUFHO0lBQ3BCLE9BQU8sRUFBRSxZQUFZO0lBQ3JCLFNBQVMsRUFBRTtRQUNUO1lBQ0UsR0FBRyxFQUFFLHFDQUFxQztZQUMxQyxNQUFNLEVBQUUsT0FBTztZQUNmLFNBQVMsRUFBRSxFQUFFLEdBQUcsRUFBRSxDQUFDLGFBQWEsQ0FBQyxFQUFFO1lBQ25DLE1BQU0sRUFBRSxjQUFjO1lBQ3RCLFFBQVEsRUFBRSxrQ0FBa0M7WUFDNUMsU0FBUyxFQUFFLEVBQUUsWUFBWSxFQUFFLEVBQUUsbUJBQW1CLEVBQUUsY0FBYyxFQUFFLG9CQUFvQixFQUFFLGdCQUFnQixFQUFFLEVBQUU7U0FDN0c7S0FDRjtDQUNGLENBQUE7QUFFRCxNQUFNLEtBQUssR0FBRyxDQUFDLElBQTRCLEVBQWlCLEVBQUUsQ0FBQyxDQUFDO0lBQzlELFlBQVksRUFBRSxhQUFhO0lBQzNCLE1BQU0sRUFBRSxjQUFjO0lBQ3RCLFdBQVcsRUFBRSxjQUFjO0lBQzNCLGFBQWEsRUFBRSxjQUFjO0lBQzdCLGNBQWMsRUFBRSxnQkFBZ0I7SUFDaEMsR0FBRyxJQUFJO0NBQ1IsQ0FBQyxDQUFBO0FBRUYsUUFBUSxDQUFDLGtGQUFrRixFQUFFLEdBQUcsRUFBRTtJQUNoRyxFQUFFLENBQUMsZ0hBQWdILEVBQUUsR0FBRyxFQUFFO1FBQ3hILE1BQU0sQ0FBQyxJQUFBLDhCQUFXLEVBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxFQUFFLFlBQVksRUFBRSxlQUFlLEVBQUUsV0FBVyxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQTtJQUNsSCxDQUFDLENBQUMsQ0FBQTtJQUVGLEVBQUUsQ0FBQyxxRkFBcUYsRUFBRSxHQUFHLEVBQUU7UUFDN0YsTUFBTSxDQUFDLElBQUEsOEJBQVcsRUFBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLEVBQUUsV0FBVyxFQUFFLGNBQWMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQTtJQUN4RixDQUFDLENBQUMsQ0FBQTtJQUVGLEVBQUUsQ0FBQyxrRkFBa0YsRUFBRSxHQUFHLEVBQUU7UUFDMUYsTUFBTSxDQUFDLElBQUEsOEJBQVcsRUFBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLEVBQUUsV0FBVyxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUMxRSxDQUFDLENBQUMsQ0FBQTtJQUVGLEVBQUUsQ0FBQywrSUFBK0ksRUFBRSxHQUFHLEVBQUU7UUFDdkosK0ZBQStGO1FBQy9GLDJGQUEyRjtRQUMzRixNQUFNLENBQUMsSUFBQSw4QkFBVyxFQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsRUFBRSxZQUFZLEVBQUUsdUJBQXVCLEVBQUUsV0FBVyxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUNqSCxDQUFDLENBQUMsQ0FBQTtBQUNKLENBQUMsQ0FBQyxDQUFBO0FBRUYsUUFBUSxDQUFDLG9HQUFvRyxFQUFFLEdBQUcsRUFBRTtJQUNsSCx3R0FBd0c7SUFDeEcsMEdBQTBHO0lBQzFHLDBHQUEwRztJQUMxRywwR0FBMEc7SUFDMUcsNEZBQTRGO0lBQzVGLE1BQU0sZUFBZSxHQUFHLCtDQUErQyxDQUFBO0lBQ3ZFLE1BQU0sZUFBZSxHQUFHLENBQUMsUUFBa0IsRUFBRSxFQUFFLENBQUMsQ0FBQztRQUMvQyxPQUFPLEVBQUUsWUFBWTtRQUNyQixTQUFTLEVBQUU7WUFDVDtnQkFDRSxHQUFHLEVBQUUsbUNBQW1DO2dCQUN4QyxNQUFNLEVBQUUsTUFBTTtnQkFDZCxNQUFNLEVBQUUsQ0FBQyxTQUFTLENBQUM7Z0JBQ25CLFdBQVcsRUFBRSxDQUFDLGtDQUFrQyxDQUFDO2dCQUNqRCxTQUFTLEVBQUUsRUFBRSxhQUFhLEVBQUUsRUFBRSxrQkFBa0IsRUFBRSxRQUFRLEVBQUUsRUFBRTthQUMvRDtTQUNGO0tBQ0YsQ0FBQyxDQUFBO0lBRUYsRUFBRSxDQUFDLHlGQUF5RixFQUFFLEdBQUcsRUFBRTtRQUNqRyxNQUFNLEdBQUcsR0FBRyxlQUFlLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFBO1FBQzlDLE1BQU0sQ0FBQyxJQUFBLDhCQUFXLEVBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxFQUFFLFlBQVksRUFBRSxlQUFlLEVBQUUsV0FBVyxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQTtJQUNsSCxDQUFDLENBQUMsQ0FBQTtJQUVGLEVBQUUsQ0FBQyxnSUFBZ0ksRUFBRSxHQUFHLEVBQUU7UUFDeEksbUdBQW1HO1FBQ25HLHFHQUFxRztRQUNyRyxNQUFNLEdBQUcsR0FBRyxlQUFlLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFBO1FBQzlDLE1BQU0sUUFBUSxHQUFHLCtDQUErQyxDQUFBO1FBQ2hFLE1BQU0sQ0FBQyxJQUFBLDhCQUFXLEVBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxFQUFFLFlBQVksRUFBRSxRQUFRLEVBQUUsV0FBVyxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUNsRyxDQUFDLENBQUMsQ0FBQTtJQUVGLEVBQUUsQ0FBQyxzSEFBc0gsRUFBRSxHQUFHLEVBQUU7UUFDOUgsTUFBTSxHQUFHLEdBQUcsZUFBZSxDQUFDLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQTtRQUM5QyxNQUFNLENBQUMsSUFBQSw4QkFBVyxFQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsRUFBRSxZQUFZLEVBQUUsdUJBQXVCLEVBQUUsV0FBVyxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUNqSCxDQUFDLENBQUMsQ0FBQTtJQUVGLEVBQUUsQ0FBQyxxSUFBcUksRUFBRSxHQUFHLEVBQUU7UUFDN0kseUdBQXlHO1FBQ3pHLGtHQUFrRztRQUNsRyw2RkFBNkY7UUFDN0YsTUFBTSxHQUFHLEdBQUcsZUFBZSxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFBO1FBQ2pELE1BQU0sQ0FBQyxJQUFBLDhCQUFXLEVBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxFQUFFLFlBQVksRUFBRSx1QkFBdUIsRUFBRSxXQUFXLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxDQUFBO0lBQzFILENBQUMsQ0FBQyxDQUFBO0FBQ0osQ0FBQyxDQUFDLENBQUE7QUFFRixRQUFRLENBQUMsa0VBQWtFLEVBQUUsR0FBRyxFQUFFO0lBQ2hGLHdHQUF3RztJQUN4Ryx3RkFBd0Y7SUFDeEYsRUFBRSxDQUFDLElBQUksQ0FBQztRQUNOLGNBQWM7UUFDZCxpQkFBaUI7UUFDakIscUJBQXFCO1FBQ3JCLHVCQUF1QjtRQUN2Qix1QkFBdUI7S0FDeEIsQ0FBQyxDQUFDLHVEQUF1RCxFQUFFLENBQUMsTUFBTSxFQUFFLEVBQUU7UUFDckUsTUFBTSxDQUFDLElBQUEsOEJBQVcsRUFBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLEVBQUUsTUFBTSxFQUFFLFdBQVcsRUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUE7SUFDbEYsQ0FBQyxDQUFDLENBQUE7SUFFRixFQUFFLENBQUMsK0ZBQStGLEVBQUUsR0FBRyxFQUFFO1FBQ3ZHLE1BQU0sQ0FBQyxJQUFBLDhCQUFXLEVBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxFQUFFLE1BQU0sRUFBRSxjQUFjLEVBQUUsV0FBVyxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQTtJQUMzRyxDQUFDLENBQUMsQ0FBQTtBQUNKLENBQUMsQ0FBQyxDQUFBO0FBRUYsUUFBUSxDQUFDLHFFQUFxRSxFQUFFLEdBQUcsRUFBRTtJQUNuRixFQUFFLENBQUMsNkRBQTZELEVBQUUsR0FBRyxFQUFFO1FBQ3JFLE1BQU0sQ0FBQyxJQUFBLHlDQUFzQixFQUFDLGFBQWEsRUFBRSxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQTtJQUN4RSxDQUFDLENBQUMsQ0FBQTtJQUVGLEVBQUUsQ0FBQyw0RUFBNEUsRUFBRSxHQUFHLEVBQUU7UUFDcEYsTUFBTSxDQUFDLElBQUEseUNBQXNCLEVBQUMsYUFBYSxFQUFFLEtBQUssQ0FBQyxFQUFFLGNBQWMsRUFBRSxZQUFZLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUE7SUFDOUcsQ0FBQyxDQUFDLENBQUE7SUFFRixFQUFFLENBQUMsc0ZBQXNGLEVBQUUsR0FBRyxFQUFFO1FBQzlGLE1BQU0sQ0FBQyxJQUFBLHlDQUFzQixFQUFDLGFBQWEsRUFBRSxLQUFLLENBQUMsRUFBRSxhQUFhLEVBQUUsY0FBYyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxDQUFBO0lBQy9HLENBQUMsQ0FBQyxDQUFBO0lBRUYsRUFBRSxDQUFDLCtFQUErRSxFQUFFLEdBQUcsRUFBRTtRQUN2RixNQUFNLE9BQU8sR0FBRywyREFBMkQsQ0FBQTtRQUMzRSxNQUFNLENBQUMsSUFBQSx5Q0FBc0IsRUFBQyxhQUFhLEVBQUUsS0FBSyxDQUFDLEVBQUUsWUFBWSxFQUFFLE9BQU8sRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQTtJQUN2RyxDQUFDLENBQUMsQ0FBQTtJQUVGLEVBQUUsQ0FBQyxzRkFBc0YsRUFBRSxHQUFHLEVBQUU7UUFDOUYsTUFBTSxDQUFDLElBQUEseUNBQXNCLEVBQUMsYUFBYSxFQUFFLEtBQUssQ0FBQyxFQUFFLGNBQWMsRUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUE7SUFDM0csQ0FBQyxDQUFDLENBQUE7QUFDSixDQUFDLENBQUMsQ0FBQTtBQUVGLFFBQVEsQ0FBQyx1REFBdUQsRUFBRSxHQUFHLEVBQUU7SUFDckUsTUFBTSxPQUFPLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLGNBQWMsRUFBRSxFQUFFLG1CQUFtQixFQUFFLGFBQWEsRUFBRSxFQUFFLENBQUE7SUFFcEYsRUFBRSxDQUFDLGlHQUFpRyxFQUFFLEdBQUcsRUFBRTtRQUN6RyxrR0FBa0c7UUFDbEcsbUdBQW1HO1FBQ25HLE1BQU0sQ0FBQyxJQUFBLDhCQUFXLEVBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxFQUFFLGNBQWMsRUFBRSxZQUFZLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUE7UUFDdkYsTUFBTSxDQUFDLElBQUEsbUNBQWdCLEVBQUMsT0FBTyxFQUFFLEtBQUssQ0FBQyxFQUFFLGNBQWMsRUFBRSxZQUFZLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUE7SUFDM0YsQ0FBQyxDQUFDLENBQUE7SUFFRixFQUFFLENBQUMsbUZBQW1GLEVBQUUsR0FBRyxFQUFFO1FBQzNGLE1BQU0sQ0FBQyxJQUFBLG1DQUFnQixFQUFDLE9BQU8sRUFBRSxLQUFLLENBQUMsRUFBRSxXQUFXLEVBQUUsdUNBQXVDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUE7SUFDbkgsQ0FBQyxDQUFDLENBQUE7SUFFRixFQUFFLENBQUMsbUdBQW1HLEVBQUUsR0FBRyxFQUFFO1FBQzNHLE1BQU0sZ0JBQWdCLEdBQUc7WUFDdkIsT0FBTyxFQUFFLFlBQVk7WUFDckIsU0FBUyxFQUFFO2dCQUNUO29CQUNFLE1BQU0sRUFBRSxNQUFNO29CQUNkLE1BQU0sRUFBRSxjQUFjO29CQUN0QixXQUFXLEVBQUUsQ0FBQyxrQ0FBa0MsQ0FBQztvQkFDakQsU0FBUyxFQUFFLEVBQUUsZUFBZSxFQUFFLEVBQUUsaUJBQWlCLEVBQUUsc0JBQXNCLEVBQUUsRUFBRTtpQkFDOUU7YUFDRjtTQUNGLENBQUE7UUFDRCx3R0FBd0c7UUFDeEcsTUFBTSxDQUFDLElBQUEsOEJBQVcsRUFBQyxnQkFBZ0IsRUFBRSxLQUFLLENBQUMsRUFBRSxXQUFXLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFBO0lBQ3ZGLENBQUMsQ0FBQyxDQUFBO0lBRUYsRUFBRSxDQUFDLDBGQUEwRixFQUFFLEdBQUcsRUFBRTtRQUNsRyxxR0FBcUc7UUFDckcsZ0dBQWdHO1FBQ2hHLE1BQU0sVUFBVSxHQUFHO1lBQ2pCLE9BQU8sRUFBRSxZQUFZO1lBQ3JCLFNBQVMsRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsY0FBYyxFQUFFLFdBQVcsRUFBRSxFQUFFLEVBQUUsQ0FBQztTQUN6RSxDQUFBO1FBQ0QsTUFBTSxDQUFDLElBQUEsOEJBQVcsRUFBQyxVQUFVLEVBQUUsS0FBSyxDQUFDLEVBQUUsV0FBVyxFQUFFLGNBQWMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUN0RixDQUFDLENBQUMsQ0FBQTtBQUNKLENBQUMsQ0FBQyxDQUFBO0FBRUYsUUFBUSxDQUFDLHVEQUF1RCxFQUFFLEdBQUcsRUFBRTtJQUNyRSxFQUFFLENBQUMseUZBQXlGLEVBQUUsR0FBRyxFQUFFO1FBQ2pHLE1BQU0sQ0FBQyxJQUFBLHlDQUFzQixFQUFDLEVBQUUsT0FBTyxFQUFFLFlBQVksRUFBRSxTQUFTLEVBQUUsRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUE7SUFDM0csQ0FBQyxDQUFDLENBQUE7SUFFRixFQUFFLENBQUMsNkVBQTZFLEVBQUUsR0FBRyxFQUFFO1FBQ3JGLE1BQU0sTUFBTSxHQUFHO1lBQ2IsT0FBTyxFQUFFLFlBQVk7WUFDckIsU0FBUyxFQUFFLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxjQUFjLEVBQUUsUUFBUSxFQUFFLGtDQUFrQyxFQUFFLENBQUM7U0FDdkcsQ0FBQTtRQUNELE1BQU0sQ0FBQyxJQUFBLHlDQUFzQixFQUFDLE1BQU0sRUFBRSxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQTtJQUNqRSxDQUFDLENBQUMsQ0FBQTtJQUVGLEVBQUUsQ0FBQywwRkFBMEYsRUFBRSxHQUFHLEVBQUU7UUFDbEcsTUFBTSxPQUFPLEdBQUcsRUFBRSxPQUFPLEVBQUUsWUFBWSxFQUFFLFNBQVMsRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsY0FBYyxFQUFFLFFBQVEsRUFBRSxHQUFHLEVBQUUsQ0FBQyxFQUFFLENBQUE7UUFDbEgsTUFBTSxDQUFDLElBQUEsbUNBQWdCLEVBQUMsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLGNBQWMsRUFBRSxPQUFPLEVBQUUsRUFBRSxLQUFLLENBQUMsRUFBRSxXQUFXLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBQ25ILENBQUMsQ0FBQyxDQUFBO0FBQ0osQ0FBQyxDQUFDLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFRBIOKAlCBhZGRpdGlvbmFsIGNvdmVyYWdlIGZvciB0aGUgZmlyZWhvc2UtZGVzdGluYXRpb24gZ3VhcmRyYWlsIG9yYWNsZSAodGVzdC9zdXBwb3J0L3BvbGljeS1ldmFsdWF0b3IudHMpLlxuICpcbiAqIFRoZSBldmFsdWF0b3IgaXMgdGhlIHRydXN0IGFuY2hvciBvZiB0aGUgMDEzLTEtMjQgYWNjZXB0YW5jZSBzcGVjczogaWYgaXQgZmFsc2UtYWxsb3dzIG9yIGZhbHNlLWRlbmllcyxcbiAqIGV2ZXJ5IFN4IHNjZW5hcmlvIHNpbGVudGx5IGxpZXMuIFRoZXNlIGNhc2VzIGV4ZXJjaXNlIHRoZSBldmFsdWF0b3IncyBkZWNpc2lvbiBlZGdlcyBkaXJlY3RseSDigJQgdGhlXG4gKiBwcmluY2lwYWwtdW5zY29wZWQgRGVueSB3aXRoIGl0cyBvcGVyYXRvciBjYXJ2ZS1vdXQgKHdoaWNoIG11c3QgY2F0Y2ggYSByZW5hbWVkIGhhbmQtcm9sbGVkIHJvbGUgeWV0XG4gKiBOT1Qgb3Zlci1kZW55IGFuIGV4ZW1wdCBvcGVyYXRvciBwcmluY2lwYWwpLCB0aGUgd3JpdGUtZXF1aXZhbGVudCBhY3Rpb24gY292ZXJhZ2UsIHRoZSBidWNrZXQtcG9saWN5XG4gKiBjb25kaXRpb25zLCBkZWZhdWx0LWRlbnksIGdsb2IgYmVoYXZpb3VyLCBhbmQgZmFpbC1jbG9zZWQgb24gYW4gdW5tb2RlbGxlZCBjb25kaXRpb24gb3BlcmF0b3Ig4oCUIGJleW9uZFxuICogdGhlIHNpeCBjb250cmFjdCBzY2VuYXJpb3MnIGNoYW5uZWwtbGV2ZWwgYXNzZXJ0aW9ucy5cbiAqL1xuaW1wb3J0IHtcbiAgQWNjZXNzUmVxdWVzdCxcbiAgZXZhbHVhdGVEZWxpdmVyeSxcbiAgZXZhbHVhdGVJZGVudGl0eVBvbGljeSxcbiAgZXZhbHVhdGVSZXNvdXJjZVBvbGljeSxcbiAgZXZhbHVhdGVTY3AsXG59IGZyb20gJy4vc3VwcG9ydC9wb2xpY3ktZXZhbHVhdG9yJ1xuXG5jb25zdCBGSVJFSE9TRV9ST0xFID0gJ2Fybjphd3M6aWFtOjoxMTExMTExMTExMTE6cm9sZS9hcGlhYmxlLXVzYWdlbG9ncy1maXJlaG9zZSdcbi8vIEEgbG9nZ2luZy1hY2NvdW50IHNlcnZpY2UtbGlua2VkIHJvbGUgdGhlIG9wZXJhdG9yIGxlZ2l0aW1hdGVseSBleGVtcHRzICh0aGUgY2xvc2VkIGNhcnZlLW91dCkuXG5jb25zdCBPUEVSQVRPUl9XUklURVIgPSAnYXJuOmF3czppYW06OjExMTExMTExMTExMTpyb2xlL2F3cy1zZXJ2aWNlLXJvbGUvYmFja3VwLmFtYXpvbmF3cy5jb20vQVdTU2VydmljZVJvbGVGb3JCYWNrdXAnXG4vLyBBIGhhbmQtcm9sbGVkIGluLU9yZyBkZWxpdmVyeSByb2xlIG5hbWVkIE9VVFNJREUgdGhlIGFwaWFibGUtKi1maXJlaG9zZSBjb252ZW50aW9uIOKAlCB0aGUgRjEgZXNjYXBlLlxuY29uc3QgUkVOQU1FRF9IQU5EUk9MTEVEX1JPTEUgPSAnYXJuOmF3czppYW06OjExMTExMTExMTExMTpyb2xlL3VzYWdlLWRlbGl2ZXJ5J1xuY29uc3QgU0FOQ1RJT05FRF9PQkogPSAnYXJuOmF3czpzMzo6OmFwaWFibGUtbG9ncy1wcm9kL3gnXG5jb25zdCBFWEZJTF9PQkogPSAnYXJuOmF3czpzMzo6OmF0dGFja2VyLWV4ZmlsLWJ1Y2tldC94J1xuXG4vLyBUaGUgZ3VhcmRyYWlsIFNDUCBhcyB0aGUgbW9kdWxlIHJlbmRlcnMgaXQ6IGEgcHJpbmNpcGFsLVVOU0NPUEVEIERlbnkgb24gczM6UHV0KiB0aGF0IGV4ZW1wdHMgb25seSB0aGVcbi8vIG9wZXJhdG9yIGNhcnZlLW91dCB2aWEgU3RyaW5nTm90TGlrZSBhd3M6UHJpbmNpcGFsQXJuIOKAlCBzbyBpdCBjYW5ub3QgYmUgZXZhZGVkIGJ5IGEgcm9sZSdzIGNob3NlbiBuYW1lLlxuY29uc3QgU0NQID0ge1xuICBWZXJzaW9uOiAnMjAxMi0xMC0xNycsXG4gIFN0YXRlbWVudDogW1xuICAgIHtcbiAgICAgIFNpZDogJ0RlbnlXcml0ZU91dHNpZGVTYW5jdGlvbmVkQnVja2V0cycsXG4gICAgICBFZmZlY3Q6ICdEZW55JyxcbiAgICAgIEFjdGlvbjogWydzMzpQdXQqJ10sXG4gICAgICBOb3RSZXNvdXJjZTogWydhcm46YXdzOnMzOjo6YXBpYWJsZS1sb2dzLXByb2QvKiddLFxuICAgICAgQ29uZGl0aW9uOiB7IFN0cmluZ05vdExpa2U6IHsgJ2F3czpQcmluY2lwYWxBcm4nOiBbT1BFUkFUT1JfV1JJVEVSXSB9IH0sXG4gICAgfSxcbiAgXSxcbn1cblxuY29uc3QgQlVDS0VUX1BPTElDWSA9IHtcbiAgVmVyc2lvbjogJzIwMTItMTAtMTcnLFxuICBTdGF0ZW1lbnQ6IFtcbiAgICB7XG4gICAgICBTaWQ6ICdBbGxvd1NhbmN0aW9uZWRGaXJlaG9zZURlbGl2ZXJ5T25seScsXG4gICAgICBFZmZlY3Q6ICdBbGxvdycsXG4gICAgICBQcmluY2lwYWw6IHsgQVdTOiBbRklSRUhPU0VfUk9MRV0gfSxcbiAgICAgIEFjdGlvbjogJ3MzOlB1dE9iamVjdCcsXG4gICAgICBSZXNvdXJjZTogJ2Fybjphd3M6czM6OjphcGlhYmxlLWxvZ3MtcHJvZC8qJyxcbiAgICAgIENvbmRpdGlvbjogeyBTdHJpbmdFcXVhbHM6IHsgJ2F3czpTb3VyY2VBY2NvdW50JzogJzExMTExMTExMTExMScsICdhd3M6UHJpbmNpcGFsT3JnSUQnOiAnby1leGFtcGxlb3JnaWQnIH0gfSxcbiAgICB9LFxuICBdLFxufVxuXG5jb25zdCBpbk9yZyA9IChvdmVyOiBQYXJ0aWFsPEFjY2Vzc1JlcXVlc3Q+KTogQWNjZXNzUmVxdWVzdCA9PiAoe1xuICBwcmluY2lwYWxBcm46IEZJUkVIT1NFX1JPTEUsXG4gIGFjdGlvbjogJ3MzOlB1dE9iamVjdCcsXG4gIHJlc291cmNlQXJuOiBTQU5DVElPTkVEX09CSixcbiAgc291cmNlQWNjb3VudDogJzExMTExMTExMTExMScsXG4gIHByaW5jaXBhbE9yZ0lkOiAnby1leGFtcGxlb3JnaWQnLFxuICAuLi5vdmVyLFxufSlcblxuZGVzY3JpYmUoJzAxMy0xLTI0IGd1YXJkcmFpbCBvcmFjbGUg4oCUIHRoZSBjYXJ2ZS1vdXQgZ2F0ZXMgdGhlIERlbnksIHRoZSByb2xlIG5hbWUgZG9lcyBub3QnLCAoKSA9PiB7XG4gIGl0KCdhbiBvcGVyYXRvciBjYXJ2ZS1vdXQgcHJpbmNpcGFsIHdyaXRpbmcgb3V0c2lkZSB0aGUgYWxsb3ctbGlzdCBpcyBOT1QgZGVuaWVkIChubyBmYWxzZS1kZW55IG9mIGEga25vd24gd3JpdGVyKScsICgpID0+IHtcbiAgICBleHBlY3QoZXZhbHVhdGVTY3AoU0NQLCBpbk9yZyh7IHByaW5jaXBhbEFybjogT1BFUkFUT1JfV1JJVEVSLCByZXNvdXJjZUFybjogRVhGSUxfT0JKIH0pKSkudG9CZSgnTm90QXBwbGljYWJsZScpXG4gIH0pXG5cbiAgaXQoJ3RoZSBzYW5jdGlvbmVkIGZpcmVob3NlIHJvbGUgd3JpdGluZyBJTlNJREUgdGhlIGFsbG93LWxpc3QgaXMgbm90IGRlbmllZCBieSB0aGUgU0NQJywgKCkgPT4ge1xuICAgIGV4cGVjdChldmFsdWF0ZVNjcChTQ1AsIGluT3JnKHsgcmVzb3VyY2VBcm46IFNBTkNUSU9ORURfT0JKIH0pKSkudG9CZSgnTm90QXBwbGljYWJsZScpXG4gIH0pXG5cbiAgaXQoJ3RoZSBzYW5jdGlvbmVkIGZpcmVob3NlIHJvbGUgd3JpdGluZyBPVVRTSURFIHRoZSBhbGxvdy1saXN0IGlzIGRlbmllZCBieSB0aGUgU0NQJywgKCkgPT4ge1xuICAgIGV4cGVjdChldmFsdWF0ZVNjcChTQ1AsIGluT3JnKHsgcmVzb3VyY2VBcm46IEVYRklMX09CSiB9KSkpLnRvQmUoJ0RlbnknKVxuICB9KVxuXG4gIGl0KCdhIGhhbmQtcm9sbGVkIHJvbGUgbmFtZWQgT1VUU0lERSBhcGlhYmxlLSotZmlyZWhvc2UgKG5vdCBpbiB0aGUgY2FydmUtb3V0KSBpcyBTVElMTCBkZW5pZWQgb3V0c2lkZSB0aGUgYWxsb3ctbGlzdCAoY2xvc2VzIHRoZSBGMSBuYW1lLWVzY2FwZSknLCAoKSA9PiB7XG4gICAgLy8gVGhlIHJvbGUgbmFtZSBidXlzIG5vIGV4ZW1wdGlvbjogb25seSBtZW1iZXJzaGlwIG9mIHRoZSBvcGVyYXRvci1vd25lZCBjYXJ2ZS1vdXQgZG9lcywgYW5kIGFcbiAgICAvLyBoYW5kLXJvbGxlZCBjaGFubmVsIGNhbm5vdCBhZGQgaXRzZWxmIOKAlCBzbyBhIHJlbmFtZWQgZGVsaXZlcnkgcm9sZSBpcyBkZW5pZWQgYnkgZGVmYXVsdC5cbiAgICBleHBlY3QoZXZhbHVhdGVTY3AoU0NQLCBpbk9yZyh7IHByaW5jaXBhbEFybjogUkVOQU1FRF9IQU5EUk9MTEVEX1JPTEUsIHJlc291cmNlQXJuOiBFWEZJTF9PQkogfSkpKS50b0JlKCdEZW55JylcbiAgfSlcbn0pXG5cbmRlc2NyaWJlKCcwMTMtMS0yNCBndWFyZHJhaWwgb3JhY2xlIOKAlCB0aGUgY2FydmUtb3V0IGV4ZW1wdHMgT05MWSBpdHMgbGlzdGVkIHByaW5jaXBhbCwgbmV2ZXIgZXZlcnlvbmUgKEYtUjEpJywgKCkgPT4ge1xuICAvLyBUaGUgdGlnaHRlc3QgTEVHQUwgY2FydmUtb3V0IHRoZSB2YXJpYWJsZSB2YWxpZGF0aW9uIG5vdyBhZG1pdHM6IGEgc2luZ2xlIGNvbmNyZXRlLWFjY291bnQgcHJpbmNpcGFsLlxuICAvLyBUaGUgZmFpbC1PUEVOIHRoaXMgY2xvc2VzIGlzIGEgY2FydmUtb3V0IG9mIGFybjphd3M6aWFtOjoqOiogKG9yIDo6Kjpyb2xlLyopLCB3aGljaCBTdHJpbmdOb3RMaWtlIHdvdWxkXG4gIC8vIG1hdGNoIGFnYWluc3QgRVZFUlkgcHJpbmNpcGFsLCB0dXJuaW5nIHRoZSBEZW55IGludG8gTm90QXBwbGljYWJsZSBmb3IgYWxsIHdyaXRlcnMg4oCUIGEgdG90YWwgZmFpbC1vcGVuLlxuICAvLyBUaGUgdmFsaWRhdGlvbiByZWplY3RzIHRob3NlIHdpbGRjYXJkLWFjY291bnQgY2FydmUtb3V0cyAocHJvdmVuIGJ5IHRoZSBDSSBuby13aWRlbiBsZWcpOyBoZXJlIHdlIHByb3ZlXG4gIC8vIHRoZSBFRkZFQ1QgYSBsZWdhbCBjYXJ2ZS1vdXQgaGFzOiBpdCBleGVtcHRzIGV4YWN0bHkgdGhlIG5hbWVkIHByaW5jaXBhbCBhbmQgbm8gb25lIGVsc2UuXG4gIGNvbnN0IFRJR0hUX0NBUlZFX09VVCA9ICdhcm46YXdzOmlhbTo6MTIzNDU2Nzg5MDEyOnJvbGUvdXNhZ2UtZGVsaXZlcnknXG4gIGNvbnN0IHNjcFdpdGhDYXJ2ZU91dCA9IChjYXJ2ZU91dDogc3RyaW5nW10pID0+ICh7XG4gICAgVmVyc2lvbjogJzIwMTItMTAtMTcnLFxuICAgIFN0YXRlbWVudDogW1xuICAgICAge1xuICAgICAgICBTaWQ6ICdEZW55V3JpdGVPdXRzaWRlU2FuY3Rpb25lZEJ1Y2tldHMnLFxuICAgICAgICBFZmZlY3Q6ICdEZW55JyxcbiAgICAgICAgQWN0aW9uOiBbJ3MzOlB1dConXSxcbiAgICAgICAgTm90UmVzb3VyY2U6IFsnYXJuOmF3czpzMzo6OmFwaWFibGUtbG9ncy1wcm9kLyonXSxcbiAgICAgICAgQ29uZGl0aW9uOiB7IFN0cmluZ05vdExpa2U6IHsgJ2F3czpQcmluY2lwYWxBcm4nOiBjYXJ2ZU91dCB9IH0sXG4gICAgICB9LFxuICAgIF0sXG4gIH0pXG5cbiAgaXQoJ3RoZSBleGFjdCBjYXJ2ZWQtb3V0IHByaW5jaXBhbCB3cml0aW5nIG91dHNpZGUgdGhlIGFsbG93LWxpc3QgaXMgZXhlbXB0IChOb3RBcHBsaWNhYmxlKScsICgpID0+IHtcbiAgICBjb25zdCBzY3AgPSBzY3BXaXRoQ2FydmVPdXQoW1RJR0hUX0NBUlZFX09VVF0pXG4gICAgZXhwZWN0KGV2YWx1YXRlU2NwKHNjcCwgaW5PcmcoeyBwcmluY2lwYWxBcm46IFRJR0hUX0NBUlZFX09VVCwgcmVzb3VyY2VBcm46IEVYRklMX09CSiB9KSkpLnRvQmUoJ05vdEFwcGxpY2FibGUnKVxuICB9KVxuXG4gIGl0KCdhIERJRkZFUkVOVCBhdHRhY2tlciBwcmluY2lwYWwgc2hhcmluZyB0aGUgY2FydmVkLW91dCByb2xlIE5BTUUgaXMgU1RJTEwgZGVuaWVkIOKAlCB0aGUgY2FydmUtb3V0IGlzIHRoZSBleGFjdCBBUk4sIG5vdCB0aGUgbmFtZScsICgpID0+IHtcbiAgICAvLyBBIHNhbWUtbmFtZWQgcm9sZSBpbiBhIGRpZmZlcmVudCBhY2NvdW50LCB0aGUgZXhhY3QgYnlwYXNzIGEgbmFtZS1rZXllZCBjYXJ2ZS1vdXQgd291bGQgaGF2ZSBsZXRcbiAgICAvLyB0aHJvdWdoOiBpdCBpcyBub3QgdGhlIGNhcnZlZC1vdXQgQVJOLCBzbyB0aGUgU3RyaW5nTm90TGlrZSBkb2VzIG5vdCBleGVtcHQgaXQgYW5kIHRoZSBEZW55IGJpdGVzLlxuICAgIGNvbnN0IHNjcCA9IHNjcFdpdGhDYXJ2ZU91dChbVElHSFRfQ0FSVkVfT1VUXSlcbiAgICBjb25zdCBhdHRhY2tlciA9ICdhcm46YXdzOmlhbTo6OTk5OTg4ODg3Nzc3OnJvbGUvdXNhZ2UtZGVsaXZlcnknXG4gICAgZXhwZWN0KGV2YWx1YXRlU2NwKHNjcCwgaW5PcmcoeyBwcmluY2lwYWxBcm46IGF0dGFja2VyLCByZXNvdXJjZUFybjogRVhGSUxfT0JKIH0pKSkudG9CZSgnRGVueScpXG4gIH0pXG5cbiAgaXQoJ2FuIGFyYml0cmFyeSBhdHRhY2tlciBwcmluY2lwYWwgaXMgU1RJTEwgZGVuaWVkIHVuZGVyIHRoZSB0aWdodGVzdCBsZWdhbCBjYXJ2ZS1vdXQgKHRoZSBjYXJ2ZS1vdXQgaXMgbm90IFwiZXZlcnlvbmVcIiknLCAoKSA9PiB7XG4gICAgY29uc3Qgc2NwID0gc2NwV2l0aENhcnZlT3V0KFtUSUdIVF9DQVJWRV9PVVRdKVxuICAgIGV4cGVjdChldmFsdWF0ZVNjcChzY3AsIGluT3JnKHsgcHJpbmNpcGFsQXJuOiBSRU5BTUVEX0hBTkRST0xMRURfUk9MRSwgcmVzb3VyY2VBcm46IEVYRklMX09CSiB9KSkpLnRvQmUoJ0RlbnknKVxuICB9KVxuXG4gIGl0KCd0aGUgZmFpbC1PUEVOIGEgd2lsZGNhcmQtYWNjb3VudCBjYXJ2ZS1vdXQgV09VTEQgY2F1c2UgaXMgZXhoaWJpdGVkIGF0IHRoZSBvcmFjbGUgKHdoaWNoIGlzIHdoeSB0aGUgdmFyaWFibGUgdmFsaWRhdGlvbiByZWplY3RzIGl0KScsICgpID0+IHtcbiAgICAvLyBUaGlzIHByb3ZlcyB0aGUgdGhyZWF0IHRoZSBGLVIxIHZhbGlkYXRpb24gZ3VhcmRzIGFnYWluc3QgaXMgcmVhbDogd2VyZSBhcm46YXdzOmlhbTo6KjoqIGV2ZXIgdG8gcmVhY2hcbiAgICAvLyB0aGUgcmVuZGVyZWQgU0NQLCBTdHJpbmdOb3RMaWtlIHdvdWxkIG1hdGNoIGV2ZXJ5IHByaW5jaXBhbCBhbmQgdGhlIERlbnkgd291bGQgbmV2ZXIgYXBwbHkuIFRoZVxuICAgIC8vIHZhcmlhYmxlIHZhbGlkYXRpb24gKGFuZCB0aGUgQ0kgbm8td2lkZW4gbGVnKSBwcmV2ZW50IHRoaXMgdmFsdWUgZnJvbSBldmVyIGJlaW5nIGRlcGxveWVkLlxuICAgIGNvbnN0IHNjcCA9IHNjcFdpdGhDYXJ2ZU91dChbJ2Fybjphd3M6aWFtOjoqOionXSlcbiAgICBleHBlY3QoZXZhbHVhdGVTY3Aoc2NwLCBpbk9yZyh7IHByaW5jaXBhbEFybjogUkVOQU1FRF9IQU5EUk9MTEVEX1JPTEUsIHJlc291cmNlQXJuOiBFWEZJTF9PQkogfSkpKS50b0JlKCdOb3RBcHBsaWNhYmxlJylcbiAgfSlcbn0pXG5cbmRlc2NyaWJlKCcwMTMtMS0yNCBndWFyZHJhaWwgb3JhY2xlIOKAlCB3cml0ZS1lcXVpdmFsZW50IGFjdGlvbnMgYXJlIGNvdmVyZWQnLCAoKSA9PiB7XG4gIC8vIHMzOlB1dCogc3dlZXBzIGV2ZXJ5IG9iamVjdC13cml0ZSB2ZXJiOiBQdXRPYmplY3QgKyBpdHMgQUNML3RhZ2dpbmcgZXhmaWwgdmVjdG9ycyBBTkQgdGhlIG9iamVjdC1sb2NrXG4gIC8vIHZlcmJzIChsZWdhbC1ob2xkIC8gcmV0ZW50aW9uKSBhIG5hcnJvdyBQdXRPYmplY3Qtb25seSBlbnVtZXJhdGlvbiB3b3VsZCBoYXZlIG1pc3NlZC5cbiAgaXQuZWFjaChbXG4gICAgJ3MzOlB1dE9iamVjdCcsXG4gICAgJ3MzOlB1dE9iamVjdEFjbCcsXG4gICAgJ3MzOlB1dE9iamVjdFRhZ2dpbmcnLFxuICAgICdzMzpQdXRPYmplY3RMZWdhbEhvbGQnLFxuICAgICdzMzpQdXRPYmplY3RSZXRlbnRpb24nLFxuICBdKSgndGhlIGZpcmVob3NlIHJvbGUgaXMgZGVuaWVkICVzIG91dHNpZGUgdGhlIGFsbG93LWxpc3QnLCAoYWN0aW9uKSA9PiB7XG4gICAgZXhwZWN0KGV2YWx1YXRlU2NwKFNDUCwgaW5PcmcoeyBhY3Rpb24sIHJlc291cmNlQXJuOiBFWEZJTF9PQkogfSkpKS50b0JlKCdEZW55JylcbiAgfSlcblxuICBpdCgnYSByZWFkIGFjdGlvbiBvdXRzaWRlIHRoZSBhbGxvdy1saXN0IGlzIE5PVCBkZW5pZWQgYnkgdGhpcyBndWFyZHJhaWwgKGl0IGdvdmVybnMgd3JpdGVzIG9ubHkpJywgKCkgPT4ge1xuICAgIGV4cGVjdChldmFsdWF0ZVNjcChTQ1AsIGluT3JnKHsgYWN0aW9uOiAnczM6R2V0T2JqZWN0JywgcmVzb3VyY2VBcm46IEVYRklMX09CSiB9KSkpLnRvQmUoJ05vdEFwcGxpY2FibGUnKVxuICB9KVxufSlcblxuZGVzY3JpYmUoJzAxMy0xLTI0IGd1YXJkcmFpbCBvcmFjbGUg4oCUIGJ1Y2tldC1wb2xpY3kgY29uZGl0aW9ucyBnYXRlIHRoZSBBbGxvdycsICgpID0+IHtcbiAgaXQoJ3RoZSBzYW5jdGlvbmVkIHJvbGUgZnJvbSB0aGUgcmlnaHQgYWNjb3VudCArIG9yZyBpcyBhbGxvd2VkJywgKCkgPT4ge1xuICAgIGV4cGVjdChldmFsdWF0ZVJlc291cmNlUG9saWN5KEJVQ0tFVF9QT0xJQ1ksIGluT3JnKHt9KSkpLnRvQmUoJ0FsbG93JylcbiAgfSlcblxuICBpdCgndGhlIHNhbWUgcm9sZSBmcm9tIHRoZSBXUk9ORyBvcmcgaXMgbm90IGFsbG93ZWQgKGF3czpQcmluY2lwYWxPcmdJRCBnYXRlcyknLCAoKSA9PiB7XG4gICAgZXhwZWN0KGV2YWx1YXRlUmVzb3VyY2VQb2xpY3koQlVDS0VUX1BPTElDWSwgaW5PcmcoeyBwcmluY2lwYWxPcmdJZDogJ28tYXR0YWNrZXInIH0pKSkudG9CZSgnTm90QXBwbGljYWJsZScpXG4gIH0pXG5cbiAgaXQoJ3RoZSBzYW1lIHJvbGUgZnJvbSB0aGUgV1JPTkcgc291cmNlIGFjY291bnQgaXMgbm90IGFsbG93ZWQgKGF3czpTb3VyY2VBY2NvdW50IGdhdGVzKScsICgpID0+IHtcbiAgICBleHBlY3QoZXZhbHVhdGVSZXNvdXJjZVBvbGljeShCVUNLRVRfUE9MSUNZLCBpbk9yZyh7IHNvdXJjZUFjY291bnQ6ICc5OTk5ODg4ODc3NzcnIH0pKSkudG9CZSgnTm90QXBwbGljYWJsZScpXG4gIH0pXG5cbiAgaXQoJ2EgZm9yZWlnbiByb2xlIChub3QgYSBuYW1lZCBwcmluY2lwYWwpIGlzIG5vdCBhbGxvd2VkIGV2ZW4gZnJvbSB0aGUgcmlnaHQgb3JnJywgKCkgPT4ge1xuICAgIGNvbnN0IGZvcmVpZ24gPSAnYXJuOmF3czppYW06Ojk5OTk4ODg4Nzc3Nzpyb2xlL2FwaWFibGUtdXNhZ2Vsb2dzLWZpcmVob3NlJ1xuICAgIGV4cGVjdChldmFsdWF0ZVJlc291cmNlUG9saWN5KEJVQ0tFVF9QT0xJQ1ksIGluT3JnKHsgcHJpbmNpcGFsQXJuOiBmb3JlaWduIH0pKSkudG9CZSgnTm90QXBwbGljYWJsZScpXG4gIH0pXG5cbiAgaXQoJ2EgbWlzc2luZyBjb25kaXRpb24gY29udGV4dCB2YWx1ZSAobm8gb3JnIGlkIHByZXNlbnRlZCkgaXMgbm90IGFsbG93ZWQgKGZhaWwtY2xvc2VkKScsICgpID0+IHtcbiAgICBleHBlY3QoZXZhbHVhdGVSZXNvdXJjZVBvbGljeShCVUNLRVRfUE9MSUNZLCBpbk9yZyh7IHByaW5jaXBhbE9yZ0lkOiB1bmRlZmluZWQgfSkpKS50b0JlKCdOb3RBcHBsaWNhYmxlJylcbiAgfSlcbn0pXG5cbmRlc2NyaWJlKCcwMTMtMS0yNCBndWFyZHJhaWwgb3JhY2xlIOKAlCBlbmQtdG8tZW5kIGRlbnktb3ZlcnJpZGVzJywgKCkgPT4ge1xuICBjb25zdCBjb250ZXh0ID0geyBzY3A6IFNDUCwgYnVja2V0UG9saWNpZXM6IHsgJ2FwaWFibGUtbG9ncy1wcm9kJzogQlVDS0VUX1BPTElDWSB9IH1cblxuICBpdCgnd3Jvbmctb3JnIHdyaXRlIHRvIHRoZSBTQU5DVElPTkVEIGJ1Y2tldCBpcyBkZW5pZWQgb3ZlcmFsbCAoYnVja2V0LXBvbGljeSBiYWNrc3RvcCwgU0NQIHNpbGVudCknLCAoKSA9PiB7XG4gICAgLy8gVGhlIFNDUCBkb2VzIG5vdCBkZW55ICh0aGUgZGVzdGluYXRpb24gaXMgb24gdGhlIGFsbG93LWxpc3QpLCBzbyB0aGUgYnVja2V0IHBvbGljeSBpcyB0aGUgbGF5ZXJcbiAgICAvLyB0aGF0IHJlZnVzZXMgdGhlIHdyb25nLW9yZyBwcmluY2lwYWwg4oCUIHByb3ZpbmcgdGhlIHNlY29uZCBsYXllciBpcyBsb2FkLWJlYXJpbmcsIG5vdCBkZWNvcmF0aXZlLlxuICAgIGV4cGVjdChldmFsdWF0ZVNjcChTQ1AsIGluT3JnKHsgcHJpbmNpcGFsT3JnSWQ6ICdvLWF0dGFja2VyJyB9KSkpLnRvQmUoJ05vdEFwcGxpY2FibGUnKVxuICAgIGV4cGVjdChldmFsdWF0ZURlbGl2ZXJ5KGNvbnRleHQsIGluT3JnKHsgcHJpbmNpcGFsT3JnSWQ6ICdvLWF0dGFja2VyJyB9KSkpLnRvQmUoJ0RlbmllZCcpXG4gIH0pXG5cbiAgaXQoJ2Egd3JpdGUgdG8gYSBidWNrZXQgd2l0aCBOTyBnb3Zlcm5pbmcgcG9saWN5IGlzIGRlbmllZCAoZGVmYXVsdC1kZW55LCBub3QgYSBob2xlKScsICgpID0+IHtcbiAgICBleHBlY3QoZXZhbHVhdGVEZWxpdmVyeShjb250ZXh0LCBpbk9yZyh7IHJlc291cmNlQXJuOiAnYXJuOmF3czpzMzo6OmFwaWFibGUtbG9ncy11bm1hbmFnZWQveCcgfSkpKS50b0JlKCdEZW5pZWQnKVxuICB9KVxuXG4gIGl0KCdhbiB1bm1vZGVsbGVkIGNvbmRpdGlvbiBvcGVyYXRvciBvbiBhIERlbnkgZmFpbHMgY2xvc2VkICh0cmVhdGVkIGFzIGRyaWZ0LCB0aGUgcmVxdWVzdCBpcyBkZW5pZWQpJywgKCkgPT4ge1xuICAgIGNvbnN0IHNjcFdpdGhVbmtub3duT3AgPSB7XG4gICAgICBWZXJzaW9uOiAnMjAxMi0xMC0xNycsXG4gICAgICBTdGF0ZW1lbnQ6IFtcbiAgICAgICAge1xuICAgICAgICAgIEVmZmVjdDogJ0RlbnknLFxuICAgICAgICAgIEFjdGlvbjogJ3MzOlB1dE9iamVjdCcsXG4gICAgICAgICAgTm90UmVzb3VyY2U6IFsnYXJuOmF3czpzMzo6OmFwaWFibGUtbG9ncy1wcm9kLyonXSxcbiAgICAgICAgICBDb25kaXRpb246IHsgRGF0ZUdyZWF0ZXJUaGFuOiB7ICdhd3M6Q3VycmVudFRpbWUnOiAnMjAwMC0wMS0wMVQwMDowMDowMFonIH0gfSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfVxuICAgIC8vIEFuIG9wZXJhdG9yIHRoZSBldmFsdWF0b3IgZG9lcyBub3QgbW9kZWwgbXVzdCBub3Qgc2lsZW50bHkgc2tpcCB0aGUgRGVueSDigJQgdGhlIHN0YXRlbWVudCBzdGlsbCBiaXRlcy5cbiAgICBleHBlY3QoZXZhbHVhdGVTY3Aoc2NwV2l0aFVua25vd25PcCwgaW5PcmcoeyByZXNvdXJjZUFybjogRVhGSUxfT0JKIH0pKSkudG9CZSgnRGVueScpXG4gIH0pXG5cbiAgaXQoJ2FuIGVtcHR5IE5vdFJlc291cmNlIG9uIGEgRGVueSBuYW1lcyBldmVyeSByZXNvdXJjZSAoYSBiYXJlIGV4ZmlsLWV2ZXJ5dGhpbmcgRGVueSBiaXRlcyknLCAoKSA9PiB7XG4gICAgLy8gQVdTOiBOb3RSZXNvdXJjZSBbXSBleGNsdWRlcyBub3RoaW5nLCBzbyB0aGUgRGVueSBhcHBsaWVzIHRvIGFsbCByZXNvdXJjZXM7IHRoZSBldmFsdWF0b3IgbXVzdCBub3RcbiAgICAvLyB0cmVhdCB0aGUgZW1wdHkgbGlzdCBhcyBtYXRjaGluZyBub3RoaW5nICh0aGF0IHdvdWxkIGZhaWwgb3BlbiBvbiBhIHJlYWwtYnV0LW1hbGZvcm1lZCBEZW55KS5cbiAgICBjb25zdCBzY3BEZW55QWxsID0ge1xuICAgICAgVmVyc2lvbjogJzIwMTItMTAtMTcnLFxuICAgICAgU3RhdGVtZW50OiBbeyBFZmZlY3Q6ICdEZW55JywgQWN0aW9uOiAnczM6UHV0T2JqZWN0JywgTm90UmVzb3VyY2U6IFtdIH1dLFxuICAgIH1cbiAgICBleHBlY3QoZXZhbHVhdGVTY3Aoc2NwRGVueUFsbCwgaW5PcmcoeyByZXNvdXJjZUFybjogU0FOQ1RJT05FRF9PQkogfSkpKS50b0JlKCdEZW55JylcbiAgfSlcbn0pXG5cbmRlc2NyaWJlKCcwMTMtMS0yNCBndWFyZHJhaWwgb3JhY2xlIOKAlCBpZGVudGl0eSAoY2hhbm5lbCkgcG9saWN5JywgKCkgPT4ge1xuICBpdCgnYSBjaGFubmVsIHJvbGUgd2l0aCBubyBTMyBncmFudCBpcyBub3QgcGVybWl0dGVkIChOb3RBcHBsaWNhYmxlIOKGkiBkZW5pZWQgYnkgdGhlIGNhbGxlciknLCAoKSA9PiB7XG4gICAgZXhwZWN0KGV2YWx1YXRlSWRlbnRpdHlQb2xpY3koeyBWZXJzaW9uOiAnMjAxMi0xMC0xNycsIFN0YXRlbWVudDogW10gfSwgaW5Pcmcoe30pKSkudG9CZSgnTm90QXBwbGljYWJsZScpXG4gIH0pXG5cbiAgaXQoJ2EgY2hhbm5lbCByb2xlIHNjb3BlZCB0byB0aGUgc2FuY3Rpb25lZCBidWNrZXQgcGVybWl0cyB0aGUgc2FuY3Rpb25lZCB3cml0ZScsICgpID0+IHtcbiAgICBjb25zdCBzY29wZWQgPSB7XG4gICAgICBWZXJzaW9uOiAnMjAxMi0xMC0xNycsXG4gICAgICBTdGF0ZW1lbnQ6IFt7IEVmZmVjdDogJ0FsbG93JywgQWN0aW9uOiAnczM6UHV0T2JqZWN0JywgUmVzb3VyY2U6ICdhcm46YXdzOnMzOjo6YXBpYWJsZS1sb2dzLXByb2QvKicgfV0sXG4gICAgfVxuICAgIGV4cGVjdChldmFsdWF0ZUlkZW50aXR5UG9saWN5KHNjb3BlZCwgaW5Pcmcoe30pKSkudG9CZSgnQWxsb3cnKVxuICB9KVxuXG4gIGl0KCdhIHdpZGVuZWQgY2hhbm5lbCByb2xlIChSZXNvdXJjZSBcIipcIikgc3RpbGwgY2Fubm90IGJlYXQgdGhlIFNDUCBmb3IgYW4gb3V0LW9mLWxpc3Qgd3JpdGUnLCAoKSA9PiB7XG4gICAgY29uc3Qgd2lkZW5lZCA9IHsgVmVyc2lvbjogJzIwMTItMTAtMTcnLCBTdGF0ZW1lbnQ6IFt7IEVmZmVjdDogJ0FsbG93JywgQWN0aW9uOiAnczM6UHV0T2JqZWN0JywgUmVzb3VyY2U6ICcqJyB9XSB9XG4gICAgZXhwZWN0KGV2YWx1YXRlRGVsaXZlcnkoeyBzY3A6IFNDUCwgaWRlbnRpdHlQb2xpY3k6IHdpZGVuZWQgfSwgaW5PcmcoeyByZXNvdXJjZUFybjogRVhGSUxfT0JKIH0pKSkudG9CZSgnRGVuaWVkJylcbiAgfSlcbn0pXG4iXX0=