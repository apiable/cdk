/**
 * Writes the hand-build console instruction set that publishes beside a gateway-role template: the
 * generator's template-mode output, in which the region and the trust account stay as the two tokens
 * the serving portal fills. Refuses to write a set that lost either token, so the store can never hold
 * a set the portal would serve with a value nobody chose.
 *
 * Usage: ts-node scripts/console-instructions-publish.ts <template.json> <version> <out.json>
 */
import * as fs from 'fs'
import * as path from 'path'
import { generateConsoleInstructionTemplate, TRUST_ACCOUNT_TOKEN } from '../lib/gateway-role/console-instructions'
import { REGION_TOKEN } from '../lib/parity-gate/model'

const main = (): void => {
  const [templatePath, version, outPath] = process.argv.slice(2)
  if (templatePath === undefined || version === undefined || outPath === undefined) {
    process.stderr.write('usage: console-instructions-publish.ts <template.json> <version> <out.json>\n')
    process.exit(2)
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const currentVersion: string = require(path.resolve(__dirname, '../lib/gateway-role/package.json')).version
  const template: unknown = JSON.parse(fs.readFileSync(templatePath, 'utf8'))

  const serialized = `${JSON.stringify(generateConsoleInstructionTemplate(template, version, currentVersion), null, 2)}\n`
  for (const token of [REGION_TOKEN, TRUST_ACCOUNT_TOKEN]) {
    if (!serialized.includes(token)) {
      throw new Error(`the generated set carries no ${token} token — refusing to write a set the portal cannot fill`)
    }
  }

  fs.writeFileSync(outPath, serialized)
  process.stdout.write(`generated: ${outPath}\n`)
}

main()
