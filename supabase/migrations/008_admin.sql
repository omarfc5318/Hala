-- =============================================================================
-- 008_admin.sql — Rework reports table + admin moderation infrastructure
-- =============================================================================
-- The reports table created in 002 had generic column names (table_name, row_id)
-- and lacked structured reason codes. This migration replaces it with a schema
-- that supports the in-app report flow and admin moderation panel.
-- Pre-launch: no production data to preserve, so we drop and recreate.
-- =============================================================================

-- Drop old table (cascades to RLS policies and indexes)
DROP TABLE IF EXISTS reports CASCADE;

-- ---------------------------------------------------------------------------
-- reports — user-submitted content flags
-- ---------------------------------------------------------------------------

CREATE TABLE reports (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type  text        NOT NULL
                             CHECK (entity_type IN ('review', 'user', 'eatery')),
  entity_id    uuid        NOT NULL,
  reason       text        NOT NULL
                             CHECK (reason IN ('spam', 'offensive', 'fake', 'other')),
  notes        text        CHECK (char_length(notes) <= 500),
  status       text        NOT NULL DEFAULT 'open'
                             CHECK (status IN ('open', 'reviewed', 'actioned', 'dismissed')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Index for admin panel: open reports sorted oldest-first
CREATE INDEX idx_reports_open      ON reports (status, created_at)
  WHERE status = 'open';
-- Index for closing all reports related to a given entity
CREATE INDEX idx_reports_entity    ON reports (entity_type, entity_id);
CREATE INDEX idx_reports_reporter  ON reports (reporter_id);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- Anyone can file a report (with their own reporter_id)
CREATE POLICY reports_insert ON reports FOR INSERT
  WITH CHECK (reporter_id = auth.uid());

-- Users can only see their own submitted reports
CREATE POLICY reports_select_own ON reports FOR SELECT
  USING (reporter_id = auth.uid());

-- Admin panel reads/writes via service role — no RLS policy needed for that role

-- ---------------------------------------------------------------------------
-- Prevent duplicate reports: one report per (reporter, entity)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX idx_reports_unique_reporter_entity
  ON reports (reporter_id, entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Admin helpers — called by Next.js admin panel via service role
-- These RPCs keep admin mutations atomic and audited.
-- ---------------------------------------------------------------------------

-- suspend_user: anonymise profile + log
CREATE OR REPLACE FUNCTION admin_suspend_user(p_user_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE users SET status = 'suspended' WHERE id = p_user_id;
  INSERT INTO audit_log (user_id, action, table_name, row_id)
  VALUES (p_user_id, 'user_suspended', 'users', p_user_id);
END;
$$;

-- verify_eatery: approve a user-submitted eatery
CREATE OR REPLACE FUNCTION admin_verify_eatery(p_eatery_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE eateries SET is_verified = true WHERE id = p_eatery_id;
  INSERT INTO audit_log (action, table_name, row_id)
  VALUES ('eatery_verified', 'eateries', p_eatery_id);
END;
$$;

-- delete_review_admin: audit log first, then delete
CREATE OR REPLACE FUNCTION admin_delete_review(p_review_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO audit_log (action, table_name, row_id)
  VALUES ('review_deleted', 'reviews', p_review_id);

  DELETE FROM reviews WHERE id = p_review_id;

  -- Close any open reports for this review
  UPDATE reports
  SET    status = 'actioned'
  WHERE  entity_type = 'review'
    AND  entity_id   = p_review_id
    AND  status      = 'open';
END;
$$;

-- Callable only by service role
REVOKE EXECUTE ON FUNCTION admin_suspend_user   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_verify_eatery  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_delete_review  FROM PUBLIC, anon, authenticated;
