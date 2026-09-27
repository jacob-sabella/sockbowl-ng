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
refresh in a reasonable time; start the stack with
`KC_ACCESS_TOKEN_LIFESPAN=60` (and pass the same value to Playwright as the
env var of the same name if you change it) to exercise that spec.

**Known gap (M3 follow-up):** the packet-search "Generate" tab (bank-random,
D15) reads local `:BankTossup`/`:BankBonus` nodes that this compose stack's
seed data doesn't populate — only whole existing packets (`:Packet`
`CONTAINS_TOSSUP`/`CONTAINS_BONUS`, used by "Search Existing") are seeded.
Against a fresh local stack that tab always reports 0 matches, regardless of
filters. `auth-login-play.spec.ts`, `auth-refresh-logout.spec.ts` and
`security-headers.spec.ts` use Search Existing instead (the smallest seeded
packet, 13 tossups, for the one spec — `auth-login-play.spec.ts` — that plays
a multiplayer match through to the match summary). The pre-existing guest
`tests/*.spec.ts` suite has several specs (`generate.spec.ts`,
`generateFilters.spec.ts`, `match.spec.ts`, `proctored.spec.ts`,
`spectator.spec.ts`, `solo.spec.ts`, `bonus.spec.ts`) that still use that tab
and so still hit this gap when pointed at a local stack instead of the live
site they default to; they aren't rewritten here (`bonus.spec.ts` also has an
independent, hardcoded dependency on the production GraphQL endpoint for its
answer lookup). Likewise, `e2e/`'s bot harness (`npm run full-match`) imports
its packet via `POST /api/qbreader/import`, a different endpoint from the
"Generate" tab's `import-random` — under M2 that endpoint isn't in the
security config's public allow-list and now requires authentication, which
the harness (guest-only bots; login support is deferred to M3 E1/M4 E1 per
`tests-auth/helpers/login.ts`'s contract note) can't yet provide, so it fails
with 401 against an `AUTH_ENABLED=true` stack until that support lands.

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
