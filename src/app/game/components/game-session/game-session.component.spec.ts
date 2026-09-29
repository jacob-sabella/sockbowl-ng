import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, Subject, throwError } from 'rxjs';

import { GameSessionComponent } from './game-session.component';
import { GameSessionService } from '../../services/game-session.service';
import { AuthService } from '../../../core/auth/auth.service';
import { environment } from '../../../../environments/environment';
import { gameJoinStorageKey } from '../../services/game-join-storage';
import { GameMode, JoinGameResponse } from '../../models/sockbowl/sockbowl-interfaces';
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
    component.joinGameRequest.joinCode = 'WXYZ';
    component.joinGameRequest.name = 'Guest';

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

/**
 * M5 S1-05: join/create failures are classified instead of always showing a
 * generic snackbar that would silently replace notifyLimit's own 429/QUOTA
 * one, or pile a second generic failure on top of a 403 AuthInterceptor
 * already explained.
 */
describe('GameSessionComponent classifies join/create errors (M5 S1-05)', () => {
  let component: GameSessionComponent;
  let gameSessionService: jasmine.SpyObj<GameSessionService>;
  let snackBar: jasmine.SpyObj<MatSnackBar>;

  function configure(): void {
    gameSessionService = jasmine.createSpyObj<GameSessionService>('GameSessionService',
      ['createNewGame', 'joinGame', 'joinGameAuthenticated']);
    snackBar = jasmine.createSpyObj<MatSnackBar>('MatSnackBar', ['open']);

    TestBed.configureTestingModule({
      declarations: [GameSessionComponent],
      providers: [
        { provide: GameSessionService, useValue: gameSessionService },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: AuthService, useValue: { isAuthenticated: () => false, getUserProfile: () => null } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    component = TestBed.createComponent(GameSessionComponent).componentInstance;
    // These tests exercise error classification, not the M5 S1-35 blank-name
    // guard: give every guest join a name so it isn't blocked before it can
    // reach the (mocked) service call under test.
    component.joinGameRequest.name = 'Guest';
  }

  afterEach(() => sessionStorage.removeItem(gameJoinStorageKey('game-1')));

  it('a 429 rate_limited body shows no generic snack (RateLimitInterceptor already did)', () => {
    configure();
    gameSessionService.joinGame.and.returnValue(throwError(() => new HttpErrorResponse({
      status: 429, error: { error: 'rate_limited', retryAfterSeconds: 5 },
    })));

    component.joinGameRequest.joinCode = 'WXYZ';
    component.submitJoinGame();

    expect(snackBar.open).not.toHaveBeenCalled();
    expect(component.codeError).toBeNull();
    expect(component.bannedNotice).toBeNull();
  });

  it('a 403 banned body sets a persistent banned notice, not a snack', () => {
    configure();
    gameSessionService.joinGame.and.returnValue(throwError(() => new HttpErrorResponse({
      status: 403, error: { error: 'banned', reason: 'You broke the rules.' },
    })));

    component.joinGameRequest.joinCode = 'WXYZ';
    component.submitJoinGame();

    expect(snackBar.open).not.toHaveBeenCalled();
    expect(component.bannedNotice).toBe('You broke the rules.');
  });

  it('a plain 403 (no recognized body) shows no generic snack (AuthInterceptor already did)', () => {
    configure();
    gameSessionService.joinGame.and.returnValue(throwError(() => new HttpErrorResponse({ status: 403 })));

    component.joinGameRequest.joinCode = 'WXYZ';
    component.submitJoinGame();

    expect(snackBar.open).not.toHaveBeenCalled();
    expect(component.bannedNotice).toBeNull();
  });

  it('a 404 sets an inline "no game with that code" error on the field', () => {
    configure();
    gameSessionService.joinGame.and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 })));

    component.joinGameRequest.joinCode = 'WXYZ';
    component.submitJoinGame();

    expect(snackBar.open).not.toHaveBeenCalled();
    expect(component.codeError).toMatch(/no game/i);
  });

  it('a 409 sets an inline "room is full" error on the field', () => {
    configure();
    gameSessionService.joinGame.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409 })));

    component.joinGameRequest.joinCode = 'WXYZ';
    component.submitJoinGame();

    expect(component.codeError).toMatch(/full/i);
  });

  it('an unrecognized failure still falls back to the original generic snack (create)', () => {
    configure();
    gameSessionService.createNewGame.and.returnValue(throwError(() => new Error('boom')));

    component.startSoloGame();

    expect(snackBar.open).toHaveBeenCalledWith('Could not create the game. Please try again.', 'Dismiss', jasmine.anything());
  });

  it('an unrecognized failure still falls back to the original generic snack (join)', () => {
    configure();
    gameSessionService.joinGame.and.returnValue(throwError(() => new Error('boom')));

    component.joinGameRequest.joinCode = 'WXYZ';
    component.submitJoinGame();

    expect(snackBar.open).toHaveBeenCalledWith('Could not join the game. Please try again.', 'Dismiss', jasmine.anything());
  });
});

/**
 * M5 S1-06: Enter submits the join form, a double submit is guarded while a
 * request is in flight, and a code is normalised (trimmed, upper-cased)
 * before it's sent.
 */
describe('GameSessionComponent join form submit guard and normalisation (M5 S1-06)', () => {
  let fixture: ComponentFixture<GameSessionComponent>;
  let component: GameSessionComponent;
  let gameSessionService: jasmine.SpyObj<GameSessionService>;

  const joinResponse = {
    gameSessionId: 'game-1', playerSessionId: 'player-1', playerSecret: 'secret-1',
  } as JoinGameResponse;

  beforeEach(() => {
    gameSessionService = jasmine.createSpyObj<GameSessionService>('GameSessionService',
      ['createNewGame', 'joinGame', 'joinGameAuthenticated']);
    gameSessionService.joinGame.and.returnValue(of(joinResponse));

    TestBed.configureTestingModule({
      declarations: [GameSessionComponent],
      providers: [
        { provide: GameSessionService, useValue: gameSessionService },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
        { provide: AuthService, useValue: { isAuthenticated: () => false, getUserProfile: () => null } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(GameSessionComponent);
    component = fixture.componentInstance;
    // This describe covers the code/double-submit guard (M5 S1-06), not the
    // M5 S1-35 blank-name guard; give every guest join a name by default.
    component.joinGameRequest.name = 'Guest';
  });

  afterEach(() => sessionStorage.removeItem(gameJoinStorageKey('game-1')));

  it('trims and upper-cases a hand-typed code before sending it', () => {
    component.joinGameRequest.joinCode = '  wxyz  ';

    component.submitJoinGame();

    expect(gameSessionService.joinGame).toHaveBeenCalledWith(jasmine.objectContaining({ joinCode: 'WXYZ' }));
  });

  it('rejects a blank code inline instead of sending the request', () => {
    component.joinGameRequest.joinCode = '   ';

    component.submitJoinGame();

    expect(gameSessionService.joinGame).not.toHaveBeenCalled();
    expect(component.codeError).toMatch(/enter a join code/i);
  });

  it('a second submit while the first is in flight is ignored (no double submit)', () => {
    const pending = new Subject<JoinGameResponse>();
    gameSessionService.joinGame.and.returnValue(pending);
    component.joinGameRequest.joinCode = 'WXYZ';

    component.submitJoinGame();
    component.submitJoinGame();

    expect(gameSessionService.joinGame).toHaveBeenCalledTimes(1);
  });

  it('the join form is a <form> so Enter submits it', () => {
    component.showJoinForm = true;
    fixture.detectChanges();

    const form = (fixture.nativeElement as HTMLElement).querySelector('form');
    expect(form).not.toBeNull();
  });
});

/**
 * M5 S1-16: a banned player is bounced from the canvas with `{reason:
 * 'BANNED'}` in router state; the lobby reads it and shows a persistent
 * notice instead of nothing (the snackbar the socket showed has already
 * expired by the time they land back here).
 */
describe('GameSessionComponent banned notice from router state (M5 S1-16)', () => {
  function configure(state: unknown): GameSessionComponent {
    spyOnProperty(history, 'state', 'get').and.returnValue(state);
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
    return TestBed.createComponent(GameSessionComponent).componentInstance;
  }

  it('shows a persistent banned notice when routed here with reason BANNED', () => {
    const component = configure({ reason: 'BANNED' });

    component.ngOnInit();

    expect(component.bannedNotice).toMatch(/banned/i);
  });

  it('dismissBannedNotice clears it', () => {
    const component = configure({ reason: 'BANNED' });
    component.ngOnInit();

    component.dismissBannedNotice();

    expect(component.bannedNotice).toBeNull();
  });

  it('does nothing when there is no BANNED reason in state', () => {
    const component = configure(null);

    component.ngOnInit();

    expect(component.bannedNotice).toBeNull();
  });
});

/**
 * M5 S1-35: the create form's Game Mode select used to leak the raw backend
 * enum keys (`QUIZ_BOWL_CLASSIC`), a failed quick launch left a stale mode
 * selected the next time "Proctored match" opened the form, and a blank
 * guest name reached the server instead of being caught inline.
 */
describe('GameSessionComponent create form defaults and join name guard (M5 S1-35)', () => {
  let fixture: ComponentFixture<GameSessionComponent>;
  let component: GameSessionComponent;
  let gameSessionService: jasmine.SpyObj<GameSessionService>;

  beforeEach(() => {
    gameSessionService = jasmine.createSpyObj<GameSessionService>('GameSessionService',
      ['createNewGame', 'joinGame', 'joinGameAuthenticated']);

    TestBed.configureTestingModule({
      declarations: [GameSessionComponent],
      providers: [
        { provide: GameSessionService, useValue: gameSessionService },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
        { provide: AuthService, useValue: { isAuthenticated: () => false, getUserProfile: () => null } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(GameSessionComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => sessionStorage.removeItem(gameJoinStorageKey('game-1')));

  it('resets a stale gameMode from a previous quick launch when "Proctored match" opens the form', () => {
    component.createGameRequest.gameSettings.gameMode = GameMode.SINGLE_PLAYER;

    component.onCreateGame();

    expect(component.createGameRequest.gameSettings.gameMode).toBe(GameMode.QUIZ_BOWL_CLASSIC);
  });

  it("shows the mode picker's own labels in the select, not the raw enum keys", () => {
    component.showCreateForm = true;
    fixture.detectChanges();

    const options = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('mat-option'))
      .map(el => el.textContent?.trim());

    expect(options).toContain('Proctored match');
    expect(options).toContain('Solo practice');
    expect(options).toContain('Auto-judged match');
    expect(options).toContain('Free for all');
    expect(options).not.toContain('QUIZ_BOWL_CLASSIC');
    expect(options).not.toContain('SINGLE_PLAYER');
  });

  it('blocks a blank guest name inline instead of sending the join request', () => {
    component.joinGameRequest.joinCode = 'WXYZ';
    component.joinGameRequest.name = '   ';

    component.submitJoinGame();

    expect(gameSessionService.joinGame).not.toHaveBeenCalled();
    expect(component.nameError).toMatch(/enter your name/i);
    expect(component.joinInFlight()).toBeFalse();
  });

  it('trims a name with surrounding whitespace and sends it', () => {
    gameSessionService.joinGame.and.returnValue(of(
      { gameSessionId: 'game-1', playerSessionId: 'player-1', playerSecret: 'secret-1' } as JoinGameResponse));
    component.joinGameRequest.joinCode = 'WXYZ';
    component.joinGameRequest.name = '  Ada  ';

    component.submitJoinGame();

    expect(gameSessionService.joinGame).toHaveBeenCalledWith(jasmine.objectContaining({ name: 'Ada' }));
    expect(component.nameError).toBeNull();
  });
});

/**
 * M5 S1-30: the icon-only back button had no accessible name, and the guest
 * name field read "Your name" on create but "Name" on join.
 */
describe('GameSessionComponent back button and field labels (M5 S1-30)', () => {
  let fixture: ComponentFixture<GameSessionComponent>;
  let component: GameSessionComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [GameSessionComponent],
      providers: [
        { provide: GameSessionService, useValue: jasmine.createSpyObj('GameSessionService', ['createNewGame', 'joinGame', 'joinGameAuthenticated']) },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
        { provide: AuthService, useValue: { isAuthenticated: () => false, getUserProfile: () => null } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(GameSessionComponent);
    component = fixture.componentInstance;
  });

  it('gives the icon-only back button an accessible name', () => {
    component.showJoinForm = true;
    fixture.detectChanges();

    const back = (fixture.nativeElement as HTMLElement).querySelector('button[mat-icon-button]');
    expect(back?.getAttribute('aria-label')).toBe('Back');
  });

  it('labels the guest name field "Your name" on both create and join', () => {
    component.showJoinForm = true;
    fixture.detectChanges();
    let labels = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('mat-label'))
      .map(el => el.textContent?.trim());
    expect(labels).toContain('Your name');
    expect(labels).not.toContain('Name');

    component.showJoinForm = false;
    component.showCreateForm = true;
    fixture.detectChanges();
    labels = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('mat-label'))
      .map(el => el.textContent?.trim());
    expect(labels).toContain('Your name');
  });

  it('reads "Join code" in sentence case', () => {
    component.showJoinForm = true;
    fixture.detectChanges();

    const labels = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('mat-label'))
      .map(el => el.textContent?.trim());
    expect(labels).toContain('Join code');
    expect(labels).not.toContain('Join Code');
  });
});
