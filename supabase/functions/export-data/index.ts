// supabase/functions/export-data/index.ts
// POST /functions/v1/export-data
// Requires: Authorization: Bearer <user JWT>
// Rate limit: 1 request per user per 24 h (enforced via audit_log)
//
// Returns a downloadable JSON file containing:
//   { exported_at, profile, reviews, friends }

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

  // ── Verify JWT ────────────────────────────────────────────────────────────

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth:   { persistSession: false },
  })
  const { data: { user }, error: authError } = await authClient.auth.getUser()
  if (authError || !user) return json({ error: 'Unauthorized' }, 401)

  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  // ── Rate limit: 1 export per 24 h ────────────────────────────────────────
  // Checks audit_log for a recent data_export action by this user.
  // Using audit_log avoids needing an extra table and keeps an audit trail.

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await serviceClient
    .from('audit_log')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('action', 'data_export')
    .gte('created_at', since)

  if ((count ?? 0) > 0) {
    return json(
      { error: 'Data export is limited to once every 24 hours. Please try again later.' },
      429,
      { 'Retry-After': '86400' },
    )
  }

  // ── Generate export via SECURITY DEFINER RPC ─────────────────────────────
  // Single query that JOINs reviews→eateries and friendships→users server-side,
  // avoiding multiple round trips and bypassing RLS safely.

  const { data: exportData, error: rpcError } = await serviceClient.rpc(
    'export_account_data',
    { p_user_id: user.id },
  )
  if (rpcError || !exportData) {
    console.error('[export-data] RPC error:', rpcError?.message)
    return json({ error: 'Export failed. Please try again.' }, 500)
  }

  // ── Record in audit_log ───────────────────────────────────────────────────

  await serviceClient.from('audit_log').insert({
    user_id:    user.id,
    action:     'data_export',
    table_name: 'users',
    row_id:     user.id,
  })

  // ── Return as downloadable file ───────────────────────────────────────────

  const filename = `hala-data-${new Date().toISOString().slice(0, 10)}.json`
  const body     = JSON.stringify(exportData, null, 2)

  return new Response(body, {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // Never cache — always serve fresh data
      'Cache-Control': 'no-store',
    },
  })
})
