/**
 * Test stub for `aws-jwt-verify` (the Cognito JWT verifier the authorizer uses). The verifier is the
 * single external/network boundary of the handler; stubbing it lets the deny/allow + token-trust paths
 * run against the REAL authorizer handler without a live Cognito pool. Tests set the next verify result
 * (a decoded claims payload) or make it reject (the invalid-signature / wrong-issuer / expired /
 * wrong-token-type path) via the controls below.
 */

type Claims = Record<string, unknown>

let nextResult: Claims = {}
let nextError: Error | null = null
let lastCreateConfig: Record<string, unknown> | null = null

/** Make the next `verify()` resolve with these claims (the valid-token path). */
export const __setVerifyResult = (claims: Claims): void => {
  nextResult = claims
  nextError = null
}

/** Make the next `verify()` reject (bad signature / wrong issuer / expired / wrong token type). */
export const __setVerifyError = (message: string): void => {
  nextError = new Error(message)
}

/** Reset to the default (verify resolves with empty claims). */
export const __reset = (): void => {
  nextResult = {}
  nextError = null
  lastCreateConfig = null
}

/** The config the handler passed to `CognitoJwtVerifier.create` (so a test can assert tokenUse=access). */
export const __lastCreateConfig = (): Record<string, unknown> | null => lastCreateConfig

export const CognitoJwtVerifier = {
  create(config: Record<string, unknown>) {
    lastCreateConfig = config
    return {
      verify: async (_token: string): Promise<Claims> => {
        if (nextError) {
          throw nextError
        }
        return nextResult
      },
    }
  },
}
