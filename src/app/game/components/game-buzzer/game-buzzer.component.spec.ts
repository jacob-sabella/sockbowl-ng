import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, ReplaySubject, Subject } from 'rxjs';

import { GameBuzzerComponent } from './game-buzzer.component';
import { GameStateService } from '../../services/game-state.service';
import { GameConnectionState, GameWebSocketService } from '../../services/game-web-socket.service';
import { GameSession, RoundState, StompError } from '../../models/sockbowl/sockbowl-interfaces';

describe('GameBuzzerComponent (M4-UI-02)', () => {
  let gameStateService: jasmine.SpyObj<GameStateService>;
  let errors$: Subject<StompError>;
  let component: GameBuzzerComponent;

  beforeEach(() => {
    jasmine.clock().install();
    // The debounce guard reads Date.now(); mockDate lets tick() advance it
    // too, instead of only the fake setTimeout queue.
    jasmine.clock().mockDate(new Date());

    errors$ = new Subject<StompError>();
    gameStateService = jasmine.createSpyObj<GameStateService>(
      'GameStateService',
      ['sendPlayerIncomingBuzz', 'hasCurrentPlayerTeamBuzzed'],
      { gameSession$: new Subject() },
    );

    TestBed.configureTestingModule({
      declarations: [GameBuzzerComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        { provide: GameWebSocketService, useValue: { errors$: errors$.asObservable(), connectionState$: of<GameConnectionState>('connected') } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    component = TestBed.createComponent(GameBuzzerComponent).componentInstance;
    component.ngOnInit();
  });

  afterEach(() => jasmine.clock().uninstall());

  describe('press debounce', () => {
    it('sends one buzz for two clicks within 300ms', () => {
      component.onBuzzClick();
      jasmine.clock().tick(299);
      component.onBuzzClick();

      expect(gameStateService.sendPlayerIncomingBuzz).toHaveBeenCalledTimes(1);
    });

    it('sends a second buzz once 300ms have passed', () => {
      component.onBuzzClick();
      jasmine.clock().tick(300);
      component.onBuzzClick();

      expect(gameStateService.sendPlayerIncomingBuzz).toHaveBeenCalledTimes(2);
    });
  });

  describe('stomp-buzz lockout', () => {
    it('locks the buzzer and releases it after retryAfterMs', () => {
      errors$.next({ code: 'RATE_LIMITED', policy: 'stomp-buzz', retryAfterMs: 750 } as StompError);

      expect(component.buzzLocked()).toBeTrue();
      component.onBuzzClick();
      expect(gameStateService.sendPlayerIncomingBuzz).not.toHaveBeenCalled();

      jasmine.clock().tick(749);
      expect(component.buzzLocked()).toBeTrue();

      jasmine.clock().tick(1);
      expect(component.buzzLocked()).toBeFalse();

      component.onBuzzClick();
      expect(gameStateService.sendPlayerIncomingBuzz).toHaveBeenCalledTimes(1);
    });

    it('falls back to retryAfterSeconds*1000 when retryAfterMs is absent', () => {
      errors$.next({ code: 'RATE_LIMITED', policy: 'stomp-buzz', retryAfterSeconds: 2 } as StompError);

      jasmine.clock().tick(1999);
      expect(component.buzzLocked()).toBeTrue();
      jasmine.clock().tick(1);
      expect(component.buzzLocked()).toBeFalse();
    });

    it('falls back to a 1s lockout when neither field is present', () => {
      errors$.next({ code: 'RATE_LIMITED', policy: 'stomp-buzz' } as StompError);

      jasmine.clock().tick(999);
      expect(component.buzzLocked()).toBeTrue();
      jasmine.clock().tick(1);
      expect(component.buzzLocked()).toBeFalse();
    });

    it('a later trip restarts the lockout timer', () => {
      errors$.next({ code: 'RATE_LIMITED', policy: 'stomp-buzz', retryAfterMs: 500 } as StompError);
      jasmine.clock().tick(400);
      errors$.next({ code: 'RATE_LIMITED', policy: 'stomp-buzz', retryAfterMs: 500 } as StompError);

      jasmine.clock().tick(400);
      expect(component.buzzLocked()).toBeTrue(); // would have released at t=500 without the restart

      jasmine.clock().tick(100);
      expect(component.buzzLocked()).toBeFalse();
    });

    it('ignores a RATE_LIMITED error for a different policy', () => {
      errors$.next({ code: 'RATE_LIMITED', policy: 'stomp-send', retryAfterMs: 5000 } as StompError);

      expect(component.buzzLocked()).toBeFalse();
    });

    it('ignores a stomp-buzz error that is not RATE_LIMITED', () => {
      errors$.next({ code: 'QUOTA_EXCEEDED', policy: 'stomp-buzz', retryAfterMs: 5000 } as StompError);

      expect(component.buzzLocked()).toBeFalse();
    });
  });
});

/**
 * NG-R2-06 (bonus view): the player-facing bonus display reads
 * `getCurrentRoundBonusPoints()` off whatever GameStateService derived from
 * the (redacted) BonusUpdate stream. This proves that view actually reflects
 * a judged part's outcome and never credits a part that hasn't been judged
 * yet, i.e. a still-pending part stays blank rather than being shown, or
 * counted, as correct.
 */
describe('GameBuzzerComponent bonus display (NG-R2-06)', () => {
  let fixture: ComponentFixture<GameBuzzerComponent>;
  let session$: ReplaySubject<GameSession>;
  let gameStateService: jasmine.SpyObj<GameStateService>;

  function sessionWith(currentBonusPartIndex: number): GameSession {
    return {
      currentMatch: {
        currentRound: {
          roundState: RoundState.BONUS_AWAITING_ANSWER,
          roundNumber: 1,
          currentBonusPartIndex,
          bonusEligibleTeamId: 't1',
        },
      },
    } as unknown as GameSession;
  }

  function bonusScoreText(): string {
    return (fixture.nativeElement as HTMLElement).querySelector('.bonus-score')!.textContent!.trim();
  }

  beforeEach(() => {
    session$ = new ReplaySubject<GameSession>(1);
    gameStateService = jasmine.createSpyObj<GameStateService>(
      'GameStateService',
      [
        'getCurrentPlayer', 'getCurrentPlayerTeam', 'getPlayerNameById', 'getTeamNameById',
        'hasCurrentPlayerTeamBuzzed', 'sendPlayerIncomingBuzz', 'getCurrentRoundBonusPoints',
        'getCurrentRoundMaxBonusPoints',
      ],
      { gameSession$: session$.asObservable() },
    );
    gameStateService.getTeamNameById.and.returnValue('Team One');
    // The classic 3-part default; the "ng minor" describe block below
    // overrides this to prove the label isn't hardcoded to it.
    gameStateService.getCurrentRoundMaxBonusPoints.and.returnValue(30);

    TestBed.configureTestingModule({
      declarations: [GameBuzzerComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        // M4-UI-02: the buzzer listens for stomp-buzz RATE_LIMITED errors.
        {
          provide: GameWebSocketService,
          useValue: {
            errors$: new Subject<StompError>().asObservable(),
            connectionState$: of<GameConnectionState>('connected'),
          },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    session$.next(sessionWith(1));
    fixture = TestBed.createComponent(GameBuzzerComponent);
  });

  it('shows only the judged part\'s points; the not-yet-judged next part contributes nothing', () => {
    gameStateService.getCurrentRoundBonusPoints.and.returnValue(10); // part 0: correct
    fixture.detectChanges();

    expect(bonusScoreText()).toContain('10 / 30');
    // The status line names the part currently pending judgement (part 2,
    // 1-indexed), and nothing here reveals whether it will be right or
    // wrong — that's exactly the "blank until judged" behavior.
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('answering Part 2');
  });

  it('does not credit a judged-wrong part, and the score only grows on the next judged-correct BonusUpdate', () => {
    // Part 0 judged wrong: 0 points, even though a part *was* judged.
    gameStateService.getCurrentRoundBonusPoints.and.returnValue(0);
    fixture.detectChanges();
    expect(bonusScoreText()).toContain('0 / 30');

    // A later BonusUpdate judges part 1 correct; GameStateService would
    // recompute the score off its updated bonusPartAnswers, which this
    // fixture stands in for directly.
    session$.next(sessionWith(2));
    gameStateService.getCurrentRoundBonusPoints.and.returnValue(10);
    fixture.detectChanges();
    expect(bonusScoreText()).toContain('10 / 30');
  });

  it("shows the real max for a non-3-part bonus rather than a hardcoded '/ 30' (ng minor, NG-V1-02)", () => {
    gameStateService.getCurrentRoundMaxBonusPoints.and.returnValue(20); // a 2-part bonus
    gameStateService.getCurrentRoundBonusPoints.and.returnValue(10);
    fixture.detectChanges();
    expect(bonusScoreText()).toContain('10 / 20');
  });
});

/**
 * M5 S1-01: self / other / team-locked used to render identically ("<name>
 * (<team>) has buzzed in" for everyone) and the dome unmounted outside
 * AWAITING_BUZZ/PROCTOR_READING. `getBuzzState()` now derives a distinct
 * state from `currentBuzz`, and the dome stays mounted (one slot) across
 * every tossup round state.
 */
describe('GameBuzzerComponent buzz state (M5 S1-01)', () => {
  let fixture: ComponentFixture<GameBuzzerComponent>;
  let component: GameBuzzerComponent;
  let session$: ReplaySubject<GameSession>;
  let gameStateService: jasmine.SpyObj<GameStateService>;
  let errors$: Subject<StompError>;

  const SELF_ID = 'p-self';
  const OTHER_ID = 'p-other';
  const TEAM_SELF = 't-self';
  const TEAM_OTHER = 't-other';

  function sessionIn(roundState: RoundState, currentBuzz?: { playerId: string; teamId: string }): GameSession {
    return {
      currentMatch: {
        currentRound: { roundState, roundNumber: 3, currentBuzz },
        packet: { tossups: [{}, {}, {}, {}, {}, {}, {}, {}, {}] }, // 9 tossups
      },
    } as unknown as GameSession;
  }

  function buzzButton(): HTMLButtonElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector('#buzz-button');
  }

  function outcomeStrip(): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector('.buzz-outcome-strip');
  }

  beforeEach(() => {
    session$ = new ReplaySubject<GameSession>(1);
    errors$ = new Subject<StompError>();
    gameStateService = jasmine.createSpyObj<GameStateService>(
      'GameStateService',
      [
        'getPlayerNameById', 'getTeamNameById', 'hasCurrentPlayerTeamBuzzed', 'sendPlayerIncomingBuzz',
        'getCurrentPlayer', 'getCurrentPlayerTeam',
      ],
      { gameSession$: session$.asObservable(), playerSessionId: SELF_ID },
    );
    gameStateService.getPlayerNameById.and.callFake((id: string) => (id === SELF_ID ? 'Ada' : 'Blaise'));
    gameStateService.getTeamNameById.and.callFake((id: string) => (id === TEAM_SELF ? 'Team One' : 'Team Two'));
    gameStateService.hasCurrentPlayerTeamBuzzed.and.returnValue(false);

    TestBed.configureTestingModule({
      declarations: [GameBuzzerComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        { provide: GameWebSocketService, useValue: { errors$: errors$.asObservable(), connectionState$: of<GameConnectionState>('connected') } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(GameBuzzerComponent);
    component = fixture.componentInstance;
  });

  it('is open with no current buzz: dome enabled, no outcome strip', () => {
    session$.next(sessionIn(RoundState.AWAITING_BUZZ));
    fixture.detectChanges();

    expect(component.getBuzzState()).toBe('open');
    expect(buzzButton()?.disabled).toBeFalse();
    expect(buzzButton()?.textContent).toContain('Buzz!');
    expect(outcomeStrip()).toBeNull();
  });

  it('is self when this seat holds the buzz: dome stays mounted and disabled, distinct label and strip', () => {
    session$.next(sessionIn(RoundState.AWAITING_ANSWER, { playerId: SELF_ID, teamId: TEAM_SELF }));
    fixture.detectChanges();

    expect(component.getBuzzState()).toBe('self');
    expect(buzzButton()).not.toBeNull(); // mounted through AWAITING_ANSWER, not just AWAITING_BUZZ
    expect(buzzButton()?.disabled).toBeTrue();
    expect(buzzButton()?.textContent).toContain("You're in, answer!");
    expect(outcomeStrip()?.textContent).toContain('You buzzed. Answer out loud.');
  });

  it('is teamLocked when a teammate holds the buzz: dome muted, strip names the teammate', () => {
    gameStateService.hasCurrentPlayerTeamBuzzed.and.returnValue(true);
    session$.next(sessionIn(RoundState.AWAITING_ANSWER, { playerId: OTHER_ID, teamId: TEAM_SELF }));
    fixture.detectChanges();

    expect(component.getBuzzState()).toBe('teamLocked');
    expect(buzzButton()?.disabled).toBeTrue();
    expect(buzzButton()?.textContent).toContain('Team locked');
    expect(outcomeStrip()?.textContent).toContain('Blaise has the buzz');
  });

  it('is other when the opposing team holds the buzz: distinct label and strip naming player and team', () => {
    session$.next(sessionIn(RoundState.AWAITING_ANSWER, { playerId: OTHER_ID, teamId: TEAM_OTHER }));
    fixture.detectChanges();

    expect(component.getBuzzState()).toBe('other');
    expect(buzzButton()?.disabled).toBeTrue();
    expect(buzzButton()?.textContent).toContain('Blaise has it');
    expect(outcomeStrip()?.textContent).toContain('Blaise (Team Two) has the buzz');
  });

  it('self, other and teamLocked no longer render the same outcome text', () => {
    session$.next(sessionIn(RoundState.AWAITING_ANSWER, { playerId: SELF_ID, teamId: TEAM_SELF }));
    fixture.detectChanges();
    const selfText = outcomeStrip()?.textContent?.trim();

    gameStateService.hasCurrentPlayerTeamBuzzed.and.returnValue(true);
    session$.next(sessionIn(RoundState.AWAITING_ANSWER, { playerId: OTHER_ID, teamId: TEAM_SELF }));
    fixture.detectChanges();
    const teamLockedText = outcomeStrip()?.textContent?.trim();

    gameStateService.hasCurrentPlayerTeamBuzzed.and.returnValue(false);
    session$.next(sessionIn(RoundState.AWAITING_ANSWER, { playerId: OTHER_ID, teamId: TEAM_OTHER }));
    fixture.detectChanges();
    const otherText = outcomeStrip()?.textContent?.trim();

    expect(selfText).not.toBe(teamLockedText);
    expect(teamLockedText).not.toBe(otherText);
    expect(selfText).not.toBe(otherText);
  });

  it('is rateLimited while the stomp-buzz lockout is active, regardless of currentBuzz', () => {
    session$.next(sessionIn(RoundState.AWAITING_BUZZ));
    fixture.detectChanges();
    errors$.next({ code: 'RATE_LIMITED', policy: 'stomp-buzz', retryAfterMs: 5000 } as StompError);
    fixture.detectChanges();

    expect(component.getBuzzState()).toBe('rateLimited');
    expect(buzzButton()?.disabled).toBeTrue();
    expect(buzzButton()?.textContent).toContain('Slow down');
  });

  it('renders "Tossup N of M" from the packet size, matching solo/auto-proctor', () => {
    session$.next(sessionIn(RoundState.AWAITING_BUZZ));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Tossup 3 of 9');
  });

  it('falls back to "Tossup N" with no "of M" when the packet size is unknown', () => {
    const session = {
      currentMatch: { currentRound: { roundState: RoundState.AWAITING_BUZZ, roundNumber: 3 } },
    } as unknown as GameSession;
    session$.next(session);
    fixture.detectChanges();

    const title = (fixture.nativeElement as HTMLElement).querySelector('mat-card-title')?.textContent ?? '';
    expect(title).toContain('Tossup 3');
    expect(title).not.toContain('of');
  });
});

/**
 * M5 S1-03: a dropped/reconnecting socket disables the dome with a distinct
 * label and aria reason, so a buzz is never silently swallowed by a socket
 * the player can't see is down.
 */
describe('GameBuzzerComponent disconnected state (M5 S1-03)', () => {
  let fixture: ComponentFixture<GameBuzzerComponent>;
  let component: GameBuzzerComponent;
  let session$: ReplaySubject<GameSession>;
  let connectionState$: Subject<GameConnectionState>;
  let gameStateService: jasmine.SpyObj<GameStateService>;

  function buzzButton(): HTMLButtonElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector('#buzz-button');
  }

  beforeEach(() => {
    session$ = new ReplaySubject<GameSession>(1);
    connectionState$ = new Subject<GameConnectionState>();
    gameStateService = jasmine.createSpyObj<GameStateService>(
      'GameStateService',
      ['getPlayerNameById', 'getTeamNameById', 'hasCurrentPlayerTeamBuzzed', 'sendPlayerIncomingBuzz',
        'getCurrentPlayer', 'getCurrentPlayerTeam'],
      { gameSession$: session$.asObservable(), playerSessionId: 'p-self' },
    );

    TestBed.configureTestingModule({
      declarations: [GameBuzzerComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        {
          provide: GameWebSocketService,
          useValue: { errors$: new Subject<StompError>().asObservable(), connectionState$: connectionState$.asObservable() },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    session$.next({
      currentMatch: { currentRound: { roundState: RoundState.AWAITING_BUZZ, roundNumber: 1 } },
    } as unknown as GameSession);
    fixture = TestBed.createComponent(GameBuzzerComponent);
    component = fixture.componentInstance;
  });

  it('starts open (the socket connected before the buzzer ever mounts)', () => {
    fixture.detectChanges();

    expect(component.getBuzzState()).toBe('open');
    expect(buzzButton()?.disabled).toBeFalse();
  });

  it('disables the dome with a distinct label and aria reason while reconnecting', () => {
    fixture.detectChanges();

    connectionState$.next('reconnecting');
    fixture.detectChanges();

    expect(component.getBuzzState()).toBe('disconnected');
    expect(buzzButton()?.disabled).toBeTrue();
    expect(buzzButton()?.textContent).toContain('Reconnecting');
    expect(buzzButton()?.getAttribute('aria-label')).toContain('reconnecting');
  });

  it('re-enables the dome once the socket reports connected again', () => {
    fixture.detectChanges();
    connectionState$.next('reconnecting');
    fixture.detectChanges();

    connectionState$.next('connected');
    fixture.detectChanges();

    expect(component.getBuzzState()).toBe('open');
    expect(buzzButton()?.disabled).toBeFalse();
  });

  /**
   * M5 S1-04: `game-canvas`'s `.reconnect-strip` is a fixed overlay that sits
   * above this component. `isDisconnected()` drives a container class that
   * reserves space for it instead of letting it cover the card title.
   */
  it('adds --reconnecting only while the socket is down', () => {
    fixture.detectChanges();
    const container = () => (fixture.nativeElement as HTMLElement).querySelector('.game-buzzer-container');

    expect(component.isDisconnected()).toBeFalse();
    expect(container()?.classList).not.toContain('game-buzzer-container--reconnecting');

    connectionState$.next('reconnecting');
    fixture.detectChanges();
    expect(component.isDisconnected()).toBeTrue();
    expect(container()?.classList).toContain('game-buzzer-container--reconnecting');

    connectionState$.next('connected');
    fixture.detectChanges();
    expect(component.isDisconnected()).toBeFalse();
    expect(container()?.classList).not.toContain('game-buzzer-container--reconnecting');
  });
});

/**
 * M5 S1-29: the navbar shows the account name, not the seat name, so the
 * buzzer's own top strip is the only place a player can check their seat and
 * team. The old `.player-info-card` carried this but was hidden
 * (`display: none`) and dead; it's been replaced with a live seat line.
 */
describe('GameBuzzerComponent seat line (M5 S1-29)', () => {
  let fixture: ComponentFixture<GameBuzzerComponent>;
  let session$: ReplaySubject<GameSession>;
  let gameStateService: jasmine.SpyObj<GameStateService>;

  beforeEach(() => {
    session$ = new ReplaySubject<GameSession>(1);
    gameStateService = jasmine.createSpyObj<GameStateService>(
      'GameStateService',
      ['getPlayerNameById', 'getTeamNameById', 'hasCurrentPlayerTeamBuzzed', 'sendPlayerIncomingBuzz',
        'getCurrentPlayer', 'getCurrentPlayerTeam'],
      { gameSession$: session$.asObservable(), playerSessionId: 'p-self' },
    );
    gameStateService.getCurrentPlayer.and.returnValue({ name: 'Ada' } as any);
    gameStateService.getCurrentPlayerTeam.and.returnValue({ teamName: 'Team Alpha' } as any);

    TestBed.configureTestingModule({
      declarations: [GameBuzzerComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        {
          provide: GameWebSocketService,
          useValue: { errors$: new Subject<StompError>().asObservable(), connectionState$: new Subject<GameConnectionState>().asObservable() },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    session$.next({
      currentMatch: { currentRound: { roundState: RoundState.AWAITING_BUZZ, roundNumber: 1 } },
    } as unknown as GameSession);
    fixture = TestBed.createComponent(GameBuzzerComponent);
  });

  it('shows the current seat and team in the title strip', () => {
    fixture.detectChanges();

    const seatLine = (fixture.nativeElement as HTMLElement).querySelector('.seat-line');
    expect(seatLine?.textContent).toContain('Ada');
    expect(seatLine?.textContent).toContain('Team Alpha');
  });

  it('no longer renders the dead, hidden .player-info-card', () => {
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.player-info-card')).toBeNull();
  });
});

/** M5 S1-22: the dome's rate-limit label ticks down, matching the banner's own countdown. */
describe('GameBuzzerComponent rate-limit countdown (M5 S1-22)', () => {
  let fixture: ComponentFixture<GameBuzzerComponent>;
  let component: GameBuzzerComponent;
  let errors$: Subject<StompError>;

  function buzzButton(): HTMLButtonElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector('#buzz-button');
  }

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date());

    errors$ = new Subject<StompError>();
    const gameStateService = jasmine.createSpyObj<GameStateService>(
      'GameStateService',
      ['sendPlayerIncomingBuzz', 'hasCurrentPlayerTeamBuzzed', 'getCurrentPlayer', 'getCurrentPlayerTeam'],
      { gameSession$: new ReplaySubject<GameSession>(1) },
    );
    (gameStateService.gameSession$ as ReplaySubject<GameSession>).next({
      currentMatch: { currentRound: { roundState: RoundState.AWAITING_BUZZ, roundNumber: 1 } },
    } as unknown as GameSession);

    TestBed.configureTestingModule({
      declarations: [GameBuzzerComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        { provide: GameWebSocketService, useValue: { errors$: errors$.asObservable(), connectionState$: of<GameConnectionState>('connected') } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(GameBuzzerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => jasmine.clock().uninstall());

  it('shows a ticking countdown that matches the real lockout window', () => {
    errors$.next({ code: 'RATE_LIMITED', policy: 'stomp-buzz', retryAfterSeconds: 3 } as StompError);
    fixture.detectChanges();

    expect(buzzButton()?.textContent).toContain('Slow down (3s)');

    jasmine.clock().tick(1000);
    fixture.detectChanges();
    expect(buzzButton()?.textContent).toContain('Slow down (2s)');

    jasmine.clock().tick(1000);
    fixture.detectChanges();
    expect(buzzButton()?.textContent).toContain('Slow down (1s)');

    jasmine.clock().tick(1000);
    fixture.detectChanges();
    expect(component.getBuzzState()).toBe('open');
    expect(buzzButton()?.textContent).toContain('Buzz!');
  });

  it('counts down from the 1s fallback lockout when neither retryAfterMs nor retryAfterSeconds is present', () => {
    errors$.next({ code: 'RATE_LIMITED', policy: 'stomp-buzz' } as StompError);
    fixture.detectChanges();

    expect(buzzButton()?.textContent).toContain('Slow down (1s)'); // BUZZ_LOCKOUT_FALLBACK_MS = 1000ms
  });
});

/**
 * M5 S1-25: an accepted press shows a transient "sent" state instead of
 * looking identical to a fully idle dome until the server echo lands, so a
 * player in a noisy room doesn't tap again or look up late.
 */
describe('GameBuzzerComponent pending buzz (M5 S1-25)', () => {
  const SELF_ID = 'p-self';
  const OTHER_ID = 'p-other';

  let fixture: ComponentFixture<GameBuzzerComponent>;
  let component: GameBuzzerComponent;
  let session$: ReplaySubject<GameSession>;
  let errors$: Subject<StompError>;
  let gameStateService: jasmine.SpyObj<GameStateService>;

  function buzzButton(): HTMLButtonElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector('#buzz-button');
  }

  function sessionIn(currentBuzz?: { playerId: string; teamId: string }): GameSession {
    return {
      currentMatch: { currentRound: { roundState: RoundState.AWAITING_BUZZ, roundNumber: 1, currentBuzz } },
    } as unknown as GameSession;
  }

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date());

    session$ = new ReplaySubject<GameSession>(1);
    errors$ = new Subject<StompError>();
    gameStateService = jasmine.createSpyObj<GameStateService>(
      'GameStateService',
      ['sendPlayerIncomingBuzz', 'hasCurrentPlayerTeamBuzzed', 'getPlayerNameById', 'getTeamNameById',
        'getCurrentPlayer', 'getCurrentPlayerTeam'],
      { gameSession$: session$.asObservable(), playerSessionId: SELF_ID },
    );
    gameStateService.getPlayerNameById.and.returnValue('Blaise');
    gameStateService.getTeamNameById.and.returnValue('Team Two');
    gameStateService.hasCurrentPlayerTeamBuzzed.and.returnValue(false);

    TestBed.configureTestingModule({
      declarations: [GameBuzzerComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        { provide: GameWebSocketService, useValue: { errors$: errors$.asObservable(), connectionState$: of<GameConnectionState>('connected') } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    session$.next(sessionIn());
    fixture = TestBed.createComponent(GameBuzzerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => jasmine.clock().uninstall());

  it('shows a pending, aria-busy dome right after a press, before any echo', () => {
    component.onBuzzClick();
    fixture.detectChanges();

    expect(component.getBuzzState()).toBe('pending');
    expect(buzzButton()?.disabled).toBeTrue();
    expect(buzzButton()?.textContent).toContain('Buzzing…');
    expect(buzzButton()?.getAttribute('aria-busy')).toBe('true');
  });

  it('returns to open after 1500ms with no echo', () => {
    component.onBuzzClick();
    fixture.detectChanges();

    jasmine.clock().tick(1499);
    fixture.detectChanges();
    expect(component.getBuzzState()).toBe('pending');

    jasmine.clock().tick(1);
    fixture.detectChanges();
    expect(component.getBuzzState()).toBe('open');
    expect(buzzButton()?.getAttribute('aria-busy')).toBeNull();
  });

  it('clears as soon as the echo names this seat as the buzz holder', () => {
    component.onBuzzClick();
    fixture.detectChanges();

    session$.next(sessionIn({ playerId: SELF_ID, teamId: 't-self' }));
    fixture.detectChanges();

    expect(component.getBuzzState()).toBe('self');
    jasmine.clock().tick(1500); // a stale timer must not fire and revert the real state
    fixture.detectChanges();
    expect(component.getBuzzState()).toBe('self');
  });

  it('clears when another player buzzes first', () => {
    component.onBuzzClick();
    fixture.detectChanges();

    session$.next(sessionIn({ playerId: OTHER_ID, teamId: 't-other' }));
    fixture.detectChanges();

    expect(component.getBuzzState()).toBe('other');
  });

  it('does not leave a stale pending state once a RATE_LIMITED rejection ends', () => {
    component.onBuzzClick();
    fixture.detectChanges();
    expect(component.getBuzzState()).toBe('pending');

    errors$.next({ code: 'RATE_LIMITED', policy: 'stomp-buzz', retryAfterMs: 500 } as StompError);
    fixture.detectChanges();
    expect(component.getBuzzState()).toBe('rateLimited');

    jasmine.clock().tick(500);
    fixture.detectChanges();
    expect(component.getBuzzState()).toBe('open'); // not 'pending' again
  });

  it('does not send a second message while pending (still inside the debounce window)', () => {
    component.onBuzzClick();
    component.onBuzzClick();

    expect(gameStateService.sendPlayerIncomingBuzz).toHaveBeenCalledTimes(1);
  });
});
