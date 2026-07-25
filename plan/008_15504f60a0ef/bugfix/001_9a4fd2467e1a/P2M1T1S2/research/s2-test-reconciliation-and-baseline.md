# P2.M1.T1.S2 — Research: verify/update unit tests for the executeBacklog abort behavior

Scope: reconcile unit tests against P2.M1.T1.S1's source change (the "no backlog
found" throw moved ABOVE executeBacklog's try/catch and retyped to a fatal
`SessionError`, so it propagates instead of being swallowed). This is a **test-only**
task (no `src/` edits).

Implementation order: S1 (source) is already applied in the working tree
(`git diff HEAD -- src/workflows/prp-pipeline.ts` shows EXACTLY the S1 PRP's change —
nothing more). S2 consumes it.

---

## 1. THE DECISIVE EVIDENCE — empirical baseline vs post-S1 (run, not guessed)

S1's change is **uncommitted in the working tree** (`M src/workflows/prp-pipeline.ts`);
the test files are clean at HEAD. To separate "S1-caused" from "pre-existing red", I
built an isolated git worktree at HEAD (pre-S1 source) and ran the affected suites:

| File | Pre-S1 (HEAD worktree) | Post-S1 (working tree) | S1 net impact |
|------|------------------------|------------------------|---------------|
| `tests/unit/workflows/prp-pipeline-progress.test.ts` | **1 failed / 11 passed** | **0 failed / 12 passed** | ✅ the line-290-308 `taskRegistry:null` reject test RED→GREEN. Nothing else changed. |
| `tests/unit/workflows/prp-pipeline.test.ts` | **9 failed / 62 passed** | **9 failed / 62 passed** | ⚠️ **ZERO new failures** — identical pass/fail counts before and after S1. |

(worktree was at `/tmp/pi-s2-baseline`; `groundswell` resolved via a `/tmp/groundswell`
symlink to the sibling package; worktree removed after measurement.)

**CONCLUSION: S1 broke nothing.** The 9 `prp-pipeline.test.ts` failures are
**pre-existing** (they fail identically at HEAD, before S1 exists). S1's only test
effect is the intended one: fixing the 1 red reject test in progress.test.ts.

## 2. THE CONTRACT'S "line 799 empty backlog" PREMISE IS EMPIRICALLY WRONG

The S2 contract (LOGIC c) claims: "same file line 799 has a DIFFERENT test
('handle missing ProgressTracker gracefully') that calls `executeBacklog().resolves.
not.toThrow()` with an EMPTY backlog. This test will now FAIL ... Fix: give the line
799 test session a VALID non-empty backlog."

**The actual test** (`progress.test.ts`, `it('should handle missing ProgressTracker
gracefully')` at lines 768–801, whose final assertion is line 799) ALREADY uses a
**real, non-empty backlog**:
```ts
const backlog = createTestBacklog([
  createTestPhase('P1', 'Phase 1', 'Planned', [
    createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
      createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
        createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),   // ← REAL subtask
      ]),
    ]),
  ]),
]);
const mockSession = createTestSession(backlog);   // taskRegistry = real backlog (truthy)
```
- The no-backlog abort is `if (!backlog) throw`. `createTestBacklog([...])` is truthy →
  the abort does NOT fire → the test reaches the ProgressTracker-undefined path → resolves
  (as intended). It is GREEN post-S1 (12/12). **No edit is needed.**
- This corroborates the S1 PRP's own correction: its research §4 says the architecture doc's
  "line 798 has an empty backlog" claim is WRONG and that the test "has a real P1.M1.T1.S1
  backlog." Both the architecture doc (`test_validation.md` Issue 5) and the S2 contract
  inherit the SAME stale/wrong premise. The empirical 12/12 pass settles it.

→ **A PRP that instructs the executor to "give line 799 a non-empty backlog" would be a
   no-op at best (it already has one) or a misdirected edit at worst.** The honest PRP
   documents this and prescribes VERIFICATION, not a fabricated fix.

## 3. Classification of the 9 prp-pipeline.test.ts failures (all PRE-EXISTING)

S1's diff is confirmed NARROW (only the no-backlog check moves above the try + retypes
the throw to SessionError; everything else byte-identical). S1 changes behavior ONLY on
the `currentSession.taskRegistry` null/undefined path: resolve(swallowed) → reject(propagates).
A test with a real/truthy backlog is UNAFFECTED. The 9 failures, by failure MODE + setup:

| # | Test (file:line) | Failure mode | taskRegistry | Verdict |
|---|------------------|--------------|--------------|---------|
| 1 | executeBacklog > "should throw if processNextItem throws" (586) | `promise resolved instead of rejecting` | truthy (would reject if null) | PRE-EXISTING mock drift (Issue 3) |
| 2 | executeBacklog > "should throw safety error after max iterations" (615) | `promise resolved instead of rejecting` | truthy | PRE-EXISTING mock drift (Issue 3) |
| 3 | resume > "resumes when tasks.json is MISSING" (888) | `spy should not be called but called 1` | (runQACycle path) | PRE-EXISTING (Issue 4 detection) |
| 4 | resume > "resumes when tasks.json is EMPTY" (907) | same | (runQACycle) | PRE-EXISTING (Issue 4) |
| 5 | resume > "resumes when CORRUPT (invalid JSON)" (918) | same | (runQACycle) | PRE-EXISTING (Issue 4) |
| 6 | resume > "resumes when CORRUPT (valid JSON, invalid Backlog)" (930) | same | (runQACycle) | PRE-EXISTING (Issue 4) |
| 7 | resume > "resumes when UNREADABLE" (943) | same | (runQACycle) | PRE-EXISTING (Issue 4) |
| 8 | resume > "falls through to fresh hunt when resume THROWS" (1031) | `MockFixCycleWorkflow 0 not 1` | (runQACycle) | PRE-EXISTING (Issue 4) |
| 9 | run > "should return PipelineResult with success false on error" (1110) | `result.error = 'no backlog found' not 'Test error'` | `currentSession:null` | PRE-EXISTING mock drift (Issue 3); S1 only changed the symptom message |

**Why test 9 is pre-existing:** its setup mocks `errorManager.initialize` to reject with
`'Test error'` with `currentSession: null`. If the mock took effect, `run()` would surface
`'Test error'` BEFORE executeBacklog runs — and the test would PASS regardless of S1. The
fact it surfaces `'no backlog found'` proves the initialize mock is NOT taking effect
(mock drift): `run()` falls through to executeBacklog with a null session. Pre-S1, the
old no-backlog throw was swallowed → executeBacklog resolved → run() continued with no
error → test failed with "expected success false, got true" (a DIFFERENT message, but
still a failure). So test 9 FAILS both before and after S1 — pre-existing mock drift,
root cause = `MockSessionManagerClass.mockImplementation` not wiring through (P2.M3.T1
"Fix Rotted Test Fixtures and Mocks" scope), NOT S2.

→ **None of the 9 failures expect executeBacklog to "resolve (swallow) on no-backlog".**
   None are S1-caused. All are pre-existing Issue 3 (mock drift) / Issue 4 (resume-detection)
   → P2.M3 and P3 scope respectively.

## 4. The contract's two legitimate checks (both PASS, no edit needed)

- **(b) `progress.test.ts:290-308`** ("should throw error when backlog is not found in
  session", `taskRegistry: null`) — expects `.rejects.toThrow('Cannot execute pipeline:
  no backlog found in session')`. **RED pre-S1 → GREEN post-S1.** Verified (12/12).
- **(d) continue-on-error independence** — the abort is above the try/catch so it
  propagates even under `#continueOnError===true`. There is **NO existing test** that sets
  continueOnError=true with executeBacklog (only a comment at `prp-pipeline.test.ts:1587`).
  → This property is currently UNTESTED. A small NEW test locking it in is valuable and
  in-scope ("verify ... the abort behavior") — see PRP Task 4 (recommended hardening).

## 5. NO test edits are MANDATORY. S2 is verification-centric.

- progress.test.ts: 12/12 green post-S1 — no edit.
- prp-pipeline.test.ts: 9 failures all pre-existing — NOT S2's to fix (P2.M3/P3).
- The single valuable, in-scope ACTION is the optional continue-on-error hardening test.

## 6. Validation gate (verified)

- `npx vitest run tests/unit/workflows/prp-pipeline-progress.test.ts` → **12/12 green**
  (the proof S1's fix works + nothing regressed).
- `npx vitest run tests/unit/workflows/prp-pipeline.test.ts` → 9 fail / 62 pass — the 9
  are pre-existing (baseline-proven). S2 must NOT count these as its failures; S2 must
  prove they're IDENTICAL pre/post-S1 (baseline = 9, working-tree = 9).
- The full `npm run test:run` is PRE-EXISTING-RED (bugfix Issue 3, ~297 failures) — NOT
  S2's gate (P2.M2/P2.M3 scope). S2's gate = the targeted progress suite green + the
  baseline-comparison proof that S1 introduced zero new failures.
- S2 edits ONLY test files (if it adds the recommended hardening test). NO `src/` edits.

## 7. Out of scope (hard boundaries)

- ANY `src/` file — S1 owns the source; S2 is test-only.
- The 9 pre-existing prp-pipeline.test.ts failures — P2.M3 (mock drift: tests 1,2,9) and
  P3 (resume-detection: tests 3-8) scope. S2 must not fix them (would mask the real
  underlying issues and collide with P2.M3/P3).
- Fixing the contract's/wrong premise by editing line 768 to add a backlog it already has
  (no-op; would confuse reviewers).
- The full-suite green — Issue 3 (P2.M2/P2.M3).