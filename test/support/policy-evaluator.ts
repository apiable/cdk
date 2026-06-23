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
 *   - `aws:PrincipalArn` ArnLike, `aws:SourceAccount`/`aws:PrincipalOrgID` StringEquals are honoured.
 *
 * Static IaC-shape assertions in the spec back this simulator-as-oracle so policy-document drift the
 * evaluator would tolerate (a narrowed action set, a dropped condition) is still caught.
 */
import { asArray, asRecord, asString } from '../../lib/parity-gate/narrow'

/** A single S3 write attempt the guardrail decides on. */
export interface AccessRequest {
  /** ARN of the principal performing the write (the firehose delivery role). */
  readonly principalArn: string
  /** The S3 action, e.g. `s3:PutObject`. */
  readonly action: string
  /** The target object ARN, e.g. `arn:aws:s3:::bucket/key`. */
  readonly resourceArn: string
  /** The account the call originates from (for `aws:SourceAccount`). */
  readonly sourceAccount?: string
  /** The Org id of the calling principal (for `aws:PrincipalOrgID`). */
  readonly principalOrgId?: string
}

export type Decision = 'Allowed' | 'Denied'

const toList = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : value === undefined ? [] : [value]

const actionsOf = (statement: Record<string, unknown>): string[] =>
  toList(statement.Action).filter((a): a is string => typeof a === 'string')

/** Whether a statement's Action list matches the request action (exact, or a `prefix:*` / `*` glob). */
const actionMatches = (statement: Record<string, unknown>, action: string): boolean =>
  actionsOf(statement).some((pattern) => globMatch(pattern, action))

/** IAM-style glob: `*` matches any run of characters. Anchored both ends. */
const globMatch = (pattern: string, value: string): boolean => {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(value)
}

const resourcesOf = (key: 'Resource' | 'NotResource', statement: Record<string, unknown>): string[] =>
  toList(statement[key]).filter((r): r is string => typeof r === 'string')

/** Whether the request resource is named by a statement's `Resource` (any entry globs the resource). */
const resourceMatches = (statement: Record<string, unknown>, resourceArn: string): boolean =>
  resourcesOf('Resource', statement).some((pattern) => globMatch(pattern, resourceArn))

/** Whether the request resource falls OUTSIDE a statement's `NotResource` (none of the entries glob it). */
const notResourceMatches = (statement: Record<string, unknown>, resourceArn: string): boolean => {
  const notResources = resourcesOf('NotResource', statement)
  if (notResources.length === 0) return false
  return !notResources.some((pattern) => globMatch(pattern, resourceArn))
}

/** Whether a statement's `Condition` block is satisfied by the request. Unmodelled operators fail closed. */
const conditionSatisfied = (statement: Record<string, unknown>, request: AccessRequest): boolean => {
  const condition = statement.Condition
  if (condition === undefined) return true
  const block = asRecord(condition)
  for (const [operator, operandsUnknown] of Object.entries(block)) {
    const operands = asRecord(operandsUnknown)
    for (const [key, expectedUnknown] of Object.entries(operands)) {
      const expected = toList(expectedUnknown).map((v) => asString(v) ?? '')
      const actual = contextValue(key, request)
      if (operator === 'StringEquals') {
        if (actual === undefined || !expected.includes(actual)) return false
      } else if (operator === 'ArnLike' || operator === 'StringLike') {
        if (actual === undefined || !expected.some((pattern) => globMatch(pattern, actual))) return false
      } else {
        // An operator the guardrail does not use appearing here is drift — fail closed rather than ignore.
        return false
      }
    }
  }
  return true
}

const contextValue = (key: string, request: AccessRequest): string | undefined => {
  switch (key) {
    case 'aws:PrincipalArn':
      return request.principalArn
    case 'aws:SourceAccount':
      return request.sourceAccount
    case 'aws:PrincipalOrgID':
      return request.principalOrgId
    default:
      return undefined
  }
}

/** Whether a statement's `Principal` names the request principal (an `{AWS: [...]}` list, a string, or `*`). */
const principalMatches = (statement: Record<string, unknown>, principalArn: string): boolean => {
  const principal = statement.Principal
  if (principal === '*') return true
  const aws = toList(asRecord(principal).AWS).filter((p): p is string => typeof p === 'string')
  return aws.some((entry) => entry === '*' || globMatch(entry, principalArn))
}

const statementsOf = (policyDoc: unknown): Record<string, unknown>[] =>
  asArray(asRecord(policyDoc).Statement).map(asRecord)

const effectOf = (statement: Record<string, unknown>): 'Allow' | 'Deny' =>
  asString(statement.Effect) === 'Deny' ? 'Deny' : 'Allow'

/**
 * Evaluate an Organizations SCP against the request. An SCP only ever DENIES or is silent: a `Deny`
 * statement whose action + (NotResource OR Resource) + condition all match the request yields `'Deny'`.
 * Returns `'NotApplicable'` otherwise (the SCP does not by itself permit anything).
 */
export const evaluateScp = (scpDoc: unknown, request: AccessRequest): 'Deny' | 'NotApplicable' => {
  for (const statement of statementsOf(scpDoc)) {
    if (effectOf(statement) !== 'Deny') continue
    if (!actionMatches(statement, request.action)) continue
    if (!conditionSatisfied(statement, request)) continue
    const denied =
      notResourceMatches(statement, request.resourceArn) || resourceMatches(statement, request.resourceArn)
    if (denied) return 'Deny'
  }
  return 'NotApplicable'
}

/**
 * Evaluate a resource (bucket) policy against the request. Returns the strongest matching effect:
 * an explicit `'Deny'` wins, else `'Allow'` if a matching Allow exists, else `'NotApplicable'`.
 */
export const evaluateResourcePolicy = (
  policyDoc: unknown,
  request: AccessRequest,
): 'Allow' | 'Deny' | 'NotApplicable' => {
  let allowed = false
  for (const statement of statementsOf(policyDoc)) {
    if (!actionMatches(statement, request.action)) continue
    if (!resourceMatches(statement, request.resourceArn)) continue
    if (!principalMatches(statement, request.principalArn)) continue
    if (!conditionSatisfied(statement, request)) continue
    if (effectOf(statement) === 'Deny') return 'Deny'
    allowed = true
  }
  return allowed ? 'Allow' : 'NotApplicable'
}

/**
 * Evaluate an identity (delivery-role) policy — the channel-side hygiene grant — against the request.
 * Same effect lattice as a resource policy, but principals are implicit (the role itself).
 */
export const evaluateIdentityPolicy = (
  policyDoc: unknown,
  request: AccessRequest,
): 'Allow' | 'Deny' | 'NotApplicable' => {
  let allowed = false
  for (const statement of statementsOf(policyDoc)) {
    if (!actionMatches(statement, request.action)) continue
    if (!resourceMatches(statement, request.resourceArn)) continue
    if (!conditionSatisfied(statement, request)) continue
    if (effectOf(statement) === 'Deny') return 'Deny'
    allowed = true
  }
  return allowed ? 'Allow' : 'NotApplicable'
}

export interface GuardrailContext {
  /** The authoritative operator-owned Org SCP document. */
  readonly scp: unknown
  /** The destination bucket's resource policy, keyed by bucket name; absent for an unsanctioned bucket. */
  readonly bucketPolicies?: Readonly<Record<string, unknown>>
  /** Optional channel-side delivery-role identity policy (Task 4 hygiene); when absent the role is unconstrained. */
  readonly identityPolicy?: unknown
}

/** The bucket name embedded in an S3 object ARN (`arn:aws:s3:::bucket/key`). */
const bucketOf = (resourceArn: string): string => resourceArn.replace(/^arn:aws:s3:::/, '').split('/')[0]

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
export const evaluateDelivery = (context: GuardrailContext, request: AccessRequest): Decision => {
  if (evaluateScp(context.scp, request) === 'Deny') return 'Denied'

  if (context.identityPolicy !== undefined) {
    const identity = evaluateIdentityPolicy(context.identityPolicy, request)
    if (identity === 'Deny') return 'Denied'
    if (identity === 'NotApplicable') return 'Denied'
  }

  const bucket = bucketOf(request.resourceArn)
  const bucketPolicy = context.bucketPolicies?.[bucket]
  if (bucketPolicy !== undefined) {
    const resource = evaluateResourcePolicy(bucketPolicy, request)
    if (resource === 'Deny') return 'Denied'
    if (resource === 'NotApplicable') return 'Denied'
  }

  return 'Allowed'
}
