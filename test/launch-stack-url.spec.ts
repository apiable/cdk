/**
 * Edge and error-path coverage for the Launch Stack URL generator and template
 * addressing helpers, beyond the contract scenarios in the construct spec.
 */
import {
  generateLaunchStackUrl,
  launchStackTemplateKey,
  launchStackTemplateS3Uri,
  DEFAULT_LAUNCHSTACK_BUCKET,
  DEFAULT_APIABLE_TRUST_ACCOUNT,
} from '@apiable/cdk-gateway-role'

const VALID = {
  tenantId: 't-1',
  roleTrustTarget: DEFAULT_APIABLE_TRUST_ACCOUNT,
  region: 'eu-central-1',
  version: '1.0.0',
}

describe('generateLaunchStackUrl — edge and error paths', () => {
  it('throws when the tenant id is missing', () => {
    expect(() => generateLaunchStackUrl({ ...VALID, tenantId: '' })).toThrow(/tenantId|required/i)
  })

  it('throws when the region is missing', () => {
    expect(() => generateLaunchStackUrl({ ...VALID, region: '' })).toThrow(/region|required/i)
  })

  it('throws when the version is missing', () => {
    expect(() => generateLaunchStackUrl({ ...VALID, version: '' })).toThrow(/version|required/i)
  })

  it('rejects a wildcard trust target', () => {
    expect(() => generateLaunchStackUrl({ ...VALID, roleTrustTarget: '*' })).toThrow(/account/i)
  })

  it('rejects a comma-list trust target', () => {
    expect(() =>
      generateLaunchStackUrl({ ...VALID, roleTrustTarget: '111122223333,444455556666' }),
    ).toThrow(/account/i)
  })

  it('rejects a non-12-digit trust target', () => {
    expect(() => generateLaunchStackUrl({ ...VALID, roleTrustTarget: '123' })).toThrow(/account/i)
  })

  it('uses the default launchstack bucket when none is supplied', () => {
    expect(decodeURIComponent(generateLaunchStackUrl(VALID))).toContain(
      `${DEFAULT_LAUNCHSTACK_BUCKET}.s3.`,
    )
  })

  it('honours a custom bucket override', () => {
    const url = decodeURIComponent(generateLaunchStackUrl({ ...VALID, bucket: 'tenant-bucket' }))
    expect(url).toContain('tenant-bucket.s3.')
    expect(url).not.toContain(DEFAULT_LAUNCHSTACK_BUCKET)
  })
})

describe('launch-stack template addressing', () => {
  it('keys a version under the immutable component/version/template.yaml path', () => {
    expect(launchStackTemplateKey('2.3.4')).toBe('apiable-gateway-role/2.3.4/template.yaml')
  })

  it('builds the default s3 uri', () => {
    expect(launchStackTemplateS3Uri('1.0.0')).toBe(
      `s3://${DEFAULT_LAUNCHSTACK_BUCKET}/apiable-gateway-role/1.0.0/template.yaml`,
    )
  })

  it('builds an s3 uri for a custom bucket', () => {
    expect(launchStackTemplateS3Uri('1.0.0', 'devops-bucket')).toBe(
      's3://devops-bucket/apiable-gateway-role/1.0.0/template.yaml',
    )
  })
})
