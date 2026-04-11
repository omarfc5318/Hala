// supabase/functions/send-push/index.ts
// Invoked by a Supabase Database Webhook on notifications INSERT.
// Reads the new notification row, looks up push tokens, sends via Expo Push API.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ---------------------------------------------------------------------------
// Types matching the notifications table
// ---------------------------------------------------------------------------

type NotifType = 'friend_request' | 'friend_accepted' | 'friend_reviewed_eatery'

interface NotificationRecord {
  id: string
  user_id: string
  type: NotifType
  actor_id: string | null
  entity_id: string | null
  read: boolean
  created_at: string
}

// Supabase Database Webhook payload
interface WebhookPayload {
  type: 'INSERT'
  table: string
  schema: string
  record: NotificationRecord
  old_record: null
}

interface ExpoPushMessage {
  to: string
  title: string
  body: string
  data?: Record<string, unknown>
  sound?: 'default'
  badge?: number
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

  let payload: WebhookPayload
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const notif = payload.record
  if (!notif || payload.type !== 'INSERT') {
    return new Response(JSON.stringify({ skipped: true }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  // Fetch recipient push tokens
  const { data: tokens } = await admin
    .from('push_tokens')
    .select('token')
    .eq('user_id', notif.user_id)

  if (!tokens || tokens.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Fetch actor name for notification copy
  let actorName = 'Someone'
  if (notif.actor_id) {
    const { data: actor } = await admin
      .from('users')
      .select('name')
      .eq('id', notif.actor_id)
      .single()
    if (actor) actorName = actor.name
  }

  // Fetch eatery name for review notifications
  let eateryName = 'a restaurant'
  if (notif.type === 'friend_reviewed_eatery' && notif.entity_id) {
    const { data: eatery } = await admin
      .from('eateries')
      .select('name')
      .eq('id', notif.entity_id)
      .single()
    if (eatery) eateryName = eatery.name
  }

  // Build the notification copy
  const copy: Record<NotifType, { title: string; body: string }> = {
    friend_request: {
      title: 'New friend request',
      body: `${actorName} sent you a friend request`,
    },
    friend_accepted: {
      title: 'Friend request accepted',
      body: `${actorName} accepted your friend request`,
    },
    friend_reviewed_eatery: {
      title: 'Friend check-in',
      body: `${actorName} reviewed ${eateryName}`,
    },
  }

  const { title, body } = copy[notif.type]

  // Build Expo push messages — one per token
  const messages: ExpoPushMessage[] = tokens.map(({ token }) => ({
    to: token,
    title,
    body,
    sound: 'default',
    data: {
      type: notif.type,
      actor_id: notif.actor_id,
      entity_id: notif.entity_id,
      notification_id: notif.id,
    },
  }))

  // Fire-and-forget to Expo Push API (batch up to 100)
  const CHUNK = 100
  const results: unknown[] = []
  for (let i = 0; i < messages.length; i += CHUNK) {
    const batch = messages.slice(i, i + CHUNK)
    try {
      const pushToken = Deno.env.get('EXPO_PUSH_ACCESS_TOKEN')
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          ...(pushToken ? { 'Authorization': `Bearer ${pushToken}` } : {}),
        },
        body: JSON.stringify(batch),
      })
      const data = await res.json()
      results.push(data)
    } catch (e) {
      console.error('Expo push batch failed', e)
    }
  }

  return new Response(JSON.stringify({ sent: messages.length, results }), {
    status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})
