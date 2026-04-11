-- =============================================================================
-- 004_waitlist.sql — public waitlist for invite-only access
-- =============================================================================

CREATE TABLE waitlist (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL CHECK (char_length(name) <= 120),
  email      text        NOT NULL CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email)
);

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- Public INSERT — no auth needed for waitlist signup
CREATE POLICY waitlist_insert ON waitlist
  FOR INSERT
  WITH CHECK (true);

-- No public SELECT — admin reads via service role only
