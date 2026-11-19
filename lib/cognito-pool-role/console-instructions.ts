/**
 * The hand-build instruction set for the user pool role, from the same generator as the gateway role's,
 * so it is derived from the published template and never authored here. Every version requires the
 * External ID. The set leaves the pool id as a token for the serving portal to fill, and the account the
 * role is deployed in as the gate's account token, since only the Provider knows it.
 */
import {
  ConsoleConstruct,
  ConsoleInstructionSet,
  generateConsoleInstructionsFor,
  generateConsoleInstructionTemplateFor,
  isPublishedVersionOf,
} from '../gateway-role/console-instructions'
import { USER_POOL_ID_PARAMETER, USER_POOL_ID_TOKEN } from '../parity-gate/canonical'
import { CONSTRUCT_NAME } from './cognito-pool-role'

/** The user pool role as the generator knows it: no version without the ID, and the pool id as an input. */
export const COGNITO_POOL_ROLE_CONSOLE_CONSTRUCT: ConsoleConstruct = {
  name: CONSTRUCT_NAME,
  versionsWithoutExternalId: new Set(),
  historicalVersions: new Set(),
  deployInputs: { [USER_POOL_ID_PARAMETER]: USER_POOL_ID_TOKEN },
}

export { USER_POOL_ID_TOKEN }

/** Whether `version` is a published version of the user pool role. */
export const isPublishedPoolRoleVersion = (version: string, currentVersion: string): boolean =>
  isPublishedVersionOf(COGNITO_POOL_ROLE_CONSOLE_CONSTRUCT, version, currentVersion)

/** The set for `region`, with the External ID, the pool id and the account left as tokens. */
export const generatePoolRoleConsoleInstructions = (
  template: unknown,
  version: string,
  currentVersion: string,
  region: string,
): ConsoleInstructionSet => generateConsoleInstructionsFor(COGNITO_POOL_ROLE_CONSOLE_CONSTRUCT, template, version, currentVersion, region)

/** The set that publishes beside the template, with the Region and the trust account as tokens as well. */
export const generatePoolRoleConsoleInstructionTemplate = (
  template: unknown,
  version: string,
  currentVersion: string,
): ConsoleInstructionSet => generateConsoleInstructionTemplateFor(COGNITO_POOL_ROLE_CONSOLE_CONSTRUCT, template, version, currentVersion)
