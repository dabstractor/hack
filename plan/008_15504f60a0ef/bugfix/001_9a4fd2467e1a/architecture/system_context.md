# System Context — Bugfix PRD Architecture Findings

## Project Overview

**Project**: `hacky-hack` — Autonomous PRP (Product Requirement Prompt) Development Pipeline.
**Stack**: TypeScript (Node ≥20), Vitest, Zod schemas, Groundswell orchestration engine.
**Entry Point**: `src/index.ts` → `PRPPipeline` (`src/workflows/prp-pipeline.ts`, 2790 lines).

## Key Source Files for This Bugfix

| File | Lines | Role |
|------|-------|------|
| `src/workflows/prp-pipeline.ts` | 2790 | Main pipeline: `handleDelta()`, `decomposePRD()`, `executeBacklog()`, `runQACycle()`, `#detectInterruptedBugfix()` |
| `src/core/task-patcher.ts` | 111 | `patchBacklog()` — transforms backlog on delta (added/modified/removed) |
| `src/core/models.ts` | 1993 | Zod schemas: `ContextScopeSchema`, `BacklogSchema`, `RequirementChangeSchema`, `DeltaAnalysisSchema` |
| `src/core/session-manager.ts` | ~1650 | `createSession()`, `createDeltaSession()`, `saveBacklog()`, session numbering (`NNN_hash`) |
| `src/core/session-utils.ts` | ~1500 | `renderDeltaPRD()`, `writeDeltaPRD()`, `loadDeltaPRD()`, `createSessionDirectory()` |
| `src/utils/errors.ts` | ~880 | `PipelineError` hierarchy, `isFatalError()` |
| `src/core/prd-differ.ts` | ~600 | `diffPRDs()` — section-level diff producing `added`/`modified`/`removed` changes with `newContent` |
| `src/core/change-classifier.ts` | — | Classifies changes as substantive vs cosmetic (upstream of delta dispatch) |

## Delta Workflow Control Flow (Issues 1 & 2)

### Entry: `handleDelta()` (line ~825)
Three dispatch paths, selected by flags:
1. `acceptPrdChangesResponse()` — `--accept-prd-changes`: refresh snapshot, no delta session.
2. `integrateIntoCurrentSessionResponse()` (line ~906) — integrate into CURRENT session (no delta dir).
3. **`spawnDeltaSession()` (line ~963) — DEFAULT**: the delta-session flow.

### DEFAULT Delta Path: `spawnDeltaSession()` (line ~963)
```
Step 1: oldPRD = currentSession.prdSnapshot
Step 2: newPRD = resolvePRD(prdPath)
Step 3: completedTaskIds = filterByStatus(backlog, 'Complete')
Step 4: delta = new DeltaAnalysisWorkflow(oldPRD, newPRD, completedTaskIds).run()
Step 5: patchedBacklog = patchBacklog(backlog, delta)    // modified→Planned, removed→Obsolete, added→⚠️DROPPED
Step 6: createDeltaSession(prdPath)                        // new NNN_hash dir, parentSession set
Step 6b: writeDeltaPRD(deltaSessionPath, renderDeltaPRD(...))  // delta_prd.md IS written
Step 7: saveBacklog(patchedBacklog)                        // ← NON-EMPTY (parent tasks patched)
```

### `decomposePRD()` (line ~1100) — THE BUG (Issue 1)
```ts
const backlog = this.sessionManager.currentSession?.taskRegistry;
const hasBacklog = backlog && backlog.backlog.length > 0;
if (hasBacklog) {
  // "Existing backlog found, skipping generation"
  this.currentPhase = 'prd_decomposed';
  return;                       // ← EARLY RETURN: always taken for delta sessions!
}
// ... isDelta branch (loadDeltaPRD) is BELOW this guard — UNREACHABLE in production
const isDelta = this.sessionManager.currentSession?.metadata.parentSession != null;
if (isDelta) { prdContent = await loadDeltaPRD(sessionPath); }
```

**ROOT CAUSE CONFIRMED**: `spawnDeltaSession()` Step 7 always saves a non-empty `patchedBacklog` to the delta session BEFORE `decomposePRD()` runs. Therefore `hasBacklog` is ALWAYS true for delta sessions, the early-return fires, and the `isDelta` branch that loads `delta_prd.md` is dead code.

**NET EFFECT**: `delta_prd.md` is written and never read. Added requirements are never decomposed. The architect agent is never invoked.

### `integrateIntoCurrentSessionResponse()` (line ~906) — Issue 2 Path
```
oldPRD = currentSession.prdSnapshot (PRESERVED — not refreshed)
newPRD = resolvePRD(prdPath)
delta = new DeltaAnalysisWorkflow(oldPRD, newPRD, completedTaskIds).run()
patchedBacklog = patchBacklog(currentSession.taskRegistry, delta)  // 'added' → ⚠️DROPPED
saveBacklog(patchedBacklog)   // applied to CURRENT session
refreshSnapshotToCurrentPRD(...)
clearPendingDeltaHash(...)
```

This path also drops 'added' requirements via the unimplemented `patchBacklog` case. The code documents this as a known GOTCHA (line ~901).

## Test Masking (Issue 1)

`tests/unit/core/delta-prd.test.ts` `makeDeltaSession()` helper (line ~97):
```ts
function makeDeltaSession(...) {
  const emptyBacklog: Backlog = { backlog: [] };  // ← EMPTY! Never occurs in production
  ...
  taskRegistry: emptyBacklog,
```

With an empty backlog, `hasBacklog` is false → the `isDelta` branch is reached → test passes.
In production, `spawnDeltaSession()` step 7 saves non-empty patched backlog → `hasBacklog` true → early return → bug.

## ContextScopeSchema (Issue 3B)

`src/core/models.ts` line ~106:
```ts
export const ContextScopeSchema: z.ZodType<string> = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    const prefix = 'CONTRACT DEFINITION:\n';
    if (!value.startsWith(prefix)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '...must start with "CONTRACT DEFINITION:"...' });
      return;
    }
    // Also validates 4 numbered sections: RESEARCH NOTE, INPUT, LOGIC, OUTPUT
  });
```

**Problem**: This schema is used in `SubtaskSchema` → `BacklogSchema`. On READ via `readTasksJSON → BacklogSchema.parse`, any `tasks.json` whose subtasks lack the exact `CONTRACT DEFINITION:\n` prefix + 4 numbered sections FAILS to load. This rejects:
- Hand-edited sessions
- Legacy sessions
- Externally-authored sessions
- Test fixtures using plain scope strings

**FIX DIRECTION**: Enforce the CONTRACT DEFINITION contract on WRITE (architect output validation) but only WARN on READ (so legacy/manual sessions still load). PRD §5.1 mandates recovery-oriented state files that survive corruption.

## Bugfix Session Layout (Issue 4)

`runQACycle()` (line ~1730):
```ts
const bugfixSessionPath = resolve(sessionPath, 'bugfix');  // FLAT, not numbered
await mkdir(bugfixSessionPath, { recursive: true });
```

`#detectInterruptedBugfix()` (line ~1913):
```ts
const bugfixDir = resolve(sessionPath, 'bugfix');  // checks flat dir only
```

**PRD Requirement** (§4.4 step 3, §5.1): `bugfix/NNN_hash/` numbered iterations (e.g., `001_hash/`, `002_hash/`).

## executeBacklog Empty-Backlog Swallow (Issue 5)

`executeBacklog()` (line ~1295):
```ts
const backlog = this.sessionManager.currentSession?.taskRegistry;
if (!backlog) {
  throw new Error('Cannot execute pipeline: no backlog found in session');  // plain Error
}
```

This throw is caught by the outer try/catch (line ~1543):
```ts
if (isFatalError(error, this.#continueOnError)) { throw error; }
// Non-fatal: track and continue  ← SWALLOWS the error
```

`isFatalError()` (errors.ts line ~835) returns `false` for plain `Error` (only specific `PipelineError` subtypes are fatal). So the error is logged as warning and swallowed → pipeline proceeds to validation/QA with zero tasks.

**FIX DIRECTION**: Make this a fatal `PipelineError` subtype (e.g., `TaskError` with a specific fatal code, or a new `SessionError` with LOAD_FAILED) so `isFatalError()` returns true and it propagates.

## Error Fatality Hierarchy (for Issue 5 fix)

From `src/utils/errors.ts`:
```
PipelineError (abstract)
├── EnvironmentError     → ALWAYS FATAL
├── SessionError         → FATAL if code is LOAD_FAILED or SAVE_FAILED
├── ValidationError      → FATAL if code is INVALID_INPUT + operation='parse_prd'
├── TaskError            → NON-FATAL (individual failures)
├── AgentError           → NON-FATAL (individual failures)
├── BugfixSessionValidationError → (specific codes)
├── NestedExecutionError → (specific codes)
```

To make "no backlog found" fatal, the throw should use `SessionError` with `LOAD_FAILED` code (or add a new fatal code).

## Session Numbering Pattern (for Issue 4 fix)

From `src/core/session-manager.ts` / `session-utils.ts`:
```ts
const paddedSeq = String(sequence).padStart(3, '0');  // '001', '002', etc.
const sessionId = `${paddedSeq}_${sessionHash}`;       // '001_14b9dc2a33c7'
```

The bugfix numbering should follow the same `NNN_hash` pattern under the `bugfix/` subdirectory.