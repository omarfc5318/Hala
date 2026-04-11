// supabase/functions/health/index.ts
// GET /functions/v1/health — no auth required
//
// Used by uptime monitoring to verify the service is up.
// ─────────────────────────────────────────────────────────────────────────────
// BETTERUPTIME CONFIGURATION (betteruptime.com)
//   Monitor type : HTTP(S)
//   URL          : https://<project-ref>.supabase.co/functions/v1/health
//   Method       : GET
//   Check every  : 60 seconds
//   Alert after  : 2 consecutive failures
//   Status page  : publish at status.hala.app
//   Channels     : SMS to founder, Slack webhook #incidents
//
// ALERT THRESHOLDS (set in Sentry → Alerts → Performance):
//   p95 > 2000ms  for  feed.load | review.submit | map.load | auth.login
//
// UPTIME EMBED (hala.app/status):
//   <script src="https://betteruptime.com/widgets/announcement.js" ...></script>
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VERSION = '1.0.0'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const t0 = Date.now()

  // DB health check using service role (bypasses RLS for a reliable read)
  let dbStatus: 'ok' | 'error' = 'ok'
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )
    const { error } = await supabase.from('users').select('count').limit(1).single()
    if (error) dbStatus = 'error'
  } catch {
    dbStatus = 'error'
  }

  const responseTimeMs = Date.now() - t0
  const overallStatus = dbStatus === 'ok' ? 'ok' : 'degraded'
  const httpStatus = overallStatus === 'ok' ? 200 : 503

  const body = JSON.stringify({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: VERSION,
    db: dbStatus,
  })

  return new Response(body, {
    status: httpStatus,
    headers: {
      ...CORS,
      'Content-Type': 'application/json',
      'X-Response-Time': `${responseTimeMs}ms`,
      // Prevent caching — monitors must always hit the live endpoint
      'Cache-Control': 'no-store',
    },
  })
})
