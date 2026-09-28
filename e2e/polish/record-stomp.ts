/**
 * M5 H0: records real STOMP fixtures from a live `goal/m5-polish` base
 * stack, for `mock/stomp-replay.ts` to replay in S1/S2/S3's mocked
 * captures. **Not run by this WP** (H0 PENDING-LOCK): recording needs the
 * fullstack lock, and two live e2e runs (M4 E1, M3 E2) were already queued
 * on it when H0 ran. This file is the recorder plus, below, the exact
 * commands to run it once the lock is free. Do not run this against
 * anything but a disposable `sbm5-*` compose project.
 *
 * -------------------------------------------------------------------------
 * HOW TO RUN (M5 plan §4 H0 / §6 "Live" / §5 lock protocol) — not executed
 * by H0 itself:
 *
 *   1. Take the lock (mkdir, don't seize):
 *        LOCK=<scratchpad>/fullstack.lock
 *        mkdir "$LOCK" && cat > "$LOCK/owner.txt" <<EOF
 *        wp=H0-record-stomp
 *        agent=<agent id>
 *        time=$(date -u +%FT%TZ)
 *        project=sbm5-polish
 *        EOF
 *      (If mkdir fails, the lock is held — wait with the existing
 *      wait-lock pattern; never seize it.)
 *
 *   2. Rebuild every image from the `goal/m5-polish` heads (M2 round-2 rule)
 *      and bring the stack up:
 *        docker compose -p sbm5-polish -f docker-compose.yml \
 *          -f docker-compose.dev.yml -f docker-compose.build.yml \
 *          -f <scratchpad>/m5-polish.override.yml --profile full up -d --build
 *
 *   3. From the ng worktree's `e2e/`:
 *        SOCKBOWL_API=http://localhost:7000 \
 *        SOCKBOWL_WS=ws://localhost:7000/sockbowl-game \
 *        SOCKBOWL_QUESTIONS=http://localhost:7009 \
 *        npx tsx polish/record-stomp.ts
 *      Fixtures land in `polish/fixtures/stomp/<game-mode>/<seat>.json`.
 *
 *   4. Tear down and release, always, even on failure:
 *        docker compose -p sbm5-polish ... down -v
 *        rm -rf "$LOCK"
 *
 *   5. Commit the new fixtures on `goal/m5-polish-h0` (or a small follow-up
 *      WP branch if H0 has already merged), and update this file's own
 *      "recorded" note below with the date and `ngHead`/stack commit.
 * -------------------------------------------------------------------------
 *
 * Recording strategy: `harness/orchestrator.ts`'s `stageMatch`/
 * `driveFullMatch` (bots) actually play the match; a separate, *passive*
 * {@link RawRecorder} STOMP connection per seat — using that seat's real
 * credentials, so it sees exactly what the ng app would — subscribes to the
 * same queues and logs every MESSAGE/ERROR frame verbatim, with the delay
 * since the previous frame, in `mock/stomp-replay.ts`'s `ReplayFrame[]`
 * shape. Recording is a *spectator* on the bot-driven match, not a
 * participant, so what it captures is exactly the wire traffic
 * `game-web-socket.service.ts` would receive.
 */
import { Client, type IMessage } from '@stomp/stompjs';
import WebSocket from 'ws';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WS_URL } from '../harness/config.js';
import { stageMatch, driveFullMatch } from '../harness/orchestrator.js';
import type { ReplayFrame } from './mock/stomp-replay.js';

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'stomp');

/** Passively records every frame a seat's socket receives, verbatim, for later replay. */
class RawRecorder {
  readonly frames: ReplayFrame[] = [];
  private client!: Client;
  private lastTs = Date.now();
  private connected: Promise<void>;

  constructor(private gameSessionId: string, private playerSessionId: string, credentials: { playerSecret?: string; accessToken?: string }) {
    const selfDest = `/queue/event/${gameSessionId}/${playerSessionId}`;
    const broadcastDest = `/queue/event/${gameSessionId}`;
    const headers: Record<string, string> = { gameSessionId, playerSessionId };
    if (credentials.accessToken) headers['Authorization'] = `Bearer ${credentials.accessToken}`;
    else headers['playerSecret'] = credentials.playerSecret ?? '';

    this.connected = new Promise((resolve, reject) => {
      this.client = new Client({
        webSocketFactory: () => new WebSocket(WS_URL) as any,
        connectHeaders: headers,
        reconnectDelay: 0,
        heartbeatIncoming: 0,
        heartbeatOutgoing: 0,
        onConnect: () => {
          const record = (target: 'self' | 'broadcast', kind: 'message' | 'error') => (m: IMessage) => {
            let body: Record<string, unknown>;
            try { body = JSON.parse(m.body); } catch { return; }
            const now = Date.now();
            this.frames.push({ target, kind, body, delayMs: now - this.lastTs });
            this.lastTs = now;
          };
          this.client.subscribe(selfDest, record('self', 'message'));
          this.client.subscribe(broadcastDest, record('broadcast', 'message'));
          this.client.subscribe('/user/queue/errors', record('self', 'error'));
          resolve();
        },
        onStompError: (frame) => {
          let body: Record<string, unknown>;
          try { body = JSON.parse(frame.body); } catch { body = { message: frame.body }; }
          this.frames.push({ target: 'self', kind: 'error', body, delayMs: Date.now() - this.lastTs });
        },
        onWebSocketError: reject,
      });
      this.client.activate();
    });
  }

  ready(): Promise<void> { return this.connected; }
  stop(): void { try { this.client?.deactivate(); } catch { /* ignore */ } }
}

function writeFixture(gameMode: string, seat: string, frames: ReplayFrame[]): void {
  const dir = join(FIXTURES_ROOT, gameMode.toLowerCase().replace(/_/g, '-'));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${seat}.json`);
  writeFileSync(path, JSON.stringify(frames, null, 2) + '\n');
  console.log(`wrote ${frames.length} frames -> ${path}`);
}

/**
 * QUIZ_BOWL_CLASSIC: proctor + 4 players, full proctor-driven round cycle
 * (PROCTOR_READING -> AWAITING_BUZZ -> AWAITING_ANSWER -> bonus phases ->
 * COMPLETED, repeated). Captures the proctor's and one buzzer's frames.
 * `driveFullMatch`'s default `maxRounds` is raised so every one of the 9
 * `RoundState` values (M5 plan §4 H0 done-when) actually occurs at least
 * once, including a multi-part bonus.
 */
async function recordQuizBowlClassic(): Promise<void> {
  console.log('== QUIZ_BOWL_CLASSIC ==');
  const match = await stageMatch({ tossupCount: 9, bonusCount: 4 });
  const proctorRecorder = new RawRecorder(match.gameSessionId, match.proctor.playerSessionId, { playerSecret: match.proctor.playerSecret });
  const buzzerBot = match.players[0];
  const buzzerRecorder = new RawRecorder(match.gameSessionId, buzzerBot.playerSessionId, { playerSecret: buzzerBot.playerSecret });
  await Promise.all([proctorRecorder.ready(), buzzerRecorder.ready()]);

  const result = await driveFullMatch(match, match.tossupCount, true);
  console.log('roundStatesSeen:', result.roundStatesSeen);

  proctorRecorder.stop();
  buzzerRecorder.stop();
  match.cleanup();

  writeFixture('QUIZ_BOWL_CLASSIC', 'proctor', proctorRecorder.frames);
  writeFixture('QUIZ_BOWL_CLASSIC', 'buzzer', buzzerRecorder.frames);

  const seen = new Set(result.roundStatesSeen);
  const ALL_ROUND_STATES = ['PROCTOR_READING', 'AWAITING_BUZZ', 'AWAITING_ANSWER', 'BONUS_PENDING', 'BONUS_READING_PREAMBLE', 'BONUS_READING_PART', 'BONUS_AWAITING_ANSWER', 'BONUS_COMPLETED', 'COMPLETED'];
  const missing = ALL_ROUND_STATES.filter(s => !seen.has(s));
  if (missing.length) {
    console.warn(`QUIZ_BOWL_CLASSIC pass did not observe: ${missing.join(', ')} — rerun with a larger packet/maxRounds, or note the gap in the ledger.`);
  }
}

/**
 * SINGLE_PLAYER, AUTO_PROCTOR and FREE_FOR_ALL are proctorless (auto-judged)
 * modes that `driveFullMatch` doesn't drive (it's written for a human
 * proctor's action sequence — see its `switch (rs)` in
 * `harness/orchestrator.ts`). Recording these needs a small driver that
 * reacts to the auto-judge's own state machine instead (buzz -> the server
 * judges automatically -> next round), which nothing in this repo has
 * exercised headlessly yet. Sketched, not run:
 *
 *   const game = await createGame(gameMode, 'NO_PROCTOR', true);
 *   const bot = await spawnBot(joinByCode, game.joinCode, 'Solo');
 *   // FREE_FOR_ALL/AUTO_PROCTOR: also assign a team via bot.joinTeam(...).
 *   bot.setPacket(await importQbreaderPacket(9, 4));
 *   bot.startMatch();
 *   // then loop: on AWAITING_BUZZ, bot.buzz(); wait for the round to
 *   // auto-advance (no proctor.judge()/finishedReading() calls — confirm
 *   // against the live server which states actually occur here before
 *   // trusting this loop).
 *
 * Left as a follow-up for whoever next holds the lock, rather than shipped
 * untested. `mock/stomp-replay.ts` and `manifest.ts` don't care which
 * `GameMode` a fixture came from, so this only blocks S1's
 * `single-player-in-game`/`auto-proctor-free-for-all` capture rows, not the
 * harness itself.
 */
async function recordProctorlessModesTodo(): Promise<void> {
  console.warn('SINGLE_PLAYER/AUTO_PROCTOR/FREE_FOR_ALL recording is not implemented yet — see this function\'s doc comment.');
}

async function main(): Promise<void> {
  await recordQuizBowlClassic();
  await recordProctorlessModesTodo();
  console.log('Done. Commit polish/fixtures/stomp/** and update the M5 ledger with the recording date and stack ngHead/commit.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
