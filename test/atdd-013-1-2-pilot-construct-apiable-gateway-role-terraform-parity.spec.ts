/**
 * Acceptance specs for the gateway-management role via the Terraform channel (plan-level).
 * Frozen contract: contract-013-1-2-pilot-construct-apiable-gateway-role-terraform.md
 *
 * One un-skipped spec per contract scenario provable without a cloud account: S1, S2, S5, S6,
 * S7. The live apply/drift scenarios S3 + S4 need a real account and live in the sibling
 * `*.deploy.live.spec.ts`, excluded from this default run (mirrors 013-1-1's S4 hand-off).
 *
 * Parity is proven against the real artifacts of both channels: this reads the hand-rolled HCL
 * module source and cross-checks it against the live 013-1-1 CFN synth — no policy logic is
 * re-declared here, so the assertion tracks whatever the one-click channel actually emits.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import {
  GatewayRoleStack,
  TRUST_ACCOUNT_PARAMETER,
  DEFAULT_APIABLE_TRUST_ACCOUNT,
  ACCOUNT_ID_PATTERN_SOURCE,
} from '@apiable/cdk-gateway-role'

const REPO_ROOT = path.resolve(__dirname, '..')
const MODULE_DIR = path.join(REPO_ROOT, 'terraform/apiable-gateway-role')
const REGION = 'eu-central-1'

const moduleFile = (name: string): string => fs.readFileSync(path.join(MODULE_DIR, name), 'utf8')
const allModuleSources = (): string =>
  fs
    .readdirSync(MODULE_DIR)
    .filter((f) => f.endsWith('.tf'))
    .map(moduleFile)
    .join('\n')

/** Resolve a Terraform string interpolation of var.region to a concrete region for parity comparison. */
const withRegion = (s: string): string => s.split('${var.region}').join(REGION)

// ── The one-click (CFN) channel's real synth — the parity oracle ────────────────────────────
const cfnTemplate = (): Template =>
  Template.fromStack(new GatewayRoleStack(new cdk.App(), 'parity-cfn', { env: { region: REGION } }))

const cfnRoleName = (): string => {
  const roles = cfnTemplate().findResources('AWS::IAM::Role')
  return (Object.values(roles)[0] as { Properties: { RoleName: string } }).Properties.RoleName
}

const cfnApiGatewayStatement = (): { Action: string; Resource: string } => {
  const policies = cfnTemplate().findResources('AWS::IAM::Policy')
  for (const p of Object.values(policies) as { Properties: { PolicyDocument: { Statement: { Action: string; Resource: string }[] } } }[]) {
    const hit = p.Properties.PolicyDocument.Statement.find((s) => s.Action === 'apigateway:*')
    if (hit) return hit
  }
  throw new Error('no apigateway:* statement in the CFN synth')
}

const cfnDefaultAccount = (): string =>
  (cfnTemplate().toJSON().Parameters as Record<string, { Default: string }>)[TRUST_ACCOUNT_PARAMETER]
    .Default

// ── The Terraform channel's real module source ──────────────────────────────────────────────
const tfRoleName = (): string => {
  const m = moduleFile('main.tf').match(/resource\s+"aws_iam_role"[\s\S]*?name\s*=\s*"([^"]+)"/)
  if (!m) throw new Error('no aws_iam_role name in the Terraform module')
  return m[1]
}

const tfTrustValidationPattern = (): string => {
  const m = moduleFile('variables.tf').match(/regex\(\s*"([^"]+)"\s*,\s*var\.trust_account\s*\)/)
  if (!m) throw new Error('no trust_account validation regex in the Terraform module')
  return m[1]
}

const tfTrustValidationCondition = (): string => {
  const m = moduleFile('variables.tf').match(/condition\s*=\s*(.+)/)
  if (!m) throw new Error('no trust_account validation condition in the Terraform module')
  return m[1].trim()
}

const tfTrustAccountDefault = (): string => {
  const m = moduleFile('variables.tf').match(/variable\s+"trust_account"[\s\S]*?default\s*=\s*"([^"]+)"/)
  if (!m) throw new Error('no trust_account default in the Terraform module')
  return m[1]
}

describe('terraform gateway-management role — plan-parity contract', () => {
  // contract: S1 — the Terraform module yields the same role / single-account trust / apigateway perm as the 1-1 CFN artifact
  it('S1: defines one gateway-management role equal to the one-click channel (name, trust, permission)', () => {
    const main = moduleFile('main.tf')

    // exactly one role + one inline policy (the apigateway permission), and the role-ARN output
    expect(main.match(/resource\s+"aws_iam_role"\s+"/g)).toHaveLength(1)
    expect(main.match(/resource\s+"aws_iam_role_policy"\s+"/g)).toHaveLength(1)
    expect(moduleFile('outputs.tf')).toMatch(/output\s+"role_arn"[\s\S]*aws_iam_role\.this\.arn/)

    // same role identity (name) as the one-click channel
    expect(withRegion(tfRoleName())).toBe(cfnRoleName())

    // same single-account trust: one account-root principal bound to the trust variable, never a list or wildcard
    expect(main).toMatch(
      /Principal\s*=\s*\{\s*AWS\s*=\s*"arn:aws:iam::\$\{var\.trust_account\}:root"\s*\}/,
    )
    expect(main).toMatch(/Action\s*=\s*"sts:AssumeRole"/)

    // same API-gateway-management permission, scoped identically to the one-click channel
    const cfnStmt = cfnApiGatewayStatement()
    expect(main).toMatch(/Action\s*=\s*"apigateway:\*"/)
    const resource = main.match(/Resource\s*=\s*"(arn:aws:apigateway:[^"]+)"/)?.[1]
    expect(resource).toBeDefined()
    expect(withRegion(resource as string)).toBe(cfnStmt.Resource)

    // nothing broader: the only actions in the module are the trust + the apigateway permission
    const actions = [...main.matchAll(/Action\s*=\s*"([^"]+)"/g)].map((x) => x[1])
    expect(new Set(actions)).toEqual(new Set(['sts:AssumeRole', 'apigateway:*']))
  })

  // contract: S5 — a too-wide SUPPLIED trust value is refused by the module's own declared bound
  it('S5: a wildcard / multi-account / extra-principal trust_account is rejected, one account is accepted', () => {
    // the module must declare a validation bound, not rely on the caller
    expect(moduleFile('variables.tf')).toMatch(/validation\s*\{/)

    // feed bad input to the REAL bound extracted from the module source
    const bound = new RegExp(tfTrustValidationPattern())
    expect('*').not.toMatch(bound) // wildcard ("any account")
    expect('111111111111,222222222222').not.toMatch(bound) // comma-list
    expect('034444869755 222222222222').not.toMatch(bound) // extra principal
    expect('123').not.toMatch(bound) // too short
    expect('1234567890123').not.toMatch(bound) // too long
    expect('111122223333').toMatch(bound) // exactly one 12-digit account is accepted

    // the bound is identical to the one-click channel's frozen trust bound (parity with 013-1-1 AC5)
    expect(tfTrustValidationPattern()).toBe(ACCOUNT_ID_PATTERN_SOURCE)

    // polarity guard: the condition must be the POSITIVE `can(regex(...))` form, never a negated
    // `!can(regex(...))` that would accept "*" and fail OPEN. The pattern-string checks above run the
    // regex in JS but cannot see a polarity flip in the .tf (engine-level proof is deferred to 1-3).
    const condition = tfTrustValidationCondition()
    expect(condition).toMatch(/^can\(\s*regex\(/)
    expect(condition).not.toMatch(/^!/)
  })

  // contract: S6 — no account/region literal baked into the module (each is a variable)
  it('S6: module source contains no hardcoded account/region literal; the Apiable account appears only as the default', () => {
    const main = moduleFile('main.tf')

    // region is the supplied variable, never a fixed literal in a resource
    expect(main).toContain('${var.region}')
    expect(allModuleSources()).not.toContain(REGION)

    // the only 12-digit account literal in the whole module is the trust_account default
    const accountLiterals = allModuleSources().match(/(?<!\d)\d{12}(?!\d)/g) ?? []
    expect(accountLiterals).toEqual([DEFAULT_APIABLE_TRUST_ACCOUNT])
    expect(main).not.toMatch(/(?<!\d)\d{12}(?!\d)/) // never in a resource
    expect(tfTrustAccountDefault()).toBe(DEFAULT_APIABLE_TRUST_ACCOUNT)
  })

  // contract: S7 — omitting optional inputs reproduces the existing role exactly (back-compat)
  it('S7: with only the required region supplied, defaults reproduce the existing role', () => {
    // the optional trust target defaults to the same account the one-click channel defaults to
    expect(tfTrustAccountDefault()).toBe(cfnDefaultAccount())

    // region is the required input; trust_account is the optional one that defaults
    const regionVar = moduleFile('variables.tf').match(/variable\s+"region"\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(regionVar).not.toMatch(/default\s*=/)

    // with the default account, the planned role name + permission equal the existing role (parity proven in S1)
    expect(withRegion(tfRoleName())).toBe(cfnRoleName())
    expect(moduleFile('main.tf')).toMatch(/Action\s*=\s*"apigateway:\*"/)
  })
})

describe('terraform gateway-management role — versioning', () => {
  // contract: S2 — module version matches the equivalent one-click-channel artifact version (lockstep)
  it('S2: the Terraform channel publishes at the same single-sourced version as the one-click artifact', () => {
    const oneClickVersion = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'lib/gateway-role/package.json'), 'utf8'),
    ).version
    expect(oneClickVersion).toMatch(/^\d+\.\d+\.\d+$/)

    // the publish wiring derives the tag version from that same single source — lockstep by construction
    const publish = fs.readFileSync(path.join(REPO_ROOT, 'publish-terraform.sh'), 'utf8')
    expect(publish).toContain("require('./lib/gateway-role/package.json').version")
    expect(publish).toMatch(/TAG=.*\$\{VERSION\}/)

    // and the module pins no competing version literal of its own
    expect(allModuleSources()).not.toContain(oneClickVersion)
  })
})
