/**
 * Guards the published logs-bucket launch-stack synth path. The artifact a customer deploys
 * one-click must carry no cdk-bootstrap machinery, so it installs into an un-bootstrapped account.
 * Exercises the real `buildPublishedStack` factory that `scripts/launchstack-app.ts` ships — not an
 * inline re-declaration of its synth config, which would drift and go vacuous.
 */
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import { buildPublishedStack, PARTNER_ACCOUNT_PARAMETER, TENANT_NAME_PARAMETER } from '@apiable/cdk-logs-bucket'

const publishedTemplate = (): Template => Template.fromStack(buildPublishedStack(new cdk.App()))

describe('published logs-bucket launch-stack template — un-bootstrapped deploy shape', () => {
  it('carries no cdk-bootstrap version parameter', () => {
    expect(publishedTemplate().toJSON().Parameters?.BootstrapVersion).toBeUndefined()
  })

  it('carries no bootstrap-version rule', () => {
    expect(publishedTemplate().toJSON().Rules ?? {}).toEqual({})
  })

  it('exposes the tenant name and partner account as deploy-time parameters', () => {
    const t = publishedTemplate()
    t.hasParameter(TENANT_NAME_PARAMETER, Match.objectLike({ Type: 'String' }))
    t.hasParameter(PARTNER_ACCOUNT_PARAMETER, Match.objectLike({ Type: 'String' }))
  })
})
