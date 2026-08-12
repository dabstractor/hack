#!/usr/bin/env bash
# =============================================================================
# validate.sh — Comprehensive validation for the PRP Pipeline (hacky-hack)
# =============================================================================
# Runs every quality gate the project ships, plus end-to-end CLI workflow checks
# that mirror the real user journeys documented in README.md and the PRD.
#
# This is a VALIDATION script: it READS and RUNS the existing toolchain; it does
# NOT modify source, does NOT touch plan/, does NOT run the autonomous pipeline,
# and does NOT spawn coding agents. Safe to run inside the live repo.
#
# Phases (only phases that exist in this codebase are included):
#   1. Lint            (eslint)
#   2. Typecheck       (tsc --noEmit)
#   3. Style/Format    (prettier --check)
#   4. Build           (tsc -p tsconfig.build.json)
#   5. Unit/Integration(vitest run)
#   6. Docs            (docs:check + markdown structure)
#   7. Structural guards(§9.10.2 commit-identity self-source-scan)
#   8. E2E CLI journeys(--version/--help/invalid args/repo-root/not-a-git/config/dry-run)
#   9. Integration health(groundswell link + stagecoach binary presence)
#
# Exit code: 0 only if EVERY phase passes; non-zero otherwise.
# =============================================================================
set -u
set -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PASS=0
FAIL=0
FAILED_PHASES=()

# Capture a real process exit code without a pipe eating it (recurring gotcha).
run_check() {
  # $1 = phase label; rest = command
  local label="$1"; shift
  "$@" >/tmp/validate_"${label// /_}".log 2>&1
  local rc=$?
  if [ "$rc" -eq 0 ]; then
    printf '  \033[32m✓\033[0m %s\n' "$label"
    PASS=$((PASS+1))
  else
    printf '  \033[31m✗\033[0m %s (exit %d; see /tmp/validate_%s.log)\n' "$label" "$rc" "${label// /_}"
    FAIL=$((FAIL+1))
    FAILED_PHASES+=("$label")
  fi
  return "$rc"
}

echo "══════════════════════════════════════════════════════════════════════════════"
echo " PRP Pipeline — comprehensive validation"
echo " root: $ROOT"
echo " node: $(node --version)   npm: $(npm --version)"
echo "══════════════════════════════════════════════════════════════════════════════"

# -----------------------------------------------------------------------------
# Phase 1 — Lint
# -----------------------------------------------------------------------------
echo ""
echo "■ Phase 1: Lint (eslint)"
run_check "lint" npm run lint

# -----------------------------------------------------------------------------
# Phase 2 — Typecheck
# -----------------------------------------------------------------------------
echo ""
echo "■ Phase 2: Typecheck (tsc --noEmit)"
run_check "typecheck" npm run typecheck

# -----------------------------------------------------------------------------
# Phase 3 — Style / Format
# -----------------------------------------------------------------------------
echo ""
echo "■ Phase 3: Style/format (prettier --check)"
run_check "format-check" npm run format:check

# -----------------------------------------------------------------------------
# Phase 4 — Build
# -----------------------------------------------------------------------------
echo ""
echo "■ Phase 4: Build (tsc -p tsconfig.build.json)"
run_check "build" npm run build

# -----------------------------------------------------------------------------
# Phase 5 — Unit + Integration tests
# -----------------------------------------------------------------------------
echo ""
echo "■ Phase 5: Unit + Integration tests (vitest run)"
run_check "test-run" npm run test:run

# -----------------------------------------------------------------------------
# Phase 6 — Docs
# -----------------------------------------------------------------------------
echo ""
echo "■ Phase 6: Documentation (docs:check)"
run_check "docs-check" npm run docs:check

# -----------------------------------------------------------------------------
# Phase 7 — Structural guards (PRD §9.10.2 commit-identity self-source-scan)
# -----------------------------------------------------------------------------
echo ""
echo "■ Phase 7: Structural guards (§9.10.2 commit-identity)"
echo "  7a. No module-scope loggers (§9.6.3 REQ-L2)"
if rg -q '^(export )?(const|let) [A-Za-z_]+ = getLogger\(' src/; then
  echo "    \033[31m✗\033[0m module-scope getLogger found"; FAIL=$((FAIL+1)); FAILED_PHASES+=("§9.6.3 module-scope logger")
else
  echo "    \033[32m✓\033[0m zero module-scope loggers"; PASS=$((PASS+1))
fi
echo "  7b. No forbidden identity/attribution literals in src (non-comment)"
if rg '(Co-Authored-By|noreply@anthropic\.com|Generated with \[Claude|GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL|DATE))' src/ \
     | rg -vE ':\s*(//|\*|/\*|\s\*)' | grep -q .; then
  echo "    \033[31m✗\033[0m forbidden identity literal present"; FAIL=$((FAIL+1)); FAILED_PHASES+=("§9.10.2 identity literal")
else
  echo "    \033[32m✓\033[0m zero identity literals"; PASS=$((PASS+1))
fi
echo "  7c. Commit-identity structural-guard test"
run_check "identity-guard-test" npx vitest run tests/unit/guards/commit-identity-guard.test.ts

# -----------------------------------------------------------------------------
# Phase 8 — End-to-end CLI journeys (real user workflows from README/PRD)
#   Each command is run WITHOUT a stdout pipe so the true exit code is captured.
# -----------------------------------------------------------------------------
echo ""
echo "■ Phase 8: E2E CLI journeys"
HACK="node $ROOT/dist/index.js"

echo "  8a. --version (exit 0)"
$HACK --version >/tmp/v_ver.log 2>&1 && { echo "    \033[32m✓\033[0m"; PASS=$((PASS+1)); } || { echo "    \033[31m✗\033[0m exit=$?"; FAIL=$((FAIL+1)); FAILED_PHASES+=("cli --version"); }

echo "  8b. --help (exit 0, §9.6.3 fast teardown)"
$HACK --help >/tmp/v_help.log 2>&1 && { echo "    \033[32m✓\033[0m"; PASS=$((PASS+1)); } || { echo "    \033[31m✗\033[0m exit=$?"; FAIL=$((FAIL+1)); FAILED_PHASES+=("cli --help"); }

echo "  8c. unknown flag (MUST exit non-zero)"
$HACK --no-such-flag >/tmp/v_bad.log 2>&1; rc=$?
if [ "$rc" -ne 0 ]; then echo "    \033[32m✓\033[0m exit=$rc"; PASS=$((PASS+1)); else echo "    \033[31m✗\033[0m exit=0 (should be non-zero)"; FAIL=$((FAIL+1)); FAILED_PHASES+=("cli unknown-flag exit code"); fi

echo "  8d. invalid --mode value (MUST exit non-zero, §5.4)"
$HACK --mode bogus >/tmp/v_mode.log 2>&1; rc=$?
if [ "$rc" -ne 0 ]; then echo "    \033[32m✓\033[0m exit=$rc"; PASS=$((PASS+1)); else echo "    \033[31m✗\033[0m exit=0 (should be non-zero)"; FAIL=$((FAIL+1)); FAILED_PHASES+=("cli invalid-mode exit code"); fi

echo "  8e. repo-root resolution from subdir (§9.8.9: --version from src/)"
( cd "$ROOT/src/agents" && $HACK --version >/tmp/v_sub.log 2>&1 && grep -q "$(node --version)" /dev/null ) \
  && $HACK --version >/dev/null 2>&1 \
  && { ( cd "$ROOT/src/agents" && $HACK config path >/tmp/v_sub2.log 2>&1 ); grep -q "$ROOT/.hack" /tmp/v_sub2.log && { echo "    \033[32m✓\033[0m"; PASS=$((PASS+1)); } || { echo "    \033[31m✗\033[0m .hack not resolved from subdir"; FAIL=$((FAIL+1)); FAILED_PHASES+=("repo-root from subdir"); }; } || { echo "    \033[31m✗\033[0m"; FAIL=$((FAIL+1)); FAILED_PHASES+=("repo-root from subdir"); }

echo "  8f. not-a-git-repo hard error (§9.8.5: MUST exit 1, no session/agent)"
NG=/tmp/hacky_validate_nongit
rm -rf "$NG" && mkdir -p "$NG/deep" && ( cd "$NG/deep" && $HACK --dry-run >/tmp/v_ng.log 2>&1 ); rc=$?
if [ "$rc" -eq 1 ] && grep -q "No .git entry found" /tmp/v_ng.log; then
  echo "    \033[32m✓\033[0m exit=1 with actionable message"; PASS=$((PASS+1))
else
  echo "    \033[31m✗\033[0m exit=$rc (expected 1)"; FAIL=$((FAIL+1)); FAILED_PHASES+=("not-a-git-repo hard error")
fi

echo "  8g. credential-free --dry-run from repo root (no API/session)"
$HACK --dry-run >/tmp/v_dry.log 2>&1; rc=$?
if [ "$rc" -eq 0 ] && grep -q "DRY RUN" /tmp/v_dry.log; then
  echo "    \033[32m✓\033[0m"; PASS=$((PASS+1))
else
  echo "    \033[31m✗\033[0m exit=$rc"; FAIL=$((FAIL+1)); FAILED_PHASES+=("dry-run")
fi

echo "  8h. credential-free --validate-prd over distributed spec/SPEC.md (§2.3)"
$HACK --validate-prd >/tmp/v_vprd.log 2>&1; rc=$?
if [ "$rc" -eq 0 ] && grep -q "VALID" /tmp/v_vprd.log; then
  echo "    \033[32m✓\033[0m"; PASS=$((PASS+1))
else
  echo "    \033[31m✗\033[0m exit=$rc"; FAIL=$((FAIL+1)); FAILED_PHASES+=("validate-prd")
fi

echo "  8i. read-only task/status (§5.3)"
$HACK status >/tmp/v_status.log 2>&1 && { echo "    \033[32m✓\033[0m"; PASS=$((PASS+1)); } || { echo "    \033[31m✗\033[0m exit=$?"; FAIL=$((FAIL+1)); FAILED_PHASES+=("cli status"); }

# -----------------------------------------------------------------------------
# Phase 9 — Integration health
# -----------------------------------------------------------------------------
echo ""
echo "■ Phase 9: Integration health"
echo "  9a. groundswell link + file-backed auth.json (§9.2.6)"
run_check "validate-groundswell" npm run validate:groundswell

echo "  9b. stagecoach binary resolvable (§9.10.1 transitive install)"
SC="$(find "$HOME/.stagecoach/versions" -type f -name stagecoach 2>/dev/null | sort -V | tail -1)"
if [ -n "$SC" ] && "$SC" --version >/tmp/v_sc.log 2>&1; then
  echo "    \033[32m✓\033[0m $($SC --version 2>&1)"; PASS=$((PASS+1))
else
  echo "    \033[31m✗\033[0m stagecoach binary not found/runnable"; FAIL=$((FAIL+1)); FAILED_PHASES+=("stagecoach binary")
fi

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "══════════════════════════════════════════════════════════════════════════════"
echo " SUMMARY:  $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo " Failed phases:"
  for p in "${FAILED_PHASES[@]}"; do printf '   - %s\n' "$p"; done
  echo "══════════════════════════════════════════════════════════════════════════════"
  exit 1
fi
echo " All validation phases passed."
echo "══════════════════════════════════════════════════════════════════════════════"
exit 0