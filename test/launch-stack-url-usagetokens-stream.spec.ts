/**
 * Edge and error-path coverage for the usagetokens-stream Launch Stack URL generator and template
 * addressing helpers, beyond the contract scenarios in the construct spec.
 */
import {
  generateTokensLaunchStackUrl,
  tokensLaunchStackTemplateKey,
  tokensLaunchStackTemplateS3Uri,
  DEFAULT_LAUNCHSTACK_BUCKET,
} from '@apiable/cdk-usagetokens-stream'

const VALID = {
  tenantId: 't-1',
  logsBucketArn: 'arn:aws:s3:::apiable-logs-staging',
  region: 'eu-central-1',
  version: '1.0.0',
}

describe('generateTokensLaunchStackUrl (usagetokens-stream) — edge and error paths', () => {
  it('throws when the tenant id is missing', () => {
    expect(() => generateTokensLaunchStackUrl({ ...VALID, tenantId: '' })).toThrow(/tenantId|required/i)
  })

  it('throws when the storage location is missing', () => {
    expect(() => generateTokensLaunchStackUrl({ ...VALID, logsBucketArn: '' })).toThrow(/logsBucketArn|required/i)
  })

  it('throws when the region is missing', () => {
    expect(() => generateTokensLaunchStackUrl({ ...VALID, region: '' })).toThrow(/region|required/i)
  })

  it('throws when the version is missing', () => {
    expect(() => generateTokensLaunchStackUrl({ ...VALID, version: '' })).toThrow(/version|required/i)
  })

  it('rejects a storage location that is not an S3 bucket ARN', () => {
    expect(() => generateTokensLaunchStackUrl({ ...VALID, logsBucketArn: 'apiable-logs-staging' })).toThrow(/bucket ARN/i)
  })

  it('rejects a non-S3 ARN as the storage location', () => {
    expect(() =>
      generateTokensLaunchStackUrl({ ...VALID, logsBucketArn: 'arn:aws:sqs:eu-central-1:111122223333:queue' }),
    ).toThrow(/bucket ARN/i)
  })

  it('pre-fills the storage location and the versioned TOKEN template in the generated link', () => {
    const url = decodeURIComponent(generateTokensLaunchStackUrl(VALID))
    expect(url).toContain('console.aws.amazon.com/cloudformation')
    expect(url).toContain('apiable-usagetokens-stream/1.0.0/template.yaml')
    expect(url).not.toContain('apiable-usagelogs-stream') // the token link addresses the token template, not the usage-log one
    expect(url).toContain('param_LogsBucketArn=arn:aws:s3:::apiable-logs-staging')
  })

  it('addresses the template via the region-agnostic global S3 endpoint', () => {
    const url = decodeURIComponent(generateTokensLaunchStackUrl({ ...VALID, region: 'ap-southeast-2' }))
    expect(url).toContain(`${DEFAULT_LAUNCHSTACK_BUCKET}.s3.amazonaws.com/`)
    expect(url).not.toContain('.s3.ap-southeast-2.')
  })

  it('honours a custom bucket override', () => {
    const url = decodeURIComponent(generateTokensLaunchStackUrl({ ...VALID, bucket: 'tenant-bucket' }))
    expect(url).toContain('tenant-bucket.s3.')
    expect(url).not.toContain(DEFAULT_LAUNCHSTACK_BUCKET)
  })
})

describe('launch-stack template addressing (usagetokens-stream)', () => {
  it('keys a version under the immutable token component/version/template.yaml path', () => {
    expect(tokensLaunchStackTemplateKey('2.3.4')).toBe('apiable-usagetokens-stream/2.3.4/template.yaml')
  })

  it('builds the default s3 uri', () => {
    expect(tokensLaunchStackTemplateS3Uri('1.0.0')).toBe(
      `s3://${DEFAULT_LAUNCHSTACK_BUCKET}/apiable-usagetokens-stream/1.0.0/template.yaml`,
    )
  })

  it('builds an s3 uri for a custom bucket', () => {
    expect(tokensLaunchStackTemplateS3Uri('1.0.0', 'devops-bucket')).toBe(
      's3://devops-bucket/apiable-usagetokens-stream/1.0.0/template.yaml',
    )
  })
})
