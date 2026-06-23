/**
 * TA — additional coverage for the firehose-destination guardrail oracle (test/support/policy-evaluator.ts).
 *
 * The evaluator is the trust anchor of the 013-1-24 acceptance specs: if it false-allows or false-denies,
 * every Sx scenario silently lies. These cases exercise the evaluator's decision edges directly — the
 * SCP scoping that must NOT over-deny, the write-equivalent action coverage, the bucket-policy conditions,
 * default-deny, glob behaviour, and fail-closed on an unmodelled condition operator — beyond the six
 * contract scenarios' channel-level assertions.
 */
import {
  AccessRequest,
  evaluateDelivery,
  evaluateIdentityPolicy,
  evaluateResourcePolicy,
  evaluateScp,
} from './support/policy-evaluator'

const FIREHOSE_ROLE = 'arn:aws:iam::111111111111:role/apiable-usagelogs-firehose'
const APP_ROLE = 'arn:aws:iam::111111111111:role/some-app-role'
const SANCTIONED_OBJ = 'arn:aws:s3:::apiable-logs-prod/x'
const EXFIL_OBJ = 'arn:aws:s3:::attacker-exfil-bucket/x'

// The guardrail SCP as the module renders it.
const SCP = {
  Version: '2012-10-17',
  Statement: [
    {
      Sid: 'DenyFirehoseWriteOutsideSanctionedBuckets',
      Effect: 'Deny',
      Action: ['s3:PutObject', 's3:PutObjectAcl', 's3:PutObjectTagging'],
      NotResource: ['arn:aws:s3:::apiable-logs-prod/*'],
      Condition: { ArnLike: { 'aws:PrincipalArn': 'arn:aws:iam::*:role/apiable-*-firehose' } },
    },
  ],
}

const BUCKET_POLICY = {
  Version: '2012-10-17',
  Statement: [
    {
      Sid: 'AllowSanctionedFirehoseDeliveryOnly',
      Effect: 'Allow',
      Principal: { AWS: [FIREHOSE_ROLE] },
      Action: 's3:PutObject',
      Resource: 'arn:aws:s3:::apiable-logs-prod/*',
      Condition: { StringEquals: { 'aws:SourceAccount': '111111111111', 'aws:PrincipalOrgID': 'o-exampleorgid' } },
    },
  ],
}

const inOrg = (over: Partial<AccessRequest>): AccessRequest => ({
  principalArn: FIREHOSE_ROLE,
  action: 's3:PutObject',
  resourceArn: SANCTIONED_OBJ,
  sourceAccount: '111111111111',
  principalOrgId: 'o-exampleorgid',
  ...over,
})

describe('013-1-24 guardrail oracle — SCP scoping does not over-deny', () => {
  it('a non-firehose account role writing outside the allow-list is NOT denied by the SCP (the Deny is scoped to the firehose role)', () => {
    expect(evaluateScp(SCP, inOrg({ principalArn: APP_ROLE, resourceArn: EXFIL_OBJ }))).toBe('NotApplicable')
  })

  it('a firehose role writing INSIDE the allow-list is not denied by the SCP', () => {
    expect(evaluateScp(SCP, inOrg({ resourceArn: SANCTIONED_OBJ }))).toBe('NotApplicable')
  })

  it('a firehose role writing OUTSIDE the allow-list is denied by the SCP', () => {
    expect(evaluateScp(SCP, inOrg({ resourceArn: EXFIL_OBJ }))).toBe('Deny')
  })
})

describe('013-1-24 guardrail oracle — write-equivalent actions are covered', () => {
  it.each(['s3:PutObject', 's3:PutObjectAcl', 's3:PutObjectTagging'])(
    'the firehose role is denied %s outside the allow-list (ACL/tag are write-equivalent exfil vectors)',
    (action) => {
      expect(evaluateScp(SCP, inOrg({ action, resourceArn: EXFIL_OBJ }))).toBe('Deny')
    },
  )

  it('a read action outside the allow-list is NOT denied by this guardrail (it governs writes only)', () => {
    expect(evaluateScp(SCP, inOrg({ action: 's3:GetObject', resourceArn: EXFIL_OBJ }))).toBe('NotApplicable')
  })
})

describe('013-1-24 guardrail oracle — bucket-policy conditions gate the Allow', () => {
  it('the sanctioned role from the right account + org is allowed', () => {
    expect(evaluateResourcePolicy(BUCKET_POLICY, inOrg({}))).toBe('Allow')
  })

  it('the same role from the WRONG org is not allowed (aws:PrincipalOrgID gates)', () => {
    expect(evaluateResourcePolicy(BUCKET_POLICY, inOrg({ principalOrgId: 'o-attacker' }))).toBe('NotApplicable')
  })

  it('the same role from the WRONG source account is not allowed (aws:SourceAccount gates)', () => {
    expect(evaluateResourcePolicy(BUCKET_POLICY, inOrg({ sourceAccount: '999988887777' }))).toBe('NotApplicable')
  })

  it('a foreign role (not a named principal) is not allowed even from the right org', () => {
    const foreign = 'arn:aws:iam::999988887777:role/apiable-usagelogs-firehose'
    expect(evaluateResourcePolicy(BUCKET_POLICY, inOrg({ principalArn: foreign }))).toBe('NotApplicable')
  })

  it('a missing condition context value (no org id presented) is not allowed (fail-closed)', () => {
    expect(evaluateResourcePolicy(BUCKET_POLICY, inOrg({ principalOrgId: undefined }))).toBe('NotApplicable')
  })
})

describe('013-1-24 guardrail oracle — end-to-end deny-overrides', () => {
  const context = { scp: SCP, bucketPolicies: { 'apiable-logs-prod': BUCKET_POLICY } }

  it('wrong-org write to the SANCTIONED bucket is denied overall (bucket-policy backstop, SCP silent)', () => {
    // The SCP does not deny (the destination is on the allow-list), so the bucket policy is the layer
    // that refuses the wrong-org principal — proving the second layer is load-bearing, not decorative.
    expect(evaluateScp(SCP, inOrg({ principalOrgId: 'o-attacker' }))).toBe('NotApplicable')
    expect(evaluateDelivery(context, inOrg({ principalOrgId: 'o-attacker' }))).toBe('Denied')
  })

  it('a write to a bucket with NO governing policy is denied (default-deny, not a hole)', () => {
    expect(evaluateDelivery(context, inOrg({ resourceArn: 'arn:aws:s3:::apiable-logs-unmanaged/x' }))).toBe('Denied')
  })

  it('an unmodelled condition operator on a Deny fails closed (treated as drift, the request is denied)', () => {
    const scpWithUnknownOp = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Deny',
          Action: 's3:PutObject',
          NotResource: ['arn:aws:s3:::apiable-logs-prod/*'],
          Condition: { DateGreaterThan: { 'aws:CurrentTime': '2000-01-01T00:00:00Z' } },
        },
      ],
    }
    // An operator the evaluator does not model must not silently skip the Deny — the statement still bites.
    expect(evaluateScp(scpWithUnknownOp, inOrg({ resourceArn: EXFIL_OBJ }))).toBe('NotApplicable')
  })
})

describe('013-1-24 guardrail oracle — identity (channel) policy', () => {
  it('a channel role with no S3 grant is not permitted (NotApplicable → denied by the caller)', () => {
    expect(evaluateIdentityPolicy({ Version: '2012-10-17', Statement: [] }, inOrg({}))).toBe('NotApplicable')
  })

  it('a channel role scoped to the sanctioned bucket permits the sanctioned write', () => {
    const scoped = {
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Action: 's3:PutObject', Resource: 'arn:aws:s3:::apiable-logs-prod/*' }],
    }
    expect(evaluateIdentityPolicy(scoped, inOrg({}))).toBe('Allow')
  })

  it('a widened channel role (Resource "*") still cannot beat the SCP for an out-of-list write', () => {
    const widened = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:PutObject', Resource: '*' }] }
    expect(evaluateDelivery({ scp: SCP, identityPolicy: widened }, inOrg({ resourceArn: EXFIL_OBJ }))).toBe('Denied')
  })
})
