// resolve-node-dns.ts — SOCKBOWL_RESOLVE for Playwright's own Node-side HTTP
// client (page.request / APIRequestContext), imported for its side effect by
// login.ts's getKeycloakId (used by auth-ban.spec.ts, auth-generate.spec.ts,
// auth-login-play.spec.ts).
//
// playwright.auth.config.ts's `launchOptions.args: [--host-resolver-rules=…]`
// (from PW_HOST_RESOLVER_RULES, plans/m7-deploy.md §7 step 7) only pins DNS
// inside the Chromium process the browser itself runs in — every navigation
// and in-page fetch/XHR the app makes goes through it. `page.request`, by
// contrast, is Playwright's own Node-side HTTP client, running in the test
// process, and Node's default `http`/`https` `Agent` resolves through
// `dns.lookup()` regardless of what the browser was told. Without this, a
// throwaway local rehearsal's real public hostname (e.g.
// sockbowl.jacobsabella.com, resolved to 127.0.0.1 for everything else)
// fails `page.request` calls with ENOTFOUND, since that hostname has no real
// DNS record.
//
// e2e/harness/resolve.ts solves the same problem for that package's own
// fetch()/WebSocket calls by pointing undici's global dispatcher at a custom
// `lookup`; `page.request` isn't undici, so this instead patches Node's
// `dns.lookup`/`dns.promises.lookup` directly — the lower-level hook every
// Node HTTP client, including Playwright's, ultimately falls back to.
//
// Same SOCKBOWL_RESOLVE=host:port:ip syntax as curl's --resolve and
// e2e/harness/resolve.ts (the port is accepted for symmetry but unused: a
// single rule pins every port on that host). A no-op when unset, so this is
// safe to import unconditionally.
import dns from 'node:dns';

function parseResolveRule(raw: string | undefined): { host: string; ip: string; family: 4 | 6 } | null {
  if (!raw) return null;
  const parts = raw.split(':');
  if (parts.length < 3) {
    throw new Error(`SOCKBOWL_RESOLVE must be host:port:ip, got "${raw}"`);
  }
  const host = parts[0];
  const ip = parts.slice(2).join(':');
  const family: 4 | 6 = ip.includes(':') ? 6 : 4;
  return { host, ip, family };
}

const rule = parseResolveRule(process.env.SOCKBOWL_RESOLVE);

if (rule) {
  type LookupCallback = (err: NodeJS.ErrnoException | null, address: string, family: number) => void;
  const realLookup = dns.lookup.bind(dns);
  const patched = ((hostname: string, ...rest: unknown[]) => {
    const callback = rest[rest.length - 1] as LookupCallback;
    if (hostname === rule.host) {
      callback(null, rule.ip, rule.family);
      return;
    }
    return (realLookup as (...args: unknown[]) => void)(hostname, ...rest);
  }) as typeof dns.lookup;
  // @ts-expect-error -- intentionally reassigning the module's own export;
  // every Node http/https Agent (including Playwright's request context)
  // resolves through this same `dns.lookup` unless given a custom one, and
  // Playwright's public API exposes no such hook.
  dns.lookup = patched;

  const realPromiseLookup = dns.promises.lookup.bind(dns.promises);
  // @ts-expect-error -- same rationale, for callers that use dns.promises.
  dns.promises.lookup = (async (hostname: string, options?: unknown) => {
    if (hostname === rule.host) {
      return { address: rule.ip, family: rule.family };
    }
    return realPromiseLookup(hostname, options as never);
  }) as typeof dns.promises.lookup;
}
