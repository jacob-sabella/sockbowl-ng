import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TeamListComponent } from './team-list.component';
import { GameStateService } from '../../services/game-state.service';
import { Team } from '../../models/sockbowl/sockbowl-interfaces';

describe('TeamListComponent', () => {
  let fixture: ComponentFixture<TeamListComponent>;
  let component: TeamListComponent;
  let gameStateService: jasmine.SpyObj<GameStateService>;

  function team(teamId: string, teamName: string, playerCount: number): Team {
    return {
      teamId,
      teamName,
      teamPlayers: Array.from({ length: playerCount }, (_, i) => ({
        playerId: `${teamId}-p${i}`,
        name: `Player ${i}`,
        playerMode: 'BUZZER',
        playerStatus: 'CONNECTED',
        gameOwner: false,
      })),
    } as unknown as Team;
  }

  beforeEach(() => {
    gameStateService = jasmine.createSpyObj<GameStateService>('GameStateService', ['getCurrentPlayer']);
    gameStateService.getCurrentPlayer.and.returnValue(undefined);

    TestBed.configureTestingModule({
      declarations: [TeamListComponent],
      providers: [{ provide: GameStateService, useValue: gameStateService }],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(TeamListComponent);
    component = fixture.componentInstance;
    component.teams = [team('t1', 'Team A', 2), team('t2', 'Team B', 0)];
    // `currentBuzz`/`currentRound` are `@Input()!` (definite assignment) —
    // every template read of them is already guarded (`this.currentRound &&
    // ...`), so leaving them genuinely unset (as a real caller with no
    // active round would) exercises the same guards without a fake `any`.
    component.previousRoundList = [];
    fixture.detectChanges();
  });

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  /**
   * S3-13/S3-05: the outer container is a real `role="list"` (each
   * `mat-list` an item of it), so `mat-list`'s own internal `role="listitem"`
   * needs its own `role="list"` ancestor for the player rows underneath it,
   * not the outer list's `listitem` directly — otherwise axe flags nested
   * and conflicting list semantics (team-list.component.html:1 over
   * `mat-list`'s own role, r3's addition to S3-13).
   */
  it('wraps each roster in its own role="list", not directly under the team role="listitem"', () => {
    const el: HTMLElement = fixture.nativeElement;
    const outerList = el.querySelector('.team-lists-container');
    expect(outerList?.getAttribute('role')).toBe('list');

    const teamListItem = el.querySelector('mat-list.team-list');
    expect(teamListItem?.getAttribute('role')).toBe('listitem');

    // The roster wrapper is a role="list" child of the team's own listitem...
    const roster = teamListItem?.querySelector(':scope > div[role="list"]');
    expect(roster).withContext('roster wrapper should be a direct child of mat-list').not.toBeNull();
    expect(roster?.getAttribute('aria-label')).toBe('Team A roster');

    // ...and every player row is a role="listitem" inside that roster, not a
    // second, more deeply nested listitem sitting directly under the first.
    const rows = roster?.querySelectorAll('mat-list-item');
    expect(rows?.length).toBe(2);
    rows?.forEach(row => expect(row.getAttribute('role')).toBe('listitem'));
  });

  it('renders no roster wrapper for an empty team (no players to list)', () => {
    const el: HTMLElement = fixture.nativeElement;
    const teamBLists = Array.from(el.querySelectorAll('mat-list.team-list'));
    const teamB = teamBLists.find(l => l.textContent?.includes('Team B'));

    expect(teamB?.querySelector('div[role="list"]')).toBeNull();
    expect(teamB?.textContent).toContain('No players yet');
  });
});
