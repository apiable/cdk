/**
 * Acceptance specs for the apiable-usagetokens-stream distribution across all three channels.
 * Frozen contract: contract-013-1-6-construct-apiable-usagetokens-stream.md
 *
 * One un-skipped spec per contract scenario provable without a live AWS account (S1, S2, S3, S6, S7) —
 * from the CDK synth, the published one-click synth, and the hand-rolled Terraform module source. The
 * live scenarios (S4 — a token event lands at the token path; S5 — the delivery-vs-ingestion boundary)
 * need a real cloud account and live in the CI-excluded *.live.spec.ts companion (mirrors 013-1-5 S5).
 *
 * SHARED CONSTRUCT (Open Q1, settled): apiable-usagetokens-stream is NOT a separate or forked
 * construct. It is the SECOND distribution identity of the SAME LogsStream construct whose shape is
 * owned and frozen by 013-1-5 (its S1/S7/S8/S10/S11). This spec asserts ONLY the token distribution
 * deltas — the token stream name + the deeper token destination prefix — the correctly-labelled token
 * output, the token parity/version, and the AC3 ingestion boundary.
 *
 * SECURITY (contract S1): the token distribution introduces NO customer/cross-account trust parameter;
 * trust is the inherited firehose SERVICE principal. The 013-1-1 AC5 cross-account no-widen bound does
 * NOT apply and is NOT force-fit.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import {
  LogsStream,
  buildPublishedStack,
  buildPublishedTokensStack,
  LOGS_BUCKET_ARN_PARAMETER,
  STREAM_NAME_PARAMETER,
  PREFIX_PARAMETER,
  FIREHOSE_ROLE_LOGICAL_ID,
  FIREHOSE_ROLE_LOGICAL_ID_TOKENS,
  firehoseRoleLogicalIdForName,
  DEFAULT_USAGETOKENS_NAME,
  DEFAULT_USAGETOKENS_PREFIX,
  tokensLaunchStackTemplateKey,
  tokensLaunchStackTemplateS3Uri,
} from '@apiable/cdk-usagetokens-stream'

const REGION = 'eu-central-1'
const ACCOUNT = '111111111111'
const LOGS_BUCKET_ARN = 'arn:aws:s3:::apiable-logs-test' // the SHARED customer storage location — a deploy-time input
const USAGETOKENS_NAME = 'usagetokens-test' // token distribution name (delta vs usagelogs)
const USAGETOKENS_PREFIX = DEFAULT_USAGETOKENS_PREFIX // 'apiable/aws/apikey-token' (delta vs usagelogs 'apiable/aws')
const EXPECTED_STREAM_NAME = `amazon-apigateway-${USAGETOKENS_NAME}`
const EXPECTED_ROLE_NAME = `apiable-${USAGETOKENS_NAME}-firehose`
const STACK_ID = 'apiable-usagetokens-stream'

const REPO_ROOT = path.resolve(__dirname, '..')
const TF_MODULE_DIR = path.join(REPO_ROOT, 'terraform/apiable-usagetokens-stream')
const USAGELOGS_TF_MODULE_DIR = path.join(REPO_ROOT, 'terraform/apiable-usagelogs-stream')
const SHARED_PKG = path.join(REPO_ROOT, 'lib/logs-stream/package.json')

/**
 * The standalone-deploy / umbrella synth for the TOKEN distribution: the stream name + bucket ARN are
 * concrete, so the back-compat assertions compare against the token stream existing customers run. Built
 * through the same shared `LogsStream` Stack the umbrella's `buildLogsStreamStack('usagetokens')` uses.
 */
const concreteTemplate = (
  env: { logsBucketArn?: string; prefix?: string; name?: string } = {},
): Template =>
  Template.fromStack(
    new LogsStream(new cdk.App(), STACK_ID, {
      stackName: `usagetokens-stream-apiable-test`,
      description: 'Usage Tokens Logs stream for Apiable Portal test',
      env: {
        account: ACCOUNT,
        region: REGION,
        logsBucketArn: env.logsBucketArn ?? LOGS_BUCKET_ARN,
        prefix: env.prefix ?? USAGETOKENS_PREFIX,
        name: env.name ?? USAGETOKENS_NAME,
      },
    }),
  )

/** The published one-click TOKEN synth: no env, so the region is AWS::Region and the storage location is a parameter. */
const publishedTokensTemplate = (): Template => Template.fromStack(buildPublishedTokensStack(new cdk.App()))

const tfModule = (dir: string, name: string): string => fs.readFileSync(path.join(dir, name), 'utf8')
const allTfSources = (dir: string): string =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.tf'))
    .map((f) => tfModule(dir, f))
    .join('\n')

const firstResource = (t: Template, type: string): { [key: string]: unknown; Properties?: Record<string, unknown> } =>
  Object.values(t.findResources(type))[0] as { Properties?: Record<string, unknown> }

describe('013-1-6 apiable-usagetokens-stream — synth contract (shared shape, token defaults)', () => {
  // S1 — the token distribution reuses the shared shape, changing only name + destination prefix
  it('S1: defines the same single stream + service-trusted delivery identity as the usage-log distribution, differing only by name + token prefix', () => {
    const t = concreteTemplate()
    // SAME shape as 1-5: exactly one delivery stream, one delivery role, DirectPut, writing to the customer storage location
    t.resourceCountIs('AWS::KinesisFirehose::DeliveryStream', 1)
    t.resourceCountIs('AWS::IAM::Role', 1)
    t.hasResourceProperties(
      'AWS::KinesisFirehose::DeliveryStream',
      Match.objectLike({
        DeliveryStreamName: EXPECTED_STREAM_NAME, // delta: token stream name
        DeliveryStreamType: 'DirectPut',
        S3DestinationConfiguration: Match.objectLike({
          BucketARN: LOGS_BUCKET_ARN,
          Prefix: `${USAGETOKENS_PREFIX}/logs/`, // delta: deeper token prefix
          ErrorOutputPrefix: `${USAGETOKENS_PREFIX}/errors/`,
          BufferingHints: { IntervalInSeconds: 300, SizeInMBs: 5 }, // shared
          CompressionFormat: 'UNCOMPRESSED', // shared
        }),
      }),
    )
    // the delivery identity: trusted by the firehose SERVICE principal only — no customer/cross-account trust value
    const role = firstResource(t, 'AWS::IAM::Role').Properties as {
      AssumeRolePolicyDocument: { Statement: { Effect: string; Principal: Record<string, unknown> }[] }
    }
    expect(role.AssumeRolePolicyDocument.Statement).toEqual([
      { Effect: 'Allow', Action: 'sts:AssumeRole', Principal: { Service: 'firehose.amazonaws.com' } },
    ])
    for (const statement of role.AssumeRolePolicyDocument.Statement) {
      expect(statement.Principal).not.toHaveProperty('AWS')
    }
    // no token-specific resource shape: the resource type set equals the usage-log distribution's
    const tokenTypes = Object.values(concreteTemplate().toJSON().Resources ?? {}).map((r) => (r as { Type: string }).Type).sort()
    const usagelogsTypes = Object.values(
      Template.fromStack(
        new LogsStream(new cdk.App(), 'usagelogs-cmp', {
          stackName: 'usagelogs-stream-apiable-test',
          description: 'Usage Logs stream for Apiable Portal test',
          env: { account: ACCOUNT, region: REGION, logsBucketArn: LOGS_BUCKET_ARN, prefix: 'apiable/aws', name: 'usagelogs-test' },
        }),
      ).toJSON().Resources ?? {},
    )
      .map((r) => (r as { Type: string }).Type)
      .sort()
    expect(tokenTypes).toEqual(usagelogsTypes)
  })

  // S2 — published at the SAME version across all three channels, in lockstep with the shared component
  it('S2: npm + CFN + Terraform token artifacts carry the same version, in lockstep with the usage-log distribution', () => {
    // the token package + the shared component package single-source one version (lockstep by construction)
    const sharedVersion = JSON.parse(fs.readFileSync(SHARED_PKG, 'utf8')).version
    const tokenVersion = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'lib/logs-stream/usagetokens/package.json'), 'utf8'),
    ).version
    expect(tokenVersion).toMatch(/^\d+\.\d+\.\d+$/)
    expect(tokenVersion).toBe(sharedVersion) // moves in lockstep with the usage-log distribution

    // one-click (CFN) channel: addressed by the TOKEN component name + that version
    expect(tokensLaunchStackTemplateKey(tokenVersion)).toBe(`apiable-usagetokens-stream/${tokenVersion}/template.yaml`)
    expect(tokensLaunchStackTemplateS3Uri(tokenVersion)).toMatch(
      /^s3:\/\/[^/]+\/apiable-usagetokens-stream\/\d+\.\d+\.\d+\/template\.yaml$/,
    )

    // the synth wiring reads the version from the shared package (so CFN + npm move together); the token
    // distribution is registered for synth under its own component name
    const synth = fs.readFileSync(path.join(REPO_ROOT, 'synth-launchstack.sh'), 'utf8')
    expect(synth).toContain('apiable-usagetokens-stream')
    expect(synth).toContain('lib/logs-stream')
    const launchApp = fs.readFileSync(path.join(REPO_ROOT, 'scripts/launchstack-app.ts'), 'utf8')
    expect(launchApp).toContain('buildPublishedTokensStack')

    // Terraform channel: the publish wiring derives the tag from the same single shared source — lockstep
    const publish = fs.readFileSync(path.join(REPO_ROOT, 'publish-terraform.sh'), 'utf8')
    expect(publish).toContain('apiable-usagetokens-stream')
    expect(publish).toContain("require('./lib/logs-stream/package.json').version")

    // the token Terraform module pins no competing version literal of its own
    expect(allTfSources(TF_MODULE_DIR)).not.toContain(tokenVersion)
  })

  // S3 — all three channels describe an EQUIVALENT token stream + delivery identity (release-time parity)
  it('S3: CDK / published-CFN / Terraform describe an equivalent token stream + identity, differing from usagelogs only by the token prefix', () => {
    // ── CDK construct channel ──────────────────────────────────────────────────────────────────
    const cdkT = concreteTemplate()
    cdkT.hasResourceProperties(
      'AWS::KinesisFirehose::DeliveryStream',
      Match.objectLike({
        DeliveryStreamName: EXPECTED_STREAM_NAME,
        DeliveryStreamType: 'DirectPut',
        S3DestinationConfiguration: Match.objectLike({
          BucketARN: LOGS_BUCKET_ARN,
          Prefix: `${USAGETOKENS_PREFIX}/logs/`,
          ErrorOutputPrefix: `${USAGETOKENS_PREFIX}/errors/`,
          BufferingHints: { IntervalInSeconds: 300, SizeInMBs: 5 },
          CompressionFormat: 'UNCOMPRESSED',
        }),
      }),
    )
    cdkT.hasResourceProperties('AWS::IAM::Role', Match.objectLike({ RoleName: EXPECTED_ROLE_NAME }))

    // ── published one-click (CFN) channel — same resource shape, token name/prefix as deploy-time params ──
    const pub = publishedTokensTemplate()
    pub.resourceCountIs('AWS::KinesisFirehose::DeliveryStream', 1)
    pub.resourceCountIs('AWS::IAM::Role', 1)
    pub.hasParameter(STREAM_NAME_PARAMETER, Match.objectLike({ Default: DEFAULT_USAGETOKENS_NAME }))
    pub.hasParameter(PREFIX_PARAMETER, Match.objectLike({ Default: USAGETOKENS_PREFIX }))
    const pubStream = firstResource(pub, 'AWS::KinesisFirehose::DeliveryStream').Properties as {
      DeliveryStreamName: unknown
      S3DestinationConfiguration: { Prefix: unknown; ErrorOutputPrefix: unknown }
    }
    expect(JSON.stringify(pubStream.DeliveryStreamName)).toContain('amazon-apigateway-')
    expect(JSON.stringify(pubStream.S3DestinationConfiguration.Prefix)).toContain('/logs/')
    expect(JSON.stringify(pubStream.S3DestinationConfiguration.Prefix)).toContain(PREFIX_PARAMETER)

    // ── Terraform channel — the hand-rolled token module source ───────────────────────────────────
    const main = tfModule(TF_MODULE_DIR, 'main.tf')
    expect(main.match(/resource\s+"aws_kinesis_firehose_delivery_stream"\s+"/g)).toHaveLength(1)
    expect(main).toMatch(/name\s*=\s*"amazon-apigateway-\$\{var\.name\}"/)
    expect(main).toMatch(/prefix\s*=\s*"\$\{var\.prefix\}\/logs\/"/)
    expect(main).toMatch(/error_output_prefix\s*=\s*"\$\{var\.prefix\}\/errors\/"/)
    expect(main).toMatch(/buffering_interval\s*=\s*300/)
    expect(main).toMatch(/buffering_size\s*=\s*5/)
    expect(main).toMatch(/compression_format\s*=\s*"UNCOMPRESSED"/)
    expect(main).toMatch(/name\s*=\s*"apiable-\$\{var\.name\}-firehose"/)
    expect(main).toMatch(/Service\s*=\s*"firehose\.amazonaws\.com"/)
    // the token module defaults the destination prefix to the token routing path
    expect(tfModule(TF_MODULE_DIR, 'variables.tf')).toContain(USAGETOKENS_PREFIX)

    // nothing broader: the only actions across the module are the s3 storage-write set + log write + the service assume
    const actions = [...main.matchAll(/"(s3:[A-Za-z]+|logs:[A-Za-z]+|sts:AssumeRole)"/g)].map((x) => x[1])
    expect(new Set(actions)).toEqual(
      new Set([
        's3:AbortMultipartUpload',
        's3:GetBucketLocation',
        's3:GetObject',
        's3:ListBucket',
        's3:ListBucketMultipartUploads',
        's3:PutObject',
        'logs:PutLogEvents',
        'sts:AssumeRole',
      ]),
    )

    // the three channels agree on the role's channel-stable declared identity for THIS (token) distribution
    cdkT.hasResourceProperties(
      'AWS::IAM::Role',
      Match.objectLike({
        Tags: Match.arrayWith([
          Match.objectLike({ Key: 'apiable:logical-id', Value: FIREHOSE_ROLE_LOGICAL_ID_TOKENS }),
        ]),
      }),
    )
    pub.hasResourceProperties(
      'AWS::IAM::Role',
      Match.objectLike({
        Tags: Match.arrayWith([
          Match.objectLike({ Key: 'apiable:logical-id', Value: FIREHOSE_ROLE_LOGICAL_ID_TOKENS }),
        ]),
      }),
    )
    expect(main).toContain(FIREHOSE_ROLE_LOGICAL_ID_TOKENS)
  })

  // S6 — the token stream's id output is correctly labelled for the TOKEN distribution (never the usagelogs label)
  it('S6: the firehose-ARN output key identifies the token distribution — never `usagelogs-usagetokens-...`', () => {
    const outputs = concreteTemplate().findOutputs('*')
    const keys = Object.keys(outputs)
    expect(keys).toHaveLength(1)
    const [key] = keys
    // name-derived, single, correct: identifies the token distribution once (no doubled / usagelogs label)
    expect(key).toBe('firehosearnusagetokenstest') // derived from name `usagetokens-test`, once
    expect(key).not.toMatch(/usagelogs/i) // never mislabelled as the usage-log distribution
    expect(JSON.stringify(outputs[key].Value)).toContain('Arn')
  })

  // S7 — token defaults reproduce the existing token stream exactly; no baked-in IDs; back-compatible
  it('S7: with only the required storage location, token name/prefix/identity equal the existing token stream, no literals baked in', () => {
    // concrete defaults reproduce the existing token stream exactly
    const t = concreteTemplate()
    t.hasResourceProperties(
      'AWS::KinesisFirehose::DeliveryStream',
      Match.objectLike({
        DeliveryStreamName: EXPECTED_STREAM_NAME,
        S3DestinationConfiguration: Match.objectLike({
          Prefix: 'apiable/aws/apikey-token/logs/',
          ErrorOutputPrefix: 'apiable/aws/apikey-token/errors/',
        }),
      }),
    )
    t.hasResourceProperties('AWS::IAM::Role', Match.objectLike({ RoleName: EXPECTED_ROLE_NAME }))
    t.hasResourceProperties(
      'AWS::Logs::LogGroup',
      Match.objectLike({ LogGroupName: `/aws/firehose/logs-${USAGETOKENS_NAME}`, RetentionInDays: 7 }),
    )

    // the published artifact bakes in no storage-location / account / region literal — each is a supplied input
    const pub = publishedTokensTemplate()
    pub.hasParameter(LOGS_BUCKET_ARN_PARAMETER, Match.objectLike({ Type: 'String' }))
    const json = pub.toJSON()
    const resources = JSON.stringify(json.Resources)
    expect(resources).not.toContain(LOGS_BUCKET_ARN) // present only via a Parameter Ref
    expect(resources).not.toContain(REGION)
    expect(resources).not.toMatch(/(?<!\d)\d{12}(?!\d)/) // no bare 12-digit account literal
    // own resources only — no bootstrap/telemetry scaffolding
    expect(json.Resources?.CDKMetadata).toBeUndefined()
    expect(json.Parameters?.BootstrapVersion).toBeUndefined()
    expect(json.Rules?.CheckBootstrapVersion).toBeUndefined()
  })

  // S7 (no-baked-IDs, missing-input loud fail — inherited 1-5 S10, re-affirmed for the token identity)
  it('S7: provisioning the token stream without the required storage location throws at synth', () => {
    const app = new cdk.App()
    expect(
      () =>
        new LogsStream(app, 'NoBucket', {
          env: { account: ACCOUNT, region: REGION, logsBucketArn: '', prefix: USAGETOKENS_PREFIX, name: USAGETOKENS_NAME },
        }),
    ).toThrow(/logsBucketArn|storage location|required/i)
  })
})

describe('013-1-6 apiable-usagetokens-stream — distribution distinctness from usagelogs', () => {
  // S1/S6 — the two distributions of the shared stream carry DISTINCT, correctly-labelled identities
  it('the token distribution and the usage-log distribution differ only by name, prefix, and their own correct labels', () => {
    const tokens = publishedTokensTemplate()
    const usagelogs = Template.fromStack(buildPublishedStack(new cdk.App()))

    // distinct destination-prefix defaults (the routing delta)
    tokens.hasParameter(PREFIX_PARAMETER, Match.objectLike({ Default: 'apiable/aws/apikey-token' }))
    usagelogs.hasParameter(PREFIX_PARAMETER, Match.objectLike({ Default: 'apiable/aws' }))

    // distinct stream-name defaults
    tokens.hasParameter(STREAM_NAME_PARAMETER, Match.objectLike({ Default: 'usagetokens' }))
    usagelogs.hasParameter(STREAM_NAME_PARAMETER, Match.objectLike({ Default: 'usagelogs' }))

    // distinct, correctly-labelled delivery-role declared identities — no shared/collided id across distributions
    tokens.hasResourceProperties(
      'AWS::IAM::Role',
      Match.objectLike({ Tags: Match.arrayWith([Match.objectLike({ Key: 'apiable:logical-id', Value: FIREHOSE_ROLE_LOGICAL_ID_TOKENS })]) }),
    )
    usagelogs.hasResourceProperties(
      'AWS::IAM::Role',
      Match.objectLike({ Tags: Match.arrayWith([Match.objectLike({ Key: 'apiable:logical-id', Value: FIREHOSE_ROLE_LOGICAL_ID })]) }),
    )
    expect(FIREHOSE_ROLE_LOGICAL_ID_TOKENS).not.toBe(FIREHOSE_ROLE_LOGICAL_ID)
    // and the two Terraform modules declare those same distinct literals
    expect(tfModule(TF_MODULE_DIR, 'main.tf')).toContain(FIREHOSE_ROLE_LOGICAL_ID_TOKENS)
    expect(tfModule(USAGELOGS_TF_MODULE_DIR, 'main.tf')).toContain(FIREHOSE_ROLE_LOGICAL_ID)
  })

  // the name→declared-id derivation never silently fall-backs to the usage-log id for a new variant
  it('a new distribution variant gets its own distinct declared id — never a silent usage-log collision', () => {
    expect(firehoseRoleLogicalIdForName('usagelogs-staging')).toBe(FIREHOSE_ROLE_LOGICAL_ID)
    expect(firehoseRoleLogicalIdForName('usagetokens-staging')).toBe(FIREHOSE_ROLE_LOGICAL_ID_TOKENS)
    // a hypothetical third distribution must NOT collapse onto the usage-log id (parity-gate collision)
    const third = firehoseRoleLogicalIdForName('usagemetrics-staging')
    expect(third).toBe('apiable-usagemetrics-firehose-role')
    expect(third).not.toBe(FIREHOSE_ROLE_LOGICAL_ID)
    expect(third).not.toBe(FIREHOSE_ROLE_LOGICAL_ID_TOKENS)
  })
})
