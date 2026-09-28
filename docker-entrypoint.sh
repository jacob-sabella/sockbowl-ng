#!/bin/sh
set -e

# Default values if environment variables are not set
export APP_HOST="${APP_HOST:-localhost}"
export APP_PROTOCOL="${APP_PROTOCOL:-http}"
export WS_PROTOCOL="${WS_PROTOCOL:-ws}"
export SOCKBOWL_GAME_PORT="${SOCKBOWL_GAME_PORT:-7000}"
export SOCKBOWL_QUESTIONS_PORT="${SOCKBOWL_QUESTIONS_PORT:-7009}"
export KEYCLOAK_PORT="${KEYCLOAK_PORT:-8080}"
export AUTH_ENABLED="${AUTH_ENABLED:-false}"
export CSP_EXTRA_CONNECT_SRC="${CSP_EXTRA_CONNECT_SRC:-https://api.openai.com}"

# M7 path mode (plans/m7-deploy.md §3.1 item 1): when SOCKBOWL_PUBLIC_URL is
# set (e.g. https://sockbowl.jacobsabella.com, no trailing slash), every
# backend URL is served as a path under that one public host, matching the
# prod Caddy routing (game at /api and /ws, questions at /questions,
# Keycloak at /auth) instead of a distinct host:port per service. Left unset
# (the default), and every byte computed below is identical to before M7:
# dev, the M2-M6 e2e suites and CC1 are unaffected.
SOCKBOWL_PUBLIC_URL="${SOCKBOWL_PUBLIC_URL:-}"
export SOCKBOWL_API_PATH="${SOCKBOWL_API_PATH:-}"
export SOCKBOWL_WS_PATH="${SOCKBOWL_WS_PATH:-/ws}"
export SOCKBOWL_QUESTIONS_PATH="${SOCKBOWL_QUESTIONS_PATH:-/questions}"
export SOCKBOWL_AUTH_PATH="${SOCKBOWL_AUTH_PATH:-/auth}"

if [ -n "$SOCKBOWL_PUBLIC_URL" ]; then
  # Path mode: derive the five backend URLs from one public origin.
  PUBLIC_HOST="${SOCKBOWL_PUBLIC_URL#*://}"
  case "$SOCKBOWL_PUBLIC_URL" in
    https://*) PUBLIC_WS_PROTOCOL="wss" ;;
    *)         PUBLIC_WS_PROTOCOL="ws" ;;
  esac

  export CFG_API_BASE="${SOCKBOWL_PUBLIC_URL}${SOCKBOWL_API_PATH}"
  export CFG_GAME_API="${SOCKBOWL_PUBLIC_URL}${SOCKBOWL_API_PATH}/api/v1/session"
  export CFG_QUESTIONS_API="${SOCKBOWL_PUBLIC_URL}${SOCKBOWL_QUESTIONS_PATH}/"
  export CFG_WS_URL="${PUBLIC_WS_PROTOCOL}://${PUBLIC_HOST}${SOCKBOWL_WS_PATH}"
  export CFG_KC_ISSUER="${SOCKBOWL_PUBLIC_URL}${SOCKBOWL_AUTH_PATH}/realms/sockbowl"
else
  # Port mode (today's behaviour, byte-for-byte unchanged).
  export CFG_API_BASE="${APP_PROTOCOL}://${APP_HOST}:${SOCKBOWL_GAME_PORT}"
  export CFG_GAME_API="${APP_PROTOCOL}://${APP_HOST}:${SOCKBOWL_GAME_PORT}/api/v1/session"
  export CFG_QUESTIONS_API="${APP_PROTOCOL}://${APP_HOST}:${SOCKBOWL_QUESTIONS_PORT}/"
  export CFG_WS_URL="${WS_PROTOCOL}://${APP_HOST}:${SOCKBOWL_GAME_PORT}/sockbowl-game"
  export CFG_KC_ISSUER="${APP_PROTOCOL}://${APP_HOST}:${KEYCLOAK_PORT}/realms/sockbowl"
fi

# Generate config.js from template. requireHttps is derived inside the
# template itself from CFG_API_BASE's scheme (see config.template.js), so
# only these five backend-URL variables need substituting in either mode.
echo "Generating runtime configuration..."
envsubst '${CFG_API_BASE} ${CFG_GAME_API} ${CFG_QUESTIONS_API} ${CFG_WS_URL} ${CFG_KC_ISSUER} ${AUTH_ENABLED}' \
  < /usr/share/nginx/html/assets/config.template.js \
  > /usr/share/nginx/html/assets/config.js

echo "Runtime configuration generated:"
cat /usr/share/nginx/html/assets/config.js

# Build the Content-Security-Policy connect-src / frame-src / form-action
# origins from the same backend location env vars as config.js above, so the
# CSP always matches where the app actually calls out to (AUTH-21).
if [ -n "$SOCKBOWL_PUBLIC_URL" ]; then
  # Path mode: everything is same-origin except the WebSocket upgrade, which
  # still needs an explicit wss:// entry for Safari's 'self' gap (self does
  # not cover a scheme change from https to wss there). Keycloak's hosted
  # login and its redirect both live under /auth on this same origin now, so
  # frame-src and form-action collapse to 'self' too (§3.1 item 2).
  CSP_CONNECT_SRC="'self' ${PUBLIC_WS_PROTOCOL}://${PUBLIC_HOST}"
  CSP_FRAME_SRC="'self'"
  CSP_FORM_ACTION="'self'"
else
  GAME_HTTP_ORIGIN="${APP_PROTOCOL}://${APP_HOST}:${SOCKBOWL_GAME_PORT}"
  GAME_WS_ORIGIN="${WS_PROTOCOL}://${APP_HOST}:${SOCKBOWL_GAME_PORT}"
  QUESTIONS_ORIGIN="${APP_PROTOCOL}://${APP_HOST}:${SOCKBOWL_QUESTIONS_PORT}"
  KEYCLOAK_ORIGIN="${APP_PROTOCOL}://${APP_HOST}:${KEYCLOAK_PORT}"
  CSP_CONNECT_SRC="'self' ${GAME_HTTP_ORIGIN} ${GAME_WS_ORIGIN} ${QUESTIONS_ORIGIN} ${KEYCLOAK_ORIGIN}"
  CSP_FRAME_SRC="${KEYCLOAK_ORIGIN}"
  CSP_FORM_ACTION="'self' ${KEYCLOAK_ORIGIN}"
fi

# connect-src also lists the Google Fonts origins: once the Angular service
# worker controls the page, it re-fetches the cross-origin font stylesheets and
# font files with fetch(), which is governed by the worker's connect-src rather
# than style-src/font-src. Without them every font and Material Icon 504s.
FONT_CONNECT_SRC="https://fonts.googleapis.com https://fonts.gstatic.com"

export CSP_HEADER_VALUE="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src ${CSP_CONNECT_SRC} ${FONT_CONNECT_SRC} ${CSP_EXTRA_CONNECT_SRC}; worker-src 'self'; frame-src ${CSP_FRAME_SRC}; frame-ancestors 'none'; base-uri 'self'; form-action ${CSP_FORM_ACTION}; object-src 'none'"

echo "Generating security headers snippet..."
mkdir -p /etc/nginx/snippets
envsubst '${CSP_HEADER_VALUE}' \
  < /etc/nginx/security-headers.conf.template \
  > /etc/nginx/snippets/security-headers.conf

echo "Security headers generated:"
cat /etc/nginx/snippets/security-headers.conf

# Execute the main container command
exec "$@"
