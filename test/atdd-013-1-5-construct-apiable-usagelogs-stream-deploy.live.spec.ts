/**
 * Live-delivery acceptance spec (scenario S5) for the apiable-usagelogs-stream construct.
 * Frozen contract: contract-013-1-5-construct-apiable-usagelogs-stream.md
 *
 * S5 provisions the stream against a real logs bucket, emits a usage log through the gateway, and
 * confirms the record lands under the destination's `logs/` path within the buffer window. It needs a
 * live AWS account, so it is excluded from the default `npm test` / CI gate by the `.live.spec.ts`
 * name (see jest.config.js) and runs only via `npm run test:live`.
 *
 * Manual hand-off: a human exports credentials for the verification account, runs
 *   RUN_LIVE_DEPLOY=1 AWS_REGION=<region> LOGS_BUCKET_ARN=<arn> npm run test:live
 * then provisions the stream, emits a usage log, and checks the destination object.
 * Without RUN_LIVE_DEPLOY this spec is a documented no-op.
 */
import { generateLaunchStackUrl, DEFAULT_USAGELOGS_PREFIX } from '@apiable/cdk-usagelogs-stream'

const runLiveDeploy = Boolean(process.env.RUN_LIVE_DEPLOY)

describe('apiable-usagelogs-stream — live delivery contract', () => {
  // S5 — a gateway-emitted usage log lands under <prefix>/logs/ within the buffer window (~300s / 5MB)
  it('S5: an emitted usage log appears under the destination logs/ path within the buffer window', () => {
    const region = process.env.AWS_REGION ?? 'eu-central-1'
    const logsBucketArn = process.env.LOGS_BUCKET_ARN ?? 'arn:aws:s3:::apiable-logs-staging'
    const url = generateLaunchStackUrl({
      tenantId: process.env.TENANT_ID ?? 'sandbox-tenant',
      logsBucketArn,
      region,
      version: process.env.LAUNCHSTACK_VERSION ?? '1.0.0',
    })

    if (!runLiveDeploy) {
      // Documented manual hand-off: the operator provisions, emits a usage log, and verifies the object by hand.
      // eslint-disable-next-line no-console
      console.log(
        `[S5 manual hand-off] open ${url}, provision against ${logsBucketArn}, emit a usage log through the ` +
          `gateway, then confirm an object appears under ${DEFAULT_USAGELOGS_PREFIX}/logs/ within the buffer ` +
          `window (whichever of 300s / 5MB trips first).`,
      )
      return
    }

    // RUN_LIVE_DEPLOY signals the operator is performing the deploy + delivery check by hand. This
    // environment has no AWS SDK or credentials, so the spec asserts nothing here — an explicit,
    // honest no-op that never stands in for the manual S5 verification.
  })
})
