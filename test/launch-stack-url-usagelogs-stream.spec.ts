/**
 * Edge and error-path coverage for the usagelogs-stream Launch Stack URL generator and template
 * addressing helpers, beyond the contract scenarios in the construct spec.
 */
import {
  generateLaunchStackUrl,
  launchStackTemplateKey,
  launchStackTemplateS3Uri,
  DEFAULT_LAUNCHSTACK_BUCKET,
} from '@apiable/cdk-usagelogs-stream'

const VALID = {
  tenantId: 't-1',
  logsBucketArn: 'arn:aws:s3:::apiable-logs-staging',
  region: 'eu-central-1',
  version: '1.0.0',
}

describe('generateLaunchStackUrl (usagelogs-stream) — edge and error paths', () => {
  it('throws when the tenant id is missing', () => {
    expect(() => generateLaunchStackUrl({ ...VALID, tenantId: '' })).toThrow(/tenantId|required/i)
  })

  it('throws when the storage location is missing', () => {
    expect(() => generateLaunchStackUrl({ ...VALID, logsBucketArn: '' })).toThrow(/logsBucketArn|required/i)
  })

  it('throws when the region is missing', () => {
    expect(() => generateLaunchStackUrl({ ...VALID, region: '' })).toThrow(/region|required/i)
  })

  it('throws when the version is missing', () => {
    expect(() => generateLaunchStackUrl({ ...VALID, version: '' })).toThrow(/version|required/i)
  })

  it('rejects a storage location that is not an S3 bucket ARN', () => {
    expect(() => generateLaunchStackUrl({ ...VALID, logsBucketArn: 'apiable-logs-staging' })).toThrow(/bucket ARN/i)
  })

  it('rejects a non-S3 ARN as the storage location', () => {
    expect(() =>
      generateLaunchStackUrl({ ...VALID, logsBucketArn: 'arn:aws:sqs:eu-central-1:111122223333:queue' }),
    ).toThrow(/bucket ARN/i)
  })

  it('pre-fills the storage location and the versioned template in the generated link', () => {
    const url = decodeURIComponent(generateLaunchStackUrl(VALID))
    expect(url).toContain('console.aws.amazon.com/cloudformation')
    expect(url).toContain('apiable-usagelogs-stream/1.0.0/template.yaml')
    expect(url).toContain('param_LogsBucketArn=arn:aws:s3:::apiable-logs-staging')
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

describe('launch-stack template addressing (usagelogs-stream)', () => {
  it('keys a version under the immutable component/version/template.yaml path', () => {
    expect(launchStackTemplateKey('2.3.4')).toBe('apiable-usagelogs-stream/2.3.4/template.yaml')
  })

  it('builds the default s3 uri', () => {
    expect(launchStackTemplateS3Uri('1.0.0')).toBe(
      `s3://${DEFAULT_LAUNCHSTACK_BUCKET}/apiable-usagelogs-stream/1.0.0/template.yaml`,
    )
  })

  it('builds an s3 uri for a custom bucket', () => {
    expect(launchStackTemplateS3Uri('1.0.0', 'devops-bucket')).toBe(
      's3://devops-bucket/apiable-usagelogs-stream/1.0.0/template.yaml',
    )
  })
})
