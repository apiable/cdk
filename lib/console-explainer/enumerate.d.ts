import * as cdk from 'aws-cdk-lib';
import { ResourceEnumeration } from './descriptor';
/**
 * Enumerate the resources a synthesized stack creates as typed descriptors, one per resource, derived
 * from the synthesized CloudFormation rather than a hand-maintained list. Each construct's enumeration
 * is namespaced under `component`. EVERY synthesized resource surfaces: a resource of a modelled CFN
 * type carries its mapped kind, and one of an unmapped type surfaces as `other` carrying the raw type,
 * so the audit never silently drops a resource the construct creates. A synthesized stack output is
 * enumerated as a `resource-output` descriptor (an identifier the deployment surfaces, with no console
 * representation of its own).
 *
 * The stable interface Epic 4 iterates: any stack that synthesizes is enumerated the same way, so a
 * newly added construct is adopted with no change on the consuming side.
 */
export declare const describeResources: (stack: cdk.Stack, component: string) => ResourceEnumeration;
