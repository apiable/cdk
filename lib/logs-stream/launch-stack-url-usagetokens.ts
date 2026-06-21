/**
 * Launch Stack URL generation for the apiable-usagetokens-stream distribution — the api-key-token
 * distribution of the SAME shared stream construct the usage-log distribution publishes.
 *
 * Portal-agnostic on purpose: this emits the AWS Console deep-link and the versioned S3 template
 * address that one-click provisioning consumes. The wizard backend that calls the generator lives in a
 * separate service (Epic 3) and is not wired here. The URL-building itself is shared with the usage-log
 * distribution via {@link makeLaunchStackHelpers}; only the component name differs.
 */
import { TOKENS_CONSTRUCT_NAME, makeLaunchStackHelpers } from './launch-stack-url'

const helpers = makeLaunchStackHelpers(TOKENS_CONSTRUCT_NAME)

/** S3 object key of a published token-stream template version, immutable per version. */
export const tokensLaunchStackTemplateKey = helpers.launchStackTemplateKey

/** Canonical s3:// address of a published token-stream template version. */
export const tokensLaunchStackTemplateS3Uri = helpers.launchStackTemplateS3Uri

/**
 * Build a one-click AWS Console launch-stack URL for the published token-stream template, with the
 * customer's values pre-filled as deployment parameters.
 *
 * Throws when a required value is missing or when the storage location is not a valid S3 bucket ARN, so
 * a link never carries a blank or malformed destination.
 */
export const generateTokensLaunchStackUrl = helpers.generateLaunchStackUrl
