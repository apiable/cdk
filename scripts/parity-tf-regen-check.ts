/**
 * F1 — the Terraform leg's independent ground-truth. CI regenerates `terraform show -json` from a
 * fresh plan and this harness asserts it reduces to the SAME parity model as the committed reference
 * fixture — by meaning (the reduced graph + values + grants + oauth), never a byte-for-byte diff, so
 * tf/provider-version churn or resource reordering never trips it. A stale committed fixture (one
 * whose model diverges from the fresh plan) fails the gate, so the only independent-implementation
 * channel cannot ship silently stale.
 *
 * Usage: ts-node scripts/parity-tf-regen-check.ts <fresh-show.json> <committed-fixture.json> [region] [deployAccount]
 *
 * `deployAccount` is the account a credentialed plan resolved its caller identity into; supplied so a
 * module whose resource policy names the deploying account (the logs bucket's bucket-policy) reduces it
 * to a token on both sides, making the model comparison stable across whichever account CI ran the plan in.
 */
import * as fs from 'fs'
// Import from the leaf source modules, NOT the parity-gate barrel: the barrel re-exports the console
// channel's reducer (013-1-36), which transitively pulls the gateway-role construct and its heavy
// `@apiable/cdk-ssm-composition` dependency — unresolvable in this lightweight CI regen step's ts-node
// context (it runs after a bare `terraform show`, without the full workspace). This script only needs
// the Terraform reducer and the model type.
import { reduceTerraformShowJson } from '../lib/parity-gate/terraform-reducer'
import type { ChannelModel } from '../lib/parity-gate/model'

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
  const [freshPath, committedPath, region = process.env.AWS_REGION ?? 'eu-central-1', deployAccount] = process.argv.slice(2)
  if (freshPath === undefined || committedPath === undefined) {
    process.stderr.write('usage: parity-tf-regen-check.ts <fresh-show.json> <committed-fixture.json> [region] [deployAccount]\n')
    process.exit(2)
  }

  const fresh = JSON.parse(fs.readFileSync(freshPath, 'utf8'))
  const committed = JSON.parse(fs.readFileSync(committedPath, 'utf8'))

  const freshModel = reduceTerraformShowJson(fresh, 'terraform', region, deployAccount)
  const committedModel = reduceTerraformShowJson(committed, 'terraform', region, deployAccount)

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
        `refresh the committed fixture (${committedPath}) from the fresh plan.\n`,
    )
    process.exit(1)
  }

  process.stdout.write('terraform leg ground-truthed: the committed fixture reduces to the freshly regenerated plan.\n')
}

main()
