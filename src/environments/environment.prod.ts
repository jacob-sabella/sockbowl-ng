// Declare window.__env type
declare global {
  interface Window {
    __env?: {
      /** Origin of the game backend REST API (bans, users, auth/me). */
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
        /** Where Keycloak sends the browser after end-session (RP-initiated logout). */
        postLogoutRedirectUri?: string;
      };
    };
  }
}

// Use runtime config if available, otherwise use production defaults
const runtimeConfig = window.__env || {
  apiBaseUrl: 'http://localhost:7000',
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
    postLogoutRedirectUri: window.location.origin + '/game-session',
  }
};

/**
 * Origin of a URL, or '' if it cannot be parsed. Used to derive `apiBaseUrl`
 * from `sockbowlGameApiUrl` when an older runtime config (generated before
 * `apiBaseUrl` existed) is served; nothing downstream falls back to localhost.
 */
function originOf(url: string | undefined): string {
  try {
    return url ? new URL(url).origin : '';
  } catch {
    return '';
  }
}

export const environment = {
  production: true,
  ...runtimeConfig,
  apiBaseUrl: runtimeConfig.apiBaseUrl || originOf(runtimeConfig.sockbowlGameApiUrl),
  keycloak: {
    ...runtimeConfig.keycloak,
    postLogoutRedirectUri:
      runtimeConfig.keycloak.postLogoutRedirectUri || window.location.origin + '/game-session',
  },
};
