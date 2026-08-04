# Design Note — P1.M1.T1.S3: Realistic-collision integration test (BUG-001 regression)

> Captures the non-obvious test-design decisions + the exact renumber trace. Read before implementing.

## 0. What S3 consumes (S1 LANDED, S2 = CONTRACT)

- **S1 (LANDED)**: `src/core/backlog-merger.ts` exports the 5 pure renumber helpers —
  `maxPhaseNumber(reserved)`, `maxChildNumber(parentId, reserved, level)`, `renumberPhase`,
  `renumberMilestone`, `renumberTask`. (Verified in source — appended under the
  "ID-renumbering helpers (BUG-001 fix — P1.M1.T1.S1)" banner.)
- **S2 (CONTRACT — assume landed, parallel)**: rewires the 3 skip-on-collision branches
  (`mergeBacklogs` phase `else`, `mergePhase` milestone `else`, `mergeMilestone` task `continue`)
  to **renumber-and-append**, and DELETES the now-dead `logger`. After S2, **no architect item is
  ever dropped** — it extends (title match) or renumber-appends.
- **S3 (this)**: the realistic-collision integration test. The 001 fixture
  (`makeArchitectBacklog`) AVOIDS the collision (reuses title 'Foundation' + fresh id 'P1.M2'); a
  real architect numbers from `P1` with its OWN title → every ADDED item collides and (pre-S2) was
  dropped. S3 adds the production scenario as a regression guard.

## 1. The exact renumber trace (so assertions match the produced ids)

Fixture (the production case):
- **parent** (`makeParentBacklog()`): `P1 'Foundation'` → `P1.M1 'Core'` → `[P1.M1.T1, P1.M1.T2]`
  (+ subtasks `P1.M1.T1.S1`, `P1.M1.T2.S1`).
- **architect** (`makeCollidingArchitectBacklog()`): `P1 'Reporting'` (NEW title, colliding id) →
  `P1.M1 'Reports'` (colliding id) → `P1.M1.T1 'New Report Task'` (+ subtask `P1.M1.T1.S1`).

Trace `mergeBacklogs(parent, architect)` AFTER S2:
1. `existingIds = collectIds(parent) = {P1, P1.M1, P1.M1.T1, P1.M1.T1.S1, P1.M1.T2, P1.M1.T2.S1}`.
2. `result = [P1 'Foundation']`; `phaseByTitle = {'Foundation' → 0}`.
3. archPhase `P1 'Reporting'`: `phaseByTitle.get('Reporting')` = undefined (NEW title) →
   `existingIds.has('P1')` = TRUE → **renumber-and-append**:
   - `maxPhaseNumber(existingIds)`: every id matches `^P(\d+)(?:\.M|$)` with capture `'1'` → max=1 → **2**.
   - `renumberPhase(archPhase, 2, existingIds)` → `id='P2'`; milestone `P1.M1`→`P2.M1`; task
     `P1.M1.T1`→`P2.M1.T1`; subtask `P1.M1.T1.S1`→`P2.M1.T1.S1`. Registers all into `existingIds`.
   - `result.push` → `result = [P1 'Foundation', P2 'Reporting']`.

**Merged ids** = `{P1, P1.M1, P1.M1.T1, P1.M1.T1.S1, P1.M1.T2, P1.M1.T2.S1, P2, P2.M1, P2.M1.T1, P2.M1.T1.S1}`.
→ No duplicates; 'Foundation'@P1 INTACT; 'Reporting'@**P2** (remapped, not P1); 'Reports'@P2.M1;
new task @P2.M1.T1. These are the exact values the assertions check.

## 2. File location + collision avoidance

The item says "the existing integration test file + its fixtures" → ADD to
`tests/integration/core/delta-breakdown-integration.test.ts`. **Do NOT** touch
`tests/unit/core/backlog-merger.test.ts` — S2 is rewriting it IN PARALLEL (collision risk).
The integration file is S3's alone.

## 3. Pure-function test is the core; full-path case is the strengthening

The item's primary LOGIC is "Call `mergeBacklogs(parent, architect)`" — a PURE call with literal
fixtures, no mocks. `mergeBacklogs` is pure (after S2, no logger/fs); the file's module-level
`vi.mock`s (session-manager, agent-factory, …) are INERT for a direct `mergeBacklogs` call (it
imports only `models.ts`). So a new `describe('mergeBacklogs — realistic architect collision …')`
block with a direct call is clean, deterministic, and the strongest BUG-001 guard.

The "if the test drives the full decomposePRD path" option is a recommended STRENGTHENING: swap the
architect fixture in the existing `setupAndDrive` (parametrize it — backward-compatible default =
`makeArchitectBacklog()`) and assert the final `tasks.json` contains the renumbered 'Reporting'
phase end-to-end. This catches wiring regressions too.

## 4. The `Reporting`-vs-`Foundation` distinction is the whole point

The 001 fixture reuses title `'Foundation'` → `mergeBacklogs` EXTENDS by title (appends P1.M2) — a
path that NEVER collides. The realistic fixture uses title `'Reporting'` (NEW) → the renumber-and-
append path (S2's rewire). S3 is the ONLY test that exercises the renumber-append phase branch
end-to-end. Both the unit (S2-rewired) and this integration test are needed; S3 guards the
production scenario the QA probe proved was broken (`Reporting phase present? false`).

## 5. No-duplicate-ids invariant (defensive)

Assert `new Set(collectIds(merged)).size === collectIds(merged).length`. S2's renumber guarantees
uniqueness (max+1 per level + per-iteration registration), but the assertion locks the invariant
regression-tight. The existing `collectIds` helper in the file is reusable.