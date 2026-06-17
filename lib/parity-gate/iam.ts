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
    const ref = kind === 'trust' ? 'grant:assume-role' : `grant:${policyServices(actions)}`
    return { ref, effect, actions, resources, principal }
  })

/**
 * The account(s) a role's trust policy is configured to trust — who may assume the role — captured
 * by value (account ids preserved, never tokenised). A trust target the channels disagree on is a
 * load-bearing divergence the gate must fail on; the grant {@link principalOf} above keeps the
 * principal logical so the incidental deploy account never false-fails, while this reads the one
 * value that is load-bearing. Returns a stable comma-joined key, or undefined when no AWS principal
 * names an account (a service principal trusts no account).
 */
export const trustedAccountsOf = (doc: unknown, resolve: (v: unknown) => string): string | undefined => {
  const accounts = new Set<string>()
  for (const stmtUnknown of asArray(asRecord(doc).Statement)) {
    const principal = asRecord(stmtUnknown).Principal
    const awsPrincipal = isRecord(principal) ? principal.AWS : principal
    for (const entry of toList(awsPrincipal)) {
      if (entry === undefined) continue
      for (const account of accountIdsIn(resolve(entry))) accounts.add(account)
    }
  }
  return accounts.size > 0 ? [...accounts].sort().join(',') : undefined
}
