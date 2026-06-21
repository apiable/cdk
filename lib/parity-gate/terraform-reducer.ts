/**
 * Reduce `terraform show -json` output to the comparable parity model. Scalars and grants come
 * from `planned_values` (the known, resolved values); graph edges come from `configuration`
 * (the reference expressions), because a plan leaves computed attributes such as a role id or
 * ARN unknown — so the dependency between the policy and the role is read from the references,
 * not from a value that is not yet known at plan time.
 *
 * The legacy single-ARN `pre_token_generation` attribute carries no version field, so it reduces
 * to the legacy token-customisation version (`V1_0`). That is the decisive parity row: a channel
 * on the legacy attribute reads as `V1_0` while a channel on `pre_token_generation_config` reads
 * as its declared version, so the value tier catches a divergence a presence check would miss.
 */
import {
  Channel,
  ChannelModel,
  cognitoDiscovery,
  grantedAccountsValue,
  identityCollisionsOf,
  namespaceByRef,
  normaliseLogical,
  OAuthConfig,
  OidcDiscovery,
  poolNameFromRef,
  PermissionGrant,
  ResourceEdge,
  ResourceNode,
  SecretRef,
} from './model'
import {
  canonicalTfKind,
  canonicalOutputAttr,
  DECLARED_ID_KINDS,
  DECLARED_ID_TAG,
  discriminatorOf,
  ENFORCED_DECLARED_ID_KINDS,
  missingDeclaredId,
  nodeRef,
  policyServices,
  VALUE_BEARING_KINDS,
} from './canonical'
import { grantsFromPolicyDocument, resolvedPrincipalsOf, trustedAccountsOf } from './iam'
import { asArray, asRecord, asScalarString, asString, asStringArray, isRecord } from './narrow'

const SECRET_KEY = /(secret|password|private_?key|signing_?key|token|api_?key)/i

/** Terraform values are already concrete, so resolution is just a scalar-to-string coercion. */
const tfResolve = (value: unknown): string => asScalarString(value) ?? ''

/** Unwrap a Terraform nested block, which `show -json` renders as a single-element list. */
const block = (value: unknown): Record<string, unknown> => {
  if (Array.isArray(value)) return asRecord(value[0])
  return asRecord(value)
}

const parseJson = (value: unknown): unknown => {
  const text = asString(value)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

interface TfResource {
  readonly address: string
  readonly type: string
  readonly values: Record<string, unknown>
}

/** The author-declared `apiable:logical-id` for a taggable primary, read per-tag from the resource's
 * own `tags` and falling back to the provider-merged `tags_all` for that one key — so an empty `tags: {}`
 * block still reaches the id in `tags_all`. Undefined (an empty value included) when neither carries it. */
const declaredLogicalId = (values: Record<string, unknown>): string | undefined => {
  const tags = asRecord(values.tags)
  const tagsAll = asRecord(values.tags_all)
  return (asString(tags[DECLARED_ID_TAG]) ?? asString(tagsAll[DECLARED_ID_TAG])) || undefined
}

/** The sorted IAM service set an inline policy grants on — its channel-stable per-parent local key. */
const inlinePolicyServices = (values: Record<string, unknown>): string => {
  const doc = asRecord(parseJson(values.policy))
  const actions = asArray(doc.Statement).flatMap((s) => {
    const action = asRecord(s).Action
    return typeof action === 'string' ? [action] : asStringArray(action)
  })
  return policyServices(actions)
}

/**
 * The discriminator for a resource whose identity is not an author-declared id: a channel-stable
 * value derived from account/region-agnostic attributes. The taggable primaries ({@link DECLARED_ID_KINDS})
 * are keyed by their declared id in {@link identityFor} and only reach here as a name-based fall-back for
 * the kinds not yet enforced (a tag-less pool/function keeps its prior verdict).
 */
const discriminatorFor = (
  kind: string,
  values: Record<string, unknown>,
  region: string | undefined,
): string | undefined => {
  switch (kind) {
    case 'iam-inline-policy':
      return inlinePolicyServices(values) || undefined
    case 'cognito-user-pool':
      return normaliseLogical(tfResolve(values.name), region) || 'pool'
    case 'cognito-user-pool-client':
      return normaliseLogical(tfResolve(values.name), region) || 'client'
    case 'cognito-resource-server':
      return asString(values.identifier) ?? 'resource-server'
    case 'apigateway-authorizer':
      return normaliseLogical(tfResolve(values.name), region) || 'authorizer'
    case 'lambda-function':
      return normaliseLogical(tfResolve(values.function_name), region) || 'function'
    default:
      return undefined
  }
}

/** The Terraform attribute carrying a taggable primary's name, demoted to a cosmetic note. */
const PRIMARY_NAME_ATTRIBUTE: Readonly<Record<string, string>> = {
  'iam-role': 'name',
  's3-bucket': 'bucket',
  'cognito-user-pool': 'name',
  'lambda-function': 'function_name',
}

/**
 * A resource's channel-stable identity. A taggable primary is keyed by its author-declared
 * `apiable:logical-id`; an enforced primary ({@link ENFORCED_DECLARED_ID_KINDS}) missing the id takes a
 * per-channel-unique token so the omission is an explicit divergence, never inferred from the name.
 * Every other resource keeps its attribute-derived {@link discriminatorFor}.
 */
const identityFor = (
  kind: string,
  values: Record<string, unknown>,
  region: string | undefined,
  localId: string,
): string | undefined => {
  if (DECLARED_ID_KINDS.has(kind)) {
    const declaredId = declaredLogicalId(values)
    if (declaredId !== undefined) return declaredId
    if (ENFORCED_DECLARED_ID_KINDS.has(kind)) return missingDeclaredId(localId)
  }
  return discriminatorFor(kind, values, region)
}

/**
 * The normalised name of the bucket a bucket-policy secures — the channel-stable discriminator for
 * the policy node and the key its write grant is filed under, mirroring the CloudFormation side. The
 * policy references its bucket by a channel-local address, so the stable identity is the referenced
 * bucket node's discriminator. Absent when the bucket cannot be resolved from the configuration.
 */
const securedBucketName = (bucketNodeRef: string | undefined): string | undefined => {
  if (bucketNodeRef === undefined) return undefined
  const prefix = 's3-bucket:'
  return bucketNodeRef.startsWith(prefix) ? bucketNodeRef.slice(prefix.length) : undefined
}

const collectValues = (kind: string, values: Record<string, unknown>): Record<string, string> => {
  const out: Record<string, string> = {}
  if (kind === 'cognito-user-pool') {
    const lambdaConfig = block(values.lambda_config)
    const preTokenConfig = block(lambdaConfig.pre_token_generation_config)
    const explicitVersion = asString(preTokenConfig.lambda_version)
    const legacyAttached = asString(lambdaConfig.pre_token_generation)
    if (explicitVersion !== undefined) out['pretokengen-version'] = explicitVersion
    else if (legacyAttached !== undefined && legacyAttached !== '') out['pretokengen-version'] = 'V1_0'
    const tier = asString(values.user_pool_tier)
    if (tier !== undefined) out['user-pool-tier'] = tier
  }
  if (kind === 'cognito-user-pool-client') {
    const flows = asStringArray(values.allowed_oauth_flows)
    if (flows.length > 0) out['oauth-flows'] = [...flows].sort().join(',')
    const scopes = asStringArray(values.allowed_oauth_scopes)
    if (scopes.length > 0) out['oauth-scopes'] = [...scopes].sort().join(',')
    // generate_secret defaults to false when omitted, so an explicit `false` and an omitted value
    // describe the same client and must read identically rather than as present-vs-absent.
    out['generate-secret'] = String(values.generate_secret ?? false)
  }
  if (kind === 'apigateway-authorizer') {
    const type = asString(values.type)
    if (type !== undefined) out['authorizer-type'] = type
    const identitySource = asString(values.identity_source)
    if (identitySource !== undefined) out['authorizer-identity-source'] = identitySource.split('.').pop() ?? identitySource
    const apiKeySource = asString(values.api_key_source)
    if (apiKeySource !== undefined) out['authorizer-api-key-source'] = apiKeySource
  }
  if (kind === 'cognito-resource-server') {
    const scopeNames = asArray(values.scope)
      .map((scope) => asString(asRecord(scope).scope_name))
      .filter((name): name is string => name !== undefined)
    out['resource-server-scopes'] = [...new Set(scopeNames)].sort().join(',')
  }
  return out
}

const collectCosmetics = (kind: string, values: Record<string, unknown>): Record<string, string> => {
  const cosmetics: Record<string, string> = {}
  const description = asString(values.description)
  if (description !== undefined) cosmetics[`description:${kind}`] = description
  const runtime = asString(values.runtime)
  if (runtime !== undefined) cosmetics[`runtime:${kind}`] = runtime
  return cosmetics
}

const collectSecrets = (values: Record<string, unknown>): SecretRef[] => {
  const variables = asRecord(block(values.environment).variables)
  return Object.entries(variables)
    .filter(([key]) => SECRET_KEY.test(key))
    .map(([key, value]) => ({
      ref: `secret:${key.toLowerCase()}`,
      wired: value !== undefined && value !== null && value !== '',
    }))
}

const oauthFrom = (values: Record<string, unknown>, discovery?: OidcDiscovery): OAuthConfig | undefined => {
  const flows = asStringArray(values.allowed_oauth_flows)
  const scopes = asStringArray(values.allowed_oauth_scopes)
  if (flows.length === 0 && scopes.length === 0) return undefined
  return { flows: [...flows].sort(), scopes: [...scopes].sort(), ...(discovery !== undefined ? { discovery } : {}) }
}

const lambdaPermissionGrant = (values: Record<string, unknown>, region: string | undefined): PermissionGrant => {
  const principal = normaliseLogical(tfResolve(values.principal), region)
  const rawSource = asScalarString(values.source_arn)
  const sourceArn = rawSource === undefined || rawSource === '' ? undefined : normaliseLogical(rawSource, region)
  return {
    ref: `grant:invoke:${principal}`,
    effect: 'Allow',
    actions: [asString(values.action) ?? 'lambda:InvokeFunction'],
    resources: [],
    principal,
    ...(sourceArn !== undefined ? { sourceArn } : {}),
  }
}

/**
 * The write grants a bucket-policy confers, keyed per secured bucket — the Terraform counterpart of
 * the CloudFormation reducer's bucket-policy grants. The `policy` is a `jsonencode`d `{ Statement: [] }`
 * document, so the shared {@link grantsFromPolicyDocument} extracts each statement's principals BY
 * VALUE; only the ref is re-filed under the bucket-policy key so the cross-account write grant
 * compares as a multiset and a widened principal diverges instead of collapsing.
 */
const bucketPolicyGrants = (
  policy: unknown,
  region: string | undefined,
  bucketName: string | undefined,
  canonicaliseResource: (resource: string) => string,
): PermissionGrant[] => {
  const ref = `grant:bucket-policy:${bucketName ?? 'bucket'}`
  return grantsFromPolicyDocument(parseJson(policy), tfResolve, region, 'inline', canonicaliseResource).map((grant) => ({ ...grant, ref }))
}

/** The resource address a Terraform reference points at, e.g. `aws_iam_role.this.arn` → `aws_iam_role.this`. */
const referencedAddress = (reference: string, addresses: ReadonlySet<string>): { address: string; attr: string } | undefined => {
  const parts = reference.split('.')
  for (let take = parts.length; take >= 2; take -= 1) {
    const address = parts.slice(0, take).join('.')
    if (addresses.has(address)) return { address, attr: parts.slice(take).join('.') || 'ref' }
  }
  return undefined
}

const referencesOf = (expression: unknown, addresses: ReadonlySet<string>): { address: string; attr: string }[] => {
  // A reference list names both `<addr>.<attr>` and the bare `<addr>`, in no guaranteed order; keep
  // one edge per address, preferring the named attribute over the bare `ref` so the edge attribute
  // does not flip with the array order. Among named attributes the longest (most specific) wins.
  const attrByAddress = new Map<string, string>()
  const order: string[] = []
  for (const reference of asStringArray(asRecord(expression).references)) {
    const hit = referencedAddress(reference, addresses)
    if (hit === undefined) continue
    const current = attrByAddress.get(hit.address)
    if (current === undefined) {
      order.push(hit.address)
      attrByAddress.set(hit.address, hit.attr)
      continue
    }
    if (current === 'ref' && hit.attr !== 'ref') attrByAddress.set(hit.address, hit.attr)
    else if (hit.attr !== 'ref' && current !== 'ref' && hit.attr.length > current.length) attrByAddress.set(hit.address, hit.attr)
  }
  return order.map((address) => ({ address, attr: attrByAddress.get(address) ?? 'ref' }))
}

/**
 * Reduce parsed `terraform show -json` output into a {@link ChannelModel}. `deployAccount` is the
 * account a credentialed plan resolved `data.aws_caller_identity` into; supplied so the incidental
 * deploying account drops out of the bucket-policy by-value write-grant, matching the published CFN
 * channel where the deploying account is the digit-less `AWS::AccountId` token.
 */
export const reduceTerraformShowJson = (plan: unknown, channel: Channel = 'terraform', region?: string, deployAccount?: string): ChannelModel => {
  const root = asRecord(plan)
  const plannedResources = asArray(asRecord(asRecord(root.planned_values).root_module).resources)
  const wellFormed = isRecord(plan) && isRecord(root.planned_values) && plannedResources.length > 0

  const resources: TfResource[] = plannedResources
    .map((entry) => asRecord(entry))
    .filter((entry) => asString(entry.address) !== undefined && asString(entry.type) !== undefined)
    .map((entry) => ({
      address: asString(entry.address) ?? '',
      type: asString(entry.type) ?? '',
      values: asRecord(entry.values),
    }))

  const addresses = new Set(resources.map((r) => r.address))
  const refToNode = new Map<string, string>()
  const kindByAddress = new Map<string, string>()
  for (const res of resources) {
    const kind = canonicalTfKind(res.type)
    kindByAddress.set(res.address, kind)
    refToNode.set(res.address, nodeRef(kind, identityFor(kind, res.values, region, res.address)))
  }

  // A plan leaves a computed user_pool_id unknown in planned_values, so the cognito reference graph
  // (and the pool a client's discovery document is derived from) is read from the configuration's
  // reference expressions, the same source the role/function edges already come from.
  const configResources = asArray(asRecord(asRecord(root.configuration).root_module).resources)
  const poolRefByClientAddress = new Map<string, string>()
  const domainPrefixByPoolRef = new Map<string, string>()
  // The parent each attached resource is anchored to, read from the configuration's reference
  // expressions (the parent id is computed and absent from planned_values), so the attached node and
  // its grant carry the parent's channel-stable declared identity, never a generated name of their own.
  const securedBucketByPolicyAddress = new Map<string, string>()
  const roleRefByPolicyAddress = new Map<string, string>()
  const functionRefByPermissionAddress = new Map<string, string>()
  const poolRefByDomainAddress = new Map<string, string>()
  for (const entry of configResources) {
    const record = asRecord(entry)
    const address = asString(record.address)
    if (address === undefined || !addresses.has(address)) continue
    const kind = kindByAddress.get(address)
    const expressions = asRecord(record.expressions)
    if (kind === 'cognito-user-pool-client') {
      const poolTarget = referencesOf(expressions.user_pool_id, addresses)[0]
      if (poolTarget !== undefined) poolRefByClientAddress.set(address, refToNode.get(poolTarget.address) ?? poolTarget.address)
    }
    if (kind === 'cognito-user-pool-domain') {
      const poolTarget = referencesOf(expressions.user_pool_id, addresses)[0]
      const domainResource = resources.find((candidate) => candidate.address === address)
      const domain = domainResource !== undefined ? asString(domainResource.values.domain) : undefined
      if (poolTarget !== undefined) {
        const poolRef = refToNode.get(poolTarget.address) ?? poolTarget.address
        poolRefByDomainAddress.set(address, poolRef)
        if (domain !== undefined) domainPrefixByPoolRef.set(poolRef, domain)
      }
    }
    if (kind === 'iam-inline-policy') {
      const roleTarget = referencesOf(expressions.role, addresses)[0]
      if (roleTarget !== undefined) roleRefByPolicyAddress.set(address, refToNode.get(roleTarget.address) ?? roleTarget.address)
    }
    if (kind === 'lambda-permission') {
      const fnTarget = referencesOf(expressions.function_name, addresses)[0]
      if (fnTarget !== undefined) functionRefByPermissionAddress.set(address, refToNode.get(fnTarget.address) ?? fnTarget.address)
    }
    if (kind === 's3-bucket-policy') {
      const bucketTarget = referencesOf(expressions.bucket, addresses)[0]
      if (bucketTarget !== undefined) securedBucketByPolicyAddress.set(address, refToNode.get(bucketTarget.address) ?? bucketTarget.address)
    }
  }
  // Re-key each attached resource by its parent + a per-parent local key (the policy's/permission's
  // own address is not channel-stable), so two of one kind under one parent stay distinct.
  for (const res of resources) {
    const kind = kindByAddress.get(res.address)
    if (kind === 's3-bucket-policy') {
      refToNode.set(res.address, nodeRef('s3-bucket-policy', securedBucketName(securedBucketByPolicyAddress.get(res.address))))
    }
    if (kind === 'iam-inline-policy') {
      const roleRef = roleRefByPolicyAddress.get(res.address)
      if (roleRef !== undefined) {
        refToNode.set(res.address, nodeRef('iam-inline-policy', `policy-of:${discriminatorOf(roleRef)}:${inlinePolicyServices(res.values)}`))
      }
    }
    if (kind === 'lambda-permission') {
      const principal = normaliseLogical(tfResolve(res.values.principal), region)
      const fnRef = functionRefByPermissionAddress.get(res.address)
      const fnKey = fnRef !== undefined ? discriminatorOf(fnRef) : normaliseLogical(tfResolve(res.values.function_name), region)
      refToNode.set(res.address, nodeRef('lambda-permission', `invoke-on:${fnKey}:${principal}`))
    }
    if (kind === 'cognito-user-pool-domain') {
      const poolRef = poolRefByDomainAddress.get(res.address)
      if (poolRef !== undefined) refToNode.set(res.address, nodeRef('cognito-user-pool-domain', `of-pool:${discriminatorOf(poolRef)}`))
    }
  }

  // The within-channel identity collisions among value-bearing kinds: two distinct resources that
  // resolved to one node ref clobber each other's load-bearing value row, so the gate must fail on the
  // collision itself rather than silently certify the surviving (last-written) value as parity.
  const identityCollisions = identityCollisionsOf(
    resources
      .filter((res) => VALUE_BEARING_KINDS.has(kindByAddress.get(res.address) ?? ''))
      .map((res) => refToNode.get(res.address) ?? ''),
  )

  // A grant resource that is one of this plan's S3 bucket ARNs reduces to that bucket's channel-stable
  // node ref (keeping any trailing object path), so a self-referential bucket ARN reconciles with the
  // CloudFormation `Fn::GetAtt` form instead of comparing a resolved literal against a logical id.
  const bucketArnToNode = new Map<string, string>()
  for (const res of resources) {
    if (kindByAddress.get(res.address) !== 's3-bucket') continue
    const bucketName = normaliseLogical(tfResolve(res.values.bucket), region)
    if (bucketName !== '') bucketArnToNode.set(`arn:aws:s3:::${bucketName}`, refToNode.get(res.address) ?? res.address)
  }
  const canonicaliseResource = (resource: string): string => {
    for (const [arn, node] of bucketArnToNode) {
      if (resource === arn) return node
      if (resource.startsWith(`${arn}/`)) return `${node}${resource.slice(arn.length)}`
    }
    return resource
  }

  const nodes: ResourceNode[] = []
  const edges: ResourceEdge[] = []
  let values: Record<string, string> = {}
  let cosmetics: Record<string, string> = {}
  const grants: PermissionGrant[] = []
  const secrets: SecretRef[] = []
  let oauth: OAuthConfig | undefined
  const oauthByClient: Record<string, OAuthConfig> = {}

  for (const res of resources) {
    const kind = kindByAddress.get(res.address) ?? res.type
    const ref = refToNode.get(res.address) ?? kind
    nodes.push({ ref, kind })
    // A taggable primary's name is identity-free under the declared id, so it is a cosmetic note,
    // keyed per node so two resources never collapse onto one name and a tenant/region difference warns.
    const nameAttribute = PRIMARY_NAME_ATTRIBUTE[kind]
    if (nameAttribute !== undefined) {
      const name = normaliseLogical(tfResolve(res.values[nameAttribute]), region)
      if (name !== '') cosmetics[`name:${ref}`] = name
    }
    values = { ...values, ...namespaceByRef(collectValues(kind, res.values), ref) }
    cosmetics = { ...cosmetics, ...collectCosmetics(kind, res.values) }
    secrets.push(...collectSecrets(res.values))
    if (kind === 'iam-role') {
      const assumePolicy = parseJson(res.values.assume_role_policy)
      // File each trust grant under the role's own node ref, mirroring the CloudFormation side, so two
      // roles' trusts never pool into one multiset where a cross-role swap nets out.
      grants.push(
        ...grantsFromPolicyDocument(assumePolicy, tfResolve, region, 'trust', canonicaliseResource).map(
          (grant) => ({ ...grant, ref: `${grant.ref}:${ref}` }),
        ),
      )
      const trustAccount = trustedAccountsOf(assumePolicy, tfResolve)
      if (trustAccount !== undefined) values[`role-trust-account:${ref}`] = trustAccount
    }
    if (kind === 'iam-inline-policy') {
      grants.push(...grantsFromPolicyDocument(parseJson(res.values.policy), tfResolve, region, 'inline', canonicaliseResource))
    }
    if (kind === 's3-bucket-policy') {
      grants.push(...bucketPolicyGrants(res.values.policy, region, securedBucketName(securedBucketByPolicyAddress.get(res.address)), canonicaliseResource))
      // The cross-account write grant by value (deploying account dropped); always emitted ({none} = no external writer).
      values[`bucket-policy-write-accounts:${ref}`] = grantedAccountsValue(resolvedPrincipalsOf(parseJson(res.values.policy), tfResolve), deployAccount)
    }
    if (kind === 'lambda-permission') grants.push(lambdaPermissionGrant(res.values, region))
    if (kind === 'cognito-user-pool-client') {
      const poolRef = poolRefByClientAddress.get(res.address)
      const poolName = poolRef !== undefined ? poolNameFromRef(poolRef) : 'pool'
      const clientOauth = oauthFrom(res.values, cognitoDiscovery(poolName, region, poolRef !== undefined ? domainPrefixByPoolRef.get(poolRef) : undefined))
      if (clientOauth !== undefined) {
        oauthByClient[ref] = clientOauth
        oauth = clientOauth
      }
    }
  }

  // Edges + output nodes come from the configuration's reference expressions.
  for (const entry of configResources) {
    const record = asRecord(entry)
    const address = asString(record.address)
    if (address === undefined || !addresses.has(address)) continue
    const kind = canonicalTfKind(asString(record.type) ?? '')
    const expressions = asRecord(record.expressions)
    const from = refToNode.get(address) ?? address
    const relation = kind === 'iam-inline-policy' ? 'attached-to-role' : 'depends-on'
    for (const target of referencesOf(expressions.role ?? expressions.function_name, addresses)) {
      edges.push({ from, to: refToNode.get(target.address) ?? target.address, relation })
    }
    // The cognito reference edges: a client/resource-server→pool, a pool→pre-token function, and an
    // authorizer→rest-api/pool binding, so a resource bound to a different (or no) pool diverges.
    if (kind === 'cognito-user-pool-client' || kind === 'cognito-resource-server') {
      for (const target of referencesOf(expressions.user_pool_id, addresses)) {
        edges.push({ from, to: refToNode.get(target.address) ?? target.address, relation: 'bound-to-pool' })
      }
    }
    if (kind === 'cognito-user-pool') {
      const lambdaConfig = block(expressions.lambda_config)
      // The legacy `pre_token_generation` carries the function reference directly; the versioned
      // `pre_token_generation_config` nests it under `lambda_arn` (itself a single-element block).
      const preTokenRef = lambdaConfig.pre_token_generation ?? block(lambdaConfig.pre_token_generation_config).lambda_arn
      for (const target of referencesOf(preTokenRef, addresses)) {
        edges.push({ from, to: refToNode.get(target.address) ?? target.address, relation: 'pre-token-generation' })
      }
    }
    if (kind === 'apigateway-authorizer') {
      for (const target of referencesOf(expressions.rest_api_id, addresses)) {
        edges.push({ from, to: refToNode.get(target.address) ?? target.address, relation: 'authorizes-api' })
      }
      for (const target of referencesOf(expressions.provider_arns, addresses)) {
        edges.push({ from, to: refToNode.get(target.address) ?? target.address, relation: 'bound-to-pool' })
      }
    }
    if (kind === 's3-bucket-policy') {
      for (const target of referencesOf(expressions.bucket, addresses)) {
        edges.push({ from, to: refToNode.get(target.address) ?? target.address, relation: 'secures-bucket' })
      }
    }
  }

  const configOutputs = asRecord(asRecord(asRecord(root.configuration).root_module).outputs)
  for (const [, spec] of Object.entries(configOutputs)) {
    const target = referencesOf(asRecord(spec).expression, addresses)[0]
    if (target === undefined) continue
    const targetKind = kindByAddress.get(target.address) ?? 'resource'
    const attr = canonicalOutputAttr(targetKind, target.attr)
    const outputRef = nodeRef('output', `${targetKind}.${attr}`)
    nodes.push({ ref: outputRef, kind: 'output' })
    edges.push({ from: outputRef, to: refToNode.get(target.address) ?? target.address, relation: `exports:${attr}` })
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
    ...(identityCollisions.length > 0 ? { identityCollisions } : {}),
  }
}
