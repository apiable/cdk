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
 * The taggable primaries the construct kit emits the declared id on today — the gateway role, the
 * logs bucket, and its write role. A missing id on one of these is an explicit divergence (it has no
 * channel-stable identity to compare), never a silent fall-back to the name. The remaining
 * {@link DECLARED_ID_KINDS} adopt the id when their constructs are retrofitted; until then a tag-less
 * one keeps its prior name-derived discriminator so an existing verdict is unchanged.
 */
export const ENFORCED_DECLARED_ID_KINDS: ReadonlySet<string> = new Set(['iam-role', 's3-bucket'])

/** A sentinel marking a taggable primary that should carry a declared id but does not in this channel. */
export const MISSING_DECLARED_ID = '∅:no-declared-logical-id'

/**
 * The discriminator for an enforced taggable primary whose declared id is absent in this channel: a
 * per-channel-unique token built from the channel-local id, so the resource can never coincide with
 * another channel's resource and a missing id always surfaces as an explicit graph divergence rather
 * than being inferred from the name.
 */
export const missingDeclaredId = (localId: string): string => `${MISSING_DECLARED_ID}:${localId}`
