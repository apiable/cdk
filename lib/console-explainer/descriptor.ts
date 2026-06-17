/**
 * The shared descriptor atom of the hybrid Console explainer: the typed, programmatic STRUCTURE of
 * the resources a construct creates. The descriptor carries resource identity and the key under which
 * the side-loaded "why this is needed" copy is addressed — never the copy itself. Epic 4 consumes this
 * atom: its renderer iterates the enumeration and its content fills the keys.
 */

/**
 * The kinds of resource the explainer enumerates. A kind drives both how a resource is grouped in the
 * audit document and whether it has an AWS Console representation (see {@link consoleService}).
 *
 * `resource-output` is a synthesized stack output (such as a role ARN) — an identifier the deployment
 * surfaces, not a console-addressable resource of its own.
 */
export type ResourceKind =
  | 'iam-role'
  | 'iam-policy'
  | 'bucket'
  | 'stream'
  | 'ssm-parameter'
  | 'resource-output'

/**
 * A console deep-link shape derived from a resource's own kind and identity — never hand-written.
 * It names the AWS Console `service` the resource lives in and the `resourcePath` within that service
 * (e.g. an IAM role's name). A consumer composes the concrete URL for a given region/account; the
 * descriptor commits only to the derivable shape, so the link cannot drift from the resource.
 */
export interface ConsoleDeepLink {
  /** AWS Console service the resource is viewed under (e.g. `iam`, `s3`). */
  readonly service: string
  /** Resource-relative path within the service, derived from the resource's identity. */
  readonly resourcePath: string
}

/**
 * One resource in a construct's enumeration. STRUCTURE only — kind, a stable identity, the content key
 * the side-loaded copy is addressed by, and (only where the resource is console-addressable) a derived
 * {@link ConsoleDeepLink}. It carries no explanatory prose: that is side-loaded by Epic 4 via the
 * {@link contentKey}.
 */
export interface ResourceDescriptor {
  /** What kind of resource this is. */
  readonly kind: ResourceKind
  /**
   * Stable identity of the resource within the construct — its physical resource name where one is
   * fixed (e.g. an IAM role name), otherwise its synthesized logical id. Stable enough for the content
   * key and the deep-link to address the same resource across synths.
   */
  readonly identity: string
  /**
   * Key the side-loaded markdown content is addressed by. Non-empty and unique within the construct's
   * enumeration. The naming granularity (per-construct vs per-wizard-path) is aligned downstream with
   * Epic 4's content tree; this atom commits only to uniqueness and non-emptiness.
   */
  readonly contentKey: string
  /**
   * Console deep-link shape, present only when the resource has a console representation. Omitted —
   * never empty or fabricated — for a resource (such as a stack output) that has none.
   */
  readonly consoleDeepLink?: ConsoleDeepLink
}

/**
 * The stable interface every construct's enumeration is exposed through. A consumer (Epic 4's
 * renderer) iterates the descriptors without knowing the construct, so a newly added construct whose
 * resources synthesize is adopted with no consuming-side change.
 */
export interface ResourceEnumeration {
  /** Kebab kit-component segment the construct's content keys are namespaced under. */
  readonly component: string
  /** One descriptor per resource the construct creates. */
  readonly resources: readonly ResourceDescriptor[]
}
