"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GptProxy = void 0;
const cdk = require("aws-cdk-lib");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const lambda = require("aws-cdk-lib/aws-lambda");
const apigateway = require("aws-cdk-lib/aws-apigateway");
const logs = require("aws-cdk-lib/aws-logs");
const path = require("path");
class GptProxy extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const { assistantId, apikey, stackname } = props.env;
        const lambdaLog = new logs.LogGroup(this, `lambda-logs-gptpoxy-${stackname}`, {
            logGroupName: `/aws/lambda/logs-gptpoxy-${stackname}`,
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY
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
exports.GptProxy = GptProxy;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ3B0LXByb3h5LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiZ3B0LXByb3h5LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQyw2Q0FBMEM7QUFDMUMsaURBQWlEO0FBQ2pELHlEQUF5RDtBQUN6RCw2Q0FBNkM7QUFFN0MsNkJBQTZCO0FBYTdCLE1BQWEsUUFBUyxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3JDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBb0I7UUFDNUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxFQUFFLFdBQVcsRUFBRSxNQUFNLEVBQUUsU0FBUyxFQUFFLEdBQUcsS0FBSyxDQUFDLEdBQUcsQ0FBQztRQUdyRCxNQUFNLFNBQVMsR0FBRyxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLHVCQUF1QixTQUFTLEVBQUUsRUFBRTtZQUM1RSxZQUFZLEVBQUUsNEJBQTRCLFNBQVMsRUFBRTtZQUNyRCxTQUFTLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxRQUFRO1lBQ3RDLGFBQWEsRUFBRSwyQkFBYSxDQUFDLE9BQU87U0FDckMsQ0FBQyxDQUFDO1FBQ0gsU0FBUztRQUNULE1BQU0sQ0FBQyxHQUFHLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsVUFBVSxFQUFFO1lBQzlDLFlBQVksRUFBRSxHQUFHLFNBQVMsUUFBUTtZQUNsQyxPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFXO1lBQ25DLE9BQU8sRUFBRSxlQUFlO1lBQ3hCLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSw0QkFBNEIsQ0FBQyxDQUFDO1lBQy9FLFdBQVcsRUFBRTtnQkFDWCxjQUFjLEVBQUUsTUFBTTtnQkFDdEIsWUFBWSxFQUFFLFdBQVc7YUFDMUI7WUFDRCxPQUFPLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLEVBQUUsZ0NBQWdDO1lBQ25FLFFBQVEsRUFBRSxTQUFTO1NBQ3BCLENBQUMsQ0FBQztRQUVILGNBQWM7UUFDZCxNQUFNLEdBQUcsR0FBRyxJQUFJLFVBQVUsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFO1lBQzVELFdBQVcsRUFBRSxjQUFjO1lBQzNCLGFBQWEsRUFBRSxDQUFDLFVBQVUsQ0FBQyxZQUFZLENBQUMsUUFBUSxDQUFDO1lBQ2pELGFBQWEsRUFBRTtnQkFDYixTQUFTLEVBQUUsTUFBTTthQUNsQjtTQUNGLENBQUMsQ0FBQztRQUVILE1BQU0sYUFBYSxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQ3ZELGFBQWEsQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLElBQUksVUFBVSxDQUFDLGlCQUFpQixDQUFDLENBQUMsRUFBRTtZQUNqRSxLQUFLLEVBQUUsS0FBSztZQUNaLG9CQUFvQixFQUFFLENBQUM7b0JBQ3JCLFVBQVUsRUFBRSxLQUFLO29CQUNqQixpQkFBaUIsRUFBRTt3QkFDakIsa0JBQWtCLEVBQUU7Ozt1Q0FHUztxQkFDOUI7aUJBQ0YsQ0FBQztZQUNGLGdCQUFnQixFQUFFO2dCQUNoQixrQkFBa0IsRUFBRTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7RUF5QzFCO2FBQ0s7U0FDRixDQUFDLEVBQUU7WUFDRixlQUFlLEVBQUUsQ0FBQztvQkFDaEIsVUFBVSxFQUFFLEtBQUs7aUJBQ2xCLENBQUM7WUFDRixjQUFjLEVBQUUsSUFBSTtTQUNyQixDQUFDLENBQUM7UUFFSCx5Q0FBeUM7UUFDekMsYUFBYSxDQUFDLFNBQVMsQ0FBQyxTQUFTLEVBQUUsSUFBSSxVQUFVLENBQUMsZUFBZSxDQUFDO1lBQ2hFLG9CQUFvQixFQUFFLENBQUM7b0JBQ3JCLFVBQVUsRUFBRSxLQUFLO29CQUNqQixrQkFBa0IsRUFBRTt3QkFDbEIscURBQXFELEVBQUUsd0VBQXdFO3dCQUMvSCxxREFBcUQsRUFBRSwrQkFBK0I7d0JBQ3RGLG9EQUFvRCxFQUFFLEtBQUs7cUJBQzVEO29CQUNELGlCQUFpQixFQUFFO3dCQUNqQixrQkFBa0IsRUFBRSxFQUFFO3FCQUN2QjtpQkFDRixDQUFDO1lBQ0YsbUJBQW1CLEVBQUUsVUFBVSxDQUFDLG1CQUFtQixDQUFDLEtBQUs7WUFDekQsZ0JBQWdCLEVBQUU7Z0JBQ2hCLGtCQUFrQixFQUFFLHFCQUFxQjthQUMxQztTQUNGLENBQUMsRUFBRTtZQUNGLGVBQWUsRUFBRSxDQUFDO29CQUNoQixVQUFVLEVBQUUsS0FBSztvQkFDakIsa0JBQWtCLEVBQUU7d0JBQ2xCLHFEQUFxRCxFQUFFLElBQUk7d0JBQzNELHFEQUFxRCxFQUFFLElBQUk7d0JBQzNELG9EQUFvRCxFQUFFLElBQUk7cUJBQzNEO2lCQUNGLENBQUM7U0FDSCxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUE5SEQsNEJBOEhDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7UmVtb3ZhbFBvbGljeX0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgYXBpZ2F0ZXdheSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheSc7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCB7Q29uc3RydWN0fSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5cbmludGVyZmFjZSBHcHRQcm94eVByb3BzRW52IGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICBhY2NvdW50OiBzdHJpbmc7XG4gIHJlZ2lvbjogc3RyaW5nO1xuICBzdGFja25hbWU6IHN0cmluZztcbiAgYXBpa2V5OiBzdHJpbmc7XG4gIGFzc2lzdGFudElkOiBzdHJpbmc7XG59XG5pbnRlcmZhY2UgR3B0UHJveHlQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgZW52OiBHcHRQcm94eVByb3BzRW52O1xufVxuXG5leHBvcnQgY2xhc3MgR3B0UHJveHkgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogR3B0UHJveHlQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3QgeyBhc3Npc3RhbnRJZCwgYXBpa2V5LCBzdGFja25hbWUgfSA9IHByb3BzLmVudjtcblxuXG4gICAgY29uc3QgbGFtYmRhTG9nID0gbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgYGxhbWJkYS1sb2dzLWdwdHBveHktJHtzdGFja25hbWV9YCwge1xuICAgICAgbG9nR3JvdXBOYW1lOiBgL2F3cy9sYW1iZGEvbG9ncy1ncHRwb3h5LSR7c3RhY2tuYW1lfWAsXG4gICAgICByZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWVxuICAgIH0pO1xuICAgIC8vIExhbWJkYVxuICAgIGNvbnN0IGwgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdGdW5jdGlvbicsIHtcbiAgICAgIGZ1bmN0aW9uTmFtZTogYCR7c3RhY2tuYW1lfS1wcm94eWAsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMixcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi9hc3NldHMvbGFtYmRhcy9ncHQtcHJveHknKSksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBPUEVOQUlfQVBJX0tFWTogYXBpa2V5LFxuICAgICAgICBBU1NJU1RBTlRfSUQ6IGFzc2lzdGFudElkXG4gICAgICB9LFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLCAvLyBTZXQgdGhlIHRpbWVvdXQgdG8gMzAgc2Vjb25kc1xuICAgICAgbG9nR3JvdXA6IGxhbWJkYUxvZ1xuICAgIH0pO1xuXG4gICAgLy8gQVBJIEdhdGV3YXlcbiAgICBjb25zdCBhcGkgPSBuZXcgYXBpZ2F0ZXdheS5SZXN0QXBpKHRoaXMsICdBcGlhYmxlQXBpR2F0ZXdheScsIHtcbiAgICAgIHJlc3RBcGlOYW1lOiBgZ3B0cHJveHktYXBpYCxcbiAgICAgIGVuZHBvaW50VHlwZXM6IFthcGlnYXRld2F5LkVuZHBvaW50VHlwZS5SRUdJT05BTF0sXG4gICAgICBkZXBsb3lPcHRpb25zOiB7XG4gICAgICAgIHN0YWdlTmFtZTogJ3Byb2QnXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBwcm94eVJlc291cmNlID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ3twcm94eSt9Jyk7XG4gICAgcHJveHlSZXNvdXJjZS5hZGRNZXRob2QoJ0FOWScsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGwsIHtcbiAgICAgIHByb3h5OiBmYWxzZSxcbiAgICAgIGludGVncmF0aW9uUmVzcG9uc2VzOiBbe1xuICAgICAgICBzdGF0dXNDb2RlOiAnMjAwJyxcbiAgICAgICAgcmVzcG9uc2VUZW1wbGF0ZXM6IHtcbiAgICAgICAgICAnYXBwbGljYXRpb24vanNvbic6IGAjc2V0KCRhbGxIZWFkZXJzID0gJGlucHV0Lmpzb24oJyQuaGVhZGVycycpKVxuI3NldCAoJGpzb24gPSAkdXRpbC5wYXJzZUpzb24oJGFsbEhlYWRlcnMpKVxuI3NldCgkY29udGV4dC5yZXNwb25zZU92ZXJyaWRlLmhlYWRlciA9ICRqc29uKVxuJHV0aWwucGFyc2VKc29uKCRpbnB1dC5qc29uKCckLmJvZHknKSlgLFxuICAgICAgICB9LFxuICAgICAgfV0sXG4gICAgICByZXF1ZXN0VGVtcGxhdGVzOiB7XG4gICAgICAgICdhcHBsaWNhdGlvbi9qc29uJzogYCNzZXQoJGFsbFBhcmFtcyA9ICRpbnB1dC5wYXJhbXMoKSlcbntcblwiYm9keVwiIDogJGlucHV0Lmpzb24oJyQnKSxcblwicGFyYW1zXCIgOiB7XG4jZm9yZWFjaCgkdHlwZSBpbiAkYWxsUGFyYW1zLmtleVNldCgpKVxuICAgICNzZXQoJHBhcmFtcyA9ICRhbGxQYXJhbXMuZ2V0KCR0eXBlKSlcblwiJHR5cGVcIiA6IHtcbiAgICAjZm9yZWFjaCgkcGFyYW1OYW1lIGluICRwYXJhbXMua2V5U2V0KCkpXG4gICAgXCIkcGFyYW1OYW1lXCIgOiBcIiR1dGlsLmVzY2FwZUphdmFTY3JpcHQoJHBhcmFtcy5nZXQoJHBhcmFtTmFtZSkpXCJcbiAgICAgICAgI2lmKCRmb3JlYWNoLmhhc05leHQpLCNlbmRcbiAgICAjZW5kXG59XG4gICAgI2lmKCRmb3JlYWNoLmhhc05leHQpLCNlbmRcbiNlbmRcbn0sXG5cInN0YWdlLXZhcmlhYmxlc1wiIDoge1xuI2ZvcmVhY2goJGtleSBpbiAkc3RhZ2VWYXJpYWJsZXMua2V5U2V0KCkpXG5cIiRrZXlcIiA6IFwiJHV0aWwuZXNjYXBlSmF2YVNjcmlwdCgkc3RhZ2VWYXJpYWJsZXMuZ2V0KCRrZXkpKVwiXG4gICAgI2lmKCRmb3JlYWNoLmhhc05leHQpLCNlbmRcbiNlbmRcbn0sXG5cImNvbnRleHRcIiA6IHtcbiAgICBcImFjY291bnQtaWRcIiA6IFwiJGNvbnRleHQuaWRlbnRpdHkuYWNjb3VudElkXCIsXG4gICAgXCJhcGktaWRcIiA6IFwiJGNvbnRleHQuYXBpSWRcIixcbiAgICBcImFwaS1rZXlcIiA6IFwiJGNvbnRleHQuaWRlbnRpdHkuYXBpS2V5XCIsXG4gICAgXCJhdXRob3JpemVyLXByaW5jaXBhbC1pZFwiIDogXCIkY29udGV4dC5hdXRob3JpemVyLnByaW5jaXBhbElkXCIsXG4gICAgXCJjYWxsZXJcIiA6IFwiJGNvbnRleHQuaWRlbnRpdHkuY2FsbGVyXCIsXG4gICAgXCJjb2duaXRvLWF1dGhlbnRpY2F0aW9uLXByb3ZpZGVyXCIgOiBcIiRjb250ZXh0LmlkZW50aXR5LmNvZ25pdG9BdXRoZW50aWNhdGlvblByb3ZpZGVyXCIsXG4gICAgXCJjb2duaXRvLWF1dGhlbnRpY2F0aW9uLXR5cGVcIiA6IFwiJGNvbnRleHQuaWRlbnRpdHkuY29nbml0b0F1dGhlbnRpY2F0aW9uVHlwZVwiLFxuICAgIFwiY29nbml0by1pZGVudGl0eS1pZFwiIDogXCIkY29udGV4dC5pZGVudGl0eS5jb2duaXRvSWRlbnRpdHlJZFwiLFxuICAgIFwiY29nbml0by1pZGVudGl0eS1wb29sLWlkXCIgOiBcIiRjb250ZXh0LmlkZW50aXR5LmNvZ25pdG9JZGVudGl0eVBvb2xJZFwiLFxuICAgIFwiaHR0cC1tZXRob2RcIiA6IFwiJGNvbnRleHQuaHR0cE1ldGhvZFwiLFxuICAgIFwic3RhZ2VcIiA6IFwiJGNvbnRleHQuc3RhZ2VcIixcbiAgICBcInNvdXJjZS1pcFwiIDogXCIkY29udGV4dC5pZGVudGl0eS5zb3VyY2VJcFwiLFxuICAgIFwidXNlclwiIDogXCIkY29udGV4dC5pZGVudGl0eS51c2VyXCIsXG4gICAgXCJ1c2VyLWFnZW50XCIgOiBcIiRjb250ZXh0LmlkZW50aXR5LnVzZXJBZ2VudFwiLFxuICAgIFwidXNlci1hcm5cIiA6IFwiJGNvbnRleHQuaWRlbnRpdHkudXNlckFyblwiLFxuICAgIFwicmVxdWVzdC1pZFwiIDogXCIkY29udGV4dC5yZXF1ZXN0SWRcIixcbiAgICBcInJlc291cmNlLWlkXCIgOiBcIiRjb250ZXh0LnJlc291cmNlSWRcIixcbiAgICBcInJlc291cmNlLXBhdGhcIiA6IFwiJGNvbnRleHQucmVzb3VyY2VQYXRoXCJcbiAgICB9XG59YCxcbiAgICAgIH0sXG4gICAgfSksIHtcbiAgICAgIG1ldGhvZFJlc3BvbnNlczogW3tcbiAgICAgICAgc3RhdHVzQ29kZTogJzIwMCdcbiAgICAgIH1dLFxuICAgICAgYXBpS2V5UmVxdWlyZWQ6IHRydWVcbiAgICB9KTtcblxuICAgIC8vIEFkZCBPUFRJT05TIG1ldGhvZCB0byBhbGxvdyBhbnkgb3JpZ2luXG4gICAgcHJveHlSZXNvdXJjZS5hZGRNZXRob2QoJ09QVElPTlMnLCBuZXcgYXBpZ2F0ZXdheS5Nb2NrSW50ZWdyYXRpb24oe1xuICAgICAgaW50ZWdyYXRpb25SZXNwb25zZXM6IFt7XG4gICAgICAgIHN0YXR1c0NvZGU6ICcyMDAnLFxuICAgICAgICByZXNwb25zZVBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogXCInQ29udGVudC1UeXBlLFgtQW16LURhdGUsQXV0aG9yaXphdGlvbixYLUFwaS1LZXksWC1BbXotU2VjdXJpdHktVG9rZW4nXCIsXG4gICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6IFwiJ09QVElPTlMsR0VULFBPU1QsUFVULERFTEVURSdcIixcbiAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiBcIicqJ1wiXG4gICAgICAgIH0sXG4gICAgICAgIHJlc3BvbnNlVGVtcGxhdGVzOiB7XG4gICAgICAgICAgJ2FwcGxpY2F0aW9uL2pzb24nOiAnJ1xuICAgICAgICB9XG4gICAgICB9XSxcbiAgICAgIHBhc3N0aHJvdWdoQmVoYXZpb3I6IGFwaWdhdGV3YXkuUGFzc3Rocm91Z2hCZWhhdmlvci5ORVZFUixcbiAgICAgIHJlcXVlc3RUZW1wbGF0ZXM6IHtcbiAgICAgICAgJ2FwcGxpY2F0aW9uL2pzb24nOiAne1wic3RhdHVzQ29kZVwiOiAyMDB9J1xuICAgICAgfVxuICAgIH0pLCB7XG4gICAgICBtZXRob2RSZXNwb25zZXM6IFt7XG4gICAgICAgIHN0YXR1c0NvZGU6ICcyMDAnLFxuICAgICAgICByZXNwb25zZVBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogdHJ1ZSxcbiAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogdHJ1ZSxcbiAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiB0cnVlXG4gICAgICAgIH1cbiAgICAgIH1dXG4gICAgfSk7XG4gIH1cbn0iXX0=