/**
 * S3: Config and lobby (`/game` CONFIG) — M5 plan §2 row S3. Every state
 * needs an active `MatchState.CONFIG` session reached over STOMP.
 *
 * `record-stomp.ts` (M5 H0 follow-up, 2026-09-28) ran under the fullstack
 * lock and recorded QUIZ_BOWL_CLASSIC/SINGLE_PLAYER/AUTO_PROCTOR/
 * FREE_FOR_ALL. This file's own earlier header claimed *no* recorded
 * fixture contains a single CONFIG-phase frame, because that's true of the
 * two quiz-bowl-classic fixtures S1/S2 lean on (`proctor.json`/
 * `buzzer.json`, whose `RawRecorder`s attach after `stageMatch` already
 * finished CONFIG). It is **not** true fleet-wide: `record-stomp.ts` also
 * recorded a spectator seat and two proctorless modes, and those seats'
 * recorders *did* attach in time to catch a real CONFIG-phase
 * `GameSessionUpdate` —
 *   - `quiz-bowl-classic/spectator.json` frame 0 (proctor already claimed,
 *     teams already 2v2, packet already chosen — used verbatim below);
 *   - `auto-proctor/buzzer.json` frame 1 (proctorless owner console, CONFIG,
 *     used verbatim for `config-owner-view`);
 *   - `free-for-all/buzzer.json` frames 0 and 2 (not needed below, but real).
 *
 * What's genuinely missing is a CONFIG frame from the *proctor* seat
 * specifically (the only seat the real recording ever sends a packet's `id`
 * and full tossups/bonuses to — WP-FIXG5) and a few roster/packet shapes no
 * live recording happened to produce (empty roster, one team, 12 players
 * unevenly split across 4 teams, three packet-visibility values). Those are
 * hand-authored in `fixtures/stomp/config-quiz-bowl-classic/{proctor,
 * player}.json`, built by patching `MatchState` back to `CONFIG` on real
 * `quiz-bowl-classic` frames — see each file's own `_meta` for exactly which
 * field each variant changes. `config-quiz-bowl-classic/spectator.json` is
 * the same real spectator frame copied into its own file (nothing changed)
 * so S3 never shares fixture-file indices with S1/S2.
 *
 * Three rows (`config-generate-*`) drive `packet-search`'s "Generate with
 * AI" tab, which needs its own REST/GraphQL mocks (`generatePacket`,
 * `listPackets`, and OpenAI's own `/v1/models`) laid out below rather than
 * `stomp-fixtures.ts`'s replay helpers — the CONFIG session is just their
 * backdrop.
 */
import type { Page } from '@playwright/test';
import type { CaptureState, SurfaceScenario } from './types.js';
import { stompState } from './stomp-fixtures.js';
import { mockGraphql } from '../mock/graphql.js';
import { MOCK_QUESTIONS_ORIGIN } from '../mock/config.js';

/** Chains `extra` after `base`'s own `setupMocks` (never replaces it). */
function withMocks(base: CaptureState, extra: (page: Page) => Promise<void>): CaptureState {
  const baseSetup = base.setupMocks;
  return { ...base, setupMocks: async (page: Page) => { await baseSetup(page); await extra(page); } };
}

/** Chains `extra` after `base`'s own `afterGoto` (runs after the 400ms replay-settle wait). */
function withSteps(base: CaptureState, extra: (page: Page) => Promise<void>): CaptureState {
  const baseAfter = base.afterGoto;
  return { ...base, afterGoto: async (page: Page) => { await baseAfter?.(page); await extra(page); } };
}

/**
 * Defines `window.PresentationRequest` before the app's own bootstrap runs
 * (`page.addInitScript` fires on every new document, ahead of any app
 * script), so `PresentationConnectionService`'s constructor-time
 * `'PresentationRequest' in window` feature-check succeeds.
 *
 * Turns out headless Chromium (the browser Playwright drives here) already
 * defines a native `window.PresentationRequest` — `'PresentationRequest' in
 * window` is true, and `castAvailable$` is already true, on *every* proctor
 * row, mock or not (confirmed with a throwaway debug spec against this
 * scenario's own `config-packet-chosen-published` row). So this mock's job
 * isn't feature-detection; it's making `startCasting()`'s device-picker step
 * (`presentationRequest.start()`) resolve instead of hanging/rejecting
 * against a receiver that doesn't exist, so `config-cast-button` below can
 * drive the UI all the way to `PresentationConnectionState.CONNECTED`
 * (`cast_connected` icon, "Stop casting" button) — the only way this row
 * ends up visually distinct from every other proctor row, since the idle
 * "Cast to TV" button is already on all of them regardless.
 */
async function mockPresentationApi(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class MockPresentationConnection {
      addEventListener(): void {}
      removeEventListener(): void {}
      terminate(): void {}
      send(): void {}
    }
    class MockPresentationRequest {
      constructor(_urls: string[]) {}
      addEventListener(): void {}
      removeEventListener(): void {}
      start(): Promise<MockPresentationConnection> { return Promise.resolve(new MockPresentationConnection()); }
    }
    (window as unknown as { PresentationRequest: unknown }).PresentationRequest = MockPresentationRequest;
  });
}

const FIND_A_PACKET = { role: 'button' as const, name: 'Find a Packet' };

async function openPacketSearch(page: Page): Promise<void> {
  await page.getByRole(FIND_A_PACKET.role, { name: FIND_A_PACKET.name }).click();
  await page.getByRole('dialog').waitFor({ state: 'visible' });
}

/** Fills the "AI" tab's key/model/topic, stopping just before Generate. */
async function fillGenerateForm(page: Page, topic: string): Promise<void> {
  await page.getByRole('tab', { name: 'AI' }).click();
  const apiKeyField = page.getByLabel('OpenAI API Key');
  await apiKeyField.fill('sk-h0-mock-key-not-a-real-secret');
  await apiKeyField.blur(); // AiKeyPickerComponent.onApiKeyBlur -> fetchAvailableModels
  // openai.com/v1/models is aborted (mocked below), so fetchModels's own
  // catchError falls back to its hardcoded model list and auto-selects the
  // first one — no dropdown interaction needed.
  await page.getByText('gpt-4o', { exact: true }).waitFor({ state: 'visible', timeout: 5000 });
  await page.getByLabel('Topic').fill(topic);
}

/** Aborts the real OpenAI endpoint so `OpenAiModelService.fetchModels` takes its fallback path. */
async function mockOpenAiModelsUnreachable(page: Page): Promise<void> {
  await page.route('https://api.openai.com/v1/models', route => route.abort());
}

/** `generatePacket`'s REST call lands on the questions-API origin, not the game one (`mock/rest.ts`'s scope). */
async function mockGeneratePacket(page: Page, status: number, body: Record<string, unknown>): Promise<void> {
  await page.route(`${MOCK_QUESTIONS_ORIGIN}/api/packets/generate`, route =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }));
}

// `listPackets()` sends a `query { packets(...) { ... } }` — the mock
// dispatches by that outer selection's root field name (`mock/graphql.ts`'s
// `rootField`), which is `packets`, not the client method's own name.
function emptyMyPackets(page: Page): Promise<void> {
  return mockGraphql(page, {
    packets: () => ({ data: { packets: { items: [], total: 0, page: 0, size: 0 } } }),
  });
}

/** Never resolves within the capture window, so `packet-search`'s search-tab spinner stays up. */
function hangingSearch(page: Page): Promise<void> {
  return mockGraphql(page, {
    packets: () => new Promise<never>(() => { /* intentionally never settles */ }),
  });
}

const states: CaptureState[] = [
  // --- Role views of the same real CONFIG session (quiz-bowl-classic, proctor claimed, 2v2, packet chosen) ---
  // Proctorless owner console (AUTO_PROCTOR): the owner manages config
  // directly, no proctor-claim step exists. Real, unsynthesized frame.
  stompState('config-owner-view', 'auto-proctor', 'buzzer', 1),
  // Nobody has claimed proctor yet (empty roster too — canBecomeProctor's
  // "first-come" G-01 design applies equally to any seat while unclaimed).
  stompState('config-proctor-unclaimed', 'config-quiz-bowl-classic', 'player', 1),
  stompState('config-player-view', 'config-quiz-bowl-classic', 'player', 0),
  stompState('config-spectator-view', 'config-quiz-bowl-classic', 'spectator', 0),

  // --- Proctor's own config console: packet states ---
  stompState('config-packet-not-chosen', 'config-quiz-bowl-classic', 'proctor', 0),
  // "loading": open the dialog and search with the GraphQL response hung,
  // so the capture lands on packet-search's own `isSearching` spinner
  // (capture.spec.ts's `isLoadingState` gives this one extra settle time
  // before the screenshot instead of waiting for a `networkidle` that a
  // hung mock would never reach).
  withSteps(
    withMocks(stompState('config-packet-loading', 'config-quiz-bowl-classic', 'proctor', 0), hangingSearch),
    async page => {
      await openPacketSearch(page);
      await page.getByPlaceholder('Type to search for packets...').fill('quiz bowl');
      await page.waitForTimeout(300); // let the spinner actually paint
    },
  ),
  stompState('config-packet-chosen-ephemeral', 'config-quiz-bowl-classic', 'proctor', 3),
  stompState('config-packet-chosen-draft', 'config-quiz-bowl-classic', 'proctor', 2),
  stompState('config-packet-chosen-published', 'config-quiz-bowl-classic', 'proctor', 1),
  withSteps(
    withMocks(stompState('config-my-packets-empty', 'config-quiz-bowl-classic', 'proctor', 0), emptyMyPackets),
    openPacketSearch,
  ),

  // --- "AI" tab: needs its own REST/GraphQL backdrop, not just STOMP replay ---
  withSteps(
    withMocks(
      // `role: 'author'` (not the default `player`) — packet-search's
      // "AI" tab is gated on `auth.hasPermission('question:
      // generate')`, which only `author`/`admin` carry (`mock/oidc.ts`).
      stompState('config-generate-ai-fails-closed', 'config-quiz-bowl-classic', 'proctor', 0, { role: 'author' }),
      async page => {
        await mockOpenAiModelsUnreachable(page);
        // D12: AI generation fails closed (503 limiter_unavailable) when its own rate limiter can't reach Redis.
        await mockGeneratePacket(page, 503, { error: 'limiter_unavailable', policy: 'ai-generate' });
      },
    ),
    async page => {
      await openPacketSearch(page);
      await fillGenerateForm(page, 'Ancient Rome');
      await page.getByRole('button', { name: 'Generate Packet' }).click();
      await page.getByText('AI generation is temporarily unavailable').waitFor({ state: 'visible' });
    },
  ),
  withSteps(
    withMocks(
      stompState('config-generate-quota-exhausted', 'config-quiz-bowl-classic', 'proctor', 0, { role: 'author' }),
      async page => {
        await mockOpenAiModelsUnreachable(page);
        // D10: the account's daily AI-generation quota is used up (429 quota_exceeded).
        const resetsAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
        await mockGeneratePacket(page, 429, { error: 'quota_exceeded', metric: 'ai.generations', limit: 5, used: 5, resetsAt });
      },
    ),
    async page => {
      await openPacketSearch(page);
      await fillGenerateForm(page, 'Organic Chemistry');
      await page.getByRole('button', { name: 'Generate Packet' }).click();
      await page.getByText(/reached your AI generation limit/).waitFor({ state: 'visible' });
    },
  ),
  withSteps(
    withMocks(
      stompState('config-generate-bring-your-own-key', 'config-quiz-bowl-classic', 'proctor', 0, { role: 'author' }),
      mockOpenAiModelsUnreachable,
    ),
    async page => {
      // The picker only ever takes the caller's own OpenAI key (no
      // platform-shared-key option exists — `ai-key-picker.component.html`'s
      // "never shared or stored on server" hint); this is the everyday
      // filled-out-and-ready-to-submit state, not a special toggle.
      await openPacketSearch(page);
      await fillGenerateForm(page, 'Jazz Music');
    },
  ),

  // --- Team roster shapes ---
  stompState('config-one-team', 'config-quiz-bowl-classic', 'proctor', 4),
  stompState('config-many-teams-12-players', 'config-quiz-bowl-classic', 'proctor', 5),

  // --- Cast ---
  // Drives all the way to CONNECTED (see mockPresentationApi's comment) —
  // the idle "Cast to TV" button alone is byte-identical to every other
  // proctor row, since headless Chromium already exposes the Presentation
  // API without any mock.
  withSteps(
    withMocks(stompState('config-cast-button', 'config-quiz-bowl-classic', 'proctor', 1), mockPresentationApi),
    async page => {
      await page.getByRole('button', { name: 'Cast to TV' }).click();
      await page.getByRole('button', { name: 'Stop casting' }).waitFor({ state: 'visible' });
      // H0 follow-up: this row's own snackbar (`MatSnackBar.open` for
      // "Connected to cast device") reliably left the Material Icons
      // ligature text unstyled document-wide under the `light` theme only
      // (reproduced 3/3 runs, both viewports; `dark` never showed it) even
      // though `manifest.ts`'s `waitForFonts` reported `fontsLoaded: true`
      // for every one of those broken captures — `document.fonts.check()`
      // is satisfied once the face's `status` is `loaded`, which doesn't
      // guarantee the browser has finished re-laying-out text runs that
      // were already painted with the fallback font before that happened.
      // A fixed extra settle here (this row's own interaction step, not a
      // change to the shared font-wait check every row relies on) reliably
      // let that repaint finish before the screenshot in local testing.
      await page.waitForTimeout(800);
    },
  ),
];

const s3: SurfaceScenario = { id: 'S3', title: 'Config and lobby', tag: 's3', port: 4203, states };
export default s3;
