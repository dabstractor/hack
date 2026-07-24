# Code Context: `src/core/task-orchestrator.ts`

File: `/home/dustin/projects/hacky-hack/src/core/task-orchestrator.ts` — 1394 lines.
Read-only recon. No files modified.

---

## 1. Import block (lines 24–78)

### Verbatim import block

```ts
// line 24
import type { SessionManager } from './session-manager.js';
import { getLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';
import type {
  Backlog,
  Phase,
  Milestone,
  Task,
  Subtask,
  Status,
  PRPCompressionLevel,
} from './models.js';
import type { HierarchyItem } from '../utils/task-utils.js';
import { getDependencies } from '../utils/task-utils.js';
import type { Scope } from './scope-resolver.js';
import { resolveScope } from './scope-resolver.js';
import { smartCommit } from '../utils/git-commit.js';
import { TaskError } from '../utils/errors.js';
import { atomicWrite, readTasksJSON } from './session-utils.js';
import { recoverTasksJson } from './tasks-json-recovery.js';
import { join } from 'node:path';
import { ResearchQueue, ResearchTimeoutError } from './research-queue.js';
import { PRPRuntime } from '../agents/prp-runtime.js';
import {
  getIssueRetryMax,
  isParallelResearch,
  getResearchDepth,
} from '../config/constants.js';
import {
  ConcurrentTaskExecutor,
  type ParallelismConfig,
} from './concurrent-executor.js';
import {
  TaskRetryManager,
  type TaskRetryConfig,
} from './task-retry-manager.js';
import { createCleanupRunner, type CleanupRunner } from './cleanup-runner.js';
// line 78
```

### Direct answers to the import questions

| Question | Answer | Evidence |
|---|---|---|
| Is `gitReadFileAtCommit` imported from `git-mcp.ts`? | **NO.** Neither `gitReadFileAtCommit` nor the `git-mcp` module appear anywhere in this file. | `grep gitReadFileAtCommit|git-mcp` → 0 matches |
| Is `join` from `node:path` imported? | **YES**, line 37: `import { join } from 'node:path';` | line 37 |
| Is `smartCommit` imported from `git-commit.ts`? | **YES**, line 34: `import { smartCommit } from '../utils/git-commit.js';` | line 34 |
| Is `readTasksJSON` imported? | **YES**, line 36 — from `./session-utils.js` (NOT from `git-mcp`): `import { atomicWrite, readTasksJSON } from './session-utils.js';` | line 36 |

Note: `recoverTasksJson` (used for git-history restoration, line 38) is imported from `./tasks-json-recovery.js`, not from `git-mcp`.

---

## 2. `executeSubtask` entry + `Complete`-skip path (lines 773–792)

```ts
// line 773
  async executeSubtask(subtask: Subtask): Promise<void> {
    // Skip subtasks that are already Complete (e.g. on --continue resume).
    // Without this, every resume re-runs every completed subtask, wasting
    // 10+ min each and producing duplicate commits whose only changed file
    // is regenerated execution telemetry.
    if (subtask.status === 'Complete') {
      this.#logger.info(
        { subtaskId: subtask.id },
        'Already complete, skipping'
      );
      return;
    }

    this.#logger.info(
      { subtaskId: subtask.id, title: subtask.title },
      'Executing Subtask'
    );
```

Key facts:
- Method declared at **line 773**.
- The `Complete`-skip guard spans **lines 781–787** (comment block starts line 774, the `if` at line 781, `return;` at line 787).
- The skip reads `subtask.status` and `subtask.id` directly off the `Subtask` argument (no session lookup needed here).

---

## 3. Two-phase commit (lines ~990–1130)

The commit block is gated on `if (succeeded)` and wrapped in `try`. It is preceded by a flush (line 1018 `await this.sessionManager.flushUpdates();`).

### How `sessionPath` is resolved (line 1023)

```ts
// line 1023
          const sessionPath = this.sessionManager.currentSession?.metadata.path;
```

Note: it uses the optional-chaining accessor `currentSession?.metadata.path` and a `sessionPath` local — **not** a `sessionDir` variable here. A `sessionDir` local of the same meaning exists elsewhere (line 970).

### How the repo path is obtained

There is **NO `this.repoPath` field** anywhere in the file (`grep this\.repoPath|repoPath:` → only one hit, line 1207, which is an option key). The repo path is **`process.cwd()`**, obtained in two places:

1. Inside the two-phase commit block itself, for the cleanup runner:
   ```ts
   // line 1042
           const repoRoot = process.cwd();
   ```
   passed to the cleanup runner as `repoRoot` (line 1047: `repoRoot,`).

2. Inside `smartCommit` itself — the orchestrator does NOT pass a repo path to `smartCommit`. From `src/utils/git-commit.ts` (signature at line 316, body comment at lines 336–341):
   ```ts
   export async function smartCommit(
     sessionPath: string,   // ← first arg is SESSION path, NOT repo path
     message: string,
     options?: SmartCommitOptions
   ): Promise<string | null> {
       ...
       // CRITICAL: Git operations run at the REPO ROOT (process.cwd()), NOT the
       // session path. ...
       const repoRoot = process.cwd();
   ```
   So `smartCommit` resolves the repo root itself via `process.cwd()`; the orchestrator only hands it the session/metadata path.

### (a) Pre-cleanup "survival" commit (lines 1032–1036)

```ts
// line 1032
            const preHash = await smartCommit(
              sessionPath,
              `${subtask.id}: ${subtask.title}`,
              { generateMessage: true }
            );
```
Logged: "Survival commit created" (line 1038) or "No substance to commit (survival commit empty)" (line 1044).

### (b) Cleanup invocation (lines 1047–1060)

```ts
// line 1042
            const repoRoot = process.cwd();
            let cleanupOk = false;
            try {
              const res = await this.#cleanupRunner({
                sessionPath,
                subtask,
                repoRoot,
              });
              cleanupOk = res.success;
              ...
            } catch (err) { ... cleanupOk = false; }
            // cleanup may have written tasks.json — persist before post-cleanup commit
            await this.sessionManager.flushUpdates();   // line 1077
```

### (c) Post-cleanup commit (lines 1085–1089)

```ts
// line 1084
            if (cleanupOk) {
              const postHash = await smartCommit(
                sessionPath,
                'cleanup: doc reorganization',
                { generateMessage: true }
              );
```
Logged: "Post-cleanup commit created" (line 1091) or "No cleanup changes to commit" (line 1096).

### Commit-failure handling (lines 1099–1103)

```ts
// line 1099
        } catch (error) {
          // Don't fail the subtask if commit fails
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.#logger.error({ error: errorMessage }, 'Smart commit failed');
        }
```

---

## 4. How `tasks.json` path is constructed

The path is always `join(<sessionDir>, 'tasks.json')`, where `<sessionDir>` is `this.sessionManager.currentSession.metadata.path` (also referred to locally as `session.metadata.path` or `sessionPath`).

Occurrences of the `join(..., 'tasks.json')` pattern:

1. **Line 1203** (in `#recoverAfterAgentRun`) — the canonical construction:
   ```ts
   const tasksPath = join(session.metadata.path, 'tasks.json');
   ```
   Here `session = this.sessionManager.currentSession` (line 1180).

Other references to `tasks.json` in the file are comments/strings, not path construction:
- line 916 (comment: "Smart recovery: reconcile tasks.json after every agent run")
- line 1016 (comment: "write the batched status delta to disk (tasks.json) BEFORE committing")
- line 1076 (comment: "cleanup may have written tasks.json")
- lines 1183, 1212, 1238 (log/error messages in `#recoverAfterAgentRun`)

`readTasksJSON` itself (line 36 import, used at line 1211) takes the **session directory** as its argument — it constructs the `tasks.json` path internally:
```ts
// line 1211
        (await readTasksJSON(session.metadata.path).catch(() => null));
```

`atomicWrite` is used to write OTHER files into `sessionDir` (e.g. line 972 writes `issue_feedback.md`), not tasks.json.

---

## 5. `Subtask` type and `Status` type

Both are imported from `./models.js` (line 27 import block, line 28 `Subtask`, line 29 `Status`).

### `Subtask` — `src/core/models.ts` lines 273–303

```ts
// models.ts line 273
export interface Subtask {
  /** @format P{phase}.M{milestone}.T{task}.S{subtask}  e.g. 'P1.M1.T1.S1' */
  readonly id: string;

  /** Type discriminator for type narrowing */
  readonly type: 'Subtask';

  /** @minLength 1  @maxLength 200 */
  readonly title: string;

  /** Current lifecycle status */
  readonly status: Status;

  /** Estimated complexity in Fibonacci story points ... */
  // ... (more fields)
}
```
→ **YES, `Subtask` has both `id: string` and `status: Status`** (both `readonly`).

### `Status` — `src/core/models.ts` lines 175–183

```ts
// models.ts line 175
export type Status =
  | 'Planned'
  | 'Researching'
  | 'Ready'
  | 'Implementing'
  | 'Retrying'
  | 'Complete'
  | 'Failed'
  | 'Obsolete';
```
A mirrored Zod enum `StatusEnum` is defined at models.ts lines 209–218. `'Complete'` is a valid member (used in the line 781 guard).

---

## 6. `this.sessionManager.currentSession` accessor pattern

Used repeatedly, both guarded and unguarded. `currentSession` is the `SessionManager` property exposing the active `SessionState` (which carries `.metadata.path` and `.taskRegistry`).

| Line | Usage | Guard |
|---|---|---|
| 191 | `const currentSession = sessionManager.currentSession;` (constructor) | guarded at 192: `if (!currentSession) {` throw |
| 196 | `this.#backlog = currentSession.taskRegistry;` | after guard |
| 516 | `const currentSession = this.sessionManager.currentSession;` (in a method) | guarded at 517 |
| 522 | `this.#backlog = currentSession.taskRegistry;` | after guard |
| **970** | `const sessionDir = this.sessionManager.currentSession!.metadata.path;` | **NON-null assertion `!`** (assumed non-null) |
| **1023** | `const sessionPath = this.sessionManager.currentSession?.metadata.path;` | **optional-chain + null-check** (line 1024 `if (!sessionPath)`) |
| 1180 | `const session = this.sessionManager.currentSession;` | guarded at 1181 |
| 1228 | `(this.sessionManager.currentSession as { taskRegistry: Backlog }).taskRegistry = recovered;` | type-cast idiom to write back to readonly registry |

Pattern is **inconsistent**: sometimes `!` (line 970), sometimes `?.` + explicit null branch (line 1023), sometimes assigned-then-guarded (lines 191, 516, 1180).

---

## 7. Logger

### Field declaration (line 106) and init (line 181)

```ts
// line 106
  /** Logger instance for structured logging */
  readonly #logger: Logger;

// line 181 (inside constructor)
    this.#logger = getLogger('TaskOrchestrator');
```
Private (`#`), typed `Logger` (imported from `../utils/logger.js` line 24), instantiated via `getLogger('TaskOrchestrator')` (named child logger).

### Representative calls (pino-style: `logger.<level>(contextObj, message)`)

```ts
// line 786 (skip path)
      this.#logger.info(
        { subtaskId: subtask.id },
        'Already complete, skipping'
      );

// line 790 (entry)
    this.#logger.info(
      { subtaskId: subtask.id, title: subtask.title },
      'Executing Subtask'
    );

// line 1038 (survival commit)
              this.#logger.info(
                { commitHash: preHash },
                'Survival commit created'
              );

// line 1102 (commit failure — error level)
          this.#logger.error({ error: errorMessage }, 'Smart commit failed');

// line 1236 (recovery failure — error level)
      this.#logger.error(
        { itemId, err: errorMessage },
        'tasks.json smart recovery failed (non-fatal); continuing'
      );
```
Levels observed: `debug`, `info`, `warn`, `error`. Convention is `this.#logger.<level>(contextObject, 'message')` (context object first).

---

## Architecture summary (how the pieces connect)

- **TaskOrchestrator** (class declared line 113) holds: `#logger` (106), `sessionManager` (107, public readonly, injected via constructor), `#backlog` (109), `#cleanupRunner` (set in constructor via `createCleanupRunner`), plus `researchQueue`, retry manager, concurrent executor.
- **Entry point**: `executeSubtask(subtask)` (773) → early-skip if `Complete` → sets `Researching` → checks `researchQueue.getPRP` cache → runs PRP generation → executes via `PRPRuntime` → tri-state handling of result (`success` / `issue` / `fail`) → on success enters the two-phase commit block (§3) → on failure throws `TaskError` (halt-on-failure, ~line 1124).
- **Persistence contract**: the orchestrator does NOT write `tasks.json` directly via `join`/`write`. Status changes go through `this.setStatus(...)` (batched), then `this.sessionManager.flushUpdates()` persists them to disk (called at lines 1018 and 1077). The only direct `join(...,'tasks.json')` path construction is in `#recoverAfterAgentRun` (line 1203) for the recovery read/reconcile path.
- **Commit contract**: `smartCommit(sessionPath, message, {generateMessage:true})` — orchestrator passes only the **session/metadata path**; `smartCommit` internally resolves the repo root as `process.cwd()` (see git-commit.ts line 341). The orchestrator never constructs or passes a repo path to `smartCommit`.
- **Recovery**: `#recoverAfterAgentRun(itemId, result)` (1177) runs after each agent invocation, uses `recoverTasksJson(tasksPath, {itemId, status}, {baselineBacklog, repoPath: process.cwd()})` to reconcile unauthorized agent mutations and restore from git history if corrupted, then reloads the session registry (line 1228 write-back cast).

---

## Start here

Open **`src/core/task-orchestrator.ts` line 773** (`executeSubtask`) to follow the control flow, then **line 1023** for the two-phase commit and how `sessionPath`/repo-root are resolved. Cross-reference **`src/utils/git-commit.ts` line 316** to confirm that `smartCommit`'s first arg is the session path and that it derives `repoRoot = process.cwd()` itself. For types, open **`src/core/models.ts` line 273 (`Subtask`) and line 175 (`Status`)**.

---

## Residual risks / gotchas for downstream agents

- **No `this.repoPath`.** Repo root is ALWAYS `process.cwd()`; do not look for a stored repo path on the orchestrator. If a future change needs an explicit repo path, it must be added as a field/option (none exists today).
- **`currentSession` access is inconsistent** — `!` (970), `?.`+branch (1023), guard-assign (191/516/1180). A refactor should standardize; the `!` at line 970 can NPE if the session is ever null there.
- **`readTasksJSON` comes from `session-utils.js`**, not `git-mcp.ts`. `gitReadFileAtCommit` is NOT imported anywhere in this file — git-history reads during recovery are handled inside `recoverTasksJson` (`tasks-json-recovery.js`), not by the orchestrator directly.
- **`tasks.json` is never written via raw `join`+`write` in this file** — it flows through `sessionManager.flushUpdates()`. Only the recovery hook reads it by constructing the path with `join`.
```
acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings with exact file paths and line numbers: task-orchestrator.ts:24-78 (imports), :773-792 (executeSubtask + Complete-skip), :1023-1096 (two-phase commit), :1203 (tasks.json path), models.ts:175 (Status), models.ts:273 (Subtask with id+status), git-commit.ts:316 (smartCommit signature, repoRoot=process.cwd()). Direct yes/no answers to all 4 import questions."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "wc -l src/core/task-orchestrator.ts",
      "result": "passed",
      "summary": "File is 1394 lines"
    },
    {
      "command": "grep gitReadFileAtCommit|git-mcp src/core/task-orchestrator.ts",
      "result": "passed",
      "summary": "0 matches — gitReadFileAtConfirm NOT imported"
    },
    {
      "command": "grep this\\.repoPath|repoPath: src/core/task-orchestrator.ts",
      "result": "passed",
      "summary": "Only 1 match (line 1207, recoverTasksJson option key); no this.repoPath field"
    },
    {
      "command": "grep #logger src/core/task-orchestrator.ts",
      "result": "passed",
      "summary": "Confirmed #logger field at line 106, init at 181"
    },
    {
      "command": "grep currentSession src/core/task-orchestrator.ts",
      "result": "passed",
      "summary": "8 matches showing !, ?., and guard-assign accessor patterns"
    }
  ],
  "validationOutput": [
    "All 7 task questions answered with verbatim code + line numbers",
    "tasks.json path pattern confirmed: join(session.metadata.path,'tasks.json') at line 1203 (only construction); writes flow via sessionManager.flushUpdates()",
    "Repo path resolution confirmed: process.cwd() (no this.repoPath field exists); smartCommit resolves repoRoot internally per git-commit.ts:341"
  ],
  "residualRisks": [
    "No this.repoPath field exists — any change requiring an explicit repo path must add a field/option (none today)",
    "currentSession access is inconsistent across the file (! at 970 vs ?. at 1023 vs guard-assign at 191/516/1180) — refactor risk if unified",
    "readTasksJSON imported from session-utils.js, NOT git-mcp; git-history reads during recovery are encapsulated in recoverTasksJson (tasks-json-recovery.js)"
  ],
  "noStagedFiles": true,
  "diffSummary": "Read-only recon. No files modified.",
  "reviewFindings": [
    "no blockers — recon task, no code changes"
  ],
  "manualNotes": "smartCommit's first argument is the SESSION path (currentSession.metadata.path), not the repo path; smartCommit internally resolves repoRoot=process.cwd(). The two smartCommit calls in the two-phase block are at lines 1032-1036 (pre-cleanup survival) and 1085-1089 (post-cleanup)."
}
```