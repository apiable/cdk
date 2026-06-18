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
  cognitoDiscovery,
  grantedAccountsValue,
  namespaceByRef,
  normaliseLogical,
  OAuthConfig,
  OidcDiscovery,
  poolNameFromRef,
  PermissionGrant,
  REGION_TOKEN,
  ResourceEdge,
  ResourceNode,
  SecretRef,
} from './model'
import { canonicalCfnKind, nodeRef, policyServices } from './canonical'
import { grantsFromPolicyDocument, resolvedPrincipalsOf, trustedAccountsOf } from './iam'
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
    case 's3-bucket':
      return normaliseLogical(resolve(props.BucketName), region) || 'bucket'
    default:
      return undefined
  }
}

/**
 * The normalised name of the bucket a bucket-policy secures — the channel-stable discriminator for
 * the policy node and the key its write grant is filed under. The policy references its bucket by a
 * channel-local logical id, so the stable identity is the referenced bucket node's discriminator
 * (its normalised name), not the raw ref. Absent when the bucket cannot be resolved from the graph.
 */
const securedBucketName = (bucketNodeRef: string | undefined): string | undefined => {
  if (bucketNodeRef === undefined) return undefined
  const prefix = 's3-bucket:'
  return bucketNodeRef.startsWith(prefix) ? bucketNodeRef.slice(prefix.length) : undefined
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
    // GenerateSecret defaults to false when omitted, so an explicit `false` and an omitted value
    // describe the same client and must read identically rather than as present-vs-absent.
    values['generate-secret'] = String(props.GenerateSecret ?? false)
  }
  if (kind === 'apigateway-authorizer') {
    const type = asString(props.Type)
    if (type !== undefined) values['authorizer-type'] = type
    const identitySource = asString(props.IdentitySource)
    if (identitySource !== undefined) values['authorizer-identity-source'] = identitySource.split('.').pop() ?? identitySource
    const apiKeySource = asString(props.ApiKeySource ?? props.AuthorizerApiKeySource)
    if (apiKeySource !== undefined) values['authorizer-api-key-source'] = apiKeySource
  }
  if (kind === 'cognito-resource-server') {
    const scopeNames = asArray(props.Scopes)
      .map((scope) => asString(asRecord(scope).ScopeName))
      .filter((name): name is string => name !== undefined)
    values['resource-server-scopes'] = [...new Set(scopeNames)].sort().join(',')
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

const oauthFrom = (props: Record<string, unknown>, discovery?: OidcDiscovery): OAuthConfig | undefined => {
  const flows = asStringArray(props.AllowedOAuthFlows)
  const scopes = asStringArray(props.AllowedOAuthScopes)
  if (flows.length === 0 && scopes.length === 0) return undefined
  return { flows: [...flows].sort(), scopes: [...scopes].sort(), ...(discovery !== undefined ? { discovery } : {}) }
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

/**
 * The write grants a bucket-policy confers, keyed per secured bucket so a multi-statement policy is
 * compared as the multiset of its statements (a widened or extra principal enlarges the set, never
 * silently collapses). One grant per statement carries the principals BY VALUE — the cross-account
 * write grant the storage tier exists to police — so a channel that widens who may write to the
 * bucket diverges on the permission tier. The policy document is the same `{ Statement: [] }` shape
 * an IAM policy carries, so the shared {@link grantsFromPolicyDocument} extracts it; only the ref is
 * re-filed under the bucket-policy key.
 */
const bucketPolicyGrants = (
  doc: unknown,
  resolve: (v: unknown) => string,
  region: string | undefined,
  bucketName: string | undefined,
  canonicaliseResource: (resource: string) => string,
): PermissionGrant[] => {
  const ref = `grant:bucket-policy:${bucketName ?? 'bucket'}`
  return grantsFromPolicyDocument(doc, resolve, region, 'inline', canonicaliseResource).map((grant) => ({ ...grant, ref }))
}

/**
 * Reduce a parsed CloudFormation template into a {@link ChannelModel} for `channel`. `deployAccount`
 * is the concrete account a non-published synth resolved `AWS::AccountId` into; supplied so the
 * incidental deploying account drops out of the bucket-policy by-value write-grant exactly as the
 * published channel's `AWS::AccountId` pseudo-parameter (a token, no digits) already does.
 */
export const reduceCloudFormation = (template: unknown, channel: Channel, region?: string, deployAccount?: string): ChannelModel => {
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
  // A bucket-policy carries no name of its own; its channel-stable identity is the bucket it secures,
  // so re-key its node by the referenced bucket's discriminator once every bucket node ref is known.
  for (const [id, res] of Object.entries(resources)) {
    if (canonicalCfnKind(res.type) !== 's3-bucket-policy') continue
    const bucketTarget = resourceRefsIn(res.properties.Bucket, resourceIds)[0]
    const bucketName = securedBucketName(bucketTarget !== undefined ? refToNode.get(bucketTarget.id) : undefined)
    refToNode.set(id, nodeRef('s3-bucket-policy', bucketName))
  }

  // The hosted-UI domain prefix per pool node ref, so a client's discovery document can carry the
  // pool's authorize/token endpoints. A UserPoolDomain references its pool via UserPoolId.
  const domainByPoolRef = new Map<string, string>()
  for (const res of Object.values(resources)) {
    if (canonicalCfnKind(res.type) !== 'cognito-user-pool-domain') continue
    const domain = asString(res.properties.Domain)
    if (domain === undefined) continue
    for (const target of resourceRefsIn(res.properties.UserPoolId, resourceIds)) {
      domainByPoolRef.set(refToNode.get(target.id) ?? target.id, domain)
    }
  }

  // A grant resource that is a `Fn::GetAtt` to a resource in this template resolves to `@getatt:<id>:<attr>`
  // with the channel-local logical id; map it back to that resource's channel-stable node ref (keeping any
  // trailing object path) so a self-referential ARN reconciles with the Terraform-resolved literal.
  const canonicaliseResource = (resource: string): string => {
    const match = /^@getatt:([^:]+):[^/]*(.*)$/.exec(resource)
    if (match === null) return resource
    const node = refToNode.get(match[1])
    return node === undefined ? resource : `${node}${match[2]}`
  }

  const nodes: ResourceNode[] = []
  const edges: ResourceEdge[] = []
  let values: Record<string, string> = {}
  let cosmetics: Record<string, string> = {}
  const grants: PermissionGrant[] = []
  const secrets: SecretRef[] = []
  let oauth: OAuthConfig | undefined
  const oauthByClient: Record<string, OAuthConfig> = {}

  // The cognito reference edges, alongside the inline-policy / lambda-permission / output edges: a
  // pool→pre-token function, a client/resource-server→pool, and an authorizer→rest-api binding all
  // become graph edges, so a resource bound to a different (or no) pool diverges on the graph tier.
  const cognitoEdge = (from: string, attribute: unknown, relation: string): void => {
    for (const target of resourceRefsIn(attribute, resourceIds)) {
      edges.push({ from, to: refToNode.get(target.id) ?? target.id, relation })
    }
  }

  for (const [id, res] of Object.entries(resources)) {
    const kind = canonicalCfnKind(res.type)
    const ref = refToNode.get(id) ?? kind
    nodes.push({ ref, kind })
    values = { ...values, ...namespaceByRef(collectValues(kind, res.properties), ref) }
    cosmetics = { ...cosmetics, ...collectCosmetics(kind, res.properties) }
    secrets.push(...collectSecrets(res.properties))

    if (kind === 'iam-role') {
      grants.push(
        ...grantsFromPolicyDocument(res.properties.AssumeRolePolicyDocument, resolve, region, 'trust', canonicaliseResource),
      )
      values[`role-name:${ref}`] = normaliseLogical(resolve(res.properties.RoleName), region)
      const trustAccount = trustedAccountsOf(res.properties.AssumeRolePolicyDocument, resolve)
      if (trustAccount !== undefined) values[`role-trust-account:${ref}`] = trustAccount
    }
    if (kind === 'iam-inline-policy') {
      grants.push(...grantsFromPolicyDocument(res.properties.PolicyDocument, resolve, region, 'inline', canonicaliseResource))
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
    if (kind === 's3-bucket-policy') {
      const bucketTarget = resourceRefsIn(res.properties.Bucket, resourceIds)[0]
      const bucketNodeRef = bucketTarget !== undefined ? refToNode.get(bucketTarget.id) : undefined
      grants.push(...bucketPolicyGrants(res.properties.PolicyDocument, resolve, region, securedBucketName(bucketNodeRef), canonicaliseResource))
      // Who may write to the bucket across accounts — the load-bearing cross-account write grant — read
      // by value (the deploying account dropped) so a widened or different writer diverges on the value tier.
      const writeAccounts = grantedAccountsValue(resolvedPrincipalsOf(res.properties.PolicyDocument, resolve), deployAccount)
      if (writeAccounts !== undefined) values[`bucket-policy-write-accounts:${ref}`] = writeAccounts
      if (bucketTarget !== undefined) {
        edges.push({ from: ref, to: bucketNodeRef ?? bucketTarget.id, relation: 'secures-bucket' })
      }
    }
    if (kind === 'cognito-user-pool') {
      cognitoEdge(ref, asRecord(res.properties.LambdaConfig).PreTokenGeneration, 'pre-token-generation')
      cognitoEdge(ref, asRecord(asRecord(res.properties.LambdaConfig).PreTokenGenerationConfig).LambdaArn, 'pre-token-generation')
    }
    if (kind === 'cognito-resource-server') {
      cognitoEdge(ref, res.properties.UserPoolId, 'bound-to-pool')
    }
    if (kind === 'apigateway-authorizer') {
      cognitoEdge(ref, res.properties.RestApiId, 'authorizes-api')
      cognitoEdge(ref, res.properties.ProviderARNs, 'bound-to-pool')
    }
    if (kind === 'cognito-user-pool-client') {
      cognitoEdge(ref, res.properties.UserPoolId, 'bound-to-pool')
      const poolTargets = resourceRefsIn(res.properties.UserPoolId, resourceIds)
      const poolRef = poolTargets.length > 0 ? refToNode.get(poolTargets[0].id) ?? poolTargets[0].id : nodeRef('cognito-user-pool', 'pool')
      const clientOauth = oauthFrom(res.properties, cognitoDiscovery(poolNameFromRef(poolRef), region, domainByPoolRef.get(poolRef)))
      if (clientOauth !== undefined) {
        oauthByClient[ref] = clientOauth
        oauth = clientOauth
      }
    }
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

  return {
    channel,
    wellFormed,
    graph: { nodes, edges },
    values,
    grants,
    secrets,
    oauth,
    ...(Object.keys(oauthByClient).length > 0 ? { oauthByClient } : {}),
    cosmetics,
  }
}
