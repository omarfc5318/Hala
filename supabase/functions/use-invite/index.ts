// supabase/functions/use-invite/index.ts
// POST /functions/v1/use-invite
// Requires: Authorization: Bearer <user JWT>
// Body: { code: string }
// Claims the invite code atomically — returns 409 on race condition.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Verify caller JWT
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  // Auth client — uses caller's JWT to identify the user
  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })

  const { data: { user }, error: authError } = await authClient.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
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

  if (!code) {
    return new Response(JSON.stringify({ error: 'code is required' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Service role client — bypasses RLS for the atomic update
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  // Validate and read current state
  const { data: invite, error: readError } = await adminClient
    .from('invitations')
    .select('id, used_at, expires_at')
    .eq('code', code)
    .maybeSingle()

  if (readError) {
    console.error('use-invite read error', readError)
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  if (!invite) {
    return new Response(JSON.stringify({ error: 'Invalid code' }), {
      status: 404, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  if (invite.used_at !== null) {
    return new Response(JSON.stringify({ error: 'Code already used' }), {
      status: 409, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return new Response(JSON.stringify({ error: 'Code expired' }), {
      status: 410, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Atomic claim: UPDATE ... WHERE used_at IS NULL guards the race condition
  const { count, error: updateError } = await adminClient
    .from('invitations')
    .update({ used_by: user.id, used_at: new Date().toISOString() })
    .eq('code', code)
    .is('used_at', null)
    .select('id', { count: 'exact', head: true })

  if (updateError) {
    console.error('use-invite update error', updateError)
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // 0 rows updated = another request claimed it first (race condition)
  if ((count ?? 0) === 0) {
    return new Response(JSON.stringify({ error: 'Code already used' }), {
      status: 409, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})
