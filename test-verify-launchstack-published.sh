#!/usr/bin/env bash
#
# Test-automation coverage (013-1-28 [TA], extended by 013-1-29) for verify-launchstack-published.sh's
# zip-artifact path AND launchstack-overwrite-guard.sh's producer-side write-once guard, end-to-end
# against a local HTTP server standing in for S3 — no AWS account needed, mirroring 013-1-25's own
# tamper-test methodology for its template-only predecessor
# (_bmad-output/test-artifacts/atdd-013-1-25-verify-launchstack-published.sh).
#
# Exercises the REAL scripts (never a reimplementation of their logic), so this test verifies actual
# behaviour, not a copy that could silently drift from it. A bare `python3 -m http.server` does not set
# Content-Type reliably for `.yaml` or any Cache-Control header at all, so the stand-in server below sets
# both explicitly — the same headers publish-launchstack.sh sets on the real store — otherwise this
# would fail its own happy path for reasons S3 would never produce.
#
# `aws s3 sync` (the actual upload half of publish-launchstack.sh) needs a real S3-compatible API this
# harness does not provide, so the 013-1-29 checks below exercise launchstack-overwrite-guard.sh
# directly — the fail-closed half, and the one a corrupted/tampered publish would actually be caught by.
#
# Usage: bash test-verify-launchstack-published.sh
set -uo pipefail
cd "$(dirname "$0")"

SCRATCH="$(mktemp -d)"
SERVER_PID=""
cleanup() {
  [[ -n "${SERVER_PID}" ]] && kill "${SERVER_PID}" 2>/dev/null
  rm -rf "${SCRATCH}"
}
trap cleanup EXIT

CONSTRUCT="apiable-test-construct"
VERSION="9.9.9"
ARTIFACT_DIR="${SCRATCH}/dist/launchstack/${CONSTRUCT}/${VERSION}"
SERVE_DIR="${SCRATCH}/served/${CONSTRUCT}/${VERSION}"
mkdir -p "${ARTIFACT_DIR}" "${SERVE_DIR}"

cat > "${ARTIFACT_DIR}/template.yaml" <<'YAML'
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  Fn:
    Type: AWS::Lambda::Function
YAML

python3 -c "
import zipfile
with zipfile.ZipFile('${ARTIFACT_DIR}/authorizer.zip', 'w') as zf:
    zf.writestr('index.mjs', 'export const handler = async () => ({})')
"
cp "${ARTIFACT_DIR}/template.yaml" "${SERVE_DIR}/template.yaml"
cp "${ARTIFACT_DIR}/authorizer.zip" "${SERVE_DIR}/authorizer.zip"

PORT=$(python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1]); s.close()")

# A minimal server that sets the real store's headers (Content-Type + immutable Cache-Control) per
# extension — the property under test, not incidental to it.
cat > "${SCRATCH}/serve.py" <<PYEOF
import http.server, os

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        if self.path.endswith('.yaml'):
            self.send_header('Content-Type', 'application/x-yaml')
        elif self.path.endswith('.zip'):
            self.send_header('Content-Type', 'application/zip')
        self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        super().end_headers()

os.chdir('${SCRATCH}/served')
http.server.HTTPServer(('127.0.0.1', ${PORT}), Handler).serve_forever()
PYEOF
python3 "${SCRATCH}/serve.py" >/dev/null 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 20); do
  curl -sf -o /dev/null "http://127.0.0.1:${PORT}/${CONSTRUCT}/${VERSION}/template.yaml" && break
  sleep 0.2
done

pass=0
fail_count=0
check() {
  local desc="$1" expect_exit="$2"
  shift 2
  local out
  out=$("$@" 2>&1)
  local actual=$?
  if [[ "${actual}" -eq "${expect_exit}" ]]; then
    echo "  PASS: ${desc}"
    pass=$((pass + 1))
  else
    echo "  FAIL: ${desc} (expected exit ${expect_exit}, got ${actual})"
    echo "${out}" | tail -20
    fail_count=$((fail_count + 1))
  fi
}

echo "=== S1/S2/S6: valid template + zip served with the real store's headers -> exit 0 ==="
check "happy path passes" 0 \
  env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash verify-launchstack-published.sh

echo "=== S5: corrupted served zip (truncated) -> fails closed ==="
cp "${SERVE_DIR}/authorizer.zip" "${SCRATCH}/authorizer.zip.bak"
head -c 50 "${SERVE_DIR}/authorizer.zip" > "${SCRATCH}/truncated.zip"
cp "${SCRATCH}/truncated.zip" "${SERVE_DIR}/authorizer.zip"
check "corrupted served zip fails closed" 1 \
  env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash verify-launchstack-published.sh
cp "${SCRATCH}/authorizer.zip.bak" "${SERVE_DIR}/authorizer.zip"

echo "=== S5: missing served artifact (404) -> fails closed ==="
rm "${SERVE_DIR}/authorizer.zip"
check "missing served artifact fails closed" 1 \
  env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash verify-launchstack-published.sh
cp "${SCRATCH}/authorizer.zip.bak" "${SERVE_DIR}/authorizer.zip"

echo "=== S5: served zip with the wrong Content-Type -> fails closed ==="
cat > "${SCRATCH}/serve-wrong-type.py" <<PYEOF
import http.server, os

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Content-Type', 'text/plain')
        self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        super().end_headers()

os.chdir('${SCRATCH}/served')
http.server.HTTPServer(('127.0.0.1', ${PORT} + 1), Handler).serve_forever()
PYEOF
python3 "${SCRATCH}/serve-wrong-type.py" >/dev/null 2>&1 &
WRONG_TYPE_PID=$!
for _ in $(seq 1 20); do
  curl -sf -o /dev/null "http://127.0.0.1:$((PORT + 1))/${CONSTRUCT}/${VERSION}/template.yaml" && break
  sleep 0.2
done
check "wrong Content-Type fails closed" 1 \
  env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:$((PORT + 1))" TEMPLATE_STORE_SCHEME="http" bash verify-launchstack-published.sh
kill "${WRONG_TYPE_PID}" 2>/dev/null

echo "=== 013-1-29 S1: overwrite guard passes clean — nothing changed, plus a brand-new version ==="
check "guard passes when published content is unchanged" 0 \
  env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash launchstack-overwrite-guard.sh
NEW_VERSION_DIR="${SCRATCH}/dist/launchstack/${CONSTRUCT}/9.9.10"
mkdir -p "${NEW_VERSION_DIR}"
cp "${ARTIFACT_DIR}/template.yaml" "${NEW_VERSION_DIR}/template.yaml"
check "guard passes a brand-new, not-yet-published version" 0 \
  env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash launchstack-overwrite-guard.sh
rm -rf "${NEW_VERSION_DIR}"

echo "=== 013-1-29 S2: overwrite guard refuses changed content at a published key — same byte size ==="
cp "${ARTIFACT_DIR}/template.yaml" "${SCRATCH}/template.yaml.bak"
python3 -c "
content = open('${ARTIFACT_DIR}/template.yaml').read()
tampered = content.replace(\"'2010-09-09'\", \"'2010-09-08'\")
assert tampered != content and len(tampered) == len(content), 'tamper must change content but preserve length'
open('${ARTIFACT_DIR}/template.yaml', 'w').write(tampered)
"
check "guard refuses same-size changed content (content identity, never size)" 1 \
  env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash launchstack-overwrite-guard.sh
cp "${SCRATCH}/template.yaml.bak" "${ARTIFACT_DIR}/template.yaml"

echo "=== 013-1-29 S2: overwrite guard refuses changed content at a published key — different byte size ==="
printf '# tamper\n' >> "${ARTIFACT_DIR}/template.yaml"
check "guard refuses different-size changed content" 1 \
  env SRC_DIR="${SCRATCH}/dist/launchstack" TEMPLATE_STORE_HOST="127.0.0.1:${PORT}" TEMPLATE_STORE_SCHEME="http" bash launchstack-overwrite-guard.sh
cp "${SCRATCH}/template.yaml.bak" "${ARTIFACT_DIR}/template.yaml"
rm -f "${SCRATCH}/template.yaml.bak"

if [[ "${fail_count}" -gt 0 ]]; then
  echo "${fail_count} check(s) failed"
  exit 1
fi
echo "all ${pass} checks passed"
