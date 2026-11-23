/**
 * Writes the hand-build console instruction set that publishes beside a role's template: the
 * generator's template-mode output, in which the region, the trust account, the external ID and any
 * other deploy input of the construct stay as the tokens the serving portal fills. Refuses to write a
 * set that lost any of them, so the store can never hold a set the portal would serve with a value
 * nobody chose.
 *
 * Usage: ts-node scripts/console-instructions-publish.ts <template.json> <version> <out.json> [construct]
 * The construct defaults to apiable-gateway-role.
 */
import * as fs from 'fs'
import * as path from 'path'
import { EXTERNAL_ID_TOKEN, generateConsoleInstructionTemplateFor, TRUST_ACCOUNT_TOKEN } from '../lib/gateway-role/console-instructions'
import { consoleConstruct, deployInputTokensOf } from '../lib/console-instruction-constructs'
import { REGION_TOKEN } from '../lib/parity-gate/model'

const main = (): void => {
  const [templatePath, version, outPath, constructName = 'apiable-gateway-role'] = process.argv.slice(2)
  if (templatePath === undefined || version === undefined || outPath === undefined) {
    process.stderr.write('usage: console-instructions-publish.ts <template.json> <version> <out.json> [construct]\n')
    process.exit(2)
  }
  const construct = consoleConstruct(constructName)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const currentVersion: string = require(path.resolve(__dirname, '..', 'lib', constructName.replace(/^apiable-/, ''), 'package.json')).version
  const template: unknown = JSON.parse(fs.readFileSync(templatePath, 'utf8'))

  const serialized = `${JSON.stringify(generateConsoleInstructionTemplateFor(construct, template, version, currentVersion), null, 2)}\n`
  for (const token of [REGION_TOKEN, TRUST_ACCOUNT_TOKEN, EXTERNAL_ID_TOKEN, ...deployInputTokensOf(constructName)]) {
    if (!serialized.includes(token)) {
      throw new Error(`the generated set carries no ${token} token — refusing to write a set the portal cannot fill`)
    }
  }

  fs.writeFileSync(outPath, serialized)
  process.stdout.write(`generated: ${outPath}\n`)
}

main()
