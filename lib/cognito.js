"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Cognito = exports.PRE_TOKEN_FUNCTION_LOGICAL_ID = exports.AUTHZ_POOL_LOGICAL_ID = exports.AUTHN_POOL_LOGICAL_ID = void 0;
const cdk = require("aws-cdk-lib");
const cognito = require("aws-cdk-lib/aws-cognito");
const lambda = require("aws-cdk-lib/aws-lambda");
const iam = require("aws-cdk-lib/aws-iam");
const path = require("path");
const aws_cdk_lib_1 = require("aws-cdk-lib");
/**
 * Author-declared, channel-identical identities the release-time parity gate keys the cognito pools and
 * the pre-token function on (the `apiable:logical-id` tag), so each compares equal across the CDK,
 * published-CFN, and Terraform channels regardless of its generated name, account, region, or tenant
 * segment. The hand-rolled Terraform module declares the identical literals; an enforced pool that omits
 * the tag surfaces as an explicit parity divergence rather than being inferred from its name.
 */
exports.AUTHN_POOL_LOGICAL_ID = 'apiable-authn-pool';
exports.AUTHZ_POOL_LOGICAL_ID = 'apiable-authz-pool';
exports.PRE_TOKEN_FUNCTION_LOGICAL_ID = 'apiable-pretoken-fn';
class Cognito extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const { account, region, name, domain: domainProp, fromEmail: fromEmailProp } = props.env;
        const fromEmail = fromEmailProp || 'no-reply@verificationemail.com';
        const replyTo = fromEmail;
        const domain = domainProp || `${name}.apiable.io`;
        const userPoolName = `portal-${name}`;
        console.log("Creating Cognito Pool for stack: ", name);
        console.log("User Pool Name is: ", userPoolName);
        const callbackUrls = ['http://localhost:3000', `https://${domain}/api/oauth2/oauth-token`];
        const logoutUrls = callbackUrls;
        /*
        
         █████╗ ██╗   ██╗████████╗██╗  ██╗███╗   ██╗    ██╗   ██╗███████╗███████╗██████╗     ██████╗  ██████╗  ██████╗ ██╗
        ██╔══██╗██║   ██║╚══██╔══╝██║  ██║████╗  ██║    ██║   ██║██╔════╝██╔════╝██╔══██╗    ██╔══██╗██╔═══██╗██╔═══██╗██║
        ███████║██║   ██║   ██║   ███████║██╔██╗ ██║    ██║   ██║███████╗█████╗  ██████╔╝    ██████╔╝██║   ██║██║   ██║██║
        ██╔══██║██║   ██║   ██║   ██╔══██║██║╚██╗██║    ██║   ██║╚════██║██╔══╝  ██╔══██╗    ██╔═══╝ ██║   ██║██║   ██║██║
        ██║  ██║╚██████╔╝   ██║   ██║  ██║██║ ╚████║    ╚██████╔╝███████║███████╗██║  ██║    ██║     ╚██████╔╝╚██████╔╝███████╗
        ╚═╝  ╚═╝ ╚═════╝    ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═══╝     ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝    ╚═╝      ╚═════╝  ╚═════╝ ╚══════╝
        
         */
        const poolAuthN = new cognito.UserPool(this, name, {
            deletionProtection: false,
            userPoolName,
            email: cognito.UserPoolEmail.withCognito(fromEmail),
            mfa: cognito.Mfa.OPTIONAL,
            signInCaseSensitive: false,
            signInAliases: {
                email: true
            },
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            autoVerify: {
                email: true
            },
            selfSignUpEnabled: true,
            standardAttributes: {
                familyName: {
                    mutable: true,
                    required: true
                },
                givenName: {
                    mutable: true,
                    required: true
                },
                email: {
                    mutable: true,
                    required: true
                }
            }
        });
        // Declare the channel-stable identity on the pool itself (never the stack — a stack-wide tag
        // collapses every resource onto one id), so the parity gate keys it by declared id. The tag lands
        // in the pool's UserPoolTags; the gate enforces it (an id-less pool reads as a divergence).
        cdk.Tags.of(poolAuthN).add('apiable:logical-id', exports.AUTHN_POOL_LOGICAL_ID);
        const adminScope = new cognito.ResourceServerScope({
            scopeName: 'admin',
            scopeDescription: 'Full Access to the Apiable APIs',
        });
        const readScope = new cognito.ResourceServerScope({
            scopeName: 'read',
            scopeDescription: 'Read Access to the Apiable APIs',
        });
        const cicdScope = new cognito.ResourceServerScope({
            scopeName: 'cicd',
            scopeDescription: 'CICD Access to the Apiable APIs',
        });
        const resourceServerAuthN = poolAuthN.addResourceServer('ResourceServer', {
            userPoolResourceServerName: 'apiable',
            identifier: 'apiable',
            scopes: [adminScope, readScope, cicdScope],
        });
        let domainPrefix = `apiable-${name}`;
        if (name === 'aws')
            domainPrefix = 'apiable-aw-s'; // aws is reserver on aws and cannot be used
        poolAuthN.addDomain('CognitoDomain', { cognitoDomain: { domainPrefix } });
        const loginClient = new cognito.UserPoolClient(this, 'login', {
            userPool: poolAuthN,
            userPoolClientName: 'login',
            preventUserExistenceErrors: true,
            authFlows: { userPassword: name === 'dev', userSrp: true, custom: true },
            oAuth: {
                scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PHONE],
                callbackUrls,
                logoutUrls,
            },
        });
        const apiClient = new cognito.UserPoolClient(this, 'api', {
            userPool: poolAuthN,
            userPoolClientName: 'api',
            generateSecret: true,
            oAuth: {
                flows: {
                    clientCredentials: true
                },
                scopes: [
                    cognito.OAuthScope.resourceServer(resourceServerAuthN, adminScope),
                    cognito.OAuthScope.resourceServer(resourceServerAuthN, readScope)
                ]
            },
        });
        const cicdClient = new cognito.UserPoolClient(this, 'cicd', {
            userPool: poolAuthN,
            userPoolClientName: 'cicd',
            generateSecret: true,
            oAuth: {
                flows: {
                    clientCredentials: true
                },
                scopes: [
                    cognito.OAuthScope.resourceServer(resourceServerAuthN, cicdScope)
                ]
            },
        });
        const assumedBy = account === '034444869755' ? new iam.AccountPrincipal(account) : new iam.CompositePrincipal(new iam.AccountPrincipal('034444869755'), new iam.AccountPrincipal(account));
        const apiableCognitoServiceRoleAuthN = new iam.Role(this, 'ApiableCognitoAuthN', {
            assumedBy,
            roleName: `ApiableCognitoAuthN-${userPoolName}`,
            description: `Admin Role for Apiable to manage the Cognito Pool from Dashboard (create, delete, invite users, etc.) and Portal AuthN for userpool: ${userPoolName}`,
        });
        apiableCognitoServiceRoleAuthN.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            resources: [`arn:aws:cognito-idp:${region}:${account}:userpool/${poolAuthN.userPoolId}`],
            actions: [
                'cognito-idp:*'
            ]
        }));
        /*
         █████╗ ██╗   ██╗████████╗██╗  ██╗███████╗    ██╗   ██╗███████╗███████╗██████╗     ██████╗  ██████╗  ██████╗ ██╗
        ██╔══██╗██║   ██║╚══██╔══╝██║  ██║╚══███╔╝    ██║   ██║██╔════╝██╔════╝██╔══██╗    ██╔══██╗██╔═══██╗██╔═══██╗██║
        ███████║██║   ██║   ██║   ███████║  ███╔╝     ██║   ██║███████╗█████╗  ██████╔╝    ██████╔╝██║   ██║██║   ██║██║
        ██╔══██║██║   ██║   ██║   ██╔══██║ ███╔╝      ██║   ██║╚════██║██╔══╝  ██╔══██╗    ██╔═══╝ ██║   ██║██║   ██║██║
        ██║  ██║╚██████╔╝   ██║   ██║  ██║███████╗    ╚██████╔╝███████║███████╗██║  ██║    ██║     ╚██████╔╝╚██████╔╝███████╗
        ╚═╝  ╚═╝ ╚═════╝    ╚═╝   ╚═╝  ╚═╝╚══════╝     ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝    ╚═╝      ╚═════╝  ╚═════╝ ╚══════╝
        */
        const poolAuthZ = new cognito.UserPool(this, `${name}-authz`, {
            deletionProtection: false,
            userPoolName: `${userPoolName}-authz`,
            mfa: cognito.Mfa.OFF,
            signInCaseSensitive: false,
            signInAliases: {
                username: true
            },
            accountRecovery: cognito.AccountRecovery.NONE,
            selfSignUpEnabled: false
        });
        cdk.Tags.of(poolAuthZ).add('apiable:logical-id', exports.AUTHZ_POOL_LOGICAL_ID);
        const l = new lambda.Function(this, 'Function', {
            functionName: `${userPoolName}-auth`,
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, './assets/lambdas/pre-token-generation-authz')),
        });
        cdk.Tags.of(l).add('apiable:logical-id', exports.PRE_TOKEN_FUNCTION_LOGICAL_ID);
        poolAuthZ.addTrigger(cognito.UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG, l, cognito.LambdaVersion.V1_0);
        const authZadminScope = new cognito.ResourceServerScope({
            scopeName: 'admin',
            scopeDescription: 'Full Access to the Apiable APIs',
        });
        const resourceServerAuthZ = poolAuthZ.addResourceServer('ResourceServer', {
            userPoolResourceServerName: 'apiable',
            identifier: 'apiable',
            scopes: [authZadminScope],
        });
        const authzClient = new cognito.UserPoolClient(this, 'authz', {
            userPool: poolAuthZ,
            userPoolClientName: 'authz',
            generateSecret: true,
            authFlows: { userPassword: true, userSrp: true, custom: true },
            oAuth: {
                flows: {
                    clientCredentials: true
                },
                scopes: [
                    cognito.OAuthScope.resourceServer(resourceServerAuthZ, authZadminScope)
                ]
            },
        });
        const apiableCognitoServiceRoleAuthZ = new iam.Role(this, 'ApiableCognitoAuthZ', {
            assumedBy,
            roleName: `ApiableCognitoAuthZ-${userPoolName}`,
            description: `Admin Role for Apiable to manage the Cognito Pool from Dashboard (create, delete, tokens, etc.) and Portal AuthZ for userpool: ${userPoolName}`,
        });
        const rwAuthZPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            resources: [`arn:aws:cognito-idp:${region}:${account}:userpool/${poolAuthZ.userPoolId}`],
            actions: [
                'cognito-idp:*'
            ]
        });
        apiableCognitoServiceRoleAuthZ.addToPolicy(rwAuthZPolicy);
        new aws_cdk_lib_1.CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHN00ROLE00ARN`, {
            exportName: `${userPoolName}00APIABLE00AWS00AUTHN00ROLE00ARN`,
            value: apiableCognitoServiceRoleAuthN.roleArn
        });
        new aws_cdk_lib_1.CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHN00REGION`, {
            exportName: `${userPoolName}00APIABLE00AWS00AUTHN00REGION`,
            value: region
        });
        new aws_cdk_lib_1.CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHN00USERPOOLID`, {
            exportName: `${userPoolName}00APIABLE00AWS00AUTHN00USERPOOLID`,
            value: poolAuthN.userPoolId
        });
        new aws_cdk_lib_1.CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHN00ISSUER00URI`, {
            exportName: `${userPoolName}00APIABLE00AWS00AUTHN00ISSUER00URI`,
            value: `https://cognito00idp.${region}.amazonaws.com/${poolAuthN.userPoolId}`
        });
        new aws_cdk_lib_1.CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHN00DOMAIN`, {
            exportName: `${userPoolName}00APIABLE00AWS00AUTHN00DOMAIN`,
            value: `https://${domainPrefix}.auth.${region}.amazoncognito.com`
        });
        new aws_cdk_lib_1.CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHN00CLIENTS00LOGIN00ID`, {
            exportName: `${userPoolName}00APIABLE00AWS00AUTHN00CLIENTS00LOGIN00ID`,
            value: loginClient.userPoolClientId
        });
        new aws_cdk_lib_1.CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHN00CLIENTS00API00ID`, {
            exportName: `${userPoolName}00APIABLE00AWS00AUTHN00CLIENTS00API00ID`,
            value: apiClient.userPoolClientId
        });
        new aws_cdk_lib_1.CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHN00CLIENTS00API00SECRET`, {
            exportName: `${userPoolName}00APIABLE00AWS00AUTHN00CLIENTS00API00SECRET`,
            value: apiClient.userPoolClientSecret.unsafeUnwrap()
        });
        new aws_cdk_lib_1.CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHN00CLIENTS00CICD00ID`, {
            exportName: `${userPoolName}00APIABLE00AWS00AUTHN00CLIENTS00CICD00ID`,
            value: cicdClient.userPoolClientId
        });
        new aws_cdk_lib_1.CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHN00CLIENTS00CICD00SECRET`, {
            exportName: `${userPoolName}00APIABLE00AWS00AUTHN00CLIENTS00CICD00SECRET`,
            value: cicdClient.userPoolClientSecret.unsafeUnwrap()
        });
        new aws_cdk_lib_1.CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHZ00ROLE00ARN`, {
            exportName: `${userPoolName}00APIABLE00AWS00AUTHZ00ROLE00ARN`,
            value: apiableCognitoServiceRoleAuthZ.roleArn
        });
        new aws_cdk_lib_1.CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHZ00REGION`, {
            exportName: `${userPoolName}00APIABLE00AWS00AUTHZ00REGION`,
            value: region
        });
        new aws_cdk_lib_1.CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHZ00USERPOOLID`, {
            exportName: `${userPoolName}00APIABLE00AWS00AUTHZ00USERPOOLID`,
            value: poolAuthZ.userPoolId
        });
        new aws_cdk_lib_1.CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHZ00ISSUER00URI`, {
            exportName: `${userPoolName}00APIABLE00AWS00AUTHZ00ISSUER00URI`,
            value: `https://cognito00idp.${region}.amazonaws.com/${poolAuthZ.userPoolId}`
        });
        new aws_cdk_lib_1.CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHZ00DOMAIN`, {
            exportName: `${userPoolName}00APIABLE00AWS00AUTHZ00DOMAIN`,
            value: `https://${domainPrefix}z.auth.${region}.amazoncognito.com`
        });
        new aws_cdk_lib_1.CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHZ00CLIENTS00AUTHZ00ID`, {
            exportName: `${userPoolName}00APIABLE00AWS00AUTHZ00CLIENTS00AUTHZ00ID`,
            value: authzClient.userPoolClientId
        });
        new aws_cdk_lib_1.CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHZ00CLIENTS00AUTHZ00SECRET`, {
            exportName: `${userPoolName}00APIABLE00AWS00AUTHZ00CLIENTS00AUTHZ00SECRET`,
            value: authzClient.userPoolClientSecret.unsafeUnwrap()
        });
    }
}
exports.Cognito = Cognito;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29nbml0by5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNvZ25pdG8udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQWtDO0FBRWxDLG1EQUFrRDtBQUNsRCxpREFBZ0Q7QUFDaEQsMkNBQTBDO0FBRTFDLDZCQUE0QjtBQUM1Qiw2Q0FBc0M7QUFFdEM7Ozs7OztHQU1HO0FBQ1UsUUFBQSxxQkFBcUIsR0FBRyxvQkFBb0IsQ0FBQTtBQUM1QyxRQUFBLHFCQUFxQixHQUFHLG9CQUFvQixDQUFBO0FBQzVDLFFBQUEsNkJBQTZCLEdBQUcscUJBQXFCLENBQUE7QUFhbEUsTUFBYSxPQUFRLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFFcEMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFZO1FBRXBELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFBO1FBQ3ZCLE1BQU0sRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsVUFBVSxFQUFFLFNBQVMsRUFBRSxhQUFhLEVBQUMsR0FBRyxLQUFLLENBQUMsR0FBRyxDQUFBO1FBRXhGLE1BQU0sU0FBUyxHQUFHLGFBQWEsSUFBSSxnQ0FBZ0MsQ0FBQTtRQUNuRSxNQUFNLE9BQU8sR0FBRyxTQUFTLENBQUE7UUFDekIsTUFBTSxNQUFNLEdBQUcsVUFBVSxJQUFJLEdBQUcsSUFBSSxhQUFhLENBQUE7UUFDakQsTUFBTSxZQUFZLEdBQUcsVUFBVSxJQUFJLEVBQUUsQ0FBQTtRQUVyQyxPQUFPLENBQUMsR0FBRyxDQUFDLG1DQUFtQyxFQUFFLElBQUksQ0FBQyxDQUFBO1FBQ3RELE9BQU8sQ0FBQyxHQUFHLENBQUMscUJBQXFCLEVBQUUsWUFBWSxDQUFDLENBQUE7UUFDaEQsTUFBTSxZQUFZLEdBQUcsQ0FBQyx1QkFBdUIsRUFBRSxXQUFXLE1BQU0seUJBQXlCLENBQUUsQ0FBQTtRQUMzRixNQUFNLFVBQVUsR0FBRyxZQUFZLENBQUE7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QUFDLENBQUM7UUFFSCxJQUFJLHVCQUFTLENBQUMsSUFBSSxFQUFFLEdBQUcsWUFBWSwrQ0FBK0MsRUFBRTtZQUNsRixVQUFVLEVBQUUsR0FBRyxZQUFZLCtDQUErQztZQUMxRSxLQUFLLEVBQUUsV0FBVyxDQUFDLG9CQUFvQixDQUFDLFlBQVksRUFBRTtTQUN2RCxDQUFDLENBQUM7SUFHTCxDQUFDO0NBQ0Y7QUF2VEQsMEJBdVRDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJ1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cydcbmltcG9ydCAqIGFzIGNvZ25pdG8gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZ25pdG8nXG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSdcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJ1xuaW1wb3J0IHsgZnJvbUNvbnRleHRPckRlZmF1bHQsIGZyb21Db250ZXh0T3JFcnJvciB9IGZyb20gJy4vdXRpbHMnXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnXG5pbXBvcnQge0Nmbk91dHB1dH0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5cbi8qKlxuICogQXV0aG9yLWRlY2xhcmVkLCBjaGFubmVsLWlkZW50aWNhbCBpZGVudGl0aWVzIHRoZSByZWxlYXNlLXRpbWUgcGFyaXR5IGdhdGUga2V5cyB0aGUgY29nbml0byBwb29scyBhbmRcbiAqIHRoZSBwcmUtdG9rZW4gZnVuY3Rpb24gb24gKHRoZSBgYXBpYWJsZTpsb2dpY2FsLWlkYCB0YWcpLCBzbyBlYWNoIGNvbXBhcmVzIGVxdWFsIGFjcm9zcyB0aGUgQ0RLLFxuICogcHVibGlzaGVkLUNGTiwgYW5kIFRlcnJhZm9ybSBjaGFubmVscyByZWdhcmRsZXNzIG9mIGl0cyBnZW5lcmF0ZWQgbmFtZSwgYWNjb3VudCwgcmVnaW9uLCBvciB0ZW5hbnRcbiAqIHNlZ21lbnQuIFRoZSBoYW5kLXJvbGxlZCBUZXJyYWZvcm0gbW9kdWxlIGRlY2xhcmVzIHRoZSBpZGVudGljYWwgbGl0ZXJhbHM7IGFuIGVuZm9yY2VkIHBvb2wgdGhhdCBvbWl0c1xuICogdGhlIHRhZyBzdXJmYWNlcyBhcyBhbiBleHBsaWNpdCBwYXJpdHkgZGl2ZXJnZW5jZSByYXRoZXIgdGhhbiBiZWluZyBpbmZlcnJlZCBmcm9tIGl0cyBuYW1lLlxuICovXG5leHBvcnQgY29uc3QgQVVUSE5fUE9PTF9MT0dJQ0FMX0lEID0gJ2FwaWFibGUtYXV0aG4tcG9vbCdcbmV4cG9ydCBjb25zdCBBVVRIWl9QT09MX0xPR0lDQUxfSUQgPSAnYXBpYWJsZS1hdXRoei1wb29sJ1xuZXhwb3J0IGNvbnN0IFBSRV9UT0tFTl9GVU5DVElPTl9MT0dJQ0FMX0lEID0gJ2FwaWFibGUtcHJldG9rZW4tZm4nXG5cbmV4cG9ydCBpbnRlcmZhY2UgRW52IGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICBhY2NvdW50OiBzdHJpbmc7XG4gIHJlZ2lvbjogc3RyaW5nO1xuICBuYW1lOiBzdHJpbmc7XG4gIGRvbWFpbj86IHN0cmluZztcbiAgZnJvbUVtYWlsPzogc3RyaW5nO1xufVxuZXhwb3J0IGludGVyZmFjZSBQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgZW52OiBFbnY7XG59XG5cbmV4cG9ydCBjbGFzcyBDb2duaXRvIGV4dGVuZHMgY2RrLlN0YWNrIHtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogUHJvcHMpIHtcblxuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpXG4gICAgY29uc3QgeyBhY2NvdW50LCByZWdpb24sIG5hbWUsIGRvbWFpbjogZG9tYWluUHJvcCwgZnJvbUVtYWlsOiBmcm9tRW1haWxQcm9wfSA9IHByb3BzLmVudlxuXG4gICAgY29uc3QgZnJvbUVtYWlsID0gZnJvbUVtYWlsUHJvcCB8fCAnbm8tcmVwbHlAdmVyaWZpY2F0aW9uZW1haWwuY29tJ1xuICAgIGNvbnN0IHJlcGx5VG8gPSBmcm9tRW1haWxcbiAgICBjb25zdCBkb21haW4gPSBkb21haW5Qcm9wIHx8IGAke25hbWV9LmFwaWFibGUuaW9gXG4gICAgY29uc3QgdXNlclBvb2xOYW1lID0gYHBvcnRhbC0ke25hbWV9YFxuXG4gICAgY29uc29sZS5sb2coXCJDcmVhdGluZyBDb2duaXRvIFBvb2wgZm9yIHN0YWNrOiBcIiwgbmFtZSlcbiAgICBjb25zb2xlLmxvZyhcIlVzZXIgUG9vbCBOYW1lIGlzOiBcIiwgdXNlclBvb2xOYW1lKVxuICAgIGNvbnN0IGNhbGxiYWNrVXJscyA9IFsnaHR0cDovL2xvY2FsaG9zdDozMDAwJywgYGh0dHBzOi8vJHtkb21haW59L2FwaS9vYXV0aDIvb2F1dGgtdG9rZW5gIF1cbiAgICBjb25zdCBsb2dvdXRVcmxzID0gY2FsbGJhY2tVcmxzXG5cbi8qXG5cbiDilojilojilojilojilojilZcg4paI4paI4pWXICAg4paI4paI4pWX4paI4paI4paI4paI4paI4paI4paI4paI4pWX4paI4paI4pWXICDilojilojilZfilojilojilojilZcgICDilojilojilZcgICAg4paI4paI4pWXICAg4paI4paI4pWX4paI4paI4paI4paI4paI4paI4paI4pWX4paI4paI4paI4paI4paI4paI4paI4pWX4paI4paI4paI4paI4paI4paI4pWXICAgICDilojilojilojilojilojilojilZcgIOKWiOKWiOKWiOKWiOKWiOKWiOKVlyAg4paI4paI4paI4paI4paI4paI4pWXIOKWiOKWiOKVl1xu4paI4paI4pWU4pWQ4pWQ4paI4paI4pWX4paI4paI4pWRICAg4paI4paI4pWR4pWa4pWQ4pWQ4paI4paI4pWU4pWQ4pWQ4pWd4paI4paI4pWRICDilojilojilZHilojilojilojilojilZcgIOKWiOKWiOKVkSAgICDilojilojilZEgICDilojilojilZHilojilojilZTilZDilZDilZDilZDilZ3ilojilojilZTilZDilZDilZDilZDilZ3ilojilojilZTilZDilZDilojilojilZcgICAg4paI4paI4pWU4pWQ4pWQ4paI4paI4pWX4paI4paI4pWU4pWQ4pWQ4pWQ4paI4paI4pWX4paI4paI4pWU4pWQ4pWQ4pWQ4paI4paI4pWX4paI4paI4pWRXG7ilojilojilojilojilojilojilojilZHilojilojilZEgICDilojilojilZEgICDilojilojilZEgICDilojilojilojilojilojilojilojilZHilojilojilZTilojilojilZcg4paI4paI4pWRICAgIOKWiOKWiOKVkSAgIOKWiOKWiOKVkeKWiOKWiOKWiOKWiOKWiOKWiOKWiOKVl+KWiOKWiOKWiOKWiOKWiOKVlyAg4paI4paI4paI4paI4paI4paI4pWU4pWdICAgIOKWiOKWiOKWiOKWiOKWiOKWiOKVlOKVneKWiOKWiOKVkSAgIOKWiOKWiOKVkeKWiOKWiOKVkSAgIOKWiOKWiOKVkeKWiOKWiOKVkVxu4paI4paI4pWU4pWQ4pWQ4paI4paI4pWR4paI4paI4pWRICAg4paI4paI4pWRICAg4paI4paI4pWRICAg4paI4paI4pWU4pWQ4pWQ4paI4paI4pWR4paI4paI4pWR4pWa4paI4paI4pWX4paI4paI4pWRICAgIOKWiOKWiOKVkSAgIOKWiOKWiOKVkeKVmuKVkOKVkOKVkOKVkOKWiOKWiOKVkeKWiOKWiOKVlOKVkOKVkOKVnSAg4paI4paI4pWU4pWQ4pWQ4paI4paI4pWXICAgIOKWiOKWiOKVlOKVkOKVkOKVkOKVnSDilojilojilZEgICDilojilojilZHilojilojilZEgICDilojilojilZHilojilojilZFcbuKWiOKWiOKVkSAg4paI4paI4pWR4pWa4paI4paI4paI4paI4paI4paI4pWU4pWdICAg4paI4paI4pWRICAg4paI4paI4pWRICDilojilojilZHilojilojilZEg4pWa4paI4paI4paI4paI4pWRICAgIOKVmuKWiOKWiOKWiOKWiOKWiOKWiOKVlOKVneKWiOKWiOKWiOKWiOKWiOKWiOKWiOKVkeKWiOKWiOKWiOKWiOKWiOKWiOKWiOKVl+KWiOKWiOKVkSAg4paI4paI4pWRICAgIOKWiOKWiOKVkSAgICAg4pWa4paI4paI4paI4paI4paI4paI4pWU4pWd4pWa4paI4paI4paI4paI4paI4paI4pWU4pWd4paI4paI4paI4paI4paI4paI4paI4pWXXG7ilZrilZDilZ0gIOKVmuKVkOKVnSDilZrilZDilZDilZDilZDilZDilZ0gICAg4pWa4pWQ4pWdICAg4pWa4pWQ4pWdICDilZrilZDilZ3ilZrilZDilZ0gIOKVmuKVkOKVkOKVkOKVnSAgICAg4pWa4pWQ4pWQ4pWQ4pWQ4pWQ4pWdIOKVmuKVkOKVkOKVkOKVkOKVkOKVkOKVneKVmuKVkOKVkOKVkOKVkOKVkOKVkOKVneKVmuKVkOKVnSAg4pWa4pWQ4pWdICAgIOKVmuKVkOKVnSAgICAgIOKVmuKVkOKVkOKVkOKVkOKVkOKVnSAg4pWa4pWQ4pWQ4pWQ4pWQ4pWQ4pWdIOKVmuKVkOKVkOKVkOKVkOKVkOKVkOKVnVxuXG4gKi9cbiAgICBjb25zdCBwb29sQXV0aE4gPSBuZXcgY29nbml0by5Vc2VyUG9vbCh0aGlzLCBuYW1lLCB7XG4gICAgICBkZWxldGlvblByb3RlY3Rpb246IGZhbHNlLFxuICAgICAgdXNlclBvb2xOYW1lLFxuICAgICAgZW1haWw6IGNvZ25pdG8uVXNlclBvb2xFbWFpbC53aXRoQ29nbml0byhmcm9tRW1haWwpLFxuICAgICAgbWZhOiBjb2duaXRvLk1mYS5PUFRJT05BTCxcbiAgICAgIHNpZ25JbkNhc2VTZW5zaXRpdmU6IGZhbHNlLFxuICAgICAgc2lnbkluQWxpYXNlczoge1xuICAgICAgICBlbWFpbDogdHJ1ZVxuICAgICAgfSxcbiAgICAgIGFjY291bnRSZWNvdmVyeTogY29nbml0by5BY2NvdW50UmVjb3ZlcnkuRU1BSUxfT05MWSxcbiAgICAgIGF1dG9WZXJpZnk6IHtcbiAgICAgICAgZW1haWw6IHRydWVcbiAgICAgIH0sXG4gICAgICBzZWxmU2lnblVwRW5hYmxlZDogdHJ1ZSxcbiAgICAgIHN0YW5kYXJkQXR0cmlidXRlczoge1xuICAgICAgICBmYW1pbHlOYW1lOiB7XG4gICAgICAgICAgbXV0YWJsZTogdHJ1ZSxcbiAgICAgICAgICByZXF1aXJlZDogdHJ1ZVxuICAgICAgICB9LFxuICAgICAgICBnaXZlbk5hbWU6IHtcbiAgICAgICAgICBtdXRhYmxlOiB0cnVlLFxuICAgICAgICAgIHJlcXVpcmVkOiB0cnVlXG4gICAgICAgIH0sXG4gICAgICAgIGVtYWlsOiB7XG4gICAgICAgICAgbXV0YWJsZTogdHJ1ZSxcbiAgICAgICAgICByZXF1aXJlZDogdHJ1ZVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSlcbiAgICAvLyBEZWNsYXJlIHRoZSBjaGFubmVsLXN0YWJsZSBpZGVudGl0eSBvbiB0aGUgcG9vbCBpdHNlbGYgKG5ldmVyIHRoZSBzdGFjayDigJQgYSBzdGFjay13aWRlIHRhZ1xuICAgIC8vIGNvbGxhcHNlcyBldmVyeSByZXNvdXJjZSBvbnRvIG9uZSBpZCksIHNvIHRoZSBwYXJpdHkgZ2F0ZSBrZXlzIGl0IGJ5IGRlY2xhcmVkIGlkLiBUaGUgdGFnIGxhbmRzXG4gICAgLy8gaW4gdGhlIHBvb2wncyBVc2VyUG9vbFRhZ3M7IHRoZSBnYXRlIGVuZm9yY2VzIGl0IChhbiBpZC1sZXNzIHBvb2wgcmVhZHMgYXMgYSBkaXZlcmdlbmNlKS5cbiAgICBjZGsuVGFncy5vZihwb29sQXV0aE4pLmFkZCgnYXBpYWJsZTpsb2dpY2FsLWlkJywgQVVUSE5fUE9PTF9MT0dJQ0FMX0lEKVxuXG4gICAgY29uc3QgYWRtaW5TY29wZSA9IG5ldyBjb2duaXRvLlJlc291cmNlU2VydmVyU2NvcGUoe1xuICAgICAgICBzY29wZU5hbWU6ICdhZG1pbicsXG4gICAgICAgIHNjb3BlRGVzY3JpcHRpb246ICdGdWxsIEFjY2VzcyB0byB0aGUgQXBpYWJsZSBBUElzJyxcbiAgICAgIH1cbiAgICApXG5cbiAgICBjb25zdCByZWFkU2NvcGUgPSBuZXcgY29nbml0by5SZXNvdXJjZVNlcnZlclNjb3BlKHtcbiAgICAgICAgc2NvcGVOYW1lOiAncmVhZCcsXG4gICAgICAgIHNjb3BlRGVzY3JpcHRpb246ICdSZWFkIEFjY2VzcyB0byB0aGUgQXBpYWJsZSBBUElzJyxcbiAgICAgIH1cbiAgICApXG5cbiAgICBjb25zdCBjaWNkU2NvcGUgPSBuZXcgY29nbml0by5SZXNvdXJjZVNlcnZlclNjb3BlKHtcbiAgICAgICAgc2NvcGVOYW1lOiAnY2ljZCcsXG4gICAgICAgIHNjb3BlRGVzY3JpcHRpb246ICdDSUNEIEFjY2VzcyB0byB0aGUgQXBpYWJsZSBBUElzJyxcbiAgICAgIH1cbiAgICApXG5cbiAgICBjb25zdCByZXNvdXJjZVNlcnZlckF1dGhOID0gcG9vbEF1dGhOLmFkZFJlc291cmNlU2VydmVyKCdSZXNvdXJjZVNlcnZlcicsIHtcbiAgICAgIHVzZXJQb29sUmVzb3VyY2VTZXJ2ZXJOYW1lOiAnYXBpYWJsZScsXG4gICAgICBpZGVudGlmaWVyOiAnYXBpYWJsZScsXG4gICAgICBzY29wZXM6IFthZG1pblNjb3BlLCByZWFkU2NvcGUsIGNpY2RTY29wZV0sXG4gICAgfSlcblxuICAgIGxldCBkb21haW5QcmVmaXggPSBgYXBpYWJsZS0ke25hbWV9YFxuICAgIGlmIChuYW1lID09PSAnYXdzJykgZG9tYWluUHJlZml4ID0gJ2FwaWFibGUtYXctcycgLy8gYXdzIGlzIHJlc2VydmVyIG9uIGF3cyBhbmQgY2Fubm90IGJlIHVzZWRcbiAgICBwb29sQXV0aE4uYWRkRG9tYWluKCdDb2duaXRvRG9tYWluJywge2NvZ25pdG9Eb21haW46eyBkb21haW5QcmVmaXh9fSlcblxuICAgIGNvbnN0IGxvZ2luQ2xpZW50ID0gbmV3IGNvZ25pdG8uVXNlclBvb2xDbGllbnQodGhpcywgJ2xvZ2luJywge1xuICAgICAgdXNlclBvb2w6IHBvb2xBdXRoTixcbiAgICAgIHVzZXJQb29sQ2xpZW50TmFtZTogJ2xvZ2luJyxcbiAgICAgIHByZXZlbnRVc2VyRXhpc3RlbmNlRXJyb3JzOiB0cnVlLFxuICAgICAgYXV0aEZsb3dzOiB7IHVzZXJQYXNzd29yZDogbmFtZSA9PT0gJ2RldicsIHVzZXJTcnA6IHRydWUsIGN1c3RvbTogdHJ1ZSB9LFxuICAgICAgb0F1dGg6IHtcbiAgICAgICAgc2NvcGVzOiBbIGNvZ25pdG8uT0F1dGhTY29wZS5PUEVOSUQsIGNvZ25pdG8uT0F1dGhTY29wZS5FTUFJTCwgY29nbml0by5PQXV0aFNjb3BlLlBIT05FIF0sXG4gICAgICAgIGNhbGxiYWNrVXJscyxcbiAgICAgICAgbG9nb3V0VXJscyxcbiAgICAgIH0sXG4gICAgfSlcblxuICAgIGNvbnN0IGFwaUNsaWVudCA9IG5ldyBjb2duaXRvLlVzZXJQb29sQ2xpZW50KHRoaXMsICdhcGknLCB7XG4gICAgICB1c2VyUG9vbDogcG9vbEF1dGhOLFxuICAgICAgdXNlclBvb2xDbGllbnROYW1lOiAnYXBpJyxcbiAgICAgIGdlbmVyYXRlU2VjcmV0OiB0cnVlLFxuICAgICAgb0F1dGg6IHtcbiAgICAgICAgZmxvd3M6IHtcbiAgICAgICAgICBjbGllbnRDcmVkZW50aWFsczogdHJ1ZVxuICAgICAgICB9LFxuICAgICAgICBzY29wZXM6IFtcbiAgICAgICAgICBjb2duaXRvLk9BdXRoU2NvcGUucmVzb3VyY2VTZXJ2ZXIocmVzb3VyY2VTZXJ2ZXJBdXRoTiwgYWRtaW5TY29wZSksXG4gICAgICAgICAgY29nbml0by5PQXV0aFNjb3BlLnJlc291cmNlU2VydmVyKHJlc291cmNlU2VydmVyQXV0aE4sIHJlYWRTY29wZSlcbiAgICAgICAgXVxuICAgICAgfSxcbiAgICB9KVxuXG4gICAgY29uc3QgY2ljZENsaWVudCA9IG5ldyBjb2duaXRvLlVzZXJQb29sQ2xpZW50KHRoaXMsICdjaWNkJywge1xuICAgICAgdXNlclBvb2w6IHBvb2xBdXRoTixcbiAgICAgIHVzZXJQb29sQ2xpZW50TmFtZTogJ2NpY2QnLFxuICAgICAgZ2VuZXJhdGVTZWNyZXQ6IHRydWUsXG4gICAgICBvQXV0aDoge1xuICAgICAgICBmbG93czoge1xuICAgICAgICAgIGNsaWVudENyZWRlbnRpYWxzOiB0cnVlXG4gICAgICAgIH0sXG4gICAgICAgIHNjb3BlczogW1xuICAgICAgICAgIGNvZ25pdG8uT0F1dGhTY29wZS5yZXNvdXJjZVNlcnZlcihyZXNvdXJjZVNlcnZlckF1dGhOLCBjaWNkU2NvcGUpXG4gICAgICAgIF1cbiAgICAgIH0sXG4gICAgfSlcblxuICAgIGNvbnN0IGFzc3VtZWRCeSA9IGFjY291bnQgPT09ICcwMzQ0NDQ4Njk3NTUnPyBuZXcgaWFtLkFjY291bnRQcmluY2lwYWwoYWNjb3VudCkgOiBuZXcgaWFtLkNvbXBvc2l0ZVByaW5jaXBhbChcbiAgICAgIG5ldyBpYW0uQWNjb3VudFByaW5jaXBhbCgnMDM0NDQ0ODY5NzU1JyksXG4gICAgICBuZXcgaWFtLkFjY291bnRQcmluY2lwYWwoYWNjb3VudClcbiAgICApXG5cbiAgICBjb25zdCBhcGlhYmxlQ29nbml0b1NlcnZpY2VSb2xlQXV0aE4gPSBuZXcgaWFtLlJvbGUodGhpcywgJ0FwaWFibGVDb2duaXRvQXV0aE4nLCB7XG4gICAgICBhc3N1bWVkQnksXG4gICAgICByb2xlTmFtZTogYEFwaWFibGVDb2duaXRvQXV0aE4tJHt1c2VyUG9vbE5hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiBgQWRtaW4gUm9sZSBmb3IgQXBpYWJsZSB0byBtYW5hZ2UgdGhlIENvZ25pdG8gUG9vbCBmcm9tIERhc2hib2FyZCAoY3JlYXRlLCBkZWxldGUsIGludml0ZSB1c2VycywgZXRjLikgYW5kIFBvcnRhbCBBdXRoTiBmb3IgdXNlcnBvb2w6ICR7dXNlclBvb2xOYW1lfWAsXG4gICAgfSlcblxuICAgIGFwaWFibGVDb2duaXRvU2VydmljZVJvbGVBdXRoTi5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpjb2duaXRvLWlkcDoke3JlZ2lvbn06JHthY2NvdW50fTp1c2VycG9vbC8ke3Bvb2xBdXRoTi51c2VyUG9vbElkfWBdLFxuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgJ2NvZ25pdG8taWRwOionXG4gICAgICAgIF1cbiAgICAgIH0pXG4gICAgKVxuXG4gICAgLypcbiAgICAg4paI4paI4paI4paI4paI4pWXIOKWiOKWiOKVlyAgIOKWiOKWiOKVl+KWiOKWiOKWiOKWiOKWiOKWiOKWiOKWiOKVl+KWiOKWiOKVlyAg4paI4paI4pWX4paI4paI4paI4paI4paI4paI4paI4pWXICAgIOKWiOKWiOKVlyAgIOKWiOKWiOKVl+KWiOKWiOKWiOKWiOKWiOKWiOKWiOKVl+KWiOKWiOKWiOKWiOKWiOKWiOKWiOKVl+KWiOKWiOKWiOKWiOKWiOKWiOKVlyAgICAg4paI4paI4paI4paI4paI4paI4pWXICDilojilojilojilojilojilojilZcgIOKWiOKWiOKWiOKWiOKWiOKWiOKVlyDilojilojilZdcbiAgICDilojilojilZTilZDilZDilojilojilZfilojilojilZEgICDilojilojilZHilZrilZDilZDilojilojilZTilZDilZDilZ3ilojilojilZEgIOKWiOKWiOKVkeKVmuKVkOKVkOKWiOKWiOKWiOKVlOKVnSAgICDilojilojilZEgICDilojilojilZHilojilojilZTilZDilZDilZDilZDilZ3ilojilojilZTilZDilZDilZDilZDilZ3ilojilojilZTilZDilZDilojilojilZcgICAg4paI4paI4pWU4pWQ4pWQ4paI4paI4pWX4paI4paI4pWU4pWQ4pWQ4pWQ4paI4paI4pWX4paI4paI4pWU4pWQ4pWQ4pWQ4paI4paI4pWX4paI4paI4pWRXG4gICAg4paI4paI4paI4paI4paI4paI4paI4pWR4paI4paI4pWRICAg4paI4paI4pWRICAg4paI4paI4pWRICAg4paI4paI4paI4paI4paI4paI4paI4pWRICDilojilojilojilZTilZ0gICAgIOKWiOKWiOKVkSAgIOKWiOKWiOKVkeKWiOKWiOKWiOKWiOKWiOKWiOKWiOKVl+KWiOKWiOKWiOKWiOKWiOKVlyAg4paI4paI4paI4paI4paI4paI4pWU4pWdICAgIOKWiOKWiOKWiOKWiOKWiOKWiOKVlOKVneKWiOKWiOKVkSAgIOKWiOKWiOKVkeKWiOKWiOKVkSAgIOKWiOKWiOKVkeKWiOKWiOKVkVxuICAgIOKWiOKWiOKVlOKVkOKVkOKWiOKWiOKVkeKWiOKWiOKVkSAgIOKWiOKWiOKVkSAgIOKWiOKWiOKVkSAgIOKWiOKWiOKVlOKVkOKVkOKWiOKWiOKVkSDilojilojilojilZTilZ0gICAgICDilojilojilZEgICDilojilojilZHilZrilZDilZDilZDilZDilojilojilZHilojilojilZTilZDilZDilZ0gIOKWiOKWiOKVlOKVkOKVkOKWiOKWiOKVlyAgICDilojilojilZTilZDilZDilZDilZ0g4paI4paI4pWRICAg4paI4paI4pWR4paI4paI4pWRICAg4paI4paI4pWR4paI4paI4pWRXG4gICAg4paI4paI4pWRICDilojilojilZHilZrilojilojilojilojilojilojilZTilZ0gICDilojilojilZEgICDilojilojilZEgIOKWiOKWiOKVkeKWiOKWiOKWiOKWiOKWiOKWiOKWiOKVlyAgICDilZrilojilojilojilojilojilojilZTilZ3ilojilojilojilojilojilojilojilZHilojilojilojilojilojilojilojilZfilojilojilZEgIOKWiOKWiOKVkSAgICDilojilojilZEgICAgIOKVmuKWiOKWiOKWiOKWiOKWiOKWiOKVlOKVneKVmuKWiOKWiOKWiOKWiOKWiOKWiOKVlOKVneKWiOKWiOKWiOKWiOKWiOKWiOKWiOKVl1xuICAgIOKVmuKVkOKVnSAg4pWa4pWQ4pWdIOKVmuKVkOKVkOKVkOKVkOKVkOKVnSAgICDilZrilZDilZ0gICDilZrilZDilZ0gIOKVmuKVkOKVneKVmuKVkOKVkOKVkOKVkOKVkOKVkOKVnSAgICAg4pWa4pWQ4pWQ4pWQ4pWQ4pWQ4pWdIOKVmuKVkOKVkOKVkOKVkOKVkOKVkOKVneKVmuKVkOKVkOKVkOKVkOKVkOKVkOKVneKVmuKVkOKVnSAg4pWa4pWQ4pWdICAgIOKVmuKVkOKVnSAgICAgIOKVmuKVkOKVkOKVkOKVkOKVkOKVnSAg4pWa4pWQ4pWQ4pWQ4pWQ4pWQ4pWdIOKVmuKVkOKVkOKVkOKVkOKVkOKVkOKVnVxuICAgICovXG4gICAgY29uc3QgcG9vbEF1dGhaID0gbmV3IGNvZ25pdG8uVXNlclBvb2wodGhpcywgYCR7bmFtZX0tYXV0aHpgLCB7XG4gICAgICBkZWxldGlvblByb3RlY3Rpb246IGZhbHNlLFxuICAgICAgdXNlclBvb2xOYW1lOiBgJHt1c2VyUG9vbE5hbWV9LWF1dGh6YCxcbiAgICAgIG1mYTogY29nbml0by5NZmEuT0ZGLFxuICAgICAgc2lnbkluQ2FzZVNlbnNpdGl2ZTogZmFsc2UsXG4gICAgICBzaWduSW5BbGlhc2VzOiB7XG4gICAgICAgIHVzZXJuYW1lOiB0cnVlXG4gICAgICB9LFxuICAgICAgYWNjb3VudFJlY292ZXJ5OiBjb2duaXRvLkFjY291bnRSZWNvdmVyeS5OT05FLFxuICAgICAgc2VsZlNpZ25VcEVuYWJsZWQ6IGZhbHNlXG4gICAgfSlcbiAgICBjZGsuVGFncy5vZihwb29sQXV0aFopLmFkZCgnYXBpYWJsZTpsb2dpY2FsLWlkJywgQVVUSFpfUE9PTF9MT0dJQ0FMX0lEKVxuXG4gICAgY29uc3QgbCA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0Z1bmN0aW9uJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiBgJHt1c2VyUG9vbE5hbWV9LWF1dGhgLFxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4vYXNzZXRzL2xhbWJkYXMvcHJlLXRva2VuLWdlbmVyYXRpb24tYXV0aHonKSksXG4gICAgfSlcbiAgICBjZGsuVGFncy5vZihsKS5hZGQoJ2FwaWFibGU6bG9naWNhbC1pZCcsIFBSRV9UT0tFTl9GVU5DVElPTl9MT0dJQ0FMX0lEKVxuICAgIHBvb2xBdXRoWi5hZGRUcmlnZ2VyKGNvZ25pdG8uVXNlclBvb2xPcGVyYXRpb24uUFJFX1RPS0VOX0dFTkVSQVRJT05fQ09ORklHLCBsLCBjb2duaXRvLkxhbWJkYVZlcnNpb24uVjFfMClcblxuICAgIGNvbnN0IGF1dGhaYWRtaW5TY29wZSA9IG5ldyBjb2duaXRvLlJlc291cmNlU2VydmVyU2NvcGUoe1xuICAgICAgICBzY29wZU5hbWU6ICdhZG1pbicsXG4gICAgICAgIHNjb3BlRGVzY3JpcHRpb246ICdGdWxsIEFjY2VzcyB0byB0aGUgQXBpYWJsZSBBUElzJyxcbiAgICAgIH1cbiAgICApXG5cbiAgICBjb25zdCByZXNvdXJjZVNlcnZlckF1dGhaID0gcG9vbEF1dGhaLmFkZFJlc291cmNlU2VydmVyKCdSZXNvdXJjZVNlcnZlcicsIHtcbiAgICAgIHVzZXJQb29sUmVzb3VyY2VTZXJ2ZXJOYW1lOiAnYXBpYWJsZScsXG4gICAgICBpZGVudGlmaWVyOiAnYXBpYWJsZScsXG4gICAgICBzY29wZXM6IFthdXRoWmFkbWluU2NvcGVdLFxuICAgIH0pXG5cbiAgICBjb25zdCBhdXRoekNsaWVudCA9IG5ldyBjb2duaXRvLlVzZXJQb29sQ2xpZW50KHRoaXMsICdhdXRoeicsIHtcbiAgICAgIHVzZXJQb29sOiBwb29sQXV0aFosXG4gICAgICB1c2VyUG9vbENsaWVudE5hbWU6ICdhdXRoeicsXG4gICAgICBnZW5lcmF0ZVNlY3JldDogdHJ1ZSxcbiAgICAgIGF1dGhGbG93czogeyB1c2VyUGFzc3dvcmQ6IHRydWUsIHVzZXJTcnA6IHRydWUsIGN1c3RvbTogdHJ1ZSB9LFxuICAgICAgb0F1dGg6IHtcbiAgICAgICAgZmxvd3M6IHtcbiAgICAgICAgICBjbGllbnRDcmVkZW50aWFsczogdHJ1ZVxuICAgICAgICB9LFxuICAgICAgICBzY29wZXM6IFtcbiAgICAgICAgICBjb2duaXRvLk9BdXRoU2NvcGUucmVzb3VyY2VTZXJ2ZXIocmVzb3VyY2VTZXJ2ZXJBdXRoWiwgYXV0aFphZG1pblNjb3BlKVxuICAgICAgICBdXG4gICAgICB9LFxuICAgIH0pXG5cbiAgICBjb25zdCBhcGlhYmxlQ29nbml0b1NlcnZpY2VSb2xlQXV0aFogPSBuZXcgaWFtLlJvbGUodGhpcywgJ0FwaWFibGVDb2duaXRvQXV0aFonLCB7XG4gICAgICBhc3N1bWVkQnksXG4gICAgICByb2xlTmFtZTogYEFwaWFibGVDb2duaXRvQXV0aFotJHt1c2VyUG9vbE5hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiBgQWRtaW4gUm9sZSBmb3IgQXBpYWJsZSB0byBtYW5hZ2UgdGhlIENvZ25pdG8gUG9vbCBmcm9tIERhc2hib2FyZCAoY3JlYXRlLCBkZWxldGUsIHRva2VucywgZXRjLikgYW5kIFBvcnRhbCBBdXRoWiBmb3IgdXNlcnBvb2w6ICR7dXNlclBvb2xOYW1lfWAsXG4gICAgfSlcblxuICAgIGNvbnN0IHJ3QXV0aFpQb2xpY3kgPSBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpjb2duaXRvLWlkcDoke3JlZ2lvbn06JHthY2NvdW50fTp1c2VycG9vbC8ke3Bvb2xBdXRoWi51c2VyUG9vbElkfWBdLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnY29nbml0by1pZHA6KidcbiAgICAgIF1cbiAgICB9KVxuXG4gICAgYXBpYWJsZUNvZ25pdG9TZXJ2aWNlUm9sZUF1dGhaLmFkZFRvUG9saWN5KHJ3QXV0aFpQb2xpY3kpXG5cbiAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsIGAke3VzZXJQb29sTmFtZX0wMEFQSUFCTEUwMEFXUzAwQVVUSE4wMFJPTEUwMEFSTmAsIHtcbiAgICAgIGV4cG9ydE5hbWU6IGAke3VzZXJQb29sTmFtZX0wMEFQSUFCTEUwMEFXUzAwQVVUSE4wMFJPTEUwMEFSTmAsXG4gICAgICB2YWx1ZTogYXBpYWJsZUNvZ25pdG9TZXJ2aWNlUm9sZUF1dGhOLnJvbGVBcm5cbiAgICB9KTtcblxuICAgIG5ldyBDZm5PdXRwdXQodGhpcywgYCR7dXNlclBvb2xOYW1lfTAwQVBJQUJMRTAwQVdTMDBBVVRITjAwUkVHSU9OYCwge1xuICAgICAgZXhwb3J0TmFtZTogYCR7dXNlclBvb2xOYW1lfTAwQVBJQUJMRTAwQVdTMDBBVVRITjAwUkVHSU9OYCxcbiAgICAgIHZhbHVlOiByZWdpb25cbiAgICB9KTtcblxuICAgIG5ldyBDZm5PdXRwdXQodGhpcywgYCR7dXNlclBvb2xOYW1lfTAwQVBJQUJMRTAwQVdTMDBBVVRITjAwVVNFUlBPT0xJRGAsIHtcbiAgICAgIGV4cG9ydE5hbWU6IGAke3VzZXJQb29sTmFtZX0wMEFQSUFCTEUwMEFXUzAwQVVUSE4wMFVTRVJQT09MSURgLFxuICAgICAgdmFsdWU6IHBvb2xBdXRoTi51c2VyUG9vbElkXG4gICAgfSk7XG5cbiAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsIGAke3VzZXJQb29sTmFtZX0wMEFQSUFCTEUwMEFXUzAwQVVUSE4wMElTU1VFUjAwVVJJYCwge1xuICAgICAgZXhwb3J0TmFtZTogYCR7dXNlclBvb2xOYW1lfTAwQVBJQUJMRTAwQVdTMDBBVVRITjAwSVNTVUVSMDBVUklgLFxuICAgICAgdmFsdWU6IGBodHRwczovL2NvZ25pdG8wMGlkcC4ke3JlZ2lvbn0uYW1hem9uYXdzLmNvbS8ke3Bvb2xBdXRoTi51c2VyUG9vbElkfWBcbiAgICB9KTtcblxuICAgIG5ldyBDZm5PdXRwdXQodGhpcywgYCR7dXNlclBvb2xOYW1lfTAwQVBJQUJMRTAwQVdTMDBBVVRITjAwRE9NQUlOYCwge1xuICAgICAgZXhwb3J0TmFtZTogYCR7dXNlclBvb2xOYW1lfTAwQVBJQUJMRTAwQVdTMDBBVVRITjAwRE9NQUlOYCxcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly8ke2RvbWFpblByZWZpeH0uYXV0aC4ke3JlZ2lvbn0uYW1hem9uY29nbml0by5jb21gXG4gICAgfSk7XG5cbiAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsIGAke3VzZXJQb29sTmFtZX0wMEFQSUFCTEUwMEFXUzAwQVVUSE4wMENMSUVOVFMwMExPR0lOMDBJRGAsIHtcbiAgICAgIGV4cG9ydE5hbWU6IGAke3VzZXJQb29sTmFtZX0wMEFQSUFCTEUwMEFXUzAwQVVUSE4wMENMSUVOVFMwMExPR0lOMDBJRGAsXG4gICAgICB2YWx1ZTogbG9naW5DbGllbnQudXNlclBvb2xDbGllbnRJZFxuICAgIH0pO1xuXG4gICAgbmV3IENmbk91dHB1dCh0aGlzLCBgJHt1c2VyUG9vbE5hbWV9MDBBUElBQkxFMDBBV1MwMEFVVEhOMDBDTElFTlRTMDBBUEkwMElEYCwge1xuICAgICAgZXhwb3J0TmFtZTogYCR7dXNlclBvb2xOYW1lfTAwQVBJQUJMRTAwQVdTMDBBVVRITjAwQ0xJRU5UUzAwQVBJMDBJRGAsXG4gICAgICB2YWx1ZTogYXBpQ2xpZW50LnVzZXJQb29sQ2xpZW50SWRcbiAgICB9KTtcblxuICAgIG5ldyBDZm5PdXRwdXQodGhpcywgYCR7dXNlclBvb2xOYW1lfTAwQVBJQUJMRTAwQVdTMDBBVVRITjAwQ0xJRU5UUzAwQVBJMDBTRUNSRVRgLCB7XG4gICAgICBleHBvcnROYW1lOiBgJHt1c2VyUG9vbE5hbWV9MDBBUElBQkxFMDBBV1MwMEFVVEhOMDBDTElFTlRTMDBBUEkwMFNFQ1JFVGAsXG4gICAgICB2YWx1ZTogYXBpQ2xpZW50LnVzZXJQb29sQ2xpZW50U2VjcmV0LnVuc2FmZVVud3JhcCgpXG4gICAgfSk7XG5cbiAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsIGAke3VzZXJQb29sTmFtZX0wMEFQSUFCTEUwMEFXUzAwQVVUSE4wMENMSUVOVFMwMENJQ0QwMElEYCwge1xuICAgICAgZXhwb3J0TmFtZTogYCR7dXNlclBvb2xOYW1lfTAwQVBJQUJMRTAwQVdTMDBBVVRITjAwQ0xJRU5UUzAwQ0lDRDAwSURgLFxuICAgICAgdmFsdWU6IGNpY2RDbGllbnQudXNlclBvb2xDbGllbnRJZFxuICAgIH0pO1xuXG4gICAgbmV3IENmbk91dHB1dCh0aGlzLCBgJHt1c2VyUG9vbE5hbWV9MDBBUElBQkxFMDBBV1MwMEFVVEhOMDBDTElFTlRTMDBDSUNEMDBTRUNSRVRgLCB7XG4gICAgICBleHBvcnROYW1lOiBgJHt1c2VyUG9vbE5hbWV9MDBBUElBQkxFMDBBV1MwMEFVVEhOMDBDTElFTlRTMDBDSUNEMDBTRUNSRVRgLFxuICAgICAgdmFsdWU6IGNpY2RDbGllbnQudXNlclBvb2xDbGllbnRTZWNyZXQudW5zYWZlVW53cmFwKClcbiAgICB9KTtcblxuICAgIG5ldyBDZm5PdXRwdXQodGhpcywgYCR7dXNlclBvb2xOYW1lfTAwQVBJQUJMRTAwQVdTMDBBVVRIWjAwUk9MRTAwQVJOYCwge1xuICAgICAgZXhwb3J0TmFtZTogYCR7dXNlclBvb2xOYW1lfTAwQVBJQUJMRTAwQVdTMDBBVVRIWjAwUk9MRTAwQVJOYCxcbiAgICAgIHZhbHVlOiBhcGlhYmxlQ29nbml0b1NlcnZpY2VSb2xlQXV0aFoucm9sZUFyblxuICAgIH0pO1xuXG4gICAgbmV3IENmbk91dHB1dCh0aGlzLCBgJHt1c2VyUG9vbE5hbWV9MDBBUElBQkxFMDBBV1MwMEFVVEhaMDBSRUdJT05gLCB7XG4gICAgICBleHBvcnROYW1lOiBgJHt1c2VyUG9vbE5hbWV9MDBBUElBQkxFMDBBV1MwMEFVVEhaMDBSRUdJT05gLFxuICAgICAgdmFsdWU6IHJlZ2lvblxuICAgIH0pO1xuXG4gICAgbmV3IENmbk91dHB1dCh0aGlzLCBgJHt1c2VyUG9vbE5hbWV9MDBBUElBQkxFMDBBV1MwMEFVVEhaMDBVU0VSUE9PTElEYCwge1xuICAgICAgZXhwb3J0TmFtZTogYCR7dXNlclBvb2xOYW1lfTAwQVBJQUJMRTAwQVdTMDBBVVRIWjAwVVNFUlBPT0xJRGAsXG4gICAgICB2YWx1ZTogcG9vbEF1dGhaLnVzZXJQb29sSWRcbiAgICB9KTtcblxuICAgIG5ldyBDZm5PdXRwdXQodGhpcywgYCR7dXNlclBvb2xOYW1lfTAwQVBJQUJMRTAwQVdTMDBBVVRIWjAwSVNTVUVSMDBVUklgLCB7XG4gICAgICBleHBvcnROYW1lOiBgJHt1c2VyUG9vbE5hbWV9MDBBUElBQkxFMDBBV1MwMEFVVEhaMDBJU1NVRVIwMFVSSWAsXG4gICAgICB2YWx1ZTogYGh0dHBzOi8vY29nbml0bzAwaWRwLiR7cmVnaW9ufS5hbWF6b25hd3MuY29tLyR7cG9vbEF1dGhaLnVzZXJQb29sSWR9YFxuICAgIH0pO1xuXG4gICAgbmV3IENmbk91dHB1dCh0aGlzLCBgJHt1c2VyUG9vbE5hbWV9MDBBUElBQkxFMDBBV1MwMEFVVEhaMDBET01BSU5gLCB7XG4gICAgICBleHBvcnROYW1lOiBgJHt1c2VyUG9vbE5hbWV9MDBBUElBQkxFMDBBV1MwMEFVVEhaMDBET01BSU5gLFxuICAgICAgdmFsdWU6IGBodHRwczovLyR7ZG9tYWluUHJlZml4fXouYXV0aC4ke3JlZ2lvbn0uYW1hem9uY29nbml0by5jb21gXG4gICAgfSk7XG5cbiAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsIGAke3VzZXJQb29sTmFtZX0wMEFQSUFCTEUwMEFXUzAwQVVUSFowMENMSUVOVFMwMEFVVEhaMDBJRGAsIHtcbiAgICAgIGV4cG9ydE5hbWU6IGAke3VzZXJQb29sTmFtZX0wMEFQSUFCTEUwMEFXUzAwQVVUSFowMENMSUVOVFMwMEFVVEhaMDBJRGAsXG4gICAgICB2YWx1ZTogYXV0aHpDbGllbnQudXNlclBvb2xDbGllbnRJZFxuICAgIH0pO1xuXG4gICAgbmV3IENmbk91dHB1dCh0aGlzLCBgJHt1c2VyUG9vbE5hbWV9MDBBUElBQkxFMDBBV1MwMEFVVEhaMDBDTElFTlRTMDBBVVRIWjAwU0VDUkVUYCwge1xuICAgICAgZXhwb3J0TmFtZTogYCR7dXNlclBvb2xOYW1lfTAwQVBJQUJMRTAwQVdTMDBBVVRIWjAwQ0xJRU5UUzAwQVVUSFowMFNFQ1JFVGAsXG4gICAgICB2YWx1ZTogYXV0aHpDbGllbnQudXNlclBvb2xDbGllbnRTZWNyZXQudW5zYWZlVW53cmFwKClcbiAgICB9KTtcblxuXG4gIH1cbn1cbiJdfQ==