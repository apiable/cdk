/**
 * The user pool role: a role a Provider deploys in their own account that lets Apiable manage app clients
 * in one Amazon Cognito user pool and nothing else, from Apiable's address only, and only for a request
 * that carries the External ID it was deployed with. Held here in every channel a Provider can create it
 * through: the one-click stack (the published template), the Terraform module (its committed plan, which
 * the engine checks keep equal to a fresh plan of the module), the hand-build instructions (the published
 * set, filled as an API Portal fills it) and the construct used directly.
 *
 * Each role is judged against a stand-in for AWS's decision (./support/role-decision.ts), never by
 * matching the words of a template. The module's refusals of its inputs are the engine's, run by
 * check-cognito-pool-role-module.sh in CI. Whether the role works against a real pool is the operator's
 * live check (the .live.spec.ts beside this file).
 */
import * as fs from 'fs'
import * as path from 'path'
import { spawnSync } from 'child_process'
import * as yaml from 'js-yaml'
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import {
  APP_CLIENT_ACTIONS,
  buildPublishedStack,
  CognitoPoolRole,
  COGNITO_POOL_ROLE_LOGICAL_ID,
  EXTERNAL_ID_PARAMETER,
  generatePoolRoleConsoleInstructionTemplate,
  USER_POOL_ID_PARAMETER,
  USER_POOL_ID_TOKEN,
} from '@apiable/cdk-cognito-pool-role'
import { DEFAULT_APIABLE_EGRESS_CIDR, DEFAULT_APIABLE_TRUST_ACCOUNT, EXTERNAL_ID_TOKEN, TRUST_ACCOUNT_TOKEN } from '@apiable/cdk-gateway-role'
import { CognitoPool } from '@apiable/cdk-cognito-pool'
import type { ConsoleInstructionSet } from '@apiable/cdk-gateway-role'
import { Channel, ChannelModel, gate, reduceCloudFormation, reduceConsoleInstructions, reduceTerraformShowJson, REGION_TOKEN } from '@apiable/parity-gate'
import { ACCOUNT_TOKEN } from '../lib/parity-gate/model'
import { PRINCIPAL_ACCOUNT_VARIABLE } from '../lib/parity-gate/canonical'
import { requiresExternalIdFor } from '../lib/console-instruction-constructs'
import { asArray, asRecord, asString } from '../lib/parity-gate/narrow'
import { CallRequest, launchedRole, mayAssume, mayCall, refusedParameters, ResolvedRole } from './support/role-decision'
import { publishedTemplatePath, publishedVersion } from './support/published-template'

const REPO_ROOT = path.resolve(__dirname, '..')
const CONSTRUCT = 'apiable-cognito-pool-role'
const REGION = 'eu-central-1'
// The account and the inputs the committed Terraform plan was made with, so every channel is judged on one deployment.
const PROVIDER_ACCOUNT = '111122223333'
const POOL_ID = 'eu-central-1_AbCdEfGhI'
const ISSUED_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const ANOTHER_PORTALS_ID = 'f6e5d4c3-b2a1-4c8d-9e0f-5d4c3b2a1f0e'
const FRESH_RANDOM_ID = '0b9d2c6e-7f41-4a3b-9c8d-1e2f3a4b5c6d'
const ANOTHER_ACCOUNT = '444455556666'
const APIABLE_ADDRESS = DEFAULT_APIABLE_EGRESS_CIDR.split('/')[0]
const ANOTHER_ADDRESS = '203.0.113.9'
const SECOND_POOL_ID = 'eu-central-1_ZyXwVuTsR'
const FIXTURES = path.join(REPO_ROOT, 'test/fixtures/parity-gate')
const PLAN_FIXTURE = path.join(FIXTURES, 'terraform-cognito-pool-role-show.json')

type RoleChannel = 'one-click stack' | 'Terraform module' | 'hand-build instructions' | 'construct used directly'
const ROLE_CHANNELS: readonly RoleChannel[] = ['one-click stack', 'Terraform module', 'hand-build instructions', 'construct used directly']

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, 'utf8'))
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const poolArn = (poolId: string, region = REGION, account = PROVIDER_ACCOUNT): string => `arn:aws:cognito-idp:${region}:${account}:userpool/${poolId}`
const currentVersion = (): string => publishedVersion(CONSTRUCT)
const publishedDir = (): string => path.dirname(publishedTemplatePath(CONSTRUCT))

// ── Each channel's artifact, as it ships ──────────────────────────────────────────────────────────
const cdkTemplate = (): unknown => Template.fromStack(buildPublishedStack(new cdk.App())).toJSON()
const publishedTemplate = (): unknown => readJson(publishedTemplatePath(CONSTRUCT))
const publishedYaml = (): unknown => yaml.load(fs.readFileSync(publishedTemplatePath(CONSTRUCT, 'yaml'), 'utf8'))
const terraformPlan = (): unknown => readJson(PLAN_FIXTURE)
const publishedSetText = (): string => fs.readFileSync(path.join(publishedDir(), 'console-instructions.json'), 'utf8')

/** The construct as a Provider uses it in their own stack, given only the values it requires. */
const directTemplate = (props: { userPoolId?: string; region?: string } = {}): unknown => {
  const stack = new cdk.Stack(new cdk.App(), 'ProviderStack', { env: { account: PROVIDER_ACCOUNT, region: props.region ?? REGION } })
  new CognitoPoolRole(stack, 'PoolRole', { userPoolId: props.userPoolId ?? POOL_ID })
  return Template.fromStack(stack).toJSON()
}

/** The published set with every token filled as an API Portal fills it: nothing is left for the Provider to type. */
const servedSet = (values: { externalId?: string; poolId?: string } = {}): ConsoleInstructionSet =>
  JSON.parse(
    publishedSetText()
      .split(REGION_TOKEN).join(REGION)
      .split(TRUST_ACCOUNT_TOKEN).join(DEFAULT_APIABLE_TRUST_ACCOUNT)
      .split(EXTERNAL_ID_TOKEN).join(values.externalId ?? ISSUED_ID)
      .split(USER_POOL_ID_TOKEN).join(values.poolId ?? POOL_ID),
  ) as ConsoleInstructionSet

/**
 * The published set as the parity gate compares it: Region and trusted account filled, as for any deployment,
 * and the deploy-time values (the ID and the pool) left as their named places.
 */
const gateSet = (): ConsoleInstructionSet =>
  JSON.parse(publishedSetText().split(REGION_TOKEN).join(REGION).split(TRUST_ACCOUNT_TOKEN).join(DEFAULT_APIABLE_TRUST_ACCOUNT)) as ConsoleInstructionSet

const tfResourceValues = (plan: unknown, type: string): Record<string, unknown> => {
  const matches = asArray(asRecord(asRecord(asRecord(plan).planned_values).root_module).resources)
    .map(asRecord)
    .filter((resource) => resource.type === type)
  expect(matches).toHaveLength(1)
  return asRecord(matches[0].values)
}

const launch = (template: unknown, parameters: Record<string, string>, region = REGION): ResolvedRole | undefined =>
  launchedRole(template, { region, account: PROVIDER_ACCOUNT, parameters })

/** Each channel's role for the one pool, deployed with the issued ID and the address left at its default. */
const roleFrom = (channel: RoleChannel): ResolvedRole => {
  const role = ((): ResolvedRole | undefined => {
    switch (channel) {
      case 'one-click stack':
        return launch(publishedYaml(), { [EXTERNAL_ID_PARAMETER]: ISSUED_ID, [USER_POOL_ID_PARAMETER]: POOL_ID })
      case 'Terraform module':
        return {
          trust: JSON.parse(String(tfResourceValues(terraformPlan(), 'aws_iam_role').assume_role_policy)),
          permissions: JSON.parse(String(tfResourceValues(terraformPlan(), 'aws_iam_role_policy').policy)),
        }
      case 'hand-build instructions': {
        const set = servedSet()
        return { trust: set.trustDocument, permissions: set.permissionDocument }
      }
      case 'construct used directly':
        return launch(directTemplate(), { [EXTERNAL_ID_PARAMETER]: ISSUED_ID })
    }
  })()
  if (role === undefined) throw new Error(`the ${channel} created no role`)
  return role
}

/** A call made with a role deployed in the Provider's account, from `sourceIp` (absent: the call carries no address). */
const call = (action: string, resource: string, sourceIp?: string, principalAccount = PROVIDER_ACCOUNT): CallRequest => ({
  action,
  resource,
  principalAccount,
  ...(sourceIp === undefined ? {} : { sourceIp }),
})
const fromApiable = (action: string, resource: string): CallRequest => call(action, resource, APIABLE_ADDRESS)

/** Requests the role must refuse even from Apiable's address. */
const REFUSED_REQUESTS: readonly (readonly [string, string, string])[] = [
  ["list the pool's app clients", 'cognito-idp:ListUserPoolClients', poolArn(POOL_ID)],
  ['read the pool itself', 'cognito-idp:DescribeUserPool', poolArn(POOL_ID)],
  ['add a client secret', 'cognito-idp:AddUserPoolClientSecret', poolArn(POOL_ID)],
  ["list a client's secrets", 'cognito-idp:ListUserPoolClientSecrets', poolArn(POOL_ID)],
  ['remove a client secret', 'cognito-idp:DeleteUserPoolClientSecret', poolArn(POOL_ID)],
  ['create a resource server', 'cognito-idp:CreateResourceServer', poolArn(POOL_ID)],
  ['update a resource server', 'cognito-idp:UpdateResourceServer', poolArn(POOL_ID)],
  ['delete a resource server', 'cognito-idp:DeleteResourceServer', poolArn(POOL_ID)],
  ['create a user', 'cognito-idp:AdminCreateUser', poolArn(POOL_ID)],
  ['sign a user in as an administrator', 'cognito-idp:AdminInitiateAuth', poolArn(POOL_ID)],
  ['change the pool', 'cognito-idp:UpdateUserPool', poolArn(POOL_ID)],
  ['list every pool in the account', 'cognito-idp:ListUserPools', '*'],
  ...APP_CLIENT_ACTIONS.map((action) => [`${action} on a second pool in the same account`, action, poolArn(SECOND_POOL_ID)] as const),
  ...APP_CLIENT_ACTIONS.map((action) => [`${action} on the same pool id in another Region`, action, poolArn(POOL_ID, 'us-east-1')] as const),
  ...APP_CLIENT_ACTIONS.map((action) => [`${action} on the same pool id in another account`, action, poolArn(POOL_ID, REGION, ANOTHER_ACCOUNT)] as const),
  ['read an S3 object', 's3:GetObject', 'arn:aws:s3:::any-bucket/any-key'],
  ['create an IAM role', 'iam:CreateRole', `arn:aws:iam::${PROVIDER_ACCOUNT}:role/any`],
  ['assume another role', 'sts:AssumeRole', `arn:aws:iam::${PROVIDER_ACCOUNT}:role/any`],
  ['get credentials for an identity', 'cognito-identity:GetCredentialsForIdentity', '*'],
]

describe('S2: the role can do the five operations on the one pool and nothing else, on every channel', () => {
  // contract: S2
  it.each(ROLE_CHANNELS)('the role from the %s allows the five operations on the named pool from Apiable’s address', (channel) => {
    const { permissions } = roleFrom(channel)
    for (const action of APP_CLIENT_ACTIONS) expect([action, mayCall(permissions, fromApiable(action, poolArn(POOL_ID)))]).toEqual([action, true])
  })

  // contract: S2
  it.each(ROLE_CHANNELS)('the role from the %s refuses every other request, from Apiable’s address', (channel) => {
    const { permissions } = roleFrom(channel)
    for (const [label, action, resource] of REFUSED_REQUESTS) {
      expect([label, mayCall(permissions, fromApiable(action, resource))]).toEqual([label, false])
    }
  })

  // contract: S2
  it.each(ROLE_CHANNELS)('the role from the %s names exactly the five operations and nothing wider', (channel) => {
    const allowed = asArray(asRecord(roleFrom(channel).permissions).Statement)
      .map(asRecord)
      .filter((statement) => statement.Effect === 'Allow')
    expect(allowed).toHaveLength(1)
    expect([...asArray(allowed[0].Action)].sort()).toEqual([...APP_CLIENT_ACTIONS].sort())
    // The hand-build set names the account by the policy variable, which AWS resolves to the account the role is in.
    expect(allowed[0].Resource).toBe(channel === 'hand-build instructions' ? poolArn(POOL_ID, REGION, PRINCIPAL_ACCOUNT_VARIABLE) : poolArn(POOL_ID))
  })

  // contract: S2
  it('the hand-build instructions name the pool’s account by the policy variable, there and nowhere else, so the API Portal fills every other place', () => {
    const published = JSON.parse(publishedSetText()) as ConsoleInstructionSet
    const allow = allowStatement(asRecord(published.permissionDocument))

    expect(allow.Resource).toBe(poolArn(USER_POOL_ID_TOKEN, REGION_TOKEN, PRINCIPAL_ACCOUNT_VARIABLE))
    expect(publishedSetText().split(PRINCIPAL_ACCOUNT_VARIABLE)).toHaveLength(2)
    expect(publishedSetText()).not.toContain(ACCOUNT_TOKEN)
  })

  // contract: S2
  it('the one-click stack, the module and the construct name the pool’s account as the account they deploy in, never by the variable', () => {
    for (const artifact of [JSON.stringify(publishedTemplate()), JSON.stringify(directTemplate()), JSON.stringify(terraformPlan())]) {
      expect(artifact).not.toContain(PRINCIPAL_ACCOUNT_VARIABLE)
    }
    for (const channel of ['one-click stack', 'Terraform module', 'construct used directly'] as const) {
      expect([channel, allowStatement(asRecord(roleFrom(channel).permissions)).Resource]).toEqual([channel, poolArn(POOL_ID)])
    }
  })

  // contract: S2
  it('a role built by hand in another account reaches that account’s pool only, never the same pool id in the account the set was read for', () => {
    const { permissions } = roleFrom('hand-build instructions')
    for (const action of APP_CLIENT_ACTIONS) {
      expect(mayCall(permissions, call(action, poolArn(POOL_ID, REGION, ANOTHER_ACCOUNT), APIABLE_ADDRESS, ANOTHER_ACCOUNT))).toBe(true)
      expect(mayCall(permissions, call(action, poolArn(POOL_ID), APIABLE_ADDRESS, ANOTHER_ACCOUNT))).toBe(false)
    }
  })

  // contract: S2
  it('the explicit Deny keeps a wider Allow added later from reaching anything but the five operations', () => {
    const { permissions } = roleFrom('one-click stack')
    const widened = clone(asRecord(permissions))
    widened.Statement = [...asArray(widened.Statement), { Effect: 'Allow', Action: 'cognito-idp:*', Resource: '*' }]

    for (const [label, action, resource] of REFUSED_REQUESTS.filter(([, action]) => !APP_CLIENT_ACTIONS.includes(action))) {
      expect([label, mayCall(widened, fromApiable(action, resource))]).toEqual([label, false])
    }
  })
})

describe('S3: the trust admits only the ID the role was deployed with, on every channel', () => {
  // contract: S3
  it.each(ROLE_CHANNELS)('the role from the %s admits Apiable’s account with that ID and refuses every other request', (channel) => {
    const { trust } = roleFrom(channel)

    expect(mayAssume(trust, { account: DEFAULT_APIABLE_TRUST_ACCOUNT, externalId: ISSUED_ID })).toBe(true)
    expect(mayAssume(trust, { account: DEFAULT_APIABLE_TRUST_ACCOUNT })).toBe(false)
    expect(mayAssume(trust, { account: DEFAULT_APIABLE_TRUST_ACCOUNT, externalId: ANOTHER_PORTALS_ID })).toBe(false)
    expect(mayAssume(trust, { account: DEFAULT_APIABLE_TRUST_ACCOUNT, externalId: FRESH_RANDOM_ID })).toBe(false)
    expect(mayAssume(trust, { account: DEFAULT_APIABLE_TRUST_ACCOUNT, externalId: '' })).toBe(false)
    expect(mayAssume(trust, { account: ANOTHER_ACCOUNT, externalId: ISSUED_ID })).toBe(false)
    expect(mayAssume(trust, { account: PROVIDER_ACCOUNT, externalId: ISSUED_ID })).toBe(false)
  })
})

describe('S4: the ID cannot be left out, widened or defaulted', () => {
  const BAD_IDS: readonly (readonly [string, string | undefined])[] = [
    ['no ID', undefined],
    ['a blank ID', ''],
    ['a wildcard', '*'],
    ['a list of IDs', `${ISSUED_ID},${ANOTHER_PORTALS_ID}`],
    ['an uppercase UUID', ISSUED_ID.toUpperCase()],
    ['a UUID that is not version 4', 'a1b2c3d4-e5f6-1a7b-8c9d-0e1f2a3b4c5d'],
    ['a value not shaped like an ID', 'my-portal'],
  ]
  const BAD_ACCOUNTS: readonly (readonly [string, string])[] = [
    ['a wildcard', '*'],
    ['a list', `${DEFAULT_APIABLE_TRUST_ACCOUNT},${ANOTHER_ACCOUNT}`],
    ['an account root ARN', `arn:aws:iam::${DEFAULT_APIABLE_TRUST_ACCOUNT}:root`],
    ['eleven digits', '12345678901'],
  ]
  const TEMPLATES: readonly (readonly [string, () => unknown, Record<string, string>])[] = [
    ['the one-click stack as published', publishedYaml, { [USER_POOL_ID_PARAMETER]: POOL_ID }],
    ['the construct used directly', () => directTemplate(), {}],
  ]

  // contract: S4
  it.each(TEMPLATES)('%s declares the ID with no default', (_label, template) => {
    const parameter = asRecord(asRecord(asRecord(template()).Parameters)[EXTERNAL_ID_PARAMETER])
    expect(parameter.Type).toBe('String')
    expect(parameter).not.toHaveProperty('Default')
  })

  // contract: S4
  it.each(TEMPLATES)('%s creates no role for a bad ID', (_label, template, others) => {
    for (const [label, value] of BAD_IDS) {
      const parameters = value === undefined ? others : { ...others, [EXTERNAL_ID_PARAMETER]: value }
      expect([label, launch(template(), parameters)]).toEqual([label, undefined])
    }
  })

  // contract: S4
  it.each(TEMPLATES)('%s creates no role that trusts anything but exactly one account', (_label, template, others) => {
    for (const [label, value] of BAD_ACCOUNTS) {
      expect([label, launch(template(), { ...others, [EXTERNAL_ID_PARAMETER]: ISSUED_ID, ApiableTrustAccount: value })]).toEqual([label, undefined])
    }
  })

  // contract: S4
  it('the construct used directly refuses at synth a trusted account that is not exactly one account', () => {
    for (const [, value] of BAD_ACCOUNTS) {
      const stack = new cdk.Stack(new cdk.App(), 'S', { env: { account: PROVIDER_ACCOUNT, region: REGION } })
      expect(() => new CognitoPoolRole(stack, 'R', { userPoolId: POOL_ID, trustAccount: value })).toThrow(/exactly one 12-digit AWS account id/)
    }
  })

  // contract: S4
  it('the module is held by the engine to refuse each bad ID, account and pool id, by the script CI runs on it', () => {
    const script = fs.readFileSync(path.join(REPO_ROOT, 'check-cognito-pool-role-module.sh'), 'utf8')
    for (const kind of [
      'a wildcard trust_account',
      'a list of two trust accounts',
      'a trust_account given as an ARN',
      'an 11-digit trust_account',
      'a plan with no external_id',
      'a blank external_id',
      'a wildcard external_id',
      'a list of two external IDs',
      'an uppercase external_id',
      'an external_id that is not a version 4 UUID',
      'an external_id not shaped like an ID',
      'a plan with no user_pool_id',
      'a malformed user_pool_id',
    ]) {
      expect(script).toContain(`refused "${kind}"`)
    }
    const variables = fs.readFileSync(path.join(REPO_ROOT, `terraform/${CONSTRUCT}/variables.tf`), 'utf8')
    const externalId = /variable "external_id" \{[\s\S]*?\n\}/.exec(variables)?.[0] ?? ''
    expect(externalId).not.toBe('')
    expect(externalId).not.toMatch(/\bdefault\s*=/)
    for (const workflow of ['build.yml', 'parity-gate.yml']) {
      expect(fs.readFileSync(path.join(REPO_ROOT, '.github/workflows', workflow), 'utf8')).toContain(`bash check-cognito-pool-role-module.sh terraform/${CONSTRUCT}`)
    }
    // The script is held to each refusal by changed copies of the module, which the parity workflow runs.
    expect(fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/parity-gate.yml'), 'utf8')).toContain('bash test-check-cognito-pool-role-module.sh')
  })

  // contract: S4
  it('the published hand-build instructions carry a named place for the ID on every trust statement, and no trust without it', () => {
    const published = JSON.parse(publishedSetText()) as ConsoleInstructionSet
    const statements = asArray(asRecord(published.trustDocument).Statement).map(asRecord)

    expect(statements.length).toBeGreaterThan(0)
    for (const statement of statements) expect(statement.Condition).toEqual({ StringEquals: { 'sts:ExternalId': EXTERNAL_ID_TOKEN } })
  })

  // contract: S4
  it('the generator writes no hand-build set from a template whose trust does not require the ID', () => {
    const withoutCondition = clone(asRecord(publishedTemplate()))
    for (const resource of Object.values(asRecord(withoutCondition.Resources)).map(asRecord)) {
      if (resource.Type !== 'AWS::IAM::Role') continue
      for (const statement of asArray(asRecord(asRecord(resource.Properties).AssumeRolePolicyDocument).Statement)) delete asRecord(statement).Condition
    }
    const defaulted = clone(asRecord(publishedTemplate()))
    asRecord(asRecord(defaulted.Parameters)[EXTERNAL_ID_PARAMETER]).Default = ISSUED_ID

    expect(() => generatePoolRoleConsoleInstructionTemplate(withoutCondition, currentVersion(), currentVersion())).toThrow(/requires the external ID/)
    expect(() => generatePoolRoleConsoleInstructionTemplate(defaulted, currentVersion(), currentVersion())).toThrow(/requires the external ID/)
  })
})

describe('S5: no version of the role works without the ID', () => {
  /** Every version published or offered: this repository publishes the current one, and none before it. */
  const everyVersion = (): string[] => [currentVersion()]

  // contract: S5
  it('every version is one that requires the ID, by the rule the publish step and the verifier apply', () => {
    for (const version of [...everyVersion(), '1.0.0', '2.0.0', '0.0.1']) expect(requiresExternalIdFor(CONSTRUCT, version)).toBe(true)
  })

  // contract: S5
  it.each(ROLE_CHANNELS)('the role from the %s, at every version, refuses a request with no ID', (channel) => {
    expect(everyVersion()).toEqual([currentVersion()])
    expect(mayAssume(roleFrom(channel).trust, { account: DEFAULT_APIABLE_TRUST_ACCOUNT })).toBe(false)
  })
})

describe('S6: requests from outside Apiable’s address are refused', () => {
  // contract: S6
  it.each(ROLE_CHANNELS)('the role from the %s, at its default address, refuses each of the five operations from another address', (channel) => {
    const { permissions } = roleFrom(channel)
    for (const action of APP_CLIENT_ACTIONS) {
      expect([action, mayCall(permissions, call(action, poolArn(POOL_ID), ANOTHER_ADDRESS))]).toEqual([action, false])
    }
  })

  // contract: S6
  it.each(ROLE_CHANNELS)('the role from the %s refuses each of the five operations on a call that carries no source address', (channel) => {
    const { permissions } = roleFrom(channel)
    for (const action of APP_CLIENT_ACTIONS) {
      expect([action, mayCall(permissions, call(action, poolArn(POOL_ID)))]).toEqual([action, false])
    }
  })

  // contract: S6
  it('the stand-in applies a Deny whose negated condition names a key the request does not carry, as AWS does', () => {
    const permissions = {
      Statement: [
        { Effect: 'Allow', Action: '*', Resource: '*' },
        { Effect: 'Deny', Action: '*', Resource: '*', Condition: { NotIpAddress: { 'aws:SourceIp': `${APIABLE_ADDRESS}/32` } } },
      ],
    }
    const trust = {
      Statement: [
        { Effect: 'Allow', Action: 'sts:AssumeRole', Principal: { AWS: DEFAULT_APIABLE_TRUST_ACCOUNT } },
        { Effect: 'Deny', Action: 'sts:AssumeRole', Principal: { AWS: DEFAULT_APIABLE_TRUST_ACCOUNT }, Condition: { StringNotEquals: { 'sts:ExternalId': ISSUED_ID } } },
      ],
    }

    expect(mayCall(permissions, fromApiable('s3:GetObject', '*'))).toBe(true)
    expect(mayCall(permissions, call('s3:GetObject', '*'))).toBe(false)
    expect(mayAssume(trust, { account: DEFAULT_APIABLE_TRUST_ACCOUNT, externalId: ISSUED_ID })).toBe(true)
    expect(mayAssume(trust, { account: DEFAULT_APIABLE_TRUST_ACCOUNT })).toBe(false)
  })

  // contract: S6
  it('the default address is Apiable’s published one in the template, the module and the hand-build instructions', () => {
    expect(asRecord(asRecord(asRecord(publishedYaml()).Parameters).ApiableEgressCidr).Default).toBe(DEFAULT_APIABLE_EGRESS_CIDR)
    expect(asString(asRecord(asRecord(asRecord(terraformPlan()).variables).egress_cidr).value)).toBe(DEFAULT_APIABLE_EGRESS_CIDR)
    expect((JSON.parse(publishedSetText()) as ConsoleInstructionSet).egressCidr).toBe(DEFAULT_APIABLE_EGRESS_CIDR)
  })

  // contract: S6
  it.each<readonly [string, () => unknown, Record<string, string>]>([
    ['the one-click stack', publishedYaml, { [USER_POOL_ID_PARAMETER]: POOL_ID }],
    ['the construct used directly', () => directTemplate(), {}],
  ])('a Provider can set another address at deploy time through %s, and then only that address works', (_label, template, others) => {
    const role = launch(template(), { ...others, [EXTERNAL_ID_PARAMETER]: ISSUED_ID, ApiableEgressCidr: `${ANOTHER_ADDRESS}/32` })
    if (role === undefined) throw new Error('no role was created')
    for (const action of APP_CLIENT_ACTIONS) {
      expect(mayCall(role.permissions, call(action, poolArn(POOL_ID), ANOTHER_ADDRESS))).toBe(true)
      expect(mayCall(role.permissions, fromApiable(action, poolArn(POOL_ID)))).toBe(false)
    }
  })
})

// ── The parity gate across the four channels ──────────────────────────────────────────────────────
type PolicyEdit = (document: Record<string, unknown>) => void
type Edits = { readonly trust?: PolicyEdit; readonly permissions?: PolicyEdit }

const editCfn = (template: unknown, edits: Edits): unknown => {
  const copy = clone(asRecord(template))
  for (const resource of Object.values(asRecord(copy.Resources)).map(asRecord)) {
    const properties = asRecord(resource.Properties)
    if (resource.Type === 'AWS::IAM::Role' && edits.trust) edits.trust(asRecord(properties.AssumeRolePolicyDocument))
    if (resource.Type === 'AWS::IAM::Policy' && edits.permissions) edits.permissions(asRecord(properties.PolicyDocument))
  }
  return copy
}
const editPlan = (plan: unknown, edits: Edits): unknown => {
  const copy = clone(plan)
  const edit = (type: string, key: string, apply?: PolicyEdit): void => {
    if (apply === undefined) return
    const values = tfResourceValues(copy, type)
    const document = JSON.parse(String(values[key])) as Record<string, unknown>
    apply(document)
    values[key] = JSON.stringify(document)
  }
  edit('aws_iam_role', 'assume_role_policy', edits.trust)
  edit('aws_iam_role_policy', 'policy', edits.permissions)
  return copy
}
const editSet = (set: ConsoleInstructionSet, edits: Edits): ConsoleInstructionSet => {
  const copy = clone(set) as unknown as Record<string, unknown>
  if (edits.trust) edits.trust(asRecord(copy.trustDocument))
  if (edits.permissions) edits.permissions(asRecord(copy.permissionDocument))
  return copy as unknown as ConsoleInstructionSet
}

const cdkModel = (template: unknown = cdkTemplate()): ChannelModel => reduceCloudFormation(template, 'cdk')
const cfnModel = (template: unknown = publishedTemplate()): ChannelModel => reduceCloudFormation(template, 'cfn')
const tfModel = (plan: unknown = terraformPlan(), region = REGION): ChannelModel => reduceTerraformShowJson(plan, 'terraform', region)
const consoleModel = (set: ConsoleInstructionSet = gateSet()): ChannelModel => reduceConsoleInstructions(set, REGION)

const fourChannels = (replaced: Partial<Record<Channel, ChannelModel>> = {}): ChannelModel[] => [
  replaced.cdk ?? cdkModel(),
  replaced.cfn ?? cfnModel(),
  replaced.terraform ?? tfModel(),
  replaced.console ?? consoleModel(),
]
const withEditIn = (channel: Channel, edits: Edits): ChannelModel[] => {
  switch (channel) {
    case 'cdk':
      return fourChannels({ cdk: cdkModel(editCfn(cdkTemplate(), edits)) })
    case 'cfn':
      return fourChannels({ cfn: cfnModel(editCfn(publishedTemplate(), edits)) })
    case 'terraform':
      return fourChannels({ terraform: tfModel(editPlan(terraformPlan(), edits)) })
    case 'console':
      return fourChannels({ console: consoleModel(editSet(gateSet(), edits)) })
  }
}

const statementsIn = (document: Record<string, unknown>): Record<string, unknown>[] => asArray(document.Statement).map(asRecord)
const allowStatement = (document: Record<string, unknown>): Record<string, unknown> => {
  const allows = statementsIn(document).filter((statement) => statement.Effect === 'Allow')
  if (allows.length !== 1) throw new Error(`expected one Allow, found ${allows.length}`)
  return allows[0]
}
const statementWithSid = (document: Record<string, unknown>, sid: string): Record<string, unknown> => {
  const found = statementsIn(document).find((statement) => statement.Sid === sid)
  if (found === undefined) throw new Error(`no statement ${sid}`)
  return found
}
/** The pool the Allow names, swapped for a second pool however this channel spells the first. */
const namingAnotherPool: PolicyEdit = (document) => {
  const allow = allowStatement(document)
  allow.Resource = JSON.parse(JSON.stringify(allow.Resource).split(POOL_ID).join(SECOND_POOL_ID).split(USER_POOL_ID_TOKEN).join(SECOND_POOL_ID).split(`{"Ref":"${USER_POOL_ID_PARAMETER}"}`).join(`"${SECOND_POOL_ID}"`))
}
const PRINCIPAL_ACCOUNT_SWAP = (statement: Record<string, unknown>): void => {
  statement.Principal = JSON.parse(
    JSON.stringify(statement.Principal).split(DEFAULT_APIABLE_TRUST_ACCOUNT).join(ANOTHER_ACCOUNT).split(`{"Ref":"ApiableTrustAccount"}`).join(`"${ANOTHER_ACCOUNT}"`),
  )
}

const DIVERGENCES: readonly (readonly [string, Edits])[] = [
  ['allows a sixth operation', { permissions: (document) => void (allowStatement(document).Action = [...asArray(allowStatement(document).Action), 'cognito-idp:ListUserPoolClients']) }],
  ['allows one operation fewer', { permissions: (document) => void (allowStatement(document).Action = asArray(allowStatement(document).Action).slice(1)) }],
  ['names another pool', { permissions: namingAnotherPool }],
  ['drops the explicit Deny', { permissions: (document) => void (document.Statement = statementsIn(document).filter((statement) => statement.Sid !== 'DenyAllButAppClientOperations')) }],
  ['excepts a sixth operation from the explicit Deny', { permissions: (document) => void (statementWithSid(document, 'DenyAllButAppClientOperations').NotAction = [...APP_CLIENT_ACTIONS, 'cognito-idp:DescribeUserPool']) }],
  ['drops the address rule', { permissions: (document) => void (document.Statement = statementsIn(document).filter((statement) => statement.Sid !== 'DenyOutsideApiableEgress')) }],
  ['pins another address', { permissions: (document) => void (statementWithSid(document, 'DenyOutsideApiableEgress').Condition = { NotIpAddress: { 'aws:SourceIp': `${ANOTHER_ADDRESS}/32` } }) }],
  ['trusts another account', { trust: (document) => statementsIn(document).forEach(PRINCIPAL_ACCOUNT_SWAP) }],
  ['drops the trust condition', { trust: (document) => statementsIn(document).forEach((statement) => delete statement.Condition) }],
  ['requires a literal ID in place of the deployed one', { trust: (document) => statementsIn(document).forEach((statement) => void (statement.Condition = { StringEquals: { 'sts:ExternalId': ANOTHER_PORTALS_ID } })) }],
]

describe('S7: the release fails when the channels disagree', () => {
  // contract: S7
  it('the four channels as they ship reduce to one role and the parity gate passes', () => {
    const result = gate(fourChannels())

    expect(result.divergences).toEqual([])
    expect(result.passed).toBe(true)
  })

  // contract: S7
  it.each(DIVERGENCES.flatMap(([label, edits]) => (['cdk', 'cfn', 'terraform', 'console'] as const).map((channel) => [channel, label, edits] as const)))(
    'fails when the %s channel alone %s, naming that channel',
    (channel, _label, edits) => {
      const result = gate(withEditIn(channel, edits))

      expect(result.passed).toBe(false)
      expect([...new Set(result.divergences.flatMap((divergence) => divergence.channels))]).toEqual([channel])
    },
  )

  // contract: S7
  it.each<readonly [string, Edits]>([
    ['names the trusted account by the policy variable', { trust: (document) => statementsIn(document).forEach((statement) => void (statement.Principal = { AWS: `arn:aws:iam::${PRINCIPAL_ACCOUNT_VARIABLE}:root` })) }],
    ['names the pool’s Region by the policy variable', { permissions: (document) => void (allowStatement(document).Resource = poolArn(USER_POOL_ID_TOKEN, PRINCIPAL_ACCOUNT_VARIABLE, PRINCIPAL_ACCOUNT_VARIABLE)) }],
    ['names the pool itself by the policy variable', { permissions: (document) => void (allowStatement(document).Resource = poolArn(PRINCIPAL_ACCOUNT_VARIABLE, REGION, PRINCIPAL_ACCOUNT_VARIABLE)) }],
    ['scopes the address rule by the policy variable', { permissions: (document) => void (statementWithSid(document, 'DenyOutsideApiableEgress').Resource = `arn:aws:cognito-idp:*:${PRINCIPAL_ACCOUNT_VARIABLE}:*`) }],
  ])('fails when the hand-build set %s: the variable stands for the deploying account in the pool’s account part only', (_label, edits) => {
    const result = gate(withEditIn('console', edits))

    expect(result.passed).toBe(false)
    expect([...new Set(result.divergences.flatMap((divergence) => divergence.channels))]).toEqual(['console'])
  })

  // contract: S7
  it('the module trusts Apiable’s account by default, the same account the one-click stack and the construct default to', () => {
    const variables = fs.readFileSync(path.join(REPO_ROOT, `terraform/${CONSTRUCT}/variables.tf`), 'utf8')
    const block = /variable "trust_account" \{[\s\S]*?\n\}/.exec(variables)?.[0] ?? ''
    const moduleDefault = /\bdefault\s*=\s*"([^"]*)"/.exec(block)?.[1]

    expect(moduleDefault).toBe(DEFAULT_APIABLE_TRUST_ACCOUNT)
    expect(asRecord(asRecord(asRecord(publishedYaml()).Parameters).ApiableTrustAccount).Default).toBe(DEFAULT_APIABLE_TRUST_ACCOUNT)
    expect(asRecord(asRecord(asRecord(directTemplate()).Parameters).ApiableTrustAccount).Default).toBe(DEFAULT_APIABLE_TRUST_ACCOUNT)
  })

  // contract: S7
  it('the explicit Deny reaches the gate as everything but the five operations, never as the five', () => {
    const denies = cfnModel().grants.filter((grant) => grant.effect === 'Deny' && grant.notActions !== undefined)

    expect(denies).toHaveLength(1)
    expect(denies[0].actions).toEqual([])
    expect([...(denies[0].notActions ?? [])]).toEqual([...APP_CLIENT_ACTIONS].sort())
  })
})

describe('S8: the comparison is the same whatever the role is named', () => {
  const inAnotherAccountAndRegion = (): unknown =>
    JSON.parse(JSON.stringify(terraformPlan()).split(PROVIDER_ACCOUNT).join('999988887777').split('eu-central-1').join('us-west-2'))

  // contract: S8
  it('a role deployed into another account and Region, under another name, compares as the same role', () => {
    const renamed = { ...gateSet(), roleName: 'a-role-the-provider-named-themselves' }
    const result = gate(fourChannels({ terraform: tfModel(inAnotherAccountAndRegion(), 'us-west-2'), console: consoleModel(renamed) }))

    expect(result.divergences).toEqual([])
    expect(result.passed).toBe(true)
  })

  // contract: S8
  it('a difference in content still fails under another name, account and Region', () => {
    const widened = editPlan(inAnotherAccountAndRegion(), DIVERGENCES[0][1])

    expect(gate(fourChannels({ terraform: tfModel(widened, 'us-west-2') })).passed).toBe(false)
  })

  // contract: S8
  it('the account the role trusts is still compared by value', () => {
    const models = withEditIn('terraform', DIVERGENCES[7][1])
    const divergence = gate(models).divergences.find((entry) => entry.tier === 'value' && entry.detail.includes('role-trust-account'))

    expect(divergence?.channels).toEqual(['terraform'])
  })

  // contract: S8
  it('every channel keys the role on its declared identity', () => {
    for (const model of fourChannels()) {
      expect(model.graph.nodes.map((node) => node.ref)).toContain(`iam-role:${COGNITO_POOL_ROLE_LOGICAL_ID}`)
    }
  })
})

// The fetch without credentials, the stopped release and the write-once store are shown on this construct's
// synthesized artifacts by test-verify-launchstack-published.sh, against the real verifier and publish guard.
describe('S12: the published version is reachable by anyone and never overwritten', () => {
  // contract: S12
  it('the synth writes the template, the module archive and the hand-build set at the current version', () => {
    for (const file of ['template.yaml', 'terraform.zip', 'console-instructions.json']) {
      expect(fs.existsSync(path.join(publishedDir(), file))).toBe(true)
    }
    const listing = spawnSync('unzip', ['-Z1', path.join(publishedDir(), 'terraform.zip')], { encoding: 'utf8' })
    expect(listing.status).toBe(0)
    expect(listing.stdout.split('\n').filter(Boolean).sort()).toEqual(['README.md', 'main.tf', 'outputs.tf', 'variables.tf', 'versions.tf'])
  })

  // contract: S12
  it('the published set names this construct and version and carries every token the serving portal fills', () => {
    const published = JSON.parse(publishedSetText()) as ConsoleInstructionSet

    expect([published.construct, published.version]).toEqual([CONSTRUCT, currentVersion()])
    for (const token of [REGION_TOKEN, TRUST_ACCOUNT_TOKEN, EXTERNAL_ID_TOKEN, USER_POOL_ID_TOKEN]) expect(publishedSetText()).toContain(token)
    expect(published.userPoolId).toBe(USER_POOL_ID_TOKEN)
  })

  // contract: S12
  it('the job that publishes runs the engine checks on this module before the synth and the upload', () => {
    const workflow = yaml.load(fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/build.yml'), 'utf8')) as {
      jobs: Record<string, { steps?: { run?: string }[] }>
    }
    const job = Object.values(workflow.jobs).find((candidate) => candidate.steps?.some((step) => step.run?.includes('publish-launchstack.sh')))
    const steps = job?.steps ?? []
    const engineChecks = steps.findIndex((step) => step.run?.trim() === `bash check-cognito-pool-role-module.sh terraform/${CONSTRUCT}`)
    const synth = steps.findIndex((step) => step.run?.includes('synth-all-launchstack.sh'))

    expect(engineChecks).not.toBe(-1)
    expect(synth).toBeGreaterThan(engineChecks)
  })
})

describe('S14: a kit pool and an existing pool alike, and the pool is left untouched', () => {
  const resourceTypes = (template: unknown): string[] =>
    Object.values(asRecord(asRecord(template).Resources)).map((resource) => String(asRecord(resource).Type)).sort()

  // contract: S14
  it('every channel creates the role and its policy and nothing else', () => {
    expect(resourceTypes(publishedYaml())).toEqual(['AWS::IAM::Policy', 'AWS::IAM::Role'])
    expect(resourceTypes(directTemplate())).toEqual(['AWS::IAM::Policy', 'AWS::IAM::Role'])
    const planned = asArray(asRecord(asRecord(asRecord(terraformPlan()).planned_values).root_module).resources).map((resource) => asRecord(resource).type)
    expect([...planned].sort()).toEqual(['aws_iam_role', 'aws_iam_role_policy'])
    const published = JSON.parse(publishedSetText()) as ConsoleInstructionSet
    expect(Object.keys(published).sort()).toEqual(
      ['construct', 'version', 'region', 'roleName', 'trustAccount', 'trustDocument', 'permissionDocument', 'egressCidr', 'userPoolId', 'parameterDefaults'].sort(),
    )
  })

  // contract: S14
  it('no channel attaches any other policy to the role, so the one Allow is the only grant', () => {
    for (const template of [publishedYaml(), directTemplate()]) {
      for (const resource of Object.values(asRecord(asRecord(template).Resources)).map(asRecord)) {
        if (resource.Type !== 'AWS::IAM::Role') continue
        expect(asRecord(resource.Properties)).not.toHaveProperty('ManagedPolicyArns')
        expect(asRecord(resource.Properties)).not.toHaveProperty('Policies')
      }
    }
    const role = tfResourceValues(terraformPlan(), 'aws_iam_role')
    for (const key of ['managed_policy_arns', 'inline_policy']) {
      expect([key, asArray(role[key] ?? []).length]).toEqual([key, 0])
    }
    const set = JSON.parse(publishedSetText()) as Record<string, unknown>
    expect(Object.keys(set).filter((key) => /managed|attach/i.test(key))).toEqual([])
  })

  // contract: S14
  it.each([
    ['a pool the Provider created themselves', POOL_ID],
    ['a pool with a longer Region and suffix', 'ap-southeast-4_Z9y8X7w6V'],
  ])('the one-click stack takes %s', (_label, poolId) => {
    const region = poolId.split('_')[0]
    const role = launch(publishedYaml(), { [EXTERNAL_ID_PARAMETER]: ISSUED_ID, [USER_POOL_ID_PARAMETER]: poolId }, region)
    if (role === undefined) throw new Error('no role was created')
    for (const action of APP_CLIENT_ACTIONS) expect(mayCall(role.permissions, fromApiable(action, poolArn(poolId, region)))).toBe(true)
  })

  // contract: S14
  it('the construct takes a pool from the kit in the same stack, and adds nothing to the pool', () => {
    const kitOnly = (withRole: boolean): unknown => {
      const stack = new cdk.Stack(new cdk.App(), 'Kit', { env: { account: PROVIDER_ACCOUNT, region: REGION } })
      const kit = new CognitoPool(stack, 'Pool', { name: 'acme', featurePlan: 'ESSENTIALS' })
      if (withRole) new CognitoPoolRole(stack, 'PoolRole', { userPoolId: kit.pool.userPoolId })
      return Template.fromStack(stack).toJSON()
    }
    const outsideTheRole = (template: unknown): Record<string, unknown> =>
      Object.fromEntries(
        Object.entries(asRecord(asRecord(template).Resources)).filter(([id]) => !id.startsWith('PoolRole')),
      )

    expect(outsideTheRole(kitOnly(true))).toEqual(outsideTheRole(kitOnly(false)))
    expect(resourceTypes({ Resources: Object.fromEntries(Object.entries(asRecord(asRecord(kitOnly(true)).Resources)).filter(([id]) => id.startsWith('PoolRole'))) })).toEqual([
      'AWS::IAM::Policy',
      'AWS::IAM::Role',
    ])
  })

  // contract: S14
  it('the one-click stack refuses a value that is not one pool id', () => {
    for (const value of ['', '*', `${POOL_ID},${SECOND_POOL_ID}`, 'eu-central-1', 'AbCdEfGhI', 'eu-central-1_Ab/Cd', `eu-central-1_${'a'.repeat(40)}`]) {
      expect([value, refusedParameters(publishedYaml(), { [EXTERNAL_ID_PARAMETER]: ISSUED_ID, [USER_POOL_ID_PARAMETER]: value }).length > 0]).toEqual([value, true])
    }
  })
})

describe('S16: a pool from another Region is refused where the channel can tell', () => {
  // contract: S16
  it('the construct used with a pool id and a Region both known refuses a pool from another Region, and makes no role', () => {
    expect(() => directTemplate({ userPoolId: 'us-west-2_AbCdEfGhI' })).toThrow(/names another Region/)
  })

  // contract: S16
  it('the construct accepts a pool id that is not known until deployment', () => {
    const stack = new cdk.Stack(new cdk.App(), 'S', { env: { account: PROVIDER_ACCOUNT, region: REGION } })
    const poolId = new cdk.CfnParameter(stack, 'SomePool', { type: 'String' }).valueAsString
    expect(() => new CognitoPoolRole(stack, 'R', { userPoolId: poolId })).not.toThrow()
  })

  // contract: S16
  it('a role from the one-click stack deployed with a pool from another Region can perform none of the five operations on any pool', () => {
    const otherRegionPool = 'us-east-1_AbCdEfGhI'
    const role = launch(publishedYaml(), { [EXTERNAL_ID_PARAMETER]: ISSUED_ID, [USER_POOL_ID_PARAMETER]: otherRegionPool }, REGION)
    if (role === undefined) throw new Error('no role was created')
    const pools = [poolArn(otherRegionPool, 'us-east-1'), poolArn(POOL_ID), poolArn(SECOND_POOL_ID), poolArn('us-east-1_ZyXwVuTsR', 'us-east-1')]

    for (const action of APP_CLIENT_ACTIONS) for (const pool of pools) expect([action, pool, mayCall(role.permissions, fromApiable(action, pool))]).toEqual([action, pool, false])
  })

  // contract: S16
  it('the module is held by the engine to refuse a pool from another Region, by the script CI runs on it', () => {
    const script = fs.readFileSync(path.join(REPO_ROOT, 'check-cognito-pool-role-module.sh'), 'utf8')
    const workflow = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/parity-gate.yml'), 'utf8')

    expect(script).toContain('refused "a user_pool_id from another region"')
    expect(workflow).toContain(`bash check-cognito-pool-role-module.sh terraform/${CONSTRUCT}`)
  })
})
