/**
 * load-test/hala.js — Hala k6 load test
 *
 * Usage:
 *   k6 run --env TEST_JWT=<staging-jwt> \
 *          --env BASE_URL=https://<project-ref>.supabase.co/functions/v1 \
 *          load-test/hala.js
 *
 * Obtain a test JWT:
 *   1. Sign in via the Hala staging app (or Supabase Auth REST API)
 *   2. Copy the access_token from the session
 *   3. Pass it as TEST_JWT — it expires in 1h so refresh before long runs
 *
 * Install k6:
 *   brew install k6          (macOS)
 *   choco install k6         (Windows)
 *   https://k6.io/docs/get-started/installation/
 *
 * All thresholds below must pass before promoting a build to production.
 * ─────────────────────────────────────────────────────────────────────────────
 * RAMP SHAPE:
 *   0 → 100 VUs over 2 min  (warm-up)
 *   100 → 500 VUs over 5 min (peak load — ~5× expected launch traffic)
 *   500 → 0 VUs over 2 min  (cool-down)
 *
 * THRESHOLDS:
 *   p95 latency  < 800 ms  across all requests
 *   error rate   < 1 %     (non-2xx responses)
 *   custom errors < 1 %    (business-logic failures, e.g. wrong shape)
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ── Custom metrics ─────────────────────────────────────────────────────────

const errorRate   = new Rate('errors');
const feedLatency = new Trend('feed_latency',  true);
const mapLatency  = new Trend('map_latency',   true);
const authLatency = new Trend('auth_latency',  true);

// ── Options ────────────────────────────────────────────────────────────────

export const options = {
  stages: [
    { duration: '2m', target: 100 },   // warm-up
    { duration: '5m', target: 500 },   // peak load
    { duration: '2m', target: 0   },   // cool-down
  ],
  thresholds: {
    // All HTTP requests: p95 latency must be under 800 ms
    'http_req_duration':          ['p(95)<800'],
    // Less than 1% of requests may fail (non-2xx)
    'http_req_failed':            ['rate<0.01'],
    // Less than 1% of checks may fail
    'errors':                     ['rate<0.01'],
    // Per-endpoint latency budgets
    'feed_latency':               ['p(95)<600'],
    'map_latency':                ['p(95)<700'],
    'auth_latency':               ['p(95)<500'],
  },
};

// ── Config ─────────────────────────────────────────────────────────────────

const BASE    = __ENV.BASE_URL  || 'https://REPLACE_ME.supabase.co/functions/v1';
const TOKEN   = __ENV.TEST_JWT  || '';

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

// Riyadh city-centre — used for map pin queries
const MAP_LAT = '24.71';
const MAP_LNG = '46.67';

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Supabase REST API: GET /rest/v1/<table>
 * Returns the Supabase project's PostgREST endpoint (not an Edge Function).
 * Adjust BASE_REST if your REST URL differs from the functions URL.
 */
const BASE_REST = BASE.replace('/functions/v1', '/rest/v1');

function restHeaders() {
  return {
    ...HEADERS,
    // Required by PostgREST to return JSON
    Accept: 'application/json',
    // Supabase anon key used alongside the user JWT for RLS
    apikey: __ENV.ANON_KEY || '',
  };
}

// ── Default scenario ───────────────────────────────────────────────────────

export default function () {

  // ── 1. Health check ───────────────────────────────────────────────────────
  group('health', () => {
    const res = http.get(`${BASE}/health`);
    const ok = check(res, {
      'health: status 200':            (r) => r.status === 200,
      'health: db ok':                 (r) => {
        try { return JSON.parse(r.body).db === 'ok'; } catch { return false; }
      },
      'health: response time < 300ms': (r) => r.timings.duration < 300,
    });
    errorRate.add(!ok);
  });

  sleep(0.5);

  // ── 2. Eatery feed (Riyadh, first page) ───────────────────────────────────
  group('feed', () => {
    const res = http.get(
      `${BASE_REST}/eateries?select=id,name,location_text,photos,city` +
      `&is_verified=eq.true&city=eq.riyadh&order=created_at.desc&limit=20`,
      { headers: restHeaders() },
    );
    feedLatency.add(res.timings.duration);
    const ok = check(res, {
      'feed: status 200':       (r) => r.status === 200,
      'feed: returns array':    (r) => {
        try { return Array.isArray(JSON.parse(r.body)); } catch { return false; }
      },
      'feed: ≤20 rows':         (r) => {
        try { return JSON.parse(r.body).length <= 20; } catch { return false; }
      },
    });
    errorRate.add(!ok);
  });

  sleep(1);

  // ── 3. Eatery feed (Dubai, page 2) ────────────────────────────────────────
  group('feed-page-2', () => {
    const res = http.get(
      `${BASE_REST}/eateries?select=id,name,location_text,photos,city` +
      `&is_verified=eq.true&city=eq.dubai&order=created_at.desc&limit=20&offset=20`,
      { headers: restHeaders() },
    );
    const ok = check(res, { 'feed-p2: status 200': (r) => r.status === 200 });
    errorRate.add(!ok);
  });

  sleep(0.5);

  // ── 4. Map pins (eateries_near RPC) ───────────────────────────────────────
  group('map', () => {
    const res = http.post(
      `${BASE_REST}/rpc/eateries_near`,
      JSON.stringify({ lat: parseFloat(MAP_LAT), lng: parseFloat(MAP_LNG), radius_m: 5000 }),
      { headers: restHeaders() },
    );
    mapLatency.add(res.timings.duration);
    const ok = check(res, {
      'map: status 200':    (r) => r.status === 200,
      'map: returns array': (r) => {
        try { return Array.isArray(JSON.parse(r.body)); } catch { return false; }
      },
    });
    errorRate.add(!ok);
  });

  sleep(1);

  // ── 5. Health check again at end of iteration ─────────────────────────────
  // Ensures the service is still responsive under sustained load, not just on
  // first contact. A degraded health response here signals DB connection pool
  // exhaustion (typical failure mode at 500 VUs).
  group('health-tail', () => {
    const res = http.get(`${BASE}/health`);
    authLatency.add(res.timings.duration);
    const ok = check(res, {
      'health-tail: status 200': (r) => r.status === 200,
    });
    errorRate.add(!ok);
  });

  sleep(1);
}

// ── Setup: validate config before the test starts ─────────────────────────

export function setup() {
  if (!TOKEN) {
    console.warn(
      '[k6] TEST_JWT is not set — authenticated endpoints will return 401.\n' +
      '     Run: k6 run --env TEST_JWT=<your-jwt> load-test/hala.js',
    );
  }
  if (BASE.includes('REPLACE_ME')) {
    console.error('[k6] BASE_URL is not set. Aborting.');
    // k6 does not support process.exit — throw instead
    throw new Error('BASE_URL must be set via --env BASE_URL=...');
  }
}

// ── Teardown: print a summary hint ────────────────────────────────────────

export function teardown() {
  console.log(
    '\n[k6] Test complete.\n' +
    '     Review the thresholds above — all must be GREEN before deploying to prod.\n' +
    '     If feed_latency p95 > 600ms, check idx_eateries_feed in 006_perf_indexes.sql.\n' +
    '     If map_latency p95 > 700ms, check the PostGIS GIST index (idx_eateries_geo).\n',
  );
}
