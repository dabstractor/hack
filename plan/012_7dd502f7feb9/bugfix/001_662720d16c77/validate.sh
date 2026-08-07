#!/usr/bin/env bash
# =============================================================================
# validate.sh — Comprehensive validation for hacky-hack (PRP Pipeline)
# =============================================================================
# A pure READ-ONLY validator: it runs the project's own gates (lint, typecheck,
# format, tests, docs), checks the build artifact for staleness, and exercises
# real end-to-end user workflows (CLI smoke, distributed-PRD include expansion,
# .hack config loader, commit-style system, the §5.4 `hack update` command, and
# the §5.1 auto commit-style path) — all in THROWAWAY temp dirs, never touching
# this repo's source, plan/, or tasks.json.
#
# It does NOT modify source code, PRD.md, plan/, .gitignore, or any tasks.json.
# E2E write operations run only inside a fresh temp git repo under /tmp.
#
# Usage:   ./validate.sh
# Exit:    0 = all checks passed; 1 = one or more checks failed.
# =============================================================================
set -u
cd "$(dirname "$0")"

REPO="$(pwd)"
export REPO
PASS=0; FAIL=0; WARN=0
TMP="$(mktemp -d -t hack-validate-XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

# --- helpers -----------------------------------------------------------------
color() { printf '\033[%sm%s\033[0m' "$1" "$2"; }
section() { echo; color '1;36' "■ $1"; echo "────────────────────────────────────────────────────────"; }
ok()   { color '32' "  ✓ PASS"; echo ": $1"; PASS=$((PASS+1)); }
warn() { color '33' "  ! WARN"; echo ": $1"; WARN=$((WARN+1)); }
bad()  { color '31' "  ✗ FAIL"; echo ": $1"; FAIL=$((FAIL+1)); }
chk()  { if eval "$1" >/dev/null 2>&1; then ok "$2"; else bad "$2"; fi; }

# =============================================================================
# Phase 0 — Preflight
# =============================================================================
section "Phase 0 — Preflight"
node --version >/dev/null 2>&1 && ok "node available ($(node --version))" || bad "node not found"
[ -d node_modules ] && ok "node_modules installed" || { bad "node_modules missing — run: npm install"; exit 1; }
[ -x dist/index.js ] && ok "dist/index.js present (executable)" || warn "dist/index.js missing — build with: npm run build"
# Uncommitted source that postdates the last build → staleness (reported, not fixed).
if [ -x dist/index.js ]; then
  STALE="$(find src -name '*.ts' -newermt "$(stat -c%y dist/index.js)" | wc -l)"
  if [ "$STALE" -eq 0 ]; then ok "dist is up to date vs source"
  else warn "dist build is STALE: $STALE source file(s) newer than dist — run 'npm run build' (artifact is gitignored; rebuild fixes it)"; fi
fi

# =============================================================================
# Phase 1 — Lint
# =============================================================================
section "Phase 1 — Lint (eslint)"
if npm run lint >/tmp/lint.log 2>&1; then
  ok "eslint: 0 errors"
  W="$(grep -c 'warning' /tmp/lint.log || true)"
  [ "${W:-0}" -gt 0 ] && warn "eslint reported $W warning(s) (no-explicit-any is configured as warn, not error)"
else
  bad "eslint reported errors"; tail -20 /tmp/lint.log
fi

# =============================================================================
# Phase 2 — Type checking
# =============================================================================
section "Phase 2 — Type checking (tsc --noEmit)"
if npm run typecheck >/tmp/tsc.log 2>&1; then ok "tsc: 0 errors"
else bad "tsc reported errors"; tail -20 /tmp/tsc.log; fi

# =============================================================================
# Phase 3 — Format checking
# =============================================================================
section "Phase 3 — Format check (prettier)"
if npm run format:check >/tmp/fmt.log 2>&1; then ok "prettier: all files conform"
else bad "prettier found unformatted files"; tail -20 /tmp/fmt.log; fi

# =============================================================================
# Phase 4 — Unit + integration tests
# =============================================================================
section "Phase 4 — Tests (vitest run)"
if npm run test:run >/tmp/test.log 2>&1; then
  ok "vitest: all tests passed"
else
  bad "vitest: failures detected"; tail -40 /tmp/test.log
fi
# Targeted regression re-run for the §5.1 auto commit-style path (fast feedback).
if npx vitest run tests/integration/git-commit-generate.test.ts tests/integration/git-mcp-log.test.ts >/tmp/reg.log 2>&1; then
  ok "BUG-001 regression suite (real simple-git, LLM mocked) passed"
else bad "BUG-001 regression suite failed"; tail -30 /tmp/reg.log; fi

# =============================================================================
# Phase 5 — Docs consistency
# =============================================================================
section "Phase 5 — Docs consistency check"
if npm run docs:check >/tmp/docs.log 2>&1; then ok "docs:check passed"
else warn "docs:check reported issues (non-blocking)"; tail -15 /tmp/docs.log; fi

# =============================================================================
# Phase 6 — Shipped binary smoke (read-only, against THIS repo)
# =============================================================================
section "Phase 6 — Shipped binary smoke (dist)"
run_hack() { node "$REPO/dist/index.js" "$@"; }
if run_hack --version >/dev/null 2>&1; then ok "hack --version works ($(run_hack --version 2>/dev/null | head -1))"
else bad "hack --version failed"; fi
chk "run_hack --help 2>&1 | grep -q 'PRD to PRP Pipeline'" "hack --help shows program description"
chk "run_hack --help 2>&1 | grep -qw update" "hack --help lists the 'update' subcommand (§5.4)"
chk "run_hack --help 2>&1 | grep -qw status" "hack --help lists the 'status' alias (§5.3)"
# Config loader: verifies .hack parsing incl. the new pipeline.commit_style keys.
out="$(run_hack config show --src 2>/dev/null)"
echo "$out" | grep -q 'commit_style' && ok "config show surfaces pipeline.commit_style" || bad "config show missing commit_style"
echo "$out" | grep -q 'commit_style_examples' && ok "config show surfaces pipeline.commit_style_examples" || bad "config show missing commit_style_examples"
echo "$out" | grep -q 'spec/SPEC.md' && ok ".hack cli.prd points at distributed spec/SPEC.md" || warn "cli.prd not spec/SPEC.md"

# =============================================================================
# Phase 7 — Distributed-PRD include expansion (§2.3)
# =============================================================================
section "Phase 7 — Distributed-PRD include expansion (§2.3)"
cat > "$TMP/expand.mts" <<'TS'
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
const { resolvePRD } = await import(process.env.REPO + '/src/core/session-utils.ts');
const entry = process.env.REPO + '/spec/SPEC.md';
const expanded = await resolvePRD(entry);
const leftover = (expanded.match(/^@[\w-]+\.md$/gm) || []).length;
const idemTmp = mkdtempSync(join(tmpdir(), 'prd-idem-'));
writeFileSync(join(idemTmp,'SPEC.md'), expanded);
const reExpanded = await resolvePRD(join(idemTmp,'SPEC.md'));
const r = {
  len: expanded.length, leftover,
  has5_1: expanded.includes('Commit Message Style'),
  has5_4: expanded.includes('Manual Status Updates'),
  idempotent: reExpanded === expanded,
};
console.log('EXPAND_RESULT ' + JSON.stringify(r));
TS
REPO="$REPO" npx tsx "$TMP/expand.mts" 2>/dev/null | grep '^EXPAND_RESULT' | sed 's/EXPAND_RESULT //' > "$TMP/expand.out"
if [ -s "$TMP/expand.out" ]; then
  node -e "const fs=require('fs');const x=JSON.parse(fs.readFileSync('$TMP/expand.out','utf8'));
    console.log('  expanded length:',x.len,'| leftover includes:',x.leftover,'| §5.1:',x.has5_1,'| §5.4:',x.has5_4,'| idempotent:',x.idempotent);
    process.exit(x.leftover===0&&x.has5_1&&x.has5_4&&x.idempotent?0:1)" && ok "all @-includes expanded; §5.1/§5.4 present; resolvePRD idempotent" || bad "include expansion contract broken"
else bad "distributed-PRD expansion probe produced no result"; fi

# =============================================================================
# Phase 8 — Commit-style system-prompt builder (§5.1, all 4 modes)
# =============================================================================
section "Phase 8 — Commit-style system-prompt builder (§5.1: plain/conventional/gitmoji/auto)"
cat > "$TMP/style.mts" <<'TS'
const { buildCommitMessageSystemPrompt } = await import(process.env.REPO + '/src/agents/commit-message-agent.ts');
const ex = ['feat: add login','fix(parser): empty input','refactor: split module'];
const P = buildCommitMessageSystemPrompt('plain');
const C = buildCommitMessageSystemPrompt('conventional');
const G = buildCommitMessageSystemPrompt('gitmoji');
const A = buildCommitMessageSystemPrompt('auto', ex);
const AN = buildCommitMessageSystemPrompt('auto');
const r = {
  plain_imp:    /imperative/i.test(P) && /72/.test(P) && !/style examples|recent commit/i.test(P) && !/gitmoji/i.test(P),
  conv_contract:/type\(scope\)/.test(C) && /feat|fix|chore/.test(C) && !/style examples|recent commit/i.test(C),
  gitmoji_table:/gitmoji/i.test(G) && /\p{Extended_Pictographic}/u.test(G) && !/style examples|recent commit/i.test(G),
  auto_examples:A.includes('feat: add login'),
  auto_antireuse:/never copy|do not copy|do not reuse|anti-reuse|original wording/i.test(A),
  auto_ignores_prefix:/ignore|numeric position|position prefix|position marker/i.test(A),
  auto_noex_noexamples:!/style examples|recent commit/i.test(AN),
};
console.log('STYLE_RESULT ' + JSON.stringify(r));
TS
REPO="$REPO" npx tsx "$TMP/style.mts" 2>/dev/null | grep '^STYLE_RESULT' | sed 's/STYLE_RESULT //' > "$TMP/style.out"
if [ -s "$TMP/style.out" ]; then
  node -e "const x=JSON.parse(require('fs').readFileSync('$TMP/style.out','utf8'));const all=Object.values(x).every(Boolean);
    console.log('  plain:',x.plain_imp,'| conventional:',x.conv_contract,'| gitmoji:',x.gitmoji_table,'| auto(ex):',x.auto_examples,x.auto_antireuse,x.auto_ignores_prefix,'| auto(no-ex):',x.auto_noex_noexamples);
    process.exit(all?0:1)" && ok "all 4 commit-style modes build correct system prompts" || bad "commit-style builder contract broken"
else bad "commit-style probe produced no result"; fi

# =============================================================================
# Phase 9 — BUG-001 regression: real getRecentCommitMessages under DEFAULT config
# =============================================================================
section "Phase 9 — BUG-001 regression (auto style + real git, default config)"
cat > "$TMP/bug001.mts" <<'TS'
delete process.env.PRP_COMMIT_STYLE; delete process.env.PRP_COMMIT_STYLE_EXAMPLES;
const c = await import(process.env.REPO + '/src/config/constants.ts');
const g = await import(process.env.REPO + '/src/tools/git-mcp.ts');
// (dynamic imports already used below)
const style = c.getPrpCommitStyle(); const n = c.getPrpCommitStyleExamples();
let threw = false, cnt = -1;
try { const m = await g.getRecentCommitMessages(n); cnt = m.length; } catch { threw = true; }
console.log('BUG001_RESULT ' + JSON.stringify({ style, n, threw, cnt }));
TS
REPO="$REPO" npx tsx "$TMP/bug001.mts" 2>/dev/null | grep '^BUG001_RESULT' | sed 's/BUG001_RESULT //' > "$TMP/bug001.out"
if [ -s "$TMP/bug001.out" ]; then
  node -e "const x=JSON.parse(require('fs').readFileSync('$TMP/bug001.out','utf8'));
    console.log('  style='+x.style+' n='+x.n+' threw='+x.threw+' returned='+x.cnt);
    process.exit(!x.threw && x.style==='auto' && x.n===5 && x.cnt>0?0:1)" && ok "default auto config fetches real history without throwing (BUG-001 fixed)" || bad "auto path still throws — BUG-001 regressed"
else bad "BUG-001 probe produced no result"; fi

# =============================================================================
# Phase 10 — `hack update` E2E (§5.4) in a THROWAWAY git repo
# =============================================================================
section "Phase 10 — hack update E2E (§5.4) in throwaway repo"
E2E="$(mktemp -d -t hack-update-e2e-XXXXXX)"
( cd "$E2E" && git init -q && git config user.email t@t.t && git config user.name t && git commit -q --allow-empty -m init )
# Reuse a REAL valid context_scope from an existing session so the schema validator passes.
node -e "
const CS=require('fs').readFileSync(process.env.REPO+'/plan/001_14b9dc2a33c7/tasks.json','utf8');
const t=JSON.parse(CS);const cs=t.backlog[0].milestones[0].tasks[0].subtasks[0].context_scope;
const sub=(id,ti)=>({type:'Subtask',id,title:ti,status:'Planned',story_points:1,dependencies:[],context_scope:cs});
const task=(id,ti,s)=>({type:'Task',id,title:ti,status:'Planned',description:id,subtasks:s});
const ms=(id,ti,t)=>({type:'Milestone',id,title:ti,status:'Planned',description:id,tasks:t});
const ph=(id,ti,m)=>({type:'Phase',id,title:ti,status:'Planned',description:id,milestones:m});
const b={backlog:[ph('P1','P1',[ms('P1.M1','M1',[task('P1.M1.T1','T1',[sub('P1.M1.T1.S1','S1'),sub('P1.M1.T1.S2','S2')])]),ms('P1.M2','M2',[task('P1.M2.T1','T1b',[sub('P1.M2.T1.S1','S1b')])])]),ph('P2','P2',[ms('P2.M1','M1b',[task('P2.M1.T1','T1c',[sub('P2.M1.T1.S1','S1c')])])])]};
require('fs').writeFileSync('$E2E/tasks.json',JSON.stringify(b,null,2));
"
TF="$E2E/tasks.json"
upd() { ( cd "$E2E" && node "$REPO/dist/index.js" update "$@" --file "$TF" >/dev/null 2>&1 ); }
q()   { node -e "const t=require('$TF');$1" 2>/dev/null; }

upd p1m1t1s1 re
q "process.exit(t.backlog[0].milestones[0].tasks[0].subtasks[0].status==='Ready'?0:1)" && ok "loose concat id + synonym status: p1m1t1s1 re → Ready" || bad "loose-id/synonym update failed"
upd 1.1.1.2 done
q "const tk=t.backlog[0].milestones[0].tasks[0];process.exit(tk.subtasks[1].status==='Complete'&&tk.status==='Ready'?0:1)" && ok "numeric id + synonym done: S2→Complete, ancestor T1 recompute→Ready" || bad "ancestor recompute failed"
upd 1 done
q "const p=t.backlog[0];const a=[p,...p.milestones,...p.milestones.flatMap(m=>m.tasks),...p.milestones.flatMap(m=>m.tasks.flatMap(x=>x.subtasks))];process.exit(a.every(x=>x.status==='Complete')?0:1)" && ok "downward cascade: update 1 done → all P1 Complete" || bad "downward cascade failed"
upd P1.M1.T1.S1 p
q "const tk=t.backlog[0].milestones[0].tasks[0];process.exit(tk.subtasks[0].status==='Planned'&&tk.status==='Planned'?0:1)" && ok "downgrade: reset S1→Planned drops T1→Planned" || bad "downgrade recompute failed"
q "JSON.parse(require('fs').readFileSync('$TF','utf8'));process.exit(0)" && ok "atomic write: tasks.json remains valid JSON" || bad "tasks.json corrupted"
q "const fs=require('fs');process.exit(fs.readdirSync('$E2E').filter(f=>/\.tmp$|\.bak$/i.test(f)).length===0?0:1)" && ok "atomic write: no leftover temp/bak files" || bad "leftover temp files detected"

# Error paths — must exit non-zero with a clear message.
upd 9.9.9.9 done; [ $? -ne 0 ] && ok "error: unknown id exits non-zero" || bad "unknown id did not exit non-zero"
( cd "$E2E" && node "$REPO/dist/index.js" update 1.1.1.1 r --file "$TF" 2>&1 | grep -qi 'ambig' ) && ok "error: ambiguous status 'r' lists candidates" || bad "ambiguous status message missing"
( cd "$E2E" && node "$REPO/dist/index.js" update 1.1.1.1 bogus --file "$TF" 2>&1 | grep -qi 'valid status' ) && ok "error: unknown status lists valid statuses" || bad "unknown-status message missing"
( cd "$E2E" && node "$REPO/dist/index.js" update 1.1.1.1 retrying --file "$TF" 2>&1 | grep -qi 'valid status' ) && ok "error: Retrying is non-settable (excluded from matchable set)" || bad "Retrying accepted as settable"
rm -rf "$E2E"

# =============================================================================
# Phase 11 — .hack loader validation for new pipeline keys (out-of-range/type)
# =============================================================================
section "Phase 11 — .hack loader validation (new pipeline keys)"
CFG="$(mktemp -d -t hack-cfg-XXXXXX)"; ( cd "$CFG" && git init -q && git config user.email t@t.t && git config user.name t && git commit -q --allow-empty -m i )
printf '[pipeline]\ncommit_style = "bogus"\n' > "$CFG/.hack"
( cd "$CFG" && node "$REPO/dist/index.js" config show 2>&1 | grep -qi 'not one of the accepted' ) && ok "rejects invalid commit_style enum" || bad "invalid commit_style accepted"
printf '[pipeline]\ncommit_style_examples = -3\n' > "$CFG/.hack"
( cd "$CFG" && node "$REPO/dist/index.js" config show 2>&1 | grep -qi 'out of range' ) && ok "rejects out-of-range examples (<0)" || bad "negative examples accepted"
printf '[pipeline]\ncommit_style_examples = "lots"\n' > "$CFG/.hack"
( cd "$CFG" && node "$REPO/dist/index.js" config show 2>&1 | grep -qi 'expected integer' ) && ok "rejects type-mismatch examples (string for int)" || bad "type mismatch accepted"
printf '[pipeline]\ncommit_style = "conventional"\ncommit_style_examples = 7\n' > "$CFG/.hack"
( cd "$CFG" && node "$REPO/dist/index.js" config show --src 2>/dev/null | grep -q 'conventional' ) && ok "accepts valid explicit style + examples" || bad "valid config rejected"
rm -rf "$CFG"

# =============================================================================
# Summary
# =============================================================================
section "VALIDATION SUMMARY"
echo "  PASS: $PASS    WARN: $WARN    FAIL: $FAIL"
echo
if [ "$FAIL" -eq 0 ]; then color '32' "✅ ALL GATES PASSED — codebase validated end-to-end."; echo
else color '31' "❌ $FAIL CHECK(S) FAILED — see details above."; echo; fi
[ "$FAIL" -eq 0 ]