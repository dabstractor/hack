# Research — P1.M1.T2.S1: Rewrite existing diamond/cycle tests to assert dedup + elision

## 1. What this task does

S1 (Complete) rewrote `expandIncludesRecursive` to **global-flat-dedup + elision** (a single shared
visited set; first encounter expands; every later ref — diamond sibling, cycle, back-edge — is ELIDED,
emitting nothing when markers are off). **Five existing tests in `prd-resolve.test.ts` + one in
`prd-markers.test.ts` assert the OLD per-branch/literal-survivor behavior and now FAIL.** T2.S1 rewrites
those 6 tests' titles, comments, and assertions to lock in the new §2.3 invariant. **Fixtures (file
contents) + the real-tmpdir strategy are UNCHANGED** — only expectations + naming change. Test-only; no
source. S2 (parallel) is JSDoc-only on the peer functions — zero overlap.

## 2. S1 elision behavior — VERIFIED against the live implementation

`expandIncludesRecursive` (session-utils.ts): on a token whose `abs` is already in `visited`:
```ts
if (visited.has(abs)) {
  if (markers) out += `<!-- @include-ref: ${token} -->`;   // markers ON → reference comment
  // markers OFF → emit NOTHING (elide entirely)
  last = idx + m[0].length;
  continue;   // skips the stale-warning + marker-wrap (elision = SUCCESSFUL resolution → NO warning)
}
```
- The entry file is pre-seeded in `visited` (by `resolvePRD`) → self/back-edge refs elide.
- `visited.add(abs)` runs BEFORE descending → cycles/diamonds elide on the second encounter.
- **Elision is silent** (the `continue` skips the `console.warn` stale-warning path) → the
  prd-markers "no warn for a cycle back-edge" assertion STAYS VALID.

## 3. The 6 affected tests — exact current code + verified NEW expected output

I traced each through the live S1 implementation; every NEW output below is confirmed correct.

### `tests/unit/core/prd-resolve.test.ts`

**Test 1 — "expands a diamond in both branches (path-based visited set)" (L135)**
Fixture: shared='S', a='[@shared.md]', b='{@shared.md}', main='@a.md\n@b.md'.
- OLD: `expect(out).toBe('[S]\n{S}');` + `expect(out.split('S').length).toBe(3);` (two S's)
- NEW: `expect(out).toBe('[S]\n{}');` — shared expands once (first via a); b's @shared.md ELIDED.
  The `split('S').length === 3` (two S's) is now WRONG (one S) → change to `.toBe(2)` or drop it.
- Trace: main→a (visited+ a); a→shared (visited+ shared, 'S') → '[S]'; main→b (visited+ b); b→shared
  (visited HAS shared) → elide → '{}'. Result '[S]\n{}'. ✓

**Test 2 — "terminates a self-cycle leaving the back-edge literal" (L101, in `describe('… cycle detection')`)**
Fixture: a='X @a.md Y', main='@a.md'.
- OLD: `…resolves.toBe('X @a.md Y');` (literal survivor)
- NEW: `…resolves.toBe('X  Y');` — inner @a.md ELIDED (note the DOUBLE SPACE where '@a.md' was).

**Test 3 — "terminates a mutual cycle leaving the back-edge literal" (L110)**
Fixture: a='A-TOP @b.md A-BOT', b='B-OPEN @a.md B-CLOSE', main='@a.md'.
- OLD: `expect(result).toBe('A-TOP B-OPEN @a.md B-CLOSE A-BOT');`
- NEW: `expect(result).toBe('A-TOP B-OPEN  B-CLOSE A-BOT');` — b's @a.md ELIDED (DOUBLE SPACE between
  B-OPEN and B-CLOSE).
- KEEP: `expect(result).not.toContain('A-TOP A-TOP');` — still holds (a expanded exactly once).

**Test 4 — "detects an include pointing back at the entry as a cycle" (L124)**
Fixture: a='A @main.md END', main='@a.md'.
- OLD: `…resolves.toBe('A @main.md END');`
- NEW: `…resolves.toBe('A  END');` — entry-pointed @main.md ELIDED (entry pre-seeded in visited).

**Test 5 — "recursively expands a nested chain (entry→a→b→c)" (L71)**
Fixture: c='C', b='B(@c.md)', a='A(@c.md via b:@b.md)', main='start @a.md end'.
- OLD: `…resolves.toBe('start A(C via b:B(C)) end');` (c expands twice)
- NEW: `…resolves.toBe('start A(C via b:B()) end';` — c='C' expands once (first encounter: a's @c.md);
  b's @c.md ELIDED → 'B()'. Trace: a's tokens in order → @c.md (expand C, visited+c), @b.md (expand b;
  b's @c.md: visited HAS c → elide → 'B()'). a → 'A(C via b:B())'. ✓

### `tests/unit/core/prd-markers.test.ts`

**M1 — "does NOT warn for a cycle back-edge (file exists)" (L137)**
Fixture: a='X @a.md Y'; `resolvePRD(join(tmp,'a.md'))` (a IS the entry).
- OLD: `expect(out).toBe('X @a.md Y');` + `expect(warn).not.toHaveBeenCalled();`
- NEW: `expect(out).toBe('X  Y');` + `expect(warn).not.toHaveBeenCalled();` — output changes (self-include
  elided); the **warn-NOT-called assertion is UNCHANGED** (elision is silent — the `continue` skips the
  stale-warning). Only the output line changes.

## 4. Titles + comments + describe rename (Mode A — name the §2.3 invariant)

Per the contract / test-impact-analysis: titles + describe + inline comments must NAME the invariant
they lock in (dedup / elision / idempotency), and the stale "(path-based visited set)" / "stays literal"
/ "appears TWICE (once per branch)" phrasing must go.

- **describe block** "resolvePRD — cycle detection (path-based visited set)" (the block holding Tests
  1–4 + the diamond) → rename to the new model, e.g. `describe('resolvePRD — global-flat dedup &
  elision (each file imported at most once)', …)`. (It holds both cycle AND diamond tests — both are
  "second-encounter elision" under the new model.)
- **Test titles** → e.g.:
  - T1 "deduplicates a diamond dependency — shared file expanded exactly once"
  - T2 "elides a self-cycle (second encounter drops the @token)"
  - T3 "elides a mutual-cycle back-edge (a is imported exactly once)"
  - T4 "elides an include pointing back at the entry (entry pre-seeded)"
  - T5 "deduplicates a shared descendant across a nested chain (c imported exactly once)"
  - M1 keep "does NOT warn for a cycle back-edge (file exists)" — still accurate (elision is silent);
    optionally append "(elided, not literal)".
- **Inline comments** in each test describe OLD behavior ("stays literal", "appears TWICE … a flat set
  would wrongly deduplicate", "the inner @a.md stays literal") → rewrite to describe dedup/elision
  (first encounter expands; subsequent refs elide; cite §2.3). The fixture comment lines (file contents)
  are UNCHANGED.

## 5. Tests UNAFFECTED (leave alone — confirmed in test-impact-analysis.md)

- prd-resolve: single-level expand, no-includes identity, base invariant (subdir resolution), maxDepth
  gate, ENOENT silent verbatim, directory silent verbatim, invalid UTF-8, EACCES.
- prd-markers: single-include markers, env toggle, nested-chain markers, stale-warning (missing/dir/
  non-.md), existing idempotency (linear chains, no diamonds).
- prd-includes (resolveIncludes, single-level): entirely unaffected.
- (New invariant tests — idempotency fixed point, exponential-blowup guard, marker reference comment,
  diamond dedup — are T2.S2, NOT this task.)

## 6. Parallel-execution / file-disjoint check

- **vs S2 (in-flight, JSDoc-only):** S2 edits `src/core/session-utils.ts` JSDoc/comments. T2.S1 edits
  `tests/unit/core/prd-resolve.test.ts` + `tests/unit/core/prd-markers.test.ts`. **Zero overlap.**
- **vs S1 (Complete):** T2.S1 consumes S1's landed `expandIncludesRecursive` behavior; no source change.
- **vs T2.S2 (next):** T2.S2 ADDS new invariant tests (idempotency/blowup/marker-ref/diamond) —
  distinct from T2.S1's REWRITE of existing tests. No file overlap (T2.S2 may append to the same files,
  but T2.S1 rewrites existing `it()` blocks while T2.S2 adds new ones — coordinate by appending, not
  editing the same lines).

## 7. Decisions locked

- **Fixtures UNCHANGED** (file contents identical); only titles + inline comments + assertions change.
- **Real-tmpdir strategy preserved** (no vi.mock — recursion/dedup is only trustworthy against real files).
- **6 tests rewritten**: 5 in prd-resolve (T1–T5) + 1 output-assertion in prd-markers (M1).
- **describe rename** to name the global-flat-dedup/elision model (drop "(path-based visited set)").
- **M1's warn-NOT-called assertion stays** (elision is silent); only its output line changes.
- **T3's `not.toContain('A-TOP A-TOP')` stays** (still proves single-expansion).
- **T1's `split('S').length===3` is DROPPED/changed** to `.toBe(2)` (one S now) — it asserted the OLD
  two-S behavior.
- **No source/docs change** — test-only (Mode A = the test titles/comments name the invariant).
- **NEW invariant tests are T2.S2** — T2.S1 only rewrites existing assertions; do not add new tests.