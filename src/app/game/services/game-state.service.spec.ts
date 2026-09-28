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

/**
 * WP-FIXN4 / WP-FIXG5: a non-proctor's MatchPacketUpdate carries no packet id,
 * only the name and the tossup and bonus counts, and a PACKET_NOT_AVAILABLE
 * refusal gets a message that says what to do instead of the raw server text.
 */
describe('GameStateService packet updates (WP-FIXN4)', () => {
  let service: GameStateService;
  let eventSubjects: Record<string, Subject<any>>;
  let snackBar: jasmine.SpyObj<MatSnackBar>;

  const EVENT_KEYS = [
    'GameSessionUpdate', 'PlayerRosterUpdate', 'GameStartedMessage', 'MatchPacketUpdate',
    'ProcessError', 'AnswerUpdate', 'RoundUpdate', 'PlayerBuzzed', 'BonusUpdate', 'TimerUpdate',
    'ReadingUpdate',
  ];

  function session(): GameSession {
    let s!: GameSession;
    service.gameSession$.subscribe(gs => (s = gs)).unsubscribe();
    return s;
  }

  beforeEach(() => {
    eventSubjects = {};
    const gameEventObservables: Record<string, any> = {};
    for (const key of EVENT_KEYS) {
      eventSubjects[key] = new Subject<any>();
      gameEventObservables[key] = eventSubjects[key].asObservable();
    }
    snackBar = jasmine.createSpyObj('MatSnackBar', ['open']);

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
        { provide: MatSnackBar, useValue: snackBar },
      ],
    });

    service = TestBed.inject(GameStateService);
    service.initialize('g1', 'p1', {});
    eventSubjects['GameSessionUpdate'].next({
      gameSession: { currentMatch: { packet: { id: null, name: null } } } as unknown as GameSession,
    });
  });

  it('applies a non-proctor MatchPacketUpdate with no packet id: name and length-only counts', () => {
    eventSubjects['MatchPacketUpdate'].next({
      packetId: null, packetName: 'Generated Packet', tossupCount: 10, bonusCount: 4,
    });

    const packet = session().currentMatch.packet;
    expect(packet.id).toBeNull();
    expect(packet.name).toBe('Generated Packet');
    expect(packet.tossups.length).toBe(10);
    expect(packet.bonuses.length).toBe(4);
    // Counts only: nothing that could carry question text.
    expect(packet.tossups.some(t => !!t)).toBeFalse();
    expect(packet.bonuses.some(b => !!b)).toBeFalse();
  });

  it('keeps the proctor update\'s packet id', () => {
    eventSubjects['MatchPacketUpdate'].next({
      packetId: 'packet-1', packetName: 'Packet One', tossupCount: 20, bonusCount: 20,
    });

    expect(session().currentMatch.packet.id).toBe('packet-1');
    expect(session().currentMatch.packet.bonuses.length).toBe(20);
  });

  it('treats a missing bonusCount (an older game server) as no bonuses', () => {
    eventSubjects['MatchPacketUpdate'].next({ packetId: null, packetName: 'Old', tossupCount: 3 });

    expect(session().currentMatch.packet.bonuses.length).toBe(0);
  });

  it('keeps the counts when the server resends a non-proctor session without questions', () => {
    eventSubjects['MatchPacketUpdate'].next({
      packetId: null, packetName: 'Generated Packet', tossupCount: 10, bonusCount: 4,
    });

    // The sanitized non-proctor view: no id, no tossups, no bonuses.
    eventSubjects['GameSessionUpdate'].next({
      gameSession: { currentMatch: { packet: { id: null, name: 'Generated Packet', tossups: null, bonuses: null } } },
    });

    const packet = session().currentMatch.packet;
    expect(packet.tossups.length).toBe(10);
    expect(packet.bonuses.length).toBe(4);
  });

  it('does not carry the counts over to a different packet', () => {
    eventSubjects['MatchPacketUpdate'].next({
      packetId: null, packetName: 'Generated Packet', tossupCount: 10, bonusCount: 4,
    });

    eventSubjects['GameSessionUpdate'].next({
      gameSession: { currentMatch: { packet: { id: null, name: 'Another Packet', tossups: null, bonuses: null } } },
    });

    expect(session().currentMatch.packet.tossups).toBeNull();
  });

  it('forgets the counts once the packet is cleared', () => {
    eventSubjects['MatchPacketUpdate'].next({
      packetId: null, packetName: 'Generated Packet', tossupCount: 10, bonusCount: 4,
    });
    eventSubjects['MatchPacketUpdate'].next({ packetId: null, packetName: null, tossupCount: 0 });

    const packet = session().currentMatch.packet;
    expect(packet.name).toBeNull();
    expect(packet.tossups.length).toBe(0);
    expect(packet.bonuses.length).toBe(0);
  });

  it('explains a PACKET_NOT_AVAILABLE ProcessError instead of showing the raw server text', () => {
    eventSubjects['ProcessError'].next({
      code: 'PACKET_NOT_AVAILABLE',
      error: 'Packet id abc is not available for play',
    });

    expect(snackBar.open).toHaveBeenCalledOnceWith(
      jasmine.stringMatching(/can't be used in this game/), 'Dismiss', jasmine.anything());
  });

  it('shows a ProcessError without a code as the server sent it', () => {
    eventSubjects['ProcessError'].next({ error: 'StartMatch: Permission Denied' });

    expect(snackBar.open).toHaveBeenCalledOnceWith('StartMatch: Permission Denied', 'Dismiss', jasmine.anything());
  });
});
