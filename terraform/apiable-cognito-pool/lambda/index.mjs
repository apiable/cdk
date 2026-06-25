// V3_0 Pre Token Generation for the client_credentials (machine-to-machine) grant: stamps the Apiable
// claims into the ACCESS token. V3_0 is the only Pre Token Generation version that fires for the
// client_credentials grant and customises the access token; V1_0/V2_0 fire only for user-pool sign-in
// and customise the ID token. The pool must be on the Cognito Essentials or Plus feature plan for V3_0.
//
// The `scope` claim is issued natively by Cognito from the app client's allowed scopes; this hook does
// NOT set it. It injects the two Apiable claims the authorizer reads:
//   apiable_api_key        -> the authorizer would return it as usageIdentifierKey (the hidden-key,
//                             single-credential metering path).
//   apiable_plan_resources -> the authorizer turns it into a per-method IAM policy; empty makes the
//                             authorizer grant the invoked API on a scope-pass.
//
// Neither claim has a machine-to-machine source on this path (no user => no user-attribute pipeline), so
// BOTH ship empty and per-client binding is deferred to a dedicated binding story; the claims stay
// injected so the token shape stays the proven spike shape. The live entitlement is the native `scope`
// claim. See the AWS V3_0 event/response shape:
// https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-token-generation.html

const API_KEY = process.env.APIABLE_API_KEY || ''
const PLAN_RESOURCES = process.env.APIABLE_PLAN_RESOURCES || ''

export const handler = async (event) => {
  // Log identity + trigger only — never the claims payload, the token, or a secret (RULES: Security).
  const clientId = event?.callerContext?.clientId ?? 'unknown'
  const triggerSource = event?.triggerSource ?? 'unknown'
  console.log(`pretokengen v3: client=${clientId} trigger=${triggerSource}`)

  event.response = {
    claimsAndScopeOverrideDetails: {
      accessTokenGeneration: {
        claimsToAddOrOverride: {
          apiable_api_key: API_KEY,
          apiable_plan_resources: PLAN_RESOURCES,
        },
      },
    },
  }

  return event
}
