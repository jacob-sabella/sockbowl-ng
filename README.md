# SockbowlNg

SockbowlNg is the frontend client for the Sockbowl platform, built with Angular. It provides a modern, responsive interface for players to join and play quizbowl games in real-time, integrating tightly with backend services via WebSockets and REST APIs.

## Features

- **Real-Time Game Play:** Connects to Sockbowl Game backend via WebSockets for live game state updates.
- **Team & Player Management:** View and manage teams and player rosters.
- **Match Progression:** Visualizes rounds, scores, and answer outcomes.
- **Question Integration:** Retrieves quiz packets from Sockbowl Questions API.
- **Responsive UI:** Built with Angular, SCSS, and Material Design.

## Development

- Angular CLI: `ng serve` for local development.
- Build: `ng build` (output in `dist/`).
- Unit tests: `ng test`
- E2E tests: `ng e2e`
- See [Angular CLI Docs](https://angular.io/cli) for more commands.

## End-to-end tests

Two separate Playwright suites, each with its own config and testDir:

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

Both suites need a running stack. From `sockbowl-docker`, with local images
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

Before pointing either suite at a stack built from a local branch, run
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

## Deployment

A sample Dockerfile is included for production deployment with Nginx. See `Dockerfile` for details on serving the built frontend.

## Environment

- API URLs and WebSocket endpoints configurable via `src/environments/environment.ts`

## License

MIT License. See `LICENSE` for details.

---

*Created by Jacob Sabella*
