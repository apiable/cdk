/**
 * The fixed physical name a hand-build set addresses each resource by, and the ARN that name derives,
 * per CloudFormation type. The set generator resolves a resource reference through these rules and the
 * parity gate's console reducer inverts them, so both read one table. Kept free of aws-cdk-lib so the
 * parity-gate barrel that imports it stays loadable where the CDK is not.
 */

/** The property that carries a resource's fixed physical name, for each type a set can reference by name. */
export const PHYSICAL_NAME_PROPERTY: Readonly<Record<string, string>> = {
  'AWS::S3::Bucket': 'BucketName',
  'AWS::IAM::Role': 'RoleName',
  'AWS::Logs::LogGroup': 'LogGroupName',
  'AWS::Logs::LogStream': 'LogStreamName',
  'AWS::KinesisFirehose::DeliveryStream': 'DeliveryStreamName',
}

/** The ARN of a resource with a fixed name, for each type whose ARN is derivable from its name alone. */
const ARN_BY_TYPE: Readonly<Record<string, (name: string, region: string, account: string) => string>> = {
  'AWS::S3::Bucket': (name) => `arn:aws:s3:::${name}`,
  'AWS::IAM::Role': (name, _region, account) => `arn:aws:iam::${account}:role/${name}`,
  'AWS::Logs::LogGroup': (name, region, account) => `arn:aws:logs:${region}:${account}:log-group:${name}:*`,
  'AWS::KinesisFirehose::DeliveryStream': (name, region, account) => `arn:aws:firehose:${region}:${account}:deliverystream/${name}`,
}

/** The fixed physical name a resource's properties carry, or `undefined` when its type has none or it is not a literal. */
export const physicalNameOf = (cfnType: string, properties: Readonly<Record<string, unknown>>): string | undefined => {
  const property = PHYSICAL_NAME_PROPERTY[cfnType]
  const value = property === undefined ? undefined : properties[property]
  return typeof value === 'string' ? value : undefined
}

/** The derived ARN for a resource of `cfnType` named `name`, or `undefined` when that type's ARN is not derivable. */
export const derivedArnOf = (cfnType: string, name: string, region: string, account: string): string | undefined =>
  ARN_BY_TYPE[cfnType]?.(name, region, account)
