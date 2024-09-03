import * as cdk from 'aws-cdk-lib'
import {CfnOutput, RemovalPolicy} from 'aws-cdk-lib'
import {Construct} from 'constructs'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as kinesisfirehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as logs from "aws-cdk-lib/aws-logs";


export interface Env extends cdk.StackProps {
  account: string;
  region: string;
  logsBucketArn: string;
  prefix: string;
  name: string;
}
export interface Props extends cdk.StackProps {
  env: Env;
}

export class LogsStream extends cdk.Stack {

  constructor(scope: Construct, id: string, props: Props) {

    const { logsBucketArn, prefix, name } = props.env;

    super(scope, id, props)

    const log = new logs.LogGroup(this, `firehose-log-${name}`, {
      logGroupName: `/aws/firehose/logs-${name}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY
    });
    const stream = new logs.LogStream(this, `firehose-log-stream-${name}`, {
      logGroup: log,
      logStreamName: `firehose-log-stream-${name}`,
      removalPolicy: RemovalPolicy.DESTROY
    });

    // Create an IAM role for Firehose to assume
    const firehoseRole = new iam.Role(this, 'FirehoseRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
      roleName: `apiable-${name}-firehose`,
      inlinePolicies: {
        FirehosePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                's3:AbortMultipartUpload',
                's3:GetBucketLocation',
                's3:GetObject',
                's3:ListBucket',
                's3:ListBucketMultipartUploads',
                's3:PutObject',
              ],
              resources: [logsBucketArn, `${logsBucketArn}/*`],
            }),
            new iam.PolicyStatement({
              actions: ['logs:PutLogEvents'],
              resources: [log.logGroupArn],
            }),
          ],
        }),
      },
    });

    // Create the Firehose delivery stream
    const firehose = new kinesisfirehose.CfnDeliveryStream(this, `amazon-apigateway-${name}`, {
      deliveryStreamName: `amazon-apigateway-${name}`, // the name MUST start with amazon-apigateway-
      deliveryStreamType: 'DirectPut',
      s3DestinationConfiguration: {
        bucketArn: logsBucketArn,
        roleArn: firehoseRole.roleArn,
        prefix: `${prefix}/logs/`,
        errorOutputPrefix: `${prefix}/errors/`,
        bufferingHints: {
          intervalInSeconds: 300,
          sizeInMBs: 5,
        },
        cloudWatchLoggingOptions: {
          enabled: true,
          logGroupName: log.logGroupName,
          logStreamName: stream.logStreamName,
        },
        compressionFormat: 'UNCOMPRESSED' // UNCOMPRESSED | GZIP | ZIP | Snappy | HADOOP_SNAPPY
      },
    });

    new CfnOutput(this, `usagelogs-${name}-firehose-arn`, { value: firehose.attrArn });

  }
}
