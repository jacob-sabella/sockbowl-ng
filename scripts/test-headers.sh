#!/usr/bin/env bash
# Acceptance test for WP-N4 (AUTH-21) and, since M7, WP-N1 §3.1 items 2 and
# 5. Builds the ng image once, then runs it twice: in port mode (today's
# per-service host:port shape) and in M7 path mode (SOCKBOWL_PUBLIC_URL set,
# everything under one public host). Both runs check that every response
# carries the CSP plus the four security headers from
# security-headers.conf.template, that the Cache-Control values nginx.conf
# already set are still intact (add_header in a location block replaces
# rather than merges with the server-level set, so the snippet has to be
# included in every location — see nginx.conf), and that /assets/config.js
# carries the URLs the active mode should produce.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE="sockbowl-ng:test-headers"

FAIL=0

# $1 = path, $2 = "yes"/"no" whether Cache-Control: no-cache must be present.
# $3 = "port" or "path": which mode's CSP shape to expect.
check_headers() {
  local path="$1" expect_nocache="$2" mode="$3" headers
  echo "-- HEAD ${path} (${mode} mode)"
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

  local csp
  csp="$(echo "$headers" | grep -i "^Content-Security-Policy:" || true)"

  if [[ "$mode" == "port" ]]; then
    if ! echo "$csp" | grep -q "http://localhost:8080"; then
      echo "   FAIL: CSP is missing the Keycloak origin"
      FAIL=1
    fi
  else
    # Path mode (§3.1 item 2): same-origin except the WS upgrade, which
    # still needs an explicit wss:// entry for Safari's 'self' gap.
    if ! echo "$csp" | grep -Eq "connect-src[^;]*'self'"; then
      echo "   FAIL: path-mode CSP connect-src is missing 'self'"
      FAIL=1
    fi
    if ! echo "$csp" | grep -Eq "connect-src[^;]* wss://sockbowl\.jacobsabella\.com( |;|$)"; then
      echo "   FAIL: path-mode CSP connect-src is missing the explicit wss:// origin"
      FAIL=1
    fi
    if ! echo "$csp" | grep -Eq "frame-src 'self'"; then
      echo "   FAIL: path-mode CSP frame-src should be 'self' (Keycloak is now same-origin under /auth)"
      FAIL=1
    fi
    if ! echo "$csp" | grep -Eq "form-action 'self'"; then
      echo "   FAIL: path-mode CSP form-action should be 'self'"
      FAIL=1
    fi
  fi

  # The service worker fetches the Google Fonts stylesheets and font files
  # with fetch(), which connect-src governs (NG-1). True in both modes.
  local origin
  for origin in https://fonts.googleapis.com https://fonts.gstatic.com; do
    if ! echo "$csp" | grep -Eqi "connect-src[^;]* ${origin}( |;|$)"; then
      echo "   FAIL: CSP connect-src is missing ${origin}"
      FAIL=1
    fi
  done

  if [[ "$expect_nocache" == "yes" ]] && ! echo "$headers" | grep -qi "^Cache-Control:.*no-cache"; then
    echo "   MISSING: Cache-Control: no-cache (was set before this change; must not regress)"
    FAIL=1
  fi
}

# Asserts /assets/config.js carries the URLs the active mode should produce
# (§3.1 item 6's "the image built from the branch serves the path-mode
# config.js when SOCKBOWL_PUBLIC_URL is set").
check_config_js() {
  local mode="$1" body
  body="$(curl -sf "${BASE}/assets/config.js")"
  echo "-- /assets/config.js (${mode} mode)"
  echo "$body" | sed 's/^/   /'

  if [[ "$mode" == "port" ]]; then
    if ! echo "$body" | grep -q 'apiBaseUrl: "http://localhost:7000"'; then
      echo "   FAIL: port-mode config.js apiBaseUrl is wrong"
      FAIL=1
    fi
    if ! echo "$body" | grep -q 'wsUrl: "ws://localhost:7000/sockbowl-game"'; then
      echo "   FAIL: port-mode config.js wsUrl is wrong"
      FAIL=1
    fi
    if ! echo "$body" | grep -q 'issuer: "http://localhost:8080/realms/sockbowl"'; then
      echo "   FAIL: port-mode config.js keycloak.issuer is wrong"
      FAIL=1
    fi
  else
    if ! echo "$body" | grep -q 'apiBaseUrl: "https://sockbowl.jacobsabella.com"'; then
      echo "   FAIL: path-mode config.js apiBaseUrl is wrong"
      FAIL=1
    fi
    if ! echo "$body" | grep -q 'sockbowlGameApiUrl: "https://sockbowl.jacobsabella.com/api/v1/session"'; then
      echo "   FAIL: path-mode config.js sockbowlGameApiUrl is wrong"
      FAIL=1
    fi
    if ! echo "$body" | grep -q 'sockbowlQuestionsApiUrl: "https://sockbowl.jacobsabella.com/questions/"'; then
      echo "   FAIL: path-mode config.js sockbowlQuestionsApiUrl is wrong"
      FAIL=1
    fi
    if ! echo "$body" | grep -q 'wsUrl: "wss://sockbowl.jacobsabella.com/ws"'; then
      echo "   FAIL: path-mode config.js wsUrl is wrong"
      FAIL=1
    fi
    if ! echo "$body" | grep -q 'issuer: "https://sockbowl.jacobsabella.com/auth/realms/sockbowl"'; then
      echo "   FAIL: path-mode config.js keycloak.issuer is wrong"
      FAIL=1
    fi
    # requireHttps is a JS expression evaluated client-side from
    # apiBaseUrl's scheme, not a substituted literal (config.template.js);
    # it evaluates to true here since apiBaseUrl is https.
    if ! echo "$body" | grep -q 'requireHttps: "https://sockbowl.jacobsabella.com".startsWith("https://")'; then
      echo "   FAIL: path-mode config.js requireHttps expression is wrong"
      FAIL=1
    fi
  fi
}

wait_for_nginx() {
  local base="$1" ready=0
  for _ in $(seq 1 30); do
    if curl -sf -o /dev/null "${base}/"; then
      ready=1
      break
    fi
    sleep 0.5
  done
  if [[ "$ready" -ne 1 ]]; then
    echo "FAILED: nginx never became ready at $base"
    return 1
  fi
}

echo "Building $IMAGE from $REPO_ROOT..."
docker build -t "$IMAGE" "$REPO_ROOT"

# --- Port mode (today's default shape) ---
CONTAINER="sbm2-ng-n4-headers-test"
cleanup_port() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup_port EXIT
cleanup_port # in case a stale container from a previous failed run is still around

echo "Starting $CONTAINER (port mode)..."
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
if ! wait_for_nginx "$BASE"; then
  docker logs "$CONTAINER" || true
  exit 1
fi

check_headers "/" no port
check_headers "/index.html" yes port
check_headers "/assets/config.js" yes port
check_headers "/ngsw-worker.js" yes port
check_headers "/game-session" no port # deep SPA route, served by the try_files fallback
check_config_js port

cleanup_port
trap - EXIT

# --- Path mode (M7 §3.1 items 2, 5, 6: SOCKBOWL_PUBLIC_URL set) ---
CONTAINER="sbm7-ng-n1-headers-pathmode-test"
cleanup_path() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup_path EXIT
cleanup_path

echo "Starting $CONTAINER (path mode)..."
docker run -d --name "$CONTAINER" \
  -p 127.0.0.1::80 \
  -e SOCKBOWL_PUBLIC_URL=https://sockbowl.jacobsabella.com \
  -e AUTH_ENABLED=true \
  -e CSP_EXTRA_CONNECT_SRC=https://api.openai.com \
  "$IMAGE" >/dev/null

HOST_PORT="$(docker port "$CONTAINER" 80/tcp | head -n1 | cut -d: -f2)"
BASE="http://127.0.0.1:${HOST_PORT}"
echo "Waiting for nginx at $BASE..."
if ! wait_for_nginx "$BASE"; then
  docker logs "$CONTAINER" || true
  exit 1
fi

check_headers "/" no path
check_headers "/index.html" yes path
check_headers "/assets/config.js" yes path
check_headers "/ngsw-worker.js" yes path
check_headers "/game-session" no path
check_config_js path

cleanup_path
trap - EXIT

if [[ "$FAIL" -ne 0 ]]; then
  echo
  echo "FAILED: one or more security header or config.js checks failed."
  exit 1
fi

echo
echo "OK: CSP, security headers (and prior Cache-Control) and config.js are correct in both port mode and path mode."
