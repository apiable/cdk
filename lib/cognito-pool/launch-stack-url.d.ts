/**
 * Launch Stack URL generation for the apiable-cognito-pool construct.
 *
 * Portal-agnostic on purpose: this emits the AWS Console deep-link and the versioned S3 template
 * address that one-click provisioning consumes. The wizard backend that calls the generator lives in
 * a separate service and is not wired here.
 */
/** Component name; the first path segment of every published template key. */
export declare const CONSTRUCT_NAME = "apiable-cognito-pool";
/**
 * Bucket that hosts published launch-stack templates. The real bucket is owned and provisioned by
 * DevOps and supplied as configuration; this placeholder lets the pipeline run end-to-end before that
 * hand-off.
 */
export declare const DEFAULT_LAUNCHSTACK_BUCKET = "apiable-launchstack-templates";
/** Tenant identifier the pool is scoped to: lowercase letters, digits, and hyphens. */
export declare const TENANT_NAME_PATTERN_SOURCE = "^[a-z0-9-]+$";
/** Compiled form of {@link TENANT_NAME_PATTERN_SOURCE}. */
export declare const TENANT_NAME_PATTERN: RegExp;
/** Cognito feature tiers that can run V3_0 Pre Token Generation (access-token customisation). */
export declare const FEATURE_PLANS_WITH_V3: readonly ["ESSENTIALS", "PLUS"];
/** A Cognito feature plan the construct accepts. LITE cannot run V3_0 and is rejected by the guard. */
export type FeaturePlan = 'LITE' | 'ESSENTIALS' | 'PLUS';
export interface LaunchStackUrlInput {
    /** Customer identifier the provisioning is requested for. */
    readonly tenantId: string;
    /** Tenant identifier the pool is scoped to; pre-filled as a deployment parameter. */
    readonly tenantName: string;
    /** AWS region the customer deploys into. */
    readonly region: string;
    /** Published template version, e.g. "1.0.0". */
    readonly version: string;
    /** Host bucket override; defaults to the DevOps-owned placeholder. */
    readonly bucket?: string;
}
/** S3 object key of a published template version, immutable per version. */
export declare const launchStackTemplateKey: (version: string) => string;
/** Canonical s3:// address of a published template version. */
export declare const launchStackTemplateS3Uri: (version: string, bucket?: string) => string;
/**
 * Build a one-click AWS Console launch-stack URL for the published cognito-pool template, with the
 * customer's values pre-filled as deployment parameters.
 *
 * Throws when a required value is missing or when the tenant name is not a valid slug, so a link never
 * carries a blank or malformed value.
 */
export declare const generateLaunchStackUrl: (input: LaunchStackUrlInput) => string;
