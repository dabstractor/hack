# Resilience Features (R1–R4) — Integration Test Planning Reference

## Overview

This document maps the four resilience features implemented in Session 005 to the code, types,
and integration seams that Issue 3's integration tests must exercise.

---

## R1: Background Research Deadline & Fallback

### Config
**File**: `src/config/constants.ts`
```typescript
export const RESEARCH_TIMEOUT = 'RESEARCH_TIMEOUT';           // env var name
export const DEFAULT_RESEARCH_TIMEOUT_SECONDS = 300;          // default 5 min

export function getResearchTimeoutSeconds(): number {
  // Reads process.env[RESEARCH_TIMEOUT], validates, returns number or default
}
```

### Implementation
**File**: `src/core/research-queue.ts`

- **`ResearchTimeoutError`** (line 70): Custom error thrown when `waitForPRP` deadline fires.
  Constructor: `new ResearchTimeoutError(taskId: string, timeoutSeconds: number)`.
  Properties: `taskId`, `timeoutSeconds`, `name = 'ResearchTimeoutError'`.

- **`DEADLINE_SENTINEL`** (line 43): Private `Symbol` used in `Promise.race` to distinguish
  the timeout path from a real `PRPDocument` result.

- **`waitForPRP(taskId: string): Promise<PRPDocument>`** (line 427):
  - Checks cache first → returns immediately.
  - If in-flight → races the in-flight promise against a `setTimeout(deadlineMs)` deadline.
  - If deadline wins → `this.abandoned.add(taskId)` + throws `ResearchTimeoutError`.
  - If not found → throws generic Error.

- **`researchNow(task, backlog, issueFeedback?)`** (line 340): Synchronous re-research.
  Bypasses the queue; calls `this.#prpGenerator.generate(task, backlog, issueFeedback)` directly.
  Used as fallback after deadline timeout AND for issue-driven re-planning.

- **`abandoned`** (line 142): `Set<string>` of task IDs whose research exceeded the deadline.
  Late results from abandoned tasks are silently ignored (dedup).

### Orchestrator Wiring
**File**: `src/core/task-orchestrator.ts` line ~728:
```typescript
// When waitForPRP times out:
await this.researchQueue.researchNow(subtask, this.#backlog);
```

### Integration Test Design
**File**: `tests/integration/core/research-deadline-fallback.test.ts`

The test should:
1. Set `RESEARCH_TIMEOUT` to a tiny value (e.g. `1` second) via `process.env`.
2. Mock `PRPGenerator.generate` to delay beyond the timeout.
3. Create a real `ResearchQueue` (not mocked) with a real `SessionManager` in tmpdir.
4. Enqueue a task, call `waitForPRP`, assert `ResearchTimeoutError` is thrown.
5. Assert the orchestrator falls back to `researchNow` and completes.
6. Assert the late result is ignored (dedup).

**Mocking**: Mock `prp-generator.js` (to control timing). Use real `ResearchQueue`,
real `SessionManager`, real filesystem (tmpdir).

---

## R2: Issue-Driven Re-planning Loop

### Config
**File**: `src/config/constants.ts`
```typescript
export const ISSUE_RETRY_MAX = 'ISSUE_RETRY_MAX';             // env var name
export const DEFAULT_ISSUE_RETRY_MAX = 3;                     // default

export function getIssueRetryMax(): number {
  // Reads process.env[ISSUE_RETRY_MAX], validates, returns number or default
}
```

### Types
**File**: `src/agents/prp-executor.ts` line 90:
```typescript
export interface ExecutionResult {
  readonly success: boolean;
  readonly outcome?: 'success' | 'fail' | 'issue';   // tri-state
  readonly issueMessage?: string;                      // present when outcome === 'issue'
  readonly validationResults: ValidationGateResult[];
  readonly artifacts: string[];
  readonly error?: string;
  readonly fixAttempts: number;
}
```

**File**: `src/core/task-orchestrator.ts` line 59:
```typescript
type ExecutionResultLike = {
  readonly success: boolean;
  readonly outcome?: 'success' | 'fail' | 'issue';
};
```

### Orchestrator Logic
**File**: `src/core/task-orchestrator.ts` lines ~820-860:

When `result.outcome === 'issue'`:
1. Capture feedback: `await atomicWrite(join(sessionDir, 'issue_feedback.md'), feedback)`
   (feedback = `result.issueMessage`)
2. Delete stale PRP: `await this.researchQueue.deletePRP(subtask.id)`
3. Reset status to `Planned` (so re-execution starts fresh)
4. Re-research with feedback: `await this.researchQueue.researchNow(subtask, this.#backlog, feedback)`
5. Re-execute with the new PRP

**Boundary**: After `ISSUE_RETRY_MAX` issue outcomes, the item hard-fails (status → `Failed`).
The boundary is `getIssueRetryMax()` attempts — the `(N+1)`th issue outcome causes hard-fail.

### Integration Test Design
**File**: `tests/integration/core/issue-replan-loop.test.ts`

The test should:
1. Mock `PRPRuntime.executeSubtask` to return `outcome: 'issue'` once, then `outcome: 'success'`.
2. Create a real `TaskOrchestrator` with `SessionManager` in tmpdir.
3. Execute a subtask.
4. Assert `issue_feedback.md` is written to the session directory.
5. Assert the PRP is deleted and regenerated (via `deletePRP` + `researchNow`).
6. Assert the item ends in `Complete` status.

Also test the `ISSUE_RETRY_MAX` boundary:
1. Set `ISSUE_RETRY_MAX=1` via `process.env`.
2. Mock executor to always return `outcome: 'issue'`.
3. Assert the item hard-fails to `Failed` after 1 issue attempt.

**Mocking**: Mock `prp-runtime.js` (to control outcome tri-state) and optionally
`prp-generator.js`. Use real `TaskOrchestrator`, real `SessionManager`, real filesystem.

---

## R4: tasks.json Protection & Smart Recovery

### Git Primitives
**File**: `src/tools/git-mcp.ts`

```typescript
async function gitFileHistory(
  filePath: string,
  repoPath?: string
): Promise<GitFileHistoryEntry[]>   // NEWEST-FIRST

async function gitReadFileAtCommit(
  filePath: string,
  commitHash: string,
  repoPath?: string
): Promise<string>
```

These are exported from the module (lines 669-670) and used by `recoverTasksJson`.

### Recovery Routine
**File**: `src/core/tasks-json-recovery.ts`

```typescript
export interface TasksJsonRecoveryResult {
  readonly restored: boolean;        // true ONLY when git-history restore occurred
  readonly source: 'disk' | 'git';   // 'disk' = clean-disk re-apply; 'git' = restored from history
  readonly reason?: string;
}

export interface RecoverTasksJsonOptions {
  readonly baselineBacklog?: Backlog;  // orchestrator's trusted in-memory copy
  readonly repoPath?: string;          // git repo path (defaults to cwd)
}

export async function recoverTasksJson(
  sessionPath: string,
  legitimateDelta: { itemId: string; status: Status },
  opts?: RecoverTasksJsonOptions
): Promise<TasksJsonRecoveryResult>
```

### Three Paths (PATH A/B/C)

- **PATH A (Clean disk)**: On-disk `tasks.json` parses and validates. Reconstructs from
  `opts.baselineBacklog` (preferred) or disk backlog, applies ONLY `legitimateDelta`, writes.
  Returns `{ restored: false, source: 'disk' }`.

- **PATH B (Corrupt disk → git restore)**: On-disk file fails parse/validate. Walks git history
  via `gitFileHistory` → `gitReadFileAtCommit`, restores the LAST VALID committed version,
  re-applies `legitimateDelta`, preserves items in `Researching` or `Retrying` status (carried
  forward from restored version). Returns `{ restored: true, source: 'git' }`.

- **PATH C (Non-fatal)**: If git restore also fails, logs a warning but does NOT throw.
  Returns a result indicating failure (never throws).

### Orchestrator Wiring
**File**: `src/core/task-orchestrator.ts` line ~977:
```typescript
// After each agent run, before flushing updates:
const recovery = await recoverTasksJson(
  sessionPath,
  { itemId: subtask.id, status: intendedStatus },
  { baselineBacklog: this.backlog, repoPath: sessionPath }
);
```

Called inside the method that processes `ExecutionResult` and sets the final status, before
`this.sessionManager.flushUpdates()`.

### Integration Test Design
**File**: `tests/integration/core/tasks-json-recovery-e2e.test.ts`

The test should:
1. Create a real git repo in tmpdir (via `simple-git` or `git init`).
2. Create a real `SessionManager` + `TaskOrchestrator` in the tmpdir session.
3. Write a valid `tasks.json` and commit it.
4. Start a subtask execution (mock the coder/PRPRuntime).
5. Mid-run, corrupt `tasks.json` on disk (write invalid JSON).
6. Assert `recoverTasksJson` restores from git history.
7. Assert items in `Researching` status are preserved.
8. Assert the run continues to completion.

**Mocking**: Mock `prp-runtime.js` (to control execution). Use REAL git operations
(`git init`, `git add`, `git commit`) in tmpdir. Use real `recoverTasksJson`, real
`SessionManager`, real `TaskOrchestrator`.

The existing `tests/unit/core/tasks-json-recovery.test.ts` already uses real tmpdir git repos —
reference it for the git setup pattern.

---

## Existing Integration Test Patterns (Templates)

### `tests/integration/core/task-orchestrator-e2e.test.ts`
- Uses `mkdtempSync` for tmpdir, cleaned in `afterEach` via `rmSync`.
- Imports `SessionManager`, `TaskOrchestrator` from src.
- Mocks `PRPRuntime` via `vi.mock('../../../src/agents/prp-runtime.js', ...)` with
  `mockImplementation(() => ({ executeSubtask: vi.fn().mockResolvedValue({...}) }))`.
- Mocks `git-commit.ts` via `vi.mock('../../../src/utils/git-commit.js', ...)`.
- Uses `mockSimplePRD` from `../../fixtures/simple-prd.js` for backlog fixtures.
- Creates a real `SessionManager`, initializes a session, creates orchestrator.

### `tests/integration/core/research-queue.test.ts`
- Uses `vi.hoisted()` for mock setup (REQUIRED for vitest integration tests).
- Mocks `logger.js` and `prp-generator.js`.
- Tests the real `ResearchQueue` queue logic with controlled timing.
- Factory functions for creating `Backlog`, `Subtask`, `PRPDocument` test fixtures.

### Mock Pattern Summary
```typescript
// Hoisted mocks (for modules imported at construction time)
const { mockExecuteSubtask } = vi.hoisted(() => ({
  mockExecuteSubtask: vi.fn(),
}));

vi.mock('../../../src/agents/prp-runtime.js', () => ({
  PRPRuntime: vi.fn().mockImplementation(() => ({
    executeSubtask: mockExecuteSubtask,
  })),
}));

// Real components
const sessionManager = new SessionManager(tmpDir);
// ... initialize session, create orchestrator with real SessionManager
```

---

## Status Model
**File**: `src/core/models.ts`

```typescript
type Status = 'Planned' | 'Researching' | 'Implementing' | 'Retrying' | 'Complete' | 'Failed';
```

- `Planned`: Initial state after Architect Agent generates the backlog
- `Researching`: Research Agent is gathering context for PRP generation
- `Implementing`: Coder Agent is actively implementing the PRP
- `Retrying`: (TaskRetryManager) transient error retry
- `Complete`: All validation gates passed
- `Failed`: Implementation failed

## smartCommit
**File**: `src/utils/git-commit.ts` line 127:
```typescript
export async function smartCommit(
  sessionPath: string,
  message: string
): Promise<string | null>   // returns commit hash or null
```
Used by the orchestrator after task completion to checkpoint progress.
