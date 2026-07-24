# Integration Design — WHERE the snapshot re-apply runs

## The caller: `task-orchestrator.ts:#recoverAfterAgentRun` (line ~1183)
```ts
const recovery = await recoverTasksJson(
  tasksPath,
  { itemId, status: legitimateStatus },
  { baselineBacklog: this.#backlog, repoPath: process.cwd() }
);
if (recovery.restored) { /* log */ }
const recovered = recovery.backlog ?? (await readTasksJSON(...).catch(()=>null));
if (recovered) { /* set taskRegistry + refreshBacklog */ }
```
The caller does NOT consume `preservedResearchingReadyIds` today. S2 has two integration
options:

### Option A (REJECTED): re-apply in the caller (`task-orchestrator.ts`)
- After recovery, read `recovery.preservedResearchingReadyIds`, then do a SECOND
  `withLockedTasksJSON` RMW to re-apply each id gated on FS evidence.
- **Problem**: this is a SECOND locked write — a lost-update window opens between recovery's
  write and this re-apply (the supervisor could land a `Ready` in between, and we'd clobber it
  by reading a stale snapshot). It also duplicates locking logic in the caller. PRD §5.1 says
  the restore logic itself "re-applies them afterward" — the re-apply belongs INSIDE recovery.

### Option B (CHOSEN): re-apply INSIDE `recoverTasksJson`, PATH B, INSIDE the same locked RMW
- The snapshot re-apply happens in the SAME `withLockedTasksJSON` mutator that already applies
  the legitimate delta — so it is serialized with the restore write (no inter-write window) and
  no second lock acquisition.
- `preservedResearchingReadyIds` is already in scope inside PATH B (it was captured just before
  `gitFileHistory`). After `setItemStatus(target, legitimateDelta...)`, iterate the snapshot ids;
  for each, call a `reApplyResearchStatus(target, id, sessionDir)` helper that probes FS evidence
  and calls `setItemStatus(target, id, 'Ready'|'Researching')` accordingly.
- This matches the work item contract item 3 exactly: *"After the git revert restores a baseline
  tasks.json, iterate the snapshotted Researching/Ready IDs … re-apply with FS gating."* And PRD
  §5.1: *"the restore logic snapshots … then re-applies them afterward gated on filesystem
  evidence."* The restore logic = `recoverTasksJson` itself. The caller is unchanged (it already
  picks up `recovery.backlog`, which now includes the re-applied statuses).

## Why PATH A and PATH C do NOT re-apply
- **PATH A** (clean disk): there is no revert, so the supervisor's `Ready`/`Researching` writes
  are ALREADY on disk (disk is schema-valid → the supervisor's write is intact). PATH A returns
  `preservedResearchingReadyIds: []` anyway. Re-applying would be a no-op at best and could
  clobber a just-landed write at worst. **No-op.**
- **PATH C** (total failure / no valid version): there is no restored backlog to re-apply onto.
  `preservedResearchingReadyIds` is `[]` on the outer-catch site and may be populated on the
  no-valid-version site, but there is no `backlog` to write. **No-op** (the snapshot is returned
  for observability; the on-disk state is left as-is per PRD §5.1 "leaves state as-is"). S2 does
  NOT write anything in PATH C.

## Locking & atomicity (PRD §5.1 "tasks.json Write Concurrency")
- The re-apply runs INSIDE the existing `withLockedTasksJSON(sessionDir, mutator)` call in PATH B.
  The mutator already holds the process-level mutex (flock + in-process async mutex from
  P3.M1.T2). No additional locking.
- The FS-evidence probes (`stat`) are pure reads; running them inside the locked mutator is safe
  (they don't touch `tasks.json`). They are NOT lock-contended resources.
- The atomic write (temp+rename) is handled by `withLockedTasksJSON`'s `writeTasksJSON`. S2 adds
  no new write path.

## The FS-evidence helper signature
```ts
// module-private
async function resolveResearchStatus(
  itemId: string,
  sessionDir: string
): Promise<Status | null>
```
- Returns `'Ready'` if a PRP candidate exists, `'Researching'` if a research/ candidate exists,
  `null` if neither (leave at reverted status).
- Never throws (best-effort `stat`).

## Re-apply idempotency & the legitimate-delta precedence
- The legitimate delta (`setItemStatus(target, legitimateDelta.itemId, legitimateDelta.status)`)
  runs FIRST. If a snapshotted id happens to be the SAME as the legitimate-delta id (the
  supervisor had it `Researching`, and now the orchestrator is completing it), the legitimate
  delta wins (it was applied first; the snapshot re-apply would then set it back to `Ready`/
  `Researching` — WRONG).
- **Fix**: skip the snapshotted id if it equals `legitimateDelta.itemId`. The legitimate status
  is authoritative for the item just implemented/interrupted. (This also handles the case where
  the supervisor was researching the very item that just finished implementing.)
- Order inside the mutator:
  1. `setItemStatus(target, legitimateDelta.itemId, legitimateDelta.status)` (existing).
  2. For each `id` in `preservedResearchingReadyIds` where `id !== legitimateDelta.itemId`:
     `const status = await resolveResearchStatus(id, sessionDir); if (status) setItemStatus(target, id, status);`
  3. `return target;`