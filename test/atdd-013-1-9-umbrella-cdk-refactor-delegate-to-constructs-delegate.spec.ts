/**
 * Acceptance specs — Story 013-1-9: the umbrella refactors to delegate to the kit constructs with
 * zero observable change. Frozen contract: contract-013-1-9-umbrella-cdk-refactor-delegate-to-constructs.md
 *
 * One un-skipped spec per contract scenario (S1–S6); every one is provable from the CDK synth with no
 * live AWS account. The proof is a logical-id-NORMALISED before/after equivalence: the pre-refactor
 * baseline is each stack instantiated exactly as the `deploy-*.sh` generators do today; the candidate
 * is the same stack built through the committed umbrella module. They are independent instantiation
 * paths that must agree on resource properties + published exports, with logical-id renames tolerated
 * (a raw whole-template snapshot would false-fail on the deliberate construct-extraction rename and is
 * the wrong oracle). The comparison runs the real `@apiable/umbrella` equivalence engine — no policy
 * logic is re-declared here.
 */
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import {
  buildGatewayRoleStack,
  buildLogsBucketStack,
  buildLogsStreamStack,
  buildCognitoStack,
  buildAuthZStack,
  umbrellaStackName,
  cfnDifferences,
  isCfnEquivalent,
  publishedExports,
  resourceShapes,
  assertNoStranglerDrift,
} from '@apiable/umbrella'
import { GatewayRoleStack } from '../lib/gatewayrole'
import { LogsBucketStack } from '../lib/logs-bucket'
import { Cognito } from '../lib/cognito'
import { AuthZ } from '../lib/authz'
import { LogsStream } from '../lib/logs-stream'

const ACCOUNT = '034444869755'
const REGION = 'eu-central-1'
const TENANT = 'staging'
const ENV = { account: ACCOUNT, region: REGION }

type Json = ReturnType<Template['toJSON']>
const toJson = (stack: cdk.Stack): Json => Template.fromStack(stack).toJSON()

/**
 * The pre-refactor baseline: each stack instantiated inline exactly as its `deploy-*.sh` generator
 * heredoc does today — the "prior CFN output" AC1 names.
 */
const baseline = {
  gatewayrole: (): Json =>
    toJson(
      new GatewayRoleStack(new cdk.App(), 'GatewayRole', {
        stackName: 'gatewayrole',
        description: 'Gateway Management Role for Apiable',
        env: ENV,
      }),
    ),
  logsBucket: (): Json =>
    toJson(
      new LogsBucketStack(new cdk.App(), 'LogsBucket', {
        stackName: `apiable-${TENANT}-logs-bucket`,
        description: 'Apiable S3 Bucket to write logs into',
        name: TENANT,
        env: ENV,
      }),
    ),
  logsStream: (): Json =>
    toJson(
      new LogsStream(new cdk.App(), 'LogsStream', {
        stackName: `usagelogs-stream-apiable-${TENANT}`,
        description: `Usage Logs stream for Apiable Portal ${TENANT}`,
        env: {
          account: ACCOUNT,
          region: REGION,
          logsBucketArn: `arn:aws:s3:::apiable-logs-${TENANT}`,
          prefix: 'apiable/aws',
          name: `usagelogs-${TENANT}`,
        },
      }),
    ),
  usagetokensStream: (): Json =>
    toJson(
      new LogsStream(new cdk.App(), 'LogsStream', {
        stackName: `usagetokens-stream-apiable-${TENANT}`,
        description: `Usage Tokens Logs stream for Apiable Portal ${TENANT}`,
        env: {
          account: ACCOUNT,
          region: REGION,
          logsBucketArn: `arn:aws:s3:::apiable-logs-${TENANT}`,
          prefix: 'apiable/aws/apikey-token',
          name: `usagetokens-${TENANT}`,
        },
      }),
    ),
  cognito: (): Json =>
    toJson(
      new Cognito(new cdk.App(), 'Cognito', {
        stackName: `auth-portal-${TENANT}`,
        description: `Cognito Pool for Apiable ${TENANT} Portal`,
        env: { account: ACCOUNT, region: REGION, name: TENANT, domain: `${TENANT}.apiable.io`, fromEmail: 'no-reply@apiable.io' },
      }),
    ),
  authz: (): Json =>
    toJson(
      new AuthZ(new cdk.App(), 'AuthZ', {
        stackName: `auth-portal-authz-${TENANT}`,
        description: `AuthZ Lambda for Apiable Gateway Authorization ${TENANT}`,
        env: {
          account: ACCOUNT,
          region: REGION,
          name: TENANT,
          userpoolId: 'eu-central-1_abc123',
          assumeRoleArn: `arn:aws:iam::${ACCOUNT}:role/ApiableCognitoAuthZ-portal-${TENANT}`,
          authMethod: 'JWT',
          apiGatewayAssumeRoleArn: `arn:aws:iam::${ACCOUNT}:role/ApiableGetaway`,
        },
      }),
    ),
}

/** The candidate: the same stack built through the committed umbrella module. */
const candidate = {
  gatewayrole: (): Json => toJson(buildGatewayRoleStack(new cdk.App(), { env: ENV })),
  logsBucket: (): Json => toJson(buildLogsBucketStack(new cdk.App(), { name: TENANT, env: ENV })),
  logsStream: (): Json =>
    toJson(
      buildLogsStreamStack(new cdk.App(), {
        variant: 'usagelogs',
        stackSuffix: TENANT,
        logsBucketArn: `arn:aws:s3:::apiable-logs-${TENANT}`,
        env: ENV,
      }),
    ),
  usagetokensStream: (): Json =>
    toJson(
      buildLogsStreamStack(new cdk.App(), {
        variant: 'usagetokens',
        stackSuffix: TENANT,
        logsBucketArn: `arn:aws:s3:::apiable-logs-${TENANT}`,
        env: ENV,
      }),
    ),
  cognito: (): Json =>
    toJson(buildCognitoStack(new cdk.App(), { name: TENANT, domain: `${TENANT}.apiable.io`, fromEmail: 'no-reply@apiable.io', env: ENV })),
  authz: (): Json =>
    toJson(
      buildAuthZStack(new cdk.App(), {
        name: TENANT,
        userpoolId: 'eu-central-1_abc123',
        assumeRoleArn: `arn:aws:iam::${ACCOUNT}:role/ApiableCognitoAuthZ-portal-${TENANT}`,
        authMethod: 'JWT',
        apiGatewayAssumeRoleArn: `arn:aws:iam::${ACCOUNT}:role/ApiableGetaway`,
        env: ENV,
      }),
    ),
}

const COMPONENTS = ['gatewayrole', 'logsBucket', 'logsStream', 'usagetokensStream', 'cognito', 'authz'] as const
type Component = (typeof COMPONENTS)[number]

describe('013-1-9 umbrella delegate refactor — zero-observable-change contract', () => {
  // S1 — a fresh refactored umbrella deploy equals the pre-refactor umbrella (logical-id tolerant)
  describe('S1: the refactored umbrella synth matches the baseline by resource properties (logical-id renames tolerated)', () => {
    it.each(COMPONENTS)('%s: same resources by type+properties', (component: Component) => {
      const differences = cfnDifferences(baseline[component](), candidate[component]())
      expect(differences).toEqual([])
      expect(isCfnEquivalent(baseline[component](), candidate[component]())).toBe(true)
    })
  })

  // S2 — published cross-stack exports byte-identical (name + value); the load-bearing one
  describe('S2: every published export name + value is byte-for-byte identical before vs after', () => {
    it.each(COMPONENTS)('%s: published exports unchanged', (component: Component) => {
      const before = publishedExports(baseline[component]())
      const after = publishedExports(candidate[component]())
      expect([...after.entries()].sort()).toEqual([...before.entries()].sort())
    })

    it('cognito publishes its full set of cross-stack exports, including the 00-encoded names importers consume', () => {
      const exports = publishedExports(candidate.cognito())
      expect(exports.size).toBeGreaterThanOrEqual(17)
      expect([...exports.keys()]).toContain(`portal-${TENANT}00APIABLE00AWS00AUTHN00USERPOOLID`)
      expect([...exports.keys()]).toContain(`portal-${TENANT}00APIABLE00AWS00AUTHZ00CLIENTS00AUTHZ00ID`)
    })
  })

  // S3 — existing stack preserved; re-applying in place is NOT supported (the R2 hazard)
  describe('S3: the refactor renames internal logical ids while names are preserved → in-place re-deploy collides', () => {
    it('a construct-extracted stack (gateway-role) keeps its physical role name while its logical id changes', () => {
      const role = (template: Json): { logicalId: string; roleName: unknown } => {
        const entries = Object.entries(template.Resources ?? {}).filter(([, r]) => (r as { Type: string }).Type === 'AWS::IAM::Role')
        const [logicalId, resource] = entries[0] as [string, { Properties?: { RoleName?: unknown } }]
        return { logicalId, roleName: resource.Properties?.RoleName }
      }
      const before = role(baseline.gatewayrole())
      const after = role(candidate.gatewayrole())
      // physical name preserved — that is why an in-place re-deploy onto the existing resource collides
      expect(after.roleName).toEqual(before.roleName)
      expect(after.roleName).toBe(`apiable-gateway-managment-role-${REGION}`)
      // the construct extraction changes the logical id (CDK addresses it under the construct scope)
      expect(after.logicalId).toContain('GatewayRole')
    })

    it('the logs-bucket keeps its physical bucket name across the refactor', () => {
      const bucketName = (template: Json): unknown => {
        const [, resource] = Object.entries(template.Resources ?? {}).find(([, r]) => (r as { Type: string }).Type === 'AWS::S3::Bucket') as [
          string,
          { Properties?: { BucketName?: unknown } },
        ]
        return resource.Properties?.BucketName
      }
      expect(bucketName(candidate.logsBucket())).toEqual(bucketName(baseline.logsBucket()))
      expect(bucketName(candidate.logsBucket())).toBe(`apiable-logs-${TENANT}`)
    })

    it('the firehose delivery stream keeps the mandatory amazon-apigateway- prefixed name across the refactor', () => {
      const streamName = (template: Json): unknown => {
        const resource = Object.values(template.Resources ?? {}).find(
          (r) => (r as { Type: string }).Type === 'AWS::KinesisFirehose::DeliveryStream',
        ) as { Properties?: { DeliveryStreamName?: unknown } }
        return resource.Properties?.DeliveryStreamName
      }
      expect(streamName(candidate.logsStream())).toEqual(streamName(baseline.logsStream()))
      // the name MUST keep the amazon-apigateway- prefix — API Gateway access logging requires it
      expect(streamName(candidate.logsStream())).toBe(`amazon-apigateway-usagelogs-${TENANT}`)
    })
  })

  // S4 — a strangler step that would drift an existing stack is blocked
  describe('S4: a strangler step producing any drift on an existing stack is blocked from progressing', () => {
    it('an equivalent step passes the gate unchanged', () => {
      expect(() => assertNoStranglerDrift(baseline.gatewayrole(), candidate.gatewayrole())).not.toThrow()
    })

    it('a step that drops a published export is blocked', () => {
      const drifted = candidate.cognito()
      const outputs = drifted.Outputs ?? {}
      delete outputs[Object.keys(outputs)[0]]
      expect(() => assertNoStranglerDrift(baseline.cognito(), drifted)).toThrow(/strangler step blocked/)
    })

    it('a step that adds a resource is blocked', () => {
      const drifted = candidate.gatewayrole()
      ;(drifted.Resources ?? {})['Extra'] = { Type: 'AWS::SQS::Queue', Properties: { QueueName: 'extra' } }
      const differences = cfnDifferences(baseline.gatewayrole(), drifted)
      expect(differences).toContainEqual({ kind: 'resource-added', detail: 'AWS::SQS::Queue (×1)' })
      expect(() => assertNoStranglerDrift(baseline.gatewayrole(), drifted)).toThrow(/strangler step blocked/)
    })
  })

  // S5 — updating needs no manual customer action and surfaces no drift
  describe('S5: existing customers update with no manual action and observe no drift', () => {
    it.each(COMPONENTS)('%s: introduces no new deploy-time parameter a customer must supply', (component: Component) => {
      const beforeParams = Object.keys(baseline[component]().Parameters ?? {}).sort()
      const afterParams = Object.keys(candidate[component]().Parameters ?? {}).sort()
      expect(afterParams).toEqual(beforeParams)
    })

    it.each(COMPONENTS)('%s: the umbrella stack name is held constant', (component: Component) => {
      // the stack identity a customer updates in place must not change
      const names: Record<Component, string> = {
        gatewayrole: umbrellaStackName.gatewayrole(),
        logsBucket: umbrellaStackName.logsBucket(TENANT),
        logsStream: umbrellaStackName.logsStream('usagelogs', TENANT),
        usagetokensStream: umbrellaStackName.logsStream('usagetokens', TENANT),
        cognito: umbrellaStackName.cognito(TENANT),
        authz: umbrellaStackName.authz(TENANT),
      }
      const expected: Record<Component, string> = {
        gatewayrole: 'gatewayrole',
        logsBucket: `apiable-${TENANT}-logs-bucket`,
        logsStream: `usagelogs-stream-apiable-${TENANT}`,
        usagetokensStream: `usagetokens-stream-apiable-${TENANT}`,
        cognito: `auth-portal-${TENANT}`,
        authz: `auth-portal-authz-${TENANT}`,
      }
      expect(names[component]).toBe(expected[component])
    })
  })

  // S6 — the proof is property+export equivalence, never a raw snapshot
  describe('S6: the equivalence check asserts properties + exports (logical-id tolerant), not a raw whole-template snapshot', () => {
    it('a pure logical-id rename false-fails a raw whole-template comparison but passes the property+export check', () => {
      const before = candidate.gatewayrole()
      // model the construct-extraction effect: every logical id consistently re-prefixed (keys + every
      // Ref/GetAtt/PolicyName echo), the resource graph otherwise byte-identical
      const renamed: Json = JSON.parse(
        JSON.stringify(before).replace(/"(GatewayRole[A-Za-z0-9]+)"/g, '"Refactored$1"'),
      )
      // a raw whole-template snapshot is the WRONG oracle — the deliberate logical-id rename trips it
      expect(renamed.Resources).not.toEqual(before.Resources)
      // the right oracle — property + export equivalence — sees no observable change
      expect(cfnDifferences(before, renamed)).toEqual([])
      expect(isCfnEquivalent(before, renamed)).toBe(true)
    })

    it('renaming a referenced logical id (and its Ref/PolicyName echoes) is tolerated, not flagged', () => {
      const before = candidate.gatewayrole()
      // rename the IAM role logical id everywhere it is keyed or referenced — the deep effect of a
      // construct re-parenting; the resource graph is otherwise byte-identical
      const renamed: Json = JSON.parse(JSON.stringify(before))
      const resources = renamed.Resources ?? {}
      const oldId = Object.keys(resources).find((id) => (resources[id] as { Type: string }).Type === 'AWS::IAM::Role') as string
      const newId = `Refactored${oldId}`
      const rewrite = (s: string): string => s.split(oldId).join(newId)
      renamed.Resources = JSON.parse(rewrite(JSON.stringify(resources)))
      // sanity: the raw templates now differ (the rename touched keys, Ref, PolicyName)
      expect(renamed.Resources).not.toEqual(before.Resources)
      // the engine tolerates it — the role + its policy are the same resources under new ids
      expect(cfnDifferences(before, renamed)).toEqual([])
    })

    it('a real property change (not a rename) is caught by the property+export check', () => {
      const before = candidate.gatewayrole()
      const changed: Json = JSON.parse(JSON.stringify(before))
      const role = Object.values(changed.Resources ?? {}).find((r) => (r as { Type: string }).Type === 'AWS::IAM::Role') as {
        Properties: { RoleName: string }
      }
      role.Properties.RoleName = 'a-different-role-name'
      expect(cfnDifferences(before, changed).length).toBeGreaterThan(0)
    })

    it('the resource multiset is keyed by type+properties, so it is insensitive to logical-id keys', () => {
      const before = resourceShapes(baseline.logsBucket())
      const after = resourceShapes(candidate.logsBucket())
      expect([...after.entries()].sort()).toEqual([...before.entries()].sort())
    })
  })
})
