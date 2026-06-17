import { CfnOutput } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as ssm from 'aws-cdk-lib/aws-ssm'

/** Root namespace every composition parameter lives under. */
export const COMPOSITION_NAMESPACE = 'apiable'

/**
 * The three segments that address one composed value. The key is the stable contract between an
 * upstream writer and a downstream reader: both build it from the same shape, so they agree on the
 * name without sharing a CloudFormation export.
 */
export interface CompositionKey {
  /** Per-deployment tenant identifier (e.g. a stack name such as `staging`). */
  readonly tenant: string
  /** Kebab-case kit component name (e.g. `gateway-role`, `logs-bucket`). */
  readonly component: string
  /** Declared output name the value is published under. */
  readonly output: string
}

const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

const assertSegment = (label: keyof CompositionKey, value: string): string => {
  if (!value || !SEGMENT_PATTERN.test(value)) {
    throw new Error(
      `composition key segment "${label}" must be a non-empty path segment (got "${value}")`,
    )
  }
  return value
}

/**
 * Build the parameter name that addresses a composed value: `/apiable/{tenant}/{component}/{output}`.
 * Every segment is validated so a missing or malformed input fails loudly here rather than producing
 * a silently wrong key a reader would later miss.
 */
export const compositionParameterName = (key: CompositionKey): string => {
  const tenant = assertSegment('tenant', key.tenant)
  const component = assertSegment('component', key.component)
  const output = assertSegment('output', key.output)
  return `/${COMPOSITION_NAMESPACE}/${tenant}/${component}/${output}`
}

/** One declared output published to the shared parameter space. */
export interface DeclaredOutput {
  /** Output name — the last key segment. */
  readonly name: string
  /** Output value (typically an ARN or id token). */
  readonly value: string
  /**
   * True when the value is a credential/secret. A secret is never written to a plaintext parameter;
   * publishing one throws so a client secret cannot leak into the composition seam.
   */
  readonly secret?: boolean
}

export interface PublishOutputsProps {
  readonly tenant: string
  readonly component: string
  readonly outputs: readonly DeclaredOutput[]
}

/**
 * Write each declared output to the shared parameter space as a CloudFormation-native
 * `AWS::SSM::Parameter`. Because each write is a stack resource, an unavailable parameter space or a
 * denied write fails the deployment and rolls the stack back — there is no silent partial
 * composition. Secret-valued outputs are rejected: they must not land in a plaintext parameter.
 */
export const publishOutputs = (scope: Construct, props: PublishOutputsProps): ssm.StringParameter[] =>
  props.outputs.map((output) => {
    if (output.secret) {
      throw new Error(
        `refusing to publish secret-valued output "${output.name}" to a plaintext composition parameter`,
      )
    }
    const parameterName = compositionParameterName({
      tenant: props.tenant,
      component: props.component,
      output: output.name,
    })
    return new ssm.StringParameter(scope, `Composition${output.name}`, {
      parameterName,
      stringValue: output.value,
    })
  })

/** A read addresses the same three segments a write published under. */
export type ReadUpstreamOutputProps = CompositionKey

/**
 * Resolve an upstream component's published output by composing its key and reading the shared
 * parameter. The returned token resolves at deployment to the parameter's value — a direct read by
 * key, never an `Fn::ImportValue` cross-stack export or a `DescribeStacks` wait on the upstream's
 * deployment status. A missing or malformed key fails fast here (via the key validation); a key that
 * resolves to no parameter fails the deployment, so a downstream never reads a silent default.
 */
export const readUpstreamOutput = (scope: Construct, props: ReadUpstreamOutputProps): string =>
  ssm.StringParameter.valueForStringParameter(scope, compositionParameterName(props))
