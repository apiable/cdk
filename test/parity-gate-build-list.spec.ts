/**
 * Every construct the build list publishes is compared on its CDK, published CloudFormation and
 * Terraform channels, so a construct cannot enter the list without a parity row. The gateway role's
 * fourth channel, its console instruction set, is compared in console-instructions-published-artifact.spec.ts.
 */
import * as fs from 'fs'
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { ChannelModel, gate, reduceCloudFormation, reduceTerraformShowJson } from '@apiable/parity-gate'
import { MISSING_DECLARED_ID } from '../lib/parity-gate/canonical'
import { buildList } from './support/build-list'
import { PARITY_CHANNELS, ParityChannelRow } from './support/parity-channels'

const channelsFor = (construct: string): ParityChannelRow => {
  const row = PARITY_CHANNELS.find((candidate) => candidate.construct === construct)
  if (row === undefined) throw new Error(`${construct} is in the build list but has no parity channels to compare`)
  return row
}

const cdkModel = (row: ParityChannelRow): ChannelModel =>
  reduceCloudFormation(Template.fromStack(row.buildCdk(new cdk.App())).toJSON(), 'cdk', row.cfnRegion)
const cfnModel = (row: ParityChannelRow): ChannelModel =>
  reduceCloudFormation(JSON.parse(fs.readFileSync(row.publishedCfn, 'utf8')), 'cfn', row.cfnRegion)
const tfModel = (row: ParityChannelRow): ChannelModel =>
  reduceTerraformShowJson(JSON.parse(fs.readFileSync(row.tfFixture, 'utf8')), 'terraform', row.tfRegion, row.tfDeployAccount)

describe('the parity check compares every construct in the build list', () => {
  // contract: 024-3-3 S20
  it('a listed construct with no channels to compare fails, naming it', () => {
    expect(() => channelsFor('apiable-not-in-the-table')).toThrow('apiable-not-in-the-table is in the build list but has no parity channels to compare')
  })

  describe.each(buildList())('%s', (construct) => {
    // contract: 024-3-3 S20
    it('has parity channels to compare', () => {
      expect(channelsFor(construct).construct).toBe(construct)
    })

    // contract: 024-3-3 S19
    it('its CDK, published CloudFormation and Terraform channels reduce to the same model', () => {
      const row = channelsFor(construct)
      const result = gate([cdkModel(row), cfnModel(row), tfModel(row)])

      expect(result.divergences).toEqual([])
      expect(result.passed).toBe(true)
    })

    // contract: 024-3-3 S19
    it('no primary lacks its declared apiable:logical-id on any channel', () => {
      const row = channelsFor(construct)
      for (const model of [cdkModel(row), cfnModel(row), tfModel(row)]) {
        expect(model.graph.nodes.length).toBeGreaterThan(0)
        expect(model.graph.nodes.filter((node) => node.ref.includes(MISSING_DECLARED_ID)).map((node) => `${model.channel}: ${node.ref}`)).toEqual([])
      }
    })

    // contract: 024-3-3 S20
    it('one resource dropped from its Terraform channel fails the check, naming terraform', () => {
      const row = channelsFor(construct)
      const terraform = tfModel(row)
      const [dropped, ...kept] = terraform.graph.nodes
      const result = gate([cdkModel(row), cfnModel(row), { ...terraform, graph: { ...terraform.graph, nodes: kept } }])

      expect(result.passed).toBe(false)
      expect(result.divergences.find((divergence) => divergence.detail.includes(`resource ${dropped.ref}`))?.channels).toEqual(['terraform'])
    })
  })
})
