// lib/perf.ts — Sentry Performance span helpers (Sentry SDK v8)
// Track: feed.load | review.submit | map.load | auth.login
// Alert threshold: p95 > 2000ms for any metric (configure in Sentry → Alerts)

import * as Sentry from '@sentry/react-native';

/**
 * Wrap an async operation in a Sentry span (SDK v8 API).
 * In __DEV__ the span is skipped and timing is logged to console.
 *
 * @example
 * const eateries = await measure('feed.load', 'navigation', () => fetchEateries());
 */
export async function measure<T>(
  name: string,
  op: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (__DEV__) {
    const t0 = Date.now();
    const result = await fn();
    console.log(`[perf] ${name} — ${Date.now() - t0}ms`);
    return result;
  }

  try {
    return await Sentry.startSpan({ name, op }, () => fn());
  } catch {
    // SDK not yet initialised or startSpan not supported — just run fn
    return fn();
  }
}
