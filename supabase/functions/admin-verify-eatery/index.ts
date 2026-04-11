// supabase/functions/admin-verify-eatery/index.ts
// POST /functions/v1/admin-verify-eatery
// Requires: Authorization: Bearer <admin JWT>
// Body: { eatery_id: string }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!

  // ── Verify admin ──────────────────────────────────────────────────────────

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth:   { persistSession: false },
  })
  const { data: { user }, error: authError } = await authClient.auth.getUser()
  if (authError || !user) return json({ error: 'Unauthorized' }, 401)
  if (user.app_metadata?.role !== 'admin') return json({ error: 'Forbidden' }, 403)

  // ── Parse body ────────────────────────────────────────────────────────────

  let eatery_id: string | undefined
  try {
    const body = await req.json()
    eatery_id = typeof body?.eatery_id === 'string' ? body.eatery_id.trim() : undefined
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  if (!eatery_id) return json({ error: 'eatery_id is required' }, 422)

  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  // ── Verify via RPC (update + audit log atomically) ────────────────────────

  const { error: rpcError } = await serviceClient.rpc('admin_verify_eatery', {
    p_eatery_id: eatery_id,
  })
  if (rpcError) {
    console.error('[admin-verify-eatery] RPC error:', rpcError.message)
    return json({ error: 'Failed to verify eatery' }, 500)
  }

  return json({ success: true, eatery_id, action: 'verified' })
})
