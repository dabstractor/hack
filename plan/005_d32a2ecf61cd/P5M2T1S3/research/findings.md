# Research Findings — P5.M2.T1.S3 (Wire smart-recovery into the orchestrator)

## Goal recap
Wire S2's `recoverTasksJson(tasksPath, {itemId,status}, {baselineBacklog?,repoPath?})`
into `TaskOrchestrator.executeSubtask` so that after **every** agent run the on-disk
`tasks.json` is reconciled (legitimate delta applied, unrelated mutations discarded,
corrupt file restored from git history), the session registry is reloaded from the
recovered disk, and the flow is non-fatal. PRD §5.1 / §9.3.2. Closes R4.

## Where the agent run lives (src/core/task-orchestrator.ts)
`executeSubtask` (≈ lines 540–720) structure:
```
setStatus('Researching') → cache check → canExecute? → setStatus('Implementing')
try {
  waitForPRP / researchNow fallback
  while (true) {
    result = await this.#retryManager.executeSubtask(subtask, async () =>
                       this.#prpRuntime.executeSubtask(subtask, this.#backlog))   // <-- THE AGENT RUN
    [processNext background research]
    if result.success      → setStatus('Complete'); break
    if result.outcome==='issue' → {issueAttempts++; if exhausted → setStatus('Failed');break
                                    write issue_feedback.md; deletePRP; setStatus('Planned');
                                    researchNow(feedback); continue}
    else (fail)            → setStatus('Failed'); break
  }
  smartCommit(...)
  flushUpdates()
} catch { setStatus('Failed'); flushUpdates(); rethrow }
```
**Wiring point:** immediately after `executeWithRetry` returns `result`, BEFORE the
`processNext` trigger + tri-state handling. Matches contract "immediately after the
agent run returns (before smartCommit/flushUpdates)".

## Intended-status mapping (deterministic from result + attempt counter)
- `result.success` → `'Complete'`
- `result.outcome === 'issue'` AND next-attempt ≤ `getIssueRetryMax()` → `'Planned'`
  (the orchestrator resets to Planned for re-planning)
- `result.outcome === 'issue'` AND next-attempt > `getIssueRetryMax()` → `'Failed'`
  (issue-driven re-planning exhausted)
- else (`fail`) → `'Failed'`

`nextAttempt = (this.#issueAttempts.get(itemId) ?? 0) + 1` — computed BEFORE the
issue branch increments the counter, so recovery's status matches the setStatus that
follows.

## Disk-reload mechanism (CRITICAL — refreshBacklog is in-memory only)
`SessionState.taskRegistry` is **`readonly`** (src/core/models.ts:888). The session
manager internally replaces `#currentSession` immutably
(`this.#currentSession = {...this.#currentSession, taskRegistry: updated}`); the
orchestrator only holds the getter reference.

`refreshBacklog()` does `this.#backlog = currentSession.taskRegistry` — in-memory
ONLY (implementation_notes §6). So after `recoverTasksJson` writes the reconstructed
backlog to disk we must EXPLICITLY reload into the session registry:
```ts
const recovered = await readTasksJSON(session.metadata.path);     // re-read recovered disk
(this.sessionManager.currentSession as { taskRegistry: Backlog }).taskRegistry = recovered;
await this.refreshBacklog();                                       // #backlog ← recovered
```
The cast removes `readonly` (compile-time only) — same idiom as `state-validator.ts`
and S2's `setItemStatus`. No `session-manager.ts` change required (keeps scope to
`task-orchestrator.ts`). Sanctioned by contract: "explicitly reload from the recovered
disk file … OR add a disk-reload step".

## Non-fatal invariant
`recoverTasksJson` itself NEVER throws (S2 PATH C). The reload's `readTasksJSON` CAN
throw (if recovery left disk corrupt on PATH C). So wrap the ENTIRE
`#recoverAfterAgentRun` body in try/catch → `logger.error(...)` → return. A recovery
failure must not terminate the session (PRD §5.1).

## Test strategy (tests/unit/core/task-orchestrator.test.ts)
The file is **mock-only** ("no real I/O is performed"). Module-level mocks:
- `session-utils` → `{ atomicWrite }` ONLY (must EXTEND with `readTasksJSON`).
- `prp-runtime` → `PRPRuntime` with `executeSubtask` stub.
- `git-commit`, `research-queue`, `scope-resolver`, `task-utils`, `logger`.

Therefore: MOCK `tasks-json-recovery` module (`recoverTasksJson: vi.fn()`) and assert
the WIRING (invoked once per agent run, correct `{itemId,status}` + `baselineBacklog`,
non-fatal, reload happened). The actual corruption→git-restore mechanics are already
unit-tested in S2's `tasks-json-recovery.test.ts` (real tmpdir + real git). This
keeps S3's test consistent with the file's architecture and the contract's named file.

## Import additions to task-orchestrator.ts
- `import { recoverTasksJson } from './tasks-json-recovery.js';` (NEW)
- extend existing `import { atomicWrite } from './session-utils.js';` → add `readTasksJSON`
- extend existing `models.js` type import → add `SessionState`
- `join` from `node:path` already imported

## DOCS
[Mode A] none — contract: "the ARCHITECTURE.md narrative was added in S2; the per-run
hook is an internal integration detail." Only inline comments.

## Validation
`npm run validate` (eslint + prettier --check + tsc --noEmit) + `npm run test:run`.
Must NOT break the ~120 existing orchestrator tests (status counts stay at 3 because
recovery adds NO `updateItemStatus` calls).

## Scope guardrails (NOT touched)
- `src/core/tasks-json-recovery.ts` (S2 — consumed as-is)
- `src/core/session-manager.ts` (reload via cast, no method added)
- `src/tools/git-mcp.ts` (S1), `src/config/constants.ts`, `src/agents/prp-runtime.ts`
- `docs/ARCHITECTURE.md` (S2 already added the narrative)
- `README.md`, `docs/WORKFLOWS.md` (Mode B → P5.M3)
