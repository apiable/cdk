"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateDelivery = exports.evaluateIdentityPolicy = exports.evaluateResourcePolicy = exports.evaluateScp = void 0;
/**
 * Local IAM/SCP/bucket-policy evaluator — the oracle for the operator-owned firehose-destination
 * guardrail. It is NOT a live `iam:SimulateCustomPolicy` call: CI has no AWS credentials, and the
 * outcome under test is a deny/allow at the operator-owned policy layer, not a parity `gate()` verdict.
 *
 * It implements the slice of the AWS policy-evaluation logic the guardrail exercises:
 *   - explicit Deny overrides any Allow (deny-overrides),
 *   - default is implicit deny,
 *   - an SCP can only DENY or be not-applicable (it is a permission boundary, never a grant),
 *   - a resource (bucket) policy and an identity (delivery-role) policy each contribute an Allow,
 *   - `aws:PrincipalArn` (StringLike/ArnLike and the negated StringNotLike/ArnNotLike that expresses the
 *     operator carve-out), `aws:SourceAccount`/`aws:PrincipalOrgID` StringEquals are honoured,
 *   - a condition operator the evaluator does not model is drift: it bites on a Deny and never grants an
 *     Allow (fail closed both ways), so a divergent policy cannot slip an unmodelled operator past it.
 *
 * Static IaC-shape assertions in the spec back this simulator-as-oracle so policy-document drift the
 * evaluator would tolerate (a narrowed action set, a dropped condition) is still caught.
 */
const narrow_1 = require("../../lib/parity-gate/narrow");
const toList = (value) => Array.isArray(value) ? value : value === undefined ? [] : [value];
const actionsOf = (statement) => toList(statement.Action).filter((a) => typeof a === 'string');
/** Whether a statement's Action list matches the request action (exact, or a `prefix:*` / `*` glob). */
const actionMatches = (statement, action) => actionsOf(statement).some((pattern) => globMatch(pattern, action));
/** IAM-style glob: `*` matches any run of characters. Anchored both ends. */
const globMatch = (pattern, value) => {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(value);
};
const resourcesOf = (key, statement) => toList(statement[key]).filter((r) => typeof r === 'string');
/** Whether the request resource is named by a statement's `Resource` (any entry globs the resource). */
const resourceMatches = (statement, resourceArn) => resourcesOf('Resource', statement).some((pattern) => globMatch(pattern, resourceArn));
/**
 * Whether the request resource falls OUTSIDE a statement's `NotResource` (none of the entries glob it).
 * An empty NotResource excludes nothing, so the statement names every resource (AWS semantics) — a bare
 * `Deny … NotResource []` denies everything; treating it as matching nothing would silently fail open.
 */
const notResourceMatches = (statement, resourceArn) => {
    const notResources = resourcesOf('NotResource', statement);
    if (notResources.length === 0)
        return true;
    return !notResources.some((pattern) => globMatch(pattern, resourceArn));
};
const conditionSatisfied = (statement, request) => {
    const condition = statement.Condition;
    if (condition === undefined)
        return 'satisfied';
    const block = (0, narrow_1.asRecord)(condition);
    for (const [operator, operandsUnknown] of Object.entries(block)) {
        const operands = (0, narrow_1.asRecord)(operandsUnknown);
        for (const [key, expectedUnknown] of Object.entries(operands)) {
            const expected = toList(expectedUnknown).map((v) => (0, narrow_1.asString)(v) ?? '');
            const actual = contextValue(key, request);
            if (operator === 'StringEquals') {
                if (actual === undefined || !expected.includes(actual))
                    return 'unsatisfied';
            }
            else if (operator === 'StringNotEquals') {
                if (actual !== undefined && expected.includes(actual))
                    return 'unsatisfied';
            }
            else if (operator === 'ArnLike' || operator === 'StringLike') {
                if (actual === undefined || !expected.some((pattern) => globMatch(pattern, actual)))
                    return 'unsatisfied';
            }
            else if (operator === 'ArnNotLike' || operator === 'StringNotLike') {
                if (actual !== undefined && expected.some((pattern) => globMatch(pattern, actual)))
                    return 'unsatisfied';
            }
            else {
                return 'unknown';
            }
        }
    }
    return 'satisfied';
};
const contextValue = (key, request) => {
    switch (key) {
        case 'aws:PrincipalArn':
            return request.principalArn;
        case 'aws:SourceAccount':
            return request.sourceAccount;
        case 'aws:PrincipalOrgID':
            return request.principalOrgId;
        default:
            return undefined;
    }
};
/** Whether a statement's `Principal` names the request principal (an `{AWS: [...]}` list, a string, or `*`). */
const principalMatches = (statement, principalArn) => {
    const principal = statement.Principal;
    if (principal === '*')
        return true;
    const aws = toList((0, narrow_1.asRecord)(principal).AWS).filter((p) => typeof p === 'string');
    return aws.some((entry) => entry === '*' || globMatch(entry, principalArn));
};
const statementsOf = (policyDoc) => (0, narrow_1.asArray)((0, narrow_1.asRecord)(policyDoc).Statement).map(narrow_1.asRecord);
const effectOf = (statement) => (0, narrow_1.asString)(statement.Effect) === 'Deny' ? 'Deny' : 'Allow';
/**
 * Evaluate an Organizations SCP against the request. An SCP only ever DENIES or is silent: a `Deny`
 * statement whose action + (NotResource OR Resource) + condition all match the request yields `'Deny'`.
 * Returns `'NotApplicable'` otherwise (the SCP does not by itself permit anything).
 */
const evaluateScp = (scpDoc, request) => {
    for (const statement of statementsOf(scpDoc)) {
        if (effectOf(statement) !== 'Deny')
            continue;
        if (!actionMatches(statement, request.action))
            continue;
        // Only a definitively-unsatisfied condition lets the Deny pass; an unmodelled operator (drift) bites.
        if (conditionSatisfied(statement, request) === 'unsatisfied')
            continue;
        const denied = notResourceMatches(statement, request.resourceArn) || resourceMatches(statement, request.resourceArn);
        if (denied)
            return 'Deny';
    }
    return 'NotApplicable';
};
exports.evaluateScp = evaluateScp;
/**
 * Evaluate a resource (bucket) policy against the request. Returns the strongest matching effect:
 * an explicit `'Deny'` wins, else `'Allow'` if a matching Allow exists, else `'NotApplicable'`.
 */
const evaluateResourcePolicy = (policyDoc, request) => {
    let allowed = false;
    for (const statement of statementsOf(policyDoc)) {
        if (!actionMatches(statement, request.action))
            continue;
        if (!resourceMatches(statement, request.resourceArn))
            continue;
        if (!principalMatches(statement, request.principalArn))
            continue;
        const condition = conditionSatisfied(statement, request);
        if (condition === 'unsatisfied')
            continue;
        if (effectOf(statement) === 'Deny')
            return 'Deny'; // a Deny bites on satisfied OR drift (fail closed)
        if (condition === 'satisfied')
            allowed = true; // an Allow grants only when fully satisfied — never on drift
    }
    return allowed ? 'Allow' : 'NotApplicable';
};
exports.evaluateResourcePolicy = evaluateResourcePolicy;
/**
 * Evaluate an identity (delivery-role) policy — the channel-side hygiene grant — against the request.
 * Same effect lattice as a resource policy, but principals are implicit (the role itself).
 */
const evaluateIdentityPolicy = (policyDoc, request) => {
    let allowed = false;
    for (const statement of statementsOf(policyDoc)) {
        if (!actionMatches(statement, request.action))
            continue;
        if (!resourceMatches(statement, request.resourceArn))
            continue;
        const condition = conditionSatisfied(statement, request);
        if (condition === 'unsatisfied')
            continue;
        if (effectOf(statement) === 'Deny')
            return 'Deny'; // a Deny bites on satisfied OR drift (fail closed)
        if (condition === 'satisfied')
            allowed = true; // an Allow grants only when fully satisfied — never on drift
    }
    return allowed ? 'Allow' : 'NotApplicable';
};
exports.evaluateIdentityPolicy = evaluateIdentityPolicy;
/** The bucket name embedded in an S3 object ARN (`arn:aws:s3:::bucket/key`). */
const bucketOf = (resourceArn) => resourceArn.replace(/^arn:aws:s3:::/, '').split('/')[0];
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
const evaluateDelivery = (context, request) => {
    if ((0, exports.evaluateScp)(context.scp, request) === 'Deny')
        return 'Denied';
    if (context.identityPolicy !== undefined) {
        const identity = (0, exports.evaluateIdentityPolicy)(context.identityPolicy, request);
        if (identity === 'Deny')
            return 'Denied';
        if (identity === 'NotApplicable')
            return 'Denied';
    }
    const bucket = bucketOf(request.resourceArn);
    const bucketPolicy = context.bucketPolicies?.[bucket];
    if (bucketPolicy !== undefined) {
        const resource = (0, exports.evaluateResourcePolicy)(bucketPolicy, request);
        if (resource === 'Deny')
            return 'Denied';
        if (resource === 'NotApplicable')
            return 'Denied';
    }
    return 'Allowed';
};
exports.evaluateDelivery = evaluateDelivery;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicG9saWN5LWV2YWx1YXRvci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInBvbGljeS1ldmFsdWF0b3IudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBaUJHO0FBQ0gseURBQTBFO0FBa0IxRSxNQUFNLE1BQU0sR0FBRyxDQUFDLEtBQWMsRUFBc0IsRUFBRSxDQUNwRCxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQTtBQUVuRSxNQUFNLFNBQVMsR0FBRyxDQUFDLFNBQWtDLEVBQVksRUFBRSxDQUNqRSxNQUFNLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBZSxFQUFFLENBQUMsT0FBTyxDQUFDLEtBQUssUUFBUSxDQUFDLENBQUE7QUFFNUUsd0dBQXdHO0FBQ3hHLE1BQU0sYUFBYSxHQUFHLENBQUMsU0FBa0MsRUFBRSxNQUFjLEVBQVcsRUFBRSxDQUNwRixTQUFTLENBQUMsU0FBUyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxTQUFTLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUE7QUFFcEUsNkVBQTZFO0FBQzdFLE1BQU0sU0FBUyxHQUFHLENBQUMsT0FBZSxFQUFFLEtBQWEsRUFBVyxFQUFFO0lBQzVELE1BQU0sT0FBTyxHQUFHLE9BQU8sQ0FBQyxPQUFPLENBQUMsb0JBQW9CLEVBQUUsTUFBTSxDQUFDLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxJQUFJLENBQUMsQ0FBQTtJQUNsRixPQUFPLElBQUksTUFBTSxDQUFDLElBQUksT0FBTyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUE7QUFDL0MsQ0FBQyxDQUFBO0FBRUQsTUFBTSxXQUFXLEdBQUcsQ0FBQyxHQUErQixFQUFFLFNBQWtDLEVBQVksRUFBRSxDQUNwRyxNQUFNLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFlLEVBQUUsQ0FBQyxPQUFPLENBQUMsS0FBSyxRQUFRLENBQUMsQ0FBQTtBQUUxRSx3R0FBd0c7QUFDeEcsTUFBTSxlQUFlLEdBQUcsQ0FBQyxTQUFrQyxFQUFFLFdBQW1CLEVBQVcsRUFBRSxDQUMzRixXQUFXLENBQUMsVUFBVSxFQUFFLFNBQVMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsU0FBUyxDQUFDLE9BQU8sRUFBRSxXQUFXLENBQUMsQ0FBQyxDQUFBO0FBRXZGOzs7O0dBSUc7QUFDSCxNQUFNLGtCQUFrQixHQUFHLENBQUMsU0FBa0MsRUFBRSxXQUFtQixFQUFXLEVBQUU7SUFDOUYsTUFBTSxZQUFZLEdBQUcsV0FBVyxDQUFDLGFBQWEsRUFBRSxTQUFTLENBQUMsQ0FBQTtJQUMxRCxJQUFJLFlBQVksQ0FBQyxNQUFNLEtBQUssQ0FBQztRQUFFLE9BQU8sSUFBSSxDQUFBO0lBQzFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxTQUFTLENBQUMsT0FBTyxFQUFFLFdBQVcsQ0FBQyxDQUFDLENBQUE7QUFDekUsQ0FBQyxDQUFBO0FBYUQsTUFBTSxrQkFBa0IsR0FBRyxDQUFDLFNBQWtDLEVBQUUsT0FBc0IsRUFBbUIsRUFBRTtJQUN6RyxNQUFNLFNBQVMsR0FBRyxTQUFTLENBQUMsU0FBUyxDQUFBO0lBQ3JDLElBQUksU0FBUyxLQUFLLFNBQVM7UUFBRSxPQUFPLFdBQVcsQ0FBQTtJQUMvQyxNQUFNLEtBQUssR0FBRyxJQUFBLGlCQUFRLEVBQUMsU0FBUyxDQUFDLENBQUE7SUFDakMsS0FBSyxNQUFNLENBQUMsUUFBUSxFQUFFLGVBQWUsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUNoRSxNQUFNLFFBQVEsR0FBRyxJQUFBLGlCQUFRLEVBQUMsZUFBZSxDQUFDLENBQUE7UUFDMUMsS0FBSyxNQUFNLENBQUMsR0FBRyxFQUFFLGVBQWUsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQztZQUM5RCxNQUFNLFFBQVEsR0FBRyxNQUFNLENBQUMsZUFBZSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxJQUFBLGlCQUFRLEVBQUMsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUE7WUFDdEUsTUFBTSxNQUFNLEdBQUcsWUFBWSxDQUFDLEdBQUcsRUFBRSxPQUFPLENBQUMsQ0FBQTtZQUN6QyxJQUFJLFFBQVEsS0FBSyxjQUFjLEVBQUUsQ0FBQztnQkFDaEMsSUFBSSxNQUFNLEtBQUssU0FBUyxJQUFJLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUM7b0JBQUUsT0FBTyxhQUFhLENBQUE7WUFDOUUsQ0FBQztpQkFBTSxJQUFJLFFBQVEsS0FBSyxpQkFBaUIsRUFBRSxDQUFDO2dCQUMxQyxJQUFJLE1BQU0sS0FBSyxTQUFTLElBQUksUUFBUSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUM7b0JBQUUsT0FBTyxhQUFhLENBQUE7WUFDN0UsQ0FBQztpQkFBTSxJQUFJLFFBQVEsS0FBSyxTQUFTLElBQUksUUFBUSxLQUFLLFlBQVksRUFBRSxDQUFDO2dCQUMvRCxJQUFJLE1BQU0sS0FBSyxTQUFTLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxTQUFTLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFDO29CQUFFLE9BQU8sYUFBYSxDQUFBO1lBQzNHLENBQUM7aUJBQU0sSUFBSSxRQUFRLEtBQUssWUFBWSxJQUFJLFFBQVEsS0FBSyxlQUFlLEVBQUUsQ0FBQztnQkFDckUsSUFBSSxNQUFNLEtBQUssU0FBUyxJQUFJLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLFNBQVMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQUM7b0JBQUUsT0FBTyxhQUFhLENBQUE7WUFDMUcsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLE9BQU8sU0FBUyxDQUFBO1lBQ2xCLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUNELE9BQU8sV0FBVyxDQUFBO0FBQ3BCLENBQUMsQ0FBQTtBQUVELE1BQU0sWUFBWSxHQUFHLENBQUMsR0FBVyxFQUFFLE9BQXNCLEVBQXNCLEVBQUU7SUFDL0UsUUFBUSxHQUFHLEVBQUUsQ0FBQztRQUNaLEtBQUssa0JBQWtCO1lBQ3JCLE9BQU8sT0FBTyxDQUFDLFlBQVksQ0FBQTtRQUM3QixLQUFLLG1CQUFtQjtZQUN0QixPQUFPLE9BQU8sQ0FBQyxhQUFhLENBQUE7UUFDOUIsS0FBSyxvQkFBb0I7WUFDdkIsT0FBTyxPQUFPLENBQUMsY0FBYyxDQUFBO1FBQy9CO1lBQ0UsT0FBTyxTQUFTLENBQUE7SUFDcEIsQ0FBQztBQUNILENBQUMsQ0FBQTtBQUVELGdIQUFnSDtBQUNoSCxNQUFNLGdCQUFnQixHQUFHLENBQUMsU0FBa0MsRUFBRSxZQUFvQixFQUFXLEVBQUU7SUFDN0YsTUFBTSxTQUFTLEdBQUcsU0FBUyxDQUFDLFNBQVMsQ0FBQTtJQUNyQyxJQUFJLFNBQVMsS0FBSyxHQUFHO1FBQUUsT0FBTyxJQUFJLENBQUE7SUFDbEMsTUFBTSxHQUFHLEdBQUcsTUFBTSxDQUFDLElBQUEsaUJBQVEsRUFBQyxTQUFTLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQWUsRUFBRSxDQUFDLE9BQU8sQ0FBQyxLQUFLLFFBQVEsQ0FBQyxDQUFBO0lBQzdGLE9BQU8sR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsS0FBSyxLQUFLLEdBQUcsSUFBSSxTQUFTLENBQUMsS0FBSyxFQUFFLFlBQVksQ0FBQyxDQUFDLENBQUE7QUFDN0UsQ0FBQyxDQUFBO0FBRUQsTUFBTSxZQUFZLEdBQUcsQ0FBQyxTQUFrQixFQUE2QixFQUFFLENBQ3JFLElBQUEsZ0JBQU8sRUFBQyxJQUFBLGlCQUFRLEVBQUMsU0FBUyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsR0FBRyxDQUFDLGlCQUFRLENBQUMsQ0FBQTtBQUV0RCxNQUFNLFFBQVEsR0FBRyxDQUFDLFNBQWtDLEVBQW9CLEVBQUUsQ0FDeEUsSUFBQSxpQkFBUSxFQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsS0FBSyxNQUFNLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFBO0FBRTFEOzs7O0dBSUc7QUFDSSxNQUFNLFdBQVcsR0FBRyxDQUFDLE1BQWUsRUFBRSxPQUFzQixFQUE0QixFQUFFO0lBQy9GLEtBQUssTUFBTSxTQUFTLElBQUksWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7UUFDN0MsSUFBSSxRQUFRLENBQUMsU0FBUyxDQUFDLEtBQUssTUFBTTtZQUFFLFNBQVE7UUFDNUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxTQUFTLEVBQUUsT0FBTyxDQUFDLE1BQU0sQ0FBQztZQUFFLFNBQVE7UUFDdkQsc0dBQXNHO1FBQ3RHLElBQUksa0JBQWtCLENBQUMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxLQUFLLGFBQWE7WUFBRSxTQUFRO1FBQ3RFLE1BQU0sTUFBTSxHQUNWLGtCQUFrQixDQUFDLFNBQVMsRUFBRSxPQUFPLENBQUMsV0FBVyxDQUFDLElBQUksZUFBZSxDQUFDLFNBQVMsRUFBRSxPQUFPLENBQUMsV0FBVyxDQUFDLENBQUE7UUFDdkcsSUFBSSxNQUFNO1lBQUUsT0FBTyxNQUFNLENBQUE7SUFDM0IsQ0FBQztJQUNELE9BQU8sZUFBZSxDQUFBO0FBQ3hCLENBQUMsQ0FBQTtBQVhZLFFBQUEsV0FBVyxlQVd2QjtBQUVEOzs7R0FHRztBQUNJLE1BQU0sc0JBQXNCLEdBQUcsQ0FDcEMsU0FBa0IsRUFDbEIsT0FBc0IsRUFDYyxFQUFFO0lBQ3RDLElBQUksT0FBTyxHQUFHLEtBQUssQ0FBQTtJQUNuQixLQUFLLE1BQU0sU0FBUyxJQUFJLFlBQVksQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1FBQ2hELElBQUksQ0FBQyxhQUFhLENBQUMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxNQUFNLENBQUM7WUFBRSxTQUFRO1FBQ3ZELElBQUksQ0FBQyxlQUFlLENBQUMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxXQUFXLENBQUM7WUFBRSxTQUFRO1FBQzlELElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxTQUFTLEVBQUUsT0FBTyxDQUFDLFlBQVksQ0FBQztZQUFFLFNBQVE7UUFDaEUsTUFBTSxTQUFTLEdBQUcsa0JBQWtCLENBQUMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQ3hELElBQUksU0FBUyxLQUFLLGFBQWE7WUFBRSxTQUFRO1FBQ3pDLElBQUksUUFBUSxDQUFDLFNBQVMsQ0FBQyxLQUFLLE1BQU07WUFBRSxPQUFPLE1BQU0sQ0FBQSxDQUFDLG1EQUFtRDtRQUNyRyxJQUFJLFNBQVMsS0FBSyxXQUFXO1lBQUUsT0FBTyxHQUFHLElBQUksQ0FBQSxDQUFDLDZEQUE2RDtJQUM3RyxDQUFDO0lBQ0QsT0FBTyxPQUFPLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsZUFBZSxDQUFBO0FBQzVDLENBQUMsQ0FBQTtBQWZZLFFBQUEsc0JBQXNCLDBCQWVsQztBQUVEOzs7R0FHRztBQUNJLE1BQU0sc0JBQXNCLEdBQUcsQ0FDcEMsU0FBa0IsRUFDbEIsT0FBc0IsRUFDYyxFQUFFO0lBQ3RDLElBQUksT0FBTyxHQUFHLEtBQUssQ0FBQTtJQUNuQixLQUFLLE1BQU0sU0FBUyxJQUFJLFlBQVksQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1FBQ2hELElBQUksQ0FBQyxhQUFhLENBQUMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxNQUFNLENBQUM7WUFBRSxTQUFRO1FBQ3ZELElBQUksQ0FBQyxlQUFlLENBQUMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxXQUFXLENBQUM7WUFBRSxTQUFRO1FBQzlELE1BQU0sU0FBUyxHQUFHLGtCQUFrQixDQUFDLFNBQVMsRUFBRSxPQUFPLENBQUMsQ0FBQTtRQUN4RCxJQUFJLFNBQVMsS0FBSyxhQUFhO1lBQUUsU0FBUTtRQUN6QyxJQUFJLFFBQVEsQ0FBQyxTQUFTLENBQUMsS0FBSyxNQUFNO1lBQUUsT0FBTyxNQUFNLENBQUEsQ0FBQyxtREFBbUQ7UUFDckcsSUFBSSxTQUFTLEtBQUssV0FBVztZQUFFLE9BQU8sR0FBRyxJQUFJLENBQUEsQ0FBQyw2REFBNkQ7SUFDN0csQ0FBQztJQUNELE9BQU8sT0FBTyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQTtBQUM1QyxDQUFDLENBQUE7QUFkWSxRQUFBLHNCQUFzQiwwQkFjbEM7QUFXRCxnRkFBZ0Y7QUFDaEYsTUFBTSxRQUFRLEdBQUcsQ0FBQyxXQUFtQixFQUFVLEVBQUUsQ0FBQyxXQUFXLENBQUMsT0FBTyxDQUFDLGdCQUFnQixFQUFFLEVBQUUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtBQUV6Rzs7Ozs7Ozs7Ozs7O0dBWUc7QUFDSSxNQUFNLGdCQUFnQixHQUFHLENBQUMsT0FBeUIsRUFBRSxPQUFzQixFQUFZLEVBQUU7SUFDOUYsSUFBSSxJQUFBLG1CQUFXLEVBQUMsT0FBTyxDQUFDLEdBQUcsRUFBRSxPQUFPLENBQUMsS0FBSyxNQUFNO1FBQUUsT0FBTyxRQUFRLENBQUE7SUFFakUsSUFBSSxPQUFPLENBQUMsY0FBYyxLQUFLLFNBQVMsRUFBRSxDQUFDO1FBQ3pDLE1BQU0sUUFBUSxHQUFHLElBQUEsOEJBQXNCLEVBQUMsT0FBTyxDQUFDLGNBQWMsRUFBRSxPQUFPLENBQUMsQ0FBQTtRQUN4RSxJQUFJLFFBQVEsS0FBSyxNQUFNO1lBQUUsT0FBTyxRQUFRLENBQUE7UUFDeEMsSUFBSSxRQUFRLEtBQUssZUFBZTtZQUFFLE9BQU8sUUFBUSxDQUFBO0lBQ25ELENBQUM7SUFFRCxNQUFNLE1BQU0sR0FBRyxRQUFRLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxDQUFBO0lBQzVDLE1BQU0sWUFBWSxHQUFHLE9BQU8sQ0FBQyxjQUFjLEVBQUUsQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUNyRCxJQUFJLFlBQVksS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUMvQixNQUFNLFFBQVEsR0FBRyxJQUFBLDhCQUFzQixFQUFDLFlBQVksRUFBRSxPQUFPLENBQUMsQ0FBQTtRQUM5RCxJQUFJLFFBQVEsS0FBSyxNQUFNO1lBQUUsT0FBTyxRQUFRLENBQUE7UUFDeEMsSUFBSSxRQUFRLEtBQUssZUFBZTtZQUFFLE9BQU8sUUFBUSxDQUFBO0lBQ25ELENBQUM7SUFFRCxPQUFPLFNBQVMsQ0FBQTtBQUNsQixDQUFDLENBQUE7QUFsQlksUUFBQSxnQkFBZ0Isb0JBa0I1QiIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogTG9jYWwgSUFNL1NDUC9idWNrZXQtcG9saWN5IGV2YWx1YXRvciDigJQgdGhlIG9yYWNsZSBmb3IgdGhlIG9wZXJhdG9yLW93bmVkIGZpcmVob3NlLWRlc3RpbmF0aW9uXG4gKiBndWFyZHJhaWwuIEl0IGlzIE5PVCBhIGxpdmUgYGlhbTpTaW11bGF0ZUN1c3RvbVBvbGljeWAgY2FsbDogQ0kgaGFzIG5vIEFXUyBjcmVkZW50aWFscywgYW5kIHRoZVxuICogb3V0Y29tZSB1bmRlciB0ZXN0IGlzIGEgZGVueS9hbGxvdyBhdCB0aGUgb3BlcmF0b3Itb3duZWQgcG9saWN5IGxheWVyLCBub3QgYSBwYXJpdHkgYGdhdGUoKWAgdmVyZGljdC5cbiAqXG4gKiBJdCBpbXBsZW1lbnRzIHRoZSBzbGljZSBvZiB0aGUgQVdTIHBvbGljeS1ldmFsdWF0aW9uIGxvZ2ljIHRoZSBndWFyZHJhaWwgZXhlcmNpc2VzOlxuICogICAtIGV4cGxpY2l0IERlbnkgb3ZlcnJpZGVzIGFueSBBbGxvdyAoZGVueS1vdmVycmlkZXMpLFxuICogICAtIGRlZmF1bHQgaXMgaW1wbGljaXQgZGVueSxcbiAqICAgLSBhbiBTQ1AgY2FuIG9ubHkgREVOWSBvciBiZSBub3QtYXBwbGljYWJsZSAoaXQgaXMgYSBwZXJtaXNzaW9uIGJvdW5kYXJ5LCBuZXZlciBhIGdyYW50KSxcbiAqICAgLSBhIHJlc291cmNlIChidWNrZXQpIHBvbGljeSBhbmQgYW4gaWRlbnRpdHkgKGRlbGl2ZXJ5LXJvbGUpIHBvbGljeSBlYWNoIGNvbnRyaWJ1dGUgYW4gQWxsb3csXG4gKiAgIC0gYGF3czpQcmluY2lwYWxBcm5gIChTdHJpbmdMaWtlL0Fybkxpa2UgYW5kIHRoZSBuZWdhdGVkIFN0cmluZ05vdExpa2UvQXJuTm90TGlrZSB0aGF0IGV4cHJlc3NlcyB0aGVcbiAqICAgICBvcGVyYXRvciBjYXJ2ZS1vdXQpLCBgYXdzOlNvdXJjZUFjY291bnRgL2Bhd3M6UHJpbmNpcGFsT3JnSURgIFN0cmluZ0VxdWFscyBhcmUgaG9ub3VyZWQsXG4gKiAgIC0gYSBjb25kaXRpb24gb3BlcmF0b3IgdGhlIGV2YWx1YXRvciBkb2VzIG5vdCBtb2RlbCBpcyBkcmlmdDogaXQgYml0ZXMgb24gYSBEZW55IGFuZCBuZXZlciBncmFudHMgYW5cbiAqICAgICBBbGxvdyAoZmFpbCBjbG9zZWQgYm90aCB3YXlzKSwgc28gYSBkaXZlcmdlbnQgcG9saWN5IGNhbm5vdCBzbGlwIGFuIHVubW9kZWxsZWQgb3BlcmF0b3IgcGFzdCBpdC5cbiAqXG4gKiBTdGF0aWMgSWFDLXNoYXBlIGFzc2VydGlvbnMgaW4gdGhlIHNwZWMgYmFjayB0aGlzIHNpbXVsYXRvci1hcy1vcmFjbGUgc28gcG9saWN5LWRvY3VtZW50IGRyaWZ0IHRoZVxuICogZXZhbHVhdG9yIHdvdWxkIHRvbGVyYXRlIChhIG5hcnJvd2VkIGFjdGlvbiBzZXQsIGEgZHJvcHBlZCBjb25kaXRpb24pIGlzIHN0aWxsIGNhdWdodC5cbiAqL1xuaW1wb3J0IHsgYXNBcnJheSwgYXNSZWNvcmQsIGFzU3RyaW5nIH0gZnJvbSAnLi4vLi4vbGliL3Bhcml0eS1nYXRlL25hcnJvdydcblxuLyoqIEEgc2luZ2xlIFMzIHdyaXRlIGF0dGVtcHQgdGhlIGd1YXJkcmFpbCBkZWNpZGVzIG9uLiAqL1xuZXhwb3J0IGludGVyZmFjZSBBY2Nlc3NSZXF1ZXN0IHtcbiAgLyoqIEFSTiBvZiB0aGUgcHJpbmNpcGFsIHBlcmZvcm1pbmcgdGhlIHdyaXRlICh0aGUgZmlyZWhvc2UgZGVsaXZlcnkgcm9sZSkuICovXG4gIHJlYWRvbmx5IHByaW5jaXBhbEFybjogc3RyaW5nXG4gIC8qKiBUaGUgUzMgYWN0aW9uLCBlLmcuIGBzMzpQdXRPYmplY3RgLiAqL1xuICByZWFkb25seSBhY3Rpb246IHN0cmluZ1xuICAvKiogVGhlIHRhcmdldCBvYmplY3QgQVJOLCBlLmcuIGBhcm46YXdzOnMzOjo6YnVja2V0L2tleWAuICovXG4gIHJlYWRvbmx5IHJlc291cmNlQXJuOiBzdHJpbmdcbiAgLyoqIFRoZSBhY2NvdW50IHRoZSBjYWxsIG9yaWdpbmF0ZXMgZnJvbSAoZm9yIGBhd3M6U291cmNlQWNjb3VudGApLiAqL1xuICByZWFkb25seSBzb3VyY2VBY2NvdW50Pzogc3RyaW5nXG4gIC8qKiBUaGUgT3JnIGlkIG9mIHRoZSBjYWxsaW5nIHByaW5jaXBhbCAoZm9yIGBhd3M6UHJpbmNpcGFsT3JnSURgKS4gKi9cbiAgcmVhZG9ubHkgcHJpbmNpcGFsT3JnSWQ/OiBzdHJpbmdcbn1cblxuZXhwb3J0IHR5cGUgRGVjaXNpb24gPSAnQWxsb3dlZCcgfCAnRGVuaWVkJ1xuXG5jb25zdCB0b0xpc3QgPSAodmFsdWU6IHVua25vd24pOiByZWFkb25seSB1bmtub3duW10gPT5cbiAgQXJyYXkuaXNBcnJheSh2YWx1ZSkgPyB2YWx1ZSA6IHZhbHVlID09PSB1bmRlZmluZWQgPyBbXSA6IFt2YWx1ZV1cblxuY29uc3QgYWN0aW9uc09mID0gKHN0YXRlbWVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBzdHJpbmdbXSA9PlxuICB0b0xpc3Qoc3RhdGVtZW50LkFjdGlvbikuZmlsdGVyKChhKTogYSBpcyBzdHJpbmcgPT4gdHlwZW9mIGEgPT09ICdzdHJpbmcnKVxuXG4vKiogV2hldGhlciBhIHN0YXRlbWVudCdzIEFjdGlvbiBsaXN0IG1hdGNoZXMgdGhlIHJlcXVlc3QgYWN0aW9uIChleGFjdCwgb3IgYSBgcHJlZml4OipgIC8gYCpgIGdsb2IpLiAqL1xuY29uc3QgYWN0aW9uTWF0Y2hlcyA9IChzdGF0ZW1lbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBhY3Rpb246IHN0cmluZyk6IGJvb2xlYW4gPT5cbiAgYWN0aW9uc09mKHN0YXRlbWVudCkuc29tZSgocGF0dGVybikgPT4gZ2xvYk1hdGNoKHBhdHRlcm4sIGFjdGlvbikpXG5cbi8qKiBJQU0tc3R5bGUgZ2xvYjogYCpgIG1hdGNoZXMgYW55IHJ1biBvZiBjaGFyYWN0ZXJzLiBBbmNob3JlZCBib3RoIGVuZHMuICovXG5jb25zdCBnbG9iTWF0Y2ggPSAocGF0dGVybjogc3RyaW5nLCB2YWx1ZTogc3RyaW5nKTogYm9vbGVhbiA9PiB7XG4gIGNvbnN0IGVzY2FwZWQgPSBwYXR0ZXJuLnJlcGxhY2UoL1suKz9eJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKS5yZXBsYWNlKC9cXCovZywgJy4qJylcbiAgcmV0dXJuIG5ldyBSZWdFeHAoYF4ke2VzY2FwZWR9JGApLnRlc3QodmFsdWUpXG59XG5cbmNvbnN0IHJlc291cmNlc09mID0gKGtleTogJ1Jlc291cmNlJyB8ICdOb3RSZXNvdXJjZScsIHN0YXRlbWVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBzdHJpbmdbXSA9PlxuICB0b0xpc3Qoc3RhdGVtZW50W2tleV0pLmZpbHRlcigocik6IHIgaXMgc3RyaW5nID0+IHR5cGVvZiByID09PSAnc3RyaW5nJylcblxuLyoqIFdoZXRoZXIgdGhlIHJlcXVlc3QgcmVzb3VyY2UgaXMgbmFtZWQgYnkgYSBzdGF0ZW1lbnQncyBgUmVzb3VyY2VgIChhbnkgZW50cnkgZ2xvYnMgdGhlIHJlc291cmNlKS4gKi9cbmNvbnN0IHJlc291cmNlTWF0Y2hlcyA9IChzdGF0ZW1lbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCByZXNvdXJjZUFybjogc3RyaW5nKTogYm9vbGVhbiA9PlxuICByZXNvdXJjZXNPZignUmVzb3VyY2UnLCBzdGF0ZW1lbnQpLnNvbWUoKHBhdHRlcm4pID0+IGdsb2JNYXRjaChwYXR0ZXJuLCByZXNvdXJjZUFybikpXG5cbi8qKlxuICogV2hldGhlciB0aGUgcmVxdWVzdCByZXNvdXJjZSBmYWxscyBPVVRTSURFIGEgc3RhdGVtZW50J3MgYE5vdFJlc291cmNlYCAobm9uZSBvZiB0aGUgZW50cmllcyBnbG9iIGl0KS5cbiAqIEFuIGVtcHR5IE5vdFJlc291cmNlIGV4Y2x1ZGVzIG5vdGhpbmcsIHNvIHRoZSBzdGF0ZW1lbnQgbmFtZXMgZXZlcnkgcmVzb3VyY2UgKEFXUyBzZW1hbnRpY3MpIOKAlCBhIGJhcmVcbiAqIGBEZW55IOKApiBOb3RSZXNvdXJjZSBbXWAgZGVuaWVzIGV2ZXJ5dGhpbmc7IHRyZWF0aW5nIGl0IGFzIG1hdGNoaW5nIG5vdGhpbmcgd291bGQgc2lsZW50bHkgZmFpbCBvcGVuLlxuICovXG5jb25zdCBub3RSZXNvdXJjZU1hdGNoZXMgPSAoc3RhdGVtZW50OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgcmVzb3VyY2VBcm46IHN0cmluZyk6IGJvb2xlYW4gPT4ge1xuICBjb25zdCBub3RSZXNvdXJjZXMgPSByZXNvdXJjZXNPZignTm90UmVzb3VyY2UnLCBzdGF0ZW1lbnQpXG4gIGlmIChub3RSZXNvdXJjZXMubGVuZ3RoID09PSAwKSByZXR1cm4gdHJ1ZVxuICByZXR1cm4gIW5vdFJlc291cmNlcy5zb21lKChwYXR0ZXJuKSA9PiBnbG9iTWF0Y2gocGF0dGVybiwgcmVzb3VyY2VBcm4pKVxufVxuXG4vKipcbiAqIFRyaS1zdGF0ZSBldmFsdWF0aW9uIG9mIGEgc3RhdGVtZW50J3MgYENvbmRpdGlvbmAgYmxvY2s6XG4gKiAgIC0gYCdzYXRpc2ZpZWQnYCAgIOKAlCBldmVyeSBvcGVyYXRvci9rZXkgbWF0Y2hlZCAob3IgdGhlcmUgaXMgbm8gY29uZGl0aW9uKSxcbiAqICAgLSBgJ3Vuc2F0aXNmaWVkJ2Ag4oCUIGEgbW9kZWxsZWQgb3BlcmF0b3IncyB0ZXN0IGZhaWxlZCAodGhlIHByaW5jaXBhbC9hY2NvdW50L29yZyBkaWQgbm90IG1hdGNoKSxcbiAqICAgLSBgJ3Vua25vd24nYCAgICAg4oCUIGFuIG9wZXJhdG9yIHRoZSBldmFsdWF0b3IgZG9lcyBub3QgbW9kZWwgYXBwZWFyZWQgKHBvbGljeSBkcmlmdCkuXG4gKiBUaGUgY2FsbGVyIHJlc29sdmVzIGAndW5rbm93bidgIHBlciBlZmZlY3Q6IG9uIGEgRGVueSBpdCBiaXRlcyAoZmFpbCBjbG9zZWQpLCBvbiBhbiBBbGxvdyBpdCBkb2VzIG5vdFxuICogZ3JhbnQgKGFsc28gZmFpbCBjbG9zZWQpLiBDb2xsYXBzaW5nIGAndW5rbm93bidgIGludG8gYCd1bnNhdGlzZmllZCdgIGhlcmUgd291bGQgbGV0IGEgZHJpZnRlZCBEZW55IGJlXG4gKiBza2lwcGVkIOKAlCB0aGUgZXhhY3QgZmFpbC1vcGVuIHRoaXMgZGlzdGluY3Rpb24gZXhpc3RzIHRvIHByZXZlbnQuXG4gKi9cbnR5cGUgQ29uZGl0aW9uUmVzdWx0ID0gJ3NhdGlzZmllZCcgfCAndW5zYXRpc2ZpZWQnIHwgJ3Vua25vd24nXG5cbmNvbnN0IGNvbmRpdGlvblNhdGlzZmllZCA9IChzdGF0ZW1lbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCByZXF1ZXN0OiBBY2Nlc3NSZXF1ZXN0KTogQ29uZGl0aW9uUmVzdWx0ID0+IHtcbiAgY29uc3QgY29uZGl0aW9uID0gc3RhdGVtZW50LkNvbmRpdGlvblxuICBpZiAoY29uZGl0aW9uID09PSB1bmRlZmluZWQpIHJldHVybiAnc2F0aXNmaWVkJ1xuICBjb25zdCBibG9jayA9IGFzUmVjb3JkKGNvbmRpdGlvbilcbiAgZm9yIChjb25zdCBbb3BlcmF0b3IsIG9wZXJhbmRzVW5rbm93bl0gb2YgT2JqZWN0LmVudHJpZXMoYmxvY2spKSB7XG4gICAgY29uc3Qgb3BlcmFuZHMgPSBhc1JlY29yZChvcGVyYW5kc1Vua25vd24pXG4gICAgZm9yIChjb25zdCBba2V5LCBleHBlY3RlZFVua25vd25dIG9mIE9iamVjdC5lbnRyaWVzKG9wZXJhbmRzKSkge1xuICAgICAgY29uc3QgZXhwZWN0ZWQgPSB0b0xpc3QoZXhwZWN0ZWRVbmtub3duKS5tYXAoKHYpID0+IGFzU3RyaW5nKHYpID8/ICcnKVxuICAgICAgY29uc3QgYWN0dWFsID0gY29udGV4dFZhbHVlKGtleSwgcmVxdWVzdClcbiAgICAgIGlmIChvcGVyYXRvciA9PT0gJ1N0cmluZ0VxdWFscycpIHtcbiAgICAgICAgaWYgKGFjdHVhbCA9PT0gdW5kZWZpbmVkIHx8ICFleHBlY3RlZC5pbmNsdWRlcyhhY3R1YWwpKSByZXR1cm4gJ3Vuc2F0aXNmaWVkJ1xuICAgICAgfSBlbHNlIGlmIChvcGVyYXRvciA9PT0gJ1N0cmluZ05vdEVxdWFscycpIHtcbiAgICAgICAgaWYgKGFjdHVhbCAhPT0gdW5kZWZpbmVkICYmIGV4cGVjdGVkLmluY2x1ZGVzKGFjdHVhbCkpIHJldHVybiAndW5zYXRpc2ZpZWQnXG4gICAgICB9IGVsc2UgaWYgKG9wZXJhdG9yID09PSAnQXJuTGlrZScgfHwgb3BlcmF0b3IgPT09ICdTdHJpbmdMaWtlJykge1xuICAgICAgICBpZiAoYWN0dWFsID09PSB1bmRlZmluZWQgfHwgIWV4cGVjdGVkLnNvbWUoKHBhdHRlcm4pID0+IGdsb2JNYXRjaChwYXR0ZXJuLCBhY3R1YWwpKSkgcmV0dXJuICd1bnNhdGlzZmllZCdcbiAgICAgIH0gZWxzZSBpZiAob3BlcmF0b3IgPT09ICdBcm5Ob3RMaWtlJyB8fCBvcGVyYXRvciA9PT0gJ1N0cmluZ05vdExpa2UnKSB7XG4gICAgICAgIGlmIChhY3R1YWwgIT09IHVuZGVmaW5lZCAmJiBleHBlY3RlZC5zb21lKChwYXR0ZXJuKSA9PiBnbG9iTWF0Y2gocGF0dGVybiwgYWN0dWFsKSkpIHJldHVybiAndW5zYXRpc2ZpZWQnXG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gJ3Vua25vd24nXG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiAnc2F0aXNmaWVkJ1xufVxuXG5jb25zdCBjb250ZXh0VmFsdWUgPSAoa2V5OiBzdHJpbmcsIHJlcXVlc3Q6IEFjY2Vzc1JlcXVlc3QpOiBzdHJpbmcgfCB1bmRlZmluZWQgPT4ge1xuICBzd2l0Y2ggKGtleSkge1xuICAgIGNhc2UgJ2F3czpQcmluY2lwYWxBcm4nOlxuICAgICAgcmV0dXJuIHJlcXVlc3QucHJpbmNpcGFsQXJuXG4gICAgY2FzZSAnYXdzOlNvdXJjZUFjY291bnQnOlxuICAgICAgcmV0dXJuIHJlcXVlc3Quc291cmNlQWNjb3VudFxuICAgIGNhc2UgJ2F3czpQcmluY2lwYWxPcmdJRCc6XG4gICAgICByZXR1cm4gcmVxdWVzdC5wcmluY2lwYWxPcmdJZFxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cbn1cblxuLyoqIFdoZXRoZXIgYSBzdGF0ZW1lbnQncyBgUHJpbmNpcGFsYCBuYW1lcyB0aGUgcmVxdWVzdCBwcmluY2lwYWwgKGFuIGB7QVdTOiBbLi4uXX1gIGxpc3QsIGEgc3RyaW5nLCBvciBgKmApLiAqL1xuY29uc3QgcHJpbmNpcGFsTWF0Y2hlcyA9IChzdGF0ZW1lbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBwcmluY2lwYWxBcm46IHN0cmluZyk6IGJvb2xlYW4gPT4ge1xuICBjb25zdCBwcmluY2lwYWwgPSBzdGF0ZW1lbnQuUHJpbmNpcGFsXG4gIGlmIChwcmluY2lwYWwgPT09ICcqJykgcmV0dXJuIHRydWVcbiAgY29uc3QgYXdzID0gdG9MaXN0KGFzUmVjb3JkKHByaW5jaXBhbCkuQVdTKS5maWx0ZXIoKHApOiBwIGlzIHN0cmluZyA9PiB0eXBlb2YgcCA9PT0gJ3N0cmluZycpXG4gIHJldHVybiBhd3Muc29tZSgoZW50cnkpID0+IGVudHJ5ID09PSAnKicgfHwgZ2xvYk1hdGNoKGVudHJ5LCBwcmluY2lwYWxBcm4pKVxufVxuXG5jb25zdCBzdGF0ZW1lbnRzT2YgPSAocG9saWN5RG9jOiB1bmtub3duKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj5bXSA9PlxuICBhc0FycmF5KGFzUmVjb3JkKHBvbGljeURvYykuU3RhdGVtZW50KS5tYXAoYXNSZWNvcmQpXG5cbmNvbnN0IGVmZmVjdE9mID0gKHN0YXRlbWVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiAnQWxsb3cnIHwgJ0RlbnknID0+XG4gIGFzU3RyaW5nKHN0YXRlbWVudC5FZmZlY3QpID09PSAnRGVueScgPyAnRGVueScgOiAnQWxsb3cnXG5cbi8qKlxuICogRXZhbHVhdGUgYW4gT3JnYW5pemF0aW9ucyBTQ1AgYWdhaW5zdCB0aGUgcmVxdWVzdC4gQW4gU0NQIG9ubHkgZXZlciBERU5JRVMgb3IgaXMgc2lsZW50OiBhIGBEZW55YFxuICogc3RhdGVtZW50IHdob3NlIGFjdGlvbiArIChOb3RSZXNvdXJjZSBPUiBSZXNvdXJjZSkgKyBjb25kaXRpb24gYWxsIG1hdGNoIHRoZSByZXF1ZXN0IHlpZWxkcyBgJ0RlbnknYC5cbiAqIFJldHVybnMgYCdOb3RBcHBsaWNhYmxlJ2Agb3RoZXJ3aXNlICh0aGUgU0NQIGRvZXMgbm90IGJ5IGl0c2VsZiBwZXJtaXQgYW55dGhpbmcpLlxuICovXG5leHBvcnQgY29uc3QgZXZhbHVhdGVTY3AgPSAoc2NwRG9jOiB1bmtub3duLCByZXF1ZXN0OiBBY2Nlc3NSZXF1ZXN0KTogJ0RlbnknIHwgJ05vdEFwcGxpY2FibGUnID0+IHtcbiAgZm9yIChjb25zdCBzdGF0ZW1lbnQgb2Ygc3RhdGVtZW50c09mKHNjcERvYykpIHtcbiAgICBpZiAoZWZmZWN0T2Yoc3RhdGVtZW50KSAhPT0gJ0RlbnknKSBjb250aW51ZVxuICAgIGlmICghYWN0aW9uTWF0Y2hlcyhzdGF0ZW1lbnQsIHJlcXVlc3QuYWN0aW9uKSkgY29udGludWVcbiAgICAvLyBPbmx5IGEgZGVmaW5pdGl2ZWx5LXVuc2F0aXNmaWVkIGNvbmRpdGlvbiBsZXRzIHRoZSBEZW55IHBhc3M7IGFuIHVubW9kZWxsZWQgb3BlcmF0b3IgKGRyaWZ0KSBiaXRlcy5cbiAgICBpZiAoY29uZGl0aW9uU2F0aXNmaWVkKHN0YXRlbWVudCwgcmVxdWVzdCkgPT09ICd1bnNhdGlzZmllZCcpIGNvbnRpbnVlXG4gICAgY29uc3QgZGVuaWVkID1cbiAgICAgIG5vdFJlc291cmNlTWF0Y2hlcyhzdGF0ZW1lbnQsIHJlcXVlc3QucmVzb3VyY2VBcm4pIHx8IHJlc291cmNlTWF0Y2hlcyhzdGF0ZW1lbnQsIHJlcXVlc3QucmVzb3VyY2VBcm4pXG4gICAgaWYgKGRlbmllZCkgcmV0dXJuICdEZW55J1xuICB9XG4gIHJldHVybiAnTm90QXBwbGljYWJsZSdcbn1cblxuLyoqXG4gKiBFdmFsdWF0ZSBhIHJlc291cmNlIChidWNrZXQpIHBvbGljeSBhZ2FpbnN0IHRoZSByZXF1ZXN0LiBSZXR1cm5zIHRoZSBzdHJvbmdlc3QgbWF0Y2hpbmcgZWZmZWN0OlxuICogYW4gZXhwbGljaXQgYCdEZW55J2Agd2lucywgZWxzZSBgJ0FsbG93J2AgaWYgYSBtYXRjaGluZyBBbGxvdyBleGlzdHMsIGVsc2UgYCdOb3RBcHBsaWNhYmxlJ2AuXG4gKi9cbmV4cG9ydCBjb25zdCBldmFsdWF0ZVJlc291cmNlUG9saWN5ID0gKFxuICBwb2xpY3lEb2M6IHVua25vd24sXG4gIHJlcXVlc3Q6IEFjY2Vzc1JlcXVlc3QsXG4pOiAnQWxsb3cnIHwgJ0RlbnknIHwgJ05vdEFwcGxpY2FibGUnID0+IHtcbiAgbGV0IGFsbG93ZWQgPSBmYWxzZVxuICBmb3IgKGNvbnN0IHN0YXRlbWVudCBvZiBzdGF0ZW1lbnRzT2YocG9saWN5RG9jKSkge1xuICAgIGlmICghYWN0aW9uTWF0Y2hlcyhzdGF0ZW1lbnQsIHJlcXVlc3QuYWN0aW9uKSkgY29udGludWVcbiAgICBpZiAoIXJlc291cmNlTWF0Y2hlcyhzdGF0ZW1lbnQsIHJlcXVlc3QucmVzb3VyY2VBcm4pKSBjb250aW51ZVxuICAgIGlmICghcHJpbmNpcGFsTWF0Y2hlcyhzdGF0ZW1lbnQsIHJlcXVlc3QucHJpbmNpcGFsQXJuKSkgY29udGludWVcbiAgICBjb25zdCBjb25kaXRpb24gPSBjb25kaXRpb25TYXRpc2ZpZWQoc3RhdGVtZW50LCByZXF1ZXN0KVxuICAgIGlmIChjb25kaXRpb24gPT09ICd1bnNhdGlzZmllZCcpIGNvbnRpbnVlXG4gICAgaWYgKGVmZmVjdE9mKHN0YXRlbWVudCkgPT09ICdEZW55JykgcmV0dXJuICdEZW55JyAvLyBhIERlbnkgYml0ZXMgb24gc2F0aXNmaWVkIE9SIGRyaWZ0IChmYWlsIGNsb3NlZClcbiAgICBpZiAoY29uZGl0aW9uID09PSAnc2F0aXNmaWVkJykgYWxsb3dlZCA9IHRydWUgLy8gYW4gQWxsb3cgZ3JhbnRzIG9ubHkgd2hlbiBmdWxseSBzYXRpc2ZpZWQg4oCUIG5ldmVyIG9uIGRyaWZ0XG4gIH1cbiAgcmV0dXJuIGFsbG93ZWQgPyAnQWxsb3cnIDogJ05vdEFwcGxpY2FibGUnXG59XG5cbi8qKlxuICogRXZhbHVhdGUgYW4gaWRlbnRpdHkgKGRlbGl2ZXJ5LXJvbGUpIHBvbGljeSDigJQgdGhlIGNoYW5uZWwtc2lkZSBoeWdpZW5lIGdyYW50IOKAlCBhZ2FpbnN0IHRoZSByZXF1ZXN0LlxuICogU2FtZSBlZmZlY3QgbGF0dGljZSBhcyBhIHJlc291cmNlIHBvbGljeSwgYnV0IHByaW5jaXBhbHMgYXJlIGltcGxpY2l0ICh0aGUgcm9sZSBpdHNlbGYpLlxuICovXG5leHBvcnQgY29uc3QgZXZhbHVhdGVJZGVudGl0eVBvbGljeSA9IChcbiAgcG9saWN5RG9jOiB1bmtub3duLFxuICByZXF1ZXN0OiBBY2Nlc3NSZXF1ZXN0LFxuKTogJ0FsbG93JyB8ICdEZW55JyB8ICdOb3RBcHBsaWNhYmxlJyA9PiB7XG4gIGxldCBhbGxvd2VkID0gZmFsc2VcbiAgZm9yIChjb25zdCBzdGF0ZW1lbnQgb2Ygc3RhdGVtZW50c09mKHBvbGljeURvYykpIHtcbiAgICBpZiAoIWFjdGlvbk1hdGNoZXMoc3RhdGVtZW50LCByZXF1ZXN0LmFjdGlvbikpIGNvbnRpbnVlXG4gICAgaWYgKCFyZXNvdXJjZU1hdGNoZXMoc3RhdGVtZW50LCByZXF1ZXN0LnJlc291cmNlQXJuKSkgY29udGludWVcbiAgICBjb25zdCBjb25kaXRpb24gPSBjb25kaXRpb25TYXRpc2ZpZWQoc3RhdGVtZW50LCByZXF1ZXN0KVxuICAgIGlmIChjb25kaXRpb24gPT09ICd1bnNhdGlzZmllZCcpIGNvbnRpbnVlXG4gICAgaWYgKGVmZmVjdE9mKHN0YXRlbWVudCkgPT09ICdEZW55JykgcmV0dXJuICdEZW55JyAvLyBhIERlbnkgYml0ZXMgb24gc2F0aXNmaWVkIE9SIGRyaWZ0IChmYWlsIGNsb3NlZClcbiAgICBpZiAoY29uZGl0aW9uID09PSAnc2F0aXNmaWVkJykgYWxsb3dlZCA9IHRydWUgLy8gYW4gQWxsb3cgZ3JhbnRzIG9ubHkgd2hlbiBmdWxseSBzYXRpc2ZpZWQg4oCUIG5ldmVyIG9uIGRyaWZ0XG4gIH1cbiAgcmV0dXJuIGFsbG93ZWQgPyAnQWxsb3cnIDogJ05vdEFwcGxpY2FibGUnXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgR3VhcmRyYWlsQ29udGV4dCB7XG4gIC8qKiBUaGUgYXV0aG9yaXRhdGl2ZSBvcGVyYXRvci1vd25lZCBPcmcgU0NQIGRvY3VtZW50LiAqL1xuICByZWFkb25seSBzY3A6IHVua25vd25cbiAgLyoqIFRoZSBkZXN0aW5hdGlvbiBidWNrZXQncyByZXNvdXJjZSBwb2xpY3ksIGtleWVkIGJ5IGJ1Y2tldCBuYW1lOyBhYnNlbnQgZm9yIGFuIHVuc2FuY3Rpb25lZCBidWNrZXQuICovXG4gIHJlYWRvbmx5IGJ1Y2tldFBvbGljaWVzPzogUmVhZG9ubHk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+XG4gIC8qKiBPcHRpb25hbCBjaGFubmVsLXNpZGUgZGVsaXZlcnktcm9sZSBpZGVudGl0eSBwb2xpY3kgKFRhc2sgNCBoeWdpZW5lKTsgd2hlbiBhYnNlbnQgdGhlIHJvbGUgaXMgdW5jb25zdHJhaW5lZC4gKi9cbiAgcmVhZG9ubHkgaWRlbnRpdHlQb2xpY3k/OiB1bmtub3duXG59XG5cbi8qKiBUaGUgYnVja2V0IG5hbWUgZW1iZWRkZWQgaW4gYW4gUzMgb2JqZWN0IEFSTiAoYGFybjphd3M6czM6OjpidWNrZXQva2V5YCkuICovXG5jb25zdCBidWNrZXRPZiA9IChyZXNvdXJjZUFybjogc3RyaW5nKTogc3RyaW5nID0+IHJlc291cmNlQXJuLnJlcGxhY2UoL15hcm46YXdzOnMzOjo6LywgJycpLnNwbGl0KCcvJylbMF1cblxuLyoqXG4gKiBUaGUgZnVsbCBBV1MgYXV0aG9yaXphdGlvbiBkZWNpc2lvbiBmb3IgYSBmaXJlaG9zZSBkZWxpdmVyeSB3cml0ZSwgd2l0aCBkZW55LW92ZXJyaWRlcyBhY3Jvc3MgdGhlXG4gKiBvcGVyYXRvci1vd25lZCBsYXllcnMgKyB0aGUgY2hhbm5lbC1zaWRlIGlkZW50aXR5IGdyYW50OlxuICogICAxLiBhbiBleHBsaWNpdCBEZW55IGluIHRoZSBTQ1AsIHRoZSBidWNrZXQgcG9saWN5LCBvciB0aGUgaWRlbnRpdHkgcG9saWN5IOKGkiBERU5JRUQgKHRoZSBTQ1AgaXMgdGhlXG4gKiAgICAgIGF1dGhvcml0YXRpdmUgbGF5ZXIgdGhhdCBkZW5pZXMgd3JpdGluZyBFTFNFV0hFUkU7IGl0IGhvbGRzIGV2ZW4gaWYgdGhlIGNoYW5uZWwgd2lkZW5zKSxcbiAqICAgMi4gb3RoZXJ3aXNlIEFMTE9XRUQgb25seSB3aGVuIHRoZSBpZGVudGl0eSBwb2xpY3kgcGVybWl0cyBpdCBBTkQsIGlmIHRoZSB0YXJnZXQgYnVja2V0IGhhcyBhXG4gKiAgICAgIHJlc291cmNlIHBvbGljeSwgdGhhdCBwb2xpY3kgYWxzbyBwZXJtaXRzIGl0IChjcm9zcy1hY2NvdW50IHdyaXRlcyBuZWVkIGJvdGgpLFxuICogICAzLiBvdGhlcndpc2UgKGltcGxpY2l0KSBERU5JRUQuXG4gKlxuICogV2hlbiBgaWRlbnRpdHlQb2xpY3lgIGlzIG9taXR0ZWQgdGhlIGNoYW5uZWwgcm9sZSBpcyB0cmVhdGVkIGFzIHVuY29uc3RyYWluZWQgKHRoZSB3b3JzdCBjYXNlIGFcbiAqIGhhbmQtcm9sbGVkIGNoYW5uZWwgY2FuIHByZXNlbnQpLCBzbyBhIG5vbi1kZW5pZWQgd3JpdGUgdHVybnMgb24gdGhlIG9wZXJhdG9yLW93bmVkIGxheWVycyBhbG9uZSDigJRcbiAqIHdoaWNoIGlzIGV4YWN0bHkgdGhlIHByb3BlcnR5IFM1IGFzc2VydHMuXG4gKi9cbmV4cG9ydCBjb25zdCBldmFsdWF0ZURlbGl2ZXJ5ID0gKGNvbnRleHQ6IEd1YXJkcmFpbENvbnRleHQsIHJlcXVlc3Q6IEFjY2Vzc1JlcXVlc3QpOiBEZWNpc2lvbiA9PiB7XG4gIGlmIChldmFsdWF0ZVNjcChjb250ZXh0LnNjcCwgcmVxdWVzdCkgPT09ICdEZW55JykgcmV0dXJuICdEZW5pZWQnXG5cbiAgaWYgKGNvbnRleHQuaWRlbnRpdHlQb2xpY3kgIT09IHVuZGVmaW5lZCkge1xuICAgIGNvbnN0IGlkZW50aXR5ID0gZXZhbHVhdGVJZGVudGl0eVBvbGljeShjb250ZXh0LmlkZW50aXR5UG9saWN5LCByZXF1ZXN0KVxuICAgIGlmIChpZGVudGl0eSA9PT0gJ0RlbnknKSByZXR1cm4gJ0RlbmllZCdcbiAgICBpZiAoaWRlbnRpdHkgPT09ICdOb3RBcHBsaWNhYmxlJykgcmV0dXJuICdEZW5pZWQnXG4gIH1cblxuICBjb25zdCBidWNrZXQgPSBidWNrZXRPZihyZXF1ZXN0LnJlc291cmNlQXJuKVxuICBjb25zdCBidWNrZXRQb2xpY3kgPSBjb250ZXh0LmJ1Y2tldFBvbGljaWVzPy5bYnVja2V0XVxuICBpZiAoYnVja2V0UG9saWN5ICE9PSB1bmRlZmluZWQpIHtcbiAgICBjb25zdCByZXNvdXJjZSA9IGV2YWx1YXRlUmVzb3VyY2VQb2xpY3koYnVja2V0UG9saWN5LCByZXF1ZXN0KVxuICAgIGlmIChyZXNvdXJjZSA9PT0gJ0RlbnknKSByZXR1cm4gJ0RlbmllZCdcbiAgICBpZiAocmVzb3VyY2UgPT09ICdOb3RBcHBsaWNhYmxlJykgcmV0dXJuICdEZW5pZWQnXG4gIH1cblxuICByZXR1cm4gJ0FsbG93ZWQnXG59XG4iXX0=