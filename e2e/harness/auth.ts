// Direct (non-browser) token acquisition for harness-only REST/STOMP flows
// that need to authenticate as a demo account without a Playwright `page`
// (e.g. a bot or a raw `fetch`-based host in a spec that never opens a
// browser context for that role). `tests-auth/helpers/login.ts` covers the
// browser-driven case; this covers the rest.
//
// Uses the `sockbowl-e2e` client's direct (Resource Owner Password
// Credentials) grant -- the same client and demo password
// (`rbac-model.json`'s `clients`/`demoUsers`, `keycloak/clients/sockbowl-e2e.json`)
// the sockbowl-docker compose stack provisions specifically for this kind of
// script-driven login when `SOCKBOWL_E2E=true`.

const KEYCLOAK_BASE = process.env.SOCKBOWL_KEYCLOAK ?? 'http://localhost:8080';
const REALM = process.env.SOCKBOWL_KEYCLOAK_REALM ?? 'sockbowl';
const CLIENT_ID = process.env.SOCKBOWL_KEYCLOAK_CLIENT ?? 'sockbowl-e2e';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo123';

/**
 * Fetches a fresh access token for a demo account via the direct grant.
 * Subject-keyed (per D-account) server-side limits (rate limits, quotas)
 * treat a call made with this token as that account, not as the shared
 * guest IP every unauthenticated harness `fetch` collapses to under
 * `network_mode: host` (see rate-limit.spec.ts's STOMP test comment).
 */
export async function getDemoAccessToken(username: string, password: string = DEMO_PASSWORD): Promise<string> {
  const res = await fetch(`${KEYCLOAK_BASE}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: CLIENT_ID,
      username,
      password,
    }),
  });
  if (!res.ok) {
    throw new Error(`getDemoAccessToken(${username}) ${res.status}: ${await res.text()}`);
  }
  const body: any = await res.json();
  return body.access_token as string;
}
