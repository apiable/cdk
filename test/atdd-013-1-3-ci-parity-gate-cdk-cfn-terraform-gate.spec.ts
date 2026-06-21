/**
 * Acceptance specs for the release-time CDK ↔ CFN ↔ Terraform parity gate (static tiers).
 * Frozen contract: contract-013-1-3-ci-parity-gate-cdk-cfn-terraform.md
 *
 * One un-skipped spec per static contract scenario (S1–S8, S10, S11) — those provable with no cloud
 * account. The live half (S9) deploys each channel into the isolated apiable-logging account and
 * lives in the sibling `*.deploy.live.spec.ts`, excluded from the default `npm test` / CI gate by
 * the `.live.spec.ts` name (see jest.config.js).
 *
 * Parity is proven against the real artifacts: the CDK channel is the live construct synth, the
 * CFN channel is the published launch-stack template, and the Terraform channel is a committed
 * `terraform show -json` fixture (the engine has no binary in this environment — the workflow
 * runs the real `terraform plan`/`show` via setup-terraform and feeds the same reducer). The
 * token-customisation / pool-tier / authorizer / OAuth rows the role pilot does not exercise are
 * driven through the same reducers + gate with cognito-shaped inputs, so the gate is proven able
 * to compare the components that bite for the identity-pool and authorizer constructs.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { buildPublishedStack } from '@apiable/cdk-gateway-role'
import {
  ChannelModel,
  Channel,
  OAuthConfig,
  checkOAuthConformance,
  compareGraph,
  formatGateReport,
  gate,
  reduceCloudFormation,
  reduceTerraformShowJson,
} from '@apiable/parity-gate'

const REPO_ROOT = path.resolve(__dirname, '..')
const PUBLISHED_CFN = path.join(REPO_ROOT, 'dist/launchstack/apiable-gateway-role/1.0.0/template.yaml')
const TF_FIXTURE = path.join(REPO_ROOT, 'test/fixtures/parity-gate/terraform-gateway-role-show.json')
const TF_REGION = 'eu-central-1'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

// ── The three real pilot channels reduced through the gate's own reducers ─────────────────────
const cdkModel = (): ChannelModel =>
  reduceCloudFormation(Template.fromStack(buildPublishedStack(new cdk.App())).toJSON(), 'cdk')

const cfnModel = (): ChannelModel =>
  reduceCloudFormation(yaml.load(fs.readFileSync(PUBLISHED_CFN, 'utf8')), 'cfn')

const tfPlan = (): unknown => JSON.parse(fs.readFileSync(TF_FIXTURE, 'utf8'))
const tfModel = (plan: unknown = tfPlan()): ChannelModel => reduceTerraformShowJson(plan, 'terraform', TF_REGION)

const pilotModels = (): ChannelModel[] => [cdkModel(), cfnModel(), tfModel()]

// ── Cognito-shaped inputs for the rows the role pilot does not carry (version / tier / oauth) ──
const cfnCognitoPool = (lambdaVersion: string): unknown => ({
  Resources: {
    AuthzPool: {
      Type: 'AWS::Cognito::UserPool',
      Properties: {
        UserPoolName: 'authz',
        UserPoolTier: 'ESSENTIALS',
        UserPoolTags: { 'apiable:logical-id': 'authz-pool' },
        LambdaConfig: { PreTokenGenerationConfig: { LambdaVersion: lambdaVersion, LambdaArn: { 'Fn::GetAtt': ['PreTokenFn', 'Arn'] } } },
      },
    },
    PreTokenFn: { Type: 'AWS::Lambda::Function', Properties: { FunctionName: 'pretokengen', Runtime: 'nodejs20.x' } },
  },
})

const tfCognitoPoolLegacy = (): unknown => ({
  planned_values: {
    root_module: {
      resources: [
        {
          address: 'aws_cognito_user_pool.authz',
          type: 'aws_cognito_user_pool',
          values: {
            name: 'authz',
            tags: { 'apiable:logical-id': 'authz-pool' },
            lambda_config: [{ pre_token_generation: 'arn:aws:lambda:eu-central-1:034444869755:function:pretokengen' }],
          },
        },
        { address: 'aws_lambda_function.pretokengen', type: 'aws_lambda_function', values: { function_name: 'pretokengen', runtime: 'nodejs20.x' } },
      ],
    },
  },
  // The pool references the in-stack function (the same edge the CDK/CFN channels build via GetAtt),
  // so all three attach the customisation function and only the legacy VERSION value diverges.
  configuration: {
    root_module: {
      resources: [
        {
          address: 'aws_cognito_user_pool.authz',
          type: 'aws_cognito_user_pool',
          expressions: { lambda_config: [{ pre_token_generation: { references: ['aws_lambda_function.pretokengen.arn', 'aws_lambda_function.pretokengen'] } }] },
        },
      ],
      outputs: {},
    },
  },
})

// ── A lambda carrying a wired secret, for the secret-handling boundary ────────────────────────
const cfnLambdaWithSecret = (signingKey: string): unknown => ({
  Resources: {
    AuthzFn: {
      Type: 'AWS::Lambda::Function',
      Properties: {
        FunctionName: 'authz',
        Environment: { Variables: { APIABLE_AWS_AUTHZ_CREDIT_SIGNING_KEY: signingKey } },
      },
    },
  },
})

// ── A minimal channel model carrying only an emitted OAuth config, for the conformance check ──
const oauthModel = (channel: Channel, oauth: OAuthConfig): ChannelModel => ({
  channel,
  wellFormed: true,
  graph: { nodes: [], edges: [] },
  values: {},
  grants: [],
  secrets: [],
  oauth,
  cosmetics: {},
})

const conformantOAuth: OAuthConfig = {
  flows: ['client_credentials'],
  scopes: ['apiable/admin'],
  discovery: {
    issuer: 'https://authz.auth.eu-central-1.amazoncognito.com',
    authorizationEndpoint: 'https://authz.auth.eu-central-1.amazoncognito.com/oauth2/authorize',
    tokenEndpoint: 'https://authz.auth.eu-central-1.amazoncognito.com/oauth2/token',
    jwksUri: 'https://authz.auth.eu-central-1.amazoncognito.com/.well-known/jwks.json',
    bearerMethod: 'header',
  },
}

describe('parity gate — static three-tier diff contract', () => {
  // contract: S1 — all three agree on every tier → pass, release proceeds
  it('S1: identical graph + load-bearing values + grants across channels → gate passes', () => {
    const result = gate(pilotModels())
    expect(result.passed).toBe(true)
    expect(result.divergences).toEqual([])
    expect(result.warnings).toEqual([])
  })

  // contract: S2 — validates well-formedness + reduces all three to one comparable model; malformed fails pre-diff
  it('S2: each artifact reduces to a well-formed comparable model; a malformed artifact fails before any comparison', () => {
    for (const model of pilotModels()) {
      expect(model.wellFormed).toBe(true)
      expect(model.graph.nodes.length).toBeGreaterThan(0)
    }
    expect(reduceCloudFormation({}, 'cfn').wellFormed).toBe(false)
    expect(reduceTerraformShowJson({}, 'terraform').wellFormed).toBe(false)

    const withMalformedCfn = [cdkModel(), reduceCloudFormation('not a template', 'cfn'), tfModel()]
    const result = gate(withMalformedCfn)
    expect(result.passed).toBe(false)
    expect(result.divergences.every((divergence) => divergence.tier === 'wellformed')).toBe(true)
    expect(result.divergences.flatMap((divergence) => divergence.channels)).toContain('cfn')
  })

  // contract: S3 — tier (i): a resource-graph divergence is detected + named
  it('S3: a missing resource/connection in one channel → fail, report names the resource + channel', () => {
    const plan = clone(tfPlan()) as { planned_values: { root_module: { resources: unknown[] } } }
    plan.planned_values.root_module.resources = plan.planned_values.root_module.resources.filter(
      (resource) => (resource as { type: string }).type !== 'aws_iam_role_policy',
    )
    const result = gate([cdkModel(), cfnModel(), tfModel(plan)])
    expect(result.passed).toBe(false)
    const graphDivergence = result.divergences.find((divergence) => divergence.tier === 'graph' && divergence.detail.includes('iam-inline-policy'))
    expect(graphDivergence).toBeDefined()
    expect(graphDivergence?.channels).toEqual(['terraform'])
  })

  // contract: S4 — tier (ii) THE PLACEBO PIN: every channel attaches a customisation fn, but one is legacy-version-only
  it('S4: all three attach a token-customisation fn, yet one expresses only the legacy version → gate FAILS by value', () => {
    const models = [
      reduceCloudFormation(cfnCognitoPool('V3_0'), 'cdk'),
      reduceCloudFormation(cfnCognitoPool('V3_0'), 'cfn'),
      reduceTerraformShowJson(tfCognitoPoolLegacy(), 'terraform', TF_REGION),
    ]
    // A presence-only check ("is a customisation fn attached?") sees the same graph in all three.
    expect(compareGraph(models)).toEqual([])

    const result = gate(models)
    expect(result.passed).toBe(false)
    const versionDivergence = result.divergences.find(
      (divergence) => divergence.tier === 'value' && divergence.detail.includes('pretokengen-version'),
    )
    expect(versionDivergence).toBeDefined()
    expect(versionDivergence?.detail).toContain('V3_0')
    expect(versionDivergence?.detail).toContain('V1_0')
    expect(versionDivergence?.channels).toEqual(['terraform'])
  })

  // contract: S5 — tier (iii): a permission divergence a resource-count check would miss
  it('S5: same resource count but one channel grant scoped broader → fail, report names the over-broad grant + channel', () => {
    const plan = clone(tfPlan()) as {
      planned_values: { root_module: { resources: { type: string; values: { policy?: string } }[] } }
    }
    const policyResource = plan.planned_values.root_module.resources.find((resource) => resource.type === 'aws_iam_role_policy')
    const policyDoc = JSON.parse(policyResource?.values.policy ?? '{}') as { Statement: { Resource: string }[] }
    policyDoc.Statement[0].Resource = '*'
    if (policyResource) policyResource.values.policy = JSON.stringify(policyDoc)

    const models = [cdkModel(), cfnModel(), tfModel(plan)]
    // A resource-count check passes: the graph is unchanged, only the grant's scope widened.
    expect(compareGraph(models)).toEqual([])

    const result = gate(models)
    expect(result.passed).toBe(false)
    const grantDivergence = result.divergences.find((divergence) => divergence.tier === 'permission')
    expect(grantDivergence?.detail).toContain('grant:apigateway')
    expect(grantDivergence?.channels).toEqual(['terraform'])
  })

  // contract: S6 — cosmetic-only differences are warnings, not failures
  it('S6: a human-readable description differing only → warning, gate passes', () => {
    const plan = clone(tfPlan()) as {
      planned_values: { root_module: { resources: { type: string; values: { description?: string } }[] } }
    }
    const role = plan.planned_values.root_module.resources.find((resource) => resource.type === 'aws_iam_role')
    if (role) role.values.description = 'Lets Apiable administer the customer API gateway'

    const result = gate([cdkModel(), cfnModel(), tfModel(plan)])
    expect(result.passed).toBe(true)
    expect(result.divergences).toEqual([])
    expect(result.warnings.some((warning) => warning.includes('description'))).toBe(true)
  })

  // contract: S7 — secrets checked for wiring only, never by value
  it('S7: a differing secret VALUE never fails; an absent/unwired secret DOES fail', () => {
    const wiredA = reduceCloudFormation(cfnLambdaWithSecret('fixture-signing-key-one'), 'cdk')
    const wiredB = reduceCloudFormation(cfnLambdaWithSecret('fixture-signing-key-two'), 'cfn')
    const wiredC = reduceCloudFormation(cfnLambdaWithSecret('fixture-signing-key-three'), 'terraform')

    // The model carries no secret value, so a value difference is invisible to the gate.
    expect(Object.keys(wiredA.secrets[0]).sort()).toEqual(['ref', 'wired'])
    expect(gate([wiredA, wiredB, wiredC]).passed).toBe(true)

    const unwired = reduceCloudFormation(cfnLambdaWithSecret(''), 'terraform')
    const result = gate([wiredA, wiredB, unwired])
    expect(result.passed).toBe(false)
    const secretDivergence = result.divergences.find((divergence) => divergence.tier === 'secret')
    expect(secretDivergence?.channels).toEqual(['terraform'])
  })

  // contract: S8 — OAuth2/OIDC conformance validated identically across channels
  it('S8: emitted OAuth2 config checked vs RFC 6749 / 6750 / OIDC 1.0 statically, same check all three channels', () => {
    expect(checkOAuthConformance(conformantOAuth)).toEqual([])
    expect(checkOAuthConformance({ ...conformantOAuth, flows: ['magic_link'] }).map((issue) => issue.rule)).toContain('RFC6749')
    // The hosted-UI token endpoint is required when a client signs in interactively (authorization-code);
    // an interactive client whose discovery omits it is non-conformant.
    expect(
      checkOAuthConformance({ ...conformantOAuth, flows: ['code'], discovery: { ...conformantOAuth.discovery, tokenEndpoint: undefined } }).map(
        (issue) => issue.rule,
      ),
    ).toContain('OIDC1.0')
    expect(
      checkOAuthConformance({ ...conformantOAuth, discovery: { ...conformantOAuth.discovery, bearerMethod: 'query' } }).map(
        (issue) => issue.rule,
      ),
    ).toContain('RFC6750')

    const conformantAll = [oauthModel('cdk', conformantOAuth), oauthModel('cfn', conformantOAuth), oauthModel('terraform', conformantOAuth)]
    expect(gate(conformantAll).passed).toBe(true)

    const oneNonConformant = [
      oauthModel('cdk', conformantOAuth),
      oauthModel('cfn', conformantOAuth),
      oauthModel('terraform', { ...conformantOAuth, flows: ['client_credentials', 'magic_link'] }),
    ]
    const result = gate(oneNonConformant)
    expect(result.passed).toBe(false)
    const oauthDivergence = result.divergences.find((divergence) => divergence.tier === 'oauth')
    expect(oauthDivergence?.channels).toEqual(['terraform'])
  })

  // A pilot terraform plan with the incidental deploy account/region and the load-bearing trust
  // target set independently, so a test can vary one while holding the other.
  const tfChannel = (region: string, incidentalAccount: string, trustAccount: string, channel: Channel): ChannelModel => {
    const plan = clone(tfPlan()) as {
      planned_values: { root_module: { resources: { type: string; values: Record<string, string> }[] } }
    }
    const resources = plan.planned_values.root_module.resources
    const role = resources.find((resource) => resource.type === 'aws_iam_role')
    const policy = resources.find((resource) => resource.type === 'aws_iam_role_policy')
    if (role !== undefined) {
      role.values.name = `apiable-gateway-managment-role-${region}`
      role.values.assume_role_policy = JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${trustAccount}:root` }, Action: 'sts:AssumeRole' }],
      })
    }
    if (policy !== undefined) {
      policy.values.policy = JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Action: 'apigateway:*', Resource: `arn:aws:apigateway:${region}:${incidentalAccount}:/*` }],
      })
    }
    return reduceTerraformShowJson(plan, channel, region)
  }

  // contract: S10 — INCIDENTAL deploy account/region identifiers differing alone do not false-diverge (trust target held identical)
  it('S10: models differing only in the incidental deploy account/region (trust target identical) → compared by logical ref → pass', () => {
    const result = gate([
      tfChannel('eu-central-1', '111111111111', '034444869755', 'cdk'),
      tfChannel('us-east-1', '222222222222', '034444869755', 'cfn'),
      tfChannel('ap-southeast-2', '333333333333', '034444869755', 'terraform'),
    ])
    expect(formatGateReport(result)).toContain('PARITY OK')
    expect(result.passed).toBe(true)
  })

  // contract: S11 — a divergent TRUST TARGET (who may assume the role) across channels is caught + named
  it('S11: one channel trusts a DIFFERENT account → trust target compared BY VALUE → gate FAILS naming the channel', () => {
    // Incidental deploy account/region are held identical across all three; only the trust target
    // diverges. A gate that normalised the trust account away would wrongly pass — the trust target
    // is load-bearing and compared by value, distinct from the incidental deploy account of S10.
    const result = gate([
      tfChannel('eu-central-1', '111111111111', '034444869755', 'cdk'),
      tfChannel('eu-central-1', '111111111111', '034444869755', 'cfn'),
      tfChannel('eu-central-1', '111111111111', '999988887777', 'terraform'),
    ])
    expect(result.passed).toBe(false)
    const trustDivergence = result.divergences.find(
      (divergence) => divergence.tier === 'value' && divergence.detail.includes('role-trust-account'),
    )
    expect(trustDivergence).toBeDefined()
    expect(trustDivergence?.detail).toContain('034444869755')
    expect(trustDivergence?.detail).toContain('999988887777')
    expect(trustDivergence?.channels).toEqual(['terraform'])
    expect(formatGateReport(result)).toContain('PARITY FAILED')
  })
})
