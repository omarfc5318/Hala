-- =============================================================================
-- 005_notifications.sql — push_tokens, notifications, and insert triggers
-- =============================================================================

-- ---------------------------------------------------------------------------
-- push_tokens — one row per (device, user) pair
-- ---------------------------------------------------------------------------

CREATE TABLE push_tokens (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      text        NOT NULL UNIQUE,
  platform   text        CHECK (platform IN ('ios', 'android')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY tokens_own ON push_tokens FOR ALL
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------

CREATE TABLE notifications (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text        NOT NULL CHECK (type IN (
               'friend_request', 'friend_accepted', 'friend_reviewed_eatery'
             )),
  actor_id   uuid        REFERENCES users(id) ON DELETE CASCADE,
  entity_id  uuid,
  read       boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users manage only their own notifications
CREATE POLICY notifs_own ON notifications FOR ALL
  USING (user_id = auth.uid());

CREATE INDEX idx_notifs_user ON notifications (user_id, read, created_at DESC);

-- ---------------------------------------------------------------------------
-- Trigger: new friend request → notify addressee
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_notify_friend_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO notifications (user_id, type, actor_id, entity_id)
  VALUES (NEW.addressee_id, 'friend_request', NEW.requester_id, NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER notify_friend_request
  AFTER INSERT ON friendships
  FOR EACH ROW
  EXECUTE FUNCTION trg_notify_friend_request();

-- ---------------------------------------------------------------------------
-- Trigger: friend request accepted → notify original requester
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_notify_friend_accepted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    INSERT INTO notifications (user_id, type, actor_id, entity_id)
    VALUES (NEW.requester_id, 'friend_accepted', NEW.addressee_id, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER notify_friend_accepted
  AFTER UPDATE ON friendships
  FOR EACH ROW
  EXECUTE FUNCTION trg_notify_friend_accepted();

-- ---------------------------------------------------------------------------
-- Trigger: new review → notify all accepted friends of the reviewer
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_notify_friend_reviewed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO notifications (user_id, type, actor_id, entity_id)
  SELECT
    CASE
      WHEN f.requester_id = NEW.user_id THEN f.addressee_id
      ELSE f.requester_id
    END,
    'friend_reviewed_eatery',
    NEW.user_id,
    NEW.eatery_id
  FROM friendships f
  WHERE (f.requester_id = NEW.user_id OR f.addressee_id = NEW.user_id)
    AND f.status = 'accepted';

  RETURN NEW;
END;
$$;

CREATE TRIGGER notify_friend_reviewed
  AFTER INSERT ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION trg_notify_friend_reviewed();

-- ---------------------------------------------------------------------------
-- send-push edge function is invoked by a Supabase Database Webhook.
-- Configure in: Supabase Dashboard → Database → Webhooks → Create new webhook
--   Table:  notifications
--   Events: INSERT
--   URL:    https://<project-ref>.functions.supabase.co/functions/v1/send-push
--   Headers: Authorization: Bearer <service-role-key>
-- ---------------------------------------------------------------------------
