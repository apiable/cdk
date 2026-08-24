import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as iam from 'aws-cdk-lib/aws-iam'
import { fromContextOrDefault, fromContextOrError } from './utils'
import * as path from 'path'
import {CfnOutput} from "aws-cdk-lib";

/**
 * The managed Node runtime the lambdas in this repo target. `nodejs20.x` was deprecated on
 * 2026-04-30, with creation disabled from 2027-02-01 and updates from 2027-03-03, so a customer
 * one-clicking a template that still named it would eventually get a stack that will not create.
 *
 * Built by hand rather than taken from `lambda.Runtime`, because aws-cdk-lib 2.137.0 predates the
 * constant (its newest is NODEJS_20_X) and that version is pinned as a peerDependency of every
 * construct package, so moving off it is its own change. Constructing a Runtime directly is CDK's
 * supported escape hatch for exactly this. The Terraform channel names the same string literally.
 */
const NODEJS_RUNTIME = new lambda.Runtime('nodejs22.x', lambda.RuntimeFamily.NODEJS, {
  // mirrors how aws-cdk-lib declares its own managed node runtimes; without it CDK refuses
  // `Code.fromInline` with "Inline source not allowed for nodejs22.x"
  supportsInlineCode: true,
})

/**
 * Author-declared, channel-identical identities the release-time parity gate keys the cognito pools and
 * the pre-token function on (the `apiable:logical-id` tag), so each compares equal across the CDK,
 * published-CFN, and Terraform channels regardless of its generated name, account, region, or tenant
 * segment. The hand-rolled Terraform module declares the identical literals; an enforced pool that omits
 * the tag surfaces as an explicit parity divergence rather than being inferred from its name.
 */
export const AUTHN_POOL_LOGICAL_ID = 'apiable-authn-pool'
export const AUTHZ_POOL_LOGICAL_ID = 'apiable-authz-pool'
export const PRE_TOKEN_FUNCTION_LOGICAL_ID = 'apiable-pretoken-fn'

export interface Env extends cdk.StackProps {
  account: string;
  region: string;
  name: string;
  domain?: string;
  fromEmail?: string;
}
export interface Props extends cdk.StackProps {
  env: Env;
}

export class Cognito extends cdk.Stack {

  constructor(scope: Construct, id: string, props: Props) {

    super(scope, id, props)
    const { account, region, name, domain: domainProp, fromEmail: fromEmailProp} = props.env

    const fromEmail = fromEmailProp || 'no-reply@verificationemail.com'
    const replyTo = fromEmail
    const domain = domainProp || `${name}.apiable.io`
    const userPoolName = `portal-${name}`

    console.log("Creating Cognito Pool for stack: ", name)
    console.log("User Pool Name is: ", userPoolName)
    const callbackUrls = ['http://localhost:3000', `https://${domain}/api/oauth2/oauth-token` ]
    const logoutUrls = callbackUrls

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
    })
    // Declare the channel-stable identity on the pool itself (never the stack — a stack-wide tag
    // collapses every resource onto one id), so the parity gate keys it by declared id. The tag lands
    // in the pool's UserPoolTags; the gate enforces it (an id-less pool reads as a divergence).
    cdk.Tags.of(poolAuthN).add('apiable:logical-id', AUTHN_POOL_LOGICAL_ID)

    const adminScope = new cognito.ResourceServerScope({
        scopeName: 'admin',
        scopeDescription: 'Full Access to the Apiable APIs',
      }
    )

    const readScope = new cognito.ResourceServerScope({
        scopeName: 'read',
        scopeDescription: 'Read Access to the Apiable APIs',
      }
    )

    const cicdScope = new cognito.ResourceServerScope({
        scopeName: 'cicd',
        scopeDescription: 'CICD Access to the Apiable APIs',
      }
    )

    const resourceServerAuthN = poolAuthN.addResourceServer('ResourceServer', {
      userPoolResourceServerName: 'apiable',
      identifier: 'apiable',
      scopes: [adminScope, readScope, cicdScope],
    })

    let domainPrefix = `apiable-${name}`
    if (name === 'aws') domainPrefix = 'apiable-aw-s' // aws is reserver on aws and cannot be used
    poolAuthN.addDomain('CognitoDomain', {cognitoDomain:{ domainPrefix}})

    const loginClient = new cognito.UserPoolClient(this, 'login', {
      userPool: poolAuthN,
      userPoolClientName: 'login',
      preventUserExistenceErrors: true,
      authFlows: { userPassword: name === 'dev', userSrp: true, custom: true },
      oAuth: {
        scopes: [ cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PHONE ],
        callbackUrls,
        logoutUrls,
      },
    })

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
    })

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
    })

    const assumedBy = account === '034444869755'? new iam.AccountPrincipal(account) : new iam.CompositePrincipal(
      new iam.AccountPrincipal('034444869755'),
      new iam.AccountPrincipal(account)
    )

    const apiableCognitoServiceRoleAuthN = new iam.Role(this, 'ApiableCognitoAuthN', {
      assumedBy,
      roleName: `ApiableCognitoAuthN-${userPoolName}`,
      description: `Admin Role for Apiable to manage the Cognito Pool from Dashboard (create, delete, invite users, etc.) and Portal AuthN for userpool: ${userPoolName}`,
    })

    apiableCognitoServiceRoleAuthN.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [`arn:aws:cognito-idp:${region}:${account}:userpool/${poolAuthN.userPoolId}`],
        actions: [
          'cognito-idp:*'
        ]
      })
    )

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
    })
    cdk.Tags.of(poolAuthZ).add('apiable:logical-id', AUTHZ_POOL_LOGICAL_ID)

    const l = new lambda.Function(this, 'Function', {
      functionName: `${userPoolName}-auth`,
      runtime: NODEJS_RUNTIME,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, './assets/lambdas/pre-token-generation-authz')),
    })
    cdk.Tags.of(l).add('apiable:logical-id', PRE_TOKEN_FUNCTION_LOGICAL_ID)
    poolAuthZ.addTrigger(cognito.UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG, l, cognito.LambdaVersion.V1_0)

    const authZadminScope = new cognito.ResourceServerScope({
        scopeName: 'admin',
        scopeDescription: 'Full Access to the Apiable APIs',
      }
    )

    const resourceServerAuthZ = poolAuthZ.addResourceServer('ResourceServer', {
      userPoolResourceServerName: 'apiable',
      identifier: 'apiable',
      scopes: [authZadminScope],
    })

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
    })

    const apiableCognitoServiceRoleAuthZ = new iam.Role(this, 'ApiableCognitoAuthZ', {
      assumedBy,
      roleName: `ApiableCognitoAuthZ-${userPoolName}`,
      description: `Admin Role for Apiable to manage the Cognito Pool from Dashboard (create, delete, tokens, etc.) and Portal AuthZ for userpool: ${userPoolName}`,
    })

    const rwAuthZPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [`arn:aws:cognito-idp:${region}:${account}:userpool/${poolAuthZ.userPoolId}`],
      actions: [
        'cognito-idp:*'
      ]
    })

    apiableCognitoServiceRoleAuthZ.addToPolicy(rwAuthZPolicy)

    new CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHN00ROLE00ARN`, {
      exportName: `${userPoolName}00APIABLE00AWS00AUTHN00ROLE00ARN`,
      value: apiableCognitoServiceRoleAuthN.roleArn
    });

    new CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHN00REGION`, {
      exportName: `${userPoolName}00APIABLE00AWS00AUTHN00REGION`,
      value: region
    });

    new CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHN00USERPOOLID`, {
      exportName: `${userPoolName}00APIABLE00AWS00AUTHN00USERPOOLID`,
      value: poolAuthN.userPoolId
    });

    new CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHN00ISSUER00URI`, {
      exportName: `${userPoolName}00APIABLE00AWS00AUTHN00ISSUER00URI`,
      value: `https://cognito00idp.${region}.amazonaws.com/${poolAuthN.userPoolId}`
    });

    new CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHN00DOMAIN`, {
      exportName: `${userPoolName}00APIABLE00AWS00AUTHN00DOMAIN`,
      value: `https://${domainPrefix}.auth.${region}.amazoncognito.com`
    });

    new CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHN00CLIENTS00LOGIN00ID`, {
      exportName: `${userPoolName}00APIABLE00AWS00AUTHN00CLIENTS00LOGIN00ID`,
      value: loginClient.userPoolClientId
    });

    new CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHN00CLIENTS00API00ID`, {
      exportName: `${userPoolName}00APIABLE00AWS00AUTHN00CLIENTS00API00ID`,
      value: apiClient.userPoolClientId
    });

    new CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHN00CLIENTS00API00SECRET`, {
      exportName: `${userPoolName}00APIABLE00AWS00AUTHN00CLIENTS00API00SECRET`,
      value: apiClient.userPoolClientSecret.unsafeUnwrap()
    });

    new CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHN00CLIENTS00CICD00ID`, {
      exportName: `${userPoolName}00APIABLE00AWS00AUTHN00CLIENTS00CICD00ID`,
      value: cicdClient.userPoolClientId
    });

    new CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHN00CLIENTS00CICD00SECRET`, {
      exportName: `${userPoolName}00APIABLE00AWS00AUTHN00CLIENTS00CICD00SECRET`,
      value: cicdClient.userPoolClientSecret.unsafeUnwrap()
    });

    new CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHZ00ROLE00ARN`, {
      exportName: `${userPoolName}00APIABLE00AWS00AUTHZ00ROLE00ARN`,
      value: apiableCognitoServiceRoleAuthZ.roleArn
    });

    new CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHZ00REGION`, {
      exportName: `${userPoolName}00APIABLE00AWS00AUTHZ00REGION`,
      value: region
    });

    new CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHZ00USERPOOLID`, {
      exportName: `${userPoolName}00APIABLE00AWS00AUTHZ00USERPOOLID`,
      value: poolAuthZ.userPoolId
    });

    new CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHZ00ISSUER00URI`, {
      exportName: `${userPoolName}00APIABLE00AWS00AUTHZ00ISSUER00URI`,
      value: `https://cognito00idp.${region}.amazonaws.com/${poolAuthZ.userPoolId}`
    });

    new CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHZ00DOMAIN`, {
      exportName: `${userPoolName}00APIABLE00AWS00AUTHZ00DOMAIN`,
      value: `https://${domainPrefix}z.auth.${region}.amazoncognito.com`
    });

    new CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHZ00CLIENTS00AUTHZ00ID`, {
      exportName: `${userPoolName}00APIABLE00AWS00AUTHZ00CLIENTS00AUTHZ00ID`,
      value: authzClient.userPoolClientId
    });

    new CfnOutput(this, `${userPoolName}00APIABLE00AWS00AUTHZ00CLIENTS00AUTHZ00SECRET`, {
      exportName: `${userPoolName}00APIABLE00AWS00AUTHZ00CLIENTS00AUTHZ00SECRET`,
      value: authzClient.userPoolClientSecret.unsafeUnwrap()
    });


  }
}
