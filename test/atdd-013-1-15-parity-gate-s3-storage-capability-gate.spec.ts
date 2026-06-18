/**
 * Acceptance specs — Story 013-1-15: harden the release-time parity check for the S3 logs-storage tier.
 * Frozen contract: contract-013-1-15-parity-gate-s3-storage-capability.md
 *
 * One un-skipped spec per contract scenario (S1–S7), each driving the real reducers + gate against
 * faithful multi-resource logs-bucket artifacts: a tenant-scoped bucket, the bucket-policy granting
 * the deploying account and the single bounded partner account, and the partner write-role. The CDK
 * and one-click channels are reduced from CloudFormation and the Terraform channel from
 * `terraform show -json`, so each property is proven across both reducers — never a shape compared
 * to itself. Every divergence fixture is forcing: it cannot go green while the bucket/policy nodes
 * carry channel-native type names, a tenant-suffixed identifier false-FAILs, or a widened
 * cross-account write principal compares equal by count.
 *
 * Shares canonical.ts + both reducers + compareGrants/normaliseLogical with sibling 013-1-14 (the
 * cognito grant & trust security core): its forcing fixtures are re-run alongside these (parity-gate.spec.ts).
 */
import { gate, reduceCloudFormation, reduceTerraformShowJson } from '@apiable/parity-gate'

const REGION = 'eu-central-1'
const TENANT = 'staging'
// The deploying (tenant) account — incidental, normalises to {account} in every channel.
const TENANT_ACCOUNT = '111111111111'
// The single intended cross-account writer — bounded, load-bearing, compared BY VALUE.
const PARTNER_ACCOUNT = '034444869755'

// ── CloudFormation channels (CDK construct + published one-click), built from the same template
//    helper so the two CFN-shaped channels share one source and only the parameterisation differs. ──

interface CfnBucketOptions {
  /** The bucket/role tenant segment. A concrete value, or `{ Ref: 'TenantName' }` for the one-click param form. */
  readonly tenant: string | { Ref: string }
  /** The bucket-policy write principals (the security-bearing cross-account write grant). */
  readonly policyPrincipals: unknown
}

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
        Properties: { BucketName: name },
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
          { address: 'aws_s3_bucket.this', type: 'aws_s3_bucket', values: { bucket: `apiable-logs-${options.tenant}` } },
          { address: 'aws_s3_bucket_policy.this', type: 'aws_s3_bucket_policy', values: { policy } },
          { address: 'aws_iam_role.this', type: 'aws_iam_role', values: { name: `apiable-logs-${options.tenant}-s3-role`, assume_role_policy: assumePolicy } },
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
    // (@ref:TenantName); the Terraform channel carries a concrete tenant value. Neither the bucket nor
    // the tenant-suffixed role node reads as a divergence purely because of the tenant segment.
    const { cdk, cfn, terraform } = equivalentChannels()
    const result = gate([cdk, cfn, terraform])
    expect(result.divergences.filter((entry) => entry.tier === 'graph')).toEqual([])
    // The bucket and the write-role carry one channel-stable node ref across all three channels.
    const bucketRefs = new Set([cdk, cfn, terraform].map((m) => m.graph.nodes.find((n) => n.kind === 's3-bucket')?.ref))
    expect(bucketRefs).toEqual(new Set(['s3-bucket:apiable-logs-{tenant}']))
    const roleRefs = new Set([cdk, cfn, terraform].map((m) => m.graph.nodes.find((n) => n.kind === 'iam-role')?.ref))
    expect(roleRefs).toEqual(new Set(['iam-role:apiable-logs-{tenant}-s3-role']))
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
    // vocabulary now in the canonical tables and both reducers.
    const cfnRole = (region: string, channel: 'cdk' | 'cfn'): unknown =>
      reduceCloudFormation(
        {
          Resources: {
            Role: {
              Type: 'AWS::IAM::Role',
              Properties: {
                RoleName: 'apiable-gateway-managment-role',
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
              { address: 'aws_iam_role.this', type: 'aws_iam_role', values: { name: 'apiable-gateway-managment-role', assume_role_policy: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: arnRoot(PARTNER_ACCOUNT) }, Action: 'sts:AssumeRole' }] }) } },
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
})
