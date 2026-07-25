# run() Flow & Adopt-Mode Gate Analysis — P5.M1.T1.S3

Researched against `src/workflows/prp-pipeline.ts` (session 008 HEAD), treating
P5.M1.T1.S2's PRP as a hard contract (S2 is in flight; its deliverables are assumed present).

## 1. The `run()` step order (verbatim, :2360-2432)

```
run():
  initializeSession()          // S2 seeds the adopted baseline here when adoptFresh
  decomposePRD()               // auto-skips for a non-empty backlog (the seeded baseline)
  if (taskOrchestrator) taskOrchestrator.rebuildQueue()
  executeBacklog()             // S2's skip guard early-returns when skipExecutionLoop
  #runValidation()             // PRIVATE; called directly from run() — see §3
  runQACycle()                 // PUBLIC; gated by mode + completion — see §4
  setStatus('completed'); return PipelineResult{ totalTasks, completedTasks, … }
```

There is **no** early-return / mode gate between `executeBacklog()` and `#runValidation()`.
After the backlog step the pipeline falls straight through to validation then QA.

## 2. `executeBacklog()` skip guard (S2's deliverable) — the gap S3 closes

S2's PRP (Task 3c) adds this as the **FIRST statement** of `executeBacklog()` (after the
opening `this.logger.info('[PRPPipeline] Executing backlog')`):
```ts
if (this.skipExecutionLoop) {
  this.logger.info('[PRPPipeline] Skipping execution loop (adopt mode / SKIP_EXECUTION_LOOP)');
  this.currentPhase = 'backlog_complete';
  return;
}
```
The body of `executeBacklog()` that sets `this.completedTasks` is at :1286 and :1423 —
**after** this guard. So in adopt mode the guard returns BEFORE those lines run.

### Field state after S2 in adopt mode
| field            | set where                                 | value in adopt mode |
|------------------|-------------------------------------------|---------------------|
| `totalTasks`     | `decomposePRD()` auto-skip `:1093` (`this.totalTasks = this.#countTasks()`) | **1** (the seeded subtask) |
| `completedTasks` | ONLY `executeBacklog()` `:1286`,`:1423` (`this.completedTasks = this.#countCompletedTasks()`) | **0** (body skipped) |
| `currentPhase`   | S2's guard                                | `'backlog_complete'` |

`totalTasks`/`completedTasks` are PUBLIC fields (`:218 totalTasks: number = 0`, `:221
completedTasks: number = 0`); both appear in `PipelineResult` (`:2453`, `:2475`). So with
S2 alone, an adopt-mode run returns `completedTasks: 0, totalTasks: 1` — **the session is
reported as incomplete even though the seeded baseline is 100% Complete.**

## 3. `#runValidation()` — runs in ALL modes (no gate; S3 does NOT touch it)

`#runValidation()` (`:1489-1531`) is `#`-private (NOT callable from tests). `run()` calls it
unconditionally at `:2430`; the inline comment at `:2424` states verbatim:
> "Runs in ALL modes (fixes the --mode validate skip-QA defect)."

It does `new ValidationWorkflow(prdSnapshot, process.cwd())` then `workflow.run(sessionPath)`,
and throws `ValidationFailedError` on a non-zero exit (PRD §4.4 abort-on-failure). It needs
only `sessionPath` + `prdSnapshot` — both set by `initialize()` (S2 reuses it). It does NOT
read `skipExecutionLoop`, `completedTasks`, or the backlog. **Therefore validation runs in
adopt mode BY CONSTRUCTION; S3 adds no validation gate and removes none.** In adopt mode it
generates + runs `validate.sh` against the REAL codebase + PRD — exactly PRD §4.6's intent.

## 4. `runQACycle()` — the normal-mode completion gate (this is the load-bearing check)

`runQACycle()` (`:1533-1605`) normal mode (`this.mode === 'normal'`, the default for an
adopt run):
```ts
if (this.totalTasks === 0) { skip QA; currentPhase='qa_complete'; return; }   // :1558
if (!this.#allTasksComplete()) { skip QA; currentPhase='qa_skipped'; return; } // :1564
shouldRunQA = true;                                                            // :1585
```

### Does the adopted baseline pass this gate? YES — but via `#allTasksComplete`, not the field.
`#allTasksComplete()` (`:2583-2601`) iterates the **in-memory backlog**
(`sessionManager.currentSession.taskRegistry`) and returns false only if some subtask is
not `'Complete'`:
```ts
#allTasksComplete(): boolean {
  const backlog = this.sessionManager.currentSession?.taskRegistry;
  if (!backlog) return false;
  for (const phase of backlog.backlog)
    for (const milestone of phase.milestones)
      for (const task of milestone.tasks)
        for (const subtask of task.subtasks)
          if (subtask.status !== 'Complete') return false;
  return true;
}
```
S2's `seedAdoptedBaseline()` updates the in-memory registry to the all-`Complete` baseline
(immutable spread `{ ...#currentSession, taskRegistry: baseline }`). So `#allTasksComplete()`
returns **true** for the adopted baseline ⇒ `runQACycle()` does NOT skip ⇒ the bug hunt
(`BugHuntWorkflow`) runs. The QA agent hunts against the REAL codebase + PRD (PRD §4.6).

### Why S3 must still touch the counts
`#allTasksComplete()` reads the backlog directly, so QA runs even with `completedTasks===0`.
BUT:
1. `PipelineResult.completedTasks === 0` is **wrong/misleading** (the baseline is complete).
2. The behavior leans on the implicit invariant "`#allTasksComplete` reads the seeded
   registry". Making `completedTasks === totalTasks` explicit in the skip guard removes that
   fragility and matches the work item's wording: *"the completed baseline tasks.json means
   is_session_complete is true, so QA/bug-hunt proceeds as for a normal completed session."*
   A normal completed session has `completedTasks === totalTasks`.
3. `run()`'s debug log (`:2418` `completedTasks: this.completedTasks`) and the result both
   consume the field.

`is_session_complete` is NOT a function — it is the conceptual property realized by
`#allTasksComplete()` (+, after S3, `completedTasks === totalTasks`).

## 5. The S3 fix (surgical, single-site) — extend S2's skip guard

Replace S2's guard body so it recomputes BOTH counts from the seeded backlog before returning:
```ts
if (this.skipExecutionLoop) {
  this.logger.info(
    '[PRPPipeline] Skipping execution loop (adopt mode / SKIP_EXECUTION_LOOP); validation + bug-hunt still run (PRD §4.6)'
  );
  // The adopted baseline is all-Complete (PRD §4.6). executeBacklog()'s body (which sets
  // completedTasks) is skipped, so recompute BOTH counts here so the session reports as
  // complete and runQACycle() treats it as a normal completed session.
  this.totalTasks = this.#countTasks();
  this.completedTasks = this.#countCompletedTasks();
  this.currentPhase = 'backlog_complete';
  return;
}
```
`#countTasks()`/`#countCompletedTasks()` (`:2526`/`:2552`) read
`sessionManager.currentSession.taskRegistry` → for the adopted baseline they return `1` and
`1`. This is the ENTIRE code change for S3. It layers on S2's guard (no other site touched).

## 6. Work-item part (d): next PRD.md edit → normal delta session (NO code change)

The adopted session is produced by the **normal** `initialize()` path (S2 reuses it — it only
adds `.adopted` + the baseline `tasks.json` + the in-memory update). So the session already has:
- `prd_snapshot.md` (written by `initialize()` → `snapshotPRD`), and
- a hash registered for `findSessionByHash()` (the session dir under `plan/`).

On the NEXT run: `hashPRD(newPRD)` ≠ the adopted session's snapshot hash ⇒ `handleDelta()` ⇒
`createDeltaSession(parentSession = adopted baseline)`. Nothing reads `.adopted` specially
(grep confirms it is a marker only), so delta detection is unaffected. The
`hasAnySessions()` guard (S1) makes a second `--adopt-prd` a no-op (warn + normal resolution),
and a plain run goes straight to delta. **So part (d) holds by construction — S3 adds no
special-casing and must not.** (A regression test can lock this, but no production code is
required.)

## 7. What S3 does NOT do (scope guardrails, from the work-item DOCS line + S2's boundaries)

- NO env-var wiring of `SKIP_EXECUTION_LOOP`. `grep` confirms the env var appears ONLY in
  comments (`:200,:654,:666`) — it is never read. The mechanism is the `skipExecutionLoop`
  FIELD (S2 sets it on `adoptFresh`). The work-item DOCS line says "none — no config surface
  change beyond S1/S2", so reading the env var would violate scope. (PRD §9.2.2 lists it as a
  var, but the impl uses the field; leave it.)
- NO change to `#runValidation()` (runs always) or `runQACycle()` (gate already passes for the
  adopted baseline).
- NO change to `decomposePRD()` (auto-skips via its non-empty-backlog guard).
- NO docs (Mode A not even needed — the behavior is internal; S2 owns the CONFIGURATION.md row).
- NO CLI/config/env/dependency. NO change to bug-hunt/validation workflows or SessionManager.
- The ONLY production file touched is `src/workflows/prp-pipeline.ts` (extend S2's guard) +
  `tests/unit/workflows/prp-pipeline.test.ts` (regression tests).

## 8. Why this is a 1-point task

The load-bearing discovery is that validation + bug-hunt *already run* after S2 (§3 + §4); the
only real defect is the stale `completedTasks` field (§2). The fix is a 3-line extension of
S2's guard (§5). The rest is regression tests proving the behavior (so a future change to
`executeBacklog`/`runQACycle` can't silently regress adopt mode).