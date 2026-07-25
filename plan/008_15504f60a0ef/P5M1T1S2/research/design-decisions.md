# Research Note — P5.M1.T1.S2: Seed adopted baseline + SKIP_EXECUTION_LOOP

Captures the non-obvious findings driving the PRP. Read alongside the PRP.

## 1. S1's seam → S2 seeds AFTER `initialize()`, not standalone `createAdoptedSession()`

S1's `initializeSession()` puts an `EXTENSION POINT (P5.M1.T1.S2)` comment in the
**fresh-project** branch of the adopt guard-rail block, and BOTH branches (existing→warn,
fresh→seam) **fall through** to `const session = await this.sessionManager.initialize();`
(prp-pipeline.ts:634). The contract literally says "createAdoptedSession (or extend
initialize)" and lists "creates the session directory + writes prd_snapshot.md" — but
`initialize()` ALREADY does all of that (resolve+hash+validate+createSessionDirectory+
snapshotPRD+empty-backlog, session-manager.ts:298-548).

**Decision:** S2 seeds AFTER `initialize()` returns, via a focused `SessionManager.seedAdoptedBaseline()`
method that only does the ADOPT-SPECIFIC writes:
- writes `.adopted` marker → `join(sessionPath, '.adopted')`
- writes the completed baseline → `writeTasksJSON(sessionPath, baseline)` (validated by BacklogSchema.parse)
- updates in-memory `this.#currentSession.taskRegistry` to the baseline (so the very next
  `decomposePRD()` call sees a non-empty backlog and auto-skips — see §2)

This reuses `initialize()`'s dir+snapshot and does NOT duplicate it. It fully respects S1's
"fall through to normal session creation" contract — S2 just adds a post-initialize seeding
step gated on `adoptFresh`. S1's EXTENSION POINT comment is replaced by the real seeding code.

## 2. `decomposePRD()` auto-skips on non-empty backlog — zero architect tokens, for free

`prp-pipeline.ts:1024` decomposePRD():
```ts
const hasBacklog = backlog && backlog.backlog.length > 0;
if (hasBacklog) {
  this.logger.info('[PRPPipeline] Existing backlog found, skipping generation');
  this.totalTasks = this.#countTasks();
  this.currentPhase = 'prd_decomposed';
  return;                 // ← no architect agent, no tokens
}
```
So as long as S2's `seedAdoptedBaseline()` updates the in-memory `taskRegistry` to the
non-empty baseline BEFORE `run()` calls `decomposePRD()` (it does — initializeSession seeds,
then run() calls decomposePRD at :2333), the architect is never invoked. The contract's "No
breakdown agent is invoked, no agent tokens consumed" is satisfied by the EXISTING guard —
S2 does NOT need a new skip in decomposePRD. (If S2 forgot to update in-memory taskRegistry,
decomposePRD WOULD run the architect — that's the critical invariant.)

## 3. `executeBacklog()` needs an explicit `skipExecutionLoop` guard (contract-required)

A fully-complete baseline would ALSO make `executeBacklog()` a natural no-op
(`processNextItem()` returns false when nothing is non-Complete). But the contract explicitly
requires "Set SKIP_EXECUTION_LOOP=true on the pipeline instance", so S2 adds:
- `private skipExecutionLoop: boolean = false;` field on PRPPipeline.
- Set `this.skipExecutionLoop = true` in the adopt-fresh seeding branch.
- Early guard in `executeBacklog()`: `if (this.skipExecutionLoop) { log + currentPhase='backlog_complete' + return; }`.

This makes intent explicit AND is the signal S3 (validation/bug-hunt-still-run) keys off.
Note: `run()` calls `#runValidation()` + `runQACycle()` UNCONDITIONALLY after executeBacklog
(prp-pipeline.ts:2373-2375), so the skip guard cleanly lets them proceed — S2 does not gate them.

## 4. The seeded baseline structure (validated by `writeTasksJSON` → `BacklogSchema.parse`)

One Phase → Milestone → Task → Subtask, ALL `status: 'Complete'`. ID format enforced by regex:
- Phase `^P\d+$` → `P1`
- Milestone `^P\d+\.M\d+$` → `P1.M1`
- Task `^P\d+\.M\d+\.T\d+$` → `P1.M1.T1`
- Subtask `^P\d+\.M\d+\.T\d+\.S\d+$` → `P1.M1.T1.S1` (title exactly "Adopt existing codebase")

Subtask fields: `id, type:'Subtask', title, status, story_points (number), dependencies (string[]),
context_scope (string), prd_selectors (string[] — added by P1.M2.T1.S1; include [])`.
`writeTasksJSON` (session-utils.ts:746) runs `BacklogSchema.parse` then `atomicWrite` — so the
seeded structure MUST pass schema validation (this is a free correctness gate).

## 5. `.adopted` marker — presence is the signal

A small file at `sessionPath/.adopted`. Content is a short note + ISO timestamp. Its PRESENCE
identifies the session as an adopted baseline (not built). Delta-detection diffs the
`prd_snapshot.md` hash, NOT the marker, so the marker is purely an audit/identity sentinel.

## 6. is_session_complete = a PROPERTY of the seeded data, not a function call

There is no single `isSessionComplete()`. "Complete" is implied by: ALL items (Phase/Milestone/
Task/Subtask) having `status: 'Complete'`. With the complete baseline + the skip flag,
`executeBacklog` skips, `decomposePRD` auto-skips, and the next PRD edit produces a normal
delta session diffing against this adopted baseline (PRD §4.6 "this session becomes the
idempotent baseline that future deltas diff against"). The contract's "is_session_complete
should return true" is satisfied by seeding all-Complete statuses.

## 7. Mode A docs — `docs/CONFIGURATION.md` already has a SKIP_EXECUTION_LOOP row (line 145)

S2 adds a new `### Adopt Mode (\`--adopt-prd\`)` subsection (not a duplicate table row) under
`## CLI Options`, after `### Delta Response` (line 253) and before `## Model Selection` (265).
It documents the adopt LIFECYCLE: baseline seeding → SKIP_EXECUTION_LOOP → next edit = delta.
The existing SKIP_EXECUTION_LOOP table row (line 145) is referenced, not duplicated.

## 8. Scope boundary / cohesion

- **Touches:** src/core/session-manager.ts (+createAdoptedBaseline + seedAdoptedBaseline),
  src/workflows/prp-pipeline.ts (+skipExecutionLoop field + seeding in initializeSession +
  guard in executeBacklog), docs/CONFIGURATION.md (Mode A subsection), + 2 test files.
- **Reuses (NOT modified):** src/core/session-utils.ts (writeTasksJSON, snapshotPRD — called
  by seedAdoptedBaseline/initialize), src/cli/index.ts (S1 owns the flag).
- **DO NOT touch:** decomposePRD (auto-skip suffices), S1's guard-rail files (cli/index.ts,
  session-utils createSessionDirectory), bug-hunt/validation workflows (S3 territory).
- **S1 dependency:** S2 consumes `this.adoptPrd` (S1 field) + `hasAnySessions()` (S1 method)
  + the EXTENSION POINT seam (S1 comment S2 replaces). Assume S1 lands exactly as specified.