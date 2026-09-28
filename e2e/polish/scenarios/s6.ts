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
import { mockRest, ok, apiError, type RestRoute } from '../mock/rest.js';
import { loadFixture } from '../fixtures/load.js';
import type { CaptureState, SurfaceScenario } from './types.js';

interface UsersFixtures {
  me: Record<string, unknown>;
  stats: Record<string, unknown>;
  history: { populated: unknown; empty: unknown };
}

const usersFx = loadFixture<UsersFixtures>('users.json');

function profileRoutes(sub: string, opts: { error?: boolean; loading?: boolean; noHistory?: boolean } = {}): RestRoute[] {
  const delay = async () => { if (opts.loading) await new Promise(r => setTimeout(r, 20_000)); };
  return [
    {
      method: 'GET', template: '/api/v1/auth/me', handler: async () => {
        await delay();
        if (opts.error) return apiError(500, 'INTERNAL', 'Something went wrong loading your profile.');
        return ok(usersFx.me[sub]);
      },
    },
    {
      method: 'GET', template: '/api/v1/user/stats', handler: async () => {
        await delay();
        if (opts.error) return apiError(500, 'INTERNAL', 'Something went wrong loading your stats.');
        return ok(usersFx.stats[sub] ?? { id: 'st-x', userId: sub, totalGames: 0, totalWins: 0, totalBuzzes: 0, correctBuzzes: 0, updatedAt: new Date().toISOString() });
      },
    },
    {
      method: 'GET', template: '/api/v1/user/history', handler: async () => {
        await delay();
        if (opts.error) return apiError(500, 'INTERNAL', 'Something went wrong loading your history.');
        return ok(opts.noHistory ? usersFx.history.empty : usersFx.history.populated);
      },
    },
  ];
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
    id: 'profile-error',
    route: '/profile',
    role: 'player',
    setupMocks: async page => mockRest(page, profileRoutes('demo-player2', { error: true })),
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
    id: 'unknown-route-current',
    route: '/this-route-does-not-exist',
    role: 'player',
    setupMocks: async () => {},
  },
];

const s6: SurfaceScenario = { id: 'S6', title: 'Shell, nav, profile, login', tag: 's6', port: 4206, states };
export default s6;
