/**
 * Reduce `terraform show -json` output to the comparable parity model. Scalars and grants come
 * from `planned_values` (the known, resolved values); graph edges come from `configuration`
 * (the reference expressions), because a plan leaves computed attributes such as a role id or
 * ARN unknown — so the dependency between the policy and the role is read from the references,
 * not from a value that is not yet known at plan time.
 *
 * The legacy single-ARN `pre_token_generation` attribute carries no version field, so it reduces
 * to the legacy token-customisation version (`V1_0`). That is the decisive parity row: a channel
 * on the legacy attribute reads as `V1_0` while a channel on `pre_token_generation_config` reads
 * as its declared version, so the value tier catches a divergence a presence check would miss.
 */
import { Channel, ChannelModel } from './model';
/**
 * Reduce parsed `terraform show -json` output into a {@link ChannelModel}. `deployAccount` is the
 * account a credentialed plan resolved `data.aws_caller_identity` into; supplied so the incidental
 * deploying account drops out of the bucket-policy by-value write-grant, matching the published CFN
 * channel where the deploying account is the digit-less `AWS::AccountId` token.
 */
export declare const reduceTerraformShowJson: (plan: unknown, channel?: Channel, region?: string, deployAccount?: string) => ChannelModel;
