// Declare window.__env type
declare global {
  interface Window {
    __env?: {
      apiBaseUrl: string;
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

// Use runtime config if available, otherwise use defaults
const runtimeConfig = window.__env || {
  apiBaseUrl: 'http://localhost:7000',
  sockbowlGameApiUrl: 'http://localhost:7000/api/v1/session',
  sockbowlQuestionsApiUrl: 'http://localhost:7009/',
  wsUrl: 'ws://localhost:7000/sockbowl-game',
  authEnabled: true,
  keycloak: {
    issuer: 'http://localhost:8080/realms/sockbowl',
    clientId: 'sockbowl-game',
    redirectUri: window.location.origin,
    scope: 'openid profile email',
    responseType: 'code',
    showDebugInformation: true,
    requireHttps: false,
  },
};

export const environment = {
  ...runtimeConfig,
};
