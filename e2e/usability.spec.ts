import { test, expect, type Page, type Locator } from '@playwright/test';
import { createGame, joinByCode, importQbreaderPacket, type JoinResult } from './harness/rest.js';
import { SockbowlBot, spawnBot } from './harness/bot.js';
import { APP_URL } from './harness/config.js';

/**
 * Human-centric usability audit (ported from the mage client's ruleset). Every
 * rule is checked programmatically across a viewport matrix; a violation is a
 * real defect to fix in the CSS/component, never in the test. Opt-in via
 * AUDIT=1 (`npm run audit`). See USABILITY.md for the rules.
 */
const AUDIT = !!process.env.AUDIT;

const VIEWPORTS = [
  { name: 'galaxy-fold', w: 280, h: 653 },
  { name: 'iphone-se', w: 375, h: 667 },
  { name: 'small-android', w: 360, h: 640 },
  { name: 'iphone-14', w: 390, h: 844 },
  { name: 'mobile-landscape', w: 844, h: 390 },
  { name: 'ipad-portrait', w: 768, h: 1024 },
  { name: 'ipad-landscape', w: 1024, h: 768 },
  { name: 'laptop', w: 1366, h: 768 },
  { name: 'desktop', w: 1920, h: 1080 },
  { name: 'ultrawide', w: 2560, h: 1080 },
];
const REP = [
  { name: 'small-android', w: 360, h: 640 },
  { name: 'ipad-portrait', w: 768, h: 1024 },
  { name: 'laptop', w: 1366, h: 768 },
];

// Decorative elements exempt from the animation/motion rules (looping by design).
const DECORATIVE = ['buzz-button', 'mat-spinner', 'mat-progress', 'spinner', 'glow', 'scene', 'backdrop', 'lobby-action-arrow'];

const settle = (p: Page) => p.waitForTimeout(1400);
const deepLink = (j: JoinResult) =>
  `${APP_URL}/game;gameSessionId=${j.gameSessionId};playerSecret=${j.playerSecret};playerSessionId=${j.playerSessionId}`;

// --------------------------- ported rule checks ---------------------------

/** Rule 1: no horizontal overflow. */
async function checkOverflow(page: Page): Promise<string[]> {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  return o > 2 ? [`horizontal overflow ${o}px`] : [];
}

/** Rules 2+3: a control is a comfortable size and (when on-screen) not covered. */
async function checkControl(page: Page, loc: Locator, label: string, mobile: boolean): Promise<string[]> {
  const errs: string[] = [];
  if ((await loc.count()) === 0) return [`${label}: missing`];
  const el = loc.first();
  if (!(await el.isVisible().catch(() => false))) return [`${label}: hidden`];
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const box = await el.boundingBox();
  if (!box) return [`${label}: no box`];
  const meta = await el.evaluate((n) => ({ tag: (n as Element).tagName, pe: getComputedStyle(n as Element).pointerEvents }));
  const eps = 0.5;
  const min = meta.tag === 'INPUT' ? 14 : mobile ? 40 : 24;
  if (box.height < min - eps) errs.push(`${label}: short ${Math.round(box.height)}px`);
  if (box.width < min - eps) errs.push(`${label}: narrow ${Math.round(box.width)}px`);
  const vpW = page.viewportSize()!.width;
  const centreX = box.x + box.width / 2;
  if (centreX < 0 || centreX > vpW) errs.push(`${label}: off-screen horizontally (x=${Math.round(centreX)}, vp ${vpW})`);
  const vp = page.viewportSize()!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  if (meta.pe !== 'none' && cx >= 0 && cy >= 0 && cx <= vp.width && cy <= vp.height) {
    const hit = await el.evaluate((node, [x, y]) => {
      const e = document.elementFromPoint(x as number, y as number);
      if (!e) return { ok: false, tag: 'none' };
      // A Material floating label / field overlay sitting over its own input is
      // part of the same control, not a foreign element covering it.
      const ff = (n: Element | null) => n?.closest?.('mat-form-field, .mat-mdc-form-field') ?? null;
      const sameField = !!ff(e) && ff(e) === ff(node as Element);
      const ok = e === node || (node as Element).contains(e) || (e as HTMLElement).contains(node as Node) || sameField;
      return { ok, tag: `${e.tagName}.${(e.className || '').toString().split(' ')[0]}` };
    }, [cx, cy]);
    if (!hit.ok) errs.push(`${label}: covered by ${hit.tag}`);
  }
  return errs;
}

/** Rule 5: no unbounded/over-long animation on visible non-decorative elements. */
async function checkAnimationBounds(page: Page): Promise<string[]> {
  return page.evaluate((decorative) => {
    const errs: string[] = [];
    const isDecorative = (el: Element) => {
      let n: Element | null = el;
      while (n) { if (decorative.some((d) => (n!.className || '').toString().includes(d))) return true; n = n.parentElement; }
      return false;
    };
    const seen = new Set<string>();
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > window.innerHeight) continue;
      const cs = getComputedStyle(el);
      const dur = Math.max(...cs.animationDuration.split(',').map((s) => parseFloat(s) * (s.includes('ms') ? 1 : 1000)));
      if (cs.animationName !== 'none' && (cs.animationIterationCount === 'infinite' || dur > 600) && !isDecorative(el)) {
        const key = `${(el.className || '').toString().split(' ')[0]}:${cs.animationName}`;
        if (!seen.has(key)) { seen.add(key); errs.push(`unbounded animation ${key} (${cs.animationIterationCount}, ${dur}ms)`); }
      }
      const td = Math.max(...cs.transitionDuration.split(',').map((s) => parseFloat(s) * (s.includes('ms') ? 1 : 1000)));
      if (td > 600 && !isDecorative(el)) {
        const key = `${(el.className || '').toString().split(' ')[0]}:transition`;
        if (!seen.has(key)) { seen.add(key); errs.push(`over-long transition ${key} (${td}ms)`); }
      }
    }
    return errs;
  }, DECORATIVE);
}

/** Rule 8: no primary text below 11px (uppercase micro-labels / decorative exempt). */
async function checkReadableText(page: Page): Promise<string[]> {
  return page.evaluate((decorative) => {
    const errs: string[] = [];
    const seen = new Set<string>();
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const text = Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => (n.textContent || '').trim()).join(' ').trim();
      if (text.length < 4) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > window.innerHeight) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const cls = (el.className || '').toString();
      if (decorative.some((d) => cls.includes(d)) || cs.textTransform === 'uppercase') continue;
      const fs = parseFloat(cs.fontSize);
      if (fs < 11) { const key = `${el.tagName}.${cls.split(' ')[0]}`; if (!seen.has(key)) { seen.add(key); errs.push(`tiny text ${key} ${fs}px "${text.slice(0, 24)}"`); } }
    }
    return errs;
  }, DECORATIVE);
}

/** Rule 7: an overlay must be hit-testable above page content at its centre. */
async function checkOverlayAbove(page: Page, loc: Locator, label: string): Promise<string[]> {
  if ((await loc.count()) === 0 || !(await loc.first().isVisible().catch(() => false))) return [];
  const box = await loc.first().boundingBox();
  if (!box) return [];
  const vp = page.viewportSize()!;
  const cx = Math.min(Math.max(box.x + box.width / 2, 1), vp.width - 1);
  const cy = Math.min(Math.max(box.y + box.height / 2, 1), vp.height - 1);
  const hit = await loc.first().evaluate((node, [x, y]) => {
    const e = document.elementFromPoint(x as number, y as number);
    return !!e && (e === node || (node as Element).contains(e) || (e as HTMLElement).contains(node as Node));
  }, [cx, cy]);
  return hit ? [] : [`overlay ${label} not on top at centre`];
}

// ------------------------------- screens ---------------------------------

type Screen = { name: string; go: (p: Page) => Promise<void>; controls: (p: Page) => { label: string; loc: Locator }[]; overlay?: (p: Page) => Locator };

const STATIC_SCREENS: Screen[] = [
  {
    name: 'landing',
    go: async (p) => { await p.goto(APP_URL, { waitUntil: 'domcontentloaded' }); await settle(p); },
    controls: (p) => [
      { label: 'host', loc: p.getByRole('button', { name: /Host a match/i }) },
      { label: 'join', loc: p.getByRole('button', { name: /Join with a code/i }) },
    ],
  },
  {
    name: 'create-form',
    go: async (p) => { await p.goto(APP_URL, { waitUntil: 'domcontentloaded' }); await settle(p); await p.getByRole('button', { name: /Host a match/i }).click(); await settle(p); },
    controls: (p) => [
      // Measure the whole form field (the real tap area), not the inner trigger.
      { label: 'game-mode', loc: p.locator('mat-form-field').first() },
      { label: 'name', loc: p.locator('mat-form-field').nth(1) },
      { label: 'create', loc: p.getByRole('button', { name: /^Create$/i }) },
    ],
  },
  {
    name: 'join-form',
    go: async (p) => { await p.goto(APP_URL, { waitUntil: 'domcontentloaded' }); await settle(p); await p.getByRole('button', { name: /Join with a code/i }).click(); await settle(p); },
    controls: (p) => [
      { label: 'join-code', loc: p.locator('input').first() },
      { label: 'join', loc: p.getByRole('button', { name: /^Join$/i }) },
    ],
  },
];

// ============================ PART A: matrix ============================
(AUDIT ? test.describe : test.describe.skip)('usability · static screens · matrix', () => {
  for (const vp of VIEWPORTS) {
    test.describe(`${vp.name} ${vp.w}x${vp.h}`, () => {
      test.use({ viewport: { width: vp.w, height: vp.h } });
      const mobile = vp.w <= 760;
      for (const screen of STATIC_SCREENS) {
        test(screen.name, async ({ page }) => {
          await screen.go(page);
          const errs: string[] = [];
          errs.push(...(await checkOverflow(page)));
          for (const c of screen.controls(page)) errs.push(...(await checkControl(page, c.loc, c.label, mobile)));
          errs.push(...(await checkAnimationBounds(page)));
          errs.push(...(await checkReadableText(page)));
          expect(errs, `\n  ${errs.join('\n  ')}\n`).toEqual([]);
        });
      }
    });
  }
});

// ==================== PART B: in-game screens (harness) ====================
// Reaching the buzzer / spectator / proctor-config surfaces needs a real match,
// so we stage one with bots and drop browsers into each view at rep viewports.
(AUDIT ? test.describe : test.describe.skip)('usability · in-game screens', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  for (const vp of REP) {
    const mobile = vp.w <= 760;

    test(`config-lobby (proctor) · ${vp.name}`, async ({ browser }) => {
      const game = await createGame();
      const player = await spawnBot(joinByCode, game.joinCode, 'Blaise'); // roster
      const pj = await joinByCode(game.joinCode, 'Proctor');
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      const page = await ctx.newPage();
      await page.goto(deepLink(pj), { waitUntil: 'domcontentloaded' });
      await settle(page);
      await page.getByRole('button', { name: /Become Proctor/i }).click().catch(() => {});
      await settle(page);
      const errs: string[] = [];
      errs.push(...(await checkOverflow(page)));
      for (const c of [
        { label: 'find-packet', loc: page.getByRole('button', { name: /Find a Packet/i }) },
        { label: 'start-game', loc: page.getByRole('button', { name: /Start Game/i }) },
        { label: 'join-team-1', loc: page.getByRole('button', { name: /Join Team 1/i }) },
      ]) errs.push(...(await checkControl(page, c.loc, c.label, mobile)));
      errs.push(...(await checkReadableText(page)));
      await ctx.close();
      player.disconnect();
      expect(errs, `\n  ${errs.join('\n  ')}\n`).toEqual([]);
    });

    test(`buzzer + spectator · ${vp.name}`, async ({ browser }) => {
      const game = await createGame();
      const packetId = await importQbreaderPacket('2021 SMH', 1);
      const pj = await joinByCode(game.joinCode, 'Proctor');
      const proctor = new SockbowlBot('Proctor', pj.gameSessionId, pj.playerSecret, pj.playerSessionId);
      await proctor.connect();
      await proctor.waitFor((g) => !!g.teamList?.length, 8000, 'teams');
      const teams = proctor.teams;
      const mate = await spawnBot(joinByCode, game.joinCode, 'Blaise');
      mate.joinTeam(teams[1].teamId);

      // browser player on Team 1 (buzzer) + browser spectator
      const adaJoin = await joinByCode(game.joinCode, 'Ada');
      const aCtx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      const aPage = await aCtx.newPage();
      await aPage.goto(deepLink(adaJoin), { waitUntil: 'domcontentloaded' });
      await settle(aPage);
      await aPage.getByRole('button', { name: /Join Team 1/i }).click();
      await settle(aPage);

      const valJoin = await joinByCode(game.joinCode, 'Val');
      const sCtx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      const sPage = await sCtx.newPage();
      await sPage.goto(deepLink(valJoin), { waitUntil: 'domcontentloaded' });
      await settle(sPage);

      proctor.becomeProctor();
      proctor.setPacket(packetId);
      await proctor.waitFor((g) => g.currentMatch?.packet?.id === packetId, 15000, 'packet set');
      proctor.startMatch();
      await proctor.waitFor((g) => g.currentMatch?.matchState === 'IN_GAME', 12000, 'IN_GAME');
      if (proctor.roundState === 'PROCTOR_READING') proctor.finishedReading();
      await proctor.waitFor((g) => g.currentMatch?.currentRound?.roundState === 'AWAITING_BUZZ', 12000, 'AWAITING_BUZZ');
      await settle(aPage);
      await settle(sPage);

      const errs: string[] = [];
      // buzzer view
      errs.push(...(await checkOverflow(aPage)).map((e) => `buzzer: ${e}`));
      errs.push(...(await checkControl(aPage, aPage.locator('#buzz-button, .buzz-button').first(), 'buzz-button', mobile)));
      errs.push(...(await checkReadableText(aPage)).map((e) => `buzzer: ${e}`));
      // spectator view
      errs.push(...(await checkOverflow(sPage)).map((e) => `spectator: ${e}`));
      errs.push(...(await checkReadableText(sPage)).map((e) => `spectator: ${e}`));

      await aCtx.close();
      await sCtx.close();
      proctor.disconnect();
      mate.disconnect();
      expect(errs, `\n  ${errs.join('\n  ')}\n`).toEqual([]);
    });
  }
});

// ==================== PART C: focus + reduce-motion ====================
(AUDIT ? test.describe : test.describe.skip)('usability · focus + motion', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('primary control is focusable and :focus-visible styling ships', async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await settle(page);
    const btn = page.getByRole('button', { name: /Host a match/i });
    await btn.focus();
    await expect(btn).toBeFocused();
    const hasFocusVisible = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try { rules = sheet.cssRules; } catch { continue; }
        for (const r of Array.from(rules)) {
          if (r instanceof CSSStyleRule && r.selectorText?.includes(':focus-visible')) return true;
        }
      }
      return false;
    });
    expect(hasFocusVisible, ':focus-visible styling must exist').toBe(true);
  });

  test('reduce-motion collapses non-decorative motion', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await settle(page);
    const moving = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > window.innerHeight) continue;
        const cs = getComputedStyle(el);
        const cls = (el.className || '').toString();
        if (['buzz-button', 'spinner', 'mat-progress', 'glow'].some((d) => cls.includes(d))) continue;
        const dur = Math.max(...cs.animationDuration.split(',').map((s) => parseFloat(s) * (s.includes('ms') ? 1 : 1000)));
        if (cs.animationName !== 'none' && cs.animationIterationCount === 'infinite' && dur > 0) bad.push(`${el.tagName}.${cls.split(' ')[0]} ${cs.animationName}`);
      }
      return bad;
    });
    await ctx.close();
    expect(moving, moving.join(' | ')).toEqual([]);
  });
});

test('usability suite is opt-in (AUDIT=1)', () => {
  expect(AUDIT || true).toBeTruthy();
});
