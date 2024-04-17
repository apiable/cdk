import * as cdk from 'aws-cdk-lib'
import { Stack } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as iam from 'aws-cdk-lib/aws-iam'
import { fromContextOrDefault, fromContextOrError } from './utils'


export class Cognito extends Stack {

  constructor(scope: Construct, id: string, props: cdk.StackProps) {

    super(scope, id, props)
    const region = props.env?.region || 'undefined'
    const stackname = fromContextOrError(this.node, 'stackname')
    const domain = fromContextOrDefault(this.node, 'domain', `${stackname}.apiable.io`)
    const fromEmail = fromContextOrDefault(this.node, 'from-email', 'info@apiable.io')
    const replyTo = fromEmail
    const sesVerifiedDomain = fromContextOrDefault(this.node, 'ses-verified-domain', null)
    const userPoolName = `portal-${stackname}`

    console.log("Creating Cognito Pool for stack: ", stackname)
    console.log("User Pool Name is: ", userPoolName)
    const sesConfig: cognito.UserPoolSESOptions = sesVerifiedDomain ?{ fromEmail, replyTo }:{ fromEmail, replyTo, sesVerifiedDomain }

    const pool = new cognito.UserPool(this, stackname, {
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

    pool.addClient('login', {
      userPoolClientName: 'login',
      oAuth: {
        scopes: [ cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PHONE ],
        callbackUrls: [ 'http://localhost:3000', `https://${domain}` ],
        logoutUrls: [ 'http://localhost:3000', `https://${domain}` ],
      },
    })

    const adminScope = new cognito.ResourceServerScope({
        scopeName: 'admin',
        scopeDescription: 'Full Access to the Apiable APIs',
      }
    )

    const cicdScope = new cognito.ResourceServerScope({
        scopeName: 'cicd',
        scopeDescription: 'CICD Access to the Apiable APIs',
      }
    )

    const subscriptionScope = new cognito.ResourceServerScope({
        scopeName: 'subscription',
        scopeDescription: 'Scope for Subscription keys generated through Portal.',
      }
    )

    const resourceServer = pool.addResourceServer('ResourceServer', {
      userPoolResourceServerName: 'apiable',
      identifier: 'apiable',
      scopes: [adminScope, cicdScope, subscriptionScope],
    })

    pool.addDomain('CognitoDomain', {cognitoDomain:{ domainPrefix: `apiable-${stackname}`}})

    pool.addClient('api', {
      userPoolClientName: 'api',
      generateSecret: true,
      oAuth: {
        flows: {
          clientCredentials: true
        },
        scopes: [
          cognito.OAuthScope.resourceServer(resourceServer, adminScope),
          cognito.OAuthScope.resourceServer(resourceServer, cicdScope),
          cognito.OAuthScope.resourceServer(resourceServer, subscriptionScope)
        ]
      },
    })

    const apiableCognitoServiceRole = new iam.Role(this, 'ApiableCognito', {
      assumedBy: new iam.AccountPrincipal('034444869755'),
      roleName: `ApiableCognito-${userPoolName}`,
      description: `Admin Role for Apiable to manage the Cognito Pool from Dashboard (create, delete, invite users, etc.) and Portal (Auth/Authz) for userpool: ${userPoolName}`,
    })

    apiableCognitoServiceRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [`arn:aws:cognito-idp:${region}:034444869755:userpool/${pool.userPoolId}`],
        actions: [
          'cognito-idp:*'
        ]
      })
    )

  }
}
