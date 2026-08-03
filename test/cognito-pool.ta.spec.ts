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

  // 013-1-28: the pre-token-gen handler is inlined so a third-party account, which cannot read
  // Apiable's CDK asset-staging bucket, still reaches CREATE_COMPLETE.
  describe('013-1-28 — pre-token-gen handler is inline, not fetched from a private asset bucket', () => {
    const fnProps = (t: Template): Record<string, unknown> =>
      Object.values(t.findResources('AWS::Lambda::Function'))[0].Properties as Record<string, unknown>

    it('carries an inline ZipFile — no S3Bucket/S3Key, and no reference to a CDK asset-staging bucket — on every channel', () => {
      for (const t of [concrete(), Template.fromStack(buildPublishedStack(new cdk.App()))]) {
        const code = fnProps(t).Code as { ZipFile?: string; S3Bucket?: unknown; S3Key?: unknown }
        expect(typeof code.ZipFile).toBe('string')
        expect(code.S3Bucket).toBeUndefined()
        expect(code.S3Key).toBeUndefined()
        // the exact defect class this story fixes: a customer account cannot read cdk-<qualifier>-assets-*
        expect(JSON.stringify(t.toJSON())).not.toMatch(/cdk-[a-z0-9]+-assets/)
      }
    })

    it('the inlined code is well under the 4,096-byte ZipFile cap and is adapted CommonJS, not the checked-in ESM verbatim', () => {
      const zipFile = (fnProps(concrete()).Code as { ZipFile: string }).ZipFile
      expect(Buffer.byteLength(zipFile, 'utf8')).toBeLessThan(4096)
      expect(zipFile).toContain('exports.handler')
      expect(zipFile).not.toContain('export const handler')
    })

    it('the inlined CommonJS actually executes and produces the same claims shape as the checked-in ESM source (behaviour is unchanged, only where the code lives)', async () => {
      const zipFile = (fnProps(concrete()).Code as { ZipFile: string }).ZipFile
      const scratchFile = path.join(REPO_ROOT, '.tmp-pretokengen-inline-test.js')
      fs.writeFileSync(scratchFile, zipFile)
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        delete require.cache[require.resolve(scratchFile)]
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const inlineModule = require(scratchFile) as { handler: (event: unknown) => Promise<Record<string, unknown>> }
        expect(typeof inlineModule.handler).toBe('function')
        const result = await inlineModule.handler({ callerContext: { clientId: 'test' }, triggerSource: 'TokenGeneration_HostedAuth' })
        expect(result).toEqual({
          callerContext: { clientId: 'test' },
          triggerSource: 'TokenGeneration_HostedAuth',
          response: {
            claimsAndScopeOverrideDetails: {
              accessTokenGeneration: {
                claimsToAddOrOverride: { apiable_api_key: '', apiable_plan_resources: '' },
              },
            },
          },
        })
      } finally {
        fs.unlinkSync(scratchFile)
      }
    })

    it('LambdaConfig still attaches only V3_0 after inlining — the pool-level trigger config is untouched by the code-source change', () => {
      const lambdaConfig = JSON.stringify(poolProps(concrete()).LambdaConfig)
      expect(lambdaConfig).toContain('V3_0')
      expect(lambdaConfig).not.toContain('V1_0')
      expect(lambdaConfig).not.toContain('V2_0')
    })
  })
})
