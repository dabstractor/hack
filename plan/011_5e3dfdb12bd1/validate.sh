#!/usr/bin/env bash
# =============================================================================
# validate.sh — Comprehensive validation for the PRP Pipeline (hacky-hack)
# =============================================================================
# Runs every quality gate the project ships, plus end-to-end checks of the
# documented user workflows that do NOT invoke an LLM agent (the agent-driven
# pipeline is intentionally never executed by this script — see AGENTS.md).
#
# Phases:
#   1. Lint            (eslint)
#   2. Typecheck       (tsc --noEmit)
#   3. Style/format    (prettier --check)
#   4. Unit + integration tests (vitest run)
#   5. Production build (tsc + chmod dist)
#   6. E2E / user-workflow checks (canonical PRD resolution, .hack config,
#      subcommand PRD-path regression detector, build artifact, secrets hygiene)
#
# Exit code: 0 only if EVERY phase passes. Each phase reports PASS/FAIL and the
# script runs to completion so you see the full picture in one shot.
#
# Usage:   ./validate.sh
#          ./validate.sh --no-tests   # skip the slow test phase (phase 4)
# =============================================================================

set -uo pipefail

# --- resolve repo root (this script may be invoked from anywhere in the repo) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RUN_TESTS=1
for arg in "$@"; do
  case "$arg" in
    --no-tests) RUN_TESTS=0 ;;
    -h|--help)
      sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown flag: $arg"; exit 2 ;;
  esac
done

# --- tally ---
declare -a PHASE_NAME=()
declare -a PHASE_RC=()
FAILED=0
WARNINGS=0

run_phase() {
  local name="$1"; shift
  echo
  echo "────────────────────────────────────────────────────────────────"
  echo "▶ PHASE: $name"
  echo "────────────────────────────────────────────────────────────────"
  "$@"
  local rc=$?
  PHASE_NAME+=("$name")
  PHASE_RC+=("$rc")
  if [ "$rc" -ne 0 ]; then
    FAILED=$((FAILED+1))
    echo "✘ PHASE FAIL: $name (exit $rc)"
  else
    echo "✓ PHASE PASS: $name"
  fi
  return 0   # never let set -e (off here, but defensive) abort the run
}

# =============================================================================
# Phase 1 — Lint
# =============================================================================
phase_lint() {
  npm run lint --silent
}

# =============================================================================
# Phase 2 — Typecheck
# =============================================================================
phase_typecheck() {
  npm run typecheck --silent
}

# =============================================================================
# Phase 3 — Format / style check
# =============================================================================
phase_format() {
  npm run format:check --silent
}

# =============================================================================
# Phase 4 — Unit + integration tests
# =============================================================================
phase_tests() {
  if [ "$RUN_TESTS" -eq 0 ]; then
    echo "  (skipped via --no-tests)"
    return 0
  fi
  echo "  (this phase takes ~3–4 minutes)"
  npm run test:run --silent
}

# =============================================================================
# Phase 5 — Production build
# =============================================================================
phase_build() {
  npm run build --silent
  # sanity: the CLI entrypoint must exist and be executable after postbuild
  if [ ! -x "./dist/index.js" ]; then
    echo "  ✘ dist/index.js missing or not executable after build"
    return 1
  fi
  echo "  ✓ dist/index.js built and executable"
}

# =============================================================================
# Phase 6 — E2E / documented user-workflow checks (no agents invoked)
# =============================================================================
phase_e2e() {
  local rc=0

  # --- 6a. Canonical PRD resolves via the project's own include expander -------
  # The PRD was split into a distributed spec (spec/SPEC.md + 16 section files).
  # Verify the @-include machinery assembles a single canonical document.
  echo "  [6a] Resolving canonical PRD spec/SPEC.md …"
  npx --no-install tsx -e '
    (async () => {
      const { resolvePRD } = await import("./src/core/session-utils.ts");
      const resolved = await resolvePRD("spec/SPEC.md");
      if (resolved.length < 50000) { console.error("  ✘ resolved PRD suspiciously short:", resolved.length); process.exit(1); }
      const must = ["Validation Gate Semantics", ".hack", "Repository Root Resolution"];
      const missing = must.filter(s => !resolved.includes(s));
      if (missing.length) { console.error("  ✘ resolved PRD missing sections:", missing.join(", ")); process.exit(1); }
      console.log("  ✓ spec/SPEC.md resolves (" + resolved.length + " chars, all sections present)");
    })().catch(e => { console.error("  ✘ resolve failed:", e.message); process.exit(1); });
  ' 2>&1 | grep -Ev 'Deprecation|stale include' || true
  rc=${PIPESTATUS[0]:-$rc}

  # --- 6b. .hack config loads and its [cli] prd points at a resolving file -----
  echo "  [6b] Loading .hack and verifying [cli] prd …"
  npx --no-install tsx -e '
    (async () => {
      const { loadHackConfig } = await import("./src/config/hack-config.ts");
      const cfg: any = await loadHackConfig(process.cwd());
      const prd = cfg?.cli?.prd;
      if (!prd) { console.error("  ✘ .hack has no [cli] prd key"); process.exit(2); }
      const { existsSync } = await import("node:fs");
      if (!existsSync(prd)) { console.error("  ✘ .hack [cli] prd = " + prd + " does not exist"); process.exit(2); }
      console.log("  ✓ .hack loaded; [cli] prd = " + prd + " (exists)");
    })().catch(e => { console.error("  ✘ .hack load failed:", e.message); process.exit(2); });
  ' 2>&1 | grep -Ev 'Deprecation' || true
  [ "${PIPESTATUS[0]:-0}" -ne 0 ] && rc=1

  # --- 6c. Subcommand PRD-path regression detector ---------------------------
  # Documented user workflow: hack run from anywhere resolves the repo root and
  # honors .hack [cli] prd (PRD §9.8.7 / §9.7.10). The 4 read-only inspection
  # subcommands (artifacts/cache/inspect/validate-state) MUST NOT hard-code the
  # legacy root ./PRD.md. This static check flags any such hard-coding.
  echo "  [6c] Scanning src/cli for subcommands that ignore .hack [cli] prd …"
  local hardcoded
  # Match real code only; skip the JSDoc `* @param ... (default: resolve('PRD.md'))` comment lines.
  hardcoded="$(grep -rnE "resolve\(['\"]PRD\.md['\"]\)" src/cli/index.ts src/cli/commands/*.ts | grep -vE '^[^:]+:[0-9]+:\s*\*\s' || true)"
  if [ -n "$hardcoded" ]; then
    echo "  ✘ Subcommands hard-code resolve('PRD.md') instead of honoring .hack [cli] prd:"
    echo "$hardcoded" | sed 's/^/      /'
    echo "      → breaks hack artifacts / hack cache / hack inspect / hack validate-state"
    echo "        whenever the PRD is a distributed spec (this repo)."
    rc=1
  else
    echo "  ✓ no subcommand hard-codes resolve('PRD.md')"
  fi

  # --- 6d. Secrets hygiene ---------------------------------------------------
  echo "  [6d] Checking secrets hygiene …"
  if git check-ignore -q .env; then
    echo "  ✓ .env is gitignored"
  else
    echo "  ✘ .env is NOT gitignored (potential secret leak)"; rc=1
  fi
  if git check-ignore -q .hack.local; then
    echo "  ✓ .hack.local is gitignored"
  else
    # not a hard failure (no .hack.local exists yet) but a PRD §9.7.3 gap
    echo "  ⚠ .hack.local is NOT gitignored (PRD §9.7.3: hack config init must add it)"
    WARNINGS=$((WARNINGS+1))
  fi
  # committable .hack must refuse secret-bearing keys (PRD §9.7.6)
  if grep -qiE '(_key|_token|_secret|_password|api_key|auth_token)\s*=' .hack 2>/dev/null; then
    echo "  ✘ committable .hack appears to contain a secret-bearing key (PRD §9.7.6)"; rc=1
  else
    echo "  ✓ .hack contains no secret-bearing keys"
  fi

  return $rc
}

# =============================================================================
# Run everything
# =============================================================================
run_phase "1/6 Lint"        phase_lint
run_phase "2/6 Typecheck"   phase_typecheck
run_phase "3/6 Format"      phase_format
run_phase "4/6 Tests"       phase_tests
run_phase "5/6 Build"       phase_build
run_phase "6/6 E2E/Workflows" phase_e2e

# =============================================================================
# Summary
# =============================================================================
echo
echo "============================================================================="
echo "VALIDATION SUMMARY"
echo "============================================================================="
for i in "${!PHASE_NAME[@]}"; do
  if [ "${PHASE_RC[$i]}" -eq 0 ]; then
    printf "  ✓ %-28s PASS\n" "${PHASE_NAME[$i]}"
  else
    printf "  ✘ %-28s FAIL (exit %s)\n" "${PHASE_NAME[$i]}" "${PHASE_RC[$i]}"
  fi
done
echo "-----------------------------------------------------------------------------"
if [ "$FAILED" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
  echo "RESULT: ALL PHASES PASSED ✅"
  exit 0
elif [ "$FAILED" -eq 0 ]; then
  echo "RESULT: PASSED with $WARNINGS warning(s) ⚠️  (exit 0)"
  exit 0
else
  echo "RESULT: $FAILED phase(s) FAILED ❌  ($WARNINGS warning(s))"
  echo "See ./validation_report.md for the detailed bug tracker."
  exit 1
fi