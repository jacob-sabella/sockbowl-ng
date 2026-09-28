/**
 * M5 recheck: real keyboard-driven focus for the harness's `:focus-visible`
 * evidence captures (the F2 token move's `--focus-ring` had no screenshot
 * proving it actually paints for a keyboard user). Chromium's
 * `:focus-visible` heuristic keys off *how* focus moved — a script
 * `Locator.focus()` call does not reliably paint the ring the way a real
 * `Tab` keypress does — so this drives actual `Tab` presses until
 * `document.activeElement` is the target, giving a capture that shows the
 * same ring a keyboard user would see, not just a focused-but-unstyled
 * element.
 */
import type { Locator, Page } from '@playwright/test';

export async function focusByKeyboard(page: Page, target: Locator, opts: { maxTabs?: number } = {}): Promise<void> {
  const maxTabs = opts.maxTabs ?? 75;
  const handle = await target.first().elementHandle();
  if (!handle) throw new Error('focusByKeyboard: target locator matched no element');
  // Start from a known, unfocused state so Tab order is deterministic
  // (a state's own setup/afterGoto steps may have left focus elsewhere).
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');
    const reached = await page.evaluate(el => document.activeElement === el, handle);
    if (reached) return;
  }
  throw new Error(`focusByKeyboard: Tab did not reach the target within ${maxTabs} presses`);
}
