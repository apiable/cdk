import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  RecordedArtifact,
  STILL_OFFERED_LIST,
  kindOf,
  parseStillOffered,
  recordProblems,
  renderRecord,
  writeRecords,
} from '../scripts/publish-check'

const sha = (char: string): string => char.repeat(64)

const VERIFIED: RecordedArtifact[] = [
  { file: 'terraform.zip', kind: 'module', sha256: sha('b') },
  { file: 'authorizer.zip', kind: 'zip', sha256: sha('a') },
  { file: 'template.yaml', kind: 'template', sha256: sha('c') },
]

const RECORD =
  '{"construct":"apiable-lambda-authorizer","version":"1.2.0","result":"passed","artifacts":[' +
  `{"file":"authorizer.zip","kind":"zip","sha256":"${sha('a')}"},` +
  `{"file":"template.yaml","kind":"template","sha256":"${sha('c')}"},` +
  `{"file":"terraform.zip","kind":"module","sha256":"${sha('b')}"}]}\n`

describe('the publish-check record', () => {
  it('names each file the kind its consumer reads it as', () => {
    expect(kindOf('template.yaml')).toBe('template')
    expect(kindOf('terraform.zip')).toBe('module')
    expect(kindOf('console-instructions.json')).toBe('instructions')
    expect(kindOf('authorizer.zip')).toBe('zip')
    expect(() => kindOf('template.json')).toThrow('template.json')
  })

  // contract: 024-3-3 S7
  it('renders compact, artifacts in file order, fields in one fixed order, one trailing newline', () => {
    expect(renderRecord('apiable-lambda-authorizer', '1.2.0', VERIFIED)).toBe(RECORD)
  })

  // contract: 024-3-3 S7
  it('renders the same bytes whatever order the artifacts were verified in', () => {
    expect(renderRecord('apiable-lambda-authorizer', '1.2.0', [...VERIFIED].reverse())).toBe(RECORD)
  })

  it('a record that matches its address and the artifacts verified beside it has no problem', () => {
    expect(recordProblems(RECORD, 'apiable-lambda-authorizer', '1.2.0', VERIFIED)).toEqual([])
  })

  // contract: 024-3-3 S9
  it.each([
    ['names another construct', RECORD.replace('"apiable-lambda-authorizer"', '"apiable-other"'), 'names construct apiable-other'],
    ['names another version', RECORD.replace('"1.2.0"', '"1.2.1"'), 'names version 1.2.1'],
    ['carries a result other than passed', RECORD.replace('"passed"', '"failed"'), 'result is failed'],
    ['lists a digest other than its artifact\'s', RECORD.replace(sha('a'), sha('d')), `authorizer.zip digest ${sha('d').slice(0, 12)}`],
    ['lists a file under another kind', RECORD.replace('"kind":"zip"', '"kind":"module"'), 'authorizer.zip kind module'],
    ['is not JSON', RECORD.slice(0, 40), 'not JSON'],
  ])('a record that %s is refused, naming what it found', (_label, text, reason) => {
    expect(recordProblems(text, 'apiable-lambda-authorizer', '1.2.0', VERIFIED).join('; ')).toContain(reason)
  })

  // contract: 024-3-3 S9
  it('a record that omits an artifact verified beside it, or lists one that was not, is refused', () => {
    expect(recordProblems(RECORD, 'apiable-lambda-authorizer', '1.2.0', [...VERIFIED, { file: 'extra.zip', kind: 'zip', sha256: sha('e') }]).join('; ')).toContain(
      'does not list extra.zip',
    )
    expect(recordProblems(RECORD, 'apiable-lambda-authorizer', '1.2.0', VERIFIED.slice(1)).join('; ')).toContain('lists terraform.zip, which was not verified')
  })

  // contract: 024-3-3 S9
  it.each([
    ['is a JSON array', '[]', 'not a JSON object'],
    ['is JSON null', 'null', 'not a JSON object'],
    ['lists an empty artifact set', RECORD.replace(/"artifacts":\[.*\]/, '"artifacts":[]'), 'lists no artifacts'],
    ['has no artifact list', RECORD.replace(/,"artifacts":\[.*\]/, ''), 'lists no artifacts'],
    [
      'lists one file twice',
      RECORD.replace('"artifacts":[', `"artifacts":[{"file":"authorizer.zip","kind":"zip","sha256":"${sha('a')}"},`),
      'lists authorizer.zip twice',
    ],
  ])('a record that %s is refused, naming what it found', (_label, text, reason) => {
    expect(recordProblems(text, 'apiable-lambda-authorizer', '1.2.0', VERIFIED)).toContain(reason)
  })

  // contract: 024-3-3 S7
  it('writes one record per construct version verified', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-check-'))
    writeRecords(
      [
        ...VERIFIED.map((artifact) => ({ ...artifact, key: `apiable-lambda-authorizer/1.2.0/${artifact.file}` })),
        { key: 'apiable-logs-bucket/1.0.0/template.yaml', file: 'template.yaml', kind: 'template', sha256: sha('f') },
      ],
      dir,
    )

    try {
      expect(fs.readFileSync(path.join(dir, 'apiable-lambda-authorizer/1.2.0/publish-check.json'), 'utf8')).toBe(RECORD)
      expect(fs.readFileSync(path.join(dir, 'apiable-logs-bucket/1.0.0/publish-check.json'), 'utf8')).toBe(
        `{"construct":"apiable-logs-bucket","version":"1.0.0","result":"passed","artifacts":[{"file":"template.yaml","kind":"template","sha256":"${sha('f')}"}]}\n`,
      )
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })
})

describe('the still-offered list', () => {
  const entry = {
    construct: 'apiable-gateway-role',
    version: '2.0.0',
    artifacts: [{ file: 'template.yaml', kind: 'template', sha256: sha('a') }],
  }

  // contract: 024-3-3 S22
  it('an empty list is valid: no earlier version is offered', () => {
    expect(parseStillOffered('[]')).toEqual([])
  })

  // contract: 024-3-3 S22
  it('a well-formed entry is read as it is written', () => {
    expect(parseStillOffered(JSON.stringify([entry]))).toEqual([entry])
  })

  // contract: 024-3-3 S22
  it.each([
    ['is not JSON', '[{', 'cannot be read'],
    ['is not a list', '{}', 'cannot be read'],
    ['names a version that lists no artifact file', JSON.stringify([{ ...entry, artifacts: [] }]), 'apiable-gateway-role 2.0.0 names no artifact file'],
    ['names a file without its kind', JSON.stringify([{ ...entry, artifacts: [{ file: 'template.yaml', sha256: sha('a') }] }]), 'apiable-gateway-role 2.0.0 template.yaml'],
    ['names a file without its digest', JSON.stringify([{ ...entry, artifacts: [{ file: 'template.yaml', kind: 'template' }] }]), 'apiable-gateway-role 2.0.0 template.yaml'],
    ['names a file under a kind it is not', JSON.stringify([{ ...entry, artifacts: [{ file: 'template.yaml', kind: 'module', sha256: sha('a') }] }]), 'apiable-gateway-role 2.0.0 template.yaml'],
    ['names a version twice', JSON.stringify([entry, entry]), 'apiable-gateway-role 2.0.0 is listed twice'],
    ['names an entry with no version', JSON.stringify([{ ...entry, version: '' }]), 'construct and version'],
    ['names a version that climbs out of its key', JSON.stringify([{ ...entry, version: '..' }]), 'a still-offered entry needs a construct and version'],
    ['names a construct that climbs out of its key', JSON.stringify([{ ...entry, construct: '../apiable-gateway-role' }]), 'a still-offered entry needs a construct and version'],
    ['names a version with a path inside it', JSON.stringify([{ ...entry, version: '2.0..0' }]), 'a still-offered entry needs a construct and version'],
    ['names a file with a path inside it', JSON.stringify([{ ...entry, artifacts: [{ file: 'lambda/authorizer.zip', kind: 'zip', sha256: sha('a') }] }]), 'apiable-gateway-role 2.0.0 names a file that is not a file name'],
    ['names a file no consumer reads', JSON.stringify([{ ...entry, artifacts: [{ file: 'README.md', kind: 'template', sha256: sha('a') }] }]), 'apiable-gateway-role 2.0.0 README.md is not a published artifact'],
    ['names one file twice', JSON.stringify([{ ...entry, artifacts: [...entry.artifacts, ...entry.artifacts] }]), 'apiable-gateway-role 2.0.0 template.yaml is listed twice'],
    ['names a digest that is not 64 lowercase hex', JSON.stringify([{ ...entry, artifacts: [{ file: 'template.yaml', kind: 'template', sha256: sha('A') }] }]), 'template.yaml needs its sha256, 64 lowercase hex'],
    ['holds an entry that is not an object', '[null]', 'a still-offered entry needs a construct and version'],
  ])('a list that %s is refused, naming it', (_label, text, reason) => {
    expect(() => parseStillOffered(text)).toThrow(reason)
  })

  // contract: 024-3-3 S22
  it('the committed list offers gateway-role 2.0.0 with its three published files', () => {
    const list = parseStillOffered(fs.readFileSync(STILL_OFFERED_LIST, 'utf8'))

    expect(list.map(({ construct, version }) => `${construct} ${version}`)).toEqual(['apiable-gateway-role 2.0.0'])
    expect(list[0].artifacts.map(({ file, kind }) => `${file} ${kind}`)).toEqual([
      'console-instructions.json instructions',
      'template.yaml template',
      'terraform.zip module',
    ])
  })

  // contract: 024-3-3 S22
  it('the committed 2.0.0 console set digest is the published one, which the fixture holds', () => {
    const fixture = path.join(__dirname, 'fixtures/parity-gate/gateway-role-v2-console-instructions.json')
    const digest = crypto.createHash('sha256').update(fs.readFileSync(fixture)).digest('hex')
    const [v2] = parseStillOffered(fs.readFileSync(STILL_OFFERED_LIST, 'utf8'))

    expect(v2.artifacts.find((artifact) => artifact.file === 'console-instructions.json')?.sha256).toBe(digest)
  })
})
