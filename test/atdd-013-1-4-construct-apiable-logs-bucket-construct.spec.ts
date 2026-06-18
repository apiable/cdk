/**
 * Acceptance specs for the apiable-logs-bucket construct across all three channels.
 * Frozen contract: contract-013-1-4-construct-apiable-logs-bucket.md
 *
 * One un-skipped spec per contract scenario (S1–S7); every one is provable without a live AWS
 * account — from the CDK synth, the published one-click synth, and the hand-rolled Terraform module
 * source. Parity (S2, S7) is asserted against the real artifacts of all three channels, so the
 * assertion tracks whatever each channel actually emits (no policy logic re-declared here).
 */
import * as fs from 'fs'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import {
  LogsBucketStack,
  LogsBucketStackProps,
  buildPublishedStack,
  PARTNER_ACCOUNT_PARAMETER,
  TENANT_NAME_PARAMETER,
  DEFAULT_APIABLE_PARTNER_ACCOUNT,
  ACCOUNT_ID_PATTERN_SOURCE,
  launchStackTemplateKey,
  launchStackTemplateS3Uri,
} from '@apiable/cdk-logs-bucket'
import { gate, reduceCloudFormation } from '@apiable/parity-gate'

const PARTNER_ACCOUNT = DEFAULT_APIABLE_PARTNER_ACCOUNT
const REGION = 'eu-central-1'
const TENANT = 'staging'
const TENANT_ACCOUNT = '111111111111'
const STACK_ID = 'apiable-logs-bucket'
const EXPECTED_BUCKET_NAME = `apiable-logs-${TENANT}`
const EXPECTED_ROLE_NAME = `apiable-logs-${TENANT}-s3-role`

const REPO_ROOT = path.resolve(__dirname, '..')
const TF_MODULE_DIR = path.join(REPO_ROOT, 'terraform/apiable-logs-bucket')

/**
 * The standalone-deploy / umbrella synth: the tenant name + account are concrete, so the back-compat
 * assertions compare against the bucket existing customers already run.
 */
const concreteTemplate = (overrides: LogsBucketStackProps = {}): Template =>
  Template.fromStack(
    new LogsBucketStack(new cdk.App(), STACK_ID, {
      name: TENANT,
      env: { account: TENANT_ACCOUNT, region: REGION },
      ...overrides,
    }),
  )

/** The published one-click synth: no env, so the tenant account is AWS::AccountId and the name is a parameter. */
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

describe('013-1-4 apiable-logs-bucket — synth + parity contract', () => {
  // S1 — published across npm + one-click + Terraform at one version (lockstep)
  it('S1: logs-bucket published on npm + one-click + Terraform at the same version', () => {
    const npmVersion = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'lib/logs-bucket/package.json'), 'utf8'),
    ).version
    expect(npmVersion).toMatch(/^\d+\.\d+\.\d+$/)

    // one-click (CFN) channel: the published template is addressed by component name + that version,
    // and the synth wiring single-sources the version from the same package.json
    expect(launchStackTemplateKey(npmVersion)).toBe(`apiable-logs-bucket/${npmVersion}/template.yaml`)
    expect(launchStackTemplateS3Uri(npmVersion)).toMatch(
      /^s3:\/\/[^/]+\/apiable-logs-bucket\/\d+\.\d+\.\d+\/template\.yaml$/,
    )
    const synth = fs.readFileSync(path.join(REPO_ROOT, 'synth-launchstack.sh'), 'utf8')
    expect(synth).toContain('lib/${CONSTRUCT_NAME#apiable-}')
    expect(synth).toMatch(/VERSION="\$\(node -p "require\(.*package\.json.*\)\.version"\)"/)

    // Terraform channel: the publish wiring derives the tag from that same single source — lockstep by construction
    const publish = fs.readFileSync(path.join(REPO_ROOT, 'publish-terraform.sh'), 'utf8')
    expect(publish).toContain("require('./lib/logs-bucket/package.json').version")
    expect(publish).toMatch(/TAG=.*\$\{VERSION\}/)

    // and the Terraform module pins no competing version literal of its own
    expect(allTfSources()).not.toContain(npmVersion)
  })

  // S2 — the three channels describe an equivalent bucket, retention posture, and write-role
  it('S2: the three channels’ artifacts describe an equivalent bucket, retention posture, and log-writing role', () => {
    // ── CDK construct channel ──────────────────────────────────────────────────────────────────
    const cdkT = concreteTemplate()
    cdkT.resourceCountIs('AWS::S3::Bucket', 1)
    cdkT.hasResourceProperties('AWS::S3::Bucket', Match.objectLike({ BucketName: EXPECTED_BUCKET_NAME }))
    cdkT.resourceCountIs('AWS::S3::BucketPolicy', 1)
    cdkT.hasResourceProperties(
      'AWS::S3::BucketPolicy',
      Match.objectLike({
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([Match.objectLike({ Sid: 'Permissions', Effect: 'Allow', Action: 's3:*' })]),
        }),
      }),
    )
    cdkT.resourceCountIs('AWS::IAM::Role', 1)
    cdkT.hasResourceProperties('AWS::IAM::Role', Match.objectLike({ RoleName: EXPECTED_ROLE_NAME }))

    // ── one-click (published CFN) channel — same resource shape as the construct synth ───────────
    const pub = publishedTemplate()
    pub.resourceCountIs('AWS::S3::Bucket', 1)
    pub.resourceCountIs('AWS::S3::BucketPolicy', 1)
    pub.resourceCountIs('AWS::IAM::Role', 1)

    // The published channel's bucket-policy is now proven by the real parity engine, not a bare count:
    // it reduces to the same bucket-policy write grant as the CDK-synth channel (the deploying account
    // tokenised on each side, so only the bounded cross-account writer compares), so the one-click
    // template cannot ship a divergent write principal. (013-1-15 subsumes the count-only interim.)
    const enginePub = reduceCloudFormation(publishedTemplate().toJSON(), 'cfn', REGION)
    const engineCdk = reduceCloudFormation(concreteTemplate().toJSON(), 'cdk', REGION, TENANT_ACCOUNT)
    const bucketPolicyComparison = gate([engineCdk, enginePub, { ...enginePub, channel: 'terraform' }]).divergences.filter(
      (entry) => entry.detail.includes('bucket-policy') || entry.detail.includes('s3-bucket-policy'),
    )
    expect(bucketPolicyComparison).toEqual([])

    // ── Terraform channel — the hand-rolled module source ────────────────────────────────────────
    const main = tfModule('main.tf')
    expect(main.match(/resource\s+"aws_s3_bucket"\s+"/g)).toHaveLength(1)
    expect(main).toMatch(/bucket\s*=\s*"apiable-logs-\$\{var\.name\}"/)
    expect(main.match(/resource\s+"aws_s3_bucket_policy"\s+"/g)).toHaveLength(1)
    expect(main).toMatch(/Sid\s*=\s*"Permissions"/)
    expect(main.match(/resource\s+"aws_iam_role"\s+"/g)).toHaveLength(1)
    expect(main).toMatch(/name\s*=\s*"apiable-logs-\$\{var\.name\}-s3-role"/)
    expect(tfModule('outputs.tf')).toMatch(/output\s+"bucket_name"/)
    expect(tfModule('outputs.tf')).toMatch(/output\s+"bucket_arn"/)
    expect(tfModule('outputs.tf')).toMatch(/output\s+"s3_assume_role_arn"/)

    // nothing broader: the only actions across the module are the bucket/role s3 grant + the assume
    const actions = [...main.matchAll(/Action\s*=\s*"([^"]+)"/g)].map((x) => x[1])
    expect(new Set(actions)).toEqual(new Set(['s3:*', 'sts:AssumeRole']))
  })

  // S3 — deployed, the bucket is tenant-scoped and carries the existing retention posture
  it('S3: provisioned bucket name is tenant-scoped per the naming convention; existing retention posture applies', () => {
    const t = concreteTemplate()
    t.hasResourceProperties('AWS::S3::Bucket', Match.objectLike({ BucketName: EXPECTED_BUCKET_NAME }))
    expect(EXPECTED_BUCKET_NAME).toBe('apiable-logs-staging')
    // existing retention posture: RETAIN_ON_UPDATE_OR_DELETE — retained on update/delete
    t.hasResource(
      'AWS::S3::Bucket',
      Match.objectLike({ DeletionPolicy: 'RetainExceptOnCreate', UpdateReplacePolicy: 'Retain' }),
    )

    // the one-click channel is tenant-scoped too: the name resolves from the tenant parameter
    const pubBucketName = JSON.stringify(firstResource(publishedTemplate(), 'AWS::S3::Bucket').Properties?.BucketName)
    expect(pubBucketName).toContain('apiable-logs-')
    expect(pubBucketName).toContain(TENANT_NAME_PARAMETER)
  })

  // S4 — omitting optional inputs reproduces the existing bucket exactly (edge / back-compat)
  it('S4: with only required inputs, bucket name/policy/write-role equal the existing bucket', () => {
    const t = concreteTemplate() // name + tenant account supplied; partner account omitted → default

    t.hasResourceProperties('AWS::S3::Bucket', Match.objectLike({ BucketName: EXPECTED_BUCKET_NAME }))
    // partner defaults to Apiable's account, so behaviour is unchanged
    t.hasParameter(PARTNER_ACCOUNT_PARAMETER, Match.objectLike({ Default: PARTNER_ACCOUNT }))

    // bucket policy: the Permissions statement grants s3:* to exactly the tenant root + the partner root
    const statement = (firstResource(t, 'AWS::S3::BucketPolicy').Properties?.PolicyDocument as {
      Statement: { Sid: string; Action: string; Principal: unknown }[]
    }).Statement[0]
    expect(statement.Sid).toBe('Permissions')
    expect(statement.Action).toBe('s3:*')
    const principalJson = JSON.stringify(statement.Principal)
    expect(principalJson).toContain(TENANT_ACCOUNT) // tenant account root (the deploying account)
    expect(principalJson).toContain(PARTNER_ACCOUNT_PARAMETER) // partner root via the bounded parameter

    // write role unchanged: same name, the partner's s3:* grant on the bucket + its objects
    t.hasResourceProperties('AWS::IAM::Role', Match.objectLike({ RoleName: EXPECTED_ROLE_NAME }))
    t.hasResourceProperties(
      'AWS::IAM::Policy',
      Match.objectLike({
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([Match.objectLike({ Effect: 'Allow', Action: 's3:*' })]),
        }),
      }),
    )
  })

  // S5 — a too-wide supplied cross-account write principal cannot widen the grant
  it('S5: a wildcard / multi-account / extra-principal write grant is rejected or bounded to exactly one account', () => {
    // deploy-time bound: the parameter the launch link pre-fills (and a customer can edit) — used by
    // BOTH the bucket policy principal and the role trust — is constrained to one 12-digit account
    const t = concreteTemplate()
    t.hasParameter(
      PARTNER_ACCOUNT_PARAMETER,
      Match.objectLike({ AllowedPattern: ACCOUNT_ID_PATTERN_SOURCE, MinLength: 12, MaxLength: 12 }),
    )
    expect(ACCOUNT_ID_PATTERN_SOURCE).toBe('^[0-9]{12}$')
    expect('*').not.toMatch(new RegExp(ACCOUNT_ID_PATTERN_SOURCE))
    expect('111122223333,444455556666').not.toMatch(new RegExp(ACCOUNT_ID_PATTERN_SOURCE))
    expect('034444869755 222222222222').not.toMatch(new RegExp(ACCOUNT_ID_PATTERN_SOURCE))

    // build-time guard (defence in depth): a too-wide construct input is rejected up front
    expect(() => new LogsBucketStack(new cdk.App(), STACK_ID, { name: TENANT, partnerAccount: '*' })).toThrow(
      /12-digit/,
    )

    // one supplied account resolves to exactly that account, with no leftover/extra principal
    const supplied = concreteTemplate({ partnerAccount: '222222222222' })
    supplied.hasParameter(PARTNER_ACCOUNT_PARAMETER, Match.objectLike({ Default: '222222222222' }))
    // the role trust references the bounded partner parameter, and the prior fixed account is not carried over
    expect(JSON.stringify(supplied.findResources('AWS::IAM::Role'))).toContain(PARTNER_ACCOUNT_PARAMETER)
    expect(JSON.stringify(supplied.findResources('AWS::IAM::Role'))).not.toContain(PARTNER_ACCOUNT)
  })

  // S6 — no tenant- or Apiable-specific identifier baked into the artifact
  it('S6: synthesized artifact carries no hardcoded account/region literal — each is a supplied input', () => {
    const json = publishedTemplate().toJSON()
    const resources = JSON.stringify(json.Resources)
    // no 12-digit account literal in any resource (the partner appears only as the parameter Default)
    expect(resources).not.toContain(PARTNER_ACCOUNT)
    expect(resources).not.toMatch(/(?<!\d)\d{12}(?!\d)/)
    // no region literal in any resource
    expect(resources).not.toContain(REGION)
    // each is genuinely a supplied input: the partner as a parameter, the tenant account as AWS::AccountId
    expect(json.Parameters?.[PARTNER_ACCOUNT_PARAMETER]).toBeDefined()
    expect(json.Parameters?.[TENANT_NAME_PARAMETER]).toBeDefined()
    expect(resources).toContain('AWS::AccountId')
  })

  // S7 — retention/lifecycle posture is the existing one; no new expiry rule (deferred to analytics redesign)
  it('S7: retention/lifecycle posture matches the existing bucket and is identical across all three channels', () => {
    // CDK construct channel: retained (RETAIN_ON_UPDATE_OR_DELETE), no S3 lifecycle/expiry configuration
    const cdkBucket = firstResource(concreteTemplate(), 'AWS::S3::Bucket')
    expect(cdkBucket.Properties?.LifecycleConfiguration).toBeUndefined()
    expect(cdkBucket.DeletionPolicy).toBe('RetainExceptOnCreate')

    // one-click (published CFN) channel: same posture
    const pubBucket = firstResource(publishedTemplate(), 'AWS::S3::Bucket')
    expect(pubBucket.Properties?.LifecycleConfiguration).toBeUndefined()
    expect(pubBucket.DeletionPolicy).toBe('RetainExceptOnCreate')

    // Terraform channel: retained, and no S3 lifecycle/expiry rule introduced
    expect(tfModule('main.tf')).toMatch(/prevent_destroy\s*=\s*true/)
    expect(tfModule('main.tf')).toMatch(/force_destroy\s*=\s*false/)
    expect(allTfSources()).not.toMatch(/lifecycle_rule|aws_s3_bucket_lifecycle_configuration|expiration|transition/)
  })
})
