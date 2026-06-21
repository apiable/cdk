/**
 * Story 013-1-15 — the logs-storage tier policed by the REAL parity engine over REAL artifacts.
 *
 * The gate's only independent implementation of the logs bucket is the hand-rolled Terraform module
 * (the CDK construct and the one-click CFN are both CDK synth), so the committed `terraform show -json`
 * fixture is fed THROUGH gate() cross-channel against the real CDK synth + published one-click template
 * — not consumed only by the same-channel regen self-check. This is the logs-bucket analogue of the
 * IAM-pilot's pilotModels() (atdd-013-1-3): three real channels reduced and compared, plus a planted
 * Terraform-only drift that must fail the gate so the TF leg is proven genuinely engine-compared.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { buildPublishedStack } from '@apiable/cdk-logs-bucket'
import { ChannelModel, gate, reduceCloudFormation, reduceTerraformShowJson } from '@apiable/parity-gate'

const REPO_ROOT = path.resolve(__dirname, '..')
const PUBLISHED_CFN = path.join(REPO_ROOT, 'dist/launchstack/apiable-logs-bucket/1.0.0/template.yaml')
const TF_FIXTURE = path.join(REPO_ROOT, 'test/fixtures/parity-gate/terraform-logs-bucket-show.json')
const TF_REGION = 'eu-central-1'
// The committed fixture's deploying account (CI regenerates it credentialed); supplied so the incidental
// tenant root drops out of the by-value write-grant exactly as the published channel's AWS::AccountId token.
const TF_DEPLOY_ACCOUNT = '111111111111'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

// The published one-click stack reduced from a live synth (the CDK channel) and the committed published
// template (the one-click channel); the hand-rolled module reduced from its committed `terraform show -json`.
const cdkModel = (): ChannelModel => reduceCloudFormation(Template.fromStack(buildPublishedStack(new cdk.App())).toJSON(), 'cdk')
const cfnModel = (): ChannelModel => reduceCloudFormation(yaml.load(fs.readFileSync(PUBLISHED_CFN, 'utf8')), 'cfn')
const tfPlan = (): unknown => JSON.parse(fs.readFileSync(TF_FIXTURE, 'utf8'))
const tfModel = (plan: unknown = tfPlan()): ChannelModel => reduceTerraformShowJson(plan, 'terraform', TF_REGION, TF_DEPLOY_ACCOUNT)

interface TfPlan {
  planned_values: { root_module: { resources: { type: string; values: Record<string, unknown> }[] } }
}

describe('013-1-15 logs-bucket parity — real CDK + one-click + Terraform artifacts', () => {
  it('the real committed Terraform fixture is in parity with the real CDK synth + published one-click template', () => {
    const result = gate([cdkModel(), cfnModel(), tfModel()])
    expect(result.passed).toBe(true)
    expect(result.divergences).toEqual([])
  })

  it('the published one-click template carries the apiable:logical-id declared identity on its taggable primaries', () => {
    const template = yaml.load(fs.readFileSync(PUBLISHED_CFN, 'utf8')) as {
      Resources: Record<string, { Type: string; Properties?: { Tags?: { Key: string; Value: unknown }[] } }>
    }
    const taggablePrimaries = Object.values(template.Resources).filter((r) => r.Type === 'AWS::S3::Bucket' || r.Type === 'AWS::IAM::Role')
    expect(taggablePrimaries.length).toBeGreaterThan(0)
    for (const resource of taggablePrimaries) {
      const declaredId = (resource.Properties?.Tags ?? []).find((tag) => tag.Key === 'apiable:logical-id')
      expect(declaredId?.Value).toBeDefined()
    }
  })

  it('a planted drift widening the Terraform bucket-policy write principal FAILS the gate naming terraform', () => {
    const drifted = clone(tfPlan()) as TfPlan
    const policyResource = drifted.planned_values.root_module.resources.find((r) => r.type === 'aws_s3_bucket_policy')
    if (policyResource === undefined) throw new Error('fixture must carry an aws_s3_bucket_policy resource')
    const doc = JSON.parse(policyResource.values.policy as string)
    doc.Statement[0].Principal.AWS = [...doc.Statement[0].Principal.AWS, 'arn:aws:iam::999988887777:root']
    policyResource.values.policy = JSON.stringify(doc)
    const result = gate([cdkModel(), cfnModel(), tfModel(drifted)])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find(
      (entry) => entry.detail.includes('bucket-policy-write-accounts') || entry.detail.includes('grant:bucket-policy'),
    )
    expect(divergence).toBeDefined()
    expect(divergence?.channels).toEqual(['terraform'])
  })
})
