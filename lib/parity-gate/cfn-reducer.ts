/**
 * Reduce a CloudFormation template to the comparable parity model. Drives two channels: the CDK
 * construct (`Template.fromStack(...).toJSON()`) and the published launch-stack template parsed
 * from YAML — both are CloudFormation, so they share this reducer.
 *
 * Intrinsics are resolved to logical references: pseudo-parameters and parameter Refs collapse to
 * account/region tokens, `Fn::GetAtt` and resource `Ref`s become graph edges. Anything that is
 * not load-bearing (a description, a runtime patch revision, a log-retention period) is routed to
 * cosmetics so it can only warn.
 */
import {
  ACCOUNT_TOKEN,
  Channel,
  ChannelModel,
  namespaceByRef,
  normaliseLogical,
  OAuthConfig,
  PermissionGrant,
  REGION_TOKEN,
  ResourceEdge,
  ResourceNode,
  SecretRef,
} from './model'
import { canonicalCfnKind, nodeRef, policyServices } from './canonical'
import { grantsFromPolicyDocument, trustedAccountsOf } from './iam'
import { asArray, asRecord, asString, asStringArray, isRecord } from './narrow'

interface CfnResource {
  readonly type: string
  readonly properties: Record<string, unknown>
}

const PSEUDO: Readonly<Record<string, string>> = {
  'AWS::Region': REGION_TOKEN,
  'AWS::Partition': 'aws',
  'AWS::AccountId': ACCOUNT_TOKEN,
  'AWS::URLSuffix': 'amazonaws.com',
}

const SECRET_KEY = /(secret|password|private_?key|signing_?key|token|api_?key)/i

/** Resolve a CloudFormation value to a comparable string, collapsing pseudo-params + parameter Refs to tokens. */
const makeResolver =
  (parameters: Readonly<Record<string, string>>) =>
  (value: unknown): string => {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (!isRecord(value)) return ''
    const ref = asString(value.Ref)
    if (ref !== undefined) return PSEUDO[ref] ?? parameters[ref] ?? `@ref:${ref}`
    const join = value['Fn::Join']
    if (Array.isArray(join) && join.length === 2) {
      const delimiter = asString(join[0]) ?? ''
      return asArray(join[1])
        .map((part) => makeResolver(parameters)(part))
        .join(delimiter)
    }
    const getAtt = value['Fn::GetAtt']
    if (Array.isArray(getAtt)) return `@getatt:${asString(getAtt[0]) ?? ''}:${asString(getAtt[1]) ?? ''}`
    const sub = asString(value['Fn::Sub'])
    if (sub !== undefined) return sub.replace(/\$\{([^}]+)\}/g, (_m, key: string) => PSEUDO[key] ?? parameters[key] ?? `@ref:${key}`)
    return ''
  }

/** Every resource logical id referenced (via Ref or Fn::GetAtt) anywhere inside a value tree. */
const resourceRefsIn = (value: unknown, resourceIds: ReadonlySet<string>): { id: string; attr: string }[] => {
  if (isRecord(value)) {
    const ref = asString(value.Ref)
    if (ref !== undefined && resourceIds.has(ref)) return [{ id: ref, attr: 'ref' }]
    const getAtt = value['Fn::GetAtt']
    if (Array.isArray(getAtt)) {
      const id = asString(getAtt[0]) ?? ''
      if (resourceIds.has(id)) return [{ id, attr: (asString(getAtt[1]) ?? 'ref').toLowerCase() }]
    }
    return Object.values(value).flatMap((v) => resourceRefsIn(v, resourceIds))
  }
  if (Array.isArray(value)) return value.flatMap((v) => resourceRefsIn(v, resourceIds))
  return []
}

/** Channel-stable discriminator for a resource, derived only from account/region-agnostic attributes. */
const discriminatorFor = (
  kind: string,
  props: Record<string, unknown>,
  resolve: (v: unknown) => string,
  region: string | undefined,
): string | undefined => {
  switch (kind) {
    case 'iam-role':
      return normaliseLogical(resolve(props.RoleName), region) || undefined
    case 'iam-inline-policy': {
      const statements = asArray(asRecord(props.PolicyDocument).Statement)
      const allActions = statements.flatMap((s) => {
        const action = asRecord(s).Action
        return typeof action === 'string' ? [action] : asStringArray(action)
      })
      return policyServices(allActions) || undefined
    }
    case 'cognito-user-pool':
      return normaliseLogical(resolve(props.UserPoolName), region) || 'pool'
    case 'cognito-user-pool-client':
      return normaliseLogical(resolve(props.ClientName), region) || 'client'
    case 'cognito-resource-server':
      return asString(props.Identifier) ?? 'resource-server'
    case 'apigateway-authorizer':
      return normaliseLogical(resolve(props.Name), region) || 'authorizer'
    case 'lambda-function':
      return normaliseLogical(resolve(props.FunctionName), region) || 'function'
    default:
      return undefined
  }
}

const collectValues = (kind: string, props: Record<string, unknown>): Record<string, string> => {
  const values: Record<string, string> = {}
  if (kind === 'cognito-user-pool') {
    const lambdaConfig = asRecord(props.LambdaConfig)
    const preTokenConfig = asRecord(lambdaConfig.PreTokenGenerationConfig)
    const explicitVersion = asString(preTokenConfig.LambdaVersion)
    const legacyAttached = lambdaConfig.PreTokenGeneration !== undefined
    if (explicitVersion !== undefined) values['pretokengen-version'] = explicitVersion
    else if (legacyAttached) values['pretokengen-version'] = 'V1_0'
    const tier = asString(props.UserPoolTier)
    if (tier !== undefined) values['user-pool-tier'] = tier
  }
  if (kind === 'cognito-user-pool-client') {
    const flows = asStringArray(props.AllowedOAuthFlows)
    if (flows.length > 0) values['oauth-flows'] = [...flows].sort().join(',')
    const scopes = asStringArray(props.AllowedOAuthScopes)
    if (scopes.length > 0) values['oauth-scopes'] = [...scopes].sort().join(',')
    if (props.GenerateSecret !== undefined) values['generate-secret'] = String(props.GenerateSecret)
  }
  if (kind === 'apigateway-authorizer') {
    const type = asString(props.Type)
    if (type !== undefined) values['authorizer-type'] = type
    const identitySource = asString(props.IdentitySource)
    if (identitySource !== undefined) values['authorizer-identity-source'] = identitySource.split('.').pop() ?? identitySource
    const apiKeySource = asString(props.ApiKeySource ?? props.AuthorizerApiKeySource)
    if (apiKeySource !== undefined) values['authorizer-api-key-source'] = apiKeySource
  }
  return values
}

const collectCosmetics = (kind: string, props: Record<string, unknown>): Record<string, string> => {
  const cosmetics: Record<string, string> = {}
  const description = asString(props.Description)
  if (description !== undefined) cosmetics[`description:${kind}`] = description
  const runtime = asString(props.Runtime)
  if (runtime !== undefined) cosmetics[`runtime:${kind}`] = runtime
  return cosmetics
}

const collectSecrets = (props: Record<string, unknown>): SecretRef[] => {
  const variables = asRecord(asRecord(props.Environment).Variables)
  return Object.entries(variables)
    .filter(([key]) => SECRET_KEY.test(key))
    .map(([key, value]) => ({
      ref: `secret:${key.toLowerCase()}`,
      wired: value !== undefined && value !== null && value !== '',
    }))
}

const oauthFrom = (props: Record<string, unknown>): OAuthConfig | undefined => {
  const flows = asStringArray(props.AllowedOAuthFlows)
  const scopes = asStringArray(props.AllowedOAuthScopes)
  if (flows.length === 0 && scopes.length === 0) return undefined
  return { flows: [...flows].sort(), scopes: [...scopes].sort() }
}

const lambdaPermissionGrant = (
  props: Record<string, unknown>,
  resolve: (v: unknown) => string,
  region: string | undefined,
): PermissionGrant => {
  const principal = normaliseLogical(resolve(props.Principal), region)
  const action = asString(props.Action) ?? 'lambda:InvokeFunction'
  const sourceArn = props.SourceArn === undefined ? undefined : normaliseLogical(resolve(props.SourceArn), region)
  return {
    ref: `grant:invoke:${principal}`,
    effect: 'Allow',
    actions: [action],
    resources: [],
    principal,
    ...(sourceArn !== undefined && sourceArn !== '' ? { sourceArn } : {}),
  }
}

/** Reduce a parsed CloudFormation template into a {@link ChannelModel} for `channel`. */
export const reduceCloudFormation = (template: unknown, channel: Channel, region?: string): ChannelModel => {
  const root = asRecord(template)
  const resourcesRecord = asRecord(root.Resources)
  const wellFormed = isRecord(template) && isRecord(root.Resources) && Object.keys(resourcesRecord).length > 0

  const parameters: Record<string, string> = {}
  for (const [name, spec] of Object.entries(asRecord(root.Parameters))) {
    const def = asString(asRecord(spec).Default)
    if (def !== undefined) parameters[name] = def
  }
  const resolve = makeResolver(parameters)

  const resources: Record<string, CfnResource> = {}
  for (const [id, spec] of Object.entries(resourcesRecord)) {
    const type = asString(asRecord(spec).Type)
    if (type !== undefined) resources[id] = { type, properties: asRecord(asRecord(spec).Properties) }
  }
  const resourceIds = new Set(Object.keys(resources))

  const refToNode = new Map<string, string>()
  for (const [id, res] of Object.entries(resources)) {
    const kind = canonicalCfnKind(res.type)
    refToNode.set(id, nodeRef(kind, discriminatorFor(kind, res.properties, resolve, region)))
  }

  const nodes: ResourceNode[] = []
  const edges: ResourceEdge[] = []
  let values: Record<string, string> = {}
  let cosmetics: Record<string, string> = {}
  const grants: PermissionGrant[] = []
  const secrets: SecretRef[] = []
  let oauth: OAuthConfig | undefined

  for (const [id, res] of Object.entries(resources)) {
    const kind = canonicalCfnKind(res.type)
    const ref = refToNode.get(id) ?? kind
    nodes.push({ ref, kind })
    values = { ...values, ...namespaceByRef(collectValues(kind, res.properties), ref) }
    cosmetics = { ...cosmetics, ...collectCosmetics(kind, res.properties) }
    secrets.push(...collectSecrets(res.properties))

    if (kind === 'iam-role') {
      grants.push(
        ...grantsFromPolicyDocument(res.properties.AssumeRolePolicyDocument, resolve, region, 'trust'),
      )
      values[`role-name:${ref}`] = normaliseLogical(resolve(res.properties.RoleName), region)
      const trustAccount = trustedAccountsOf(res.properties.AssumeRolePolicyDocument, resolve)
      if (trustAccount !== undefined) values[`role-trust-account:${ref}`] = trustAccount
    }
    if (kind === 'iam-inline-policy') {
      grants.push(...grantsFromPolicyDocument(res.properties.PolicyDocument, resolve, region, 'inline'))
      for (const target of resourceRefsIn(res.properties.Roles, resourceIds)) {
        edges.push({ from: ref, to: refToNode.get(target.id) ?? target.id, relation: 'attached-to-role' })
      }
    }
    if (kind === 'lambda-permission') {
      grants.push(lambdaPermissionGrant(res.properties, resolve, region))
      for (const target of resourceRefsIn(res.properties.FunctionName, resourceIds)) {
        edges.push({ from: ref, to: refToNode.get(target.id) ?? target.id, relation: 'invokes' })
      }
    }
    const clientOauth = kind === 'cognito-user-pool-client' ? oauthFrom(res.properties) : undefined
    if (clientOauth !== undefined) oauth = clientOauth
  }

  for (const [name, spec] of Object.entries(asRecord(root.Outputs))) {
    const targets = resourceRefsIn(asRecord(spec).Value, resourceIds)
    if (targets.length === 0) continue
    const target = targets[0]
    const targetKind = canonicalCfnKind(resources[target.id].type)
    const outputRef = nodeRef('output', `${targetKind}.${target.attr}`)
    nodes.push({ ref: outputRef, kind: 'output' })
    edges.push({ from: outputRef, to: refToNode.get(target.id) ?? target.id, relation: `exports:${target.attr}` })
    void name
  }

  return { channel, wellFormed, graph: { nodes, edges }, values, grants, secrets, oauth, cosmetics }
}
