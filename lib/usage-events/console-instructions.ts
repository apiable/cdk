/**
 * The usage-events hand-build set's inputs: which template inputs stay tokens for the serving portal to
 * fill, and which input's default the set records as the path it documents. A token is the kebab form
 * of its input without the `Apiable` prefix; the region and the deploying account keep the parity
 * model's `{region}` and `{account}`.
 */
import { ConsoleResourceSet, generateConsoleResourceSet } from '../console-explainer/resource-set'
import type { ConsoleResourceSetReduction } from '../parity-gate/console-resource-set-reducer'
import { LOGS_WRITE_ROLE_LOGICAL_ID, PARTNER_ACCOUNT_PARAMETER, TENANT_NAME_PARAMETER } from '@apiable/cdk-logs-bucket'
import { LOG_SOURCE_PARAMETER } from '@apiable/cdk-usagelogs-stream'
import { CONSTRUCT_NAME } from './launch-stack-url'

export const TENANT_NAME_TOKEN = '{tenant-name}'
export const PARTNER_ACCOUNT_TOKEN = '{partner-account}'

/** The tokens a usage-events set must carry: the three the portal fills. `{account}` stays the customer's. */
export const USAGE_EVENTS_FILL_TOKENS: readonly string[] = ['{region}', TENANT_NAME_TOKEN, PARTNER_ACCOUNT_TOKEN]

export const USAGE_EVENTS_PARAMETER_TOKENS: Readonly<Record<string, string>> = {
  [TENANT_NAME_PARAMETER]: TENANT_NAME_TOKEN,
  [PARTNER_ACCOUNT_PARAMETER]: PARTNER_ACCOUNT_TOKEN,
}

/** The set documents the log source's default path, the one a hand-build follows. */
export const USAGE_EVENTS_DOCUMENTED_PARAMETERS: Readonly<Record<string, string>> = { logSource: LOG_SOURCE_PARAMETER }

export const generateUsageEventsConsoleSet = (template: unknown, version: string): ConsoleResourceSet =>
  generateConsoleResourceSet(template, {
    construct: CONSTRUCT_NAME,
    version,
    parameterTokens: USAGE_EVENTS_PARAMETER_TOKENS,
    documentedParameters: USAGE_EVENTS_DOCUMENTED_PARAMETERS,
  })

/**
 * How the parity gate reads a usage-events set back: its two tokenised inputs, and the stack outputs the
 * other three channels export (the bucket's name and ARN, the write role's ARN, the stream's ARN).
 */
export const USAGE_EVENTS_CONSOLE_REDUCTION: ConsoleResourceSetReduction = {
  parameterTokens: USAGE_EVENTS_PARAMETER_TOKENS,
  exports: [
    { cfnType: 'AWS::S3::Bucket', attribute: 'Ref' },
    { cfnType: 'AWS::S3::Bucket', attribute: 'Arn' },
    { cfnType: 'AWS::IAM::Role', declaredId: LOGS_WRITE_ROLE_LOGICAL_ID, attribute: 'Arn' },
    { cfnType: 'AWS::KinesisFirehose::DeliveryStream', attribute: 'Arn' },
  ],
}
