import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
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
