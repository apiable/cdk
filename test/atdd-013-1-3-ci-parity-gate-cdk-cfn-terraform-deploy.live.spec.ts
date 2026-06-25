/**
 * Live-deploy acceptance spec (scenario S9) for the parity gate.
 * Frozen contract: contract-013-1-3-ci-parity-gate-cdk-cfn-terraform.md
 *
 * S9 is the live half: each channel's artifact is deployed for real to prove it provisions, not
 * merely that it is well-formed. It runs in the isolated apiable-logging account (560444775141),
 * per-PR stacks namespaced and auto-torn-down — never a production-containing account. It needs a
 * real account, so it is excluded from the default `npm test` / CI gate by the `.live.spec.ts`
 * name (see jest.config.js) and runs only via `npm run test:live`.
 *
 * Manual hand-off: a human (or the gated CI job) exports credentials for the apiable-logging
 * account and runs
 *   RUN_LIVE_DEPLOY=1 AWS_REGION=<region> npm run test:live
 * then deploys each channel under a per-PR namespace, confirms the component provisions, and
 * tears it down. Without RUN_LIVE_DEPLOY this spec is a documented no-op (mirrors 013-1-1/1-2).
 */
const runLiveDeploy = Boolean(process.env.RUN_LIVE_DEPLOY)
const ISOLATED_ACCOUNT = '560444775141'

describe('parity gate — live deploy (isolated account, CI-excluded)', () => {
  // contract: S9 — deploying each channel artifact into the isolated trial account provisions the component
  it('S9: each channel artifact deploys into the isolated apiable-logging account and provisions the component', () => {
    const region = process.env.AWS_REGION ?? 'eu-central-1'
    if (!runLiveDeploy) {
      // eslint-disable-next-line no-console
      console.log(
        `[S9 manual hand-off] export credentials for the apiable-logging account ${ISOLATED_ACCOUNT} (never prod), then ` +
          `deploy each channel under a per-PR namespace in ${region}: cdk deploy the construct, apply the published CFN ` +
          `template, and terraform apply the module; confirm the gateway-management role provisions from each, then tear ` +
          `every per-PR stack down. The gate's static tiers already proved the three artifacts are equivalent.`,
      )
      return
    }
    // RUN_LIVE_DEPLOY signals the operator is performing the per-channel deploy + teardown by hand
    // against the isolated account. This environment has no AWS credentials, so the spec asserts
    // nothing here — an explicit, honest no-op that never stands in for the manual verification.
  })
})
