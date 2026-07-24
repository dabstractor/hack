# Research Summary — P4.M1.T2.S2

## Work Item (CONTRACT)

> Validate/bug-hunt reuse completed session with pending change (PRD §4.3 step 2, last bullet).

**CONTRACT mapping**:
1. RESEARCH NOTE → `runQACycle()` (`prp-pipeline.ts:1122`) mode dispatch: bug-hunt always
   runs QA; validate skips QA; normal runs QA only if all tasks complete. PRD §4.3 says in
   `--validate`/`--bug-hunt` mode against an **already-completed** session with a **pending**
   PRD change, MUST reuse the latest completed session (an empty delta has no `tasks.json` and
   would make the gates bail). The change is left pending so the next normal run processes it.
2. INPUT → response-selection handlers from P4.M1.T2.S1 (S1 builds the `prd_changed.marker`
   primitive + the response dispatcher; **S2 reuses its own approach** — see the
   S1-vs-S2 dependency note below).
3. LOGIC → in `--validate`/`--bug-hunt` code paths, when there is a pending PRD change on a
   completed session: (a) do NOT create a new empty delta session; (b) reuse the latest
   completed session; (c) leave the pending change in place; (d) add a log/info message.
4. OUTPUT → validate/bug-hunt reuses completed session. Completes P4.M1.T2.
5. DOCS → none (no user-facing/config/API surface change).

## The Root Cause (from 3 parallel scouts)

`PRPPipeline.run()` (`prp-pipeline.ts:1745`) executes a **fixed, mode-independent** sequence:
`initializeSession()` → `decomposePRD()` → `rebuildQueue()` → `executeBacklog()` →
`runQACycle()`. **Mode is consulted ONLY inside `runQACycle()`** (`:1122-1180`):
- `bug-hunt` → run QA immediately.
- `validate` → skip QA.
- `normal` → run QA only if all tasks complete.

`initializeSession()` (`:528`) calls `SessionManager.initialize()` **unconditionally** with NO
mode/`--continue` argument. `initialize()` (`session-manager.ts:298-556`) is **hash-based
only**: it hashes the current PRD and either (a) loads the one session whose dir-name hash
matches (`#findSessionByHash`, `:266`), or (b) creates a **brand-new empty session dir**. There
is **no resume flag, no mode arg, no "latest completed" lookup** in `initialize()`.

**Consequence**: when the PRD has a pending change (hash mismatch), `#findSessionByHash`
returns `null`, `initialize()` creates a new empty session (`taskRegistry.backlog: []`),
`decomposePRD()` then runs the Architect over the (changed) full PRD producing a fresh task
set, and validate/bug-hunt operate on that fresh set — NOT on the completed session the user
intended. This is exactly the "empty delta has no tasks.json" failure PRD §4.3 warns about.

**IMPORTANT scope nuance**: the delta branch at `:577-581`
(`if (hasSessionChanged()) await handleDelta()`) is **currently unreachable** through the
normal `run()` path, because `initialize()` exact-hash-matches before loading
(`hasSessionChanged()` therefore always returns false post-`initialize()`). The PRD's reuse
mandate is about the **`initialize()` session-selection layer**, NOT about the `handleDelta()`
dispatcher S1 owns. **S2's fix lives in `initializeSession()` / a new SessionManager resume
helper — it must NOT touch S1's `handleDelta()`/marker dispatcher.**

## S1-vs-S2 Dependency Note (CRITICAL)

S1 (`P4.M1.T2.S1`) builds, **net-new**: the `prd_changed.marker` file primitive, the
`--accept-prd-changes` flag, the response-selection dispatcher in `handleDelta()`, and the
integrate-into-current path. S1 explicitly wires detection on the `--continue` resume path.

S2 (this item) is a **DIFFERENT** code path: it operates at the **`initializeSession()`
session-selection layer**, not at the `handleDelta()` response-dispatch layer. S2 must NOT
rely on S1's `prd_changed.marker` (that marker is written inside `handleDelta()`, which is
unreachable in the normal flow and which S2 deliberately bypasses). Instead, S2 detects the
condition directly: `mode === 'validate' || 'bug-hunt'` AND current-PRD-hash ≠
latest-completed-session-hash AND that session's tasks are all `Complete`.

**The two items are parallel/researching at the same time** (per `<plan_status>` and
`<parallel_execution_context>`). S2's PRP treats S1's deliverables as a CONTRACT but does NOT
import or call S1's functions. The files they touch do not overlap at the implementation
seam (S1: `handleDelta()` + marker trio + `--accept-prd-changes`; S2: `initializeSession()`
session-selection guard + a SessionManager resume helper). **No file conflict.**

## Detection primitives that ALREADY EXIST (compose them)

| Primitive | Location | Use |
|---|---|---|
| `SessionManager.findLatestSession(planDir)` (static public) | `session-manager.ts:1365` | candidate `SessionMetadata` (highest sequence; metadata only — NO task data) |
| `SessionManager.listSessions(planDir)` (static public) | `session-manager.ts:1302` | ascending-seq `SessionMetadata[]` |
| `readTasksJSON(sessionPath)` (standalone export) | `session-utils.ts:841` | load a candidate's `Backlog` WITHOUT making it current |
| `#allTasksComplete()` (private on PRPPipeline) | `prp-pipeline.ts:2023` | all-Complete predicate (iterates phases→milestones→tasks→subtasks) |
| `loadSession(sessionPath)` (public on SessionManager) | `session-manager.ts:569` | reads tasks.json + prd_snapshot.md, returns `SessionState`; **does NOT mutate `#currentSession`** |
| `hashPRD` / `hashPRDContent` | `session-utils.ts` | compute current-PRD hash to compare against a session's `metadata.hash` |

**Gap**: `loadSession()` is `public` but does NOT assign `#currentSession`. Only
`initialize()` and `createDeltaSession()` assign it (both private-internal). To "reuse" a
session we need to make it the current session WITHOUT calling `initialize()` (which would
re-hash to the new PRD and create an empty session) and WITHOUT `createDeltaSession()` (which
creates a NEW dir). **Design choice**: add a minimal public method
`SessionManager.loadSessionAsCurrent(sessionPath): Promise<SessionState>` that calls
`loadSession()` AND assigns `#currentSession = result` + sets `#prdHash` to the CURRENT prd
hash (so `hasSessionChanged()` stays false → no delta branch fires). This is the smallest
surface that satisfies the contract.

## Design — where the guard goes

In `PRPPipeline.initializeSession()` (`prp-pipeline.ts:528`), BEFORE calling
`this.sessionManager.initialize()`, add a mode-guarded reuse check:

```ts
async initializeSession(): Promise<void> {
  // ... existing logging ...
  try {
    // NEW: validate/bug-hunt reuse-completed-session guard (PRD §4.3 step 2)
    if (this.mode === 'validate' || this.mode === 'bug-hunt') {
      const reused = await this.tryReuseCompletedSessionForReRun();
      if (reused) {
        // session reused; change left pending for next normal run
        this.currentPhase = 'session_initialized';
        return;  // SKIP the normal initialize() path (which would create an empty session)
      }
      // fall through to normal initialize() if no reusable completed session
    }

    const session = await this.sessionManager.initialize();
    // ... existing rest of method (orchestrator build, delta check, etc.) ...
  }
}
```

`tryReuseCompletedSessionForReRun()` is a new private method on PRPPipeline:
1. Compute current-PRD hash (`hashPRD`).
2. `findLatestSession(planDir)` → latest `SessionMetadata | null`.
3. If null → return false (nothing to reuse).
4. If `latest.metadata.hash === currentHash` → no pending change → return false (normal
   `initialize()` will load it anyway).
5. Load `readTasksJSON(latest.metadata.path)`; check all-Complete. If NOT all complete →
   return false (don't reuse an incomplete session — the contract is about completed sessions).
6. Reuse: `await this.sessionManager.loadSessionAsCurrent(latest.metadata.path)`; log
   "Reusing completed session <id> for validate/bug-hunt re-run; pending PRD change left for
   next normal run"; return true.

**Critical**: `loadSessionAsCurrent` sets `#prdHash` to the CURRENT prd hash (mismatch source
erased) so `hasSessionChanged()` returns false even if the delta branch were later reached.
This guarantees the pending change is **detected as pending only by comparing the session's
own `metadata.hash` (old) vs the current PRD hash** — which we did in step 4. The session's
`prd_snapshot.md` is **NOT refreshed** (change stays pending).

## Why downstream steps tolerate the reused session

- `decomposePRD()` (`:747-762`) **skips regeneration when a backlog already exists**
  (`hasBacklog` → return). The reused completed session has its full backlog → decompose is a
  no-op. ✓
- `executeBacklog()` (`:870-889`) returns early when `totalSubtasks === 0`; the reused session
  has subtasks (all Complete) so it does NOT skip — but the orchestrator will process 0 items
  (all are Complete) and return. **Verify** the orchestrator's processNextItem is a no-op for
  Complete items (it filters them out). This needs a test.
- `runQACycle()` (`:1122-1180`): bug-hunt runs QA over `#extractCompletedTasks()` (the reused
  session's completed tasks) ✓; validate skips QA ✓.

## Test patterns (from scout 3)

- Copy the full `vi.mock()` block from `tests/unit/workflows/prp-pipeline.test.ts:17-114`
  (12 modules: node:fs/promises, session-utils passthrough, session-manager factory,
  task-orchestrator, agent-factory, prompts passthrough, delta/bug-hunt/fix-cycle workflows,
  task-patcher, task-utils, execution-guard).
- `createMockSessionManager(session, hasSessionChanged=false)` helper (`:226-243`) — clone it.
- Construct via `new PRPPipeline('./test.md')` then `(pipeline as any).mode = 'validate'` and
  `(pipeline as any).sessionManager = mockManager`.
- Assert NOT-called via `vi.spyOn(pipeline, 'handleDelta')` + `not.toHaveBeenCalled()` (the
  exact precedent is at `:719-728`) and `mockManager.createDeltaSession` NOT called.
- `afterEach` MUST `process.removeAllListeners('SIGINT'|'SIGTERM')` (pipeline registers signal
  handlers in its constructor).
- `vitest.config.ts:42-50` → 100% global thresholds (statements/branches/functions/lines). New
  branches (the `if validate/bug-hunt`, the `if reused`) each need a test or `test:coverage`
  fails.
- `npm run validate` = lint + format:check + typecheck + **test:run (NO coverage)**. Coverage
  enforced only by `npm run test:coverage`. Implementer MUST run `test:coverage` separately.

## Validation commands (verified)

- `npm run lint` (eslint .ts)
- `npm run format:check` (prettier, includes .md)
- `npm run typecheck` (tsc --noEmit -p tsconfig.build.json)
- `npm run test:run` (vitest run, no coverage)
- `npm run validate` = all of the above chained
- `npm run test:coverage` (vitest run --coverage) — the 100% gate

## Scope boundary (do NOT)

- Do NOT touch S1's `handleDelta()` dispatcher, `prd_changed.marker` trio, or
  `--accept-prd-changes` flag (S1 owns those; no overlap).
- Do NOT add a `SessionState.status` field (large blast radius; completion is derived from
  tasks.json — `#allTasksComplete()` already does this).
- Do NOT refresh `prd_snapshot.md` in the reuse path (the change must stay pending).
- Do NOT call `createDeltaSession()` (that creates a new dir — exactly what we avoid).
- Do NOT change `--mode` CLI surface or add flags (the contract says no API/config change).
- Do NOT modify `runQACycle()` (the mode dispatch there already does the right thing once the
  correct session is loaded).
- Do NOT edit docs (CONTRACT item 5: "DOCS: none").