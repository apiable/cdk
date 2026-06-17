import * as cdk from 'aws-cdk-lib'
import { CfnOutput, CfnParameter } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as iam from 'aws-cdk-lib/aws-iam'
import {
  ACCOUNT_ID_PATTERN,
  ACCOUNT_ID_PATTERN_SOURCE,
  CONSTRUCT_NAME,
  DEFAULT_APIABLE_PARTNER_ACCOUNT,
  TENANT_NAME_PATTERN_SOURCE,
} from './launch-stack-url'

/** Logical id of the cross-account write principal; the launch-stack URL pre-fills `param_<this>`. */
export const PARTNER_ACCOUNT_PARAMETER = 'ApiablePartnerAccount'

/** Logical id of the tenant-name parameter the published template scopes the bucket by. */
export const TENANT_NAME_PARAMETER = 'TenantName'

export interface LogsBucketProps {
  /** Tenant/stack identifier the bucket is scoped to — the bucket is named `apiable-logs-<name>`. */
  readonly name: string
  /**
   * AWS account allowed to write logs to the bucket and assume the log-writing role. Omitting it
   * defaults to Apiable's partner account, reproducing the bucket existing customers already run.
   */
  readonly partnerAccount?: string
}

/**
 * Apiable logs S3 bucket as a reusable construct: a tenant-scoped bucket, a resource policy granting
 * the tenant account and a single bounded partner account, and a role the partner assumes to write
 * logs. The partner account is a single bounded deployment parameter and the tenant account resolves
 * to the deploying account, so no customer- or Apiable-specific identifier is fixed in a resource.
 *
 * Retention posture is the existing one — the bucket is retained on update/delete and not
 * auto-emptied; this construct introduces no S3 lifecycle/expiry rule (deferred to the analytics
 * redesign).
 */
export class LogsBucket extends Construct {
  public readonly bucket: s3.Bucket
  public readonly writeRole: iam.Role
  public readonly partnerAccountParameter: CfnParameter

  constructor(scope: Construct, id: string, props: LogsBucketProps) {
    super(scope, id)

    if (!props.name) throw new Error('name is required to scope the logs bucket')
    if (props.partnerAccount !== undefined && !ACCOUNT_ID_PATTERN.test(props.partnerAccount)) {
      throw new Error('partnerAccount must be exactly one 12-digit AWS account id')
    }

    const { name } = props
    // The deploying account; resolves to the AWS::AccountId pseudo-parameter when no env is set, so
    // the published template carries no account literal, and to the supplied account otherwise.
    const account = cdk.Stack.of(this).account

    this.partnerAccountParameter = new CfnParameter(this, PARTNER_ACCOUNT_PARAMETER, {
      type: 'String',
      default: props.partnerAccount ?? DEFAULT_APIABLE_PARTNER_ACCOUNT,
      allowedPattern: ACCOUNT_ID_PATTERN_SOURCE,
      minLength: 12,
      maxLength: 12,
      description: 'AWS account allowed to write logs to the bucket and assume the log-writing role',
      constraintDescription: 'must be exactly one 12-digit AWS account id',
    })
    // Pin the logical id so the launch-stack URL's `param_ApiablePartnerAccount` addresses it.
    this.partnerAccountParameter.overrideLogicalId(PARTNER_ACCOUNT_PARAMETER)
    const partnerAccount = this.partnerAccountParameter.valueAsString

    this.bucket = new s3.Bucket(this, 'ApiableLogs', {
      bucketName: `apiable-logs-${name}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
      autoDeleteObjects: false,
    })

    this.bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'Permissions',
        effect: iam.Effect.ALLOW,
        principals: [
          new iam.ArnPrincipal(`arn:aws:iam::${account}:root`),
          new iam.ArnPrincipal(`arn:aws:iam::${partnerAccount}:root`),
        ],
        actions: ['s3:*'],
        resources: [this.bucket.bucketArn, `${this.bucket.bucketArn}/*`],
      }),
    )

    this.writeRole = new iam.Role(this, 'WriteRole', {
      assumedBy: new iam.AccountPrincipal(partnerAccount),
      roleName: `apiable-logs-${name}-s3-role`,
      description: 'Role for partner account to Access the S3 Bucket',
    })

    this.writeRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [this.bucket.bucketArn, `${this.bucket.bucketArn}/*`],
        actions: ['s3:*'],
      }),
    )

    // A concrete name embeds in the output logical ids exactly as the standalone deploy expects; a
    // parameterised (token) name cannot be a logical id, so the published template uses stable ids.
    const suffix = cdk.Token.isUnresolved(name) ? '' : name
    new CfnOutput(this, `BucketName${suffix}`, {
      value: this.bucket.bucketName,
      description: 'The name of the S3 bucket',
    })
    new CfnOutput(this, `BucketArn${suffix}`, {
      value: this.bucket.bucketArn,
      description: 'The ARN of the S3 bucket',
    })
    new CfnOutput(this, cdk.Token.isUnresolved(name) ? 'S3AssumeRoleArn' : `s3-assume-role-${name}-arn`, {
      value: this.writeRole.roleArn,
      description: 'The ARN of the S3 bucket role',
    })
  }
}

export interface LogsBucketStackProps extends cdk.StackProps {
  /**
   * Tenant/stack identifier the bucket is scoped to. Omitting it (the published one-click path)
   * surfaces the name as a deploy-time CFN parameter the launch link pre-fills.
   */
  readonly name?: string
  /** Forwarded to {@link LogsBucketProps.partnerAccount}. */
  readonly partnerAccount?: string
}

/** Thin stack wrapper so the construct synthesizes standalone into the published template. */
export class LogsBucketStack extends cdk.Stack {
  public readonly logsBucket: LogsBucket

  constructor(scope: Construct, id: string, props: LogsBucketStackProps = {}) {
    super(scope, id, props)

    let name = props.name
    if (name === undefined) {
      const tenantNameParameter = new CfnParameter(this, TENANT_NAME_PARAMETER, {
        type: 'String',
        minLength: 1,
        allowedPattern: TENANT_NAME_PATTERN_SOURCE,
        description: 'Tenant identifier the logs bucket is scoped to (apiable-logs-<name>)',
        constraintDescription: 'must be lowercase letters, digits, and hyphens',
      })
      tenantNameParameter.overrideLogicalId(TENANT_NAME_PARAMETER)
      name = tenantNameParameter.valueAsString
    }

    this.logsBucket = new LogsBucket(this, 'LogsBucket', { name, partnerAccount: props.partnerAccount })
  }
}

/**
 * Build the logs-bucket stack as published in the launch-stack template: no `env`, so the tenant
 * account resolves to AWS::AccountId, the region to AWS::Region, and the tenant name + partner
 * account stay deploy-time parameters.
 *
 * Single source of the publish-time synth config so the artifact a customer one-clicks is exactly
 * what the published-stack spec asserts.
 */
export const buildPublishedStack = (app: cdk.App): LogsBucketStack =>
  new LogsBucketStack(app, CONSTRUCT_NAME, {
    description: 'Apiable S3 bucket to write logs into — one-click provisioning',
    analyticsReporting: false,
    // an asset-less bucket must install into an un-bootstrapped account, so drop the bootstrap-version rule
    synthesizer: new cdk.DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
  })
