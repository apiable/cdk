/**
 * Logical-identifier-normalised CloudFormation equivalence for the umbrella strangler refactor.
 *
 * The refactor deliberately re-parents resources under kit constructs, which renames their CFN
 * logical ids while their real (physical) names are held constant. So "no observable change" is
 * proven by resource property + published-export equivalence with logical-id renames tolerated — a
 * raw whole-template comparison is the wrong oracle because it false-fails on the rename.
 *
 * A cross-resource reference is normalised by *what it points at* — the target resource's shape, not
 * its renameable logical id — so a consistent rename is tolerated while a reference re-pointed at a
 * different resource (a policy re-attached to another role, a stream re-wired to another bucket) reads
 * as drift. By-value identity (a trusted account, an ARN, a principal) is compared as the literal it
 * is, so an IAM trust/principal re-target is a property change the whole-shape comparison reports.
 *
 * A reference carries a fixed-width *surrogate* of its target's resolved shape (a content hash),
 * memoised per logical id, rather than the target's whole canonical subtree inlined by value. Inlining
 * grows the referrer's token by the target's full size at every reference and re-escapes it at each
 * level, so a deep chain or a wide fan-out lattice balloons the token super-linearly; the surrogate
 * keeps every reference O(1) and the per-id memo keeps each resource resolved once, so the whole walk
 * is proportional to the template's size. The surrogate still encodes the target's full shape (so a
 * re-target to a differently-shaped resource changes it and reads as drift) and a consistent rename
 * leaves the resolved shape — and thus the surrogate — unchanged.
 */
type CfnResource = {
    Type: string;
    Properties?: unknown;
    [k: string]: unknown;
};
type CfnOutput = {
    Value?: unknown;
    Export?: {
        Name?: unknown;
    };
    Condition?: unknown;
    [k: string]: unknown;
};
type CfnTemplate = {
    Resources?: Record<string, CfnResource>;
    Outputs?: Record<string, CfnOutput>;
    Parameters?: Record<string, unknown>;
};
/** A resource compared by what a customer can observe: its type and its resolved properties. */
export interface ResourceShape {
    readonly type: string;
    readonly properties: unknown;
}
/**
 * A published cross-stack value other stacks import: its export name, its value, and the Output-level
 * `Condition` that gates whether the export exists at all in a given environment.
 */
export interface PublishedExport {
    readonly name: unknown;
    readonly value: unknown;
    readonly condition?: unknown;
}
/** One observable difference between a baseline template and a candidate template. */
export interface CfnDifference {
    readonly kind: 'resource-removed' | 'resource-added' | 'export-changed' | 'export-removed' | 'export-added';
    readonly detail: string;
}
/**
 * The multiset of resource shapes, keyed by type + reference-normalised properties + load-bearing
 * top-level attributes, so that a rename of a resource's logical id (and of any reference to it) does
 * not register as a change, while a reference re-pointed at a different resource does (its target-shape
 * token changes). The shape is built by the resolver's `shapeOf` — the same helper the referent token
 * uses — so a re-target between two resources differing only in a top-level attribute is caught
 * symmetrically whether the resource is compared as an owner or reached through a reference.
 */
export declare const resourceShapes: (template: CfnTemplate) => Map<string, number>;
/**
 * Published exports keyed by export name — the contract dependent stacks import via `Fn::ImportValue`.
 * The key is the export name (a string name as-is; an intrinsic name — `Fn::Sub`/`Fn::Join` — canonicalised
 * through the resolver so its embedded references normalise and a logical-id rename is tolerated, rather
 * than the export being skipped). The value carries both the normalised `Value` and the Output-level
 * `Condition` (by value), so an export that gains or changes a `Condition` — which can make it silently
 * disappear in some environments and break a dependent stack's `Fn::ImportValue` — registers as drift.
 */
export declare const publishedExports: (template: CfnTemplate) => Map<string, string>;
/**
 * Observable differences between a baseline and a candidate template: resources whose type+properties
 * are not matched in both directions, and published exports that are renamed, dropped, or re-valued.
 * Logical-id-only renames produce no difference. An empty result means equivalent.
 */
export declare const cfnDifferences: (baseline: CfnTemplate, candidate: CfnTemplate) => CfnDifference[];
/** True when the candidate is observably equivalent to the baseline (logical-id renames tolerated). */
export declare const isCfnEquivalent: (baseline: CfnTemplate, candidate: CfnTemplate) => boolean;
/**
 * Strangler-progression gate: a step that would observably change an existing stack does not ship.
 * Returns the candidate template unchanged when equivalent; throws with the differences otherwise.
 * The validation *methodology* (which sample stack, which tool) is Phase-A-owned; this is the gating
 * behaviour the methodology plugs into.
 */
export declare const assertNoStranglerDrift: <T extends CfnTemplate>(baseline: CfnTemplate, candidate: T) => T;
export {};
