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

# Generate config.js from template
echo "Generating runtime configuration..."
envsubst '${APP_HOST} ${APP_PROTOCOL} ${WS_PROTOCOL} ${SOCKBOWL_GAME_PORT} ${SOCKBOWL_QUESTIONS_PORT} ${KEYCLOAK_PORT} ${AUTH_ENABLED}' \
  < /usr/share/nginx/html/assets/config.template.js \
  > /usr/share/nginx/html/assets/config.js

echo "Runtime configuration generated:"
cat /usr/share/nginx/html/assets/config.js

# Execute the main container command
exec "$@"
