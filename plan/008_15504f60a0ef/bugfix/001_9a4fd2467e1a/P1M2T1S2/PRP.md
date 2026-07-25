# PRP — P1.M2.T1.S2: Implement added-requirement handling in `integrateIntoCurrentSessionResponse()` path

> Bugfix 001, **Issue 2 (MAJOR)** — integrate-path slice. With Issue 1 fixed
> (P1.M1.T1.S1 reorder + P1.M1.T1.S2 `mergeBacklogs` shared utility BOTH landed)
> the DEFAULT delta path (`spawnDeltaSession → decomposePRD`) generates tasks for
> ADDED requirements. The **integrate path** (`integrateIntoCurrentSessionResponse`,
> PRD §4.3 step 2 "Integrate into current session") does NOT create a delta session
> and does NOT call `decomposePRD`, so its added requirements are still silently
> dropped. This subtask closes that gap: after patching, if the delta has `'added'`
> changes, invoke the Architect over a focused Added-only delta PRD, read its
> `tasks.json`, and **merge** the new tasks into the just-saved patched backlog
> (reusing the `mergeBacklogs` utility from P1.M1.T1.S2). Architect failure is
> caught so modified/removed integration (already applied) is never aborted.

---

## Goal

**Feature Goal**: Make `integrateIntoCurrentSessionResponse()` generate tasks for
ADDED requirements by invoking the Architect over a focused delta PRD and merging
the result into the current session's backlog — closing the silent-drop gap in
the integrate path. The new behavior is **gated** on `delta.changes` containing
an `'added'` item (so deltas with only modified/removed are byte-equivalent to
today). The stale `GOTCHA` JSDoc note is removed and replaced with accurate Mode-A
documentation.

**Deliverable**:
1. **`src/workflows/prp-pipeline.ts`** — EDIT `integrateIntoCurrentSessionResponse()`
   (lines ~907-958): after the existing `saveBacklog(patchedBacklog)` (~947), insert
   a gated, try/catch-wrapped block that (a) filters `delta.changes` for `'added'`;
   (b) if any, renders a focused Added-only delta PRD via `renderDeltaPRD`, invokes
   the Architect (`createArchitectAgent` + `createArchitectPrompt` + `retryAgentPrompt`,
   mirroring `decomposePRD`), reads back `tasks.json`, and `mergeBacklogs(currentSession.taskRegistry, parsed)`
   → `saveBacklog(merged)`; on failure, logs a warn and re-asserts the patched backlog
   on disk. Remove the `GOTCHA` note from the method JSDoc and document the new
   added-req decomposition (Mode A). **Method signature unchanged.**
2. **`tests/unit/workflows/prp-pipeline-delta-response.test.ts`** — EDIT: add ONE
   focused `it()` under `describe('integrateIntoCurrentSessionResponse …')` (+ the
   `prompts/architect-prompt.js` mock + per-test architect/readFile configuration)
   proving an `'added'` delta invokes the Architect and merges new tasks. Implicit
   TDD: RED (no added-req handling yet) → GREEN.

**Success Definition**:
- A delta with ≥1 `'added'` change on the integrate path → the Architect is invoked
  with a focused Added-only delta PRD; its `tasks.json` output is read; the new tasks
  are merged into the patched backlog; `saveBacklog(merged)` persists the result;
  `refreshSnapshotToCurrentPRD` + `clearPendingDeltaHash` still run AFTER (ordering
  preserved); `currentPhase === 'delta_integrated'`.
- A delta with NO `'added'` changes (only modified/removed, or empty) → the new block
  is SKIPPED; behavior is byte-equivalent to today (the 3 existing integrate-path
  tests stay GREEN with zero edits).
- An Architect failure (error status / throw) during added-req decomposition → the
  modified/removed integration (already applied) is PRESERVED; the patched backlog is
  re-asserted on disk; a warn is logged; `refreshSnapshot` + `clearPendingDeltaHash`
  still run (the session is left consistent and the change is not silently swallowed).
- The `GOTCHA` JSDoc note is gone; the method JSDoc documents the added-req
  decomposition via Architect.
- `npm run typecheck && npm run lint && npm run format:check` clean; the targeted
  test file is GREEN; no regression in `delta-prd.test.ts` or the existing
  integrate-path tests.

---

## Why

- **Closes Issue 2's integrate-path half.** Issue 2 (PRD §4.3 step 6 "Adds new
  tasks") had TWO contributors: `patchBacklog`'s silent-drop (fixed by the parallel
  S1 — now a documented no-op delegating to the delta breakdown) AND the integrate
  path having no breakdown at all. S1 fixed the delta path's delegation; **S2 fixes
  the integrate path's actual generation**, which has no delta session to delegate to.
- **The integrate path has everything it needs already.** It resolves `newPRDResolved`,
  produces `delta.changes` (incl. `'added'`), and the `mergeBacklogs` utility (P1.M1.T1.S2)
  + the Architect-invocation pattern (`decomposePRD`) are both already in this file.
  S2 wires them together at the right seam — no new module, no new dependency.
- **PRD §4.3 step 2 parity.** "Integrate into current session" must fold NEW
  requirements into the running session's task hierarchy, not just modified/removed.
  Today it silently drops them (the very bug Issue 2 documents).
- **Graceful degradation.** The contract: "architect failure should not abort
  integration of modified/removed changes (which already succeeded)." S2's try/catch
  + disk re-assert guarantees modified/removed integration survives an Architect
  failure, leaving the session consistent.
- **Scope discipline.** S2 edits ONLY `prp-pipeline.ts` (integrate method + JSDoc)
  + adds ONE driving test. It does NOT touch `task-patcher.ts` (parallel S1),
  `backlog-merger.ts` (Complete — reuse only), `delta-prd.test.ts` (S3
  regression-locked), or `decomposePRD`. S3 owns the comprehensive cross-path suite.
- **Out of scope (hard boundary):** `patchBacklog`'s `'added'` case (S1), the
  `mergeBacklogs` implementation (P1.M1.T1.S2 — Complete), comprehensive unit tests
  for both paths (S3), `decomposePRD`/`spawnDeltaSession`, any `docs/*.md` (Mode A =
  JSDoc only), and the change-classifier wiring (separate work item).

---

## What

### User-visible behavior
When a user edits `PRD.md` to ADD a requirement on an active session and chooses
"Integrate into current session", the patched `tasks.json` now contains NEW tasks
for the added requirement (in addition to modified→Planned / removed→Obsolete
status patches). If the Architect fails mid-decomposition, the modified/removed
integration still lands and a warn is logged (the added requirement is skipped,
not silently dropped). No CLI surface change.

### Technical requirements (exact contract)

**Insertion point** — `src/workflows/prp-pipeline.ts`, `integrateIntoCurrentSessionResponse()`,
AFTER `await this.sessionManager.saveBacklog(patchedBacklog);` (~line 947) and
BEFORE `await refreshSnapshotToCurrentPRD(...)` (~line 951). Insert:

```ts
    // P1.M2.T1.S2: ADDED-requirement handling (PRD §4.3 step 6 "Adds new tasks").
    // patchBacklog handles only modified/removed (its 'added' case is a documented
    // no-op — added reqs need task GENERATION). If the delta has any 'added'
    // changes, invoke the Architect over a focused Added-only delta PRD and MERGE
    // its output into the just-saved patched backlog (same mergeBacklogs utility
    // as the delta path — P1.M1.T1.S2). Gated on added-changes so modified/removed
    // -only deltas are byte-equivalent to before. try/catch: an Architect failure
    // MUST NOT abort the modified/removed integration (already applied above); the
    // patched backlog is re-asserted on disk so the session stays consistent.
    const addedChanges = delta.changes.filter(c => c.type === 'added');
    if (addedChanges.length > 0) {
      try {
        const addedOnlyDelta: DeltaAnalysis = { ...delta, changes: addedChanges };
        const addedPrdContent = renderDeltaPRD(
          addedOnlyDelta,
          completedTaskIds,
          currentSession.metadata.id
        );

        // Dynamic imports mirror decomposePRD() (agent factory + prompt builder).
        const { createArchitectAgent } =
          await import('../agents/agent-factory.js');
        const { createArchitectPrompt } =
          await import('../agents/prompts/architect-prompt.js');
        const architectAgent = createArchitectAgent();
        const architectPrompt = createArchitectPrompt(addedPrdContent, sessionPath);

        this.logger.info(
          '[PRPPipeline] Decomposing added requirements via Architect (integrate path)'
        );
        const result = await retryAgentPrompt(
          () => architectAgent.prompt(architectPrompt),
          { agentType: 'Architect', operation: 'integrateAddedRequirements' }
        );
        if (result.status === 'error') {
          const errMsg = result.error?.message ?? 'unknown agent error';
          throw new Error(
            `Architect agent failed on added requirements: ${errMsg}`
          );
        }

        // The Architect writes tasks.json itself (createArchitectPrompt substitutes
        // $TASKS_FILE → {sessionPath}/tasks.json). Read it back + merge.
        const { readFile } = await import('node:fs/promises');
        const { resolve } = await import('node:path');
        const tasksPath = resolve(sessionPath, 'tasks.json');
        const tasksContent = await readFile(tasksPath, 'utf-8');
        const parsedBacklog = JSON.parse(tasksContent) as Backlog;

        // mergeBacklogs(patched, architect): patched is the BASE (modified/removed
        // statuses preserved); architect's added-req tasks are folded in. The
        // Architect's disk write bypassed SessionManager, so currentSession.taskRegistry
        // STILL holds the patched backlog here.
        const mergedBacklog = mergeBacklogs(
          this.sessionManager.currentSession!.taskRegistry,
          parsedBacklog
        );
        await this.sessionManager.saveBacklog(mergedBacklog);
        this.totalTasks = this.#countTasks();
        this.logger.info(
          `[PRPPipeline] Merged ${addedChanges.length} added requirement(s) into backlog`
        );
      } catch (error) {
        // Architect/read/parse/merge failure: preserve the modified/removed
        // integration that already succeeded. Re-assert the patched backlog on
        // disk in case the Architect clobbered tasks.json before failing.
        const errMsg = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[PRPPipeline] Added-requirement decomposition failed; modified/removed integration preserved: ${errMsg}`
        );
        await this.sessionManager.saveBacklog(
          this.sessionManager.currentSession!.taskRegistry
        );
      }
    }
```

**JSDoc (Mode A)** — replace the `GOTCHA` `@remarks` block on
`integrateIntoCurrentSessionResponse()` (lines ~901-906) — remove the GOTCHA
paragraph; add a remark documenting the added-req decomposition:

```diff
- * GOTCHA: `patchBacklog`'s `'added'` case is unimplemented
- * (task-patcher.ts) — added requirements are silently dropped. `modified`/
- * `removed` are handled. This is out of scope for this item; do not rely on
- * `'added'`.
+ * Added requirements: `patchBacklog` handles only `modified`/`removed`; its
+ * `'added'` case is an intentional no-op (added reqs need task GENERATION, which
+ * a sync pure function cannot do). When `delta.changes` contains any `'added'`
+ * item, this method invokes the Architect over a focused Added-only delta PRD
+ * (via `renderDeltaPRD`) and merges the resulting tasks into the patched backlog
+ * (`mergeBacklogs` — the same utility the delta path uses). An Architect failure
+ * is caught: the modified/removed integration (already applied) is preserved and
+ * the patched backlog is re-asserted on disk; the added requirement is skipped
+ * with a warn (never a silent drop).
```

**Method signature unchanged**: `private async integrateIntoCurrentSessionResponse(sessionPath: string): Promise<void>`.

### Success Criteria
- [ ] After `saveBacklog(patchedBacklog)`, a gated block checks `delta.changes` for `'added'`.
- [ ] With ≥1 `'added'` change: Architect invoked with a focused Added-only delta PRD
      (`renderDeltaPRD(filteredDelta, completedTaskIds, currentSession.metadata.id)` →
      `createArchitectPrompt`); its `tasks.json` read back; `mergeBacklogs(currentSession.taskRegistry, parsed)`
      → `saveBacklog(merged)`.
- [ ] With NO `'added'` change: block skipped; behavior byte-equivalent to before.
- [ ] Architect failure (error status or throw) → caught; patched backlog re-asserted
      on disk; warn logged; `refreshSnapshot` + `clearPendingDeltaHash` still run.
- [ ] `refreshSnapshotToCurrentPRD` + `clearPendingDeltaHash` still run AFTER the merge.
- [ ] The `GOTCHA` JSDoc note removed; new Mode-A remark documents the decomposition.
- [ ] Method signature unchanged; the 3 existing integrate-path tests stay GREEN.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; the targeted
      test file GREEN.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes** — the exact insertion point (after `saveBacklog(patchedBacklog)` ~947), the
verbatim code block, the canonical pattern to mirror (`decomposePRD` 1148-1230), the
verified fact that `mergeBacklogs`/`renderDeltaPRD`/`retryAgentPrompt` are ALREADY
imported (no new top-level imports), the gating fact that keeps existing tests green
(empty deltas), the try/catch disk-consistency invariant, the exact JSDoc diff, and
the test-mocking recipe (mirror `delta-prd.test.ts`). See
`research/integrate-added-req-handling.md` for the per-claim evidence.

### Documentation & References
```yaml
# MUST READ — the Issue-2 architecture decision (what S2 implements)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/architecture/delta_workflow.md
  section: "Issue 2 → 'Decision: Both Paths' (integrate-path bullet)"
  why: Prescribes the integrate-path fix: after patching, check for 'added' changes;
        if any, extract added PRD sections, invoke the architect, merge into the backlog.
  critical: patchBacklog's 'added' no-op is CORRECT only because BOTH paths now handle
        adds elsewhere — the delta path via decomposePRD (Issue 1), the integrate path via THIS subtask.

# MUST READ — this subtask's research (the traps + exact edit map)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P1M2T1S2/research/integrate-added-req-handling.md
  section: "2. mergeBacklogs is ALREADY a shared utility", "3. canonical pattern to mirror",
           "5. GATING fact", "6. try/catch disk-consistency", "7. Test mocking"
  why: Proves the merge utility already exists (S2 reuses, does NOT re-extract); gives the exact
        decomposePRD pattern to mirror; proves the gated block keeps existing tests green; the
        disk-restore invariant; and the delta-prd.test.ts mock recipe.

# CONTEXT — the dependency that makes the merge trivial (read, do NOT edit)
- file: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P1M1T1S2/PRP.md
  why: Created src/core/backlog-merger.ts exporting mergeBacklogs(patched, architect): Backlog
        (title-match phases/milestones; ID-de-dup tasks; patched statuses preserved). ALREADY
        imported in prp-pipeline.ts:73 and used by decomposePRD. S2 calls it; does NOT re-extract.
- file: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P1M2T1S1/PRP.md
  why: Parallel S1 makes patchBacklog's 'added' case a documented debug-log no-op (delegated to
        breakdown). S1 edits task-patcher.ts ONLY — file-disjoint from S2. S2's integrate-path
        generation is the OTHER half of Issue 2 (the half with no delta session to delegate to).

# THE FILE TO EDIT + the canonical pattern to mirror
- file: src/workflows/prp-pipeline.ts
  why: EDIT integrateIntoCurrentSessionResponse() (907-958): insert the gated added-req block after
        saveBacklog(patchedBacklog) (~947); remove the GOTCHA JSDoc (~901-906). MIRROR decomposePRD()
        (1148-1230) for the architect invocation: dynamic import createArchitectAgent +
        createArchitectPrompt; retryAgentPrompt(() => agent.prompt(prompt), {agentType,operation});
        check result.status==='error'; readFile tasks.json; JSON.parse as Backlog; mergeBacklogs.
  pattern: "const result = await retryAgentPrompt(() => architectAgent.prompt(architectPrompt), { agentType:'Architect', operation:'...' });"
  critical: renderDeltaPRD (session-utils:1386), retryAgentPrompt (utils/retry), mergeBacklogs
        (core/backlog-merger) are ALL ALREADY imported (prp-pipeline.ts:59,77,73) — NO new top-level
        imports. Only the two dynamic imports (agent-factory + architect-prompt) are added, mirroring decomposePRD.

# THE MERGE UTILITY (reuse — do NOT edit/re-extract)
- file: src/core/backlog-merger.ts
  why: export function mergeBacklogs(patched, architect): Backlog (line 207). Pure, sync; patched is
        the base (statuses preserved); architect's added-req tasks folded in (title-match phases/
        milestones, ID-de-dup tasks). Created by P1.M1.T1.S2 (Complete).
  gotcha: Do NOT re-extract or duplicate the merge logic. The contract's "extract the merge function
        to a shared utility" is ALREADY satisfied by P1.M1.T1.S2. S2 imports + calls mergeBacklogs.

# THE HELPERS (signatures verified)
- file: src/agents/agent-factory.ts
  why: createArchitectAgent(): Agent (line 354). Dynamically import (mirror decomposePRD line 1148).
- file: src/agents/prompts/architect-prompt.ts
  why: createArchitectPrompt(prdContent: string, sessionPath?: string): Prompt<unknown> (line 58).
        Substitutes $TASKS_FILE → {sessionPath}/tasks.json (the architect writes the CURRENT session's
        tasks.json, which the merge then reads back). Dynamically import (mirror decomposePRD line 1150).
- file: src/core/session-utils.ts
  why: renderDeltaPRD(delta, completedTaskIds, parentSessionId): string (line 1386). Already imported
        (prp-pipeline.ts:59). Renders Added/Modified/Removed sections; empty array → section omitted.
        So a filtered addedOnlyDelta yields a focused Added-only delta PRD.
- file: src/utils/retry.ts
  why: retryAgentPrompt(fn, { agentType, operation }) — already imported (prp-pipeline.ts:77).

# THE DATA MODEL
- file: src/core/models.ts
  why: DeltaAnalysis { changes: RequirementChange[]; patchInstructions; taskIds } (1670);
        RequirementChange { itemId; type:'added'|'modified'|'removed'; description; impact } (1569).
        Filtering delta.changes by type==='added' + spreading {...delta, changes:addedChanges} yields
        a valid focused DeltaAnalysis for renderDeltaPRD.

# PATTERN FILE — the test to extend + the architect mock recipe
- file: tests/unit/workflows/prp-pipeline-delta-response.test.ts
  why: ADD one it() under describe('integrateIntoCurrentSessionResponse …') (line 325). The file
        ALREADY mocks agent-factory.js (line 83), session-utils.js (55), node:fs/promises (38),
        task-patcher.js (123). It does NOT mock prompts/architect-prompt.js or backlog-merger.js.
  pattern: "MockDeltaAnalysisWorkflow.mockImplementation(() => ({ run: vi.fn().mockResolvedValue({changes:[{type:'added',...}], ...}) }))"
  gotcha: createArchitectAgent mock returns undefined by default → configure per-test to return
        { prompt: vi.fn().mockResolvedValue({ status:'success' }) }. mockReadFile returns '# Updated PRD'
        for every utf-8 read → override per-test to return valid Backlog JSON when path ends in 'tasks.json'
        (else JSON.parse throws inside the new block). Mirror the mock recipe from delta-prd.test.ts.
- file: tests/unit/core/delta-prd.test.ts
  why: The CANONICAL architect mock recipe (lines 28-36): vi.mock prompts/architect-prompt.js with
        createArchitectPrompt: vi.fn().mockReturnValue({user:'mock-architect-prompt'}); createArchitectAgent:
        vi.fn().mockReturnValue({ prompt: vi.fn().mockResolvedValue({ status:'success', output:'' }) }).
        Copy this recipe into the response-test for S2's new test.

# CONSUMERS (read-only — proves non-breaking)
- file: src/workflows/prp-pipeline.ts (decomposePRD, spawnDeltaSession)
  why: The delta-path siblings. decomposePRD is the canonical architect+merge pattern S2 mirrors.
        S2 does NOT edit them. spawnDeltaSession (default path) is unaffected by the integrate-path edit.
```

### Current Codebase tree (relevant slice)
```bash
src/workflows/prp-pipeline.ts                          # EDIT — integrateIntoCurrentSessionResponse() + JSDoc
src/core/backlog-merger.ts                             # REUSE (mergeBacklogs) — do NOT edit (P1.M1.T1.S2, Complete)
src/core/task-patcher.ts                               # UNCHANGED (parallel S1 owns the 'added' no-op)
tests/unit/workflows/prd-pipeline-delta-response.test.ts # EDIT — +1 focused it() + architect-prompt mock + per-test setup
```

### Desired Codebase tree with files to be added/edited
```bash
src/workflows/prp-pipeline.ts                          # MODIFIED (integrate method: gated added-req block + JSDoc)
tests/unit/workflows/prp-pipeline-delta-response.test.ts # MODIFIED (+1 it(), +architect-prompt mock, per-test architect/readFile config)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — mergeBacklogs ALREADY EXISTS as a shared utility (src/core/backlog-merger.ts:207,
//   P1.M1.T1.S2 Complete). It is ALREADY imported in prp-pipeline.ts:73. Do NOT re-extract, do NOT
//   duplicate, do NOT create a new merge module. S2 calls mergeBacklogs(currentSession.taskRegistry, parsed).
//   The contract's "extract the merge function to a shared utility" is ALREADY DONE.

// CRITICAL — GATE the new block on delta.changes.some(c => c.type === 'added'). The 3 existing
//   integrate-path tests (prp-pipeline-delta-response.test.ts:325-446) all use changes:[] deltas, so the
//   block is SKIPPED for them → they stay GREEN with zero edits. Without the gate, the architect mock
//   (returns undefined) would break them.

// CRITICAL — try/catch MUST re-assert the patched backlog on disk. The architect WRITES tasks.json itself
//   ($TASKS_FILE = {sessionPath}/tasks.json). If it clobbers tasks.json then fails, disk = garbage but
//   currentSession.taskRegistry STILL = patched (the architect's disk write bypasses SessionManager; only
//   saveBacklog syncs memory, and it last ran with patchedBacklog). In the catch:
//   await saveBacklog(currentSession.taskRegistry) restores disk = patched. Without this, a
//   clobber-then-fail orphans modified/removed integration on the next load.

// CRITICAL — INSERT AFTER saveBacklog(patchedBacklog) and BEFORE refreshSnapshotToCurrentPRD. The
//   "ordering contract" test (line 417) asserts saveBacklog precedes refreshSnapshot; the new block's
//   saveBacklog(merged) also precedes refresh, so ordering holds. Do NOT move refresh earlier.

// CRITICAL — MIRROR decomposePRD() for the architect invocation. Same dynamic imports (agent-factory +
//   architect-prompt), same retryAgentPrompt wrapper, same result.status==='error' check, same readFile
//   of {sessionPath}/tasks.json, same JSON.parse as Backlog, same mergeBacklogs(currentSession.taskRegistry, parsed).
//   Do NOT invent a new invocation style.

// CRITICAL — createArchitectAgent() is created ONCE (outside any retry closure), then retryAgentPrompt
//   re-invokes the SAME instance (PRD §6.1 "same budget" invariant — see decomposePRD comment lines 1155-1162).
//   Do NOT move createArchitectAgent() inside the retry closure.

// GOTCHA — renderDeltaPRD, retryAgentPrompt, mergeBacklogs are ALL ALREADY imported in prp-pipeline.ts
//   (lines 59, 77, 73). NO new top-level imports. Only the two dynamic imports inside the block.

// GOTCHA — bugfix Issue 3: the FULL npm run test:run is PRE-EXISTING-RED (297 failures, P2/P3 scope).
//   Do NOT use it as the gate. Gate = typecheck + lint + format:check + the TARGETED
//   prp-pipeline-delta-response.test.ts (and delta-prd.test.ts regression).

// GOTCHA — 100% coverage is globally enforced (vitest.config.ts). prp-pipeline.ts is a large file
//   already covered by many suites; the new lines are exercised by S2's new test (added→merge success)
//   + the existing tests (no-added→skip). The catch branch needs a test (architect-throws → patched
//   re-asserted) for coverage. If global coverage drops, add the catch-path test.

// GOTCHA — prettier is ERROR-enforced (format:check). Run `npm run fix` before validate. The multi-line
//   block + JSDoc diff may reflow — let `npm run fix` handle it.

// CRITICAL — DO NOT touch task-patcher.ts (parallel S1), backlog-merger.ts (Complete P1.M1.T1.S2 — reuse),
//   delta-prd.test.ts (S3 regression-locked), decomposePRD/spawnDeltaSession, or any docs/*.md (Mode A =
//   JSDoc only). S2's blast radius = integrateIntoCurrentSessionResponse() + its JSDoc + 1 driving test.
```

---

## Implementation Blueprint

### Data models and structure
No new data models. S2 consumes `DeltaAnalysis`/`RequirementChange` (models.ts:1569/1670),
`Backlog`, and the existing `mergeBacklogs`/`renderDeltaPRD`/`createArchitectAgent`/
`createArchitectPrompt`/`retryAgentPrompt`. The only "structure" is the gated block
(verbatim above) + the JSDoc diff.

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)
```yaml
Task 1: EDIT tests/unit/workflows/prp-pipeline-delta-response.test.ts  (RED — add the architect-prompt mock + a driving test)
  - ADD near the existing mocks (after line 83 agent-factory mock): mirror delta-prd.test.ts:
        vi.mock('../../../src/agents/prompts/architect-prompt.js', () => ({
          createArchitectPrompt: vi.fn().mockReturnValue({ user: 'mock-architect-prompt' }),
        }));
    (createArchitectAgent is already vi.fn() at line 83 — configure it per-test below.)
  - ADD an it() under describe('integrateIntoCurrentSessionResponse …') (after line 446):
      it('invokes the Architect and merges new tasks when the delta has an added requirement', async () => {
        // SETUP — a delta with an 'added' change; architect returns success; readFile returns a valid
        // Backlog JSON for tasks.json (path-discriminating).
        const session = createTestSession(createTestBacklog([]), '# Original PRD');
        const { pipeline, mockManager } = buildPipeline(session, { integratePrdChanges: true });
        // delta with an added change
        MockDeltaAnalysisWorkflow.mockImplementation(() => ({
          run: vi.fn().mockResolvedValue({
            changes: [{ itemId: 'P9', type: 'added', description: 'New feature', impact: 'new tasks' }],
            patchInstructions: 'add', taskIds: [],
          }),
        }));
        // architect returns success
        const { createArchitectAgent } = await import('../../../src/agents/agent-factory.js');
        (createArchitectAgent as any).mockReturnValue({
          prompt: vi.fn().mockResolvedValue({ status: 'success', output: '' }),
        });
        // readFile returns a valid Backlog JSON when reading tasks.json
        const architectBacklog = { backlog: [{ id:'P9', type:'Phase', title:'New', status:'Planned',
          description:'d', milestones: [] }] };
        mockReadFile.mockImplementation((path, encoding) =>
          String(path).endsWith('tasks.json') && encoding === 'utf-8'
            ? Promise.resolve(JSON.stringify(architectBacklog))
            : encoding === 'utf-8' ? Promise.resolve('# Updated PRD')
                                   : Promise.resolve(Buffer.from('# Updated PRD','utf-8'))
        );
        // EXECUTE
        await pipeline.handleDelta();
        // VERIFY: architect invoked; mergeBacklogs folded the new phase in; saveBacklog(merged) ran.
        expect((createArchitectAgent as any)).toHaveBeenCalled();
        expect(mockManager.saveBacklog).toHaveBeenCalled();
        // The LAST saveBacklog call carried the MERGED backlog (P9 appended).
        const lastSaved = mockManager.saveBacklog.mock.calls.at(-1)[0];
        expect(lastSaved.backlog.some(p => p.id === 'P9')).toBe(true);
        // VERIFY: snapshot refreshed + marker cleared AFTER (integration succeeded).
        expect(mockWriteFile).toHaveBeenCalledWith(resolve(session.metadata.path,'prd_snapshot.md'), '# Updated PRD', {mode:0o644});
        expect(mockUnlink).toHaveBeenCalledWith(resolve(session.metadata.path, PENDING_DELTA_HASH_FILE));
        expect(pipeline.currentPhase).toBe('delta_integrated');
      });
  - OPTIONAL second it() (for the catch-branch coverage): architect returns {status:'error'} →
      modified/removed integration preserved (patched backlog re-asserted), warn logged, snapshot still
      refreshed. (If coverage of the catch is needed, add this; else S3 covers it.)
  - EXPECTED NOW: the first it() FAILS (no added-req block yet → P9 NOT merged → assertion fails) → RED.
    NOTE: the existing 3 integrate tests (changes:[]) are UNAFFECTED (gated block skipped) → still green.

Task 2: EDIT src/workflows/prp-pipeline.ts  (GREEN — the gated added-req block)
  - In integrateIntoCurrentSessionResponse(), AFTER `await this.sessionManager.saveBacklog(patchedBacklog);`
    (~947) and BEFORE `await refreshSnapshotToCurrentPRD(...)` (~951), insert the verbatim block from
    "Technical requirements" (filter addedChanges → if >0, try { renderDeltaPRD(addedOnlyDelta,…) →
    createArchitectAgent + createArchitectPrompt → retryAgentPrompt → status check → readFile tasks.json →
    JSON.parse → mergeBacklogs(currentSession.taskRegistry, parsed) → saveBacklog(merged) } catch { warn +
    saveBacklog(currentSession.taskRegistry) }).
  - Use the dynamic imports INSIDE the block (mirror decomposePRD lines 1148-1153) — do NOT add top-level
    imports (renderDeltaPRD/retryAgentPrompt/mergeBacklogs are already imported at 59/77/73).
  - EXPECTED: Task 1's first it() turns GREEN (P9 merged in); the 3 existing integrate tests stay GREEN
    (gated skip). delta-prd.test.ts unaffected (different file/path).

Task 3: EDIT src/workflows/prp-pipeline.ts  (JSDoc — Mode A)
  - Remove the GOTCHA @remarks block on integrateIntoCurrentSessionResponse() (~901-906) and replace with
    the added-req decomposition remark (verbatim diff in "Technical requirements").
  - DO NOT change the method signature, the @param, or any other JSDoc.
  - EXPECTED: no behavior change; typecheck/format pass.

Task 4: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/workflows/prp-pipeline-delta-response.test.ts   # incl. the new it() + the 3 existing → GREEN.
  - RUN: npx vitest run tests/unit/core/delta-prd.test.ts                          # regression — MUST stay green.
  - DO NOT run the full `npm run test:run` (pre-existing red — bugfix Issue 3, P2/P3 scope).
  - EXPECTED: typecheck/lint/format clean; response-test green (4 integrate it()s); delta-prd green.
    If the new it() fails on "P9 not merged", the merge didn't run (check the gate + the architect mock).
    If a coverage drop appears on prp-pipeline.ts, add the catch-branch it() (Task 1 optional).
```

### Implementation Patterns & Key Details
```ts
// ---- src/workflows/prp-pipeline.ts: the gated block (verbatim — see "Technical requirements") ----
// (Inserted after `await this.sessionManager.saveBacklog(patchedBacklog);` and before refreshSnapshot.)
const addedChanges = delta.changes.filter(c => c.type === 'added');
if (addedChanges.length > 0) {
  try {
    const addedOnlyDelta: DeltaAnalysis = { ...delta, changes: addedChanges };
    const addedPrdContent = renderDeltaPRD(addedOnlyDelta, completedTaskIds, currentSession.metadata.id);
    const { createArchitectAgent } = await import('../agents/agent-factory.js');
    const { createArchitectPrompt } = await import('../agents/prompts/architect-prompt.js');
    const architectAgent = createArchitectAgent();
    const architectPrompt = createArchitectPrompt(addedPrdContent, sessionPath);
    const result = await retryAgentPrompt(() => architectAgent.prompt(architectPrompt),
      { agentType: 'Architect', operation: 'integrateAddedRequirements' });
    if (result.status === 'error') throw new Error(`Architect agent failed on added requirements: ${result.error?.message ?? 'unknown'}`);
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const parsedBacklog = JSON.parse(await readFile(resolve(sessionPath, 'tasks.json'), 'utf-8')) as Backlog;
    const mergedBacklog = mergeBacklogs(this.sessionManager.currentSession!.taskRegistry, parsedBacklog);
    await this.sessionManager.saveBacklog(mergedBacklog);
    this.totalTasks = this.#countTasks();
  } catch (error) {
    this.logger.warn(`[PRPPipeline] Added-requirement decomposition failed; modified/removed integration preserved: ${error instanceof Error ? error.message : String(error)}`);
    await this.sessionManager.saveBacklog(this.sessionManager.currentSession!.taskRegistry); // re-assert patched
  }
}

// ---- tests/unit/workflows/prp-pipeline-delta-response.test.ts: the architect-prompt mock (add near line 83) ----
vi.mock('../../../src/agents/prompts/architect-prompt.js', () => ({
  createArchitectPrompt: vi.fn().mockReturnValue({ user: 'mock-architect-prompt' }),
}));

// ---- the driving test: configure createArchitectAgent + path-discriminating readFile (per-test) ----
const { createArchitectAgent } = await import('../../../src/agents/agent-factory.js');
(createArchitectAgent as any).mockReturnValue({
  prompt: vi.fn().mockResolvedValue({ status: 'success', output: '' }),
});
mockReadFile.mockImplementation((path, encoding) =>
  String(path).endsWith('tasks.json') && encoding === 'utf-8'
    ? Promise.resolve(JSON.stringify({ backlog: [{ id:'P9', type:'Phase', title:'New', status:'Planned', description:'d', milestones: [] }] }))
    : encoding === 'utf-8' ? Promise.resolve('# Updated PRD') : Promise.resolve(Buffer.from('# Updated PRD', 'utf-8'))
);
```

### Integration Points
```yaml
PRP-PIPELINE.TS (src/workflows/prp-pipeline.ts):
  - integrateIntoCurrentSessionResponse(): insert gated added-req block after saveBacklog(patchedBacklog);
    remove GOTCHA JSDoc; add Mode-A added-req decomposition remark.
  - PRESERVE: method signature; the resolvePRD/DeltaAnalysisWorkflow/patchBacklog/saveBacklog/refreshSnapshot/
    clearPendingDeltaHash sequence; decomposePRD + spawnDeltaSession (untouched).
  - NO new top-level imports (renderDeltaPRD:59, retryAgentPrompt:77, mergeBacklogs:73 already imported);
    only dynamic imports inside the block (mirror decomposePRD).

BACKLOG-MERGER.TS (src/core/backlog-merger.ts): REUSE mergeBacklogs — do NOT edit/re-extract (P1.M1.T1.S2 Complete).

TEST (tests/unit/workflows/prp-pipeline-delta-response.test.ts):
  - +vi.mock(prompts/architect-prompt.js); +1 driving it() (added→architect→merge); per-test
    createArchitectAgent + path-discriminating readFile config. PRESERVE the 3 existing integrate tests.

DOCS (Mode A — JSDoc rides with the work):
  - The integrateIntoCurrentSessionResponse() @remarks edit is the ONLY doc artifact. NO docs/*.md.

DOWNSTREAM (S2 ENABLES — separate subtask, do NOT do here):
  - P1.M2.T1.S3 (unit tests for both paths): comprehensive cross-path suite (delta + integrate added-req
        handling, incl. the catch-branch coverage case). S2's single driving test is the implicit-TDD seed.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first — the block + JSDoc may reflow)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — clean
npm run lint           # eslint . --ext .ts — clean
npm run format:check   # prettier --check — clean
# Expected: all clean. Likely failure: a type error if DeltaAnalysis spread or the dynamic import path is wrong.
```

### Level 2: Unit Tests (Component Validation)
```bash
# The directly-affected suite — MUST be GREEN (4 integrate it()s: 3 existing + 1 new):
npx vitest run tests/unit/workflows/prp-pipeline-delta-response.test.ts
# Sibling regression — the delta path (decomposePRD) must be unaffected:
npx vitest run tests/unit/core/delta-prd.test.ts
# Expected: both green. If the new it() fails "P9 not merged" → the gate/architect-merge didn't run (check the
#   architect mock returned {prompt:...} and readFile returned Backlog JSON for tasks.json). If one of the 3
#   existing integrate tests fails → the gate is missing/wrong (they must SKIP the new block via changes:[]).
# Do NOT run the full `npm run test:run` — pre-existing red (bugfix Issue 3, P2/P3 scope).
```

### Level 3: Integration / Regression (System Validation)
```bash
# Confirm the GOTCHA comment is gone and the new block is wired:
grep -n "GOTCHA" src/workflows/prp-pipeline.ts          # Expect: ZERO hits in integrateIntoCurrentSessionResponse.
grep -n "integrateAddedRequirements" src/workflows/prp-pipeline.ts  # Expect: 1 hit (the retry operation label).
grep -n "mergeBacklogs" src/workflows/prp-pipeline.ts   # Expect: ≥2 hits (decomposePRD + the new integrate block).
# Build emits dist/ cleanly (proves the dynamic imports + types compile):
npx tsc -p tsconfig.build.json
# Targeted regression on backlog-merger (the reused utility — must be unbroken):
npx vitest run tests/unit/core/backlog-merger.test.ts
# Expected: grep confirms the wiring; build clean; backlog-merger green.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP surface (the architect is mocked in tests). Domain checks (record in commit message):
#   1. Gating: a modified/removed-only delta (no 'added') SKIPS the block → byte-equivalent to before
#      (the 3 existing integrate tests prove this — they use changes:[] and stay green untouched).
#   2. Added path: an 'added' delta invokes the Architect over a focused Added-only delta PRD; the new
#      tasks are mergeBacklogs'd into the patched backlog; saveBacklog(merged) persists; refresh+clear run after.
#   3. Failure isolation: an Architect failure (error status / throw / read/parse error) is caught; the
#      patched backlog is re-asserted on disk (currentSession.taskRegistry === patched at that point);
#      modified/removed integration survives; a warn is logged (never a silent drop).
#   4. Ordering: refreshSnapshotToCurrentPRD + clearPendingDeltaHash still run AFTER the merge (the
#      line-417 ordering test covers saveBacklog-before-refresh; the merge's saveBacklog also precedes refresh).
#   5. Reuse: mergeBacklogs is the SAME utility as the delta path (P1.M1.T1.S2) — no duplicated merge logic.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/workflows/prp-pipeline-delta-response.test.ts` GREEN (3 existing + 1 new).
- [ ] `npx vitest run tests/unit/core/delta-prd.test.ts` GREEN (delta-path regression).
- [ ] `npx vitest run tests/unit/core/backlog-merger.test.ts` GREEN (reused utility unbroken).

### Feature Validation
- [ ] Gated block: `delta.changes.some(c => c.type === 'added')` controls entry.
- [ ] Added path: Architect invoked with focused Added-only delta PRD; tasks.json read; `mergeBacklogs` → `saveBacklog(merged)`.
- [ ] No-added path: block skipped; byte-equivalent to before.
- [ ] Architect failure: caught; patched backlog re-asserted on disk; warn logged; refresh+clear still run.
- [ ] `refreshSnapshotToCurrentPRD` + `clearPendingDeltaHash` run AFTER the merge (ordering preserved).
- [ ] GOTCHA JSDoc removed; Mode-A added-req decomposition remark added; method signature unchanged.

### Code Quality Validation
- [ ] Mirrors `decomposePRD()` for the architect invocation (dynamic imports, retryAgentPrompt, status check, readFile, merge).
- [ ] `mergeBacklogs` REUSED (not re-extracted/duplicated) — the contract's "shared utility" already exists (P1.M1.T1.S2).
- [ ] No new top-level imports (renderDeltaPRD/retryAgentPrompt/mergeBacklogs already imported).
- [ ] Only `src/workflows/prp-pipeline.ts` + `tests/unit/workflows/prp-pipeline-delta-response.test.ts` modified.
- [ ] `task-patcher.ts`, `backlog-merger.ts`, `delta-prd.test.ts`, `decomposePRD`/`spawnDeltaSession` UNTOUCHED.

### Documentation & Deployment
- [ ] JSDoc @remarks edit is the only doc artifact (Mode A — rides with the code).
- [ ] No `docs/*.md`, README, or `.env.example` changes.
- [ ] Commit message notes: integrate-path added-req generation; mergeBacklogs reused (not re-extracted);
      the gating fact (existing tests stay green); the try/catch disk-consistency invariant; S3 cross-reference.

---

## Anti-Patterns to Avoid

- ❌ Don't re-extract or duplicate `mergeBacklogs`. It ALREADY exists as a shared utility
  (`src/core/backlog-merger.ts:207`, P1.M1.T1.S2 Complete) and is ALREADY imported in
  `prp-pipeline.ts:73`. The contract's "extract to a shared utility" is already satisfied — S2 calls it.
- ❌ Don't omit the `delta.changes.some(c => c.type === 'added')` gate. Without it, the architect mock
  (returns undefined) breaks the 3 existing integrate-path tests (which use `changes:[]` deltas and must
  SKIP the new block). The gate is what keeps them byte-equivalent + green.
- ❌ Don't skip the try/catch disk re-assert. The architect WRITES tasks.json itself; a clobber-then-fail
  would orphan modified/removed integration on the next load. The catch MUST re-save
  `currentSession.taskRegistry` (=== patched) so disk stays consistent. Architect failure must NOT abort
  modified/removed integration (the contract).
- ❌ Don't move `refreshSnapshotToCurrentPRD`/`clearPendingDeltaHash` before the new block. They must run
  AFTER the merge (the snapshot refreshes only once integration — patched AND merged — has applied).
- ❌ Don't invent a new architect-invocation style. MIRROR `decomposePRD()` (dynamic imports, retryAgentPrompt,
  `result.status === 'error'` check, readFile tasks.json, JSON.parse as Backlog, mergeBacklogs). One pattern.
- ❌ Don't move `createArchitectAgent()` inside the retry closure — create it ONCE outside (PRD §6.1
  "same budget" invariant; see decomposePRD comment lines 1155-1162).
- ❌ Don't add top-level imports for renderDeltaPRD/retryAgentPrompt/mergeBacklogs — they're already imported
  (59/77/73). Only the two dynamic imports (agent-factory + architect-prompt) go inside the block.
- ❌ Don't touch `task-patcher.ts` (parallel S1 owns the 'added' no-op), `backlog-merger.ts` (Complete —
  reuse only), `delta-prd.test.ts` (S3 regression-locked), or `decomposePRD`/`spawnDeltaSession`.
- ❌ Don't run the full `npm run test:run` as the gate — it's pre-existing red (bugfix Issue 3, 297 failures,
  P2/P3 scope). Gate = typecheck + lint + format:check + the targeted response-test + delta-prd.test.ts.
- ❌ Don't edit any `docs/*.md` — DOCS is Mode A (JSDoc on integrateIntoCurrentSessionResponse only).
- ❌ Don't add the comprehensive cross-path suite — that's S3. S2 adds ONE driving test (implicit TDD).

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: The single biggest risk — "extract mergeBacklogs to a shared utility" — is ALREADY DONE
(P1.M1.T1.S2 created `src/core/backlog-merger.ts` and it's already imported in `prp-pipeline.ts:73`),
so S2 is a pure wiring task: insert a gated block that mirrors the ALREADY-WORKING `decomposePRD()`
architect-invocation pattern (lines 1148-1230) at the integrate-path seam. Every helper signature is
verified (`createArchitectAgent:354`, `createArchitectPrompt:58`, `renderDeltaPRD:1386`,
`retryAgentPrompt`, `mergeBacklogs:207`) and already imported. The gating fact — existing integrate-path
tests use `changes:[]` deltas so the new block is SKIPPED for them — is proven by reading lines 325-446,
so the 3 existing tests stay green with zero edits. The try/catch disk-consistency invariant (the one
non-obvious correctness requirement) is spelled out with the exact re-assert line. The test-mocking
recipe is lifted verbatim from `delta-prd.test.ts` (the canonical architect mock). The work is
file-disjoint from the parallel S1 (`task-patcher.ts`) and from S3 (comprehensive tests). The only
caveat — the full suite is pre-existing red (bugfix Issue 3) — is handled by gating on the targeted
response-test + delta-prd.test.ts. Residual risks: (a) the readFile mock needing path-discrimination
for tasks.json (specified per-test); (b) a coverage drop on the catch branch (closed by the optional
second `it()`); (c) a prettier reflow (auto-fixed via `npm run fix`). No runtime/network unknowns —
the architect is mocked in tests.