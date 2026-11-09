import * as cdk from 'aws-cdk-lib'
import { buildPublishedStack as buildGatewayRoleStack } from '../lib/gateway-role'
import { buildPublishedStack as buildLogsBucketStack } from '../lib/logs-bucket'
import { buildPublishedStack as buildCognitoPoolStack } from '../lib/cognito-pool'
import { buildPublishedStack as buildLambdaAuthorizerStack } from '../lib/lambda-authorizer'
import {
  buildPublishedStack as buildUsageLogsStreamStack,
  buildPublishedTokensStack as buildUsageTokensStreamStack,
} from '../lib/logs-stream'

/**
 * Registers every published launch-stack stack on `app`, each under its construct name, so
 * `cdk synth <construct-name>` selects the one to emit. The shared usage stream registers under both
 * distribution identities (usage-log and api-key-token). The build list in synth-all-launchstack.sh
 * is held to exactly these names by test/launchstack-build-list.ta.spec.ts.
 */
export const registerPublishedStacks = (app: cdk.App): void => {
  buildGatewayRoleStack(app)
  buildLogsBucketStack(app)
  buildCognitoPoolStack(app)
  buildLambdaAuthorizerStack(app)
  buildUsageLogsStreamStack(app)
  buildUsageTokensStreamStack(app)
}

if (require.main === module) {
  registerPublishedStacks(new cdk.App())
}
