# PRP — P3.M2.T5.S1: Skip-recovery checks HEAD's tasks.json for Completed status

---

## Goal

**Feature Goal**: Implement the **Skip-recovery** half of PRD §5.1
(h3.9) "Orphaned-`plan/` Recovery (interrupted-run survival)" — the FIRST of
two guards that close the orphaned-`plan/` hole. PRD §5.1 mandates:

> **Skip-recovery:** on the Completed-skip path, the orchestrator checks the
> item's status in *HEAD's* `tasks.json` (not the working tree). If HEAD does
> not also record it Complete, it runs Smart Commit immediately to persist the
> stranded `plan/` directory + status.

Today, `executeSubtask` (`src/core/task-orchestrator.ts:773`) has a blind
early-return at **line 778**: `if (subtask.status === 'Complete') return;`.
On a `--continue` resume this is normally correct — but a force-interrupted
prior run can leave an item "Complete" in the **working-tree** `tasks.json`
while that status change + the item's `plan/` work directory were **never
committed** (they're untracked/unstaged). Because the cleanup agent is
forbidden from touching `plan/` and no later commit reaches a skipped item,
that blind skip **orphans** the `plan/` work and the status forever. This
PRP makes the skip path verify the item is *also* Complete in **HEAD's**
`tasks.json`; if HEAD disagrees (HEAD does NOT record it Complete), it runs
`smartCommit` immediately to persist the stranded `plan/` dir + status.

(The **second** guard — the pre-cleanup commit from P3.M1.T3.S2 — already
exists: `src/core/task-orchestrator.ts:1032`. It prevents the orphaning
state *going forward* by committing substance *before* the cleanup agent
runs. This PRP's skip-recovery catches the residual case for items that were
interrupted *before* that pre-cleanup commit landed. Together they complete
P3.M2.T5 "Orphaned-plan/ Recovery".)

**Deliverable** (1 modified production file + 1 modified test file; **no** new
modules, **no** config, **no** new dependencies):

1. **`src/core/task-orchestrator.ts`** — REPLACE the blind
   `if (subtask.status === 'Complete') { ...log...; return; }` block
   (current lines 778-787) with a guarded skip-recovery: read HEAD's
   `tasks.json` via the existing `gitReadFileAtCommit` (already exported from
   `src/tools/git-mcp.ts`), parse + validate with `BacklogSchema`, look the
   item up with the existing `findItem` helper, and compare HEAD's status to
   `'Complete'`. If HEAD also records Complete → safe skip (current behavior,
   log + return). If HEAD does NOT record it Complete (stranded) → run
   `smartCommit(sessionPath, '<message>', { generateMessage: true })` to
   persist the stranded `plan/` dir + status, THEN return. The whole check is
   **non-fatal**: any error (git read fails, path not in HEAD, parse fails,
   commit fails) is logged and the function falls back to the safe skip
   (return) — a recovery failure must never re-run an already-Complete item.
   Add the new imports (`gitReadFileAtCommit` from git-mcp, `BacklogSchema`
   + `Backlog` type from models, `findItem` from task-utils, `relative` +
   `dirname` from `node:path`).
2. **`tests/unit/core/task-orchestrator.test.ts`** — ADD a new
   `vi.mock('../../../src/tools/git-mcp.js', ...)` block (NONE exists today
   — research/02 §1 confirms zero `git-mcp` references in this test file),
   import `gitReadFileAtCommit` + the `as any` binding
   (`mockGitReadFileAtCommit`), and ADD a new `describe('executeSubtask —
   skip-recovery (PRD §5.1, orphaned-plan/ recovery)')` block with tests:
   (a) HEAD also Complete → safe skip, NO smartCommit; (b) HEAD NOT Complete
   (stranded) → smartCommit called with `{ generateMessage: true }`, then
   returns; (c) `gitReadFileAtCommit` throws (path not in HEAD / git error)
   → logged, falls back to safe skip, NO smartCommit; (d) HEAD blob fails
   `BacklogSchema.parse` → same non-fatal skip; (e) item id not found in
   HEAD's backlog (`findItem` → null) → treat as NOT-in-HEAD → stranded →
   smartCommit runs; (f) `findItem` finds the item with a non-Complete
   status → stranded → smartCommit runs.

**Success Definition**:
- The blind `if (subtask.status === 'Complete') return;` early-return is
  replaced with a HEAD-checking skip-recovery that, on the stranded case
  (HEAD does NOT record the item Complete), calls `smartCommit(sessionPath,
  message, { generateMessage: true })` exactly once before returning.
- On the safe case (HEAD also records Complete), behavior is unchanged:
  log + return, ZERO smartCommit calls, ZERO PRP/agent invocations.
- A HEAD read failure / parse failure / item-not-found is NON-FATAL: logged
  and the function falls back to the safe skip (return) — it NEVER re-runs
  an already-Complete item and NEVER throws out of `executeSubtask`.
- The item's `plan/` directory + Complete status are persisted by the
  recovery commit (verified by `smartCommit` being called with
  `{ generateMessage: true }`).
- `npm run validate` GREEN.
- `git diff --name-only` shows EXACTLY `src/core/task-orchestrator.ts` and
  `tests/unit/core/task-orchestrator.test.ts` (no overlap with any sibling
  PRP: P3.M2.T4.S2 owns `src/tools/git-mcp.ts` + `src/utils/git-commit.ts`
  + their tests; P3.M2.T6 owns prompt-delivery changes; this PRP touches
  ONLY `task-orchestrator.ts` + its test).

---

## User Persona (if applicable)

**Target User**: The autonomous pipeline (no human in the loop). Transitively
the `--continue` / resume code path: the orchestrator's `processNextItem`
loop calls `executeSubtask(item)` for each queued item; items already
Complete are skipped. The protection fires specifically on the resume after a
**force-interrupted** prior run.

**Use Case**: A prior run was force-killed (SIGINT/SIGKILL, OOM, crash) right
after an agent finished implementing an item and the orchestrator wrote
`status: 'Complete'` to the working-tree `tasks.json` and created the item's
`plan/{seq}_{hash}/{TaskId}/` directory (with `PRP.md`, `research/`, etc.) —
but BEFORE the pre-cleanup survival commit (P3.M1.T3.S2, line 1032) ran. The
working tree now has the item Complete + an untracked `plan/.../{TaskId}/`
dir; HEAD's `tasks.json` still records the item as non-Complete (e.g.
`Implementing`) and HEAD has no `plan/.../{TaskId}/`. On the next
`--continue`, `executeSubtask(item)` sees `status === 'Complete'` and would
blind-skip, orphaning the plan dir + status forever. Post-S1: the skip path
reads HEAD's `tasks.json`, sees HEAD disagrees, runs `smartCommit` to persist
the stranded plan dir + status, then returns.

**User Journey**:
`--continue` → `processNextItem` → `executeSubtask(item)` →
`item.status === 'Complete'` (working tree) → **NEW: read HEAD's tasks.json
via `gitReadFileAtCommit('plan/{seq}_{hash}/tasks.json', 'HEAD')`** →
parse + `findItem(headBacklog, item.id)` → HEAD records non-Complete
(STRANDED) → `smartCommit(sessionPath, '<recovery message>', {
generateMessage: true })` (persists plan dir + status) → `return`. If HEAD
also records Complete (SAFE) → log + `return` (unchanged). If HEAD read
fails/parse fails (RECOVERABLE ERROR) → log warn + `return` (never re-run).

**Pain Points Addressed**: PRD §5.1 (h3.9) — silent permanent orphaning of a
completed item's `plan/` work directory and its `Complete` status when a run
is force-interrupted before the pre-cleanup commit. The pre-cleanup commit
(P3.M1.T3.S2) prevents the state going *forward*; this skip-recovery catches
the residual stranded state on resume. PRD §5.1 mandates both guards; S1 is
the skip-recovery half and completes P3.M2.T5.

---

## Why

- **PRD compliance**: PRD §5.1 (h3.9) "Orphaned-`plan/` Recovery" quotes
  verbatim:
  > A force-interrupted prior run can leave an item "Complete" in the working
  > tree but never committed — stranding its `plan/` work directory and the
  > status change as untracked/unstaged. Because the cleanup agent is
  > forbidden from touching `plan/` and no later commit would reach this
  > item, a blind skip ("already Completed → return") would orphan that work
  > forever. Two guards close this:
  > * **Skip-recovery:** on the Completed-skip path, the orchestrator checks
  >   the item's status in *HEAD's* `tasks.json` (not the working tree). If
  >   HEAD does not also record it Complete, it runs Smart Commit immediately
  >   to persist the stranded `plan/` directory + status.
  > * **Pre-cleanup commit:** see §4.2 step 4 — the item's substance is
  >   committed *before* the cleanup agent runs, so an interrupt during
  >   cleanup can no longer produce the orphaning state.
  This PRP implements the **Skip-recovery** bullet. The pre-cleanup commit
  already exists (P3.M1.T3.S2, line 1032). S1 completes P3.M2.T5.
- **Work-item contract (LOGIC)** — item-by-item mapping:
  - **(a) On the Completed-skip path in `executeSubtask`
    (`task-orchestrator.ts` ~line 560 'if subtask.status === Complete
    return'), add: read HEAD's tasks.json.** → The skip path is actually at
    **line 778** (the contract's "~line 560" is stale — research/01 §2 pins
    it precisely). Task 2 adds the HEAD read.
  - **(b) Check if the item is Complete in HEAD's version.** → Task 2:
    `gitReadFileAtCommit(relPath, 'HEAD', repoPath)` → `JSON.parse` →
    `BacklogSchema.parse` → `findItem(headBacklog, subtask.id)?.status ===
    'Complete'`.
  - **(c) If HEAD does NOT record it Complete but the working tree does,
    this is a stranded state — run smartCommit immediately to persist the
    plan/ dir + Complete status.** → Task 3: `smartCommit(sessionPath,
    message, { generateMessage: true })`.
  - **(d) The pre-cleanup commit from P3.M1.T3.S2 also prevents the
    orphaning state going forward.** → Already implemented (line 1032).
    This PRP does NOT touch it (out of scope — it's complete).
- **Contract item 2 (INPUT)**: *"Two-phase commit from P3.M1.T3.S2."* →
  CONSUMED as-is. The pre-cleanup survival commit (line 1032) is the
  forward-looking guard; this PRP's skip-recovery is the backward-looking
  guard for items interrupted before that commit landed. This PRP REUSES
  the exact same `smartCommit(sessionPath, msg, { generateMessage: true })`
  call shape as line 1032/1084 — no new commit API.
- **Contract item 4 (OUTPUT)**: *"Skip-recovery logic checking HEAD's
  tasks.json. Completes P3.M2.T5."* → This PRP delivers exactly that. S1 is
  the sole subtask of M2.T5 (per `<plan_status>`); S1 completes M2.T5.
- **Contract item 5 (DOCS)**: *"none — no user-facing/config/API surface
  change."* → Mode A only. JSDoc on the new private helper documenting the
  stranded-state detection + non-fatal contract + PRD §5.1 reference. No
  `.env.example`, no `docs/`, no README.

---

## What

One modified production file (`src/core/task-orchestrator.ts`), one modified
test file (`tests/unit/core/task-orchestrator.test.ts`). **No** new modules,
**no** config, **no** new dependencies, **no** `git-mcp.ts` (P3.M2.T4.S2 owns
it — `gitReadFileAtCommit` already exists and is exported, this PRP only
*imports* it), **no** `git-commit.ts` (P3.M2.T4.S2 owns it — this PRP only
*calls* the existing `smartCommit`), **no** workflow files beyond
`task-orchestrator.ts`, **no** `models.ts` / `task-utils.ts` / `session-utils.ts`
(read-only consumers).

### Success Criteria

- [ ] **`src/core/task-orchestrator.ts`** — the blind skip block (current
      lines 778-787) is replaced by a HEAD-checking skip-recovery. New
      imports added: `gitReadFileAtCommit` from `'../tools/git-mcp.js'`;
      `BacklogSchema` and the `Backlog` *type* from `'./models.js'` (the
      type-only `Backlog` import must be merged into the EXISTING
      `import type { ... } from './models.js'` block at line 27 — do NOT add
      a second `import type` from the same module; `BacklogSchema` is a
      *value* so it goes in a new non-type `import { BacklogSchema } from
      './models.js'`); `findItem` from `'../utils/task-utils.js'` (merged
      into the existing import from that module at line 30); `relative` and
      `dirname` added to the existing `import { join } from 'node:path'`
      (line 37 → `import { join, relative, dirname } from 'node:path'`).
- [ ] A new **private async method** `#checkHeadComplete(sessionPath,
      itemId): Promise<boolean>` (or inline; see Implementation Blueprint —
      a small private helper is preferred for testability + JSDoc) that:
      - Computes `repoPath = process.cwd()` and
        `relPath = relative(repoPath, resolve(sessionPath, 'tasks.json'))`
        (mirror `tasks-json-recovery.ts` PATH B path setup — research/03 §5).
        Use `join`/`resolve` from `node:path` consistently.
      - Calls `gitReadFileAtCommit(relPath, 'HEAD', repoPath)` (THROWS on
        git error / path-not-in-HEAD — wrap in try/catch).
      - `JSON.parse(blob)` → `BacklogSchema.parse(parsed) as Backlog`.
      - `const headItem = findItem(headBacklog, itemId);` → return
        `headItem?.status === 'Complete'`.
      - Returns `false` (NOT stranded / safe skip) when HEAD records
        Complete; returns `false` is WRONG for the not-found case — see
        Blueprint: an item NOT found in HEAD is treated as STRANDED (HEAD
        has no record of it being Complete) → the helper must distinguish
        "HEAD records Complete" (true) from "HEAD does not record Complete"
        (false, covers both not-found and non-Complete). So the helper
        returns `true` ONLY when `findItem` finds the item AND its status is
        `'Complete'`; every other case (not found, non-Complete, read/parse
        error) returns `false`. **Non-fatal**: any throw is caught, logged
        at `warn`, and returns `false` (safe-skip fallback).
- [ ] The skip block becomes (pseudocode):
      ```ts
      if (subtask.status === 'Complete') {
        const sessionPath = this.sessionManager.currentSession?.metadata.path;
        if (sessionPath) {
          const headComplete = await this.#checkHeadComplete(sessionPath, subtask.id);
          if (!headComplete) {
            this.#logger.warn({ subtaskId: subtask.id },
              'Completed in working tree but not in HEAD — stranded plan/ detected; running recovery commit');
            await smartCommit(sessionPath,
              `${subtask.id}: ${subtask.title} (skip-recovery: persist stranded plan/)`,
              { generateMessage: true });
            this.#logger.info({ subtaskId: subtask.id },
              'Skip-recovery commit completed');
          }
        }
        this.#logger.info({ subtaskId: subtask.id }, 'Already complete, skipping');
        return;
      }
      ```
- [ ] **`tests/unit/core/task-orchestrator.test.ts`** — ADD a
      `vi.mock('../../../src/tools/git-mcp.js', () => ({ gitReadFileAtCommit:
      vi.fn() }))` block (NONE exists today — research/02 §1). Import
      `gitReadFileAtCommit` + `const mockGitReadFileAtCommit =
      gitReadFileAtCommit as any;` (Pattern B from research/02 §2). Add a
      `describe('executeSubtask — skip-recovery (PRD §5.1, orphaned-plan/
      recovery)')` block with `beforeEach` that `mockReset()`s
      `mockGitReadFileAtCommit` + `mockSmartCommit`. Tests (SETUP/EXECUTE/
      VERIFY style):
      - **SAFE SKIP**: `mockGitReadFileAtCommit.mockResolvedValue(JSON.stringify(
        buildBacklogWith(subtask.id, 'Complete')))` → call
        `executeSubtask(createTestSubtask(id, title, 'Complete'))` → assert
        `mockGitReadFileAtCommit` called with `relPath, 'HEAD', <cwd>`;
        `mockSmartCommit` NOT called; resolves undefined; `mockLogger.info`
        called with 'Already complete, skipping'.
      - **STRANDED (HEAD non-Complete)**: HEAD returns a backlog with the
        item at `'Implementing'` → `mockSmartCommit` called ONCE with
        `(sessionPath, expect.stringContaining('skip-recovery'),
        { generateMessage: true })`; resolves undefined.
      - **STRANDED (HEAD not-found)**: HEAD returns a backlog WITHOUT the
        item → `findItem` → null → treated as NOT-Complete → smartCommit
        called once.
      - **RECOVERABLE ERROR (git throws)**:
        `mockGitReadFileAtCommit.mockRejectedValue(new Error('path not in
        HEAD'))` → `mockLogger.warn` called; `mockSmartCommit` NOT called;
        resolves undefined (falls back to safe skip — never re-runs).
      - **RECOVERABLE ERROR (invalid JSON / schema fail)**:
        `mockGitReadFileAtCommit.mockResolvedValue('not json{')` → same:
        warn, no smartCommit, resolves.
      - **No session path**: `currentSession.metadata.path = undefined` →
        skip the HEAD check entirely, log + return, NO gitReadFileAtCommit
        call, NO smartCommit (defensive — mirrors the existing
        `sessionPath` guard at line 1024).
- [ ] JSDoc on `#checkHeadComplete` (Mode A — rides with the work)
      documenting: reads HEAD's tasks.json, returns true ONLY when HEAD
      records the item Complete, non-fatal (any error → false → safe skip),
      PRD §5.1 reference, and the rationale (HEAD-not-found ⇒ stranded, NOT
      safe — because HEAD has no record of the completion).
- [ ] `npm run validate` GREEN.
- [ ] `git diff --name-only` shows EXACTLY
      `src/core/task-orchestrator.ts` and
      `tests/unit/core/task-orchestrator.test.ts`.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — YES. This PRP names: the exact
target block (task-orchestrator.ts lines 778-787, verbatim in research/01
§2); the exact existing primitives to reuse (`gitReadFileAtCommit` — full
signature + THROWS contract in research/03 §1; `findItem` + `BacklogSchema`
in research/03 §3/§4c; `smartCommit(sessionPath, msg, {generateMessage:true})`
— confirmed first-arg is session path, git ops run against `process.cwd()` at
git-commit.ts:421); the exact path-relativity setup to mirror
(`relative(repoPath, resolve(sessionPath, 'tasks.json'))` from
tasks-json-recovery.ts, research/03 §5); the exact import-merge points
(research/01 §1 — `join` at line 37, `models.js` type import at line 27,
`task-utils.js` at line 30); the exact test mock patterns (research/02 —
`vi.mock` + `as any` binding, `createTestSubtask`, `createMockSessionManager`,
the SET UP/EXECUTE/VERIFY style, NO existing git-mcp mock so one must be
ADDED); the non-fatal contract (any HEAD-read/parse/commit failure → safe
skip, never re-run); and the explicit out-of-scope list (P3.M2.T4.S2's
git-mcp.ts/git-commit.ts, P3.M2.T6's prompt delivery).

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/core/task-orchestrator.ts
  why: PRIMARY TARGET. Line 773 = executeSubtask entry; lines 778-787 = the blind
       Complete-skip block to REPLACE (verbatim in research/01 §2). Line 37 =
       `import { join } from 'node:path'` (EXTEND to add relative, dirname). Line 27 =
       `import type { ... } from './models.js'` (ADD Backlog to the type list; BacklogSchema
       is a VALUE so needs a new `import { BacklogSchema } from './models.js'`). Line 30 =
       the task-utils import (ADD findItem). Line 34 = `import { smartCommit } from
       '../utils/git-commit.js'` (ALREADY present — no change). Line 36 =
       `import { atomicWrite, readTasksJSON } from './session-utils.js'` (readTasksJSON reads
       the WORKING TREE only — do NOT use it for the HEAD check; use gitReadFileAtCommit).
       Lines 1023-1036 = the pre-cleanup survival smartCommit call (the EXACT call shape to
       mirror for the recovery commit). Line 106/181 = this.#logger = getLogger('TaskOrchestrator').
       Lines 1155-1244 = #recoverAfterAgentRun — the NON-FATAL try/catch + warn/error log pattern
       to mirror for #checkHeadComplete.
  pattern: |
           // REPLACE lines 778-787 (the blind skip) WITH:
           if (subtask.status === 'Complete') {
             const sessionPath = this.sessionManager.currentSession?.metadata.path;
             if (sessionPath) {
               // PRD §5.1 orphaned-plan/ skip-recovery: verify HEAD also records Complete.
               // A force-interrupted prior run can leave the item Complete in the working tree
               // but never committed — stranding its plan/ dir + status. If HEAD disagrees,
               // run smartCommit to persist the stranded state before skipping.
               const headComplete = await this.#checkHeadComplete(sessionPath, subtask.id);
               if (!headComplete) {
                 this.#logger.warn({ subtaskId: subtask.id },
                   'Completed in working tree but not in HEAD — stranded plan/ detected; running recovery commit');
                 await smartCommit(sessionPath,
                   `${subtask.id}: ${subtask.title} (skip-recovery: persist stranded plan/)`,
                   { generateMessage: true });
               }
             }
             this.#logger.info({ subtaskId: subtask.id }, 'Already complete, skipping');
             return;
           }
  gotcha: The original skip read `subtask.status` off the in-memory argument. The recovery
          needs HEAD's tasks.json — but the in-memory `subtask` is the WORKING-TREE view (it
          came from the working-tree tasks.json via refreshBacklog). So you CANNOT compare
          subtask.status to some in-memory HEAD value — you MUST read HEAD's blob fresh via
          gitReadFileAtCommit. Do NOT be tempted to use this.#backlog or sessionManager state
          for the HEAD check — those are working-tree/in-memory, not HEAD.

- file: src/tools/git-mcp.ts
  why: PROVIDES gitReadFileAtCommit (lines 552-592, exported at line 840). READ-ONLY consumer
       here — do NOT modify this file (P3.M2.T4.S2 owns it). The function:
         async function gitReadFileAtCommit(filePath, commit, repoPath?): Promise<string>
       runs `git show ${commit}:${filePath}`. `filePath` is REPO-RELATIVE. `commit` accepts
       'HEAD'. THROWS on git error (bad rev, path not in commit, repo missing) — caller MUST
       try/catch. Already imported by tasks-json-recovery.ts:37 — mirror that import path
       (`'../tools/git-mcp.js'`).
  pattern: "const blob = await gitReadFileAtCommit(relPath, 'HEAD', repoPath); // THROWS"
  gotcha: gitReadFileAtCommit takes a REPO-RELATIVE file path + commit; readTasksJSON takes a
          SESSION DIR and reads the working tree. They are NOT interchangeable. For the HEAD
          check you MUST use gitReadFileAtCommit with relPath = relative(repoPath,
          resolve(sessionPath,'tasks.json')).

- file: src/core/tasks-json-recovery.ts
  why: THE CANONICAL "read HEAD's tasks.json + parse + validate" pattern to mirror (PATH B,
       lines ~285-322 per research/03 §5). Shows: `const sessionDir = dirname(resolve(tasksPath));`,
       `const repoPath = opts?.repoPath ?? process.cwd();`,
       `const relPath = relative(repoPath, resolve(tasksPath));`, then
       `gitReadFileAtCommit(relPath, entry.commit, repoPath)` → `JSON.parse` →
       `BacklogSchema.parse`. Import at line 37: `import { gitFileHistory, gitReadFileAtCommit
       } from '../tools/git-mcp.js';`. READ-ONLY — do NOT modify (it's the recovery module; this
       PRP is a separate, simpler HEAD check).
  pattern: |
           // path-relativity setup (mirror this exactly):
           const repoPath = process.cwd();
           const relPath = relative(repoPath, resolve(sessionPath, 'tasks.json'));
           const blob = await gitReadFileAtCommit(relPath, 'HEAD', repoPath);
           const headBacklog = BacklogSchema.parse(JSON.parse(blob)) as Backlog;

- file: src/utils/task-utils.ts
  why: PROVIDES findItem (line 90) — the canonical recursive find-by-id helper. READ-ONLY.
         export function findItem(backlog: Backlog, id: string): HierarchyItem | null
       Returns the Phase|Milestone|Task|Subtask node or null. Use `findItem(headBacklog,
       itemId)?.status === 'Complete'`. Already partially imported at task-orchestrator.ts:30
       (`import { getDependencies } from '../utils/task-utils.js';` + the type-only HierarchyItem
       import at line 29) — MERGE findItem into the value import. Do NOT use the private
       #findTaskInBacklog in cli/commands/artifacts.ts (duplicate, not reusable — research/03 §4c).

- file: src/core/models.ts
  why: PROVIDES BacklogSchema (line 797, a VALUE — `import { BacklogSchema } from './models.js'`)
       and the Backlog type (line 757 — merge into the EXISTING `import type {...} from
       './models.js'` at task-orchestrator.ts:27). BacklogSchema.parse(rawParsed) validates +
       returns a Backlog. ALSO confirms Status has 8 values incl. 'Retrying' + 'Obsolete'
       (research/03 §3) — 'Complete' is the only one we check. READ-ONLY.

- file: src/utils/git-commit.ts
  why: PROVIDES smartCommit (line 316/400). READ-ONLY (P3.M2.T4.S2 owns it). Signature:
         smartCommit(sessionPath: string, message: string, options?: { generateMessage?: boolean }): Promise<string | null>
       First arg is validated non-empty but git ops run against process.cwd() (line 421).
       Returns commit hash or null (null = nothing to commit / failure — NON-FATAL). The
       existing two-phase commit calls (task-orchestrator.ts:1032, :1084) pass `sessionPath`
       (= currentSession.metadata.path) as the first arg — mirror that EXACTLY. Already imported
       at task-orchestrator.ts:34 — no import change needed for smartCommit.

- file: tests/unit/core/task-orchestrator.test.ts
  why: PRIMARY TEST TARGET. research/02 is the complete guide: §1 = the vi.mock inventory
       (NO git-mcp mock exists — ADD one); §2 = the binding patterns (`as any` for smartCommit
       at line 155 — mirror for gitReadFileAtCommit); §3 = createMockSessionManager (220-228) +
       the canonical currentSession shape (869-881, metadata.path = '/plan/001_14b9dc2a33c7');
       §4 = NO existing Complete-skip test (this PRP adds the first); §5 = createTestSubtask
       (166-176) — pass 'Complete' as the status (first test to do so); §6 = all tasks.json
       touchpoints are MOCKED (readTasksJSON/recoverTasksJson/atomicWrite) — the new git-mcp
       mock joins them; §7 = vitest, NO toHaveBeenCalledBefore (use
       toHaveBeenCalledWith/toHaveBeenCalledTimes); §8 = the smartCommit({generateMessage:true})
       assertion patterns (lines 893-908, 1127-1138) to mirror.
  pattern: |
           // ADD near the other vi.mock blocks (e.g. after the git-commit mock at lines 53-57):
           vi.mock('../../../src/tools/git-mcp.js', () => ({
             gitReadFileAtCommit: vi.fn(),
           }));
           // ... later, near line 155 (the `as any` bindings):
           import { gitReadFileAtCommit } from '../../../src/tools/git-mcp.js';
           const mockGitReadFileAtCommit = gitReadFileAtCommit as any;

- file: plan/008_15504f60a0ef/P3M2T4S2/PRP.md
  why: The S2 PRP (Critical-File Deletion Protection, mechanical layer). CONTRACT this PRP
       builds upon: S2 added gitListStagedDeletions/gitRestoreFileFromHead/gitUnstagePath to
       git-mcp.ts + restore_critical_files to git-commit.ts. Those are ALREADY merged
       (verified: the export block at git-mcp.ts:830-844 lists all three + gitReadFileAtCommit;
       git-commit.ts has restore_critical_files). This PRP only IMPORTS gitReadFileAtCommit
       (pre-existing, not added by S2) and CALLS smartCommit (pre-existing). ZERO file overlap
       with S2 (S2 owns git-mcp.ts + git-commit.ts + their tests; this PRP owns
       task-orchestrator.ts + its test). DO NOT touch S2's files.

- url: https://git-scm.com/docs/git-show
  why: confirms `git show <commit>:<path>` reads a blob at a revision; `HEAD:path` works;
        throws (non-zero exit) when the path is absent from that commit. Background for the
        THROWS contract of gitReadFileAtCommit.

- url: https://git-scm.com/docs/git-status#_short_format
  why: background on staged/unstaged states (the stranded state = untracked plan/ dir +
        uncommitted status delta). Not directly used in code.
```

### Current Codebase tree (relevant slice)

```bash
src/core/
  task-orchestrator.ts        # PRIMARY TARGET (replace blind Complete-skip with HEAD-checking skip-recovery; add imports)
  tasks-json-recovery.ts      # READ-ONLY reference (the canonical HEAD-read pattern to mirror)
  session-utils.ts            # READ-ONLY (readTasksJSON — working-tree only; NOT used for HEAD check)
  models.ts                   # READ-ONLY (BacklogSchema value + Backlog type + Status union)
src/tools/
  git-mcp.ts                  # READ-ONLY consumer (gitReadFileAtCommit — P3.M2.T4.S2 owns the file)
src/utils/
  git-commit.ts               # READ-ONLY consumer (smartCommit — P3.M2.T4.S2 owns the file)
  task-utils.ts               # READ-ONLY (findItem — the canonical find-by-id helper)
tests/unit/core/
  task-orchestrator.test.ts   # MODIFY: add vi.mock(git-mcp) + describe('skip-recovery') block
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new modules. All new code is ADDED INTO existing files:
src/core/task-orchestrator.ts
  + import { gitReadFileAtCommit } from '../tools/git-mcp.js'
  + import { BacklogSchema } from './models.js'              # value import (separate from the type-only import)
  + (extend import type { ... Backlog } from './models.js')  # merge into existing line-27 type import
  + (extend import { ... findItem } from '../utils/task-utils.js')  # merge into existing line-30 value import
  + import { join, relative, dirname } from 'node:path'      # extend existing line-37 import (add relative, dirname)
  + private async #checkHeadComplete(sessionPath, itemId): Promise<boolean>  # HEAD-read + parse + findItem; non-fatal
  + REPLACE the blind Complete-skip block (778-787) with the HEAD-checking skip-recovery (calls #checkHeadComplete;
     on stranded → smartCommit({generateMessage:true}))
tests/unit/core/task-orchestrator.test.ts
  + vi.mock('../../../src/tools/git-mcp.js', () => ({ gitReadFileAtCommit: vi.fn() }))
  + import { gitReadFileAtCommit } from '../../../src/tools/git-mcp.js' + const mockGitReadFileAtCommit = gitReadFileAtCommit as any
  + describe('executeSubtask — skip-recovery (PRD §5.1, orphaned-plan/ recovery)') — safe-skip, stranded(non-Complete),
     stranded(not-found), recoverable-error(git throws), recoverable-error(invalid JSON/schema), no-session-path
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL (research/03 §1): gitReadFileAtCommit(filePath, commit, repoPath?) THROWS on any git error
// (bad rev, path not in commit, repo missing). It does NOT return an envelope. The HEAD check MUST
// wrap it in try/catch and treat any throw as "HEAD does not record Complete" (→ stranded → but NON-FATAL
// → fall back to safe skip so we never re-run an already-Complete item). Mirror #recoverAfterAgentRun's
// non-fatal try/catch (task-orchestrator.ts:1177-1244).

// CRITICAL (research/03 §2 vs §1 API MISMATCH): readTasksJSON(sessionPath) reads the WORKING TREE
// (resolve(sessionPath,'tasks.json') + readFile). It CANNOT read HEAD. For the HEAD check you MUST use
// gitReadFileAtCommit(relPath, 'HEAD', repoPath) where relPath = relative(repoPath, resolve(sessionPath,
// 'tasks.json')). Do NOT call readTasksJSON for the HEAD check.

// CRITICAL (path relativity): gitReadFileAtCommit's filePath must be REPO-RELATIVE. If sessionPath is
// '/plan/001_14b9dc2a33c7' and repoPath (process.cwd()) is '/home/dustin/projects/hacky-hack', then
// resolve(sessionPath,'tasks.json') = '/plan/001_14b9dc2a33c7/tasks.json' — but that's an ABSOLUTE path
// that doesn't live under repoPath, so relative(repoPath, ...) would produce a weird '../..' path. LOOK AT
// how the real sessionPath is shaped: research/01 §3 shows currentSession.metadata.path is the literal
// '/plan/001_14b9dc2a33c7'. Check whether the REAL path is repo-relative ('plan/001_...') or absolute.
// tasks-json-recovery.ts uses `dirname(resolve(tasksPath))` + `relative(repoPath, resolve(tasksPath))` —
// i.e. it resolves tasksPath to absolute FIRST, then makes it repo-relative. Mirror that: use
// `relative(repoPath, resolve(sessionPath, 'tasks.json'))` (resolve → absolute → relative handles both
// repo-relative and absolute sessionPath inputs correctly). Do NOT hand-build the relPath.

// GOTCHA (research/02 §4): NO test currently exercises the Complete-skip path. createTestSubtask is always
// called with 'Planned'. This PRP's tests are the FIRST to pass 'Complete'. Ensure createTestSubtask
// accepts 'Complete' (it does — status: Status, and 'Complete' is a valid Status per research/03 §3).

// GOTCHA (research/02 §1): NO vi.mock for git-mcp exists in task-orchestrator.test.ts today. You MUST ADD
// one (`vi.mock('../../../src/tools/git-mcp.js', () => ({ gitReadFileAtCommit: vi.fn() }))`). Because
// vi.mock is HOISTED above imports, the mock object MUST list gitReadFileAtCommit (the only git-mcp export
// task-orchestrator.ts will import). If you later import more git-mcp symbols, add them to the mock too.

// GOTCHA (research/02 §2): this test file uses `as any` casts (NOT vi.mocked) for smartCommit
// (line 155). Mirror that for gitReadFileAtCommit: `const mockGitReadFileAtCommit = gitReadFileAtCommit as any;`.

// GOTCHA (research/01 §6): currentSession access is INCONSISTENT in the source (! at 970, ?. at 1023,
// guard-assign at 1180). For the skip block, USE the optional-chain + guard form (`?.` + `if (sessionPath)`)
// — it's the safest (matches line 1023) and lets the no-session-path test (Success Criterion) exercise the
// defensive branch cleanly.

// GOTCHA (non-fatal contract — the MOST IMPORTANT invariant): the skip-recovery MUST NEVER cause
// executeSubtask to throw or to re-run an already-Complete item. Every failure mode (HEAD read throws,
// JSON parse fails, BacklogSchema.parse fails, findItem returns null, smartCommit throws/returns null)
// MUST result in a safe skip (log + return). The whole point is: "already Complete → don't re-run, but
// recover the stranded plan/ if we safely can." If recovery itself is unsafe, SKIP (don't re-run).

// GOTCHA (HEAD-not-found ⇒ stranded, NOT safe): if findItem returns null (the item id is NOT in HEAD's
// backlog at all), that means HEAD has NO record of the item — which means HEAD certainly doesn't record
// it Complete → it's STRANDED → run the recovery commit. Do NOT treat not-found as "safe skip". The helper
// returns true ONLY when findItem finds the item AND status === 'Complete'; everything else is false
// (stranded).

// GOTCHA (don't touch sibling-PRP files): git-mcp.ts and git-commit.ts are OWNED by P3.M2.T4.S2 (already
// merged — verified). This PRP only IMPORTS gitReadFileAtCommit and CALLS smartCommit. Do NOT edit either
// file. Do NOT edit models.ts, task-utils.ts, session-utils.ts, tasks-json-recovery.ts (read-only
// consumers). The ONLY production file this PRP edits is task-orchestrator.ts.

// GOTCHA (commit message): mirror the existing two-phase commit message shape — `${subtask.id}: ${subtask.title}`
// (task-orchestrator.ts:1033). Append a clear "(skip-recovery: persist stranded plan/)" suffix so the
// recovery commit is identifiable in git log. Use { generateMessage: true } so stagecoach describes the
// actual stranded plan/ diff (matches the survival commit at line 1035).
```

---

## Implementation Blueprint

### Data models and structure

No domain data models change. The only new surface is a private boolean-returning
method on `TaskOrchestrator`. The `Backlog` type and `BacklogSchema` are consumed
read-only from `./models.js`; `findItem` read-only from `../utils/task-utils.js`;
`gitReadFileAtCommit` read-only from `../tools/git-mcp.js`.

```typescript
// New private method on TaskOrchestrator (no new types):
/**
 * (JSDoc — Mode A) PRD §5.1 orphaned-plan/ skip-recovery HEAD check.
 * Reads HEAD's tasks.json, returns true ONLY when HEAD records `itemId` as
 * 'Complete'. Non-fatal: any error (git read, JSON parse, schema validate,
 * item-not-found) returns false (→ caller treats as stranded → recovery
 * commit) BUT the caller's own try/catch ensures even a throw here never
 * re-runs the item. HEAD-not-found ⇒ false (stranded), NOT safe.
 */
async #checkHeadComplete(sessionPath: string, itemId: string): Promise<boolean> {
  try {
    const repoPath = process.cwd();
    const relPath = relative(repoPath, resolve(sessionPath, 'tasks.json'));
    const blob = await gitReadFileAtCommit(relPath, 'HEAD', repoPath); // THROWS on error
    const parsed = JSON.parse(blob);                                   // THROWS on invalid JSON
    const headBacklog = BacklogSchema.parse(parsed) as Backlog;        // THROWS on schema fail
    const headItem = findItem(headBacklog, itemId);
    return headItem?.status === 'Complete';
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    this.#logger.warn({ itemId, err: msg },
      'Skip-recovery: could not read/parse HEAD tasks.json; assuming stranded (non-fatal)');
    return false; // → caller runs recovery commit; if THAT also fails, caller's try/catch → safe skip
  }
}
```

> **`resolve` vs `join`**: `resolve(sessionPath, 'tasks.json')` produces an
> absolute path (robust regardless of whether `sessionPath` is repo-relative or
> absolute); `relative(repoPath, <abs>)` then makes it repo-relative for git.
> This exactly mirrors `tasks-json-recovery.ts` PATH B (research/03 §5). Add
> `resolve` to the `node:path` import too: `import { join, relative, dirname,
> resolve } from 'node:path'` (`dirname` is included for parity with the
> recovery module's pattern even if unused — OR omit `dirname` if unused to keep
> the import minimal; prefer minimal: `import { join, relative, resolve } from
> 'node:path'`).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/core/task-orchestrator.ts — extend imports
  - LINE 37: `import { join } from 'node:path';` → `import { join, relative, resolve } from 'node:path';`
  - LINE 27 (type import from './models.js'): ADD `Backlog` to the type list (it's a type).
  - ADD a NEW value import (BacklogSchema is a VALUE, not a type): `import { BacklogSchema } from './models.js';`
    (place it immediately after the type-only models import block — ESM allows a type-only and a value
    import from the same module as separate statements; do NOT merge a value into `import type`.)
  - LINE 30 (value import from '../utils/task-utils.js'): ADD `findItem` to the named imports
    (`import { getDependencies, findItem } from '../utils/task-utils.js';`). NOTE line 29 is
    `import type { HierarchyItem } ...` — findItem is a VALUE, goes in the line-30 value import.
  - ADD: `import { gitReadFileAtCommit } from '../tools/git-mcp.js';` (new import line; place near the
    other ../tools or ../utils imports, e.g. after the git-commit import at line 34).
  - GOTCHA: smartCommit (line 34) and readTasksJSON (line 36) are ALREADY imported — no change.
  - GOTCHA: keep the `.js` extensions (NodeNext ESM convention used throughout the file).

Task 2: MODIFY src/core/task-orchestrator.ts — add #checkHeadComplete private method
  - ADD `private async #checkHeadComplete(sessionPath: string, itemId: string): Promise<boolean>`
    as a method on the TaskOrchestrator class.
  - BODY (see Data models block above): repoPath=process.cwd(); relPath=relative(repoPath,
    resolve(sessionPath,'tasks.json')); blob=gitReadFileAtCommit(relPath,'HEAD',repoPath);
    parsed=JSON.parse(blob); headBacklog=BacklogSchema.parse(parsed) as Backlog;
    return findItem(headBacklog, itemId)?.status === 'Complete'.
  - NON-FATAL try/catch: on ANY throw → this.#logger.warn({itemId, err:msg}, '...assuming stranded
    (non-fatal)'); return false.
  - JSDoc (Mode A): document the HEAD-read, the "true ONLY when HEAD records Complete" semantics,
    HEAD-not-found ⇒ false (stranded), the non-fatal contract, and the PRD §5.1 reference.
  - PLACEMENT: as a private method near #recoverAfterAgentRun (after it, ~line 1245) — both are
    private recovery helpers; co-locating aids readability. (Private methods can be declared after
    their use site in TS classes — hoisting is fine.)

Task 3: MODIFY src/core/task-orchestrator.ts — replace the blind Complete-skip block (lines 778-787)
  - REPLACE the block:
        if (subtask.status === 'Complete') {
          this.#logger.info({ subtaskId: subtask.id }, 'Already complete, skipping');
          return;
        }
    WITH the HEAD-checking skip-recovery (see Documentation & References → task-orchestrator.ts
    pattern block). The new block:
      - reads sessionPath = this.sessionManager.currentSession?.metadata.path (optional-chain).
      - if sessionPath: headComplete = await this.#checkHeadComplete(sessionPath, subtask.id).
      - if (!headComplete): warn 'Completed in working tree but not in HEAD — stranded plan/ detected;
        running recovery commit'; await smartCommit(sessionPath, `${subtask.id}: ${subtask.title}
        (skip-recovery: persist stranded plan/)`, { generateMessage: true }); (optionally log
        'Skip-recovery commit completed' on success — but smartCommit may return null if nothing to
        commit, which is fine; do NOT throw on null).
      - then (always, both stranded and safe paths): this.#logger.info({ subtaskId: subtask.id },
        'Already complete, skipping'); return;
  - GOTCHA: do NOT remove the existing 'Already complete, skipping' info log — keep it for both paths
    (it still accurately describes the outcome: the item is skipped).
  - GOTCHA: smartCommit is NON-THROWING (returns null on failure — git-commit.ts:380 never-fail-on-commit
    contract), so no extra try/catch is needed around the smartCommit call. But wrap the whole skip block
    defensively OR rely on #checkHeadComplete's internal try/catch + smartCommit's non-throwing contract.
    Preferred: keep the block clean (no outer try/catch) since both primitives are non-throwing; the only
    throwing primitive (gitReadFileAtCommit) is already contained inside #checkHeadComplete.

Task 4: MODIFY tests/unit/core/task-orchestrator.test.ts — add the git-mcp mock + binding
  - ADD a vi.mock block (near the other vi.mock blocks, e.g. after the git-commit mock at lines 53-57):
        vi.mock('../../../src/tools/git-mcp.js', () => ({
          gitReadFileAtCommit: vi.fn(),
        }));
  - ADD the import + binding (near line 155 where smartCommit is bound):
        import { gitReadFileAtCommit } from '../../../src/tools/git-mcp.js';
        const mockGitReadFileAtCommit = gitReadFileAtCommit as any;
  - GOTCHA (research/02 §1): NO git-mcp mock existed before — this is net-new. vi.mock is hoisted; the
    mock object MUST list gitReadFileAtCommit (the only git-mcp symbol task-orchestrator.ts imports).
  - GOTCHA: the top-level beforeEach (line 229) calls vi.clearAllMocks() — so mockGitReadFileAtCommit is
    cleared between tests automatically. But the new describe's beforeEach should mockReset() +
    set a default mockResolvedValue for determinism (mirror the recovery describe's beforeEach,
    research/02 §6 lines 4318-4331).

Task 5: MODIFY tests/unit/core/task-orchestrator.test.ts — add the skip-recovery describe block
  - ADD `describe('executeSubtask — skip-recovery (PRD §5.1, orphaned-plan/ recovery)', () => { ... })`.
  - beforeEach: mockGitReadFileAtCommit.mockReset(); mockSmartCommit.mockReset();
    mockSmartCommit.mockResolvedValue('recoveryhash'); (mirror the two-phase/recovery beforeEach pattern).
  - BUILD a small helper to serialize a backlog with one subtask at a given status:
        const backlogBlob = (id: string, status: Status) =>
          JSON.stringify({ backlog: [{ id:'P1', type:'Phase', title:'P', status:'Planned',
            description:'', milestones:[{ id:'P1.M1', type:'Milestone', title:'M', status:'Planned',
            description:'', tasks:[{ id:'P1.M1.T1', type:'Task', title:'T', status:'Planned',
            description:'', subtasks:[ createTestSubtask(id, 'Sub', status) ] }] }] }] });
    (or reuse createTestPhase/createTestMilestone/createTestTask/createTestBacklog from lines 177-215
    and JSON.stringify the result — preferred, less error-prone. Ensure the serialized shape passes
    BacklogSchema.parse — the factories already produce schema-valid objects, so JSON.stringify of
    createTestBacklog([createTestPhase(...)]) works.)
  - TEST 1 — SAFE SKIP (HEAD also Complete):
      * SETUP: mockGitReadFileAtCommit.mockResolvedValue(backlogBlob('P1.M1.T1.S1', 'Complete'));
        build orchestrator with currentSession.metadata.path='/plan/001_14b9dc2a33c7'.
      * EXECUTE: await orchestrator.executeSubtask(createTestSubtask('P1.M1.T1.S1','Sub','Complete')).
      * VERIFY: expect(mockGitReadFileAtCommit).toHaveBeenCalledTimes(1);
        expect(mockGitReadFileAtCommit).toHaveBeenCalledWith(<relPath>, 'HEAD', <cwd>);
        expect(mockSmartCommit).not.toHaveBeenCalled();
        expect(mockLogger.info).toHaveBeenCalledWith({ subtaskId:'P1.M1.T1.S1' }, 'Already complete, skipping').
  - TEST 2 — STRANDED (HEAD non-Complete):
      * SETUP: mockGitReadFileAtCommit.mockResolvedValue(backlogBlob('P1.M1.T1.S1', 'Implementing')).
      * EXECUTE: await orchestrator.executeSubtask(createTestSubtask('P1.M1.T1.S1','Sub','Complete')).
      * VERIFY: expect(mockSmartCommit).toHaveBeenCalledTimes(1);
        expect(mockSmartCommit).toHaveBeenCalledWith('/plan/001_14b9dc2a33c7',
          expect.stringContaining('skip-recovery'), { generateMessage: true });
        expect(mockLogger.warn).toHaveBeenCalled() (the stranded message).
  - TEST 3 — STRANDED (HEAD not-found):
      * SETUP: mockGitReadFileAtCommit.mockResolvedValue(backlogBlob('OTHER.ID.S9', 'Complete'))
        (a backlog that does NOT contain 'P1.M1.T1.S1').
      * EXECUTE + VERIFY: same as TEST 2 (smartCommit called once).
  - TEST 4 — RECOVERABLE ERROR (git throws):
      * SETUP: mockGitReadFileAtCommit.mockRejectedValue(new Error("path 'plan/.../tasks.json' does
        not exist in 'HEAD'")).
      * EXECUTE: await orchestrator.executeSubtask(createTestSubtask('P1.M1.T1.S1','Sub','Complete')).
      * VERIFY: expect(mockLogger.warn).toHaveBeenCalled() (#checkHeadComplete's warn);
        expect(mockSmartCommit).toHaveBeenCalledTimes(1) (false from helper → stranded → commit runs).
        NOTE: this is the CORRECT behavior — a HEAD-read failure means we can't PROVE HEAD is Complete,
        so we run the recovery commit (which is itself non-throwing). The invariant "never re-run" holds
        because executeSubtask still RETURNS after the commit (it does not fall through to the agent run).
  - TEST 5 — RECOVERABLE ERROR (invalid JSON):
      * SETUP: mockGitReadFileAtCommit.mockResolvedValue('not json{').
      * EXECUTE + VERIFY: same as TEST 4 (warn, smartCommit called once, returns).
  - TEST 6 — No session path:
      * SETUP: currentSession.metadata.path = undefined (mirror research/02 §3 lines 1033-1041).
      * EXECUTE: await orchestrator.executeSubtask(createTestSubtask('P1.M1.T1.S1','Sub','Complete')).
      * VERIFY: expect(mockGitReadFileAtCommit).not.toHaveBeenCalled();
        expect(mockSmartCommit).not.toHaveBeenCalled();
        expect(mockLogger.info).toHaveBeenCalledWith(..., 'Already complete, skipping') (safe skip, no HEAD check).
  - FOLLOW pattern: research/02 §7 — SETUP/EXECUTE/VERIFY comment blocks; toHaveBeenCalledTimes/
    toHaveBeenCalledWith/not.toHaveBeenCalled; NO toHaveBeenCalledBefore.
  - GOTCHA: the relPath asserted in TEST 1 is `relative(process.cwd(), resolve('/plan/001_14b9dc2a33c7',
    'tasks.json'))`. In the test env process.cwd() is the repo root, so compute the expected relPath the
    same way the source does (or assert with expect.stringContaining('tasks.json') + 'HEAD' to avoid
    brittleness on the exact relative path). PREFER: assert the 2nd arg === 'HEAD' and the 3rd ===
    process.cwd(), and the 1st with expect.stringContaining('tasks.json') — robust to path quirks.

Task 6: JSDoc (Mode A — rides with the work)
  - #checkHeadComplete: document HEAD-read semantics, "true ONLY when HEAD records Complete",
    HEAD-not-found ⇒ false (stranded rationale), non-fatal contract, PRD §5.1 reference.
  - Inline comment on the replaced skip block: cite PRD §5.1 "Orphaned-plan/ Recovery → Skip-recovery"
    and explain WHY (force-interrupt strands plan/ + status; blind skip orphans forever).
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: #checkHeadComplete — non-fatal HEAD-status check. Mirrors #recoverAfterAgentRun's
// non-fatal try/catch (task-orchestrator.ts:1177-1244) and tasks-json-recovery.ts PATH B's
// git-read + parse + validate (research/03 §5).

import { gitReadFileAtCommit } from '../tools/git-mcp.js';
import { BacklogSchema } from './models.js';
import type { /* existing types, */ Backlog } from './models.js';
import { /* existing, */ findItem } from '../utils/task-utils.js';
import { join, relative, resolve } from 'node:path';

/**
 * PRD §5.1 "Orphaned-`plan/` Recovery" — skip-recovery HEAD check.
 *
 * Reads HEAD's `tasks.json` and returns `true` ONLY when HEAD records
 * `itemId` with status `'Complete'`. Used by {@link executeSubtask} on the
 * Completed-skip path to detect the stranded state: an item that is
 * `'Complete'` in the working tree but was never committed (a force-
 * interrupted prior run left its `plan/` dir + status untracked). When this
 * returns `false`, the caller runs `smartCommit` to persist the stranded
 * state before skipping.
 *
 * **HEAD-not-found ⇒ `false` (stranded):** if `findItem` cannot locate
 * `itemId` in HEAD's backlog at all, HEAD has no record of the completion →
 * it is certainly not recorded Complete → stranded. Do NOT treat not-found
 * as a safe skip.
 *
 * **Non-fatal:** any error (git read failure, invalid JSON, schema
 * validation failure) is logged at `warn` and returns `false`. The caller's
 * recovery commit is itself non-throwing (`smartCommit` never-fail-on-commit
 * contract), and `executeSubtask` always `return`s after the skip block — so
 * a recovery failure NEVER causes the already-Complete item to be re-run.
 *
 * @param sessionPath - The session metadata dir (currentSession.metadata.path).
 * @param itemId - The subtask id to look up in HEAD's tasks.json.
 * @returns `true` iff HEAD's tasks.json records `itemId` as `'Complete'`.
 */
async #checkHeadComplete(sessionPath: string, itemId: string): Promise<boolean> {
  try {
    const repoPath = process.cwd();
    // repo-RELATIVE path for git (mirror tasks-json-recovery.ts PATH B):
    const relPath = relative(repoPath, resolve(sessionPath, 'tasks.json'));
    const blob = await gitReadFileAtCommit(relPath, 'HEAD', repoPath); // THROWS → caught
    const headBacklog = BacklogSchema.parse(JSON.parse(blob)) as Backlog;
    const headItem = findItem(headBacklog, itemId);
    return headItem?.status === 'Complete';
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    this.#logger.warn(
      { itemId, err: msg },
      'Skip-recovery: could not read/parse HEAD tasks.json; assuming stranded (non-fatal)'
    );
    return false;
  }
}

// PATTERN: the replaced skip block (lines 778-787). smartCommit is non-throwing (returns null on
// failure), and #checkHeadComplete is non-throwing (try/catch inside), so the block needs NO
// outer try/catch. The 'Already complete, skipping' info log is preserved on BOTH paths.
if (subtask.status === 'Complete') {
  const sessionPath = this.sessionManager.currentSession?.metadata.path;
  if (sessionPath) {
    // PRD §5.1 "Orphaned-plan/ Recovery → Skip-recovery": verify HEAD also records Complete.
    // A force-interrupted prior run can leave the item Complete in the working tree but never
    // committed — stranding its plan/ dir + status. If HEAD disagrees, run smartCommit to persist
    // the stranded state before skipping (so the next resume is a clean skip).
    const headComplete = await this.#checkHeadComplete(sessionPath, subtask.id);
    if (!headComplete) {
      this.#logger.warn(
        { subtaskId: subtask.id },
        'Completed in working tree but not in HEAD — stranded plan/ detected; running recovery commit'
      );
      await smartCommit(
        sessionPath,
        `${subtask.id}: ${subtask.title} (skip-recovery: persist stranded plan/)`,
        { generateMessage: true }
      );
    }
  }
  this.#logger.info({ subtaskId: subtask.id }, 'Already complete, skipping');
  return;
}
```

### Integration Points

```yaml
DATABASE:
  - none

CONFIG:
  - none (no .env.example, no constants.ts, no new env vars). The HEAD check is unconditional
    on the Completed-skip path; no operator toggle (PRD §5.1 mandates it).

ROUTES:
  - none (no CLI surface; internal skip-path recovery, invoked from executeSubtask)

DOWNSTREAM / UPSTREAM:
  - CONSUMES (pre-existing, read-only):
      gitReadFileAtCommit        (src/tools/git-mcp.ts:552 — P3.M2.T4.S2's module; already exported)
      smartCommit                (src/utils/git-commit.ts:316 — P3.M2.T4.S2's module; already imported at line 34)
      BacklogSchema + Backlog    (src/core/models.ts:757/797)
      findItem                   (src/utils/task-utils.ts:90)
  - CONSUMES (contract INPUT): the two-phase commit from P3.M1.T3.S2 (pre-cleanup survival commit at
      task-orchestrator.ts:1032). This PRP REUSES its smartCommit({generateMessage:true}) call shape.
      The pre-cleanup commit is the FORWARD guard (prevents orphaning going forward); this skip-recovery
      is the BACKWARD guard (recovers items already orphaned by an interrupt before that commit landed).
  - COMPLETES P3.M2.T5 (Orphaned-plan/ Recovery): S1 (skip-recovery) + the pre-cleanup commit
      (P3.M1.T3.S2, already done) together satisfy PRD §5.1's two-guard mandate. S1 is the sole
      subtask of M2.T5.
  - Does NOT affect: restore_critical_files (P3.M2.T4.S2 — untouched), tasks.json recovery
      (#recoverAfterAgentRun / recoverTasksJson — untouched, separate path), the agent run,
      PRP generation, the cleanup runner.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After editing src/core/task-orchestrator.ts:
npm run lint           # ESLint — zero errors (new method + imports follow existing patterns)
npm run format:check   # Prettier — zero diffs (run `npm run format` to auto-fix)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — zero errors
                         # (confirms: the new imports resolve; BacklogSchema value import is separate
                         #  from the type-only Backlog import; findItem merge into the value import;
                         #  #checkHeadComplete is a valid private method; the replaced skip block typechecks)

# Combined gate:
npm run lint && npm run format:check && npm run typecheck
# Expected: GREEN.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The new skip-recovery tests:
npx vitest run tests/unit/core/task-orchestrator.test.ts -t "skip-recovery"
# Expected: GREEN. All 6 new tests pass (safe-skip, stranded non-Complete, stranded not-found,
#   recoverable git-throw, recoverable invalid-JSON, no-session-path).

# The full task-orchestrator suite (regression — ensure the import additions + new vi.mock didn't break
# existing tests, especially the two-phase-commit and recovery describes):
npx vitest run tests/unit/core/task-orchestrator.test.ts
# Expected: GREEN. KEY RISK: adding `vi.mock('../../../src/tools/git-mcp.js', ...)` could affect any
#   existing test that transitively depends on git-mcp — but task-orchestrator.ts did NOT import git-mcp
#   before, so no existing test exercises real git-mcp through the orchestrator. The new mock is a no-op
#   for existing tests (they never call gitReadFileAtCommit). If any existing test fails, investigate
#   whether it was relying on task-orchestrator NOT importing git-mcp (unlikely) before editing.

# Full suite:
npm run test:run
# Expected: GREEN.
```

### Level 3: Integration Testing (System Validation)

```bash
# This PRP adds an internal skip-path HEAD check; there is no new endpoint/CLI. Integration validation
# is a BEHAVIORAL check against a real (temp) git repo: commit a tasks.json with an item at non-Complete,
# then mutate the working-tree tasks.json to Complete + add an untracked plan/ dir (simulating the
# stranded state), then call executeSubtask and assert smartCommit persisted the plan/ dir + status.

# Manual grep checks — prove the wiring landed:
grep -n "gitReadFileAtCommit" src/core/task-orchestrator.ts
# Expected: 1 import + 1 call site (inside #checkHeadComplete).

grep -n "#checkHeadComplete" src/core/task-orchestrator.ts
# Expected: 1 definition + 1 call site (inside the replaced Complete-skip block).

grep -n "stranded plan/" src/core/task-orchestrator.ts
# Expected: the warn log message (1 match) + the commit-message suffix (1 match).

grep -nE "BacklogSchema|findItem|relative, resolve|from 'node:path'" src/core/task-orchestrator.ts
# Expected: the new imports are present.

# Confirm the skip block now calls smartCommit ONLY on the stranded path (not the safe path):
awk '/if \(subtask\.status === .Complete.\)/,/^    \}$/' src/core/task-orchestrator.ts | head -30
# Expected: the block reads sessionPath, calls #checkHeadComplete, conditionally calls smartCommit,
#   then logs 'Already complete, skipping' and returns.

# (Optional) Real-repo behavioral check in a throwaway temp dir — proves gitReadFileAtCommit reads HEAD:
tmp=$(mktemp -d) && cd "$tmp" && git init -q && git config user.email t@t && git config user.name t
mkdir -p plan/001_x && echo '{"backlog":[]}' > plan/001_x/tasks.json
git add -A && git commit -qm init
# mutate working tree (simulate stranded): DO NOT commit. Then gitReadFileAtCommit('plan/001_x/tasks.json','HEAD')
# returns the INITIAL blob (empty backlog), proving HEAD disagrees with the working tree.
git show HEAD:plan/001_x/tasks.json   # → the committed (HEAD) version, NOT the working-tree mutation

# Confirm scope — only the two expected files changed:
git diff --name-only
# Expected EXACTLY:
#   src/core/task-orchestrator.ts
#   tests/unit/core/task-orchestrator.test.ts
# (plus plan/008_.../P3M2T5S1/ research/PRP artifacts, which are not source). If git-mcp.ts,
#  git-commit.ts, models.ts, task-utils.ts, session-utils.ts, tasks-json-recovery.ts, or any other
#  source file appears, STOP — out of scope / collides with P3.M2.T4.S2 or read-only consumers.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# (Optional) End-to-end resume simulation — proves the orphaned-plan/ recovery fires on a REAL
# interrupted run. This is heavyweight (requires a full pipeline run + force-kill + --continue) and is
# NOT required for PRP sign-off (the Level-2 unit tests with faithfully-mocked git behavior are
# sufficient — the gitReadFileAtCommit + smartCommit mechanics are verified in research). Document as a
# follow-up manual QA if desired.

# Security scanning (no new surface, but for completeness):
# (no security-relevant change — internal skip-path recovery, no user input handling)
```

---

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed successfully.
- [ ] `npm run lint` GREEN (zero errors).
- [ ] `npm run format:check` GREEN (zero diffs).
- [ ] `npm run typecheck` GREEN (zero errors).
- [ ] `npm run test:run` GREEN (full suite).
- [ ] `npm run validate` GREEN (the project's combined gate).

### Feature Validation

- [ ] The blind `if (subtask.status === 'Complete') return;` early-return is REPLACED by a
      HEAD-checking skip-recovery (Level 3 awk confirms the new block structure).
- [ ] `#checkHeadComplete` exists as a private method, reads HEAD's tasks.json via
      `gitReadFileAtCommit`, returns `true` ONLY when HEAD records the item `'Complete'`.
- [ ] On the SAFE path (HEAD also Complete): `smartCommit` NOT called; `executeSubtask` returns;
      'Already complete, skipping' logged.
- [ ] On the STRANDED path (HEAD non-Complete OR not-found): `smartCommit(sessionPath, msg,
      { generateMessage: true })` called exactly once; `executeSubtask` returns (does NOT re-run
      the agent).
- [ ] On any HEAD-read/parse error (git throws, invalid JSON, schema fail): `#checkHeadComplete`
      logs a warn and returns false → stranded path → recovery commit runs; `executeSubtask` returns.
      (The invariant "never re-run an already-Complete item" holds because the function always
      returns after the skip block.)
- [ ] No session path (`currentSession.metadata.path` undefined): skips the HEAD check entirely,
      logs + returns (no gitReadFileAtCommit call, no smartCommit).
- [ ] The 6 new unit tests pass (safe-skip, stranded non-Complete, stranded not-found,
      recoverable git-throw, recoverable invalid-JSON, no-session-path).
- [ ] JSDoc on `#checkHeadComplete` documents the HEAD-read semantics, HEAD-not-found ⇒ stranded,
      non-fatal contract, and PRD §5.1 reference (Mode A).
- [ ] `git diff --name-only` shows EXACTLY `src/core/task-orchestrator.ts` and
      `tests/unit/core/task-orchestrator.test.ts`.

### Code Quality Validation

- [ ] Follows existing patterns: `#recoverAfterAgentRun` non-fatal try/catch + warn/error log;
      `tasks-json-recovery.ts` PATH B git-read + parse + validate; two-phase-commit
      `smartCommit({generateMessage:true})` call shape; test SETUP/EXECUTE/VERIFY style +
      `as any` mock bindings.
- [ ] File placement unchanged (no new modules — new code added INTO task-orchestrator.ts +
      its test).
- [ ] Anti-patterns avoided: no `readTasksJSON` for the HEAD check (working-tree only); no
      re-running of already-Complete items on any failure path; no editing of git-mcp.ts /
      git-commit.ts / models.ts / task-utils.ts (read-only consumers / sibling-PRP files);
      no outer try/catch around the skip block (both primitives are non-throwing); no new config.
- [ ] Dependencies properly managed: no new dependencies; reuses `gitReadFileAtCommit`,
      `smartCommit`, `BacklogSchema`, `findItem`, `node:path` (relative/resolve/join).

### Documentation & Deployment

- [ ] Mode A: no new env vars, no config file changes, no README/docs/ edits. JSDoc rides with the work.
- [ ] The PRD §5.1 "Orphaned-`plan/` Recovery → Skip-recovery" requirement is now satisfied; combined
      with the pre-cleanup commit (P3.M1.T3.S2, already done), P3.M2.T5 "Orphaned-plan/ Recovery" is
      COMPLETE.

---

## Anti-Patterns to Avoid

- ❌ **Don't use `readTasksJSON` for the HEAD check.** It reads the WORKING TREE only
     (`resolve(sessionPath,'tasks.json')` + `readFile`). It CANNOT read HEAD. Use
     `gitReadFileAtCommit(relPath, 'HEAD', repoPath)` (research/03 §1/§2).
- ❌ **Don't treat HEAD-not-found as a safe skip.** If `findItem` returns null (the item id is not in
     HEAD's backlog at all), HEAD has NO record of the completion → it's STRANDED → run the recovery
     commit. `#checkHeadComplete` returns `true` ONLY when the item is found AND status === 'Complete'.
- ❌ **Don't make the skip-recovery re-run the item on any failure path.** The whole point is "already
     Complete → don't re-run, but recover the stranded plan/ if we safely can." Every failure mode
     (HEAD read throws, JSON parse fails, schema fails, smartCommit returns null) MUST result in
     `executeSubtask` returning. Never fall through to the agent run.
- ❌ **Don't add an outer try/catch around the replaced skip block.** Both primitives are non-throwing
     (`#checkHeadComplete` has its own internal try/catch; `smartCommit` has a never-fail-on-commit
     contract returning null on failure). An outer try/catch is dead code. (If you're paranoid, a
     top-level try/catch that logs + returns is acceptable but unnecessary — prefer clean code.)
- ❌ **Don't edit `src/tools/git-mcp.ts`, `src/utils/git-commit.ts`, `src/core/models.ts`,
     `src/utils/task-utils.ts`, `src/core/session-utils.ts`, or `src/core/tasks-json-recovery.ts`.**
     These are read-only consumers (models/task-utils/session-utils) or sibling-PRP files
     (git-mcp/git-commit owned by P3.M2.T4.S2; tasks-json-recovery is the canonical pattern to MIRROR,
     not modify). The ONLY production file this PRP edits is `src/core/task-orchestrator.ts`.
- ❌ **Don't add a second `import type { ... } from './models.js'`.** Merge the `Backlog` type into the
     EXISTING line-27 type-only import. `BacklogSchema` is a VALUE — it needs a separate non-type
     `import { BacklogSchema } from './models.js'`. (ESM/TS allows a type-only and a value import from
     the same module as two statements.)
- ❌ **Don't forget the `vi.mock('../../../src/tools/git-mcp.js', ...)` block when you add the
     `gitReadFileAtCommit` import to the test.** `vi.mock` is hoisted; the mock object MUST list
     `gitReadFileAtCommit` or the import is `undefined` and `gitReadFileAtCommit as any` is
     `undefined` → the test's `mockGitReadFileAtCommit.mockResolvedValue(...)` throws (research/02 §1/§2).
- ❌ **Don't hand-build the repo-relative tasks.json path.** Use
     `relative(repoPath, resolve(sessionPath, 'tasks.json'))` exactly as `tasks-json-recovery.ts` PATH B
     does (research/03 §5). `resolve` → absolute → `relative` handles both repo-relative and absolute
     `sessionPath` inputs. Hand-building (`sessionPath + '/tasks.json'`) breaks if `sessionPath` is
     absolute or repo-relative unexpectedly.
- ❌ **Don't change the commit message format away from the established `${subtask.id}: ${subtask.title}`
     shape.** Mirror the survival commit at line 1033; append a clear
     "(skip-recovery: persist stranded plan/)" suffix for git-log identifiability. Always pass
     `{ generateMessage: true }` (matches the survival commit at line 1035).
- ❌ **Don't add config, env vars, or docs.** Mode A — JSDoc only. Contract item 5 (DOCS) explicitly
     says "none — no user-facing/config/API surface change."

---

## Confidence Score

**9/10** for one-pass implementation success.

Rationale: Every primitive this PRP needs is **pre-existing and verified**:
`gitReadFileAtCommit` (full signature + THROWS contract confirmed in research/03 §1,
already exported at git-mcp.ts:840, already imported by tasks-json-recovery.ts:37);
`findItem` (research/03 §4c, task-utils.ts:90, canonical recursive find-by-id);
`BacklogSchema` (research/03 §4b, models.ts:797); `smartCommit` (first-arg =
sessionPath, git ops run against `process.cwd()` at git-commit.ts:421, non-throwing
never-fail-on-commit contract). The canonical "read HEAD's tasks.json + parse +
validate + lookup" pattern is documented verbatim from
`tasks-json-recovery.ts` PATH B (research/03 §5) — this PRP is a strict subset of
that pattern (read HEAD directly, no history walk). The exact target block (blind
skip at task-orchestrator.ts:778-787) and the exact import-merge points (line 27
type import, line 30 value import, line 37 path import, line 34 smartCommit already
present) are pinned to line numbers in research/01 §1/§2. The test patterns are
fully documented (research/02): the `vi.mock` + `as any` binding convention, the
`createTestSubtask`/`createMockSessionManager` factories, the canonical
`currentSession.metadata.path` literal, the SET UP/EXECUTE/VERIFY style, and the
explicit note that NO git-mcp mock and NO Complete-skip test exist today (so this
PRP adds both net-new). The -1 is for two judgment calls: (a) the exact
repo-relative path computation in tests (assert with `expect.stringContaining` to
avoid brittleness — Task 5 notes this); and (b) whether the recovery commit's
non-throwing contract fully covers the "no session path" defensive branch (it does
— smartCommit validates non-empty sessionPath and returns null, but this PRP's
optional-chain `?.` + `if (sessionPath)` guard means smartCommit is never even
called when sessionPath is undefined, which is cleaner and is tested in TEST 6).
No external dependencies, no runtime control-flow change beyond replacing one
early-return block, no parallel-PR collision (scoped strictly to
task-orchestrator.ts + its test; P3.M2.T4.S2 owns git-mcp.ts/git-commit.ts;
P3.M2.T6 owns prompt delivery; read-only consumers untouched).