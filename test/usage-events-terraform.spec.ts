/**
 * The apiable-usage-events Terraform module, read through the HCL reader: exactly the three inputs the
 * one-click template takes, bounded the same way, and a module that stands on its own.
 */
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { DEFAULT_APIABLE_PARTNER_ACCOUNT } from '@apiable/cdk-logs-bucket'
import { LOG_SOURCE_APIGATEWAY_DIRECT, LOG_SOURCE_VALUES } from '@apiable/cdk-usagelogs-stream'
import { HclBlock, HclCall, HclRef, parseHcl } from './support/hcl'
import { publishedTemplatePath } from './support/published-template'

const MODULE_DIR = path.resolve(__dirname, '../terraform/apiable-usage-events')
const moduleText = (name: string): string => fs.readFileSync(path.join(MODULE_DIR, name), 'utf8')
const variables = (): HclBlock[] => parseHcl(moduleText('variables.tf')).blocks.filter((block) => block.type === 'variable')
const variable = (name: string): HclBlock => {
  const matches = variables().filter((block) => block.labels[0] === name)
  expect(matches).toHaveLength(1)
  return matches[0]
}
const validationOf = (name: string): HclCall => {
  const validations = variable(name).blocks.filter((block) => block.type === 'validation')
  expect(validations).toHaveLength(1)
  return validations[0].attributes.condition as HclCall
}

/** The pattern of a `can(regex("<pattern>", var.<name>))` validation, as the module declares it. */
const validationPattern = (name: string): RegExp => {
  const can = validationOf(name)
  const regex = can.args[0] as HclCall
  expect(can.name).toBe('can')
  expect(regex.name).toBe('regex')
  expect(regex.args[1]).toEqual(new HclRef(`var.${name}`))
  return new RegExp(regex.args[0] as string)
}

describe('apiable-usage-events terraform module — its inputs', () => {
  // contract: 024-3-6 S2
  it('declares exactly name, partner_account and log_source', () => {
    expect(variables().map((block) => block.labels[0]).sort()).toEqual(['log_source', 'name', 'partner_account'])
  })

  // contract: 024-3-6 S2
  it('bounds name to the tenant-slug shape, with no default', () => {
    const pattern = validationPattern('name')

    expect(variable('name').attributes.default).toBeUndefined()
    expect(pattern.test('staging-2')).toBe(true)
    expect(pattern.test('Staging')).toBe(false)
  })

  // contract: 024-3-6 S2
  it("defaults partner_account to Apiable's account", () => {
    expect(variable('partner_account').attributes.default).toBe(DEFAULT_APIABLE_PARTNER_ACCOUNT)
    expect(validationPattern('partner_account').test(DEFAULT_APIABLE_PARTNER_ACCOUNT)).toBe(true)
  })

  // contract: 024-3-6 S2
  it('defaults log_source to direct API Gateway delivery and admits only the two supported values', () => {
    const contains = validationOf('log_source')

    expect(variable('log_source').attributes.default).toBe(LOG_SOURCE_APIGATEWAY_DIRECT)
    expect(contains).toEqual(new HclCall('contains', [[...LOG_SOURCE_VALUES], new HclRef('var.log_source')]))
  })

  // contract: 024-3-6 S2
  it('fixes the stream name and the prefix as locals, never inputs', () => {
    const main = moduleText('main.tf')

    expect(main).toMatch(/locals\s*{\s*stream_name\s*=\s*"usagelogs"\s*prefix\s*=\s*"apiable\/aws"\s*}/)
    expect(main).not.toMatch(/var\.(logs_bucket_arn|prefix|stream_name)/)
  })

  // contract: 024-3-6 S4
  it.each([
    ['empty', ''],
    ['a comma list', '034444869755,111111111111'],
    ['a wildcard', '*'],
    ['eleven digits', '03444486975'],
  ])('partner_account validation rejects %s', (_label, value) => {
    expect(validationPattern('partner_account').test(value)).toBe(false)
  })
})

describe('apiable-usage-events terraform module — it stands on its own', () => {
  it('refers to no module outside its own directory', () => {
    const all = fs.readdirSync(MODULE_DIR).filter((file) => file.endsWith('.tf')).map(moduleText).join('\n')

    expect(all).not.toMatch(/module\s+"/)
    expect(all).not.toContain('../')
  })

  it("binds the stream's destination and its delivery grant to the module's own bucket", () => {
    const main = moduleText('main.tf')

    expect(main).toMatch(/bucket_arn\s*=\s*aws_s3_bucket\.this\.arn/)
    expect(main.match(/Resource = \[aws_s3_bucket\.this\.arn, "\$\{aws_s3_bucket\.this\.arn\}\/\*"\]/g)).toHaveLength(3)
  })

  it("grants the delivery role PutLogEvents on the log group's streams, not on the bare group ARN", () => {
    const main = moduleText('main.tf')

    // The provider's aws_cloudwatch_log_group.arn has no trailing `:*`, and PutLogEvents authorises
    // against a log-stream ARN, so only the `:*` form lets Firehose write its delivery errors.
    expect(main).toMatch(/Action\s*=\s*"logs:PutLogEvents"\s*\n\s*Resource\s*=\s*"\$\{aws_cloudwatch_log_group\.firehose\.arn\}:\*"/)
    expect(main).not.toMatch(/Resource\s*=\s*aws_cloudwatch_log_group\.firehose\.arn\s*$/m)
  })

  it('publishes an archive of exactly the tracked files of its own directory', () => {
    const archive = path.join(path.dirname(publishedTemplatePath('apiable-usage-events')), 'terraform.zip')
    const listing = spawnSync('unzip', ['-Z1', archive], { encoding: 'utf8' })
    const tracked = spawnSync('git', ['ls-files', '--', '.'], { cwd: MODULE_DIR, encoding: 'utf8' })

    expect(listing.status).toBe(0)
    expect(listing.stdout.split('\n').filter((entry) => entry !== '').sort()).toEqual(tracked.stdout.split('\n').filter((entry) => entry !== '').sort())
    expect(listing.stdout).not.toContain('/')
  })

  it('outputs the bucket, the write role and the stream an API Gateway stage attaches to', () => {
    const outputs = parseHcl(moduleText('outputs.tf')).blocks.map((block) => block.labels[0]).sort()

    expect(outputs).toEqual(['bucket_arn', 'bucket_name', 'firehose_arn', 's3_assume_role_arn'])
  })
})
