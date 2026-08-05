/**
 * Test-automation coverage for the apiable-lambda-authorizer construct + handler beyond the frozen
 * acceptance specs: the published one-click parameter path (no hardcoded account/region/name), the SSM
 * read seam (resolveUserPoolIdFromComposition), the non-zero result-cache TTL opt-in, the launch-stack-url
 * generator validation, and handler edge/error paths (multi-scope required sets, whitespace scopes,
 * multi-gateway ARN translation, base-path collapse). Synth-level + real-handler; no live AWS account.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import {
  LambdaAuthorizer,
  LambdaAuthorizerStack,
  buildPublishedStack,
  generateLaunchStackUrl,
  launchStackTemplateKey,
  launchStackTemplateS3Uri,
  launchStackCodeKey,
  DEFAULT_LAUNCHSTACK_BUCKET,
  TENANT_NAME_PARAMETER,
  USER_POOL_ID_PARAMETER,
  REST_API_ID_PARAMETER,
  AUTHORIZER_FUNCTION_LOGICAL_ID,
} from '@apiable/cdk-lambda-authorizer'
import {
  handler,
  verifyScope,
  getServiceArn,
  routeKeyFromMethodArn,
} from '../lib/assets/lambdas/authorization-cc/index.mjs'
import { __setVerifyResult, __setVerifyError, __reset } from './support/aws-jwt-verify-mock'

const REGION = 'eu-central-1'
const TENANT = 'staging'
const TENANT_ACCOUNT = '111111111111'
const POOL_ID = 'eu-central-1_abc123'
const REST_API_ID = 'cqo3riplm6'
const REPO_ROOT = path.resolve(__dirname, '..')

const concrete = (props: Record<string, unknown> = {}): Template =>
  Template.fromStack(
    new LambdaAuthorizerStack(new cdk.App(), 'apiable-lambda-authorizer', {
      name: TENANT,
      userPoolId: POOL_ID,
      restApiId: REST_API_ID,
      env: { account: TENANT_ACCOUNT, region: REGION },
      ...props,
    }),
  )

const lambdaEnv = (t: Template): Record<string, string> =>
  (Object.values(t.findResources('AWS::Lambda::Function'))[0].Properties as {
    Environment?: { Variables?: Record<string, string> }
  }).Environment?.Variables ?? {}

const arn = (method: string, resourcePath: string, apiId = REST_API_ID): string =>
  `arn:aws:execute-api:${REGION}:${TENANT_ACCOUNT}:${apiId}/prod/${method}/${resourcePath}`

beforeEach(() => __reset())

describe('lambda-authorizer — additional automation coverage', () => {
  it('the published one-click template carries no account/region/tenant literal — each is a supplied input', () => {
    const json = Template.fromStack(buildPublishedStack(new cdk.App())).toJSON()
    const resources = JSON.stringify(json.Resources)
    expect(resources).not.toMatch(/(?<!\d)\d{12}(?!\d)/) // no 12-digit account literal
    expect(resources).not.toContain(REGION)
    expect(json.Parameters?.[TENANT_NAME_PARAMETER]).toBeDefined()
    expect(json.Parameters?.[USER_POOL_ID_PARAMETER]).toBeDefined()
    expect(json.Parameters?.[REST_API_ID_PARAMETER]).toBeDefined()
    expect(resources).toMatch(/AWS::Region|AWS::AccountId/)
  })

  it('resolves the gateway-pool id from the SSM composition seam when opted in (no hand-relayed prop)', () => {
    const t = Template.fromStack(
      new (class extends cdk.Stack {
        constructor() {
          super(new cdk.App(), 'S', { env: { account: TENANT_ACCOUNT, region: REGION } })
          new LambdaAuthorizer(this, 'A', {
            name: TENANT,
            restApiId: REST_API_ID,
            resolveUserPoolIdFromComposition: true,
          })
        }
      })(),
    )
    // the userPoolId env resolves from an SSM parameter reference, not a baked literal
    const env = lambdaEnv(t)
    expect(JSON.stringify(env.APIABLE_AWS_AUTHZ_USERPOOLID)).toMatch(/ssm|resolve:|Parameter/i)
  })

  it('requires a userPoolId source — neither prop nor composition supplied throws', () => {
    expect(
      () => new LambdaAuthorizer(new cdk.Stack(new cdk.App(), 'S'), 'A', { name: TENANT, restApiId: REST_API_ID }),
    ).toThrow(/userPoolId/)
  })

  it('defaults the result-cache TTL to 0 and honours a non-zero opt-in', () => {
    expect((Object.values(concrete().findResources('AWS::ApiGateway::Authorizer'))[0].Properties as {
      AuthorizerResultTtlInSeconds?: number
    }).AuthorizerResultTtlInSeconds).toBe(0)
    const withTtl = concrete({ resultsCacheTtlSeconds: 300 })
    withTtl.hasResourceProperties('AWS::ApiGateway::Authorizer', Match.objectLike({ AuthorizerResultTtlInSeconds: 300 }))
  })

  it('serializes a supplied required-scope map into the lambda env', () => {
    const t = concrete({ requiredScopeMap: { 'GET /products': 'apiable/cicd' } })
    expect(JSON.parse(lambdaEnv(t).REQUIRED_SCOPE_MAP)).toEqual({ 'GET /products': 'apiable/cicd' })
  })

  it('always carries the channel-stable declared id on the function, on both the concrete and published synth', () => {
    for (const t of [concrete(), Template.fromStack(buildPublishedStack(new cdk.App()))]) {
      const tags = JSON.stringify(
        (Object.values(t.findResources('AWS::Lambda::Function'))[0].Properties as { Tags?: unknown }).Tags ?? '',
      )
      expect(tags).toContain(AUTHORIZER_FUNCTION_LOGICAL_ID)
    }
  })

  describe('scope gate edge cases (deny-by-default)', () => {
    it('requires ALL scopes in a multi-scope required value', () => {
      const map = { 'GET /x': 'apiable/cicd apiable/read' }
      expect(verifyScope('apiable/cicd apiable/read', map, 'GET /x')).toBe(true)
      expect(verifyScope('apiable/cicd', map, 'GET /x')).toBe(false) // missing one of the two
      expect(verifyScope('apiable/read apiable/cicd apiable/admin', map, 'GET /x')).toBe(true) // superset ok
    })

    it('denies on a whitespace-only required value and tolerates extra spaces in the provided scope', () => {
      expect(verifyScope('apiable/cicd', { 'GET /x': '   ' }, 'GET /x')).toBe(false)
      expect(verifyScope('  apiable/cicd  ', { 'GET /x': 'apiable/cicd' }, 'GET /x')).toBe(true)
    })

    it('denies when the provided scope is empty/undefined', () => {
      expect(verifyScope('', { 'GET /x': 'apiable/cicd' }, 'GET /x')).toBe(false)
    })
  })

  describe('getServiceArn translation (preserved core)', () => {
    it('preserves distinct apiIds across entries (multi-gateway)', () => {
      const arns = getServiceArn(`api-a/prod/GET/a;api-b/prod/POST/b`, arn('GET', 'a', 'api-a'))
      expect(arns).toContain(`arn:aws:execute-api:${REGION}:${TENANT_ACCOUNT}:api-a/prod/GET/a`)
      expect(arns).toContain(`arn:aws:execute-api:${REGION}:${TENANT_ACCOUNT}:api-b/prod/POST/b`)
    })

    it('collapses ANY and {proxy+} to a star segment', () => {
      expect(getServiceArn(`${REST_API_ID}/prod/ANY/{proxy+}`, arn('GET', 'x'))).toEqual([
        `arn:aws:execute-api:${REGION}:${TENANT_ACCOUNT}:${REST_API_ID}/prod/*`,
      ])
    })

    it('deduplicates repeated resource entries', () => {
      const arns = getServiceArn(`${REST_API_ID}/prod/GET/a;${REST_API_ID}/prod/GET/a`, arn('GET', 'a'))
      expect(arns).toEqual([`arn:aws:execute-api:${REGION}:${TENANT_ACCOUNT}:${REST_API_ID}/prod/GET/a`])
    })

    it('throws on a structurally invalid method ARN', () => {
      expect(() => getServiceArn('', 'too:few:parts')).toThrow(/Unexpected method ARN/)
    })
  })

  describe('handler error paths', () => {
    it('rejects (401) a missing or empty bearer token before verification', async () => {
      await expect(handler({ methodArn: arn('GET', 'products') })).rejects.toThrow('Unauthorized')
      await expect(handler({ authorizationToken: '', methodArn: arn('GET', 'products') })).rejects.toThrow('Unauthorized')
    })

    it('denies (403, not 500) a verified token on a structurally bad method ARN', async () => {
      __setVerifyResult({ client_id: 'c', sub: 's', scope: 'apiable/cicd' })
      const denied = await handler({ authorizationToken: 'Bearer t', methodArn: 'bad-arn' })
      expect(denied.policyDocument.Statement[0].Effect).toBe('Deny')
    })

    it('rejects (401) when the verifier throws for any trust reason', async () => {
      __setVerifyError('jwt expired')
      await expect(handler({ authorizationToken: 'Bearer t', methodArn: arn('GET', 'products') })).rejects.toThrow(
        'Unauthorized',
      )
    })
  })

  describe('routeKeyFromMethodArn', () => {
    it('derives nested resource paths', () => {
      expect(routeKeyFromMethodArn(arn('PUT', 'orders/123/items'))).toBe('PUT /orders/123/items')
    })
  })

  describe('launch-stack-url generator', () => {
    it('builds a console deep-link pre-filling the tenant-name + pool-id parameters at the published key', () => {
      const url = generateLaunchStackUrl({
        tenantId: 'cust1',
        tenantName: TENANT,
        userPoolId: POOL_ID,
        region: REGION,
        version: '1.0.0',
      })
      expect(url).toContain(`${REGION}.console.aws.amazon.com/cloudformation/home`)
      expect(url).toContain('param_TenantName=staging')
      expect(url).toContain(`param_UserPoolId=${POOL_ID}`)
      expect(url).toContain(encodeURIComponent(launchStackTemplateKey('1.0.0')))
    })

    it('rejects a missing required value or a malformed tenant name', () => {
      const base = { tenantId: 'c', tenantName: TENANT, userPoolId: POOL_ID, region: REGION, version: '1.0.0' }
      expect(() => generateLaunchStackUrl({ ...base, tenantId: '' })).toThrow(/tenantId/)
      expect(() => generateLaunchStackUrl({ ...base, userPoolId: '' })).toThrow(/userPoolId/)
      expect(() => generateLaunchStackUrl({ ...base, tenantName: 'Bad Name' })).toThrow(/lowercase/)
      expect(() => generateLaunchStackUrl({ ...base, region: '' })).toThrow(/region/)
    })

    it('addresses the published template under the immutable component/version path', () => {
      expect(launchStackTemplateKey('2.3.4')).toBe('apiable-lambda-authorizer/2.3.4/template.yaml')
      expect(launchStackTemplateS3Uri('1.0.0')).toContain('apiable-lambda-authorizer/1.0.0/template.yaml')
    })
  })

  it('the published npm package version matches the launch-stack template key segment (lockstep)', () => {
    const version = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'lib/lambda-authorizer/package.json'), 'utf8')).version
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(launchStackTemplateKey(version)).toBe(`apiable-lambda-authorizer/${version}/template.yaml`)
  })

  // 013-1-28: the handler (8,635 B) is too large to inline, so it deploys from the public launchstack
  // bucket instead of Apiable's private CDK asset-staging bucket, which a customer account cannot read.
  describe('013-1-28 — authorizer code is fetched from the public launchstack bucket, not a private asset bucket', () => {
    const fnProps = (t: Template): Record<string, unknown> =>
      Object.values(t.findResources('AWS::Lambda::Function'))[0].Properties as Record<string, unknown>

    it('carries S3Bucket/S3Key pointing at the public launchstack bucket and the versioned code key — no ZipFile, no CDK asset-staging bucket reference — on every channel', () => {
      const version = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'lib/lambda-authorizer/package.json'), 'utf8')).version
      for (const t of [concrete(), Template.fromStack(buildPublishedStack(new cdk.App()))]) {
        const code = fnProps(t).Code as { S3Bucket?: unknown; S3Key?: unknown; ZipFile?: unknown }
        expect(code.S3Bucket).toBe(DEFAULT_LAUNCHSTACK_BUCKET)
        expect(code.S3Key).toBe(launchStackCodeKey(version))
        expect(code.ZipFile).toBeUndefined()
        // the exact defect class this story fixes: a customer account cannot read cdk-<qualifier>-assets-*
        expect(JSON.stringify(t.toJSON())).not.toMatch(/cdk-[a-z0-9]+-assets/)
      }
    })

    it('the CDK (standalone) and published (one-click) channels reference the identical bucket/key — no publication-mode fork in the construct (RULES.md channel discipline)', () => {
      const cdkCode = fnProps(concrete()).Code
      const publishedCode = fnProps(Template.fromStack(buildPublishedStack(new cdk.App()))).Code
      expect(cdkCode).toEqual(publishedCode)
    })

    it('launchStackCodeKey addresses the code artifact alongside the template, at the same immutable version segment', () => {
      expect(launchStackCodeKey('2.3.4')).toBe('apiable-lambda-authorizer/2.3.4/authorizer.zip')
      const version = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'lib/lambda-authorizer/package.json'), 'utf8')).version
      expect(launchStackCodeKey(version)).toBe(`apiable-lambda-authorizer/${version}/authorizer.zip`)
    })
  })
})
