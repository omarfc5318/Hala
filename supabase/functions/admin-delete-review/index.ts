// supabase/functions/admin-delete-review/index.ts
// POST /functions/v1/admin-delete-review
// Requires: Authorization: Bearer <admin JWT>
// Body: { review_id: string, reason: string }

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

  let review_id: string | undefined
  let reason: string | undefined
  try {
    const body = await req.json()
    review_id = typeof body?.review_id === 'string' ? body.review_id.trim() : undefined
    reason    = typeof body?.reason    === 'string' ? body.reason.trim()    : undefined
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  if (!review_id || !reason) return json({ error: 'review_id and reason are required' }, 422)

  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  // ── Delete via RPC (audit log → delete → close reports, all atomic) ───────

  const { error: rpcError } = await serviceClient.rpc('admin_delete_review', {
    p_review_id: review_id,
    p_reason:    reason,
  })
  if (rpcError) {
    console.error('[admin-delete-review] RPC error:', rpcError.message)
    return json({ error: 'Failed to delete review' }, 500)
  }

  return json({ success: true, review_id, action: 'deleted' })
})
