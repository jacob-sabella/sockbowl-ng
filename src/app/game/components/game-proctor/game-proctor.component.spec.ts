import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';

import { GameProctorComponent } from './game-proctor.component';
import { GameStateService } from '../../services/game-state.service';
import { PresentationConnectionService } from '../../services/presentation-connection.service';
import { CastStateService } from '../../services/cast-state.service';
import { GameSession, RoundState } from '../../models/sockbowl/sockbowl-interfaces';
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
