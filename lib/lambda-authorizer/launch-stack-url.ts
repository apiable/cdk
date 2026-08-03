/**
 * Launch Stack URL generation for the apiable-lambda-authorizer construct.
 *
 * Portal-agnostic on purpose: this emits the AWS Console deep-link and the versioned S3 template
 * address that one-click provisioning consumes. The wizard backend that calls the generator lives in
 * a separate service and is not wired here.
 */

/** Component name; the first path segment of every published template key. */
export const CONSTRUCT_NAME = 'apiable-lambda-authorizer'

/**
 * Bucket that hosts published launch-stack templates. The real bucket is owned and provisioned by
 * DevOps and supplied as configuration; this placeholder lets the pipeline run end-to-end before that
 * hand-off.
 */
export const DEFAULT_LAUNCHSTACK_BUCKET = 'apiable-launchstack-templates'

/** Tenant identifier the authorizer is scoped to: lowercase letters, digits, and hyphens. */
export const TENANT_NAME_PATTERN_SOURCE = '^[a-z0-9-]+$'

/** Compiled form of {@link TENANT_NAME_PATTERN_SOURCE}. */
export const TENANT_NAME_PATTERN = new RegExp(TENANT_NAME_PATTERN_SOURCE)

export interface LaunchStackUrlInput {
  /** Customer identifier the provisioning is requested for. */
  readonly tenantId: string
  /** Tenant identifier the authorizer is scoped to; pre-filled as a deployment parameter. */
  readonly tenantName: string
  /** Id of the Leaf B gateway pool whose tokens the authorizer validates; pre-filled as a parameter. */
  readonly userPoolId: string
  /** AWS region the customer deploys into. */
  readonly region: string
  /** Published template version, e.g. "1.0.0". */
  readonly version: string
  /** Host bucket override; defaults to the DevOps-owned placeholder. */
  readonly bucket?: string
}

/** S3 object key of a published template version, immutable per version. */
export const launchStackTemplateKey = (version: string): string =>
  `${CONSTRUCT_NAME}/${version}/template.yaml`

/**
 * S3 object key of the authorizer's published code artifact, immutable per version and alongside the
 * template at the same version segment. The handler is too large for CloudFormation's inline `ZipFile`
 * (8,635 B > the 4,096-byte cap), so it deploys from this public, versioned path instead of Apiable's
 * private CDK asset-staging bucket, which a customer account cannot read.
 */
export const launchStackCodeKey = (version: string): string =>
  `${CONSTRUCT_NAME}/${version}/authorizer.zip`

/** Canonical s3:// address of a published template version. */
export const launchStackTemplateS3Uri = (
  version: string,
  bucket: string = DEFAULT_LAUNCHSTACK_BUCKET,
): string => `s3://${bucket}/${launchStackTemplateKey(version)}`

/** HTTPS address the CloudFormation console fetches the template from (region-agnostic global S3 endpoint). */
const templateHttpsUrl = (version: string, bucket: string): string =>
  `https://${bucket}.s3.amazonaws.com/${launchStackTemplateKey(version)}`

/**
 * Build a one-click AWS Console launch-stack URL for the published lambda-authorizer template, with the
 * customer's values pre-filled as deployment parameters.
 *
 * Throws when a required value is missing or when the tenant name is not a valid slug, so a link never
 * carries a blank or malformed value.
 */
export const generateLaunchStackUrl = (input: LaunchStackUrlInput): string => {
  const { tenantId, tenantName, userPoolId, region, version, bucket = DEFAULT_LAUNCHSTACK_BUCKET } = input

  if (!tenantId) throw new Error('tenantId is required to generate a launch stack URL')
  if (!tenantName) throw new Error('tenantName is required to generate a launch stack URL')
  if (!userPoolId) throw new Error('userPoolId is required to generate a launch stack URL')
  if (!region) throw new Error('region is required to generate a launch stack URL')
  if (!version) throw new Error('version is required to generate a launch stack URL')
  if (!TENANT_NAME_PATTERN.test(tenantName)) {
    throw new Error('tenantName must be lowercase letters, digits, and hyphens')
  }

  const params = new URLSearchParams({
    templateURL: templateHttpsUrl(version, bucket),
    stackName: CONSTRUCT_NAME,
    param_TenantName: tenantName,
    param_UserPoolId: userPoolId,
    // RestApiId is the published stack's third required parameter; it is intentionally left for the
    // customer to enter in the console, since the existing gateway's id is not known at link time.
  })
  return `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/create/review?${params.toString()}`
}
