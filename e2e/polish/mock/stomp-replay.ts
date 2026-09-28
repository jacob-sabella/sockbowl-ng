/**
 * M5 H0: `page.routeWebSocket` replay of a minimal STOMP 1.2 server, so the
 * in-game surfaces (S1/S2/S3) can be captured with no live game backend
 * (M5 plan §4). This is the **mock** transport: it never talks to a real
 * server. The fixtures it replays are meant to come from `record-stomp.ts`,
 * run once against a live stack under the fullstack lock (H0 PENDING-LOCK —
 * see that file's header); until then, callers pass hand-authored frames
 * (see `polish/fixtures/stomp/self-check.json`), which are clearly not a
 * substitute for the real recording and are never used for a `final`/`v1`
 * capture.
 *
 * Protocol coverage is deliberately narrow — exactly what
 * `game-web-socket.service.ts` needs:
 *   - CONNECT/STOMP -> CONNECTED (heart-beat 0,0, so no ticker starts on
 *     either side and this file doesn't have to answer heartbeats).
 *   - SUBSCRIBE -> remembered (destination -> subscription id).
 *   - SEND `/app/game/config/get-game` -> replays `frames` in order onto the
 *     matching subscribed destination.
 *   - DISCONNECT with a `receipt` header -> RECEIPT.
 *   - ERROR frames: pass `frames` entries with `kind: 'error'` to send a raw
 *     STOMP ERROR frame instead of a MESSAGE (fatal STOMP codes, M2 plan
 *     2.5 / M5 plan §2's "fatal ERROR frame" states).
 * Every other SEND (buzz, judge, reorder, ...) is a no-op in replay mode: a
 * scenario that needs a *reaction* to a client action records a separate
 * fixture ending in the post-action state, rather than this mock trying to
 * simulate game logic.
 */
import type { Page } from '@playwright/test';

export interface ReplayFrame {
  /** `self`: the seat's own queue; `broadcast`: the whole session's queue. */
  target: 'self' | 'broadcast';
  kind?: 'message' | 'error';
  /** JSON body. For `kind: 'message'` this must include `messageContentType` (see `game-message.service.ts`). */
  body: Record<string, unknown>;
  /** Delay before sending, relative to the previous frame (or CONNECT for the first). */
  delayMs?: number;
}

export interface StompReplayOptions {
  gameSessionId: string;
  playerSessionId: string;
  frames: ReplayFrame[];
  /** Defaults to the mock game origin's socket path (`mock/config.ts`'s `MOCK_WS_URL`). */
  wsUrlGlob?: string;
}

interface ParsedFrame {
  command: string;
  headers: Record<string, string>;
  body: string;
}

function parseFrames(buffer: string): { frames: ParsedFrame[]; rest: string } {
  const frames: ParsedFrame[] = [];
  let rest = buffer;
  let nul: number;
  while ((nul = rest.indexOf('\0')) !== -1) {
    const raw = rest.slice(0, nul).replace(/^\n+/, ''); // leading heartbeats are bare '\n's
    rest = rest.slice(nul + 1);
    if (!raw) continue;
    const blankAt = raw.indexOf('\n\n');
    const head = blankAt === -1 ? raw : raw.slice(0, blankAt);
    const body = blankAt === -1 ? '' : raw.slice(blankAt + 2);
    const lines = head.split('\n');
    const command = lines[0];
    const headers: Record<string, string> = {};
    for (const line of lines.slice(1)) {
      const c = line.indexOf(':');
      if (c === -1) continue;
      headers[line.slice(0, c)] = line.slice(c + 1);
    }
    frames.push({ command, headers, body });
  }
  return { frames, rest };
}

function marshal(command: string, headers: Record<string, string>, body = ''): string {
  const headerLines = Object.entries(headers).map(([k, v]) => `${k}:${v}`).join('\n');
  const contentLength = Buffer.byteLength(body, 'utf8');
  const withLength = body ? `${headerLines}\ncontent-length:${contentLength}` : headerLines;
  return `${command}\n${withLength}\n\n${body}\0`;
}

/** Registers the STOMP mock. Call before `page.goto`. */
export async function mockStompReplay(page: Page, opts: StompReplayOptions): Promise<void> {
  const glob = opts.wsUrlGlob ?? '**/sockbowl-game**';
  await page.routeWebSocket(glob, ws => {
    let buffer = '';
    const subsByDestination = new Map<string, string>();
    let delivered = false;

    const destinationFor = (target: 'self' | 'broadcast') =>
      target === 'self'
        ? `/queue/event/${opts.gameSessionId}/${opts.playerSessionId}`
        : `/queue/event/${opts.gameSessionId}`;

    async function deliver(): Promise<void> {
      if (delivered) return; // get-game can be re-sent by a reconnect; replay the script once
      delivered = true;
      for (const frame of opts.frames) {
        if (frame.delayMs) await new Promise(resolve => setTimeout(resolve, frame.delayMs));
        const dest = destinationFor(frame.target);
        const subId = subsByDestination.get(dest);
        if (!subId) continue; // client hasn't subscribed there (yet); drop rather than hang the test
        if (frame.kind === 'error') {
          ws.send(marshal('ERROR', { 'message': String(frame.body['message'] ?? 'mock error'), 'content-type': 'application/json' }, JSON.stringify(frame.body)));
          continue;
        }
        ws.send(marshal('MESSAGE', {
          subscription: subId,
          'message-id': `mock-${Math.random().toString(36).slice(2, 10)}`,
          destination: dest,
          'content-type': 'application/json',
        }, JSON.stringify(frame.body)));
      }
    }

    ws.onMessage(message => {
      buffer += typeof message === 'string' ? message : message.toString('utf8');
      const { frames, rest } = parseFrames(buffer);
      buffer = rest;
      for (const f of frames) {
        switch (f.command) {
          case 'CONNECT':
          case 'STOMP':
            ws.send(marshal('CONNECTED', { version: '1.2', 'heart-beat': '0,0' }));
            break;
          case 'SUBSCRIBE':
            if (f.headers['destination'] && f.headers['id']) {
              subsByDestination.set(f.headers['destination'], f.headers['id']);
            }
            break;
          case 'SEND':
            if (f.headers['destination'] === '/app/game/config/get-game') {
              void deliver();
            }
            break;
          case 'DISCONNECT':
            if (f.headers['receipt']) {
              ws.send(marshal('RECEIPT', { 'receipt-id': f.headers['receipt'] }));
            }
            break;
          default:
            break;
        }
      }
    });
  });
}
