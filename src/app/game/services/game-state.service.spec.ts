import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';

import { GameStateService } from './game-state.service';
import { GameMessageService } from './game-message.service';
import { GameSession, RoundState } from '../models/sockbowl/sockbowl-interfaces';

/**
 * NG-R2-06: no Karma spec routed a (redacted) per-player BonusUpdate through
 * GameStateService before this. A player never receives the outcome of a
 * bonus part until the proctor has judged it — the server's redacted view
 * only ever grows `bonusPartAnswers` up to `currentBonusPartIndex` — so this
 * proves GameStateService applies that update correctly and that a judged
 * part contributes to the running score while a not-yet-judged one stays
 * blank (doesn't contribute at all, and isn't just assumed correct).
 */
describe('GameStateService bonus updates (NG-R2-06)', () => {
  let service: GameStateService;
  let eventSubjects: Record<string, Subject<any>>;

  const EVENT_KEYS = [
    'GameSessionUpdate', 'PlayerRosterUpdate', 'GameStartedMessage', 'MatchPacketUpdate',
    'ProcessError', 'AnswerUpdate', 'RoundUpdate', 'PlayerBuzzed', 'BonusUpdate', 'TimerUpdate',
    'ReadingUpdate',
  ];

  function baseGameSession(): GameSession {
    return {
      currentMatch: {
        currentRound: {
          roundState: RoundState.BONUS_AWAITING_ANSWER,
          currentBonusPartIndex: 0,
          bonusPartAnswers: [],
          bonusEligibleTeamId: 't1',
        },
      },
    } as unknown as GameSession;
  }

  beforeEach(() => {
    eventSubjects = {};
    for (const key of EVENT_KEYS) {
      eventSubjects[key] = new Subject<any>();
    }
    const gameEventObservables: Record<string, any> = {};
    for (const key of EVENT_KEYS) {
      gameEventObservables[key] = eventSubjects[key].asObservable();
    }

    TestBed.configureTestingModule({
      providers: [
        GameStateService,
        {
          provide: GameMessageService,
          useValue: {
            gameEventObservables,
            sendMessage: jasmine.createSpy('sendMessage'),
            initialize: jasmine.createSpy('initialize'),
            errors$: new Subject<any>().asObservable(),
          },
        },
        { provide: MatSnackBar, useValue: jasmine.createSpyObj('MatSnackBar', ['open']) },
      ],
    });

    service = TestBed.inject(GameStateService);
    // The same public path a real game seat takes: initialize() wires up
    // subscribeToGameMessages(), then a GameSessionUpdate seeds the session
    // the way the server's initial get-game response would.
    service.initialize('g1', 'p1', {});
    eventSubjects['GameSessionUpdate'].next({ gameSession: baseGameSession() });
  });

  it('counts a judged-correct bonus part toward the running score', () => {
    eventSubjects['BonusUpdate'].next({
      currentRound: {
        roundState: RoundState.BONUS_AWAITING_ANSWER,
        currentBonusPartIndex: 1,
        bonusPartAnswers: [{ partIndex: 0, correct: true }],
        bonusEligibleTeamId: 't1',
      },
      previousRounds: [],
    });

    expect(service.getCurrentRoundBonusPoints()).toBe(10);
  });

  it('does not count a judged-wrong part, and leaves the next, not-yet-judged part blank rather than assumed correct', () => {
    eventSubjects['BonusUpdate'].next({
      currentRound: {
        roundState: RoundState.BONUS_AWAITING_ANSWER,
        currentBonusPartIndex: 1,
        bonusPartAnswers: [{ partIndex: 0, correct: false }],
        bonusEligibleTeamId: 't1',
      },
      previousRounds: [],
    });
    // Part 0 was wrong; part 1 hasn't been judged at all yet (it isn't in
    // bonusPartAnswers), so the score is 0, not partially credited.
    expect(service.getCurrentRoundBonusPoints()).toBe(0);

    let session!: GameSession;
    service.gameSession$.subscribe(gs => (session = gs)).unsubscribe();
    expect(session.currentMatch.currentRound.bonusPartAnswers.length).toBe(1);
    expect(session.currentMatch.currentRound.currentBonusPartIndex).toBe(1);

    eventSubjects['BonusUpdate'].next({
      currentRound: {
        roundState: RoundState.BONUS_COMPLETED,
        currentBonusPartIndex: 2,
        bonusPartAnswers: [{ partIndex: 0, correct: false }, { partIndex: 1, correct: true }],
        bonusEligibleTeamId: 't1',
      },
      previousRounds: [],
    });
    // Only part 1's correct judgement counts; part 0's wrong judgement and
    // the still-unjudged part 2 both contribute nothing.
    expect(service.getCurrentRoundBonusPoints()).toBe(10);
  });

  it('emits the updated round on gameSession$ for each BonusUpdate', () => {
    const seen: GameSession[] = [];
    service.gameSession$.subscribe(gs => seen.push(gs));

    eventSubjects['BonusUpdate'].next({
      currentRound: {
        roundState: RoundState.BONUS_AWAITING_ANSWER,
        currentBonusPartIndex: 1,
        bonusPartAnswers: [{ partIndex: 0, correct: true }],
        bonusEligibleTeamId: 't1',
      },
      previousRounds: [],
    });

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1].currentMatch.currentRound.currentBonusPartIndex).toBe(1);
  });
});
