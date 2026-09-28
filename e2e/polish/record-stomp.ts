/**
 * M5 H0: records real STOMP fixtures from a live stack, for
 * `mock/stomp-replay.ts` to replay in S1/S2/S3's mocked captures. Recorded
 * 2026-09-28 (M5 H0 follow-up, branch `goal/m5-polish-h0rec`) against
 * project `sbm5-polish`, backend images `sockbowl-game:m5rec` /
 * `sockbowl-questions:m5rec` (M4-int heads: game `5186d25`, questions
 * `fc456d6`, docker `4e8ebb3`, branch `goal/m4-limits` — **not yet
 * M3-merged**; every fixture's own JSON also says so, and INT1 may
 * re-record from the real M3×M4×M5 integration heads later). Do not run
 * this against anything but a disposable `sbm5-*` compose project.
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
import { WS_URL, QUESTIONS_BASE } from '../harness/config.js';
import { stageMatch, driveFullMatch } from '../harness/orchestrator.js';
import { spawnBot } from '../harness/bot.js';
import { joinByCode, createGame } from '../harness/rest.js';
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

/**
 * Backend provenance every recorded fixture's metadata carries (task
 * instruction: "record in each fixture's metadata that the backend is
 * M4-int and not yet M3-merged" — INT1 may re-record once M3×M4×M5 actually
 * integrate). Not present on hand-synthesized fixtures (see
 * `writeSynthesizedFixture`), which say so themselves instead.
 */
const BACKEND_META = {
  source: 'M4-int',
  m3Merged: false,
  note: 'Backend is the M4 integration head (goal/m4-limits), not yet merged with M3 (goal/m3-packets). INT1 may re-record this fixture once the real M3×M4×M5 integration heads exist.',
  images: { game: 'sockbowl-game:m5rec (5186d25)', questions: 'sockbowl-questions:m5rec (fc456d6)', docker: '4e8ebb3 (goal/m4-limits)' },
  recordedAt: new Date().toISOString(),
};

function writeFixture(gameMode: string, seat: string, gameSessionId: string, playerSessionId: string, frames: ReplayFrame[]): void {
  const dir = join(FIXTURES_ROOT, gameMode.toLowerCase().replace(/_/g, '-'));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${seat}.json`);
  const fixture = { _meta: { ...BACKEND_META, gameMode, seat, synthesized: false }, gameSessionId, playerSessionId, frames };
  writeFileSync(path, JSON.stringify(fixture, null, 2) + '\n');
  console.log(`wrote ${frames.length} frames -> ${path}`);
}

/**
 * QUIZ_BOWL_CLASSIC: proctor + 4 players + 1 spectator, full proctor-driven
 * round cycle (PROCTOR_READING -> AWAITING_BUZZ -> AWAITING_ANSWER -> bonus
 * phases -> COMPLETED, repeated). Captures the proctor's, one buzzer's and
 * the spectator's frames (the spectator joins `Team.SPECTATOR_TEAM`
 * ("SPECTATE") via the same `update-player-team` message
 * `game-team-list.component.ts`'s "Spectate" control sends).
 * `driveFullMatch`'s default `maxRounds` is raised so every one of the 9
 * `RoundState` values (M5 plan §4 H0 done-when) actually occurs at least
 * once, including a multi-part bonus.
 *
 * Two of the 9 values, confirmed by reading `GameMessageProcessor`
 * (game repo, `playerAnswer`/`bonusPartAnswer`), are architecturally
 * unreachable here and so can never come from a real recording:
 *   - `BONUS_PENDING` is only ever set by the *auto-proctor* path
 *     (`autoProctorSubmit`); the human-proctor path (`playerAnswer`) calls
 *     `startBonusPhase` directly into `BONUS_READING_PREAMBLE`, no pause.
 *   - `BONUS_COMPLETED` is set by `Round.advanceToNextBonusPart()` but, in
 *     the very same synchronous call, `bonusPartAnswer()` sees it and calls
 *     `completeBonusPhase()` before any message is broadcast — no client,
 *     mocked or real, proctor or auto-proctor, ever observes it on the wire.
 * Both are left for `recordProctorlessModesTodo` (which reaches
 * `BONUS_PENDING` for real) and a hand-authored `BONUS_COMPLETED` frame
 * (there is no live path to it) — see that function and `main()`.
 *
 * `stageMatch`'s default packet source, `importQbreaderPacket` (REST
 * `/api/qbreader/import-random`), 404s against this compose stack: its local
 * Neo4j bank has no `:BankTossup`/`:BankBonus` nodes seeded (see
 * `harness/rest.ts`'s `findSeededPacket` doc comment — a known, reported
 * gap, not something this recording run can fix). `buildPacket` (below)
 * works around it by building an already-PUBLISHED packet directly through
 * the questions GraphQL authoring API instead, and `stageMatch`'s `packetId`
 * option (already there for M3 E1's own real-packet runs) takes it from
 * there. `SOCKBOWL_PACKET_ID` still overrides it, for a rerun against an
 * already-built packet.
 */
async function recordQuizBowlClassic(token: string): Promise<{ roundStatesSeen: string[] }> {
  console.log('== QUIZ_BOWL_CLASSIC ==');
  const tossupCount = 9;
  const bonusCount = 4;
  const packetId = process.env.SOCKBOWL_PACKET_ID ?? await buildPacket(token, 'M5 H0 QUIZ_BOWL_CLASSIC', tossupCount, bonusCount);
  const match = await stageMatch({ packetId, tossupCount, bonusCount });
  const proctorRecorder = new RawRecorder(match.gameSessionId, match.proctor.playerSessionId, { playerSecret: match.proctor.playerSecret });
  const buzzerBot = match.players[0];
  const buzzerRecorder = new RawRecorder(match.gameSessionId, buzzerBot.playerSessionId, { playerSecret: buzzerBot.playerSecret });

  const spectatorBot = await spawnBot(joinByCode, match.joinCode, 'Sam Spectator');
  spectatorBot.joinTeam('SPECTATE');
  const spectatorRecorder = new RawRecorder(match.gameSessionId, spectatorBot.playerSessionId, { playerSecret: spectatorBot.playerSecret });

  await Promise.all([proctorRecorder.ready(), buzzerRecorder.ready(), spectatorRecorder.ready()]);

  const result = await driveFullMatch(match, match.tossupCount, true);
  console.log('roundStatesSeen:', result.roundStatesSeen);

  proctorRecorder.stop();
  buzzerRecorder.stop();
  spectatorRecorder.stop();
  spectatorBot.disconnect();
  match.cleanup();

  writeFixture('QUIZ_BOWL_CLASSIC', 'proctor', match.gameSessionId, match.proctor.playerSessionId, proctorRecorder.frames);
  writeFixture('QUIZ_BOWL_CLASSIC', 'buzzer', match.gameSessionId, buzzerBot.playerSessionId, buzzerRecorder.frames);
  writeFixture('QUIZ_BOWL_CLASSIC', 'spectator', match.gameSessionId, spectatorBot.playerSessionId, spectatorRecorder.frames);

  const seen = new Set(result.roundStatesSeen);
  const ALL_ROUND_STATES = ['PROCTOR_READING', 'AWAITING_BUZZ', 'AWAITING_ANSWER', 'BONUS_PENDING', 'BONUS_READING_PREAMBLE', 'BONUS_READING_PART', 'BONUS_AWAITING_ANSWER', 'BONUS_COMPLETED', 'COMPLETED'];
  const UNREACHABLE_HERE = new Set(['BONUS_PENDING', 'BONUS_COMPLETED']); // see this function's doc comment
  const missing = ALL_ROUND_STATES.filter(s => !seen.has(s) && !UNREACHABLE_HERE.has(s));
  if (missing.length) {
    console.warn(`QUIZ_BOWL_CLASSIC pass did not observe: ${missing.join(', ')} — rerun with a larger packet/maxRounds, or note the gap in the ledger.`);
  }
  return { roundStatesSeen: result.roundStatesSeen };
}

/**
 * Gets a bearer token with `packet:create` for the questions GraphQL
 * authoring API, via the `sockbowl-e2e` password-grant client the dev/e2e
 * compose overlay creates (`docker-compose.dev.yml`, D9) — DEV/E2E ONLY,
 * same client `tests-auth/helpers/login.ts` and `scripts/smoke-auth.sh` use.
 * `SEED_USERNAME` defaults to the `author`-tier demo user seeded by
 * `CREATE_DEMO_ACCOUNTS=true` (`keycloak/rbac-model.json`).
 */
async function getAuthorToken(): Promise<string> {
  const keycloak = process.env.SOCKBOWL_KEYCLOAK ?? 'http://localhost:8080';
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: process.env.SEED_CLIENT_ID ?? 'sockbowl-e2e',
    username: process.env.SEED_USERNAME ?? 'testuser',
    password: process.env.SEED_PASSWORD ?? 'demo123',
    scope: 'openid',
  });
  const res = await fetch(`${keycloak}/realms/sockbowl/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`getAuthorToken ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

async function gql<T = any>(token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${QUESTIONS_BASE}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const body: any = await res.json();
  if (!res.ok || body.errors?.length) throw new Error(`gql ${res.status}: ${JSON.stringify(body.errors ?? body)}`);
  return body.data as T;
}

/**
 * Builds and PUBLISHes a small packet directly through the questions
 * GraphQL authoring API — the same `createPacket`/`addTossupToPacket`/
 * `addBonusToPacket` mutations the ng packet builder itself calls — with
 * deterministic, known question/answer text so this script can "solve" its
 * own tossups and bonuses without reading (or needing) the server's
 * redacted answer fields. Works around `importQbreaderPacket` 404ing (see
 * `recordQuizBowlClassic`'s doc comment): this compose stack's local Neo4j
 * bank has no seeded `:BankTossup`/`:BankBonus` nodes. Tossups and bonuses
 * share the same `order` (0-based), which is how the game backend pairs a
 * tossup with its bonus (`QbreaderImportService.createFromBank`); a bonus's
 * 3 parts also mirror `Round.advanceToNextBonusPart`'s hardcoded `>= 3`.
 */
async function buildPacket(token: string, name: string, tossupCount: number, bonusCount: number): Promise<string> {
  const { createPacket } = await gql<{ createPacket: { id: string } }>(
    token, `mutation($input: CreatePacketInput!) { createPacket(input: $input) { id } }`,
    { input: { name: `${name} ${Date.now()}` } },
  );
  const packetId = createPacket.id;
  for (let i = 0; i < tossupCount; i++) {
    await gql(token,
      `mutation($packetId: ID!, $input: TossupInput!, $order: Int) { addTossupToPacket(packetId: $packetId, input: $input, order: $order) { id } }`,
      { packetId, order: i, input: { question: `Placeholder tossup ${i + 1} (${name}), for the M5 H0 STOMP recorder; for 10 points, name this synthetic thing.`, answer: `Synthetic Answer ${i + 1}` } });
  }
  for (let i = 0; i < bonusCount; i++) {
    await gql(token,
      `mutation($packetId: ID!, $input: BonusInput!, $order: Int) { addBonusToPacket(packetId: $packetId, input: $input, order: $order) { id } }`,
      {
        packetId, order: i, input: {
          preamble: `Placeholder bonus ${i + 1} preamble (${name}).`,
          parts: [0, 1, 2].map(p => ({ question: `Bonus ${i + 1}, part ${p + 1}: name this synthetic thing.`, answer: `Bonus Answer ${i + 1}.${p + 1}` })),
        },
      });
  }
  await gql(token, `mutation($id: ID!, $v: PacketVisibility!) { setPacketVisibility(id: $id, visibility: $v) { id } }`, { id: packetId, v: 'PUBLISHED' });
  return packetId;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * SINGLE_PLAYER: one bot, no proctor, no bonuses (the server forces
 * `bonusesEnabled=false` for this mode — `SessionService#createNewGame` —
 * because there is structurally no one to adjudicate one; confirmed by
 * reading `GameMessageProcessor#playerSubmitAnswer`, whose single-player
 * branch calls `completeRound()` unconditionally after judging). The lone
 * joiner is auto-seated as the only team's BUZZER (`seatSinglePlayerJoiner`)
 * and is also the session owner (guest sessions: first joiner owns —
 * `GameSession#isOwnerOnJoin`), so it alone can set the packet and start.
 * `SubmitAnswer` (not a separate buzz) both buzzes and answers in one step.
 */
async function recordSinglePlayer(token: string): Promise<void> {
  console.log('== SINGLE_PLAYER ==');
  const tossupCount = 9;
  const packetId = await buildPacket(token, 'M5 H0 SINGLE_PLAYER', tossupCount, 0);
  const game = await createGame('SINGLE_PLAYER', 'NO_PROCTOR', false);
  const bot = await spawnBot(joinByCode, game.joinCode, 'Solo');
  const recorder = new RawRecorder(bot.gameSessionId, bot.playerSessionId, { playerSecret: bot.playerSecret });
  await recorder.ready();

  // The proctorless owner is never granted packet-read rights (only a
  // human proctor is, via `recordPacketProctor`), so the `GameSessionUpdate`
  // this seat receives back — even for the packet it just set — is
  // sanitized like any other player's: `packet.id`/`tossups`/`bonuses` come
  // back null, only `name`/`visibility`/counts survive
  // (`ConfigurationMessageProcessor#setPacketForMatch` + its sanitizer).
  // Wait on `name`, not `id`.
  bot.setPacket(packetId);
  await bot.waitFor(g => !!g.currentMatch?.packet?.name, 8000, 'packet set');
  bot.startMatch();
  await bot.waitFor(g => g.currentMatch?.matchState === 'IN_GAME', 8000, 'match IN_GAME');

  const roundStatesSeen = new Set<string>();
  let rounds = 0;
  const deadline = Date.now() + 60_000;
  while (rounds < tossupCount && Date.now() < deadline) {
    const round = bot.gameSession?.currentMatch?.currentRound;
    const rs: string | undefined = round?.roundState;
    if (rs) roundStatesSeen.add(rs);
    if (bot.gameSession?.currentMatch?.matchState === 'COMPLETED') break;
    if (rs === 'PROCTOR_READING' || rs === 'AWAITING_BUZZ') {
      rounds++;
      bot.submitAnswer(`Synthetic Answer ${rounds}`);
      try {
        await bot.waitFor(g => g.currentMatch?.currentRound?.roundState !== rs || g.currentMatch?.matchState === 'COMPLETED', 8000, `advance from ${rs}`);
      } catch { bot.refresh(); await sleep(600); }
    } else {
      await sleep(250);
    }
  }
  console.log('   roundStatesSeen:', [...roundStatesSeen]);

  recorder.stop();
  bot.disconnect();
  writeFixture('SINGLE_PLAYER', 'buzzer', bot.gameSessionId, bot.playerSessionId, recorder.frames);
}

/**
 * AUTO_PROCTOR (2 fixed teams, `hasAssociatedBonus` bonuses) and
 * FREE_FOR_ALL (one-player teams, auto-seated on join) share the same
 * auto-judged wire flow (`GameMessageProcessor#autoProctorSubmit`/
 * `#autoProctorBonusAnswer`), the one place `BONUS_PENDING` is reachable:
 * a correct tossup pauses there (`startBonusPhase` + `BONUS_PENDING`) until
 * an explicit `/app/game/start-bonus` ({@link StartBonus}) from the
 * bonus-eligible team or the owner enters `BONUS_AWAITING_ANSWER` — unlike
 * the human-proctor path, which skips straight past it (see
 * `recordQuizBowlClassic`'s doc comment). One bot (`solo`) does everything —
 * buzzes, answers, starts the bonus, answers every part, advances rounds
 * (owner-only in a proctorless mode) — recording only its own seat, which
 * is all S1's `auto-proctor-free-for-all` row needs. AUTO_PROCTOR needs a
 * second, otherwise-idle bot only to satisfy "each team must have a player"
 * (`ProgressionMessageProcessor#startMatch`); FREE_FOR_ALL's solo team
 * already satisfies it alone.
 */
async function recordAutoJudgedMultiplayer(token: string, gameMode: 'AUTO_PROCTOR' | 'FREE_FOR_ALL'): Promise<void> {
  console.log(`== ${gameMode} ==`);
  const tossupCount = 9;
  const bonusCount = 4;
  const packetId = await buildPacket(token, `M5 H0 ${gameMode}`, tossupCount, bonusCount);
  const game = await createGame(gameMode, 'NO_PROCTOR', true);

  const solo = await spawnBot(joinByCode, game.joinCode, 'Solo');
  let filler: Awaited<ReturnType<typeof spawnBot>> | null = null;
  if (gameMode === 'AUTO_PROCTOR') {
    await solo.waitFor(g => (g.teamList ?? []).length >= 2, 8000, 'teams present');
    solo.joinTeam(solo.teams[0].teamId);
    filler = await spawnBot(joinByCode, game.joinCode, 'Filler');
    filler.joinTeam(solo.teams[1].teamId);
    await solo.waitFor(g => (g.teamList ?? []).every((t: any) => (t.teamPlayers ?? []).length >= 1), 8000, 'both teams staffed');
  }

  const recorder = new RawRecorder(solo.gameSessionId, solo.playerSessionId, { playerSecret: solo.playerSecret });
  await recorder.ready();

  // Same packet-id redaction as SINGLE_PLAYER (see recordSinglePlayer's
  // comment): wait on `name`, not `id`.
  solo.setPacket(packetId);
  await solo.waitFor(g => !!g.currentMatch?.packet?.name, 8000, 'packet set');
  solo.startMatch();
  await solo.waitFor(g => g.currentMatch?.matchState === 'IN_GAME', 8000, 'match IN_GAME');

  const roundStatesSeen = new Set<string>();
  let rounds = 0;
  const deadline = Date.now() + 90_000;
  while (rounds < tossupCount && Date.now() < deadline) {
    const gs = solo.gameSession;
    const round = gs?.currentMatch?.currentRound;
    const rs: string | undefined = round?.roundState;
    if (rs) roundStatesSeen.add(rs);
    if (gs?.currentMatch?.matchState === 'COMPLETED') break;

    switch (rs) {
      case 'PROCTOR_READING':
      case 'AWAITING_BUZZ':
        solo.buzz();
        break;
      case 'AWAITING_ANSWER':
        solo.submitAnswer(`Synthetic Answer ${round?.roundNumber ?? rounds + 1}`);
        break;
      case 'BONUS_PENDING':
        solo.publish('/app/game/start-bonus', {});
        break;
      case 'BONUS_AWAITING_ANSWER': {
        const bonusIdx = (round?.roundNumber ?? rounds + 1) - 1; // bonus order == tossup order
        const partIdx = round?.currentBonusPartIndex ?? 0;
        solo.submitAnswer(`Bonus Answer ${bonusIdx + 1}.${partIdx + 1}`);
        break;
      }
      case 'COMPLETED':
        rounds++;
        solo.advanceRound();
        break;
      default:
        await sleep(250);
    }

    try {
      await solo.waitFor(g => g.currentMatch?.currentRound?.roundState !== rs || g.currentMatch?.matchState === 'COMPLETED', 9000, `advance from ${rs}`);
    } catch { solo.refresh(); await sleep(600); }
  }
  console.log('   roundStatesSeen:', [...roundStatesSeen]);

  recorder.stop();
  solo.disconnect();
  filler?.disconnect();
  writeFixture(gameMode, 'buzzer', solo.gameSessionId, solo.playerSessionId, recorder.frames);
}

async function main(): Promise<void> {
  const token = await getAuthorToken();
  await recordQuizBowlClassic(token);
  await recordSinglePlayer(token);
  await recordAutoJudgedMultiplayer(token, 'AUTO_PROCTOR');
  await recordAutoJudgedMultiplayer(token, 'FREE_FOR_ALL');
  console.log('Done. Commit polish/fixtures/stomp/** and update the M5 ledger with the recording date and stack ngHead/commit.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
