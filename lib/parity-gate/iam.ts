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

/**
 * A statement's `Principal` reduced to a stable string capturing WHO is granted, by value. A
 * principal entry can be a bare string, an `{ AWS | Service | Federated }` object, or — the case a
 * resource policy (an S3 bucket policy) relies on — a LIST of principal ARNs under one of those keys.
 * Every named principal is normalised (deploy-account/region tokens applied, the bounded
 * cross-account writer left by value) and the set is sorted and joined, so an extra, widened, or
 * wildcard principal enlarges the signature and diverges instead of collapsing to one value or, worse,
 * to an empty string (the fail-OPEN a single `resolve` of a principal list produced). A wildcard `*`
 * is preserved verbatim — it reads as "any principal" and must never compare equal to a bounded set.
 */
const principalOf = (
  principal: unknown,
  resolve: (v: unknown) => string,
  region: string | undefined,
): string | undefined => {
  const named = namedPrincipals(principal)
  if (named.length === 0) return undefined
  return [...new Set(named.map((entry) => normaliseLogical(resolve(entry), region)))].sort().join(',')
}

/** Every principal entry named by a statement's `Principal`, flattening the AWS/Service/Federated lists. */
const namedPrincipals = (principal: unknown): readonly unknown[] => {
  if (principal === undefined) return []
  if (typeof principal === 'string') return [principal]
  if (isRecord(principal)) {
    return PRINCIPAL_KEYS.flatMap((key) => toList(principal[key]))
  }
  return []
}

/** The principal-identity keys a statement's `Principal` can carry; all are flattened together. */
const PRINCIPAL_KEYS = ['AWS', 'Service', 'Federated'] as const

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

/** Identity resource canonicaliser — the default when a reducer maps no resource ARN to a node ref. */
const identityResource = (resource: string): string => resource

/**
 * Build the grants for one policy document. `kind` distinguishes a role's trust (assume-role)
 * policy from an attached permission policy so the grant carries a channel-stable ref.
 *
 * `canonicaliseResource` reconciles a resource ARN that names a resource declared in the same
 * artifact to that resource's channel-stable node ref. Without it a self-referential ARN compares a
 * CloudFormation `Fn::GetAtt` (a channel-local logical id) against a Terraform-resolved literal ARN
 * and false-diverges; with it both sides reduce to the one canonical node ref. It defaults to the
 * identity so a grant on an external/literal ARN (the gateway-role pilot's apigateway resource) is
 * left exactly as resolved.
 */
export const grantsFromPolicyDocument = (
  doc: unknown,
  resolve: (v: unknown) => string,
  region: string | undefined,
  kind: 'trust' | 'inline',
  canonicaliseResource: (resource: string) => string = identityResource,
): PermissionGrant[] =>
  asArray(asRecord(doc).Statement).map((stmtUnknown) => {
    const statement = asRecord(stmtUnknown)
    const actions = [...new Set(toList(statement.Action).map(resolve))].sort()
    const resources = [...new Set(toList(statement.Resource).map((r) => canonicaliseResource(normaliseLogical(resolve(r), region))))].sort()
    const effect = asString(statement.Effect) ?? 'Allow'
    const principal = principalOf(statement.Principal, resolve, region)
    const condition = conditionOf(statement.Condition, resolve)
    const ref = kind === 'trust' ? 'grant:assume-role' : `grant:${policyServices(actions)}`
    return { ref, effect, actions, resources, principal, condition }
  })

/**
 * Every statement's principals across a policy document, channel-resolved but NOT logical-normalised,
 * so account literals survive for a by-value comparison. The resource-policy (bucket-policy) write
 * grant is read this way: who may write is load-bearing, the same way {@link trustedAccountsOf} reads
 * who may assume a role — the by-value account set, not the account-tokenised grant principal.
 */
export const resolvedPrincipalsOf = (doc: unknown, resolve: (v: unknown) => string): string[] =>
  asArray(asRecord(doc).Statement).flatMap((stmtUnknown) =>
    namedPrincipals(asRecord(stmtUnknown).Principal).map((entry) => (typeof entry === 'string' ? entry : resolve(entry))),
  )

/** Principal keys whose identifier names an AWS account — the direct account-root and a federated
 * provider ARN (`arn:aws:iam::<acct>:saml-provider/X`, an OIDC-provider ARN). A `Service` principal
 * names a service, not an account, so its value is not scanned for an account id. */
const ACCOUNT_BEARING_PRINCIPAL_KEYS = ['AWS', 'Federated'] as const

/**
 * The account(s) a role's trust policy is configured to trust — who may assume the role — captured
 * by value (account ids preserved, never tokenised). A trust target the channels disagree on is a
 * load-bearing divergence the gate must fail on; the grant {@link principalOf} above keeps the
 * principal logical so the incidental deploy account never false-fails, while this reads the one
 * value that is load-bearing. Reads the account from each account-bearing principal form — the
 * direct `AWS` account-root and an account named through a federated identity provider — so a
 * federated trust's account reaches the same by-value comparison the direct form does, never
 * blanked. Returns a stable comma-joined key, or undefined when no principal names an account (an
 * account-less service principal trusts none).
 */
export const trustedAccountsOf = (doc: unknown, resolve: (v: unknown) => string): string | undefined => {
  const accounts = new Set<string>()
  for (const stmtUnknown of asArray(asRecord(doc).Statement)) {
    const principal = asRecord(stmtUnknown).Principal
    const principalEntries = isRecord(principal)
      ? ACCOUNT_BEARING_PRINCIPAL_KEYS.map((key) => principal[key])
      : [principal]
    for (const principalEntry of principalEntries) {
      for (const entry of toList(principalEntry)) {
        for (const account of accountIdsIn(resolve(entry))) accounts.add(account)
      }
    }
  }
  return accounts.size > 0 ? [...accounts].sort().join(',') : undefined
}
