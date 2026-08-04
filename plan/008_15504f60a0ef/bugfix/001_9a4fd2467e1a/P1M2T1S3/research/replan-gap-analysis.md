# Re-plan Gap Analysis — S3 (attempt 2/3)

## Why attempt 1 returned `result:"issue"`

Attempt 1 implemented **Part (a)** (the genuine gap) correctly — it is now
landed and committed:

- `tests/unit/core/task-patcher.test.ts:484` —
  `it('should NOT log warn and should leave the backlog structurally unchanged for an added change')`
  - `expect(mockLogger.warn).not.toHaveBeenCalled()` (line 507) — the silent-drop
    "Feature not implemented" signal is gone.
  - `expect(patched).toEqual(backlog)` (line 517) — added-only delta adds/removes
    NO backlog items (delegated to delta breakdown, not dropped).

Attempt 1 deliberately skipped **Part (b)** because its catch-branch target was
**already implemented by S2**. Re-verifying the source confirms this is correct,
and refines where the *one* remaining gap actually is.

## What S2 actually delivered (the original S3 research note §4 was wrong)

The note assumed S2 "explicitly deferred" the catch-path test to S3. **S2's own
PRP did no such thing** — it claimed BOTH the happy-path AND the catch-path as
its Success Definition ("An Architect failure ... → the modified/removed
integration ... is PRESERVED ..."). S2 implemented both:

- **Happy-path** — `prp-pipeline-delta-response.test.ts`, test `invokes the
  Architect and merges new tasks when the delta has an added requirement
  (P1.M2.T1.S2)`: added delta → `createArchitectAgent` invoked → architect
  `success` → `readFile(tasks.json)` returns `architectBacklog` (P9) →
  `saveBacklog` last call carries P9 → snapshot refreshed → marker cleared →
  `phase === 'delta_integrated'`. **GREEN.**
- **Catch-path** — test `preserves modified/removed integration (re-asserts the
  patched backlog) when the Architect fails on added requirements`: added delta →
  architect `error` status → `throw` inside the gated block → `catch` →
  `saveBacklog(currentSession.taskRegistry)` (patched backlog re-asserted, no P9)
  → no throw → snapshot refreshed → marker cleared → `delta_integrated`.
  **GREEN.** (This is the test the original PRP's "Test 2" would have duplicated.)

## The ONE genuine non-duplicative gap (this is the revised scope)

Contract (b) literal text: "add a test that `integrateIntoCurrentSessionResponse`
with 'added' changes **invokes `createArchitectAgent` and `createArchitectPrompt`**,
reads the architect output, and the saved backlog contains new tasks."

S2's happy-path test asserts:

| Contract (b) sub-claim | S2 test asserts? |
|---|---|
| invokes `createArchitectAgent` | ✅ `expect(createArchitectAgent).toHaveBeenCalled()` |
| invokes `createArchitectPrompt` | ❌ **NOT asserted anywhere in the file** |
| reads the architect output | ✅ (implicit — P9 reaches `lastSaved` only via `readFile(tasks.json)` → merge) |
| saved backlog contains new tasks | ✅ `lastSaved.backlog.some(p => p.id === 'P9')` |

**`createArchitectPrompt` is invoked in source** (`prp-pipeline.ts:1010-1018`,
`createArchitectPrompt(addedPrdContent, sessionPath)` where `addedPrdContent` =
`renderDeltaPRD(addedOnlyDelta, ...)` — the focused ADDED-only delta PRD) but
**no test proves it**. Asserting it is meaningful: it is the proof that the
architect is fed the **added-only delta PRD**, not the full PRD — the actual
"added requirements are decomposed over their own content" behavior. Adding it
as an additive assertion to S2's existing happy-path test (NOT a new test)
satisfies the literal contract without duplicating #4 or #5.

## Delta-path coverage (no S3 gap here)

- `patchBacklog` 'added' debug no-op → **Part (a)** (DONE, task-patcher.test.ts:484).
- `decomposePRD` over `delta_prd.md` → architect → new tasks →
  **P1.M1.T1.S3** integration test (`tests/unit/core/delta-prd.test.ts`, DONE).

## Hard anti-duplication rules for attempt 2

1. Do NOT add a new `it()` that duplicates S2's happy-path (#4) or catch-path (#5).
2. Do NOT touch the catch-path — it is fully covered by #5.
3. Do NOT re-add Part (a) — it is committed at task-patcher.test.ts:484.
4. The ONLY edit is additive assertions inside S2's existing happy-path `it()`.
5. `src/` stays untouched (test-only contract).

## Validation (targeted; do NOT run full `npm run test:run` — pre-existing red, Issue 3, P2/P3)

- `npm run typecheck && npm run lint && npm run format:check`
- `npx vitest run tests/unit/workflows/prp-pipeline-delta-response.test.ts` (must stay GREEN, now ≥ the contract)
- `npx vitest run tests/unit/core/task-patcher.test.ts` (regression — Part (a) stays GREEN)
- `git status --short src/` must be empty.