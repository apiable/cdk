// https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-token-generation.html#user-pool-lambda-pre-token-generation-accesstoken

export const handler = function(event, context) {
  console.log(event)
  event.response = {
    "claimsOverrideDetails": {
      "claimsToAddOrOverride": {
        "apiable_api_key": event.request.userAttributes['middle_name'].replace('apiable_api_key:',''),
        "apiable_subscription_id": event.request.userAttributes['given_name'].replace('apiable_subscription_id:',''),
        "apiable_plan_id": event.request.userAttributes['family_name'].replace('apiable_plan_id:',''),
        "scope": "apiable/subscription"

      },
      "claimsToSuppress": [
        "family_name",
        "given_name",
        "email",
        "email_verified",
        "sub",
        "iss",
        "cognito:username",
        "origin_jti",
        "middle_name",
        "nickname"
      ]
    }
  }
  // Return to Amazon Cognito
  context.done(null, event);
};