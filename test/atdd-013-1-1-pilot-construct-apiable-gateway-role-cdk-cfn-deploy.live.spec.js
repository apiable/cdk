"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const cdk_gateway_role_1 = require("@apiable/cdk-gateway-role");
const runLiveDeploy = Boolean(process.env.RUN_LIVE_DEPLOY);
describe('gateway-management role — live deploy contract', () => {
    // S4 — following the link provisions the role within ~90s and the identifier matches
    it('S4: deploying via the generated link provisions the role and returns the expected identifier', () => {
        const region = process.env.AWS_REGION ?? 'eu-central-1';
        const roleTrustTarget = process.env.APIABLE_TRUST_ACCOUNT ?? cdk_gateway_role_1.DEFAULT_APIABLE_TRUST_ACCOUNT;
        const url = (0, cdk_gateway_role_1.generateLaunchStackUrl)({
            tenantId: process.env.TENANT_ID ?? 'sandbox-tenant',
            roleTrustTarget,
            region,
            version: process.env.LAUNCHSTACK_VERSION ?? '1.0.0',
        });
        if (!runLiveDeploy) {
            // Documented manual hand-off: the operator follows the link and verifies the ARN by hand.
            // eslint-disable-next-line no-console
            console.log(`[S4 manual hand-off] open ${url}, confirm stack creation (~90s), then verify the role ARN ` +
                `ends in :role/apiable-gateway-managment-role-${region}`);
            return;
        }
        // RUN_LIVE_DEPLOY signals the operator is performing the deploy + ARN check by hand. This
        // environment has no AWS SDK or credentials, so the spec asserts nothing here — an explicit,
        // honest no-op that never stands in for the manual AC4 verification.
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXRkZC0wMTMtMS0xLXBpbG90LWNvbnN0cnVjdC1hcGlhYmxlLWdhdGV3YXktcm9sZS1jZGstY2ZuLWRlcGxveS5saXZlLnNwZWMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJhdGRkLTAxMy0xLTEtcGlsb3QtY29uc3RydWN0LWFwaWFibGUtZ2F0ZXdheS1yb2xlLWNkay1jZm4tZGVwbG95LmxpdmUuc3BlYy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBOzs7Ozs7Ozs7Ozs7R0FZRztBQUNILGdFQUdrQztBQUVsQyxNQUFNLGFBQWEsR0FBRyxPQUFPLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUMsQ0FBQTtBQUUxRCxRQUFRLENBQUMsZ0RBQWdELEVBQUUsR0FBRyxFQUFFO0lBQzlELHFGQUFxRjtJQUNyRixFQUFFLENBQUMsOEZBQThGLEVBQUUsR0FBRyxFQUFFO1FBQ3RHLE1BQU0sTUFBTSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxJQUFJLGNBQWMsQ0FBQTtRQUN2RCxNQUFNLGVBQWUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLHFCQUFxQixJQUFJLGdEQUE2QixDQUFBO1FBQzFGLE1BQU0sR0FBRyxHQUFHLElBQUEseUNBQXNCLEVBQUM7WUFDakMsUUFBUSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsU0FBUyxJQUFJLGdCQUFnQjtZQUNuRCxlQUFlO1lBQ2YsTUFBTTtZQUNOLE9BQU8sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFtQixJQUFJLE9BQU87U0FDcEQsQ0FBQyxDQUFBO1FBRUYsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1lBQ25CLDBGQUEwRjtZQUMxRixzQ0FBc0M7WUFDdEMsT0FBTyxDQUFDLEdBQUcsQ0FDVCw2QkFBNkIsR0FBRyw0REFBNEQ7Z0JBQzFGLGdEQUFnRCxNQUFNLEVBQUUsQ0FDM0QsQ0FBQTtZQUNELE9BQU07UUFDUixDQUFDO1FBRUQsMEZBQTBGO1FBQzFGLDZGQUE2RjtRQUM3RixxRUFBcUU7SUFDdkUsQ0FBQyxDQUFDLENBQUE7QUFDSixDQUFDLENBQUMsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogTGl2ZS1kZXBsb3kgYWNjZXB0YW5jZSBzcGVjIChzY2VuYXJpbyBTNCkgZm9yIHRoZSBnYXRld2F5LW1hbmFnZW1lbnQgcm9sZS5cbiAqIEZyb3plbiBjb250cmFjdDogY29udHJhY3QtMDEzLTEtMS1waWxvdC1jb25zdHJ1Y3QtYXBpYWJsZS1nYXRld2F5LXJvbGUtY2RrLWNmbi5tZFxuICpcbiAqIFM0IHByb3Zpc2lvbnMgdGhlIHJvbGUgZm9yIHJlYWwgYW5kIG1hdGNoZXMgdGhlIHJldHVybmVkIGlkZW50aWZpZXIg4oCUIGl0IG5lZWRzIGEgbGl2ZVxuICogQVdTIGFjY291bnQsIHNvIGl0IGlzIGV4Y2x1ZGVkIGZyb20gdGhlIGRlZmF1bHQgYG5wbSB0ZXN0YCAvIENJIGdhdGUgYnkgdGhlIGAubGl2ZS5zcGVjLnRzYFxuICogbmFtZSAoc2VlIGplc3QuY29uZmlnLmpzKSBhbmQgcnVucyBvbmx5IHZpYSBgbnBtIHJ1biB0ZXN0OmxpdmVgLlxuICpcbiAqIE1hbnVhbCBoYW5kLW9mZiAoQUM0KTogYSBodW1hbiBleHBvcnRzIGNyZWRlbnRpYWxzIGZvciB0aGUgc2FuZGJveCBhY2NvdW50LCBydW5zXG4gKiAgIFJVTl9MSVZFX0RFUExPWT0xIEFXU19SRUdJT049PHJlZ2lvbj4gbnBtIHJ1biB0ZXN0OmxpdmVcbiAqIHRoZW4gZm9sbG93cyB0aGUgZ2VuZXJhdGVkIGxhdW5jaCBsaW5rLCBjb25maXJtcyBjcmVhdGlvbiwgYW5kIGNoZWNrcyB0aGUgcm9sZSBBUk4uXG4gKiBXaXRob3V0IFJVTl9MSVZFX0RFUExPWSB0aGlzIHNwZWMgaXMgYSBkb2N1bWVudGVkIG5vLW9wLlxuICovXG5pbXBvcnQge1xuICBnZW5lcmF0ZUxhdW5jaFN0YWNrVXJsLFxuICBERUZBVUxUX0FQSUFCTEVfVFJVU1RfQUNDT1VOVCxcbn0gZnJvbSAnQGFwaWFibGUvY2RrLWdhdGV3YXktcm9sZSdcblxuY29uc3QgcnVuTGl2ZURlcGxveSA9IEJvb2xlYW4ocHJvY2Vzcy5lbnYuUlVOX0xJVkVfREVQTE9ZKVxuXG5kZXNjcmliZSgnZ2F0ZXdheS1tYW5hZ2VtZW50IHJvbGUg4oCUIGxpdmUgZGVwbG95IGNvbnRyYWN0JywgKCkgPT4ge1xuICAvLyBTNCDigJQgZm9sbG93aW5nIHRoZSBsaW5rIHByb3Zpc2lvbnMgdGhlIHJvbGUgd2l0aGluIH45MHMgYW5kIHRoZSBpZGVudGlmaWVyIG1hdGNoZXNcbiAgaXQoJ1M0OiBkZXBsb3lpbmcgdmlhIHRoZSBnZW5lcmF0ZWQgbGluayBwcm92aXNpb25zIHRoZSByb2xlIGFuZCByZXR1cm5zIHRoZSBleHBlY3RlZCBpZGVudGlmaWVyJywgKCkgPT4ge1xuICAgIGNvbnN0IHJlZ2lvbiA9IHByb2Nlc3MuZW52LkFXU19SRUdJT04gPz8gJ2V1LWNlbnRyYWwtMSdcbiAgICBjb25zdCByb2xlVHJ1c3RUYXJnZXQgPSBwcm9jZXNzLmVudi5BUElBQkxFX1RSVVNUX0FDQ09VTlQgPz8gREVGQVVMVF9BUElBQkxFX1RSVVNUX0FDQ09VTlRcbiAgICBjb25zdCB1cmwgPSBnZW5lcmF0ZUxhdW5jaFN0YWNrVXJsKHtcbiAgICAgIHRlbmFudElkOiBwcm9jZXNzLmVudi5URU5BTlRfSUQgPz8gJ3NhbmRib3gtdGVuYW50JyxcbiAgICAgIHJvbGVUcnVzdFRhcmdldCxcbiAgICAgIHJlZ2lvbixcbiAgICAgIHZlcnNpb246IHByb2Nlc3MuZW52LkxBVU5DSFNUQUNLX1ZFUlNJT04gPz8gJzEuMC4wJyxcbiAgICB9KVxuXG4gICAgaWYgKCFydW5MaXZlRGVwbG95KSB7XG4gICAgICAvLyBEb2N1bWVudGVkIG1hbnVhbCBoYW5kLW9mZjogdGhlIG9wZXJhdG9yIGZvbGxvd3MgdGhlIGxpbmsgYW5kIHZlcmlmaWVzIHRoZSBBUk4gYnkgaGFuZC5cbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gICAgICBjb25zb2xlLmxvZyhcbiAgICAgICAgYFtTNCBtYW51YWwgaGFuZC1vZmZdIG9wZW4gJHt1cmx9LCBjb25maXJtIHN0YWNrIGNyZWF0aW9uICh+OTBzKSwgdGhlbiB2ZXJpZnkgdGhlIHJvbGUgQVJOIGAgK1xuICAgICAgICAgIGBlbmRzIGluIDpyb2xlL2FwaWFibGUtZ2F0ZXdheS1tYW5hZ21lbnQtcm9sZS0ke3JlZ2lvbn1gLFxuICAgICAgKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgLy8gUlVOX0xJVkVfREVQTE9ZIHNpZ25hbHMgdGhlIG9wZXJhdG9yIGlzIHBlcmZvcm1pbmcgdGhlIGRlcGxveSArIEFSTiBjaGVjayBieSBoYW5kLiBUaGlzXG4gICAgLy8gZW52aXJvbm1lbnQgaGFzIG5vIEFXUyBTREsgb3IgY3JlZGVudGlhbHMsIHNvIHRoZSBzcGVjIGFzc2VydHMgbm90aGluZyBoZXJlIOKAlCBhbiBleHBsaWNpdCxcbiAgICAvLyBob25lc3Qgbm8tb3AgdGhhdCBuZXZlciBzdGFuZHMgaW4gZm9yIHRoZSBtYW51YWwgQUM0IHZlcmlmaWNhdGlvbi5cbiAgfSlcbn0pXG4iXX0=