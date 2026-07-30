"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPublishedStack = exports.LogsBucketStack = exports.LogsBucket = exports.LOGS_WRITE_ROLE_LOGICAL_ID = exports.LOGS_BUCKET_LOGICAL_ID = exports.LOGS_BUCKET_COMPONENT = exports.TENANT_NAME_PARAMETER = exports.PARTNER_ACCOUNT_PARAMETER = void 0;
const cdk = require("aws-cdk-lib");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const constructs_1 = require("constructs");
const s3 = require("aws-cdk-lib/aws-s3");
const iam = require("aws-cdk-lib/aws-iam");
const cdk_ssm_composition_1 = require("@apiable/cdk-ssm-composition");
const launch_stack_url_1 = require("./launch-stack-url");
/** Logical id of the cross-account write principal; the launch-stack URL pre-fills `param_<this>`. */
exports.PARTNER_ACCOUNT_PARAMETER = 'ApiablePartnerAccount';
/** Logical id of the tenant-name parameter the published template scopes the bucket by. */
exports.TENANT_NAME_PARAMETER = 'TenantName';
/** Kebab kit-component segment this construct publishes its outputs under. */
exports.LOGS_BUCKET_COMPONENT = 'logs-bucket';
/**
 * Author-declared, channel-identical identities the release-time parity gate keys the two taggable
 * primaries on (the `apiable:logical-id` tag), so each compares equal across the CDK, published-CFN,
 * and Terraform channels regardless of its tenant-scoped name. The hand-rolled Terraform module
 * declares the identical literals.
 */
exports.LOGS_BUCKET_LOGICAL_ID = 'apiable-logs-bucket';
exports.LOGS_WRITE_ROLE_LOGICAL_ID = 'apiable-logs-write-role';
/**
 * Apiable logs S3 bucket as a reusable construct: a tenant-scoped bucket, a resource policy granting
 * the tenant account and a single bounded partner account, and a role the partner assumes to write
 * logs. The partner account is a single bounded deployment parameter and the tenant account resolves
 * to the deploying account, so no customer- or Apiable-specific identifier is fixed in a resource.
 *
 * Retention posture is the existing one — the bucket is retained on update/delete and not
 * auto-emptied; this construct introduces no S3 lifecycle/expiry rule (deferred to the analytics
 * redesign).
 */
class LogsBucket extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        if (!props.name)
            throw new Error('name is required to scope the logs bucket');
        if (props.partnerAccount !== undefined && !launch_stack_url_1.ACCOUNT_ID_PATTERN.test(props.partnerAccount)) {
            throw new Error('partnerAccount must be exactly one 12-digit AWS account id');
        }
        const { name } = props;
        // The deploying account; resolves to the AWS::AccountId pseudo-parameter when no env is set, so
        // the published template carries no account literal, and to the supplied account otherwise.
        const account = cdk.Stack.of(this).account;
        this.partnerAccountParameter = new aws_cdk_lib_1.CfnParameter(this, exports.PARTNER_ACCOUNT_PARAMETER, {
            type: 'String',
            default: props.partnerAccount ?? launch_stack_url_1.DEFAULT_APIABLE_PARTNER_ACCOUNT,
            allowedPattern: launch_stack_url_1.ACCOUNT_ID_PATTERN_SOURCE,
            minLength: 12,
            maxLength: 12,
            description: 'AWS account allowed to write logs to the bucket and assume the log-writing role',
            constraintDescription: 'must be exactly one 12-digit AWS account id',
        });
        // Pin the logical id so the launch-stack URL's `param_ApiablePartnerAccount` addresses it.
        this.partnerAccountParameter.overrideLogicalId(exports.PARTNER_ACCOUNT_PARAMETER);
        const partnerAccount = this.partnerAccountParameter.valueAsString;
        this.bucket = new s3.Bucket(this, 'ApiableLogs', {
            bucketName: `apiable-logs-${name}`,
            removalPolicy: cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
            autoDeleteObjects: false,
        });
        // Declare the channel-stable identity per-resource (never the stack — that collapses every
        // resource onto one id), so the parity gate keys the bucket by declared id, not its tenant name.
        cdk.Tags.of(this.bucket).add('apiable:logical-id', exports.LOGS_BUCKET_LOGICAL_ID);
        this.bucket.addToResourcePolicy(new iam.PolicyStatement({
            sid: 'Permissions',
            effect: iam.Effect.ALLOW,
            principals: [
                new iam.ArnPrincipal(`arn:aws:iam::${account}:root`),
                new iam.ArnPrincipal(`arn:aws:iam::${partnerAccount}:root`),
            ],
            actions: ['s3:*'],
            resources: [this.bucket.bucketArn, `${this.bucket.bucketArn}/*`],
        }));
        this.writeRole = new iam.Role(this, 'WriteRole', {
            assumedBy: new iam.AccountPrincipal(partnerAccount),
            roleName: `apiable-logs-${name}-s3-role`,
            description: 'Role for partner account to Access the S3 Bucket',
        });
        cdk.Tags.of(this.writeRole).add('apiable:logical-id', exports.LOGS_WRITE_ROLE_LOGICAL_ID);
        this.writeRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            resources: [this.bucket.bucketArn, `${this.bucket.bucketArn}/*`],
            actions: ['s3:*'],
        }));
        // A concrete name embeds in the output logical ids exactly as the standalone deploy expects; a
        // parameterised (token) name cannot be a logical id, so the published template uses stable ids.
        const suffix = cdk.Token.isUnresolved(name) ? '' : name;
        new aws_cdk_lib_1.CfnOutput(this, `BucketName${suffix}`, {
            value: this.bucket.bucketName,
            description: 'The name of the S3 bucket',
        });
        new aws_cdk_lib_1.CfnOutput(this, `BucketArn${suffix}`, {
            value: this.bucket.bucketArn,
            description: 'The ARN of the S3 bucket',
        });
        new aws_cdk_lib_1.CfnOutput(this, cdk.Token.isUnresolved(name) ? 'S3AssumeRoleArn' : `s3-assume-role-${name}-arn`, {
            value: this.writeRole.roleArn,
            description: 'The ARN of the S3 bucket role',
        });
        if (props.publishComposition) {
            if (cdk.Token.isUnresolved(name)) {
                throw new Error('a concrete tenant name is required to publish composition parameters');
            }
            (0, cdk_ssm_composition_1.publishOutputs)(this, {
                tenant: name,
                component: exports.LOGS_BUCKET_COMPONENT,
                outputs: [
                    { name: 'bucket-name', value: this.bucket.bucketName },
                    { name: 'bucket-arn', value: this.bucket.bucketArn },
                    { name: 's3-assume-role-arn', value: this.writeRole.roleArn },
                ],
            });
        }
    }
}
exports.LogsBucket = LogsBucket;
/** Thin stack wrapper so the construct synthesizes standalone into the published template. */
class LogsBucketStack extends cdk.Stack {
    constructor(scope, id, props = {}) {
        super(scope, id, props);
        let name = props.name;
        if (name === undefined) {
            const tenantNameParameter = new aws_cdk_lib_1.CfnParameter(this, exports.TENANT_NAME_PARAMETER, {
                type: 'String',
                minLength: 1,
                allowedPattern: launch_stack_url_1.TENANT_NAME_PATTERN_SOURCE,
                description: 'Tenant identifier the logs bucket is scoped to (apiable-logs-<name>)',
                constraintDescription: 'must be lowercase letters, digits, and hyphens',
            });
            tenantNameParameter.overrideLogicalId(exports.TENANT_NAME_PARAMETER);
            name = tenantNameParameter.valueAsString;
        }
        this.logsBucket = new LogsBucket(this, 'LogsBucket', {
            name,
            partnerAccount: props.partnerAccount,
            publishComposition: props.publishComposition,
        });
    }
}
exports.LogsBucketStack = LogsBucketStack;
/**
 * Build the logs-bucket stack as published in the launch-stack template: no `env`, so the tenant
 * account resolves to AWS::AccountId, the region to AWS::Region, and the tenant name + partner
 * account stay deploy-time parameters.
 *
 * Single source of the publish-time synth config so the artifact a customer one-clicks is exactly
 * what the published-stack spec asserts.
 */
const buildPublishedStack = (app) => new LogsBucketStack(app, launch_stack_url_1.CONSTRUCT_NAME, {
    description: 'Apiable S3 bucket to write logs into — one-click provisioning',
    analyticsReporting: false,
    // an asset-less bucket must install into an un-bootstrapped account, so drop the bootstrap-version rule
    synthesizer: new cdk.DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
});
exports.buildPublishedStack = buildPublishedStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9ncy1idWNrZXQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJsb2dzLWJ1Y2tldC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBa0M7QUFDbEMsNkNBQXFEO0FBQ3JELDJDQUFzQztBQUN0Qyx5Q0FBd0M7QUFDeEMsMkNBQTBDO0FBQzFDLHNFQUE2RDtBQUM3RCx5REFNMkI7QUFFM0Isc0dBQXNHO0FBQ3pGLFFBQUEseUJBQXlCLEdBQUcsdUJBQXVCLENBQUE7QUFFaEUsMkZBQTJGO0FBQzlFLFFBQUEscUJBQXFCLEdBQUcsWUFBWSxDQUFBO0FBRWpELDhFQUE4RTtBQUNqRSxRQUFBLHFCQUFxQixHQUFHLGFBQWEsQ0FBQTtBQUVsRDs7Ozs7R0FLRztBQUNVLFFBQUEsc0JBQXNCLEdBQUcscUJBQXFCLENBQUE7QUFDOUMsUUFBQSwwQkFBMEIsR0FBRyx5QkFBeUIsQ0FBQTtBQW1CbkU7Ozs7Ozs7OztHQVNHO0FBQ0gsTUFBYSxVQUFXLFNBQVEsc0JBQVM7SUFLdkMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFBO1FBRWhCLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsMkNBQTJDLENBQUMsQ0FBQTtRQUM3RSxJQUFJLEtBQUssQ0FBQyxjQUFjLEtBQUssU0FBUyxJQUFJLENBQUMscUNBQWtCLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxjQUFjLENBQUMsRUFBRSxDQUFDO1lBQ3pGLE1BQU0sSUFBSSxLQUFLLENBQUMsNERBQTRELENBQUMsQ0FBQTtRQUMvRSxDQUFDO1FBRUQsTUFBTSxFQUFFLElBQUksRUFBRSxHQUFHLEtBQUssQ0FBQTtRQUN0QixnR0FBZ0c7UUFDaEcsNEZBQTRGO1FBQzVGLE1BQU0sT0FBTyxHQUFHLEdBQUcsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxD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SztJQUN6Qix3R0FBd0c7SUFDeEcsV0FBVyxFQUFFLElBQUksR0FBRyxDQUFDLHVCQUF1QixDQUFDLEVBQUUsNEJBQTRCLEVBQUUsS0FBSyxFQUFFLENBQUM7Q0FDdEYsQ0FBQyxDQUFBO0FBTlMsUUFBQSxtQkFBbUIsdUJBTTVCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJ1xuaW1wb3J0IHsgQ2ZuT3V0cHV0LCBDZm5QYXJhbWV0ZXIgfSBmcm9tICdhd3MtY2RrLWxpYidcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnXG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSdcbmltcG9ydCB7IHB1Ymxpc2hPdXRwdXRzIH0gZnJvbSAnQGFwaWFibGUvY2RrLXNzbS1jb21wb3NpdGlvbidcbmltcG9ydCB7XG4gIEFDQ09VTlRfSURfUEFUVEVSTixcbiAgQUNDT1VOVF9JRF9QQVRURVJOX1NPVVJDRSxcbiAgQ09OU1RSVUNUX05BTUUsXG4gIERFRkFVTFRfQVBJQUJMRV9QQVJUTkVSX0FDQ09VTlQsXG4gIFRFTkFOVF9OQU1FX1BBVFRFUk5fU09VUkNFLFxufSBmcm9tICcuL2xhdW5jaC1zdGFjay11cmwnXG5cbi8qKiBMb2dpY2FsIGlkIG9mIHRoZSBjcm9zcy1hY2NvdW50IHdyaXRlIHByaW5jaXBhbDsgdGhlIGxhdW5jaC1zdGFjayBVUkwgcHJlLWZpbGxzIGBwYXJhbV88dGhpcz5gLiAqL1xuZXhwb3J0IGNvbnN0IFBBUlRORVJfQUNDT1VOVF9QQVJBTUVURVIgPSAnQXBpYWJsZVBhcnRuZXJBY2NvdW50J1xuXG4vKiogTG9naWNhbCBpZCBvZiB0aGUgdGVuYW50LW5hbWUgcGFyYW1ldGVyIHRoZSBwdWJsaXNoZWQgdGVtcGxhdGUgc2NvcGVzIHRoZSBidWNrZXQgYnkuICovXG5leHBvcnQgY29uc3QgVEVOQU5UX05BTUVfUEFSQU1FVEVSID0gJ1RlbmFudE5hbWUnXG5cbi8qKiBLZWJhYiBraXQtY29tcG9uZW50IHNlZ21lbnQgdGhpcyBjb25zdHJ1Y3QgcHVibGlzaGVzIGl0cyBvdXRwdXRzIHVuZGVyLiAqL1xuZXhwb3J0IGNvbnN0IExPR1NfQlVDS0VUX0NPTVBPTkVOVCA9ICdsb2dzLWJ1Y2tldCdcblxuLyoqXG4gKiBBdXRob3ItZGVjbGFyZWQsIGNoYW5uZWwtaWRlbnRpY2FsIGlkZW50aXRpZXMgdGhlIHJlbGVhc2UtdGltZSBwYXJpdHkgZ2F0ZSBrZXlzIHRoZSB0d28gdGFnZ2FibGVcbiAqIHByaW1hcmllcyBvbiAodGhlIGBhcGlhYmxlOmxvZ2ljYWwtaWRgIHRhZyksIHNvIGVhY2ggY29tcGFyZXMgZXF1YWwgYWNyb3NzIHRoZSBDREssIHB1Ymxpc2hlZC1DRk4sXG4gKiBhbmQgVGVycmFmb3JtIGNoYW5uZWxzIHJlZ2FyZGxlc3Mgb2YgaXRzIHRlbmFudC1zY29wZWQgbmFtZS4gVGhlIGhhbmQtcm9sbGVkIFRlcnJhZm9ybSBtb2R1bGVcbiAqIGRlY2xhcmVzIHRoZSBpZGVudGljYWwgbGl0ZXJhbHMuXG4gKi9cbmV4cG9ydCBjb25zdCBMT0dTX0JVQ0tFVF9MT0dJQ0FMX0lEID0gJ2FwaWFibGUtbG9ncy1idWNrZXQnXG5leHBvcnQgY29uc3QgTE9HU19XUklURV9ST0xFX0xPR0lDQUxfSUQgPSAnYXBpYWJsZS1sb2dzLXdyaXRlLXJvbGUnXG5cbmV4cG9ydCBpbnRlcmZhY2UgTG9nc0J1Y2tldFByb3BzIHtcbiAgLyoqIFRlbmFudC9zdGFjayBpZGVudGlmaWVyIHRoZSBidWNrZXQgaXMgc2NvcGVkIHRvIOKAlCB0aGUgYnVja2V0IGlzIG5hbWVkIGBhcGlhYmxlLWxvZ3MtPG5hbWU+YC4gKi9cbiAgcmVhZG9ubHkgbmFtZTogc3RyaW5nXG4gIC8qKlxuICAgKiBBV1MgYWNjb3VudCBhbGxvd2VkIHRvIHdyaXRlIGxvZ3MgdG8gdGhlIGJ1Y2tldCBhbmQgYXNzdW1lIHRoZSBsb2ctd3JpdGluZyByb2xlLiBPbWl0dGluZyBpdFxuICAgKiBkZWZhdWx0cyB0byBBcGlhYmxlJ3MgcGFydG5lciBhY2NvdW50LCByZXByb2R1Y2luZyB0aGUgYnVja2V0IGV4aXN0aW5nIGN1c3RvbWVycyBhbHJlYWR5IHJ1bi5cbiAgICovXG4gIHJlYWRvbmx5IHBhcnRuZXJBY2NvdW50Pzogc3RyaW5nXG4gIC8qKlxuICAgKiBPcHQgaW4gdG8gcHVibGlzaGluZyB0aGlzIGNvbnN0cnVjdCdzIGRlY2xhcmVkIG91dHB1dHMgKGJ1Y2tldCBuYW1lLCBidWNrZXQgQVJOLCB3cml0ZS1yb2xlIEFSTilcbiAgICogdG8gdGhlIHNoYXJlZCBwYXJhbWV0ZXIgc3BhY2UgYXQgYC9hcGlhYmxlL3tuYW1lfS9sb2dzLWJ1Y2tldC97b3V0cHV0fWAuIE9mZiBieSBkZWZhdWx0IHNvIGFuXG4gICAqIGV4aXN0aW5nIGN1c3RvbWVyJ3Mgc3RhY2sgZ2FpbnMgbm8gbmV3IHBhcmFtZXRlciByZXNvdXJjZTsgdGhlIHRlbmFudCBrZXkgaXMgdGhlIGJ1Y2tldCdzXG4gICAqIHtAbGluayBMb2dzQnVja2V0UHJvcHMubmFtZX0uXG4gICAqL1xuICByZWFkb25seSBwdWJsaXNoQ29tcG9zaXRpb24/OiBib29sZWFuXG59XG5cbi8qKlxuICogQXBpYWJsZSBsb2dzIFMzIGJ1Y2tldCBhcyBhIHJldXNhYmxlIGNvbnN0cnVjdDogYSB0ZW5hbnQtc2NvcGVkIGJ1Y2tldCwgYSByZXNvdXJjZSBwb2xpY3kgZ3JhbnRpbmdcbiAqIHRoZSB0ZW5hbnQgYWNjb3VudCBhbmQgYSBzaW5nbGUgYm91bmRlZCBwYXJ0bmVyIGFjY291bnQsIGFuZCBhIHJvbGUgdGhlIHBhcnRuZXIgYXNzdW1lcyB0byB3cml0ZVxuICogbG9ncy4gVGhlIHBhcnRuZXIgYWNjb3VudCBpcyBhIHNpbmdsZSBib3VuZGVkIGRlcGxveW1lbnQgcGFyYW1ldGVyIGFuZCB0aGUgdGVuYW50IGFjY291bnQgcmVzb2x2ZXNcbiAqIHRvIHRoZSBkZXBsb3lpbmcgYWNjb3VudCwgc28gbm8gY3VzdG9tZXItIG9yIEFwaWFibGUtc3BlY2lmaWMgaWRlbnRpZmllciBpcyBmaXhlZCBpbiBhIHJlc291cmNlLlxuICpcbiAqIFJldGVudGlvbiBwb3N0dXJlIGlzIHRoZSBleGlzdGluZyBvbmUg4oCUIHRoZSBidWNrZXQgaXMgcmV0YWluZWQgb24gdXBkYXRlL2RlbGV0ZSBhbmQgbm90XG4gKiBhdXRvLWVtcHRpZWQ7IHRoaXMgY29uc3RydWN0IGludHJvZHVjZXMgbm8gUzMgbGlmZWN5Y2xlL2V4cGlyeSBydWxlIChkZWZlcnJlZCB0byB0aGUgYW5hbHl0aWNzXG4gKiByZWRlc2lnbikuXG4gKi9cbmV4cG9ydCBjbGFzcyBMb2dzQnVja2V0IGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgcHVibGljIHJlYWRvbmx5IGJ1Y2tldDogczMuQnVja2V0XG4gIHB1YmxpYyByZWFkb25seSB3cml0ZVJvbGU6IGlhbS5Sb2xlXG4gIHB1YmxpYyByZWFkb25seSBwYXJ0bmVyQWNjb3VudFBhcmFtZXRlcjogQ2ZuUGFyYW1ldGVyXG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IExvZ3NCdWNrZXRQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZClcblxuICAgIGlmICghcHJvcHMubmFtZSkgdGhyb3cgbmV3IEVycm9yKCduYW1lIGlzIHJlcXVpcmVkIHRvIHNjb3BlIHRoZSBsb2dzIGJ1Y2tldCcpXG4gICAgaWYgKHByb3BzLnBhcnRuZXJBY2NvdW50ICE9PSB1bmRlZmluZWQgJiYgIUFDQ09VTlRfSURfUEFUVEVSTi50ZXN0KHByb3BzLnBhcnRuZXJBY2NvdW50KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdwYXJ0bmVyQWNjb3VudCBtdXN0IGJlIGV4YWN0bHkgb25lIDEyLWRpZ2l0IEFXUyBhY2NvdW50IGlkJylcbiAgICB9XG5cbiAgICBjb25zdCB7IG5hbWUgfSA9IHByb3BzXG4gICAgLy8gVGhlIGRlcGxveWluZyBhY2NvdW50OyByZXNvbHZlcyB0byB0aGUgQVdTOjpBY2NvdW50SWQgcHNldWRvLXBhcmFtZXRlciB3aGVuIG5vIGVudiBpcyBzZXQsIHNvXG4gICAgLy8gdGhlIHB1Ymxpc2hlZCB0ZW1wbGF0ZSBjYXJyaWVzIG5vIGFjY291bnQgbGl0ZXJhbCwgYW5kIHRvIHRoZSBzdXBwbGllZCBhY2NvdW50IG90aGVyd2lzZS5cbiAgICBjb25zdCBhY2NvdW50ID0gY2RrLlN0YWNrLm9mKHRoaXMpLmFjY291bnRcblxuICAgIHRoaXMucGFydG5lckFjY291bnRQYXJhbWV0ZXIgPSBuZXcgQ2ZuUGFyYW1ldGVyKHRoaXMsIFBBUlRORVJfQUNDT1VOVF9QQVJBTUVURVIsIHtcbiAgICAgIHR5cGU6ICdTdHJpbmcnLFxuICAgICAgZGVmYXVsdDogcHJvcHMucGFydG5lckFjY291bnQgPz8gREVGQVVMVF9BUElBQkxFX1BBUlRORVJfQUNDT1VOVCxcbiAgICAgIGFsbG93ZWRQYXR0ZXJuOiBBQ0NPVU5UX0lEX1BBVFRFUk5fU09VUkNFLFxuICAgICAgbWluTGVuZ3RoOiAxMixcbiAgICAgIG1heExlbmd0aDogMTIsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FXUyBhY2NvdW50IGFsbG93ZWQgdG8gd3JpdGUgbG9ncyB0byB0aGUgYnVja2V0IGFuZCBhc3N1bWUgdGhlIGxvZy13cml0aW5nIHJvbGUnLFxuICAgICAgY29uc3RyYWludERlc2NyaXB0aW9uOiAnbXVzdCBiZSBleGFjdGx5IG9uZSAxMi1kaWdpdCBBV1MgYWNjb3VudCBpZCcsXG4gICAgfSlcbiAgICAvLyBQaW4gdGhlIGxvZ2ljYWwgaWQgc28gdGhlIGxhdW5jaC1zdGFjayBVUkwncyBgcGFyYW1fQXBpYWJsZVBhcnRuZXJBY2NvdW50YCBhZGRyZXNzZXMgaXQuXG4gICAgdGhpcy5wYXJ0bmVyQWNjb3VudFBhcmFtZXRlci5vdmVycmlkZUxvZ2ljYWxJZChQQVJUTkVSX0FDQ09VTlRfUEFSQU1FVEVSKVxuICAgIGNvbnN0IHBhcnRuZXJBY2NvdW50ID0gdGhpcy5wYXJ0bmVyQWNjb3VudFBhcmFtZXRlci52YWx1ZUFzU3RyaW5nXG5cbiAgICB0aGlzLmJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ0FwaWFibGVMb2dzJywge1xuICAgICAgYnVja2V0TmFtZTogYGFwaWFibGUtbG9ncy0ke25hbWV9YCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTl9PTl9VUERBVEVfT1JfREVMRVRFLFxuICAgICAgYXV0b0RlbGV0ZU9iamVjdHM6IGZhbHNlLFxuICAgIH0pXG4gICAgLy8gRGVjbGFyZSB0aGUgY2hhbm5lbC1zdGFibGUgaWRlbnRpdHkgcGVyLXJlc291cmNlIChuZXZlciB0aGUgc3RhY2sg4oCUIHRoYXQgY29sbGFwc2VzIGV2ZXJ5XG4gICAgLy8gcmVzb3VyY2Ugb250byBvbmUgaWQpLCBzbyB0aGUgcGFyaXR5IGdhdGUga2V5cyB0aGUgYnVja2V0IGJ5IGRlY2xhcmVkIGlkLCBub3QgaXRzIHRlbmFudCBuYW1lLlxuICAgIGNkay5UYWdzLm9mKHRoaXMuYnVja2V0KS5hZGQoJ2FwaWFibGU6bG9naWNhbC1pZCcsIExPR1NfQlVDS0VUX0xPR0lDQUxfSUQpXG5cbiAgICB0aGlzLmJ1Y2tldC5hZGRUb1Jlc291cmNlUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBzaWQ6ICdQZXJtaXNzaW9ucycsXG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgcHJpbmNpcGFsczogW1xuICAgICAgICAgIG5ldyBpYW0uQXJuUHJpbmNpcGFsKGBhcm46YXdzOmlhbTo6JHthY2NvdW50fTpyb290YCksXG4gICAgICAgICAgbmV3IGlhbS5Bcm5QcmluY2lwYWwoYGFybjphd3M6aWFtOjoke3BhcnRuZXJBY2NvdW50fTpyb290YCksXG4gICAgICAgIF0sXG4gICAgICAgIGFjdGlvbnM6IFsnczM6KiddLFxuICAgICAgICByZXNvdXJjZXM6IFt0aGlzLmJ1Y2tldC5idWNrZXRBcm4sIGAke3RoaXMuYnVja2V0LmJ1Y2tldEFybn0vKmBdLFxuICAgICAgfSksXG4gICAgKVxuXG4gICAgdGhpcy53cml0ZVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1dyaXRlUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5BY2NvdW50UHJpbmNpcGFsKHBhcnRuZXJBY2NvdW50KSxcbiAgICAgIHJvbGVOYW1lOiBgYXBpYWJsZS1sb2dzLSR7bmFtZX0tczMtcm9sZWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ1JvbGUgZm9yIHBhcnRuZXIgYWNjb3VudCB0byBBY2Nlc3MgdGhlIFMzIEJ1Y2tldCcsXG4gICAgfSlcbiAgICBjZGsuVGFncy5vZih0aGlzLndyaXRlUm9sZSkuYWRkKCdhcGlhYmxlOmxvZ2ljYWwtaWQnLCBMT0dTX1dSSVRFX1JPTEVfTE9HSUNBTF9JRClcblxuICAgIHRoaXMud3JpdGVSb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIHJlc291cmNlczogW3RoaXMuYnVja2V0LmJ1Y2tldEFybiwgYCR7dGhpcy5idWNrZXQuYnVja2V0QXJufS8qYF0sXG4gICAgICAgIGFjdGlvbnM6IFsnczM6KiddLFxuICAgICAgfSksXG4gICAgKVxuXG4gICAgLy8gQSBjb25jcmV0ZSBuYW1lIGVtYmVkcyBpbiB0aGUgb3V0cHV0IGxvZ2ljYWwgaWRzIGV4YWN0bHkgYXMgdGhlIHN0YW5kYWxvbmUgZGVwbG95IGV4cGVjdHM7IGFcbiAgICAvLyBwYXJhbWV0ZXJpc2VkICh0b2tlbikgbmFtZSBjYW5ub3QgYmUgYSBsb2dpY2FsIGlkLCBzbyB0aGUgcHVibGlzaGVkIHRlbXBsYXRlIHVzZXMgc3RhYmxlIGlkcy5cbiAgICBjb25zdCBzdWZmaXggPSBjZGsuVG9rZW4uaXNVbnJlc29sdmVkKG5hbWUpID8gJycgOiBuYW1lXG4gICAgbmV3IENmbk91dHB1dCh0aGlzLCBgQnVja2V0TmFtZSR7c3VmZml4fWAsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmJ1Y2tldC5idWNrZXROYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdUaGUgbmFtZSBvZiB0aGUgUzMgYnVja2V0JyxcbiAgICB9KVxuICAgIG5ldyBDZm5PdXRwdXQodGhpcywgYEJ1Y2tldEFybiR7c3VmZml4fWAsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmJ1Y2tldC5idWNrZXRBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ1RoZSBBUk4gb2YgdGhlIFMzIGJ1Y2tldCcsXG4gICAgfSlcbiAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsIGNkay5Ub2tlbi5pc1VucmVzb2x2ZWQobmFtZSkgPyAnUzNBc3N1bWVSb2xlQXJuJyA6IGBzMy1hc3N1bWUtcm9sZS0ke25hbWV9LWFybmAsIHtcbiAgICAgIHZhbHVlOiB0aGlzLndyaXRlUm9sZS5yb2xlQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdUaGUgQVJOIG9mIHRoZSBTMyBidWNrZXQgcm9sZScsXG4gICAgfSlcblxuICAgIGlmIChwcm9wcy5wdWJsaXNoQ29tcG9zaXRpb24pIHtcbiAgICAgIGlmIChjZGsuVG9rZW4uaXNVbnJlc29sdmVkKG5hbWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignYSBjb25jcmV0ZSB0ZW5hbnQgbmFtZSBpcyByZXF1aXJlZCB0byBwdWJsaXNoIGNvbXBvc2l0aW9uIHBhcmFtZXRlcnMnKVxuICAgICAgfVxuICAgICAgcHVibGlzaE91dHB1dHModGhpcywge1xuICAgICAgICB0ZW5hbnQ6IG5hbWUsXG4gICAgICAgIGNvbXBvbmVudDogTE9HU19CVUNLRVRfQ09NUE9ORU5ULFxuICAgICAgICBvdXRwdXRzOiBbXG4gICAgICAgICAgeyBuYW1lOiAnYnVja2V0LW5hbWUnLCB2YWx1ZTogdGhpcy5idWNrZXQuYnVja2V0TmFtZSB9LFxuICAgICAgICAgIHsgbmFtZTogJ2J1Y2tldC1hcm4nLCB2YWx1ZTogdGhpcy5idWNrZXQuYnVja2V0QXJuIH0sXG4gICAgICAgICAgeyBuYW1lOiAnczMtYXNzdW1lLXJvbGUtYXJuJywgdmFsdWU6IHRoaXMud3JpdGVSb2xlLnJvbGVBcm4gfSxcbiAgICAgICAgXSxcbiAgICAgIH0pXG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTG9nc0J1Y2tldFN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIC8qKlxuICAgKiBUZW5hbnQvc3RhY2sgaWRlbnRpZmllciB0aGUgYnVja2V0IGlzIHNjb3BlZCB0by4gT21pdHRpbmcgaXQgKHRoZSBwdWJsaXNoZWQgb25lLWNsaWNrIHBhdGgpXG4gICAqIHN1cmZhY2VzIHRoZSBuYW1lIGFzIGEgZGVwbG95LXRpbWUgQ0ZOIHBhcmFtZXRlciB0aGUgbGF1bmNoIGxpbmsgcHJlLWZpbGxzLlxuICAgKi9cbiAgcmVhZG9ubHkgbmFtZT86IHN0cmluZ1xuICAvKiogRm9yd2FyZGVkIHRvIHtAbGluayBMb2dzQnVja2V0UHJvcHMucGFydG5lckFjY291bnR9LiAqL1xuICByZWFkb25seSBwYXJ0bmVyQWNjb3VudD86IHN0cmluZ1xuICAvKiogRm9yd2FyZGVkIHRvIHtAbGluayBMb2dzQnVja2V0UHJvcHMucHVibGlzaENvbXBvc2l0aW9ufSAocmVxdWlyZXMgYSBjb25jcmV0ZSB7QGxpbmsgbmFtZX0pLiAqL1xuICByZWFkb25seSBwdWJsaXNoQ29tcG9zaXRpb24/OiBib29sZWFuXG59XG5cbi8qKiBUaGluIHN0YWNrIHdyYXBwZXIgc28gdGhlIGNvbnN0cnVjdCBzeW50aGVzaXplcyBzdGFuZGFsb25lIGludG8gdGhlIHB1Ymxpc2hlZCB0ZW1wbGF0ZS4gKi9cbmV4cG9ydCBjbGFzcyBMb2dzQnVja2V0U3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgbG9nc0J1Y2tldDogTG9nc0J1Y2tldFxuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBMb2dzQnVja2V0U3RhY2tQcm9wcyA9IHt9KSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcylcblxuICAgIGxldCBuYW1lID0gcHJvcHMubmFtZVxuICAgIGlmIChuYW1lID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGNvbnN0IHRlbmFudE5hbWVQYXJhbWV0ZXIgPSBuZXcgQ2ZuUGFyYW1ldGVyKHRoaXMsIFRFTkFOVF9OQU1FX1BBUkFNRVRFUiwge1xuICAgICAgICB0eXBlOiAnU3RyaW5nJyxcbiAgICAgICAgbWluTGVuZ3RoOiAxLFxuICAgICAgICBhbGxvd2VkUGF0dGVybjogVEVOQU5UX05BTUVfUEFUVEVSTl9TT1VSQ0UsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnVGVuYW50IGlkZW50aWZpZXIgdGhlIGxvZ3MgYnVja2V0IGlzIHNjb3BlZCB0byAoYXBpYWJsZS1sb2dzLTxuYW1lPiknLFxuICAgICAgICBjb25zdHJhaW50RGVzY3JpcHRpb246ICdtdXN0IGJlIGxvd2VyY2FzZSBsZXR0ZXJzLCBkaWdpdHMsIGFuZCBoeXBoZW5zJyxcbiAgICAgIH0pXG4gICAgICB0ZW5hbnROYW1lUGFyYW1ldGVyLm92ZXJyaWRlTG9naWNhbElkKFRFTkFOVF9OQU1FX1BBUkFNRVRFUilcbiAgICAgIG5hbWUgPSB0ZW5hbnROYW1lUGFyYW1ldGVyLnZhbHVlQXNTdHJpbmdcbiAgICB9XG5cbiAgICB0aGlzLmxvZ3NCdWNrZXQgPSBuZXcgTG9nc0J1Y2tldCh0aGlzLCAnTG9nc0J1Y2tldCcsIHtcbiAgICAgIG5hbWUsXG4gICAgICBwYXJ0bmVyQWNjb3VudDogcHJvcHMucGFydG5lckFjY291bnQsXG4gICAgICBwdWJsaXNoQ29tcG9zaXRpb246IHByb3BzLnB1Ymxpc2hDb21wb3NpdGlvbixcbiAgICB9KVxuICB9XG59XG5cbi8qKlxuICogQnVpbGQgdGhlIGxvZ3MtYnVja2V0IHN0YWNrIGFzIHB1Ymxpc2hlZCBpbiB0aGUgbGF1bmNoLXN0YWNrIHRlbXBsYXRlOiBubyBgZW52YCwgc28gdGhlIHRlbmFudFxuICogYWNjb3VudCByZXNvbHZlcyB0byBBV1M6OkFjY291bnRJZCwgdGhlIHJlZ2lvbiB0byBBV1M6OlJlZ2lvbiwgYW5kIHRoZSB0ZW5hbnQgbmFtZSArIHBhcnRuZXJcbiAqIGFjY291bnQgc3RheSBkZXBsb3ktdGltZSBwYXJhbWV0ZXJzLlxuICpcbiAqIFNpbmdsZSBzb3VyY2Ugb2YgdGhlIHB1Ymxpc2gtdGltZSBzeW50aCBjb25maWcgc28gdGhlIGFydGlmYWN0IGEgY3VzdG9tZXIgb25lLWNsaWNrcyBpcyBleGFjdGx5XG4gKiB3aGF0IHRoZSBwdWJsaXNoZWQtc3RhY2sgc3BlYyBhc3NlcnRzLlxuICovXG5leHBvcnQgY29uc3QgYnVpbGRQdWJsaXNoZWRTdGFjayA9IChhcHA6IGNkay5BcHApOiBMb2dzQnVja2V0U3RhY2sgPT5cbiAgbmV3IExvZ3NCdWNrZXRTdGFjayhhcHAsIENPTlNUUlVDVF9OQU1FLCB7XG4gICAgZGVzY3JpcHRpb246ICdBcGlhYmxlIFMzIGJ1Y2tldCB0byB3cml0ZSBsb2dzIGludG8g4oCUIG9uZS1jbGljayBwcm92aXNpb25pbmcnLFxuICAgIGFuYWx5dGljc1JlcG9ydGluZzogZmFsc2UsXG4gICAgLy8gYW4gYXNzZXQtbGVzcyBidWNrZXQgbXVzdCBpbnN0YWxsIGludG8gYW4gdW4tYm9vdHN0cmFwcGVkIGFjY291bnQsIHNvIGRyb3AgdGhlIGJvb3RzdHJhcC12ZXJzaW9uIHJ1bGVcbiAgICBzeW50aGVzaXplcjogbmV3IGNkay5EZWZhdWx0U3RhY2tTeW50aGVzaXplcih7IGdlbmVyYXRlQm9vdHN0cmFwVmVyc2lvblJ1bGU6IGZhbHNlIH0pLFxuICB9KVxuIl19