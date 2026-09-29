import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, ReplaySubject } from 'rxjs';

import { MatchSummaryComponent } from './match-summary.component';
import { GameStateService } from '../../services/game-state.service';
import { ConfirmDialogService } from '../../../shared/confirm-dialog/confirm-dialog.service';
import { GameSession } from '../../models/sockbowl/sockbowl-interfaces';

/**
 * M5 S1-26: "Start New Match" used to call `endMatch()` directly from every
 * seat, ending the match for the whole room on a single click. It now
 * confirms first through the shared confirm-dialog (F1), and only calls
 * `endMatch()` when the confirmation resolves `true`.
 */
describe('MatchSummaryComponent end-match confirmation (M5 S1-26)', () => {
  let fixture: ComponentFixture<MatchSummaryComponent>;
  let session$: ReplaySubject<GameSession>;
  let gameStateService: jasmine.SpyObj<GameStateService>;
  let confirmDialogService: jasmine.SpyObj<ConfirmDialogService>;

  function baseSession(): GameSession {
    return {
      currentMatch: {
        currentRound: { currentBuzz: undefined },
        previousRounds: [],
      },
      teamList: [],
      playerList: [],
    } as unknown as GameSession;
  }

  function newMatchButton(): HTMLButtonElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector('.new-match-button');
  }

  function setUp(confirmed: boolean): void {
    session$ = new ReplaySubject<GameSession>(1);
    gameStateService = jasmine.createSpyObj<GameStateService>(
      'GameStateService',
      ['endMatch'],
      { gameSession$: session$.asObservable() },
    );
    confirmDialogService = jasmine.createSpyObj<ConfirmDialogService>('ConfirmDialogService', ['confirm']);
    confirmDialogService.confirm.and.returnValue(of(confirmed));

    TestBed.configureTestingModule({
      declarations: [MatchSummaryComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        { provide: ConfirmDialogService, useValue: confirmDialogService },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(MatchSummaryComponent);
    fixture.componentInstance.ngOnInit();
    session$.next(baseSession());
    fixture.detectChanges();
  }

  it('does not end the match on click alone: the confirm dialog is asked first', () => {
    setUp(true);

    newMatchButton()?.click();

    expect(confirmDialogService.confirm).toHaveBeenCalledTimes(1);
    const data = confirmDialogService.confirm.calls.mostRecent().args[0];
    expect(data.title).toContain('Start a new match');
    expect(data.message).toMatch(/ends the current match for everyone/i);
  });

  it('calls endMatch exactly once when the dialog is confirmed', () => {
    setUp(true);

    newMatchButton()?.click();

    expect(gameStateService.endMatch).toHaveBeenCalledTimes(1);
  });

  it('does not call endMatch when the dialog is canceled', () => {
    setUp(false);

    newMatchButton()?.click();

    expect(gameStateService.endMatch).not.toHaveBeenCalled();
  });
});
