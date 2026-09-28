import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { of, throwError } from 'rxjs';

import { GameSessionComponent } from './game-session.component';
import { GameSessionService } from '../../services/game-session.service';
import { AuthService } from '../../../core/auth/auth.service';
import { environment } from '../../../../environments/environment';
import { gameJoinStorageKey } from '../../services/game-join-storage';
import { JoinGameResponse } from '../../models/sockbowl/sockbowl-interfaces';
import { PendingPacketService } from '../../services/pending-packet.service';
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
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
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

describe('GameSessionComponent play-test query params (PB-15)', () => {
  let gameSessionService: jasmine.SpyObj<GameSessionService>;
  let router: jasmine.SpyObj<Router>;
  let pendingPacketService: PendingPacketService;

  const joinResponse = {
    gameSessionId: 'game-1',
    playerSessionId: 'player-1',
    playerSecret: 'secret-1',
  } as JoinGameResponse;

  function configure(queryParams: Record<string, string>): GameSessionComponent {
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
        { provide: AuthService, useValue: { isAuthenticated: () => false, getUserProfile: () => null } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    const component = TestBed.createComponent(GameSessionComponent).componentInstance;
    pendingPacketService = TestBed.inject(PendingPacketService);
    return component;
  }

  afterEach(() => {
    pendingPacketService?.clear();
    sessionStorage.removeItem(gameJoinStorageKey('game-1'));
  });

  it('stores the packetId query param for GameConfigComponent to pick up', () => {
    const component = configure({ packetId: 'packet-42' });

    component.ngOnInit();

    expect(pendingPacketService.get()).toBe('packet-42');
    // mode=single wasn't set, so this shouldn't have auto-started a game.
    expect(gameSessionService.createNewGame).not.toHaveBeenCalled();
  });

  it('mode=single preselects and launches the solo flow', () => {
    const component = configure({ mode: 'single' });

    component.ngOnInit();

    expect(gameSessionService.createNewGame).toHaveBeenCalled();
    expect(gameSessionService.joinGame).toHaveBeenCalled();
  });

  it('does nothing extra when there is no packetId or mode', () => {
    const component = configure({});

    component.ngOnInit();

    expect(pendingPacketService.get()).toBeNull();
    expect(gameSessionService.createNewGame).not.toHaveBeenCalled();
  });
});

/**
 * NG-V1-05: a stale pending packet (left over from a cancelled navigation, or
 * a solo game that never made it to CONFIG) must not silently attach itself
 * to a later, unrelated game. GameSessionComponent is the only place that
 * ever *writes* the pending id (from the packetId query param), so it's also
 * responsible for clearing it once that intent no longer applies.
 */
describe('GameSessionComponent clears a stale pending packet (NG-V1-05)', () => {
  let gameSessionService: jasmine.SpyObj<GameSessionService>;
  let router: jasmine.SpyObj<Router>;
  let pendingPacketService: PendingPacketService;
  let component: GameSessionComponent;

  function configure(): void {
    gameSessionService = jasmine.createSpyObj<GameSessionService>('GameSessionService',
      ['createNewGame', 'joinGame', 'joinGameAuthenticated']);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);

    TestBed.configureTestingModule({
      declarations: [GameSessionComponent],
      providers: [
        { provide: GameSessionService, useValue: gameSessionService },
        { provide: Router, useValue: router },
        { provide: AuthService, useValue: { isAuthenticated: () => false, getUserProfile: () => null } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    component = TestBed.createComponent(GameSessionComponent).componentInstance;
    pendingPacketService = TestBed.inject(PendingPacketService);
    pendingPacketService.set('stale-packet');
  }

  afterEach(() => {
    pendingPacketService?.clear();
  });

  it('clears the pending packet on an explicit "New game"', () => {
    configure();

    component.onNewGame();

    expect(pendingPacketService.get()).toBeNull();
  });

  it('clears the pending packet on an explicit "Join" (by code, without a packetId)', () => {
    configure();

    component.onJoinGame();

    expect(pendingPacketService.get()).toBeNull();
  });

  it('clears the pending packet when solo-game creation fails', () => {
    configure();
    gameSessionService.createNewGame.and.returnValue(throwError(() => new Error('boom')));

    component.startSoloGame();

    expect(pendingPacketService.get()).toBeNull();
    expect(gameSessionService.joinGame).not.toHaveBeenCalled();
  });

  it('clears the pending packet when the join step of solo-game creation fails', () => {
    configure();
    gameSessionService.createNewGame.and.returnValue(of({ id: 'game-1', joinCode: 'ABCD' } as any));
    gameSessionService.joinGame.and.returnValue(throwError(() => new Error('boom')));

    component.startSoloGame();

    expect(pendingPacketService.get()).toBeNull();
    expect(router.navigate).not.toHaveBeenCalled();
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
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
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
