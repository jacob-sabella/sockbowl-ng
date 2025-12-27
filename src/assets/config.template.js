// Runtime configuration template
// Environment variables will be substituted at container startup
window.__env = {
  sockbowlGameApiUrl:
    "${APP_PROTOCOL}://${APP_HOST}:${SOCKBOWL_GAME_PORT}/api/v1/session",
  sockbowlQuestionsApiUrl:
    "${APP_PROTOCOL}://${APP_HOST}:${SOCKBOWL_QUESTIONS_PORT}/",
  wsUrl: "${WS_PROTOCOL}://${APP_HOST}:${SOCKBOWL_GAME_PORT}/sockbowl-game",
  authEnabled: "${AUTH_ENABLED}" === "true",
  keycloak: {
    issuer: "${APP_PROTOCOL}://${APP_HOST}:${KEYCLOAK_PORT}/realms/sockbowl",
    clientId: "sockbowl-game",
    redirectUri: window.location.origin + "/game-session",
    scope: "openid profile email",
    responseType: "code",
    showDebugInformation: false,
    requireHttps: "${APP_PROTOCOL}" === "https",
  },
};
