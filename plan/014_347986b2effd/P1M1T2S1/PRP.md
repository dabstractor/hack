# PRP — P1.M1.T2.S1: Rewrite existing diamond/cycle tests to assert dedup + elision

> PRD §2.3 (Distributed/Multi-File PRDs — "No duplication (dedup)" + "Idempotency"). S1 (Complete) rewrote
> `expandIncludesRecursive` to **global-flat-dedup + elision** (single shared visited set; first encounter
> expands; every later ref — diamond sibling, cycle, back-edge — is ELIDED, emitting nothing when markers
> are off). **Five tests in `prd-resolve.test.ts` + one in `prd-markers.test.ts` assert the OLD per-branch /
> literal-survivor behavior and now FAIL.** T2.S1 rewrites those 6 tests' titles, comments, and assertions
> to lock in the new §2.3 invariant. **Fixtures (file contents) + the real-tmpdir strategy are UNCHANGED —
> only expectations + naming change.** Test-only; no source. S2 (parallel) is JSDoc-only — zero overlap.

---

## Goal

**Feature Goal**: Rewrite the 6 existing tests that assert OLD resolver behavior (per-branch expansion,
cycle back-edges staying literal, diamonds duplicating) so they assert the NEW global-flat-dedup + elision
behavior (each file imported at most once; second-encounter refs ELIDED). Rename their titles/describe
blocks/comments to name the §2.3 invariant they lock in (dedup / elision / idempotency). Preserve the
real-tmpdir fixture strategy and the unchanged fixtures.

**Deliverable**: edits to **two test files only** — `tests/unit/core/prd-resolve.test.ts` (5 tests: the
diamond + 3 cycle + 1 nested-chain) and `tests/unit/core/prd-markers.test.ts` (1 output assertion in the
cycle-back-edge test). No source files. No new tests (those are T2.S2).

**Success Definition**:
- The 5 `prd-resolve.test.ts` tests assert the NEW elision outputs (verified against the live S1
  implementation — see research note §3).
- The `prd-markers.test.ts` cycle test's output assertion changes to the elided form; its
  `console.warn`-NOT-called assertion stays valid (elision is silent).
- Test titles + the `describe('… cycle detection …')` block + inline comments name the §2.3 dedup/elision
  invariant; stale "(path-based visited set)" / "stays literal" / "appears TWICE" phrasing is gone.
- Fixtures (file contents) are byte-identical to today; the real-tmpdir strategy is unchanged.
- `npx vitest run tests/unit/core/prd-resolve.test.ts tests/unit/core/prd-markers.test.ts` is GREEN;
  the unaffected tests (single-level, base invariant, maxDepth, ENOENT, errors, markers, idempotency-
  linear) stay green; `npm run lint && npm run format:check` clean.
- **No source files modified.**

---

## Why

- **The 6 tests currently FAIL against S1's landed dedup behavior.** S1 changed the resolver from
  per-branch ancestry to global-flat-dedup + elision — the old assertions (`'[S]\n{S}'`, `'X @a.md Y'`,
  `'A-TOP B-OPEN @a.md B-CLOSE A-BOT'`, `'A @main.md END'`, `'start A(C via b:B(C)) end'`) describe
  behavior that no longer holds. T2.S1 restores green by asserting what the resolver actually does now.
- **Locks in the §2.3 invariant the tests exist to guard.** The diamond/cycle tests exist to prove the
  resolver terminates and doesn't duplicate. Under the new model the precise guarantee is "each file
  imported at most once; second-encounter refs elided" — the rewritten tests + their titles name THAT
  invariant, so a future regression (re-introducing per-branch duplication or literal cycle survivors)
  fails a test whose name explains why it matters.
- **Preserves the trustworthy test strategy.** These tests use REAL tmpdir fixtures (mkdtempSync), not
  vi.mock — recursion + dedup + the base invariant are only trustworthy against real files. T2.S1 keeps
  that strategy and the fixtures; only the expectations + naming change.
- **Scope discipline.** T2.S1 = rewrite 6 EXISTING tests. T2.S2 (next) ADDS new invariant tests
  (idempotency fixed point, exponential-blowup guard, marker reference comment, diamond dedup). S2
  (parallel) is JSDoc-only on the peer functions. No source, no new tests, no docs files in T2.S1.

---

## What

### User-visible behavior
None (test-only). No user/config/API/runtime surface change (Mode A = the test titles/comments name the
invariant).

### Technical requirements (exact contract — 6 rewrites)

All edits are in the two test files. **Fixtures (the `writeFileSync(join(tmp, '<file>'), '<content>')`
lines) are UNCHANGED** — only the `it(...)` title, the inline comments, and the assertion values change.

#### `tests/unit/core/prd-resolve.test.ts`

**describe rename**: the block currently `describe('resolvePRD — cycle detection (path-based visited set)', …)`
(holds the 3 cycle tests + the diamond test) → rename to the new model, e.g.
`describe('resolvePRD — global-flat dedup & elision (each file imported at most once)', …)`.

**Test 1 — diamond** (currently `it('expands a diamond in both branches (path-based visited set)', …)`):
- Title → `it('deduplicates a diamond dependency — shared file expanded exactly once', …)`.
- Assertion: `expect(out).toBe('[S]\n{S}');` → `expect(out).toBe('[S]\n{}');` (b's `@shared.md` ELIDED).
- **DROP/CHANGE** `expect(out.split('S').length).toBe(3);` (asserted TWO S's) → it's now ONE S; change to
  `.toBe(2)` or delete it. (The `toBe('[S]\n{}')` assertion already proves single-expansion.)
- Inline comment "shared appears TWICE (once per branch); a flat set would wrongly deduplicate" → rewrite
  to "shared expands ONCE (first encounter via a); b's @shared.md is ELIDED (§2.3 global-flat-dedup)".

**Test 2 — self-cycle** (currently `it('terminates a self-cycle leaving the back-edge literal', …)`):
- Title → `it('elides a self-cycle (second encounter drops the @token)', …)`.
- Assertion: `…resolves.toBe('X @a.md Y');` → `…resolves.toBe('X  Y');` (inner `@a.md` ELIDED — note the
  DOUBLE SPACE where the token was).
- Inline comment "the inner @a.md stays literal (cycle)" → "the inner @a.md is ELIDED (a already visited)".

**Test 3 — mutual cycle** (currently `it('terminates a mutual cycle leaving the back-edge literal', …)`):
- Title → `it('elides a mutual-cycle back-edge (a is imported exactly once)', …)`.
- Assertion: `expect(result).toBe('A-TOP B-OPEN @a.md B-CLOSE A-BOT');` →
  `expect(result).toBe('A-TOP B-OPEN  B-CLOSE A-BOT');` (b's `@a.md` ELIDED — DOUBLE SPACE between
  B-OPEN and B-CLOSE).
- **KEEP** `expect(result).not.toContain('A-TOP A-TOP');` (still proves a is expanded exactly once).
- Inline comment "b's @a.md is a cycle → stays literal" → "b's @a.md is ELIDED (a already visited)".

**Test 4 — entry-pointed cycle** (currently `it('detects an include pointing back at the entry as a cycle', …)`):
- Title → `it('elides an include pointing back at the entry (entry pre-seeded in visited)', …)`.
- Assertion: `…resolves.toBe('A @main.md END');` → `…resolves.toBe('A  END');` (`@main.md` ELIDED — entry
  is pre-seeded in visited).
- Inline comment "a's @main.md is the entry → cycle → literal" → "a's @main.md is ELIDED (the entry is
  pre-seeded in visited)".

**Test 5 — nested chain** (currently `it('recursively expands a nested chain (entry→a→b→c)', …)`, in the
preceding describe block — leave that describe block's title alone; only this `it` changes):
- Title → `it('deduplicates a shared descendant across a nested chain (c imported exactly once)', …)`.
- Assertion: `…resolves.toBe('start A(C via b:B(C)) end');` →
  `…resolves.toBe('start A(C via b:B()) end';` (c='C' expands once via a's `@c.md`; b's `@c.md` ELIDED →
  `B()`).
- Inline comment "full chain expands inline in order; both @c.md and @b.md in a.md resolve" → "c expands
  once (first encounter, in a); b's @c.md is ELIDED (§2.3 dedup) → B()".

#### `tests/unit/core/prd-markers.test.ts`

**M1 — cycle back-edge** (currently `it('does NOT warn for a cycle back-edge (file exists)', …)`):
- Title: keep (still accurate) — optionally append `(elided, not literal)`.
- **Output assertion**: `expect(out).toBe('X @a.md Y');` → `expect(out).toBe('X  Y');` (self-include
  ELIDED).
- **KEEP** `expect(warn).not.toHaveBeenCalled();` — elision is silent (the `continue` skips the stale-
  warning path in `expandIncludesRecursive`); this assertion remains valid and is the load-bearing point
  of the test.

### Success Criteria
- [ ] The 5 prd-resolve tests assert the NEW elision outputs (`'[S]\n{}'`, `'X  Y'`,
      `'A-TOP B-OPEN  B-CLOSE A-BOT'`, `'A  END'`, `'start A(C via b:B()) end'`).
- [ ] The prd-markers cycle test asserts `out === 'X  Y'` AND `warn` NOT called (both).
- [ ] describe block renamed (drop "(path-based visited set)"); each rewritten `it` title names the
      §2.3 invariant (dedup / elision).
- [ ] Stale inline comments rewritten (no "stays literal" / "appears TWICE" / "flat set would wrongly
      deduplicate").
- [ ] Fixtures (writeFileSync lines) byte-identical; real-tmpdir strategy unchanged.
- [ ] T3's `not.toContain('A-TOP A-TOP')` kept; T1's `split('S').length===3` dropped/changed.
- [ ] `npx vitest run tests/unit/core/prd-resolve.test.ts tests/unit/core/prd-markers.test.ts` GREEN;
      `npm run lint && npm run format:check` clean; no source files modified.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the exact
current code of all 6 tests (with line numbers), the verified NEW expected output for each (traced through
the live S1 implementation), the precise before/after for titles/comments/assertions, the
elision-is-silent fact (M1's warn assertion stays valid), the unaffected-tests list, and the executable
validation commands are all below.

### Documentation & References

```yaml
# MUST READ — the affected-tests table (fixtures, OLD assertions, NEW expected behavior)
- docfile: plan/014_347986b2effd/architecture/test-impact-analysis.md
  section: "Tests That Assert OLD Behavior (MUST BE REWRITTEN)" and "Tests UNAFFECTED by the Change"
  why: The authoritative table of the 5 prd-resolve + 1 prd-markers tests, their fixtures, OLD assertions,
        and NEW expected behavior. Confirms the unaffected-tests list (single-level, base invariant,
        maxDepth, ENOENT, errors, markers, linear-idempotency) that T2.S1 must leave alone.

# MUST READ — verified traces + exact current line numbers + the describe/comment rewrites (authored here)
- docfile: plan/014_347986b2effd/P1M1T2S1/research/dedup-elision-test-rewrite.md
  section: "2. S1 elision behavior" and "3. The 6 affected tests" and "4. Titles + comments + describe rename"
  why: Each NEW output is traced through the live expandIncludesRecursive (elision = emit nothing when
        markers off; entry pre-seeded; visited.add before descend); the exact current line numbers
        (prd-resolve T1@L135, T2@L101, T3@L110, T4@L124, T5@L71; prd-markers M1@L137); and the title/
        describe/comment rewrites. READ BEFORE IMPLEMENTING.

# PATTERN FILE 1 — the 5 tests being rewritten (current code verified in-repo)
- file: tests/unit/core/prd-resolve.test.ts
  why: The diamond test (L135), the 3 cycle tests (L101 self / L110 mutual / L124 entry-pointed) inside
        describe('resolvePRD — cycle detection (path-based visited set)') (rename this describe), and the
        nested-chain test (L71, in the preceding describe). Real-tmpdir fixtures via mkdtempSync/tmp +
        writeFileSync; afterEach rmSync. resolvePRD imported from '../../../src/core/session-utils.js'.
  pattern: "writeFileSync(join(tmp, 'a.md'), 'X @a.md Y'); … await expect(resolvePRD(join(tmp, 'main.md'))).resolves.toBe('…');"
  gotcha: Fixtures (writeFileSync lines) stay byte-identical — change ONLY the it() title + inline
        comments + the .toBe(...) values. T1's split('S').length===3 asserted TWO S's (OLD) — drop/change.

# PATTERN FILE 2 — the markers cycle test (current code verified in-repo)
- file: tests/unit/core/prd-markers.test.ts
  why: The "does NOT warn for a cycle back-edge" test (L137). It spies console.warn, writes a.md='X @a.md Y',
        calls resolvePRD(a.md) (a IS the entry), and asserts warn NOT called + out==='X @a.md Y'. Only the
        out assertion changes (→ 'X  Y'); the warn assertion STAYS.
  gotcha: Elision is SILENT (expandIncludesRecursive's `continue` skips the stale-warning path) → the
        warn-NOT-called assertion remains valid. Do NOT drop it — it's the test's load-bearing point.

# READ-ONLY — the implementation whose behavior the tests now assert (S1, LANDED)
- file: src/core/session-utils.ts
  why: expandIncludesRecursive's elision branch (`if (visited.has(abs)) { if (markers) out += '<!-- @include-ref… -->'; … continue; }`)
        confirms: markers-off → emit NOTHING; the `continue` skips the stale-warning (elision is silent);
        visited.add(abs) runs BEFORE descending (so cycles/diamonds elide on second encounter); the entry
        is pre-seeded by resolvePRD. Do NOT modify this file (S1 owns it; S2 owns its JSDoc).
  critical: The double-space in the NEW outputs ('X  Y', 'A  END', 'A-TOP B-OPEN  B-CLOSE A-BOT') is
        CORRECT — the elided '@token' is dropped, leaving the spaces that surrounded it. Do not "fix" the
        double space to a single space.

# VERIFIED FACTS
- fact: "S1 expandIncludesRecursive elides a second-encounter token: markers-off → emit nothing; the `continue` skips the stale-warning (elision = NO warning)."
- fact: "Entry is pre-seeded in visited (resolvePRD) → self/back-edge refs elide. visited.add(abs) runs before descending → diamond/cycle second encounters elide."
- fact: "NEW outputs (traced against live S1): T1 '[S]\\n{}', T2 'X  Y', T3 'A-TOP B-OPEN  B-CLOSE A-BOT', T4 'A  END', T5 'start A(C via b:B()) end', M1 'X  Y'."
- fact: "T3's not.toContain('A-TOP A-TOP') still holds (a expanded exactly once). T1's split('S').length===3 asserted TWO S's — now ONE S; drop or change to .toBe(2)."
- fact: "M1's warn-NOT-called assertion STAYS VALID (elision is silent). Only M1's output assertion changes."
- fact: "All include tests use REAL tmpdir fixtures (mkdtempSync), NOT vi.mock — preserve this strategy."
```

### Current Codebase tree (relevant slice)

```bash
tests/unit/core/prd-resolve.test.ts   # EDIT — 5 tests (titles + comments + assertions) + 1 describe rename
tests/unit/core/prd-markers.test.ts   # EDIT — 1 test's output assertion (warn assertion stays)
src/core/session-utils.ts             # READ-ONLY (S1 owns expandIncludesRecursive; S2 owns peer JSDoc)
```

### Desired Codebase tree with files to be edited

```bash
tests/unit/core/prd-resolve.test.ts   # MODIFIED (5 it() rewrites + 1 describe rename; fixtures unchanged)
tests/unit/core/prd-markers.test.ts   # MODIFIED (1 output-assertion rewrite; warn assertion + fixtures unchanged)
# No source files. No new test files. No new tests (T2.S2 owns those).
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL — the NEW outputs contain DOUBLE SPACES where an '@token' was elided ('X  Y', 'A  END',
//   'A-TOP B-OPEN  B-CLOSE A-BOT', '[S]\n{}' where {} surrounded the elided @shared.md). This is CORRECT
//   — elision drops the token, leaving the surrounding whitespace. Do NOT "tidy" the double space to a
//   single space; that would assert the wrong output and fail.

// CRITICAL — Fixtures (the writeFileSync(join(tmp, '<file>'), '<content>') lines) are UNCHANGED. Edit
//   ONLY the it() title, the inline comments, and the .toBe(...) assertion values. If a fixture changes,
//   you've over-edited — revert it.

// CRITICAL — T1's `expect(out.split('S').length).toBe(3)` asserted TWO S's (OLD per-branch). Under dedup
//   there is ONE S → that assertion now FAILS. Drop it, or change to .toBe(2). (The toBe('[S]\n{}')
//   assertion already proves single-expansion; the split check is redundant either way — dropping is fine.)

// CRITICAL — M1's `expect(warn).not.toHaveBeenCalled()` STAYS. Elision is silent (expandIncludesRecursive's
//   `continue` skips the stale-warning path). Only M1's output line (toBe) changes. Dropping the warn
//   assertion would remove the test's whole point (proving a successful-resolution cycle emits no warning).

// CRITICAL — T3's `expect(result).not.toContain('A-TOP A-TOP')` STAYS — it still proves a is expanded
//   exactly once (the dedup guarantee). Keep it alongside the new toBe.

// GOTCHA — rename the describe('resolvePRD — cycle detection (path-based visited set)') — the
//   "(path-based visited set)" parenthetical is the OLD model (ancestry/per-branch). The new model is a
//   global flat set. Rename to name the invariant (e.g. 'global-flat dedup & elision (each file imported
//   at most once)'). The diamond test lives in this same describe — both cycles and diamonds are
//   "second-encounter elision" now.

// GOTCHA — the nested-chain test (T5) is in the PRECEDING describe block (recursive expansion), NOT the
//   cycle-detection block. Rewrite its title/assertion/comment in place; leave that describe block's
//   title alone (it still covers genuine recursive-expansion tests that are unaffected).

// GOTCHA — rewrite the inline comments too (the contract = titles + comments + assertions). Stale phrasing
//   to remove: "stays literal", "appears TWICE (once per branch); a flat set would wrongly deduplicate",
//   "the inner @a.md stays literal (cycle)", "both @c.md and @b.md in a.md resolve". Replace with dedup/
//   elision language citing §2.3.

// GOTCHA — do NOT add new tests. The new invariant tests (idempotency fixed point, exponential-blowup
//   guard, marker reference comment, diamond dedup) are T2.S2. T2.S1 only REWRITES existing assertions.

// GOTCHA — do NOT touch the unaffected tests (single-level, no-includes identity, base invariant, maxDepth,
//   ENOENT, directory, invalid UTF-8, EACCES, single-include markers, env toggle, nested-chain markers,
//   stale-warning missing/dir/non-.md, linear idempotency). They pass unchanged against S1.

// GOTCHA — do NOT edit src/core/session-utils.ts. S1 owns expandIncludesRecursive (code + its JSDoc +
//   inline comments); S2 (parallel) owns the peer functions' JSDoc. T2.S1 is test-only.

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check (the rewritten comments +
//   title strings may need minor formatting).

// GOTCHA — vitest 100% coverage on src is UNAFFECTED (no src change; test-only). The rewritten tests
//   exercise the same expandIncludesRecursive branches S1 already covered.
```

---

## Implementation Blueprint

### Data models and structure
None — test-only. The "structure" is 5 `it()` rewrites + 1 describe rename in prd-resolve, + 1 output-
assertion rewrite in prd-markers.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT tests/unit/core/prd-resolve.test.ts — rewrite the 5 tests + rename the describe
  - DESCRIBE rename: describe('resolvePRD — cycle detection (path-based visited set)') →
        describe('resolvePRD — global-flat dedup & elision (each file imported at most once)').
  - T1 (diamond, L135): title → 'deduplicates a diamond dependency — shared file expanded exactly once';
        assertion '[S]\n{S}' → '[S]\n{}'; DROP/CHANGE split('S').length===3 (now one S); rewrite comment.
  - T2 (self-cycle, L101): title → 'elides a self-cycle (second encounter drops the @token)';
        assertion 'X @a.md Y' → 'X  Y'; rewrite comment.
  - T3 (mutual cycle, L110): title → 'elides a mutual-cycle back-edge (a is imported exactly once)';
        assertion → 'A-TOP B-OPEN  B-CLOSE A-BOT'; KEEP not.toContain('A-TOP A-TOP'); rewrite comment.
  - T4 (entry-pointed, L124): title → 'elides an include pointing back at the entry (entry pre-seeded)';
        assertion 'A @main.md END' → 'A  END'; rewrite comment.
  - T5 (nested chain, L71): title → 'deduplicates a shared descendant across a nested chain (c imported
        exactly once)'; assertion → 'start A(C via b:B()) end'; rewrite comment.
  - DO NOT: change any writeFileSync fixture line, touch the unaffected tests, add new tests, or edit src.
  - EXPECTED: the 5 tests now PASS against S1's landed elision behavior.

Task 2: EDIT tests/unit/core/prd-markers.test.ts — rewrite M1's output assertion
  - M1 (L137 'does NOT warn for a cycle back-edge'): output assertion 'X @a.md Y' → 'X  Y';
        KEEP expect(warn).not.toHaveBeenCalled() (elision is silent).
  - DO NOT: change the fixture (a.md='X @a.md Y'), the resolvePRD(a.md) call, the warn spy, or any other
        test in the file.
  - EXPECTED: M1 passes (output elided; warn still not called).

Task 3: FORMAT + VERIFY
  - RUN: npm run fix → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/core/prd-resolve.test.ts tests/unit/core/prd-markers.test.ts → GREEN.
  - RUN (regression): npx vitest run tests/unit/core/prd-includes.test.ts → GREEN (unaffected; resolveIncludes
        is single-level, no dedup).
  - EXPECTED: all green. If a rewritten test fails, re-check the assertion against the verified NEW output
        (research §3) — most likely a single-vs-double-space typo or a missed split-length assertion. If an
        UNAFFECTED test fails, you accidentally edited a fixture or an unrelated assertion — revert it.
```

### Implementation Patterns & Key Details

```ts
// ---- prd-resolve.test.ts: the 5 rewritten assertions (fixtures UNCHANGED) ----
// T1 diamond:
expect(out).toBe('[S]\n{}');            // was '[S]\n{S}'; (drop split('S').length===3 — now one S)
// T2 self-cycle:
await expect(resolvePRD(join(tmp, 'main.md'))).resolves.toBe('X  Y');   // was 'X @a.md Y' (double space)
// T3 mutual cycle:
expect(result).toBe('A-TOP B-OPEN  B-CLOSE A-BOT');   // was '...B-OPEN @a.md B-CLOSE...' (double space)
expect(result).not.toContain('A-TOP A-TOP');          // KEPT — proves a imported exactly once
// T4 entry-pointed:
await expect(resolvePRD(join(tmp, 'main.md'))).resolves.toBe('A  END'); // was 'A @main.md END'
// T5 nested chain:
await expect(resolvePRD(join(tmp, 'main.md'))).resolves.toBe(
  'start A(C via b:B()) end'            // was 'start A(C via b:B(C)) end' — b's @c.md elided → B()
);

// ---- prd-markers.test.ts: M1 output assertion (warn assertion KEPT) ----
const out = await resolvePRD(join(tmp, 'a.md'));
expect(warn).not.toHaveBeenCalled();    // KEPT — elision is silent
expect(out).toBe('X  Y');               // was 'X @a.md Y' (double space)

// ---- the describe rename (prd-resolve.test.ts) ----
describe('resolvePRD — global-flat dedup & elision (each file imported at most once)', () => { … });
```

### Integration Points

```yaml
DEPENDS ON (must be LANDED):
  - P1.M1.T1.S1 (expandIncludesRecursive global-flat-dedup + elision): LANDED. The 6 rewritten assertions
        match S1's behavior exactly (verified by trace in research §3).

NO SOURCE CHANGES: T2.S1 is test-only. expandIncludesRecursive (S1) + its JSDoc (S1) + the peer-function
  JSDoc (S2, parallel) are all untouched.

SIBLING SUBTASKS (do NOT do them here):
  - P1.M1.T1.S2 (parallel, JSDoc-only): src/core/session-utils.ts peer-function JSDoc. Zero overlap.
  - P1.M1.T2.S2 (next, NEW invariant tests): adds idempotency-fixed-point / exponential-blowup-guard /
        marker-reference-comment / diamond-dedup tests. T2.S1 REWRITES existing tests; T2.S2 ADDS new
        ones. If both touch the same file, T2.S2 appends new it() blocks — coordinate by not editing the
        same lines.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run after the edits)
npm run lint && npm run format:check   # clean
# typecheck is unaffected (test-only change; assertions are string literals). Expected: clean.
# If prettier reformats a comment/title string, `npm run fix` already applied it.
```

### Level 2: Unit Tests (the PRIMARY gate)

```bash
npx vitest run tests/unit/core/prd-resolve.test.ts tests/unit/core/prd-markers.test.ts
# Expected: ALL GREEN — the 6 rewritten tests now pass against S1's elision behavior, alongside the
#   unaffected tests in both files. If a rewritten test fails, re-check the assertion vs research §3
#   (likely a single-vs-double-space typo, or T1's split('S').length===3 not dropped/changed).
npx vitest run tests/unit/core/prd-includes.test.ts
# Expected: GREEN (unaffected — resolveIncludes is single-level, no dedup). Regression check.
# Do NOT run the full `npm run test:run` as the gate — T2.S2's new tests may be in flux.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A — test-only. Smoke-confirm the rewrites landed + no fixture changed:
grep -n "global-flat dedup\|elides a self-cycle\|deduplicates a diamond\|X  Y\|A(C via b:B())" tests/unit/core/prd-resolve.test.ts tests/unit/core/prd-markers.test.ts
# Expected: the new titles + the new double-space assertions present. Confirm no writeFileSync fixture line
# changed: `git diff tests/unit/core/prd-resolve.test.ts tests/unit/core/prd-markers.test.ts` should show
# ONLY title/comment/assertion edits (the writeFileSync lines unchanged).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A — test-only, no runtime surface. Domain checks (record in commit message):
#   - 5 prd-resolve + 1 prd-markers test rewritten to assert global-flat-dedup + elision (each file
#     imported at most once; second-encounter refs elided).
#   - Double-space artifacts in the NEW outputs are CORRECT (the elided '@token' leaves surrounding ws).
#   - M1's warn-NOT-called assertion preserved (elision is silent); T3's not.toContain('A-TOP A-TOP') kept.
#   - Fixtures byte-identical; real-tmpdir strategy preserved; titles/describe/comments name the §2.3 invariant.
#   - Unaffected tests untouched; no source change; new invariant tests = T2.S2.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/core/prd-resolve.test.ts tests/unit/core/prd-markers.test.ts` GREEN.
- [ ] `npx vitest run tests/unit/core/prd-includes.test.ts` GREEN (regression — unaffected).

### Feature Validation
- [ ] T1 diamond asserts `'[S]\n{}'`; the `split('S').length===3` (two-S) assertion dropped/changed.
- [ ] T2 self-cycle asserts `'X  Y'`; T3 mutual asserts `'A-TOP B-OPEN  B-CLOSE A-BOT'` + keeps
      `not.toContain('A-TOP A-TOP')`; T4 entry-pointed asserts `'A  END'`; T5 chain asserts
      `'start A(C via b:B()) end'`.
- [ ] M1 asserts `out === 'X  Y'` AND `warn` NOT called (both).
- [ ] describe renamed (no "(path-based visited set)"); each rewritten `it` title names the §2.3 invariant.
- [ ] Stale inline comments rewritten (no "stays literal" / "appears TWICE").

### Code Quality Validation
- [ ] ONLY the two test files modified; fixtures (writeFileSync lines) byte-identical; real-tmpdir preserved.
- [ ] No source files modified; no new tests added (T2.S2 owns new invariant tests).
- [ ] Unaffected tests untouched; M1's warn assertion + T3's not.toContain assertion kept.

### Documentation & Deployment
- [ ] Mode A: test titles + describe + comments name the dedup/elision/idempotency invariant (cite §2.3).
- [ ] Commit message notes: 6 tests rewritten to assert global-flat-dedup + elision (each file imported at
      most once); fixtures unchanged; double-space artifacts correct; M1 warn assertion + T3 not.toContain
      kept; new invariant tests = T2.S2; no source change.

---

## Anti-Patterns to Avoid

- ❌ Don't "tidy" the DOUBLE SPACE in the NEW outputs to a single space — the elided `@token` leaves the
      surrounding whitespace; `'X  Y'` / `'A  END'` / `'A-TOP B-OPEN  B-CLOSE A-BOT'` are correct.
- ❌ Don't change the FIXTURES (writeFileSync lines) — edit only titles, inline comments, and assertion
      values. A fixture change is an over-edit; revert it.
- ❌ Don't keep T1's `expect(out.split('S').length).toBe(3)` — it asserted TWO S's (OLD); under dedup there
      is ONE S → it fails. Drop it or change to `.toBe(2)`.
- ❌ Don't drop M1's `expect(warn).not.toHaveBeenCalled()` — elision is silent (the `continue` skips the
      stale-warning); the assertion stays valid and is the test's point. Only M1's output line changes.
- ❌ Don't drop T3's `expect(result).not.toContain('A-TOP A-TOP')` — it still proves single-expansion.
- ❌ Don't add NEW tests (idempotency fixed point / blowup guard / marker-ref comment / diamond dedup) —
      those are T2.S2. T2.S1 only rewrites existing assertions.
- ❌ Don't touch the unaffected tests (single-level, base invariant, maxDepth, ENOENT, errors, markers,
      linear idempotency) — they pass unchanged against S1.
- ❌ Don't edit `src/core/session-utils.ts` — S1 owns expandIncludesRecursive; S2 (parallel) owns the peer
      JSDoc. T2.S1 is test-only.
- ❌ Don't leave the stale describe title "(path-based visited set)" or the stale inline comments ("stays
      literal", "appears TWICE … flat set would wrongly deduplicate") — rewrite them to name the new model.
- ❌ Don't run the full `npm run test:run` as the gate — T2.S2's new tests may be in flux. Gate on the two
      rewritten files + the prd-includes regression.

---

## Confidence Score

**10/10** — one-pass implementation success likelihood.

Rationale: This is a test-only rewrite of 6 existing tests where every NEW expected output is already
**traced and verified against the live S1 implementation** (research §3 — each output confirmed by walking
expandIncludesRecursive's elision branch). The exact current code of all 6 tests is confirmed with line
numbers, the precise before/after (titles + comments + assertions) is specified, the elision-is-silent
fact (M1's warn assertion stays valid) is proven from the `continue` path, and the two assertion-keeping
directives (T3's `not.toContain`, M1's warn-not-called) + the one assertion-dropping directive (T1's
split-length) are explicit. The fixtures are byte-identical (only expectations change) and the real-tmpdir
strategy is preserved. The scope boundary (no source; no new tests = T2.S2; S2's JSDoc is disjoint) is
crisp. The only residual risk is a single-vs-double-space typo in a rewritten `.toBe(...)` — caught
immediately by the test run (and the PRP flags the double-space-as-correct gotcha prominently). No
external/runtime unknowns.