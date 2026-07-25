# PRP — P2.M1.T1.S2: Verify and update affected unit tests for the executeBacklog abort behavior

---

## Goal

**Feature Goal**: Reconcile unit tests against P2.M1.T1.S1's source change — the
`executeBacklog()` "Cannot execute pipeline: no backlog found in session" throw was
**moved ABOVE the method's try/catch** and **retyped to a fatal `SessionError`**, so it
propagates (aborts) instead of being swallowed by `isFatalError()`. This is a **test-only**
task (no `src/` edits): verify the intended reject test now passes, confirm no test expects
the old swallow behavior, and document the actual impact.

**⚠️ HEADLINE FINDING (from empirical baseline — read this first):** S1 broke **nothing**.
An isolated git-worktree baseline at HEAD (pre-S1 source) vs the working tree (post-S1)
proves it:

| File | Pre-S1 (HEAD) | Post-S1 (working tree) | Net S1 impact |
|------|---------------|------------------------|---------------|
| `prp-pipeline-progress.test.ts` | **1 fail / 11 pass** | **0 fail / 12 pass** | ✅ line-290-308 `taskRegistry:null` reject test RED→GREEN |
| `prp-pipeline.test.ts` | **9 fail / 62 pass** | **9 fail / 62 pass** | ⚠️ **zero new failures** — all 9 are pre-existing |

The contract's anticipated fix ("give line 799 a non-empty backlog") is a **no-op**: the
line-768 test (whose final assert is line 799) **already has a real, non-empty backlog**
and passes. The "line 799 empty backlog" premise is empirically wrong (it's inherited from
the stale architecture doc `test_validation.md` Issue 5 — the same error the S1 PRP's
research §4 already corrected). **Therefore S2 makes NO mandatory test edits**; its core
deliverable is verification + (optionally) one hardening test.

**Deliverable** (test-only; the single in-scope ACTION is optional hardening):
1. **VERIFY** `tests/unit/workflows/prp-pipeline-progress.test.ts` is **12/12 green**
   post-S1 — the line-290-308 reject test (`taskRegistry: null`) went RED→GREEN, and the
   line-768 "handle missing ProgressTracker gracefully" test (real backlog) is unaffected.
2. **DOCUMENT** the baseline comparison proving S1 introduced **zero new failures** in
   `prp-pipeline.test.ts` (9 pre-existing = 9 post-S1), and that the 9 are pre-existing
   Issue 3 (mock drift) / Issue 4 (resume-detection) → P2.M3/P3 scope, NOT S2.
3. **(OPTIONAL HARDENING — recommended)** ADD one small test asserting the no-backlog
   abort fires **even under `#continueOnError === true`** (locks S1's core design property;
   currently untested). This is the only test-file change S2 may make.

**Success Definition**:
- `npx vitest run tests/unit/workflows/prp-pipeline-progress.test.ts` → **12/12 green** (no
  newly-introduced failure; the reject test green).
- `npx vitest run tests/unit/workflows/prp-pipeline.test.ts` → still **9 fail / 62 pass**
  (identical to pre-S1 baseline; S2 does NOT fix these — they're pre-existing P2.M3/P3 scope).
- A recorded baseline comparison (the two rows above) proving S1 is non-regressive.
- No test file edit that "fixes" line 768 by adding a backlog it already has (no-op).
- If the optional hardening test is added: it asserts `executeBacklog()` rejects with
  `'Cannot execute pipeline: no backlog found in session'` when `taskRegistry: null` AND
  `#continueOnError === true`, and the targeted suite stays green.
- NO `src/` edits (test-only task). The full `npm run test:run` is NOT the gate (pre-existing
  Issue 3 redness, P2.M2/P2.M3 scope).

---

## Why

- **S1 already did the work this task was afraid of.** The contract anticipated that moving
  the no-backlog throw above the try/catch would break a test that relied on the swallow
  behavior. The empirical baseline proves it did NOT: the only `executeBacklog`-no-backlog
  test that exists (line-768) already carries a real backlog, so the abort never fires for it.
  A PRP that blindly executes "give line 799 a backlog" would (a) be a no-op (it has one), or
  (b) risk a misdirected/spurious edit. Honesty here prevents implementing a non-existent bug.
- **Verification is the real value.** Locking in the baseline-comparison proof (9=9) ensures
  future regressions in the no-backlog path are caught, and it cleanly fences the 9
  pre-existing failures as P2.M3/P3 scope (so they aren't mis-attributed to S1/S2).
- **The continue-on-error property is the one genuine gap.** S1's entire design rationale is
  "the throw is above the try/catch specifically so it survives `#continueOnError===true`"
  (because `isFatalError` returns false-for-all under continue-on-error). No test currently
  exercises that path (only a comment at `prp-pipeline.test.ts:1587`). One small added test
  locks S1's key invariant — high value, clearly in scope of "verify ... the abort behavior."
- **Out of scope (hard boundaries):** any `src/` file (S1 owns source; S2 is test-only); the 9
  pre-existing prp-pipeline.test.ts failures (P2.M3 mock-drift / P3 resume-detection — fixing
  them here masks root causes and collides with those tasks); the full-suite green (Issue 3,
  P2.M2/P2.M3); editing line 768 to add a backlog it already has.

---

## What

### User-visible behavior
None. This is a test-only task. S1's source change is the user-visible behavior (a null
backlog now aborts loudly); S2 only verifies/locks it via tests.

### Technical requirements (exact contract)

**VERIFY (no edit) — `tests/unit/workflows/prp-pipeline-progress.test.ts`** is **12/12 green**
post-S1. The two tests the contract named:
- `it('should throw error when backlog is not found in session')` (lines 290-308) — sets
  `taskRegistry: null`, asserts `.rejects.toThrow('Cannot execute pipeline: no backlog found
  in session')`. RED pre-S1 → GREEN post-S1. **This is S1's proof-of-fix; S2 confirms it.**
- `it('should handle missing ProgressTracker gracefully')` (lines 768-801, final assert line
  799) — uses `createTestBacklog([…P1.M1.T1.S1…])` (a **real backlog**), mocks
  `progressTracker()` to return undefined once, asserts `executeBacklog()` resolves. The
  no-backlog abort (`if (!backlog)`) does NOT fire (truthy backlog) → unaffected → GREEN.
  **The contract's claim that this test "has an EMPTY backlog [and] will now FAIL" is
  empirically wrong.** Do NOT edit it.

**DOCUMENT (no edit) — the baseline comparison** proving S1 introduced zero new failures in
`prp-pipeline.test.ts`. The 9 failures are pre-existing:
- Tests at 586, 615 (`executeBacklog` describe): "promise resolved instead of rejecting" =
  truthy backlog (S1's abort would *reject*, not *resolve*) → pre-existing mock drift (Issue 3).
- Tests at 888-1031 (`resume interrupted bugfix breakdowns` / `run`): runQACycle-path spy
  assertions, do NOT touch executeBacklog's no-backlog check → pre-existing (Issue 4 detection).
- Test at 1110 (`run` > "success false on error"): `currentSession:null` + mock drift
  (`errorManager.initialize` mock doesn't take effect) → pre-existing (Issue 3); S1 only
  changed the surfaced message from "expected success false, got true" to "expected 'Test
  error', got 'no backlog found'". Fails both before AND after S1.

**OPTIONAL HARDENING (recommended — the only test-file edit S2 may make)** — ADD a test to
`tests/unit/workflows/prp-pipeline-progress.test.ts` (the home of the no-backlog reject test)
asserting the abort fires under `#continueOnError === true`:
```ts
it('should abort on missing backlog even under continueOnError (PRD §4.2/§5.1; bugfix Issue 5)', async () => {
  // SETUP: no backlog + continueOnError === true
  const mockSession: any = { metadata: { path: '/test' }, taskRegistry: null };
  const mockManager: any = { currentSession: mockSession };
  const pipeline = new PRPPipeline('./test.md');
  (pipeline as any).sessionManager = mockManager;
  (pipeline as any).#continueOnError = true;   // private field; see "Gotchas" for access

  // EXECUTE & VERIFY — the throw is ABOVE executeBacklog's try/catch, so isFatalError is
  // bypassed entirely; the abort propagates even when continueOnError would swallow everything.
  await expect(pipeline.executeBacklog()).rejects.toThrow(
    'Cannot execute pipeline: no backlog found in session'
  );
});
```
(See "Gotchas" for the exact field name + private-access convention; verify by reading the
class — the field may be `#continueOnError` or `continueOnError`.)

### Success Criteria
- [ ] `npx vitest run tests/unit/workflows/prp-pipeline-progress.test.ts` → **12/12 green**
      (or 13/13 if the optional hardening test is added; either is acceptable).
- [ ] The line-290-308 reject test (`taskRegistry: null`) is GREEN (was RED pre-S1).
- [ ] The line-768 test is UNCHANGED and GREEN (real backlog; contract's "empty backlog" premise
      is documented as wrong; no edit made to add a backlog it already has).
- [ ] `npx vitest run tests/unit/workflows/prp-pipeline.test.ts` → still **9 fail / 62 pass**
      (identical to the pre-S1 baseline; S2 does NOT fix these 9).
- [ ] A baseline comparison is recorded (commit message / verification note) proving S1
      introduced zero new failures (9 pre-S1 = 9 post-S1; progress 1→0).
- [ ] NO `src/` files modified (`git status --short src/` is empty after S2).
- [ ] (If hardening added) the new test is GREEN and asserts the abort under `continueOnError === true`.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** The decisive evidence is empirical (baseline run vs working-tree run, with exact
counts), not asserted. The contract's wrong premise is disproven by quoting the actual
line-768 test setup. Every one of the 9 pre-existing failures is classified by failure-mode +
taskRegistry setup, so the executor knows precisely what is (not) S2's. The optional
hardening test is given as near-complete code (with the one gotcha — private-field access —
flagged for verification).

### Documentation & References
```yaml
# MUST READ — the bug-report issue S1 implements (S2 verifies its test impact)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/prd_snapshot.md
  section: "Minor Issues → Issue 5: executeBacklog swallows 'no backlog found' instead of aborting"
  why: Expected behavior (abort loudly), actual (swallow), suggested fix (fatal subtype OR move
        above try/catch — "prefer aborting"). S1 implemented it; S2 verifies tests match.

# MUST READ — S1's PRP (the contract input; defines what now exists in src)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P2M1T1S1/PRP.md
  section: "Goal", "Technical requirements", Context §4 (test-impact)
  why: S1 moved the no-backlog throw ABOVE the try/catch + retyped to SessionError. Its research
        §4 ALREADY corrected the architecture doc's "line 798 empty backlog" claim (the test has
        a real backlog) — the SAME stale premise the S2 contract inherits. S1 edits ONLY src.

# MUST READ — this subtask's research (the empirical baseline + classification)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P2M1T1S2/research/s2-test-reconciliation-and-baseline.md
  section: §1 baseline table, §2 line-768 real backlog, §3 the-9-failures classification table,
           §4 the two legitimate checks, §5 verification-centric conclusion
  why: Proven facts: 9=9 (S1 broke nothing); progress 1→0 (S1 fixed the reject test); line-768
        has a real backlog (contract premise wrong); each of the 9 failures classified as
        pre-existing Issue 3/4 (P2.M3/P3 scope); no test expects the swallow behavior.

# MUST READ — the architecture finding (note its stale premise, corrected by research §2)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/architecture/test_validation.md
  section: "Issue 5: executeBacklog Swallows 'no backlog found'" + "Recommendation"
  why: Confirms the swallow mechanism + that line-304-305 will PASS after the fix.
  critical: Its claim "Line 799 test will FAIL (empty backlog)" is STALE/WRONG — see research §2.

# THE FILE(S) TO READ/VERIFY (S2 may EDIT only the progress file, optionally)
- file: tests/unit/workflows/prp-pipeline-progress.test.ts
  why: VERIFY 12/12 green. The reject test (290-308) is S1's proof-of-fix. The line-768 test has
        a REAL backlog (read it — do not assume empty). OPTIONAL: append the continue-on-error
        hardening test here (next to the existing reject test).
  pattern: "const mockSession: any = { metadata: { path: '/test' }, taskRegistry: null }; ... await expect(pipeline.executeBacklog()).rejects.toThrow('Cannot execute pipeline: no backlog found in session');"
  gotcha: Do NOT edit line 768 to "add a backlog" — it already has createTestBacklog([…P1.M1.T1.S1…]).

- file: tests/unit/workflows/prp-pipeline.test.ts
  why: VERIFY 9 fail / 62 pass is IDENTICAL to pre-S1 (baseline). DO NOT fix the 9 (P2.M3/P3 scope).
  pattern: 586/615 "resolved instead of rejecting" (truthy backlog, mock drift); 888-1031 runQACycle
           spy errors (Issue 4); 1110 currentSession:null + initialize-mock-not-wired (Issue 3).

# CONTRACT — the source S1 changed (READ-ONLY for S2; confirms narrow scope)
- file: src/workflows/prp-pipeline.ts
  why: executeBacklog() (~1366): the no-backlog check now sits ABOVE the try with `throw new
        SessionError('Cannot execute pipeline: no backlog found in session', { operation: 'executeBacklog' })`.
        `git diff HEAD -- src/workflows/prp-pipeline.ts` shows EXACTLY this (nothing else). S2 must NOT edit src.
  gotcha: To verify the continue-on-error property, read how the private continueOnError field is
          spelled/accessed (search the class for `continueOnError`). The abort is above the try, so
          isFatalError(error, this.#continueOnError) is never reached for the no-backlog path.

# HELPERS (read to confirm createTestBacklog([]) vs real backlog semantics)
- file: tests/unit/workflows/prp-pipeline-progress.test.ts (createTestBacklog/createTestSession/createMockSessionManager)
  why: createTestBacklog([...]) returns a truthy Backlog (even createTestBacklog([]) is a truthy
        empty-array/object → does NOT trigger the abort; falls through to totalSubtasks===0 early-return).
        Only `taskRegistry: null/undefined` triggers the abort. This is WHY line-768 (real backlog)
        and the many createTestBacklog([]) tests are all unaffected by S1.
```

### Current Codebase tree (relevant slice — S2 is test-only)
```bash
src/workflows/prp-pipeline.ts                       # READ-ONLY for S2 (S1's change is here, uncommitted in working tree)
tests/unit/workflows/prp-pipeline-progress.test.ts  # VERIFY 12/12 green; OPTIONAL append continue-on-error hardening test
tests/unit/workflows/prp-pipeline.test.ts           # VERIFY 9 fail/62 pass == pre-S1 baseline; DO NOT fix the 9
```

### Desired Codebase tree with files to be added/edited
```bash
tests/unit/workflows/prp-pipeline-progress.test.ts  # OPTIONALLY MODIFIED (+1 continue-on-error abort test). Otherwise unchanged.
# (NO src/ edits. NO edits to prp-pipeline.test.ts — its 9 failures are pre-existing P2.M3/P3 scope.)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — S1 broke NOTHING (empirically proven). Do NOT hunt for a test to "fix" that S1 broke.
//   The contract's line-799 premise is wrong: line 768 already has a real backlog. Verify; don't fabricate.

// CRITICAL — createTestBacklog([]) is a TRUTHY empty array/object. It does NOT trigger the no-backlog abort
//   (if (!backlog) is false). It resolves via the totalSubtasks===0 early-return INSIDE the try. So the many
//   createTestBacklog([]) tests are UNAFFECTED by S1. Only `taskRegistry: null/undefined` triggers the abort.

// CRITICAL — the 9 prp-pipeline.test.ts failures are PRE-EXISTING (9 at HEAD before S1 = 9 after). They are:
//   mock drift (586, 615, 1110 — Issue 3, P2.M3.T1 "Fix Rotted Test Fixtures and Mocks") and resume-detection
//   (888-1031 — Issue 4, P3 "Bugfix Session Numbering"). S2 must NOT fix them (would mask root causes + collide).

// GOTCHA — the optional continue-on-error test sets the private continueOnError field. READ the class to find
//   the exact spelling/access: it may be `#continueOnError` (private) requiring `(pipeline as any).#continueOnError`
//   — but TS private-field access via `as any` may still error; the field might actually be accessed differently.
//   Safer: check how existing tests set it (search tests/ for `continueOnError`). If no clean accessor exists,
//   SKIP the hardening test (it's optional) rather than contort the test — verification alone satisfies the task.

// GOTCHA — message must stay EXACTLY 'Cannot execute pipeline: no backlog found in session' (the reject test
//   sub-string-matches it; SessionError preserves the message verbatim).

// CRITICAL — the full `npm run test:run` is PRE-EXISTING-RED (bugfix Issue 3, ~297 failures). It is NOT S2's
//   gate. Gate = targeted progress suite green + the baseline-comparison proof (9=9). Don't "fix" unrelated red.

// GOTCHA — vitest resolves the `groundswell` sibling package via vitest.config.ts alias to ../groundswell/dist.
//   If you baseline-test in a separate worktree, symlink the sibling groundswell dir (see research §1).
```

---

## Implementation Blueprint

### Data models and structure
None. Test-only task. No new types, no `src/` changes.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: VERIFY the no-backlog reject test is GREEN (S1's proof-of-fix) — NO edit
  - RUN: npx vitest run tests/unit/workflows/prp-pipeline-progress.test.ts
  - EXPECTED: 12/12 passed. Specifically the it() at 290-308 ("should throw error when backlog is not
        found in session", taskRegistry:null) is GREEN (it was RED pre-S1 — S1's fix).
  - IF it is NOT green: STOP — S1's source change is incomplete/missing; re-read S1's PRP. (Do not "fix"
        the test to mask a missing source fix.)

Task 2: CONFIRM the line-768 test is unaffected (contract premise is wrong) — NO edit
  - READ tests/unit/workflows/prp-pipeline-progress.test.ts lines 768-801 (the "should handle missing
        ProgressTracker gracefully" it()).
  - CONFIRM its backlog is `createTestBacklog([…createTestSubtask('P1.M1.T1.S1', …)…])` — a REAL non-empty
        backlog (NOT empty). Confirm the run (Task 1) shows this it() GREEN.
  - DO NOT edit this test. The contract's "give it a valid non-empty backlog" is a NO-OP — it already has one.
  - RECORD in the verification note: "line-768 already carries a real backlog; the contract's 'empty backlog'
        premise (inherited from test_validation.md Issue 5) is empirically wrong; no edit needed."

Task 3: CONFIRM the prp-pipeline.test.ts failures are pre-existing (non-regression proof) — NO edit
  - RUN: npx vitest run tests/unit/workflows/prp-pipeline.test.ts
  - EXPECTED: 9 failed / 62 passed. Record the 9 failing it() names (586, 615, 888, 907, 918, 930, 943,
        1031, 1110 — see research §3 table).
  - PROVE non-regression: the pre-S1 baseline (HEAD) is ALSO 9 failed / 62 passed with the SAME it() names.
        (If a baseline run is desired, use a git worktree at HEAD + symlink the sibling groundswell package,
        per research §1. Otherwise cite this PRP's research §1 baseline table.)
  - DO NOT fix any of the 9. They are P2.M3 (mock drift: 586/615/1110) and P3 (resume-detection: 888-1031)
        scope. CLASSIFY each in the commit/verification note so the orchestrator can route them.

Task 4: (OPTIONAL HARDENING — recommended) ADD a continue-on-error abort test
  - PRECONDITION: first read src/workflows/prp-pipeline.ts to find how #continueOnError is spelled/accessed
        AND grep tests/ for any existing pattern that sets it (search "continueOnError"). If there is a clean,
        established accessor, proceed; if not, SKIP this task (verification alone satisfies S2).
  - APPEND to tests/unit/workflows/prp-pipeline-progress.test.ts (in the describe that holds the 290-308 reject
        test) an it() mirroring 290-308 BUT with continueOnError === true, asserting the SAME reject
        (see "Technical requirements" → optional hardening code).
  - EXPECTED: the file is now 13/13 green; the new test proves the abort survives continueOnError (S1's core
        invariant, currently untested). This is the ONLY test-file change S2 makes.

Task 5: VERIFY no src edits + record proof
  - RUN: git status --short src/   (EXPECTED: only S1's pre-existing `M src/workflows/prp-pipeline.ts`, which
        S2 must NOT touch further; S2 itself adds NO src changes. If S1's change is already committed by the
        time S2 runs, src/ may be clean — either way S2 adds nothing.)
  - RUN: git status --short tests/  (EXPECTED: at most `M tests/unit/workflows/prp-pipeline-progress.test.ts`
        IF Task 4 was done; otherwise empty.)
  - RECORD the baseline comparison (the two-row table from the Goal) in the commit message / verification note.
  - EXPECTED: progress suite green; prp-pipeline suite 9=9 (non-regressive); no src edits by S2.
```

### Implementation Patterns & Key Details
```ts
// ---- The reject test S1 makes GREEN (progress.test.ts:290-308) — S2 verifies, does not edit ----
const mockSession: any = { metadata: { path: '/test' }, taskRegistry: null }; // No backlog
const mockManager: any = { currentSession: mockSession };
const pipeline = new PRPPipeline('./test.md');
(pipeline as any).sessionManager = mockManager;
await expect(pipeline.executeBacklog()).rejects.toThrow(
  'Cannot execute pipeline: no backlog found in session'
); // RED pre-S1 → GREEN post-S1

// ---- The line-768 test the contract MISREAD as "empty backlog" (it has a REAL backlog) — do NOT edit ----
const backlog = createTestBacklog([
  createTestPhase('P1', 'Phase 1', 'Planned', [
    createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
      createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
        createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),  // ← real subtask → truthy → abort NOT fired
      ]),
    ]),
  ]),
]);
// ... mockProgressTracker.mockReturnValueOnce(undefined as any);
await expect(pipeline.executeBacklog()).resolves.not.toThrow();  // line 799 — GREEN (unaffected by S1)

// ---- OPTIONAL hardening: the abort survives continueOnError (Task 4) ----
it('should abort on missing backlog even under continueOnError (bugfix Issue 5)', async () => {
  const mockSession: any = { metadata: { path: '/test' }, taskRegistry: null };
  const pipeline = new PRPPipeline('./test.md');
  (pipeline as any).sessionManager = { currentSession: mockSession };
  (pipeline as any).#continueOnError = true;   // VERIFY exact field name/access first; skip Task 4 if awkward
  await expect(pipeline.executeBacklog()).rejects.toThrow(
    'Cannot execute pipeline: no backlog found in session'
  );
});
```

### Integration Points
```yaml
SOURCE (src/workflows/prp-pipeline.ts): NO S2 EDIT (S1 owns; change is the no-backlog throw moved above
  the try + retyped to SessionError). `git diff HEAD -- src/workflows/prp-pipeline.ts` confirms scope.

TESTS (S2's domain — test-only):
  - tests/unit/workflows/prp-pipeline-progress.test.ts: VERIFY 12/12 green; OPTIONAL +1 continue-on-error test.
  - tests/unit/workflows/prp-pipeline.test.ts: VERIFY 9 fail/62 pass == pre-S1 baseline; DO NOT fix the 9.

NO CHANGES TO (hard boundary):
  - any src/ file (test-only task).
  - the 9 pre-existing prp-pipeline.test.ts failures (P2.M3 mock-drift: 586/615/1110; P3 resume-detection:
    888-1031). Fixing them here masks root causes and collides with P2.M3/P3.
  - line 768's backlog (already real — the contract's "add a backlog" is a no-op).
  - the full npm run test:run gate (pre-existing Issue 3 redness, P2.M2/P2.M3 scope).
```

---

## Validation Loop

### Level 1: Syntax & Style (only if Task 4 edits a test file)
```bash
npm run fix            # lint:fix + prettier --write (only if a test file was edited)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json (test files aren't in tsconfig.build, but run anyway)
npm run lint           # eslint . --ext .ts
npm run format:check   # prettier --check
# Expected: clean. If Task 4's private-field access errors under lint/typecheck, either fix the accessor or
#   SKIP Task 4 (verification alone satisfies the task — do not contort the test).
git status --short src/    # Expected: empty for S2 (S1's change may show if still uncommitted; S2 adds nothing).
```

### Level 2: Unit Tests (the actual gate)
```bash
# THE proof S1's fix works + nothing regressed:
npx vitest run tests/unit/workflows/prp-pipeline-progress.test.ts
#   Expected: 12/12 (or 13/13 if Task 4 added the hardening test) PASSED.
#   The 290-308 reject test (taskRegistry:null) is GREEN (was RED pre-S1).
#   If it is RED, S1's source fix is missing — STOP (do not edit the test to mask it).

# The non-regression proof:
npx vitest run tests/unit/workflows/prp-pipeline.test.ts
#   Expected: 9 failed / 62 passed — IDENTICAL to the pre-S1 baseline (research §1). S2 does NOT fix these 9.
#   Record the failing it() names; confirm they match the pre-existing set (586,615,888,907,918,930,943,1031,1110).
```

### Level 3: Non-regression baseline (the key evidence)
```bash
# Prove S1 introduced ZERO new failures by comparing HEAD (pre-S1) vs working tree (post-S1).
# Method (non-destructive to the parallel S1 work): isolated git worktree at HEAD.
git worktree add --detach /tmp/pi-s2-baseline HEAD
ln -s "$(pwd)/node_modules" /tmp/pi-s2-baseline/node_modules
ln -s "$(cd .. && pwd)/groundswell" /tmp/groundswell   # sibling package; vitest alias resolves ../groundswell
( cd /tmp/pi-s2-baseline && npx vitest run tests/unit/workflows/prp-pipeline.test.ts 2>&1 | grep -E "Tests " )
#   Expected (pre-S1): "9 failed | 62 passed"  ← MUST equal the post-S1 working-tree result.
( cd /tmp/pi-s2-baseline && npx vitest run tests/unit/workflows/prp-pipeline-progress.test.ts 2>&1 | grep -E "Tests " )
#   Expected (pre-S1): "1 failed | 11 passed"  ← post-S1 is "0 failed | 12 passed" (S1 fixed the 1).
git worktree remove /tmp/pi-s2-baseline --force && rm -f /tmp/groundswell
# Expected: prp-pipeline.test.ts 9=9 (non-regressive); progress.test.ts 1→0 (S1's fix). This is the deliverable proof.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP. Domain checks (record in verification/commit note):
#   1. S1 non-regressive — prp-pipeline.test.ts 9 failures IDENTICAL pre/post-S1 (Level 3 proof).
#   2. S1's intended fix — progress.test.ts 290-308 RED→GREEN (Level 2).
#   3. No swallow-expectation test exists — grep confirms no it() calls executeBacklog expecting resolution
#      with taskRegistry:null. (The closest, line-768, has a real backlog.)
#   4. Contract premise corrected — line-768 has a real backlog (read it); no edit needed.
#   5. (If Task 4 done) abort survives continueOnError — the new test is GREEN.
rg -n "taskRegistry:\s*null|taskRegistry:\s*undefined" tests/   # the only no-backlog setups (assertion targets)
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx vitest run tests/unit/workflows/prp-pipeline-progress.test.ts` → **12/12 (or 13/13) green**.
- [ ] `npx vitest run tests/unit/workflows/prp-pipeline.test.ts` → **9 fail / 62 pass** (identical to pre-S1 baseline).
- [ ] Non-regression baseline recorded (Level 3): prp-pipeline 9=9; progress 1→0.
- [ ] `git status --short src/` shows NO S2 edit (S1's change may remain; S2 adds nothing to src).

### Feature Validation
- [ ] The line-290-308 reject test (`taskRegistry:null`) is GREEN (S1's proof-of-fix).
- [ ] The line-768 test is UNCHANGED and GREEN (real backlog; contract premise documented as wrong).
- [ ] No test expects executeBacklog to "resolve (swallow)" on no-backlog (verified by grep + the 12/12 pass).
- [ ] The 9 prp-pipeline failures are classified + routed (P2.M3 mock-drift: 586/615/1110; P3 resume-detection: 888-1031).
- [ ] (If Task 4 done) the continue-on-error abort test is GREEN and locks S1's invariant.

### Code Quality Validation
- [ ] S2 edits ONLY test files (at most progress.test.ts, +1 test); NO `src/` edits.
- [ ] No spurious/no-op edit to line 768 (it already has a real backlog).
- [ ] The 9 pre-existing failures are LEFT RED (fixing them is P2.M3/P3 scope — out of bounds).
- [ ] Optional hardening test (if added) mirrors the existing 290-308 reject-test style + uses a verified accessor.

### Documentation & Deployment
- [ ] Commit/verification note records: S1 non-regressive (9=9); S1's intended fix (progress 1→0); the corrected
      contract premise (line-768 has a real backlog, not empty); the classification of the 9 pre-existing failures.
- [ ] No `docs/*.md`, README, or `.env.example` changes (test-only; no user-facing/config/API surface change).
```

---

## Anti-Patterns to Avoid

- ❌ Don't fabricate a fix for a non-existent breakage. S1 broke nothing (baseline: 9=9). The contract's
      "line 799 empty backlog will fail" premise is empirically wrong — line 768 has a real backlog. Verify; don't invent.
- ❌ Don't edit line 768 to "add a non-empty backlog." It already has `createTestBacklog([…P1.M1.T1.S1…])`. That's a no-op at best.
- ❌ Don't fix the 9 prp-pipeline.test.ts failures. They are pre-existing mock-drift (Issue 3 → P2.M3) and
      resume-detection (Issue 4 → P3). Fixing them here masks root causes and collides with those tasks.
- ❌ Don't use the full `npm run test:run` as the gate. It's pre-existing-red (Issue 3, ~297 failures, P2.M2/P2.M3
      scope). Gate = the targeted progress suite green + the baseline-comparison proof.
- ❌ Don't edit any `src/` file. S2 is test-only; S1 owns the source change.
- ❌ Don't conflate `createTestBacklog([])` (truthy empty array → resolves via totalSubtasks===0 early-return,
      UNAFFECTED by S1) with `taskRegistry: null/undefined` (triggers the abort). Only the null/undefined path changed.
- ❌ Don't "fix" the line-290-308 reject test if it's somehow RED — that means S1's source fix is missing; escalate,
      don't mask. (Empirically it's GREEN post-S1.)
- ❌ Don't contort the optional continue-on-error test with hacky private-field access. If there's no clean accessor,
      SKIP Task 4 — verification alone satisfies the task.
- ❌ Don't rephrase the message. Keep it EXACTLY `'Cannot execute pipeline: no backlog found in session'`.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a verification task whose central question — "did S1 break any tests, and do any
tests need updating?" — is answered **empirically**, not by assertion. An isolated git-worktree
baseline at HEAD (pre-S1) vs the working tree (post-S1) proves: `prp-pipeline.test.ts` 9 failed / 62
passed BOTH before and after (zero new failures); `progress.test.ts` 1 failed → 0 failed (S1's intended
fix, RED→GREEN on the line-290-308 reject test). The contract's anticipated breakage ("line 799 empty
backlog") is disproven by reading the actual line-768 test (real `createTestBacklog([…P1.M1.T1.S1…])`
backlog) — the same stale premise the architecture doc carries and that S1's PRP research §4 already
corrected. All 9 pre-existing failures are classified by failure-mode + taskRegistry setup and routed to
P2.M3 (mock drift) / P3 (resume-detection), so the executor knows precisely what is NOT in scope. The
one genuine gap (the continue-on-error property is untested) is addressed with an optional, clearly-scoped
hardening test, with a safe skip path if the private-field accessor is awkward. Residual risks are minimal:
(a) the executor misreads the task and invents a spurious edit — heavily mitigated by the headline finding
+ anti-patterns; (b) S1's change isn't actually present at execution time — caught immediately by Task 1
(the reject test would be RED → escalate, don't mask); (c) the optional test's accessor — skip path provided.
No runtime/network/LLM unknowns; the baseline numbers are the ground truth.
```