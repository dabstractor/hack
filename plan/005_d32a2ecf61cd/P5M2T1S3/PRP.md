# PRP — P5.M2.T1.S3: Wire smart-recovery into the orchestrator after each agent run

## Goal

**Feature Goal**: Implement PRD §5.1 / §9.3.2 *"Re-apply after every agent run"* by wiring S2's `recoverTasksJson(...)` into `TaskOrchestrator.executeSubtask`. After **each** agent invocation (each iteration of the issue-bounded `while(true)` loop), the orchestrator (1) reconciles on-disk `tasks.json` — re-applying ONLY the legitimate status delta for the item just run, discarding unauthorized agent mutations to unrelated items, and transparently restoring a corrupt file from git history — then (2) **reloads the session registry from the recovered disk** so the orchestrator's in-memory `#backlog` reflects reality, and (3) does all of this **non-fatally** (a recovery/reload failure is logged and the session continues). This closes R4 (the third and final subtask of Task 5.2.1).

**Deliverable**:
1. **MODIFY `src/core/task-orchestrator.ts`** —
   - Add imports: `recoverTasksJson` (from `./tasks-json-recovery.js`), `readTasksJSON` (extend the existing `session-utils.js` import), `SessionState` (extend the existing `models.js` type import).
   - Add a new private async method `#recoverAfterAgentRun(itemId, result)` that maps the `ExecutionResult` to the intended legitimate status, calls `recoverTasksJson` with the pre-agent `#backlog` as `baselineBacklog`, reloads the session registry from the recovered disk via `readTasksJSON` + the readonly-cast idiom + `refreshBacklog()`, and is wrapped in one outer try/catch (non-fatal — logs + returns).
   - Call `await this.#recoverAfterAgentRun(subtask.id, result)` inside `executeSubtask` **immediately after `this.#retryManager.executeWithRetry(...)` returns** and **before** the background-research trigger + tri-state status handling.
2. **MODIFY `tests/unit/core/task-orchestrator.test.ts`** —
   - Extend the module-level `session-utils` mock to also export `readTasksJSON`; add a module-level mock for `tasks-json-recovery` (`recoverTasksJson`).
   - Add a new `describe('executeSubtask — smart recovery after agent run (PRD §5.1, R4 S3)')` block with the failing tests FIRST (RED), then pass (GREEN).

**Success Definition**: `npm run validate` (eslint + prettier --check + tsc --noEmit) **and** `npm run test:run` (vitest run) both green; the new recovery describe block passes (RED observed before GREEN — TDD); **all ~120 existing orchestrator tests still pass** (recovery adds NO `updateItemStatus` calls, so status-transition counts are unchanged); `git diff --stat` shows ONLY `src/core/task-orchestrator.ts` + `tests/unit/core/task-orchestrator.test.ts` (no docs — Mode A "none beyond inline comments" per the contract DOCS line; the ARCHITECTURE.md narrative was added in S2).

## User Persona

**Target User**: The pipeline itself — specifically the orchestrator's resilience contract with PRD §5.1. There is no human or external consumer; this subtask is an internal integration of S2's recovery routine into the orchestrator's hot path.

**Use Case**: A Coder agent finishes (or is interrupted/crashes mid-run) after scribbling on `tasks.json` — a truncated write, a partial edit, a schema-invalid mutation, or an unauthorized status change on an unrelated item. Without recovery, the corrupted/unauthorized disk state persists until the next flush or — worse — becomes the source of truth on a session resume. With recovery, the orchestrator reconciles disk after every agent run and carries on.

**User Journey**: agent run returns (`executeWithRetry` resolves with `ExecutionResult`) → orchestrator calls `#recoverAfterAgentRun(itemId, result)` → `recoverTasksJson(tasksPath, {itemId, intendedStatus}, {baselineBacklog: #backlog})` reconstructs baseline+delta (PATH A) OR restores last-valid from git history + delta (PATH B) OR logs+leaves-as-is (PATH C) → orchestrator reloads the recovered disk into `currentSession.taskRegistry` → `refreshBacklog()` → tri-state status handling (`setStatus('Complete'|'Failed'|'Planned')`) proceeds against a clean registry → `smartCommit` + `flushUpdates`.

**Pain Points Addressed**: PRD §5.1 — *"Agents routinely corrupt `tasks.json` … The system must survive this without human intervention … A single corrupting agent must never terminate the session. Restore is automatic and logged."* S2 built the recovery routine; **this subtask is the per-run hook that actually invokes it** — without it, S2's routine is dead code.

## Why

- **Business value**: Completes R4 ("tasks.json Protection & Smart Recovery"). S1 added the git-history primitives; S2 composed them into `recoverTasksJson`; **S3 is the integration that makes the orchestrator self-heal after every agent run**. This is the user-visible payoff (resilient pipeline) of the whole task.
- **Scope boundary**: This subtask owns **only the wiring** (orchestrator call site + reload + non-fatal wrapper) and its tests. It does NOT touch the recovery routine itself (`src/core/tasks-json-recovery.ts` — S2), the git primitives (`src/tools/git-mcp.ts` — S1), the session manager internals (reload is done via the readonly-cast idiom on the orchestrator side), `session-utils.ts` (consumed as-is), `constants.ts` (R4 adds no env var), or any docs (Mode A "none"; the §5.1 narrative landed in S2's `ARCHITECTURE.md` edit).
- **Parallel-execution safety**: S2 (`P5.M2.T1.S2`) is in-flight. This PRP treats S2's PRP as a CONTRACT and consumes exactly the `recoverTasksJson` signature + non-throwing invariant it specifies. No duplication, no conflict.

## What

### User-visible behavior

None directly — this is an internal orchestrator hook. Observable effect: after a corrupting agent run, the session's on-disk `tasks.json` is reconciled and the orchestrator's in-memory backlog reflects the recovered disk, without the session terminating or a human being paged.

### Technical requirements (the CONTRACT)

1. **Call site (verbatim placement)** — inside `executeSubtask`, inside the existing `while (true)` loop, **immediately after** `const result = await this.#retryManager.executeWithRetry(subtask, async () => { return await this.#prpRuntime.executeSubtask(subtask, this.#backlog); });` and **before** the `this.#logger.info(... 'PRPRuntime execution complete')` / background-research trigger / tri-state branch:
   ```ts
   // Smart recovery: reconcile tasks.json after every agent run (PRD §5.1, R4 S3).
   // Re-applies ONLY the legitimate status delta; discards unauthorized agent mutations;
   // restores from git history if the agent corrupted the file. Non-fatal.
   await this.#recoverAfterAgentRun(subtask.id, result);
   ```
   This runs **once per agent run** — for an `issue` that re-loops, recovery runs each iteration (correct per §5.1 "Re-apply after every agent run").
2. **Intended-status mapping** (inside `#recoverAfterAgentRun`, computed from `result` + the per-item issue counter, BEFORE the tri-state branch increments it):
   - `result.success` → `'Complete'`
   - `result.outcome === 'issue'` AND `nextIssueAttempt <= getIssueRetryMax()` → `'Planned'` (the issue branch resets to Planned for re-planning)
   - `result.outcome === 'issue'` AND `nextIssueAttempt > getIssueRetryMax()` → `'Failed'` (re-planning exhausted → hard-fail)
   - else (`fail`) → `'Failed'`
   - where `nextIssueAttempt = (this.#issueAttempts.get(itemId) ?? 0) + 1`.
   The status passed to recovery MUST match the `setStatus(...)` the tri-state branch will call next, so recovery and the subsequent status write agree.
3. **`recoverTasksJson` invocation**:
   ```ts
   const tasksPath = join(session.metadata.path, 'tasks.json');
   const recovery = await recoverTasksJson(
     tasksPath,
     { itemId, status: legitimateStatus },
     { baselineBacklog: this.#backlog, repoPath: process.cwd() }
   );
   ```
   `baselineBacklog: this.#backlog` is the orchestrator's pre-agent in-memory snapshot — THIS is what makes recovery discard unauthorized unrelated-item mutations (S2 PATH A reconstructs from the baseline, ignoring the agent's disk scribbles).
4. **Disk-reload into the session registry (CRITICAL)** — `refreshBacklog()` re-reads in-memory only (implementation_notes §6), so after `recoverTasksJson` writes the reconstructed backlog to disk, EXPLICITLY reload:
   ```ts
   const recovered = await readTasksJSON(session.metadata.path);
   (this.sessionManager.currentSession as { taskRegistry: Backlog }).taskRegistry = recovered;
   await this.refreshBacklog();
   ```
   The cast removes `readonly` (compile-time only) — identical idiom to `state-validator.ts` repair fns and S2's `setItemStatus`. `SessionState.taskRegistry` is `readonly` (src/core/models.ts:888) so a direct assignment won't compile without the cast. This keeps the change inside `task-orchestrator.ts` (no `session-manager.ts` method added). Do NOT call `sessionManager.loadBacklog()` — it returns the backlog but does NOT assign it to the registry.
5. **Non-fatal invariant (CRITICAL).** Wrap the ENTIRE `#recoverAfterAgentRun` body in one outer `try { ... } catch (error) { this.#logger.error({itemId, err}, 'tasks.json smart recovery failed (non-fatal); continuing'); }`. `recoverTasksJson` itself never throws (S2 PATH C), but the reload's `readTasksJSON` CAN throw if recovery left disk corrupt (PATH C). A recovery/reload failure MUST NOT terminate `executeSubtask` — log and return so the tri-state handling proceeds normally (PRD §5.1: *"A single corrupting agent must never terminate the session."*).
6. **Guard the session.** Bail early (log + return) if `this.sessionManager.currentSession` is null (defensive — the constructor already rejects a null session, but the guard makes the helper self-contained).
7. **TDD — RED before GREEN.** Write the new `describe` block in `tests/unit/core/task-orchestrator.test.ts` FIRST; confirm RED (`npm run test:run -- task-orchestrator` → the new `it` cases fail because `#recoverAfterAgentRun` doesn't exist yet / `recoverTasksJson` mock isn't called); implement the wiring; confirm GREEN.
8. **Reuse, do not duplicate:** `recoverTasksJson` from `./tasks-json-recovery.js` (S2); `readTasksJSON` from `./session-utils.js`; `getLogger` (already in the orchestrator as `this.#logger`); `join` from `node:path` (already imported); `getIssueRetryMax` from `../config/constants.js` (already imported). Do NOT reimplement status mapping, git history, parse, or validate logic.
9. **Inline docs only (Mode A).** Per the contract DOCS line, NO `docs/` edit — S2 already added the `### tasks.json Protection & Smart Recovery` subsection to `ARCHITECTURE.md`. Add a concise inline comment + JSDoc on `#recoverAfterAgentRun` only.
10. **Scope guardrails (do NOT touch):** `src/core/tasks-json-recovery.ts` (S2), `src/tools/git-mcp.ts` (S1), `src/core/session-manager.ts` (reload via cast — no method added), `src/core/session-utils.ts`, `src/core/state-validator.ts`, `src/core/models.ts`, `src/config/constants.ts`, `src/agents/prp-runtime.ts`, `src/agents/prp-executor.ts`, `docs/ARCHITECTURE.md`, `README.md`, `docs/WORKFLOWS.md`, and any other test file.

### Success Criteria

- [ ] `executeSubtask` calls `recoverTasksJson` **once per agent run** (inside the loop, after `executeWithRetry`), with `{ itemId: subtask.id, status: <intended> }` and `{ baselineBacklog: this.#backlog, repoPath }`.
- [ ] Intended status is correct for each outcome: `success`→`Complete`, `fail`→`Failed`, `issue`(re-plan)→`Planned`, `issue`(exhausted)→`Failed`.
- [ ] After recovery, the session registry is reloaded from the recovered disk (`readTasksJSON` → assign `taskRegistry` → `refreshBacklog()`).
- [ ] Recovery is non-fatal: a throwing `recoverTasksJson`/`readTasksJSON` is caught, logged, and execution continues to `Complete`/`Failed` + `smartCommit` + `flushUpdates` WITHOUT `executeSubtask` throwing.
- [ ] Existing ~120 orchestrator tests still pass (recovery adds NO `updateItemStatus` calls → status-transition counts unchanged).
- [ ] `npm run validate` passes (zero errors).
- [ ] `npm run test:run` passes (all green; RED observed before GREEN).
- [ ] `git diff --stat` shows ONLY `src/core/task-orchestrator.ts` + `tests/unit/core/task-orchestrator.test.ts`.

## All Needed Context

### Context Completeness Check

_Pass_: An agent with zero codebase knowledge can implement this from (a) the exact call-site + `#recoverAfterAgentRun` skeleton in "Implementation Blueprint", (b) the deterministic intended-status table, (c) the verified readonly-cast reload idiom, (d) the canonical test blocks (mock-based, matching the file's architecture), and (e) the verified validation commands. Every reference resolves to a real file/line today (post-S2). No inference beyond the canonical blocks required.

### Documentation & References

```yaml
# MUST READ — the S2 PRP (the CONTRACT for recoverTasksJson this subtask consumes)
- file: plan/005_d32a2ecf61cd/P5M2T1S2/PRP.md
  why: |
    Defines the EXACT signature + non-throwing invariant S3 consumes:
      recoverTasksJson(tasksPath, { itemId, status }, { baselineBacklog?, repoPath? }): Promise<TasksJsonRecoveryResult>
    TasksJsonRecoveryResult = { restored: boolean; source: 'disk'|'git'; reason?: string }.
    NEVER throws (S2 PATH C logs + returns). S3 still wraps in try/catch because the RELOAD step
    (readTasksJSON) can throw if recovery left disk corrupt.
    baselineBacklog semantics: S2 PATH A reconstructs from baseline (discards unauthorized unrelated-item
    mutations); PATH B restores from git history + applies delta + preserves Researching/Retrying.
  section: "Goal (signature), What §2-§4, Implementation Patterns (3-path skeleton)"

# MUST READ — the file being modified (call site + loop structure)
- file: src/core/task-orchestrator.ts
  why: |
    executeSubtask (≈ L540-720): the try/catch + while(true) loop + tri-state handling. The agent run is
      `const result = await this.#retryManager.executeWithRetry(subtask, async () => this.#prpRuntime.executeSubtask(subtask, this.#backlog))`.
    Insert the recovery call IMMEDIATELY after that line, before the `this.#logger.info(... 'PRPRuntime execution complete')`.
    Existing imports to EXTEND: `import { atomicWrite } from './session-utils.js'` → + readTasksJSON;
      `import type { ..., Status, ... } from './models.js'` → + SessionState.
    this.#logger (getLogger('TaskOrchestrator')), this.#backlog, this.#issueAttempts (Map), this.sessionManager,
      getIssueRetryMax(), join (node:path) are ALL already available — reuse them.
    refreshBacklog() (≈ L455): `this.#backlog = currentSession.taskRegistry` (in-memory only — that's WHY we reload).
  section: "executeSubtask(), refreshBacklog(), #issueAttempts field"

# MUST READ — the tri-state ExecutionResult S3 maps to a status
- file: src/agents/prp-executor.ts
  why: |
    ExecutionResult = { success: boolean; outcome?: 'success'|'fail'|'issue'; issueMessage?; validationResults; artifacts; error?; fixAttempts }.
    Invariant: success === (outcome === 'success'). S3 reads result.success + result.outcome to pick the legitimate status.
  section: "ExecutionResult interface"

# MUST READ — why the reload needs the readonly cast
- file: src/core/models.ts
  why: |
    SessionState.taskRegistry is `readonly` (L888). Direct assignment won't compile. The reload uses
      (this.sessionManager.currentSession as { taskRegistry: Backlog }).taskRegistry = recovered
    to strip readonly — the SAME idiom state-validator.ts uses for repair mutations. readonly is compile-time only,
    so the runtime assignment is safe.
  section: "SessionState (L884-894)"

# MUST READ — the read primitive used for the reload
- file: src/core/session-utils.ts
  why: |
    readTasksJSON(sessionPath): Promise<Backlog> — resolves `resolve(sessionPath,'tasks.json')`, JSON.parse + BacklogSchema.parse,
      THROWS SessionFileError on read/parse/validate failure. Takes a SESSION DIRECTORY. For the reload pass
      `session.metadata.path` (the session dir, NOT the tasks.json file). On PATH-C corrupt disk it throws → caught by the
      non-fatal wrapper. Do NOT call sessionManager.loadBacklog() (returns but doesn't assign to the registry).
  section: "readTasksJSON()"

# REFERENCE — R4 scope boundary (S1 primitives / S2 routine / S3 wiring split)
- file: plan/005_d32a2ecf61cd/architecture/delta_impact.md
  why: R4 "What must change" — item 2 = S2 (the routine); the per-run hook = S3. Confirms S3 "wires recoverTasksJson
       into TaskOrchestrator.executeSubtask after each agent run" and is "non-fatal + logged".
  section: "R4 — tasks.json Protection & Smart Recovery"

# REFERENCE — the in-memory-only refreshBacklog gotcha + validation gates
- file: plan/005_d32a2ecf61cd/architecture/implementation_notes.md
  why: §6 (refreshBacklog re-reads in-memory, NOT disk → S3 must explicitly reload from recovered disk via readTasksJSON).
       §3 (ISSUE_RETRY_MAX bounds re-planning; #issueAttempts is orchestrator-level, separate from TaskRetryManager).
       §10 (validation gates: npm run validate + npm run test:run).
  section: "§3, §6, §10"

# REFERENCE — the existing test file's mock architecture (MUST match it)
- file: tests/unit/core/task-orchestrator.test.ts
  why: |
    Module-level vi.mock(): logger, task-utils, scope-resolver, git-commit (smartCommit), research-queue, session-utils
      (CURRENTLY { atomicWrite } ONLY — S3 EXTENDS to + readTasksJSON), prp-runtime.
    createMockSessionManager(currentSession) → { currentSession, updateItemStatus: vi.fn().mockResolvedValue(currentSession.taskRegistry),
      loadBacklog: vi.fn(), flushUpdates: vi.fn() }.
    Factory fns: createTestSubtask/Task/Milestone/Phase/Backlog. createTestSubtask default context_scope='Test scope'.
    Pattern to override the runtime stub per-test: `(orchestrator.prpRuntime.executeSubtask as any) = vi.fn().mockResolvedValue({...})`
      (see the research-fallback + non-timeout-error tests ≈ L680-810).
    Top-level beforeEach: vi.clearAllMocks() (resets call counts; preserves factory impls).
  section: "module-level vi.mock block, createMockSessionManager, executeSubtask describe (L600-810)"

# REFERENCE — PRD source of truth
- file: PRD.md
  why: §5.1 "tasks.json Protection & Smart Recovery" → "Re-apply after every agent run" + "Non-fatal … never terminate the session".
       §9.3.2 "tasks.json Restore" → "After every agent run the orchestrator re-applies only the legitimate status delta …".
  section: "§5.1 (tasks.json Protection block), §9.3.2"
```

### Current Codebase tree (relevant slice)

```bash
src/core/
├── task-orchestrator.ts          # MODIFY: + imports, + #recoverAfterAgentRun, + call site in executeSubtask
├── tasks-json-recovery.ts        # CONSUMED (S2): recoverTasksJson (+ TasksJsonRecoveryResult)
├── session-utils.ts              # CONSUMED: readTasksJSON (reload), atomicWrite (existing)
├── session-manager.ts            # NOT TOUCHED (reload via orchestrator-side cast on currentSession)
├── models.ts                     # CONSUMED: Backlog, Status, SessionState (readonly taskRegistry)
└── state-validator.ts            # NOT TOUCHED

src/config/
└── constants.ts                  # CONSUMED: getIssueRetryMax (already imported)

tests/unit/core/
└── task-orchestrator.test.ts     # MODIFY: + session-utils mock extension, + tasks-json-recovery mock, + describe block

docs/
└── ARCHITECTURE.md               # NOT TOUCHED (S2 added the §5.1 narrative; S3 = Mode A "none")
```

### Desired Codebase tree with files to be modified

```bash
src/core/
└── task-orchestrator.ts          # MODIFIED: wire recoverTasksJson + reload + non-fatal wrapper

tests/unit/core/
└── task-orchestrator.test.ts     # MODIFIED: extend mocks + new recovery describe block (RED-first)
```

> **File-placement decision**: This is a pure wiring subtask — MODIFY the two files the contract names. No new modules (the recovery module is S2's), no docs (Mode A "none"), no session-manager change (reload via cast). Minimal, surgical scope.

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: refreshBacklog() re-reads IN-MEMORY only (implementation_notes §6): this.#backlog = currentSession.taskRegistry.
//   After recoverTasksJson writes the reconstructed backlog to DISK, you MUST explicitly reload:
//     readTasksJSON(session.metadata.path) → assign to currentSession.taskRegistry → refreshBacklog().
//   Calling refreshBacklog() alone will NOT pick up the recovered disk — it just re-reads the (stale) in-memory registry.

// CRITICAL: SessionState.taskRegistry is `readonly` (models.ts L888). A direct assignment won't compile.
//   Strip readonly with the established cast idiom (same as state-validator.ts + S2 setItemStatus):
//     (this.sessionManager.currentSession as { taskRegistry: Backlog }).taskRegistry = recovered;
//   readonly is compile-time only — the runtime assignment is safe. Do NOT add a method to session-manager.ts.

// CRITICAL: recoverTasksJson NEVER throws (S2 PATH C), but the reload's readTasksJSON CAN throw if recovery left the
//   disk corrupt (PATH C). Wrap the ENTIRE #recoverAfterAgentRun body in one outer try/catch → logger.error → return.
//   A recovery/reload failure must NOT terminate executeSubtask (PRD §5.1 "never terminate the session").

// CRITICAL: Insert the recovery call INSIDE the while(true) loop, right after executeWithRetry returns `result` and BEFORE
//   the tri-state branch. That way it runs once PER AGENT RUN (an issue that re-loops triggers recovery each iteration),
//   and the legitimate status is computed from the result BEFORE #issueAttempts is incremented by the issue branch.

// GOTCHA: The intended status for the issue path must match the setStatus the issue branch will call: 'Planned' when
//   re-planning will continue, 'Failed' when re-planning is exhausted. Compute nextIssueAttempt = (#issueAttempts.get(id)??0)+1
//   and compare against getIssueRetryMax() to decide — this mirrors the exhaustion check the issue branch performs.

// GOTCHA: baselineBacklog MUST be this.#backlog (the orchestrator's pre-agent in-memory snapshot), captured at the point of
//   the recovery call. THIS is what makes recovery DISCARD unauthorized unrelated-item mutations (S2 PATH A reconstructs from
//   baseline, ignoring the agent's disk scribbles). Passing the disk-read backlog instead would defeat the purpose.

// GOTCHA: Recovery adds NO this.sessionManager.updateItemStatus(...) calls. It only calls recoverTasksJson + readTasksJSON +
//   refreshBacklog(). Therefore the existing tests that assert updateItemStatus call counts (e.g. "3 times: Researching,
//   Implementing, Complete") STILL PASS — do not change those assertions.

// GOTCHA: The orchestrator test file is MOCK-ONLY ("no real I/O is performed"). The module-level `vi.mock('...session-utils.js')`
//   currently exports ONLY { atomicWrite }. S3 MUST extend it to also export readTasksJSON (else the reload throws in EVERY
//   orchestrator test → caught non-fatally, but it pollutes logs and makes the reload untestable). Add a module-level
//   `vi.mock('...tasks-json-recovery.js', () => ({ recoverTasksJson: vi.fn()... }))` and assert the WIRING.

// GOTCHA: Mock the recovery MODULE (recoverTasksJson), not its internals. The real corruption→git-restore mechanics are
//   already unit-tested in S2's tasks-json-recovery.test.ts (real tmpdir + real git). S3's job is to prove the WIRING:
//   invoked once per run, correct {itemId,status} + baselineBacklog, non-fatal, reload happened. This matches the file's
//   mock-only architecture AND the contract's named test file (tests/unit/core/task-orchestrator.test.ts).

// GOTCHA: To override the prpRuntime stub per-test (to exercise fail/issue outcomes), use the existing pattern:
//   (orchestrator.prpRuntime.executeSubtask as any) = vi.fn().mockResolvedValue({ success:false, outcome:'fail', ... }).
//   The default module-level stub returns success:true.

// GOTCHA: ESM import specifiers use '.js' in '.ts' files (e.g. './tasks-json-recovery.js'). Match the existing convention.
// GOTCHA: tsconfig.build.json EXCLUDES tests, so `npm run typecheck` does NOT typecheck tests — but the orchestrator change IS
//   typechecked, so the readonly-cast must compile. The cast form `(x as { taskRegistry: Backlog })` compiles cleanly.
// GOTCHA: vitest.config.ts coverage thresholds are 100% but coverage is enforced ONLY by `npm run test:coverage`, NOT by
//   `npm run test:run` or `npm run validate`. Coverage is NOT a gate for this subtask.
```

## Implementation Blueprint

### Data models and structure

No new types. S3 reuses `ExecutionResult` (prp-executor.ts) and `Backlog`/`Status`/`SessionState` (models.ts) and S2's `recoverTasksJson`/`TasksJsonRecoveryResult`. The only new surface is the private method `#recoverAfterAgentRun`.

### Implementation Patterns & Key Details

```typescript
// === src/core/task-orchestrator.ts — IMPORT ADDITIONS ===

// EXTEND the existing session-utils import (currently: import { atomicWrite } from './session-utils.js'):
import { atomicWrite, readTasksJSON } from './session-utils.js';
// NEW: the recovery routine from S2
import { recoverTasksJson } from './tasks-json-recovery.js';
// EXTEND the existing models type import to add SessionState:
import type {
  Backlog,
  Phase,
  Milestone,
  Task,
  Subtask,
  Status,
  PRPCompressionLevel,
  SessionState,
} from './models.js';
// NOTE: getIssueRetryMax, join, getLogger (as this.#logger) are ALREADY imported/available — reuse them.


// === src/core/task-orchestrator.ts — NEW PRIVATE METHOD ===
// Add this method anywhere inside the TaskOrchestrator class (e.g. just before #logCacheMetrics).

/**
 * Smart-recovery hook: reconcile on-disk tasks.json after every agent run (PRD §5.1, R4 S3).
 *
 * @remarks
 * Called from {@link executeSubtask} immediately after the agent run returns, before
 * the tri-state status handling. Delegates to {@link recoverTasksJson} (S2) to re-apply
 * ONLY the legitimate status delta for `itemId` (discarding unauthorized agent mutations
 * via the pre-agent baseline) and to restore from git history if the agent corrupted the
 * file. Then reloads the session registry from the recovered disk so the orchestrator's
 * in-memory backlog reflects reality (refreshBacklog() alone re-reads in-memory only).
 *
 * NON-FATAL: any failure (recovery or reload) is logged and swallowed — a single
 * corrupting agent must never terminate the session.
 *
 * @param itemId - The subtask just run (the item whose status delta is legitimate).
 * @param result - The ExecutionResult of the agent run (determines the intended status).
 */
async #recoverAfterAgentRun(
  itemId: string,
  result: ExecutionResultLike
): Promise<void> {
  const session = this.sessionManager.currentSession;
  if (!session) {
    this.#logger.warn(
      'No active session; skipping tasks.json smart recovery'
    );
    return;
  }

  try {
    // --- 1. Determine the intended legitimate status for this run ---
    const maxIssueRetries = getIssueRetryMax();
    const nextIssueAttempt = (this.#issueAttempts.get(itemId) ?? 0) + 1;
    const legitimateStatus: Status = result.success
      ? 'Complete'
      : result.outcome === 'issue'
        ? nextIssueAttempt > maxIssueRetries
          ? 'Failed' // issue-driven re-planning exhausted → hard-fail
          : 'Planned' // recoverable gap → reset for re-planning
        : 'Failed'; // hard implementation failure

    // --- 2. Reconcile disk: re-apply ONLY the legitimate delta; discard unauthorized
    //        mutations (reconstruct from the pre-agent #backlog baseline); restore from
    //        git history if the agent corrupted the file. recoverTasksJson never throws. ---
    const tasksPath = join(session.metadata.path, 'tasks.json');
    const recovery = await recoverTasksJson(
      tasksPath,
      { itemId, status: legitimateStatus },
      { baselineBacklog: this.#backlog, repoPath: process.cwd() }
    );
    if (recovery.restored) {
      this.#logger.info(
        { itemId, source: recovery.source, reason: recovery.reason },
        'tasks.json restored from git history after agent run'
      );
    }

    // --- 3. Reload the session registry from the recovered disk (refreshBacklog() is
    //        in-memory only — implementation_notes §6). readTasksJSON may throw if
    //        recovery left the disk corrupt (PATH C); that throw is caught below. ---
    const recovered = await readTasksJSON(session.metadata.path);
    // readonly-cast idiom (SessionState.taskRegistry is readonly; mirrors state-validator.ts)
    (
      this.sessionManager.currentSession as { taskRegistry: Backlog }
    ).taskRegistry = recovered;
    await this.refreshBacklog();
  } catch (error) {
    // NON-FATAL: a recovery/reload failure must never terminate the session (PRD §5.1).
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.#logger.error(
      { itemId, err: errorMessage },
      'tasks.json smart recovery failed (non-fatal); continuing'
    );
  }
}

// Local structural type so the method doesn't need to import ExecutionResult directly
// (it only reads result.success + result.outcome). Use the real type if you prefer:
//   import type { ExecutionResult } from '../agents/prp-executor.js';
type ExecutionResultLike = {
  readonly success: boolean;
  readonly outcome?: 'success' | 'fail' | 'issue';
};


// === src/core/task-orchestrator.ts — CALL SITE (inside executeSubtask's while(true)) ===
// Find this exact block:
//     const result = await this.#retryManager.executeWithRetry(
//       subtask,
//       async () => {
//         return await this.#prpRuntime.executeSubtask(subtask, this.#backlog);
//       }
//     );
//
//     this.#logger.info(
//       { subtaskId: subtask.id, success: result.success },
//       'PRPRuntime execution complete'
//     );
//
// INSERT the recovery call BETWEEN the executeWithRetry block and the 'PRPRuntime execution complete' log:

    const result = await this.#retryManager.executeWithRetry(
      subtask,
      async () => {
        return await this.#prpRuntime.executeSubtask(subtask, this.#backlog);
      }
    );

    // Smart recovery: reconcile tasks.json after every agent run (PRD §5.1, R4 S3).
    // Re-applies ONLY the legitimate status delta (discards unauthorized agent mutations
    // via the pre-agent baseline); restores from git history if the agent corrupted the
    // file; reloads the session registry from the recovered disk. Non-fatal.
    await this.#recoverAfterAgentRun(subtask.id, result);

    this.#logger.info(
      { subtaskId: subtask.id, success: result.success },
      'PRPRuntime execution complete'
    );
    // ... (existing background-research trigger + tri-state handling continues unchanged)
```

> **Type note:** `ExecutionResultLike` is a minimal structural type so the private method doesn't pull a new import. If the real `ExecutionResult` from `src/agents/prp-executor.ts` is already (or becomes) imported in `task-orchestrator.ts`, use it directly instead — both work; the method only reads `success` + `outcome`.

### Implementation Tasks (ordered by dependencies — strict TDD: RED first)

```yaml
Task 1: STUB the failing tests (RED — before Task 2)
  Step 1a — tests/unit/core/task-orchestrator.test.ts: EXTEND the module-level mocks.
    - FIND the existing `vi.mock('../../../src/core/session-utils.js', () => ({ atomicWrite: vi.fn().mockResolvedValue(undefined) }))`
      block and REPLACE it to ALSO export readTasksJSON:
        vi.mock('../../../src/core/session-utils.js', () => ({
          atomicWrite: vi.fn().mockResolvedValue(undefined),
          readTasksJSON: vi.fn().mockResolvedValue(null), // overridden per-test
        }));
    - ADD a new module-level mock immediately after it:
        vi.mock('../../../src/core/tasks-json-recovery.js', () => ({
          recoverTasksJson: vi.fn().mockResolvedValue({
            restored: false,
            source: 'disk',
            reason: 're-applied legitimate status delta',
          }),
        }));
    - ADD the imports + mock handles near the existing `import { atomicWrite }` / `const mockAtomicWrite` lines:
        import { readTasksJSON } from '../../../src/core/session-utils.js';
        import { recoverTasksJson } from '../../../src/core/tasks-json-recovery.js';
        const mockReadTasksJSON = readTasksJSON as ReturnType<typeof vi.fn>;
        const mockRecoverTasksJson = recoverTasksJson as ReturnType<typeof vi.fn>;
  Step 1b — tests/unit/core/task-orchestrator.test.ts: add the new describe block (verbatim from Canonical Test Blocks).
    Cover: (1) success run → recoverTasksJson called once with {status:'Complete'} + baselineBacklog===pre-agent #backlog;
    (2) fail run → {status:'Failed'}; (3) issue run → {status:'Planned'}; (4) baseline is the pre-agent snapshot (mutations discarded);
    (5) non-fatal — recoverTasksJson rejects + readTasksJSON rejects → executeSubtask still resolves, smartCommit still called, error logged;
    (6) reload — readTasksJSON called with session dir + currentSession.taskRegistry + orchestrator.backlog updated to the recovered backlog.
  VERIFY RED: `npm run test:run -- task-orchestrator` → the new it() cases FAIL (recoverTasksJson mock never called). RED confirmed.

Task 2: IMPLEMENT the wiring in src/core/task-orchestrator.ts (makes Task 1 GREEN)
  Step 2a — add the three import additions (recoverTasksJson; readTasksJSON on session-utils; SessionState on models).
  Step 2b — add the #recoverAfterAgentRun private method (verbatim from Implementation Patterns).
  Step 2c — insert the call site inside executeSubtask's while(true) loop, between executeWithRetry and the 'PRPRuntime execution complete' log.
  Step 2d — GOTCHA checks before validating:
    - recovery call is INSIDE the loop (runs once per agent run), BEFORE the tri-state branch.
    - legitimateStatus uses nextIssueAttempt = (#issueAttempts.get(id)??0)+1 vs getIssueRetryMax() (mirrors the issue branch's exhaustion check).
    - baselineBacklog: this.#backlog (NOT a disk-read backlog).
    - reload uses readTasksJSON(session.metadata.path) (session DIR) + the readonly cast + refreshBacklog().
    - ENTIRE #recoverAfterAgentRun body wrapped in one outer try/catch → logger.error → return. NEVER rethrows.
    - NO updateItemStatus calls added (existing status-count tests stay green).
  DO NOT touch: tasks-json-recovery.ts (S2), git-mcp.ts (S1), session-manager.ts, session-utils.ts, state-validator.ts,
    models.ts, constants.ts, prp-runtime.ts, prp-executor.ts, ARCHITECTURE.md, README.md, WORKFLOWS.md, any other test file.

Task 3: VERIFY (validation gates — run after Task 2)
  - RUN: `npm run validate` (eslint + prettier --check + tsc --noEmit) — expect zero errors.
      If prettier --check fails, run `npm run format` then re-run `npm run validate`.
      Common failure: forgetting the '.js' suffix on './tasks-json-recovery.js', or the readonly-cast not compiling.
  - RUN: `npm run test:run -- task-orchestrator` — expect GREEN (the new describe block + all ~120 existing tests).
  - RUN: `npm run test:run` (full suite) — expect all green (no regression; S2's tasks-json-recovery.test.ts still green).
  - SCOPE-VERIFY: `git diff --stat` shows ONLY src/core/task-orchestrator.ts + tests/unit/core/task-orchestrator.test.ts.
      `git diff src/core/tasks-json-recovery.ts src/core/session-manager.ts src/tools/git-mcp.ts src/config/constants.ts docs/ARCHITECTURE.md`
      must be EMPTY.
  - NON-FATAL-VERIFY: `grep -n "rethrow\|throw error\|throw err" src/core/task-orchestrator.ts` → the ONLY throw-rethrow is the EXISTING
      outer catch of executeSubtask (`throw error` at the end of the catch). #recoverAfterAgentRun must have NO rethrow.
  - STATUS-COUNT-VERIFY: the existing test "should set subtask status to Implementing then Complete" still asserts
      updateItemStatus called exactly 3 times — it MUST still pass (recovery adds no updateItemStatus calls).
```

### Canonical Test Blocks (add to tests/unit/core/task-orchestrator.test.ts)

Place this `describe` inside the top-level `describe('TaskOrchestrator', ...)` (e.g. after the existing `describe('executeSubtask', ...)` block or after `describe('smartCommit integration', ...)`).

```typescript
describe('executeSubtask — smart recovery after agent run (PRD §5.1, R4 S3)', () => {
  beforeEach(() => {
    // Recovery + reload defaults (overridden per-test as needed)
    mockRecoverTasksJson.mockReset();
    mockRecoverTasksJson.mockResolvedValue({
      restored: false,
      source: 'disk',
      reason: 're-applied legitimate status delta',
    });
    mockReadTasksJSON.mockReset();
    mockReadTasksJSON.mockResolvedValue(null);
    mockAtomicWrite.mockReset();
    mockAtomicWrite.mockResolvedValue(undefined);
    // smartCommit: resolve to a falsy hash so the orchestrator logs "No files to commit" (no commit)
    mockSmartCommit.mockReset();
    mockSmartCommit.mockResolvedValue(undefined);
  });

  // Shared setup: one Phase>Milestone>Task>Subtask; orchestrator built over a mock session manager.
  const setup = () => {
    const baselineBacklog = createTestBacklog([
      createTestPhase('P1', 'Phase 1', 'Planned', [
        createTestMilestone('P1.M1', 'M1', 'Planned', [
          createTestTask('P1.M1.T1', 'T1', 'Planned', [
            createTestSubtask('P1.M1.T1.S1', 'S1', 'Planned', [], 'scope'),
          ]),
        ]),
      ]),
    ]);
    const currentSession = {
      metadata: {
        id: '001_x',
        hash: 'x',
        path: '/plan/001_x',
        createdAt: new Date(),
        parentSession: null,
      },
      prdSnapshot: '# PRD',
      taskRegistry: baselineBacklog,
      currentItemId: null,
    };
    const mockManager = createMockSessionManager(currentSession);
    const orchestrator = new TaskOrchestrator(mockManager);
    const subtask = createTestSubtask('P1.M1.T1.S1', 'S1', 'Planned');
    return { orchestrator, subtask, baselineBacklog, currentSession };
  };

  it('invokes recoverTasksJson ONCE after a successful agent run with the Complete delta + pre-agent baseline', async () => {
    const { orchestrator, subtask, baselineBacklog } = setup();
    // default prpRuntime stub returns success

    await orchestrator.executeSubtask(subtask);

    // VERIFY: called exactly once per agent run
    expect(mockRecoverTasksJson).toHaveBeenCalledTimes(1);
    // VERIFY: correct tasks path + legitimate delta + pre-agent baseline
    expect(mockRecoverTasksJson).toHaveBeenCalledWith(
      '/plan/001_x/tasks.json',
      { itemId: 'P1.M1.T1.S1', status: 'Complete' },
      expect.objectContaining({ baselineBacklog })
    );
  });

  it('maps a hard-FAIL agent result to the Failed legitimate status', async () => {
    const { orchestrator, subtask } = setup();
    (orchestrator.prpRuntime.executeSubtask as any) = vi
      .fn()
      .mockResolvedValue({
        success: false,
        outcome: 'fail',
        error: 'boom',
        validationResults: [],
        artifacts: [],
        fixAttempts: 0,
      });

    await orchestrator.executeSubtask(subtask);

    expect(mockRecoverTasksJson).toHaveBeenCalledWith(
      '/plan/001_x/tasks.json',
      expect.objectContaining({
        itemId: 'P1.M1.T1.S1',
        status: 'Failed',
      }),
      expect.any(Object)
    );
  });

  it('maps a recoverable ISSUE result to the Planned legitimate status (PRD §4.5)', async () => {
    const { orchestrator, subtask } = setup();
    (orchestrator.prpRuntime.executeSubtask as any) = vi
      .fn()
      .mockResolvedValue({
        success: false,
        outcome: 'issue',
        issueMessage: 'planning gap',
        validationResults: [],
        artifacts: [],
        fixAttempts: 0,
      });

    await orchestrator.executeSubtask(subtask);

    expect(mockRecoverTasksJson).toHaveBeenCalledWith(
      '/plan/001_x/tasks.json',
      expect.objectContaining({
        itemId: 'P1.M1.T1.S1',
        status: 'Planned',
      }),
      expect.any(Object)
    );
  });

  it('discards unrelated agent mutations by passing the PRE-AGENT #backlog as baselineBacklog', async () => {
    const { orchestrator, subtask, baselineBacklog } = setup();

    await orchestrator.executeSubtask(subtask);

    // VERIFY: baselineBacklog is the SAME reference as the orchestrator's pre-agent snapshot
    // (this is what makes S2 PATH A discard the agent's unrelated-item mutations).
    const opts = mockRecoverTasksJson.mock.calls[0][2];
    expect(opts.baselineBacklog).toBe(baselineBacklog);
  });

  it('is NON-FATAL: a recovery+reload failure does NOT terminate execution (reaches Complete + smartCommit + flushUpdates)', async () => {
    const { orchestrator, subtask } = setup();
    mockRecoverTasksJson.mockRejectedValue(new Error('git exploded'));
    mockReadTasksJSON.mockRejectedValue(new Error('disk gone'));

    // VERIFY: executeSubtask resolves (does NOT throw) despite recovery+reload failing
    await expect(orchestrator.executeSubtask(subtask)).resolves.toBeUndefined();

    // VERIFY: execution continued past recovery to smartCommit + flushUpdates
    expect(mockSmartCommit).toHaveBeenCalledTimes(1);
    // VERIFY: the non-fatal failure was logged
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 'P1.M1.T1.S1' }),
      expect.stringContaining('recovery failed')
    );
  });

  it('reloads the session registry from the recovered disk after recovery (refreshBacklog is in-memory only)', async () => {
    const { orchestrator, subtask, currentSession } = setup();
    const recoveredBacklog = createTestBacklog([
      createTestPhase('P1', 'Phase 1', 'Planned', [
        createTestMilestone('P1.M1', 'M1', 'Planned', [
          createTestTask('P1.M1.T1', 'T1', 'Planned', [
            createTestSubtask('P1.M1.T1.S1', 'S1', 'Complete', [], 'scope'),
          ]),
        ]),
      ]),
    ]);
    mockReadTasksJSON.mockResolvedValue(recoveredBacklog);

    await orchestrator.executeSubtask(subtask);

    // VERIFY: reload read from the session directory
    expect(mockReadTasksJSON).toHaveBeenCalledWith('/plan/001_x');
    // VERIFY: the session registry was updated to the recovered backlog
    expect(currentSession.taskRegistry).toBe(recoveredBacklog);
    // VERIFY: the orchestrator's #backlog reflects the recovered registry (refreshBacklog ran)
    expect(orchestrator.backlog).toBe(recoveredBacklog);
  });
});
```

> **Test-design rationale:** the orchestrator test file is mock-only ("no real I/O is performed"), so we mock the `tasks-json-recovery` MODULE (`recoverTasksJson`) and assert the WIRING — invoked once per agent run, with the correct `{itemId,status}` + the pre-agent `baselineBacklog`, non-fatal, and that the reload happened. The actual corruption→git-restore mechanics (real tmpdir + real git) are already exhaustively unit-tested in S2's `tests/unit/core/tasks-json-recovery.test.ts`; S3 does not need to re-prove them. This matches both the file's architecture and the contract's named test file. The "agent corrupts tasks.json mid-run" scenario from the contract is exercised at the recovery-module level (S2); here the prpRuntime stub returning the tri-state outcomes stands in for the agent run, and the assertions prove recovery is invoked with the right contract regardless of outcome.

### Integration Points

```yaml
SOURCE (the change):
  - modify: src/core/task-orchestrator.ts
      + import { recoverTasksJson } from './tasks-json-recovery.js'   # S2
      + extend `import { atomicWrite } from './session-utils.js'` → + readTasksJSON
      + extend models type import → + SessionState
      + private async #recoverAfterAgentRun(itemId, result)  # status map + recoverTasksJson + reload + non-fatal
      + call `await this.#recoverAfterAgentRun(subtask.id, result)` inside executeSubtask's while(true), after executeWithRetry
  - modify: tests/unit/core/task-orchestrator.test.ts
      + extend session-utils vi.mock → + readTasksJSON
      + new module-level vi.mock('../../../src/core/tasks-json-recovery.js') → { recoverTasksJson }
      + import readTasksJSON + recoverTasksJson + mock handles
      + new describe('executeSubtask — smart recovery after agent run (PRD §5.1, R4 S3)') block (6 it cases)

NOT TOUCHED (scope guardrails):
  - src/core/tasks-json-recovery.ts        # S2 — consumed as-is (recoverTasksJson + TasksJsonRecoveryResult)
  - src/core/session-manager.ts            # reload via orchestrator-side readonly cast; NO method added
  - src/core/session-utils.ts              # CONSUMED (readTasksJSON) — unchanged
  - src/core/state-validator.ts            # unchanged
  - src/core/models.ts                     # CONSUMED (SessionState.readonly taskRegistry is why the cast is needed) — unchanged
  - src/tools/git-mcp.ts                   # S1 territory
  - src/config/constants.ts                # R4 adds NO env var (getIssueRetryMax already exists, reused)
  - src/agents/prp-runtime.ts              # unchanged (its stub returns ExecutionResult; S3 only READS it)
  - src/agents/prp-executor.ts             # unchanged (ExecutionResult type consumed structurally)
  - docs/ARCHITECTURE.md                   # S2 added the §5.1 narrative; S3 = Mode A "none beyond inline comments"
  - README.md, docs/WORKFLOWS.md           # Mode B → P5.M3
  - tests/unit/core/tasks-json-recovery.test.ts  # S2 territory
  - any other existing test file

PRODUCES (the contract this satisfies — closes R4):
  - TaskOrchestrator.executeSubtask now self-heals tasks.json after every agent run: legitimate delta applied,
    unauthorized mutations discarded, corrupt file restored from git history, session registry reloaded from disk,
    all non-fatally. R4 is complete (S1 primitives + S2 routine + S3 wiring all landed).

CONSUMES:
  - recoverTasksJson (tasks-json-recovery, S2)   # never throws; returns TasksJsonRecoveryResult
  - readTasksJSON (session-utils)                # reload from recovered disk (session dir)
  - getIssueRetryMax (config/constants)          # intended-status exhaustion boundary (already imported)
  - ExecutionResult (prp-executor) shape         # result.success + result.outcome (read structurally)
  - this.#logger / this.#backlog / this.#issueAttempts / this.sessionManager / refreshBacklog()  # existing
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After Task 2 (wiring):
npm run validate
# = npm run lint && npm run format:check && npm run typecheck
#   lint      = eslint . --ext .ts
#   format:check = prettier --check "**/*.{ts,js,json,md,yml,yaml}"
#   typecheck = tsc --noEmit -p tsconfig.build.json   (excludes tests/; typechecks the orchestrator change)
# Expected: zero errors. The change is small + type-neutral (the readonly-cast compiles cleanly).
# If prettier --check fails, run:
npm run format        # WRITES the prettier-compliant form
npm run validate      # re-check; expect zero errors.
# Common failure: forgetting the '.js' suffix on './tasks-json-recovery.js', OR a cast that doesn't compile.
```

### Level 2: Unit Tests (Component Validation)

```bash
# RED step (after Task 1, before Task 2) — MUST fail first (TDD):
npm run test:run -- task-orchestrator
# Expected: the 6 new it() cases FAIL (recoverTasksJson mock never called → toHaveBeenCalledTimes(1) fails). RED confirmed.

# GREEN step (after Task 2):
npm run test:run -- task-orchestrator
# Expected: all green — the 6 new it() cases + all ~120 existing orchestrator tests.

# Full suite (confirm no regression — esp. S2's tasks-json-recovery.test.ts):
npm run test:run
# Expected: all green.

# NOTE: vitest.config.ts coverage thresholds are 100% but coverage is enforced ONLY by `npm run test:coverage`,
# NOT by `npm run test:run` or `npm run validate`. Coverage is NOT a gate for this subtask.
```

### Level 3: Integration Testing (System Validation)

```bash
# Scope-guard regression check — confirm we did NOT over-reach:
git diff --stat
# Expected: ONLY src/core/task-orchestrator.ts + tests/unit/core/task-orchestrator.test.ts.

git diff src/core/tasks-json-recovery.ts src/core/session-manager.ts src/tools/git-mcp.ts src/config/constants.ts src/core/session-utils.ts src/core/state-validator.ts src/core/models.ts src/agents/prp-runtime.ts src/agents/prp-executor.ts docs/ARCHITECTURE.md README.md docs/WORKFLOWS.md
# Expected: EMPTY.

# Status-count regression check — recovery must NOT add updateItemStatus calls:
# The existing test "should set subtask status to Implementing then Complete" asserts updateItemStatus called
# exactly 3 times (Researching + Implementing + Complete). It MUST still pass.
npm run test:run -- task-orchestrator 2>&1 | grep -i "Implementing then Complete"
# Expected: the test passes (no extra status calls from recovery).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# NON-FATAL invariant — #recoverAfterAgentRun must NEVER rethrow:
grep -n "throw" src/core/task-orchestrator.ts
# Expected: the ONLY `throw error` is the EXISTING outer catch of executeSubtask (rethrows real execution errors).
#           #recoverAfterAgentRun must have NO throw/rethrow (its catch ends with a bare `}` / return).

# INTENDED-STATUS invariant — the three-way map is present:
grep -n "legitimateStatus\|nextIssueAttempt\|getIssueRetryMax" src/core/task-orchestrator.ts
# Expected: ≥3 matches inside #recoverAfterAgentRun (status map: Complete / Planned / Failed).

# BASELINE invariant — pre-agent #backlog is passed (not a disk-read backlog):
grep -n "baselineBacklog: this.#backlog" src/core/task-orchestrator.ts
# Expected: exactly 1 match inside #recoverAfterAgentRun.

# RELOAD invariant — readTasksJSON + readonly cast + refreshBacklog present:
grep -n "readTasksJSON\|as { taskRegistry: Backlog }\|refreshBacklog" src/core/task-orchestrator.ts
# Expected: readTasksJSON called once + the cast assignment + refreshBacklog() inside #recoverAfterAgentRun.

# CALL-SITE invariant — recovery runs inside the loop, once per agent run:
grep -n "#recoverAfterAgentRun" src/core/task-orchestrator.ts
# Expected: 2 matches — the method definition + the single call site inside executeSubtask's while(true).

# NON-READY invariant — no 'Ready' status introduced:
grep -rn "Ready" src/core/task-orchestrator.ts
# Expected: NO matches.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` passes (eslint + prettier --check + tsc --noEmit, zero errors).
- [ ] `npm run test:run` passes (all green; the 6 new `it` cases + every existing assertion).
- [ ] RED step observed before GREEN (the 6 new assertions failed before Task 2 — TDD).

### Feature Validation

- [ ] `recoverTasksJson` is invoked **once per agent run** inside `executeSubtask`'s loop (after `executeWithRetry`, before the tri-state branch).
- [ ] Intended status is correct: `success`→`Complete`, `fail`→`Failed`, `issue`(re-plan)→`Planned`, `issue`(exhausted)→`Failed`.
- [ ] `baselineBacklog: this.#backlog` (pre-agent snapshot) is passed → S2 PATH A discards unauthorized unrelated-item mutations.
- [ ] After recovery, the session registry is reloaded from the recovered disk (`readTasksJSON` → assign `taskRegistry` → `refreshBacklog()`).
- [ ] Non-fatal: a throwing `recoverTasksJson`/`readTasksJSON` is caught, logged, and execution continues to `Complete`/`Failed` + `smartCommit` + `flushUpdates` without `executeSubtask` throwing.
- [ ] No `updateItemStatus` calls added (existing status-count tests stay green).

### Code Quality Validation

- [ ] Reuses `recoverTasksJson` (S2) — no reimplemented status/git/parse logic.
- [ ] Reuses `readTasksJSON` (session-utils) for the reload — no new disk-read helper.
- [ ] Reload uses the readonly-cast idiom (mirrors `state-validator.ts` / S2's `setItemStatus`) — no `session-manager.ts` change.
- [ ] Follows existing orchestrator conventions (`this.#logger`, private `#`-method, `join`, async).
- [ ] Scope guardrails respected (tasks-json-recovery/session-manager/session-utils/git-mcp/constants/prp-executor/ARCHITECTURE.md untouched).

### Documentation & Deployment

- [ ] Concise inline comment at the call site + JSDoc on `#recoverAfterAgentRun` (Mode A "none beyond inline comments").
- [ ] No `docs/` edit (S2 already added the §5.1 narrative to `ARCHITECTURE.md`).
- [ ] No new environment variables (R4 uses the existing `getIssueRetryMax()`; recovery takes `opts`, not env).

---

## Anti-Patterns to Avoid

- ❌ Don't call recovery OUTSIDE the `while(true)` loop (after smartCommit/flushUpdates) — it must run **once per agent run**, i.e. inside the loop, so an `issue` that re-loops triggers recovery each iteration (PRD §5.1 "Re-apply after every agent run").
- ❌ Don't rely on `refreshBacklog()` alone to pick up the recovered disk — it re-reads **in-memory** only (implementation_notes §6). You MUST `readTasksJSON` → assign `taskRegistry` → `refreshBacklog()`.
- ❌ Don't add a method to `session-manager.ts` for the reload — use the readonly-cast idiom on `currentSession.taskRegistry` (keeps scope to `task-orchestrator.ts`).
- ❌ Don't pass a disk-read backlog as `baselineBacklog` — it MUST be `this.#backlog` (the orchestrator's pre-agent snapshot), else S2 PATH A cannot discard the agent's unauthorized unrelated-item mutations.
- ❌ Don't let `#recoverAfterAgentRun` rethrow — wrap the ENTIRE body in one outer try/catch → `logger.error` → return. A recovery/reload failure must never terminate the session (PRD §5.1). `recoverTasksJson` never throws, but the reload's `readTasksJSON` can (PATH-C corrupt disk).
- ❌ Don't add `updateItemStatus` calls inside recovery — it would break the existing status-transition-count tests. Recovery only calls `recoverTasksJson` + `readTasksJSON` + `refreshBacklog()`.
- ❌ Don't change the intended-status logic's exhaustion check away from `getIssueRetryMax()` — it must mirror the issue branch's own exhaustion boundary so recovery's status matches the subsequent `setStatus`.
- ❌ Don't mock `simple-git`/`node:fs` or use a real tmpdir in `task-orchestrator.test.ts` — the file is mock-only ("no real I/O is performed"). Mock the `tasks-json-recovery` MODULE and assert the wiring; the real corruption→git-restore coverage lives in S2's `tasks-json-recovery.test.ts`.
- ❌ Don't touch `docs/ARCHITECTURE.md` — the §5.1 narrative landed in S2; S3 is Mode A "none beyond inline comments" per the contract DOCS line.
