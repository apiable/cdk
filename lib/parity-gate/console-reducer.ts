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
import { ChannelModel } from './model'
import { reduceCloudFormation } from './cfn-reducer'
import { DECLARED_ID_TAG } from './canonical'
import { ConsoleInstructionSet } from '../gateway-role/console-instructions'
import { GATEWAY_ROLE_LOGICAL_ID } from '../gateway-role/gateway-role'

export const reduceConsoleInstructions = (instructions: ConsoleInstructionSet, region: string): ChannelModel => {
  const syntheticArtifact = {
    Resources: {
      Role: {
        Type: 'AWS::IAM::Role',
        Properties: {
          RoleName: instructions.roleName,
          Tags: [{ Key: DECLARED_ID_TAG, Value: GATEWAY_ROLE_LOGICAL_ID }],
          AssumeRolePolicyDocument: instructions.trustDocument,
        },
      },
      Policy: {
        Type: 'AWS::IAM::Policy',
        Properties: {
          PolicyName: 'console-instructions',
          Roles: [{ Ref: 'Role' }],
          PolicyDocument: instructions.permissionDocument,
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
