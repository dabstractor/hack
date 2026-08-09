# PRP — P1.M1.T3.S1: Canonical `dedupKey` (realpathSync + lexical fallback) at all three visited-set sites

> Bugfix `002_2b460dab1a1f`, **BUG-003 (MINOR)**. PRD §2.3 dedup is "keyed on the resolved absolute path"
> with the intent "a file is expanded at most once." The visited set keys on the **lexical** `path.resolve`
> result, so two symlink aliases to the SAME physical file get distinct keys → the file expands twice
> (verified: `real.md='REAL'` + `alias.md`→symlink + `main.md='@real.md @alias.md'` → `'REAL REAL'`).
> **Fix: key all three visited sites on `realpathSync` (canonical) with a lexical fallback — ONLY the key
> changes; markers / stat / messages / recursion / elision output are UNCHANGED.** TDD: failing symlink-dedup
> test first → fix → green.

---

## Goal

**Feature Goal**: Introduce a private `dedupKey(abs)` helper (`realpathSync` with lexical fallback) in
`src/core/session-utils.ts` and apply it to **all three** visited-set keying sites — the elision `has`
check, the mark-visited `add`, and the `resolvePRD` entry pre-seed — so two symlink aliases to one
physical file dedup correctly (second reference elided; content appears once). No interface/signature
change to `expandIncludesRecursive` or `resolvePRD`; no change to marker tokens, stderr messages, stat
semantics, or elision output — ONLY the visited key. Update the two Mode-A JSDoc spots. Add a failing-
first symlink-dedup regression test.

**Deliverable**:
1. **`src/core/session-utils.ts`** — (a) `import { realpathSync } from 'node:fs';`; (b) the private
   `dedupKey(abs)` helper placed before `expandIncludesRecursive`; (c) the three keying-site edits
   (`visited.has(dedupKey(abs))`, `visited.add(dedupKey(abs))`, `new Set<string>([dedupKey(absEntry)])`);
   (d) the `@param visited` JSDoc + the `GLOBAL-FLAT-DEDUP` bullet reworded to "canonical (realpath-resolved)
   absolute path".
2. **`tests/unit/core/prd-resolve.test.ts`** — add `symlinkSync` to the `node:fs` import; add one
   `describe('resolvePRD — symlink-alias dedup (BUG-003, §2.3)')` block (REAL tmpdir; `real.md` + symlink
   `alias.md` + `main.md='@real.md @alias.md'` → `out === 'REAL '` and `out.split('REAL').length === 2`).

**Success Definition**:
- `resolvePRD` of `main.md='@real.md @alias.md'` (where `alias.md` symlinks to `real.md='REAL'`) returns
  `'REAL '` — `REAL` appears EXACTLY ONCE (the alias reference elides).
- The new test is RED before the source edit and GREEN after (TDD: RED → GREEN).
- All existing dedup tests stay GREEN: diamond, mutual-cycle, self-include, entry-back-edge, nested-chain,
  exponential-blowup guard (they assert dedup BEHAVIOR; for non-symlink files `realpathSync(abs)` === the
  normalized lexical `abs`, so behavior is unchanged).
- Markers (off AND on), stale-include warnings, stat error branches, recursion, idempotency — all UNCHANGED.
- `npm run test:run -- prd-resolve prd-markers` GREEN; `npm run typecheck` exit 0; `npm run lint` + `npm run format:check` clean.
- **No other files modified.** No interface/signature change.

## User Persona

N/A — internal resolver correctness. Indirect "users" are authors of distributed PRDs who symlink shared
sections (e.g. a `common/` spec symlinked into multiple section files) and expect the dedup guarantee
(each physical document expanded once) to hold across the aliases.

## Why

- **Spec intent (§2.3 — "a file expanded at most once").** The dedup guarantee is about the logical
  document, not the lexical path. Symlink aliases ARE the same document; keying lexically lets the content
  leak in twice. The canonical realpath key makes the guarantee hold for aliases.
- **Why all three sites, not one.** On macOS the system tmpdir is symlinked (`/var` → `/private/var`).
  Moving only some sites to `realpathSync` would mismatch keys ACROSS sites (entry pre-seeded under one
  form, recursive encounters under the other) and BREAK entry-back-edge / self-include elision. All three
  move together so the key is consistent everywhere — preserving every existing dedup test.
- **Low real-world impact, clean fix.** A 1-line helper + 3 one-token edits + 2 JSDoc touches. The one
  sync `realpath` syscall per encounter is acceptable (dedup bounds encounters to one per file; PRDs are
  small). Pure correctness hardening — no behavior change except alias dedup.
- **Scope discipline.** T3.S1 = the 3 keying sites + helper + 2 JSDoc + 1 test (THIS task). T2.S1 (parallel,
  BUG-002) = `neutralizeResolvableTokens` + the STALE-WARNING bullet — **disjoint lines/functions**. T1.S1
  (Complete, BUG-001) = `constants.ts` JSDoc — disjoint file. **Zero overlap.**

## What

### User-visible behavior
None at the API surface. The only observable change: two symlink aliases to one physical file now produce
single-expansion output (was: duplicated).

### Technical requirements (exact contract)

- **Import:** add `import { realpathSync } from 'node:fs';` (sync API — `node:fs`, NOT `node:fs/promises`;
  `stat` stays on `node:fs/promises`).
- **Helper:** `function dedupKey(abs: string): string` — `try { return realpathSync(abs); } catch { return abs; }`,
  placed immediately before `expandIncludesRecursive` (module-private; function-declaration hoisting makes
  it callable from `resolvePRD` below too). JSDoc per research §3b.
- **Three keying-site edits (ONLY the key argument changes):**
  - elision check: `if (visited.has(dedupKey(abs)))` (was `visited.has(abs)`, ~L505)
  - mark-visited: `visited.add(dedupKey(abs))` (was `visited.add(abs)`, ~L527)
  - entry pre-seed: `new Set<string>([dedupKey(absEntry)])` (was `new Set<string>([absEntry])`, ~L720)
- **Mode A JSDoc (2 spots):**
  - `@param visited` (~L468-469): state the key is the **canonical (realpath-resolved) absolute path,
    symlink-safe** (aliases to one physical file dedup); cross-link `dedupKey`.
  - resolvePRD `@remarks` GLOBAL-FLAT-DEDUP bullet (~L639-640): "keyed on the resolved absolute path" →
    "keyed on the canonical (realpath-resolved) absolute path, so symlink aliases to the same physical
    file dedup correctly".
- **DO NOT change:** marker tokens (`@!include` etc.), stderr messages, `stat` semantics, the recursion
  structure, elision output bytes, or any signature. ONLY the visited key + the 2 JSDoc clauses.
- **Test (failing-first):** add `symlinkSync` to the `node:fs` import; add one describe block —
  `real.md='REAL'`, `symlinkSync(real.md, alias.md)`, `main.md='@real.md @alias.md'` → `out === 'REAL '`
  AND `out.split('REAL').length === 2`. RED before the fix (`'REAL REAL'`), GREEN after.

### Success Criteria
- [ ] `dedupKey(abs)` helper added (realpathSync + lexical fallback) with the §3b JSDoc.
- [ ] All THREE keying sites use `dedupKey(...)` (has / add / entry pre-seed).
- [ ] `@param visited` + GLOBAL-FLAT-DEDUP bullet reworded to "canonical (realpath-resolved)".
- [ ] New symlink-dedup test RED before the source edit, GREEN after.
- [ ] Existing dedup tests (diamond/cycle/self-include/entry-back-edge/nested-chain/blowup-guard) GREEN.
- [ ] Markers, stale warnings, stat branches, recursion, idempotency UNCHANGED.
- [ ] `npm run test:run -- prd-resolve prd-markers` GREEN; `npm run typecheck` exit 0; `npm run lint` + `npm run format:check` clean.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes.** The exact
current import block, the three keying sites (with line numbers + the verbatim surrounding comments to
match), the ready-to-paste `dedupKey` helper + JSDoc, the two JSDoc rewordings, the macOS-symlink
all-three-sites invariant, the failing-first test (with the exact fixture + assertions + the RED/GREEN
reasoning), the disjoint-from-T2.S1 boundary, and the verified validation commands are all below.

### Documentation & References
```yaml
# MUST READ — ready-to-paste code + the 3 pinned sites + the macOS invariant + the failing-first test
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/P1M1T3S1/research/dedup-realpath-key.md
  section: "1. Verified current state", "2. The macOS-symlink invariant", "3. Ready-to-paste code", "4. The failing-first test", "5. Why existing dedup tests keep passing"
  why: Pins the exact 3 keying sites (L505/L527/L720) + the 2 JSDoc spots (L468-469/L639-640) + the import
        block; gives copy-ready dedupKey + JSDoc + the test; explains why ALL THREE sites must change
        together (macOS /var → /private/var) and why non-symlink tests are unaffected.
  critical: ALL THREE sites must use dedupKey — changing only some would mismatch keys across sites
        (entry pre-seed vs recursive encounters) and break entry-back-edge/self-include elision.

# MUST READ — the bug analysis (root cause + the 3-site fix + the parallelism/disjoint note)
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/architecture/bugfix_findings.md
  section: "BUG-003 — Symlink aliasing defeats global-flat dedup" + the parallelism note (~L170-174)
  why: Confirms the root cause (lexical key), the 3-site fix, and that BUG-002/BUG-003 edit DISJOINT
        regions of session-utils.ts (no line overlap with the parallel T2.S1).

# PARALLEL ITEM (read-only — confirm no conflict; do NOT implement its changes)
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/P1M1T2S1/PRP.md
  why: T2.S1 (BUG-002) edits neutralizeResolvableTokens + the resolvePRD STALE-WARNING bullet. This task
        edits the 3 keying sites + @param visited + the GLOBAL-FLAT-DEDUP bullet. Different lines → no conflict.

# AUTHORITATIVE SPEC — the dedup intent
- docfile: PRD.md   # (provided in selected_prd_content §2.3 / h3.2)
  section: §2.3 "No duplication (dedup)" — "keyed on the resolved absolute path", "a file expanded at most once"
  why: The dedup guarantee is about the logical document; symlink aliases ARE the same document.

# EDIT TARGET — the file being changed (read it; preserve everything except the key + 2 JSDoc clauses)
- file: src/core/session-utils.ts
  section: imports L28-41; elision check L505; mark-visited L527; entry pre-seed L720; @param visited L468-469; GLOBAL-FLAT-DEDUP bullet L639-640
  why: Add the import + dedupKey; change ONLY the 3 key arguments + the 2 JSDoc clauses.
  gotcha: Line numbers shift if the parallel T2.S1 lands first (it edits neutralizeResolvableTokens above
        L639). Match on the verbatim TEXT (visited.has(abs) / visited.add(abs) / new Set<string>([absEntry])),
        not line numbers. The 3 sites + 2 JSDoc clauses are unique strings in the file.

# TEST PATTERN — the test file being extended (REAL tmpdir; add symlinkSync; mirror the split().length idiom)
- file: tests/unit/core/prd-resolve.test.ts
  section: imports L27-33 (node:fs); tmp fixture L48; dedup describes L103 + L408; the "appears exactly once" idiom L417
  why: Add symlinkSync to the import; add ONE describe block reusing the file-level tmp; assert
        out === 'REAL ' and out.split('REAL').length === 2 (mirrors the existing diamond idiom at L417).
```

### Current Codebase tree (edit surface)

```bash
src/core/session-utils.ts            # EDIT: +realpathSync import; +dedupKey helper; 3 keying-site edits; 2 JSDoc edits
  ├─ imports (L28-41)                # + import { realpathSync } from 'node:fs';
  ├─ expandIncludesRecursive (~L425) # @param visited JSDoc (L468) → canonical key note
  │   ├─ if (visited.has(abs))       (~L505) → if (visited.has(dedupKey(abs)))
  │   └─ visited.add(abs)            (~L527) → visited.add(dedupKey(abs))
  ├─ dedupKey helper                 ← NEW (before expandIncludesRecursive)
  └─ resolvePRD (~L700)
      ├─ GLOBAL-FLAT-DEDUP bullet (L639-640) → "canonical (realpath-resolved) absolute path"
      └─ new Set<string>([absEntry]) (~L720) → new Set<string>([dedupKey(absEntry)])
tests/unit/core/prd-resolve.test.ts  # EDIT: +symlinkSync import; +1 symlink-alias dedup describe block
```

### Desired Codebase tree with files to be added/changed

```bash
src/core/session-utils.ts            # EDIT — import + dedupKey + 3 sites + 2 JSDoc
tests/unit/core/prd-resolve.test.ts  # EDIT — symlinkSync import + 1 failing-first→passing test
# (no new files)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL (all three sites): apply dedupKey to ALL of has(L505) + add(L527) + entry-pre-seed(L720).
//   Moving only some would mismatch keys across sites on macOS (tmpdir /var → /private/var symlink) and
//   BREAK entry-back-edge / self-include elision. Consistency across sites is the whole point.

// CRITICAL (only the key changes): do NOT touch marker tokens (@!include…), stderr messages, stat
//   semantics, the recursion structure, or elision output bytes. Markers/idempotency tests must stay green.

// GOTCHA (sync API): realpathSync comes from 'node:fs' (the SYNC module), NOT 'node:fs/promises'. The
//   existing `stat` stays on node:fs/promises. Add a SEPARATE import line.

// GOTCHA (line drift): the parallel T2.S1 edits neutralizeResolvableTokens (above L639), so line numbers
//   may shift. Match edits on the verbatim TEXT (visited.has(abs) / visited.add(abs) / new Set<string>([absEntry])),
//   which are unique in the file — not on line numbers.

// GOTCHA (fallback is safe): realpathSync throws on ENOENT → dedupKey returns the lexical abs. visited.add
//   only runs for existing files (post isFile) and the entry pre-seed is an existing file, so both take the
//   realpath branch; the fallback guards the elision has-check for not-yet-stat'd tokens (never in visited).

// GOTCHA (test platform): symlinkSync works on macOS/Linux (the primary dev platform). No guard needed;
//   if one is ever desired, skip the test when symlinkSync throws.
```

## Implementation Blueprint

### Data models and structure
No new data models. `dedupKey` is a module-private `(abs: string) => string` helper. `visited: Set<string>`
keeps its type; only the key value changes from lexical to canonical. No signature change to
`expandIncludesRecursive` or `resolvePRD`.

### Implementation Tasks (ordered by dependencies — TDD: test FIRST)

```yaml
Task 1: TEST (failing-first) — tests/unit/core/prd-resolve.test.ts
  - IMPORT: add symlinkSync to the existing `import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync } from 'node:fs';`.
  - ADD describe('resolvePRD — symlink-alias dedup (BUG-003, §2.3)') reusing the file-level tmp:
      writeFileSync(join(tmp,'real.md'),'REAL'); symlinkSync(join(tmp,'real.md'),join(tmp,'alias.md'));
      writeFileSync(join(tmp,'main.md'),'@real.md @alias.md');
      const out = await resolvePRD(join(tmp,'main.md'));
      expect(out).toBe('REAL '); expect(out.split('REAL').length).toBe(2);
  - COPY-READY in research §4. Run it → RED (out is 'REAL REAL').

Task 2: SOURCE — src/core/session-utils.ts
  - (a) IMPORT: add `import { realpathSync } from 'node:fs';` near the existing imports.
  - (b) HELPER: add `dedupKey(abs)` (realpathSync + lexical fallback) + its JSDoc, immediately before
        expandIncludesRecursive. COPY-READY in research §3b.
  - (c) 3 SITE EDITS (match on text, not line numbers):
        if (visited.has(abs))        → if (visited.has(dedupKey(abs)))
        visited.add(abs);            → visited.add(dedupKey(abs));
        new Set<string>([absEntry])  → new Set<string>([dedupKey(absEntry)])
  - (d) 2 JSDoc EDITS (Mode A): @param visited (L468-469) → canonical-key note; GLOBAL-FLAT-DEDUP bullet
        (L639-640) → "canonical (realpath-resolved) absolute path, so symlink aliases … dedup correctly".
  - DO NOT: change markers/messages/stat/recursion/elision output/signatures.

Task 3: VERIFY — the failing test now passes; existing tests unaffected
  - Re-run Task 1's test → GREEN (out === 'REAL ').
  - Run the full prd-resolve + prd-markers suites → all GREEN.
```

### Implementation Patterns & Key Details
```ts
// PATTERN: dedupKey — canonical key with lexical fallback (research §3b)
function dedupKey(abs: string): string {
  try {
    return realpathSync(abs);
  } catch {
    return abs; // ENOENT / not-yet-stat'd → lexical fallback (safe; see JSDoc)
  }
}

// PATTERN: the three site edits — ONLY the key argument changes
if (visited.has(dedupKey(abs))) { … }       // was: visited.has(abs)
visited.add(dedupKey(abs));                  // was: visited.add(abs)
new Set<string>([dedupKey(absEntry)]),       // was: new Set<string>([absEntry])

// GOTCHA (above): ALL THREE must change together (macOS /var → /private/var symlink). Do not change only some.
// GOTCHA (above): match edits on the verbatim text — line numbers may drift if T2.S1 lands first.
```

### Integration Points
```yaml
IMPORTS (src/core/session-utils.ts):
  - add: "import { realpathSync } from 'node:fs';"   # sync API; stat stays on node:fs/promises

NEW SYMBOL (src/core/session-utils.ts):
  - "function dedupKey(abs: string): string"   # module-private (NOT exported); hoisted → callable from resolvePRD

EDITS (3 keying sites + 2 JSDoc clauses — text-matched, not line-matched):
  - visited.has(abs) → visited.has(dedupKey(abs))
  - visited.add(abs) → visited.add(dedupKey(abs))
  - new Set<string>([absEntry]) → new Set<string>([dedupKey(absEntry)])
  - @param visited JSDoc + GLOBAL-FLAT-DEDUP bullet → "canonical (realpath-resolved) absolute path"

NONE OF: marker tokens, stderr messages, stat semantics, signatures, PRD.md, spec/**, **/tasks.json,
         prd_snapshot.md, neutralizeResolvableTokens (T2.S1), constants.ts (T1.S1).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run typecheck        # tsc --noEmit -p tsconfig.build.json — exit 0 (realpathSync import resolves; dedupKey typechecks)
npm run lint             # eslint . --ext .ts — clean
npm run format:check     # prettier --check — clean (run `npm run format` if it flags the new helper/test)
# Expected: zero errors.
```

### Level 2: Unit Tests (the PRIMARY gate — RED → GREEN)
```bash
npm run test:run -- prd-resolve prd-markers
# Expected: GREEN. The new 'symlink-alias dedup (BUG-003)' test passes (out === 'REAL '); ALL existing
#   dedup/marker/idempotency tests pass unchanged (non-symlink files: realpathSync(abs) === lexical abs).
# TDD check: BEFORE the source edit (Task 2), Task 1's test is RED (out === 'REAL REAL'); AFTER, GREEN.
```

### Level 3: Integration Testing (System Validation)
```bash
# Confirm no behavior change beyond alias dedup — spot-check the unaffected paths.
grep -n '@!include\|stale include\|neutralizeResolvableTokens' src/core/session-utils.ts | head   # markers/warn/gate UNCHANGED
git status --porcelain | grep -E '^\s*[AM]\s+(PRD\.md|spec/|.*tasks\.json|prd_snapshot|src/config/constants)' \
  && echo "VIOLATION: out-of-scope file touched" || echo "OK: only session-utils.ts + prd-resolve.test.ts touched"
# Expected: markers/warn/gate untouched; "OK: only session-utils.ts + prd-resolve.test.ts touched".
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Manual symlink-dedup proof (no agent call) against a throwaway tmpdir.
npx tsx -e "
import { mkdtempSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { resolvePRD } from './src/core/session-utils.js';
const t = mkdtempSync(join(tmpdir(), 'bug003-'));
writeFileSync(join(t,'real.md'),'REAL'); symlinkSync(join(t,'real.md'), join(t,'alias.md'));
writeFileSync(join(t,'main.md'),'@real.md @alias.md');
const out = await resolvePRD(join(t,'main.md'));
console.log(JSON.stringify({ out, count: out.split('REAL').length - 1 }));
"
# Expected: {"out":"REAL ","count":1}  (REAL appears exactly once — the alias elided).
```

## Final Validation Checklist

### Technical Validation
- [ ] Level 1 typecheck/lint/format:check clean.
- [ ] Level 2 `npm run test:run -- prd-resolve prd-markers` GREEN (new test RED→GREEN; existing unaffected).
- [ ] Level 3 only `session-utils.ts` + `prd-resolve.test.ts` touched; markers/warn/gate unchanged.
- [ ] Level 4 manual proof prints `{"out":"REAL ","count":1}`.

### Feature Validation
- [ ] `dedupKey(abs)` helper added (realpathSync + lexical fallback).
- [ ] All THREE keying sites use `dedupKey(...)` (has / add / entry pre-seed).
- [ ] Symlink aliases to one file dedup (content appears once); the new test proves it.
- [ ] Existing real-file dedup tests (diamond/cycle/self-include/entry-back-edge/nested-chain/blowup) GREEN.

### Code Quality Validation
- [ ] ONLY the visited key changes — markers/stat/messages/recursion/elision/signatures UNCHANGED.
- [ ] `@param visited` + GLOBAL-FLAT-DEDUP bullet reworded to "canonical (realpath-resolved)".
- [ ] Edit text-matched (not line-matched) so the parallel T2.S1's line drift can't break the apply.

### Documentation & Deployment
- [ ] No docs files in this task (Mode-B sweep is P1.M1.T4 — separate milestone).
- [ ] No env-var / config additions.

---

## Anti-Patterns to Avoid
- ❌ Don't change only one or two keying sites — ALL THREE must use `dedupKey` or macOS's symlinked tmpdir mismatches keys across sites and breaks entry-back-edge/self-include elision.
- ❌ Don't change anything except the key argument — markers (`@!include`), stderr messages, `stat` semantics, the recursion structure, elision output bytes, and the signatures are all UNCHANGED.
- ❌ Don't import `realpathSync` from `node:fs/promises` — it is a SYNC API on `node:fs`. Keep `stat` on `node:fs/promises`.
- ❌ Don't match edits on line numbers — the parallel T2.S1 edits `neutralizeResolvableTokens` (above the resolvePRD region) and may shift lines. Match on the verbatim text (`visited.has(abs)`, `visited.add(abs)`, `new Set<string>([absEntry])`), which is unique.
- ❌ Don't add a symlink-capability guard unless you document why — the primary dev platform (macOS/Linux) supports `symlinkSync`.
- ❌ Don't write the test AFTER the source — the contract is TDD (failing test FIRST → fix → green), which proves the fix is what makes it pass.
- ❌ Don't touch `neutralizeResolvableTokens` or the STALE-WARNING bullet — that's T2.S1 (parallel). Don't touch `constants.ts` — that's T1.S1 (Complete).
- ❌ Don't run the full TS test suite and treat unrelated pre-existing diagnostics as this task's failure — run the targeted `prd-resolve prd-markers` suites (Level 2).