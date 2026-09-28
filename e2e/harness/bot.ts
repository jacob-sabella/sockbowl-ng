import { Client, type IMessage } from '@stomp/stompjs';
import WebSocket from 'ws';
import { WS_URL } from './config.js';

type Listener = () => void;

/**
 * A STOMP error from the game server: the JSON body of an ERROR frame (the
 * server then closes the socket) or a message on /user/queue/errors.
 * `code` is UPPER_SNAKE (AUTH_REQUIRED, INVALID_CREDENTIALS, TOKEN_EXPIRED,
 * BANNED, SESSION_NOT_FOUND, PLAYER_NOT_IN_SESSION, IDENTITY_MISMATCH,
 * FORBIDDEN_DESTINATION, INTERNAL, and later milestones' additions).
 */
export interface BotStompError {
  code: string;
  message?: string | null;
  retryAfterSeconds?: number | null;
  fatal: boolean;
}

/** Thrown from connect() when the server answers CONNECT with an ERROR frame. */
export class StompConnectError extends Error {
  constructor(public readonly botName: string, public readonly stompError: BotStompError) {
    super(`[${botName}] STOMP ${stompError.code}${stompError.message ? ': ' + stompError.message : ''}`);
  }
}

function parseStompError(body: string | undefined, headers: Record<string, string>, fatal: boolean): BotStompError {
  let parsed: any = null;
  try { parsed = body ? JSON.parse(body) : null; } catch { parsed = null; }
  const code = (parsed && typeof parsed.code === 'string' && parsed.code)
    || headers['x-sockbowl-error']
    || headers['message']
    || 'INTERNAL';
  return { code, message: parsed?.message ?? (parsed ? null : body ?? null), retryAfterSeconds: parsed?.retryAfterSeconds ?? null, fatal };
}

/**
 * A headless Sockbowl game client. Speaks the same STOMP protocol the Angular
 * app does — authenticates in the CONNECT frame (guest `playerSecret`, or a
 * Keycloak access token for a seat joined as an account), subscribes to the
 * private + broadcast queues and /user/queue/errors, tracks the latest game
 * session state, and exposes every player/proctor action. Used to fill
 * player/team seats and drive full matches without a browser.
 */
export class SockbowlBot {
  private client!: Client;
  gameSession: any = null;
  /** Every STOMP error seen (fatal ERROR frames and /user/queue/errors). */
  readonly errors: BotStompError[] = [];
  /**
   * Every `ProcessError` game message seen on this bot's private event queue
   * (`messageContentType: "ProcessError"`, e.g. `SetMatchPacket` rejecting a
   * DRAFT the sender may not use with `code: "PACKET_NOT_AVAILABLE"`, M3 E1).
   * Distinct from `errors`, which is STOMP-frame-level (auth/connect) only —
   * a ProcessError is a normal application message on the game event queue,
   * not a STOMP ERROR frame or a `/user/queue/errors` item.
   */
  readonly processErrors: { code: string | null; error: string | null }[] = [];
  private listeners: Listener[] = [];

  /**
   * @param playerSecret guest seat secret (sent only in CONNECT)
   * @param accessToken  for a seat joined via join-game-session-authenticated:
   *   the Keycloak access token sent as `Authorization: Bearer` in CONNECT
   *   instead of the secret
   */
  constructor(
    public readonly name: string,
    public readonly gameSessionId: string,
    public readonly playerSecret: string,
    public readonly playerSessionId: string,
    public readonly accessToken?: string,
  ) {}

  /** Headers of the CONNECT frame: the only frame that carries credentials. */
  connectHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      gameSessionId: this.gameSessionId,
      playerSessionId: this.playerSessionId,
    };
    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;
    else headers['playerSecret'] = this.playerSecret;
    return headers;
  }

  /** The most recent STOMP error, if any. */
  get lastError(): BotStompError | undefined { return this.errors[this.errors.length - 1]; }

  /** The most recent `ProcessError` game message, if any. */
  get lastProcessError(): { code: string | null; error: string | null } | undefined {
    return this.processErrors[this.processErrors.length - 1];
  }

  /** Resolve once a `ProcessError` with the given `code` has been seen, else reject after `timeoutMs`. */
  waitForProcessError(code: string, timeoutMs = 8000): Promise<{ code: string | null; error: string | null }> {
    return new Promise((resolve, reject) => {
      const already = this.processErrors.find((e) => e.code === code);
      if (already) { resolve(already); return; }
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`[${this.name}] waitForProcessError timeout (${code}); seen=${JSON.stringify(this.processErrors)}`));
      }, timeoutMs);
      const check = () => {
        const found = this.processErrors.find((e) => e.code === code);
        if (found) { cleanup(); resolve(found); }
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners = this.listeners.filter((l) => l !== check);
      };
      this.listeners.push(check);
      check();
    });
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let connected = false;
      this.client = new Client({
        webSocketFactory: () => new WebSocket(WS_URL) as any,
        connectHeaders: this.connectHeaders(),
        reconnectDelay: 0,
        heartbeatIncoming: 0,
        heartbeatOutgoing: 0,
        onConnect: () => {
          connected = true;
          this.client.subscribe(`/queue/event/${this.gameSessionId}/${this.playerSessionId}`, (m) => this.handle(m));
          this.client.subscribe(`/queue/event/${this.gameSessionId}`, (m) => this.handle(m));
          this.client.subscribe('/user/queue/errors', (m) => {
            this.errors.push(parseStompError(m.body, m.headers, false));
            this.listeners.forEach((l) => l());
          });
          this.publish('/app/game/config/get-game', {});
          resolve();
        },
        onStompError: (f) => {
          const error = parseStompError(f.body, f.headers, true);
          this.errors.push(error);
          // ERROR frames are fatal: the server closes the socket. Never retry.
          this.client.deactivate();
          if (!connected) reject(new StompConnectError(this.name, error));
          else this.listeners.forEach((l) => l());
        },
        onWebSocketError: (e) => { if (!connected) reject(new Error(`[${this.name}] WS error: ${e?.message ?? e}`)); },
      });
      this.client.activate();
    });
  }

  private handle(message: IMessage) {
    let parsed: any;
    try { parsed = JSON.parse(message.body); } catch { return; }
    const batch = parsed?.messageContentType === 'SockbowlMultiOutMessage' && Array.isArray(parsed.sockbowlOutMessages)
      ? parsed.sockbowlOutMessages
      : [parsed];
    for (const m of batch) {
      // GameSessionUpdate carries the whole session; keep the freshest snapshot.
      if (m?.gameSession) this.gameSession = m.gameSession;
      if (m?.messageContentType === 'ProcessError') {
        this.processErrors.push({ code: m.code ?? null, error: m.error ?? null });
      }
    }
    this.listeners.forEach((l) => l());
  }

  publish(destination: string, body: unknown) {
    this.client.publish({
      destination,
      body: JSON.stringify(body ?? {}),
      // SEND frames carry only the seat ids; the server binds the identity
      // proven at CONNECT to the socket.
      headers: {
        gameSessionId: this.gameSessionId,
        playerSessionId: this.playerSessionId,
      },
    });
  }

  /**
   * Resolve once the game session satisfies `pred`, else reject after
   * `timeoutMs`. Config/round changes broadcast as partial messages that don't
   * carry a full session, so we re-request the full state every `refreshMs`
   * while waiting to keep the snapshot converged.
   */
  waitFor(pred: (gs: any) => boolean, timeoutMs = 12000, label = '', refreshMs = 900): Promise<any> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.gameSession && pred(this.gameSession)) { cleanup(); resolve(this.gameSession); }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`[${this.name}] waitFor timeout${label ? ' (' + label + ')' : ''}; last roundState=${this.roundState}, matchState=${this.matchState}`));
      }, timeoutMs);
      const poller = refreshMs > 0 ? setInterval(() => { this.refresh(); check(); }, refreshMs) : null;
      const cleanup = () => {
        clearTimeout(timer);
        if (poller) clearInterval(poller);
        this.listeners = this.listeners.filter((l) => l !== check);
      };
      this.listeners.push(check);
      check();
    });
  }

  /** Ask the server to re-broadcast the full session (useful to refresh state). */
  refresh() { this.publish('/app/game/config/get-game', {}); }

  get matchState(): string | undefined { return this.gameSession?.currentMatch?.matchState; }
  get roundState(): string | undefined { return this.gameSession?.currentMatch?.currentRound?.roundState; }
  get teams(): any[] { return this.gameSession?.teamList ?? []; }

  // ---- config actions ----
  joinTeam(teamId: string) { this.publish('/app/game/config/update-player-team', { targetPlayer: this.playerSessionId, targetTeam: teamId }); }
  becomeProctor() { this.publish('/app/game/config/set-proctor', { targetPlayer: this.playerSessionId }); }
  setPacket(packetId: string) { this.publish('/app/game/config/set-match-packet', { packetId }); }

  // ---- progression / proctor actions ----
  startMatch() { this.publish('/app/game/progression/start-match', {}); }
  endMatch() { this.publish('/app/game/progression/end-match', {}); }
  finishedReading() { this.publish('/app/game/finished-reading', {}); }
  judge(correct: boolean) { this.publish('/app/game/answer-outcome', { correct }); }
  advanceRound() { this.publish('/app/game/advance-round', {}); }
  timeoutRound() { this.publish('/app/game/timeout-round', {}); }
  finishedBonusPreamble() { this.publish('/app/game/finished-reading-bonus-preamble', {}); }
  finishedBonusPart() { this.publish('/app/game/finished-reading-bonus-part', {}); }
  bonusPartOutcome(partIndex: number, correct: boolean) { this.publish('/app/game/bonus-part-outcome', { partIndex, correct }); }

  // ---- player actions ----
  buzz() { this.publish('/app/game/player-incoming-buzz', {}); }

  disconnect() { try { this.client?.deactivate(); } catch { /* ignore */ } }
}

/** Join a bot into an existing game by code and connect it. */
export async function spawnBot(joinByCode: (code: string, name: string) => Promise<any>, joinCode: string, name: string): Promise<SockbowlBot> {
  const j = await joinByCode(joinCode, name);
  const bot = new SockbowlBot(name, j.gameSessionId, j.playerSecret, j.playerSessionId);
  await bot.connect();
  return bot;
}
