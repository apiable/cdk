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
declare const runLiveDeploy: boolean;
declare const ISOLATED_ACCOUNT = "560444775141";
