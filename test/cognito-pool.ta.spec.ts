/**
 * Test-automation coverage for the apiable-cognito-pool construct beyond the frozen acceptance specs:
 * the PLUS tier, the published one-click parameter path (no hardcoded account/region/name), the SSM
 * composition seam (default-off, secret-excluded), the launch-stack-url generator validation, and the
 * reserved-domain edge. Synth-level only — provable without a live AWS account.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import {
  CognitoPool,
  CognitoPoolStack,
  buildPublishedStack,
  generateLaunchStackUrl,
  launchStackTemplateKey,
  TENANT_NAME_PARAMETER,
  COGNITO_POOL_LOGICAL_ID,
} from '@apiable/cdk-cognito-pool'

const REGION = 'eu-central-1'
const TENANT = 'staging'
const TENANT_ACCOUNT = '111111111111'
const REPO_ROOT = path.resolve(__dirname, '..')

const concrete = (props: Record<string, unknown> = {}): Template =>
  Template.fromStack(
    new CognitoPoolStack(new cdk.App(), 'apiable-cognito-pool', {
      name: TENANT,
      env: { account: TENANT_ACCOUNT, region: REGION },
      ...props,
    }),
  )

const poolProps = (t: Template): Record<string, unknown> =>
  Object.values(t.findResources('AWS::Cognito::UserPool'))[0].Properties as Record<string, unknown>

describe('cognito-pool — additional automation coverage', () => {
  it('provisions on the PLUS tier when requested, still at V3_0', () => {
    const props = poolProps(concrete({ featurePlan: 'PLUS' }))
    expect(props.UserPoolTier).toBe('PLUS')
    expect((props.LambdaConfig as { PreTokenGenerationConfig?: { LambdaVersion?: string } })?.PreTokenGenerationConfig?.LambdaVersion).toBe('V3_0')
  })

  it('the published one-click template carries no account/region/tenant literal — each is a supplied input', () => {
    const json = Template.fromStack(buildPublishedStack(new cdk.App())).toJSON()
    const resources = JSON.stringify(json.Resources)
    // no 12-digit account literal and no region literal baked into any resource
    expect(resources).not.toMatch(/(?<!\d)\d{12}(?!\d)/)
    expect(resources).not.toContain(REGION)
    // the tenant name is genuinely a parameter, and the account/region resolve from pseudo-parameters
    expect(json.Parameters?.[TENANT_NAME_PARAMETER]).toBeDefined()
    expect(resources).toMatch(/AWS::Region|AWS::AccountId/)
  })

  it('the SSM composition seam is off by default and publishes only non-secret outputs when enabled', () => {
    // default-off: no SSM parameter resource
    concrete().resourceCountIs('AWS::SSM::Parameter', 0)

    // enabled: publishes the non-secret outputs (userpool-id / issuer-uri / client-id), and no parameter
    // value carries the client secret (publishOutputs refuses secret outputs)
    const enabled = concrete({ publishComposition: true })
    const params = enabled.findResources('AWS::SSM::Parameter')
    expect(Object.keys(params).length).toBeGreaterThan(0)
    const names = Object.values(params).map((p) => JSON.stringify((p.Properties as { Name?: unknown }).Name))
    expect(names.join(' ')).toMatch(/cognito-pool/)
    // no SSM parameter value references the app-client secret attribute
    expect(JSON.stringify(params)).not.toMatch(/UserPoolClientSecret|ClientSecret/i)
  })

  it('publishing composition requires a concrete tenant name (rejects the parameterised path)', () => {
    // the published stack uses a token tenant name; turning on composition there must throw rather than
    // emit a parameter keyed on an unresolved token
    expect(
      () => new CognitoPoolStack(new cdk.App(), 'apiable-cognito-pool', { publishComposition: true }),
    ).toThrow(/concrete tenant name/)
  })

  it('rejects an invalid tenant name slug at construct time', () => {
    expect(
      () =>
        new CognitoPool(new cdk.Stack(new cdk.App(), 'S'), 'P', {
          name: 'Bad_Name!',
          featurePlan: 'ESSENTIALS',
        }),
    ).toThrow(/lowercase letters, digits, and hyphens/)
  })

  it('the pool always carries the channel-stable declared id, on both the concrete and published synth', () => {
    for (const t of [concrete(), Template.fromStack(buildPublishedStack(new cdk.App()))]) {
      expect(JSON.stringify(poolProps(t).UserPoolTags ?? '')).toContain(COGNITO_POOL_LOGICAL_ID)
    }
  })

  describe('launch-stack-url generator', () => {
    it('builds a console deep-link pre-filling the tenant-name parameter at the published key', () => {
      const url = generateLaunchStackUrl({ tenantId: 'cust1', tenantName: TENANT, region: REGION, version: '1.0.0' })
      expect(url).toContain(`${REGION}.console.aws.amazon.com/cloudformation/home`)
      expect(url).toContain('param_TenantName=staging')
      expect(url).toContain(encodeURIComponent(launchStackTemplateKey('1.0.0')))
    })

    it('rejects a missing required value or a malformed tenant name', () => {
      expect(() => generateLaunchStackUrl({ tenantId: '', tenantName: TENANT, region: REGION, version: '1.0.0' })).toThrow(/tenantId/)
      expect(() => generateLaunchStackUrl({ tenantId: 'c', tenantName: 'Bad Name', region: REGION, version: '1.0.0' })).toThrow(/lowercase/)
      expect(() => generateLaunchStackUrl({ tenantId: 'c', tenantName: TENANT, region: '', version: '1.0.0' })).toThrow(/region/)
    })
  })

  it('the published npm package version matches the launch-stack template key segment (lockstep)', () => {
    const version = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'lib/cognito-pool/package.json'), 'utf8')).version
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(launchStackTemplateKey(version)).toBe(`apiable-cognito-pool/${version}/template.yaml`)
  })
})
