/**
 * Supplementary coverage beyond the frozen contract for the resource-list set generator and its parity
 * reducer: the string form of Fn::GetAtt, a cycle with no build order, a template that is not one, and
 * the reducer's region rule touching only an ARN's region segment. Every case drives the real code.
 */
import * as fs from 'fs'
import { generateConsoleResourceSet } from '@apiable/cdk-console-explainer'
import { reduceConsoleResourceSet } from '@apiable/parity-gate'
import { USAGE_EVENTS_CONSOLE_REDUCTION, generateUsageEventsConsoleSet } from '../lib/usage-events/console-instructions'
import { publishedTemplatePath } from './support/published-template'

const OPTIONS = { construct: 'apiable-test', version: '1.0.0', parameterTokens: {}, documentedParameters: {} }
const role = (name: string, extra: Record<string, unknown> = {}) => ({ Type: 'AWS::IAM::Role', Properties: { RoleName: name, ...extra } })

describe('resource-list set generator (TA) — boundaries', () => {
  it('resolves the string form of Fn::GetAtt like the list form', () => {
    const set = generateConsoleResourceSet(
      { Resources: { A: role('a'), B: role('b', { Description: { 'Fn::GetAtt': 'A.Arn' } }) } },
      OPTIONS,
    )
    expect(set.resources[1].document.Description).toBe('arn:aws:iam::{account}:role/a')
  })

  it('refuses resources that reference each other in a cycle, naming them', () => {
    const template = { Resources: { A: role('a', { Description: { Ref: 'B' } }), B: role('b', { Description: { Ref: 'A' } }) } }
    expect(() => generateConsoleResourceSet(template, OPTIONS)).toThrow(/A, B reference each other in a cycle/)
  })

  it('refuses a value that is not a template, and a resource with no type', () => {
    for (const notATemplate of [null, 'x', { Resources: {} }]) {
      expect(() => generateConsoleResourceSet(notATemplate, OPTIONS)).toThrow(/carries no Resources/)
    }
    expect(() => generateConsoleResourceSet({ Resources: { A: { Properties: {} } } }, OPTIONS)).toThrow(/resource A carries no Type/)
  })

  it('refuses an intrinsic that shares its object with other keys', () => {
    const template = { Resources: { A: role('a', { Description: { Ref: 'AWS::Region', Extra: 1 } }) } }
    expect(() => generateConsoleResourceSet(template, OPTIONS)).toThrow(/Ref shares its object with other keys/)
  })
})

describe('resource-set parity reducer (TA) — the region rule', () => {
  it('tokenises the region only in an ARN region segment, never inside a name that contains it', () => {
    const template = JSON.parse(fs.readFileSync(publishedTemplatePath('apiable-usage-events'), 'utf8'))
    const text = JSON.stringify(generateUsageEventsConsoleSet(template, '1.0.0'))
      .split('{region}').join('eu-central-1')
      .split('{tenant-name}').join('eu-central-1-acme')
      .split('{partner-account}').join('034444869755')
    const model = reduceConsoleResourceSet(JSON.parse(text), 'eu-central-1', USAGE_EVENTS_CONSOLE_REDUCTION)

    // The bucket's ARN still names the set's own bucket, so the grants re-link to its node.
    expect(model.grants.flatMap((grant) => grant.resources)).toContain('s3-bucket:apiable-logs-bucket')
    expect(model.grants.flatMap((grant) => grant.resources).some((resource) => resource.startsWith('arn:'))).toBe(false)
  })
})
