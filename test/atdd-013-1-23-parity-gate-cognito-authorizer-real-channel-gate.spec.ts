/**
 * Acceptance specs — Story 013-1-23: wire the REAL cognito + authorizer channels through the release
 * parity gate. Frozen contract: contract-013-1-23-parity-gate-cognito-authorizer-real-channel.md
 *
 * One un-skipped spec per contract scenario (S1–S6), each driving the real reducers + gate against the
 * REAL apiable-cognito-pool (013-1-7) and apiable-lambda-authorizer (013-1-8) channels: the live CDK
 * synth, the published one-click CloudFormation template, and the committed `terraform show -json`
 * fixture — the 013-1-15 logs-bucket real-TF pattern (test/parity-gate-logs-bucket-real-tf.spec.ts) and
 * the 013-1-21 stream-capability shape. This is the capability slice (NOT a construct); it discharges
 * 013-1-20's NEW-1 (same-tenant hosted-domain equivalence — S3) and verifies NEW-2 (the lambda-function
 * enforcement flip — S4) on the real surface, and is the reachability point where the real multi-owner
 * grant surface (1-19) first routes through the shared gate (S5).
 *
 * The published templates are produced from their single-sourced version into the gitignored dist/ tree
 * by `synth-launchstack.sh` before this runs (in CI, the parity-gate workflow synthesises them; locally,
 * `npm run synth:launchstack:cognito-pool` / `:lambda-authorizer`). The committed `terraform show -json`
 * fixtures are ground-truthed against a fresh plan in CI by scripts/parity-tf-regen-check.ts.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { buildPublishedStack as buildCognitoStack } from '@apiable/cdk-cognito-pool'
import { buildPublishedStack as buildAuthorizerStack } from '@apiable/cdk-lambda-authorizer'
import { ChannelModel, gate, reduceCloudFormation, reduceTerraformShowJson, HOSTED_DOMAIN_TENANT_TOKEN } from '@apiable/parity-gate'
import { publishedTemplatePath } from './support/published-template'

const REPO_ROOT = path.resolve(__dirname, '..')
const TF_REGION = 'eu-central-1'
// The committed fixtures' deploying account (CI regenerates them credentialed); supplied so the incidental
// deploying account tokenises exactly as the published channel's AWS::AccountId pseudo-parameter.
const TF_DEPLOY_ACCOUNT = '111111111111'

const PUBLISHED_COGNITO = publishedTemplatePath('apiable-cognito-pool')
const PUBLISHED_AUTHORIZER = publishedTemplatePath('apiable-lambda-authorizer')
const TF_COGNITO = path.join(REPO_ROOT, 'test/fixtures/parity-gate/terraform-cognito-pool-show.json')
const TF_AUTHORIZER = path.join(REPO_ROOT, 'test/fixtures/parity-gate/terraform-lambda-authorizer-show.json')

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const loadJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, 'utf8'))

// ── The real cognito-pool channels ───────────────────────────────────────────────────────────────
const cognitoCdk = (): ChannelModel => reduceCloudFormation(Template.fromStack(buildCognitoStack(new cdk.App())).toJSON(), 'cdk', TF_REGION)
const cognitoCfn = (): ChannelModel => reduceCloudFormation(loadJson(PUBLISHED_COGNITO), 'cfn', TF_REGION)
const cognitoTfPlan = (): unknown => loadJson(TF_COGNITO)
const cognitoTf = (plan: unknown = cognitoTfPlan()): ChannelModel => reduceTerraformShowJson(plan, 'terraform', TF_REGION, TF_DEPLOY_ACCOUNT)

// ── The real authorizer channels ─────────────────────────────────────────────────────────────────
const authorizerCdk = (): ChannelModel => reduceCloudFormation(Template.fromStack(buildAuthorizerStack(new cdk.App())).toJSON(), 'cdk', TF_REGION)
const authorizerCfn = (): ChannelModel => reduceCloudFormation(loadJson(PUBLISHED_AUTHORIZER), 'cfn', TF_REGION)
const authorizerTfPlan = (): unknown => loadJson(TF_AUTHORIZER)
const authorizerTf = (plan: unknown = authorizerTfPlan()): ChannelModel => reduceTerraformShowJson(plan, 'terraform', TF_REGION, TF_DEPLOY_ACCOUNT)

interface TfShow {
  planned_values: { root_module: { resources: { address: string; type: string; values: Record<string, unknown> }[] } }
  configuration: { root_module: { resources: unknown[]; outputs: Record<string, unknown> } }
}

const plannedResource = (plan: TfShow, type: string): Record<string, unknown> => {
  const resource = plan.planned_values.root_module.resources.find((r) => r.type === type)
  if (resource === undefined) throw new Error(`fixture must carry a ${type} resource`)
  return resource.values
}

/** Merge the two real channels' TF show -json into one multi-owner plan (the real combined grant surface). */
const combinedTf = (cognitoPlan: TfShow, authorizerPlan: TfShow): unknown => ({
  // Carry the deploy inputs through, the way a real combined `terraform show -json` would: the hosted-UI
  // domain witness reconciles only against the concrete tenant input (var.name) the variables block carries.
  variables: { ...((cognitoPlan as unknown as { variables?: unknown }).variables ?? {}), ...((authorizerPlan as unknown as { variables?: unknown }).variables ?? {}) },
  planned_values: {
    root_module: { resources: [...cognitoPlan.planned_values.root_module.resources, ...authorizerPlan.planned_values.root_module.resources] },
  },
  configuration: {
    root_module: { resources: [...cognitoPlan.configuration.root_module.resources, ...authorizerPlan.configuration.root_module.resources], outputs: {} },
  },
})

/** Merge two CloudFormation templates' resources into one combined stack. */
const combinedCfn = (a: { Resources: Record<string, unknown> }, b: { Resources: Record<string, unknown> }): unknown => ({
  Resources: { ...a.Resources, ...b.Resources },
  Outputs: {},
})

// ── F3: the poolable trust-grant pair (the two roles' sts:AssumeRole trusts) ────────────────────
// Both the pool's pre-token role and the authorizer's execution role trust the same service principal
// (lambda.amazonaws.com) with the same action — the genuinely-poolable shape. A load-bearing trust
// condition planted on each (and swapped on one channel) is the trust analog of the 1-19 inline/invoke
// pooling forcing fixtures: pooled, the two conditions net out; only the per-owner ref tells them apart.
interface CfnRoleResource {
  readonly Type?: string
  readonly Properties?: {
    readonly Tags?: { readonly Key: string; readonly Value: unknown }[]
    readonly AssumeRolePolicyDocument?: { readonly Statement: Record<string, unknown>[] }
  }
}

const declaredIdOfCfnRole = (resource: CfnRoleResource): unknown =>
  (resource.Properties?.Tags ?? []).find((tag) => tag.Key === 'apiable:logical-id')?.Value

/** Plant a load-bearing trust `Condition` on the role carrying `declaredId` in a CloudFormation template. */
const withCfnTrustCondition = (template: { Resources: Record<string, unknown> }, declaredId: string, condition: unknown): { Resources: Record<string, unknown> } => {
  const next = clone(template)
  for (const resource of Object.values(next.Resources) as CfnRoleResource[]) {
    if (resource.Type === 'AWS::IAM::Role' && declaredIdOfCfnRole(resource) === declaredId) {
      const statement = resource.Properties?.AssumeRolePolicyDocument?.Statement?.[0]
      if (statement !== undefined) statement.Condition = condition
    }
  }
  return next
}

/** Plant a load-bearing trust `Condition` on the role carrying `declaredId` in a terraform show -json plan. */
const withTfTrustCondition = (plan: TfShow, declaredId: string, condition: unknown): TfShow => {
  const next = clone(plan)
  for (const resource of next.planned_values.root_module.resources as { type: string; values: Record<string, unknown> }[]) {
    if (resource.type === 'aws_iam_role' && (resource.values.tags as Record<string, unknown> | undefined)?.['apiable:logical-id'] === declaredId) {
      const document = JSON.parse(resource.values.assume_role_policy as string) as { Statement: Record<string, unknown>[] }
      document.Statement[0].Condition = condition
      resource.values.assume_role_policy = JSON.stringify(document)
    }
  }
  return next
}

/** A copy of a reduced channel with each role's trust grant re-pooled — the per-owner `:<role-ref>` suffix
 * stripped back to the bare `grant:assume-role`, so two roles' trusts share one multiset. This isolates the
 * per-owner discipline: in the re-pooled multiset a cross-owner trust swap nets out, so a gate that still
 * fails the swap must be failing it on the per-owner keying. */
const trustGrantsRepooled = (model: ChannelModel): ChannelModel => ({
  ...model,
  grants: model.grants.map((grant) => (grant.ref.startsWith('grant:assume-role:') ? { ...grant, ref: 'grant:assume-role' } : grant)),
})

describe('013-1-23 release parity check — real cognito + authorizer channels', () => {
  // contract: S1 — the real identity pool reconciles across all 3 channels; a divergent pool value is caught
  it('S1: the real apiable-cognito-pool (CDK synth + published CFN + terraform show -json) gate()-compared → passed:true; a TF-only drift in the feature tier / customisation version / resource-server identifier-or-scope-set → FAILS naming terraform (by value, not regex)', () => {
    const baseline = gate([cognitoCdk(), cognitoCfn(), cognitoTf()])
    expect(baseline.divergences).toEqual([])
    expect(baseline.passed).toBe(true)

    // a TF-only drift in the feature tier (ESSENTIALS → LITE) → caught by value, naming terraform
    const driftedTier = clone(cognitoTfPlan()) as TfShow
    plannedResource(driftedTier, 'aws_cognito_user_pool').user_pool_tier = 'LITE'
    const tierResult = gate([cognitoCdk(), cognitoCfn(), cognitoTf(driftedTier)])
    expect(tierResult.passed).toBe(false)
    const tierDivergence = tierResult.divergences.find((entry) => entry.tier === 'value' && entry.detail.includes('user-pool-tier'))
    expect(tierDivergence?.channels).toEqual(['terraform'])

    // a TF-only drift in the token-customisation version (V3_0 → V1_0) → caught by value
    const driftedVersion = clone(cognitoTfPlan()) as TfShow
    const lambdaConfig = (plannedResource(driftedVersion, 'aws_cognito_user_pool').lambda_config as Record<string, unknown>[])[0]
    ;(lambdaConfig.pre_token_generation_config as Record<string, unknown>[])[0].lambda_version = 'V1_0'
    const versionResult = gate([cognitoCdk(), cognitoCfn(), cognitoTf(driftedVersion)])
    expect(versionResult.passed).toBe(false)
    expect(versionResult.divergences.find((entry) => entry.tier === 'value' && entry.detail.includes('pretokengen-version'))?.channels).toEqual(['terraform'])

    // a TF-only drift in the resource-server scope set (admin → a widened scope) → caught by value
    const driftedScope = clone(cognitoTfPlan()) as TfShow
    ;(plannedResource(driftedScope, 'aws_cognito_resource_server').scope as Record<string, unknown>[])[0].scope_name = 'superadmin'
    const scopeResult = gate([cognitoCdk(), cognitoCfn(), cognitoTf(driftedScope)])
    expect(scopeResult.passed).toBe(false)
    expect(scopeResult.divergences.find((entry) => entry.detail.includes('resource-server-scopes'))?.channels).toEqual(['terraform'])
  })

  // contract: S2 — the real gateway authorizer reconciles across all 3 channels; a divergent authorizer value is caught
  it('S2: the real apiable-lambda-authorizer across all 3 channels → passed:true; a drift in the authorizer type / identity source / execution-role permission set → FAILS by value naming the channel', () => {
    const baseline = gate([authorizerCdk(), authorizerCfn(), authorizerTf()])
    expect(baseline.divergences).toEqual([])
    expect(baseline.passed).toBe(true)

    // a TF-only drift in the authorizer type (TOKEN → REQUEST) → caught by value naming terraform
    const driftedType = clone(authorizerTfPlan()) as TfShow
    plannedResource(driftedType, 'aws_api_gateway_authorizer').type = 'REQUEST'
    const typeResult = gate([authorizerCdk(), authorizerCfn(), authorizerTf(driftedType)])
    expect(typeResult.passed).toBe(false)
    expect(typeResult.divergences.find((entry) => entry.tier === 'value' && entry.detail.includes('authorizer-type'))?.channels).toEqual(['terraform'])

    // a TF-only drift in the identity source (Authorization header → a query string) → caught by value
    const driftedSource = clone(authorizerTfPlan()) as TfShow
    plannedResource(driftedSource, 'aws_api_gateway_authorizer').identity_source = 'method.request.querystring.access_token'
    const sourceResult = gate([authorizerCdk(), authorizerCfn(), authorizerTf(driftedSource)])
    expect(sourceResult.passed).toBe(false)
    expect(sourceResult.divergences.find((entry) => entry.tier === 'value' && entry.detail.includes('authorizer-identity-source'))?.channels).toEqual(['terraform'])

    // a TF-only widening of the execution role's permission set (logs-only → +sts:AssumeRole role/*) → caught
    const driftedGrant = clone(authorizerTfPlan()) as TfShow
    const logsPolicy = plannedResource(driftedGrant, 'aws_iam_role_policy')
    const document = JSON.parse(logsPolicy.policy as string) as { Statement: { Action: string[]; Resource: string }[] }
    document.Statement.push({ Action: ['sts:AssumeRole'], Resource: 'arn:aws:iam::*:role/*' })
    logsPolicy.policy = JSON.stringify(document)
    const grantResult = gate([authorizerCdk(), authorizerCfn(), authorizerTf(driftedGrant)])
    expect(grantResult.passed).toBe(false)
    expect(grantResult.divergences.find((entry) => entry.tier === 'permission')?.channels).toEqual(['terraform'])
  })

  // contract: S3 — same-tenant hosted domain reconciles, but a substituted token-minting host is still caught (NEW-1 floor)
  it('S3: the SAME tenant hosted sign-in domain rendered through the CFN/TF templating → reconciles (no false-FAIL); a DIFFERENT token-minting host → still FAILS on both discovery endpoints (the 1-20 security floor preserved, never widened into accepting a substituted host)', () => {
    // The same tenant's domain rendered differently per channel (published CFN `apiable-@ref:TenantName`,
    // Terraform `apiable-staging` bound to var.name) canonicalises to the shared tenant-domain token, so the
    // authorize/token discovery endpoints reconcile on equivalent infrastructure.
    const reconciled = gate([cognitoCdk(), cognitoCfn(), cognitoTf()])
    expect(reconciled.divergences.find((entry) => entry.detail.includes('oauth-discovery'))).toBeUndefined()
    const poolRef = 'cognito-user-pool:apiable-cognito-pool'
    expect(cognitoTf().values[`oauth-discovery-authorize:${poolRef}`]).toContain(HOSTED_DOMAIN_TENANT_TOKEN)
    expect(cognitoCfn().values[`oauth-discovery-authorize:${poolRef}`]).toContain(HOSTED_DOMAIN_TENANT_TOKEN)

    // a substituted token-minting host on the Terraform leg (a domain NOT bound to the tenant input) keeps
    // its identity and still FAILS on BOTH the authorize and token discovery endpoints — the security floor.
    const evilHost = clone(cognitoTfPlan()) as TfShow
    plannedResource(evilHost, 'aws_cognito_user_pool_domain').domain = 'evil-portal'
    const evilConfigDomain = (evilHost.configuration.root_module.resources as { type: string; expressions?: Record<string, unknown> }[]).find(
      (r) => r.type === 'aws_cognito_user_pool_domain',
    )
    // drop the var.name binding so the divergent host is a bare literal, the way a substituted host would be
    if (evilConfigDomain?.expressions !== undefined) evilConfigDomain.expressions.domain = { references: [] }
    const evilResult = gate([cognitoCdk(), cognitoCfn(), cognitoTf(evilHost)])
    expect(evilResult.passed).toBe(false)
    expect(evilResult.divergences.find((entry) => entry.tier === 'value' && entry.detail.includes('oauth-discovery-authorize'))?.channels).toEqual(['terraform'])
    expect(evilResult.divergences.find((entry) => entry.tier === 'value' && entry.detail.includes('oauth-discovery-token'))?.channels).toEqual(['terraform'])
  })

  // contract: S3 — the injected-literal token-minting host is caught even while bound to the tenant input
  // (the deceptive `apiable-evil-${var.name}` variant — the same security floor, pinned by the gate not a reviewer)
  it('S3: an INJECTED-LITERAL token-minting host on the Terraform leg (domain `apiable-evil-${var.name}`, still bound to var.name) does NOT reconcile to the tenant token and still FAILS on both discovery endpoints — even when the cosmetic pool name is rewritten to match; the legitimate `apiable-${var.name}` reconciles with no false-FAIL', () => {
    const poolRef = 'cognito-user-pool:apiable-cognito-pool'

    // (a) The deceptive plant: the domain renders `apiable-evil-${var.name}` → `apiable-evil-staging`, still
    // bound to the tenant input (references var.name). It must NOT collapse to the legit tenant token — it
    // keeps its identity and diverges on BOTH discovery endpoints against the legit CDK/CFN channels.
    const injected = clone(cognitoTfPlan()) as TfShow
    plannedResource(injected, 'aws_cognito_user_pool_domain').domain = 'apiable-evil-staging'
    const injectedResult = gate([cognitoCdk(), cognitoCfn(), cognitoTf(injected)])
    expect(injectedResult.passed).toBe(false)
    expect(injectedResult.divergences.find((entry) => entry.tier === 'value' && entry.detail.includes('oauth-discovery-authorize'))?.channels).toEqual(['terraform'])
    expect(injectedResult.divergences.find((entry) => entry.tier === 'value' && entry.detail.includes('oauth-discovery-token'))?.channels).toEqual(['terraform'])

    // (b) The legitimate conventional rendering `apiable-${var.name}` → `apiable-staging` reconciles to the
    // shared tenant token: no discovery divergence (no false-FAIL on equivalent infrastructure).
    const legit = gate([cognitoCdk(), cognitoCfn(), cognitoTf()])
    expect(legit.divergences.find((entry) => entry.detail.includes('oauth-discovery'))).toBeUndefined()
    expect(cognitoTf().values[`oauth-discovery-authorize:${poolRef}`]).toContain(HOSTED_DOMAIN_TENANT_TOKEN)

    // (c) Defeat-proof: the same injected-literal plant with the cosmetic pool `name` ALSO rewritten to
    // `apiable-evil-staging` STILL fails — the witness is anchored on the deploy-time tenant input, never the
    // attacker-controllable pool name, so rewriting the name to match does not buy the substituted host parity.
    const injectedAndNamed = clone(cognitoTfPlan()) as TfShow
    plannedResource(injectedAndNamed, 'aws_cognito_user_pool_domain').domain = 'apiable-evil-staging'
    plannedResource(injectedAndNamed, 'aws_cognito_user_pool').name = 'apiable-evil-staging'
    const defeatResult = gate([cognitoCdk(), cognitoCfn(), cognitoTf(injectedAndNamed)])
    expect(defeatResult.passed).toBe(false)
    expect(defeatResult.divergences.find((entry) => entry.tier === 'value' && entry.detail.includes('oauth-discovery-authorize'))?.channels).toEqual(['terraform'])
    expect(defeatResult.divergences.find((entry) => entry.tier === 'value' && entry.detail.includes('oauth-discovery-token'))?.channels).toEqual(['terraform'])
  })

  // contract: S4 — a tag-less function is an explicit missing-identity divergence, not a silent name fallback (NEW-2)
  it('S4: the customisation/authorizer function carrying its declared identity in one channel but tag-less in another → explicit missingDeclaredId divergence (NOT a fallback to its name-derived discriminator, now lambda-function is ENFORCED); both tagged → one node ref', () => {
    // The pre-token customisation function tag-less on the Terraform leg → an explicit missing-declared-identity
    // graph divergence (lambda-function is enforced), NOT a silent fall-back to its tenant-scoped name.
    const taglessCognito = clone(cognitoTfPlan()) as TfShow
    const fn = plannedResource(taglessCognito, 'aws_lambda_function')
    delete fn.tags
    delete fn.tags_all
    const taglessResult = gate([cognitoCdk(), cognitoCfn(), cognitoTf(taglessCognito)])
    expect(taglessResult.passed).toBe(false)
    const missingIdDivergence = taglessResult.divergences.find(
      (entry) => entry.tier === 'graph' && entry.detail.includes('no-declared-logical-id') && entry.detail.includes('lambda-function'),
    )
    expect(missingIdDivergence).toBeDefined()
    expect(missingIdDivergence?.channels).toEqual(['terraform'])

    // The same for the authorizer function: tag-less on Terraform → explicit missing-identity divergence.
    const taglessAuthorizer = clone(authorizerTfPlan()) as TfShow
    const authFn = plannedResource(taglessAuthorizer, 'aws_lambda_function')
    delete authFn.tags
    delete authFn.tags_all
    const taglessAuthResult = gate([authorizerCdk(), authorizerCfn(), authorizerTf(taglessAuthorizer)])
    expect(taglessAuthResult.passed).toBe(false)
    expect(taglessAuthResult.divergences.find((entry) => entry.tier === 'graph' && entry.detail.includes('no-declared-logical-id'))?.channels).toEqual(['terraform'])

    // Both channels carry the declared identity → the function reconciles to a single node ref (no divergence).
    const bothTagged = gate([cognitoCdk(), cognitoCfn(), cognitoTf()])
    expect(bothTagged.divergences.find((entry) => entry.detail.includes('lambda-function'))).toBeUndefined()
  })

  // contract: S5 — the real multi-owner grant surface is policed per owner; a cross-owner grant swap is caught (1-19 reachability)
  it('S5: routing the real multi-owner grant surface (pool roles + customisation invoke permission + authorizer role) through the gate, a cross-owner loosen-one/tighten-another-by-the-same-shape swap → FAILS per owner (no pooling); equivalent multi-owner artifacts → not false-failed', () => {
    const cdkModel = reduceCloudFormation(
      combinedCfn(
        Template.fromStack(buildCognitoStack(new cdk.App())).toJSON() as { Resources: Record<string, unknown> },
        Template.fromStack(buildAuthorizerStack(new cdk.App())).toJSON() as { Resources: Record<string, unknown> },
      ),
      'cdk',
      TF_REGION,
    )
    const cfnModel = reduceCloudFormation(
      combinedCfn(loadJson(PUBLISHED_COGNITO) as { Resources: Record<string, unknown> }, loadJson(PUBLISHED_AUTHORIZER) as { Resources: Record<string, unknown> }),
      'cfn',
      TF_REGION,
    )
    const combinedTfModel = (plan: unknown): ChannelModel => reduceTerraformShowJson(plan, 'terraform', TF_REGION, TF_DEPLOY_ACCOUNT)

    // The equivalent real multi-owner surface (the pool's pre-token invoke permission + the authorizer's
    // invoke permission, each scoped to its own source) reconciles across all three channels.
    const equivalent = gate([cdkModel, cfnModel, combinedTfModel(combinedTf(cognitoTfPlan() as TfShow, authorizerTfPlan() as TfShow))])
    expect(equivalent.divergences).toEqual([])
    expect(equivalent.passed).toBe(true)

    // A cross-owner swap: the Terraform leg swaps the two functions' invoke-permission source scopes (the
    // pre-token function now scoped to the authorizer's source and vice versa). Filing each grant under its
    // owning function's ref surfaces that EACH owner's invoke source changed — the per-owner discipline
    // (013-1-19) catches it rather than the pooled invoke multiset netting out.
    const swappedCognito = clone(cognitoTfPlan()) as TfShow
    const swappedAuthorizer = clone(authorizerTfPlan()) as TfShow
    const cognitoPermission = swappedCognito.planned_values.root_module.resources.find((r) => r.type === 'aws_lambda_permission')
    const authorizerPermission = swappedAuthorizer.planned_values.root_module.resources.find((r) => r.type === 'aws_lambda_permission')
    if (cognitoPermission === undefined || authorizerPermission === undefined) throw new Error('both fixtures must carry a lambda permission')
    const cognitoSource = cognitoPermission.values.source_arn
    cognitoPermission.values.source_arn = authorizerPermission.values.source_arn
    authorizerPermission.values.source_arn = cognitoSource
    const swapped = gate([cdkModel, cfnModel, combinedTfModel(combinedTf(swappedCognito, swappedAuthorizer))])
    expect(swapped.passed).toBe(false)
    const ownerDivergences = swapped.divergences.filter((entry) => entry.tier === 'permission' && entry.detail.includes('grant:invoke'))
    // both owners' invoke grants diverge, each named under its own function ref — the swap did not pool away
    expect(ownerDivergences.length).toBeGreaterThanOrEqual(2)
    expect(ownerDivergences.some((entry) => entry.detail.includes('apiable-cognito-pool-pretoken-fn'))).toBe(true)
    expect(ownerDivergences.some((entry) => entry.detail.includes('apiable-lambda-authorizer-fn'))).toBe(true)
    for (const divergence of ownerDivergences) expect(divergence.channels).toEqual(['terraform'])

    // ── The genuinely-poolable TRUST-grant pair (013-1-19's anti-pooling discipline on the real surface) ──
    // The two roles trust the SAME service principal with the SAME action, so their trust grants are the
    // genuinely-poolable pair. Plant a distinct load-bearing trust condition on each across ALL channels (the
    // intended, reconciling baseline), then swap them on the Terraform leg. Pooled into one grant:assume-role
    // multiset the two conditions net out; only filing each trust under its owning role's ref catches the swap.
    const POOL_ROLE = 'apiable-cognito-pool-pretoken-fn'
    const AUTHZ_ROLE = 'apiable-lambda-authorizer-role'
    const condPool = { StringEquals: { 'aws:SourceAccount': TF_DEPLOY_ACCOUNT } }
    const condAuthz = { StringEquals: { 'sts:ExternalId': 'authz-external-id' } }

    const cfnWith = (a: unknown, b: unknown): { Resources: Record<string, unknown> } =>
      withCfnTrustCondition(
        withCfnTrustCondition(
          combinedCfn(loadJson(PUBLISHED_COGNITO) as { Resources: Record<string, unknown> }, loadJson(PUBLISHED_AUTHORIZER) as { Resources: Record<string, unknown> }) as {
            Resources: Record<string, unknown>
          },
          POOL_ROLE,
          a,
        ),
        AUTHZ_ROLE,
        b,
      )
    const cdkWith = (a: unknown, b: unknown): { Resources: Record<string, unknown> } =>
      withCfnTrustCondition(
        withCfnTrustCondition(
          combinedCfn(
            Template.fromStack(buildCognitoStack(new cdk.App())).toJSON() as { Resources: Record<string, unknown> },
            Template.fromStack(buildAuthorizerStack(new cdk.App())).toJSON() as { Resources: Record<string, unknown> },
          ) as { Resources: Record<string, unknown> },
          POOL_ROLE,
          a,
        ),
        AUTHZ_ROLE,
        b,
      )
    const tfWith = (a: unknown, b: unknown): unknown =>
      combinedTf(
        withTfTrustCondition(cognitoTfPlan() as TfShow, POOL_ROLE, a),
        withTfTrustCondition(authorizerTfPlan() as TfShow, AUTHZ_ROLE, b),
      )

    // Baseline: each role keeps its own condition on every channel → trusts reconcile, no false-FAIL.
    const trustBaseline = gate([
      reduceCloudFormation(cdkWith(condPool, condAuthz), 'cdk', TF_REGION),
      reduceCloudFormation(cfnWith(condPool, condAuthz), 'cfn', TF_REGION),
      combinedTfModel(tfWith(condPool, condAuthz)),
    ])
    expect(trustBaseline.divergences.filter((entry) => entry.detail.includes('grant:assume-role'))).toEqual([])

    // The cross-owner trust swap on the Terraform leg: the pool role now carries the authorizer's condition
    // and vice versa. The intended CDK/CFN keep pool→condPool, authz→condAuthz.
    const swappedModels = [
      reduceCloudFormation(cdkWith(condPool, condAuthz), 'cdk', TF_REGION),
      reduceCloudFormation(cfnWith(condPool, condAuthz), 'cfn', TF_REGION),
      combinedTfModel(tfWith(condAuthz, condPool)),
    ]
    const trustSwapped = gate(swappedModels)
    expect(trustSwapped.passed).toBe(false)
    const trustDivergences = trustSwapped.divergences.filter((entry) => entry.tier === 'permission' && entry.detail.includes('grant:assume-role'))
    // Each owner's trust diverges, named under its own role's node ref — the swap did not pool away.
    expect(trustDivergences.some((entry) => entry.detail.includes(POOL_ROLE))).toBe(true)
    expect(trustDivergences.some((entry) => entry.detail.includes(AUTHZ_ROLE))).toBe(true)
    for (const divergence of trustDivergences) expect(divergence.channels).toEqual(['terraform'])

    // Proof the swap is caught BY the per-owner discipline (not a distinct-principal side-effect): re-pool the
    // trust grants (strip the per-owner :<role-ref> suffix to the pre-1-19 shared multiset) and the SAME swap
    // PASSES — the two conditions net out, exactly the fail-open the per-owner keying closes.
    const repooled = gate(swappedModels.map(trustGrantsRepooled))
    expect(repooled.divergences.filter((entry) => entry.detail.includes('grant:assume-role'))).toEqual([])
  })

  // contract: S6 — no regression; the construct-story per-channel checks agree with the release check
  it('S6: the existing parity + strangler suites stay green, and the release gate verdict is consistent with the 1-7/1-8 in-spec per-channel cross-checks on the same artifacts (no contradiction)', () => {
    // The release gate certifies the same real artifacts the construct stories' in-spec per-channel checks
    // assert on: the published one-click CFN and the hand-rolled Terraform module. A green release verdict
    // here means the gate agrees with those construct-level checks — no contradiction between the per-channel
    // checks (013-1-7 / 013-1-8) and the engine.
    expect(gate([cognitoCdk(), cognitoCfn(), cognitoTf()]).passed).toBe(true)
    expect(gate([authorizerCdk(), authorizerCfn(), authorizerTf()]).passed).toBe(true)

    // The construct stories assert the declared-id tag is present on every taggable primary of each channel;
    // the gate's reconciliation depends on exactly that, so re-assert it here on the real published templates
    // (consistency with the 013-1-7 / 013-1-8 in-spec per-channel cross-checks).
    const cognitoTemplate = loadJson(PUBLISHED_COGNITO) as { Resources: Record<string, { Type: string; Properties?: { Tags?: { Key: string; Value: unknown }[]; UserPoolTags?: Record<string, unknown> } }> }
    const pool = Object.values(cognitoTemplate.Resources).find((r) => r.Type === 'AWS::Cognito::UserPool')
    expect(pool?.Properties?.UserPoolTags?.['apiable:logical-id']).toBe('apiable-cognito-pool')
    const authorizerTemplate = loadJson(PUBLISHED_AUTHORIZER) as { Resources: Record<string, { Type: string; Properties?: { Tags?: { Key: string; Value: unknown }[] } }> }
    const authorizerFunction = Object.values(authorizerTemplate.Resources).find((r) => r.Type === 'AWS::Lambda::Function')
    const authorizerTag = (authorizerFunction?.Properties?.Tags ?? []).find((tag) => tag.Key === 'apiable:logical-id')
    expect(authorizerTag?.Value).toBe('apiable-lambda-authorizer-fn')
  })
})
