"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gate = exports.formatGateReport = exports.checkOAuthConformance = exports.compareGraph = exports.reduceTerraformShowJson = exports.reduceCloudFormation = exports.LOGS_BUCKET_ARN_PARAMETER = exports.HOSTED_DOMAIN_TENANT_TOKEN = exports.normaliseLogical = exports.REGION_TOKEN = exports.NO_HOSTED_DOMAIN = exports.ACCOUNT_TOKEN = void 0;
/**
 * The release-time CDK ↔ CFN ↔ Terraform parity gate. Reduces each distribution channel's
 * artifact to one comparable resource model and diffs them on three tiers (resource graph,
 * load-bearing values, permission semantics), plus secret-wiring and OAuth2/OIDC conformance.
 *
 * The surface here is pure — parsed object in, model/result out — so the gate logic is testable
 * with no cloud account. The I/O that loads a published template or a `terraform show -json`
 * file lives in the gate harness that drives this in CI.
 */
var model_1 = require("./model");
Object.defineProperty(exports, "ACCOUNT_TOKEN", { enumerable: true, get: function () { return model_1.ACCOUNT_TOKEN; } });
Object.defineProperty(exports, "NO_HOSTED_DOMAIN", { enumerable: true, get: function () { return model_1.NO_HOSTED_DOMAIN; } });
Object.defineProperty(exports, "REGION_TOKEN", { enumerable: true, get: function () { return model_1.REGION_TOKEN; } });
Object.defineProperty(exports, "normaliseLogical", { enumerable: true, get: function () { return model_1.normaliseLogical; } });
var canonical_1 = require("./canonical");
Object.defineProperty(exports, "HOSTED_DOMAIN_TENANT_TOKEN", { enumerable: true, get: function () { return canonical_1.HOSTED_DOMAIN_TENANT_TOKEN; } });
Object.defineProperty(exports, "LOGS_BUCKET_ARN_PARAMETER", { enumerable: true, get: function () { return canonical_1.LOGS_BUCKET_ARN_PARAMETER; } });
var cfn_reducer_1 = require("./cfn-reducer");
Object.defineProperty(exports, "reduceCloudFormation", { enumerable: true, get: function () { return cfn_reducer_1.reduceCloudFormation; } });
var terraform_reducer_1 = require("./terraform-reducer");
Object.defineProperty(exports, "reduceTerraformShowJson", { enumerable: true, get: function () { return terraform_reducer_1.reduceTerraformShowJson; } });
var compare_1 = require("./compare");
Object.defineProperty(exports, "compareGraph", { enumerable: true, get: function () { return compare_1.compareGraph; } });
var oauth_conformance_1 = require("./oauth-conformance");
Object.defineProperty(exports, "checkOAuthConformance", { enumerable: true, get: function () { return oauth_conformance_1.checkOAuthConformance; } });
var gate_1 = require("./gate");
Object.defineProperty(exports, "formatGateReport", { enumerable: true, get: function () { return gate_1.formatGateReport; } });
Object.defineProperty(exports, "gate", { enumerable: true, get: function () { return gate_1.gate; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQTs7Ozs7Ozs7R0FRRztBQUNILGlDQUF5RjtBQUFoRixzR0FBQSxhQUFhLE9BQUE7QUFBRSx5R0FBQSxnQkFBZ0IsT0FBQTtBQUFFLHFHQUFBLFlBQVksT0FBQTtBQUFFLHlHQUFBLGdCQUFnQixPQUFBO0FBZ0J4RSx5Q0FBbUY7QUFBMUUsdUhBQUEsMEJBQTBCLE9BQUE7QUFBRSxzSEFBQSx5QkFBeUIsT0FBQTtBQUM5RCw2Q0FBb0Q7QUFBM0MsbUhBQUEsb0JBQW9CLE9BQUE7QUFDN0IseURBQTZEO0FBQXBELDRIQUFBLHVCQUF1QixPQUFBO0FBQ2hDLHFDQUF3QztBQUEvQix1R0FBQSxZQUFZLE9BQUE7QUFDckIseURBQTJEO0FBQWxELDBIQUFBLHFCQUFxQixPQUFBO0FBRTlCLCtCQUErQztBQUF0Qyx3R0FBQSxnQkFBZ0IsT0FBQTtBQUFFLDRGQUFBLElBQUksT0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogVGhlIHJlbGVhc2UtdGltZSBDREsg4oaUIENGTiDihpQgVGVycmFmb3JtIHBhcml0eSBnYXRlLiBSZWR1Y2VzIGVhY2ggZGlzdHJpYnV0aW9uIGNoYW5uZWwnc1xuICogYXJ0aWZhY3QgdG8gb25lIGNvbXBhcmFibGUgcmVzb3VyY2UgbW9kZWwgYW5kIGRpZmZzIHRoZW0gb24gdGhyZWUgdGllcnMgKHJlc291cmNlIGdyYXBoLFxuICogbG9hZC1iZWFyaW5nIHZhbHVlcywgcGVybWlzc2lvbiBzZW1hbnRpY3MpLCBwbHVzIHNlY3JldC13aXJpbmcgYW5kIE9BdXRoMi9PSURDIGNvbmZvcm1hbmNlLlxuICpcbiAqIFRoZSBzdXJmYWNlIGhlcmUgaXMgcHVyZSDigJQgcGFyc2VkIG9iamVjdCBpbiwgbW9kZWwvcmVzdWx0IG91dCDigJQgc28gdGhlIGdhdGUgbG9naWMgaXMgdGVzdGFibGVcbiAqIHdpdGggbm8gY2xvdWQgYWNjb3VudC4gVGhlIEkvTyB0aGF0IGxvYWRzIGEgcHVibGlzaGVkIHRlbXBsYXRlIG9yIGEgYHRlcnJhZm9ybSBzaG93IC1qc29uYFxuICogZmlsZSBsaXZlcyBpbiB0aGUgZ2F0ZSBoYXJuZXNzIHRoYXQgZHJpdmVzIHRoaXMgaW4gQ0kuXG4gKi9cbmV4cG9ydCB7IEFDQ09VTlRfVE9LRU4sIE5PX0hPU1RFRF9ET01BSU4sIFJFR0lPTl9UT0tFTiwgbm9ybWFsaXNlTG9naWNhbCB9IGZyb20gJy4vbW9kZWwnXG5leHBvcnQgdHlwZSB7XG4gIENoYW5uZWwsXG4gIENoYW5uZWxNb2RlbCxcbiAgRGl2ZXJnZW5jZSxcbiAgRGl2ZXJnZW5jZVRpZXIsXG4gIEdhdGVSZXN1bHQsXG4gIExvYWRCZWFyaW5nVmFsdWVzLFxuICBPQXV0aENvbmZpZyxcbiAgT2lkY0Rpc2NvdmVyeSxcbiAgUGVybWlzc2lvbkdyYW50LFxuICBSZXNvdXJjZUVkZ2UsXG4gIFJlc291cmNlR3JhcGgsXG4gIFJlc291cmNlTm9kZSxcbiAgU2VjcmV0UmVmLFxufSBmcm9tICcuL21vZGVsJ1xuZXhwb3J0IHsgSE9TVEVEX0RPTUFJTl9URU5BTlRfVE9LRU4sIExPR1NfQlVDS0VUX0FSTl9QQVJBTUVURVIgfSBmcm9tICcuL2Nhbm9uaWNhbCdcbmV4cG9ydCB7IHJlZHVjZUNsb3VkRm9ybWF0aW9uIH0gZnJvbSAnLi9jZm4tcmVkdWNlcidcbmV4cG9ydCB7IHJlZHVjZVRlcnJhZm9ybVNob3dKc29uIH0gZnJvbSAnLi90ZXJyYWZvcm0tcmVkdWNlcidcbmV4cG9ydCB7IGNvbXBhcmVHcmFwaCB9IGZyb20gJy4vY29tcGFyZSdcbmV4cG9ydCB7IGNoZWNrT0F1dGhDb25mb3JtYW5jZSB9IGZyb20gJy4vb2F1dGgtY29uZm9ybWFuY2UnXG5leHBvcnQgdHlwZSB7IENvbmZvcm1hbmNlSXNzdWUgfSBmcm9tICcuL29hdXRoLWNvbmZvcm1hbmNlJ1xuZXhwb3J0IHsgZm9ybWF0R2F0ZVJlcG9ydCwgZ2F0ZSB9IGZyb20gJy4vZ2F0ZSdcbiJdfQ==