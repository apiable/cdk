/**
 * Launch Stack URL generation for the apiable-gateway-role construct.
 *
 * Portal-agnostic on purpose: this emits the AWS Console deep-link and the versioned
 * S3 template address that one-click provisioning consumes. The wizard backend that
 * calls the generator lives in a separate service and is not wired here.
 */

/** Component name; the first path segment of every published template key. */
export const CONSTRUCT_NAME = 'apiable-gateway-role'

/** Default AWS account Apiable assumes the gateway-management role from. */
export const DEFAULT_APIABLE_TRUST_ACCOUNT = '034444869755'

/**
 * Bucket that hosts published launch-stack templates. The real bucket is owned and
 * provisioned by DevOps and supplied as configuration; this placeholder lets the
 * pipeline run end-to-end before that hand-off.
 */
export const DEFAULT_LAUNCHSTACK_BUCKET = 'apiable-launchstack-templates'

/** Matches exactly one 12-digit AWS account; rejects a wildcard, a list, or extra principals. */
export const ACCOUNT_ID_PATTERN_SOURCE = '^[0-9]{12}$'

/** Compiled form of {@link ACCOUNT_ID_PATTERN_SOURCE} for runtime validation. */
export const ACCOUNT_ID_PATTERN = new RegExp(ACCOUNT_ID_PATTERN_SOURCE)

/**
 * Address Apiable's calls originate from. The role denies every request from outside it, so a
 * stale value locks Apiable out of the customer's gateway rather than over-granting — wrong here
 * fails closed, and silently, which is why it is a deployment parameter and not a source literal
 * baked past the point of repair.
 */
export const DEFAULT_APIABLE_EGRESS_CIDR = '63.180.116.108/32'

/** Matches one IPv4 CIDR block; rejects a bare address, a list, or a trailing wildcard. */
export const CIDR_PATTERN_SOURCE = '^([0-9]{1,3}\\.){3}[0-9]{1,3}/([0-9]|[1-2][0-9]|3[0-2])$'

/** Compiled form of {@link CIDR_PATTERN_SOURCE} for runtime validation. */
export const CIDR_PATTERN = new RegExp(CIDR_PATTERN_SOURCE)

export interface LaunchStackUrlInput {
  /** Customer identifier the provisioning is requested for. */
  readonly tenantId: string
  /** AWS account authorised to assume the role; pre-filled as a deployment parameter. */
  readonly roleTrustTarget: string
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

/** Canonical s3:// address of a published template version. */
export const launchStackTemplateS3Uri = (
  version: string,
  bucket: string = DEFAULT_LAUNCHSTACK_BUCKET,
): string => `s3://${bucket}/${launchStackTemplateKey(version)}`

/** HTTPS address the CloudFormation console fetches the template from. */
const templateHttpsUrl = (version: string, bucket: string): string =>
  `https://${bucket}.s3.amazonaws.com/${launchStackTemplateKey(version)}`

/**
 * Build a one-click AWS Console launch-stack URL for the published gateway-role template,
 * with the customer's values pre-filled as deployment parameters.
 *
 * Throws when a required value is missing, or when the trust target names anything other
 * than exactly one account, so a link never carries a blank or trust-widening value.
 */
export const generateLaunchStackUrl = (input: LaunchStackUrlInput): string => {
  const { tenantId, roleTrustTarget, region, version, bucket = DEFAULT_LAUNCHSTACK_BUCKET } = input

  if (!tenantId) throw new Error('tenantId is required to generate a launch stack URL')
  if (!roleTrustTarget) throw new Error('role-trust target is required to generate a launch stack URL')
  if (!region) throw new Error('region is required to generate a launch stack URL')
  if (!version) throw new Error('version is required to generate a launch stack URL')
  if (!ACCOUNT_ID_PATTERN.test(roleTrustTarget)) {
    throw new Error('role-trust target must be exactly one 12-digit AWS account id')
  }

  const params = new URLSearchParams({
    templateURL: templateHttpsUrl(version, bucket),
    stackName: CONSTRUCT_NAME,
    param_ApiableTrustAccount: roleTrustTarget,
  })
  return `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/create/review?${params.toString()}`
}
