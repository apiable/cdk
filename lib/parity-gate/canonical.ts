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
}

/** Canonical kind for a CloudFormation resource type; an unmapped type keeps its raw name so an unexpected resource still surfaces in the graph rather than vanishing. */
export const canonicalCfnKind = (type: string): string => CFN_KIND[type] ?? type

/** Canonical kind for a Terraform resource type, with the same fall-back as the CloudFormation side. */
export const canonicalTfKind = (type: string): string => TF_KIND[type] ?? type

/** Build a node reference from a kind and an optional channel-stable discriminator. */
export const nodeRef = (kind: string, discriminator?: string): string =>
  discriminator ? `${kind}:${discriminator}` : kind

/** The IAM service prefixes in an action set, sorted and de-duplicated — a channel-stable discriminator for an inline policy whose generated name differs per channel. */
export const policyServices = (actions: readonly string[]): string => {
  const services = new Set(actions.map((a) => a.split(':')[0]))
  return [...services].sort().join('+')
}
