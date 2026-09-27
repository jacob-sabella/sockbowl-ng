import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';

import { GameSessionComponent } from './game-session.component';
import { GameSessionService } from '../../services/game-session.service';
import { AuthService } from '../../../core/auth/auth.service';
import { environment } from '../../../../environments/environment';
import { gameJoinStorageKey } from '../../services/game-join-storage';
import { JoinGameResponse } from '../../models/sockbowl/sockbowl-interfaces';
import { RateLimitStateService } from '../../../core/http/rate-limit-state.service';

describe('GameSessionComponent join flow', () => {
  let component: GameSessionComponent;
  let gameSessionService: jasmine.SpyObj<GameSessionService>;
  let router: jasmine.SpyObj<Router>;
  let authenticated: boolean;
  let originalAuthEnabled: boolean;

  const joinResponse = {
    gameSessionId: 'game-1',
    playerSessionId: 'player-1',
    playerSecret: 'secret-1',
  } as JoinGameResponse;

  beforeEach(() => {
    originalAuthEnabled = environment.authEnabled;
    environment.authEnabled = true;
    authenticated = false;
    sessionStorage.removeItem(gameJoinStorageKey('game-1'));

    gameSessionService = jasmine.createSpyObj<GameSessionService>('GameSessionService',
      ['createNewGame', 'joinGame', 'joinGameAuthenticated']);
    gameSessionService.createNewGame.and.returnValue(of({ id: 'game-1', joinCode: 'ABCD' } as any));
    gameSessionService.joinGame.and.returnValue(of(joinResponse));
    gameSessionService.joinGameAuthenticated.and.returnValue(of(joinResponse));
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);

    TestBed.configureTestingModule({
      declarations: [GameSessionComponent],
      providers: [
        { provide: GameSessionService, useValue: gameSessionService },
        { provide: Router, useValue: router },
        {
          provide: AuthService,
          useValue: {
            isAuthenticated: () => authenticated,
            getUserProfile: () => (authenticated ? { name: 'Test User', preferredUsername: 'testuser' } : null),
          },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    component = TestBed.createComponent(GameSessionComponent).componentInstance;
  });

  afterEach(() => {
    environment.authEnabled = originalAuthEnabled;
    sessionStorage.removeItem(gameJoinStorageKey('game-1'));
  });

  function storedJoin(): any {
    return JSON.parse(sessionStorage.getItem(gameJoinStorageKey('game-1')) as string);
  }

  function navigatedParams(): Record<string, string> {
    const [commands] = router.navigate.calls.mostRecent().args;
    expect(commands[0]).toBe('/game');
    return commands[1];
  }

  it('an authenticated user joins as their account after creating a game', () => {
    authenticated = true;

    component.startAutoProctorGame();

    expect(gameSessionService.createNewGame).toHaveBeenCalled();
    expect(gameSessionService.joinGameAuthenticated).toHaveBeenCalledWith(
      jasmine.objectContaining({ joinCode: 'ABCD' }));
    expect(gameSessionService.joinGame).not.toHaveBeenCalled();
  });

  it('an authenticated user joins as their account when joining by code', () => {
    authenticated = true;
    component.joinGameRequest.joinCode = 'WXYZ';

    component.submitJoinGame();

    expect(gameSessionService.joinGameAuthenticated).toHaveBeenCalledWith(
      jasmine.objectContaining({ joinCode: 'WXYZ' }));
    expect(gameSessionService.joinGame).not.toHaveBeenCalled();
    expect(storedJoin()).toEqual({ playerSessionId: 'player-1', authenticated: true });
    expect(navigatedParams()).toEqual({ gameSessionId: 'game-1', playerSessionId: 'player-1' });
  });

  it('a guest joins through the guest endpoint, both after create and by code', () => {
    component.startSoloGame();
    expect(gameSessionService.joinGame).toHaveBeenCalledTimes(1);

    component.joinGameRequest.joinCode = 'WXYZ';
    component.submitJoinGame();
    expect(gameSessionService.joinGame).toHaveBeenCalledTimes(2);
    expect(gameSessionService.joinGameAuthenticated).not.toHaveBeenCalled();
  });

  it('keeps a guest playerSecret in sessionStorage, not in the router params', () => {
    component.joinGameRequest = { joinCode: 'WXYZ', name: 'Guest' } as any;

    component.submitJoinGame();

    expect(storedJoin()).toEqual({ playerSessionId: 'player-1', playerSecret: 'secret-1', authenticated: false });
    const params = navigatedParams();
    expect(params).toEqual({ gameSessionId: 'game-1', playerSessionId: 'player-1' });
    expect(JSON.stringify(router.navigate.calls.allArgs())).not.toContain('secret-1');
  });

  it('joins as a guest when auth is disabled', () => {
    environment.authEnabled = false;
    authenticated = true; // AuthService would never say so with auth off; the lobby must not trust it

    component.submitJoinGame();

    expect(gameSessionService.joinGame).toHaveBeenCalled();
    expect(gameSessionService.joinGameAuthenticated).not.toHaveBeenCalled();
  });
});

describe('GameSessionComponent M4-UI-01 session-create cooldown', () => {
  let fixture: ComponentFixture<GameSessionComponent>;
  let component: GameSessionComponent;
  let rateLimitState: RateLimitStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [GameSessionComponent],
      providers: [
        { provide: GameSessionService, useValue: jasmine.createSpyObj('GameSessionService',
          ['createNewGame', 'joinGame', 'joinGameAuthenticated']) },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
        { provide: AuthService, useValue: { isAuthenticated: () => false, getUserProfile: () => null } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(GameSessionComponent);
    component = fixture.componentInstance;
    rateLimitState = TestBed.inject(RateLimitStateService);
  });

  it('disables the create button while session-create cools down, and re-enables on recovery', () => {
    component.showModeSelect = true;
    fixture.detectChanges();

    const soloButton = (fixture.nativeElement as HTMLElement).querySelector(
      '.lobby-action.primary') as HTMLButtonElement;
    expect(soloButton.disabled).toBeFalse();

    rateLimitState.setCooldown('session-create', 20);
    fixture.detectChanges();
    expect(soloButton.disabled).toBeTrue();

    rateLimitState.clearCooldown('session-create');
    fixture.detectChanges();
    expect(soloButton.disabled).toBeFalse();
  });

  it('disables the create-form "Create" button too, since it shares the same policy', () => {
    component.showCreateForm = true;
    fixture.detectChanges();
    rateLimitState.setCooldown('session-create', 5);
    fixture.detectChanges();

    const createButtons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button')
    ).filter(b => b.textContent?.trim() === 'Create') as HTMLButtonElement[];
    expect(createButtons.length).toBeGreaterThan(0);
    createButtons.forEach(b => expect(b.disabled).toBeTrue());
  });
});
