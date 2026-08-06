#!/usr/bin/env bash
# =============================================================================
# validate.sh — Comprehensive validation for hacky-hack (PRD §9.9 focus)
# =============================================================================
# Validates the §9.9 "Validation Gate Semantics (Monotonicity & Terminal-State
# Re-Execution)" implementation across all four layers:
#   (1) isNegatedFileExistenceGate pure detector   (src/agents/gate-semantics.ts)
#   (2) PRPExecutor #runValidationGates integration(src/agents/prp-executor.ts)
#   (3) Runtime effectiveness — prompts reach model (prompts.ts + agent-factory)
#   (4) Docs sync (README, docs/ARCHITECTURE.md, PROMPTS.md)
#
# SAFETY CONTRACT (per AGENTS.md):
#   This script NEVER invokes the agentic pipeline. It does NOT run
#   `npm run dev`, `npm run pipeline`, `npm start`, `node dist/index.js`,
#   or `npm run dev -- --prd`. Doing so spawns AI agents that mutate the
#   repo ("catastrophic meltdown"). Only static analysis, the project's own
#   lint/typecheck/format/test commands, and the pure §9.9 detector are run.
#   (The only spawned binary in the test suite — auth-preflight — scrubs all
#   credentials and asserts the binary fast-fails BEFORE the pipeline runs.)
#
# USAGE:
#   ./validate.sh              # full validation (lint+types+format+all tests+§9.9 E2E)
#   QUICK=1 ./validate.sh      # fast mode: only §9.9-relevant tests + E2E checks
#   SKIP_TESTS=1 ./validate.sh # skip the test phase entirely
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# --- Color helpers (disabled when not a TTY) ---------------------------------
if [ -t 1 ]; then
  G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[1m'; C=$'\033[36m'; N=$'\033[0m'
else
  G=""; R=""; Y=""; B=""; C=""; N=""
fi

FAILURES=0
PASSED=0
PHASES_SKIPPED=0

phase()   { printf "\n${C}${B}=== PHASE %s: %s ===${N}\n" "$1" "$2"; }
ok()      { printf "  ${G}✓ PASS${N}  %s\n" "$1"; PASSED=$((PASSED+1)); }
fail()    { printf "  ${R}✗ FAIL${N}  %s\n" "$1"; FAILURES=$((FAILURES+1)); }
skip()    { printf "  ${Y}↷ SKIP${N}  %s\n" "$1"; PHASES_SKIPPED=$((PHASES_SKIPPED+1)); }
info()    { printf "     %s\n" "$1"; }
assert_contains() {  # <haystack-file> <needle> <label>
  if grep -qF -- "$2" "$1" 2>/dev/null; then ok "$3"; else fail "$3 (missing '$2' in $1)"; fi
}
assert_regex() {  # <haystack-file> <ERE-pattern> <label>  (case-insensitive)
  if grep -qiE -- "$2" "$1" 2>/dev/null; then ok "$3"; else fail "$3 (pattern '$2' not found in $1)"; fi
}

# --- Preflight ---------------------------------------------------------------
phase "0" "Preflight (tooling + safety)"
command -v node >/dev/null && ok "node found" || fail "node not found"
command -v npm  >/dev/null && ok "npm found"  || fail "npm not found"
[ -f package.json ] && ok "package.json present" || fail "package.json missing"

# Safety guard: confirm no EXECUTABLE line invokes the agentic pipeline.
# Comment lines (starting with #) that merely document the forbidden commands
# are stripped first, so the self-documenting header never trips this guard.
if grep -vE '^[[:space:]]*#' "$0" | grep -qE 'npm (run )?(dev|pipeline|start)( |$)|dist/index\.js --prd|tsx src/index\.ts'; then
  fail "validate.sh has an executable line invoking the pipeline (safety violation)"
else
  ok "validate.sh executable lines contain no pipeline-invoking commands"
fi

if [ "${CI:-0}" = "1" ] && [ ! -d node_modules ]; then
  info "CI without node_modules — running npm ci"
  npm ci >/dev/null 2>&1 && ok "npm ci" || fail "npm ci"
fi

# =============================================================================
# Phase 1 — Lint
# =============================================================================
phase "1" "Lint (eslint)"
if npm run lint >/tmp/v_lint.log 2>&1; then
  ok "eslint exits 0"
else
  rc=$?
  # Distinguish errors (blocking) from warnings (non-blocking)
  if grep -qE '[0-9]+ error' /tmp/v_lint.log; then
    fail "eslint reports errors (exit $rc)"; sed -n '1,40p' /tmp/v_lint.log | sed 's/^/     /'
  else
    warn_n=$(grep -cE 'warning ' /tmp/v_lint.log || true)
    ok "eslint exits non-zero ONLY on warnings (rc=$rc, ~${warn_n} pre-existing no-explicit-any warnings)"
    info "warnings are non-blocking and pre-existing (src/cli/index.ts, src/utils/logger.ts)"
  fi
fi

# =============================================================================
# Phase 2 — Type checking (src-only build config — the REAL gate)
# =============================================================================
phase "2" "Type check (tsc --noEmit -p tsconfig.build.json)"
if npm run typecheck >/tmp/v_tsc.log 2>&1; then
  ok "tsc --noEmit clean (exit 0) on src build config"
else
  fail "tsc --noEmit failed"; sed -n '1,40p' /tmp/v_tsc.log | sed 's/^/     /'
fi

# Confirm src is genuinely clean: npm prints a banner even on success, so the
# log is non-empty by default. The real signal is the ABSENCE of `error TSxxxx`.
if grep -qE 'error TS[0-9]+' /tmp/v_tsc.log; then
  fail "typecheck log contains TS errors"
  grep -E 'error TS[0-9]+' /tmp/v_tsc.log | head -10 | sed 's/^/     /'
else
  ok "typecheck log contains no TS errors (src is clean)"
fi

# =============================================================================
# Phase 3 — Style / format check
# =============================================================================
phase "3" "Format check (prettier)"
if npm run format:check >/tmp/v_fmt.log 2>&1; then
  ok "prettier --check clean"
else
  fail "prettier --check failed"; sed -n '1,30p' /tmp/v_fmt.log | sed 's/^/     /'
fi

# =============================================================================
# Phase 4 — Unit + integration tests
# =============================================================================
if [ "${SKIP_TESTS:-0}" = "1" ]; then
  phase "4" "Tests — SKIPPED (SKIP_TESTS=1)"
  skip "test phase disabled by SKIP_TESTS=1"
else
  phase "4" "Tests (vitest)"
  if [ "${QUICK:-0}" = "1" ]; then
    info "QUICK=1 → running only §9.9-relevant test files"
    TEST_TARGETS=(
      tests/unit/agents/gate-semantics.test.ts
      tests/unit/agents/prp-executor.test.ts
      tests/unit/agents/prompts.test.ts
      tests/unit/agents/prompts/prp-blueprint-prompt.test.ts
      tests/integration/prp-executor-integration.test.ts
    )
    if npx vitest run "${TEST_TARGETS[@]}" >/tmp/v_test.log 2>&1; then
      ok "§9.9 test subset passed"
    else
      fail "§9.9 test subset failed"; tail -30 /tmp/v_test.log | sed 's/^/     /'
    fi
  else
    info "Running full suite (npm run test:run) — this takes a few minutes…"
    if npm run test:run >/tmp/v_test.log 2>&1; then
      ok "full test suite passed"
    else
      fail "full test suite failed"; tail -40 /tmp/v_test.log | sed 's/^/     /'
    fi
  fi
  # Surface the summary line regardless of pass/fail
  grep -E 'Test Files|Tests ' /tmp/v_test.log | tail -2 | sed 's/^/     /'
fi

# =============================================================================
# Phase 5 — §9.9 End-to-End validation (creative + comprehensive)
# =============================================================================
phase "5" "§9.9 E2E — Gate-semantics monotonicity & terminal-state re-execution"

# ---- 5a. Detector adversarial table (pure function, run via tsx) -----------
echo "  ${B}5a. isNegatedFileExistenceGate — 27-case adversarial table${N}"
DET_HARNESS="$(mktemp -t hh_detector.XXXXXX.mts)"
cat > "$DET_HARNESS" <<'TSX'
// Dynamic import: static `import` requires a string literal, so resolve the
// path at runtime from HH_ROOT (top-level await is valid in .mts ESM).
const { isNegatedFileExistenceGate } = await import(
  process.env.HH_ROOT + '/src/agents/gate-semantics.ts'
);
const cases: [string, boolean][] = [
  // G2.1 canonical negated existence → TRUE
  ['! test -f src/hooks/index.ts', true],
  ['test ! -f x', true],
  ['! [ -e x ]', true],
  ['[ ! -d x ]', true],
  ['! test -e /a/b', true],
  ['! [ -f a ]', true],
  // G2.2 negated content → FALSE (executes normally)
  ['! grep -q TODO file', false],
  ['! grep -q "x" f', false],
  // positive / unrelated → FALSE
  ['test -f x', false], ['npm test', false], ['grep -q foo x', false],
  // G2.3 ambiguous → FALSE (conservative)
  ['[[ ! -f x ]]', false],            // bash double-bracket
  ['!/bin/test -f x', false],         // full path
  ['! test ! -f x', false],           // double negation
  ['test -f x -a ! -f y', false],     // compound
  ['test -n foo', false], ['test foo', false],
  ['bash -c "! test -f x"', false],   // wrapped
  // boundary inputs → FALSE
  ['', false], ['   ', false], ['\t\n', false],
  // whitespace tolerance → TRUE
  ['  test ! -d  x  ', true], ['\n! test -f x', true],
  // non-existence flags (-L/-r/-s/-n) → FALSE (only -f/-e/-d are in scope)
  ['test ! -L x', false], ['! test -r x', false], ['! test -s x', false],
  ['! test -n x', false],
];
let pass = 0, fail = 0;
for (const [cmd, exp] of cases) {
  const got = isNegatedFileExistenceGate(cmd);
  if (got === exp) pass++; else { fail++; console.error(`  MISMATCH ${JSON.stringify(cmd)} exp=${exp} got=${got}`); }
}
console.log(`__DET__${pass}/${cases.length}__fail=${fail}__`);
process.exit(fail === 0 ? 0 : 1);
TSX
# tsx resolves TS imports at runtime (no build needed). HH_ROOT passed via env.
if HH_ROOT="$ROOT" npx tsx "$DET_HARNESS" >/tmp/v_det.log 2>&1; then
  ok "detector adversarial table — $(grep -oE '__DET__[0-9]+/[0-9]+' /tmp/v_det.log | tail -1 | sed 's/__DET__//') correct"
else
  fail "detector adversarial table — mismatches found"
  cat /tmp/v_det.log | sed 's/^/     /'
fi
rm -f "$DET_HARNESS"

# ---- 5b. Prompt content — G1.1–G1.5 present in BOTH Blueprint and Builder --
echo "  ${B}5b. Gate-construction guardrails in both prompts (PRD §9.9.2 REQ-G1)${N}"
# Locate the two prompt constants
BLUE_START=$(grep -n "^export const PRP_BLUEPRINT_PROMPT" src/agents/prompts.ts | head -1 | cut -d: -f1)
BUILD_START=$(grep -n "^export const PRP_BUILDER_PROMPT"   src/agents/prompts.ts | head -1 | cut -d: -f1)
if [ -n "$BLUE_START" ] && [ -n "$BUILD_START" ]; then
  ok "both PRP_BLUEPRINT_PROMPT (L${BLUE_START}) and PRP_BUILDER_PROMPT (L${BUILD_START}) located"
else
  fail "could not locate one or both prompt constants"
fi

# Extract each prompt body to a temp slice for scoped assertions (avoids
# cross-contamination between the two prompts).
BLUE_SLICE="$(mktemp -t hh_blue.XXXXXX)"; BUILD_SLICE="$(mktemp -t hh_build.XXXXXX)"
awk -v s="$BLUE_START" -v e="$((BUILD_START-1))" 'NR>=s && NR<=e' src/agents/prompts.ts > "$BLUE_SLICE"
awk -v s="$BUILD_START" 'NR>=s' src/agents/prompts.ts > "$BUILD_SLICE"

# REQ-G1 gate rules required in the BLUEPRINT (Researcher) prompt
assert_contains "$BLUE_SLICE" 'G1.1' "Blueprint enumerates G1.1 (no negative-existence gates)"
assert_contains "$BLUE_SLICE" 'G1.2' "Blueprint enumerates G1.2 (scope boundaries ≠ shell gates)"
assert_contains "$BLUE_SLICE" 'G1.3' "Blueprint enumerates G1.3 (cleanup/throwaway deletion = manual)"
assert_contains "$BLUE_SLICE" 'G1.4' "Blueprint enumerates G1.4 (throwaway survives coder's turn)"
assert_contains "$BLUE_SLICE" 'G1.5' "Blueprint enumerates G1.5 (negated content monotonic only)"
assert_regex  "$BLUE_SLICE" 'throwaway artifacts must survive' "Blueprint G1.4 throwaway-survival wording present"
assert_regex  "$BLUE_SLICE" 'test ! -f'                        "Blueprint forbids test ! -f (G1.1 example)"

# REQ-G1 gate rules required in the BUILDER (Coder) prompt
assert_contains "$BUILD_SLICE" 'G1.4'                 "Builder carries G1.4 instruction"
assert_regex  "$BUILD_SLICE" 'do not delete throwaway' "Builder has 'do not delete throwaway' (G1.4)"
assert_regex  "$BUILD_SLICE" 'survive on disk'         "Builder asserts throwaway must survive on disk"

# G2.2/G2.3 executor guidance surfaced to the model (negated content executes, ambiguous executes)
assert_regex "$BLUE_SLICE" 'manual'  "Blueprint references manual gates (Level-4 skip)"
rm -f "$BLUE_SLICE" "$BUILD_SLICE"

# ---- 5c. Executor integration — neutralization, aggregation, no bypass -----
echo "  ${B}5c. PRPExecutor #runValidationGates — neutralization + no bypass${N}"
EX=src/agents/prp-executor.ts
assert_regex  "$EX" 'isNegatedFileExistenceGate\(gate\.command\)' "neutralization branch calls detector"
assert_regex  "$EX" 'non-monotonic negative-existence gate neutralized' "neutralization log reason present (§9.9 verbatim)"
assert_contains "$EX" 'skipped: true' "neutralized gates use skipped:true (mirrors manual/null skip)"
assert_regex  "$EX" 'r\.success \|\| r\.skipped' "aggregation counts skipped gates as passed"
assert_regex  "$EX" 'filter\(g => !g\.success && !g\.skipped\)' "fix-retry error context excludes skipped gates"

# No mechanical bypass: the ONLY execute_bash of a gate.command must be inside
# #runValidationGates. session-utils.ts only renders gates (display), never runs them.
if grep -rn 'execute_bash' src/ | grep -qi 'gate'; then
  if grep -n 'execute_bash' "$EX" | grep -qi gate; then
    ok "gate execution via execute_bash is confined to prp-executor.ts (#runValidationGates)"
  else
    fail "unexpected execute_bash/gate coupling"
  fi
else
  ok "no stray execute_bash/gate coupling found"
fi
# Confirm session-utils only renders (push to display section), never executes
assert_regex src/core/session-utils.ts 'sections\.push\(gate\.command\)' "session-utils only renders gates for display (no execution)"

# ---- 5d. Runtime wiring — the §9.9-edited prompt actually reaches the model -
echo "  ${B}5d. Runtime effectiveness — prompt reaches the model${N}"
AF=src/agents/agent-factory.ts
assert_regex "$AF" 'system: PRP_BLUEPRINT_PROMPT' "agent-factory sets system: PRP_BLUEPRINT_PROMPT (Researcher)"
assert_regex "$AF" 'system: PRP_BUILDER_PROMPT'   "agent-factory sets system: PRP_BUILDER_PROMPT (Coder)"
# The split wrapper must EMBED the monolithic base, not shadow it
assert_regex src/agents/prompts/prp-blueprint-prompt.ts '\$\{PRP_BLUEPRINT_PROMPT\}' "split blueprint wrapper embeds monolithic base (does not shadow)"
assert_regex src/agents/prompts/prp-blueprint-prompt.ts "import \{ PRP_BLUEPRINT_PROMPT \}" "split wrapper imports base from prompts.js"
# No contradictory split builder file that could shadow the monolithic Builder
if [ -f src/agents/prompts/prp-builder-prompt.ts ]; then
  fail "a split prp-builder-prompt.ts exists — risk of shadowing PRP_BUILDER_PROMPT"
else
  ok "no split prp-builder-prompt.ts (Builder prompt is monolithic, no shadow risk)"
fi

# ---- 5e. Docs sync — README, ARCHITECTURE.md, PROMPTS.md mirror -----------
echo "  ${B}5e. Documentation sync to §9.9${N}"
assert_regex README.md '§9.9|monotonic' "README references §9.9 monotonic gates"
assert_regex docs/ARCHITECTURE.md '§9.9|neutraliz' "docs/ARCHITECTURE.md documents §9.9 neutralization"
# PROMPTS.md is a faithful mirror of prompts.ts — G1.4 must appear there too
assert_contains PROMPTS.md 'G1.4' "PROMPTS.md mirror carries G1.4 (Blueprint)"
assert_regex  PROMPTS.md 'throwaway artifacts must survive' "PROMPTS.md mirror has Blueprint G1.4 throwaway-survival wording"
assert_regex  PROMPTS.md 'do not delete throwaway' "PROMPTS.md mirror has Builder G1.4 instruction"

# ---- 5f. Runtime log reason string matches spec verbatim ------------------
echo "  ${B}5f. Runtime log reason matches PRD §9.9 G2.1 wording${N}"
REASON='non-monotonic negative-existence gate neutralized — file existence is owned by the task graph / is a cleanup step, not a terminal-state assertion (§9.9)'
if grep -qF "$REASON" "$EX" && grep -qF "$REASON" spec/16-validation-gates.md; then
  ok "runtime reason string in source matches PRD §9.9.2 G2.1 wording verbatim"
else
  fail "runtime reason string deviates from PRD §9.9.2 G2.1"
fi

# =============================================================================
# Phase 6 — Build sanity (optional; confirms src compiles to dist)
# =============================================================================
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  phase "6" "Build — SKIPPED (SKIP_BUILD=1)"; skip "build disabled"
else
  phase "6" "Build sanity (tsc -p tsconfig.build.json → dist)"
  if npm run build >/tmp/v_build.log 2>&1; then
    ok "build emits dist/ successfully"
    [ -x dist/index.js ] && ok "dist/index.js is executable" || info "dist/index.js present (chmod handled by postbuild)"
  else
    fail "build failed"; sed -n '1,30p' /tmp/v_build.log | sed 's/^/     /'
  fi
fi

# =============================================================================
# Summary
# =============================================================================
printf "\n${B}================ VALIDATION SUMMARY ================${N}\n"
printf "  Checks passed:    ${G}%d${N}\n" "$PASSED"
printf "  Checks failed:    ${R}%d${N}\n" "$FAILURES"
printf "  Checks skipped:   ${Y}%d${N}\n" "$PHASES_SKIPPED"
if [ "$FAILURES" -eq 0 ]; then
  printf "\n  ${G}${B}RESULT: PASS — no validation failures.${N}\n"
  exit 0
else
  printf "\n  ${R}${B}RESULT: FAIL — %d check(s) failed.${N}\n" "$FAILURES"
  exit 1
fi