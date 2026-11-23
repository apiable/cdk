/**
 * Launch Stack URL generation for the apiable-usage-events construct.
 *
 * Portal-agnostic on purpose: this emits the AWS Console deep-link and the versioned S3 template address
 * that one-click provisioning consumes. The tenant name and partner account are validated by the logs
 * bucket's own patterns and the log source by the stream's own values, since the stack composes both.
 */
import { ACCOUNT_ID_PATTERN, DEFAULT_LAUNCHSTACK_BUCKET, TENANT_NAME_PATTERN } from '@apiable/cdk-logs-bucket'
import { LOG_SOURCE_PARAMETER, LOG_SOURCE_VALUES } from '@apiable/cdk-usagelogs-stream'

/** Component name; the first path segment of every published template key. */
export const CONSTRUCT_NAME = 'apiable-usage-events'

export interface LaunchStackUrlInput {
  readonly tenantId: string
  /** Pre-filled as `TenantName`; the bucket is `apiable-logs-<tenantName>`. */
  readonly tenantName: string
  /** Pre-filled as `ApiablePartnerAccount`: the one account allowed to write logs and assume the write role. */
  readonly writeAccount: string
  readonly region: string
  /** Published template version, e.g. "1.0.0". */
  readonly version: string
  /** Pre-fills `LogSource`; omitted, the template default (direct API Gateway delivery) stays in place. */
  readonly logSource?: string
  /** Host bucket override; defaults to the DevOps-owned placeholder. */
  readonly bucket?: string
}

/** S3 object key of a published template version, immutable per version. */
export const launchStackTemplateKey = (version: string): string => `${CONSTRUCT_NAME}/${version}/template.yaml`

/** Canonical s3:// address of a published template version. */
export const launchStackTemplateS3Uri = (version: string, bucket: string = DEFAULT_LAUNCHSTACK_BUCKET): string =>
  `s3://${bucket}/${launchStackTemplateKey(version)}`

const templateHttpsUrl = (version: string, bucket: string): string =>
  `https://${bucket}.s3.amazonaws.com/${launchStackTemplateKey(version)}`

/**
 * Build a one-click AWS Console launch-stack URL for the published usage-events template, with the
 * customer's values pre-filled as deployment parameters.
 *
 * Throws when a required value is missing, when the tenant name is not a valid bucket-name slug, when
 * the write account names anything other than exactly one account, or when the log source is not one
 * the stream supports, so a link never carries a blank or trust-widening value.
 */
export const generateLaunchStackUrl = (input: LaunchStackUrlInput): string => {
  const { tenantId, tenantName, writeAccount, region, version, logSource, bucket = DEFAULT_LAUNCHSTACK_BUCKET } = input

  if (!tenantId) throw new Error('tenantId is required to generate a launch stack URL')
  if (!tenantName) throw new Error('tenantName is required to generate a launch stack URL')
  if (!writeAccount) throw new Error('write account is required to generate a launch stack URL')
  if (!region) throw new Error('region is required to generate a launch stack URL')
  if (!version) throw new Error('version is required to generate a launch stack URL')
  if (!TENANT_NAME_PATTERN.test(tenantName)) {
    throw new Error('tenantName must be lowercase letters, digits, and hyphens')
  }
  if (!ACCOUNT_ID_PATTERN.test(writeAccount)) {
    throw new Error('write account must be exactly one 12-digit AWS account id')
  }
  if (logSource !== undefined && !LOG_SOURCE_VALUES.includes(logSource)) {
    throw new Error(`logSource must be one of ${LOG_SOURCE_VALUES.join(', ')}`)
  }

  const params = new URLSearchParams({
    templateURL: templateHttpsUrl(version, bucket),
    stackName: CONSTRUCT_NAME,
    param_TenantName: tenantName,
    param_ApiablePartnerAccount: writeAccount,
    ...(logSource === undefined ? {} : { [`param_${LOG_SOURCE_PARAMETER}`]: logSource }),
  })
  return `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/create/review?${params.toString()}`
}
