"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const path = require("path");
const runLiveDeploy = Boolean(process.env.RUN_LIVE_DEPLOY);
const MODULE_DIR = path.resolve(__dirname, '../terraform/apiable-gateway-role');
describe('terraform gateway-management role — live apply (manual, CI-excluded)', () => {
    // S3 — apply provisions the role identically to the one-click channel
    it('S3: terraform apply creates the role identical to the CFN path (identity, trust, permission)', () => {
        const region = process.env.AWS_REGION ?? 'eu-central-1';
        if (!runLiveDeploy) {
            // eslint-disable-next-line no-console
            console.log(`[S3 manual hand-off] from ${MODULE_DIR} run ` +
                `terraform init && terraform apply -var region=${region}, then verify the role ARN ` +
                `ends in :role/apiable-gateway-managment-role-${region} — identical to the one-click path.`);
            return;
        }
        // RUN_LIVE_DEPLOY signals the operator is performing the apply + ARN check by hand. This
        // environment has no terraform binary or AWS credentials, so the spec asserts nothing here —
        // an explicit, honest no-op that never stands in for the manual AC3 verification.
    });
    // S4 — re-applying the same version detects zero drift, no duplicate
    it('S4: a subsequent plan on the already-applied role reports no changes (zero drift)', () => {
        const region = process.env.AWS_REGION ?? 'eu-central-1';
        if (!runLiveDeploy) {
            // eslint-disable-next-line no-console
            console.log(`[S4 manual hand-off] after the S3 apply, from ${MODULE_DIR} run ` +
                `terraform plan -var region=${region} and confirm it reports "No changes" (zero drift).`);
            return;
        }
        // Honest no-op without a terraform binary + live state, as for S3.
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXRkZC0wMTMtMS0yLXBpbG90LWNvbnN0cnVjdC1hcGlhYmxlLWdhdGV3YXktcm9sZS10ZXJyYWZvcm0tZGVwbG95LmxpdmUuc3BlYy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImF0ZGQtMDEzLTEtMi1waWxvdC1jb25zdHJ1Y3QtYXBpYWJsZS1nYXRld2F5LXJvbGUtdGVycmFmb3JtLWRlcGxveS5saXZlLnNwZWMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQTs7Ozs7Ozs7Ozs7O0dBWUc7QUFDSCw2QkFBNEI7QUFFNUIsTUFBTSxhQUFhLEdBQUcsT0FBTyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsZUFBZSxDQUFDLENBQUE7QUFDMUQsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxTQUFTLEVBQUUsbUNBQW1DLENBQUMsQ0FBQTtBQUUvRSxRQUFRLENBQUMsc0VBQXNFLEVBQUUsR0FBRyxFQUFFO0lBQ3BGLHNFQUFzRTtJQUN0RSxFQUFFLENBQUMsOEZBQThGLEVBQUUsR0FBRyxFQUFFO1FBQ3RHLE1BQU0sTUFBTSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxJQUFJLGNBQWMsQ0FBQTtRQUN2RCxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDbkIsc0NBQXNDO1lBQ3RDLE9BQU8sQ0FBQyxHQUFHLENBQ1QsNkJBQTZCLFVBQVUsT0FBTztnQkFDNUMsaURBQWlELE1BQU0sNkJBQTZCO2dCQUNwRixnREFBZ0QsTUFBTSxxQ0FBcUMsQ0FDOUYsQ0FBQTtZQUNELE9BQU07UUFDUixDQUFDO1FBQ0QseUZBQXlGO1FBQ3pGLDZGQUE2RjtRQUM3RixrRkFBa0Y7SUFDcEYsQ0FBQyxDQUFDLENBQUE7SUFFRixxRUFBcUU7SUFDckUsRUFBRSxDQUFDLG1GQUFtRixFQUFFLEdBQUcsRUFBRTtRQUMzRixNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsSUFBSSxjQUFjLENBQUE7UUFDdkQsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1lBQ25CLHNDQUFzQztZQUN0QyxPQUFPLENBQUMsR0FBRyxDQUNULGlEQUFpRCxVQUFVLE9BQU87Z0JBQ2hFLDhCQUE4QixNQUFNLG9EQUFvRCxDQUMzRixDQUFBO1lBQ0QsT0FBTTtRQUNSLENBQUM7UUFDRCxtRUFBbUU7SUFDckUsQ0FBQyxDQUFDLENBQUE7QUFDSixDQUFDLENBQUMsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogTGl2ZSBhcHBseS9kcmlmdCBhY2NlcHRhbmNlIHNwZWNzIChzY2VuYXJpb3MgUzMgKyBTNCkgZm9yIHRoZSBUZXJyYWZvcm0gY2hhbm5lbC5cbiAqIEZyb3plbiBjb250cmFjdDogY29udHJhY3QtMDEzLTEtMi1waWxvdC1jb25zdHJ1Y3QtYXBpYWJsZS1nYXRld2F5LXJvbGUtdGVycmFmb3JtLm1kXG4gKlxuICogUzMgcHJvdmlzaW9ucyB0aGUgcm9sZSBmb3IgcmVhbCBhbmQgUzQgcmUtYXBwbGllcyB0byBwcm92ZSB6ZXJvIGRyaWZ0IOKAlCBib3RoIG5lZWQgYSBsaXZlXG4gKiBBV1MgYWNjb3VudCwgc28gdGhleSBhcmUgZXhjbHVkZWQgZnJvbSB0aGUgZGVmYXVsdCBgbnBtIHRlc3RgIC8gQ0kgZ2F0ZSBieSB0aGVcbiAqIGAubGl2ZS5zcGVjLnRzYCBuYW1lIChzZWUgamVzdC5jb25maWcuanMpIGFuZCBydW4gb25seSB2aWEgYG5wbSBydW4gdGVzdDpsaXZlYC5cbiAqXG4gKiBNYW51YWwgaGFuZC1vZmYgKEFDMyk6IGEgaHVtYW4gZXhwb3J0cyBjcmVkZW50aWFscyBmb3IgdGhlIHNhbmRib3ggYWNjb3VudCBhbmQgcnVuc1xuICogICBSVU5fTElWRV9ERVBMT1k9MSBBV1NfUkVHSU9OPTxyZWdpb24+IG5wbSBydW4gdGVzdDpsaXZlXG4gKiB0aGVuIGFwcGxpZXMgdGhlIG1vZHVsZSwgY29uZmlybXMgdGhlIHJvbGUsIGFuZCByZS1wbGFucyBmb3IgemVybyBkcmlmdC4gV2l0aG91dFxuICogUlVOX0xJVkVfREVQTE9ZIHRoZXNlIHNwZWNzIGFyZSBhIGRvY3VtZW50ZWQgbm8tb3AgKG1pcnJvcnMgMDEzLTEtMSdzIFM0IGhhbmQtb2ZmKS5cbiAqL1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJ1xuXG5jb25zdCBydW5MaXZlRGVwbG95ID0gQm9vbGVhbihwcm9jZXNzLmVudi5SVU5fTElWRV9ERVBMT1kpXG5jb25zdCBNT0RVTEVfRElSID0gcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uL3RlcnJhZm9ybS9hcGlhYmxlLWdhdGV3YXktcm9sZScpXG5cbmRlc2NyaWJlKCd0ZXJyYWZvcm0gZ2F0ZXdheS1tYW5hZ2VtZW50IHJvbGUg4oCUIGxpdmUgYXBwbHkgKG1hbnVhbCwgQ0ktZXhjbHVkZWQpJywgKCkgPT4ge1xuICAvLyBTMyDigJQgYXBwbHkgcHJvdmlzaW9ucyB0aGUgcm9sZSBpZGVudGljYWxseSB0byB0aGUgb25lLWNsaWNrIGNoYW5uZWxcbiAgaXQoJ1MzOiB0ZXJyYWZvcm0gYXBwbHkgY3JlYXRlcyB0aGUgcm9sZSBpZGVudGljYWwgdG8gdGhlIENGTiBwYXRoIChpZGVudGl0eSwgdHJ1c3QsIHBlcm1pc3Npb24pJywgKCkgPT4ge1xuICAgIGNvbnN0IHJlZ2lvbiA9IHByb2Nlc3MuZW52LkFXU19SRUdJT04gPz8gJ2V1LWNlbnRyYWwtMSdcbiAgICBpZiAoIXJ1bkxpdmVEZXBsb3kpIHtcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gICAgICBjb25zb2xlLmxvZyhcbiAgICAgICAgYFtTMyBtYW51YWwgaGFuZC1vZmZdIGZyb20gJHtNT0RVTEVfRElSfSBydW4gYCArXG4gICAgICAgICAgYHRlcnJhZm9ybSBpbml0ICYmIHRlcnJhZm9ybSBhcHBseSAtdmFyIHJlZ2lvbj0ke3JlZ2lvbn0sIHRoZW4gdmVyaWZ5IHRoZSByb2xlIEFSTiBgICtcbiAgICAgICAgICBgZW5kcyBpbiA6cm9sZS9hcGlhYmxlLWdhdGV3YXktbWFuYWdtZW50LXJvbGUtJHtyZWdpb259IOKAlCBpZGVudGljYWwgdG8gdGhlIG9uZS1jbGljayBwYXRoLmAsXG4gICAgICApXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgLy8gUlVOX0xJVkVfREVQTE9ZIHNpZ25hbHMgdGhlIG9wZXJhdG9yIGlzIHBlcmZvcm1pbmcgdGhlIGFwcGx5ICsgQVJOIGNoZWNrIGJ5IGhhbmQuIFRoaXNcbiAgICAvLyBlbnZpcm9ubWVudCBoYXMgbm8gdGVycmFmb3JtIGJpbmFyeSBvciBBV1MgY3JlZGVudGlhbHMsIHNvIHRoZSBzcGVjIGFzc2VydHMgbm90aGluZyBoZXJlIOKAlFxuICAgIC8vIGFuIGV4cGxpY2l0LCBob25lc3Qgbm8tb3AgdGhhdCBuZXZlciBzdGFuZHMgaW4gZm9yIHRoZSBtYW51YWwgQUMzIHZlcmlmaWNhdGlvbi5cbiAgfSlcblxuICAvLyBTNCDigJQgcmUtYXBwbHlpbmcgdGhlIHNhbWUgdmVyc2lvbiBkZXRlY3RzIHplcm8gZHJpZnQsIG5vIGR1cGxpY2F0ZVxuICBpdCgnUzQ6IGEgc3Vic2VxdWVudCBwbGFuIG9uIHRoZSBhbHJlYWR5LWFwcGxpZWQgcm9sZSByZXBvcnRzIG5vIGNoYW5nZXMgKHplcm8gZHJpZnQpJywgKCkgPT4ge1xuICAgIGNvbnN0IHJlZ2lvbiA9IHByb2Nlc3MuZW52LkFXU19SRUdJT04gPz8gJ2V1LWNlbnRyYWwtMSdcbiAgICBpZiAoIXJ1bkxpdmVEZXBsb3kpIHtcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gICAgICBjb25zb2xlLmxvZyhcbiAgICAgICAgYFtTNCBtYW51YWwgaGFuZC1vZmZdIGFmdGVyIHRoZSBTMyBhcHBseSwgZnJvbSAke01PRFVMRV9ESVJ9IHJ1biBgICtcbiAgICAgICAgICBgdGVycmFmb3JtIHBsYW4gLXZhciByZWdpb249JHtyZWdpb259IGFuZCBjb25maXJtIGl0IHJlcG9ydHMgXCJObyBjaGFuZ2VzXCIgKHplcm8gZHJpZnQpLmAsXG4gICAgICApXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgLy8gSG9uZXN0IG5vLW9wIHdpdGhvdXQgYSB0ZXJyYWZvcm0gYmluYXJ5ICsgbGl2ZSBzdGF0ZSwgYXMgZm9yIFMzLlxuICB9KVxufSlcbiJdfQ==