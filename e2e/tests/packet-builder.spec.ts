import { test, expect, type Page, type Locator, type TestInfo } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginAs, getAccessToken } from '../../tests-auth/helpers/login.js';
import { deletePacket } from '../harness/questions.js';
import { stageMatch, driveFullMatch } from '../harness/orchestrator.js';
import { createGame, joinByCodeAuthenticated } from '../harness/rest.js';
import { SockbowlBot } from '../harness/bot.js';

// M3 plan WP-E1: "Playwright e2e: build a packet -> play it". Two Playwright
// projects run this same file against a stack with AUTH_ENABLED=false
// (m3-auth-off) and one with AUTH_ENABLED=true (m3-auth-on) — see
// e2e/playwright.config.ts. Everything below reads `testInfo.project.name`
// to tell which posture it is running under, rather than branching on env
// vars directly, so one spec body serves both runs.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'm3-import-sample.txt');
const ART_DIR = path.join(__dirname, '..', 'artifacts', 'm3');
mkdirSync(ART_DIR, { recursive: true });

/** Demo Keycloak accounts (sockbowl-docker's rbac-model.json), only reachable when auth is on. */
const AUTHOR_USER = 'testuser'; // author role: packet:create/update/delete
const OTHER_USER = 'player2'; // player role: no packet:manage-any, not the author

const isAuthOn = (testInfo: TestInfo): boolean => testInfo.project.name === 'm3-auth-on';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* --------------------------------------------------------------------------
 * Packet builder UI helpers
 * ---------------------------------------------------------------------- */

/** Creates a packet from `/packets` and lands in its builder. Returns the new packet id. */
async function newPacketInBuilder(page: Page, name: string): Promise<string> {
  await page.goto('/packets');
  await page.getByRole('button', { name: 'New Packet' }).click();
  await page.locator('input[name="newPacketName"]').fill(name);

  // Difficulty is optional structurally; pick the first one if any are seeded,
  // but don't fail the whole spec over an empty taxonomy.
  try {
    const difficultySelect = page.locator('.packet-list__card mat-select').first();
    await difficultySelect.click({ timeout: 2000 });
    await page.getByRole('option').first().click({ timeout: 2000 });
  } catch {
    await page.keyboard.press('Escape');
  }

  await page.getByRole('button', { name: 'Create and edit' }).click();
  await page.waitForURL(/\/packets\/[^/]+\/edit/, { timeout: 15000 });
  const m = page.url().match(/\/packets\/([^/]+)\/edit/);
  if (!m) throw new Error(`newPacketInBuilder: unexpected builder URL ${page.url()}`);
  return m[1];
}

/** Adds a tossup through the builder's "Add Tossup" form (commits immediately, no draft). */
async function addTossup(page: Page, question: string, answer: string): Promise<void> {
  await page.getByRole('button', { name: 'Add Tossup', exact: true }).click();
  const form = page.locator('mat-expansion-panel', { hasText: 'New tossup' });
  await form.getByLabel('Question').fill(question);
  await form.getByLabel('Answer').fill(answer);
  await form.getByRole('button', { name: 'Add tossup' }).click();
  await expect(form).toBeHidden({ timeout: 10000 });
}

/** Adds a bonus (with its parts) through the builder's "Add Bonus" form. */
async function addBonus(
  page: Page,
  preamble: string,
  parts: { question: string; answer: string }[],
): Promise<void> {
  await page.getByRole('button', { name: 'Add Bonus', exact: true }).click();
  const form = page.locator('.packet-builder__generate-form');
  await form.getByLabel('Preamble').fill(preamble);
  const rows = form.locator('.packet-builder__part');
  await expect(rows).toHaveCount(parts.length, { timeout: 5000 });
  for (let i = 0; i < parts.length; i++) {
    const row = rows.nth(i);
    await row.getByLabel('Question').fill(parts[i].question);
    await row.getByLabel('Answer').fill(parts[i].answer);
  }
  await form.getByRole('button', { name: 'Add bonus' }).click();
  await expect(form).toBeHidden({ timeout: 10000 });
}

/** The tossup panel whose visible preview text contains `snippet` (question or preamble text). */
function panelByText(page: Page, snippet: string): Locator {
  return page.locator('mat-expansion-panel').filter({ hasText: snippet });
}

async function expandPanel(panel: Locator): Promise<void> {
  const expanded = await panel.getAttribute('aria-expanded').catch(() => null);
  if (expanded !== 'true') {
    await panel.locator('mat-expansion-panel-header').click();
  }
}

/** Best-effort CDK drag-and-drop: drags `source`'s handle onto `target`'s header. */
async function dragOnto(page: Page, source: Locator, target: Locator): Promise<void> {
  const s = await source.boundingBox();
  const t = await target.boundingBox();
  if (!s || !t) throw new Error('dragOnto: missing bounding box for source or target');
  const sx = s.x + s.width / 2;
  const sy = s.y + s.height / 2;
  const tx = t.x + t.width / 2;
  const ty = t.y + Math.min(8, t.height / 4); // just inside the target's top edge
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx, sy - 15, { steps: 5 });
  await page.mouse.move(tx, ty, { steps: 20 });
  await page.mouse.move(tx, ty, { steps: 3 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/* --------------------------------------------------------------------------
 * Spec 1: build packet from scratch and play it (both projects)
 * ---------------------------------------------------------------------- */

test('build packet from scratch and play it', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const authOn = isAuthOn(testInfo);
  let packetId: string | null = null;
  let accessToken: string | null = null;

  try {
    if (authOn) {
      await loginAs(page, AUTHOR_USER);
      accessToken = await getAccessToken(page);
    }

    const packetName = `E2E ${Date.now()}`;
    packetId = await newPacketInBuilder(page, packetName);

    // Step 2: 3 tossups with distinct one-word answers, plus 1 bonus (3 parts).
    const T1 = { q: 'This element with atomic number 8 is essential for respiration.', a: 'OXYGEN' };
    const T2 = { q: 'This polygon has three sides and three angles.', a: 'TRIANGLE' };
    const T3 = { q: 'This is the closest planet to the Sun.', a: 'MERCURY' };
    await addTossup(page, T1.q, T1.a);
    await addTossup(page, T2.q, T2.a);
    await addTossup(page, T3.q, T3.a);
    await addBonus(page, 'Answer the following about geography, for 10 points each.', [
      { question: 'This is the largest ocean by area.', answer: 'PACIFIC' },
      { question: 'This river is generally credited as the longest in the world.', answer: 'NILE' },
      { question: 'This is the smallest continent by area.', answer: 'AUSTRALIA' },
    ]);

    // Dirty the bonus's preamble (not any tossup, so the buzz loop's expected
    // answers below stay untouched) and exercise Save all / the dirty counter.
    const bonusPanel = panelByText(page, 'Answer the following about geography');
    await expandPanel(bonusPanel);
    const preambleField = bonusPanel.getByLabel('Preamble');
    await preambleField.fill('Answer the following about geography, for 10 points each. (v2)');
    await expect(page.locator('.packet-builder__unsaved-count')).toHaveText(/1 unsaved change/, { timeout: 5000 });
    await page.getByRole('button', { name: 'Save all' }).click();
    await expect(page.locator('.packet-builder__unsaved-count')).toHaveText(/All changes saved/, { timeout: 10000 });
    await expect(page.locator('.packet-builder__validation-badge')).toHaveText(/Playable/, { timeout: 10000 });

    // Step 3: drag tossup 3 (Mercury) to position 1, then confirm the order survives a reload.
    const t3Panel = panelByText(page, T3.q);
    const t1Panel = panelByText(page, T1.q);
    await dragOnto(page, t3Panel.locator('.packet-builder__drag-handle').first(), t1Panel);
    await page.reload();
    await expect(page.locator('.packet-builder__tossups mat-expansion-panel').first()).toContainText(T3.q, {
      timeout: 10000,
    });

    // Step 4: Preview shows all 3 tossups and the bonus's 3 parts.
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const preview = page.locator('app-packet-reading-view');
    await expect(preview.getByRole('tab', { name: /Tossups \(3\)/ })).toBeVisible({ timeout: 10000 });
    await expect(preview).toContainText(T1.q);
    await expect(preview).toContainText(T2.q);
    await expect(preview).toContainText(T3.q);
    await preview.getByRole('tab', { name: /Bonuses \(1\)/ }).click();
    await expect(preview).toContainText('PACIFIC');
    await expect(preview).toContainText('NILE');
    await expect(preview).toContainText('AUSTRALIA');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();

    // Step 5: guard check — dirty T2 without saving, try to navigate away via
    // the navbar brand (an in-app RouterLink; the only nav target present
    // regardless of auth posture — there is no persistent "Packets" nav link
    // when auth is off, since the whole navbar__auth block is auth-gated).
    const t2Panel = panelByText(page, T2.q);
    await expandPanel(t2Panel);
    await t2Panel.getByLabel('Question').fill(`${T2.q} (edited)`);
    await page.locator('.navbar__brand').click();
    const confirmDialog = page.getByRole('dialog').filter({ hasText: 'Discard unsaved changes?' });
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });
    await confirmDialog.getByRole('button', { name: 'Stay' }).click();
    await expect(confirmDialog).toBeHidden({ timeout: 5000 });
    expect(page.url()).toMatch(/\/packets\/[^/]+\/edit/);
    await t2Panel.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.packet-builder__unsaved-count')).toHaveText(/All changes saved/, { timeout: 10000 });

    // Step 6 (auth-on only): Publish, then back to Draft; the owner's draft stays playable.
    if (authOn) {
      await page.getByRole('button', { name: 'Publish', exact: true }).click();
      await expect(page.locator('.packet-builder__visibility-chip')).toHaveText(/Published/, { timeout: 10000 });
      await page.getByRole('button', { name: 'Unpublish', exact: true }).click();
      await expect(page.locator('.packet-builder__visibility-chip')).toHaveText(/Draft/, { timeout: 10000 });
      await expect(page.locator('.packet-builder__validation-badge')).toHaveText(/Playable/, { timeout: 10000 });
    }

    // Step 7: Play test -> single-player.
    await page.getByRole('button', { name: 'Play test', exact: true }).click();
    await page.waitForURL('**/game;**', { timeout: 25000 });
    await expect(page.getByText(new RegExp(`Packet '${escapeRegExp(packetName)}' selected`))).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole('button', { name: 'Start Match', exact: true }).click();

    // Deviation from the plan's literal step 7 (documented in this WP's
    // report): SINGLE_PLAYER forces bonusesEnabled=false at session-creation
    // time (SessionService.java) regardless of client input or the packet's
    // own bonus content — confirmed by FullGameSinglePlayerTest's
    // "BonusesForcedOff" nested test class. There is no bonus phase to play
    // through here; risk 8 in the plan anticipates exactly this and moves the
    // bonus proof to a QUIZ_BOWL_CLASSIC bot-harness match below. The single
    // player leg below proves only the 3 tossups.
    const dragOrderedAnswers = [T3.a, T1.a, T2.a]; // reflects the drag in step 3

    for (const answer of dragOrderedAnswers) {
      const reader = page.locator('.game-proctor .question-section');
      await expect(reader).toBeVisible({ timeout: 20000 });
      await page.waitForTimeout(600);
      await page.locator('.buzz-btn').click();
      const input = page.locator('.answer-input');
      await expect(input).toBeVisible({ timeout: 10000 });
      await input.fill(answer);
      await page.locator('.answer-form button[type="submit"]').click();
      const verdict = page.locator('.answer-section');
      await expect(verdict).toBeVisible({ timeout: 15000 });
      await expect(verdict).not.toHaveClass(/answer-section--wrong/);
      // Not "Next Tossup" by role name: the button's explicit aria-label
      // ("Go to the next tossup...") is its accessible name, not its text.
      await page.getByRole('button', { name: /next tossup/i }).click();
    }

    // Step 8: match reaches COMPLETED with all 3 tossups correct.
    await expect(page.locator('.match-summary')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.winning-announcement')).toContainText(/3 of 3 correctly/, { timeout: 10000 });

    // Supplementary bonus proof (plan risk 8 fallback): the same packet,
    // played in a bot-driven QUIZ_BOWL_CLASSIC match with bonuses on, reaches
    // a scored bonus round — proving the packet's bonus content is usable in
    // a real match, which single-player structurally cannot exercise.
    const bonusMatch = await stageMatch({ packetId, playerNames: ['Ada', 'Blaise'] });
    try {
      const result = await driveFullMatch(bonusMatch, 1, false);
      expect(result.rounds).toBeGreaterThanOrEqual(1);
      const scored = result.scores.some((s) => (s.score ?? 0) > 0);
      expect(scored).toBeTruthy();
    } finally {
      bonusMatch.cleanup();
    }
  } finally {
    if (packetId) {
      await deletePacket(packetId, accessToken);
    }
  }
});

/* --------------------------------------------------------------------------
 * Spec 2: import -> export round trip (auth-off is enough)
 * ---------------------------------------------------------------------- */

test('import to export round trip', async ({ page }, testInfo) => {
  testInfo.skip(isAuthOn(testInfo), 'auth-off is enough for the import/export grammar');
  test.setTimeout(120_000);
  let packetId: string | null = null;

  try {
    await page.goto('/packets');
    await page.locator('.packet-list__import-btn').click();
    const dialog = page.locator('app-packet-import-dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    await dialog.locator('[data-testid="import-file-input"]').setInputFiles(FIXTURE_PATH);
    await expect(dialog.locator('[data-testid="import-text-area"]')).not.toHaveValue('', { timeout: 5000 });
    await dialog.locator('[data-testid="import-preview-btn"]').click();

    const preview = dialog.locator('[data-testid="import-preview"]');
    await expect(preview).toBeVisible({ timeout: 15000 });
    await expect(preview).toContainText('3 tossups');
    await expect(preview).toContainText('2 bonuses');
    await expect(preview.locator('.import-dialog__issue--error')).toHaveCount(0);

    await dialog.locator('[data-testid="import-commit-btn"]').click();
    await page.waitForURL(/\/packets\/[^/]+\/edit/, { timeout: 15000 });
    const m = page.url().match(/\/packets\/([^/]+)\/edit/);
    if (!m) throw new Error(`unexpected builder URL after import: ${page.url()}`);
    packetId = m[1];

    // Export .txt, capturing the browser download.
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Plaintext (.txt)' }).click(),
    ]);
    const downloadedPath = await download.path();
    if (!downloadedPath) throw new Error('export download did not produce a local file path');

    // Re-import the downloaded file: same counts, same first tossup's answer.
    await page.goto('/packets');
    await page.locator('.packet-list__import-btn').click();
    const dialog2 = page.locator('app-packet-import-dialog');
    await expect(dialog2).toBeVisible({ timeout: 10000 });
    await dialog2.locator('[data-testid="import-file-input"]').setInputFiles(downloadedPath);
    await dialog2.locator('[data-testid="import-preview-btn"]').click();
    const preview2 = dialog2.locator('[data-testid="import-preview"]');
    await expect(preview2).toBeVisible({ timeout: 15000 });
    await expect(preview2).toContainText('3 tossups');
    await expect(preview2).toContainText('2 bonuses');

    const originalText = readFileSync(FIXTURE_PATH, 'utf-8');
    const firstAnswer = originalText.match(/ANSWER:\s*(.+)/)?.[1]?.trim();
    if (!firstAnswer) throw new Error('could not find the first ANSWER in the fixture');
    await preview2.getByRole('button', { name: /Tossups \(3\)/ }).click();
    await expect(preview2).toContainText(`ANSWER: ${firstAnswer}`);

    // Don't commit the second import — cancel, so only the first packet needs cleanup.
    await dialog2.getByRole('button', { name: 'Cancel', exact: true }).click();
  } finally {
    if (packetId) {
      await deletePacket(packetId);
    }
  }
});

/* --------------------------------------------------------------------------
 * Spec 3: draft privacy in game (auth-on only)
 * ---------------------------------------------------------------------- */

test('draft privacy in game', async ({ page, browser }, testInfo) => {
  testInfo.skip(!isAuthOn(testInfo), 'draft ownership only applies when auth is on');
  test.setTimeout(120_000);
  let packetId: string | null = null;
  let authorToken: string | null = null;

  try {
    // The author creates a DRAFT packet with one tossup (never published).
    await loginAs(page, AUTHOR_USER);
    authorToken = await getAccessToken(page);
    const draftName = `E2E draft ${Date.now()}`;
    packetId = await newPacketInBuilder(page, draftName);
    await addTossup(page, 'A placeholder tossup for the draft-privacy check.', 'PLACEHOLDER');
    await expect(page.locator('.packet-builder__visibility-chip')).toHaveText(/Draft/, { timeout: 10000 });

    // A second demo user (a player, not the author) can't find it via the
    // in-game packet search dialog.
    const otherCtx = await browser.newContext();
    const otherPage = await otherCtx.newPage();
    await loginAs(otherPage, OTHER_USER);
    const otherToken = await getAccessToken(otherPage);

    await otherPage.goto('/game-session');
    await otherPage.getByRole('button', { name: /New game/ }).click();
    await otherPage.getByRole('button', { name: /Solo practice/ }).click();
    await otherPage.waitForURL('**/game;**', { timeout: 25000 });
    await otherPage.getByRole('button', { name: /Find a Packet/ }).click();
    const searchDialog = otherPage.locator('.packet-search-dialog');
    await expect(searchDialog).toBeVisible({ timeout: 10000 });
    await searchDialog.locator('input[type="text"]').fill(draftName);
    await otherPage.waitForTimeout(600); // debounce
    await expect(searchDialog.locator('.result-item', { hasText: draftName })).toHaveCount(0);
    await searchDialog.getByRole('button', { name: 'Cancel', exact: true }).click();

    // A direct SetMatchPacket for the draft id, through the bot harness as
    // that same player (an authenticated, non-guest seat — C6), is refused
    // with PACKET_NOT_AVAILABLE (M2's draft-ownership rule).
    const game = await createGame('SINGLE_PLAYER', 'IN_PERSON_PROCTOR', false);
    const join = await joinByCodeAuthenticated(game.joinCode, 'PlayerTwo', otherToken);
    const bot = new SockbowlBot('PlayerTwo', join.gameSessionId, join.playerSecret, join.playerSessionId, otherToken);
    try {
      await bot.connect();
      bot.setPacket(packetId);
      const err = await bot.waitForProcessError('PACKET_NOT_AVAILABLE', 10000);
      expect(err.code).toBe('PACKET_NOT_AVAILABLE');
    } finally {
      bot.disconnect();
    }

    await otherCtx.close();
  } finally {
    if (packetId) {
      await deletePacket(packetId, authorToken);
    }
  }
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
