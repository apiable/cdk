/**
 * Build-time trust-account guard for the GatewayRole construct, beyond the deploy-time
 * bound asserted in the construct contract spec.
 */
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import {
  GatewayRoleStack,
  TRUST_ACCOUNT_PARAMETER,
  DEFAULT_APIABLE_TRUST_ACCOUNT,
} from '@apiable/cdk-gateway-role'

const build = (trustAccount: string) => () =>
  new GatewayRoleStack(new cdk.App(), 'gw', { trustAccount })

describe('GatewayRole — build-time trust account guard', () => {
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

  it('defaults the trust parameter to the Apiable account when none is supplied', () => {
    const t = Template.fromStack(new GatewayRoleStack(new cdk.App(), 'gw'))
    t.hasParameter(TRUST_ACCOUNT_PARAMETER, Match.objectLike({ Default: DEFAULT_APIABLE_TRUST_ACCOUNT }))
  })
})
