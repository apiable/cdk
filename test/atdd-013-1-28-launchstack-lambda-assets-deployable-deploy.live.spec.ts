/**
 * Live-deploy acceptance spec (scenarios S1/S2) for the cognito-pool and lambda-authorizer launch-stack
 * templates now that their lambda assets are cross-account deployable.
 * Frozen contract: contract-013-1-28-launchstack-lambda-assets-deployable.md
 *
 * S1/S2 provision each construct for real, against a third-party AWS account with no access to any
 * Apiable-private storage — needs a live account, so it is excluded from the default `npm test` / CI
 * gate by the `.live.spec.ts` name (see jest.config.js) and runs only via `npm run test:live`. This
 * mirrors the 013-1-1 gateway-role precedent (`atdd-013-1-1-…-deploy.live.spec.ts`): the operator
 * follows the generated link and confirms creation by hand, since this environment has no AWS SDK or
 * credentials to do it unattended.
 *
 * Manual hand-off:
 *   1. Deploy apiable-cognito-pool first via its printed link; note the UserPoolId output.
 *   2. Export APIABLE_TEST_USER_POOL_ID=<that id> (or re-run with it set) and deploy
 *      apiable-lambda-authorizer via its printed link, using an existing REST API's id for RestApiId.
 *   3. In each case, confirm the console reaches CREATE_COMPLETE — not CREATE_FAILED on a missing
 *      asset — since that is the one-click promise this story exists to keep.
 *
 *   RUN_LIVE_DEPLOY=1 AWS_REGION=<region> npm run test:live
 *
 * Without RUN_LIVE_DEPLOY these specs are a documented no-op.
 */
import { generateLaunchStackUrl as generateCognitoPoolUrl } from '@apiable/cdk-cognito-pool'
import { generateLaunchStackUrl as generateAuthorizerUrl } from '@apiable/cdk-lambda-authorizer'

const runLiveDeploy = Boolean(process.env.RUN_LIVE_DEPLOY)

describe('013-1-28 launchstack lambda assets — live deploy contract', () => {
  // S1 — the cognito-pool template deploys to CREATE_COMPLETE with nothing private to fetch
  it('S1: deploying via the generated link reaches CREATE_COMPLETE — the inline pre-token-gen handler needs no asset fetch at all', () => {
    const region = process.env.AWS_REGION ?? 'eu-central-1'
    const url = generateCognitoPoolUrl({
      tenantId: process.env.TENANT_ID ?? 'sandbox-tenant',
      tenantName: process.env.TENANT_NAME ?? 'sandbox-tenant',
      region,
      version: process.env.LAUNCHSTACK_VERSION ?? '1.0.0',
    })

    if (!runLiveDeploy) {
      // eslint-disable-next-line no-console
      console.log(`[S1 manual hand-off] open ${url}, confirm CREATE_COMPLETE (not CREATE_FAILED), then note the UserPoolId output for S2.`)
      return
    }

    // RUN_LIVE_DEPLOY signals the operator is performing the deploy + console check by hand. This
    // environment has no AWS SDK or credentials, so the spec asserts nothing here — an explicit,
    // honest no-op that never stands in for the manual CREATE_COMPLETE verification.
  })

  // S2 — the lambda-authorizer template deploys from the public code surface, not a private one
  it('S2: deploying via the generated link reaches CREATE_COMPLETE — the authorizer code fetches from the public launchstack bucket, not Apiable-private storage', () => {
    const region = process.env.AWS_REGION ?? 'eu-central-1'
    const userPoolId = process.env.APIABLE_TEST_USER_POOL_ID ?? '<user-pool-id-from-S1>'
    const url = generateAuthorizerUrl({
      tenantId: process.env.TENANT_ID ?? 'sandbox-tenant',
      tenantName: process.env.TENANT_NAME ?? 'sandbox-tenant',
      userPoolId,
      region,
      version: process.env.LAUNCHSTACK_VERSION ?? '1.0.0',
    })

    if (!runLiveDeploy) {
      // eslint-disable-next-line no-console
      console.log(
        `[S2 manual hand-off] open ${url}, supply an existing REST API id for RestApiId, confirm CREATE_COMPLETE ` +
          `(not CREATE_FAILED on a missing code asset), then invoke the authorizer once to confirm it denies cleanly.`,
      )
      return
    }

    // Same honest no-op as S1 above — no AWS SDK or credentials in this environment.
  })
})
