/**
 * Story 013-1-23 — the apiable-lambda-authorizer tier policed by the REAL parity engine over REAL artifacts.
 *
 * The gate's only independent implementation of the authorizer is the hand-rolled Terraform module (the
 * CDK construct and the one-click CFN are both CDK synth), so the committed `terraform show -json` fixture
 * is fed THROUGH gate() cross-channel against the real CDK synth + published one-click template — not
 * consumed only by the same-channel regen self-check. This is the authorizer analogue of 013-1-15's
 * parity-gate-logs-bucket-real-tf.spec.ts: three real channels reduced and compared, plus a planted
 * Terraform-only drift in a load-bearing authorizer value that must fail the gate so the TF leg is proven
 * genuinely engine-compared.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { buildPublishedStack } from '@apiable/cdk-lambda-authorizer'
import { ChannelModel, gate, reduceCloudFormation, reduceTerraformShowJson } from '@apiable/parity-gate'
import { publishedTemplatePath } from './support/published-template'

const REPO_ROOT = path.resolve(__dirname, '..')
const PUBLISHED_CFN = publishedTemplatePath('apiable-lambda-authorizer')
const TF_FIXTURE = path.join(REPO_ROOT, 'test/fixtures/parity-gate/terraform-lambda-authorizer-show.json')
const TF_REGION = 'eu-central-1'
const TF_DEPLOY_ACCOUNT = '111111111111'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const cdkModel = (): ChannelModel => reduceCloudFormation(Template.fromStack(buildPublishedStack(new cdk.App())).toJSON(), 'cdk', TF_REGION)
const cfnModel = (): ChannelModel => reduceCloudFormation(JSON.parse(fs.readFileSync(PUBLISHED_CFN, 'utf8')), 'cfn', TF_REGION)
const tfPlan = (): unknown => JSON.parse(fs.readFileSync(TF_FIXTURE, 'utf8'))
const tfModel = (plan: unknown = tfPlan()): ChannelModel => reduceTerraformShowJson(plan, 'terraform', TF_REGION, TF_DEPLOY_ACCOUNT)

interface TfPlan {
  planned_values: { root_module: { resources: { type: string; values: Record<string, unknown> }[] } }
}

const plannedValues = (plan: TfPlan, type: string): Record<string, unknown> => {
  const resource = plan.planned_values.root_module.resources.find((r) => r.type === type)
  if (resource === undefined) throw new Error(`fixture must carry a ${type} resource`)
  return resource.values
}

describe('013-1-23 lambda-authorizer parity — real CDK + one-click + Terraform artifacts', () => {
  it('the real committed Terraform fixture is in parity with the real CDK synth + published one-click template', () => {
    const result = gate([cdkModel(), cfnModel(), tfModel()])
    expect(result.divergences).toEqual([])
    expect(result.passed).toBe(true)
  })

  it('the authorizer, function, and execution role are recognised canonical kinds, not unmodelled fall-back nodes', () => {
    const tf = tfModel()
    const kinds = new Set(tf.graph.nodes.map((node) => node.kind))
    expect(kinds.has('apigateway-authorizer')).toBe(true)
    expect(kinds.has('lambda-function')).toBe(true)
    expect(kinds.has('iam-role')).toBe(true)
    for (const node of tf.graph.nodes) expect(node.kind.startsWith('aws_')).toBe(false)
  })

  it('the published one-click template carries the apiable:logical-id declared identity on the function and role', () => {
    const template = JSON.parse(fs.readFileSync(PUBLISHED_CFN, 'utf8')) as {
      Resources: Record<string, { Type: string; Properties?: { Tags?: { Key: string; Value: unknown }[] } }>
    }
    const taggablePrimaries = Object.values(template.Resources).filter((r) => r.Type === 'AWS::Lambda::Function' || r.Type === 'AWS::IAM::Role')
    expect(taggablePrimaries.length).toBeGreaterThan(0)
    for (const resource of taggablePrimaries) {
      const declaredId = (resource.Properties?.Tags ?? []).find((tag) => tag.Key === 'apiable:logical-id')
      expect(declaredId?.Value).toBeDefined()
    }
  })

  it('a planted Terraform-only change to the authorizer type FAILS the gate naming terraform', () => {
    const drifted = clone(tfPlan()) as TfPlan
    plannedValues(drifted, 'aws_api_gateway_authorizer').type = 'REQUEST'
    const result = gate([cdkModel(), cfnModel(), tfModel(drifted)])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find((entry) => entry.detail.includes('authorizer-type'))
    expect(divergence).toBeDefined()
    expect(divergence?.channels).toEqual(['terraform'])
  })

  it('a planted Terraform-only change to the identity source FAILS the gate naming terraform', () => {
    const drifted = clone(tfPlan()) as TfPlan
    plannedValues(drifted, 'aws_api_gateway_authorizer').identity_source = 'method.request.querystring.access_token'
    const result = gate([cdkModel(), cfnModel(), tfModel(drifted)])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find((entry) => entry.detail.includes('authorizer-identity-source'))
    expect(divergence).toBeDefined()
    expect(divergence?.channels).toEqual(['terraform'])
  })

  it('a Terraform leg widening the execution role beyond logs FAILS the gate naming terraform (the least-privilege floor)', () => {
    const drifted = clone(tfPlan()) as TfPlan
    const logsPolicy = plannedValues(drifted, 'aws_iam_role_policy')
    const document = JSON.parse(logsPolicy.policy as string) as { Statement: { Action: string[]; Resource: string }[] }
    document.Statement.push({ Action: ['sts:AssumeRole'], Resource: 'arn:aws:iam::*:role/*' })
    logsPolicy.policy = JSON.stringify(document)
    const result = gate([cdkModel(), cfnModel(), tfModel(drifted)])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find((entry) => entry.tier === 'permission')
    expect(divergence).toBeDefined()
    expect(divergence?.channels).toEqual(['terraform'])
  })
})
