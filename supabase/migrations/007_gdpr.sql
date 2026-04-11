-- =============================================================================
-- 007_gdpr.sql — Account deletion, data retention, and GDPR compliance
-- =============================================================================

-- ---------------------------------------------------------------------------
-- perform_account_soft_delete — atomic data erasure (GDPR Art. 17)
-- Called exclusively by the delete-account edge function (service role).
-- All DML runs in a single transaction; if any step fails the whole thing
-- rolls back so the account is never left in a partial state.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION perform_account_soft_delete(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER   -- must run as DB owner to bypass RLS on all tables
SET search_path = public
AS $$
BEGIN
  -- 1. Anonymise the profile (soft delete — keeps the row for FK integrity)
  UPDATE users
  SET
    status     = 'deleted',
    name       = 'Deleted User',
    username   = 'deleted_' || p_user_id::text,
    bio        = NULL,
    photo_url  = NULL,
    updated_at = now()
  WHERE id = p_user_id;

  -- 2. Remove user-generated content
  DELETE FROM reviews       WHERE user_id        = p_user_id;

  -- 3. Remove social graph
  DELETE FROM friendships
  WHERE requester_id = p_user_id OR addressee_id = p_user_id;

  -- 4. Remove notification history
  DELETE FROM notifications WHERE user_id = p_user_id;

  -- 5. Remove push tokens (stop delivering notifications immediately)
  DELETE FROM push_tokens   WHERE user_id = p_user_id;

  -- 6. Expire any unclaimed invite codes so they can no longer be redeemed
  UPDATE invitations
  SET expires_at = now()
  WHERE created_by = p_user_id
    AND used_at IS NULL;

  -- 7. Write to audit trail (service role inserts bypass the no-insert RLS)
  INSERT INTO audit_log (user_id, action, table_name, row_id)
  VALUES (p_user_id, 'account_deleted', 'users', p_user_id);
END;
$$;

-- Only the service role may call this — never the anon or authenticated role
REVOKE EXECUTE ON FUNCTION perform_account_soft_delete FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Hard delete — runs 30 days after soft delete via pg_cron
-- Removes the auth.users row, which cascades to delete the users row too
-- (users.id REFERENCES auth.users(id) with ON DELETE CASCADE).
-- ---------------------------------------------------------------------------

-- Enable pg_cron (already enabled on all Supabase projects)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;   -- uncomment if not present

CREATE OR REPLACE FUNCTION hard_delete_expired_accounts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- auth.users rows for soft-deleted accounts; cascade removes public.users too
  DELETE FROM auth.users au
  USING public.users pu
  WHERE au.id = pu.id
    AND pu.status = 'deleted'
    -- 30-day grace period: allow account recovery requests within this window
    AND pu.updated_at < now() - interval '30 days';
END;
$$;

REVOKE EXECUTE ON FUNCTION hard_delete_expired_accounts FROM PUBLIC, anon, authenticated;

-- Schedule hard delete to run at 03:00 UTC daily (low-traffic window)
-- Requires pg_cron to be enabled. Run via the Supabase Dashboard → Extensions
-- if this statement errors.
SELECT cron.schedule(
  'hard-delete-expired-accounts',   -- job name (idempotent)
  '0 3 * * *',                      -- cron expression: daily at 03:00 UTC
  'SELECT hard_delete_expired_accounts()'
);

-- ---------------------------------------------------------------------------
-- export_account_data — returns a JSON snapshot for GDPR Art. 20 portability
-- Called by the export-data edge function via service role.
-- Rate-limit enforcement is done in the edge function (1 export per 24 h).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION export_account_data(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile    jsonb;
  v_reviews    jsonb;
  v_friends    jsonb;
BEGIN
  SELECT to_jsonb(u) - 'id' - 'status' - 'photo_url' - 'is_public'
  INTO v_profile
  FROM users u
  WHERE id = p_user_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'eatery_name',    e.name,
      'text',           r.text,
      'favourite_dish', r.favourite_dish,
      'rank',           r.rank,
      'created_at',     r.created_at
    ) ORDER BY r.created_at DESC
  ), '[]')
  INTO v_reviews
  FROM reviews r
  JOIN eateries e ON e.id = r.eatery_id
  WHERE r.user_id = p_user_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'username',          u.username,
      'name',              u.name,
      'became_friends_at', f.created_at
    ) ORDER BY f.created_at DESC
  ), '[]')
  INTO v_friends
  FROM friendships f
  JOIN users u ON u.id = CASE
    WHEN f.requester_id = p_user_id THEN f.addressee_id
    ELSE f.requester_id
  END
  WHERE (f.requester_id = p_user_id OR f.addressee_id = p_user_id)
    AND f.status = 'accepted';

  RETURN jsonb_build_object(
    'exported_at', now(),
    'profile',     v_profile,
    'reviews',     v_reviews,
    'friends',     v_friends
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION export_account_data FROM PUBLIC, anon, authenticated;
