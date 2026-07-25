# Test Suite & Validation Issues — Issues 3 & 5

## Issue 3: Test Suite Red + ContextScopeSchema Over-Strict (MAJOR)

### 3A: Test Fixture Rot

The PRD reports `297 failed | 6306 passed | 70 skipped` across `38 failed | 153 passed` files. Categories:

#### Mock Drift: ResearchTimeoutError Re-export
The `task-orchestrator.test.ts` (line ~98) correctly uses `importOriginal` to preserve the real `ResearchTimeoutError` class when mocking `research-queue.js`:
```ts
vi.mock('../../../src/core/research-queue.js', async importOriginal => {
  const actual = await importOriginal<...>();
  return { ...actual, ResearchQueue: vi.fn()... };
});
```
Other tests that mock `research-queue.js` WITHOUT `importOriginal` lose the real `ResearchTimeoutError`, causing `instanceof` checks to fail. Files to check:
- `tests/unit/core/task-traversal.test.ts` — mocks research-queue, no `importOriginal` (but may not use ResearchTimeoutError)
- `tests/unit/core/task-dependencies.test.ts` — same

#### Mock Drift: PRP-Generator File-Contract Path
`src/agents/prp-generator.ts` now uses the **file-is-the-contract** pattern (line ~735):
```ts
prpJsonText = await readFile(prpOutputPath, 'utf-8');  // reads file, NOT response body
```
But `tests/unit/agents/prp-generator.test.ts` mocks:
```ts
mockAgent.prompt.mockResolvedValue(mockPRP);  // mockPRP is a PRPDocument, not { status, output }
```
And `vi.mock('node:fs/promises')` provides a `readFile` that returns `undefined` by default. The test's `mockReadFile` is not set up to return the PRP JSON at `prpOutputPath`. So the file-contract path fails with "Researcher did not write PRP file" or similar.

**Fix**: The test must mock `readFile` to return the mock PRP JSON string at the expected `prpOutputPath`, matching the file-contract pattern. The agent response should be `{ status: 'success', output: '' }`, not the PRP object.

#### Groundswell Link
`node_modules/groundswell/package.json`:
```json
{ "name": "groundswell", "version": "1.0.1", "url": "...", "description": "..." }
```
It lacks `main` and `exports` fields → `require('groundswell')` throws "No exports main defined". Integration tests that import groundswell without a `vi.mock('groundswell')` fail. Unit tests mostly mock it.

**SCOUT FINDING (corrected):** `node_modules/groundswell/package.json` DOES have `main` and `exports` fields:
```json
"main": "./dist/index.js",
"exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } }
```
So `import ... from 'groundswell'` resolves to a real built module. The issue is NOT a missing main/exports but that **`tests/integration/groundswell/workflow.test.ts` imports real runtime values** (`Workflow`, `Step`, `Task`, `ObservedState`, `getObservedState`) from `groundswell` **without a `vi.mock('groundswell')`**. This loads the real package + heavy transitive deps (`@anthropic-ai/claude-agent-sdk`, `ink`, `react`, `zod`), which can fail to import or hang if the environment isn't set up. It only mocks `@anthropic-ai/sdk`, not groundswell itself.

Other integration tests that import from groundswell:
- `tests/integration/agents.test.ts:34` — has `vi.mock('groundswell')` ✅
- `tests/integration/qa-agent.test.ts:144` — has `vi.mock('groundswell')` ✅
- `tests/integration/groundswell/mcp.test.ts:25` — `import type` only (erased at runtime) ✅
- `tests/integration/mcp-tools.test.ts:88` — `import type` only ✅

**Fix**: Add `vi.mock('groundswell')` to `tests/integration/groundswell/workflow.test.ts` (following the pattern in `agents.test.ts:24` or `cache-verification.test.ts:15`).

#### executeBacklog Test Alignment
`tests/unit/workflows/prp-pipeline-progress.test.ts` line ~305 asserts:
```
'Cannot execute pipeline: no backlog found in session'
```
This test expects `executeBacklog()` to REJECT (throw). But the current code SWALLOWS the error (Issue 5). These tests are failing because the behavior doesn't match the assertion. Fixing Issue 5 (making it fatal) will make these tests pass.

### 3B: ContextScopeSchema Over-Strict on READ

**Location**: `src/core/models.ts` line ~106

```ts
export const ContextScopeSchema: z.ZodType<string> = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    const prefix = 'CONTRACT DEFINITION:\n';
    if (!value.startsWith(prefix)) { /* reject */ }
    // + validate 4 numbered sections
  });
```

**Used in**: `SubtaskSchema` → `TaskSchema` → `MilestoneSchema` → `PhaseSchema` → `BacklogSchema`

**Read path**: `readTasksJSON()` → `BacklogSchema.parse()` → enforces ContextScopeSchema on EVERY subtask.

**Problem**: Any `tasks.json` with a subtask whose `context_scope` doesn't start with `CONTRACT DEFINITION:\n` + have all 4 numbered sections FAILS to load. This breaks:
- Integration test fixtures with plain scope strings
- Hand-edited / legacy / externally-authored sessions
- Recovery scenarios (PRD §5.1 mandates survival of corruption)

**Fix Strategy**: Split into two schemas:
1. **`ContextScopeWriteSchema`** (strict): The current `ContextScopeSchema` — enforced when the ARCHITECT writes tasks.json (write-time validation). Ensures the pipeline always produces the contract format.
2. **`ContextScopeReadSchema`** (lenient): `z.string().min(1)` — used by `readTasksJSON`/`loadSession` on READ. Allows any non-empty string, so legacy/manual sessions load. Optionally logs a warning for non-contract scopes.

**SCALE OF THE PROBLEM (scout finding):** ~90+ plain `context_scope` string values across `tests/` violate the strict schema. Key values: `'Test scope'` (~50 occurrences), `''` empty (~11), `'Test'` (~8), `'...'` (~7), plus many singletons. Affected areas:
- `tests/unit/core/`: scope-resolver, task-utils, task-patcher, dependency-validator, session-state-serialization, task-traversal, concurrent-executor, task-dependencies, flush-retry (empty), session-state-batching (empty), research-queue, cleanup-runner, task-orchestrator (line 1347 explicitly documents the violation), session-manager, session-utils
- `tests/unit/agents/`: prp-generator (`createMockSubtask` uses `'Implement the feature'`)
- `tests/unit/workflows/`: prp-pipeline-progress (`createTestSubtask` uses `'Test scope'`)
- `tests/integration/`: architect-agent, task-orchestrator-e2e, task-orchestrator-runtime, task-orchestrator, research-queue

IMPORTANT: Not every occurrence fails at runtime — only those that flow through `SubtaskSchema.parse`/`BacklogSchema.parse`. Direct object construction without `.parse()` won't trigger validation. The failures occur wherever the constructed object is passed into code that calls `BacklogSchema.parse`. Relaxing the read schema (P2.M2.T1) fixes ALL of these at once.

**Implementation**:
- `BacklogSchema` (the strict schema) continues to be used for architect OUTPUT validation.
- A new `BacklogReadSchema` (or a `parseBacklogLenient()`) uses the lenient `context_scope` field.
- `readTasksJSON()` and `loadSession()` use the lenient path.
- The architect's output validation (after parsing) uses the strict path.

### Key File Paths for Fix

| Symbol | Location | Purpose |
|--------|----------|---------|
| `ContextScopeSchema` | `models.ts:~106` | Strict write-time schema (keep for architect output) |
| `SubtaskSchema` | `models.ts:~402` | Uses `context_scope: ContextScopeSchema` |
| `BacklogSchema` | `models.ts` | Used by `readTasksJSON` on read |
| `readTasksJSON()` | `session-utils.ts` or `session-manager.ts` | Read path to relax |
| `loadSession()` | `session-manager.ts` | Read path to relax |

---

## Issue 5: executeBacklog Swallows "no backlog found" (MINOR)

### Confirmed Control Flow

`executeBacklog()` (line ~1295):
```ts
try {
  const backlog = this.sessionManager.currentSession?.taskRegistry;
  if (!backlog) {
    throw new Error('Cannot execute pipeline: no backlog found in session');  // PLAIN Error
  }
  // ... execution loop ...
} catch (error) {
  if (isFatalError(error, this.#continueOnError)) { throw error; }
  // Non-fatal: track and continue  ← SWALLOWS
}
```

`isFatalError()` (errors.ts ~835):
```ts
if (continueOnError) { return false; }  // override
if (!isPipelineError(error)) { return false; }  // ← PLAIN Error is NOT PipelineError → FALSE
// ... only specific PipelineError subtypes are fatal ...
```

**Result**: `Error('Cannot execute pipeline: no backlog found')` is NOT a `PipelineError`, so `isFatalError()` returns `false`, the catch swallows it, and `executeBacklog()` resolves successfully. Pipeline proceeds to validation/QA with zero tasks.

### Fix Strategy

Make the throw a **fatal** `PipelineError`. Options:

**Option A (preferred)**: Use `SessionError` with `PIPELINE_SESSION_LOAD_FAILED` code:
```ts
throw new SessionError(
  'Cannot execute pipeline: no backlog found in session',
  ErrorCodes.PIPELINE_SESSION_LOAD_FAILED,
  { operation: 'executeBacklog' }
);
```
This makes `isFatalError()` return `true` (SessionError + LOAD_FAILED = fatal), so it propagates.

**Option B**: Add a new `TaskError` fatal code. But `TaskError` is classified as non-fatal by default.

**Option C**: Throw `PipelineError` directly with a custom code that `isFatalError()` recognizes.

Option A is cleanest — a missing backlog is essentially a session load failure.

### Key: Update executeBacklog tests — INTERNAL INCONSISTENCY FOUND

**CRITICAL DISCOVERY (scout investigation):** `tests/unit/workflows/prp-pipeline-progress.test.ts` is internally inconsistent:
- **Line 304-305**: `await expect(pipeline.executeBacklog()).rejects.toThrow('Cannot execute pipeline: no backlog found in session')` — expects REJECTION.
- **Line 799**: `await expect(pipeline.executeBacklog()).resolves.not.toThrow()` — expects RESOLUTION (a DIFFERENT test: "handle missing ProgressTracker gracefully").

After fixing Issue 5 (making the no-backlog throw propagate):
- Line 304-305 test will PASS (expects rejection).
- Line 799 test will FAIL (expects resolution — but now it throws).

**Resolution for the implementing agent**: The line 799 test is for a different scenario (missing ProgressTracker, NOT missing backlog). The fix should ensure the line 799 test's session HAS a backlog (non-empty) but lacks a ProgressTracker. The line 799 test currently has an empty backlog which triggers the no-backlog abort. Either: (a) give the line 799 test a valid non-empty backlog, or (b) the test setup needs to differentiate the two scenarios. The correct behavior is: no-backlog = abort (throw), no-ProgressTracker-but-has-backlog = continue (resolve).

### Note on `--continue-on-error` Interaction

When `continueOnError` is true, `isFatalError()` ALWAYS returns false (override at line ~842). This means even with a fatal SessionError, the error would be swallowed under `--continue-on-error`. This is arguably correct — continue-on-error means "keep going no matter what." But the PRD says running validation/QA over empty tasks is not useful. Consider whether the no-backlog case should override continue-on-error. The PRD says "prefer aborting."

**Recommendation**: The no-backlog check should be moved ABOVE the try/catch, or the throw should bypass `isFatalError()` entirely. Alternatively, check for empty backlog at the top of `executeBacklog()` before the try block:
```ts
async executeBacklog(): Promise<void> {
  // HARD ABORT: no backlog = misconfigured session, never useful to continue
  const backlog = this.sessionManager.currentSession?.taskRegistry;
  if (!backlog) {
    throw new SessionError('Cannot execute pipeline: no backlog found', LOAD_FAILED, ...);
  }
  // ... continue with try/catch for execution errors ...
}
```
This throws OUTSIDE the try/catch, so it propagates unconditionally regardless of `continueOnError`.