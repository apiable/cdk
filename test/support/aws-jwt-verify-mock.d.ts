/**
 * Test stub for `aws-jwt-verify` (the Cognito JWT verifier the authorizer uses). The verifier is the
 * single external/network boundary of the handler; stubbing it lets the deny/allow + token-trust paths
 * run against the REAL authorizer handler without a live Cognito pool. Tests set the next verify result
 * (a decoded claims payload) or make it reject (the invalid-signature / wrong-issuer / expired /
 * wrong-token-type path) via the controls below.
 */
type Claims = Record<string, unknown>;
/** Make the next `verify()` resolve with these claims (the valid-token path). */
export declare const __setVerifyResult: (claims: Claims) => void;
/** Make the next `verify()` reject (bad signature / wrong issuer / expired / wrong token type). */
export declare const __setVerifyError: (message: string) => void;
/**
 * Reset the per-call verify outcome to the default (resolves with empty claims). The captured create
 * config is intentionally NOT cleared: the handler creates the verifier lazily and caches it for the
 * module's lifetime, so the config is a once-captured fact about how the handler configures the
 * verifier (tokenUse=access) — it stays asserted across tests sharing the cached verifier.
 */
export declare const __reset: () => void;
/** The config the handler passed to `CognitoJwtVerifier.create` (so a test can assert tokenUse=access). */
export declare const __lastCreateConfig: () => Record<string, unknown> | null;
export declare const CognitoJwtVerifier: {
    create(config: Record<string, unknown>): {
        verify: (_token: string) => Promise<Claims>;
    };
};
export {};
