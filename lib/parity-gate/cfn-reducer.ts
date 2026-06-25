/**
 * Reduce a CloudFormation template to the comparable parity model. Drives two channels: the CDK
 * construct (`Template.fromStack(...).toJSON()`) and the published launch-stack template read as its
 * structured JSON twin — both are CloudFormation object graphs, so they share this reducer.
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
  discoveryValueRows,
  grantedAccountsValue,
  identityCollisionsOf,
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
import {
  canonicaliseAuthorizerName,
  canonicaliseHostedDomain,
  canonicaliseLogsBucketParam,
  canonicalCfnKind,
  canonicalOutputAttr,
  DECLARED_ID_KINDS,
  DECLARED_ID_TAG,
  discriminatorOf,
  ENFORCED_DECLARED_ID_KINDS,
  LOGS_BUCKET_ARN_PARAMETER,
  missingDeclaredId,
  nodeRef,
  policyServices,
  VALUE_BEARING_KINDS,
} from './canonical'
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

/** The author-declared `apiable:logical-id` for a taggable primary, or undefined when the tag is absent.
 * A user pool carries it in the `UserPoolTags` map; every other taggable kind in the standard `Tags` list. */
const declaredLogicalId = (kind: string, props: Record<string, unknown>): string | undefined => {
  if (kind === 'cognito-user-pool') return asString(asRecord(props.UserPoolTags)[DECLARED_ID_TAG]) || undefined
  for (const entry of asArray(props.Tags)) {
    const tag = asRecord(entry)
    if (asString(tag.Key) === DECLARED_ID_TAG) return asString(tag.Value) || undefined
  }
  return undefined
}

/** The sorted IAM service set a policy document grants on — its channel-stable per-parent local key. */
const policyDocumentServices = (doc: unknown): string => {
  const statements = asArray(asRecord(doc).Statement)
  const allActions = statements.flatMap((s) => {
    const action = asRecord(s).Action
    return typeof action === 'string' ? [action] : asStringArray(action)
  })
  return policyServices(allActions)
}

/** The sorted IAM service set an inline policy resource grants on, from its `PolicyDocument`. */
const inlinePolicyServices = (props: Record<string, unknown>): string => policyDocumentServices(props.PolicyDocument)

/**
 * The discriminator for a resource whose identity is not an author-declared id: a channel-stable
 * value derived from account/region-agnostic attributes. The taggable primaries ({@link DECLARED_ID_KINDS})
 * are keyed by their declared id in {@link identityFor} — a tag-less one of those kinds takes the
 * {@link missingDeclaredId} token there, never this name fall-back, since every taggable primary kind is
 * enforced. The non-taggable kinds (inline policy, client, resource-server, authorizer) key here.
 */
const discriminatorFor = (
  kind: string,
  props: Record<string, unknown>,
  resolve: (v: unknown) => string,
  region: string | undefined,
): string | undefined => {
  switch (kind) {
    case 'iam-inline-policy':
      return inlinePolicyServices(props) || undefined
    case 'cognito-user-pool':
      return normaliseLogical(resolve(props.UserPoolName), region) || 'pool'
    case 'cognito-user-pool-client':
      return normaliseLogical(resolve(props.ClientName), region) || 'client'
    case 'cognito-resource-server':
      return asString(props.Identifier) ?? 'resource-server'
    case 'apigateway-authorizer':
      return canonicaliseAuthorizerName(normaliseLogical(resolve(props.Name), region)) || 'authorizer'
    case 'lambda-function':
      return normaliseLogical(resolve(props.FunctionName), region) || 'function'
    default:
      return undefined
  }
}

/** The CloudFormation property carrying a taggable primary's name, demoted to a cosmetic note. */
const PRIMARY_NAME_PROPERTY: Readonly<Record<string, string>> = {
  'iam-role': 'RoleName',
  's3-bucket': 'BucketName',
  'cognito-user-pool': 'UserPoolName',
  'lambda-function': 'FunctionName',
}

/**
 * A resource's channel-stable identity. A taggable primary is keyed by its author-declared
 * `apiable:logical-id`; an enforced primary ({@link ENFORCED_DECLARED_ID_KINDS}) missing the id takes a
 * per-channel-unique token so the omission is an explicit divergence, never inferred from the name.
 * Every other resource keeps its attribute-derived {@link discriminatorFor}.
 */
const identityFor = (
  kind: string,
  props: Record<string, unknown>,
  resolve: (v: unknown) => string,
  region: string | undefined,
  localId: string,
): string | undefined => {
  if (DECLARED_ID_KINDS.has(kind)) {
    const declaredId = declaredLogicalId(kind, props)
    if (declaredId !== undefined) return declaredId
    if (ENFORCED_DECLARED_ID_KINDS.has(kind)) return missingDeclaredId(localId)
  }
  return discriminatorFor(kind, props, resolve, region)
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

/**
 * The S3 destination block a firehose delivery stream writes through, normalised over the two CDK
 * shapes — the legacy `S3DestinationConfiguration` and the richer `ExtendedS3DestinationConfiguration`
 * — so the stream's routing/logging settings read identically whichever the channel emitted.
 */
const streamS3Destination = (props: Record<string, unknown>): Record<string, unknown> => {
  const extended = asRecord(props.ExtendedS3DestinationConfiguration)
  if (Object.keys(extended).length > 0) return extended
  return asRecord(props.S3DestinationConfiguration)
}

/**
 * Resolve a client's `AllowedOAuthScopes` to the channel-stable `<resource-server-identifier>/<scope>`
 * form. The published one-click template binds a scope as `Fn::Join["", [{Ref: <ResourceServer>}, "/admin"]]`
 * — a cross-resource reference whose `Ref` resolves to the resource server's id, which Cognito makes equal
 * to its declared `Identifier`. `identifierByRef` maps a resource-server logical id to that identifier, so
 * the bound scope reduces to `apiable/admin` — the same literal the Terraform channel's plan carries — and
 * the client's scope binding reconciles cross-channel. A scope that is already a literal passes through.
 */
const resolveOAuthScopes = (
  raw: unknown,
  resolve: (v: unknown) => string,
  identifierByRef: ReadonlyMap<string, string>,
): string[] =>
  asArray(raw).map((entry) => {
    const join = asRecord(entry)['Fn::Join']
    if (Array.isArray(join) && join.length === 2) {
      const parts = asArray(join[1])
      const head = asRecord(parts[0])
      const headIdentifier = identifierByRef.get(asString(head.Ref) ?? '')
      if (headIdentifier !== undefined) {
        const rest = parts.slice(1).map((part) => resolve(part)).join(asString(join[0]) ?? '')
        return `${headIdentifier}${rest}`
      }
    }
    return resolve(entry)
  })

const collectValues = (
  kind: string,
  props: Record<string, unknown>,
  resolve: (v: unknown) => string,
  resourceServerIdentifierByRef: ReadonlyMap<string, string> = new Map(),
): Record<string, string> => {
  const values: Record<string, string> = {}
  if (kind === 'firehose-delivery-stream') {
    // The routing prefixes the downstream token pipeline keys off, the compression format, and whether
    // server-side delivery logging is on — load-bearing value rows, so a divergent destination routing
    // or a dropped logging block is caught BY VALUE cross-channel. The destination bucket and delivery
    // role are NOT value rows here: the bucket is a deploy-time input that reads as a parameter ref in
    // the CFN channels and a literal in Terraform (it cannot reconcile by raw value), and both are
    // already gate-compared — the bucket by the delivery role's S3 inline-policy grant (the ARN by
    // value) and the role binding by the stream's parent-anchor to the role's declared id.
    const destination = streamS3Destination(props)
    const prefix = resolve(destination.Prefix)
    if (prefix !== '') values['destination-prefix'] = prefix
    const errorPrefix = resolve(destination.ErrorOutputPrefix)
    if (errorPrefix !== '') values['destination-error-prefix'] = errorPrefix
    const compression = asString(destination.CompressionFormat)
    if (compression !== undefined) values['compression-format'] = compression
    const logging = asRecord(destination.CloudWatchLoggingOptions)
    if (logging.Enabled !== undefined) values['cloudwatch-logging-enabled'] = String(logging.Enabled)
  }
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
    const scopes = resolveOAuthScopes(props.AllowedOAuthScopes, resolve, resourceServerIdentifierByRef).filter((scope) => scope !== '')
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

const oauthFrom = (
  props: Record<string, unknown>,
  resolve: (v: unknown) => string,
  resourceServerIdentifierByRef: ReadonlyMap<string, string>,
  discovery?: OidcDiscovery,
): OAuthConfig | undefined => {
  const flows = asStringArray(props.AllowedOAuthFlows)
  const scopes = resolveOAuthScopes(props.AllowedOAuthScopes, resolve, resourceServerIdentifierByRef).filter((scope) => scope !== '')
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

  // Each resource-server's declared Identifier keyed by its logical id, so a client's `AllowedOAuthScopes`
  // bound as `Fn::Join[{Ref: <ResourceServer>}, "/admin"]` resolves to the `<identifier>/admin` literal the
  // Terraform plan carries, and the scope binding reconciles cross-channel.
  const resourceServerIdentifierByRef = new Map<string, string>()
  for (const [id, res] of Object.entries(resources)) {
    if (canonicalCfnKind(res.type) !== 'cognito-resource-server') continue
    const identifier = asString(res.properties.Identifier)
    if (identifier !== undefined) resourceServerIdentifierByRef.set(id, identifier)
  }

  const refToNode = new Map<string, string>()
  for (const [id, res] of Object.entries(resources)) {
    const kind = canonicalCfnKind(res.type)
    refToNode.set(id, nodeRef(kind, identityFor(kind, res.properties, resolve, region, id)))
  }
  // The pool disc a literal-bound resource-server anchored to, so its bound-to-pool edge can be emitted
  // to the same pool node a referenced binding resolves to (a literal binding carries no reference).
  const literalPoolDiscByResourceServer = new Map<string, string>()
  // An attached resource carries no channel-stable name of its own; anchor its node to its parent's
  // declared identity plus a per-parent local key, so two of the same kind under one parent stay
  // distinct and a divergence on the second is never clobbered. Run after every primary node ref is
  // known (a parent is keyed in the loop above).
  for (const [id, res] of Object.entries(resources)) {
    const kind = canonicalCfnKind(res.type)
    if (kind === 'iam-inline-policy') {
      const roleTarget = resourceRefsIn(res.properties.Roles, resourceIds)[0] ?? resourceRefsIn(res.properties.RoleName, resourceIds)[0]
      if (roleTarget !== undefined) {
        const roleDisc = discriminatorOf(refToNode.get(roleTarget.id) ?? roleTarget.id)
        refToNode.set(id, nodeRef('iam-inline-policy', `policy-of:${roleDisc}:${inlinePolicyServices(res.properties)}`))
      }
    }
    if (kind === 'lambda-permission') {
      const principal = normaliseLogical(resolve(res.properties.Principal), region)
      const fnTarget = resourceRefsIn(res.properties.FunctionName, resourceIds)[0]
      const fnKey = fnTarget !== undefined ? discriminatorOf(refToNode.get(fnTarget.id) ?? fnTarget.id) : normaliseLogical(resolve(res.properties.FunctionName), region)
      refToNode.set(id, nodeRef('lambda-permission', `invoke-on:${fnKey}:${principal}`))
    }
    if (kind === 'cognito-user-pool-domain') {
      const poolTarget = resourceRefsIn(res.properties.UserPoolId, resourceIds)[0]
      if (poolTarget !== undefined) {
        refToNode.set(id, nodeRef('cognito-user-pool-domain', `of-pool:${discriminatorOf(refToNode.get(poolTarget.id) ?? poolTarget.id)}`))
      }
    }
    // A resource-server's Identifier is only unique WITHIN one pool — two pools can each expose an
    // `apiable` resource-server — so anchor the node to its bound pool's channel-stable identity plus
    // the identifier, mirroring the domain. Same-identifier resource-servers on different pools are
    // then distinct refs (no false collision); the within-channel guard still catches a same-pool dup.
    if (kind === 'cognito-resource-server') {
      const poolTarget = resourceRefsIn(res.properties.UserPoolId, resourceIds)[0]
      const identifier = asString(res.properties.Identifier) ?? 'resource-server'
      // Anchor to the bound pool's channel-stable identity. A cross-resource ref resolves to the pool
      // node's discriminator; a channel that inlines a literal pool id (no ref to resolve) anchors to
      // that normalised literal, so a literal-bound and a ref-bound resource-server on the same pool
      // resolve to the same ref rather than the literal one falling back to a bare, pool-less ref.
      const poolDisc =
        poolTarget !== undefined
          ? discriminatorOf(refToNode.get(poolTarget.id) ?? poolTarget.id)
          : normaliseLogical(resolve(res.properties.UserPoolId), region) || undefined
      if (poolDisc !== undefined) {
        refToNode.set(id, nodeRef('cognito-resource-server', `of-pool:${poolDisc}:${identifier}`))
        // A literal-bound resource-server has no reference to build its bound-to-pool edge from, so file
        // the anchored pool disc to emit that edge to the same pool node a referenced binding resolves to.
        if (poolTarget === undefined) literalPoolDiscByResourceServer.set(id, poolDisc)
      }
    }
    // A bucket-policy's channel-stable identity is the bucket it secures (its own name is generated).
    if (kind === 's3-bucket-policy') {
      const bucketTarget = resourceRefsIn(res.properties.Bucket, resourceIds)[0]
      const bucketName = securedBucketName(bucketTarget !== undefined ? refToNode.get(bucketTarget.id) : undefined)
      refToNode.set(id, nodeRef('s3-bucket-policy', bucketName))
    }
    // A delivery stream's channel-stable identity is the delivery role it assumes (its own name is a
    // tenant-scoped `amazon-apigateway-<name>`); anchor it to the role's declared id, the same parent-
    // anchoring the bucket-policy uses, so the usage-log and api-key-token streams stay distinct refs
    // (each carries its own delivery role) and a stream rebound to a different role diverges on identity.
    if (kind === 'firehose-delivery-stream') {
      const roleTarget = resourceRefsIn(streamS3Destination(res.properties).RoleARN, resourceIds)[0]
      const roleDisc = roleTarget !== undefined ? discriminatorOf(refToNode.get(roleTarget.id) ?? roleTarget.id) : undefined
      refToNode.set(id, nodeRef('firehose-delivery-stream', roleDisc !== undefined ? `of-role:${roleDisc}` : undefined))
    }
  }

  // The within-channel identity collisions among value-bearing kinds: two distinct resources that
  // resolved to one node ref clobber each other's load-bearing value row, so the gate must fail on the
  // collision itself rather than silently certify the surviving (last-written) value as parity.
  const identityCollisions = identityCollisionsOf(
    Object.entries(resources)
      .filter(([, res]) => VALUE_BEARING_KINDS.has(canonicalCfnKind(res.type)))
      .map(([id]) => refToNode.get(id) ?? ''),
  )

  // The hosted-UI domain prefix per pool node ref, so a client's discovery document can carry the
  // pool's authorize/token endpoints. A UserPoolDomain references its pool via UserPoolId. The Domain is
  // resolved (not read as a bare string), so the published one-click rendering `apiable-@ref:TenantName`
  // canonicalises to the shared tenant-domain token and reconciles with the Terraform channel's concrete
  // `apiable-<tenant>` for the same tenant; a substituted host that is not the conventional rendering keeps
  // its identity and still diverges on both discovery endpoints.
  const domainByPoolRef = new Map<string, string>()
  for (const res of Object.values(resources)) {
    if (canonicalCfnKind(res.type) !== 'cognito-user-pool-domain') continue
    const rendered = resolve(res.properties.Domain)
    if (rendered === '') continue
    const domain = canonicaliseHostedDomain(rendered)
    for (const target of resourceRefsIn(res.properties.UserPoolId, resourceIds)) {
      domainByPoolRef.set(refToNode.get(target.id) ?? target.id, domain)
    }
  }

  // The destination of each delivery stream whose BucketARN is bound to the declared deploy-time logs-bucket
  // parameter — keyed on the parameter REF (`@ref:LogsBucketArn`), read from the raw `BucketARN` intrinsic,
  // NOT its resolved value: a stream pointed at a literal bucket, or a ref to a different-named parameter,
  // contributes nothing, so its grant keeps that identity and diverges from the parameter token. The TF
  // channel adds its own var.logs_bucket_arn-bound literal to the same shared {logs-bucket-param} token.
  const paramDestinations = new Set<string>()
  for (const res of Object.values(resources)) {
    if (canonicalCfnKind(res.type) !== 'firehose-delivery-stream') continue
    if (asString(asRecord(streamS3Destination(res.properties).BucketARN).Ref) === LOGS_BUCKET_ARN_PARAMETER) {
      paramDestinations.add(`@ref:${LOGS_BUCKET_ARN_PARAMETER}`)
    }
  }

  // A grant resource that is a `Fn::GetAtt` to a resource in this template resolves to `@getatt:<id>:<attr>`
  // with the channel-local logical id; map it back to that resource's channel-stable node ref (keeping any
  // trailing object path) so a self-referential ARN reconciles with the Terraform-resolved literal. A grant
  // naming the deploy-time logs-bucket parameter reduces to the shared parameter token; every other literal
  // ARN keeps its identity and diverges.
  const canonicaliseResource = (resource: string): string => {
    const match = /^@getatt:([^:]+):[^/]*(.*)$/.exec(resource)
    if (match === null) return canonicaliseLogsBucketParam(resource, paramDestinations)
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
    // A taggable primary's name is identity-free under the declared id, so it is a cosmetic note,
    // keyed per node so two resources never collapse onto one name and a tenant/region difference warns.
    const nameProperty = PRIMARY_NAME_PROPERTY[kind]
    if (nameProperty !== undefined) {
      const name = normaliseLogical(resolve(res.properties[nameProperty]), region)
      if (name !== '') cosmetics[`name:${ref}`] = name
    }
    values = { ...values, ...namespaceByRef(collectValues(kind, res.properties, resolve, resourceServerIdentifierByRef), ref) }
    cosmetics = { ...cosmetics, ...collectCosmetics(kind, res.properties) }
    secrets.push(...collectSecrets(res.properties))

    if (kind === 'iam-role') {
      // File each trust grant under the role's own node ref: the trust ref is otherwise the constant
      // `grant:assume-role`, so two roles' trusts pool into one multiset and a cross-role swap nets out.
      grants.push(
        ...grantsFromPolicyDocument(res.properties.AssumeRolePolicyDocument, resolve, region, 'trust', canonicaliseResource).map(
          (grant) => ({ ...grant, ref: `${grant.ref}:${ref}` }),
        ),
      )
      const trustAccount = trustedAccountsOf(res.properties.AssumeRolePolicyDocument, resolve)
      if (trustAccount !== undefined) values[`role-trust-account:${ref}`] = trustAccount
      // A role's INLINE `Policies` reduce to the same inline-policy node + attached-to-role edge +
      // per-statement grants a standalone AWS::IAM::Policy (or Terraform aws_iam_role_policy) does, so a
      // policy embedded on the role compares equal to one declared as its own resource — without this the
      // embedded grant set (e.g. the firehose role's S3 write grant) is invisible to the gate, and a
      // channel that embeds diverges from one that separates. The node ref is parent-anchored to this
      // role plus its service set, identical to the standalone reducer's `policy-of:<role>:<services>`.
      for (const entry of asArray(res.properties.Policies)) {
        const policy = asRecord(entry)
        const services = policyDocumentServices(policy.PolicyDocument)
        const policyRef = nodeRef('iam-inline-policy', `policy-of:${discriminatorOf(ref)}:${services}`)
        nodes.push({ ref: policyRef, kind: 'iam-inline-policy' })
        edges.push({ from: policyRef, to: ref, relation: 'attached-to-role' })
        grants.push(
          ...grantsFromPolicyDocument(policy.PolicyDocument, resolve, region, 'inline', canonicaliseResource).map(
            (grant) => ({ ...grant, ref: `${grant.ref}:${policyRef}` }),
          ),
        )
      }
    }
    if (kind === 'iam-inline-policy') {
      // File each inline-policy grant under the policy's own node ref: the grant ref is otherwise the
      // bare `grant:<services>`, so two roles' policies covering one service set pool into a shared
      // multiset and a cross-owner loosen/tighten swap nets out. The policy node ref embeds its owning role.
      grants.push(
        ...grantsFromPolicyDocument(res.properties.PolicyDocument, resolve, region, 'inline', canonicaliseResource).map(
          (grant) => ({ ...grant, ref: `${grant.ref}:${ref}` }),
        ),
      )
      for (const target of resourceRefsIn(res.properties.Roles, resourceIds)) {
        edges.push({ from: ref, to: refToNode.get(target.id) ?? target.id, relation: 'attached-to-role' })
      }
    }
    if (kind === 'lambda-permission') {
      // File the invoke grant under the permission's own node ref: the grant ref is otherwise the bare
      // `grant:invoke:<principal>`, so two functions invoked by one principal pool and a cross-owner swap
      // nets out. The permission node ref embeds its owning function.
      const invokeGrant = lambdaPermissionGrant(res.properties, resolve, region)
      grants.push({ ...invokeGrant, ref: `${invokeGrant.ref}:${ref}` })
      for (const target of resourceRefsIn(res.properties.FunctionName, resourceIds)) {
        edges.push({ from: ref, to: refToNode.get(target.id) ?? target.id, relation: 'invokes' })
      }
    }
    if (kind === 's3-bucket-policy') {
      const bucketTarget = resourceRefsIn(res.properties.Bucket, resourceIds)[0]
      const bucketNodeRef = bucketTarget !== undefined ? refToNode.get(bucketTarget.id) : undefined
      grants.push(...bucketPolicyGrants(res.properties.PolicyDocument, resolve, region, securedBucketName(bucketNodeRef), canonicaliseResource))
      // The cross-account write grant by value (deploying account dropped); always emitted ({none} = no external writer).
      values[`bucket-policy-write-accounts:${ref}`] = grantedAccountsValue(resolvedPrincipalsOf(res.properties.PolicyDocument, resolve), deployAccount)
      if (bucketTarget !== undefined) {
        edges.push({ from: ref, to: bucketNodeRef ?? bucketTarget.id, relation: 'secures-bucket' })
      }
    }
    if (kind === 'firehose-delivery-stream') {
      // The stream→delivery-role binding as a graph edge, so a stream rebound to a different (or no)
      // role diverges on the graph tier alongside the identity anchor.
      for (const target of resourceRefsIn(streamS3Destination(res.properties).RoleARN, resourceIds)) {
        edges.push({ from: ref, to: refToNode.get(target.id) ?? target.id, relation: 'delivers-via' })
      }
    }
    if (kind === 'cognito-user-pool') {
      cognitoEdge(ref, asRecord(res.properties.LambdaConfig).PreTokenGeneration, 'pre-token-generation')
      cognitoEdge(ref, asRecord(asRecord(res.properties.LambdaConfig).PreTokenGenerationConfig).LambdaArn, 'pre-token-generation')
      // The pool's discovery endpoints as load-bearing value rows, so a divergent issuer or sign-in/token
      // host is caught cross-channel by the value comparison, not merely checked per channel for conformance.
      values = { ...values, ...discoveryValueRows(ref, region, domainByPoolRef.get(ref)) }
    }
    if (kind === 'cognito-resource-server') {
      cognitoEdge(ref, res.properties.UserPoolId, 'bound-to-pool')
      const literalPoolDisc = literalPoolDiscByResourceServer.get(id)
      if (literalPoolDisc !== undefined) edges.push({ from: ref, to: nodeRef('cognito-user-pool', literalPoolDisc), relation: 'bound-to-pool' })
    }
    if (kind === 'apigateway-authorizer') {
      cognitoEdge(ref, res.properties.RestApiId, 'authorizes-api')
      cognitoEdge(ref, res.properties.ProviderARNs, 'bound-to-pool')
    }
    if (kind === 'cognito-user-pool-client') {
      cognitoEdge(ref, res.properties.UserPoolId, 'bound-to-pool')
      const poolTargets = resourceRefsIn(res.properties.UserPoolId, resourceIds)
      const poolRef = poolTargets.length > 0 ? refToNode.get(poolTargets[0].id) ?? poolTargets[0].id : nodeRef('cognito-user-pool', 'pool')
      const clientOauth = oauthFrom(
        res.properties,
        resolve,
        resourceServerIdentifierByRef,
        cognitoDiscovery(poolNameFromRef(poolRef), region, domainByPoolRef.get(poolRef)),
      )
      if (clientOauth !== undefined) {
        // Key by the channel-local logical id, not the de-duplicating node ref: two same-named or
        // nameless clients share a ref, so ref-keying would drop one client's conformance check.
        oauthByClient[id] = clientOauth
        oauth = clientOauth
      }
    }
  }

  for (const [name, spec] of Object.entries(asRecord(root.Outputs))) {
    const targets = resourceRefsIn(asRecord(spec).Value, resourceIds)
    if (targets.length === 0) continue
    const target = targets[0]
    const targetKind = canonicalCfnKind(resources[target.id].type)
    const attr = canonicalOutputAttr(targetKind, target.attr)
    const outputRef = nodeRef('output', `${targetKind}.${attr}`)
    nodes.push({ ref: outputRef, kind: 'output' })
    edges.push({ from: outputRef, to: refToNode.get(target.id) ?? target.id, relation: `exports:${attr}` })
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
    ...(identityCollisions.length > 0 ? { identityCollisions } : {}),
  }
}
