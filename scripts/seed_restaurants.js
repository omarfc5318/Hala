'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// seed_restaurants.js — Populate eateries table from Google Places API (New)
//
// Usage:  node scripts/seed_restaurants.js
//
// Resumes automatically from scripts/checkpoint.json if interrupted.
// All progress written to scripts/seed_log.txt.
// Rate-limit events written to scripts/rate_limit_log.txt.
// ─────────────────────────────────────────────────────────────────────────────

const path = require('path');
const fs   = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const { createClient } = require('@supabase/supabase-js');

// ─── VALIDATE ENV ─────────────────────────────────────────────────────────────

const GOOGLE_API_KEY       = process.env.GOOGLE_PLACES_API_KEY;
const SUPABASE_URL         = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!GOOGLE_API_KEY || GOOGLE_API_KEY === 'your_key_here') {
  console.error('ERROR: Set GOOGLE_PLACES_API_KEY in .env.local before running.');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── FILE PATHS ───────────────────────────────────────────────────────────────

const SCRIPTS_DIR      = __dirname;
const CHECKPOINT_FILE  = path.join(SCRIPTS_DIR, 'checkpoint.json');
const SEEN_IDS_FILE    = path.join(SCRIPTS_DIR, 'seen_place_ids.json');
const RATE_LIMIT_LOG   = path.join(SCRIPTS_DIR, 'rate_limit_log.txt');
const SEED_LOG_FILE    = path.join(SCRIPTS_DIR, 'seed_log.txt');

// ─── CITY DEFINITIONS ─────────────────────────────────────────────────────────

const CITIES = [
  {
    key:        'riyadh',
    searchName: 'Riyadh',
    bounds:     { minLat: 24.50, maxLat: 25.10, minLng: 46.50, maxLng: 47.20 },
  },
  {
    key:        'jeddah',
    searchName: 'Jeddah',
    bounds:     { minLat: 21.30, maxLat: 21.70, minLng: 39.10, maxLng: 39.30 },
  },
  {
    key:        'khobar',
    searchName: 'Khobar',
    bounds:     { minLat: 26.20, maxLat: 26.40, minLng: 50.15, maxLng: 50.25 },
  },
  {
    key:        'dubai',
    searchName: 'Dubai',
    bounds:     { minLat: 25.00, maxLat: 25.35, minLng: 55.10, maxLng: 55.50 },
  },
  {
    key:        'doha',
    searchName: 'Doha',
    bounds:     { minLat: 25.20, maxLat: 25.40, minLng: 51.45, maxLng: 51.60 },
  },
];

// ─── SEARCH QUERIES ───────────────────────────────────────────────────────────

// Pass 1–4: broad category sweeps
const BASIC_QUERY_TEMPLATES = [
  'restaurants in {city}',
  'cafes in {city}',
  'مطاعم {city}',
  'مقاهي {city}',
];

// Pass 5: cuisine-specific (city name appended at runtime)
const CUISINE_KEYWORDS = [
  'shawarma',
  'mandi',
  'kabsa',
  'biryani',
  'sushi',
  'burger',
  'pizza',
  'indian restaurant',
  'lebanese restaurant',
  'turkish restaurant',
  'chinese restaurant',
  'italian restaurant',
  'breakfast',
];

// Grid spacing (500 m ≈ these degree values at mid-GCC latitudes)
const LAT_STEP_DEG  = 0.0045;   // ~500 m
const LNG_STEP_DEG  = 0.0049;   // ~500 m at ~25° lat
const GRID_RADIUS_M = 500;

// ─── RATE-LIMITER STATE ───────────────────────────────────────────────────────

const MIN_REQUEST_INTERVAL_MS  = 100;   // 100 ms between every request
const RATE_LIMIT_BACKOFF_MS    = 60_000; // pause 60 s on HTTP 429
const BACKOFF_BASE_MS          = 2_000;  // first retry delay for other errors
const MAX_RETRIES              = 5;

let lastRequestAt = 0;

// ─── RUNTIME COUNTERS ─────────────────────────────────────────────────────────

let totalInserted      = 0;
let totalApiCalls      = 0;
let totalPhotosUploaded = 0;
const startTime        = Date.now();

// ─── IN-MEMORY DEDUP SET ──────────────────────────────────────────────────────

let seenIds = new Set();

// ─── CHECKPOINT ───────────────────────────────────────────────────────────────

function loadCheckpoint() {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    try {
      const cp = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
      log(`Resuming from checkpoint — ${cp.totalInserted} already inserted, ` +
          `${cp.completedSearchKeys.length} searches done.`);
      return cp;
    } catch (_) {
      log('Checkpoint file corrupt — starting fresh.');
    }
  }
  return { totalInserted: 0, cityStats: {}, completedSearchKeys: [] };
}

function saveCheckpoint(cp) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

// ─── SEEN PLACE IDs ───────────────────────────────────────────────────────────

function loadSeenIds() {
  if (fs.existsSync(SEEN_IDS_FILE)) {
    try {
      const arr = JSON.parse(fs.readFileSync(SEEN_IDS_FILE, 'utf8'));
      return new Set(arr);
    } catch (_) {}
  }
  return new Set();
}

function persistSeenIds() {
  fs.writeFileSync(SEEN_IDS_FILE, JSON.stringify([...seenIds]));
}

// ─── LOGGING ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = String(msg);
  console.log(line);
  try { fs.appendFileSync(SEED_LOG_FILE, line + '\n'); } catch (_) {}
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function elapsed() {
  const s = Math.floor((Date.now() - startTime) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

// ─── RATE-LIMITED FETCH ───────────────────────────────────────────────────────
// Runs requests sequentially (never in parallel), enforces ≥100 ms between
// each call, handles 429 with a 60 s full pause, and retries other failures
// with exponential back-off up to MAX_RETRIES.

async function rateLimitedFetch(url, options = {}) {
  // Enforce minimum spacing
  const gap = Date.now() - lastRequestAt;
  if (gap < MIN_REQUEST_INTERVAL_MS) await sleep(MIN_REQUEST_INTERVAL_MS - gap);

  let attempt  = 0;
  let backoff  = BACKOFF_BASE_MS;

  for (;;) {
    lastRequestAt = Date.now();
    totalApiCalls++;

    try {
      const res = await fetch(url, options);

      if (res.status === 429) {
        const msg = `[${new Date().toISOString()}] 429 on ${url.slice(0, 100)} — pausing 60 s\n`;
        log(msg.trimEnd());
        fs.appendFileSync(RATE_LIMIT_LOG, msg);
        await sleep(RATE_LIMIT_BACKOFF_MS);
        // Don't count 429 against retries — just loop again
        continue;
      }

      return res;

    } catch (err) {
      if (attempt >= MAX_RETRIES) throw err;
      log(`  Network error (attempt ${attempt + 1}/${MAX_RETRIES}): ${err.message}. Retry in ${backoff} ms…`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 32_000);
      attempt++;
    }
  }
}

// ─── PLACES API: TEXT SEARCH ──────────────────────────────────────────────────

const TEXT_SEARCH_URL       = 'https://places.googleapis.com/v1/places:searchText';
const TEXT_SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.types',
  'places.websiteUri',
  'places.photos',
  'places.priceLevel',
  'places.rating',
  'places.regularOpeningHours',
  'nextPageToken',
].join(',');

async function textSearch(query, lat, lng, pageToken = null) {
  const body = {
    textQuery:      query,
    maxResultCount: 20,
    languageCode:   'en',
  };

  if (lat !== null && lng !== null) {
    body.locationBias = {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: GRID_RADIUS_M,
      },
    };
  }

  if (pageToken) body.pageToken = pageToken;

  const res = await rateLimitedFetch(TEXT_SEARCH_URL, {
    method:  'POST',
    headers: {
      'Content-Type':    'application/json',
      'X-Goog-Api-Key':  GOOGLE_API_KEY,
      'X-Goog-FieldMask': TEXT_SEARCH_FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`textSearch HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

// ─── PLACES API: PLACE DETAILS ────────────────────────────────────────────────

const DETAIL_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'types',
  'websiteUri',
  'photos',
  'priceLevel',
  'rating',
  'regularOpeningHours',
].join(',');

async function fetchPlaceDetails(placeId) {
  const url = `https://places.googleapis.com/v1/places/${placeId}`;
  const res = await rateLimitedFetch(url, {
    headers: {
      'X-Goog-Api-Key':   GOOGLE_API_KEY,
      'X-Goog-FieldMask': DETAIL_FIELD_MASK,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`placeDetails HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

// ─── PLACES API: PHOTO ────────────────────────────────────────────────────────

async function fetchPhotoBuffer(photoName) {
  // photoName format: "places/ChIJ.../photos/AXCi3..."
  const url = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=1200&key=${GOOGLE_API_KEY}`;
  const res = await rateLimitedFetch(url);
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  return buf.byteLength > 0 ? Buffer.from(buf) : null;
}

// ─── SUPABASE STORAGE ─────────────────────────────────────────────────────────

async function uploadPhoto(buffer, cityKey, placeId, index) {
  const filePath = `${cityKey}/${placeId}/photo_${index}.jpg`;

  const { error } = await supabase.storage
    .from('eatery-photos')
    .upload(filePath, buffer, { contentType: 'image/jpeg', upsert: true });

  if (error) {
    log(`  ⚠ Storage upload failed (${filePath}): ${error.message}`);
    return null;
  }

  const { data } = supabase.storage.from('eatery-photos').getPublicUrl(filePath);
  return data.publicUrl;
}

// ─── PROCESS ONE PLACE ────────────────────────────────────────────────────────

async function processPlace(placeId, cityKey) {
  // Dedup check (in-memory Set first, always up-to-date)
  if (seenIds.has(placeId)) return null;
  seenIds.add(placeId);

  // Fetch full details
  let details;
  try {
    details = await fetchPlaceDetails(placeId);
  } catch (err) {
    log(`  Skipping ${placeId} — details error: ${err.message}`);
    seenIds.delete(placeId); // allow retry on next run
    return null;
  }

  if (!details.location || !details.displayName?.text) {
    log(`  Skipping ${placeId} — missing location or name`);
    return null;
  }

  // Fetch & upload up to 3 photos
  const photoUrls  = [];
  const photoRefs  = (details.photos || []).slice(0, 3);

  for (let i = 0; i < photoRefs.length; i++) {
    try {
      const buf = await fetchPhotoBuffer(photoRefs[i].name);
      if (buf) {
        const url = await uploadPhoto(buf, cityKey, placeId, i + 1);
        if (url) {
          photoUrls.push(url);
          totalPhotosUploaded++;
        }
      }
    } catch (err) {
      log(`  Photo ${i + 1} failed for ${placeId}: ${err.message} — continuing`);
    }
  }

  return {
    id:            crypto.randomUUID(),
    name:          details.displayName.text,
    location_text: details.formattedAddress || '',
    latitude:      details.location.latitude,
    longitude:     details.location.longitude,
    photos:        photoUrls,
    website:       details.websiteUri ?? null,
    menu_url:      null,
    city:          cityKey,
    submitted_by:  null,
    is_verified:   true,
    created_at:    new Date().toISOString(),
  };
  // Note: `geo` is omitted — it is a GENERATED ALWAYS column (computed from
  // latitude/longitude by PostGIS) and must not be supplied on insert.
}

// ─── INSERT BATCH ─────────────────────────────────────────────────────────────

async function flushBatch(batch, cityKey, cp) {
  if (batch.length === 0) return;

  const { error } = await supabase
    .from('eateries')
    .upsert(batch, { onConflict: 'id', ignoreDuplicates: true });

  if (error) {
    log(`  Insert error (${cityKey}): ${error.message}`);
    return;
  }

  totalInserted           += batch.length;
  cp.totalInserted         = totalInserted;
  cp.cityStats[cityKey]    = (cp.cityStats[cityKey] || 0) + batch.length;

  log(`[${cityKey.toUpperCase().padEnd(7)}] ${String(totalInserted).padStart(6)} inserted | ` +
      `${batch[batch.length - 1].name.slice(0, 40)} | ${elapsed()}`);

  if (totalInserted % 100 === 0) printSummary(cp);

  saveCheckpoint(cp);
  persistSeenIds();
}

// ─── PRINT SUMMARY ────────────────────────────────────────────────────────────

function printSummary(cp) {
  log('\n' + '─'.repeat(56));
  log('  CITY SUMMARY');
  log('─'.repeat(56));
  for (const [city, count] of Object.entries(cp.cityStats)) {
    log(`  ${city.padEnd(12)} ${String(count).padStart(6)} restaurants`);
  }
  log(`${'─'.repeat(56)}`);
  log(`  TOTAL          ${String(totalInserted).padStart(6)}`);
  log(`  API calls      ${String(totalApiCalls).padStart(6)}`);
  log(`  Photos         ${String(totalPhotosUploaded).padStart(6)}`);
  log(`  Elapsed        ${elapsed()}`);
  log('─'.repeat(56) + '\n');
}

// ─── RUN ONE SEARCH (all pages) ──────────────────────────────────────────────
// Returns array of rows ready to insert.

async function runSearch(query, lat, lng, searchKey, cityKey, cp) {
  if (cp.completedSearchKeys.includes(searchKey)) return [];

  const rows      = [];
  let   pageToken = null;
  let   pageNum   = 0;

  do {
    pageNum++;
    let result;

    try {
      result = await textSearch(query, lat, lng, pageToken);
    } catch (err) {
      log(`  Search error [${searchKey} p${pageNum}]: ${err.message} — skipping`);
      break;
    }

    for (const place of result.places || []) {
      if (!place.id) continue;
      const row = await processPlace(place.id, cityKey);
      if (row) rows.push(row);
    }

    pageToken = result.nextPageToken ?? null;
  } while (pageToken);

  cp.completedSearchKeys.push(searchKey);
  return rows;
}

// ─── GRID GENERATOR ───────────────────────────────────────────────────────────

function* gridPoints(bounds) {
  const { minLat, maxLat, minLng, maxLng } = bounds;
  for (let lat = minLat; lat <= maxLat + 1e-9; lat += LAT_STEP_DEG) {
    for (let lng = minLng; lng <= maxLng + 1e-9; lng += LNG_STEP_DEG) {
      yield {
        lat: +lat.toFixed(6),
        lng: +lng.toFixed(6),
      };
    }
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  log('\n' + '═'.repeat(60));
  log('  HALA Restaurant Seeder');
  log(`  Started: ${new Date().toISOString()}`);
  log('═'.repeat(60) + '\n');

  // Load checkpoint + seen IDs (enables resume)
  const cp = loadCheckpoint();
  seenIds   = loadSeenIds();

  // Sync counters from checkpoint
  totalInserted = cp.totalInserted;
  for (const [city, count] of Object.entries(cp.cityStats)) {
    log(`  Resumed: ${city} already has ${count} rows`);
  }
  if (seenIds.size > 0) log(`  ${seenIds.size} place IDs already seen — will skip duplicates\n`);

  // ── Phase 1: keyword passes ────────────────────────────────────────────────

  for (const city of CITIES) {
    log(`\n[${'KEYWORDS'.padEnd(7)}] ${city.key.toUpperCase()} — starting basic + cuisine passes`);

    const batch = [];

    // Basic passes 1–4
    for (const template of BASIC_QUERY_TEMPLATES) {
      const query     = template.replace('{city}', city.searchName);
      const searchKey = `${city.key}:basic:${template}`;

      const rows = await runSearch(query, null, null, searchKey, city.key, cp);
      batch.push(...rows);

      if (batch.length >= 10) {
        await flushBatch(batch.splice(0, Math.floor(batch.length / 10) * 10), city.key, cp);
      }
    }

    // Cuisine passes (Pass 5)
    for (const cuisine of CUISINE_KEYWORDS) {
      const query     = `${cuisine} in ${city.searchName}`;
      const searchKey = `${city.key}:cuisine:${cuisine}`;

      const rows = await runSearch(query, null, null, searchKey, city.key, cp);
      batch.push(...rows);

      if (batch.length >= 10) {
        await flushBatch(batch.splice(0, Math.floor(batch.length / 10) * 10), city.key, cp);
      }
    }

    // Flush remainder
    if (batch.length > 0) await flushBatch(batch, city.key, cp);
  }

  // ── Phase 2: grid searches ────────────────────────────────────────────────

  for (const city of CITIES) {
    const points = [...gridPoints(city.bounds)];
    log(`\n[${'GRID'.padEnd(7)}] ${city.key.toUpperCase()} — ${points.length} grid points × 500 m radius`);

    let batch = [];
    let pointsDone = 0;

    for (const { lat, lng } of points) {
      pointsDone++;
      const searchKey = `${city.key}:grid:${lat}:${lng}`;

      const rows = await runSearch('restaurant', lat, lng, searchKey, city.key, cp);
      batch.push(...rows);

      // Flush every 10 ready rows
      while (batch.length >= 10) {
        await flushBatch(batch.splice(0, 10), city.key, cp);
      }

      // Progress indicator every 50 grid points
      if (pointsDone % 50 === 0) {
        log(`  [${city.key.toUpperCase()}] grid ${pointsDone}/${points.length} points ` +
            `| ${city.key} total: ${cp.cityStats[city.key] || 0} | elapsed: ${elapsed()}`);
      }
    }

    // Flush grid remainder
    if (batch.length > 0) await flushBatch(batch, city.key, cp);
  }

  // ── Final summary ─────────────────────────────────────────────────────────

  log('\n' + '═'.repeat(60));
  log('  FINAL SUMMARY');
  log('═'.repeat(60));
  for (const [city, count] of Object.entries(cp.cityStats)) {
    log(`  ${city.padEnd(12)} ${String(count).padStart(6)} restaurants`);
  }
  log('─'.repeat(60));
  log(`  GRAND TOTAL    ${String(totalInserted).padStart(6)} restaurants`);
  log(`  API calls      ${String(totalApiCalls).padStart(6)}`);
  log(`  Photos         ${String(totalPhotosUploaded).padStart(6)} uploaded`);
  log(`  Elapsed        ${elapsed()}`);
  log('═'.repeat(60));
  log(`  Completed: ${new Date().toISOString()}\n`);
}

main().catch(err => {
  log(`\nFATAL: ${err.stack || err.message}`);
  process.exit(1);
});
