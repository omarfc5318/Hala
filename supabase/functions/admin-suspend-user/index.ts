// supabase/functions/admin-suspend-user/index.ts
// POST /functions/v1/admin-suspend-user
// Requires: Authorization: Bearer <admin JWT>
// Body: { user_id: string, reason: string }
//
// Admin is identified by app_metadata.role === 'admin'.
// Set this in the Supabase Dashboard → Authentication → Users → Edit user
// or via: supabase.auth.admin.updateUserById(userId, { app_metadata: { role: 'admin' } })

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

  // ── Verify caller is an admin ─────────────────────────────────────────────

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth:   { persistSession: false },
  })
  const { data: { user }, error: authError } = await authClient.auth.getUser()
  if (authError || !user) return json({ error: 'Unauthorized' }, 401)

  if (user.app_metadata?.role !== 'admin') {
    return json({ error: 'Forbidden — admin role required' }, 403)
  }

  // ── Parse + validate body ─────────────────────────────────────────────────

  let user_id: string | undefined
  let reason: string | undefined
  try {
    const body = await req.json()
    user_id = typeof body?.user_id === 'string' ? body.user_id.trim() : undefined
    reason  = typeof body?.reason  === 'string' ? body.reason.trim()  : undefined
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  if (!user_id || !reason) return json({ error: 'user_id and reason are required' }, 422)

  // Prevent admins from suspending themselves
  if (user_id === user.id) return json({ error: 'Cannot suspend yourself' }, 422)

  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  // ── Suspend via RPC (atomic: update + audit log) ──────────────────────────

  const { error: rpcError } = await serviceClient.rpc('admin_suspend_user', {
    p_user_id: user_id,
    p_reason:  reason,
  })
  if (rpcError) {
    console.error('[admin-suspend-user] RPC error:', rpcError.message)
    return json({ error: 'Failed to suspend user' }, 500)
  }

  // ── Revoke all sessions for the suspended user ───────────────────────────

  try {
    // Fetching the user's latest access token isn't possible here, so we use
    // the admin endpoint to invalidate all sessions for the target user ID.
    // The Supabase Admin SDK exposes this via the Management API internally.
    await serviceClient.auth.admin.signOut(user_id)
  } catch (e) {
    // Non-fatal — the users.status='suspended' check blocks all further API access
    console.warn('[admin-suspend-user] Session revocation failed:', e)
  }

  return json({ success: true, user_id, action: 'suspended' })
})
