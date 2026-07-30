"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Acceptance specs for the gateway-management role construct (synth-level).
 * Frozen contract: contract-013-1-1-pilot-construct-apiable-gateway-role-cdk-cfn.md
 *
 * One spec per contract scenario provable from synthesis alone (no live AWS account):
 * S1, S2, S3, S5, S6, S7, S8, S9, S10, S11. The live-deploy scenario S4 needs a real
 * account and lives in the sibling `*.live.spec.ts`, excluded from this default run.
 */
const cdk = require("aws-cdk-lib");
const assertions_1 = require("aws-cdk-lib/assertions");
const cdk_gateway_role_1 = require("@apiable/cdk-gateway-role");
const APIABLE_TRUST_ACCOUNT = cdk_gateway_role_1.DEFAULT_APIABLE_TRUST_ACCOUNT;
const REGION = 'eu-central-1';
const STACK_ID = 'apiable-gateway-role';
const EXPECTED_ROLE_NAME = `apiable-gateway-managment-role-${REGION}`;
/** Synthesize a fresh stack and return its template. */
const templateFor = (props = {}) => assertions_1.Template.fromStack(new cdk_gateway_role_1.GatewayRoleStack(new cdk.App(), STACK_ID, props));
describe('gateway-management role — synth contract', () => {
    // S1 — published component provisions exactly one role + surfaces its identifier as an output
    it('S1: defines one gateway-management role granting apigateway management, with an ARN output', () => {
        const t = templateFor();
        t.resourceCountIs('AWS::IAM::Role', 1);
        t.hasResourceProperties('AWS::IAM::Policy', {
            PolicyDocument: assertions_1.Match.objectLike({
                Statement: assertions_1.Match.arrayWith([assertions_1.Match.objectLike({ Effect: 'Allow', Action: 'apigateway:*' })]),
            }),
        });
        t.hasOutput('*', assertions_1.Match.objectLike({ Value: assertions_1.Match.objectLike({ 'Fn::GetAtt': assertions_1.Match.arrayWith(['Arn']) }) }));
    });
    // S2 — tenant/Apiable values are deploy-time values, addressable by component name + version
    it('S2: trusted account is a CFN parameter, region is deploy-time, artifact is versioned', () => {
        const t = templateFor();
        t.hasParameter(cdk_gateway_role_1.TRUST_ACCOUNT_PARAMETER, assertions_1.Match.objectLike({ Type: 'String' }));
        // region is supplied at deployment time via the AWS::Region pseudo-parameter, not fixed
        expect(JSON.stringify(t.toJSON())).toContain('AWS::Region');
        // the published artifact is addressed by component name + version
        expect((0, cdk_gateway_role_1.launchStackTemplateKey)('1.0.0')).toBe('apiable-gateway-role/1.0.0/template.yaml');
        expect((0, cdk_gateway_role_1.launchStackTemplateS3Uri)('1.0.0')).toMatch(/^s3:\/\/[^/]+\/apiable-gateway-role\/1\.0\.0\/template\.yaml$/);
    });
    // S3 — one-click link references the versioned artifact and pre-fills the customer's values
    it('S3: generated launch link carries the versioned template URL and a pre-filled trust parameter', () => {
        const url = (0, cdk_gateway_role_1.generateLaunchStackUrl)({
            tenantId: 't-123',
            roleTrustTarget: APIABLE_TRUST_ACCOUNT,
            region: REGION,
            version: '1.0.0',
        });
        expect(url).toContain('console.aws.amazon.com/cloudformation');
        expect(decodeURIComponent(url)).toContain('apiable-gateway-role/1.0.0/template.yaml');
        expect(url).toMatch(/param_ApiableTrustAccount=034444869755/);
    });
    // S5 — omitting optional values reproduces the role existing customers already run (behaviour preserved)
    it('S5: with only required inputs, role name/trust/permissions equal the existing role', () => {
        const t = templateFor({ env: { region: REGION } });
        t.hasResourceProperties('AWS::IAM::Role', assertions_1.Match.objectLike({ RoleName: EXPECTED_ROLE_NAME }));
        t.hasParameter(cdk_gateway_role_1.TRUST_ACCOUNT_PARAMETER, assertions_1.Match.objectLike({ Default: APIABLE_TRUST_ACCOUNT }));
        t.hasResourceProperties('AWS::IAM::Policy', {
            PolicyDocument: assertions_1.Match.objectLike({
                Statement: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        Effect: 'Allow',
                        Action: 'apigateway:*',
                        Resource: `arn:aws:apigateway:${REGION}::/*`,
                    }),
                ]),
            }),
        });
    });
    // S6 — no tenant/Apiable identifier baked into a resource; each is exposed as a deploy-time parameter
    it('S6: synthesized resources contain no hardcoded account or region literal', () => {
        const json = templateFor().toJSON();
        const resources = JSON.stringify(json.Resources);
        // the account flows through as a parameter ref, never baked into a resource property
        expect(resources).not.toContain(APIABLE_TRUST_ACCOUNT);
        // region is the deploy-time pseudo-parameter, so no region literal appears at all
        expect(resources).not.toContain(REGION);
        // and each is genuinely present as a deploy-time value (the account as a parameter, region as AWS::Region)
        expect(json.Parameters?.[cdk_gateway_role_1.TRUST_ACCOUNT_PARAMETER]).toBeDefined();
        expect(JSON.stringify(json)).toContain('AWS::Region');
    });
    // S7 — least privilege: only the customer's own apigateway, scope unchanged from the existing role
    it('S7: grants exactly one statement of apigateway:* scoped to the apigateway ARN, nothing broader', () => {
        const t = templateFor({ env: { region: REGION } });
        t.hasResourceProperties('AWS::IAM::Policy', {
            PolicyDocument: assertions_1.Match.objectLike({
                Statement: [
                    assertions_1.Match.objectLike({
                        Effect: 'Allow',
                        Action: 'apigateway:*',
                        Resource: `arn:aws:apigateway:${REGION}::/*`,
                    }),
                ],
            }),
        });
    });
    // S8 — link generation without a required value fails loudly and emits no link
    it('S8: generating a launch link with a blank trust target throws and returns no URL', () => {
        expect(() => (0, cdk_gateway_role_1.generateLaunchStackUrl)({ tenantId: 't-123', roleTrustTarget: '', region: REGION, version: '1.0.0' })).toThrow(/role-trust target|required/i);
    });
    // S9 — a given version synthesizes equivalently every time (immutable per version)
    it('S9: re-synthesizing the same version produces an equivalent template', () => {
        const a = assertions_1.Template.fromStack(new cdk_gateway_role_1.GatewayRoleStack(new cdk.App(), STACK_ID)).toJSON();
        const b = assertions_1.Template.fromStack(new cdk_gateway_role_1.GatewayRoleStack(new cdk.App(), STACK_ID)).toJSON();
        expect(a).toEqual(b);
    });
    // S10 — one supplied account resolves to exactly that account, with no leftover/extra principal
    it('S10: a supplied trust account resolves to exactly that account and no leftover principal', () => {
        const supplied = '111122223333';
        const t = templateFor({ trustAccount: supplied });
        t.hasParameter(cdk_gateway_role_1.TRUST_ACCOUNT_PARAMETER, assertions_1.Match.objectLike({ Default: supplied }));
        // exactly one trust statement, whose single principal references the trust parameter
        t.hasResourceProperties('AWS::IAM::Role', {
            AssumeRolePolicyDocument: assertions_1.Match.objectLike({
                Statement: [
                    assertions_1.Match.objectLike({
                        Effect: 'Allow',
                        Principal: {
                            AWS: assertions_1.Match.objectLike({
                                'Fn::Join': assertions_1.Match.arrayWith([
                                    assertions_1.Match.arrayWith([assertions_1.Match.objectLike({ Ref: cdk_gateway_role_1.TRUST_ACCOUNT_PARAMETER })]),
                                ]),
                            }),
                        },
                    }),
                ],
            }),
        });
        // the prior fixed account is not carried over alongside the supplied one
        expect(JSON.stringify(t.findResources('AWS::IAM::Role'))).not.toContain(APIABLE_TRUST_ACCOUNT);
    });
    // S11 — the deploy-time trust parameter is bound to one account; a build-time guard alone is insufficient
    it('S11: the trust parameter constrains the deploy-time value to exactly one 12-digit account', () => {
        const t = templateFor();
        // deploy-time bound: the parameter the launch link pre-fills (and a customer can edit) is constrained
        t.hasParameter(cdk_gateway_role_1.TRUST_ACCOUNT_PARAMETER, assertions_1.Match.objectLike({ AllowedPattern: cdk_gateway_role_1.ACCOUNT_ID_PATTERN_SOURCE, MinLength: 12, MaxLength: 12 }));
        // a wildcard, comma-list, or extra principal cannot satisfy ^[0-9]{12}$
        expect(cdk_gateway_role_1.ACCOUNT_ID_PATTERN_SOURCE).toBe('^[0-9]{12}$');
        expect('*').not.toMatch(new RegExp(cdk_gateway_role_1.ACCOUNT_ID_PATTERN_SOURCE));
        expect('111122223333,444455556666').not.toMatch(new RegExp(cdk_gateway_role_1.ACCOUNT_ID_PATTERN_SOURCE));
        // build-time guard (defence in depth): a too-wide construct input is rejected up front
        expect(() => new cdk_gateway_role_1.GatewayRoleStack(new cdk.App(), STACK_ID, { trustAccount: '*' })).toThrow(/12-digit/);
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXRkZC0wMTMtMS0xLXBpbG90LWNvbnN0cnVjdC1hcGlhYmxlLWdhdGV3YXktcm9sZS1jZGstY2ZuLWNvbnN0cnVjdC5zcGVjLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXRkZC0wMTMtMS0xLXBpbG90LWNvbnN0cnVjdC1hcGlhYmxlLWdhdGV3YXktcm9sZS1jZGstY2ZuLWNvbnN0cnVjdC5zcGVjLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUE7Ozs7Ozs7R0FPRztBQUNILG1DQUFrQztBQUNsQyx1REFBd0Q7QUFDeEQsZ0VBU2tDO0FBRWxDLE1BQU0scUJBQXFCLEdBQUcsZ0RBQTZCLENBQUE7QUFDM0QsTUFBTSxNQUFNLEdBQUcsY0FBYyxDQUFBO0FBQzdCLE1BQU0sUUFBUSxHQUFHLHNCQUFzQixDQUFBO0FBQ3ZDLE1BQU0sa0JBQWtCLEdBQUcsa0NBQWtDLE1BQU0sRUFBRSxDQUFBO0FBRXJFLHdEQUF3RDtBQUN4RCxNQUFNLFdBQVcsR0FBRyxDQUFDLFFBQStCLEVBQUUsRUFBWSxFQUFFLENBQ2xFLHFCQUFRLENBQUMsU0FBUyxDQUFDLElBQUksbUNBQWdCLENBQUMsSUFBSSxHQUFHLENBQUMsR0FBRyxFQUFFLEVBQUUsUUFBUSxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUE7QUFFMUUsUUFBUSxDQUFDLDBDQUEwQyxFQUFFLEdBQUcsRUFBRTtJQUN4RCw4RkFBOEY7SUFDOUYsRUFBRSxDQUFDLDRGQUE0RixFQUFFLEdBQUcsRUFBRTtRQUNwRyxNQUFNLENBQUMsR0FBRyxXQUFXLEVBQUUsQ0FBQTtRQUN2QixDQUFDLENBQUMsZUFBZSxDQUFDLGdCQUFnQixFQUFFLENBQUMsQ0FBQyxDQUFBO1FBQ3RDLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxrQkFBa0IsRUFBRTtZQUMxQyxjQUFjLEVBQUUsa0JBQUssQ0FBQyxVQUFVLENBQUM7Z0JBQy9CLFNBQVMsRUFBRSxrQkFBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDLGtCQUFLLENBQUMs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LENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxJQUFJLE1BQU0sQ0FBQyw0Q0FBeUIsQ0FBQyxDQUFDLENBQUE7UUFDOUQsTUFBTSxDQUFDLDJCQUEyQixDQUFDLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxJQUFJLE1BQU0sQ0FBQyw0Q0FBeUIsQ0FBQyxDQUFDLENBQUE7UUFDdEYsdUZBQXVGO1FBQ3ZGLE1BQU0sQ0FBQyxHQUFHLEVBQUUsQ0FBQyxJQUFJLG1DQUFnQixDQUFDLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxFQUFFLFFBQVEsRUFBRSxFQUFFLFlBQVksRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUN4RixVQUFVLENBQ1gsQ0FBQTtJQUNILENBQUMsQ0FBQyxDQUFBO0FBQ0osQ0FBQyxDQUFDLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEFjY2VwdGFuY2Ugc3BlY3MgZm9yIHRoZSBnYXRld2F5LW1hbmFnZW1lbnQgcm9sZSBjb25zdHJ1Y3QgKHN5bnRoLWxldmVsKS5cbiAqIEZyb3plbiBjb250cmFjdDogY29udHJhY3QtMDEzLTEtMS1waWxvdC1jb25zdHJ1Y3QtYXBpYWJsZS1nYXRld2F5LXJvbGUtY2RrLWNmbi5tZFxuICpcbiAqIE9uZSBzcGVjIHBlciBjb250cmFjdCBzY2VuYXJpbyBwcm92YWJsZSBmcm9tIHN5bnRoZXNpcyBhbG9uZSAobm8gbGl2ZSBBV1MgYWNjb3VudCk6XG4gKiBTMSwgUzIsIFMzLCBTNSwgUzYsIFM3LCBTOCwgUzksIFMxMCwgUzExLiBUaGUgbGl2ZS1kZXBsb3kgc2NlbmFyaW8gUzQgbmVlZHMgYSByZWFsXG4gKiBhY2NvdW50IGFuZCBsaXZlcyBpbiB0aGUgc2libGluZyBgKi5saXZlLnNwZWMudHNgLCBleGNsdWRlZCBmcm9tIHRoaXMgZGVmYXVsdCBydW4uXG4gKi9cbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYidcbmltcG9ydCB7IFRlbXBsYXRlLCBNYXRjaCB9IGZyb20gJ2F3cy1jZGstbGliL2Fzc2VydGlvbnMnXG5pbXBvcnQge1xuICBHYXRld2F5Um9sZVN0YWNrLFxuICBHYXRld2F5Um9sZVN0YWNrUHJvcHMsXG4gIFRSVVNUX0FDQ09VTlRfUEFSQU1FVEVSLFxuICBERUZBVUxUX0FQSUFCTEVfVFJVU1RfQUNDT1VOVCxcbiAgQUNDT1VOVF9JRF9QQVRURVJOX1NPVVJDRSxcbiAgZ2VuZXJhdGVMYXVuY2hTdGFja1VybCxcbiAgbGF1bmNoU3RhY2tUZW1wbGF0ZUtleSxcbiAgbGF1bmNoU3RhY2tUZW1wbGF0ZVMzVXJpLFxufSBmcm9tICdAYXBpYWJsZS9jZGstZ2F0ZXdheS1yb2xlJ1xuXG5jb25zdCBBUElBQkxFX1RSVVNUX0FDQ09VTlQgPSBERUZBVUxUX0FQSUFCTEVfVFJVU1RfQUNDT1VOVFxuY29uc3QgUkVHSU9OID0gJ2V1LWNlbnRyYWwtMSdcbmNvbnN0IFNUQUNLX0lEID0gJ2FwaWFibGUtZ2F0ZXdheS1yb2xlJ1xuY29uc3QgRVhQRUNURURfUk9MRV9OQU1FID0gYGFwaWFibGUtZ2F0ZXdheS1tYW5hZ21lbnQtcm9sZS0ke1JFR0lPTn1gXG5cbi8qKiBTeW50aGVzaXplIGEgZnJlc2ggc3RhY2sgYW5kIHJldHVybiBpdHMgdGVtcGxhdGUuICovXG5jb25zdCB0ZW1wbGF0ZUZvciA9IChwcm9wczogR2F0ZXdheVJvbGVTdGFja1Byb3BzID0ge30pOiBUZW1wbGF0ZSA9PlxuICBUZW1wbGF0ZS5mcm9tU3RhY2sobmV3IEdhdGV3YXlSb2xlU3RhY2sobmV3IGNkay5BcHAoKSwgU1RBQ0tfSUQsIHByb3BzKSlcblxuZGVzY3JpYmUoJ2dhdGV3YXktbWFuYWdlbWVudCByb2xlIOKAlCBzeW50aCBjb250cmFjdCcsICgpID0+IHtcbiAgLy8gUzEg4oCUIHB1Ymxpc2hlZCBjb21wb25lbnQgcHJvdmlzaW9ucyBleGFjdGx5IG9uZSByb2xlICsgc3VyZmFjZXMgaXRzIGlkZW50aWZpZXIgYXMgYW4gb3V0cHV0XG4gIGl0KCdTMTogZGVmaW5lcyBvbmUgZ2F0ZXdheS1tYW5hZ2VtZW50IHJvbGUgZ3JhbnRpbmcgYXBpZ2F0ZXdheSBtYW5hZ2VtZW50LCB3aXRoIGFuIEFSTiBvdXRwdXQnLCAoKSA9PiB7XG4gICAgY29uc3QgdCA9IHRlbXBsYXRlRm9yKClcbiAgICB0LnJlc291cmNlQ291bnRJcygnQVdTOjpJQU06OlJvbGUnLCAxKVxuICAgIHQuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OklBTTo6UG9saWN5Jywge1xuICAgICAgUG9saWN5RG9jdW1lbnQ6IE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICBTdGF0ZW1lbnQ6IE1hdGNoLmFycmF5V2l0aChbTWF0Y2gub2JqZWN0TGlrZSh7IEVmZmVjdDogJ0FsbG93JywgQWN0aW9uOiAnYXBpZ2F0ZXdheToqJyB9KV0pLFxuICAgICAgfSksXG4gICAgfSlcbiAgICB0Lmhhc091dHB1dCgnKicsIE1hdGNoLm9iamVjdExpa2UoeyBWYWx1ZTogTWF0Y2gub2JqZWN0TGlrZSh7ICdGbjo6R2V0QXR0JzogTWF0Y2guYXJyYXlXaXRoKFsnQXJuJ10pIH0pIH0pKVxuICB9KVxuXG4gIC8vIFMyIOKAlCB0ZW5hbnQvQXBpYWJsZSB2YWx1ZXMgYXJlIGRlcGxveS10aW1lIHZhbHVlcywgYWRkcmVzc2FibGUgYnkgY29tcG9uZW50IG5hbWUgKyB2ZXJzaW9uXG4gIGl0KCdTMjogdHJ1c3RlZCBhY2NvdW50IGlzIGEgQ0ZOIHBhcmFtZXRlciwgcmVnaW9uIGlzIGRlcGxveS10aW1lLCBhcnRpZmFjdCBpcyB2ZXJzaW9uZWQnLCAoKSA9PiB7XG4gICAgY29uc3QgdCA9IHRlbXBsYXRlRm9yKClcbiAgICB0Lmhhc1BhcmFtZXRlcihUUlVTVF9BQ0NPVU5UX1BBUkFNRVRFUiwgTWF0Y2gub2JqZWN0TGlrZSh7IFR5cGU6ICdTdHJpbmcnIH0pKVxuICAgIC8vIHJlZ2lvbiBpcyBzdXBwbGllZCBhdCBkZXBsb3ltZW50IHRpbWUgdmlhIHRoZSBBV1M6OlJlZ2lvbiBwc2V1ZG8tcGFyYW1ldGVyLCBub3QgZml4ZWRcbiAgICBleHBlY3QoSlNPTi5zdHJpbmdpZnkodC50b0pTT04oKSkpLnRvQ29udGFpbignQVdTOjpSZWdpb24nKVxuICAgIC8vIHRoZSBwdWJsaXNoZWQgYXJ0aWZhY3QgaXMgYWRkcmVzc2VkIGJ5IGNvbXBvbmVudCBuYW1lICsgdmVyc2lvblxuICAgIGV4cGVjdChsYXVuY2hTdGFja1RlbXBsYXRlS2V5KCcxLjAuMCcpKS50b0JlKCdhcGlhYmxlLWdhdGV3YXktcm9sZS8xLjAuMC90ZW1wbGF0ZS55YW1sJylcbiAgICBleHBlY3QobGF1bmNoU3RhY2tUZW1wbGF0ZVMzVXJpKCcxLjAuMCcpKS50b01hdGNoKFxuICAgICAgL15zMzpcXC9cXC9bXi9dK1xcL2FwaWFibGUtZ2F0ZXdheS1yb2xlXFwvMVxcLjBcXC4wXFwvdGVtcGxhdGVcXC55YW1sJC8sXG4gICAgKVxuICB9KVxuXG4gIC8vIFMzIOKAlCBvbmUtY2xpY2sgbGluayByZWZlcmVuY2VzIHRoZSB2ZXJzaW9uZWQgYXJ0aWZhY3QgYW5kIHByZS1maWxscyB0aGUgY3VzdG9tZXIncyB2YWx1ZXNcbiAgaXQoJ1MzOiBnZW5lcmF0ZWQgbGF1bmNoIGxpbmsgY2FycmllcyB0aGUgdmVyc2lvbmVkIHRlbXBsYXRlIFVSTCBhbmQgYSBwcmUtZmlsbGVkIHRydXN0IHBhcmFtZXRlcicsICgpID0+IHtcbiAgICBjb25zdCB1cmwgPSBnZW5lcmF0ZUxhdW5jaFN0YWNrVXJsKHtcbiAgICAgIHRlbmFudElkOiAndC0xMjMnLFxuICAgICAgcm9sZVRydXN0VGFyZ2V0OiBBUElBQkxFX1RSVVNUX0FDQ09VTlQsXG4gICAgICByZWdpb246IFJFR0lPTixcbiAgICAgIHZlcnNpb246ICcxLjAuMCcsXG4gICAgfSlcbiAgICBleHBlY3QodXJsKS50b0NvbnRhaW4oJ2NvbnNvbGUuYXdzLmFtYXpvbi5jb20vY2xvdWRmb3JtYXRpb24nKVxuICAgIGV4cGVjdChkZWNvZGVVUklDb21wb25lbnQodXJsKSkudG9Db250YWluKCdhcGlhYmxlLWdhdGV3YXktcm9sZS8xLjAuMC90ZW1wbGF0ZS55YW1sJylcbiAgICBleHBlY3QodXJsKS50b01hdGNoKC9wYXJhbV9BcGlhYmxlVHJ1c3RBY2NvdW50PTAzNDQ0NDg2OTc1NS8pXG4gIH0pXG5cbiAgLy8gUzUg4oCUIG9taXR0aW5nIG9wdGlvbmFsIHZhbHVlcyByZXByb2R1Y2VzIHRoZSByb2xlIGV4aXN0aW5nIGN1c3RvbWVycyBhbHJlYWR5IHJ1biAoYmVoYXZpb3VyIHByZXNlcnZlZClcbiAgaXQoJ1M1OiB3aXRoIG9ubHkgcmVxdWlyZWQgaW5wdXRzLCByb2xlIG5hbWUvdHJ1c3QvcGVybWlzc2lvbnMgZXF1YWwgdGhlIGV4aXN0aW5nIHJvbGUnLCAoKSA9PiB7XG4gICAgY29uc3QgdCA9IHRlbXBsYXRlRm9yKHsgZW52OiB7IHJlZ2lvbjogUkVHSU9OIH0gfSlcbiAgICB0Lmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpJQU06OlJvbGUnLCBNYXRjaC5vYmplY3RMaWtlKHsgUm9sZU5hbWU6IEVYUEVDVEVEX1JPTEVfTkFNRSB9KSlcbiAgICB0Lmhhc1BhcmFtZXRlcihUUlVTVF9BQ0NPVU5UX1BBUkFNRVRFUiwgTWF0Y2gub2JqZWN0TGlrZSh7IERlZmF1bHQ6IEFQSUFCTEVfVFJVU1RfQUNDT1VOVCB9KSlcbiAgICB0Lmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpJQU06OlBvbGljeScsIHtcbiAgICAgIFBvbGljeURvY3VtZW50OiBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgU3RhdGVtZW50OiBNYXRjaC5hcnJheVdpdGgoW1xuICAgICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgRWZmZWN0OiAnQWxsb3cnLFxuICAgICAgICAgICAgQWN0aW9uOiAnYXBpZ2F0ZXdheToqJyxcbiAgICAgICAgICAgIFJlc291cmNlOiBgYXJuOmF3czphcGlnYXRld2F5OiR7UkVHSU9OfTo6LypgLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdKSxcbiAgICAgIH0pLFxuICAgIH0pXG4gIH0pXG5cbiAgLy8gUzYg4oCUIG5vIHRlbmFudC9BcGlhYmxlIGlkZW50aWZpZXIgYmFrZWQgaW50byBhIHJlc291cmNlOyBlYWNoIGlzIGV4cG9zZWQgYXMgYSBkZXBsb3ktdGltZSBwYXJhbWV0ZXJcbiAgaXQoJ1M2OiBzeW50aGVzaXplZCByZXNvdXJjZXMgY29udGFpbiBubyBoYXJkY29kZWQgYWNjb3VudCBvciByZWdpb24gbGl0ZXJhbCcsICgpID0+IHtcbiAgICBjb25zdCBqc29uID0gdGVtcGxhdGVGb3IoKS50b0pTT04oKVxuICAgIGNvbnN0IHJlc291cmNlcyA9IEpTT04uc3RyaW5naWZ5KGpzb24uUmVzb3VyY2VzKVxuICAgIC8vIHRoZSBhY2NvdW50IGZsb3dzIHRocm91Z2ggYXMgYSBwYXJhbWV0ZXIgcmVmLCBuZXZlciBiYWtlZCBpbnRvIGEgcmVzb3VyY2UgcHJvcGVydHlcbiAgICBleHBlY3QocmVzb3VyY2VzKS5ub3QudG9Db250YWluKEFQSUFCTEVfVFJVU1RfQUNDT1VOVClcbiAgICAvLyByZWdpb24gaXMgdGhlIGRlcGxveS10aW1lIHBzZXVkby1wYXJhbWV0ZXIsIHNvIG5vIHJlZ2lvbiBsaXRlcmFsIGFwcGVhcnMgYXQgYWxsXG4gICAgZXhwZWN0KHJlc291cmNlcykubm90LnRvQ29udGFpbihSRUdJT04pXG4gICAgLy8gYW5kIGVhY2ggaXMgZ2VudWluZWx5IHByZXNlbnQgYXMgYSBkZXBsb3ktdGltZSB2YWx1ZSAodGhlIGFjY291bnQgYXMgYSBwYXJhbWV0ZXIsIHJlZ2lvbiBhcyBBV1M6OlJlZ2lvbilcbiAgICBleHBlY3QoanNvbi5QYXJhbWV0ZXJzPy5bVFJVU1RfQUNDT1VOVF9QQVJBTUVURVJdKS50b0JlRGVmaW5lZCgpXG4gICAgZXhwZWN0KEpTT04uc3RyaW5naWZ5KGpzb24pKS50b0NvbnRhaW4oJ0FXUzo6UmVnaW9uJylcbiAgfSlcblxuICAvLyBTNyDigJQgbGVhc3QgcHJpdmlsZWdlOiBvbmx5IHRoZSBjdXN0b21lcidzIG93biBhcGlnYXRld2F5LCBzY29wZSB1bmNoYW5nZWQgZnJvbSB0aGUgZXhpc3Rpbmcgcm9sZVxuICBpdCgnUzc6IGdyYW50cyBleGFjdGx5IG9uZSBzdGF0ZW1lbnQgb2YgYXBpZ2F0ZXdheToqIHNjb3BlZCB0byB0aGUgYXBpZ2F0ZXdheSBBUk4sIG5vdGhpbmcgYnJvYWRlcicsICgpID0+IHtcbiAgICBjb25zdCB0ID0gdGVtcGxhdGVGb3IoeyBlbnY6IHsgcmVnaW9uOiBSRUdJT04gfSB9KVxuICAgIHQuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OklBTTo6UG9saWN5Jywge1xuICAgICAgUG9saWN5RG9jdW1lbnQ6IE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICBTdGF0ZW1lbnQ6IFtcbiAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgIEVmZmVjdDogJ0FsbG93JyxcbiAgICAgICAgICAgIEFjdGlvbjogJ2FwaWdhdGV3YXk6KicsXG4gICAgICAgICAgICBSZXNvdXJjZTogYGFybjphd3M6YXBpZ2F0ZXdheToke1JFR0lPTn06Oi8qYCxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgIH0pLFxuICAgIH0pXG4gIH0pXG5cbiAgLy8gUzgg4oCUIGxpbmsgZ2VuZXJhdGlvbiB3aXRob3V0IGEgcmVxdWlyZWQgdmFsdWUgZmFpbHMgbG91ZGx5IGFuZCBlbWl0cyBubyBsaW5rXG4gIGl0KCdTODogZ2VuZXJhdGluZyBhIGxhdW5jaCBsaW5rIHdpdGggYSBibGFuayB0cnVzdCB0YXJnZXQgdGhyb3dzIGFuZCByZXR1cm5zIG5vIFVSTCcsICgpID0+IHtcbiAgICBleHBlY3QoKCkgPT5cbiAgICAgIGdlbmVyYXRlTGF1bmNoU3RhY2tVcmwoeyB0ZW5hbnRJZDogJ3QtMTIzJywgcm9sZVRydXN0VGFyZ2V0OiAnJywgcmVnaW9uOiBSRUdJT04sIHZlcnNpb246ICcxLjAuMCcgfSksXG4gICAgKS50b1Rocm93KC9yb2xlLXRydXN0IHRhcmdldHxyZXF1aXJlZC9pKVxuICB9KVxuXG4gIC8vIFM5IOKAlCBhIGdpdmVuIHZlcnNpb24gc3ludGhlc2l6ZXMgZXF1aXZhbGVudGx5IGV2ZXJ5IHRpbWUgKGltbXV0YWJsZSBwZXIgdmVyc2lvbilcbiAgaXQoJ1M5OiByZS1zeW50aGVzaXppbmcgdGhlIHNhbWUgdmVyc2lvbiBwcm9kdWNlcyBhbiBlcXVpdmFsZW50IHRlbXBsYXRlJywgKCkgPT4ge1xuICAgIGNvbnN0IGEgPSBUZW1wbGF0ZS5mcm9tU3RhY2sobmV3IEdhdGV3YXlSb2xlU3RhY2sobmV3IGNkay5BcHAoKSwgU1RBQ0tfSUQpKS50b0pTT04oKVxuICAgIGNvbnN0IGIgPSBUZW1wbGF0ZS5mcm9tU3RhY2sobmV3IEdhdGV3YXlSb2xlU3RhY2sobmV3IGNkay5BcHAoKSwgU1RBQ0tfSUQpKS50b0pTT04oKVxuICAgIGV4cGVjdChhKS50b0VxdWFsKGIpXG4gIH0pXG5cbiAgLy8gUzEwIOKAlCBvbmUgc3VwcGxpZWQgYWNjb3VudCByZXNvbHZlcyB0byBleGFjdGx5IHRoYXQgYWNjb3VudCwgd2l0aCBubyBsZWZ0b3Zlci9leHRyYSBwcmluY2lwYWxcbiAgaXQoJ1MxMDogYSBzdXBwbGllZCB0cnVzdCBhY2NvdW50IHJlc29sdmVzIHRvIGV4YWN0bHkgdGhhdCBhY2NvdW50IGFuZCBubyBsZWZ0b3ZlciBwcmluY2lwYWwnLCAoKSA9PiB7XG4gICAgY29uc3Qgc3VwcGxpZWQgPSAnMTExMTIyMjIzMzMzJ1xuICAgIGNvbnN0IHQgPSB0ZW1wbGF0ZUZvcih7IHRydXN0QWNjb3VudDogc3VwcGxpZWQgfSlcbiAgICB0Lmhhc1BhcmFtZXRlcihUUlVTVF9BQ0NPVU5UX1BBUkFNRVRFUiwgTWF0Y2gub2JqZWN0TGlrZSh7IERlZmF1bHQ6IHN1cHBsaWVkIH0pKVxuICAgIC8vIGV4YWN0bHkgb25lIHRydXN0IHN0YXRlbWVudCwgd2hvc2Ugc2luZ2xlIHByaW5jaXBhbCByZWZlcmVuY2VzIHRoZSB0cnVzdCBwYXJhbWV0ZXJcbiAgICB0Lmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpJQU06OlJvbGUnLCB7XG4gICAgICBBc3N1bWVSb2xlUG9saWN5RG9jdW1lbnQ6IE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICBTdGF0ZW1lbnQ6IFtcbiAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgIEVmZmVjdDogJ0FsbG93JyxcbiAgICAgICAgICAgIFByaW5jaXBhbDoge1xuICAgICAgICAgICAgICBBV1M6IE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgICAgICdGbjo6Sm9pbic6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgICAgICAgICAgICBNYXRjaC5hcnJheVdpdGgoW01hdGNoLm9iamVjdExpa2UoeyBSZWY6IFRSVVNUX0FDQ09VTlRfUEFSQU1FVEVSIH0pXSksXG4gICAgICAgICAgICAgICAgXSksXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgIH0pLFxuICAgIH0pXG4gICAgLy8gdGhlIHByaW9yIGZpeGVkIGFjY291bnQgaXMgbm90IGNhcnJpZWQgb3ZlciBhbG9uZ3NpZGUgdGhlIHN1cHBsaWVkIG9uZVxuICAgIGV4cGVjdChKU09OLnN0cmluZ2lmeSh0LmZpbmRSZXNvdXJjZXMoJ0FXUzo6SUFNOjpSb2xlJykpKS5ub3QudG9Db250YWluKEFQSUFCTEVfVFJVU1RfQUNDT1VOVClcbiAgfSlcblxuICAvLyBTMTEg4oCUIHRoZSBkZXBsb3ktdGltZSB0cnVzdCBwYXJhbWV0ZXIgaXMgYm91bmQgdG8gb25lIGFjY291bnQ7IGEgYnVpbGQtdGltZSBndWFyZCBhbG9uZSBpcyBpbnN1ZmZpY2llbnRcbiAgaXQoJ1MxMTogdGhlIHRydXN0IHBhcmFtZXRlciBjb25zdHJhaW5zIHRoZSBkZXBsb3ktdGltZSB2YWx1ZSB0byBleGFjdGx5IG9uZSAxMi1kaWdpdCBhY2NvdW50JywgKCkgPT4ge1xuICAgIGNvbnN0IHQgPSB0ZW1wbGF0ZUZvcigpXG4gICAgLy8gZGVwbG95LXRpbWUgYm91bmQ6IHRoZSBwYXJhbWV0ZXIgdGhlIGxhdW5jaCBsaW5rIHByZS1maWxscyAoYW5kIGEgY3VzdG9tZXIgY2FuIGVkaXQpIGlzIGNvbnN0cmFpbmVkXG4gICAgdC5oYXNQYXJhbWV0ZXIoXG4gICAgICBUUlVTVF9BQ0NPVU5UX1BBUkFNRVRFUixcbiAgICAgIE1hdGNoLm9iamVjdExpa2UoeyBBbGxvd2VkUGF0dGVybjogQUNDT1VOVF9JRF9QQVRURVJOX1NPVVJDRSwgTWluTGVuZ3RoOiAxMiwgTWF4TGVuZ3RoOiAxMiB9KSxcbiAgICApXG4gICAgLy8gYSB3aWxkY2FyZCwgY29tbWEtbGlzdCwgb3IgZXh0cmEgcHJpbmNpcGFsIGNhbm5vdCBzYXRpc2Z5IF5bMC05XXsxMn0kXG4gICAgZXhwZWN0KEFDQ09VTlRfSURfUEFUVEVSTl9TT1VSQ0UpLnRvQmUoJ15bMC05XXsxMn0kJylcbiAgICBleHBlY3QoJyonKS5ub3QudG9NYXRjaChuZXcgUmVnRXhwKEFDQ09VTlRfSURfUEFUVEVSTl9TT1VSQ0UpKVxuICAgIGV4cGVjdCgnMTExMTIyMjIzMzMzLDQ0NDQ1NTU1NjY2NicpLm5vdC50b01hdGNoKG5ldyBSZWdFeHAoQUNDT1VOVF9JRF9QQVRURVJOX1NPVVJDRSkpXG4gICAgLy8gYnVpbGQtdGltZSBndWFyZCAoZGVmZW5jZSBpbiBkZXB0aCk6IGEgdG9vLXdpZGUgY29uc3RydWN0IGlucHV0IGlzIHJlamVjdGVkIHVwIGZyb250XG4gICAgZXhwZWN0KCgpID0+IG5ldyBHYXRld2F5Um9sZVN0YWNrKG5ldyBjZGsuQXBwKCksIFNUQUNLX0lELCB7IHRydXN0QWNjb3VudDogJyonIH0pKS50b1Rocm93KFxuICAgICAgLzEyLWRpZ2l0LyxcbiAgICApXG4gIH0pXG59KVxuIl19