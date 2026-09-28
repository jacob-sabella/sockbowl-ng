// This import must run before any fetch()/WebSocket call in the process: it
// wires SOCKBOWL_RESOLVE into the global fetch dispatcher (M7 §3.1 item 4).
import './resolve.js';

// Target endpoints. Default to a local docker-compose stack (M7 H10 -- the
// M2-M6 live deployment default was a real cross-origin host and is no
// longer reachable/desired as the fallback). Two ways to point this harness
// elsewhere:
//
//   - Port mode (per-service host:port, the M2-M6 default shape), e.g.:
//       SOCKBOWL_API=http://localhost:7000 \
//       SOCKBOWL_WS=ws://localhost:7000/sockbowl-game \
//       SOCKBOWL_QUESTIONS=http://localhost:7009 \
//       SOCKBOWL_APP=http://localhost \
//       npx playwright test --project=m3-auth-off tests/packet-builder.spec.ts
//
//   - Path mode (SOCKBOWL_PATH_MODE=1): every endpoint is derived from one
//     SOCKBOWL_BASE_URL as a path under a single origin, matching the M7
//     prod Caddy routing (§3.1 item 4 / §7), e.g.:
//       SOCKBOWL_BASE_URL=https://sockbowl.jacobsabella.com \
//       SOCKBOWL_PATH_MODE=1 \
//       SOCKBOWL_RESOLVE=sockbowl.jacobsabella.com:443:127.0.0.1 \
//       NODE_EXTRA_CA_CERTS=<scratch>/sbm7v-ca.crt \
//       npx playwright test --project=m3-auth-off tests/packet-builder.spec.ts
//
// SOCKBOWL_API/SOCKBOWL_WS/SOCKBOWL_QUESTIONS/SOCKBOWL_APP always win when
// set, in either mode -- they are explicit per-endpoint overrides, not just
// the port-mode defaults. SOCKBOWL_QUESTIONS has no trailing slash
// (harness/questions.ts appends `/graphql` itself). The auth-on project
// additionally needs whatever `tests-auth/helpers/login.ts` (imported by
// packet-builder.spec.ts) uses to reach the app's own login flow -- nothing
// extra here, since that helper drives the real Keycloak redirect from
// SOCKBOWL_APP.
const BASE_URL = process.env.SOCKBOWL_BASE_URL ?? 'http://localhost';
const PATH_MODE = process.env.SOCKBOWL_PATH_MODE === '1';
const WS_BASE_URL = BASE_URL.replace(/^http/, 'ws');

export const HTTP_BASE = process.env.SOCKBOWL_API
  ?? (PATH_MODE ? BASE_URL : 'http://localhost:7000');
export const WS_URL = process.env.SOCKBOWL_WS
  ?? (PATH_MODE ? `${WS_BASE_URL}/ws` : 'ws://localhost:7000/sockbowl-game');
export const QUESTIONS_BASE = process.env.SOCKBOWL_QUESTIONS
  ?? (PATH_MODE ? `${BASE_URL}/questions` : 'http://localhost:7009');
export const APP_URL = process.env.SOCKBOWL_APP ?? BASE_URL;
