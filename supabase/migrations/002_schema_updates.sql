-- =============================================================================
-- 002_schema_updates.sql — reports table + transactional review ranking RPC
-- =============================================================================

-- ---------------------------------------------------------------------------
-- REPORTS — user-flagged content
-- ---------------------------------------------------------------------------

CREATE TABLE reports (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  table_name   text        NOT NULL CHECK (table_name IN ('reviews', 'eateries', 'users')),
  row_id       uuid        NOT NULL,
  reason       text        CHECK (char_length(reason) <= 300),
  status       text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'reviewed', 'dismissed')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reports_row ON reports (table_name, row_id);
CREATE INDEX idx_reports_reporter ON reports (reporter_id);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- Users can see their own reports; no READ for others
CREATE POLICY reports_select_own ON reports FOR SELECT USING (reporter_id = auth.uid());
-- Authenticated users can file reports
CREATE POLICY reports_insert_auth ON reports FOR INSERT
  WITH CHECK (reporter_id = auth.uid() AND auth.uid() IS NOT NULL);

-- ---------------------------------------------------------------------------
-- insert_review_with_rank — atomic rank shift + insert in one transaction
-- Called from the app via supabase.rpc('insert_review_with_rank', {...})
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION insert_review_with_rank(
  p_eatery_id      uuid,
  p_text           text,
  p_favourite_dish text,
  p_rank           integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER           -- runs as DB owner so auth.uid() works from client
AS $$
BEGIN
  -- Guard: rank must be positive
  IF p_rank < 1 THEN
    RAISE EXCEPTION 'rank must be >= 1';
  END IF;

  -- Shift all existing reviews at or above the target slot down by one
  UPDATE reviews
  SET    rank = rank + 1
  WHERE  user_id = auth.uid()
    AND  rank >= p_rank;

  -- Insert the new review at the claimed slot
  INSERT INTO reviews (user_id, eatery_id, text, favourite_dish, rank)
  VALUES (auth.uid(), p_eatery_id, p_text, p_favourite_dish, p_rank);
END;
$$;

-- ---------------------------------------------------------------------------
-- update_review_with_rank — atomic re-rank of an existing review
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_review_with_rank(
  p_review_id      uuid,
  p_text           text,
  p_favourite_dish text,
  p_new_rank       integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old_rank integer;
BEGIN
  SELECT rank INTO v_old_rank
  FROM   reviews
  WHERE  id = p_review_id AND user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'review not found or not owned by caller';
  END IF;

  IF v_old_rank = p_new_rank THEN
    -- Only update text/dish, no rank changes needed
    UPDATE reviews
    SET text = p_text, favourite_dish = p_favourite_dish, updated_at = now()
    WHERE id = p_review_id;
    RETURN;
  END IF;

  IF p_new_rank < v_old_rank THEN
    -- Moving up: shift items between new and old rank down
    UPDATE reviews
    SET rank = rank + 1
    WHERE user_id = auth.uid()
      AND rank >= p_new_rank
      AND rank < v_old_rank
      AND id != p_review_id;
  ELSE
    -- Moving down: shift items between old and new rank up
    UPDATE reviews
    SET rank = rank - 1
    WHERE user_id = auth.uid()
      AND rank > v_old_rank
      AND rank <= p_new_rank
      AND id != p_review_id;
  END IF;

  UPDATE reviews
  SET rank = p_new_rank, text = p_text, favourite_dish = p_favourite_dish, updated_at = now()
  WHERE id = p_review_id;
END;
$$;

-- Grant execute to authenticated role only
GRANT EXECUTE ON FUNCTION insert_review_with_rank TO authenticated;
GRANT EXECUTE ON FUNCTION update_review_with_rank TO authenticated;
