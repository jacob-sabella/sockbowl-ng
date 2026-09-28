/**
 * S4: Packet builder (`/packets`, `/packets/:id/edit`) — M5 plan §2 row S4.
 * Needs only GraphQL (questions API) mocks; no STOMP, so this is one of the
 * three SA surfaces H0 can fully capture without the fullstack lock.
 */
import { mockGraphql, type GraphqlHandlers, graphqlError } from '../mock/graphql.js';
import { loadFixture } from '../fixtures/load.js';
import type { CaptureState, SurfaceScenario } from './types.js';

interface PacketFixtures {
  difficulties: unknown[];
  categories: unknown[];
  subcategories: unknown[];
  listItems: Record<string, unknown[]>;
  detail: Record<string, unknown>;
}

const fx = loadFixture<PacketFixtures>('packets.json');

function taxonomyHandlers(): GraphqlHandlers {
  return {
    getAllDifficulties: () => ({ data: { getAllDifficulties: fx.difficulties } }),
    getAllCategories: () => ({ data: { getAllCategories: fx.categories } }),
    getAllSubcategories: () => ({ data: { getAllSubcategories: fx.subcategories } }),
  };
}

function listHandlers(listKey: keyof typeof fx.listItems | 'empty', opts: { loading?: boolean } = {}): GraphqlHandlers {
  return {
    ...taxonomyHandlers(),
    packets: async ({ variables }) => {
      if (opts.loading) await new Promise(r => setTimeout(r, 20_000)); // never resolves within a capture's timeout: proves the loading state
      const items = listKey === 'empty' ? [] : (variables.filter as { mine?: boolean })?.mine ? fx.listItems['mine-only'] : fx.listItems[listKey];
      return { data: { packets: { items, total: items.length, page: 0, size: 25 } } };
    },
  };
}

function builderHandlers(packetId: string, opts: { loading?: boolean } = {}): GraphqlHandlers {
  return {
    ...taxonomyHandlers(),
    getPacketById: async ({ variables }) => {
      if (opts.loading) await new Promise(r => setTimeout(r, 20_000));
      const id = variables['id'] as string;
      return { data: { getPacketById: id === packetId ? fx.detail[packetId] ?? null : null } };
    },
  };
}

const states: CaptureState[] = [
  {
    id: 'list-empty',
    route: '/packets',
    role: 'author',
    setupMocks: async page => mockGraphql(page, listHandlers('empty')),
  },
  {
    id: 'list-populated-own-and-others',
    route: '/packets',
    role: 'author',
    // S4-20: tablet (820) and the 280px floor, on top of the mobile/desktop
    // default, so the stacked mobile row (S4-01) and the filter row are
    // captured at every §2 viewport, not just 390/1440.
    viewports: ['mobile-min', 'mobile', 'tablet', 'desktop'],
    setupMocks: async page => mockGraphql(page, listHandlers('own-and-others')),
  },
  {
    id: 'list-mine-only',
    route: '/packets',
    role: 'author',
    setupMocks: async page => mockGraphql(page, listHandlers('own-and-others')),
    afterGoto: async page => {
      await page.getByText('My packets only', { exact: false }).click();
      await page.waitForTimeout(400); // debounceTime(300) in packet-list.component.ts
    },
  },
  {
    id: 'list-route-denied-player',
    route: '/packets',
    role: 'player', // has no packet:create; permissionGuard redirects to /game-session with a snackbar
    setupMocks: async page => mockGraphql(page, listHandlers('own-and-others')),
  },
  {
    id: 'list-loading',
    route: '/packets',
    role: 'author',
    viewports: ['desktop'],
    themes: ['dark'],
    setupMocks: async page => mockGraphql(page, listHandlers('own-and-others', { loading: true })),
  },
  {
    id: 'builder-empty-new',
    route: '/packets/pkt-empty/edit',
    role: 'author',
    setupMocks: async page => {
      await mockGraphql(page, {
        ...taxonomyHandlers(),
        getPacketById: ({ variables }) => ({
          data: {
            getPacketById: variables['id'] === 'pkt-empty'
              ? { id: 'pkt-empty', name: 'Untitled packet', version: 0, visibility: 'DRAFT', owner: { id: 'demo-testuser', name: 'testuser' }, difficulty: null, validation: { playable: false, tossupCount: 0, bonusCount: 0, issues: [] }, tossups: [], bonuses: [] }
              : null,
          },
        }),
      });
    },
  },
  {
    id: 'builder-populated-published',
    route: '/packets/pkt-own-published/edit',
    role: 'author',
    // S4-20: tablet layout (header action row, drag handle touch target).
    viewports: ['mobile', 'tablet', 'desktop'],
    setupMocks: async page => mockGraphql(page, builderHandlers('pkt-own-published')),
  },
  {
    id: 'builder-validation-warnings',
    route: '/packets/pkt-own-draft/edit',
    role: 'author',
    viewports: ['mobile-min', 'mobile', 'tablet', 'desktop'],
    setupMocks: async page => mockGraphql(page, builderHandlers('pkt-own-draft')),
  },
  {
    id: 'builder-admin-manage-any',
    route: '/packets/pkt-others-published/edit',
    role: 'admin', // packet:manage-any: an admin may open a packet they don't own
    setupMocks: async page => mockGraphql(page, builderHandlers('pkt-others-published')),
  },
  {
    id: 'builder-load-error',
    route: '/packets/pkt-missing/edit',
    role: 'author',
    setupMocks: async page => {
      await mockGraphql(page, {
        ...taxonomyHandlers(),
        getPacketById: () => graphqlError('Packet not found.', 'NOT_FOUND'),
      });
    },
  },
  {
    id: 'builder-loading',
    route: '/packets/pkt-own-published/edit',
    role: 'author',
    viewports: ['desktop'],
    themes: ['dark'],
    setupMocks: async page => mockGraphql(page, builderHandlers('pkt-own-published', { loading: true })),
  },
];

const s4: SurfaceScenario = { id: 'S4', title: 'Packet builder', tag: 's4', port: 4204, states };
export default s4;
