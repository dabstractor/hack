# Research: Added-requirement handling in the integrate path (P1.M2.T1.S2)

Bugfix 001, **Issue 2 (MAJOR)** — integrate-path slice. Verified against current
source on 2026-07-25. All line numbers are from the live tree.

## 1. The integrate method + the insertion point

`PRPPipeline.integrateIntoCurrentSessionResponse(sessionPath)` lives at
`src/workflows/prp-pipeline.ts:907-958`. Current flow:

```
resolve newPRDResolved → DeltaAnalysisWorkflow(old, new, completedTaskIds) → delta
→ patchedBacklog = patchBacklog(currentSession.taskRegistry, delta)
→ await saveBacklog(patchedBacklog)                          // ← line ~947 (INSERT AFTER)
→ await refreshSnapshotToCurrentPRD(...)                     // ← line ~951
→ await clearPendingDeltaHash(...)
→ currentPhase = 'delta_integrated'
```

**Insert the new added-req block AFTER `saveBacklog(patchedBacklog)` and BEFORE
`refreshSnapshotToCurrentPRD`.** Rationale: the snapshot must refresh only after
the backlog (patched AND merged-added) is applied (the existing "ordering
contract" test at line 417 asserts saveBacklog precedes refreshSnapshot — the new
block's saveBacklog(merged) also precedes refresh, so ordering holds).

## 2. `mergeBacklogs` is ALREADY a shared utility — do NOT re-extract

The work-item contract says "same merge logic as P1.M1.T1.S2 — extract the merge
function to a shared utility." **P1.M1.T1.S2 (Complete) ALREADY did this**:
`src/core/backlog-merger.ts:207` exports
`mergeBacklogs(patched: Backlog, architect: Backlog): Backlog` (pure, sync; title-
match phases/milestones; ID-de-dup tasks; defensive collision skips). It is
ALREADY imported in `prp-pipeline.ts:73` and used by `decomposePRD` at the seam
(lines 1220-1226). ⇒ **S2 just imports-and-calls it. No extraction, no new
module.** This is the single biggest simplification vs. the contract's literal
wording.

## 3. The canonical pattern to mirror: `decomposePRD()` (lines 1148-1230)

The architect-invocation + read-back + merge sequence is already implemented
there. S2 mirrors it EXACTLY (same dynamic imports, same retry, same status check,
same readFile, same merge):

```
createArchitectAgent()                                          // once, outside retry
prdContent = renderDeltaPRD(addedOnlyDelta, completedTaskIds, currentSession.metadata.id)
architectPrompt = createArchitectPrompt(prdContent, sessionPath)
result = await retryAgentPrompt(() => architectAgent.prompt(architectPrompt),
                                { agentType:'Architect', operation:'integrateAddedRequirements' })
if (result.status === 'error') throw new Error(`Architect agent failed: ${result.error?.message}`)
tasksContent = await readFile(resolve(sessionPath,'tasks.json'), 'utf-8')
parsedBacklog = JSON.parse(tasksContent) as Backlog
mergedBacklog = mergeBacklogs(currentSession.taskRegistry, parsedBacklog)   // patched is the base
await saveBacklog(mergedBacklog)
```

Verified helpers/signatures:
- `createArchitectAgent(): Agent` — `agents/agent-factory.ts:354`.
- `createArchitectPrompt(prdContent: string, sessionPath?: string): Prompt<unknown>` — `agents/prompts/architect-prompt.ts:58`. Substitutes `$TASKS_FILE` → `{sessionPath}/tasks.json` so the architect writes the CURRENT session's tasks.json (which the merge then reads back).
- `renderDeltaPRD(delta, completedTaskIds, parentSessionId): string` — `session-utils.ts:1386`. **Already imported** in prp-pipeline.ts:59. Renders Added/Modified/Removed sections; empty arrays → no section. So a filtered `addedOnlyDelta` yields a focused Added-only delta PRD.
- `retryAgentPrompt(fn, { agentType, operation })` — `utils/retry.ts`, **already imported** prp-pipeline.ts:77.
- `mergeBacklogs` — `backlog-merger.ts:207`, **already imported** prp-pipeline.ts:73.

⇒ **NO new top-level imports** are needed for production. Only the two dynamic
imports (agent-factory + architect-prompt), mirroring decomposePRD lines 1148-1153.

## 4. The "focused added-only delta" — how to filter

`delta.changes: RequirementChange[]` where each has `type: 'added'|'modified'|
'removed'` (models.ts:1569). To focus the architect on ADDED only (the contract's
"render a focused delta PRD for the added sections"):

```ts
const addedChanges = delta.changes.filter(c => c.type === 'added');
if (addedChanges.length === 0) { /* skip the whole block */ }
else {
  const addedOnlyDelta: DeltaAnalysis = { ...delta, changes: addedChanges };
  const prdContent = renderDeltaPRD(addedOnlyDelta, completedTaskIds, currentSession.metadata.id);
  ...
}
```

`renderDeltaPRD` only renders a section when its array is non-empty, so the
filtered delta produces an Added-only doc (Modified/Removed sections omitted).
The full-delta alternative is ALSO safe (mergeBacklogs de-dups modified/removed
task IDs), but focused is preferred (less tokens, less wasted architect work).
`currentSession.metadata.id` is the natural `parentSessionId` argument (the diff
is vs the session's own original snapshot).

## 5. The GATING fact that keeps existing tests GREEN

The new block runs ONLY when `delta.changes.some(c => c.type === 'added')`. The
existing 3 integrate-path tests in
`tests/unit/workflows/prp-pipeline-delta-response.test.ts` (describe at line 325)
all use a mock delta with `changes: []` (the `beforeEach` default at lines
209-213, and the explicit override at line 384-388). ⇒ **the new block is SKIPPED
in all 3 → they stay GREEN with zero edits.** Verified by reading lines 325-446.

## 6. The try/catch disk-consistency invariant (CRITICAL)

The contract: "architect failure should not abort integration of modified/removed
changes (which already succeeded)." The architect WRITES `tasks.json` itself
(via `$TASKS_FILE` = `{sessionPath}/tasks.json`). Failure modes:

- Architect fails BEFORE writing tasks.json → disk still = patched (from the
  earlier saveBacklog). Safe.
- Architect fails AFTER clobbering tasks.json (partial/bad write) → disk =
  garbage, but **`currentSession.taskRegistry` STILL = patched** in memory (the
  architect's direct disk write bypasses SessionManager; only saveBacklog syncs
  memory, and that last ran with patchedBacklog).

⇒ In the `catch`, **re-assert the patched backlog on disk** so the session is
left consistent (patched, no-new-tasks) regardless of what the architect did:

```ts
catch (error) {
  this.logger.warn(`...added-req decomposition failed; modified/removed preserved: ${msg}`);
  await this.sessionManager.saveBacklog(this.sessionManager.currentSession!.taskRegistry);
  // currentSession.taskRegistry === patchedBacklog here (architect didn't sync memory)
}
```

This is the robustness requirement; without it, a clobber-then-fail would
orphan modified/removed integration on the next load.

## 7. Test mocking — mirror `delta-prd.test.ts` (the canonical architect mock)

`tests/unit/core/delta-prd.test.ts` mocks the architect cleanly:
```ts
vi.mock('../../../src/agents/prompts/architect-prompt.js', () => ({
  createArchitectPrompt: vi.fn().mockReturnValue({ user: 'mock-architect-prompt' /* … */ }),
}));
vi.mock('../../../src/agents/agent-factory.js', () => ({
  createArchitectAgent: vi.fn().mockReturnValue({
    prompt: vi.fn().mockResolvedValue({ status: 'success', output: '' }),
  }),
}));
```

The response-test file (`prp-pipeline-delta-response.test.ts`) ALREADY mocks
`agent-factory.js` (line 83: `createArchitectAgent: vi.fn()`) but returns
`undefined` by default, does NOT mock `prompts/architect-prompt.js`, and its
`readFile` mock returns `'# Updated PRD'` for every `'utf-8'` read (which would
make `JSON.parse` throw inside the new block). So S2's new test must:
1. Add `vi.mock('../../../src/agents/prompts/architect-prompt.js', …)` (mirror delta-prd).
2. Configure `createArchitectAgent` (per-test) to return `{ prompt: vi.fn().mockResolvedValue({ status:'success' }) }`.
3. Override `mockReadFile` per-test to return a valid Backlog JSON string when the path ends in `tasks.json` (path-discriminating), so the merge reads real data.
4. Give the mock delta an `'added'` change (so the gated block runs).
`mergeBacklogs` runs REAL (it is NOT mocked in either file — pure function). `retryAgentPrompt` runs real.

## 8. Disjointness + scope

- S2 edits ONLY `src/workflows/prp-pipeline.ts` (the integrate method + its JSDoc)
  + adds ONE focused test to `tests/unit/workflows/prp-pipeline-delta-response.test.ts`
  (implicit TDD for the implementation).
- S2 does NOT touch: `task-patcher.ts` (parallel S1), `backlog-merger.ts`
  (Complete P1.M1.T1.S2 — reuse only), `delta-prd.test.ts` (S3 regression-locked),
  the decomposePRD method, or any `docs/*.md` (Mode A = JSDoc only).
- S3 ("unit tests for both paths") adds the COMPREHENSIVE cross-path suite later;
  S2's single test is the driving RED→GREEN for the implementation, scoped to avoid
  overlap (S3 can extend the same describe block).