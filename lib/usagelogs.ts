import * as cdk from 'aws-cdk-lib'
import {CfnOutput} from 'aws-cdk-lib'
import {Construct} from 'constructs'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as s3 from "aws-cdk-lib/aws-s3";
import {fromContextOrError} from "./utils";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as path from "path";
import * as kinesisfirehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as logs from "aws-cdk-lib/aws-logs";


export class UsageLogs extends cdk.Stack {

  constructor(scope: Construct, id: string, props: cdk.StackProps) {

    super(scope, id, props)
    const stackname = fromContextOrError(this.node, 'stackname')
    const account = props.env?.account || 'undefined'
    const region = props.env?.region || 'undefined'

    if (!account) {
      throw new Error("account must be set in the stack props")
    }
    if (!region) {
      throw new Error("region must be set in the stack props")
    }

    // Create the S3 bucket
    const bucket = new s3.Bucket(this, 'ApiableLogs', {
      bucketName: `apiable-logs-${stackname}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Change as needed
      autoDeleteObjects: true, // Change as needed
    });

    // Create the bucket policy
    const bucketPolicy = new iam.PolicyStatement({
      sid: 'Permissions',
      effect: iam.Effect.ALLOW,
      principals: [new iam.ArnPrincipal(`arn:aws:iam::034444869755:root`)],
      actions: [
        's3:*',
      ],
      resources: [
        bucket.bucketArn
      ],
    });

    // Attach the bucket policy to the bucket
    bucket.addToResourcePolicy(bucketPolicy);

    const policyLogs = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [
        "arn:aws:apigateway:*::/usageplans",
        "arn:aws:apigateway:*::/usageplans/*/*"
      ],
      actions: [
        'apigateway:GET'
      ]
    })

    const role = new iam.Role(this, `${stackname}-usagelogs-lambda-role`, {
      roleName: `${stackname}-usagelogs-lambda-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        logs: new iam.PolicyDocument({
          statements: [policyLogs]
        }),
      }
    })

    const l = new lambda.Function(this, 'Function', {
      functionName: `usagelogs-${stackname}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'lambda_function.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, './assets/lambdas/usagelogs')),
      role
    })

    // Create a role for the Firehose to use the Lambda function
    const firehoseRole = new iam.Role(this, 'FirehoseRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
    });

    // Attach policy statements to the role
    /*firehoseRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'glue:GetTable',
        'glue:GetTableVersion',
        'glue:GetTableVersions'
      ],
      resources: [
        `arn:aws:glue:${region}:${account}:catalog`,
        `arn:aws:glue:${region}:${account}:database/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%`,
        `arn:aws:glue:${region}:${account}:table/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%`
      ],
    }));

    firehoseRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'kafka:GetBootstrapBrokers',
        'kafka:DescribeCluster',
        'kafka:DescribeClusterV2',
        'kafka-cluster:Connect'
      ],
      resources: [
        `arn:aws:kafka:${region}:${account}:cluster/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%`
      ],
    }));

    firehoseRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'kafka-cluster:DescribeTopic',
        'kafka-cluster:DescribeTopicDynamicConfiguration',
        'kafka-cluster:ReadData'
      ],
      resources: [
        `arn:aws:kafka:${region}:${account}:topic/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%`
      ],
    }));

    firehoseRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'kafka-cluster:DescribeGroup'
      ],
      resources: [
        `arn:aws:kafka:${region}:${account}:group/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%/*`
      ],
    }));

    firehoseRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:AbortMultipartUpload',
        's3:GetBucketLocation',
        's3:GetObject',
        's3:ListBucket',
        's3:ListBucketMultipartUploads',
        's3:PutObject'
      ],
      resources: [
        'arn:aws:s3:::apiable-logs',
        'arn:aws:s3:::apiable-logs/*'
      ],
    }));

    firehoseRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'lambda:InvokeFunction',
        'lambda:GetFunctionConfiguration'
      ],
      resources: [
        l.functionArn
      ],
    }));

    firehoseRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'kms:GenerateDataKey',
        'kms:Decrypt'
      ],
      resources: [
        `arn:aws:kms:${region}:${account}:key/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%`
      ],
      conditions: {
        'StringEquals': {
          'kms:ViaService': `s3.${region}.amazonaws.com`
        },
        'StringLike': {
          'kms:EncryptionContext:aws:s3:arn': [
            'arn:aws:s3:::%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%/*',
            'arn:aws:s3:::%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%'
          ]
        }
      }
    }));

    firehoseRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:PutLogEvents'
      ],
      resources: [
        `arn:aws:logs:${region}:${account}:log-group:/aws/kinesisfirehose/amazon-apigateway-api-gateway-access-log-delivery-stream:log-stream:*`,
        `arn:aws:logs:${region}:${account}:log-group:%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%:log-stream:*`
      ],
    }));

    firehoseRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'kinesis:DescribeStream',
        'kinesis:GetShardIterator',
        'kinesis:GetRecords',
        'kinesis:ListShards'
      ],
      resources: [
        `arn:aws:kinesis:${region}:${account}:stream/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%`
      ],
    }));

    firehoseRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'kms:Decrypt'
      ],
      resources: [
        `arn:aws:kms:${region}:${account}:key/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%`
      ],
      conditions: {
        'StringEquals': {
          'kms:ViaService': `kinesis.${region}.amazonaws.com`
        },
        'StringLike': {
          'kms:EncryptionContext:aws:kinesis:arn': `arn:aws:kinesis:${region}:${account}:stream/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%`
        }
      }
    }));

     */
    const log = new logs.LogGroup(this, 'ErrorLogGroup', {
      logGroupName: `amazon-apigateway-api-gateway-access-logs-${stackname}`,
      retention: logs.RetentionDays.INFINITE
    });
    const stream = new logs.LogStream(this, 'ErrorLogStream', {
      logGroup: log,
      logStreamName: 'amazon-apigateway-access-logs'
    });

    // Create the Firehose delivery stream
    const firehose = new kinesisfirehose.CfnDeliveryStream(this, 'KinesisFirehoseDeliveryStream', {
      deliveryStreamName: `amazon-apigateway-${stackname}-usagelogs-stream`,
      deliveryStreamType: 'DirectPut',
      s3DestinationConfiguration: {
        bucketArn: bucket.bucketArn,
        roleArn: firehoseRole.roleArn,
        prefix: `${stackname}/aws/logs`,
        errorOutputPrefix: `${stackname}/aws/logs/errors`,
        bufferingHints: {
          intervalInSeconds: 300,
          sizeInMBs: 5,
        },
        cloudWatchLoggingOptions: {
          enabled: true,
          logGroupName: log.logGroupName,
          logStreamName: stream.logStreamName,
        },
      },
    });


    new CfnOutput(this, `usagelogs-${stackname}-s3-arn`, { value: bucket.bucketArn});
    new CfnOutput(this, `usagelogs-${stackname}-lambda-role-arn`, { value: role.roleArn });
    new CfnOutput(this, `usagelogs-${stackname}-lambda-arn`, { value: l.functionArn });
    new CfnOutput(this, `usagelogs-${stackname}-firehose-arn`, { value: firehose.attrArn });

  }
}
