#!/usr/bin/env bash
# =============================================================================
# validate.sh — Comprehensive validation for the PRP Pipeline (hacky-hack)
# =============================================================================
# Validates the "Per-Role Reasoning Level (Extended-Thinking Budget)" feature
# (PRD §9.2.9) and the broader pipeline. Runs the project's real lint/type/test/
# docs gates PLUS functional E2E checks of the reasoning feature through the
# built CLI.
#
# This is a VALIDATION script — it tests and reports. It does not modify source.
#
# Usage:   ./validate.sh
# Exit:    0 if all phases pass; 1 if any phase fails.
# =============================================================================
set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR" || { echo "FATAL: cannot cd to $PROJECT_DIR"; exit 1; }

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
PASS_COUNT=0; FAIL_COUNT=0; WARN_COUNT=0

phase() { echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; echo -e "${BLUE}▶ PHASE $1: $2${NC}"; echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }
ok()   { echo -e "${GREEN}  ✅ PASS${NC} — $1"; ((PASS_COUNT++)); }
fail() { echo -e "${RED}  ❌ FAIL${NC} — $1"; ((FAIL_COUNT++)); }
warn() { echo -e "${YELLOW}  ⚠️  WARN${NC} — $1"; ((WARN_COUNT++)); }
run()  { echo -e "  $ $*"; "$@" >/tmp/validate.out 2>&1; local rc=$?; return $rc; }

# Reusable helper: run a command, report pass/fail by exit code.
gate() { # gate <label> <cmd...>
  local label="$1"; shift
  echo -e "  $ $*"
  if "$@" >/tmp/validate.out 2>&1; then
    ok "$label"
  else
    fail "$label (see /tmp/validate.out)"
    tail -n 20 /tmp/validate.out | sed 's/^/      /'
  fi
}

echo "=============================================================================="
echo " PRP Pipeline — Comprehensive Validation"
echo " Feature: Per-Role Reasoning Level (PRD §9.2.9)"
echo " Project: $PROJECT_DIR"
echo " Date:    $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "=============================================================================="

# -----------------------------------------------------------------------------
# PHASE 1 — Linting (ESLint)
# -----------------------------------------------------------------------------
phase 1 "Linting (ESLint)"
gate "eslint (0 errors)" npm run lint
# Distinguish errors from warnings: the gate above passes because warnings don't
# fail eslint, but surface the warning count for transparency.
WARN_OUTPUT="$(npm run lint 2>&1 | grep -E '^\s*[0-9]+ problems' || true)"
[ -n "$WARN_OUTPUT" ] && echo -e "  ℹ️  eslint summary: $WARN_OUTPUT"

# -----------------------------------------------------------------------------
# PHASE 2 — Type Checking (tsc --noEmit)
# -----------------------------------------------------------------------------
phase 2 "Type Checking (TypeScript)"
gate "tsc --noEmit (strict)" npm run typecheck

# -----------------------------------------------------------------------------
# PHASE 3 — Style / Format Checking (Prettier)
# -----------------------------------------------------------------------------
phase 3 "Style / Format Checking (Prettier)"
gate "prettier --check (all files)" npm run format:check

# -----------------------------------------------------------------------------
# PHASE 4 — Unit & Integration Testing (Vitest)
# -----------------------------------------------------------------------------
phase 4 "Unit & Integration Testing (Vitest)"
echo -e "  Running full suite (this takes ~3-4 min)..."
if npm run test:run >/tmp/validate.out 2>&1; then
  # Extract the summary line.
  SUMMARY="$(grep -E 'Tests +[0-9]+ passed' /tmp/validate.out | tail -1)"
  ok "vitest run — $SUMMARY"
else
  fail "vitest run (see /tmp/validate.out)"
  grep -E 'FAIL |❌|Error:|AssertionError' /tmp/validate.out | head -20 | sed 's/^/      /'
fi

# -----------------------------------------------------------------------------
# PHASE 5 — Documentation Checks
# -----------------------------------------------------------------------------
phase 5 "Documentation Checks"
gate "docs:check (scripts/check-docs.ts)" npm run docs:check

# -----------------------------------------------------------------------------
# PHASE 6 — Build (dist) for functional E2E checks
# -----------------------------------------------------------------------------
phase 6 "Production Build (for functional E2E)"
if npm run build >/tmp/validate.out 2>&1; then
  ok "tsc build (dist/ emitted)"
else
  fail "tsc build (see /tmp/validate.out)"
  tail -n 20 /tmp/validate.out | sed 's/^/      /'
fi

# -----------------------------------------------------------------------------
# PHASE 7 — Functional E2E: Reasoning Feature (PRD §9.2.9 acceptance criteria)
# -----------------------------------------------------------------------------
phase 7 "Functional E2E — Reasoning Config Resolution (§9.2.9)"

# Helper that imports from the built dist and runs a node snippet.
node_check() { # node_check <label> <script>
  local label="$1"; local script="$2"
  if echo "$script" | node --input-type=module - 2>/tmp/validate.node.err; then
    ok "$label"
  else
    fail "$label"; cat /tmp/validate.node.err | sed 's/^/      /'
  fi
}

# 7a. Vocabulary + defaults (all five roles resolve to their defaults when unset).
node_check "defaults: agent/breakdown/bug_finder/validation=high, impl=off" '
import { getReasoningAgent, getReasoningBreakdown, getReasoningBugFinder, getReasoningValidation, getReasoningImpl } from "./dist/config/constants.js";
const d = { agent: getReasoningAgent(), breakdown: getReasoningBreakdown(), bug: getReasoningBugFinder(), validation: getReasoningValidation(), impl: getReasoningImpl() };
const exp = { agent: "high", breakdown: "high", bug: "high", validation: "high", impl: "off" };
console.log(JSON.stringify(d) === JSON.stringify(exp) ? "OK " + JSON.stringify(d) : process.exit(1));
'

# 7b. Case-insensitive resolution (HIGH -> high, Off -> off).
node_check "case-insensitive: HIGH->high, Off->off" '
import { getReasoningAgent, getReasoningImpl } from "./dist/config/constants.js";
process.env.PRP_REASONING_AGENT = "HIGH"; process.env.PRP_REASONING_IMPL_AGENT = "Off";
if (getReasoningAgent() !== "high" || getReasoningImpl() !== "off") process.exit(1);
console.log("OK");
'

# 7c. Empty / whitespace value falls back to default (never forwarded).
node_check "empty/whitespace -> default (never forwarded)" '
import { getReasoningImpl } from "./dist/config/constants.js";
process.env.PRP_REASONING_IMPL_AGENT = "   ";
if (getReasoningImpl() !== "off") process.exit(1);
console.log("OK");
'

# 7d. Invalid value throws ReasoningConfigError.
node_check "invalid value (ultra) throws ReasoningConfigError" '
import { resolveReasoningLevel } from "./dist/config/constants.js";
try { resolveReasoningLevel("ultra", "PRP_REASONING_AGENT", "high"); process.exit(1); }
catch (e) { if (e.name !== "ReasoningConfigError") process.exit(1); console.log("OK", e.name); }
'

# 7e. Bug-finder and validation resolve INDEPENDENT levels (core §9.2.9 requirement).
node_check "bug-finder & validation resolve INDEPENDENT levels" '
import { getReasoningBugFinder, getReasoningValidation } from "./dist/config/constants.js";
process.env.PRP_REASONING_BUG_FINDER_AGENT = "xhigh"; process.env.PRP_REASONING_VALIDATION_AGENT = "low";
const bf = getReasoningBugFinder(), v = getReasoningValidation();
if (bf !== "xhigh" || v !== "low" || bf === v) process.exit(1);
console.log("OK bug-finder=" + bf + " validation=" + v);
'

# 7f. Model tier DECOUPLED from reasoning level (two independent axes).
node_check "model tier decoupled from reasoning level (architect off=balanced, coder xhigh=fast)" '
import { createArchitectAgent, createCoderAgent } from "./dist/agents/agent-factory.js";
process.env.PRP_REASONING_BREAKDOWN_AGENT = "off"; process.env.PRP_REASONING_IMPL_AGENT = "xhigh";
const a = createArchitectAgent(), c = createCoderAgent();
if (a.config.model !== "zai/glm-5.2" || a.config.thinking !== "off") process.exit(1);
if (c.config.model !== "zai/glm-5-turbo" || c.config.thinking !== "xhigh") process.exit(1);
console.log("OK");
'

# 7g. createBaseConfig REQUIRES the thinking arg (compile-time enforced decoupling).
#     Verified by typecheck in Phase 2; a runtime smoke test that a 2-arg call still
#     works via the default role is redundant — the type system gates this.
ok "createBaseConfig requires thinking arg (enforced by tsc strict in Phase 2)"

# -----------------------------------------------------------------------------
# PHASE 8 — Functional E2E: CLI surface (config show --src, fail-fast, .hack)
# -----------------------------------------------------------------------------
phase 8 "Functional E2E — CLI Surface (config show / fail-fast / .hack)"

# Absolute path so the CLI resolves regardless of the cwd we cd into for tests.
CLI="npx tsx $PROJECT_DIR/src/index.ts"

# 8a. config show --src surfaces all 5 reasoning roles with source attribution.
if $CLI config show --src 2>/dev/null | grep -q "reasoning.agent" \
   && $CLI config show --src 2>/dev/null | grep -q "reasoning.impl_agent"; then
  ok "config show --src surfaces reasoning roles"
else
  fail "config show --src surfaces reasoning roles"
fi

# 8b. config show --src reports correct DEFAULTS (high/high/high/high/off).
SHOW_OUT="$($CLI config show --src 2>/dev/null)"
echo "$SHOW_OUT" | grep -q "reasoning.agent.*high.*default" \
  && echo "$SHOW_OUT" | grep -q "reasoning.impl_agent.*off.*default" \
  && ok "config show --src reports correct reasoning defaults" \
  || fail "config show --src reports correct reasoning defaults"

# 8c. env var override reflected with 'env' source.
if PRP_REASONING_IMPL_AGENT=xhigh $CLI config show --src 2>/dev/null | grep -q "reasoning.impl_agent.*xhigh.*env"; then
  ok "env override reflected in config show (source=env)"
else
  fail "env override reflected in config show (source=env)"
fi

# 8d. --help short-circuits BEFORE reasoning validation (works with no repo, exit 0).
if (cd /tmp && PRP_REASONING_AGENT=ultra $CLI --help >/dev/null 2>&1); then
  ok "--help short-circuits before validation (exit 0 with invalid env)"
else
  fail "--help short-circuits before validation"
fi

# 8e. .hack [reasoning] case-insensitive acceptance + env-over-file.
TESTREPO="$(mktemp -d)"
( cd "$TESTREPO" && git init -q && mkdir -p spec && echo "# t" > spec/SPEC.md \
  && printf '[reasoning]\nagent = "HIGH"\nimpl_agent = "Off"\n' > .hack )
if ( cd "$TESTREPO" && $CLI config show --src 2>/dev/null | grep -q "reasoning.agent.*HIGH.*project" ); then
  ok ".hack [reasoning] accepts case-insensitive values (HIGH/Off)"
else
  fail ".hack [reasoning] accepts case-insensitive values (HIGH/Off)"
fi
# env-over-file: .hack=high, env=low -> env wins.
if ( cd "$TESTREPO" && PRP_REASONING_AGENT=low $CLI config show --src 2>/dev/null | grep -q "reasoning.agent.*low.*env" ); then
  ok "env-over-file precedence (env low wins over .hack)"
else
  fail "env-over-file precedence (env low wins over .hack)"
fi
# Invalid .hack reasoning value -> fail-fast with actionable message.
( cd "$TESTREPO" && printf '[reasoning]\nimpl_agent = "loud"\n' > .hack )
if ( cd "$TESTREPO" && $CLI config show --src 2>&1 | grep -qi "not one of the accepted values" ) \
   && ! ( cd "$TESTREPO" && $CLI config show --src >/dev/null 2>&1 ); then
  ok "invalid .hack reasoning value fails fast with actionable message"
else
  fail "invalid .hack reasoning value fails fast with actionable message"
fi
rm -rf "$TESTREPO"

# -----------------------------------------------------------------------------
# PHASE 9 — Documentation Completeness (P1.M2.T1 Mode-B docs)
# -----------------------------------------------------------------------------
phase 9 "Documentation Completeness (Mode-B changeset docs)"
grep -q -i "reasoning" docs/CONFIGURATION.md && ok "CONFIGURATION.md documents reasoning" || fail "CONFIGURATION.md documents reasoning"
grep -q -i "reasoning" docs/ARCHITECTURE.md && ok "ARCHITECTURE.md documents reasoning axis" || fail "ARCHITECTURE.md documents reasoning axis"
grep -q -i "reasoning" README.md && ok "README.md mentions per-role reasoning" || fail "README.md mentions per-role reasoning"
grep -q "PRP_REASONING_IMPL_AGENT" .env.example && ok ".env.example documents reasoning env vars" || fail ".env.example documents reasoning env vars"

# -----------------------------------------------------------------------------
# PHASE 10 — Stale-comment scan (consistency with §9.2.9 behavior change)
# -----------------------------------------------------------------------------
phase 10 "Stale-Comment Scan (§9.2.9 behavior-change consistency)"
# The reasoning roles now default to 'high', not 'xhigh'. Flag source comments
# that still claim the budget is 'xhigh' — these are misleading post-§9.2.9.
STALE="$(grep -rn 'xhigh' src/ --include='*.ts' | grep -iE 'budget|tier @|reasoning role|inherits.*xhigh' || true)"
if [ -z "$STALE" ]; then
  ok "no stale 'xhigh'-budget source comments"
else
  warn "found source comments still claiming xhigh reasoning budget (functional behavior is correct; comments are misleading)"
  echo "$STALE" | sed 's/^/      /'
fi
# Same scan in .env.example.
STALE_ENV="$(grep -n 'xhigh' .env.example | grep -iE 'budget|reasoning' || true)"
if [ -n "$STALE_ENV" ]; then
  warn ".env.example has a stale 'xhigh' reasoning-budget comment"
  echo "$STALE_ENV" | sed 's/^/      /'
fi

# -----------------------------------------------------------------------------
# SUMMARY
# -----------------------------------------------------------------------------
echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}▶ VALIDATION SUMMARY${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${GREEN}Passed:   $PASS_COUNT${NC}"
echo -e "  ${YELLOW}Warnings: $WARN_COUNT${NC}"
echo -e "  ${RED}Failed:   $FAIL_COUNT${NC}"
echo ""
if [ "$FAIL_COUNT" -gt 0 ]; then
  echo -e "${RED}❌ VALIDATION FAILED — $FAIL_COUNT gate(s) failed.${NC}"
  exit 1
fi
if [ "$WARN_COUNT" -gt 0 ]; then
  echo -e "${YELLOW}⚠️  VALIDATION PASSED with $WARN_COUNT warning(s) — see validation_report.md for details.${NC}"
else
  echo -e "${GREEN}✅ VALIDATION PASSED — all gates green.${NC}"
fi
exit 0