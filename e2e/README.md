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
| `harness/rest.ts` | `createGame` / `joinByCode` / `importQbreaderPacket` |
| `harness/bot.ts` | `SockbowlBot` — headless STOMP client + every player/proctor action |
| `harness/orchestrator.ts` | `stageMatch()` + `driveFullMatch()` |
| `scripts/smoke.ts` | Connect one bot, read live state |
| `scripts/full-match.ts` | Stage + drive a full match, assert it completes |
| `tests/in-game-surfaces.spec.ts` | Playwright: screenshot buzzer + spectator |

## Run

```sh
cd e2e && npm install
npx playwright install chromium     # once

npm run smoke        # protocol check (create → join → read state)
npm run full-match   # headless full match: proctor + 4 players, 3 rounds
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
