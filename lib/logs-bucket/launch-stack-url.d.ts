/**
 * Launch Stack URL generation for the apiable-logs-bucket construct.
 *
 * Portal-agnostic on purpose: this emits the AWS Console deep-link and the versioned
 * S3 template address that one-click provisioning consumes. The wizard backend that
 * calls the generator lives in a separate service (Epic 3) and is not wired here.
 */
/** Component name; the first path segment of every published template key. */
export declare const CONSTRUCT_NAME = "apiable-logs-bucket";
/** Default AWS account allowed to write logs to the bucket and assume the log-writing role. */
export declare const DEFAULT_APIABLE_PARTNER_ACCOUNT = "034444869755";
/**
 * Bucket that hosts published launch-stack templates. The real bucket is owned and
 * provisioned by DevOps and supplied as configuration; this placeholder lets the
 * pipeline run end-to-end before that hand-off.
 */
export declare const DEFAULT_LAUNCHSTACK_BUCKET = "apiable-launchstack-templates";
/** Matches exactly one 12-digit AWS account; rejects a wildcard, a list, or extra principals. */
export declare const ACCOUNT_ID_PATTERN_SOURCE = "^[0-9]{12}$";
/** Compiled form of {@link ACCOUNT_ID_PATTERN_SOURCE} for runtime validation. */
export declare const ACCOUNT_ID_PATTERN: RegExp;
/** Tenant identifier the bucket is scoped to: lowercase letters, digits, and hyphens. */
export declare const TENANT_NAME_PATTERN_SOURCE = "^[a-z0-9-]+$";
/** Compiled form of {@link TENANT_NAME_PATTERN_SOURCE}. */
export declare const TENANT_NAME_PATTERN: RegExp;
export interface LaunchStackUrlInput {
    /** Customer identifier the provisioning is requested for. */
    readonly tenantId: string;
    /** Tenant identifier the bucket is scoped to; pre-filled as a deployment parameter (apiable-logs-<tenantName>). */
    readonly tenantName: string;
    /** AWS account allowed to write logs and assume the log-writing role; pre-filled as a deployment parameter. */
    readonly writeAccount: string;
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
 * Build a one-click AWS Console launch-stack URL for the published logs-bucket template,
 * with the customer's values pre-filled as deployment parameters.
 *
 * Throws when a required value is missing, when the tenant name is not a valid bucket-name slug,
 * or when the write account names anything other than exactly one account, so a link never carries
 * a blank or trust-widening value.
 */
export declare const generateLaunchStackUrl: (input: LaunchStackUrlInput) => string;
