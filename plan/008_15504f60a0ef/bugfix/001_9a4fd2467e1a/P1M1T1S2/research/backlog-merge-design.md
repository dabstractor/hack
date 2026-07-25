# Research — P1.M1.T1.S2 (backlog merge: architect-decomposed ⊕ patched backlog)

S2 implements the merge half of bugfix Issue 1's "Approach A" fix. S1 (landed) reordered
`decomposePRD()` so the delta branch is reachable and left an annotated **S2 seam** at the
`saveBacklog(parsedBacklog)` call. S2 replaces that seam with a merge of the architect's
added-requirement output and the in-memory patched backlog, then saves the merged result.

## 1. Exact S1 seam (verified in-repo — `src/workflows/prp-pipeline.ts` decomposePRD, ~L1209-1230)

```ts
const parsedBacklog = JSON.parse(tasksContent) as Backlog;   // architect's disk output

// S2 SEAM (P1.M1.T1.S2): for delta sessions, MERGE parsedBacklog (added tasks produced by
// the architect over delta_prd.md) with the in-memory patched backlog (currentSession.taskRegistry
// — modified→Planned, removed→Obsolete) BEFORE saving. ...
await this.sessionManager.saveBacklog(parsedBacklog);          // ← S2 replaces this line
this.totalTasks = this.#countTasks();
this.logger.info(`[PRPPipeline] Generated ${parsedBacklog.backlog.length} phases`);
this.currentPhase = 'prd_decomposed';
```

S2 target at the seam:
```ts
const parsedBacklog = JSON.parse(tasksContent) as Backlog;
const patchedBacklog = this.sessionManager.currentSession!.taskRegistry; // in-memory patched (survives architect disk write)
const mergedBacklog = mergeBacklogs(patchedBacklog, parsedBacklog);
await this.sessionManager.saveBacklog(mergedBacklog);
this.totalTasks = this.#countTasks();                              // unchanged — reads merged via currentSession
this.logger.info(`[PRPPipeline] Generated ${mergedBacklog.backlog.length} phases`);
this.currentPhase = 'prd_decomposed';
```

## 2. THE data-flow fact S2 depends on (verified, not assumed)

S1's PRP ASSERTED "currentSession.taskRegistry (in-memory) holds the patched backlog at the
seam." **Verified true** by reading `SessionManager.saveBacklog` (session-manager.ts:906):

```ts
async saveBacklog(backlog: Backlog): Promise<void> {
  const deltas = this.#pendingDeltas;
  const written = await withLockedTasksJSON(sessionDir, fresh => {
    if (deltas.length === 0) return backlog;   // init-time / single-writer full write
    /* ...apply deltas onto fresh... */
  });
  this.#currentSession = { ...this.#currentSession, taskRegistry: written };  // ← SYNCS MEMORY
}
```

Trace (default delta path `spawnDeltaSession`):
- Step 5 `patchBacklog(...)` → patchedBacklog (modified→Planned, removed→Obsolete; items immutable, never removed).
- Step 6 `createDeltaSession(...)` → sets `#currentSession` = new delta session (taskRegistry initially `{ backlog: [] }` per L816).
- Step 7 `saveBacklog(patchedBacklog)` → `deltas` is empty (no runtime status updates during delta spawn) → `written = patchedBacklog` → **`#currentSession.taskRegistry = patchedBacklog`**. ✓
- `decomposePRD()` runs later: the Architect agent writes `tasks.json` directly to disk
  (`$TASKS_FILE`), **bypassing saveBacklog** → `#currentSession.taskRegistry` is NOT touched by
  that write → still holds `patchedBacklog` at the seam. ✓

So `this.sessionManager.currentSession!.taskRegistry` IS the patched backlog when S2 reads it.
The architect's output is `parsedBacklog` (read back from the clobbered disk `tasks.json`).

## 3. saveBacklog VALIDATES — merged output must be BacklogSchema-valid

`saveBacklog` → `withLockedTasksJSON` → `writeTasksJSON` → `BacklogSchema.parse` (session-manager
L166, L848-868). The schemas enforce ID-format regexes (Phase `^P\d+$`, Milestone `^P\d+\.M\d+$`,
Task `^P\d+\.M\d+\.T\d+$`, Subtask `^P\d+\.M\d+\.T\d+\.S\d+$`) and Status enum, but NOT ID
uniqueness. The merge must produce structurally-valid items; it preserves IDs verbatim from the
two valid inputs, so validity holds as long as no duplicate IDs are introduced (de-dup guarantees).

## 4. Merge algorithm (contract-faithful + defensive)

Contract (verbatim intent):
- (a) patchedBacklog is the base.
- (b) For each Phase in architectBacklog: if a Phase with the SAME TITLE exists in patchedBacklog,
      merge new Milestones/Tasks into it (append tasks to matching milestones, create new milestones
      if needed). If the Phase doesn't exist, append it to `patchedBacklog.backlog[]`.
- (c) De-duplicate by existing task IDs (patched has IDs like P1.M1.T1.S1; architect added-req
      output should produce new non-colliding IDs).

**Matching key decision:** Phase & Milestone merge by **TITLE** (contract (b)); Task/Subtask
de-dup by **ID** (contract (c)). Title-matching is robust to the architect re-numbering IDs
(the architect sees only delta_prd.md, not the existing ID space). The merge is DEFENSIVE at
every level: any architect item (phase/milestone/task) whose ID already exists in patched is
SKIPPED with a `logger.warn` (de-dup event — observable, NOT a silent drop; the original bug was
a silent drop, so S2 explicitly logs every skip).

```
mergeBacklogs(patched, architect) -> Backlog:
  existingIds = collect ALL ids in patched (phase, milestone, task, subtask)
  result = [...patched.backlog]
  phaseByTitle = Map(title -> index in result)
  for archPhase in architect.backlog:
    idx = phaseByTitle.get(trim(archPhase.title))
    if idx != undefined:
      result[idx] = mergePhase(result[idx], archPhase, existingIds)   // EXTEND by title
    else if archPhase.id not in existingIds:
      registerPhaseIds(archPhase, existingIds); phaseByTitle.set(title, len); result.push(archPhase)  // NEW phase
    else: logger.warn(phase id collision — skip)
  return { backlog: result }

mergePhase(existing, archPhase, existingIds) -> Phase:
  milestones = [...existing.milestones]; msByTitle = Map(title -> index)
  for archMs in archPhase.milestones:
    idx = msByTitle.get(trim(archMs.title))
    if idx != undefined:
      milestones[idx] = mergeMilestone(milestones[idx], archMs, existingIds)  // EXTEND by title
    else if archMs.id not in existingIds:
      registerMsIds(archMs, existingIds); msByTitle.set(title, len); milestones.push(archMs)  // NEW milestone
    else: logger.warn(milestone id collision — skip)
  return { ...existing, milestones }

mergeMilestone(existing, archMs, existingIds) -> Milestone:
  tasks = [...existing.tasks]
  for archTask in archMs.tasks:
    if archTask.id not in existingIds:
      registerTaskIds(archTask, existingIds); tasks.push(archTask)   // NEW task (atomic, with its subtasks)
    else: logger.warn(task id collision — de-dup skip)               // contract (c)
  return { ...existing, tasks }
```

`registerXIds` adds the item's id (+ descendants) to `existingIds` so a later architect item in
the SAME merge can't double-add. Immutability: spread + new arrays (interfaces are `readonly`).

## 5. ALWAYS-merge at the seam (no isDelta branch) — verified safe

The seam is reached only when (non-delta AND no backlog) OR (delta). For non-delta-no-backlog,
`currentSession.taskRegistry = { backlog: [] }` → `mergeBacklogs(empty, parsedBacklog)`:
- no patched phases → every architect phase has no title match AND its id is not in (empty) existingIds → appended verbatim.
- ⇒ merge output === parsedBacklog (structurally identical). saveBacklog writes the same bytes.

So always-merging is byte-equivalent to the S1 behavior for non-delta, and correct for delta.
No `if (isDelta)` branch needed → simpler, one code path, better coverage story. (A guard
`if (isDelta) merged = merge(...); else merged = parsedBacklog;` is an acceptable alternative but
adds an unnecessary branch; always-merge is preferred.)

## 6. Placement: NEW pure module `src/core/backlog-merger.ts` (mirrors task-patcher.ts)

`mergeBacklogs` is a PURE `(patched, architect) -> Backlog` (synchronous, no I/O, no agent). A new
focused module `src/core/backlog-merger.ts` mirrors `src/core/task-patcher.ts` (the sibling pure
backlog-transformation function). Benefits:
- Trivially unit-testable with NO mocks (pure data transformation) — `tests/unit/core/backlog-merger.test.ts`.
- Single responsibility (task-patcher = delta status patching; backlog-merger = combine two backlogs).
- 100% coverage is straightforward (every branch is a data scenario, not a mock interaction).

The contract's "Mock the architect agent and session manager for unit isolation" applies to the
decomposePRD-level behavior (already covered by `delta-prd.test.ts` CASE A/C mocks). S2's PRIMARY
tests are the pure-function merge tests; the existing delta-prd cases verify the merge is wired
(CASE A: empty patched → merge no-op → architect output saved; stays green).

## 7. ID-collision edge case (documented assumption, not mechanically renumbered)

The architect sees only `delta_prd.md`, so it MAY generate IDs that collide with the patched
backlog (e.g., start from P1.M1.T1.S1). The contract states "architect output for added
requirements SHOULD produce new IDs that don't collide" — i.e., non-colliding IDs are an
ARCHITECT-PROMPT responsibility (the delta_prd.md / createArchitectPrompt surface, separate scope),
NOT the merge's. S2's merge handles collisions DEFENSIVELY (skip + warn) per the contract's de-dup
rule; it does NOT renumber IDs (renumbering is a complex future enhancement, out of scope for a
2-point subtask). Title-based phase/milestone matching is the mechanism that lets added reqs extend
existing phases even when the architect re-numbers task IDs.

## 8. Coverage map (vitest enforces 100% on src/**/*.ts)

Every branch of mergeBacklogs + helpers must be hit:
- happy: new phase appended (no title match, new id).
- happy: existing phase extended by title → new milestone appended + new task in existing milestone.
- de-dup: task id collision → skip+warn (contract (c)).
- de-dup: new phase id collision → skip+warn (defensive).
- de-dup: new milestone id collision → skip+warn (defensive).
- edge: empty patched (no-op ≡ architect); empty architect (no-op ≡ patched).

These map to focused pure-data test cases (no mocks). The `logger().warn` branches each need one
collision test (3 tests) so the warn line + the `else` skip branch are covered.

## 9. Validation commands (verified executable)

- `npm run typecheck` → `tsc --noEmit -p tsconfig.build.json`
- `npm run lint` / `npm run format:check` (prettier is ERROR-enforced; run `npm run fix`)
- `npm run validate` → lint && format:check && typecheck
- `npx vitest run tests/unit/core/backlog-merger.test.ts` (new pure-function suite)
- `npx vitest run tests/unit/core/delta-prd.test.ts` (regression — CASE A/C stay green; merge is a no-op for empty patched)
- Do NOT run the full `npm run test:run` as the gate — 297 pre-existing failures (bugfix Issue 3, P2/P3 scope).