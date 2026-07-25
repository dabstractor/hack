# Design Note — P1.M1.T1.S3: Integration test for full delta breakdown (non-empty parent backlog)

> Captures the non-obvious test-design decisions. Read before implementing.

## 0. What S3 consumes (S1 LANDED, S2 = CONTRACT)

- **S1 (landed)**: `decomposePRD()` reordered — `isDelta` computed FIRST; the original
  `hasBacklog` early-return is wrapped in `if (!isDelta)`. So a delta session ALWAYS reaches
  `loadDeltaPRD` + `architectAgent.prompt` (the previously-dead branch is now reachable).
- **S2 (contract — assume landed)**: at the `saveBacklog` seam, `mergeBacklogs(currentSession.taskRegistry, parsedBacklog)`
  is called BEFORE saving. So the delta session's final `tasks.json` = patched (modified→Planned,
  removed→Obsolete) ⊕ architect (added-req tasks).
- **S3 (this)**: the test that PROVES it end-to-end: `handleDelta → spawnDeltaSession → decomposePRD`
  with a NON-EMPTY parent backlog (the precondition that masked the bug in `delta-prd.test.ts` CASE A).

## 1. Why a NEW file (not extending delta-prd.test.ts)

`tests/unit/core/delta-prd.test.ts` is regression-locked by S1 AND S2 (CASE A empty-backlog, CASE C
non-delta). Editing it risks breaking those. S3 creates a DISTINCT file — `tests/integration/core/
delta-breakdown-integration.test.ts` — that drives the FULL path with real tmpdir file I/O. This is
also the correct HOME: it's an integration test (real session-utils + real files + mocked agents),
matching `tests/integration/core/delta-session.test.ts`.

## 2. The mocking surface (mirror delta-prd.test.ts, extend for the full path)

Mock (vi.mock, hoisted): `architect-prompt.js` (createArchitectPrompt SPY — assert 1st arg),
`agent-factory.js` (createArchitectAgent → prompt that WRITES tasks.json as a side effect),
`delta-analysis-workflow.js` (constructor → run() returns a DeltaAnalysis with an 'added' change),
`task-patcher.js` (patchBacklog → returns a NON-EMPTY patched backlog), `task-utils.js`
(filterByStatus → []), `session-manager.js` (SessionManager class → replaced by a STATEFUL mock),
`bug-hunt-workflow.js` + `fix-cycle-workflow.js` (constructor side-effect avoidance),
`execution-guard.js` (validateNestedExecution/isNestedExecutionError).

NOT mocked: `session-utils.js` (real resolvePRD, renderDeltaPRD, writeDeltaPRD, loadDeltaPRD,
writePendingDeltaHash, hashPRDContent) + real tmpdir file I/O.

## 3. THE key technique: a STATEFUL SessionManager mock (currentSession is read multiple times)

The existing unit test uses a STATELESS mock (`currentSession: session` fixed). The FULL path reads
`sessionManager.currentSession` across `handleDelta`, `spawnDeltaSession` (parent), then
`createDeltaSession` must SWITCH it to the delta session, and `saveBacklog` must SYNC
`taskRegistry` in memory (the merge reads `currentSession.taskRegistry` as the patched backlog).

→ Use a GETTER backed by a mutable `current`:
```ts
let _current = parentSession;
const sm = {
  prdPath,                                            // real PRD file path
  get currentSession() { return _current; },          // ALWAYS live
  initialize: vi.fn().mockResolvedValue(parentSession),
  createDeltaSession: vi.fn().mockImplementation(async () => {
    mkdirSync(deltaSessionPath, { recursive: true }); // real dir for writeDeltaPRD + architect write
    _current = deltaSession;                          // switch to delta session (parentSession set)
  }),
  saveBacklog: vi.fn().mockImplementation(async (b) => {
    _current = { ..._current, taskRegistry: b };       // SYNC MEMORY (merge reads taskRegistry)
    writeFileSync(join(_current.metadata.path, 'tasks.json'), JSON.stringify(b)); // mirror real SM
  }),
  hasSessionChanged: vi.fn().mockReturnValue(false),
  flushUpdates: vi.fn().mockResolvedValue(undefined),
};
```
The `saveBacklog` memory-sync is CRITICAL: without it, `decomposePRD`'s merge would read a STALE
taskRegistry. The disk write makes the FINAL `tasks.json` = merged (assertable as the real artifact).

## 4. THE architect mock side effect (writes tasks.json)

`decomposePRD` reads `tasks.json` from disk AFTER `architectAgent.prompt()` (the agent writes it
itself in production). So the mock's `prompt` MUST write a `tasks.json` containing NEW tasks for the
added requirement. Use `vi.hoisted` to share the delta session path + the architect backlog between
the mock factory and the test body (factories are hoisted; non-`mock`-prefixed vars can't be referenced):
```ts
const mockState = vi.hoisted(() => ({ deltaSessionPath: '', architectBacklog: null as any }));
vi.mock(agent-factory, () => ({ createArchitectAgent: vi.fn().mockReturnValue({
  prompt: vi.fn().mockImplementation(async () => {
    const { writeFileSync } = await import('node:fs'); const { join } = await import('node:path');
    if (mockState.deltaSessionPath) writeFileSync(join(mockState.deltaSessionPath, 'tasks.json'), JSON.stringify(mockState.architectBacklog));
    return { status: 'success', output: '' };
  }),
}) }));
```
Set `mockState.deltaSessionPath` + `mockState.architectBacklog` in the test body BEFORE `decomposePRD()`.

## 5. Fixture design (so the merge produces an assertable result)

- **Parent backlog** (non-empty): Phase P1 title 'Foundation' → Milestone P1.M1 title 'Core' →
  Tasks T1(status Complete) + T2(status Complete). (parentSession.taskRegistry.)
- **DeltaAnalysis** (from DeltaAnalysisWorkflow mock): changes = [
    { itemId:'P1.M1.T1', type:'modified', ... },   // patchBacklog → T1 Planned
    { itemId:'P1.M1.T2', type:'removed', ... },    // patchBacklog → T2 Obsolete
    { itemId:'P1.M2', type:'added', ... } ].       // patchBacklog 'added' = no-op (Issue 2); architect handles it
- **patchedBacklog** (from patchBacklog mock): same structure as parent but T1→Planned, T2→Obsolete.
- **architectBacklog** (written by agent mock): Phase title 'Foundation' (SAME → merge EXTENDS by
  title) → Milestone P1.M2 title 'New Feature' (new title → append) → Task P1.M2.T1 + Subtask
  P1.M2.T1.S1 (NEW IDs — no collision with patched P1.M1.*).
- **Merge result (S2)**: P1 'Foundation' now has P1.M1 (T1 Planned, T2 Obsolete) + P1.M2 (new T1).
  → Assert (e): P1.M2.T1 exists (new added-req task, NOT in parent). Assert (f): T1 status Planned
  (modified), T2 status Obsolete (removed) — patched statuses survived the merge.

## 6. The drive + assertions

Drive: `await pipeline.handleDelta()` then `await pipeline.decomposePRD()`. (handleDelta →
spawnDeltaSession [default path] → ... then decomposePRD runs the now-reachable delta branch.)
Assert:
- (d) `createArchitectPromptMock.mock.calls[0][0]` === delta_prd.md content: contains '# Delta PRD'
  + '## Added' + the added itemId; is NOT the full PRD string; is NOT parentSession.prdSnapshot.
  Also `createArchitectPromptMock` called exactly ONCE (proves hasBacklog did NOT short-circuit).
- (e) Final `tasks.json` (read from delta dir) contains a NEW task (P1.M2.T1) not in the parent.
- (f) The modified task T1 is 'Planned'; the removed task T2 is 'Obsolete'.

## 7. Real-file prerequisites (because session-utils is NOT mocked)

- `sm.prdPath` → a REAL PRD file (write `# New PRD\n...` to tmp/prd.md). `resolvePRD` reads it
  (no @-includes → identity; returns content).
- Parent session dir (parentSessionPath) must EXIST → `writePendingDeltaHash` writes `.pending_delta_hash` there.
- Delta session dir (deltaSessionPath) is created by the `createDeltaSession` mock (`mkdirSync`).

## 8. Coverage / gate note

vitest.config enforces 100% GLOBAL coverage (suite-wide). The suite is PRE-EXISTING-RED (297
failures, bugfix Issue 3 — P2/P3 scope, NOT mine). S3's gate is NOT `npm run test:run`; it is:
the new file passes + the targeted regression suites (delta-prd.test.ts, backlog-merger.test.ts)
stay green + typecheck/lint/format. Adding this file INCREASES coverage of the delta path (good).