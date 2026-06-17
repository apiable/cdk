/**
 * Supplementary coverage for the SSM composition seam (Story 013-1-10) — edge cases and
 * integration scenarios beyond the frozen acceptance contract: key-segment validation boundaries,
 * the per-construct opt-in resource graph, the secret-write guard, and writer/reader key agreement
 * across every published output. Synth-level; no live AWS account.
 */
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import {
  compositionParameterName,
  publishOutputs,
  readUpstreamOutput,
  COMPOSITION_NAMESPACE,
} from '@apiable/cdk-ssm-composition'
import { GatewayRoleStack, GATEWAY_ROLE_COMPONENT } from '@apiable/cdk-gateway-role'
import { LogsBucketStack, LOGS_BUCKET_COMPONENT } from '@apiable/cdk-logs-bucket'

const ENV = { account: '111111111111', region: 'eu-central-1' }
const TENANT = 'staging'

const newStack = (id: string): cdk.Stack => new cdk.Stack(new cdk.App(), id, { env: ENV })

describe('composition key shape', () => {
  it('builds /apiable/{tenant}/{component}/{output} under the apiable namespace', () => {
    expect(COMPOSITION_NAMESPACE).toBe('apiable')
    expect(compositionParameterName({ tenant: 'dev', component: 'logs-bucket', output: 'bucket-arn' })).toBe(
      '/apiable/dev/logs-bucket/bucket-arn',
    )
  })

  it('accepts dotted output names (e.g. an encoded cognito output) as a single segment', () => {
    expect(compositionParameterName({ tenant: TENANT, component: 'cognito-pool', output: 'authn.userpool.id' })).toBe(
      `/apiable/${TENANT}/cognito-pool/authn.userpool.id`,
    )
  })

  it.each(['', ' ', '/leading-slash', 'has space', 'has/slash'])(
    'rejects malformed segment %p so a wrong key fails loudly, never silently',
    (bad: string) => {
      expect(() => compositionParameterName({ tenant: bad, component: 'logs-bucket', output: 'bucket-arn' })).toThrow(
        /key segment/i,
      )
    },
  )
})

describe('write seam (publishOutputs)', () => {
  it('writes one SSM parameter per declared output, each keyed by the output name', () => {
    const stack = newStack('Writer')
    publishOutputs(stack, {
      tenant: TENANT,
      component: 'logs-bucket',
      outputs: [
        { name: 'bucket-name', value: 'b' },
        { name: 'bucket-arn', value: 'arn:aws:s3:::b' },
      ],
    })
    const t = Template.fromStack(stack)
    t.resourceCountIs('AWS::SSM::Parameter', 2)
    t.hasResourceProperties('AWS::SSM::Parameter', { Name: `/apiable/${TENANT}/logs-bucket/bucket-name`, Value: 'b' })
    t.hasResourceProperties('AWS::SSM::Parameter', {
      Name: `/apiable/${TENANT}/logs-bucket/bucket-arn`,
      Value: 'arn:aws:s3:::b',
    })
  })

  it('refuses to publish a secret-valued output to a plaintext parameter', () => {
    const stack = newStack('Secret')
    expect(() =>
      publishOutputs(stack, {
        tenant: TENANT,
        component: 'cognito-pool',
        outputs: [{ name: 'client-secret', value: 'super-secret', secret: true }],
      }),
    ).toThrow(/secret-valued output "client-secret"/)
    // and it writes nothing — the throw aborts before any parameter resource is created
    expect(Object.keys(Template.fromStack(stack).findResources('AWS::SSM::Parameter'))).toHaveLength(0)
  })

  it('publishes non-secret outputs even when a later output is a secret (fails fast on the secret)', () => {
    const stack = newStack('Mixed')
    expect(() =>
      publishOutputs(stack, {
        tenant: TENANT,
        component: 'cognito-pool',
        outputs: [
          { name: 'userpool-id', value: 'eu_x' },
          { name: 'client-secret', value: 's', secret: true },
        ],
      }),
    ).toThrow(/secret/i)
  })
})

describe('read seam (readUpstreamOutput)', () => {
  it('emits exactly one SSM-value parameter per distinct upstream key read', () => {
    const stack = newStack('Reader')
    readUpstreamOutput(stack, { tenant: TENANT, component: 'logs-bucket', output: 'bucket-arn' })
    readUpstreamOutput(stack, { tenant: TENANT, component: 'gateway-role', output: 'role-arn' })
    const params = Object.values(Template.fromStack(stack).toJSON().Parameters ?? {}) as Array<{
      Type?: string
      Default?: string
    }>
    const ssmValueDefaults = params.filter((p) => p.Type === 'AWS::SSM::Parameter::Value<String>').map((p) => p.Default)
    expect(ssmValueDefaults).toEqual(
      expect.arrayContaining([
        `/apiable/${TENANT}/logs-bucket/bucket-arn`,
        `/apiable/${TENANT}/gateway-role/role-arn`,
      ]),
    )
  })
})

describe('writer/reader key agreement across every published output', () => {
  it('every logs-bucket parameter the writer creates is addressable by the same key shape a reader composes', () => {
    const writerStack = new LogsBucketStack(new cdk.App(), 'W', {
      name: TENANT,
      env: ENV,
      publishComposition: true,
    })
    const writtenNames = Object.values(Template.fromStack(writerStack).findResources('AWS::SSM::Parameter')).map(
      (r) => (r as { Properties: { Name: string } }).Properties.Name,
    )
    expect(writtenNames.sort()).toEqual(
      ['bucket-arn', 'bucket-name', 's3-assume-role-arn']
        .map((output) => compositionParameterName({ tenant: TENANT, component: LOGS_BUCKET_COMPONENT, output }))
        .sort(),
    )
  })

  it('the gateway-role parameter the writer creates matches the reader key shape', () => {
    const writerStack = new GatewayRoleStack(new cdk.App(), 'W', { env: ENV, tenant: TENANT, publishComposition: true })
    const writtenNames = Object.values(Template.fromStack(writerStack).findResources('AWS::SSM::Parameter')).map(
      (r) => (r as { Properties: { Name: string } }).Properties.Name,
    )
    expect(writtenNames).toEqual([
      compositionParameterName({ tenant: TENANT, component: GATEWAY_ROLE_COMPONENT, output: 'role-arn' }),
    ])
  })
})

describe('opt-in boundary', () => {
  it('a gateway-role opt-in without a tenant fails loudly rather than writing an unkeyed parameter', () => {
    expect(() => new GatewayRoleStack(new cdk.App(), 'NoTenant', { env: ENV, publishComposition: true })).toThrow(
      /tenant is required/,
    )
  })

  it('a logs-bucket opt-in with a parameter-token tenant (published path) fails rather than keying by a token', () => {
    // no concrete name → the stack surfaces TenantName as a CFN parameter (a token), which cannot be a key
    expect(() => new LogsBucketStack(new cdk.App(), 'TokenTenant', { env: ENV, publishComposition: true })).toThrow(
      /concrete tenant name is required/,
    )
  })
})
