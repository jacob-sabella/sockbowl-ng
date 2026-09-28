import dns from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Agent, setGlobalDispatcher } from 'undici';

/**
 * M7 §3.1 item 4 / §7 step 7: SOCKBOWL_RESOLVE=host:port:ip pins DNS for
 * exactly that host to a literal IP, the way curl's `--resolve` does, so
 * this harness can hit a throwaway compose stack's real public hostname
 * (e.g. sockbowl.jacobsabella.com, with a locally-trusted cert from
 * `verify.compose.yml`'s Caddy) without an /etc/hosts edit. The port field
 * is accepted for symmetry with curl's syntax but isn't used to select the
 * rule: `dns.lookup()` has no port, so one SOCKBOWL_RESOLVE rule pins every
 * port for that host.
 */
function parseResolveRule(raw: string | undefined): { host: string; ip: string; family: 4 | 6 } | null {
  if (!raw) return null;
  const parts = raw.split(':');
  if (parts.length < 3) {
    throw new Error(`SOCKBOWL_RESOLVE must be host:port:ip, got "${raw}"`);
  }
  const host = parts[0];
  // An IPv6 literal itself contains colons, so everything after the port is the IP.
  const ip = parts.slice(2).join(':');
  const family: 4 | 6 = ip.includes(':') ? 6 : 4;
  return { host, ip, family };
}

const rule = parseResolveRule(process.env.SOCKBOWL_RESOLVE);

/**
 * A `dns.lookup`-compatible function: returns the pinned IP for the
 * SOCKBOWL_RESOLVE host, and falls through to the real resolver for every
 * other hostname. Passed to the `ws` package (bot.ts's WebSocket) and to
 * undici's `connect.lookup` (fetch, wired up below) so both transports
 * agree on where the pinned host actually lives.
 */
export const resolveLookup: LookupFunction = ((hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
  if (rule && hostname === rule.host) {
    callback(null, rule.ip, rule.family);
    return;
  }
  (dns.lookup as (...args: unknown[]) => void)(hostname, options, callback);
}) as LookupFunction;

export const hasResolveRule = rule !== null;

// Node's global fetch is undici under the hood; pointing its dispatcher at
// an Agent with our lookup is what makes fetch() honour SOCKBOWL_RESOLVE too
// (bot.ts's raw WebSocket connections take `resolveLookup` directly instead,
// since `ws` has its own lookup option and isn't routed through undici).
// NODE_EXTRA_CA_CERTS needs no code here: Node's TLS stack reads it
// natively for every https/wss connection in the process.
if (rule) {
  setGlobalDispatcher(new Agent({ connect: { lookup: resolveLookup } }));
}
