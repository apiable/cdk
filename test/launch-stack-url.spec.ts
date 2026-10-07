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
import { publishedVersion } from './support/published-template'

const EXTERNAL_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

const VALID = {
  tenantId: 't-1',
  roleTrustTarget: DEFAULT_APIABLE_TRUST_ACCOUNT,
  externalId: EXTERNAL_ID,
  region: 'eu-central-1',
  version: publishedVersion('apiable-gateway-role'),
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

  it('throws when the external ID is missing', () => {
    expect(() => generateLaunchStackUrl({ ...VALID, externalId: '' })).toThrow(/external ID is required/)
  })

  it('rejects a wildcard external ID', () => {
    expect(() => generateLaunchStackUrl({ ...VALID, externalId: '*' })).toThrow(/external ID must be exactly one/)
  })

  it('rejects a list of external IDs', () => {
    expect(() =>
      generateLaunchStackUrl({ ...VALID, externalId: `${EXTERNAL_ID},f6e5d4c3-b2a1-4c8d-9e0f-5d4c3b2a1f0e` }),
    ).toThrow(/external ID must be exactly one/)
  })

  it('rejects an uppercase external ID', () => {
    expect(() => generateLaunchStackUrl({ ...VALID, externalId: EXTERNAL_ID.toUpperCase() })).toThrow(/external ID must be exactly one/)
  })

  it('pre-fills the external ID as a deployment parameter', () => {
    expect(generateLaunchStackUrl(VALID)).toContain(`param_ApiableExternalId=${EXTERNAL_ID}`)
  })

  it('uses the default launchstack bucket when none is supplied', () => {
    expect(decodeURIComponent(generateLaunchStackUrl(VALID))).toContain(
      `${DEFAULT_LAUNCHSTACK_BUCKET}.s3.`,
    )
  })

  it('addresses the template via the region-agnostic global S3 endpoint', () => {
    // the host bucket is single-region; the deploy region must not be embedded in the S3 host
    // or the console fetches the template cross-region and 301s
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

describe('generateLaunchStackUrl — only 1.0.0 and 2.0.0 take no external ID', () => {
  const linksWithoutId: readonly (readonly [string, string])[] = [
    ['1.0.0', 'https://eu-central-1.console.aws.amazon.com/cloudformation/home?region=eu-central-1#/stacks/create/review?templateURL=https%3A%2F%2Fapiable-launchstack-templates.s3.amazonaws.com%2Fapiable-gateway-role%2F1.0.0%2Ftemplate.yaml&stackName=apiable-gateway-role&param_ApiableTrustAccount=034444869755'],
    ['2.0.0', 'https://eu-central-1.console.aws.amazon.com/cloudformation/home?region=eu-central-1#/stacks/create/review?templateURL=https%3A%2F%2Fapiable-launchstack-templates.s3.amazonaws.com%2Fapiable-gateway-role%2F2.0.0%2Ftemplate.yaml&stackName=apiable-gateway-role&param_ApiableTrustAccount=034444869755'],
  ]

  it.each(linksWithoutId)('%s with no external ID, or an empty one, gets a link that pre-fills the trust account and nothing else', (version, link) => {
    expect(generateLaunchStackUrl({ ...VALID, externalId: undefined, version })).toBe(link)
    expect(generateLaunchStackUrl({ ...VALID, externalId: '', version })).toBe(link)
  })

  it.each(linksWithoutId)('%s refuses an external ID', (version) => {
    expect(() => generateLaunchStackUrl({ ...VALID, version })).toThrow(
      new Error(`apiable-gateway-role@${version} takes no external ID: generate its launch stack URL without one`),
    )
  })

  it.each(['2.0.1', '10.0.0', '2.0', 'v2.0.0', 'latest', '2.0.0 ', ' 2.0.0'])('"%s" with no external ID is refused', (version) => {
    expect(() => generateLaunchStackUrl({ ...VALID, externalId: undefined, version })).toThrow(/external ID is required/)
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
