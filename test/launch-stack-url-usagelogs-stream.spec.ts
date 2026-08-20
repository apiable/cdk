/**
 * Edge and error-path coverage for the usagelogs-stream Launch Stack URL generator and template
 * addressing helpers, beyond the contract scenarios in the construct spec.
 */
import {
  generateLaunchStackUrl,
  launchStackTemplateKey,
  launchStackTemplateS3Uri,
  DEFAULT_LAUNCHSTACK_BUCKET,
  LOG_SOURCE_APIGATEWAY_DIRECT,
  LOG_SOURCE_CLOUDWATCH_LOGS,
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

/**
 * The link the provisioning wizard hands a customer pre-fills the ingestion path, so choosing the
 * CloudWatch route is a property of the link rather than a step the customer has to get right in the
 * console. Leaving it unset must produce exactly the link this generator produced before the second
 * path existed.
 */
describe('generateLaunchStackUrl (usagelogs-stream) — ingestion path pre-fill', () => {
  it('pre-fills the CloudWatch path when the wizard asks for it', () => {
    const url = generateLaunchStackUrl({ ...VALID, logSource: LOG_SOURCE_CLOUDWATCH_LOGS })
    expect(url).toContain(`param_LogSource=${LOG_SOURCE_CLOUDWATCH_LOGS}`)
  })

  it('pre-fills the direct path when the wizard asks for it explicitly', () => {
    const url = generateLaunchStackUrl({ ...VALID, logSource: LOG_SOURCE_APIGATEWAY_DIRECT })
    expect(url).toContain(`param_LogSource=${LOG_SOURCE_APIGATEWAY_DIRECT}`)
  })

  it('omits the parameter entirely when no path is named, leaving the template default to decide', () => {
    expect(generateLaunchStackUrl(VALID)).not.toContain('param_LogSource')
  })

  it('rejects a path the template would refuse, rather than shipping a link that fails at deploy', () => {
    expect(() => generateLaunchStackUrl({ ...VALID, logSource: 'cloudwatch' })).toThrow(/logSource must be one of/)
  })
})
