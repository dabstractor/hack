# PRP — P5.M1.T2.S2: Extend `ExecutionResult` to tri-state; surface the issue outcome

## Goal

**Feature Goal**: Stop discarding the `issue` outcome. The internal `ExecuteResult` parser already produces a tri-state (`'error' | 'success' | 'issue'`), but the public `ExecutionResult` collapses **both** `error` and `issue` into `{ success: false }` at `src/agents/prp-executor.ts` line ~309. Extend the public `ExecutionResult` interface to carry an explicit `outcome: 'success' | 'fail' | 'issue'` (+ `issueMessage?: string`), keep `success: boolean` for backward compatibility (`success === outcome === 'success'`), and branch the collapsing site so the `issue` signal surfaces distinctly from `fail`. Propagate unchanged through `PRPRuntime` (pure pass-through).

**Deliverable**:
1. `ExecutionResult` interface (`src/agents/prp-executor.ts`) gains `readonly outcome?: 'success' | 'fail' | 'issue'` and `readonly issueMessage?: string`, with Mode-A JSDoc explaining the tri-state and that `issue` = a *recoverable planning gap* (PRD §4.5).
2. `PRPExecutor.execute()` — the collapsing `if (coderResult.result !== 'success')` branch (line ~309) is **split** into `issue` (outcome `'issue'` + `issueMessage`) vs `error` (outcome `'fail'`); the final validation return (line ~392) sets `outcome: allPassed ? 'success' : 'fail'`; the `catch` return (line ~416) sets `outcome: 'fail'`.
3. `PRPRuntime.executeSubtask()` — pass-through (no behavior change); add `outcome: 'fail'` to its own `catch`-constructed result for completeness. Still sets status `'Failed'` on `success===false` (the issue→`Planned` reset is **S4**, not here).
4. Updated + new unit tests (failing-first TDD) in `tests/unit/agents/prp-executor.test.ts` and `tests/unit/agents/prp-runtime.test.ts`.

**Success Definition**: `npm run validate` (eslint + prettier --check + tsc --noEmit) and `npm run test:run` (vitest run) both green; a Coder-Agent response of `{"result":"issue",...}` yields an `ExecutionResult` with `success===false && outcome==='issue' && issueMessage` set, **distinct** from `{"result":"error",...}` which yields `outcome==='fail'`; all pre-existing `result.success` reads/tests remain valid.

## Why

- **Business value**: PRD §4.5 introduces the **Issue-Driven Re-planning Loop**. When the Coder Agent reports `issue` (the PRP was *insufficient* — missing context, wrong assumptions, ambiguous requirements — but the work is still valid), the pipeline should delete the stale PRP, reset the item to `Planned`, and re-research with `<issue_feedback>` injected. **Today that signal is parsed and then thrown away** (line ~309 collapses `issue` into `fail`). This subtask makes the `issue` outcome *available* on the public result type so S4 (orchestrator) can branch on it.
- **Scope boundary**: This subtask ships **only the signal plumbing** (type + surface + tests). It does NOT implement the re-planning flow. S3 (1 pt) injects `issue_feedback` into the blueprint prompt; S4 (2 pts) implements the orchestrator branch bounded by `getIssueRetryMax()` (the config S1 ships in parallel). The `docs/WORKFLOWS.md` issue subsection is also S4 (it needs the full flow).
- **Scope cohesion**: This is step 2 of the 4-subtask issue-driven re-planning chain (S1 config → **S2 type/signal** → S3 feedback injection → S4 orchestrator flow). It is the seam every downstream piece consumes: S4 reads `result.outcome === 'issue'` and `result.issueMessage`.
- **Why keep `success: boolean`**: The orchestrator (`src/core/task-orchestrator.ts` L740,767), `PRPRuntime`, and every integration test read `result.success`. Removing it would be a breaking change across the codebase. Adding an additive optional `outcome` (discriminated by `success === (outcome === 'success')`) is the backward-compatible way to expose the tri-state.

## What

### User-visible behavior

None directly — this is an internal type/contract layer. The observable effect is that `PRPExecutor.execute()` now returns a result whose `outcome` field distinguishes a *recoverable planning gap* (`'issue'`) from a hard *implementation failure* (`'fail'`), enabling the future (S4) re-planning branch. Existing callers that only read `result.success` behave identically.

### Technical requirements (the CONTRACT)

1. **Do NOT touch the internal `ExecuteResult` parsing.** `interface ExecuteResult { result: 'error' | 'success' | 'issue'; message: string }` (line ~147) and `#parseCoderResult()` already produce the tri-state correctly (implementation_notes.md §2). The fix is at the *collapse site*, not the parser.
2. **Extend the public `ExecutionResult` additively.** Add exactly:
   - `readonly outcome?: 'success' | 'fail' | 'issue'` — optional for backward compat (so every existing construction site keeps compiling), but **always set** by every return in `execute()`.
   - `readonly issueMessage?: string` — set only on the `'issue'` outcome; carries the Coder Agent's explanation of the planning gap.
3. **Keep `success: boolean`** with the invariant `success === (outcome === 'success')`. Do NOT remove or rename it.
4. **Branch the collapse site (line ~309)** — do not collapse `issue` into `fail`:
   - `coderResult.result === 'issue'` → `{ success: false, outcome: 'issue', issueMessage: coderResult.message, validationResults: [], artifacts: [], error: coderResult.message, fixAttempts: 0 }`
   - `coderResult.result === 'error'` → `{ success: false, outcome: 'fail', validationResults: [], artifacts: [], error: coderResult.message, fixAttempts: 0 }`
5. **Set `outcome` on the other two return sites** in `execute()`: final validation return (line ~392) → `outcome: allPassed ? 'success' : 'fail'`; `catch` return (line ~416) → `outcome: 'fail'`.
6. **`PRPRuntime` = pass-through, no behavior change.** It returns the executor's result object unchanged (already does). Add `outcome: 'fail'` to its own `catch`-constructed result for type-completeness. It STILL sets status `'Failed'` when `success===false` (incl. `issue`) — the reset→`Planned` is S4.
7. **TDD + same-commit test updates** (implementation_notes.md §7): write the failing test first, and update the existing `result.success` assertions in the SAME subtask so the suite stays green.
8. **Mode A docs**: JSDoc on `ExecutionResult` explaining the tri-state and that `issue` = recoverable planning gap (PRD §4.5). The `docs/WORKFLOWS.md` subsection is **S4** (out of scope).

### Success Criteria

- [ ] `ExecutionResult` in `src/agents/prp-executor.ts` has `readonly outcome?: 'success' | 'fail' | 'issue'` and `readonly issueMessage?: string` with Mode-A JSDoc (tri-state explained, `issue` cross-refs PRD §4.5).
- [ ] A Coder-Agent response of `{"result":"issue","message":"..."}` yields `result.success === false && result.outcome === 'issue' && result.issueMessage === "..."` and does NOT run validation gates.
- [ ] A Coder-Agent response of `{"result":"error","message":"..."}` yields `result.success === false && result.outcome === 'fail'` and `result.issueMessage` is **unset/undefined**.
- [ ] A fully-passing execution yields `result.success === true && result.outcome === 'success'`.
- [ ] A validation-exhaustion failure yields `result.outcome === 'fail'` (line ~392).
- [ ] An exception in `execute()` yields `result.outcome === 'fail'` (line ~416 `catch`).
- [ ] `PRPRuntime.executeSubtask()` passes `outcome`/`issueMessage` through unchanged; its own `catch` returns `outcome: 'fail'`; status is STILL `'Failed'` for `success===false` (no behavior change — S4 territory).
- [ ] All pre-existing `result.success` reads still behave identically (backward compatible).
- [ ] Internal `ExecuteResult` interface and `#parseCoderResult()` are **unchanged** (`git diff` confirms).
- [ ] `src/core/task-orchestrator.ts` is **unchanged** (the issue-branch is S4; `git diff` empty).
- [ ] `npm run validate` passes (zero errors).
- [ ] `npm run test:run` passes (all green, new + updated tests included).
- [ ] RED step observed before GREEN (failing test written before implementation — TDD).

## All Needed Context

### Context Completeness Check

_Pass_: An agent with zero codebase knowledge can implement this from the exact current code blocks quoted below (the collapse site, the two other returns, the interface), the internal `ExecuteResult` definition (quoted), the test file patterns (the existing error-success tests to mirror + extend), and the verified validation commands. Every reference resolves to a real file/line in the tree today. No inference required — it is a targeted branch-split + additive type extension.

### Documentation & References

```yaml
# MUST READ — the ONE file edited for type + logic
- file: src/agents/prp-executor.ts
  why: Contains the public ExecutionResult interface (~L67-79), the internal ExecuteResult tri-state parser (~L147), and the collapsing branch to rewrite (~L309). All three return sites that need `outcome` live here.
  pattern: |
    # CURRENT public interface (EXTEND additively — keep success: boolean):
    export interface ExecutionResult {
      readonly success: boolean;
      readonly validationResults: ValidationGateResult[];
      readonly artifacts: string[];
      readonly error?: string;
      readonly fixAttempts: number;
    }
    # CURRENT internal parser interface (DO NOT TOUCH — already tri-state):
    interface ExecuteResult {
      result: 'error' | 'success' | 'issue';
      message: string;
    }
    # CURRENT collapse site (THE branch to split — L~309):
    if (coderResult.result !== 'success') {
      return { success: false, validationResults: [], artifacts: [],
               error: coderResult.message, fixAttempts: 0 };
    }
    # CURRENT final return (L~392 — add outcome):
    return { success: allPassed, validationResults, artifacts: [],
             error: allPassed ? undefined : 'Validation failed after all fix attempts',
             fixAttempts };
    # CURRENT catch return (L~416 — add outcome):
    return { success: false, validationResults: [], artifacts: [],
             error: error instanceof Error ? error.message : String(error), fixAttempts };
  gotcha: |
    - Do NOT change ExecuteResult parsing or #parseCoderResult — they already work.
    - `outcome` and `issueMessage` MUST be optional (`?`) so every existing construction site
      (mock factories, structural test objects) keeps type-checking.
    - Every return inside execute() MUST set `outcome` explicitly; only the TYPE is optional.

# MUST READ — the pass-through consumer (minimal edit)
- file: src/agents/prp-runtime.ts
  why: executeSubtask() returns the executor's result UNCHANGED on the normal path (already a pass-through). Its own catch constructs { success:false, ... } — add outcome:'fail' there (the ONLY runtime code edit). Status logic (Complete/Failed) is UNCHANGED — the issue→Planned reset is S4.
  pattern: |
    # NORMAL PATH (L~218): returns `result` from executor.execute() AS-IS → already surfaces outcome/issueMessage. NO edit.
    # RUNTIME CATCH (L~245): currently returns:
    return { success: false, validationResults: [], artifacts: [],
             error: errorMessage, fixAttempts: 0 };
    # → add `outcome: 'fail',` (additive; no behavior change).
  gotcha: PRPRuntime STILL calls setStatus('Failed', ...) when result.success===false (incl. issue). Do NOT add an issue branch here — that is the orchestrator (S4).

# MUST READ — test patterns to clone-and-extend (implicit TDD, same subtask)
- file: tests/unit/agents/prp-executor.test.ts
  why: Canonical executor unit tests. (1) "should return failed result when Coder Agent reports error" (~L280) is the test to EXTEND with outcome:'fail'. (2) "should successfully execute PRP with all validation gates passing" (~L196) is the success test to EXTEND with outcome:'success'. (3) CLONE the error test for the NEW issue test (mock returns {result:'issue',message}). Shows the mock setup (mockAgent.prompt.mockResolvedValue(JSON.stringify({...}))) and the SETUP/EXECUTE/VERIFY comment rhythm.
  pattern: |
    # EXISTING error test to EXTEND (mock returns result:'error'):
    mockAgent.prompt.mockResolvedValue(
      JSON.stringify({ result: 'error', message: 'Failed to parse PRP' })
    );
    const result = await executor.execute(prp, prpPath);
    expect(result.success).toBe(false);
    # ADD: expect(result.outcome).toBe('fail'); expect(result.issueMessage).toBeUndefined();
    # NEW issue test (clone of above, mock returns result:'issue'):
    mockAgent.prompt.mockResolvedValue(
      JSON.stringify({ result: 'issue', message: 'PRP missing API spec; cannot implement' })
    );
    const result = await executor.execute(prp, prpPath);
    expect(result.success).toBe(false);
    expect(result.outcome).toBe('issue');
    expect(result.issueMessage).toBe('PRP missing API spec; cannot implement');
    expect(result.error).toBe('PRP missing API spec; cannot implement');
    expect(result.validationResults).toEqual([]); // issue short-circuits before validation
  gotcha: The "ExecutionResult interface" structural describe block (~L740,~L760) constructs ExecutionResult objects without outcome — they STILL compile (outcome is optional). Leave them; optionally add outcome to demonstrate the field.

# MUST READ — runtime pass-through test pattern
- file: tests/unit/agents/prp-runtime.test.ts
  why: Shows createMockExecutionResult(success) factory + mockExecutor.execute.mockResolvedValue(...) wiring. Use it to add ONE new test: mockExecutor returns an outcome:'issue' result → assert runtime passes it through (result.outcome==='issue') AND status is STILL 'Failed' (documents the S4 boundary — no behavior change in S2).
  pattern: |
    const createMockExecutionResult = (success: boolean): ExecutionResult => ({
      success, validationResults: [/*...*/], artifacts: ['/path/to/file.ts'],
      error: success ? undefined : 'Validation failed', fixAttempts: 0,
    });
    # NEW issue pass-through test:
    const issueResult: ExecutionResult = {
      success: false, outcome: 'issue', issueMessage: 'missing context',
      validationResults: [], artifacts: [], error: 'missing context', fixAttempts: 0,
    };
    mockExecutor.execute.mockResolvedValue(issueResult);
    const result = await runtime.executeSubtask(subtask, backlog);
    expect(result.outcome).toBe('issue');
    expect(result.issueMessage).toBe('missing context');
    expect(mockOrchestrator.setStatus).toHaveBeenCalledWith(subtask.id, 'Failed', expect.any(String)); // STILL Failed (S4 changes this)
  gotcha: createMockExecutionResult does NOT set outcome — it still type-checks because outcome is optional. Do not need to change it for existing tests.

# REFERENCE — the bug description + same-commit test rule
- file: plan/005_d32a2ecf61cd/architecture/implementation_notes.md
  why: §2 confirms the collapse bug + "don't re-parse". §7 mandates updating consuming tests in the SAME subtask (implicit TDD) — this is why the executor + runtime test edits are IN scope here, not deferred.
  section: "§2 ExecutionResult already half-supports issue" and "§7 Test fragility"

# REFERENCE — the feature cluster + downstream contract
- file: plan/005_d32a2ecf61cd/architecture/delta_impact.md
  why: R2 lists EXACTLY what changes per layer. Confirms S2 = executor surface only (this subtask); S3 = feedback injection; S4 = orchestrator flow bounded by ISSUE_RETRY_MAX. Confirms `issue_feedback.md` protection is implicit (not our concern).
  section: "R2 (Issue-Driven Re-planning)"

# REFERENCE — PRD source of truth for semantics
- file: PRD.md
  why: §4.5 defines `issue` as a RECOVERABLE PLANNING GAP (PRP insufficient but work valid), deliberately distinct from hard `fail` (implementation problem → existing fix-and-retry). The ExecutionResult JSDoc must quote this distinction.
  section: "§4.5 The Issue-Driven Re-planning Loop"

# PARALLEL-EXECUTION CONTEXT (zero file overlap — safe to land together)
- file: plan/005_d32a2ecf61cd/P5M1T2S1/PRP.md
  why: S1 (ISSUE_RETRY_MAX config) is implemented IN PARALLEL. It edits ONLY src/config/constants.ts, tests/unit/config/issue-retry-max.test.ts, docs/CONFIGURATION.md. This subtask edits NONE of those — zero overlap. S1 ships getIssueRetryMax() which S4 (not S2) consumes.
- file: plan/005_d32a2ecf61cd/P5M1T1S3/PRP.md
  why: P5.M1.T1.S3 (orchestrator synchronous re-research fallback) is also in-flight. It edits src/core/research-queue.ts, src/core/task-orchestrator.ts, + their tests. This subtask does NOT touch task-orchestrator.ts — zero overlap.
```

### Current Codebase tree (relevant slice)

```bash
src/agents/
├── prp-executor.ts       # <-- EDIT: extend ExecutionResult interface + branch the 3 return sites in execute()
├── prp-runtime.ts        # <-- EDIT (minimal): add outcome:'fail' to the catch-constructed result (pass-through otherwise)
├── prp-generator.ts      # <-- DO NOT TOUCH (S3 territory: issue_feedback injection)
├── prompts.ts            # <-- DO NOT TOUCH (S3 territory: blueprint prompt)
└── agent-factory.ts      # <-- DO NOT TOUCH

src/core/
├── task-orchestrator.ts  # <-- DO NOT TOUCH (S4 territory: issue→Planned branch at L767; different retry dimension)
└── task-retry-manager.ts # <-- DO NOT TOUCH (transient-infra retry dimension; implementation_notes.md §3)

src/config/
└── constants.ts          # <-- DO NOT TOUCH (S1 territory, parallel: ISSUE_RETRY_MAX)

tests/unit/agents/
├── prp-executor.test.ts  # <-- EDIT: extend error/success tests + ADD issue test (TDD failing-first)
└── prp-runtime.test.ts   # <-- EDIT: ADD issue pass-through test (+ S4-boundary assertion)
```

### Desired Codebase tree with files to be added/modified

```bash
src/agents/
├── prp-executor.ts       # MODIFIED: + outcome?, + issueMessage? on ExecutionResult; split collapse branch; outcome on final+catch returns; JSDoc
└── prp-runtime.ts        # MODIFIED: + outcome:'fail' on catch-constructed result (pass-through unchanged)

tests/unit/agents/
├── prp-executor.test.ts  # MODIFIED: extend error/success assertions; ADD issue-outcome test
└── prp-runtime.test.ts   # MODIFIED: ADD issue pass-through test
```

> **File-placement decision**: All edits land in the existing files — no new modules. `ExecutionResult` stays in `prp-executor.ts` (its established home; every consumer imports it from there). No new types file.

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: Do NOT touch the internal ExecuteResult parser (interface at ~L147 + #parseCoderResult).
//   It ALREADY produces result:'issue'. The ONLY bug is the collapse at ~L309. Fix the branch, not the parser.

// CRITICAL: outcome + issueMessage MUST be declared OPTIONAL (`?`). Rationale: every existing
//   construction site — mock factories (createMockExecutionResult in both unit + integration
//   tests), structural test objects, the orchestrator's reads — must keep type-checking without
//   setting them. The INVARIANT is: every return inside execute() sets outcome explicitly; the
//   optionality is a TYPE-level backward-compat affordance only.

// CRITICAL: success === (outcome === 'success'). Keep success: boolean. Do NOT remove it — the
//   orchestrator (task-orchestrator.ts L740,767), PRPRuntime, and all integration tests read it.

// CRITICAL: PRPRuntime is PASS-THROUGH with NO behavior change. It returns the executor result
//   unchanged and STILL sets status 'Failed' on success===false (incl. issue). The
//   issue→'Planned' reset + re-research is the ORCHESTRATOR (S4). Adding issue-handling logic
//   to PRPRuntime here is out of scope and will collide with S4.

// GOTCHA: The collapse site short-circuits BEFORE validation gates run. So an 'issue' result has
//   validationResults: [] and fixAttempts: 0 (same shape as the current 'error' path). The NEW
//   issue test should assert validationResults is empty (issue must NOT run gates).

// CRITICAL: TS ESM source uses `.js` import specifiers in `.ts` files.
//   WRONG: import { ExecutionResult } from './prp-executor';
//   RIGHT: import type { ExecutionResult } from './prp-executor.js';
//   (vitest + tsc resolve the .js→.ts mapping via tsconfig "moduleResolution".)

// GOTCHA: eslint requires JSDoc (`@remarks`) on exported interfaces/functions in this repo.
//   The existing ExecutionResult block already uses @remarks — mirror it. Add a @example showing
//   the tri-state.

// GOTCHA: There are THREE return sites in execute() that construct ExecutionResult:
//   (1) the collapse branch ~L309, (2) the final return ~L392, (3) the catch ~L416.
//   ALL THREE must set `outcome`. Missing one leaves outcome undefined on that path.
```

## Implementation Blueprint

### Data models and structure

No new data models — this subtask **extends one existing interface additively** and **branches one existing site**. Type safety comes from the literal-union `outcome` type and the `success === (outcome === 'success')` invariant.

```typescript
// The EXTENDED public interface (additive — keep success: boolean):
export interface ExecutionResult {
  /** Whether all validation gates passed. Invariant: success === (outcome === 'success'). */
  readonly success: boolean;
  /**
   * Explicit tri-state outcome (PRD §4.5).
   *
   * - 'success' — implementation passed all validation gates.
   * - 'fail' — hard implementation failure (validation exhausted, coder 'error', or exception).
   *   Handled by the existing fix-and-retry / Failed path.
   * - 'issue' — a RECOVERABLE PLANNING GAP: the PRP was insufficient (missing context, wrong
   *   assumptions, ambiguous requirements) but the work itself is valid. Distinct from 'fail'.
   *   Drives the issue-driven re-planning loop (delete stale PRP → reset to Planned →
   *   re-research with feedback), bounded by ISSUE_RETRY_MAX.
   *
   * Optional for backward compatibility with existing construction sites; every return from
   * PRPExecutor.execute() sets it explicitly.
   */
  readonly outcome?: 'success' | 'fail' | 'issue';
  /** Present only when outcome === 'issue': the Coder Agent's explanation of the planning gap. */
  readonly issueMessage?: string;
  readonly validationResults: ValidationGateResult[];
  readonly artifacts: string[];
  readonly error?: string;
  readonly fixAttempts: number;
}
```

### Implementation Tasks (ordered by dependencies — strict TDD)

```yaml
Task 1: WRITE/EXTEND failing tests in tests/unit/agents/prp-executor.test.ts  (RED — do before Task 3)
  - ADD a NEW test in the `describe('execute', ...)` block, cloned from the existing "should return
      failed result when Coder Agent reports error" test (~L280):
      it('should surface an issue outcome distinctly from fail when Coder Agent reports issue', async () => {
        const prp = createMockPRPDocument('P1.M2.T2.S2');
        const prpPath = '/tmp/test-session/prps/P1M2T2S2.md';
        mockAgent.prompt.mockResolvedValue(
          JSON.stringify({ result: 'issue', message: 'PRP missing API spec; cannot implement' })
        );
        const executor = new PRPExecutor(sessionPath);
        const result = await executor.execute(prp, prpPath);
        expect(result.success).toBe(false);
        expect(result.outcome).toBe('issue');
        expect(result.issueMessage).toBe('PRP missing API spec; cannot implement');
        expect(result.error).toBe('PRP missing API spec; cannot implement');
        expect(result.fixAttempts).toBe(0);
        expect(result.validationResults).toEqual([]);   // issue short-circuits before validation
        expect(mockExecuteBash).not.toHaveBeenCalled(); // no gates run on issue
      });
  - EXTEND the existing error test (~L280 "should return failed result when Coder Agent reports error"):
      after `expect(result.success).toBe(false);` ADD:
        expect(result.outcome).toBe('fail');
        expect(result.issueMessage).toBeUndefined();
  - EXTEND the existing success test (~L196 "should successfully execute PRP with all validation gates passing"):
      after `expect(result.success).toBe(true);` ADD:
        expect(result.outcome).toBe('success');
        expect(result.issueMessage).toBeUndefined();
  - (Optional) EXTEND the "exhaust fix attempts" test (~L345) with `expect(result.outcome).toBe('fail');`
  - FOLLOW pattern: the existing error/success tests (mock setup via mockAgent.prompt.mockResolvedValue(JSON.stringify({...})); SETUP/EXECUTE/VERIFY rhythm).
  - NAMING: test title "should surface an issue outcome distinctly from fail when Coder Agent reports issue".
  - MOCKING: NO real I/O — mockAgent.prompt + mockExecuteBash already wired in beforeEach. No network.
  - VERIFY IT FAILS FIRST: run `npm run test:run -- prp-executor` BEFORE Task 3 — the new issue test must fail (outcome/issueMessage not set yet). This is the RED step.
  - PLACEMENT: tests/unit/agents/prp-executor.test.ts (inside the existing `describe('execute')` block).

Task 2: WRITE/EXTEND failing test in tests/unit/agents/prp-runtime.test.ts  (RED — do before Task 4)
  - ADD a NEW test in `describe('executeSubtask', ...)`:
      it('should pass through the issue outcome from the executor (no behavior change)', async () => {
        const subtask = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
        const backlog = createMockBacklog();
        const issueResult: ExecutionResult = {
          success: false,
          outcome: 'issue',
          issueMessage: 'missing context for endpoint contract',
          validationResults: [],
          artifacts: [],
          error: 'missing context for endpoint contract',
          fixAttempts: 0,
        };
        mockGenerator.generate.mockResolvedValue(createMockPRPDocument(subtask.id));
        mockExecutor.execute.mockResolvedValue(issueResult);
        const runtime = new PRPRuntime(mockOrchestrator);
        const result = await runtime.executeSubtask(subtask, backlog);
        // VERIFY: outcome is passed through unchanged
        expect(result.outcome).toBe('issue');
        expect(result.issueMessage).toBe('missing context for endpoint contract');
        // VERIFY: S4 BOUNDARY — runtime STILL sets Failed (issue→Planned reset is the orchestrator's job, not S2)
        expect(mockOrchestrator.setStatus).toHaveBeenCalledWith(subtask.id, 'Failed', expect.any(String));
      });
  - IMPORT: ensure `import type { ExecutionResult } from '../../../src/agents/prp-executor.js';` is present (it already is, ~L25).
  - FOLLOW pattern: the existing "should set status to Failed when execution result is not successful" test (~L399) — same mock wiring.
  - VERIFY IT FAILS FIRST: `npm run test:run -- prp-runtime` before Task 4 — passes already if executor mock supplies outcome (runtime is pass-through), so RED is primarily proven by Task 1. Still add it to lock the pass-through contract.
  - PLACEMENT: tests/unit/agents/prp-runtime.test.ts.

Task 3: MODIFY src/agents/prp-executor.ts  (type + branch — makes Task 1 GREEN)
  - STEP 3a: EXTEND the `ExecutionResult` interface (~L67-79) with the two optional fields + Mode-A JSDoc
      (see "Data models and structure" above for the exact block). Keep `success: boolean`.
  - STEP 3b: SPLIT the collapse branch (~L309). REPLACE:
        // If Coder Agent reported error, return failed result
        if (coderResult.result !== 'success') {
          return {
            success: false,
            validationResults: [],
            artifacts: [],
            error: coderResult.message,
            fixAttempts: 0,
          };
        }
      WITH:
        // Branch on the Coder Agent's tri-state result (PRD §4.5). 'issue' = recoverable
        // planning gap (surfaces distinctly for re-planning); 'error' = hard implementation fail.
        if (coderResult.result === 'issue') {
          return {
            success: false,
            outcome: 'issue',
            issueMessage: coderResult.message,
            validationResults: [],
            artifacts: [],
            error: coderResult.message,
            fixAttempts: 0,
          };
        }
        if (coderResult.result === 'error') {
          return {
            success: false,
            outcome: 'fail',
            validationResults: [],
            artifacts: [],
            error: coderResult.message,
            fixAttempts: 0,
          };
        }
  - STEP 3c: ADD `outcome` to the FINAL validation return (~L392). REPLACE:
        return {
          success: allPassed,
          validationResults,
          artifacts: [], // TODO: Extract artifacts from Coder Agent output
          error: allPassed ? undefined : 'Validation failed after all fix attempts',
          fixAttempts,
        };
      WITH (add `outcome: allPassed ? 'success' : 'fail',` as the first property):
        return {
          success: allPassed,
          outcome: allPassed ? 'success' : 'fail',
          validationResults,
          artifacts: [], // TODO: Extract artifacts from Coder Agent output
          error: allPassed ? undefined : 'Validation failed after all fix attempts',
          fixAttempts,
        };
  - STEP 3d: ADD `outcome: 'fail',` to the CATCH return (~L416). REPLACE:
        return {
          success: false,
          validationResults: [],
          artifacts: [],
          error: error instanceof Error ? error.message : String(error),
          fixAttempts,
        };
      WITH (add `outcome: 'fail',`):
        return {
          success: false,
          outcome: 'fail',
          validationResults: [],
          artifacts: [],
          error: error instanceof Error ? error.message : String(error),
          fixAttempts,
        };
  - FOLLOW pattern: the existing return-object shapes in execute() (same field set, same ordering style).
  - GOTCHA: Do NOT modify the internal `ExecuteResult` interface (~L147) or `#parseCoderResult()`.
  - GOTCHA: Do NOT touch task-orchestrator.ts (S4 territory) or constants.ts (S1 territory).
  - PLACEMENT: src/agents/prp-executor.ts.

Task 4: MODIFY src/agents/prp-runtime.ts  (minimal — pass-through completeness)
  - ADD `outcome: 'fail',` to the catch-constructed result in `executeSubtask()` (~L245). REPLACE:
        return {
          success: false,
          validationResults: [],
          artifacts: [],
          error: errorMessage,
          fixAttempts: 0,
        };
      WITH (add `outcome: 'fail',`):
        return {
          success: false,
          outcome: 'fail',
          validationResults: [],
          artifacts: [],
          error: errorMessage,
          fixAttempts: 0,
        };
  - NOTE: The NORMAL path (return `result;` ~L218) needs NO change — it already surfaces whatever
      outcome/issueMessage the executor returned.
  - GOTCHA: Do NOT add an issue branch or change the Complete/Failed status logic here — that is S4.
  - PLACEMENT: src/agents/prp-runtime.ts.

Task 5: VERIFY (validation gates — run after Tasks 3 + 4)
  - RUN: `npm run validate` (eslint . --ext .ts + prettier --check + tsc --noEmit) — expect zero errors.
      If prettier reformats the new JSDoc/returns, run `npm run format` (writes) then re-run `npm run validate`.
  - RUN: `npm run test:run` (vitest run) — expect all green incl. the new issue test + the extended assertions.
  - GREP-VERIFY scope: `git diff --stat` must show ONLY the 4 files (prp-executor.ts, prp-runtime.ts,
      + their 2 unit tests). `git diff src/core/task-orchestrator.ts src/agents/prp-generator.ts
      src/agents/prompts.ts src/config/constants.ts` must be EMPTY.
  - GREP-VERIFY parser untouched: `git diff` on the `interface ExecuteResult` + `#parseCoderResult`
      region of prp-executor.ts must be EMPTY.
```

### Implementation Patterns & Key Details

```typescript
// === PATTERN: branching the collapse site (the core of this subtask) ===
// BEFORE: one branch collapses both 'error' and 'issue' into success:false.
// AFTER:  branch so 'issue' surfaces a DISTINCT outcome + issueMessage.
//
//   if (coderResult.result === 'issue') {
//     return { success: false, outcome: 'issue', issueMessage: coderResult.message,
//              validationResults: [], artifacts: [], error: coderResult.message, fixAttempts: 0 };
//   }
//   if (coderResult.result === 'error') {
//     return { success: false, outcome: 'fail',
//              validationResults: [], artifacts: [], error: coderResult.message, fixAttempts: 0 };
//   }
//   // coderResult.result === 'success' → fall through to validation gates.

// === PATTERN: outcome on the final validation return (allPassed already computed) ===
//   return { success: allPassed, outcome: allPassed ? 'success' : 'fail', ... };

// === PATTERN: backward-compat invariant (every consumer keeps working) ===
//   success === (outcome === 'success')
//   → orchestrator's `if (result.success) { Complete } else { Failed }` is UNCHANGED.
//   → S4 will ADD an `else if (result.outcome === 'issue') { reset→Planned; re-research }` branch.
```

```typescript
// === PATTERN: the issue unit test (clone of the error test) ===
mockAgent.prompt.mockResolvedValue(
  JSON.stringify({ result: 'issue', message: 'PRP missing API spec; cannot implement' })
);
const executor = new PRPExecutor(sessionPath);
const result = await executor.execute(prp, prpPath);
expect(result.success).toBe(false);
expect(result.outcome).toBe('issue');                       // DISTINCT from 'fail'
expect(result.issueMessage).toBe('PRP missing API spec; cannot implement');
expect(result.error).toBe('PRP missing API spec; cannot implement');
expect(result.validationResults).toEqual([]);               // issue short-circuits validation
expect(mockExecuteBash).not.toHaveBeenCalled();             // no gates run
```

### Integration Points

```yaml
TYPES (the change):
  - extend: src/agents/prp-executor.ts → ExecutionResult (+ outcome?, + issueMessage?)
  - invariant: "success === (outcome === 'success')"; success: boolean retained.

EXECUTOR LOGIC:
  - branch: src/agents/prp-executor.ts execute() collapse site (~L309) → issue vs error split
  - add outcome: final return (~L392) + catch return (~L416)

RUNTIME (pass-through):
  - src/agents/prp-runtime.ts executeSubtask() catch (~L245) → + outcome:'fail'
  - normal path UNCHANGED (already returns executor result as-is).

NOT TOUCHED (scope guardrails):
  - src/agents/prp-executor.ts internal `interface ExecuteResult` (~L147) + #parseCoderResult()  # already tri-state
  - src/core/task-orchestrator.ts                                                                  # S4: issue→Planned branch at L767
  - src/core/task-retry-manager.ts                                                                 # different retry dimension (§3)
  - src/agents/prp-generator.ts, src/agents/prompts.ts                                             # S3: issue_feedback injection
  - src/config/constants.ts                                                                        # S1: ISSUE_RETRY_MAX (parallel)
  - docs/WORKFLOWS.md                                                                              # S4: issue subsection

FUTURE CONSUMERS (informational — do NOT implement here):
  - P5.M1.T2.S3: injects issue_feedback into the blueprint prompt + PRPGenerator.
  - P5.M1.T2.S4: orchestrator reads `result.outcome === 'issue'` + `result.issueMessage` at L767,
                 adds the reset→Planned + re-research flow bounded by getIssueRetryMax() (S1).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After Task 3 (edit prp-executor.ts) + Task 4 (edit prp-runtime.ts):
npm run validate
# = eslint . --ext .ts && prettier --check "**/*.{ts,js,json,md,yml,yaml}" && tsc --noEmit
# Expected: zero errors. If prettier --check fails on the new JSDoc/returns, run:
npm run format        # WRITES the prettier-compliant form
npm run validate      # re-check; expect zero errors.
# Common failure: missing @returns/@remarks on a new export — none added here (interface only),
# but the extended JSDoc on ExecutionResult should keep the @remarks block eslint expects.
```

### Level 2: Unit Tests (Component Validation)

```bash
# RED step (after Task 1, before Task 3) — MUST fail first (TDD):
npm run test:run -- prp-executor
# Expected: the NEW issue test fails (outcome/issueMessage undefined) — confirms it exercises new code.

# GREEN step (after Task 3 + Task 4):
npm run test:run -- prp-executor
npm run test:run -- prp-runtime
# Expected: all green, incl. the new issue test + the extended outcome assertions.

# Full suite (confirm no backward-compat regression in consumers/integration tests):
npm run test:run
# Expected: all green. If coder-agent.test.ts / prp-executor-integration.test.ts /
# prp-runtime-integration.test.ts fail, a return site is missing `outcome` or `success` changed shape
# (success must stay boolean with identical semantics).
```

### Level 3: Integration Testing (System Validation)

```bash
# Confirm backward compatibility: existing integration tests that read result.success still pass.
npm run test:run -- prp-executor-integration
npm run test:run -- prp-runtime-integration
npm run test:run -- coder-agent
# Expected: all green (they assert result.success only; outcome is optional/additive).

# Smoke-check the tri-state end-to-end via the unit harness (no network — mocks only):
# (Covered by the Task 1 issue test — the executor returns outcome:'issue' for a mocked coder response.)

# Scope-guard regression check — confirm we did NOT over-reach:
git diff --stat
# Expected: ONLY src/agents/prp-executor.ts, src/agents/prp-runtime.ts,
#           tests/unit/agents/prp-executor.test.ts, tests/unit/agents/prp-runtime.test.ts.

git diff src/core/task-orchestrator.ts src/agents/prp-generator.ts src/agents/prompts.ts src/config/constants.ts
# Expected: EMPTY (all untouched — S1/S3/S4 territory).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Parser-untouched check — confirm the internal ExecuteResult + #parseCoderResult are unchanged:
git diff src/agents/prp-executor.ts | grep -E "^\+|^-" | grep -iE "ExecuteResult|parseCoderResult"
# Expected: NO lines matching (the parser region is untouched). Only ExecutionResult (public) + the
# collapse branch + the two returns should show diffs.

# Tri-state exhaustiveness check — every execute() return sets outcome:
grep -n "return {" src/agents/prp-executor.ts
# For each return inside execute() (NOT inside #runValidationGates/#fixAndRetry helpers), confirm
# an `outcome:` line follows. Three returns in execute(): collapse-split (2: issue+fail), final (1), catch (1).

# Invariant check — success/outcome agreement:
npm run test:run -- prp-executor 2>&1 | grep -c "outcome"
# Expected: ≥4 (success→'success', error→'fail', issue→'issue', exhaustion→'fail' assertions).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` passes (eslint + prettier --check + tsc --noEmit, zero errors).
- [ ] `npm run test:run` passes (all green; new issue test + extended assertions included).
- [ ] RED step observed before GREEN (the issue test failed before Task 3 — TDD).

### Feature Validation

- [ ] `ExecutionResult` has optional `outcome?: 'success' | 'fail' | 'issue'` + `issueMessage?: string` with Mode-A JSDoc (tri-state explained; `issue` cross-refs PRD §4.5 as a recoverable planning gap).
- [ ] Coder `'issue'` → `result.outcome === 'issue' && result.issueMessage` set, `success === false`, no validation gates run.
- [ ] Coder `'error'` → `result.outcome === 'fail'`, `issueMessage` undefined, `success === false`.
- [ ] Full success → `result.outcome === 'success'`, `success === true`.
- [ ] Validation exhaustion → `result.outcome === 'fail'`.
- [ ] Exception → `result.outcome === 'fail'`.
- [ ] `PRPRuntime` passes `outcome`/`issueMessage` through; its `catch` returns `outcome: 'fail'`; status STILL `'Failed'` for `success===false` (S4 boundary).
- [ ] All pre-existing `result.success` reads behave identically (backward compatible — full `npm run test:run` green).

### Code Quality Validation

- [ ] `success: boolean` retained; invariant `success === (outcome === 'success')` holds on every return.
- [ ] Internal `ExecuteResult` interface + `#parseCoderResult()` unchanged (parser-untouched check passes).
- [ ] `outcome`/`issueMessage` are optional (`?`) — every existing construction site type-checks.
- [ ] File placement matches the desired tree (only the 4 files touched).
- [ ] ESM import specifiers use `.js` extensions in test files.
- [ ] JSDoc on `ExecutionResult` follows the file's existing `@remarks`/`@example` style.

### Documentation & Deployment

- [ ] Mode-A JSDoc on `ExecutionResult` explains the tri-state and that `issue` = recoverable planning gap (PRD §4.5).
- [ ] NO `docs/WORKFLOWS.md` edit in this subtask (the issue subsection is S4 — needs the full flow).

---

## Anti-Patterns to Avoid

- ❌ Don't modify the internal `ExecuteResult` parser (`#parseCoderResult`) — it already produces `result:'issue'`. Fix the collapse branch, not the parser (implementation_notes.md §2).
- ❌ Don't remove or rename `success: boolean` — it is the backward-compat anchor; the orchestrator, runtime, and every integration test read it.
- ❌ Don't make `outcome` required — it MUST be optional (`?`) so existing construction sites (mock factories, structural test objects) keep type-checking. The implementation sets it on every return; the optionality is type-level only.
- ❌ Don't add an issue-handling branch to `PRPRuntime` or the orchestrator here — the reset→`Planned` + re-research is **S4**. S2 only makes the signal *available*. PRPRuntime is pass-through with no behavior change.
- ❌ Don't touch `src/core/task-orchestrator.ts` (S4), `src/agents/prp-generator.ts` / `prompts.ts` (S3), `src/config/constants.ts` (S1, parallel), or `src/core/task-retry-manager.ts` (different retry dimension, implementation_notes.md §3).
- ❌ Don't run validation gates when the coder reports `issue` — the collapse site short-circuits before STEP 4; the issue result must have `validationResults: []` and `fixAttempts: 0`.
- ❌ Don't write the implementation before the failing test (breaks implicit-TDD; implementation_notes.md §7).
- ❌ Don't defer the consuming-test updates to another subtask — §7 mandates they land in the SAME commit so the suite stays green.
- ❌ Don't use `.ts` import specifiers in test files — ESM requires `.js` (tsc/vitest resolve via moduleResolution).
- ❌ Don't add a `docs/WORKFLOWS.md` subsection here — it is explicitly S4 (needs the full issue-driven flow).
- ❌ Don't catch all exceptions broadly — the existing `catch (error)` in `execute()` already maps to `outcome:'fail'`; no new try/catch needed.

---

## Success Metrics

**Confidence Score: 9/10** — This is a tightly-scoped type-extension + branch-split with every reference resolving to a real file/line in the tree today. The contract names the exact interface, the exact three return sites (with their current code quoted verbatim), the exact replacement blocks, and the exact test extensions. The internal `ExecuteResult` parser already works (no parsing risk). Backward compatibility is structurally guaranteed by making `outcome`/`issueMessage` optional and keeping `success: boolean`. Residual risks are minor: (a) forgetting to set `outcome` on one of the three return sites (Level 4's exhaustiveness grep catches it); (b) the JSDoc/prettier interaction on the extended interface (Level 1 — run `npm run format` if needed); (c) resisting the temptation to implement the orchestrator issue-branch (the scope-guard `git diff` check + the explicit "S4 territory" notes guard against it). The parallel subtasks (S1 config, S1.T1.S3 orchestrator fallback) edit disjoint files — zero overlap. One-pass success is highly likely.
