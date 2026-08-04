# PRP — P1.M2.T1.S3: Unit tests for both paths' added-requirement handling (RE-PLAN, attempt 2/3)

> Bugfix 001, **Issue 2 (MAJOR)** — test-only slice. **This is a re-plan after
> attempt 1 returned `result:"issue"`.** Attempt 1 correctly landed **Part (a)**
> (committed) and correctly *declined* to add a duplicate of S2's catch-path
> test. This revised PRP reconciles the over-coverage situation and narrows S3
> to the **single genuine non-duplicative gap** that remains.

---

## Goal

**Feature Goal**: Prove — with passing unit tests under `npm run test:run`'s
targeted files — that **added requirements are no longer silently dropped in
either path** (the delta path's `patchBacklog` 'added' delegation, and the
integrate path's `integrateIntoCurrentSessionResponse` architect invocation),
**without duplicating any test that S1, S2, or P1.M1.T1.S3 already produced.**

**Deliverable** (test-only — `src/` stays byte-identical):
1. **VERIFY Part (a)** is present and GREEN (it is, committed at
   `tests/unit/core/task-patcher.test.ts:484`). No edit expected.
2. **VERIFY Part (b)'s happy-path and catch-path** are present and GREEN in
   `tests/unit/workflows/prp-pipeline-delta-response.test.ts` (they are — S2
   landed both). No edit expected for catch-path.
3. **FILL the one genuine gap**: the literal contract (b) requires proving
   `integrateIntoCurrentSessionResponse` **"invokes `createArchitectAgent` AND
   `createArchitectPrompt`."** S2's happy-path test asserts `createArchitectAgent`
   but **NOT `createArchitectPrompt`**. Add that missing assertion — **as an
   additive assertion inside S2's existing happy-path `it()`** (not a new test).

**Success Definition**:
- `prp-pipeline-delta-response.test.ts` asserts, on the integrate-path added-req
  happy path, that **both** `createArchitectAgent` **and** `createArchitectPrompt`
  are invoked — satisfying the literal contract (b) and proving the architect is
  fed the focused added-only delta PRD.
- Zero new `it()` blocks are added (Part (a) already landed; Part (b)'s happy +
  catch already exist from S2) — the change is strictly additive assertions in
  S2's existing happy-path test.
- `src/` is untouched (`git status --short src/` empty).
- Targeted validation gates are GREEN (see Validation Loop). The full
  `npm run test:run` is **NOT** run (pre-existing red = bugfix Issue 3, P2/P3 scope).

---

## Why

- **Attempt 1 did the hard, genuine part and stopped correctly.** It landed the
  only *missing* test coverage for `patchBacklog` 'added' (warn-not-called +
  structural-unchanged) and rightly refused to duplicate S2's catch-path test.
  The orchestrator flagged it as an `issue` only because the deliverable
  deviated from the original PRP's "Test 2" — which itself rested on a faulty
  premise (see research note + Context).
- **The original premise was wrong.** The original S3 research note §4 claimed
  S2 "explicitly deferred" the catch-path test to S3. S2's **own** PRP did the
  opposite: it claimed BOTH the happy-path AND the catch-path as its Success
  Definition ("An Architect failure ... → modified/removed integration ...
  PRESERVED"), and S2 implemented both. So Part (b)'s catch-branch is **already
  covered** (GREEN) by S2's test at `prp-pipeline-delta-response.test.ts`.
- **One literal-contract sub-claim is still unproven.** Contract (b) says the
  test must show the path **"invokes `createArchitectAgent` and
  `createArchitectPrompt`."** The happy-path test asserts only
  `createArchitectAgent`. Asserting `createArchitectPrompt` is meaningful, not
  ceremonial: the source builds the prompt from `renderDeltaPRD(addedOnlyDelta,
  …)` (the focused ADDED-only delta PRD), so the assertion proves the architect
  decomposes added requirements over **their own content** — the actual
  anti-silent-drop behavior — rather than over the full PRD.
- **Test-only, file-disjoint, zero source risk.** One additive `expect()` + one
  additive dynamic `import` inside an existing `it()`. Cannot introduce a new
  failure; cannot merge-conflict with S1/S2 source.

---

## What

After this PRP, on the integrate path an `'added'` delta provably (a) invokes
`createArchitectAgent`, (b) invokes `createArchitectPrompt` (NEW assertion),
(c) reads the architect `tasks.json` output (already implicit via the P9 merge),
and (d) saves a backlog containing the new task (P9). The delta path's
`patchBacklog` 'added' no-op is provably non-dropping (Part (a), already landed).

### Success Criteria

- [ ] `prp-pipeline-delta-response.test.ts` happy-path `it()` asserts
  `createArchitectPrompt` was called (in addition to the existing
  `createArchitectAgent` assertion) — contract (b) fully satisfied.
- [ ] No new `it()` / `describe()` blocks added (anti-duplication gate).
- [ ] `src/` unchanged (`git status --short src/` empty).
- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check` all clean.
- [ ] Targeted test files GREEN: `prp-pipeline-delta-response.test.ts` and
  `task-patcher.test.ts` (Part (a) regression).

---

## All Needed Context

### Context Completeness Check

An agent who knows nothing about this codebase can complete this PRP from this
section alone: it gives the exact test, the exact line, the exact assertion to
add, the mock already in place, and the hard rules that prevent a duplicate.

### Documentation & References

```yaml
# Source under test — the integrate-path added-req block (READ to confirm createArchitectPrompt is called)
- file: src/workflows/prp-pipeline.ts
  why: integrateIntoCurrentSessionResponse() lines ~985-1066; the gated block at
        ~1000-1051 calls createArchitectAgent (1008-1014) AND createArchitectPrompt
        (1010-1018) before retryAgentPrompt → readFile(tasks.json) → mergeBacklogs.
  pattern: createArchitectPrompt(addedPrdContent, sessionPath) where
        addedPrdContent = renderDeltaPRD(addedOnlyDelta, completedTaskIds, sessionId).
  critical: createArchitectPrompt IS invoked in source, so the new assertion is
        GUARANTEED GREEN — no logic change needed, only a missing test assertion.

# The test file to edit — additive assertion in S2's happy-path it()
- file: tests/unit/workflows/prp-pipeline-delta-response.test.ts
  why: describe('integrateIntoCurrentSessionResponse …'); the happy-path it()
        titled "invokes the Architect and merges new tasks when the delta has an
        added requirement (P1.M2.T1.S2)".
  pattern: it already does `const { createArchitectAgent } = await import(
        '../../../src/agents/agent-factory.js');` then `expect(createArchitectAgent).toHaveBeenCalled()`.
        Add the analogous createArchitectPrompt import + assertion right beside it.
  gotcha: createArchitectPrompt is ALREADY mocked at module top (vi.mock of
        '../../../src/agents/prompts/architect-prompt.js' → vi.fn().mockReturnValue(
        { user: 'mock-architect-prompt' })). The assertion needs the SAME dynamic
        import path to reach the mock instance: `await import('../../../src/agents/
        prompts/architect-prompt.js')`.

# Part (a) — already landed, DO NOT re-add (verify-only)
- file: tests/unit/core/task-patcher.test.ts
  why: line 484 it('should NOT log warn and should leave the backlog structurally
        unchanged for an added change') asserts mockLogger.warn).not.toHaveBeenCalled()
        (507) and patched).toEqual(backlog) (517). This is the delta-path no-drop proof.
  pattern: RE-USE the existing createTestPhase/createTestBacklog/createDeltaAnalysis
        helpers if any task-patcher edit were ever needed (it is NOT — Part (a) is done).

# Original (now-superseded) planning note — explains WHY attempt 1 deviated
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P1M2T1S3/research/replan-gap-analysis.md
  why: documents attempt-1 outcome, S2's actual scope, the single genuine gap.
  section: "The ONE genuine non-duplicative gap" + "Hard anti-duplication rules".

# S2's PRP — proves S2 owned BOTH happy + catch paths (not deferred to S3)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P1M2T1S2/PRP.md
  why: S2's Success Definition lists the architect-failure catch behavior as its
        OWN deliverable; S2 implemented both happy + catch tests. This is why S3
        must NOT add a catch-path test (it would duplicate S2's GREEN test).
```

### Current Codebase tree (relevant slice)

```bash
src/workflows/prp-pipeline.ts                      # integrateIntoCurrentSessionResponse() — UNCHANGED
src/core/task-patcher.ts                            # patchBacklog 'added' debug no-op — UNCHANGED (S1)
tests/unit/workflows/prp-pipeline-delta-response.test.ts   # EDIT: +1 additive assertion block (this PRP)
tests/unit/core/task-patcher.test.ts                # Part (a) landed — VERIFY only
tests/unit/core/delta-prd.test.ts                   # P1.M1.T1.S3 delta-path coverage — DO NOT TOUCH
```

### Desired Codebase tree (delta from today)

```bash
# ONLY this file changes, and ONLY inside one existing it():
tests/unit/workflows/prp-pipeline-delta-response.test.ts   # +createArchitectPrompt import + assertion
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: createArchitectPrompt is mocked at MODULE TOP in the test file
// (vi.mock('../../../src/agents/prompts/architect-prompt.js', …)). To assert on
// the mock you MUST reach it via the SAME dynamic import path the source uses:
//   const { createArchitectPrompt } = await import('../../../src/agents/prompts/architect-prompt.js');
// then `expect(createArchitectPrompt).toHaveBeenCalled()`. A static import at the
// top of the file will NOT resolve to the vi.fn() instance.

// CRITICAL: the full `npm run test:run` is PRE-EXISTING-RED (bugfix Issue 3 —
// 297 failures across 38 files: mock drift, groundswell link, over-strict read
// schema — ALL P2/P3 scope, NOT S3). Do NOT gate on it. Gate on the two TARGETED
// files only. This PRP is test-only and cannot change the red count.

// CRITICAL: never duplicate S2's catch-path test ("preserves modified/removed
// integration … when the Architect fails on added requirements") — it is GREEN.
// Adding a second catch test violates the anti-duplication gate.
```

---

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY Part (a) is landed and GREEN (NO EDIT)
  - READ tests/unit/core/task-patcher.test.ts around line 484.
  - CONFIRM the it('should NOT log warn and should leave the backlog structurally
    unchanged for an added change') exists with:
      expect(mockLogger.warn).not.toHaveBeenCalled();   (~507)
      expect(patched).toEqual(backlog);                 (~517)
  - RUN: npx vitest run tests/unit/core/task-patcher.test.ts  → expect GREEN.
  - IF (defensive) it is somehow missing, RE-ADD exactly that one it() using the
    createTestPhase/createTestBacklog/createDeltaAnalysis helpers (see the
    original research note test-scope-and-overlap.md §3 for the verbatim body,
    and match the debug message at src/core/task-patcher.ts:~105 EXACTLY). This
    branch is not expected to fire.

Task 2: VERIFY Part (b) happy + catch already exist (NO EDIT for catch)
  - READ the describe('integrateIntoCurrentSessionResponse …') block in
    tests/unit/workflows/prp-pipeline-delta-response.test.ts.
  - CONFIRM BOTH it()s exist and note their exact titles:
      a) "invokes the Architect and merges new tasks when the delta has an added
         requirement (P1.M2.T1.S2)"  — happy path (target of Task 3).
      b) "preserves modified/removed integration (re-asserts the patched backlog)
         when the Architect fails on added requirements" — catch path (DO NOT TOUCH).
  - RUN: npx vitest run tests/unit/workflows/prp-pipeline-delta-response.test.ts
    → expect GREEN (Task 3 will ADD an assertion here; it must stay GREEN).

Task 3: FILL the genuine gap — assert createArchitectPrompt on the happy path (EDIT)
  - EDIT: tests/unit/workflows/prp-pipeline-delta-response.test.ts, inside the
    happy-path it() titled "invokes the Architect and merges new tasks when the
    delta has an added requirement (P1.M2.T1.S2)".
  - In that it()'s SETUP, right after the existing
        const { createArchitectAgent } = await import('../../../src/agents/agent-factory.js');
    line, ADD the parallel dynamic import:
        const { createArchitectPrompt } = await import('../../../src/agents/prompts/architect-prompt.js');
  - In that it()'s VERIFY section, right after the existing
        expect(createArchitectAgent).toHaveBeenCalled();
    line, ADD:
        // Contract (b): the architect is invoked over the FOCUSED added-only
        // delta PRD (renderDeltaPRD over addedChanges), not the full PRD.
        expect(createArchitectPrompt).toHaveBeenCalled();
  - NAMING/PLACEMENT: no new it(); no new describe(); additive only, inside the
    existing happy-path test, beside its sibling createArchitectAgent assertion.
  - OPTIONAL (only if it stays GREEN and adds value; otherwise SKIP):
        expect(createArchitectPrompt).toHaveBeenCalledWith(expect.any(String), expect.any(String));
    (first arg = addedPrdContent string, second = sessionPath). Prefer the simple
    `toHaveBeenCalled()` form if the stronger form is brittle; the simple form
    alone satisfies the literal contract.
  - DEPENDENCIES: none beyond S2's already-landed source + the module-top
    createArchitectPrompt vi.mock (already present at the file's vi.mock block).

Task 4: VALIDATE (test-only; src/ untouched)
  - RUN the Validation Loop below (Level 1 + targeted Level 2).
  - CONFIRM git status --short src/ is empty.
```

### Implementation Patterns & Key Details

```ts
// The exact edit (Task 3), shown in context — two additive lines, one per region:

// --- SETUP region of the happy-path it() (already present lines) ---
const { createArchitectAgent } =
  await import('../../../src/agents/agent-factory.js');
(createArchitectAgent as any).mockReturnValue({
  prompt: vi.fn().mockResolvedValue({ status: 'success', output: '' }),
});
// >>> ADD THIS LINE (Task 3 setup) <<<
const { createArchitectPrompt } =
  await import('../../../src/agents/prompts/architect-prompt.js');

// … (unchanged: MockDeltaAnalysisWorkflow added-change, mockReadFile tasks.json, EXECUTE) …

// --- VERIFY region of the happy-path it() (already present lines) ---
expect(createArchitectAgent).toHaveBeenCalled();
// >>> ADD THIS ASSERTION (Task 3 verify) <<<
expect(createArchitectPrompt).toHaveBeenCalled();
expect(mockManager.saveBacklog).toHaveBeenCalled();
const lastSaved = mockManager.saveBacklog.mock.calls.at(-1)[0];
expect(lastSaved.backlog.some((p: any) => p.id === 'P9')).toBe(true);

// PATTERN: assert BOTH factory + prompt builder in the SAME happy-path test.
// GOTCHA: reach createArchitectPrompt via the dynamic import path that matches
//         the file-top vi.mock (NOT a static import), or the vi.fn() won't resolve.
// CRITICAL: this assertion is GUARANTEED GREEN — src/workflows/prp-pipeline.ts:1015
//           calls createArchitectPrompt unconditionally inside the added-changes block.
```

### Integration Points

```yaml
# NONE — test-only. No source, config, route, or schema changes.
SOURCE:  src/ untouched (git status --short src/ → empty)
CONFIG:  none
ROUTES:  none
DATABASE: none
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after the Task 3 edit.
npm run typecheck          # Expected: clean (additive import + expect() — both type-safe)
npm run lint               # Expected: 0 errors in the edited file (pre-existing `any`
                           # warnings elsewhere are NOT S3's — do not touch them)
npm run format:check       # Expected: clean
# Expected: Zero errors. If lint flags the new import/expect, READ the output and
# align with the sibling createArchitectAgent lines (they are already accepted).
```

### Level 2: Unit Tests (Component Validation)

```bash
# The file edited by Task 3 — must be GREEN (now asserting BOTH agent + prompt).
npx vitest run tests/unit/workflows/prp-pipeline-delta-response.test.ts

# Part (a) regression — must stay GREEN (untouched).
npx vitest run tests/unit/core/task-patcher.test.ts

# Sibling regression guard (DO NOT EDIT) — must stay GREEN.
npx vitest run tests/unit/core/delta-prd.test.ts

# DO NOT run the full `npm run test:run` — it is PRE-EXISTING-RED (bugfix Issue 3,
# P2/P3 scope). S3 is test-only and cannot affect that count.
# Expected: all three targeted files GREEN; the new createArchitectPrompt
# assertion passes on the happy-path it().
```

### Level 3: Integration Testing (System Validation)

```bash
# No service/runtime integration applies (test-only). Confirm the test-only contract:
git status --short src/      # Expected: EMPTY (no source changes)
git status --short tests/    # Expected: ONLY tests/unit/workflows/prp-pipeline-delta-response.test.ts
```

### Level 4: Creative & Domain-Specific Validation

```bash
# (Not applicable — test-only slice with no performance/security/doc surface.)
```

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1 clean: `npm run typecheck && npm run lint && npm run format:check`
- [ ] Level 2 GREEN: `prp-pipeline-delta-response.test.ts` (now asserts BOTH agent + prompt)
- [ ] Level 2 GREEN: `task-patcher.test.ts` (Part (a) regression, untouched)
- [ ] Level 2 GREEN: `delta-prd.test.ts` (sibling regression, untouched)
- [ ] `git status --short src/` EMPTY (test-only honored)

### Feature Validation
- [ ] Contract (b) fully satisfied: integrate-path added-req test asserts BOTH
      `createArchitectAgent` AND `createArchitectPrompt` are invoked
- [ ] Part (a) present & GREEN (delta-path `patchBacklog` 'added' no-drop proof)
- [ ] No silent-drop remains unproven in either path (delta: Part (a) + P1.M1.T1.S3;
      integrate: S2 happy #4 + S2 catch #5, now with the prompt-builder assertion)

### Code Quality Validation
- [ ] No new `it()`/`describe()` added (anti-duplication gate)
- [ ] Catch-path test NOT duplicated (S2's test left untouched)
- [ ] New assertion sits beside its sibling `createArchitectAgent` assertion
- [ ] `createArchitectPrompt` reached via the dynamic import matching the file-top mock

### Documentation & Deployment
- [ ] No user-facing / config / API / doc surface change (test-only)

---

## Anti-Patterns to Avoid

- ❌ Don't add a NEW `it()` for the catch-path — S2 already wrote it (GREEN). A
  second one is a near-duplicate and violates this PRP's anti-duplication gate.
- ❌ Don't re-add Part (a) — it is committed at `task-patcher.test.ts:484`.
- ❌ Don't touch `src/` — test-only contract.
- ❌ Don't run the full `npm run test:run` to "prove" success — it is
  pre-existing-red (Issue 3, P2/P3 scope); gate on the targeted files only.
- ❌ Don't use a static top-of-file import for `createArchitectPrompt` to assert
  on it — it will NOT resolve to the `vi.fn()` instance; use the same dynamic
  `await import('../../../src/agents/prompts/architect-prompt.js')` path the
  existing `createArchitectAgent` assertion uses.
- ❌ Don't strengthen the assertion to `toHaveBeenCalledWith(...)` if it is
  brittle — the simple `toHaveBeenCalled()` already satisfies the literal
  contract and is guaranteed GREEN.

---

## Result

```json
{
  "result": "success",
  "message": "S3 re-plan (attempt 2/3). Attempt 1 correctly landed Part (a) and correctly declined to duplicate S2's catch-path test. The original S3 premise (that S2 'deferred' the catch test to S3) was wrong — S2's own PRP claimed both happy + catch paths and implemented both (GREEN). The single genuine non-duplicative gap is the literal contract (b) sub-claim 'invokes createArchitectPrompt', which S2's happy-path test does not assert (source calls it unconditionally at prp-pipeline.ts:1015, so the assertion is guaranteed GREEN). Revised deliverable = ONE additive assertion (+ its dynamic import) inside S2's existing happy-path it(). src/ stays untouched; targeted test files stay GREEN. No new it()/describe() added; catch-path untouched."
}
```