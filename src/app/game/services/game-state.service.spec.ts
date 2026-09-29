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
 * ng minor alongside NG-V1-02: a bonus can have 1-6 parts (D7), not always 3,
 * since M3V1-G-01's game-side fix plays every bonus off its real part count.
 * The proctor and buzzer "X / N points" labels must follow suit rather than
 * hardcoding "/ 30".
 */
describe('GameStateService.getCurrentRoundMaxBonusPoints (ng minor, NG-V1-02)', () => {
  let service: GameStateService;
  let eventSubjects: Record<string, Subject<any>>;

  const EVENT_KEYS = [
    'GameSessionUpdate', 'PlayerRosterUpdate', 'GameStartedMessage', 'MatchPacketUpdate',
    'ProcessError', 'AnswerUpdate', 'RoundUpdate', 'PlayerBuzzed', 'BonusUpdate', 'TimerUpdate',
    'ReadingUpdate',
  ];

  function seedRound(currentBonus: any): void {
    eventSubjects['GameSessionUpdate'].next({
      gameSession: {
        currentMatch: {
          currentRound: {
            roundState: RoundState.BONUS_AWAITING_ANSWER,
            currentBonus,
            currentBonusPartIndex: 0,
            bonusPartAnswers: [],
            bonusEligibleTeamId: 't1',
          },
        },
      } as unknown as GameSession,
    });
  }

  beforeEach(() => {
    eventSubjects = {};
    const gameEventObservables: Record<string, any> = {};
    for (const key of EVENT_KEYS) {
      eventSubjects[key] = new Subject<any>();
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
    service.initialize('g1', 'p1', {});
  });

  it('is 20 for a 2-part bonus', () => {
    seedRound({ bonusParts: [{ id: 1 }, { id: 2 }] });
    expect(service.getCurrentRoundMaxBonusPoints()).toBe(20);
  });

  it('is 40 for a 4-part bonus', () => {
    seedRound({ bonusParts: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] });
    expect(service.getCurrentRoundMaxBonusPoints()).toBe(40);
  });

  it('is 30 for the classic 3-part bonus', () => {
    seedRound({ bonusParts: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    expect(service.getCurrentRoundMaxBonusPoints()).toBe(30);
  });

  it('falls back to 30 when no bonus is active yet', () => {
    eventSubjects['GameSessionUpdate'].next({
      gameSession: { currentMatch: { currentRound: { roundState: RoundState.AWAITING_BUZZ } } } as unknown as GameSession,
    });
    expect(service.getCurrentRoundMaxBonusPoints()).toBe(30);
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

  it('resets the counts on a fresh initialize, so a later resend for a same-named packet is not restored (NG-R4-02)', () => {
    eventSubjects['MatchPacketUpdate'].next({
      packetId: null, packetName: 'Generated Packet', tossupCount: 10, bonusCount: 4,
    });

    // Leaving and rejoining a game seat reuses this singleton service.
    service.initialize('g1', 'p1', {});

    eventSubjects['GameSessionUpdate'].next({
      gameSession: { currentMatch: { packet: { id: null, name: 'Generated Packet', tossups: null, bonuses: null } } },
    });

    expect(session().currentMatch.packet.tossups).toBeNull();
  });

  it('resets the counts when the player leaves the game (NG-R4-02)', () => {
    eventSubjects['MatchPacketUpdate'].next({
      packetId: null, packetName: 'Generated Packet', tossupCount: 10, bonusCount: 4,
    });

    service.leaveGame();

    eventSubjects['GameSessionUpdate'].next({
      gameSession: { currentMatch: { packet: { id: null, name: 'Generated Packet', tossups: null, bonuses: null } } },
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

/**
 * H0 note (audit/m5/h0-gamestate-note.md): after a mid-game page reload a
 * fresh GameStateService can receive a broadcast progression message before
 * the get-game reply. Those handlers used to throw on the empty `{}` state,
 * which tore down that subscription for the rest of the tab.
 */
describe('GameStateService progression before the first GameSessionUpdate (H0)', () => {
  let service: GameStateService;
  let eventSubjects: Record<string, Subject<any>>;

  const EVENT_KEYS = [
    'GameSessionUpdate', 'PlayerRosterUpdate', 'GameStartedMessage', 'MatchPacketUpdate',
    'ProcessError', 'AnswerUpdate', 'RoundUpdate', 'PlayerBuzzed', 'BonusUpdate', 'TimerUpdate',
    'ReadingUpdate',
  ];
  const PROGRESSION = ['GameStartedMessage', 'AnswerUpdate', 'RoundUpdate', 'PlayerBuzzed', 'BonusUpdate'];

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
    service.initialize('g1', 'p1', {});
  });

  for (const key of PROGRESSION) {
    it(`drops an early ${key} without throwing, and keeps applying later ones`, () => {
      const round = { roundState: RoundState.AWAITING_BUZZ } as any;
      expect(() => eventSubjects[key].next({ round, currentRound: round, previousRounds: [] })).not.toThrow();

      eventSubjects['GameSessionUpdate'].next({
        gameSession: { currentMatch: { packet: { id: null, name: null } } } as unknown as GameSession,
      });
      eventSubjects[key].next({ round, currentRound: round, previousRounds: [] });

      if (key === 'GameStartedMessage') {
        expect(session().currentMatch.matchState).toBeDefined();
      } else {
        expect(session().currentMatch.currentRound).toBe(round);
      }
    });
  }
});

/**
 * M5V1-01: every previous message handler mutated the shared
 * `gameSessionState` object in place and re-emitted that same reference on
 * `gameSession$`. GameProctorComponent detects "did the round really
 * change" by comparing a value it cached from the *previous* emission
 * against the new one (see its `ngOnInit` subscription); with a shared
 * mutable reference, the "previous" read already reflected the "next"
 * value by the time the comparison ran, so a real AnswerUpdate (a tossup
 * judgment landing) looked like a no-op and the judging-pending guard in
 * the proctor UI never cleared — it only cleared 5s later via the lost-send
 * timeout, and a judgment inside that window was dropped.
 *
 * These specs prove each handler that changes `currentRound` now emits a
 * genuinely distinct `GameSession` (and `currentMatch`) object on every
 * update, and that a GameProctorComponent-style "read before, read after"
 * comparison reliably observes the change.
 */
describe('GameStateService.gameSession$ reference identity across updates (M5V1-01)', () => {
  let service: GameStateService;
  let eventSubjects: Record<string, Subject<unknown>>;

  const EVENT_KEYS = [
    'GameSessionUpdate', 'PlayerRosterUpdate', 'GameStartedMessage', 'MatchPacketUpdate',
    'ProcessError', 'AnswerUpdate', 'RoundUpdate', 'PlayerBuzzed', 'BonusUpdate', 'TimerUpdate',
    'ReadingUpdate',
  ];

  beforeEach(() => {
    eventSubjects = {};
    const gameEventObservables: Record<string, unknown> = {};
    for (const key of EVENT_KEYS) {
      eventSubjects[key] = new Subject<unknown>();
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
            errors$: new Subject<unknown>().asObservable(),
          },
        },
        { provide: MatSnackBar, useValue: jasmine.createSpyObj('MatSnackBar', ['open']) },
      ],
    });
    service = TestBed.inject(GameStateService);
    service.initialize('g1', 'p1', {});
    eventSubjects['GameSessionUpdate'].next({
      gameSession: {
        currentMatch: {
          currentRound: { roundState: RoundState.AWAITING_ANSWER, currentBuzz: { playerId: 'player2' } },
        },
      } as unknown as GameSession,
    });
  });

  it('emits a new GameSession and currentMatch reference for an AnswerUpdate (the proctor Right/Wrong judgment)', () => {
    let previous!: GameSession;
    let next!: GameSession;
    service.gameSession$.subscribe(gs => (previous = gs)).unsubscribe();

    eventSubjects['AnswerUpdate'].next({
      currentRound: { roundState: RoundState.COMPLETED, currentBuzz: null },
      previousRounds: [],
    });

    service.gameSession$.subscribe(gs => (next = gs)).unsubscribe();

    expect(next).not.toBe(previous);
    expect(next.currentMatch).not.toBe(previous.currentMatch);
  });

  it('lets a GameProctorComponent-style before/after read observe an AnswerUpdate round-state change', () => {
    // Mirrors GameProctorComponent.ngOnInit: cache round/buzz off the
    // previous emission, apply the new one, then compare. Reassigned (never
    // OR'd) on every emission, so the seed emission this subscribe replays
    // synchronously (ReplaySubject(1)) is simply overwritten once the real
    // AnswerUpdate below runs, with nothing to reset in between.
    let cachedRoundState: RoundState | undefined;
    let cachedBuzzId: string | undefined;
    let changeDetected: boolean | undefined;

    service.gameSession$.subscribe(gameSession => {
      const previousRoundState = cachedRoundState;
      const previousBuzzId = cachedBuzzId;
      const nextRoundState = gameSession?.currentMatch?.currentRound?.roundState;
      const nextBuzzId = gameSession?.currentMatch?.currentRound?.currentBuzz?.playerId;
      changeDetected = nextRoundState !== previousRoundState || nextBuzzId !== previousBuzzId;
      cachedRoundState = nextRoundState;
      cachedBuzzId = nextBuzzId;
    });

    eventSubjects['AnswerUpdate'].next({
      currentRound: { roundState: RoundState.COMPLETED, currentBuzz: null },
      previousRounds: [],
    });

    expect(changeDetected).toBeTrue();
  });

  it('emits a new reference for PlayerBuzzed, RoundUpdate, BonusUpdate and TimerUpdate as well', () => {
    const cases: [string, Record<string, unknown>][] = [
      ['PlayerBuzzed', { round: { roundState: RoundState.AWAITING_ANSWER, currentBuzz: { playerId: 'player3' } } }],
      ['RoundUpdate', { round: { roundState: RoundState.AWAITING_BUZZ }, previousRounds: [] }],
      ['BonusUpdate', { currentRound: { roundState: RoundState.BONUS_PENDING }, previousRounds: [] }],
      ['TimerUpdate', { timerType: 'TOSSUP', remainingSeconds: 5 }],
    ];

    for (const [key, payload] of cases) {
      let previous!: GameSession;
      service.gameSession$.subscribe(gs => (previous = gs)).unsubscribe();

      eventSubjects[key].next(payload);

      let next!: GameSession;
      service.gameSession$.subscribe(gs => (next = gs)).unsubscribe();

      expect(next).withContext(key).not.toBe(previous);
    }
  });
});
