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
