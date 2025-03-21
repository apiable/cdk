import {CognitoJwtVerifier} from 'aws-jwt-verify'
import AWS from 'aws-sdk';
import {jwtDecode} from 'jwt-decode'

const authMethod = process.env.AUTH_METHOD || 'JWT' // HYBRID, API_KEY, JWT, default to JWT

const isAuthMethodHybrid = authMethod.toLowerCase() === 'hybrid'
const isAuthMethodApiKey = authMethod.toLowerCase() === 'api_key'
const isAuthMethodJWT = !isAuthMethodApiKey && !isAuthMethodHybrid // default to JWT

const logLevel = process.env.LOG_LEVEL || 'info'
const isDebug = logLevel.toLowerCase() === 'debug' || logLevel.toLowerCase() === 'info'
const isInfo = logLevel.toLowerCase() === 'info'

// define constants
const userPoolId = process.env.APIABLE_AWS_AUTHZ_USERPOOLID || process.env.COGNITO_USER_POOL_ID; // in the beginning the name was COGNITO_USER_POOL_ID, but it was changed to APIABLE_AWS_AUTHZ_USERPOOLID
const authZassumeRoleArn = process.env.APIABLE_AWS_AUTHZ_ASSUME_ROLE_ARN
const region = process.env.APIABLE_AWS_AUTHZ_USERPOOLID.split('_')[0]

const usersCache = new Map();
const USER_CACHE_EXPIRES_IN = 1000 * 60 * 60 // 1 hour

const sts = new AWS.STS()
const roleToAssume = {
    RoleArn: authZassumeRoleArn,
    RoleSessionName: 'CrossAccountAuthZCognitoAccess'
};

// Define the function to get user information
const getUser = async (username) => {
    if (usersCache.has(username)) {
        if (isDebug) {
            console.log('User found in cache:', username)
        }
        const user = usersCache.get(username)
        if (user.expires > Date.now()) {
            return usersCache.get(username)
        } else {
            if (isDebug) {
                console.log('User found in cache but expired:', username)
            }
            usersCache.delete(username)
        }
    }
    try {
        const cred = await sts.assumeRole(roleToAssume).promise();
        const credentials = new AWS.Credentials({
            accessKeyId: cred.Credentials.AccessKeyId,
            secretAccessKey: cred.Credentials.SecretAccessKey,
            sessionToken: cred.Credentials.SessionToken
        });
        const remoteConfig = {
            credentials,
            region
        };
        const cognitoClient = new AWS.CognitoIdentityServiceProvider(remoteConfig);

        const params = {
            UserPoolId: userPoolId,
            Username: username,
        };

        const data = await cognitoClient.adminGetUser(params).promise();
        data.expires = Date.now() + USER_CACHE_EXPIRES_IN
        usersCache.set(username, data);
        return data;
        /*
        EXAMPLE
        User data: {
          Username: '_apbl_z41x9ud46dhr5vkbzwrg1gabq',
          UserAttributes: [
            { Name: 'nickname', Value: 'GATEWAY' },
            { Name: 'name', Value: 'apiable_plan_resources:' },
            {
              Name: 'family_name',
              Value: 'apiable_plan_id:665715d7bf5d765c87a2889c'
            },
            {
              Name: 'given_name',
              Value: 'apiable_subscription_id:66793474558a21672ca39074'
            },
            {
              Name: 'middle_name',
              Value: 'apiable_api_key:AgoDhjYo0F1N45rv4u5sS1WIP6rgsI6a4IwK2IQc'
            },
            {
              Name: 'preferred_username',
              Value: 'apiable_product_id:AgoDhjYo0F1N45rv4u5sS1WIP6rgsI6a4IwK2IQc'
            },
            { Name: 'sub', Value: '03f4f8d2-60f1-7070-ac69-3bafb22177e5' }
          ],
          UserCreateDate: 2024-06-24T08:55:33.491Z,
          UserLastModifiedDate: 2024-06-24T08:55:33.710Z,
          Enabled: true,
          UserStatus: 'CONFIRMED'
        }
        */
    } catch (error) {
        console.error('Error fetching user:', error);
        throw error;
    }
};

/*
* access token example
* {
  "sub": "f3b4f832-7041-70bd-fc6a-d975b53309c5",
  "iss": "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_sGgtSTd9j",
  "client_id": "2knpl3jn4i6mvmr0hlogmb890k",
  "origin_jti": "58925920-8d67-4c5e-8730-fe82f4b93bc0",
  "event_id": "2d05f1f2-dfbe-4a30-a42d-ad91d13da5d8",
  "token_use": "access",
  "scope": "aws.cognito.signin.user.admin",
  "auth_time": 1720103319,
  "exp": 1720106919,
  "iat": 1720103319,
  "jti": "efaf6b9a-0986-463a-b2c6-cbe6fba9fc7e",
  "username": "_apbl_drkd3vqpjmkrswsdpis92hs00"
}
*
* id token example
*
* {
  "sub": "f3b4f832-7041-70bd-fc6a-d975b53309c5",
  "apiable_subscription_id": "6686a98a7aab4c2a023f3bf4",
  "apiable_plan_id": "6554c8996baba37e276209a3",
  "iss": "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_sGgtSTd9j",
  "apiable_plan_resources": "2sb39b8kef/prod/GET/planetary/apod;2sb39b8kef/prod/OPTIONS/planetary/apod;nzcr47gsz1/prod/GET/insight_weather;nzcr47gsz1/prod/OPTIONS/insight_weather",
  "cognito:username": "_apbl_drkd3vqpjmkrswsdpis92hs00",
  "apiable_api_key": "RLbwtObiSV7O9Up0ygv3za0Py8iEGpyPasNL3tyN",
  "origin_jti": "58925920-8d67-4c5e-8730-fe82f4b93bc0",
  "aud": "2knpl3jn4i6mvmr0hlogmb890k",
  "event_id": "2d05f1f2-dfbe-4a30-a42d-ad91d13da5d8",
  "token_use": "id",
  "scope": "apiable/subscription",
  "auth_time": 1720103319,
  "exp": 1720189719,
  "iat": 1720103319,
  "jti": "7874ed01-daf4-44c7-b9c1-14350319649a"
}
* */

// Verifier that expects valid access tokens:
const verifierJWTSimple = CognitoJwtVerifier.create({
    userPoolId,
    clientId: null,
    tokenUse: null //"id"
});

const verifierJWTApiable = CognitoJwtVerifier.create({
    userPoolId,
    clientId: null,
    tokenUse: null, //"id",
    customJwtCheck: async ({header, payload, jwk}) => {
        if (!payload["cognito:username"] && !payload["username"]) {
            throw new Error("User expected in the token in either cognito:username (id_token) or username (access_token)");
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
        if (isDebug) {
            console.log('before replace:', resources)
        }
        // before replace: d8trso4r25/prod/ANY//;d8trso4r25/prod/OPTIONS//;d8trso4r25/prod/ANY/{proxy+};d8trso4r25/prod/OPTIONS/{proxy+}

        resourcePolicies = resources
            .replaceAll(' ', '') // remove all spaces (should normally not contain any)
            .replaceAll('ANY', '*') // replace ANY with *, which the gateway will understand
            .replaceAll(/{[^}]+}/g, '*') // replace all path-patterns with * {proxy+}
            .replaceAll(/{[^}]}/g, '*') // replace all path-patterns with * {proxy}
            .replaceAll('//;', '/*;') // replace all path with * which are a base path '/' like GET//;
            .replaceAll('/*/*', '/*') // replace all path with now end up like stared method and path eg. xyz/*/* => just use /* => means any method and any path
            .split(';');
        if (isDebug) {
            console.log('after replace:', resourcePolicies.join(';'))
        }

        resourcePoliciesFilteredUnique = [...new Set(resourcePolicies)];
        if (isDebug) {
            console.log('after replace:', resourcePoliciesFilteredUnique.join(';'))
        }
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

const assumeAWSToken = async (event, token, meta) => {
    try {
        const payload = await verifierJWTApiable.verify(token);
        const planResources = meta.apiable_plan_resources || ""
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

        iamPolicy.context = {...meta};
        iamPolicy.usageIdentifierKey = meta.apiable_api_key;
        return iamPolicy;
    } catch (e) {
        if (isDebug) {
            console.log("Token is not AWS Cognito Token", e.message)
        }
        return null;
    }
}

const assumeAwsApiKey = async (event, token) => {
    try {
        await verifierJWTSimple.verify(token);
        if (isDebug) {
            console.log("looks like the key is a JWT ID Token")
            console.log("Token is not AWS Api Gateway Key")
        }
        return null;
    } catch (e) {
        if (isDebug) {
            console.log("Token might be an AWS Api Gateway Key")
        }
        const planResources = ""
        let iamPolicy = generateIAMPolicy("sub", planResources, event.methodArn);
        iamPolicy.usageIdentifierKey = token;
        return iamPolicy;
    }
}

const getToken = (event) => {
    if (event.authorizationToken) {
        return event.authorizationToken.replace("Bearer ", "");
    }
    if (event.headers) {
        const headerKey = Object.keys(event.headers)
            .find(key => key.toLowerCase() === 'x-api-key');
        if (headerKey) {
            return event.headers[headerKey];
        }
    }
    return null;
}

export const handler = async (event, context, callback) => {
    if (!event.authorizationToken) {
        context.fail("Unauthorized");
        return
    }

    const token = getToken(event)

    let iamPolicyResult = null;

    // check if the token is a JWT
    if (isAuthMethodJWT || isAuthMethodHybrid) {
        try {
            jwtDecode(token)
            let payload = await verifierJWTApiable.verify(token)
            // Token claims
            const meta = {
                apiable_api_key: payload.apiable_api_key,
                apiable_plan_resources: payload.apiable_plan_resources,
                apiable_subscription_id: payload.apiable_subscription_id,
                apiable_plan_id: payload.apiable_plan_id,
                apiable_product_id: payload.apiable_product_id || "",
            }
            // AWS Cognito User Pool
            if (authZassumeRoleArn) {
                const userId = payload["cognito:username"] || payload["username"]
                const user = await getUser(userId)
                meta.apiable_api_key = user.UserAttributes.find(attr => attr.Name === 'middle_name').Value.replace('apiable_api_key:', '')
                meta.apiable_plan_resources = user.UserAttributes.find(attr => attr.Name === 'name').Value.replace('apiable_plan_resources:', '')
                meta.apiable_subscription_id = user.UserAttributes.find(attr => attr.Name === 'given_name').Value.replace('apiable_subscription_id:', '')
                meta.apiable_plan_id = user.UserAttributes.find(attr => attr.Name === 'family_name').Value.replace('apiable_plan_id:', '')
                const productId = user.UserAttributes.find(attr => attr.Name === 'preferred_username')
                if (productId) {
                    meta.apiable_product_id = productId?.Value?.replace('apiable_product_id:', '')
                }
            }
            iamPolicyResult = await assumeAWSToken(event, token, meta);
        } catch (e) {
            if (isDebug) {
                console.log(`Could not decode token, token is not a JWT: $token`, e.message)
            }
        }
    }

    if (!iamPolicyResult) {
        if (isAuthMethodJWT) {
            context.fail("Unauthorized");
            return
        } else { // isAuthMethodApiKey || isAuthMethodHybrid
            if (isDebug) {
                console.log(`Skipping JWT decode check Environment is set to 'AUTH_METHOD=${authMethod}'`)
            }
            iamPolicyResult = await assumeAwsApiKey(event, token);
        }
    }

    if (!iamPolicyResult) {
        if (isDebug) {
            console.log(`AUTH_METHOD=${authMethod}. If not set defaulting to JWT. or set to AUTH_METHOD=API_KEY or HYBRID`)
            console.log("Unauthorized - IAM Policy not generated");
        }
        context.fail("Unauthorized");
        return
    }
    if (isDebug) {
        console.log('iamPolicy:', JSON.stringify(iamPolicyResult, null, 2))
    }
    callback(null, iamPolicyResult)
}

