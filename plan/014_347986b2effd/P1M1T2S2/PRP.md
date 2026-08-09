# PRP — P1.M1.T2.S2: New invariant tests — idempotency fixed point, exponential-blowup guard, marker reference comment, diamond dedup

> Plan 014, PRD §2.3 ("No duplication (dedup)" / elision / idempotency). The dedup+elision rewrite of
> `expandIncludesRecursive` is Complete (P1.M1.T1.S1); S1 (Implementing) rewrites the EXISTING
> diamond/cycle tests to the new semantics. **T2.S2 adds seven NEW test cases (N1–N7) that have no
> predecessors** — they lock in invariants that did not exist under the old model: diamond dedup with
> first-encounter positioning, self-protecting marker reference comments, no-marker elision, the
> **idempotency fixed point** (`resolve(resolve(x)) === resolve(x)`), the **exponential-blowup guard**,
> entry-self-include elision, and `resolveIncludes`'s single-level no-dedup contract. All use REAL tmpdir
> fixtures. Test-only — no source/config/docs change.

---

## Goal

**Feature Goal**: Add 7 new invariant tests (across `tests/unit/core/prd-resolve.test.ts` and
`tests/unit/core/prd-markers.test.ts`) that lock in the §2.3 dedup/elision/idempotency/blowup-protection
guarantees of the completed `expandIncludesRecursive`. These are NET-NEW invariants (no predecessor tests
to modify — S1 owns the rewrites). Each `describe`/`it` title names the §2.3 invariant it locks in.

**Deliverable**:
1. **`tests/unit/core/prd-resolve.test.ts`** — EDIT (additive): 6 new tests — N1 (diamond dedup),
   N3 (no-marker elision), N4 (idempotency fixed point), N5 (exponential-blowup guard), N6 (entry-self-
   include elision), N7 (`resolveIncludes` single-level no-dedup). Add `vi` to the vitest import (for N6's
   `console.warn` spy). Add `resolveIncludes` to the session-utils import (for N7).
2. **`tests/unit/core/prd-markers.test.ts`** — EDIT (additive): 1 new test — N2 (marker-mode reference
   comment is self-protecting + idempotent).

**Success Definition**:
- N1: a diamond (A→B→D, A→C→D) resolves D's body EXACTLY ONCE, in its first-encounter position (under B);
      the second `@D` (from C) is elided — no `@D.md` survivor.
- N2: under `{ markers: true }`, the elided `@D` becomes `<!-- @include-ref: D.md -->`; a second resolution
      pass over the marker-on output is BYTE-IDENTICAL (the comment is self-protecting).
- N3: with markers off, the elided `@D` is simply absent (no survivor, no ref comment).
- N4: `resolve(resolve(x)) === resolve(x)` for a diamond-heavy fixture (write pass-1 output to a temp file,
      resolvePRD again, assert byte-identical).
- N5: 8 mutually-`@`-referencing files resolve WITHOUT crashing (no exponential blowup) and the output is
      LINEAR (each file's body once; size < 2× total input).
- N6: an entry that includes itself (`@main.md` inside `main.md`) is elided (entry pre-seeded); no warning,
      no infinite loop.
- N7: `resolveIncludes` (single-level) expands a DIRECT duplicate `@a.md` BOTH times (no dedup) — locking
      its no-dedup contract.
- `npx vitest run tests/unit/core/prd-resolve.test.ts tests/unit/core/prd-markers.test.ts` GREEN (the 7 new
  + S1's rewrites + all existing). `npm run lint && npm run format:check` clean. **No source files modified.**

---

## Why

- **Locks in the §2.3 invariants the rewrite introduced.** The old model expanded diamonds per-branch and
  left back-edges literal; the new model dedups globally and ELIDES. N1/N3/N6 pin the elision semantics;
  N4 pins the fixed-point property that guarantees hash/snapshot/delta consistency (§4.1/§4.3); N5 is the
  regression net against the exponential-blowup crash the old model suffered on densely cross-referenced
  specs; N2 pins that marker comments don't break idempotency (a verbatim survivor would).
- **These invariants had NO tests under the old model** (they couldn't — the behavior didn't exist). S1
  rewrites the EXISTING tests to the new output strings; T2.S2 adds the NET-NEW invariant coverage. No
  duplication with S1 (disjoint describe/it blocks).
- **Regression nets for future refactors.** A future change that (re)introduces per-branch visited sets,
  verbatim back-edge survivors, or marker comments that re-expand would break N1/N4/N5/N2 respectively —
  surfacing the regression before it reaches hash/snapshot/delta consistency.
- **Scope discipline.** T2.S2 = NEW invariant tests only. S1 = rewrites of existing tests (parallel,
  disjoint blocks). The implementation (P1.M1.T1.S1) + peer JSDoc (P1.M1.T1.S2) are Complete — consume,
  don't touch. No source/config/docs changes.

---

## What

### User-visible behavior
None (test-only). No source/config/docs/runtime surface change.

### Technical requirements (exact contract) — 7 new tests

All use REAL tmpdir fixtures (`mkdtempSync`/`writeFileSync`/`rmSync`); `resolvePRD`/`resolveIncludes` from
`'../../../src/core/session-utils.js'`. Mirror the existing scaffolding (file-level `beforeEach`/`afterEach`
already create/destroy `tmp`).

**N1 — DIAMOND DEDUP** (`prd-resolve.test.ts`, new describe `resolvePRD — diamond dedup & first-encounter position (§2.3)`):
```ts
// Fixture: D.md='D-BODY'; B.md='B-OPEN @D.md B-CLOSE'; C.md='C-OPEN @D.md C-CLOSE';
//         A.md='A-TOP @B.md @C.md A-BOT' (B before C); main.md='@A.md'.
const out = await resolvePRD(join(tmp, 'main.md'));
expect(out).toBe('A-TOP B-OPEN D-BODY B-CLOSE C-OPEN  C-CLOSE A-BOT'); // double-space after C-OPEN (elision)
expect(out.split('D-BODY').length).toBe(2);          // D appears EXACTLY ONCE
expect(out).not.toContain('@D.md');                  // no survivor
expect(out.indexOf('D-BODY')).toBeLessThan(out.indexOf('C-OPEN')); // first-encounter under B (B precedes C)
```

**N3 — NO-MARKER ELISION** (same describe as N1; markers off / default):
```ts
// Same diamond fixture (markers off). The elided @D is simply ABSENT.
const out = await resolvePRD(join(tmp, 'main.md'));
expect(out).not.toContain('@D.md');            // no @token survivor
expect(out).not.toContain('@include-ref');     // no marker ref comment (contrast with N2)
expect(out.split('D-BODY').length).toBe(2);    // once
```

**N4 — IDEMPOTENCY FIXED POINT** (`prd-resolve.test.ts`, new describe `resolvePRD — idempotency fixed point (§2.3)`):
```ts
// Diamond-heavy fixture: main.md='@a.md\n@b.md'; a.md='A-body @c.md'; b.md='B-body @c.md'; c.md='C-body @a.md'.
const out1 = await resolvePRD(join(tmp, 'main.md'));
writeFileSync(join(tmp, 'pass2.md'), out1);                 // resolvePRD takes a PATH → materialize
const out2 = await resolvePRD(join(tmp, 'pass2.md'));
expect(out2).toBe(out1);                                    // THE headline invariant: resolve(resolve(x))===resolve(x)
expect(out1).not.toMatch(/@a\.md|@b\.md|@c\.md/);           // no resolvable survivors → nothing to re-expand
```

**N5 — EXPONENTIAL-BLOWUP GUARD** (`prd-resolve.test.ts`, new describe `resolvePRD — exponential-blowup guard (§2.3 dedup bounds recursion)`):
```ts
// N=8 mutually-@-referencing files: f{i}.md = `F${i} @f${(i+1)%8}.md @f${(i+2)%8}.md`; main.md='@f0.md'.
// (Under the OLD model this expanded exponentially → string overflow crash. Under dedup, linear.)
const out = await resolvePRD(join(tmp, 'main.md'));         // COMPLETES (no RangeError) — primary signal
for (let i = 0; i < 8; i++) {
  expect(out.split(`F${i}`).length).toBe(2);                // each file imported AT MOST ONCE → bounded
}
const totalInput = [...Array(8)].reduce((s, _, i) => s + /* f{i}.md size */, 0) + /* main.md size */;
expect(out.length).toBeLessThan(totalInput * 2);            // LINEAR in input, not exponential
```

**N6 — ENTRY-SELF-INCLUDE ELISION** (`prd-resolve.test.ts`, new describe `resolvePRD — entry-self-include elision (§2.3)`):
```ts
// main.md='X @main.md Y' (the ENTRY includes ITSELF). Entry pre-seeded in visited → @main.md elided.
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
writeFileSync(join(tmp, 'main.md'), 'X @main.md Y');
await expect(resolvePRD(join(tmp, 'main.md'))).resolves.toBe('X  Y'); // double-space (elision)
expect(warnSpy).not.toHaveBeenCalled();                     // elision is SILENT
warnSpy.mockRestore();
```

**N7 — RESOLVEINCLUDES SINGLE-LEVEL** (`prd-resolve.test.ts`, new describe `resolveIncludes — single-level, no dedup (§2.3)`):
```ts
// resolveIncludes is single-level (NO visited set, NO recursion). A DIRECT duplicate @token in one file
// expands BOTH times — single-level dedup across siblings is out of scope (PRD §2.3). This locks that contract.
writeFileSync(join(tmp, 'a.md'), 'A');
const out = await resolveIncludes('@a.md @a.md', tmp);
expect(out).toBe('A A');                                    // BOTH expand; no dedup at this level
```

**N2 — MARKER-MODE REFERENCE COMMENT** (`prd-markers.test.ts`, append to the markers describe):
```ts
// Same diamond as N1; resolvePRD(main, { markers: true }). The elided C's @D → <!-- @include-ref: D.md -->.
// …write the diamond fixture…
const out1 = await resolvePRD(join(tmp, 'main.md'), { markers: true });
expect(out1).toContain('<!-- @include-ref: D.md -->');      // elided ref → stable reference comment
expect(out1).toContain('<!-- @include: D.md -->');          // first-encounter expansion marker
expect(out1.split('D-BODY').length).toBe(2);                // D body once
// Self-protecting: a second pass over the marker-on output is byte-identical (no re-expansion).
writeFileSync(join(tmp, 'pass2.md'), out1);
const out2 = await resolvePRD(join(tmp, 'pass2.md'), { markers: true });
expect(out2).toBe(out1);                                    // the ref comment does not trigger re-expansion
```

### Success Criteria
- [ ] N1: diamond resolves D once, first-encounter under B, exact `'A-TOP B-OPEN D-BODY B-CLOSE C-OPEN  C-CLOSE A-BOT'`.
- [ ] N2: marker-on diamond emits `<!-- @include-ref: D.md -->` for the elided ref; second pass byte-identical.
- [ ] N3: markers-off diamond has no `@D.md` survivor and no `@include-ref` comment.
- [ ] N4: `resolve(resolve(x)) === resolve(x)` byte-identical for the diamond-heavy fixture; no resolvable survivors.
- [ ] N5: 8 mutual-reference files resolve without crashing; each `F{i}` once; size `< 2× totalInput`.
- [ ] N6: entry-self-include elided (`'X  Y'`); no `console.warn`; no infinite loop.
- [ ] N7: `resolveIncludes('@a.md @a.md', tmp) === 'A A'` (single-level, no dedup).
- [ ] `npx vitest run tests/unit/core/prd-resolve.test.ts tests/unit/core/prd-markers.test.ts` GREEN.
- [ ] `npm run lint && npm run format:check` clean. No source files modified.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the verbatim
7 test bodies (fixtures + exact assertions), the verified elision semantics (markers-off = emit nothing →
double-space; markers-on = `<!-- @include-ref: token -->`), the marker-comment idempotency proof (why
`@include`/`@include-ref`/`@end-include` are non-resolving on re-scan), the exact import additions
(`vi`, `resolveIncludes`), the S1 disjoint-edit proof, and the naming convention.

### Documentation & References
```yaml
# MUST READ — the 7-test design + the marker-idempotency proof + the S1 disjoint proof (authored with this PRP)
- docfile: plan/014_347986b2effd/P1M1T2S2/research/dedup-invariant-tests.md
  section: "2. The implementation behavior under test", "3. The marker-comment idempotency proof", "4. The seven tests"
  why: The exact elision semantics (double-space; ref comment), WHY the marker comments are self-protecting on re-scan
        (RESOLVE_TOKEN matches @include etc. but they ENOENT + aren't .md → silent verbatim), and the exact fixtures/
        assertions. READ BEFORE IMPLEMENTING.

# MUST READ — the N1–N7 table this task implements
- docfile: plan/014_347986b2effd/architecture/test-impact-analysis.md
  section: "NEW Tests Required (Requirement 2)" (table N1–N7) + "Test Naming Convention"
  why: The authoritative invariant→fixture→assertion mapping + the §2.3-invariant naming requirement.

# MUST READ — the S1 contract (disjoint-edit proof + the rewritten assertions T2.S2 must not duplicate)
- file: plan/014_347986b2effd/P1M1T2S1/PRP.md
  why: S1 rewrites 6 EXISTING tests (T1–T5 in prd-resolve, M1 in prd-markers). T2.S2 ADDS new describe/it blocks —
        DISJOINT from S1's rewrites. S1 < S2 ordering ⇒ S1 merged first. Confirms the exact elision outputs
        (e.g. 'X  Y' double-space) T2.S2's N6 also relies on.

# PATTERN FILE 1 — the implementation under test (READ-ONLY — Complete, do NOT edit)
- file: src/core/session-utils.ts
  why: expandIncludesRecursive (L431 — global-flat visited set, elision on visited.has(abs): markers-off emits
        nothing, markers-on emits `<!-- @include-ref: ${token} -->`; elision `continue`s past the stale-warning →
        silent). resolvePRD (L611 — entry pre-seeded `new Set([absEntry])`; `opts.markers ?? getPrdIncludeMarkers()`).
        resolveIncludes (L376 — SINGLE-LEVEL: no visited set, no recursion; duplicate @token expands both).
        RESOLVE_TOKEN (L420 — `/(?<![\w./-])@([A-Za-z0-9_./-]+)/g`; why @include/@include-ref/@end-include match
        but resolve to ENOENT non-.md → silent verbatim on re-scan).
  pattern: "if (visited.has(abs)) { if (markers) out += `<!-- @include-ref: ${token} -->`; last = idx + m[0].length; continue; }"
  critical: Elision markers-off = emit NOTHING (leaves the surrounding ws → double-space). Elision is SILENT (continue skips warn).

# PATTERN FILE 2 — prd-resolve.test.ts (N1/N3/N4/N5/N6/N7 home; MIRROR its scaffolding)
- file: tests/unit/core/prd-resolve.test.ts
  why: File-level `tmp = mkdtempSync(...)` beforeEach + `rmSync` afterEach. Imports `resolvePRD, SessionFileError`
        from session-utils; vitest import is `{ describe, it, expect, beforeEach, afterEach }` — ADD `vi` (for N6's
        warn spy). N7 also imports `resolveIncludes`. Use writeFileSync fixtures + exact `toBe` assertions.
  pattern: "writeFileSync(join(tmp,'a.md'),'A'); await expect(resolvePRD(join(tmp,'main.md'))).resolves.toBe('A');"
  gotcha: Do NOT modify S1's rewritten tests (T1–T5) — append NEW describe blocks. The double-space in elision
        outputs (e.g. 'X  Y', 'C-OPEN  C-CLOSE') is CORRECT.

# PATTERN FILE 3 — prd-markers.test.ts (N2 home; MIRROR its scaffolding)
- file: tests/unit/core/prd-markers.test.ts
  why: Already imports `vi` + `resolvePRD` + `getPrdIncludeMarkers`/`PRD_INCLUDE_MARKERS`. afterEach does
        `vi.unstubAllEnvs(); vi.restoreAllMocks();`. Uses `{ markers: true }` opts OR `vi.stubEnv(PRD_INCLUDE_MARKERS,'1')`.
        S1 rewrites M1 (disjoint it). N2 appends a new it.
  pattern: "await resolvePRD(join(tmp,'main.md'), { markers: true })"
  gotcha: N2 needs NO console.warn spy (elision is silent; the idempotency check `out2===out1` is the assertion).

# READ-ONLY — the PRD spec
- docfile: PRD.md
  section: "§2.3 Distributed (Multi-File) PRDs" — "No duplication (dedup)" + "Idempotency" + "Markers" bullets.
  why: Authoritative invariants (each file at most once; elision not verbatim; resolve(resolve(x))===resolve(x);
        marker ref comment names path but contains no resolvable @token). (Inline in this PRP's <selected_prd_content>.)

# VERIFIED FACTS
- fact: "Elision markers-off = emit NOTHING (leaves surrounding ws → 'X @D.md Y'→'X  Y' double-space). Markers-on = `<!-- @include-ref: ${token} -->`."
- fact: "Elision is SILENT — the `continue` skips the stale-include console.warn (elision is a successful resolution)."
- fact: "Entry is pre-seeded: resolvePRD does `expandIncludesRecursive(entryContent, baseDir, maxDepth, 0, new Set([absEntry]), markers)`."
- fact: "resolveIncludes (L376) is SINGLE-LEVEL: no visited set, no recursion. A duplicate @a.md in one file → BOTH expand ('A A')."
- fact: "Marker comments are self-protecting: @include/@include-ref/@end-include match RESOLVE_TOKEN but resolve to ENOENT (not .md) → silent verbatim → marker-on output is a fixed point."
- fact: "resolvePRD takes a PATH → the idempotency test (N4) must write pass-1 output to a temp file, then resolvePRD that file."
- fact: "S1 rewrites 6 EXISTING tests (disjoint its); T2.S2 ADDS new describe blocks. S1 < S2 ordering. Both edit the same 2 files at disjoint locations."
- fact: "All include tests use REAL tmpdir (mkdtempSync), NOT vi.mock — recursion + dedup + base invariant are only trustworthy against real files."
```

### Current Codebase tree (relevant slice)
```bash
tests/unit/core/prd-resolve.test.ts    # EDIT (additive) — N1, N3, N4, N5, N6, N7 + import `vi` + `resolveIncludes`
tests/unit/core/prd-markers.test.ts    # EDIT (additive) — N2
src/core/session-utils.ts              # READ-ONLY (expandIncludesRecursive/resolvePRD/resolveIncludes — Complete, consumed)
```

### Desired Codebase tree with files to be edited
```bash
tests/unit/core/prd-resolve.test.ts    # MODIFIED (6 new tests in new describes + 2 import additions)
tests/unit/core/prd-markers.test.ts    # MODIFIED (1 new test appended)
# No source/config/docs changes. No new files.
```

### Known Gotchas of our Codebase & Library Quirks
```ts
// CRITICAL — elision markers-off = emit NOTHING, leaving the surrounding whitespace. So 'X @D.md Y' → 'X  Y'
//   (DOUBLE space) and 'C-OPEN @D.md C-CLOSE' → 'C-OPEN  C-CLOSE'. The double-space is CORRECT — do not "fix" it.
//   (S1's rewrites rely on the same double-space; N1/N6 assert it verbatim.)

// CRITICAL — the marker-comment idempotency (N2) holds because @include / @include-ref / @end-include match
//   RESOLVE_TOKEN but resolve to ENOENT and do NOT end in '.md' → silent verbatim (no stale warning, no expansion).
//   Do NOT create files named 'include'/'include-ref'/'end-include' in the fixture (would break the ENOENT assumption).

// CRITICAL — resolvePRD takes a PATH, not a string. The idempotency test (N4) and the marker idempotency (N2)
//   must writeFileSync the pass-1 output to a temp file (e.g. <tmp>/pass2.md) then resolvePRD THAT file.

// CRITICAL — prd-resolve.test.ts does NOT currently import `vi`. N6's console.warn spy needs it — ADD `vi` to
//   the vitest import. N7 needs `resolveIncludes` — ADD it to the session-utils import. (S1 doesn't touch these
//   import lines; no conflict.)

// GOTCHA — N5's blowup guard: the PRIMARY regression signal is that resolution COMPLETES (under the old model,
//   8 mutual-reference files expanded exponentially → RangeError/string-overflow crash). Also assert each F{i}
//   appears once + size < 2× totalInput (linear). Compute totalInput as the sum of all file byte lengths.

// GOTCHA — N6: main.md is BOTH the entry AND self-referencing. writeFileSync(join(tmp,'main.md'),'X @main.md Y')
//   then resolvePRD(join(tmp,'main.md')). The entry is pre-seeded → @main.md elided on the first scan. Use a
//   LOCAL warn spy (vi.spyOn + mockRestore) so you don't have to touch the file's shared afterEach.

// GOTCHA — N1's first-encounter position: B appears before C in A.md ('A-TOP @B.md @C.md A-BOT'), so D is first
//   encountered under B's branch → D-BODY appears BEFORE C-OPEN. Assert indexOf('D-BODY') < indexOf('C-OPEN').

// GOTCHA — do NOT modify S1's rewritten tests (T1–T5 in prd-resolve, M1 in prd-markers). Append NEW describe
//   blocks with distinct names (e.g. 'resolvePRD — diamond dedup & first-encounter position (§2.3)'). S1's
//   renamed describe is 'global-flat dedup & elision (each file imported at most once)' — don't reuse that name.

// GOTCHA — N2 goes in prd-markers.test.ts (which already imports vi + has the markers patterns). N1/N3/N4/N5/N6/N7
//   go in prd-resolve.test.ts. Do NOT split N2 into prd-resolve (it's a marker-mode test).

// GOTCHA — all tests use the file-level `tmp` (mkdtempSync beforeEach / rmSync afterEach) already in both files.
//   Reuse it; don't add a second tmpdir. writeFileSync(join(tmp,'name.md'),'body') for fixtures.

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check. vitest 100% coverage on src is
//   UNAFFECTED (no src changes; tests are excluded from coverage).

// GOTCHA — do NOT touch src/core/session-utils.ts (Complete) or any source. If a test FAILS because the
//   implementation doesn't match (e.g. elision emits a verbatim survivor), that's a real finding — report it,
//   don't weaken the test or edit source unless the implementation genuinely regressed.
```

---

## Implementation Blueprint

### Data models and structure
None — test-only. The "structure" is the diamond/mutual-reference fixtures + the exact assertions.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: EDIT tests/unit/core/prd-resolve.test.ts — imports + N1/N3/N4/N5/N6/N7
  - IMPORTS: add `vi` to the vitest import; add `resolveIncludes` to the session-utils import.
  - NEW describe 'resolvePRD — diamond dedup & first-encounter position (§2.3)':
      * N1 it('expands the shared diamond target EXACTLY ONCE, in first-encounter position (§2.3 dedup)'):
          writeDiamond(tmp) (D/B/C/A/main); assert the exact string + split('D-BODY').length===2 +
          not.toContain('@D.md') + indexOf('D-BODY') < indexOf('C-OPEN').
      * N3 it('elides the second diamond reference with NO marker comment (markers off, §2.3 elision)'):
          same fixture; not.toContain('@D.md') + not.toContain('@include-ref') + D-BODY once.
      (Optionally factor a local writeDiamond(tmp) helper to avoid fixture repetition across N1/N3.)
  - NEW describe 'resolvePRD — idempotency fixed point (§2.3)':
      * N4 it('resolve(resolve(x)) === resolve(x) for a diamond-heavy fixture (§2.3 idempotency)'):
          mutual fixture; out1→writeFileSync pass2.md→out2; expect(out2).toBe(out1); out1 has no @a/@b/@c.md.
  - NEW describe 'resolvePRD — exponential-blowup guard (§2.3 dedup bounds recursion)':
      * N5 it('resolves N mutually-@-referencing files without exponential blowup (§2.3 dedup)'):
          8 mutual files; completes (no throw); each F{i} once; length < 2× totalInput.
  - NEW describe 'resolvePRD — entry-self-include elision (§2.3)':
      * N6 it('elides a direct entry-self-include (entry pre-seeded); silent, no loop (§2.3 dedup)'):
          main.md='X @main.md Y'; local warn spy; toBe('X  Y'); warn not called.
  - NEW describe 'resolveIncludes — single-level, no dedup (§2.3)':
      * N7 it('expands a DIRECT duplicate @token both times (single-level, no visited set)'):
          a.md='A'; resolveIncludes('@a.md @a.md', tmp) === 'A A'.
  - DO NOT: modify S1's rewritten T1–T5; add a second tmpdir; weaken an assertion to make it pass.
  - EXPECTED: all 6 new tests pass against the Complete implementation.

Task 2: EDIT tests/unit/core/prd-markers.test.ts — N2
  - APPEND to the markers describe (or a new describe 'resolvePRD — marker reference comments for elided refs (§2.3)'):
      * N2 it('elided diamond ref becomes a self-protecting reference comment under markers (§2.3 idempotency)'):
          writeDiamond(tmp); out1 = resolvePRD(main, { markers: true }); contains '<!-- @include-ref: D.md -->'
          + '<!-- @include: D.md -->'; D-BODY once; writeFileSync pass2.md; out2 = resolvePRD(pass2.md,
          { markers: true }); expect(out2).toBe(out1).
  - DO NOT: modify S1's M1; add a warn spy (N2 needs none — idempotency is the assertion).
  - EXPECTED: N2 passes (marker comments are non-resolving on re-scan → fixed point).

Task 3: FORMAT + VERIFY
  - RUN: npm run fix → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/core/prd-resolve.test.ts tests/unit/core/prd-markers.test.ts → ALL GREEN
        (the 7 new + S1's rewrites + every existing test).
  - RUN (regression): npx vitest run tests/unit/core/prd-includes.test.ts (untouched — must stay green).
  - EXPECTED: all green/clean. If a new test fails, the implementation doesn't match the §2.3 invariant —
        report it (don't weaken the test). If the double-space assertion fails, confirm elision emits nothing
        (markers off). If N2's idempotency fails, a marker comment is re-expanding (confirm @include etc. are
        ENOENT non-.md). If N5 throws RangeError, dedup regressed (global-flat set not shared by reference).
```

### Implementation Patterns & Key Details
```ts
// ---- the diamond fixture (N1/N3/N2 share it; factor a helper) ----
function writeDiamond(tmp: string): void {
  writeFileSync(join(tmp, 'D.md'), 'D-BODY');
  writeFileSync(join(tmp, 'B.md'), 'B-OPEN @D.md B-CLOSE');
  writeFileSync(join(tmp, 'C.md'), 'C-OPEN @D.md C-CLOSE');
  writeFileSync(join(tmp, 'A.md'), 'A-TOP @B.md @C.md A-BOT'); // B before C → D first under B
  writeFileSync(join(tmp, 'main.md'), '@A.md');
}
// N1 (markers off): 'A-TOP B-OPEN D-BODY B-CLOSE C-OPEN  C-CLOSE A-BOT'  ← double-space after C-OPEN

// ---- N4 idempotency (resolvePRD takes a PATH → materialize pass-1) ----
const out1 = await resolvePRD(join(tmp, 'main.md'));
writeFileSync(join(tmp, 'pass2.md'), out1);
const out2 = await resolvePRD(join(tmp, 'pass2.md'));
expect(out2).toBe(out1);                              // resolve(resolve(x)) === resolve(x)

// ---- N5 blowup guard (completes + linear) ----
for (let i = 0; i < 8; i++) expect(out.split(`F${i}`).length).toBe(2);  // each file once → bounded
expect(out.length).toBeLessThan(totalInput * 2);     // linear, not exponential

// ---- N6 entry-self-include (local warn spy; entry pre-seeded) ----
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
writeFileSync(join(tmp, 'main.md'), 'X @main.md Y');
await expect(resolvePRD(join(tmp, 'main.md'))).resolves.toBe('X  Y');
expect(warnSpy).not.toHaveBeenCalled();
warnSpy.mockRestore();

// ---- N2 marker idempotency (marker comments are non-resolving on re-scan) ----
const out1 = await resolvePRD(join(tmp, 'main.md'), { markers: true });
writeFileSync(join(tmp, 'pass2.md'), out1);
const out2 = await resolvePRD(join(tmp, 'pass2.md'), { markers: true });
expect(out2).toBe(out1);  // @include/@include-ref/@end-include → ENOENT non-.md → silent verbatim
```

### Integration Points
```yaml
DEPENDS ON (must be LANDED before T2.S2 is correct):
  - P1.M1.T1.S1 (implementation, Complete): expandIncludesRecursive global-flat dedup + elision. T2.S2
        exercises it unchanged.
  - P1.M1.T2.S1 (test rewrites, Implementing): rewrites the EXISTING tests to the new semantics. S1 < S2
        ordering ⇒ S1 merged first; T2.S2's new describe blocks are DISJOINT from S1's rewrites.

NO SOURCE CHANGES: T2.S2 is test-only. expandIncludesRecursive / resolvePRD / resolveIncludes are consumed
  unchanged (Complete). The peer JSDoc (P1.M1.T1.S2) is Complete.

NO DOCS (test-only; the describe/it titles that name the §2.3 invariant ARE the doc surface per the item's
  Mode A: "Test describe/it titles name the §2.3 invariant each test locks in").
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix                  # lint:fix + prettier --write (run after the edits)
npm run lint && npm run format:check   # clean
# typecheck: test files live under the test tsconfig (not tsconfig.build.json), so `npm run typecheck`
#   (build) is unaffected. If the project typechecks tests separately, confirm clean.
# Expected: clean. If lint flags an unused `vi`/`resolveIncludes` import, confirm N6/N7 use them.
```

### Level 2: Unit Tests (the PRIMARY gate)
```bash
npx vitest run tests/unit/core/prd-resolve.test.ts tests/unit/core/prd-markers.test.ts
# Expected: ALL GREEN — the 7 new tests + S1's rewrites + every existing test. Diagnostics:
#   - N1 exact-string fail → confirm the double-space after C-OPEN (elision emits nothing markers-off).
#   - N4/N2 idempotency fail → a survivor re-expanded; confirm elision (not verbatim) + marker comments non-resolving.
#   - N5 RangeError → dedup regressed (visited set not shared by reference → exponential).
#   - N6 warn called → elision is no longer silent (the continue skips the warn — confirm).
#   - N7 'A A' fail → resolveIncludes started deduping (out of scope; report it).
# Regression (untouched — must stay green):
npx vitest run tests/unit/core/prd-includes.test.ts
```

### Level 3: Integration Testing (System Validation)
```bash
# Smoke: the headline idempotency invariant holds end-to-end on a real diamond (real fs).
npx tsx -e "
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const t = mkdtempSync(join(tmpdir(),'inv-'));
writeFileSync(join(t,'c.md'),'C-body @a.md'); writeFileSync(join(t,'b.md'),'B-body @c.md');
writeFileSync(join(t,'a.md'),'A-body @c.md'); writeFileSync(join(t,'main.md'),'@a.md\n@b.md');
import('./src/core/session-utils.ts').then(async m => {
  const o1 = await m.resolvePRD(join(t,'main.md')); writeFileSync(join(t,'p2.md'), o1);
  const o2 = await m.resolvePRD(join(t,'p2.md'));
  console.log('idempotent:', o1 === o2, '| no @survivors:', !/@a\.md|@b\.md|@c\.md/.test(o1));
  rmSync(t,{recursive:true,force:true});
});
"
# Expected: idempotent: true | no @survivors: true.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP. Domain checks (record in commit message):
#   - Diamond dedup: D appears once, first-encounter position (N1). Elision is silent + leaves no survivor (N3/N6).
#   - Idempotency fixed point: resolve(resolve(x))===resolve(x), markers off (N4) AND on (N2) — the marker
#     reference comment is self-protecting (non-resolving on re-scan).
#   - Blowup guard: 8 mutual-reference files resolve linearly (N5) — dedup bounds recursion.
#   - resolveIncludes is single-level (no dedup): duplicate @a.md expands both (N7) — contract locked.
#   - All tests name the §2.3 invariant in their describe/it titles (Mode A doc surface).
#   - No source changes; the implementation is consumed unchanged.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/core/prd-resolve.test.ts tests/unit/core/prd-markers.test.ts` GREEN (7 new + S1 + existing).
- [ ] `npx vitest run tests/unit/core/prd-includes.test.ts` GREEN (untouched regression).

### Feature Validation
- [ ] N1: diamond D once, first-encounter under B, exact string (double-space).
- [ ] N2: marker-on elided ref → `<!-- @include-ref: D.md -->`; second pass byte-identical.
- [ ] N3: markers-off elided ref absent (no `@D.md`, no `@include-ref`).
- [ ] N4: `resolve(resolve(x)) === resolve(x)`; no resolvable survivors.
- [ ] N5: 8 mutual files resolve without crash; each once; size `< 2× totalInput`.
- [ ] N6: entry-self-include elided (`'X  Y'`); no warn; no loop.
- [ ] N7: `resolveIncludes('@a.md @a.md', tmp) === 'A A'`.

### Code Quality Validation
- [ ] Only `prd-resolve.test.ts` (6 tests + import `vi`/`resolveIncludes`) + `prd-markers.test.ts` (1 test) modified.
- [ ] NEW describe blocks DISJOINT from S1's rewrites (no duplicate/overlapping its).
- [ ] All tests use the REAL tmpdir scaffolding (no vi.mock of fs).
- [ ] describe/it titles name the §2.3 invariant (Mode A doc surface).
- [ ] No source/config/docs files modified.

### Documentation & Deployment
- [ ] describe/it titles name the invariant (dedup / elision / idempotency / blowup-guard / single-level).
- [ ] Commit message notes: 7 new §2.3 invariant tests (N1–N7); idempotency fixed point (N4) + marker
      self-protection (N2) are the headline guarantees for hash/snapshot/delta consistency; blowup guard (N5);
      disjoint from S1's rewrites; test-only.

---

## Anti-Patterns to Avoid

- ❌ Don't "fix" the double-space in elision outputs (`'X  Y'`, `'C-OPEN  C-CLOSE'`) — elision markers-off
      emits NOTHING, leaving the surrounding whitespace. The double-space is the correct, asserted behavior.
- ❌ Don't create files named `include`/`include-ref`/`end-include` in the N2/N5 fixture — they'd break the
      ENOENT assumption that makes marker comments self-protecting on re-scan.
- ❌ Don't pass a STRING to resolvePRD for the idempotency pass — it takes a PATH. Write pass-1 output to a
      temp file (`<tmp>/pass2.md`), then resolvePRD that file.
- ❌ Don't modify S1's rewritten tests (T1–T5 in prd-resolve, M1 in prd-markers) — append NEW describe blocks
      with distinct names. S1 < S2 ordering; the edits are disjoint.
- ❌ Don't add a second tmpdir — reuse each file's existing file-level `tmp` (mkdtempSync beforeEach / rmSync
      afterEach).
- ❌ Don't forget the import additions in prd-resolve.test.ts: `vi` (for N6's warn spy) + `resolveIncludes`
      (for N7). S1 doesn't touch these import lines.
- ❌ Don't add a `console.warn` spy to N2 — it needs none (elision is silent; the byte-identical second pass
      IS the assertion). N6 is the only test that needs the warn spy.
- ❌ Don't assert an EXACT string for N4/N5 — N4 asserts byte-identity (`out2 === out1`) without hand-computing
      the diamond output; N5 asserts completion + linearity (each `F{i}` once + size bound), not an exact string.
- ❌ Don't touch `src/core/session-utils.ts` (Complete) or any source. If a test fails because the implementation
      doesn't match the §2.3 invariant, REPORT it (e.g. elision emits a verbatim survivor → idempotency broken) —
      don't weaken the test or edit source unless the implementation genuinely regressed.
- ❌ Don't conflate N6 (entry includes ITSELF: `main.md='X @main.md Y'`) with S1's T4 (a CHILD points at the
      entry: `a.md='A @main.md END'`). Both rely on entry-pre-seeded but are distinct cases — N6 is net-new.
- ❌ Don't run the full `npm run test:run` as the gate — gate on the two affected suites + lint + format.

---

## Confidence Score

**9/10** — one-pass implementation success likelihood.

Rationale: This is a test-only task (two files, seven new `it()` blocks) whose target behavior is ALREADY
Complete and verified in-repo (`expandIncludesRecursive` global-flat dedup + elision). The exact fixtures +
assertions are specified verbatim, including the subtle-but-correct elision double-space and the marker-comment
idempotency proof (why `@include`/`@include-ref`/`@end-include` are non-resolving on re-scan → fixed point).
The existing test scaffolding (REAL tmpdir, writeFileSync fixtures, resolvePRD/resolveIncludes imports,
`vi`/`vi.restoreAllMocks` in prd-markers) is directly mirrorable. The S1 disjoint-edit proof (S1 rewrites
existing its; T2.S2 appends new describes; S1 < S2 ordering) is established. The headline invariants (N4
idempotency, N2 marker self-protection, N5 blowup guard) are the load-bearing guarantees for §4.1/§4.3
hash/snapshot/delta consistency — the tests pin them precisely. Residual risks: (a) the exact elision
double-space string (asserted verbatim — if the implementation emits differently, that's a real finding to
report); (b) N5's `totalInput` computation (straightforward sum of file sizes); (c) a prettier nit
(auto-fixed via `npm run fix`). No external/runtime unknowns — all tests are deterministic against real files.