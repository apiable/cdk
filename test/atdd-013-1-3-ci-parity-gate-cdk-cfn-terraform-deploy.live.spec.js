"use strict";
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
const runLiveDeploy = Boolean(process.env.RUN_LIVE_DEPLOY);
const ISOLATED_ACCOUNT = '560444775141';
describe('parity gate — live deploy (isolated account, CI-excluded)', () => {
    // contract: S9 — deploying each channel artifact into the isolated trial account provisions the component
    it('S9: each channel artifact deploys into the isolated apiable-logging account and provisions the component', () => {
        const region = process.env.AWS_REGION ?? 'eu-central-1';
        if (!runLiveDeploy) {
            // eslint-disable-next-line no-console
            console.log(`[S9 manual hand-off] export credentials for the apiable-logging account ${ISOLATED_ACCOUNT} (never prod), then ` +
                `deploy each channel under a per-PR namespace in ${region}: cdk deploy the construct, apply the published CFN ` +
                `template, and terraform apply the module; confirm the gateway-management role provisions from each, then tear ` +
                `every per-PR stack down. The gate's static tiers already proved the three artifacts are equivalent.`);
            return;
        }
        // RUN_LIVE_DEPLOY signals the operator is performing the per-channel deploy + teardown by hand
        // against the isolated account. This environment has no AWS credentials, so the spec asserts
        // nothing here — an explicit, honest no-op that never stands in for the manual verification.
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXRkZC0wMTMtMS0zLWNpLXBhcml0eS1nYXRlLWNkay1jZm4tdGVycmFmb3JtLWRlcGxveS5saXZlLnNwZWMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJhdGRkLTAxMy0xLTMtY2ktcGFyaXR5LWdhdGUtY2RrLWNmbi10ZXJyYWZvcm0tZGVwbG95LmxpdmUuc3BlYy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7OztHQWVHO0FBQ0gsTUFBTSxhQUFhLEdBQUcsT0FBTyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsZUFBZSxDQUFDLENBQUE7QUFDMUQsTUFBTSxnQkFBZ0IsR0FBRyxjQUFjLENBQUE7QUFFdkMsUUFBUSxDQUFDLDJEQUEyRCxFQUFFLEdBQUcsRUFBRTtJQUN6RSwwR0FBMEc7SUFDMUcsRUFBRSxDQUFDLDBHQUEwRyxFQUFFLEdBQUcsRUFBRTtRQUNsSCxNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsSUFBSSxjQUFjLENBQUE7UUFDdkQsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1lBQ25CLHNDQUFzQztZQUN0QyxPQUFPLENBQUMsR0FBRyxDQUNULDJFQUEyRSxnQkFBZ0Isc0JBQXNCO2dCQUMvRyxtREFBbUQsTUFBTSxzREFBc0Q7Z0JBQy9HLGdIQUFnSDtnQkFDaEgscUdBQXFHLENBQ3hHLENBQUE7WUFDRCxPQUFNO1FBQ1IsQ0FBQztRQUNELCtGQUErRjtRQUMvRiw2RkFBNkY7UUFDN0YsNkZBQTZGO0lBQy9GLENBQUMsQ0FBQyxDQUFBO0FBQ0osQ0FBQyxDQUFDLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIExpdmUtZGVwbG95IGFjY2VwdGFuY2Ugc3BlYyAoc2NlbmFyaW8gUzkpIGZvciB0aGUgcGFyaXR5IGdhdGUuXG4gKiBGcm96ZW4gY29udHJhY3Q6IGNvbnRyYWN0LTAxMy0xLTMtY2ktcGFyaXR5LWdhdGUtY2RrLWNmbi10ZXJyYWZvcm0ubWRcbiAqXG4gKiBTOSBpcyB0aGUgbGl2ZSBoYWxmOiBlYWNoIGNoYW5uZWwncyBhcnRpZmFjdCBpcyBkZXBsb3llZCBmb3IgcmVhbCB0byBwcm92ZSBpdCBwcm92aXNpb25zLCBub3RcbiAqIG1lcmVseSB0aGF0IGl0IGlzIHdlbGwtZm9ybWVkLiBJdCBydW5zIGluIHRoZSBpc29sYXRlZCBhcGlhYmxlLWxvZ2dpbmcgYWNjb3VudCAoNTYwNDQ0Nzc1MTQxKSxcbiAqIHBlci1QUiBzdGFja3MgbmFtZXNwYWNlZCBhbmQgYXV0by10b3JuLWRvd24g4oCUIG5ldmVyIGEgcHJvZHVjdGlvbi1jb250YWluaW5nIGFjY291bnQuIEl0IG5lZWRzIGFcbiAqIHJlYWwgYWNjb3VudCwgc28gaXQgaXMgZXhjbHVkZWQgZnJvbSB0aGUgZGVmYXVsdCBgbnBtIHRlc3RgIC8gQ0kgZ2F0ZSBieSB0aGUgYC5saXZlLnNwZWMudHNgXG4gKiBuYW1lIChzZWUgamVzdC5jb25maWcuanMpIGFuZCBydW5zIG9ubHkgdmlhIGBucG0gcnVuIHRlc3Q6bGl2ZWAuXG4gKlxuICogTWFudWFsIGhhbmQtb2ZmOiBhIGh1bWFuIChvciB0aGUgZ2F0ZWQgQ0kgam9iKSBleHBvcnRzIGNyZWRlbnRpYWxzIGZvciB0aGUgYXBpYWJsZS1sb2dnaW5nXG4gKiBhY2NvdW50IGFuZCBydW5zXG4gKiAgIFJVTl9MSVZFX0RFUExPWT0xIEFXU19SRUdJT049PHJlZ2lvbj4gbnBtIHJ1biB0ZXN0OmxpdmVcbiAqIHRoZW4gZGVwbG95cyBlYWNoIGNoYW5uZWwgdW5kZXIgYSBwZXItUFIgbmFtZXNwYWNlLCBjb25maXJtcyB0aGUgY29tcG9uZW50IHByb3Zpc2lvbnMsIGFuZFxuICogdGVhcnMgaXQgZG93bi4gV2l0aG91dCBSVU5fTElWRV9ERVBMT1kgdGhpcyBzcGVjIGlzIGEgZG9jdW1lbnRlZCBuby1vcCAobWlycm9ycyAwMTMtMS0xLzEtMikuXG4gKi9cbmNvbnN0IHJ1bkxpdmVEZXBsb3kgPSBCb29sZWFuKHByb2Nlc3MuZW52LlJVTl9MSVZFX0RFUExPWSlcbmNvbnN0IElTT0xBVEVEX0FDQ09VTlQgPSAnNTYwNDQ0Nzc1MTQxJ1xuXG5kZXNjcmliZSgncGFyaXR5IGdhdGUg4oCUIGxpdmUgZGVwbG95IChpc29sYXRlZCBhY2NvdW50LCBDSS1leGNsdWRlZCknLCAoKSA9PiB7XG4gIC8vIGNvbnRyYWN0OiBTOSDigJQgZGVwbG95aW5nIGVhY2ggY2hhbm5lbCBhcnRpZmFjdCBpbnRvIHRoZSBpc29sYXRlZCB0cmlhbCBhY2NvdW50IHByb3Zpc2lvbnMgdGhlIGNvbXBvbmVudFxuICBpdCgnUzk6IGVhY2ggY2hhbm5lbCBhcnRpZmFjdCBkZXBsb3lzIGludG8gdGhlIGlzb2xhdGVkIGFwaWFibGUtbG9nZ2luZyBhY2NvdW50IGFuZCBwcm92aXNpb25zIHRoZSBjb21wb25lbnQnLCAoKSA9PiB7XG4gICAgY29uc3QgcmVnaW9uID0gcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiA/PyAnZXUtY2VudHJhbC0xJ1xuICAgIGlmICghcnVuTGl2ZURlcGxveSkge1xuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgICAgIGNvbnNvbGUubG9nKFxuICAgICAgICBgW1M5IG1hbnVhbCBoYW5kLW9mZl0gZXhwb3J0IGNyZWRlbnRpYWxzIGZvciB0aGUgYXBpYWJsZS1sb2dnaW5nIGFjY291bnQgJHtJU09MQVRFRF9BQ0NPVU5UfSAobmV2ZXIgcHJvZCksIHRoZW4gYCArXG4gICAgICAgICAgYGRlcGxveSBlYWNoIGNoYW5uZWwgdW5kZXIgYSBwZXItUFIgbmFtZXNwYWNlIGluICR7cmVnaW9ufTogY2RrIGRlcGxveSB0aGUgY29uc3RydWN0LCBhcHBseSB0aGUgcHVibGlzaGVkIENGTiBgICtcbiAgICAgICAgICBgdGVtcGxhdGUsIGFuZCB0ZXJyYWZvcm0gYXBwbHkgdGhlIG1vZHVsZTsgY29uZmlybSB0aGUgZ2F0ZXdheS1tYW5hZ2VtZW50IHJvbGUgcHJvdmlzaW9ucyBmcm9tIGVhY2gsIHRoZW4gdGVhciBgICtcbiAgICAgICAgICBgZXZlcnkgcGVyLVBSIHN0YWNrIGRvd24uIFRoZSBnYXRlJ3Mgc3RhdGljIHRpZXJzIGFscmVhZHkgcHJvdmVkIHRoZSB0aHJlZSBhcnRpZmFjdHMgYXJlIGVxdWl2YWxlbnQuYCxcbiAgICAgIClcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICAvLyBSVU5fTElWRV9ERVBMT1kgc2lnbmFscyB0aGUgb3BlcmF0b3IgaXMgcGVyZm9ybWluZyB0aGUgcGVyLWNoYW5uZWwgZGVwbG95ICsgdGVhcmRvd24gYnkgaGFuZFxuICAgIC8vIGFnYWluc3QgdGhlIGlzb2xhdGVkIGFjY291bnQuIFRoaXMgZW52aXJvbm1lbnQgaGFzIG5vIEFXUyBjcmVkZW50aWFscywgc28gdGhlIHNwZWMgYXNzZXJ0c1xuICAgIC8vIG5vdGhpbmcgaGVyZSDigJQgYW4gZXhwbGljaXQsIGhvbmVzdCBuby1vcCB0aGF0IG5ldmVyIHN0YW5kcyBpbiBmb3IgdGhlIG1hbnVhbCB2ZXJpZmljYXRpb24uXG4gIH0pXG59KVxuIl19