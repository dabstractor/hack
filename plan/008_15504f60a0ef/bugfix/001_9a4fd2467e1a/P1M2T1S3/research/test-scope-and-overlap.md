# S3 Research — Test scope, overlap analysis & non-duplicative additions

This note nails down EXACTLY what S3 (test-only) must add, after accounting for
what S1 (DONE) and S2 (Implementing) and P1.M1.T1.S3 (DONE) already produced.
The whole point of S3 is **non-duplicative coverage** of the two paths'
added-requirement handling. Mis-scoping here = either re-implementing a sibling's
test (conflict) or leaving a coverage gap (Issue 3's 100%-coverage gate).

## 1. The architecture decision ("Both Paths") — what each path does

From `architecture/delta_workflow.md` §Issue 2 "Decision: Both Paths":
- **Delta path** (`spawnDeltaSession → decomposePRD`): `patchBacklog` handles
  modified/removed; `decomposePRD` over `delta_prd.md` handles ADDED (generates
  the new tasks). `patchBacklog`'s `'added'` case is a documented debug no-op.
- **Integrate path** (`integrateIntoCurrentSessionResponse`): after patching, if
  `delta.changes` has any `'added'` item, invoke the Architect over a focused
  Added-only delta PRD and merge the resulting tasks into the patched backlog.

S3 proves BOTH paths no longer silently drop added requirements.

## 2. Who owns what (overlap map — the crux of S3's scope)

| Coverage | Owner | Status | What exists |
|---|---|---|---|
| `patchBacklog` 'added' → `debug` log (positive: debug IS called) | **S1** | DONE | task-patcher.ts:103-105 + 2 it() blocks (456, 484) + block C (919) |
| `patchBacklog` 'added' → `warn` NOT called (negative) | **S3** | GAP | no `expect(mockLogger.warn).not.toHaveBeenCalled()` anywhere |
| `patchBacklog` 'added' → backlog structurally unchanged (no items added/removed) | **S3** | GAP | block C asserts the added item STATUS is 'Complete' (918) but NOT total item count / deep structural equality |
| Delta-path architect invocation over delta_prd.md | **P1.M1.T1.S3** | DONE | the integration test in tests/unit/core/delta-prd.test.ts |
| Integrate-path: added → architect → merge (HAPPY path) | **S2** | Implementing | S2's PRP Task 1 adds ONE driving it(); the architect-prompt mock is ALREADY in the file (lines 84-87) |
| Integrate-path: architect FAILURE → modified/removed preserved (CATCH path) | **S3** | GAP | S2's PRP explicitly defers this: "OPTIONAL second it() … else S3 covers it" |

**Conclusion**: S3 adds exactly TWO tests, both non-duplicative:
1. **task-patcher.test.ts** — ONE `it()`: added does NOT log warn + backlog
   structurally unchanged + debug IS logged (the missing negative + structural
   assertions).
2. **prp-pipeline-delta-response.test.ts** — ONE `it()`: the catch-branch
   coverage (architect failure on added reqs → integration proceeds, modified/
   removed preserved, snapshot/marker/phase correct).

## 3. task-patcher.test.ts — current added-changes block (S1 LANDED)

`describe('patchBacklog - added changes')` (lines 455-522) has TWO it() blocks:
- `it('should log debug delegation for added change (no-op)')` (456) — asserts
  `mockLogger.debug` called with the verbatim delegation message (478-480).
- `it('should log debug delegation for multiple added changes')` (484) — asserts
  debug called twice (512-519).
Both call `patchBacklog(backlog, delta)` but do NOT capture/assert the return and
do NOT assert warn-not-called.

`it('should handle mixed change types')` (854, block C) asserts the added item's
status is 'Complete' (918, unchanged) + debug for added (919). But again, no
warn-not-called and no whole-backlog structural assertion.

S3's NEW it() (insert AFTER line 522, before `describe('patchBacklog - completed
task preservation')` at 524) makes the two missing assertions EXPLICIT:
```ts
it('should NOT log warn and should leave the backlog structurally unchanged for an added change', () => {
  mockLogger.warn.mockClear();
  mockLogger.debug.mockClear();
  const phase = createTestPhase('P1', 'Phase 1', 'Complete');
  // give the phase ≥1 milestone/task/subtask so "no items added/removed" is meaningful
  const backlog = createTestBacklog([phase]);
  const delta = createDeltaAnalysis(
    [{ itemId: 'P1.M1.T1.S1', type: 'added', description: 'New requirement', impact: 'Generate new tasks' }],
    ['P1.M1.T1.S1']
  );
  const patched = patchBacklog(backlog, delta);
  // NEGATIVE — the silent-drop is gone: NO warn (especially not 'Feature not implemented')
  expect(mockLogger.warn).not.toHaveBeenCalled();
  // POSITIVE — debug delegation (mirrors S1's two blocks)
  expect(mockLogger.debug).toHaveBeenCalledWith(
    { changeType: 'added', taskId: 'P1.M1.T1.S1' },
    'Added requirement delegated to delta-session breakdown (decomposePRD over delta_prd.md); patchBacklog is a no-op for added changes'
  );
  // STRUCTURAL — the added requirement did NOT add or remove any backlog items (delegated, not dropped)
  expect(patched).toEqual(backlog);
});
```
Helpers already present: `createTestPhase`, `createTestBacklog`, `createDeltaAnalysis`
(used at 461-474). `mockLogger` is hoisted (29-36) with both `warn` and `debug` fns
(33-34). The verbatim debug message must match task-patcher.ts:105 EXACTLY.

`expect(patched).toEqual(backlog)` is deep structural equality (order-sensitive).
For added-only deltas patchBacklog produces a structurally identical copy (the
'immutability' describe at 650 + block C's 'Complete' status prove it). If a
subtle normalization breaks toEqual, fall back to an explicit item-count helper
(count phases/milestones/tasks/subtasks before/after). Both prove "no items added
or removed".

## 4. prp-pipeline-delta-response.test.ts — current state + S3's catch test

The file ALREADY mocks (no new top-level mocks needed for S3):
- `node:fs/promises` (readFile/writeFile/mkdir/unlink/copyFile) — line 38.
- `session-utils.js` spread-actual + override resolvePRD/writeDeltaPRD — 55.
- `session-manager.js` factory-impl — 70.
- `agent-factory.js` (createArchitectAgent: vi.fn()) — 83.
- **`prompts/architect-prompt.js`** (createArchitectPrompt → {user:'mock-architect-prompt'}) — **84-87, ALREADY PRESENT** (S2-style comment "exercised by integrate-path added-req decomposition").
- `delta-analysis-workflow.js`, `task-patcher.js` (returns backlog unchanged), `task-utils.js` — 100+.

`describe('integrateIntoCurrentSessionResponse (integrate into current)')` (line ~325) has THREE it():
1. runs delta analysis + patchBacklog, no delta session — uses `changes: []` (gated block SKIPPED).
2. preserves snapshot when patchBacklog FAILS — patchBacklog throws.
3. refreshes snapshot only AFTER saveBacklog — ordering.

S2 will ADD the happy-path it() (added → architect success → merge). **S3 adds the CATCH it()** (architect FAILURE → modified/removed preserved). Insert it in the same describe (after the ordering test ~446). It must NOT duplicate S2's happy-path test.

### The catch test — mock recipe (verified clean, no retry ambiguity)

S2's gated block (per its PRP) is:
```ts
const result = await retryAgentPrompt(() => architectAgent.prompt(architectPrompt), {agentType,operation});
if (result.status === 'error') throw new Error('Architect agent failed on added requirements: ...');
```
`retryAgentPrompt` does NOT retry on a RESOLVED `{status:'error'}` (it only retries
on thrown transient errors). So configuring the architect mock to resolve with
`{status:'error'}` triggers the `throw` → the catch swallows it — FAST, no retry
delays, deterministic. Recipe:
```ts
const { createArchitectAgent } = await import('../../../src/agents/agent-factory.js');
(createArchitectAgent as any).mockReturnValue({
  prompt: vi.fn().mockResolvedValue({ status: 'error', error: { message: 'architect boom' } }),
});
```
With a delta carrying an `'added'` change (MockDeltaAnalysisWorkflow returns
`changes:[{type:'added',...}]`), the gated block ENTERS, the architect "fails",
the catch runs, and integration PROCEEDS (modified/removed preserved, snapshot
refreshed, marker cleared, phase = 'delta_integrated). handleDelta must NOT throw.

### A faithful "modified/removed preserved" assertion

The catch re-asserts `this.sessionManager.currentSession!.taskRegistry` on disk.
The mock session manager's `saveBacklog` is `vi.fn()` (does NOT update taskRegistry),
so in the test taskRegistry stays as `createTestBacklog([])`. To make the re-assert
faithful (mirror real SessionManager.saveBacklog updating taskRegistry), optionally
wire saveBacklog to update it:
```ts
mockManager.saveBacklog.mockImplementation(async (b: Backlog) => { session.taskRegistry = b; });
```
Then assert the LAST saveBacklog call re-saved the patched backlog (NOT the
architect's failed output). Minimum assertion for coverage + the "integration
proceeds" contract: architect invoked + handleDelta resolves (no throw) +
snapshot refreshed + marker cleared + phase 'delta_integrated'. The saveBacklog
re-assert line is exercised either way (coverage achieved).

## 5. Pre-existing red suite — DO NOT gate on the full test:run

bugfix Issue 3: `npm run test:run` is PRE-EXISTING-RED (297 failures / 38 files —
mock drift, groundswell-link, over-strict schema — all P2/P3 scope, NOT S3).
Gate = typecheck + lint + format:check + the TWO TARGETED files:
- `npx vitest run tests/unit/core/task-patcher.test.ts`
- `npx vitest run tests/unit/workflows/prp-pipeline-delta-response.test.ts`
Adding S3's two tests cannot increase the red count (both land in already-green
files, additive only). S3 makes no source changes → cannot introduce new failures.

## 6. Dependency ordering (when each test goes GREEN)

- **S3 part (a)** (task-patcher): depends on S1 ONLY (DONE). Goes GREEN immediately.
- **S3 part (b)** (catch test): depends on S2's gated block existing in
  `integrateIntoCurrentSessionResponse`. S2 is Implementing; by S3's implementation
  S2 is Complete. If the catch test is run BEFORE S2's source lands, it's RED
  (the gated block doesn't exist → architect never invoked → handleDelta proceeds
  via the changes:[]-skip... actually with changes:[added] and no block, it just
  saves patched + refreshes, no architect call → the `expect(createArchitectAgent).toHaveBeenCalled()`
  fails). This is fine: implicit-TDD RED → S2 lands → GREEN. S3 is sequenced AFTER S2.

## 7. File-disjointness / no source changes

S3 is TEST-ONLY. It edits two test files and NOTHING in `src/`. It is file-disjoint
from S1's source edit (task-patcher.ts — S1 done), S2's source edit (prp-pipeline.ts
integrate method — S2 in flight), and P1.M1.T1.S3 (delta-prd.test.ts — DONE, don't touch).
No merge conflict possible.