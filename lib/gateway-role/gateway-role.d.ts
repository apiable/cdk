import * as cdk from 'aws-cdk-lib';
import { CfnOutput, CfnParameter } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
/** Logical id of the trust-account parameter; the launch-stack URL pre-fills `param_<this>`. */
export declare const TRUST_ACCOUNT_PARAMETER = "ApiableTrustAccount";
/** Kebab kit-component segment this construct publishes its outputs under. */
export declare const GATEWAY_ROLE_COMPONENT = "gateway-role";
/**
 * Author-declared, channel-identical identity the release-time parity gate keys the role on (the
 * `apiable:logical-id` tag), so the same role compares equal across the CDK, published-CFN, and
 * Terraform channels regardless of its generated name, account, or region. The hand-rolled Terraform
 * module declares the identical literal.
 */
export declare const GATEWAY_ROLE_LOGICAL_ID = "apiable-gateway-role";
export interface GatewayRoleProps {
    /**
     * AWS account authorised to assume the gateway-management role. Omitting it defaults to
     * Apiable's account, reproducing the role existing customers already run.
     */
    readonly trustAccount?: string;
    /**
     * Tenant key the construct publishes its composition parameters under. Set together with
     * {@link publishComposition} to wire the SSM composition seam; omitting it leaves the seam off so
     * an existing customer's stack gains no new parameter resource.
     */
    readonly tenant?: string;
    /**
     * Opt in to publishing this construct's declared outputs to the shared parameter space at
     * `/apiable/{tenant}/gateway-role/{output}`. Off by default: the seam is wired only for new kit
     * deployments, never auto-retrofitted onto an existing stack.
     */
    readonly publishComposition?: boolean;
}
/**
 * Role that authorises Apiable to manage a customer's API gateway, as a reusable construct.
 *
 * The trusted account is a single bounded deployment parameter and the region resolves to
 * the deployment region, so no customer- or Apiable-specific identifier is fixed in the
 * synthesized artifact.
 */
export declare class GatewayRole extends Construct {
    readonly role: iam.Role;
    readonly trustAccountParameter: CfnParameter;
    readonly roleArnOutput: CfnOutput;
    constructor(scope: Construct, id: string, props?: GatewayRoleProps);
}
export interface GatewayRoleStackProps extends cdk.StackProps {
    /** Forwarded to {@link GatewayRoleProps.trustAccount}. */
    readonly trustAccount?: string;
    /** Forwarded to {@link GatewayRoleProps.tenant}. */
    readonly tenant?: string;
    /** Forwarded to {@link GatewayRoleProps.publishComposition}. */
    readonly publishComposition?: boolean;
}
/** Thin stack wrapper so the construct synthesizes standalone into the published template. */
export declare class GatewayRoleStack extends cdk.Stack {
    readonly gatewayRole: GatewayRole;
    constructor(scope: Construct, id: string, props?: GatewayRoleStackProps);
}
/**
 * Build the gateway-role stack as published in the launch-stack template: no `env`, so the
 * region resolves at deployment and the trusted account stays a deploy-time parameter.
 *
 * Single source of the publish-time synth config so the artifact a customer one-clicks is
 * exactly what the published-stack spec asserts.
 */
export declare const buildPublishedStack: (app: cdk.App) => GatewayRoleStack;
