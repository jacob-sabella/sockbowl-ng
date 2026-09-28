import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReplaySubject, Subject } from 'rxjs';

import { GameBuzzerComponent } from './game-buzzer.component';
import { GameStateService } from '../../services/game-state.service';
import { GameWebSocketService } from '../../services/game-web-socket.service';
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
        { provide: GameWebSocketService, useValue: { errors$: errors$.asObservable() } },
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
      ],
      { gameSession$: session$.asObservable() },
    );
    gameStateService.getTeamNameById.and.returnValue('Team One');

    TestBed.configureTestingModule({
      declarations: [GameBuzzerComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        // M4-UI-02: the buzzer listens for stomp-buzz RATE_LIMITED errors.
        { provide: GameWebSocketService, useValue: { errors$: new Subject<StompError>().asObservable() } },
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
});
