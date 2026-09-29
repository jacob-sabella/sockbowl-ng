# SockbowlNg

SockbowlNg is the Angular frontend for the Sockbowl platform: a real-time
quiz bowl client with phone buzzers, live proctoring and a shared board for
a TV or projector. It talks to `sockbowl-game` over STOMP-over-WebSocket and
REST, and to `sockbowl-questions` over GraphQL, with optional Keycloak
(OIDC) sign-in.

## Stack

- Angular 22.2, Angular Material 22.2, TypeScript ~6.0.3, RxJS
- Node `^20.19.0 || ^22.12.0 || >=24.0.0` (CI runs Node 24.x)
- Karma + Jasmine for unit tests, Playwright for e2e (three separate
  suites/harnesses — see "End-to-end tests" below)
- Served in production by nginx (see "Docker image" below); the app itself
  needs no JDK or Java toolchain

## Development

- `npm ci` — install (root package only; `e2e/` has its own `package.json`
  and needs its own `npm ci`, see below)
- `npm start` / `ng serve` — dev server at `http://localhost:4200`
- `npm run watch` — build with watch mode (development config)
- `npm run build` — development build, output in `dist/sockbowl-ng/browser`
- `npm run buildprod` — production build. **Run this before building the
  Docker image or pointing e2e at a locally-built stack.** The Docker image
  copies a pre-built `dist/`; it does not run `ng build` itself, so a stale
  or missing build serves stale or missing app code, not a build error.
- `npm test` / `ng test` — unit tests (Karma). CI uses the `ChromeHeadlessCI`
  launcher in `karma.conf.js`.
- `npm run lint` — `ng lint` (ESLint)
- `npm run test:headers` — `bash scripts/test-headers.sh`, builds the Docker
  image and checks the rendered security-headers snippet; needs Docker.
- `npm run codegen` — regenerates the backend-derived TypeScript interfaces
  in `src/app/game/models/sockbowl/sockbowl-interfaces.ts`; don't hand-edit
  that file.
- `npm run gen:cast-tokens` — regenerates `src/cast-theme-tokens.css` for the
  non-Angular cast receiver (`src/cast-receiver.html`) after changing a theme
  file under `src/styles/themes/`.

See `CLAUDE.md` for the module layout (`core/`, `game/`, `packets/`,
`structure/`, `shared/`, including the `shared/state` loading/empty/error
components) and the runtime-config/security-header env keys.

## Runtime configuration

The production image has no build-time API URLs. `docker-entrypoint.sh`
renders `src/assets/config.template.js` into `assets/config.js` at container
start from these environment variables (defaults shown):

| Variable | Default | Purpose |
|---|---|---|
| `APP_HOST` | `localhost` | Host for the game/questions/Keycloak origins |
| `APP_PROTOCOL` | `http` | `http`/`https` for those origins |
| `WS_PROTOCOL` | `ws` | `ws`/`wss` for the game WebSocket |
| `SOCKBOWL_GAME_PORT` | `7000` | Game REST + WebSocket port |
| `SOCKBOWL_QUESTIONS_PORT` | `7009` | Questions GraphQL port |
| `KEYCLOAK_PORT` | `8080` | Keycloak port |
| `AUTH_ENABLED` | `false` | Enables Keycloak sign-in and permission checks |
| `CSP_EXTRA_CONNECT_SRC` | `https://api.openai.com` | Extra `Content-Security-Policy` `connect-src` origin (the bring-your-own-key AI path) |

Under plain `ng serve`/`ng test` (no `window.__env`), `src/environments/environment.ts`
falls back to `localhost` dev defaults with `authEnabled: true`.

## Docker image

`Dockerfile` builds the production image: an nginx base serving the
pre-built `dist/sockbowl-ng/browser`, plus `docker-entrypoint.sh` (renders
`config.js` and the CSP/security-headers snippet at container start from the
table above) and `nginx.conf` (SPA fallback, no-cache on the service worker
and runtime config, PWA-correct manifest media type). Build it from this
repo's current branch with:

```sh
npm ci
npm run buildprod
docker build -t sockbowl-ng:local .
```

It's one image in the `sockbowl-docker` compose stack, which supplies the
env vars above alongside the other services' configuration; see that repo's
README for bringing up the full stack from source.

## End-to-end tests

Three separate suites/harnesses, each with its own config and testDir:

- **`tests/` (`npm run e2e`)** — the guest "clips" gallery: no login, defaults
  to `https://sockbowl.com` (override with `CLIPS_BASE_URL`). Runs the same
  whether the target stack has `AUTH_ENABLED` true or false, since guests can
  still host and play in both modes (D1), including generating a bank packet
  (D15: without `packet:create` this now yields an EPHEMERAL, game-only
  packet instead of an owned DRAFT — the UI flow is unchanged).
  `bonus.spec.ts` also calls the questions GraphQL API directly (to look up
  a generated packet's tossup answer); against a local stack, override that
  too with `SOCKBOWL_QUESTIONS_BASE_URL=http://localhost:7009` (or the full
  `SOCKBOWL_QUESTIONS_GRAPHQL_URL` if the path differs).
- **`tests-auth/` (`npm run e2e:auth`)** — the M2 authenticated suite (WP-N5).
  Logs in through the real Keycloak hosted login page (no direct-grant
  shortcut — that's what the separate `sockbowl-e2e` client and the headless
  `e2e/` bot harness use) and exercises login+play, RBAC-gated navigation,
  token refresh + logout, guest posture with auth on, banning, and the CSP
  (WP-N4). Workers are pinned to 1: specs share demo accounts and some mutate
  shared server state (bans, the token lifespan the stack is started with).
- **`e2e/`** — a separate npm workspace (own `package.json`, own `npm ci`)
  with a headless STOMP bot harness plus its own Playwright specs:
  `npm run smoke` / `npm run full-match` (scripted matches, no browser),
  `npm run ui` (`e2e/tests/*.spec.ts`: admin-usage, cast-receiver,
  in-game-surfaces, packet-builder, rate-limit), `npm run cast`,
  `npm run audit` (`AUDIT=1`, `USABILITY.md`), `npm run polish`
  (`POLISH=1` scenarios plus responsive/STOMP-recording fixtures),
  `npm run m3:auth-on` / `npm run m3:auth-off` (`tests/packet-builder.spec.ts`
  against those two Playwright projects) and `npm run m4:limits`
  (`tests/rate-limit.spec.ts tests/admin-usage.spec.ts`).

All three need a running stack. From `sockbowl-docker`, with local images
built from each repo's current branch:

```sh
docker compose -p sockbowl-e2e -f docker-compose.yml -f docker-compose.dev.yml \
  -f docker-compose.build.yml --profile full up -d --build
```

Then, from this repo:

```sh
# Guest suite, against that stack instead of the default prod target:
CLIPS_BASE_URL=http://localhost npm run e2e

# Authenticated suite (demo logins, password DEMO_PASSWORD, default demo123):
SOCKBOWL_APP=http://localhost npm run e2e:auth
```

`auth-refresh-logout.spec.ts` needs a short access-token lifespan to reach a
refresh in a reasonable time. **Set `KC_ACCESS_TOKEN_LIFESPAN=60` on the
docker compose environment that starts Keycloak** (`rbac-init`'s and
`sockbowl-game`/`sockbowl-questions`), not only as a Playwright-side env var
here — a stack still running at the default 300s lifespan will make the spec
wait 75s for a refresh that Keycloak never actually issues, since nothing
requires one yet at that point. Pass the same value to Playwright too
(`KC_ACCESS_TOKEN_LIFESPAN=60 SOCKBOWL_APP=http://localhost npm run e2e:auth`),
since the spec also uses it to size its wait and to sanity-check the token's
own `exp - iat`.

Before pointing any suite at a stack built from a local branch, run
`npm run buildprod` first (the compose image copies the prebuilt `dist/`; a
stale or missing build serves stale or missing app code, not a build error).

**Question bank for the "Generate" tab.** The packet-search "Generate" tab
(bank-random, D15) draws from local `:BankTossup`/`:BankBonus` nodes, which
M2's compose seed data does not populate (M3 adds a bank seed); only whole
packets (`:Packet` with `CONTAINS_TOSSUP`/`CONTAINS_BONUS`, used by "Search
Existing") are seeded. Against an unseeded stack the tab reports 0 matches.

- `tests-auth/auth-generate.spec.ts` plays that path with auth on: a guest and
  `player2` (player tier, so both get an EPHEMERAL packet) each generate a
  packet, the other joins, and the match starts. It seeds a small tagged bank
  fixture itself through Neo4j's HTTP API when `SOCKBOWL_E2E_NEO4J_PASSWORD`
  (or `NEO4J_PASSWORD`) is set; `SOCKBOWL_E2E_NEO4J_URL` defaults to
  `http://localhost:7474`. Otherwise seed the bank before running it.
- The other `tests-auth/` specs use Search Existing. `auth-login-play.spec.ts`
  plays the smallest seeded packet (13 tossups,
  `SOCKBOWL_E2E_PACKET_NAME`, default `2010 Collaborative MS Tournament - Round
  05`) to the match summary, answering the first tossup correctly; it reads
  that answer over GraphQL as the admin demo account (`E2E_ADMIN`, default
  `player1`).
- The guest `tests/*.spec.ts` suite's Generate specs (`generate.spec.ts`,
  `generateFilters.spec.ts`, `match.spec.ts`, `proctored.spec.ts`,
  `spectator.spec.ts`, `solo.spec.ts`, `bonus.spec.ts`) need a seeded bank too
  when pointed at a local stack. `bonus.spec.ts` looks up its answers over
  GraphQL at `SOCKBOWL_QUESTIONS_GRAPHQL_URL`, or at
  `SOCKBOWL_QUESTIONS_BASE_URL` + `/graphql` (default
  `https://questions.sockbowl.com`); point it at the local stack, e.g.
  `SOCKBOWL_QUESTIONS_BASE_URL=http://localhost:7009`. With auth on, a guest's
  generated packet is EPHEMERAL and that lookup returns null, so run
  `bonus.spec.ts` against an auth-off stack.

`e2e/`'s bot harness (`npm run full-match`) plays a seeded PUBLISHED packet:
`findSeededPacket` (`e2e/harness/rest.ts`) looks it up by name over GraphQL
(`searchPacketsByName`, then `getPacketById` for the tossup and bonus
counts), using `SOCKBOWL_E2E_PACKET_NAME` (same default as above). It does not
use `import-random`, so it needs no bank seed. SetMatchPacket on a PUBLISHED
packet is allowed for a guest proctor in both auth modes, so `full-match`
runs against auth-on and auth-off stacks with no login support in the
harness. Point it at the stack with `SOCKBOWL_API`, `SOCKBOWL_WS` and
`SOCKBOWL_QUESTIONS` (e.g. `http://localhost:7000`,
`ws://localhost:7000/sockbowl-game`, `http://localhost:7009`).

Traces, screenshots and videos for `tests-auth/` land under
`artifacts/m2-auth/` (see `playwright.auth.config.ts`'s `outputDir`).

Demo accounts and their RBAC tier (`keycloak/rbac-model.json` in
sockbowl-docker): `player2`/`player3` → player, `testuser` → author,
`moderator` → moderator, `player1` → admin.

## Product and design docs

`PRODUCT.md` and `DESIGN.md` (with their `.impeccable/*.json` schema
counterparts) record the product's user-facing facts and the design system's
tokens and components — read them before writing UX copy, changing a user
flow, or touching color/typography/spacing. They're generated/maintained
through the `impeccable` skill; sections marked **(inferred)** are unconfirmed
and can be corrected freely, and both files are meant to track the shipped
code, not the other way around.

## License

MIT License. See `LICENSE` for details.

---

*Created by Jacob Sabella*
