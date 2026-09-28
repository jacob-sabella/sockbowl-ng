/**
 * S4: Packet builder (`/packets`, `/packets/:id/edit`) — M5 plan §2 row S4.
 * Needs only GraphQL (questions API) mocks; no STOMP, so this is one of the
 * three SA surfaces H0 can fully capture without the fullstack lock.
 */
import { mockGraphql, type GraphqlHandlers, graphqlError } from '../mock/graphql.js';
import { loadFixture } from '../fixtures/load.js';
import { focusByKeyboard } from '../focus.js';
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
    // FF2 (finish review remaining #3/fix 7): no other state expands a
    // bonus panel, so "Parts" (packet-builder.component.scss
    // `&__parts-title`) never appeared in any capture the reviewer could
    // read. This state opens bonus #1 before the screenshot so the
    // display-voice fix on that heading is actually evidenced.
    id: 'builder-bonus-expanded',
    route: '/packets/pkt-own-published/edit',
    role: 'author',
    setupMocks: async page => mockGraphql(page, builderHandlers('pkt-own-published')),
    afterGoto: async page => {
      // Cut Material's expansion animation so the capture doesn't land
      // mid-turn (FF2 verdict: the chevron and header were caught
      // half-opened because the screenshot raced the panel's own CSS
      // transition).
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const firstBonusHeader = page.locator('.packet-builder__bonuses mat-expansion-panel-header').first();
      await firstBonusHeader.click();
      // Wait for Material's own expanded state, not just content
      // visibility: `.packet-builder__parts-title` is already in the DOM
      // (see the `.first()` note below) before the panel finishes opening,
      // so waiting on it alone resolved on a mid-animation frame.
      // `aria-expanded="true"` only flips once the panel has actually
      // opened.
      await page.locator('.packet-builder__bonuses mat-expansion-panel-header[aria-expanded="true"]').first().waitFor({ state: 'visible' });
      // `.first()` by DOM order, not `getByText` (Material keeps every
      // panel's content in the DOM even collapsed, so "Parts" is present
      // for every bonus and `getByText(exact)` hits strict-mode's
      // multiple-match error). The first bonus in the list is the one the
      // click above just expanded.
      await page.locator('.packet-builder__parts-title').first().waitFor({ state: 'visible' });
      // Let the animation settle even with reduced motion honoured (some
      // Material transitions still run a short opacity/height tween) and
      // give layout a beat to finish before the screenshot.
      await page.waitForTimeout(400);
      // The click can leave the page scrolled to the bonus panel; the
      // capture harness always wants the document top, navbar included.
      await page.evaluate(() => window.scrollTo(0, 0));
    },
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
  {
    // M5 recheck: focus-ring evidence for the F2 token move's
    // `--focus-ring`. A real `Tab` press (not a scripted `.focus()`) lands
    // on the enabled "Play test" button (`pkt-own-published` is playable),
    // so the capture shows the actual `:focus-visible` a keyboard user gets.
    id: 'focus-play-test-button',
    route: '/packets/pkt-own-published/edit',
    role: 'author',
    viewports: ['mobile', 'tablet'],
    setupMocks: async page => mockGraphql(page, builderHandlers('pkt-own-published')),
    afterGoto: async page => {
      await focusByKeyboard(page, page.getByRole('button', { name: 'Play test' }));
      await page.waitForTimeout(150);
    },
  },
  {
    // M5 recheck: same focus-ring evidence, for a tossup's
    // `mat-expansion-panel-header` (role="button" via Material, not a
    // native <button>) — a different focus-ring code path than an actual
    // <button> element.
    id: 'focus-tossup-expansion-header',
    route: '/packets/pkt-own-published/edit',
    role: 'author',
    viewports: ['mobile', 'tablet'],
    setupMocks: async page => mockGraphql(page, builderHandlers('pkt-own-published')),
    afterGoto: async page => {
      await focusByKeyboard(page, page.locator('.packet-builder__tossups mat-expansion-panel-header').first());
      await page.waitForTimeout(150);
    },
  },
];

const s4: SurfaceScenario = { id: 'S4', title: 'Packet builder', tag: 's4', port: 4204, states };
export default s4;
