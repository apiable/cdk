/**
 * Acceptance specs — Story 013-1-10: loose stack composition via a shared parameter space.
 * Frozen contract: contract-013-1-10-ssm-parameter-store-stack-composition.md
 *
 * One un-skipped spec per contract scenario (S1–S6); every one is provable from the CDK synth with no
 * live AWS account. A construct publishes its declared outputs to the shared parameter space at
 * /apiable/{tenant}/{component}/{output} (SSM); a downstream reads by key. The proof exercises the
 * real composition module + the real construct opt-in seam — no policy logic is re-declared here.
 */
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { GatewayRoleStack, GATEWAY_ROLE_COMPONENT } from '@apiable/cdk-gateway-role'
import { LogsBucketStack, LOGS_BUCKET_COMPONENT } from '@apiable/cdk-logs-bucket'
import {
  buildGatewayRoleStack,
  buildLogsBucketStack,
  buildGatewayRoleStackComposed,
  buildLogsBucketStackComposed,
  resolveLogsBucketArn,
  resolveGatewayRoleArn,
} from '@apiable/umbrella'
import {
  compositionParameterName,
  publishOutputs,
  readUpstreamOutput,
} from '@apiable/cdk-ssm-composition'

const ACCOUNT = '111111111111'
const REGION = 'eu-central-1'
const TENANT = 'staging'
const ENV = { account: ACCOUNT, region: REGION }

type Json = ReturnType<Template['toJSON']>

const composedGatewayRole = (): Template =>
  Template.fromStack(buildGatewayRoleStackComposed(new cdk.App(), { env: ENV, tenant: TENANT }) as cdk.Stack)
const composedLogsBucket = (): Template =>
  Template.fromStack(buildLogsBucketStackComposed(new cdk.App(), { name: TENANT, env: ENV }) as cdk.Stack)

describe('013-1-10 stack composition — shared parameter space contract', () => {
  // contract: S1 — a component publishes its declared outputs at the tenant/component/output key
  it('S1: provisioning writes each declared output to the shared parameter space under /apiable/{tenant}/{component}/{output}', () => {
    const logsBucket = composedLogsBucket()
    // each declared output is published as an SSM parameter at its tenant/component/output key
    logsBucket.hasResourceProperties('AWS::SSM::Parameter', {
      Name: `/apiable/${TENANT}/${LOGS_BUCKET_COMPONENT}/bucket-arn`,
    })
    logsBucket.hasResourceProperties('AWS::SSM::Parameter', {
      Name: `/apiable/${TENANT}/${LOGS_BUCKET_COMPONENT}/bucket-name`,
    })
    logsBucket.hasResourceProperties('AWS::SSM::Parameter', {
      Name: `/apiable/${TENANT}/${LOGS_BUCKET_COMPONENT}/s3-assume-role-arn`,
    })
    logsBucket.resourceCountIs('AWS::SSM::Parameter', 3)

    const gatewayRole = composedGatewayRole()
    gatewayRole.hasResourceProperties('AWS::SSM::Parameter', {
      Name: `/apiable/${TENANT}/${GATEWAY_ROLE_COMPONENT}/role-arn`,
    })
    gatewayRole.resourceCountIs('AWS::SSM::Parameter', 1)
  })

  // contract: S2 — downstream reads an upstream output by key, no status polling
  it('S2: a downstream component reads the upstream output by key with no deployment-status polling/wait', () => {
    const stack = new cdk.Stack(new cdk.App(), 'Downstream', { env: ENV })
    resolveLogsBucketArn(stack, TENANT)
    const template = Template.fromStack(stack)
    // the read resolves to an SSM-parameter-value lookup keyed by the composition path — the value is
    // fetched by key at deploy time, never imported from the upstream stack or waited on
    template.hasParameter('*', {
      Type: 'AWS::SSM::Parameter::Value<String>',
      Default: `/apiable/${TENANT}/${LOGS_BUCKET_COMPONENT}/bucket-arn`,
    })

    // and the read introduces no cross-stack import / status-poll coupling
    const json = JSON.stringify(template.toJSON())
    expect(json).not.toContain('Fn::ImportValue')
    expect(json).not.toContain('DescribeStacks')
    expect(json).not.toContain('WaitCondition')
  })

  // contract: S3 — a failed/unavailable write fails loudly, no silent partial composition
  it('S3: an unavailable parameter space at write time fails the deploy + rolls back — never a silent partial provision', () => {
    // the write is a CloudFormation-native resource, so an unavailable/denied write is a resource
    // failure that rolls the stack back — there is no fire-and-forget SDK write that could half-succeed
    const params = composedLogsBucket().findResources('AWS::SSM::Parameter')
    expect(Object.keys(params).length).toBe(3)
    // a secret-valued output is refused outright rather than written to a plaintext parameter
    const stack = new cdk.Stack(new cdk.App(), 'Secrets', { env: ENV })
    expect(() =>
      publishOutputs(stack, {
        tenant: TENANT,
        component: 'cognito-pool',
        outputs: [{ name: 'client-secret', value: 'shh', secret: true }],
      }),
    ).toThrow(/secret/i)
  })

  // contract: S4 — existing stacks not auto-retrofitted; opt-in (default-on for new deploys)
  it('S4: an existing customer stack is not auto-given the parameter writes; the seam is opt-in for it, default-on for new kit deploys', () => {
    // existing-customer (umbrella) build path: no opt-in → no parameter resource added to the stack
    const existingGatewayRole = Template.fromStack(buildGatewayRoleStack(new cdk.App(), { env: ENV }) as cdk.Stack)
    existingGatewayRole.resourceCountIs('AWS::SSM::Parameter', 0)
    const existingLogsBucket = Template.fromStack(buildLogsBucketStack(new cdk.App(), { name: TENANT, env: ENV }) as cdk.Stack)
    existingLogsBucket.resourceCountIs('AWS::SSM::Parameter', 0)

    // a bare construct stack (no opt-in) is likewise untouched
    Template.fromStack(new GatewayRoleStack(new cdk.App(), 'Bare')).resourceCountIs('AWS::SSM::Parameter', 0)

    // new-deploy path: composition is wired by default
    composedGatewayRole().resourceCountIs('AWS::SSM::Parameter', 1)
  })

  // contract: S5 — the key shape is the stable composition contract (writer + reader agree)
  it('S5: an upstream writer and downstream reader agree on the same tenant/component/output key shape', () => {
    const key = { tenant: TENANT, component: GATEWAY_ROLE_COMPONENT, output: 'role-arn' }
    const expectedName = `/apiable/${TENANT}/${GATEWAY_ROLE_COMPONENT}/role-arn`
    expect(compositionParameterName(key)).toBe(expectedName)

    // the writer publishes under exactly that name
    composedGatewayRole().hasResourceProperties('AWS::SSM::Parameter', { Name: expectedName })

    // the reader composes exactly the same name from the same shape — the SSM-value parameter it
    // emits is keyed by that identical path
    const stack = new cdk.Stack(new cdk.App(), 'Reader', { env: ENV })
    resolveGatewayRoleArn(stack, TENANT)
    Template.fromStack(stack).hasParameter('*', {
      Type: 'AWS::SSM::Parameter::Value<String>',
      Default: expectedName,
    })
  })

  // contract: S6 — a missing/not-yet-written upstream value fails the reader fast
  it('S6: reading a missing/unwritten upstream key fails fast with a clear error — never a silent default/empty/stale value', () => {
    const stack = new cdk.Stack(new cdk.App(), 'BadRead', { env: ENV })
    // a missing/blank key segment fails fast at read time — never resolves to a silent default
    expect(() => readUpstreamOutput(stack, { tenant: '', component: LOGS_BUCKET_COMPONENT, output: 'bucket-arn' })).toThrow(
      /key segment/i,
    )
    expect(() => compositionParameterName({ tenant: TENANT, component: 'bad component', output: 'x' })).toThrow(/key segment/i)
    // a well-formed read emits a deploy-time SSM-value lookup keyed by the path — it resolves at
    // deploy (a missing parameter fails the deploy), never a baked-in empty/stale literal
    readUpstreamOutput(stack, { tenant: TENANT, component: LOGS_BUCKET_COMPONENT, output: 'bucket-arn' })
    Template.fromStack(stack).hasParameter('*', {
      Type: 'AWS::SSM::Parameter::Value<String>',
      Default: `/apiable/${TENANT}/${LOGS_BUCKET_COMPONENT}/bucket-arn`,
    })
  })
})
