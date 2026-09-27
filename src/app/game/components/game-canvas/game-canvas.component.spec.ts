import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BehaviorSubject, NEVER, Subject } from 'rxjs';

import { GameCanvasComponent } from './game-canvas.component';
import { GameStateService } from '../../services/game-state.service';
import { AuthService } from '../../../core/auth/auth.service';
import { gameJoinStorageKey, saveGameJoin } from '../../services/game-join-storage';
import { StompError } from '../../models/sockbowl/sockbowl-interfaces';

describe('GameCanvasComponent', () => {
  let params$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let errors$: Subject<StompError>;
  let gameStateService: { gameSession$: typeof NEVER; errors$: Subject<StompError>; initialize: jasmine.Spy };
  let location: jasmine.SpyObj<Location>;
  let snackBar: jasmine.SpyObj<MatSnackBar>;
  let authService: jasmine.SpyObj<AuthService>;
  let router: Router;

  beforeEach(() => {
    sessionStorage.removeItem(gameJoinStorageKey('g1'));
    params$ = new BehaviorSubject(convertToParamMap({}));
    errors$ = new Subject<StompError>();
    gameStateService = { gameSession$: NEVER, errors$, initialize: jasmine.createSpy('initialize') };
    location = jasmine.createSpyObj<Location>('Location', ['replaceState']);
    snackBar = jasmine.createSpyObj<MatSnackBar>('MatSnackBar', ['open']);
    authService = jasmine.createSpyObj<AuthService>('AuthService', ['getAccessToken', 'handleSessionEnded']);
    authService.getAccessToken.and.returnValue(null);

    TestBed.configureTestingModule({
      declarations: [GameCanvasComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: params$ } },
        { provide: GameStateService, useValue: gameStateService },
        { provide: Location, useValue: location },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: AuthService, useValue: authService },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
  });

  afterEach(() => sessionStorage.removeItem(gameJoinStorageKey('g1')));

  function start(routeParams: Record<string, string>): GameCanvasComponent {
    params$.next(convertToParamMap(routeParams));
    const component = TestBed.createComponent(GameCanvasComponent).componentInstance;
    component.ngOnInit();
    return component;
  }

  it('ignores an accessToken route param and scrubs it from the URL', () => {
    saveGameJoin('g1', { playerSessionId: 'p1', authenticated: true });

    start({ gameSessionId: 'g1', playerSessionId: 'p1', accessToken: 'leaked.jwt.token' });

    expect(gameStateService.initialize).toHaveBeenCalledOnceWith('g1', 'p1', {});
    expect(JSON.stringify(gameStateService.initialize.calls.allArgs())).not.toContain('leaked');
    expect(location.replaceState).toHaveBeenCalledTimes(1);
    const url = location.replaceState.calls.mostRecent().args[0];
    expect(url).not.toContain('accessToken');
    expect(url).not.toContain('leaked');
    expect(url).toContain('gameSessionId=g1');
    expect(url).toContain('playerSessionId=p1');
  });

  it('uses the guest playerSecret stored by the lobby', () => {
    saveGameJoin('g1', { playerSessionId: 'p1', playerSecret: 'stored-secret', authenticated: false });

    start({ gameSessionId: 'g1', playerSessionId: 'p1' });

    expect(gameStateService.initialize).toHaveBeenCalledOnceWith('g1', 'p1', { playerSecret: 'stored-secret' });
    expect(location.replaceState).not.toHaveBeenCalled();
  });

  it('falls back to a playerSecret route param (harness deep link), stores it and scrubs the URL', () => {
    start({ gameSessionId: 'g1', playerSecret: 'deep-link-secret', playerSessionId: 'p1' });

    expect(gameStateService.initialize).toHaveBeenCalledOnceWith('g1', 'p1', { playerSecret: 'deep-link-secret' });
    const stored = JSON.parse(sessionStorage.getItem(gameJoinStorageKey('g1')) as string);
    expect(stored).toEqual({ playerSessionId: 'p1', playerSecret: 'deep-link-secret', authenticated: false });
    const url = location.replaceState.calls.mostRecent().args[0];
    expect(url).not.toContain('playerSecret');
    expect(url).not.toContain('deep-link-secret');
  });

  it('ignores a stored join for a different seat', () => {
    saveGameJoin('g1', { playerSessionId: 'other', playerSecret: 'other-secret', authenticated: false });

    start({ gameSessionId: 'g1', playerSessionId: 'p1' });

    expect(gameStateService.initialize).toHaveBeenCalledOnceWith('g1', 'p1', {});
  });

  it('a fatal socket error returns to the lobby with a message', () => {
    saveGameJoin('g1', { playerSessionId: 'p1', authenticated: true });
    const component = start({ gameSessionId: 'g1', playerSessionId: 'p1' });

    errors$.next({ code: 'BANNED', message: 'banned', fatal: true });

    expect(component.latestStompError?.code).toBe('BANNED');
    expect(snackBar.open).toHaveBeenCalledWith(jasmine.stringMatching(/banned/i), 'Dismiss', jasmine.anything());
    expect(router.navigate).toHaveBeenCalledWith(['/game-session']);
    expect(sessionStorage.getItem(gameJoinStorageKey('g1'))).toBeNull();
  });

  it('an unrecoverable token error ends the auth session', () => {
    authService.getAccessToken.and.returnValue('stale');
    start({ gameSessionId: 'g1', playerSessionId: 'p1' });

    errors$.next({ code: 'TOKEN_EXPIRED', fatal: true });

    expect(authService.handleSessionEnded).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/game-session']);
  });

  it('a non-fatal error only feeds the banner', () => {
    const component = start({ gameSessionId: 'g1', playerSessionId: 'p1' });

    errors$.next({ code: 'RATE_LIMITED', message: 'slow down', fatal: false });

    expect(component.latestStompError?.code).toBe('RATE_LIMITED');
    expect(router.navigate).not.toHaveBeenCalled();
    expect(snackBar.open).not.toHaveBeenCalled();
  });
});
