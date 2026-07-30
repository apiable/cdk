"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Supplementary coverage for the Console-explainer resource enumeration (Story 013-1-12) — edge
 * cases and integration scenarios beyond the frozen acceptance contract: multi-resource constructs,
 * the content-key collision guard, unmapped resource types, token-named resources, per-component key
 * namespacing, and empty stacks. Synth-level; no live AWS account. Structure half only — no renderer,
 * no markdown content.
 */
const cdk = require("aws-cdk-lib");
const iam = require("aws-cdk-lib/aws-iam");
const s3 = require("aws-cdk-lib/aws-s3");
const sns = require("aws-cdk-lib/aws-sns");
const cdk_logs_bucket_1 = require("@apiable/cdk-logs-bucket");
const cdk_console_explainer_1 = require("@apiable/cdk-console-explainer");
const ENV = { account: '111111111111', region: 'eu-central-1' };
const stackOf = (build, id = 'S') => {
    class Wrapper extends cdk.Stack {
        constructor(scope) {
            super(scope, id, { env: ENV });
            build(this);
        }
    }
    return new Wrapper(new cdk.App());
};
describe('multi-resource construct (logs-bucket)', () => {
    const enumeration = () => (0, cdk_console_explainer_1.describeResources)(new cdk_logs_bucket_1.LogsBucketStack(new cdk.App(), 'LB', { name: 'staging', env: ENV }), cdk_logs_bucket_1.LOGS_BUCKET_COMPONENT)
        .resources;
    it('enumerates the bucket, its resource policy, the write role, the inline write policy, and all three outputs', () => {
        const byKind = enumeration().reduce((acc, d) => {
            acc[d.kind] = (acc[d.kind] ?? 0) + 1;
            return acc;
        }, {});
        // the bucket's resource policy (the cross-account write grant) surfaces as its own kind — it is
        // security-load-bearing and must not silently drop from the audit
        expect(byKind).toEqual({ bucket: 1, 'bucket-policy': 1, 'iam-role': 1, 'iam-policy': 1, 'resource-output': 3 });
    });
    it('surfaces the bucket policy carrying its raw CFN type', () => {
        const bucketPolicy = enumeration().find((d) => d.kind === 'bucket-policy');
        expect(bucketPolicy).toBeDefined();
        expect(bucketPolicy?.cfnType).toBe('AWS::S3::BucketPolicy');
    });
    it('derives an s3 deep-link for the bucket and an iam deep-link for the write role, by physical name', () => {
        const descriptors = enumeration();
        expect(descriptors.find((d) => d.kind === 'bucket')?.consoleDeepLink).toEqual({
            service: 's3',
            resourcePath: 'apiable-logs-staging',
        });
        expect(descriptors.find((d) => d.kind === 'iam-role')?.consoleDeepLink).toEqual({
            service: 'iam',
            resourcePath: 'apiable-logs-staging-s3-role',
        });
    });
    it('keeps every content key unique across the richer resource set', () => {
        const keys = enumeration().map((d) => d.contentKey);
        expect(new Set(keys).size).toBe(keys.length);
    });
});
describe('content-key collision guard', () => {
    it('fails loudly when two enumerated resources would collapse to the same content key', () => {
        // two roles whose names differ only by a character the key segment drops collide after kebab-collapse
        const build = (scope) => {
            new iam.Role(scope, 'RoleA', { assumedBy: new iam.AccountPrincipal('222222222222'), roleName: 'apiable.role' });
            new iam.Role(scope, 'RoleB', { assumedBy: new iam.AccountPrincipal('222222222222'), roleName: 'apiable-role' });
        };
        expect(() => (0, cdk_console_explainer_1.describeResources)(stackOf(build), 'collide')).toThrow(/duplicate content key/);
    });
});
describe('unmapped resource types', () => {
    it('surfaces a synthesized resource of an unmodelled type as a generic descriptor carrying its raw CFN type — never drops it', () => {
        const descriptors = (0, cdk_console_explainer_1.describeResources)(stackOf((scope) => {
            new sns.Topic(scope, 'Topic', { topicName: 'unmodelled' });
        }), 'misc').resources;
        // an SNS topic is not a kind the explainer models by name, but it must still appear in the audit —
        // it surfaces as `other` carrying the raw AWS::* type, never silently vanishing
        const topic = descriptors.find((d) => d.cfnType === 'AWS::SNS::Topic');
        expect(topic).toBeDefined();
        expect(topic?.kind).toBe('other');
        // no console deep-link is fabricated for a kind the explainer has no console mapping for
        expect(topic).not.toHaveProperty('consoleDeepLink');
    });
});
describe('token-named resource', () => {
    it('falls back to the logical id and omits the deep-link when the physical name is an unresolved token', () => {
        // a bucket with no explicit bucketName synthesizes without a Name property (a token at synth time)
        const descriptors = (0, cdk_console_explainer_1.describeResources)(stackOf((scope) => {
            new s3.Bucket(scope, 'AutoNamedBucket');
        }), 'auto').resources;
        const bucket = descriptors.find((d) => d.kind === 'bucket');
        expect(bucket).toBeDefined();
        // identity falls back to the synthesized logical id, not a fabricated name
        expect(bucket?.identity).toMatch(/AutoNamedBucket/);
        expect(bucket).not.toHaveProperty('consoleDeepLink');
    });
});
describe('per-component key namespacing', () => {
    it('namespaces content keys under the supplied component so two constructs never share a key', () => {
        const build = (scope) => {
            new iam.Role(scope, 'R', { assumedBy: new iam.AccountPrincipal('222222222222'), roleName: 'shared-name' });
        };
        const a = (0, cdk_console_explainer_1.describeResources)(stackOf(build, 'A'), 'component-a').resources;
        const b = (0, cdk_console_explainer_1.describeResources)(stackOf(build, 'B'), 'component-b').resources;
        expect(a[0].contentKey).toBe('component-a/iam-role/shared-name');
        expect(b[0].contentKey).toBe('component-b/iam-role/shared-name');
        expect(a[0].contentKey).not.toBe(b[0].contentKey);
    });
});
describe('empty stack', () => {
    it('returns an empty enumeration for a stack that creates no enumerable resources', () => {
        const enumeration = (0, cdk_console_explainer_1.describeResources)(stackOf(() => undefined), 'empty');
        expect(enumeration.component).toBe('empty');
        expect(enumeration.resources).toEqual([]);
    });
});
describe('component validation', () => {
    it('fails loudly on a malformed component segment rather than producing unaddressable content keys', () => {
        const build = (scope) => {
            new iam.Role(scope, 'R', { assumedBy: new iam.AccountPrincipal('222222222222'), roleName: 'a-role' });
        };
        for (const bad of ['', 'Has Space', 'UPPER', 'slash/inside', '-leading', 'trailing-']) {
            expect(() => (0, cdk_console_explainer_1.describeResources)(stackOf(build), bad)).toThrow(/component/);
        }
    });
    it('accepts a well-formed lower-kebab component', () => {
        const build = (scope) => {
            new iam.Role(scope, 'R', { assumedBy: new iam.AccountPrincipal('222222222222'), roleName: 'a-role' });
        };
        expect(() => (0, cdk_console_explainer_1.describeResources)(stackOf(build), 'gateway-role')).not.toThrow();
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uc29sZS1leHBsYWluZXIuc3BlYy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNvbnNvbGUtZXhwbGFpbmVyLnNwZWMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQTs7Ozs7O0dBTUc7QUFDSCxtQ0FBa0M7QUFFbEMsMkNBQTBDO0FBQzFDLHlDQUF3QztBQUN4QywyQ0FBMEM7QUFDMUMsOERBQWlGO0FBQ2pGLDBFQUFzRjtBQUV0RixNQUFNLEdBQUcsR0FBRyxFQUFFLE9BQU8sRUFBRSxjQUFjLEVBQUUsTUFBTSxFQUFFLGNBQWMsRUFBRSxDQUFBO0FBRS9ELE1BQU0sT0FBTyxHQUFHLENBQUMsS0FBaUMsRUFBRSxFQUFFLEdBQUcsR0FBRyxFQUFhLEVBQUU7SUFDekUsTUFBTSxPQUFRLFNBQVEsR0FBRyxDQUFDLEtBQUs7UUFDN0IsWUFBWSxLQUFnQjtZQUMxQixLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFBO1lBQzlCLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUNiLENBQUM7S0FDRjtJQUNELE9BQU8sSUFBSSxPQUFPLENBQUMsSUFBSSxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQTtBQUNuQyxDQUFDLENBQUE7QUFFRCxRQUFRLENBQUMsd0NBQXdDLEVBQUUsR0FBRyxFQUFFO0lBQ3RELE1BQU0sV0FBVyxHQUFHLEdBQWtDLEVBQUUsQ0FDdEQsSUFBQSx5Q0FBaUIsRUFBQyxJQUFJLGlDQUFlLENBQUMsSUFBSSxHQUFHLENBQUMsR0FBRyxFQUFFLEVBQUUsSUFBSSxFQUFFLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLENBQUMsRUFBRSx1Q0FBcUIsQ0FBQztTQUM5RyxTQUFTLENBQUE7SUFFZCxFQUFFLENBQUMsNEdBQTRHLEVBQUUsR0FBRyxFQUFFO1FBQ3BILE1BQU0sTUFBTSxHQUFHLFdBQVcsRUFBRSxD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QUFLLEVBQUUsR0FBRyxFQUFFLEVBQUUsU0FBUyxFQUFFLElBQUksR0FBRyxDQUFDLGdCQUFnQixDQUFDLGNBQWMsQ0FBQyxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsQ0FBQyxDQUFBO1FBQ3ZHLENBQUMsQ0FBQTtRQUNELEtBQUssTUFBTSxHQUFHLElBQUksQ0FBQyxFQUFFLEVBQUUsV0FBVyxFQUFFLE9BQU8sRUFBRSxjQUFjLEVBQUUsVUFBVSxFQUFFLFdBQVcsQ0FBQyxFQUFFLENBQUM7WUFDdEYsTUFBTSxDQUFDLEdBQUcsRUFBRSxDQUFDLElBQUEseUNBQWlCLEVBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxDQUFBO1FBQzNFLENBQUM7SUFDSCxDQUFDLENBQUMsQ0FBQTtJQUVGLEVBQUUsQ0FBQyw2Q0FBNkMsRUFBRSxHQUFHLEVBQUU7UUFDckQsTUFBTSxLQUFLLEdBQUcsQ0FBQyxLQUFnQixFQUFRLEVBQUU7WUFDdkMsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLEtBQUssRUFBRSxHQUFHLEVBQUUsRUFBRSxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsZ0JBQWdCLENBQUMsY0FBYyxDQUFDLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxDQUFDLENBQUE7UUFDdkcsQ0FBQyxDQUFBO1FBQ0QsTUFBTSxDQUFDLEdBQUcsRUFBRSxDQUFDLElBQUEseUNBQWlCLEVBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUFFLGNBQWMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLE9BQU8sRUFBRSxDQUFBO0lBQy9FLENBQUMsQ0FBQyxDQUFBO0FBQ0osQ0FBQyxDQUFDLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFN1cHBsZW1lbnRhcnkgY292ZXJhZ2UgZm9yIHRoZSBDb25zb2xlLWV4cGxhaW5lciByZXNvdXJjZSBlbnVtZXJhdGlvbiAoU3RvcnkgMDEzLTEtMTIpIOKAlCBlZGdlXG4gKiBjYXNlcyBhbmQgaW50ZWdyYXRpb24gc2NlbmFyaW9zIGJleW9uZCB0aGUgZnJvemVuIGFjY2VwdGFuY2UgY29udHJhY3Q6IG11bHRpLXJlc291cmNlIGNvbnN0cnVjdHMsXG4gKiB0aGUgY29udGVudC1rZXkgY29sbGlzaW9uIGd1YXJkLCB1bm1hcHBlZCByZXNvdXJjZSB0eXBlcywgdG9rZW4tbmFtZWQgcmVzb3VyY2VzLCBwZXItY29tcG9uZW50IGtleVxuICogbmFtZXNwYWNpbmcsIGFuZCBlbXB0eSBzdGFja3MuIFN5bnRoLWxldmVsOyBubyBsaXZlIEFXUyBhY2NvdW50LiBTdHJ1Y3R1cmUgaGFsZiBvbmx5IOKAlCBubyByZW5kZXJlcixcbiAqIG5vIG1hcmtkb3duIGNvbnRlbnQuXG4gKi9cbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYidcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSdcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMydcbmltcG9ydCAqIGFzIHNucyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc25zJ1xuaW1wb3J0IHsgTG9nc0J1Y2tldFN0YWNrLCBMT0dTX0JVQ0tFVF9DT01QT05FTlQgfSBmcm9tICdAYXBpYWJsZS9jZGstbG9ncy1idWNrZXQnXG5pbXBvcnQgeyBkZXNjcmliZVJlc291cmNlcywgUmVzb3VyY2VEZXNjcmlwdG9yIH0gZnJvbSAnQGFwaWFibGUvY2RrLWNvbnNvbGUtZXhwbGFpbmVyJ1xuXG5jb25zdCBFTlYgPSB7IGFjY291bnQ6ICcxMTExMTExMTExMTEnLCByZWdpb246ICdldS1jZW50cmFsLTEnIH1cblxuY29uc3Qgc3RhY2tPZiA9IChidWlsZDogKHNjb3BlOiBDb25zdHJ1Y3QpID0+IHZvaWQsIGlkID0gJ1MnKTogY2RrLlN0YWNrID0+IHtcbiAgY2xhc3MgV3JhcHBlciBleHRlbmRzIGNkay5TdGFjayB7XG4gICAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCkge1xuICAgICAgc3VwZXIoc2NvcGUsIGlkLCB7IGVudjogRU5WIH0pXG4gICAgICBidWlsZCh0aGlzKVxuICAgIH1cbiAgfVxuICByZXR1cm4gbmV3IFdyYXBwZXIobmV3IGNkay5BcHAoKSlcbn1cblxuZGVzY3JpYmUoJ211bHRpLXJlc291cmNlIGNvbnN0cnVjdCAobG9ncy1idWNrZXQpJywgKCkgPT4ge1xuICBjb25zdCBlbnVtZXJhdGlvbiA9ICgpOiByZWFkb25seSBSZXNvdXJjZURlc2NyaXB0b3JbXSA9PlxuICAgIGRlc2NyaWJlUmVzb3VyY2VzKG5ldyBMb2dzQnVja2V0U3RhY2sobmV3IGNkay5BcHAoKSwgJ0xCJywgeyBuYW1lOiAnc3RhZ2luZycsIGVudjogRU5WIH0pLCBMT0dTX0JVQ0tFVF9DT01QT05FTlQpXG4gICAgICAucmVzb3VyY2VzXG5cbiAgaXQoJ2VudW1lcmF0ZXMgdGhlIGJ1Y2tldCwgaXRzIHJlc291cmNlIHBvbGljeSwgdGhlIHdyaXRlIHJvbGUsIHRoZSBpbmxpbmUgd3JpdGUgcG9saWN5LCBhbmQgYWxsIHRocmVlIG91dHB1dHMnLCAoKSA9PiB7XG4gICAgY29uc3QgYnlLaW5kID0gZW51bWVyYXRpb24oKS5yZWR1Y2U8UmVjb3JkPHN0cmluZywgbnVtYmVyPj4oKGFjYywgZCkgPT4ge1xuICAgICAgYWNjW2Qua2luZF0gPSAoYWNjW2Qua2luZF0gPz8gMCkgKyAxXG4gICAgICByZXR1cm4gYWNjXG4gICAgfSwge30pXG4gICAgLy8gdGhlIGJ1Y2tldCdzIHJlc291cmNlIHBvbGljeSAodGhlIGNyb3NzLWFjY291bnQgd3JpdGUgZ3JhbnQpIHN1cmZhY2VzIGFzIGl0cyBvd24ga2luZCDigJQgaXQgaXNcbiAgICAvLyBzZWN1cml0eS1sb2FkLWJlYXJpbmcgYW5kIG11c3Qgbm90IHNpbGVudGx5IGRyb3AgZnJvbSB0aGUgYXVkaXRcbiAgICBleHBlY3QoYnlLaW5kKS50b0VxdWFsKHsgYnVja2V0OiAxLCAnYnVja2V0LXBvbGljeSc6IDEsICdpYW0tcm9sZSc6IDEsICdpYW0tcG9saWN5JzogMSwgJ3Jlc291cmNlLW91dHB1dCc6IDMgfSlcbiAgfSlcblxuICBpdCgnc3VyZmFjZXMgdGhlIGJ1Y2tldCBwb2xpY3kgY2FycnlpbmcgaXRzIHJhdyBDRk4gdHlwZScsICgpID0+IHtcbiAgICBjb25zdCBidWNrZXRQb2xpY3kgPSBlbnVtZXJhdGlvbigpLmZpbmQoKGQpID0+IGQua2luZCA9PT0gJ2J1Y2tldC1wb2xpY3knKVxuICAgIGV4cGVjdChidWNrZXRQb2xpY3kpLnRvQmVEZWZpbmVkKClcbiAgICBleHBlY3QoYnVja2V0UG9saWN5Py5jZm5UeXBlKS50b0JlKCdBV1M6OlMzOjpCdWNrZXRQb2xpY3knKVxuICB9KVxuXG4gIGl0KCdkZXJpdmVzIGFuIHMzIGRlZXAtbGluayBmb3IgdGhlIGJ1Y2tldCBhbmQgYW4gaWFtIGRlZXAtbGluayBmb3IgdGhlIHdyaXRlIHJvbGUsIGJ5IHBoeXNpY2FsIG5hbWUnLCAoKSA9PiB7XG4gICAgY29uc3QgZGVzY3JpcHRvcnMgPSBlbnVtZXJhdGlvbigpXG4gICAgZXhwZWN0KGRlc2NyaXB0b3JzLmZpbmQoKGQpID0+IGQua2luZCA9PT0gJ2J1Y2tldCcpPy5jb25zb2xlRGVlcExpbmspLnRvRXF1YWwoe1xuICAgICAgc2VydmljZTogJ3MzJyxcbiAgICAgIHJlc291cmNlUGF0aDogJ2FwaWFibGUtbG9ncy1zdGFnaW5nJyxcbiAgICB9KVxuICAgIGV4cGVjdChkZXNjcmlwdG9ycy5maW5kKChkKSA9PiBkLmtpbmQgPT09ICdpYW0tcm9sZScpPy5jb25zb2xlRGVlcExpbmspLnRvRXF1YWwoe1xuICAgICAgc2VydmljZTogJ2lhbScsXG4gICAgICByZXNvdXJjZVBhdGg6ICdhcGlhYmxlLWxvZ3Mtc3RhZ2luZy1zMy1yb2xlJyxcbiAgICB9KVxuICB9KVxuXG4gIGl0KCdrZWVwcyBldmVyeSBjb250ZW50IGtleSB1bmlxdWUgYWNyb3NzIHRoZSByaWNoZXIgcmVzb3VyY2Ugc2V0JywgKCkgPT4ge1xuICAgIGNvbnN0IGtleXMgPSBlbnVtZXJhdGlvbigpLm1hcCgoZCkgPT4gZC5jb250ZW50S2V5KVxuICAgIGV4cGVjdChuZXcgU2V0KGtleXMpLnNpemUpLnRvQmUoa2V5cy5sZW5ndGgpXG4gIH0pXG59KVxuXG5kZXNjcmliZSgnY29udGVudC1rZXkgY29sbGlzaW9uIGd1YXJkJywgKCkgPT4ge1xuICBpdCgnZmFpbHMgbG91ZGx5IHdoZW4gdHdvIGVudW1lcmF0ZWQgcmVzb3VyY2VzIHdvdWxkIGNvbGxhcHNlIHRvIHRoZSBzYW1lIGNvbnRlbnQga2V5JywgKCkgPT4ge1xuICAgIC8vIHR3byByb2xlcyB3aG9zZSBuYW1lcyBkaWZmZXIgb25seSBieSBhIGNoYXJhY3RlciB0aGUga2V5IHNlZ21lbnQgZHJvcHMgY29sbGlkZSBhZnRlciBrZWJhYi1jb2xsYXBzZVxuICAgIGNvbnN0IGJ1aWxkID0gKHNjb3BlOiBDb25zdHJ1Y3QpOiB2b2lkID0+IHtcbiAgICAgIG5ldyBpYW0uUm9sZShzY29wZSwgJ1JvbGVBJywgeyBhc3N1bWVkQnk6IG5ldyBpYW0uQWNjb3VudFByaW5jaXBhbCgnMjIyMjIyMjIyMjIyJyksIHJvbGVOYW1lOiAnYXBpYWJsZS5yb2xlJyB9KVxuICAgICAgbmV3IGlhbS5Sb2xlKHNjb3BlLCAnUm9sZUInLCB7IGFzc3VtZWRCeTogbmV3IGlhbS5BY2NvdW50UHJpbmNpcGFsKCcyMjIyMjIyMjIyMjInKSwgcm9sZU5hbWU6ICdhcGlhYmxlLXJvbGUnIH0pXG4gICAgfVxuICAgIGV4cGVjdCgoKSA9PiBkZXNjcmliZVJlc291cmNlcyhzdGFja09mKGJ1aWxkKSwgJ2NvbGxpZGUnKSkudG9UaHJvdygvZHVwbGljYXRlIGNvbnRlbnQga2V5LylcbiAgfSlcbn0pXG5cbmRlc2NyaWJlKCd1bm1hcHBlZCByZXNvdXJjZSB0eXBlcycsICgpID0+IHtcbiAgaXQoJ3N1cmZhY2VzIGEgc3ludGhlc2l6ZWQgcmVzb3VyY2Ugb2YgYW4gdW5tb2RlbGxlZCB0eXBlIGFzIGEgZ2VuZXJpYyBkZXNjcmlwdG9yIGNhcnJ5aW5nIGl0cyByYXcgQ0ZOIHR5cGUg4oCUIG5ldmVyIGRyb3BzIGl0JywgKCkgPT4ge1xuICAgIGNvbnN0IGRlc2NyaXB0b3JzID0gZGVzY3JpYmVSZXNvdXJjZXMoXG4gICAgICBzdGFja09mKChzY29wZSkgPT4ge1xuICAgICAgICBuZXcgc25zLlRvcGljKHNjb3BlLCAnVG9waWMnLCB7IHRvcGljTmFtZTogJ3VubW9kZWxsZWQnIH0pXG4gICAgICB9KSxcbiAgICAgICdtaXNjJyxcbiAgICApLnJlc291cmNlc1xuICAgIC8vIGFuIFNOUyB0b3BpYyBpcyBub3QgYSBraW5kIHRoZSBleHBsYWluZXIgbW9kZWxzIGJ5IG5hbWUsIGJ1dCBpdCBtdXN0IHN0aWxsIGFwcGVhciBpbiB0aGUgYXVkaXQg4oCUXG4gICAgLy8gaXQgc3VyZmFjZXMgYXMgYG90aGVyYCBjYXJyeWluZyB0aGUgcmF3IEFXUzo6KiB0eXBlLCBuZXZlciBzaWxlbnRseSB2YW5pc2hpbmdcbiAgICBjb25zdCB0b3BpYyA9IGRlc2NyaXB0b3JzLmZpbmQoKGQpID0+IGQuY2ZuVHlwZSA9PT0gJ0FXUzo6U05TOjpUb3BpYycpXG4gICAgZXhwZWN0KHRvcGljKS50b0JlRGVmaW5lZCgpXG4gICAgZXhwZWN0KHRvcGljPy5raW5kKS50b0JlKCdvdGhlcicpXG4gICAgLy8gbm8gY29uc29sZSBkZWVwLWxpbmsgaXMgZmFicmljYXRlZCBmb3IgYSBraW5kIHRoZSBleHBsYWluZXIgaGFzIG5vIGNvbnNvbGUgbWFwcGluZyBmb3JcbiAgICBleHBlY3QodG9waWMpLm5vdC50b0hhdmVQcm9wZXJ0eSgnY29uc29sZURlZXBMaW5rJylcbiAgfSlcbn0pXG5cbmRlc2NyaWJlKCd0b2tlbi1uYW1lZCByZXNvdXJjZScsICgpID0+IHtcbiAgaXQoJ2ZhbGxzIGJhY2sgdG8gdGhlIGxvZ2ljYWwgaWQgYW5kIG9taXRzIHRoZSBkZWVwLWxpbmsgd2hlbiB0aGUgcGh5c2ljYWwgbmFtZSBpcyBhbiB1bnJlc29sdmVkIHRva2VuJywgKCkgPT4ge1xuICAgIC8vIGEgYnVja2V0IHdpdGggbm8gZXhwbGljaXQgYnVja2V0TmFtZSBzeW50aGVzaXplcyB3aXRob3V0IGEgTmFtZSBwcm9wZXJ0eSAoYSB0b2tlbiBhdCBzeW50aCB0aW1lKVxuICAgIGNvbnN0IGRlc2NyaXB0b3JzID0gZGVzY3JpYmVSZXNvdXJjZXMoXG4gICAgICBzdGFja09mKChzY29wZSkgPT4ge1xuICAgICAgICBuZXcgczMuQnVja2V0KHNjb3BlLCAnQXV0b05hbWVkQnVja2V0JylcbiAgICAgIH0pLFxuICAgICAgJ2F1dG8nLFxuICAgICkucmVzb3VyY2VzXG4gICAgY29uc3QgYnVja2V0ID0gZGVzY3JpcHRvcnMuZmluZCgoZCkgPT4gZC5raW5kID09PSAnYnVja2V0JylcbiAgICBleHBlY3QoYnVja2V0KS50b0JlRGVmaW5lZCgpXG4gICAgLy8gaWRlbnRpdHkgZmFsbHMgYmFjayB0byB0aGUgc3ludGhlc2l6ZWQgbG9naWNhbCBpZCwgbm90IGEgZmFicmljYXRlZCBuYW1lXG4gICAgZXhwZWN0KGJ1Y2tldD8uaWRlbnRpdHkpLnRvTWF0Y2goL0F1dG9OYW1lZEJ1Y2tldC8pXG4gICAgZXhwZWN0KGJ1Y2tldCkubm90LnRvSGF2ZVByb3BlcnR5KCdjb25zb2xlRGVlcExpbmsnKVxuICB9KVxufSlcblxuZGVzY3JpYmUoJ3Blci1jb21wb25lbnQga2V5IG5hbWVzcGFjaW5nJywgKCkgPT4ge1xuICBpdCgnbmFtZXNwYWNlcyBjb250ZW50IGtleXMgdW5kZXIgdGhlIHN1cHBsaWVkIGNvbXBvbmVudCBzbyB0d28gY29uc3RydWN0cyBuZXZlciBzaGFyZSBhIGtleScsICgpID0+IHtcbiAgICBjb25zdCBidWlsZCA9IChzY29wZTogQ29uc3RydWN0KTogdm9pZCA9PiB7XG4gICAgICBuZXcgaWFtLlJvbGUoc2NvcGUsICdSJywgeyBhc3N1bWVkQnk6IG5ldyBpYW0uQWNjb3VudFByaW5jaXBhbCgnMjIyMjIyMjIyMjIyJyksIHJvbGVOYW1lOiAnc2hhcmVkLW5hbWUnIH0pXG4gICAgfVxuICAgIGNvbnN0IGEgPSBkZXNjcmliZVJlc291cmNlcyhzdGFja09mKGJ1aWxkLCAnQScpLCAnY29tcG9uZW50LWEnKS5yZXNvdXJjZXNcbiAgICBjb25zdCBiID0gZGVzY3JpYmVSZXNvdXJjZXMoc3RhY2tPZihidWlsZCwgJ0InKSwgJ2NvbXBvbmVudC1iJykucmVzb3VyY2VzXG4gICAgZXhwZWN0KGFbMF0uY29udGVudEtleSkudG9CZSgnY29tcG9uZW50LWEvaWFtLXJvbGUvc2hhcmVkLW5hbWUnKVxuICAgIGV4cGVjdChiWzBdLmNvbnRlbnRLZXkpLnRvQmUoJ2NvbXBvbmVudC1iL2lhbS1yb2xlL3NoYXJlZC1uYW1lJylcbiAgICBleHBlY3QoYVswXS5jb250ZW50S2V5KS5ub3QudG9CZShiWzBdLmNvbnRlbnRLZXkpXG4gIH0pXG59KVxuXG5kZXNjcmliZSgnZW1wdHkgc3RhY2snLCAoKSA9PiB7XG4gIGl0KCdyZXR1cm5zIGFuIGVtcHR5IGVudW1lcmF0aW9uIGZvciBhIHN0YWNrIHRoYXQgY3JlYXRlcyBubyBlbnVtZXJhYmxlIHJlc291cmNlcycsICgpID0+IHtcbiAgICBjb25zdCBlbnVtZXJhdGlvbiA9IGRlc2NyaWJlUmVzb3VyY2VzKHN0YWNrT2YoKCkgPT4gdW5kZWZpbmVkKSwgJ2VtcHR5JylcbiAgICBleHBlY3QoZW51bWVyYXRpb24uY29tcG9uZW50KS50b0JlKCdlbXB0eScpXG4gICAgZXhwZWN0KGVudW1lcmF0aW9uLnJlc291cmNlcykudG9FcXVhbChbXSlcbiAgfSlcbn0pXG5cbmRlc2NyaWJlKCdjb21wb25lbnQgdmFsaWRhdGlvbicsICgpID0+IHtcbiAgaXQoJ2ZhaWxzIGxvdWRseSBvbiBhIG1hbGZvcm1lZCBjb21wb25lbnQgc2VnbWVudCByYXRoZXIgdGhhbiBwcm9kdWNpbmcgdW5hZGRyZXNzYWJsZSBjb250ZW50IGtleXMnLCAoKSA9PiB7XG4gICAgY29uc3QgYnVpbGQgPSAoc2NvcGU6IENvbnN0cnVjdCk6IHZvaWQgPT4ge1xuICAgICAgbmV3IGlhbS5Sb2xlKHNjb3BlLCAnUicsIHsgYXNzdW1lZEJ5OiBuZXcgaWFtLkFjY291bnRQcmluY2lwYWwoJzIyMjIyMjIyMjIyMicpLCByb2xlTmFtZTogJ2Etcm9sZScgfSlcbiAgICB9XG4gICAgZm9yIChjb25zdCBiYWQgb2YgWycnLCAnSGFzIFNwYWNlJywgJ1VQUEVSJywgJ3NsYXNoL2luc2lkZScsICctbGVhZGluZycsICd0cmFpbGluZy0nXSkge1xuICAgICAgZXhwZWN0KCgpID0+IGRlc2NyaWJlUmVzb3VyY2VzKHN0YWNrT2YoYnVpbGQpLCBiYWQpKS50b1Rocm93KC9jb21wb25lbnQvKVxuICAgIH1cbiAgfSlcblxuICBpdCgnYWNjZXB0cyBhIHdlbGwtZm9ybWVkIGxvd2VyLWtlYmFiIGNvbXBvbmVudCcsICgpID0+IHtcbiAgICBjb25zdCBidWlsZCA9IChzY29wZTogQ29uc3RydWN0KTogdm9pZCA9PiB7XG4gICAgICBuZXcgaWFtLlJvbGUoc2NvcGUsICdSJywgeyBhc3N1bWVkQnk6IG5ldyBpYW0uQWNjb3VudFByaW5jaXBhbCgnMjIyMjIyMjIyMjIyJyksIHJvbGVOYW1lOiAnYS1yb2xlJyB9KVxuICAgIH1cbiAgICBleHBlY3QoKCkgPT4gZGVzY3JpYmVSZXNvdXJjZXMoc3RhY2tPZihidWlsZCksICdnYXRld2F5LXJvbGUnKSkubm90LnRvVGhyb3coKVxuICB9KVxufSlcbiJdfQ==