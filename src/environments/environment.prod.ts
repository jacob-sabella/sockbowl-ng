// Declare window.__env type
declare global {
  interface Window {
    __env?: {
      sockbowlGameApiUrl: string;
      sockbowlQuestionsApiUrl: string;
      wsUrl: string;
      authEnabled: boolean;
      keycloak: {
        issuer: string;
        clientId: string;
        redirectUri: string;
        scope: string;
        responseType: string;
        showDebugInformation: boolean;
        requireHttps: boolean;
      };
    };
  }
}

// Use runtime config if available, otherwise use production defaults
const runtimeConfig = window.__env || {
  sockbowlGameApiUrl: 'http://localhost:7000/api/v1/session',
  sockbowlQuestionsApiUrl: 'http://localhost:7009/',
  wsUrl: 'ws://localhost:7000/sockbowl-game',
  authEnabled: false,
  keycloak: {
    issuer: 'http://localhost:8080/realms/sockbowl',
    clientId: 'sockbowl-game',
    redirectUri: window.location.origin,
    scope: 'openid profile email',
    responseType: 'code',
    showDebugInformation: false,
    requireHttps: true,
  }
};

export const environment = {
  production: true,
  ...runtimeConfig,
};
