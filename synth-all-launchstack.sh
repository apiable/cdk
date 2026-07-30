#!/usr/bin/env bash
#
# Synthesize every construct's launch-stack template into dist/launchstack/.
#
# This list is the single source of truth for which constructs have a published template. Every
# consumer — the parity gate, the build's construct tests, and the publish step — reads it from
# here, so a construct added in one place can never be silently missing from another. A new
# LaunchStackConstruct entry in the portal backend needs its construct name added here, or its
# template is never built and its Launch Stack URL 404s at runtime.
set -euo pipefail

cd "$(dirname "$0")"

CONSTRUCTS=(
  apiable-gateway-role
  apiable-logs-bucket
  apiable-cognito-pool
  apiable-lambda-authorizer
  apiable-usagelogs-stream
  apiable-usagetokens-stream
)

for construct in "${CONSTRUCTS[@]}"; do
  bash synth-launchstack.sh "${construct}"
done
