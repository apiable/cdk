/**
 * Reduce an IAM policy document to the gate's permission-grant model. Both channels feed the
 * same shape here: CloudFormation carries the document as a property tree (with intrinsics), and
 * Terraform carries it as a `jsonencode`d string that parses to the identical `{ Statement: [] }`
 * shape — so a single reducer keeps the two sides honest. The caller supplies a `resolve` that
 * turns a channel-native value (a CloudFormation intrinsic, or a concrete Terraform string) into
 * a comparable string; resources and principals are then normalised to logical references.
 */
import { PermissionGrant } from './model';
/**
 * Build the grants for one policy document. `kind` distinguishes a role's trust (assume-role)
 * policy from an attached permission policy so the grant carries a channel-stable ref.
 *
 * `canonicaliseResource` reconciles a resource ARN that names a resource declared in the same
 * artifact to that resource's channel-stable node ref. Without it a self-referential ARN compares a
 * CloudFormation `Fn::GetAtt` (a channel-local logical id) against a Terraform-resolved literal ARN
 * and false-diverges; with it both sides reduce to the one canonical node ref. It defaults to the
 * identity so a grant on an external/literal ARN (the gateway-role pilot's apigateway resource) is
 * left exactly as resolved.
 */
export declare const grantsFromPolicyDocument: (doc: unknown, resolve: (v: unknown) => string, region: string | undefined, kind: 'trust' | 'inline', canonicaliseResource?: (resource: string) => string) => PermissionGrant[];
/**
 * Every statement's principals across a policy document, channel-resolved but NOT logical-normalised,
 * so account literals survive for a by-value comparison. The resource-policy (bucket-policy) write
 * grant is read this way: who may write is load-bearing, the same way {@link trustedAccountsOf} reads
 * who may assume a role — the by-value account set, not the account-tokenised grant principal.
 */
export declare const resolvedPrincipalsOf: (doc: unknown, resolve: (v: unknown) => string) => string[];
/**
 * The account(s) a role's trust policy is configured to trust — who may assume the role — captured
 * by value (account ids preserved, never tokenised). A trust target the channels disagree on is a
 * load-bearing divergence the gate must fail on; the grant {@link principalOf} above keeps the
 * principal logical so the incidental deploy account never false-fails, while this reads the one
 * value that is load-bearing. Reads the account from each account-bearing principal form — the
 * direct `AWS` account-root and an account named through a federated identity provider — so a
 * federated trust's account reaches the same by-value comparison the direct form does, never
 * blanked. Returns a stable comma-joined key, or undefined when no principal names an account (an
 * account-less service principal trusts none).
 */
export declare const trustedAccountsOf: (doc: unknown, resolve: (v: unknown) => string) => string | undefined;
