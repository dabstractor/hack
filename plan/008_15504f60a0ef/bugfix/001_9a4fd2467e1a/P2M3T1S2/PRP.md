# PRP — P2.M3.T1.S2: Fix research-queue mock re-exports for ResearchTimeoutError instanceof checks

---

## Goal

**Feature Goal**: Eliminate the **`[vitest] No "ResearchTimeoutError" export is
defined on the "...research-queue.js" mock`** TypeError that fails **9 tests in
`tests/unit/core/task-traversal.test.ts`** (bugfix Issue 3A, "Mock Drift:
ResearchTimeoutError Re-export"). The root cause: `task-traversal.test.ts` (and
its sibling `task-dependencies.test.ts`) mock `research-queue.js` with a plain
sync factory `() => ({ ResearchQueue: vi.fn(...) })` that **omits**
`importOriginal`, so the mock's `ResearchTimeoutError` binding is `undefined`.
The **code under test** — `src/core/task-orchestrator.ts:903` — does
`error instanceof ResearchTimeoutError`; when a test drives the missing-PRP path
(the mock's `getPRP()` returns `null`), that `instanceof` dereferences the
clobbered class and throws. The canonical fix (already proven in
`tests/unit/core/task-orchestrator.test.ts:98`, which passes 120/120) is to make
the `vi.mock` factory `async`, call `importOriginal`, spread the real exports,
then override only `ResearchQueue` — preserving the real `ResearchTimeoutError`
class identity for `instanceof`. **Pure test-only change — no source edits, no
docs.** Closes the research-queue-mock half of P2.M3.T1 (S3 = groundswell mock).

**Deliverable**:
1. **`tests/unit/core/task-traversal.test.ts`** — MODIFY the `vi.mock` at line 58
   to use the `async importOriginal` pattern from `task-orchestrator.test.ts:98`:
   spread the real exports, then override `ResearchQueue` with the **exact same
   mock body the file already has** (`enqueue`/`getPRP`/`processNext`/`getStats`).
   This preserves the real `ResearchTimeoutError` so `task-orchestrator.ts:903`'s
   `instanceof` works. **9 currently-failing tests → pass.**
2. **`tests/unit/core/task-dependencies.test.ts`** — MODIFY the byte-identical
   `vi.mock` at line 51 to the same `async importOriginal` pattern (same mock
   body). This file currently PASSES, but only **accidentally** — its tests never
   drive a code path reaching line 903, so the clobbered class is never
   dereferenced. Applying the fix removes a latent landmine (the next test that
   exercises `executeSubtask`/`processNextItem` would hit the identical
   TypeError), unifies all three research-queue-mocking files on ONE pattern, and
   is behavior-preserving for its existing tests. **(See "Why fix
   task-dependencies too" below for the rationale.)**

**Success Definition**:
- `npx vitest run tests/unit/core/task-traversal.test.ts` → **0 failures**
  (was 9). The `[vitest] No "ResearchTimeoutError" export …` error is gone.
- `npx vitest run tests/unit/core/task-dependencies.test.ts` → stays green (no
  regression; behavior-preserving).
- `npx vitest run tests/unit/core/task-orchestrator.test.ts` → stays green
  (untouched, the reference implementation).
- A full-suite grep for the error string returns **no matches** in any
  research-queue-mocking file: `npx vitest run 2>&1 | grep -c "No \"ResearchTimeoutError\" export"` → 0.
- `npm run typecheck`, `npm run lint`, `npm run format:check` → GREEN (the
  `importOriginal<typeof import('…')>()` generic is copied verbatim from the
  canonical file).

---

## User Persona (if applicable)

N/A — test-suite-only fix. The "user" is the contributor running
`npm run test:run` / `npm run validate` (PRD §6.3 Level-2 gate).

---

## Why

- **PRD compliance**: PRD (bugfix doc) Issue 3 / §3A "Mock Drift:
  ResearchTimeoutError Re-export" explicitly calls out this exact failure mode
  and names `task-traversal.test.ts` and `task-dependencies.test.ts` as the
  files to check. The test suite being red blocks the PRD §6.3 Level-2
  unit-test gate and §4.4 validation/abort-on-failure (which assume a green
  suite).
- **Item contract (item 3 LOGIC)**: *"For each test file that mocks
  research-queue.js AND uses ResearchTimeoutError (directly or via instanceof in
  the code under test): change the vi.mock to use async importOriginal to spread
  the real exports before overriding ResearchQueue. … For files that mock
  research-queue but don't touch ResearchTimeoutError, no change needed."*
  S2 implements the fix on task-traversal (which fires the instanceof) and,
  defense-in-depth, on task-dependencies (which has the identical clobbering
  mock and is one test away from the same failure).
- **Closes part of P2.M3.T1**: the research-queue-mock slice. (S1 = PRP-generator
  mock, running in parallel; S3 = groundswell mock, planned.)
- **Root cause is verified, not assumed**: I ran `npx vitest run` on all four
  relevant files and reproduced the exact `[vitest] No "ResearchTimeoutError"
  export …` error pointing at `task-orchestrator.ts:903` from inside
  `task-traversal.test.ts`. The canonical file (`task-orchestrator.test.ts`)
  passes 120/120 with the `importOriginal` pattern.

### Why fix task-dependencies too (the "no change NEEDED" call)
The contract says files that don't *touch* `ResearchTimeoutError` need no change.
Strictly, task-dependencies qualifies. BUT its mock is **byte-identical** to
task-traversal's burning mock, and its green status is **accidental**: no current
test reaches `task-orchestrator.ts:903`. The next contributor who adds a
`processNextItem`/`executeSubtask` test there will hit the identical TypeError
and must re-derive the root cause. Fixing it now is (a) behavior-preserving for
existing tests, (b) removes the latent landmine, (c) unifies all three
research-queue-mocking files on the ONE canonical pattern, and (d) trivially
satisfies "no change needed" (allowed ≠ forbidden). Risk ≈ 0 (the identical
pattern is proven green in task-orchestrator.test.ts). This PRP **mandates** the
fix on both files and documents the rationale so the implementing agent does not
"helpfully" skip task-dependencies and leave the mine armed.

### Out of scope (hard fences)
- **`src/`** → DO NOT EDIT. The source `instanceof ResearchTimeoutError` checks
  (task-orchestrator.ts:903, 906) are **correct** — the bug is purely that mocks
  clobber the class. (Coverage: `src/**/*.ts` is 100%-enforced; S2 touches no
  `src/`, so coverage is unaffected.)
- **`tests/unit/core/task-orchestrator.test.ts`** → DO NOT EDIT. Already uses the
  canonical `importOriginal` pattern (line 98); passes 120/120. It is the
  **reference** to copy, not a target.
- **`tests/unit/core/research-queue.test.ts`** → DO NOT EDIT. Tests the REAL
  class; does not mock `research-queue.js`.
- **Other rotted suites** → OUT OF SCOPE. The PRP-generator file-contract path
  is **S1** (parallel; edits `tests/unit/agents/prp-generator.test.ts` +
  `src/agents/prp-generator.ts`). The groundswell module mock is **S3**.
  `executeBacklog` (P2.M1) and `ContextScopeSchema` (P2.M2) are already complete.
  The full `npm run test:run` may STILL be red from S1/S3 and other unrelated
  rot — that is EXPECTED. S2's success is narrowly: the `ResearchTimeoutError`
  instanceof TypeError is gone. Do not chase unrelated failures.
- **`PRD.md` / `tasks.json` / `prd_snapshot.md`** → READ-ONLY.
- **Zero file overlap with parallel S1** — S1 edits
  `tests/unit/agents/prp-generator.test.ts` + `src/agents/prp-generator.ts`; S2
  edits `tests/unit/core/task-traversal.test.ts` +
  `tests/unit/core/task-dependencies.test.ts`. No conflict possible.

---

## What

### User-visible behavior
None. Test-only fix. `npm run test:run` no longer reports the 9
`task-traversal.test.ts` failures caused by the missing `ResearchTimeoutError`
export.

### Technical requirements (exact contract — item 3)

**(a) `tests/unit/core/task-traversal.test.ts` — convert the research-queue mock
to `async importOriginal` (line 58).**

The current mock (lines 57–67):
```ts
// Mock the ResearchQueue class
vi.mock('../../../src/core/research-queue.js', () => ({
  ResearchQueue: vi.fn().mockImplementation(() => ({
    enqueue: vi.fn().mockResolvedValue(undefined),
    getPRP: vi.fn().mockReturnValue(null),
    processNext: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn().mockReturnValue({ queued: 0, researching: 0, cached: 0 }),
  })),
}));
```

Replace with (the ONLY structural change is: async factory + `importOriginal` +
`...actual` spread; the `ResearchQueue` mock body is byte-for-byte identical):
```ts
// Mock the ResearchQueue class — use importOriginal so the REAL
// ResearchTimeoutError survives mocking (task-orchestrator.ts:903 does
// `error instanceof ResearchTimeoutError`; without importOriginal the class
// binding is undefined → "[vitest] No ResearchTimeoutError export" TypeError).
vi.mock('../../../src/core/research-queue.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../src/core/research-queue.js')>();
  return {
    ...actual,
    ResearchQueue: vi.fn().mockImplementation(() => ({
      enqueue: vi.fn().mockResolvedValue(undefined),
      getPRP: vi.fn().mockReturnValue(null),
      processNext: vi.fn().mockResolvedValue(undefined),
      getStats: vi.fn().mockReturnValue({ queued: 0, researching: 0, cached: 0 }),
    })),
  };
});
```

**(b) `tests/unit/core/task-dependencies.test.ts` — identical transformation (line 51).**

The current mock (lines 50–60) is **byte-identical** to task-traversal's
(the same 4-method `ResearchQueue` body). Apply the exact same
`async importOriginal` conversion, preserving its identical mock body. Add the
same explanatory comment.

**Why a comment is valuable here:** the non-obvious reason for `importOriginal`
(a class that the test file never names, referenced only by the code under test)
is exactly the kind of thing a future contributor will "simplify" back to a sync
factory and silently re-break. A one-line comment pointing at
`task-orchestrator.ts:903` makes the constraint durable.

**(c) No other changes.** Do not edit any other mock in either file, any other
test, any `src/` file, or any doc.

### Success Criteria
- [ ] `task-traversal.test.ts`: 9 currently-failing tests now PASS; the
      `[vitest] No "ResearchTimeoutError" export …` error is gone.
- [ ] `task-dependencies.test.ts`: all previously-passing tests STILL pass (no
      regression).
- [ ] `task-orchestrator.test.ts`: untouched, still passes 120/120.
- [ ] Both modified mocks use `async importOriginal` + `...actual` spread +
      identical `ResearchQueue` body to their pre-edit form.
- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check` → GREEN.
- [ ] No `src/` edit; no edit to `task-orchestrator.test.ts` or
      `research-queue.test.ts`.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** This is a 2-file, mechanical, behavior-preserving test fix. Its
correctness hinges on six non-obvious facts, all pinned with exact file:line
anchors: (1) the **root cause is in the code under test, not the test** —
`src/core/task-orchestrator.ts:903` does `error instanceof ResearchTimeoutError`,
importing the class from `./research-queue.js` (line 49); (2) a `vi.mock` factory
WITHOUT `importOriginal` returns ONLY the keys it lists, so `ResearchTimeoutError`
becomes `undefined` and `instanceof undefined` throws the `[vitest] No export`
error; (3) the canonical fix is proven in `task-orchestrator.test.ts:98`
(passes 120/120) — `async importOriginal` + `...actual` spread preserves the
real class identity; (4) task-traversal **fails 9 tests** because its tests drive
`processNextItem → executeSubtask` and the mock's `getPRP()` returns `null`
(missing-PRP path → line 903); (5) task-dependencies **passes only
accidentally** (no test reaches line 903) but has the **identical** clobbering
mock — fixing it is defense-in-depth, behavior-preserving, and unifies the
pattern; (6) the `importOriginal<typeof import('…')>()` generic must be copied
verbatim for typecheck. The scope fences are airtight (no `src/`, no other test
files, zero overlap with parallel S1).

### Documentation & References
```yaml
# MUST READ — this subtask's research (verified root cause + exact diffs)
- docfile: plan/008_1550467e1a/bugfix/001_9a4fd2467e1a/P2M3T1S2/research/s2-research-queue-mock-analysis.md
  why: Proves (by running vitest) that task-traversal fails 9 tests with the
       exact [vitest] No ResearchTimeoutError export error at task-orchestrator.ts:903;
       that task-dependencies passes only accidentally; that task-orchestrator
       is the canonical reference (120/120); and gives the verbatim before/after
       mock bodies for both files.

# MUST READ — the bugfix architecture doc that defines the issue
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/architecture/test_validation.md
  section: "Issue 3 > 3A: Test Fixture Rot > Mock Drift: ResearchTimeoutError Re-export"
  why: Names task-traversal.test.ts and task-dependencies.test.ts as the files
       to check and shows the task-orchestrator.test.ts:98 canonical pattern.

# THE CANONICAL PATTERN TO COPY (read-only — do NOT edit this file)
- file: tests/unit/core/task-orchestrator.test.ts
  section: vi.mock('../../../src/core/research-queue.js', …) at line 98.
  why: This is the PROVEN-CORRECT async-importOriginal pattern (file passes
       120/120). Copy its shape exactly: async factory, `const actual = await
       importOriginal<typeof import('…research-queue.js')>();`, return
       `{ ...actual, ResearchQueue: vi.fn().mockImplementation(...) }`.
  pattern: spread real exports FIRST, override ResearchQueue SECOND.
  gotcha: the generic `<typeof import('…research-queue.js')>` is required for
          typecheck — copy it verbatim (only the relative path differs between
          files, and here it's the SAME relative path
          '../../../src/core/research-queue.js' in all three files).

# THE FILES TO EDIT
- file: tests/unit/core/task-traversal.test.ts
  section: vi.mock('../../../src/core/research-queue.js', () => ({ … })) at line 58.
  why: This mock omits importOriginal → clobbers ResearchTimeoutError → the 9
       tests that drive executeSubtask's missing-PRP path hit
       task-orchestrator.ts:903 `instanceof undefined` → TypeError.
  pattern: convert to the async-importOriginal shape from task-orchestrator.test.ts:98,
           keeping the EXISTING ResearchQueue mock body (enqueue/getPRP/processNext/getStats) unchanged.
  gotcha: do NOT add methods the file doesn't already mock (no waitForPRP/researchNow/
          deletePRP) — keep the body identical to avoid behavior drift. Only the
          factory wrapper + spread changes.

- file: tests/unit/core/task-dependencies.test.ts
  section: vi.mock('../../../src/core/research-queue.js', () => ({ … })) at line 51.
  why: Byte-identical mock to task-traversal's. Currently passes ONLY because no
       test reaches task-orchestrator.ts:903 — latent landmine. Apply the same
       fix (behavior-preserving; unifies the pattern).
  pattern: identical transformation to task-traversal (same mock body).
  gotcha: this file PASSES today — after the edit it must STILL pass (verify no
          regression). The edit must be purely additive (spread + wrap), not a
          body rewrite.

# SOURCE-SIDE CONTEXT (read-only — do NOT edit; explains WHY the class identity matters)
- file: src/core/research-queue.ts
  section: line 73 `export class ResearchTimeoutError extends Error`; line 449
           `throw new ResearchTimeoutError(...)` (the throw site inside the real
           ResearchQueue — not exercised by these mocks, but documents the class).
  why: This is the REAL class whose identity the mock must preserve.
  gotcha: READ-ONLY for S2.

- file: src/core/task-orchestrator.ts
  section: line 49 import; line 903 `if (error instanceof ResearchTimeoutError || notEnqueued)`;
           line 906 second instanceof check.
  why: THIS is where the failure happens — the code under test does the instanceof.
       Proves the bug is in the MOCK (clobbering the class), not in source.
  gotcha: READ-ONLY for S2 — the source instanceof checks are CORRECT.

# CONTRACT INPUT (read-only)
- file: vitest.config.ts
  section: coverage.include = ['src/**/*.ts']; thresholds 100/100/100/100.
  why: S2 edits ONLY tests/ → no src/ change → coverage unaffected. The
       task-orchestrator.ts:903/906 branches are already covered by the
       passing task-orchestrator.test.ts. No coverage risk.
```

### Current Codebase tree (relevant slice)
```bash
src/core/
  research-queue.ts        # READ-ONLY — exports class ResearchTimeoutError (line 73)
  task-orchestrator.ts     # READ-ONLY — line 49 import; line 903/906 instanceof (the failure site)
tests/unit/core/
  research-queue.test.ts          # READ-ONLY — tests the real class (no research-queue mock)
  task-orchestrator.test.ts       # READ-ONLY — CANONICAL importOriginal pattern (line 98); passes 120/120
  task-traversal.test.ts          # EDIT — vi.mock line 58 → async importOriginal (fixes 9 failing tests)
  task-dependencies.test.ts       # EDIT — vi.mock line 51 → async importOriginal (defense-in-depth; was passing)
vitest.config.ts                  # READ-ONLY — 100% coverage on src/** (S2 touches no src/; unaffected)
```

### Desired Codebase tree with files to be added and responsibility of file
```bash
tests/unit/core/task-traversal.test.ts    # MODIFIED — research-queue mock uses async importOriginal
                                           #   (preserves real ResearchTimeoutError; fixes 9 instanceof TypeErrors)
tests/unit/core/task-dependencies.test.ts # MODIFIED — same transformation (defense-in-depth; unifies pattern)
# (no NEW files, no src/ edits, no docs)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL (root cause is in code-under-test, not the test): src/core/task-orchestrator.ts
// imports `ResearchTimeoutError` from './research-queue.js' (line 49) and does
// `error instanceof ResearchTimeoutError` at line 903 (and 906). When a test
// mocks research-queue.js WITHOUT importOriginal, the mock returns ONLY
// { ResearchQueue: vi.fn(...) } — so the module's ResearchTimeoutError binding
// is undefined. `error instanceof undefined` throws:
//   Error: [vitest] No "ResearchTimeoutError" export is defined on the
//   "../../../src/core/research-queue.js" mock. Did you forget to return it
//   from "vi.mock"?
// The fix is to preserve the real class via importOriginal — NOT to edit source.

// CRITICAL (spread BEFORE override): the mock factory MUST be
//   async importOriginal => { const actual = await importOriginal<...>(); return { ...actual, ResearchQueue: ... }; }
// The `...actual` spread must come FIRST and the ResearchQueue override SECOND,
// so actual.ResearchTimeoutError survives. Reversing the order would let the
// override be re-clobbered (not an issue here since the override only sets
// ResearchQueue, but keep the canonical order).

// CRITICAL (the generic is required for typecheck): copy verbatim —
//   await importOriginal<typeof import('../../../src/core/research-queue.js')>()
// The relative path '../../../src/core/research-queue.js' is IDENTICAL in all
// three files (task-orchestrator, task-traversal, task-dependencies all live in
// tests/unit/core/), so the generic is byte-identical to the canonical one.

// GOTCHA (task-dependencies passes only by accident): task-dependencies.test.ts
// has the SAME clobbering mock as task-traversal but PASSES — because none of its
// tests drive processNextItem/executeSubtask (they only test canExecute() /
// getBlockingDependencies() / dependency-graph). Fixing it is behavior-preserving
// (its tests still pass) and removes the latent landmine. DO NOT skip it.

// GOTCHA (keep the mock body identical): each file's ResearchQueue mock body
// (enqueue/getPRP/processNext/getStats) must stay EXACTLY as-is. Do NOT add
// waitForPRP/researchNow/deletePRP (those are in task-orchestrator.test.ts's
// richer mock but NOT in these two files). The ONLY change is the factory
// wrapper (sync → async importOriginal + spread). Adding methods = behavior drift.

// GOTCHA (vi.mock is hoisted): vi.mock calls are hoisted to the top of the file
// by vitest's transformer, so they run BEFORE any import. This is why the mock
// must be self-contained (no reference to top-level test variables). The
// importOriginal pattern is hoist-safe (the factory is async and self-contained).
// The canonical task-orchestrator.test.ts proves this works.

// CRITICAL (scope): edit ONLY tests/unit/core/task-traversal.test.ts and
// tests/unit/core/task-dependencies.test.ts. Do NOT edit src/, task-orchestrator.test.ts,
// research-queue.test.ts, PRD.md, tasks.json, or any doc. Zero overlap with parallel S1
// (which edits tests/unit/agents/prp-generator.test.ts + src/agents/prp-generator.ts).
```

---

## Implementation Blueprint

### Data models and structure
None. S2 adds/changes NO types, classes, or data. It edits two `vi.mock` factory
functions (test infrastructure).

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: MODIFY tests/unit/core/task-traversal.test.ts — convert research-queue mock to async importOriginal
  - LOCATE `vi.mock('../../../src/core/research-queue.js', () => ({ … }))` at line 58.
  - REPLACE the sync factory `() => ({ ResearchQueue: vi.fn().mockImplementation(() => ({ … })) })`
    with the async-importOriginal shape (see "What" §a). Keep the ResearchQueue
    mock body (enqueue/getPRP/processNext/getStats) BYTE-FOR-BYTE identical.
  - ADD the one-line explanatory comment (point at task-orchestrator.ts:903) so a
    future contributor doesn't "simplify" it back.
  - PRESERVE: every other mock in the file (logger, task-utils, scope-resolver,
    git-commit, prp-runtime), every test, every helper.
  - GOTCHA: the generic `<typeof import('../../../src/core/research-queue.js')>`
    is required for typecheck — copy verbatim. The spread `...actual` MUST come
    before the ResearchQueue override.

Task 2: MODIFY tests/unit/core/task-dependencies.test.ts — identical transformation
  - LOCATE the byte-identical `vi.mock('../../../src/core/research-queue.js', …)` at line 51.
  - APPLY the exact same async-importOriginal conversion (same mock body, same
    comment). This file passes today; after the edit it must STILL pass.
  - PRESERVE: every other mock, test, and helper in the file.
  - GOTCHA: do NOT add methods (waitForPRP/researchNow/deletePRP) — keep the
    body identical to the current one. The edit is purely the factory wrapper.

Task 3: VERIFY — the 9 failures are gone and nothing regressed
  - RUN `npx vitest run tests/unit/core/task-traversal.test.ts` → 0 failures
    (was 9). Grep the output: NO `[vitest] No "ResearchTimeoutError" export` error.
  - RUN `npx vitest run tests/unit/core/task-dependencies.test.ts` → ALL green
    (no regression; same count as before the edit).
  - RUN `npx vitest run tests/unit/core/task-orchestrator.test.ts` → 120/120
    (untouched reference; confirms the pattern is sound).
  - RUN `npx vitest run tests/unit/core/research-queue.test.ts` → green (untouched).
  - RUN `npx vitest run tests/unit/core/` → no "No ResearchTimeoutError export"
    error anywhere in the core suite.
  - RUN `npm run typecheck` → exit 0 (the importOriginal generic resolves).
  - RUN `npm run lint && npm run format:check` → GREEN (run `npm run format` if
    prettier complains about the new multi-line factory).
  - VERIFY only the two intended files changed: `git diff --name-only` →
    tests/unit/core/task-traversal.test.ts + tests/unit/core/task-dependencies.test.ts.
  - NOTE: `npm run test:run` (full suite) may STILL exit 1 due to S1/S3 and other
    UNRELATED rot — that is EXPECTED and out of scope. S2's success criterion is
    narrowly: the ResearchTimeoutError instanceof TypeError is eliminated from
    the research-queue-mocking files. Do NOT chase unrelated failures.
```

### Implementation Patterns & Key Details
```ts
// PATTERN: async importOriginal preserves real class identity across vi.mock.
// Canonical source: tests/unit/core/task-orchestrator.test.ts:98 (passes 120/120).
vi.mock('../../../src/core/research-queue.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../src/core/research-queue.js')>();
  return {
    ...actual,                                   // ← preserves ResearchTimeoutError
    ResearchQueue: vi.fn().mockImplementation(() => ({
      // … EXISTING mock body, unchanged …
      enqueue: vi.fn().mockResolvedValue(undefined),
      getPRP: vi.fn().mockReturnValue(null),
      processNext: vi.fn().mockResolvedValue(undefined),
      getStats: vi.fn().mockReturnValue({ queued: 0, researching: 0, cached: 0 }),
    })),
  };
});

// CRITICAL: the failure is `error instanceof ResearchTimeoutError` in the CODE
// UNDER TEST (src/core/task-orchestrator.ts:903), not in the test. When the mock
// omits importOriginal, ResearchTimeoutError is undefined → instanceof throws.
//   src/core/task-orchestrator.ts:49   import { ResearchQueue, ResearchTimeoutError } from './research-queue.js';
//   src/core/task-orchestrator.ts:903  if (error instanceof ResearchTimeoutError || notEnqueued) { … }
// The `...actual` spread re-binds the REAL class, so instanceof works.

// CRITICAL: keep each file's mock body IDENTICAL to its current form. The only
// change is the factory wrapper (sync → async importOriginal + spread). Do NOT
// add waitForPRP/researchNow/deletePRP (those belong to task-orchestrator's
// richer mock, not these two files). Adding methods = behavior drift.

// CRITICAL: apply to BOTH task-traversal (actively failing 9) AND task-dependencies
// (passing but latent). task-dependencies' mock is byte-identical to the burning
// one; fixing it is behavior-preserving and removes the landmine. Do not skip it.
```

### Integration Points
```yaml
TEST MOCKS (tests/unit/core/task-traversal.test.ts, task-dependencies.test.ts):
  - change: vi.mock('…research-queue.js', …) sync factory → async importOriginal.
  - preserve: the ResearchQueue mock body (enqueue/getPRP/processNext/getStats).
  - effect: real ResearchTimeoutError class identity is preserved → the code-under-
       test's `instanceof` at task-orchestrator.ts:903 works → 9 task-traversal
       tests pass; task-dependencies stays green.

NO SOURCE CHANGE / NO DOCS / NO CONFIG / NO NEW FILES / NO OTHER TEST FILES
  — pure two-file test-mock fix. Zero overlap with parallel S1.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run typecheck       # tsc --noEmit → exit 0 (importOriginal generic resolves; mock factory types)
npm run lint            # eslint → no new violations
npm run format:check    # prettier; run `npm run format` if the new multi-line factory complains
# Expected: Zero errors. The change converts a sync arrow factory to an async one
# and adds a `...actual` spread + importOriginal call — all standard TS/vitest.
```

### Level 2: Unit Tests (Component Validation)
```bash
# The fix target — was 9 failures, must now be 0:
npx vitest run tests/unit/core/task-traversal.test.ts
# EXPECT: all green. Grep output: NO `[vitest] No "ResearchTimeoutError" export`.

# The defense-in-depth target — must stay green (no regression):
npx vitest run tests/unit/core/task-dependencies.test.ts
# EXPECT: all green, same count as before the edit.

# The canonical reference — untouched, must stay green:
npx vitest run tests/unit/core/task-orchestrator.test.ts
# EXPECT: 120/120.

# The real-class test — untouched, must stay green:
npx vitest run tests/unit/core/research-queue.test.ts
# EXPECT: all green.

# Whole core unit suite — confirm no ResearchTimeoutError error anywhere:
npx vitest run tests/unit/core/ 2>&1 | grep -c "No \"ResearchTimeoutError\" export"
# EXPECT: 0
```

### Level 3: Integration Testing (System Validation)
```bash
# Full project validation gate (lint + format:check + typecheck + tests):
npm run validate
# NOTE: this MAY STILL FAIL (exit 1) due to S1 (PRP-generator mock) / S3
# (groundswell mock) and other UNRELATED rot. S2 does NOT own those. The S2
# success criterion is narrowly: the ResearchTimeoutError instanceof TypeError is
# gone from the research-queue-mocking files. If `npm run validate` is red ONLY
# for unrelated reasons already documented (S1/S3/etc.), S2 is complete.
# If it is red for a ResearchTimeoutError reason, S2 is NOT complete.

# Scope-bounded full-suite check — the ResearchTimeoutError error must be gone EVERYWHERE:
npx vitest run 2>&1 | grep -c "No \"ResearchTimeoutError\" export"
# EXPECT: 0  (regardless of other unrelated failures)
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Confirm both mocks now use importOriginal:
rg -n "async importOriginal" tests/unit/core/task-traversal.test.ts    # EXPECT: one match (line ~58)
rg -n "async importOriginal" tests/unit/core/task-dependencies.test.ts # EXPECT: one match (line ~51)

# Confirm the ...actual spread is present in both:
rg -n "\.\.\.actual" tests/unit/core/task-traversal.test.ts           # EXPECT: one match
rg -n "\.\.\.actual" tests/unit/core/task-dependencies.test.ts        # EXPECT: one match

# Confirm the canonical reference file was NOT edited:
git diff --name-only | grep task-orchestrator.test.ts   # EXPECT: no match (untouched)
git diff --name-only | grep research-queue.test.ts      # EXPECT: no match (untouched)

# Confirm no src/ file was touched:
git diff --name-only | grep '^src/'                     # EXPECT: no match (test-only)

# Confirm only the two intended test files changed:
git diff --name-only
# EXPECT: tests/unit/core/task-traversal.test.ts + tests/unit/core/task-dependencies.test.ts
#   (NO src/, NO task-orchestrator.test.ts, NO research-queue.test.ts, NO PRD.md/tasks.json,
#    NO prp-generator.test.ts [owned by parallel S1], NO docs.)

# Confirm the ResearchTimeoutError error string is gone from the entire suite:
npx vitest run 2>&1 | grep "No \"ResearchTimeoutError\" export" || echo "GONE ✅"
# EXPECT: "GONE ✅"
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` exit 0 (importOriginal generic resolves; factory types OK).
- [ ] `npm run lint` and `npm run format:check` GREEN.
- [ ] `npx vitest run tests/unit/core/task-traversal.test.ts` → 0 failures (was 9).
- [ ] `npx vitest run tests/unit/core/task-dependencies.test.ts` → green (no regression).
- [ ] `npx vitest run tests/unit/core/task-orchestrator.test.ts` → 120/120 (untouched).
- [ ] `npx vitest run 2>&1 | grep -c "No \"ResearchTimeoutError\" export"` → 0.

### Feature Validation
- [ ] `task-traversal.test.ts`: the 9 `instanceof ResearchTimeoutError` failures are gone.
- [ ] `task-dependencies.test.ts`: no regression (was passing, still passing).
- [ ] Both mocks use `async importOriginal` + `...actual` spread + identical mock body.
- [ ] No `src/` edit; `task-orchestrator.test.ts` and `research-queue.test.ts` untouched.

### Code Quality Validation
- [ ] Both mocks now match the canonical `task-orchestrator.test.ts:98` pattern.
- [ ] Each file's `ResearchQueue` mock body is unchanged (only the factory wrapper changed).
- [ ] Explanatory comment added in both files (durable against future "simplification").
- [ ] No methods invented (no waitForPRP/researchNow/deletePRP drift).

### Documentation & Deployment
- [ ] No docs edits (item 5: DOCS none — test-only).
- [ ] No new env vars / config / source changes.

---

## Anti-Patterns to Avoid
- ❌ Don't edit `src/` — the source `instanceof ResearchTimeoutError` checks are
  CORRECT; the bug is that the mocks clobber the class. The fix is mock-side.
- ❌ Don't edit `task-orchestrator.test.ts` — it's the canonical REFERENCE (passes
  120/120). Copy its pattern; don't "improve" it.
- ❌ Don't edit `research-queue.test.ts` — it tests the real class and doesn't mock
  research-queue.js.
- ❌ Don't skip `task-dependencies.test.ts` — its mock is byte-identical to the
  burning one and passes only by accident. Fixing it is behavior-preserving and
  removes a latent landmine.
- ❌ Don't rewrite the `ResearchQueue` mock body — keep it identical (only the
  factory wrapper + `...actual` spread change). Adding/removing methods = drift.
- ❌ Don't reverse the spread/override order — `...actual` FIRST, `ResearchQueue:`
  SECOND, so the real class survives.
- ❌ Don't chase unrelated test failures (S1/S3/executeBacklog/ContextScopeSchema)
  — they're out of scope and owned by other subtasks. S2's success is narrowly the
  elimination of the ResearchTimeoutError instanceof TypeError.
- ❌ Don't add a "no change needed" skip for task-dependencies — the contract says
  no change is *needed* (allowed ≠ forbidden); defense-in-depth mandates it.

---

## Confidence Score

**9/10** — One-pass success likelihood is very high. S2 is a 2-file,
behavior-preserving test fix with a **verified root cause** (I ran vitest and
reproduced the exact `[vitest] No "ResearchTimeoutError" export` error at
`task-orchestrator.ts:903` from inside `task-traversal.test.ts`, and confirmed
the canonical `task-orchestrator.test.ts` passes 120/120 with the identical fix).
The correctness rests on six pre-proven facts: (1) the root cause is in the code
under test (task-orchestrator.ts:903 `instanceof`), not the test; (2) a
non-importOriginal `vi.mock` clobbers `ResearchTimeoutError` to `undefined`; (3)
the canonical `async importOriginal` + `...actual` pattern preserves the real
class identity; (4) task-traversal fails exactly 9 tests (drives line 903 via
the missing-PRP path); (5) task-dependencies passes only accidentally (identical
mock, no test reaches line 903) — fixing it is behavior-preserving; (6) the
verbatim before/after mock bodies are pinned. The scope fences are airtight (no
`src/`, no other test files, zero overlap with parallel S1). The remaining 1/10
is ordinary mock-fidelity risk on the exact `ResearchQueue` method set (mitigated
by mandating the body stay byte-identical to each file's current form).