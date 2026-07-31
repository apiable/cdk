/**
 * Acceptance specs for the gateway-management role construct (synth-level).
 * Frozen contract: contract-013-1-1-pilot-construct-apiable-gateway-role-cdk-cfn.md
 *
 * One spec per contract scenario provable from synthesis alone (no live AWS account):
 * S1, S2, S3, S5, S6, S7, S8, S9, S10, S11. The live-deploy scenario S4 needs a real
 * account and lives in the sibling `*.live.spec.ts`, excluded from this default run.
 */
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import {
  GatewayRoleStack,
  GatewayRoleStackProps,
  TRUST_ACCOUNT_PARAMETER,
  DEFAULT_APIABLE_TRUST_ACCOUNT,
  EGRESS_CIDR_PARAMETER,
  DEFAULT_APIABLE_EGRESS_CIDR,
  ACCOUNT_ID_PATTERN_SOURCE,
  generateLaunchStackUrl,
  launchStackTemplateKey,
  launchStackTemplateS3Uri,
} from '@apiable/cdk-gateway-role'

const APIABLE_TRUST_ACCOUNT = DEFAULT_APIABLE_TRUST_ACCOUNT
const REGION = 'eu-central-1'
const STACK_ID = 'apiable-gateway-role'
const EXPECTED_ROLE_NAME = `apiable-gateway-management-role-${REGION}`

/** Synthesize a fresh stack and return its template. */
const templateFor = (props: GatewayRoleStackProps = {}): Template =>
  Template.fromStack(new GatewayRoleStack(new cdk.App(), STACK_ID, props))

describe('gateway-management role — synth contract', () => {
  // S1 — published component provisions exactly one role + surfaces its identifier as an output
  it('S1: defines one gateway-management role granting apigateway management, with an ARN output', () => {
    const t = templateFor()
    t.resourceCountIs('AWS::IAM::Role', 1)
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Sid: 'ManageApiKeysAndUsagePlans', Effect: 'Allow' }),
        ]),
      }),
    })
    t.hasOutput('*', Match.objectLike({ Value: Match.objectLike({ 'Fn::GetAtt': Match.arrayWith(['Arn']) }) }))
  })

  // S2 — tenant/Apiable values are deploy-time values, addressable by component name + version
  it('S2: trusted account is a CFN parameter, region is deploy-time, artifact is versioned', () => {
    const t = templateFor()
    t.hasParameter(TRUST_ACCOUNT_PARAMETER, Match.objectLike({ Type: 'String' }))
    // region is supplied at deployment time via the AWS::Region pseudo-parameter, not fixed
    expect(JSON.stringify(t.toJSON())).toContain('AWS::Region')
    // the published artifact is addressed by component name + version
    expect(launchStackTemplateKey('1.0.0')).toBe('apiable-gateway-role/1.0.0/template.yaml')
    expect(launchStackTemplateS3Uri('1.0.0')).toMatch(
      /^s3:\/\/[^/]+\/apiable-gateway-role\/1\.0\.0\/template\.yaml$/,
    )
  })

  // S3 — one-click link references the versioned artifact and pre-fills the customer's values
  it('S3: generated launch link carries the versioned template URL and a pre-filled trust parameter', () => {
    const url = generateLaunchStackUrl({
      tenantId: 't-123',
      roleTrustTarget: APIABLE_TRUST_ACCOUNT,
      region: REGION,
      version: '1.0.0',
    })
    expect(url).toContain('console.aws.amazon.com/cloudformation')
    expect(decodeURIComponent(url)).toContain('apiable-gateway-role/1.0.0/template.yaml')
    expect(url).toMatch(/param_ApiableTrustAccount=034444869755/)
  })

  // S5 — omitting optional values still yields the fixed role name and the published trust/egress defaults
  it('S5: with only required inputs, role name, trust account and egress default are the published ones', () => {
    const t = templateFor({ env: { region: REGION } })
    t.hasResourceProperties('AWS::IAM::Role', Match.objectLike({ RoleName: EXPECTED_ROLE_NAME }))
    t.hasParameter(TRUST_ACCOUNT_PARAMETER, Match.objectLike({ Default: APIABLE_TRUST_ACCOUNT }))
    t.hasParameter(EGRESS_CIDR_PARAMETER, Match.objectLike({ Default: DEFAULT_APIABLE_EGRESS_CIDR }))
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'ReadRestApisOnly',
            Effect: 'Allow',
            Action: 'apigateway:GET',
            Resource: [
              `arn:aws:apigateway:${REGION}::/restapis`,
              `arn:aws:apigateway:${REGION}::/restapis/*`,
            ],
          }),
        ]),
      }),
    })
  })

  // S6 — no tenant/Apiable identifier baked into a resource; each is exposed as a deploy-time parameter
  it('S6: synthesized resources contain no hardcoded account or region literal', () => {
    const json = templateFor().toJSON()
    const resources = JSON.stringify(json.Resources)
    // the account flows through as a parameter ref, never baked into a resource property
    expect(resources).not.toContain(APIABLE_TRUST_ACCOUNT)
    // region is the deploy-time pseudo-parameter, so no region literal appears at all
    expect(resources).not.toContain(REGION)
    // and each is genuinely present as a deploy-time value (the account as a parameter, region as AWS::Region)
    expect(json.Parameters?.[TRUST_ACCOUNT_PARAMETER]).toBeDefined()
    expect(JSON.stringify(json)).toContain('AWS::Region')
  })

  // S7 — least privilege: Apiable manages credentials, never the APIs themselves. No Allow may carry
  // a wildcard action, the REST API surface is read-only, and the v2 + off-egress denies are present.
  it('S7: no Allow grants a wildcard action, REST APIs are read-only, and both denies are present', () => {
    const t = templateFor({ env: { region: REGION } })
    const policy = Object.values(t.toJSON().Resources as Record<string, any>).find(
      (r) => r.Type === 'AWS::IAM::Policy',
    )
    const statements = policy.Properties.PolicyDocument.Statement as any[]
    const actionsOf = (s: any): string[] => (Array.isArray(s.Action) ? s.Action : [s.Action])

    // Nothing may be granted with a wildcard action — that is the escalation this scoping exists to stop.
    const allows = statements.filter((s) => s.Effect === 'Allow')
    expect(allows.length).toBeGreaterThan(0)
    for (const s of allows) {
      expect(actionsOf(s)).not.toContain('apigateway:*')
    }

    // The REST API surface is readable and nothing more: no create, update or delete reaches it.
    const restApiAllows = allows.filter((s) =>
      JSON.stringify(s.Resource).includes(`arn:aws:apigateway:${REGION}::/restapis`),
    )
    expect(restApiAllows.length).toBeGreaterThan(0)
    for (const s of restApiAllows) {
      expect(actionsOf(s)).toEqual(['apigateway:GET'])
    }

    // Both fail-closed guards survive: the v2 surface, and any caller outside Apiable's egress.
    const denies = statements.filter((s) => s.Effect === 'Deny')
    expect(denies.map((s) => s.Sid).sort()).toEqual([
      'DenyHttpAndWebSocketApis',
      'DenyOutsideApiableEgress',
    ])
    const egressDeny = denies.find((s) => s.Sid === 'DenyOutsideApiableEgress')
    expect(egressDeny.Condition.NotIpAddress['aws:SourceIp']).toEqual({ Ref: EGRESS_CIDR_PARAMETER })
  })

  // S8 — link generation without a required value fails loudly and emits no link
  it('S8: generating a launch link with a blank trust target throws and returns no URL', () => {
    expect(() =>
      generateLaunchStackUrl({ tenantId: 't-123', roleTrustTarget: '', region: REGION, version: '1.0.0' }),
    ).toThrow(/role-trust target|required/i)
  })

  // S9 — a given version synthesizes equivalently every time (immutable per version)
  it('S9: re-synthesizing the same version produces an equivalent template', () => {
    const a = Template.fromStack(new GatewayRoleStack(new cdk.App(), STACK_ID)).toJSON()
    const b = Template.fromStack(new GatewayRoleStack(new cdk.App(), STACK_ID)).toJSON()
    expect(a).toEqual(b)
  })

  // S10 — one supplied account resolves to exactly that account, with no leftover/extra principal
  it('S10: a supplied trust account resolves to exactly that account and no leftover principal', () => {
    const supplied = '111122223333'
    const t = templateFor({ trustAccount: supplied })
    t.hasParameter(TRUST_ACCOUNT_PARAMETER, Match.objectLike({ Default: supplied }))
    // exactly one trust statement, whose single principal references the trust parameter
    t.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: [
          Match.objectLike({
            Effect: 'Allow',
            Principal: {
              AWS: Match.objectLike({
                'Fn::Join': Match.arrayWith([
                  Match.arrayWith([Match.objectLike({ Ref: TRUST_ACCOUNT_PARAMETER })]),
                ]),
              }),
            },
          }),
        ],
      }),
    })
    // the prior fixed account is not carried over alongside the supplied one
    expect(JSON.stringify(t.findResources('AWS::IAM::Role'))).not.toContain(APIABLE_TRUST_ACCOUNT)
  })

  // S11 — the deploy-time trust parameter is bound to one account; a build-time guard alone is insufficient
  it('S11: the trust parameter constrains the deploy-time value to exactly one 12-digit account', () => {
    const t = templateFor()
    // deploy-time bound: the parameter the launch link pre-fills (and a customer can edit) is constrained
    t.hasParameter(
      TRUST_ACCOUNT_PARAMETER,
      Match.objectLike({ AllowedPattern: ACCOUNT_ID_PATTERN_SOURCE, MinLength: 12, MaxLength: 12 }),
    )
    // a wildcard, comma-list, or extra principal cannot satisfy ^[0-9]{12}$
    expect(ACCOUNT_ID_PATTERN_SOURCE).toBe('^[0-9]{12}$')
    expect('*').not.toMatch(new RegExp(ACCOUNT_ID_PATTERN_SOURCE))
    expect('111122223333,444455556666').not.toMatch(new RegExp(ACCOUNT_ID_PATTERN_SOURCE))
    // build-time guard (defence in depth): a too-wide construct input is rejected up front
    expect(() => new GatewayRoleStack(new cdk.App(), STACK_ID, { trustAccount: '*' })).toThrow(
      /12-digit/,
    )
  })
})
