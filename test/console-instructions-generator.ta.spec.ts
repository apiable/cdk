/**
 * Supplementary coverage for story 013-1-36 beyond the frozen contract scenarios: the generator's
 * defensive boundaries the S1–S10 scenarios do not individually exercise — a template shaped wrong
 * (zero or multiple role/policy resources, not a record at all), the `isPublishedVersion` registry
 * check in isolation from the generator's error path, a malformed `Fn::Join`, a missing trust-account
 * parameter default, and generic scalar passthrough. Every case drives the real generator, never a
 * re-declaration of its resolution logic.
 */
import { generateConsoleInstructions, isPublishedVersion } from '@apiable/cdk-gateway-role'

const REGION = 'eu-central-1'
const VALID_TRUST_STATEMENT = {
  Effect: 'Allow',
  Action: 'sts:AssumeRole',
  Principal: { AWS: 'arn:aws:iam::034444869755:root' },
}
const validTrustDocument = { Version: '2012-10-17', Statement: [VALID_TRUST_STATEMENT] }
const validPolicyResource = { Type: 'AWS::IAM::Policy', Properties: { PolicyDocument: { Version: '2012-10-17', Statement: [] } } }
const validRoleResource = (roleNameOrIntrinsic: unknown = 'apiable-gateway-management-role-eu-central-1'): unknown => ({
  Type: 'AWS::IAM::Role',
  Properties: { RoleName: roleNameOrIntrinsic, AssumeRolePolicyDocument: validTrustDocument },
})
const parameters = { ApiableTrustAccount: { Type: 'String', Default: '034444869755' } }

describe('console-instructions generator (TA) — registry check in isolation', () => {
  it('accepts the current version and every historical published version', () => {
    expect(isPublishedVersion('2.0.0', '2.0.0')).toBe(true)
    expect(isPublishedVersion('1.0.0', '2.0.0')).toBe(true)
  })

  it('rejects a version that is neither current nor historical', () => {
    expect(isPublishedVersion('3.0.0', '2.0.0')).toBe(false)
    expect(isPublishedVersion('', '2.0.0')).toBe(false)
  })
})

describe('console-instructions generator (TA) — malformed-artifact boundaries', () => {
  it('throws when the artifact is not a record at all (a string, an array, null)', () => {
    for (const notARecord of ['not a template', ['also', 'not', 'a', 'template'], null, 42]) {
      expect(() => generateConsoleInstructions(notARecord, '2.0.0', '2.0.0', REGION)).toThrow(/not a well-formed CloudFormation template/)
    }
  })

  it('throws when the artifact declares zero AWS::IAM::Role resources', () => {
    const noRole = { Parameters: parameters, Resources: { Policy: validPolicyResource } }
    expect(() => generateConsoleInstructions(noRole, '2.0.0', '2.0.0', REGION)).toThrow(/expected exactly one AWS::IAM::Role resource in the artifact, found 0/)
  })

  it('throws when the artifact declares MORE THAN ONE AWS::IAM::Role resource', () => {
    const twoRoles = { Parameters: parameters, Resources: { RoleA: validRoleResource(), RoleB: validRoleResource(), Policy: validPolicyResource } }
    expect(() => generateConsoleInstructions(twoRoles, '2.0.0', '2.0.0', REGION)).toThrow(/expected exactly one AWS::IAM::Role resource in the artifact, found 2/)
  })

  it('throws when the artifact declares zero AWS::IAM::Policy resources', () => {
    const noPolicy = { Parameters: parameters, Resources: { Role: validRoleResource() } }
    expect(() => generateConsoleInstructions(noPolicy, '2.0.0', '2.0.0', REGION)).toThrow(/expected exactly one AWS::IAM::Policy resource in the artifact, found 0/)
  })

  it('throws when the artifact declares no ApiableTrustAccount parameter default at all', () => {
    const noTrustParameter = { Parameters: {}, Resources: { Role: validRoleResource(), Policy: validPolicyResource } }
    expect(() => generateConsoleInstructions(noTrustParameter, '2.0.0', '2.0.0', REGION)).toThrow(/declares no ApiableTrustAccount parameter default/)
  })

  it('throws on a malformed Fn::Join (wrong arity, not a two-element array)', () => {
    const malformedJoin = {
      Parameters: parameters,
      Resources: { Role: validRoleResource({ 'Fn::Join': ['-'] }), Policy: validPolicyResource },
    }
    expect(() => generateConsoleInstructions(malformedJoin, '2.0.0', '2.0.0', REGION)).toThrow(/malformed Fn::Join/)
  })

  it('throws on an intrinsic-shaped object carrying an extra sibling key — not a shape CloudFormation itself ever emits', () => {
    const malformedShape = {
      Parameters: parameters,
      // A real Ref is always alone in its object; this shape would otherwise fall through the
      // "not an intrinsic, treat as plain data" branch and silently keep a literal "Ref" key.
      Resources: { Role: validRoleResource({ Ref: 'AWS::Region', Extra: 'sneaked-in' }), Policy: validPolicyResource },
    }
    expect(() => generateConsoleInstructions(malformedShape, '2.0.0', '2.0.0', REGION)).toThrow(/malformed intrinsic shape/)
  })
})

describe('console-instructions generator (TA) — generic scalar passthrough', () => {
  it('resolves a plain string RoleName with no intrinsic wrapper at all', () => {
    const plainRoleName = { Parameters: parameters, Resources: { Role: validRoleResource('a-plain-literal-role-name'), Policy: validPolicyResource } }
    expect(generateConsoleInstructions(plainRoleName, '2.0.0', '2.0.0', REGION).roleName).toBe('a-plain-literal-role-name')
  })

  it('resolves a nested Fn::Join whose parts are themselves Ref intrinsics, not only string literals', () => {
    const nestedJoin = {
      Parameters: { ...parameters, Suffix: { Type: 'String', Default: 'prod' } },
      Resources: {
        Role: validRoleResource({ 'Fn::Join': ['-', ['apiable-gateway-management-role', { Ref: 'AWS::Region' }, { Ref: 'Suffix' }]] }),
        Policy: validPolicyResource,
      },
    }
    expect(generateConsoleInstructions(nestedJoin, '2.0.0', '2.0.0', REGION).roleName).toBe(`apiable-gateway-management-role-${REGION}-prod`)
  })
})
