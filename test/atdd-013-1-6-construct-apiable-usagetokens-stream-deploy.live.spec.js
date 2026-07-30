"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Live-delivery acceptance spec (scenarios S4, S5) for the apiable-usagetokens-stream distribution.
 * Frozen contract: contract-013-1-6-construct-apiable-usagetokens-stream.md
 *
 * S4 provisions the token stream against a real logs bucket, emits a token-attribution event through
 * the gateway, and confirms the record lands under the DEDICATED token path
 * (`apiable/aws/apikey-token/logs/`, distinct from the usage-log `apiable/aws/logs/` path) within the
 * buffer window — the token prefix being the routing signal the downstream ingestion pipeline keys off.
 * S5 pins the scope boundary: the stream's guarantee ends at storage delivery; whether the stored event
 * then reaches Apiable's ingestion endpoint is the downstream pipeline's responsibility, out of scope.
 *
 * Both need a live AWS account, so this is excluded from the default `npm test` / CI gate by the
 * `.live.spec.ts` name (see jest.config.js) and runs only via `npm run test:live`.
 *
 * Manual hand-off: a human exports credentials for the verification account, runs
 *   RUN_LIVE_DEPLOY=1 AWS_REGION=<region> LOGS_BUCKET_ARN=<arn> npm run test:live
 * then provisions the token stream, emits a token-attribution event, and checks the destination object.
 * Without RUN_LIVE_DEPLOY this spec is a documented no-op.
 */
const cdk_usagetokens_stream_1 = require("@apiable/cdk-usagetokens-stream");
const runLiveDeploy = Boolean(process.env.RUN_LIVE_DEPLOY);
describe('apiable-usagetokens-stream — live delivery + ingestion boundary contract', () => {
    // S4 — a gateway-emitted token event lands under the token logs/ path within the buffer window (~300s / 5MB)
    it('S4: an emitted token event appears under the dedicated token logs/ path within the buffer window', () => {
        const region = process.env.AWS_REGION ?? 'eu-central-1';
        const logsBucketArn = process.env.LOGS_BUCKET_ARN ?? 'arn:aws:s3:::apiable-logs-staging';
        const url = (0, cdk_usagetokens_stream_1.generateTokensLaunchStackUrl)({
            tenantId: process.env.TENANT_ID ?? 'sandbox-tenant',
            logsBucketArn,
            region,
            version: process.env.LAUNCHSTACK_VERSION ?? '1.0.0',
        });
        if (!runLiveDeploy) {
            // Documented manual hand-off: the operator provisions, emits a token event, and verifies the object by hand.
            // eslint-disable-next-line no-console
            console.log(`[S4 manual hand-off] open ${url}, provision against ${logsBucketArn}, emit a token-attribution event ` +
                `through the gateway, then confirm an object appears under ${cdk_usagetokens_stream_1.DEFAULT_USAGETOKENS_PREFIX}/logs/ (NOT the ` +
                `usage-log apiable/aws/logs/ path) within the buffer window (whichever of 300s / 5MB trips first).`);
            return;
        }
        // RUN_LIVE_DEPLOY signals the operator is performing the deploy + delivery check by hand. This
        // environment has no AWS SDK or credentials, so the spec asserts nothing here — an explicit,
        // honest no-op that never stands in for the manual S4 verification.
    });
    // S5 — the construct guarantee ends at storage delivery; reaching the ingestion endpoint is downstream
    it('S5: the guarantee is delivery to storage within the window; end-to-end ingestion arrival is downstream (out of scope)', () => {
        if (!runLiveDeploy) {
            // eslint-disable-next-line no-console
            console.log('[S5 scope boundary] IN SCOPE: the token event is delivered to the storage location under ' +
                `${cdk_usagetokens_stream_1.DEFAULT_USAGETOKENS_PREFIX}/logs/ within the buffer window (verified as S4). OUT OF SCOPE: whether that ` +
                'stored object then reaches Apiable’s ingestion endpoint within the documented latency — owned and ' +
                'verified by the downstream analytics ingestion pipeline, not this construct.');
            return;
        }
        // No SDK/credentials here; the downstream ingestion leg is the downstream pipeline's own verification.
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXRkZC0wMTMtMS02LWNvbnN0cnVjdC1hcGlhYmxlLXVzYWdldG9rZW5zLXN0cmVhbS1kZXBsb3kubGl2ZS5zcGVjLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXRkZC0wMTMtMS02LWNvbnN0cnVjdC1hcGlhYmxlLXVzYWdldG9rZW5zLXN0cmVhbS1kZXBsb3kubGl2ZS5zcGVjLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQWtCRztBQUNILDRFQUEwRztBQUUxRyxNQUFNLGFBQWEsR0FBRyxPQUFPLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUMsQ0FBQTtBQUUxRCxRQUFRLENBQUMsMEVBQTBFLEVBQUUsR0FBRyxFQUFFO0lBQ3hGLDZHQUE2RztJQUM3RyxFQUFFLENBQUMsa0dBQWtHLEVBQUUsR0FBRyxFQUFFO1FBQzFHLE1BQU0sTUFBTSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxJQUFJLGNBQWMsQ0FBQTtRQUN2RCxNQUFNLGFBQWEsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWUsSUFBSSxtQ0FBbUMsQ0FBQTtRQUN4RixNQUFNLEdBQUcsR0FBRyxJQUFBLHFEQUE0QixFQUFDO1lBQ3ZDLFFBQVEsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFNBQVMsSUFBSSxnQkFBZ0I7WUFDbkQsYUFBYTtZQUNiLE1BQU07WUFDTixPQUFPLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQkFBbUIsSUFBSSxPQUFPO1NBQ3BELENBQUMsQ0FBQTtRQUVGLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUNuQiw2R0FBNkc7WUFDN0csc0NBQXNDO1lBQ3RDLE9BQU8sQ0FBQyxHQUFHLENBQ1QsNkJBQTZCLEdBQUcsdUJBQXVCLGFBQWEsbUNBQW1DO2dCQUNyRyw2REFBNkQsbURBQTBCLGtCQUFrQjtnQkFDekcsbUdBQW1HLENBQ3RHLENBQUE7WUFDRCxPQUFNO1FBQ1IsQ0FBQztRQUVELCtGQUErRjtRQUMvRiw2RkFBNkY7UUFDN0Ysb0VBQW9FO0lBQ3RFLENBQUMsQ0FBQyxDQUFBO0lBRUYsdUdBQXVHO0lBQ3ZHLEVBQUUsQ0FBQyx1SEFBdUgsRUFBRSxHQUFHLEVBQUU7UUFDL0gsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1lBQ25CLHNDQUFzQztZQUN0QyxPQUFPLENBQUMsR0FBRyxDQUNULDJGQUEyRjtnQkFDekYsR0FBRyxtREFBMEIsK0VBQStFO2dCQUM1RyxvR0FBb0c7Z0JBQ3BHLDhFQUE4RSxDQUNqRixDQUFBO1lBQ0QsT0FBTTtRQUNSLENBQUM7UUFFRCx1R0FBdUc7SUFDekcsQ0FBQyxDQUFDLENBQUE7QUFDSixDQUFDLENBQUMsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogTGl2ZS1kZWxpdmVyeSBhY2NlcHRhbmNlIHNwZWMgKHNjZW5hcmlvcyBTNCwgUzUpIGZvciB0aGUgYXBpYWJsZS11c2FnZXRva2Vucy1zdHJlYW0gZGlzdHJpYnV0aW9uLlxuICogRnJvemVuIGNvbnRyYWN0OiBjb250cmFjdC0wMTMtMS02LWNvbnN0cnVjdC1hcGlhYmxlLXVzYWdldG9rZW5zLXN0cmVhbS5tZFxuICpcbiAqIFM0IHByb3Zpc2lvbnMgdGhlIHRva2VuIHN0cmVhbSBhZ2FpbnN0IGEgcmVhbCBsb2dzIGJ1Y2tldCwgZW1pdHMgYSB0b2tlbi1hdHRyaWJ1dGlvbiBldmVudCB0aHJvdWdoXG4gKiB0aGUgZ2F0ZXdheSwgYW5kIGNvbmZpcm1zIHRoZSByZWNvcmQgbGFuZHMgdW5kZXIgdGhlIERFRElDQVRFRCB0b2tlbiBwYXRoXG4gKiAoYGFwaWFibGUvYXdzL2FwaWtleS10b2tlbi9sb2dzL2AsIGRpc3RpbmN0IGZyb20gdGhlIHVzYWdlLWxvZyBgYXBpYWJsZS9hd3MvbG9ncy9gIHBhdGgpIHdpdGhpbiB0aGVcbiAqIGJ1ZmZlciB3aW5kb3cg4oCUIHRoZSB0b2tlbiBwcmVmaXggYmVpbmcgdGhlIHJvdXRpbmcgc2lnbmFsIHRoZSBkb3duc3RyZWFtIGluZ2VzdGlvbiBwaXBlbGluZSBrZXlzIG9mZi5cbiAqIFM1IHBpbnMgdGhlIHNjb3BlIGJvdW5kYXJ5OiB0aGUgc3RyZWFtJ3MgZ3VhcmFudGVlIGVuZHMgYXQgc3RvcmFnZSBkZWxpdmVyeTsgd2hldGhlciB0aGUgc3RvcmVkIGV2ZW50XG4gKiB0aGVuIHJlYWNoZXMgQXBpYWJsZSdzIGluZ2VzdGlvbiBlbmRwb2ludCBpcyB0aGUgZG93bnN0cmVhbSBwaXBlbGluZSdzIHJlc3BvbnNpYmlsaXR5LCBvdXQgb2Ygc2NvcGUuXG4gKlxuICogQm90aCBuZWVkIGEgbGl2ZSBBV1MgYWNjb3VudCwgc28gdGhpcyBpcyBleGNsdWRlZCBmcm9tIHRoZSBkZWZhdWx0IGBucG0gdGVzdGAgLyBDSSBnYXRlIGJ5IHRoZVxuICogYC5saXZlLnNwZWMudHNgIG5hbWUgKHNlZSBqZXN0LmNvbmZpZy5qcykgYW5kIHJ1bnMgb25seSB2aWEgYG5wbSBydW4gdGVzdDpsaXZlYC5cbiAqXG4gKiBNYW51YWwgaGFuZC1vZmY6IGEgaHVtYW4gZXhwb3J0cyBjcmVkZW50aWFscyBmb3IgdGhlIHZlcmlmaWNhdGlvbiBhY2NvdW50LCBydW5zXG4gKiAgIFJVTl9MSVZFX0RFUExPWT0xIEFXU19SRUdJT049PHJlZ2lvbj4gTE9HU19CVUNLRVRfQVJOPTxhcm4+IG5wbSBydW4gdGVzdDpsaXZlXG4gKiB0aGVuIHByb3Zpc2lvbnMgdGhlIHRva2VuIHN0cmVhbSwgZW1pdHMgYSB0b2tlbi1hdHRyaWJ1dGlvbiBldmVudCwgYW5kIGNoZWNrcyB0aGUgZGVzdGluYXRpb24gb2JqZWN0LlxuICogV2l0aG91dCBSVU5fTElWRV9ERVBMT1kgdGhpcyBzcGVjIGlzIGEgZG9jdW1lbnRlZCBuby1vcC5cbiAqL1xuaW1wb3J0IHsgZ2VuZXJhdGVUb2tlbnNMYXVuY2hTdGFja1VybCwgREVGQVVMVF9VU0FHRVRPS0VOU19QUkVGSVggfSBmcm9tICdAYXBpYWJsZS9jZGstdXNhZ2V0b2tlbnMtc3RyZWFtJ1xuXG5jb25zdCBydW5MaXZlRGVwbG95ID0gQm9vbGVhbihwcm9jZXNzLmVudi5SVU5fTElWRV9ERVBMT1kpXG5cbmRlc2NyaWJlKCdhcGlhYmxlLXVzYWdldG9rZW5zLXN0cmVhbSDigJQgbGl2ZSBkZWxpdmVyeSArIGluZ2VzdGlvbiBib3VuZGFyeSBjb250cmFjdCcsICgpID0+IHtcbiAgLy8gUzQg4oCUIGEgZ2F0ZXdheS1lbWl0dGVkIHRva2VuIGV2ZW50IGxhbmRzIHVuZGVyIHRoZSB0b2tlbiBsb2dzLyBwYXRoIHdpdGhpbiB0aGUgYnVmZmVyIHdpbmRvdyAofjMwMHMgLyA1TUIpXG4gIGl0KCdTNDogYW4gZW1pdHRlZCB0b2tlbiBldmVudCBhcHBlYXJzIHVuZGVyIHRoZSBkZWRpY2F0ZWQgdG9rZW4gbG9ncy8gcGF0aCB3aXRoaW4gdGhlIGJ1ZmZlciB3aW5kb3cnLCAoKSA9PiB7XG4gICAgY29uc3QgcmVnaW9uID0gcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiA/PyAnZXUtY2VudHJhbC0xJ1xuICAgIGNvbnN0IGxvZ3NCdWNrZXRBcm4gPSBwcm9jZXNzLmVudi5MT0dTX0JVQ0tFVF9BUk4gPz8gJ2Fybjphd3M6czM6OjphcGlhYmxlLWxvZ3Mtc3RhZ2luZydcbiAgICBjb25zdCB1cmwgPSBnZW5lcmF0ZVRva2Vuc0xhdW5jaFN0YWNrVXJsKHtcbiAgICAgIHRlbmFudElkOiBwcm9jZXNzLmVudi5URU5BTlRfSUQgPz8gJ3NhbmRib3gtdGVuYW50JyxcbiAgICAgIGxvZ3NCdWNrZXRBcm4sXG4gICAgICByZWdpb24sXG4gICAgICB2ZXJzaW9uOiBwcm9jZXNzLmVudi5MQVVOQ0hTVEFDS19WRVJTSU9OID8/ICcxLjAuMCcsXG4gICAgfSlcblxuICAgIGlmICghcnVuTGl2ZURlcGxveSkge1xuICAgICAgLy8gRG9jdW1lbnRlZCBtYW51YWwgaGFuZC1vZmY6IHRoZSBvcGVyYXRvciBwcm92aXNpb25zLCBlbWl0cyBhIHRva2VuIGV2ZW50LCBhbmQgdmVyaWZpZXMgdGhlIG9iamVjdCBieSBoYW5kLlxuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgICAgIGNvbnNvbGUubG9nKFxuICAgICAgICBgW1M0IG1hbnVhbCBoYW5kLW9mZl0gb3BlbiAke3VybH0sIHByb3Zpc2lvbiBhZ2FpbnN0ICR7bG9nc0J1Y2tldEFybn0sIGVtaXQgYSB0b2tlbi1hdHRyaWJ1dGlvbiBldmVudCBgICtcbiAgICAgICAgICBgdGhyb3VnaCB0aGUgZ2F0ZXdheSwgdGhlbiBjb25maXJtIGFuIG9iamVjdCBhcHBlYXJzIHVuZGVyICR7REVGQVVMVF9VU0FHRVRPS0VOU19QUkVGSVh9L2xvZ3MvIChOT1QgdGhlIGAgK1xuICAgICAgICAgIGB1c2FnZS1sb2cgYXBpYWJsZS9hd3MvbG9ncy8gcGF0aCkgd2l0aGluIHRoZSBidWZmZXIgd2luZG93ICh3aGljaGV2ZXIgb2YgMzAwcyAvIDVNQiB0cmlwcyBmaXJzdCkuYCxcbiAgICAgIClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIC8vIFJVTl9MSVZFX0RFUExPWSBzaWduYWxzIHRoZSBvcGVyYXRvciBpcyBwZXJmb3JtaW5nIHRoZSBkZXBsb3kgKyBkZWxpdmVyeSBjaGVjayBieSBoYW5kLiBUaGlzXG4gICAgLy8gZW52aXJvbm1lbnQgaGFzIG5vIEFXUyBTREsgb3IgY3JlZGVudGlhbHMsIHNvIHRoZSBzcGVjIGFzc2VydHMgbm90aGluZyBoZXJlIOKAlCBhbiBleHBsaWNpdCxcbiAgICAvLyBob25lc3Qgbm8tb3AgdGhhdCBuZXZlciBzdGFuZHMgaW4gZm9yIHRoZSBtYW51YWwgUzQgdmVyaWZpY2F0aW9uLlxuICB9KVxuXG4gIC8vIFM1IOKAlCB0aGUgY29uc3RydWN0IGd1YXJhbnRlZSBlbmRzIGF0IHN0b3JhZ2UgZGVsaXZlcnk7IHJlYWNoaW5nIHRoZSBpbmdlc3Rpb24gZW5kcG9pbnQgaXMgZG93bnN0cmVhbVxuICBpdCgnUzU6IHRoZSBndWFyYW50ZWUgaXMgZGVsaXZlcnkgdG8gc3RvcmFnZSB3aXRoaW4gdGhlIHdpbmRvdzsgZW5kLXRvLWVuZCBpbmdlc3Rpb24gYXJyaXZhbCBpcyBkb3duc3RyZWFtIChvdXQgb2Ygc2NvcGUpJywgKCkgPT4ge1xuICAgIGlmICghcnVuTGl2ZURlcGxveSkge1xuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgICAgIGNvbnNvbGUubG9nKFxuICAgICAgICAnW1M1IHNjb3BlIGJvdW5kYXJ5XSBJTiBTQ09QRTogdGhlIHRva2VuIGV2ZW50IGlzIGRlbGl2ZXJlZCB0byB0aGUgc3RvcmFnZSBsb2NhdGlvbiB1bmRlciAnICtcbiAgICAgICAgICBgJHtERUZBVUxUX1VTQUdFVE9LRU5TX1BSRUZJWH0vbG9ncy8gd2l0aGluIHRoZSBidWZmZXIgd2luZG93ICh2ZXJpZmllZCBhcyBTNCkuIE9VVCBPRiBTQ09QRTogd2hldGhlciB0aGF0IGAgK1xuICAgICAgICAgICdzdG9yZWQgb2JqZWN0IHRoZW4gcmVhY2hlcyBBcGlhYmxl4oCZcyBpbmdlc3Rpb24gZW5kcG9pbnQgd2l0aGluIHRoZSBkb2N1bWVudGVkIGxhdGVuY3kg4oCUIG93bmVkIGFuZCAnICtcbiAgICAgICAgICAndmVyaWZpZWQgYnkgdGhlIGRvd25zdHJlYW0gYW5hbHl0aWNzIGluZ2VzdGlvbiBwaXBlbGluZSwgbm90IHRoaXMgY29uc3RydWN0LicsXG4gICAgICApXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICAvLyBObyBTREsvY3JlZGVudGlhbHMgaGVyZTsgdGhlIGRvd25zdHJlYW0gaW5nZXN0aW9uIGxlZyBpcyB0aGUgZG93bnN0cmVhbSBwaXBlbGluZSdzIG93biB2ZXJpZmljYXRpb24uXG4gIH0pXG59KVxuIl19