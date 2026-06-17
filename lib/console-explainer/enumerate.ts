import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import {
  ConsoleDeepLink,
  ResourceDescriptor,
  ResourceEnumeration,
  ResourceKind,
} from './descriptor'

/**
 * The synthesized CloudFormation shape the enumeration is derived from. Reading the synth output —
 * rather than a hand-maintained parallel list — is the accuracy guarantee: the audit document cannot
 * list a resource the construct does not create, nor miss one it does.
 */
interface SynthesizedTemplate {
  readonly Resources?: Record<string, { Type: string; Properties?: Record<string, unknown> }>
  readonly Outputs?: Record<string, { Value?: unknown; Description?: unknown }>
}

/** CloudFormation resource types the explainer enumerates, mapped to the descriptor kind. */
const RESOURCE_KIND_BY_CFN_TYPE: Record<string, ResourceKind> = {
  'AWS::IAM::Role': 'iam-role',
  'AWS::IAM::Policy': 'iam-policy',
  'AWS::S3::Bucket': 'bucket',
  'AWS::KinesisFirehose::DeliveryStream': 'stream',
  'AWS::SSM::Parameter': 'ssm-parameter',
}

/** AWS Console service a resource kind is viewed under; absent kinds have no console representation. */
const CONSOLE_SERVICE_BY_KIND: Partial<Record<ResourceKind, string>> = {
  'iam-role': 'iam',
  'iam-policy': 'iam',
  bucket: 's3',
  stream: 'firehose',
  'ssm-parameter': 'systems-manager',
}

const KEY_SEGMENT_PATTERN = /[^a-z0-9]+/g

/** Lower-kebab a value into a single content-key segment. */
const toKeySegment = (value: string): string =>
  value.toLowerCase().replace(KEY_SEGMENT_PATTERN, '-').replace(/^-+|-+$/g, '')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/**
 * The stable identity of a resource: its physical name where the construct fixes one (the value the
 * console addresses it by), otherwise its synthesized logical id. Property names are read positionally
 * per kind because only the construct's own fixed names are stable across synths.
 */
const resourceIdentity = (logicalId: string, kind: ResourceKind, properties: Record<string, unknown>): string => {
  const named = (key: string): string | undefined => {
    const value = properties[key]
    return typeof value === 'string' && !cdk.Token.isUnresolved(value) ? value : undefined
  }
  switch (kind) {
    case 'iam-role':
      return named('RoleName') ?? logicalId
    case 'bucket':
      return named('BucketName') ?? logicalId
    case 'stream':
      return named('DeliveryStreamName') ?? logicalId
    case 'ssm-parameter':
      return named('Name') ?? logicalId
    default:
      return logicalId
  }
}

/**
 * Derive the console deep-link shape from a resource's kind and identity. Returns `undefined` for a
 * resource with no console representation, and for one whose identity is only a synthesized logical id
 * (not a console-addressable name) so the link is never fabricated from a non-addressable token.
 */
const deriveConsoleDeepLink = (
  kind: ResourceKind,
  identity: string,
  hasFixedName: boolean,
): ConsoleDeepLink | undefined => {
  const service = CONSOLE_SERVICE_BY_KIND[kind]
  if (!service || !hasFixedName) return undefined
  return { service, resourcePath: identity }
}

const describeResource = (
  component: string,
  logicalId: string,
  cfnType: string,
  properties: Record<string, unknown>,
): ResourceDescriptor | undefined => {
  const kind = RESOURCE_KIND_BY_CFN_TYPE[cfnType]
  if (!kind) return undefined
  const identity = resourceIdentity(logicalId, kind, properties)
  const hasFixedName = identity !== logicalId
  return {
    kind,
    identity,
    contentKey: `${component}/${kind}/${toKeySegment(identity)}`,
    consoleDeepLink: deriveConsoleDeepLink(kind, identity, hasFixedName),
  }
}

/**
 * Enumerate the resources a synthesized stack creates as typed descriptors, one per resource, derived
 * from the synthesized CloudFormation rather than a hand-maintained list. Each construct's enumeration
 * is namespaced under `component`. A synthesized stack output is enumerated as a `resource-output`
 * descriptor (an identifier the deployment surfaces, with no console representation of its own).
 *
 * The stable interface Epic 4 iterates: any stack that synthesizes is enumerated the same way, so a
 * newly added construct is adopted with no change on the consuming side.
 */
/**
 * Guard that content keys are unique within the construct. A clean key is built by kebab-collapsing a
 * unique identity, which is lossy, so a collision is possible in principle; surfacing it here fails the
 * build loudly rather than emitting two descriptors the side-loaded content cannot address apart.
 */
const assertUniqueContentKeys = (resources: readonly ResourceDescriptor[]): void => {
  const seen = new Set<string>()
  for (const { contentKey } of resources) {
    if (seen.has(contentKey)) {
      throw new Error(`duplicate content key "${contentKey}" — content keys must be unique within a construct`)
    }
    seen.add(contentKey)
  }
}

export const describeResources = (stack: cdk.Stack, component: string): ResourceEnumeration => {
  const template = Template.fromStack(stack).toJSON() as SynthesizedTemplate

  const resources: ResourceDescriptor[] = []

  for (const [logicalId, resource] of Object.entries(template.Resources ?? {})) {
    const properties = isRecord(resource.Properties) ? resource.Properties : {}
    const descriptor = describeResource(component, logicalId, resource.Type, properties)
    if (descriptor) resources.push(descriptor)
  }

  for (const logicalId of Object.keys(template.Outputs ?? {})) {
    resources.push({
      kind: 'resource-output',
      identity: logicalId,
      contentKey: `${component}/resource-output/${toKeySegment(logicalId)}`,
    })
  }

  assertUniqueContentKeys(resources)

  return { component, resources }
}
