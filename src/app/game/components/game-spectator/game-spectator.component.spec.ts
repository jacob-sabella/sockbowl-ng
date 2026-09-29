import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { GameSpectatorComponent } from './game-spectator.component';
import { GameStateService } from '../../services/game-state.service';
import { SpeechService } from '../../services/speech.service';
import { GameSession, RoundState } from '../../models/sockbowl/sockbowl-interfaces';

/**
 * M5 S1-27: the spectator view is the room's projector view. It used to lead
 * with the "Spectator Mode" title and the Teams roster, pushing the live
 * round below the fold on mobile and below the team cards on a projector.
 * Current Round now comes first in DOM order, the title is a compact label,
 * and >=1024px puts the round and the teams side by side.
 */
describe('GameSpectatorComponent round-first layout (M5 S1-27)', () => {
  let fixture: ComponentFixture<GameSpectatorComponent>;
  let gameSession$: Subject<GameSession>;

  beforeEach(() => {
    gameSession$ = new Subject<GameSession>();
    localStorage.removeItem('sockbowl_reading_speed');
    localStorage.removeItem('spectator_reader');

    TestBed.configureTestingModule({
      declarations: [GameSpectatorComponent],
      providers: [
        { provide: GameStateService, useValue: { gameSession$ } },
        { provide: SpeechService, useValue: { available: false, speak: jasmine.createSpy('speak'), cancel: jasmine.createSpy('cancel') } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(GameSpectatorComponent);

    fixture.detectChanges();
    gameSession$.next({
      currentMatch: {
        currentRound: {
          roundState: RoundState.AWAITING_BUZZ,
          roundNumber: 1,
          category: 'History',
          buzzList: [],
        },
        previousRounds: [],
        packet: { tossups: [] },
      },
      teamList: [
        { teamId: 't1', teamName: 'Team Alpha', teamPlayers: [] },
        { teamId: 't2', teamName: 'Team Beta', teamPlayers: [] },
      ],
    } as unknown as GameSession);
    fixture.detectChanges();
  });

  it('keeps "Spectator Mode" as an h1 (heading order holds)', () => {
    const h1 = (fixture.nativeElement as HTMLElement).querySelector('h1.spectator-title');
    expect(h1).not.toBeNull();
    expect(h1?.textContent).toContain('Spectator Mode');
  });

  it('renders Current Round before Teams in DOM order', () => {
    const root = fixture.nativeElement as HTMLElement;
    const roundSection = root.querySelector('.current-round-section');
    const teamsSection = root.querySelector('.teams-section');

    expect(roundSection).not.toBeNull();
    expect(teamsSection).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING (4) means teamsSection comes after roundSection.
    // eslint-disable-next-line no-bitwise
    expect(roundSection!.compareDocumentPosition(teamsSection!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps both sections inside the shared >=1024px layout wrapper', () => {
    const root = fixture.nativeElement as HTMLElement;
    const wrapper = root.querySelector('.spectator-main');
    expect(wrapper?.querySelector('.current-round-section')).not.toBeNull();
    expect(wrapper?.querySelector('.teams-section')).not.toBeNull();
  });

  it('still shows the teams (N-3: keep the spectator\'s own team cards)', () => {
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Team Alpha');
    expect(root.textContent).toContain('Team Beta');
  });
});
