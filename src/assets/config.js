// Development configuration
window.__env = {
  sockbowlGameApiUrl: 'http://localhost:7000/api/v1/session',
  sockbowlQuestionsApiUrl: 'http://localhost:7009/',
  wsUrl: 'ws://localhost:7000/sockbowl-game',
  authEnabled: true,
  keycloak: {
    issuer: 'http://localhost:8080/realms/sockbowl',
    clientId: 'sockbowl-game',
    redirectUri: window.location.origin + '/game-session',
    scope: 'openid profile email',
    responseType: 'code',
    showDebugInformation: true,
    requireHttps: false
  }
};
