import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { GameAutoProctorComponent } from './game-auto-proctor.component';
import { GameStateService } from '../../services/game-state.service';
import { SpeechService } from '../../services/speech.service';
import { GameSession, RoundState } from '../../models/sockbowl/sockbowl-interfaces';

/**
 * M5 S1-17: the auto-proctor question well is server-driven (revealedText is
 * `round.question` directly, no local reveal timer), so an empty string
 * persists until the server's first reveal chunk arrives. It now shows the
 * same reading placeholder as solo play instead of a conspicuously empty box.
 */
describe('GameAutoProctorComponent reading placeholder (M5 S1-17)', () => {
  let fixture: ComponentFixture<GameAutoProctorComponent>;
  let component: GameAutoProctorComponent;
  let gameSession$: Subject<GameSession>;
  let gameStateService: any;

  beforeEach(() => {
    gameSession$ = new Subject<GameSession>();
    localStorage.removeItem('ap_reader_mode');

    gameStateService = {
      gameSession$,
      playerSessionId: 'p1',
      isSelfOnAnyTeam: () => true,
      hasCurrentPlayerTeamBuzzed: () => false,
      isCurrentPlayerGameOwner: () => false,
      isFreeForAll: () => false,
      getPlayerNameById: () => undefined,
      getTeamNameById: () => undefined,
    };

    TestBed.configureTestingModule({
      declarations: [GameAutoProctorComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        { provide: SpeechService, useValue: { available: false, speak: jasmine.createSpy('speak'), cancel: jasmine.createSpy('cancel') } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(GameAutoProctorComponent);
    component = fixture.componentInstance;
  });

  function session(question: string, revealedWordCount: number, totalWordCount: number): GameSession {
    return {
      currentMatch: {
        currentRound: {
          roundState: RoundState.AWAITING_BUZZ,
          roundNumber: 1,
          question,
          revealedWordCount,
          totalWordCount,
          buzzList: [],
        },
        previousRounds: [],
        packet: { tossups: [] },
      },
      teamList: [],
    } as unknown as GameSession;
  }

  it('shows the reading placeholder while the server has revealed no text yet', () => {
    fixture.detectChanges();
    gameSession$.next(session('', 0, 12));
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.waiting-hint')?.textContent).toContain('Reading…');
    expect(root.querySelector('.reveal-cursor')).toBeNull();
  });

  it('shows the revealed text (and cursor) once the server has streamed some words', () => {
    fixture.detectChanges();
    gameSession$.next(session('Alpha bravo charlie', 3, 12));
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.waiting-hint')).toBeNull();
    expect(root.textContent).toContain('Alpha bravo charlie');
    expect(root.querySelector('.reveal-cursor')).not.toBeNull();
  });

  it('has no question card at all before gameSession$ has emitted', () => {
    fixture.detectChanges();

    expect(component.round).toBeUndefined();
    expect((fixture.nativeElement as HTMLElement).querySelector('.game-proctor')).toBeNull();
  });
});

/**
 * M5 S1-32: the buzz control used to sit under the streaming question text
 * and drift down the page as it grew. `.button-container` (which the
 * buzz-btn is always inside, whichever control is currently showing) is now
 * an anchored, sticky footer instead.
 */
describe('GameAutoProctorComponent anchored buzz footer (M5 S1-32)', () => {
  let fixture: ComponentFixture<GameAutoProctorComponent>;
  let gameSession$: Subject<GameSession>;

  beforeEach(() => {
    gameSession$ = new Subject<GameSession>();
    localStorage.removeItem('ap_reader_mode');

    TestBed.configureTestingModule({
      declarations: [GameAutoProctorComponent],
      providers: [
        {
          provide: GameStateService,
          useValue: {
            gameSession$,
            playerSessionId: 'p1',
            isSelfOnAnyTeam: () => true,
            hasCurrentPlayerTeamBuzzed: () => false,
            isCurrentPlayerGameOwner: () => false,
            isFreeForAll: () => false,
            getPlayerNameById: () => undefined,
            getTeamNameById: () => undefined,
          },
        },
        { provide: SpeechService, useValue: { available: false, speak: jasmine.createSpy('speak'), cancel: jasmine.createSpy('cancel') } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(GameAutoProctorComponent);

    fixture.detectChanges();
    gameSession$.next({
      currentMatch: {
        currentRound: {
          roundState: RoundState.AWAITING_BUZZ,
          roundNumber: 1,
          question: 'A long streaming question that keeps growing as it is read aloud.',
          buzzList: [],
        },
        previousRounds: [],
        packet: { tossups: [] },
      },
      teamList: [],
    } as unknown as GameSession);
    fixture.detectChanges();
  });

  it('keeps the buzz-btn inside the anchored .button-container', () => {
    const root = fixture.nativeElement as HTMLElement;
    const footer = root.querySelector('.button-container');
    expect(footer?.querySelector('.buzz-btn')).not.toBeNull();
  });

  it('anchors .button-container to the bottom of the card instead of the natural document flow', () => {
    const footer = (fixture.nativeElement as HTMLElement).querySelector('.button-container') as HTMLElement;
    expect(getComputedStyle(footer).position).toBe('sticky');
    expect(getComputedStyle(footer).bottom).toBe('0px');
  });

  it('gives the buzz-btn at least a 56px tap target', () => {
    const buzzBtn = (fixture.nativeElement as HTMLElement).querySelector('.buzz-btn') as HTMLElement;
    expect(parseFloat(getComputedStyle(buzzBtn).minHeight)).toBeGreaterThanOrEqual(56);
  });
});

/**
 * M5 S1-07: Space or Enter buzzes from anywhere on the page while buzzing is
 * possible, matching the classic buzzer and solo.
 */
describe('GameAutoProctorComponent global Space/Enter buzz (M5 S1-07)', () => {
  let fixture: ComponentFixture<GameAutoProctorComponent>;
  let gameSession$: Subject<GameSession>;
  let gameStateService: any;

  function dispatchKey(key: string, target: EventTarget = document.body, extra: Partial<KeyboardEventInit> = {}): void {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
    target.dispatchEvent(event);
  }

  beforeEach(() => {
    gameSession$ = new Subject<GameSession>();
    localStorage.removeItem('ap_reader_mode');

    gameStateService = {
      gameSession$,
      playerSessionId: 'p1',
      isSelfOnAnyTeam: () => true,
      hasCurrentPlayerTeamBuzzed: () => false,
      isCurrentPlayerGameOwner: () => false,
      isFreeForAll: () => false,
      getPlayerNameById: () => undefined,
      getTeamNameById: () => undefined,
      sendPlayerIncomingBuzz: jasmine.createSpy('sendPlayerIncomingBuzz'),
    };

    TestBed.configureTestingModule({
      declarations: [GameAutoProctorComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        { provide: SpeechService, useValue: { available: false, speak: jasmine.createSpy('speak'), cancel: jasmine.createSpy('cancel') } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(GameAutoProctorComponent);
    fixture.detectChanges();
    gameSession$.next({
      currentMatch: {
        currentRound: { roundState: RoundState.AWAITING_BUZZ, roundNumber: 1, question: 'Reading…', buzzList: [] },
        previousRounds: [],
        packet: { tossups: [] },
      },
      teamList: [],
    } as unknown as GameSession);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('buzzes once on a document-level Space press', () => {
    dispatchKey(' ');
    expect(gameStateService.sendPlayerIncomingBuzz).toHaveBeenCalledTimes(1);
  });

  it('ignores Space typed into a text input', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      dispatchKey(' ', input);
      expect(gameStateService.sendPlayerIncomingBuzz).not.toHaveBeenCalled();
    } finally {
      input.remove();
    }
  });

  it('ignores a repeated (held-down) key', () => {
    dispatchKey(' ', document.body, { repeat: true });
    expect(gameStateService.sendPlayerIncomingBuzz).not.toHaveBeenCalled();
  });

  it('ignores Space once the team has already buzzed', () => {
    gameStateService.hasCurrentPlayerTeamBuzzed = () => true;
    dispatchKey(' ');
    expect(gameStateService.sendPlayerIncomingBuzz).not.toHaveBeenCalled();
  });
});

/**
 * Every wait in auto-judged play is the server's clock: the countdowns render
 * TimerUpdate-fed round fields, and no client (not even the host's) runs its
 * own timer or advances the game when one reaches zero.
 */
describe('GameAutoProctorComponent server-driven countdowns', () => {
  let fixture: ComponentFixture<GameAutoProctorComponent>;
  let gameSession$: Subject<GameSession>;
  let gameStateService: any;

  beforeEach(() => {
    gameSession$ = new Subject<GameSession>();
    localStorage.removeItem('ap_reader_mode');
    gameStateService = {
      gameSession$,
      playerSessionId: 'p1',
      isSelfOnAnyTeam: () => true,
      hasCurrentPlayerTeamBuzzed: () => true,
      isCurrentPlayerGameOwner: () => true,
      isFreeForAll: () => false,
      getPlayerNameById: () => 'Bea',
      getTeamNameById: () => undefined,
      sendAdvanceRound: jasmine.createSpy('sendAdvanceRound'),
    };
    TestBed.configureTestingModule({
      declarations: [GameAutoProctorComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        { provide: SpeechService, useValue: { available: false, speak: jasmine.createSpy('speak'), cancel: jasmine.createSpy('cancel') } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(GameAutoProctorComponent);
  });

  function emit(round: any): void {
    gameSession$.next({
      currentMatch: { currentRound: { roundNumber: 1, question: 'q', buzzList: [], ...round }, previousRounds: [], packet: { tossups: [] } },
      teamList: [],
      playerList: [],
    } as unknown as GameSession);
    fixture.detectChanges();
  }

  const text = () => (fixture.nativeElement as HTMLElement).textContent || '';

  it('shows the answer window to the room while someone else is answering', () => {
    fixture.detectChanges();
    emit({ roundState: RoundState.AWAITING_ANSWER, currentBuzz: { playerId: 'p2', teamId: 't2' }, remainingAnswerTimerSeconds: 7 });
    expect(text()).toContain('7 seconds left to answer');
  });

  it('shows the answer window to the player who buzzed', () => {
    fixture.detectChanges();
    emit({ roundState: RoundState.AWAITING_ANSWER, currentBuzz: { playerId: 'p1', teamId: 't1' }, remainingAnswerTimerSeconds: 4 });
    expect(text()).toContain('4 seconds left to answer');
  });

  it('shows the bonus part countdown', () => {
    fixture.detectChanges();
    emit({ roundState: RoundState.BONUS_AWAITING_ANSWER, bonusEligibleTeamId: 't9', currentBonusPartIndex: 0,
      currentBonus: { preamble: '', bonusParts: [] }, remainingBonusTimerSeconds: 5 });
    expect(text()).toContain('5 seconds left on this part');
  });

  it('renders the server advance countdown and never advances on its own, even for the host', fakeAsync(() => {
    fixture.detectChanges();
    emit({ roundState: RoundState.COMPLETED, remainingAdvanceSeconds: 3 });
    expect(text()).toContain('Next tossup in 3s');

    tick(10_000);
    emit({ roundState: RoundState.COMPLETED, remainingAdvanceSeconds: 0 });
    tick(10_000);
    expect(gameStateService.sendAdvanceRound).not.toHaveBeenCalled();
  }));
});
