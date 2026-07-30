"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPublishedStack = exports.CognitoPoolStack = exports.CognitoPool = exports.PRE_TOKEN_FUNCTION_LOGICAL_ID = exports.COGNITO_POOL_LOGICAL_ID = exports.TIER_GUARD_ERROR = exports.MAX_SCOPES_PER_CLIENT = exports.ADMIN_SCOPE_NAME = exports.RESOURCE_SERVER_IDENTIFIER = exports.COGNITO_POOL_COMPONENT = exports.TENANT_NAME_PARAMETER = void 0;
const cdk = require("aws-cdk-lib");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const constructs_1 = require("constructs");
const cognito = require("aws-cdk-lib/aws-cognito");
const lambda = require("aws-cdk-lib/aws-lambda");
const path = require("path");
const cdk_ssm_composition_1 = require("@apiable/cdk-ssm-composition");
const launch_stack_url_1 = require("./launch-stack-url");
/** Logical id of the tenant-name parameter the published template scopes the pool by. */
exports.TENANT_NAME_PARAMETER = 'TenantName';
/** Kebab kit-component segment this construct publishes its outputs under. */
exports.COGNITO_POOL_COMPONENT = 'cognito-pool';
/** Resource-server identifier and the single admin scope the machine clients bind to. */
exports.RESOURCE_SERVER_IDENTIFIER = 'apiable';
exports.ADMIN_SCOPE_NAME = 'admin';
/** Cognito hard cap: scopes per app client. Bound sets stay well under it. */
exports.MAX_SCOPES_PER_CLIENT = 50;
/** The verbatim error a non-V3-capable feature plan fails with — never a silent fallback to V1/V2. */
exports.TIER_GUARD_ERROR = 'V3_0 PreTokenGen requires Cognito Essentials or Plus';
/**
 * Author-declared, channel-identical identities the release-time parity gate keys the pool and the
 * pre-token function on (the `apiable:logical-id` tag), so each compares equal across the CDK,
 * published-CFN, and Terraform channels regardless of its generated name, account, region, or tenant
 * segment. The hand-rolled Terraform module declares the identical literals; a pool that omits the tag
 * surfaces as an explicit parity divergence rather than being inferred from its name.
 */
exports.COGNITO_POOL_LOGICAL_ID = 'apiable-cognito-pool';
exports.PRE_TOKEN_FUNCTION_LOGICAL_ID = 'apiable-cognito-pool-pretoken-fn';
/**
 * Apiable machine-to-machine Cognito pool as a reusable construct: a single sign-in-disabled user pool
 * on a V3-capable feature plan, an `apiable` resource server with an `admin` scope, a `client_credentials`
 * app client bound to exactly that scope, and a V3_0 Pre Token Generation trigger that stamps the Apiable
 * claims into the access token. The consumers are OAuth2 app clients, not Cognito users, so there is no
 * user-attribute ceiling.
 *
 * `aws-cdk-lib` 2.137 cannot express the feature plan or the V3_0 trigger version through the L2
 * `UserPool`, so both are set as raw CloudFormation on the underlying `CfnUserPool` (the escape hatch);
 * bumping the lib re-synthesizes every construct, so the override is kept local to this pool.
 */
class CognitoPool extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        if (!props.name)
            throw new Error('name is required to scope the cognito pool');
        if (!cdk.Token.isUnresolved(props.name) && !launch_stack_url_1.TENANT_NAME_PATTERN.test(props.name)) {
            throw new Error('name must be lowercase letters, digits, and hyphens');
        }
        // Fail-loud tier guard: a plan that cannot run V3_0 never degrades to a V1 trigger that would ship
        // tokens unable to carry the enrichment and quietly break downstream scope enforcement.
        if (!launch_stack_url_1.FEATURE_PLANS_WITH_V3.includes(props.featurePlan)) {
            throw new Error(exports.TIER_GUARD_ERROR);
        }
        const { name, featurePlan } = props;
        const account = cdk.Stack.of(this).account;
        const region = cdk.Stack.of(this).region;
        // Machine-to-machine pool: no human sign-in (modelled on the existing AuthZ pool, not the sign-in
        // pool). Consumers are OAuth2 app clients, so self-sign-up is off and there are no sign-in aliases.
        this.pool = new cognito.UserPool(this, 'Pool', {
            userPoolName: `apiable-${name}`,
            deletionProtection: false,
            mfa: cognito.Mfa.OFF,
            selfSignUpEnabled: false,
            accountRecovery: cognito.AccountRecovery.NONE,
        });
        // Declare the channel-stable identity on the pool itself — never the stack, which collapses every
        // resource onto one id — so the parity gate keys it by declared id, not its tenant-scoped name.
        cdk.Tags.of(this.pool).add('apiable:logical-id', exports.COGNITO_POOL_LOGICAL_ID);
        const cfnPool = this.pool.node.defaultChild;
        // ESSENTIALS/PLUS is mandatory for V3_0 Pre Token Generation; not expressible via the L2 UserPool.
        cfnPool.addPropertyOverride('UserPoolTier', featurePlan);
        const adminScope = new cognito.ResourceServerScope({
            scopeName: exports.ADMIN_SCOPE_NAME,
            scopeDescription: 'Full Access to the Apiable APIs',
        });
        this.resourceServer = this.pool.addResourceServer('ResourceServer', {
            userPoolResourceServerName: exports.RESOURCE_SERVER_IDENTIFIER,
            identifier: exports.RESOURCE_SERVER_IDENTIFIER,
            scopes: [adminScope],
        });
        // Render the hosted-UI domain as `apiable-<name>` identically on every channel (the published CFN
        // and Terraform channels cannot string-substitute a token name, so the CDK channel must not either).
        // A reserved Cognito substring (`aws`) fails the deploy identically across channels; cross-channel
        // reserved-name normalisation is a separate concern owned by the parity-gate capability slice.
        this.pool.addDomain('CognitoDomain', { cognitoDomain: { domainPrefix: `apiable-${name}` } });
        // The machine consumer: client_credentials, bound to exactly the admin scope. Cognito issues the
        // `scope` claim natively from this allowed set — the pool cannot widen the bound scopes.
        this.client = new cognito.UserPoolClient(this, 'Client', {
            userPool: this.pool,
            userPoolClientName: 'apiable',
            generateSecret: true,
            oAuth: {
                flows: { clientCredentials: true },
                scopes: [cognito.OAuthScope.resourceServer(this.resourceServer, adminScope)],
            },
        });
        this.preTokenFunction = new lambda.Function(this, 'PreTokenGen', {
            functionName: `apiable-${name}-pretokengen`,
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../assets/lambdas/cognito-pool-pretokengen')),
            environment: {
                // Both claim sources have no machine-to-machine producer yet (no user => no user-attribute), so
                // both ship empty and are set explicitly to make the empty intentional. apiable_plan_resources
                // empty makes the authorizer grant the invoked API on a scope-pass; apiable_api_key empty means
                // the consumer sends no usageIdentifierKey. Per-client binding is deferred to a dedicated binding
                // story. The live entitlement is the native `scope` claim.
                APIABLE_API_KEY: '',
                APIABLE_PLAN_RESOURCES: '',
            },
        });
        cdk.Tags.of(this.preTokenFunction).add('apiable:logical-id', exports.PRE_TOKEN_FUNCTION_LOGICAL_ID);
        // Attach the trigger as raw CloudFormation: the L2 UserPool at this CDK version cannot set V3_0.
        cfnPool.addPropertyOverride('LambdaConfig.PreTokenGenerationConfig.LambdaArn', this.preTokenFunction.functionArn);
        cfnPool.addPropertyOverride('LambdaConfig.PreTokenGenerationConfig.LambdaVersion', 'V3_0');
        // Cognito must be allowed to invoke the trigger. Scope to the account's user pools rather than this
        // pool's ARN so the permission does not depend on the pool, which would create a create-time cycle
        // with the LambdaConfig above; the permission must exist before Cognito validates the trigger.
        const cognitoInvokePermission = new lambda.CfnPermission(this, 'CognitoInvokePreTokenGen', {
            action: 'lambda:InvokeFunction',
            functionName: this.preTokenFunction.functionArn,
            principal: 'cognito-idp.amazonaws.com',
            sourceArn: `arn:aws:cognito-idp:${region}:${account}:userpool/*`,
        });
        cfnPool.node.addDependency(cognitoInvokePermission);
        const suffix = cdk.Token.isUnresolved(name) ? '' : name;
        new aws_cdk_lib_1.CfnOutput(this, `UserPoolId${suffix}`, {
            value: this.pool.userPoolId,
            description: 'The id of the Cognito user pool',
        });
        new aws_cdk_lib_1.CfnOutput(this, `IssuerUri${suffix}`, {
            value: `https://cognito-idp.${region}.amazonaws.com/${this.pool.userPoolId}`,
            description: 'The OIDC issuer URI of the Cognito user pool',
        });
        new aws_cdk_lib_1.CfnOutput(this, `ClientId${suffix}`, {
            value: this.client.userPoolClientId,
            description: 'The id of the client_credentials app client',
        });
        if (props.publishComposition) {
            if (cdk.Token.isUnresolved(name)) {
                throw new Error('a concrete tenant name is required to publish composition parameters');
            }
            // Non-secret outputs only — publishOutputs refuses secret outputs, so the client secret is never
            // relayed through the plaintext parameter seam.
            (0, cdk_ssm_composition_1.publishOutputs)(this, {
                tenant: name,
                component: exports.COGNITO_POOL_COMPONENT,
                outputs: [
                    { name: 'userpool-id', value: this.pool.userPoolId },
                    { name: 'issuer-uri', value: `https://cognito-idp.${region}.amazonaws.com/${this.pool.userPoolId}` },
                    { name: 'client-id', value: this.client.userPoolClientId },
                ],
            });
        }
    }
}
exports.CognitoPool = CognitoPool;
/** Thin stack wrapper so the construct synthesizes standalone into the published template. */
class CognitoPoolStack extends cdk.Stack {
    constructor(scope, id, props = {}) {
        super(scope, id, props);
        let name = props.name;
        if (name === undefined) {
            const tenantNameParameter = new aws_cdk_lib_1.CfnParameter(this, exports.TENANT_NAME_PARAMETER, {
                type: 'String',
                minLength: 1,
                allowedPattern: launch_stack_url_1.TENANT_NAME_PATTERN_SOURCE,
                description: 'Tenant identifier the cognito pool is scoped to (apiable-<name>)',
                constraintDescription: 'must be lowercase letters, digits, and hyphens',
            });
            tenantNameParameter.overrideLogicalId(exports.TENANT_NAME_PARAMETER);
            name = tenantNameParameter.valueAsString;
        }
        this.cognitoPool = new CognitoPool(this, 'CognitoPool', {
            name,
            featurePlan: props.featurePlan ?? 'ESSENTIALS',
            publishComposition: props.publishComposition,
        });
    }
}
exports.CognitoPoolStack = CognitoPoolStack;
/**
 * Build the cognito-pool stack as published in the launch-stack template: no `env`, so the account
 * resolves to AWS::AccountId, the region to AWS::Region, and the tenant name stays a deploy-time
 * parameter. Single source of the publish-time synth config so the artifact a customer one-clicks is
 * exactly what the published-stack spec asserts.
 */
const buildPublishedStack = (app) => new CognitoPoolStack(app, launch_stack_url_1.CONSTRUCT_NAME, {
    description: 'Apiable Cognito machine-to-machine pool with V3_0 token customisation — one-click provisioning',
    analyticsReporting: false,
    synthesizer: new cdk.DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
});
exports.buildPublishedStack = buildPublishedStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29nbml0by1wb29sLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY29nbml0by1wb29sLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFrQztBQUNsQyw2Q0FBcUQ7QUFDckQsMkNBQXNDO0FBQ3RDLG1EQUFrRDtBQUNsRCxpREFBZ0Q7QUFDaEQsNkJBQTRCO0FBQzVCLHNFQUE2RDtBQUM3RCx5REFNMkI7QUFFM0IseUZBQXlGO0FBQzVFLFFBQUEscUJBQXFCLEdBQUcsWUFBWSxDQUFBO0FBRWpELDhFQUE4RTtBQUNqRSxRQUFBLHNCQUFzQixHQUFHLGNBQWMsQ0FBQTtBQUVwRCx5RkFBeUY7QUFDNUUsUUFBQSwwQkFBMEIsR0FBRyxTQUFTLENBQUE7QUFDdEMsUUFBQSxnQkFBZ0IsR0FBRyxPQUFPLENBQUE7QUFFdkMsOEVBQThFO0FBQ2pFLFFBQUEscUJBQXFCLEdBQUcsRUFBRSxDQUFBO0FBRXZDLHNHQUFzRztBQUN6RixRQUFBLGdCQUFnQixHQUFHLHNEQUFzRCxDQUFBO0FBRXRGOzs7Ozs7R0FNRztBQUNVLFFBQUEsdUJBQXVCLEdBQUcsc0JBQXNCLENBQUE7QUFDaEQsUUFBQSw2QkFBNkIsR0FBRyxrQ0FBa0MsQ0FBQTtBQW1CL0U7Ozs7Ozs7Ozs7R0FVRztBQUNILE1BQWEsV0FBWSxTQUFRLHNCQUFTO0lBTXhDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBdUI7UUFDL0QsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQTtRQUVoQixJQUFJLENBQUMsS0FBSyxDQUFDLElBQUk7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDRDQUE0QyxDQUFDLENBQUE7UUFDOUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLHNDQUFtQixDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUNqRixNQUFN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QyxHQUFZLEVBQW9CLEVBQUUsQ0FDcEUsSUFBSSxnQkFBZ0IsQ0FBQyxHQUFHLEVBQUUsaUNBQWMsRUFBRTtJQUN4QyxXQUFXLEVBQUUsZ0dBQWdHO0lBQzdHLGtCQUFrQixFQUFFLEtBQUs7SUFDekIsV0FBVyxFQUFFLElBQUksR0FBRyxDQUFDLHVCQUF1QixDQUFDLEVBQUUsNEJBQTRCLEVBQUUsS0FBSyxFQUFFLENBQUM7Q0FDdEYsQ0FBQyxDQUFBO0FBTFMsUUFBQSxtQkFBbUIsdUJBSzVCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJ1xuaW1wb3J0IHsgQ2ZuT3V0cHV0LCBDZm5QYXJhbWV0ZXIgfSBmcm9tICdhd3MtY2RrLWxpYidcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnXG5pbXBvcnQgKiBhcyBjb2duaXRvIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jb2duaXRvJ1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnXG5pbXBvcnQgeyBwdWJsaXNoT3V0cHV0cyB9IGZyb20gJ0BhcGlhYmxlL2Nkay1zc20tY29tcG9zaXRpb24nXG5pbXBvcnQge1xuICBDT05TVFJVQ1RfTkFNRSxcbiAgRkVBVFVSRV9QTEFOU19XSVRIX1YzLFxuICBGZWF0dXJlUGxhbixcbiAgVEVOQU5UX05BTUVfUEFUVEVSTixcbiAgVEVOQU5UX05BTUVfUEFUVEVSTl9TT1VSQ0UsXG59IGZyb20gJy4vbGF1bmNoLXN0YWNrLXVybCdcblxuLyoqIExvZ2ljYWwgaWQgb2YgdGhlIHRlbmFudC1uYW1lIHBhcmFtZXRlciB0aGUgcHVibGlzaGVkIHRlbXBsYXRlIHNjb3BlcyB0aGUgcG9vbCBieS4gKi9cbmV4cG9ydCBjb25zdCBURU5BTlRfTkFNRV9QQVJBTUVURVIgPSAnVGVuYW50TmFtZSdcblxuLyoqIEtlYmFiIGtpdC1jb21wb25lbnQgc2VnbWVudCB0aGlzIGNvbnN0cnVjdCBwdWJsaXNoZXMgaXRzIG91dHB1dHMgdW5kZXIuICovXG5leHBvcnQgY29uc3QgQ09HTklUT19QT09MX0NPTVBPTkVOVCA9ICdjb2duaXRvLXBvb2wnXG5cbi8qKiBSZXNvdXJjZS1zZXJ2ZXIgaWRlbnRpZmllciBhbmQgdGhlIHNpbmdsZSBhZG1pbiBzY29wZSB0aGUgbWFjaGluZSBjbGllbnRzIGJpbmQgdG8uICovXG5leHBvcnQgY29uc3QgUkVTT1VSQ0VfU0VSVkVSX0lERU5USUZJRVIgPSAnYXBpYWJsZSdcbmV4cG9ydCBjb25zdCBBRE1JTl9TQ09QRV9OQU1FID0gJ2FkbWluJ1xuXG4vKiogQ29nbml0byBoYXJkIGNhcDogc2NvcGVzIHBlciBhcHAgY2xpZW50LiBCb3VuZCBzZXRzIHN0YXkgd2VsbCB1bmRlciBpdC4gKi9cbmV4cG9ydCBjb25zdCBNQVhfU0NPUEVTX1BFUl9DTElFTlQgPSA1MFxuXG4vKiogVGhlIHZlcmJhdGltIGVycm9yIGEgbm9uLVYzLWNhcGFibGUgZmVhdHVyZSBwbGFuIGZhaWxzIHdpdGgg4oCUIG5ldmVyIGEgc2lsZW50IGZhbGxiYWNrIHRvIFYxL1YyLiAqL1xuZXhwb3J0IGNvbnN0IFRJRVJfR1VBUkRfRVJST1IgPSAnVjNfMCBQcmVUb2tlbkdlbiByZXF1aXJlcyBDb2duaXRvIEVzc2VudGlhbHMgb3IgUGx1cydcblxuLyoqXG4gKiBBdXRob3ItZGVjbGFyZWQsIGNoYW5uZWwtaWRlbnRpY2FsIGlkZW50aXRpZXMgdGhlIHJlbGVhc2UtdGltZSBwYXJpdHkgZ2F0ZSBrZXlzIHRoZSBwb29sIGFuZCB0aGVcbiAqIHByZS10b2tlbiBmdW5jdGlvbiBvbiAodGhlIGBhcGlhYmxlOmxvZ2ljYWwtaWRgIHRhZyksIHNvIGVhY2ggY29tcGFyZXMgZXF1YWwgYWNyb3NzIHRoZSBDREssXG4gKiBwdWJsaXNoZWQtQ0ZOLCBhbmQgVGVycmFmb3JtIGNoYW5uZWxzIHJlZ2FyZGxlc3Mgb2YgaXRzIGdlbmVyYXRlZCBuYW1lLCBhY2NvdW50LCByZWdpb24sIG9yIHRlbmFudFxuICogc2VnbWVudC4gVGhlIGhhbmQtcm9sbGVkIFRlcnJhZm9ybSBtb2R1bGUgZGVjbGFyZXMgdGhlIGlkZW50aWNhbCBsaXRlcmFsczsgYSBwb29sIHRoYXQgb21pdHMgdGhlIHRhZ1xuICogc3VyZmFjZXMgYXMgYW4gZXhwbGljaXQgcGFyaXR5IGRpdmVyZ2VuY2UgcmF0aGVyIHRoYW4gYmVpbmcgaW5mZXJyZWQgZnJvbSBpdHMgbmFtZS5cbiAqL1xuZXhwb3J0IGNvbnN0IENPR05JVE9fUE9PTF9MT0dJQ0FMX0lEID0gJ2FwaWFibGUtY29nbml0by1wb29sJ1xuZXhwb3J0IGNvbnN0IFBSRV9UT0tFTl9GVU5DVElPTl9MT0dJQ0FMX0lEID0gJ2FwaWFibGUtY29nbml0by1wb29sLXByZXRva2VuLWZuJ1xuXG5leHBvcnQgaW50ZXJmYWNlIENvZ25pdG9Qb29sUHJvcHMge1xuICAvKiogVGVuYW50L3N0YWNrIGlkZW50aWZpZXIgdGhlIHBvb2wgaXMgc2NvcGVkIHRvIOKAlCB0aGUgcG9vbCBpcyBuYW1lZCBgYXBpYWJsZS08bmFtZT5gLiAqL1xuICByZWFkb25seSBuYW1lOiBzdHJpbmdcbiAgLyoqXG4gICAqIENvZ25pdG8gZmVhdHVyZSBwbGFuIHRoZSBwb29sIGlzIHByb3Zpc2lvbmVkIG9uLiBSZXF1aXJlZCBhbmQgc2VsZi1kZWNsYXJlZDogVjNfMCBQcmUgVG9rZW5cbiAgICogR2VuZXJhdGlvbiBydW5zIG9ubHkgb24gRVNTRU5USUFMUyBvciBQTFVTLCBzbyBMSVRFIChvciBhbnkgb3RoZXIgdmFsdWUpIGZhaWxzIHRoZSBkZXBsb3kgbG91ZGx5XG4gICAqIHJhdGhlciB0aGFuIHNpbGVudGx5IGRlZ3JhZGluZyB0byBhIFYxIHRyaWdnZXIgdGhhdCBjYW5ub3QgZW5yaWNoIGEgbWFjaGluZS10by1tYWNoaW5lIHRva2VuLlxuICAgKi9cbiAgcmVhZG9ubHkgZmVhdHVyZVBsYW46IEZlYXR1cmVQbGFuXG4gIC8qKlxuICAgKiBPcHQgaW4gdG8gcHVibGlzaGluZyB0aGlzIGNvbnN0cnVjdCdzIG5vbi1zZWNyZXQgZGVjbGFyZWQgb3V0cHV0cyAodXNlci1wb29sIGlkLCBpc3N1ZXIgVVJJKSB0b1xuICAgKiB0aGUgc2hhcmVkIHBhcmFtZXRlciBzcGFjZSBhdCBgL2FwaWFibGUve25hbWV9L2NvZ25pdG8tcG9vbC97b3V0cHV0fWAsIHNvIHRoZSBhdXRob3JpemVyIGNhblxuICAgKiByZXNvbHZlIGB1c2VycG9vbElkYCBieSBrZXkuIE9mZiBieSBkZWZhdWx0LiBDbGllbnQgc2VjcmV0cyBhcmUgbmV2ZXIgcHVibGlzaGVkIHRocm91Z2ggdGhpcyBzZWFtLlxuICAgKi9cbiAgcmVhZG9ubHkgcHVibGlzaENvbXBvc2l0aW9uPzogYm9vbGVhblxufVxuXG4vKipcbiAqIEFwaWFibGUgbWFjaGluZS10by1tYWNoaW5lIENvZ25pdG8gcG9vbCBhcyBhIHJldXNhYmxlIGNvbnN0cnVjdDogYSBzaW5nbGUgc2lnbi1pbi1kaXNhYmxlZCB1c2VyIHBvb2xcbiAqIG9uIGEgVjMtY2FwYWJsZSBmZWF0dXJlIHBsYW4sIGFuIGBhcGlhYmxlYCByZXNvdXJjZSBzZXJ2ZXIgd2l0aCBhbiBgYWRtaW5gIHNjb3BlLCBhIGBjbGllbnRfY3JlZGVudGlhbHNgXG4gKiBhcHAgY2xpZW50IGJvdW5kIHRvIGV4YWN0bHkgdGhhdCBzY29wZSwgYW5kIGEgVjNfMCBQcmUgVG9rZW4gR2VuZXJhdGlvbiB0cmlnZ2VyIHRoYXQgc3RhbXBzIHRoZSBBcGlhYmxlXG4gKiBjbGFpbXMgaW50byB0aGUgYWNjZXNzIHRva2VuLiBUaGUgY29uc3VtZXJzIGFyZSBPQXV0aDIgYXBwIGNsaWVudHMsIG5vdCBDb2duaXRvIHVzZXJzLCBzbyB0aGVyZSBpcyBub1xuICogdXNlci1hdHRyaWJ1dGUgY2VpbGluZy5cbiAqXG4gKiBgYXdzLWNkay1saWJgIDIuMTM3IGNhbm5vdCBleHByZXNzIHRoZSBmZWF0dXJlIHBsYW4gb3IgdGhlIFYzXzAgdHJpZ2dlciB2ZXJzaW9uIHRocm91Z2ggdGhlIEwyXG4gKiBgVXNlclBvb2xgLCBzbyBib3RoIGFyZSBzZXQgYXMgcmF3IENsb3VkRm9ybWF0aW9uIG9uIHRoZSB1bmRlcmx5aW5nIGBDZm5Vc2VyUG9vbGAgKHRoZSBlc2NhcGUgaGF0Y2gpO1xuICogYnVtcGluZyB0aGUgbGliIHJlLXN5bnRoZXNpemVzIGV2ZXJ5IGNvbnN0cnVjdCwgc28gdGhlIG92ZXJyaWRlIGlzIGtlcHQgbG9jYWwgdG8gdGhpcyBwb29sLlxuICovXG5leHBvcnQgY2xhc3MgQ29nbml0b1Bvb2wgZXh0ZW5kcyBDb25zdHJ1Y3Qge1xuICBwdWJsaWMgcmVhZG9ubHkgcG9vbDogY29nbml0by5Vc2VyUG9vbFxuICBwdWJsaWMgcmVhZG9ubHkgcmVzb3VyY2VTZXJ2ZXI6IGNvZ25pdG8uVXNlclBvb2xSZXNvdXJjZVNlcnZlclxuICBwdWJsaWMgcmVhZG9ubHkgY2xpZW50OiBjb2duaXRvLlVzZXJQb29sQ2xpZW50XG4gIHB1YmxpYyByZWFkb25seSBwcmVUb2tlbkZ1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb25cblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQ29nbml0b1Bvb2xQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZClcblxuICAgIGlmICghcHJvcHMubmFtZSkgdGhyb3cgbmV3IEVycm9yKCduYW1lIGlzIHJlcXVpcmVkIHRvIHNjb3BlIHRoZSBjb2duaXRvIHBvb2wnKVxuICAgIGlmICghY2RrLlRva2VuLmlzVW5yZXNvbHZlZChwcm9wcy5uYW1lKSAmJiAhVEVOQU5UX05BTUVfUEFUVEVSTi50ZXN0KHByb3BzLm5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ25hbWUgbXVzdCBiZSBsb3dlcmNhc2UgbGV0dGVycywgZGlnaXRzLCBhbmQgaHlwaGVucycpXG4gICAgfVxuICAgIC8vIEZhaWwtbG91ZCB0aWVyIGd1YXJkOiBhIHBsYW4gdGhhdCBjYW5ub3QgcnVuIFYzXzAgbmV2ZXIgZGVncmFkZXMgdG8gYSBWMSB0cmlnZ2VyIHRoYXQgd291bGQgc2hpcFxuICAgIC8vIHRva2VucyB1bmFibGUgdG8gY2FycnkgdGhlIGVucmljaG1lbnQgYW5kIHF1aWV0bHkgYnJlYWsgZG93bnN0cmVhbSBzY29wZSBlbmZvcmNlbWVudC5cbiAgICBpZiAoIShGRUFUVVJFX1BMQU5TX1dJVEhfVjMgYXMgcmVhZG9ubHkgc3RyaW5nW10pLmluY2x1ZGVzKHByb3BzLmZlYXR1cmVQbGFuKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFRJRVJfR1VBUkRfRVJST1IpXG4gICAgfVxuXG4gICAgY29uc3QgeyBuYW1lLCBmZWF0dXJlUGxhbiB9ID0gcHJvcHNcbiAgICBjb25zdCBhY2NvdW50ID0gY2RrLlN0YWNrLm9mKHRoaXMpLmFjY291bnRcbiAgICBjb25zdCByZWdpb24gPSBjZGsuU3RhY2sub2YodGhpcykucmVnaW9uXG5cbiAgICAvLyBNYWNoaW5lLXRvLW1hY2hpbmUgcG9vbDogbm8gaHVtYW4gc2lnbi1pbiAobW9kZWxsZWQgb24gdGhlIGV4aXN0aW5nIEF1dGhaIHBvb2wsIG5vdCB0aGUgc2lnbi1pblxuICAgIC8vIHBvb2wpLiBDb25zdW1lcnMgYXJlIE9BdXRoMiBhcHAgY2xpZW50cywgc28gc2VsZi1zaWduLXVwIGlzIG9mZiBhbmQgdGhlcmUgYXJlIG5vIHNpZ24taW4gYWxpYXNlcy5cbiAgICB0aGlzLnBvb2wgPSBuZXcgY29nbml0by5Vc2VyUG9vbCh0aGlzLCAnUG9vbCcsIHtcbiAgICAgIHVzZXJQb29sTmFtZTogYGFwaWFibGUtJHtuYW1lfWAsXG4gICAgICBkZWxldGlvblByb3RlY3Rpb246IGZhbHNlLFxuICAgICAgbWZhOiBjb2duaXRvLk1mYS5PRkYsXG4gICAgICBzZWxmU2lnblVwRW5hYmxlZDogZmFsc2UsXG4gICAgICBhY2NvdW50UmVjb3Zlcnk6IGNvZ25pdG8uQWNjb3VudFJlY292ZXJ5Lk5PTkUsXG4gICAgfSlcbiAgICAvLyBEZWNsYXJlIHRoZSBjaGFubmVsLXN0YWJsZSBpZGVudGl0eSBvbiB0aGUgcG9vbCBpdHNlbGYg4oCUIG5ldmVyIHRoZSBzdGFjaywgd2hpY2ggY29sbGFwc2VzIGV2ZXJ5XG4gICAgLy8gcmVzb3VyY2Ugb250byBvbmUgaWQg4oCUIHNvIHRoZSBwYXJpdHkgZ2F0ZSBrZXlzIGl0IGJ5IGRlY2xhcmVkIGlkLCBub3QgaXRzIHRlbmFudC1zY29wZWQgbmFtZS5cbiAgICBjZGsuVGFncy5vZih0aGlzLnBvb2wpLmFkZCgnYXBpYWJsZTpsb2dpY2FsLWlkJywgQ09HTklUT19QT09MX0xPR0lDQUxfSUQpXG5cbiAgICBjb25zdCBjZm5Qb29sID0gdGhpcy5wb29sLm5vZGUuZGVmYXVsdENoaWxkIGFzIGNvZ25pdG8uQ2ZuVXNlclBvb2xcbiAgICAvLyBFU1NFTlRJQUxTL1BMVVMgaXMgbWFuZGF0b3J5IGZvciBWM18wIFByZSBUb2tlbiBHZW5lcmF0aW9uOyBub3QgZXhwcmVzc2libGUgdmlhIHRoZSBMMiBVc2VyUG9vbC5cbiAgICBjZm5Qb29sLmFkZFByb3BlcnR5T3ZlcnJpZGUoJ1VzZXJQb29sVGllcicsIGZlYXR1cmVQbGFuKVxuXG4gICAgY29uc3QgYWRtaW5TY29wZSA9IG5ldyBjb2duaXRvLlJlc291cmNlU2VydmVyU2NvcGUoe1xuICAgICAgc2NvcGVOYW1lOiBBRE1JTl9TQ09QRV9OQU1FLFxuICAgICAgc2NvcGVEZXNjcmlwdGlvbjogJ0Z1bGwgQWNjZXNzIHRvIHRoZSBBcGlhYmxlIEFQSXMnLFxuICAgIH0pXG5cbiAgICB0aGlzLnJlc291cmNlU2VydmVyID0gdGhpcy5wb29sLmFkZFJlc291cmNlU2VydmVyKCdSZXNvdXJjZVNlcnZlcicsIHtcbiAgICAgIHVzZXJQb29sUmVzb3VyY2VTZXJ2ZXJOYW1lOiBSRVNPVVJDRV9TRVJWRVJfSURFTlRJRklFUixcbiAgICAgIGlkZW50aWZpZXI6IFJFU09VUkNFX1NFUlZFUl9JREVOVElGSUVSLFxuICAgICAgc2NvcGVzOiBbYWRtaW5TY29wZV0sXG4gICAgfSlcblxuICAgIC8vIFJlbmRlciB0aGUgaG9zdGVkLVVJIGRvbWFpbiBhcyBgYXBpYWJsZS08bmFtZT5gIGlkZW50aWNhbGx5IG9uIGV2ZXJ5IGNoYW5uZWwgKHRoZSBwdWJsaXNoZWQgQ0ZOXG4gICAgLy8gYW5kIFRlcnJhZm9ybSBjaGFubmVscyBjYW5ub3Qgc3RyaW5nLXN1YnN0aXR1dGUgYSB0b2tlbiBuYW1lLCBzbyB0aGUgQ0RLIGNoYW5uZWwgbXVzdCBub3QgZWl0aGVyKS5cbiAgICAvLyBBIHJlc2VydmVkIENvZ25pdG8gc3Vic3RyaW5nIChgYXdzYCkgZmFpbHMgdGhlIGRlcGxveSBpZGVudGljYWxseSBhY3Jvc3MgY2hhbm5lbHM7IGNyb3NzLWNoYW5uZWxcbiAgICAvLyByZXNlcnZlZC1uYW1lIG5vcm1hbGlzYXRpb24gaXMgYSBzZXBhcmF0ZSBjb25jZXJuIG93bmVkIGJ5IHRoZSBwYXJpdHktZ2F0ZSBjYXBhYmlsaXR5IHNsaWNlLlxuICAgIHRoaXMucG9vbC5hZGREb21haW4oJ0NvZ25pdG9Eb21haW4nLCB7IGNvZ25pdG9Eb21haW46IHsgZG9tYWluUHJlZml4OiBgYXBpYWJsZS0ke25hbWV9YCB9IH0pXG5cbiAgICAvLyBUaGUgbWFjaGluZSBjb25zdW1lcjogY2xpZW50X2NyZWRlbnRpYWxzLCBib3VuZCB0byBleGFjdGx5IHRoZSBhZG1pbiBzY29wZS4gQ29nbml0byBpc3N1ZXMgdGhlXG4gICAgLy8gYHNjb3BlYCBjbGFpbSBuYXRpdmVseSBmcm9tIHRoaXMgYWxsb3dlZCBzZXQg4oCUIHRoZSBwb29sIGNhbm5vdCB3aWRlbiB0aGUgYm91bmQgc2NvcGVzLlxuICAgIHRoaXMuY2xpZW50ID0gbmV3IGNvZ25pdG8uVXNlclBvb2xDbGllbnQodGhpcywgJ0NsaWVudCcsIHtcbiAgICAgIHVzZXJQb29sOiB0aGlzLnBvb2wsXG4gICAgICB1c2VyUG9vbENsaWVudE5hbWU6ICdhcGlhYmxlJyxcbiAgICAgIGdlbmVyYXRlU2VjcmV0OiB0cnVlLFxuICAgICAgb0F1dGg6IHtcbiAgICAgICAgZmxvd3M6IHsgY2xpZW50Q3JlZGVudGlhbHM6IHRydWUgfSxcbiAgICAgICAgc2NvcGVzOiBbY29nbml0by5PQXV0aFNjb3BlLnJlc291cmNlU2VydmVyKHRoaXMucmVzb3VyY2VTZXJ2ZXIsIGFkbWluU2NvcGUpXSxcbiAgICAgIH0sXG4gICAgfSlcblxuICAgIHRoaXMucHJlVG9rZW5GdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1ByZVRva2VuR2VuJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiBgYXBpYWJsZS0ke25hbWV9LXByZXRva2VuZ2VuYCxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9hc3NldHMvbGFtYmRhcy9jb2duaXRvLXBvb2wtcHJldG9rZW5nZW4nKSksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAvLyBCb3RoIGNsYWltIHNvdXJjZXMgaGF2ZSBubyBtYWNoaW5lLXRvLW1hY2hpbmUgcHJvZHVjZXIgeWV0IChubyB1c2VyID0+IG5vIHVzZXItYXR0cmlidXRlKSwgc29cbiAgICAgICAgLy8gYm90aCBzaGlwIGVtcHR5IGFuZCBhcmUgc2V0IGV4cGxpY2l0bHkgdG8gbWFrZSB0aGUgZW1wdHkgaW50ZW50aW9uYWwuIGFwaWFibGVfcGxhbl9yZXNvdXJjZXNcbiAgICAgICAgLy8gZW1wdHkgbWFrZXMgdGhlIGF1dGhvcml6ZXIgZ3JhbnQgdGhlIGludm9rZWQgQVBJIG9uIGEgc2NvcGUtcGFzczsgYXBpYWJsZV9hcGlfa2V5IGVtcHR5IG1lYW5zXG4gICAgICAgIC8vIHRoZSBjb25zdW1lciBzZW5kcyBubyB1c2FnZUlkZW50aWZpZXJLZXkuIFBlci1jbGllbnQgYmluZGluZyBpcyBkZWZlcnJlZCB0byBhIGRlZGljYXRlZCBiaW5kaW5nXG4gICAgICAgIC8vIHN0b3J5LiBUaGUgbGl2ZSBlbnRpdGxlbWVudCBpcyB0aGUgbmF0aXZlIGBzY29wZWAgY2xhaW0uXG4gICAgICAgIEFQSUFCTEVfQVBJX0tFWTogJycsXG4gICAgICAgIEFQSUFCTEVfUExBTl9SRVNPVVJDRVM6ICcnLFxuICAgICAgfSxcbiAgICB9KVxuICAgIGNkay5UYWdzLm9mKHRoaXMucHJlVG9rZW5GdW5jdGlvbikuYWRkKCdhcGlhYmxlOmxvZ2ljYWwtaWQnLCBQUkVfVE9LRU5fRlVOQ1RJT05fTE9HSUNBTF9JRClcblxuICAgIC8vIEF0dGFjaCB0aGUgdHJpZ2dlciBhcyByYXcgQ2xvdWRGb3JtYXRpb246IHRoZSBMMiBVc2VyUG9vbCBhdCB0aGlzIENESyB2ZXJzaW9uIGNhbm5vdCBzZXQgVjNfMC5cbiAgICBjZm5Qb29sLmFkZFByb3BlcnR5T3ZlcnJpZGUoXG4gICAgICAnTGFtYmRhQ29uZmlnLlByZVRva2VuR2VuZXJhdGlvbkNvbmZpZy5MYW1iZGFBcm4nLFxuICAgICAgdGhpcy5wcmVUb2tlbkZ1bmN0aW9uLmZ1bmN0aW9uQXJuLFxuICAgIClcbiAgICBjZm5Qb29sLmFkZFByb3BlcnR5T3ZlcnJpZGUoJ0xhbWJkYUNvbmZpZy5QcmVUb2tlbkdlbmVyYXRpb25Db25maWcuTGFtYmRhVmVyc2lvbicsICdWM18wJylcblxuICAgIC8vIENvZ25pdG8gbXVzdCBiZSBhbGxvd2VkIHRvIGludm9rZSB0aGUgdHJpZ2dlci4gU2NvcGUgdG8gdGhlIGFjY291bnQncyB1c2VyIHBvb2xzIHJhdGhlciB0aGFuIHRoaXNcbiAgICAvLyBwb29sJ3MgQVJOIHNvIHRoZSBwZXJtaXNzaW9uIGRvZXMgbm90IGRlcGVuZCBvbiB0aGUgcG9vbCwgd2hpY2ggd291bGQgY3JlYXRlIGEgY3JlYXRlLXRpbWUgY3ljbGVcbiAgICAvLyB3aXRoIHRoZSBMYW1iZGFDb25maWcgYWJvdmU7IHRoZSBwZXJtaXNzaW9uIG11c3QgZXhpc3QgYmVmb3JlIENvZ25pdG8gdmFsaWRhdGVzIHRoZSB0cmlnZ2VyLlxuICAgIGNvbnN0IGNvZ25pdG9JbnZva2VQZXJtaXNzaW9uID0gbmV3IGxhbWJkYS5DZm5QZXJtaXNzaW9uKHRoaXMsICdDb2duaXRvSW52b2tlUHJlVG9rZW5HZW4nLCB7XG4gICAgICBhY3Rpb246ICdsYW1iZGE6SW52b2tlRnVuY3Rpb24nLFxuICAgICAgZnVuY3Rpb25OYW1lOiB0aGlzLnByZVRva2VuRnVuY3Rpb24uZnVuY3Rpb25Bcm4sXG4gICAgICBwcmluY2lwYWw6ICdjb2duaXRvLWlkcC5hbWF6b25hd3MuY29tJyxcbiAgICAgIHNvdXJjZUFybjogYGFybjphd3M6Y29nbml0by1pZHA6JHtyZWdpb259OiR7YWNjb3VudH06dXNlcnBvb2wvKmAsXG4gICAgfSlcbiAgICBjZm5Qb29sLm5vZGUuYWRkRGVwZW5kZW5jeShjb2duaXRvSW52b2tlUGVybWlzc2lvbilcblxuICAgIGNvbnN0IHN1ZmZpeCA9IGNkay5Ub2tlbi5pc1VucmVzb2x2ZWQobmFtZSkgPyAnJyA6IG5hbWVcbiAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsIGBVc2VyUG9vbElkJHtzdWZmaXh9YCwge1xuICAgICAgdmFsdWU6IHRoaXMucG9vbC51c2VyUG9vbElkLFxuICAgICAgZGVzY3JpcHRpb246ICdUaGUgaWQgb2YgdGhlIENvZ25pdG8gdXNlciBwb29sJyxcbiAgICB9KVxuICAgIG5ldyBDZm5PdXRwdXQodGhpcywgYElzc3VlclVyaSR7c3VmZml4fWAsIHtcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly9jb2duaXRvLWlkcC4ke3JlZ2lvbn0uYW1hem9uYXdzLmNvbS8ke3RoaXMucG9vbC51c2VyUG9vbElkfWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ1RoZSBPSURDIGlzc3VlciBVUkkgb2YgdGhlIENvZ25pdG8gdXNlciBwb29sJyxcbiAgICB9KVxuICAgIG5ldyBDZm5PdXRwdXQodGhpcywgYENsaWVudElkJHtzdWZmaXh9YCwge1xuICAgICAgdmFsdWU6IHRoaXMuY2xpZW50LnVzZXJQb29sQ2xpZW50SWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ1RoZSBpZCBvZiB0aGUgY2xpZW50X2NyZWRlbnRpYWxzIGFwcCBjbGllbnQnLFxuICAgIH0pXG5cbiAgICBpZiAocHJvcHMucHVibGlzaENvbXBvc2l0aW9uKSB7XG4gICAgICBpZiAoY2RrLlRva2VuLmlzVW5yZXNvbHZlZChuYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2EgY29uY3JldGUgdGVuYW50IG5hbWUgaXMgcmVxdWlyZWQgdG8gcHVibGlzaCBjb21wb3NpdGlvbiBwYXJhbWV0ZXJzJylcbiAgICAgIH1cbiAgICAgIC8vIE5vbi1zZWNyZXQgb3V0cHV0cyBvbmx5IOKAlCBwdWJsaXNoT3V0cHV0cyByZWZ1c2VzIHNlY3JldCBvdXRwdXRzLCBzbyB0aGUgY2xpZW50IHNlY3JldCBpcyBuZXZlclxuICAgICAgLy8gcmVsYXllZCB0aHJvdWdoIHRoZSBwbGFpbnRleHQgcGFyYW1ldGVyIHNlYW0uXG4gICAgICBwdWJsaXNoT3V0cHV0cyh0aGlzLCB7XG4gICAgICAgIHRlbmFudDogbmFtZSxcbiAgICAgICAgY29tcG9uZW50OiBDT0dOSVRPX1BPT0xfQ09NUE9ORU5ULFxuICAgICAgICBvdXRwdXRzOiBbXG4gICAgICAgICAgeyBuYW1lOiAndXNlcnBvb2wtaWQnLCB2YWx1ZTogdGhpcy5wb29sLnVzZXJQb29sSWQgfSxcbiAgICAgICAgICB7IG5hbWU6ICdpc3N1ZXItdXJpJywgdmFsdWU6IGBodHRwczovL2NvZ25pdG8taWRwLiR7cmVnaW9ufS5hbWF6b25hd3MuY29tLyR7dGhpcy5wb29sLnVzZXJQb29sSWR9YCB9LFxuICAgICAgICAgIHsgbmFtZTogJ2NsaWVudC1pZCcsIHZhbHVlOiB0aGlzLmNsaWVudC51c2VyUG9vbENsaWVudElkIH0sXG4gICAgICAgIF0sXG4gICAgICB9KVxuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIENvZ25pdG9Qb29sU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgLyoqXG4gICAqIFRlbmFudC9zdGFjayBpZGVudGlmaWVyIHRoZSBwb29sIGlzIHNjb3BlZCB0by4gT21pdHRpbmcgaXQgKHRoZSBwdWJsaXNoZWQgb25lLWNsaWNrIHBhdGgpIHN1cmZhY2VzXG4gICAqIHRoZSBuYW1lIGFzIGEgZGVwbG95LXRpbWUgQ0ZOIHBhcmFtZXRlciB0aGUgbGF1bmNoIGxpbmsgcHJlLWZpbGxzLlxuICAgKi9cbiAgcmVhZG9ubHkgbmFtZT86IHN0cmluZ1xuICAvKipcbiAgICogQ29nbml0byBmZWF0dXJlIHBsYW4uIEZvcndhcmRlZCB0byB7QGxpbmsgQ29nbml0b1Bvb2xQcm9wcy5mZWF0dXJlUGxhbn07IGRlZmF1bHRzIHRvIEVTU0VOVElBTFNcbiAgICogKHRoZSBsb3dlc3QgVjMtY2FwYWJsZSB0aWVyKSBzbyB0aGUgcHVibGlzaGVkIG9uZS1jbGljayBzdGFjayBwcm92aXNpb25zIGEgd29ya2luZyBWM18wIHBvb2wuXG4gICAqL1xuICByZWFkb25seSBmZWF0dXJlUGxhbj86IEZlYXR1cmVQbGFuXG4gIC8qKiBGb3J3YXJkZWQgdG8ge0BsaW5rIENvZ25pdG9Qb29sUHJvcHMucHVibGlzaENvbXBvc2l0aW9ufSAocmVxdWlyZXMgYSBjb25jcmV0ZSB7QGxpbmsgbmFtZX0pLiAqL1xuICByZWFkb25seSBwdWJsaXNoQ29tcG9zaXRpb24/OiBib29sZWFuXG59XG5cbi8qKiBUaGluIHN0YWNrIHdyYXBwZXIgc28gdGhlIGNvbnN0cnVjdCBzeW50aGVzaXplcyBzdGFuZGFsb25lIGludG8gdGhlIHB1Ymxpc2hlZCB0ZW1wbGF0ZS4gKi9cbmV4cG9ydCBjbGFzcyBDb2duaXRvUG9vbFN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IGNvZ25pdG9Qb29sOiBDb2duaXRvUG9vbFxuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBDb2duaXRvUG9vbFN0YWNrUHJvcHMgPSB7fSkge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpXG5cbiAgICBsZXQgbmFtZSA9IHByb3BzLm5hbWVcbiAgICBpZiAobmFtZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCB0ZW5hbnROYW1lUGFyYW1ldGVyID0gbmV3IENmblBhcmFtZXRlcih0aGlzLCBURU5BTlRfTkFNRV9QQVJBTUVURVIsIHtcbiAgICAgICAgdHlwZTogJ1N0cmluZycsXG4gICAgICAgIG1pbkxlbmd0aDogMSxcbiAgICAgICAgYWxsb3dlZFBhdHRlcm46IFRFTkFOVF9OQU1FX1BBVFRFUk5fU09VUkNFLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ1RlbmFudCBpZGVudGlmaWVyIHRoZSBjb2duaXRvIHBvb2wgaXMgc2NvcGVkIHRvIChhcGlhYmxlLTxuYW1lPiknLFxuICAgICAgICBjb25zdHJhaW50RGVzY3JpcHRpb246ICdtdXN0IGJlIGxvd2VyY2FzZSBsZXR0ZXJzLCBkaWdpdHMsIGFuZCBoeXBoZW5zJyxcbiAgICAgIH0pXG4gICAgICB0ZW5hbnROYW1lUGFyYW1ldGVyLm92ZXJyaWRlTG9naWNhbElkKFRFTkFOVF9OQU1FX1BBUkFNRVRFUilcbiAgICAgIG5hbWUgPSB0ZW5hbnROYW1lUGFyYW1ldGVyLnZhbHVlQXNTdHJpbmdcbiAgICB9XG5cbiAgICB0aGlzLmNvZ25pdG9Qb29sID0gbmV3IENvZ25pdG9Qb29sKHRoaXMsICdDb2duaXRvUG9vbCcsIHtcbiAgICAgIG5hbWUsXG4gICAgICBmZWF0dXJlUGxhbjogcHJvcHMuZmVhdHVyZVBsYW4gPz8gJ0VTU0VOVElBTFMnLFxuICAgICAgcHVibGlzaENvbXBvc2l0aW9uOiBwcm9wcy5wdWJsaXNoQ29tcG9zaXRpb24sXG4gICAgfSlcbiAgfVxufVxuXG4vKipcbiAqIEJ1aWxkIHRoZSBjb2duaXRvLXBvb2wgc3RhY2sgYXMgcHVibGlzaGVkIGluIHRoZSBsYXVuY2gtc3RhY2sgdGVtcGxhdGU6IG5vIGBlbnZgLCBzbyB0aGUgYWNjb3VudFxuICogcmVzb2x2ZXMgdG8gQVdTOjpBY2NvdW50SWQsIHRoZSByZWdpb24gdG8gQVdTOjpSZWdpb24sIGFuZCB0aGUgdGVuYW50IG5hbWUgc3RheXMgYSBkZXBsb3ktdGltZVxuICogcGFyYW1ldGVyLiBTaW5nbGUgc291cmNlIG9mIHRoZSBwdWJsaXNoLXRpbWUgc3ludGggY29uZmlnIHNvIHRoZSBhcnRpZmFjdCBhIGN1c3RvbWVyIG9uZS1jbGlja3MgaXNcbiAqIGV4YWN0bHkgd2hhdCB0aGUgcHVibGlzaGVkLXN0YWNrIHNwZWMgYXNzZXJ0cy5cbiAqL1xuZXhwb3J0IGNvbnN0IGJ1aWxkUHVibGlzaGVkU3RhY2sgPSAoYXBwOiBjZGsuQXBwKTogQ29nbml0b1Bvb2xTdGFjayA9PlxuICBuZXcgQ29nbml0b1Bvb2xTdGFjayhhcHAsIENPTlNUUlVDVF9OQU1FLCB7XG4gICAgZGVzY3JpcHRpb246ICdBcGlhYmxlIENvZ25pdG8gbWFjaGluZS10by1tYWNoaW5lIHBvb2wgd2l0aCBWM18wIHRva2VuIGN1c3RvbWlzYXRpb24g4oCUIG9uZS1jbGljayBwcm92aXNpb25pbmcnLFxuICAgIGFuYWx5dGljc1JlcG9ydGluZzogZmFsc2UsXG4gICAgc3ludGhlc2l6ZXI6IG5ldyBjZGsuRGVmYXVsdFN0YWNrU3ludGhlc2l6ZXIoeyBnZW5lcmF0ZUJvb3RzdHJhcFZlcnNpb25SdWxlOiBmYWxzZSB9KSxcbiAgfSlcbiJdfQ==