# PRP — P4.M2.T4.S1: Standard full breakdown for bugfix sessions

---

## Goal

**Feature Goal**: Replace `FixCycleWorkflow`'s "simplified" bug-fix breakdown
(the hand-rolled `#createFixSubtask` that emits `PFIX.M1.T{NNN}.S1` subtasks with
a hardcoded severity→points map) with the **standard Architect-Agent decomposition
path** — the same Phase→Milestone→Task→Subtask decomposition a main session uses.
The QA bug report (`TEST_RESULTS.md`) is treated as a **mini-PRD** and fed to the
Architect agent via `createArchitectPrompt`; the architect writes a real
`tasks.json` into the bugfix session, which is flattened to ordered subtasks and
executed through the existing `executeSubtask` loop (which already runs the
two-phase commit + cleanup agent). This satisfies PRD §4.4 *"It treats the
`TEST_RESULTS.md` as a mini-PRD and runs the **standard full task breakdown** …
there is no separate 'simplified' bug-fix breakdown mode; cleanup runs for
bug-fix sessions just as for main sessions."*

**Deliverable** (1 modified workflow + 1 modified test file; **no** pipeline edit,
**no** config/constant change, **no** CLI flag, **no** new dependency, **no** doc
change):

1. **`src/workflows/fix-cycle-workflow.ts`** (MODIFY) —
   (a) REMOVE `#createFixSubtask(bug, index)` and the `severityToPoints` map;
   (b) RENAME `createFixTasks()` → **`runStandardBreakdown()`** and rewrite its body:
       build a Markdown mini-PRD from the loaded `TestResults`, run the standard
       `createArchitectAgent()` + `createArchitectPrompt(miniPrd, this.sessionPath)` +
       `retryAgentPrompt(...)` decomposition (mirroring `PRPPipeline.decomposePRD()`),
       read back `${sessionPath}/tasks.json`, `JSON.parse` → `Backlog`, flatten leaf
       subtasks in dependency order via `resolveScope(parseScope('all'))` into
       `#fixTasks`. Surface `{status:'error'}` agent failures;
   (c) ADD `#buildBugFixMiniPrd(testResults): string`;
   (d) UPDATE `run()` to call `runStandardBreakdown()` instead of `createFixTasks()`;
   (e) KEEP `executeFixes()`, `#fixTasks`, `_fixTasksForTesting`, `#loadBugReport`,
       `retest()`, `checkComplete()`.
2. **`tests/unit/workflows/fix-cycle-workflow.test.ts`** (MODIFY) — add module mocks
   for `createArchitectAgent` / `createArchitectPrompt` / `retryAgentPrompt` /
   `resolveScope` / `parseScope`; DELETE the obsolete `describe('createFixTasks')`
   block (PFIX IDs / story-points assertions are dead after `#createFixSubtask`
   removal); ADD a `describe('runStandardBreakdown')` block with full branch
   coverage (mini-PRD content, agent invoked with bugfix sessionPath, retry wrapper
   used, tasks.json read + flattened, agent-error throw, missing tasks.json throw,
   no-test-results throw); UPDATE `describe('executeFixes')` to drive
   `runStandardBreakdown` before asserting `executeSubtask` counts.

**Success Definition**:
- A bug-fix iteration runs the **standard Architect decomposition** on the bug
  report → produces a `tasks.json` in the bugfix session directory → flattens to
  ordered subtasks → executes each via `taskOrchestrator.executeSubtask` (which
  runs the two-phase commit + cleanup agent — CONTRACT c holds).
- The manual `PFIX.M1.T{NNN}.S1` / `severityToPoints` path is **gone**
  (`grep -n "PFIX\|createFixSubtask\|severityToPoints" src/workflows/fix-cycle-workflow.ts`
  returns nothing).
- The bugfix session directory ends up with a real `tasks.json` (consumed by the
  **next** item P4.M2.T4.S2 "resume interrupted breakdowns").
- `npm run validate` GREEN; `npm run test:coverage` stays 100% (new branches
  covered).
- `git diff --name-only` shows EXACTLY the 2 files above — **no** `prp-pipeline.ts`
  edit, **no** `constants.ts` edit, **no** change to `bug-hunt-workflow.ts` (parallel
  P4.M2.T3.S1 owns it), **no** `decomposePRD()` change.

---

## User Persona (if applicable)

**Target User**: A pipeline operator / engineer running a QA bug-hunt on a completed
session (or in `--bug-hunt` mode). When the QA agent finds bugs, the bug-fix
sub-pipeline must fix them.

**Use Case**: "Bugs were found → the bug-fix cycle should plan the fixes the SAME
way a brand-new PRD is planned: a real Architect decomposition into phases,
milestones, tasks, and subtasks — not a flat one-subtask-per-bug shortcut — and
each fix must go through the normal commit + cleanup so the repo never gets
stranded state."

**User Journey**: tasks complete (or `bug-hunt` mode) → `runQACycle` →
`BugHuntWorkflow` writes `TEST_RESULTS.md` → pipeline creates `bugfix/NNN_hash/`,
copies `TEST_RESULTS.md` in → `new FixCycleWorkflow(bugfixSessionPath, …)` →
`run()` → **`runStandardBreakdown()`** builds a mini-PRD from the bug report,
calls the Architect agent (writes `tasks.json` into the bugfix dir), flattens to
ordered subtasks → `executeFixes()` runs each via `executeSubtask` (survival
commit → cleanup agent → post-cleanup commit) → `retest()` → loop until clean.

**Pain Points Addressed**: today bug-fix uses a parallel, simplified planning mode
that (a) diverges from the main decomposition (no real hierarchy, no architect),
(b) emits fake `PFIX…` IDs that don't compose with the rest of the system, and
(c) leaves no `tasks.json` in the bugfix dir (blocking the resume-interrupted-
breakdown feature P4.M2.T4.S2). This item removes that divergence.

---

## Why

- **PRD compliance (§4.4 The Fix Cycle)**: *"It treats the `TEST_RESULTS.md` as a
  mini-PRD and runs the **standard full task breakdown** (the same
  Phase→Milestone→Task→Subtask decomposition as a main session) — there is no
  separate 'simplified' bug-fix breakdown mode; cleanup runs for bug-fix sessions
  just as for main sessions."* This item implements the breakdown half.
- **Work-item CONTRACT mapping**:
  - **(1) RESEARCH NOTE** — `architecture/phase_findings.md` §PHASE 4: *"Bugfix
    sub-pipeline: `FixCycleWorkflow` … → `createFixTasks` (bugs→PFIX subtasks) →
    `executeFixes` → `retest` → `checkComplete`."* Required change: *"Standard
    full breakdown for bugfix."* → this item delivers it.
  - **(2) INPUT** — *"No prior subtask output consumed."* → the mini-PRD input is
    the loaded `TestResults` (`#testResults` from `#loadBugReport`), not a prior
    subtask. (We consume `createArchitectAgent` / `createArchitectPrompt` /
    `retryAgentPrompt` / `resolveScope` — all existing exports, not subtask outputs.)
  - **(3) LOGIC**:
    - (a) replace `#createFixSubtask` with the standard decomposition path
          (`createArchitectPrompt` with `TEST_RESULTS.md` content) → `runStandardBreakdown`;
    - (b) the architect produces a standard Phase→Milestone→Task→Subtask hierarchy
          → `tasks.json` in the bugfix dir;
    - (c) cleanup runs for bug-fix sessions → already wired via `executeFixes` →
          `executeSubtask` (two-phase commit + cleanup agent P3.M1.T3); this item
          MUST NOT disturb that path;
    - (d) remove/deprecate the simplified bug-fix breakdown mode → delete
          `#createFixSubtask` + the `severityToPoints` map.
  - **(4) OUTPUT** — *"Bugfix uses standard full breakdown. Consumed by
    P4.M2.T4.S2."* → ✓ (the `tasks.json` left in the bugfix dir is exactly what
    S2's "report present, `tasks.json` missing/empty/corrupt" re-entry checks for).
  - **(5) DOCS** — *"none — no user-facing/config/API surface change."* → no doc edits.
- **Unblocks P4.M2.T4.S2 (resume interrupted breakdowns):** S2 auto-detects a
  bugfix dir that has a `TEST_RESULTS.md` but no `tasks.json` and re-enters the
  breakdown. That only works if THIS item makes breakdown write `tasks.json` into
  the bugfix dir — which it does (via `createArchitectPrompt(this.sessionPath)`).

---

## What

`FixCycleWorkflow` no longer hand-rolls fix subtasks. Each bug-fix iteration:

1. Builds a small Markdown **mini-PRD** from the loaded `TestResults`
   (`#buildBugFixMiniPrd`).
2. Runs the **standard Architect decomposition** (`createArchitectAgent` +
   `createArchitectPrompt(miniPrd, this.sessionPath)` + `retryAgentPrompt`) — the
   architect WRITES `tasks.json` into the bugfix child dir.
3. Reads that `tasks.json` back, parses it as a `Backlog`, and **flattens** the
   leaf subtasks in dependency order (`resolveScope(parseScope('all'))`).
4. Executes each subtask via the existing `executeFixes()` →
   `taskOrchestrator.executeSubtask()` loop (two-phase commit + cleanup agent).

The manual `#createFixSubtask` (and its `severityToPoints` map and `PFIX.M1.T…`
ID scheme) is **deleted**. `createFixTasks` is **renamed** `runStandardBreakdown`.

**No** new CLI flag, **no** config/constant edit, **no** `prp-pipeline.ts` edit
(`runQACycle` already constructs `FixCycleWorkflow` and copies `TEST_RESULTS.md`
into the bugfix dir), **no** change to `decomposePRD()`, **no** change to
`bug-hunt-workflow.ts` (parallel P4.M2.T3.S1), **no** new dependency, **no** doc
edit (CONTRACT 5).

### Success Criteria

- [ ] **`src/workflows/fix-cycle-workflow.ts`** — REMOVE `#createFixSubtask` +
      `severityToPoints`; RENAME `createFixTasks` → `runStandardBreakdown`; ADD
      `#buildBugFixMiniPrd`; wire `runStandardBreakdown` into `run()`. `executeFixes`,
      `#fixTasks`, `_fixTasksForTesting`, `#loadBugReport`, `retest`, `checkComplete`
      UNCHANGED.
- [ ] `runStandardBreakdown` builds a Markdown mini-PRD from the parsed
      `TestResults` (summary + each bug: id, severity, title, description,
      reproduction, location + recommendations) and passes it to
      `createArchitectPrompt(miniPrd, this.sessionPath)`.
- [ ] The Architect agent is created via `createArchitectAgent()` and invoked
      through `retryAgentPrompt(fn, { agentType: 'Architect', operation: 'decomposeBugReport' })`.
- [ ] A `{status:'error'}` agent response throws a clear error (mirrors
      `decomposePRD`); success reads `${this.sessionPath}/tasks.json`, `JSON.parse`s
      it as `Backlog`, and flattens leaf subtasks in dependency order via
      `resolveScope(backlog, parseScope('all'))` into `#fixTasks`.
- [ ] The bugfix path NEVER calls `sessionManager.saveBacklog` /
      `updateItemStatus` with bugfix tasks (the shared manager owns the PARENT
      registry — overwriting it corrupts the parent session).
- [ ] Cleanup still runs (CONTRACT c): `executeFixes` unchanged →
      `executeSubtask` → survival commit + cleanup agent + post-cleanup commit.
- [ ] **`tests/unit/workflows/fix-cycle-workflow.test.ts`** — add module mocks;
      DELETE `describe('createFixTasks')`; ADD `describe('runStandardBreakdown')`
      with full branch coverage; UPDATE `describe('executeFixes')`.
- [ ] `npm run validate` GREEN; `npm run test:coverage` 100%; `git diff --name-only`
      shows EXACTLY the 2 intended files.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed
to implement this successfully?" — YES. This PRP names: the EXACT methods to
remove/rename/add (`#createFixSubtask`, `createFixTasks`→`runStandardBreakdown`,
`#buildBugFixMiniPrd`); the EXACT standard-decomposition mechanics to mirror (with
a side-by-side reference to `decomposePRD()`); the EXACT seam in `run()`
(replace the `createFixTasks` call); the CRITICAL "never `saveBacklog` on the
shared manager" gotcha; the CRITICAL "keep `executeFixes`→`executeSubtask` so
cleanup keeps running" invariant; the flatten helper (`resolveScope`+`parseScope`);
and the precise test-rewrite requirements (new mocks, deleted block, new block).

### Documentation & References

```yaml
# MUST READ - Include these in your context window

- file: plan/008_15504f60a0ef/P4M2T4S1/research/00_research_summary.md
  why: THIS PRP's own research summary. Contains the side-by-side of the current
        simplified breakdown vs the standard decomposition, the §5 "never saveBacklog"
        gotcha proof, the flatten-helper decision, and the test-impact analysis.
        READ FIRST.

- file: src/workflows/fix-cycle-workflow.ts
  section: createFixTasks (:~216-238 — the method to RENAME/REWRITE);
           #createFixSubtask (:~589-640 — the method + severityToPoints map to DELETE);
           executeFixes (:~246-288 — UNCHANGED; calls executeSubtask per fix task);
           run() (:~369-445 — replace the `await this.createFixTasks()` call);
           #loadBugReport / #testResults (:~505-575 — source of the mini-PRD);
           _fixTasksForTesting getter (:~454 — KEEP).
  why: THE FILE THIS PRP MODIFIES. #createFixSubtask is the "simplified mode" to
        remove; createFixTasks is the method whose body becomes runStandardBreakdown.
  pattern: copy the @Step decorator + correlationLogger.info/error style for the
        new runStandardBreakdown body.
  gotcha: executeFixes MUST stay byte-identical (it is the cleanup entry point);
        do NOT add sessionManager.saveBacklog anywhere in the new code.

- file: src/workflows/prp-pipeline.ts
  section: decomposePRD() (:~1017-1145 — the STANDARD decomposition to mirror);
           runQACycle() (:~1469-1570 — constructs FixCycleWorkflow + copies
           TEST_RESULTS.md into the bugfix dir; NO edit needed here).
  why: decomposePRD is the reference implementation of the standard breakdown:
        dynamic-import createArchitectAgent/createArchitectPrompt → architectAgent.prompt
        via retryAgentPrompt → check result.status → read tasks.json → JSON.parse.
        Mirror it VERBATIM (minus saveBacklog — see gotcha).
  pattern: `const { createArchitectAgent } = await import('../agents/agent-factory.js');`
        + `const { createArchitectPrompt } = await import('../agents/prompts/architect-prompt.js');`
        + `retryAgentPrompt(() => architectAgent.prompt(prompt), { agentType: 'Architect', operation })`.
  gotcha: decomposePRD ends with `await this.sessionManager.saveBacklog(parsedBacklog)`.
        DO NOT copy that line into the bugfix path — the bugfix shares the parent
        sessionManager; overwriting its registry corrupts the parent session (§5).

- file: src/agents/prompts/architect-prompt.ts
  section: createArchitectPrompt(prdContent, sessionPath?) (:~58).
  why: THE standard-decomposition prompt builder. Passing `this.sessionPath` (the
        bugfix child dir) substitutes `$TASKS_FILE → ${sessionPath}/tasks.json` and
        `$SESSION_DIR → sessionPath` in TASK_BREAKDOWN_PROMPT, so the architect
        WRITES tasks.json into the bugfix dir (what P4.M2.T4.S2 consumes). The
        architect's real contract is the FILE it writes, not its response.
  gotcha: responseFormat is permissive z.unknown() BY DESIGN — do not tighten it.

- file: src/agents/agent-factory.ts
  section: createArchitectAgent() (:~354 — no-arg, Reasoning role / xhigh budget).
  why: THE standard architect factory. Same one decomposePRD uses → same budget.
  gotcha: create it ONCE per runStandardBreakdown call (not inside the retry
        closure) so every retry inherits the xhigh budget (mirrors decomposePRD's
        invariant comment).

- file: src/utils/retry.ts
  section: retryAgentPrompt<T>(fn, { agentType, operation }) (:~686).
  why: THE standard LLM-retry wrapper used by decomposePRD / prp-generator /
        validation. operation string goes into logs — use 'decomposeBugReport'.

- file: src/core/scope-resolver.ts
  section: resolveScope(backlog, scope) (:~326) + parseScope('all') (:~139) +
           getLeafSubtasks (:~250) + topoSortByDependencies (:~299).
  why: THE standard way to turn a decomposed Backlog into an ordered subtask list.
        resolveScope(backlog, parseScope('all')) returns
        topoSortByDependencies(getLeafSubtasks(backlog)) = all leaf Subtasks in
        dependency order. Reuse it instead of hand-rolling traversal.

- file: src/core/models.ts
  section: TestResults / Bug / BugSeverityEnum (:~1746) ; Backlog / Phase /
           Milestone / Task / Subtask (:~273-768) ; Status (:~175).
  why: TestResults/Bug drive #buildBugFixMiniPrd; the parsed tasks.json is a Backlog.
        Subtask fields: id, type:'Subtask', title, status, story_points,
        dependencies[], context_scope, prd_selectors[].

- file: tests/unit/workflows/fix-cycle-workflow.test.ts
  section: top-level mocks (:~31-41 BugHuntWorkflow + node:fs/promises);
           createMockTaskOrchestrator (:~95 executeSubtask spy);
           createMockSessionManager (:~103 — NOTE no saveBacklog: confirms §5);
           describe('createFixTasks') (:~199-365 — DELETE);
           describe('executeFixes') (:~365-443 — UPDATE);
           describe('run loop') (:~821+ — UPDATE if it drives createFixTasks).
  why: THE TEST FILE THIS PRP MODIFIES. New module mocks for the dynamic imports
        are required or runStandardBreakdown hits real modules. The createFixTasks
        block asserts PFIX IDs/story-points that no longer exist → delete it.
  pattern: mirror the existing vi.mock + hoisted-fn + import-and-cast style.

- file: src/core/task-orchestrator.ts
  section: executeSubtask() (:~775) + two-phase commit block (:~1050-1130).
  why: READ-ONLY proof that cleanup ALREADY runs for bug-fix via executeFixes →
        executeSubtask (survival commit + cleanupRunner + post-cleanup commit).
        CONTRACT c is satisfied as long as executeFixes is untouched.

- file: PRD.md   # §4.4 "The QA & Bug Hunt Loop" → "The Fix Cycle"
  section: §4.4 step 3 "The Fix Cycle (Self-Contained Sessions)" (verbatim in
           selected_prd_content) — the "standard full task breakdown" mandate.
  why: THE REQUIREMENT. Cite it in the runStandardBreakdown JSDoc.

- file: plan/008_15504f60a0ef/architecture/phase_findings.md
  section: §PHASE 4 "Current Bug Hunt Flow" + "Required Changes → Standard full
           breakdown for bugfix."
  why: THE RESEARCH NOTE the contract cites.
```

### Current Codebase tree (relevant slice)

```bash
src/workflows/
  fix-cycle-workflow.ts     # MODIFY — remove #createFixSubtask; rename createFixTasks
                           #   → runStandardBreakdown (architect decomposition); add
                           #   #buildBugFixMiniPrd; wire into run(). executeFixes UNCHANGED.
  bug-hunt-workflow.ts     # READ-ONLY (parallel P4.M2.T3.S1 owns it).
  prp-pipeline.ts          # READ-ONLY — decomposePRD (the pattern) + runQACycle (caller).
src/agents/
  agent-factory.ts         # READ-ONLY — createArchitectAgent (consumed).
  prompts/architect-prompt.ts  # READ-ONLY — createArchitectPrompt (consumed).
src/utils/
  retry.ts                 # READ-ONLY — retryAgentPrompt (consumed).
src/core/
  scope-resolver.ts        # READ-ONLY — resolveScope/parseScope (consumed).
  models.ts                # READ-ONLY — TestResults, Bug, Backlog, Subtask.
  task-orchestrator.ts     # READ-ONLY — executeSubtask (two-phase commit + cleanup).
tests/unit/workflows/
  fix-cycle-workflow.test.ts  # MODIFY — + module mocks; - createFixTasks block;
                              #   + runStandardBreakdown block; ~ executeFixes block.
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/workflows/fix-cycle-workflow.ts
  # - DELETE #createFixSubtask(bug, index) + the severityToPoints Record.
  # - RENAME createFixTasks() → runStandardBreakdown(); rewrite body:
  #     1. testResults = this.currentResults ?? this.#testResults; throw if null.
  #     2. miniPrd = this.#buildBugFixMiniPrd(testResults).
  #     3. dynamic-import createArchitectAgent/createArchitectPrompt/retryAgentPrompt.
  #     4. architectAgent = createArchitectAgent();
  #        prompt = createArchitectPrompt(miniPrd, this.sessionPath);
  #        result = await retryAgentPrompt(() => architectAgent.prompt(prompt),
  #                                        { agentType:'Architect', operation:'decomposeBugReport' });
  #     5. if (result.status === 'error') throw `Architect agent failed: …`.
  #     6. read resolve(this.sessionPath,'tasks.json'); JSON.parse → Backlog.
  #     7. dynamic-import resolveScope/parseScope;
  #        this.#fixTasks = resolveScope(backlog, parseScope('all')) as Subtask[].
  #     (NO saveBacklog / NO updateItemStatus — shared manager owns the PARENT registry.)
  # - ADD #buildBugFixMiniPrd(testResults): string  → Markdown framing the bugs as fix reqs.
  # - run(): replace `await this.createFixTasks();` with `await this.runStandardBreakdown();`.
  # - executeFixes / retest / checkComplete / #loadBugReport / #fixTasks /
  #   _fixTasksForTesting / constructor / researchConfig forwarding: UNCHANGED.
tests/unit/workflows/fix-cycle-workflow.test.ts
  # + vi.mock('../../../src/agents/agent-factory.js', () => ({ createArchitectAgent: vi.fn() }))
  # + vi.mock('../../../src/agents/prompts/architect-prompt.js', () => ({ createArchitectPrompt: vi.fn() }))
  # + vi.mock('../../../src/utils/retry.js', () => ({ retryAgentPrompt: vi.fn() }))
  # + vi.mock('../../../src/core/scope-resolver.js', () => ({ resolveScope: vi.fn(), parseScope: vi.fn() }))
  # - DELETE describe('createFixTasks') (PFIX id / story-points assertions are dead).
  # + describe('runStandardBreakdown') — mini-PRD content; agent called with
  #   bugfix sessionPath; retry wrapper used; tasks.json read + flattened; agent-error
  #   throw; missing tasks.json throw; no-test-results throw.
  # ~ describe('executeFixes') — drive runStandardBreakdown (mocked) before asserting
  #   executeSubtask counts; same for describe('run loop') if it used createFixTasks.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL (NEVER saveBacklog/updateItemStatus on the shared manager): the bugfix
//   child SHARES the parent's sessionManager + taskOrchestrator (passed into the
//   FixCycleWorkflow constructor from runQACycle). The orchestrator's #backlog is a
//   snapshot of the PARENT session's registry. decomposePRD ends with
//   `await this.sessionManager.saveBacklog(parsedBacklog)` — DO NOT copy that into
//   the bugfix path; it would overwrite the parent's taskRegistry with bugfix tasks.
//   The bugfix keeps its OWN tasks.json in its dir (the architect writes it via
//   $TASKS_FILE); flatten it to #fixTasks and execute via executeSubtask (which takes
//   the subtask directly and already works with non-registry subtasks — the existing
//   PFIX path proves it).

// CRITICAL (KEEP executeFixes byte-identical — it is the cleanup entry point):
//   CONTRACT (c) "cleanup runs for bug-fix sessions" is satisfied ONLY because
//   executeFixes calls taskOrchestrator.executeSubtask(fixTask), and executeSubtask
//   performs the two-phase commit (P3.M1.T3.S2) + cleanup agent (P3.M1.T3.S3). Do
//   NOT change executeFixes' loop or its executeSubtask call.

// CRITICAL (dynamic-import the architect deps — mirrors decomposePRD and avoids any
//   circular-import risk): use
//     const { createArchitectAgent } = await import('../agents/agent-factory.js');
//     const { createArchitectPrompt } = await import('../agents/prompts/architect-prompt.js');
//     const { retryAgentPrompt } = await import('../utils/retry.js');
//     const { resolveScope, parseScope } = await import('../core/scope-resolver.js');
//   exactly like decomposePRD. vi.mock at the top of the test file intercepts these
//   dynamic imports too (vitest mocks the resolved module path), so they ARE mockable.

// GOTCHA (the FILE is the architect's contract, not its response): createArchitectPrompt
//   uses responseFormat: z.unknown() and instructs the agent to WRITE tasks.json to
//   $TASKS_FILE and NOT emit it to the conversation. So read resolve(sessionPath,
//   'tasks.json') back after the prompt — do NOT use result.data as the backlog.

// GOTCHA (pass THIS.sessionPath, not the sessionManager path): createArchitectPrompt
//   substitutes $TASKS_FILE from its 2nd arg. For bugfix that arg MUST be
//   this.sessionPath (the bugfix child dir, e.g. plan/003_xxx/bugfix/001_yyy) so
//   tasks.json lands in the bugfix dir. decomposePRD uses sessionManager path because
//   it runs in the main session; do NOT copy that detail.

// GOTCHA (agent error surfaces as a non-throw {status:'error'}): Groundswell wraps
//   harness/LLM failures into { status:'error' } (no throw). Without the explicit
//   `if (result.status === 'error') throw` check (mirrors decomposePRD), a failed
//   agent leaves tasks.json unwritten and the readFile throws a confusing ENOENT.

// GOTCHA (createArchitectAgent ONCE, not inside the retry closure): mirrors
//   decomposePRD's invariant — create the agent before retryAgentPrompt so every
//   retry inherits the xhigh Reasoning budget. A fresh agent inside the closure could
//   rebind to a downgraded config.

// GOTCHA (ESM .js imports): intra-project dynamic imports use the .js extension
//   (e.g. '../agents/agent-factory.js'); node builtins use 'node:fs/promises' /
//   'node:path' (NO .js).

// GOTCHA (mini-PRD must be Markdown, not raw JSON): TEST_RESULTS.md is JSON
//   (TestResults). TASK_BREAKDOWN_PROMPT expects a Markdown PRD. Build a Markdown
//   mini-PRD from the parsed TestResults (summary + one section per bug: id,
//   severity, title, description, reproduction, location + recommendations). This is
//   the semantic content of TEST_RESULTS.md in a form the architect can decompose.

// GOTCHA (100% coverage gate): vitest.config.ts enforces 100% globally. New branches
//   in runStandardBreakdown: testResults-null throw; result.status==='error' throw;
//   tasks.json read success; tasks.json missing → ENOENT throw; JSON.parse. Cover ALL.

// GOTCHA (the createFixTasks test block MUST be deleted, not updated): it asserts
//   PFIX.M1.T001.S1 ids, the severityToPoints map (13/8/3/1), and context_scope
//   content — all of which vanish when #createFixSubtask is removed. Keeping stale
//   assertions = guaranteed failures. Replace with runStandardBreakdown tests.
```

---

## Implementation Blueprint

### Data models and structure

No new data models. The mini-PRD is a Markdown string. `TestResults`/`Bug`/`Backlog`/
`Subtask` already exist (`src/core/models.ts`). The decomposed tasks.json is a
`Backlog`; we flatten it to `Subtask[]` via the existing `resolveScope`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/workflows/fix-cycle-workflow.ts — ADD #buildBugFixMiniPrd()
  - IMPLEMENT (place just above runStandardBreakdown):
      /**
       * Build a Markdown mini-PRD from the QA bug report so the Architect agent can
       * run the standard Phase→Milestone→Task→Subtask decomposition on it (PRD §4.4:
       * TEST_RESULTS.md is treated as a mini-PRD).
       *
       * @param testResults - The loaded, schema-validated bug report.
       * @returns Markdown framing the bugs as fix requirements.
       * @private
       */
      #buildBugFixMiniPrd(testResults: TestResults): string {
        const lines: string[] = [];
        lines.push('# Bug Fix PRD (Mini-PRD from TEST_RESULTS.md)');
        lines.push('');
        lines.push('> PRD §4.4: the QA bug report is treated as a mini-PRD. Break this');
        lines.push('> down into a standard Phase→Milestone→Task→Subtask hierarchy of fixes.');
        lines.push('');
        lines.push('## Summary');
        lines.push(testResults.summary || '(no summary)');
        lines.push('');
        lines.push('## Bugs to Fix');
        lines.push('');
        for (const bug of testResults.bugs) {
          lines.push(`### ${bug.id} [${bug.severity}]: ${bug.title}`);
          lines.push(`**Description:** ${bug.description}`);
          lines.push(`**Reproduction:** ${bug.reproduction}`);
          lines.push(`**Location:** ${bug.location ?? 'Not specified'}`);
          lines.push('');
        }
        if (testResults.recommendations.length > 0) {
          lines.push('## Recommendations');
          for (const r of testResults.recommendations) {
            lines.push(`- ${r}`);
          }
          lines.push('');
        }
        return lines.join('\n');
      }
  - NOTE: `#` private methods are fine here (fix-cycle-workflow already uses `#fixTasks`,
    `#testResults`, `#loadBugReport`, `#extractCompletedTasks`). Keep the `#`.
  - SCOPE: helper only. No behavior wired yet.

Task 2: MODIFY src/workflows/fix-cycle-workflow.ts — REMOVE #createFixSubtask + map
  - DELETE the entire `#createFixSubtask(bug: Bug, index: number): Subtask { … }`
    method AND the inline `const severityToPoints: Record<Bug['severity'], number>`
    object inside it.
  - DELETE the now-unused import of `Bug` IF it is no longer referenced anywhere in
    the file (it WAS used only by #createFixSubtask's parameter type and the
    severityToPoints Record<Bug['severity'], …>). Verify with grep BEFORE deleting;
    KEEP the import if #buildBugFixMiniPrd or anything else still references Bug.
    (After Task 1, #buildBugFixMiniPrd iterates testResults.bugs — typed via
    TestResults — so `Bug` is likely unreferenced; but confirm and keep the type-only
    import if the compiler still needs it for `Bug` in the TestResults import block.)
  - ALSO drop `Subtask`/`Status` from the import line ONLY if truly unused after the
    rewrite — but they are still needed (#fixTasks: Subtask[], status casts). Leave
    imports alone unless `tsc --noEmit` flags an unused import (then trim).
  - SCOPE: deletion only. createFixTasks still references #createFixSubtask until Task 3,
    so expect a transient typecheck failure — resolved by Task 3.

Task 3: MODIFY src/workflows/fix-cycle-workflow.ts — RENAME createFixTasks → runStandardBreakdown
  - FIND the current createFixTasks method (the `@Step({ trackTiming: true }) async
    createFixTasks(): Promise<void> { … }` that does `this.#fixTasks = testResults.bugs.map(…)`).
  - REPLACE its entire body with the standard decomposition:
      @Step({ trackTiming: true })
      async runStandardBreakdown(): Promise<void> {
        this.logger.info(
          '[FixCycleWorkflow] Phase 1: Standard Architect breakdown of bug report'
        );
        const testResults = this.currentResults ?? this.#testResults;
        if (!testResults) {
          throw new Error('[FixCycleWorkflow] No test results available');
        }

        // (a) Build the mini-PRD from the QA bug report (PRD §4.4).
        const miniPrd = this.#buildBugFixMiniPrd(testResults);
        this.logger.info(
          `[FixCycleWorkflow] Built bug-fix mini-PRD (${miniPrd.length} chars) from ${testResults.bugs.length} bugs`
        );

        // (b) Standard decomposition: Architect agent over the mini-PRD, writing
        //     tasks.json into THIS bugfix session dir (createArchitectPrompt
        //     substitutes $TASKS_FILE → ${sessionPath}/tasks.json). Mirrors
        //     PRPPipeline.decomposePRD() verbatim, MINUS saveBacklog (the bugfix
        //     shares the parent sessionManager — overwriting its registry would
        //     corrupt the parent session).
        const { createArchitectAgent } =
          await import('../agents/agent-factory.js');
        const { createArchitectPrompt } =
          await import('../agents/prompts/architect-prompt.js');
        const { retryAgentPrompt } = await import('../utils/retry.js');

        // Create the architect ONCE (not in the retry closure) so every retry
        // inherits the xhigh Reasoning budget (mirrors decomposePRD invariant).
        const architectAgent = createArchitectAgent();
        const architectPrompt = createArchitectPrompt(miniPrd, this.sessionPath);

        this.logger.info('[FixCycleWorkflow] Calling Architect agent…');
        const result = await retryAgentPrompt(
          () => architectAgent.prompt(architectPrompt),
          { agentType: 'Architect', operation: 'decomposeBugReport' }
        );

        // Surface agent-level failures instead of a confusing later ENOENT.
        if (result.status === 'error') {
          const errMsg = result.error?.message ?? 'unknown agent error';
          throw new Error(`Architect agent failed: ${errMsg}`);
        }

        // (c) The FILE is the contract — the architect wrote tasks.json to
        //     ${this.sessionPath}/tasks.json. Read it back and parse as Backlog.
        const { readFile } = await import('node:fs/promises');
        const { resolve } = await import('node:path');
        const tasksPath = resolve(this.sessionPath, 'tasks.json');
        let parsedBacklog: Backlog;
        try {
          const tasksContent = await readFile(tasksPath, 'utf-8');
          parsedBacklog = JSON.parse(tasksContent) as Backlog;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `[FixCycleWorkflow] Failed to read/parse bugfix tasks.json at ${tasksPath}: ${msg}`
          );
          throw new Error(
            `Failed to read/parse bugfix tasks.json at ${tasksPath}: ${msg}`
          );
        }

        // (d) Flatten the standard Phase→Milestone→Task→Subtask hierarchy into
        //     dependency-ordered leaf subtasks (standard scope traversal).
        const { resolveScope, parseScope } =
          await import('../core/scope-resolver.js');
        this.#fixTasks = resolveScope(parsedBacklog, parseScope('all')) as Subtask[];

        this.logger.info(
          `[FixCycleWorkflow] Standard breakdown produced ${this.#fixTasks.length} fix subtasks`
        );
      }
  - NOTE: `Backlog` is ALREADY imported at the top of the file? CHECK — fix-cycle-workflow
    imports `Task, Subtask, Status` from models. ADD `Backlog` to that import line if
    missing (it is needed for the `parsedBacklog: Backlog` annotation). `TestResults`
    is already imported.
  - FOLLOW pattern: decomposePRD (dynamic imports → createArchitectAgent → prompt →
    retryAgentPrompt → status check → read tasks.json → parse).
  - GOTCHA: NO `await this.sessionManager.saveBacklog(parsedBacklog)` line (§5).
  - GOTCHA: pass `this.sessionPath` (bugfix child) to createArchitectPrompt.

Task 4: MODIFY src/workflows/fix-cycle-workflow.ts — WIRE runStandardBreakdown into run()
  - In run() (~:399), FIND:
        // Phase 1: Create fix tasks
        await this.createFixTasks();
  - REPLACE with:
        // Phase 1: Standard Architect breakdown of the bug report (PRD §4.4)
        await this.runStandardBreakdown();
  - PRESERVE: the iteration counter, the surrounding loop, executeFixes/retest/
    checkComplete calls, and the try/catch + setStatus. ONLY the method name changes.
  - GOTCHA: ensure NO other call site of createFixTasks remains (grep after edit).

Task 5: MODIFY tests/unit/workflows/fix-cycle-workflow.test.ts — ADD module mocks
  - ADD (near the existing top-level vi.mock calls, ~:31-41):
      vi.mock('../../../src/agents/agent-factory.js', () => ({
        createArchitectAgent: vi.fn(),
      }));
      vi.mock('../../../src/agents/prompts/architect-prompt.js', () => ({
        createArchitectPrompt: vi.fn(),
      }));
      vi.mock('../../../src/utils/retry.js', () => ({
        retryAgentPrompt: vi.fn(),
      }));
      vi.mock('../../../src/core/scope-resolver.js', () => ({
        resolveScope: vi.fn(),
        parseScope: vi.fn(),
      }));
    and import + cast them:
      import { createArchitectAgent } from '../../../src/agents/agent-factory.js';
      import { createArchitectPrompt } from '../../../src/agents/prompts/architect-prompt.js';
      import { retryAgentPrompt } from '../../../src/utils/retry.js';
      import { resolveScope, parseScope } from '../../../src/core/scope-resolver.js';
      const mockCreateArchitectAgent = createArchitectAgent as any;
      const mockCreateArchitectPrompt = createArchitectPrompt as any;
      const mockRetryAgentPrompt = retryAgentPrompt as any;
      const mockResolveScope = resolveScope as any;
      const mockParseScope = parseScope as any;
  - ADD a fixture builder for a decomposed Backlog (mirrors the Backlog model):
      const createFixBacklog = (subtaskIds: string[]): Backlog => ({
        backlog: [
          {
            id: 'P1', type: 'Phase', title: 'Bug Fix Phase', status: 'Planned',
            milestones: [
              {
                id: 'P1.M1', type: 'Milestone', title: 'Fixes', status: 'Planned',
                tasks: [
                  {
                    id: 'P1.M1.T1', type: 'Task', title: 'Fix reported bugs',
                    status: 'Planned', description: '', subtasks: subtaskIds.map(id => ({
                      id, type: 'Subtask', title: `Fix ${id}`, status: 'Planned',
                      story_points: 3, dependencies: [], context_scope: 'fix', prd_selectors: [],
                    })),
                  },
                ],
              },
            ],
          },
        ],
      });
  - In beforeEach, wire the decomposition happy path:
      mockCreateArchitectAgent.mockReturnValue({ prompt: vi.fn() });
      mockCreateArchitectPrompt.mockReturnValue({ /* prompt obj */ });
      // retryAgentPrompt just runs the supplied fn and returns the agent result:
      mockRetryAgentPrompt.mockImplementation(async (fn: any) => fn());
      mockResolveScope.mockReturnValue([]);  // overridden per-test
      mockParseScope.mockReturnValue({ type: 'all' });
      mockedReadFile.mockImplementation(async (p: any) => {
        // default: TEST_RESULTS.md → a TestResults JSON; tasks.json → a Backlog JSON
        if (String(p).endsWith('TEST_RESULTS.md')) return JSON.stringify(TEST_RESULTS_FIXTURE);
        if (String(p).endsWith('tasks.json')) return JSON.stringify(createFixBacklog(['P1.M1.T1.S1']));
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });
    (TEST_RESULTS_FIXTURE = a TestResults object with 1-2 bugs; reuse createTestBug.)
  - FOLLOW pattern: the existing vi.mock + import + cast style (mockedReadFile etc.).

Task 6: MODIFY tests/unit/workflows/fix-cycle-workflow.test.ts — DELETE createFixTasks block
  - DELETE the entire `describe('createFixTasks', () => { … })` block (~:199-365).
    Its assertions (PFIX.M1.T001.S1, story_points 13/8/3/1, context_scope content)
    are dead once #createFixSubtask is removed; keeping them guarantees failures.

Task 7: MODIFY tests/unit/workflows/fix-cycle-workflow.test.ts — ADD runStandardBreakdown block
  - ADD `describe('runStandardBreakdown', () => { … })` covering:
      (a) builds a Markdown mini-PRD containing each bug's id/severity/title/description/
          reproduction/location + the summary → assert createArchitectPrompt called with
          a string containing 'BUG-001', the severity, the title, and this.sessionPath.
      (b) creates the architect agent ONCE (mockCreateArchitectAgent called once) and
          invokes it through retryAgentPrompt with
          { agentType: 'Architect', operation: 'decomposeBugReport' }.
      (c) success → reads resolve(sessionPath,'tasks.json') → JSON.parse → flatten via
          resolveScope(backlog, parseScope('all')) → #fixTasks equals the flattened
          subtasks (assert via _fixTasksForTesting; have mockResolveScope return a
          2-subtask array and assert #fixTasks has length 2 with those ids).
      (d) result.status === 'error' → runStandardBreakdown throws 'Architect agent
          failed: …' (mock the architect agent's prompt to resolve
          { status:'error', error:{ message:'boom' } }).
      (e) tasks.json missing (readFile rejects ENOENT for the tasks.json path) → throws
          'Failed to read/parse bugfix tasks.json …'.
      (f) no test results (don't call _loadBugReportForTesting; currentResults null) →
          throws 'No test results available'.
      (g) does NOT call sessionManager.saveBacklog (assert the mock's saveBacklog is
          never called — guards the §5 invariant).
  - Drive each test: construct the workflow, await workflow._loadBugReportForTesting()
    (to populate #testResults) EXCEPT case (f), then await workflow.runStandardBreakdown().
  - FOLLOW pattern: the existing _loadBugReportForTesting + _fixTasksForTesting usage.

Task 8: MODIFY tests/unit/workflows/fix-cycle-workflow.test.ts — UPDATE executeFixes + run loop
  - In `describe('executeFixes')` (~:365-443) and any `describe('run loop')` test that
    called createFixTasks: replace `await workflow.createFixTasks();` with
    `await workflow.runStandardBreakdown();`. The executeSubtask-count assertions stay
    valid (runStandardBreakdown populates #fixTasks; executeFixes loops it). If a test
    relied on a SPECIFIC number of #fixTasks derived from bug count, re-derive it from
    the mocked resolveScope return value instead (e.g. mockResolveScope.mockReturnValue(
    [s1, s2]) → expect executeSubtask called 2×).
  - GOTCHA: ensure mockedReadFile's tasks.json branch returns a Backlog whose
    resolveScope mock matches the count the test asserts (keep them in sync).
  - FOLLOW pattern: keep the executeSubtask spy assertions; only swap the setup call.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (standard decomposition — mirror decomposePRD, MINUS saveBacklog):
const { createArchitectAgent } = await import('../agents/agent-factory.js');
const { createArchitectPrompt } = await import('../agents/prompts/architect-prompt.js');
const { retryAgentPrompt } = await import('../utils/retry.js');
const architectAgent = createArchitectAgent();            // ONCE, outside the retry closure
const architectPrompt = createArchitectPrompt(miniPrd, this.sessionPath);
const result = await retryAgentPrompt(
  () => architectAgent.prompt(architectPrompt),
  { agentType: 'Architect', operation: 'decomposeBugReport' }
);
if (result.status === 'error') {
  throw new Error(`Architect agent failed: ${result.error?.message ?? 'unknown'}`);
}
// The FILE is the contract (architect wrote $TASKS_FILE = ${sessionPath}/tasks.json):
const tasksPath = resolve(this.sessionPath, 'tasks.json');
const parsedBacklog = JSON.parse(await readFile(tasksPath, 'utf-8')) as Backlog;

// PATTERN (flatten the standard hierarchy to dependency-ordered subtasks):
const { resolveScope, parseScope } = await import('../core/scope-resolver.js');
this.#fixTasks = resolveScope(parsedBacklog, parseScope('all')) as Subtask[];
// resolveScope(backlog, {type:'all'}) == topoSortByDependencies(getLeafSubtasks(backlog))

// PATTERN (mini-PRD: Markdown framing of the parsed TestResults):
#buildBugFixMiniPrd(testResults: TestResults): string {
  // '# Bug Fix PRD (Mini-PRD from TEST_RESULTS.md)' + Summary + '## Bugs to Fix'
  // + one '### {id} [{severity}]: {title}' section per bug (description/repro/location)
  // + '## Recommendations' if any. See Task 1 for the exact body.
}

// ANTI-PATTERN (forbidden in the bugfix path — corrupts the PARENT session):
// await this.sessionManager.saveBacklog(parsedBacklog);   // ❌ NEVER
// await this.sessionManager.updateItemStatus(id, status); // ❌ NEVER
```

### Integration Points

```yaml
WORKFLOW (fix-cycle-workflow.ts):
  - REMOVE: #createFixSubtask + severityToPoints.
  - RENAME: createFixTasks → runStandardBreakdown (architect decomposition body).
  - ADD: #buildBugFixMiniPrd.
  - MODIFY run(): call runStandardBreakdown() instead of createFixTasks().
  - UNCHANGED: executeFixes (cleanup entry point), retest, checkComplete,
    #loadBugReport, #fixTasks, _fixTasksForTesting, constructor, researchConfig.

ARCHITECT (consumed, READ-ONLY):
  - createArchitectAgent() — agent-factory.ts (Reasoning role / xhigh budget).
  - createArchitectPrompt(prdContent, sessionPath) — architect-prompt.ts; passing
    this.sessionPath makes the architect write tasks.json into the bugfix dir.

EXECUTION (unchanged contract):
  - executeFixes → taskOrchestrator.executeSubtask(subtask) → two-phase commit
    (P3.M1.T3.S2) + cleanup agent (P3.M1.T3.S3). CONTRACT c holds.

PIPELINE (prp-pipeline.ts): NONE. runQACycle already constructs FixCycleWorkflow
  with the bugfix sessionPath and copies TEST_RESULTS.md into it. No edit.

CONFIG (constants.ts): NONE (no env-var / no new constant).

BUG-HUNT-WORKFLOW (bug-hunt-workflow.ts): NONE — owned by parallel P4.M2.T3.S1.

NO DATABASE / NO ROUTES / NO CLI FLAG / NO NEW DEPENDENCY / NO DOC EDITS (CONTRACT 5).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After editing fix-cycle-workflow.ts — fix before proceeding
npm run lint            # eslint . --ext .ts  (expected: zero errors)
npm run format:check    # prettier --check    (run `npm run format` to fix)
npm run typecheck       # tsc --noEmit -p tsconfig.build.json (expected: zero errors)

# Canonical CI gate
npm run validate        # = lint && format:check && typecheck && test:run

# Expected: Zero errors. READ the output and fix before proceeding.
# Watch for: unused imports after deleting #createFixSubtask (trim if tsc flags them).
```

### Level 2: Unit Tests (Component Validation)

```bash
# The modified workflow test (standard breakdown + regression)
npx vitest run tests/unit/workflows/fix-cycle-workflow.test.ts

# Full workflows suite (nothing else regressed)
npx vitest run tests/unit/workflows/

# Expected: All pass. If a test fails on PFIX/ createFixTasks remnants, you missed
# a Task-6/Task-8 update (delete/update the stale block).
```

### Level 3: Integration Testing (System Validation)

```bash
# Coverage gate — MUST stay 100% globally (vitest.config.ts)
npm run test:coverage
# Confirm the new branches (testResults-null throw; result.status==='error' throw;
# tasks.json read success; tasks.json missing ENOENT throw) are all covered.

# Grep guards — simplified mode is gone; standard path is present
grep -n "runStandardBreakdown\|#buildBugFixMiniPrd\|createArchitectPrompt\|resolveScope" \
  src/workflows/fix-cycle-workflow.ts
grep -n "createFixSubtask\|PFIX\|severityToPoints\|createFixTasks" \
  src/workflows/fix-cycle-workflow.ts          # Expected: NO matches (simplified mode gone)
grep -rn "createFixTasks" src/ tests/          # Expected: NO matches (fully renamed)

# §5 invariant guard — bugfix path must NOT saveBacklog/updateItemStatus
grep -n "saveBacklog\|updateItemStatus" src/workflows/fix-cycle-workflow.ts
# Expected: NO matches (the bugfix workflow never touches the shared manager's registry).

# Scope guard — only the 2 intended files changed
git diff --name-only
# Expected: src/workflows/fix-cycle-workflow.ts + tests/unit/workflows/fix-cycle-workflow.test.ts

# Expected: coverage 100%; grep guards clean; exactly 2 files changed.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Behavioral smoke (via a temporary vitest case if no direct .ts runner is configured):
#   1. runStandardBreakdown builds a mini-PRD whose content includes a bug's id,
#      severity, title, description, reproduction, location, and the summary.
#   2. createArchitectPrompt receives (miniPrd, bugfixSessionPath) — assert the 2nd
#      arg equals the bugfix child dir (so tasks.json lands there for P4.M2.T4.S2).
#   3. The architect result is read back from ${bugfixSessionPath}/tasks.json and the
#      flattened #fixTasks are dependency-ordered subtasks (ids like P1.M1.T1.S1).

# Cleanup-still-runs guard: executeFixes is byte-identical and still calls
# executeSubtask per fix task (the two-phase commit + cleanup entry point):
git diff src/workflows/fix-cycle-workflow.ts | grep -E "^[+-].*executeSubtask|^[+-].*executeFixes"
# Expected: NO diff lines touching executeFixes' executeSubtask call (only the
# runStandardBreakdown rename + #buildBugFixMiniPrd addition + #createFixSubtask removal).

# Expected: mini-PRD carries all bug fields; architect runs over the bugfix sessionPath;
# executeFixes/executeSubtask untouched (cleanup still runs).
```

---

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed successfully
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run)
- [ ] `npm run test:coverage` 100% (global gate — all new branches covered)
- [ ] No linting errors: `npm run lint`
- [ ] No type errors: `npm run typecheck`
- [ ] No formatting issues: `npm run format:check`

### Feature Validation

- [ ] `#createFixSubtask` + `severityToPoints` deleted; `createFixTasks` renamed to
      `runStandardBreakdown`
- [ ] `runStandardBreakdown` builds a Markdown mini-PRD from the parsed `TestResults`
      and passes it to `createArchitectPrompt(miniPrd, this.sessionPath)`
- [ ] Architect agent created via `createArchitectAgent()` and invoked through
      `retryAgentPrompt(fn, { agentType:'Architect', operation:'decomposeBugReport' })`
- [ ] A `{status:'error'}` agent response throws a clear `Architect agent failed: …`
- [ ] `${this.sessionPath}/tasks.json` is read back, parsed as `Backlog`, and flattened
      to dependency-ordered subtasks via `resolveScope(backlog, parseScope('all'))`
- [ ] The bugfix path NEVER calls `sessionManager.saveBacklog` / `updateItemStatus`
      (shared manager owns the PARENT registry — §5)
- [ ] Cleanup still runs: `executeFixes` byte-identical → `executeSubtask` (CONTRACT c)
- [ ] `run()` calls `runStandardBreakdown()`; no `createFixTasks` call sites remain
- [ ] The bugfix dir ends with a real `tasks.json` (consumed by P4.M2.T4.S2)

### Code Quality Validation

- [ ] Follows existing patterns (mirrors `decomposePRD` for the decomposition body)
- [ ] File placement matches the desired codebase tree (2 files only)
- [ ] Anti-patterns avoided (no `saveBacklog`; no `executeFixes` change; no real
      architect agent in unit tests; dynamic imports for architect deps)
- [ ] Dependencies properly managed (ESM `.js` intra-project dynamic imports; node
      builtins via `node:` prefix)
- [ ] JSDoc cites PRD §4.4 on `runStandardBreakdown` + `#buildBugFixMiniPrd`

### Documentation & Deployment

- [ ] CONTRACT (5): no doc edits (no user-facing/config/API surface change)
- [ ] No new environment variables
- [ ] Code is self-documenting (method names + JSDoc explain the standard breakdown)

---

## Anti-Patterns to Avoid

- ❌ Don't call `sessionManager.saveBacklog` / `updateItemStatus` in the bugfix path —
      the bugfix SHARES the parent sessionManager; overwriting its registry corrupts the
      parent session (§5). The bugfix keeps its own tasks.json in its dir.
- ❌ Don't change `executeFixes` or its `executeSubtask` call — that loop IS the
      two-phase-commit + cleanup entry point (CONTRACT c). Only swap the SOURCE of
      `#fixTasks` (architect decomposition vs `#createFixSubtask`).
- ❌ Don't pass `sessionManager.currentSession.metadata.path` to `createArchitectPrompt`
      — that is the PARENT path. Pass `this.sessionPath` (the bugfix child dir) so
      tasks.json lands where P4.M2.T4.S2 expects it.
- ❌ Don't create the architect agent INSIDE the `retryAgentPrompt` closure — create it
      once outside so every retry inherits the xhigh Reasoning budget (mirrors
      decomposePRD's invariant).
- ❌ Don't use `result.data` as the backlog — the FILE is the contract; read
      `${sessionPath}/tasks.json` back (the architect wrote it to `$TASKS_FILE`).
- ❌ Don't drop the `if (result.status === 'error') throw` check — Groundswell returns
      `{status:'error'}` (no throw) on LLM/harness failure; without the check a failed
      agent leaves tasks.json unwritten and the readFile throws a confusing ENOENT.
- ❌ Don't keep the `describe('createFixTasks')` test block — its PFIX-id / story-points
      assertions are dead after `#createFixSubtask` removal. Delete it (Task 6).
- ❌ Don't use static imports for `createArchitectAgent`/`createArchitectPrompt`/
      `retryAgentPrompt`/`resolveScope` — use dynamic `await import(...)` to mirror
      `decomposePRD` exactly and avoid any circular-import risk (vitest still mocks them
      via top-level `vi.mock` of the module path).
- ❌ Don't feed raw JSON to the architect — build a Markdown mini-PRD from the parsed
      `TestResults` so `TASK_BREAKDOWN_PROMPT` (which expects a Markdown PRD) can
      decompose it.