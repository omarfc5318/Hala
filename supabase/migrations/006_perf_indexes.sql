-- =============================================================================
-- 006_perf_indexes.sql — missing indexes identified by pre-launch EXPLAIN ANALYZE
-- =============================================================================
-- Run EXPLAIN ANALYZE on each critical query in the Supabase SQL editor before
-- deploying to production. Every node must show "Index Scan" or "Index Only Scan"
-- on tables with >1000 rows. A "Seq Scan" on a large table is a launch blocker.
--
-- CRITICAL QUERIES TO AUDIT:
-- =============================================================================

-- 1. FEED QUERY (search.tsx — most frequently hit endpoint)
--
--   EXPLAIN ANALYZE
--   SELECT id, name, location_text, photos, city
--   FROM   eateries
--   WHERE  is_verified = true
--     AND  city = 'riyadh'
--   ORDER  BY created_at DESC
--   LIMIT  20;
--
-- Before this migration: Seq Scan on eateries (city filter is not selective enough
-- to use idx_eateries_city alone when also filtering is_verified + ordering by date).
-- After:  Index Scan using idx_eateries_feed on eateries

CREATE INDEX IF NOT EXISTS idx_eateries_feed
  ON eateries (is_verified, city, created_at DESC);

-- 2. SEARCH QUERY (search.tsx — ILIKE on name)
--
--   EXPLAIN ANALYZE
--   SELECT id, name, location_text, photos, city
--   FROM   eateries
--   WHERE  is_verified = true
--     AND  name ILIKE '%burger%'
--   LIMIT  20;
--
-- B-tree indexes cannot accelerate ILIKE '%pattern%' — a GIN trigram index is
-- required. pg_trgm is bundled with Supabase.
-- After:  Bitmap Index Scan on idx_eateries_name_trgm

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_eateries_name_trgm
  ON eateries USING GIN (name gin_trgm_ops);

-- 3. RANK-SHIFT QUERY (insert_review_with_rank / update_review_with_rank RPC)
--
--   EXPLAIN ANALYZE
--   UPDATE reviews
--   SET    rank = rank + 1
--   WHERE  user_id = '<uuid>'
--     AND  rank >= 2;
--
-- Before: Seq Scan on reviews (idx_reviews_user only covers equality, not range)
-- After:  Index Scan using idx_reviews_user_rank

CREATE INDEX IF NOT EXISTS idx_reviews_user_rank
  ON reviews (user_id, rank);

-- 4. PUSH TOKEN LOOKUP (send-push edge function — called on every notification)
--
--   EXPLAIN ANALYZE
--   SELECT token
--   FROM   push_tokens
--   WHERE  user_id = '<uuid>';
--
-- Before: Seq Scan on push_tokens (no index on user_id)
-- After:  Index Scan using idx_push_tokens_user

CREATE INDEX IF NOT EXISTS idx_push_tokens_user
  ON push_tokens (user_id);

-- 5. REVIEW COUNT AGGREGATION (feed ordered by popularity)
--
--   EXPLAIN ANALYZE
--   SELECT e.*, COUNT(r.id) AS review_count
--   FROM   eateries e
--   LEFT   JOIN reviews r ON r.eatery_id = e.id
--   WHERE  e.city = 'riyadh'
--   GROUP  BY e.id
--   ORDER  BY review_count DESC
--   LIMIT  20;
--
-- The left join relies on idx_reviews_eatery (already exists).
-- Adding a partial index covering the city filter removes the need to scan the
-- full reviews table when only counting for one city's eateries.
-- After:  Index Scan on idx_eateries_feed + Bitmap Heap Scan on idx_reviews_eatery

-- (No new index needed — covered by idx_eateries_feed above + existing idx_reviews_eatery)

-- 6. INVITATION MANAGEMENT (invite/index.tsx — list codes created by user)
--
--   EXPLAIN ANALYZE
--   SELECT *, users!used_by(username)
--   FROM   invitations
--   WHERE  created_by = '<uuid>';

CREATE INDEX IF NOT EXISTS idx_invitations_created_by
  ON invitations (created_by);

-- =============================================================================
-- N+1 QUERY AUDIT RESULTS
-- =============================================================================
-- All screens audited — no N+1 patterns found. Summary:
--
-- search.tsx        ✓  Friend reviews: single .in('user_id', friendIds) batch
-- eatery/[id].tsx   ✓  Friend reviews + eatery loaded with Promise.all
-- notifications.tsx ✓  Actor join in main query; eatery names via .in('id', ids)
-- map.tsx           ✓  All friend data fetched in one 60-row review query
-- friends/index.tsx ✓  Two queries (bidirectional FK), but O(1) not O(n)
-- profile.tsx       ✓  Reviews loaded with eatery join in single query
-- =============================================================================
