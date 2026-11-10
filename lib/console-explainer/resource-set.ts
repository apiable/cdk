/**
 * The hand-build set for a construct whose resources reference each other: every resource its published
 * template creates, each with the kind, type and identity the explainer derives and its settings fully
 * resolved, in an order a person can build them in. Generated from the template, never written by hand.
 *
 * Its resolver is not the gateway role's. That one refuses every function but `Ref` and `Fn::Join`,
 * which is right for a set of two documents that never reference each other; a composed stack needs
 * resource references, ARN attributes and its log-source condition. The discipline is the same: a
 * value this resolver cannot derive refuses the whole set, so nothing half-resolved is ever written.
 */
import { describeResource } from './enumerate'
import { ResourceKind } from './descriptor'
import { derivedArnOf, physicalNameOf } from './resource-names'
import { ACCOUNT_TOKEN, REGION_TOKEN } from '../parity-gate/model'

/** One resource a person creates by hand. */
export interface ConsoleResource {
  readonly kind: ResourceKind
  readonly cfnType: string
  readonly identity: string
  readonly document: Record<string, unknown>
}

/** The set published as `console-instructions.json` for a construct with a resource-list hand-build. */
export interface ConsoleResourceSet {
  readonly construct: string
  readonly version: string
  /** The default each documented input resolves to: the path through the template this set describes. */
  readonly documents: Readonly<Record<string, string>>
  readonly resources: readonly ConsoleResource[]
}

export interface ConsoleResourceSetOptions {
  readonly construct: string
  readonly version: string
  /** The token each tokenised input becomes; an input absent here resolves to its default. */
  readonly parameterTokens: Readonly<Record<string, string>>
  /** Each `documents` entry and the input whose default it records. */
  readonly documentedParameters: Readonly<Record<string, string>>
}

interface TemplateResource {
  readonly type: string
  readonly properties: Record<string, unknown>
  /** The template condition the resource is created under, when it has one. */
  readonly condition?: string
}

const NO_VALUE = Symbol('AWS::NoValue')
type Resolved = unknown

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isIntrinsicKey = (key: string): boolean => key === 'Ref' || key.startsWith('Fn::')

/** The first deploy-time reference anywhere in `value`, as its key, or `undefined` when none remains. */
export const findDeployTimeReference = (value: unknown): string | undefined => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDeployTimeReference(item)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (!isRecord(value)) return undefined
  for (const [key, child] of Object.entries(value)) {
    if (key === 'Ref' || key.startsWith('Fn::')) return key
    const found = findDeployTimeReference(child)
    if (found !== undefined) return found
  }
  return undefined
}

const readResources = (template: unknown): ReadonlyMap<string, TemplateResource> => {
  const resources = isRecord(template) ? template.Resources : undefined
  if (!isRecord(resources) || Object.keys(resources).length === 0) {
    throw new Error('the template carries no Resources: it is not a CloudFormation template a set can be generated from')
  }
  const byId = new Map<string, TemplateResource>()
  for (const [id, spec] of Object.entries(resources)) {
    if (!isRecord(spec) || typeof spec.Type !== 'string') throw new Error(`resource ${id} carries no Type`)
    if (spec.Condition !== undefined && typeof spec.Condition !== 'string') throw new Error(`resource ${id} names a condition that is not a condition name`)
    byId.set(id, {
      type: spec.Type,
      properties: isRecord(spec.Properties) ? spec.Properties : {},
      ...(typeof spec.Condition === 'string' ? { condition: spec.Condition } : {}),
    })
  }
  return byId
}

const PSEUDO_PARAMETERS: Readonly<Record<string, string | typeof NO_VALUE>> = {
  'AWS::Region': REGION_TOKEN,
  'AWS::AccountId': ACCOUNT_TOKEN,
  'AWS::Partition': 'aws',
  'AWS::NoValue': NO_VALUE,
}

/** Every resource id `value` references, by `Ref`, `Fn::GetAtt` or a `Fn::Sub` placeholder. */
const referencedResources = (value: unknown, resourceIds: ReadonlySet<string>, into: Set<string>): Set<string> => {
  if (Array.isArray(value)) {
    value.forEach((item) => referencedResources(item, resourceIds, into))
  } else if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'Ref' && typeof child === 'string' && resourceIds.has(child)) into.add(child)
      if (key === 'Fn::GetAtt') {
        const target = Array.isArray(child) ? child[0] : typeof child === 'string' ? child.split('.')[0] : undefined
        if (typeof target === 'string' && resourceIds.has(target)) into.add(target)
      }
      if (key === 'Fn::Sub') {
        const text = Array.isArray(child) ? child[0] : child
        if (typeof text === 'string') {
          for (const [, name] of text.matchAll(/\$\{([^!}][^}]*)\}/g)) {
            const target = name.split('.')[0]
            if (resourceIds.has(target)) into.add(target)
          }
        }
      }
      referencedResources(child, resourceIds, into)
    }
  }
  return into
}

/** Resource ids in dependency order: none precedes a resource it references, ties in template order. */
const buildOrder = (resources: ReadonlyMap<string, TemplateResource>): string[] => {
  const ids = [...resources.keys()]
  const idSet = new Set(ids)
  const dependsOn = new Map(
    ids.map((id) => {
      const refs = referencedResources(resources.get(id)?.properties, idSet, new Set())
      refs.delete(id)
      return [id, refs] as const
    }),
  )
  const ordered: string[] = []
  const placed = new Set<string>()
  while (ordered.length < ids.length) {
    const next = ids.find((id) => !placed.has(id) && [...(dependsOn.get(id) ?? [])].every((dep) => placed.has(dep)))
    if (next === undefined) {
      throw new Error(`resources ${ids.filter((id) => !placed.has(id)).join(', ')} reference each other in a cycle: no build order exists`)
    }
    ordered.push(next)
    placed.add(next)
  }
  return ordered
}

const makeResolver = (template: unknown, resources: ReadonlyMap<string, TemplateResource>, options: ConsoleResourceSetOptions) => {
  const parameters = isRecord(template) && isRecord(template.Parameters) ? template.Parameters : {}
  const conditions = isRecord(template) && isRecord(template.Conditions) ? template.Conditions : {}
  const namesInProgress = new Set<string>()

  const parameterDefault = (name: string): string => {
    const spec = parameters[name]
    const value = isRecord(spec) ? spec.Default : undefined
    if (typeof value === 'string' || typeof value === 'number') return String(value)
    throw new Error(`input ${name} has neither a token nor a default: the set cannot derive its value`)
  }

  const resolveRef = (name: string): Resolved => {
    if (name in PSEUDO_PARAMETERS) return PSEUDO_PARAMETERS[name]
    if (name.startsWith('AWS::')) throw new Error(`cannot derive the pseudo-reference ${name}`)
    if (name in parameters) return options.parameterTokens[name] ?? parameterDefault(name)
    if (resources.has(name)) return physicalName(name)
    throw new Error(`Ref ${name} names neither an input nor a resource of the template`)
  }

  const physicalName = (id: string): string => {
    const resource = resources.get(id)
    if (resource === undefined) throw new Error(`no resource ${id} in the template`)
    if (namesInProgress.has(id)) throw new Error(`the name of ${id} references itself`)
    namesInProgress.add(id)
    try {
      const resolvedProperties = resolveObject(resource.properties)
      const name = physicalNameOf(resource.type, resolvedProperties)
      if (name === undefined) throw new Error(`cannot derive a fixed name for ${id} (${resource.type})`)
      return name
    } finally {
      namesInProgress.delete(id)
    }
  }

  const resolveGetAtt = (id: string, attribute: string): string => {
    const resource = resources.get(id)
    if (resource === undefined) throw new Error(`Fn::GetAtt names no resource ${id}`)
    const arn = attribute === 'Arn' ? derivedArnOf(resource.type, physicalName(id), REGION_TOKEN, ACCOUNT_TOKEN) : undefined
    if (arn === undefined) throw new Error(`cannot derive ${id}.${attribute} (${resource.type})`)
    return arn
  }

  const asText = (value: Resolved, context: string): string => {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    throw new Error(`${context} resolves to a value that is not text`)
  }

  const resolveSub = (argument: unknown): string => {
    const [text, variables] = Array.isArray(argument) ? argument : [argument, {}]
    if (typeof text !== 'string' || !isRecord(variables)) throw new Error('Fn::Sub carries no template text')
    return text.replace(/\$\{([^}]*)\}/g, (_match, name: string) => {
      if (name.startsWith('!')) return `\${${name.slice(1)}}`
      if (name in variables) return asText(resolve(variables[name]), `Fn::Sub variable ${name}`)
      const [target, attribute] = name.split('.')
      return attribute === undefined ? asText(resolveRef(target), `Fn::Sub \${${name}}`) : resolveGetAtt(target, attribute)
    })
  }

  const conditionHolds = (name: string): boolean => {
    if (!(name in conditions)) throw new Error(`condition ${name} is not declared by the template`)
    return evaluateCondition(conditions[name], name)
  }

  const evaluateCondition = (expression: unknown, name: string): boolean => {
    if (!isRecord(expression) || Object.keys(expression).length !== 1) throw new Error(`condition ${name} is not a condition function`)
    const [[fn, argument]] = Object.entries(expression)
    const operands = Array.isArray(argument) ? argument : []
    switch (fn) {
      case 'Fn::Equals': {
        const [left, right] = operands.map((operand) => conditionOperand(operand, name))
        return left === right
      }
      case 'Fn::Not':
        return !evaluateCondition(operands[0], name)
      case 'Fn::And':
        return operands.every((operand) => evaluateCondition(operand, name))
      case 'Fn::Or':
        return operands.some((operand) => evaluateCondition(operand, name))
      case 'Condition':
        if (typeof argument !== 'string') throw new Error(`condition ${name} names no condition`)
        return conditionHolds(argument)
      default:
        throw new Error(`condition ${name} uses ${fn}, which the set cannot evaluate`)
    }
  }

  /** An operand is compared over the inputs' defaults: a value only a deployment knows cannot decide it. */
  const conditionOperand = (operand: unknown, name: string): string => {
    const value = isRecord(operand) && typeof operand.Ref === 'string' && operand.Ref in parameters
      ? parameterDefault(operand.Ref)
      : asText(resolve(operand), `condition ${name}`)
    if (/\{[a-z-]+\}/.test(value)) throw new Error(`condition ${name} depends on ${value}, which only a deployment knows`)
    return value
  }

  const resolveIntrinsic = (fn: string, argument: unknown): Resolved => {
    switch (fn) {
      case 'Ref':
        if (typeof argument !== 'string') throw new Error('Ref names nothing')
        return resolveRef(argument)
      case 'Fn::GetAtt': {
        const [id, attribute] = Array.isArray(argument) ? argument : typeof argument === 'string' ? argument.split('.') : []
        if (typeof id !== 'string' || typeof attribute !== 'string') throw new Error('Fn::GetAtt names no resource attribute')
        return resolveGetAtt(id, attribute)
      }
      case 'Fn::Join': {
        const [delimiter, parts] = Array.isArray(argument) ? argument : []
        if (typeof delimiter !== 'string' || !Array.isArray(parts)) throw new Error('Fn::Join carries no delimiter and list')
        return parts.map((part) => asText(resolve(part), 'a Fn::Join part')).join(delimiter)
      }
      case 'Fn::Sub':
        return resolveSub(argument)
      case 'Fn::If': {
        const [condition, whenTrue, whenFalse] = Array.isArray(argument) ? argument : []
        if (typeof condition !== 'string') throw new Error('Fn::If names no condition')
        return resolve(conditionHolds(condition) ? whenTrue : whenFalse)
      }
      default:
        throw new Error(`cannot derive ${fn}: the set resolves Ref, Fn::GetAtt, Fn::Join, Fn::Sub and Fn::If only`)
    }
  }

  const resolveObject = (value: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      const resolved = resolve(child)
      if (resolved !== NO_VALUE) out[key] = resolved
    }
    return out
  }

  const resolve = (value: unknown): Resolved => {
    if (Array.isArray(value)) return value.map(resolve).filter((item) => item !== NO_VALUE)
    if (!isRecord(value)) return value
    const keys = Object.keys(value)
    const intrinsic = keys.find(isIntrinsicKey)
    if (intrinsic === undefined) return resolveObject(value)
    if (keys.length !== 1) throw new Error(`${intrinsic} shares its object with other keys: not a deploy-time reference the set can derive`)
    return resolveIntrinsic(intrinsic, value[intrinsic])
  }

  return { resolveObject, parameterDefault, conditionHolds }
}

/**
 * Generate the hand-build set from a published template. Throws, naming what it could not derive, on
 * any function, attribute or input outside the rules above, so a set is either whole or not produced.
 */
export const generateConsoleResourceSet = (template: unknown, options: ConsoleResourceSetOptions): ConsoleResourceSet => {
  const declared = readResources(template)
  const { conditionHolds } = makeResolver(template, declared, options)
  // A resource created only under a condition the documented defaults do not meet is not on this path.
  const resources = new Map([...declared].filter(([, resource]) => resource.condition === undefined || conditionHolds(resource.condition)))
  const { resolveObject, parameterDefault } = makeResolver(template, resources, options)
  const documents = Object.fromEntries(
    Object.entries(options.documentedParameters).map(([key, parameter]) => [key, parameterDefault(parameter)]),
  )
  const entries = buildOrder(resources).map((id): ConsoleResource => {
    const resource = resources.get(id) as TemplateResource
    const document = resolveObject(resource.properties)
    const { kind, identity } = describeResource(options.construct, id, resource.type, document)
    if (kind === 'resource-output') throw new Error(`resource ${id} described as a stack output`)
    return { kind, cfnType: resource.type, identity, document }
  })
  return { construct: options.construct, version: options.version, documents, resources: entries }
}

/** The set as the bytes published: two-space JSON with a trailing newline, key order as built. */
export const serializeConsoleResourceSet = (set: ConsoleResourceSet): string => `${JSON.stringify(set, null, 2)}\n`
