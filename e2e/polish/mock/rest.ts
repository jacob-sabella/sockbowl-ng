/**
 * M5 H0: generic REST mock for the game API origin (`apiBaseUrl` /
 * `mock-game.test`) — admin bans/usage, user profile/stats/history, and the
 * game-session REST calls (create/join) that S1-S3 will use once STOMP
 * fixtures exist. One `page.route` per origin; dispatch is by method plus a
 * `:param`-style path template, tried in registration order.
 */
import type { Page } from '@playwright/test';
import { MOCK_GAME_ORIGIN } from './config.js';

export interface RestCallCtx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  headers: Record<string, string>;
}

export interface RestResult {
  status?: number;
  body?: unknown;
}

export type RestHandler = (ctx: RestCallCtx) => RestResult | Promise<RestResult>;

export interface RestRoute {
  method: string;
  /** e.g. `/api/v1/admin/usage/:sub/quota/:metric` */
  template: string;
  handler: RestHandler;
}

function compile(template: string): RegExp {
  const escaped = template
    .split('/')
    .map(seg => (seg.startsWith(':') ? `(?<${seg.slice(1)}>[^/]+)` : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${escaped}$`);
}

/** Registers every route in `routes` against the game-API origin. Call before `page.goto`. */
export async function mockRest(page: Page, routes: RestRoute[]): Promise<void> {
  const compiled = routes.map(r => ({ ...r, re: compile(r.template) }));
  await page.route(`${MOCK_GAME_ORIGIN}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    for (const r of compiled) {
      if (r.method !== method) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      let body: unknown = undefined;
      const raw = request.postData();
      if (raw) {
        try { body = JSON.parse(raw); } catch { body = raw; }
      }
      const result = await r.handler({
        params: m.groups ?? {},
        query: url.searchParams,
        body,
        headers: await request.allHeaders(),
      });
      await route.fulfill({
        status: result.status ?? 200,
        contentType: 'application/json',
        body: result.body === undefined ? '' : JSON.stringify(result.body),
      });
      return;
    }
    // Unmocked endpoint under the mock origin: fail loudly rather than hang
    // (there is no real server behind mock-game.test).
    await route.fulfill({
      status: 501,
      contentType: 'application/json',
      body: JSON.stringify({ error: `no mock route for ${method} ${url.pathname}` }),
    });
  });
}

/** A bare 200 with `body`, for the common case. */
export function ok(body: unknown): RestResult {
  return { status: 200, body };
}

/** A game/questions-style error body: `{code, message}` (M4's error contract). */
export function apiError(status: number, code: string, message = code): RestResult {
  return { status, body: { code, message } };
}
