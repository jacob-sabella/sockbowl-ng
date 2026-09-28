/**
 * Minimal, mocked-capture-safe ports of two of `e2e/usability.spec.ts`'s
 * rule checks (overflow, control size/coverage). That file's checks are
 * private (unexported) and built for the *live* full-stack harness
 * (`AUDIT=1`, real backend, bot-driven matches) — it has no `/admin`
 * coverage and no way to mock REST/GraphQL admin data. S5-14 asks for the
 * admin routes to get usability coverage without waiting on a live stack,
 * so this file re-implements the two rules that matter for a static admin
 * page (no overlays, no animation-heavy views) against the mocked harness
 * instead.
 *
 * Known gap (S5-14, reported rather than fixed): these functions are
 * copies, not re-exports, of `checkOverflow`/`checkControl` in
 * `e2e/usability.spec.ts`. That file is shared across every M5 surface and
 * outside S5's own worktree, so it isn't edited here. A future pass
 * (H0/F2 territory) should export the originals there and delete this file.
 */
import type { Page, Locator } from '@playwright/test';

/** Rule 1: no horizontal overflow. */
export async function checkOverflow(page: Page): Promise<string[]> {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  return o > 2 ? [`horizontal overflow ${o}px`] : [];
}

/**
 * Content-scoped overflow: does anything *inside* `containerSelector` push
 * past the viewport's right edge? Unlike {@link checkOverflow} (whole
 * document), this attributes overflow to the surface under test rather
 * than to app chrome outside it (navbar, banners) that the surface doesn't
 * own — see `admin-responsive.spec.ts`'s header for why S5 needs this
 * split (H-07: the shell's own `document`-level overflow at narrow/medium
 * widths for authenticated roles is a filed, S6-owned gap, not an S5 one).
 */
export async function checkContentOverflow(page: Page, containerSelector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const container = document.querySelector(sel);
    if (!container) return [`content overflow: "${sel}" not found`];
    const vpW = document.documentElement.clientWidth;

    // An element whose own box is wide but sits inside an ancestor (within
    // `container`) that clips it (`overflow` != visible) and whose *own*
    // right edge doesn't overflow isn't a real page-level overflow — e.g.
    // Material tab bodies lay out off-screen siblings for the slide
    // animation behind an `overflow: hidden` wrapper, and a `sr-only`
    // header behind `overflow: hidden` for assistive tech. Real overflow
    // bleeds through to something unclipped (ultimately the document).
    const clipped = (el: Element): boolean => {
      let n: Element | null = el.parentElement;
      while (n) {
        const cs = getComputedStyle(n);
        if (cs.overflowX !== 'visible' || cs.overflow !== 'visible') {
          const r = n.getBoundingClientRect();
          if (r.right <= vpW + 2) return true;
        }
        if (n === container) break;
        n = n.parentElement;
      }
      return false;
    };

    const errs: string[] = [];
    for (const el of [container, ...Array.from(container.querySelectorAll('*'))]) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > vpW + 2 && !clipped(el)) {
        const cls = (el.className || '').toString().split(' ')[0];
        errs.push(`content overflow: ${el.tagName}.${cls} right=${Math.round(r.right)} vp=${vpW}`);
      }
    }
    return errs.slice(0, 5); // one page's worth is enough signal
  }, containerSelector);
}

/** Rules 2+3: a control is a comfortable size and (when on-screen) not covered. */
export async function checkControl(page: Page, loc: Locator, label: string, mobile: boolean): Promise<string[]> {
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
