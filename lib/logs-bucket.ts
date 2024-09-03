import * as cdk from 'aws-cdk-lib';
import {CfnOutput, RemovalPolicy} from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as logs from 'aws-cdk-lib/aws-logs';
import {Construct} from 'constructs';
import * as path from 'path';
import {generateRandomString} from "./utils";

interface ApiableS3BucketEnv extends cdk.StackProps {
    account: string;
    region: string;
    name: string;
}

interface ApiableS3BucketProps extends cdk.StackProps {
    env: ApiableS3BucketEnv;
}

export class LogsBucket extends cdk.Stack {
    constructor(scope: Construct, id: string, props: ApiableS3BucketProps) {
        super(scope, id, props);

        const {account, name} = props.env;
        const partnerAccount = '034444869755'
        //const randomString = generateRandomString(8)
        //const bucketName = `apiable-logs-${name}-${randomString}`;
        const bucketName = `apiable-logs-${name}`;
        // Create the S3 bucket
        const bucket = new s3.Bucket(this, 'ApiableLogs', {
            bucketName,
            removalPolicy: cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE, // Change as needed
            autoDeleteObjects: false // true, // Change as needed
        });

        // Bucket Policy
        const bucketPolicy = new iam.PolicyStatement({
            sid: 'Permissions',
            effect: iam.Effect.ALLOW,
            principals: [new iam.ArnPrincipal(`arn:aws:iam::${account}:root`), new iam.ArnPrincipal(`arn:aws:iam::${partnerAccount}:root`)],
            actions: [
                's3:*',
            ],
            resources: [
                bucket.bucketArn,
                `${bucket.bucketArn}/*`
            ],
        });
        // Attach the bucket policy to the bucket
        bucket.addToResourcePolicy(bucketPolicy);

        const s3BucketRole = new iam.Role(this, `apiable-logs-${name}-s3-role`, {
            assumedBy: new iam.AccountPrincipal(partnerAccount),
            roleName: `apiable-logs-${name}-s3-role`,
            description: `Role for partner account to Access the S3 Bucket`,
        })

        s3BucketRole.addToPolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                resources: [
                    bucket.bucketArn,
                    `${bucket.bucketArn}/*`
                ],
                actions: [
                    's3:*'
                ]
            })
        )

        new cdk.CfnOutput(this, `BucketName${name}`, {
            value: bucket.bucketName,
            description: 'The name of the S3 bucket',
        });

        new cdk.CfnOutput(this, `BucketArn${name}`, {
            value: bucket.bucketArn,
            description: 'The ARN of the S3 bucket',
        });


        new CfnOutput(this, `s3-assume-role-${name}-arn`, {
            value: s3BucketRole.roleArn,
            description: 'The ARN of the S3 bucket role'
        });
    }
}