/**
 * Supplementary coverage for the umbrella delegation + its CFN-equivalence engine (Story 013-1-9),
 * beyond the frozen-contract acceptance specs: engine edge cases, the strangler-gate return contract,
 * and the two drift-sensitive Cognito branches (composite assume-role for a non-Apiable account, and
 * the `aws` reserved-prefix domain) the umbrella must preserve when it delegates.
 */
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import {
  cfnDifferences,
  isCfnEquivalent,
  resourceShapes,
  publishedExports,
  assertNoStranglerDrift,
  buildCognitoStack,
} from '@apiable/umbrella'

const ACCOUNT = '034444869755'
const REGION = 'eu-central-1'
const toJson = (stack: cdk.Stack): ReturnType<Template['toJSON']> => Template.fromStack(stack).toJSON()

describe('umbrella CFN-equivalence engine — edge cases', () => {
  it('two empty templates are equivalent', () => {
    expect(cfnDifferences({}, {})).toEqual([])
    expect(isCfnEquivalent({}, {})).toBe(true)
  })

  it('a template with no Resources/Outputs yields empty shape + export maps', () => {
    expect(resourceShapes({}).size).toBe(0)
    expect(publishedExports({}).size).toBe(0)
  })

  it('an output without an Export.Name is not treated as a published cross-stack value', () => {
    const template = { Outputs: { Local: { Value: 'x' } } }
    expect(publishedExports(template).size).toBe(0)
    expect(cfnDifferences(template, {})).toEqual([])
  })

  it('a changed export value is flagged as export-changed (not a rename)', () => {
    const before = { Outputs: { A: { Value: 'one', Export: { Name: 'shared' } } } }
    const after = { Outputs: { A: { Value: 'two', Export: { Name: 'shared' } } } }
    expect(cfnDifferences(before, after)).toContainEqual({ kind: 'export-changed', detail: 'shared' })
  })

  it('an added export is flagged as export-added', () => {
    const before = {}
    const after = { Outputs: { A: { Value: 'v', Export: { Name: 'new-export' } } } }
    expect(cfnDifferences(before, after)).toContainEqual({ kind: 'export-added', detail: 'new-export' })
  })

  it('key order inside a property never registers as a difference (recursive canonicalisation)', () => {
    const before = { Resources: { R: { Type: 'X', Properties: { a: 1, nested: { p: 1, q: 2 } } } } }
    const after = { Resources: { Renamed: { Type: 'X', Properties: { nested: { q: 2, p: 1 }, a: 1 } } } }
    expect(cfnDifferences(before, after)).toEqual([])
  })

  it('assertNoStranglerDrift returns the candidate unchanged when equivalent', () => {
    const candidate = { Resources: { R: { Type: 'X', Properties: {} } } }
    expect(assertNoStranglerDrift(candidate, candidate)).toBe(candidate)
  })

  it('assertNoStranglerDrift names the drifting resource type in the thrown message', () => {
    const baseline = {}
    const candidate = { Resources: { R: { Type: 'AWS::SQS::Queue', Properties: {} } } }
    expect(() => assertNoStranglerDrift(baseline, candidate)).toThrow(/AWS::SQS::Queue/)
  })
})

describe('umbrella Cognito delegation — drift-sensitive branches preserved', () => {
  it('a non-Apiable account gets the composite assume-role principal (Apiable + the client account)', () => {
    const clientAccount = '111111111111'
    const t = toJson(buildCognitoStack(new cdk.App(), { name: 'staging', env: { account: clientAccount, region: REGION } }))
    const roles = Object.values(t.Resources ?? {}).filter((r) => (r as { Type: string }).Type === 'AWS::IAM::Role')
    const principals = JSON.stringify(roles.map((r) => (r as { Properties?: { AssumeRolePolicyDocument?: unknown } }).Properties?.AssumeRolePolicyDocument))
    // both the Apiable account and the client account appear in the trust policy
    expect(principals).toContain(ACCOUNT)
    expect(principals).toContain(clientAccount)
  })

  it('the Apiable account itself gets a single-account assume-role principal (no composite)', () => {
    const t = toJson(buildCognitoStack(new cdk.App(), { name: 'staging', env: { account: ACCOUNT, region: REGION } }))
    const adminRole = Object.values(t.Resources ?? {}).find(
      (r) => (r as { Type: string; Properties?: { RoleName?: string } }).Type === 'AWS::IAM::Role' &&
        (r as { Properties?: { RoleName?: string } }).Properties?.RoleName === 'ApiableCognitoAuthN-portal-staging',
    ) as { Properties?: { AssumeRolePolicyDocument?: { Statement?: Array<{ Principal?: { AWS?: unknown } }> } } }
    const statements = adminRole.Properties?.AssumeRolePolicyDocument?.Statement ?? []
    expect(statements).toHaveLength(1)
  })

  it('the reserved `aws` pool name uses the `apiable-aw-s` cognito domain prefix', () => {
    const t = toJson(buildCognitoStack(new cdk.App(), { name: 'aws', env: { account: ACCOUNT, region: REGION } }))
    const domain = Object.values(t.Resources ?? {}).find((r) => (r as { Type: string }).Type === 'AWS::Cognito::UserPoolDomain') as {
      Properties?: { Domain?: unknown }
    }
    expect(domain.Properties?.Domain).toBe('apiable-aw-s')
  })
})
