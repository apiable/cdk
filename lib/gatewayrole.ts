/**
 * Compatibility entrypoint. The gateway-role construct now lives in `./gateway-role`
 * and ships as `@apiable/cdk-gateway-role`; standalone CFN synthesis uses `GatewayRoleStack`.
 */
export { GatewayRole, GatewayRoleStack, TRUST_ACCOUNT_PARAMETER } from './gateway-role'
export type { GatewayRoleProps, GatewayRoleStackProps } from './gateway-role'
