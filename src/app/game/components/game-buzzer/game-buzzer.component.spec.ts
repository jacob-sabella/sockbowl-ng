import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { GameBuzzerComponent } from './game-buzzer.component';
import { GameStateService } from '../../services/game-state.service';
import { GameWebSocketService } from '../../services/game-web-socket.service';
import { StompError } from '../../models/sockbowl/sockbowl-interfaces';

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
