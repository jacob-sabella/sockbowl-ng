import { Client, type IMessage } from '@stomp/stompjs';
import WebSocket from 'ws';
import { WS_URL } from './config.js';

type Listener = () => void;

/**
 * A headless Sockbowl game client. Speaks the same STOMP protocol the Angular
 * app does — connects, subscribes to the private + broadcast queues, tracks the
 * latest game session state, and exposes every player/proctor action. Used to
 * fill player/team seats and drive full matches without a browser.
 */
export class SockbowlBot {
  private client!: Client;
  gameSession: any = null;
  private listeners: Listener[] = [];

  constructor(
    public readonly name: string,
    public readonly gameSessionId: string,
    public readonly playerSecret: string,
    public readonly playerSessionId: string,
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client = new Client({
        webSocketFactory: () => new WebSocket(WS_URL) as any,
        reconnectDelay: 0,
        heartbeatIncoming: 0,
        heartbeatOutgoing: 0,
        onConnect: () => {
          this.client.subscribe(`/queue/event/${this.gameSessionId}/${this.playerSessionId}`, (m) => this.handle(m));
          this.client.subscribe(`/queue/event/${this.gameSessionId}`, (m) => this.handle(m));
          this.publish('/app/game/config/get-game', {});
          resolve();
        },
        onStompError: (f) => reject(new Error(`[${this.name}] STOMP error: ${f.body}`)),
        onWebSocketError: (e) => reject(new Error(`[${this.name}] WS error: ${e?.message ?? e}`)),
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
    }
    this.listeners.forEach((l) => l());
  }

  publish(destination: string, body: unknown) {
    this.client.publish({
      destination,
      body: JSON.stringify(body ?? {}),
      headers: {
        gameSessionId: this.gameSessionId,
        playerSessionId: this.playerSessionId,
        playerSecret: this.playerSecret,
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
