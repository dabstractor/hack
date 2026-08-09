# PRP — P1.M1.T1.S1: Rewrite `expandIncludesRecursive`: shared visited set + elision on second encounter

> Implements PRD §2.3 "No duplication (dedup)" — changes the include resolver from per-branch
> ancestry/cycle-detection to **global flat dedup with elision**. A file is expanded at most once
> across the whole resolution; subsequent references are elided (dropped, or a non-resolvable
> reference comment when markers are on). S1 = the `expandIncludesRecursive` rewrite + its JSDoc.
> The other two functions' JSDoc is S2; the test rewrites are P1.M1.T2.

---

## Goal

**Feature Goal**: Convert `expandIncludesRecursive`'s `visited` set from a per-branch ancestry set
(copied on each descent; diamonds expand in both branches; back-edges left literal) to a single
**global flat dedup set** (shared by reference; marked before descent; first encounter expands,
subsequent references **elided**), so a diamond dependency (A→C and B→C) injects C exactly once
and the resolved document is an idempotent fixed point (`resolve(resolve(x)) === resolve(x)`).

**Deliverable**: `src/core/session-utils.ts` `expandIncludesRecursive` (private, ~line 448) with
three changes — (a) shared-set dedup (no copy, mark-before-descent), (b) elision on second
encounter (drop, or `<!-- @include-ref -->` when markers on), (c) first-encounter unchanged —
plus a rewritten JSDoc on that function and updated inline comments at the two change sites.

**Success Definition**:
- A diamond (entry→A→C and entry→B→C) resolves C exactly once; the second `@C` reference is elided.
- With markers off, the second reference emits nothing; with markers on, it emits a stable
  `<!-- @include-ref: <token> -->` comment that contains no resolvable `@token`.
- Elision never triggers the stale-include stderr warning (it's a successful resolution, not stale).
- `resolve(resolve(x)) === resolve(x)` (fixed point) for diamond/cyclic fixtures.
- The `depth >= maxDepth` gate, stat/isFile/ENOENT/error handling, stale-warning condition, and
  EXPANDED-body marker format are byte-for-byte unchanged.
- `npm run typecheck && npm run lint && npm run format:check` clean.
- The `expandIncludesRecursive` JSDoc describes global-flat-dedup + elision (citing §2.3), not the
  old per-branch ancestry model.

---

## Why

- **Correctness + termination (PRD §2.3).** Without global dedup, a densely cross-referenced spec
  (section files that mutually `@`-reference) expands exponentially with depth until it overflows
  the runtime's max string length and crashes mid-pipeline. A single flat visited set bounds
  recursion: each file is imported at most once, so cycles and diamonds terminate without relying
  on `maxDepth`.
- **Idempotency = hash/snapshot/delta consistency (§4.1, §4.3).** Re-resolving the resolved
  document must yield identical bytes. A verbatim survivor (`out += m[0]`) would re-expand on a
  second pass and break the fixed point. Elision (drop, or a non-resolvable comment) leaves nothing
  resolvable — the resolved document is a fixed point. This is the property that guarantees
  hash/snapshot/delta consistency.
- **Mirrors the proven `pi-file-injector` model** (§2.3): "each absolute path is injected at most
  once across the whole prompt."
- **Scope discipline.** S1 = `expandIncludesRecursive` + its JSDoc ONLY. The `resolvePRD` /
  `resolveIncludes` JSDoc is S2; the test rewrites (the diamond/cycle/idempotency cases that assert
  the OLD behavior) are P1.M1.T2.

---

## What

### User-visible behavior
None directly (internal resolver). Indirectly: a split PRD with diamond/mutual includes now resolves
to a smaller, deduplicated canonical document that is a fixed point under re-resolution.

### Technical requirements (exact contract)

**File:** `src/core/session-utils.ts`, `expandIncludesRecursive` (~line 448). Three changes:

**(a) DEDUP, NOT ANCESTRY** (the success path, ~line 481):
```ts
// BEFORE:
const childVisited = new Set(visited).add(abs);
replacement = await expandIncludesRecursive(child, baseDir, maxDepth, depth + 1, childVisited, markers);

// AFTER:
visited.add(abs);   // GLOBAL FLAT DEDUP: mark THIS file visited BEFORE descending, in the SHARED set (no copy)
replacement = await expandIncludesRecursive(child, baseDir, maxDepth, depth + 1, visited, markers);
```

**(b) ELIDE ON SECOND ENCOUNTER** (the `visited.has(abs)` branch, ~line 469):
```ts
// BEFORE:
if (visited.has(abs)) {
  out += m[0];                  // CYCLE — leave back-edge literal, silent
  last = idx + m[0].length;
  continue;
}

// AFTER:
if (visited.has(abs)) {
  // Second-or-later encounter (PRD §2.3 global-flat-dedup): first encounter already expanded
  // this file. ELIDE — drop the @token entirely (markers off) or emit a non-resolvable reference
  // comment (markers on). Elision is a SUCCESSFUL resolution → no stale-include warning.
  if (markers) {
    out += `<!-- @include-ref: ${token} -->`;
  }
  // markers === false → emit nothing (elide entirely)
  last = idx + m[0].length;
  continue;   // skips the stale-warning + marker-wrap below (those apply to first-encounter only)
}
```

**(c) FIRST ENCOUNTER** — no code change; falls out of (a). The first textual occurrence passes the
`visited.has(abs)` check (false), stats/reads, `visited.add(abs)`, recurses, marker-wraps as today.

**KEEP UNCHANGED:** the `depth >= maxDepth` gate (now defense-in-depth only — dedup bounds recursion),
the `stat`/`isFile`/ENOENT/`SessionFileError` handling, the stale-include warning condition
(`replacement === undefined && token.endsWith('.md')`), and the EXPANDED-body marker format
(`<!-- @include: ${token} -->` / `<!-- @end-include -->`).

**JSDoc (Mode A — rewrite the `expandIncludesRecursive` JSDoc, ~lines 417-447):** the current JSDoc
endorses the old model ("PATH-BASED per-branch ancestry", "diamond includes expand c in BOTH
branches", "A flat/global set would wrongly deduplicate diamonds" — all now WRONG). Rewrite to
describe global-flat-dedup + elision: shared set passed by reference, marked before descent,
first-encounter-wins in document order, subsequent references elided (dropped or
`<!-- @include-ref -->` when markers on), elision emits no stale warning, maxDepth is now
defense-in-depth. Cite PRD §2.3. Also update the two inline comments (the former `new Set(visited)`
site → "global flat dedup"; the `visited.has(abs)` branch → "second encounter: ELIDE").

### Success Criteria
- [ ] Line ~481: `visited.add(abs)` (no copy) + recursive call passes `visited` (shared).
- [ ] Line ~469: `visited.has(abs)` branch ELIDES (markers off → nothing; markers on → `<!-- @include-ref: ${token} -->`).
- [ ] Elision `continue`s before the stale-warning check (no stale warning for elided tokens).
- [ ] `depth >= maxDepth` gate, stat/isFile/ENOENT/error handling, stale-warning condition, EXPANDED-body marker format unchanged.
- [ ] `expandIncludesRecursive` JSDoc rewritten (global-flat-dedup + elision, §2.3).
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — the exact current code (with line numbers), the verbatim before/after
for both change sites, the JSDoc-rewrite target, the elision-idempotency rationale, the expected
transient test failures (owned by P1.M1.T2), and the executable validation commands are all below.

### Documentation & References

```yaml
# MUST READ — the single-file change-site map + JSDoc-rewrite table
- docfile: plan/014_347986b2effd/architecture/system_context.md
  section: "Change Site (Single File)" → expandIncludesRecursive
  why: Confirms the exact current behavior (new Set(visited).add(abs) copy; visited.has → out += m[0]
        literal), the three-change contract, what to KEEP unchanged, and the JSDoc-rewrite target.
  critical: S1 owns ONLY expandIncludesRecursive + its JSDoc. resolvePRD/resolveIncludes JSDoc = S2.
        Test rewrites = P1.M1.T2. The existing tests assert the OLD behavior and WILL FAIL after S1.

# MUST READ — verbatim before/after + elision rationale + expected test failures (authored with this PRP)
- docfile: plan/014_347986b2effd/P1M1T1S1/research/dedup-elision-rewrite.md
  section: "2. The three changes" and "5. ⚠️ EXPECTED transient test failures"
  why: Ready-to-paste before/after for both change sites, the elision-idempotency argument, and the
        named tests that will fail (prd-resolve.test.ts diamond L135 + cycle-literal L101/110/124).

# PATTERN FILE — the only file edited
- file: src/core/session-utils.ts
  why: expandIncludesRecursive at ~L448-510. Change site (a) ~L481 (new Set→visited.add + shared pass);
        change site (b) ~L469 (out += m[0] → elision). JSDoc ~L417-447.
  pattern: "const childVisited = new Set(visited).add(abs); … expandIncludesRecursive(…, childVisited, …)"
  gotcha: The `continue` in the elision branch MUST stay — it skips the stale-warning + marker-wrap
        below (those apply to first-encounter expansions only). Without it, elision would wrongly
        trigger the stale-include warning.

# VERIFIED FACTS
- fact: "resolvePRD (~L585) seeds `new Set<string>([absEntry])` — KEEP this (entry self-ref elides). No change to resolvePRD in S1."
- fact: "RESOLVE_TOKEN regex + boundary rules are UNCHANGED — the `<!-- @include-ref: token -->` comment's path is NOT preceded by @, so it won't match on re-scan (idempotent)."
- fact: "Elision is a SUCCESSFUL resolution (the file exists + was expanded on first encounter), so it MUST NOT trigger the stale-include warning (which fires only when replacement === undefined). The elision branch `continue`s before that check."
- fact: "Existing tests asserting OLD behavior: prd-resolve.test.ts L135 (diamond → 2 S's), L101/110/124 (cycle back-edge literal). These WILL FAIL after S1 — owned by P1.M1.T2."

# TEST FILES (do NOT edit in S1 — P1.M1.T2 owns the rewrites)
- file: tests/unit/core/prd-resolve.test.ts
  why: L135 asserts diamond expands in BOTH branches (2 S's) — now dedups to 1. L101/110/124 assert
        cycle back-edges stay literal — now elided. These FAIL after S1; P1.M1.T2.S1 rewrites them.
- file: tests/unit/core/prd-markers.test.ts
  why: L137/166/177 (cycle-no-warn, idempotency) may need adjustment for elision. P1.M1.T2 owns it.
```

### Current Codebase tree (relevant slice)

```bash
src/core/session-utils.ts             # EDIT — expandIncludesRecursive (3 changes) + its JSDoc + 2 inline comments
tests/unit/core/prd-resolve.test.ts   # READ-ONLY in S1 (diamond/cycle tests will fail; P1.M1.T2 rewrites)
tests/unit/core/prd-markers.test.ts   # READ-ONLY in S1 (P1.M1.T2)
```

### Desired Codebase tree with files to be added/edited

```bash
src/core/session-utils.ts             # MODIFIED (expandIncludesRecursive body + JSDoc + comments)
# No other files. No resolvePRD/resolveIncludes JSDoc (S2). No test edits (P1.M1.T2).
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — the elision branch MUST `continue` BEFORE the stale-warning + marker-wrap code below.
//   Elision is a SUCCESSFUL resolution (file exists, was expanded on first encounter) — it must NOT
//   trigger the stale-include warning (which fires when replacement === undefined). The `continue`
//   skips both. Do NOT remove it or fall through.

// CRITICAL — `visited.add(abs)` goes INSIDE the `if (st.isFile())` block, BEFORE the recursive call
//   (mark THIS file visited before descending into its content). A directory/ENOENT is NOT imported →
//   do NOT add it to visited (a later reference to the same missing path stays literal independently).

// CRITICAL — pass the SAME `visited` set (by reference) to the recursive call. Do NOT create a new
//   Set. The whole point is one global flat set shared across the document. (Old code copied it per
//   descent → diamonds expanded twice. That copy is the bug.)

// CRITICAL — elision must NOT echo m[0] (the @token). markers off → emit NOTHING; markers on → emit
//   `<!-- @include-ref: ${token} -->`. A verbatim survivor would re-expand on re-resolution and break
//   idempotency (PRD §2.3: "Elision — not verbatim — is mandatory").

// GOTCHA — the `<!-- @include-ref: token -->` comment is idempotent because its path is inside an
//   HTML comment, NOT preceded by @ → RESOLVE_TOKEN won't match it on re-scan. Do NOT use a form
//   that contains a resolvable @token.

// GOTCHA — S1 owns ONLY expandIncludesRecursive's JSDoc. The resolvePRD + resolveIncludes JSDoc
//   also describe the old model but are S2's scope. Don't touch them here.

// GOTCHA — the existing prd-resolve.test.ts diamond test (L135) and cycle-literal tests (L101/110/124)
//   WILL FAIL after S1 (they assert the old per-branch behavior). This is EXPECTED — P1.M1.T2 rewrites
//   them. S1's gate is NOT "test suite green"; it's typecheck + lint + the empirical diamond smoke.

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check.

// GOTCHA — vitest 100% coverage on src/**/*.ts is unaffected by a control-flow change inside an
//   existing function (no new lines/branches beyond what the loop already had — the elision branch
//   replaces the literal branch). But confirm no new uncovered branch after the change.
```

---

## Implementation Blueprint

### Data models and structure
None — a control-flow + mutation-pattern change inside one existing function. No types/constants.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/core/session-utils.ts — change (a) shared-set dedup
  - LOCATE: the success path ~L481 (`const childVisited = new Set(visited).add(abs);`).
  - CHANGE: replace the copy with `visited.add(abs);` and pass `visited` (not childVisited) to the
        recursive `expandIncludesRecursive(...)` call.
  - UPDATE the inline comment: "global flat dedup: mark visited before descending in the SHARED set"
        (was "PATH-BASED ancestry: copy the set so sibling branches each get their own chain").
  - KEEP `visited.add(abs)` INSIDE the `if (st.isFile())` block, before the recursive call.

Task 2: EDIT src/core/session-utils.ts — change (b) elision on second encounter
  - LOCATE: the `visited.has(abs)` branch ~L469.
  - CHANGE: replace `out += m[0];` with elision:
        if (markers) { out += `<!-- @include-ref: ${token} -->`; }
        // markers === false → emit nothing
  - KEEP `last = idx + m[0].length; continue;` (the continue skips the stale-warning + marker-wrap).
  - UPDATE the inline comment: "second encounter: ELIDE (global-flat-dedup, PRD §2.3)" (was "CYCLE").

Task 3: EDIT src/core/session-utils.ts — rewrite the expandIncludesRecursive JSDoc (~L417-447)
  - REWRITE to describe: global flat dedup (shared set passed by reference, marked before descent);
        first-encounter-wins in document order; subsequent references ELIDED (dropped, or
        `<!-- @include-ref -->` when markers on); elision emits no stale warning; maxDepth is now
        defense-in-depth (dedup bounds recursion). Cite PRD §2.3.
  - REMOVE the now-WRONG claims: "PATH-BASED per-branch ancestry", "diamond includes expand c in
        BOTH branches", "A flat/global set would wrongly deduplicate diamonds", "cycle check —
        back-edge @token left literal".
  - DO NOT touch resolvePRD's or resolveIncludes's JSDoc (S2).

Task 4: FORMAT + VERIFY (do NOT run the test suite as a green-gate)
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN (empirical diamond smoke — the real S1 proof): build a tmpdir with main→A→C + main→B→C,
        resolvePRD, assert C's body appears EXACTLY ONCE; with markers=true, the second ref emits
        `<!-- @include-ref: c.md -->` and C's body still appears once.
  - OPTIONAL (confirm expected failures, NOT a gate): npx vitest run tests/unit/core/prd-resolve.test.ts
        → the diamond test (L135) + cycle-literal tests (L101/110/124) FAIL (owned by P1.M1.T2).
  - DO NOT edit any test in S1.
```

### Implementation Patterns & Key Details

```ts
// PATTERN — change (a): shared-set dedup (no copy; mark before descent; pass same set).
if (st.isFile()) {
  const child = await readUTF8FileStrict(abs, 'read include');
  visited.add(abs);   // GLOBAL FLAT DEDUP — mark THIS file before descending, in the SHARED set
  replacement = await expandIncludesRecursive(
    child, baseDir, maxDepth, depth + 1, visited, markers   // SAME set by reference (no copy)
  );
}

// PATTERN — change (b): elision on second encounter (drop, or non-resolvable ref comment).
if (visited.has(abs)) {
  // Second-or-later encounter (PRD §2.3): first encounter already expanded this file. ELIDE.
  if (markers) {
    out += `<!-- @include-ref: ${token} -->`;   // stable ref; no resolvable @token → idempotent
  }
  // markers === false → emit nothing (elide entirely)
  last = idx + m[0].length;
  continue;   // skips stale-warning + marker-wrap (first-encounter-only code below)
}

// PATTERN — the empirical diamond smoke (real S1 proof, since the unit tests assert old behavior).
//   main.md: "@a.md @b.md"; a.md: "A(@c.md)"; b.md: "B(@c.md)"; c.md: "C".
//   resolvePRD(main) → "A(C)B()" with markers off (C once; second @c elided → empty between B parens),
//   or "A(C)B(<!-- @include-ref: c.md -->)" with markers on. C's body appears EXACTLY ONCE either way.
```

### Integration Points

```yaml
NO DOWNSTREAM CHANGES: all consumers (hashPRD, snapshotPRD, SessionManager, PRPPipeline, prd-selector)
  call resolvePRD() and read its output verbatim. The resolved document becomes SMALLER (deduplicated)
  but remains a valid merged document. No consumer parses @include-ref comments (they're for human
  readability when markers on). The idempotency fixed point is what guarantees hash/snapshot/delta
  consistency (§4.1, §4.3).

SIBLING SUBTASKS (do NOT do them here):
  - P1.M1.T1.S2: rewrite the resolvePRD + resolveIncludes JSDoc to match the new dedup model.
  - P1.M1.T2.S1: rewrite the existing diamond/cycle tests (prd-resolve.test.ts) to assert dedup + elision.
  - P1.M1.T2.S2: add new invariant tests (idempotency fixed point, exponential-blowup guard, marker
        reference comment, diamond dedup).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint && npm run format:check   # clean
# Expected: clean. A control-flow change inside an existing function cannot introduce type errors.
```

### Level 2: Unit Tests (NOT a green-gate for S1 — expected failures owned by P1.M1.T2)

```bash
# DO NOT treat as S1's pass/fail gate — the diamond + cycle-literal tests assert the OLD behavior:
npx vitest run tests/unit/core/prd-resolve.test.ts
# Expected: the diamond test (L135) + cycle-literal tests (L101/110/124) FAIL. This is EXPECTED —
# P1.M1.T2.S1 rewrites them. Run only to CONFIRM the expected failures, not to gate S1.
```

### Level 3: Integration Testing (the REAL S1 proof — empirical diamond smoke)

```bash
# Build a real tmpdir diamond fixture and prove C resolves exactly once (dedup + elision):
npx tsx -e "
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { resolvePRD } from './src/core/session-utils.ts';
const t = mkdtempSync(join(tmpdir(), 'dedup-'));
writeFileSync(join(t,'c.md'),'C');
writeFileSync(join(t,'a.md'),'A(@c.md)');
writeFileSync(join(t,'b.md'),'B(@c.md)');
writeFileSync(join(t,'main.md'),'@a.md @b.md');
(async()=>{
  const off = await resolvePRD(join(t,'main.md'));
  console.log('markers off:', JSON.stringify(off), '| C count:', (off.match(/C/g)||[]).length);
  const on = await resolvePRD(join(t,'main.md'), { markers: true });
  console.log('markers on:', JSON.stringify(on), '| C count:', (on.match(/C/g)||[]).length, '| ref:', on.includes('@include-ref'));
  rmSync(t,{recursive:true,force:true});
})();
"
# Expected: markers off: \"A(C)B()\" | C count: 1  (second @c elided → empty between B's parens)
#           markers on:  \"...@include: c.md...C...@include-ref: c.md...\" | C count: 1 | ref: true
# If C count is 2, dedup didn't land. If the markers-off second ref echoes '@c.md', elision didn't land.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Idempotency fixed-point check (the §2.3 invariant the elision enables):
npx tsx -e "
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { resolvePRD } from './src/core/session-utils.ts';
const t = mkdtempSync(join(tmpdir(),'idem-'));
writeFileSync(join(t,'c.md'),'C'); writeFileSync(join(t,'a.md'),'A(@c.md)'); writeFileSync(join(t,'b.md'),'B(@c.md)');
writeFileSync(join(t,'main.md'),'@a.md @b.md');
(async()=>{ const r1=await resolvePRD(join(t,'main.md')); writeFileSync(join(t,'main.md'),r1); const r2=await resolvePRD(join(t,'main.md')); console.log('idempotent:', r1===r2); rmSync(t,{recursive:true,force:true}); })();
"
# Expected: idempotent: true  (the resolved doc is a fixed point — no resolvable @tokens survive).

# Domain checks (record in commit msg):
#   - Diamond dedups (C once). Elision (drop / @include-ref) — not verbatim. Idempotent fixed point.
#   - Elision never warns (successful resolution, not stale). maxDepth now defense-in-depth.
#   - resolvePRD seeding + downstream consumers unchanged.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint && npm run format:check` clean.
- [ ] Empirical diamond smoke: C appears exactly once; markers-off second ref emits nothing; markers-on emits `<!-- @include-ref -->`.
- [ ] Idempotency: `resolve(resolve(x)) === resolve(x)` for the diamond fixture.

### Feature Validation
- [ ] Line ~481: `visited.add(abs)` (no copy) + recursive call passes shared `visited`.
- [ ] Line ~469: `visited.has(abs)` branch elides (markers off → nothing; markers on → `<!-- @include-ref: ${token} -->`).
- [ ] Elision `continue`s before the stale-warning (no stale warning for elided tokens).
- [ ] `depth >= maxDepth` gate, stat/isFile/ENOENT/error handling, stale-warning condition, EXPANDED-body marker format unchanged.
- [ ] `expandIncludesRecursive` JSDoc rewritten (global-flat-dedup + elision, §2.3; old per-branch claims removed).

### Code Quality Validation
- [ ] Only `src/core/session-utils.ts` modified (expandIncludesRecursive body + JSDoc + 2 inline comments).
- [ ] No test edits (P1.M1.T2 owns them). No resolvePRD/resolveIncludes JSDoc edits (S2).
- [ ] The elision `continue` is preserved (skips stale-warning + marker-wrap).
- [ ] `visited.add(abs)` is inside `if (st.isFile())`, before the recursive call.

### Documentation & Deployment
- [ ] `expandIncludesRecursive` JSDoc describes the new model + cites §2.3.
- [ ] Inline comments at both change sites updated (dedup; elision).
- [ ] Commit message notes: per-branch ancestry → global-flat-dedup + elision; idempotency fixed point; expected test failures owned by P1.M1.T2.

---

## Anti-Patterns to Avoid

- ❌ Don't create a new `Set` on descent — pass the SAME `visited` set by reference. The per-branch copy is the bug being fixed.
- ❌ Don't echo `m[0]` (the @token) on second encounter — that's a verbatim survivor that re-expands and breaks idempotency. ELIDE (drop, or `<!-- @include-ref -->`).
- ❌ Don't remove the `continue` in the elision branch — it's what skips the stale-warning + marker-wrap (elision is a successful resolution, not stale).
- ❌ Don't add directories/ENOENT paths to `visited` — only actually-imported files (`isFile` true) are marked visited.
- ❌ Don't use a reference-comment form that contains a resolvable `@token` — `<!-- @include-ref: token -->` is safe (path inside a comment, not @-preceded). A resolvable form would break idempotency.
- ❌ Don't touch `resolvePRD`/`resolveIncludes` JSDoc (S2) or any test (P1.M1.T2).
- ❌ Don't change the `depth >= maxDepth` gate, the stat/isFile/ENOENT/error handling, the stale-warning condition, or the EXPANDED-body marker format.
- ❌ Don't run the test suite as S1's green-gate — the diamond/cycle-literal tests assert the OLD behavior and WILL FAIL (owned by P1.M1.T2). Use the empirical diamond smoke.
- ❌ Don't remove the entry-file seeding in `resolvePRD` (`new Set([absEntry])`) — it's correct (entry self-ref elides).

---

## Confidence Score

**9/10** — one-pass implementation success likelihood.

Rationale: This is a focused control-flow + mutation-pattern change inside one existing function, with
verbatim before/after for both change sites, the exact JSDoc-rewrite target (the current JSDoc
actively endorses the old model, so the delta is unambiguous), and the elision-idempotency rationale
documented. The one subtlety — that the elision branch must `continue` before the stale-warning check
(so elision never warns) — is called out explicitly. The expected transient test failures (the
diamond + cycle-literal tests that assert the OLD behavior) are named and assigned to P1.M1.T2, so
the implementer won't panic or "fix" them here. S1's real acceptance gate (the empirical diamond
smoke + idempotency check, since the unit tests assert old behavior) is specified. Residual risk: a
mis-placed `visited.add(abs)` (must be inside `isFile`, before recursion) — fenced off in the
gotchas. No external/runtime unknowns.