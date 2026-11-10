/**
 * The usage-events hand-build set, generated from the published template: every resource once, in an
 * order a person can build, each reference resolved to a fixed name or a derived ARN, the direct log
 * path documented, exactly four tokens, and refusal of anything the generator cannot derive. The last
 * block holds the gateway role's generator to the sets it published before this generator existed.
 */
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { generateConsoleInstructionTemplate } from '@apiable/cdk-gateway-role'
import { ConsoleResourceSet, findDeployTimeReference, serializeConsoleResourceSet } from '@apiable/cdk-console-explainer'
import { generateUsageEventsConsoleSet } from '../lib/usage-events/console-instructions'
import { publishedTemplatePath, publishedVersion } from './support/published-template'

const REPO_ROOT = path.resolve(__dirname, '..')
const CONSTRUCT = 'apiable-usage-events'
const FIXTURES = path.join(REPO_ROOT, 'test/fixtures/parity-gate')
const WRITER = path.join(REPO_ROOT, 'scripts/usage-events-console-publish.ts')
const TS_NODE = path.join(REPO_ROOT, 'node_modules/ts-node/dist/bin.js')

type Json = Record<string, unknown>

const template = (): Json => JSON.parse(fs.readFileSync(publishedTemplatePath(CONSTRUCT), 'utf8')) as Json
const resourcesOf = (t: Json): Record<string, { Type: string; Properties: Json }> => t.Resources as Record<string, { Type: string; Properties: Json }>
const generate = (t: unknown = template()): ConsoleResourceSet => generateUsageEventsConsoleSet(t, publishedVersion(CONSTRUCT))
const entry = (set: ConsoleResourceSet, cfnType: string, index = 0) => set.resources.filter((resource) => resource.cfnType === cfnType)[index]
const logicalIdOfType = (t: Json, cfnType: string, index = 0): string =>
  Object.entries(resourcesOf(t)).filter(([, resource]) => resource.Type === cfnType)[index][0]
const tokensIn = (text: string): string[] => [...new Set(text.match(/\{[a-z-]+\}/g) ?? [])].sort()

describe('the usage-events set: every resource once, in an order a person can build', () => {
  // contract: 024-3-8 S1
  it('lists the eight resources the template creates, each once, with its kind, type and identity', () => {
    const set = generate()

    expect(set.construct).toBe(CONSTRUCT)
    expect(set.version).toBe(publishedVersion(CONSTRUCT))
    expect(set.resources.map(({ kind, cfnType }) => [kind, cfnType])).toEqual([
      ['bucket', 'AWS::S3::Bucket'],
      ['bucket-policy', 'AWS::S3::BucketPolicy'],
      ['iam-role', 'AWS::IAM::Role'],
      ['iam-policy', 'AWS::IAM::Policy'],
      ['other', 'AWS::Logs::LogGroup'],
      ['other', 'AWS::Logs::LogStream'],
      ['iam-role', 'AWS::IAM::Role'],
      ['stream', 'AWS::KinesisFirehose::DeliveryStream'],
    ])
    expect(set.resources.map((resource) => resource.cfnType).sort()).toEqual(
      Object.values(resourcesOf(template())).map((resource) => resource.Type).sort(),
    )
    expect(entry(set, 'AWS::S3::Bucket').identity).toBe('apiable-logs-{tenant-name}')
    expect(entry(set, 'AWS::KinesisFirehose::DeliveryStream').identity).toBe('amazon-apigateway-usagelogs')
    expect(entry(set, 'AWS::Logs::LogGroup').identity).toBe(logicalIdOfType(template(), 'AWS::Logs::LogGroup'))
  })

  // contract: 024-3-8 S1
  it('places no resource before a resource it references, and keeps the template order among the rest', () => {
    const t = template()
    const reversed = { ...t, Resources: Object.fromEntries(Object.entries(resourcesOf(t)).reverse()) }
    const order = generate(reversed).resources.map((resource) => resource.cfnType)

    const before = (first: string, second: string, firstIndex = 0, secondIndex = 0): void => {
      const positions = (type: string) => order.flatMap((candidate, index) => (candidate === type ? [index] : []))
      expect(positions(first)[firstIndex]).toBeLessThan(positions(second)[secondIndex])
    }
    before('AWS::S3::Bucket', 'AWS::S3::BucketPolicy')
    before('AWS::Logs::LogGroup', 'AWS::Logs::LogStream')
    before('AWS::Logs::LogStream', 'AWS::KinesisFirehose::DeliveryStream')
    before('AWS::IAM::Role', 'AWS::KinesisFirehose::DeliveryStream', 0)
    // Among resources whose references are met, the (reversed) template's order decides: the log group
    // is the first one there with nothing to wait for.
    expect(order[0]).toBe('AWS::Logs::LogGroup')
  })

  // contract: 024-3-8 S1
  it('carries the template’s own values: a property changed in a copied template shows in the set', () => {
    const t = template()
    resourcesOf(t)[logicalIdOfType(t, 'AWS::Logs::LogGroup')].Properties.RetentionInDays = 30

    expect(entry(generate(t), 'AWS::Logs::LogGroup').document.RetentionInDays).toBe(30)
    expect(entry(generate(), 'AWS::Logs::LogGroup').document.RetentionInDays).toBe(7)
  })
})

describe('the usage-events set: references resolve to fixed names and derived ARNs', () => {
  // contract: 024-3-8 S2
  it('resolves each reference to another resource to its fixed name, and each ARN reference to its derived ARN', () => {
    const set = generate()
    const stream = entry(set, 'AWS::KinesisFirehose::DeliveryStream').document.ExtendedS3DestinationConfiguration as Json
    const deliveryRole = entry(set, 'AWS::IAM::Role', 1).document
    const grant = ((deliveryRole.Policies as Json[])[0].PolicyDocument as { Statement: Json[] }).Statement

    expect(stream.BucketARN).toBe('arn:aws:s3:::apiable-logs-{tenant-name}')
    expect(stream.RoleARN).toBe('arn:aws:iam::{account}:role/apiable-usagelogs-firehose')
    expect(stream.CloudWatchLoggingOptions).toEqual({
      Enabled: true,
      LogGroupName: '/aws/firehose/logs-usagelogs',
      LogStreamName: 'firehose-log-stream-usagelogs',
    })
    expect(grant[0].Resource).toEqual(['arn:aws:s3:::apiable-logs-{tenant-name}', 'arn:aws:s3:::apiable-logs-{tenant-name}/*'])
    expect(grant[1].Resource).toBe('arn:aws:logs:{region}:{account}:log-group:/aws/firehose/logs-usagelogs:*')
    expect(entry(set, 'AWS::S3::BucketPolicy').document.Bucket).toBe('apiable-logs-{tenant-name}')
    expect(entry(set, 'AWS::IAM::Policy').document.Roles).toEqual(['apiable-logs-{tenant-name}-s3-role'])
  })

  // contract: 024-3-8 S2
  it('turns tokenised inputs into tokens, other inputs into defaults, and pseudo-references into tokens or aws', () => {
    const set = generate()
    const writeRoleTrust = (entry(set, 'AWS::IAM::Role').document.AssumeRolePolicyDocument as { Statement: Json[] }).Statement[0]
    const bucketPolicy = (entry(set, 'AWS::S3::BucketPolicy').document.PolicyDocument as { Statement: Json[] }).Statement[0]

    // `arn:${AWS::Partition}:iam::${ApiablePartnerAccount}:root` in the template
    expect(writeRoleTrust.Principal).toEqual({ AWS: 'arn:aws:iam::{partner-account}:root' })
    expect(bucketPolicy.Principal).toEqual({ AWS: ['arn:aws:iam::{account}:root', 'arn:aws:iam::{partner-account}:root'] })
    expect(set.documents).toEqual({ logSource: 'apigateway_direct' })
  })

  // contract: 024-3-8 S2
  it('concatenates Fn::Join and Fn::Sub, and omits a property that resolves to AWS::NoValue', () => {
    const t = template()
    const bucketId = logicalIdOfType(t, 'AWS::S3::Bucket')
    resourcesOf(t)[logicalIdOfType(t, 'AWS::Logs::LogGroup')].Properties.LogGroupName = { 'Fn::Sub': '/aws/${AWS::Region}/${TenantName}-${!Literal}' }
    resourcesOf(t)[logicalIdOfType(t, 'AWS::IAM::Role')].Properties.Description = { 'Fn::Sub': ['for ${Bucket}', { Bucket: { Ref: bucketId } }] }
    resourcesOf(t)[logicalIdOfType(t, 'AWS::IAM::Role')].Properties.MaxSessionDuration = { Ref: 'AWS::NoValue' }
    const set = generate(t)

    expect(entry(set, 'AWS::Logs::LogGroup').document.LogGroupName).toBe('/aws/{region}/{tenant-name}-${Literal}')
    expect(entry(set, 'AWS::IAM::Role').document.Description).toBe('for apiable-logs-{tenant-name}')
    expect(entry(set, 'AWS::IAM::Role').document).not.toHaveProperty('MaxSessionDuration')
  })

  // contract: 024-3-8 S2
  it('leaves no deploy-time reference anywhere in the set', () => {
    expect(findDeployTimeReference(generate())).toBeUndefined()
    expect(serializeConsoleResourceSet(generate())).not.toMatch(/"(Ref|Fn::[A-Za-z]+|Condition)"/)
  })
})

describe('the usage-events set: the direct log path, documented', () => {
  // contract: 024-3-8 S3
  it('evaluates the log-source condition over the defaults: no processing block, and the set records the direct path', () => {
    const set = generate()
    const destination = entry(set, 'AWS::KinesisFirehose::DeliveryStream').document.ExtendedS3DestinationConfiguration as Json

    expect(destination).not.toHaveProperty('ProcessingConfiguration')
    expect(set.documents.logSource).toBe('apigateway_direct')
  })

  // contract: 024-3-8 S3
  it('follows the condition, not a constant: with the CloudWatch Logs default the processing block appears', () => {
    const t = template()
    ;(t.Parameters as Record<string, Json>).LogSource.Default = 'cloudwatch_logs'
    const destination = entry(generate(t), 'AWS::KinesisFirehose::DeliveryStream').document.ExtendedS3DestinationConfiguration as Json

    expect(destination.ProcessingConfiguration).toMatchObject({ Enabled: true })
  })
})

describe('the usage-events set: exactly the four tokens', () => {
  // contract: 024-3-8 S4
  it('carries {tenant-name}, {partner-account}, {region} and {account}, and no other token', () => {
    const text = serializeConsoleResourceSet(generate())

    expect(tokensIn(text)).toEqual(['{account}', '{partner-account}', '{region}', '{tenant-name}'])
    expect(text).not.toContain('{trust-account}')
    expect(text).not.toContain('{external-id}')
  })

  // contract: 024-3-8 S4
  it('carries no twelve-digit account number: the partner account default never leaks in as a literal', () => {
    const text = serializeConsoleResourceSet(generate())

    expect(JSON.stringify(template().Parameters)).toMatch(/[0-9]{12}/)
    expect(text).not.toMatch(/(?<![0-9])[0-9]{12}(?![0-9])/)
  })
})

describe('the usage-events set: anything it cannot derive refuses the whole set', () => {
  // contract: 024-3-8 S5
  it('refuses a deploy-time function it does not know, naming it', () => {
    const t = template()
    resourcesOf(t)[logicalIdOfType(t, 'AWS::Logs::LogGroup')].Properties.LogGroupName = { 'Fn::ImportValue': 'shared-log-group' }

    expect(() => generate(t)).toThrow(/cannot derive Fn::ImportValue/)
  })

  // contract: 024-3-8 S5
  it('refuses a resource attribute other than its ARN or name, naming it', () => {
    const t = template()
    const bucketId = logicalIdOfType(t, 'AWS::S3::Bucket')
    resourcesOf(t)[logicalIdOfType(t, 'AWS::IAM::Role')].Properties.Description = { 'Fn::GetAtt': [bucketId, 'DomainName'] }

    expect(() => generate(t)).toThrow(new RegExp(`cannot derive ${bucketId}\\.DomainName`))
  })

  // contract: 024-3-8 S5
  it('refuses a reference to an input that has neither a token nor a default, naming it', () => {
    const t = template()
    ;(t.Parameters as Record<string, Json>).Owner = { Type: 'String' }
    resourcesOf(t)[logicalIdOfType(t, 'AWS::IAM::Role')].Properties.Description = { Ref: 'Owner' }

    expect(() => generate(t)).toThrow(/input Owner has neither a token nor a default/)
  })

  // contract: 024-3-8 S5
  it('refuses a reference to a resource with no fixed name, and a condition only a deployment can decide', () => {
    const t = template()
    resourcesOf(t)[logicalIdOfType(t, 'AWS::Logs::LogGroup')].Properties.KmsKeyId = { Ref: logicalIdOfType(t, 'AWS::IAM::Policy') }
    expect(() => generate(t)).toThrow(/cannot derive a fixed name/)

    const conditional = template()
    ;(conditional.Conditions as Record<string, unknown>).iscloudwatchlogsourceusagelogs = { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'eu-west-1'] }
    expect(() => generate(conditional)).toThrow(/only a deployment knows/)
  })

  describe('the publish step', () => {
    const runWriter = (templateJson: unknown): { status: number | null; stderr: string; written: boolean } => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-events-console-'))
      const templatePath = path.join(dir, 'template.json')
      const outPath = path.join(dir, 'console-instructions.json')
      try {
        fs.writeFileSync(templatePath, JSON.stringify(templateJson))
        const run = spawnSync(
          process.execPath,
          [TS_NODE, '-r', 'tsconfig-paths/register', '--prefer-ts-exts', WRITER, templatePath, publishedVersion(CONSTRUCT), outPath],
          { cwd: REPO_ROOT, encoding: 'utf8' },
        )
        return { status: run.status, stderr: run.stderr, written: fs.existsSync(outPath) }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    }

    // contract: 024-3-8 S5
    it('refuses to write a set that lacks a fill token, and leaves no file behind', () => {
      const t = template()
      ;(t.Parameters as Record<string, Json>).TenantName.Default = 'acme'
      // A template whose tenant name is not an input of the set: the role and bucket names lose {tenant-name}.
      for (const resource of Object.values(resourcesOf(t))) {
        const text = JSON.stringify(resource.Properties).split('{"Ref":"TenantName"}').join('"acme"')
        resource.Properties = JSON.parse(text) as Json
      }
      const run = runWriter(t)

      expect(run.status).toBeGreaterThan(0)
      expect(run.stderr).toContain('carries no {tenant-name} token')
      expect(run.written).toBe(false)
    }, 60000)

    // contract: 024-3-8 S5
    it('writes the set it generated for the published template', () => {
      const run = runWriter(template())

      expect(run.stderr).toBe('')
      expect(run.status).toBe(0)
    }, 60000)
  })
})

describe('the usage-events set: the same template gives the same bytes', () => {
  // contract: 024-3-8 S6
  it('generates byte-identical sets from one template, key order and entry order included', () => {
    const first = serializeConsoleResourceSet(generate())
    const second = serializeConsoleResourceSet(generateUsageEventsConsoleSet(JSON.parse(fs.readFileSync(publishedTemplatePath(CONSTRUCT), 'utf8')), publishedVersion(CONSTRUCT)))

    expect(second).toBe(first)
    expect(Object.keys(JSON.parse(first))).toEqual(['construct', 'version', 'documents', 'resources'])
    expect(Object.keys(JSON.parse(first).resources[0])).toEqual(['kind', 'cfnType', 'identity', 'document'])
  })
})

describe("the gateway role's set is untouched by the second generator", () => {
  // Templates and sets captured from origin/master 49ed2f3 before this change; both sets equal the ones the
  // store serves today.
  const GATEWAY_SETS: readonly (readonly [string, string, string])[] = [
    ['2.0.0', 'gateway-role-v2-template.json', 'gateway-role-v2-console-instructions.json'],
    ['3.0.0', 'gateway-role-v3-template.json', 'gateway-role-v3-console-instructions.json'],
  ]

  // contract: 024-3-8 S19
  it.each(GATEWAY_SETS)('regenerates the published %s set byte for byte', (version, templateFixture, setFixture) => {
    const generated = generateConsoleInstructionTemplate(
      JSON.parse(fs.readFileSync(path.join(FIXTURES, templateFixture), 'utf8')),
      version,
      publishedVersion('apiable-gateway-role'),
    )

    expect(`${JSON.stringify(generated, null, 2)}\n`).toBe(fs.readFileSync(path.join(FIXTURES, setFixture), 'utf8'))
  })
})
