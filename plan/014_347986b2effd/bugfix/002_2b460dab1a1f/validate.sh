#!/usr/bin/env bash
# =============================================================================
# validate.sh — Comprehensive validation for the Distributed-PRD Include-Dedup
# feature (PRD §2.3) and the broader codebase quality gates.
#
# Phases (only those that exist in this repo):
#   1. Lint           — eslint
#   2. Type checking  — tsc --noEmit
#   3. Style checking — prettier --check
#   4. Unit testing   — vitest (full suite)
#   5. E2E / behavioral — §2.3 runtime probes (BUG-001/002/003 + core contract)
#                         + real distributed-spec (spec/SPEC.md) resolution
#
# SAFETY: this script runs only read-only validation (lint/typecheck/tests/probes).
# It does NOT run the `hack` pipeline (which would spawn agents / create sessions
# and is explicitly forbidden by AGENTS.md). It writes nothing to the repo tree
# (probe artifacts go to $TMPDIR and are cleaned up).
#
# Usage:  ./validate.sh           (run all phases)
#         ./validate.sh --quick   (skip the full suite; run §2.3 tests + probes)
# =============================================================================
set -u
cd "$(dirname "$0")"

QUICK=0
[ "${1:-}" = "--quick" ] && QUICK=1

# Color helpers (optional; degrade gracefully if not a tty)
if [ -t 1 ]; then
  G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[1m'; N=$'\033[0m'
else
  G=''; R=''; Y=''; B=''; N=''
fi

PASS=0; WARN=0; FAIL=0
phase() { echo; echo "${B}━━━ Phase $1: $2 ${N}"; }
ok()    { echo "${G}✓ PASS${N} — $1"; PASS=$((PASS+1)); }
warn()  { echo "${Y}⚠ WARN${N} — $1"; WARN=$((WARN+1)); }
fail()  { echo "${R}✗ FAIL${N} — $1"; FAIL=$((FAIL+1)); }

# -----------------------------------------------------------------------------
# Phase 1 — Lint
# -----------------------------------------------------------------------------
phase 1 "Linting (eslint)"
if npm run --silent lint > /tmp/v_lint.log 2>&1; then
  # Distinguish clean pass from pass-with-warnings.
  if grep -q "warning" /tmp/v_lint.log; then
    wcount=$(grep -c "warning" /tmp/v_lint.log)
    warn "eslint passed with $wcount warning(s) (0 errors). See /tmp/v_lint.log"
  else
    ok "eslint: 0 errors, 0 warnings"
  fi
else
  fail "eslint reported errors"; tail -20 /tmp/v_lint.log
fi

# -----------------------------------------------------------------------------
# Phase 2 — Type checking
# -----------------------------------------------------------------------------
phase 2 "Type checking (tsc --noEmit)"
if npm run --silent typecheck > /tmp/v_tsc.log 2>&1; then
  ok "tsc --noEmit: no type errors"
else
  fail "tsc reported errors"; tail -20 /tmp/v_tsc.log
fi

# -----------------------------------------------------------------------------
# Phase 3 — Style checking
# -----------------------------------------------------------------------------
phase 3 "Style checking (prettier)"
if npm run --silent format:check > /tmp/v_fmt.log 2>&1; then
  ok "prettier --check: all files conform"
else
  fail "prettier found unformatted files"; tail -20 /tmp/v_fmt.log
fi

# -----------------------------------------------------------------------------
# Phase 4 — Unit testing
# -----------------------------------------------------------------------------
phase 4 "Unit testing (vitest)"
# §2.3-targeted suite is always run (fast, directly covers the feature under test).
echo "  → §2.3 include-dedup suite (prd-includes, prd-resolve, prd-markers)…"
if npx vitest run tests/unit/core/prd-includes.test.ts tests/unit/core/prd-resolve.test.ts tests/unit/core/prd-markers.test.ts > /tmp/v_t_s23.log 2>&1; then
  tcount=$(grep -oE '[0-9]+ (passed|failed|skipped)' /tmp/v_t_s23.log | tr '\n' ' ')
  ok "§2.3 suite passed ($tcount)"
else
  fail "§2.3 suite failed"; tail -25 /tmp/v_t_s23.log
fi

if [ "$QUICK" -eq 0 ]; then
  echo "  → full test suite (this takes a few minutes)…"
  if npm run --silent test:run > /tmp/v_test.log 2>&1; then
    tcount=$(grep -oE 'Tests +[0-9]+ passed( \| [0-9]+ skipped)?' /tmp/v_test.log | tail -1)
    ok "full suite: $tcount"
  else
    fail "full test suite reported failures"; tail -30 /tmp/v_test.log
  fi
else
  echo "  (--quick: full suite skipped)"
fi

# -----------------------------------------------------------------------------
# Phase 5 — E2E / behavioral probes for PRD §2.3
# -----------------------------------------------------------------------------
phase 5 "E2E behavioral probes (PRD §2.3 runtime verification)"
echo "  Independent runtime checks of dedup, idempotency, markers, stale-warnings, symlinks…"

PROBE="$(mktemp -d)/probe.ts"
cat > "$PROBE" <<'PROBE_EOF'
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePRD } from process.cwd() + '/src/core/session-utils.js';
const REPO = process.cwd();
let p=0,f=0;
const ck=(n,c,d='')=>{c?(p++,console.log('  ✓ '+n)):(f++,console.log('  ✗ '+n+(d?' — '+d:'')));};
const mk=()=>mkdtempSync(join(tmpdir(),'vp-'));
const w=(d,n,b)=>writeFileSync(join(d,n),b);
async function main(){
  // BUG-001 marker format
  {const d=mk();w(d,'a.md','A');w(d,'main.md','@a.md');
   const o=await resolvePRD(join(d,'main.md'),{markers:true});
   ck('BUG-001 @!include open marker',o.includes('<!-- @!include: a.md -->'),JSON.stringify(o));
   ck('BUG-001 @!end-include close marker',o.includes('<!-- @!end-include -->'));
   ck('BUG-001 NOT bare @include (collision-proof)',!/<!-- @include:/.test(o));
   // collision-proof with marker-word files + idempotent
   w(d,'include','X');w(d,'end-include','X');w(d,'include-ref','X');
   w(d,'main2.md','@a.md @a.md');
   const m1=await resolvePRD(join(d,'main2.md'),{markers:true});
   w(d,'r.md',m1);const m2=await resolvePRD(join(d,'r.md'),{markers:true});
   ck('BUG-001 markers idempotent w/ collision files',m1===m2);
   ck('BUG-001 no marker-word leak',!m1.includes('X'));
   rmSync(d,{recursive:true,force:true});}
  // BUG-002 stale .md at depth gate
  {const d=mk();w(d,'g.md','G @missing.md END');w(d,'main.md','@g.md');
   const ws=[];const o=console.warn;console.warn=(...a)=>void ws.push(String(a[0]));
   let out='';try{out=await resolvePRD(join(d,'main.md'),{maxDepth:1});}finally{console.warn=o;}
   const c=ws.filter(x=>x.includes('missing.md')).length;
   ck('BUG-002 exactly ONE stderr warning at gate',c===1,'got '+c);
   ck('BUG-002 stale token verbatim',out==='G @missing.md END',JSON.stringify(out));
   // deep chain at default depth
   w(d,'m.md','@f1.md');for(let i=1;i<=9;i++)w(d,'f'+i+'.md','@f'+(i+1)+'.md');w(d,'f10.md','D @stale.md END');
   const ws2=[];console.warn=(...a)=>void ws2.push(String(a[0]));try{await resolvePRD(join(d,'m.md'));}finally{console.warn=o;}
   ck('BUG-002 10-deep stale .md warns',ws2.some(x=>x.includes('stale.md')));
   rmSync(d,{recursive:true,force:true});}
  // BUG-003 symlink alias dedup
  {const d=mk();w(d,'real.md','REAL');symlinkSync(join(d,'real.md'),join(d,'alias.md'));w(d,'main.md','@real.md @alias.md');
   const o=await resolvePRD(join(d,'main.md'));const c=(o.match(/REAL/g)||[]).length;
   ck('BUG-003 symlink aliases expand ONCE',c===1,'REAL x'+c);
   rmSync(d,{recursive:true,force:true});}
  // CORE idempotency
  {const d=mk();w(d,'a.md','A');w(d,'b.md','B @a.md');w(d,'c.md','C');
   w(d,'main.md','@a.md @b.md @c.md @a.md @nonexist.md');
   const o=console.warn;console.warn=()=>{};
   const o1=await resolvePRD(join(d,'main.md'));w(d,'r.md',o1);const o2=await resolvePRD(join(d,'r.md'));console.warn=o;
   ck('CORE idempotent (markers off)',o1===o2);
   const m1=await resolvePRD(join(d,'main.md'),{markers:true});w(d,'m.md',m1);const m2=await resolvePRD(join(d,'m.md'),{markers:true});
   ck('CORE idempotent (markers on)',m1===m2);
   rmSync(d,{recursive:true,force:true});}
  // CORE diamond + cycles + blowup
  {const d=mk();w(d,'c.md','C');w(d,'a.md','A @c.md');w(d,'b.md','B @c.md');w(d,'main.md','@a.md @b.md');
   let o=await resolvePRD(join(d,'main.md'));ck('CORE diamond C once',(o.match(/C/g)||[]).length===1);
   w(d,'s.md','S @s.md');w(d,'m2.md','@s.md');o=await resolvePRD(join(d,'m2.md'));ck('CORE self-cycle terminates',o==='S ');
   w(d,'x.md','A @y.md @y.md');w(d,'y.md','B @x.md @x.md');w(d,'m3.md','@x.md');o=await resolvePRD(join(d,'m3.md'));
   ck('CORE no exponential blowup',(o.match(/A/g)||[]).length===1&&(o.match(/B/g)||[]).length===1);
   rmSync(d,{recursive:true,force:true});}
  // E2E real distributed spec (spec/SPEC.md) — production workflow
  {const SPEC=join(REPO,'spec/SPEC.md');
   const ws=[];const o=console.warn;console.warn=(...a)=>void ws.push(String(a[0]));
   const r=await resolvePRD(SPEC);console.warn=o;
   // 16 section files merged? (sum of bodies ≈ resolved minus wrapper)
   const has02=r.includes('Distributed (Multi-File) PRDs');
   const has16=r.includes('Validation Gate Semantics');
   ck('E2E real spec resolves (16 sections merged)',has02&&has16&&r.length>150000,'len='+r.length);
   const dd=mkdtempSync(join(tmpdir(),'e2e2-'));writeFileSync(join(dd,'r.md'),r);
   const r2=await resolvePRD(join(dd,'r.md'));ck('E2E real spec idempotent',r===r2);
   rmSync(dd,{recursive:true,force:true});
   // NOTE: 2 stale warnings from @path/to/file.md doc example are EXPECTED per §2.3.
   const stale=ws.filter(x=>x.includes('stale include'));
   ck('E2E warnings are only the spec doc-example token',ws.length===2&&stale.length===2,'ws='+JSON.stringify(ws));}
  console.log('\nPROBE: '+p+' passed, '+f+' failed');
  if(f>0)process.exit(1);
}
main().catch(e=>{console.error('PROBE THREW:',e);process.exit(2);});
PROBE_EOF

# Fix the resolvePRD import to use an absolute repo path (heredoc can't interpolate cleanly above).
sed -i "s#from process.cwd() + '/src/core/session-utils.js'#from '${PWD}/src/core/session-utils.js'#" "$PROBE"

if npx tsx "$PROBE" > /tmp/v_probe.log 2>&1; then
  ok "§2.3 behavioral probes all passed"
  grep -E "✓|✗|PROBE:" /tmp/v_probe.log | sed 's/^/  /'
else
  fail "§2.3 behavioral probes failed"
  cat /tmp/v_probe.log
fi
rm -rf "$(dirname "$PROBE")"

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo
echo "${B}════════════════════════════════════════${N}"
echo "${B} VALIDATION SUMMARY${N}"
echo "${B}════════════════════════════════════════${N}"
echo "  Passed:    ${G}${PASS}${N}"
echo "  Warnings:  ${Y}${WARN}${N}"
echo "  Failed:    ${R}${FAIL}${N}"
echo
if [ "$FAIL" -gt 0 ]; then
  echo "${R}❌ VALIDATION FAILED — see phase output above.${N}"
  exit 1
fi
echo "${G}✅ VALIDATION PASSED${N} (warnings are non-blocking)"
exit 0