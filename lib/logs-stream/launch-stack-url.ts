/**
 * Launch Stack URL generation for the apiable-usagelogs-stream construct.
 *
 * Portal-agnostic on purpose: this emits the AWS Console deep-link and the versioned
 * S3 template address that one-click provisioning consumes. The wizard backend that
 * calls the generator lives in a separate service (Epic 3) and is not wired here.
 */

/** Component name of the usage-log distribution; the first path segment of its published template key. */
export const CONSTRUCT_NAME = 'apiable-usagelogs-stream'

/** Component name of the api-key-token distribution of the same shared stream. */
export const TOKENS_CONSTRUCT_NAME = 'apiable-usagetokens-stream'

/**
 * Bucket that hosts published launch-stack templates. The real bucket is owned and
 * provisioned by DevOps and supplied as configuration; this placeholder lets the
 * pipeline run end-to-end before that hand-off.
 */
export const DEFAULT_LAUNCHSTACK_BUCKET = 'apiable-launchstack-templates'

/** Matches a log-storage bucket ARN: `arn:aws:s3:::<bucket>`. Rejects a blank or a non-ARN value. */
export const BUCKET_ARN_PATTERN_SOURCE = '^arn:aws:s3:::[a-z0-9.-]+$'

/** Compiled form of {@link BUCKET_ARN_PATTERN_SOURCE} for runtime validation. */
export const BUCKET_ARN_PATTERN = new RegExp(BUCKET_ARN_PATTERN_SOURCE)

export interface LaunchStackUrlInput {
  /** Customer identifier the provisioning is requested for. */
  readonly tenantId: string
  /** ARN of the log-storage bucket the stream writes to; pre-filled as a deployment parameter. */
  readonly logsBucketArn: string
  /** AWS region the customer deploys into. */
  readonly region: string
  /** Published template version, e.g. "1.0.0". */
  readonly version: string
  /** Host bucket override; defaults to the DevOps-owned placeholder. */
  readonly bucket?: string
}

/** The launch-stack addressing + URL helpers for one published distribution, scoped by its component name. */
export interface LaunchStackHelpers {
  /** S3 object key of a published template version, immutable per version. */
  readonly launchStackTemplateKey: (version: string) => string
  /** Canonical s3:// address of a published template version. */
  readonly launchStackTemplateS3Uri: (version: string, bucket?: string) => string
  /** One-click AWS Console launch-stack URL with the customer's values pre-filled as deployment parameters. */
  readonly generateLaunchStackUrl: (input: LaunchStackUrlInput) => string
}

/**
 * Build the launch-stack addressing + URL helpers for one published distribution. The two distributions
 * of the shared stream (usage-log and api-key-token) differ only by their component name, so both reuse
 * this one implementation rather than duplicating the URL-building logic.
 */
export const makeLaunchStackHelpers = (constructName: string): LaunchStackHelpers => {
  const launchStackTemplateKey = (version: string): string => `${constructName}/${version}/template.yaml`

  const launchStackTemplateS3Uri = (version: string, bucket: string = DEFAULT_LAUNCHSTACK_BUCKET): string =>
    `s3://${bucket}/${launchStackTemplateKey(version)}`

  const templateHttpsUrl = (version: string, bucket: string): string =>
    `https://${bucket}.s3.amazonaws.com/${launchStackTemplateKey(version)}`

  const generateLaunchStackUrl = (input: LaunchStackUrlInput): string => {
    const { tenantId, logsBucketArn, region, version, bucket = DEFAULT_LAUNCHSTACK_BUCKET } = input

    if (!tenantId) throw new Error('tenantId is required to generate a launch stack URL')
    if (!logsBucketArn) throw new Error('logsBucketArn is required to generate a launch stack URL')
    if (!region) throw new Error('region is required to generate a launch stack URL')
    if (!version) throw new Error('version is required to generate a launch stack URL')
    if (!BUCKET_ARN_PATTERN.test(logsBucketArn)) {
      throw new Error('logsBucketArn must be a valid S3 bucket ARN (arn:aws:s3:::<bucket>)')
    }

    const params = new URLSearchParams({
      templateURL: templateHttpsUrl(version, bucket),
      stackName: constructName,
      param_LogsBucketArn: logsBucketArn,
    })
    return `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/create/review?${params.toString()}`
  }

  return { launchStackTemplateKey, launchStackTemplateS3Uri, generateLaunchStackUrl }
}

const usagelogsHelpers = makeLaunchStackHelpers(CONSTRUCT_NAME)

/** S3 object key of a published usage-log template version, immutable per version. */
export const launchStackTemplateKey = usagelogsHelpers.launchStackTemplateKey

/** Canonical s3:// address of a published usage-log template version. */
export const launchStackTemplateS3Uri = usagelogsHelpers.launchStackTemplateS3Uri

/**
 * Build a one-click AWS Console launch-stack URL for the published usage-log-stream template,
 * with the customer's values pre-filled as deployment parameters.
 *
 * Throws when a required value is missing or when the storage location is not a valid S3 bucket ARN,
 * so a link never carries a blank or malformed destination.
 */
export const generateLaunchStackUrl = usagelogsHelpers.generateLaunchStackUrl
