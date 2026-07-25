# Research — P1.M1.T1.S1 (reorder decomposePRD: isDelta before hasBacklog)

Bugfix 001 Issue 1 (CRITICAL): the delta-session breakdown is unreachable.
`decomposePRD()` checks `hasBacklog` BEFORE `isDelta`, and `spawnDeltaSession()`
step 7 always saves a NON-EMPTY patched backlog to the delta session, so
`hasBacklog` is always true → the `isDelta`/`loadDeltaPRD` branch is dead code
in production → `delta_prd.md` is written but never consumed → ADDED
requirements are silently dropped.

## 1. Current `decomposePRD()` control flow (src/workflows/prp-pipeline.ts:1107–1213)

```
1107 async decomposePRD(): Promise<void> {
1108   log 'Decomposing PRD'
1109   try {
1110-1112  backlog = currentSession?.taskRegistry ; hasBacklog = backlog?.backlog.length > 0
1115-1122  if (hasBacklog) { log 'Existing backlog...'; totalTasks=#countTasks(); phase='prd_decomposed'; RETURN }  ← TAKEN for delta
1124       log 'New session, generating backlog from PRD'
1129-1133  dynamic import { createArchitectAgent } ; { createArchitectPrompt }
1143       architectAgent = createArchitectAgent()    // created ONCE (§6.1 invariant — see comment)
1149       sessionPath = currentSession!.metadata.path
1154-1156  isDelta = currentSession?.metadata.parentSession != null
1157-1170  if (isDelta) { try prdContent=loadDeltaPRD(sessionPath) catch throw 'no delta_prd.md' }
           else { prdContent = currentSession?.prdSnapshot ?? '' }
1173       architectPrompt = createArchitectPrompt(prdContent, sessionPath)
1178       result = retryAgentPrompt(() => architectAgent.prompt(architectPrompt), {...})
1185-1190  if (result.status === 'error') throw `Architect agent failed: ...`
1192-1198  tasksContent = readFile(resolve(sessionPath,'tasks.json')); parsedBacklog = JSON.parse
1201       saveBacklog(parsedBacklog)
1204-1213  totalTasks=#countTasks(); logs; currentPhase='prd_decomposed'
1220+  catch { isFatalError? rethrow : #trackFailure + warn }
```

**The bug:** lines 1115–1122 (hasBacklog early-return) sit ABOVE lines 1154–1170
(the isDelta branch). In production delta flow, `patchedBacklog` (saved by
`spawnDeltaSession` step 7) is non-empty → `hasBacklog` true → RETURN at 1121 →
the isDelta branch never runs.

## 2. Why `hasBacklog` is ALWAYS true for a delta session

`spawnDeltaSession()` (prp-pipeline.ts:~963):
- Step 5: `patchedBacklog = patchBacklog(backlog, delta)` — `patchBacklog`
  processes modified→Planned and removed→Obsolete via `updateItemStatus()`
  (modifies immutably, NEVER removes items). Parent backlog always has ≥1 phase.
- Step 7: `saveBacklog(patchedBacklog)` → writes non-empty backlog to the delta
  session's tasks.json AND sets `currentSession.taskRegistry`.

So when `decomposePRD()` reads `currentSession.taskRegistry` at line 1111, it's
the non-empty patched backlog → `hasBacklog === true`. (Confirmed in
architecture/delta_workflow.md §"The patchedBacklog Is Always Non-Empty".)

## 3. The reorder (S1 scope = CONTROL FLOW ONLY)

Move `sessionPath` + `isDelta` ABOVE the hasBacklog guard; wrap the ORIGINAL
hasBacklog block in `if (!isDelta) { ... }` (byte-for-byte unchanged); leave the
architect + load + prompt + read + save tail SHARED and unchanged.

```
async decomposePRD(): Promise<void> {
  log 'Decomposing PRD'
  try {
    const sessionPath = currentSession!.metadata.path          // MOVED UP
    const isDelta = currentSession?.metadata.parentSession != null   // MOVED UP

    if (!isDelta) {                                            // NEW wrapper
      // ORIGINAL hasBacklog early-return — BYTE-FOR-BYTE UNCHANGED
      const backlog = currentSession?.taskRegistry
      const hasBacklog = backlog && backlog.backlog.length > 0
      if (hasBacklog) { log 'Existing backlog...'; totalTasks=#countTasks(); phase='prd_decomposed'; return }
      log 'New session, generating backlog from PRD'
    } else {
      log 'Delta session — breakdown over delta_prd.md (PRD §4.3 step 5)'
    }

    // ── everything below is the EXISTING shared tail (unchanged) ──
    dynamic import createArchitectAgent / createArchitectPrompt
    architectAgent = createArchitectAgent()
    if (isDelta) { try prdContent=loadDeltaPRD(sessionPath) catch throw 'no delta_prd.md' }
    else { prdContent = currentSession?.prdSnapshot ?? '' }
    architectPrompt = createArchitectPrompt(prdContent, sessionPath)
    result = retryAgentPrompt(...)
    if (result.status === 'error') throw ...
    parsedBacklog = JSON.parse(readFile(resolve(sessionPath,'tasks.json')))
    // S2 SEAM — see §4
    saveBacklog(parsedBacklog)
    totalTasks=#countTasks(); logs; currentPhase='prd_decomposed'
  } catch { ... }
}
```

This satisfies the contract: (a) isDelta computed FIRST; (b) delta → skip
hasBacklog, load delta_prd.md, architect.prompt; (c) non-delta → ORIGINAL
hasBacklog early-return unchanged; (d) reads tasks.json. Missing-delta_prd.md
try/catch PRESERVED. Signature unchanged.

## 4. The S2 seam (do NOT implement the merge in S1)

After the reorder, the delta branch reaches `saveBacklog(parsedBacklog)` where
`parsedBacklog` = the architect's freshly-decomposed tasks (ADDED requirements
only, since delta_prd.md contains only diffs). Saving it DIRECTLY would
**clobber** the patched backlog (modified→Planned, removed→Obsolete) that
`spawnDeltaSession` saved. The MERGE (patched ⊕ architect-output) is
**P1.M1.T1.S2** — out of scope here.

CRITICAL data-flow fact for S2 (record in the S2-seam comment): the architect
agent WRITES tasks.json itself (to `$TASKS_FILE`), so the on-disk patched
backlog is overwritten by the architect's write. BUT the IN-MEMORY
`currentSession.taskRegistry` (the patched backlog) is NOT touched by that disk
write — so S2 can merge `parsedBacklog` (disk, added tasks) with
`currentSession.taskRegistry` (in-memory, patched) and then `saveBacklog(merged)`.
S1 must leave this seam clean: the `saveBacklog(parsedBacklog)` line + a comment
marking it as the S2 merge point. S1 does NOT add merge logic.

## 5. Tests (S1 = source + JSDoc; S3 = integration test)

- `tests/unit/core/delta-prd.test.ts` already mocks the architect surface:
  `vi.mock('../../../src/agents/prompts/architect-prompt.js', ...)` (line 28),
  `vi.mock('../../../src/agents/agent-factory.js', ...)` (line 33),
  `vi.mock('../../../src/core/session-manager.js', ...)` (line 40), plus
  task-patcher/task-utils/execution-guard. CASE A (line 383) drives a delta
  session via `makeDeltaSession()` with an EMPTY backlog (`{ backlog: [] }`,
  line 101). After S1's reorder, CASE A STILL passes: isDelta true → skip
  hasBacklog (which would've been false anyway) → reach the architect mock →
  assert delta_prd.md content sourced. The reorder is backward-compatible with
  the existing test.
- S1 does NOT write new tests. The REAL acceptance test (non-empty parent
  backlog → architect invoked over delta_prd.md) is **P1.M1.T1.S3**. The bug
  report notes CASE A's empty-backlog precondition masks the bug; S3 replaces it
  with a non-empty-backlog test. S1 just must not BREAK CASE A.
- Coverage: the reorder adds ONE new branch (`if (!isDelta)`). Both arms are
  covered by existing tests (delta-prd.test.ts CASE A → isDelta true; the
  non-delta generation tests → isDelta false). No coverage gap.

## 6. JSDoc (Mode A — rides with the code)

Update the `decomposePRD()` JSDoc (prp-pipeline.ts:1098-1106) to document:
delta sessions ALWAYS run the breakdown over delta_prd.md (PRD §4.3 step 5)
regardless of a pre-existing patched backlog; non-delta sessions keep the
hasBacklog early-return. Cite bugfix Issue 1.

## 7. Validation

- `npm run typecheck` (tsc --noEmit -p tsconfig.build.json) — clean (pure reorder).
- `npm run lint && npm run format:check` — clean (run `npm run fix` first).
- `npx vitest run tests/unit/core/delta-prd.test.ts` — STILL green (CASE A + the
  renderDeltaPRD/writeDeltaPRD/loadDeltaPRD cases). This is the S1 gate; S1 must
  not regress it.
- Do NOT run the full `npm run test:run` — the wider suite has 297 pre-existing
  failures unrelated to this delta (bugfix Issue 3); they are P2/P3's scope.