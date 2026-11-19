/**
 * The usage-events construct through the real parity engine: the CDK synth, the published one-click
 * template and the committed Terraform fixture reduce to one model, and a change planted on the
 * Terraform channel alone fails the gate naming that channel.
 */
import * as fs from 'fs'
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { ChannelModel, gate, GateResult, reduceCloudFormation, reduceTerraformShowJson } from '@apiable/parity-gate'
import { MISSING_DECLARED_ID } from '../lib/parity-gate/canonical'
import { USAGE_EVENTS } from './support/parity-channels'

type Json = Record<string, unknown>
interface TfResource {
  address: string
  type: string
  values: Json
}
interface TfPlan {
  planned_values: { root_module: { resources: TfResource[] } }
  configuration: { root_module: { resources: { address: string; type: string; expressions?: Json }[] } }
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const cdkModel = (): ChannelModel =>
  reduceCloudFormation(Template.fromStack(USAGE_EVENTS.buildCdk(new cdk.App())).toJSON(), 'cdk', USAGE_EVENTS.cfnRegion)
const cfnModel = (): ChannelModel =>
  reduceCloudFormation(JSON.parse(fs.readFileSync(USAGE_EVENTS.publishedCfn, 'utf8')), 'cfn', USAGE_EVENTS.cfnRegion)
const tfPlan = (): TfPlan => JSON.parse(fs.readFileSync(USAGE_EVENTS.tfFixture, 'utf8')) as TfPlan
const tfModel = (plan: TfPlan = tfPlan()): ChannelModel =>
  reduceTerraformShowJson(plan, 'terraform', USAGE_EVENTS.tfRegion, USAGE_EVENTS.tfDeployAccount)
const gateWithTerraform = (plan: TfPlan): GateResult => gate([cdkModel(), cfnModel(), tfModel(plan)])

const planned = (plan: TfPlan, address: string): TfResource => {
  const resource = plan.planned_values.root_module.resources.find((candidate) => candidate.address === address)
  if (resource === undefined) throw new Error(`the fixture has no ${address}`)
  return resource
}
const editPolicy = (resource: TfResource, attribute: string, edit: (document: { Statement: Json[] }) => void): void => {
  const document = JSON.parse(resource.values[attribute] as string) as { Statement: Json[] }
  edit(document)
  resource.values[attribute] = JSON.stringify(document)
}
const streamDestination = (plan: TfPlan): Json =>
  (planned(plan, 'aws_kinesis_firehose_delivery_stream.this').values.extended_s3_configuration as Json[])[0]

const EXFIL_BUCKET = 'arn:aws:s3:::attacker-exfil-bucket'

/** Each Terraform-only change the gate must refuse, and the text its divergence carries. */
const PLANTED: readonly (readonly [string, (plan: TfPlan) => void, string])[] = [
  [
    "the delivery role's S3 grant widened to every resource",
    (plan) =>
      editPolicy(planned(plan, 'aws_iam_role_policy.firehose'), 'policy', (document) => {
        document.Statement[0].Resource = '*'
      }),
    'grant:s3',
  ],
  [
    'the stream re-pointed at a literal bucket',
    (plan) => {
      editPolicy(planned(plan, 'aws_iam_role_policy.firehose'), 'policy', (document) => {
        document.Statement[0].Resource = [EXFIL_BUCKET, `${EXFIL_BUCKET}/*`]
      })
      streamDestination(plan).bucket_arn = EXFIL_BUCKET
      const configured = plan.configuration.root_module.resources.find((resource) => resource.address === 'aws_kinesis_firehose_delivery_stream.this')
      ;((configured?.expressions?.extended_s3_configuration as Json[])[0]).bucket_arn = { references: [] }
    },
    'attacker-exfil-bucket',
  ],
  [
    "the bucket policy's write principal widened to any account",
    (plan) =>
      editPolicy(planned(plan, 'aws_s3_bucket_policy.this'), 'policy', (document) => {
        document.Statement[0].Principal = { AWS: '*' }
      }),
    'bucket-policy',
  ],
  [
    "the write role's trust widened to any account",
    (plan) =>
      editPolicy(planned(plan, 'aws_iam_role.this'), 'assume_role_policy', (document) => {
        document.Statement[0].Principal = { AWS: '*' }
      }),
    'apiable-logs-write-role',
  ],
  [
    "the delivery role's trust widened to any account",
    (plan) =>
      editPolicy(planned(plan, 'aws_iam_role.firehose'), 'assume_role_policy', (document) => {
        document.Statement[0].Principal = { AWS: '*' }
      }),
    'apiable-usagelogs-firehose-role',
  ],
  [
    'the delivery prefix changed',
    (plan) => {
      streamDestination(plan).prefix = 'apiable/aws/hijacked/logs/'
    },
    'destination-prefix',
  ],
  [
    'the log group dropped',
    (plan) => {
      plan.planned_values.root_module.resources = plan.planned_values.root_module.resources.filter(
        (resource) => resource.address !== 'aws_cloudwatch_log_group.firehose',
      )
    },
    'logs-log-group',
  ],
]

describe(`${USAGE_EVENTS.construct} parity — CDK, published one-click template and Terraform`, () => {
  // contract: 024-3-6 S7
  it('the three channels reduce to the same model', () => {
    const result = gate([cdkModel(), cfnModel(), tfModel()])

    expect(result.divergences).toEqual([])
    expect(result.passed).toBe(true)
  })

  // contract: 024-3-6 S7
  it('no primary lacks its declared id on any channel', () => {
    for (const model of [cdkModel(), cfnModel(), tfModel()]) {
      expect(model.graph.nodes.filter((node) => node.ref.includes(MISSING_DECLARED_ID)).map((node) => `${model.channel}: ${node.ref}`)).toEqual([])
    }
  })

  it('reduces the stream, the log group and both roles to recognised kinds on the Terraform channel', () => {
    const kinds = tfModel().graph.nodes.map((node) => node.kind)

    expect(kinds).toEqual(expect.arrayContaining(['firehose-delivery-stream', 'logs-log-group', 's3-bucket', 's3-bucket-policy', 'iam-role']))
    expect(kinds.filter((kind) => kind === 'iam-role')).toHaveLength(2)
    expect(kinds.some((kind) => kind.startsWith('aws_'))).toBe(false)
  })

  it("drops the plan's Terraform-only plumbing, which has no CloudFormation counterpart", () => {
    const plan = tfPlan()
    // A real plan lists both; the committed fixture carries them so this proves the reducer, not their absence.
    expect(plan.planned_values.root_module.resources.map((resource) => resource.address)).toEqual(
      expect.arrayContaining(['data.aws_caller_identity.current', 'terraform_data.log_source_mode']),
    )
    const refs = tfModel(plan).graph.nodes.map((node) => `${node.kind} ${node.ref}`)

    expect(refs.filter((ref) => ref.includes('caller_identity') || ref.includes('terraform_data'))).toEqual([])
  })

  describe.each(PLANTED)('%s', (_change, plant, marker) => {
    // contract: 024-3-6 S8
    it('fails the gate naming the terraform channel', () => {
      const plan = clone(tfPlan())
      plant(plan)
      const result = gateWithTerraform(plan)

      expect(result.passed).toBe(false)
      const divergence = result.divergences.find((candidate) => candidate.detail.includes(marker))
      expect(divergence?.channels).toEqual(['terraform'])
    })
  })
})
