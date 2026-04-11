// supabase/functions/delete-account/index.ts
// POST /functions/v1/delete-account
// Requires: Authorization: Bearer <user JWT>
// Body: { confirmation: 'DELETE' }
//
// Steps (in order, as required by GDPR Art. 17):
//   1. Verify caller JWT
//   2. Validate body.confirmation === 'DELETE'
//   3. Atomically soft-delete all user data (via DB RPC)
//   4. Delete profile photos from Storage
//   5. Revoke all active sessions (global sign-out)
//   6. Return 200 — client clears local state and navigates to splash

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extra },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // ── 1. Verify caller JWT ─────────────────────────────────────────────────

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)

  const supabaseUrl  = Deno.env.get('SUPABASE_URL')!
  const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey      = Deno.env.get('SUPABASE_ANON_KEY')!
  const userJwt      = authHeader.slice(7)

  // Auth client — identifies the caller
  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth:   { persistSession: false },
  })
  const { data: { user }, error: authError } = await authClient.auth.getUser()
  if (authError || !user) return json({ error: 'Unauthorized' }, 401)

  // Service role client — bypasses RLS for privileged operations
  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  // ── 2. Validate confirmation ─────────────────────────────────────────────

  let confirmation: string | undefined
  try {
    const body = await req.json()
    confirmation = typeof body?.confirmation === 'string' ? body.confirmation : undefined
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  if (confirmation !== 'DELETE') {
    return json({ error: 'Type DELETE in the confirmation field to proceed' }, 422)
  }

  // ── 3. Atomic soft-delete via SECURITY DEFINER RPC ──────────────────────
  // Anonymises profile, removes reviews/friendships/notifications/push_tokens,
  // expires unclaimed invite codes, and writes to audit_log — all in one TX.

  const { error: rpcError } = await serviceClient.rpc('perform_account_soft_delete', {
    p_user_id: user.id,
  })
  if (rpcError) {
    console.error('[delete-account] RPC error:', rpcError.message)
    return json({ error: 'Account deletion failed. Please try again.' }, 500)
  }

  // ── 4. Delete profile photos from Storage ───────────────────────────────

  try {
    const { data: files } = await serviceClient.storage
      .from('avatars')
      .list(user.id)

    const paths = (files ?? []).map((f) => `${user.id}/${f.name}`)
    if (paths.length > 0) {
      await serviceClient.storage.from('avatars').remove(paths)
    }
  } catch (storageErr) {
    // Storage cleanup failure is non-fatal — the account is already deleted.
    // Log and continue: orphaned files will be caught by a periodic Storage sweep.
    console.error('[delete-account] Storage cleanup failed:', storageErr)
  }

  // ── 5. Revoke all sessions (global sign-out) ─────────────────────────────
  // Calls Supabase Auth REST endpoint with the user's JWT + scope=global.
  // This invalidates all refresh tokens across all devices.

  try {
    await fetch(`${supabaseUrl}/auth/v1/logout?scope=global`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userJwt}`,
        apikey: anonKey,
      },
    })
  } catch (sessionErr) {
    // Non-fatal: the users.status='deleted' row prevents any further API calls
    // even if a stale access token is briefly usable until it expires (< 1h).
    console.error('[delete-account] Session revocation failed:', sessionErr)
  }

  return json({ success: true })
})
