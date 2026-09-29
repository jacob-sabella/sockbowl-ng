import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';

import { CastStateService } from './cast-state.service';
import { GameStateService } from './game-state.service';
import { PresentationConnectionService } from './presentation-connection.service';
import { ThemeService } from '../../core/services/theme.service';
import { PresentationConnectionState } from '../models/cast-interfaces';
import { GameSession, MatchState, RoundState } from '../models/sockbowl/sockbowl-interfaces';

/**
 * M5 S2-32: the TV used to say "Round N" while the proctor's own header says
 * "Tossup N of M" (from `currentMatch.packet.tossups.length`, the same
 * source `GameProctorComponent.getTotalTossupCount()` reads). The cast
 * state now carries that total so the receiver can use the same words.
 */
describe('CastStateService total tossup count (M5 S2-32)', () => {
  function sessionWith(tossupCount: number | undefined): GameSession {
    return {
      teamList: [],
      currentMatch: {
        matchState: MatchState.IN_GAME,
        packet: tossupCount !== undefined ? { tossups: new Array(tossupCount).fill({}) } : undefined,
        previousRounds: [],
        currentRound: {
          roundNumber: 3,
          roundState: RoundState.AWAITING_BUZZ,
          category: '',
          subcategory: '',
          question: '',
          answer: '',
          currentBuzz: null,
          buzzList: [],
        },
      },
    } as unknown as GameSession;
  }

  function setup(session: GameSession): jasmine.Spy {
    const connectionState$ = new Subject<PresentationConnectionState>();
    const sendGameState = jasmine.createSpy('sendGameState');

    TestBed.configureTestingModule({
      providers: [
        CastStateService,
        {
          provide: GameStateService,
          useValue: {
            gameSession$: of(session),
            isSelfProctor: () => true,
            getProctor: () => null,
            getPlayerNameById: () => '',
            getTeamNameById: () => '',
          },
        },
        {
          provide: PresentationConnectionService,
          useValue: {
            connectionState$,
            sendGameState,
            stopPresentation: () => undefined,
          },
        },
        { provide: ThemeService, useValue: { resolvedTheme$: of('dark') } },
      ],
    });

    TestBed.inject(CastStateService);
    connectionState$.next(PresentationConnectionState.CONNECTED);
    return sendGameState;
  }

  it('carries the packet tossup total alongside the round number', () => {
    const sendGameState = setup(sessionWith(24));
    expect(sendGameState).toHaveBeenCalled();
    const sent = sendGameState.calls.mostRecent().args[0];
    expect(sent.roundNumber).toBe(3);
    expect(sent.totalTossups).toBe(24);
  });

  it('sends a null total when the packet has not arrived', () => {
    const sendGameState = setup(sessionWith(undefined));
    const sent = sendGameState.calls.mostRecent().args[0];
    expect(sent.totalTossups).toBeNull();
  });
});
