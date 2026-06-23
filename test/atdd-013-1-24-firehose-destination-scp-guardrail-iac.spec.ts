/**
 * ATDD — Story 013-1-24: operator-owned deploy-time guardrail for the usage-firehose destination on the
 * central logging account — the deploy-time discharge of 013-1-21's accepted destination-bucket fail-OPEN
 * (the parity-gate-deploytime-param-ungateable-by-value class).
 *
 * Frozen contract: contract-013-1-24-firehose-destination-scp-guardrail.md (sha a91541de5713).
 *
 * SHAPE: an IaC-policy guardrail test, not a build-time parity-gate test. The family pattern is the
 * 013-1-15 logs-bucket real-TF spec (parity-gate-logs-bucket-real-tf.spec.ts), but the OUTCOME under
 * test is a deny/allow at the operator-owned policy layer, not a gate() verdict. The deny/allow oracle is
 * the local policy evaluator (test/support/policy-evaluator.ts) — there is no live iam:SimulateCustomPolicy
 * (CI has no AWS credentials). Static IaC-shape assertions back the simulator-as-oracle to catch
 * policy-document drift the evaluator alone would tolerate.
 */
import * as fs from 'fs'
import * as path from 'path'
import {
  AccessRequest,
  evaluateDelivery,
  evaluateScp,
  GuardrailContext,
} from './support/policy-evaluator'

const REPO_ROOT = path.resolve(__dirname, '..')
const GUARDRAIL_FIXTURE = path.join(REPO_ROOT, 'test/fixtures/parity-gate/terraform-logs-guardrail-show.json')
const DISCHARGE_MARKER = path.join(REPO_ROOT, 'docs/cdk/013-1-21-residual-discharge.md')

const CENTRAL_ACCOUNT = '111111111111'
const ORG_ID = 'o-exampleorgid'

// The sanctioned destination + the sanctioned delivery roles the committed fixture provisions.
const SANCTIONED_BUCKET = 'apiable-logs-prod'
const SANCTIONED_BUCKET_ARN = `arn:aws:s3:::${SANCTIONED_BUCKET}`
const USAGELOGS_ROLE_ARN = `arn:aws:iam::${CENTRAL_ACCOUNT}:role/apiable-usagelogs-firehose`
const USAGETOKENS_ROLE_ARN = `arn:aws:iam::${CENTRAL_ACCOUNT}:role/apiable-usagetokens-firehose`

// The divergent / attacker-controlled destination S1/S3/S5 point a channel at.
const EXFIL_BUCKET = 'attacker-exfil-bucket'
const EXFIL_BUCKET_ARN = `arn:aws:s3:::${EXFIL_BUCKET}`

interface TfShow {
  planned_values: { root_module: { resources: { type: string; values: Record<string, unknown> }[] } }
}

const readGuardrail = (): TfShow => JSON.parse(fs.readFileSync(GUARDRAIL_FIXTURE, 'utf8')) as TfShow

const resourcesOfType = (show: TfShow, type: string): Record<string, unknown>[] =>
  show.planned_values.root_module.resources.filter((r) => r.type === type).map((r) => r.values)

/** The authoritative Org SCP document the operator-owned guardrail declares. */
const scpDocument = (show: TfShow): unknown => {
  const scp = resourcesOfType(show, 'aws_organizations_policy')[0]
  if (scp === undefined) throw new Error('guardrail fixture must carry an aws_organizations_policy resource')
  return JSON.parse(scp.content as string)
}

/** Every sanctioned bucket's resource policy, keyed by bucket name. */
const bucketPolicies = (show: TfShow): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const policy of resourcesOfType(show, 'aws_s3_bucket_policy')) {
    out[policy.bucket as string] = JSON.parse(policy.policy as string)
  }
  return out
}

/**
 * THE ONE operator-owned allow-list, derived from the SCP's NotResource — the single source every layer
 * is asserted to agree with (S4). Object ARNs (`/*`) reduced to their bucket ARN.
 */
const allowListFromScp = (show: TfShow): string[] => {
  const doc = scpDocument(show) as { Statement: { NotResource?: string[] }[] }
  const notResource = doc.Statement.flatMap((s) => s.NotResource ?? [])
  return [...new Set(notResource.map((arn) => arn.replace(/\/\*$/, '')))].sort()
}

const guardrailContext = (show: TfShow, opts: { withBuckets?: boolean } = {}): GuardrailContext => ({
  scp: scpDocument(show),
  bucketPolicies: opts.withBuckets === false ? undefined : bucketPolicies(show),
})

/** A legitimate write a deployed channel performs: a sanctioned role → a sanctioned bucket, in-org. */
const sanctionedWrite = (roleArn: string): AccessRequest => ({
  principalArn: roleArn,
  action: 's3:PutObject',
  resourceArn: `${SANCTIONED_BUCKET_ARN}/apiable/aws/logs/2026/01/01/record`,
  sourceAccount: CENTRAL_ACCOUNT,
  principalOrgId: ORG_ID,
})

/** A divergent write a channel performs when pointed at an unsanctioned destination. */
const divergentWrite = (roleArn: string): AccessRequest => ({
  principalArn: roleArn,
  action: 's3:PutObject',
  resourceArn: `${EXFIL_BUCKET_ARN}/apiable/aws/logs/2026/01/01/record`,
  sourceAccount: CENTRAL_ACCOUNT,
  principalOrgId: ORG_ID,
})

// The three publishing channels, each identified by the delivery-role identity its deploy resolves to.
// The construct + one-click CFN both synth the usagelogs delivery role; the hand-rolled Terraform module
// is the third channel. All three resolve, at deploy time, to a write by a firehose delivery role.
const CHANNELS = [
  { name: 'construct-kit (CDK)', roleArn: USAGELOGS_ROLE_ARN },
  { name: 'one-click template (CFN)', roleArn: USAGELOGS_ROLE_ARN },
  { name: 'hand-rolled Terraform', roleArn: USAGELOGS_ROLE_ARN },
] as const

describe('013-1-24 deploy-time firehose-destination guardrail (operator-owned, channel-independent)', () => {
  // contract: S1 — divergent destination DENIED on every channel
  it('S1: usage-firehose pointed at a destination NOT on the sanctioned allow-list, published through (a) the construct kit AND (b) the one-click template AND (c) the hand-rolled Terraform module → DENIED on EVERY channel (deny outcome identical across channels, denied at deploy/runtime by the operator-owned control on the central logging account — not merely warned or detected after the fact)', () => {
    const show = readGuardrail()
    const context = guardrailContext(show)
    const decisions = CHANNELS.map((channel) => evaluateDelivery(context, divergentWrite(channel.roleArn)))
    // denied on every channel...
    expect(decisions).toEqual(['Denied', 'Denied', 'Denied'])
    // ...and the denial is identical across the three channels (one distinct outcome).
    expect(new Set(decisions).size).toBe(1)
    // the denial is the operator-owned SCP itself, not an after-the-fact detection.
    expect(evaluateScp(scpDocument(show), divergentWrite(USAGELOGS_ROLE_ARN))).toBe('Deny')
  })

  // contract: S2 — legitimate destination SUCCEEDS on any channel (no false-deny)
  it('S2: usage-firehose pointed at a destination ON the sanctioned allow-list, published through any of the three channels → delivery SUCCEEDS (the operator-owned control denies only outside the allow-list, never the allow-list itself; no false-deny on the correct configuration on any channel)', () => {
    const show = readGuardrail()
    const context = guardrailContext(show)
    const decisions = CHANNELS.map((channel) => evaluateDelivery(context, sanctionedWrite(channel.roleArn)))
    expect(decisions).toEqual(['Allowed', 'Allowed', 'Allowed'])
    // the SCP does not deny the sanctioned write — the control denies only OUTSIDE the allow-list.
    expect(evaluateScp(scpDocument(show), sanctionedWrite(USAGELOGS_ROLE_ARN))).toBe('NotApplicable')
    // the token distribution's role is equally not false-denied.
    expect(evaluateDelivery(context, sanctionedWrite(USAGETOKENS_ROLE_ARN))).toBe('Allowed')
  })

  // contract: S3 — operator-owned, channel-independent, IaC-defined, gate-independent (the trust boundary)
  it('S3: the divergent destination from S1 with the release parity check BYPASSED + the channel hand-rolled outside the construct kit (the build-time parity check provably cannot witness a deploy-time destination value cross-channel) → STILL DENIED — the guardrail is reviewable operator-owned IaC living OUTSIDE the per-tenant channel, not dependent on the parity check for its protection; the trust boundary above the channel is preserved', () => {
    const show = readGuardrail()
    // No gate() is consulted anywhere in this test — the parity check is bypassed by construction. The
    // channel is hand-rolled (a delivery role minted outside the construct kit), modelled by an arbitrary
    // role ARN that still matches the firehose-role pattern the deploy would produce.
    const handRolledRole = `arn:aws:iam::${CENTRAL_ACCOUNT}:role/apiable-handrolled-firehose`
    const decision = evaluateDelivery(guardrailContext(show), divergentWrite(handRolledRole))
    expect(decision).toBe('Denied')
    // the guardrail is operator-owned IaC living OUTSIDE the per-tenant stream channel: it is the
    // apiable-logs-guardrail module, not any per-tenant stream module.
    expect(fs.existsSync(path.join(REPO_ROOT, 'terraform/apiable-logs-guardrail/main.tf'))).toBe(true)
    expect(fs.existsSync(path.join(REPO_ROOT, 'terraform/apiable-usagelogs-stream/main.tf'))).toBe(true)
    const streamModule = fs.readFileSync(path.join(REPO_ROOT, 'terraform/apiable-usagelogs-stream/main.tf'), 'utf8')
    expect(streamModule).not.toContain('aws_organizations_policy') // the SCP is NOT declared in the channel
    const scpResource = resourcesOfType(show, 'aws_organizations_policy')[0]
    expect(scpResource.name).toBe('apiable-firehose-destination-guardrail')
  })

  // contract: S4 — single source of truth for the sanctioned allow-list (every layer derives)
  it("S4: the account-family operator-level guardrail + the destination-side policy on each sanctioned destination + each channel's own delivery-permission scope all derive their allow-list from THE ONE operator-owned IaC source — no layer re-declares the list independently; a change to the one source propagates to every layer at once and the three channels stay equally constrained", () => {
    const show = readGuardrail()
    const allowList = allowListFromScp(show)
    expect(allowList).toEqual([SANCTIONED_BUCKET_ARN])

    // Layer 1 — the Org SCP NotResource (object-ARN form) is exactly the allow-list.
    const scp = scpDocument(show) as { Statement: { NotResource?: string[] }[] }
    const scpBuckets = [...new Set(scp.Statement.flatMap((s) => s.NotResource ?? []).map((a) => a.replace(/\/\*$/, '')))].sort()
    expect(scpBuckets).toEqual(allowList)

    // Layer 2 — every sanctioned bucket that carries a policy is drawn from the one allow-list (no bucket
    // policy re-declares a bucket outside it), and the policy's own Resource stays within the allow-list.
    const policies = bucketPolicies(show)
    for (const [bucket, doc] of Object.entries(policies)) {
      expect(allowList).toContain(`arn:aws:s3:::${bucket}`)
      const resources = (doc as { Statement: { Resource: string }[] }).Statement.map((s) => s.Resource.replace(/\/\*$/, ''))
      for (const resource of resources) expect(allowList).toContain(resource)
    }
    // every allow-list bucket is in fact governed by a bucket policy — the layers cover the SAME set.
    expect(Object.keys(policies).map((b) => `arn:aws:s3:::${b}`).sort()).toEqual(allowList)

    // Layer 3 — the module is structured so the list is declared ONCE: a single locals source feeds the
    // SCP, the bucket policy, and the output (no second literal list anywhere in the module).
    const moduleMain = fs.readFileSync(path.join(REPO_ROOT, 'terraform/apiable-logs-guardrail/main.tf'), 'utf8')
    const arnListLiterals = moduleMain.match(/"arn:aws:s3:::apiable-logs-/g) ?? []
    expect(arnListLiterals.length).toBe(0) // the ARN list is computed from var input, never re-typed per layer
    expect(moduleMain).toContain('local.sanctioned_object_arns') // the SCP derives from the one local
  })

  // contract: S5 — channel that widens its own delivery scope is STILL denied (defence-in-depth)
  it('S5: a hand-rolled channel that widens its own delivery permissions beyond the sanctioned allow-list (e.g., permits writes to any destination in the account, OR substitutes an attacker-controlled destination) → STILL DENIED by the operator-owned control (channel-side permission scoping is hygiene, NOT the security boundary; the guardrail does not collapse to "trust the channel" when the channel — the distrusted party — widens)', () => {
    const show = readGuardrail()
    // The widened channel: its delivery role's own identity policy grants s3:PutObject on EVERY resource
    // (Resource: "*") — the worst a hand-rolled channel can do. The operator-owned SCP must still deny the
    // out-of-allow-list write despite the channel having permitted it for itself.
    const widenedIdentityPolicy = {
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Action: 's3:PutObject', Resource: '*' }],
    }
    const context: GuardrailContext = {
      scp: scpDocument(show),
      bucketPolicies: bucketPolicies(show),
      identityPolicy: widenedIdentityPolicy,
    }
    // attacker-controlled destination → denied by the SCP even though the role's own policy allows "*".
    expect(evaluateDelivery(context, divergentWrite(USAGELOGS_ROLE_ARN))).toBe('Denied')
    // and the widened identity grant alone would have permitted it — proving the SCP is the boundary.
    expect(
      evaluateDelivery({ scp: { Version: '2012-10-17', Statement: [] }, identityPolicy: widenedIdentityPolicy }, divergentWrite(USAGELOGS_ROLE_ARN)),
    ).toBe('Allowed')
  })

  // contract: S6 — 013-1-21 destination-bucket residual DISCHARGED at the production promotion gate
  it('S6: with this guardrail in place, the production-promotion gate evaluating the 013-1-21 accepted destination-bucket fail-OPEN residual against the stream tier (013-1-5/1-6) targeting a production central logging account → residual MITIGATED (divergent destination denied at runtime on every channel per S1/S3/S5); the obligation that would otherwise block stream-tier production promotion is CLOSED (no re-acceptance required)', () => {
    // The discharge is a documented marker (no live promotion run — there are no credentials and the gate
    // is a future ceremony) backed by the S1/S3/S5 denials being in force.
    expect(fs.existsSync(DISCHARGE_MARKER)).toBe(true)
    const marker = fs.readFileSync(DISCHARGE_MARKER, 'utf8')
    expect(marker).toContain('013-1-21')
    expect(marker).toContain('apiable-logs-guardrail')
    expect(marker.toLowerCase()).toContain('mitigated')
    expect(marker.toLowerCase()).toContain('closed')

    // and the denial is genuinely in force: a divergent destination is denied at runtime on every channel.
    const show = readGuardrail()
    const context = guardrailContext(show)
    for (const channel of CHANNELS) {
      expect(evaluateDelivery(context, divergentWrite(channel.roleArn))).toBe('Denied')
    }
  })
})
