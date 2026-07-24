# Code Context — tasks.json + git-read recon

Scope: how to read `tasks.json` (disk + git HEAD), parse it into a `Backlog`,
and look up an item's `status` by id. Read-only recon in `/home/dustin/projects/hacky-hack`.

---

## Files Retrieved

1. `src/tools/git-mcp.ts` (lines 552–592) — JSDoc + body of `gitReadFileAtCommit`; line 840 export entry.
2. `src/tools/git-mcp.ts` (lines 830–844) — the bottom `export { ... }` block confirming `gitReadFileAtCommit` is exported.
3. `src/core/session-utils.ts` (lines 820–886) — JSDoc + body of `readTasksJSON`.
4. `src/core/tasks-json-recovery.ts` (whole file, lines 1–360) — `recoverTasksJson` and its `gitReadFileAtCommit` usage in PATH B (lines 312–316).
5. `src/core/models.ts` (lines 175–212) — `Status` union + `StatusEnum` Zod schema.
6. `src/core/models.ts` (lines 273–340) — `Subtask` interface.
7. `src/core/models.ts` (lines 643–680) — `Phase` interface.
8. `src/core/models.ts` (lines 757–803) — `Backlog` interface + `BacklogSchema`.
9. `src/utils/task-utils.ts` (lines 494–580) — `AnyItem` type + `setItemStatus` (canonical per-item status merge).
10. `src/utils/task-utils.ts` (lines 90–120) — `findItem` (the recursive find-by-id helper).
11. `src/cli/commands/artifacts.ts` (lines 345–372) — private `#findTaskInBacklog` (duplicate hand-written traversal; not reusable).

---

## Key Code

### 1. `gitReadFileAtCommit` — `src/tools/git-mcp.ts`

**JSDoc** starts at line **552** (`/** Read the content of a file at a specific commit`).
**Function** at line **578**. **Export entry** at line **840**.

Full verbatim (lines 552–592):

```ts
/**
 * Read the content of a file at a specific commit (blob fetch).
 *
 * @remarks
 * Runs `git show <commit>:<filePath>` via simple-git `.show(...)`, returning the
 * blob content as a string. `commit` may be a full hash, short hash, or symbolic
 * ref (`HEAD`, `HEAD~1`, …). Invalid revisions / missing paths cause git to error,
 * which is thrown (do NOT swallow).
 *
 * Generic over any file path. The smart-recovery routine uses this to fetch the
 * last valid blob of `tasks.json` before restoring it (PRD §5.1).
 *
 * @param filePath - Repository-relative path of the file.
 * @param commit - Git revision (hash or symbolic ref like `HEAD`) to read at.
 * @param repoPath - Path to the git repository (optional, defaults to cwd).
 * @returns The file's blob content at `commit`, as a string.
 * @throws {Error} If `repoPath` is not a git repository, the revision/path is invalid, or `git show` fails.
 *
 * @example
 * ```ts
 * const content = await gitReadFileAtCommit('tasks.json', 'abc123', '/path/to/repo');
 * const parsed = JSON.parse(content); // last valid version
 * ```
 */
async function gitReadFileAtCommit(
  filePath: string,
  commit: string,
  repoPath?: string
): Promise<string> {
  const safePath = await validateRepositoryPath(repoPath);
  const git = simpleGit(safePath);

  return git.show(`${commit}:${filePath}`);
}
```

**CONFIRMED**: returns `Promise<string>` via `git.show(\`${commit}:${filePath}\`)`.
- `filePath` is **repo-relative** (validated by `validateRepositoryPath`, defined at line 202).
- `commit` accepts a symbolic ref like `'HEAD'`.
- **THROWS** on git error (does NOT return an envelope). Callers must wrap in try/catch.

**Export entry** (line 840, inside the `export {` block at line 830):
```ts
export {
  gitStatusTool,
  gitDiffTool,
  gitAddTool,
  gitCommitTool,
  gitStatus,
  gitDiff,
  gitAdd,
  gitCommit,
  gitFileHistory,
  gitReadFileAtCommit,   // ← line 840
  gitRestoreFile,
  gitListStagedDeletions,
  gitRestoreFileFromHead,
  gitUnstagePath,
};
```

> Import path (already used by recovery): `import { gitFileHistory, gitReadFileAtCommit } from '../tools/git-mcp.js';` (`src/core/tasks-json-recovery.ts:37`).

---

### 2. `readTasksJSON` — `src/core/session-utils.ts`

**Signature** at line **841**:

```ts
export async function readTasksJSON(sessionPath: string): Promise<Backlog>
```

- **Takes the SESSION DIRECTORY** (the folder containing `tasks.json`), NOT the file path. Internally it does `resolve(sessionPath, 'tasks.json')` (line 845).
- **Returns `Promise<Backlog>`** — a single `Backlog` object (NOT a tasks array).
- Reads raw bytes → `JSON.parse` → **`BacklogSchema.parse(parsed)`** (Zod validation). Throws `SessionFileError` on any read/parse/schema failure (lines 871–880).

```ts
export async function readTasksJSON(sessionPath: string): Promise<Backlog> {
  try {
    logger().debug({ sessionPath, operation: 'readTasksJSON' }, 'Reading tasks.json');
    const tasksPath = resolve(sessionPath, 'tasks.json');
    const content = await readFile(tasksPath, 'utf-8');
    const parsed = JSON.parse(content);
    const validated = BacklogSchema.parse(parsed);
    logger().debug({ sessionPath, itemCount: validated.backlog.length }, 'tasks.json read successfully');
    return validated;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    logger().error(/* ... */, 'Failed to read tasks.json');
    throw new SessionFileError(
      resolve(sessionPath, 'tasks.json'),
      'read tasks.json',
      error as Error
    );
  }
}
```

**IMPORTANT API MISMATCH for mirroring**: `readTasksJSON` takes the *session dir* (and always reads the working tree). To read HEAD's `tasks.json` you must instead use `gitReadFileAtCommit(relPath, 'HEAD', repoPath)` with a **repo-relative file path**, then `JSON.parse` + `BacklogSchema.parse` yourself (exactly as `recoverTasksJson` PATH B does — see §5).

---

### 3. `Status` union + `StatusEnum` — `src/core/models.ts` (lines 175–212)

```ts
export type Status =
  | 'Planned'
  | 'Researching'
  | 'Ready'
  | 'Implementing'
  | 'Retrying'
  | 'Complete'
  | 'Failed'
  | 'Obsolete';

export const StatusEnum = z.enum([
  'Planned',
  'Researching',
  'Ready',
  'Implementing',
  'Retrying',
  'Complete',
  'Failed',
  'Obsolete',
]);
```

**8 values**, not 7. Note `'Ready'` and `'Retrying'` ARE valid. There is **no** `'Abandoned'`/`'Done'`/`'Pending'`. The PRD brief's list ("Complete, Planned, Researching, Ready, Implementing, Failed, etc.") is a subset; the authoritative set also includes `'Retrying'` and `'Obsolete'`.

---

### 4. `Subtask` interface — `src/core/models.ts` (lines 273–340)

```ts
export interface Subtask {
  readonly id: string;        // format: P{N}.M{N}.T{N}.S{N}  e.g. 'P1.M1.T1.S1'
  readonly type: 'Subtask';
  readonly title: string;     // 1..200 chars
  readonly status: Status;
  readonly story_points: number; // Fibonacci, 0.5..21
  readonly dependencies: string[];
  readonly context_scope: string;
  readonly prd_selectors: string[]; // PRD §4.2; defaults to [] if absent on disk
}
```

Subtasks are the **leaf** level. `SubtaskSchema` (line 375) enforces the id regex `/^P\d+\.M\d+\.T\d+\.S\d+$/`.

---

### 4b. Backlog / Phase / Milestone / Task shape — `src/core/models.ts`

The hierarchy is **Phase → Milestone → Task → Subtask** (4 levels; subtasks do NOT nest further).

```ts
// models.ts:757
export interface Backlog {
  readonly backlog: Phase[];   // NOTE: top-level key is `backlog`, NOT `tasks`
}

// models.ts:643
export interface Phase {
  readonly id: string;          // 'P1'
  readonly type: 'Phase';
  readonly title: string;
  readonly status: Status;
  readonly description: string;
  readonly milestones: Milestone[];
}

// (Milestone: id 'P1.M1', type 'Milestone', ..., tasks: Task[])
// (Task:      id 'P1.M1.T1', type 'Task', ..., subtasks: Subtask[])
```

Full `BacklogSchema` (line 797): `z.object({ backlog: z.array(PhaseSchema) })`.

---

### 4c. Helper to find an item by id — YES, `findItem` exists

`src/utils/task-utils.ts:90` — **`findItem`** is the canonical recursive find-by-id helper. It returns ANY hierarchy node (`HierarchyItem = Phase | Milestone | Task | Subtask`), not just subtasks:

```ts
export function findItem(backlog: Backlog, id: string): HierarchyItem | null {
  for (const phase of backlog.backlog) {
    if (phase.id === id) return phase;
    for (const milestone of phase.milestones) {
      if (milestone.id === id) return milestone;
      for (const task of milestone.tasks) {
        if (task.id === id) return task;
        for (const subtask of task.subtasks) {
          if (subtask.id === id) return subtask;
        }
      }
    }
  }
  return null;
}
```

**Use this** to look up an item's status by id (mirror pattern): `findItem(backlog, itemId)?.status`.

Related helpers in the same module (`src/utils/task-utils.ts`):
- `isSubtask(item): item is Subtask` (line 63)
- `getAllSubtasks(backlog): Subtask[]` (line 169) — flatten all leaves.
- `setItemStatus(backlog, itemId, status): boolean` (line 527) — **the canonical in-place per-item status setter** (recursive visit; mutates via readonly-cast idiom; returns `true` if found). This is what `recoverTasksJson` uses to apply a status delta.

```ts
export function setItemStatus(backlog: Backlog, itemId: string, status: Status): boolean {
  let found = false;
  const visit = (item: AnyItem): void => {
    if (item.id === itemId) {
      (item as { status: Status }).status = status;
      found = true;
      return;
    }
    if ('milestones' in item) item.milestones.forEach(visit);
    if ('tasks' in item) item.tasks.forEach(visit);
    if ('subtasks' in item) item.subtasks.forEach(visit);
  };
  backlog.backlog.forEach(visit);
  return found;
}
```

> There is **also** a private duplicate `#findTaskInBacklog` in `src/cli/commands/artifacts.ts:345` (CLI-only, returns `{title, status} | null`). Do NOT reuse it — `findItem` is the public canonical helper.

---

### 5. How `recoverTasksJson` reads HEAD's tasks.json from git — `src/core/tasks-json-recovery.ts`

This is the **EXACT pattern to mirror**. The import is at line 37:
```ts
import { gitFileHistory, gitReadFileAtCommit } from '../tools/git-mcp.js';
```

**PATH B** walk (corrupt-disk branch), lines ~303–322:

```ts
const snapshotIds = await snapshotResearchingReadyIds(tasksPath);
const history = await gitFileHistory(relPath, repoPath); // [] on no-history; throws on git error (→ PATH C)
let restoredBacklog: Backlog | null = null;
let restoreCommit: string | null = null;
for (const entry of history) {
  const blob = await gitReadFileAtCommit(relPath, entry.commit, repoPath); // throws on error (→ PATH C)
  try {
    const parsed = JSON.parse(blob);
    restoredBacklog = BacklogSchema.parse(parsed) as Backlog; // schema-valid
    restoreCommit = entry.commit;
    break;
  } catch {
    continue;  // try next older commit
  }
}
```

**Path-relativity setup** (top of `recoverTasksJson`, lines ~285–289):
```ts
const sessionDir = dirname(resolve(tasksPath));
const repoPath = opts?.repoPath ?? process.cwd();
const relPath = relative(repoPath, resolve(tasksPath));   // repo-RELATIVE path for git
```

**To read specifically HEAD's tasks.json** (the brief's exact ask — NOT the full history walk), the minimal mirror is:

```ts
import { gitReadFileAtCommit } from '../tools/git-mcp.js';
import { BacklogSchema, type Backlog } from '../core/models.js';

const relPath = relative(repoPath, resolve(sessionDir, 'tasks.json'));
const blob = await gitReadFileAtCommit(relPath, 'HEAD', repoPath); // git show HEAD:<relPath>; THROWS on error
const headBacklog = BacklogSchema.parse(JSON.parse(blob)) as Backlog;
const itemStatus = findItem(headBacklog, itemId)?.status;   // from src/utils/task-utils.js
```

> `gitReadFileAtCommit`'s 2nd arg accepts a symbolic ref, so `'HEAD'` works directly. Note the helper takes a **file path** (repo-relative), whereas `readTasksJSON` takes a **session dir** (working-tree only). Do not confuse the two.

---

### 6. tasks.json location + top-level JSON shape

**Location**: `<sessionDir>/tasks.json`. Confirmed by `readTasksJSON` doing `resolve(sessionPath, 'tasks.json')` (`session-utils.ts:845`) and `recoverTasksJson` deriving `sessionDir = dirname(resolve(tasksPath))` then treating `tasks.json` as the leaf name.

**Top-level JSON shape**: `{ "backlog": [ ... ] }`. The root key is **`backlog`** (an array of Phase objects), NOT `{tasks:[...]}` and NOT `{version, tasks}`. There is **no version field**.

Verified empirically against the live `plan/008_15504f60a0ef/tasks.json`:
```
TOP-LEVEL KEYS: ['backlog']
backlog len: 6
first phase id/type: P1 Phase
```

This matches `BacklogSchema = z.object({ backlog: z.array(PhaseSchema) })` (`models.ts:802`).

Full nesting:
```jsonc
{
  "backlog": [               // Phase[]
    {
      "id": "P1", "type": "Phase", "title": "...", "status": "...",
      "description": "...",
      "milestones": [        // Milestone[]
        {
          "id": "P1.M1", "type": "Milestone", "...": "...",
          "tasks": [         // Task[]
            {
              "id": "P1.M1.T1", "type": "Task", "...": "...",
              "subtasks": [  // Subtask[]  (LEAVES)
                {
                  "id": "P1.M1.T1.S1", "type": "Subtask",
                  "title": "...", "status": "Complete",
                  "story_points": 2, "dependencies": [],
                  "context_scope": "...", "prd_selectors": []
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

---

## Architecture

```
tasks.json (disk)  ──readFile→ JSON.parse → BacklogSchema.parse ─→ Backlog
   │                     (src/core/session-utils.ts: readTasksJSON — takes SESSION DIR)
   │
   └─ git HEAD blob ──git.show(HEAD:<relPath>)→ string → JSON.parse → BacklogSchema.parse ─→ Backlog
                         (src/tools/git-mcp.ts: gitReadFileAtCommit — takes repo-RELATIVE FILE PATH)

Backlog = { backlog: Phase[] }
  Phase.milestones: Milestone[] → .tasks: Task[] → .subtasks: Subtask[]  (4-level tree, subtasks are leaves)

findItem(backlog, id): HierarchyItem | null        ← canonical recursive find-by-id (src/utils/task-utils.ts:90)
setItemStatus(backlog, id, status): boolean        ← canonical in-place status setter (src/utils/task-utils.ts:527)
Status = Planned|Researching|Ready|Implementing|Retrying|Complete|Failed|Obsolete   (8 values)
```

Data flow: `gitReadFileAtCommit` (blob) → `JSON.parse` → `BacklogSchema.parse` → `Backlog` → `findItem(id).status`.
The recovery module (`tasks-json-recovery.ts`) is the single existing consumer of `gitReadFileAtCommit` for `tasks.json`; it walks history but the same primitive reads `'HEAD'` directly.

---

## Start Here

**`src/tools/git-mcp.ts`** (lines 552–592) for the `gitReadFileAtCommit` signature/contract, then **`src/core/tasks-json-recovery.ts`** (lines 285–322) for the canonical "blob → parse → BacklogSchema.parse" usage to mirror. For status lookup, open **`src/utils/task-utils.ts`** (lines 90 `findItem` / 527 `setItemStatus`).

---

## Residual Risks / Open Notes

- **API mismatch to watch**: `readTasksJSON` takes a *session dir*; `gitReadFileAtCommit` takes a *repo-relative file path* and a *commit*. Mixing them up is the most likely bug. Compute `relPath = relative(repoPath, resolve(sessionDir, 'tasks.json'))`.
- `gitReadFileAtCommit` **THROWS** on any git error (bad rev, path not in commit, repo missing). Wrap in try/catch if the read is best-effort; PATH C in `recoverTasksJson` is the non-fatal guard pattern.
- `Status` has **8** members incl. `'Retrying'` and `'Obsolete'` — do not assume the brief's 7-value subset when comparing.
- `readTasksJSON` THROWS `SessionFileError` on parse/schema failure (it does not return null) — `recoverTasksJson` uses exactly this throw as its "disk corrupt → PATH B" signal.
- No `{version, tasks}` or `{tasks:[...]}` shape exists; the only valid root is `{backlog:[...]}`. Any code assuming otherwise will fail `BacklogSchema.parse`.
- No subtask-only finder (e.g. `findSubtaskById`); `findItem` returns any node. Use `isSubtask(item)` to narrow if a leaf is specifically required.