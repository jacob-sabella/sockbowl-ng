import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReplaySubject } from 'rxjs';

import { GameBuzzerComponent } from './game-buzzer.component';
import { GameStateService } from '../../services/game-state.service';
import { GameSession, RoundState } from '../../models/sockbowl/sockbowl-interfaces';

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
      providers: [{ provide: GameStateService, useValue: gameStateService }],
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
