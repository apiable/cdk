import * as path from 'path'

const REPO_ROOT = path.join(__dirname, '..', '..')

/**
 * Package dir a construct's version is single-sourced from, mirroring synth-launchstack.sh: the
 * shared logs-stream package serves both the usage-log and api-key-token distributions.
 */
const packageDirFor = (construct: string): string =>
  construct === 'apiable-usagelogs-stream' || construct === 'apiable-usagetokens-stream'
    ? 'lib/logs-stream'
    : `lib/${construct.replace(/^apiable-/, '')}`

/** Published version of a construct, read from the same package.json the synth script reads. */
export const publishedVersion = (construct: string): string =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require(path.join(REPO_ROOT, packageDirFor(construct), 'package.json')).version

/**
 * Path to a construct's published template, resolved at the construct's CURRENT version.
 *
 * A spec that hardcodes a version keeps comparing today's code against a template built for an
 * older one, so the first version bump turns the parity gate into a comparison of two different
 * things — and it reports the resulting divergence as a code defect rather than a stale path.
 */
export const publishedTemplatePath = (construct: string, ext: 'json' | 'yaml' = 'json'): string =>
  path.join(
    REPO_ROOT,
    'dist/launchstack',
    construct,
    publishedVersion(construct),
    `template.${ext}`,
  )
