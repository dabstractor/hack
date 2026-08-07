#!/usr/bin/env bash
# =============================================================================
# validate.sh — Comprehensive validation for hacky-hack (PRP Pipeline)
# =============================================================================
# Runs the project's REAL tooling (lint, typecheck, format, tests, docs) plus an
# end-to-end CLI-workflow suite that drives the actual `hack` binary through the
# user journeys documented in README.md / docs/.
#
# DESIGN CONSTRAINTS (from AGENTS.md):
#   * This is a VALIDATION agent script. It tests and reports; it never runs the
#     real pipeline, never creates plan/ sessions, and never invokes an LLM agent.
#   * Every E2E command is either read-only (status/task/inspect/config/cache/
#     validate-state), credential-free (--dry-run/--validate-prd), or pointed at a
#     THROWAWAY file under a temp dir (hack update -f <tmp>).
#   * No file under plan/, PRD.md, **/tasks.json, or .gitignore is ever modified.
#
# USAGE:
#   ./validate.sh                # run all phases (default)
#   ./validate.sh quality        # lint + typecheck + format + tests only
#   ./validate.sh e2e            # CLI workflow suite only
#   ./validate.sh docs           # docs:check only
#
# EXIT CODE: 0 only if every phase passes. Non-zero means at least one check
# failed (see the per-phase FAIL markers and the final summary).
# =============================================================================
set -uo pipefail

# ── Repo bootstrap ───────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || { echo "FATAL: cannot cd to $SCRIPT_DIR"; exit 2; }

# Colours (disabled when not a TTY)
if [ -t 1 ]; then
  C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_GREEN=''; C_RED=''; C_YELLOW=''; C_BLUE=''; C_BOLD=''; C_RESET=''
fi

PASS=0; FAIL=0; WARN=0
FAILED_PHASES=()

log()  { printf '%s\n' "$*"; }
info() { printf '%s[%sINFO%s]%s %s\n' "$C_BOLD" "$C_BLUE" "$C_RESET" '' "$*"; }
ok()   { printf '%s[%sPASS%s] %s\n' "$C_BOLD" "$C_GREEN" "$C_RESET" "$*"; PASS=$((PASS+1)); }
bad()  { printf '%s[%sFAIL%s] %s\n' "$C_BOLD" "$C_RED" "$C_RESET" "$*"; FAIL=$((FAIL+1)); FAILED_PHASES+=("$*"); }
warn() { printf '%s[%sWARN%s] %s\n' "$C_BOLD" "$C_YELLOW" "$C_RESET" "$*"; WARN=$((WARN+1)); }
hr()   { printf '%s── %s ──%s\n' "$C_BLUE" "$*" "$C_RESET"; }

# Choose the hack runner. Prefer the production dist build (fast, matches the
# shipped `hack` binary); fall back to tsx (dev). Verify it can print --version.
if [ -x dist/index.js ] && dist/index.js --version >/dev/null 2>&1; then
  HACK=(node dist/index.js)
elif [ -x node_modules/.bin/tsx ]; then
  HACK=(npx tsx src/index.ts)
elif command -v tsx >/dev/null 2>&1; then
  HACK=(tsx src/index.ts)
else
  echo "FATAL: no usable hack runner (need dist/index.js or tsx). Run 'npm run build' or 'npm install'."; exit 2
fi

# Run a hack subcommand quietly, capturing combined output + exit code.
# Usage: run_hack <args...>  → prints "EXIT:<code>" last; output filtered.
run_hack() {
  local out rc
  out=$("${HACK[@]}" "$@" 2>&1)
  rc=$?
  printf '%s\n' "$out"
  printf 'EXIT:%s\n' "$rc"
}

# ── Argument parsing ─────────────────────────────────────────────────────────
PHASE="${1:-all}"
run_quality=false; run_e2e=false; run_docs=false
case "$PHASE" in
  all)      run_quality=true; run_e2e=true; run_docs=true ;;
  quality)  run_quality=true ;;
  e2e)      run_e2e=true ;;
  docs)     run_docs=true ;;
  -h|--help|help)
    sed -n '2,30p' "$0"; exit 0 ;;
  *) echo "Unknown phase: $PHASE (try: all, quality, e2e, docs)"; exit 2 ;;
esac

info "Validating hacky-hack from $SCRIPT_DIR"
info "Hack runner: ${HACK[*]}"
hr "PRELUDE: environment sanity"

node --version >/dev/null 2>&1 && ok "node $(node --version)" || { bad "node not found"; exit 2; }
npm --version >/dev/null 2>&1 && ok "npm $(npm --version)" || warn "npm not on PATH (some checks may skip)"
command -v git >/dev/null 2>&1 && ok "git $(git --version)" || warn "git not found (repo-root checks will behave oddly)"

# =============================================================================
# PHASE 1–4: QUALITY GATES (lint, typecheck, format, tests)
# =============================================================================
if $run_quality; then
hr "PHASE 1: Linting (eslint . --ext .ts)"
if npx eslint . --ext .ts > /tmp/hh-lint.out 2>&1; then
  ok "eslint: 0 errors"
else
  rc=$?
  # Distinguish errors (non-zero, real problems) from the rare tool failure.
  errs=$(grep -E '✖ [0-9]+ problems \([0-9]+ error' /tmp/hh-lint.out | grep -oE '[0-9]+ error' | head -1)
  if [ -n "$errs" ]; then bad "eslint: $errs"; else warn "eslint exited $rc but no error count parsed"; fi
  tail -25 /tmp/hh-lint.out
fi
warns=$(grep -E '✖ [0-9]+ problems' /tmp/hh-lint.out | grep -oE '[0-9]+ warning' | head -1 || true)
[ -n "$warns" ] && info "  eslint warnings (non-blocking): $warns"

hr "PHASE 2: Type checking (tsc --noEmit -p tsconfig.build.json)"
if npx tsc --noEmit -p tsconfig.build.json > /tmp/hh-tsc.out 2>&1; then
  ok "typecheck: 0 errors"
else
  bad "typecheck: tsc reported errors"
  tail -30 /tmp/hh-tsc.out
fi

hr "PHASE 3: Style/format check (prettier --check)"
if npx prettier --check "**/*.{ts,js,json,md,yml,yaml}" > /tmp/hh-prettier.out 2>&1; then
  ok "prettier: all files conform"
else
  bad "prettier: formatting drift detected"
  grep -E '\[warn\]' /tmp/hh-prettier.out | head -20
fi

hr "PHASE 4: Unit & integration tests (vitest run)"
if npx vitest run > /tmp/hh-vitest.out 2>&1; then
  ok "vitest: suite passed"
  # Surface the pass/skip tally for visibility.
  grep -E 'Test Files|Tests ' /tmp/hh-vitest.out | tail -2 | sed 's/^/    /'
else
  bad "vitest: suite failed"
  tail -40 /tmp/hh-vitest.out
fi
fi

# =============================================================================
# PHASE 5a: DOCUMENTATION INTEGRITY
# =============================================================================
if $run_docs; then
hr "PHASE 5a: Documentation links (scripts/check-docs.ts — npm run docs:check)"
# NOTE: this gate is NOT part of `npm run validate`; run it explicitly because it
# catches the PRD.md → spec/SPEC.md documentation drift (see validation_report).
if npx tsx scripts/check-docs.ts > /tmp/hh-docs.out 2>&1; then
  ok "docs:check: internal links valid"
else
  bad "docs:check: broken internal links"
  grep -A2 -E 'broken internal link|→' /tmp/hh-docs.out | head -20
fi

hr "PHASE 5b: Distributed-PRD entry exists (spec/SPEC.md per .hack)"
# The committed .hack pins [cli] prd = "spec/SPEC.md". Verify that entry + the
# includes it pulls in all resolve (a missing include would break PRD hashing).
if [ -f spec/SPEC.md ]; then
  ok "spec/SPEC.md exists (distributed PRD entry)"
  # Each @include line must resolve to a real file (project-root-relative).
  missing=0
  while IFS= read -r inc; do
    # inc looks like "@01-executive-summary.md" (possibly with leading spaces)
    tgt="${inc##*@}"; tgt="${tgt%%[[:space:]]*}"
    if [ -n "$tgt" ] && [ ! -f "spec/$tgt" ]; then
      bad "PRD include unresolved: spec/$tgt"; missing=$((missing+1))
    fi
  done < <(grep -E '^[[:space:]]*@[^[:space:]]+\.md' spec/SPEC.md)
  [ "$missing" -eq 0 ] && ok "all @include directives in spec/SPEC.md resolve"
else
  bad "spec/SPEC.md missing — .hack [cli] prd points at a non-existent file"
fi
fi

# =============================================================================
# PHASE 5c: E2E CLI WORKFLOW SUITE (the documented user journeys)
# =============================================================================
if $run_e2e; then
hr "PHASE 5c: E2E CLI workflows (read-only / credential-free only)"

# --- Core bootstrapping (every code path) -------------------------------------
out=$("${HACK[@]}" --version 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "hack --version (exit 0, '$out')" || bad "hack --version exit $rc"

# §9.6.3 acceptance: --help must return in under 2s (target <1s).
t0=$(date +%s.%N); "${HACK[@]}" --help >/dev/null 2>&1; rc=$?; t1=$(date +%s.%N)
secs=$(awk "BEGIN{printf \"%.2f\", $t1-$t0}")
if [ "$rc" -eq 0 ]; then
  if awk "BEGIN{exit !($secs < 2.0)}"; then
    ok "hack --help fast teardown (${secs}s < 2s, §9.6.3)"
  else
    bad "hack --help SLOW teardown (${secs}s ≥ 2s, §9.6.3 violation — worker-thread transports?)"
  fi
else
  bad "hack --help exit $rc"
fi

# An invalid flag should exit non-zero, not hang.
"${HACK[@]}" --no-such-flag >/tmp/hh-badflag.out 2>&1; rc=$?
[ "$rc" -ne 0 ] && ok "hack --no-such-flag rejected (exit $rc)" || bad "hack --no-such-flag unexpectedly exit 0"

# --- Credential-free modes (must make ZERO api calls / create no sessions) ----
out=$("${HACK[@]}" --dry-run 2>&1); rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q "DRY RUN"; then
  ok "hack --dry-run (exit 0, credential-free)"
else
  bad "hack --dry-run exit $rc (expected 0 + 'DRY RUN')"
fi
# Dry run must resolve the .hack-pinned PRD (spec/SPEC.md), not ./PRD.md.
if echo "$out" | grep -q "spec/SPEC.md"; then ok "dry-run resolves .hack [cli] prd = spec/SPEC.md"; else bad "dry-run did not use spec/SPEC.md (.hack override ignored?)"; fi

out=$("${HACK[@]}" --validate-prd 2>&1); rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q "VALID"; then
  ok "hack --validate-prd (exit 0, distributed PRD resolves + validates)"
else
  bad "hack --validate-prd exit $rc"; echo "$out" | tail -15
fi

# --- README Quick Start: documented first command must work ------------------
# README §Quick Start says: npm run dev -- --prd ./PRD.md
# PRD.md no longer exists (project migrated to spec/SPEC.md). This documents the
# documentation drift; it is EXPECTED to fail and is flagged as a finding.
"${HACK[@]}" --prd ./PRD.md --dry-run >/tmp/hh-readme.out 2>&1; rc=$?
if [ "$rc" -eq 0 ]; then
  ok "README Quick Start example (hack --prd ./PRD.md) works"
else
  bad "README Quick Start example BROKEN: 'hack --prd ./PRD.md' exits $rc (PRD.md gone → spec/SPEC.md)"
  grep -i "not found" /tmp/hh-readme.out | head -1 | sed 's/^/      /'
fi

# --- Read-only subcommands against existing session state --------------------
for sub in status task; do
  out=$("${HACK[@]}" "$sub" 2>&1); rc=$?
  if [ "$rc" -eq 0 ]; then ok "hack $sub (exit 0, reads latest session)"; else bad "hack $sub exit $rc"; fi
done
out=$("${HACK[@]}" task next 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "hack task next (exit 0)" || bad "hack task next exit $rc"

# --- Config subcommand --------------------------------------------------------
out=$("${HACK[@]}" config show 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "hack config show (exit 0)" || bad "hack config show exit $rc"
out=$("${HACK[@]}" config validate 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "hack config validate (exit 0, .hack is well-formed)" || bad "hack config validate exit $rc: $out"
out=$("${HACK[@]}" config path 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "hack config path (exit 0)" || bad "hack config path exit $rc"

# --- Inspect / validate-state / cache (must NOT start the main pipeline) -----
# Regression guard for the subcommand-isolation bug (see update check below):
# every read-only subcommand must short-circuit, never logging
# "PRPPipeline ... Starting PRP Pipeline workflow".
for sub in inspect validate-state "cache stats"; do
  out=$("${HACK[@]}" $sub 2>&1); rc=$?
  if [ "$rc" -ne 0 ]; then bad "hack $sub exit $rc"; continue; fi
  if echo "$out" | grep -q "PRPPipeline.*Starting PRP Pipeline"; then
    bad "hack $sub leaked into main pipeline (subcommand isolation broken)"
  else
    ok "hack $sub isolated (no pipeline start)"
  fi
done

# --- CRITICAL REGRESSION: hack update must NOT start the main pipeline -------
# BUG: `update` is the ONLY subcommand missing from parseCLIArgs()'s fallthrough
# detection list, so invoking it ALSO constructs PRPPipeline and calls run()
# concurrently with the update handler. The update's process.exit usually wins
# the race, but the pipeline still reaches initializeSession() (which creates
# session dirs). This check drives a THROWAWAY tasks.json under a temp dir so
# no plan/ file is ever touched.
hr "REGRESSION: hack update subcommand isolation"
updir=$(mktemp -d -t hh-update-XXXXXX)
# Seed a minimal schema-valid backlog so the update RMW round-trips.
cat > "$updir/tasks.json" <<'JSON'
{"backlog":[{"id":"P1","type":"Phase","title":"P","status":"Complete","description":"d","milestones":[{"id":"P1.M1","type":"Milestone","title":"M","status":"Complete","description":"d","tasks":[{"id":"P1.M1.T1","type":"Task","title":"T","status":"Complete","description":"d","subtasks":[{"id":"P1.M1.T1.S1","type":"Subtask","title":"S","status":"Complete","story_points":1,"dependencies":[],"context_scope":"CONTRACT DEFINITION:\n1. RESEARCH NOTE: seed.\n2. INPUT: tmp.\n3. LOGIC: noop.\n4. OUTPUT: ack."}]}]}]}]}
JSON
out=$("${HACK[@]}" update P1.M1.T1.S1 plan -f "$updir/tasks.json" 2>&1); rc=$?
if echo "$out" | grep -q "Updated P1.M1.T1.S1 status to Planned"; then
  ok "hack update writes the status (RMW + cascade works)"
else
  warn "hack update did not report success (exit $rc) — see output"
fi
if echo "$out" | grep -q "PRPPipeline.*Starting PRP Pipeline"; then
  bad "REGRESSION CONFIRMED: hack update starts the main pipeline concurrently (missing from subcommand detection list)"
else
  ok "hack update isolated (no pipeline start)"
fi
rm -rf "$updir"

# --- Static confirmation of the root cause (definitive, no execution) ---------
# Every .command('X') in parseCLIArgs() must also appear in an
# `args[0] === 'X'` detection branch, else main() falls through to the default
# pipeline. `update` is the documented gap.
hr "STATIC CHECK: subcommand detection parity"
src=src/cli/index.ts
defined=$(grep -oE "\.command\('[a-z-]+'" "$src" | sed -E "s/\.command\('([a-z-]+)'/\1/" | sort -u)
detected=$(grep -oE "args\[0\] === '[a-z-]+'" "$src" | sed -E "s/.*=== '([a-z-]+)'/\1/" | sort -u)
gap=0
for c in $defined; do
  if ! echo "$detected" | grep -qxF "$c"; then
    # 'status' is an alias of 'task' and may share detection; flag genuinely-missing ones.
    bad "subcommand '$c' is defined but NOT in the detection fallthrough list"
    gap=$((gap+1))
  fi
done
[ "$gap" -eq 0 ] && ok "every defined subcommand is detected (no fallthrough gap)"

# --- Groundswell dependency health -------------------------------------------
hr "DEPENDENCY: groundswell link + dist"
if [ -f node_modules/groundswell/dist/index.js ]; then ok "node_modules/groundswell/dist exists"; else bad "groundswell dist missing (run the groundswell linker / npm link)"; fi
fi  # end run_e2e

# =============================================================================
# SUMMARY
# =============================================================================
hr "SUMMARY"
printf '%sChecks passed:%s    %s%d%s\n' "$C_BOLD" "$C_RESET" "$C_GREEN" "$PASS" "$C_RESET"
printf '%sChecks FAILED:%s    %s%d%s\n' "$C_BOLD" "$C_RESET" "$C_RED" "$FAIL" "$C_RESET"
printf '%sWarnings:%s          %s%d%s\n' "$C_BOLD" "$C_RESET" "$C_YELLOW" "$WARN" "$C_RESET"
if [ "$FAIL" -gt 0 ]; then
  printf '\n%sFailed checks:%s\n' "$C_BOLD" "$C_RESET"
  for f in "${FAILED_PHASES[@]}"; do printf '  %s•%s %s\n' "$C_RED" "$C_RESET" "$f"; done
  printf '\n%sOverall: FAIL%s — see validation_report.md for analysis.\n' "$C_RED" "$C_RESET"
  exit 1
fi
printf '\n%sOverall: PASS%s\n' "$C_GREEN" "$C_RESET"
exit 0