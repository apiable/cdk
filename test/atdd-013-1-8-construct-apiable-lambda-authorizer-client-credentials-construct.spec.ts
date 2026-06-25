/**
 * Acceptance specs for the apiable-lambda-authorizer construct (the scope-enforcing gateway authorizer
 * for the client_credentials machine-to-machine flow) across all three channels + the real handler.
 * Frozen contract: contract-013-1-8-construct-apiable-lambda-authorizer-client-credentials.md
 *
 * One un-skipped spec per contract scenario (S1–S7). The synth-level properties are asserted as literal
 * values on every channel that carries them (CDK construct, published one-click CFN, hand-rolled
 * Terraform). The runtime security behaviour (deny-by-default scope gate, token-trust boundary, no
 * sensitive logging) is proven by executing the REAL authorizer handler against an injectable Cognito
 * verifier — never a copy of its logic. Decision 1a: apiable_plan_resources ships empty/stubbed; the
 * live per-method control is the deny-by-default SCOPE gate, gated on the native `scope` claim.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import {
  LambdaAuthorizer,
  LambdaAuthorizerStack,
  LambdaAuthorizerStackProps,
  buildPublishedStack,
  TENANT_NAME_PARAMETER,
  USER_POOL_ID_PARAMETER,
  REST_API_ID_PARAMETER,
  AUTHORIZER_TYPE,
  AUTHORIZER_IDENTITY_SOURCE,
  AUTHORIZER_FUNCTION_LOGICAL_ID,
  AUTHORIZER_ROLE_LOGICAL_ID,
} from '@apiable/cdk-lambda-authorizer'
// The REAL handler + its pure security-critical functions (no copied logic). aws-jwt-verify is mapped
// to the injectable mock in jest.config.js, so importing the handler does not need a live Cognito pool.
import {
  handler,
  verifyScope,
  getServiceArn,
  routeKeyFromMethodArn,
  generateIAMPolicy,
  defaultDenyAllPolicy,
} from '../lib/assets/lambdas/authorization-cc/index.mjs'
import {
  __setVerifyResult,
  __setVerifyError,
  __reset,
  __lastCreateConfig,
} from './support/aws-jwt-verify-mock'

const REGION = 'eu-central-1'
const TENANT = 'staging'
const TENANT_ACCOUNT = '111111111111'
const STACK_ID = 'apiable-lambda-authorizer'
const POOL_ID = 'eu-central-1_abc123'
const REST_API_ID = 'cqo3riplm6'
const HARDCODED_APIABLE_ACCOUNT = '034444869755'

const REPO_ROOT = path.resolve(__dirname, '..')
const TF_MODULE_DIR = path.join(REPO_ROOT, 'terraform/apiable-lambda-authorizer')
const CDK_ASSET_DIR = path.join(REPO_ROOT, 'lib/assets/lambdas/authorization-cc')
const ASSET = path.join(CDK_ASSET_DIR, 'index.mjs')

const concreteTemplate = (overrides: LambdaAuthorizerStackProps = {}): Template =>
  Template.fromStack(
    new LambdaAuthorizerStack(new cdk.App(), STACK_ID, {
      name: TENANT,
      userPoolId: POOL_ID,
      restApiId: REST_API_ID,
      env: { account: TENANT_ACCOUNT, region: REGION },
      ...overrides,
    }),
  )

/** The published one-click synth: no env, so the account is AWS::AccountId and the inputs are parameters. */
const publishedTemplate = (): Template => Template.fromStack(buildPublishedStack(new cdk.App()))

const tfModule = (name: string): string => fs.readFileSync(path.join(TF_MODULE_DIR, name), 'utf8')

const firstResource = (t: Template, type: string): { Properties?: Record<string, unknown> } =>
  Object.values(t.findResources(type))[0] as { Properties?: Record<string, unknown> }

const lambdaEnv = (t: Template): Record<string, string> =>
  ((firstResource(t, 'AWS::Lambda::Function').Properties?.Environment as { Variables?: Record<string, string> })
    ?.Variables ?? {}) as Record<string, string>

const authorizerProps = (t: Template): Record<string, unknown> =>
  (firstResource(t, 'AWS::ApiGateway::Authorizer').Properties ?? {}) as Record<string, unknown>

/** Build a method ARN for a given METHOD + resource path (the shape API Gateway passes a TOKEN authorizer). */
const methodArn = (method: string, resourcePath: string, apiId = REST_API_ID): string =>
  `arn:aws:execute-api:${REGION}:${TENANT_ACCOUNT}:${apiId}/prod/${method}/${resourcePath}`

beforeEach(() => __reset())

describe('013-1-8 apiable-lambda-authorizer — synth + parity contract + handler', () => {
  // contract: S1 — validates a machine-to-machine access token, not a user-pool sign-in token
  it('S1: validates client_credentials access tokens (tokenUse=access via the verifier), not user-pool sign-in tokens', async () => {
    // ── CDK construct channel: a TOKEN authorizer reading the Authorization header is provisioned ──
    const t = concreteTemplate()
    t.hasResourceProperties(
      'AWS::ApiGateway::Authorizer',
      Match.objectLike({ Type: AUTHORIZER_TYPE, IdentitySource: AUTHORIZER_IDENTITY_SOURCE }),
    )
    expect(AUTHORIZER_TYPE).toBe('TOKEN')

    // ── published one-click CFN channel: same load-bearing literals ───────────────────────────────
    const pub = authorizerProps(publishedTemplate())
    expect(pub.Type).toBe('TOKEN')
    expect(pub.IdentitySource).toBe('method.request.header.Authorization')

    // ── Terraform channel: the hand-rolled module declares the identical TOKEN authorizer ─────────
    const main = tfModule('main.tf')
    expect(main).toMatch(/resource\s+"aws_api_gateway_authorizer"/)
    expect(main).toMatch(/type\s*=\s*"TOKEN"/)
    expect(main).toMatch(/identity_source\s*=\s*"method\.request\.header\.Authorization"/)

    // ── the REAL handler asks the verifier for tokenUse=access (rejecting ID tokens at the boundary) ──
    __setVerifyResult({ client_id: 'c1', sub: 's1', scope: 'apiable/cicd' })
    await handler({ authorizationToken: 'Bearer tok', methodArn: methodArn('GET', 'products') })
    expect(__lastCreateConfig()).toMatchObject({ tokenUse: 'access', clientId: null })
    // the asset pins tokenUse:'access' in source (not the legacy tokenUse:null which accepts ID tokens)
    const src = fs.readFileSync(ASSET, 'utf8')
    expect(src).toMatch(/tokenUse:\s*'access'/)
    expect(src).not.toMatch(/tokenUse:\s*null/)
  })

  // contract: S2 — derives the per-method permission from the token's granted-resources claim (preserved core)
  it('S2: derives the per-method IAM policy from the token apiable_plan_resources claim via the preserved getServiceArn core (multi-gateway preserved)', async () => {
    // The semicolon claim format is {apiId}/{stage}/{METHOD}/{path};… (Portal's buildResourcesString) —
    // each entry replaces the methodArn's trailing resource segment verbatim, so an entry carrying its
    // OWN apiId is preserved (multi-gateway: distinct apiIds survive on the same evaluation).
    const arns = getServiceArn(
      `${REST_API_ID}/prod/GET/products;other-api/prod/POST/orders`,
      methodArn('GET', 'products'),
    )
    expect(arns).toContain(`arn:aws:execute-api:${REGION}:${TENANT_ACCOUNT}:${REST_API_ID}/prod/GET/products`)
    expect(arns).toContain(`arn:aws:execute-api:${REGION}:${TENANT_ACCOUNT}:other-api/prod/POST/orders`)

    // {proxy+} flattening collapses a proxy route to */* on the entry (per-method then comes from the scope gate)
    const proxyArns = getServiceArn(`${REST_API_ID}/prod/ANY/{proxy+}`, methodArn('GET', 'anything'))
    expect(proxyArns).toEqual([`arn:aws:execute-api:${REGION}:${TENANT_ACCOUNT}:${REST_API_ID}/prod/*`])

    // empty claim → grant the invoked API (apiId/stage/*), sourced from the methodArn, never an env stub
    expect(getServiceArn('', methodArn('GET', 'products'))).toEqual([
      `arn:aws:execute-api:${REGION}:${TENANT_ACCOUNT}:${REST_API_ID}/prod/*`,
    ])

    // the handler reads the claim off the verified token (not an env var) and emits an Allow policy
    __setVerifyResult({
      client_id: 'c1',
      sub: 's1',
      scope: 'apiable/cicd',
      apiable_plan_resources: `${REST_API_ID}/prod/GET/products`,
    })
    const policy = await handler({ authorizationToken: 'Bearer tok', methodArn: methodArn('GET', 'products') })
    expect(policy.policyDocument.Statement[0].Effect).toBe('Allow')
    expect(policy.policyDocument.Statement[0].Resource).toContain(
      `arn:aws:execute-api:${REGION}:${TENANT_ACCOUNT}:${REST_API_ID}/prod/GET/products`,
    )
    // on a scope-pass, usageIdentifierKey is supplied from apiable_api_key (the hidden-key path)
    __setVerifyResult({ client_id: 'c1', sub: 's1', scope: 'apiable/cicd', apiable_api_key: 'key-123' })
    const withKey = await handler({ authorizationToken: 'Bearer tok', methodArn: methodArn('GET', 'products') })
    expect(withKey.usageIdentifierKey).toBe('key-123')
  })

  // contract: S3 — existing sign-in customers' legacy fallback stays functional (dead only for new deploys)
  it('S3: the legacy adminGetUser fallback is preserved in the brownfield asset and ABSENT from the greenfield asset', () => {
    // the greenfield asset carries NONE of the legacy compat layers (no adminGetUser call, no AUTH_METHOD
    // branch, no HYBRID/api-key fallback, no aws-sdk dependency, no credit signing key)
    const greenfield = fs.readFileSync(ASSET, 'utf8')
    expect(greenfield).not.toMatch(/\.adminGetUser\(/)
    expect(greenfield).not.toContain('AUTH_METHOD')
    expect(greenfield).not.toMatch(/HYBRID/i)
    expect(greenfield).not.toContain("from 'aws-sdk'")
    expect(greenfield).not.toContain('APIABLE_AWS_AUTHZ_CREDIT_SIGNING_KEY')
    expect(greenfield).not.toContain('/credits/check')

    // the legacy authorizer asset (the opt-in brownfield variant) still exists and keeps the adminGetUser
    // user-pool lookup, so an existing user-pool-sign-in customer's flow is not removed from the path
    // they rely on — it is dead code only for new wizard-generated deployments
    const legacy = fs.readFileSync(
      path.join(REPO_ROOT, 'lib/assets/lambdas/authorization/index.mjs'),
      'utf8',
    )
    expect(legacy).toMatch(/adminGetUser/)
  })

  // contract: S4 — DENY-BY-DEFAULT (forced): unset/unknown required scope or missing scope → deny
  it('S4: deny-by-default — unmapped method, empty required scope, or a token missing the scope all DENY (never allow-by-default)', async () => {
    const map = { 'GET /products': 'apiable/cicd', 'POST /orders': '' }

    // token HAS the scope for a mapped method → allow
    expect(verifyScope('apiable/cicd apiable/read', map, 'GET /products')).toBe(true)
    // method NOT in the map → deny (fail-closed on an unmapped route)
    expect(verifyScope('apiable/cicd', map, 'DELETE /products')).toBe(false)
    // mapped method with an EMPTY required value → deny (fail-closed)
    expect(verifyScope('apiable/cicd', map, 'POST /orders')).toBe(false)
    // token LACKS the required scope → deny
    expect(verifyScope('apiable/read', map, 'GET /products')).toBe(false)
    // an unparseable / null map → deny everything
    expect(verifyScope('apiable/cicd', null, 'GET /products')).toBe(false)
    expect(verifyScope('apiable/cicd', {}, 'GET /products')).toBe(false)

    // end-to-end through the REAL handler (seeded map: GET /products → apiable/cicd, POST /reports → ""):
    // an UNMAPPED method denies even with a valid scope; a mapped-but-empty-required method denies too
    __setVerifyResult({ client_id: 'c1', sub: 's1', scope: 'apiable/cicd' })
    const deniedUnmapped = await handler({ authorizationToken: 'Bearer tok', methodArn: methodArn('DELETE', 'products') })
    expect(deniedUnmapped).toBe(defaultDenyAllPolicy)
    expect(deniedUnmapped.policyDocument.Statement[0].Effect).toBe('Deny')
    const deniedEmptyRequired = await handler({ authorizationToken: 'Bearer tok', methodArn: methodArn('POST', 'reports') })
    expect(deniedEmptyRequired).toBe(defaultDenyAllPolicy)
    // a token missing the required scope on a MAPPED method denies
    __setVerifyResult({ client_id: 'c1', sub: 's1', scope: 'apiable/read' })
    const deniedMissingScope = await handler({ authorizationToken: 'Bearer tok', methodArn: methodArn('GET', 'products') })
    expect(deniedMissingScope).toBe(defaultDenyAllPolicy)
    // and the happy path: the token carrying the mapped scope is ALLOWED
    __setVerifyResult({ client_id: 'c1', sub: 's1', scope: 'apiable/cicd' })
    const allowed = await handler({ authorizationToken: 'Bearer tok', methodArn: methodArn('GET', 'products') })
    expect(allowed.policyDocument.Statement[0].Effect).toBe('Allow')

    // a malformed/absent methodArn (post-verification) denies through the same explicit 403 channel,
    // never an uncaught throw — fail-closed on structurally-bad input
    __setVerifyResult({ client_id: 'c1', sub: 's1', scope: 'apiable/cicd' })
    const deniedMalformed = await handler({ authorizationToken: 'Bearer tok', methodArn: 'not-an-arn' })
    expect(deniedMalformed).toBe(defaultDenyAllPolicy)
    const deniedMissingArn = await handler({ authorizationToken: 'Bearer tok' })
    expect(deniedMissingArn).toBe(defaultDenyAllPolicy)

    // the construct ships an EMPTY required-scope map by default (so an un-configured authorizer denies)
    expect(lambdaEnv(concreteTemplate()).REQUIRED_SCOPE_MAP).toBe('{}')
    // and the source inverts the spike fail-open: an empty/unset required value returns false (deny)
    const src = fs.readFileSync(ASSET, 'utf8')
    expect(src).toMatch(/if\s*\(\s*!required\s*\)\s*\{\s*return false/)
  })

  // contract: S5 — NO-LEAK (forced): never logs token/claims/api-key; no committed secret
  it('S5: logs only client_id/sub/outcome — never the token, claims, or api-key; source carries no committed secret', async () => {
    const logs: string[] = []
    const spy = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })
    try {
      // Obviously-fake sentinels (not credentials): the test asserts these strings never reach the logs.
      const SECRET_TOKEN = 'fake-bearer-token-must-not-be-logged'
      const API_KEY = 'fake-api-key-must-not-be-logged'
      // allow path (GET /products is mapped to apiable/cicd in the seeded map)
      __setVerifyResult({ client_id: 'c1', sub: 's1', scope: 'apiable/cicd', apiable_api_key: API_KEY })
      await handler({ authorizationToken: `Bearer ${SECRET_TOKEN}`, methodArn: methodArn('GET', 'products') })
      // deny path (unmapped method)
      __setVerifyResult({ client_id: 'c2', sub: 's2', scope: 'apiable/none', apiable_api_key: API_KEY })
      await handler({ authorizationToken: `Bearer ${SECRET_TOKEN}`, methodArn: methodArn('DELETE', 'products') })
      // reject path (bad token)
      __setVerifyError('invalid signature')
      await expect(
        handler({ authorizationToken: `Bearer ${SECRET_TOKEN}`, methodArn: methodArn('GET', 'products') }),
      ).rejects.toThrow('Unauthorized')

      const all = logs.join('\n')
      expect(all).not.toContain(SECRET_TOKEN)
      expect(all).not.toContain(API_KEY)
      // it DID log identity + outcome (allow on the mapped route, deny on the unmapped route)
      expect(all).toMatch(/client=c1/)
      expect(all).toMatch(/allow/)
      expect(all).toMatch(/deny/)
    } finally {
      spy.mockRestore()
    }

    // no committed secret / placeholder credential in the asset or the construct (the authz.ts anti-pattern)
    const src = fs.readFileSync(ASSET, 'utf8')
    expect(src).not.toContain('replace-me-with-your-key')
    expect(src).not.toContain('APIABLE_AWS_AUTHZ_CREDIT_SIGNING_KEY')
    expect(src).not.toMatch(/console\.log\(\s*['"`]?token['"`]?\s*,/)
    const constructSrc = fs.readFileSync(path.join(REPO_ROOT, 'lib/lambda-authorizer/lambda-authorizer.ts'), 'utf8')
    expect(constructSrc).not.toContain('replace-me-with-your-key')
    expect(constructSrc).not.toContain('APIABLE_AWS_AUTHZ_CREDIT_SIGNING_KEY')
    // the env carries no credit-signing key on any channel
    expect(lambdaEnv(concreteTemplate())).not.toHaveProperty('APIABLE_AWS_AUTHZ_CREDIT_SIGNING_KEY')
    expect(JSON.stringify(lambdaEnv(publishedTemplate()))).not.toContain('CREDIT_SIGNING_KEY')
    expect(tfModule('main.tf')).not.toContain('CREDIT_SIGNING_KEY')
  })

  // contract: S6 — TOKEN-TRUST (forced): bad signature/issuer/expiry or wrong token-type → reject
  it('S6: a token failing signature/issuer/expiry/token-type is rejected (401); only a valid M2M access token is accepted', async () => {
    // the verifier enforces signature + issuer + expiry + token_use=access; any failure → reject (401)
    for (const reason of ['invalid signature', 'token issuer mismatch', 'token expired', 'token_use not access']) {
      __setVerifyError(reason)
      await expect(
        handler({ authorizationToken: 'Bearer bad', methodArn: methodArn('GET', 'products') }),
      ).rejects.toThrow('Unauthorized')
    }
    // a missing token is also rejected (401), never silently allowed
    await expect(handler({ methodArn: methodArn('GET', 'products') })).rejects.toThrow('Unauthorized')

    // the construct pins tokenUse:'access' so an ID/sign-in token is rejected at the boundary
    __setVerifyResult({ client_id: 'c1', sub: 's1', scope: 'apiable/cicd' })
    await handler({ authorizationToken: 'Bearer ok', methodArn: methodArn('GET', 'products') })
    expect(__lastCreateConfig()).toMatchObject({ tokenUse: 'access' })
  })

  // contract: S7 — least-privilege execution role, no baked-in account (blast-radius)
  it('S7: the execution role grants only logging — no sts:AssumeRole on role/*, no baked-in account literal', () => {
    const assertLeastPrivilege = (t: Template): void => {
      const role = firstResource(t, 'AWS::IAM::Role').Properties as { Policies?: unknown[] }
      const policiesJson = JSON.stringify(role.Policies ?? [])
      // grants only logs
      expect(policiesJson).toContain('logs:CreateLogGroup')
      // NO broad cross-account assume-role, NO baked Apiable/tenant account
      expect(policiesJson).not.toContain('sts:AssumeRole')
      expect(JSON.stringify(t.toJSON())).not.toContain(HARDCODED_APIABLE_ACCOUNT)
      expect(policiesJson).not.toMatch(/role\/\*/)
    }
    assertLeastPrivilege(concreteTemplate())
    assertLeastPrivilege(publishedTemplate())

    // Terraform channel: the role's only grant is the logs policy; no baked account anywhere
    const main = tfModule('main.tf')
    expect(main).toContain('logs:CreateLogGroup')
    expect(main).not.toContain(HARDCODED_APIABLE_ACCOUNT)
    expect(main).not.toMatch(/role\/\*/)
    // sts:AssumeRole appears as an Action exactly once — the lambda service TRUST policy
    // (assume_role_policy), never a granted permission. The granted (inline) policy is logs-only.
    expect(main.match(/Action\s*=\s*"sts:AssumeRole"/g) ?? []).toHaveLength(1)
    expect(main).toMatch(/assume_role_policy[\s\S]*Principal\s*=\s*\{\s*Service\s*=\s*"lambda\.amazonaws\.com"\s*\}[\s\S]*sts:AssumeRole/)
    // the inline grant policy (aws_iam_role_policy) contains no assume-role
    const grantPolicy = /resource\s+"aws_iam_role_policy"[\s\S]*?\n\}/.exec(main)?.[0] ?? ''
    expect(grantPolicy).toContain('logs:CreateLogGroup')
    expect(grantPolicy).not.toContain('sts:AssumeRole')
  })

  // declared-identity parity floor (RULES IaC): the function + the role carry the channel-stable tag on every channel
  it('every channel declares the same apiable:logical-id on the authorizer function and its role', () => {
    const tagOf = (t: Template, type: string): string =>
      JSON.stringify((firstResource(t, type).Properties as { Tags?: unknown }).Tags ?? '')
    for (const t of [concreteTemplate(), publishedTemplate()]) {
      expect(tagOf(t, 'AWS::Lambda::Function')).toContain(AUTHORIZER_FUNCTION_LOGICAL_ID)
      expect(tagOf(t, 'AWS::IAM::Role')).toContain(AUTHORIZER_ROLE_LOGICAL_ID)
    }
    const main = tfModule('main.tf')
    expect(main).toContain(`"apiable:logical-id" = "${AUTHORIZER_FUNCTION_LOGICAL_ID}"`)
    expect(main).toContain(`"apiable:logical-id" = "${AUTHORIZER_ROLE_LOGICAL_ID}"`)
  })

  // in-spec per-channel cross-check (Task 5.4): the three channels carry the same load-bearing values.
  // The real-gate() cross-channel parity spec is deferred to 013-1-23.
  it('the three channels carry identical load-bearing values (authorizer type/source, env shape, logs-only role)', () => {
    // CDK + published CFN: TOKEN authorizer, Authorization identity source, the env userPoolId + map, no key
    for (const t of [concreteTemplate(), publishedTemplate()]) {
      const a = authorizerProps(t)
      expect(a.Type).toBe('TOKEN')
      expect(a.IdentitySource).toBe('method.request.header.Authorization')
      const env = lambdaEnv(t)
      expect(env).toHaveProperty('APIABLE_AWS_AUTHZ_USERPOOLID')
      expect(env).toHaveProperty('REQUIRED_SCOPE_MAP')
      expect(env).not.toHaveProperty('APIABLE_AWS_AUTHZ_CREDIT_SIGNING_KEY')
    }
    // Terraform: the same env keys + TOKEN authorizer + logs-only role
    const main = tfModule('main.tf')
    expect(main).toMatch(/APIABLE_AWS_AUTHZ_USERPOOLID\s*=\s*var\.user_pool_id/)
    expect(main).toMatch(/REQUIRED_SCOPE_MAP\s*=\s*jsonencode\(var\.required_scope_map\)/)
  })

  // the Terraform-channel lambda is byte-identical to the CDK lambda asset (no silent drift)
  it('the Terraform-channel lambda is byte-identical to the CDK lambda asset', () => {
    const cdkAsset = fs.readFileSync(ASSET)
    const tfCopy = fs.readFileSync(path.join(TF_MODULE_DIR, 'lambda/index.mjs'))
    expect(tfCopy).toEqual(cdkAsset)
  })

  // the Terraform channel actually PACKAGES the aws-jwt-verify runtime dependency the handler imports —
  // a managed nodejs20.x runtime carries only @aws-sdk/*, so a single-file zip cold-starts with
  // Runtime.ImportModuleError. The source-text byte-identical check above is blind to packaging, so this
  // is the load-bearing "deployable" guard.
  it('the Terraform channel vendors aws-jwt-verify and packages the whole lambda dir', () => {
    const cdkDep = path.join(CDK_ASSET_DIR, 'node_modules/aws-jwt-verify')
    const tfDep = path.join(TF_MODULE_DIR, 'lambda/node_modules/aws-jwt-verify')
    // the dependency is vendored alongside the handler (not left to a managed runtime)
    expect(fs.existsSync(path.join(tfDep, 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(tfDep, 'dist/esm/index.js'))).toBe(true)
    // the vendored version matches the CDK asset's, so the two channels cannot skew
    const cdkVersion = JSON.parse(fs.readFileSync(path.join(cdkDep, 'package.json'), 'utf8')).version
    const tfVersion = JSON.parse(fs.readFileSync(path.join(tfDep, 'package.json'), 'utf8')).version
    expect(tfVersion).toBe(cdkVersion)
    // the archive packages the whole lambda/ tree (handler + node_modules), never a single file
    const main = tfModule('main.tf')
    expect(main).toMatch(/source_dir\s*=\s*"\$\{path\.module\}\/lambda"/)
    expect(main).not.toMatch(/source_file\s*=/)
  })

  // route-key derivation (the map key the scope gate looks up) is account/region/apiId-agnostic
  it('routeKeyFromMethodArn derives "<METHOD> <resourcePath>" from the method ARN', () => {
    expect(routeKeyFromMethodArn(methodArn('GET', 'products'))).toBe('GET /products')
    expect(routeKeyFromMethodArn(methodArn('POST', 'orders/items'))).toBe('POST /orders/items')
    expect(() => routeKeyFromMethodArn('not-an-arn')).toThrow(/Unexpected method ARN/)
  })

  // the construct fails fast on missing required inputs (no blank authorizer)
  it('the construct requires name, restApiId, and a userPoolId source', () => {
    const stack = new cdk.Stack(new cdk.App(), 'S')
    expect(() => new LambdaAuthorizer(stack, 'A1', { name: TENANT, restApiId: '' })).toThrow(/restApiId/)
    expect(() => new LambdaAuthorizer(stack, 'A2', { name: TENANT, restApiId: REST_API_ID })).toThrow(/userPoolId/)
    expect(
      () => new LambdaAuthorizer(stack, 'A3', { name: 'Bad Name', restApiId: REST_API_ID, userPoolId: POOL_ID }),
    ).toThrow(/lowercase/)
  })

  // generateIAMPolicy always returns an Allow policy keyed to the resolved ARNs (the preserved core)
  it('generateIAMPolicy builds an Allow policy for the resolved service ARNs', () => {
    const policy = generateIAMPolicy('sub-1', 'GET/products', methodArn('GET', 'products'))
    expect(policy.principalId).toBe('sub-1')
    expect(policy.policyDocument.Statement[0].Effect).toBe('Allow')
    expect(policy.policyDocument.Statement[0].Action).toBe('execute-api:Invoke')
  })
})
