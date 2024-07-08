import * as cdk from 'aws-cdk-lib'
import {CfnOutput} from 'aws-cdk-lib'
import {Construct} from 'constructs'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as s3 from "aws-cdk-lib/aws-s3";
import {fromContextOrError} from "./utils";
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
      removalPolicy: cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE, // Change as needed
      autoDeleteObjects: false // true, // Change as needed
    });

    // Create the bucket policy
    /*const bucketPolicy = new iam.PolicyStatement({
      sid: 'Permissions',
      effect: iam.Effect.ALLOW,
      principals: [new iam.ArnPrincipal(`arn:aws:iam::034444869755:root`)],
      actions: [
        's3:*',
      ],
      resources: [
        bucket.bucketArn
      ],
    });*/

    // Attach the bucket policy to the bucket
    //bucket.addToResourcePolicy(bucketPolicy);

    const name = `apiable-s3-logs-managment-role-${region}`

    const s3BucketRole = new iam.Role(this, `${name}-role`, {
      assumedBy: new iam.AccountPrincipal('034444869755'),
      roleName: name,
      description: `Role for Apiable to Access the S3 Bucket`,
    })

    s3BucketRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [bucket.bucketArn],
        actions: [
          's3:*'
        ]
      })
    )

    const log = new logs.LogGroup(this, 'ErrorLogGroup', {
      logGroupName: `/aws/firehose/access-logs-${stackname}`,
      retention: logs.RetentionDays.ONE_WEEK
    });
    const stream = new logs.LogStream(this, 'ErrorLogStream', {
      logGroup: log,
      logStreamName: 'access-logs'
    });

    // Create an IAM role for Firehose to assume
    const firehoseRole = new iam.Role(this, 'FirehoseRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
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
              resources: [bucket.bucketArn, `${bucket.bucketArn}/*`],
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
    const firehose = new kinesisfirehose.CfnDeliveryStream(this, `amazon-apigateway-${stackname}-usagelogs-stream`, {
      deliveryStreamName: `amazon-apigateway-${stackname}-usagelogs-stream`,
      deliveryStreamType: 'DirectPut',
      s3DestinationConfiguration: {
        bucketArn: bucket.bucketArn,
        roleArn: firehoseRole.roleArn,
        prefix: `${stackname}/aws/logs/`,
        errorOutputPrefix: `${stackname}/aws/errors/`,
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

    new CfnOutput(this, `usagelogs-${stackname}-firehose-arn`, { value: firehose.attrArn });
    new CfnOutput(this, `s3-assume-role-${stackname}-arn`, { value:  s3BucketRole.roleArn });

  }
}
