-- =============================================================================
-- 000_bootstrap.sql — Pre-Phase-1 setup: extensions, vault, pg_cron, storage
-- Run once on a fresh project before any other migrations.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- EXTENSIONS
-- Note: pgcrypto, postgis, pg_net are also referenced in 001_init.sql
-- (CREATE EXTENSION IF NOT EXISTS is idempotent — safe to declare here too).
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- needed by 006_perf_indexes.sql

-- ---------------------------------------------------------------------------
-- VAULT — app-level encryption key
-- Replace the placeholder string before running in production.
-- In CI/staging use a different key; never share prod key.
-- ---------------------------------------------------------------------------

SELECT vault.create_secret(
  'REPLACE_WITH_32_CHAR_RANDOM_STRING',   -- openssl rand -hex 16
  'app_encryption_key',
  'Used for PII field encryption'
)
WHERE NOT EXISTS (
  SELECT 1 FROM vault.secrets WHERE name = 'app_encryption_key'
);

-- ---------------------------------------------------------------------------
-- STORAGE BUCKETS
-- Buckets themselves must be created via Dashboard or supabase-js Admin SDK
-- (SQL cannot INSERT into storage.buckets in hosted Supabase).
-- The RLS policies below are applied once the buckets exist.
-- ---------------------------------------------------------------------------

-- avatars bucket — private, 5 MB, images only
-- Dashboard > Storage > New bucket:
--   Name: avatars | Public: NO | Limit: 5242880 | MIME: image/jpeg,image/png,image/webp

-- eateries bucket — private, 5 MB, images only
-- Dashboard > Storage > New bucket:
--   Name: eateries | Public: NO | Limit: 5242880 | MIME: image/jpeg,image/png,image/webp

-- ---------------------------------------------------------------------------
-- STORAGE RLS — avatars bucket
-- ---------------------------------------------------------------------------

-- Allow authenticated users to upload to their own folder (avatars/<uid>/*)
CREATE POLICY "avatars: owner can upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allow authenticated users to read any avatar (signed URLs are enforced at app layer)
CREATE POLICY "avatars: authenticated can read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'avatars');

-- Allow owners to replace (update) their own avatar
CREATE POLICY "avatars: owner can update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allow owners to delete their own avatar
CREATE POLICY "avatars: owner can delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- STORAGE RLS — eateries bucket
-- ---------------------------------------------------------------------------

CREATE POLICY "eateries: owner can upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'eateries'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "eateries: authenticated can read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'eateries');

CREATE POLICY "eateries: owner can update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'eateries'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "eateries: owner can delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'eateries'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
