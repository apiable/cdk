import * as cdk from 'aws-cdk-lib'
import { buildPublishedStack as buildGatewayRoleStack } from '../lib/gateway-role'
import { buildPublishedStack as buildLogsBucketStack } from '../lib/logs-bucket'
import {
  buildPublishedStack as buildUsageLogsStreamStack,
  buildPublishedTokensStack as buildUsageTokensStreamStack,
} from '../lib/logs-stream'

/**
 * Synth entrypoint for the published launch-stack templates. Each construct's published stack is
 * registered under its component name, so `cdk synth <construct-name>` selects the one to emit. The
 * shared usage stream registers under both distribution identities (usage-log and api-key-token).
 */
const app = new cdk.App()
buildGatewayRoleStack(app)
buildLogsBucketStack(app)
buildUsageLogsStreamStack(app)
buildUsageTokensStreamStack(app)
