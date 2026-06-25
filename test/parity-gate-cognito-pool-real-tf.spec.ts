/**
 * Story 013-1-23 — the apiable-cognito-pool tier policed by the REAL parity engine over REAL artifacts.
 *
 * The gate's only independent implementation of the cognito pool is the hand-rolled Terraform module
 * (the CDK construct and the one-click CFN are both CDK synth), so the committed `terraform show -json`
 * fixture is fed THROUGH gate() cross-channel against the real CDK synth + published one-click template
 * — not consumed only by the same-channel regen self-check. This is the cognito analogue of 013-1-15's
 * parity-gate-logs-bucket-real-tf.spec.ts: three real channels reduced and compared, plus a planted
 * Terraform-only drift in a load-bearing pool value that must fail the gate so the TF leg is proven
 * genuinely engine-compared.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { buildPublishedStack } from '@apiable/cdk-cognito-pool'
import { ChannelModel, gate, reduceCloudFormation, reduceTerraformShowJson } from '@apiable/parity-gate'

const REPO_ROOT = path.resolve(__dirname, '..')
const PUBLISHED_CFN = path.join(REPO_ROOT, 'dist/launchstack/apiable-cognito-pool/1.0.0/template.json')
const TF_FIXTURE = path.join(REPO_ROOT, 'test/fixtures/parity-gate/terraform-cognito-pool-show.json')
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

describe('013-1-23 cognito-pool parity — real CDK + one-click + Terraform artifacts', () => {
  it('the real committed Terraform fixture is in parity with the real CDK synth + published one-click template', () => {
    const result = gate([cdkModel(), cfnModel(), tfModel()])
    expect(result.divergences).toEqual([])
    expect(result.passed).toBe(true)
  })

  it('the pool, pre-token function, and execution role are recognised canonical kinds, not unmodelled fall-back nodes', () => {
    const tf = tfModel()
    const kinds = new Set(tf.graph.nodes.map((node) => node.kind))
    expect(kinds.has('cognito-user-pool')).toBe(true)
    expect(kinds.has('cognito-resource-server')).toBe(true)
    expect(kinds.has('cognito-user-pool-client')).toBe(true)
    expect(kinds.has('cognito-user-pool-domain')).toBe(true)
    expect(kinds.has('lambda-function')).toBe(true)
    // none reduced to the raw channel-native type string (the fall-back the gate would be blind to)
    for (const node of tf.graph.nodes) expect(node.kind.startsWith('aws_')).toBe(false)
  })

  it('the published one-click template carries the apiable:logical-id declared identity on its taggable primaries', () => {
    const template = JSON.parse(fs.readFileSync(PUBLISHED_CFN, 'utf8')) as {
      Resources: Record<string, { Type: string; Properties?: { Tags?: { Key: string; Value: unknown }[]; UserPoolTags?: Record<string, unknown> } }>
    }
    const pool = Object.values(template.Resources).find((r) => r.Type === 'AWS::Cognito::UserPool')
    expect(pool?.Properties?.UserPoolTags?.['apiable:logical-id']).toBe('apiable-cognito-pool')
    const taggablePrimaries = Object.values(template.Resources).filter((r) => r.Type === 'AWS::Lambda::Function' || r.Type === 'AWS::IAM::Role')
    expect(taggablePrimaries.length).toBeGreaterThan(0)
    for (const resource of taggablePrimaries) {
      const declaredId = (resource.Properties?.Tags ?? []).find((tag) => tag.Key === 'apiable:logical-id')
      expect(declaredId?.Value).toBeDefined()
    }
  })

  it('a planted Terraform-only change to the pool feature tier FAILS the gate naming terraform', () => {
    const drifted = clone(tfPlan()) as TfPlan
    plannedValues(drifted, 'aws_cognito_user_pool').user_pool_tier = 'LITE'
    const result = gate([cdkModel(), cfnModel(), tfModel(drifted)])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find((entry) => entry.detail.includes('user-pool-tier'))
    expect(divergence).toBeDefined()
    expect(divergence?.channels).toEqual(['terraform'])
  })

  it('a planted Terraform-only downgrade of the token-customisation version FAILS the gate naming terraform', () => {
    const drifted = clone(tfPlan()) as TfPlan
    const lambdaConfig = (plannedValues(drifted, 'aws_cognito_user_pool').lambda_config as Record<string, unknown>[])[0]
    ;(lambdaConfig.pre_token_generation_config as Record<string, unknown>[])[0].lambda_version = 'V1_0'
    const result = gate([cdkModel(), cfnModel(), tfModel(drifted)])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find((entry) => entry.detail.includes('pretokengen-version'))
    expect(divergence).toBeDefined()
    expect(divergence?.channels).toEqual(['terraform'])
  })
})
