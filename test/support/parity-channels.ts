import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import { buildPublishedStack as buildGatewayRoleStack } from '@apiable/cdk-gateway-role'
import { buildPublishedStack as buildLogsBucketStack } from '@apiable/cdk-logs-bucket'
import { buildPublishedStack as buildCognitoPoolStack } from '@apiable/cdk-cognito-pool'
import { buildPublishedStack as buildLambdaAuthorizerStack } from '@apiable/cdk-lambda-authorizer'
import { buildPublishedStack as buildUsageLogsStreamStack, buildPublishedTokensStack as buildUsageTokensStreamStack } from '@apiable/cdk-usagelogs-stream'
import { buildPublishedStack as buildUsageEventsStack } from '@apiable/cdk-usage-events'
import { publishedTemplatePath } from './published-template'

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'parity-gate')

/** Where each channel of one construct comes from, and the arguments its reducers take. */
export interface ParityChannelRow {
  readonly construct: string
  readonly buildCdk: (app: cdk.App) => cdk.Stack
  readonly publishedCfn: string
  readonly tfFixture: string
  readonly tfRegion: string
  /** Region handed to the CDK and published-CFN reducers; unset where that construct's spec reduces them region-less. */
  readonly cfnRegion?: string
  /** The committed fixture's deploying account (CI regenerates it credentialed), so its tenant root tokenises like AWS::AccountId. */
  readonly tfDeployAccount?: string
}

export const GATEWAY_ROLE: ParityChannelRow = {
  construct: 'apiable-gateway-role',
  buildCdk: (app) => buildGatewayRoleStack(app),
  publishedCfn: publishedTemplatePath('apiable-gateway-role'),
  tfFixture: path.join(FIXTURES, 'terraform-gateway-role-show.json'),
  tfRegion: 'eu-central-1',
}

export const LOGS_BUCKET: ParityChannelRow = {
  construct: 'apiable-logs-bucket',
  buildCdk: (app) => buildLogsBucketStack(app),
  publishedCfn: publishedTemplatePath('apiable-logs-bucket'),
  tfFixture: path.join(FIXTURES, 'terraform-logs-bucket-show.json'),
  tfRegion: 'eu-central-1',
  tfDeployAccount: '111111111111',
}

export const COGNITO_POOL: ParityChannelRow = {
  construct: 'apiable-cognito-pool',
  buildCdk: (app) => buildCognitoPoolStack(app),
  publishedCfn: publishedTemplatePath('apiable-cognito-pool'),
  tfFixture: path.join(FIXTURES, 'terraform-cognito-pool-show.json'),
  tfRegion: 'eu-central-1',
  cfnRegion: 'eu-central-1',
  tfDeployAccount: '111111111111',
}

export const LAMBDA_AUTHORIZER: ParityChannelRow = {
  construct: 'apiable-lambda-authorizer',
  buildCdk: (app) => buildLambdaAuthorizerStack(app),
  publishedCfn: publishedTemplatePath('apiable-lambda-authorizer'),
  tfFixture: path.join(FIXTURES, 'terraform-lambda-authorizer-show.json'),
  tfRegion: 'eu-central-1',
  cfnRegion: 'eu-central-1',
  tfDeployAccount: '111111111111',
}

export const USAGELOGS_STREAM: ParityChannelRow = {
  construct: 'apiable-usagelogs-stream',
  buildCdk: (app) => buildUsageLogsStreamStack(app),
  publishedCfn: publishedTemplatePath('apiable-usagelogs-stream'),
  tfFixture: path.join(FIXTURES, 'terraform-usagelogs-stream-show.json'),
  tfRegion: 'eu-central-1',
  tfDeployAccount: '111111111111',
}

export const USAGETOKENS_STREAM: ParityChannelRow = {
  construct: 'apiable-usagetokens-stream',
  buildCdk: (app) => buildUsageTokensStreamStack(app),
  publishedCfn: publishedTemplatePath('apiable-usagetokens-stream'),
  tfFixture: path.join(FIXTURES, 'terraform-usagetokens-stream-show.json'),
  tfRegion: 'eu-central-1',
  tfDeployAccount: '111111111111',
}

export const USAGE_EVENTS: ParityChannelRow = {
  construct: 'apiable-usage-events',
  buildCdk: (app) => buildUsageEventsStack(app),
  publishedCfn: publishedTemplatePath('apiable-usage-events'),
  tfFixture: path.join(FIXTURES, 'terraform-usage-events-show.json'),
  tfRegion: 'eu-central-1',
  tfDeployAccount: '111111111111',
}

export const PARITY_CHANNELS: readonly ParityChannelRow[] = [
  GATEWAY_ROLE,
  LOGS_BUCKET,
  COGNITO_POOL,
  LAMBDA_AUTHORIZER,
  USAGELOGS_STREAM,
  USAGETOKENS_STREAM,
  USAGE_EVENTS,
]
