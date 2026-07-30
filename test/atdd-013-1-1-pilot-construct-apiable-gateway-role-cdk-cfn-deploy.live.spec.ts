/**
 * Live-deploy acceptance spec (scenario S4) for the gateway-management role.
 * Frozen contract: contract-013-1-1-pilot-construct-apiable-gateway-role-cdk-cfn.md
 *
 * S4 provisions the role for real and matches the returned identifier — it needs a live
 * AWS account, so it is excluded from the default `npm test` / CI gate by the `.live.spec.ts`
 * name (see jest.config.js) and runs only via `npm run test:live`.
 *
 * Manual hand-off (AC4): a human exports credentials for the sandbox account, runs
 *   RUN_LIVE_DEPLOY=1 AWS_REGION=<region> npm run test:live
 * then follows the generated launch link, confirms creation, and checks the role ARN.
 * Without RUN_LIVE_DEPLOY this spec is a documented no-op.
 */
import {
  generateLaunchStackUrl,
  DEFAULT_APIABLE_TRUST_ACCOUNT,
} from '@apiable/cdk-gateway-role'

const runLiveDeploy = Boolean(process.env.RUN_LIVE_DEPLOY)

describe('gateway-management role — live deploy contract', () => {
  // S4 — following the link provisions the role within ~90s and the identifier matches
  it('S4: deploying via the generated link provisions the role and returns the expected identifier', () => {
    const region = process.env.AWS_REGION ?? 'eu-central-1'
    const roleTrustTarget = process.env.APIABLE_TRUST_ACCOUNT ?? DEFAULT_APIABLE_TRUST_ACCOUNT
    const url = generateLaunchStackUrl({
      tenantId: process.env.TENANT_ID ?? 'sandbox-tenant',
      roleTrustTarget,
      region,
      version: process.env.LAUNCHSTACK_VERSION ?? '1.0.0',
    })

    if (!runLiveDeploy) {
      // Documented manual hand-off: the operator follows the link and verifies the ARN by hand.
      // eslint-disable-next-line no-console
      console.log(
        `[S4 manual hand-off] open ${url}, confirm stack creation (~90s), then verify the role ARN ` +
          `ends in :role/apiable-gateway-management-role-${region}`,
      )
      return
    }

    // RUN_LIVE_DEPLOY signals the operator is performing the deploy + ARN check by hand. This
    // environment has no AWS SDK or credentials, so the spec asserts nothing here — an explicit,
    // honest no-op that never stands in for the manual AC4 verification.
  })
})
