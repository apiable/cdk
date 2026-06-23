/**
 * Canonical resource vocabulary shared by the channel reducers. A CloudFormation type and the
 * equivalent Terraform type reduce to the same canonical kind, so a resource compares by what it
 * IS, not by which channel emitted it. The two lookup tables live together so they stay in step.
 */

const CFN_KIND: Readonly<Record<string, string>> = {
  'AWS::IAM::Role': 'iam-role',
  'AWS::IAM::Policy': 'iam-inline-policy',
  'AWS::IAM::RolePolicy': 'iam-inline-policy',
  'AWS::Cognito::UserPool': 'cognito-user-pool',
  'AWS::Cognito::UserPoolClient': 'cognito-user-pool-client',
  'AWS::Cognito::UserPoolResourceServer': 'cognito-resource-server',
  'AWS::Cognito::UserPoolDomain': 'cognito-user-pool-domain',
  'AWS::Lambda::Function': 'lambda-function',
  'AWS::Lambda::Permission': 'lambda-permission',
  'AWS::ApiGateway::RestApi': 'apigateway-rest-api',
  'AWS::ApiGateway::Authorizer': 'apigateway-authorizer',
  'AWS::S3::Bucket': 's3-bucket',
  'AWS::S3::BucketPolicy': 's3-bucket-policy',
  'AWS::KinesisFirehose::DeliveryStream': 'firehose-delivery-stream',
  'AWS::Logs::LogGroup': 'logs-log-group',
  'AWS::Logs::LogStream': 'logs-log-stream',
}

const TF_KIND: Readonly<Record<string, string>> = {
  aws_iam_role: 'iam-role',
  aws_iam_role_policy: 'iam-inline-policy',
  aws_iam_policy: 'iam-inline-policy',
  aws_cognito_user_pool: 'cognito-user-pool',
  aws_cognito_user_pool_client: 'cognito-user-pool-client',
  aws_cognito_resource_server: 'cognito-resource-server',
  aws_cognito_user_pool_domain: 'cognito-user-pool-domain',
  aws_lambda_function: 'lambda-function',
  aws_lambda_permission: 'lambda-permission',
  aws_api_gateway_rest_api: 'apigateway-rest-api',
  aws_api_gateway_authorizer: 'apigateway-authorizer',
  aws_s3_bucket: 's3-bucket',
  aws_s3_bucket_policy: 's3-bucket-policy',
  aws_kinesis_firehose_delivery_stream: 'firehose-delivery-stream',
  aws_cloudwatch_log_group: 'logs-log-group',
  aws_cloudwatch_log_stream: 'logs-log-stream',
}

/** Canonical kind for a CloudFormation resource type; an unmapped type keeps its raw name so an unexpected resource still surfaces in the graph rather than vanishing. */
export const canonicalCfnKind = (type: string): string => CFN_KIND[type] ?? type

/** Canonical kind for a Terraform resource type, with the same fall-back as the CloudFormation side. */
export const canonicalTfKind = (type: string): string => TF_KIND[type] ?? type

/** Build a node reference from a kind and an optional channel-stable discriminator. */
export const nodeRef = (kind: string, discriminator?: string): string =>
  discriminator ? `${kind}:${discriminator}` : kind

/** The discriminator segment of a node ref (`iam-role:gateway-role` → `gateway-role`), for anchoring an attached resource to its parent's declared identity. The whole ref when it carries no discriminator. */
export const discriminatorOf = (ref: string): string => {
  const separator = ref.indexOf(':')
  return separator === -1 ? ref : ref.slice(separator + 1)
}

/**
 * Canonicalise the attribute an output exports so a resource's primary identifier reconciles across
 * channels. A CloudFormation `Ref` of an S3 bucket resolves to the bucket name — the same value the
 * Terraform `bucket` attribute carries — so an output exporting the bucket name reduces to one `name`
 * attr in every channel rather than `ref` (CloudFormation) versus `bucket` (Terraform). A `Ref` of a
 * cognito user pool or app client resolves to that resource's id — the same value the Terraform `.id`
 * attribute carries — so an output exporting the pool or client id reduces to one `id` attr in every
 * channel rather than `ref` (CloudFormation) versus `id` (Terraform). Every other attribute (an `arn`)
 * already shares one label across channels and is left exactly as read.
 */
export const canonicalOutputAttr = (kind: string, attr: string): string => {
  if (kind === 's3-bucket' && (attr === 'ref' || attr === 'bucket')) return 'name'
  if (ID_REF_KINDS.has(kind) && (attr === 'ref' || attr === 'id')) return 'id'
  return attr
}

/** The kinds whose CloudFormation `Ref` resolves to the same id the Terraform `.id` attribute carries, so an output exporting either reconciles. */
const ID_REF_KINDS: ReadonlySet<string> = new Set(['cognito-user-pool', 'cognito-user-pool-client', 'apigateway-authorizer'])

/** The IAM service prefixes in an action set, sorted and de-duplicated — a channel-stable discriminator for an inline policy whose generated name differs per channel. */
export const policyServices = (actions: readonly string[]): string => {
  const services = new Set(actions.map((a) => a.split(':')[0]))
  return [...services].sort().join('+')
}

/** The tag key carrying a resource's author-declared identity, identical across channels by construction. */
export const DECLARED_ID_TAG = 'apiable:logical-id'

/**
 * The taggable primary kinds whose identity is the author-declared {@link DECLARED_ID_TAG}, never an
 * inferred name. A present tag drives the node ref so the same component carries the same identity in
 * every channel regardless of its channel-native type string, generated name, account, region, or
 * tenant segment.
 */
export const DECLARED_ID_KINDS: ReadonlySet<string> = new Set([
  'iam-role',
  's3-bucket',
  'cognito-user-pool',
  'lambda-function',
])

/**
 * The taggable primaries the construct kit emits the declared id on — the gateway role, the logs
 * bucket and its write role, both cognito user pools (the authentication and authorization pools the
 * resource-servers, clients, and domain anchor their channel-stable identity to), and the pre-token
 * lambda-function. A missing id on one of these is an explicit divergence (it has no channel-stable
 * identity to compare), never a silent fall-back to the tenant-scoped name — which could mask a
 * substituted function. Every channel carries the id on these kinds: a CloudFormation `Tags` list, a
 * Terraform `tags`/`tags_all` map, and `cdk.Tags.of(...)` on the construct.
 */
export const ENFORCED_DECLARED_ID_KINDS: ReadonlySet<string> = new Set([
  'iam-role',
  's3-bucket',
  'cognito-user-pool',
  'lambda-function',
])

/**
 * The kinds whose node ref must be UNIQUE within a channel: every kind that namespaces a load-bearing
 * value row by its own ref. Two distinct resources of such a kind collapsing onto one ref clobber each
 * other's value last-write-wins and hide a widening on the loser, so the gate fails the collision
 * itself. The axis is VALUE-BEARING, not primary-vs-attached: the taggable {@link DECLARED_ID_KINDS},
 * the two cognito kinds keyed by an author-declared natural key (resource-server Identifier, client
 * name), the api-gateway authorizer (self-keyed by Name), the s3 bucket-policy (anchored to its
 * bucket — AWS permits one policy per bucket, so two on one bucket are a duplicate identity), and the
 * firehose delivery stream (anchored to its delivery role, whose declared id keys it — its destination,
 * routing prefix, compression, and server-side-logging flag are load-bearing value rows). The pooled
 * inline-policy / lambda-permission / user-pool-domain kinds are excluded because they emit NO value row
 * (their security is the grant multiset, which enlarges rather than clobbers), never because they are
 * "attached"; the presence-only log-group / log-stream kinds carry no value row either. A structural
 * test keeps this set in step with the reducers' value-writing sites.
 */
export const VALUE_BEARING_KINDS: ReadonlySet<string> = new Set<string>([
  ...DECLARED_ID_KINDS,
  'cognito-resource-server',
  'cognito-user-pool-client',
  'apigateway-authorizer',
  's3-bucket-policy',
  'firehose-delivery-stream',
])

/**
 * Logical id of the deploy-time parameter the published CloudFormation template scopes a firehose
 * stream's destination logs bucket by. The construct re-exports this from its own module; the parity
 * gate owns the canonical spelling so it imports nothing from the construct directory. The
 * CloudFormation parameter ref is `@ref:LogsBucketArn`.
 */
export const LOGS_BUCKET_ARN_PARAMETER = 'LogsBucketArn'

/**
 * The Terraform reference to the deploy-time logs-bucket variable — the channel-twin of
 * {@link LOGS_BUCKET_ARN_PARAMETER}. The published module names the variable `logs_bucket_arn`, so a
 * stream whose destination `bucket_arn` references this is bound to the conventional deploy-time input.
 * The two spellings (`LogsBucketArn` ⇄ `var.logs_bucket_arn`) are the authored channel forms of the one
 * input, kept together here so the parameter-identity reduction keys both on a single source of truth.
 */
export const LOGS_BUCKET_VAR_REFERENCE = 'var.logs_bucket_arn'

/**
 * The stable token the declared deploy-time logs-bucket PARAMETER reduces to. The destination bucket is
 * a deploy-time input external to the stream artifact, so the conventional case reads as the parameter
 * ref `@ref:LogsBucketArn` in the published CloudFormation channel and a concrete literal bound to
 * `var.logs_bucket_arn` in Terraform — two channel-specific spellings of the one deploy-time input the
 * construct names. Both reduce to this token so the delivery role's S3 grant on the conventional logs
 * bucket reconciles cross-channel, while every *other* ARN keeps its identity (a literal stays a literal,
 * a ref to a different-named parameter stays `@ref:<other>`) and therefore diverges. The token name
 * carries the convention — "this is the declared logs-bucket parameter", not "any delivery destination".
 * A real bucket ARN or a different parameter ref can never equal this token.
 */
export const LOGS_BUCKET_PARAM_TOKEN = '{logs-bucket-param}'

/**
 * Canonicalise a grant resource to {@link LOGS_BUCKET_PARAM_TOKEN} *only* when it names the channel's
 * representation of the declared deploy-time logs-bucket parameter, preserving any trailing object path
 * (`/ *`). `paramDestinations` is the set of each channel's own representation of that destination
 * **when and only when** the stream's `BucketARN`/`bucket_arn` is bound to the conventional parameter:
 * the single `@ref:LogsBucketArn` entry on the CloudFormation side, the concrete `arn:aws:s3:::…` literal
 * the Terraform stream binds via `var.logs_bucket_arn` on the Terraform side. A resource that is a bare
 * literal, or a ref to a different-named parameter/variable, is **not** in the set and is returned
 * unchanged — so a re-pointed destination (an attacker-controlled exfil bucket, whether hardcoded or
 * wired to a differently-named variable) keeps its identity and fails the gate by value.
 *
 * The Terraform variable name is load-bearing: the witness that a TF literal is the conventional
 * deploy-time parameter is that the stream's destination `bucket_arn` references the top-level
 * `var.logs_bucket_arn`. A hand-rolled module that renames that variable while still wiring it as a
 * genuine deploy-time input would fail CLOSED (its literal is unrecognised → diverges from the
 * parameter token), never fail open — using the conventional variable name is part of the published
 * convention the gate polices, and a renamed fork is realigned by adopting the convention.
 */
export const canonicaliseLogsBucketParam = (resource: string, paramDestinations: ReadonlySet<string>): string => {
  for (const destination of paramDestinations) {
    if (resource === destination) return LOGS_BUCKET_PARAM_TOKEN
    if (resource.startsWith(`${destination}/`)) return `${LOGS_BUCKET_PARAM_TOKEN}${resource.slice(destination.length)}`
  }
  return resource
}

/**
 * The Terraform reference to the deploy-time tenant-name variable — the channel-twin of the published
 * CloudFormation `TenantName` parameter. The published cognito module names the variable `name`, so a
 * hosted-UI domain whose `domain` expression references `var.name` is rendered through the conventional
 * deploy-time tenant input. The two spellings (`@ref:TenantName` ⇄ `var.name`) are the authored channel
 * forms of the one input, kept together so the hosted-domain identity reduction keys both on one source.
 */
export const TENANT_NAME_VAR_REFERENCE = 'var.name'

/** The literal prefix the conventional hosted-UI domain is rendered with — `apiable-<tenant>` on every channel. */
export const HOSTED_DOMAIN_PREFIX = 'apiable-'

/** The parameter-ref form the published CloudFormation channel renders the tenant segment of the domain as. */
const HOSTED_DOMAIN_CFN_RENDERING = `${HOSTED_DOMAIN_PREFIX}@ref:`

/**
 * The stable token the conventional `apiable-<tenant>` hosted-UI domain reduces to. The tenant segment is
 * a deploy-time input, so the conventional case reads as the parameter join `apiable-@ref:TenantName` in
 * the published CloudFormation channel and a concrete `apiable-<tenant>` literal bound to `var.name` in
 * Terraform — two channel-specific spellings of the one deploy-time tenant input the construct names. Both
 * reduce to this token so the same tenant's hosted sign-in domain (and the authorize/token discovery
 * endpoints derived from it) reconcile cross-channel, while a substituted host keeps its identity and
 * still diverges by value. The token name carries the convention — "this is the declared tenant hosted
 * domain", not "any domain". A real domain prefix that does not follow the convention can never equal it.
 */
export const HOSTED_DOMAIN_TENANT_TOKEN = '{apiable-tenant-domain}'

/**
 * Canonicalise a hosted-UI domain prefix to {@link HOSTED_DOMAIN_TENANT_TOKEN} *only* when it is the
 * conventional `apiable-<tenant>` rendering of the deploy-time tenant input — so the same tenant's domain
 * reconciles across the published-CloudFormation and Terraform channels even though each renders the tenant
 * segment by a structurally different path. `boundToTenantVar` is the Terraform witness that the domain's
 * literal value is the conventional deploy-time tenant rendering: its `domain` expression references the
 * top-level `var.name`. The CloudFormation witness is structural — the resolved domain is `apiable-` joined
 * to a single deploy-time parameter ref (`apiable-@ref:<param>`).
 *
 * A prefix that is neither (a bare literal not bound to the tenant input, a substituted token-minting host)
 * is returned unchanged, so it keeps its identity and fails the gate by value on both discovery endpoints —
 * the 013-1-20 security floor is preserved, never widened into accepting a substituted host. The tenant
 * variable name is load-bearing exactly as the logs-bucket variable is: a hand-rolled module that renames
 * `var.name` while still wiring it as a genuine deploy-time input fails CLOSED (its literal is unrecognised
 * → diverges from the token), never fail open; adopting the convention realigns it.
 */
export const canonicaliseHostedDomain = (prefix: string, boundToTenantVar: boolean): string => {
  if (boundToTenantVar && prefix.startsWith(HOSTED_DOMAIN_PREFIX)) return HOSTED_DOMAIN_TENANT_TOKEN
  if (prefix.startsWith(HOSTED_DOMAIN_CFN_RENDERING)) return HOSTED_DOMAIN_TENANT_TOKEN
  return prefix
}

/** The stable token the deploy-time tenant segment of a self-named resource collapses to, so the same construct reconciles across a parameter-rendered and a concrete-tenant channel. */
export const TENANT_SEGMENT_TOKEN = '{tenant}'

const AUTHORIZER_NAME_CONVENTION = /^apiable-(.+)-authz$/

/**
 * Canonicalise an API-Gateway authorizer's self-name to a tenant-stable identity. The authorizer is
 * keyed by its `Name` (it carries no declared-id tag — AWS permits one authorizer per Name on a REST
 * API, so the Name IS its identity), and the published convention renders it `apiable-<tenant>-authz`:
 * the deploy-time tenant segment is the published CloudFormation parameter ref (`apiable-@ref:TenantName-authz`)
 * and the concrete tenant in a Terraform plan (`apiable-staging-authz`). Collapsing the tenant segment to a
 * stable token lets the same construct's authorizer reconcile across channels (its identity is the construct,
 * tenant-independent, exactly as a declared id is), while a non-conventional name (a substituted authorizer)
 * does not match the convention, keeps its identity, and still diverges. The authorizer's load-bearing value
 * rows (type, identity-source, execution-role grant set) are compared independently, so a substituted
 * authorizer that mimics the name still fails by value.
 */
export const canonicaliseAuthorizerName = (name: string): string => {
  const match = AUTHORIZER_NAME_CONVENTION.exec(name)
  return match === null ? name : `apiable-${TENANT_SEGMENT_TOKEN}-authz`
}

/** A sentinel marking a taggable primary that should carry a declared id but does not in this channel. */
export const MISSING_DECLARED_ID = '∅:no-declared-logical-id'

/**
 * The discriminator for an enforced taggable primary whose declared id is absent in this channel: a
 * per-channel-unique token built from the channel-local id, so the resource can never coincide with
 * another channel's resource and a missing id always surfaces as an explicit graph divergence rather
 * than being inferred from the name.
 */
export const missingDeclaredId = (localId: string): string => `${MISSING_DECLARED_ID}:${localId}`
