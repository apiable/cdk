/**
 * Reduce a CloudFormation template to the comparable parity model. Drives two channels: the CDK
 * construct (`Template.fromStack(...).toJSON()`) and the published launch-stack template parsed
 * from YAML — both are CloudFormation, so they share this reducer.
 *
 * Intrinsics are resolved to logical references: pseudo-parameters and parameter Refs collapse to
 * account/region tokens, `Fn::GetAtt` and resource `Ref`s become graph edges. Anything that is
 * not load-bearing (a description, a runtime patch revision, a log-retention period) is routed to
 * cosmetics so it can only warn.
 */
import { Channel, ChannelModel } from './model';
/**
 * Reduce a parsed CloudFormation template into a {@link ChannelModel} for `channel`. `deployAccount`
 * is the concrete account a non-published synth resolved `AWS::AccountId` into; supplied so the
 * incidental deploying account drops out of the bucket-policy by-value write-grant exactly as the
 * published channel's `AWS::AccountId` pseudo-parameter (a token, no digits) already does.
 */
export declare const reduceCloudFormation: (template: unknown, channel: Channel, region?: string, deployAccount?: string) => ChannelModel;
