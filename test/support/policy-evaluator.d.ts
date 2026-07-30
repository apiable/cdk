/** A single S3 write attempt the guardrail decides on. */
export interface AccessRequest {
    /** ARN of the principal performing the write (the firehose delivery role). */
    readonly principalArn: string;
    /** The S3 action, e.g. `s3:PutObject`. */
    readonly action: string;
    /** The target object ARN, e.g. `arn:aws:s3:::bucket/key`. */
    readonly resourceArn: string;
    /** The account the call originates from (for `aws:SourceAccount`). */
    readonly sourceAccount?: string;
    /** The Org id of the calling principal (for `aws:PrincipalOrgID`). */
    readonly principalOrgId?: string;
}
export type Decision = 'Allowed' | 'Denied';
/**
 * Evaluate an Organizations SCP against the request. An SCP only ever DENIES or is silent: a `Deny`
 * statement whose action + (NotResource OR Resource) + condition all match the request yields `'Deny'`.
 * Returns `'NotApplicable'` otherwise (the SCP does not by itself permit anything).
 */
export declare const evaluateScp: (scpDoc: unknown, request: AccessRequest) => 'Deny' | 'NotApplicable';
/**
 * Evaluate a resource (bucket) policy against the request. Returns the strongest matching effect:
 * an explicit `'Deny'` wins, else `'Allow'` if a matching Allow exists, else `'NotApplicable'`.
 */
export declare const evaluateResourcePolicy: (policyDoc: unknown, request: AccessRequest) => 'Allow' | 'Deny' | 'NotApplicable';
/**
 * Evaluate an identity (delivery-role) policy — the channel-side hygiene grant — against the request.
 * Same effect lattice as a resource policy, but principals are implicit (the role itself).
 */
export declare const evaluateIdentityPolicy: (policyDoc: unknown, request: AccessRequest) => 'Allow' | 'Deny' | 'NotApplicable';
export interface GuardrailContext {
    /** The authoritative operator-owned Org SCP document. */
    readonly scp: unknown;
    /** The destination bucket's resource policy, keyed by bucket name; absent for an unsanctioned bucket. */
    readonly bucketPolicies?: Readonly<Record<string, unknown>>;
    /** Optional channel-side delivery-role identity policy (Task 4 hygiene); when absent the role is unconstrained. */
    readonly identityPolicy?: unknown;
}
/**
 * The full AWS authorization decision for a firehose delivery write, with deny-overrides across the
 * operator-owned layers + the channel-side identity grant:
 *   1. an explicit Deny in the SCP, the bucket policy, or the identity policy → DENIED (the SCP is the
 *      authoritative layer that denies writing ELSEWHERE; it holds even if the channel widens),
 *   2. otherwise ALLOWED only when the identity policy permits it AND, if the target bucket has a
 *      resource policy, that policy also permits it (cross-account writes need both),
 *   3. otherwise (implicit) DENIED.
 *
 * When `identityPolicy` is omitted the channel role is treated as unconstrained (the worst case a
 * hand-rolled channel can present), so a non-denied write turns on the operator-owned layers alone —
 * which is exactly the property S5 asserts.
 */
export declare const evaluateDelivery: (context: GuardrailContext, request: AccessRequest) => Decision;
