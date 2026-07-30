"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Edge / quality coverage for the apiable-gateway-role Terraform module, beyond the frozen
 * contract scenarios in the parity spec: provider/version pinning, reusable-module hygiene
 * (no provider/backend block), IAM policy-document version, and the leading-zero trust default.
 * Exercises the real module source (no copied policy logic).
 */
const fs = require("fs");
const path = require("path");
const cdk_gateway_role_1 = require("@apiable/cdk-gateway-role");
const MODULE_DIR = path.resolve(__dirname, '../terraform/apiable-gateway-role');
const moduleFile = (name) => fs.readFileSync(path.join(MODULE_DIR, name), 'utf8');
describe('apiable-gateway-role terraform module — provider + version pinning', () => {
    it('pins the AWS provider to hashicorp/aws ~> 5.0 and a minimum terraform version', () => {
        const versions = moduleFile('versions.tf');
        expect(versions).toMatch(/required_version\s*=\s*">=\s*1\.8\.0"/);
        expect(versions).toMatch(/source\s*=\s*"hashicorp\/aws"/);
        expect(versions).toMatch(/version\s*=\s*"~>\s*5\.0"/);
    });
});
describe('apiable-gateway-role terraform module — reusable-module hygiene', () => {
    it('declares no provider or backend block (the consuming root configures those)', () => {
        const all = fs
            .readdirSync(MODULE_DIR)
            .filter((f) => f.endsWith('.tf'))
            .map(moduleFile)
            .join('\n');
        expect(all).not.toMatch(/provider\s+"aws"\s*\{/);
        expect(all).not.toMatch(/backend\s+"/);
    });
    it('exposes exactly one output — the role ARN', () => {
        const outputs = moduleFile('outputs.tf');
        expect(outputs.match(/output\s+"/g)).toHaveLength(1);
        expect(outputs).toMatch(/output\s+"role_arn"[\s\S]*value\s*=\s*aws_iam_role\.this\.arn/);
    });
});
describe('apiable-gateway-role terraform module — IAM document + trust default', () => {
    it('stamps both IAM documents with the 2012-10-17 policy version', () => {
        const main = moduleFile('main.tf');
        expect(main.match(/Version\s*=\s*"2012-10-17"/g)).toHaveLength(2);
    });
    it('keeps the default trust account a 12-character string, preserving its leading zero', () => {
        const def = moduleFile('variables.tf').match(/default\s*=\s*"([^"]+)"/)?.[1];
        expect(def).toBe(cdk_gateway_role_1.DEFAULT_APIABLE_TRUST_ACCOUNT);
        expect(def).toHaveLength(12);
        expect(def?.startsWith('0')).toBe(true);
    });
    it('gives the no-widen validation a non-empty error message', () => {
        const vars = moduleFile('variables.tf');
        const msg = vars.match(/error_message\s*=\s*"([^"]+)"/)?.[1];
        expect(msg && msg.length).toBeGreaterThan(0);
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2F0ZXdheS1yb2xlLXRlcnJhZm9ybS5zcGVjLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiZ2F0ZXdheS1yb2xlLXRlcnJhZm9ybS5zcGVjLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUE7Ozs7O0dBS0c7QUFDSCx5QkFBd0I7QUFDeEIsNkJBQTRCO0FBQzVCLGdFQUF5RTtBQUV6RSxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLFNBQVMsRUFBRSxtQ0FBbUMsQ0FBQyxDQUFBO0FBQy9FLE1BQU0sVUFBVSxHQUFHLENBQUMsSUFBWSxFQUFVLEVBQUUsQ0FBQyxFQUFFLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLElBQUksQ0FBQyxFQUFFLE1BQU0sQ0FBQyxDQUFBO0FBRWpHLFFBQVEsQ0FBQyxvRUFBb0UsRUFBRSxHQUFHLEVBQUU7SUFDbEYsRUFBRSxDQUFDLCtFQUErRSxFQUFFLEdBQUcsRUFBRTtRQUN2RixNQUFNLFFBQVEsR0FBRyxVQUFVLENBQUMsYUFBYSxDQUFDLENBQUE7UUFDMUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFDLE9BQU8sQ0FBQyx1Q0FBdUMsQ0FBQyxDQUFBO1FBQ2pFLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQyxPQUFPLENBQUMsK0JBQStCLENBQUMsQ0FBQTtRQUN6RCxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUMsT0FBTyxDQUFDLDJCQUEyQixDQUFDLENBQUE7SUFDdkQsQ0FBQyxDQUFDLENBQUE7QUFDSixDQUFDLENBQUMsQ0FBQTtBQUVGLFFBQVEsQ0FBQyxpRUFBaUUsRUFBRSxHQUFHLEVBQUU7SUFDL0UsRUFBRSxDQUFDLDZFQUE2RSxFQUFFLEdBQUcsRUFBRTtRQUNyRixNQUFNLEdBQUcsR0FBRyxFQUFFO2FBQ1gsV0FBVyxDQUFDLFVBQVUsQ0FBQzthQUN2QixNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUM7YUFDaEMsR0FBRyxDQUFDLFVBQVUsQ0FBQzthQUNmLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUNiLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLHVCQUF1QixDQUFDLENBQUE7UUFDaEQsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFDLENBQUE7SUFDeEMsQ0FBQyxDQUFDLENBQUE7SUFFRixFQUFFLENBQUMsMkNBQTJDLEVBQUUsR0FBRyxFQUFFO1FBQ25ELE1BQU0sT0FBTyxHQUFHLFVBQVUsQ0FBQyxZQUFZLENBQUMsQ0FBQTtRQUN4QyxNQUFNLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUNwRCxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsT0FBTyxDQUFDLCtEQUErRCxDQUFDLENBQUE7SUFDMUYsQ0FBQyxDQUFDLENBQUE7QUFDSixDQUFDLENBQUMsQ0FBQTtBQUVGLFFBQVEsQ0FBQyxzRUFBc0UsRUFBRSxHQUFHLEVBQUU7SUFDcEYsRUFBRSxDQUFDLDhEQUE4RCxFQUFFLEdBQUcsRUFBRTtRQUN0RSxNQUFNLElBQUksR0FBRyxVQUFVLENBQUMsU0FBUyxDQUFDLENBQUE7UUFDbEMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsNkJBQTZCLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQTtJQUNuRSxDQUFDLENBQUMsQ0FBQTtJQUVGLEVBQUUsQ0FBQyxvRkFBb0YsRUFBRSxHQUFHLEVBQUU7UUFDNUYsTUFBTSxHQUFHLEdBQUcsVUFBVSxDQUFDLGNBQWMsQ0FBQyxDQUFDLEtBQUssQ0FBQyx5QkFBeUIsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFDNUUsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxnREFBNkIsQ0FBQyxDQUFBO1FBQy9DLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDNUIsTUFBTSxDQUFDLEdBQUcsRUFBRSxVQUFVLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUE7SUFDekMsQ0FBQyxDQUFDLENBQUE7SUFFRixFQUFFLENBQUMseURBQXlELEVBQUUsR0FBRyxFQUFFO1FBQ2pFLE1BQU0sSUFBSSxHQUFHLFVBQVUsQ0FBQyxjQUFjLENBQUMsQ0FBQTtRQUN2QyxNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLCtCQUErQixDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUM1RCxNQUFNLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUE7SUFDOUMsQ0FBQyxDQUFDLENBQUE7QUFDSixDQUFDLENBQUMsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogRWRnZSAvIHF1YWxpdHkgY292ZXJhZ2UgZm9yIHRoZSBhcGlhYmxlLWdhdGV3YXktcm9sZSBUZXJyYWZvcm0gbW9kdWxlLCBiZXlvbmQgdGhlIGZyb3plblxuICogY29udHJhY3Qgc2NlbmFyaW9zIGluIHRoZSBwYXJpdHkgc3BlYzogcHJvdmlkZXIvdmVyc2lvbiBwaW5uaW5nLCByZXVzYWJsZS1tb2R1bGUgaHlnaWVuZVxuICogKG5vIHByb3ZpZGVyL2JhY2tlbmQgYmxvY2spLCBJQU0gcG9saWN5LWRvY3VtZW50IHZlcnNpb24sIGFuZCB0aGUgbGVhZGluZy16ZXJvIHRydXN0IGRlZmF1bHQuXG4gKiBFeGVyY2lzZXMgdGhlIHJlYWwgbW9kdWxlIHNvdXJjZSAobm8gY29waWVkIHBvbGljeSBsb2dpYykuXG4gKi9cbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJ1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJ1xuaW1wb3J0IHsgREVGQVVMVF9BUElBQkxFX1RSVVNUX0FDQ09VTlQgfSBmcm9tICdAYXBpYWJsZS9jZGstZ2F0ZXdheS1yb2xlJ1xuXG5jb25zdCBNT0RVTEVfRElSID0gcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uL3RlcnJhZm9ybS9hcGlhYmxlLWdhdGV3YXktcm9sZScpXG5jb25zdCBtb2R1bGVGaWxlID0gKG5hbWU6IHN0cmluZyk6IHN0cmluZyA9PiBmcy5yZWFkRmlsZVN5bmMocGF0aC5qb2luKE1PRFVMRV9ESVIsIG5hbWUpLCAndXRmOCcpXG5cbmRlc2NyaWJlKCdhcGlhYmxlLWdhdGV3YXktcm9sZSB0ZXJyYWZvcm0gbW9kdWxlIOKAlCBwcm92aWRlciArIHZlcnNpb24gcGlubmluZycsICgpID0+IHtcbiAgaXQoJ3BpbnMgdGhlIEFXUyBwcm92aWRlciB0byBoYXNoaWNvcnAvYXdzIH4+IDUuMCBhbmQgYSBtaW5pbXVtIHRlcnJhZm9ybSB2ZXJzaW9uJywgKCkgPT4ge1xuICAgIGNvbnN0IHZlcnNpb25zID0gbW9kdWxlRmlsZSgndmVyc2lvbnMudGYnKVxuICAgIGV4cGVjdCh2ZXJzaW9ucykudG9NYXRjaCgvcmVxdWlyZWRfdmVyc2lvblxccyo9XFxzKlwiPj1cXHMqMVxcLjhcXC4wXCIvKVxuICAgIGV4cGVjdCh2ZXJzaW9ucykudG9NYXRjaCgvc291cmNlXFxzKj1cXHMqXCJoYXNoaWNvcnBcXC9hd3NcIi8pXG4gICAgZXhwZWN0KHZlcnNpb25zKS50b01hdGNoKC92ZXJzaW9uXFxzKj1cXHMqXCJ+Plxccyo1XFwuMFwiLylcbiAgfSlcbn0pXG5cbmRlc2NyaWJlKCdhcGlhYmxlLWdhdGV3YXktcm9sZSB0ZXJyYWZvcm0gbW9kdWxlIOKAlCByZXVzYWJsZS1tb2R1bGUgaHlnaWVuZScsICgpID0+IHtcbiAgaXQoJ2RlY2xhcmVzIG5vIHByb3ZpZGVyIG9yIGJhY2tlbmQgYmxvY2sgKHRoZSBjb25zdW1pbmcgcm9vdCBjb25maWd1cmVzIHRob3NlKScsICgpID0+IHtcbiAgICBjb25zdCBhbGwgPSBmc1xuICAgICAgLnJlYWRkaXJTeW5jKE1PRFVMRV9ESVIpXG4gICAgICAuZmlsdGVyKChmKSA9PiBmLmVuZHNXaXRoKCcudGYnKSlcbiAgICAgIC5tYXAobW9kdWxlRmlsZSlcbiAgICAgIC5qb2luKCdcXG4nKVxuICAgIGV4cGVjdChhbGwpLm5vdC50b01hdGNoKC9wcm92aWRlclxccytcImF3c1wiXFxzKlxcey8pXG4gICAgZXhwZWN0KGFsbCkubm90LnRvTWF0Y2goL2JhY2tlbmRcXHMrXCIvKVxuICB9KVxuXG4gIGl0KCdleHBvc2VzIGV4YWN0bHkgb25lIG91dHB1dCDigJQgdGhlIHJvbGUgQVJOJywgKCkgPT4ge1xuICAgIGNvbnN0IG91dHB1dHMgPSBtb2R1bGVGaWxlKCdvdXRwdXRzLnRmJylcbiAgICBleHBlY3Qob3V0cHV0cy5tYXRjaCgvb3V0cHV0XFxzK1wiL2cpKS50b0hhdmVMZW5ndGgoMSlcbiAgICBleHBlY3Qob3V0cHV0cykudG9NYXRjaCgvb3V0cHV0XFxzK1wicm9sZV9hcm5cIltcXHNcXFNdKnZhbHVlXFxzKj1cXHMqYXdzX2lhbV9yb2xlXFwudGhpc1xcLmFybi8pXG4gIH0pXG59KVxuXG5kZXNjcmliZSgnYXBpYWJsZS1nYXRld2F5LXJvbGUgdGVycmFmb3JtIG1vZHVsZSDigJQgSUFNIGRvY3VtZW50ICsgdHJ1c3QgZGVmYXVsdCcsICgpID0+IHtcbiAgaXQoJ3N0YW1wcyBib3RoIElBTSBkb2N1bWVudHMgd2l0aCB0aGUgMjAxMi0xMC0xNyBwb2xpY3kgdmVyc2lvbicsICgpID0+IHtcbiAgICBjb25zdCBtYWluID0gbW9kdWxlRmlsZSgnbWFpbi50ZicpXG4gICAgZXhwZWN0KG1haW4ubWF0Y2goL1ZlcnNpb25cXHMqPVxccypcIjIwMTItMTAtMTdcIi9nKSkudG9IYXZlTGVuZ3RoKDIpXG4gIH0pXG5cbiAgaXQoJ2tlZXBzIHRoZSBkZWZhdWx0IHRydXN0IGFjY291bnQgYSAxMi1jaGFyYWN0ZXIgc3RyaW5nLCBwcmVzZXJ2aW5nIGl0cyBsZWFkaW5nIHplcm8nLCAoKSA9PiB7XG4gICAgY29uc3QgZGVmID0gbW9kdWxlRmlsZSgndmFyaWFibGVzLnRmJykubWF0Y2goL2RlZmF1bHRcXHMqPVxccypcIihbXlwiXSspXCIvKT8uWzFdXG4gICAgZXhwZWN0KGRlZikudG9CZShERUZBVUxUX0FQSUFCTEVfVFJVU1RfQUNDT1VOVClcbiAgICBleHBlY3QoZGVmKS50b0hhdmVMZW5ndGgoMTIpXG4gICAgZXhwZWN0KGRlZj8uc3RhcnRzV2l0aCgnMCcpKS50b0JlKHRydWUpXG4gIH0pXG5cbiAgaXQoJ2dpdmVzIHRoZSBuby13aWRlbiB2YWxpZGF0aW9uIGEgbm9uLWVtcHR5IGVycm9yIG1lc3NhZ2UnLCAoKSA9PiB7XG4gICAgY29uc3QgdmFycyA9IG1vZHVsZUZpbGUoJ3ZhcmlhYmxlcy50ZicpXG4gICAgY29uc3QgbXNnID0gdmFycy5tYXRjaCgvZXJyb3JfbWVzc2FnZVxccyo9XFxzKlwiKFteXCJdKylcIi8pPy5bMV1cbiAgICBleHBlY3QobXNnICYmIG1zZy5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbigwKVxuICB9KVxufSlcbiJdfQ==