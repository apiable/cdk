/**
 * Acceptance specs — Story 013-1-17: the strangler drift-gate catches a reference re-target while
 * tolerating a consistent logical-id rename. Frozen contract:
 * contract-013-1-17-strangler-gate-retarget-detection.md
 *
 * One un-skipped spec per contract scenario (S1, S2, S3, S5, S6 — S4 retired by architect ruling
 * 2026-06-21: the IAM retarget is covered by S3 by-reference-or-by-value + S6 by-value literal, the
 * whole-shape oracle subsumes a separate IAM-semantic tier). The strangler drift-gate
 * (cfnDifferences / isCfnEquivalent / assertNoStranglerDrift) is exercised on synthetic
 * baseline-vs-candidate template pairs — the natural test vehicle for a template-level drift gate —
 * plus the real umbrella synth where it strengthens the regression flank. No policy logic is
 * re-declared here; the real `@apiable/umbrella` equivalence engine is the oracle.
 *
 * The S3 retarget cases are RED on the pre-A1 engine (every reference collapses to one shared
 * placeholder, so a re-target canonicalises identically and cfnDifferences returns []); proven by a
 * stash-revert of the engine fix during build.
 */
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { buildGatewayRoleStack, cfnDifferences, isCfnEquivalent, assertNoStranglerDrift } from '@apiable/umbrella'

const ACCOUNT = '034444869755'
const REGION = 'eu-central-1'
const ENV = { account: ACCOUNT, region: REGION }

type Json = ReturnType<Template['toJSON']>
type CfnResource = { Type: string; Properties?: unknown; [k: string]: unknown }
type Tmpl = {
  Resources?: Record<string, CfnResource>
  Outputs?: Record<string, { Value?: unknown; Export?: { Name?: unknown }; [k: string]: unknown }>
}
const toJson = (stack: cdk.Stack): Json => Template.fromStack(stack).toJSON()
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/**
 * Two roles of DISTINCT shape and a policy attached to the first. The shape distinction is what a
 * re-target between them exposes: re-attaching the policy to the second role changes the policy's
 * target-shape token, so the re-target is observable drift (it is not two interchangeable clones,
 * which would be an un-observable physical-name collision the gate rightly tolerates).
 */
const policyAttachedTo = (roleId: 'RoleA' | 'RoleB'): Tmpl => ({
  Resources: {
    RoleA: {
      Type: 'AWS::IAM::Role',
      Properties: {
        RoleName: 'role-alpha',
        AssumeRolePolicyDocument: { Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] },
      },
    },
    RoleB: {
      Type: 'AWS::IAM::Role',
      Properties: {
        RoleName: 'role-beta',
        AssumeRolePolicyDocument: { Statement: [{ Effect: 'Allow', Principal: { Service: 'firehose.amazonaws.com' }, Action: 'sts:AssumeRole' }] },
      },
    },
    AppPolicy: {
      Type: 'AWS::IAM::Policy',
      Properties: {
        PolicyName: 'app-policy',
        Roles: [{ Ref: roleId }],
        PolicyDocument: { Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: '*' }] },
      },
    },
  },
})

/** Two buckets of distinct shape and a stream whose destination ARN is taken from one of them by GetAtt. */
const streamWiredTo = (bucketId: 'BucketA' | 'BucketB'): Tmpl => ({
  Resources: {
    BucketA: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'logs-alpha' } },
    BucketB: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'logs-beta' } },
    Stream: {
      Type: 'AWS::KinesisFirehose::DeliveryStream',
      Properties: {
        DeliveryStreamName: 'a-stream',
        S3DestinationConfiguration: { BucketARN: { 'Fn::GetAtt': [bucketId, 'Arn'] } },
      },
    },
  },
})

/** A role whose trust policy names a principal account by value — the by-value re-target flank of S3. */
const roleTrustingAccount = (account: string): Tmpl => ({
  Resources: {
    AuthZRole: {
      Type: 'AWS::IAM::Role',
      Properties: {
        RoleName: 'authz-role',
        AssumeRolePolicyDocument: {
          Statement: [{ Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${account}:root` }, Action: 'sts:AssumeRole' }],
        },
      },
    },
  },
})

/**
 * Two roles of distinct shape and a consumer whose ONLY tie to a role is a top-level `DependsOn` — the
 * dependency-declaration reference form. Re-aiming the `DependsOn` from one role to the other is a
 * re-target the gate must catch; a consistent rename of the depended-on role must stay tolerated.
 */
const dependsOnRole = (roleId: 'RoleA' | 'RoleB'): Tmpl => ({
  Resources: {
    RoleA: {
      Type: 'AWS::IAM::Role',
      Properties: { RoleName: 'role-alpha', AssumeRolePolicyDocument: { Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] } },
    },
    RoleB: {
      Type: 'AWS::IAM::Role',
      Properties: { RoleName: 'role-beta', AssumeRolePolicyDocument: { Statement: [{ Effect: 'Allow', Principal: { Service: 'firehose.amazonaws.com' }, Action: 'sts:AssumeRole' }] } },
    },
    Consumer: { Type: 'AWS::Lambda::Function', DependsOn: roleId, Properties: { FunctionName: 'consumer' } },
  },
})

/** A stateful bucket carrying a top-level `DeletionPolicy` — flipping Retain→Delete is a data-durability drift. */
const bucketWithDeletionPolicy = (policy: 'Retain' | 'Delete'): Tmpl => ({
  Resources: {
    LogsBucket: { Type: 'AWS::S3::Bucket', DeletionPolicy: policy, UpdateReplacePolicy: policy, Properties: { BucketName: 'logs' } },
  },
})

/**
 * Two distinctly-shaped buckets (both present in baseline AND candidate, so the resource multiset is
 * identical) and a consumer whose only tie to a bucket is an `Fn::Sub`-embedded attribute reference
 * `${Bucket.Arn}`. Re-aiming only the Sub body from one bucket to the other is the forcing construction
 * for the new Sub-attribute normalisation: if the `Fn::Sub` were ignored (its body treated as opaque
 * text), the consumer's shape would be identical in both templates → no drift; only correct Sub-attr
 * normalisation resolves the embedded id to its target's distinct shape token and reports the re-target.
 */
const subAttrWiredTo = (bucketId: 'BucketAlpha' | 'BucketBeta'): Tmpl => ({
  Resources: {
    BucketAlpha: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'sub-alpha' } },
    BucketBeta: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'sub-beta' } },
    Consumer: {
      Type: 'AWS::Lambda::Function',
      Properties: { FunctionName: 'sub-consumer', Environment: { Variables: { BucketArn: { 'Fn::Sub': 'destination=${' + bucketId + '.Arn}' } } } },
    },
  },
})

/**
 * A resource graph exercising EVERY reference form the template can express, so S2 proves no form is
 * left un-normalised: direct {Ref}, attribute {Fn::GetAtt} short (string) AND long (array) form,
 * {Fn::Sub}-embedded ${Logical} AND ${Logical.Attr}, DependsOn, and the default-policy PolicyName echo.
 */
const everyReferenceForm = (): Tmpl => ({
  Resources: {
    TargetRole: {
      Type: 'AWS::IAM::Role',
      Properties: { RoleName: 'target-role', AssumeRolePolicyDocument: { Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] } },
    },
    TargetBucket: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'target-bucket' } },
    Consumer: {
      Type: 'AWS::Lambda::Function',
      DependsOn: 'TargetRole',
      Properties: {
        FunctionName: 'consumer',
        Role: { 'Fn::GetAtt': ['TargetRole', 'Arn'] }, // long-form GetAtt (array)
        Environment: {
          Variables: {
            RoleRef: { Ref: 'TargetRole' }, // direct Ref
            BucketArnShort: { 'Fn::GetAtt': 'TargetBucket.Arn' }, // short-form GetAtt (string)
            BucketUri: { 'Fn::Sub': 'arn:aws:s3:::${TargetBucket}/data' }, // Fn::Sub-embedded id (bare)
            RoleArnSub: { 'Fn::Sub': 'role-is-${TargetRole.Arn}' }, // Fn::Sub-embedded attribute ref ${Id.Attr}
            LiteralKept: { 'Fn::Sub': 'kept-${!Literal}-escape' }, // ${!Literal} escape — never a ref, rename-invariant
          },
        },
      },
    },
    ConsumerPolicy: {
      Type: 'AWS::IAM::Policy',
      Properties: {
        PolicyName: 'TargetRole', // CDK default-policy name echoes the role logical id
        Roles: [{ Ref: 'TargetRole' }],
        PolicyDocument: { Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: { 'Fn::GetAtt': ['TargetBucket', 'Arn'] } }] },
      },
    },
  },
})

/**
 * A reference cycle: two resources each reference the other (Alpha→Beta via Ref, Beta→Alpha via
 * DependsOn). The shape-token resolver must terminate on the cycle and still tell two distinct cyclic
 * graphs apart — so a rename of the cycle is tolerated while a re-target into the cycle is caught.
 */
const cyclicPair = (extraTarget: 'Beta' | 'Gamma'): Tmpl => ({
  Resources: {
    Alpha: { Type: 'AWS::IAM::Role', DependsOn: 'Beta', Properties: { RoleName: 'alpha', Peer: { Ref: extraTarget } } },
    Beta: { Type: 'AWS::IAM::Policy', Properties: { PolicyName: 'beta', Roles: [{ Ref: 'Alpha' }] } },
    Gamma: { Type: 'AWS::SQS::Queue', Properties: { QueueName: 'gamma' } },
  },
})

/** Consistently rename a logical id and every reference to it (keys, Ref, GetAtt, Sub, DependsOn, PolicyName echo). */
const renameAll = (template: Tmpl, oldId: string, newId: string): Tmpl =>
  JSON.parse(JSON.stringify(template).split(oldId).join(newId)) as Tmpl

describe('013-1-17 strangler drift-gate — retarget detection', () => {
  // S1 — a consistent rename with no observable change reports no drift (happy)
  it('S1: a consistent rename of a resource logical id (+ every reference to it), no real change → no drift', () => {
    const baseline = everyReferenceForm()
    const candidate = renameAll(baseline, 'TargetRole', 'RenamedTargetRole')
    // the raw templates differ (the rename touched keys, Ref, GetAtt, Sub, DependsOn, PolicyName)
    expect(candidate.Resources).not.toEqual(baseline.Resources)
    expect(cfnDifferences(baseline, candidate)).toEqual([])
    expect(isCfnEquivalent(baseline, candidate)).toBe(true)
  })

  // S2 — the rename tolerance covers EVERY form of reference (edge / boundary — no over-block)
  describe('S2: a consistent rename is tolerated through every reference form', () => {
    it.each([
      ['the referenced role (direct Ref, long-form GetAtt, DependsOn, PolicyName echo)', 'TargetRole', 'RenamedRole'],
      ['the referenced bucket (short-form GetAtt, Fn::Sub-embedded id)', 'TargetBucket', 'RenamedBucket'],
    ])('renaming %s → still no drift', (_label: string, oldId: string, newId: string) => {
      const baseline = everyReferenceForm()
      const candidate = renameAll(baseline, oldId, newId)
      expect(candidate.Resources).not.toEqual(baseline.Resources)
      expect(cfnDifferences(baseline, candidate)).toEqual([])
    })

    it('the umbrella synth: a real construct-extraction rename of the gateway role is tolerated', () => {
      const before = toJson(buildGatewayRoleStack(new cdk.App(), { env: ENV }))
      const resources = before.Resources ?? {}
      const oldId = Object.keys(resources).find((id) => (resources[id] as { Type: string }).Type === 'AWS::IAM::Role') as string
      const renamed = renameAll(before as Tmpl, oldId, `Refactored${oldId}`)
      expect(renamed.Resources).not.toEqual(before.Resources)
      expect(cfnDifferences(before, renamed)).toEqual([])
    })

    it('a consistent rename across a reference cycle is tolerated (the resolver terminates on the cycle)', () => {
      const baseline = cyclicPair('Beta')
      const candidate = renameAll(baseline, 'Alpha', 'RenamedAlpha')
      expect(candidate.Resources).not.toEqual(baseline.Resources)
      expect(cfnDifferences(baseline, candidate)).toEqual([])
    })

    it('renaming a top-level-DependsOn target → still no drift (the dependency-declaration reference form)', () => {
      const baseline = dependsOnRole('RoleA')
      const candidate = renameAll(baseline, 'RoleA', 'RenamedRoleA')
      expect(candidate.Resources).not.toEqual(baseline.Resources)
      expect(cfnDifferences(baseline, candidate)).toEqual([])
    })

    it('renaming a target referenced by an Fn::Sub attribute form ${Id.Arn} → still no drift (no over-block)', () => {
      const baseline = everyReferenceForm()
      const candidate = renameAll(baseline, 'TargetRole', 'RenamedRole')
      // the rename touches the ${TargetRole.Arn} Sub body; the ${!TargetRole} literal escape is left intact
      expect(candidate.Resources).not.toEqual(baseline.Resources)
      expect(cfnDifferences(baseline, candidate)).toEqual([])
    })
  })

  // S3 — a re-target (by reference OR by value, incl an IAM trust/principal/resource) is caught
  //       (FORCING — A1/A2 + whole-shape, HIGH fail-open closure; RED on the pre-A1 engine)
  describe('S3: a reference re-pointed at a different target is caught as drift', () => {
    it('a policy re-attached to a DIFFERENT role → drift', () => {
      const baseline = policyAttachedTo('RoleA')
      const candidate = policyAttachedTo('RoleB')
      expect(cfnDifferences(baseline, candidate).length).toBeGreaterThan(0)
      expect(isCfnEquivalent(baseline, candidate)).toBe(false)
      expect(() => assertNoStranglerDrift(baseline, candidate)).toThrow(/strangler step blocked/)
    })

    it('an export/stream re-wired (via Fn::GetAtt) to a DIFFERENT bucket → drift', () => {
      const baseline = streamWiredTo('BucketA')
      const candidate = streamWiredTo('BucketB')
      expect(cfnDifferences(baseline, candidate).length).toBeGreaterThan(0)
      expect(() => assertNoStranglerDrift(baseline, candidate)).toThrow(/strangler step blocked/)
    })

    it('a role trust re-aimed at a different principal account named BY VALUE → drift', () => {
      const baseline = roleTrustingAccount('111111111111')
      const candidate = roleTrustingAccount('222222222222')
      expect(cfnDifferences(baseline, candidate).length).toBeGreaterThan(0)
      expect(() => assertNoStranglerDrift(baseline, candidate)).toThrow(/strangler step blocked/)
    })

    it('a policy statement resource re-aimed (via Fn::GetAtt) at a different resource → drift', () => {
      const baseline = everyReferenceForm()
      const candidate = clone(baseline)
      // re-aim the statement Resource from TargetBucket to TargetRole (a different existing resource)
      const policy = (candidate.Resources as Record<string, { Properties: { PolicyDocument: { Statement: { Resource: unknown }[] } } }>).ConsumerPolicy
      policy.Properties.PolicyDocument.Statement[0].Resource = { 'Fn::GetAtt': ['TargetRole', 'Arn'] }
      expect(cfnDifferences(baseline, candidate).length).toBeGreaterThan(0)
    })

    it('a re-target through Fn::Sub (embedded id re-pointed at a different resource) → drift', () => {
      const baseline = everyReferenceForm()
      const candidate = clone(baseline)
      const consumer = (candidate.Resources as Record<string, { Properties: { Environment: { Variables: { BucketUri: unknown } } } }>).Consumer
      // the Sub-embedded ${TargetBucket} re-pointed at ${TargetRole} (a differently-shaped resource)
      consumer.Properties.Environment.Variables.BucketUri = { 'Fn::Sub': 'arn:aws:s3:::${TargetRole}/data' }
      expect(cfnDifferences(baseline, candidate).length).toBeGreaterThan(0)
    })

    it('a re-target through ONLY an Fn::Sub body (the only difference is which bucket the ${Bucket.Arn} points at) → drift', () => {
      // Both buckets exist in both templates, so the multiset is identical and the sole difference is
      // the consumer's Sub-embedded target. The new Sub-attribute normalisation resolves ${Bucket.Arn}
      // to its target's distinct shape token, so the re-target is reported as a property change.
      const baseline = subAttrWiredTo('BucketAlpha')
      const candidate = subAttrWiredTo('BucketBeta')
      expect(cfnDifferences(baseline, candidate).length).toBeGreaterThan(0)
      expect(() => assertNoStranglerDrift(baseline, candidate)).toThrow(/strangler step blocked/)
    })

    it('a top-level DependsOn re-aimed at a DIFFERENT role → drift', () => {
      const baseline = dependsOnRole('RoleA')
      const candidate = dependsOnRole('RoleB')
      expect(cfnDifferences(baseline, candidate).length).toBeGreaterThan(0)
      expect(() => assertNoStranglerDrift(baseline, candidate)).toThrow(/strangler step blocked/)
    })

    it('a re-target INTO a reference cycle (a cyclic member re-pointed at a different resource) → drift', () => {
      const baseline = cyclicPair('Beta')
      const candidate = cyclicPair('Gamma') // Alpha.Peer re-pointed from Beta (Policy) to Gamma (Queue)
      expect(cfnDifferences(baseline, candidate).length).toBeGreaterThan(0)
    })
  })

  // S5 — the gate stays unwired from any live baseline until the closure lands (guardrail)
  // Asserted as a static-source invariant: assertNoStranglerDrift / isCfnEquivalent / cfnDifferences
  // are reachable only from test specs and the lib barrel — never a deploy step, CI workflow, or the
  // parity harness — so the fail-open cannot ship against a real before/after pair.
  it('S5: the strangler API is not wired to any real baseline (deploy / CI / parity harness)', () => {
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    const repoRoot = path.resolve(__dirname, '..')
    const API = ['assertNoStranglerDrift', 'isCfnEquivalent', 'cfnDifferences']
    const callers: string[] = []
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'cdk.out') continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
          continue
        }
        if (!/\.(ts|js|sh|ya?ml)$/.test(entry.name)) continue
        // the engine's own definitions and its barrel re-export are not "wiring to a baseline"
        if (full.endsWith(path.join('lib', 'umbrella', 'cfn-equivalence.ts'))) continue
        if (full.endsWith(path.join('lib', 'umbrella', 'index.ts'))) continue
        const text = fs.readFileSync(full, 'utf8')
        if (API.some((sym) => text.includes(sym))) callers.push(path.relative(repoRoot, full))
      }
    }
    walk(repoRoot)
    // every caller must be a test spec — no deploy-*.sh, no .github workflow, no parity-gate harness
    const nonTestCallers = callers.filter((f) => !/\.spec\.ts$/.test(f))
    expect(nonTestCallers).toEqual([])
  })

  // S6 — the existing drift verdicts are unchanged (regression)
  describe('S6: the existing drift verdicts are unchanged', () => {
    it('a resource added → still drift', () => {
      const baseline = policyAttachedTo('RoleA')
      const candidate = clone(baseline)
      ;(candidate.Resources as Record<string, unknown>)['Extra'] = { Type: 'AWS::SQS::Queue', Properties: { QueueName: 'extra' } }
      expect(cfnDifferences(baseline, candidate)).toContainEqual({ kind: 'resource-added', detail: 'AWS::SQS::Queue (×1)' })
      expect(() => assertNoStranglerDrift(baseline, candidate)).toThrow(/strangler step blocked/)
    })

    it('a resource removed → still drift', () => {
      const baseline = policyAttachedTo('RoleA')
      const candidate = clone(baseline)
      delete (candidate.Resources as Record<string, unknown>)['RoleB']
      expect(cfnDifferences(baseline, candidate).some((d) => d.kind === 'resource-removed')).toBe(true)
    })

    it('a published export renamed / dropped / re-valued → still drift', () => {
      const baseline: Tmpl = { Resources: { B: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'b' } } }, Outputs: { Out: { Value: 'v', Export: { Name: 'shared' } } } }
      const reValued = clone(baseline)
      ;(reValued.Outputs as Record<string, { Value: unknown }>)['Out'].Value = 'changed'
      expect(cfnDifferences(baseline, reValued)).toContainEqual({ kind: 'export-changed', detail: 'shared' })
      const dropped = clone(baseline)
      delete (dropped.Outputs as Record<string, unknown>)['Out']
      expect(cfnDifferences(baseline, dropped)).toContainEqual({ kind: 'export-removed', detail: 'shared' })
    })

    it('a scalar property changed (a load-bearing literal inside a trust document, e.g. a trusted account) → still drift', () => {
      const baseline = roleTrustingAccount('111111111111')
      const changed = roleTrustingAccount('999999999999')
      expect(cfnDifferences(baseline, changed).length).toBeGreaterThan(0)
    })

    it('a stateful resource DeletionPolicy / UpdateReplacePolicy flipped Retain → Delete → drift (data-durability)', () => {
      const baseline = bucketWithDeletionPolicy('Retain')
      const candidate = bucketWithDeletionPolicy('Delete')
      expect(cfnDifferences(baseline, candidate).length).toBeGreaterThan(0)
      expect(() => assertNoStranglerDrift(baseline, candidate)).toThrow(/strangler step blocked/)
    })
  })
})
