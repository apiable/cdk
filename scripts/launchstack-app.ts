import * as cdk from 'aws-cdk-lib'
import { buildPublishedStack } from '../lib/gateway-role'

/** Synth entrypoint for the published launch-stack template; the stack is built by buildPublishedStack. */
buildPublishedStack(new cdk.App())
