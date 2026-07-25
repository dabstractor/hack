# Research Summary — P4.M2.T4.S1: Standard full breakdown for bugfix sessions

> Research companion to `../PRP.md`. Documents the codebase findings and the
> design decisions that drove the PRP. Read this BEFORE implementing.

---

## 1. What exists today (the "simplified" bug-fix breakdown to be removed)

**File:** `src/workflows/fix-cycle-workflow.ts` (read in full).

- `FixCycleWorkflow` constructor takes `(sessionPath, prdContent, taskOrchestrator,
  sessionManager, researchConfig?)`. `sessionPath` is the **bugfix child** dir
  (e.g. `plan/003_xxx/bugfix/001_yyy`) and is validated by `validateBugfixSession`
  (must contain the substring `bugfix`).
- `run()` loop (4 phases, max 3 iterations):
  1. `createFixTasks()` — the SIMPLIFIED breakdown to replace.
  2. `executeFixes()` — loops `#fixTasks`, calls `taskOrchestrator.executeSubtask(fixTask)`.
  3. `retest()` — `new BugHuntWorkflow(...).run(sessionPath)`.
  4. `checkComplete()` — true when no critical/major bugs remain.
- **`createFixTasks()` (line ~216)**: `this.#fixTasks = testResults.bugs.map((bug, i) =>
  this.#createFixSubtask(bug, i))`.
- **`#createFixSubtask(bug, index)` (line ~589)**: MANUALLY builds a `Subtask` with:
  - `id = PFIX.M1.T{NNN}.S1` (zero-padded index),
  - hardcoded `severityToPoints` map (critical=13, major=8, minor=3, cosmetic=1),
  - a `context_scope` Markdown string embedding the bug fields,
  - `prd_selectors: []` (PRD §4.2), `dependencies: []`, `status: 'Planned'`.
  - **Does NOT use the Architect agent at all.** This is the "simplified bug-fix
    breakdown mode" the CONTRACT wants removed.
- State: `#fixTasks: Subtask[]` (private), exposed via test-only getter
  `_fixTasksForTesting`. `#testResults` loaded by `#loadBugReport()` from
  `resolve(sessionPath, 'TEST_RESULTS.md')` (parsed JSON, validated by
  `TestResultsSchema`).

## 2. The STANDARD decomposition path (what we reuse) — `PRPPipeline.decomposePRD()`

**File:** `src/workflows/prp-pipeline.ts` lines ~1017-1145.

Pattern (the exact mechanics to mirror in `FixCycleWorkflow`):
```ts
const { createArchitectAgent } = await import('../agents/agent-factory.js');
const { createArchitectPrompt } = await import('../agents/prompts/architect-prompt.js');
const sessionPath = this.sessionManager.currentSession!.metadata.path;
const architectAgent = createArchitectAgent();          // no-arg, Reasoning role (xhigh)
const architectPrompt = createArchitectPrompt(prdContent, sessionPath);
const result = await retryAgentPrompt(
  () => architectAgent.prompt(architectPrompt),
  { agentType: 'Architect', operation: 'decomposePRD' }
);
if (result.status === 'error') {
  throw new Error(`Architect agent failed: ${result.error?.message}`);
}
// THE FILE IS THE CONTRACT — the architect WROTE tasks.json to $TASKS_FILE:
const { readFile } = await import('node:fs/promises');
const { resolve } = await import('node:path');
const tasksPath = resolve(sessionPath, 'tasks.json');
const parsedBacklog = JSON.parse(await readFile(tasksPath, 'utf-8')) as Backlog;
await this.sessionManager.saveBacklog(parsedBacklog);   // ← DO NOT do this for bugfix (see §5)
```

Key supporting facts:
- `createArchitectPrompt(prdContent, sessionPath?)` (`src/agents/prompts/architect-prompt.ts`):
  substitutes `$TASKS_FILE → ${sessionPath}/tasks.json` and `$SESSION_DIR → sessionPath`
  inside `TASK_BREAKDOWN_PROMPT`, prepends `PRD_PREMERGED_DECLARATION` to the user
  prompt, and uses a permissive `responseFormat: z.unknown()` (the FILE is the
  contract, not the conversational response). **So passing the bugfix `sessionPath`
  makes the architect WRITE `tasks.json` into the bugfix child dir** — exactly what
  P4.M2.T4.S2 (resume interrupted breakdowns) needs.
- `createArchitectAgent()` (`src/agents/agent-factory.ts:354`): no-arg, returns an
  `Agent`; uses `TASK_BREAKDOWN_PROMPT` system + Reasoning role (xhigh budget, P2.M2.T1).
- `retryAgentPrompt<T>(fn, { agentType, operation })` (`src/utils/retry.ts:686`):
  the standard LLM retry wrapper (used by decomposePRD, prp-generator, validation).
- The Architect produces a **full Phase→Milestone→Task→Subtask hierarchy** stored
  as `Backlog` (`src/core/models.ts`). `BacklogSchema` is not re-validated here
  (decomposePRD does a bare `JSON.parse`); the file is the contract.

## 3. Flattening the hierarchy to subtasks (for the existing executeFixes loop)

**File:** `src/core/scope-resolver.ts`.
- `getLeafSubtasks(backlog)` (line ~250): DFS over `phase.milestones[].tasks[].subtasks[]`
  → all leaf `Subtask[]`.
- `topoSortByDependencies(items)` (line ~299): stable topo sort so dependencies
  precede dependents.
- `resolveScope(backlog, scope)` (line ~326): for `{ type: 'all' }` returns
  `topoSortByDependencies(getLeafSubtasks(backlog))` — i.e. **all subtasks in
  dependency order**. `parseScope('all')` yields `{ type: 'all' }`.
- This is the "standard" way to turn a decomposed Backlog into an ordered subtask
  list. We reuse it instead of re-implementing traversal.

## 4. Cleanup already runs for bug-fix (CONTRACT 3c) — keep executeFixes

**File:** `src/core/task-orchestrator.ts` `executeSubtask()` (~line 775, two-phase
commit block ~1050-1130) + `src/core/cleanup-runner.ts`.

- `executeFixes()` already calls `this.taskOrchestrator.executeSubtask(fixTask)` per
  fix task. `executeSubtask` IS the per-item execution that performs the **two-phase
  commit (P3.M1.T3.S2) + cleanup agent (P3.M1.T3.S3)**:
  1. SURVIVAL COMMIT — `smartCommit(sessionPath, \`${subtask.id}: ${subtask.title}\`, { generateMessage: true })`.
  2. CLEANUP — `this.#cleanupRunner({ sessionPath, subtask, repoRoot })` (default
     `createCleanupRunner()` → `createCleanupAgent()` persona). Non-fatal (swallowed).
  3. POST-CLEANUP COMMIT — `smartCommit(sessionPath, 'cleanup: doc reorganization', { generateMessage: true })` on cleanup success.
- **CONCLUSION:** CONTRACT (c) "ensure cleanup runs for bug-fix sessions" is ALREADY
  satisfied as long as we keep the `executeFixes()` → `executeSubtask()` loop. The
  change in THIS item only swaps the *source* of `#fixTasks` (architect decomposition
  instead of `#createFixSubtask`); it must NOT alter the executeSubtask path.

## 5. CRITICAL gotcha — DO NOT `saveBacklog` into the shared SessionManager

The bugfix child SHARES the parent's `sessionManager` + `taskOrchestrator` (passed
into the `FixCycleWorkflow` constructor from `prp-pipeline.runQACycle`). The
orchestrator's `#backlog` is a snapshot of the **parent** session's registry taken
once in its constructor. If we called `sessionManager.saveBacklog(bugfixBacklog)`
like `decomposePRD` does, we would **overwrite the parent session's taskRegistry**
with the bugfix tasks — corrupting the parent session state.

**Resolution:** the bugfix path keeps its OWN `tasks.json` in the bugfix child dir
(written by the architect via `$TASKS_FILE`), reads it back, flattens it to
`#fixTasks` via `resolveScope`, and executes each via `executeSubtask` — which takes
the subtask **directly** (it does not require the subtask to be in the registry; the
existing PFIX subtasks already prove this works). NEVER call `saveBacklog` /
`updateItemStatus` on the shared manager from the bugfix decomposition.

## 6. The mini-PRD: feed TEST_RESULTS.md as a PRD to the architect

The CONTRACT says "feed TEST_RESULTS.md as a mini-PRD to the architect agent
(`createArchitectPrompt` with TEST_RESULTS.md content)". `TEST_RESULTS.md` is JSON
(`TestResults`), and `TASK_BREAKDOWN_PROMPT` expects a Markdown PRD. So we build a
small Markdown mini-PRD FROM the parsed `TestResults` object (`this.#testResults`,
already validated by `TestResultsSchema`) — framing each bug as a fix requirement.
This is the semantic content of TEST_RESULTS.md in a form the LEAD TECHNICAL
ARCHITECT persona can decompose into a real Phase→Milestone→Task→Subtask hierarchy.

## 7. Test impact — `tests/unit/workflows/fix-cycle-workflow.test.ts`

- Top-level mocks today: `BugHuntWorkflow`, `node:fs/promises` (readFile/access/constants).
  Orchestrator built via `createMockTaskOrchestrator()` (`executeSubtask` spy).
  SessionManager via `createMockSessionManager()` (no saveBacklog — confirms §5).
- `describe('createFixTasks')` (~199-365): asserts PFIX IDs, story-points map,
  context_scope content. **These tests must be DELETED** — `#createFixSubtask` is gone.
- `describe('executeFixes')` (~365-443): calls `createFixTasks` then `executeFixes`,
  asserts `executeSubtask` call count. **Must be updated** to drive the new
  `runStandardBreakdown` (mock architect + tasks.json) before asserting executeSubtask.
- New mocks needed (dynamic-import-friendly via top-level `vi.mock` of the module
  path): `createArchitectAgent`, `createArchitectPrompt`, `retryAgentPrompt`,
  `resolveScope`/`parseScope`. The architect agent mock returns
  `{ status: 'success', data: '...' }`; `readFile` returns a fixture Backlog JSON
  for the `tasks.json` path and the TestResults JSON for the `TEST_RESULTS.md` path.
- `_fixTasksForTesting` getter STAYS (still returns `#fixTasks`, now the decomposed
  subtasks). `#loadBugReport` / `_loadBugReportForTesting` UNCHANGED.

## 8. Design decision summary

1. **Rename** `createFixTasks()` → `runStandardBreakdown()` (clearer; signals the
   simplified mode is gone). Update `run()` to call it.
2. **Remove** `#createFixSubtask(bug, index)` entirely (and its severity→points map).
3. **Add** `#buildBugFixMiniPrd(testResults): string` — Markdown mini-PRD from the
   parsed bug report.
4. **Implement** `runStandardBreakdown()`:
   - build mini-PRD; dynamic-import `createArchitectAgent`/`createArchitectPrompt`/
     `retryAgentPrompt`; run architect with `sessionPath = this.sessionPath` (bugfix
     child) so tasks.json lands in the bugfix dir; surface `result.status==='error'`;
     read back `${sessionPath}/tasks.json`; `JSON.parse` → `Backlog`; dynamic-import
     `resolveScope`/`parseScope` → flatten leaf subtasks in dependency order → `#fixTasks`.
   - **NEVER** `saveBacklog`/`updateItemStatus` on the shared manager (§5).
5. **Keep** `executeFixes()` (executeSubtask → two-phase commit + cleanup, CONTRACT c).
6. **Keep** `#fixTasks`, `_fixTasksForTesting`, `#loadBugReport`, retest/checkComplete.
7. Scope is EXACTLY `src/workflows/fix-cycle-workflow.ts` + its test file. No pipeline
   edit (runQACycle already constructs FixCycleWorkflow + copies TEST_RESULTS.md in).
   No constants/config/CLI/doc change (CONTRACT 5). No conflict with parallel
   P4.M2.T3.S1 (different file: bug-hunt-workflow.ts).

## 9. Confidence

High. The architect-decomposition mechanics are directly mirrored from the proven
`decomposePRD()`; execution/cleanup already work via `executeSubtask`; the only net
risk is the test rewrite, which is well-scoped by the existing factories + mocks.