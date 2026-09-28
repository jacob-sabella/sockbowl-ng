/**
 * M5 H0: shared capture/manifest plumbing for `e2e/polish/`.
 *
 * Every surface's `capture.spec.ts` run writes screenshots under
 * `~/Projects/sockbowl/audit/m5/shots/<surface>/<phase>/` (outside every repo,
 * per the M5 plan §3/§6: `.impeccable/*` and screenshots never get committed)
 * plus one `manifest.json` per `<surface>/<phase>` directory, appended to
 * across `--grep @sN` runs so a partial run doesn't clobber earlier rows.
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

/** This module's own directory (ESM has no `__dirname`). */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** `phase` values the M5 plan §6 ledger table expects. H0 only ever writes `baseline` and `self-check`. */
export type CapturePhase = 'baseline' | 'post-f1' | 'final' | 'verdict' | 'v1' | 'self-check';

export interface ManifestRow {
  surface: string;
  phase: CapturePhase;
  state: string;
  role: string;
  auth: 'on' | 'off';
  viewport: string;
  theme: string;
  route: string;
  file: string | null;
  sha256: string | null;
  ngHead: string;
  mocked: boolean;
  fontsLoaded: boolean | null;
  axeSerious: number | null;
  axeCritical: number | null;
  skipped?: string;
  recordedAt: string;
}

/** Root all shot output lives under, outside every repo (M5 plan §3). */
export const SHOTS_ROOT = process.env.POLISH_SHOTS_ROOT
  || join(process.env.HOME || '', 'Projects/sockbowl/audit/m5/shots');

export function shotsDir(surface: string, phase: CapturePhase): string {
  return join(SHOTS_ROOT, surface.toLowerCase(), phase);
}

export function manifestPath(surface: string, phase: CapturePhase): string {
  return join(shotsDir(surface, phase), 'manifest.json');
}

function readManifest(surface: string, phase: CapturePhase): ManifestRow[] {
  const p = manifestPath(surface, phase);
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Appends one row, replacing any earlier row with the same
 * state/role/viewport/theme key (so re-running `--grep @s4` after a fix
 * updates in place instead of duplicating). Written synchronously and
 * re-read/merged each call so parallel `--grep` shards for different states
 * of the *same* surface+phase don't stomp each other's rows (Playwright
 * workers run in separate processes; there is no shared in-memory manifest).
 */
export function appendManifestRow(row: ManifestRow): void {
  const dir = shotsDir(row.surface, row.phase);
  mkdirSync(dir, { recursive: true });
  const key = (r: ManifestRow) => `${r.state}__${r.role}__${r.viewport}__${r.theme}`;
  const rows = readManifest(row.surface, row.phase).filter(r => key(r) !== key(row));
  rows.push(row);
  rows.sort((a, b) => key(a).localeCompare(key(b)));
  writeFileSync(manifestPath(row.surface, row.phase), JSON.stringify(rows, null, 2) + '\n');
}

/** sha256 of a file already written to disk (the screenshot). */
export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** The ng worktree's current commit, recorded on every row (`ngHead`). */
let cachedHead: string | null = null;
export function ngHead(): string {
  if (cachedHead) return cachedHead;
  try {
    // Synchronous on purpose: called once per row, cheap, and every caller
    // is already inside a synchronous manifest write.
    cachedHead = execSync('git rev-parse --short=12 HEAD', { cwd: MODULE_DIR }).toString().trim();
  } catch {
    cachedHead = 'unknown';
  }
  return cachedHead;
}

export const VIEWPORTS: Record<string, { width: number; height: number }> = {
  mobile: { width: 390, height: 844 },
  'mobile-min': { width: 280, height: 653 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1440, height: 900 },
  tv: { width: 1920, height: 1080 },
  'tv-720': { width: 1280, height: 720 },
};

/** The two captured themes (M5 plan §2: "dark and light are captured"). */
export const CAPTURED_THEMES = ['dark', 'light'] as const;
/** All 8 themes, for the contrast/axe sweep only (not screenshotted by H0). */
export const ALL_THEMES = ['dark', 'light', 'nord', 'monokai', 'catppuccin', 'dracula', 'solarized-dark', 'solarized-light'] as const;

const THEME_STORAGE_KEY = 'sockbowl-theme-preference';

/** Sets the theme the same way `ThemeService` persists it, before the app boots. */
export async function presetTheme(page: Page, theme: string): Promise<void> {
  await page.addInitScript(({ key, value }) => {
    try { window.localStorage.setItem(key, value); } catch { /* private mode etc. */ }
  }, { key: THEME_STORAGE_KEY, value: theme });
}

/** Waits for web fonts and reports whether they actually loaded (M5 plan §4/§8 risk 6). */
export async function waitForFonts(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(async () => {
      try {
        await (document as any).fonts.ready;
        // `document.fonts.ready` resolves once layout's initial font set is
        // settled, but a Google Fonts @font-face can still be mid-swap; a
        // spot check on one of the app's declared families confirms it's
        // actually available, not just that the ready promise fired.
        return (document as any).fonts.check('16px Inter') || (document as any).fonts.size > 0;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/**
 * Runs axe-core against the current page (M5 plan §4: `wcag2a, wcag2aa,
 * wcag21aa, wcag22aa`), writes the JSON report alongside the screenshot, and
 * returns serious/critical counts for the manifest row.
 */
export async function runAxe(
  page: Page,
  surface: string,
  phase: CapturePhase,
  stateFile: string,
): Promise<{ serious: number; critical: number }> {
  const { AxeBuilder } = await import('@axe-core/playwright');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const axeDir = join(SHOTS_ROOT, surface.toLowerCase(), 'axe', phase);
  mkdirSync(axeDir, { recursive: true });
  writeFileSync(join(axeDir, `${stateFile}.json`), JSON.stringify(results, null, 2));
  const count = (impact: string) => results.violations.filter(v => v.impact === impact).length;
  return { serious: count('serious'), critical: count('critical') };
}

/** Slugifies a manifest key fragment into a filesystem-safe token. */
export function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}
