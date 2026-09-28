/**
 * M5 H0: fakes an `angular-oauth2-oidc` session for role-gated captures
 * (M5 plan §4). `auth.service.ts` only ever decodes the access token's
 * claims (`getRoles`/`hasPermission`) and never verifies its signature, so a
 * well-formed but unsigned JWT is enough — this is documented as sufficient
 * by the plan itself.
 *
 * Role -> permission-role mapping is the ground truth in
 * `sockbowl-docker/keycloak/rbac-model.json`'s `compositeRoles`, expanded the
 * way Keycloak expands composite roles into `realm_access.roles`:
 *   player:    packet:read, game:host
 *   author:    + packet:create, packet:update, packet:delete, question:generate, taxonomy:manage
 *   moderator: player + user:ban
 *   admin:     author + moderator + packet:delete + admin:access + packet:manage-any
 * `banned` carries plain player permissions — a ban is enforced server-side
 * (a REST 403/STOMP BANNED), never as a missing realm role — so the REST/
 * GraphQL mocks are what make a banned capture look banned, not this file.
 */
import type { Page } from '@playwright/test';
import { MOCK_ISSUER } from './config.js';

export type MockRole = 'anonymous' | 'player' | 'author' | 'moderator' | 'admin' | 'banned';

interface RolePreset {
  sub: string;
  username: string;
  email: string;
  name: string;
  roles: string[];
}

const PLAYER_ROLES = ['packet:read', 'game:host'];
const AUTHOR_ROLES = [...PLAYER_ROLES, 'packet:create', 'packet:update', 'packet:delete', 'question:generate', 'taxonomy:manage'];
const MODERATOR_ROLES = [...PLAYER_ROLES, 'user:ban'];
const ADMIN_ROLES = Array.from(new Set([...AUTHOR_ROLES, ...MODERATOR_ROLES, 'admin:access', 'packet:manage-any']));

/** Demo identities, matching `sockbowl-docker/keycloak/rbac-model.json`'s `demoUsers`. */
export const ROLE_PRESETS: Record<Exclude<MockRole, 'anonymous'>, RolePreset> = {
  player: { sub: 'demo-player2', username: 'player2', email: 'player2@sockbowl.com', name: 'Player Two', roles: PLAYER_ROLES },
  author: { sub: 'demo-testuser', username: 'testuser', email: 'testuser@sockbowl.com', name: 'Test User', roles: AUTHOR_ROLES },
  moderator: { sub: 'demo-moderator', username: 'moderator', email: 'moderator@sockbowl.com', name: 'Mod Erator', roles: MODERATOR_ROLES },
  admin: { sub: 'demo-player1', username: 'player1', email: 'player1@sockbowl.com', name: 'Player One', roles: ADMIN_ROLES },
  // A signed-in player whose account is banned. No extra/missing realm role
  // (see file header) — REST/GraphQL fixtures for this sub answer as banned.
  banned: { sub: 'demo-banneduser', username: 'banneduser', email: 'banneduser@sockbowl.com', name: 'Banned User', roles: PLAYER_ROLES },
};

function base64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

/** An unsigned-but-well-formed JWT: `auth.service.ts` decodes the payload and stops there. */
function fakeAccessToken(preset: RolePreset, expSeconds: number): string {
  const header = base64url({ alg: 'none', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url({
    sub: preset.sub,
    preferred_username: preset.username,
    email: preset.email,
    realm_access: { roles: preset.roles },
    iat: now,
    exp: now + expSeconds,
  });
  return `${header}.${payload}.mock-signature`;
}

/**
 * Registers the discovery-document and JWKS routes, and (for every role but
 * `anonymous`) seeds `sessionStorage` with a valid session before the app's
 * own scripts run, via `addInitScript` (so it's there for every navigation
 * in this test, including a reload). Call before `page.goto`.
 */
export async function mockOidc(page: Page, role: MockRole): Promise<void> {
  await page.route(`${MOCK_ISSUER}/.well-known/openid-configuration`, route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      issuer: MOCK_ISSUER,
      authorization_endpoint: `${MOCK_ISSUER}/protocol/openid-connect/auth`,
      token_endpoint: `${MOCK_ISSUER}/protocol/openid-connect/token`,
      end_session_endpoint: `${MOCK_ISSUER}/protocol/openid-connect/logout`,
      userinfo_endpoint: `${MOCK_ISSUER}/protocol/openid-connect/userinfo`,
      jwks_uri: `${MOCK_ISSUER}/protocol/openid-connect/certs`,
      grant_types_supported: ['authorization_code', 'refresh_token'],
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
    }),
  }));
  await page.route(`${MOCK_ISSUER}/protocol/openid-connect/certs`, route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ keys: [] }),
  }));

  if (role === 'anonymous') {
    return;
  }
  const preset = ROLE_PRESETS[role];
  const expiresAtMs = Date.now() + 3600_000;
  const accessToken = fakeAccessToken(preset, 3600);
  const idClaims = { sub: preset.sub, email: preset.email, preferred_username: preset.username, name: preset.name };

  await page.addInitScript(({ accessToken, idClaims, expiresAtMs }) => {
    try {
      const s = window.sessionStorage;
      s.setItem('access_token', accessToken);
      s.setItem('id_token', 'mock-id-token.unsigned');
      s.setItem('id_token_claims_obj', JSON.stringify(idClaims));
      s.setItem('id_token_expires_at', String(expiresAtMs));
      s.setItem('id_token_stored_at', String(Date.now()));
      s.setItem('access_token_stored_at', String(Date.now()));
      s.setItem('expires_at', String(expiresAtMs));
      s.setItem('granted_scopes', JSON.stringify(['openid', 'profile', 'email']));
      s.setItem('session_state', 'mock-session-state');
    } catch {
      // Private-mode/blocked storage: the capture just renders as anonymous.
    }
  }, { accessToken, idClaims, expiresAtMs });
}

/** The `sub` for a role, e.g. to key a REST/GraphQL fixture to "this caller". */
export function subFor(role: MockRole): string | null {
  return role === 'anonymous' ? null : ROLE_PRESETS[role].sub;
}
