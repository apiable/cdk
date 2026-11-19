import * as fs from 'fs'
import * as path from 'path'

export const BUILD_LIST_SCRIPT = path.join(__dirname, '..', '..', 'synth-all-launchstack.sh')

/** The `CONSTRUCTS=( … )` array of the synth script. Throws on no array or no entries, so no caller can pass on nothing. */
export const parseBuildList = (script: string): string[] => {
  const array = /^CONSTRUCTS=\(([^)]*)\)/m.exec(script)
  if (array === null) throw new Error('no CONSTRUCTS=( … ) array in the build list')
  const constructs = array[1]
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => line.split(/\s+/))
  if (constructs.length === 0) throw new Error('the build list names no constructs')
  return constructs
}

export const buildList = (script: string = BUILD_LIST_SCRIPT): string[] => parseBuildList(fs.readFileSync(script, 'utf8'))

export interface BuildListDifference {
  /** Registered by the publish app, absent from the list: never built or published. */
  readonly missing: string[]
  /** Listed, but the publish app cannot produce it. */
  readonly extra: string[]
}

export const compareBuildList = (registered: readonly string[], listed: readonly string[]): BuildListDifference => ({
  missing: registered.filter((construct) => !listed.includes(construct)),
  extra: listed.filter((construct) => !registered.includes(construct)),
})
