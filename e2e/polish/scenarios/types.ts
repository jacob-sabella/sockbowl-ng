import type { Page } from '@playwright/test';
import type { MockRole } from '../mock/oidc.js';

/** One state row of a surface's §2 state list (M5 plan §2/§4/§6). */
export interface CaptureState {
  /** Short, stable id; becomes part of the manifest key and the screenshot filename. */
  id: string;
  /** Route to navigate to, relative to the app origin, e.g. `/packets`. */
  route: string;
  role: MockRole;
  /** Default true (the M5 plan's "Auth: on" axis; only S6 needs `false`). */
  authEnabled?: boolean;
  /** Viewport keys from `manifest.ts`'s `VIEWPORTS`. Default: mobile + desktop (M5 plan §4 baseline bullet). */
  viewports?: string[];
  /** Theme names. Default: `CAPTURED_THEMES` (dark, light). */
  themes?: string[];
  /** Registers REST/GraphQL mocks for this state. Called before `page.goto`. */
  setupMocks: (page: Page) => Promise<void>;
  /** Extra steps after navigation settles and before the screenshot (e.g. open a dialog, type a search query). */
  afterGoto?: (page: Page) => Promise<void>;
  /**
   * When set, no capture is attempted: a `skipped` manifest row is written
   * instead, with this string as the reason. Used for S1-S3 states that
   * need STOMP fixtures H0 hasn't recorded yet (PENDING-LOCK).
   */
  skip?: string;
}

export interface SurfaceScenario {
  /** e.g. `S4` — matches the M5 plan §2 table and the `audit/m5/shots/<surface>` directory name. */
  id: string;
  title: string;
  /** grep tag used as `--grep @s4` (no leading `@`). */
  tag: string;
  /** The port this surface's own `ng serve` runs on (M5 plan §5). Informational; the spec reads `SOCKBOWL_APP`. */
  port: number;
  states: CaptureState[];
}
