/**
 * Models for the admin usage/quota view (M4-AD-02), matching game's
 * `/api/v1/admin/usage/**` contract (plan §2.8, WP G6). N3 codes against
 * this frozen contract while G6 lands in parallel.
 */

/** How a quota's limit recovers. Mirrors §2.3 kinds; `global` is the AI server-key budget. */
export type UsageCounterKind = 'daily' | 'concurrent' | 'owned' | 'global';

/** One metered quantity for a user (or, for the global budget, the server key). */
export interface UsageCounter {
  metric: string;
  used: number;
  /** -1 means unlimited. */
  limit: number;
  kind: UsageCounterKind;
  /** Next UTC midnight for daily/global metrics; null for concurrent/owned. */
  resetsAt: string | null;
  /** True when this limit comes from a `quota:override:{sub}` entry rather than the tier default. */
  overridden: boolean;
}

/** One row of the admin usage table (`GET /api/v1/admin/usage`). */
export interface UserUsageSummary {
  keycloakId: string;
  username: string | null;
  displayName: string | null;
  tier: string;
  lastSeenAt: string | null;
  banned: boolean;
  activeSessions: number;
  /** Null when questions couldn't be reached for this page. */
  packetsOwned: number | null;
  counters: UsageCounter[];
  /** Rejection count for this user in some recent window (list view only; see `events` for detail). */
  recentRejections: number;
}

/** A `rl:events` row (plan §2.1). */
export interface RateLimitEvent {
  ts: string;
  svc: 'game' | 'questions';
  policy: string;
  kind: 'rate' | 'quota' | 'ban';
  sub: string | null;
  ip: string | null;
  path: string | null;
}

/** `GET /api/v1/admin/usage/{sub}`: the summary plus per-user detail. */
export interface UserUsageDetail extends UserUsageSummary {
  lastIps: string[];
  /** metric -> override limit (-1 = unlimited); absent metrics use the tier default. */
  overrides: Record<string, number>;
  /** Newest first, up to the last 50. */
  events: RateLimitEvent[];
  hostedSessionIds: string[];
}

/** `GET /api/v1/admin/usage/global`: the AI budget meter and top-line counts. */
export interface GlobalUsage {
  aiServerKey: {
    used: number;
    limit: number;
    resetsAt: string | null;
  };
  activeHostedSessions: number;
  topGuestIps: { ip: string; sessions: number }[];
  rejectionsLastHour: number;
}

/** Spring Data's `Page<T>` JSON shape, as returned by the paged usage list. */
export interface UsagePage {
  content: UserUsageSummary[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
}

/** `PUT /api/v1/admin/usage/{sub}/quota/{metric}` body. `null` clears the override (role default). */
export interface SetQuotaOverrideRequest {
  limit: number | null;
}

/** `POST /api/v1/admin/usage/{sub}/reset` body. Omit `metric` to reset every daily counter. */
export interface ResetUsageRequest {
  metric?: string;
}
