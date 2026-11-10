import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import { registerPublishedStacks } from '../scripts/launchstack-app'
import { BUILD_LIST_SCRIPT, buildList, compareBuildList, parseBuildList } from './support/build-list'
import { publishedVersion } from './support/published-template'

const registeredConstructs = (): string[] => {
  const app = new cdk.App()
  registerPublishedStacks(app)
  return app.node.children.filter((child): child is cdk.Stack => cdk.Stack.isStack(child)).map((stack) => stack.node.id)
}

describe('the build list names exactly the constructs the publish app registers', () => {
  // contract: 024-3-3 S1
  it('the publish app registers exactly the constructs the build list names', () => {
    expect(compareBuildList(registeredConstructs(), buildList())).toEqual({ missing: [], extra: [] })
  })

  // contract: 024-3-3 S1
  it('every listed construct resolves a published version', () => {
    for (const construct of buildList()) {
      expect(publishedVersion(construct)).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })

  // contract: 024-3-6 S6
  it('lists and registers the usage-events construct', () => {
    expect(buildList()).toContain('apiable-usage-events')
    expect(registeredConstructs()).toContain('apiable-usage-events')
  })

  // contract: 024-3-6 S19
  it('still lists and registers the logs bucket and the usage-log stream for tenants who run them', () => {
    for (const construct of ['apiable-logs-bucket', 'apiable-usagelogs-stream']) {
      expect(buildList()).toContain(construct)
      expect(registeredConstructs()).toContain(construct)
    }
  })

  // contract: 024-3-3 S1
  it('a list missing a registered construct names it as missing', () => {
    const [dropped, ...trimmed] = buildList()

    expect(compareBuildList(registeredConstructs(), trimmed)).toEqual({ missing: [dropped], extra: [] })
  })

  // contract: 024-3-3 S1
  it('a listed construct the publish app does not register is named as extra', () => {
    expect(compareBuildList(registeredConstructs(), [...buildList(), 'apiable-not-registered'])).toEqual({
      missing: [],
      extra: ['apiable-not-registered'],
    })
  })

  // contract: 024-3-3 S1
  it('a list that reads as empty, or has no list at all, is refused rather than compared', () => {
    expect(() => parseBuildList('CONSTRUCTS=(\n)\n')).toThrow('no constructs')
    expect(() => parseBuildList('#!/usr/bin/env bash\necho nothing\n')).toThrow('no CONSTRUCTS')
  })

  // contract: 024-3-3 S1
  it('a build list that cannot be read is refused', () => {
    const missing = path.join(os.tmpdir(), 'no-such-dir', 'synth-all-launchstack.sh')

    expect(() => buildList(missing)).toThrow('ENOENT')
  })

  it('reads the list the synth script builds from, skipping comments', () => {
    expect(path.basename(BUILD_LIST_SCRIPT)).toBe('synth-all-launchstack.sh')
    expect(parseBuildList('CONSTRUCTS=(\n  apiable-a # first\n  # apiable-commented\n  apiable-b\n)\n')).toEqual(['apiable-a', 'apiable-b'])
    expect(fs.existsSync(BUILD_LIST_SCRIPT)).toBe(true)
  })
})
