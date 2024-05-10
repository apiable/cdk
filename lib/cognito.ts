import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as iam from 'aws-cdk-lib/aws-iam'
import { fromContextOrDefault, fromContextOrError } from './utils'
import * as path from 'path'


export class Cognito extends cdk.Stack {

  constructor(scope: Construct, id: string, props: cdk.StackProps) {

    super(scope, id, props)
    const region = props.env?.region || 'undefined'
    const account = props.env?.account || 'undefined'
    const stackname = fromContextOrError(this.node, 'stackname')
    const domain = fromContextOrDefault(this.node, 'domain', `${stackname}.apiable.io`)
    const fromEmail = fromContextOrDefault(this.node, 'from-email', 'info@apiable.io')
    const replyTo = fromEmail
    const sesVerifiedDomain = fromContextOrDefault(this.node, 'ses-verified-domain', null)
    const userPoolName = `portal-${stackname}`

    console.log("Creating Cognito Pool for stack: ", stackname)
    console.log("User Pool Name is: ", userPoolName)
    const sesConfig: cognito.UserPoolSESOptions = sesVerifiedDomain ?{ fromEmail, replyTo }:{ fromEmail, replyTo, sesVerifiedDomain }
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
    const poolAuthN = new cognito.UserPool(this, stackname, {
      deletionProtection: false,
      userPoolName,
      email: cognito.UserPoolEmail.withSES(sesConfig),
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

    let domainPrefix = `apiable-${stackname}`
    if (stackname === 'aws') domainPrefix = 'apiable-aw-s' // aws is reserver on aws and cannot be used
    poolAuthN.addDomain('CognitoDomain', {cognitoDomain:{ domainPrefix}})

    poolAuthN.addClient('login', {
      userPoolClientName: 'login',
      preventUserExistenceErrors: true,
      authFlows: { userPassword: stackname === 'dev', userSrp: true, custom: true },
      oAuth: {
        scopes: [ cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PHONE ],
        callbackUrls,
        logoutUrls,
      },
    })

    poolAuthN.addClient('api', {
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

    poolAuthN.addClient('cicd', {
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

    const apiableCognitoServiceRoleAuthN = new iam.Role(this, 'ApiableCognitoAuthN', {
      assumedBy: new iam.AccountPrincipal('034444869755'),
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
    const poolAuthZ = new cognito.UserPool(this, `${stackname}-authz`, {
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

    const l = new lambda.Function(this, 'Function', {
      functionName: `${userPoolName}-auth`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, './assets/lambdas/pre-token-generation-authz')),
    })
    poolAuthZ.addTrigger(cognito.UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG, l, cognito.LambdaVersion.V1_0)

    poolAuthZ.addClient('authz', {
      userPoolClientName: 'authz',
      generateSecret: true,
      authFlows: { userPassword: true },
      idTokenValidity: cdk.Duration.days(1),
      refreshTokenValidity: cdk.Duration.days(60),
      oAuth: {
        flows: {
          implicitCodeGrant: true,
          authorizationCodeGrant: true
        },
        callbackUrls
      },
    })

    const apiableCognitoServiceRoleAuthZ = new iam.Role(this, 'ApiableCognitoAuthZ', {
      assumedBy: new iam.AccountPrincipal('034444869755'),
      roleName: `ApiableCognitoAuthZ-${userPoolName}`,
      description: `Admin Role for Apiable to manage the Cognito Pool from Dashboard (create, delete, tokens, etc.) and Portal AuthZ for userpool: ${userPoolName}`,
    })

    apiableCognitoServiceRoleAuthZ.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [`arn:aws:cognito-idp:${region}:${account}:userpool/${poolAuthZ.userPoolId}`],
        actions: [
          'cognito-idp:*'
        ]
      })
    )

  }
}
