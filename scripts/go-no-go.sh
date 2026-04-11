#!/usr/bin/env bash
# scripts/go-no-go.sh — P0 pre-submission checks (automated portion)
# Run from the repo root: bash scripts/go-no-go.sh
# Manual checks are listed at the bottom with instructions.
#
# Exit 0 = all automated checks passed.
# Exit 1 = one or more checks failed — do NOT submit to stores.

set -euo pipefail

PASS=0
FAIL=0
WARN=0

green() { printf '\033[0;32m✓ %s\033[0m\n' "$1"; }
red()   { printf '\033[0;31m✗ %s\033[0m\n' "$1"; }
warn()  { printf '\033[0;33m⚠ %s\033[0m\n' "$1"; }

check() {
  local label="$1"
  local cmd="$2"
  if eval "$cmd" &>/dev/null; then
    green "$label"
    PASS=$((PASS + 1))
  else
    red "$label"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "═══════════════════════════════════════"
echo "  Hala Go/No-Go — automated P0 checks"
echo "═══════════════════════════════════════"
echo ""

# ── Secrets scan ──────────────────────────────────────────────────────────────
echo "▸ Secrets"

check "No service role key in source" \
  "! git grep -rE '(service_role|eyJhbGci)' -- '*.ts' '*.tsx' '*.js' '*.json' ':!supabase/functions' ':!*example*' ':!*.env*' 2>/dev/null | grep -v '^Binary'"

check "No Google Maps API key in source" \
  "! git grep -rE 'AIzaSy' -- '*.ts' '*.tsx' '*.config.*' 2>/dev/null"

check "No Sentry auth token in source" \
  "! git grep -rE 'sntrys_' -- '*.ts' '*.tsx' '*.yml' 2>/dev/null"

check ".env.local is gitignored" \
  "git check-ignore -q .env.local"

check ".env.production is gitignored" \
  "git check-ignore -q .env.production"

# ── SecureStore adapter ───────────────────────────────────────────────────────
echo ""
echo "▸ Auth storage"

check "JWT stored in SecureStore (not AsyncStorage)" \
  "grep -q 'SecureStore' lib/supabase.ts && ! grep -q 'AsyncStorage' lib/supabase.ts"

# ── Input validation ──────────────────────────────────────────────────────────
echo ""
echo "▸ Input validation"

check "lib/validation.ts exists (Zod schemas)" \
  "test -f lib/validation.ts"

check "loginSchema exported" \
  "grep -q 'loginSchema' lib/validation.ts"

check "eateryReviewSchema exported" \
  "grep -q 'eateryReviewSchema' lib/validation.ts"

# ── Health endpoint ───────────────────────────────────────────────────────────
echo ""
echo "▸ Edge Functions"

check "health function exists" \
  "test -f supabase/functions/health/index.ts"

check "delete-account function exists" \
  "test -f supabase/functions/delete-account/index.ts"

check "export-data function exists" \
  "test -f supabase/functions/export-data/index.ts"

check "send-push uses EXPO_PUSH_ACCESS_TOKEN" \
  "grep -q 'EXPO_PUSH_ACCESS_TOKEN' supabase/functions/send-push/index.ts"

# ── Invite gate ───────────────────────────────────────────────────────────────
echo ""
echo "▸ Invite gate"

check "validate-invite function exists" \
  "test -f supabase/functions/validate-invite/index.ts"

check "use-invite function exists" \
  "test -f supabase/functions/use-invite/index.ts"

check "Open signup is blocked (no public signup route)" \
  "! grep -rq 'signUp' app/\(auth\)/signup.tsx 2>/dev/null || grep -q 'invite' app/\(auth\)/signup.tsx"

# ── Legal pages ───────────────────────────────────────────────────────────────
echo ""
echo "▸ Legal pages (hala-web)"

WEBDIR="${WEBDIR:-../hala-web}"

check "Privacy policy page exists" \
  "test -f '$WEBDIR/app/privacy/page.tsx'"

check "Terms of service page exists" \
  "test -f '$WEBDIR/app/terms/page.tsx'"

# ── Migrations ────────────────────────────────────────────────────────────────
echo ""
echo "▸ Migrations"

check "000_bootstrap.sql exists" \
  "test -f supabase/migrations/000_bootstrap.sql"

check "007_gdpr.sql exists (account deletion)" \
  "test -f supabase/migrations/007_gdpr.sql"

check "008_admin.sql exists (reports table)" \
  "test -f supabase/migrations/008_admin.sql"

# ── CI ────────────────────────────────────────────────────────────────────────
echo ""
echo "▸ CI/CD"

check "CI workflow exists" \
  "test -f .github/workflows/ci.yml"

check "Secret scan workflow exists" \
  "test -f .github/workflows/secret-scan.yml"

check "npm audit check in CI" \
  "grep -q 'npm audit' .github/workflows/ci.yml"

check "Bundle size check in CI" \
  "grep -q 'BUDGET' .github/workflows/ci.yml"

check "K6 load test script exists" \
  "test -f load-test/hala.js"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════"
printf "  Passed: %d  |  Failed: %d  |  Warned: %d\n" "$PASS" "$FAIL" "$WARN"
echo "═══════════════════════════════════════"
echo ""

if [ "$FAIL" -gt 0 ]; then
  red "GO/NO-GO: ❌ NO-GO — $FAIL check(s) failed"
  echo ""
else
  green "GO/NO-GO: ✅ Automated checks passed"
  echo ""
fi

echo "──────────────────────────────────────"
echo "  MANUAL P0 CHECKS (cannot automate)"
echo "──────────────────────────────────────"
cat <<'MANUAL'

□ RLS enabled & tested on all 5 tables
  → supabase db lint
  → Per-table: sign in as a test user, verify you cannot read another user's
    private data; verify anon role returns 0 rows on all tables.

□ Supabase security advisor: 0 warnings
  → Dashboard > Security > Advisor tab

□ Auth brute-force lockout after 5 failures
  → Enter wrong password 6 times on a real device.
    Verify lockout message appears and no further attempts are accepted.

□ Session invalidated on password reset
  → Device A: initiate password reset, complete on email link.
  → Device B (same account, already signed in): refresh any screen.
    Should be signed out / 401.

□ Account deletion removes all data
  → Create test account on staging, post 2 reviews.
  → Delete account in Settings.
  → Wait 30 days (or fast-track by running hard_delete_expired_accounts() manually).
  → Verify auth.users row is gone and all reviews are deleted.

□ All errors show user message + retry button
  → Enable Airplane Mode, open each data-fetching screen.
    Every screen must show an error message and a retry affordance.

□ Skeleton loaders on all data-fetching screens
  → Enable Network Link Conditioner (3G) on iPhone, launch app.
    Every screen must show skeleton cards before data appears.
    (Map uses ActivityIndicator overlay — acceptable for map screens.)

□ Empty states on all list views
  → Sign in with a fresh account (no friends, no reviews).
    Feed, Search, Friends, Notifications — all must show empty state illustrations.

□ health endpoint returns 200
  → curl -sf https://[your-ref].supabase.co/functions/v1/health | jq .

□ Sentry capturing crashes in prod build
  → eas build --profile production, install on device.
  → Trigger a forced crash (Settings > [hidden dev menu] if built in, or RN crash via native module).
  → Verify event appears in Sentry within 60 s.

□ k6 load test: p95 < 800 ms at 500 VUs
  → Provision a staging project with production-parity data (~1k eateries, ~5k reviews).
  → k6 run load-test/hala.js (exports SUPABASE_URL, SUPABASE_ANON_KEY)
  → Verify all thresholds pass.

□ Privacy policy live at hala.app/privacy
  → Open in browser. Verify URL, content loads, no 404.
  → Paste URL into iOS App Store Connect > App Information > Privacy Policy URL.

□ Terms of service live at hala.app/terms
  → Open in browser. Verify URL, content loads, no 404.

□ Invite-only gate — no open signup
  → On a fresh device (not previously used with the app), attempt to
    create an account without an invite code. Should be blocked.

MANUAL

echo ""
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
