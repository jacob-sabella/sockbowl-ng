// Target endpoints. Default to the live deployment; override via env to point
// the harness at a local docker-compose stack, e.g. (M3's E1, both auth
// postures, against a compose stack whose app services publish on the host):
//
//   SOCKBOWL_API=http://localhost:7000 \
//   SOCKBOWL_WS=ws://localhost:7000/sockbowl-game \
//   SOCKBOWL_QUESTIONS=http://localhost:7009 \
//   SOCKBOWL_APP=http://localhost \
//   npx playwright test --project=m3-auth-off tests/packet-builder.spec.ts
//
// SOCKBOWL_QUESTIONS has no trailing slash (harness/questions.ts appends
// `/graphql` itself). The auth-on project additionally needs whatever
// `tests-auth/helpers/login.ts` (imported by packet-builder.spec.ts) uses to
// reach the app's own login flow — nothing extra here, since that helper
// drives the real Keycloak redirect from SOCKBOWL_APP.
export const HTTP_BASE = process.env.SOCKBOWL_API ?? 'https://api.sockbowl.com';
export const WS_URL = process.env.SOCKBOWL_WS ?? 'wss://api.sockbowl.com/sockbowl-game';
export const QUESTIONS_BASE = process.env.SOCKBOWL_QUESTIONS ?? 'https://questions.sockbowl.com';
export const APP_URL = process.env.SOCKBOWL_APP ?? 'https://sockbowl.com';
