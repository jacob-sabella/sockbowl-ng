// Runtime configuration template
// Environment variables will be substituted at container startup
window.__env = {
  sockbowlGameApiUrl: '${APP_PROTOCOL}://${APP_HOST}:${SOCKBOWL_GAME_PORT}/api/v1/session',
  sockbowlQuestionsApiUrl: '${APP_PROTOCOL}://${APP_HOST}:${SOCKBOWL_QUESTIONS_PORT}/',
  wsUrl: '${WS_PROTOCOL}://${APP_HOST}:${SOCKBOWL_GAME_PORT}/sockbowl-game',
  authEnabled: ${AUTH_ENABLED},
  keycloak: {
    issuer: '${APP_PROTOCOL}://${APP_HOST}:${KEYCLOAK_PORT}/realms/sockbowl',
    clientId: 'sockbowl-game',
    redirectUri: window.location.origin,
    scope: 'openid profile email',
    responseType: 'code',
    showDebugInformation: ${AUTH_ENABLED} === false,
    requireHttps: '${APP_PROTOCOL}' === 'https'
  }
};
