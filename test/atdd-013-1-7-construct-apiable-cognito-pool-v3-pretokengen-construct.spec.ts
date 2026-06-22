/**
 * Acceptance specs for the apiable-cognito-pool construct across all three channels.
 * Frozen contract: contract-013-1-7-construct-apiable-cognito-pool-v3-pretokengen.md
 *
 * One un-skipped spec per contract scenario (S1–S6); every one is provable without a live AWS account —
 * from the CDK synth, the published one-click synth, and the hand-rolled Terraform module source. The
 * load-bearing scalars (UserPoolTier, PreTokenGen LambdaVersion=V3_0) are asserted as literal values,
 * not a mere "a trigger exists" presence check, on every channel that carries them. Decision 1a: the
 * scope-fidelity pin is the granted OAuth scope set (the real 013-1-13 binding); apiable_plan_resources
 * ships empty/deferred. The live token shape was proven by the Phase A0 spike.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import {
  CognitoPool,
  CognitoPoolStack,
  CognitoPoolStackProps,
  buildPublishedStack,
  TENANT_NAME_PARAMETER,
  TIER_GUARD_ERROR,
  MAX_SCOPES_PER_CLIENT,
  RESOURCE_SERVER_IDENTIFIER,
  ADMIN_SCOPE_NAME,
  COGNITO_POOL_LOGICAL_ID,
  PRE_TOKEN_FUNCTION_LOGICAL_ID,
} from '@apiable/cdk-cognito-pool'

const REGION = 'eu-central-1'
const TENANT = 'staging'
const TENANT_ACCOUNT = '111111111111'
const STACK_ID = 'apiable-cognito-pool'
const EXPECTED_POOL_NAME = `apiable-${TENANT}`

const REPO_ROOT = path.resolve(__dirname, '..')
const TF_MODULE_DIR = path.join(REPO_ROOT, 'terraform/apiable-cognito-pool')

/** Standalone/umbrella synth: concrete tenant name + account, so back-compat compares the existing pool shape. */
const concreteTemplate = (overrides: CognitoPoolStackProps = {}): Template =>
  Template.fromStack(
    new CognitoPoolStack(new cdk.App(), STACK_ID, {
      name: TENANT,
      env: { account: TENANT_ACCOUNT, region: REGION },
      ...overrides,
    }),
  )

/** The published one-click synth: no env, so the account is AWS::AccountId and the name is a parameter. */
const publishedTemplate = (): Template => Template.fromStack(buildPublishedStack(new cdk.App()))

const tfModule = (name: string): string => fs.readFileSync(path.join(TF_MODULE_DIR, name), 'utf8')
const allTfSources = (): string =>
  fs
    .readdirSync(TF_MODULE_DIR)
    .filter((f) => f.endsWith('.tf'))
    .map(tfModule)
    .join('\n')

const firstResource = (t: Template, type: string): { [key: string]: unknown; Properties?: Record<string, unknown> } =>
  Object.values(t.findResources(type))[0] as { Properties?: Record<string, unknown> }

/** The pool's raw CloudFormation properties (the escape-hatch overrides land here). */
const poolProps = (t: Template): Record<string, unknown> =>
  (firstResource(t, 'AWS::Cognito::UserPool').Properties ?? {}) as Record<string, unknown>

/**
 * The synth emits a bound resource-server scope as `Fn::Join("", [{Ref: <resource-server>}, "/admin"])` —
 * a real CloudFormation reference to the declared resource server, not a baked literal string. This
 * extracts the static suffix ("/admin") and the referenced node, so a spec can assert the binding is
 * exactly that scope AND that it resolves from the real server (the proof it is not a placeholder).
 */
const boundScope = (scopes: unknown[]): { suffix: string; serverRef: string } => {
  expect(scopes).toHaveLength(1)
  const join = (scopes[0] as { 'Fn::Join'?: [string, unknown[]] })['Fn::Join']
  if (!join) throw new Error(`expected a Fn::Join-bound scope, got ${JSON.stringify(scopes[0])}`)
  const [, parts] = join
  const serverRef = (parts[0] as { Ref?: string }).Ref ?? ''
  return { suffix: String(parts[1]), serverRef }
}

describe('013-1-7 apiable-cognito-pool — synth + parity contract', () => {
  // contract: S1 — pool on the required feature tier with the newer-version customisation attached
  it('S1: provisions a pool with UserPoolTier=ESSENTIALS/PLUS and PreTokenGen LambdaVersion=V3_0 attached', () => {
    // ── CDK construct channel: the escape-hatch literals are present as load-bearing scalars ──────
    const cdkPool = poolProps(concreteTemplate())
    expect(cdkPool.UserPoolTier).toBe('ESSENTIALS')
    const lambdaConfig = cdkPool.LambdaConfig as { PreTokenGenerationConfig?: { LambdaVersion?: string } }
    expect(lambdaConfig?.PreTokenGenerationConfig?.LambdaVersion).toBe('V3_0')
    // the trigger points at a real function, and Cognito is permitted to invoke it
    concreteTemplate().resourceCountIs('AWS::Lambda::Function', 1)
    concreteTemplate().hasResourceProperties(
      'AWS::Lambda::Permission',
      Match.objectLike({ Action: 'lambda:InvokeFunction', Principal: 'cognito-idp.amazonaws.com' }),
    )

    // ── one-click (published CFN) channel: same load-bearing literals ─────────────────────────────
    const pubPool = poolProps(publishedTemplate())
    expect(pubPool.UserPoolTier).toBe('ESSENTIALS')
    expect((pubPool.LambdaConfig as { PreTokenGenerationConfig?: { LambdaVersion?: string } })?.PreTokenGenerationConfig?.LambdaVersion).toBe('V3_0')

    // ── Terraform channel: the hand-rolled module declares the identical literals ─────────────────
    const main = tfModule('main.tf')
    expect(main.match(/resource\s+"aws_cognito_user_pool"\s+"/g)).toHaveLength(1)
    expect(main).toMatch(/user_pool_tier\s*=\s*var\.feature_plan/)
    expect(tfModule('variables.tf')).toMatch(/default\s*=\s*"ESSENTIALS"/)
    expect(main).toMatch(/lambda_version\s*=\s*"V3_0"/)
  })

  // contract: S2 — token carries exactly the granted OAuth scopes + the customisation fires; per-resource claim empty/deferred
  it('S2: the app client is bound to exactly its granted OAuth scopes (real binding) AND the V3_0 customisation fires; apiable_plan_resources ships empty, never a placeholder map', () => {
    const cdkT = concreteTemplate()
    // the client_credentials app client carries a secret and is a client_credentials OAuth client
    cdkT.hasResourceProperties(
      'AWS::Cognito::UserPoolClient',
      Match.objectLike({
        GenerateSecret: true,
        AllowedOAuthFlows: ['client_credentials'],
        AllowedOAuthFlowsUserPoolClient: true,
      }),
    )
    // bound to exactly the apiable/admin scope (one scope, suffix /admin, resolved from the resource server)
    const s2Scope = boundScope(
      (firstResource(cdkT, 'AWS::Cognito::UserPoolClient').Properties as { AllowedOAuthScopes?: unknown[] }).AllowedOAuthScopes ?? [],
    )
    expect(s2Scope.suffix).toBe(`/${ADMIN_SCOPE_NAME}`)
    expect(s2Scope.serverRef).toContain('ResourceServer')

    // the V3_0 customisation fires (the trigger is wired at V3_0 — proven to enrich the access token in the spike)
    expect((poolProps(cdkT).LambdaConfig as { PreTokenGenerationConfig?: { LambdaVersion?: string } })?.PreTokenGenerationConfig?.LambdaVersion).toBe('V3_0')

    // apiable_plan_resources ships EMPTY (no machine-to-machine source) — never a fabricated placeholder map
    const fnEnv = (firstResource(cdkT, 'AWS::Lambda::Function').Properties?.Environment as {
      Variables?: Record<string, string>
    })?.Variables
    expect(fnEnv?.APIABLE_PLAN_RESOURCES).toBe('')
    // the lambda asset injects the V3_0 claim shape and does not fabricate a non-empty per-resource map
    const lambdaSrc = fs.readFileSync(
      path.join(REPO_ROOT, 'lib/assets/lambdas/cognito-pool-pretokengen/index.mjs'),
      'utf8',
    )
    expect(lambdaSrc).toContain('claimsAndScopeOverrideDetails')
    expect(lambdaSrc).toContain('accessTokenGeneration')
    expect(lambdaSrc).toContain('apiable_plan_resources: PLAN_RESOURCES')
    // it does NOT set the `scope` claim — Cognito issues that natively from the bound scopes
    expect(lambdaSrc).not.toMatch(/scope['"]?\s*:/)
  })

  // contract: S3 — FAIL-LOUD: a tenant without the required tier fails the deploy, never silently degrades to V1
  it('S3: deploying without the required feature tier fails with the verbatim "requires Cognito Essentials or Plus" error — never a silent V1 fallback', () => {
    // LITE is a real, type-valid feature plan that simply cannot run V3_0 — the guard is the only thing
    // stopping a LITE deploy, so it throws the verbatim error at synth rather than silently degrading
    expect(() => new CognitoPool(new cdk.Stack(new cdk.App(), 'S'), 'P', { name: TENANT, featurePlan: 'LITE' })).toThrow(
      TIER_GUARD_ERROR,
    )
    expect(TIER_GUARD_ERROR).toBe('V3_0 PreTokenGen requires Cognito Essentials or Plus')

    // the construct never emits a V1_0 trigger as a fallback — the only version it attaches is V3_0
    const synth = JSON.stringify(concreteTemplate().toJSON())
    expect(synth).toContain('V3_0')
    expect(synth).not.toContain('V1_0')
    expect(synth).not.toContain('V2_0')

    // the Terraform channel fails the same way: feature_plan is validated to exactly ESSENTIALS/PLUS,
    // so LITE is not an accepted value (a LITE apply fails the variable validation)
    expect(tfModule('variables.tf')).toMatch(/contains\(\["ESSENTIALS",\s*"PLUS"\],\s*var\.feature_plan\)/)
    const tfAcceptedPlans = /contains\(\[([^\]]*)\]/.exec(tfModule('variables.tf'))?.[1] ?? ''
    expect(tfAcceptedPlans).not.toContain('LITE')
  })

  // contract: S4 — scope fidelity (security): the granted OAuth scope set reflects exactly the bound set, never more
  it('S4: the app client carries exactly its bound OAuth scope set — never a scope the client was not granted; the pool cannot widen the binding', () => {
    const cdkT = concreteTemplate()
    const client = firstResource(cdkT, 'AWS::Cognito::UserPoolClient').Properties as {
      AllowedOAuthScopes?: unknown[]
    }
    // exactly one bound scope — apiable/admin — and nothing wider
    const s4Scope = boundScope(client.AllowedOAuthScopes ?? [])
    expect(s4Scope.suffix).toBe(`/${ADMIN_SCOPE_NAME}`)

    // the synth carries no broader OAuth scope (no openid/email/phone/aws.cognito.signin.* — those are sign-in)
    const clientJson = JSON.stringify(client)
    expect(clientJson).not.toContain('openid')
    expect(clientJson).not.toContain('aws.cognito.signin.user.admin')

    // the resource server declares exactly the admin scope — the client cannot bind a scope the server never defined
    cdkT.hasResourceProperties(
      'AWS::Cognito::UserPoolResourceServer',
      Match.objectLike({
        Identifier: RESOURCE_SERVER_IDENTIFIER,
        Scopes: [Match.objectLike({ ScopeName: ADMIN_SCOPE_NAME })],
      }),
    )

    // the Terraform channel binds the identical single scope, never wider
    expect(tfModule('main.tf')).toMatch(/allowed_oauth_scopes\s*=\s*\["\$\{aws_cognito_resource_server\.apiable\.identifier\}\/admin"\]/)

    // scope sets stay well under the Cognito 50-per-client ceiling (one bound scope)
    expect((client.AllowedOAuthScopes ?? []).length).toBeLessThanOrEqual(MAX_SCOPES_PER_CLIENT)
    expect((client.AllowedOAuthScopes ?? []).length).toBe(1)
  })

  // contract: S5 — omitting optional inputs reproduces the existing pool shape (edge / back-compat)
  it('S5: with only required inputs, resource servers + scopes + client bindings equal the existing pool', () => {
    const t = concreteTemplate() // name + account supplied; featurePlan defaults to ESSENTIALS, publishComposition off

    // exactly one M2M pool, sign-in disabled — modelled on the existing AuthZ pool, not the sign-in pool
    t.resourceCountIs('AWS::Cognito::UserPool', 1)
    t.hasResourceProperties(
      'AWS::Cognito::UserPool',
      Match.objectLike({ UserPoolName: EXPECTED_POOL_NAME, MfaConfiguration: 'OFF' }),
    )
    expect(EXPECTED_POOL_NAME).toBe('apiable-staging')

    // exactly one resource server (apiable) + one client_credentials client, the existing shape
    t.resourceCountIs('AWS::Cognito::UserPoolResourceServer', 1)
    t.resourceCountIs('AWS::Cognito::UserPoolClient', 1)
    t.hasResourceProperties('AWS::Cognito::UserPoolResourceServer', Match.objectLike({ Identifier: RESOURCE_SERVER_IDENTIFIER }))

    // composition publishing is off by default → no SSM parameter resource is added
    t.resourceCountIs('AWS::SSM::Parameter', 0)

    // a hosted-UI domain is declared (the existing pool shape), scoped to the tenant
    t.resourceCountIs('AWS::Cognito::UserPoolDomain', 1)
    t.hasResourceProperties('AWS::Cognito::UserPoolDomain', Match.objectLike({ Domain: EXPECTED_POOL_NAME }))
  })

  // contract: S6 — the granted SCOPES come from the real binding; the per-resource claim is empty/deferred, never faked
  it('S6: the bound OAuth scopes come from the real binding (a resource-server scope, not a static placeholder), and the per-resource claim is explicitly empty/deferred — no fabricated entitlement', () => {
    const cdkT = concreteTemplate()
    // the bound scope resolves from the declared resource server via a real CloudFormation Ref (a real
    // ResourceServerScope reference), not a hardcoded placeholder string baked separately from the server
    const client = firstResource(cdkT, 'AWS::Cognito::UserPoolClient').Properties as { AllowedOAuthScopes?: unknown[] }
    const s6Scope = boundScope(client.AllowedOAuthScopes ?? [])
    expect(s6Scope.suffix).toBe(`/${ADMIN_SCOPE_NAME}`)
    // the bound scope references the resource-server node, so it cannot resolve before the server is defined
    expect(s6Scope.serverRef).toContain('ResourceServer')
    const resourceServerLogicalId = Object.keys(cdkT.findResources('AWS::Cognito::UserPoolResourceServer'))[0]
    expect(s6Scope.serverRef).toBe(resourceServerLogicalId)

    // the per-resource claim ships EMPTY and the construct fabricates no placeholder map (env is the empty string)
    const fnEnv = (firstResource(cdkT, 'AWS::Lambda::Function').Properties?.Environment as {
      Variables?: Record<string, string>
    })?.Variables
    expect(fnEnv?.APIABLE_PLAN_RESOURCES).toBe('')
    // no static placeholder resource map literal anywhere in the synthesized template
    const synth = JSON.stringify(cdkT.toJSON())
    expect(synth).not.toMatch(/apiable_plan_resources['"]?\s*:\s*['"][^'"]+['"]/)
  })

  // declared-identity parity floor (RULES IaC): the pool + the pre-token fn carry the channel-stable tag on every channel
  it('every channel declares the same apiable:logical-id on the pool and the pre-token function', () => {
    const expectTag = (t: Template, type: string, id: string): void => {
      const props = firstResource(t, type).Properties as { Tags?: unknown }
      expect(JSON.stringify(props.Tags ?? '')).toContain(id)
    }
    // CDK + one-click CFN channels
    for (const t of [concreteTemplate(), publishedTemplate()]) {
      // the pool tag lands in UserPoolTags; the function tag in Tags
      expect(JSON.stringify(poolProps(t).UserPoolTags ?? '')).toContain(COGNITO_POOL_LOGICAL_ID)
      expectTag(t, 'AWS::Lambda::Function', PRE_TOKEN_FUNCTION_LOGICAL_ID)
    }
    // Terraform channel declares the identical literals
    const main = tfModule('main.tf')
    expect(main).toContain(`"apiable:logical-id" = "${COGNITO_POOL_LOGICAL_ID}"`)
    expect(main).toContain(`"apiable:logical-id" = "${PRE_TOKEN_FUNCTION_LOGICAL_ID}"`)
  })

  // security (RULES): no secret baked into source; the pre-token lambda never logs the token/claims/secret
  it('no secret is baked into source and the pre-token lambda logs only identity + trigger, never claims', () => {
    const lambdaSrc = fs.readFileSync(
      path.join(REPO_ROOT, 'lib/assets/lambdas/cognito-pool-pretokengen/index.mjs'),
      'utf8',
    )
    // the anti-pattern from the V1 lambda (console.log(event) — dumps claims) is NOT copied
    expect(lambdaSrc).not.toMatch(/console\.log\(\s*event\s*\)/)
    // it logs identity + trigger only
    expect(lambdaSrc).toMatch(/console\.log\(`pretokengen v3: client=/)
    // no baked secret literal (the authz.ts replace-me anti-pattern is not copied)
    expect(lambdaSrc).not.toContain('replace-me-with-your-key')
    const constructSrc = fs.readFileSync(path.join(REPO_ROOT, 'lib/cognito-pool/cognito-pool.ts'), 'utf8')
    expect(constructSrc).not.toContain('replace-me-with-your-key')
  })
})
