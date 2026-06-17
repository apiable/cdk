/**
 * Reduce an IAM policy document to the gate's permission-grant model. Both channels feed the
 * same shape here: CloudFormation carries the document as a property tree (with intrinsics), and
 * Terraform carries it as a `jsonencode`d string that parses to the identical `{ Statement: [] }`
 * shape — so a single reducer keeps the two sides honest. The caller supplies a `resolve` that
 * turns a channel-native value (a CloudFormation intrinsic, or a concrete Terraform string) into
 * a comparable string; resources and principals are then normalised to logical references.
 */
import { accountIdsIn, normaliseLogical, PermissionGrant } from './model'
import { policyServices } from './canonical'
import { asArray, asRecord, asString, isRecord } from './narrow'

const toList = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : value === undefined ? [] : [value]

const principalOf = (
  principal: unknown,
  resolve: (v: unknown) => string,
  region: string | undefined,
): string | undefined => {
  if (principal === undefined) return undefined
  if (typeof principal === 'string') return normaliseLogical(principal, region)
  if (isRecord(principal)) {
    const aws = principal.AWS ?? principal.Service ?? principal.Federated
    return normaliseLogical(resolve(aws), region)
  }
  return undefined
}

/**
 * A statement's `Condition` reduced to a stable string, with account ids and regions left by value
 * (a condition that pins an external account is load-bearing). Keys and operators are sorted so the
 * same condition signs alike whatever order a channel emits it in; an absent condition is undefined.
 */
const conditionOf = (condition: unknown, resolve: (v: unknown) => string): string | undefined => {
  if (!isRecord(condition)) return undefined
  const operators = Object.keys(condition).sort()
  const canonical = operators.map((operator) => {
    const operands = asRecord(condition[operator])
    const keys = Object.keys(operands).sort()
    const pairs = keys.map((key) => [key, [...toList(operands[key])].map(resolve).sort()] as const)
    return [operator, pairs] as const
  })
  return canonical.length > 0 ? JSON.stringify(canonical) : undefined
}

/**
 * Build the grants for one policy document. `kind` distinguishes a role's trust (assume-role)
 * policy from an attached permission policy so the grant carries a channel-stable ref.
 */
export const grantsFromPolicyDocument = (
  doc: unknown,
  resolve: (v: unknown) => string,
  region: string | undefined,
  kind: 'trust' | 'inline',
): PermissionGrant[] =>
  asArray(asRecord(doc).Statement).map((stmtUnknown) => {
    const statement = asRecord(stmtUnknown)
    const actions = [...new Set(toList(statement.Action).map(resolve))].sort()
    const resources = [...new Set(toList(statement.Resource).map((r) => normaliseLogical(resolve(r), region)))].sort()
    const effect = asString(statement.Effect) ?? 'Allow'
    const principal = principalOf(statement.Principal, resolve, region)
    const condition = conditionOf(statement.Condition, resolve)
    const ref = kind === 'trust' ? 'grant:assume-role' : `grant:${policyServices(actions)}`
    return { ref, effect, actions, resources, principal, condition }
  })

/**
 * The account(s) a role's trust policy is configured to trust — who may assume the role — captured
 * by value (account ids preserved, never tokenised). A trust target the channels disagree on is a
 * load-bearing divergence the gate must fail on; the grant {@link principalOf} above keeps the
 * principal logical so the incidental deploy account never false-fails, while this reads the one
 * value that is load-bearing. Reads every account-bearing principal form — the direct `AWS`
 * account-root and an account named through a federated identity provider
 * (`arn:aws:iam::<acct>:saml-provider/X`, an OIDC-provider ARN) — so a federated trust's account
 * reaches the same by-value comparison the direct form does, never blanked. Returns a stable
 * comma-joined key, or undefined when no principal names an account (an account-less service
 * principal trusts none).
 */
export const trustedAccountsOf = (doc: unknown, resolve: (v: unknown) => string): string | undefined => {
  const accounts = new Set<string>()
  for (const stmtUnknown of asArray(asRecord(doc).Statement)) {
    const principal = asRecord(stmtUnknown).Principal
    const principalEntries = isRecord(principal) ? Object.values(principal) : [principal]
    for (const principalEntry of principalEntries) {
      for (const entry of toList(principalEntry)) {
        for (const account of accountIdsIn(resolve(entry))) accounts.add(account)
      }
    }
  }
  return accounts.size > 0 ? [...accounts].sort().join(',') : undefined
}
