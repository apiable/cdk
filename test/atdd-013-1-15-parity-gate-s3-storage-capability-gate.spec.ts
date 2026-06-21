/**
 * Acceptance specs — Story 013-1-15: harden the release-time parity check for the S3 logs-storage tier.
 * Frozen contract: contract-013-1-15-parity-gate-s3-storage-capability.md
 *
 * One un-skipped spec per contract scenario (S1–S9), each driving the real reducers + gate against
 * faithful multi-resource logs-bucket artifacts: a tenant-scoped bucket, the bucket-policy granting
 * the deploying account and the single bounded partner account, and the partner write-role. The CDK
 * and one-click channels are reduced from CloudFormation and the Terraform channel from
 * `terraform show -json`, so each property is proven across both reducers — never a shape compared
 * to itself. Every taggable primary carries the author-declared `apiable:logical-id` (the same tag the
 * real construct + committed TF fixture emit), so the gate keys it by declared identity, not its
 * tenant-scoped name. Every divergence fixture is forcing: it cannot go green while a widened
 * cross-account write principal compares equal by count, a deploy-only narrowing drops its write-account
 * key to silent absence, or a second bucket's widening is clobbered onto the first.
 *
 * Shares canonical.ts + both reducers + compareGrants/normaliseLogical with sibling 013-1-14 (the
 * cognito grant & trust security core): its forcing fixtures are re-run alongside these (parity-gate.spec.ts).
 */
import { gate, reduceCloudFormation, reduceTerraformShowJson } from '@apiable/parity-gate'
import { LOGS_BUCKET_LOGICAL_ID, LOGS_WRITE_ROLE_LOGICAL_ID } from '@apiable/cdk-logs-bucket'

const REGION = 'eu-central-1'
const TENANT = 'staging'
// The deploying (tenant) account — incidental, normalises to {account} in every channel.
const TENANT_ACCOUNT = '111111111111'
// The single intended cross-account writer — bounded, load-bearing, compared BY VALUE.
const PARTNER_ACCOUNT = '034444869755'
// The author-declared identity tag every taggable primary carries, identical across channels.
const DECLARED_ID_TAG = 'apiable:logical-id'
// The gateway access-role's declared id (mirrors @apiable/cdk-gateway-role's GATEWAY_ROLE_LOGICAL_ID),
// so the S7 regression fixture reconciles its role across channels exactly as the real pilot does.
const GATEWAY_ROLE_LOGICAL_ID = 'apiable-gateway-role'
// A second logs bucket's declared id — the multi-bucket topology the usage-log/usage-token streams add.
const SECOND_BUCKET_LOGICAL_ID = 'apiable-logs-bucket-tokens'

// ── CloudFormation channels (CDK construct + published one-click), built from the same template
//    helper so the two CFN-shaped channels share one source and only the parameterisation differs. ──

interface CfnBucketOptions {
  /** The bucket/role tenant segment. A concrete value, or `{ Ref: 'TenantName' }` for the one-click param form. */
  readonly tenant: string | { Ref: string }
  /** The bucket-policy write principals (the security-bearing cross-account write grant). */
  readonly policyPrincipals: unknown
}

const cfnTag = (value: string): unknown => ({ Key: DECLARED_ID_TAG, Value: value })
const tfTags = (value: string): Record<string, unknown> => ({ tags: { [DECLARED_ID_TAG]: value }, tags_all: { [DECLARED_ID_TAG]: value } })

const arnRoot = (account: string): string => `arn:aws:iam::${account}:root`
// The deploying-account root as the published one-click template carries it: the AWS::AccountId
// pseudo-parameter (no concrete account literal) wrapped in the account-root ARN.
const arnRootAccountId = (): unknown => ({ 'Fn::Join': ['', ['arn:aws:iam::', { Ref: 'AWS::AccountId' }, ':root']] })

/** A logs-bucket CloudFormation template: bucket + bucket-policy + write-role + the role's inline s3 grant. */
const cfnLogsBucket = (options: CfnBucketOptions): unknown => {
  const name =
    typeof options.tenant === 'string'
      ? `apiable-logs-${options.tenant}`
      : { 'Fn::Join': ['', ['apiable-logs-', options.tenant]] }
  const roleName =
    typeof options.tenant === 'string'
      ? `apiable-logs-${options.tenant}-s3-role`
      : { 'Fn::Join': ['', ['apiable-logs-', options.tenant, '-s3-role']] }
  return {
    Resources: {
      ApiableLogs: {
        Type: 'AWS::S3::Bucket',
        Properties: { BucketName: name, Tags: [cfnTag(LOGS_BUCKET_LOGICAL_ID)] },
      },
      ApiableLogsPolicy: {
        Type: 'AWS::S3::BucketPolicy',
        Properties: {
          Bucket: { Ref: 'ApiableLogs' },
          PolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Sid: 'Permissions',
                Effect: 'Allow',
                Principal: { AWS: options.policyPrincipals },
                Action: 's3:*',
                Resource: [{ 'Fn::GetAtt': ['ApiableLogs', 'Arn'] }, { 'Fn::Join': ['', [{ 'Fn::GetAtt': ['ApiableLogs', 'Arn'] }, '/*']] }],
              },
            ],
          },
        },
      },
      WriteRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          RoleName: roleName,
          Tags: [cfnTag(LOGS_WRITE_ROLE_LOGICAL_ID)],
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [{ Effect: 'Allow', Principal: { AWS: arnRoot(PARTNER_ACCOUNT) }, Action: 'sts:AssumeRole' }],
          },
        },
      },
      WriteRolePolicy: {
        Type: 'AWS::IAM::Policy',
        Properties: {
          PolicyName: 's3-access',
          Roles: [{ Ref: 'WriteRole' }],
          PolicyDocument: {
            Version: '2012-10-17',
            Statement: [{ Effect: 'Allow', Action: 's3:*', Resource: [{ 'Fn::GetAtt': ['ApiableLogs', 'Arn'] }] }],
          },
        },
      },
    },
  }
}

// ── Terraform channel (`terraform show -json`), modelling a CREDENTIALED plan: data.aws_caller_identity
//    resolves to the real tenant account, so the bucket-policy carries the genuine deploying principal. ──

interface TfBucketOptions {
  readonly tenant: string
  /** The deploying-account principal ARN — the real tenant root under credentials, or a stand-in/unresolved form. */
  readonly tenantPrincipal: string
  /** The partner (cross-account writer) principal ARNs, alongside the tenant principal. */
  readonly partnerPrincipals: readonly string[]
}

/** A logs-bucket `terraform show -json`: bucket + bucket-policy + write-role + its inline s3 policy. */
const tfLogsBucket = (options: TfBucketOptions): unknown => {
  const policy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'Permissions',
        Effect: 'Allow',
        Principal: { AWS: [options.tenantPrincipal, ...options.partnerPrincipals] },
        Action: 's3:*',
        Resource: [`arn:aws:s3:::apiable-logs-${options.tenant}`, `arn:aws:s3:::apiable-logs-${options.tenant}/*`],
      },
    ],
  })
  const assumePolicy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Principal: { AWS: arnRoot(PARTNER_ACCOUNT) }, Action: 'sts:AssumeRole' }],
  })
  const inlinePolicy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Action: 's3:*', Resource: [`arn:aws:s3:::apiable-logs-${options.tenant}`] }],
  })
  return {
    planned_values: {
      root_module: {
        resources: [
          { address: 'aws_s3_bucket.this', type: 'aws_s3_bucket', values: { bucket: `apiable-logs-${options.tenant}`, ...tfTags(LOGS_BUCKET_LOGICAL_ID) } },
          { address: 'aws_s3_bucket_policy.this', type: 'aws_s3_bucket_policy', values: { policy } },
          { address: 'aws_iam_role.this', type: 'aws_iam_role', values: { name: `apiable-logs-${options.tenant}-s3-role`, ...tfTags(LOGS_WRITE_ROLE_LOGICAL_ID), assume_role_policy: assumePolicy } },
          { address: 'aws_iam_role_policy.s3_access', type: 'aws_iam_role_policy', values: { name: 's3-access', policy: inlinePolicy } },
        ],
      },
    },
    configuration: {
      root_module: {
        resources: [
          { address: 'aws_s3_bucket.this', type: 'aws_s3_bucket', expressions: {} },
          { address: 'aws_s3_bucket_policy.this', type: 'aws_s3_bucket_policy', expressions: { bucket: { references: ['aws_s3_bucket.this.id', 'aws_s3_bucket.this'] } } },
          { address: 'aws_iam_role.this', type: 'aws_iam_role', expressions: {} },
          { address: 'aws_iam_role_policy.s3_access', type: 'aws_iam_role_policy', expressions: { role: { references: ['aws_iam_role.this.id', 'aws_iam_role.this'] } } },
        ],
        outputs: {},
      },
    },
  }
}

// The equivalent component across all three channels: the CDK synth (concrete tenant + deploying
// account), the published one-click (tenant as a parameter, deploying account as AWS::AccountId), and
// a credentialed Terraform plan (data.aws_caller_identity → the real tenant root). All grant s3:* to
// the deploying account + the one bounded partner account.
const equivalentChannels = () => ({
  cdk: reduceCloudFormation(cfnLogsBucket({ tenant: TENANT, policyPrincipals: [arnRoot(TENANT_ACCOUNT), arnRoot(PARTNER_ACCOUNT)] }), 'cdk', REGION, TENANT_ACCOUNT),
  cfn: reduceCloudFormation(cfnLogsBucket({ tenant: { Ref: 'TenantName' }, policyPrincipals: [arnRootAccountId(), arnRoot(PARTNER_ACCOUNT)] }), 'cfn', REGION),
  terraform: reduceTerraformShowJson(tfLogsBucket({ tenant: TENANT, tenantPrincipal: arnRoot(TENANT_ACCOUNT), partnerPrincipals: [arnRoot(PARTNER_ACCOUNT)] }), 'terraform', REGION, TENANT_ACCOUNT),
})

describe('013-1-15 parity check — S3 logs-storage tier', () => {
  // S1 — equivalent across all three channels → the check reports agreement
  it('S1: equivalent bucket + bounded write permission + write-role across all three channels → parity holds (no storage-tier divergence)', () => {
    const { cdk, cfn, terraform } = equivalentChannels()
    const result = gate([cdk, cfn, terraform])
    expect(result.passed).toBe(true)
    expect(result.divergences).toEqual([])
  })

  // S2 — each channel names the storage resources in its own native form → same logical resources
  it('S2: channels naming the storage resource type in their own native form are recognised as the same resources (no phantom present/absent node)', () => {
    const { cdk, cfn, terraform } = equivalentChannels()
    // The CDK/CFN channels carry AWS::S3::Bucket / AWS::S3::BucketPolicy; the Terraform channel carries
    // aws_s3_bucket / aws_s3_bucket_policy. They reduce to one canonical kind, so no node reads as
    // present-in-one/absent-in-another purely on the channel-native type name.
    const result = gate([cdk, cfn, terraform])
    const graphDivergences = result.divergences.filter((entry) => entry.tier === 'graph')
    expect(graphDivergences).toEqual([])
    // Both storage kinds are present in every channel's reduced graph.
    for (const model of [cdk, cfn, terraform]) {
      expect(model.graph.nodes.some((node) => node.kind === 's3-bucket')).toBe(true)
      expect(model.graph.nodes.some((node) => node.kind === 's3-bucket-policy')).toBe(true)
    }
  })

  // S3 — a tenant-specific name reconciles across channels
  it('S3: a tenant-suffixed bucket/role name — unresolved placeholder in one channel, concrete tenant value in another — reconciles to one logical resource', () => {
    // The one-click channel renders the bucket/role name through an unresolved TenantName parameter
    // (@ref:TenantName); the Terraform channel carries a concrete tenant value. The declared id keys both
    // the bucket and the tenant-suffixed role, so neither reads as a divergence on the tenant segment.
    const { cdk, cfn, terraform } = equivalentChannels()
    const result = gate([cdk, cfn, terraform])
    expect(result.divergences.filter((entry) => entry.tier === 'graph')).toEqual([])
    // The bucket and the write-role carry one channel-stable node ref — the declared id — across all three channels.
    const bucketRefs = new Set([cdk, cfn, terraform].map((m) => m.graph.nodes.find((n) => n.kind === 's3-bucket')?.ref))
    expect(bucketRefs).toEqual(new Set(['s3-bucket:apiable-logs-bucket']))
    const roleRefs = new Set([cdk, cfn, terraform].map((m) => m.graph.nodes.find((n) => n.kind === 'iam-role')?.ref))
    expect(roleRefs).toEqual(new Set(['iam-role:apiable-logs-write-role']))
  })

  // A divergence that names the bucket-policy write grant, on either tier the engine reports it: the
  // permission tier (the grant signature — a structural change such as a wildcard principal) or the
  // value tier (the by-value cross-account write-account set — a different/extra/missing partner).
  const writeGrantDivergence = (result: ReturnType<typeof gate>) =>
    result.divergences.find(
      (entry) =>
        (entry.tier === 'permission' && entry.detail.includes('grant:bucket-policy')) ||
        (entry.tier === 'value' && entry.detail.includes('bucket-policy-write-accounts')),
    )

  // S4 — a widened cross-account write grant is caught (FORCING — fail-open closure)
  it('S4: a write permission widened beyond the single intended account (extra principal) → the check FAILS naming the divergent write grant', () => {
    const cdk = reduceCloudFormation(cfnLogsBucket({ tenant: TENANT, policyPrincipals: [arnRoot(TENANT_ACCOUNT), arnRoot(PARTNER_ACCOUNT)] }), 'cdk', REGION, TENANT_ACCOUNT)
    const cfn = reduceCloudFormation(cfnLogsBucket({ tenant: { Ref: 'TenantName' }, policyPrincipals: [arnRootAccountId(), arnRoot(PARTNER_ACCOUNT)] }), 'cfn', REGION)
    // Terraform widens: the deploying account + the bounded partner AND an unbounded extra account.
    const terraform = reduceTerraformShowJson(
      tfLogsBucket({ tenant: TENANT, tenantPrincipal: arnRoot(TENANT_ACCOUNT), partnerPrincipals: [arnRoot(PARTNER_ACCOUNT), arnRoot('999988887777')] }),
      'terraform',
      REGION,
      TENANT_ACCOUNT,
    )
    const result = gate([cdk, cfn, terraform])
    expect(result.passed).toBe(false)
    const divergence = writeGrantDivergence(result)
    expect(divergence).toBeDefined()
    expect(divergence?.channels).toEqual(['terraform'])
  })

  it('S4: a wildcard write principal (any account) → the check FAILS naming the divergent write grant', () => {
    const cdk = reduceCloudFormation(cfnLogsBucket({ tenant: TENANT, policyPrincipals: [arnRoot(TENANT_ACCOUNT), arnRoot(PARTNER_ACCOUNT)] }), 'cdk', REGION, TENANT_ACCOUNT)
    const cfn = reduceCloudFormation(cfnLogsBucket({ tenant: { Ref: 'TenantName' }, policyPrincipals: [arnRootAccountId(), arnRoot(PARTNER_ACCOUNT)] }), 'cfn', REGION)
    // Terraform widens to a wildcard principal — any account may write.
    const terraform = reduceTerraformShowJson(
      tfLogsBucket({ tenant: TENANT, tenantPrincipal: arnRoot(TENANT_ACCOUNT), partnerPrincipals: ['*'] }),
      'terraform',
      REGION,
      TENANT_ACCOUNT,
    )
    const result = gate([cdk, cfn, terraform])
    expect(result.passed).toBe(false)
    expect(writeGrantDivergence(result)).toBeDefined()
  })

  // S5 — the Terraform channel must be described under the genuine deploying context
  it('S5: a Terraform description produced without the real deploying-account context (unresolved writer) is not certified equivalent against the misrepresented write grant', () => {
    const cdk = reduceCloudFormation(cfnLogsBucket({ tenant: TENANT, policyPrincipals: [arnRoot(TENANT_ACCOUNT), arnRoot(PARTNER_ACCOUNT)] }), 'cdk', REGION, TENANT_ACCOUNT)
    const cfn = reduceCloudFormation(cfnLogsBucket({ tenant: { Ref: 'TenantName' }, policyPrincipals: [arnRootAccountId(), arnRoot(PARTNER_ACCOUNT)] }), 'cfn', REGION)
    // An uncredentialed plan leaves data.aws_caller_identity unresolved, so the deploying principal is a
    // stand-in with no account (arn:aws:iam:::root) rather than the real tenant root. Reducing it without
    // the genuine deploying-account context (no deployAccount supplied — the leg was not credentialed)
    // produces a misrepresented write grant the gate must not certify equivalent.
    const terraform = reduceTerraformShowJson(
      tfLogsBucket({ tenant: TENANT, tenantPrincipal: 'arn:aws:iam:::root', partnerPrincipals: [arnRoot(PARTNER_ACCOUNT)] }),
      'terraform',
      REGION,
    )
    const result = gate([cdk, cfn, terraform])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find((entry) => entry.tier === 'permission' && entry.detail.includes('grant:bucket-policy'))
    expect(divergence).toBeDefined()
    expect(divergence?.channels).toEqual(['terraform'])
  })

  // S6 — the one-click channel's write permission is judged by who it grants, not by rule count
  it('S6: a one-click channel write permission widened but with a matching rule count is caught by comparing the granted principal, not the count', () => {
    const cdk = reduceCloudFormation(cfnLogsBucket({ tenant: TENANT, policyPrincipals: [arnRoot(TENANT_ACCOUNT), arnRoot(PARTNER_ACCOUNT)] }), 'cdk', REGION, TENANT_ACCOUNT)
    // The one-click (published CFN) channel widens the partner to a DIFFERENT account, keeping the same
    // two-principal count, so only a by-who comparison (never a count) catches it.
    const cfn = reduceCloudFormation(cfnLogsBucket({ tenant: { Ref: 'TenantName' }, policyPrincipals: [arnRootAccountId(), arnRoot('555544443333')] }), 'cfn', REGION)
    const terraform = reduceTerraformShowJson(tfLogsBucket({ tenant: TENANT, tenantPrincipal: arnRoot(TENANT_ACCOUNT), partnerPrincipals: [arnRoot(PARTNER_ACCOUNT)] }), 'terraform', REGION, TENANT_ACCOUNT)
    // Each channel's bucket-policy carries exactly one statement with exactly two principals — equal counts.
    for (const model of [cdk, cfn, terraform]) {
      const bucketPolicyGrants = model.grants.filter((g) => g.ref.startsWith('grant:bucket-policy'))
      expect(bucketPolicyGrants).toHaveLength(1)
    }
    const result = gate([cdk, cfn, terraform])
    expect(result.passed).toBe(false)
    const divergence = writeGrantDivergence(result)
    expect(divergence).toBeDefined()
    expect(divergence?.channels).toEqual(['cfn'])
  })

  // S7 — adding the storage tier does not disturb existing verdicts (regression)
  it('S7: the gateway access-role verdict is unchanged after the storage tier is added — equivalent role channels still pass', () => {
    // The IAM-pilot gateway role, equivalent across channels, must still report PARITY OK with the S3
    // vocabulary now in the canonical tables and both reducers. The role carries the same declared id the
    // real gateway-role construct emits, so an enforced taggable primary reconciles across channels.
    const cfnRole = (region: string, channel: 'cdk' | 'cfn'): unknown =>
      reduceCloudFormation(
        {
          Resources: {
            Role: {
              Type: 'AWS::IAM::Role',
              Properties: {
                RoleName: 'apiable-gateway-managment-role',
                Tags: [cfnTag(GATEWAY_ROLE_LOGICAL_ID)],
                AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: arnRoot(PARTNER_ACCOUNT) }, Action: 'sts:AssumeRole' }] },
              },
            },
            Policy: {
              Type: 'AWS::IAM::RolePolicy',
              Properties: {
                PolicyName: 'apigateway-management',
                Roles: [{ Ref: 'Role' }],
                PolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'apigateway:*', Resource: `arn:aws:apigateway:${region}::/*` }] },
              },
            },
          },
        },
        channel,
        region,
      ) as unknown
    const tfRole = reduceTerraformShowJson(
      {
        planned_values: {
          root_module: {
            resources: [
              { address: 'aws_iam_role.this', type: 'aws_iam_role', values: { name: 'apiable-gateway-managment-role', ...tfTags(GATEWAY_ROLE_LOGICAL_ID), assume_role_policy: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: arnRoot(PARTNER_ACCOUNT) }, Action: 'sts:AssumeRole' }] }) } },
              { address: 'aws_iam_role_policy.apigateway_management', type: 'aws_iam_role_policy', values: { name: 'apigateway-management', policy: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'apigateway:*', Resource: `arn:aws:apigateway:${REGION}::/*` }] }) } },
            ],
          },
        },
        configuration: { root_module: { resources: [{ address: 'aws_iam_role_policy.apigateway_management', type: 'aws_iam_role_policy', expressions: { role: { references: ['aws_iam_role.this.id', 'aws_iam_role.this'] } } }], outputs: {} } },
      },
      'terraform',
      REGION,
    )
    const result = gate([cfnRole(REGION, 'cdk') as never, cfnRole(REGION, 'cfn') as never, tfRole])
    expect(result.passed).toBe(true)
    expect(result.divergences).toEqual([])
  })

  // S8 — a channel narrowed to the deploying account only is compared by value, never silent absence (FORCING)
  it('S8: one channel grants an external account, another narrows to the deploying account only → the empty external-writer set is an explicit {none} value (present-vs-present), the narrowing is CAUGHT not missed as a dropped key', () => {
    const cdk = reduceCloudFormation(cfnLogsBucket({ tenant: TENANT, policyPrincipals: [arnRoot(TENANT_ACCOUNT), arnRoot(PARTNER_ACCOUNT)] }), 'cdk', REGION, TENANT_ACCOUNT)
    const cfn = reduceCloudFormation(cfnLogsBucket({ tenant: { Ref: 'TenantName' }, policyPrincipals: [arnRootAccountId(), arnRoot(PARTNER_ACCOUNT)] }), 'cfn', REGION)
    // Terraform narrows to the deploying account only — no external writer at all.
    const terraform = reduceTerraformShowJson(tfLogsBucket({ tenant: TENANT, tenantPrincipal: arnRoot(TENANT_ACCOUNT), partnerPrincipals: [] }), 'terraform', REGION, TENANT_ACCOUNT)
    const writeAccountKey = 'bucket-policy-write-accounts:s3-bucket-policy:apiable-logs-bucket'
    // The deploy-only channel carries the write-account key as an explicit {none}, never a dropped key,
    // so the comparison is present-vs-present (the partner-granting channels vs {none}), not a presence vote.
    expect(terraform.values[writeAccountKey]).toBe('{none}')
    expect(cdk.values[writeAccountKey]).toBe(PARTNER_ACCOUNT)
    const result = gate([cdk, cfn, terraform])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find((entry) => entry.tier === 'value' && entry.detail.includes(writeAccountKey))
    expect(divergence).toBeDefined()
    expect(divergence?.channels).toEqual(['terraform'])
  })

  // ── Two-bucket fixtures (the multi-bucket topology the usage-log/usage-token streams introduce) ──
  const cfnTwoBuckets = (): unknown => {
    const bucketStatement = (bucketRef: string, principals: unknown): unknown => ({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'Permissions',
          Effect: 'Allow',
          Principal: { AWS: principals },
          Action: 's3:*',
          Resource: [{ 'Fn::GetAtt': [bucketRef, 'Arn'] }, { 'Fn::Join': ['', [{ 'Fn::GetAtt': [bucketRef, 'Arn'] }, '/*']] }],
        },
      ],
    })
    return {
      Resources: {
        BucketOne: { Type: 'AWS::S3::Bucket', Properties: { BucketName: `apiable-logs-${TENANT}`, Tags: [cfnTag(LOGS_BUCKET_LOGICAL_ID)] } },
        PolicyOne: { Type: 'AWS::S3::BucketPolicy', Properties: { Bucket: { Ref: 'BucketOne' }, PolicyDocument: bucketStatement('BucketOne', [arnRoot(TENANT_ACCOUNT), arnRoot(PARTNER_ACCOUNT)]) } },
        BucketTwo: { Type: 'AWS::S3::Bucket', Properties: { BucketName: `apiable-logs-${TENANT}-tokens`, Tags: [cfnTag(SECOND_BUCKET_LOGICAL_ID)] } },
        PolicyTwo: { Type: 'AWS::S3::BucketPolicy', Properties: { Bucket: { Ref: 'BucketTwo' }, PolicyDocument: bucketStatement('BucketTwo', [arnRoot(TENANT_ACCOUNT), arnRoot(PARTNER_ACCOUNT)]) } },
      },
    }
  }
  const tfTwoBuckets = (secondPartnerPrincipals: readonly string[]): unknown => {
    const bucketName = `apiable-logs-${TENANT}`
    const secondBucketName = `apiable-logs-${TENANT}-tokens`
    const policyDoc = (bucket: string, principals: readonly string[]): string =>
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Sid: 'Permissions', Effect: 'Allow', Principal: { AWS: principals }, Action: 's3:*', Resource: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`] }],
      })
    return {
      planned_values: {
        root_module: {
          resources: [
            { address: 'aws_s3_bucket.one', type: 'aws_s3_bucket', values: { bucket: bucketName, ...tfTags(LOGS_BUCKET_LOGICAL_ID) } },
            { address: 'aws_s3_bucket_policy.one', type: 'aws_s3_bucket_policy', values: { policy: policyDoc(bucketName, [arnRoot(TENANT_ACCOUNT), arnRoot(PARTNER_ACCOUNT)]) } },
            { address: 'aws_s3_bucket.two', type: 'aws_s3_bucket', values: { bucket: secondBucketName, ...tfTags(SECOND_BUCKET_LOGICAL_ID) } },
            { address: 'aws_s3_bucket_policy.two', type: 'aws_s3_bucket_policy', values: { policy: policyDoc(secondBucketName, [arnRoot(TENANT_ACCOUNT), ...secondPartnerPrincipals]) } },
          ],
        },
      },
      configuration: {
        root_module: {
          resources: [
            { address: 'aws_s3_bucket.one', type: 'aws_s3_bucket', expressions: {} },
            { address: 'aws_s3_bucket_policy.one', type: 'aws_s3_bucket_policy', expressions: { bucket: { references: ['aws_s3_bucket.one.id', 'aws_s3_bucket.one'] } } },
            { address: 'aws_s3_bucket.two', type: 'aws_s3_bucket', expressions: {} },
            { address: 'aws_s3_bucket_policy.two', type: 'aws_s3_bucket_policy', expressions: { bucket: { references: ['aws_s3_bucket.two.id', 'aws_s3_bucket.two'] } } },
          ],
          outputs: {},
        },
      },
    }
  }

  // S9 — two log buckets, the loser widened in one channel, are caught not clobbered
  it("S9: two apiable-logs-* buckets, the SECOND bucket's write principal widened in one channel → kept distinct, the widening on the second is CAUGHT, never collapsed/clobbered", () => {
    const cdk = reduceCloudFormation(cfnTwoBuckets(), 'cdk', REGION, TENANT_ACCOUNT)
    const cfn = reduceCloudFormation(cfnTwoBuckets(), 'cfn', REGION, TENANT_ACCOUNT)
    // Terraform widens ONLY the second bucket's write principal with an extra account.
    const terraform = reduceTerraformShowJson(tfTwoBuckets([arnRoot(PARTNER_ACCOUNT), arnRoot('999988887777')]), 'terraform', REGION, TENANT_ACCOUNT)
    const result = gate([cdk, cfn, terraform])
    expect(result.passed).toBe(false)
    // Exactly one by-value write-account divergence, NAMING the SECOND bucket's key — the loser is caught,
    // never clobbered onto the first (which stays in agreement); two distinct buckets, never collapsed into
    // one comparison whose surviving value would mask the widened loser.
    const writeAccountDivergences = result.divergences.filter(
      (entry) => entry.tier === 'value' && entry.detail.includes('bucket-policy-write-accounts'),
    )
    expect(writeAccountDivergences).toHaveLength(1)
    expect(writeAccountDivergences[0].detail).toContain('bucket-policy-write-accounts:s3-bucket-policy:apiable-logs-bucket-tokens')
    expect(writeAccountDivergences[0].channels).toEqual(['terraform'])
    // No within-channel identity collision: distinct declared ids keep the two buckets distinct (the
    // cleared F1-S3 same-id collision stays closed under the declared-id engine).
    for (const model of [cdk, cfn, terraform]) expect(model.identityCollisions ?? []).toEqual([])
  })
})
