#!/usr/bin/env bash
# Acceptance test for WP-N4 (AUTH-21). Builds the ng image, runs it with
# sample runtime env, and checks that every response carries the CSP plus the
# four security headers from security-headers.conf.template, and that the
# Cache-Control values nginx.conf already set are still intact (add_header in
# a location block replaces rather than merges with the server-level set, so
# the snippet has to be included in every location — see nginx.conf).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE="sockbowl-ng:test-headers"
CONTAINER="sbm2-ng-n4-headers-test"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup # in case a stale container from a previous failed run is still around

echo "Building $IMAGE from $REPO_ROOT..."
docker build -t "$IMAGE" "$REPO_ROOT"

echo "Starting $CONTAINER..."
docker run -d --name "$CONTAINER" \
  -p 127.0.0.1::80 \
  -e APP_HOST=localhost \
  -e APP_PROTOCOL=http \
  -e WS_PROTOCOL=ws \
  -e SOCKBOWL_GAME_PORT=7000 \
  -e SOCKBOWL_QUESTIONS_PORT=7009 \
  -e KEYCLOAK_PORT=8080 \
  -e AUTH_ENABLED=true \
  -e CSP_EXTRA_CONNECT_SRC=https://api.openai.com \
  "$IMAGE" >/dev/null

HOST_PORT="$(docker port "$CONTAINER" 80/tcp | head -n1 | cut -d: -f2)"
BASE="http://127.0.0.1:${HOST_PORT}"

echo "Waiting for nginx at $BASE..."
READY=0
for _ in $(seq 1 30); do
  if curl -sf -o /dev/null "$BASE/"; then
    READY=1
    break
  fi
  sleep 0.5
done
if [[ "$READY" -ne 1 ]]; then
  echo "FAILED: nginx never became ready"
  docker logs "$CONTAINER" || true
  exit 1
fi

FAIL=0

# $1 = path, $2 = "yes"/"no" whether Cache-Control: no-cache must be present.
check_headers() {
  local path="$1" expect_nocache="$2" headers
  echo "-- HEAD ${path}"
  headers="$(curl -sI "${BASE}${path}")"
  echo "$headers" | sed 's/^/   /'

  local required=(
    "Content-Security-Policy:"
    "X-Content-Type-Options: nosniff"
    "Referrer-Policy: strict-origin-when-cross-origin"
    "X-Frame-Options: DENY"
    "Permissions-Policy:"
  )
  local h
  for h in "${required[@]}"; do
    if ! echo "$headers" | grep -qi "^${h}"; then
      echo "   MISSING: $h"
      FAIL=1
    fi
  done

  if echo "$headers" | grep -i "^Content-Security-Policy:" | grep -qi "script-src[^;]*'unsafe-inline'"; then
    echo "   FAIL: script-src allows 'unsafe-inline' (critical-CSS inlining must stay off)"
    FAIL=1
  fi

  if ! echo "$headers" | grep -i "^Content-Security-Policy:" | grep -q "http://localhost:8080"; then
    echo "   FAIL: CSP is missing the Keycloak origin"
    FAIL=1
  fi

  if [[ "$expect_nocache" == "yes" ]] && ! echo "$headers" | grep -qi "^Cache-Control:.*no-cache"; then
    echo "   MISSING: Cache-Control: no-cache (was set before this change; must not regress)"
    FAIL=1
  fi
}

check_headers "/" no
check_headers "/index.html" yes
check_headers "/assets/config.js" yes
check_headers "/ngsw-worker.js" yes
check_headers "/game-session" no # deep SPA route, served by the try_files fallback

if [[ "$FAIL" -ne 0 ]]; then
  echo
  echo "FAILED: one or more security header checks failed."
  echo "--- container logs ---"
  docker logs "$CONTAINER" || true
  exit 1
fi

echo
echo "OK: CSP and security headers present (and prior Cache-Control intact) on every checked path."
