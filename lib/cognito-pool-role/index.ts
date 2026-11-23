export {
  CognitoPoolRole,
  CognitoPoolRoleStack,
  buildPublishedStack,
  APP_CLIENT_ACTIONS,
  CONSTRUCT_NAME,
  COGNITO_POOL_ROLE_COMPONENT,
  COGNITO_POOL_ROLE_LOGICAL_ID,
  EGRESS_CIDR_PARAMETER,
  EXTERNAL_ID_PARAMETER,
  ROLE_NAME_PREFIX,
  TRUST_ACCOUNT_PARAMETER,
  USER_POOL_ID_MAX_LENGTH,
  USER_POOL_ID_PARAMETER,
  USER_POOL_ID_PATTERN,
  USER_POOL_ID_PATTERN_SOURCE,
  regionOfUserPoolId,
} from './cognito-pool-role'
export type { CognitoPoolRoleProps, CognitoPoolRoleStackProps } from './cognito-pool-role'
export {
  COGNITO_POOL_ROLE_CONSOLE_CONSTRUCT,
  USER_POOL_ID_TOKEN,
  generatePoolRoleConsoleInstructions,
  generatePoolRoleConsoleInstructionTemplate,
  isPublishedPoolRoleVersion,
} from './console-instructions'
