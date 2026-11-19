/**
 * A stand-in for AWS's decision on a role: whether a caller may assume it (its trust policy), and whether
 * a call made with it is allowed (its permission policy). CI has no AWS account, so a role from any
 * channel is judged here on its fully-resolved documents.
 *
 * It models the slice of IAM policy evaluation these roles use: an explicit Deny overrides any Allow,
 * nothing is allowed by default, `Action` and `NotAction`, `Resource` and `NotResource` with `*` globs,
 * an AWS principal named by account root or account id, and the condition operators `StringEquals` and
 * `StringNotEquals` (on `sts:ExternalId`) and `IpAddress` and `NotIpAddress` (on `aws:SourceIp`). Any
 * other operator or key is drift: it bites on a Deny and never grants on an Allow, so a policy the
 * stand-in cannot read is judged closed both ways.
 */
import { asArray, asRecord, asString } from '../../lib/parity-gate/narrow'

/** A caller asking to assume the role. */
export interface AssumeRequest {
  /** The 12-digit account the caller is in. */
  readonly account: string
  /** The External ID the caller sends, if any. */
  readonly externalId?: string
}

/** A call made with the role's credentials. */
export interface CallRequest {
  readonly action: string
  readonly resource: string
  readonly sourceIp: string
}

type Statement = Record<string, unknown>
type ConditionResult = 'satisfied' | 'unsatisfied' | 'unknown'

const toList = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : value === undefined ? [] : [value])
const strings = (value: unknown): string[] => toList(value).filter((entry): entry is string => typeof entry === 'string')
const statementsOf = (document: unknown): Statement[] => asArray(asRecord(document).Statement).map(asRecord)

const globMatch = (pattern: string, value: string): boolean => {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\?/g, '.')
  return new RegExp(`^${escaped}$`).test(value)
}

const ipToNumber = (ip: string): number | undefined => {
  const parts = ip.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^[0-9]{1,3}$/.test(part) || Number(part) > 255)) return undefined
  return parts.reduce((total, part) => total * 256 + Number(part), 0)
}

/** Whether `ip` is inside `cidr`. A value that is not one IPv4 CIDR block contains nothing. */
export const cidrContains = (cidr: string, ip: string): boolean => {
  const [base, bitsText] = cidr.split('/')
  const bits = Number(bitsText)
  const baseNumber = ipToNumber(base)
  const ipNumber = ipToNumber(ip)
  if (baseNumber === undefined || ipNumber === undefined || !/^[0-9]{1,2}$/.test(bitsText ?? '') || bits > 32) return false
  const size = 2 ** (32 - bits)
  return Math.floor(baseNumber / size) === Math.floor(ipNumber / size)
}

const conditionResult = (statement: Statement, context: Readonly<Record<string, string | undefined>>): ConditionResult => {
  if (statement.Condition === undefined) return 'satisfied'
  for (const [operator, operands] of Object.entries(asRecord(statement.Condition))) {
    for (const [key, expectedValue] of Object.entries(asRecord(operands))) {
      if (!(key in context)) return 'unknown'
      const actual = context[key]
      const expected = strings(expectedValue)
      if (expected.length !== toList(expectedValue).length) return 'unknown'
      switch (operator) {
        case 'StringEquals':
          if (actual === undefined || !expected.includes(actual)) return 'unsatisfied'
          break
        case 'StringNotEquals':
          if (actual !== undefined && expected.includes(actual)) return 'unsatisfied'
          break
        case 'IpAddress':
          if (actual === undefined || !expected.some((cidr) => cidrContains(cidr, actual))) return 'unsatisfied'
          break
        case 'NotIpAddress':
          if (actual === undefined || expected.some((cidr) => cidrContains(cidr, actual))) return 'unsatisfied'
          break
        default:
          return 'unknown'
      }
    }
  }
  return 'satisfied'
}

const coversAction = (statement: Statement, action: string): boolean => {
  if (statement.NotAction !== undefined) return !strings(statement.NotAction).some((pattern) => globMatch(pattern, action))
  return strings(statement.Action).some((pattern) => globMatch(pattern, action))
}

const coversResource = (statement: Statement, resource: string): boolean => {
  if (statement.NotResource !== undefined) return !strings(statement.NotResource).some((pattern) => globMatch(pattern, resource))
  return strings(statement.Resource).some((pattern) => globMatch(pattern, resource))
}

/** Deny overrides; an Allow grants only when its condition is fully satisfied; nothing else is allowed. */
const decide = (statements: readonly Statement[], applies: (statement: Statement) => boolean, context: Readonly<Record<string, string | undefined>>): boolean => {
  let allowed = false
  for (const statement of statements) {
    if (!applies(statement)) continue
    const condition = conditionResult(statement, context)
    if (condition === 'unsatisfied') continue
    if (asString(statement.Effect) === 'Deny') return false
    if (asString(statement.Effect) === 'Allow' && condition === 'satisfied') allowed = true
  }
  return allowed
}

const principalNamesAccount = (statement: Statement, account: string): boolean => {
  const principal = statement.Principal
  if (principal === '*') return true
  return strings(asRecord(principal).AWS).some(
    (entry) => entry === '*' || entry === account || entry === `arn:aws:iam::${account}:root`,
  )
}

/** Whether the trust lets a caller in `request.account`, sending `request.externalId`, assume the role. */
export const mayAssume = (trustDocument: unknown, request: AssumeRequest): boolean =>
  decide(
    statementsOf(trustDocument),
    (statement) => coversAction(statement, 'sts:AssumeRole') && principalNamesAccount(statement, request.account),
    { 'sts:ExternalId': request.externalId },
  )

/** Whether the permission policy allows `request` made with the role's credentials. */
export const mayCall = (permissionDocument: unknown, request: CallRequest): boolean =>
  decide(
    statementsOf(permissionDocument),
    (statement) => coversAction(statement, request.action) && coversResource(statement, request.resource),
    { 'aws:SourceIp': request.sourceIp },
  )

/** A role's two documents, fully resolved: every value a plain string. */
export interface ResolvedRole {
  readonly trust: unknown
  readonly permissions: unknown
}

/** The deploy-time values a CloudFormation template is launched with, and where. */
export interface Launch {
  readonly region: string
  readonly account: string
  readonly parameters: Readonly<Record<string, string>>
}

/** The parameter values CloudFormation would refuse, with the reason; empty when the launch is accepted. */
export const refusedParameters = (template: unknown, parameters: Readonly<Record<string, string>>): string[] => {
  const refusals: string[] = []
  for (const [name, specUnknown] of Object.entries(asRecord(asRecord(template).Parameters))) {
    const spec = asRecord(specUnknown)
    const value = parameters[name] ?? asString(spec.Default)
    if (value === undefined) {
      refusals.push(`${name}: no value and no default`)
      continue
    }
    const pattern = asString(spec.AllowedPattern)
    // CloudFormation matches AllowedPattern against the whole value.
    if (pattern !== undefined && !new RegExp(`^(?:${pattern})$`).test(value)) refusals.push(`${name}: does not match ${pattern}`)
    const min = spec.MinLength === undefined ? undefined : Number(spec.MinLength)
    const max = spec.MaxLength === undefined ? undefined : Number(spec.MaxLength)
    if (min !== undefined && value.length < min) refusals.push(`${name}: shorter than ${min}`)
    if (max !== undefined && value.length > max) refusals.push(`${name}: longer than ${max}`)
  }
  for (const name of Object.keys(parameters)) {
    if (!(name in asRecord(asRecord(template).Parameters))) refusals.push(`${name}: not a parameter of the template`)
  }
  return refusals
}

const resolveCfn = (value: unknown, launch: Launch, values: Readonly<Record<string, string>>): unknown => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) return value.map((entry) => resolveCfn(entry, launch, values))
  const record = asRecord(value)
  const ref = asString(record.Ref)
  if (ref !== undefined && Object.keys(record).length === 1) {
    if (ref === 'AWS::Region') return launch.region
    if (ref === 'AWS::AccountId') return launch.account
    if (ref === 'AWS::Partition') return 'aws'
    if (ref in values) return values[ref]
    throw new Error(`cannot resolve Ref ${ref}`)
  }
  const join = record['Fn::Join']
  if (join !== undefined && Object.keys(record).length === 1) {
    const [delimiter, parts] = join as [string, unknown[]]
    return parts.map((part) => String(resolveCfn(part, launch, values))).join(delimiter)
  }
  if (Object.keys(record).some((key) => key.startsWith('Fn::'))) throw new Error(`cannot resolve ${JSON.stringify(record)}`)
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, resolveCfn(entry, launch, values)]))
}

/**
 * The role a CloudFormation template creates when launched as `launch` describes, or undefined when
 * CloudFormation refuses the launch and creates nothing.
 */
export const launchedRole = (template: unknown, launch: Launch): ResolvedRole | undefined => {
  if (refusedParameters(template, launch.parameters).length > 0) return undefined
  const values: Record<string, string> = {}
  for (const [name, spec] of Object.entries(asRecord(asRecord(template).Parameters))) {
    const value = launch.parameters[name] ?? asString(asRecord(spec).Default)
    if (value !== undefined) values[name] = value
  }
  const resources = Object.values(asRecord(asRecord(template).Resources)).map(asRecord)
  const ofType = (type: string): Record<string, unknown> => {
    const matches = resources.filter((resource) => resource.Type === type)
    if (matches.length !== 1) throw new Error(`expected one ${type}, found ${matches.length}`)
    return asRecord(matches[0].Properties)
  }
  return {
    trust: resolveCfn(ofType('AWS::IAM::Role').AssumeRolePolicyDocument, launch, values),
    permissions: resolveCfn(ofType('AWS::IAM::Policy').PolicyDocument, launch, values),
  }
}
