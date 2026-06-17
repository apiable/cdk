/**
 * Reduce an IAM policy document to the gate's permission-grant model. Both channels feed the
 * same shape here: CloudFormation carries the document as a property tree (with intrinsics), and
 * Terraform carries it as a `jsonencode`d string that parses to the identical `{ Statement: [] }`
 * shape — so a single reducer keeps the two sides honest. The caller supplies a `resolve` that
 * turns a channel-native value (a CloudFormation intrinsic, or a concrete Terraform string) into
 * a comparable string; resources and principals are then normalised to logical references.
 */
import { normaliseLogical, PermissionGrant } from './model'
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
