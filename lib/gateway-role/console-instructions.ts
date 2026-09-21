/**
 * Generates the hand-build instruction set a customer follows to create the gateway-management role
 * BY HAND — the fourth rendering of the role's security boundary, alongside the CDK construct, the
 * published CloudFormation template, and the Terraform module. Every value is derived from a published
 * artifact's own CloudFormation intrinsics, never authored here, so this channel cannot drift from the
 * three the release-time parity gate already keeps in step (see ../parity-gate/console-reducer.ts,
 * which reduces this module's output back into the gate's comparable model — the fourth channel).
 */
import { EGRESS_CIDR_PARAMETER, TRUST_ACCOUNT_PARAMETER } from './gateway-role'

/** An already-resolved IAM policy statement — every value a plain string; no CloudFormation intrinsic left. */
export interface ResolvedStatement {
  readonly Sid?: string
  readonly Effect: string
  readonly Action: string | readonly string[]
  readonly Resource: string | readonly string[]
  readonly Principal?: { readonly AWS: string }
  readonly Condition?: Readonly<Record<string, Readonly<Record<string, string>>>>
}

/** An already-resolved IAM policy document. */
export interface ResolvedPolicyDocument {
  readonly Version: string
  readonly Statement: readonly ResolvedStatement[]
}

/**
 * The generated hand-build instruction set. Every value the instructions need is its OWN named
 * field, never prose a consumer has to parse (013-7-9, the screen that renders this, depends on this
 * shape directly — "author no policy text in this repo"). `egressCidr` is present only when the
 * artifact's version declares the parameter: v1 shipped no egress restriction at all, so a customer
 * still on v1 gets no CIDR to type — the absence is the accurate instruction, not a gap.
 */
export interface ConsoleInstructionSet {
  readonly construct: 'apiable-gateway-role'
  readonly version: string
  readonly region: string
  readonly roleName: string
  readonly trustAccount: string
  readonly trustDocument: ResolvedPolicyDocument
  readonly permissionDocument: ResolvedPolicyDocument
  readonly egressCidr?: string
}

/**
 * Historical published versions outside what a local synth of current source can reproduce — 1.0.0
 * ships the broad `apigateway:*` grant that v2 (013-1-25) supersedes in source, and is still live
 * in accounts provisioned before 2026-08-03, so it stays a version this generator can be asked for.
 * Deliberately NOT a place to register a construct that has never shipped: this is the record of
 * what IS published, not a pre-registration of what will be.
 */
const HISTORICAL_PUBLISHED_VERSIONS: ReadonlySet<string> = new Set(['1.0.0'])

/**
 * Whether `version` is a version of `apiable-gateway-role` known to be published. `currentVersion` is
 * supplied by the caller (never re-read from package.json here — `test/support/published-template.ts`
 * already owns that lookup) so the current, locally-synthesizable version is always accepted without
 * this file needing a change on every version bump; only a SUPERSEDED version needs enumerating above.
 */
export const isPublishedVersion = (version: string, currentVersion: string): boolean =>
  version === currentVersion || HISTORICAL_PUBLISHED_VERSIONS.has(version)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** CloudFormation intrinsic function keys this generator recognises at all — resolved or refused, never ignored. */
const INTRINSIC_KEYS: ReadonlySet<string> = new Set([
  'Ref',
  'Fn::Join',
  'Fn::GetAtt',
  'Fn::Sub',
  'Fn::ImportValue',
  'Fn::Select',
  'Fn::FindInMap',
  'Fn::If',
  'Fn::Base64',
  'Fn::Cidr',
  'Fn::Split',
  'Fn::GetAZs',
])

/**
 * Resolve a CloudFormation value tree to its final literal form, bounded to the only two intrinsics
 * the role and policy resources use: `Ref` (a pseudo-parameter or a declared parameter's default —
 * never a resource id, which has no default to resolve to) and `Fn::Join`. `AWS::Region` resolves to
 * the SUPPLIED region, never the parity gate's `{region}` comparison token — a customer's instructions
 * need a real region. `AWS::Partition` is fixed `aws`; every published template targets the public
 * partition. Any OTHER intrinsic (`Fn::GetAtt`, `Fn::Sub`, …) or an unresolvable `Ref` throws rather
 * than emitting a value with an unresolved fragment left inside it — the artifact this walks is
 * SCOPED to the role's `AssumeRolePolicyDocument` and the policy's `PolicyDocument` by the caller, so
 * a resource-to-resource `Ref` (e.g. the policy's `Roles` list) is never handed to this function at all.
 */
const resolveValue = (value: unknown, parameterDefaults: Readonly<Record<string, string>>, region: string): unknown => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map((entry) => resolveValue(entry, parameterDefaults, region))
  if (!isRecord(value)) {
    throw new Error(`cannot resolve a console-instruction value of type ${typeof value}: ${JSON.stringify(value)}`)
  }

  const keys = Object.keys(value)
  const intrinsicKeysPresent = keys.filter((key) => INTRINSIC_KEYS.has(key))

  if (intrinsicKeysPresent.length === 0) {
    // Plain data (Version, Effect, Sid, Action, Resource, Principal, Condition, an operator name like
    // "aws:SourceIp", …) — recurse into its own keys rather than treat it as an intrinsic.
    return Object.fromEntries(keys.map((key) => [key, resolveValue(value[key], parameterDefaults, region)]))
  }

  // A genuine CloudFormation intrinsic is always exactly one key on its own; anything else sharing an
  // object with an intrinsic key is not a shape CloudFormation itself ever emits, so this is refused
  // rather than silently resolved as plain data with a literal "Ref"/"Fn::Join" key left inside it.
  if (keys.length !== 1) {
    throw new Error(`malformed intrinsic shape — expected exactly one key, found ${JSON.stringify(keys)}: ${JSON.stringify(value)}`)
  }
  const soleKey = keys[0]

  if (soleKey === 'Ref') {
    const ref = value.Ref
    if (ref === 'AWS::Region') return region
    if (ref === 'AWS::Partition') return 'aws'
    if (typeof ref === 'string' && Object.prototype.hasOwnProperty.call(parameterDefaults, ref)) return parameterDefaults[ref]
    throw new Error(`unresolvable Ref "${String(ref)}" — no parameter default on the artifact and not a supported pseudo-parameter`)
  }

  if (soleKey === 'Fn::Join') {
    const join = value['Fn::Join']
    if (!Array.isArray(join) || join.length !== 2 || typeof join[0] !== 'string' || !Array.isArray(join[1])) {
      throw new Error(`malformed Fn::Join: ${JSON.stringify(join)}`)
    }
    const delimiter = join[0]
    const parts = join[1] as unknown[]
    return parts.map((part) => resolveValue(part, parameterDefaults, region)).join(delimiter)
  }

  // Recognised but unsupported here (Fn::GetAtt, Fn::Sub, Fn::ImportValue, …) — fails loudly rather
  // than emitting a half-resolved value a customer would paste verbatim into their own account.
  throw new Error(`unsupported intrinsic "${soleKey}" in a hand-build instruction value — only Ref and Fn::Join are resolved`)
}

interface CfnLikeTemplate {
  readonly Parameters?: Readonly<Record<string, { readonly Default?: unknown }>>
  readonly Resources?: Readonly<Record<string, { readonly Type?: string; readonly Properties?: Record<string, unknown> }>>
}

const parameterDefaultsOf = (template: CfnLikeTemplate): Record<string, string> => {
  const defaults: Record<string, string> = {}
  for (const [name, spec] of Object.entries(template.Parameters ?? {})) {
    if (typeof spec.Default === 'string') defaults[name] = spec.Default
  }
  return defaults
}

/** The Properties of the artifact's sole resource of `type`. Throws on zero or more than one — the
 * construct declares exactly one role and one policy, so anything else means the artifact this was
 * handed does not have the shape this generator was written for. */
const soleResourcePropertiesOfType = (template: CfnLikeTemplate, type: string): Record<string, unknown> => {
  const matches = Object.values(template.Resources ?? {}).filter((resource) => resource.Type === type)
  if (matches.length !== 1) {
    throw new Error(`expected exactly one ${type} resource in the artifact, found ${matches.length}`)
  }
  return matches[0].Properties ?? {}
}

/**
 * The platform supports NO condition on the assume-role trust statement today (no `sts:ExternalId`,
 * no other) — `ApiGatewayService.kt` builds the AssumeRoleRequest with only `roleSessionName` and
 * `roleArn`. A trust statement carrying one is a named failure mode, not a style preference: a
 * customer who follows an instruction set containing it gets a trust policy AssumeRole cannot
 * satisfy, and their gateway silently disconnects. The real, current artifact never carries one; this
 * guards the direction where a FUTURE artifact regressed one back in, so the instructions still refuse
 * rather than ship an outage.
 */
const assertNoUnsatisfiableTrustCondition = (trustDocument: ResolvedPolicyDocument): void => {
  for (const statement of trustDocument.Statement) {
    if (statement.Condition !== undefined) {
      throw new Error(
        'the generated trust document carries a Condition (e.g. sts:ExternalId) — the platform has no assume-role condition support today, so AssumeRole would fail; refusing to generate an unsatisfiable instruction set',
      )
    }
  }
}

/**
 * Generate the console instruction set for a published `apiable-gateway-role` artifact. `template`
 * is the already-loaded, parsed CloudFormation template for `version` — locating those bytes (a
 * fresh local synth for the CURRENT version, a committed fixture for a superseded one) is the
 * caller's job; this function only trusts `version` enough to refuse one that was never published
 * BEFORE it touches `template` at all, so an unpublished version can never reach the resolver and
 * produce a plausible-looking set from defaults.
 */
export const generateConsoleInstructions = (
  template: unknown,
  version: string,
  currentVersion: string,
  region: string,
): ConsoleInstructionSet => {
  if (!isPublishedVersion(version, currentVersion)) {
    throw new Error(
      `apiable-gateway-role@${version} is not a published version (known: ${currentVersion}, ${[...HISTORICAL_PUBLISHED_VERSIONS].join(', ')}) — refusing to generate console instructions from an unpublished artifact`,
    )
  }
  if (!isRecord(template)) throw new Error('the artifact is not a well-formed CloudFormation template')

  const cfn = template as CfnLikeTemplate
  const parameterDefaults = parameterDefaultsOf(cfn)

  const roleProperties = soleResourcePropertiesOfType(cfn, 'AWS::IAM::Role')
  const policyProperties = soleResourcePropertiesOfType(cfn, 'AWS::IAM::Policy')

  const roleName = resolveValue(roleProperties.RoleName, parameterDefaults, region) as string
  const trustDocument = resolveValue(roleProperties.AssumeRolePolicyDocument, parameterDefaults, region) as ResolvedPolicyDocument
  const permissionDocument = resolveValue(policyProperties.PolicyDocument, parameterDefaults, region) as ResolvedPolicyDocument

  assertNoUnsatisfiableTrustCondition(trustDocument)

  if (!Object.prototype.hasOwnProperty.call(parameterDefaults, TRUST_ACCOUNT_PARAMETER)) {
    throw new Error(`the artifact declares no ${TRUST_ACCOUNT_PARAMETER} parameter default`)
  }
  const trustAccount = parameterDefaults[TRUST_ACCOUNT_PARAMETER]

  const egressCidr = Object.prototype.hasOwnProperty.call(parameterDefaults, EGRESS_CIDR_PARAMETER)
    ? parameterDefaults[EGRESS_CIDR_PARAMETER]
    : undefined

  return {
    construct: 'apiable-gateway-role',
    version,
    region,
    roleName,
    trustAccount,
    trustDocument,
    permissionDocument,
    ...(egressCidr !== undefined ? { egressCidr } : {}),
  }
}
