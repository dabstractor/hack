# Test Design — `tests/unit/core/tasks-json-recovery.test.ts`

## Existing fixtures/helpers (REUSE, do not reinvent)
From `tests/unit/core/tasks-json-recovery.test.ts`:
- `makeValidBacklog({ s1Status?, s2Status? })` → minimal schema-valid Backlog (P1.M1.T1 with
  S1, S2 subtasks). **Needs `s3Status` added** for a 3rd item (or inline a fixture).
- `makeRepo()` → `{ dir, git }` tmpdir + `simpleGit(dir)`, init + git config.
- `commitBacklog(git, dir, backlog, msg)` → writes `tasks.json` + `git add` + `git commit`.
- `findSubtask(backlog, id)` → DFS to find a subtask by id.
- `tasksPath()` → `join(dir, 'tasks.json')`.
- `readTasksJSON(dir)` imported from `src/core/session-utils.js` (strict BacklogSchema parse).

## Forcing PATH B in tests (the schema-violation trick)
PATH B runs ONLY when `diskClean === false`, i.e. `readTasksJSON(sessionDir)` throws (JSON parse
fail) OR `validateBacklogState(candidate).isValid === false`. To run PATH B while keeping the
snapshot extractable, the working-tree file must be **JSON-parseable but BacklogSchema-INVALID**,
AND the `{id, status}` nodes of interest must remain well-formed.

Verified `validateBacklogState` (src/core/state-validator.ts) rejects:
- A subtask missing a required field (`story_points`, `context_scope`, `dependencies`).
- A `type` value not in ItemTypeEnum (e.g. `'BogusType'`).
- Orphaned/circular dependencies.

**Safest trick**: take `makeValidBacklog({...})`, then delete a required field from an UNRELATED
subtask (e.g. `delete (s1 as any).story_points`), `JSON.stringify` it, write to working tree.
`validateBacklogState` → `.isValid === false` → `diskClean = false` → PATH B. The snapshot's
lenient DFS still finds the `Ready`/`Researching` ids.

To write truncated garbage (separate "snapshot is []" test): `writeFile(..., '{ "trun')`.

## New test fixtures needed
### Writing PRP/research artifacts in the tmpdir (sessionDir = `dir`)
The FS-evidence helper probes `sessionDir`-relative paths. In the test, `sessionDir` is the tmp
`dir` (because `tasksPath() = join(dir, 'tasks.json')` → `dirname = dir`). So write artifacts
under `dir`:
```ts
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// Ready evidence — per-item-dir layout (models.ts format)
await mkdir(join(dir, 'P1M1T1S2'), { recursive: true });
await writeFile(join(dir, 'P1M1T1S2', 'PRP.md'), '# PRP');

// OR runtime layout:
await mkdir(join(dir, 'prps'), { recursive: true });
await writeFile(join(dir, 'prps', 'P1M1T1S2.md'), '# PRP');

// Researching evidence — per-item-dir layout
await mkdir(join(dir, 'P1M1T1S3', 'research'), { recursive: true });
```
Sanitized id helper (mirror the codebase): `const san = (id) => id.replace(/\./g, '_');`

## New tests to ADD (7 tests)
1. **'PATH B — re-applies snapshotted Ready id when its PRP.md exists (per-item-dir layout)'**
   - Commit baseline S2=`Planned`.
   - Write working-tree file: S2=`Ready`, schema-invalid elsewhere (force PATH B). Write
     `dir/P1M1T1S2/PRP.md`.
   - recover with delta {S1→Complete}.
   - Assert: `findSubtask(after, 'P1M1.T1.S2').status === 'Ready'` (re-applied from snapshot +
     FS evidence). `result.preservedResearchingReadyIds` contains `P1.M1.T1.S2`.

2. **'PATH B — re-applies snapshotted Researching id when its research/ dir exists'**
   - Commit baseline S3=`Planned` (extend fixture with S3, or use S2).
   - Working tree: S3=`Researching`, schema-invalid elsewhere. Write `dir/P1M1T1S3/research/`.
   - recover with delta {S1→Complete}.
   - Assert: `findSubtask(after, 'P1.M1.T1.S3').status === 'Researching'`.

3. **'PATH B — re-applies Ready from runtime layout (prps/{sanitizedId}.md)'**
   - Same as #1 but write `dir/prps/P1M1T1S2.md` instead. Proves both layouts work.

4. **'PATH B — leaves item at reverted status when NEITHER PRP.md nor research/ exists'**
   - Commit baseline S2=`Planned`. Working tree: S2=`Ready`, schema-invalid elsewhere. Do NOT
     write any PRP.md or research/.
   - recover with delta {S1→Complete}.
   - Assert: `findSubtask(after, 'P1.M1.T1.S2').status === 'Planned'` (reverted baseline wins —
     no FS evidence). Snapshot still captured the id, but re-apply is a no-op.

5. **'PATH B — snapshot re-apply is gated: Researching reverts to Planned if only PRP.md missing
   and research/ missing'** (the downgrade case — FS evidence supersedes the snapshot's status).
   - Commit baseline S2=`Researching` (committed!). Working tree: corrupt (truncated).
   - recover with delta {S1→Complete}. No PRP.md, no research/.
   - Assert: `findSubtask(after, 'P1.M1.T1.S2').status === 'Planned'` (committed Researching
     is NOT auto-preserved anymore — S2 EXPLICITLY gates on FS evidence; this REPLACES the old
     incidental-preservation behavior). **THIS IS THE BEHAVIOR CHANGE S2 INTRODUCES** —
     document it in the test name + a comment.

6. **'PATH B — legitimate delta takes precedence over snapshot re-apply'**
   - Commit baseline S1=`Planned`. Working tree: S1=`Researching` (same id as the legitimate
     delta), schema-invalid elsewhere. Write `dir/P1M1T1S1/research/`.
   - recover with delta {S1→Complete}.
   - Assert: `findSubtask(after, 'P1.M1.T1.S1').status === 'Complete'` (NOT re-applied to
     Researching — legitimate delta wins because id === legitimateDelta.itemId is skipped).

7. **'PATH A and PATH C do NOT re-apply (no snapshot consumed)'**
   - PATH A variant: clean disk, S2=`Ready` committed but no PRP.md. recover with delta
     {S1→Complete}. Assert S2 stays `Ready` (it was already on disk; PATH A doesn't touch it).
     This is the existing PATH A behavior — confirm unchanged.
   - PATH C variant: no committed history, working-tree has `Ready` id + PRP.md. recover. Assert
     `result.restored === false`, `result.reason` matches /no valid version/, and on-disk file is
     untouched (still the corrupt/invalid bytes). The snapshot is returned in
     `preservedResearchingReadyIds` but nothing is written.

## Coverage implications (100% enforced on src/**/*.ts)
The new `resolveResearchStatus` helper has branches:
- PRP candidate A exists → `'Ready'` (per-item-dir layout).
- PRP candidate B exists → `'Ready'` (runtime layout).
- research/ candidate exists (dir) → `'Researching'`.
- neither → `null`.
- `stat` throws → handled (returns null for the missing candidate; the helper overall never
  throws).
Tests #1, #2, #3, #4 cover the Ready/Researching/null branches. The two PRP-layout branches are
covered by #1 and #3. Add a test (or fold into #4) that a STRAY FILE named `research` (not a dir)
does NOT flip an item to Researching (covers the `isDirectory()` check).

## The EXISTING test that must CHANGE
**'PATH B — preserves Researching status across a git restore'** (the incidental-preservation
test): after S2, this test STILL passes IF the committed blob's Researching item ALSO has FS
evidence. But the test writes NO PRP.md/research/. With S2's FS-gating, a committed
`Researching` with no FS evidence gets... let me check the S2 design:
- S2 re-applies ONLY the SNAPSHOT ids (working-tree `Researching`/`Ready`), NOT all committed
  Researching items. The existing test corrupts the working tree entirely (`'NOT JSON {{{'`), so
  the snapshot is `[]` — S2 re-applies nothing. The committed `Researching` is restored from git
  by the restore write (committed blob carries it) and is NOT touched by S2. **So the existing
  test STILL passes** (snapshot empty → S2 no-op → committed Researching preserved by restore).
- CONFIRM in the PRP: S2 iterates `preservedResearchingReadyIds` ONLY. It does NOT scan the
  restored backlog for Researching/Ready items to gate. (That would be a different, broader
  behavior.) The existing test passes because its snapshot is `[]`.