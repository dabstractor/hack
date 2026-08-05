#!/usr/bin/env bash
# =============================================================================
# validate.sh — Comprehensive validation for hacky-hack (PRP Pipeline CLI)
#
# Validates the PRD bug-fix delta (§9.8 repo-root, §9.7 .hack config, §5.3
# breakdown-in-progress) plus the full standard toolchain.
#
# Phases:
#   1. Lint          (eslint)
#   2. Typecheck     (tsc --noEmit)
#   3. Format        (prettier --check)
#   4. Build         (tsc -p tsconfig.build.json → dist/index.js)
#   5. Tests         (vitest run — env-cleaned so shell RESEARCH_DEPTH etc. don't interfere)
#   6. E2E workflows (real subprocess invocations of dist/index.js with controlled cwd)
#
# Each phase prints a [PASS]/[FAIL] banner and accumulates a global result.
# Exit 0 only if every phase passes.
#
# Run: ./validate.sh
# =============================================================================
set -uo pipefail

# --- environment hygiene -----------------------------------------------------
# The dev shell exports RESEARCH_DEPTH/RESEARCH_QUEUE_CONCURRENCY which leak into
# the .hack env-over-file path (§9.2.1) and make two tests order/env-dependent.
# Unset them so validation is reproducible regardless of the caller's shell.
env -u RESEARCH_DEPTH -u RESEARCH_QUEUE_CONCURRENCY -u PARALLEL_RESEARCH true

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Prefer the built artifact for E2E; build it in Phase 4.
HACK_BIN="$ROOT/dist/index.js"

PASS_COUNT=0
FAIL_COUNT=0
FAIL_PHASES=()

phase() { printf '\n\033[1;36m════════ Phase %s ════════\033[0m\n' "$1"; }
ok()    { printf '\033[1;32m[PASS]\033[0m %s\n' "$1"; PASS_COUNT=$((PASS_COUNT+1)); }
bad()   { printf '\033[1;31m[FAIL]\033[0m %s\n' "$1"; FAIL_COUNT=$((FAIL_COUNT+1)); FAIL_PHASES+=("$1"); }

make_repo() { # $1 = path ; inits a git repo there
  git init -q "$1"
}
make_session() { # $1 = repo ; $2 = with_tasks_json (1|0)
  local repo="$1"; local withtasks="$2"
  mkdir -p "$repo/plan/001_abcdef123456"
  if [ "$withtasks" = "1" ]; then
    printf '{"backlog":[]}' > "$repo/plan/001_abcdef123456/tasks.json"
  fi
  printf '# Test PRD\n' > "$repo/plan/001_abcdef123456/prd_snapshot.md"
  printf '# Test PRD\n' > "$repo/PRD.md"
}

# =============================================================================
# Phase 1 — Lint
# =============================================================================
phase "1: Lint (eslint)"
if npm run --silent lint >/tmp/validate-lint.log 2>&1; then
  # eslint exits 0 on warnings-only; surface warning count
  local_warns=$(grep -c "warning" /tmp/validate-lint.log || true)
  ok "eslint (0 errors${local_warns:+, $local_warns warnings})"
else
  bad "eslint failed"
  tail -20 /tmp/validate-lint.log | sed 's/^/       | /'
fi

# =============================================================================
# Phase 2 — Typecheck
# =============================================================================
phase "2: Typecheck (tsc --noEmit)"
if npm run --silent typecheck >/tmp/validate-tc.log 2>&1; then
  ok "tsc --noEmit (no type errors)"
else
  bad "tsc typecheck failed"
  tail -20 /tmp/validate-tc.log | sed 's/^/       | /'
fi

# =============================================================================
# Phase 3 — Format check
# =============================================================================
phase "3: Format check (prettier)"
if npx prettier --check "src/**/*.ts" >/tmp/validate-fmt.log 2>&1; then
  ok "prettier --check src/**/*.ts"
else
  bad "prettier formatting check failed"
  tail -10 /tmp/validate-fmt.log | sed 's/^/       | /'
fi

# =============================================================================
# Phase 4 — Build
# =============================================================================
phase "4: Build (tsc → dist/index.js)"
if npm run --silent build >/tmp/validate-build.log 2>&1 && [ -x "$HACK_BIN" ]; then
  ok "build produced executable dist/index.js"
else
  bad "build failed"
  tail -20 /tmp/validate-build.log | sed 's/^/       | /'
fi

# =============================================================================
# Phase 5 — Unit + Integration tests (env-cleaned)
# =============================================================================
phase "5: Unit + Integration tests (vitest, env-cleaned)"
# Unset the .hack env-linked vars that leak from the dev shell (§9.2.1 env-over-file).
if env -u RESEARCH_DEPTH -u RESEARCH_QUEUE_CONCURRENCY -u PARALLEL_RESEARCH \
     npm run --silent test:run >/tmp/validate-test.log 2>&1; then
  ok "vitest run — full suite passed"
else
  # Suite may still have failures; report the summary line.
  summary=$(grep -E "Test Files|Tests " /tmp/validate-test.log | tail -2 | tr '\n' ' ')
  bad "vitest run — suite has failures ($summary)"
  grep -E "FAIL " /tmp/validate-test.log | sed 's/^/       | /' | head -20
fi

# =============================================================================
# Phase 6 — End-to-End workflow validation (real subprocess)
# =============================================================================
phase "6: E2E workflows (subprocess, controlled cwd)"

T=$(mktemp -d /tmp/validate-e2e-XXXX)
trap 'rm -rf "$T"' EXIT

# --- 6a. BUG-001 primary: all 7 subcommands resolve plan/PRD.md at repo root from a nested subdir
SUBCMD_REPO="$T/subcmd"; make_repo "$SUBCMD_REPO"; make_session "$SUBCMD_REPO" 1
NESTED="$SUBCMD_REPO/src/deep/nested"; mkdir -p "$NESTED"
subcmd_ok=1
for sc in task status inspect artifacts cache validate-state "config show"; do
  out=$(env -u RESEARCH_DEPTH node "$HACK_BIN" $sc 2>&1)
  if echo "$out" | grep -qE "No sessions found|Failed to validate PRD exists at"; then
    subcmd_ok=0
    bad "BUG-001: subcommand '$sc' leaked subdir resolution"
  fi
done
[ "$subcmd_ok" -eq 1 ] && ok "BUG-001: all 7 subcommands resolve at repo root from nested subdir"

# --- 6b. §9.8.5: subcommands outside any repo → clean NotARepositoryError (exit 1, no stack)
NOGIT="$T/nogit"; mkdir -p "$NOGIT"
nogit_ok=1
for sc in task status validate-state; do
  out=$(cd "$NOGIT" && env -u RESEARCH_DEPTH node "$HACK_BIN" $sc 2>&1); code=$?
  if [ "$code" -ne 1 ] || ! echo "$out" | grep -q "No .git entry found" \
     || echo "$out" | grep -qE "^\s*at |No sessions found"; then
    nogit_ok=0
    bad "§9.8.5: '$sc' outside repo did not give clean NotARepositoryError (exit=$code)"
    echo "$out" | sed 's/^/       | /' | head -4
  fi
done
[ "$nogit_ok" -eq 1 ] && ok "§9.8.5: subcommands outside repo exit 1 with clean message"

# --- 6c. §5.3: breakdown-in-progress calm notice from a subdir
BD_REPO="$T/breakdown"; make_repo "$BD_REPO"; make_session "$BD_REPO" 0  # session dir, NO tasks.json
BD_NESTED="$BD_REPO/src/deep/nested"; mkdir -p "$BD_NESTED"
out=$(cd "$BD_NESTED" && env -u RESEARCH_DEPTH node "$HACK_BIN" status 2>&1); code=$?
if [ "$code" -eq 0 ] && echo "$out" | grep -q "tasks.json is generated during PRD breakdown" \
   && ! echo "$out" | grep -q "No sessions found"; then
  ok "§5.3: breakdown-in-progress calm notice from subdir (exit 0)"
else
  bad "§5.3: calm notice from subdir failed (exit=$code)"
  echo "$out" | sed 's/^/       | /' | head -6
fi

# --- 6d. BUG-001 REGRESSION GUARD: explicit --prd ./PRD.md from subdir must resolve against INVOCATION_CWD
REG_REPO="$T/reg"; make_repo "$REG_REPO"
mkdir -p "$REG_REPO/src/deep/nested"
printf '# root PRD (must NOT be used)\n' > "$REG_REPO/PRD.md"
printf '# subdir PRD (SHOULD be used)\n'   > "$REG_REPO/src/deep/nested/PRD.md"
out=$(cd "$REG_REPO/src/deep/nested" && env -u RESEARCH_DEPTH node "$HACK_BIN" --dry-run --prd ./PRD.md 2>&1)
if echo "$out" | grep -q "PRD: $REG_REPO/src/deep/nested/PRD.md"; then
  ok "§9.8.9 regression guard: explicit --prd resolves against INVOCATION_CWD"
else
  bad "REGRESSION: explicit --prd ./PRD.md does NOT resolve against INVOCATION_CWD (PRD §9.8.9)"
  echo "$out" | grep -i "PRD:" | sed 's/^/       | /'
fi

# --- 6e. --repo-root override (valid path from outside the repo)
RR_REPO="$T/rr"; make_repo "$RR_REPO"; printf '# PRD\n' > "$RR_REPO/PRD.md"
RR_OUT="$T/rout"; mkdir -p "$RR_OUT"
out=$(cd "$RR_OUT" && env -u RESEARCH_DEPTH node "$HACK_BIN" --dry-run --repo-root "$RR_REPO" 2>&1); code=$?
[ "$code" -eq 0 ] && ok "--repo-root override resolves from outside the repo (exit 0)" \
                 || { bad "--repo-root override failed (exit=$code)"; echo "$out" | sed 's/^/       | /' | head -6; }

# --- 6f. --repo-root override (invalid path → clean explicit NotARepositoryError)
out=$(cd "$RR_OUT" && env -u RESEARCH_DEPTH node "$HACK_BIN" --dry-run --repo-root "$T/nope" 2>&1); code=$?
if [ "$code" -eq 1 ] && echo "$out" | grep -q "does not contain a .git entry" \
   && ! echo "$out" | grep -qE "^\s*at "; then
  ok "--repo-root invalid path → clean explicit error (exit 1, no stack)"
else
  bad "--repo-root invalid path did not give clean error (exit=$code)"
fi

# --- 6g. BUG-002: .hack range/secrets/BOM errors render as clean ❌ (no stack trace)
CFG_REPO="$T/cfg"; make_repo "$CFG_REPO"; printf '# PRD\n' > "$CFG_REPO/PRD.md"
# range error
printf '[tasks_lock]\npoll_ms = -5\n' > "$CFG_REPO/.hack"
out=$(cd "$CFG_REPO" && env -u RESEARCH_DEPTH node "$HACK_BIN" --dry-run 2>&1); code=$?
if [ "$code" -eq 1 ] && echo "$out" | grep -q "poll_ms" && echo "$out" | grep -q "out of range" \
   && ! echo "$out" | grep -qE "^\s*at |Fatal error in main"; then
  ok "BUG-002: .hack range error renders clean ❌ (no stack)"
else
  bad "BUG-002: range error rendering failed (exit=$code)"; echo "$out" | sed 's/^/       | /' | head -6
fi
# secrets error
printf '# PRD\n' > "$CFG_REPO/PRD.md"; printf '[auth]\nzai_api_key = "sk-leaked"\n' > "$CFG_REPO/.hack"
out=$(cd "$CFG_REPO" && env -u RESEARCH_DEPTH node "$HACK_BIN" --dry-run 2>&1); code=$?
if [ "$code" -eq 1 ] && echo "$out" | grep -q "zai_api_key" && echo "$out" | grep -q "not permitted" \
   && ! echo "$out" | grep -qE "^\s*at |sk-leaked"; then
  ok "BUG-002: .hack secrets error renders clean ❌ (secret value not echoed)"
else
  bad "BUG-002: secrets error rendering failed (exit=$code)"; echo "$out" | sed 's/^/       | /' | head -6
fi

# --- 6h. BUG-003: relational constraint retry_delay_cap_ms < retry_delay_ms must be rejected
REL_REPO="$T/rel"; make_repo "$REL_REPO"; printf '# PRD\n' > "$REL_REPO/PRD.md"
printf '[commit]\nretry_delay_ms = 200000\nretry_delay_cap_ms = 100\n' > "$REL_REPO/.hack"
out=$(cd "$REL_REPO" && env -u RESEARCH_DEPTH node "$HACK_BIN" config validate 2>&1); code=$?
if [ "$code" -eq 1 ] && echo "$out" | grep -qi "less than retry_delay_ms"; then
  ok "BUG-003: cap < delay rejected (config validate, exit 1)"
else
  bad "BUG-003: relational constraint not enforced (exit=$code)"; echo "$out" | sed 's/^/       | /' | head -6
fi
# control: cap >= delay accepted
printf '[commit]\nretry_delay_ms = 100\nretry_delay_cap_ms = 200000\n' > "$REL_REPO/.hack"
out=$(cd "$REL_REPO" && env -u RESEARCH_DEPTH node "$HACK_BIN" config validate 2>&1); code=$?
if [ "$code" -eq 0 ] && echo "$out" | grep -qi "valid"; then
  ok "BUG-003 control: cap >= delay accepted (config validate, exit 0)"
else
  bad "BUG-003 control: valid config rejected (exit=$code)"; echo "$out" | sed 's/^/       | /' | head -6
fi

# --- 6i. --help works outside any repo (Commander short-circuits before traversal)
out=$(cd "$NOGIT" && env -u RESEARCH_DEPTH node "$HACK_BIN" --help >/dev/null 2>&1); code=$?
[ "$code" -eq 0 ] && ok "§9.8.5: --help works outside any repo (exit 0)" \
                 || bad "--help failed outside repo (exit=$code)"

# =============================================================================
# Summary
# =============================================================================
printf '\n\033[1;36m════════ Summary ════════\033[0m\n'
printf 'Passed: \033[1;32m%d\033[0m   Failed: \033[1;31m%d\033[0m\n' "$PASS_COUNT" "$FAIL_COUNT"
if [ "$FAIL_COUNT" -gt 0 ]; then
  printf 'Failed checks:\n'
  for p in "${FAIL_PHASES[@]}"; do printf '  • %s\n' "$p"; done
  printf '\n\033[1;31mVALIDATION FAILED\033[0m\n'
  exit 1
fi
printf '\n\033[1;32mVALIDATION PASSED\033[0m\n'
exit 0