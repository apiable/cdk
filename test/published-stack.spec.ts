/**
 * Guards the published launch-stack synth path. The artifact a customer deploys one-click must
 * carry no cdk-bootstrap machinery, so it installs into an un-bootstrapped account (AC4).
 * Exercises the real `buildPublishedStack` factory that `scripts/launchstack-app.ts` ships —
 * not an inline re-declaration of its synth config, which would drift and go vacuous.
 *
 * The sibling construct spec asserts the DEFAULT synthesizer (which carries a BootstrapVersion
 * parameter + CheckBootstrapVersion rule); this spec proves the published artifact drops both.
 */
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import { buildPublishedStack, TRUST_ACCOUNT_PARAMETER } from '@apiable/cdk-gateway-role'

const publishedTemplate = (): Template => Template.fromStack(buildPublishedStack(new cdk.App()))

describe('published launch-stack template — un-bootstrapped deploy shape', () => {
  it('carries no cdk-bootstrap version parameter', () => {
    expect(publishedTemplate().toJSON().Parameters?.BootstrapVersion).toBeUndefined()
  })

  it('carries no bootstrap-version rule', () => {
    expect(publishedTemplate().toJSON().Rules ?? {}).toEqual({})
  })

  it('still exposes the trust account as a deploy-time parameter', () => {
    publishedTemplate().hasParameter(TRUST_ACCOUNT_PARAMETER, Match.objectLike({ Type: 'String' }))
  })
})
