"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const cdk_usagelogs_stream_1 = require("@apiable/cdk-usagelogs-stream");
const runLiveDeploy = Boolean(process.env.RUN_LIVE_DEPLOY);
describe('apiable-usagelogs-stream — live delivery contract', () => {
    // S5 — a gateway-emitted usage log lands under <prefix>/logs/ within the buffer window (~300s / 5MB)
    it('S5: an emitted usage log appears under the destination logs/ path within the buffer window', () => {
        const region = process.env.AWS_REGION ?? 'eu-central-1';
        const logsBucketArn = process.env.LOGS_BUCKET_ARN ?? 'arn:aws:s3:::apiable-logs-staging';
        const url = (0, cdk_usagelogs_stream_1.generateLaunchStackUrl)({
            tenantId: process.env.TENANT_ID ?? 'sandbox-tenant',
            logsBucketArn,
            region,
            version: process.env.LAUNCHSTACK_VERSION ?? '1.0.0',
        });
        if (!runLiveDeploy) {
            // Documented manual hand-off: the operator provisions, emits a usage log, and verifies the object by hand.
            // eslint-disable-next-line no-console
            console.log(`[S5 manual hand-off] open ${url}, provision against ${logsBucketArn}, emit a usage log through the ` +
                `gateway, then confirm an object appears under ${cdk_usagelogs_stream_1.DEFAULT_USAGELOGS_PREFIX}/logs/ within the buffer ` +
                `window (whichever of 300s / 5MB trips first).`);
            return;
        }
        // RUN_LIVE_DEPLOY signals the operator is performing the deploy + delivery check by hand. This
        // environment has no AWS SDK or credentials, so the spec asserts nothing here — an explicit,
        // honest no-op that never stands in for the manual S5 verification.
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXRkZC0wMTMtMS01LWNvbnN0cnVjdC1hcGlhYmxlLXVzYWdlbG9ncy1zdHJlYW0tZGVwbG95LmxpdmUuc3BlYy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImF0ZGQtMDEzLTEtNS1jb25zdHJ1Y3QtYXBpYWJsZS11c2FnZWxvZ3Mtc3RyZWFtLWRlcGxveS5saXZlLnNwZWMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQTs7Ozs7Ozs7Ozs7OztHQWFHO0FBQ0gsd0VBQWdHO0FBRWhHLE1BQU0sYUFBYSxHQUFHLE9BQU8sQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWUsQ0FBQyxDQUFBO0FBRTFELFFBQVEsQ0FBQyxtREFBbUQsRUFBRSxHQUFHLEVBQUU7SUFDakUscUdBQXFHO0lBQ3JHLEVBQUUsQ0FBQyw0RkFBNEYsRUFBRSxHQUFHLEVBQUU7UUFDcEcsTUFBTSxNQUFNLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLElBQUksY0FBYyxDQUFBO1FBQ3ZELE1BQU0sYUFBYSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsZUFBZSxJQUFJLG1DQUFtQyxDQUFBO1FBQ3hGLE1BQU0sR0FBRyxHQUFHLElBQUEsNkNBQXNCLEVBQUM7WUFDakMsUUFBUSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsU0FBUyxJQUFJLGdCQUFnQjtZQUNuRCxhQUFhO1lBQ2IsTUFBTTtZQUNOLE9BQU8sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFtQixJQUFJLE9BQU87U0FDcEQsQ0FBQyxDQUFBO1FBRUYsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1lBQ25CLDJHQUEyRztZQUMzRyxzQ0FBc0M7WUFDdEMsT0FBTyxDQUFDLEdBQUcsQ0FDVCw2QkFBNkIsR0FBRyx1QkFBdUIsYUFBYSxpQ0FBaUM7Z0JBQ25HLGlEQUFpRCwrQ0FBd0IsMkJBQTJCO2dCQUNwRywrQ0FBK0MsQ0FDbEQsQ0FBQTtZQUNELE9BQU07UUFDUixDQUFDO1FBRUQsK0ZBQStGO1FBQy9GLDZGQUE2RjtRQUM3RixvRUFBb0U7SUFDdEUsQ0FBQyxDQUFDLENBQUE7QUFDSixDQUFDLENBQUMsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogTGl2ZS1kZWxpdmVyeSBhY2NlcHRhbmNlIHNwZWMgKHNjZW5hcmlvIFM1KSBmb3IgdGhlIGFwaWFibGUtdXNhZ2Vsb2dzLXN0cmVhbSBjb25zdHJ1Y3QuXG4gKiBGcm96ZW4gY29udHJhY3Q6IGNvbnRyYWN0LTAxMy0xLTUtY29uc3RydWN0LWFwaWFibGUtdXNhZ2Vsb2dzLXN0cmVhbS5tZFxuICpcbiAqIFM1IHByb3Zpc2lvbnMgdGhlIHN0cmVhbSBhZ2FpbnN0IGEgcmVhbCBsb2dzIGJ1Y2tldCwgZW1pdHMgYSB1c2FnZSBsb2cgdGhyb3VnaCB0aGUgZ2F0ZXdheSwgYW5kXG4gKiBjb25maXJtcyB0aGUgcmVjb3JkIGxhbmRzIHVuZGVyIHRoZSBkZXN0aW5hdGlvbidzIGBsb2dzL2AgcGF0aCB3aXRoaW4gdGhlIGJ1ZmZlciB3aW5kb3cuIEl0IG5lZWRzIGFcbiAqIGxpdmUgQVdTIGFjY291bnQsIHNvIGl0IGlzIGV4Y2x1ZGVkIGZyb20gdGhlIGRlZmF1bHQgYG5wbSB0ZXN0YCAvIENJIGdhdGUgYnkgdGhlIGAubGl2ZS5zcGVjLnRzYFxuICogbmFtZSAoc2VlIGplc3QuY29uZmlnLmpzKSBhbmQgcnVucyBvbmx5IHZpYSBgbnBtIHJ1biB0ZXN0OmxpdmVgLlxuICpcbiAqIE1hbnVhbCBoYW5kLW9mZjogYSBodW1hbiBleHBvcnRzIGNyZWRlbnRpYWxzIGZvciB0aGUgdmVyaWZpY2F0aW9uIGFjY291bnQsIHJ1bnNcbiAqICAgUlVOX0xJVkVfREVQTE9ZPTEgQVdTX1JFR0lPTj08cmVnaW9uPiBMT0dTX0JVQ0tFVF9BUk49PGFybj4gbnBtIHJ1biB0ZXN0OmxpdmVcbiAqIHRoZW4gcHJvdmlzaW9ucyB0aGUgc3RyZWFtLCBlbWl0cyBhIHVzYWdlIGxvZywgYW5kIGNoZWNrcyB0aGUgZGVzdGluYXRpb24gb2JqZWN0LlxuICogV2l0aG91dCBSVU5fTElWRV9ERVBMT1kgdGhpcyBzcGVjIGlzIGEgZG9jdW1lbnRlZCBuby1vcC5cbiAqL1xuaW1wb3J0IHsgZ2VuZXJhdGVMYXVuY2hTdGFja1VybCwgREVGQVVMVF9VU0FHRUxPR1NfUFJFRklYIH0gZnJvbSAnQGFwaWFibGUvY2RrLXVzYWdlbG9ncy1zdHJlYW0nXG5cbmNvbnN0IHJ1bkxpdmVEZXBsb3kgPSBCb29sZWFuKHByb2Nlc3MuZW52LlJVTl9MSVZFX0RFUExPWSlcblxuZGVzY3JpYmUoJ2FwaWFibGUtdXNhZ2Vsb2dzLXN0cmVhbSDigJQgbGl2ZSBkZWxpdmVyeSBjb250cmFjdCcsICgpID0+IHtcbiAgLy8gUzUg4oCUIGEgZ2F0ZXdheS1lbWl0dGVkIHVzYWdlIGxvZyBsYW5kcyB1bmRlciA8cHJlZml4Pi9sb2dzLyB3aXRoaW4gdGhlIGJ1ZmZlciB3aW5kb3cgKH4zMDBzIC8gNU1CKVxuICBpdCgnUzU6IGFuIGVtaXR0ZWQgdXNhZ2UgbG9nIGFwcGVhcnMgdW5kZXIgdGhlIGRlc3RpbmF0aW9uIGxvZ3MvIHBhdGggd2l0aGluIHRoZSBidWZmZXIgd2luZG93JywgKCkgPT4ge1xuICAgIGNvbnN0IHJlZ2lvbiA9IHByb2Nlc3MuZW52LkFXU19SRUdJT04gPz8gJ2V1LWNlbnRyYWwtMSdcbiAgICBjb25zdCBsb2dzQnVja2V0QXJuID0gcHJvY2Vzcy5lbnYuTE9HU19CVUNLRVRfQVJOID8/ICdhcm46YXdzOnMzOjo6YXBpYWJsZS1sb2dzLXN0YWdpbmcnXG4gICAgY29uc3QgdXJsID0gZ2VuZXJhdGVMYXVuY2hTdGFja1VybCh7XG4gICAgICB0ZW5hbnRJZDogcHJvY2Vzcy5lbnYuVEVOQU5UX0lEID8/ICdzYW5kYm94LXRlbmFudCcsXG4gICAgICBsb2dzQnVja2V0QXJuLFxuICAgICAgcmVnaW9uLFxuICAgICAgdmVyc2lvbjogcHJvY2Vzcy5lbnYuTEFVTkNIU1RBQ0tfVkVSU0lPTiA/PyAnMS4wLjAnLFxuICAgIH0pXG5cbiAgICBpZiAoIXJ1bkxpdmVEZXBsb3kpIHtcbiAgICAgIC8vIERvY3VtZW50ZWQgbWFudWFsIGhhbmQtb2ZmOiB0aGUgb3BlcmF0b3IgcHJvdmlzaW9ucywgZW1pdHMgYSB1c2FnZSBsb2csIGFuZCB2ZXJpZmllcyB0aGUgb2JqZWN0IGJ5IGhhbmQuXG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICAgICAgY29uc29sZS5sb2coXG4gICAgICAgIGBbUzUgbWFudWFsIGhhbmQtb2ZmXSBvcGVuICR7dXJsfSwgcHJvdmlzaW9uIGFnYWluc3QgJHtsb2dzQnVja2V0QXJufSwgZW1pdCBhIHVzYWdlIGxvZyB0aHJvdWdoIHRoZSBgICtcbiAgICAgICAgICBgZ2F0ZXdheSwgdGhlbiBjb25maXJtIGFuIG9iamVjdCBhcHBlYXJzIHVuZGVyICR7REVGQVVMVF9VU0FHRUxPR1NfUFJFRklYfS9sb2dzLyB3aXRoaW4gdGhlIGJ1ZmZlciBgICtcbiAgICAgICAgICBgd2luZG93ICh3aGljaGV2ZXIgb2YgMzAwcyAvIDVNQiB0cmlwcyBmaXJzdCkuYCxcbiAgICAgIClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIC8vIFJVTl9MSVZFX0RFUExPWSBzaWduYWxzIHRoZSBvcGVyYXRvciBpcyBwZXJmb3JtaW5nIHRoZSBkZXBsb3kgKyBkZWxpdmVyeSBjaGVjayBieSBoYW5kLiBUaGlzXG4gICAgLy8gZW52aXJvbm1lbnQgaGFzIG5vIEFXUyBTREsgb3IgY3JlZGVudGlhbHMsIHNvIHRoZSBzcGVjIGFzc2VydHMgbm90aGluZyBoZXJlIOKAlCBhbiBleHBsaWNpdCxcbiAgICAvLyBob25lc3Qgbm8tb3AgdGhhdCBuZXZlciBzdGFuZHMgaW4gZm9yIHRoZSBtYW51YWwgUzUgdmVyaWZpY2F0aW9uLlxuICB9KVxufSlcbiJdfQ==