/**
 * Story 013-1-21 — the Firehose usage-stream tier policed by the REAL parity engine over REAL artifacts.
 *
 * The gate's only independent implementation of each usage stream is the hand-rolled Terraform module
 * (the CDK construct and the one-click CFN are both CDK synth), so the committed `terraform show -json`
 * fixture is fed THROUGH gate() cross-channel against the real CDK synth + published one-click template
 * — not consumed only by the same-channel regen self-check. This is the stream analogue of 013-1-15's
 * parity-gate-logs-bucket-real-tf.spec.ts: three real channels reduced and compared per distribution,
 * plus a planted Terraform-only drift that must fail the gate so the TF leg is proven engine-compared.
 *
 * Both distributions of the shared stream are exercised (the usage-log and api-key-token streams),
 * each carrying its own delivery role declared id and destination routing prefix, so the gate proves
 * they stay distinct resources that reconcile independently.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { buildPublishedStack, buildPublishedTokensStack } from '@apiable/cdk-usagelogs-stream'
import { ChannelModel, gate, reduceCloudFormation, reduceTerraformShowJson } from '@apiable/parity-gate'

const REPO_ROOT = path.resolve(__dirname, '..')
const TF_REGION = 'eu-central-1'
// The committed fixtures' deploying account (CI regenerates them credentialed); supplied so the
// incidental tenant root tokenises exactly as the published channel's AWS::AccountId pseudo-parameter.
const TF_DEPLOY_ACCOUNT = '111111111111'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

interface Distribution {
  readonly name: string
  readonly publishedCfn: string
  readonly tfFixture: string
  readonly buildCdk: (app: cdk.App) => cdk.Stack
}

const DISTRIBUTIONS: readonly Distribution[] = [
  {
    name: 'usage-log',
    publishedCfn: path.join(REPO_ROOT, 'dist/launchstack/apiable-usagelogs-stream/1.0.0/template.json'),
    tfFixture: path.join(REPO_ROOT, 'test/fixtures/parity-gate/terraform-usagelogs-stream-show.json'),
    buildCdk: (app) => buildPublishedStack(app),
  },
  {
    name: 'api-key-token',
    publishedCfn: path.join(REPO_ROOT, 'dist/launchstack/apiable-usagetokens-stream/1.0.0/template.json'),
    tfFixture: path.join(REPO_ROOT, 'test/fixtures/parity-gate/terraform-usagetokens-stream-show.json'),
    buildCdk: (app) => buildPublishedTokensStack(app),
  },
]

const cdkModel = (distribution: Distribution): ChannelModel =>
  reduceCloudFormation(Template.fromStack(distribution.buildCdk(new cdk.App())).toJSON(), 'cdk')
const cfnModel = (distribution: Distribution): ChannelModel =>
  reduceCloudFormation(JSON.parse(fs.readFileSync(distribution.publishedCfn, 'utf8')), 'cfn')
const tfPlan = (distribution: Distribution): unknown => JSON.parse(fs.readFileSync(distribution.tfFixture, 'utf8'))
const tfModel = (distribution: Distribution, plan: unknown = tfPlan(distribution)): ChannelModel =>
  reduceTerraformShowJson(plan, 'terraform', TF_REGION, TF_DEPLOY_ACCOUNT)

interface TfPlan {
  planned_values: { root_module: { resources: { type: string; values: Record<string, unknown> }[] } }
}

const streamConfigOf = (plan: TfPlan): Record<string, unknown> => {
  const stream = plan.planned_values.root_module.resources.find((r) => r.type === 'aws_kinesis_firehose_delivery_stream')
  if (stream === undefined) throw new Error('fixture must carry an aws_kinesis_firehose_delivery_stream resource')
  const config = (stream.values.extended_s3_configuration as Record<string, unknown>[])[0]
  if (config === undefined) throw new Error('fixture stream must carry an extended_s3_configuration block')
  return config
}

interface TfConfigPlan {
  configuration: { root_module: { resources: { type: string; expressions?: Record<string, unknown> }[] } }
}

const EXFIL_BUCKET = 'arn:aws:s3:::attacker-exfil-bucket'

/**
 * Re-point the real Terraform fixture's destination to a hardcoded exfil bucket, the way a hand-rolled
 * module would: rewrite the delivery role's S3 write grant onto the exfil bucket AND drop the stream
 * destination's `var.logs_bucket_arn` binding (a literal with no var reference), so the destination is no
 * longer the conventional deploy-time parameter. The CFN/CDK channels stay on the published parameter.
 */
const repointToExfilBucket = (plan: unknown): unknown => {
  const tf = plan as TfPlan & TfConfigPlan
  const policy = tf.planned_values.root_module.resources.find((r) => r.type === 'aws_iam_role_policy')
  if (policy === undefined) throw new Error('fixture must carry an aws_iam_role_policy resource')
  const document = JSON.parse(policy.values.policy as string) as { Statement: { Action: unknown; Resource: unknown }[] }
  for (const statement of document.Statement) {
    const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action]
    if (actions.some((action) => typeof action === 'string' && action.startsWith('s3:'))) {
      statement.Resource = [EXFIL_BUCKET, `${EXFIL_BUCKET}/*`]
    }
  }
  policy.values.policy = JSON.stringify(document)
  streamConfigOf(tf).bucket_arn = EXFIL_BUCKET
  const configStream = tf.configuration.root_module.resources.find((r) => r.type === 'aws_kinesis_firehose_delivery_stream')
  const configDestination = (configStream?.expressions?.extended_s3_configuration as Record<string, unknown>[])[0]
  configDestination.bucket_arn = { references: [] }
  return tf
}

describe('013-1-21 usage-stream parity — real CDK + one-click + Terraform artifacts', () => {
  for (const distribution of DISTRIBUTIONS) {
    describe(`${distribution.name} stream`, () => {
      it('the real committed Terraform fixture is in parity with the real CDK synth + published one-click template', () => {
        const result = gate([cdkModel(distribution), cfnModel(distribution), tfModel(distribution)])
        expect(result.divergences).toEqual([])
        expect(result.passed).toBe(true)
      })

      it('the stream, log group, and log stream are recognised canonical kinds, not unmodelled fall-back nodes', () => {
        const tf = tfModel(distribution)
        const kinds = new Set(tf.graph.nodes.map((node) => node.kind))
        expect(kinds.has('firehose-delivery-stream')).toBe(true)
        expect(kinds.has('logs-log-group')).toBe(true)
        expect(kinds.has('logs-log-stream')).toBe(true)
        // none reduced to the raw channel-native type string (the F1 fall-back the gate was blind to)
        for (const node of tf.graph.nodes) expect(node.kind.startsWith('aws_')).toBe(false)
      })

      it('a planted Terraform-only change to the destination routing prefix FAILS the gate naming terraform', () => {
        const drifted = clone(tfPlan(distribution)) as TfPlan
        streamConfigOf(drifted).prefix = 'apiable/aws/hijacked/logs/'
        const result = gate([cdkModel(distribution), cfnModel(distribution), tfModel(distribution, drifted)])
        expect(result.passed).toBe(false)
        const divergence = result.divergences.find((entry) => entry.detail.includes('destination-prefix'))
        expect(divergence).toBeDefined()
        expect(divergence?.channels).toEqual(['terraform'])
      })

      it('a planted Terraform-only change disabling server-side delivery logging FAILS the gate naming terraform', () => {
        const drifted = clone(tfPlan(distribution)) as TfPlan
        const logging = (streamConfigOf(drifted).cloudwatch_logging_options as Record<string, unknown>[])[0]
        logging.enabled = false
        const result = gate([cdkModel(distribution), cfnModel(distribution), tfModel(distribution, drifted)])
        expect(result.passed).toBe(false)
        const divergence = result.divergences.find((entry) => entry.detail.includes('cloudwatch-logging-enabled'))
        expect(divergence).toBeDefined()
        expect(divergence?.channels).toEqual(['terraform'])
      })

      it('a Terraform leg re-pointed to a hardcoded exfil bucket FAILS the gate naming terraform (the fail-OPEN this tier closes)', () => {
        // The exploit against the REAL published CFN: the destination is re-pointed to an attacker-controlled
        // bucket while CFN/CDK stay on the published LogsBucketArn parameter. Certifying this equivalent would
        // let usage records be exfiltrated through the hand-rolled Terraform channel.
        const exploit = repointToExfilBucket(clone(tfPlan(distribution)))
        const result = gate([cdkModel(distribution), cfnModel(distribution), tfModel(distribution, exploit)])
        expect(result.passed).toBe(false)
        const divergence = result.divergences.find((entry) => entry.tier === 'permission' && entry.detail.includes('attacker-exfil-bucket'))
        expect(divergence).toBeDefined()
        expect(divergence?.channels).toEqual(['terraform'])
      })
    })
  }

  it('the published one-click templates carry the apiable:logical-id declared identity on the delivery role', () => {
    for (const distribution of DISTRIBUTIONS) {
      const template = JSON.parse(fs.readFileSync(distribution.publishedCfn, 'utf8')) as {
        Resources: Record<string, { Type: string; Properties?: { Tags?: { Key: string; Value: unknown }[] } }>
      }
      const roles = Object.values(template.Resources).filter((r) => r.Type === 'AWS::IAM::Role')
      expect(roles.length).toBeGreaterThan(0)
      for (const role of roles) {
        const declaredId = (role.Properties?.Tags ?? []).find((tag) => tag.Key === 'apiable:logical-id')
        expect(declaredId?.Value).toBeDefined()
      }
    }
  })

  it('the two distributions stay distinct streams — the usage-log and api-key-token streams never share one identity', () => {
    const logStreamRef = tfModel(DISTRIBUTIONS[0]).graph.nodes.find((node) => node.kind === 'firehose-delivery-stream')?.ref
    const tokenStreamRef = tfModel(DISTRIBUTIONS[1]).graph.nodes.find((node) => node.kind === 'firehose-delivery-stream')?.ref
    expect(logStreamRef).toBeDefined()
    expect(tokenStreamRef).toBeDefined()
    expect(logStreamRef).not.toEqual(tokenStreamRef)
  })
})
