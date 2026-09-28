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
 * uses so it doesn't depend on the separate, unseeded bank (NG-R2-02) — or,
 * as M3's E1 does, to play a bot-driven QUIZ_BOWL_CLASSIC match (proctor +
 * bonus judging) against a packet just built through the ng packet builder in
 * a browser, which single-player structurally can't exercise bonuses on
 * (plan risk 8).
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

  // Observed one intermittent timeout here (matchState stuck at CONFIG,
  // players/packet never fully converged within 15s), immediately followed by
  // a clean pass on retry -- the signature of M2R2-LIVE-01 (FIX2/FIXG4): a
  // GameSession lost update from concurrent joins racing the Kafka processor
  // save, which can drop a player's team assignment or serve a stale
  // teamList. That fix landed on goal/m2-auth after goal/m3-packets branched,
  // so the m3e1 runtime images here predate it. This widened deadline is not
  // a fix for that race (waitFor already re-polls every 900ms; this only
  // gives a slow/lost update more time to self-correct via the poll) -- the
  // real fix arrives with the M2->M3 merge-forward. Once that lands, this can
  // likely drop back to 15000.
  await proctor.waitFor(
    (g) =>
      g.currentMatch?.packet?.id === packetId &&
      g.playerList?.some((pl: any) => pl.playerMode === 'PROCTOR') &&
      (g.teamList ?? []).reduce((n: number, t: any) => n + (t.teamPlayers?.length ?? 0), 0) >= players.length,
    30000,
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

/** A single played round's bonus outcome, from `driveFullMatch`'s pass over `previousRounds`. */
export interface BonusRoundResult {
  /** The round number (1-based) this bonus was attached to. */
  roundNumber: number;
  /** Whether the round's tossup was answered correctly (should always be true; the harness only judges `true`). */
  tossupCorrect: boolean;
  /** How many of the bonus's parts were answered, and how many were correct (the harness only judges `true`, so normally equal). */
  bonusPartsTotal: number;
  bonusPartsCorrect: number;
  /** `10 * tossupCorrect + 10 * bonusPartsCorrect` — the exact score this one round is worth. */
  score: number;
}

/**
 * Drive a staged match to completion or `maxRounds`, reacting to each round
 * state: proctor reads, a player buzzes, proctor judges, and works the bonus.
 * Returns the number of rounds played, the final team scores, every distinct
 * `roundState` observed (NG-V1-02: so a caller can assert the match actually
 * passed through `BONUS_AWAITING_ANSWER` rather than inferring it from a
 * nonzero score, which a plain tossup round also produces), and the outcome
 * of every round whose tossup carried a bonus that was actually played
 * (`bonusRounds`; a tossup can have an `associatedBonus` and still never
 * reach the bonus phase if nobody answers it correctly, which is why this is
 * derived from `bonusPartAnswers`, not from the bonus's mere presence).
 */
export async function driveFullMatch(
  m: StagedMatch,
  maxRounds = 3,
  verbose = true,
): Promise<{ rounds: number; scores: any[]; roundStatesSeen: string[]; bonusRounds: BonusRoundResult[] }> {
  const { proctor, players } = m;
  const log = (...a: any[]) => verbose && console.log('   ', ...a);

  proctor.startMatch();
  await proctor.waitFor((g) => g.currentMatch?.matchState === 'IN_GAME', 12000, 'match IN_GAME');
  log('match started');

  let rounds = 0;
  let buzzer = 0;
  const roundStatesSeen = new Set<string>();
  // Scale the overall budget with maxRounds: a seeded packet's full tossup
  // count (per NG-R2-02's fix, `full-match` now requires every one of them
  // to complete, not just one) can be well above the default 3.
  const deadline = Date.now() + Math.max(120000, maxRounds * 30000);

  while (rounds < maxRounds && Date.now() < deadline) {
    const gs = proctor.gameSession;
    const round = gs?.currentMatch?.currentRound;
    const rs: string = round?.roundState;
    if (rs) roundStatesSeen.add(rs);
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

  // The wire model never puts a score on Team (see sockbowl-interfaces.ts's
  // `Team` class: only teamId/teamName/teamPlayers) -- scoring is derived
  // client-side from round history, the same way
  // match-summary.component.ts's calculatePlayerScore/calculateTeamBonusScore
  // do: 10 points per correct buzz by one of the team's players, plus 10 per
  // correct bonus part answered while that team was bonusEligibleTeamId. A
  // prior version of this function read t.teamScore/t.score/t.points, none of
  // which exist on Team, so `scores` was always null/0 regardless of outcome.
  const previousRounds = proctor.gameSession?.currentMatch?.previousRounds ?? [];
  const scores = proctor.teams.map((t: any) => {
    const playerIds = new Set((t.teamPlayers ?? []).map((p: any) => p.playerId));
    let score = 0;
    for (const round of previousRounds) {
      for (const buzz of round.buzzList ?? []) {
        if (buzz.correct && playerIds.has(buzz.playerId)) score += 10;
      }
      if (round.bonusEligibleTeamId === t.teamId) {
        score += (round.bonusPartAnswers ?? []).filter((a: any) => a.correct).length * 10;
      }
    }
    return { team: t.teamName, score, players: (t.teamPlayers ?? []).map((p: any) => p.name) };
  });

  // NG-V1-02: identify every round whose bonus was actually played, so a
  // caller can assert an exact score for it rather than a plain nonzero
  // aggregate, which a tossup-only round satisfies just as well. A tossup
  // can carry an `associatedBonus` and still never be scored here if nobody
  // answers it correctly (bonusPartAnswers stays empty), so presence of
  // bonusPartAnswers, not associatedBonus, is what "played" means.
  const bonusRounds: BonusRoundResult[] = previousRounds
    .filter((round: any) => (round.bonusPartAnswers ?? []).length > 0)
    .map((round: any) => {
      const tossupCorrect = (round.buzzList ?? []).some((b: any) => b.correct);
      const bonusPartsTotal = (round.bonusPartAnswers ?? []).length;
      const bonusPartsCorrect = (round.bonusPartAnswers ?? []).filter((a: any) => a.correct).length;
      return {
        roundNumber: round.roundNumber,
        tossupCorrect,
        bonusPartsTotal,
        bonusPartsCorrect,
        score: (tossupCorrect ? 10 : 0) + bonusPartsCorrect * 10,
      };
    });

  return { rounds, scores, roundStatesSeen: [...roundStatesSeen], bonusRounds };
}
