import * as cdk from 'aws-cdk-lib'
import { GatewayRoleStack, CONSTRUCT_NAME } from '../lib/gateway-role'

/**
 * Region-agnostic synth app for the published launch-stack template. No `env` is set, so
 * the region resolves to the deployment region and the trusted account stays a parameter.
 */
const app = new cdk.App()
// eslint-disable-next-line no-new
new GatewayRoleStack(app, CONSTRUCT_NAME, {
  description: 'Apiable gateway-management role — one-click provisioning',
  // keep the published template minimal: no CDK telemetry resource or region-list condition
  analyticsReporting: false,
  // this asset-less role deploys into any account, so drop the cdk-bootstrap requirement
  synthesizer: new cdk.DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
})
