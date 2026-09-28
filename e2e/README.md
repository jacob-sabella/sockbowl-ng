# Sockbowl match-emulation harness

A full quizbowl match needs a proctor **plus** several players split across
teams, buzzing, judging, and bonuses — impossible to stage by hand in a single
browser tab. This harness emulates any match configuration end-to-end so the
in-game surfaces (buzzer, proctor reader, spectator, scoreboard) can actually be
driven, verified, and screenshotted.

Two layers:

1. **Headless bots** — `SockbowlBot` speaks the same STOMP protocol the Angular
   app does. Bots fill player/team seats and an orchestrator drives whole
   matches (reads → buzzes → judging → bonuses → completion) with no browser.
2. **Playwright capture** — real browsers join a bot-staged match via the app's
   `/game;gameSessionId=…;playerSecret=…;playerSessionId=…` deep-link, are
   driven to genuine round states, and screenshot the redesigned UI. The app
   moves the secret into sessionStorage and scrubs it from the address bar.

**STOMP auth (M2).** Credentials travel only in the CONNECT frame: a guest bot
sends `gameSessionId`, `playerSessionId` and `playerSecret`; a bot built with an
`accessToken` (a seat joined via `join-game-session-authenticated`) sends
`Authorization: Bearer <jwt>` instead. SEND frames carry only the two ids. The
server answers a bad CONNECT with an ERROR frame whose JSON body is
`{"code":"INVALID_CREDENTIALS",…}`; `connect()` rejects with a
`StompConnectError` carrying that code, and `bot.errors` records every ERROR
frame and `/user/queue/errors` item. `npm run smoke` also checks that a wrong
secret is refused (`SOCKBOWL_SMOKE_SKIP_AUTH_PROBE=1` skips that against a
pre-M2 server).

## Layout

| Path | Purpose |
|------|---------|
| `harness/config.ts` | Target endpoints (env-overridable; default = live prod) |
| `harness/rest.ts` | `createGame` / `joinByCode` / `joinByCodeAuthenticated` / `importQbreaderPacket` / `findSeededPacket` |
| `harness/bot.ts` | `SockbowlBot` — headless STOMP client + every player/proctor action |
| `harness/orchestrator.ts` | `stageMatch()` + `driveFullMatch()` |
| `harness/questions.ts` | `deletePacket(id, token?)` — a GraphQL cleanup helper against sockbowl-questions (M3) |
| `scripts/smoke.ts` | Connect one bot, read live state |
| `scripts/full-match.ts` | Look up a seeded PUBLISHED packet, stage + drive a full match, assert every one of its rounds completes |
| `tests/in-game-surfaces.spec.ts` | Playwright: screenshot buzzer + spectator |
| `tests/packet-builder.spec.ts` | Playwright (M3 WP-E1): build a packet in the real builder UI, play it, import/export round trip, draft privacy |
| `fixtures/m3-import-sample.txt` | ACF/NAQT-style plaintext fixture for the import/export spec (3 tossups, 2 bonuses, known answers) |

## Run

```sh
cd e2e && npm install
npx playwright install chromium     # once

npm run smoke        # protocol check (create → join → read state)
npm run full-match   # headless full match: proctor + 4 players, every round of a seeded packet
npm run ui           # Playwright UI capture → artifacts/*.png
```

Point it at a local docker-compose stack instead of live prod:

```sh
SOCKBOWL_API=http://localhost:7000 \
SOCKBOWL_WS=ws://localhost:7000/sockbowl-game \
SOCKBOWL_QUESTIONS=http://localhost:7009 \
SOCKBOWL_APP=http://localhost \
npm run ui
```

## M3: the packet builder e2e (`tests/packet-builder.spec.ts`)

WP-E1's "build a packet → play it" spec is a real-browser Playwright test (not
a headless bot script): it drives the actual packet builder UI at `/packets`,
plays the packet it built through single-player, and cleans up after itself
through `harness/questions.ts`'s `deletePacket`. It shares this repo because it
still needs the bot harness for two things a browser alone can't prove:

- **the bonus proof.** `SINGLE_PLAYER` forces `bonusesEnabled=false` at
  session-creation time regardless of the packet's own content (see
  `FullGameSinglePlayerTest`'s `BonusesForcedOff` tests in sockbowl-game) — so
  the single-player leg of the spec proves only the 3 tossups. The bonus
  content is instead proven by staging a bot-driven `QUIZ_BOWL_CLASSIC` match
  against the same packet id (`stageMatch({ packetId })` + `driveFullMatch`),
  which does reach a scored bonus round.
- **draft privacy.** confirming a non-owner's direct `SetMatchPacket` for a
  DRAFT packet id is refused with `ProcessError` code `PACKET_NOT_AVAILABLE`
  needs an authenticated (non-guest) bot seat — `joinByCodeAuthenticated` plus
  a `SockbowlBot` built with that seat's access token — since the ownership
  check depends on a real Keycloak identity on the seat (M2's C6), not a guest.

**Two auth postures, two stack bring-ups.** `AUTH_ENABLED` is a stack-wide
setting (`sockbowl-docker`'s dev/e2e overlay), so one compose stack can only
ever be auth-off or auth-on — the two Playwright projects below each need their
own bring-up of a throwaway `-p sockbowl-m3e2e` stack, torn down (`down -v`)
between them:

```sh
# Build local images from this branch and bring up an auth-off stack, then:
cd e2e && npm run m3:auth-off

# Tear down, bring up an auth-on stack (AUTH_ENABLED=true, demo users on), then:
npm run m3:auth-on
```

`m3-auth-on` logs in as the demo author account (`testuser`, password
`DEMO_PASSWORD` or `demo123`) via `tests-auth/helpers/login.ts`'s `loginAs` —
the same helper M2's `tests-auth/` suite uses, imported here with a
type-only `Page` import so this package's own `@playwright/test` install is
the only one that actually loads at runtime (see that file's header comment).
The "draft privacy in game" spec additionally logs a second browser context in
as `player2` (a plain player, not the author).

Point `SOCKBOWL_API` / `SOCKBOWL_WS` / `SOCKBOWL_QUESTIONS` / `SOCKBOWL_APP` at
the compose stack as above (see `harness/config.ts` for the exact local
values); `npm run ui` (no args) only ever runs the `default` project — the
pre-existing specs in this file's own list — and never picks up
`packet-builder.spec.ts`, which only the two `m3:*` scripts (or
`playwright test --project=m3-auth-off|m3-auth-on tests/packet-builder.spec.ts`
directly) run.
