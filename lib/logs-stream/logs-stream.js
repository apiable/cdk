"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPublishedTokensStack = exports.buildPublishedStack = exports.LogsStreamStack = exports.DEFAULT_USAGETOKENS_NAME = exports.DEFAULT_USAGELOGS_NAME = exports.LogsStream = exports.LogsStreamConstruct = exports.firehoseRoleLogicalIdForName = exports.DEFAULT_USAGETOKENS_PREFIX = exports.DEFAULT_USAGELOGS_PREFIX = exports.FIREHOSE_ROLE_LOGICAL_ID_TOKENS = exports.FIREHOSE_ROLE_LOGICAL_ID = exports.USAGETOKENS_STREAM_COMPONENT = exports.USAGELOGS_STREAM_COMPONENT = exports.PREFIX_PARAMETER = exports.STREAM_NAME_PARAMETER = exports.LOGS_BUCKET_ARN_PARAMETER = void 0;
const cdk = require("aws-cdk-lib");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const constructs_1 = require("constructs");
const iam = require("aws-cdk-lib/aws-iam");
const kinesisfirehose = require("aws-cdk-lib/aws-kinesisfirehose");
const logs = require("aws-cdk-lib/aws-logs");
const cdk_ssm_composition_1 = require("@apiable/cdk-ssm-composition");
const parity_gate_1 = require("@apiable/parity-gate");
Object.defineProperty(exports, "LOGS_BUCKET_ARN_PARAMETER", { enumerable: true, get: function () { return parity_gate_1.LOGS_BUCKET_ARN_PARAMETER; } });
const launch_stack_url_1 = require("./launch-stack-url");
/** Logical id of the stream-name parameter the published template scopes the stream's physical names by. */
exports.STREAM_NAME_PARAMETER = 'StreamName';
/** Logical id of the destination-prefix parameter the published template routes records under. */
exports.PREFIX_PARAMETER = 'DestinationPrefix';
/** Kebab kit-component segment the usage-log distribution publishes its outputs under. */
exports.USAGELOGS_STREAM_COMPONENT = 'usagelogs-stream';
/** Kebab kit-component segment the api-key-token distribution publishes its outputs under. */
exports.USAGETOKENS_STREAM_COMPONENT = 'usagetokens-stream';
/**
 * Author-declared, channel-identical identity the release-time parity gate keys the delivery role on
 * (the `apiable:logical-id` tag), so the same role compares equal across the CDK, published-CFN, and
 * Terraform channels regardless of its generated name, account, or region. The hand-rolled Terraform
 * module declares the identical literal. The firehose delivery stream is not a parity-gate taggable
 * primary, so only the role carries the declared id. The two distributions of the shared stream each
 * carry their own value so the token role is labelled for the token distribution, never as the usage-log
 * one — the role is a separate physical resource per stream, so the ids do not collide within a channel.
 */
exports.FIREHOSE_ROLE_LOGICAL_ID = 'apiable-usagelogs-firehose-role';
/** The token distribution's delivery-role declared identity (see {@link FIREHOSE_ROLE_LOGICAL_ID}). */
exports.FIREHOSE_ROLE_LOGICAL_ID_TOKENS = 'apiable-usagetokens-firehose-role';
/** Stream-name prefix the API gateway requires to attach to and write access logs to the stream. */
const GATEWAY_STREAM_NAME_PREFIX = 'amazon-apigateway-';
/** S3 key prefix the usage-log stream writes its records under when none is supplied. */
exports.DEFAULT_USAGELOGS_PREFIX = 'apiable/aws';
/** S3 key prefix the api-key-token stream writes its records under — the routing signal the downstream pipeline keys off. */
exports.DEFAULT_USAGETOKENS_PREFIX = 'apiable/aws/apikey-token';
/**
 * The delivery-role declared identity derived from a concrete stream name. Each distribution carries
 * its own id so the parity gate never sees two distributions collide on one declared id: the usage-log
 * variant gets the usage-log id, the token variant the token id, and any other variant a distinct
 * variant-derived id (`apiable-<variant>-firehose-role`) — never a silent fall-back to the usage-log id,
 * which would mislabel a new distribution as the usage-log one and collide on the gate. A tokenised
 * (published one-click) name carries no variant signal, so the published stack passes the id explicitly.
 */
const firehoseRoleLogicalIdForName = (name) => {
    if (cdk.Token.isUnresolved(name))
        return exports.FIREHOSE_ROLE_LOGICAL_ID;
    // the variant is the leading segment of the name (`usagetokens-staging` → `usagetokens`)
    const variant = name.split('-')[0];
    if (variant === 'usagetokens')
        return exports.FIREHOSE_ROLE_LOGICAL_ID_TOKENS;
    if (variant === 'usagelogs')
        return exports.FIREHOSE_ROLE_LOGICAL_ID;
    return `apiable-${variant}-firehose-role`;
};
exports.firehoseRoleLogicalIdForName = firehoseRoleLogicalIdForName;
/**
 * Apiable gateway usage-log delivery stream as a reusable construct: a Kinesis Firehose delivery
 * stream that writes to the customer's configured log-storage bucket, the delivery role the firehose
 * service assumes, and the CloudWatch log group/stream the delivery diagnostics go to.
 *
 * The storage location is a deploy-time input and the delivery role trusts only the firehose service
 * principal (no customer- or cross-account trust knob), so the artifact fixes no customer- or
 * deployment-specific identifier. This is the shared shape published under two distribution identities
 * (usage-log and api-key-token) that differ only by the default stream name and destination prefix.
 */
class LogsStreamConstruct extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        if (!props.logsBucketArn)
            throw new Error('logsBucketArn is required to scope the delivery stream destination');
        if (!props.name)
            throw new Error('name is required to scope the delivery stream resources');
        const { logsBucketArn, name } = props;
        const prefix = props.prefix ?? exports.DEFAULT_USAGELOGS_PREFIX;
        // A construct id may not contain a token, so a parameterised (published one-click) name falls back
        // to a static id while the physical names keep the full `${name}` interpolation (a CFN Sub). A
        // concrete name (the standalone/umbrella path) embeds in the id exactly as the existing deploy expects.
        const idSuffix = cdk.Token.isUnresolved(name) ? '' : `-${name}`;
        const log = new logs.LogGroup(this, `firehose-log${idSuffix}`, {
            logGroupName: `/aws/firehose/logs-${name}`,
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
        });
        const stream = new logs.LogStream(this, `firehose-log-stream${idSuffix}`, {
            logGroup: log,
            logStreamName: `firehose-log-stream-${name}`,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
        });
        this.deliveryRole = new iam.Role(this, 'FirehoseRole', {
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
        // Declare the channel-stable identity on the role itself (never the stack — a stack-wide tag
        // propagates one id onto every resource and collapses them), so the parity gate compares it by
        // declared id rather than its name-derived discriminator. 'apiable:logical-id' is the gate's tag key.
        const firehoseRoleLogicalId = props.firehoseRoleLogicalId ?? (0, exports.firehoseRoleLogicalIdForName)(name);
        cdk.Tags.of(this.deliveryRole).add('apiable:logical-id', firehoseRoleLogicalId);
        const streamConstructId = cdk.Token.isUnresolved(name)
            ? GATEWAY_STREAM_NAME_PREFIX.replace(/-$/, '')
            : `${GATEWAY_STREAM_NAME_PREFIX}${name}`;
        this.deliveryStream = new kinesisfirehose.CfnDeliveryStream(this, streamConstructId, {
            deliveryStreamName: `${GATEWAY_STREAM_NAME_PREFIX}${name}`, // the name MUST start with amazon-apigateway-
            deliveryStreamType: 'DirectPut',
            s3DestinationConfiguration: {
                bucketArn: logsBucketArn,
                roleArn: this.deliveryRole.roleArn,
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
                compressionFormat: 'UNCOMPRESSED', // UNCOMPRESSED | GZIP | ZIP | Snappy | HADOOP_SNAPPY
            },
        });
        // A concrete name embeds in the output logical id exactly as the standalone deploy expects; a
        // parameterised (token) name cannot be a logical id, so the published template uses a stable id.
        // The id names this distribution once (no doubled `usagelogs-usagelogs-` prefix); pin it so the
        // output key is stable and name-derived rather than carrying CDK's construct-path + hash suffix.
        const outputId = cdk.Token.isUnresolved(name) ? 'FirehoseArn' : `firehose-arn-${name}`;
        this.firehoseArnOutput = new aws_cdk_lib_1.CfnOutput(this, outputId, { value: this.deliveryStream.attrArn });
        this.firehoseArnOutput.overrideLogicalId(outputId.replace(/[^A-Za-z0-9]/g, ''));
        if (props.publishComposition) {
            if (!props.tenant)
                throw new Error('tenant is required to publish composition parameters');
            (0, cdk_ssm_composition_1.publishOutputs)(this, {
                tenant: props.tenant,
                component: props.compositionComponent ?? exports.USAGELOGS_STREAM_COMPONENT,
                outputs: [{ name: 'firehose-arn', value: this.deliveryStream.attrArn }],
            });
        }
    }
}
exports.LogsStreamConstruct = LogsStreamConstruct;
/**
 * Thin stack wrapper around {@link LogsStreamConstruct} for standalone CFN synth and umbrella
 * composition. The constructor contract — a Stack taking `Props { env: Env }` — is the one the
 * `deploy-*.sh` generators and the umbrella's `buildLogsStreamStack` pass, held constant so an
 * existing custom-deployed stream is unchanged.
 */
class LogsStream extends cdk.Stack {
    constructor(scope, id, props) {
        const { logsBucketArn, prefix, name } = props.env;
        super(scope, id, props);
        this.logsStream = new LogsStreamConstruct(this, 'LogsStream', { logsBucketArn, prefix, name });
    }
}
exports.LogsStream = LogsStream;
/** Resource-name token the published one-click stream is scoped by when no name is supplied. */
exports.DEFAULT_USAGELOGS_NAME = 'usagelogs';
/** Resource-name token the published one-click token stream is scoped by when no name is supplied. */
exports.DEFAULT_USAGETOKENS_NAME = 'usagetokens';
/**
 * Stack wrapper that surfaces the storage location as a deploy-time CFN parameter for the published
 * one-click template; the stream name + prefix default to this distribution's values (the usage-log
 * distribution's unless overridden for the token distribution).
 */
class LogsStreamStack extends cdk.Stack {
    constructor(scope, id, props = {}) {
        super(scope, id, props);
        const defaultName = props.defaultName ?? exports.DEFAULT_USAGELOGS_NAME;
        const defaultPrefix = props.defaultPrefix ?? exports.DEFAULT_USAGELOGS_PREFIX;
        let logsBucketArn = props.logsBucketArn;
        if (logsBucketArn === undefined) {
            const logsBucketArnParameter = new aws_cdk_lib_1.CfnParameter(this, parity_gate_1.LOGS_BUCKET_ARN_PARAMETER, {
                type: 'String',
                minLength: 1,
                allowedPattern: launch_stack_url_1.BUCKET_ARN_PATTERN_SOURCE,
                description: 'ARN of the log-storage S3 bucket the delivery stream writes to',
                constraintDescription: 'must be a valid S3 bucket ARN (arn:aws:s3:::<bucket>)',
            });
            logsBucketArnParameter.overrideLogicalId(parity_gate_1.LOGS_BUCKET_ARN_PARAMETER);
            logsBucketArn = logsBucketArnParameter.valueAsString;
        }
        // The stream name + destination prefix are deploy-time named values too; omitting them keeps this
        // distribution's defaults, so a one-click deploy with only the storage location reproduces the
        // existing stream while a customer can still override either.
        let name = props.name;
        if (name === undefined) {
            const streamNameParameter = new aws_cdk_lib_1.CfnParameter(this, exports.STREAM_NAME_PARAMETER, {
                type: 'String',
                default: defaultName,
                minLength: 1,
                description: 'Resource-name token the stream is scoped by (amazon-apigateway-<name>)',
            });
            streamNameParameter.overrideLogicalId(exports.STREAM_NAME_PARAMETER);
            name = streamNameParameter.valueAsString;
        }
        let prefix = props.prefix;
        if (prefix === undefined) {
            const prefixParameter = new aws_cdk_lib_1.CfnParameter(this, exports.PREFIX_PARAMETER, {
                type: 'String',
                default: defaultPrefix,
                minLength: 1,
                description: 'S3 key prefix the stream writes its logs/ and errors/ records under',
            });
            prefixParameter.overrideLogicalId(exports.PREFIX_PARAMETER);
            prefix = prefixParameter.valueAsString;
        }
        this.logsStream = new LogsStreamConstruct(this, 'LogsStream', {
            logsBucketArn,
            name,
            prefix,
            tenant: props.tenant,
            publishComposition: props.publishComposition,
            compositionComponent: props.compositionComponent,
            firehoseRoleLogicalId: props.firehoseRoleLogicalId,
        });
    }
}
exports.LogsStreamStack = LogsStreamStack;
/**
 * Build the usage-log-stream stack as published in the launch-stack template: no `env`, so the region
 * resolves to AWS::Region and the storage location stays a deploy-time parameter.
 *
 * Single source of the publish-time synth config so the artifact a customer one-clicks is exactly what
 * the published-stack spec asserts.
 */
const buildPublishedStack = (app) => new LogsStreamStack(app, launch_stack_url_1.CONSTRUCT_NAME, {
    description: 'Apiable gateway usage-log delivery stream — one-click provisioning',
    analyticsReporting: false,
    // an asset-less stream must install into an un-bootstrapped account, so drop the bootstrap-version rule
    synthesizer: new cdk.DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
});
exports.buildPublishedStack = buildPublishedStack;
/**
 * Build the api-key-token-stream stack as published in the launch-stack template: the same shared
 * stream as {@link buildPublishedStack}, published under the token distribution identity — its
 * stream-name and destination-prefix parameters default to the token values and its delivery role
 * carries the token parity identity. The tokenised name carries no variant signal, so the token role id
 * is supplied explicitly here.
 */
const buildPublishedTokensStack = (app) => new LogsStreamStack(app, launch_stack_url_1.TOKENS_CONSTRUCT_NAME, {
    description: 'Apiable gateway api-key-token delivery stream — one-click provisioning',
    analyticsReporting: false,
    defaultName: exports.DEFAULT_USAGETOKENS_NAME,
    defaultPrefix: exports.DEFAULT_USAGETOKENS_PREFIX,
    firehoseRoleLogicalId: exports.FIREHOSE_ROLE_LOGICAL_ID_TOKENS,
    compositionComponent: exports.USAGETOKENS_STREAM_COMPONENT,
    // an asset-less stream must install into an un-bootstrapped account, so drop the bootstrap-version rule
    synthesizer: new cdk.DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
});
exports.buildPublishedTokensStack = buildPublishedTokensStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9ncy1zdHJlYW0uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJsb2dzLXN0cmVhbS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBa0M7QUFDbEMsNkNBQW9FO0FBQ3BFLDJDQUFzQztBQUN0QywyQ0FBMEM7QUFDMUMsbUVBQWtFO0FBQ2xFLDZDQUE0QztBQUM1QyxzRUFBNkQ7QUFDN0Qsc0RBQWdFO0FBUXZELDBHQVJBLHVDQUF5QixPQVFBO0FBUGxDLHlEQUFxRztBQVNyRyw0R0FBNEc7QUFDL0YsUUFBQSxxQkFBcUIsR0FBRyxZQUFZLENBQUE7QUFFakQsa0dBQWtHO0FBQ3JGLFFBQUEsZ0JBQWdCLEdBQUcsbUJBQW1CLENBQUE7QUFFbkQsMEZBQTBGO0FBQzdFLFFBQUEsMEJBQTBCLEdBQUcsa0JBQWtCLENBQUE7QUFFNUQsOEZBQThGO0FBQ2pGLFFBQUEsNEJBQTRCLEdBQUcsb0JBQW9CLENBQUE7QUFFaEU7Ozs7Ozs7O0dBUUc7QUFDVSxRQUFBLHdCQUF3QixHQUFHLGlDQUFpQyxDQUFBO0FBRXpFLHVHQUF1RztBQUMxRixRQUFBLCtCQUErQixHQUFHLG1DQUFtQyxDQUFBO0FBRWxGLG9HQUFvRztBQUNwRyxNQUFNLDBCQUEwQixHQUFHLG9CQUFvQixDQUFBO0FBRXZELHlGQUF5RjtBQUM1RSxRQUFBLHdCQUF3QixHQUFHLGFBQWEsQ0FBQTtBQUVyRCw2SEFBNkg7QUFDaEgsUUFBQSwwQkFBMEIsR0FBRywwQkFBMEIsQ0FBQTtBQUVwRTs7Ozs7OztHQU9HO0FBQ0ksTUFBTSw0QkFBNEIsR0FBRyxDQUFDLElBQVksRUFBVSxFQUFFO0lBQ25FLElBQUksR0FBRyxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDO1FBQUUsT0FBTyxnQ0FBd0IsQ0FBQTtJQUNqRSx5RkFBeUY7SUFDekYsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtJQUNs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RSxDQUNuRSxJQUFJLGVBQWUsQ0FBQyxHQUFHLEVBQUUsaUNBQWMsRUFBRTtJQUN2QyxXQUFXLEVBQUUsb0VBQW9FO0lBQ2pGLGtCQUFrQixFQUFFLEtBQUs7SUFDekIsd0dBQXdHO0lBQ3hHLFdBQVcsRUFBRSxJQUFJLEdBQUcsQ0FBQyx1QkFBdUIsQ0FBQyxFQUFFLDRCQUE0QixFQUFFLEtBQUssRUFBRSxDQUFDO0NBQ3RGLENBQUMsQ0FBQTtBQU5TLFFBQUEsbUJBQW1CLHVCQU01QjtBQUVKOzs7Ozs7R0FNRztBQUNJLE1BQU0seUJBQXlCLEdBQUcsQ0FBQyxHQUFZLEVBQW1CLEVBQUUsQ0FDekUsSUFBSSxlQUFlLENBQUMsR0FBRyxFQUFFLHdDQUFxQixFQUFFO0lBQzlDLFdBQVcsRUFBRSx3RUFBd0U7SUFDckYsa0JBQWtCLEVBQUUsS0FBSztJQUN6QixXQUFXLEVBQUUsZ0NBQXdCO0lBQ3JDLGFBQWEsRUFBRSxrQ0FBMEI7SUFDekMscUJBQXFCLEVBQUUsdUNBQStCO0lBQ3RELG9CQUFvQixFQUFFLG9DQUE0QjtJQUNsRCx3R0FBd0c7SUFDeEcsV0FBVyxFQUFFLElBQUksR0FBRyxDQUFDLHVCQUF1QixDQUFDLEVBQUUsNEJBQTRCLEVBQUUsS0FBSyxFQUFFLENBQUM7Q0FDdEYsQ0FBQyxDQUFBO0FBVlMsUUFBQSx5QkFBeUIsNkJBVWxDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJ1xuaW1wb3J0IHsgQ2ZuT3V0cHV0LCBDZm5QYXJhbWV0ZXIsIFJlbW92YWxQb2xpY3kgfSBmcm9tICdhd3MtY2RrLWxpYidcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSdcbmltcG9ydCAqIGFzIGtpbmVzaXNmaXJlaG9zZSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mta2luZXNpc2ZpcmVob3NlJ1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncydcbmltcG9ydCB7IHB1Ymxpc2hPdXRwdXRzIH0gZnJvbSAnQGFwaWFibGUvY2RrLXNzbS1jb21wb3NpdGlvbidcbmltcG9ydCB7IExPR1NfQlVDS0VUX0FSTl9QQVJBTUVURVIgfSBmcm9tICdAYXBpYWJsZS9wYXJpdHktZ2F0ZSdcbmltcG9ydCB7IEJVQ0tFVF9BUk5fUEFUVEVSTl9TT1VSQ0UsIENPTlNUUlVDVF9OQU1FLCBUT0tFTlNfQ09OU1RSVUNUX05BTUUgfSBmcm9tICcuL2xhdW5jaC1zdGFjay11cmwnXG5cbi8qKlxuICogTG9naWNhbCBpZCBvZiB0aGUgc3RvcmFnZS1sb2NhdGlvbiBwYXJhbWV0ZXIgdGhlIHB1Ymxpc2hlZCB0ZW1wbGF0ZSBzY29wZXMgdGhlIHN0cmVhbSdzIGRlc3RpbmF0aW9uIGJ5LlxuICogVGhlIHBhcml0eSBnYXRlIG93bnMgdGhlIGNhbm9uaWNhbCBzcGVsbGluZyAoaXQga2V5cyB0aGUgZGVzdGluYXRpb24tYnVja2V0IHBhcmFtZXRlci1pZGVudGl0eSByZWR1Y3Rpb25cbiAqIG9uIGl0KSwgc28gdGhlIGNvbnN0cnVjdCBzb3VyY2VzIGl0IGZyb20gdGhlcmUgYW5kIHJlLWV4cG9ydHMgaXQgZm9yIHRoZSBsYXVuY2gtc3RhY2svdGVzdCBjb25zdW1lcnMuXG4gKi9cbmV4cG9ydCB7IExPR1NfQlVDS0VUX0FSTl9QQVJBTUVURVIgfVxuXG4vKiogTG9naWNhbCBpZCBvZiB0aGUgc3RyZWFtLW5hbWUgcGFyYW1ldGVyIHRoZSBwdWJsaXNoZWQgdGVtcGxhdGUgc2NvcGVzIHRoZSBzdHJlYW0ncyBwaHlzaWNhbCBuYW1lcyBieS4gKi9cbmV4cG9ydCBjb25zdCBTVFJFQU1fTkFNRV9QQVJBTUVURVIgPSAnU3RyZWFtTmFtZSdcblxuLyoqIExvZ2ljYWwgaWQgb2YgdGhlIGRlc3RpbmF0aW9uLXByZWZpeCBwYXJhbWV0ZXIgdGhlIHB1Ymxpc2hlZCB0ZW1wbGF0ZSByb3V0ZXMgcmVjb3JkcyB1bmRlci4gKi9cbmV4cG9ydCBjb25zdCBQUkVGSVhfUEFSQU1FVEVSID0gJ0Rlc3RpbmF0aW9uUHJlZml4J1xuXG4vKiogS2ViYWIga2l0LWNvbXBvbmVudCBzZWdtZW50IHRoZSB1c2FnZS1sb2cgZGlzdHJpYnV0aW9uIHB1Ymxpc2hlcyBpdHMgb3V0cHV0cyB1bmRlci4gKi9cbmV4cG9ydCBjb25zdCBVU0FHRUxPR1NfU1RSRUFNX0NPTVBPTkVOVCA9ICd1c2FnZWxvZ3Mtc3RyZWFtJ1xuXG4vKiogS2ViYWIga2l0LWNvbXBvbmVudCBzZWdtZW50IHRoZSBhcGkta2V5LXRva2VuIGRpc3RyaWJ1dGlvbiBwdWJsaXNoZXMgaXRzIG91dHB1dHMgdW5kZXIuICovXG5leHBvcnQgY29uc3QgVVNBR0VUT0tFTlNfU1RSRUFNX0NPTVBPTkVOVCA9ICd1c2FnZXRva2Vucy1zdHJlYW0nXG5cbi8qKlxuICogQXV0aG9yLWRlY2xhcmVkLCBjaGFubmVsLWlkZW50aWNhbCBpZGVudGl0eSB0aGUgcmVsZWFzZS10aW1lIHBhcml0eSBnYXRlIGtleXMgdGhlIGRlbGl2ZXJ5IHJvbGUgb25cbiAqICh0aGUgYGFwaWFibGU6bG9naWNhbC1pZGAgdGFnKSwgc28gdGhlIHNhbWUgcm9sZSBjb21wYXJlcyBlcXVhbCBhY3Jvc3MgdGhlIENESywgcHVibGlzaGVkLUNGTiwgYW5kXG4gKiBUZXJyYWZvcm0gY2hhbm5lbHMgcmVnYXJkbGVzcyBvZiBpdHMgZ2VuZXJhdGVkIG5hbWUsIGFjY291bnQsIG9yIHJlZ2lvbi4gVGhlIGhhbmQtcm9sbGVkIFRlcnJhZm9ybVxuICogbW9kdWxlIGRlY2xhcmVzIHRoZSBpZGVudGljYWwgbGl0ZXJhbC4gVGhlIGZpcmVob3NlIGRlbGl2ZXJ5IHN0cmVhbSBpcyBub3QgYSBwYXJpdHktZ2F0ZSB0YWdnYWJsZVxuICogcHJpbWFyeSwgc28gb25seSB0aGUgcm9sZSBjYXJyaWVzIHRoZSBkZWNsYXJlZCBpZC4gVGhlIHR3byBkaXN0cmlidXRpb25zIG9mIHRoZSBzaGFyZWQgc3RyZWFtIGVhY2hcbiAqIGNhcnJ5IHRoZWlyIG93biB2YWx1ZSBzbyB0aGUgdG9rZW4gcm9sZSBpcyBsYWJlbGxlZCBmb3IgdGhlIHRva2VuIGRpc3RyaWJ1dGlvbiwgbmV2ZXIgYXMgdGhlIHVzYWdlLWxvZ1xuICogb25lIOKAlCB0aGUgcm9sZSBpcyBhIHNlcGFyYXRlIHBoeXNpY2FsIHJlc291cmNlIHBlciBzdHJlYW0sIHNvIHRoZSBpZHMgZG8gbm90IGNvbGxpZGUgd2l0aGluIGEgY2hhbm5lbC5cbiAqL1xuZXhwb3J0IGNvbnN0IEZJUkVIT1NFX1JPTEVfTE9HSUNBTF9JRCA9ICdhcGlhYmxlLXVzYWdlbG9ncy1maXJlaG9zZS1yb2xlJ1xuXG4vKiogVGhlIHRva2VuIGRpc3RyaWJ1dGlvbidzIGRlbGl2ZXJ5LXJvbGUgZGVjbGFyZWQgaWRlbnRpdHkgKHNlZSB7QGxpbmsgRklSRUhPU0VfUk9MRV9MT0dJQ0FMX0lEfSkuICovXG5leHBvcnQgY29uc3QgRklSRUhPU0VfUk9MRV9MT0dJQ0FMX0lEX1RPS0VOUyA9ICdhcGlhYmxlLXVzYWdldG9rZW5zLWZpcmVob3NlLXJvbGUnXG5cbi8qKiBTdHJlYW0tbmFtZSBwcmVmaXggdGhlIEFQSSBnYXRld2F5IHJlcXVpcmVzIHRvIGF0dGFjaCB0byBhbmQgd3JpdGUgYWNjZXNzIGxvZ3MgdG8gdGhlIHN0cmVhbS4gKi9cbmNvbnN0IEdBVEVXQVlfU1RSRUFNX05BTUVfUFJFRklYID0gJ2FtYXpvbi1hcGlnYXRld2F5LSdcblxuLyoqIFMzIGtleSBwcmVmaXggdGhlIHVzYWdlLWxvZyBzdHJlYW0gd3JpdGVzIGl0cyByZWNvcmRzIHVuZGVyIHdoZW4gbm9uZSBpcyBzdXBwbGllZC4gKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX1VTQUdFTE9HU19QUkVGSVggPSAnYXBpYWJsZS9hd3MnXG5cbi8qKiBTMyBrZXkgcHJlZml4IHRoZSBhcGkta2V5LXRva2VuIHN0cmVhbSB3cml0ZXMgaXRzIHJlY29yZHMgdW5kZXIg4oCUIHRoZSByb3V0aW5nIHNpZ25hbCB0aGUgZG93bnN0cmVhbSBwaXBlbGluZSBrZXlzIG9mZi4gKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX1VTQUdFVE9LRU5TX1BSRUZJWCA9ICdhcGlhYmxlL2F3cy9hcGlrZXktdG9rZW4nXG5cbi8qKlxuICogVGhlIGRlbGl2ZXJ5LXJvbGUgZGVjbGFyZWQgaWRlbnRpdHkgZGVyaXZlZCBmcm9tIGEgY29uY3JldGUgc3RyZWFtIG5hbWUuIEVhY2ggZGlzdHJpYnV0aW9uIGNhcnJpZXNcbiAqIGl0cyBvd24gaWQgc28gdGhlIHBhcml0eSBnYXRlIG5ldmVyIHNlZXMgdHdvIGRpc3RyaWJ1dGlvbnMgY29sbGlkZSBvbiBvbmUgZGVjbGFyZWQgaWQ6IHRoZSB1c2FnZS1sb2dcbiAqIHZhcmlhbnQgZ2V0cyB0aGUgdXNhZ2UtbG9nIGlkLCB0aGUgdG9rZW4gdmFyaWFudCB0aGUgdG9rZW4gaWQsIGFuZCBhbnkgb3RoZXIgdmFyaWFudCBhIGRpc3RpbmN0XG4gKiB2YXJpYW50LWRlcml2ZWQgaWQgKGBhcGlhYmxlLTx2YXJpYW50Pi1maXJlaG9zZS1yb2xlYCkg4oCUIG5ldmVyIGEgc2lsZW50IGZhbGwtYmFjayB0byB0aGUgdXNhZ2UtbG9nIGlkLFxuICogd2hpY2ggd291bGQgbWlzbGFiZWwgYSBuZXcgZGlzdHJpYnV0aW9uIGFzIHRoZSB1c2FnZS1sb2cgb25lIGFuZCBjb2xsaWRlIG9uIHRoZSBnYXRlLiBBIHRva2VuaXNlZFxuICogKHB1Ymxpc2hlZCBvbmUtY2xpY2spIG5hbWUgY2FycmllcyBubyB2YXJpYW50IHNpZ25hbCwgc28gdGhlIHB1Ymxpc2hlZCBzdGFjayBwYXNzZXMgdGhlIGlkIGV4cGxpY2l0bHkuXG4gKi9cbmV4cG9ydCBjb25zdCBmaXJlaG9zZVJvbGVMb2dpY2FsSWRGb3JOYW1lID0gKG5hbWU6IHN0cmluZyk6IHN0cmluZyA9PiB7XG4gIGlmIChjZGsuVG9rZW4uaXNVbnJlc29sdmVkKG5hbWUpKSByZXR1cm4gRklSRUhPU0VfUk9MRV9MT0dJQ0FMX0lEXG4gIC8vIHRoZSB2YXJpYW50IGlzIHRoZSBsZWFkaW5nIHNlZ21lbnQgb2YgdGhlIG5hbWUgKGB1c2FnZXRva2Vucy1zdGFnaW5nYCDihpIgYHVzYWdldG9rZW5zYClcbiAgY29uc3QgdmFyaWFudCA9IG5hbWUuc3BsaXQoJy0nKVswXVxuICBpZiAodmFyaWFudCA9PT0gJ3VzYWdldG9rZW5zJykgcmV0dXJuIEZJUkVIT1NFX1JPTEVfTE9HSUNBTF9JRF9UT0tFTlNcbiAgaWYgKHZhcmlhbnQgPT09ICd1c2FnZWxvZ3MnKSByZXR1cm4gRklSRUhPU0VfUk9MRV9MT0dJQ0FMX0lEXG4gIHJldHVybiBgYXBpYWJsZS0ke3ZhcmlhbnR9LWZpcmVob3NlLXJvbGVgXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTG9nc1N0cmVhbUNvbnN0cnVjdFByb3BzIHtcbiAgLyoqIEFSTiBvZiB0aGUgbG9nLXN0b3JhZ2UgYnVja2V0IHRoZSBzdHJlYW0gd3JpdGVzIHRvIOKAlCBhIGRlcGxveS10aW1lIGlucHV0LCBuZXZlciBiYWtlZCBpbi4gKi9cbiAgcmVhZG9ubHkgbG9nc0J1Y2tldEFybjogc3RyaW5nXG4gIC8qKiBSZXNvdXJjZS1uYW1lIHRva2VuIHRoZSBzdHJlYW0ncyBwaHlzaWNhbCBuYW1lcyBhcmUgc2NvcGVkIGJ5IChlLmcuIGB1c2FnZWxvZ3Mtc3RhZ2luZ2ApLiAqL1xuICByZWFkb25seSBuYW1lOiBzdHJpbmdcbiAgLyoqIFMzIGtleSBwcmVmaXggdGhlIHN0cmVhbSB3cml0ZXMgaXRzIGBsb2dzL2AgYW5kIGBlcnJvcnMvYCByZWNvcmRzIHVuZGVyLiBEZWZhdWx0cyB0byB0aGUgdXNhZ2UtbG9nIHByZWZpeC4gKi9cbiAgcmVhZG9ubHkgcHJlZml4Pzogc3RyaW5nXG4gIC8qKlxuICAgKiBUZW5hbnQga2V5IHRoZSBjb25zdHJ1Y3QgcHVibGlzaGVzIGl0cyBjb21wb3NpdGlvbiBwYXJhbWV0ZXJzIHVuZGVyLiBTZXQgdG9nZXRoZXIgd2l0aFxuICAgKiB7QGxpbmsgcHVibGlzaENvbXBvc2l0aW9ufSB0byB3aXJlIHRoZSBTU00gY29tcG9zaXRpb24gc2VhbTsgb21pdHRpbmcgaXQgbGVhdmVzIHRoZSBzZWFtIG9mZiBzbyBhblxuICAgKiBleGlzdGluZyBjdXN0b21lcidzIHN0YWNrIGdhaW5zIG5vIG5ldyBwYXJhbWV0ZXIgcmVzb3VyY2UuXG4gICAqL1xuICByZWFkb25seSB0ZW5hbnQ/OiBzdHJpbmdcbiAgLyoqXG4gICAqIE9wdCBpbiB0byBwdWJsaXNoaW5nIHRoZSBzdHJlYW0ncyBmaXJlaG9zZSBBUk4gdG8gdGhlIHNoYXJlZCBwYXJhbWV0ZXIgc3BhY2UgYXRcbiAgICogYC9hcGlhYmxlL3t0ZW5hbnR9L3tjb21wb25lbnR9L2ZpcmVob3NlLWFybmAuIE9mZiBieSBkZWZhdWx0OiB0aGUgc2VhbSBpcyB3aXJlZCBvbmx5IGZvciBuZXcga2l0XG4gICAqIGRlcGxveW1lbnRzLCBuZXZlciBhdXRvLXJldHJvZml0dGVkIG9udG8gYW4gZXhpc3Rpbmcgc3RhY2suXG4gICAqL1xuICByZWFkb25seSBwdWJsaXNoQ29tcG9zaXRpb24/OiBib29sZWFuXG4gIC8qKiBLaXQtY29tcG9uZW50IHNlZ21lbnQgdGhlIGNvbXBvc2l0aW9uIGtleSBhZGRyZXNzZXMgdGhpcyBkaXN0cmlidXRpb24gdW5kZXIuIERlZmF1bHRzIHRvIHRoZSB1c2FnZS1sb2cgY29tcG9uZW50LiAqL1xuICByZWFkb25seSBjb21wb3NpdGlvbkNvbXBvbmVudD86IHN0cmluZ1xuICAvKipcbiAgICogQ2hhbm5lbC1zdGFibGUgYGFwaWFibGU6bG9naWNhbC1pZGAgdGhlIGRlbGl2ZXJ5IHJvbGUgY2FycmllcyBmb3IgdGhlIHBhcml0eSBnYXRlLiBEZWZhdWx0cyB0byB0aGVcbiAgICogdmFsdWUgZGVyaXZlZCBmcm9tIHtAbGluayBuYW1lfSAodGhlIHRva2VuIGRpc3RyaWJ1dGlvbidzIGlkIHdoZW4gdGhlIG5hbWUgaXMgYSB0b2tlbi12YXJpYW50IG5hbWUsXG4gICAqIHRoZSB1c2FnZS1sb2cgaWQgb3RoZXJ3aXNlKTsgdGhlIHB1Ymxpc2hlZCB0b2tlbiBzdGFjayBzdXBwbGllcyBpdCBleHBsaWNpdGx5IHNpbmNlIGEgdG9rZW5pc2VkIG5hbWVcbiAgICogY2FycmllcyBubyB2YXJpYW50IHNpZ25hbC5cbiAgICovXG4gIHJlYWRvbmx5IGZpcmVob3NlUm9sZUxvZ2ljYWxJZD86IHN0cmluZ1xufVxuXG4vKipcbiAqIEFwaWFibGUgZ2F0ZXdheSB1c2FnZS1sb2cgZGVsaXZlcnkgc3RyZWFtIGFzIGEgcmV1c2FibGUgY29uc3RydWN0OiBhIEtpbmVzaXMgRmlyZWhvc2UgZGVsaXZlcnlcbiAqIHN0cmVhbSB0aGF0IHdyaXRlcyB0byB0aGUgY3VzdG9tZXIncyBjb25maWd1cmVkIGxvZy1zdG9yYWdlIGJ1Y2tldCwgdGhlIGRlbGl2ZXJ5IHJvbGUgdGhlIGZpcmVob3NlXG4gKiBzZXJ2aWNlIGFzc3VtZXMsIGFuZCB0aGUgQ2xvdWRXYXRjaCBsb2cgZ3JvdXAvc3RyZWFtIHRoZSBkZWxpdmVyeSBkaWFnbm9zdGljcyBnbyB0by5cbiAqXG4gKiBUaGUgc3RvcmFnZSBsb2NhdGlvbiBpcyBhIGRlcGxveS10aW1lIGlucHV0IGFuZCB0aGUgZGVsaXZlcnkgcm9sZSB0cnVzdHMgb25seSB0aGUgZmlyZWhvc2Ugc2VydmljZVxuICogcHJpbmNpcGFsIChubyBjdXN0b21lci0gb3IgY3Jvc3MtYWNjb3VudCB0cnVzdCBrbm9iKSwgc28gdGhlIGFydGlmYWN0IGZpeGVzIG5vIGN1c3RvbWVyLSBvclxuICogZGVwbG95bWVudC1zcGVjaWZpYyBpZGVudGlmaWVyLiBUaGlzIGlzIHRoZSBzaGFyZWQgc2hhcGUgcHVibGlzaGVkIHVuZGVyIHR3byBkaXN0cmlidXRpb24gaWRlbnRpdGllc1xuICogKHVzYWdlLWxvZyBhbmQgYXBpLWtleS10b2tlbikgdGhhdCBkaWZmZXIgb25seSBieSB0aGUgZGVmYXVsdCBzdHJlYW0gbmFtZSBhbmQgZGVzdGluYXRpb24gcHJlZml4LlxuICovXG5leHBvcnQgY2xhc3MgTG9nc1N0cmVhbUNvbnN0cnVjdCBleHRlbmRzIENvbnN0cnVjdCB7XG4gIHB1YmxpYyByZWFkb25seSBkZWxpdmVyeVN0cmVhbToga2luZXNpc2ZpcmVob3NlLkNmbkRlbGl2ZXJ5U3RyZWFtXG4gIHB1YmxpYyByZWFkb25seSBkZWxpdmVyeVJvbGU6IGlhbS5Sb2xlXG4gIHB1YmxpYyByZWFkb25seSBmaXJlaG9zZUFybk91dHB1dDogQ2ZuT3V0cHV0XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IExvZ3NTdHJlYW1Db25zdHJ1Y3RQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZClcblxuICAgIGlmICghcHJvcHMubG9nc0J1Y2tldEFybikgdGhyb3cgbmV3IEVycm9yKCdsb2dzQnVja2V0QXJuIGlzIHJlcXVpcmVkIHRvIHNjb3BlIHRoZSBkZWxpdmVyeSBzdHJlYW0gZGVzdGluYXRpb24nKVxuICAgIGlmICghcHJvcHMubmFtZSkgdGhyb3cgbmV3IEVycm9yKCduYW1lIGlzIHJlcXVpcmVkIHRvIHNjb3BlIHRoZSBkZWxpdmVyeSBzdHJlYW0gcmVzb3VyY2VzJylcblxuICAgIGNvbnN0IHsgbG9nc0J1Y2tldEFybiwgbmFtZSB9ID0gcHJvcHNcbiAgICBjb25zdCBwcmVmaXggPSBwcm9wcy5wcmVmaXggPz8gREVGQVVMVF9VU0FHRUxPR1NfUFJFRklYXG4gICAgLy8gQSBjb25zdHJ1Y3QgaWQgbWF5IG5vdCBjb250YWluIGEgdG9rZW4sIHNvIGEgcGFyYW1ldGVyaXNlZCAocHVibGlzaGVkIG9uZS1jbGljaykgbmFtZSBmYWxscyBiYWNrXG4gICAgLy8gdG8gYSBzdGF0aWMgaWQgd2hpbGUgdGhlIHBoeXNpY2FsIG5hbWVzIGtlZXAgdGhlIGZ1bGwgYCR7bmFtZX1gIGludGVycG9sYXRpb24gKGEgQ0ZOIFN1YikuIEFcbiAgICAvLyBjb25jcmV0ZSBuYW1lICh0aGUgc3RhbmRhbG9uZS91bWJyZWxsYSBwYXRoKSBlbWJlZHMgaW4gdGhlIGlkIGV4YWN0bHkgYXMgdGhlIGV4aXN0aW5nIGRlcGxveSBleHBlY3RzLlxuICAgIGNvbnN0IGlkU3VmZml4ID0gY2RrLlRva2VuLmlzVW5yZXNvbHZlZChuYW1lKSA/ICcnIDogYC0ke25hbWV9YFxuXG4gICAgY29uc3QgbG9nID0gbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgYGZpcmVob3NlLWxvZyR7aWRTdWZmaXh9YCwge1xuICAgICAgbG9nR3JvdXBOYW1lOiBgL2F3cy9maXJlaG9zZS9sb2dzLSR7bmFtZX1gLFxuICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSlcbiAgICBjb25zdCBzdHJlYW0gPSBuZXcgbG9ncy5Mb2dTdHJlYW0odGhpcywgYGZpcmVob3NlLWxvZy1zdHJlYW0ke2lkU3VmZml4fWAsIHtcbiAgICAgIGxvZ0dyb3VwOiBsb2csXG4gICAgICBsb2dTdHJlYW1OYW1lOiBgZmlyZWhvc2UtbG9nLXN0cmVhbS0ke25hbWV9YCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KVxuXG4gICAgdGhpcy5kZWxpdmVyeVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0ZpcmVob3NlUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdmaXJlaG9zZS5hbWF6b25hd3MuY29tJyksXG4gICAgICByb2xlTmFtZTogYGFwaWFibGUtJHtuYW1lfS1maXJlaG9zZWAsXG4gICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICBGaXJlaG9zZVBvbGljeTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XG4gICAgICAgICAgc3RhdGVtZW50czogW1xuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgJ3MzOkFib3J0TXVsdGlwYXJ0VXBsb2FkJyxcbiAgICAgICAgICAgICAgICAnczM6R2V0QnVja2V0TG9jYXRpb24nLFxuICAgICAgICAgICAgICAgICdzMzpHZXRPYmplY3QnLFxuICAgICAgICAgICAgICAgICdzMzpMaXN0QnVja2V0JyxcbiAgICAgICAgICAgICAgICAnczM6TGlzdEJ1Y2tldE11bHRpcGFydFVwbG9hZHMnLFxuICAgICAgICAgICAgICAgICdzMzpQdXRPYmplY3QnLFxuICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICByZXNvdXJjZXM6IFtsb2dzQnVja2V0QXJuLCBgJHtsb2dzQnVja2V0QXJufS8qYF0sXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgYWN0aW9uczogWydsb2dzOlB1dExvZ0V2ZW50cyddLFxuICAgICAgICAgICAgICByZXNvdXJjZXM6IFtsb2cubG9nR3JvdXBBcm5dLFxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgXSxcbiAgICAgICAgfSksXG4gICAgICB9LFxuICAgIH0pXG4gICAgLy8gRGVjbGFyZSB0aGUgY2hhbm5lbC1zdGFibGUgaWRlbnRpdHkgb24gdGhlIHJvbGUgaXRzZWxmIChuZXZlciB0aGUgc3RhY2sg4oCUIGEgc3RhY2std2lkZSB0YWdcbiAgICAvLyBwcm9wYWdhdGVzIG9uZSBpZCBvbnRvIGV2ZXJ5IHJlc291cmNlIGFuZCBjb2xsYXBzZXMgdGhlbSksIHNvIHRoZSBwYXJpdHkgZ2F0ZSBjb21wYXJlcyBpdCBieVxuICAgIC8vIGRlY2xhcmVkIGlkIHJhdGhlciB0aGFuIGl0cyBuYW1lLWRlcml2ZWQgZGlzY3JpbWluYXRvci4gJ2FwaWFibGU6bG9naWNhbC1pZCcgaXMgdGhlIGdhdGUncyB0YWcga2V5LlxuICAgIGNvbnN0IGZpcmVob3NlUm9sZUxvZ2ljYWxJZCA9IHByb3BzLmZpcmVob3NlUm9sZUxvZ2ljYWxJZCA/PyBmaXJlaG9zZVJvbGVMb2dpY2FsSWRGb3JOYW1lKG5hbWUpXG4gICAgY2RrLlRhZ3Mub2YodGhpcy5kZWxpdmVyeVJvbGUpLmFkZCgnYXBpYWJsZTpsb2dpY2FsLWlkJywgZmlyZWhvc2VSb2xlTG9naWNhbElkKVxuXG4gICAgY29uc3Qgc3RyZWFtQ29uc3RydWN0SWQgPSBjZGsuVG9rZW4uaXNVbnJlc29sdmVkKG5hbWUpXG4gICAgICA/IEdBVEVXQVlfU1RSRUFNX05BTUVfUFJFRklYLnJlcGxhY2UoLy0kLywgJycpXG4gICAgICA6IGAke0dBVEVXQVlfU1RSRUFNX05BTUVfUFJFRklYfSR7bmFtZX1gXG4gICAgdGhpcy5kZWxpdmVyeVN0cmVhbSA9IG5ldyBraW5lc2lzZmlyZWhvc2UuQ2ZuRGVsaXZlcnlTdHJlYW0odGhpcywgc3RyZWFtQ29uc3RydWN0SWQsIHtcbiAgICAgIGRlbGl2ZXJ5U3RyZWFtTmFtZTogYCR7R0FURVdBWV9TVFJFQU1fTkFNRV9QUkVGSVh9JHtuYW1lfWAsIC8vIHRoZSBuYW1lIE1VU1Qgc3RhcnQgd2l0aCBhbWF6b24tYXBpZ2F0ZXdheS1cbiAgICAgIGRlbGl2ZXJ5U3RyZWFtVHlwZTogJ0RpcmVjdFB1dCcsXG4gICAgICBzM0Rlc3RpbmF0aW9uQ29uZmlndXJhdGlvbjoge1xuICAgICAgICBidWNrZXRBcm46IGxvZ3NCdWNrZXRBcm4sXG4gICAgICAgIHJvbGVBcm46IHRoaXMuZGVsaXZlcnlSb2xlLnJvbGVBcm4sXG4gICAgICAgIHByZWZpeDogYCR7cHJlZml4fS9sb2dzL2AsXG4gICAgICAgIGVycm9yT3V0cHV0UHJlZml4OiBgJHtwcmVmaXh9L2Vycm9ycy9gLFxuICAgICAgICBidWZmZXJpbmdIaW50czoge1xuICAgICAgICAgIGludGVydmFsSW5TZWNvbmRzOiAzMDAsXG4gICAgICAgICAgc2l6ZUluTUJzOiA1LFxuICAgICAgICB9LFxuICAgICAgICBjbG91ZFdhdGNoTG9nZ2luZ09wdGlvbnM6IHtcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIGxvZ0dyb3VwTmFtZTogbG9nLmxvZ0dyb3VwTmFtZSxcbiAgICAgICAgICBsb2dTdHJlYW1OYW1lOiBzdHJlYW0ubG9nU3RyZWFtTmFtZSxcbiAgICAgICAgfSxcbiAgICAgICAgY29tcHJlc3Npb25Gb3JtYXQ6ICdVTkNPTVBSRVNTRUQnLCAvLyBVTkNPTVBSRVNTRUQgfCBHWklQIHwgWklQIHwgU25hcHB5IHwgSEFET09QX1NOQVBQWVxuICAgICAgfSxcbiAgICB9KVxuXG4gICAgLy8gQSBjb25jcmV0ZSBuYW1lIGVtYmVkcyBpbiB0aGUgb3V0cHV0IGxvZ2ljYWwgaWQgZXhhY3RseSBhcyB0aGUgc3RhbmRhbG9uZSBkZXBsb3kgZXhwZWN0czsgYVxuICAgIC8vIHBhcmFtZXRlcmlzZWQgKHRva2VuKSBuYW1lIGNhbm5vdCBiZSBhIGxvZ2ljYWwgaWQsIHNvIHRoZSBwdWJsaXNoZWQgdGVtcGxhdGUgdXNlcyBhIHN0YWJsZSBpZC5cbiAgICAvLyBUaGUgaWQgbmFtZXMgdGhpcyBkaXN0cmlidXRpb24gb25jZSAobm8gZG91YmxlZCBgdXNhZ2Vsb2dzLXVzYWdlbG9ncy1gIHByZWZpeCk7IHBpbiBpdCBzbyB0aGVcbiAgICAvLyBvdXRwdXQga2V5IGlzIHN0YWJsZSBhbmQgbmFtZS1kZXJpdmVkIHJhdGhlciB0aGFuIGNhcnJ5aW5nIENESydzIGNvbnN0cnVjdC1wYXRoICsgaGFzaCBzdWZmaXguXG4gICAgY29uc3Qgb3V0cHV0SWQgPSBjZGsuVG9rZW4uaXNVbnJlc29sdmVkKG5hbWUpID8gJ0ZpcmVob3NlQXJuJyA6IGBmaXJlaG9zZS1hcm4tJHtuYW1lfWBcbiAgICB0aGlzLmZpcmVob3NlQXJuT3V0cHV0ID0gbmV3IENmbk91dHB1dCh0aGlzLCBvdXRwdXRJZCwgeyB2YWx1ZTogdGhpcy5kZWxpdmVyeVN0cmVhbS5hdHRyQXJuIH0pXG4gICAgdGhpcy5maXJlaG9zZUFybk91dHB1dC5vdmVycmlkZUxvZ2ljYWxJZChvdXRwdXRJZC5yZXBsYWNlKC9bXkEtWmEtejAtOV0vZywgJycpKVxuXG4gICAgaWYgKHByb3BzLnB1Ymxpc2hDb21wb3NpdGlvbikge1xuICAgICAgaWYgKCFwcm9wcy50ZW5hbnQpIHRocm93IG5ldyBFcnJvcigndGVuYW50IGlzIHJlcXVpcmVkIHRvIHB1Ymxpc2ggY29tcG9zaXRpb24gcGFyYW1ldGVycycpXG4gICAgICBwdWJsaXNoT3V0cHV0cyh0aGlzLCB7XG4gICAgICAgIHRlbmFudDogcHJvcHMudGVuYW50LFxuICAgICAgICBjb21wb25lbnQ6IHByb3BzLmNvbXBvc2l0aW9uQ29tcG9uZW50ID8/IFVTQUdFTE9HU19TVFJFQU1fQ09NUE9ORU5ULFxuICAgICAgICBvdXRwdXRzOiBbeyBuYW1lOiAnZmlyZWhvc2UtYXJuJywgdmFsdWU6IHRoaXMuZGVsaXZlcnlTdHJlYW0uYXR0ckFybiB9XSxcbiAgICAgIH0pXG4gICAgfVxuICB9XG59XG5cbi8qKiBTdGFjayBuYW1lIGNvbnZlbnRpb25zLCBkZWNsYXJlZC1idXQtdW51c2VkIGFjY291bnQvcmVnaW9uIGNhcnJpZWQgZm9yIGludGVyZmFjZSBwYXJpdHkgd2l0aCB0aGUgZGVwbG95IHNjcmlwdHMuICovXG5leHBvcnQgaW50ZXJmYWNlIEVudiBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgYWNjb3VudDogc3RyaW5nXG4gIHJlZ2lvbjogc3RyaW5nXG4gIGxvZ3NCdWNrZXRBcm46IHN0cmluZ1xuICBwcmVmaXg6IHN0cmluZ1xuICBuYW1lOiBzdHJpbmdcbn1cblxuZXhwb3J0IGludGVyZmFjZSBQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgZW52OiBFbnZcbn1cblxuLyoqXG4gKiBUaGluIHN0YWNrIHdyYXBwZXIgYXJvdW5kIHtAbGluayBMb2dzU3RyZWFtQ29uc3RydWN0fSBmb3Igc3RhbmRhbG9uZSBDRk4gc3ludGggYW5kIHVtYnJlbGxhXG4gKiBjb21wb3NpdGlvbi4gVGhlIGNvbnN0cnVjdG9yIGNvbnRyYWN0IOKAlCBhIFN0YWNrIHRha2luZyBgUHJvcHMgeyBlbnY6IEVudiB9YCDigJQgaXMgdGhlIG9uZSB0aGVcbiAqIGBkZXBsb3ktKi5zaGAgZ2VuZXJhdG9ycyBhbmQgdGhlIHVtYnJlbGxhJ3MgYGJ1aWxkTG9nc1N0cmVhbVN0YWNrYCBwYXNzLCBoZWxkIGNvbnN0YW50IHNvIGFuXG4gKiBleGlzdGluZyBjdXN0b20tZGVwbG95ZWQgc3RyZWFtIGlzIHVuY2hhbmdlZC5cbiAqL1xuZXhwb3J0IGNsYXNzIExvZ3NTdHJlYW0gZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgbG9nc1N0cmVhbTogTG9nc1N0cmVhbUNvbnN0cnVjdFxuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBQcm9wcykge1xuICAgIGNvbnN0IHsgbG9nc0J1Y2tldEFybiwgcHJlZml4LCBuYW1lIH0gPSBwcm9wcy5lbnZcblxuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpXG5cbiAgICB0aGlzLmxvZ3NTdHJlYW0gPSBuZXcgTG9nc1N0cmVhbUNvbnN0cnVjdCh0aGlzLCAnTG9nc1N0cmVhbScsIHsgbG9nc0J1Y2tldEFybiwgcHJlZml4LCBuYW1lIH0pXG4gIH1cbn1cblxuZXhwb3J0IGludGVyZmFjZSBMb2dzU3RyZWFtU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgLyoqXG4gICAqIEFSTiBvZiB0aGUgbG9nLXN0b3JhZ2UgYnVja2V0IHRoZSBzdHJlYW0gd3JpdGVzIHRvLiBPbWl0dGluZyBpdCAodGhlIHB1Ymxpc2hlZCBvbmUtY2xpY2sgcGF0aClcbiAgICogc3VyZmFjZXMgaXQgYXMgYSBkZXBsb3ktdGltZSBDRk4gcGFyYW1ldGVyIHRoZSBsYXVuY2ggbGluayBwcmUtZmlsbHMuXG4gICAqL1xuICByZWFkb25seSBsb2dzQnVja2V0QXJuPzogc3RyaW5nXG4gIC8qKiBSZXNvdXJjZS1uYW1lIHRva2VuIHRoZSBzdHJlYW0ncyBwaHlzaWNhbCBuYW1lcyBhcmUgc2NvcGVkIGJ5LiBEZWZhdWx0cyB0byB0aGUgdXNhZ2UtbG9nIG5hbWUuICovXG4gIHJlYWRvbmx5IG5hbWU/OiBzdHJpbmdcbiAgLyoqIFMzIGtleSBwcmVmaXggdGhlIHN0cmVhbSB3cml0ZXMgdW5kZXIuIERlZmF1bHRzIHRvIHRoZSB1c2FnZS1sb2cgcHJlZml4LiAqL1xuICByZWFkb25seSBwcmVmaXg/OiBzdHJpbmdcbiAgLyoqIEZvcndhcmRlZCB0byB7QGxpbmsgTG9nc1N0cmVhbUNvbnN0cnVjdFByb3BzLnRlbmFudH0uICovXG4gIHJlYWRvbmx5IHRlbmFudD86IHN0cmluZ1xuICAvKiogRm9yd2FyZGVkIHRvIHtAbGluayBMb2dzU3RyZWFtQ29uc3RydWN0UHJvcHMucHVibGlzaENvbXBvc2l0aW9ufS4gKi9cbiAgcmVhZG9ubHkgcHVibGlzaENvbXBvc2l0aW9uPzogYm9vbGVhblxuICAvKiogRm9yd2FyZGVkIHRvIHtAbGluayBMb2dzU3RyZWFtQ29uc3RydWN0UHJvcHMuY29tcG9zaXRpb25Db21wb25lbnR9LiAqL1xuICByZWFkb25seSBjb21wb3NpdGlvbkNvbXBvbmVudD86IHN0cmluZ1xuICAvKipcbiAgICogRGVmYXVsdCB0aGUgc3RyZWFtLW5hbWUgcGFyYW1ldGVyIGZhbGxzIGJhY2sgdG8gd2hlbiB7QGxpbmsgbmFtZX0gaXMgb21pdHRlZC4gRGVmYXVsdHMgdG8gdGhlXG4gICAqIHVzYWdlLWxvZyBkaXN0cmlidXRpb24ncyBuYW1lOyB0aGUgdG9rZW4gZGlzdHJpYnV0aW9uIHN1cHBsaWVzIGl0cyBvd24uXG4gICAqL1xuICByZWFkb25seSBkZWZhdWx0TmFtZT86IHN0cmluZ1xuICAvKipcbiAgICogRGVmYXVsdCB0aGUgZGVzdGluYXRpb24tcHJlZml4IHBhcmFtZXRlciBmYWxscyBiYWNrIHRvIHdoZW4ge0BsaW5rIHByZWZpeH0gaXMgb21pdHRlZC4gRGVmYXVsdHMgdG9cbiAgICogdGhlIHVzYWdlLWxvZyBkaXN0cmlidXRpb24ncyBwcmVmaXg7IHRoZSB0b2tlbiBkaXN0cmlidXRpb24gc3VwcGxpZXMgaXRzIG93bi5cbiAgICovXG4gIHJlYWRvbmx5IGRlZmF1bHRQcmVmaXg/OiBzdHJpbmdcbiAgLyoqIEZvcndhcmRlZCB0byB7QGxpbmsgTG9nc1N0cmVhbUNvbnN0cnVjdFByb3BzLmZpcmVob3NlUm9sZUxvZ2ljYWxJZH0gZm9yIHRoaXMgZGlzdHJpYnV0aW9uJ3MgcGFyaXR5IGlkZW50aXR5LiAqL1xuICByZWFkb25seSBmaXJlaG9zZVJvbGVMb2dpY2FsSWQ/OiBzdHJpbmdcbn1cblxuLyoqIFJlc291cmNlLW5hbWUgdG9rZW4gdGhlIHB1Ymxpc2hlZCBvbmUtY2xpY2sgc3RyZWFtIGlzIHNjb3BlZCBieSB3aGVuIG5vIG5hbWUgaXMgc3VwcGxpZWQuICovXG5leHBvcnQgY29uc3QgREVGQVVMVF9VU0FHRUxPR1NfTkFNRSA9ICd1c2FnZWxvZ3MnXG5cbi8qKiBSZXNvdXJjZS1uYW1lIHRva2VuIHRoZSBwdWJsaXNoZWQgb25lLWNsaWNrIHRva2VuIHN0cmVhbSBpcyBzY29wZWQgYnkgd2hlbiBubyBuYW1lIGlzIHN1cHBsaWVkLiAqL1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfVVNBR0VUT0tFTlNfTkFNRSA9ICd1c2FnZXRva2VucydcblxuLyoqXG4gKiBTdGFjayB3cmFwcGVyIHRoYXQgc3VyZmFjZXMgdGhlIHN0b3JhZ2UgbG9jYXRpb24gYXMgYSBkZXBsb3ktdGltZSBDRk4gcGFyYW1ldGVyIGZvciB0aGUgcHVibGlzaGVkXG4gKiBvbmUtY2xpY2sgdGVtcGxhdGU7IHRoZSBzdHJlYW0gbmFtZSArIHByZWZpeCBkZWZhdWx0IHRvIHRoaXMgZGlzdHJpYnV0aW9uJ3MgdmFsdWVzICh0aGUgdXNhZ2UtbG9nXG4gKiBkaXN0cmlidXRpb24ncyB1bmxlc3Mgb3ZlcnJpZGRlbiBmb3IgdGhlIHRva2VuIGRpc3RyaWJ1dGlvbikuXG4gKi9cbmV4cG9ydCBjbGFzcyBMb2dzU3RyZWFtU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgbG9nc1N0cmVhbTogTG9nc1N0cmVhbUNvbnN0cnVjdFxuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBMb2dzU3RyZWFtU3RhY2tQcm9wcyA9IHt9KSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcylcblxuICAgIGNvbnN0IGRlZmF1bHROYW1lID0gcHJvcHMuZGVmYXVsdE5hbWUgPz8gREVGQVVMVF9VU0FHRUxPR1NfTkFNRVxuICAgIGNvbnN0IGRlZmF1bHRQcmVmaXggPSBwcm9wcy5kZWZhdWx0UHJlZml4ID8/IERFRkFVTFRfVVNBR0VMT0dTX1BSRUZJWFxuXG4gICAgbGV0IGxvZ3NCdWNrZXRBcm4gPSBwcm9wcy5sb2dzQnVja2V0QXJuXG4gICAgaWYgKGxvZ3NCdWNrZXRBcm4gPT09IHVuZGVmaW5lZCkge1xuICAgICAgY29uc3QgbG9nc0J1Y2tldEFyblBhcmFtZXRlciA9IG5ldyBDZm5QYXJhbWV0ZXIodGhpcywgTE9HU19CVUNLRVRfQVJOX1BBUkFNRVRFUiwge1xuICAgICAgICB0eXBlOiAnU3RyaW5nJyxcbiAgICAgICAgbWluTGVuZ3RoOiAxLFxuICAgICAgICBhbGxvd2VkUGF0dGVybjogQlVDS0VUX0FSTl9QQVRURVJOX1NPVVJDRSxcbiAgICAgICAgZGVzY3JpcHRpb246ICdBUk4gb2YgdGhlIGxvZy1zdG9yYWdlIFMzIGJ1Y2tldCB0aGUgZGVsaXZlcnkgc3RyZWFtIHdyaXRlcyB0bycsXG4gICAgICAgIGNvbnN0cmFpbnREZXNjcmlwdGlvbjogJ211c3QgYmUgYSB2YWxpZCBTMyBidWNrZXQgQVJOIChhcm46YXdzOnMzOjo6PGJ1Y2tldD4pJyxcbiAgICAgIH0pXG4gICAgICBsb2dzQnVja2V0QXJuUGFyYW1ldGVyLm92ZXJyaWRlTG9naWNhbElkKExPR1NfQlVDS0VUX0FSTl9QQVJBTUVURVIpXG4gICAgICBsb2dzQnVja2V0QXJuID0gbG9nc0J1Y2tldEFyblBhcmFtZXRlci52YWx1ZUFzU3RyaW5nXG4gICAgfVxuXG4gICAgLy8gVGhlIHN0cmVhbSBuYW1lICsgZGVzdGluYXRpb24gcHJlZml4IGFyZSBkZXBsb3ktdGltZSBuYW1lZCB2YWx1ZXMgdG9vOyBvbWl0dGluZyB0aGVtIGtlZXBzIHRoaXNcbiAgICAvLyBkaXN0cmlidXRpb24ncyBkZWZhdWx0cywgc28gYSBvbmUtY2xpY2sgZGVwbG95IHdpdGggb25seSB0aGUgc3RvcmFnZSBsb2NhdGlvbiByZXByb2R1Y2VzIHRoZVxuICAgIC8vIGV4aXN0aW5nIHN0cmVhbSB3aGlsZSBhIGN1c3RvbWVyIGNhbiBzdGlsbCBvdmVycmlkZSBlaXRoZXIuXG4gICAgbGV0IG5hbWUgPSBwcm9wcy5uYW1lXG4gICAgaWYgKG5hbWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgY29uc3Qgc3RyZWFtTmFtZVBhcmFtZXRlciA9IG5ldyBDZm5QYXJhbWV0ZXIodGhpcywgU1RSRUFNX05BTUVfUEFSQU1FVEVSLCB7XG4gICAgICAgIHR5cGU6ICdTdHJpbmcnLFxuICAgICAgICBkZWZhdWx0OiBkZWZhdWx0TmFtZSxcbiAgICAgICAgbWluTGVuZ3RoOiAxLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ1Jlc291cmNlLW5hbWUgdG9rZW4gdGhlIHN0cmVhbSBpcyBzY29wZWQgYnkgKGFtYXpvbi1hcGlnYXRld2F5LTxuYW1lPiknLFxuICAgICAgfSlcbiAgICAgIHN0cmVhbU5hbWVQYXJhbWV0ZXIub3ZlcnJpZGVMb2dpY2FsSWQoU1RSRUFNX05BTUVfUEFSQU1FVEVSKVxuICAgICAgbmFtZSA9IHN0cmVhbU5hbWVQYXJhbWV0ZXIudmFsdWVBc1N0cmluZ1xuICAgIH1cblxuICAgIGxldCBwcmVmaXggPSBwcm9wcy5wcmVmaXhcbiAgICBpZiAocHJlZml4ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGNvbnN0IHByZWZpeFBhcmFtZXRlciA9IG5ldyBDZm5QYXJhbWV0ZXIodGhpcywgUFJFRklYX1BBUkFNRVRFUiwge1xuICAgICAgICB0eXBlOiAnU3RyaW5nJyxcbiAgICAgICAgZGVmYXVsdDogZGVmYXVsdFByZWZpeCxcbiAgICAgICAgbWluTGVuZ3RoOiAxLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ1MzIGtleSBwcmVmaXggdGhlIHN0cmVhbSB3cml0ZXMgaXRzIGxvZ3MvIGFuZCBlcnJvcnMvIHJlY29yZHMgdW5kZXInLFxuICAgICAgfSlcbiAgICAgIHByZWZpeFBhcmFtZXRlci5vdmVycmlkZUxvZ2ljYWxJZChQUkVGSVhfUEFSQU1FVEVSKVxuICAgICAgcHJlZml4ID0gcHJlZml4UGFyYW1ldGVyLnZhbHVlQXNTdHJpbmdcbiAgICB9XG5cbiAgICB0aGlzLmxvZ3NTdHJlYW0gPSBuZXcgTG9nc1N0cmVhbUNvbnN0cnVjdCh0aGlzLCAnTG9nc1N0cmVhbScsIHtcbiAgICAgIGxvZ3NCdWNrZXRBcm4sXG4gICAgICBuYW1lLFxuICAgICAgcHJlZml4LFxuICAgICAgdGVuYW50OiBwcm9wcy50ZW5hbnQsXG4gICAgICBwdWJsaXNoQ29tcG9zaXRpb246IHByb3BzLnB1Ymxpc2hDb21wb3NpdGlvbixcbiAgICAgIGNvbXBvc2l0aW9uQ29tcG9uZW50OiBwcm9wcy5jb21wb3NpdGlvbkNvbXBvbmVudCxcbiAgICAgIGZpcmVob3NlUm9sZUxvZ2ljYWxJZDogcHJvcHMuZmlyZWhvc2VSb2xlTG9naWNhbElkLFxuICAgIH0pXG4gIH1cbn1cblxuLyoqXG4gKiBCdWlsZCB0aGUgdXNhZ2UtbG9nLXN0cmVhbSBzdGFjayBhcyBwdWJsaXNoZWQgaW4gdGhlIGxhdW5jaC1zdGFjayB0ZW1wbGF0ZTogbm8gYGVudmAsIHNvIHRoZSByZWdpb25cbiAqIHJlc29sdmVzIHRvIEFXUzo6UmVnaW9uIGFuZCB0aGUgc3RvcmFnZSBsb2NhdGlvbiBzdGF5cyBhIGRlcGxveS10aW1lIHBhcmFtZXRlci5cbiAqXG4gKiBTaW5nbGUgc291cmNlIG9mIHRoZSBwdWJsaXNoLXRpbWUgc3ludGggY29uZmlnIHNvIHRoZSBhcnRpZmFjdCBhIGN1c3RvbWVyIG9uZS1jbGlja3MgaXMgZXhhY3RseSB3aGF0XG4gKiB0aGUgcHVibGlzaGVkLXN0YWNrIHNwZWMgYXNzZXJ0cy5cbiAqL1xuZXhwb3J0IGNvbnN0IGJ1aWxkUHVibGlzaGVkU3RhY2sgPSAoYXBwOiBjZGsuQXBwKTogTG9nc1N0cmVhbVN0YWNrID0+XG4gIG5ldyBMb2dzU3RyZWFtU3RhY2soYXBwLCBDT05TVFJVQ1RfTkFNRSwge1xuICAgIGRlc2NyaXB0aW9uOiAnQXBpYWJsZSBnYXRld2F5IHVzYWdlLWxvZyBkZWxpdmVyeSBzdHJlYW0g4oCUIG9uZS1jbGljayBwcm92aXNpb25pbmcnLFxuICAgIGFuYWx5dGljc1JlcG9ydGluZzogZmFsc2UsXG4gICAgLy8gYW4gYXNzZXQtbGVzcyBzdHJlYW0gbXVzdCBpbnN0YWxsIGludG8gYW4gdW4tYm9vdHN0cmFwcGVkIGFjY291bnQsIHNvIGRyb3AgdGhlIGJvb3RzdHJhcC12ZXJzaW9uIHJ1bGVcbiAgICBzeW50aGVzaXplcjogbmV3IGNkay5EZWZhdWx0U3RhY2tTeW50aGVzaXplcih7IGdlbmVyYXRlQm9vdHN0cmFwVmVyc2lvblJ1bGU6IGZhbHNlIH0pLFxuICB9KVxuXG4vKipcbiAqIEJ1aWxkIHRoZSBhcGkta2V5LXRva2VuLXN0cmVhbSBzdGFjayBhcyBwdWJsaXNoZWQgaW4gdGhlIGxhdW5jaC1zdGFjayB0ZW1wbGF0ZTogdGhlIHNhbWUgc2hhcmVkXG4gKiBzdHJlYW0gYXMge0BsaW5rIGJ1aWxkUHVibGlzaGVkU3RhY2t9LCBwdWJsaXNoZWQgdW5kZXIgdGhlIHRva2VuIGRpc3RyaWJ1dGlvbiBpZGVudGl0eSDigJQgaXRzXG4gKiBzdHJlYW0tbmFtZSBhbmQgZGVzdGluYXRpb24tcHJlZml4IHBhcmFtZXRlcnMgZGVmYXVsdCB0byB0aGUgdG9rZW4gdmFsdWVzIGFuZCBpdHMgZGVsaXZlcnkgcm9sZVxuICogY2FycmllcyB0aGUgdG9rZW4gcGFyaXR5IGlkZW50aXR5LiBUaGUgdG9rZW5pc2VkIG5hbWUgY2FycmllcyBubyB2YXJpYW50IHNpZ25hbCwgc28gdGhlIHRva2VuIHJvbGUgaWRcbiAqIGlzIHN1cHBsaWVkIGV4cGxpY2l0bHkgaGVyZS5cbiAqL1xuZXhwb3J0IGNvbnN0IGJ1aWxkUHVibGlzaGVkVG9rZW5zU3RhY2sgPSAoYXBwOiBjZGsuQXBwKTogTG9nc1N0cmVhbVN0YWNrID0+XG4gIG5ldyBMb2dzU3RyZWFtU3RhY2soYXBwLCBUT0tFTlNfQ09OU1RSVUNUX05BTUUsIHtcbiAgICBkZXNjcmlwdGlvbjogJ0FwaWFibGUgZ2F0ZXdheSBhcGkta2V5LXRva2VuIGRlbGl2ZXJ5IHN0cmVhbSDigJQgb25lLWNsaWNrIHByb3Zpc2lvbmluZycsXG4gICAgYW5hbHl0aWNzUmVwb3J0aW5nOiBmYWxzZSxcbiAgICBkZWZhdWx0TmFtZTogREVGQVVMVF9VU0FHRVRPS0VOU19OQU1FLFxuICAgIGRlZmF1bHRQcmVmaXg6IERFRkFVTFRfVVNBR0VUT0tFTlNfUFJFRklYLFxuICAgIGZpcmVob3NlUm9sZUxvZ2ljYWxJZDogRklSRUhPU0VfUk9MRV9MT0dJQ0FMX0lEX1RPS0VOUyxcbiAgICBjb21wb3NpdGlvbkNvbXBvbmVudDogVVNBR0VUT0tFTlNfU1RSRUFNX0NPTVBPTkVOVCxcbiAgICAvLyBhbiBhc3NldC1sZXNzIHN0cmVhbSBtdXN0IGluc3RhbGwgaW50byBhbiB1bi1ib290c3RyYXBwZWQgYWNjb3VudCwgc28gZHJvcCB0aGUgYm9vdHN0cmFwLXZlcnNpb24gcnVsZVxuICAgIHN5bnRoZXNpemVyOiBuZXcgY2RrLkRlZmF1bHRTdGFja1N5bnRoZXNpemVyKHsgZ2VuZXJhdGVCb290c3RyYXBWZXJzaW9uUnVsZTogZmFsc2UgfSksXG4gIH0pXG4iXX0=