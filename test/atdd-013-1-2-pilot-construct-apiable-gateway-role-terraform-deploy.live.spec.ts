/**
 * Live apply/drift acceptance specs (scenarios S3 + S4) for the Terraform channel.
 * Frozen contract: contract-013-1-2-pilot-construct-apiable-gateway-role-terraform.md
 *
 * S3 provisions the role for real and S4 re-applies to prove zero drift — both need a live
 * AWS account, so they are excluded from the default `npm test` / CI gate by the
 * `.live.spec.ts` name (see jest.config.js) and run only via `npm run test:live`.
 *
 * Manual hand-off (AC3): a human exports credentials for the sandbox account and runs
 *   RUN_LIVE_DEPLOY=1 AWS_REGION=<region> npm run test:live
 * then applies the module, confirms the role, and re-plans for zero drift. Without
 * RUN_LIVE_DEPLOY these specs are a documented no-op (mirrors 013-1-1's S4 hand-off).
 */
import * as path from 'path'

const runLiveDeploy = Boolean(process.env.RUN_LIVE_DEPLOY)
const MODULE_DIR = path.resolve(__dirname, '../terraform/apiable-gateway-role')

describe('013-1-2 terraform gateway-management role — live apply (manual, CI-excluded)', () => {
  // S3 — apply provisions the role identically to the one-click channel
  it('S3: terraform apply creates the role identical to the CFN path (identity, trust, permission)', () => {
    const region = process.env.AWS_REGION ?? 'eu-central-1'
    if (!runLiveDeploy) {
      // eslint-disable-next-line no-console
      console.log(
        `[S3 manual hand-off] from ${MODULE_DIR} run ` +
          `terraform init && terraform apply -var region=${region}, then verify the role ARN ` +
          `ends in :role/apiable-gateway-managment-role-${region} — identical to the one-click path.`,
      )
      return
    }
    // RUN_LIVE_DEPLOY signals the operator is performing the apply + ARN check by hand. This
    // environment has no terraform binary or AWS credentials, so the spec asserts nothing here —
    // an explicit, honest no-op that never stands in for the manual AC3 verification.
  })

  // S4 — re-applying the same version detects zero drift, no duplicate
  it('S4: a subsequent plan on the already-applied role reports no changes (zero drift)', () => {
    const region = process.env.AWS_REGION ?? 'eu-central-1'
    if (!runLiveDeploy) {
      // eslint-disable-next-line no-console
      console.log(
        `[S4 manual hand-off] after the S3 apply, from ${MODULE_DIR} run ` +
          `terraform plan -var region=${region} and confirm it reports "No changes" (zero drift).`,
      )
      return
    }
    // Honest no-op without a terraform binary + live state, as for S3.
  })
})
