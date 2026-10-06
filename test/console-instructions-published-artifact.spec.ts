/**
 * The hand-build console instruction set is published as an artifact — `console-instructions.json`
 * beside the template, written by synth-launchstack.sh in the generator's template mode — and the
 * portal serves it with only the region, the trust account and its own external ID filled in. These
 * specs pin that artifact's contract on the file synth actually writes: it names its construct and
 * version, it carries exactly those three tokens and nothing else unresolved, filling the region and
 * the trust account reproduces the set the generator resolves for that region, and the filled set is
 * still the fourth channel the parity gate compares — so what the portal hands a customer is what
 * the gate approved.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import {
  buildPublishedStack,
  ConsoleInstructionSet,
  EXTERNAL_ID_TOKEN,
  generateConsoleInstructions,
  TRUST_ACCOUNT_TOKEN,
} from '@apiable/cdk-gateway-role'
import { ChannelModel, gate, REGION_TOKEN, reduceCloudFormation, reduceConsoleInstructions, reduceTerraformShowJson } from '@apiable/parity-gate'
import { publishedTemplatePath, publishedVersion } from './support/published-template'

const REPO_ROOT = path.resolve(__dirname, '..')
const CONSTRUCT = 'apiable-gateway-role'
const REGION = 'eu-central-1'
const TRUST_ACCOUNT = '034444869755'
const EXTERNAL_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const TF_FIXTURE = path.join(REPO_ROOT, 'test/fixtures/parity-gate/terraform-gateway-role-show.json')

const publishedSetText = (): string =>
  fs.readFileSync(path.join(path.dirname(publishedTemplatePath(CONSTRUCT)), 'console-instructions.json'), 'utf8')
const publishedTemplate = (): unknown => JSON.parse(fs.readFileSync(publishedTemplatePath(CONSTRUCT), 'utf8'))

/** Exactly what the portal does with the artifact: replace each token it holds a value for, touch nothing else. */
const filled = (text: string, values: Readonly<Record<string, string>>): ConsoleInstructionSet =>
  JSON.parse(Object.entries(values).reduce((acc, [token, value]) => acc.split(token).join(value), text)) as ConsoleInstructionSet

/** The region and the trust account filled. The external ID stays the token: it is a deploy-time input
 * in every channel, with no default for the other three to compare a filled value against. */
const filledFor = (region: string, trustAccount: string): ConsoleInstructionSet =>
  filled(publishedSetText(), { [REGION_TOKEN]: region, [TRUST_ACCOUNT_TOKEN]: trustAccount })

const cdkModel = (): ChannelModel => reduceCloudFormation(Template.fromStack(buildPublishedStack(new cdk.App())).toJSON(), 'cdk')
const cfnModel = (): ChannelModel => reduceCloudFormation(publishedTemplate(), 'cfn')
const tfModel = (): ChannelModel => reduceTerraformShowJson(JSON.parse(fs.readFileSync(TF_FIXTURE, 'utf8')), 'terraform', REGION)

describe('published console instruction set — the artifact the portal serves', () => {
  it('is written beside the template, names its own construct and version, and leaves only its three tokens unresolved', () => {
    const text = publishedSetText()
    const set = JSON.parse(text) as ConsoleInstructionSet

    expect(set.construct).toBe(CONSTRUCT)
    expect(set.version).toBe(publishedVersion(CONSTRUCT))
    expect(set.region).toBe(REGION_TOKEN)
    expect(set.trustAccount).toBe(TRUST_ACCOUNT_TOKEN)
    expect(set.parameterDefaults).toEqual({ ApiableTrustAccount: TRUST_ACCOUNT, ApiableEgressCidr: '63.180.116.108/32' })

    const placeholders = new Set(text.match(/\{[a-z-]+\}/g))
    expect([...placeholders].sort()).toEqual([REGION_TOKEN, TRUST_ACCOUNT_TOKEN, EXTERNAL_ID_TOKEN].sort())
  })

  it('filling the region and the trust account reproduces the set the generator resolves for that region, value for value', () => {
    const { parameterDefaults, ...served } = filledFor(REGION, TRUST_ACCOUNT)

    expect(parameterDefaults).toBeDefined()
    expect(served).toEqual(generateConsoleInstructions(publishedTemplate(), publishedVersion(CONSTRUCT), publishedVersion(CONSTRUCT), REGION))
  })

  it('a portal with its own trust account and external ID fills every place each occurs, together with its region', () => {
    const staging = filled(publishedSetText(), { [REGION_TOKEN]: 'us-east-1', [TRUST_ACCOUNT_TOKEN]: '111111111111', [EXTERNAL_ID_TOKEN]: EXTERNAL_ID })

    expect(staging.region).toBe('us-east-1')
    expect(staging.roleName).toBe('apiable-gateway-management-role-us-east-1')
    expect(staging.trustAccount).toBe('111111111111')
    expect(staging.trustDocument.Statement[0].Principal?.AWS).toBe('arn:aws:iam::111111111111:root')
    expect(staging.trustDocument.Statement[0].Condition).toEqual({ StringEquals: { 'sts:ExternalId': EXTERNAL_ID } })
    expect(JSON.stringify(staging)).not.toMatch(/\{[a-z-]+\}/)
  })

  it('the filled artifact passes the four-channel parity gate, and a filled-in divergence still fails it naming the console channel', () => {
    const passing = gate([cdkModel(), cfnModel(), tfModel(), reduceConsoleInstructions(filledFor(REGION, TRUST_ACCOUNT), REGION)])
    expect(passing.passed).toBe(true)

    const divergent = gate([cdkModel(), cfnModel(), tfModel(), reduceConsoleInstructions(filledFor(REGION, '999988887777'), REGION)])
    expect(divergent.passed).toBe(false)
    const trustDivergence = divergent.divergences.find((d) => d.tier === 'value' && d.detail.includes('role-trust-account'))
    expect(trustDivergence?.channels).toEqual(['console'])
  })
})
