import { createGame, joinByCode, importQbreaderPacket } from './rest.js';
import { SockbowlBot, spawnBot } from './bot.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface StagedMatch {
  proctor: SockbowlBot;
  players: SockbowlBot[];
  all: SockbowlBot[];
  joinCode: string;
  gameSessionId: string;
  packetId: string;
  /** Tossup count of the packet in play, i.e. the number of rounds a full match plays. */
  tossupCount: number;
  bonusCount: number;
  cleanup: () => void;
}

/**
 * Stand up a fully configured, ready-to-start match: a proctor, a real
 * packet, and N players split across the two teams — all connected over
 * STOMP.
 *
 * By default the packet comes from `importQbreaderPacket` (the local bank).
 * Pass `packetId` (with its actual `tossupCount`/`bonusCount`) to use an
 * already-seeded packet instead — see `findSeededPacket`, which `full-match`
 * uses so it doesn't depend on the separate, unseeded bank (NG-R2-02).
 */
export async function stageMatch(
  opts: { tossupCount?: number; bonusCount?: number; playerNames?: string[]; packetId?: string } = {},
): Promise<StagedMatch> {
  const tossupCount = opts.tossupCount ?? 13;
  const bonusCount = opts.bonusCount ?? 5;
  const playerNames = opts.playerNames ?? ['Ada', 'Blaise', 'Cleo', 'Dov'];

  const game = await createGame();
  const packetId = opts.packetId ?? (await importQbreaderPacket(tossupCount, bonusCount));

  const hostJoin = await joinByCode(game.joinCode, 'Proctor');
  const proctor = new SockbowlBot('Proctor', hostJoin.gameSessionId, hostJoin.playerSecret, hostJoin.playerSessionId);
  await proctor.connect();
  await proctor.waitFor((g) => !!g.teamList?.length, 8000, 'teams present');

  const players: SockbowlBot[] = [];
  for (const n of playerNames) players.push(await spawnBot(joinByCode, game.joinCode, n));

  const teams = proctor.teams;
  players.forEach((p, i) => p.joinTeam(teams[i % teams.length].teamId));

  proctor.becomeProctor();
  proctor.setPacket(packetId);

  await proctor.waitFor(
    (g) =>
      g.currentMatch?.packet?.id === packetId &&
      g.playerList?.some((pl: any) => pl.playerMode === 'PROCTOR') &&
      (g.teamList ?? []).reduce((n: number, t: any) => n + (t.teamPlayers?.length ?? 0), 0) >= players.length,
    15000,
    'ready to start',
  );

  return {
    proctor,
    players,
    all: [proctor, ...players],
    joinCode: game.joinCode,
    gameSessionId: game.gameSessionId,
    packetId,
    tossupCount,
    bonusCount,
    cleanup: () => [proctor, ...players].forEach((b) => b.disconnect()),
  };
}

/**
 * Drive a staged match to completion or `maxRounds`, reacting to each round
 * state: proctor reads, a player buzzes, proctor judges, and works the bonus.
 * Returns the number of rounds played and the final team scores.
 */
export async function driveFullMatch(m: StagedMatch, maxRounds = 3, verbose = true): Promise<{ rounds: number; scores: any[] }> {
  const { proctor, players } = m;
  const log = (...a: any[]) => verbose && console.log('   ', ...a);

  proctor.startMatch();
  await proctor.waitFor((g) => g.currentMatch?.matchState === 'IN_GAME', 12000, 'match IN_GAME');
  log('match started');

  let rounds = 0;
  let buzzer = 0;
  // Scale the overall budget with maxRounds: a seeded packet's full tossup
  // count (per NG-R2-02's fix, `full-match` now requires every one of them
  // to complete, not just one) can be well above the default 3.
  const deadline = Date.now() + Math.max(120000, maxRounds * 30000);

  while (rounds < maxRounds && Date.now() < deadline) {
    const gs = proctor.gameSession;
    const round = gs?.currentMatch?.currentRound;
    const rs: string = round?.roundState;
    if (gs?.currentMatch?.matchState === 'COMPLETED') break;

    switch (rs) {
      case 'PROCTOR_READING':
        proctor.finishedReading();
        break;
      case 'AWAITING_BUZZ': {
        const p = players[buzzer++ % players.length];
        log(`round ${rounds + 1}: ${p.name} buzzes`);
        p.buzz();
        break;
      }
      case 'AWAITING_ANSWER':
        proctor.judge(true); // award the tossup
        break;
      case 'BONUS_READING_PREAMBLE':
        proctor.finishedBonusPreamble();
        break;
      case 'BONUS_READING_PART':
        proctor.finishedBonusPart();
        break;
      case 'BONUS_AWAITING_ANSWER':
        proctor.bonusPartOutcome(round?.currentBonusPartIndex ?? 0, true);
        break;
      case 'BONUS_COMPLETED':
      case 'COMPLETED':
        rounds++;
        log(`round ${rounds} complete → advancing`);
        proctor.advanceRound();
        break;
      default:
        await sleep(250);
    }

    try {
      await proctor.waitFor(
        (g) => g.currentMatch?.currentRound?.roundState !== rs || g.currentMatch?.matchState === 'COMPLETED',
        9000,
        `advance from ${rs}`,
      );
    } catch {
      log(`stalled at ${rs}; refreshing`);
      proctor.refresh();
      await sleep(600);
    }
  }

  const scores = proctor.teams.map((t: any) => ({
    team: t.teamName,
    score: t.teamScore ?? t.score ?? t.points ?? null,
    players: (t.teamPlayers ?? []).map((p: any) => p.name),
  }));
  return { rounds, scores };
}
