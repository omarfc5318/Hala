-- =============================================================================
-- 001_init.sql — Hala: initial schema, RLS policies, indexes, triggers
-- =============================================================================

-- ---------------------------------------------------------------------------
-- EXTENSIONS
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id          uuid        PRIMARY KEY DEFAULT auth.uid(),
  name        text        NOT NULL,
  username    text        UNIQUE NOT NULL
                            CHECK (username ~ '^[a-zA-Z0-9._]{3,30}$'),
  bio         text        CHECK (char_length(bio) <= 160),
  city        text        CHECK (city IN ('riyadh', 'dubai')),
  is_public   boolean     NOT NULL DEFAULT true,
  photo_url   text,
  status      text        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'suspended')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE eateries (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  location_text text        NOT NULL,
  latitude      float8      NOT NULL,
  longitude     float8      NOT NULL,
  -- Computed geography column for PostGIS spatial queries
  geo           geography(Point, 4326)
                  GENERATED ALWAYS AS (
                    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
                  ) STORED,
  photos        text[]      NOT NULL DEFAULT '{}',
  website       text,
  menu_url      text,
  city          text        CHECK (city IN ('riyadh', 'dubai')),
  submitted_by  uuid        REFERENCES users(id) ON DELETE SET NULL,
  is_verified   boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reviews (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  eatery_id      uuid        NOT NULL REFERENCES eateries(id) ON DELETE CASCADE,
  text           text        CHECK (char_length(text) <= 500),
  favourite_dish text        CHECK (char_length(favourite_dish) <= 100),
  -- rank > 0; app layer enforces upper bound (e.g. 1–5)
  rank           integer     NOT NULL CHECK (rank > 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, eatery_id)
);

CREATE TABLE friendships (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requester_id, addressee_id),
  -- Prevent self-friendship at the DB level
  CHECK (requester_id != addressee_id)
);

CREATE TABLE invitations (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 12-char hex token; unique at DB level
  code       text        UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(6), 'hex'),
  created_by uuid        REFERENCES users(id) ON DELETE CASCADE,
  used_by    uuid        REFERENCES users(id) ON DELETE SET NULL,
  used_at    timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only audit trail; never update/delete rows here
CREATE TABLE audit_log (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES users(id) ON DELETE SET NULL,
  action     text        NOT NULL,
  table_name text        NOT NULL,
  row_id     uuid,
  -- Store a hash of the IP, never the raw value
  ip_hash    text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------

CREATE INDEX idx_users_username    ON users (username);
CREATE INDEX idx_reviews_user      ON reviews (user_id);
CREATE INDEX idx_reviews_eatery    ON reviews (eatery_id);
CREATE INDEX idx_friends_requester ON friendships (requester_id);
CREATE INDEX idx_friends_addressee ON friendships (addressee_id);
CREATE INDEX idx_eateries_city     ON eateries (city);
-- GIST index powers ST_DWithin / ST_Distance proximity queries
CREATE INDEX idx_eateries_geo      ON eateries USING GIST (geo);
-- Partial index: quickly fetch pending requests for a given addressee
CREATE INDEX idx_friends_pending   ON friendships (addressee_id)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------

ALTER TABLE users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE eateries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews     ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log   ENABLE ROW LEVEL SECURITY;

-- ── users ──────────────────────────────────────────────────────────────────

-- Own row is always visible
CREATE POLICY users_select_own ON users
  FOR SELECT
  USING (auth.uid() = id);

-- Public profiles are visible to any authenticated user
CREATE POLICY users_select_public ON users
  FOR SELECT
  USING (is_public = true);

-- Private profiles are visible to accepted friends
CREATE POLICY users_select_friend ON users
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM friendships
      WHERE status = 'accepted'
        AND (
          (requester_id = auth.uid() AND addressee_id = id)
          OR
          (addressee_id = auth.uid() AND requester_id = id)
        )
    )
  );

-- Users may only insert their own row (triggered on sign-up)
CREATE POLICY users_insert_own ON users
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Users may only update their own row
CREATE POLICY users_update_own ON users
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ── reviews ────────────────────────────────────────────────────────────────

-- Own reviews always visible
CREATE POLICY reviews_select_own ON reviews
  FOR SELECT
  USING (user_id = auth.uid());

-- Friend reviews visible when friendship is accepted
CREATE POLICY reviews_select_friend ON reviews
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM friendships
      WHERE status = 'accepted'
        AND (
          (requester_id = auth.uid() AND addressee_id = user_id)
          OR
          (addressee_id = auth.uid() AND requester_id = user_id)
        )
    )
  );

CREATE POLICY reviews_insert_own ON reviews
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY reviews_update_own ON reviews
  FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY reviews_delete_own ON reviews
  FOR DELETE
  USING (user_id = auth.uid());

-- ── friendships ────────────────────────────────────────────────────────────

-- Both parties can see the row
CREATE POLICY friends_select ON friendships
  FOR SELECT
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());

-- Only the requester can create a friendship row
CREATE POLICY friends_insert ON friendships
  FOR INSERT
  WITH CHECK (requester_id = auth.uid());

-- Only the addressee can accept or decline
CREATE POLICY friends_update ON friendships
  FOR UPDATE
  USING (addressee_id = auth.uid());

-- Either party can remove a friendship
CREATE POLICY friends_delete ON friendships
  FOR DELETE
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());

-- ── eateries ───────────────────────────────────────────────────────────────

-- Anyone (including anon) can browse eateries
CREATE POLICY eateries_select_all ON eateries
  FOR SELECT
  USING (true);

-- Only authenticated users can submit new eateries
CREATE POLICY eateries_insert_auth ON eateries
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ── invitations ────────────────────────────────────────────────────────────

-- Owners can see their own codes
CREATE POLICY invitations_select_own ON invitations
  FOR SELECT
  USING (created_by = auth.uid());

-- Authenticated users can create invitation codes
CREATE POLICY invitations_insert_auth ON invitations
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND created_by = auth.uid());

-- Only the owner can mark their code as used (claim handled in a function)
CREATE POLICY invitations_update_own ON invitations
  FOR UPDATE
  USING (created_by = auth.uid());

-- ── audit_log ──────────────────────────────────────────────────────────────

-- Users can read only their own audit rows
CREATE POLICY audit_log_select_own ON audit_log
  FOR SELECT
  USING (user_id = auth.uid());

-- Inserts happen via server-side triggers / functions only (no direct client INSERT)
-- No INSERT policy — enforce via service role or trigger

-- ---------------------------------------------------------------------------
-- TRIGGERS — updated_at maintenance
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_reviews_updated
  BEFORE UPDATE ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
