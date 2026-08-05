#!/usr/bin/env bash
# =============================================================================
# validate.sh — Comprehensive validation for the hacky-hack PRP Pipeline
# =============================================================================
# Runs the project's own toolchain (lint, typecheck, format, build, tests) and a
# battery of end-to-end CLI scenarios that exercise the features implemented in
# the current delta (PRD §9.8 repo-root resolution, §9.7 .hack config, §5.3
# breakdown-in-progress). E2E scenarios use ONLY safe subcommands (--help,
# --version, config, status, task, --dry-run) that never invoke agents or the
# LLM API — the pipeline itself is NEVER executed.
#
# The script COLLECTS failures across all phases and reports a summary at the
# end. Exit code is non-zero if any phase or scenario fails.
#
# Usage:   ./validate.sh [--skip-tests]
# =============================================================================
set -uo pipefail

# ---- configuration ----------------------------------------------------------
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

SKIP_TESTS=0
[[ "${1:-}" == "--skip-tests" ]] && SKIP_TESTS=1

# Colors
if [[ -t 1 ]]; then
  _G=$'\033[32m'; _R=$'\033[31m'; _Y=$'\033[33m'; _C=$'\033[36m'; _B=$'\033[1m'; _N=$'\033[0m'
else
  _G=''; _R=''; _Y=''; _C=''; _B=''; _N=''
fi

# ---- failure collection -----------------------------------------------------
FAILS=()
PASSES=()
fail()   { FAILS+=("$1"); echo "  ${_R}✗ FAIL${_N}: $1"; }
pass()   { PASSES+=("$1"); echo "  ${_G}✓ pass${_N}: $1"; }
note()   { echo "  ${_C}•${_N} $1"; }

section() { echo; echo "${_B}══ $1 ══${_N}"; }

# Determine the CLI entrypoint. Prefer a freshly built dist/index.js (fast,
# current), falling back to tsx on src/index.ts.
BIN=""
if [[ -x "$ROOT_DIR/dist/index.js" ]]; then
  BIN="$ROOT_DIR/dist/index.js"
elif command -v npx >/dev/null 2>&1 && [[ -f "$ROOT_DIR/src/index.ts" ]]; then
  BIN="npx tsx $ROOT_DIR/src/index.ts"
else
  BIN="node $ROOT_DIR/dist/index.js"
fi
run_cli() { $BIN "$@"; }

# =============================================================================
# PHASE 1: LINT
# =============================================================================
section "Phase 1: Lint (eslint)"
if npm run lint >/tmp/vlint.log 2>&1; then
  # lint exits 0 on warnings; report them but treat as pass
  if grep -q "warning" /tmp/vlint.log; then
    note "lint passed with $(grep -c 'warning' /tmp/vlint.log) warning(s) (no errors)"
  fi
  pass "eslint (0 errors)"
else
  fail "eslint reported errors (see /tmp/vlint.log)"
  tail -20 /tmp/vlint.log | sed 's/^/      /'
fi

# =============================================================================
# PHASE 2: TYPE CHECKING
# =============================================================================
section "Phase 2: Type checking (tsc --noEmit)"
if npm run typecheck >/tmp/vtc.log 2>&1; then
  pass "tsc --noEmit (strict)"
else
  fail "tsc reported type errors (see /tmp/vtc.log)"
  tail -20 /tmp/vtc.log | sed 's/^/      /'
fi

# =============================================================================
# PHASE 3: STYLE / FORMATTING CHECK
# =============================================================================
section "Phase 3: Style check (prettier)"
if npm run format:check >/tmp/vfmt.log 2>&1; then
  pass "prettier --check"
else
  fail "prettier found unformatted files (see /tmp/vfmt.log)"
  tail -20 /tmp/vfmt.log | sed 's/^/      /'
fi

# =============================================================================
# PHASE 4: BUILD
# =============================================================================
section "Phase 4: Build (tsc)"
if npm run build >/tmp/vbuild.log 2>&1; then
  pass "tsc -p tsconfig.build.json (+ postbuild chmod)"
  # Use the freshly built dist for E2E (authoritative vs stale dist)
  BIN="$ROOT_DIR/dist/index.js"
  run_cli() { "$BIN" "$@"; }
else
  fail "build failed (see /tmp/vbuild.log)"
  tail -20 /tmp/vbuild.log | sed 's/^/      /'
fi

# =============================================================================
# PHASE 5: UNIT + INTEGRATION TESTS (vitest)
# =============================================================================
section "Phase 5: Unit + integration tests (vitest run)"
if [[ "$SKIP_TESTS" == "1" ]]; then
  note "skipped (--skip-tests)"
elif timeout 2400 npm run test:run >/tmp/vtest.log 2>&1; then
  pass "vitest run (all suites)"
  grep -E "Test Files|Tests " /tmp/vtest.log | sed 's/^/      /' | head -4
else
  rc=$?
  fail "vitest run failed (exit $rc; see /tmp/vtest.log)"
  tail -40 /tmp/vtest.log | sed 's/^/      /'
fi

# =============================================================================
# PHASE 6: END-TO-END CLI SCENARIOS
# =============================================================================
# All scenarios run in isolated temp git repos. NONE invoke the pipeline/agents.
# =============================================================================
section "Phase 6: End-to-end CLI scenarios (safe subcommands only)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK" /tmp/v*.log' EXIT

# Fresh isolated repo helper
mkrepo() {
  local name="$1"
  local d="$WORK/$name"
  rm -rf "$d"; mkdir -p "$d"; ( cd "$d" && git init -q && git config user.email t@t.com && git config user.name t )
  echo "$d"
}

# ----- 6.1 Bootstrap ordering / logging teardown (§9.6.3) -------------------
echo "${_C}[6.1] Bootstrap & logging teardown (§9.6.3)${_N}"
t0=$(date +%s.%N); run_cli --help >/dev/null 2>&1; rc=$?; t1=$(date +%s.%N)
dt=$(awk "BEGIN{printf \"%.2f\", $t1-$t0}")
if [[ $rc -eq 0 ]] && awk "BEGIN{exit !($dt < 2.0)}"; then
  pass "hack --help exits 0 in ${dt}s (<2s target §9.6.3)"
else
  fail "hack --help: rc=$rc, ${dt}s (expected <2s)"
fi
run_cli --version >/dev/null 2>&1 && pass "hack --version exits 0" || fail "hack --version"

# ----- 6.2 Repo-root hard error outside a git repo (§9.8.5/§9.8.9) ----------
echo "${_C}[6.2] No-repository hard error + --help exemption (§9.8.5/§9.8.9)${_N}"
NOGIT="$WORK/nogit"; rm -rf "$NOGIT"; mkdir -p "$NOGIT"
( cd "$NOGIT" && run_cli --help >/dev/null 2>&1 ) && pass "hack --help works OUTSIDE a git repo (exit 0)" \
  || fail "hack --help should work outside a git repo"
( cd "$NOGIT" && run_cli config show >/dev/null 2>&1 ) \
  && fail "operational cmd outside git repo should hard-error (exit 1)" \
  || pass "operational cmd outside git repo hard-errors (§9.8.5)"
( cd "$NOGIT" && run_cli --dry-run >/dev/null 2>&1 ) \
  && fail "--dry-run outside repo should hard-error before dry-run" \
  || pass "--dry-run outside repo hard-errors before any work (§9.8.5)"

# ----- 6.3 Run-from-anywhere via upward .git traversal (§9.8.9) -------------
echo "${_C}[6.3] Run-from-anywhere + worktree/submodule .git (§9.8.2/§9.8.4)${_N}"
R=$(mkrepo subdir)
mkdir -p "$R/src/deep/nested"; ( cd "$R/src/deep/nested" && run_cli config path >/tmp/v6_3.out 2>&1 )
if grep -q "project.*$R/.hack" /tmp/v6_3.out; then
  pass "config path from nested subdir resolves to repo root"
else
  fail "config path from subdir did not resolve to repo root"; cat /tmp/v6_3.out | sed 's/^/      /'
fi
# worktree .git FILE detection
WTMAIN=$(mkrepo wtmain); ( cd "$WTMAIN" && echo "# p" > PRD.md && git add -A && git commit -qm init )
WTLINK="$WORK/wtlinked"; rm -rf "$WTLINK"; ( cd "$WTMAIN" && git worktree add -q "$WTLINK" )
if [[ -f "$WTLINK/.git" ]]; then
  ( cd "$WTLINK" && run_cli config path >/tmp/v6_3b.out 2>&1 )
  if grep -q "project.*$WTLINK/.hack" /tmp/v6_3b.out; then
    pass "worktree (.git file) root resolves to worktree root (§9.8.4)"
  else
    fail "worktree root not detected via .git file"; cat /tmp/v6_3b.out | sed 's/^/      /'
  fi
else
  note "could not create worktree .git file; skipping worktree test"
fi

# ----- 6.4 --repo-root override (§9.8.6) ------------------------------------
echo "${_C}[6.4] --repo-root override (§9.8.6)${_N}"
RR=$(mkrepo reporoot)
( cd "$WORK" && run_cli --repo-root "$RR" config path >/tmp/v6_4.out 2>&1 )
grep -q "project.*$RR/.hack" /tmp/v6_4.out && pass "--repo-root <abs> pins root" \
  || { fail "--repo-root pinning failed"; cat /tmp/v6_4.out | sed 's/^/      /'; }
NOGIT2="$WORK/nogit2"; mkdir -p "$NOGIT2"
( cd "$WORK" && run_cli --repo-root "$NOGIT2" config path >/dev/null 2>&1 ) \
  && fail "--repo-root on non-.git path should error" \
  || pass "--repo-root on non-.git path hard-errors (§9.8.6)"

# ----- 6.5 Explicit vs default --prd path semantics (§9.8.3) ---------------
echo "${_C}[6.5] Explicit --prd vs default path semantics (§9.8.3)${_N}"
PS=$(mkrepo prdsemantics); echo "# PRD" > "$PS/PRD.md"; mkdir -p "$PS/src/deep/nested"
( cd "$PS/src/deep/nested" && run_cli --dry-run --prd ../../../PRD.md >/tmp/v6_5a.out 2>&1 )
if grep -q "PRD: $PS/PRD.md" /tmp/v6_5a.out; then
  pass "explicit --prd resolves against INVOCATION_CWD (§9.8.3)"
else
  fail "explicit --prd did not resolve against invocation dir"; cat /tmp/v6_5a.out | sed 's/^/      /'
fi
( cd "$PS/src/deep/nested" && run_cli --dry-run >/tmp/v6_5b.out 2>&1 )
if grep -q "DRY RUN" /tmp/v6_5b.out; then
  pass "omitted --prd defaults to <repoRoot>/PRD.md (§9.8.3)"
else
  fail "omitted --prd did not resolve to repoRoot/PRD.md"; cat /tmp/v6_5b.out | sed 's/^/      /'
fi

# ----- 6.6 .hack: env-over-file rule (§9.2.1/§9.7.10) ----------------------
echo "${_C}[6.6] .hack env-over-file rule (§9.2.1/§9.7.10)${_N}"
EF=$(mkrepo envfile)
printf '[pipeline]\nparallel_research = true\n' > "$EF/.hack"
( cd "$EF" && PARALLEL_RESEARCH=false run_cli config show -o json >/tmp/v6_6a.out 2>/dev/null )
if grep -q '"key": "pipeline.parallel_research"' /tmp/v6_6a.out && grep -A1 'parallel_research' /tmp/v6_6a.out | grep -q '"value": "false"'; then
  pass "env var (PARALLEL_RESEARCH=false) beats .hack value (§9.7.10)"
else
  fail "env-over-file rule not honored"; cat /tmp/v6_6a.out | sed 's/^/      /'
fi
( cd "$EF" && run_cli config show -o json >/tmp/v6_6b.out 2>/dev/null )
if grep -A1 'parallel_research' /tmp/v6_6b.out | grep -q '"value": "true"'; then
  pass ".hack value applies when env unset"
else
  fail ".hack value not applied when env unset"; cat /tmp/v6_6b.out | sed 's/^/      /'
fi

# ----- 6.7 .hack seeding flows to runtime getters (wired knobs) ------------
echo "${_C}[6.7] .hack seeding → runtime getters (wired knobs)${_N}"
SG=$(mkrepo seedget)
printf '[pipeline]\nresearch_depth = 7\n' > "$SG/.hack"
val=$( cd "$SG" && env -u RESEARCH_DEPTH node --input-type=module -e "
import { loadHackConfig } from '$ROOT_DIR/dist/config/hack-config.js';
import { getResearchDepth } from '$ROOT_DIR/dist/config/constants.js';
loadHackConfig(process.cwd());
console.log(getResearchDepth());
" 2>/dev/null | tail -1 )
[[ "$val" == "7" ]] && pass ".hack [pipeline] research_depth=7 reaches getResearchDepth()" \
  || fail ".hack research_depth did not reach runtime getter (got '$val')"

# ----- 6.8 .hack secrets policy (§9.7.6) ------------------------------------
echo "${_C}[6.8] .hack secrets policy (§9.7.6)${_N}"
SP=$(mkrepo secrets)
printf '[auth]\nzai_api_key = "sk-leak"\n' > "$SP/.hack"
( cd "$SP" && run_cli config validate >/dev/null 2>&1 ) \
  && fail "secret in committable .hack should hard-error" \
  || pass "secret in committable .hack refused (hard error, §9.7.6)"
printf '[harness]\nname = "pi"\n' > "$SP/.hack"
printf '[auth]\noverride_key = "sk-ok"\n' > "$SP/.hack.local"
( cd "$SP" && run_cli config validate >/dev/null 2>&1 ) \
  && pass "secret in .hack.local allowed" \
  || fail "secret in .hack.local wrongly rejected"

# ----- 6.9 .hack type/range/enum + unknown-key validation (§9.7.7) ---------
echo "${_C}[6.9] .hack validation (§9.7.7)${_N}"
TV=$(mkrepo types)
printf '[tasks_lock]\npoll_ms = -5\n' > "$TV/.hack"
( cd "$TV" && run_cli config validate >/dev/null 2>&1 ) \
  && fail "out-of-range value should hard-error" \
  || pass "out-of-range int hard-errors (§9.7.7)"
printf '[harness]\nname = "foo"\n' > "$TV/.hack"
( cd "$TV" && run_cli config validate >/dev/null 2>&1 ) \
  && fail "bad enum value should hard-error" \
  || pass "bad enum value hard-errors (§9.7.7)"
printf '[bogus]\nx = 1\n' > "$TV/.hack"
( cd "$TV" && run_cli config validate >/tmp/v6_9.out 2>&1 )
if [[ $? -eq 0 ]] && grep -qi "unknown section" /tmp/v6_9.out; then
  pass "unknown section warns but exits 0 (lenient)"
else
  fail "unknown section handling mismatch"; cat /tmp/v6_9.out | sed 's/^/      /'
fi

# ----- 6.10 BOM rejection (§9.7.4) ------------------------------------------
echo "${_C}[6.10] BOM rejection (§9.7.4)${_N}"
BM=$(mkrepo bom)
printf '\xef\xbb\xbf[harness]\nname = "pi"\n' > "$BM/.hack"
( cd "$BM" && run_cli config validate >/tmp/v6_10.out 2>&1 )
if [[ $? -ne 0 ]] && grep -qi "BOM" /tmp/v6_10.out; then
  pass "UTF-8 BOM rejected with clear message"
else
  fail "BOM not rejected"; cat /tmp/v6_10.out | sed 's/^/      /'
fi

# ----- 6.11 config init + .gitignore (§9.7.8/§9.7.10) ----------------------
echo "${_C}[6.11] config init + .gitignore management (§9.7.8)${_N}"
CI=$(mkrepo cfginit); rm -f "$CI/.gitignore"
( cd "$CI" && run_cli config init >/dev/null 2>&1 ) && pass "config init writes .hack"
if [[ -f "$CI/.hack" ]] && grep -q -- ".hack.local" "$CI/.gitignore"; then
  pass "config init adds .hack.local to .gitignore"
else
  fail ".hack.local not gitignored after init"
fi
( cd "$CI" && run_cli config init >/dev/null 2>&1 ) \
  && fail "config init should refuse to clobber without --force" \
  || pass "config init refuses clobber without --force"
( cd "$CI" && run_cli config init --force >/dev/null 2>&1 ) \
  && pass "config init --force overwrites" \
  || fail "config init --force failed"

# ----- 6.12 config show masks secrets (§9.7.10) ----------------------------
echo "${_C}[6.12] config show secret masking (§9.7.10)${_N}"
SM=$(mkrepo showmask)
printf '[harness]\nname = "pi"\n' > "$SM/.hack"
printf '[auth]\noverride_key = "sk-NEVER-LEAK"\n' > "$SM/.hack.local"
out=$( cd "$SM" && run_cli config show -o json 2>/dev/null )
if echo "$out" | grep -q "sk-NEVER-LEAK"; then
  fail "config show LEAKED a secret value"
else
  pass "config show never echoes secret values"
fi

# ----- 6.13 tracked .hack.local warning (§9.7.6) ---------------------------
echo "${_C}[6.13] tracked-.hack.local warning (§9.7.6)${_N}"
TK=$(mkrepo tracked); printf '[cli]\nlog_level="debug"\n' > "$TK/.hack.local"
( cd "$TK" && git add -f .hack.local 2>/dev/null )
warnout=$( cd "$TK" && run_cli config validate 2>&1 )
if echo "$warnout" | grep -qi "WARNING.*\.hack.local.*tracked"; then
  pass "validate warns when .hack.local is git-tracked"
else
  fail "no warning for tracked .hack.local"; echo "$warnout" | sed 's/^/      /'
fi

# ----- 6.14 breakdown-in-progress (§5.3) -----------------------------------
echo "${_C}[6.14] Breakdown-in-progress graceful degradation (§5.3)${_N}"
BD=$(mkrepo breakdown); mkdir -p "$BD/plan/010_deadbeefcafe"; echo x > "$BD/plan/010_deadbeefcafe/.prd_hash"
( cd "$BD" && run_cli status >/tmp/v6_14a.out 2>/tmp/v6_14a.err ); rc=$?
# The 'status'/'task' (list) notice says "during PRD breakdown ... not available yet";
# the 'next' variant says "(breakdown in progress)". Match the common word and
# require NO scary ENOENT/Task-command-failed line and exit 0.
if [[ $rc -eq 0 ]] && grep -qi "breakdown" /tmp/v6_14a.err \
   && ! grep -qi "ENOENT" /tmp/v6_14a.err \
   && ! grep -qi "Task command failed" /tmp/v6_14a.err; then
  pass "hack status emits calm breakdown notice, exit 0 (no ENOENT/Task-failed)"
else
  fail "breakdown-in-progress status handling"; echo "      rc=$rc"; sed 's/^/      /' /tmp/v6_14a.err
fi
( cd "$BD" && run_cli status --output json >/tmp/v6_14b.out 2>/dev/null ); rc=$?
if [[ $rc -eq 0 ]] && grep -q '"status": "awaiting_breakdown"' /tmp/v6_14b.out; then
  pass "hack status --output json emits awaiting_breakdown, exit 0"
else
  fail "breakdown-in-progress JSON handling"; cat /tmp/v6_14b.out | sed 's/^/      /'
fi
( cd "$BD" && run_cli status --file /nonexistent/tasks.json >/dev/null 2>/tmp/v6_14c.err ); rc=$?
if [[ $rc -ne 0 ]]; then
  pass "explicit --file <missing> remains a hard error (§5.3 scope rule)"
else
  fail "explicit --file missing-file should hard-error"
fi
rm -rf "$BD/plan"
( cd "$BD" && run_cli status >/dev/null 2>/tmp/v6_14d.err ); rc=$?
if [[ $rc -ne 0 ]]; then
  pass "no-sessions-at-all remains a hard error (distinct from breakdown-in-progress)"
else
  fail "no-sessions should hard-error"; cat /tmp/v6_14d.err | sed 's/^/      /'
fi

# ----- 6.15 §9.7.10 headline acceptance: [cli] mode (KNOWN GAP) -----------
echo "${_C}[6.15] §9.7.10 headline: [cli] mode from .hack (acceptance criterion)${_N}"
CM=$(mkrepo climode); echo "# PRD" > "$CM/PRD.md"
printf '[cli]\nmode = "bug-hunt"\n' > "$CM/.hack"
( cd "$CM" && env -u PRP_AGENT_HARNESS run_cli --dry-run >/tmp/v6_15.out 2>&1 )
if grep -qi 'Mode: bug-hunt' /tmp/v6_15.out; then
  pass "[cli] mode = \"bug-hunt\" flows to actual --mode default (§9.7.10)"
else
  mode_line=$(grep -i 'Mode:' /tmp/v6_15.out | head -1)
  fail "[cli] mode from .hack does NOT reach the pipeline (got: '$mode_line') — CLI-only .hack keys have no consumer"
fi

# =============================================================================
# SUMMARY
# =============================================================================
section "Summary"
echo "  ${_G}Passed: ${#PASSES[@]}${_N}   ${_R}Failed: ${#FAILS[@]}${_N}"
echo
if [[ ${#FAILS[@]} -gt 0 ]]; then
  echo "${_R}${_B}Failures:${_N}"
  for f in "${FAILS[@]}"; do echo "  ${_R}•${_N} $f"; done
  echo
  echo "${_Y}See ./validation_report.md for the full bug tracker with root-cause analysis.${_N}"
  exit 1
fi
echo "${_G}All validation phases and scenarios passed.${_N}"
exit 0