/**
 * Acceptance specs for the apiable-usagelogs-stream construct across all three channels.
 * Frozen contract: contract-013-1-5-construct-apiable-usagelogs-stream.md
 *
 * One un-skipped spec per contract scenario (S1–S11); every one here is provable without a live AWS
 * account — from the CDK synth, the published one-click synth, and the hand-rolled Terraform module
 * source. The live-delivery scenario (S5) needs a real cloud account and lives in the CI-excluded
 * *.live.spec.ts companion (mirrors 013-1-1 / 013-1-2).
 *
 * SHARED CONSTRUCT (Open Q1, settled): this is the SAME LogsStream construct as 013-1-6
 * (apiable-usagetokens-stream), published under TWO distribution identities differing ONLY by the
 * default stream `name` and destination `prefix`. THIS story owns the shape; 1-6 reuses it.
 *
 * SECURITY (contract S8): the delivery role trusts the firehose SERVICE principal — there is NO
 * customer/cross-account trust PARAMETER — so the 013-1-1 AC5 cross-account no-widen bound does NOT
 * apply and is NOT force-fit. S8 pins service-principal-only trust + least-privilege storage write.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import {
  LogsStream,
  LogsStreamStack,
  LogsStreamStackProps,
  buildPublishedStack,
  LOGS_BUCKET_ARN_PARAMETER,
  STREAM_NAME_PARAMETER,
  PREFIX_PARAMETER,
  FIREHOSE_ROLE_LOGICAL_ID,
  DEFAULT_USAGELOGS_PREFIX,
  launchStackTemplateKey,
  launchStackTemplateS3Uri,
} from '@apiable/cdk-usagelogs-stream'

const REGION = 'eu-central-1'
const ACCOUNT = '111111111111'
const LOGS_BUCKET_ARN = 'arn:aws:s3:::apiable-logs-test' // customer storage location — a deploy-time input, never baked in
const USAGELOGS_NAME = 'usagelogs-test' // default distribution name for THIS (usagelogs) identity
const EXPECTED_STREAM_NAME = `amazon-apigateway-${USAGELOGS_NAME}`
const EXPECTED_ROLE_NAME = `apiable-${USAGELOGS_NAME}-firehose`
const STACK_ID = 'apiable-usagelogs-stream'

const REPO_ROOT = path.resolve(__dirname, '..')
const TF_MODULE_DIR = path.join(REPO_ROOT, 'terraform/apiable-usagelogs-stream')

/**
 * The standalone-deploy / umbrella synth: the stream name + bucket ARN are concrete, so the
 * back-compat assertions compare against the stream existing customers already run. Built through the
 * same `LogsStream` Stack the umbrella's `buildLogsStreamStack` instantiates.
 */
const concreteTemplate = (
  env: { logsBucketArn?: string; prefix?: string; name?: string } = {},
): Template =>
  Template.fromStack(
    new LogsStream(new cdk.App(), STACK_ID, {
      stackName: `usagelogs-stream-apiable-test`,
      description: 'Usage Logs stream for Apiable Portal test',
      env: {
        account: ACCOUNT,
        region: REGION,
        logsBucketArn: env.logsBucketArn ?? LOGS_BUCKET_ARN,
        prefix: env.prefix ?? DEFAULT_USAGELOGS_PREFIX,
        name: env.name ?? USAGELOGS_NAME,
      },
    }),
  )

/** The published one-click synth: no env, so the region is AWS::Region and the storage location is a parameter. */
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

describe('013-1-5 apiable-usagelogs-stream — synth contract', () => {
  // S1 — published component provisions exactly one usage-log delivery stream + surfaces its id output
  it('S1: defines one delivery stream writing to the customer storage location, under a service-trusted identity, with an id output', () => {
    const t = concreteTemplate()
    t.resourceCountIs('AWS::KinesisFirehose::DeliveryStream', 1)
    t.hasResourceProperties(
      'AWS::KinesisFirehose::DeliveryStream',
      Match.objectLike({
        DeliveryStreamName: Match.stringLikeRegexp('^amazon-apigateway-'), // gateway-recognised name prefix
        DeliveryStreamType: 'DirectPut',
        S3DestinationConfiguration: Match.objectLike({ BucketARN: LOGS_BUCKET_ARN }), // the customer storage location
      }),
    )
    // the delivery identity: exactly one role, trusted as the firehose service
    t.resourceCountIs('AWS::IAM::Role', 1)
    t.hasResourceProperties(
      'AWS::IAM::Role',
      Match.objectLike({
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({ Effect: 'Allow', Principal: { Service: 'firehose.amazonaws.com' } }),
          ]),
        }),
      }),
    )
    // the stream identifier is surfaced as a deployment output
    const outputs = t.findOutputs('*')
    expect(Object.keys(outputs).length).toBeGreaterThanOrEqual(1)
  })

  // S3 — storage location / prefix / name are deploy-time Parameters (not literals); own resources only
  it('S3: storage location is a deploy-time Parameter (a Ref, never a baked literal); published artifact carries only its own resources', () => {
    const pub = publishedTemplate()
    // storage location, stream name, and destination prefix are all surfaced as deploy-time CFN
    // Parameters (not fixed inside the artifact); the storage location is required, name/prefix default
    // to the usage-log values
    pub.hasParameter(LOGS_BUCKET_ARN_PARAMETER, Match.objectLike({ Type: 'String' }))
    pub.hasParameter(STREAM_NAME_PARAMETER, Match.objectLike({ Default: 'usagelogs' }))
    pub.hasParameter(PREFIX_PARAMETER, Match.objectLike({ Default: DEFAULT_USAGELOGS_PREFIX }))

    // the destination BucketARN is a { Ref: <param> }, never a baked literal
    const dest = firstResource(pub, 'AWS::KinesisFirehose::DeliveryStream').Properties
      ?.S3DestinationConfiguration as { BucketARN: unknown }
    expect(JSON.stringify(dest.BucketARN)).toContain(LOGS_BUCKET_ARN_PARAMETER)
    expect(JSON.stringify(dest.BucketARN)).toContain('Ref')

    // the CFN auto-synth publishes the template addressable by {component}/{version}/template.yaml
    const npmVersion = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'lib/logs-stream/package.json'), 'utf8')).version
    expect(launchStackTemplateKey(npmVersion)).toBe(`apiable-usagelogs-stream/${npmVersion}/template.yaml`)

    // the published artifact carries ONLY the component's own resources — no CDKMetadata / bootstrap-version telemetry
    const json = pub.toJSON()
    expect(json.Resources?.CDKMetadata).toBeUndefined()
    expect(json.Parameters?.BootstrapVersion).toBeUndefined()
    expect(json.Rules?.CheckBootstrapVersion).toBeUndefined()
  })

  // S2 — published at the SAME version across all three channels (package / one-click template / Terraform)
  it('S2: npm + CFN + Terraform artifacts carry the same component version, each addressable by name + version', () => {
    const npmVersion = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'lib/logs-stream/package.json'), 'utf8')).version
    expect(npmVersion).toMatch(/^\d+\.\d+\.\d+$/)

    // one-click (CFN) channel: addressed by component name + that version; the synth single-sources the version
    expect(launchStackTemplateKey(npmVersion)).toBe(`apiable-usagelogs-stream/${npmVersion}/template.yaml`)
    expect(launchStackTemplateS3Uri(npmVersion)).toMatch(
      /^s3:\/\/[^/]+\/apiable-usagelogs-stream\/\d+\.\d+\.\d+\/template\.yaml$/,
    )
    const synth = fs.readFileSync(path.join(REPO_ROOT, 'synth-launchstack.sh'), 'utf8')
    expect(synth).toContain('lib/${CONSTRUCT_NAME#apiable-}')
    expect(synth).toMatch(/VERSION="\$\(node -p "require\(.*package\.json.*\)\.version"\)"/)

    // Terraform channel: the publish wiring derives the tag from that same single source — lockstep by construction
    const publish = fs.readFileSync(path.join(REPO_ROOT, 'publish-terraform.sh'), 'utf8')
    expect(publish).toContain("require('./lib/logs-stream/package.json').version")
    expect(publish).toMatch(/TAG=.*\$\{VERSION\}/)

    // and the Terraform module pins no competing version literal of its own
    expect(allTfSources()).not.toContain(npmVersion)
  })

  // S4 — the three channels describe an EQUIVALENT stream + destination + delivery identity (release-time parity)
  it('S4: CDK / published-CFN / Terraform describe an equivalent stream, destination config, and delivery identity', () => {
    // ── CDK construct channel ──────────────────────────────────────────────────────────────────
    const cdkT = concreteTemplate()
    cdkT.hasResourceProperties(
      'AWS::KinesisFirehose::DeliveryStream',
      Match.objectLike({
        DeliveryStreamName: EXPECTED_STREAM_NAME,
        DeliveryStreamType: 'DirectPut',
        S3DestinationConfiguration: Match.objectLike({
          BucketARN: LOGS_BUCKET_ARN,
          Prefix: `${DEFAULT_USAGELOGS_PREFIX}/logs/`,
          ErrorOutputPrefix: `${DEFAULT_USAGELOGS_PREFIX}/errors/`,
          BufferingHints: { IntervalInSeconds: 300, SizeInMBs: 5 },
          CompressionFormat: 'UNCOMPRESSED',
        }),
      }),
    )
    cdkT.hasResourceProperties('AWS::IAM::Role', Match.objectLike({ RoleName: EXPECTED_ROLE_NAME }))

    // ── published one-click (CFN) channel — same resource shape, name/prefix as deploy-time params ──
    const pub = publishedTemplate()
    pub.resourceCountIs('AWS::KinesisFirehose::DeliveryStream', 1)
    pub.resourceCountIs('AWS::IAM::Role', 1)
    pub.hasResourceProperties(
      'AWS::KinesisFirehose::DeliveryStream',
      Match.objectLike({
        DeliveryStreamType: 'DirectPut',
        S3DestinationConfiguration: Match.objectLike({
          BufferingHints: { IntervalInSeconds: 300, SizeInMBs: 5 },
          CompressionFormat: 'UNCOMPRESSED',
        }),
      }),
    )
    // the gateway-recognised name prefix survives parameterisation: the stream name joins the literal
    // `amazon-apigateway-` prefix with the StreamName parameter, and the destination prefix routes the
    // DestinationPrefix parameter under /logs/ + /errors/
    const pubStream = firstResource(pub, 'AWS::KinesisFirehose::DeliveryStream').Properties as {
      DeliveryStreamName: unknown
      S3DestinationConfiguration: { Prefix: unknown; ErrorOutputPrefix: unknown }
    }
    expect(JSON.stringify(pubStream.DeliveryStreamName)).toContain('amazon-apigateway-')
    expect(JSON.stringify(pubStream.S3DestinationConfiguration.Prefix)).toContain('/logs/')
    expect(JSON.stringify(pubStream.S3DestinationConfiguration.Prefix)).toContain(PREFIX_PARAMETER)
    expect(JSON.stringify(pubStream.S3DestinationConfiguration.ErrorOutputPrefix)).toContain('/errors/')

    // ── Terraform channel — the hand-rolled module source ────────────────────────────────────────
    const main = tfModule('main.tf')
    expect(main.match(/resource\s+"aws_kinesis_firehose_delivery_stream"\s+"/g)).toHaveLength(1)
    expect(main).toMatch(/name\s*=\s*"amazon-apigateway-\$\{var\.name\}"/)
    expect(main).toMatch(/prefix\s*=\s*"\$\{var\.prefix\}\/logs\/"/)
    expect(main).toMatch(/error_output_prefix\s*=\s*"\$\{var\.prefix\}\/errors\/"/)
    expect(main).toMatch(/buffering_interval\s*=\s*300/)
    expect(main).toMatch(/buffering_size\s*=\s*5/)
    expect(main).toMatch(/compression_format\s*=\s*"UNCOMPRESSED"/)
    expect(main.match(/resource\s+"aws_iam_role"\s+"/g)).toHaveLength(1)
    expect(main).toMatch(/name\s*=\s*"apiable-\$\{var\.name\}-firehose"/)
    expect(main).toMatch(/Service\s*=\s*"firehose\.amazonaws\.com"/)
    expect(tfModule('outputs.tf')).toMatch(/output\s+"firehose_arn"/)

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
  })

  // S6 — defaults reproduce the EXISTING usage-log stream exactly (zero regression)
  it('S6: with the usage-log defaults, stream/destination/identity equal the existing usage-log stream — no drive-by rename/retune', () => {
    const t = concreteTemplate() // usagelogs name + apiable/aws prefix — the existing defaults

    // delivery stream name + type unchanged
    t.hasResourceProperties(
      'AWS::KinesisFirehose::DeliveryStream',
      Match.objectLike({
        DeliveryStreamName: EXPECTED_STREAM_NAME,
        DeliveryStreamType: 'DirectPut',
        S3DestinationConfiguration: Match.objectLike({
          Prefix: 'apiable/aws/logs/',
          ErrorOutputPrefix: 'apiable/aws/errors/',
          BufferingHints: { IntervalInSeconds: 300, SizeInMBs: 5 },
          CompressionFormat: 'UNCOMPRESSED',
        }),
      }),
    )
    // role name + log group unchanged
    t.hasResourceProperties('AWS::IAM::Role', Match.objectLike({ RoleName: EXPECTED_ROLE_NAME }))
    t.hasResourceProperties(
      'AWS::Logs::LogGroup',
      Match.objectLike({ LogGroupName: `/aws/firehose/logs-${USAGELOGS_NAME}`, RetentionInDays: 7 }),
    )
    // delivery identity grants exactly the storage-write set + its own diagnostics (unchanged)
    t.hasResourceProperties(
      'AWS::IAM::Role',
      Match.objectLike({
        Policies: Match.arrayWith([
          Match.objectLike({
            PolicyDocument: Match.objectLike({
              Statement: Match.arrayWith([
                Match.objectLike({
                  Action: [
                    's3:AbortMultipartUpload',
                    's3:GetBucketLocation',
                    's3:GetObject',
                    's3:ListBucket',
                    's3:ListBucketMultipartUploads',
                    's3:PutObject',
                  ],
                }),
                Match.objectLike({ Action: 'logs:PutLogEvents' }),
              ]),
            }),
          }),
        ]),
      }),
    )
  })

  // S7 — no tenant/storage/account/region literal baked into the synthesized artifact
  it('S7: the published artifact contains no hardcoded storage-location / account / region literal — each is a supplied input', () => {
    const json = publishedTemplate().toJSON()
    const resources = JSON.stringify(json.Resources)
    expect(resources).not.toContain(LOGS_BUCKET_ARN) // present only via a Parameter Ref
    expect(resources).not.toContain(REGION) // region resolves from the deployment context / pseudo-param
    expect(resources).not.toMatch(/(?<!\d)\d{12}(?!\d)/) // no bare 12-digit account literal anywhere
    // each is genuinely a supplied input: the storage location as a parameter, the region as AWS::Region
    expect(json.Parameters?.[LOGS_BUCKET_ARN_PARAMETER]).toBeDefined()
  })

  // S8 — delivery identity trusted ONLY as the cloud delivery service; least-privilege; NO account-trust knob
  it('S8: the delivery role trusts the firehose service principal only, grants only storage-write + its own diagnostics, and exposes no account-trust parameter', () => {
    const t = concreteTemplate()
    // trusted only as the firehose service — never a customer account
    t.hasResourceProperties(
      'AWS::IAM::Role',
      Match.objectLike({
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({ Effect: 'Allow', Principal: { Service: 'firehose.amazonaws.com' } }),
          ]),
        }),
      }),
    )
    // NO AssumeRole statement carries an AWS: account principal, and there is NO trust parameter on the construct
    const role = firstResource(t, 'AWS::IAM::Role').Properties as {
      AssumeRolePolicyDocument: { Statement: { Principal: Record<string, unknown> }[] }
    }
    for (const statement of role.AssumeRolePolicyDocument.Statement) {
      expect(statement.Principal).not.toHaveProperty('AWS')
    }
    expect(Object.keys(t.toJSON().Parameters ?? {})).not.toContain('TrustAccount')
    expect(Object.keys(t.toJSON().Parameters ?? {})).not.toContain('PartnerAccount')

    // least-privilege: the inline policy grants only the s3 storage-write set + logs:PutLogEvents — nothing broader
    const policy = (role as unknown as { Policies?: { PolicyDocument: { Statement: { Action: unknown }[] } }[] }).Policies
    const actions = new Set<string>()
    for (const p of policy ?? []) {
      for (const s of p.PolicyDocument.Statement) {
        const a = s.Action
        if (Array.isArray(a)) a.forEach((x) => actions.add(x as string))
        else actions.add(a as string)
      }
    }
    expect(actions).toEqual(
      new Set([
        's3:AbortMultipartUpload',
        's3:GetBucketLocation',
        's3:GetObject',
        's3:ListBucket',
        's3:ListBucketMultipartUploads',
        's3:PutObject',
        'logs:PutLogEvents',
      ]),
    )
    // and the role carries the channel-stable declared identity the parity gate keys it on
    t.hasResourceProperties(
      'AWS::IAM::Role',
      Match.objectLike({
        Tags: Match.arrayWith([Match.objectLike({ Key: 'apiable:logical-id', Value: FIREHOSE_ROLE_LOGICAL_ID })]),
      }),
    )
  })

  // S9 — the stream identifier is surfaced under a stable, correctly-labelled, name-derived output
  it('S9: the firehose-ARN output key identifies THIS (usagelogs) distribution once and correctly — not doubled/mislabelled', () => {
    const outputs = concreteTemplate().findOutputs('*')
    const keys = Object.keys(outputs)
    expect(keys).toHaveLength(1)
    const [key] = keys
    // name-derived, single, correct: identifies this usagelogs distribution once (no `usagelogs-usagelogs-` doubling)
    expect(key).toBe('firehosearnusagelogstest') // derived from name `usagelogs-test`, once
    expect(key).not.toMatch(/usagelogs-?usagelogs/i)
    expect(JSON.stringify(outputs[key].Value)).toContain('Arn')
  })

  // S10 — omitting the required storage location fails loudly; provisions no stream
  it('S10: provisioning without the required storage location throws at synth — never a stream with a blank destination', () => {
    const app = new cdk.App()
    expect(
      () =>
        new LogsStream(app, 'NoBucket', {
          env: { account: ACCOUNT, region: REGION, logsBucketArn: '', prefix: DEFAULT_USAGELOGS_PREFIX, name: USAGELOGS_NAME },
        }),
    ).toThrow(/logsBucketArn|storage location|required/i)
  })

  // S11 — a published version synthesizes equivalently every time (immutable per version)
  it('S11: re-synthesizing the same version produces an equivalent template', () => {
    const a = Template.fromStack(buildPublishedStack(new cdk.App())).toJSON()
    const b = Template.fromStack(buildPublishedStack(new cdk.App())).toJSON()
    expect(a.Resources).toEqual(b.Resources) // same stream + destination + delivery identity; never mutated in place
    expect(a.Parameters).toEqual(b.Parameters)
  })
})

describe('013-1-5 apiable-usagelogs-stream — composition seam (opt-in, default-off)', () => {
  const composedStack = (props: { publishComposition?: boolean; tenant?: string } = {}): Template =>
    Template.fromStack(
      new LogsStreamStack(new cdk.App(), STACK_ID, {
        logsBucketArn: LOGS_BUCKET_ARN,
        name: USAGELOGS_NAME,
        env: { account: ACCOUNT, region: REGION },
        ...props,
      }),
    )

  it('default-off: no composition parameter resource is synthesized (an existing stack gains nothing)', () => {
    composedStack().resourceCountIs('AWS::SSM::Parameter', 0)
  })

  it('opt-in: publishes the firehose ARN to /apiable/{tenant}/usagelogs-stream/firehose-arn', () => {
    const t = composedStack({ publishComposition: true, tenant: 'staging' })
    t.resourceCountIs('AWS::SSM::Parameter', 1)
    t.hasResourceProperties(
      'AWS::SSM::Parameter',
      Match.objectLike({ Name: '/apiable/staging/usagelogs-stream/firehose-arn' }),
    )
  })

  it('opt-in without a concrete tenant throws (no silently-wrong key)', () => {
    expect(() => composedStack({ publishComposition: true })).toThrow(/tenant is required/)
  })
})
