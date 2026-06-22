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
 * attr in every channel rather than `ref` (CloudFormation) versus `bucket` (Terraform). Every other
 * attribute (an `arn`) already shares one label across channels and is left exactly as read.
 */
export const canonicalOutputAttr = (kind: string, attr: string): string =>
  kind === 's3-bucket' && (attr === 'ref' || attr === 'bucket') ? 'name' : attr

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
 * The stable token a firehose delivery stream's destination logs-bucket ARN reduces to. The bucket is
 * a deploy-time input external to the stream artifact, so it reads as a parameter ref in the published
 * CloudFormation channel and a concrete literal in Terraform — two channel-specific forms of the one
 * "the logs bucket the customer supplies". Both reduce to this token so the delivery role's S3 grant on
 * that bucket (and the stream's destination) reconciles cross-channel by the role's grant, while a
 * stream wired to a genuinely different in-stack bucket (an Fn::GetAtt / address reference) still
 * resolves to that bucket's node ref and diverges. A real bucket ARN can never equal this token.
 */
export const LOGS_BUCKET_ARN_TOKEN = '{logs-bucket-arn}'

/**
 * Canonicalise a grant resource that names one of a channel's firehose delivery destinations (its
 * external logs bucket) to {@link LOGS_BUCKET_ARN_TOKEN}, preserving any trailing object path (`/ *`).
 * `deliveryArns` is the set of each channel's own destination-bucket representations — the resolved
 * `@ref:<param>` on the CloudFormation side, the concrete `arn:aws:s3:::…` literal on the Terraform side
 * — so the same deploy-time bucket reduces to one token in every channel. A resource naming no delivery
 * destination is returned unchanged.
 */
export const canonicaliseLogsBucketArn = (resource: string, deliveryArns: ReadonlySet<string>): string => {
  for (const arn of deliveryArns) {
    if (resource === arn) return LOGS_BUCKET_ARN_TOKEN
    if (resource.startsWith(`${arn}/`)) return `${LOGS_BUCKET_ARN_TOKEN}${resource.slice(arn.length)}`
  }
  return resource
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
