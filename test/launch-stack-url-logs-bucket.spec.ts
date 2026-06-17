/**
 * Edge and error-path coverage for the logs-bucket Launch Stack URL generator and template
 * addressing helpers, beyond the contract scenarios in the construct spec.
 */
import {
  generateLaunchStackUrl,
  launchStackTemplateKey,
  launchStackTemplateS3Uri,
  DEFAULT_LAUNCHSTACK_BUCKET,
  DEFAULT_APIABLE_PARTNER_ACCOUNT,
} from '@apiable/cdk-logs-bucket'

const VALID = {
  tenantId: 't-1',
  tenantName: 'staging',
  writeAccount: DEFAULT_APIABLE_PARTNER_ACCOUNT,
  region: 'eu-central-1',
  version: '1.0.0',
}

describe('generateLaunchStackUrl (logs-bucket) — edge and error paths', () => {
  it('throws when the tenant id is missing', () => {
    expect(() => generateLaunchStackUrl({ ...VALID, tenantId: '' })).toThrow(/tenantId|required/i)
  })

  it('throws when the tenant name is missing', () => {
    expect(() => generateLaunchStackUrl({ ...VALID, tenantName: '' })).toThrow(/tenantName|required/i)
  })

  it('throws when the write account is missing', () => {
    expect(() => generateLaunchStackUrl({ ...VALID, writeAccount: '' })).toThrow(/account|required/i)
  })

  it('throws when the region is missing', () => {
    expect(() => generateLaunchStackUrl({ ...VALID, region: '' })).toThrow(/region|required/i)
  })

  it('throws when the version is missing', () => {
    expect(() => generateLaunchStackUrl({ ...VALID, version: '' })).toThrow(/version|required/i)
  })

  it('rejects a wildcard write account', () => {
    expect(() => generateLaunchStackUrl({ ...VALID, writeAccount: '*' })).toThrow(/account/i)
  })

  it('rejects a comma-list write account', () => {
    expect(() =>
      generateLaunchStackUrl({ ...VALID, writeAccount: '111122223333,444455556666' }),
    ).toThrow(/account/i)
  })

  it('rejects a non-12-digit write account', () => {
    expect(() => generateLaunchStackUrl({ ...VALID, writeAccount: '123' })).toThrow(/account/i)
  })

  it('rejects a tenant name with uppercase or special characters', () => {
    expect(() => generateLaunchStackUrl({ ...VALID, tenantName: 'Staging_1' })).toThrow(/tenantName/i)
  })

  it('pre-fills both deploy-time parameters and the versioned template in the generated link', () => {
    const url = decodeURIComponent(generateLaunchStackUrl(VALID))
    expect(url).toContain('console.aws.amazon.com/cloudformation')
    expect(url).toContain('apiable-logs-bucket/1.0.0/template.yaml')
    expect(url).toContain('param_TenantName=staging')
    expect(url).toContain(`param_ApiablePartnerAccount=${DEFAULT_APIABLE_PARTNER_ACCOUNT}`)
  })

  it('addresses the template via the region-agnostic global S3 endpoint', () => {
    const url = decodeURIComponent(generateLaunchStackUrl({ ...VALID, region: 'ap-southeast-2' }))
    expect(url).toContain(`${DEFAULT_LAUNCHSTACK_BUCKET}.s3.amazonaws.com/`)
    expect(url).not.toContain('.s3.ap-southeast-2.')
  })

  it('honours a custom bucket override', () => {
    const url = decodeURIComponent(generateLaunchStackUrl({ ...VALID, bucket: 'tenant-bucket' }))
    expect(url).toContain('tenant-bucket.s3.')
    expect(url).not.toContain(DEFAULT_LAUNCHSTACK_BUCKET)
  })
})

describe('launch-stack template addressing (logs-bucket)', () => {
  it('keys a version under the immutable component/version/template.yaml path', () => {
    expect(launchStackTemplateKey('2.3.4')).toBe('apiable-logs-bucket/2.3.4/template.yaml')
  })

  it('builds the default s3 uri', () => {
    expect(launchStackTemplateS3Uri('1.0.0')).toBe(
      `s3://${DEFAULT_LAUNCHSTACK_BUCKET}/apiable-logs-bucket/1.0.0/template.yaml`,
    )
  })

  it('builds an s3 uri for a custom bucket', () => {
    expect(launchStackTemplateS3Uri('1.0.0', 'devops-bucket')).toBe(
      's3://devops-bucket/apiable-logs-bucket/1.0.0/template.yaml',
    )
  })
})
