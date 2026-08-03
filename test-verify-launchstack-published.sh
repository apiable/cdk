#!/usr/bin/env bash
#
# Test-automation coverage (013-1-28 [TA]) for verify-launchstack-published.sh's extended zip-artifact
# path, end-to-end against a local HTTP server standing in for S3 — no AWS account needed, mirroring
# 013-1-25's own tamper-test methodology for its template-only predecessor
# (_bmad-output/test-artifacts/atdd-013-1-25-verify-launchstack-published.sh).
#
# Exercises the REAL verify-launchstack-published.sh (never a reimplementation of its logic), so this
# test verifies the script's actual behaviour, not a copy that could silently drift from it. A bare
# `python3 -m http.server` does not set Content-Type reliably for `.yaml` or any Cache-Control header at
# all, so the stand-in server below sets both explicitly — the same headers publish-launchstack.sh sets
# on the real store — otherwise this would fail its own happy path for reasons S3 would never produce.
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

if [[ "${fail_count}" -gt 0 ]]; then
  echo "${fail_count} check(s) failed"
  exit 1
fi
echo "all ${pass} checks passed"
