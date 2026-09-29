import {DestroyRef, inject, Injectable, InjectionToken} from '@angular/core';
import {BehaviorSubject, Observable, Subject} from 'rxjs';
import {Client, IFrame, Message, ReconnectionTimeMode, StompConfig} from "@stomp/stompjs";
import {SockbowlInMessage, StompError} from "../models/sockbowl/sockbowl-interfaces";
import {environment} from "../../../environments/environment";
import {AuthService} from "../../core/auth/auth.service";
import {FATAL_STOMP_CODES, parseStompError, TOKEN_STOMP_CODES} from "../models/stomp-errors";

/** Builds the STOMP client. Swapped for a fake in unit tests. */
export type StompClientFactory = (config: StompConfig) => Client;

export const STOMP_CLIENT_FACTORY = new InjectionToken<StompClientFactory>('STOMP_CLIENT_FACTORY', {
  providedIn: 'root',
  factory: () => (config: StompConfig) => new Client(config),
});

/**
 * How the socket proves who the player is at CONNECT.
 * - `playerSecret` present: a guest seat; the secret goes in the CONNECT frame.
 * - absent: a seat bound to the signed-in account; a fresh access token goes
 *   in the CONNECT frame (`Authorization: Bearer …`).
 */
export interface SocketCredentials {
  playerSecret?: string;
}

/**
 * The socket's connection lifecycle, additive to {@link GameWebSocketService.errors$}
 * (M5 S1-03). `connecting` is the initial/first-attempt state; `reconnecting` is a
 * previously-`connected` socket that dropped and is being brought back (a dropped
 * Wi-Fi link, a server restart) as opposed to a deliberate stop. Consumers (the
 * canvas's connection strip, the buzzer's disabled dome) use this so a silent
 * disconnect is never mistaken for a live, open buzzer.
 */
export type GameConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'closed';

/** First reconnect delay after a dropped socket or an INTERNAL error. */
export const BASE_RECONNECT_DELAY_MS = 2000;
/** Cap for the exponential reconnect backoff. */
export const MAX_RECONNECT_DELAY_MS = 30000;
/** How long a connection must stay up before a RATE_LIMITED backoff resets (M4-UI-02). */
export const RATE_LIMIT_STABLE_MS = 60000;
/** Extra random delay added on top of each RATE_LIMITED backoff step, as a fraction of it. */
export const RATE_LIMIT_JITTER_RATIO = 0.2;

/** Source of the jitter fraction (`[0, 1)`) added to a RATE_LIMITED reconnect delay. Swapped for a fixed value in tests. */
export type RateLimitJitterFn = () => number;

export const RATE_LIMIT_JITTER = new InjectionToken<RateLimitJitterFn>('RATE_LIMIT_JITTER', {
  providedIn: 'root',
  factory: () => () => Math.random(),
});

/**
 * GameWebSocketService
 *
 * Owns the STOMP connection to the game server (M2 plan section 2.5):
 * - credentials go in the CONNECT frame only, built in `beforeConnect` so every
 *   reconnect gets a fresh access token (AUTH-12);
 * - SEND frames carry only `gameSessionId`/`playerSessionId`, plus
 *   `Authorization` exactly once after the token was refreshed, so the server
 *   can extend the session's token expiry;
 * - ERROR frames are mapped per the ng contract: fatal codes stop reconnecting,
 *   TOKEN_EXPIRED/AUTH_REQUIRED refresh and reconnect once, INTERNAL backs off;
 * - `/user/queue/errors` items are non-fatal unless their code is fatal (e.g.
 *   BANNED mid-game), which stops the connection like an ERROR frame;
 * - non-fatal and fatal errors both surface on {@link errors$}.
 */
@Injectable({
  providedIn: 'root',
})
export class GameWebSocketService {
  private authService = inject(AuthService);
  private clientFactory = inject(STOMP_CLIENT_FACTORY);
  private rateLimitJitter = inject(RATE_LIMIT_JITTER);

  // Stomp.js client for handling STOMP over WebSocket
  private stompClient?: Client;

  // BehaviorSubject to hold the latest message received via WebSocket
  private messageSubject = new BehaviorSubject<Message | null>(null);

  // Observable exposed to subscribers interested in received messages
  public messageObservable$ = this.messageSubject.asObservable();

  private errorsSubject = new Subject<StompError>();
  /** STOMP errors: ERROR frames and `/user/queue/errors` items, flagged `fatal` when the seat is over. */
  public readonly errors$: Observable<StompError> = this.errorsSubject.asObservable();

  private connectionStateSubject = new BehaviorSubject<GameConnectionState>('closed');
  /** The socket's current lifecycle state (M5 S1-03); see {@link GameConnectionState}. */
  public readonly connectionState$: Observable<GameConnectionState> = this.connectionStateSubject.asObservable();

  private gameSessionId = '';
  private playerSessionId = '';
  private credentials: SocketCredentials = {};

  /** The access token the server last saw (CONNECT or a SEND). */
  private lastSentToken: string | null = null;
  /** The newest token from a refresh, not yet sent on this connection. */
  private latestToken: string | null = null;
  /** Whether the one token-refresh reconnect was spent since the last CONNECTED. */
  private tokenRetryUsed = false;

  /**
   * The current RATE_LIMITED backoff step in ms, or null when the connection
   * is stable (no reconnect currently owed to a rate limit). Doubles (capped
   * at {@link MAX_RECONNECT_DELAY_MS}) on each RATE_LIMITED that lands before
   * {@link RATE_LIMIT_STABLE_MS} of stable connection resets it to null.
   */
  private rateLimitBackoffMs: number | null = null;
  private rateLimitReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private rateLimitStableTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Connection is deferred until initialize() supplies the session context.
    const sub = this.authService.tokenChanges$?.subscribe(token => {
      this.latestToken = token;
    });
    inject(DestroyRef).onDestroy(() => sub?.unsubscribe());
  }

  /** Whether this seat authenticates with the signed-in account's token. */
  private get usesToken(): boolean {
    return !this.credentials.playerSecret;
  }

  /**
   * Opens the STOMP connection for a game seat, replacing any previous one.
   *
   * @param gameSessionId the game session
   * @param playerSessionId the player's seat in that session
   * @param credentials `playerSecret` for a guest seat; empty for a seat
   *   bound to the signed-in account (the token comes from AuthService)
   */
  public initialize(gameSessionId: string, playerSessionId: string, credentials: SocketCredentials = {}) {
    this.stompClient?.deactivate();
    this.clearRateLimitTimers();

    this.gameSessionId = gameSessionId;
    this.playerSessionId = playerSessionId;
    this.credentials = {...credentials};
    this.lastSentToken = null;
    this.latestToken = null;
    this.tokenRetryUsed = false;
    this.rateLimitBackoffMs = null;
    this.connectionStateSubject.next('connecting');

    const client = this.clientFactory({
      brokerURL: environment.wsUrl,
      reconnectDelay: BASE_RECONNECT_DELAY_MS,
      reconnectTimeMode: ReconnectionTimeMode.EXPONENTIAL,
      maxReconnectDelay: MAX_RECONNECT_DELAY_MS,
    });
    client.beforeConnect = () => this.buildConnectHeaders(client);
    client.onConnect = () => this.onConnected(client);
    client.onStompError = (frame: IFrame) => this.onStompError(client, frame);
    client.onWebSocketClose = () => this.onSocketClosed(client);
    this.stompClient = client;

    // Activate the client to initiate the connection
    client.activate();
  }

  /** Stops the connection and any reconnect attempts. */
  public disconnect(): void {
    this.clearRateLimitTimers();
    const client = this.stompClient;
    if (client) {
      client.reconnectDelay = 0;
      client.deactivate();
    }
    this.connectionStateSubject.next('closed');
  }

  public sendMessage(path: string, value: SockbowlInMessage) {
    const client = this.stompClient;
    if (!client) {
      console.warn('[GameWebSocketService] sendMessage before initialize:', path);
      return;
    }
    client.publish({
      destination: path,
      body: JSON.stringify(value ?? {}),
      headers: this.sendHeaders(),
    });
  }

  /**
   * Headers for a SEND. `Authorization` rides along only on the first SEND
   * after a token refresh (the server decodes it and extends the seat's token
   * expiry); otherwise only the seat identifiers are sent.
   */
  private sendHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      gameSessionId: this.gameSessionId,
      playerSessionId: this.playerSessionId,
    };
    if (this.usesToken && this.latestToken && this.latestToken !== this.lastSentToken) {
      headers['Authorization'] = `Bearer ${this.latestToken}`;
      this.lastSentToken = this.latestToken;
    }
    return headers;
  }

  /** `beforeConnect`: runs before every CONNECT, including reconnects. */
  private async buildConnectHeaders(client: Client): Promise<void> {
    // Wait out start-up (discovery, the login callback, the reload refresh)
    // so a CONNECT racing app boot doesn't read a token AuthService hasn't
    // finished loading yet (NG-R4-01). A no-op once auth is off or ready.
    await this.authService.whenInitialized();
    const headers: Record<string, string> = {
      gameSessionId: this.gameSessionId,
      playerSessionId: this.playerSessionId,
    };
    if (this.usesToken) {
      const token = await this.authService.getFreshAccessToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      this.lastSentToken = token;
      this.latestToken = token;
    } else {
      headers['playerSecret'] = this.credentials.playerSecret as string;
    }
    client.connectHeaders = headers;
  }

  private onConnected(client: Client): void {
    this.tokenRetryUsed = false;
    this.connectionStateSubject.next('connected');

    // A RATE_LIMITED backoff is still owed until the connection proves it's
    // stable; only then does the next RATE_LIMITED start over from scratch.
    if (this.rateLimitBackoffMs !== null) {
      this.rateLimitStableTimer = setTimeout(() => {
        this.rateLimitStableTimer = null;
        this.rateLimitBackoffMs = null;
      }, RATE_LIMIT_STABLE_MS);
    }

    // Subscribe to a specific queue for game and player session events
    client.subscribe(`/queue/event/${this.gameSessionId}/${this.playerSessionId}`, message => {
      this.messageSubject.next(message);
    });

    // Subscribe to a general queue for game session events
    client.subscribe(`/queue/event/${this.gameSessionId}`, message => {
      this.messageSubject.next(message);
    });

    // Errors from message handlers. Most are non-fatal (the socket stays
    // open), but a fatal code here - e.g. BANNED arriving mid-game when a
    // moderator bans the player - ends the seat exactly like an ERROR frame:
    // stop reconnecting and report it as fatal so the canvas leaves the game.
    client.subscribe('/user/queue/errors', message => {
      if (client !== this.stompClient) {
        return;
      }
      const error = parseStompError(message.body, message.headers);
      if (FATAL_STOMP_CODES.has(error.code)) {
        this.stop(client, error);
        return;
      }
      this.errorsSubject.next({...error, fatal: false});
    });

    // Publish an initial message to get the game configuration
    client.publish({
      destination: '/app/game/config/get-game',
      headers: this.sendHeaders(),
    });
  }

  /**
   * An ERROR frame: the server is about to close the socket. Decide whether to
   * give up (fatal), refresh and reconnect once (token), or let the client's
   * exponential backoff reconnect (INTERNAL and anything unknown).
   */
  private onStompError(client: Client, frame: IFrame): void {
    if (client !== this.stompClient) {
      return;
    }
    const error = parseStompError(frame.body, frame.headers);

    if (TOKEN_STOMP_CODES.has(error.code) && this.usesToken && environment.authEnabled) {
      if (!this.tokenRetryUsed) {
        this.tokenRetryUsed = true;
        void this.refreshAndReconnect(client, error);
        return;
      }
      this.stop(client, error);
      return;
    }

    if (FATAL_STOMP_CODES.has(error.code) || TOKEN_STOMP_CODES.has(error.code)) {
      this.stop(client, error);
      return;
    }

    if (error.code === 'RATE_LIMITED') {
      this.scheduleRateLimitedReconnect(client, error);
      return;
    }

    // INTERNAL (or a code this build doesn't know): the socket closes and the
    // client reconnects with exponential backoff.
    this.errorsSubject.next({...error, fatal: false});
  }

  /**
   * A hard RATE_LIMITED rejection (M4-UI-02, e.g. the `stomp-flood` bucket):
   * the server already closed the socket. Reconnect after a delay that
   * starts at the server's `retryAfterSeconds`, doubles (with jitter) on each
   * RATE_LIMITED that lands before the connection is stable again, and is
   * capped at {@link MAX_RECONNECT_DELAY_MS}. `onConnected` clears the
   * backoff once the connection has stayed up for {@link RATE_LIMIT_STABLE_MS}.
   */
  private scheduleRateLimitedReconnect(client: Client, error: StompError): void {
    this.clearRateLimitTimers();

    const floorMs = Math.max(error.retryAfterSeconds ?? 1, 1) * 1000;
    const nextDelayMs = Math.min(
      this.rateLimitBackoffMs !== null ? this.rateLimitBackoffMs * 2 : floorMs,
      MAX_RECONNECT_DELAY_MS,
    );
    this.rateLimitBackoffMs = nextDelayMs;

    const jitterMs = nextDelayMs * RATE_LIMIT_JITTER_RATIO * this.rateLimitJitter();
    const delayMs = Math.min(nextDelayMs + jitterMs, MAX_RECONNECT_DELAY_MS);

    // We drive the reconnect ourselves; stop stompjs' own retry so the two
    // don't race.
    client.reconnectDelay = 0;
    client.deactivate();
    this.errorsSubject.next({...error, fatal: false});

    this.rateLimitReconnectTimer = setTimeout(() => {
      this.rateLimitReconnectTimer = null;
      if (client !== this.stompClient) {
        return;
      }
      client.reconnectDelay = BASE_RECONNECT_DELAY_MS;
      client.activate();
    }, delayMs);
  }

  private clearRateLimitTimers(): void {
    if (this.rateLimitReconnectTimer) {
      clearTimeout(this.rateLimitReconnectTimer);
      this.rateLimitReconnectTimer = null;
    }
    if (this.rateLimitStableTimer) {
      clearTimeout(this.rateLimitStableTimer);
      this.rateLimitStableTimer = null;
    }
  }

  private async refreshAndReconnect(client: Client, error: StompError): Promise<void> {
    await client.deactivate();
    await this.authService.whenInitialized();
    // try/catch, not `.catch()` chained onto the call: AuthService.refreshToken
    // is documented to always return a promise, but this must still fall
    // through to stop() rather than leave an unhandled rejection if it (or a
    // test double standing in for it) ever throws synchronously (NG-R4-01).
    let token: string | null;
    try {
      token = await this.authService.refreshToken();
    } catch {
      token = null;
    }
    if (client !== this.stompClient) {
      return;
    }
    if (!token) {
      this.stop(client, error);
      return;
    }
    client.activate();
  }

  /** Stop reconnecting and report the error as fatal. */
  private stop(client: Client, error: StompError): void {
    client.reconnectDelay = 0;
    client.deactivate();
    this.connectionStateSubject.next('closed');
    this.errorsSubject.next({...error, fatal: true});
  }

  /**
   * The underlying WebSocket closed. If it had been `connected`, this is an
   * unplanned drop (Wi-Fi, a server restart) and stompjs' own reconnect (or
   * our RATE_LIMITED backoff) will bring it back, so this reports
   * `reconnecting`. A close while still `connecting` (the first attempt
   * hasn't succeeded yet) or after a deliberate `stop`/`disconnect` (already
   * `closed`) leaves the state as-is, since neither is a new event worth
   * announcing.
   */
  private onSocketClosed(client: Client): void {
    if (client !== this.stompClient) {
      return;
    }
    if (this.connectionStateSubject.value === 'connected') {
      this.connectionStateSubject.next('reconnecting');
    }
  }
}
