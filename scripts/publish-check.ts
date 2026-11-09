import * as fs from 'fs'
import * as path from 'path'

/**
 * The publish-check record that verify-launchstack-published.sh writes beside a construct version's
 * artifacts once every one of them passed, and the still-offered list of earlier versions it checks
 * and records without building them. The record is written once to a write-once store, so its bytes
 * must be a function of the verified artifacts alone: nothing that varies by run belongs in it.
 */

export type ArtifactKind = 'template' | 'zip' | 'module' | 'instructions'

export interface RecordedArtifact {
  readonly file: string
  readonly kind: ArtifactKind
  readonly sha256: string
}

export interface VerifiedArtifact extends RecordedArtifact {
  readonly key: string
}

export interface StillOffered {
  readonly construct: string
  readonly version: string
  readonly artifacts: readonly RecordedArtifact[]
}

export const RECORD_FILE = 'publish-check.json'
export const STILL_OFFERED_LIST = path.join(__dirname, '..', 'launchstack-still-offered.json')

const SHA256 = /^[0-9a-f]{64}$/

export const kindOf = (file: string): ArtifactKind => {
  if (file === 'template.yaml') return 'template'
  if (file === 'terraform.zip') return 'module'
  if (file === 'console-instructions.json') return 'instructions'
  if (file.endsWith('.zip')) return 'zip'
  throw new Error(`${file} is not a published artifact`)
}

const byFile = (a: RecordedArtifact, b: RecordedArtifact): number => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)

export const renderRecord = (construct: string, version: string, artifacts: readonly RecordedArtifact[]): string =>
  JSON.stringify({
    construct,
    version,
    result: 'passed',
    artifacts: [...artifacts].sort(byFile).map(({ file, kind, sha256 }) => ({ file, kind, sha256 })),
  }) + '\n'

/** Every way `text` fails to be the record of `verified` at `construct`/`version`; empty when it is. */
export const recordProblems = (text: string, construct: string, version: string, verified: readonly RecordedArtifact[]): string[] => {
  let record: unknown
  try {
    record = JSON.parse(text)
  } catch (e) {
    return [`not JSON: ${String((e as Error).message).split('\n')[0]}`]
  }
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return ['not a JSON object']
  const { construct: named, version: namedVersion, result, artifacts } = record as Record<string, unknown>
  const problems: string[] = []
  if (named !== construct) problems.push(`names construct ${String(named)}, published under ${construct}`)
  if (namedVersion !== version) problems.push(`names version ${String(namedVersion)}, published under ${version}`)
  if (result !== 'passed') problems.push(`result is ${String(result)}, not passed`)
  if (!Array.isArray(artifacts) || artifacts.length === 0) return [...problems, 'lists no artifacts']

  const listed = new Map<string, Record<string, unknown>>()
  for (const entry of artifacts as Record<string, unknown>[]) {
    const file = String(entry?.file)
    if (listed.has(file)) problems.push(`lists ${file} twice`)
    listed.set(file, entry)
  }
  for (const [file, entry] of listed) {
    const match = verified.find((artifact) => artifact.file === file)
    if (match === undefined) {
      problems.push(`lists ${file}, which was not verified beside it`)
      continue
    }
    if (entry.kind !== match.kind) problems.push(`${file} kind ${String(entry.kind)}, verified as ${match.kind}`)
    if (entry.sha256 !== match.sha256) problems.push(`${file} digest ${String(entry.sha256).slice(0, 12)}… differs from its artifact's ${match.sha256.slice(0, 12)}…`)
  }
  for (const artifact of verified) {
    if (!listed.has(artifact.file)) problems.push(`does not list ${artifact.file}, verified beside it`)
  }
  return problems
}

const versionOf = (artifact: VerifiedArtifact): string => path.posix.dirname(artifact.key)

export const writeRecords = (verified: readonly VerifiedArtifact[], srcDir: string): void => {
  const versions = [...new Set(verified.map(versionOf))]
  for (const address of versions) {
    const [construct, version] = address.split('/')
    const dir = path.join(srcDir, construct, version)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, RECORD_FILE), renderRecord(construct, version, verified.filter((artifact) => versionOf(artifact) === address)))
  }
}

export const parseStillOffered = (text: string): StillOffered[] => {
  let list: unknown
  try {
    list = JSON.parse(text)
  } catch (e) {
    throw new Error(`the still-offered list cannot be read: ${String((e as Error).message).split('\n')[0]}`)
  }
  if (!Array.isArray(list)) throw new Error('the still-offered list cannot be read: it is not a JSON array')
  const seen = new Set<string>()
  return list.map((raw: Record<string, unknown>) => {
    const { construct, version, artifacts } = raw ?? {}
    if (typeof construct !== 'string' || typeof version !== 'string' || !construct || !version || /[/\s]/.test(construct + version)) {
      throw new Error(`a still-offered entry needs a construct and version: ${JSON.stringify(raw)}`)
    }
    const name = `${construct} ${version}`
    if (seen.has(name)) throw new Error(`${name} is listed twice`)
    seen.add(name)
    if (!Array.isArray(artifacts) || artifacts.length === 0) throw new Error(`${name} names no artifact file`)
    const files = new Set<string>()
    return {
      construct,
      version,
      artifacts: artifacts.map((artifact: Record<string, unknown>) => {
        const { file, kind, sha256 } = artifact ?? {}
        if (typeof file !== 'string' || !/^[A-Za-z0-9._-]+$/.test(file)) throw new Error(`${name} names a file that is not a file name: ${JSON.stringify(artifact)}`)
        if (files.has(file)) throw new Error(`${name} ${file} is listed twice`)
        files.add(file)
        let expectedKind: ArtifactKind
        try {
          expectedKind = kindOf(file)
        } catch {
          throw new Error(`${name} ${file} is not a published artifact`)
        }
        if (kind !== expectedKind) throw new Error(`${name} ${file} needs its kind, ${expectedKind}`)
        if (typeof sha256 !== 'string' || !SHA256.test(sha256)) throw new Error(`${name} ${file} needs its sha256, 64 lowercase hex`)
        return { file, kind: expectedKind, sha256 }
      }),
    }
  })
}

const readManifest = (manifest: string): VerifiedArtifact[] =>
  fs
    .readFileSync(manifest, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [key, kind, sha256] = line.split('\t')
      return { key, file: path.posix.basename(key), kind: kind as ArtifactKind, sha256 }
    })

/**
 * Called from verify-launchstack-published.sh. Results go to files the script names, never to stdout,
 * so a banner from the toolchain can never land inside them.
 *   still-offered <list> <out>      each listed artifact as `key<TAB>kind<TAB>sha256`
 *   check <manifest> <pairs> <out>  each record in `pairs` (`key<TAB>path`) not matching the manifest, as `key — reasons`
 *   write <manifest> <srcDir>       one record per construct version in the manifest
 */
const main = (args: readonly string[]): void => {
  const [command, ...rest] = args
  if (command === 'still-offered') {
    const [list, out] = rest
    const lines = parseStillOffered(fs.readFileSync(list, 'utf8')).flatMap(({ construct, version, artifacts }) =>
      artifacts.map(({ file, kind, sha256 }) => `${construct}/${version}/${file}\t${kind}\t${sha256}\n`),
    )
    fs.writeFileSync(out, lines.join(''))
  } else if (command === 'check') {
    const [manifest, pairs, out] = rest
    const verified = readManifest(manifest)
    const lines = fs
      .readFileSync(pairs, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0)
      .flatMap((line) => {
        const [key, file] = line.split('\t')
        const [construct, version] = key.split('/')
        const beside = verified.filter((artifact) => versionOf(artifact) === `${construct}/${version}`)
        const problems = recordProblems(fs.readFileSync(file, 'utf8'), construct, version, beside)
        return problems.length === 0 ? [] : [`${key} — ${problems.join('; ')}\n`]
      })
    fs.writeFileSync(out, lines.join(''))
  } else if (command === 'write') {
    const [manifest, srcDir] = rest
    writeRecords(readManifest(manifest), srcDir)
  } else {
    throw new Error(`unknown command ${String(command)}`)
  }
}

if (require.main === module) {
  try {
    main(process.argv.slice(2))
  } catch (e) {
    console.error(String((e as Error).message))
    process.exit(1)
  }
}
