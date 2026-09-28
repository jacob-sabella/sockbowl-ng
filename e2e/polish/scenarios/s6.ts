/**
 * S6: Shell, nav, profile, login (every page chrome, `/profile`, `/`) —
 * M5 plan §2 row S6. REST mocks only (profile); no STOMP, so this is one of
 * the three SA surfaces H0 can fully capture without the fullstack lock.
 *
 * `unknown-route-current` captures today's (pre-F1) behaviour of an
 * unmatched route: there is no `**` route yet (F1 adds a `NotFoundComponent`
 * stub per the M5 plan §4/§5) — H0 runs in Wave 0, before F1, so this is a
 * genuine baseline row, not a mistake.
 */
import type { Page } from '@playwright/test';
import { mockRest, ok, apiError, type RestRoute } from '../mock/rest.js';
import { mockStompReplay } from '../mock/stomp-replay.js';
import { loadFixture } from '../fixtures/load.js';
import type { CaptureState, SurfaceScenario } from './types.js';

interface UsersFixtures {
  me: Record<string, unknown>;
  stats: Record<string, unknown>;
  history: { populated: { content: unknown[]; totalPages: number; totalElements: number; size: number; number: number }; empty: unknown };
}

const usersFx = loadFixture<UsersFixtures>('users.json');

/** Distinct-copy error classes wired by the profile page (S6-10). */
type ProfileErrorKind = 401 | 403 | 500;

function profileRoutes(sub: string, opts: {
  error?: boolean;
  errorKind?: ProfileErrorKind;
  loading?: boolean;
  noHistory?: boolean;
  /** Page 0 loads; any later page 404s the request (S6-10's history-only error). */
  historyPageError?: boolean;
} = {}): RestRoute[] {
  const delay = async () => { if (opts.loading) await new Promise(r => setTimeout(r, 20_000)); };
  const kind: ProfileErrorKind = opts.errorKind ?? 500;
  const fail = (label: string) => apiError(
    kind,
    kind === 401 ? 'UNAUTHORIZED' : kind === 403 ? 'FORBIDDEN' : 'INTERNAL',
    `Something went wrong loading your ${label}.`
  );
  return [
    {
      method: 'GET', template: '/api/v1/auth/me', handler: async () => {
        await delay();
        if (opts.error) return fail('profile');
        return ok(usersFx.me[sub]);
      },
    },
    {
      method: 'GET', template: '/api/v1/user/stats', handler: async () => {
        await delay();
        if (opts.error) return fail('stats');
        return ok(usersFx.stats[sub] ?? { id: 'st-x', userId: sub, totalGames: 0, totalWins: 0, totalBuzzes: 0, correctBuzzes: 0, updatedAt: new Date().toISOString() });
      },
    },
    {
      method: 'GET', template: '/api/v1/user/history', handler: async ctx => {
        await delay();
        if (opts.error) return fail('history');
        if (opts.historyPageError) {
          const page = Number(ctx.query.get('page') ?? '0');
          if (page > 0) return apiError(500, 'INTERNAL', 'Something went wrong loading your history.');
          // Claim a second page exists so a "Next page" click is possible to capture.
          return ok({ ...usersFx.history.populated, totalPages: 2 });
        }
        return ok(opts.noHistory ? usersFx.history.empty : usersFx.history.populated);
      },
    },
  ];
}

/**
 * S6-11: overrides the display name a signed-in capture renders with, by
 * registering a second `addInitScript` that runs after `mockOidc`'s (the
 * capture harness always calls `mockOidc` before a state's `setupMocks`) —
 * it rewrites the `id_token_claims_obj` that `AuthService.updateUserProfile`
 * reads `name` from, so no shared harness file needs touching.
 */
async function overrideDisplayName(page: Page, name: string): Promise<void> {
  await page.addInitScript(injectedName => {
    try {
      const raw = window.sessionStorage.getItem('id_token_claims_obj');
      if (!raw) return;
      const claims = JSON.parse(raw);
      claims.name = injectedName;
      window.sessionStorage.setItem('id_token_claims_obj', JSON.stringify(claims));
    } catch {
      // Private-mode/blocked storage: falls back to whatever mockOidc set.
    }
  }, name);
}

const states: CaptureState[] = [
  {
    id: 'nav-guest',
    route: '/game-session',
    role: 'anonymous',
    setupMocks: async () => {},
  },
  {
    id: 'nav-player',
    route: '/game-session',
    role: 'player',
    setupMocks: async () => {},
  },
  {
    id: 'nav-author',
    route: '/game-session',
    role: 'author',
    setupMocks: async () => {},
  },
  {
    id: 'nav-moderator',
    route: '/game-session',
    role: 'moderator',
    setupMocks: async () => {},
  },
  {
    id: 'nav-admin',
    route: '/game-session',
    role: 'admin',
    setupMocks: async () => {},
  },
  {
    id: 'nav-auth-off',
    route: '/game-session',
    role: 'player',
    authEnabled: false,
    setupMocks: async () => {},
  },
  {
    id: 'nav-280-min-width',
    route: '/game-session',
    role: 'player',
    viewports: ['mobile-min'],
    setupMocks: async () => {},
  },
  {
    id: 'theme-menu-open',
    route: '/game-session',
    role: 'player',
    themes: ['dark'],
    setupMocks: async () => {},
    afterGoto: async page => {
      await page.getByLabel('Theme selector').click();
      await page.waitForTimeout(150);
    },
  },
  {
    id: 'profile-populated',
    route: '/profile',
    role: 'player',
    setupMocks: async page => mockRest(page, profileRoutes('demo-player2')),
  },
  {
    id: 'profile-empty-history',
    route: '/profile',
    role: 'author',
    setupMocks: async page => mockRest(page, profileRoutes('demo-testuser', { noHistory: true })),
  },
  {
    // Default (no errorKind) is the 500 case: "something went wrong".
    id: 'profile-error',
    route: '/profile',
    role: 'player',
    setupMocks: async page => mockRest(page, profileRoutes('demo-player2', { error: true })),
  },
  {
    // S6-10: 401 gets distinct "signed out" copy and a Sign In action, not
    // a Retry that would just fail the same way again. No refresh token is
    // seeded (mock/oidc.ts), so the real auth.interceptor 401 -> refresh ->
    // handleSessionEnded path runs, matching S6-06's "token-refresh-failure"
    // capture: the navbar and the profile card both show the recovery.
    id: 'profile-error-401',
    route: '/profile',
    role: 'player',
    setupMocks: async page => mockRest(page, profileRoutes('demo-player2', { error: true, errorKind: 401 })),
  },
  {
    id: 'profile-error-403',
    route: '/profile',
    role: 'player',
    viewports: ['desktop'],
    themes: ['dark'],
    setupMocks: async page => mockRest(page, profileRoutes('demo-player2', { error: true, errorKind: 403 })),
  },
  {
    // S6-10: a later page's failure errors only the history card; the user
    // and stats cards stay up. Captured after clicking "Next page".
    id: 'profile-history-error',
    route: '/profile',
    role: 'player',
    viewports: ['desktop'],
    themes: ['dark'],
    setupMocks: async page => mockRest(page, profileRoutes('demo-player2', { historyPageError: true })),
    afterGoto: async page => {
      await page.getByLabel('Next page').click();
      await page.waitForTimeout(200);
    },
  },
  {
    id: 'profile-loading',
    route: '/profile',
    role: 'player',
    viewports: ['desktop'],
    themes: ['dark'],
    setupMocks: async page => mockRest(page, profileRoutes('demo-player2', { loading: true })),
  },
  {
    // S6-06: a legitimate anonymous seat (never signed in) gets no Sign In
    // nag inside /game — the ordinary guest chrome stays hidden there.
    id: 'nav-in-game-guest-seat',
    route: '/game;gameSessionId=s6-nav-demo;playerSessionId=s6-nav-demo-player;playerSecret=s6-nav-demo-secret',
    role: 'anonymous',
    viewports: ['mobile'],
    themes: ['dark'],
    setupMocks: async page => mockStompReplay(page, { gameSessionId: 's6-nav-demo', playerSessionId: 's6-nav-demo-player', frames: [] }),
  },
  {
    // S6-06: today a session that ends underneath the user in /game leaves
    // no way back in but a 10s toast; the fix keeps a persistent Sign In in
    // the bar. Driven through Angular's dev-mode `ng.getComponent` hook
    // (available because the harness always serves with `ng serve`, not a
    // production build) rather than a real token-expiry timer, so the
    // capture is deterministic.
    id: 'nav-session-ended-in-game',
    route: '/game;gameSessionId=s6-nav-demo;playerSessionId=s6-nav-demo-player;playerSecret=s6-nav-demo-secret',
    role: 'player',
    viewports: ['mobile'],
    themes: ['dark'],
    setupMocks: async page => mockStompReplay(page, { gameSessionId: 's6-nav-demo', playerSessionId: 's6-nav-demo-player', frames: [] }),
    afterGoto: async page => {
      await page.waitForSelector('app-navbar', { state: 'attached' });
      await page.evaluate(() => {
        const navbarEl = document.querySelector('app-navbar');
        const ngGlobal = (window as unknown as { ng?: { getComponent?: (el: Element) => { authService?: { handleSessionEnded?: () => void } } | null } }).ng;
        const comp = navbarEl && ngGlobal?.getComponent?.(navbarEl);
        comp?.authService?.handleSessionEnded?.();
      });
      await page.waitForTimeout(300);
    },
  },
  {
    // S6-06: signing out mid-game confirms first, since it drops the seat.
    id: 'nav-signout-confirm-in-game',
    route: '/game;gameSessionId=s6-nav-demo;playerSessionId=s6-nav-demo-player;playerSecret=s6-nav-demo-secret',
    role: 'player',
    viewports: ['mobile'],
    themes: ['dark'],
    setupMocks: async page => mockStompReplay(page, { gameSessionId: 's6-nav-demo', playerSessionId: 's6-nav-demo-player', frames: [] }),
    afterGoto: async page => {
      await page.getByLabel(/^Account menu,/).click();
      await page.waitForTimeout(150);
      await page.getByRole('menuitem', { name: 'Sign out' }).click();
      await page.waitForTimeout(150);
    },
  },
  {
    // S6-11: a long, unbroken display name must truncate with an ellipsis
    // (not wrap the toolbar to two lines) and keep the full name reachable
    // via the span's `title`.
    id: 'nav-name-long',
    route: '/game-session',
    role: 'player',
    viewports: ['desktop'],
    themes: ['dark'],
    setupMocks: async page => overrideDisplayName(page, 'Bartholomew-Maximilian-Fitzgerald-Worthington the Third'),
  },
  {
    // S6-11: emoji in a display name must render and not break the flex
    // layout or icon alignment either side of it.
    id: 'nav-name-emoji',
    route: '/game-session',
    role: 'player',
    viewports: ['desktop'],
    themes: ['dark'],
    setupMocks: async page => overrideDisplayName(page, '🎉 Player 🎮'),
  },
  {
    // S6-11: an RTL display name must not scramble the LTR chrome around it
    // (icon, caret) — `dir="auto"` on the label scopes bidi to the name only.
    id: 'nav-name-rtl',
    route: '/game-session',
    role: 'player',
    viewports: ['desktop'],
    themes: ['dark'],
    setupMocks: async page => overrideDisplayName(page, 'مستخدم تجريبي طويل جدا'),
  },
  {
    // S6-11: the version-check snackbar, driven through the dev-mode
    // `ng.getComponent` hook on <app-root> (see VersionCheckService's
    // header comment on `offerReload` for why the real interval/
    // visibilitychange path never fires under this harness's `ng serve`).
    // Renders once — `offerReload` itself opens exactly one snack bar.
    id: 'nav-version-update',
    route: '/game-session',
    role: 'player',
    viewports: ['mobile'],
    themes: ['dark'],
    setupMocks: async () => {},
    afterGoto: async page => {
      await page.waitForSelector('app-root', { state: 'attached' });
      await page.evaluate(() => {
        const rootEl = document.querySelector('app-root');
        const ngGlobal = (window as unknown as { ng?: { getComponent?: (el: Element) => { versionCheck?: { offerReload?: () => void } } | null } }).ng;
        const comp = rootEl && ngGlobal?.getComponent?.(rootEl);
        comp?.versionCheck?.offerReload?.();
      });
      await page.waitForTimeout(300);
    },
  },
  {
    // S6-11: an anonymous visitor hitting a guarded route (e.g. /profile)
    // is sent straight into a real (mocked-issuer) Keycloak redirect by
    // `authenticatedGuard`/`permissionGuard` (`AuthService.login` ->
    // `oauthService.initCodeFlow`, a synchronous `window.location` nav) —
    // by design, before any Sockbowl chrome paints. `mock/oidc.ts` only
    // stubs the discovery document and JWKS, not the authorization
    // endpoint itself, so there is no in-app state to screenshot here;
    // driving the navigation further would test Keycloak's UI, not S6's.
    id: 'nav-guest-on-guarded-route',
    route: '/profile',
    role: 'anonymous',
    setupMocks: async () => {},
    skip: 'redirects off-app to Keycloak login before any Sockbowl UI renders (authenticatedGuard); nothing in-app to capture',
  },
  {
    id: 'unknown-route-current',
    route: '/this-route-does-not-exist',
    role: 'player',
    setupMocks: async () => {},
  },
];

const s6: SurfaceScenario = { id: 'S6', title: 'Shell, nav, profile, login', tag: 's6', port: 4206, states };
export default s6;
