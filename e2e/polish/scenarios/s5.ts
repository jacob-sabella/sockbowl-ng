/**
 * S5: Admin (`/admin`, `/admin/usage`, `/admin/bans`, `/admin/taxonomy`) —
 * M5 plan §2 row S5. REST (bans, usage) + GraphQL (taxonomy) mocks only; no
 * STOMP, so this is one of the three SA surfaces H0 can fully capture
 * without the fullstack lock.
 */
import { mockGraphql } from '../mock/graphql.js';
import { mockRest, ok, apiError, type RestRoute } from '../mock/rest.js';
import { loadFixture } from '../fixtures/load.js';
import type { CaptureState, SurfaceScenario } from './types.js';

/**
 * M5 plan §4 AY row: the `final` capture adds tablet for S4 and S5, on top
 * of the {mobile, desktop} x {dark, light} matrix every phase captures.
 * Scoped to `POLISH_PHASE=final` only, so `baseline`/`post-f1` stay exactly
 * as H0/F1 recorded them (no retroactive tablet rows in earlier phases).
 */
const FINAL_PHASE = process.env.POLISH_PHASE === 'final';
const STANDARD_VIEWPORTS = FINAL_PHASE ? ['mobile', 'desktop', 'tablet'] : ['mobile', 'desktop'];

interface BansFixtures {
  populated: { bans: unknown[]; ipBans: unknown[] };
  empty: { bans: unknown[]; ipBans: unknown[] };
  cidrError: { code: string; message: string };
}
interface UsageFixtures {
  global: unknown;
  globalPartial: unknown;
  page: unknown;
  detail: unknown;
  events: unknown[];
}
interface TaxonomyFixtures {
  difficulties: unknown[];
  categories: unknown[];
  subcategories: unknown[];
}

const bansFx = loadFixture<BansFixtures>('bans.json');
const usageFx = loadFixture<UsageFixtures>('usage.json');
const taxonomyFx = loadFixture<TaxonomyFixtures>('packets.json');

const taxonomyGraphqlHandlers = () => ({
  getAllDifficulties: () => ({ data: { getAllDifficulties: taxonomyFx.difficulties } }),
  getAllCategories: () => ({ data: { getAllCategories: taxonomyFx.categories } }),
  getAllSubcategories: () => ({ data: { getAllSubcategories: taxonomyFx.subcategories } }),
});

function bansRoutes(kind: 'populated' | 'empty'): RestRoute[] {
  const data = bansFx[kind];
  return [
    { method: 'GET', template: '/api/v1/admin/bans', handler: () => ok(data.bans) },
    { method: 'GET', template: '/api/v1/admin/bans/ip', handler: () => ok(data.ipBans) },
    { method: 'POST', template: '/api/v1/admin/bans', handler: () => ok({ id: 'ban-new', bannedKeycloakId: 'demo-someone', reason: 'Mock-created ban', bannedBy: 'player1', createdAt: new Date().toISOString(), expiresAt: null }) },
    { method: 'DELETE', template: '/api/v1/admin/bans/:id', handler: () => ({ status: 204 }) },
    { method: 'POST', template: '/api/v1/admin/bans/ip', handler: () => apiError(422, bansFx.cidrError.code, bansFx.cidrError.message) },
    { method: 'DELETE', template: '/api/v1/admin/bans/ip/:id', handler: () => ({ status: 204 }) },
  ];
}

function usageRoutes(opts: { partial?: boolean; loading?: boolean } = {}): RestRoute[] {
  return [
    {
      method: 'GET', template: '/api/v1/admin/usage/global', handler: async () => {
        if (opts.loading) await new Promise(r => setTimeout(r, 20_000));
        return opts.partial ? apiError(502, 'UPSTREAM_UNAVAILABLE', 'Could not reach questions for packet counts') : ok(usageFx.global);
      },
    },
    { method: 'GET', template: '/api/v1/admin/usage/events', handler: () => ok(usageFx.events) },
    { method: 'GET', template: '/api/v1/admin/usage/:sub', handler: () => ok(usageFx.detail) },
    { method: 'PUT', template: '/api/v1/admin/usage/:sub/quota/:metric', handler: () => ({ status: 204 }) },
    { method: 'POST', template: '/api/v1/admin/usage/:sub/reset', handler: () => ({ status: 204 }) },
    {
      method: 'GET', template: '/api/v1/admin/usage', handler: async () => {
        if (opts.loading) await new Promise(r => setTimeout(r, 20_000));
        return ok(usageFx.page);
      },
    },
  ];
}

const states: CaptureState[] = [
  {
    id: 'home-admin',
    route: '/admin',
    role: 'admin',
    viewports: STANDARD_VIEWPORTS,
    setupMocks: async page => mockRest(page, usageRoutes()),
  },
  {
    // S5-19: `/admin` requires `admin:access` (app-routing.module.ts, frozen);
    // a moderator (user:ban only) never sees an admin hub with "limited
    // cards" — permissionGuard redirects to /game-session with a snackbar,
    // same as `home-route-denied-player` below. Needs input N-01 keeps that
    // redirect as the M5 default. The moderator's actual, permitted view is
    // `bans-empty` (role: moderator, route /admin/bans) below.
    id: 'admin-hub-denied-moderator',
    route: '/admin',
    role: 'moderator',
    viewports: STANDARD_VIEWPORTS,
    setupMocks: async page => mockRest(page, usageRoutes()),
  },
  {
    id: 'home-usage-partial',
    route: '/admin',
    role: 'admin',
    viewports: STANDARD_VIEWPORTS,
    setupMocks: async page => mockRest(page, usageRoutes({ partial: true })),
  },
  {
    id: 'bans-populated',
    route: '/admin/bans',
    role: 'admin',
    viewports: STANDARD_VIEWPORTS,
    setupMocks: async page => mockRest(page, bansRoutes('populated')),
  },
  {
    id: 'bans-empty',
    route: '/admin/bans',
    role: 'moderator',
    viewports: STANDARD_VIEWPORTS,
    setupMocks: async page => mockRest(page, bansRoutes('empty')),
  },
  {
    id: 'usage-table-populated',
    route: '/admin/usage',
    role: 'admin',
    viewports: STANDARD_VIEWPORTS,
    setupMocks: async page => mockRest(page, usageRoutes()),
  },
  {
    id: 'usage-loading',
    route: '/admin/usage',
    role: 'admin',
    viewports: ['desktop'],
    themes: ['dark'],
    setupMocks: async page => mockRest(page, usageRoutes({ loading: true })),
  },
  {
    id: 'taxonomy-admin',
    route: '/admin/taxonomy',
    role: 'admin',
    viewports: STANDARD_VIEWPORTS,
    setupMocks: async page => mockGraphql(page, taxonomyGraphqlHandlers()),
  },
  {
    id: 'taxonomy-denied-player',
    route: '/admin/taxonomy',
    role: 'player', // lacks taxonomy:manage; permissionGuard redirects to /game-session
    viewports: STANDARD_VIEWPORTS,
    setupMocks: async page => mockGraphql(page, taxonomyGraphqlHandlers()),
  },
  {
    id: 'home-route-denied-player',
    route: '/admin',
    role: 'player', // lacks admin:access
    viewports: STANDARD_VIEWPORTS,
    setupMocks: async page => mockRest(page, usageRoutes()),
  },
];

const s5: SurfaceScenario = { id: 'S5', title: 'Admin', tag: 's5', port: 4205, states };
export default s5;
