/**
 * M5 H0: the mocked-capture harness (M5 plan §4 H0, §6). Opt-in via
 * `POLISH=1` (same convention as `usability.spec.ts`'s `AUDIT=1`).
 *
 * Run one surface (from its own worktree, on its own port — M5 plan §5):
 *
 *   cd e2e && SOCKBOWL_APP=http://localhost:4204 POLISH=1 \
 *     npx playwright test polish --grep @s4
 *
 * Every surface, against this worktree's own `ng serve` (H0's port, 4207):
 *
 *   cd e2e && SOCKBOWL_APP=http://localhost:4207 POLISH=1 npx playwright test polish
 *
 * Screenshots and `manifest.json` land under
 * `~/Projects/sockbowl/audit/m5/shots/<surface>/baseline/` (outside every
 * repo). A `skip`ped scenario state writes a `skipped: <reason>` row instead
 * of a screenshot (viewport/theme `n/a`) — see `scenarios/s1.ts`'s header
 * for why S1-S3 are entirely skipped rows until `record-stomp.ts` runs.
 */
import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { mockConfig } from './mock/config.js';
import { mockOidc } from './mock/oidc.js';
import { mockStompReplay } from './mock/stomp-replay.js';
import {
  appendManifestRow, ngHead, presetTheme, runAxe, sha256File, shotsDir, slug,
  waitForFonts, CAPTURED_THEMES, VIEWPORTS, type CapturePhase,
} from './manifest.js';
import { checkAllControls, checkOverflow } from './checks.js';
import { loadFixture } from './fixtures/load.js';
import s1 from './scenarios/s1.js';
import s2 from './scenarios/s2.js';
import s3 from './scenarios/s3.js';
import s4 from './scenarios/s4.js';
import s5 from './scenarios/s5.js';
import s6 from './scenarios/s6.js';
import type { SurfaceScenario } from './scenarios/types.js';

const POLISH = !!process.env.POLISH;
const BASE_URL = process.env.SOCKBOWL_APP || 'http://localhost:4207';
const PHASE: CapturePhase = (process.env.POLISH_PHASE as CapturePhase) || 'baseline';

const SURFACES: SurfaceScenario[] = [s1, s2, s3, s4, s5, s6];

(POLISH ? test.describe : test.describe.skip)('polish capture', () => {
  for (const surface of SURFACES) {
    test.describe(`${surface.id} ${surface.title}`, () => {
      for (const state of surface.states) {
        if (state.skip) {
          test(`${state.id} [skipped] @${surface.tag}`, async () => {
            appendManifestRow({
              surface: surface.id, phase: PHASE, state: state.id, role: state.role,
              auth: (state.authEnabled ?? true) ? 'on' : 'off', viewport: 'n/a', theme: 'n/a',
              route: state.route, file: null, sha256: null, ngHead: ngHead(), mocked: true,
              fontsLoaded: null, axeSerious: null, axeCritical: null, usabilityViolations: null,
              skipped: state.skip, recordedAt: new Date().toISOString(),
            });
          });
          continue;
        }

        const viewportNames = state.viewports ?? ['mobile', 'desktop'];
        const themeNames = state.themes ?? [...CAPTURED_THEMES];

        for (const vpName of viewportNames) {
          for (const theme of themeNames) {
            test(`${state.id} · ${vpName} · ${theme} @${surface.tag}`, async ({ browser }) => {
              const viewport = VIEWPORTS[vpName];
              if (!viewport) throw new Error(`unknown viewport "${vpName}" in scenario ${surface.id}/${state.id}`);

              const context = await browser.newContext({ viewport, baseURL: BASE_URL });
              const page = await context.newPage();
              try {
                await presetTheme(page, theme);
                await mockConfig(page, { authEnabled: state.authEnabled ?? true });
                await mockOidc(page, state.role);
                await state.setupMocks(page);

                const isLoadingState = /loading/i.test(state.id);
                await page.goto(state.route, { waitUntil: isLoadingState ? 'domcontentloaded' : 'networkidle', timeout: 45_000 });
                if (isLoadingState) {
                  await page.waitForTimeout(700); // let the loading UI actually paint before the delayed mock would resolve
                }
                await state.afterGoto?.(page);

                const fontsLoaded = await waitForFonts(page);

                const dir = shotsDir(surface.id, PHASE);
                mkdirSync(dir, { recursive: true });
                const fileName = `${slug(state.id)}__${state.role}__${vpName}__${theme}.png`;
                const filePath = join(dir, fileName);
                await page.screenshot({ path: filePath, fullPage: true });

                const axeKey = slug(`${state.id}__${state.role}__${vpName}__${theme}`);
                const axe = await runAxe(page, surface.id, PHASE, axeKey);

                // F2/H0: generic usability sweep, wired per row (M5 plan §4 H0
                // done-when / S6 handoff) rather than per hand-picked
                // surface+state (that stays admin-responsive.spec.ts's job).
                const mobile = viewport.width < 768;
                const usabilityViolations = [
                  ...(await checkOverflow(page)),
                  ...(await checkAllControls(page, mobile)),
                ];

                appendManifestRow({
                  surface: surface.id, phase: PHASE, state: state.id, role: state.role,
                  auth: (state.authEnabled ?? true) ? 'on' : 'off', viewport: vpName, theme,
                  route: state.route, file: fileName, sha256: sha256File(filePath), ngHead: ngHead(),
                  mocked: true, fontsLoaded, axeSerious: axe.serious, axeCritical: axe.critical,
                  usabilityViolations, recordedAt: new Date().toISOString(),
                });
              } finally {
                await context.close();
              }
            });
          }
        }
      }
    });
  }
});

/**
 * Feasibility gate (M5 plan §4 H0 done-when): proves `mock/stomp-replay.ts`
 * can drive `game-canvas.component.ts` into rendering the proctor, buzzer
 * and spectator children with **no** live game backend, using the
 * hand-authored fixture in `fixtures/stomp/self-check.json` (see that
 * file's `_comment` — it is not a recording and never feeds a real
 * baseline/final/v1 row). Runs under the `@selfcheck` tag, separate from
 * every surface's own rows, and writes into the `self-check` phase.
 */
interface SelfCheckFixture {
  gameSessionId: string;
  seats: { proctor: string; buzzer: string; spectator: string };
  frames: Parameters<typeof mockStompReplay>[1]['frames'];
}

(POLISH ? test.describe : test.describe.skip)('stomp replay self-check @selfcheck', () => {
  const fixture = loadFixture<SelfCheckFixture>('stomp/self-check.json');
  const expectedSelector: Record<'proctor' | 'buzzer' | 'spectator', string> = {
    proctor: 'app-game-proctor',
    buzzer: 'app-game-buzzer',
    spectator: 'app-game-spectator',
  };

  for (const seatName of ['proctor', 'buzzer', 'spectator'] as const) {
    test(`mocked /game renders ${expectedSelector[seatName]} for the ${seatName} seat`, async ({ browser }) => {
      const playerSessionId = fixture.seats[seatName];
      const context = await browser.newContext({ viewport: VIEWPORTS.desktop, baseURL: BASE_URL });
      const page = await context.newPage();
      try {
        await mockConfig(page, { authEnabled: true });
        await mockOidc(page, 'player');
        await mockStompReplay(page, {
          gameSessionId: fixture.gameSessionId,
          playerSessionId,
          frames: fixture.frames,
        });

        await page.goto(
          `/game;gameSessionId=${fixture.gameSessionId};playerSessionId=${playerSessionId};playerSecret=selfcheck-secret`,
          { waitUntil: 'domcontentloaded' },
        );

        const locator = page.locator(expectedSelector[seatName]);
        await locator.waitFor({ state: 'attached', timeout: 15_000 });

        const dir = shotsDir('selfcheck', 'self-check');
        mkdirSync(dir, { recursive: true });
        const fileName = `${seatName}.png`;
        const filePath = join(dir, fileName);
        await page.screenshot({ path: filePath, fullPage: true });

        appendManifestRow({
          surface: 'selfcheck', phase: 'self-check', state: `renders-${seatName}`, role: 'player',
          auth: 'on', viewport: 'desktop', theme: 'dark', route: '/game', file: fileName,
          sha256: sha256File(filePath), ngHead: ngHead(), mocked: true, fontsLoaded: await waitForFonts(page),
          axeSerious: null, axeCritical: null, usabilityViolations: null, recordedAt: new Date().toISOString(),
        });
      } finally {
        await context.close();
      }
    });
  }
});
