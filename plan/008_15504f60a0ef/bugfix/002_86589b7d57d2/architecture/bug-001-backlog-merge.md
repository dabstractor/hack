# BUG-001 — Preserve ADDED requirements through the delta merge

**Severity:** Critical · **Status:** confirmed against HEAD `727db29`

## Root cause (verified by reading source)
`mergeBacklogs(patched, architect)` (`src/core/backlog-merger.ts:207`) merges the patched
backlog with the Architect's added-requirement output. The Architect
(`TASK_BREAKDOWN_PROMPT`, `src/agents/prompts.ts:134`) numbers IDs **fresh from `P1`** and
sees ONLY `delta_prd.md` (never the existing ID space) — confirmed in `decomposePRD`
(`prp-pipeline.ts:1295` `prdContent = await loadDeltaPRD(sessionPath)`). So the architect's
output always starts `P1`, `P1.M1`, `P1.M1.T1` … which **collide** with the patched backlog.

Matching rules today:
- **Phase / Milestone**: match by **title** (extend) — CORRECT. But a new-title item whose
  **ID also collides** hits a defensive `else` skip:
  - phase skip: `backlog-merger.ts:217` (`mergeBacklogs`)
  - milestone skip: `backlog-merger.ts:153` (`mergePhase`)
- **Task**: de-dup by **ID only** (no title match): `backlog-merger.ts:113` (`mergeMilestone`)
  `continue`s (drops) on any collision.

Since the architect decomposes ONLY added requirements, **every architect task is genuinely
new**, yet a colliding ID drops it. Result: ADDED requirements are lost (now with a `warn`,
but the data loss is identical to the original 001 bug). This defeats PRD §4.3 step 6
("Identifies new requirements → Adds new tasks").

Both call sites pass `mergeBacklogs(patched, architect)`:
- `decomposePRD` → `prp-pipeline.ts:1345`
- `integrateIntoCurrentSessionResponse` → `prp-pipeline.ts:1046`

`patchBacklog`'s `'added'` case (`src/core/task-patcher.ts:112`) is a deliberate no-op that
delegates ALL added-requirement handling to this merge — so if the merge drops them, they are
gone with no fallback.

## Why the existing tests mask it
- `tests/integration/core/delta-breakdown-integration.test.ts` `makeArchitectBacklog()`
  (~line 235) reuses the patched phase **title** `'Foundation'` AND uses a **non-colliding**
  milestone id `'P1.M2'` — a combination a real architect never produces. The test passes but
  never exercises the production scenario.
- `tests/unit/core/backlog-merger.test.ts` has three tests that **assert the drop as correct**
  ("skips an architect phase/milestone whose id collides despite a new title", "de-duplicates
  a task whose id already exists"). These lock in the bug and must be corrected.

## Chosen fix: renumber-on-collision-and-append (PRD Recommendation option 1)
> "fix mergeBacklogs so a new-TITLE architect item with a colliding ID is treated as a NEW
> item (re-map/renumber its ID against the patched ID space) rather than skipped"

### Why NOT a blanket pre-pass renumber
A pre-pass that renumbers ALL architect phases to continue from `maxPhase+1` is **wrong** for
title-matched (extend) phases: the extended result keeps the EXISTING patched phase id (e.g.
`P1`), but the architect's folded-in milestones would carry the renumbered prefix
(`P5.M1`) → an **inconsistent hierarchy** (milestone `P5.M1` under phase `P1`). The id-regex
won't catch it, but it is semantically broken. **Renumbering must happen at the APPEND point
using the correct parent context.**

### Design (inline, parent-context-aware)
Add pure helpers to `backlog-merger.ts`:

```
// Next available number at each level, computed from the reserved set:
maxPhaseNumber(reserved): number          // scan ^P(\d+) / ^P(\d+)\.M  → max + 1
maxChildNumber(parentId, reserved, level): number   // e.g. parentId="P1", level=task → max ^P1\.M(\d+)\.T

// Deep renumber against a target parent prefix (registers new ids into `reserved`):
renumberPhase(phase, phaseNum, reserved): Phase        // P{phaseNum}.* (all descendants)
renumberMilestone(ms, parentPhaseId, msNum, reserved): Milestone
renumberTask(task, parentMilestoneId, taskNum, reserved): Task
```

Then change the three append points from **skip-on-collision** to **renumber-and-append**:

1. `mergeBacklogs` phase loop — new-title phase:
   - if id does NOT collide → append as-is (register ids).
   - if id collides → `renumberPhase(archPhase, maxPhaseNumber(existingIds), existingIds)` then append.
2. `mergePhase` milestone loop — new-title milestone (under matched/existing phase):
   - if id does NOT collide → append as-is.
   - if id collides → `renumberMilestone(archMs, existing.id, maxChildNumber(existing.id,...,'milestone'), existingIds)` then append.
3. `mergeMilestone` task loop — architect task (always a new added-requirement task):
   - if id does NOT collide → append as-is.
   - if id collides → `renumberTask(archTask, existing.id, maxChildNumber(existing.id,...,'task'), existingIds)` then append.
   - **Remove the `continue` drop.** (Architect tasks are always new; renumber rather than drop.)

Invariant: after the change, `mergeBacklogs` NEVER drops an architect item — it either
extends (title match, existing id kept) or appends (renumbered to a unique, hierarchy-consistent
id). The `warn`-on-skip branches become unreachable; keep a final defensive `warn` only if an
id is still duplicated after renumber (should be impossible — log + skip as a last resort).

`mergeBacklogs(empty, x)` must remain byte-equivalent to `x` (the non-delta-no-backlog path
relies on it — no collisions when patched is empty, so all items append as-is unchanged).

### Test plan (TDD, folded into the implementing subtasks)
- New unit tests: renumber helpers produce hierarchy-consistent, collision-free ids; round-trip.
- **Correct** the 3 existing tests to assert **renumber-and-append** (the new added item
  SURVIVES with a remapped id), not drop.
- New **realistic** integration test: patched backlog `P1 "Foundation"` with `P1.M1`; architect
  emits `P1 "Reporting"` (new title, colliding id) + `P1.M1 "Reports"` + `P1.M1.T1` (the exact
  production case). Assert the merged backlog contains the `Reporting` phase, the `Reports`
  milestone, and the new task — all with remapped, unique ids, and the patched `Foundation`
  phase intact. (This is the empirical probe the QA run used: it returned
  `Reporting phase present? false` — the test must now assert `true`.)

## Files
- `src/core/backlog-merger.ts` — renumber helpers + 3 append-point changes.
- `tests/unit/core/backlog-merger.test.ts` — correct the 3 collision-skip tests; add renumber tests.
- `tests/integration/core/delta-breakdown-integration.test.ts` — add the realistic-collision case.
- (Read-only context) `src/workflows/prp-pipeline.ts:1046,1345`; `src/core/task-patcher.ts:112`;
  `src/agents/prompts.ts:134`; `src/core/models.ts`.