import * as cdk from 'aws-cdk-lib';
import {RemovalPolicy} from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';
import {Construct} from 'constructs';
import * as path from 'path';

interface GptProxyPropsEnv extends cdk.StackProps {
  account: string;
  region: string;
  stackname: string;
  apikey: string;
  assistantId: string;
}
interface GptProxyProps extends cdk.StackProps {
  env: GptProxyPropsEnv;
}

export class GptProxy extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GptProxyProps) {
    super(scope, id, props);

    const { assistantId, apikey, stackname } = props.env;


    const lambdaLog = new logs.LogGroup(this, `lambda-logs-gptpoxy-${stackname}`, {
      logGroupName: `/aws/lambda/logs-gptpoxy-${stackname}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY
    });
    // Lambda
    const l = new lambda.Function(this, 'Function', {
      functionName: `${stackname}-proxy`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, './assets/lambdas/gpt-proxy')),
      environment: {
        OPENAI_API_KEY: apikey,
        ASSISTANT_ID: assistantId
      },
      timeout: cdk.Duration.seconds(30), // Set the timeout to 30 seconds
      logGroup: lambdaLog
    });

    // API Gateway
    const api = new apigateway.RestApi(this, 'ApiableApiGateway', {
      restApiName: `gptproxy-api`,
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      deployOptions: {
        stageName: 'prod'
      }
    });

    const proxyResource = api.root.addResource('{proxy+}');
    proxyResource.addMethod('ANY', new apigateway.LambdaIntegration(l, {
      proxy: false,
      integrationResponses: [{
        statusCode: '200',
        responseTemplates: {
          'application/json': `#set($allHeaders = $input.json('$.headers'))
#set ($json = $util.parseJson($allHeaders))
#set($context.responseOverride.header = $json)
$util.parseJson($input.json('$.body'))`,
        },
      }],
      requestTemplates: {
        'application/json': `#set($allParams = $input.params())
{
"body" : $input.json('$'),
"params" : {
#foreach($type in $allParams.keySet())
    #set($params = $allParams.get($type))
"$type" : {
    #foreach($paramName in $params.keySet())
    "$paramName" : "$util.escapeJavaScript($params.get($paramName))"
        #if($foreach.hasNext),#end
    #end
}
    #if($foreach.hasNext),#end
#end
},
"stage-variables" : {
#foreach($key in $stageVariables.keySet())
"$key" : "$util.escapeJavaScript($stageVariables.get($key))"
    #if($foreach.hasNext),#end
#end
},
"context" : {
    "account-id" : "$context.identity.accountId",
    "api-id" : "$context.apiId",
    "api-key" : "$context.identity.apiKey",
    "authorizer-principal-id" : "$context.authorizer.principalId",
    "caller" : "$context.identity.caller",
    "cognito-authentication-provider" : "$context.identity.cognitoAuthenticationProvider",
    "cognito-authentication-type" : "$context.identity.cognitoAuthenticationType",
    "cognito-identity-id" : "$context.identity.cognitoIdentityId",
    "cognito-identity-pool-id" : "$context.identity.cognitoIdentityPoolId",
    "http-method" : "$context.httpMethod",
    "stage" : "$context.stage",
    "source-ip" : "$context.identity.sourceIp",
    "user" : "$context.identity.user",
    "user-agent" : "$context.identity.userAgent",
    "user-arn" : "$context.identity.userArn",
    "request-id" : "$context.requestId",
    "resource-id" : "$context.resourceId",
    "resource-path" : "$context.resourcePath"
    }
}`,
      },
    }), {
      methodResponses: [{
        statusCode: '200'
      }],
      apiKeyRequired: true
    });

    // Add OPTIONS method to allow any origin
    proxyResource.addMethod('OPTIONS', new apigateway.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
          'method.response.header.Access-Control-Allow-Methods': "'OPTIONS,GET,POST,PUT,DELETE'",
          'method.response.header.Access-Control-Allow-Origin': "'*'"
        },
        responseTemplates: {
          'application/json': ''
        }
      }],
      passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
          'method.response.header.Access-Control-Allow-Origin': true
        }
      }]
    });
  }
}