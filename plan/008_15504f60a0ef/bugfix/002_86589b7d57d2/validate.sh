#!/usr/bin/env bash
# =============================================================================
# validate.sh — Comprehensive validation for hacky-hack (PRP Pipeline)
# =============================================================================
# Runs EVERY safe, non-pipeline validation phase that exists in this codebase:
#   lint, typecheck, format, unit/integration/e2e tests, coverage gate, build,
#   docs consistency, groundswell link validation, the PRD §9.6 logging
#   acceptance criteria, and read-only / credential-free CLI smoke tests.
#
# SAFETY (per repo AGENTS.md): this script NEVER runs the pipeline itself and
# NEVER touches plan/. Every CLI invocation below is either credential-free
# (--help/--version/--dry-run/--validate-prd) or a strictly read-only query
# subcommand (inspect / validate-state / task / status) against an existing
# session. No session is created and no agent is invoked.
#
# Usage:
#   ./validate.sh                # run all phases, fail-fast on error
#   ./validate.sh --keep-going   # run all phases, report every failure at end
#   ./validate.sh --no-coverage  # skip the (slow) 100% coverage gate
#   ./validate.sh --smoke-only   # run only the CLI smoke-test phase
# =============================================================================

set -uo pipefail

# ---------------------------------------------------------------------------
# Configuration & helpers
# ---------------------------------------------------------------------------
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

KEEP_GOING=0
SKIP_COVERAGE=0
SMOKE_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --keep-going) KEEP_GOING=1 ;;
    --no-coverage) SKIP_COVERAGE=1 ;;
    --smoke-only) SMOKE_ONLY=1 ;;
    -h|--help)
      sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# Colors (disabled when not a TTY / NO_COLOR set)
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'
  BLUE=$'\033[34m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
else
  GREEN=''; RED=''; YELLOW=''; BLUE=''; BOLD=''; RESET=''
fi

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0
FAILED_PHASES=()

now_ms() { date +%s%3N; }
phase_start=0
phase() { printf '\n%s======== %s ======== %s\n' "$BLUE$BOLD" "$1" "$RESET"; phase_start=$(now_ms); }

result() { # result <PASS|WARN|FAIL> <label> [detail]
  local status="$1" label="$2" detail="${3:-}"
  local elapsed=$(( $(now_ms) - phase_start ))
  local tag
  case "$status" in
    PASS) tag="${GREEN}PASS${RESET}"; PASS_COUNT=$((PASS_COUNT+1)) ;;
    WARN) tag="${YELLOW}WARN${RESET}"; WARN_COUNT=$((WARN_COUNT+1)) ;;
    FAIL) tag="${RED}FAIL${RESET}";   FAIL_COUNT=$((FAIL_COUNT+1)); FAILED_PHASES+=("$label") ;;
  esac
  printf '%s  [%s] %s (%sms)%s\n' "$BOLD" "$tag" "$label" "$elapsed" "$RESET"
  if [[ -n "$detail" ]]; then printf '%s      └─ %s%s\n' "$YELLOW" "$detail" "$RESET"; fi
  if [[ "$status" == "FAIL" && $KEEP_GOING -eq 0 ]]; then
    printf '\n%sPhase failed and --keep-going not set; aborting. Re-run with --keep-going to see all failures.%s\n' "$RED" "$RESET" >&2
    exit 1
  fi
}

assert_cmd() { command -v "$1" >/dev/null 2>&1; } # assert_cmd <cmd>

# Run an npm script, capture pass/fail by exit code (output streamed to caller).
npm_run() { # npm_run <script-name>
  npm run --silent "$1"
}

# ===========================================================================
# 0. PREFLIGHT — environment sanity
# ===========================================================================
phase "Phase 0: Preflight (toolchain & repo)"
{
  ok=1
  assert_cmd node || { echo "node not found on PATH" >&2; ok=0; }
  assert_cmd npm  || { echo "npm not found on PATH" >&2; ok=0; }
  assert_cmd git  || { echo "git not found on PATH" >&2; ok=0; }
  [[ -f package.json ]] || { echo "package.json missing (wrong cwd?)" >&2; ok=0; }
  [[ -d node_modules ]] || { echo "node_modules missing — run 'npm install' first" >&2; ok=0; }
  [[ -d node_modules/groundswell ]] || { echo "groundswell dependency missing" >&2; ok=0; }
  node -v | grep -qE '^v(2[0-9]|[3-9][0-9])\.' || { echo "Node.js >= 20 required" >&2; ok=0; }
  if [[ $ok -ne 1 ]]; then result FAIL "Preflight"; else result PASS "Preflight"; fi
}
[[ $SMOKE_ONLY -eq 1 ]] && { printf '\n%s--smoke-only: jumping to CLI smoke tests%s\n' "$YELLOW" "$RESET"; goto_smoke=1; }

# ===========================================================================
# 1. LINT
# ===========================================================================
if [[ "${goto_smoke:-0}" -ne 1 ]]; then
phase "Phase 1: Lint (eslint)"
if npm_run lint >/tmp/validate.lint 2>&1; then
  warns=$(grep -c 'warning' /tmp/validate.lint 2>/dev/null || echo 0)
  result PASS "Lint" "${warns} warning(s) (0 errors)"
else
  result FAIL "Lint" "eslint reported errors — see /tmp/validate.lint"
fi

# ===========================================================================
# 2. TYPE CHECK
# ===========================================================================
phase "Phase 2: Type check (tsc --noEmit)"
if npm_run typecheck >/tmp/validate.typecheck 2>&1; then
  result PASS "Type check"
else
  result FAIL "Type check" "see /tmp/validate.typecheck"
fi

# ===========================================================================
# 3. FORMAT CHECK
# ===========================================================================
phase "Phase 3: Format check (prettier)"
if npm_run format:check >/tmp/validate.format 2>&1; then
  result PASS "Format check"
else
  result FAIL "Format check" "run 'npm run format' — see /tmp/validate.format"
fi

# ===========================================================================
# 4. UNIT / INTEGRATION / E2E TESTS
# ===========================================================================
phase "Phase 4: Test suite (vitest run)"
if npm_run test:run >/tmp/validate.tests 2>&1; then
  summary=$(grep -E 'Tests +[0-9]+ passed' /tmp/validate.tests | tail -1)
  result PASS "Test suite" "${summary:-ok}"
else
  result FAIL "Test suite" "see /tmp/validate.tests"
fi

# ===========================================================================
# 5. COVERAGE GATE (100% threshold — slow; skippable)
# ===========================================================================
if [[ $SKIP_COVERAGE -eq 0 ]]; then
  phase "Phase 5: Coverage gate (100% threshold)"
  if npm_run test:coverage >/tmp/validate.coverage 2>&1; then
    result PASS "Coverage"
  else
    result FAIL "Coverage" "threshold not met — see /tmp/validate.coverage"
  fi
else
  phase "Phase 5: Coverage gate (100% threshold)"
  result WARN "Coverage" "skipped via --no-coverage"
fi

# ===========================================================================
# 6. BUILD (tsc emit to dist/)
# ===========================================================================
phase "Phase 6: Build (tsc -p tsconfig.build.json)"
if npm_run build >/tmp/validate.build 2>&1; then
  [[ -x dist/index.js ]] && chmod +x dist/index.js 2>/dev/null || true
  result PASS "Build" "dist/index.js emitted"
else
  result FAIL "Build" "see /tmp/validate.build"
fi
fi  # end not smoke-only

# ===========================================================================
# 7. DOCS CONSISTENCY
# ===========================================================================
if [[ "${goto_smoke:-0}" -ne 1 ]]; then
phase "Phase 7: Docs consistency (scripts/check-docs.ts)"
if npm_run docs:check >/tmp/validate.docs 2>&1; then
  result PASS "Docs consistency"
else
  broken=$(grep -E 'broken internal link' /tmp/validate.docs | tail -1)
  result FAIL "Docs consistency" "${broken:-see /tmp/validate.docs}"
fi

# ===========================================================================
# 8. GROUNDSWELL LINK VALIDATION (hits npm registry)
# ===========================================================================
phase "Phase 8: Groundswell validation"
if npm_run validate:groundswell >/tmp/validate.groundswell 2>&1; then
  result PASS "Groundswell validation"
else
  result WARN "Groundswell validation" "needs network/registry — see /tmp/validate.groundswell"
fi
fi  # end not smoke-only

# ===========================================================================
# 9. PRD §9.6 LOGGING ACCEPTANCE CRITERIA (mechanical rg checks)
# ===========================================================================
if [[ "${goto_smoke:-0}" -ne 1 ]]; then
phase "Phase 9: PRD §9.6 logging architecture (lazy loggers, sync destinations)"
if ! assert_cmd rg; then
  result WARN "§9.6 logging" "ripgrep (rg) not installed — skipped"
else
  ms_loggers=$(rg -c '^(export )?(const|let) [A-Za-z_]+ = getLogger\(' src/ 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')
  transports=$(rg -c 'transport:\s*\{' src/ 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')
  detail="module-scope loggers=${ms_loggers} (want 0); transport: configs=${transports} (want 0)"
  if [[ "$ms_loggers" -eq 0 && "$transports" -eq 0 ]]; then
    result PASS "§9.6 logging" "$detail"
  else
    result FAIL "§9.6 logging" "$detail"
  fi
fi
fi  # end not smoke-only

# ===========================================================================
# 10. CLI SMOKE TESTS (credential-free / read-only — never runs the pipeline)
# ===========================================================================
phase "Phase 10: CLI smoke tests (safe, read-only)"

# Prefer the freshly-built binary; fall back to tsx on source.
if [[ -x dist/index.js ]]; then
  HACK=(node dist/index.js)
elif assert_cmd npx; then
  HACK=(npx tsx src/index.ts)
else
  HACK=(node dist/index.js)
fi

smoke() { # smoke <label> <expect-exit> <pattern> -- <args...>
  local label="$1" expect_exit="$2" pattern="$3"; shift 3; shift  # drop '--'
  local out ec
  out=$("${HACK[@]}" "$@" 2>&1); ec=$?
  if [[ "$ec" -eq "$expect_exit" ]] && { [[ -z "$pattern" ]] || grep -qE "$pattern" <<<"$out"; }; then
    result PASS "smoke: $label"
  else
    result FAIL "smoke: $label" "exit=$ec (want $expect_exit); last line: $(printf '%s' "$out" | tr -d '\033' | sed -E 's/\[[0-9;]*m//g' | grep -vE '^\s*$' | tail -1)"
  fi
}

smoke "--version → 0"        0 '0\.1\.0' -- --version
smoke "--help → 0"           0 'Usage:' -- --help
smoke "unknown flag → 1"     1 'unknown option' -- --definitely-not-a-flag
smoke "missing PRD → 1"      1 'PRD file not found' -- --prd ./__nope__.md --dry-run
smoke "bad scope → 1"        1 'Invalid scope' -- --prd ./PRD.md --scope p1.m1 --dry-run
smoke "bad --mode → 1"       1 "argument 'bogus' is invalid" -- --prd ./PRD.md --mode bogus --dry-run
smoke "--dry-run → 0"        0 'DRY RUN' -- --prd ./PRD.md --dry-run
smoke "--validate-prd → 0"   0 'VALID' -- --prd ./PRD.md --validate-prd
smoke "--adopt-prd no-PRD → 1" 1 'not found' -- --prd ./__nope__.md --adopt-prd --dry-run

# Read-only query subcommands (only if a plan/ session exists — otherwise WARN).
phase "Phase 10b: Read-only query subcommands (inspect / validate-state / task / status)"
if find plan -maxdepth 2 -name tasks.json -print -quit 2>/dev/null | grep -q .; then
  smoke "inspect → 0"        0 'Inspector|Session' -- inspect
  smoke "validate-state → 0" 0 'Valid' -- validate-state
  smoke "task list → 0"      0 '(P[0-9]|No tasks)' -- task
  smoke "status alias → 0"   0 '(P[0-9]|No tasks)' -- status
  smoke "task status → 0"    0 'summary|status' -- task status
  smoke "task next -o json → 0" 0 '' -- task next -o json
else
  result WARN "query subcommands" "no plan/ session present — skipped"
fi

# ===========================================================================
# SUMMARY
# ===========================================================================
printf '\n%s======================================================%s\n' "$BOLD" "$RESET"
printf '%sVALIDATION SUMMARY%s\n' "$BOLD" "$RESET"
printf '%s======================================================%s\n' "$BOLD" "$RESET"
printf '  PASS: %s%d%s    WARN: %s%d%s    FAIL: %s%d%s\n' \
  "$GREEN" "$PASS_COUNT" "$RESET" \
  "$YELLOW" "$WARN_COUNT" "$RESET" \
  "$RED" "$FAIL_COUNT" "$RESET"
if [[ ${#FAILED_PHASES[@]} -gt 0 ]]; then
  printf '\n%sFailed phases:%s\n' "$RED" "$RESET"
  for p in "${FAILED_PHASES[@]}"; do printf '  ✗ %s\n' "$p"; done
fi
printf '\n'
if [[ $FAIL_COUNT -gt 0 ]]; then
  printf '%s❌ VALIDATION FAILED (%d phase(s)).%s\n' "$RED" "$FAIL_COUNT" "$RESET"
  exit 1
fi
printf '%s✅ All validation phases passed.%s\n' "$GREEN" "$RESET"
exit 0