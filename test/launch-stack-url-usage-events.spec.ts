/**
 * The usage-events launch link: the keys it pre-fills, and the values it refuses before a link exists.
 */
import { DEFAULT_APIABLE_PARTNER_ACCOUNT, DEFAULT_LAUNCHSTACK_BUCKET } from '@apiable/cdk-logs-bucket'
import { generateLaunchStackUrl, launchStackTemplateKey, launchStackTemplateS3Uri } from '@apiable/cdk-usage-events'

const VALID = {
  tenantId: 't-1',
  tenantName: 'staging',
  writeAccount: DEFAULT_APIABLE_PARTNER_ACCOUNT,
  region: 'eu-central-1',
  version: '1.0.0',
}

const queryOf = (url: string): URLSearchParams => new URLSearchParams(url.split('#/stacks/create/review?')[1])

describe('generateLaunchStackUrl (usage-events)', () => {
  it('points at the versioned template and pre-fills the tenant name and the partner account only', () => {
    const query = queryOf(generateLaunchStackUrl(VALID))

    expect(query.get('templateURL')).toBe(`https://${DEFAULT_LAUNCHSTACK_BUCKET}.s3.amazonaws.com/apiable-usage-events/1.0.0/template.yaml`)
    expect(query.get('stackName')).toBe('apiable-usage-events')
    expect([...query.keys()].sort()).toEqual(['param_ApiablePartnerAccount', 'param_TenantName', 'stackName', 'templateURL'])
    expect(query.get('param_TenantName')).toBe('staging')
    expect(query.get('param_ApiablePartnerAccount')).toBe(DEFAULT_APIABLE_PARTNER_ACCOUNT)
  })

  it('opens the console in the requested region', () => {
    expect(generateLaunchStackUrl(VALID)).toMatch(/^https:\/\/eu-central-1\.console\.aws\.amazon\.com\/cloudformation\/home\?region=eu-central-1#/)
  })

  it('pre-fills the log source only when one is given', () => {
    expect(queryOf(generateLaunchStackUrl({ ...VALID, logSource: 'cloudwatch_logs' })).get('param_LogSource')).toBe('cloudwatch_logs')
  })

  it('refuses a log source the stream does not support', () => {
    expect(() => generateLaunchStackUrl({ ...VALID, logSource: 'kinesis' })).toThrow('logSource must be one of apigateway_direct, cloudwatch_logs')
  })

  // contract: 024-3-6 S4
  it.each([
    ['a wildcard', '*'],
    ['a list', '034444869755,111111111111'],
    ['eleven digits', '03444486975'],
  ])('refuses a partner account that is %s', (_label, writeAccount) => {
    expect(() => generateLaunchStackUrl({ ...VALID, writeAccount })).toThrow('write account must be exactly one 12-digit AWS account id')
  })

  // contract: 024-3-6 S4
  it('refuses an empty partner account', () => {
    expect(() => generateLaunchStackUrl({ ...VALID, writeAccount: '' })).toThrow('write account is required')
  })

  // contract: 024-3-6 S4
  it.each(['Staging', 'acme_corp', 'acme corp'])('refuses the tenant name %s', (tenantName) => {
    expect(() => generateLaunchStackUrl({ ...VALID, tenantName })).toThrow('tenantName must be lowercase letters, digits, and hyphens')
  })

  it.each([
    ['tenant id', { tenantId: '' }, 'tenantId is required'],
    ['tenant name', { tenantName: '' }, 'tenantName is required'],
    ['region', { region: '' }, 'region is required'],
    ['version', { version: '' }, 'version is required'],
  ])('refuses a missing %s', (_label, override, message) => {
    expect(() => generateLaunchStackUrl({ ...VALID, ...override })).toThrow(message)
  })

  it('addresses the template key and s3 uri under the construct name and version', () => {
    expect(launchStackTemplateKey('1.0.0')).toBe('apiable-usage-events/1.0.0/template.yaml')
    expect(launchStackTemplateS3Uri('1.0.0', 'bucket-x')).toBe('s3://bucket-x/apiable-usage-events/1.0.0/template.yaml')
  })
})
