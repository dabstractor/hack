# Research Notes — P1.M2.T4.S1 `hack update` CLI command

The load-bearing facts proven by direct codebase reads. All line numbers are
against the CURRENT working tree (pre-P1.M2.T3.S2-merge); re-confirm anchors
after merge but the structure is stable.

---

## 1. Architecture pin (§F2.D) — the EXACT contract for this item

`plan/012_7dd502f7feb9/architecture/implementation-status.md` §F2.D prescribes:

- **Registration** (mirror `taskAction` shared handler at line ~626):
  ```ts
  program
    .command('update')
    .description('Manually update a task status (PRD §5.4)')
    .argument('<task-id>', 'Task ID (loose match: P1.M1.T1.S1, 1.1.1.1, p1m1t1s1, 1.2)')
    .argument('<status>', 'Target status (loose match: done, re, comp, ready)')
    .option('-f, --file <path>', 'Override tasks.json file path')
    .option('--session <hash>', 'Target specific session by hash')
    .option('-o, --output <format>', 'Output format (text, json)', 'text')
    .action(updateAction);
  ```
- **Action handler logic:**
  1. File discovery — IDENTICAL to `taskAction` (lines ~634–710) BUT a missing
     discovered tasks.json is a HARD ERROR (not the calm `awaiting_breakdown`).
  2. Parse — `normalizeTaskId` + `findItemByLooseId` (target), `matchStatus` (status).
  3. Lock + RMW — `withLockedTasksJSON(sessionDir, (backlog) => { find target by
     canonicalId; set status; if Complete cascadeCompleteDown; recomputeAncestorsUp;
     return mutated backlog })`.
  4. Output — `Updated <ID> status to <Status>` (text) or `{id,status,title}` (json).
  5. Errors — not found / ambiguous / unknown status / file not found / lock timeout
     → stderr + non-zero exit.
- **Session dir:** `dirname(tasksFile)` (same as taskAction).
- **Schema validation:** `writeTasksJSON` already validates via `BacklogSchema.parse()`
  before the atomic write — the cascade must produce a schema-valid backlog.

## 2. The `taskAction` shared handler to mirror (src/cli/index.ts:626–830)

- **Dynamic imports inside the handler** (NOT top-level): `readFile` from
  `node:fs/promises`, `SessionManager` from `../core/session-manager.js`,
  `findLatestBugfixTasksFile` from `../core/session-utils.js`. The handler also
  uses top-level imports already present in index.ts: `dirname, basename, resolve,
  relative` (node:path), `existsSync` (node:fs), `chalk`, `logger()` (cached).
- **File-discovery ladder (lines ~638–688):**
  1. `options.file` → `resolve(options.file)` (explicit override).
  2. else resolve target session: `options.session` → `SessionManager.listSessions(planDir)`
     + `.find(s => s.hash.startsWith(session))` (throw `Session not found: …` if none);
     else `SessionManager.findLatestSession(planDir)` (throw `No sessions found…` if none).
  3. Prefer bugfix child: `findLatestBugfixTasksFile(sessionPath)` → if truthy, use it
     (`sourceNote = "Using bugfix tasks: …"`); else `resolve(sessionPath,'tasks.json')`
     (`sourceNote = "Using main tasks: …"`).
  - `planDir = resolve('plan')` (the preAction hook has already chdir'd to repo root).
- **The awaiting_breakdown branch (lines ~690–715)** — this is the EXACT block
  `hack update` must REPLACE with a hard error:
  ```ts
  if (!options.file && !existsSync(tasksFile) && existsSync(dirname(tasksFile))) {
    // calm notice + process.exit(0)   ← update does NOT do this
  }
  ```
  For `update`, a missing DISCOVERED tasks.json (and its dir exists) is a HARD
  ERROR: `process.stderr.write('…tasks.json not found…'); process.exit(1)`. An
  explicit `--file` to a missing file is ALSO a hard error (readFile ENOENT → catch).
- **Error/catch tail (lines ~821–825)** — the pattern to reuse:
  ```ts
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger().error(`Task command failed: ${errorMessage}`);
    process.exit(1);
  }
  ```
  Other command handlers (inspect/artifacts/validate-state/cache/config) use the
  SAME `errorMessage + logger().error('<Cmd> command failed: …') + process.exit(1)` arm.
- **Command registration (lines ~829–847):** `program.command('task').argument(…)
  .option(…).option(…).option('-o, --output <format>', '…', 'table').action(taskAction)`.
  `status` is an identical alias. `update` is a sibling registration.

## 3. Dependency interfaces (all LANDED in src/utils/task-utils.ts — verified exports)

- `normalizeTaskId(looseId: string): number[] | null` (line 135) — pure; extracts
  digit segments. `findItemByLooseId` calls it internally; `updateAction` does NOT
  need to call it directly.
- `findItemByLooseId(backlog: Backlog, looseId: string): { item: HierarchyItem;
  canonicalId: string } | null` (line 166) — pure; 1-based positional walk.
  Returns the item + its REAL `id` field as `canonicalId`. `null` = not found /
  unparseable.
- `matchStatus(input: string): { status: Status } | { error: string; candidates:
  string[] }` (line 979) — pure; **discriminated union**. Narrow with
  `'status' in result` / `'error' in result`. The `error` string is ALREADY a
  human-readable message (`Ambiguous status "r": matches Researching, Ready` or
  `Unknown status "bogus". Valid statuses: …`). The `candidates` array is the list
  for json output if desired.
- `cascadeCompleteDown(item: HierarchyItem): HierarchyItem` (landed, sibling S1) —
  pure; deep-clones with `status:'Complete'` on the item AND every descendant.
- `recomputeAncestorsUp(backlog: Backlog, changedId: string): Backlog` (sibling S2,
  assume landed) — pure; recomputes each ancestor as the min-status of its children;
  CAN DOWNGRADE. **Assumes the changed item's status is ALREADY set in the backlog**
  (it only recomputes ANCESTORS). No-op (same ref) for a Phase-level change or a
  not-found id.
- `findItem(backlog: Backlog, id: string): HierarchyItem | null` (line 90) — pure
  EXACT-id lookup (nested for-loop, early return). Use INSIDE the mutator to locate
  the target by `canonicalId` on the authoritative locked backlog.
- `setItemStatus(backlog: Backlog, itemId: string, status: Status): boolean`
  (line 1058) — **MUTATES IN PLACE** (casts away readonly, `item.status = status`).
  This is the established mutator idiom (delta-merge mutators use it inside
  withLockedTasksJSON). Returns `true` if found.
- Types: `export type HierarchyItem = Phase | Milestone | Task | Subtask;` (line 47)
  and `export type AnyItem = Phase | Milestone | Task | Subtask;` (line 1030).
  `Backlog` and `Status` come from `src/core/models.ts` (Status has 8 values:
  Planned|Researching|Ready|Implementing|Retrying|Complete|Failed|Obsolete).

## 4. withLockedTasksJSON contract (src/core/file-lock.ts:492)

```ts
export async function withLockedTasksJSON(
  sessionDir: string,
  mutator: (backlog: Backlog) => Backlog | Promise<Backlog>,
  opts?: TasksLockOptions,
  readFallback?: Backlog
): Promise<Backlog>
```
- Does: acquire exclusive lockfile (`sessionDir/tasks.json.lock`) → `readTasksJSON`
  (validated) → invoke `mutator(backlog)` → `writeTasksJSON` (BacklogSchema.parse +
  atomic temp+rename) → release lock (finally). Returns the PERSISTED backlog.
- The `mutator` may mutate the backlog IN PLACE (the withLockedTasksJSON example:
  `backlog.backlog[0]....status = 'Complete'; return backlog;`) OR return a NEW
  backlog — both are valid (the return value is what gets persisted).
- **Re-entrant safe** (AsyncLocalStorage); **crash-recovery** (stale-lock detect).
- `@throws {TasksLockAcquisitionError}` if lock not acquired within `timeoutMs`.
- `TasksLockAcquisitionError` is an exported class (line 140) — `error instanceof
  TasksLockAcquisitionError` detects the lock-timeout case.

## 5. Recommended mutator composition (functional — composes the landed pure helpers)

`cascadeCompleteDown` + `recomputeAncestorsUp` are BOTH pure/immutable, so the
cleanest mutator returns a NEW backlog (avoids in-place/pure mixing). It needs a
small immutable "replace item at exact id" splice (NO such helper is exported;
write it module-private in index.ts — ~10 lines, mirrors the nested-map rebuild of
`updateItemStatus`):

```ts
// module-private in src/cli/index.ts
function replaceItemById(backlog: Backlog, id: string, newItem: HierarchyItem): Backlog {
  const rebuild = <T extends HierarchyItem>(items: T[]): T[] =>
    items.map(it => {
      if (it.id === id) return newItem as T;
      if ('subtasks' in it) return { ...it, subtasks: rebuild(it.subtasks) } as T;
      if ('tasks' in it) return { ...it, tasks: rebuild(it.tasks) } as T;
      if ('milestones' in it) return { ...it, milestones: rebuild(it.milestones) } as T;
      return it; // Subtask leaf that is not the target
    });
  return { ...backlog, backlog: rebuild(backlog.backlog) };
}
```

Mutator body (the recommended one — uniform for all statuses):
```ts
(backlog: Backlog): Backlog => {
  const found = findItem(backlog, canonicalId);
  if (!found) throw new Error(`Task not found: ${taskId}`); // defensive; pre-lock validated
  const newItem: HierarchyItem =
    newStatus === 'Complete' ? cascadeCompleteDown(found) : { ...found, status: newStatus };
  const spliced = replaceItemById(backlog, canonicalId, newItem);
  return recomputeAncestorsUp(spliced, canonicalId);
}
```
Why this is correct: recomputeAncestorsUp assumes the target's status is already
set (it only touches ancestors) — `replaceItemById` sets the target (and, for
Complete, cascadeCompleteDown pre-cascades the whole subtree), so the
recompute reads the correct child statuses. For a Phase-level Complete, recompute
is a no-op (Phase has no ancestor) — correct, because cascading Complete down a
phase needs no ancestor fix. For a non-Complete demote of a subtask, the splice
sets the subtask, and recompute demotes ancestors — correct.

ALTERNATIVE (also valid, matches the in-place delta-merge idiom): `setItemStatus`
in place for the root + a small in-place cascade for Complete + `recomputeAncestorsUp`.
The functional compose above is preferred (uniform, fully immutable, no readonly cast).

## 6. CLI test harness pattern (tests/unit/cli/index.test.ts:964+ — the template)

The `breakdown-in-progress` describe block is the EXACT template for testing an
action handler. It:
- Uses `parseCLIArgs()` to drive the handler (Commander routes `.command('update')`
  to `updateAction` automatically — NO manual dispatcher; grep confirmed there is
  no `parseSubcommand`/switch in index.ts).
- `vi.mock('node:fs', …)` with `existsSync` overridden per-test; `vi.mock('node:fs/
  promises', () => ({ readFile: vi.fn(…) }))`.
- Hoisted mocks: `mockFindLatestSession`, `mockListSessions`,
  `mockFindLatestBugfixTasksFile` (mock `../core/session-manager.js` +
  `../core/session-utils.js`). logger mocked. repo-root mocked (no-op
  `bootstrapRepoRoot`).
- `process.exit = vi.fn()` (NO-OP) so the handler's exit() is captured, not thrown.
- `vi.spyOn(console, 'log')` (stdout) + `vi.spyOn(process.stderr, 'write')` (stderr).
- `await new Promise(r => setImmediate(r))` after `parseCLIArgs()` to let the async
  action finish.
- For update: ALSO mock `../core/file-lock.js` → `{ withLockedTasksJSON: vi.fn(…),
  TasksLockAcquisitionError: class extends Error {} }`. The mock's withLockedTasksJSON
  should invoke the real mutator on a fixture backlog (so the cascade composition is
  exercised) and return it — OR reject with `new TasksLockAcquisitionError(…)` for the
  timeout case.

Integration alternative (tests/integration/cli-task-status.test.ts is the template):
real temp `plan/` dir + real tasks.json + real file-lock + real writeTasksJSON; drive
parseCLIArgs; read the file back and assert the cascade + ancestor statuses. This
proves end-to-end RMW + atomic write. Recommended as a SECOND test file for the
cascade/ancestor/write correctness.

## 7. Existing top-level imports already in src/cli/index.ts (DO NOT re-add)

`resolve, relative, dirname, basename` (node:path), `readFileSync, existsSync`
(node:fs), `chalk`, `getLogger`/`Logger`, `os`, `ms`, `Command` (commander),
`bootstrapRepoRoot/getRepoRoot/getInvocationCwd`, config imports, command-class
imports, `parseScope`/`ScopeParseError`, `resolveEffectivePrd`.

NEW imports this task ADDS (top of index.ts, alongside existing):
- from `../utils/task-utils.js`: `normalizeTaskId` (optional — findItemByLooseId
  calls it), `findItemByLooseId`, `matchStatus`, `cascadeCompleteDown`,
  `recomputeAncestorsUp`, `findItem`, `type HierarchyItem`.
- from `../core/models.js`: `type Backlog`, `type Status` (for the mutator's typing).
- from `../core/file-lock.js`: `withLockedTasksJSON`, `TasksLockAcquisitionError`.
(`findLatestBugfixTasksFile` + `SessionManager` + `readFile` stay DYNAMIC imports
inside the handler, matching taskAction.)

## 8. Validation scripts (package.json — verified)

- `npm run fix` = lint:fix + format (prettier --write).
- `npm run validate` = lint && format:check && typecheck && test:run (the gate).
- `npm run typecheck` = `tsc --noEmit -p tsconfig.build.json`.
- `npm run lint` = `eslint . --ext .ts`.
- `npm run format:check` = `prettier --check "**/*.{ts,js,json,md,yml,yaml}"`.
- `npx vitest run tests/unit/cli/update-command.test.ts` (targeted).

## 9. PRD §5.4 acceptance criteria (the proof list — every one must pass)

- `hack update 1.1.1.1 done` → P1.M1.T1.S1 Complete + success line; `hack task`
  shows it Complete.
- `hack update p1m1t1s1 re` → P1.M1.T1.S1 Ready (synonym), case-insensitive.
- `hack update 1 done` → cascades Complete to EVERY item under P1.
- `hack update <last-incomplete-subtask> comp` → promotes Task/Milestone/Phase to
  Complete via ancestor recompute.
- `hack update <a-subtask> p` → demotes ancestors to least-progressed child.
- `hack update 9.9.9.9 done` → non-zero exit + "not found" message.
- `hack update 1.1.1.1 r` → non-zero exit + ambiguity listing Ready + Researching.
- `hack update 1.1.1.1 bogus` → non-zero exit + valid-statuses list.
- atomic write (temp+rename) under the §5.1 lock — no concurrent-writer data loss.

## 10. Hard boundaries / out of scope

- DO NOT modify task-utils.ts (siblings P1.M2.T1–T3 own it; their helpers are the
  contract). DO NOT modify cascadeCompleteDown/recomputeAncestorsUp/matchStatus/
  findItemByLooseId/normalizeTaskId/findItem/setItemStatus.
- DO NOT modify file-lock.ts or session-utils.ts (consume only).
- DO NOT edit any docs/*.md (DOCS = Mode B, handled by P1.M3.T1; this item ships
  ONLY JSDoc on the `updateAction` handler function).
- DO NOT create a `src/cli/commands/update.ts` class module — the architecture §F2.D
  says to mirror the INLINE `taskAction` pattern in index.ts (task/status are also
  inline, not class modules).
- DO NOT add user-facing command docs (P1.M3.T1's job).
- Keep the change ADDITIVE to index.ts: one new top-level `updateAction` const +
  one new `.command('update')` registration + the small module-private
  `replaceItemById` helper + JSDoc. Do not touch taskAction / the task|status
  registrations / main() / other commands.