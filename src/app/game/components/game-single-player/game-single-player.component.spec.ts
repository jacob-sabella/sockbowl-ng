import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { GameSinglePlayerComponent } from './game-single-player.component';
import { GameStateService } from '../../services/game-state.service';
import { SpeechService } from '../../services/speech.service';
import { GameSession, RoundState } from '../../models/sockbowl/sockbowl-interfaces';

/**
 * M5 S1-17: before the server's text starts streaming in, the question well
 * used to render as a conspicuously empty box. It now shows a reading
 * placeholder (reusing the shared `.waiting-hint` style already used
 * elsewhere on this card) until the first word arrives.
 */
describe('GameSinglePlayerComponent reading placeholder (M5 S1-17)', () => {
  let fixture: ComponentFixture<GameSinglePlayerComponent>;
  let component: GameSinglePlayerComponent;
  let gameSession$: Subject<GameSession>;

  beforeEach(() => {
    gameSession$ = new Subject<GameSession>();
    localStorage.removeItem('sockbowl_reading_speed');
    localStorage.removeItem('solo_read_aloud');

    TestBed.configureTestingModule({
      declarations: [GameSinglePlayerComponent],
      providers: [
        { provide: GameStateService, useValue: { gameSession$, playerSessionId: 'p1' } },
        { provide: SpeechService, useValue: { available: false, speak: jasmine.createSpy('speak'), cancel: jasmine.createSpy('cancel') } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(GameSinglePlayerComponent);
    component = fixture.componentInstance;
  });

  function session(question: string, roundNumber = 1): GameSession {
    return {
      currentMatch: {
        currentRound: { roundState: RoundState.AWAITING_BUZZ, roundNumber, question, buzzList: [] },
        previousRounds: [],
        packet: { tossups: [] },
      },
      teamList: [],
    } as unknown as GameSession;
  }

  it('shows the reading placeholder before any word has been revealed', () => {
    fixture.detectChanges();
    gameSession$.next(session('A long tossup question about history.'));
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.waiting-hint')?.textContent).toContain('Reading…');
    expect(root.querySelector('.reveal-cursor')).toBeNull();
  });

  it('replaces the placeholder with the revealed text once words start streaming', () => {
    jasmine.clock().install();
    try {
      fixture.detectChanges();
      gameSession$.next(session('Alpha bravo charlie delta.'));
      fixture.detectChanges();

      jasmine.clock().tick(3000); // well past enough ticks to reveal at least one word
      fixture.detectChanges();

      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('.waiting-hint')).toBeNull();
      expect(root.textContent).toContain('Alpha');
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('has no question text at all before gameSession$ has emitted', () => {
    fixture.detectChanges();

    expect(component.round).toBeUndefined();
    expect((fixture.nativeElement as HTMLElement).querySelector('.game-proctor')).toBeNull();
  });
});

/**
 * M5 S1-32: same anchored-footer treatment as game-auto-proctor (see its
 * spec for the full rationale) — solo's buzz-btn must not drift as the
 * question streams in above it.
 */
describe('GameSinglePlayerComponent anchored buzz footer (M5 S1-32)', () => {
  let fixture: ComponentFixture<GameSinglePlayerComponent>;
  let gameSession$: Subject<GameSession>;

  beforeEach(() => {
    gameSession$ = new Subject<GameSession>();
    localStorage.removeItem('sockbowl_reading_speed');
    localStorage.removeItem('solo_read_aloud');

    TestBed.configureTestingModule({
      declarations: [GameSinglePlayerComponent],
      providers: [
        { provide: GameStateService, useValue: { gameSession$, playerSessionId: 'p1' } },
        { provide: SpeechService, useValue: { available: false, speak: jasmine.createSpy('speak'), cancel: jasmine.createSpy('cancel') } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(GameSinglePlayerComponent);

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
