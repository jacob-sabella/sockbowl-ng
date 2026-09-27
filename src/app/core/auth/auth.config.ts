import { AuthConfig } from 'angular-oauth2-oidc';
import { environment } from '../../../environments/environment';

/**
 * OAuth2/OIDC configuration for Keycloak authentication.
 *
 * This configuration is used by angular-oauth2-oidc library to
 * authenticate users via Keycloak.
 */
export const authConfig: AuthConfig = {
  // Keycloak realm issuer URL
  issuer: environment.keycloak.issuer,

  // OAuth2 client ID registered in Keycloak
  clientId: environment.keycloak.clientId,

  // Redirect URI after successful login
  redirectUri: environment.keycloak.redirectUri,

  // OAuth2 scopes to request
  scope: environment.keycloak.scope,

  // OAuth2 response type (authorization code flow)
  responseType: environment.keycloak.responseType,

  // Enable OIDC mode
  oidc: true,

  // Explicitly request access token
  requestAccessToken: true,

  // Disable HTTPS requirement for local development
  requireHttps: environment.keycloak.requireHttps,

  // Show debug information in console
  showDebugInformation: environment.keycloak.showDebugInformation,

  // Token validation
  skipIssuerCheck: false,
  strictDiscoveryDocumentValidation: false,

  // Session checks - disabled to avoid interfering with long-running requests (e.g., AI generation)
  sessionChecksEnabled: false,
  clearHashAfterLogin: true,

  // Refresh-token flow (AUTH-13). The silent-refresh iframe is gone: Keycloak
  // issues refresh tokens to public code-flow clients and rotates them
  // (revokeRefreshToken=true), so AuthService drives refreshToken() itself on
  // `token_expires` and on 401s, deduplicating concurrent refreshes.
  useSilentRefresh: false,

  // Where Keycloak sends the browser after RP-initiated logout. Must be listed
  // in the client's post.logout.redirect.uris.
  postLogoutRedirectUri: environment.keycloak.postLogoutRedirectUri,

  // PKCE (enabled by default for code flow, but making it explicit)
  disablePKCE: false,
};
