// supabase/functions/validate-invite/index.ts
// POST /functions/v1/validate-invite
// Body: { code: string }
// Response: { valid: boolean, created_by_username?: string }
// No auth required — called before the user has an account.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ---------------------------------------------------------------------------
// Simple in-memory rate limiter — 10 req/min per IP.
// Resets on cold start. For production scale, swap for Upstash Redis:
//   import { Ratelimit } from 'https://esm.sh/@upstash/ratelimit'
// ---------------------------------------------------------------------------

interface RateBucket { count: number; resetAt: number }
const rateLimitMap = new Map<string, RateBucket>()
const RATE_LIMIT = 10
const WINDOW_MS = 60_000

function isAllowed(ip: string): boolean {
  const now = Date.now()
  let bucket = rateLimitMap.get(ip)
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS }
    rateLimitMap.set(ip, bucket)
  }
  if (bucket.count >= RATE_LIMIT) return false
  bucket.count++
  return true
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Rate limit by IP
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('cf-connecting-ip') ??
    'unknown'

  if (!isAllowed(ip)) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: {
        ...CORS,
        'Content-Type': 'application/json',
        'Retry-After': '60',
      },
    })
  }

  // Parse body
  let code: string | undefined
  try {
    const body = await req.json()
    code = typeof body?.code === 'string' ? body.code.trim() : undefined
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  if (!code || code.length === 0) {
    return new Response(JSON.stringify({ valid: false }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Query with service role — bypasses RLS so we can read any invitation
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const { data: invite, error } = await supabase
    .from('invitations')
    .select('id, used_at, expires_at, users!created_by(username)')
    .eq('code', code)
    .maybeSingle()

  if (error) {
    console.error('validate-invite DB error', error)
    return new Response(JSON.stringify({ valid: false }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  if (!invite) {
    return new Response(JSON.stringify({ valid: false }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const now = new Date()
  const expired = invite.expires_at ? new Date(invite.expires_at) < now : false
  const used = invite.used_at !== null

  if (used || expired) {
    return new Response(JSON.stringify({ valid: false }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createdBy = (invite as any).users?.username ?? null

  return new Response(
    JSON.stringify({ valid: true, created_by_username: createdBy }),
    { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
  )
})
