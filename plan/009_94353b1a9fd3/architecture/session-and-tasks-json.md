# Session Management & tasks.json Resolution — Architecture Findings

> Scout report on the session-discovery / `tasks.json` resolution subsystem.

---

## 1. `SessionManager.findLatestSession()` & `listSessions()`

**File:** `src/core/session-manager.ts`

### `listSessions(planDir = resolve('plan'))` — lines 1497-1555
- Calls `SessionManager.__scanSessionDirectories(planDir)` (1342-1381): `readdir(planDir, { withFileTypes: true })`, keeps dirs matching `/^(\d{3})_([a-f0-9]{12})$/` (SESSION_DIR_PATTERN, line 119). ENOENT → returns `[]`.
- Returns `SessionMetadata[]` sorted ascending by NNN prefix.
- **Empty array === no sessions.**

### `findLatestSession(planDir = resolve('plan'))` — lines 1573-1596
```ts
const sessions = await SessionManager.listSessions(planDir);
if (sessions.length === 0) return null;
return sessions[sessions.length - 1]; // sorted ascending → last = latest
```
- **Returns `null` when no sessions.** **Returns `SessionMetadata` when found.**
- "Latest" = highest NNN sequence number, NOT newest mtime.

---

## 2. `findLatestBugfixTasksFile()` (§5.3)

**File:** `src/core/session-utils.ts`, lines 916-970

- **Signature:** `findLatestBugfixTasksFile(sessionPath: string): Promise<string | null>`
- Looks inside `<sessionPath>/bugfix/` for numbered child dirs (`/^\d{3}_/`), sorts **descending by sequence**, returns the `tasks.json` path of the **top-sequence child that has a tasks.json**.
- Returns the absolute path OR `null` (no bugfix dir, no children, no tasks.json in top child).
- **Read-only:** never creates dirs. Bugfix child preferred regardless of completion status.

---

## 3. `taskAction` handler — EXACT flow (task & status subcommands)

**File:** `src/cli/index.ts`, lines 554-723

### (a) tasksFile resolution — lines 577-612
```
if (options.file) {
  tasksFile = resolve(options.file);          // :580 — --file override (HARD ERROR if missing)
} else {
  // resolve session: --session prefix match (:584-592) or findLatestSession (:593-598)
  // sessionPath = resolved session .path
  const bugfixTasks = await findLatestBugfixTasksFile(sessionPath); // :604
  if (bugfixTasks) {
    tasksFile = bugfixTasks;                   // :606 — bugfix tier
    sourceNote = `Using bugfix tasks: ${relative(sessionPath, bugfixTasks)}`;
  } else {
    tasksFile = resolve(sessionPath, 'tasks.json');  // :609 — main-session fallback
    sourceNote = `Using main tasks: ${relative(planDir, tasksFile)}`;
  }
}
```

### (b) sourceNote printing — lines 614-620
```ts
if (sourceNote && options.output !== 'json') {
  process.stderr.write(`${chalk.cyan(`[hack] ${sourceNote}`)}\n`);
}
```
- Writes to **stderr**. Suppressed for `--output json`. Always null for `--file`.

### (c) The read — line 622-623
```ts
const content = await readFile(tasksFile, 'utf-8');  // :622 — NO existence check before this!
const data = JSON.parse(content);                     // :623 — raw, no Zod validation
```

### (d) Three action branches
| Action | Lines | Behavior |
|---|---|---|
| `'next'` | 625-675 | DFS for first Subtask with status ∈ {Planned, Ready, Failed}. Found → print; not → 'No tasks remaining.' or `null` for json. |
| `'status'` | 676-695 | Count items by status into `Record<string, number>`. |
| default (list) | 696-715 | List all tasks color-coded. **Does NOT honor `-o json`.** |

### (e) Success exit — line 716
`process.exit(0);`

### (f) Catch block — lines 717-723
```ts
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  logger().error(`Task command failed: ${errorMessage}`);
  process.exit(1);  // EXIT CODE 1 for ALL errors including ENOENT
}
```

---

## 4. `tasks-json-recovery.ts` — §5.1 corruption recovery

**File:** `src/core/tasks-json-recovery.ts`. Invoked after every agent run by `TaskOrchestrator.#recoverAfterAgentRun` (task-orchestrator.ts:1196).

**Purpose:** Reconcile on-disk tasks.json after a Coder/agent may have corrupted it (truncated write, partial edit, schema-invalid mutation). Always non-fatal.

**Three paths:**
- **PATH A** (clean disk, lines 271-289): reconstruct from baselineBacklog + legitimateDelta under lock. Returns `{ restored: false, source: 'disk' }`.
- **PATH B** (corrupt disk, lines 291-386): walk git history for last valid committed blob, restore + reapply delta + reapply research statuses. Returns `{ restored: true, source: 'git' }`.
- **PATH C** (total failure, lines 389-403): log, leave state as-is. Never throws.

**DISTINCT from breakdown-in-progress:** Recovery deals with a **present-but-corrupt** file. Breakdown-in-progress deals with a **simply-absent** file. Recovery is triggered by the orchestrator (runtime); breakdown-in-progress is in the read-only CLI path.

---

## 5. All tasks.json readers

| Location | Reader | Validated? |
|---|---|---|
| `cli/index.ts:622` (taskAction) | **raw** readFile + JSON.parse | ❌ No Zod |
| `cli/commands/inspect.ts:219` | SessionManager.loadSession → readTasksJSON | ✅ Zod |
| `cli/commands/validate-state.ts:116` | readTasksJSON | ✅ Zod |
| `core/session-utils.ts` readTasksJSON (~1048-1090) | canonical reader | ✅ BacklogReadSchema |
| `core/session-manager.ts` loadSession (~460-480) | readTasksJSON (ENOENT → empty) | ✅ |
| `core/task-orchestrator.ts:1259` | readTasksJSON().catch(() => null) | ✅ best-effort |
| `core/tasks-json-recovery.ts:272` | readTasksJSON (validity probe) | ✅ |
| `core/tasks-json-recovery.ts:86` | raw readFile + JSON.parse (lenient DFS) | ❌ intentionally |

---

## 6. Exit codes for task/status

- **Success:** `process.exit(0)` — line 716
- **Any error:** `process.exit(1)` — line 723 (catch block). Covers ENOENT, JSON.parse failure, "No sessions found", "Session not found", all thrown errors.

---

## 7. `--output json` behavior per action

| Action | Honors `-o json`? | JSON emitted |
|---|---|---|
| `'next'` (found) | ✅ lines 654-655 | `JSON.stringify(next, null, 2)` |
| `'next'` (none) | ✅ lines 668-669 | literal `null` |
| `'status'` | ✅ line 689 | `JSON.stringify(counts, null, 2)` |
| default (list) | ❌ | Always human-readable (never checks output) |

---

## 8. File existence check before readFile

**NO.** There is no `stat`/`existsSync`/access check before `cli/index.ts:622`. `taskAction` deliberately lets `readFile` throw ENOENT. `findLatestBugfixTasksFile` pre-`stat`s (bugfix tier only). The main-session fallback (`resolve(sessionPath, 'tasks.json')`, line 609) is constructed WITHOUT a stat — a session dir whose `tasks.json` was never written will throw ENOENT → catch block → exit 1.

---

## Key file:line anchors

- `src/core/session-manager.ts:119` — SESSION_DIR_PATTERN
- `src/core/session-manager.ts:1573-1596` — findLatestSession (null sentinel)
- `src/core/session-utils.ts:916-970` — findLatestBugfixTasksFile
- `src/core/session-utils.ts:1048-1090` — readTasksJSON (Zod-validated)
- `src/core/tasks-json-recovery.ts:256-405` — recoverTasksJson (PATH A/B/C)
- `src/core/task-orchestrator.ts:1196-1283` — #recoverAfterAgentRun (trigger)
- `src/cli/index.ts:554-723` — taskAction (full handler)
- `src/cli/index.ts:577-612` — tasksFile resolution
- `src/cli/index.ts:614-620` — sourceNote (stderr, json-suppressed)
- `src/cli/index.ts:622-623` — raw readFile + JSON.parse (no pre-check)
- `src/cli/index.ts:717-723` — catch block → exit(1)