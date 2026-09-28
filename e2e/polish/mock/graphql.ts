/**
 * M5 H0: generic GraphQL-over-HTTP mock for the questions API
 * (`sockbowlQuestionsApiUrl` / `mock-questions.test`), used by packet
 * authoring (S4), taxonomy admin (S5) and packet search (S3).
 *
 * Every query in this codebase is anonymous (no `query Foo { ... }` name —
 * see `sockbowl-questions.service.ts` / `packet-authoring.service.ts`), so
 * dispatch is by the outer selection's root field name (`packets`,
 * `getPacketById`, `createPacket`, ...), extracted from the request body's
 * `query` text. One `page.route` handles every operation; a scenario
 * supplies a `GraphqlHandlers` map keyed by that field name.
 */
import type { Page } from '@playwright/test';
import { MOCK_QUESTIONS_ORIGIN } from './config.js';

export interface GraphqlCallCtx {
  field: string;
  query: string;
  variables: Record<string, unknown>;
}

export interface GraphqlResult {
  data?: unknown;
  errors?: { message: string; extensions?: Record<string, unknown> }[];
  status?: number;
}

export type GraphqlHandler = (ctx: GraphqlCallCtx) => GraphqlResult | Promise<GraphqlResult>;
export type GraphqlHandlers = Record<string, GraphqlHandler>;

/** First field name inside the outermost `{ ... }` of a `query`/`mutation`. */
export function rootField(query: string): string | null {
  const m = query.match(/(?:query|mutation)\s*(?:[A-Za-z_][\w]*)?\s*(?:\([^)]*\))?\s*\{\s*([A-Za-z_][\w]*)/);
  return m ? m[1] : null;
}

/**
 * A permissive default for any mutation a scenario didn't bother mocking
 * explicitly: `createX`/`cloneX`/`importX` fabricate an id, `deleteX`
 * resolves true, everything else resolves null. Good enough for a capture
 * that only needs the page to keep rendering after an action, not to reflect
 * the mutation's effect.
 */
function fallback(ctx: GraphqlCallCtx): GraphqlResult {
  const f = ctx.field;
  if (/^(create|clone|import)/i.test(f)) {
    return { data: { [f]: { id: `mock-${f}-id` } } };
  }
  if (/^delete/i.test(f)) {
    return { data: { [f]: true } };
  }
  if (/^(rename|merge)/i.test(f)) {
    return { data: { [f]: true } };
  }
  return { data: { [f]: null } };
}

/**
 * Registers the `/graphql` route against `handlers`, falling back to
 * {@link fallback} for any field with no explicit handler. Call before
 * `page.goto`.
 */
export async function mockGraphql(page: Page, handlers: GraphqlHandlers): Promise<void> {
  await page.route(`${MOCK_QUESTIONS_ORIGIN}/graphql`, async route => {
    const request = route.request();
    let body: { query?: string; variables?: Record<string, unknown> };
    try {
      body = JSON.parse(request.postData() || '{}');
    } catch {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ errors: [{ message: 'bad request body' }] }) });
      return;
    }
    const query = body.query || '';
    const variables = body.variables || {};
    const field = rootField(query);
    if (!field) {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ errors: [{ message: 'mock: could not determine root field' }] }) });
      return;
    }
    const handler = handlers[field] ?? fallback;
    const result = await handler({ field, query, variables });
    await route.fulfill({
      status: result.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: result.data ?? null, errors: result.errors }),
    });
  });
}

/** A GraphQL error body shaped like `graphql-client.service.ts` expects (`extensions.classification`). */
export function graphqlError(message: string, classification: string, status = 200): GraphqlResult {
  return { status, errors: [{ message, extensions: { classification } }] };
}
