#!/usr/bin/env bash
#
# Reads the S3 object version id currently published at a launch-stack key, via an anonymous HEAD
# against the public store — same trust boundary as the rest of this pipeline, no AWS credentials
# needed. Prints the version id to stdout on success.
#
# Fails closed (non-zero exit, nothing on stdout) on any non-200 response or a missing
# x-amz-version-id header — the status code is checked BEFORE trusting any header a non-200 response
# happens to carry, and -L + reading the last response in the chain follows the same region-neutral-
# host-redirect handling verify-launchstack-published.sh already established.
#
# Usage: bash launchstack-read-object-version.sh <key>
set -uo pipefail
cd "$(dirname "$0")"

LAUNCHSTACK_BUCKET="${LAUNCHSTACK_BUCKET:-apiable-launchstack-templates}"
TEMPLATE_STORE_HOST="${TEMPLATE_STORE_HOST:-${LAUNCHSTACK_BUCKET}.s3.amazonaws.com}"
# Overridable only so a local test double (no TLS) can stand in for the real store; the real store is
# always https, so this must never be set in CI or by an operator against the genuine bucket.
TEMPLATE_STORE_SCHEME="${TEMPLATE_STORE_SCHEME:-https}"

key="${1:?usage: launchstack-read-object-version.sh <key>}"
url="${TEMPLATE_STORE_SCHEME}://${TEMPLATE_STORE_HOST}/${key}"

head_response="$(mktemp)"
head_code=$(curl -sSIL -o "${head_response}" -w '%{http_code}' --max-time 20 "${url}")
if [[ "${head_code}" != "200" ]]; then
  rm -f "${head_response}"
  echo "launchstack-read-object-version.sh: HEAD ${url} returned ${head_code} (expected 200)" >&2
  exit 1
fi

version_id=$(grep -i '^x-amz-version-id:' "${head_response}" | tail -1 | tr -d '\r' | cut -d: -f2- | xargs)
rm -f "${head_response}"
if [[ -z "${version_id}" ]]; then
  echo "launchstack-read-object-version.sh: no x-amz-version-id header on ${url} (is bucket versioning enabled?)" >&2
  exit 1
fi

echo "${version_id}"
