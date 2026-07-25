# S3 Gap Analysis — #detectInterruptedBugfix numbered-child scan

## Purpose
S1 (`nextBugfixDir`/`generateBugfixHash` in `session-utils.ts`) is **Complete**
and S2 (`runQACycle` numbered creation) is **Implementing**. S3 is the detection-
side counterpart: rewrite `#detectInterruptedBugfix()` (prp-pipeline.ts:2045) to
scan numbered `bugfix/NNN_hash/` children instead of the flat `bugfix/` dir, and
switch the Backlog validation from `BacklogSchema` (strict, write-time) to
`BacklogReadSchema` (lenient, read-time — per contract item 3).

This file enumerates the proven facts against the live working tree.

---

## Proven facts (verified against working tree, 2025-07-24)

### FACT 1 — the exact current implementation
`src/workflows/prp-pipeline.ts:2045-2095` — `#detectInterruptedBugfix(sessionPath)`:
- builds `bugfixDir = resolve(sessionPath, 'bugfix')` (FLAT — line 2051).
- 6-step interrupted-state check on `bugfixDir`:
  1. `stat(TEST_RESULTS.md)` throws → return `null` (never hunted).
  2. `stat(tasks.json)` throws → return `bugfixDir` (missing).
  3. `readFile(tasks.json)` throws → return `bugfixDir` (unreadable).
  4. `content.trim() === ''` → return `bugfixDir` (empty).
  5. `JSON.parse(content)` throws → return `bugfixDir` (corrupt JSON).
  6. `!BacklogSchema.safeParse(parsed).success` → return `bugfixDir` (invalid Backlog).
  7. else → return `null` (healthy).
- JSDoc at lines 2030-2044 ("Detect a bugfix dir left in an interrupted state").
- Uses `stat` + `readFile` from `node:fs/promises` (dynamic import at 2050).

### FACT 2 — the caller (mutual-consistency consumer)
`src/workflows/prp-pipeline.ts:1807`:
  `const interruptedDir = await this.#detectInterruptedBugfix(sessionPath);`
- Gated by `canAutoResume` (line 1793-1796): mode !== 'validate' AND
  `SKIP_BUG_FINDING !== 'true'` AND `!sessionPath.includes('bugfix')`.
- If `interruptedDir` is truthy → `#runBugFixCycle(interruptedDir, prdContent)`
  (resume, skip fresh hunt).
- If null → fresh bug hunt runs (Phase 1).
- **S3's contract preserves this caller contract**: return the interrupted dir
  PATH (now a numbered child) or `null`. The caller passes the path straight to
  `#runBugFixCycle`; the numbered path still contains `'bugfix'`, so
  `FixCycleWorkflow`'s `includes('bugfix')` check passes unchanged (architecture
  doc confirms).

### FACT 3 — BacklogSchema → BacklogReadSchema swap (contract item 3)
- `BacklogSchema` (strict, write-time) is imported at `prp-pipeline.ts:36` and
  used ONLY at line 2086 (`!BacklogSchema.safeParse(parsed).success`).
- `BacklogReadSchema` (lenient, read-time) is EXPORTED at
  `src/core/models.ts:975` (added by P2.M2.T1.S1). Its JSDoc (967-973) states:
  "A read-time hard reject on a documentation-format field is too strict for a
  recovery-oriented state file (PRD §5.1): the pipeline must SURVIVE legacy,
  hand-edited, externally-authored, and test-fixture sessions."
- **S3 swap**: `import { BacklogReadSchema }` (add to the models import block at
  line 36 — `BacklogSchema` may stay imported if used elsewhere; grep shows
  `BacklogSchema` only at line 36 import + line 2086 use + line 2037 JSDoc text,
  so S3 can REPLACE the import line 36 `BacklogSchema` → `BacklogReadSchema`
  AND the line-2086 usage, OR keep both. Cleanest: swap both (no other use of
  BacklogSchema remains in this file). The JSDoc text at line 2037 mentions
  "BacklogSchema validation" — update to "BacklogReadSchema" for truthfulness.

### FACT 4 — the scan algorithm (contract item 3 LOGIC a-f)
(a) Read `sessionPath/bugfix/` via `readdir` (catch ENOENT → return null; no
    bugfix dir = never hunted).
(b) Filter entries matching `/^\d{3}_/` (numbered children only).
(c) Sort by sequence number DESCENDING (most recent first).
(d) For each numbered child dir: apply the EXISTING 6-step interrupted check
    (TEST_RESULTS.md exists → tasks.json missing/empty/corrupt-JSON/invalid-
    BacklogReadSchema → return this dir as interrupted).
(e) If a child has a valid tasks.json (healthy/completed) → SKIP it, continue
    to older children.
(f) Return the FIRST interrupted child (most recent), or null if none.

**Reuse from S1**: `BUGFIX_DIR_PATTERN = /^(\d{3})_/` exists at
`session-utils.ts:782` as a MODULE-LEVEL const but is NOT exported. S3 has two
clean options:
  - (i) EXPORT `BUGFIX_DIR_PATTERN` from session-utils.ts and import it in
    prp-pipeline.ts (DRY; but S1 is "Complete" — touching it risks re-test). OR
  - (ii) define a LOCAL `const BUGFIX_CHILD_PATTERN = /^\d{3}_/` inside
    `#detectInterruptedBugfix` (or module-level in prp-pipeline.ts). The regex
    is trivial; no DRY benefit worth re-opening S1.
**Decision: option (ii)** — a local regex. Avoids touching S1's completed +
tested helper module; the regex is a 1-liner. (S1's `BUGFIX_DIR_PATTERN` is
captured in a closure; prp-pipeline.ts cannot import a non-exported const.)

### FACT 5 — sort + sequence extraction
Each numbered child name is `NNN_<12hex>` (e.g. `002_a1b2c3d4e5f6`). Extract NNN
via `BUGFIX_CHILD_PATTERN.exec(name)[1]` → `parseInt(..., 10)`. Sort descending
so the MOST RECENT (highest NNN) is checked first. Return the first interrupted.
This matches the contract's "Return the FIRST interrupted child found (most
recent)".

### FACT 6 — the fs mock gap (critical, mirrors S2)
`tests/unit/workflows/prp-pipeline.test.ts:17-23` — `vi.mock('node:fs/promises')`
lists `readFile, writeFile, mkdir, copyFile, stat` but NOT `readdir`.
- S2 (Implementing) ADDS `readdir: vi.fn().mockRejectedValue(<ENOENT>)` to this
  mock for `runQACycle`'s `nextBugfixDir` call.
- S3's `#detectInterruptedBugfix` ALSO calls `readdir(sessionPath/bugfix/)`. So
  S3 DEPENDS on S2's `readdir` mock addition (or adds it itself if S2 hasn't).
  **Treat S2's mock addition as a contract**: when S3 lands, the fs mock WILL
  include `readdir` (S2 adds it). S3's tests OVERRIDE `readdir` per-test to
  return numbered Dirent arrays.
- The existing `describe('resume interrupted bugfix breakdowns')` suite
  (lines 809-989) uses `mockStat`/`mockReadFile` with path-suffix matching
  (`s.endsWith('TEST_RESULTS.md')`). S3 must extend this pattern to include the
  numbered child path in the suffix matching (e.g.
  `s.includes('TEST_RESULTS.md')` — the numbered dir contains the child path
  `bugfix/NNN_hash/TEST_RESULTS.md`, so `endsWith` still works).

### FACT 7 — the existing test stubs must be updated for numbered dirs
Current `stubMissingTasks()` (line 858):
```ts
mockStat.mockImplementation(async (p: string) => {
  const s = String(p);
  if (s.endsWith('TEST_RESULTS.md')) return {}; // present
  // ...ENOENT...
});
```
After S3, `#detectInterruptedBugfix` first `readdir`s `bugfix/` to find
`NNN_hash` children, THEN stats each child's TEST_RESULTS.md/tasks.json. So the
existing tests will BREAK unless `readdir` returns a numbered child (e.g.
`[{name:'001_aaaaaaaaaaaa', isDirectory:()=>true}]`). The `mockStat` suffix
matching still works because the paths become
`/tmp/plan/008_test/bugfix/001_aaaaaaaaaaaa/TEST_RESULTS.md` (endsWith matches).
**S3 must update the existing resume tests to stub `readdir`** (add a numbered
child) + ADD new tests for the multi-child scan (most-recent-interrupted wins,
healthy-skipped-then-older-interrupted, all-healthy → null, ENOENT on bugfix/
→ null, non-`NNN_` entries ignored).

### FACT 8 — 100% branch coverage
vitest.config.ts enforces 100/100/100/100 on `src/**/*.ts`. S3's rewrite of
`#detectInterruptedBugfix` introduces new branches:
- readdir ENOENT → null.
- readdir success → filter (empty after filter → null; non-empty → sort → loop).
- per-child: TEST_RESULTS.md missing (child not interrupted — but per contract,
  a numbered child without TEST_RESULTS.md is "never hunted"? NO — see FACT 9)
  → continue to next child.
- per-child: tasks.json missing → return child (interrupted).
- per-child: readFile throws → return child.
- per-child: empty → return child.
- per-child: JSON.parse throws → return child.
- per-child: !BacklogReadSchema.safeParse → return child.
- per-child: healthy → continue (skip).
- loop exhausts with no interrupted → return null.
EVERY branch needs a test. The existing suite covers most per-child branches
(once `readdir` returns a child); S3 adds the scan-control branches
(ENOENT-on-bugfixdir, empty-after-filter, healthy-skip-then-older-interrupted,
all-healthy→null, non-NNN_ ignored).

### FACT 9 — per-child "TEST_RESULTS.md missing" semantics
The flat-dir check (FACT 1 step 1) treats "no TEST_RESULTS.md" as "never hunted
→ null" because there's only ONE bugfix dir. With numbered children, a child
WITHOUT TEST_RESULTS.md is an anomaly (S2's `runQACycle` ALWAYS copies
TEST_RESULTS.md into the numbered dir it creates). Per the contract's per-child
check (item 3d: "TEST_RESULTS.md exists → tasks.json missing/empty/corrupt →
return this dir as interrupted"), a child WITHOUT TEST_RESULTS.md is NOT
interrupted (it's not a real bugfix iteration) → SKIP it and continue to older
children. This is the correct semantics: only a child that HAS TEST_RESULTS.md
but a bad tasks.json is "interrupted." (A child with neither was never properly
created — skip.)

### FACT 10 — scope fences
- S1 (session-utils helpers): DONE — do NOT touch.
- S2 (runQACycle creation): Implementing — do NOT touch runQACycle.
- S4 (lifecycle tests): Planned — S3 adds the detection-scan unit tests it
  needs for coverage; S4 owns the broader lifecycle suite. (Coordinate: S3's
  detection tests live in the existing `prp-pipeline.test.ts` resume describe
  block; S4's lifecycle suite is separate.)
- `FixCycleWorkflow`: READ-ONLY (numbered path still contains 'bugfix').
- `PRD.md` / `tasks.json` / `prd_snapshot.md` / `vitest.config.ts`: READ-ONLY.
- `docs/CONFIGURATION.md` / `README.md` / `docs/ARCHITECTURE.md`: P3.M1.T2.S1
  owns changeset docs. S3's contract item 5 (DOCS, Mode A) is JUST the JSDoc on
  `#detectInterruptedBugfix` — no external doc edits.

## Scope decision
S3 edits exactly **2 files**:
1. `src/workflows/prp-pipeline.ts`:
   - Import: add `BacklogReadSchema` to the models import (line 36); remove
     `BacklogSchema` if no other use (grep confirms only line 2086 + the JSDoc
     text — safe to swap).
   - Rewrite `#detectInterruptedBugfix()` (lines 2045-2095): readdir scan +
     per-child check + BacklogReadSchema. Update its JSDoc (Mode A, item 5).
2. `tests/unit/workflows/prp-pipeline.test.ts`:
   - Ensure `readdir` is in the fs mock (S2 adds it; S3 verifies).
   - Update the existing `describe('resume interrupted bugfix breakdowns')`
     suite: each test stubs `readdir` to return a numbered child so the scan
     reaches the per-child checks.
   - ADD new tests for the multi-child scan semantics (FACT 8 branch list).

No new source files. No behavior change for the healthy/never-hunted cases
(those return null exactly as before). The RESUME behavior now works across
multiple numbered iterations (contract item 4 OUTPUT).