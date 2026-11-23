/**
 * The usage-events hand-build set as published: the file synth writes beside the template is the set
 * generated from that template, and, filled as the portal fills it, it is the fourth channel the parity
 * gate compares with the CDK construct, the published template and the Terraform module. Each planted
 * change to the set alone fails the gate naming `console`.
 */
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { ConsoleResourceSet, serializeConsoleResourceSet } from '@apiable/cdk-console-explainer'
import { ChannelModel, gate, GateResult, reduceCloudFormation, reduceConsoleResourceSet, reduceTerraformShowJson } from '@apiable/parity-gate'
import { MISSING_DECLARED_ID } from '../lib/parity-gate/canonical'
import { generateUsageEventsConsoleSet, USAGE_EVENTS_CONSOLE_REDUCTION } from '../lib/usage-events/console-instructions'
import { USAGE_EVENTS } from './support/parity-channels'
import { publishedVersion } from './support/published-template'

type Json = Record<string, unknown>

const REPO_ROOT = path.resolve(__dirname, '..')
const WRITER = path.join(REPO_ROOT, 'scripts/usage-events-console-publish.ts')
const TS_NODE = path.join(REPO_ROOT, 'node_modules/ts-node/dist/bin.js')
const REGION = USAGE_EVENTS.tfRegion
const PARTNER_ACCOUNT = '034444869755'
const TENANT = 'ci'
const FOREIGN_ACCOUNT = '999988887777'
const EXFIL_BUCKET = 'arn:aws:s3:::attacker-exfil-bucket'

const publishedSetText = (): string =>
  fs.readFileSync(path.join(path.dirname(USAGE_EVENTS.publishedCfn), 'console-instructions.json'), 'utf8')
const publishedTemplate = (): unknown => JSON.parse(fs.readFileSync(USAGE_EVENTS.publishedCfn, 'utf8'))

/** Exactly what the portal does with the set: replace the three tokens it holds values for, touch nothing else. */
const filledSet = (): ConsoleResourceSet =>
  JSON.parse(
    Object.entries({ '{region}': REGION, '{tenant-name}': TENANT, '{partner-account}': PARTNER_ACCOUNT }).reduce(
      (text, [token, value]) => text.split(token).join(value),
      publishedSetText(),
    ),
  ) as ConsoleResourceSet

const cdkModel = (): ChannelModel =>
  reduceCloudFormation(Template.fromStack(USAGE_EVENTS.buildCdk(new cdk.App())).toJSON(), 'cdk', USAGE_EVENTS.cfnRegion)
const cfnModel = (): ChannelModel => reduceCloudFormation(publishedTemplate(), 'cfn', USAGE_EVENTS.cfnRegion)
const tfModel = (): ChannelModel =>
  reduceTerraformShowJson(JSON.parse(fs.readFileSync(USAGE_EVENTS.tfFixture, 'utf8')), 'terraform', REGION, USAGE_EVENTS.tfDeployAccount)
const consoleModel = (set: ConsoleResourceSet): ChannelModel => reduceConsoleResourceSet(set, REGION, USAGE_EVENTS_CONSOLE_REDUCTION)
const gateWithConsole = (set: ConsoleResourceSet): GateResult => gate([cdkModel(), cfnModel(), tfModel(), consoleModel(set)])

const documentOf = (set: ConsoleResourceSet, cfnType: string, index = 0): Json =>
  set.resources.filter((resource) => resource.cfnType === cfnType)[index].document
const statements = (document: unknown): Json[] => (document as { Statement: Json[] }).Statement
const writeRole = (set: ConsoleResourceSet): Json => documentOf(set, 'AWS::IAM::Role', 0)
const deliveryRole = (set: ConsoleResourceSet): Json => documentOf(set, 'AWS::IAM::Role', 1)
const destination = (set: ConsoleResourceSet): Json =>
  documentOf(set, 'AWS::KinesisFirehose::DeliveryStream').ExtendedS3DestinationConfiguration as Json

/**
 * The stream delivering into a bucket the set does not create, with the delivery role granted on that
 * bucket so it can: the gate models the delivery through the role's grant (its model holds no edge for
 * the destination property itself), as the Terraform channel's planted case does.
 */
const repointed = (set: ConsoleResourceSet): ConsoleResourceSet => {
  destination(set).BucketARN = EXFIL_BUCKET
  statements((deliveryRole(set).Policies as Json[])[0].PolicyDocument)[0].Resource = [EXFIL_BUCKET, `${EXFIL_BUCKET}/*`]
  return set
}

/** Each change to the console channel alone the gate must refuse, and a text its divergence carries. */
const PLANTED: readonly (readonly [string, (set: ConsoleResourceSet) => ConsoleResourceSet, string])[] = [
  [
    "the delivery role's grant widened to every action",
    (set) => {
      statements((deliveryRole(set).Policies as Json[])[0].PolicyDocument)[0].Action = '*'
      return set
    },
    'grant',
  ],
  [
    'the write role trusting an account other than the partner account',
    (set) => {
      statements(writeRole(set).AssumeRolePolicyDocument)[0].Principal = { AWS: `arn:aws:iam::${FOREIGN_ACCOUNT}:root` }
      return set
    },
    FOREIGN_ACCOUNT,
  ],
  [
    'the write role trusting any account',
    (set) => {
      statements(writeRole(set).AssumeRolePolicyDocument)[0].Principal = { AWS: '*' }
      return set
    },
    'apiable-logs-write-role',
  ],
  [
    'the bucket policy granting an account other than the customer and the partner',
    (set) => {
      statements(documentOf(set, 'AWS::S3::BucketPolicy').PolicyDocument)[0].Principal = {
        AWS: ['arn:aws:iam::{account}:root', `arn:aws:iam::${FOREIGN_ACCOUNT}:root`],
      }
      return set
    },
    FOREIGN_ACCOUNT,
  ],
  [
    'the bucket policy granting any account',
    (set) => {
      statements(documentOf(set, 'AWS::S3::BucketPolicy').PolicyDocument)[0].Principal = { AWS: '*' }
      return set
    },
    'bucket-policy',
  ],
  [
    "the stream's destination re-pointed at a bucket the set does not create",
    (set) => repointed(set),
    'attacker-exfil-bucket',
  ],
  [
    'the delivery stream removed',
    (set) => ({ ...set, resources: set.resources.filter((resource) => resource.cfnType !== 'AWS::KinesisFirehose::DeliveryStream') }),
    'firehose-delivery-stream',
  ],
  [
    "the bucket's declared identity removed",
    (set) => {
      const bucket = documentOf(set, 'AWS::S3::Bucket')
      delete bucket.Tags
      return set
    },
    MISSING_DECLARED_ID,
  ],
]

describe('the published usage-events set — the artifact the portal serves', () => {
  // contract: 024-3-8 S1
  it('is written beside the template, names its construct and version, and is the set generated from that template', () => {
    const text = publishedSetText()
    const set = JSON.parse(text) as ConsoleResourceSet

    expect(set.construct).toBe(USAGE_EVENTS.construct)
    expect(set.version).toBe(publishedVersion(USAGE_EVENTS.construct))
    expect(text).toBe(serializeConsoleResourceSet(generateUsageEventsConsoleSet(publishedTemplate(), set.version)))
  })

  // contract: 024-3-8 S6
  it('a separate run of the publish step over the same template writes the same bytes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-events-console-rerun-'))
    const outPath = path.join(dir, 'console-instructions.json')
    try {
      const run = spawnSync(
        process.execPath,
        [TS_NODE, '-r', 'tsconfig-paths/register', '--prefer-ts-exts', WRITER, USAGE_EVENTS.publishedCfn, publishedVersion(USAGE_EVENTS.construct), outPath],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      )

      expect(run.status).toBe(0)
      expect(fs.readFileSync(outPath, 'utf8')).toBe(publishedSetText())
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 60000)
})

describe(`${USAGE_EVENTS.construct} parity — the console set as the fourth channel`, () => {
  // contract: 024-3-8 S9
  it('the four channels reduce to the same model, the set filled as the portal fills it', () => {
    const result = gateWithConsole(filledSet())

    expect(result.divergences).toEqual([])
    expect(result.passed).toBe(true)
  })

  // contract: 024-3-8 S9
  it('the set as published, its tokens unfilled, reduces to the same model: each token goes back to its input', () => {
    const result = gateWithConsole(JSON.parse(publishedSetText()) as ConsoleResourceSet)

    expect(result.divergences).toEqual([])
    expect(result.passed).toBe(true)
  })

  // contract: 024-3-8 S9
  it("reads each primary's declared identity from its own document, and none is missing on the console channel", () => {
    const refs = consoleModel(filledSet()).graph.nodes.map((node) => node.ref)

    expect(refs.filter((ref) => ref.includes(MISSING_DECLARED_ID))).toEqual([])
    for (const declaredId of ['apiable-logs-bucket', 'apiable-logs-write-role', 'apiable-usagelogs-firehose-role']) {
      expect(refs.some((ref) => ref.includes(declaredId))).toBe(true)
    }
    const renamed = filledSet()
    ;(documentOf(renamed, 'AWS::S3::Bucket').Tags as Json[])[0].Value = 'some-other-bucket'
    expect(consoleModel(renamed).graph.nodes.map((node) => node.ref).some((ref) => ref.includes('some-other-bucket'))).toBe(true)
  })

  describe.each(PLANTED)('%s', (_change, plant, marker) => {
    // contract: 024-3-8 S10
    it('fails the gate naming the console channel', () => {
      const result = gateWithConsole(plant(filledSet()))

      expect(result.passed).toBe(false)
      expect(result.divergences.every((divergence) => divergence.channels.includes('console'))).toBe(true)
      const divergence = result.divergences.find((candidate) => candidate.detail.includes(marker))
      expect(divergence?.channels).toEqual(['console'])
    })
  })

  // contract: 024-3-8 S10
  it('keeps a value that names no resource of the set as the literal it is: the foreign bucket is never matched to the set’s own', () => {
    const grantResources = consoleModel(repointed(filledSet())).grants.flatMap((grant) => grant.resources)

    expect(grantResources).toContain(EXFIL_BUCKET)
    expect(grantResources).toContain(`${EXFIL_BUCKET}/*`)
    expect(JSON.stringify(consoleModel(filledSet()))).not.toContain('attacker-exfil-bucket')
  })
})
