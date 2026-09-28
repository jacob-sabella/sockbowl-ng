import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { IFrame, StompConfig } from '@stomp/stompjs';

import {
  BASE_RECONNECT_DELAY_MS,
  GameWebSocketService,
  RATE_LIMIT_JITTER,
  RATE_LIMIT_STABLE_MS,
  STOMP_CLIENT_FACTORY
} from './game-web-socket.service';
import { AuthService } from '../../core/auth/auth.service';
import { environment } from '../../../environments/environment';
import { SockbowlInMessage, StompError } from '../models/sockbowl/sockbowl-interfaces';

/** Stand-in for the stompjs Client: records what the service does to it. */
class FakeStompClient {
  connectHeaders: Record<string, string> = {};
  reconnectDelay: number;
  beforeConnect: (client: any) => void | Promise<void> = () => undefined;
  onConnect: (frame: IFrame) => void = () => undefined;
  onStompError: (frame: IFrame) => void = () => undefined;
  active = false;
  handlers: Record<string, (message: any) => void> = {};

  activate = jasmine.createSpy('activate').and.callFake(() => { this.active = true; });
  deactivate = jasmine.createSpy('deactivate').and.callFake(() => {
    this.active = false;
    return Promise.resolve();
  });
  subscribe = jasmine.createSpy('subscribe').and.callFake((destination: string, cb: (m: any) => void) => {
    this.handlers[destination] = cb;
    return { id: destination, unsubscribe: () => undefined };
  });
  publish = jasmine.createSpy('publish');

  constructor(public readonly config: StompConfig) {
    this.reconnectDelay = config.reconnectDelay ?? 5000;
  }

  /** Run the CONNECT handshake the way stompjs does: beforeConnect, then onConnect. */
  async connect(): Promise<void> {
    await this.beforeConnect(this);
    this.onConnect({} as IFrame);
  }

  errorFrame(code: string, message = 'detail', retryAfterSeconds: number | null = null, policy?: string): IFrame {
    return {
      command: 'ERROR',
      headers: { message: code, 'x-sockbowl-error': code },
      body: JSON.stringify({ code, message, retryAfterSeconds, ...(policy ? { policy } : {}) }),
    } as unknown as IFrame;
  }

  /** Headers of the n-th SEND (0-based), skipping nothing. */
  sendHeaders(index: number): Record<string, string> {
    return this.publish.calls.argsFor(index)[0].headers;
  }
}

/** Let pending promise callbacks (refresh, deactivate) run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

describe('GameWebSocketService', () => {
  let service: GameWebSocketService;
  let clients: FakeStompClient[];
  let tokenChanges: Subject<string>;
  let authService: jasmine.SpyObj<AuthService> & { tokenChanges$: Subject<string> };
  let errors: StompError[];
  let originalAuthEnabled: boolean;
  let rateLimitJitter: jasmine.Spy<() => number>;

  const client = () => clients[clients.length - 1];

  beforeEach(() => {
    originalAuthEnabled = environment.authEnabled;
    environment.authEnabled = true;
    clients = [];
    tokenChanges = new Subject<string>();
    authService = Object.assign(
      jasmine.createSpyObj<AuthService>('AuthService', ['getFreshAccessToken', 'refreshToken', 'whenInitialized']),
      { tokenChanges$: tokenChanges }
    );
    authService.getFreshAccessToken.and.resolveTo('token-1');
    authService.refreshToken.and.resolveTo('token-2');
    authService.whenInitialized.and.resolveTo(undefined);

    rateLimitJitter = jasmine.createSpy('rateLimitJitter').and.returnValue(0);
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: authService },
        // Deterministic by default (no jitter); individual tests can call
        // rateLimitJitter.and.returnValue(...) to exercise the jitter math.
        { provide: RATE_LIMIT_JITTER, useValue: rateLimitJitter },
        {
          provide: STOMP_CLIENT_FACTORY,
          useValue: (config: StompConfig) => {
            const fake = new FakeStompClient(config);
            clients.push(fake);
            return fake as any;
          },
        },
      ],
    });
    service = TestBed.inject(GameWebSocketService);
    errors = [];
    service.errors$.subscribe(e => errors.push(e));
  });

  afterEach(() => {
    environment.authEnabled = originalAuthEnabled;
  });

  describe('CONNECT headers (beforeConnect)', () => {
    it('puts a fresh access token in the CONNECT frame for an account seat', async () => {
      service.initialize('g1', 'p1', {});
      expect(client().activate).toHaveBeenCalledTimes(1);

      await client().beforeConnect(client());

      expect(authService.getFreshAccessToken).toHaveBeenCalledTimes(1);
      expect(client().connectHeaders).toEqual({
        gameSessionId: 'g1',
        playerSessionId: 'p1',
        Authorization: 'Bearer token-1',
      });
    });

    it('asks for a fresh token again on every reconnect', async () => {
      service.initialize('g1', 'p1', {});
      await client().beforeConnect(client());
      authService.getFreshAccessToken.and.resolveTo('token-9');

      await client().beforeConnect(client());

      expect(authService.getFreshAccessToken).toHaveBeenCalledTimes(2);
      expect(client().connectHeaders['Authorization']).toBe('Bearer token-9');
    });

    it('puts the playerSecret, and no token, in the CONNECT frame for a guest seat', async () => {
      service.initialize('g1', 'p1', { playerSecret: 'secret-1' });

      await client().beforeConnect(client());

      expect(authService.getFreshAccessToken).not.toHaveBeenCalled();
      expect(client().connectHeaders).toEqual({
        gameSessionId: 'g1',
        playerSessionId: 'p1',
        playerSecret: 'secret-1',
      });
    });

    it('waits for AuthService start-up before asking for a fresh token (NG-R4-01)', async () => {
      let resolveInit!: () => void;
      authService.whenInitialized.and.returnValue(new Promise<void>(resolve => (resolveInit = resolve)));
      service.initialize('g1', 'p1', {});

      const beforeConnect = client().beforeConnect(client());
      await settle();
      expect(authService.getFreshAccessToken).not.toHaveBeenCalled();

      resolveInit();
      await beforeConnect;

      expect(authService.getFreshAccessToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('SEND headers', () => {
    it('carry only the seat ids, never the playerSecret', async () => {
      service.initialize('g1', 'p1', { playerSecret: 'secret-1' });
      await client().connect();

      service.sendMessage('/app/game/player-incoming-buzz', new SockbowlInMessage());

      const headers = client().sendHeaders(client().publish.calls.count() - 1);
      expect(headers).toEqual({ gameSessionId: 'g1', playerSessionId: 'p1' });
    });

    it('carry Authorization exactly once after tokenChanges$ emits', async () => {
      service.initialize('g1', 'p1', {});
      await client().connect();
      const initial = client().publish.calls.count(); // the get-game request on connect

      service.sendMessage('/app/game/player-incoming-buzz', new SockbowlInMessage());
      tokenChanges.next('token-2');
      service.sendMessage('/app/game/player-incoming-buzz', new SockbowlInMessage());
      service.sendMessage('/app/game/player-incoming-buzz', new SockbowlInMessage());

      expect(client().sendHeaders(initial)['Authorization']).toBeUndefined();
      expect(client().sendHeaders(initial + 1)['Authorization']).toBe('Bearer token-2');
      expect(client().sendHeaders(initial + 2)['Authorization']).toBeUndefined();
      const withAuth = client().publish.calls.all()
        .filter(c => c.args[0].headers?.['Authorization']);
      expect(withAuth.length).toBe(1);
    });

    it('do not resend a token the CONNECT frame already carried', async () => {
      service.initialize('g1', 'p1', {});
      tokenChanges.next('token-1');
      await client().connect();

      service.sendMessage('/app/game/player-incoming-buzz', new SockbowlInMessage());

      const all = client().publish.calls.all();
      expect(all.every(c => !c.args[0].headers?.['Authorization'])).toBeTrue();
    });
  });

  describe('subscriptions', () => {
    it('subscribes to the seat queues and /user/queue/errors on connect', async () => {
      service.initialize('g1', 'p1', { playerSecret: 's' });
      await client().connect();

      const destinations = client().subscribe.calls.allArgs().map(a => a[0]);
      expect(destinations).toEqual(jasmine.arrayWithExactContents([
        '/queue/event/g1/p1',
        '/queue/event/g1',
        '/user/queue/errors',
      ]));
      expect(client().publish.calls.argsFor(0)[0].destination).toBe('/app/game/config/get-game');
    });

    it('emits /user/queue/errors items on errors$ as non-fatal', async () => {
      service.initialize('g1', 'p1', { playerSecret: 's' });
      await client().connect();

      client().handlers['/user/queue/errors']({
        headers: {},
        body: JSON.stringify({ messageType: 'StompError', code: 'RATE_LIMITED', message: 'slow down', retryAfterSeconds: 3 }),
      });

      expect(errors.length).toBe(1);
      expect(errors[0]).toEqual(jasmine.objectContaining({ code: 'RATE_LIMITED', retryAfterSeconds: 3, fatal: false }));
      expect(client().deactivate).not.toHaveBeenCalled();
    });
  });

  describe('fatal codes on /user/queue/errors', () => {
    const queueError = (code: string) => ({
      headers: {},
      body: JSON.stringify({ messageType: 'StompError', code, message: 'detail', retryAfterSeconds: null }),
    });

    it('BANNED mid-game stops reconnecting, deactivates and emits a fatal error', async () => {
      service.initialize('g1', 'p1', {});
      await client().connect();

      client().handlers['/user/queue/errors'](queueError('BANNED'));

      expect(client().reconnectDelay).toBe(0);
      expect(client().deactivate).toHaveBeenCalled();
      expect(client().activate).toHaveBeenCalledTimes(1);
      expect(errors).toEqual([jasmine.objectContaining({ code: 'BANNED', fatal: true })]);
    });

    for (const code of ['INVALID_CREDENTIALS', 'SESSION_NOT_FOUND', 'PLAYER_NOT_IN_SESSION',
      'IDENTITY_MISMATCH', 'FORBIDDEN_DESTINATION']) {
      it(`${code} on the queue is fatal`, async () => {
        service.initialize('g1', 'p1', { playerSecret: 's' });
        await client().connect();

        client().handlers['/user/queue/errors'](queueError(code));

        expect(client().reconnectDelay).toBe(0);
        expect(client().deactivate).toHaveBeenCalled();
        expect(errors).toEqual([jasmine.objectContaining({ code, fatal: true })]);
      });
    }

    it('reads a fatal code from the headers when the body is not JSON', async () => {
      service.initialize('g1', 'p1', { playerSecret: 's' });
      await client().connect();

      client().handlers['/user/queue/errors']({ headers: { 'x-sockbowl-error': 'BANNED' }, body: '' });

      expect(client().deactivate).toHaveBeenCalled();
      expect(errors).toEqual([jasmine.objectContaining({ code: 'BANNED', fatal: true })]);
    });

    it('ignores queue errors from a replaced connection', async () => {
      service.initialize('g1', 'p1', { playerSecret: 's' });
      const first = client();
      await first.connect();
      service.initialize('g2', 'p2', { playerSecret: 's' });

      first.handlers['/user/queue/errors'](queueError('BANNED'));

      expect(errors).toEqual([]);
      expect(client().deactivate).not.toHaveBeenCalled();
    });
  });

  describe('ERROR frames', () => {
    it('BANNED stops reconnecting and emits a fatal error', async () => {
      service.initialize('g1', 'p1', {});
      await client().connect();

      client().onStompError(client().errorFrame('BANNED', 'banned'));

      expect(client().reconnectDelay).toBe(0);
      expect(client().deactivate).toHaveBeenCalled();
      expect(client().activate).toHaveBeenCalledTimes(1);
      expect(errors).toEqual([jasmine.objectContaining({ code: 'BANNED', fatal: true })]);
    });

    for (const code of ['INVALID_CREDENTIALS', 'SESSION_NOT_FOUND', 'PLAYER_NOT_IN_SESSION',
      'IDENTITY_MISMATCH', 'FORBIDDEN_DESTINATION', 'IP_BANNED']) {
      it(`${code} is fatal`, async () => {
        service.initialize('g1', 'p1', { playerSecret: 's' });
        await client().connect();

        client().onStompError(client().errorFrame(code));

        expect(client().reconnectDelay).toBe(0);
        expect(client().deactivate).toHaveBeenCalled();
        expect(errors[0]).toEqual(jasmine.objectContaining({ code, fatal: true }));
      });
    }

    it('reads the code from the headers when the body is not JSON', async () => {
      service.initialize('g1', 'p1', { playerSecret: 's' });
      await client().connect();

      client().onStompError({ command: 'ERROR', headers: { message: 'BANNED' }, body: '' } as unknown as IFrame);

      expect(errors[0]).toEqual(jasmine.objectContaining({ code: 'BANNED', fatal: true }));
    });

    it('TOKEN_EXPIRED refreshes the token and reconnects once', async () => {
      service.initialize('g1', 'p1', {});
      await client().connect();

      client().onStompError(client().errorFrame('TOKEN_EXPIRED'));
      await settle();

      expect(authService.refreshToken).toHaveBeenCalledTimes(1);
      expect(client().deactivate).toHaveBeenCalledTimes(1);
      expect(client().activate).toHaveBeenCalledTimes(2);
      expect(errors).toEqual([]);

      // The reconnect's CONNECT asks for a fresh token again.
      await client().beforeConnect(client());
      expect(authService.getFreshAccessToken).toHaveBeenCalledTimes(2);

      // A second rejection before a successful CONNECT does not loop.
      client().onStompError(client().errorFrame('TOKEN_EXPIRED'));
      await settle();

      expect(authService.refreshToken).toHaveBeenCalledTimes(1);
      expect(client().activate).toHaveBeenCalledTimes(2);
      expect(client().reconnectDelay).toBe(0);
      expect(errors).toEqual([jasmine.objectContaining({ code: 'TOKEN_EXPIRED', fatal: true })]);
    });

    it('AUTH_REQUIRED for an account seat also refreshes and reconnects once', async () => {
      service.initialize('g1', 'p1', {});
      await client().connect();

      client().onStompError(client().errorFrame('AUTH_REQUIRED'));
      await settle();

      expect(authService.refreshToken).toHaveBeenCalledTimes(1);
      expect(client().activate).toHaveBeenCalledTimes(2);
    });

    it('stops when the refresh fails', async () => {
      authService.refreshToken.and.rejectWith(new Error('refresh failed'));
      service.initialize('g1', 'p1', {});
      await client().connect();

      client().onStompError(client().errorFrame('TOKEN_EXPIRED'));
      await settle();

      expect(client().activate).toHaveBeenCalledTimes(1);
      expect(client().reconnectDelay).toBe(0);
      expect(errors).toEqual([jasmine.objectContaining({ code: 'TOKEN_EXPIRED', fatal: true })]);
    });

    it('stops (rather than hanging silently) when refreshToken throws synchronously (NG-R4-01)', async () => {
      authService.refreshToken.and.throwError('boom');
      service.initialize('g1', 'p1', {});
      await client().connect();

      client().onStompError(client().errorFrame('TOKEN_EXPIRED'));
      await settle();

      expect(client().activate).toHaveBeenCalledTimes(1);
      expect(client().reconnectDelay).toBe(0);
      expect(errors).toEqual([jasmine.objectContaining({ code: 'TOKEN_EXPIRED', fatal: true })]);
    });

    it('waits for AuthService start-up before refreshing on TOKEN_EXPIRED (NG-R4-01)', async () => {
      let resolveInit!: () => void;
      service.initialize('g1', 'p1', {});
      await client().connect();
      authService.whenInitialized.and.returnValue(new Promise<void>(resolve => (resolveInit = resolve)));

      client().onStompError(client().errorFrame('TOKEN_EXPIRED'));
      await settle();
      expect(authService.refreshToken).not.toHaveBeenCalled();

      resolveInit();
      await settle();
      expect(authService.refreshToken).toHaveBeenCalledTimes(1);
    });

    it('AUTH_REQUIRED for a guest seat is fatal (no token to refresh)', async () => {
      service.initialize('g1', 'p1', { playerSecret: 's' });
      await client().connect();

      client().onStompError(client().errorFrame('AUTH_REQUIRED'));
      await settle();

      expect(authService.refreshToken).not.toHaveBeenCalled();
      expect(client().activate).toHaveBeenCalledTimes(1);
      expect(errors).toEqual([jasmine.objectContaining({ code: 'AUTH_REQUIRED', fatal: true })]);
    });

    it('INTERNAL keeps the backoff reconnect running and reports a non-fatal error', async () => {
      service.initialize('g1', 'p1', { playerSecret: 's' });
      await client().connect();

      client().onStompError(client().errorFrame('INTERNAL'));

      expect(client().deactivate).not.toHaveBeenCalled();
      expect(client().reconnectDelay).toBe(BASE_RECONNECT_DELAY_MS);
      expect(client().config.reconnectTimeMode).toBeDefined();
      expect(errors).toEqual([jasmine.objectContaining({ code: 'INTERNAL', fatal: false })]);
    });
  });

  describe('RATE_LIMITED reconnect (M4-UI-02)', () => {
    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    it('reconnects at retryAfterSeconds, doubles on repeat trips, caps at 30s, and resets after 60s stable', async () => {
      service.initialize('g1', 'p1', { playerSecret: 's' });
      await client().connect();
      const activations = () => client().activate.calls.count();
      const start = activations();

      client().onStompError(client().errorFrame('RATE_LIMITED', 'slow down', 5, 'stomp-flood'));

      expect(client().deactivate).toHaveBeenCalledTimes(1);
      expect(errors[errors.length - 1]).toEqual(jasmine.objectContaining({ code: 'RATE_LIMITED', fatal: false }));

      jasmine.clock().tick(4999);
      expect(activations()).toBe(start);
      jasmine.clock().tick(1);
      expect(activations()).toBe(start + 1); // 5s floor from retryAfterSeconds
      expect(client().reconnectDelay).toBe(BASE_RECONNECT_DELAY_MS);

      // Trips again before proving stable: the delay doubles (5s -> 10s), ignoring the new retryAfterSeconds.
      await client().connect();
      client().onStompError(client().errorFrame('RATE_LIMITED', 'slow down', 1, 'stomp-flood'));
      jasmine.clock().tick(9999);
      expect(activations()).toBe(start + 1);
      jasmine.clock().tick(1);
      expect(activations()).toBe(start + 2);

      // Keeps doubling (10s -> 20s -> capped at 30s, not 40s).
      await client().connect();
      client().onStompError(client().errorFrame('RATE_LIMITED', 'slow down', 1, 'stomp-flood'));
      jasmine.clock().tick(19999);
      expect(activations()).toBe(start + 2);
      jasmine.clock().tick(1);
      expect(activations()).toBe(start + 3);

      await client().connect();
      client().onStompError(client().errorFrame('RATE_LIMITED', 'slow down', 1, 'stomp-flood'));
      jasmine.clock().tick(29999);
      expect(activations()).toBe(start + 3);
      jasmine.clock().tick(1);
      expect(activations()).toBe(start + 4); // capped at 30s

      // Stays connected for the full 60s stability window: the next trip starts over at its own floor.
      await client().connect();
      jasmine.clock().tick(RATE_LIMIT_STABLE_MS);
      client().onStompError(client().errorFrame('RATE_LIMITED', 'slow down', 3, 'stomp-flood'));
      jasmine.clock().tick(2999);
      expect(activations()).toBe(start + 4);
      jasmine.clock().tick(1);
      expect(activations()).toBe(start + 5);
    });

    it('does not reset the backoff if a trip lands before the connection is stable for 60s', async () => {
      service.initialize('g1', 'p1', { playerSecret: 's' });
      await client().connect();
      const activations = () => client().activate.calls.count();
      const start = activations();

      client().onStompError(client().errorFrame('RATE_LIMITED', 'slow down', 5, 'stomp-flood'));
      jasmine.clock().tick(5000);
      expect(activations()).toBe(start + 1);

      await client().connect();
      jasmine.clock().tick(RATE_LIMIT_STABLE_MS - 1); // one tick short of stable
      client().onStompError(client().errorFrame('RATE_LIMITED', 'slow down', 1, 'stomp-flood'));

      jasmine.clock().tick(9999); // would be 10s (doubled), not the 1s the frame asked for
      expect(activations()).toBe(start + 1);
      jasmine.clock().tick(1);
      expect(activations()).toBe(start + 2);
    });

    it('adds jitter on top of the base delay', async () => {
      rateLimitJitter.and.returnValue(1); // max jitter: 20% on top of the 5s floor
      service.initialize('g1', 'p1', { playerSecret: 's' });
      await client().connect();
      const activations = () => client().activate.calls.count();
      const start = activations();

      client().onStompError(client().errorFrame('RATE_LIMITED', 'slow down', 5, 'stomp-flood'));

      jasmine.clock().tick(5999);
      expect(activations()).toBe(start);
      jasmine.clock().tick(1);
      expect(activations()).toBe(start + 1);
    });

    it('clamps the jittered delay to the 30s cap', async () => {
      rateLimitJitter.and.returnValue(1);
      service.initialize('g1', 'p1', { playerSecret: 's' });
      await client().connect();
      const activations = () => client().activate.calls.count();
      const start = activations();

      // retryAfterSeconds of 30 with max jitter would be 36s without the cap.
      client().onStompError(client().errorFrame('RATE_LIMITED', 'slow down', 30, 'stomp-flood'));

      jasmine.clock().tick(29999);
      expect(activations()).toBe(start);
      jasmine.clock().tick(1);
      expect(activations()).toBe(start + 1);
    });
  });

  it('replaces the previous connection on re-initialize', () => {
    service.initialize('g1', 'p1', { playerSecret: 's' });
    const first = client();

    service.initialize('g2', 'p2', { playerSecret: 't' });

    expect(first.deactivate).toHaveBeenCalled();
    expect(clients.length).toBe(2);
  });
});
