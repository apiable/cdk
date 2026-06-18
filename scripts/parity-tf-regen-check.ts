/**
 * F1 — the Terraform leg's independent ground-truth. CI regenerates `terraform show -json` from a
 * fresh plan and this harness asserts it reduces to the SAME parity model as the committed reference
 * fixture — by meaning (the reduced graph + values + grants + oauth), never a byte-for-byte diff, so
 * tf/provider-version churn or resource reordering never trips it. A stale committed fixture (one
 * whose model diverges from the fresh plan) fails the gate, so the only independent-implementation
 * channel cannot ship silently stale.
 *
 * Usage: ts-node scripts/parity-tf-regen-check.ts <fresh-show.json> <committed-fixture.json> [region]
 */
import * as fs from 'fs'
import { reduceTerraformShowJson, ChannelModel } from '../lib/parity-gate'

/** The meaning of a reduced channel: the comparable model, with the graph order-normalised. */
const meaningOf = (model: ChannelModel): unknown => ({
  wellFormed: model.wellFormed,
  values: model.values,
  nodes: [...model.graph.nodes].map((node) => `${node.kind}:${node.ref}`).sort(),
  edges: [...model.graph.edges].map((edge) => `${edge.from} -[${edge.relation}]-> ${edge.to}`).sort(),
  grants: [...model.grants].map((grant) => JSON.stringify({ ...grant, actions: [...grant.actions].sort(), resources: [...grant.resources].sort() })).sort(),
  secrets: [...model.secrets].map((secret) => `${secret.ref}:${secret.wired}`).sort(),
  oauth: model.oauth ?? null,
  oauthByClient: model.oauthByClient ?? null,
})

const main = (): void => {
  const [freshPath, committedPath, region = process.env.AWS_REGION ?? 'eu-central-1'] = process.argv.slice(2)
  if (freshPath === undefined || committedPath === undefined) {
    process.stderr.write('usage: parity-tf-regen-check.ts <fresh-show.json> <committed-fixture.json> [region]\n')
    process.exit(2)
  }

  const fresh = JSON.parse(fs.readFileSync(freshPath, 'utf8'))
  const committed = JSON.parse(fs.readFileSync(committedPath, 'utf8'))

  const freshModel = reduceTerraformShowJson(fresh, 'terraform', region)
  const committedModel = reduceTerraformShowJson(committed, 'terraform', region)

  if (!freshModel.wellFormed) {
    process.stderr.write('the freshly regenerated terraform show -json did not reduce to a well-formed model\n')
    process.exit(1)
  }

  const freshMeaning = JSON.stringify(meaningOf(freshModel))
  const committedMeaning = JSON.stringify(meaningOf(committedModel))
  if (freshMeaning !== committedMeaning) {
    process.stderr.write(
      'the committed terraform fixture is STALE — its model does not match the freshly regenerated plan.\n' +
        `  fresh:     ${freshMeaning}\n  committed: ${committedMeaning}\n` +
        'refresh test/fixtures/parity-gate/terraform-gateway-role-show.json from the fresh plan.\n',
    )
    process.exit(1)
  }

  process.stdout.write('terraform leg ground-truthed: the committed fixture reduces to the freshly regenerated plan.\n')
}

main()
