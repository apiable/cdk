import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { FeaturePlan } from './launch-stack-url';
/** Logical id of the tenant-name parameter the published template scopes the pool by. */
export declare const TENANT_NAME_PARAMETER = "TenantName";
/** Kebab kit-component segment this construct publishes its outputs under. */
export declare const COGNITO_POOL_COMPONENT = "cognito-pool";
/** Resource-server identifier and the single admin scope the machine clients bind to. */
export declare const RESOURCE_SERVER_IDENTIFIER = "apiable";
export declare const ADMIN_SCOPE_NAME = "admin";
/** Cognito hard cap: scopes per app client. Bound sets stay well under it. */
export declare const MAX_SCOPES_PER_CLIENT = 50;
/** The verbatim error a non-V3-capable feature plan fails with — never a silent fallback to V1/V2. */
export declare const TIER_GUARD_ERROR = "V3_0 PreTokenGen requires Cognito Essentials or Plus";
/**
 * Author-declared, channel-identical identities the release-time parity gate keys the pool and the
 * pre-token function on (the `apiable:logical-id` tag), so each compares equal across the CDK,
 * published-CFN, and Terraform channels regardless of its generated name, account, region, or tenant
 * segment. The hand-rolled Terraform module declares the identical literals; a pool that omits the tag
 * surfaces as an explicit parity divergence rather than being inferred from its name.
 */
export declare const COGNITO_POOL_LOGICAL_ID = "apiable-cognito-pool";
export declare const PRE_TOKEN_FUNCTION_LOGICAL_ID = "apiable-cognito-pool-pretoken-fn";
export interface CognitoPoolProps {
    /** Tenant/stack identifier the pool is scoped to — the pool is named `apiable-<name>`. */
    readonly name: string;
    /**
     * Cognito feature plan the pool is provisioned on. Required and self-declared: V3_0 Pre Token
     * Generation runs only on ESSENTIALS or PLUS, so LITE (or any other value) fails the deploy loudly
     * rather than silently degrading to a V1 trigger that cannot enrich a machine-to-machine token.
     */
    readonly featurePlan: FeaturePlan;
    /**
     * Opt in to publishing this construct's non-secret declared outputs (user-pool id, issuer URI) to
     * the shared parameter space at `/apiable/{name}/cognito-pool/{output}`, so the authorizer can
     * resolve `userpoolId` by key. Off by default. Client secrets are never published through this seam.
     */
    readonly publishComposition?: boolean;
}
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
export declare class CognitoPool extends Construct {
    readonly pool: cognito.UserPool;
    readonly resourceServer: cognito.UserPoolResourceServer;
    readonly client: cognito.UserPoolClient;
    readonly preTokenFunction: lambda.Function;
    constructor(scope: Construct, id: string, props: CognitoPoolProps);
}
export interface CognitoPoolStackProps extends cdk.StackProps {
    /**
     * Tenant/stack identifier the pool is scoped to. Omitting it (the published one-click path) surfaces
     * the name as a deploy-time CFN parameter the launch link pre-fills.
     */
    readonly name?: string;
    /**
     * Cognito feature plan. Forwarded to {@link CognitoPoolProps.featurePlan}; defaults to ESSENTIALS
     * (the lowest V3-capable tier) so the published one-click stack provisions a working V3_0 pool.
     */
    readonly featurePlan?: FeaturePlan;
    /** Forwarded to {@link CognitoPoolProps.publishComposition} (requires a concrete {@link name}). */
    readonly publishComposition?: boolean;
}
/** Thin stack wrapper so the construct synthesizes standalone into the published template. */
export declare class CognitoPoolStack extends cdk.Stack {
    readonly cognitoPool: CognitoPool;
    constructor(scope: Construct, id: string, props?: CognitoPoolStackProps);
}
/**
 * Build the cognito-pool stack as published in the launch-stack template: no `env`, so the account
 * resolves to AWS::AccountId, the region to AWS::Region, and the tenant name stays a deploy-time
 * parameter. Single source of the publish-time synth config so the artifact a customer one-clicks is
 * exactly what the published-stack spec asserts.
 */
export declare const buildPublishedStack: (app: cdk.App) => CognitoPoolStack;
