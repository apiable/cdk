/**
 * Governed acceptance spec — Story 013-1-21: the release parity check models the Firehose usage-stream tier.
 * Frozen contract: contract-013-1-21-parity-gate-stream-capability.md (sha 458da9409c3c).
 *
 * One executable test per contract scenario S1–S5, run against the REAL parity engine
 * (gate + reduceCloudFormation + reduceTerraformShowJson) over the usage-log + api-key-token stream
 * channels. Relocated from _bmad-output/test-artifacts/ and un-skipped per the sprint-loop ATDD-awareness
 * step; the frozen contract file itself is immutable. The deeper unit edges live in
 * parity-gate-stream.ta.spec.ts and the full real-artifact cross-channel proof in
 * parity-gate-stream-real-tf.spec.ts; this spec pins the contract scenarios themselves.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { buildPublishedStack, buildPublishedTokensStack } from '@apiable/cdk-usagelogs-stream'
import { ChannelModel, gate, reduceCloudFormation, reduceTerraformShowJson } from '@apiable/parity-gate'

const REPO_ROOT = path.resolve(__dirname, '..')
const REGION = 'eu-central-1'
const DEPLOY = '111111111111'
const PUBLISHED_LOGS = path.join(REPO_ROOT, 'dist/launchstack/apiable-usagelogs-stream/1.0.0/template.json')
const PUBLISHED_TOKENS = path.join(REPO_ROOT, 'dist/launchstack/apiable-usagetokens-stream/1.0.0/template.json')
const TF_LOGS = path.join(REPO_ROOT, 'test/fixtures/parity-gate/terraform-usagelogs-stream-show.json')
const TF_TOKENS = path.join(REPO_ROOT, 'test/fixtures/parity-gate/terraform-usagetokens-stream-show.json')

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const cdkLogs = (): ChannelModel => reduceCloudFormation(Template.fromStack(buildPublishedStack(new cdk.App())).toJSON(), 'cdk')
const cfnLogs = (): ChannelModel => reduceCloudFormation(JSON.parse(fs.readFileSync(PUBLISHED_LOGS, 'utf8')), 'cfn')
const tfLogsPlan = (): unknown => JSON.parse(fs.readFileSync(TF_LOGS, 'utf8'))
const tfLogs = (plan: unknown = tfLogsPlan()): ChannelModel => reduceTerraformShowJson(plan, 'terraform', REGION, DEPLOY)

const cdkTokens = (): ChannelModel => reduceCloudFormation(Template.fromStack(buildPublishedTokensStack(new cdk.App())).toJSON(), 'cdk')
const cfnTokens = (): ChannelModel => reduceCloudFormation(JSON.parse(fs.readFileSync(PUBLISHED_TOKENS, 'utf8')), 'cfn')
const tfTokens = (): ChannelModel => reduceTerraformShowJson(JSON.parse(fs.readFileSync(TF_TOKENS, 'utf8')), 'terraform', REGION, DEPLOY)

interface TfPlan {
  planned_values: { root_module: { resources: { type: string; values: Record<string, unknown> }[] } }
}
const streamConfig = (plan: TfPlan): Record<string, unknown> => {
  const stream = plan.planned_values.root_module.resources.find((r) => r.type === 'aws_kinesis_firehose_delivery_stream')
  return (stream?.values.extended_s3_configuration as Record<string, unknown>[])[0]
}

describe('013-1-21 parity check — usage-stream tier', () => {
  // S1 — the engine models the stream tier; equivalent streams reconcile across all 3 channels
  it('S1: an equivalent usage delivery stream (+ log group/log stream/destination/role) across all 3 channels → parity holds (stream/log-group/log-stream are recognised kinds, not unmodelled fall-back nodes)', () => {
    const result = gate([cdkLogs(), cfnLogs(), tfLogs()])
    expect(result.divergences).toEqual([])
    expect(result.passed).toBe(true)
    const kinds = new Set(tfLogs().graph.nodes.map((node) => node.kind))
    expect(kinds.has('firehose-delivery-stream')).toBe(true)
    expect(kinds.has('logs-log-group')).toBe(true)
    expect(kinds.has('logs-log-stream')).toBe(true)
  })

  // S2 — a divergent stream destination/routing/delivery-role is caught by value (FORCING — security)
  it('S2: a TF-only change to the destination routing prefix / server-side-logging-enabled → the check FAILS naming terraform (caught by value, not presence)', () => {
    const driftedPrefix = clone(tfLogsPlan()) as TfPlan
    streamConfig(driftedPrefix).prefix = 'apiable/aws/hijacked/logs/'
    const prefixResult = gate([cdkLogs(), cfnLogs(), tfLogs(driftedPrefix)])
    expect(prefixResult.passed).toBe(false)
    expect(prefixResult.divergences.find((entry) => entry.detail.includes('destination-prefix'))?.channels).toEqual(['terraform'])

    const driftedLogging = clone(tfLogsPlan()) as TfPlan
    ;(streamConfig(driftedLogging).cloudwatch_logging_options as Record<string, unknown>[])[0].enabled = false
    const loggingResult = gate([cdkLogs(), cfnLogs(), tfLogs(driftedLogging)])
    expect(loggingResult.passed).toBe(false)
    expect(loggingResult.divergences.find((entry) => entry.detail.includes('cloudwatch-logging-enabled'))?.channels).toEqual(['terraform'])
  })

  // S3 — the REAL committed Terraform module is engine-compared cross-channel (FORCING)
  it('S3: the real committed terraform show -json stream fixture is reduced + gate()-compared vs real CDK synth + published CFN (not regex-matched); a planted TF-only drift → gate FAILS', () => {
    expect(gate([cdkLogs(), cfnLogs(), tfLogs()]).passed).toBe(true)
    const drifted = clone(tfLogsPlan()) as TfPlan
    streamConfig(drifted).compression_format = 'GZIP'
    const result = gate([cdkLogs(), cfnLogs(), tfLogs(drifted)])
    expect(result.passed).toBe(false)
    expect(result.divergences.find((entry) => entry.detail.includes('compression-format'))?.channels).toEqual(['terraform'])
  })

  // S4 — an under-specified stream cannot silently pass (fail-closed)
  it('S4: a stream attribute present in one channel and absent in another (dropped cw-logging block) → divergence reported, never collapsed to "present"', () => {
    const drifted = clone(tfLogsPlan()) as TfPlan
    delete streamConfig(drifted).cloudwatch_logging_options
    const result = gate([cdkLogs(), cfnLogs(), tfLogs(drifted)])
    expect(result.passed).toBe(false)
    expect(result.divergences.find((entry) => entry.detail.includes('cloudwatch-logging-enabled'))?.channels).toEqual(['terraform'])
  })

  // S5 — two streams of one kind never collapse onto one identity
  it('S5: the usage-log + api-key-token streams stay distinct (distinguished by their delivery role); each distribution reconciles independently', () => {
    const logRef = tfLogs().graph.nodes.find((node) => node.kind === 'firehose-delivery-stream')?.ref
    const tokenRef = tfTokens().graph.nodes.find((node) => node.kind === 'firehose-delivery-stream')?.ref
    expect(logRef).toBe('firehose-delivery-stream:of-role:apiable-usagelogs-firehose-role')
    expect(tokenRef).toBe('firehose-delivery-stream:of-role:apiable-usagetokens-firehose-role')
    expect(logRef).not.toEqual(tokenRef)
    expect(gate([cdkTokens(), cfnTokens(), tfTokens()]).passed).toBe(true)
  })
})
