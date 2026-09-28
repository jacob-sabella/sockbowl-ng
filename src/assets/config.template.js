// Runtime configuration template
// Environment variables will be substituted at container startup
// The five URLs below come from docker-entrypoint.sh, which computes them
// once in either port mode (today's per-service host:port, the default) or
// M7 path mode (SOCKBOWL_PUBLIC_URL set: everything under one public host) --
// see plans/m7-deploy.md §3.1 item 1. This template only substitutes those
// five variables; it never needs to know which mode produced them.
window.__env = {
  apiBaseUrl: "${CFG_API_BASE}",
  sockbowlGameApiUrl: "${CFG_GAME_API}",
  sockbowlQuestionsApiUrl: "${CFG_QUESTIONS_API}",
  wsUrl: "${CFG_WS_URL}",
  authEnabled: "${AUTH_ENABLED}" === "true",
  keycloak: {
    issuer: "${CFG_KC_ISSUER}",
    clientId: "sockbowl-game",
    redirectUri: window.location.origin + "/game-session",
    scope: "openid profile email",
    responseType: "code",
    showDebugInformation: false,
    requireHttps: "${CFG_API_BASE}".startsWith("https://"),
    postLogoutRedirectUri: window.location.origin + "/game-session",
  },
};
