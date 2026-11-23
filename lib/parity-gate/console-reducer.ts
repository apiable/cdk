/**
 * Reduce a generated hand-build console instruction set to the parity gate's comparable model — the
 * FOURTH distribution channel, alongside the CDK construct, the published CloudFormation template,
 * and the Terraform module (see model.ts's `Channel`). The instruction set's trust and permission
 * documents are already fully resolved — console-instructions.ts derives them from the published
 * artifact through its OWN intrinsic resolver, independent of this reducer — so this function only
 * has to re-express them as the same minimal CloudFormation shape the construct itself declares (one
 * IAM role plus its attached policy) and hand that to `reduceCloudFormation`. Reusing it, rather than
 * hand-rolling this channel's node refs and grant refs, guarantees they land on IDENTICAL keys to the
 * cdk/cfn channels — both of which already share this same reducer over their own two artifacts — so
 * a hand-rolled keying here could never drift from cfn-reducer.ts's parent-anchoring independently.
 */
import { ACCOUNT_TOKEN, ChannelModel } from './model'
import { reduceCloudFormation } from './cfn-reducer'
import { DECLARED_ID_TAG, PRINCIPAL_ACCOUNT_VARIABLE } from './canonical'
import { ConsoleConstructName, ConsoleInstructionSet, ResolvedPolicyDocument, ResolvedStatement } from '../gateway-role/console-instructions'
import { GATEWAY_ROLE_LOGICAL_ID } from '../gateway-role/gateway-role'
import { COGNITO_POOL_ROLE_LOGICAL_ID } from '../cognito-pool-role/cognito-pool-role'

/** The declared identity of each construct's role, which its other channels tag the role with. */
const LOGICAL_ID_BY_CONSTRUCT: Readonly<Record<ConsoleConstructName, string>> = {
  'apiable-gateway-role': GATEWAY_ROLE_LOGICAL_ID,
  'apiable-cognito-pool-role': COGNITO_POOL_ROLE_LOGICAL_ID,
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A user pool ARN whose account part is the policy variable; the pool ARN is the one place the set may use it. */
const POOL_ARN_NAMING_THE_PRINCIPAL_ACCOUNT = new RegExp(
  `^(arn:aws:cognito-idp:[^:]+:)${escapeRegExp(PRINCIPAL_ACCOUNT_VARIABLE)}(:userpool/[^:]+)$`,
)

/**
 * The set's permission document with the policy variable in a pool ARN's account part read as the account
 * the role is deployed in, which is what the other channels' `AWS::AccountId` reduces to. Anywhere else the
 * variable is left as it is written, so it diverges from the other channels' value.
 */
const withDeployingAccount = (document: ResolvedPolicyDocument): ResolvedPolicyDocument => {
  const read = (resource: unknown): unknown =>
    typeof resource === 'string' ? resource.replace(POOL_ARN_NAMING_THE_PRINCIPAL_ACCOUNT, `$1${ACCOUNT_TOKEN}$2`) : resource
  return {
    ...document,
    Statement: document.Statement.map((statement) =>
      statement.Resource === undefined
        ? statement
        : { ...statement, Resource: (Array.isArray(statement.Resource) ? statement.Resource.map(read) : read(statement.Resource)) as ResolvedStatement['Resource'] },
    ),
  }
}

export const reduceConsoleInstructions = (instructions: ConsoleInstructionSet, region: string): ChannelModel => {
  const syntheticArtifact = {
    Resources: {
      Role: {
        Type: 'AWS::IAM::Role',
        Properties: {
          RoleName: instructions.roleName,
          Tags: [{ Key: DECLARED_ID_TAG, Value: LOGICAL_ID_BY_CONSTRUCT[instructions.construct] }],
          AssumeRolePolicyDocument: instructions.trustDocument,
        },
      },
      Policy: {
        Type: 'AWS::IAM::Policy',
        Properties: {
          PolicyName: 'console-instructions',
          Roles: [{ Ref: 'Role' }],
          PolicyDocument: withDeployingAccount(instructions.permissionDocument),
        },
      },
    },
    // The other three channels each publish the role's ARN as a stack Output, which the graph tier
    // compares as a `resource ... exports:arn` node/edge (present/absent, not by value) — a hand-built
    // role's ARN is equally derivable (`arn:aws:iam::<account>:role/<roleName>`), so this channel
    // carries the SAME structural node rather than reading as a spurious "console never exports the
    // ARN" divergence against three channels that all happen to.
    Outputs: {
      RoleArn: { Value: { 'Fn::GetAtt': ['Role', 'Arn'] } },
    },
  }
  return reduceCloudFormation(syntheticArtifact, 'console', region)
}
