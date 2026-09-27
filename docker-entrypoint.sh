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

# Generate config.js from template
echo "Generating runtime configuration..."
envsubst '${APP_HOST} ${APP_PROTOCOL} ${WS_PROTOCOL} ${SOCKBOWL_GAME_PORT} ${SOCKBOWL_QUESTIONS_PORT} ${KEYCLOAK_PORT} ${AUTH_ENABLED}' \
  < /usr/share/nginx/html/assets/config.template.js \
  > /usr/share/nginx/html/assets/config.js

echo "Runtime configuration generated:"
cat /usr/share/nginx/html/assets/config.js

# Build the Content-Security-Policy connect-src / frame-src / form-action
# origins from the same backend location env vars as config.js above, so the
# CSP always matches where the app actually calls out to (AUTH-21).
GAME_HTTP_ORIGIN="${APP_PROTOCOL}://${APP_HOST}:${SOCKBOWL_GAME_PORT}"
GAME_WS_ORIGIN="${WS_PROTOCOL}://${APP_HOST}:${SOCKBOWL_GAME_PORT}"
QUESTIONS_ORIGIN="${APP_PROTOCOL}://${APP_HOST}:${SOCKBOWL_QUESTIONS_PORT}"
KEYCLOAK_ORIGIN="${APP_PROTOCOL}://${APP_HOST}:${KEYCLOAK_PORT}"

export CSP_HEADER_VALUE="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ${GAME_HTTP_ORIGIN} ${GAME_WS_ORIGIN} ${QUESTIONS_ORIGIN} ${KEYCLOAK_ORIGIN} ${CSP_EXTRA_CONNECT_SRC}; worker-src 'self'; frame-src ${KEYCLOAK_ORIGIN}; frame-ancestors 'none'; base-uri 'self'; form-action 'self' ${KEYCLOAK_ORIGIN}; object-src 'none'"

echo "Generating security headers snippet..."
mkdir -p /etc/nginx/snippets
envsubst '${CSP_HEADER_VALUE}' \
  < /etc/nginx/security-headers.conf.template \
  > /etc/nginx/snippets/security-headers.conf

echo "Security headers generated:"
cat /etc/nginx/snippets/security-headers.conf

# Execute the main container command
exec "$@"
