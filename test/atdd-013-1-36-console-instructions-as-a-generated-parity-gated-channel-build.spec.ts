/**
 * Acceptance specs for story 013-1-36 — the hand-build console instructions become a generated,
 * parity-gated FOURTH channel alongside the CDK construct, the published CloudFormation template,
 * and the Terraform module.
 * Frozen contract: contract-013-1-36-console-instructions-as-a-generated-parity-gated-channel.md
 *
 * One un-skipped spec per contract scenario (S1–S10), driven through the real generator
 * (`@apiable/cdk-gateway-role`'s `generateConsoleInstructions`) and the real gate + reducers
 * (`@apiable/parity-gate`) against the REAL published artifacts: the current (v2) CFN twin the
 * release workflow synthesizes before `npm test` runs (`synth-all-launchstack.sh`), and a committed
 * fixture standing in for v1 — outside what a local synth of current source can reproduce, so its
 * bytes are a real, once-fetched snapshot of the still-live `1.0.0` published template (mirroring
 * the fixture-not-live-fetch pattern the Terraform channel already uses for its own committed
 * `terraform show -json` snapshots — the default gate stays hermetic, no network in the loop).
 */
import * as fs from 'fs'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import {
  buildPublishedStack,
  ConsoleInstructionSet,
  GATEWAY_ROLE_LOGICAL_ID,
  generateConsoleInstructions,
} from '@apiable/cdk-gateway-role'
import {
  ChannelModel,
  gate,
  reduceCloudFormation,
  reduceConsoleInstructions,
  reduceTerraformShowJson,
} from '@apiable/parity-gate'
import { publishedTemplatePath, publishedVersion } from './support/published-template'

const REPO_ROOT = path.resolve(__dirname, '..')
const CONSTRUCT = 'apiable-gateway-role'
const REGION = 'eu-central-1'
const V1_FIXTURE = path.join(REPO_ROOT, 'test/fixtures/parity-gate/gateway-role-v1-template.json')
const TF_FIXTURE = path.join(REPO_ROOT, 'test/fixtures/parity-gate/terraform-gateway-role-show.json')
const ROLE_REF = `iam-role:${GATEWAY_ROLE_LOGICAL_ID}`

const currentVersion = (): string => publishedVersion(CONSTRUCT)

/** The parsed published artifact for `version` — the current version from the workflow's own local
 * synth (byte-identical to what CI publishes; see synth-all-launchstack.sh), any other from a
 * committed fixture. Throws for a version this harness has no artifact for at all — distinct from
 * (and orthogonal to) the generator's OWN "is this published" refusal exercised in S6. */
const templateFor = (version: string): unknown => {
  if (version === currentVersion()) return JSON.parse(fs.readFileSync(publishedTemplatePath(CONSTRUCT), 'utf8'))
  if (version === '1.0.0') return JSON.parse(fs.readFileSync(V1_FIXTURE, 'utf8'))
  throw new Error(`test harness has no committed artifact for ${CONSTRUCT}@${version}`)
}

const instructionsFor = (version: string): ConsoleInstructionSet =>
  generateConsoleInstructions(templateFor(version), version, currentVersion(), REGION)

// ── The three real pilot channels for the CURRENT artifact, reduced through the gate's own reducers
// (mirrors atdd-013-1-3-ci-parity-gate-cdk-cfn-terraform-gate.spec.ts's pilotModels()) ─────────────
const cdkModel = (): ChannelModel => reduceCloudFormation(Template.fromStack(buildPublishedStack(new cdk.App())).toJSON(), 'cdk')
const cfnModel = (): ChannelModel => reduceCloudFormation(templateFor(currentVersion()), 'cfn')
const tfModel = (): ChannelModel => reduceTerraformShowJson(JSON.parse(fs.readFileSync(TF_FIXTURE, 'utf8')), 'terraform', REGION)
const consoleModel = (instructions: ConsoleInstructionSet = instructionsFor(currentVersion())): ChannelModel =>
  reduceConsoleInstructions(instructions, REGION)

const fourChannelModels = (): ChannelModel[] => [cdkModel(), cfnModel(), tfModel(), consoleModel()]

// A minimal synthetic role+policy CFN document for a two-role, engine-generic non-clobber check
// (mirrors parity-gate.spec.ts's own "two roles do not collapse" fixture shape).
const twoRoleDoc = (roleBTrustArn: string): unknown => ({
  Resources: {
    RoleA: {
      Type: 'AWS::IAM::Role',
      Properties: {
        Tags: [{ Key: 'apiable:logical-id', Value: 'role-a' }],
        AssumeRolePolicyDocument: {
          Version: '2012-10-17',
          Statement: [{ Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::111111111111:root' }, Action: 'sts:AssumeRole' }],
        },
      },
    },
    RoleB: {
      Type: 'AWS::IAM::Role',
      Properties: {
        Tags: [{ Key: 'apiable:logical-id', Value: 'role-b' }],
        AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: roleBTrustArn }, Action: 'sts:AssumeRole' }] },
      },
    },
  },
})

describe('013-1-36-console-instructions-as-a-generated-parity-gated-channel', () => {
  // contract: S1
  it('[P0] S1 — The instruction set is generated from the published artifact', () => {
    const instructions = instructionsFor(currentVersion())

    expect(instructions.roleName).toBe(`apiable-gateway-management-role-${REGION}`)
    expect(instructions.trustAccount).toBe('034444869755')
    expect(instructions.trustDocument.Statement[0].Principal?.AWS).toBe('arn:aws:iam::034444869755:root')
    expect(instructions.permissionDocument.Statement.map((statement) => statement.Sid)).toEqual([
      'ReadRestApisOnly',
      'ManageApiKeysAndUsagePlans',
      'TagUsagePlans',
      'DenyHttpAndWebSocketApis',
      'DenyOutsideApiableEgress',
    ])
    expect(instructions.egressCidr).toBe('63.180.116.108/32')

    // Every placeholder resolved: nothing serialisable still carries a CloudFormation intrinsic marker.
    expect(JSON.stringify(instructions)).not.toMatch(/Fn::|"Ref"|@ref:|@getatt:/)
  })

  // contract: S2
  it('[P0] S2 — Divergence fails the release, naming what diverged; role NAME stays a cosmetic', () => {
    const base = instructionsFor(currentVersion())
    expect(gate(fourChannelModels()).passed).toBe(true)

    // The console channel's trust account diverges from the other three → fails, named by value.
    const divergentTrust: ConsoleInstructionSet = {
      ...base,
      trustAccount: '999988887777',
      trustDocument: { ...base.trustDocument, Statement: [{ ...base.trustDocument.Statement[0], Principal: { AWS: 'arn:aws:iam::999988887777:root' } }] },
    }
    const divergentResult = gate([cdkModel(), cfnModel(), tfModel(), consoleModel(divergentTrust)])
    expect(divergentResult.passed).toBe(false)
    const trustDivergence = divergentResult.divergences.find((d) => d.tier === 'value' && d.detail.includes('role-trust-account'))
    expect(trustDivergence?.channels).toEqual(['console'])
    expect(trustDivergence?.detail).toContain('034444869755')
    expect(trustDivergence?.detail).toContain('999988887777')

    // The console channel's ROLE NAME differs alone — cosmetic only, the release still passes.
    const renamedOnly: ConsoleInstructionSet = { ...base, roleName: 'a-completely-different-role-name' }
    const renamedResult = gate([cdkModel(), cfnModel(), tfModel(), consoleModel(renamedOnly)])
    expect(renamedResult.passed).toBe(true)
    expect(renamedResult.warnings.some((warning) => warning.startsWith(`cosmetic name:${ROLE_REF} differs`))).toBe(true)
  })

  // contract: S3
  it('[P0] S3 — The new channel is no exception, and adding it displaces nothing', () => {
    // All four channels agree — role-a trusts 111111111111, role-b trusts 222222222222, everywhere.
    const agreeing = gate([
      reduceCloudFormation(twoRoleDoc('arn:aws:iam::222222222222:root'), 'cdk'),
      reduceCloudFormation(twoRoleDoc('arn:aws:iam::222222222222:root'), 'cfn'),
      reduceCloudFormation(twoRoleDoc('arn:aws:iam::222222222222:root'), 'terraform'),
      reduceCloudFormation(twoRoleDoc('arn:aws:iam::222222222222:root'), 'console'),
    ])
    expect(agreeing.passed).toBe(true)

    // The 4th (console) channel diverges on role-b's trust account ONLY — role-a is untouched, proving
    // the two roles' by-value trust comparisons stay independent (no cross-role collapse) with a 4th
    // channel present, and that the console channel is compared by value exactly like the other three.
    const oneChannelDivergesOnOneRole = gate([
      reduceCloudFormation(twoRoleDoc('arn:aws:iam::222222222222:root'), 'cdk'),
      reduceCloudFormation(twoRoleDoc('arn:aws:iam::222222222222:root'), 'cfn'),
      reduceCloudFormation(twoRoleDoc('arn:aws:iam::222222222222:root'), 'terraform'),
      reduceCloudFormation(twoRoleDoc('arn:aws:iam::999988887777:root'), 'console'),
    ])
    expect(oneChannelDivergesOnOneRole.passed).toBe(false)
    const trustDivergences = oneChannelDivergesOnOneRole.divergences.filter((d) => d.tier === 'value' && d.detail.includes('role-trust-account'))
    expect(trustDivergences).toHaveLength(1)
    expect(trustDivergences[0].detail).toContain('role-b')
    expect(trustDivergences[0].channels).toEqual(['console'])
    expect(oneChannelDivergesOnOneRole.divergences.some((d) => d.detail.includes('role-a'))).toBe(false)
  })

  // contract: S4
  it('[P1] S4 — A condition the platform cannot satisfy never reaches the set', () => {
    const instructions = instructionsFor(currentVersion())
    for (const statement of instructions.trustDocument.Statement) expect(statement.Condition).toBeUndefined()

    // A future artifact that regressed a trust Condition (e.g. sts:ExternalId) back in must be refused.
    const withTrustCondition = {
      Parameters: { ApiableTrustAccount: { Type: 'String', Default: '034444869755' } },
      Resources: {
        Role: {
          Type: 'AWS::IAM::Role',
          Properties: {
            RoleName: 'apiable-gateway-management-role-eu-central-1',
            AssumeRolePolicyDocument: {
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Action: 'sts:AssumeRole',
                  Principal: { AWS: { 'Fn::Join': ['', ['arn:aws:iam::', { Ref: 'ApiableTrustAccount' }, ':root']] } },
                  Condition: { StringEquals: { 'sts:ExternalId': 'apiable:acme-corp:7f3a9c21' } },
                },
              ],
            },
          },
        },
        Policy: { Type: 'AWS::IAM::Policy', Properties: { PolicyDocument: { Version: '2012-10-17', Statement: [] } } },
      },
    }
    expect(() => generateConsoleInstructions(withTrustCondition, currentVersion(), currentVersion(), REGION)).toThrow(/Condition/)
  })

  // contract: S5
  it('[P1] S5 — A blanket permission never reaches the set', () => {
    const statements = instructionsFor(currentVersion()).permissionDocument.Statement
    expect(statements.filter((statement) => statement.Effect === 'Allow')).toHaveLength(3)
    expect(statements.filter((statement) => statement.Effect === 'Deny')).toHaveLength(2)
    // Never substituted for a blanket allow over the whole service — the defect this story exists to close.
    expect(statements.some((statement) => statement.Effect === 'Allow' && statement.Action === 'apigateway:*')).toBe(false)
  })

  // contract: S6
  it('[P1] S6 — An unpublished version fails loudly', () => {
    expect(() => generateConsoleInstructions(templateFor(currentVersion()), '9.9.9', currentVersion(), REGION)).toThrow(/not a published version/)
  })

  // contract: S7
  it('[P1] S7 — Both published versions generate correctly', () => {
    const v1 = instructionsFor('1.0.0')
    const v2 = instructionsFor(currentVersion())

    expect(v1.permissionDocument.Statement).toHaveLength(1)
    expect(v1.permissionDocument.Statement[0]).toMatchObject({ Effect: 'Allow', Action: 'apigateway:*' })
    expect(v1.egressCidr).toBeUndefined()

    expect(v2.permissionDocument.Statement).toHaveLength(5)
    expect(v2.egressCidr).toBe('63.180.116.108/32')

    // Same trust account, genuinely different permission shape — the version drives real output,
    // not a pinned v2 answer regardless of what was asked for.
    expect(v1.trustAccount).toBe(v2.trustAccount)
    expect(v1.permissionDocument).not.toEqual(v2.permissionDocument)

    // Each matches its own artifact: reducing each generated set lands on the SAME declared-id role
    // ref and the SAME trust-account value the artifact itself declares.
    expect(reduceConsoleInstructions(v1, REGION).values[`role-trust-account:${ROLE_REF}`]).toBe('034444869755')
    expect(reduceConsoleInstructions(v2, REGION).values[`role-trust-account:${ROLE_REF}`]).toBe('034444869755')
  })

  // contract: S8
  it('[P1] S8 — An unrecognised placeholder fails rather than half-resolving', () => {
    const validPolicy = { Type: 'AWS::IAM::Policy', Properties: { PolicyDocument: { Version: '2012-10-17', Statement: [] } } }
    const validTrust = {
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Action: 'sts:AssumeRole', Principal: { AWS: 'arn:aws:iam::034444869755:root' } }],
    }

    const withGetAtt = {
      Resources: {
        Role: { Type: 'AWS::IAM::Role', Properties: { RoleName: { 'Fn::GetAtt': ['SomeResource', 'Arn'] }, AssumeRolePolicyDocument: validTrust } },
        Policy: validPolicy,
      },
    }
    expect(() => generateConsoleInstructions(withGetAtt, currentVersion(), currentVersion(), REGION)).toThrow(/unsupported intrinsic/)

    const withUnresolvableRef = {
      Resources: {
        Role: { Type: 'AWS::IAM::Role', Properties: { RoleName: { Ref: 'SomeParameterWithNoDefault' }, AssumeRolePolicyDocument: validTrust } },
        Policy: validPolicy,
      },
    }
    expect(() => generateConsoleInstructions(withUnresolvableRef, currentVersion(), currentVersion(), REGION)).toThrow(/unresolvable Ref/)
  })

  // contract: S9
  it('[P1] S9 — The channel is actually compared in the release run', () => {
    // The real gateway-role artifacts, all four channels, exactly as this story wires into CI.
    const result = gate(fourChannelModels())
    expect(result.passed).toBe(true)

    // Non-vacuity: prove the comparator does real work, not merely runs. Break ONLY the
    // console-generated permission set (drop the egress-deny a hand-built role would then lack) and
    // show the SAME gate() call catches it, naming 'console' — a comparator that exists and is never
    // invoked in the release could not.
    const base = instructionsFor(currentVersion())
    const widened: ConsoleInstructionSet = {
      ...base,
      permissionDocument: { ...base.permissionDocument, Statement: base.permissionDocument.Statement.filter((s) => s.Sid !== 'DenyOutsideApiableEgress') },
    }
    const broken = gate([cdkModel(), cfnModel(), tfModel(), consoleModel(widened)])
    expect(broken.passed).toBe(false)
    const permissionDivergence = broken.divergences.find((d) => d.tier === 'permission')
    expect(permissionDivergence?.channels).toEqual(['console'])
  })

  // contract: S10
  it('[P1] S10 — Each value the instructions need is its own named value', () => {
    const instructions = instructionsFor(currentVersion())

    expect(typeof instructions.roleName).toBe('string')
    expect(typeof instructions.trustAccount).toBe('string')
    expect(typeof instructions.trustDocument).toBe('object')
    expect(typeof instructions.permissionDocument).toBe('object')
    expect(typeof instructions.egressCidr).toBe('string')
    // Independently addressable — trust and permission are two distinct named values, never one blob.
    expect(instructions.trustDocument).not.toBe(instructions.permissionDocument as unknown)
    expect(Object.keys(instructions).sort()).toEqual(
      ['construct', 'egressCidr', 'permissionDocument', 'region', 'roleName', 'trustAccount', 'trustDocument', 'version'].sort(),
    )
  })
})
