"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatGateReport = exports.gate = void 0;
const compare_1 = require("./compare");
const oauth_conformance_1 = require("./oauth-conformance");
/**
 * Every OAuth configuration a channel emits, for the conformance check. A channel reduced from a
 * real artifact carries one config per client in {@link ChannelModel.oauthByClient}, so each client
 * is checked; a hand-built model that sets only the single {@link ChannelModel.oauth} slot is honoured
 * too. Both populated means the per-client map is authoritative (the single slot is its last entry).
 */
const oauthConfigsOf = (model) => {
    const byClient = model.oauthByClient !== undefined ? Object.values(model.oauthByClient) : [];
    if (byClient.length > 0)
        return byClient;
    return model.oauth === undefined ? [] : [model.oauth];
};
const oauthDivergences = (models) => models.flatMap((model) => oauthConfigsOf(model).flatMap((oauth) => (0, oauth_conformance_1.checkOAuthConformance)(oauth).map((issue) => ({
    tier: 'oauth',
    detail: `${issue.rule}: ${issue.detail}`,
    channels: [model.channel],
}))));
/**
 * A within-channel identity collision — two distinct primaries reduced to one node ref — makes that
 * channel's load-bearing values unreliable: the loser's value was clobbered last-write-wins, so a
 * widening on it is invisible. Each is surfaced as an explicit divergence the gate fails on, naming
 * the colliding ref and the channel, rather than letting the surviving value certify a false parity.
 */
const identityCollisionDivergences = (models) => models.flatMap((model) => (model.identityCollisions ?? []).map((collision) => ({
    tier: 'graph',
    detail: `duplicate declared identity ${collision} in channel ${model.channel}`,
    channels: [model.channel],
})));
/** Every distribution channel the parity gate must compare; a set missing any of them is incomplete. */
const REQUIRED_CHANNELS = ['cdk', 'cfn', 'terraform'];
/** Run the parity gate across the reduced channel models. */
const gate = (models) => {
    const malformed = models.filter((model) => !model.wellFormed);
    if (malformed.length > 0) {
        // An artifact that does not parse or validate fails before any comparison runs.
        return {
            passed: false,
            divergences: malformed.map((model) => ({
                tier: 'wellformed',
                detail: `the ${model.channel} artifact is not well-formed`,
                channels: [model.channel],
            })),
            warnings: [],
        };
    }
    // An incomplete channel set cannot pass vacuously: with a channel absent there is nothing to
    // diverge from, so a single-channel (or empty) run would otherwise report agreement it never proved.
    const present = new Set(models.map((model) => model.channel));
    const missing = REQUIRED_CHANNELS.filter((channel) => !present.has(channel));
    if (missing.length > 0) {
        return {
            passed: false,
            divergences: missing.map((channel) => ({
                tier: 'wellformed',
                detail: `the ${channel} channel is absent — the parity set is incomplete`,
                channels: [channel],
            })),
            warnings: [],
        };
    }
    const divergences = [
        ...identityCollisionDivergences(models),
        ...(0, compare_1.compareGraph)(models),
        ...(0, compare_1.compareValues)(models),
        ...(0, compare_1.compareGrants)(models),
        ...(0, compare_1.compareSecrets)(models),
        ...oauthDivergences(models),
    ];
    return { passed: divergences.length === 0, divergences, warnings: (0, compare_1.cosmeticWarnings)(models) };
};
exports.gate = gate;
/** Render a gate result as a release report — the divergences, then any cosmetic warnings. */
const formatGateReport = (result) => {
    const lines = [];
    if (result.passed) {
        lines.push('PARITY OK — all channels agree on graph, load-bearing values, permissions, and OAuth conformance.');
    }
    else {
        lines.push(`PARITY FAILED — ${result.divergences.length} divergence(s):`);
        for (const divergence of result.divergences) {
            lines.push(`  [${divergence.tier}] ${divergence.detail} — disagreeing: ${divergence.channels.join(', ')}`);
        }
    }
    for (const warning of result.warnings)
        lines.push(`  warning: ${warning}`);
    return lines.join('\n');
};
exports.formatGateReport = formatGateReport;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2F0ZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImdhdGUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBU0EsdUNBTWtCO0FBQ2xCLDJEQUEyRDtBQUUzRDs7Ozs7R0FLRztBQUNILE1BQU0sY0FBYyxHQUFHLENBQUMsS0FBbUIsRUFBMEIsRUFBRTtJQUNyRSxNQUFNLFFBQVEsR0FBRyxLQUFLLENBQUMsYUFBYSxLQUFLLFNBQVMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtJQUM1RixJQUFJLFFBQVEsQ0FBQyxNQUFNLEdBQUcsQ0FBQztRQUFFLE9BQU8sUUFBUSxDQUFBO0lBQ3hDLE9BQU8sS0FBSyxDQUFDLEtBQUssS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUE7QUFDdkQsQ0FBQyxDQUFBO0FBRUQsTUFBTSxnQkFBZ0IsR0FBRyxDQUFDLE1BQStCLEVBQWdCLEVBQUUsQ0FDekUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQ3ZCLGNBQWMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUN0QyxJQUFBLHlDQUFxQixFQUFDLEtBQUssQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztJQUMzQyxJQUFJLEVBQUUsT0FBZ0I7SUFDdEIsTUFBTSxFQUFFLEdBQUcsS0FBSyxDQUFDLElBQUksS0FBSyxLQUFLLENBQUMsTUFBTSxFQUFFO0lBQ3hDLFFBQVEsRUFBRSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUM7Q0FDMUIsQ0FBQyxDQUFDLENBQ0osQ0FDRixDQUFBO0FBRUg7Ozs7O0dBS0c7QUFDSCxNQUFNLDRCQUE0QixHQUFHLENBQUMs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LEdBQUcsQ0FBQyxNQUFrQixFQUFVLEVBQUU7SUFDN0QsTUFBTSxLQUFLLEdBQWEsRUFBRSxDQUFBO0lBQzFCLElBQUksTUFBTSxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBQ2xCLEtBQUssQ0FBQyxJQUFJLENBQUMsbUdBQW1HLENBQUMsQ0FBQTtJQUNqSCxDQUFDO1NBQU0sQ0FBQztRQUNOLEtBQUssQ0FBQyxJQUFJLENBQUMsbUJBQW1CLE1BQU0sQ0FBQyxXQUFXLENBQUMsTUFBTSxpQkFBaUIsQ0FBQyxDQUFBO1FBQ3pFLEtBQUssTUFBTSxVQUFVLElBQUksTUFBTSxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQzVDLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxVQUFVLENBQUMsSUFBSSxLQUFLLFVBQVUsQ0FBQyxNQUFNLG1CQUFtQixVQUFVLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDNUcsQ0FBQztJQUNILENBQUM7SUFDRCxLQUFLLE1BQU0sT0FBTyxJQUFJLE1BQU0sQ0FBQyxRQUFRO1FBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxjQUFjLE9BQU8sRUFBRSxDQUFDLENBQUE7SUFDMUUsT0FBTyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBO0FBQ3pCLENBQUMsQ0FBQTtBQVpZLFFBQUEsZ0JBQWdCLG9CQVk1QiIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogVGhlIHJlbGVhc2UtdGltZSBwYXJpdHkgZ2F0ZS4gUmVkdWNlcyBhcmUgZG9uZSBieSB0aGUgY2hhbm5lbCByZWR1Y2VyczsgdGhpcyBvcmNoZXN0cmF0ZXMgdGhlXG4gKiBjb21wYXJpc29uOiBpdCBmaXJzdCByZWplY3RzIGFueSBhcnRpZmFjdCB0aGF0IGlzIG5vdCB3ZWxsLWZvcm1lZCAoYmVmb3JlIGFueSBkaWZmKSwgdGhlbiBydW5zXG4gKiB0aGUgdGhyZWUgdGllcnMsIHRoZSBzZWNyZXQtd2lyaW5nIGNoZWNrLCBhbmQgdGhlIE9BdXRoMi9PSURDIGNvbmZvcm1hbmNlIGNoZWNrIGFjcm9zcyB0aGVcbiAqIGNoYW5uZWxzLCBjb2xsZWN0aW5nIGNvc21ldGljIGRpZmZlcmVuY2VzIGFzIHdhcm5pbmdzLiBUaGUgZ2F0ZSBwYXNzZXMgb25seSB3aGVuIG5vIHRpZXJcbiAqIGRpdmVyZ2VzOyBhIGRpdmVyZ2VuY2UgZmFpbHMgdGhlIHJlbGVhc2Ugd2l0aCBhIHJlcG9ydCBuYW1pbmcgdGhlIGRpdmVyZ2VudCBwaWVjZSBhbmQgdGhlXG4gKiBkaXNhZ3JlZWluZyBjaGFubmVsKHMpLlxuICovXG5pbXBvcnQgeyBDaGFubmVsTW9kZWwsIERpdmVyZ2VuY2UsIEdhdGVSZXN1bHQsIE9BdXRoQ29uZmlnIH0gZnJvbSAnLi9tb2RlbCdcbmltcG9ydCB7XG4gIGNvbXBhcmVHcmFudHMsXG4gIGNvbXBhcmVHcmFwaCxcbiAgY29tcGFyZVNlY3JldHMsXG4gIGNvbXBhcmVWYWx1ZXMsXG4gIGNvc21ldGljV2FybmluZ3MsXG59IGZyb20gJy4vY29tcGFyZSdcbmltcG9ydCB7IGNoZWNrT0F1dGhDb25mb3JtYW5jZSB9IGZyb20gJy4vb2F1dGgtY29uZm9ybWFuY2UnXG5cbi8qKlxuICogRXZlcnkgT0F1dGggY29uZmlndXJhdGlvbiBhIGNoYW5uZWwgZW1pdHMsIGZvciB0aGUgY29uZm9ybWFuY2UgY2hlY2suIEEgY2hhbm5lbCByZWR1Y2VkIGZyb20gYVxuICogcmVhbCBhcnRpZmFjdCBjYXJyaWVzIG9uZSBjb25maWcgcGVyIGNsaWVudCBpbiB7QGxpbmsgQ2hhbm5lbE1vZGVsLm9hdXRoQnlDbGllbnR9LCBzbyBlYWNoIGNsaWVudFxuICogaXMgY2hlY2tlZDsgYSBoYW5kLWJ1aWx0IG1vZGVsIHRoYXQgc2V0cyBvbmx5IHRoZSBzaW5nbGUge0BsaW5rIENoYW5uZWxNb2RlbC5vYXV0aH0gc2xvdCBpcyBob25vdXJlZFxuICogdG9vLiBCb3RoIHBvcHVsYXRlZCBtZWFucyB0aGUgcGVyLWNsaWVudCBtYXAgaXMgYXV0aG9yaXRhdGl2ZSAodGhlIHNpbmdsZSBzbG90IGlzIGl0cyBsYXN0IGVudHJ5KS5cbiAqL1xuY29uc3Qgb2F1dGhDb25maWdzT2YgPSAobW9kZWw6IENoYW5uZWxNb2RlbCk6IHJlYWRvbmx5IE9BdXRoQ29uZmlnW10gPT4ge1xuICBjb25zdCBieUNsaWVudCA9IG1vZGVsLm9hdXRoQnlDbGllbnQgIT09IHVuZGVmaW5lZCA/IE9iamVjdC52YWx1ZXMobW9kZWwub2F1dGhCeUNsaWVudCkgOiBbXVxuICBpZiAoYnlDbGllbnQubGVuZ3RoID4gMCkgcmV0dXJuIGJ5Q2xpZW50XG4gIHJldHVybiBtb2RlbC5vYXV0aCA9PT0gdW5kZWZpbmVkID8gW10gOiBbbW9kZWwub2F1dGhdXG59XG5cbmNvbnN0IG9hdXRoRGl2ZXJnZW5jZXMgPSAobW9kZWxzOiByZWFkb25seSBDaGFubmVsTW9kZWxbXSk6IERpdmVyZ2VuY2VbXSA9PlxuICBtb2RlbHMuZmxhdE1hcCgobW9kZWwpID0+XG4gICAgb2F1dGhDb25maWdzT2YobW9kZWwpLmZsYXRNYXAoKG9hdXRoKSA9PlxuICAgICAgY2hlY2tPQXV0aENvbmZvcm1hbmNlKG9hdXRoKS5tYXAoKGlzc3VlKSA9PiAoe1xuICAgICAgICB0aWVyOiAnb2F1dGgnIGFzIGNvbnN0LFxuICAgICAgICBkZXRhaWw6IGAke2lzc3VlLnJ1bGV9OiAke2lzc3VlLmRldGFpbH1gLFxuICAgICAgICBjaGFubmVsczogW21vZGVsLmNoYW5uZWxdLFxuICAgICAgfSkpLFxuICAgICksXG4gIClcblxuLyoqXG4gKiBBIHdpdGhpbi1jaGFubmVsIGlkZW50aXR5IGNvbGxpc2lvbiDigJQgdHdvIGRpc3RpbmN0IHByaW1hcmllcyByZWR1Y2VkIHRvIG9uZSBub2RlIHJlZiDigJQgbWFrZXMgdGhhdFxuICogY2hhbm5lbCdzIGxvYWQtYmVhcmluZyB2YWx1ZXMgdW5yZWxpYWJsZTogdGhlIGxvc2VyJ3MgdmFsdWUgd2FzIGNsb2JiZXJlZCBsYXN0LXdyaXRlLXdpbnMsIHNvIGFcbiAqIHdpZGVuaW5nIG9uIGl0IGlzIGludmlzaWJsZS4gRWFjaCBpcyBzdXJmYWNlZCBhcyBhbiBleHBsaWNpdCBkaXZlcmdlbmNlIHRoZSBnYXRlIGZhaWxzIG9uLCBuYW1pbmdcbiAqIHRoZSBjb2xsaWRpbmcgcmVmIGFuZCB0aGUgY2hhbm5lbCwgcmF0aGVyIHRoYW4gbGV0dGluZyB0aGUgc3Vydml2aW5nIHZhbHVlIGNlcnRpZnkgYSBmYWxzZSBwYXJpdHkuXG4gKi9cbmNvbnN0IGlkZW50aXR5Q29sbGlzaW9uRGl2ZXJnZW5jZXMgPSAobW9kZWxzOiByZWFkb25seSBDaGFubmVsTW9kZWxbXSk6IERpdmVyZ2VuY2VbXSA9PlxuICBtb2RlbHMuZmxhdE1hcCgobW9kZWwpID0+XG4gICAgKG1vZGVsLmlkZW50aXR5Q29sbGlzaW9ucyA/PyBbXSkubWFwKChjb2xsaXNpb24pID0+ICh7XG4gICAgICB0aWVyOiAnZ3JhcGgnIGFzIGNvbnN0LFxuICAgICAgZGV0YWlsOiBgZHVwbGljYXRlIGRlY2xhcmVkIGlkZW50aXR5ICR7Y29sbGlzaW9ufSBpbiBjaGFubmVsICR7bW9kZWwuY2hhbm5lbH1gLFxuICAgICAgY2hhbm5lbHM6IFttb2RlbC5jaGFubmVsXSxcbiAgICB9KSksXG4gIClcblxuLyoqIEV2ZXJ5IGRpc3RyaWJ1dGlvbiBjaGFubmVsIHRoZSBwYXJpdHkgZ2F0ZSBtdXN0IGNvbXBhcmU7IGEgc2V0IG1pc3NpbmcgYW55IG9mIHRoZW0gaXMgaW5jb21wbGV0ZS4gKi9cbmNvbnN0IFJFUVVJUkVEX0NIQU5ORUxTOiByZWFkb25seSBDaGFubmVsTW9kZWxbJ2NoYW5uZWwnXVtdID0gWydjZGsnLCAnY2ZuJywgJ3RlcnJhZm9ybSddXG5cbi8qKiBSdW4gdGhlIHBhcml0eSBnYXRlIGFjcm9zcyB0aGUgcmVkdWNlZCBjaGFubmVsIG1vZGVscy4gKi9cbmV4cG9ydCBjb25zdCBnYXRlID0gKG1vZGVsczogcmVhZG9ubHkgQ2hhbm5lbE1vZGVsW10pOiBHYXRlUmVzdWx0ID0+IHtcbiAgY29uc3QgbWFsZm9ybWVkID0gbW9kZWxzLmZpbHRlcigobW9kZWwpID0+ICFtb2RlbC53ZWxsRm9ybWVkKVxuICBpZiAobWFsZm9ybWVkLmxlbmd0aCA+IDApIHtcbiAgICAvLyBBbiBhcnRpZmFjdCB0aGF0IGRvZXMgbm90IHBhcnNlIG9yIHZhbGlkYXRlIGZhaWxzIGJlZm9yZSBhbnkgY29tcGFyaXNvbiBydW5zLlxuICAgIHJldHVybiB7XG4gICAgICBwYXNzZWQ6IGZhbHNlLFxuICAgICAgZGl2ZXJnZW5jZXM6IG1hbGZvcm1lZC5tYXAoKG1vZGVsKSA9PiAoe1xuICAgICAgICB0aWVyOiAnd2VsbGZvcm1lZCcsXG4gICAgICAgIGRldGFpbDogYHRoZSAke21vZGVsLmNoYW5uZWx9IGFydGlmYWN0IGlzIG5vdCB3ZWxsLWZvcm1lZGAsXG4gICAgICAgIGNoYW5uZWxzOiBbbW9kZWwuY2hhbm5lbF0sXG4gICAgICB9KSksXG4gICAgICB3YXJuaW5nczogW10sXG4gICAgfVxuICB9XG5cbiAgLy8gQW4gaW5jb21wbGV0ZSBjaGFubmVsIHNldCBjYW5ub3QgcGFzcyB2YWN1b3VzbHk6IHdpdGggYSBjaGFubmVsIGFic2VudCB0aGVyZSBpcyBub3RoaW5nIHRvXG4gIC8vIGRpdmVyZ2UgZnJvbSwgc28gYSBzaW5nbGUtY2hhbm5lbCAob3IgZW1wdHkpIHJ1biB3b3VsZCBvdGhlcndpc2UgcmVwb3J0IGFncmVlbWVudCBpdCBuZXZlciBwcm92ZWQuXG4gIGNvbnN0IHByZXNlbnQgPSBuZXcgU2V0KG1vZGVscy5tYXAoKG1vZGVsKSA9PiBtb2RlbC5jaGFubmVsKSlcbiAgY29uc3QgbWlzc2luZyA9IFJFUVVJUkVEX0NIQU5ORUxTLmZpbHRlcigoY2hhbm5lbCkgPT4gIXByZXNlbnQuaGFzKGNoYW5uZWwpKVxuICBpZiAobWlzc2luZy5sZW5ndGggPiAwKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHBhc3NlZDogZmFsc2UsXG4gICAgICBkaXZlcmdlbmNlczogbWlzc2luZy5tYXAoKGNoYW5uZWwpID0+ICh7XG4gICAgICAgIHRpZXI6ICd3ZWxsZm9ybWVkJyxcbiAgICAgICAgZGV0YWlsOiBgdGhlICR7Y2hhbm5lbH0gY2hhbm5lbCBpcyBhYnNlbnQg4oCUIHRoZSBwYXJpdHkgc2V0IGlzIGluY29tcGxldGVgLFxuICAgICAgICBjaGFubmVsczogW2NoYW5uZWxdLFxuICAgICAgfSkpLFxuICAgICAgd2FybmluZ3M6IFtdLFxuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGRpdmVyZ2VuY2VzOiBEaXZlcmdlbmNlW10gPSBbXG4gICAgLi4uaWRlbnRpdHlDb2xsaXNpb25EaXZlcmdlbmNlcyhtb2RlbHMpLFxuICAgIC4uLmNvbXBhcmVHcmFwaChtb2RlbHMpLFxuICAgIC4uLmNvbXBhcmVWYWx1ZXMobW9kZWxzKSxcbiAgICAuLi5jb21wYXJlR3JhbnRzKG1vZGVscyksXG4gICAgLi4uY29tcGFyZVNlY3JldHMobW9kZWxzKSxcbiAgICAuLi5vYXV0aERpdmVyZ2VuY2VzKG1vZGVscyksXG4gIF1cblxuICByZXR1cm4geyBwYXNzZWQ6IGRpdmVyZ2VuY2VzLmxlbmd0aCA9PT0gMCwgZGl2ZXJnZW5jZXMsIHdhcm5pbmdzOiBjb3NtZXRpY1dhcm5pbmdzKG1vZGVscykgfVxufVxuXG4vKiogUmVuZGVyIGEgZ2F0ZSByZXN1bHQgYXMgYSByZWxlYXNlIHJlcG9ydCDigJQgdGhlIGRpdmVyZ2VuY2VzLCB0aGVuIGFueSBjb3NtZXRpYyB3YXJuaW5ncy4gKi9cbmV4cG9ydCBjb25zdCBmb3JtYXRHYXRlUmVwb3J0ID0gKHJlc3VsdDogR2F0ZVJlc3VsdCk6IHN0cmluZyA9PiB7XG4gIGNvbnN0IGxpbmVzOiBzdHJpbmdbXSA9IFtdXG4gIGlmIChyZXN1bHQucGFzc2VkKSB7XG4gICAgbGluZXMucHVzaCgnUEFSSVRZIE9LIOKAlCBhbGwgY2hhbm5lbHMgYWdyZWUgb24gZ3JhcGgsIGxvYWQtYmVhcmluZyB2YWx1ZXMsIHBlcm1pc3Npb25zLCBhbmQgT0F1dGggY29uZm9ybWFuY2UuJylcbiAgfSBlbHNlIHtcbiAgICBsaW5lcy5wdXNoKGBQQVJJVFkgRkFJTEVEIOKAlCAke3Jlc3VsdC5kaXZlcmdlbmNlcy5sZW5ndGh9IGRpdmVyZ2VuY2Uocyk6YClcbiAgICBmb3IgKGNvbnN0IGRpdmVyZ2VuY2Ugb2YgcmVzdWx0LmRpdmVyZ2VuY2VzKSB7XG4gICAgICBsaW5lcy5wdXNoKGAgIFske2RpdmVyZ2VuY2UudGllcn1dICR7ZGl2ZXJnZW5jZS5kZXRhaWx9IOKAlCBkaXNhZ3JlZWluZzogJHtkaXZlcmdlbmNlLmNoYW5uZWxzLmpvaW4oJywgJyl9YClcbiAgICB9XG4gIH1cbiAgZm9yIChjb25zdCB3YXJuaW5nIG9mIHJlc3VsdC53YXJuaW5ncykgbGluZXMucHVzaChgICB3YXJuaW5nOiAke3dhcm5pbmd9YClcbiAgcmV0dXJuIGxpbmVzLmpvaW4oJ1xcbicpXG59XG4iXX0=