/**
 * The gateway-management role answers only to the portal that sends the external ID its trust
 * requires. These specs hold that in every channel a customer can create the role through — the CDK
 * construct, the published CloudFormation template, the Terraform module, the Launch Stack link and
 * the hand-build console instruction set — against the artifact each channel ships, and hold the
 * versions published before the ID to the trust they shipped with.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import * as cdk from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import {
  buildPublishedStack,
  ConsoleInstructionSet,
  DEFAULT_APIABLE_TRUST_ACCOUNT,
  EXTERNAL_ID_PARAMETER,
  EXTERNAL_ID_PATTERN_SOURCE,
  EXTERNAL_ID_TOKEN,
  GATEWAY_ROLE_LOGICAL_ID,
  generateConsoleInstructions,
  generateConsoleInstructionTemplate,
  generateLaunchStackUrl,
  isPublishedVersion,
  TRUST_ACCOUNT_TOKEN,
} from '@apiable/cdk-gateway-role'
import {
  Channel,
  ChannelModel,
  gate,
  REGION_TOKEN,
  reduceCloudFormation,
  reduceConsoleInstructions,
  reduceTerraformShowJson,
} from '@apiable/parity-gate'
import { asArray, asRecord, asString } from '../lib/parity-gate/narrow'
import { publishedTemplatePath, publishedVersion } from './support/published-template'

const REPO_ROOT = path.resolve(__dirname, '..')
const CONSTRUCT = 'apiable-gateway-role'
const REGION = 'eu-central-1'
const FIXTURES = path.join(REPO_ROOT, 'test/fixtures/parity-gate')
const MODULE_DIR = path.join(REPO_ROOT, 'terraform/apiable-gateway-role')
const TRUST_GRANT = `grant:assume-role:iam-role:${GATEWAY_ROLE_LOGICAL_ID}`
const CHANNELS: readonly Channel[] = ['cdk', 'cfn', 'terraform', 'console']

const ISSUED_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const ANOTHER_ID = 'f6e5d4c3-b2a1-4c8d-9e0f-5d4c3b2a1f0e'

const REFUSED_VALUES: readonly (readonly [string, string])[] = [
  ['a blank', ''],
  ['a wildcard', '*'],
  ['a list', `${ISSUED_ID},${ANOTHER_ID}`],
  ['an uppercase UUID', ISSUED_ID.toUpperCase()],
  ['a UUID that is not version 4', 'a1b2c3d4-e5f6-1a7b-8c9d-0e1f2a3b4c5d'],
]

/** The versions published before the external ID, each with the committed artifact it shipped as. */
const SUPERSEDED: readonly (readonly [string, string])[] = [
  ['1.0.0', 'gateway-role-v1-template.json'],
  ['2.0.0', 'gateway-role-v2-template.json'],
]

type Json = Record<string, unknown>
type TrustEdit = (statement: Json) => void

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, 'utf8'))
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const sole = <T>(items: readonly T[]): T => {
  expect(items).toHaveLength(1)
  return items[0]
}

const currentVersion = (): string => publishedVersion(CONSTRUCT)
const publishedDir = (): string => path.dirname(publishedTemplatePath(CONSTRUCT))
const supersededTemplate = (fixture: string): unknown => readJson(path.join(FIXTURES, fixture))

// ── Each channel's artifact, as it ships ──────────────────────────────────────────────────────────
const cdkTemplate = (): unknown => Template.fromStack(buildPublishedStack(new cdk.App())).toJSON()
const publishedTemplate = (): unknown => readJson(publishedTemplatePath(CONSTRUCT))
const publishedYaml = (): unknown => yaml.load(fs.readFileSync(publishedTemplatePath(CONSTRUCT, 'yaml'), 'utf8'))
const terraformPlan = (): unknown => readJson(path.join(FIXTURES, 'terraform-gateway-role-show.json'))
const moduleFile = (name: string): string => fs.readFileSync(path.join(MODULE_DIR, name), 'utf8')
const publishedSetText = (): string => fs.readFileSync(path.join(publishedDir(), 'console-instructions.json'), 'utf8')

/** The published set with the region and the trust account filled as the portal fills them. The
 * external ID stays the token: it is a deploy-time input in every channel, with no default to fill. */
const servedSet = (): ConsoleInstructionSet =>
  JSON.parse(publishedSetText().split(REGION_TOKEN).join(REGION).split(TRUST_ACCOUNT_TOKEN).join(DEFAULT_APIABLE_TRUST_ACCOUNT)) as ConsoleInstructionSet

// ── Reading and editing a trust, per artifact kind ────────────────────────────────────────────────
const statementsOf = (document: unknown): Json[] => asArray(asRecord(document).Statement).map(asRecord)
const resourceOfType = (template: unknown, type: string): Json =>
  sole(
    Object.values(asRecord(asRecord(template).Resources))
      .map(asRecord)
      .filter((resource) => resource.Type === type),
  )
const cfnTrust = (template: unknown): unknown => asRecord(resourceOfType(template, 'AWS::IAM::Role').Properties).AssumeRolePolicyDocument
const cfnPermissions = (template: unknown): unknown => asRecord(resourceOfType(template, 'AWS::IAM::Policy').Properties).PolicyDocument
const cfnParameters = (template: unknown): Json => asRecord(asRecord(template).Parameters)

const tfRoleValues = (plan: unknown): Json =>
  asRecord(
    sole(
      asArray(asRecord(asRecord(asRecord(plan).planned_values).root_module).resources)
        .map(asRecord)
        .filter((resource) => resource.type === 'aws_iam_role'),
    ).values,
  )
const tfTrust = (plan: unknown): unknown => JSON.parse(asString(tfRoleValues(plan).assume_role_policy) ?? '{}')
const tfPlannedExternalId = (plan: unknown): string | undefined => asString(asRecord(asRecord(asRecord(plan).variables).external_id).value)

const dropCondition: TrustEdit = (statement) => {
  delete statement.Condition
}
const setCondition =
  (condition: unknown): TrustEdit =>
  (statement) => {
    statement.Condition = condition
  }
const requireExternalId = (value: unknown): TrustEdit => setCondition({ StringEquals: { 'sts:ExternalId': value } })

const cfnWithTrust = (template: unknown, edit: TrustEdit): unknown => {
  const copy = clone(template)
  statementsOf(cfnTrust(copy)).forEach(edit)
  return copy
}
const tfWithTrust = (plan: unknown, edit: TrustEdit): unknown => {
  const copy = clone(plan)
  const trust = tfTrust(copy)
  statementsOf(trust).forEach(edit)
  tfRoleValues(copy).assume_role_policy = JSON.stringify(trust)
  return copy
}
const setWithTrust = (set: ConsoleInstructionSet, edit: TrustEdit): ConsoleInstructionSet => {
  const copy = clone(set)
  statementsOf(copy.trustDocument).forEach(edit)
  return copy
}

// ── The four channels through the gate's own reducers ─────────────────────────────────────────────
const cdkModel = (template: unknown = cdkTemplate()): ChannelModel => reduceCloudFormation(template, 'cdk')
const cfnModel = (template: unknown = publishedTemplate()): ChannelModel => reduceCloudFormation(template, 'cfn')
const tfModel = (plan: unknown = terraformPlan()): ChannelModel => reduceTerraformShowJson(plan, 'terraform', REGION)
const consoleModel = (set: ConsoleInstructionSet = servedSet()): ChannelModel => reduceConsoleInstructions(set, REGION)

const fourChannels = (replaced: Partial<Record<Channel, ChannelModel>> = {}): ChannelModel[] => [
  replaced.cdk ?? cdkModel(),
  replaced.cfn ?? cfnModel(),
  replaced.terraform ?? tfModel(),
  replaced.console ?? consoleModel(),
]

/** One channel with its trust edited and the other three as shipped. */
const withTrustEditedIn = (channel: Channel, edit: TrustEdit): ChannelModel[] => {
  switch (channel) {
    case 'cdk':
      return fourChannels({ cdk: cdkModel(cfnWithTrust(cdkTemplate(), edit)) })
    case 'cfn':
      return fourChannels({ cfn: cfnModel(cfnWithTrust(publishedTemplate(), edit)) })
    case 'terraform':
      return fourChannels({ terraform: tfModel(tfWithTrust(terraformPlan(), edit)) })
    case 'console':
      return fourChannels({ console: consoleModel(setWithTrust(servedSet(), edit)) })
  }
}

const trustDivergenceOf = (models: readonly ChannelModel[]): readonly Channel[] | undefined =>
  gate(models).divergences.find((entry) => entry.tier === 'permission' && entry.detail.includes(TRUST_GRANT))?.channels

const reducedTrustConditions = (model: ChannelModel): (string | undefined)[] =>
  model.grants.filter((grant) => grant.ref === TRUST_GRANT).map((grant) => grant.condition)

describe('gateway role — every channel requires the external ID', () => {
  it('the CDK construct conditions its only trust statement on the external-ID parameter', () => {
    expect(sole(statementsOf(cfnTrust(cdkTemplate()))).Condition).toEqual({ StringEquals: { 'sts:ExternalId': { Ref: EXTERNAL_ID_PARAMETER } } })
  })

  it('the published template carries that condition in the YAML a customer launches, and its JSON twin is the same document', () => {
    expect(sole(statementsOf(cfnTrust(publishedYaml()))).Condition).toEqual({ StringEquals: { 'sts:ExternalId': { Ref: EXTERNAL_ID_PARAMETER } } })
    expect(publishedTemplate()).toEqual(publishedYaml())
  })

  it('the Terraform module conditions its only trust statement on the external_id variable', () => {
    const role = moduleFile('main.tf').split('resource "aws_iam_role_policy"')[0]
    expect(role).toMatch(/Condition\s*=\s*\{\s*StringEquals\s*=\s*\{\s*"sts:ExternalId"\s*=\s*var\.external_id\s*\}\s*\}/)

    const plan = terraformPlan()
    expect(tfPlannedExternalId(plan)).toMatch(new RegExp(EXTERNAL_ID_PATTERN_SOURCE))
    expect(sole(statementsOf(tfTrust(plan))).Condition).toEqual({ StringEquals: { 'sts:ExternalId': tfPlannedExternalId(plan) } })
  })

  it('the published console instruction set leaves the external ID as the token the portal fills', () => {
    const published = JSON.parse(publishedSetText()) as ConsoleInstructionSet
    expect(sole(statementsOf(published.trustDocument)).Condition).toEqual({ StringEquals: { 'sts:ExternalId': EXTERNAL_ID_TOKEN } })
    expect(publishedSetText().split(EXTERNAL_ID_TOKEN)).toHaveLength(2)
  })

  it('the Launch Stack link pre-fills the parameter the published template declares', () => {
    const url = new URL(generateLaunchStackUrl({ tenantId: 't-1', roleTrustTarget: DEFAULT_APIABLE_TRUST_ACCOUNT, externalId: ISSUED_ID, region: REGION, version: currentVersion() }))
    const prefilled = [...new URLSearchParams(url.hash.split('?')[1]).keys()].filter((key) => key.startsWith('param_')).map((key) => key.slice('param_'.length))

    expect(prefilled).toContain(EXTERNAL_ID_PARAMETER)
    for (const parameter of prefilled) expect(cfnParameters(publishedYaml())).toHaveProperty(parameter)
  })

  it('all four channels reduce the parameter to one named value and the parity gate passes', () => {
    const models = fourChannels()
    const result = gate(models)

    expect(result.divergences).toEqual([])
    expect(result.passed).toBe(true)

    const [cdkCondition] = reducedTrustConditions(models[0])
    expect(cdkCondition).toContain(EXTERNAL_ID_TOKEN)
    for (const model of models) expect(reducedTrustConditions(model)).toEqual([cdkCondition])
  })
})

describe('gateway role — the parity gate fails when one channel stops requiring the external ID', () => {
  it.each(CHANNELS)('fails when the %s channel alone loses the condition, naming that channel', (channel) => {
    expect(trustDivergenceOf(withTrustEditedIn(channel, dropCondition))).toEqual([channel])
  })

  it.each(CHANNELS)('fails when the %s channel alone pins a literal ID where the others take the parameter', (channel) => {
    expect(trustDivergenceOf(withTrustEditedIn(channel, requireExternalId(ANOTHER_ID)))).toEqual([channel])
  })

  it.each(CHANNELS)('fails when the %s channel alone accepts a second ID as well', (channel) => {
    const itsOwnSpelling: Record<Channel, unknown> = {
      cdk: { Ref: EXTERNAL_ID_PARAMETER },
      cfn: { Ref: EXTERNAL_ID_PARAMETER },
      terraform: tfPlannedExternalId(terraformPlan()),
      console: EXTERNAL_ID_TOKEN,
    }
    expect(trustDivergenceOf(withTrustEditedIn(channel, requireExternalId([itsOwnSpelling[channel], ANOTHER_ID])))).toEqual([channel])
  })

  it('fails when the published template pins a literal that only spells a reference to the parameter', () => {
    expect(trustDivergenceOf(withTrustEditedIn('cfn', requireExternalId(`@ref:${EXTERNAL_ID_PARAMETER}`)))).toEqual(['cfn'])
  })

  it('fails when the Terraform trust carries the planned ID without taking it from the variable', () => {
    const hardcoded = clone(terraformPlan())
    const role = sole(
      asArray(asRecord(asRecord(asRecord(hardcoded).configuration).root_module).resources)
        .map(asRecord)
        .filter((resource) => resource.type === 'aws_iam_role'),
    )
    const trustExpression = asRecord(asRecord(role.expressions).assume_role_policy)
    trustExpression.references = asArray(trustExpression.references).filter((reference) => reference !== 'var.external_id')

    expect(trustDivergenceOf(fourChannels({ terraform: tfModel(hardcoded) }))).toEqual(['terraform'])
  })

  it('fails when the published template gives the parameter a default', () => {
    const defaulted = clone(publishedTemplate())
    asRecord(cfnParameters(defaulted)[EXTERNAL_ID_PARAMETER]).Default = ISSUED_ID

    expect(trustDivergenceOf(fourChannels({ cfn: cfnModel(defaulted) }))).toEqual(['cfn'])
  })
})

describe('gateway role — the external ID is required and is exactly one lowercase version 4 UUID', () => {
  // CloudFormation matches AllowedPattern against the whole value.
  const templatePattern = (): RegExp => {
    const pattern = asString(asRecord(cfnParameters(publishedYaml())[EXTERNAL_ID_PARAMETER]).AllowedPattern)
    if (pattern === undefined) throw new Error('the published template declares no AllowedPattern for the external ID')
    return new RegExp(`^(?:${pattern})$`)
  }

  const moduleVariable = (): string => {
    const block = moduleFile('variables.tf').match(/variable\s+"external_id"\s*\{[\s\S]*?\n\}/)?.[0]
    if (block === undefined) throw new Error('the Terraform module declares no external_id variable')
    return block
  }
  // Terraform's regex() searches, so the module's own anchors are what make its check whole-value.
  const modulePattern = (): RegExp => {
    const pattern = moduleVariable().match(/regex\(\s*"([^"]+)"\s*,\s*var\.external_id\s*\)/)?.[1]
    if (pattern === undefined) throw new Error('the external_id variable carries no regex check')
    return new RegExp(pattern)
  }

  it('the published template declares the parameter with no default, in the YAML a customer launches', () => {
    const parameter = asRecord(cfnParameters(publishedYaml())[EXTERNAL_ID_PARAMETER])

    expect(parameter.Type).toBe('String')
    expect(parameter.AllowedPattern).toBe(EXTERNAL_ID_PATTERN_SOURCE)
    expect(parameter).not.toHaveProperty('Default')
  })

  it('the CDK construct declares the same parameter under the logical id the Launch Stack link addresses', () => {
    Template.fromStack(buildPublishedStack(new cdk.App())).hasParameter(EXTERNAL_ID_PARAMETER, {
      Type: 'String',
      AllowedPattern: EXTERNAL_ID_PATTERN_SOURCE,
      Default: Match.absent(),
    })
  })

  it.each(REFUSED_VALUES)('the published template refuses %s', (_label, value) => {
    expect(templatePattern().test(value)).toBe(false)
  })

  it('the published template accepts one lowercase version 4 UUID', () => {
    expect(templatePattern().test(ISSUED_ID)).toBe(true)
  })

  it('the Terraform module declares the variable with no default and a positive check on it', () => {
    expect(moduleVariable()).toMatch(/type\s*=\s*string/)
    expect(moduleVariable()).not.toMatch(/\bdefault\s*=/)
    expect(moduleVariable().match(/condition\s*=\s*(.+)/)?.[1].trim()).toMatch(/^can\(\s*regex\(/)
    expect(modulePattern().source).toBe(new RegExp(EXTERNAL_ID_PATTERN_SOURCE).source)
  })

  it.each(REFUSED_VALUES)('the Terraform module refuses %s', (_label, value) => {
    expect(modulePattern().test(value)).toBe(false)
  })

  it('the Terraform module accepts one lowercase version 4 UUID', () => {
    expect(modulePattern().test(ISSUED_ID)).toBe(true)
  })
})

describe('gateway role — the versions published before the external ID keep the trust they shipped with', () => {
  it.each(SUPERSEDED)('%s still generates with no trust condition and no external-ID token', (version, fixture) => {
    const resolved = generateConsoleInstructions(supersededTemplate(fixture), version, currentVersion(), REGION)
    const published = generateConsoleInstructionTemplate(supersededTemplate(fixture), version, currentVersion())

    for (const set of [resolved, published]) {
      expect(set.version).toBe(version)
      expect(sole(statementsOf(set.trustDocument))).not.toHaveProperty('Condition')
      expect(JSON.stringify(set)).not.toContain(EXTERNAL_ID_TOKEN)
    }
  })

  it('2.0.0 generates the instruction set it was published with, byte for byte', () => {
    const generated = `${JSON.stringify(generateConsoleInstructionTemplate(supersededTemplate('gateway-role-v2-template.json'), '2.0.0', currentVersion()), null, 2)}\n`

    expect(generated).toBe(fs.readFileSync(path.join(FIXTURES, 'gateway-role-v2-console-instructions.json'), 'utf8'))
  })

  it.each(SUPERSEDED)('%s refuses an artifact whose trust carries a condition', (version, fixture) => {
    for (const value of [ISSUED_ID, EXTERNAL_ID_TOKEN]) {
      const conditioned = cfnWithTrust(supersededTemplate(fixture), requireExternalId(value))
      expect(() => generateConsoleInstructionTemplate(conditioned, version, currentVersion())).toThrow(/takes no external ID/)
    }
  })

  it.each(SUPERSEDED)('%s refuses an artifact that declares the parameter, with or without the condition', (version, fixture) => {
    const declaring = clone(supersededTemplate(fixture))
    cfnParameters(declaring)[EXTERNAL_ID_PARAMETER] = { Type: 'String' }

    expect(() => generateConsoleInstructionTemplate(declaring, version, currentVersion())).toThrow(/takes no external ID/)
    expect(() => generateConsoleInstructionTemplate(publishedTemplate(), version, currentVersion())).toThrow(/takes no external ID/)
  })

  it('current source publishes under neither superseded version', () => {
    for (const [version] of SUPERSEDED) {
      expect(isPublishedVersion(version, currentVersion())).toBe(true)
      expect(currentVersion()).not.toBe(version)
    }
  })
})

describe('gateway role — the console generator refuses any trust but the one condition', () => {
  const generateFrom = (template: unknown) => (): ConsoleInstructionSet => generateConsoleInstructionTemplate(template, currentVersion(), currentVersion())
  const parameterRef = { Ref: EXTERNAL_ID_PARAMETER }

  it('generates from the artifact as published', () => {
    expect(generateFrom(publishedTemplate())).not.toThrow()
  })

  it.each<readonly [string, TrustEdit]>([
    ['no condition at all', dropCondition],
    ['a literal ID in place of the parameter', requireExternalId(ISSUED_ID)],
    ['a list of IDs', requireExternalId([parameterRef, ISSUED_ID])],
    ['a wildcard match in place of equality', setCondition({ StringLike: { 'sts:ExternalId': parameterRef } })],
    ['an equality that passes when no ID is sent', setCondition({ StringEqualsIfExists: { 'sts:ExternalId': parameterRef } })],
    ['a second key beside the ID', setCondition({ StringEquals: { 'sts:ExternalId': parameterRef, 'aws:PrincipalTag/team': 'platform' } })],
    ['a second operator beside the equality', setCondition({ StringEquals: { 'sts:ExternalId': parameterRef }, Bool: { 'aws:MultiFactorAuthPresent': 'true' } })],
  ])('refuses %s', (_label, edit) => {
    expect(generateFrom(cfnWithTrust(publishedTemplate(), edit))).toThrow(/requires the external ID/)
  })

  it('refuses a trust with no statement to carry the condition', () => {
    const emptied = clone(publishedTemplate())
    asRecord(cfnTrust(emptied)).Statement = []

    expect(generateFrom(emptied)).toThrow(/requires the external ID/)
  })

  it('refuses a second trust statement that does not carry the condition', () => {
    const widened = clone(publishedTemplate())
    const trust = asRecord(cfnTrust(widened))
    trust.Statement = [...statementsOf(trust), { Effect: 'Allow', Action: 'sts:AssumeRole', Principal: { AWS: 'arn:aws:iam::111122223333:root' } }]

    expect(generateFrom(widened)).toThrow(/requires the external ID/)
  })

  it('refuses an artifact that gives the parameter a default', () => {
    const defaulted = clone(publishedTemplate())
    asRecord(cfnParameters(defaulted)[EXTERNAL_ID_PARAMETER]).Default = ISSUED_ID

    expect(generateFrom(defaulted)).toThrow(/requires the external ID/)
  })

  it('refuses the 2.0.0 artifact handed in as the current version', () => {
    expect(generateFrom(supersededTemplate('gateway-role-v2-template.json'))).toThrow(/requires the external ID/)
  })
})

describe('gateway role — the current version adds the condition and nothing else', () => {
  const v2Template = (): unknown => supersededTemplate('gateway-role-v2-template.json')

  /** The template with the one parameter and the one condition taken out again. */
  const withoutTheExternalId = (template: unknown): unknown => {
    const copy = cfnWithTrust(template, dropCondition)
    delete cfnParameters(copy)[EXTERNAL_ID_PARAMETER]
    return copy
  }

  it('the published template is 2.0.0 once the parameter and the condition are taken out', () => {
    expect(withoutTheExternalId(publishedYaml())).toEqual(v2Template())
  })

  it('the published template grants the permissions of 2.0.0, statement for statement', () => {
    expect(statementsOf(cfnPermissions(v2Template()))).toHaveLength(5)
    expect(cfnPermissions(publishedYaml())).toEqual(cfnPermissions(v2Template()))
  })

  it('the console instruction set grants the permissions of 2.0.0, statement for statement', () => {
    const published = JSON.parse(publishedSetText()) as ConsoleInstructionSet
    const v2Published = readJson(path.join(FIXTURES, 'gateway-role-v2-console-instructions.json'))

    expect(published.permissionDocument).toEqual(asRecord(v2Published).permissionDocument)
  })

  it('the CDK construct, the Terraform plan and the served console set, each without the condition, are 2.0.0 on every tier of the gate', () => {
    const result = gate([
      cdkModel(cfnWithTrust(cdkTemplate(), dropCondition)),
      reduceCloudFormation(v2Template(), 'cfn'),
      tfModel(tfWithTrust(terraformPlan(), dropCondition)),
      consoleModel(setWithTrust(servedSet(), dropCondition)),
    ])

    expect(result.divergences).toEqual([])
    expect(result.passed).toBe(true)
  })
})
