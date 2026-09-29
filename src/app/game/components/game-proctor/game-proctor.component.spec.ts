import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of, Subject } from 'rxjs';

import { GameProctorComponent } from './game-proctor.component';
import { GameStateService } from '../../services/game-state.service';
import { PresentationConnectionService } from '../../services/presentation-connection.service';
import { CastStateService } from '../../services/cast-state.service';
import { GameSession, RoundState, StompError } from '../../models/sockbowl/sockbowl-interfaces';
import { PresentationConnectionState } from '../../models/cast-interfaces';

/**
 * ng minor alongside NG-V1-02: the proctor's bonus score label used to
 * hardcode "/ 30 points", which was only ever true for the classic 3-part
 * bonus. M3V1-G-01 made the game play a bonus off its real part count (1-6,
 * D7), so the label must follow suit rather than misreporting a 2- or
 * 4-part bonus's actual maximum.
 */
describe('GameProctorComponent bonus score label (ng minor, NG-V1-02)', () => {
  let fixture: ComponentFixture<GameProctorComponent>;
  let session$: BehaviorSubject<GameSession>;
  let gameStateService: jasmine.SpyObj<GameStateService>;

  function sessionWith(currentBonusPartIndex: number): GameSession {
    return {
      currentMatch: {
        currentRound: {
          roundState: RoundState.BONUS_AWAITING_ANSWER,
          roundNumber: 1,
          currentBonus: { preamble: 'p', bonusParts: [] },
          currentBonusPartIndex,
          bonusPartAnswers: [],
          bonusEligibleTeamId: 't1',
        },
      },
    } as unknown as GameSession;
  }

  function bonusScoreText(): string {
    return (fixture.nativeElement as HTMLElement).querySelector('.bonus-header .bonus-score')!.textContent!.trim();
  }

  beforeEach(() => {
    session$ = new BehaviorSubject<GameSession>(sessionWith(0));
    gameStateService = jasmine.createSpyObj<GameStateService>(
      'GameStateService',
      ['getTeamNameById', 'getPlayerNameById', 'getCurrentRoundBonusPoints', 'getCurrentRoundMaxBonusPoints'],
      { gameSession$: session$.asObservable() },
    );
    gameStateService.getTeamNameById.and.returnValue('Team One');
    gameStateService.getCurrentRoundBonusPoints.and.returnValue(10);
    // The classic 3-part default; overridden per-test below.
    gameStateService.getCurrentRoundMaxBonusPoints.and.returnValue(30);

    TestBed.configureTestingModule({
      declarations: [GameProctorComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        {
          provide: PresentationConnectionService,
          useValue: { isAvailable$: of(false), connectionState$: of(PresentationConnectionState.DISCONNECTED) },
        },
        { provide: CastStateService, useValue: {} },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(GameProctorComponent);
    fixture.detectChanges();
  });

  it("shows '/ 30' for the classic 3-part bonus", () => {
    expect(bonusScoreText()).toContain('10 / 30 points');
  });

  it("shows the real max for a 2-part bonus, not a hardcoded '/ 30'", () => {
    gameStateService.getCurrentRoundMaxBonusPoints.and.returnValue(20);
    session$.next(sessionWith(0));
    fixture.detectChanges();
    expect(bonusScoreText()).toContain('10 / 20 points');
  });

  it("shows the real max for a 4-part bonus", () => {
    gameStateService.getCurrentRoundMaxBonusPoints.and.returnValue(40);
    session$.next(sessionWith(0));
    fixture.detectChanges();
    expect(bonusScoreText()).toContain('10 / 40 points');
  });
});

/**
 * M5 S2-13: the bonus part Right/Wrong labels used to hardcode "10 pts"
 * in four template spots instead of reading the same source as the
 * header's own maximum, so the two could disagree if scoring ever
 * stopped being a flat 10 per part.
 */
describe('GameProctorComponent bonus part point value (M5 S2-13)', () => {
  let fixture: ComponentFixture<GameProctorComponent>;
  let session$: BehaviorSubject<GameSession>;
  let gameStateService: jasmine.SpyObj<GameStateService>;

  function sessionWith(bonusPartsLength: number): GameSession {
    return {
      currentMatch: {
        currentRound: {
          roundState: RoundState.BONUS_AWAITING_ANSWER,
          roundNumber: 1,
          currentBonus: {
            preamble: 'p',
            bonusParts: Array.from({length: bonusPartsLength}, (_, i) => ({
              bonusPart: {question: `Q${i}`, answer: `A${i}`},
            })),
          },
          currentBonusPartIndex: 0,
          bonusPartAnswers: [],
          bonusEligibleTeamId: 't1',
        },
      },
    } as unknown as GameSession;
  }

  beforeEach(() => {
    session$ = new BehaviorSubject<GameSession>(sessionWith(2));
    gameStateService = jasmine.createSpyObj<GameStateService>(
      'GameStateService',
      ['getTeamNameById', 'getPlayerNameById', 'getCurrentRoundBonusPoints', 'getCurrentRoundMaxBonusPoints'],
      { gameSession$: session$.asObservable() },
    );
    gameStateService.getTeamNameById.and.returnValue('Team One');
    gameStateService.getCurrentRoundBonusPoints.and.returnValue(0);
    // A max that isn't 10x the part count proves the label is derived from
    // this source, not a hardcoded "10 pts" literal.
    gameStateService.getCurrentRoundMaxBonusPoints.and.returnValue(16);

    TestBed.configureTestingModule({
      declarations: [GameProctorComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        {
          provide: PresentationConnectionService,
          useValue: { isAvailable$: of(false), connectionState$: of(PresentationConnectionState.DISCONNECTED) },
        },
        { provide: CastStateService, useValue: {} },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(GameProctorComponent);
    fixture.detectChanges();
  });

  it("derives the current part's Right label from the header's own max, not a hardcoded 10 pts", () => {
    const rightBtn = (fixture.nativeElement as HTMLElement).querySelector('.bonus-right-btn')!;
    expect(rightBtn.textContent).toContain('Right (8 pts)');
    expect(rightBtn.textContent).not.toContain('10 pts');
  });

  it('falls back to the classic 10 pts before the bonus part count is known', () => {
    session$.next(sessionWith(0));
    fixture.detectChanges();
    const rightBtn = (fixture.nativeElement as HTMLElement).querySelector('.bonus-right-btn')!;
    expect(rightBtn.textContent).toContain('Right (10 pts)');
  });
});

/**
 * M5 S2-09: the header falls back to "Round N" until the server has sent
 * the packet's length-only tossups array (MatchPacketUpdate), then shows
 * "Tossup N of M" plus a "Last tossup" chip on the final one.
 */
describe('GameProctorComponent tossup position header (M5 S2-09)', () => {
  let fixture: ComponentFixture<GameProctorComponent>;
  let session$: BehaviorSubject<GameSession>;
  let gameStateService: jasmine.SpyObj<GameStateService>;

  function sessionWith(roundState: RoundState, roundNumber: number, tossupCount?: number): GameSession {
    return {
      currentMatch: {
        packet: tossupCount === undefined ? undefined : { tossups: new Array(tossupCount) },
        currentRound: { roundState, roundNumber },
      },
    } as unknown as GameSession;
  }

  function titleText(): string {
    return (fixture.nativeElement as HTMLElement).querySelector('mat-card-title')!.textContent!.replace(/\s+/g, ' ').trim();
  }

  beforeEach(() => {
    session$ = new BehaviorSubject<GameSession>(sessionWith(RoundState.PROCTOR_READING, 1));
    gameStateService = jasmine.createSpyObj<GameStateService>(
      'GameStateService',
      ['getTeamNameById', 'getPlayerNameById', 'getCurrentRoundBonusPoints', 'getCurrentRoundMaxBonusPoints'],
      { gameSession$: session$.asObservable() },
    );

    TestBed.configureTestingModule({
      declarations: [GameProctorComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        {
          provide: PresentationConnectionService,
          useValue: { isAvailable$: of(false), connectionState$: of(PresentationConnectionState.DISCONNECTED) },
        },
        { provide: CastStateService, useValue: {} },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(GameProctorComponent);
  });

  it('falls back to "Round N" when the packet\'s tossup count is unknown', () => {
    fixture.detectChanges();
    expect(titleText()).toBe('Round 1');
  });

  it('shows "Tossup N of M" once the packet length is known', () => {
    session$.next(sessionWith(RoundState.PROCTOR_READING, 2, 20));
    fixture.detectChanges();
    expect(titleText()).toContain('Tossup 2 of 20');
    expect(titleText()).not.toContain('Last tossup');
  });

  it('adds a "Last tossup" chip on the final round', () => {
    session$.next(sessionWith(RoundState.PROCTOR_READING, 20, 20));
    fixture.detectChanges();
    expect(titleText()).toContain('Tossup 20 of 20');
    expect(titleText()).toContain('Last tossup');
  });

  it('shows banner copy for BONUS_PENDING instead of leaving it blank', () => {
    session$.next(sessionWith(RoundState.BONUS_PENDING, 1));
    fixture.detectChanges();
    const banner = (fixture.nativeElement as HTMLElement).querySelector('.proctor-status')!;
    expect(banner.textContent!.trim().length).toBeGreaterThan(0);
  });
});

/**
 * M5 S2-06: empty category/subcategory boxes don't render (a blank labelled
 * box just pushes the pinned decision row down for nothing), and the
 * tossup's Q/A collapses to a one-line summary once the bonus starts, since
 * the proctor's attention has already moved to the bonus content below.
 */
describe('GameProctorComponent tossup summary and empty metadata (M5 S2-06)', () => {
  let fixture: ComponentFixture<GameProctorComponent>;
  let session$: BehaviorSubject<GameSession>;

  function sessionWith(
    roundState: RoundState,
    category?: string,
    subcategory?: string,
  ): GameSession {
    return {
      currentMatch: {
        currentRound: {
          roundState,
          roundNumber: 1,
          category,
          subcategory,
          question: 'What is the capital of France?',
          answer: 'Paris',
          currentBonus: { preamble: 'p', bonusParts: [] },
          currentBonusPartIndex: 0,
          bonusPartAnswers: [],
          bonusEligibleTeamId: 't1',
        },
      },
    } as unknown as GameSession;
  }

  function root(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    session$ = new BehaviorSubject<GameSession>(sessionWith(RoundState.PROCTOR_READING, 'Science', 'Biology'));
    const gameStateService = jasmine.createSpyObj<GameStateService>(
      'GameStateService',
      ['getTeamNameById', 'getPlayerNameById', 'getCurrentRoundBonusPoints', 'getCurrentRoundMaxBonusPoints'],
      { gameSession$: session$.asObservable() },
    );
    gameStateService.getCurrentRoundMaxBonusPoints.and.returnValue(30);
    gameStateService.getCurrentRoundBonusPoints.and.returnValue(0);

    TestBed.configureTestingModule({
      declarations: [GameProctorComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        {
          provide: PresentationConnectionService,
          useValue: { isAvailable$: of(false), connectionState$: of(PresentationConnectionState.DISCONNECTED) },
        },
        { provide: CastStateService, useValue: {} },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(GameProctorComponent);
    fixture.detectChanges();
  });

  it('renders both category and subcategory when both are present', () => {
    expect(root().querySelector('.category-section')).not.toBeNull();
    expect(root().querySelector('.subcategory-section')).not.toBeNull();
  });

  it('omits only the subcategory box when the round has no subcategory', () => {
    session$.next(sessionWith(RoundState.PROCTOR_READING, 'Science', ''));
    fixture.detectChanges();
    expect(root().querySelector('.category-section')).not.toBeNull();
    expect(root().querySelector('.subcategory-section')).toBeNull();
  });

  it('renders no category row at all when neither field is set', () => {
    session$.next(sessionWith(RoundState.PROCTOR_READING, '', ''));
    fixture.detectChanges();
    expect(root().querySelector('.category-row')).toBeNull();
  });

  it('shows the full question and answer sections outside the bonus phase', () => {
    expect(root().querySelector('.question-section')).not.toBeNull();
    expect(root().querySelector('.answer-section')).not.toBeNull();
    expect(root().querySelector('.tossup-summary-section')).toBeNull();
  });

  it('collapses the tossup to a one-line summary once the bonus starts', () => {
    session$.next(sessionWith(RoundState.BONUS_PENDING, 'Science', 'Biology'));
    fixture.detectChanges();
    expect(root().querySelector('.question-section')).toBeNull();
    expect(root().querySelector('.answer-section')).toBeNull();
    const summary = root().querySelector('.tossup-summary-section');
    expect(summary).not.toBeNull();
    expect(summary!.textContent!.trim().length).toBeGreaterThan(0);
  });

  it('keeps the tossup collapsed through every bonus RoundState', () => {
    const bonusStates = [
      RoundState.BONUS_PENDING,
      RoundState.BONUS_READING_PREAMBLE,
      RoundState.BONUS_READING_PART,
      RoundState.BONUS_AWAITING_ANSWER,
      RoundState.BONUS_COMPLETED,
    ];
    for (const state of bonusStates) {
      session$.next(sessionWith(state, 'Science', 'Biology'));
      fixture.detectChanges();
      expect(root().querySelector('.tossup-summary-section')).not.toBeNull();
    }
  });

  it('keeps the tossup question and answer reachable for a protest check during the bonus (M5 S2-25)', () => {
    session$.next(sessionWith(RoundState.BONUS_READING_PREAMBLE, 'Science', 'Biology'));
    fixture.detectChanges();
    const recap = root().querySelector('.tossup-recap');
    expect(recap).not.toBeNull();
    expect(recap!.querySelector('.tossup-recap__question')!.innerHTML).toContain('capital of France');
    expect(recap!.querySelector('.tossup-recap__answer')!.textContent).toContain('Paris');
  });
});

/**
 * M5 S2-22: the tossup question/answer and the bonus preamble/part text are
 * one read-aloud voice - the DESIGN.md reading token - so a per-section CSS
 * rule (`.question-section .info-value`, `.bonus-preamble`, ...) can't win
 * on specificity and quietly re-split them into different sizes.
 */
describe('GameProctorComponent reading-text type role (M5 S2-22)', () => {
  let fixture: ComponentFixture<GameProctorComponent>;
  let session$: BehaviorSubject<GameSession>;

  function sessionWith(roundState: RoundState): GameSession {
    return {
      currentMatch: {
        currentRound: {
          roundState,
          roundNumber: 1,
          category: 'Science',
          question: 'What is the capital of France?',
          answer: 'Paris',
          currentBonus: {
            preamble: 'This is the bonus preamble.',
            bonusParts: [{ question: 'Bonus part one?', answer: 'Answer one' }],
          },
          currentBonusPartIndex: 0,
          bonusPartAnswers: [],
          bonusEligibleTeamId: 't1',
        },
      },
    } as unknown as GameSession;
  }

  function root(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function styleOf(selector: string): CSSStyleDeclaration {
    const el = root().querySelector(selector);
    expect(el).withContext(selector).not.toBeNull();
    return getComputedStyle(el!);
  }

  beforeEach(() => {
    session$ = new BehaviorSubject<GameSession>(sessionWith(RoundState.PROCTOR_READING));
    const gameStateService = jasmine.createSpyObj<GameStateService>(
      'GameStateService',
      ['getTeamNameById', 'getPlayerNameById', 'getCurrentRoundBonusPoints', 'getCurrentRoundMaxBonusPoints'],
      { gameSession$: session$.asObservable() },
    );
    gameStateService.getTeamNameById.and.returnValue('Team One');
    gameStateService.getCurrentRoundMaxBonusPoints.and.returnValue(30);
    gameStateService.getCurrentRoundBonusPoints.and.returnValue(0);

    TestBed.configureTestingModule({
      declarations: [GameProctorComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        {
          provide: PresentationConnectionService,
          useValue: { isAvailable$: of(false), connectionState$: of(PresentationConnectionState.DISCONNECTED) },
        },
        { provide: CastStateService, useValue: {} },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(GameProctorComponent);
    fixture.detectChanges();
  });

  it('renders the tossup question and answer at the same computed font-size and line-height', () => {
    const question = styleOf('.question-section .info-value');
    const answer = styleOf('.answer-section .info-value');
    // Guards against both sides quietly falling back to the browser default
    // (16px) if a more specific per-section rule ever wins again - equality
    // alone wouldn't catch that, since 16px would still equal 16px.
    expect(question.fontSize).not.toBe('16px');
    expect(answer.fontSize).toBe(question.fontSize);
    expect(answer.lineHeight).toBe(question.lineHeight);
  });

  it('renders the bonus preamble and a bonus part at the tossup reading size', () => {
    const tossupFontSize = styleOf('.question-section .info-value').fontSize;
    expect(tossupFontSize).not.toBe('16px');

    session$.next(sessionWith(RoundState.BONUS_READING_PREAMBLE));
    fixture.detectChanges();
    expect(styleOf('.bonus-preamble').fontSize).toBe(tossupFontSize);

    session$.next(sessionWith(RoundState.BONUS_READING_PART));
    fixture.detectChanges();
    expect(styleOf('.bonus-part.current .part-question').fontSize).toBe(tossupFontSize);
    expect(styleOf('.bonus-part.current .part-answer').fontSize).toBe(tossupFontSize);
  });
});

/**
 * M5 S2-20: with the auto-timer off, #timeout-btn and .manual-timeout-btn
 * used to render as two separate, both-pinned buttons on top of each other
 * in AWAITING_BUZZ. There must be exactly one tossup timeout control,
 * whether the auto-timer is on or off.
 */
describe('GameProctorComponent tossup timeout control (M5 S2-20)', () => {
  let fixture: ComponentFixture<GameProctorComponent>;
  let session$: BehaviorSubject<GameSession>;

  function sessionWith(autoTimerEnabled: boolean): GameSession {
    return {
      gameSettings: { timerSettings: { autoTimerEnabled } },
      currentMatch: {
        currentRound: {
          roundState: RoundState.AWAITING_BUZZ,
          roundNumber: 1,
        },
      },
    } as unknown as GameSession;
  }

  function timeoutButtons(): NodeListOf<HTMLButtonElement> {
    return (fixture.nativeElement as HTMLElement).querySelectorAll('#timeout-btn, .manual-timeout-btn');
  }

  beforeEach(() => {
    session$ = new BehaviorSubject<GameSession>(sessionWith(true));
    const gameStateService = jasmine.createSpyObj<GameStateService>(
      'GameStateService',
      ['getTeamNameById', 'getPlayerNameById'],
      { gameSession$: session$.asObservable() },
    );

    TestBed.configureTestingModule({
      declarations: [GameProctorComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        {
          provide: PresentationConnectionService,
          useValue: { isAvailable$: of(false), connectionState$: of(PresentationConnectionState.DISCONNECTED) },
        },
        { provide: CastStateService, useValue: {} },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(GameProctorComponent);
    fixture.detectChanges();
  });

  it('renders exactly one timeout button with the auto-timer on', () => {
    expect(timeoutButtons().length).toBe(1);
    expect(timeoutButtons()[0].textContent).toContain('Timeout');
  });

  it('renders exactly one timeout button with the auto-timer off', () => {
    session$.next(sessionWith(false));
    fixture.detectChanges();
    expect(timeoutButtons().length).toBe(1);
    expect(timeoutButtons()[0].textContent).toContain('Manual Timeout');
    expect(timeoutButtons()[0].classList).toContain('manual-timeout-btn');
  });
});

/**
 * M5 S2-07: the cast control is a single element that is always present,
 * with a designed appearance for every PresentationConnectionState instead
 * of rendering nothing for CONNECTING/TERMINATED and silently hiding the
 * whole control when castAvailable$ is false.
 */
describe('GameProctorComponent cast control states (M5 S2-07)', () => {
  let fixture: ComponentFixture<GameProctorComponent>;
  let connectionState$: BehaviorSubject<PresentationConnectionState>;
  let available$: BehaviorSubject<boolean>;
  let presentationConnectionService: jasmine.SpyObj<{ startPresentation: () => void; stopPresentation: () => void }>;

  function session(): GameSession {
    return {
      currentMatch: {
        currentRound: { roundState: RoundState.PROCTOR_READING, roundNumber: 1 },
      },
    } as unknown as GameSession;
  }

  function castButton(): HTMLButtonElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector('.cast-controls button');
  }

  function castStatus(): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector('.cast-status');
  }

  function configure(initialConnState: PresentationConnectionState, initialAvailable = true): void {
    connectionState$ = new BehaviorSubject<PresentationConnectionState>(initialConnState);
    available$ = new BehaviorSubject<boolean>(initialAvailable);
    presentationConnectionService = jasmine.createSpyObj('PresentationConnectionService', [
      'startPresentation',
      'stopPresentation',
    ]);

    TestBed.configureTestingModule({
      declarations: [GameProctorComponent],
      providers: [
        {
          provide: GameStateService,
          useValue: jasmine.createSpyObj<GameStateService>(
            'GameStateService',
            ['getTeamNameById', 'getPlayerNameById', 'getCurrentRoundBonusPoints', 'getCurrentRoundMaxBonusPoints'],
            { gameSession$: of(session()) },
          ),
        },
        {
          provide: PresentationConnectionService,
          useValue: {
            isAvailable$: available$.asObservable(),
            connectionState$: connectionState$.asObservable(),
            startPresentation: presentationConnectionService.startPresentation,
            stopPresentation: presentationConnectionService.stopPresentation,
          },
        },
        { provide: CastStateService, useValue: {} },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(GameProctorComponent);
    fixture.detectChanges();
  }

  it('shows a disabled cast button with a reason when the API is unavailable', () => {
    configure(PresentationConnectionState.DISCONNECTED, false);
    const btn = castButton()!;
    expect(btn.disabled).toBeTrue();
    expect(btn.getAttribute('aria-label')).toContain('unavailable');
  });

  it('shows an enabled cast button when disconnected but available', () => {
    configure(PresentationConnectionState.DISCONNECTED, true);
    const btn = castButton()!;
    expect(btn.disabled).toBeFalse();
    expect(btn.getAttribute('aria-label')).toBe('Cast this match to a TV');
  });

  it('shows a "Choose a display…" status while connecting, with no button', () => {
    configure(PresentationConnectionState.CONNECTING, true);
    expect(castStatus()!.textContent).toContain('Choose a display');
    expect(castButton()).toBeNull();
  });

  it('shows a Stop casting button when connected, and it calls stopPresentation', () => {
    configure(PresentationConnectionState.CONNECTED, true);
    const btn = castButton()!;
    expect(btn.getAttribute('aria-label')).toBe('Stop casting to TV');
    btn.click();
    expect(presentationConnectionService.stopPresentation).toHaveBeenCalled();
  });

  it('shows a Cast again button when terminated, and it calls startPresentation', () => {
    configure(PresentationConnectionState.TERMINATED, true);
    const btn = castButton()!;
    expect(btn.getAttribute('aria-label')).toContain('Cast again');
    btn.click();
    expect(presentationConnectionService.startPresentation).toHaveBeenCalled();
  });
});

/**
 * M5 S2-05: judge keyboard shortcuts. Space/Enter is the one primary action
 * due right now, R/W judge, T times out — each only for the RoundState it's
 * actually valid in — and every key is ignored while typing, on a held
 * repeat, or while a dialog is open.
 */
describe('GameProctorComponent judge keyboard shortcuts (M5 S2-05)', () => {
  let fixture: ComponentFixture<GameProctorComponent>;
  let session$: BehaviorSubject<GameSession>;
  let gameStateService: jasmine.SpyObj<GameStateService>;
  let errors$: Subject<StompError>;
  let dialogEl: HTMLElement | null = null;

  function sessionWith(partial: Record<string, unknown>): GameSession {
    return {
      currentMatch: {
        currentRound: {
          roundNumber: 1,
          currentBonus: { preamble: 'p', bonusParts: [{}, {}] },
          currentBonusPartIndex: 0,
          bonusPartAnswers: [],
          bonusEligibleTeamId: 't1',
          ...partial,
        },
      },
    } as unknown as GameSession;
  }

  function dispatchKey(key: string, opts: Partial<KeyboardEventInit> = {}, target: EventTarget = document.body): void {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
    Object.defineProperty(event, 'target', { value: target, configurable: true });
    document.dispatchEvent(event);
  }

  function liveAnnouncement(): string {
    return (fixture.nativeElement as HTMLElement).querySelector('[aria-live="assertive"]')!.textContent!.trim();
  }

  beforeEach(() => {
    session$ = new BehaviorSubject<GameSession>(sessionWith({ roundState: RoundState.PROCTOR_READING }));
    errors$ = new Subject<StompError>();
    gameStateService = jasmine.createSpyObj<GameStateService>(
      'GameStateService',
      [
        'getTeamNameById', 'getPlayerNameById', 'getCurrentRoundBonusPoints', 'getCurrentRoundMaxBonusPoints',
        'sendFinishedReading', 'sendTimeoutRound', 'sendAdvanceRound', 'sendAnswerCorrect', 'sendAnswerIncorrect',
        'sendFinishedReadingBonusPreamble', 'sendFinishedReadingBonusPart', 'sendTimeoutBonusPart', 'sendBonusPartOutcome',
      ],
      { gameSession$: session$.asObservable(), errors$: errors$.asObservable() },
    );
    gameStateService.getPlayerNameById.and.returnValue('Ada');
    gameStateService.getCurrentRoundMaxBonusPoints.and.returnValue(20);

    TestBed.configureTestingModule({
      declarations: [GameProctorComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        {
          provide: PresentationConnectionService,
          useValue: { isAvailable$: of(false), connectionState$: of(PresentationConnectionState.DISCONNECTED) },
        },
        { provide: CastStateService, useValue: {} },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(GameProctorComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    dialogEl?.remove();
    dialogEl = null;
  });

  it('Space fires the primary action while reading', () => {
    dispatchKey(' ');
    expect(gameStateService.sendFinishedReading).toHaveBeenCalled();
  });

  it('Enter fires the same primary action as Space', () => {
    dispatchKey('Enter');
    expect(gameStateService.sendFinishedReading).toHaveBeenCalled();
  });

  it('Space advances the round once it is complete', () => {
    session$.next(sessionWith({ roundState: RoundState.COMPLETED }));
    fixture.detectChanges();
    dispatchKey(' ');
    expect(gameStateService.sendAdvanceRound).toHaveBeenCalled();
  });

  it('Space finishes reading the bonus preamble', () => {
    session$.next(sessionWith({ roundState: RoundState.BONUS_READING_PREAMBLE }));
    fixture.detectChanges();
    dispatchKey(' ');
    expect(gameStateService.sendFinishedReadingBonusPreamble).toHaveBeenCalled();
  });

  it('Space finishes reading the current bonus part', () => {
    session$.next(sessionWith({ roundState: RoundState.BONUS_READING_PART }));
    fixture.detectChanges();
    dispatchKey(' ');
    expect(gameStateService.sendFinishedReadingBonusPart).toHaveBeenCalled();
  });

  it('Space does nothing while awaiting a buzz (no primary action defined)', () => {
    session$.next(sessionWith({ roundState: RoundState.AWAITING_BUZZ }));
    fixture.detectChanges();
    dispatchKey(' ');
    expect(gameStateService.sendFinishedReading).not.toHaveBeenCalled();
    expect(gameStateService.sendAdvanceRound).not.toHaveBeenCalled();
  });

  it('R marks the tossup correct while judging, and announces it', () => {
    session$.next(sessionWith({ roundState: RoundState.AWAITING_ANSWER, currentBuzz: { playerId: 'p1', teamId: 't1' } }));
    fixture.detectChanges();
    dispatchKey('r');
    expect(gameStateService.sendAnswerCorrect).toHaveBeenCalled();
    fixture.detectChanges();
    expect(liveAnnouncement()).toContain('correct');
  });

  it('W marks the tossup incorrect while judging', () => {
    session$.next(sessionWith({ roundState: RoundState.AWAITING_ANSWER, currentBuzz: { playerId: 'p1', teamId: 't1' } }));
    fixture.detectChanges();
    dispatchKey('W');
    expect(gameStateService.sendAnswerIncorrect).toHaveBeenCalled();
  });

  it('R/W are ignored outside AWAITING_ANSWER/BONUS_AWAITING_ANSWER', () => {
    session$.next(sessionWith({ roundState: RoundState.PROCTOR_READING }));
    fixture.detectChanges();
    dispatchKey('r');
    dispatchKey('w');
    expect(gameStateService.sendAnswerCorrect).not.toHaveBeenCalled();
    expect(gameStateService.sendAnswerIncorrect).not.toHaveBeenCalled();
  });

  it('R marks the current bonus part correct while judging it', () => {
    session$.next(sessionWith({ roundState: RoundState.BONUS_AWAITING_ANSWER, currentBonusPartIndex: 1 }));
    fixture.detectChanges();
    dispatchKey('r');
    expect(gameStateService.sendBonusPartOutcome).toHaveBeenCalledWith(1, true);
  });

  it('T times out the tossup while awaiting a buzz', () => {
    session$.next(sessionWith({ roundState: RoundState.AWAITING_BUZZ }));
    fixture.detectChanges();
    dispatchKey('t');
    expect(gameStateService.sendTimeoutRound).toHaveBeenCalled();
  });

  it('T times out the current bonus part while judging it', () => {
    session$.next(sessionWith({ roundState: RoundState.BONUS_AWAITING_ANSWER, currentBonusPartIndex: 0 }));
    fixture.detectChanges();
    dispatchKey('t');
    expect(gameStateService.sendTimeoutBonusPart).toHaveBeenCalled();
  });

  it('ignores every judge key while typing in a field', () => {
    session$.next(sessionWith({ roundState: RoundState.AWAITING_ANSWER, currentBuzz: { playerId: 'p1', teamId: 't1' } }));
    fixture.detectChanges();
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      dispatchKey('r', {}, input);
      expect(gameStateService.sendAnswerCorrect).not.toHaveBeenCalled();
    } finally {
      input.remove();
    }
  });

  it('ignores a held-down (repeat) key', () => {
    dispatchKey(' ', { repeat: true });
    expect(gameStateService.sendFinishedReading).not.toHaveBeenCalled();
  });

  it('ignores every judge key while a dialog is open', () => {
    session$.next(sessionWith({ roundState: RoundState.AWAITING_ANSWER, currentBuzz: { playerId: 'p1', teamId: 't1' } }));
    fixture.detectChanges();
    dialogEl = document.createElement('mat-dialog-container');
    document.body.appendChild(dialogEl);
    dispatchKey('r');
    expect(gameStateService.sendAnswerCorrect).not.toHaveBeenCalled();
  });

  // M5 S2-21: once a judgment is sent, the row goes pending until the
  // RoundState (or the buzz) actually changes, so a second click or key
  // press racing the server frame can't send the same judgment twice.
  it('a second R press does not send the same tossup judgment twice', () => {
    session$.next(sessionWith({ roundState: RoundState.AWAITING_ANSWER, currentBuzz: { playerId: 'p1', teamId: 't1' } }));
    fixture.detectChanges();
    dispatchKey('r');
    dispatchKey('r');
    expect(gameStateService.sendAnswerCorrect).toHaveBeenCalledTimes(1);
  });

  it('a second W press does not send the same bonus part judgment twice', () => {
    session$.next(sessionWith({ roundState: RoundState.BONUS_AWAITING_ANSWER, currentBonusPartIndex: 0 }));
    fixture.detectChanges();
    dispatchKey('w');
    dispatchKey('w');
    expect(gameStateService.sendBonusPartOutcome).toHaveBeenCalledTimes(1);
  });

  it('disables Right/Wrong once a tossup judgment is pending, and shows the verdict in the banner', () => {
    session$.next(sessionWith({ roundState: RoundState.AWAITING_ANSWER, currentBuzz: { playerId: 'p1', teamId: 't1' } }));
    fixture.detectChanges();
    dispatchKey('r');
    fixture.detectChanges();
    const rightBtn = (fixture.nativeElement as HTMLElement).querySelector('#right-btn') as HTMLButtonElement;
    const wrongBtn = (fixture.nativeElement as HTMLElement).querySelector('#wrong-btn') as HTMLButtonElement;
    expect(rightBtn.disabled).toBe(true);
    expect(wrongBtn.disabled).toBe(true);
    const banner = (fixture.nativeElement as HTMLElement).querySelector('.proctor-status')!.textContent!;
    // M5 S2-30: the pending copy is deliberately provisional - the send
    // hasn't been confirmed by a server frame yet, so it must not claim
    // "marked correct".
    expect(banner).toContain('Sending: Ada correct');
  });

  it('clears the pending judgment once the RoundState changes, allowing the next judgment', () => {
    session$.next(sessionWith({ roundState: RoundState.AWAITING_ANSWER, currentBuzz: { playerId: 'p1', teamId: 't1' } }));
    fixture.detectChanges();
    dispatchKey('r');
    fixture.detectChanges();

    session$.next(sessionWith({ roundState: RoundState.AWAITING_BUZZ }));
    fixture.detectChanges();
    session$.next(sessionWith({ roundState: RoundState.AWAITING_ANSWER, currentBuzz: { playerId: 'p2', teamId: 't1' } }));
    fixture.detectChanges();

    dispatchKey('w');
    expect(gameStateService.sendAnswerIncorrect).toHaveBeenCalled();
  });

  it('clears the pending judgment once a new buzz arrives in the same RoundState', () => {
    session$.next(sessionWith({ roundState: RoundState.AWAITING_ANSWER, currentBuzz: { playerId: 'p1', teamId: 't1' } }));
    fixture.detectChanges();
    dispatchKey('r');
    fixture.detectChanges();

    session$.next(sessionWith({ roundState: RoundState.AWAITING_ANSWER, currentBuzz: { playerId: 'p2', teamId: 't1' } }));
    fixture.detectChanges();

    dispatchKey('w');
    expect(gameStateService.sendAnswerIncorrect).toHaveBeenCalled();
  });
});

/**
 * M5 S2-30: the judgment latch used to clear only on a real RoundState/buzz
 * change, so a lost send (a rejected frame, a RATE_LIMITED soft drop, or a
 * reconnect that never brings a real change) left Right/Wrong/Timeout dead
 * until a reload. It now also clears on a bounded timeout and on any error
 * frame, with a plain recovery line shown only for those two paths - a
 * normal confirming frame stays silent about it.
 */
describe('GameProctorComponent judgment pending recovery (M5 S2-30)', () => {
  let fixture: ComponentFixture<GameProctorComponent>;
  let session$: BehaviorSubject<GameSession>;
  let gameStateService: jasmine.SpyObj<GameStateService>;
  let errors$: Subject<StompError>;

  function sessionWith(partial: Record<string, unknown>): GameSession {
    return {
      currentMatch: {
        currentRound: {
          roundNumber: 1,
          currentBonus: { preamble: 'p', bonusParts: [{}, {}] },
          currentBonusPartIndex: 0,
          bonusPartAnswers: [],
          bonusEligibleTeamId: 't1',
          ...partial,
        },
      },
    } as unknown as GameSession;
  }

  function dispatchKey(key: string): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }

  function banner(): string {
    return (fixture.nativeElement as HTMLElement).querySelector('.proctor-status')!.textContent!.trim();
  }

  function rightBtn(): HTMLButtonElement {
    return (fixture.nativeElement as HTMLElement).querySelector('#right-btn') as HTMLButtonElement;
  }

  beforeEach(() => {
    jasmine.clock().install();
    session$ = new BehaviorSubject<GameSession>(
      sessionWith({ roundState: RoundState.AWAITING_ANSWER, currentBuzz: { playerId: 'p1', teamId: 't1' } }),
    );
    errors$ = new Subject<StompError>();
    gameStateService = jasmine.createSpyObj<GameStateService>(
      'GameStateService',
      [
        'getTeamNameById', 'getPlayerNameById', 'getCurrentRoundBonusPoints', 'getCurrentRoundMaxBonusPoints',
        'sendAnswerCorrect', 'sendAnswerIncorrect', 'sendBonusPartOutcome',
      ],
      { gameSession$: session$.asObservable(), errors$: errors$.asObservable() },
    );
    gameStateService.getPlayerNameById.and.returnValue('Ada');

    TestBed.configureTestingModule({
      declarations: [GameProctorComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        {
          provide: PresentationConnectionService,
          useValue: { isAvailable$: of(false), connectionState$: of(PresentationConnectionState.DISCONNECTED) },
        },
        { provide: CastStateService, useValue: {} },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(GameProctorComponent);
    fixture.detectChanges();
  });

  afterEach(() => jasmine.clock().uninstall());

  it('clears after ~5s with no confirming frame, and shows the recovery line', () => {
    dispatchKey('r');
    fixture.detectChanges();
    expect(rightBtn().disabled).toBe(true);

    jasmine.clock().tick(4999);
    fixture.detectChanges();
    expect(rightBtn().disabled).toBe(true);

    jasmine.clock().tick(1);
    fixture.detectChanges();
    expect(rightBtn().disabled).toBe(false);
    expect(banner()).toContain("Didn't reach the server. Judge again.");
  });

  it('clears immediately on any error frame, and shows the recovery line', () => {
    dispatchKey('r');
    fixture.detectChanges();

    errors$.next({ code: 'INTERNAL', fatal: false } as StompError);
    fixture.detectChanges();

    expect(rightBtn().disabled).toBe(false);
    expect(banner()).toContain("Didn't reach the server. Judge again.");
  });

  it('clears on a normal confirming frame with no recovery line', () => {
    dispatchKey('r');
    fixture.detectChanges();
    expect(banner()).toContain('Sending: Ada correct');

    session$.next(sessionWith({ roundState: RoundState.COMPLETED }));
    fixture.detectChanges();

    expect(banner()).not.toContain("Didn't reach the server");
    expect(banner()).not.toContain('Sending:');
  });

  it('a judgment retried after a lost-send recovery sends normally', () => {
    dispatchKey('r');
    fixture.detectChanges();
    jasmine.clock().tick(5000);
    fixture.detectChanges();

    dispatchKey('w');
    expect(gameStateService.sendAnswerIncorrect).toHaveBeenCalled();
  });
});

/**
 * M5 S2-31: a ~600ms lockout follows every state-changing send (advance,
 * finished reading, tossup/bonus timeout), so a double Space/Enter/T can't
 * also fire the *next* round's action once the server frame from the first
 * send arrives a few hundred ms later.
 */
describe('GameProctorComponent action lockout (M5 S2-31)', () => {
  let fixture: ComponentFixture<GameProctorComponent>;
  let session$: BehaviorSubject<GameSession>;
  let gameStateService: jasmine.SpyObj<GameStateService>;

  function sessionWith(partial: Record<string, unknown>): GameSession {
    return {
      currentMatch: {
        currentRound: {
          roundNumber: 1,
          currentBonus: { preamble: 'p', bonusParts: [{}, {}] },
          currentBonusPartIndex: 0,
          bonusPartAnswers: [],
          bonusEligibleTeamId: 't1',
          ...partial,
        },
      },
    } as unknown as GameSession;
  }

  function dispatchKey(key: string): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }

  beforeEach(() => {
    jasmine.clock().install();
    session$ = new BehaviorSubject<GameSession>(sessionWith({ roundState: RoundState.COMPLETED }));
    gameStateService = jasmine.createSpyObj<GameStateService>(
      'GameStateService',
      [
        'getTeamNameById', 'getPlayerNameById', 'getCurrentRoundBonusPoints', 'getCurrentRoundMaxBonusPoints',
        'sendAdvanceRound', 'sendFinishedReading', 'sendTimeoutRound', 'sendTimeoutBonusPart',
      ],
      { gameSession$: session$.asObservable(), errors$: new Subject<StompError>().asObservable() },
    );

    TestBed.configureTestingModule({
      declarations: [GameProctorComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        {
          provide: PresentationConnectionService,
          useValue: { isAvailable$: of(false), connectionState$: of(PresentationConnectionState.DISCONNECTED) },
        },
        { provide: CastStateService, useValue: {} },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(GameProctorComponent);
    fixture.detectChanges();
  });

  afterEach(() => jasmine.clock().uninstall());

  it('a second Space 200ms later, once the frame has moved on, sends exactly one advance and no finished-reading', () => {
    dispatchKey(' ');
    expect(gameStateService.sendAdvanceRound).toHaveBeenCalledTimes(1);

    // The server frame that follows the advance lands mid-lockout.
    jasmine.clock().tick(200);
    session$.next(sessionWith({ roundState: RoundState.PROCTOR_READING }));
    fixture.detectChanges();

    dispatchKey(' ');
    expect(gameStateService.sendFinishedReading).not.toHaveBeenCalled();
    expect(gameStateService.sendAdvanceRound).toHaveBeenCalledTimes(1);
  });

  it('a Space after the lockout window sends the next action normally', () => {
    dispatchKey(' ');
    expect(gameStateService.sendAdvanceRound).toHaveBeenCalledTimes(1);

    jasmine.clock().tick(600);
    session$.next(sessionWith({ roundState: RoundState.PROCTOR_READING }));
    fixture.detectChanges();

    dispatchKey(' ');
    expect(gameStateService.sendFinishedReading).toHaveBeenCalledTimes(1);
  });

  it('a double T sends one tossup timeout', () => {
    session$.next(sessionWith({ roundState: RoundState.AWAITING_BUZZ }));
    fixture.detectChanges();

    dispatchKey('t');
    dispatchKey('t');
    expect(gameStateService.sendTimeoutRound).toHaveBeenCalledTimes(1);
  });

  it('a double T sends one bonus timeout', () => {
    session$.next(sessionWith({ roundState: RoundState.BONUS_AWAITING_ANSWER }));
    fixture.detectChanges();

    dispatchKey('t');
    dispatchKey('t');
    expect(gameStateService.sendTimeoutBonusPart).toHaveBeenCalledTimes(1);
  });
});

/**
 * M5 S2-34: an extreme-length (100+ char) player or team name must not push
 * the pinned decision row out of view. The CSS clamp (ellipsis) is a visual
 * property Karma can't measure headlessly, but the `title` attribute
 * carrying the full, unclamped name is exactly what a screen reader or a
 * hovering pointer falls back to, and it's assertable here.
 */
describe('GameProctorComponent extreme-length buzz names (M5 S2-34)', () => {
  let fixture: ComponentFixture<GameProctorComponent>;

  const LONG_NAME = 'A'.repeat(120);

  function sessionWith(currentBuzz: unknown): GameSession {
    return {
      currentMatch: {
        currentRound: {
          roundState: RoundState.AWAITING_ANSWER,
          roundNumber: 1,
          currentBuzz,
          currentBonus: { preamble: 'p', bonusParts: [] },
          currentBonusPartIndex: 0,
          bonusPartAnswers: [],
          bonusEligibleTeamId: 't1',
        },
      },
    } as unknown as GameSession;
  }

  beforeEach(() => {
    const session$ = new BehaviorSubject<GameSession>(sessionWith({ playerId: 'p1', teamId: 't1' }));
    const gameStateService = jasmine.createSpyObj<GameStateService>(
      'GameStateService',
      ['getTeamNameById', 'getPlayerNameById', 'getCurrentRoundBonusPoints', 'getCurrentRoundMaxBonusPoints'],
      { gameSession$: session$.asObservable() },
    );
    gameStateService.getPlayerNameById.and.returnValue(LONG_NAME);
    gameStateService.getTeamNameById.and.returnValue(LONG_NAME);

    TestBed.configureTestingModule({
      declarations: [GameProctorComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        {
          provide: PresentationConnectionService,
          useValue: { isAvailable$: of(false), connectionState$: of(PresentationConnectionState.DISCONNECTED) },
        },
        { provide: CastStateService, useValue: {} },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(GameProctorComponent);
    fixture.detectChanges();
  });

  it('carries the full player and team name in title on the clamped buzz block', () => {
    const root = fixture.nativeElement as HTMLElement;
    const nameEl = root.querySelector('.active-buzz-info .buzz-name') as HTMLElement;
    const teamEl = root.querySelector('.active-buzz-info .buzz-team') as HTMLElement;
    expect(nameEl.title).toBe(LONG_NAME);
    expect(teamEl.title).toBe(LONG_NAME);
  });
});
