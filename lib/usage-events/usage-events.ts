import * as cdk from 'aws-cdk-lib'
import { CfnParameter } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { LogsBucket, TENANT_NAME_PARAMETER, TENANT_NAME_PATTERN_SOURCE } from '@apiable/cdk-logs-bucket'
import {
  DEFAULT_USAGELOGS_NAME,
  DEFAULT_USAGELOGS_PREFIX,
  FIREHOSE_ROLE_LOGICAL_ID,
  LOG_SOURCE_APIGATEWAY_DIRECT,
  LOG_SOURCE_PARAMETER,
  LOG_SOURCE_VALUES,
  LogsStreamConstruct,
} from '@apiable/cdk-usagelogs-stream'
import { CONSTRUCT_NAME } from './launch-stack-url'

export interface UsageEventsProps {
  /** Tenant the bucket and its write role are scoped to (`apiable-logs-<name>`). */
  readonly name: string
  /** Forwarded to the logs bucket; omitted, it defaults to Apiable's partner account. */
  readonly partnerAccount?: string
  /** Forwarded to the stream; omitted, the stream is built for direct API Gateway delivery. */
  readonly logSource?: string
}

/**
 * The customer-side usage-log pipeline in one construct: the tenant logs bucket with its partner write
 * role, and the usage-log delivery stream writing into that same bucket. The stream's name and prefix
 * are the usage-log distribution's fixed values, because Apiable reads the bucket under that prefix and
 * an API Gateway stage attaches to the stream by that name.
 */
export class UsageEvents extends Construct {
  public readonly logsBucket: LogsBucket
  public readonly logsStream: LogsStreamConstruct

  constructor(scope: Construct, id: string, props: UsageEventsProps) {
    super(scope, id)

    this.logsBucket = new LogsBucket(this, 'LogsBucket', { name: props.name, partnerAccount: props.partnerAccount })
    this.logsStream = new LogsStreamConstruct(this, 'LogsStream', {
      logsBucketArn: this.logsBucket.bucket.bucketArn,
      name: DEFAULT_USAGELOGS_NAME,
      prefix: DEFAULT_USAGELOGS_PREFIX,
      logSource: props.logSource,
      firehoseRoleLogicalId: FIREHOSE_ROLE_LOGICAL_ID,
    })
  }
}

export interface UsageEventsStackProps extends cdk.StackProps {
  /** Omitted (the published one-click path), the tenant name is a deploy-time parameter. */
  readonly name?: string
  readonly partnerAccount?: string
  /** Omitted (the published one-click path), the log source is a deploy-time parameter. */
  readonly logSource?: string
}

/** Stack wrapper so the construct synthesizes standalone into the published template. */
export class UsageEventsStack extends cdk.Stack {
  public readonly usageEvents: UsageEvents

  constructor(scope: Construct, id: string, props: UsageEventsStackProps = {}) {
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

    let logSource = props.logSource
    if (logSource === undefined) {
      const logSourceParameter = new CfnParameter(this, LOG_SOURCE_PARAMETER, {
        type: 'String',
        default: LOG_SOURCE_APIGATEWAY_DIRECT,
        allowedValues: [...LOG_SOURCE_VALUES],
        description:
          'How access logs reach the stream: apigateway_direct (API Gateway writes to it) or ' +
          'cloudwatch_logs (a CloudWatch Logs subscription filter feeds it). Fixed at create time — ' +
          'changing it on an existing stack fails the update.',
      })
      logSourceParameter.overrideLogicalId(LOG_SOURCE_PARAMETER)
      logSource = logSourceParameter.valueAsString
    }

    this.usageEvents = new UsageEvents(this, 'UsageEvents', { name, partnerAccount: props.partnerAccount, logSource })
  }
}

/**
 * Build the usage-events stack as published in the launch-stack template: no `env`, so the tenant
 * account resolves to AWS::AccountId and the region to AWS::Region, and the tenant name, partner account
 * and log source stay deploy-time parameters.
 */
export const buildPublishedStack = (app: cdk.App): UsageEventsStack =>
  new UsageEventsStack(app, CONSTRUCT_NAME, {
    description: 'Apiable usage-log pipeline (logs bucket and usage-log delivery stream) - one-click provisioning',
    analyticsReporting: false,
    // an asset-less stack must install into an un-bootstrapped account, so drop the bootstrap-version rule
    synthesizer: new cdk.DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
  })
