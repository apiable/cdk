"use strict";
/**
 * Test stub for `aws-jwt-verify` (the Cognito JWT verifier the authorizer uses). The verifier is the
 * single external/network boundary of the handler; stubbing it lets the deny/allow + token-trust paths
 * run against the REAL authorizer handler without a live Cognito pool. Tests set the next verify result
 * (a decoded claims payload) or make it reject (the invalid-signature / wrong-issuer / expired /
 * wrong-token-type path) via the controls below.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CognitoJwtVerifier = exports.__lastCreateConfig = exports.__reset = exports.__setVerifyError = exports.__setVerifyResult = void 0;
let nextResult = {};
let nextError = null;
let lastCreateConfig = null;
/** Make the next `verify()` resolve with these claims (the valid-token path). */
const __setVerifyResult = (claims) => {
    nextResult = claims;
    nextError = null;
};
exports.__setVerifyResult = __setVerifyResult;
/** Make the next `verify()` reject (bad signature / wrong issuer / expired / wrong token type). */
const __setVerifyError = (message) => {
    nextError = new Error(message);
};
exports.__setVerifyError = __setVerifyError;
/**
 * Reset the per-call verify outcome to the default (resolves with empty claims). The captured create
 * config is intentionally NOT cleared: the handler creates the verifier lazily and caches it for the
 * module's lifetime, so the config is a once-captured fact about how the handler configures the
 * verifier (tokenUse=access) — it stays asserted across tests sharing the cached verifier.
 */
const __reset = () => {
    nextResult = {};
    nextError = null;
};
exports.__reset = __reset;
/** The config the handler passed to `CognitoJwtVerifier.create` (so a test can assert tokenUse=access). */
const __lastCreateConfig = () => lastCreateConfig;
exports.__lastCreateConfig = __lastCreateConfig;
exports.CognitoJwtVerifier = {
    create(config) {
        lastCreateConfig = config;
        return {
            verify: async (_token) => {
                if (nextError) {
                    throw nextError;
                }
                return nextResult;
            },
        };
    },
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXdzLWp3dC12ZXJpZnktbW9jay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImF3cy1qd3QtdmVyaWZ5LW1vY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7R0FNRzs7O0FBSUgsSUFBSSxVQUFVLEdBQVcsRUFBRSxDQUFBO0FBQzNCLElBQUksU0FBUyxHQUFpQixJQUFJLENBQUE7QUFDbEMsSUFBSSxnQkFBZ0IsR0FBbUMsSUFBSSxDQUFBO0FBRTNELGlGQUFpRjtBQUMxRSxNQUFNLGlCQUFpQixHQUFHLENBQUMsTUFBYyxFQUFRLEVBQUU7SUFDeEQsVUFBVSxHQUFHLE1BQU0sQ0FBQTtJQUNuQixTQUFTLEdBQUcsSUFBSSxDQUFBO0FBQ2xCLENBQUMsQ0FBQTtBQUhZLFFBQUEsaUJBQWlCLHFCQUc3QjtBQUVELG1HQUFtRztBQUM1RixNQUFNLGdCQUFnQixHQUFHLENBQUMsT0FBZSxFQUFRLEVBQUU7SUFDeEQsU0FBUyxHQUFHLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFBO0FBQ2hDLENBQUMsQ0FBQTtBQUZZLFFBQUEsZ0JBQWdCLG9CQUU1QjtBQUVEOzs7OztHQUtHO0FBQ0ksTUFBTSxPQUFPLEdBQUcsR0FBUyxFQUFFO0lBQ2hDLFVBQVUsR0FBRyxFQUFFLENBQUE7SUFDZixTQUFTLEdBQUcsSUFBSSxDQUFBO0FBQ2xCLENBQUMsQ0FBQTtBQUhZLFFBQUEsT0FBTyxXQUduQjtBQUVELDJHQUEyRztBQUNwRyxNQUFNLGtCQUFrQixHQUFHLEdBQW1DLEVBQUUsQ0FBQyxnQkFBZ0IsQ0FBQTtBQUEzRSxRQUFBLGtCQUFrQixzQkFBeUQ7QUFFM0UsUUFBQSxrQkFBa0IsR0FBRztJQUNoQyxNQUFNLENBQUMsTUFBK0I7UUFDcEMsZ0JBQWdCLEdBQUcsTUFBTSxDQUFBO1FBQ3pCLE9BQU87WUFDTCxNQUFNLEVBQUUsS0FBSyxFQUFFLE1BQWMsRUFBbUIsRUFBRTtnQkFDaEQsSUFBSSxTQUFTLEVBQUUsQ0FBQztvQkFDZCxNQUFNLFNBQVMsQ0FBQTtnQkFDakIsQ0FBQztnQkFDRCxPQUFPLFVBQVUsQ0FBQTtZQUNuQixDQUFDO1NBQ0YsQ0FBQTtJQUNILENBQUM7Q0FDRixDQUFBIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBUZXN0IHN0dWIgZm9yIGBhd3Mtand0LXZlcmlmeWAgKHRoZSBDb2duaXRvIEpXVCB2ZXJpZmllciB0aGUgYXV0aG9yaXplciB1c2VzKS4gVGhlIHZlcmlmaWVyIGlzIHRoZVxuICogc2luZ2xlIGV4dGVybmFsL25ldHdvcmsgYm91bmRhcnkgb2YgdGhlIGhhbmRsZXI7IHN0dWJiaW5nIGl0IGxldHMgdGhlIGRlbnkvYWxsb3cgKyB0b2tlbi10cnVzdCBwYXRoc1xuICogcnVuIGFnYWluc3QgdGhlIFJFQUwgYXV0aG9yaXplciBoYW5kbGVyIHdpdGhvdXQgYSBsaXZlIENvZ25pdG8gcG9vbC4gVGVzdHMgc2V0IHRoZSBuZXh0IHZlcmlmeSByZXN1bHRcbiAqIChhIGRlY29kZWQgY2xhaW1zIHBheWxvYWQpIG9yIG1ha2UgaXQgcmVqZWN0ICh0aGUgaW52YWxpZC1zaWduYXR1cmUgLyB3cm9uZy1pc3N1ZXIgLyBleHBpcmVkIC9cbiAqIHdyb25nLXRva2VuLXR5cGUgcGF0aCkgdmlhIHRoZSBjb250cm9scyBiZWxvdy5cbiAqL1xuXG50eXBlIENsYWltcyA9IFJlY29yZDxzdHJpbmcsIHVua25vd24+XG5cbmxldCBuZXh0UmVzdWx0OiBDbGFpbXMgPSB7fVxubGV0IG5leHRFcnJvcjogRXJyb3IgfCBudWxsID0gbnVsbFxubGV0IGxhc3RDcmVhdGVDb25maWc6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbCA9IG51bGxcblxuLyoqIE1ha2UgdGhlIG5leHQgYHZlcmlmeSgpYCByZXNvbHZlIHdpdGggdGhlc2UgY2xhaW1zICh0aGUgdmFsaWQtdG9rZW4gcGF0aCkuICovXG5leHBvcnQgY29uc3QgX19zZXRWZXJpZnlSZXN1bHQgPSAoY2xhaW1zOiBDbGFpbXMpOiB2b2lkID0+IHtcbiAgbmV4dFJlc3VsdCA9IGNsYWltc1xuICBuZXh0RXJyb3IgPSBudWxsXG59XG5cbi8qKiBNYWtlIHRoZSBuZXh0IGB2ZXJpZnkoKWAgcmVqZWN0IChiYWQgc2lnbmF0dXJlIC8gd3JvbmcgaXNzdWVyIC8gZXhwaXJlZCAvIHdyb25nIHRva2VuIHR5cGUpLiAqL1xuZXhwb3J0IGNvbnN0IF9fc2V0VmVyaWZ5RXJyb3IgPSAobWVzc2FnZTogc3RyaW5nKTogdm9pZCA9PiB7XG4gIG5leHRFcnJvciA9IG5ldyBFcnJvcihtZXNzYWdlKVxufVxuXG4vKipcbiAqIFJlc2V0IHRoZSBwZXItY2FsbCB2ZXJpZnkgb3V0Y29tZSB0byB0aGUgZGVmYXVsdCAocmVzb2x2ZXMgd2l0aCBlbXB0eSBjbGFpbXMpLiBUaGUgY2FwdHVyZWQgY3JlYXRlXG4gKiBjb25maWcgaXMgaW50ZW50aW9uYWxseSBOT1QgY2xlYXJlZDogdGhlIGhhbmRsZXIgY3JlYXRlcyB0aGUgdmVyaWZpZXIgbGF6aWx5IGFuZCBjYWNoZXMgaXQgZm9yIHRoZVxuICogbW9kdWxlJ3MgbGlmZXRpbWUsIHNvIHRoZSBjb25maWcgaXMgYSBvbmNlLWNhcHR1cmVkIGZhY3QgYWJvdXQgaG93IHRoZSBoYW5kbGVyIGNvbmZpZ3VyZXMgdGhlXG4gKiB2ZXJpZmllciAodG9rZW5Vc2U9YWNjZXNzKSDigJQgaXQgc3RheXMgYXNzZXJ0ZWQgYWNyb3NzIHRlc3RzIHNoYXJpbmcgdGhlIGNhY2hlZCB2ZXJpZmllci5cbiAqL1xuZXhwb3J0IGNvbnN0IF9fcmVzZXQgPSAoKTogdm9pZCA9PiB7XG4gIG5leHRSZXN1bHQgPSB7fVxuICBuZXh0RXJyb3IgPSBudWxsXG59XG5cbi8qKiBUaGUgY29uZmlnIHRoZSBoYW5kbGVyIHBhc3NlZCB0byBgQ29nbml0b0p3dFZlcmlmaWVyLmNyZWF0ZWAgKHNvIGEgdGVzdCBjYW4gYXNzZXJ0IHRva2VuVXNlPWFjY2VzcykuICovXG5leHBvcnQgY29uc3QgX19sYXN0Q3JlYXRlQ29uZmlnID0gKCk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbCA9PiBsYXN0Q3JlYXRlQ29uZmlnXG5cbmV4cG9ydCBjb25zdCBDb2duaXRvSnd0VmVyaWZpZXIgPSB7XG4gIGNyZWF0ZShjb25maWc6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSB7XG4gICAgbGFzdENyZWF0ZUNvbmZpZyA9IGNvbmZpZ1xuICAgIHJldHVybiB7XG4gICAgICB2ZXJpZnk6IGFzeW5jIChfdG9rZW46IHN0cmluZyk6IFByb21pc2U8Q2xhaW1zPiA9PiB7XG4gICAgICAgIGlmIChuZXh0RXJyb3IpIHtcbiAgICAgICAgICB0aHJvdyBuZXh0RXJyb3JcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbmV4dFJlc3VsdFxuICAgICAgfSxcbiAgICB9XG4gIH0sXG59XG4iXX0=