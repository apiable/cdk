/**
 * Acceptance specs for story 013-1-18 — the release-time parity check identifies every resource by an
 * author-declared, channel-identical apiable:logical-id, never an inferred name.
 * Frozen contract: contract-013-1-18-parity-gate-channel-stable-logical-id.md
 *
 * One un-skipped spec per contract scenario (S1–S6), driven through the real reducers + gate against
 * declared-id fixtures, and (S6) the retrofitted gateway-role pilot + logs-bucket constructs. No diff
 * logic is re-declared here — every assertion tracks what the channel reducers actually emit.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { buildPublishedStack as buildGatewayRolePublished } from '@apiable/cdk-gateway-role'
import { buildPublishedStack as buildLogsBucketPublished } from '@apiable/cdk-logs-bucket'
import { ChannelModel, gate, reduceCloudFormation, reduceTerraformShowJson } from '@apiable/parity-gate'
import { publishedTemplatePath } from './support/published-template'

const TAG = 'apiable:logical-id'
const REGION = 'eu-central-1'
const arnRoot = (account: string): string => `arn:aws:iam::${account}:root`
const roleRef = (model: ChannelModel): string | undefined => model.graph.nodes.find((node) => node.kind === 'iam-role')?.ref

// ── CloudFormation fixtures (reduced under the cdk + cfn channel labels) ───────────────────────
const cfnRole = (declaredId: string | undefined, name: string, trustAccount: string): unknown => ({
  Resources: {
    AnyCfnLogicalId: {
      Type: 'AWS::IAM::Role',
      Properties: {
        RoleName: name,
        ...(declaredId !== undefined ? { Tags: [{ Key: TAG, Value: declaredId }] } : {}),
        AssumeRolePolicyDocument: {
          Version: '2012-10-17',
          Statement: [{ Effect: 'Allow', Principal: { AWS: arnRoot(trustAccount) }, Action: 'sts:AssumeRole' }],
        },
      },
    },
  },
})

// ── Terraform fixture carrying the SAME declared id under a different native type + name ───────
const tfRole = (declaredId: string | undefined, name: string, trustAccount: string): unknown => ({
  planned_values: {
    root_module: {
      resources: [
        {
          address: 'aws_iam_role.some_other_address',
          type: 'aws_iam_role',
          values: {
            name,
            ...(declaredId !== undefined ? { tags: { [TAG]: declaredId }, tags_all: { [TAG]: declaredId } } : {}),
            assume_role_policy: JSON.stringify({
              Version: '2012-10-17',
              Statement: [{ Effect: 'Allow', Principal: { AWS: arnRoot(trustAccount) }, Action: 'sts:AssumeRole' }],
            }),
          },
        },
      ],
    },
  },
  configuration: { root_module: { resources: [], outputs: {} } },
})

describe('013-1-18 parity check — declared-identity discriminator', () => {
  // contract: S1 — same declared identity → recognised as the same resource
  it('S1: a role carrying the same declared id across channels is one resource, despite different native type + name', () => {
    const cdkModel = reduceCloudFormation(cfnRole('access-role', 'CfnGeneratedRoleName', '034444869755'), 'cdk')
    const cfnModel = reduceCloudFormation(cfnRole('access-role', 'CfnGeneratedRoleName', '034444869755'), 'cfn')
    const tfModel = reduceTerraformShowJson(tfRole('access-role', 'tf-different-role-name', '034444869755'), 'terraform', REGION)

    // identical declared id ⇒ identical node ref, regardless of the AWS::IAM::Role vs aws_iam_role type or the name
    expect(roleRef(cdkModel)).toBe('iam-role:access-role')
    expect(roleRef(tfModel)).toBe('iam-role:access-role')

    const result = gate([cdkModel, cfnModel, tfModel])
    expect(result.passed).toBe(true)
    expect(result.divergences).toEqual([])
  })

  // contract: S2 — a tenant/region-parameterised name does not split identity
  it('S2: the same declared id with a placeholder name in one channel and a concrete tenant value in another stays one resource (name cosmetic, not a divergence)', () => {
    // one channel renders the name as an unresolved parameter, another as a concrete tenant value
    const placeholder = reduceCloudFormation(cfnRole('logs-write-role', 'apiable-logs-@ref:TenantName-s3-role', '034444869755'), 'cdk')
    const alsoPlaceholder = reduceCloudFormation(cfnRole('logs-write-role', 'apiable-logs-@ref:TenantName-s3-role', '034444869755'), 'cfn')
    const concrete = reduceTerraformShowJson(tfRole('logs-write-role', 'apiable-logs-acme-s3-role', '034444869755'), 'terraform', REGION)

    expect(roleRef(placeholder)).toBe('iam-role:logs-write-role')
    expect(roleRef(concrete)).toBe('iam-role:logs-write-role')

    const result = gate([placeholder, alsoPlaceholder, concrete])
    // the tenant difference is not a divergence; it only ever surfaces as a cosmetic name warning
    expect(result.passed).toBe(true)
    expect(result.divergences).toEqual([])
    expect(result.warnings.some((warning) => warning.includes('name:iam-role:logs-write-role'))).toBe(true)
  })

  // contract: S3 — two same-kind resources that would collide by name are kept distinct (FORCING)
  it('S3: two nameless roles, the first widened in one channel, stay distinct by declared id and the widening is CAUGHT, never clobbered', () => {
    // Both roles are nameless: under the inferred-name scheme they collapsed onto one key and the first
    // role's by-value trust account was clobbered by the second (last-write-wins), passing the widening
    // as equal. Declared ids keep them distinct so the clobbered widening surfaces.
    const twoRoles = (firstRoleTrust: string): unknown => ({
      Resources: {
        RoleA: {
          Type: 'AWS::IAM::Role',
          Properties: {
            Tags: [{ Key: TAG, Value: 'role-a' }],
            AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: arnRoot(firstRoleTrust) }, Action: 'sts:AssumeRole' }] },
          },
        },
        RoleB: {
          Type: 'AWS::IAM::Role',
          Properties: {
            Tags: [{ Key: TAG, Value: 'role-b' }],
            AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: arnRoot('222222222222') }, Action: 'sts:AssumeRole' }] },
          },
        },
      },
    })
    const cdkModel = reduceCloudFormation(twoRoles('111111111111'), 'cdk')
    // the two roles are two distinct nodes, never collapsed onto one
    expect(cdkModel.graph.nodes.filter((node) => node.kind === 'iam-role').map((node) => node.ref)).toEqual(['iam-role:role-a', 'iam-role:role-b'])

    const result = gate([
      cdkModel,
      reduceCloudFormation(twoRoles('111111111111'), 'cfn'),
      reduceCloudFormation(twoRoles('999988887777'), 'terraform'), // RoleA's trust widened to a different account
    ])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find((entry) => entry.tier === 'value' && entry.detail.includes('role-trust-account:iam-role:role-a'))
    expect(divergence).toBeDefined()
    expect(divergence?.detail).toContain('999988887777')
    expect(divergence?.channels).toEqual(['terraform'])
  })

  // contract: S4 — two attached resources under one parent are kept distinct (FORCING)
  it('S4: two invoke-permissions on one function stay distinct by parent + per-parent local key, so a divergence on the second is caught', () => {
    const twoPermissions = (secondScoped: boolean): unknown => ({
      Resources: {
        PermitCognito: {
          Type: 'AWS::Lambda::Permission',
          Properties: { FunctionName: 'pretokengen', Principal: 'cognito-idp.amazonaws.com', Action: 'lambda:InvokeFunction', SourceArn: 'arn:aws:cognito-idp:eu-central-1:034444869755:userpool/authz' },
        },
        PermitEvents: {
          Type: 'AWS::Lambda::Permission',
          Properties: { FunctionName: 'pretokengen', Principal: 'events.amazonaws.com', Action: 'lambda:InvokeFunction', ...(secondScoped ? { SourceArn: 'arn:aws:events:eu-central-1:034444869755:rule/nightly' } : {}) },
        },
      },
    })
    // the two permissions take two DISTINCT node refs (anchored to the function + their principal),
    // never collapsing onto one shared key the way an un-anchored lambda-permission did
    const permissionRefs = new Set(reduceCloudFormation(twoPermissions(true), 'cdk').graph.nodes.filter((node) => node.kind === 'lambda-permission').map((node) => node.ref))
    expect(permissionRefs.size).toBe(2)

    const result = gate([
      reduceCloudFormation(twoPermissions(true), 'cdk'),
      reduceCloudFormation(twoPermissions(true), 'cfn'),
      reduceCloudFormation(twoPermissions(false), 'terraform'), // the second (events) permission left unscoped
    ])
    expect(result.passed).toBe(false)
    // the unscoped second permission is caught on the permission (grant) tier — each invoke grant is
    // keyed by its principal, so the divergence surfaces there, not through the node-ref parent anchoring
    const divergence = result.divergences.find((entry) => entry.tier === 'permission' && entry.detail.includes('events.amazonaws.com'))
    expect(divergence?.channels).toEqual(['terraform'])
  })

  // contract: S5 — a missing declared identity is an explicit divergence, not a silent name fall-back
  it('S5: a role missing its declared id in one channel is an explicit divergence, never silently matched by its identical name', () => {
    const cdkModel = reduceCloudFormation(cfnRole('access-role', 'apiable-shared-name', '034444869755'), 'cdk')
    const cfnModel = reduceCloudFormation(cfnRole('access-role', 'apiable-shared-name', '034444869755'), 'cfn')
    // the terraform channel omits the tag — its name is identical, so a name fall-back would wrongly match
    const tfModel = reduceTerraformShowJson(tfRole(undefined, 'apiable-shared-name', '034444869755'), 'terraform', REGION)

    expect(roleRef(cdkModel)).toBe('iam-role:access-role')
    expect(roleRef(tfModel)).not.toBe('iam-role:access-role') // not inferred from the shared name
    expect(roleRef(tfModel)).toContain('no-declared-logical-id')

    const result = gate([cdkModel, cfnModel, tfModel])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find((entry) => entry.tier === 'graph' && entry.detail.includes('iam-role:access-role'))
    expect(divergence).toBeDefined()
    expect(divergence?.channels).toEqual(['terraform'])
  })

  // contract: S6 — existing verdicts unchanged (regression, retrofitted constructs)
  it('S6: the gateway-role pilot passes cleanly and the logs bucket reconciles every load-bearing tier under the declared-identity scheme', () => {
    const REPO_ROOT = path.resolve(__dirname, '..')
    const publishedTemplate = (component: string): unknown =>
      JSON.parse(fs.readFileSync(publishedTemplatePath(component), 'utf8'))

    // The gateway-role pilot (the component the gate already proves) — a clean pass under declared ids.
    const gatewayRole = gate([
      reduceCloudFormation(Template.fromStack(buildGatewayRolePublished(new cdk.App())).toJSON(), 'cdk'),
      reduceCloudFormation(publishedTemplate('apiable-gateway-role'), 'cfn'),
      reduceTerraformShowJson(JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'test/fixtures/parity-gate/terraform-gateway-role-show.json'), 'utf8')), 'terraform', REGION),
    ])
    expect(gatewayRole.passed).toBe(true)
    expect(gatewayRole.divergences).toEqual([])

    const deployAccount = '111111111111' // the logs-bucket fixture's incidental tenant-deploy account
    const logsCdk = reduceCloudFormation(Template.fromStack(buildLogsBucketPublished(new cdk.App())).toJSON(), 'cdk')
    const logsTf = reduceTerraformShowJson(JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'test/fixtures/parity-gate/terraform-logs-bucket-show.json'), 'utf8')), 'terraform', REGION, deployAccount)
    const logsBucket = gate([logsCdk, reduceCloudFormation(publishedTemplate('apiable-logs-bucket'), 'cfn'), logsTf])

    // The bucket, write-role, and bucket-policy reconcile to one channel-stable identity each, despite
    // tenant-parameterised vs concrete names — the verdict the declared id establishes.
    const resourceRefs = (model: ChannelModel): string[] => model.graph.nodes.filter((node) => node.kind !== 'output').map((node) => node.ref).sort()
    expect(resourceRefs(logsCdk)).toEqual(resourceRefs(logsTf))
    expect(resourceRefs(logsCdk)).toContain('s3-bucket:apiable-logs-bucket')
    expect(resourceRefs(logsCdk)).toContain('iam-role:apiable-logs-write-role')

    // Declared identity introduces no false alarm on any load-bearing tier (graph resources, values,
    // permissions, secrets). The bucket-name export differs by channel-native expression (CFN `Ref`
    // vs TF `.bucket`) — a pre-existing output graph-modelling artifact unrelated to declared identity
    // and owned by the S3-storage slice, so it is excluded from the declared-id verdict here.
    const loadBearingDivergences = logsBucket.divergences.filter((entry) => !(entry.tier === 'graph' && entry.detail.includes('output:')))
    expect(loadBearingDivergences).toEqual([])
  })
})
