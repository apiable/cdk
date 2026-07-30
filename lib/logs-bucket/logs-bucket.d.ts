import * as cdk from 'aws-cdk-lib';
import { CfnParameter } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
/** Logical id of the cross-account write principal; the launch-stack URL pre-fills `param_<this>`. */
export declare const PARTNER_ACCOUNT_PARAMETER = "ApiablePartnerAccount";
/** Logical id of the tenant-name parameter the published template scopes the bucket by. */
export declare const TENANT_NAME_PARAMETER = "TenantName";
/** Kebab kit-component segment this construct publishes its outputs under. */
export declare const LOGS_BUCKET_COMPONENT = "logs-bucket";
/**
 * Author-declared, channel-identical identities the release-time parity gate keys the two taggable
 * primaries on (the `apiable:logical-id` tag), so each compares equal across the CDK, published-CFN,
 * and Terraform channels regardless of its tenant-scoped name. The hand-rolled Terraform module
 * declares the identical literals.
 */
export declare const LOGS_BUCKET_LOGICAL_ID = "apiable-logs-bucket";
export declare const LOGS_WRITE_ROLE_LOGICAL_ID = "apiable-logs-write-role";
export interface LogsBucketProps {
    /** Tenant/stack identifier the bucket is scoped to — the bucket is named `apiable-logs-<name>`. */
    readonly name: string;
    /**
     * AWS account allowed to write logs to the bucket and assume the log-writing role. Omitting it
     * defaults to Apiable's partner account, reproducing the bucket existing customers already run.
     */
    readonly partnerAccount?: string;
    /**
     * Opt in to publishing this construct's declared outputs (bucket name, bucket ARN, write-role ARN)
     * to the shared parameter space at `/apiable/{name}/logs-bucket/{output}`. Off by default so an
     * existing customer's stack gains no new parameter resource; the tenant key is the bucket's
     * {@link LogsBucketProps.name}.
     */
    readonly publishComposition?: boolean;
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
export declare class LogsBucket extends Construct {
    readonly bucket: s3.Bucket;
    readonly writeRole: iam.Role;
    readonly partnerAccountParameter: CfnParameter;
    constructor(scope: Construct, id: string, props: LogsBucketProps);
}
export interface LogsBucketStackProps extends cdk.StackProps {
    /**
     * Tenant/stack identifier the bucket is scoped to. Omitting it (the published one-click path)
     * surfaces the name as a deploy-time CFN parameter the launch link pre-fills.
     */
    readonly name?: string;
    /** Forwarded to {@link LogsBucketProps.partnerAccount}. */
    readonly partnerAccount?: string;
    /** Forwarded to {@link LogsBucketProps.publishComposition} (requires a concrete {@link name}). */
    readonly publishComposition?: boolean;
}
/** Thin stack wrapper so the construct synthesizes standalone into the published template. */
export declare class LogsBucketStack extends cdk.Stack {
    readonly logsBucket: LogsBucket;
    constructor(scope: Construct, id: string, props?: LogsBucketStackProps);
}
/**
 * Build the logs-bucket stack as published in the launch-stack template: no `env`, so the tenant
 * account resolves to AWS::AccountId, the region to AWS::Region, and the tenant name + partner
 * account stay deploy-time parameters.
 *
 * Single source of the publish-time synth config so the artifact a customer one-clicks is exactly
 * what the published-stack spec asserts.
 */
export declare const buildPublishedStack: (app: cdk.App) => LogsBucketStack;
