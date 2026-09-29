# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SockbowlNg is the Angular frontend for the Sockbowl quiz bowl platform: Angular
22.2, Angular Material 22.2, TypeScript ~6.0.3, RxJS. It runs real-time quiz
bowl matches (buzzers, proctoring, scoring) over STOMP-over-WebSocket against
`sockbowl-game`, and gets question packets from `sockbowl-questions` over
GraphQL. It talks to Keycloak (OIDC, `angular-oauth2-oidc`) when
`AUTH_ENABLED` is on, and everything is permission-open when it's off. It's a
PWA (`manifest.webmanifest`, `ngsw-config.json`) with a second, non-Angular
web surface, `src/cast-receiver.html`, for a TV/projector board via the
Presentation API.

`PRODUCT.md` and `DESIGN.md` (plus the impeccable-schema `.impeccable/`
files, `product.json`/`design.json`) hold the product and design-system
facts an `impeccable`-skill pass reads and writes; see "Product and design
docs" below before editing UI copy, tokens or components.

## Development Commands

### Running the app
- `npm start` / `ng serve` — dev server (`ng serve` is aliased to `start`, not a separate npm script)
- `npm run watch` — build with watch mode (development config)

### Building
- `npm run build` — development build (`dist/`)
- `npm run buildprod` — production build. **Run this before building the
  Docker image or pointing e2e at a locally-built stack** — the Dockerfile
  copies a pre-built `dist/`, it does not run the Angular build itself.

### Linting and headers
- `npm run lint` — `ng lint` (ESLint via `@angular-eslint`)
- `npm run test:headers` — `bash scripts/test-headers.sh`: builds the Docker
  image and asserts the rendered `security-headers.conf` (CSP and friends)
  matches what `docker-entrypoint.sh` should generate from `.env`-style
  inputs. This is the only test that touches the Docker image; it needs
  Docker.

### Unit tests
- `npm test` / `ng test` — Karma + Jasmine. CI uses the `ChromeHeadlessCI`
  launcher defined in `karma.conf.js` (`--no-sandbox --disable-gpu`); locally
  a normal `Chrome` launch is fine.

### Codegen
- `npm run codegen` — `bash scripts/gen-packet-types.sh`, regenerates
  `src/app/game/models/sockbowl/sockbowl-interfaces.ts` from the backend Java
  types (quicktype). Header comment in that file names the source; never
  hand-edit it.
- `npm run gen:cast-tokens` — regenerates `src/cast-theme-tokens.css` from
  `src/cast-theme-tokens.scss`, so the non-Angular cast receiver gets the
  same theme tokens as the app. Re-run after changing any
  `src/styles/themes/_*.scss` file.

### End-to-end tests (three separate suites/harnesses — see README for env vars and default targets)
- `npm run e2e` — Playwright, `tests/`: the guest ("clips") suite, targets a
  public/default host unless overridden.
- `npm run e2e:auth` — Playwright, `tests-auth/`, config
  `playwright.auth.config.ts`: the M2 authenticated suite (real Keycloak
  login), workers pinned to 1.
- `e2e/` is a **separate npm workspace** (its own `package.json`,
  `node_modules`) with its own Playwright config and a headless bot harness:
  - `npm run ui` (`--project=default`) — the `e2e/tests/` Playwright specs
    (`admin-usage`, `cast-receiver`, `in-game-surfaces`, `packet-builder`,
    `rate-limit`).
  - `npm run smoke` / `npm run full-match` — `tsx scripts/{smoke,full-match}.ts`,
    a scripted STOMP bot that plays a match end-to-end without a browser.
  - `npm run cast` — `playwright test cast-receiver`.
  - `npm run audit` — `AUDIT=1 playwright test usability` (`usability.spec.ts`, `USABILITY.md`).
  - `npm run polish` — `playwright test polish` (the `polish/` directory:
    responsive captures, STOMP recording fixtures — set `POLISH=1` per the
    scripts under `polish/` when a spec gates on it).
  - `npm run m3:auth-on` / `npm run m3:auth-off` — `tests/packet-builder.spec.ts`
    against the `m3-auth-on`/`m3-auth-off` Playwright projects.
  - `npm run m4:limits` — `tests/rate-limit.spec.ts tests/admin-usage.spec.ts`.
  - `npm run record-stomp` — `tsx polish/record-stomp.ts`, regenerates the
    STOMP mock fixtures `polish/mock` reads.

Run `npm ci` (or `npm install`) separately inside `e2e/` — it is not part of
the root `npm ci`.

## Architecture

### Module map (`src/app/`)
- **`core/`** — cross-cutting singletons, no UI:
  - **`auth/`** — `AuthService` (wraps `angular-oauth2-oidc`; no-op/always-true
    when `AUTH_ENABLED` is false), `auth.config.ts` (the OIDC client config,
    built from `environment.keycloak`), `auth.interceptor.ts` (attaches a
    fresh bearer token to outgoing REST calls), `permission.guard.ts`
    (`permissionGuard(permission)` and `authenticatedGuard`, both **deny by
    default**: with auth on and no session, guards redirect to Keycloak
    login rather than letting the route through).
  - **`graphql/`** — `GraphqlClientService` (typed POST to the Questions
    GraphQL endpoint) and `graphql-errors.ts` (classifies GraphQL error
    `extensions.classification`, e.g. `BANNED`, `RATE_LIMITED`, alongside the
    REST classifications in `http/limit-errors.ts`).
  - **`http/`** — the M4 rate-limit/quota layer: `limit-errors.ts` (the
    `LimitError` union: `RateLimitError`, `QuotaError`,
    `LimiterUnavailableError`, `BannedError`, parsed from a REST JSON body's
    `error` field or a GraphQL error's `extensions.classification`),
    `limit-messages.ts` (user-facing copy for each), `rate-limit.interceptor.ts`
    (turns a 429/503 into a `LimitError` and surfaces it via
    `RateLimitStateService` instead of a raw HTTP failure), `rate-limit-state.service.ts`.
  - **`guards/`** — `unsaved-changes.guard.ts` (`canDeactivate` for
    `/packets/:id/edit`; prompts "Discard N unsaved changes?" via
    `ConfirmDialogService` unless the component reports no dirty state).
  - **`models/`** — `ban-models.ts`, `usage-models.ts` (admin surfaces' DTOs).
  - **`services/`** — `ban.service.ts`, `usage.service.ts`,
    `theme.service.ts` (the 8-theme + `auto` selector, persisted in
    `localStorage['sockbowl-theme-preference']`), `version-check.service.ts`.
- **`game/`** — the match itself: `components/` (`game-session` lobby,
  `game-canvas`, `game-config`, `game-proctor`, `game-buzzer`, `team-list`,
  `match-summary`, `packet-search`), `services/` (the three-layer
  `GameWebSocketService` → `GameMessageService` → `GameStateService` stack —
  see "Key Patterns" below), `models/sockbowl/sockbowl-interfaces.ts`
  (generated, see `npm run codegen`).
- **`packets/`** — packet authoring/browsing: `components/` (`packet-list`,
  `packet-builder`, `packet-import-dialog`), `services/`
  (`packet-authoring.service.ts`), `models/`. Governs DRAFT/PUBLISHED/EPHEMERAL
  packet state and the ACF/NAQT-style plaintext import.
- **`structure/`** — app chrome and admin: `components/navbar`,
  `theme-selector`, `profile`, `not-found`, and the four permission-gated
  `admin-*` surfaces (`admin-home`, `admin-usage` with its `edit-quota-dialog`
  and `ban-user-dialog`/`ip-ban-dialog`, `admin-bans`, `admin-taxonomy`),
  each behind its own realm permission in `permission.guard.ts` (`admin:access`,
  `user:ban`, `taxonomy:manage`).
- **`shared/`** — reusable, presentation-only pieces: `confirm-dialog`,
  `ai-key` (the bring-your-own-OpenAI-key UI for packet generation),
  `packet-reading-view`, `test-clips` (the guest-facing clips gallery
  fixtures), and `state/` (see next section).

### `shared/state`: the M5 F1 state primitives
Three standalone, `OnPush` components factor out the "nothing here yet" /
"loading" / "this failed" surfaces that several M3–M4 features had each
rebuilt locally:
- **`EmptyStateComponent`** (`app-empty-state`) — icon + title + optional
  message + a single optional action button (`actionLabel`, `(action)`).
- **`LoadingStateComponent`** (`app-loading-state`) — a titled
  `mat-spinner` (`role="status" aria-live="polite"`), used instead of a bare
  spinner while a surface waits on its first REST/GraphQL response.
- **`ErrorStateComponent`** (`app-error-state`) — icon + title + message +
  one action (default label "Retry", `(retry)`), `role="alert"`, icon color
  `var(--error)`. Used for "this failed to load" with a single primary
  action (retry, or sign-in on a 401).

All three take their spacing, type and color from the shared token set
(`--spacing-*`, `--text-*`, `--font-medium`, `--text-primary/secondary/muted`)
— never a literal value — so they render correctly in all 8 themes with no
component-local overrides. `packet-search`, `game-session`, `game-canvas` and
`match-summary` already consume them; older surfaces that hardened an
equivalent local version before this landed (`packets-local`,
`admin-bans`/`admin-usage`, `profile`) have a standing handoff to swap over
(`audit/m5/{s4,s5,s6}/backlog.json`, H-01/H-02) — check there before adding
another local empty/loading/error block instead of these.

### Product and design docs
- **`PRODUCT.md`** / **`.impeccable/product.json`** — the product-schema
  facts (users, product principles, accessibility target, brand
  commitments). Read before writing UX copy or changing a flow's behavior;
  edit through the `impeccable` skill's product flow, not by hand, so the
  schema and prose stay in sync.
- **`DESIGN.md`** / **`.impeccable/design.json`** — the design-system record
  (colors per theme, typography, spacing, shadows, the named components
  including the `shared/state` primitives above). Component CSS snippets in
  `design.json` are illustrative references, not the literal shipped SCSS;
  when they disagree, the SCSS under `src/styles/` and `src/app/**/*.scss`
  is the source of truth and `design.json`/`DESIGN.md` should be corrected to
  match, not the other way around.
- Both files carry a provenance comment/field: sections marked **(inferred)**
  were not confirmed by the owner and can be edited or corrected without
  ceremony; unmarked facts are meant to be traceable to code or the ledger
  (`PROGRESS.md`, `plans/*.md`) and should stay that way going forward, even
  though `PROGRESS.md`/`plans/*.md` themselves live outside this repo (a
  clean clone won't have them — don't add new comments citing them from
  source files; see `security-headers.conf.template`'s header for the
  in-repo alternative).

### Runtime configuration
The production image has **no build-time API URLs**: `docker-entrypoint.sh`
`envsubst`s `src/assets/config.template.js` into `assets/config.js` at
container start, and the app reads it as `window.__env` (see
`src/environments/environment.ts`, which falls back to `localhost` dev
defaults when `window.__env` is absent, e.g. under `ng serve`). Keys:

| Key | Default | Used for |
|---|---|---|
| `APP_HOST` | `localhost` | Host for the game/questions/Keycloak origins below |
| `APP_PROTOCOL` | `http` | `http`/`https` for the same origins |
| `WS_PROTOCOL` | `ws` | `ws`/`wss` for the game WebSocket origin |
| `SOCKBOWL_GAME_PORT` | `7000` | Game REST + WebSocket port |
| `SOCKBOWL_QUESTIONS_PORT` | `7009` | Questions GraphQL port |
| `KEYCLOAK_PORT` | `8080` | Keycloak issuer/login port |
| `AUTH_ENABLED` | `false` | Gates every `permissionGuard`/`authenticatedGuard` check |
| `CSP_EXTRA_CONNECT_SRC` | `https://api.openai.com` | Extra CSP `connect-src` origin (the bring-your-own-key AI path in `shared/ai-key`); entrypoint-only, not part of `config.template.js` |

`docker-entrypoint.sh` also derives the `Content-Security-Policy` value from
the same host/port variables and renders it into
`security-headers.conf.template` (see that file's header for what it may
not reference).

## Key Patterns

### WebSocket message flow (game state)
Three layers, low-level to high-level:
1. **`GameWebSocketService`** — STOMP.js over WebSocket to
   `environment.wsUrl`. Authenticates in the CONNECT frame only
   (`playerSecret` for a guest seat, or a fresh bearer token from
   `AuthService.getFreshAccessToken()` for a signed-in seat), re-sends
   `Authorization` on `AuthService.tokenChanges$`. Subscribes to
   `/queue/event/{gameSessionId}/{playerSessionId}`,
   `/queue/event/{gameSessionId}` and `/user/queue/errors`; fatal ERROR-frame
   codes stop reconnecting.
2. **`GameMessageService`** — routes raw messages to typed observables keyed
   by message type (`GameSessionUpdate`, `PlayerRosterUpdate`, …), wraps
   `sendMessage()`.
3. **`GameStateService`** — holds `GameSession` in a `BehaviorSubject`,
   exposes `gameSession$` plus query methods (`isSelfProctor()`,
   `isCurrentPlayerGameOwner()`) and action methods that build and send
   typed messages.
Components: inject `GameStateService`, subscribe to `gameSession$`, use its
query methods rather than reading raw state, and call its action methods
rather than constructing messages directly.

### Never put answers in broadcast payloads
The server sanitizes `GameSessionUpdate` so a non-proctor's view has no
tossup/bonus answer text before it's revealed (see the comment on
`GameStateService`'s resend-state request). Nothing on this side should
cache or re-display an answer from a payload meant for the proctor's role —
treat a "why does this field look empty for a player" as sanitization
working as intended, not a bug, before changing it.

### Routing and guards (deny by default)
Routes (`app-routing.module.ts`): `/game-session` (default), `/game`,
`/profile` (`authenticatedGuard`), `/admin*` (each gated by its own
permission), `/packets` and `/packets/:id/edit` (`packet:create` /
`packet:update`, the latter also behind `unsavedChangesGuard`), and a `**`
wildcard to `NotFoundComponent`. Every guarded route fails closed: with auth
on, an unauthenticated visitor is sent to Keycloak login (return URL
preserved), and an authenticated one lacking the permission is redirected to
`/game-session` with a denial snackbar — never silently let through. With
auth off, every `permissionGuard` check passes.

`/game`'s route params carry only `gameSessionId`/`playerSessionId`; the
lobby stores the seat's credentials in
`sessionStorage['sockbowl.join.<gameSessionId>']` (`game-join-storage.ts`). A
legacy `playerSecret` query param is migrated there and scrubbed from the
URL. **Never put an access token in a route or query param.**

### Sanitization
User-authored HTML (the navbar's GitHub/Discord icon markup today) goes
through Angular's `DomSanitizer`, explicitly, at the one or two call sites
that need `bypassSecurityTrustHtml` — don't add a new
`bypassSecurityTrustHtml` call for content that could ever include
user-authored text (packet content, chat, display names); render that as
plain text/interpolation instead.

## Material Design

Material 22.2, themed by `src/styles/material-theme.scss` (wired in M5
F1-01; the old prebuilt `indigo-pink` stylesheet is gone) so Material
components follow the same `body.theme-<name>` custom-property contract as
the rest of the app across all 8 themes. `mat-typography` was dropped from
`<body>` in the same pass (F1-02) — body text renders Inter at 16px/1.5 and
headings render Space Grotesk, per `DESIGN.md`'s Typography section; don't
re-add a global `mat-typography` class. See `DESIGN.md` for the full token
list, including the on-color (`--on-accent-primary`, `--on-success`,
`--on-warning`, `--on-error`, `--on-info`) and text-safe accent/status
(`--accent-primary-text`, `--error-text`, …) tokens components must use
instead of a literal white/black or a fill color used as text (F1-03/F1-05).
