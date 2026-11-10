/**
 * Writes the hand-build set that publishes beside the usage-events template: every resource the
 * template creates, resolved, with the tenant name, the partner account and the region left as the
 * tokens the serving portal fills and the customer's own account left as `{account}`. Refuses to write
 * a set the portal could not serve, then reads back and parses the file it wrote, because the store is
 * write-once and nothing after this step can take a set back out.
 *
 * Usage: ts-node scripts/usage-events-console-publish.ts <template.json> <version> <out.json>
 */
import * as fs from 'fs'
import { serializeConsoleResourceSet } from '../lib/console-explainer/resource-set'
import { generateUsageEventsConsoleSet, usageEventsSetRefusal } from '../lib/usage-events/console-instructions'

const refusalOf = (text: string): string | undefined => usageEventsSetRefusal(JSON.parse(text))

const main = (): void => {
  const [templatePath, version, outPath] = process.argv.slice(2)
  if (templatePath === undefined || version === undefined || outPath === undefined) {
    process.stderr.write('usage: usage-events-console-publish.ts <template.json> <version> <out.json>\n')
    process.exit(2)
  }
  const template: unknown = JSON.parse(fs.readFileSync(templatePath, 'utf8'))
  const serialized = serializeConsoleResourceSet(generateUsageEventsConsoleSet(template, version))
  const refusal = refusalOf(serialized)
  if (refusal !== undefined) throw new Error(`${refusal}: refusing to write a set the portal cannot serve`)

  fs.writeFileSync(outPath, serialized)
  const written = fs.readFileSync(outPath, 'utf8')
  const rereadRefusal = written === serialized ? refusalOf(written) : 'the file on disk differs from the set generated'
  if (rereadRefusal !== undefined) {
    fs.rmSync(outPath, { force: true })
    throw new Error(`${outPath}: ${rereadRefusal}`)
  }
  process.stdout.write(`generated: ${outPath}\n`)
}

main()
