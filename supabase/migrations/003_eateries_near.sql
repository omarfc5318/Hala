-- =============================================================================
-- 003_eateries_near.sql — proximity geo query for the map screen
-- =============================================================================

-- Returns all verified eateries within `radius_m` metres of (lat, lng).
-- Using SECURITY INVOKER so existing eateries_select_all RLS policy applies.
-- The GIST index on `geo` (idx_eateries_geo) powers the ST_DWithin call.

CREATE OR REPLACE FUNCTION eateries_near(
  lat      float8,
  lng      float8,
  radius_m float8
)
RETURNS TABLE (
  id            uuid,
  name          text,
  latitude      float8,
  longitude     float8,
  photos        text[],
  city          text,
  location_text text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT id, name, latitude, longitude, photos, city, location_text
  FROM   eateries
  WHERE  is_verified = true
    AND  ST_DWithin(
           geo,
           ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
           radius_m
         );
$$;

-- Allow both authenticated users and anonymous (public map browsing)
GRANT EXECUTE ON FUNCTION eateries_near TO authenticated, anon;
