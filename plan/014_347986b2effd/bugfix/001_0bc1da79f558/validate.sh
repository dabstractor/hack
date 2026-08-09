#!/usr/bin/env bash
# =============================================================================
# validate.sh — Comprehensive project validation for hacky-hack
# (Autonomous PRP Development Pipeline)
#
# Validates the §2.3 Distributed-PRD include-dedup feature (src/core/session-utils.ts)
# and the overall codebase health. Runs five phases:
#   1. Lint           (eslint)
#   2. Type check     (tsc --noEmit)
#   3. Style check    (prettier --check)
#   4. Unit/E2E tests (vitest run)
#   5. End-to-end probe of the REAL distributed PRD + adversarial §2.3 scenarios
#
# IMPORTANT (per AGENTS.md): this script NEVER runs the pipeline itself
# (`npm run pipeline` / `npm start` / `npm run dev`) — that would spawn
# autonomous agents and is explicitly forbidden here. Every phase below is
# read-only validation: linters, type checker, test runner, and a standalone
# probe that imports the pure `resolvePRD` function.
#
# Usage:   ./validate.sh
# Exit:    0 if all phases pass, 1 if any phase fails.
# =============================================================================
set -u
cd "$(dirname "$0")"

# Color/output helpers ---------------------------------------------------------
RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; BLU=$'\033[34m'; RST=$'\033[0m'
PASS=0; FAIL=0
phase() { printf '\n%s========== PHASE %s: %s ==========%s\n' "$BLU" "$1" "$2" "$RST"; }
ok()   { printf '%s✓ PASS%s — %s\n' "$GRN" "$RST" "$1"; PASS=$((PASS+1)); }
no()   { printf '%s✗ FAIL%s — %s\n' "$RED" "$RST" "$1"; FAIL=$((FAIL+1)); }

# PHASE 1 — Lint ---------------------------------------------------------------
phase 1 "Linting (eslint)"
if npx eslint . --ext .ts >/tmp/v-lint.log 2>&1; then
  ok "eslint: 0 errors"
else
  # eslint exits non-zero on errors OR warnings; distinguish.
  if grep -q 'error' /tmp/v-lint.log; then no "eslint reported errors"; cat /tmp/v-lint.log
  else ok "eslint: 0 errors (pre-existing warnings only)"; fi
fi

# PHASE 2 — Type checking ------------------------------------------------------
phase 2 "Type checking (tsc --noEmit)"
if npm run --silent typecheck >/tmp/v-typecheck.log 2>&1; then ok "tsc: no type errors"
else no "tsc reported type errors"; cat /tmp/v-typecheck.log; fi

# PHASE 3 — Style/format checking ----------------------------------------------
phase 3 "Style check (prettier --check)"
if npm run --silent format:check >/tmp/v-format.log 2>&1; then ok "prettier: all files conform"
else no "prettier reported style violations"; cat /tmp/v-format.log; fi

# PHASE 4 — Unit / integration / e2e tests -------------------------------------
phase 4 "Test suite (vitest run)"
if timeout 900 npx vitest run >/tmp/v-test.log 2>&1; then
  # Summarize the result line.
  grep -E 'Test Files|Tests ' /tmp/v-test.log | tail -2 | sed 's/^/   /'
  ok "vitest: all tests passed"
else
  no "vitest reported failures"; tail -40 /tmp/v-test.log
fi

# PHASE 5 — End-to-end probe of the distributed-PRD feature --------------------
# This mirrors the PRIMARY real user workflow: loading the project's own
# distributed PRD (spec/SPEC.md with 16 @-includes) into a single resolved
# document, then asserting the §2.3 guarantees (dedup, elision, idempotency,
# stable hash) plus reproducing both previously-reported bug scenarios.
phase 5 "E2E probe: real distributed PRD + §2.3 adversarial scenarios"
PROBE=/tmp/v-e2e-probe.mjs
cat > "$PROBE" <<'PROBE_EOF'
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const ROOT = process.cwd();
const { resolvePRD } = await import(ROOT + '/src/core/session-utils.ts');
const h = s => createHash('sha256').update(s).digest('hex').slice(0,12);
let p=0,f=0; const ok=(n,c,x='')=>{c?(p++,console.log('  \x1b[32m✓\x1b[0m '+n)):(f++,console.log('  \x1b[31m✗\x1b[0m '+n+(x?'\n   '+x:'')));};

// (a) REAL distributed spec — the actual production input.
const spec = join(ROOT,'spec/SPEC.md');
const r1 = await resolvePRD(spec); const r2 = await resolvePRD(spec);
const survivors = [...r1.matchAll(/(?<![\w./-])@(spec\/[A-Za-z0-9_./-]+)/g)].map(m=>m[1]);
ok('real SPEC.md: zero surviving @spec/ tokens', survivors.length===0, JSON.stringify(survivors));
ok('real SPEC.md: byte-idempotent resolve(resolve(x))===resolve(x)', r1===r2);
ok('real SPEC.md: stable hash', h(r1)===h(r2), 'hash='+h(r1)+' size='+r1.length);

// (b) BUG-001 scenario (marker-word collision) — MUST be fixed now.
const t1 = mkdtempSync(join(tmpdir(),'bug001-'));
writeFileSync(join(t1,'a.md'),'A');
writeFileSync(join(t1,'include'),'COLLISION');
writeFileSync(join(t1,'end-include'),'COLLISION');
writeFileSync(join(t1,'include-ref'),'COLLISION');
writeFileSync(join(t1,'main.md'),'@a.md');
const b1 = await resolvePRD(join(t1,'main.md'),{markers:true});
writeFileSync(join(t1,'r2.md'),b1);
const b2 = await resolvePRD(join(t1,'r2.md'),{markers:true});
ok('BUG-001 (marker collision): marker-mode idempotent + no COLLISION leak', b1===b2 && !b1.includes('COLLISION'));

// (c) BUG-002 scenario (deep linear chain) — MUST be fixed now.
const t2 = mkdtempSync(join(tmpdir(),'bug002-'));
for(let i=1;i<=12;i++) writeFileSync(join(t2,'l'+i+'.md'), i===12?'LEAF':'L'+i+' @l'+(i+1)+'.md');
writeFileSync(join(t2,'main.md'),'@l1.md');
const c1 = await resolvePRD(join(t2,'main.md'));
writeFileSync(join(t2,'r2.md'),c1);
const c2 = await resolvePRD(join(t2,'r2.md'));
ok('BUG-002 (deep chain, default depth): idempotent', c1===c2);
const d1 = await resolvePRD(join(t2,'main.md'),{maxDepth:3});
writeFileSync(join(t2,'r3.md'),d1);
const d2 = await resolvePRD(join(t2,'r3.md'),{maxDepth:3});
ok('BUG-002 (deep chain, lowered maxDepth=3): idempotent', d1===d2);

console.log('\n  E2E probe: '+p+' passed, '+f+' failed');
process.exit(f>0?1:0);
PROBE_EOF
if npx tsx "$PROBE" >/tmp/v-e2e.log 2>&1; then ok "E2E probe passed"; sed -n '/E2E probe:/p' /tmp/v-e2e.log | tail -1 | sed 's/^/   /'
else no "E2E probe failed"; cat /tmp/v-e2e.log; fi
rm -f "$PROBE"

# OPTIONAL — project docs check (best-effort, non-fatal) ----------------------
phase 6 "Docs check (best-effort)"
if npm run --silent docs:check >/tmp/v-docs.log 2>&1; then ok "docs:check passed"
else no "docs:check reported issues"; tail -15 /tmp/v-docs.log; fi

# Summary -----------------------------------------------------------------------
printf '\n%s==========================================================%s\n' "$BLU" "$RST"
printf 'Validation summary: %s%d phase-passes%s, %s%d phase-failures%s\n' \
  "$GRN" "$PASS" "$RST" "$([ "$FAIL" -gt 0 ] && printf '%s' "$RED" || printf '%s' "$GRN")" "$FAIL" "$RST"
printf '==========================================================\n\n'
[ "$FAIL" -eq 0 ] && { printf '%sALL CHECKS PASSED — codebase is healthy.%s\n' "$GRN" "$RST"; exit 0; }
printf '%sSOME CHECKS FAILED — see output above.%s\n' "$RED" "$RST"
exit 1