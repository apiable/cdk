/**
 * Reduce a hand-build resource set (the usage-events kind, a list of resolved resources) to the parity
 * gate's comparable model: the fourth channel beside the CDK construct, the published template and the
 * Terraform module. As with the gateway role's set, it rebuilds a CloudFormation artifact and hands it
 * to `reduceCloudFormation`, so this channel's nodes and grants land on the keys the cdk and cfn
 * channels use; nothing here builds a node or grant key by hand.
 *
 * The rebuild inverts exactly the generator's substitutions and nothing more. A value that equals a
 * resource's derived ARN or fixed name in this same set becomes a reference to that resource again,
 * and a token still in the set becomes a `Ref` to its input, declared with the template's default so it
 * reduces as the other channels reduce it. A set the portal has filled carries the values instead. Anything else stays the literal it
 * is, so a stream pointed at a bucket the set does not create is a grant on a foreign ARN and diverges.
 * Each primary's declared identity is read from its own document's tag, so a set that lost one shows
 * as the gate's missing-id sentinel.
 */
import type { ConsoleResourceSet } from '../console-explainer/resource-set'
import { derivedArnOf, physicalNameOf, PHYSICAL_NAME_PROPERTY } from '../console-explainer/resource-names'
import { reduceCloudFormation } from './cfn-reducer'
import { DECLARED_ID_TAG } from './canonical'
import { ACCOUNT_TOKEN, ChannelModel, REGION_TOKEN } from './model'
import { isRecord } from './narrow'

/** A stack output the other channels export, re-added from the set: the resource it names and the attribute. */
export interface ConsoleResourceSetExport {
  readonly cfnType: string
  /** Narrows the match to the resource carrying this declared identity, where the type alone is ambiguous. */
  readonly declaredId?: string
  readonly attribute: 'Ref' | 'Arn'
}

/** A tokenised input: the token the generator wrote for it, and the template's default for it, if any. */
export interface ConsoleResourceSetParameter {
  readonly token: string
  readonly default?: string
}

export interface ConsoleResourceSetReduction {
  /** Each tokenised input; a token left in the set goes back to a `Ref` of its input, declared with the same default. */
  readonly parameters: Readonly<Record<string, ConsoleResourceSetParameter>>
  readonly exports: readonly ConsoleResourceSetExport[]
}

interface Linkable {
  readonly id: string
  readonly name: string | undefined
  readonly arn: string | undefined
}

const declaredIdOf = (document: Record<string, unknown>): string | undefined => {
  const tags = Array.isArray(document.Tags) ? document.Tags : []
  const tag = tags.find((candidate) => isRecord(candidate) && candidate.Key === DECLARED_ID_TAG)
  return isRecord(tag) && typeof tag.Value === 'string' ? tag.Value : undefined
}

/** `text` with each token occurrence put back as a `Ref` of its input, joined; unchanged when it holds none. */
const invertTokens = (text: string, refByToken: ReadonlyMap<string, string>): unknown => {
  if (![...refByToken.keys()].some((token) => text.includes(token))) return text
  const pattern = new RegExp(`(${[...refByToken.keys()].map((token) => token.replace(/[{}]/g, '\\$&')).join('|')})`)
  const parts = text.split(pattern).filter((part) => part !== '')
  return { 'Fn::Join': ['', parts.map((part) => (refByToken.has(part) ? { Ref: refByToken.get(part) } : part))] }
}

/** An ARN with its region segment written as the region token, so it compares with a derived ARN; any other value as it is. */
const regionTokenised = (value: string, region: string): string => {
  const segments = value.split(':')
  return segments[0] === 'arn' && segments[3] === region ? [...segments.slice(0, 3), REGION_TOKEN, ...segments.slice(4)].join(':') : value
}

export const reduceConsoleResourceSet = (
  set: ConsoleResourceSet,
  region: string,
  reduction: ConsoleResourceSetReduction,
): ChannelModel => {
  const refByToken = new Map(Object.entries(reduction.parameters).map(([parameter, { token }]) => [token, parameter]))
  const linkables: Linkable[] = set.resources.map((resource, index) => {
    const name = physicalNameOf(resource.cfnType, resource.document)
    return {
      id: `Console${index}`,
      name,
      arn: name === undefined ? undefined : derivedArnOf(resource.cfnType, name, REGION_TOKEN, ACCOUNT_TOKEN),
    }
  })

  // Re-link a literal to the resource it exactly names, never to the resource that owns the property.
  const relink = (value: unknown, ownId: string): unknown => {
    if (Array.isArray(value)) return value.map((item) => relink(item, ownId))
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, relink(child, ownId)]))
    if (typeof value !== 'string') return value
    const regionless = regionTokenised(value, region)
    for (const target of linkables) {
      if (target.id === ownId) continue
      if (target.arn !== undefined && regionless === target.arn) return { 'Fn::GetAtt': [target.id, 'Arn'] }
      if (target.arn !== undefined && regionless.startsWith(`${target.arn}/`)) {
        return { 'Fn::Join': ['', [{ 'Fn::GetAtt': [target.id, 'Arn'] }, regionless.slice(target.arn.length)]] }
      }
      if (target.name !== undefined && value === target.name) return { Ref: target.id }
    }
    return invertTokens(value, refByToken)
  }

  const resources = Object.fromEntries(
    set.resources.map((resource, index) => {
      const { id } = linkables[index]
      const nameProperty = PHYSICAL_NAME_PROPERTY[resource.cfnType]
      const properties = Object.fromEntries(
        Object.entries(resource.document).map(([key, child]) => [
          key,
          key === nameProperty && typeof child === 'string' ? invertTokens(child, refByToken) : relink(child, id),
        ]),
      )
      return [id, { Type: resource.cfnType, Properties: properties }]
    }),
  )

  const outputs = Object.fromEntries(
    reduction.exports.flatMap((exported, index) => {
      const match = set.resources.findIndex(
        (resource) =>
          resource.cfnType === exported.cfnType &&
          (exported.declaredId === undefined || declaredIdOf(resource.document) === exported.declaredId),
      )
      if (match < 0) return []
      const { id } = linkables[match]
      return [[`Export${index}`, { Value: exported.attribute === 'Ref' ? { Ref: id } : { 'Fn::GetAtt': [id, 'Arn'] } }]]
    }),
  )

  const parameters = Object.fromEntries(
    Object.entries(reduction.parameters).map(([parameter, declared]) => [
      parameter,
      { Type: 'String', ...(declared.default === undefined ? {} : { Default: declared.default }) },
    ]),
  )
  return reduceCloudFormation({ Parameters: parameters, Resources: resources, Outputs: outputs }, 'console', region)
}
