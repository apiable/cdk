/**
 * Every construct that publishes a hand-build instruction set, by name. The publish step and the
 * published-set verifier both ask here, so a construct's rules live in one place.
 */
import { ConsoleConstruct, constructRequiresExternalId, GATEWAY_ROLE_CONSOLE_CONSTRUCT } from './gateway-role/console-instructions'
import { COGNITO_POOL_ROLE_CONSOLE_CONSTRUCT } from './cognito-pool-role/console-instructions'

export const CONSOLE_CONSTRUCTS: Readonly<Record<string, ConsoleConstruct>> = {
  [GATEWAY_ROLE_CONSOLE_CONSTRUCT.name]: GATEWAY_ROLE_CONSOLE_CONSTRUCT,
  [COGNITO_POOL_ROLE_CONSOLE_CONSTRUCT.name]: COGNITO_POOL_ROLE_CONSOLE_CONSTRUCT,
}

/** The construct named `name`. Throws for a construct that publishes no hand-build set. */
export const consoleConstruct = (name: string): ConsoleConstruct => {
  const construct = CONSOLE_CONSTRUCTS[name]
  if (construct === undefined) throw new Error(`${name} publishes no hand-build instruction set`)
  return construct
}

/** Whether `version` of the construct named `name` requires the external ID. A construct not listed here always does. */
export const requiresExternalIdFor = (name: string, version: string): boolean => {
  const construct = CONSOLE_CONSTRUCTS[name]
  return construct === undefined || constructRequiresExternalId(construct, version)
}

/** The tokens a published set of `name` must carry for the serving portal to fill. */
export const deployInputTokensOf = (name: string): readonly string[] => Object.values(consoleConstruct(name).deployInputs)
