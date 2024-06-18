import {CognitoJwtVerifier} from 'aws-jwt-verify'
import 'dotenv/config'

// Verifier that expects valid access tokens:
const verifierJWTSimple = CognitoJwtVerifier.create({
    userPoolId: process.env.COGNITO_USER_POOL_ID,
    clientId: null,
    tokenUse: "id"
});

const verifierJWTApiable = CognitoJwtVerifier.create({
    userPoolId: process.env.COGNITO_USER_POOL_ID,
    clientId: null,
    tokenUse: "id",
    customJwtCheck: async ({header, payload, jwk}) => {
        if (!payload.apiable_api_key) {
            throw new Error("Api key expected");
        }
    },
});

const defaultDenyAllPolicy = {
    "principalId": "user",
    "policyDocument": {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Action": "execute-api:Invoke",
                "Effect": "Deny",
                "Resource": "*"
            }
        ]
    }
};

/* Generate an IAM policy statement */
function generatePolicyStatement(methodArn, action) {

    const statement = {};
    statement.Action = 'execute-api:Invoke';
    statement.Effect = action;
    statement.Resource = methodArn;
    return statement;
}


function generatePolicy(principalId, policyStatements) {
    const authResponse = {};
    authResponse.principalId = principalId;
    const policyDocument = {};
    policyDocument.Version = '2012-10-17';
    policyDocument.Statement = policyStatements;
    authResponse.policyDocument = policyDocument;
    return authResponse;
}

/* Generate an IAM policy */
function generateIAMPolicy(user, planResources, methodArn) {
    const policyStatements = [];

    policyStatements.push(generatePolicyStatement(getServiceArn(planResources, methodArn), "Allow")); //Wildcard path generated. Needed if IAM policies are cached and multipe API paths are using the Authorizer

    /* Check if no policy statement is generated, if so, return default deny all policy statement */
    let generatedPolicy = []
    if (policyStatements.length === 0) {
        generatedPolicy = defaultDenyAllPolicy;
    } else {
        generatedPolicy = generatePolicy(user, policyStatements);
    }
    return generatedPolicy
}

function getServiceArn(resources, methodArn) {

    let resourcePolicies = []
    let resourcePoliciesFilteredUnique = []
    if (!!resources) {
        console.log('before replace:', resources)
        // before replace: d8trso4r25/prod/ANY//;d8trso4r25/prod/OPTIONS//;d8trso4r25/prod/ANY/{proxy+};d8trso4r25/prod/OPTIONS/{proxy+}

        resourcePolicies = resources
            .replaceAll(' ','') // remove all spaces (should normally not contain any)
            .replaceAll('ANY','*') // replace ANY with *, which the gateway will understand
            .replaceAll(/{[^}]+}/g, '*') // replace all path-patterns with * {proxy+}
            .replaceAll(/{[^}]}/g, '*') // replace all path-patterns with * {proxy}
            .replaceAll('//;','/*;') // replace all path with * which are a base path '/' like GET//;
            .replaceAll('/*/*', '/*') // replace all path with now end up like stared method and path eg. xyz/*/* => just use /* => means any method and any path
            .split(';');
        console.log('after replace:', resourcePolicies.join(';'))

        resourcePoliciesFilteredUnique = [...new Set(resourcePolicies)];
        console.log('after replace:', resourcePoliciesFilteredUnique.join(';'))
        // after replace: d8trso4r25/prod/*;d8trso4r25/prod/OPTIONS;d8trso4r25/prod/*;d8trso4r25/prod/OPTIONS
    }

    // arn:aws:execute-api:eu-central-1:034444869755:cl4z2nr4p8/prod/GET/dark

    // Get the last part, such as cqo3riplm6/default/GET/products
    const parts = methodArn.split(':');
    if (parts.length === 6) {

        // Split the path into parts
        const pathParts = parts[5].split('/'); // cl4z2nr4p8/prod/GET/dark
        // d8trso4r25 prod ANY /
        const resourcePolicyArns = []
        if (pathParts.length >= 4) {
            if (resourcePoliciesFilteredUnique.length > 0) {
                for (let i = 0; i < resourcePoliciesFilteredUnique.length; i++) {
                    parts[5] = resourcePoliciesFilteredUnique[i];
                    resourcePolicyArns.push(parts.join(':'))
                }
            } else {
                // Update the final part to a wildcard value such as cqo3riplm6/mystage/*, to apply to all lambdas in the API
                parts[5] = `${pathParts[0]}/${pathParts[1]}/*`;
                resourcePolicyArns.push(parts.join(':'))
            }
            return resourcePolicyArns
        }
    }

    // Sanity check
    throw new Error(`Unexpected method ARN received: ${methodArn}`);
}

const assumeAWSToken = async (event, token) => {
    try {
        const payload = await verifierJWTApiable.verify(token);
        const planResources = payload.apiable_plan_resources || ""
        let iamPolicy = generateIAMPolicy(payload.sub, planResources, event.methodArn);

        /*
        {
          sub: 'b334a8b2-00a1-709c-e1d1-927c5a65137f',
          apiable_subscription_id: '662fa171001c1c3d0709213c',
          apiable_plan_id: '662fa171001c1c3d0709213d',
          iss: 'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_sGgtSTd9k',
          'cognito:username': 'tcbyzv18ie9u2qklzzkh4powl5x',
          apiable_api_key: 'nDKRZoRyHU5dcxDBYMvrg5jF1sIgpDj259vvoWYX',
          origin_jti: 'a99b2cee-3a78-4c7e-9084-b46b1dcb2724',
          aud: '2fnuf7lu0foug1soec9fhrldhk',
          event_id: '02180baa-2977-4427-b030-d8754851e433',
          token_use: 'id',
          scope: 'apiable/subscription',
          auth_time: 1714397724,
          exp: 1714484124,
          iat: 1714397724,
          jti: '60bd063f-1a99-41fd-9b9b-07ad135031f0'
        }
        */

        // iamPolicy.context = {"Authorization": payload};
        iamPolicy.usageIdentifierKey = payload.apiable_api_key;
        return iamPolicy;
    } catch (e) {
        console.log("Token is not AWS Cognito Token", e.message)
        return null;
    }
}

const assumeAwsApiKey = async (event, token) => {
    try {
        await verifierJWTSimple.verify(token);
        console.log("looks like the key is a JWT ID Token")
        console.log("Token is not AWS Api Gateway Key")
        return null;
    } catch (e) {
        console.log("Token might be an AWS Api Gateway Key")
        const planResources = ""
        let iamPolicy = generateIAMPolicy("sub", planResources, event.methodArn);
        iamPolicy.usageIdentifierKey = token;
        return iamPolicy;
    }
}


export const handler = async (event, context) => {

    console.log('Received event:', JSON.stringify(event, null, 2));

    if (!event.authorizationToken) {
        context.fail("Unauthorized");
        return;
    }

    const token = event.authorizationToken.replace("Bearer ", "");

    // AWS Cognito Token Case
    let iamPolicyResult = await assumeAWSToken(event, token);
    if (iamPolicyResult == null) {
        iamPolicyResult = await assumeAwsApiKey(event, token);
    }
    if (iamPolicyResult == null) {
        context.fail("Unauthorized");
    }
    console.log('iamPolicy:', JSON.stringify(iamPolicyResult, null, 2));
    return iamPolicyResult;
}
