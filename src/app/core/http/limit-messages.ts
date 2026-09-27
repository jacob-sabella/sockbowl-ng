/**
 * Human-readable labels for M4 quota metrics (plan §2.3), used by the 429
 * `quota_exceeded` snackbar text. Kept separate from `limit-errors.ts` so
 * INT1's GraphQL wiring and any future admin-usage copy can reuse the same
 * labels without importing the error-parsing code.
 */
const METRIC_LABELS: Record<string, string> = {
  'ai.generations': 'AI generation',
  'ai.questions': 'AI question',
  'ai.tokens': 'AI token',
  'ai.serverkey': 'AI generation',
  'imports': 'import',
  'packets-owned': 'packet',
  'hosted-sessions': 'hosted session',
};

/** Falls back to the raw metric name (still readable) for anything unmapped. */
export function metricLabel(metric: string | null | undefined): string {
  if (!metric) {
    return 'usage';
  }
  return METRIC_LABELS[metric] ?? metric;
}

/**
 * A short "resets ___" phrase for a quota's `resetsAt` (an ISO instant, or
 * `null` for concurrent/owned metrics that only recover by the underlying
 * resource freeing up, e.g. a hosted session ending).
 */
export function resetsPhrase(resetsAt: string | null | undefined): string {
  if (!resetsAt) {
    return 'when a session ends';
  }
  const target = new Date(resetsAt).getTime();
  if (Number.isNaN(target)) {
    return 'soon';
  }
  const diffMs = target - Date.now();
  if (diffMs <= 0) {
    return 'soon';
  }
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) {
    return 'in under a minute';
  }
  if (diffMin < 60) {
    return `in ${diffMin}m`;
  }
  const diffHr = Math.round(diffMin / 60);
  return `in ${diffHr}h`;
}
