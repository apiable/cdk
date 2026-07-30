import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
/** Logical id of the tenant-name parameter the published template scopes the authorizer by. */
export declare const TENANT_NAME_PARAMETER = "TenantName";
/** Logical id of the gateway-pool id parameter the published template validates tokens against. */
export declare const USER_POOL_ID_PARAMETER = "UserPoolId";
/** Logical id of the REST API id parameter the published template attaches the authorizer to. */
export declare const REST_API_ID_PARAMETER = "RestApiId";
/** Kebab kit-component segment the cognito-pool construct publishes its outputs under (the SSM read seam). */
export declare const COGNITO_POOL_COMPONENT = "cognito-pool";
/** Name of the cognito-pool output that carries the gateway-pool id (resolved by the SSM read seam). */
export declare const COGNITO_POOL_USERPOOL_ID_OUTPUT = "userpool-id";
/** The authorizer type: a TOKEN authorizer reads the bearer token from the Authorization header. */
export declare const AUTHORIZER_TYPE = "TOKEN";
/** Identity source of the TOKEN authorizer — the bearer token's header. */
export declare const AUTHORIZER_IDENTITY_SOURCE = "method.request.header.Authorization";
/**
 * Default result-cache TTL (seconds). The authorizer result cache masks per-token decisions, so the
 * default is 0 — a non-zero TTL is opt-in via a prop.
 */
export declare const DEFAULT_RESULTS_CACHE_TTL_SECONDS = 0;
/**
 * Author-declared, channel-identical identities the release-time parity gate keys the authorizer
 * function and its execution role on (the `apiable:logical-id` tag), so each compares equal across the
 * CDK, published-CFN, and Terraform channels regardless of its generated name, account, region, or
 * tenant segment. The hand-rolled Terraform module declares the identical literals; a resource that
 * omits the tag surfaces as an explicit parity divergence rather than being inferred from its name.
 */
export declare const AUTHORIZER_FUNCTION_LOGICAL_ID = "apiable-lambda-authorizer-fn";
export declare const AUTHORIZER_ROLE_LOGICAL_ID = "apiable-lambda-authorizer-role";
/** A per-method required-scope map: route key (`"<METHOD> <resourcePath>"`) → required `apiable/<scope>`. */
export type RequiredScopeMap = Readonly<Record<string, string>>;
export interface LambdaAuthorizerProps {
    /** Tenant/stack identifier the authorizer is scoped to — resources are named `apiable-<name>-authz`. */
    readonly name: string;
    /** Id of the API Gateway REST API the TOKEN authorizer is attached to. */
    readonly restApiId: string;
    /**
     * Id of the Leaf B gateway pool whose `client_credentials` access tokens this authorizer validates.
     * Optional only when {@link resolveUserPoolIdFromComposition} resolves it from the shared parameter
     * space; otherwise it is required. Supplying it directly is the existing-customer override/fallback,
     * so the zero-drift path stays untouched.
     */
    readonly userPoolId?: string;
    /**
     * Resolve the gateway-pool id from the cognito-pool construct's published output by key
     * (`/apiable/<name>/cognito-pool/userpool-id`) instead of a hand-relayed string prop. Off by default;
     * the {@link userPoolId} prop remains the override/fallback so 1-9's zero-drift path is untouched.
     */
    readonly resolveUserPoolIdFromComposition?: boolean;
    /**
     * Per-method required-scope map. A method absent from the map, or one whose required value is empty,
     * DENIES (deny-by-default) at runtime. Required values carry the `apiable/` prefix. Empty by default
     * — with no mapped method the authorizer denies every request, the fail-closed posture.
     */
    readonly requiredScopeMap?: RequiredScopeMap;
    /**
     * Result-cache TTL in seconds. The authorizer result cache masks per-token decisions, so this
     * defaults to 0; a non-zero value is an explicit opt-in.
     */
    readonly resultsCacheTtlSeconds?: number;
}
/**
 * Apiable scope-enforcing gateway authorizer as a reusable construct: a TOKEN Lambda authorizer that
 * validates `client_credentials` (machine-to-machine) access tokens against a Leaf B gateway pool,
 * gates each request on a per-method required-scope map (deny-by-default), and emits the per-method IAM
 * policy from the token's `apiable_plan_resources` claim. Greenfield-clean — it carries none of the
 * legacy credit-metering, `adminGetUser`, or API-key fallback layers, and its execution role grants
 * only its own logging.
 *
 * The authorizer attaches to an existing API Gateway REST API (its id is a prop / deploy-time
 * parameter), so the construct emits the `AWS::ApiGateway::Authorizer` resource directly rather than
 * provisioning a gateway; the usage-plan / API-key wiring on the gateway side belongs to the
 * gateway/usage-plan construct.
 */
export declare class LambdaAuthorizer extends Construct {
    readonly role: iam.Role;
    readonly authorizerFunction: lambda.Function;
    readonly authorizer: apigateway.CfnAuthorizer;
    constructor(scope: Construct, id: string, props: LambdaAuthorizerProps);
}
export interface LambdaAuthorizerStackProps extends cdk.StackProps {
    /**
     * Tenant/stack identifier the authorizer is scoped to. Omitting it (the published one-click path)
     * surfaces the name as a deploy-time CFN parameter the launch link pre-fills.
     */
    readonly name?: string;
    /**
     * Id of the Leaf B gateway pool. Omitting it (the published one-click path) surfaces it as a
     * deploy-time CFN parameter the launch link pre-fills.
     */
    readonly userPoolId?: string;
    /**
     * Id of the API Gateway REST API to attach to. Omitting it (the published one-click path) surfaces it
     * as a deploy-time CFN parameter the launch link pre-fills.
     */
    readonly restApiId?: string;
    /** Forwarded to {@link LambdaAuthorizerProps.requiredScopeMap}. */
    readonly requiredScopeMap?: RequiredScopeMap;
    /** Forwarded to {@link LambdaAuthorizerProps.resultsCacheTtlSeconds}. */
    readonly resultsCacheTtlSeconds?: number;
}
/** Thin stack wrapper so the construct synthesizes standalone into the published template. */
export declare class LambdaAuthorizerStack extends cdk.Stack {
    readonly lambdaAuthorizer: LambdaAuthorizer;
    constructor(scope: Construct, id: string, props?: LambdaAuthorizerStackProps);
}
/**
 * Build the lambda-authorizer stack as published in the launch-stack template: no `env`, so the account
 * resolves to AWS::AccountId, the region to AWS::Region, and the tenant name + gateway-pool id + REST
 * API id stay deploy-time parameters. Single source of the publish-time synth config so the artifact a
 * customer one-clicks is exactly what the published-stack spec asserts.
 */
export declare const buildPublishedStack: (app: cdk.App) => LambdaAuthorizerStack;
