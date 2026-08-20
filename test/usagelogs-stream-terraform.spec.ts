/**
 * Edge / quality coverage for the apiable-usagelogs-stream Terraform module's ingestion-path option,
 * beyond the frozen contract scenarios in the construct spec. Exercises the real module source, and
 * holds the Terraform channel to the same log-source vocabulary the CDK/published-CFN channel offers
 * so the two cannot drift into spelling a customer-visible choice differently.
 */
import * as fs from 'fs'
import * as path from 'path'
import { LOG_SOURCE_APIGATEWAY_DIRECT, LOG_SOURCE_CLOUDWATCH_LOGS } from '@apiable/cdk-usagelogs-stream'

const MODULE_DIR = path.resolve(__dirname, '../terraform/apiable-usagelogs-stream')
const moduleFile = (name: string): string => fs.readFileSync(path.join(MODULE_DIR, name), 'utf8')

describe('apiable-usagelogs-stream terraform module — the ingestion path is a declared choice', () => {
  it('declares the path as a variable defaulting to the direct one, so an existing apply is unchanged', () => {
    const variables = moduleFile('variables.tf')
    expect(variables).toMatch(/variable\s+"log_source"/)
    expect(variables).toMatch(new RegExp(`default\\s*=\\s*"${LOG_SOURCE_APIGATEWAY_DIRECT}"`))
  })

  it('constrains it to the two published spellings rather than accepting free text', () => {
    // a typo would otherwise apply a silently direct-path stream a subscription filter can never feed
    const variables = moduleFile('variables.tf')
    expect(variables).toMatch(/validation\s*{/)
    expect(variables).toContain(LOG_SOURCE_APIGATEWAY_DIRECT)
    expect(variables).toContain(LOG_SOURCE_CLOUDWATCH_LOGS)
  })

  it('spells the paths exactly as the one-click template publishes them', () => {
    // the CDK package owns the vocabulary; this asserts the hand-rolled HCL agrees with it
    expect(moduleFile('main.tf')).toContain(LOG_SOURCE_CLOUDWATCH_LOGS)
  })
})

describe('apiable-usagelogs-stream terraform module — CloudWatch-path processing', () => {
  it('keeps the destination on the extended shape, the only one that carries processors', () => {
    expect(moduleFile('main.tf')).toMatch(/extended_s3_configuration\s*{/)
  })

  it('attaches the processors on the CloudWatch path only', () => {
    const main = moduleFile('main.tf')
    expect(main).toMatch(/dynamic\s+"processing_configuration"/)
    expect(main).toMatch(
      new RegExp(`for_each\\s*=\\s*var\\.log_source\\s*==\\s*"${LOG_SOURCE_CLOUDWATCH_LOGS}"\\s*\\?\\s*\\[1\\]\\s*:\\s*\\[\\]`),
    )
  })

  it('gunzips first and unwraps second, since the second processor reads what the first produces', () => {
    const main = moduleFile('main.tf')
    expect(main.indexOf('"Decompression"')).toBeGreaterThan(-1)
    expect(main.indexOf('"Decompression"')).toBeLessThan(main.indexOf('"CloudWatchLogProcessing"'))
    expect(main).toMatch(/parameter_name\s*=\s*"CompressionFormat"[\s\S]*parameter_value\s*=\s*"GZIP"/)
    expect(main).toMatch(/parameter_name\s*=\s*"DataMessageExtraction"[\s\S]*parameter_value\s*=\s*"true"/)
  })

  it('needs no lambda to do it — both processors are native to firehose', () => {
    // asserted on declarations, not on the word: the comments explain a firehose error that names Lambda
    const main = moduleFile('main.tf')
    expect(main).not.toMatch(/type\s*=\s*"Lambda"/)
    expect(main).not.toMatch(/resource\s+"aws_lambda/)
  })
})

describe('apiable-usagelogs-stream terraform module — switching path replaces the stream', () => {
  it('triggers a replacement on the mode rather than letting terraform attempt an in-place update', () => {
    // firehose rejects both adding decompression to an existing stream and CloudWatchLogProcessing
    // without it, so an update would fail and roll back; the module destroys and re-creates instead
    const main = moduleFile('main.tf')
    expect(main).toMatch(/resource\s+"terraform_data"\s+"log_source_mode"/)
    expect(main).toMatch(/replace_triggered_by\s*=\s*\[\s*terraform_data\.log_source_mode\s*\]/)
  })

  it('still declares exactly one delivery stream, under the gateway-recognised name', () => {
    const main = moduleFile('main.tf')
    expect(main.match(/resource\s+"aws_kinesis_firehose_delivery_stream"\s+"/g)).toHaveLength(1)
    expect(main).toMatch(/name\s*=\s*"amazon-apigateway-\$\{var\.name\}"/)
  })
})
