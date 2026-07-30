"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertNoStranglerDrift = exports.isCfnEquivalent = exports.cfnDifferences = exports.publishedExports = exports.resourceShapes = void 0;
const crypto_1 = require("crypto");
/** Deterministic serialization with recursively-sorted object keys, so key order never registers. */
const canonical = (value) => {
    const sort = (v) => {
        if (Array.isArray(v))
            return v.map(sort);
        if (v && typeof v === 'object') {
            return Object.fromEntries(Object.keys(v)
                .sort()
                .map((k) => [k, sort(v[k])]));
        }
        return v;
    };
    return JSON.stringify(sort(value));
};
/**
 * The load-bearing top-level resource attributes that carry observable behaviour (siblings of `Type`
 * and `Properties`) — a `DependsOn` re-target, a flip of `DeletionPolicy`/`UpdateReplacePolicy` on a
 * stateful resource, or a changed `Condition`/`CreationPolicy`/`UpdatePolicy` all change what the stack
 * does, so they enter the comparison shape. `DependsOn` is reference-normalised by its target's shape;
 * the rest are compared by value. `Metadata` is cosmetic (its `aws:cdk:path` changes on every rename)
 * and is excluded so the rename tolerance holds.
 */
const TOP_LEVEL_SHAPE_ATTRIBUTES = [
    'DependsOn',
    'Condition',
    'DeletionPolicy',
    'UpdateReplacePolicy',
    'CreationPolicy',
    'UpdatePolicy',
];
/**
 * Resolves a logical-id reference to a fixed-width surrogate of *what the reference points at* — a
 * content hash of the target resource's resolved shape (its type + recursively reference-normalised
 * properties AND its load-bearing top-level attributes), never its renameable logical-id identity. Two
 * references to differently-shaped targets get different surrogates, so a re-target (a policy
 * re-attached to another role, a stream re-wired to another bucket, a reference re-pointed from a
 * durable resource to a disposable near-twin) changes the referrer's canonical shape and registers as
 * drift; a consistent logical-id rename leaves the target's shape unchanged, so the surrogate is stable
 * and the rename is tolerated. The surrogate is memoised per logical id and is fixed-width, so a deep
 * chain or a wide lattice resolves in time and space proportional to the template's size.
 */
// Defence-in-depth ceiling on the live resolution-stack depth. The cache is pre-warmed in dependency
// order through an explicit work-stack (see `prewarmCache`), so a cross-resource reference is always a
// cache hit by the time the recursive resolve meets it and the live recursion only descends one
// resource's own property tree — never a chain of resources, in any insertion order. So nothing the
// gate processes approaches this depth; it caps a single resource's pathologically nested own
// properties at a stable depth-capped token rather than recursing until V8's call stack throws a raw
// `RangeError`. The value sits well below the native call-stack floor measured under a Jest worker
// thread (the smaller-stack runner), so the graceful token would fire first; it is a floor, not the
// hot path.
const RESOLUTION_DEPTH_CEILING = 800;
const targetTokenResolver = (resources) => {
    const logicalIds = new Set(Object.keys(resources));
    // Each logical id's fully-resolved surrogate, memoised so a resource is resolved once regardless of
    // how many references reach it or how deep the recursion is. A resolution that touched a cycle
    // back-edge OR the depth ceiling is context-dependent (its `ref-cycle`/`ref-depth-capped` anchor is
    // relative to the ancestors on the stack at the time), so it is NOT cached — only a context-free,
    // fully-resolved surrogate goes in, which keeps the memo sound under arbitrary reference order.
    const cache = new Map();
    // A reference carries this fixed-width surrogate of the target's resolved shape, not the shape itself,
    // so a reference costs O(1) bytes regardless of how large the target's subtree is. The hash encodes
    // the full resolved shape, so two differently-shaped targets get different surrogates (a re-target is
    // drift) while a consistent rename leaves the shape — and the surrogate — unchanged.
    const surrogate = (resolvedShapeToken) => `ref→#${(0, crypto_1.createHash)('sha256').update(resolvedShapeToken).digest('hex')}`;
    // Resolves a logical-id reference to its target's surrogate. `resolving` is the ancestor stack on the
    // current path; `context.tainted` records whether this subtree's resolution leaned on a back-edge or
    // the depth ceiling (an anchor relative to those ancestors), which gates whether the surrogate is
    // safe to memoise. A target already on the stack anchors on its type alone (`ref-cycle→<Type>`), which
    // terminates the recursion while keeping a cyclic target's shape distinct from an acyclic one.
    const shapeToken = (id, resolving, context) => {
        const cached = cache.get(id);
        if (cached !== undefined)
            return cached;
        const target = resources[id];
        if (!target)
            return 'ref→<unknown>';
        if (resolving.has(id)) {
            context.tainted = true;
            return `ref-cycle→${target.Type}`;
        }
        if (resolving.size >= RESOLUTION_DEPTH_CEILING) {
            context.tainted = true;
            return `ref-depth-capped→${target.Type}`;
        }
        const subtree = { tainted: false };
        const resolvedShape = canonical(shapeOf(target, new Set(resolving).add(id), subtree));
        const token = surrogate(resolvedShape);
        if (!subtree.tainted)
            cache.set(id, token);
        else
            context.tainted = true;
        return token;
    };
    // Pre-resolves every acyclic logical id's surrogate into the cache in dependency (post-order) order,
    // walking the reference graph with an EXPLICIT work-stack instead of native recursion so the resolved
    // depth is bounded by the heap, not V8's call stack. Once this completes, every cross-resource
    // reference `shapeToken` later meets is a cache hit, so the recursive resolve of any one resource only
    // descends that resource's own (shallow) property tree — never a chain of other resources. This is what
    // keeps an adversarially reverse-ordered deep chain O(nodes) rather than O(nodes × depth): without it,
    // resolving a reverse-ordered chain top-down recurses the full live depth before any descendant is
    // cached. A resource is pushed once (`seen`), then revisited after its referenced ids are on the stack;
    // on revisit, every referenced id is either cached or a cycle back-edge (still on the active `path`),
    // so its surrogate computes with all children resolved. A back-edge taints the in-flight resolution
    // exactly as the recursive path does, so a cycle member is NOT cached — preserving the memo invariant
    // that only a context-free, fully-resolved surrogate is memoised.
    const prewarmCache = () => {
        const referencedIds = (id) => {
            const found = new Set();
            const collect = (v) => {
                if (Array.isArray(v))
                    return v.forEach(collect);
                if (!v || typeof v !== 'object')
                    return;
                const obj = v;
                const keys = Object.keys(obj);
                if (keys.length === 1 && typeof obj.Ref === 'string' && logicalIds.has(obj.Ref))
                    found.add(obj.Ref);
                const getAtt = keys.length === 1 ? obj['Fn::GetAtt'] : undefined;
                if (Array.isArray(getAtt) && typeof getAtt[0] === 'string' && logicalIds.has(getAtt[0]))
                    found.add(getAtt[0]);
                else if (typeof getAtt === 'string') {
                    const head = getAtt.indexOf('.') >= 0 ? getAtt.slice(0, getAtt.indexOf('.')) : getAtt;
                    if (getAtt.indexOf('.') >= 0 && logicalIds.has(head))
                        found.add(head);
                }
                const sub = keys.length === 1 ? obj['Fn::Sub'] : undefined;
                const subString = typeof sub === 'string' ? sub : Array.isArray(sub) && typeof sub[0] === 'string' ? sub[0] : undefined;
                if (subString !== undefined) {
                    for (const [, inner] of subString.matchAll(/\$\{([^}]+)\}/g)) {
                        const trimmed = inner.trim();
                        const head = trimmed.indexOf('.') >= 0 ? trimmed.slice(0, trimmed.indexOf('.')) : trimmed;
                        if (logicalIds.has(head))
                            found.add(head);
                    }
                }
                for (const k of keys) {
                    if (k === 'PolicyName' && typeof obj[k] === 'string' && logicalIds.has(obj[k]))
                        found.add(obj[k]);
                    else if (k === 'DependsOn')
                        for (const d of Array.isArray(obj[k]) ? obj[k] : [obj[k]]) {
                            if (typeof d === 'string' && logicalIds.has(d))
                                found.add(d);
                            else
                                collect(d);
                        }
                    else
                        collect(obj[k]);
                }
            };
            const resource = resources[id];
            collect(resource.Properties ?? null);
            for (const attr of TOP_LEVEL_SHAPE_ATTRIBUTES) {
                if (resource[attr] === undefined)
                    continue;
                if (attr === 'DependsOn')
                    for (const d of Array.isArray(resource[attr]) ? resource[attr] : [resource[attr]]) {
                        if (typeof d === 'string' && logicalIds.has(d))
                            found.add(d);
                    }
            }
            return [...found];
        };
        const seen = new Set();
        for (const root of logicalIds) {
            if (cache.has(root) || seen.has(root))
                continue;
            const path = new Set();
            const stack = [{ id: root, expanded: false }];
            while (stack.length > 0) {
                const frame = stack[stack.length - 1];
                if (!frame.expanded) {
                    frame.expanded = true;
                    if (cache.has(frame.id)) {
                        stack.pop();
                        continue;
                    }
                    seen.add(frame.id);
                    path.add(frame.id);
                    for (const child of referencedIds(frame.id)) {
                        if (!cache.has(child) && !path.has(child))
                            stack.push({ id: child, expanded: false });
                    }
                }
                else {
                    stack.pop();
                    path.delete(frame.id);
                    // Children are resolved (cached) or cycle back-edges (still on `path`); resolving now descends
                    // only this resource's own property tree, with every cross-resource reference a cache hit.
                    if (!cache.has(frame.id))
                        shapeToken(frame.id, new Set(), { tainted: false });
                }
            }
        }
    };
    // The single source of truth for a resource's comparison shape — its type, its reference-normalised
    // properties, and each present load-bearing top-level attribute (`DependsOn` reference-normalised by
    // target shape; the rest by value; `Metadata` excluded). BOTH the referent token (`shapeToken`, with
    // the cycle-extended stack) and the owner shape (`resourceShapes`, with a fresh stack) build through
    // this, so the two paths can never drift apart: a reference re-pointed between two resources that
    // differ only in a top-level attribute now changes the referent token, just as it changes the owner.
    const shapeOf = (resource, resolving, context) => {
        const shape = {
            type: resource.Type,
            properties: normalise(resource.Properties ?? null, resolving, context),
        };
        for (const attr of TOP_LEVEL_SHAPE_ATTRIBUTES) {
            if (resource[attr] === undefined)
                continue;
            shape[attr] = attr === 'DependsOn' ? normaliseDependsOn(resource[attr], resolving, context) : resource[attr];
        }
        return shape;
    };
    // A `DependsOn` is a logical id or a list of them; each id-reference rewrites to its target-shape
    // token (a non-id entry normalises as ordinary data). Shared by the `normalise` walk (a `DependsOn`
    // nested inside a walked object) and `shapeOf` (the top-level `DependsOn`, the only valid CFN
    // placement), so the dependency-declaration reference form normalises identically in both paths.
    const normaliseDependsOn = (dep, resolving, context) => (Array.isArray(dep) ? dep : [dep]).map((d) => typeof d === 'string' && logicalIds.has(d) ? shapeToken(d, resolving, context) : normalise(d, resolving, context));
    /**
     * Rewrites every cross-resource logical-id reference to its target-shape token, across every form a
     * CloudFormation template can express one: `{Ref}`, array- and string-form `{Fn::GetAtt}`,
     * `Fn::Sub`-embedded `${LogicalId}` and `${LogicalId.Attr}`, `DependsOn`, and the CDK default-policy
     * `PolicyName` echo.
     */
    const normalise = (value, resolving, context) => {
        const walk = (v) => {
            if (Array.isArray(v))
                return v.map(walk);
            if (v && typeof v === 'object') {
                const obj = v;
                const keys = Object.keys(obj);
                if (keys.length === 1 && typeof obj.Ref === 'string' && logicalIds.has(obj.Ref)) {
                    return { Ref: shapeToken(obj.Ref, resolving, context) };
                }
                if (keys.length === 1 && obj['Fn::GetAtt'] !== undefined) {
                    const getAtt = obj['Fn::GetAtt'];
                    if (Array.isArray(getAtt)) {
                        const [target, ...rest] = getAtt;
                        if (typeof target === 'string' && logicalIds.has(target)) {
                            return { 'Fn::GetAtt': [shapeToken(target, resolving, context), ...rest.map(walk)] };
                        }
                    }
                    else if (typeof getAtt === 'string') {
                        const dot = getAtt.indexOf('.');
                        const target = dot >= 0 ? getAtt.slice(0, dot) : getAtt;
                        if (dot >= 0 && logicalIds.has(target)) {
                            return { 'Fn::GetAtt': `${shapeToken(target, resolving, context)}${getAtt.slice(dot)}` };
                        }
                    }
                }
                if (keys.length === 1 && obj['Fn::Sub'] !== undefined) {
                    return { 'Fn::Sub': normaliseSub(obj['Fn::Sub'], resolving, context) };
                }
                const out = {};
                for (const k of keys) {
                    if (k === 'PolicyName' && typeof obj[k] === 'string' && logicalIds.has(obj[k])) {
                        out[k] = shapeToken(obj[k], resolving, context);
                    }
                    else if (k === 'DependsOn') {
                        out[k] = normaliseDependsOn(obj[k], resolving, context);
                    }
                    else {
                        out[k] = walk(obj[k]);
                    }
                }
                return out;
            }
            return v;
        };
        return walk(value);
    };
    // `Fn::Sub` is either a string or `[template, { var: value }]`. An embedded `${LogicalId}` OR
    // `${LogicalId.Attr}` reference rewrites to the target-shape token (the head before the first `.` is
    // the logical id, the suffix the attribute, mirroring string-form `Fn::GetAtt`), so a consistent
    // rename of the target is tolerated while a re-target reads as drift. A `${!Literal}` escape (head
    // `!Literal`, never a logical id) and a non-resource `${Param}` are left untouched.
    const normaliseSub = (sub, resolving, context) => {
        const rewriteString = (s) => s.replace(/\$\{([^}]+)\}/g, (match, inner) => {
            const trimmed = inner.trim();
            const dot = trimmed.indexOf('.');
            const head = dot >= 0 ? trimmed.slice(0, dot) : trimmed;
            return logicalIds.has(head) ? `\${${shapeToken(head, resolving, context)}${dot >= 0 ? trimmed.slice(dot) : ''}}` : match;
        });
        if (typeof sub === 'string')
            return rewriteString(sub);
        if (Array.isArray(sub)) {
            const [template, vars, ...rest] = sub;
            const head = typeof template === 'string' ? rewriteString(template) : normalise(template, resolving, context);
            return [head, normalise(vars, resolving, context), ...rest.map((r) => normalise(r, resolving, context))];
        }
        return normalise(sub, resolving, context);
    };
    // Resolve every acyclic id's surrogate up front (heap-bounded work-stack) so the recursive resolves
    // the public helpers trigger only ever descend a single resource's own property tree.
    prewarmCache();
    return {
        // The public reference-normaliser (fresh resolution stack) — rewrites every cross-resource
        // reference in an arbitrary value to its target-shape surrogate. Used for export values. A
        // throwaway taint context: at the top level there is no enclosing resolution whose memoisation
        // a back-edge below could poison, so the flag is only consumed by the per-id memo inside.
        normalise: (value) => normalise(value, new Set(), { tainted: false }),
        // A resource's full comparison shape (fresh resolution stack), so the multiset key and the
        // referent surrogate are built by one helper and cannot diverge.
        shapeOf: (resource) => shapeOf(resource, new Set(), { tainted: false }),
    };
};
/**
 * The multiset of resource shapes, keyed by type + reference-normalised properties + load-bearing
 * top-level attributes, so that a rename of a resource's logical id (and of any reference to it) does
 * not register as a change, while a reference re-pointed at a different resource does (its target-shape
 * token changes). The shape is built by the resolver's `shapeOf` — the same helper the referent token
 * uses — so a re-target between two resources differing only in a top-level attribute is caught
 * symmetrically whether the resource is compared as an owner or reached through a reference.
 */
const resourceShapes = (template) => {
    const resources = template.Resources ?? {};
    const resolver = targetTokenResolver(resources);
    const counts = new Map();
    for (const resource of Object.values(resources)) {
        const key = canonical(resolver.shapeOf(resource));
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
};
exports.resourceShapes = resourceShapes;
/**
 * Published exports keyed by export name — the contract dependent stacks import via `Fn::ImportValue`.
 * The key is the export name (a string name as-is; an intrinsic name — `Fn::Sub`/`Fn::Join` — canonicalised
 * through the resolver so its embedded references normalise and a logical-id rename is tolerated, rather
 * than the export being skipped). The value carries both the normalised `Value` and the Output-level
 * `Condition` (by value), so an export that gains or changes a `Condition` — which can make it silently
 * disappear in some environments and break a dependent stack's `Fn::ImportValue` — registers as drift.
 */
const publishedExports = (template) => {
    const resolver = targetTokenResolver(template.Resources ?? {});
    const exports = new Map();
    for (const output of Object.values(template.Outputs ?? {})) {
        const exportName = output.Export?.Name;
        if (exportName === undefined)
            continue;
        const key = typeof exportName === 'string' ? exportName : canonical(resolver.normalise(exportName));
        exports.set(key, canonical({ value: resolver.normalise(output.Value), condition: output.Condition }));
    }
    return exports;
};
exports.publishedExports = publishedExports;
/**
 * Observable differences between a baseline and a candidate template: resources whose type+properties
 * are not matched in both directions, and published exports that are renamed, dropped, or re-valued.
 * Logical-id-only renames produce no difference. An empty result means equivalent.
 */
const cfnDifferences = (baseline, candidate) => {
    const differences = [];
    const baseResources = (0, exports.resourceShapes)(baseline);
    const candResources = (0, exports.resourceShapes)(candidate);
    for (const [key, count] of baseResources) {
        const candCount = candResources.get(key) ?? 0;
        if (candCount < count) {
            const { type } = JSON.parse(key);
            differences.push({ kind: 'resource-removed', detail: `${type} (×${count - candCount})` });
        }
    }
    for (const [key, count] of candResources) {
        const baseCount = baseResources.get(key) ?? 0;
        if (baseCount < count) {
            const { type } = JSON.parse(key);
            differences.push({ kind: 'resource-added', detail: `${type} (×${count - baseCount})` });
        }
    }
    const baseExports = (0, exports.publishedExports)(baseline);
    const candExports = (0, exports.publishedExports)(candidate);
    for (const [name, value] of baseExports) {
        if (!candExports.has(name))
            differences.push({ kind: 'export-removed', detail: name });
        else if (candExports.get(name) !== value)
            differences.push({ kind: 'export-changed', detail: name });
    }
    for (const name of candExports.keys()) {
        if (!baseExports.has(name))
            differences.push({ kind: 'export-added', detail: name });
    }
    return differences;
};
exports.cfnDifferences = cfnDifferences;
/** True when the candidate is observably equivalent to the baseline (logical-id renames tolerated). */
const isCfnEquivalent = (baseline, candidate) => (0, exports.cfnDifferences)(baseline, candidate).length === 0;
exports.isCfnEquivalent = isCfnEquivalent;
/**
 * Strangler-progression gate: a step that would observably change an existing stack does not ship.
 * Returns the candidate template unchanged when equivalent; throws with the differences otherwise.
 * The validation *methodology* (which sample stack, which tool) is Phase-A-owned; this is the gating
 * behaviour the methodology plugs into.
 */
const assertNoStranglerDrift = (baseline, candidate) => {
    const differences = (0, exports.cfnDifferences)(baseline, candidate);
    if (differences.length > 0) {
        const summary = differences.map((d) => `${d.kind}: ${d.detail}`).join('; ');
        throw new Error(`strangler step blocked — it would drift an existing stack: ${summary}`);
    }
    return candidate;
};
exports.assertNoStranglerDrift = assertNoStranglerDrift;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2ZuLWVxdWl2YWxlbmNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY2ZuLWVxdWl2YWxlbmNlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXNCRzs7O0FBRUgsbUNBQW1DO0FBa0NuQyxxR0FBcUc7QUFDckcsTUFBTSxTQUFTLEdBQUcsQ0FBQyxLQUFjLEVBQVUsRUFBRTtJQUMzQyxNQUFNLElBQUksR0FBRyxDQUFDLENBQVUsRUFBVyxFQUFFO1FBQ25DLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7WUFBRSxPQUFPLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDeEMsSUFBSSxDQUFDLElBQUksT0FBTyxDQUFDLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDL0IsT0FBTyxNQUFNLENBQUMsV0FBVyxDQUN2QixNQUFNLENBQUMsSUFBSSxDQUFDLENBQTRCLENBQUM7aUJBQ3RDLElBQUksRUFBRTtpQkFDTixHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBRSxDQUE2QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUM1RCxDQUFBO1FBQ0gsQ0FBQztRQUNELE9BQU8sQ0FBQyxDQUFBO0lBQ1YsQ0FBQyxDQUFBO0lBQ0QsT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO0FBQ3BDLENBQUMsQ0FBQTtBQUVEOzs7Ozs7O0dBT0c7QUFDSCxNQUFNLDBCQUEwQixHQUFHO0lBQ2pDLFdBQVc7SUFDWCxXQUFXO0lBQ1gsZ0JBQWdCO0lBQ2hCLHFCQUFxQjtJQUNyQixnQkFBZ0I7SUFDaEIsY0FBYztDQUNOLENBQUE7QUFFVjs7Ozs7Ozs7OztHQVVHO0FBQ0gscUdBQXFHO0FBQ3JHLHVHQUF1RztBQUN2RyxnR0FBZ0c7QUFDaEcsb0dBQW9HO0FBQ3BH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O0lBQzFGLENBQUM7SUFDRCxPQUFPLFNBQVMsQ0FBQTtBQUNsQixDQUFDLENBQUE7QUFQWSxRQUFBLHNCQUFzQiwwQkFPbEMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIExvZ2ljYWwtaWRlbnRpZmllci1ub3JtYWxpc2VkIENsb3VkRm9ybWF0aW9uIGVxdWl2YWxlbmNlIGZvciB0aGUgdW1icmVsbGEgc3RyYW5nbGVyIHJlZmFjdG9yLlxuICpcbiAqIFRoZSByZWZhY3RvciBkZWxpYmVyYXRlbHkgcmUtcGFyZW50cyByZXNvdXJjZXMgdW5kZXIga2l0IGNvbnN0cnVjdHMsIHdoaWNoIHJlbmFtZXMgdGhlaXIgQ0ZOXG4gKiBsb2dpY2FsIGlkcyB3aGlsZSB0aGVpciByZWFsIChwaHlzaWNhbCkgbmFtZXMgYXJlIGhlbGQgY29uc3RhbnQuIFNvIFwibm8gb2JzZXJ2YWJsZSBjaGFuZ2VcIiBpc1xuICogcHJvdmVuIGJ5IHJlc291cmNlIHByb3BlcnR5ICsgcHVibGlzaGVkLWV4cG9ydCBlcXVpdmFsZW5jZSB3aXRoIGxvZ2ljYWwtaWQgcmVuYW1lcyB0b2xlcmF0ZWQg4oCUIGFcbiAqIHJhdyB3aG9sZS10ZW1wbGF0ZSBjb21wYXJpc29uIGlzIHRoZSB3cm9uZyBvcmFjbGUgYmVjYXVzZSBpdCBmYWxzZS1mYWlscyBvbiB0aGUgcmVuYW1lLlxuICpcbiAqIEEgY3Jvc3MtcmVzb3VyY2UgcmVmZXJlbmNlIGlzIG5vcm1hbGlzZWQgYnkgKndoYXQgaXQgcG9pbnRzIGF0KiDigJQgdGhlIHRhcmdldCByZXNvdXJjZSdzIHNoYXBlLCBub3RcbiAqIGl0cyByZW5hbWVhYmxlIGxvZ2ljYWwgaWQg4oCUIHNvIGEgY29uc2lzdGVudCByZW5hbWUgaXMgdG9sZXJhdGVkIHdoaWxlIGEgcmVmZXJlbmNlIHJlLXBvaW50ZWQgYXQgYVxuICogZGlmZmVyZW50IHJlc291cmNlIChhIHBvbGljeSByZS1hdHRhY2hlZCB0byBhbm90aGVyIHJvbGUsIGEgc3RyZWFtIHJlLXdpcmVkIHRvIGFub3RoZXIgYnVja2V0KSByZWFkc1xuICogYXMgZHJpZnQuIEJ5LXZhbHVlIGlkZW50aXR5IChhIHRydXN0ZWQgYWNjb3VudCwgYW4gQVJOLCBhIHByaW5jaXBhbCkgaXMgY29tcGFyZWQgYXMgdGhlIGxpdGVyYWwgaXRcbiAqIGlzLCBzbyBhbiBJQU0gdHJ1c3QvcHJpbmNpcGFsIHJlLXRhcmdldCBpcyBhIHByb3BlcnR5IGNoYW5nZSB0aGUgd2hvbGUtc2hhcGUgY29tcGFyaXNvbiByZXBvcnRzLlxuICpcbiAqIEEgcmVmZXJlbmNlIGNhcnJpZXMgYSBmaXhlZC13aWR0aCAqc3Vycm9nYXRlKiBvZiBpdHMgdGFyZ2V0J3MgcmVzb2x2ZWQgc2hhcGUgKGEgY29udGVudCBoYXNoKSxcbiAqIG1lbW9pc2VkIHBlciBsb2dpY2FsIGlkLCByYXRoZXIgdGhhbiB0aGUgdGFyZ2V0J3Mgd2hvbGUgY2Fub25pY2FsIHN1YnRyZWUgaW5saW5lZCBieSB2YWx1ZS4gSW5saW5pbmdcbiAqIGdyb3dzIHRoZSByZWZlcnJlcidzIHRva2VuIGJ5IHRoZSB0YXJnZXQncyBmdWxsIHNpemUgYXQgZXZlcnkgcmVmZXJlbmNlIGFuZCByZS1lc2NhcGVzIGl0IGF0IGVhY2hcbiAqIGxldmVsLCBzbyBhIGRlZXAgY2hhaW4gb3IgYSB3aWRlIGZhbi1vdXQgbGF0dGljZSBiYWxsb29ucyB0aGUgdG9rZW4gc3VwZXItbGluZWFybHk7IHRoZSBzdXJyb2dhdGVcbiAqIGtlZXBzIGV2ZXJ5IHJlZmVyZW5jZSBPKDEpIGFuZCB0aGUgcGVyLWlkIG1lbW8ga2VlcHMgZWFjaCByZXNvdXJjZSByZXNvbHZlZCBvbmNlLCBzbyB0aGUgd2hvbGUgd2Fsa1xuICogaXMgcHJvcG9ydGlvbmFsIHRvIHRoZSB0ZW1wbGF0ZSdzIHNpemUuIFRoZSBzdXJyb2dhdGUgc3RpbGwgZW5jb2RlcyB0aGUgdGFyZ2V0J3MgZnVsbCBzaGFwZSAoc28gYVxuICogcmUtdGFyZ2V0IHRvIGEgZGlmZmVyZW50bHktc2hhcGVkIHJlc291cmNlIGNoYW5nZXMgaXQgYW5kIHJlYWRzIGFzIGRyaWZ0KSBhbmQgYSBjb25zaXN0ZW50IHJlbmFtZVxuICogbGVhdmVzIHRoZSByZXNvbHZlZCBzaGFwZSDigJQgYW5kIHRodXMgdGhlIHN1cnJvZ2F0ZSDigJQgdW5jaGFuZ2VkLlxuICovXG5cbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tICdjcnlwdG8nXG5cbnR5cGUgQ2ZuUmVzb3VyY2UgPSB7IFR5cGU6IHN0cmluZzsgUHJvcGVydGllcz86IHVua25vd247IFtrOiBzdHJpbmddOiB1bmtub3duIH1cblxudHlwZSBDZm5PdXRwdXQgPSB7IFZhbHVlPzogdW5rbm93bjsgRXhwb3J0PzogeyBOYW1lPzogdW5rbm93biB9OyBDb25kaXRpb24/OiB1bmtub3duOyBbazogc3RyaW5nXTogdW5rbm93biB9XG5cbnR5cGUgQ2ZuVGVtcGxhdGUgPSB7XG4gIFJlc291cmNlcz86IFJlY29yZDxzdHJpbmcsIENmblJlc291cmNlPlxuICBPdXRwdXRzPzogUmVjb3JkPHN0cmluZywgQ2ZuT3V0cHV0PlxuICBQYXJhbWV0ZXJzPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbn1cblxuLyoqIEEgcmVzb3VyY2UgY29tcGFyZWQgYnkgd2hhdCBhIGN1c3RvbWVyIGNhbiBvYnNlcnZlOiBpdHMgdHlwZSBhbmQgaXRzIHJlc29sdmVkIHByb3BlcnRpZXMuICovXG5leHBvcnQgaW50ZXJmYWNlIFJlc291cmNlU2hhcGUge1xuICByZWFkb25seSB0eXBlOiBzdHJpbmdcbiAgcmVhZG9ubHkgcHJvcGVydGllczogdW5rbm93blxufVxuXG4vKipcbiAqIEEgcHVibGlzaGVkIGNyb3NzLXN0YWNrIHZhbHVlIG90aGVyIHN0YWNrcyBpbXBvcnQ6IGl0cyBleHBvcnQgbmFtZSwgaXRzIHZhbHVlLCBhbmQgdGhlIE91dHB1dC1sZXZlbFxuICogYENvbmRpdGlvbmAgdGhhdCBnYXRlcyB3aGV0aGVyIHRoZSBleHBvcnQgZXhpc3RzIGF0IGFsbCBpbiBhIGdpdmVuIGVudmlyb25tZW50LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFB1Ymxpc2hlZEV4cG9ydCB7XG4gIHJlYWRvbmx5IG5hbWU6IHVua25vd25cbiAgcmVhZG9ubHkgdmFsdWU6IHVua25vd25cbiAgcmVhZG9ubHkgY29uZGl0aW9uPzogdW5rbm93blxufVxuXG4vKiogT25lIG9ic2VydmFibGUgZGlmZmVyZW5jZSBiZXR3ZWVuIGEgYmFzZWxpbmUgdGVtcGxhdGUgYW5kIGEgY2FuZGlkYXRlIHRlbXBsYXRlLiAqL1xuZXhwb3J0IGludGVyZmFjZSBDZm5EaWZmZXJlbmNlIHtcbiAgcmVhZG9ubHkga2luZDogJ3Jlc291cmNlLXJlbW92ZWQnIHwgJ3Jlc291cmNlLWFkZGVkJyB8ICdleHBvcnQtY2hhbmdlZCcgfCAnZXhwb3J0LXJlbW92ZWQnIHwgJ2V4cG9ydC1hZGRlZCdcbiAgcmVhZG9ubHkgZGV0YWlsOiBzdHJpbmdcbn1cblxuLyoqIERldGVybWluaXN0aWMgc2VyaWFsaXphdGlvbiB3aXRoIHJlY3Vyc2l2ZWx5LXNvcnRlZCBvYmplY3Qga2V5cywgc28ga2V5IG9yZGVyIG5ldmVyIHJlZ2lzdGVycy4gKi9cbmNvbnN0IGNhbm9uaWNhbCA9ICh2YWx1ZTogdW5rbm93bik6IHN0cmluZyA9PiB7XG4gIGNvbnN0IHNvcnQgPSAodjogdW5rbm93bik6IHVua25vd24gPT4ge1xuICAgIGlmIChBcnJheS5pc0FycmF5KHYpKSByZXR1cm4gdi5tYXAoc29ydClcbiAgICBpZiAodiAmJiB0eXBlb2YgdiA9PT0gJ29iamVjdCcpIHtcbiAgICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoXG4gICAgICAgIE9iamVjdC5rZXlzKHYgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pXG4gICAgICAgICAgLnNvcnQoKVxuICAgICAgICAgIC5tYXAoKGspID0+IFtrLCBzb3J0KCh2IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVtrXSldKSxcbiAgICAgIClcbiAgICB9XG4gICAgcmV0dXJuIHZcbiAgfVxuICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoc29ydCh2YWx1ZSkpXG59XG5cbi8qKlxuICogVGhlIGxvYWQtYmVhcmluZyB0b3AtbGV2ZWwgcmVzb3VyY2UgYXR0cmlidXRlcyB0aGF0IGNhcnJ5IG9ic2VydmFibGUgYmVoYXZpb3VyIChzaWJsaW5ncyBvZiBgVHlwZWBcbiAqIGFuZCBgUHJvcGVydGllc2ApIOKAlCBhIGBEZXBlbmRzT25gIHJlLXRhcmdldCwgYSBmbGlwIG9mIGBEZWxldGlvblBvbGljeWAvYFVwZGF0ZVJlcGxhY2VQb2xpY3lgIG9uIGFcbiAqIHN0YXRlZnVsIHJlc291cmNlLCBvciBhIGNoYW5nZWQgYENvbmRpdGlvbmAvYENyZWF0aW9uUG9saWN5YC9gVXBkYXRlUG9saWN5YCBhbGwgY2hhbmdlIHdoYXQgdGhlIHN0YWNrXG4gKiBkb2VzLCBzbyB0aGV5IGVudGVyIHRoZSBjb21wYXJpc29uIHNoYXBlLiBgRGVwZW5kc09uYCBpcyByZWZlcmVuY2Utbm9ybWFsaXNlZCBieSBpdHMgdGFyZ2V0J3Mgc2hhcGU7XG4gKiB0aGUgcmVzdCBhcmUgY29tcGFyZWQgYnkgdmFsdWUuIGBNZXRhZGF0YWAgaXMgY29zbWV0aWMgKGl0cyBgYXdzOmNkazpwYXRoYCBjaGFuZ2VzIG9uIGV2ZXJ5IHJlbmFtZSlcbiAqIGFuZCBpcyBleGNsdWRlZCBzbyB0aGUgcmVuYW1lIHRvbGVyYW5jZSBob2xkcy5cbiAqL1xuY29uc3QgVE9QX0xFVkVMX1NIQVBFX0FUVFJJQlVURVMgPSBbXG4gICdEZXBlbmRzT24nLFxuICAnQ29uZGl0aW9uJyxcbiAgJ0RlbGV0aW9uUG9saWN5JyxcbiAgJ1VwZGF0ZVJlcGxhY2VQb2xpY3knLFxuICAnQ3JlYXRpb25Qb2xpY3knLFxuICAnVXBkYXRlUG9saWN5Jyxcbl0gYXMgY29uc3RcblxuLyoqXG4gKiBSZXNvbHZlcyBhIGxvZ2ljYWwtaWQgcmVmZXJlbmNlIHRvIGEgZml4ZWQtd2lkdGggc3Vycm9nYXRlIG9mICp3aGF0IHRoZSByZWZlcmVuY2UgcG9pbnRzIGF0KiDigJQgYVxuICogY29udGVudCBoYXNoIG9mIHRoZSB0YXJnZXQgcmVzb3VyY2UncyByZXNvbHZlZCBzaGFwZSAoaXRzIHR5cGUgKyByZWN1cnNpdmVseSByZWZlcmVuY2Utbm9ybWFsaXNlZFxuICogcHJvcGVydGllcyBBTkQgaXRzIGxvYWQtYmVhcmluZyB0b3AtbGV2ZWwgYXR0cmlidXRlcyksIG5ldmVyIGl0cyByZW5hbWVhYmxlIGxvZ2ljYWwtaWQgaWRlbnRpdHkuIFR3b1xuICogcmVmZXJlbmNlcyB0byBkaWZmZXJlbnRseS1zaGFwZWQgdGFyZ2V0cyBnZXQgZGlmZmVyZW50IHN1cnJvZ2F0ZXMsIHNvIGEgcmUtdGFyZ2V0IChhIHBvbGljeVxuICogcmUtYXR0YWNoZWQgdG8gYW5vdGhlciByb2xlLCBhIHN0cmVhbSByZS13aXJlZCB0byBhbm90aGVyIGJ1Y2tldCwgYSByZWZlcmVuY2UgcmUtcG9pbnRlZCBmcm9tIGFcbiAqIGR1cmFibGUgcmVzb3VyY2UgdG8gYSBkaXNwb3NhYmxlIG5lYXItdHdpbikgY2hhbmdlcyB0aGUgcmVmZXJyZXIncyBjYW5vbmljYWwgc2hhcGUgYW5kIHJlZ2lzdGVycyBhc1xuICogZHJpZnQ7IGEgY29uc2lzdGVudCBsb2dpY2FsLWlkIHJlbmFtZSBsZWF2ZXMgdGhlIHRhcmdldCdzIHNoYXBlIHVuY2hhbmdlZCwgc28gdGhlIHN1cnJvZ2F0ZSBpcyBzdGFibGVcbiAqIGFuZCB0aGUgcmVuYW1lIGlzIHRvbGVyYXRlZC4gVGhlIHN1cnJvZ2F0ZSBpcyBtZW1vaXNlZCBwZXIgbG9naWNhbCBpZCBhbmQgaXMgZml4ZWQtd2lkdGgsIHNvIGEgZGVlcFxuICogY2hhaW4gb3IgYSB3aWRlIGxhdHRpY2UgcmVzb2x2ZXMgaW4gdGltZSBhbmQgc3BhY2UgcHJvcG9ydGlvbmFsIHRvIHRoZSB0ZW1wbGF0ZSdzIHNpemUuXG4gKi9cbi8vIERlZmVuY2UtaW4tZGVwdGggY2VpbGluZyBvbiB0aGUgbGl2ZSByZXNvbHV0aW9uLXN0YWNrIGRlcHRoLiBUaGUgY2FjaGUgaXMgcHJlLXdhcm1lZCBpbiBkZXBlbmRlbmN5XG4vLyBvcmRlciB0aHJvdWdoIGFuIGV4cGxpY2l0IHdvcmstc3RhY2sgKHNlZSBgcHJld2FybUNhY2hlYCksIHNvIGEgY3Jvc3MtcmVzb3VyY2UgcmVmZXJlbmNlIGlzIGFsd2F5cyBhXG4vLyBjYWNoZSBoaXQgYnkgdGhlIHRpbWUgdGhlIHJlY3Vyc2l2ZSByZXNvbHZlIG1lZXRzIGl0IGFuZCB0aGUgbGl2ZSByZWN1cnNpb24gb25seSBkZXNjZW5kcyBvbmVcbi8vIHJlc291cmNlJ3Mgb3duIHByb3BlcnR5IHRyZWUg4oCUIG5ldmVyIGEgY2hhaW4gb2YgcmVzb3VyY2VzLCBpbiBhbnkgaW5zZXJ0aW9uIG9yZGVyLiBTbyBub3RoaW5nIHRoZVxuLy8gZ2F0ZSBwcm9jZXNzZXMgYXBwcm9hY2hlcyB0aGlzIGRlcHRoOyBpdCBjYXBzIGEgc2luZ2xlIHJlc291cmNlJ3MgcGF0aG9sb2dpY2FsbHkgbmVzdGVkIG93blxuLy8gcHJvcGVydGllcyBhdCBhIHN0YWJsZSBkZXB0aC1jYXBwZWQgdG9rZW4gcmF0aGVyIHRoYW4gcmVjdXJzaW5nIHVudGlsIFY4J3MgY2FsbCBzdGFjayB0aHJvd3MgYSByYXdcbi8vIGBSYW5nZUVycm9yYC4gVGhlIHZhbHVlIHNpdHMgd2VsbCBiZWxvdyB0aGUgbmF0aXZlIGNhbGwtc3RhY2sgZmxvb3IgbWVhc3VyZWQgdW5kZXIgYSBKZXN0IHdvcmtlclxuLy8gdGhyZWFkICh0aGUgc21hbGxlci1zdGFjayBydW5uZXIpLCBzbyB0aGUgZ3JhY2VmdWwgdG9rZW4gd291bGQgZmlyZSBmaXJzdDsgaXQgaXMgYSBmbG9vciwgbm90IHRoZVxuLy8gaG90IHBhdGguXG5jb25zdCBSRVNPTFVUSU9OX0RFUFRIX0NFSUxJTkcgPSA4MDBcblxuY29uc3QgdGFyZ2V0VG9rZW5SZXNvbHZlciA9IChyZXNvdXJjZXM6IFJlY29yZDxzdHJpbmcsIENmblJlc291cmNlPikgPT4ge1xuICBjb25zdCBsb2dpY2FsSWRzID0gbmV3IFNldChPYmplY3Qua2V5cyhyZXNvdXJjZXMpKVxuICAvLyBFYWNoIGxvZ2ljYWwgaWQncyBmdWxseS1yZXNvbHZlZCBzdXJyb2dhdGUsIG1lbW9pc2VkIHNvIGEgcmVzb3VyY2UgaXMgcmVzb2x2ZWQgb25jZSByZWdhcmRsZXNzIG9mXG4gIC8vIGhvdyBtYW55IHJlZmVyZW5jZXMgcmVhY2ggaXQgb3IgaG93IGRlZXAgdGhlIHJlY3Vyc2lvbiBpcy4gQSByZXNvbHV0aW9uIHRoYXQgdG91Y2hlZCBhIGN5Y2xlXG4gIC8vIGJhY2stZWRnZSBPUiB0aGUgZGVwdGggY2VpbGluZyBpcyBjb250ZXh0LWRlcGVuZGVudCAoaXRzIGByZWYtY3ljbGVgL2ByZWYtZGVwdGgtY2FwcGVkYCBhbmNob3IgaXNcbiAgLy8gcmVsYXRpdmUgdG8gdGhlIGFuY2VzdG9ycyBvbiB0aGUgc3RhY2sgYXQgdGhlIHRpbWUpLCBzbyBpdCBpcyBOT1QgY2FjaGVkIOKAlCBvbmx5IGEgY29udGV4dC1mcmVlLFxuICAvLyBmdWxseS1yZXNvbHZlZCBzdXJyb2dhdGUgZ29lcyBpbiwgd2hpY2gga2VlcHMgdGhlIG1lbW8gc291bmQgdW5kZXIgYXJiaXRyYXJ5IHJlZmVyZW5jZSBvcmRlci5cbiAgY29uc3QgY2FjaGUgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpXG5cbiAgLy8gQSByZWZlcmVuY2UgY2FycmllcyB0aGlzIGZpeGVkLXdpZHRoIHN1cnJvZ2F0ZSBvZiB0aGUgdGFyZ2V0J3MgcmVzb2x2ZWQgc2hhcGUsIG5vdCB0aGUgc2hhcGUgaXRzZWxmLFxuICAvLyBzbyBhIHJlZmVyZW5jZSBjb3N0cyBPKDEpIGJ5dGVzIHJlZ2FyZGxlc3Mgb2YgaG93IGxhcmdlIHRoZSB0YXJnZXQncyBzdWJ0cmVlIGlzLiBUaGUgaGFzaCBlbmNvZGVzXG4gIC8vIHRoZSBmdWxsIHJlc29sdmVkIHNoYXBlLCBzbyB0d28gZGlmZmVyZW50bHktc2hhcGVkIHRhcmdldHMgZ2V0IGRpZmZlcmVudCBzdXJyb2dhdGVzIChhIHJlLXRhcmdldCBpc1xuICAvLyBkcmlmdCkgd2hpbGUgYSBjb25zaXN0ZW50IHJlbmFtZSBsZWF2ZXMgdGhlIHNoYXBlIOKAlCBhbmQgdGhlIHN1cnJvZ2F0ZSDigJQgdW5jaGFuZ2VkLlxuICBjb25zdCBzdXJyb2dhdGUgPSAocmVzb2x2ZWRTaGFwZVRva2VuOiBzdHJpbmcpOiBzdHJpbmcgPT5cbiAgICBgcmVm4oaSIyR7Y3JlYXRlSGFzaCgnc2hhMjU2JykudXBkYXRlKHJlc29sdmVkU2hhcGVUb2tlbikuZGlnZXN0KCdoZXgnKX1gXG5cbiAgLy8gUmVzb2x2ZXMgYSBsb2dpY2FsLWlkIHJlZmVyZW5jZSB0byBpdHMgdGFyZ2V0J3Mgc3Vycm9nYXRlLiBgcmVzb2x2aW5nYCBpcyB0aGUgYW5jZXN0b3Igc3RhY2sgb24gdGhlXG4gIC8vIGN1cnJlbnQgcGF0aDsgYGNvbnRleHQudGFpbnRlZGAgcmVjb3JkcyB3aGV0aGVyIHRoaXMgc3VidHJlZSdzIHJlc29sdXRpb24gbGVhbmVkIG9uIGEgYmFjay1lZGdlIG9yXG4gIC8vIHRoZSBkZXB0aCBjZWlsaW5nIChhbiBhbmNob3IgcmVsYXRpdmUgdG8gdGhvc2UgYW5jZXN0b3JzKSwgd2hpY2ggZ2F0ZXMgd2hldGhlciB0aGUgc3Vycm9nYXRlIGlzXG4gIC8vIHNhZmUgdG8gbWVtb2lzZS4gQSB0YXJnZXQgYWxyZWFkeSBvbiB0aGUgc3RhY2sgYW5jaG9ycyBvbiBpdHMgdHlwZSBhbG9uZSAoYHJlZi1jeWNsZeKGkjxUeXBlPmApLCB3aGljaFxuICAvLyB0ZXJtaW5hdGVzIHRoZSByZWN1cnNpb24gd2hpbGUga2VlcGluZyBhIGN5Y2xpYyB0YXJnZXQncyBzaGFwZSBkaXN0aW5jdCBmcm9tIGFuIGFjeWNsaWMgb25lLlxuICBjb25zdCBzaGFwZVRva2VuID0gKGlkOiBzdHJpbmcsIHJlc29sdmluZzogU2V0PHN0cmluZz4sIGNvbnRleHQ6IHsgdGFpbnRlZDogYm9vbGVhbiB9KTogc3RyaW5nID0+IHtcbiAgICBjb25zdCBjYWNoZWQgPSBjYWNoZS5nZXQoaWQpXG4gICAgaWYgKGNhY2hlZCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gY2FjaGVkXG4gICAgY29uc3QgdGFyZ2V0ID0gcmVzb3VyY2VzW2lkXVxuICAgIGlmICghdGFyZ2V0KSByZXR1cm4gJ3JlZuKGkjx1bmtub3duPidcbiAgICBpZiAocmVzb2x2aW5nLmhhcyhpZCkpIHtcbiAgICAgIGNvbnRleHQudGFpbnRlZCA9IHRydWVcbiAgICAgIHJldHVybiBgcmVmLWN5Y2xl4oaSJHt0YXJnZXQuVHlwZX1gXG4gICAgfVxuICAgIGlmIChyZXNvbHZpbmcuc2l6ZSA+PSBSRVNPTFVUSU9OX0RFUFRIX0NFSUxJTkcpIHtcbiAgICAgIGNvbnRleHQudGFpbnRlZCA9IHRydWVcbiAgICAgIHJldHVybiBgcmVmLWRlcHRoLWNhcHBlZOKGkiR7dGFyZ2V0LlR5cGV9YFxuICAgIH1cbiAgICBjb25zdCBzdWJ0cmVlID0geyB0YWludGVkOiBmYWxzZSB9XG4gICAgY29uc3QgcmVzb2x2ZWRTaGFwZSA9IGNhbm9uaWNhbChzaGFwZU9mKHRhcmdldCwgbmV3IFNldChyZXNvbHZpbmcpLmFkZChpZCksIHN1YnRyZWUpKVxuICAgIGNvbnN0IHRva2VuID0gc3Vycm9nYXRlKHJlc29sdmVkU2hhcGUpXG4gICAgaWYgKCFzdWJ0cmVlLnRhaW50ZWQpIGNhY2hlLnNldChpZCwgdG9rZW4pXG4gICAgZWxzZSBjb250ZXh0LnRhaW50ZWQgPSB0cnVlXG4gICAgcmV0dXJuIHRva2VuXG4gIH1cblxuICAvLyBQcmUtcmVzb2x2ZXMgZXZlcnkgYWN5Y2xpYyBsb2dpY2FsIGlkJ3Mgc3Vycm9nYXRlIGludG8gdGhlIGNhY2hlIGluIGRlcGVuZGVuY3kgKHBvc3Qtb3JkZXIpIG9yZGVyLFxuICAvLyB3YWxraW5nIHRoZSByZWZlcmVuY2UgZ3JhcGggd2l0aCBhbiBFWFBMSUNJVCB3b3JrLXN0YWNrIGluc3RlYWQgb2YgbmF0aXZlIHJlY3Vyc2lvbiBzbyB0aGUgcmVzb2x2ZWRcbiAgLy8gZGVwdGggaXMgYm91bmRlZCBieSB0aGUgaGVhcCwgbm90IFY4J3MgY2FsbCBzdGFjay4gT25jZSB0aGlzIGNvbXBsZXRlcywgZXZlcnkgY3Jvc3MtcmVzb3VyY2VcbiAgLy8gcmVmZXJlbmNlIGBzaGFwZVRva2VuYCBsYXRlciBtZWV0cyBpcyBhIGNhY2hlIGhpdCwgc28gdGhlIHJlY3Vyc2l2ZSByZXNvbHZlIG9mIGFueSBvbmUgcmVzb3VyY2Ugb25seVxuICAvLyBkZXNjZW5kcyB0aGF0IHJlc291cmNlJ3Mgb3duIChzaGFsbG93KSBwcm9wZXJ0eSB0cmVlIOKAlCBuZXZlciBhIGNoYWluIG9mIG90aGVyIHJlc291cmNlcy4gVGhpcyBpcyB3aGF0XG4gIC8vIGtlZXBzIGFuIGFkdmVyc2FyaWFsbHkgcmV2ZXJzZS1vcmRlcmVkIGRlZXAgY2hhaW4gTyhub2RlcykgcmF0aGVyIHRoYW4gTyhub2RlcyDDlyBkZXB0aCk6IHdpdGhvdXQgaXQsXG4gIC8vIHJlc29sdmluZyBhIHJldmVyc2Utb3JkZXJlZCBjaGFpbiB0b3AtZG93biByZWN1cnNlcyB0aGUgZnVsbCBsaXZlIGRlcHRoIGJlZm9yZSBhbnkgZGVzY2VuZGFudCBpc1xuICAvLyBjYWNoZWQuIEEgcmVzb3VyY2UgaXMgcHVzaGVkIG9uY2UgKGBzZWVuYCksIHRoZW4gcmV2aXNpdGVkIGFmdGVyIGl0cyByZWZlcmVuY2VkIGlkcyBhcmUgb24gdGhlIHN0YWNrO1xuICAvLyBvbiByZXZpc2l0LCBldmVyeSByZWZlcmVuY2VkIGlkIGlzIGVpdGhlciBjYWNoZWQgb3IgYSBjeWNsZSBiYWNrLWVkZ2UgKHN0aWxsIG9uIHRoZSBhY3RpdmUgYHBhdGhgKSxcbiAgLy8gc28gaXRzIHN1cnJvZ2F0ZSBjb21wdXRlcyB3aXRoIGFsbCBjaGlsZHJlbiByZXNvbHZlZC4gQSBiYWNrLWVkZ2UgdGFpbnRzIHRoZSBpbi1mbGlnaHQgcmVzb2x1dGlvblxuICAvLyBleGFjdGx5IGFzIHRoZSByZWN1cnNpdmUgcGF0aCBkb2VzLCBzbyBhIGN5Y2xlIG1lbWJlciBpcyBOT1QgY2FjaGVkIOKAlCBwcmVzZXJ2aW5nIHRoZSBtZW1vIGludmFyaWFudFxuICAvLyB0aGF0IG9ubHkgYSBjb250ZXh0LWZyZWUsIGZ1bGx5LXJlc29sdmVkIHN1cnJvZ2F0ZSBpcyBtZW1vaXNlZC5cbiAgY29uc3QgcHJld2FybUNhY2hlID0gKCk6IHZvaWQgPT4ge1xuICAgIGNvbnN0IHJlZmVyZW5jZWRJZHMgPSAoaWQ6IHN0cmluZyk6IHN0cmluZ1tdID0+IHtcbiAgICAgIGNvbnN0IGZvdW5kID0gbmV3IFNldDxzdHJpbmc+KClcbiAgICAgIGNvbnN0IGNvbGxlY3QgPSAodjogdW5rbm93bik6IHZvaWQgPT4ge1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheSh2KSkgcmV0dXJuIHYuZm9yRWFjaChjb2xsZWN0KVxuICAgICAgICBpZiAoIXYgfHwgdHlwZW9mIHYgIT09ICdvYmplY3QnKSByZXR1cm5cbiAgICAgICAgY29uc3Qgb2JqID0gdiBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuICAgICAgICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXMob2JqKVxuICAgICAgICBpZiAoa2V5cy5sZW5ndGggPT09IDEgJiYgdHlwZW9mIG9iai5SZWYgPT09ICdzdHJpbmcnICYmIGxvZ2ljYWxJZHMuaGFzKG9iai5SZWYpKSBmb3VuZC5hZGQob2JqLlJlZilcbiAgICAgICAgY29uc3QgZ2V0QXR0ID0ga2V5cy5sZW5ndGggPT09IDEgPyBvYmpbJ0ZuOjpHZXRBdHQnXSA6IHVuZGVmaW5lZFxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShnZXRBdHQpICYmIHR5cGVvZiBnZXRBdHRbMF0gPT09ICdzdHJpbmcnICYmIGxvZ2ljYWxJZHMuaGFzKGdldEF0dFswXSkpIGZvdW5kLmFkZChnZXRBdHRbMF0pXG4gICAgICAgIGVsc2UgaWYgKHR5cGVvZiBnZXRBdHQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgY29uc3QgaGVhZCA9IGdldEF0dC5pbmRleE9mKCcuJykgPj0gMCA/IGdldEF0dC5zbGljZSgwLCBnZXRBdHQuaW5kZXhPZignLicpKSA6IGdldEF0dFxuICAgICAgICAgIGlmIChnZXRBdHQuaW5kZXhPZignLicpID49IDAgJiYgbG9naWNhbElkcy5oYXMoaGVhZCkpIGZvdW5kLmFkZChoZWFkKVxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHN1YiA9IGtleXMubGVuZ3RoID09PSAxID8gb2JqWydGbjo6U3ViJ10gOiB1bmRlZmluZWRcbiAgICAgICAgY29uc3Qgc3ViU3RyaW5nID0gdHlwZW9mIHN1YiA9PT0gJ3N0cmluZycgPyBzdWIgOiBBcnJheS5pc0FycmF5KHN1YikgJiYgdHlwZW9mIHN1YlswXSA9PT0gJ3N0cmluZycgPyBzdWJbMF0gOiB1bmRlZmluZWRcbiAgICAgICAgaWYgKHN1YlN0cmluZyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgZm9yIChjb25zdCBbLCBpbm5lcl0gb2Ygc3ViU3RyaW5nLm1hdGNoQWxsKC9cXCRcXHsoW159XSspXFx9L2cpKSB7XG4gICAgICAgICAgICBjb25zdCB0cmltbWVkID0gaW5uZXIudHJpbSgpXG4gICAgICAgICAgICBjb25zdCBoZWFkID0gdHJpbW1lZC5pbmRleE9mKCcuJykgPj0gMCA/IHRyaW1tZWQuc2xpY2UoMCwgdHJpbW1lZC5pbmRleE9mKCcuJykpIDogdHJpbW1lZFxuICAgICAgICAgICAgaWYgKGxvZ2ljYWxJZHMuaGFzKGhlYWQpKSBmb3VuZC5hZGQoaGVhZClcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgZm9yIChjb25zdCBrIG9mIGtleXMpIHtcbiAgICAgICAgICBpZiAoayA9PT0gJ1BvbGljeU5hbWUnICYmIHR5cGVvZiBvYmpba10gPT09ICdzdHJpbmcnICYmIGxvZ2ljYWxJZHMuaGFzKG9ialtrXSBhcyBzdHJpbmcpKSBmb3VuZC5hZGQob2JqW2tdIGFzIHN0cmluZylcbiAgICAgICAgICBlbHNlIGlmIChrID09PSAnRGVwZW5kc09uJykgZm9yIChjb25zdCBkIG9mIEFycmF5LmlzQXJyYXkob2JqW2tdKSA/IChvYmpba10gYXMgdW5rbm93bltdKSA6IFtvYmpba11dKSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIGQgPT09ICdzdHJpbmcnICYmIGxvZ2ljYWxJZHMuaGFzKGQpKSBmb3VuZC5hZGQoZClcbiAgICAgICAgICAgIGVsc2UgY29sbGVjdChkKVxuICAgICAgICAgIH0gZWxzZSBjb2xsZWN0KG9ialtrXSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgY29uc3QgcmVzb3VyY2UgPSByZXNvdXJjZXNbaWRdXG4gICAgICBjb2xsZWN0KHJlc291cmNlLlByb3BlcnRpZXMgPz8gbnVsbClcbiAgICAgIGZvciAoY29uc3QgYXR0ciBvZiBUT1BfTEVWRUxfU0hBUEVfQVRUUklCVVRFUykge1xuICAgICAgICBpZiAocmVzb3VyY2VbYXR0cl0gPT09IHVuZGVmaW5lZCkgY29udGludWVcbiAgICAgICAgaWYgKGF0dHIgPT09ICdEZXBlbmRzT24nKSBmb3IgKGNvbnN0IGQgb2YgQXJyYXkuaXNBcnJheShyZXNvdXJjZVthdHRyXSkgPyAocmVzb3VyY2VbYXR0cl0gYXMgdW5rbm93bltdKSA6IFtyZXNvdXJjZVthdHRyXV0pIHtcbiAgICAgICAgICBpZiAodHlwZW9mIGQgPT09ICdzdHJpbmcnICYmIGxvZ2ljYWxJZHMuaGFzKGQpKSBmb3VuZC5hZGQoZClcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIFsuLi5mb3VuZF1cbiAgICB9XG5cbiAgICBjb25zdCBzZWVuID0gbmV3IFNldDxzdHJpbmc+KClcbiAgICBmb3IgKGNvbnN0IHJvb3Qgb2YgbG9naWNhbElkcykge1xuICAgICAgaWYgKGNhY2hlLmhhcyhyb290KSB8fCBzZWVuLmhhcyhyb290KSkgY29udGludWVcbiAgICAgIGNvbnN0IHBhdGggPSBuZXcgU2V0PHN0cmluZz4oKVxuICAgICAgY29uc3Qgc3RhY2s6IEFycmF5PHsgaWQ6IHN0cmluZzsgZXhwYW5kZWQ6IGJvb2xlYW4gfT4gPSBbeyBpZDogcm9vdCwgZXhwYW5kZWQ6IGZhbHNlIH1dXG4gICAgICB3aGlsZSAoc3RhY2subGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBmcmFtZSA9IHN0YWNrW3N0YWNrLmxlbmd0aCAtIDFdXG4gICAgICAgIGlmICghZnJhbWUuZXhwYW5kZWQpIHtcbiAgICAgICAgICBmcmFtZS5leHBhbmRlZCA9IHRydWVcbiAgICAgICAgICBpZiAoY2FjaGUuaGFzKGZyYW1lLmlkKSkgeyBzdGFjay5wb3AoKTsgY29udGludWUgfVxuICAgICAgICAgIHNlZW4uYWRkKGZyYW1lLmlkKVxuICAgICAgICAgIHBhdGguYWRkKGZyYW1lLmlkKVxuICAgICAgICAgIGZvciAoY29uc3QgY2hpbGQgb2YgcmVmZXJlbmNlZElkcyhmcmFtZS5pZCkpIHtcbiAgICAgICAgICAgIGlmICghY2FjaGUuaGFzKGNoaWxkKSAmJiAhcGF0aC5oYXMoY2hpbGQpKSBzdGFjay5wdXNoKHsgaWQ6IGNoaWxkLCBleHBhbmRlZDogZmFsc2UgfSlcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgc3RhY2sucG9wKClcbiAgICAgICAgICBwYXRoLmRlbGV0ZShmcmFtZS5pZClcbiAgICAgICAgICAvLyBDaGlsZHJlbiBhcmUgcmVzb2x2ZWQgKGNhY2hlZCkgb3IgY3ljbGUgYmFjay1lZGdlcyAoc3RpbGwgb24gYHBhdGhgKTsgcmVzb2x2aW5nIG5vdyBkZXNjZW5kc1xuICAgICAgICAgIC8vIG9ubHkgdGhpcyByZXNvdXJjZSdzIG93biBwcm9wZXJ0eSB0cmVlLCB3aXRoIGV2ZXJ5IGNyb3NzLXJlc291cmNlIHJlZmVyZW5jZSBhIGNhY2hlIGhpdC5cbiAgICAgICAgICBpZiAoIWNhY2hlLmhhcyhmcmFtZS5pZCkpIHNoYXBlVG9rZW4oZnJhbWUuaWQsIG5ldyBTZXQ8c3RyaW5nPigpLCB7IHRhaW50ZWQ6IGZhbHNlIH0pXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBUaGUgc2luZ2xlIHNvdXJjZSBvZiB0cnV0aCBmb3IgYSByZXNvdXJjZSdzIGNvbXBhcmlzb24gc2hhcGUg4oCUIGl0cyB0eXBlLCBpdHMgcmVmZXJlbmNlLW5vcm1hbGlzZWRcbiAgLy8gcHJvcGVydGllcywgYW5kIGVhY2ggcHJlc2VudCBsb2FkLWJlYXJpbmcgdG9wLWxldmVsIGF0dHJpYnV0ZSAoYERlcGVuZHNPbmAgcmVmZXJlbmNlLW5vcm1hbGlzZWQgYnlcbiAgLy8gdGFyZ2V0IHNoYXBlOyB0aGUgcmVzdCBieSB2YWx1ZTsgYE1ldGFkYXRhYCBleGNsdWRlZCkuIEJPVEggdGhlIHJlZmVyZW50IHRva2VuIChgc2hhcGVUb2tlbmAsIHdpdGhcbiAgLy8gdGhlIGN5Y2xlLWV4dGVuZGVkIHN0YWNrKSBhbmQgdGhlIG93bmVyIHNoYXBlIChgcmVzb3VyY2VTaGFwZXNgLCB3aXRoIGEgZnJlc2ggc3RhY2spIGJ1aWxkIHRocm91Z2hcbiAgLy8gdGhpcywgc28gdGhlIHR3byBwYXRocyBjYW4gbmV2ZXIgZHJpZnQgYXBhcnQ6IGEgcmVmZXJlbmNlIHJlLXBvaW50ZWQgYmV0d2VlbiB0d28gcmVzb3VyY2VzIHRoYXRcbiAgLy8gZGlmZmVyIG9ubHkgaW4gYSB0b3AtbGV2ZWwgYXR0cmlidXRlIG5vdyBjaGFuZ2VzIHRoZSByZWZlcmVudCB0b2tlbiwganVzdCBhcyBpdCBjaGFuZ2VzIHRoZSBvd25lci5cbiAgY29uc3Qgc2hhcGVPZiA9IChyZXNvdXJjZTogQ2ZuUmVzb3VyY2UsIHJlc29sdmluZzogU2V0PHN0cmluZz4sIGNvbnRleHQ6IHsgdGFpbnRlZDogYm9vbGVhbiB9KTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPT4ge1xuICAgIGNvbnN0IHNoYXBlOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHtcbiAgICAgIHR5cGU6IHJlc291cmNlLlR5cGUsXG4gICAgICBwcm9wZXJ0aWVzOiBub3JtYWxpc2UocmVzb3VyY2UuUHJvcGVydGllcyA/PyBudWxsLCByZXNvbHZpbmcsIGNvbnRleHQpLFxuICAgIH1cbiAgICBmb3IgKGNvbnN0IGF0dHIgb2YgVE9QX0xFVkVMX1NIQVBFX0FUVFJJQlVURVMpIHtcbiAgICAgIGlmIChyZXNvdXJjZVthdHRyXSA9PT0gdW5kZWZpbmVkKSBjb250aW51ZVxuICAgICAgc2hhcGVbYXR0cl0gPSBhdHRyID09PSAnRGVwZW5kc09uJyA/IG5vcm1hbGlzZURlcGVuZHNPbihyZXNvdXJjZVthdHRyXSwgcmVzb2x2aW5nLCBjb250ZXh0KSA6IHJlc291cmNlW2F0dHJdXG4gICAgfVxuICAgIHJldHVybiBzaGFwZVxuICB9XG5cbiAgLy8gQSBgRGVwZW5kc09uYCBpcyBhIGxvZ2ljYWwgaWQgb3IgYSBsaXN0IG9mIHRoZW07IGVhY2ggaWQtcmVmZXJlbmNlIHJld3JpdGVzIHRvIGl0cyB0YXJnZXQtc2hhcGVcbiAgLy8gdG9rZW4gKGEgbm9uLWlkIGVudHJ5IG5vcm1hbGlzZXMgYXMgb3JkaW5hcnkgZGF0YSkuIFNoYXJlZCBieSB0aGUgYG5vcm1hbGlzZWAgd2FsayAoYSBgRGVwZW5kc09uYFxuICAvLyBuZXN0ZWQgaW5zaWRlIGEgd2Fsa2VkIG9iamVjdCkgYW5kIGBzaGFwZU9mYCAodGhlIHRvcC1sZXZlbCBgRGVwZW5kc09uYCwgdGhlIG9ubHkgdmFsaWQgQ0ZOXG4gIC8vIHBsYWNlbWVudCksIHNvIHRoZSBkZXBlbmRlbmN5LWRlY2xhcmF0aW9uIHJlZmVyZW5jZSBmb3JtIG5vcm1hbGlzZXMgaWRlbnRpY2FsbHkgaW4gYm90aCBwYXRocy5cbiAgY29uc3Qgbm9ybWFsaXNlRGVwZW5kc09uID0gKGRlcDogdW5rbm93biwgcmVzb2x2aW5nOiBTZXQ8c3RyaW5nPiwgY29udGV4dDogeyB0YWludGVkOiBib29sZWFuIH0pOiB1bmtub3duID0+XG4gICAgKEFycmF5LmlzQXJyYXkoZGVwKSA/IGRlcCA6IFtkZXBdKS5tYXAoKGQpID0+XG4gICAgICB0eXBlb2YgZCA9PT0gJ3N0cmluZycgJiYgbG9naWNhbElkcy5oYXMoZCkgPyBzaGFwZVRva2VuKGQsIHJlc29sdmluZywgY29udGV4dCkgOiBub3JtYWxpc2UoZCwgcmVzb2x2aW5nLCBjb250ZXh0KSxcbiAgICApXG5cbiAgLyoqXG4gICAqIFJld3JpdGVzIGV2ZXJ5IGNyb3NzLXJlc291cmNlIGxvZ2ljYWwtaWQgcmVmZXJlbmNlIHRvIGl0cyB0YXJnZXQtc2hhcGUgdG9rZW4sIGFjcm9zcyBldmVyeSBmb3JtIGFcbiAgICogQ2xvdWRGb3JtYXRpb24gdGVtcGxhdGUgY2FuIGV4cHJlc3Mgb25lOiBge1JlZn1gLCBhcnJheS0gYW5kIHN0cmluZy1mb3JtIGB7Rm46OkdldEF0dH1gLFxuICAgKiBgRm46OlN1YmAtZW1iZWRkZWQgYCR7TG9naWNhbElkfWAgYW5kIGAke0xvZ2ljYWxJZC5BdHRyfWAsIGBEZXBlbmRzT25gLCBhbmQgdGhlIENESyBkZWZhdWx0LXBvbGljeVxuICAgKiBgUG9saWN5TmFtZWAgZWNoby5cbiAgICovXG4gIGNvbnN0IG5vcm1hbGlzZSA9ICh2YWx1ZTogdW5rbm93biwgcmVzb2x2aW5nOiBTZXQ8c3RyaW5nPiwgY29udGV4dDogeyB0YWludGVkOiBib29sZWFuIH0pOiB1bmtub3duID0+IHtcbiAgICBjb25zdCB3YWxrID0gKHY6IHVua25vd24pOiB1bmtub3duID0+IHtcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHYpKSByZXR1cm4gdi5tYXAod2FsaylcbiAgICAgIGlmICh2ICYmIHR5cGVvZiB2ID09PSAnb2JqZWN0Jykge1xuICAgICAgICBjb25zdCBvYmogPSB2IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+XG4gICAgICAgIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhvYmopXG4gICAgICAgIGlmIChrZXlzLmxlbmd0aCA9PT0gMSAmJiB0eXBlb2Ygb2JqLlJlZiA9PT0gJ3N0cmluZycgJiYgbG9naWNhbElkcy5oYXMob2JqLlJlZikpIHtcbiAgICAgICAgICByZXR1cm4geyBSZWY6IHNoYXBlVG9rZW4ob2JqLlJlZiwgcmVzb2x2aW5nLCBjb250ZXh0KSB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGtleXMubGVuZ3RoID09PSAxICYmIG9ialsnRm46OkdldEF0dCddICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBjb25zdCBnZXRBdHQgPSBvYmpbJ0ZuOjpHZXRBdHQnXVxuICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KGdldEF0dCkpIHtcbiAgICAgICAgICAgIGNvbnN0IFt0YXJnZXQsIC4uLnJlc3RdID0gZ2V0QXR0IGFzIHVua25vd25bXVxuICAgICAgICAgICAgaWYgKHR5cGVvZiB0YXJnZXQgPT09ICdzdHJpbmcnICYmIGxvZ2ljYWxJZHMuaGFzKHRhcmdldCkpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIHsgJ0ZuOjpHZXRBdHQnOiBbc2hhcGVUb2tlbih0YXJnZXQsIHJlc29sdmluZywgY29udGV4dCksIC4uLnJlc3QubWFwKHdhbGspXSB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgZ2V0QXR0ID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgY29uc3QgZG90ID0gZ2V0QXR0LmluZGV4T2YoJy4nKVxuICAgICAgICAgICAgY29uc3QgdGFyZ2V0ID0gZG90ID49IDAgPyBnZXRBdHQuc2xpY2UoMCwgZG90KSA6IGdldEF0dFxuICAgICAgICAgICAgaWYgKGRvdCA+PSAwICYmIGxvZ2ljYWxJZHMuaGFzKHRhcmdldCkpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIHsgJ0ZuOjpHZXRBdHQnOiBgJHtzaGFwZVRva2VuKHRhcmdldCwgcmVzb2x2aW5nLCBjb250ZXh0KX0ke2dldEF0dC5zbGljZShkb3QpfWAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAoa2V5cy5sZW5ndGggPT09IDEgJiYgb2JqWydGbjo6U3ViJ10gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHJldHVybiB7ICdGbjo6U3ViJzogbm9ybWFsaXNlU3ViKG9ialsnRm46OlN1YiddLCByZXNvbHZpbmcsIGNvbnRleHQpIH1cbiAgICAgICAgfVxuICAgICAgICBjb25zdCBvdXQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge31cbiAgICAgICAgZm9yIChjb25zdCBrIG9mIGtleXMpIHtcbiAgICAgICAgICBpZiAoayA9PT0gJ1BvbGljeU5hbWUnICYmIHR5cGVvZiBvYmpba10gPT09ICdzdHJpbmcnICYmIGxvZ2ljYWxJZHMuaGFzKG9ialtrXSBhcyBzdHJpbmcpKSB7XG4gICAgICAgICAgICBvdXRba10gPSBzaGFwZVRva2VuKG9ialtrXSBhcyBzdHJpbmcsIHJlc29sdmluZywgY29udGV4dClcbiAgICAgICAgICB9IGVsc2UgaWYgKGsgPT09ICdEZXBlbmRzT24nKSB7XG4gICAgICAgICAgICBvdXRba10gPSBub3JtYWxpc2VEZXBlbmRzT24ob2JqW2tdLCByZXNvbHZpbmcsIGNvbnRleHQpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG91dFtrXSA9IHdhbGsob2JqW2tdKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gb3V0XG4gICAgICB9XG4gICAgICByZXR1cm4gdlxuICAgIH1cbiAgICByZXR1cm4gd2Fsayh2YWx1ZSlcbiAgfVxuXG4gIC8vIGBGbjo6U3ViYCBpcyBlaXRoZXIgYSBzdHJpbmcgb3IgYFt0ZW1wbGF0ZSwgeyB2YXI6IHZhbHVlIH1dYC4gQW4gZW1iZWRkZWQgYCR7TG9naWNhbElkfWAgT1JcbiAgLy8gYCR7TG9naWNhbElkLkF0dHJ9YCByZWZlcmVuY2UgcmV3cml0ZXMgdG8gdGhlIHRhcmdldC1zaGFwZSB0b2tlbiAodGhlIGhlYWQgYmVmb3JlIHRoZSBmaXJzdCBgLmAgaXNcbiAgLy8gdGhlIGxvZ2ljYWwgaWQsIHRoZSBzdWZmaXggdGhlIGF0dHJpYnV0ZSwgbWlycm9yaW5nIHN0cmluZy1mb3JtIGBGbjo6R2V0QXR0YCksIHNvIGEgY29uc2lzdGVudFxuICAvLyByZW5hbWUgb2YgdGhlIHRhcmdldCBpcyB0b2xlcmF0ZWQgd2hpbGUgYSByZS10YXJnZXQgcmVhZHMgYXMgZHJpZnQuIEEgYCR7IUxpdGVyYWx9YCBlc2NhcGUgKGhlYWRcbiAgLy8gYCFMaXRlcmFsYCwgbmV2ZXIgYSBsb2dpY2FsIGlkKSBhbmQgYSBub24tcmVzb3VyY2UgYCR7UGFyYW19YCBhcmUgbGVmdCB1bnRvdWNoZWQuXG4gIGNvbnN0IG5vcm1hbGlzZVN1YiA9IChzdWI6IHVua25vd24sIHJlc29sdmluZzogU2V0PHN0cmluZz4sIGNvbnRleHQ6IHsgdGFpbnRlZDogYm9vbGVhbiB9KTogdW5rbm93biA9PiB7XG4gICAgY29uc3QgcmV3cml0ZVN0cmluZyA9IChzOiBzdHJpbmcpOiBzdHJpbmcgPT5cbiAgICAgIHMucmVwbGFjZSgvXFwkXFx7KFtefV0rKVxcfS9nLCAobWF0Y2gsIGlubmVyOiBzdHJpbmcpID0+IHtcbiAgICAgICAgY29uc3QgdHJpbW1lZCA9IGlubmVyLnRyaW0oKVxuICAgICAgICBjb25zdCBkb3QgPSB0cmltbWVkLmluZGV4T2YoJy4nKVxuICAgICAgICBjb25zdCBoZWFkID0gZG90ID49IDAgPyB0cmltbWVkLnNsaWNlKDAsIGRvdCkgOiB0cmltbWVkXG4gICAgICAgIHJldHVybiBsb2dpY2FsSWRzLmhhcyhoZWFkKSA/IGBcXCR7JHtzaGFwZVRva2VuKGhlYWQsIHJlc29sdmluZywgY29udGV4dCl9JHtkb3QgPj0gMCA/IHRyaW1tZWQuc2xpY2UoZG90KSA6ICcnfX1gIDogbWF0Y2hcbiAgICAgIH0pXG4gICAgaWYgKHR5cGVvZiBzdWIgPT09ICdzdHJpbmcnKSByZXR1cm4gcmV3cml0ZVN0cmluZyhzdWIpXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoc3ViKSkge1xuICAgICAgY29uc3QgW3RlbXBsYXRlLCB2YXJzLCAuLi5yZXN0XSA9IHN1YiBhcyB1bmtub3duW11cbiAgICAgIGNvbnN0IGhlYWQgPSB0eXBlb2YgdGVtcGxhdGUgPT09ICdzdHJpbmcnID8gcmV3cml0ZVN0cmluZyh0ZW1wbGF0ZSkgOiBub3JtYWxpc2UodGVtcGxhdGUsIHJlc29sdmluZywgY29udGV4dClcbiAgICAgIHJldHVybiBbaGVhZCwgbm9ybWFsaXNlKHZhcnMsIHJlc29sdmluZywgY29udGV4dCksIC4uLnJlc3QubWFwKChyKSA9PiBub3JtYWxpc2UociwgcmVzb2x2aW5nLCBjb250ZXh0KSldXG4gICAgfVxuICAgIHJldHVybiBub3JtYWxpc2Uoc3ViLCByZXNvbHZpbmcsIGNvbnRleHQpXG4gIH1cblxuICAvLyBSZXNvbHZlIGV2ZXJ5IGFjeWNsaWMgaWQncyBzdXJyb2dhdGUgdXAgZnJvbnQgKGhlYXAtYm91bmRlZCB3b3JrLXN0YWNrKSBzbyB0aGUgcmVjdXJzaXZlIHJlc29sdmVzXG4gIC8vIHRoZSBwdWJsaWMgaGVscGVycyB0cmlnZ2VyIG9ubHkgZXZlciBkZXNjZW5kIGEgc2luZ2xlIHJlc291cmNlJ3Mgb3duIHByb3BlcnR5IHRyZWUuXG4gIHByZXdhcm1DYWNoZSgpXG5cbiAgcmV0dXJuIHtcbiAgICAvLyBUaGUgcHVibGljIHJlZmVyZW5jZS1ub3JtYWxpc2VyIChmcmVzaCByZXNvbHV0aW9uIHN0YWNrKSDigJQgcmV3cml0ZXMgZXZlcnkgY3Jvc3MtcmVzb3VyY2VcbiAgICAvLyByZWZlcmVuY2UgaW4gYW4gYXJiaXRyYXJ5IHZhbHVlIHRvIGl0cyB0YXJnZXQtc2hhcGUgc3Vycm9nYXRlLiBVc2VkIGZvciBleHBvcnQgdmFsdWVzLiBBXG4gICAgLy8gdGhyb3dhd2F5IHRhaW50IGNvbnRleHQ6IGF0IHRoZSB0b3AgbGV2ZWwgdGhlcmUgaXMgbm8gZW5jbG9zaW5nIHJlc29sdXRpb24gd2hvc2UgbWVtb2lzYXRpb25cbiAgICAvLyBhIGJhY2stZWRnZSBiZWxvdyBjb3VsZCBwb2lzb24sIHNvIHRoZSBmbGFnIGlzIG9ubHkgY29uc3VtZWQgYnkgdGhlIHBlci1pZCBtZW1vIGluc2lkZS5cbiAgICBub3JtYWxpc2U6ICh2YWx1ZTogdW5rbm93bik6IHVua25vd24gPT4gbm9ybWFsaXNlKHZhbHVlLCBuZXcgU2V0PHN0cmluZz4oKSwgeyB0YWludGVkOiBmYWxzZSB9KSxcbiAgICAvLyBBIHJlc291cmNlJ3MgZnVsbCBjb21wYXJpc29uIHNoYXBlIChmcmVzaCByZXNvbHV0aW9uIHN0YWNrKSwgc28gdGhlIG11bHRpc2V0IGtleSBhbmQgdGhlXG4gICAgLy8gcmVmZXJlbnQgc3Vycm9nYXRlIGFyZSBidWlsdCBieSBvbmUgaGVscGVyIGFuZCBjYW5ub3QgZGl2ZXJnZS5cbiAgICBzaGFwZU9mOiAocmVzb3VyY2U6IENmblJlc291cmNlKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPT4gc2hhcGVPZihyZXNvdXJjZSwgbmV3IFNldDxzdHJpbmc+KCksIHsgdGFpbnRlZDogZmFsc2UgfSksXG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgbXVsdGlzZXQgb2YgcmVzb3VyY2Ugc2hhcGVzLCBrZXllZCBieSB0eXBlICsgcmVmZXJlbmNlLW5vcm1hbGlzZWQgcHJvcGVydGllcyArIGxvYWQtYmVhcmluZ1xuICogdG9wLWxldmVsIGF0dHJpYnV0ZXMsIHNvIHRoYXQgYSByZW5hbWUgb2YgYSByZXNvdXJjZSdzIGxvZ2ljYWwgaWQgKGFuZCBvZiBhbnkgcmVmZXJlbmNlIHRvIGl0KSBkb2VzXG4gKiBub3QgcmVnaXN0ZXIgYXMgYSBjaGFuZ2UsIHdoaWxlIGEgcmVmZXJlbmNlIHJlLXBvaW50ZWQgYXQgYSBkaWZmZXJlbnQgcmVzb3VyY2UgZG9lcyAoaXRzIHRhcmdldC1zaGFwZVxuICogdG9rZW4gY2hhbmdlcykuIFRoZSBzaGFwZSBpcyBidWlsdCBieSB0aGUgcmVzb2x2ZXIncyBgc2hhcGVPZmAg4oCUIHRoZSBzYW1lIGhlbHBlciB0aGUgcmVmZXJlbnQgdG9rZW5cbiAqIHVzZXMg4oCUIHNvIGEgcmUtdGFyZ2V0IGJldHdlZW4gdHdvIHJlc291cmNlcyBkaWZmZXJpbmcgb25seSBpbiBhIHRvcC1sZXZlbCBhdHRyaWJ1dGUgaXMgY2F1Z2h0XG4gKiBzeW1tZXRyaWNhbGx5IHdoZXRoZXIgdGhlIHJlc291cmNlIGlzIGNvbXBhcmVkIGFzIGFuIG93bmVyIG9yIHJlYWNoZWQgdGhyb3VnaCBhIHJlZmVyZW5jZS5cbiAqL1xuZXhwb3J0IGNvbnN0IHJlc291cmNlU2hhcGVzID0gKHRlbXBsYXRlOiBDZm5UZW1wbGF0ZSk6IE1hcDxzdHJpbmcsIG51bWJlcj4gPT4ge1xuICBjb25zdCByZXNvdXJjZXMgPSB0ZW1wbGF0ZS5SZXNvdXJjZXMgPz8ge31cbiAgY29uc3QgcmVzb2x2ZXIgPSB0YXJnZXRUb2tlblJlc29sdmVyKHJlc291cmNlcylcbiAgY29uc3QgY291bnRzID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKVxuICBmb3IgKGNvbnN0IHJlc291cmNlIG9mIE9iamVjdC52YWx1ZXMocmVzb3VyY2VzKSkge1xuICAgIGNvbnN0IGtleSA9IGNhbm9uaWNhbChyZXNvbHZlci5zaGFwZU9mKHJlc291cmNlKSlcbiAgICBjb3VudHMuc2V0KGtleSwgKGNvdW50cy5nZXQoa2V5KSA/PyAwKSArIDEpXG4gIH1cbiAgcmV0dXJuIGNvdW50c1xufVxuXG4vKipcbiAqIFB1Ymxpc2hlZCBleHBvcnRzIGtleWVkIGJ5IGV4cG9ydCBuYW1lIOKAlCB0aGUgY29udHJhY3QgZGVwZW5kZW50IHN0YWNrcyBpbXBvcnQgdmlhIGBGbjo6SW1wb3J0VmFsdWVgLlxuICogVGhlIGtleSBpcyB0aGUgZXhwb3J0IG5hbWUgKGEgc3RyaW5nIG5hbWUgYXMtaXM7IGFuIGludHJpbnNpYyBuYW1lIOKAlCBgRm46OlN1YmAvYEZuOjpKb2luYCDigJQgY2Fub25pY2FsaXNlZFxuICogdGhyb3VnaCB0aGUgcmVzb2x2ZXIgc28gaXRzIGVtYmVkZGVkIHJlZmVyZW5jZXMgbm9ybWFsaXNlIGFuZCBhIGxvZ2ljYWwtaWQgcmVuYW1lIGlzIHRvbGVyYXRlZCwgcmF0aGVyXG4gKiB0aGFuIHRoZSBleHBvcnQgYmVpbmcgc2tpcHBlZCkuIFRoZSB2YWx1ZSBjYXJyaWVzIGJvdGggdGhlIG5vcm1hbGlzZWQgYFZhbHVlYCBhbmQgdGhlIE91dHB1dC1sZXZlbFxuICogYENvbmRpdGlvbmAgKGJ5IHZhbHVlKSwgc28gYW4gZXhwb3J0IHRoYXQgZ2FpbnMgb3IgY2hhbmdlcyBhIGBDb25kaXRpb25gIOKAlCB3aGljaCBjYW4gbWFrZSBpdCBzaWxlbnRseVxuICogZGlzYXBwZWFyIGluIHNvbWUgZW52aXJvbm1lbnRzIGFuZCBicmVhayBhIGRlcGVuZGVudCBzdGFjaydzIGBGbjo6SW1wb3J0VmFsdWVgIOKAlCByZWdpc3RlcnMgYXMgZHJpZnQuXG4gKi9cbmV4cG9ydCBjb25zdCBwdWJsaXNoZWRFeHBvcnRzID0gKHRlbXBsYXRlOiBDZm5UZW1wbGF0ZSk6IE1hcDxzdHJpbmcsIHN0cmluZz4gPT4ge1xuICBjb25zdCByZXNvbHZlciA9IHRhcmdldFRva2VuUmVzb2x2ZXIodGVtcGxhdGUuUmVzb3VyY2VzID8/IHt9KVxuICBjb25zdCBleHBvcnRzID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKVxuICBmb3IgKGNvbnN0IG91dHB1dCBvZiBPYmplY3QudmFsdWVzKHRlbXBsYXRlLk91dHB1dHMgPz8ge30pKSB7XG4gICAgY29uc3QgZXhwb3J0TmFtZSA9IG91dHB1dC5FeHBvcnQ/Lk5hbWVcbiAgICBpZiAoZXhwb3J0TmFtZSA9PT0gdW5kZWZpbmVkKSBjb250aW51ZVxuICAgIGNvbnN0IGtleSA9IHR5cGVvZiBleHBvcnROYW1lID09PSAnc3RyaW5nJyA/IGV4cG9ydE5hbWUgOiBjYW5vbmljYWwocmVzb2x2ZXIubm9ybWFsaXNlKGV4cG9ydE5hbWUpKVxuICAgIGV4cG9ydHMuc2V0KGtleSwgY2Fub25pY2FsKHsgdmFsdWU6IHJlc29sdmVyLm5vcm1hbGlzZShvdXRwdXQuVmFsdWUpLCBjb25kaXRpb246IG91dHB1dC5Db25kaXRpb24gfSkpXG4gIH1cbiAgcmV0dXJuIGV4cG9ydHNcbn1cblxuLyoqXG4gKiBPYnNlcnZhYmxlIGRpZmZlcmVuY2VzIGJldHdlZW4gYSBiYXNlbGluZSBhbmQgYSBjYW5kaWRhdGUgdGVtcGxhdGU6IHJlc291cmNlcyB3aG9zZSB0eXBlK3Byb3BlcnRpZXNcbiAqIGFyZSBub3QgbWF0Y2hlZCBpbiBib3RoIGRpcmVjdGlvbnMsIGFuZCBwdWJsaXNoZWQgZXhwb3J0cyB0aGF0IGFyZSByZW5hbWVkLCBkcm9wcGVkLCBvciByZS12YWx1ZWQuXG4gKiBMb2dpY2FsLWlkLW9ubHkgcmVuYW1lcyBwcm9kdWNlIG5vIGRpZmZlcmVuY2UuIEFuIGVtcHR5IHJlc3VsdCBtZWFucyBlcXVpdmFsZW50LlxuICovXG5leHBvcnQgY29uc3QgY2ZuRGlmZmVyZW5jZXMgPSAoYmFzZWxpbmU6IENmblRlbXBsYXRlLCBjYW5kaWRhdGU6IENmblRlbXBsYXRlKTogQ2ZuRGlmZmVyZW5jZVtdID0+IHtcbiAgY29uc3QgZGlmZmVyZW5jZXM6IENmbkRpZmZlcmVuY2VbXSA9IFtdXG5cbiAgY29uc3QgYmFzZVJlc291cmNlcyA9IHJlc291cmNlU2hhcGVzKGJhc2VsaW5lKVxuICBjb25zdCBjYW5kUmVzb3VyY2VzID0gcmVzb3VyY2VTaGFwZXMoY2FuZGlkYXRlKVxuICBmb3IgKGNvbnN0IFtrZXksIGNvdW50XSBvZiBiYXNlUmVzb3VyY2VzKSB7XG4gICAgY29uc3QgY2FuZENvdW50ID0gY2FuZFJlc291cmNlcy5nZXQoa2V5KSA/PyAwXG4gICAgaWYgKGNhbmRDb3VudCA8IGNvdW50KSB7XG4gICAgICBjb25zdCB7IHR5cGUgfSA9IEpTT04ucGFyc2Uoa2V5KSBhcyB7IHR5cGU6IHN0cmluZyB9XG4gICAgICBkaWZmZXJlbmNlcy5wdXNoKHsga2luZDogJ3Jlc291cmNlLXJlbW92ZWQnLCBkZXRhaWw6IGAke3R5cGV9ICjDlyR7Y291bnQgLSBjYW5kQ291bnR9KWAgfSlcbiAgICB9XG4gIH1cbiAgZm9yIChjb25zdCBba2V5LCBjb3VudF0gb2YgY2FuZFJlc291cmNlcykge1xuICAgIGNvbnN0IGJhc2VDb3VudCA9IGJhc2VSZXNvdXJjZXMuZ2V0KGtleSkgPz8gMFxuICAgIGlmIChiYXNlQ291bnQgPCBjb3VudCkge1xuICAgICAgY29uc3QgeyB0eXBlIH0gPSBKU09OLnBhcnNlKGtleSkgYXMgeyB0eXBlOiBzdHJpbmcgfVxuICAgICAgZGlmZmVyZW5jZXMucHVzaCh7IGtpbmQ6ICdyZXNvdXJjZS1hZGRlZCcsIGRldGFpbDogYCR7dHlwZX0gKMOXJHtjb3VudCAtIGJhc2VDb3VudH0pYCB9KVxuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGJhc2VFeHBvcnRzID0gcHVibGlzaGVkRXhwb3J0cyhiYXNlbGluZSlcbiAgY29uc3QgY2FuZEV4cG9ydHMgPSBwdWJsaXNoZWRFeHBvcnRzKGNhbmRpZGF0ZSlcbiAgZm9yIChjb25zdCBbbmFtZSwgdmFsdWVdIG9mIGJhc2VFeHBvcnRzKSB7XG4gICAgaWYgKCFjYW5kRXhwb3J0cy5oYXMobmFtZSkpIGRpZmZlcmVuY2VzLnB1c2goeyBraW5kOiAnZXhwb3J0LXJlbW92ZWQnLCBkZXRhaWw6IG5hbWUgfSlcbiAgICBlbHNlIGlmIChjYW5kRXhwb3J0cy5nZXQobmFtZSkgIT09IHZhbHVlKSBkaWZmZXJlbmNlcy5wdXNoKHsga2luZDogJ2V4cG9ydC1jaGFuZ2VkJywgZGV0YWlsOiBuYW1lIH0pXG4gIH1cbiAgZm9yIChjb25zdCBuYW1lIG9mIGNhbmRFeHBvcnRzLmtleXMoKSkge1xuICAgIGlmICghYmFzZUV4cG9ydHMuaGFzKG5hbWUpKSBkaWZmZXJlbmNlcy5wdXNoKHsga2luZDogJ2V4cG9ydC1hZGRlZCcsIGRldGFpbDogbmFtZSB9KVxuICB9XG5cbiAgcmV0dXJuIGRpZmZlcmVuY2VzXG59XG5cbi8qKiBUcnVlIHdoZW4gdGhlIGNhbmRpZGF0ZSBpcyBvYnNlcnZhYmx5IGVxdWl2YWxlbnQgdG8gdGhlIGJhc2VsaW5lIChsb2dpY2FsLWlkIHJlbmFtZXMgdG9sZXJhdGVkKS4gKi9cbmV4cG9ydCBjb25zdCBpc0NmbkVxdWl2YWxlbnQgPSAoYmFzZWxpbmU6IENmblRlbXBsYXRlLCBjYW5kaWRhdGU6IENmblRlbXBsYXRlKTogYm9vbGVhbiA9PlxuICBjZm5EaWZmZXJlbmNlcyhiYXNlbGluZSwgY2FuZGlkYXRlKS5sZW5ndGggPT09IDBcblxuLyoqXG4gKiBTdHJhbmdsZXItcHJvZ3Jlc3Npb24gZ2F0ZTogYSBzdGVwIHRoYXQgd291bGQgb2JzZXJ2YWJseSBjaGFuZ2UgYW4gZXhpc3Rpbmcgc3RhY2sgZG9lcyBub3Qgc2hpcC5cbiAqIFJldHVybnMgdGhlIGNhbmRpZGF0ZSB0ZW1wbGF0ZSB1bmNoYW5nZWQgd2hlbiBlcXVpdmFsZW50OyB0aHJvd3Mgd2l0aCB0aGUgZGlmZmVyZW5jZXMgb3RoZXJ3aXNlLlxuICogVGhlIHZhbGlkYXRpb24gKm1ldGhvZG9sb2d5KiAod2hpY2ggc2FtcGxlIHN0YWNrLCB3aGljaCB0b29sKSBpcyBQaGFzZS1BLW93bmVkOyB0aGlzIGlzIHRoZSBnYXRpbmdcbiAqIGJlaGF2aW91ciB0aGUgbWV0aG9kb2xvZ3kgcGx1Z3MgaW50by5cbiAqL1xuZXhwb3J0IGNvbnN0IGFzc2VydE5vU3RyYW5nbGVyRHJpZnQgPSA8VCBleHRlbmRzIENmblRlbXBsYXRlPihiYXNlbGluZTogQ2ZuVGVtcGxhdGUsIGNhbmRpZGF0ZTogVCk6IFQgPT4ge1xuICBjb25zdCBkaWZmZXJlbmNlcyA9IGNmbkRpZmZlcmVuY2VzKGJhc2VsaW5lLCBjYW5kaWRhdGUpXG4gIGlmIChkaWZmZXJlbmNlcy5sZW5ndGggPiAwKSB7XG4gICAgY29uc3Qgc3VtbWFyeSA9IGRpZmZlcmVuY2VzLm1hcCgoZCkgPT4gYCR7ZC5raW5kfTogJHtkLmRldGFpbH1gKS5qb2luKCc7ICcpXG4gICAgdGhyb3cgbmV3IEVycm9yKGBzdHJhbmdsZXIgc3RlcCBibG9ja2VkIOKAlCBpdCB3b3VsZCBkcmlmdCBhbiBleGlzdGluZyBzdGFjazogJHtzdW1tYXJ5fWApXG4gIH1cbiAgcmV0dXJuIGNhbmRpZGF0ZVxufVxuIl19