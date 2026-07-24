# S4 Codebase Analysis — Forward PARALLEL_RESEARCH / RESEARCH_DEPTH to bugfix child

## Goal of this research
Pin the EXACT seam where `PARALLEL_RESEARCH` and `RESEARCH_DEPTH` must be
forwarded when bug hunting spawns a bugfix sub-pipeline (PRD §4.2 "Propagation
to Bugfix Sub-Pipeline"; §4.4). Produce file:line anchors + code snippets the
PRP can cite verbatim.

---

## FACT 1 — The bugfix "child" is IN-PROCESS, sharing the parent orchestrator

`src/workflows/prp-pipeline.ts` `runQACycle()` spawns the bugfix sub-pipeline as
a **new in-process `FixCycleWorkflow` instance**, NOT a subprocess:

```ts
// src/workflows/prp-pipeline.ts:1216-1251 (bugfix spawn block)
const { resolve } = await import('node:path');
const { mkdir, copyFile } = await import('node:fs/promises');
const bugfixSessionPath = resolve(sessionPath, 'bugfix');
await mkdir(bugfixSessionPath, { recursive: true });
const testResultsPath = resolve(sessionPath, 'TEST_RESULTS.md');
try {
  await copyFile(testResultsPath, resolve(bugfixSessionPath, 'TEST_RESULTS.md'));
} catch {
  await copyFile(
    resolve(sessionPath, 'bug_hunt_results.json'),
    resolve(bugfixSessionPath, 'TEST_RESULTS.md')
  ).catch(() => { /* nothing to copy */ });
}
this.logger.info(`[PRPPipeline] Bugfix session: ${bugfixSessionPath}`);

const fixCycleWorkflow = new FixCycleWorkflow(
  bugfixSessionPath,
  prdContent,
  this.taskOrchestrator,   // ← SAME parent orchestrator instance
  this.sessionManager
);
const fixResults = await fixCycleWorkflow.run();
```

CRITICAL CONSEQUENCE: the bugfix child **reuses the parent's `taskOrchestrator`**
(field `taskOrchestrator: TaskOrchestrator` on `FixCycleWorkflow` is assigned
the parent's instance; `executeFixes()` calls `this.taskOrchestrator.executeSubtask(fixTask)`
on the SHARED orchestrator). That orchestrator's `ResearchQueue` was constructed
once in its constructor (`task-orchestrator.ts:175-183`).

So in the *current* in-process model, `process.env.PARALLEL_RESEARCH` /
`process.env.RESEARCH_DEPTH` are already visible to the shared orchestrator's
`isParallelResearch()` / `getResearchDepth()` reads.

WHY FORWARD ANYWAY (the PRD mandate): PRD §4.2 says the settings "MUST be
forwarded to the child." Three reasons an explicit forward is still required:
1. **Contract compliance** — the PRD/contract item 3/OUTPUT is an observable
   forward, not "it happens to work because env is shared."
2. **Future-proofing** — §4.4 item 3 ("Resume interrupted breakdowns") and the
   `node dist/index.js --prd PRD.md --continue` re-entry hints
   (`prp-pipeline.ts:1680,1690`) show the architecture is moving toward a
   self-contained bugfix sub-pipeline that can be a separate process. An
   explicit forward (constructor params + explicit env set) survives that
   refactor; a silent env-share does not.
3. **Testability** — an explicit forward is unit-testable (assert the child
   received the values); a silent env-share is not.

---

## FACT 2 — FixCycleWorkflow constructor signature (the forward seam)

`src/workflows/fix-cycle-workflow.ts:120-128`:

```ts
constructor(
  sessionPath: string,
  prdContent: string,
  taskOrchestrator: TaskOrchestrator,
  sessionManager: SessionManager
)
```

There is NO options object. S4 adds an OPTIONAL 5th param
`researchConfig?: { parallelResearch: boolean; researchDepth: number }` so:
- existing callers (tests at `tests/integration/qa-agent.test.ts:830,883,947`,
  `tests/integration/fix-cycle-workflow-integration.test.ts`, and any others)
  keep working (param is optional);
- the bugfix spawn site passes the parent's current values explicitly;
- the values are stored on the instance and (defensively) re-applied to
  `process.env` so the shared orchestrator's live env reads stay correct even
  if a future refactor isolates the child process.

---

## FACT 3 — The shared orchestrator reads env LIVE via S1's helpers

After S2 lands, `src/core/task-orchestrator.ts` will import and call
`isParallelResearch()` / `getResearchDepth()` from `../config/constants.js`
(see P3M1T1S2/PRP.md Task 2). Those helpers (S1, ALREADY LANDED) read env live:

`src/config/constants.ts:320-333`:
```ts
export function getResearchDepth(): number {
  const raw = Number(process.env[RESEARCH_DEPTH] ?? DEFAULT_RESEARCH_DEPTH);
  if (Number.isNaN(raw) || raw <= 0) {
    return DEFAULT_RESEARCH_DEPTH;
  }
  return raw;
}
```

`src/config/constants.ts:359-361`:
```ts
export function isParallelResearch(): boolean {
  return process.env[PARALLEL_RESEARCH] === 'true';
}
```

So re-applying the parent's values to `process.env` inside the bugfix child's
constructor is the mechanism that makes the live reads correct — and is a
no-op when the env was already set (idempotent).

---

## FACT 4 — The only subprocess re-entry points today

`rg -n "node dist/index.js" src/` → two hits, both in `prp-pipeline.ts`:
- line 1680, 1690 — inside the **RESOURCE_LIMIT_REPORT.md** template string
  (a user-facing "how to resume" hint), NOT an actual `spawn()`. These are
  inert documentation strings.

`rg -n "spawn|execSync|child_process|fork\(" src/workflows/ src/core/` → no
real subprocess spawn of the pipeline. The bugfix child is purely in-process
today. (Agent invocations go through `src/agents/agent-factory.ts` /
`src/tools/bash-mcp.ts`, which is a different concern — agent runtime, not
pipeline re-entry.)

CONCLUSION: there is no subprocess env-passing seam to wire today. S4's
forward is constructor-param + explicit `process.env` re-set (defensive +
testable), satisfying the PRD mandate and surviving a future subprocess
refactor.

---

## FACT 5 — Test patterns to mirror

`tests/unit/workflows/prp-pipeline.test.ts`:
- Mocks `FixCycleWorkflow` at module level:
  ```ts
  // line 87-92
  vi.mock('.../fix-cycle-workflow.js', () => ({
    FixCycleWorkflow: vi.fn().mockImplementation(() => ({
      run: vi.fn().mockResolvedValue({ hasBugs: false, bugs: [] }),
    })),
  }));
  ```
- `runQACycle` tests at line 529+ construct a pipeline, inject a mock
  sessionManager, call `pipeline.runQACycle()`, and assert `currentPhase`.

S4 tests will:
1. In `prp-pipeline.test.ts` — assert the `FixCycleWorkflow` constructor mock
   was called with the forwarded research config (5th arg), with and without
   env set (vi.stubEnv).
2. In `fix-cycle-workflow.test.ts` — assert the new optional param is stored
   AND that `process.env.PARALLEL_RESEARCH` / `RESEARCH_DEPTH` are set inside
   the constructor when the param is provided (and untouched when omitted).

`tests/integration/qa-agent.test.ts:830,883,947` constructs
`new FixCycleWorkflow(sessionPath, prd, orch, sm)` with 4 args — the optional
5th param keeps these GREEN unchanged.

---

## FACT 6 — Validation gate

- `vitest.config.ts`: 100/100/100/100 thresholds on `src/**/*.ts`. Every new
  branch in the forward (param-provided vs omitted; env-set path) must be
  covered.
- `package.json`: `npm run validate` = lint + format:check + typecheck +
  test:run.
- No coverage impact on `task-orchestrator.ts` / `research-queue.ts` (S4 adds
  NO branches there — it only consumes S1/S2 helpers).

---

## FACT 7 — Scope fences (what S4 does NOT touch)

- S1 (DONE): the constants/helpers themselves — S4 IMPORTS them only.
- S2 (parallel, in-flight): orchestrator depth-chain logic — S4 does NOT touch
  `task-orchestrator.ts` or `research-queue.ts`; it only ensures the values
  those files read are present in the bugfix child.
- S3 (parallel, in-flight): RESEARCH_TIMEOUT docs — disjoint (timeout, not
  parallel/depth).
- READ-ONLY: `PRD.md`, `tasks.json`, `prd_snapshot.md`, `vitest.config.ts`.