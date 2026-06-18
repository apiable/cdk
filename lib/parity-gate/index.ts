/**
 * The release-time CDK ↔ CFN ↔ Terraform parity gate. Reduces each distribution channel's
 * artifact to one comparable resource model and diffs them on three tiers (resource graph,
 * load-bearing values, permission semantics), plus secret-wiring and OAuth2/OIDC conformance.
 *
 * The surface here is pure — parsed object in, model/result out — so the gate logic is testable
 * with no cloud account. The I/O that loads a published template or a `terraform show -json`
 * file lives in the gate harness that drives this in CI.
 */
export { ACCOUNT_TOKEN, REGION_TOKEN, normaliseLogical } from './model'
export type {
  Channel,
  ChannelModel,
  Divergence,
  DivergenceTier,
  GateResult,
  LoadBearingValues,
  OAuthConfig,
  OidcDiscovery,
  PermissionGrant,
  ResourceEdge,
  ResourceGraph,
  ResourceNode,
  SecretRef,
} from './model'
export { reduceCloudFormation } from './cfn-reducer'
export { reduceTerraformShowJson } from './terraform-reducer'
export { compareGraph } from './compare'
export { checkOAuthConformance } from './oauth-conformance'
export type { ConformanceIssue } from './oauth-conformance'
export { formatGateReport, gate } from './gate'
