/**
 * The published usage-events launch-stack template, built by the same `buildPublishedStack` the publish
 * app registers: its three deploy-time inputs, and nothing a customer account cannot install.
 */
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { DEFAULT_APIABLE_PARTNER_ACCOUNT, TENANT_NAME_PATTERN_SOURCE } from '@apiable/cdk-logs-bucket'
import { LOG_SOURCE_APIGATEWAY_DIRECT, LOG_SOURCE_VALUES } from '@apiable/cdk-usagelogs-stream'
import { buildPublishedStack } from '@apiable/cdk-usage-events'

type Json = Record<string, unknown>

const published = (): Json => Template.fromStack(buildPublishedStack(new cdk.App())).toJSON()
const parameters = (): Record<string, Json> => published().Parameters as Record<string, Json>

/** Every 12-digit run in a section of the template, as the JSON text carries it. */
const accountLiteralsIn = (section: unknown): string[] => JSON.stringify(section ?? {}).match(/(?<![0-9])[0-9]{12}(?![0-9])/g) ?? []

describe('the published usage-events template declares exactly three bounded inputs', () => {
  // contract: 024-3-6 S2
  // contract: 024-3-8 S19
  it('declares the tenant name, the partner account and the log source, and nothing else', () => {
    expect(Object.keys(parameters()).sort()).toEqual(['ApiablePartnerAccount', 'LogSource', 'TenantName'])
  })

  // contract: 024-3-6 S2
  it('bounds the tenant name to the tenant-slug shape', () => {
    expect(parameters().TenantName).toMatchObject({ Type: 'String', AllowedPattern: TENANT_NAME_PATTERN_SOURCE, MinLength: 1 })
    expect(parameters().TenantName.Default).toBeUndefined()
  })

  // contract: 024-3-6 S2
  it("defaults the partner account to Apiable's and bounds it to one 12-digit account", () => {
    expect(parameters().ApiablePartnerAccount).toMatchObject({
      Type: 'String',
      Default: DEFAULT_APIABLE_PARTNER_ACCOUNT,
      AllowedPattern: '^[0-9]{12}$',
      MinLength: 12,
      MaxLength: 12,
    })
  })

  // contract: 024-3-6 S2
  it('defaults the log source to direct API Gateway delivery and admits only the two supported values', () => {
    expect(parameters().LogSource).toMatchObject({ Type: 'String', Default: LOG_SOURCE_APIGATEWAY_DIRECT, AllowedValues: [...LOG_SOURCE_VALUES] })
    expect(LOG_SOURCE_VALUES).toHaveLength(2)
  })

  it('selects the CloudWatch processing through a condition on the log source', () => {
    expect(published().Conditions).toEqual({
      iscloudwatchlogsourceusagelogs: { 'Fn::Equals': [{ Ref: 'LogSource' }, 'cloudwatch_logs'] },
    })
  })
})

describe('the published usage-events template fixes no account, asset or bootstrap machinery', () => {
  // contract: 024-3-6 S3
  it('carries no 12-digit account in its resources, conditions or outputs', () => {
    const template = published()

    expect(accountLiteralsIn(template.Resources)).toEqual([])
    expect(accountLiteralsIn(template.Conditions)).toEqual([])
    expect(accountLiteralsIn(template.Outputs)).toEqual([])
    expect(accountLiteralsIn(template.Parameters)).toEqual([DEFAULT_APIABLE_PARTNER_ACCOUNT])
  })

  // contract: 024-3-6 S3
  it('carries no asset parameter, no bootstrap-version parameter and no bootstrap rule', () => {
    const template = published()

    expect(Object.keys(parameters()).filter((name) => name.startsWith('AssetParameters') || name === 'BootstrapVersion')).toEqual([])
    expect(template.Rules ?? {}).toEqual({})
    expect(JSON.stringify(template)).not.toContain('cdk-hnb659fds')
  })
})

describe("the published template's partner-account constraint refuses anything but one account", () => {
  // contract: 024-3-6 S4
  it.each([
    ['a wildcard', '*'],
    ['a comma list', '034444869755,111111111111'],
    ['eleven digits', '03444486975'],
  ])('rejects %s', (_label, value) => {
    const { AllowedPattern, MinLength, MaxLength } = parameters().ApiablePartnerAccount as { AllowedPattern: string; MinLength: number; MaxLength: number }
    const accepted = new RegExp(AllowedPattern).test(value) && value.length >= MinLength && value.length <= MaxLength

    expect(accepted).toBe(false)
  })
})
