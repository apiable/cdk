/**
 * Build-time partner-account + required-name guards for the LogsBucket construct, beyond the
 * deploy-time bound asserted in the construct contract spec.
 */
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import {
  LogsBucketStack,
  PARTNER_ACCOUNT_PARAMETER,
  DEFAULT_APIABLE_PARTNER_ACCOUNT,
} from '@apiable/cdk-logs-bucket'

const build = (partnerAccount: string) => () =>
  new LogsBucketStack(new cdk.App(), 'lb', { name: 'staging', partnerAccount })

describe('LogsBucket — build-time partner account guard', () => {
  it('rejects a wildcard', () => {
    expect(build('*')).toThrow(/12-digit/)
  })

  it('rejects a comma-list', () => {
    expect(build('111122223333,444455556666')).toThrow(/12-digit/)
  })

  it('rejects a too-short account', () => {
    expect(build('123')).toThrow(/12-digit/)
  })

  it('rejects a 13-digit account', () => {
    expect(build('1234567890123')).toThrow(/12-digit/)
  })

  it('accepts a valid 12-digit account', () => {
    expect(build('111122223333')).not.toThrow()
  })

  it('defaults the partner parameter to the Apiable account when none is supplied', () => {
    const t = Template.fromStack(new LogsBucketStack(new cdk.App(), 'lb', { name: 'staging' }))
    t.hasParameter(PARTNER_ACCOUNT_PARAMETER, Match.objectLike({ Default: DEFAULT_APIABLE_PARTNER_ACCOUNT }))
  })
})

describe('LogsBucket — required tenant name', () => {
  it('rejects an empty name', () => {
    expect(() => new LogsBucketStack(new cdk.App(), 'lb', { name: '' })).toThrow(/name is required/)
  })
})
