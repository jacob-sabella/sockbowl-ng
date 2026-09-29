import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BehaviorSubject, NEVER, Subject } from 'rxjs';

import { GameCanvasComponent } from './game-canvas.component';
import { GameStateService } from '../../services/game-state.service';
import { GameConnectionState, GameWebSocketService } from '../../services/game-web-socket.service';
import { AuthService } from '../../../core/auth/auth.service';
import { gameJoinStorageKey, saveGameJoin } from '../../services/game-join-storage';
import { StompError } from '../../models/sockbowl/sockbowl-interfaces';

describe('GameCanvasComponent', () => {
  let params$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let errors$: Subject<StompError>;
  let connectionState$: BehaviorSubject<GameConnectionState>;
  let gameStateService: {
    gameSession$: typeof NEVER; errors$: Subject<StompError>; initialize: jasmine.Spy; leaveGame: jasmine.Spy;
  };
  let location: jasmine.SpyObj<Location>;
  let snackBar: jasmine.SpyObj<MatSnackBar>;
  let authService: jasmine.SpyObj<AuthService>;
  let router: Router;

  beforeEach(() => {
    sessionStorage.removeItem(gameJoinStorageKey('g1'));
    params$ = new BehaviorSubject(convertToParamMap({}));
    errors$ = new Subject<StompError>();
    connectionState$ = new BehaviorSubject<GameConnectionState>('connected');
    gameStateService = {
      gameSession$: NEVER, errors$,
      initialize: jasmine.createSpy('initialize'),
      leaveGame: jasmine.createSpy('leaveGame'),
      getMatchState: jasmine.createSpy('getMatchState').and.returnValue(undefined),
      isSelfProctor: jasmine.createSpy('isSelfProctor').and.returnValue(false),
      isSelfOnAnyTeam: jasmine.createSpy('isSelfOnAnyTeam').and.returnValue(false),
      isProctorless: jasmine.createSpy('isProctorless').and.returnValue(false),
      isSinglePlayer: jasmine.createSpy('isSinglePlayer').and.returnValue(false),
      isAutoJudgedMultiplayer: jasmine.createSpy('isAutoJudgedMultiplayer').and.returnValue(false),
      isSelfSpectator: jasmine.createSpy('isSelfSpectator').and.returnValue(false),
    } as any;
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
        { provide: GameWebSocketService, useValue: { connectionState$: connectionState$.asObservable() } },
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

  /** Like {@link start}, but returns the fixture so the template can be inspected. */
  function startFixture(routeParams: Record<string, string> = {}) {
    params$.next(convertToParamMap(routeParams));
    const fixture = TestBed.createComponent(GameCanvasComponent);
    fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    return fixture;
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

    errors$.next({ code: 'INTERNAL', message: 'boom', fatal: true });

    expect(component.latestStompError?.code).toBe('INTERNAL');
    expect(snackBar.open).toHaveBeenCalledWith(jasmine.stringMatching(/game server|reconnecting/i), 'Dismiss', jasmine.anything());
    expect(router.navigate).toHaveBeenCalledWith(['/game-session']);
    expect(sessionStorage.getItem(gameJoinStorageKey('g1'))).toBeNull();
  });

  /**
   * M5 S1-16: a BANNED (or IP_BANNED) fatal error gets a persistent lobby
   * notice, not a 10s snackbar followed by a generic join failure. The
   * reason travels in router state; GameSessionComponent reads it to render
   * shared/state/error-state (see its own spec).
   */
  it('a BANNED fatal error navigates with the reason in router state, no snackbar', () => {
    saveGameJoin('g1', { playerSessionId: 'p1', authenticated: true });
    const component = start({ gameSessionId: 'g1', playerSessionId: 'p1' });

    errors$.next({ code: 'BANNED', message: 'banned', fatal: true });

    expect(component.latestStompError?.code).toBe('BANNED');
    expect(snackBar.open).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledOnceWith(['/game-session'], { state: { reason: 'BANNED' } });
    expect(sessionStorage.getItem(gameJoinStorageKey('g1'))).toBeNull();
  });

  it('an IP_BANNED fatal error is treated the same as BANNED', () => {
    const component = start({ gameSessionId: 'g1', playerSessionId: 'p1' });

    errors$.next({ code: 'IP_BANNED', message: 'ip banned', fatal: true });

    expect(component.latestStompError?.code).toBe('IP_BANNED');
    expect(snackBar.open).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledOnceWith(['/game-session'], { state: { reason: 'BANNED' } });
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

  it('leaves the game in GameStateService when the canvas is destroyed (NG-R4-02)', () => {
    const component = start({ gameSessionId: 'g1', playerSessionId: 'p1' });

    component.ngOnDestroy();

    expect(gameStateService.leaveGame).toHaveBeenCalledTimes(1);
  });

  /**
   * M5 S1-02: the canvas used to render nothing at all before the first
   * gameSession$ emission. It now shows a designed connecting state with a
   * way back to the lobby, and swaps to the real children once the session
   * arrives.
   */
  describe('connecting state before the first gameSession$ emission (M5 S1-02)', () => {
    it('renders the loading state and a back-to-lobby link while gameSession$ has not emitted', () => {
      const fixture = startFixture({ gameSessionId: 'g1', playerSessionId: 'p1' });

      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('app-loading-state')).not.toBeNull();
      const back = root.querySelector('a[routerlink="/game-session"]') as HTMLAnchorElement | null;
      expect(back).not.toBeNull();
      expect(back?.textContent).toContain('Back to lobby');
    });

    it('renders the children instead once gameSession$ emits', () => {
      const session$ = new Subject<unknown>();
      (gameStateService as any).gameSession$ = session$;
      const fixture = startFixture({ gameSessionId: 'g1', playerSessionId: 'p1' });

      session$.next({ currentMatch: { currentRound: {} } });
      fixture.detectChanges();

      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('app-loading-state')).toBeNull();
    });
  });

  /** M5 S1-03: a non-fatal, reconnecting socket gets a visible, distinct strip. */
  describe('reconnecting strip (M5 S1-03)', () => {
    it('is hidden while connected', () => {
      const fixture = startFixture({ gameSessionId: 'g1', playerSessionId: 'p1' });

      expect((fixture.nativeElement as HTMLElement).querySelector('.reconnect-strip')).toBeNull();
    });

    it('shows a role=status strip while the socket is reconnecting, and clears once connected again', () => {
      const fixture = startFixture({ gameSessionId: 'g1', playerSessionId: 'p1' });

      connectionState$.next('reconnecting');
      fixture.detectChanges();
      const strip = (fixture.nativeElement as HTMLElement).querySelector('.reconnect-strip');
      expect(strip).not.toBeNull();
      expect(strip?.getAttribute('role')).toBe('status');
      expect(strip?.textContent).toContain('Reconnecting');

      connectionState$.next('connected');
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('.reconnect-strip')).toBeNull();
    });
  });

  /**
   * M5 S1-31: a reconnect that never recovers used to sit on "Reconnecting…"
   * forever with no way out. Past 15s the strip escalates its wording and
   * offers the same "Back to lobby" link as the initial connecting state.
   */
  describe('reconnect escalation past 15s (M5 S1-31)', () => {
    function strip(fixture: ReturnType<typeof startFixture>): HTMLElement | null {
      return (fixture.nativeElement as HTMLElement).querySelector('.reconnect-strip');
    }

    beforeEach(() => {
      jasmine.clock().install();
    });

    afterEach(() => jasmine.clock().uninstall());

    it('stays on the plain wording, with no back link, before the threshold', () => {
      const fixture = startFixture({ gameSessionId: 'g1', playerSessionId: 'p1' });
      connectionState$.next('reconnecting');
      fixture.detectChanges();

      jasmine.clock().tick(14999);
      fixture.detectChanges();

      expect(strip(fixture)?.textContent).toContain('Reconnecting…');
      expect(strip(fixture)?.textContent).not.toContain('Still trying');
      expect(strip(fixture)?.querySelector('a')).toBeNull();
    });

    it('escalates the wording and adds a back-to-lobby link after 15s', () => {
      const fixture = startFixture({ gameSessionId: 'g1', playerSessionId: 'p1' });
      connectionState$.next('reconnecting');
      fixture.detectChanges();

      jasmine.clock().tick(15000);
      fixture.detectChanges();

      expect(strip(fixture)?.textContent).toContain('Still trying to reconnect…');
      const back = strip(fixture)?.querySelector('a[routerlink="/game-session"]') as HTMLAnchorElement | null;
      expect(back).not.toBeNull();
      expect(back?.textContent).toContain('Back to lobby');
    });

    it('clears the escalation once the socket reconnects', () => {
      const fixture = startFixture({ gameSessionId: 'g1', playerSessionId: 'p1' });
      connectionState$.next('reconnecting');
      fixture.detectChanges();
      jasmine.clock().tick(15000);
      fixture.detectChanges();

      connectionState$.next('connected');
      fixture.detectChanges();

      expect(strip(fixture)).toBeNull();
    });

    it('restarts the 15s timer on a fresh reconnect rather than reusing a stale one', () => {
      const fixture = startFixture({ gameSessionId: 'g1', playerSessionId: 'p1' });
      connectionState$.next('reconnecting');
      fixture.detectChanges();
      jasmine.clock().tick(10000);
      connectionState$.next('connected');
      fixture.detectChanges();

      connectionState$.next('reconnecting');
      fixture.detectChanges();
      jasmine.clock().tick(10000); // 10s into the new drop; would be past 15s total on the old timer
      fixture.detectChanges();

      expect(strip(fixture)?.textContent).toContain('Reconnecting…');
      expect(strip(fixture)?.textContent).not.toContain('Still trying');
    });
  });

  /**
   * M5 S1-31 (remaining half): the pre-emission "Connecting to the game…"
   * state used to run forever with no escalation if the first gameSession$
   * emission never arrived. It now escalates on the same 15s threshold and
   * copy pattern as the reconnect strip, and clears once the session lands.
   */
  describe('connecting-state escalation past 15s (M5 S1-31)', () => {
    function connectingTitle(fixture: ReturnType<typeof startFixture>): string | null {
      return (fixture.nativeElement as HTMLElement).querySelector('app-loading-state')?.getAttribute('title')
        ?? (fixture.nativeElement as HTMLElement).querySelector('.canvas-connecting')?.textContent ?? null;
    }

    beforeEach(() => {
      jasmine.clock().install();
    });

    afterEach(() => jasmine.clock().uninstall());

    it('stays on "Connecting to the game…" before the threshold', () => {
      const fixture = startFixture({ gameSessionId: 'g1', playerSessionId: 'p1' });

      jasmine.clock().tick(14999);
      fixture.detectChanges();

      expect(connectingTitle(fixture)).toContain('Connecting to the game…');
      expect(connectingTitle(fixture)).not.toContain('Still connecting');
    });

    it('escalates to "Still connecting…" after 15s with no gameSession$ emission', () => {
      const fixture = startFixture({ gameSessionId: 'g1', playerSessionId: 'p1' });

      jasmine.clock().tick(15000);
      fixture.detectChanges();

      expect(connectingTitle(fixture)).toContain('Still connecting…');
      const back = (fixture.nativeElement as HTMLElement)
        .querySelector('a[routerlink="/game-session"]') as HTMLAnchorElement | null;
      expect(back).not.toBeNull();
      expect(back?.textContent).toContain('Back to lobby');
    });

    it('clears on the first emission instead of escalating', () => {
      const session$ = new Subject<unknown>();
      gameStateService.gameSession$ = session$ as unknown as typeof NEVER;
      const fixture = startFixture({ gameSessionId: 'g1', playerSessionId: 'p1' });

      session$.next({ currentMatch: { currentRound: {} } });
      fixture.detectChanges();
      jasmine.clock().tick(15000);
      fixture.detectChanges();

      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('.canvas-connecting')).toBeNull();
      expect(root.textContent).not.toContain('Still connecting');
    });
  });

  /**
   * M5 S1-34: both "Back to lobby" links (the pre-emission connecting state
   * and the reconnect strip's escalated state) were bare text links with no
   * reserved tap-target height. Both now reserve at least 44px.
   */
  describe('44px back-to-lobby tap targets (M5 S1-34)', () => {
    it('.canvas-connecting__back reserves at least 44px', () => {
      const fixture = startFixture({ gameSessionId: 'g1', playerSessionId: 'p1' });

      const back = (fixture.nativeElement as HTMLElement).querySelector('.canvas-connecting__back') as HTMLElement;
      expect(back).not.toBeNull();
      expect(parseFloat(getComputedStyle(back).minHeight)).toBeGreaterThanOrEqual(44);
    });

    it('.reconnect-strip__back reserves at least 44px', () => {
      jasmine.clock().install();
      try {
        const fixture = startFixture({ gameSessionId: 'g1', playerSessionId: 'p1' });
        connectionState$.next('reconnecting');
        fixture.detectChanges();
        jasmine.clock().tick(15000);
        fixture.detectChanges();

        const back = (fixture.nativeElement as HTMLElement).querySelector('.reconnect-strip__back') as HTMLElement;
        expect(back).not.toBeNull();
        expect(parseFloat(getComputedStyle(back).minHeight)).toBeGreaterThanOrEqual(44);
      } finally {
        jasmine.clock().uninstall();
      }
    });
  });
});
