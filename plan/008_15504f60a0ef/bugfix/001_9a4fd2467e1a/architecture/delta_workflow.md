# Delta Workflow Deep-Dive — Issues 1 & 2

## Issue 1: Delta-Session Breakdown Unreachable (CRITICAL)

### Confirmed Control Flow

```
handleDelta()
  └─ spawnDeltaSession()                    [DEFAULT path]
       ├─ Step 4: delta = DeltaAnalysisWorkflow.run()
       ├─ Step 5: patchedBacklog = patchBacklog(backlog, delta)
       ├─ Step 6: createDeltaSession(prdPath)
       ├─ Step 6b: writeDeltaPRD(...)       ← delta_prd.md IS written
       └─ Step 7: saveBacklog(patchedBacklog) ← NON-EMPTY

decomposePRD()                              [called AFTER handleDelta in run()]
  ├─ hasBacklog = patchedBacklog.backlog.length > 0   ← ALWAYS TRUE
  ├─ if (hasBacklog) { early return }       ← TAKEN, isDelta branch UNREACHABLE
  └─ isDelta branch (loadDeltaPRD)          ← DEAD CODE IN PRODUCTION
```

### The `patchedBacklog` Is Always Non-Empty

`spawnDeltaSession()` calls `patchBacklog(backlog, delta)` where:
- `backlog` = the parent session's taskRegistry (ALWAYS has at least one phase — a completed session has tasks)
- `patchBacklog` processes modified→Planned and removed→Obsolete via `updateItemStatus()`, which modifies items in-place (immutably). It does NOT remove items.
- Therefore `patchedBacklog.backlog.length === backlog.backlog.length > 0` → `hasBacklog === true`

### Fix Strategy: Approach A (PRD-recommended)

**Reorder `decomposePRD()` to check delta BEFORE checking hasBacklog.**

```
decomposePRD():
  isDelta = parentSession != null
  if (isDelta):
    prdContent = loadDeltaPRD(sessionPath)     // delta_prd.md (the diffs)
    architectBacklog = architectAgent.prompt(createArchitectPrompt(prdContent, sessionPath))
    // architect generates tasks ONLY for added requirements (delta_prd.md contains only Added/Modified/Removed)
    // MERGE architectBacklog with patchedBacklog:
    //   - For modified items: keep patched status (Planned) — already in patchedBacklog
    //   - For removed items: keep Obsolete status — already in patchedBacklog
    //   - For added items: these are NEW tasks from the architect — APPEND them
    mergedBacklog = mergeBacklogs(patchedBacklog, architectBacklog)
    saveBacklog(mergedBacklog)
    return
  // NON-delta: original hasBacklog logic
  if (hasBacklog) { early return }
  // ... generate from full PRD
```

**Key insight**: The patched backlog already handles modified (→Planned) and removed (→Obsolete). The architect, invoked over `delta_prd.md`, will generate tasks for ADDED requirements (since delta_prd.md's "Added" section contains only new content). The merge needs to:
1. Take the patched backlog as the base (preserves modified/removed statuses + all existing tasks)
2. Append new phases/milestones/tasks/subtasks from the architect's output that don't already exist

### Merge Logic Considerations

The architect, when given `delta_prd.md`, will produce a fresh backlog (Phases → Milestones → Tasks → Subtasks) for the added requirements. This output needs to be merged with the patched backlog:

- **Scenario 1**: Added requirements form entirely new Phases → simply append the architect's phases to the patched backlog's `backlog[]` array.
- **Scenario 2**: Added requirements extend existing Phases/Milestones → need to merge tasks into existing milestones. This is more complex.

**Practical approach**: Since delta_prd.md only contains Added/Modified/Removed sections (NOT the full PRD), the architect will generate a partial breakdown focused on new requirements. The merge should:
1. Check if the architect's output phases already exist in the patched backlog (by title or ID).
2. If they do, merge tasks into the existing milestone.
3. If they don't, append as new phases.

The `renderDeltaPRD()` output format (from `session-utils.ts`) includes:
- `## Added` sections with `### {itemId}` headers
- `## Modified` sections
- `## Removed` (for awareness)
- `## Patch Instructions`
- `## Tasks to Re-execute`

The architect will read this and generate the task hierarchy for the Added section content.

### Integration Test Requirements

The test MUST drive the FULL path: `spawnDeltaSession() → createDeltaSession() → writeDeltaPRD() → saveBacklog(patchedBacklog) → decomposePRD()`. It must:
1. Start with a session that has a non-empty backlog (simulating a completed session).
2. Edit the PRD to add a new requirement.
3. Run handleDelta (which calls spawnDeltaSession).
4. Call decomposePRD().
5. Assert: the architect agent was invoked with delta_prd.md content (NOT the full PRD).
6. Assert: new tasks exist in the delta session's tasks.json for the added requirement.

The existing test `decomposePRD delta branch > CASE A` uses `makeDeltaSession()` with an EMPTY backlog, which masks the bug. The fix must use a NON-EMPTY backlog.

---

## Issue 2: patchBacklog 'added' Case Unimplemented (MAJOR)

### Current State

`src/core/task-patcher.ts` line ~97:
```ts
case 'added':
  // Placeholder: Log warning and continue
  logger().warn({ changeType: change.type, taskId }, 'Feature not implemented');
  break;   // ← silently drops the added requirement
```

### Why It Can't Be Implemented In patchBacklog Alone

`patchBacklog()` is a **synchronous pure function**: `(backlog: Backlog, delta: DeltaAnalysis) => Backlog`. It has:
- No access to the architect agent (can't generate new tasks)
- No access to the new PRD section content (delta.changes only has `itemId`, `description`, `impact` — NOT the actual PRD text)
- No async capability

The `RequirementChange` for 'added' items contains:
```ts
{ itemId: 'P1.M2', type: 'added', description: 'New feature section added', impact: 'Requires new tasks' }
```
But NOT the actual new PRD section text needed to decompose into tasks.

### Fix Strategy: Delegate to Delta Breakdown (with Issue 1)

With Issue 1 fixed, the DEFAULT delta path (`spawnDeltaSession → decomposePRD`) handles added requirements via the architect over `delta_prd.md`. So `patchBacklog`'s 'added' case becomes a documented no-op:

1. **Remove the misleading "Feature not implemented" warning** — change to a debug-level log explaining added requirements are handled by the delta breakdown.
2. **For the integrate path** (`integrateIntoCurrentSessionResponse`): This path does NOT create a delta session, so it needs separate handling for 'added' requirements. The fix should either:
   - Extract 'added' changes and invoke a mini-breakdown for them in `integrateIntoCurrentSessionResponse()`, OR
   - Document that this path requires a delta session for added requirements and warns the user.

### Decision: Both Paths

The cleanest architecture:
- **Delta path** (`spawnDeltaSession`): patchBacklog handles modified/removed; decomposePRD handles added via delta_prd.md breakdown. patchBacklog's 'added' case = debug log (no-op, delegated to breakdown).
- **Integrate path** (`integrateIntoCurrentSessionResponse`): After patching, check if delta has 'added' changes. If so, extract the added PRD sections, invoke the architect to generate tasks, and merge them into the current session's backlog.

This requires `integrateIntoCurrentSessionResponse()` to have access to the new PRD content (it already resolves it via `resolvePRD`), and the delta analysis (it already produces `delta.changes`). The added PRD section content is available from the `DeltaAnalysisWorkflow` / `prd-differ.ts` which tracks `newContent` for added sections.

### The 'added' Change itemId Problem

The `DeltaAnalysisWorkflow` converts `prd-differ.ts` section-level changes (which have `sectionTitle`, `newContent`) into `RequirementChange` objects (which have `itemId`, `description`, `impact`). For 'added' items, the `itemId` is NOT a real task ID (the task doesn't exist yet). It's typically a PRD section path or a placeholder.

For the integrate path fix, we need to either:
- Use the PRD section path from `prd-differ.ts` to find the new content
- Or render a mini delta_prd.md for the added sections and feed it to the architect

---

## Dependency: Issue 2 depends on Issue 1

Issue 2's fix ("delegate 'added' to delta breakdown") ONLY works if Issue 1 is fixed (the delta breakdown actually runs). Therefore:
- **Issue 1 must be implemented FIRST.**
- **Issue 2's delta-path fix** (remove silent drop, debug log) can be done alongside Issue 1.
- **Issue 2's integrate-path fix** (invoke architect for added requirements) can be done after Issue 1 is confirmed working.

## Key Variable Names & Paths for Implementation

| Symbol | Location | Purpose |
|--------|----------|---------|
| `PRPPipeline.decomposePRD()` | `prp-pipeline.ts:~1100` | THE method to reorder |
| `PRPPipeline.spawnDeltaSession()` | `prp-pipeline.ts:~963` | Default delta path (calls patchBacklog step 5) |
| `PRPPipeline.integrateIntoCurrentSessionResponse()` | `prp-pipeline.ts:~906` | Integrate path |
| `patchBacklog()` | `task-patcher.ts:46` | The 'added' case at line ~97 |
| `loadDeltaPRD()` | `session-utils.ts:1480` | Reads `delta_prd.md` |
| `writeDeltaPRD()` | `session-utils.ts:1450` | Writes `delta_prd.md` |
| `renderDeltaPRD()` | `session-utils.ts:1386` | Builds delta_prd.md content |
| `createArchitectAgent()` | `agents/agent-factory.ts` | Creates architect for breakdown |
| `createArchitectPrompt()` | `agents/prompts/architect-prompt.ts` | Builds breakdown prompt |
| `BacklogSchema` | `models.ts` | Used to parse architect output |
| `makeDeltaSession()` | `tests/unit/core/delta-prd.test.ts:97` | Test helper (currently seeds empty backlog) |