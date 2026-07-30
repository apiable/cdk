"use strict";
/**
 * Canonical resource vocabulary shared by the channel reducers. A CloudFormation type and the
 * equivalent Terraform type reduce to the same canonical kind, so a resource compares by what it
 * IS, not by which channel emitted it. The two lookup tables live together so they stay in step.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.missingDeclaredId = exports.MISSING_DECLARED_ID = exports.canonicaliseAuthorizerName = exports.TENANT_SEGMENT_TOKEN = exports.canonicaliseHostedDomain = exports.HOSTED_DOMAIN_TENANT_TOKEN = exports.HOSTED_DOMAIN_PREFIX = exports.TENANT_NAME_VAR_KEY = exports.TENANT_NAME_VAR_REFERENCE = exports.canonicaliseLogsBucketParam = exports.LOGS_BUCKET_PARAM_TOKEN = exports.LOGS_BUCKET_VAR_REFERENCE = exports.LOGS_BUCKET_ARN_PARAMETER = exports.VALUE_BEARING_KINDS = exports.ENFORCED_DECLARED_ID_KINDS = exports.DECLARED_ID_KINDS = exports.DECLARED_ID_TAG = exports.policyServices = exports.canonicalOutputAttr = exports.discriminatorOf = exports.nodeRef = exports.canonicalTfKind = exports.canonicalCfnKind = void 0;
const CFN_KIND = {
    'AWS::IAM::Role': 'iam-role',
    'AWS::IAM::Policy': 'iam-inline-policy',
    'AWS::IAM::RolePolicy': 'iam-inline-policy',
    'AWS::Cognito::UserPool': 'cognito-user-pool',
    'AWS::Cognito::UserPoolClient': 'cognito-user-pool-client',
    'AWS::Cognito::UserPoolResourceServer': 'cognito-resource-server',
    'AWS::Cognito::UserPoolDomain': 'cognito-user-pool-domain',
    'AWS::Lambda::Function': 'lambda-function',
    'AWS::Lambda::Permission': 'lambda-permission',
    'AWS::ApiGateway::RestApi': 'apigateway-rest-api',
    'AWS::ApiGateway::Authorizer': 'apigateway-authorizer',
    'AWS::S3::Bucket': 's3-bucket',
    'AWS::S3::BucketPolicy': 's3-bucket-policy',
    'AWS::KinesisFirehose::DeliveryStream': 'firehose-delivery-stream',
    'AWS::Logs::LogGroup': 'logs-log-group',
    'AWS::Logs::LogStream': 'logs-log-stream',
};
const TF_KIND = {
    aws_iam_role: 'iam-role',
    aws_iam_role_policy: 'iam-inline-policy',
    aws_iam_policy: 'iam-inline-policy',
    aws_cognito_user_pool: 'cognito-user-pool',
    aws_cognito_user_pool_client: 'cognito-user-pool-client',
    aws_cognito_resource_server: 'cognito-resource-server',
    aws_cognito_user_pool_domain: 'cognito-user-pool-domain',
    aws_lambda_function: 'lambda-function',
    aws_lambda_permission: 'lambda-permission',
    aws_api_gateway_rest_api: 'apigateway-rest-api',
    aws_api_gateway_authorizer: 'apigateway-authorizer',
    aws_s3_bucket: 's3-bucket',
    aws_s3_bucket_policy: 's3-bucket-policy',
    aws_kinesis_firehose_delivery_stream: 'firehose-delivery-stream',
    aws_cloudwatch_log_group: 'logs-log-group',
    aws_cloudwatch_log_stream: 'logs-log-stream',
    aws_organizations_policy: 'organizations-scp',
    aws_organizations_policy_attachment: 'organizations-policy-attachment',
};
/** Canonical kind for a CloudFormation resource type; an unmapped type keeps its raw name so an unexpected resource still surfaces in the graph rather than vanishing. */
const canonicalCfnKind = (type) => CFN_KIND[type] ?? type;
exports.canonicalCfnKind = canonicalCfnKind;
/** Canonical kind for a Terraform resource type, with the same fall-back as the CloudFormation side. */
const canonicalTfKind = (type) => TF_KIND[type] ?? type;
exports.canonicalTfKind = canonicalTfKind;
/** Build a node reference from a kind and an optional channel-stable discriminator. */
const nodeRef = (kind, discriminator) => discriminator ? `${kind}:${discriminator}` : kind;
exports.nodeRef = nodeRef;
/** The discriminator segment of a node ref (`iam-role:gateway-role` → `gateway-role`), for anchoring an attached resource to its parent's declared identity. The whole ref when it carries no discriminator. */
const discriminatorOf = (ref) => {
    const separator = ref.indexOf(':');
    return separator === -1 ? ref : ref.slice(separator + 1);
};
exports.discriminatorOf = discriminatorOf;
/**
 * Canonicalise the attribute an output exports so a resource's primary identifier reconciles across
 * channels. A CloudFormation `Ref` of an S3 bucket resolves to the bucket name — the same value the
 * Terraform `bucket` attribute carries — so an output exporting the bucket name reduces to one `name`
 * attr in every channel rather than `ref` (CloudFormation) versus `bucket` (Terraform). A `Ref` of a
 * cognito user pool or app client resolves to that resource's id — the same value the Terraform `.id`
 * attribute carries — so an output exporting the pool or client id reduces to one `id` attr in every
 * channel rather than `ref` (CloudFormation) versus `id` (Terraform). Every other attribute (an `arn`)
 * already shares one label across channels and is left exactly as read.
 */
const canonicalOutputAttr = (kind, attr) => {
    if (kind === 's3-bucket' && (attr === 'ref' || attr === 'bucket'))
        return 'name';
    if (ID_REF_KINDS.has(kind) && (attr === 'ref' || attr === 'id'))
        return 'id';
    return attr;
};
exports.canonicalOutputAttr = canonicalOutputAttr;
/** The kinds whose CloudFormation `Ref` resolves to the same id the Terraform `.id` attribute carries, so an output exporting either reconciles. */
const ID_REF_KINDS = new Set(['cognito-user-pool', 'cognito-user-pool-client', 'apigateway-authorizer']);
/** The IAM service prefixes in an action set, sorted and de-duplicated — a channel-stable discriminator for an inline policy whose generated name differs per channel. */
const policyServices = (actions) => {
    const services = new Set(actions.map((a) => a.split(':')[0]));
    return [...services].sort().join('+');
};
exports.policyServices = policyServices;
/** The tag key carrying a resource's author-declared identity, identical across channels by construction. */
exports.DECLARED_ID_TAG = 'apiable:logical-id';
/**
 * The taggable primary kinds whose identity is the author-declared {@link DECLARED_ID_TAG}, never an
 * inferred name. A present tag drives the node ref so the same component carries the same identity in
 * every channel regardless of its channel-native type string, generated name, account, region, or
 * tenant segment.
 */
exports.DECLARED_ID_KINDS = new Set([
    'iam-role',
    's3-bucket',
    'cognito-user-pool',
    'lambda-function',
]);
/**
 * The taggable primaries the construct kit emits the declared id on — the gateway role, the logs
 * bucket and its write role, both cognito user pools (the authentication and authorization pools the
 * resource-servers, clients, and domain anchor their channel-stable identity to), and the pre-token
 * lambda-function. A missing id on one of these is an explicit divergence (it has no channel-stable
 * identity to compare), never a silent fall-back to the tenant-scoped name — which could mask a
 * substituted function. Every channel carries the id on these kinds: a CloudFormation `Tags` list, a
 * Terraform `tags`/`tags_all` map, and `cdk.Tags.of(...)` on the construct.
 */
exports.ENFORCED_DECLARED_ID_KINDS = new Set([
    'iam-role',
    's3-bucket',
    'cognito-user-pool',
    'lambda-function',
]);
/**
 * The kinds whose node ref must be UNIQUE within a channel: every kind that namespaces a load-bearing
 * value row by its own ref. Two distinct resources of such a kind collapsing onto one ref clobber each
 * other's value last-write-wins and hide a widening on the loser, so the gate fails the collision
 * itself. The axis is VALUE-BEARING, not primary-vs-attached: the taggable {@link DECLARED_ID_KINDS},
 * the two cognito kinds keyed by an author-declared natural key (resource-server Identifier, client
 * name), the api-gateway authorizer (self-keyed by Name), the s3 bucket-policy (anchored to its
 * bucket — AWS permits one policy per bucket, so two on one bucket are a duplicate identity), and the
 * firehose delivery stream (anchored to its delivery role, whose declared id keys it — its destination,
 * routing prefix, compression, and server-side-logging flag are load-bearing value rows), and the
 * Organizations SCP (self-keyed by its policy name — AWS permits one policy per name; its Deny action
 * set, NotResource allow-list, and condition are load-bearing value rows the regen-check compares so the
 * committed fixture cannot drift from main.tf). The pooled inline-policy / lambda-permission /
 * user-pool-domain kinds are excluded because they emit NO value row (their security is the grant
 * multiset, which enlarges rather than clobbers), never because they are "attached"; the presence-only
 * log-group / log-stream kinds carry no value row either. A structural test keeps this set in step with
 * the reducers' value-writing sites.
 */
exports.VALUE_BEARING_KINDS = new Set([
    ...exports.DECLARED_ID_KINDS,
    'cognito-resource-server',
    'cognito-user-pool-client',
    'apigateway-authorizer',
    's3-bucket-policy',
    'firehose-delivery-stream',
    'organizations-scp',
]);
/**
 * Logical id of the deploy-time parameter the published CloudFormation template scopes a firehose
 * stream's destination logs bucket by. The construct re-exports this from its own module; the parity
 * gate owns the canonical spelling so it imports nothing from the construct directory. The
 * CloudFormation parameter ref is `@ref:LogsBucketArn`.
 */
exports.LOGS_BUCKET_ARN_PARAMETER = 'LogsBucketArn';
/**
 * The Terraform reference to the deploy-time logs-bucket variable — the channel-twin of
 * {@link LOGS_BUCKET_ARN_PARAMETER}. The published module names the variable `logs_bucket_arn`, so a
 * stream whose destination `bucket_arn` references this is bound to the conventional deploy-time input.
 * The two spellings (`LogsBucketArn` ⇄ `var.logs_bucket_arn`) are the authored channel forms of the one
 * input, kept together here so the parameter-identity reduction keys both on a single source of truth.
 */
exports.LOGS_BUCKET_VAR_REFERENCE = 'var.logs_bucket_arn';
/**
 * The stable token the declared deploy-time logs-bucket PARAMETER reduces to. The destination bucket is
 * a deploy-time input external to the stream artifact, so the conventional case reads as the parameter
 * ref `@ref:LogsBucketArn` in the published CloudFormation channel and a concrete literal bound to
 * `var.logs_bucket_arn` in Terraform — two channel-specific spellings of the one deploy-time input the
 * construct names. Both reduce to this token so the delivery role's S3 grant on the conventional logs
 * bucket reconciles cross-channel, while every *other* ARN keeps its identity (a literal stays a literal,
 * a ref to a different-named parameter stays `@ref:<other>`) and therefore diverges. The token name
 * carries the convention — "this is the declared logs-bucket parameter", not "any delivery destination".
 * A real bucket ARN or a different parameter ref can never equal this token.
 */
exports.LOGS_BUCKET_PARAM_TOKEN = '{logs-bucket-param}';
/**
 * Canonicalise a grant resource to {@link LOGS_BUCKET_PARAM_TOKEN} *only* when it names the channel's
 * representation of the declared deploy-time logs-bucket parameter, preserving any trailing object path
 * (`/ *`). `paramDestinations` is the set of each channel's own representation of that destination
 * **when and only when** the stream's `BucketARN`/`bucket_arn` is bound to the conventional parameter:
 * the single `@ref:LogsBucketArn` entry on the CloudFormation side, the concrete `arn:aws:s3:::…` literal
 * the Terraform stream binds via `var.logs_bucket_arn` on the Terraform side. A resource that is a bare
 * literal, or a ref to a different-named parameter/variable, is **not** in the set and is returned
 * unchanged — so a re-pointed destination (an attacker-controlled exfil bucket, whether hardcoded or
 * wired to a differently-named variable) keeps its identity and fails the gate by value.
 *
 * The Terraform variable name is load-bearing: the witness that a TF literal is the conventional
 * deploy-time parameter is that the stream's destination `bucket_arn` references the top-level
 * `var.logs_bucket_arn`. A hand-rolled module that renames that variable while still wiring it as a
 * genuine deploy-time input would fail CLOSED (its literal is unrecognised → diverges from the
 * parameter token), never fail open — using the conventional variable name is part of the published
 * convention the gate polices, and a renamed fork is realigned by adopting the convention.
 */
const canonicaliseLogsBucketParam = (resource, paramDestinations) => {
    for (const destination of paramDestinations) {
        if (resource === destination)
            return exports.LOGS_BUCKET_PARAM_TOKEN;
        if (resource.startsWith(`${destination}/`))
            return `${exports.LOGS_BUCKET_PARAM_TOKEN}${resource.slice(destination.length)}`;
    }
    return resource;
};
exports.canonicaliseLogsBucketParam = canonicaliseLogsBucketParam;
/**
 * The Terraform reference to the deploy-time tenant-name variable — the channel-twin of the published
 * CloudFormation `TenantName` parameter. The published cognito module names the variable `name`, so a
 * hosted-UI domain whose `domain` expression references `var.name` is rendered through the conventional
 * deploy-time tenant input. The two spellings (`@ref:TenantName` ⇄ `var.name`) are the authored channel
 * forms of the one input, kept together so the hosted-domain identity reduction keys both on one source.
 */
exports.TENANT_NAME_VAR_REFERENCE = 'var.name';
/** The plan-level variable key the {@link TENANT_NAME_VAR_REFERENCE} resolves against — the top-level
 * `variables` block keys the tenant input under its bare name (`name`), not the `var.`-qualified reference. */
exports.TENANT_NAME_VAR_KEY = 'name';
/** The literal prefix the conventional hosted-UI domain is rendered with — `apiable-<tenant>` on every channel. */
exports.HOSTED_DOMAIN_PREFIX = 'apiable-';
/**
 * The only form a hosted-UI domain reconciles from: `apiable-` *immediately* followed by the deploy-time
 * tenant marker `@ref:`, with no literal in between. Every channel must render its conventional domain into
 * this exact shape to reconcile — the CloudFormation channel resolves `Fn::Join["apiable-", {Ref: TenantName}]`
 * to it natively, and the Terraform reducer reconstructs it from a `domain` expression that is the bare tenant
 * variable interpolation under the `apiable-` prefix. A domain that carries an injected literal between the
 * prefix and the tenant marker (`apiable-evil-@ref:…`) is not this shape, keeps its identity, and diverges.
 */
const HOSTED_DOMAIN_TENANT_RENDERING = `${exports.HOSTED_DOMAIN_PREFIX}@ref:`;
/**
 * The stable token the conventional `apiable-<tenant>` hosted-UI domain reduces to. The tenant segment is
 * a deploy-time input, so the conventional case reads as the parameter join `apiable-@ref:TenantName` in
 * the published CloudFormation channel and a concrete `apiable-<tenant>` literal bound to `var.name` in
 * Terraform — two channel-specific spellings of the one deploy-time tenant input the construct names. Both
 * reduce to this token so the same tenant's hosted sign-in domain (and the authorize/token discovery
 * endpoints derived from it) reconcile cross-channel, while a substituted host keeps its identity and
 * still diverges by value. The token name carries the convention — "this is the declared tenant hosted
 * domain", not "any domain". A real domain prefix that does not follow the convention can never equal it.
 */
exports.HOSTED_DOMAIN_TENANT_TOKEN = '{apiable-tenant-domain}';
/**
 * Canonicalise a hosted-UI domain witness to {@link HOSTED_DOMAIN_TENANT_TOKEN} *only* when it is the
 * conventional rendering of the deploy-time tenant input — `apiable-` immediately followed by the tenant
 * marker `@ref:`, with no injected literal between them ({@link HOSTED_DOMAIN_TENANT_RENDERING}). Every
 * channel reduces its conventional domain into that one shape before this check, so the same tenant's domain
 * reconciles across channels even though each renders the tenant segment by a structurally different path:
 * the CloudFormation channel resolves its parameter join to the shape natively, and the Terraform reducer
 * reconstructs it from a `domain` expression whose entire value under the `apiable-` prefix is the bare
 * tenant variable interpolation. The check is identical for both channels, so neither is looser than the
 * other.
 *
 * A witness that is not this exact shape is returned unchanged. A substituted token-minting host, a bare
 * literal not wired to the tenant input, and — the case this tightness exists to catch — a domain that
 * smuggles an injected literal between the prefix and the tenant marker (`apiable-evil-@ref:…`, the rendered
 * form of `apiable-evil-${var.name}`) all keep their identity and fail the gate by value on both discovery
 * endpoints. The equivalence is never widened into accepting such a host; the security floor is preserved,
 * not weakened. A hand-rolled module that renames the tenant variable while still wiring it as a genuine
 * deploy-time input fails CLOSED (its reconstructed witness is unrecognised → diverges from the token), never
 * fail open; adopting the convention realigns it.
 */
const canonicaliseHostedDomain = (witness) => witness.startsWith(HOSTED_DOMAIN_TENANT_RENDERING) ? exports.HOSTED_DOMAIN_TENANT_TOKEN : witness;
exports.canonicaliseHostedDomain = canonicaliseHostedDomain;
/** The stable token the deploy-time tenant segment of a self-named resource collapses to, so the same construct reconciles across a parameter-rendered and a concrete-tenant channel. */
exports.TENANT_SEGMENT_TOKEN = '{tenant}';
const AUTHORIZER_NAME_CONVENTION = /^apiable-(.+)-authz$/;
/**
 * Canonicalise an API-Gateway authorizer's self-name to a tenant-stable identity. The authorizer is
 * keyed by its `Name` (it carries no declared-id tag — AWS permits one authorizer per Name on a REST
 * API, so the Name IS its identity), and the published convention renders it `apiable-<tenant>-authz`:
 * the deploy-time tenant segment is the published CloudFormation parameter ref (`apiable-@ref:TenantName-authz`)
 * and the concrete tenant in a Terraform plan (`apiable-staging-authz`). Collapsing the tenant segment to a
 * stable token lets the same construct's authorizer reconcile across channels (its identity is the construct,
 * tenant-independent, exactly as a declared id is), while a non-conventional name (a substituted authorizer)
 * does not match the convention, keeps its identity, and still diverges. The authorizer's load-bearing value
 * rows (type, identity-source, execution-role grant set) are compared independently, so a substituted
 * authorizer that mimics the name still fails by value.
 */
const canonicaliseAuthorizerName = (name) => {
    const match = AUTHORIZER_NAME_CONVENTION.exec(name);
    return match === null ? name : `apiable-${exports.TENANT_SEGMENT_TOKEN}-authz`;
};
exports.canonicaliseAuthorizerName = canonicaliseAuthorizerName;
/** A sentinel marking a taggable primary that should carry a declared id but does not in this channel. */
exports.MISSING_DECLARED_ID = '∅:no-declared-logical-id';
/**
 * The discriminator for an enforced taggable primary whose declared id is absent in this channel: a
 * per-channel-unique token built from the channel-local id, so the resource can never coincide with
 * another channel's resource and a missing id always surfaces as an explicit graph divergence rather
 * than being inferred from the name.
 */
const missingDeclaredId = (localId) => `${exports.MISSING_DECLARED_ID}:${localId}`;
exports.missingDeclaredId = missingDeclaredId;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2Fub25pY2FsLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY2Fub25pY2FsLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7OztHQUlHOzs7QUFFSCxNQUFNLFFBQVEsR0FBcUM7SUFDakQsZ0JBQWdCLEVBQUUsVUFBVTtJQUM1QixrQkFBa0IsRUFBRSxtQkFBbUI7SUFDdkMsc0JBQXNCLEVBQUUsbUJBQW1CO0lBQzNDLHdCQUF3QixFQUFFLG1CQUFtQjtJQUM3Qyw4QkFBOEIsRUFBRSwwQkFBMEI7SUFDMUQsc0NBQXNDLEVBQUUseUJBQXlCO0lBQ2pFLDhCQUE4QixFQUFFLDBCQUEwQjtJQUMxRCx1QkFBdUIsRUFBRSxpQkFBaUI7SUFDMUMseUJBQXlCLEVBQUUsbUJBQW1CO0lBQzlDLDBCQUEwQixFQUFFLHFCQUFxQjtJQUNqRCw2QkFBNkIsRUFBRSx1QkFBdUI7SUFDdEQsaUJBQWlCLEVBQUUsV0FBVztJQUM5Qix1QkFBdUIsRUFBRSxrQkFBa0I7SUFDM0Msc0NBQXNDLEVBQUUsMEJBQTBCO0lBQ2xFLHFCQUFxQixFQUFFLGdCQUFnQjtJQUN2QyxzQkFBc0IsRUFBRSxpQkFBaUI7Q0FDMUMsQ0FBQTtBQUVELE1BQU0sT0FBTyxHQUFxQztJQUNoRCxZQUFZLEVBQUUsVUFBVTtJQUN4QixtQkFBbUIsRUFBRSxtQkFBbUI7SUFDeEMsY0FBYyxFQUFFLG1CQUFtQjtJQUNuQyxxQkFBcUIsRUFBRSxtQkFBbUI7SUFDMUMsNEJBQTRCLEVBQUUsMEJBQTBCO0lBQ3hELDJCQUEyQixFQUFFLHlCQUF5QjtJQUN0RCw0QkFBNEIsRUFBRSwwQkFBMEI7SUFDeEQsbUJBQW1CLEVBQUUsaUJBQWlCO0lBQ3RDLHFCQUFxQixFQUFFLG1CQUFtQjtJQUMxQyx3QkFBd0IsRUFBRSxxQkFBcUI7SUFDL0MsMEJBQTBCLEVBQUUsdUJBQXVCO0lBQ25ELGFBQWEsRUFBRSxXQUFXO0lBQzFCLG9CQUFvQixFQUFFLGtCQUFrQjtJQUN4QyxvQ0FBb0MsRUFBRSww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QUFFckU7Ozs7Ozs7OztHQVNHO0FBQ1UsUUFBQSwwQkFBMEIsR0FBRyx5QkFBeUIsQ0FBQTtBQUVuRTs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW1CRztBQUNJLE1BQU0sd0JBQXdCLEdBQUcsQ0FBQyxPQUFlLEVBQVUsRUFBRSxDQUNsRSxPQUFPLENBQUMsVUFBVSxDQUFDLDhCQUE4QixDQUFDLENBQUMsQ0FBQyxDQUFDLGtDQUEwQixDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUE7QUFEOUUsUUFBQSx3QkFBd0IsNEJBQ3NEO0FBRTNGLHlMQUF5TDtBQUM1SyxRQUFBLG9CQUFvQixHQUFHLFVBQVUsQ0FBQTtBQUU5QyxNQUFNLDBCQUEwQixHQUFHLHNCQUFzQixDQUFBO0FBRXpEOzs7Ozs7Ozs7OztHQVdHO0FBQ0ksTUFBTSwwQkFBMEIsR0FBRyxDQUFDLElBQVksRUFBVSxFQUFFO0lBQ2pFLE1BQU0sS0FBSyxHQUFHLDBCQUEwQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtJQUNuRCxPQUFPLEtBQUssS0FBSyxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsV0FBVyw0QkFBb0IsUUFBUSxDQUFBO0FBQ3hFLENBQUMsQ0FBQTtBQUhZLFFBQUEsMEJBQTBCLDhCQUd0QztBQUVELDBHQUEwRztBQUM3RixRQUFBLG1CQUFtQixHQUFHLDBCQUEwQixDQUFBO0FBRTdEOzs7OztHQUtHO0FBQ0ksTUFBTSxpQkFBaUIsR0FBRyxDQUFDLE9BQWUsRUFBVSxFQUFFLENBQUMsR0FBRywyQkFBbUIsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUFwRixRQUFBLGlCQUFpQixxQkFBbUUiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIENhbm9uaWNhbCByZXNvdXJjZSB2b2NhYnVsYXJ5IHNoYXJlZCBieSB0aGUgY2hhbm5lbCByZWR1Y2Vycy4gQSBDbG91ZEZvcm1hdGlvbiB0eXBlIGFuZCB0aGVcbiAqIGVxdWl2YWxlbnQgVGVycmFmb3JtIHR5cGUgcmVkdWNlIHRvIHRoZSBzYW1lIGNhbm9uaWNhbCBraW5kLCBzbyBhIHJlc291cmNlIGNvbXBhcmVzIGJ5IHdoYXQgaXRcbiAqIElTLCBub3QgYnkgd2hpY2ggY2hhbm5lbCBlbWl0dGVkIGl0LiBUaGUgdHdvIGxvb2t1cCB0YWJsZXMgbGl2ZSB0b2dldGhlciBzbyB0aGV5IHN0YXkgaW4gc3RlcC5cbiAqL1xuXG5jb25zdCBDRk5fS0lORDogUmVhZG9ubHk8UmVjb3JkPHN0cmluZywgc3RyaW5nPj4gPSB7XG4gICdBV1M6OklBTTo6Um9sZSc6ICdpYW0tcm9sZScsXG4gICdBV1M6OklBTTo6UG9saWN5JzogJ2lhbS1pbmxpbmUtcG9saWN5JyxcbiAgJ0FXUzo6SUFNOjpSb2xlUG9saWN5JzogJ2lhbS1pbmxpbmUtcG9saWN5JyxcbiAgJ0FXUzo6Q29nbml0bzo6VXNlclBvb2wnOiAnY29nbml0by11c2VyLXBvb2wnLFxuICAnQVdTOjpDb2duaXRvOjpVc2VyUG9vbENsaWVudCc6ICdjb2duaXRvLXVzZXItcG9vbC1jbGllbnQnLFxuICAnQVdTOjpDb2duaXRvOjpVc2VyUG9vbFJlc291cmNlU2VydmVyJzogJ2NvZ25pdG8tcmVzb3VyY2Utc2VydmVyJyxcbiAgJ0FXUzo6Q29nbml0bzo6VXNlclBvb2xEb21haW4nOiAnY29nbml0by11c2VyLXBvb2wtZG9tYWluJyxcbiAgJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbic6ICdsYW1iZGEtZnVuY3Rpb24nLFxuICAnQVdTOjpMYW1iZGE6OlBlcm1pc3Npb24nOiAnbGFtYmRhLXBlcm1pc3Npb24nLFxuICAnQVdTOjpBcGlHYXRld2F5OjpSZXN0QXBpJzogJ2FwaWdhdGV3YXktcmVzdC1hcGknLFxuICAnQVdTOjpBcGlHYXRld2F5OjpBdXRob3JpemVyJzogJ2FwaWdhdGV3YXktYXV0aG9yaXplcicsXG4gICdBV1M6OlMzOjpCdWNrZXQnOiAnczMtYnVja2V0JyxcbiAgJ0FXUzo6UzM6OkJ1Y2tldFBvbGljeSc6ICdzMy1idWNrZXQtcG9saWN5JyxcbiAgJ0FXUzo6S2luZXNpc0ZpcmVob3NlOjpEZWxpdmVyeVN0cmVhbSc6ICdmaXJlaG9zZS1kZWxpdmVyeS1zdHJlYW0nLFxuICAnQVdTOjpMb2dzOjpMb2dHcm91cCc6ICdsb2dzLWxvZy1ncm91cCcsXG4gICdBV1M6OkxvZ3M6OkxvZ1N0cmVhbSc6ICdsb2dzLWxvZy1zdHJlYW0nLFxufVxuXG5jb25zdCBURl9LSU5EOiBSZWFkb25seTxSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+PiA9IHtcbiAgYXdzX2lhbV9yb2xlOiAnaWFtLXJvbGUnLFxuICBhd3NfaWFtX3JvbGVfcG9saWN5OiAnaWFtLWlubGluZS1wb2xpY3knLFxuICBhd3NfaWFtX3BvbGljeTogJ2lhbS1pbmxpbmUtcG9saWN5JyxcbiAgYXdzX2NvZ25pdG9fdXNlcl9wb29sOiAnY29nbml0by11c2VyLXBvb2wnLFxuICBhd3NfY29nbml0b191c2VyX3Bvb2xfY2xpZW50OiAnY29nbml0by11c2VyLXBvb2wtY2xpZW50JyxcbiAgYXdzX2NvZ25pdG9fcmVzb3VyY2Vfc2VydmVyOiAnY29nbml0by1yZXNvdXJjZS1zZXJ2ZXInLFxuICBhd3NfY29nbml0b191c2VyX3Bvb2xfZG9tYWluOiAnY29nbml0by11c2VyLXBvb2wtZG9tYWluJyxcbiAgYXdzX2xhbWJkYV9mdW5jdGlvbjogJ2xhbWJkYS1mdW5jdGlvbicsXG4gIGF3c19sYW1iZGFfcGVybWlzc2lvbjogJ2xhbWJkYS1wZXJtaXNzaW9uJyxcbiAgYXdzX2FwaV9nYXRld2F5X3Jlc3RfYXBpOiAnYXBpZ2F0ZXdheS1yZXN0LWFwaScsXG4gIGF3c19hcGlfZ2F0ZXdheV9hdXRob3JpemVyOiAnYXBpZ2F0ZXdheS1hdXRob3JpemVyJyxcbiAgYXdzX3MzX2J1Y2tldDogJ3MzLWJ1Y2tldCcsXG4gIGF3c19zM19idWNrZXRfcG9saWN5OiAnczMtYnVja2V0LXBvbGljeScsXG4gIGF3c19raW5lc2lzX2ZpcmVob3NlX2RlbGl2ZXJ5X3N0cmVhbTogJ2ZpcmVob3NlLWRlbGl2ZXJ5LXN0cmVhbScsXG4gIGF3c19jbG91ZHdhdGNoX2xvZ19ncm91cDogJ2xvZ3MtbG9nLWdyb3VwJyxcbiAgYXdzX2Nsb3Vkd2F0Y2hfbG9nX3N0cmVhbTogJ2xvZ3MtbG9nLXN0cmVhbScsXG4gIGF3c19vcmdhbml6YXRpb25zX3BvbGljeTogJ29yZ2FuaXphdGlvbnMtc2NwJyxcbiAgYXdzX29yZ2FuaXphdGlvbnNfcG9saWN5X2F0dGFjaG1lbnQ6ICdvcmdhbml6YXRpb25zLXBvbGljeS1hdHRhY2htZW50Jyxcbn1cblxuLyoqIENhbm9uaWNhbCBraW5kIGZvciBhIENsb3VkRm9ybWF0aW9uIHJlc291cmNlIHR5cGU7IGFuIHVubWFwcGVkIHR5cGUga2VlcHMgaXRzIHJhdyBuYW1lIHNvIGFuIHVuZXhwZWN0ZWQgcmVzb3VyY2Ugc3RpbGwgc3VyZmFjZXMgaW4gdGhlIGdyYXBoIHJhdGhlciB0aGFuIHZhbmlzaGluZy4gKi9cbmV4cG9ydCBjb25zdCBjYW5vbmljYWxDZm5LaW5kID0gKHR5cGU6IHN0cmluZyk6IHN0cmluZyA9PiBDRk5fS0lORFt0eXBlXSA/PyB0eXBlXG5cbi8qKiBDYW5vbmljYWwga2luZCBmb3IgYSBUZXJyYWZvcm0gcmVzb3VyY2UgdHlwZSwgd2l0aCB0aGUgc2FtZSBmYWxsLWJhY2sgYXMgdGhlIENsb3VkRm9ybWF0aW9uIHNpZGUuICovXG5leHBvcnQgY29uc3QgY2Fub25pY2FsVGZLaW5kID0gKHR5cGU6IHN0cmluZyk6IHN0cmluZyA9PiBURl9LSU5EW3R5cGVdID8/IHR5cGVcblxuLyoqIEJ1aWxkIGEgbm9kZSByZWZlcmVuY2UgZnJvbSBhIGtpbmQgYW5kIGFuIG9wdGlvbmFsIGNoYW5uZWwtc3RhYmxlIGRpc2NyaW1pbmF0b3IuICovXG5leHBvcnQgY29uc3Qgbm9kZVJlZiA9IChraW5kOiBzdHJpbmcsIGRpc2NyaW1pbmF0b3I/OiBzdHJpbmcpOiBzdHJpbmcgPT5cbiAgZGlzY3JpbWluYXRvciA/IGAke2tpbmR9OiR7ZGlzY3JpbWluYXRvcn1gIDoga2luZFxuXG4vKiogVGhlIGRpc2NyaW1pbmF0b3Igc2VnbWVudCBvZiBhIG5vZGUgcmVmIChgaWFtLXJvbGU6Z2F0ZXdheS1yb2xlYCDihpIgYGdhdGV3YXktcm9sZWApLCBmb3IgYW5jaG9yaW5nIGFuIGF0dGFjaGVkIHJlc291cmNlIHRvIGl0cyBwYXJlbnQncyBkZWNsYXJlZCBpZGVudGl0eS4gVGhlIHdob2xlIHJlZiB3aGVuIGl0IGNhcnJpZXMgbm8gZGlzY3JpbWluYXRvci4gKi9cbmV4cG9ydCBjb25zdCBkaXNjcmltaW5hdG9yT2YgPSAocmVmOiBzdHJpbmcpOiBzdHJpbmcgPT4ge1xuICBjb25zdCBzZXBhcmF0b3IgPSByZWYuaW5kZXhPZignOicpXG4gIHJldHVybiBzZXBhcmF0b3IgPT09IC0xID8gcmVmIDogcmVmLnNsaWNlKHNlcGFyYXRvciArIDEpXG59XG5cbi8qKlxuICogQ2Fub25pY2FsaXNlIHRoZSBhdHRyaWJ1dGUgYW4gb3V0cHV0IGV4cG9ydHMgc28gYSByZXNvdXJjZSdzIHByaW1hcnkgaWRlbnRpZmllciByZWNvbmNpbGVzIGFjcm9zc1xuICogY2hhbm5lbHMuIEEgQ2xvdWRGb3JtYXRpb24gYFJlZmAgb2YgYW4gUzMgYnVja2V0IHJlc29sdmVzIHRvIHRoZSBidWNrZXQgbmFtZSDigJQgdGhlIHNhbWUgdmFsdWUgdGhlXG4gKiBUZXJyYWZvcm0gYGJ1Y2tldGAgYXR0cmlidXRlIGNhcnJpZXMg4oCUIHNvIGFuIG91dHB1dCBleHBvcnRpbmcgdGhlIGJ1Y2tldCBuYW1lIHJlZHVjZXMgdG8gb25lIGBuYW1lYFxuICogYXR0ciBpbiBldmVyeSBjaGFubmVsIHJhdGhlciB0aGFuIGByZWZgIChDbG91ZEZvcm1hdGlvbikgdmVyc3VzIGBidWNrZXRgIChUZXJyYWZvcm0pLiBBIGBSZWZgIG9mIGFcbiAqIGNvZ25pdG8gdXNlciBwb29sIG9yIGFwcCBjbGllbnQgcmVzb2x2ZXMgdG8gdGhhdCByZXNvdXJjZSdzIGlkIOKAlCB0aGUgc2FtZSB2YWx1ZSB0aGUgVGVycmFmb3JtIGAuaWRgXG4gKiBhdHRyaWJ1dGUgY2FycmllcyDigJQgc28gYW4gb3V0cHV0IGV4cG9ydGluZyB0aGUgcG9vbCBvciBjbGllbnQgaWQgcmVkdWNlcyB0byBvbmUgYGlkYCBhdHRyIGluIGV2ZXJ5XG4gKiBjaGFubmVsIHJhdGhlciB0aGFuIGByZWZgIChDbG91ZEZvcm1hdGlvbikgdmVyc3VzIGBpZGAgKFRlcnJhZm9ybSkuIEV2ZXJ5IG90aGVyIGF0dHJpYnV0ZSAoYW4gYGFybmApXG4gKiBhbHJlYWR5IHNoYXJlcyBvbmUgbGFiZWwgYWNyb3NzIGNoYW5uZWxzIGFuZCBpcyBsZWZ0IGV4YWN0bHkgYXMgcmVhZC5cbiAqL1xuZXhwb3J0IGNvbnN0IGNhbm9uaWNhbE91dHB1dEF0dHIgPSAoa2luZDogc3RyaW5nLCBhdHRyOiBzdHJpbmcpOiBzdHJpbmcgPT4ge1xuICBpZiAoa2luZCA9PT0gJ3MzLWJ1Y2tldCcgJiYgKGF0dHIgPT09ICdyZWYnIHx8IGF0dHIgPT09ICdidWNrZXQnKSkgcmV0dXJuICduYW1lJ1xuICBpZiAoSURfUkVGX0tJTkRTLmhhcyhraW5kKSAmJiAoYXR0ciA9PT0gJ3JlZicgfHwgYXR0ciA9PT0gJ2lkJykpIHJldHVybiAnaWQnXG4gIHJldHVybiBhdHRyXG59XG5cbi8qKiBUaGUga2luZHMgd2hvc2UgQ2xvdWRGb3JtYXRpb24gYFJlZmAgcmVzb2x2ZXMgdG8gdGhlIHNhbWUgaWQgdGhlIFRlcnJhZm9ybSBgLmlkYCBhdHRyaWJ1dGUgY2Fycmllcywgc28gYW4gb3V0cHV0IGV4cG9ydGluZyBlaXRoZXIgcmVjb25jaWxlcy4gKi9cbmNvbnN0IElEX1JFRl9LSU5EUzogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoWydjb2duaXRvLXVzZXItcG9vbCcsICdjb2duaXRvLXVzZXItcG9vbC1jbGllbnQnLCAnYXBpZ2F0ZXdheS1hdXRob3JpemVyJ10pXG5cbi8qKiBUaGUgSUFNIHNlcnZpY2UgcHJlZml4ZXMgaW4gYW4gYWN0aW9uIHNldCwgc29ydGVkIGFuZCBkZS1kdXBsaWNhdGVkIOKAlCBhIGNoYW5uZWwtc3RhYmxlIGRpc2NyaW1pbmF0b3IgZm9yIGFuIGlubGluZSBwb2xpY3kgd2hvc2UgZ2VuZXJhdGVkIG5hbWUgZGlmZmVycyBwZXIgY2hhbm5lbC4gKi9cbmV4cG9ydCBjb25zdCBwb2xpY3lTZXJ2aWNlcyA9IChhY3Rpb25zOiByZWFkb25seSBzdHJpbmdbXSk6IHN0cmluZyA9PiB7XG4gIGNvbnN0IHNlcnZpY2VzID0gbmV3IFNldChhY3Rpb25zLm1hcCgoYSkgPT4gYS5zcGxpdCgnOicpWzBdKSlcbiAgcmV0dXJuIFsuLi5zZXJ2aWNlc10uc29ydCgpLmpvaW4oJysnKVxufVxuXG4vKiogVGhlIHRhZyBrZXkgY2FycnlpbmcgYSByZXNvdXJjZSdzIGF1dGhvci1kZWNsYXJlZCBpZGVudGl0eSwgaWRlbnRpY2FsIGFjcm9zcyBjaGFubmVscyBieSBjb25zdHJ1Y3Rpb24uICovXG5leHBvcnQgY29uc3QgREVDTEFSRURfSURfVEFHID0gJ2FwaWFibGU6bG9naWNhbC1pZCdcblxuLyoqXG4gKiBUaGUgdGFnZ2FibGUgcHJpbWFyeSBraW5kcyB3aG9zZSBpZGVudGl0eSBpcyB0aGUgYXV0aG9yLWRlY2xhcmVkIHtAbGluayBERUNMQVJFRF9JRF9UQUd9LCBuZXZlciBhblxuICogaW5mZXJyZWQgbmFtZS4gQSBwcmVzZW50IHRhZyBkcml2ZXMgdGhlIG5vZGUgcmVmIHNvIHRoZSBzYW1lIGNvbXBvbmVudCBjYXJyaWVzIHRoZSBzYW1lIGlkZW50aXR5IGluXG4gKiBldmVyeSBjaGFubmVsIHJlZ2FyZGxlc3Mgb2YgaXRzIGNoYW5uZWwtbmF0aXZlIHR5cGUgc3RyaW5nLCBnZW5lcmF0ZWQgbmFtZSwgYWNjb3VudCwgcmVnaW9uLCBvclxuICogdGVuYW50IHNlZ21lbnQuXG4gKi9cbmV4cG9ydCBjb25zdCBERUNMQVJFRF9JRF9LSU5EUzogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoW1xuICAnaWFtLXJvbGUnLFxuICAnczMtYnVja2V0JyxcbiAgJ2NvZ25pdG8tdXNlci1wb29sJyxcbiAgJ2xhbWJkYS1mdW5jdGlvbicsXG5dKVxuXG4vKipcbiAqIFRoZSB0YWdnYWJsZSBwcmltYXJpZXMgdGhlIGNvbnN0cnVjdCBraXQgZW1pdHMgdGhlIGRlY2xhcmVkIGlkIG9uIOKAlCB0aGUgZ2F0ZXdheSByb2xlLCB0aGUgbG9nc1xuICogYnVja2V0IGFuZCBpdHMgd3JpdGUgcm9sZSwgYm90aCBjb2duaXRvIHVzZXIgcG9vbHMgKHRoZSBhdXRoZW50aWNhdGlvbiBhbmQgYXV0aG9yaXphdGlvbiBwb29scyB0aGVcbiAqIHJlc291cmNlLXNlcnZlcnMsIGNsaWVudHMsIGFuZCBkb21haW4gYW5jaG9yIHRoZWlyIGNoYW5uZWwtc3RhYmxlIGlkZW50aXR5IHRvKSwgYW5kIHRoZSBwcmUtdG9rZW5cbiAqIGxhbWJkYS1mdW5jdGlvbi4gQSBtaXNzaW5nIGlkIG9uIG9uZSBvZiB0aGVzZSBpcyBhbiBleHBsaWNpdCBkaXZlcmdlbmNlIChpdCBoYXMgbm8gY2hhbm5lbC1zdGFibGVcbiAqIGlkZW50aXR5IHRvIGNvbXBhcmUpLCBuZXZlciBhIHNpbGVudCBmYWxsLWJhY2sgdG8gdGhlIHRlbmFudC1zY29wZWQgbmFtZSDigJQgd2hpY2ggY291bGQgbWFzayBhXG4gKiBzdWJzdGl0dXRlZCBmdW5jdGlvbi4gRXZlcnkgY2hhbm5lbCBjYXJyaWVzIHRoZSBpZCBvbiB0aGVzZSBraW5kczogYSBDbG91ZEZvcm1hdGlvbiBgVGFnc2AgbGlzdCwgYVxuICogVGVycmFmb3JtIGB0YWdzYC9gdGFnc19hbGxgIG1hcCwgYW5kIGBjZGsuVGFncy5vZiguLi4pYCBvbiB0aGUgY29uc3RydWN0LlxuICovXG5leHBvcnQgY29uc3QgRU5GT1JDRURfREVDTEFSRURfSURfS0lORFM6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFtcbiAgJ2lhbS1yb2xlJyxcbiAgJ3MzLWJ1Y2tldCcsXG4gICdjb2duaXRvLXVzZXItcG9vbCcsXG4gICdsYW1iZGEtZnVuY3Rpb24nLFxuXSlcblxuLyoqXG4gKiBUaGUga2luZHMgd2hvc2Ugbm9kZSByZWYgbXVzdCBiZSBVTklRVUUgd2l0aGluIGEgY2hhbm5lbDogZXZlcnkga2luZCB0aGF0IG5hbWVzcGFjZXMgYSBsb2FkLWJlYXJpbmdcbiAqIHZhbHVlIHJvdyBieSBpdHMgb3duIHJlZi4gVHdvIGRpc3RpbmN0IHJlc291cmNlcyBvZiBzdWNoIGEga2luZCBjb2xsYXBzaW5nIG9udG8gb25lIHJlZiBjbG9iYmVyIGVhY2hcbiAqIG90aGVyJ3MgdmFsdWUgbGFzdC13cml0ZS13aW5zIGFuZCBoaWRlIGEgd2lkZW5pbmcgb24gdGhlIGxvc2VyLCBzbyB0aGUgZ2F0ZSBmYWlscyB0aGUgY29sbGlzaW9uXG4gKiBpdHNlbGYuIFRoZSBheGlzIGlzIFZBTFVFLUJFQVJJTkcsIG5vdCBwcmltYXJ5LXZzLWF0dGFjaGVkOiB0aGUgdGFnZ2FibGUge0BsaW5rIERFQ0xBUkVEX0lEX0tJTkRTfSxcbiAqIHRoZSB0d28gY29nbml0byBraW5kcyBrZXllZCBieSBhbiBhdXRob3ItZGVjbGFyZWQgbmF0dXJhbCBrZXkgKHJlc291cmNlLXNlcnZlciBJZGVudGlmaWVyLCBjbGllbnRcbiAqIG5hbWUpLCB0aGUgYXBpLWdhdGV3YXkgYXV0aG9yaXplciAoc2VsZi1rZXllZCBieSBOYW1lKSwgdGhlIHMzIGJ1Y2tldC1wb2xpY3kgKGFuY2hvcmVkIHRvIGl0c1xuICogYnVja2V0IOKAlCBBV1MgcGVybWl0cyBvbmUgcG9saWN5IHBlciBidWNrZXQsIHNvIHR3byBvbiBvbmUgYnVja2V0IGFyZSBhIGR1cGxpY2F0ZSBpZGVudGl0eSksIGFuZCB0aGVcbiAqIGZpcmVob3NlIGRlbGl2ZXJ5IHN0cmVhbSAoYW5jaG9yZWQgdG8gaXRzIGRlbGl2ZXJ5IHJvbGUsIHdob3NlIGRlY2xhcmVkIGlkIGtleXMgaXQg4oCUIGl0cyBkZXN0aW5hdGlvbixcbiAqIHJvdXRpbmcgcHJlZml4LCBjb21wcmVzc2lvbiwgYW5kIHNlcnZlci1zaWRlLWxvZ2dpbmcgZmxhZyBhcmUgbG9hZC1iZWFyaW5nIHZhbHVlIHJvd3MpLCBhbmQgdGhlXG4gKiBPcmdhbml6YXRpb25zIFNDUCAoc2VsZi1rZXllZCBieSBpdHMgcG9saWN5IG5hbWUg4oCUIEFXUyBwZXJtaXRzIG9uZSBwb2xpY3kgcGVyIG5hbWU7IGl0cyBEZW55IGFjdGlvblxuICogc2V0LCBOb3RSZXNvdXJjZSBhbGxvdy1saXN0LCBhbmQgY29uZGl0aW9uIGFyZSBsb2FkLWJlYXJpbmcgdmFsdWUgcm93cyB0aGUgcmVnZW4tY2hlY2sgY29tcGFyZXMgc28gdGhlXG4gKiBjb21taXR0ZWQgZml4dHVyZSBjYW5ub3QgZHJpZnQgZnJvbSBtYWluLnRmKS4gVGhlIHBvb2xlZCBpbmxpbmUtcG9saWN5IC8gbGFtYmRhLXBlcm1pc3Npb24gL1xuICogdXNlci1wb29sLWRvbWFpbiBraW5kcyBhcmUgZXhjbHVkZWQgYmVjYXVzZSB0aGV5IGVtaXQgTk8gdmFsdWUgcm93ICh0aGVpciBzZWN1cml0eSBpcyB0aGUgZ3JhbnRcbiAqIG11bHRpc2V0LCB3aGljaCBlbmxhcmdlcyByYXRoZXIgdGhhbiBjbG9iYmVycyksIG5ldmVyIGJlY2F1c2UgdGhleSBhcmUgXCJhdHRhY2hlZFwiOyB0aGUgcHJlc2VuY2Utb25seVxuICogbG9nLWdyb3VwIC8gbG9nLXN0cmVhbSBraW5kcyBjYXJyeSBubyB2YWx1ZSByb3cgZWl0aGVyLiBBIHN0cnVjdHVyYWwgdGVzdCBrZWVwcyB0aGlzIHNldCBpbiBzdGVwIHdpdGhcbiAqIHRoZSByZWR1Y2VycycgdmFsdWUtd3JpdGluZyBzaXRlcy5cbiAqL1xuZXhwb3J0IGNvbnN0IFZBTFVFX0JFQVJJTkdfS0lORFM6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0PHN0cmluZz4oW1xuICAuLi5ERUNMQVJFRF9JRF9LSU5EUyxcbiAgJ2NvZ25pdG8tcmVzb3VyY2Utc2VydmVyJyxcbiAgJ2NvZ25pdG8tdXNlci1wb29sLWNsaWVudCcsXG4gICdhcGlnYXRld2F5LWF1dGhvcml6ZXInLFxuICAnczMtYnVja2V0LXBvbGljeScsXG4gICdmaXJlaG9zZS1kZWxpdmVyeS1zdHJlYW0nLFxuICAnb3JnYW5pemF0aW9ucy1zY3AnLFxuXSlcblxuLyoqXG4gKiBMb2dpY2FsIGlkIG9mIHRoZSBkZXBsb3ktdGltZSBwYXJhbWV0ZXIgdGhlIHB1Ymxpc2hlZCBDbG91ZEZvcm1hdGlvbiB0ZW1wbGF0ZSBzY29wZXMgYSBmaXJlaG9zZVxuICogc3RyZWFtJ3MgZGVzdGluYXRpb24gbG9ncyBidWNrZXQgYnkuIFRoZSBjb25zdHJ1Y3QgcmUtZXhwb3J0cyB0aGlzIGZyb20gaXRzIG93biBtb2R1bGU7IHRoZSBwYXJpdHlcbiAqIGdhdGUgb3ducyB0aGUgY2Fub25pY2FsIHNwZWxsaW5nIHNvIGl0IGltcG9ydHMgbm90aGluZyBmcm9tIHRoZSBjb25zdHJ1Y3QgZGlyZWN0b3J5LiBUaGVcbiAqIENsb3VkRm9ybWF0aW9uIHBhcmFtZXRlciByZWYgaXMgYEByZWY6TG9nc0J1Y2tldEFybmAuXG4gKi9cbmV4cG9ydCBjb25zdCBMT0dTX0JVQ0tFVF9BUk5fUEFSQU1FVEVSID0gJ0xvZ3NCdWNrZXRBcm4nXG5cbi8qKlxuICogVGhlIFRlcnJhZm9ybSByZWZlcmVuY2UgdG8gdGhlIGRlcGxveS10aW1lIGxvZ3MtYnVja2V0IHZhcmlhYmxlIOKAlCB0aGUgY2hhbm5lbC10d2luIG9mXG4gKiB7QGxpbmsgTE9HU19CVUNLRVRfQVJOX1BBUkFNRVRFUn0uIFRoZSBwdWJsaXNoZWQgbW9kdWxlIG5hbWVzIHRoZSB2YXJpYWJsZSBgbG9nc19idWNrZXRfYXJuYCwgc28gYVxuICogc3RyZWFtIHdob3NlIGRlc3RpbmF0aW9uIGBidWNrZXRfYXJuYCByZWZlcmVuY2VzIHRoaXMgaXMgYm91bmQgdG8gdGhlIGNvbnZlbnRpb25hbCBkZXBsb3ktdGltZSBpbnB1dC5cbiAqIFRoZSB0d28gc3BlbGxpbmdzIChgTG9nc0J1Y2tldEFybmAg4oeEIGB2YXIubG9nc19idWNrZXRfYXJuYCkgYXJlIHRoZSBhdXRob3JlZCBjaGFubmVsIGZvcm1zIG9mIHRoZSBvbmVcbiAqIGlucHV0LCBrZXB0IHRvZ2V0aGVyIGhlcmUgc28gdGhlIHBhcmFtZXRlci1pZGVudGl0eSByZWR1Y3Rpb24ga2V5cyBib3RoIG9uIGEgc2luZ2xlIHNvdXJjZSBvZiB0cnV0aC5cbiAqL1xuZXhwb3J0IGNvbnN0IExPR1NfQlVDS0VUX1ZBUl9SRUZFUkVOQ0UgPSAndmFyLmxvZ3NfYnVja2V0X2FybidcblxuLyoqXG4gKiBUaGUgc3RhYmxlIHRva2VuIHRoZSBkZWNsYXJlZCBkZXBsb3ktdGltZSBsb2dzLWJ1Y2tldCBQQVJBTUVURVIgcmVkdWNlcyB0by4gVGhlIGRlc3RpbmF0aW9uIGJ1Y2tldCBpc1xuICogYSBkZXBsb3ktdGltZSBpbnB1dCBleHRlcm5hbCB0byB0aGUgc3RyZWFtIGFydGlmYWN0LCBzbyB0aGUgY29udmVudGlvbmFsIGNhc2UgcmVhZHMgYXMgdGhlIHBhcmFtZXRlclxuICogcmVmIGBAcmVmOkxvZ3NCdWNrZXRBcm5gIGluIHRoZSBwdWJsaXNoZWQgQ2xvdWRGb3JtYXRpb24gY2hhbm5lbCBhbmQgYSBjb25jcmV0ZSBsaXRlcmFsIGJvdW5kIHRvXG4gKiBgdmFyLmxvZ3NfYnVja2V0X2FybmAgaW4gVGVycmFmb3JtIOKAlCB0d28gY2hhbm5lbC1zcGVjaWZpYyBzcGVsbGluZ3Mgb2YgdGhlIG9uZSBkZXBsb3ktdGltZSBpbnB1dCB0aGVcbiAqIGNvbnN0cnVjdCBuYW1lcy4gQm90aCByZWR1Y2UgdG8gdGhpcyB0b2tlbiBzbyB0aGUgZGVsaXZlcnkgcm9sZSdzIFMzIGdyYW50IG9uIHRoZSBjb252ZW50aW9uYWwgbG9nc1xuICogYnVja2V0IHJlY29uY2lsZXMgY3Jvc3MtY2hhbm5lbCwgd2hpbGUgZXZlcnkgKm90aGVyKiBBUk4ga2VlcHMgaXRzIGlkZW50aXR5IChhIGxpdGVyYWwgc3RheXMgYSBsaXRlcmFsLFxuICogYSByZWYgdG8gYSBkaWZmZXJlbnQtbmFtZWQgcGFyYW1ldGVyIHN0YXlzIGBAcmVmOjxvdGhlcj5gKSBhbmQgdGhlcmVmb3JlIGRpdmVyZ2VzLiBUaGUgdG9rZW4gbmFtZVxuICogY2FycmllcyB0aGUgY29udmVudGlvbiDigJQgXCJ0aGlzIGlzIHRoZSBkZWNsYXJlZCBsb2dzLWJ1Y2tldCBwYXJhbWV0ZXJcIiwgbm90IFwiYW55IGRlbGl2ZXJ5IGRlc3RpbmF0aW9uXCIuXG4gKiBBIHJlYWwgYnVja2V0IEFSTiBvciBhIGRpZmZlcmVudCBwYXJhbWV0ZXIgcmVmIGNhbiBuZXZlciBlcXVhbCB0aGlzIHRva2VuLlxuICovXG5leHBvcnQgY29uc3QgTE9HU19CVUNLRVRfUEFSQU1fVE9LRU4gPSAne2xvZ3MtYnVja2V0LXBhcmFtfSdcblxuLyoqXG4gKiBDYW5vbmljYWxpc2UgYSBncmFudCByZXNvdXJjZSB0byB7QGxpbmsgTE9HU19CVUNLRVRfUEFSQU1fVE9LRU59ICpvbmx5KiB3aGVuIGl0IG5hbWVzIHRoZSBjaGFubmVsJ3NcbiAqIHJlcHJlc2VudGF0aW9uIG9mIHRoZSBkZWNsYXJlZCBkZXBsb3ktdGltZSBsb2dzLWJ1Y2tldCBwYXJhbWV0ZXIsIHByZXNlcnZpbmcgYW55IHRyYWlsaW5nIG9iamVjdCBwYXRoXG4gKiAoYC8gKmApLiBgcGFyYW1EZXN0aW5hdGlvbnNgIGlzIHRoZSBzZXQgb2YgZWFjaCBjaGFubmVsJ3Mgb3duIHJlcHJlc2VudGF0aW9uIG9mIHRoYXQgZGVzdGluYXRpb25cbiAqICoqd2hlbiBhbmQgb25seSB3aGVuKiogdGhlIHN0cmVhbSdzIGBCdWNrZXRBUk5gL2BidWNrZXRfYXJuYCBpcyBib3VuZCB0byB0aGUgY29udmVudGlvbmFsIHBhcmFtZXRlcjpcbiAqIHRoZSBzaW5nbGUgYEByZWY6TG9nc0J1Y2tldEFybmAgZW50cnkgb24gdGhlIENsb3VkRm9ybWF0aW9uIHNpZGUsIHRoZSBjb25jcmV0ZSBgYXJuOmF3czpzMzo6OuKApmAgbGl0ZXJhbFxuICogdGhlIFRlcnJhZm9ybSBzdHJlYW0gYmluZHMgdmlhIGB2YXIubG9nc19idWNrZXRfYXJuYCBvbiB0aGUgVGVycmFmb3JtIHNpZGUuIEEgcmVzb3VyY2UgdGhhdCBpcyBhIGJhcmVcbiAqIGxpdGVyYWwsIG9yIGEgcmVmIHRvIGEgZGlmZmVyZW50LW5hbWVkIHBhcmFtZXRlci92YXJpYWJsZSwgaXMgKipub3QqKiBpbiB0aGUgc2V0IGFuZCBpcyByZXR1cm5lZFxuICogdW5jaGFuZ2VkIOKAlCBzbyBhIHJlLXBvaW50ZWQgZGVzdGluYXRpb24gKGFuIGF0dGFja2VyLWNvbnRyb2xsZWQgZXhmaWwgYnVja2V0LCB3aGV0aGVyIGhhcmRjb2RlZCBvclxuICogd2lyZWQgdG8gYSBkaWZmZXJlbnRseS1uYW1lZCB2YXJpYWJsZSkga2VlcHMgaXRzIGlkZW50aXR5IGFuZCBmYWlscyB0aGUgZ2F0ZSBieSB2YWx1ZS5cbiAqXG4gKiBUaGUgVGVycmFmb3JtIHZhcmlhYmxlIG5hbWUgaXMgbG9hZC1iZWFyaW5nOiB0aGUgd2l0bmVzcyB0aGF0IGEgVEYgbGl0ZXJhbCBpcyB0aGUgY29udmVudGlvbmFsXG4gKiBkZXBsb3ktdGltZSBwYXJhbWV0ZXIgaXMgdGhhdCB0aGUgc3RyZWFtJ3MgZGVzdGluYXRpb24gYGJ1Y2tldF9hcm5gIHJlZmVyZW5jZXMgdGhlIHRvcC1sZXZlbFxuICogYHZhci5sb2dzX2J1Y2tldF9hcm5gLiBBIGhhbmQtcm9sbGVkIG1vZHVsZSB0aGF0IHJlbmFtZXMgdGhhdCB2YXJpYWJsZSB3aGlsZSBzdGlsbCB3aXJpbmcgaXQgYXMgYVxuICogZ2VudWluZSBkZXBsb3ktdGltZSBpbnB1dCB3b3VsZCBmYWlsIENMT1NFRCAoaXRzIGxpdGVyYWwgaXMgdW5yZWNvZ25pc2VkIOKGkiBkaXZlcmdlcyBmcm9tIHRoZVxuICogcGFyYW1ldGVyIHRva2VuKSwgbmV2ZXIgZmFpbCBvcGVuIOKAlCB1c2luZyB0aGUgY29udmVudGlvbmFsIHZhcmlhYmxlIG5hbWUgaXMgcGFydCBvZiB0aGUgcHVibGlzaGVkXG4gKiBjb252ZW50aW9uIHRoZSBnYXRlIHBvbGljZXMsIGFuZCBhIHJlbmFtZWQgZm9yayBpcyByZWFsaWduZWQgYnkgYWRvcHRpbmcgdGhlIGNvbnZlbnRpb24uXG4gKi9cbmV4cG9ydCBjb25zdCBjYW5vbmljYWxpc2VMb2dzQnVja2V0UGFyYW0gPSAocmVzb3VyY2U6IHN0cmluZywgcGFyYW1EZXN0aW5hdGlvbnM6IFJlYWRvbmx5U2V0PHN0cmluZz4pOiBzdHJpbmcgPT4ge1xuICBmb3IgKGNvbnN0IGRlc3RpbmF0aW9uIG9mIHBhcmFtRGVzdGluYXRpb25zKSB7XG4gICAgaWYgKHJlc291cmNlID09PSBkZXN0aW5hdGlvbikgcmV0dXJuIExPR1NfQlVDS0VUX1BBUkFNX1RPS0VOXG4gICAgaWYgKHJlc291cmNlLnN0YXJ0c1dpdGgoYCR7ZGVzdGluYXRpb259L2ApKSByZXR1cm4gYCR7TE9HU19CVUNLRVRfUEFSQU1fVE9LRU59JHtyZXNvdXJjZS5zbGljZShkZXN0aW5hdGlvbi5sZW5ndGgpfWBcbiAgfVxuICByZXR1cm4gcmVzb3VyY2Vcbn1cblxuLyoqXG4gKiBUaGUgVGVycmFmb3JtIHJlZmVyZW5jZSB0byB0aGUgZGVwbG95LXRpbWUgdGVuYW50LW5hbWUgdmFyaWFibGUg4oCUIHRoZSBjaGFubmVsLXR3aW4gb2YgdGhlIHB1Ymxpc2hlZFxuICogQ2xvdWRGb3JtYXRpb24gYFRlbmFudE5hbWVgIHBhcmFtZXRlci4gVGhlIHB1Ymxpc2hlZCBjb2duaXRvIG1vZHVsZSBuYW1lcyB0aGUgdmFyaWFibGUgYG5hbWVgLCBzbyBhXG4gKiBob3N0ZWQtVUkgZG9tYWluIHdob3NlIGBkb21haW5gIGV4cHJlc3Npb24gcmVmZXJlbmNlcyBgdmFyLm5hbWVgIGlzIHJlbmRlcmVkIHRocm91Z2ggdGhlIGNvbnZlbnRpb25hbFxuICogZGVwbG95LXRpbWUgdGVuYW50IGlucHV0LiBUaGUgdHdvIHNwZWxsaW5ncyAoYEByZWY6VGVuYW50TmFtZWAg4oeEIGB2YXIubmFtZWApIGFyZSB0aGUgYXV0aG9yZWQgY2hhbm5lbFxuICogZm9ybXMgb2YgdGhlIG9uZSBpbnB1dCwga2VwdCB0b2dldGhlciBzbyB0aGUgaG9zdGVkLWRvbWFpbiBpZGVudGl0eSByZWR1Y3Rpb24ga2V5cyBib3RoIG9uIG9uZSBzb3VyY2UuXG4gKi9cbmV4cG9ydCBjb25zdCBURU5BTlRfTkFNRV9WQVJfUkVGRVJFTkNFID0gJ3Zhci5uYW1lJ1xuXG4vKiogVGhlIHBsYW4tbGV2ZWwgdmFyaWFibGUga2V5IHRoZSB7QGxpbmsgVEVOQU5UX05BTUVfVkFSX1JFRkVSRU5DRX0gcmVzb2x2ZXMgYWdhaW5zdCDigJQgdGhlIHRvcC1sZXZlbFxuICogYHZhcmlhYmxlc2AgYmxvY2sga2V5cyB0aGUgdGVuYW50IGlucHV0IHVuZGVyIGl0cyBiYXJlIG5hbWUgKGBuYW1lYCksIG5vdCB0aGUgYHZhci5gLXF1YWxpZmllZCByZWZlcmVuY2UuICovXG5leHBvcnQgY29uc3QgVEVOQU5UX05BTUVfVkFSX0tFWSA9ICduYW1lJ1xuXG4vKiogVGhlIGxpdGVyYWwgcHJlZml4IHRoZSBjb252ZW50aW9uYWwgaG9zdGVkLVVJIGRvbWFpbiBpcyByZW5kZXJlZCB3aXRoIOKAlCBgYXBpYWJsZS08dGVuYW50PmAgb24gZXZlcnkgY2hhbm5lbC4gKi9cbmV4cG9ydCBjb25zdCBIT1NURURfRE9NQUlOX1BSRUZJWCA9ICdhcGlhYmxlLSdcblxuLyoqXG4gKiBUaGUgb25seSBmb3JtIGEgaG9zdGVkLVVJIGRvbWFpbiByZWNvbmNpbGVzIGZyb206IGBhcGlhYmxlLWAgKmltbWVkaWF0ZWx5KiBmb2xsb3dlZCBieSB0aGUgZGVwbG95LXRpbWVcbiAqIHRlbmFudCBtYXJrZXIgYEByZWY6YCwgd2l0aCBubyBsaXRlcmFsIGluIGJldHdlZW4uIEV2ZXJ5IGNoYW5uZWwgbXVzdCByZW5kZXIgaXRzIGNvbnZlbnRpb25hbCBkb21haW4gaW50b1xuICogdGhpcyBleGFjdCBzaGFwZSB0byByZWNvbmNpbGUg4oCUIHRoZSBDbG91ZEZvcm1hdGlvbiBjaGFubmVsIHJlc29sdmVzIGBGbjo6Sm9pbltcImFwaWFibGUtXCIsIHtSZWY6IFRlbmFudE5hbWV9XWBcbiAqIHRvIGl0IG5hdGl2ZWx5LCBhbmQgdGhlIFRlcnJhZm9ybSByZWR1Y2VyIHJlY29uc3RydWN0cyBpdCBmcm9tIGEgYGRvbWFpbmAgZXhwcmVzc2lvbiB0aGF0IGlzIHRoZSBiYXJlIHRlbmFudFxuICogdmFyaWFibGUgaW50ZXJwb2xhdGlvbiB1bmRlciB0aGUgYGFwaWFibGUtYCBwcmVmaXguIEEgZG9tYWluIHRoYXQgY2FycmllcyBhbiBpbmplY3RlZCBsaXRlcmFsIGJldHdlZW4gdGhlXG4gKiBwcmVmaXggYW5kIHRoZSB0ZW5hbnQgbWFya2VyIChgYXBpYWJsZS1ldmlsLUByZWY64oCmYCkgaXMgbm90IHRoaXMgc2hhcGUsIGtlZXBzIGl0cyBpZGVudGl0eSwgYW5kIGRpdmVyZ2VzLlxuICovXG5jb25zdCBIT1NURURfRE9NQUlOX1RFTkFOVF9SRU5ERVJJTkcgPSBgJHtIT1NURURfRE9NQUlOX1BSRUZJWH1AcmVmOmBcblxuLyoqXG4gKiBUaGUgc3RhYmxlIHRva2VuIHRoZSBjb252ZW50aW9uYWwgYGFwaWFibGUtPHRlbmFudD5gIGhvc3RlZC1VSSBkb21haW4gcmVkdWNlcyB0by4gVGhlIHRlbmFudCBzZWdtZW50IGlzXG4gKiBhIGRlcGxveS10aW1lIGlucHV0LCBzbyB0aGUgY29udmVudGlvbmFsIGNhc2UgcmVhZHMgYXMgdGhlIHBhcmFtZXRlciBqb2luIGBhcGlhYmxlLUByZWY6VGVuYW50TmFtZWAgaW5cbiAqIHRoZSBwdWJsaXNoZWQgQ2xvdWRGb3JtYXRpb24gY2hhbm5lbCBhbmQgYSBjb25jcmV0ZSBgYXBpYWJsZS08dGVuYW50PmAgbGl0ZXJhbCBib3VuZCB0byBgdmFyLm5hbWVgIGluXG4gKiBUZXJyYWZvcm0g4oCUIHR3byBjaGFubmVsLXNwZWNpZmljIHNwZWxsaW5ncyBvZiB0aGUgb25lIGRlcGxveS10aW1lIHRlbmFudCBpbnB1dCB0aGUgY29uc3RydWN0IG5hbWVzLiBCb3RoXG4gKiByZWR1Y2UgdG8gdGhpcyB0b2tlbiBzbyB0aGUgc2FtZSB0ZW5hbnQncyBob3N0ZWQgc2lnbi1pbiBkb21haW4gKGFuZCB0aGUgYXV0aG9yaXplL3Rva2VuIGRpc2NvdmVyeVxuICogZW5kcG9pbnRzIGRlcml2ZWQgZnJvbSBpdCkgcmVjb25jaWxlIGNyb3NzLWNoYW5uZWwsIHdoaWxlIGEgc3Vic3RpdHV0ZWQgaG9zdCBrZWVwcyBpdHMgaWRlbnRpdHkgYW5kXG4gKiBzdGlsbCBkaXZlcmdlcyBieSB2YWx1ZS4gVGhlIHRva2VuIG5hbWUgY2FycmllcyB0aGUgY29udmVudGlvbiDigJQgXCJ0aGlzIGlzIHRoZSBkZWNsYXJlZCB0ZW5hbnQgaG9zdGVkXG4gKiBkb21haW5cIiwgbm90IFwiYW55IGRvbWFpblwiLiBBIHJlYWwgZG9tYWluIHByZWZpeCB0aGF0IGRvZXMgbm90IGZvbGxvdyB0aGUgY29udmVudGlvbiBjYW4gbmV2ZXIgZXF1YWwgaXQuXG4gKi9cbmV4cG9ydCBjb25zdCBIT1NURURfRE9NQUlOX1RFTkFOVF9UT0tFTiA9ICd7YXBpYWJsZS10ZW5hbnQtZG9tYWlufSdcblxuLyoqXG4gKiBDYW5vbmljYWxpc2UgYSBob3N0ZWQtVUkgZG9tYWluIHdpdG5lc3MgdG8ge0BsaW5rIEhPU1RFRF9ET01BSU5fVEVOQU5UX1RPS0VOfSAqb25seSogd2hlbiBpdCBpcyB0aGVcbiAqIGNvbnZlbnRpb25hbCByZW5kZXJpbmcgb2YgdGhlIGRlcGxveS10aW1lIHRlbmFudCBpbnB1dCDigJQgYGFwaWFibGUtYCBpbW1lZGlhdGVseSBmb2xsb3dlZCBieSB0aGUgdGVuYW50XG4gKiBtYXJrZXIgYEByZWY6YCwgd2l0aCBubyBpbmplY3RlZCBsaXRlcmFsIGJldHdlZW4gdGhlbSAoe0BsaW5rIEhPU1RFRF9ET01BSU5fVEVOQU5UX1JFTkRFUklOR30pLiBFdmVyeVxuICogY2hhbm5lbCByZWR1Y2VzIGl0cyBjb252ZW50aW9uYWwgZG9tYWluIGludG8gdGhhdCBvbmUgc2hhcGUgYmVmb3JlIHRoaXMgY2hlY2ssIHNvIHRoZSBzYW1lIHRlbmFudCdzIGRvbWFpblxuICogcmVjb25jaWxlcyBhY3Jvc3MgY2hhbm5lbHMgZXZlbiB0aG91Z2ggZWFjaCByZW5kZXJzIHRoZSB0ZW5hbnQgc2VnbWVudCBieSBhIHN0cnVjdHVyYWxseSBkaWZmZXJlbnQgcGF0aDpcbiAqIHRoZSBDbG91ZEZvcm1hdGlvbiBjaGFubmVsIHJlc29sdmVzIGl0cyBwYXJhbWV0ZXIgam9pbiB0byB0aGUgc2hhcGUgbmF0aXZlbHksIGFuZCB0aGUgVGVycmFmb3JtIHJlZHVjZXJcbiAqIHJlY29uc3RydWN0cyBpdCBmcm9tIGEgYGRvbWFpbmAgZXhwcmVzc2lvbiB3aG9zZSBlbnRpcmUgdmFsdWUgdW5kZXIgdGhlIGBhcGlhYmxlLWAgcHJlZml4IGlzIHRoZSBiYXJlXG4gKiB0ZW5hbnQgdmFyaWFibGUgaW50ZXJwb2xhdGlvbi4gVGhlIGNoZWNrIGlzIGlkZW50aWNhbCBmb3IgYm90aCBjaGFubmVscywgc28gbmVpdGhlciBpcyBsb29zZXIgdGhhbiB0aGVcbiAqIG90aGVyLlxuICpcbiAqIEEgd2l0bmVzcyB0aGF0IGlzIG5vdCB0aGlzIGV4YWN0IHNoYXBlIGlzIHJldHVybmVkIHVuY2hhbmdlZC4gQSBzdWJzdGl0dXRlZCB0b2tlbi1taW50aW5nIGhvc3QsIGEgYmFyZVxuICogbGl0ZXJhbCBub3Qgd2lyZWQgdG8gdGhlIHRlbmFudCBpbnB1dCwgYW5kIOKAlCB0aGUgY2FzZSB0aGlzIHRpZ2h0bmVzcyBleGlzdHMgdG8gY2F0Y2gg4oCUIGEgZG9tYWluIHRoYXRcbiAqIHNtdWdnbGVzIGFuIGluamVjdGVkIGxpdGVyYWwgYmV0d2VlbiB0aGUgcHJlZml4IGFuZCB0aGUgdGVuYW50IG1hcmtlciAoYGFwaWFibGUtZXZpbC1AcmVmOuKApmAsIHRoZSByZW5kZXJlZFxuICogZm9ybSBvZiBgYXBpYWJsZS1ldmlsLSR7dmFyLm5hbWV9YCkgYWxsIGtlZXAgdGhlaXIgaWRlbnRpdHkgYW5kIGZhaWwgdGhlIGdhdGUgYnkgdmFsdWUgb24gYm90aCBkaXNjb3ZlcnlcbiAqIGVuZHBvaW50cy4gVGhlIGVxdWl2YWxlbmNlIGlzIG5ldmVyIHdpZGVuZWQgaW50byBhY2NlcHRpbmcgc3VjaCBhIGhvc3Q7IHRoZSBzZWN1cml0eSBmbG9vciBpcyBwcmVzZXJ2ZWQsXG4gKiBub3Qgd2Vha2VuZWQuIEEgaGFuZC1yb2xsZWQgbW9kdWxlIHRoYXQgcmVuYW1lcyB0aGUgdGVuYW50IHZhcmlhYmxlIHdoaWxlIHN0aWxsIHdpcmluZyBpdCBhcyBhIGdlbnVpbmVcbiAqIGRlcGxveS10aW1lIGlucHV0IGZhaWxzIENMT1NFRCAoaXRzIHJlY29uc3RydWN0ZWQgd2l0bmVzcyBpcyB1bnJlY29nbmlzZWQg4oaSIGRpdmVyZ2VzIGZyb20gdGhlIHRva2VuKSwgbmV2ZXJcbiAqIGZhaWwgb3BlbjsgYWRvcHRpbmcgdGhlIGNvbnZlbnRpb24gcmVhbGlnbnMgaXQuXG4gKi9cbmV4cG9ydCBjb25zdCBjYW5vbmljYWxpc2VIb3N0ZWREb21haW4gPSAod2l0bmVzczogc3RyaW5nKTogc3RyaW5nID0+XG4gIHdpdG5lc3Muc3RhcnRzV2l0aChIT1NURURfRE9NQUlOX1RFTkFOVF9SRU5ERVJJTkcpID8gSE9TVEVEX0RPTUFJTl9URU5BTlRfVE9LRU4gOiB3aXRuZXNzXG5cbi8qKiBUaGUgc3RhYmxlIHRva2VuIHRoZSBkZXBsb3ktdGltZSB0ZW5hbnQgc2VnbWVudCBvZiBhIHNlbGYtbmFtZWQgcmVzb3VyY2UgY29sbGFwc2VzIHRvLCBzbyB0aGUgc2FtZSBjb25zdHJ1Y3QgcmVjb25jaWxlcyBhY3Jvc3MgYSBwYXJhbWV0ZXItcmVuZGVyZWQgYW5kIGEgY29uY3JldGUtdGVuYW50IGNoYW5uZWwuICovXG5leHBvcnQgY29uc3QgVEVOQU5UX1NFR01FTlRfVE9LRU4gPSAne3RlbmFudH0nXG5cbmNvbnN0IEFVVEhPUklaRVJfTkFNRV9DT05WRU5USU9OID0gL15hcGlhYmxlLSguKyktYXV0aHokL1xuXG4vKipcbiAqIENhbm9uaWNhbGlzZSBhbiBBUEktR2F0ZXdheSBhdXRob3JpemVyJ3Mgc2VsZi1uYW1lIHRvIGEgdGVuYW50LXN0YWJsZSBpZGVudGl0eS4gVGhlIGF1dGhvcml6ZXIgaXNcbiAqIGtleWVkIGJ5IGl0cyBgTmFtZWAgKGl0IGNhcnJpZXMgbm8gZGVjbGFyZWQtaWQgdGFnIOKAlCBBV1MgcGVybWl0cyBvbmUgYXV0aG9yaXplciBwZXIgTmFtZSBvbiBhIFJFU1RcbiAqIEFQSSwgc28gdGhlIE5hbWUgSVMgaXRzIGlkZW50aXR5KSwgYW5kIHRoZSBwdWJsaXNoZWQgY29udmVudGlvbiByZW5kZXJzIGl0IGBhcGlhYmxlLTx0ZW5hbnQ+LWF1dGh6YDpcbiAqIHRoZSBkZXBsb3ktdGltZSB0ZW5hbnQgc2VnbWVudCBpcyB0aGUgcHVibGlzaGVkIENsb3VkRm9ybWF0aW9uIHBhcmFtZXRlciByZWYgKGBhcGlhYmxlLUByZWY6VGVuYW50TmFtZS1hdXRoemApXG4gKiBhbmQgdGhlIGNvbmNyZXRlIHRlbmFudCBpbiBhIFRlcnJhZm9ybSBwbGFuIChgYXBpYWJsZS1zdGFnaW5nLWF1dGh6YCkuIENvbGxhcHNpbmcgdGhlIHRlbmFudCBzZWdtZW50IHRvIGFcbiAqIHN0YWJsZSB0b2tlbiBsZXRzIHRoZSBzYW1lIGNvbnN0cnVjdCdzIGF1dGhvcml6ZXIgcmVjb25jaWxlIGFjcm9zcyBjaGFubmVscyAoaXRzIGlkZW50aXR5IGlzIHRoZSBjb25zdHJ1Y3QsXG4gKiB0ZW5hbnQtaW5kZXBlbmRlbnQsIGV4YWN0bHkgYXMgYSBkZWNsYXJlZCBpZCBpcyksIHdoaWxlIGEgbm9uLWNvbnZlbnRpb25hbCBuYW1lIChhIHN1YnN0aXR1dGVkIGF1dGhvcml6ZXIpXG4gKiBkb2VzIG5vdCBtYXRjaCB0aGUgY29udmVudGlvbiwga2VlcHMgaXRzIGlkZW50aXR5LCBhbmQgc3RpbGwgZGl2ZXJnZXMuIFRoZSBhdXRob3JpemVyJ3MgbG9hZC1iZWFyaW5nIHZhbHVlXG4gKiByb3dzICh0eXBlLCBpZGVudGl0eS1zb3VyY2UsIGV4ZWN1dGlvbi1yb2xlIGdyYW50IHNldCkgYXJlIGNvbXBhcmVkIGluZGVwZW5kZW50bHksIHNvIGEgc3Vic3RpdHV0ZWRcbiAqIGF1dGhvcml6ZXIgdGhhdCBtaW1pY3MgdGhlIG5hbWUgc3RpbGwgZmFpbHMgYnkgdmFsdWUuXG4gKi9cbmV4cG9ydCBjb25zdCBjYW5vbmljYWxpc2VBdXRob3JpemVyTmFtZSA9IChuYW1lOiBzdHJpbmcpOiBzdHJpbmcgPT4ge1xuICBjb25zdCBtYXRjaCA9IEFVVEhPUklaRVJfTkFNRV9DT05WRU5USU9OLmV4ZWMobmFtZSlcbiAgcmV0dXJuIG1hdGNoID09PSBudWxsID8gbmFtZSA6IGBhcGlhYmxlLSR7VEVOQU5UX1NFR01FTlRfVE9LRU59LWF1dGh6YFxufVxuXG4vKiogQSBzZW50aW5lbCBtYXJraW5nIGEgdGFnZ2FibGUgcHJpbWFyeSB0aGF0IHNob3VsZCBjYXJyeSBhIGRlY2xhcmVkIGlkIGJ1dCBkb2VzIG5vdCBpbiB0aGlzIGNoYW5uZWwuICovXG5leHBvcnQgY29uc3QgTUlTU0lOR19ERUNMQVJFRF9JRCA9ICfiiIU6bm8tZGVjbGFyZWQtbG9naWNhbC1pZCdcblxuLyoqXG4gKiBUaGUgZGlzY3JpbWluYXRvciBmb3IgYW4gZW5mb3JjZWQgdGFnZ2FibGUgcHJpbWFyeSB3aG9zZSBkZWNsYXJlZCBpZCBpcyBhYnNlbnQgaW4gdGhpcyBjaGFubmVsOiBhXG4gKiBwZXItY2hhbm5lbC11bmlxdWUgdG9rZW4gYnVpbHQgZnJvbSB0aGUgY2hhbm5lbC1sb2NhbCBpZCwgc28gdGhlIHJlc291cmNlIGNhbiBuZXZlciBjb2luY2lkZSB3aXRoXG4gKiBhbm90aGVyIGNoYW5uZWwncyByZXNvdXJjZSBhbmQgYSBtaXNzaW5nIGlkIGFsd2F5cyBzdXJmYWNlcyBhcyBhbiBleHBsaWNpdCBncmFwaCBkaXZlcmdlbmNlIHJhdGhlclxuICogdGhhbiBiZWluZyBpbmZlcnJlZCBmcm9tIHRoZSBuYW1lLlxuICovXG5leHBvcnQgY29uc3QgbWlzc2luZ0RlY2xhcmVkSWQgPSAobG9jYWxJZDogc3RyaW5nKTogc3RyaW5nID0+IGAke01JU1NJTkdfREVDTEFSRURfSUR9OiR7bG9jYWxJZH1gXG4iXX0=