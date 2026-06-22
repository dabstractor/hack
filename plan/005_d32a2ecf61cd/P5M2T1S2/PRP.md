# PRP — P5.M2.T1.S2: Smart-recovery routine (re-apply legitimate delta + git-history restore)

## Goal

**Feature Goal**: Implement PRD §5.1 "tasks.json Protection & Smart Recovery" as a **new self-contained module** `src/core/tasks-json-recovery.ts` exporting a single async function `recoverTasksJson(...)`. After a Coder/agent run that may have corrupted `tasks.json` (truncated write, partial edit, schema-invalid mutation) or scribbled unauthorized status changes, this routine (1) re-applies ONLY the legitimate status delta for the run onto a trustworthy base, discarding unauthorized mutations, and (2) if the on-disk file fails to parse/validate, walks git history (via the S1 primitives) to restore the last valid committed version, re-applies the legitimate delta, and preserves items currently in `Researching`/`Retrying` status. It is **always non-fatal** — it never throws to the caller; on total failure it logs and leaves state as-is. Returns a typed result for observability.

**Deliverable**:
1. **`src/core/tasks-json-recovery.ts`** (NEW file) — exports:
   - `recoverTasksJson(tasksPath, legitimateDelta, opts?): Promise<TasksJsonRecoveryResult>` (full JSDoc, Mode A docs).
   - `TasksJsonRecoveryResult` interface (`{ restored, source, reason? }`).
   - `RecoverTasksJsonOptions` interface (`{ baselineBacklog?, repoPath? }`).
   - One internal (non-exported) helper `setItemStatus(backlog, itemId, status)` that walks Phase→Milestone→Task→Subtask and mutates the target item's status via the established readonly-cast idiom.
2. **`tests/unit/core/tasks-json-recovery.test.ts`** (NEW file) — dedicated unit tests using a **real ephemeral tmpdir + real `git init` repo** (the contract's honest-recovery approach; NOT a module-wide `vi.mock('simple-git')`). Covers all four contract scenarios + the non-fatal total-failure path.
3. **`docs/ARCHITECTURE.md`** — append a new `### tasks.json Protection & Smart Recovery` subsection inside `## State Management and Persistence`, **after** `### State Persistence Patterns` (Mode A docs, rides with the work).

**Success Definition**: `npm run validate` (eslint + prettier --check + tsc --noEmit) **and** `npm run test:run` (vitest run) both green; the new `tasks-json-recovery.test.ts` passes (RED observed before GREEN — TDD); `git diff --stat` shows ONLY `src/core/tasks-json-recovery.ts` + `tests/unit/core/tasks-json-recovery.test.ts` + `docs/ARCHITECTURE.md`; the existing `git-mcp.test.ts`, `state-validator.ts`, `session-utils.ts`, `task-orchestrator.ts`, and `constants.ts` are **untouched**; `recoverTasksJson` never throws (verified by the total-failure test).

## User Persona

**Target User**: The pipeline orchestrator — specifically **P5.M2.T1.S3**, which wires `recoverTasksJson` into `TaskOrchestrator.executeSubtask` after each agent run (PRD §5.1, §9.3.2).

**Use Case**: After a Coder agent finishes (or is interrupted), the orchestrator calls `recoverTasksJson(sessionTasksPath, { itemId, status }, { baselineBacklog: this.#backlog, repoPath: cwd })` to reconcile on-disk `tasks.json`: re-apply only the legitimate status for the item just implemented/interrupted, discard any unauthorized mutations the agent made, and — if the agent truncated or otherwise corrupted the file — transparently restore the last valid committed version before re-applying.

**User Journey**: orchestrator agent run ends → `recoverTasksJson(path, delta, {baseline, repoPath})` → (clean disk) reconstruct from baseline + delta, write; OR (corrupt disk) `gitFileHistory` → `gitReadFileAtCommit` first-valid → restore + apply delta + preserve Researching/Retrying, write → typed result returned → orchestrator proceeds (never blocks on recovery failure).

**Pain Points Addressed**: PRD §5.1 — *"Agents routinely corrupt `tasks.json` despite the forbidden-operations rules — truncated writes, partial edits, or schema-invalid mutations. The system must survive this without human intervention."* Today there is **no** recovery routine: the orchestrator trusts on-disk `tasks.json` after an agent run. This subtask supplies the missing self-healing routine (the second half of R4).

## Why

- **Business value**: Closes the **second half of R4** ("tasks.json Protection & Smart Recovery", PRD §5.1 + §9.3.2). S1 (`P5.M2.T1.S1`, in-flight) supplies the generic git-history/restore *primitives*; **this subtask composes them into the recovery flow** and adds the legitimate-delta re-application + Researching/Retrying preservation logic + the Mode A `ARCHITECTURE.md` narrative. S3 (`P5.M2.T1.S3`) wires it into the orchestrator.
- **Scope boundary**: This subtask owns the **recovery routine module + its tests + the ARCHITECTURE.md Mode A narrative**. It does NOT touch the orchestrator (`task-orchestrator.ts` — S3 territory), does NOT add git primitives (`git-mcp.ts` — S1 territory), does NOT touch `state-validator.ts`/`session-utils.ts`/`constants.ts` (consumed as-is), and does NOT edit `README.md`/`WORKFLOWS.md` (Mode B, deferred to P5.M3).
- **Why a new module** (`tasks-json-recovery.ts`, not an extension of `state-validator.ts`): the contract explicitly names it (`e.g. src/core/tasks-json-recovery.ts`). It composes three concerns that don't belong in the validator (git-history walk from S1, legitimate-delta re-application, Researching/Retrying preservation) into one cohesive, independently-testable unit. Keeps `state-validator.ts` focused on schema/dependency validation+repair.

## What

### User-visible behavior

None directly — `recoverTasksJson` is an internal library function (no CLI, no MCP tool). Observable downstream effect (in S3): after a corrupting agent run, the orchestrator's on-disk `tasks.json` is automatically reconciled (legitimate status applied, unauthorized mutations discarded, corrupt file restored from git history) and the session continues without human intervention.

### Technical requirements (the CONTRACT)

1. **Signature (verbatim)** — new module `src/core/tasks-json-recovery.ts`:
   ```ts
   export interface TasksJsonRecoveryResult {
     restored: boolean;            // true ONLY when a git-history restore occurred
     source: 'disk' | 'git';       // 'disk' = clean path (re-applied on baseline/disk); 'git' = restored from history
     reason?: string;              // human-readable detail (commit hash restored from, why a path was taken, failure cause)
   }

   export interface RecoverTasksJsonOptions {
     baselineBacklog?: Backlog;    // pre-agent in-memory snapshot; lets the routine DISCARD unauthorized mutations on the clean-disk path
     repoPath?: string;            // git repository root for the S1 primitives; defaults to process.cwd()
   }

   export async function recoverTasksJson(
     tasksPath: string,                                  // path to the tasks.json FILE (e.g. 'plan/005_.../tasks.json')
     legitimateDelta: { itemId: string; status: Status },// the item id + the status the orchestrator intends/just applied
     opts?: RecoverTasksJsonOptions
   ): Promise<TasksJsonRecoveryResult>
   ```
2. **Path bridging (CRITICAL)**. `tasksPath` is the tasks.json *file* path, but the reused primitives take different path shapes:
   - `sessionDir = dirname(tasksPath)` → pass to `readTasksJSON(sessionDir)` / `writeTasksJSON(sessionDir, backlog)` (they resolve `tasks.json` inside the dir).
   - `relPath = relative(opts?.repoPath ?? process.cwd(), tasksPath)` → pass to `gitFileHistory(relPath, repoPath)` / `gitReadFileAtCommit(relPath, commit, repoPath)` (git needs repo-**relative** paths).
3. **Three-path logic** (exactly PRD §5.1 + contract LOGIC 1–3):
   - **PATH A — clean disk (parse + validate OK):** `try readTasksJSON(sessionDir)`. If it resolves AND `validateBacklogState(backlog).isValid === true`: pick the reconstruction base = `opts?.baselineBacklog ?? diskBacklog` (baseline preferred so unauthorized mutations are discarded). `structuredClone(base)` → `setItemStatus(clone, legitimateDelta.itemId, legitimateDelta.status)` → `writeTasksJSON(sessionDir, clone)`. Return `{ restored:false, source:'disk', reason:'re-applied legitimate status delta' }`.
   - **PATH B — corrupt disk (readTasksJSON THROWS, or validateBacklogState !isValid):** `gitFileHistory(relPath, repoPath)` (newest-first). For each `{commit}`: `gitReadFileAtCommit(relPath, commit, repoPath)` → `try JSON.parse → BacklogSchema.parse → validateBacklogState`. On the **first** version that is schema-valid (validateBacklogState.isValid preferred; schema-valid alone acceptable), reconstruct: `structuredClone(restored)` → `setItemStatus(clone, legitimateDelta.itemId, legitimateDelta.status)` → `writeTasksJSON(sessionDir, clone)`. Return `{ restored:true, source:'git', reason:'restored from <commit>' }`. Researching/Retrying items present in the restored version are preserved **automatically** (we mutate ONLY the target item — never reset non-target items to Planned).
   - **PATH C — total failure (no valid version in history, OR git primitives throw, OR write fails):** **DO NOT THROW.** Log the error via `getLogger('tasks-json-recovery')` and return `{ restored:false, source:'disk', reason:'recovery failed: <detail>' }`. Leave on-disk state exactly as-is.
4. **Non-fatal invariant (CRITICAL).** Wrap the ENTIRE body in one outer `try/catch`. ANY uncaught error (git throws, JSON parse throws, write throws) is caught, logged, and returned as a PATH C result. `recoverTasksJson` MUST NEVER throw to S3 — a single corrupting agent must never terminate the session (PRD §5.1: *"Restore is automatic and logged... A single corrupting agent must never terminate the session."*).
5. **Preserve `Researching` and `Retrying` (CRITICAL).** The `Status` enum (`src/core/models.ts`) is `'Planned' | 'Researching' | 'Implementing' | 'Retrying' | 'Complete' | 'Failed' | 'Obsolete'` — **there is NO `Ready` status** (PRD §5.1 says "Researching or Ready" but `Ready` does not exist; readiness is tracked by the research queue's internal Map, not a status). The restore path copies Researching/Retrying forward from the restored version by simply not touching them. Do NOT add a `Ready` status anywhere. Do NOT reset Researching/Retrying items to Planned.
6. **Discard unauthorized mutations via baseline.** On PATH A, reconstruct from `opts.baselineBacklog` (the orchestrator's pre-agent in-memory snapshot). Because the disk content is ignored for reconstruction, any status the agent changed on an unrelated item is discarded; only `legitimateDelta` survives. The test *"unauthorized agent mutation of an unrelated item is discarded"* requires `baselineBacklog` to be provided — if omitted, fall back to the disk backlog (degradation: unrelated mutations can't be detected without a baseline; still applies the legitimate delta — documented).
7. **TDD — RED before GREEN.** Write `tests/unit/core/tasks-json-recovery.test.ts` FIRST; confirm RED (`npm run test:run -- tasks-json-recovery` → import error / not-a-function); implement the module; confirm GREEN.
8. **Reuse, do not duplicate:** `readTasksJSON`/`writeTasksJSON`/`atomicWrite` from `../core/session-utils.js`; `validateBacklogState` from `../core/state-validator.js`; `BacklogSchema`/`Status`/`Backlog` types from `../core/models.js`; `gitFileHistory`/`gitReadFileAtCommit` from `../tools/git-mcp.js`; `getLogger` from `../utils/logger.js`. Do NOT reimplement parse/validate/git logic.
9. **Mode A docs (ride with the work):** full JSDoc on `recoverTasksJson` + the two option interfaces; AND append the `### tasks.json Protection & Smart Recovery` subsection to `docs/ARCHITECTURE.md` (see Integration Points for exact placement + content).
10. **Scope guardrails (do NOT touch):** `src/core/state-validator.ts`, `src/core/session-utils.ts`, `src/core/task-orchestrator.ts`, `src/core/models.ts`, `src/tools/git-mcp.ts`, `src/config/constants.ts` (R4 adds NO env var — the routine takes `opts`, not env), `src/utils/git-commit.ts`, `README.md`, `docs/WORKFLOWS.md`, and any other test file.

### Success Criteria

- [ ] `recoverTasksJson` exported from `src/core/tasks-json-recovery.ts` with the exact signature above.
- [ ] PATH A (clean disk + baseline): legitimate delta applied; unauthorized unrelated-item mutation discarded.
- [ ] PATH B (corrupt disk): last valid version restored from git history; legitimate delta applied; Researching/Retrying items preserved.
- [ ] PATH C (total failure): non-fatal — logs + returns typed result; on-disk state untouched; NEVER throws.
- [ ] No `Ready` status introduced; Researching/Retrying never reset to Planned.
- [ ] `npm run validate` passes (zero errors).
- [ ] `npm run test:run` passes (all green; RED observed before GREEN).
- [ ] `git diff --stat` shows ONLY the 3 in-scope files.

## All Needed Context

### Context Completeness Check

_Pass_: An agent with zero codebase knowledge can implement this from (a) the verbatim signature + three-path algorithm in "Implementation Blueprint", (b) the exact path-bridging rules, (c) the canonical test blocks (real tmpdir + real git), (d) the verified primitive behaviors (`readTasksJSON` throws on parse/schema fail; `validateBacklogState.isValid`; S1's `gitFileHistory`/`gitReadFileAtCommit` THROW on failure and return `[]`/blob-string), and (e) the verified validation commands. Every reference resolves to a real file/section today. No inference beyond the canonical blocks required.

### Documentation & References

```yaml
# MUST READ — the sibling S1 PRP (the CONTRACT for the git primitives this routine consumes)
- file: plan/005_d32a2ecf61cd/P5M2T1S1/PRP.md
  why: |
    Defines the EXACT signatures + THROW-on-failure semantics of the primitives S2 imports:
      gitFileHistory(filePath, repoPath?): Promise<{commit,date}[]>  # newest-first; [] on no-history; THROWS on git error
      gitReadFileAtCommit(filePath, commit, repoPath?): Promise<string>  # blob content via `git show <commit>:<path>`; THROWS on error
      gitRestoreFile(filePath, commit='HEAD', repoPath?): Promise<void>  # NOT needed by S2 (S2 writes its own reconstructed backlog)
    All three THROW on failure → S2 MUST consume them via try/catch (wrapped in the outer non-fatal guard).
    S2 uses gitFileHistory + gitReadFileAtCommit ONLY (it reconstructs + writes via writeTasksJSON, not a raw blob restore,
    so it can layer the legitimate delta + preserve Researching/Retrying on top of the restored structure).

# MUST READ — the read/write primitives (path shape + throw behavior)
- file: src/core/session-utils.ts
  why: |
    readTasksJSON(sessionPath): Promise<Backlog>  — resolves `resolve(sessionPath,'tasks.json')`, does JSON.parse + BacklogSchema.parse,
      THROWS SessionFileError on read/parse/validate failure (THIS IS THE CORRUPTION SIGNAL).
    writeTasksJSON(sessionPath, backlog): Promise<Backlog>  — validates with BacklogSchema.parse then atomicWrite(resolve(sessionPath,'tasks.json')).
      THROWS SessionFileError on validation/write failure.
    atomicWrite(targetPath, data): Promise<void>  — temp-file + rename (crash-safe).
    GOTCHA: both take a SESSION DIRECTORY, not the tasks.json file path. tasksPath (the file) → sessionDir = dirname(tasksPath).
  section: "readTasksJSON(), writeTasksJSON(), atomicWrite()"

# MUST READ — the validation gate
- file: src/core/state-validator.ts
  why: |
    validateBacklogState(backlog): StateValidationResult  — returns { isValid: boolean, schemaErrors?, orphanedDependencies?,
      circularDependencies?, statusInconsistencies?, summary }. Use result.isValid as the secondary gate (after readTasksJSON succeeds).
    NOTE: validateBacklogState does NOT write; repairBacklog(backlog, validation, backupPath) mutates in place but does NOT write either.
    S2 does NOT need createBackup/repairBacklog — it reconstructs a clean backlog itself. Just import validateBacklogState.
    PATTERN TO MIRROR for readonly mutation: state-validator casts `(item as { dependencies: string[] }).dependencies = ...`.
    S2 casts `(item as { status: Status }).status = newStatus` the same way.
  section: "validateBacklogState(), repairOrphanedDependencies() (cast idiom)"

# MUST READ — the types + Status enum (NO 'Ready')
- file: src/core/models.ts
  why: |
    Status = 'Planned' | 'Researching' | 'Implementing' | 'Retrying' | 'Complete' | 'Failed' | 'Obsolete'. NO 'Ready'.
    Backlog / Phase / Milestone / Task / Subtask interfaces (all readonly). BacklogSchema (Zod) for parse/validate.
    Subtask requires context_scope matching the CONTRACT DEFINITION format (see test fixture). story_points 1..21. ID regexes per level.
  section: "Status, StatusEnum, Backlog, BacklogSchema, Phase/Milestone/Task/Subtask"
  gotcha: All fields readonly — mutation needs the cast idiom. structuredClone(base) first so the caller's object is untouched.

# MUST READ — the git primitives module (imports + exports surface from S1)
- file: src/tools/git-mcp.ts
  why: |
    After S1 lands, this exports gitFileHistory + gitReadFileAtCommit (+ GitFileHistoryEntry type). Import from '../tools/git-mcp.js'.
    These THROW on failure (NOT {success,error}) — distinct from the existing gitStatus/gitDiff/gitAdd/gitCommit.
    validateRepositoryPath (module-private) checks the repo has a .git dir — in the real-tmpdir test, a real `git init` satisfies it.
  section: "gitFileHistory(), gitReadFileAtCommit() (added by S1)"

# MUST READ — logger pattern
- file: src/utils/logger.ts
  why: getLogger('tasks-json-recovery') returns the structured logger. Use logger.error(...) in PATH C, logger.info(...) on a git restore,
       logger.warn(...) on degraded (no-baseline) clean path if desired. Match existing getLogger usage (see state-validator.ts top).
  section: "getLogger()"

# REFERENCE — R4 scope boundary + what S1/S2/S3 each own
- file: plan/005_d32a2ecf61cd/architecture/delta_impact.md
  why: R4 "What must change" item 2 = THIS subtask (smart-recovery routine: re-apply delta + git-history restore). Confirms S2 composes
       S1's primitives and is consumed by S3. Also confirms "Preserve items in Researching/Retrying status ... non-fatal + logged".
  section: "R4 — tasks.json Protection & Smart Recovery"

# REFERENCE — Status enum ground truth + path/refreshBacklog gotcha
- file: plan/005_d32a2ecf61cd/architecture/system_context.md
  why: "Status Enum" block confirms NO 'Ready'; research queue tracks readiness via its results Map. States S2 must preserve Researching/Retrying.
  section: "Status Enum (ground truth)"
- file: plan/005_d32a2ecf61cd/architecture/implementation_notes.md
  why: §5 (S1 primitives), §6 (refreshBacklog re-reads in-memory, NOT disk → S3 passes #backlog as baselineBacklog), §7 (same-commit TDD), §10 (validation gates).
  section: "§5, §6, §7, §10"

# REFERENCE — the Mode A doc target (ARCHITECTURE.md state-management section)
- file: docs/ARCHITECTURE.md
  why: "## State Management and Persistence" → "### State Persistence Patterns" (ends at the "Atomic Persistence" bullets, before the `---`
       at ~line 701). Insert the NEW "### tasks.json Protection & Smart Recovery" subsection AFTER "### State Persistence Patterns"
       and BEFORE that `---` separator. Mirror the section's prose+code-block style.
  section: "## State Management and Persistence → ### State Persistence Patterns (insert after)"

# REFERENCE — PRD source of truth
- file: PRD.md
  why: §5.1 "tasks.json Protection & Smart Recovery" — the exact behaviors (re-apply legitimate delta; recover from corruption via git
       history; preserve Researching/Ready [sic — Ready does not exist, treat as Researching]; non-fatal + logged). §9.3.2 mentions the restore.
  section: "§5.1 (tasks.json Protection & Smart Recovery block), §9.3.2"

# REFERENCE — test pattern (real tmpdir is fine; NO module-wide vi.mock here)
- file: tests/unit/core/session-utils.test.ts
  why: Shows the describe/it structure + path conventions used in tests/unit/core/. NOTE: that file mocks node:fs — S2's test file must NOT
       mock node:fs/node:fs-promises/simple-git (we want REAL git + REAL atomicWrite for honest recovery tests).
  section: "writeTasksJSON / readTasksJSON describe blocks"
```

### Current Codebase tree (relevant slice)

```bash
src/core/
├── state-validator.ts        # CONSUMED: validateBacklogState (+ cast-idiom pattern to mirror)
├── session-utils.ts          # CONSUMED: readTasksJSON, writeTasksJSON, atomicWrite
├── models.ts                 # CONSUMED: Status, Backlog, BacklogSchema (types)
├── task-orchestrator.ts      # NOT TOUCHED (S3 territory — wires recoverTasksJson in)
└── (no tasks-json-recovery.ts yet)   # <-- CREATE

src/tools/
└── git-mcp.ts                # CONSUMED (after S1): gitFileHistory, gitReadFileAtCommit   [S1 adds these]

src/utils/
└── logger.ts                 # CONSUMED: getLogger

src/config/
└── constants.ts              # NOT TOUCHED (R4 adds no env var)

tests/unit/core/
└── (no tasks-json-recovery.test.ts yet)   # <-- CREATE

docs/
└── ARCHITECTURE.md           # EDIT (Mode A): append subsection in State Management section
```

### Desired Codebase tree with files to be added/modified

```bash
src/core/
└── tasks-json-recovery.ts              # NEW: recoverTasksJson + TasksJsonRecoveryResult + RecoverTasksJsonOptions + setItemStatus (internal)

tests/unit/core/
└── tasks-json-recovery.test.ts         # NEW: real-tmpdir + real-git recovery tests (RED-first)

docs/
└── ARCHITECTURE.md                     # MODIFIED: + "### tasks.json Protection & Smart Recovery" subsection (Mode A)
```

> **File-placement decision**: New module per the contract's explicit name (`src/core/tasks-json-recovery.ts`), not an extension of `state-validator.ts` — keeps the validator focused and the recovery routine independently testable. New test file alongside the other `tests/unit/core/*.test.ts`. The ARCHITECTURE.md edit is Mode A (doc the subtask directly touches) per the contract's DOCS line.

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: readTasksJSON / writeTasksJSON take a SESSION DIRECTORY, not the tasks.json file path.
//   tasksPath (the file) → sessionDir = dirname(tasksPath) for read/write.
//   tasksPath → relPath = relative(repoPath ?? cwd, tasksPath) for gitFileHistory/gitReadFileAtCommit.
//   Mixing these up is the #1 likely bug — bridge them explicitly (see Implementation Patterns).

// CRITICAL: readTasksJSON THROWS SessionFileError on parse/schema failure — that throw IS the corruption signal.
//   Wrap in try/catch; the catch branch → PATH B (git history). Do NOT treat a throw as "terminate".

// CRITICAL: Status enum has NO 'Ready' (src/core/models.ts). Preserve 'Researching' and 'Retrying' across a restore.
//   The restore path preserves them automatically because setItemStatus mutates ONLY the target item.
//   NEVER add a 'Ready' status. NEVER reset a non-target item to 'Planned'.

// CRITICAL: recoverTasksJson MUST NEVER throw to the caller (S3). Wrap the ENTIRE body in one outer try/catch.
//   On ANY uncaught error → log + return PATH C result { restored:false, source:'disk', reason:'...' }. Leave state as-is.

// CRITICAL: S1's gitFileHistory/gitReadFileAtCommit THROW on failure (they do NOT return {success,error}).
//   They are consumed INSIDE the outer try/catch, so their throws become PATH C (non-fatal). Do not re-wrap them per-call.

// GOTCHA: To "discard unauthorized mutations" on the clean-disk path you NEED opts.baselineBacklog (the orchestrator's
//   pre-agent #backlog). Reconstruct from the baseline clone + legitimate delta; ignore disk statuses for non-target items.
//   Without a baseline, fall back to the disk backlog (degradation — documented in JSDoc).

// GOTCHA: All model fields are readonly. Mutate via the SAME cast idiom state-validator.ts uses:
//   (item as { status: Status }).status = newStatus. Always structuredClone(base) FIRST so the caller's object is untouched.

// GOTCHA: gitFileHistory returns [] for a file with no commit history (does NOT throw). An empty history → PATH C
//   (no valid version to restore) → non-fatal. Do NOT loop forever.

// GOTCHA: structuredClone is global in Node 20+ (this project requires Node 20+). Safe to use. JSON.parse(JSON.stringify(base))
//   is an equivalent fallback for this plain-data structure if ever needed.

// GOTCHA: The test file must NOT declare `vi.mock('simple-git')` or mock node:fs/node:fs-promises — we want REAL git + REAL
//   atomicWrite for honest recovery. Use simpleGit(dir) + git init + git add/commit to seed a real committed tasks.json,
//   then corrupt the on-disk file. node:fs/promises is NOT mocked → atomicWrite writes for real.

// GOTCHA: tsconfig.build.json EXCLUDES tests, so `npm run typecheck` does NOT typecheck tests. Test import paths need only be
//   RUNTIME-correct (vitest resolves them). Use the 3-level '../../../src/core/tasks-json-recovery.js' path (matches sibling tests).

// GOTCHA: ESM import specifiers use '.js' in '.ts' files (e.g. '../core/session-utils.js'). Match the existing convention.

// GOTCHA: vitest.config.ts sets coverage thresholds to 100% but coverage is enforced ONLY by `npm run test:coverage`, NOT by
//   `npm run test:run` or `npm run validate`. Coverage is NOT a gate for this subtask. Still cover all branches (A/B/C).

// GOTCHA: A Subtask's context_scope must match ContextScopeSchema (CONTRACT DEFINITION: + 4 numbered sections) or Zod rejects it.
//   The test fixture must use a valid context_scope (see Canonical Test Fixture). The RECOVERY routine does NOT re-validate
//   context_scope itself — but writeTasksJSON DOES (BacklogSchema.parse), so restored/seeded backlogs must be schema-valid.
```

## Implementation Blueprint

### Data models and structure

Three exported interfaces (one function signature). The `setItemStatus` helper is internal (not exported).

```typescript
// === src/core/tasks-json-recovery.ts — exported types ===

/**
 * Outcome of a tasks.json smart-recovery attempt (PRD §5.1).
 *
 * @remarks
 * Always returned (never thrown). `restored:true` means a git-history restore
 * occurred; `restored:false` means either the clean-disk re-apply path ran OR
 * recovery failed non-fatally (inspect `reason`).
 */
export interface TasksJsonRecoveryResult {
  /** true ONLY when a prior committed version was restored from git history. */
  readonly restored: boolean;
  /** 'disk' = clean-disk re-apply path; 'git' = restored from git history. */
  readonly source: 'disk' | 'git';
  /** Human-readable detail (commit hash, path taken, or failure cause). */
  readonly reason?: string;
}

/**
 * Options for {@link recoverTasksJson}.
 */
export interface RecoverTasksJsonOptions {
  /**
   * The orchestrator's pre-agent in-memory backlog snapshot. When provided and
   * the on-disk file is clean, recovery reconstructs from this baseline so
   * unauthorized agent mutations to unrelated items are discarded. When
   * omitted, recovery falls back to the disk-read backlog (degradation:
   * unrelated mutations cannot be detected without a baseline).
   */
  readonly baselineBacklog?: Backlog;
  /** Git repository root for the history primitives; defaults to process.cwd(). */
  readonly repoPath?: string;
}
```

### Implementation Patterns & Key Details

```typescript
// === src/core/tasks-json-recovery.ts — full module skeleton (canonical) ===

import { dirname, relative, resolve } from 'node:path';
import type { Backlog, Phase, Milestone, Task, Subtask, Status } from './models.js';
import { BacklogSchema } from './models.js';
import { readTasksJSON, writeTasksJSON } from './session-utils.js';
import { validateBacklogState } from './state-validator.js';
import { gitFileHistory, gitReadFileAtCommit } from '../tools/git-mcp.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger('tasks-json-recovery');

/**
 * Union of any hierarchy node (all have id + status).
 */
type AnyItem = Phase | Milestone | Task | Subtask;

/**
 * Recursively set the status of the item with `itemId` (mutates in place via
 * the established readonly-cast idiom; mirrors state-validator.ts repair fns).
 * Returns true if the item was found.
 *
 * @internal
 */
function setItemStatus(backlog: Backlog, itemId: string, status: Status): boolean {
  let found = false;
  const visit = (item: AnyItem): void => {
    if (item.id === itemId) {
      // readonly cast idiom (same as state-validator's dependency repair)
      (item as { status: Status }).status = status;
      found = true;
      return; // ids are unique; stop descending once found
    }
    if ('milestones' in item) item.milestones.forEach(visit);
    if ('tasks' in item) item.tasks.forEach(visit);
    if ('subtasks' in item) item.subtasks.forEach(visit);
  };
  backlog.backlog.forEach(visit);
  return found;
}

/**
 * Smart-recovery for tasks.json after an agent run (PRD §5.1).
 *
 * @remarks
 * Reconciles on-disk tasks.json after a Coder/agent run:
 *  - **Clean disk** (parses + validates): reconstructs from `opts.baselineBacklog`
 *    (preferred) or the disk backlog, applies ONLY `legitimateDelta`, and writes.
 *    Unauthorized agent mutations to unrelated items are discarded when a
 *    baseline is supplied.
 *  - **Corrupt disk** (parse/validate failure): walks git history (via the S1
 *    primitives), restores the LAST VALID committed version, re-applies
 *    `legitimateDelta`, and preserves items currently in `Researching` or
 *    `Retrying` status (they are carried forward from the restored version —
 *    never dropped to `Planned`). There is NO `Ready` status.
 *  - **Total failure**: logs and leaves state as-is. NEVER throws — a single
 *    corrupting agent must never terminate the session.
 *
 * @param tasksPath - Path to the tasks.json FILE (e.g. 'plan/005_.../tasks.json').
 * @param legitimateDelta - The item id + the status the orchestrator intends/just applied.
 * @param opts - Optional baseline backlog + git repo root.
 * @returns Always-resolved typed result (never throws).
 *
 * @example
 * ```ts
 * const result = await recoverTasksJson(
 *   'plan/005_d32a2ecf61cd/tasks.json',
 *   { itemId: 'P5.M1.T2.S4', status: 'Complete' },
 *   { baselineBacklog: orchestrator.backlog, repoPath: process.cwd() }
 * );
 * if (result.restored) logger.info(result.reason, 'tasks.json restored from git');
 * ```
 */
export async function recoverTasksJson(
  tasksPath: string,
  legitimateDelta: { itemId: string; status: Status },
  opts?: RecoverTasksJsonOptions
): Promise<TasksJsonRecoveryResult> {
  const sessionDir = dirname(resolve(tasksPath));
  const repoPath = opts?.repoPath ?? process.cwd();
  const relPath = relative(repoPath, resolve(tasksPath));

  // CRITICAL: outer non-fatal guard — recoverTasksJson NEVER throws to S3.
  try {
    // ---- PATH A: clean disk (parse + validate) ----
    let diskBacklog: Backlog | null = null;
    try {
      const candidate = await readTasksJSON(sessionDir); // throws on parse/schema fail
      if (validateBacklogState(candidate).isValid) diskBacklog = candidate;
    } catch {
      // corruption signal — fall through to PATH B
    }

    if (diskBacklog) {
      const base = opts?.baselineBacklog ?? diskBacklog; // baseline preferred → discards unauthorized mutations
      const reconstructed = structuredClone(base) as Backlog;
      setItemStatus(reconstructed, legitimateDelta.itemId, legitimateDelta.status);
      await writeTasksJSON(sessionDir, reconstructed);
      return { restored: false, source: 'disk', reason: 're-applied legitimate status delta' };
    }

    // ---- PATH B: corrupt disk → walk git history for the last valid version ----
    const history = await gitFileHistory(relPath, repoPath); // [] on no-history; throws on git error (→ PATH C)
    for (const entry of history) {
      const blob = await gitReadFileAtCommit(relPath, entry.commit, repoPath); // throws on error (→ PATH C)
      try {
        const parsed = JSON.parse(blob);
        const restored = BacklogSchema.parse(parsed) as Backlog; // schema-valid
        // prefer fully-valid; schema-valid alone is acceptable (deeper issues are rare post-restore)
        // Researching/Retrying items are preserved automatically (we mutate ONLY the target item below)
        const reconstructed = structuredClone(restored) as Backlog;
        setItemStatus(reconstructed, legitimateDelta.itemId, legitimateDelta.status);
        await writeTasksJSON(sessionDir, reconstructed);
        logger.info({ commit: entry.commit }, 'tasks.json restored from git history');
        return { restored: true, source: 'git', reason: `restored from commit ${entry.commit}` };
      } catch {
        // this commit's blob wasn't valid JSON / didn't validate — try the next older commit
        continue;
      }
    }

    // ---- PATH C: no valid version found in history ----
    logger.error({ relPath, historyLength: history.length }, 'tasks.json recovery failed: no valid version in git history');
    return { restored: false, source: 'disk', reason: 'recovery failed: no valid version in git history' };
  } catch (error) {
    // ---- PATH C: any uncaught error (git threw, write threw, etc.) — non-fatal ----
    logger.error({ tasksPath, err: (error as Error).message }, 'tasks.json recovery failed (non-fatal); leaving state as-is');
    return { restored: false, source: 'disk', reason: `recovery failed: ${(error as Error).message}` };
  }
}
```

### Implementation Tasks (ordered by dependencies — strict TDD: RED first)

```yaml
Task 1: STUB the failing tests (RED — before Task 2)
  Step 1a — tests/unit/core/tasks-json-recovery.test.ts: imports + real-tmpdir helpers + fixture
    - IMPORTS (top of file):
        import { describe, it, expect, beforeEach, afterEach } from 'vitest';
        import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
        import { tmpdir } from 'node:os';
        import { join } from 'node:path';
        import { simpleGit } from 'simple-git';
        import { recoverTasksJson } from '../../../src/core/tasks-json-recovery.js';
        import { readTasksJSON } from '../../../src/core/session-utils.js';
        import type { Backlog } from '../../../src/core/models.js';
    - ADD a `makeValidBacklog()` helper returning a minimal schema-valid Backlog (one Phase>Milestone>Task>2 Subtasks;
      Subtask context_scope MUST match ContextScopeSchema — see Canonical Test Fixture). Add status overrides per test.
    - ADD a `makeRepo()` helper: mkdtemp → simpleGit(dir).init() → addConfig user.email/name → returns {dir, git}.
    - ADD a helper to commit a backlog: write tasks.json (JSON.stringify), git.add('tasks.json'), git.commit(msg).
    - DO NOT declare any vi.mock (we want REAL git + REAL atomicWrite).
  Step 1b — tests/unit/core/tasks-json-recovery.test.ts: add the describe blocks (verbatim from Canonical Test Blocks).
    Cover: (A) clean disk → re-apply delta; (A) unauthorized unrelated-item mutation discarded (needs baseline);
    (B) truncated JSON → restore from git + re-apply delta; (B) preserved Researching survives restore; (C) total failure non-fatal.
  VERIFY RED: `npm run test:run -- tasks-json-recovery` → the it() cases FAIL (module/import missing). RED confirmed.

Task 2: IMPLEMENT the module in src/core/tasks-json-recovery.ts (makes Task 1 GREEN)
  Step 2a — create src/core/tasks-json-recovery.ts with the imports, TasksJsonRecoveryResult + RecoverTasksJsonOptions
    interfaces, the internal setItemStatus helper, and recoverTasksJson — all verbatim from "Implementation Patterns".
  Step 2b — GOTCHA checks before validating:
    - dirname/relative/resolve imported from 'node:path'; tasksPath resolved via resolve() before dirname/relative (handles relative paths).
    - readTasksJSON/writeTasksJSON take sessionDir (dirname), git primitives take relPath (relative). NOT swapped.
    - ENTIRE body wrapped in one outer try/catch → PATH C on any error. NEVER throws.
    - structuredClone(base) before setItemStatus (caller's object untouched). cast idiom for readonly status.
    - Researching/Retrying never reset (only target item mutated). NO 'Ready' anywhere.
  DO NOT touch: state-validator.ts, session-utils.ts, task-orchestrator.ts, models.ts, git-mcp.ts, constants.ts, any other test.

Task 3: ADD the Mode A ARCHITECTURE.md subsection
  - EDIT docs/ARCHITECTURE.md: insert "### tasks.json Protection & Smart Recovery" AFTER "### State Persistence Patterns"
    (which ends at the "Atomic Persistence" bullets) and BEFORE the `---` separator that precedes "## Task Hierarchy and Execution Flow".
    Content (prose + a small code block showing the recoverTasksJson call) per the Canonical Doc Block below. Mirror the section's style.

Task 4: VERIFY (validation gates — run after Tasks 2+3)
  - RUN: `npm run validate` (lint + prettier --check + tsc --noEmit) — expect zero errors.
      If prettier --check fails, run `npm run format` then re-run `npm run validate`.
  - RUN: `npm run test:run -- tasks-json-recovery` — expect GREEN (the new describe blocks).
  - RUN: `npm run test:run` (full suite) — expect all green (no regression; git-mcp tests still green via S1).
  - SCOPE-VERIFY: `git diff --stat` shows ONLY src/core/tasks-json-recovery.ts + tests/unit/core/tasks-json-recovery.test.ts + docs/ARCHITECTURE.md.
      `git diff src/core/state-validator.ts src/core/session-utils.ts src/core/task-orchestrator.ts src/core/models.ts src/tools/git-mcp.ts src/config/constants.ts`
      must be EMPTY.
  - NON-FATAL-VERIFY: `grep -n "throw" src/core/tasks-json-recovery.ts` → matches ONLY inside readTasksJSON/git/JSON.parse that are
      ALREADY wrapped in inner try/catch (PATH B). The OUTER function must have NO uncaught throw path (the final catch returns).
  - NO-READY-VERIFY: `grep -rn "Ready" src/core/tasks-json-recovery.ts` → NO matches (Researching/Retrying only).
```

### Canonical Test Fixture (add to the test file)

```typescript
// Minimal schema-valid Backlog. context_scope MUST match ContextScopeSchema.
function makeValidBacklog(overrides: {
  s1Status?: Status;
  s2Status?: Status;
} = {}): Backlog {
  const cs =
    'CONTRACT DEFINITION:\n1. RESEARCH NOTE: seed.\n2. INPUT: none.\n3. LOGIC: seed.\n4. OUTPUT: seed.';
  return {
    backlog: [
      {
        id: 'P1',
        type: 'Phase',
        title: 'Phase 1',
        status: 'Planned',
        description: 'seed phase',
        milestones: [
          {
            id: 'P1.M1',
            type: 'Milestone',
            title: 'Milestone 1',
            status: 'Planned',
            description: 'seed milestone',
            tasks: [
              {
                id: 'P1.M1.T1',
                type: 'Task',
                title: 'Task 1',
                status: 'Planned',
                description: 'seed task',
                subtasks: [
                  { id: 'P1.M1.T1.S1', type: 'Subtask', title: 'S1', status: overrides.s1Status ?? 'Planned', story_points: 1, dependencies: [], context_scope: cs },
                  { id: 'P1.M1.T1.S2', type: 'Subtask', title: 'S2', status: overrides.s2Status ?? 'Planned', story_points: 2, dependencies: ['P1.M1.T1.S1'], context_scope: cs },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as Backlog;
}

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'recovery-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@test.test');
  await git.addConfig('user.name', 'Test');
  return { dir, git };
}

async function commitBacklog(git: SimpleGit, dir: string, backlog: Backlog, msg: string) {
  await writeFile(join(dir, 'tasks.json'), JSON.stringify(backlog, null, 2));
  await git.add('tasks.json');
  await git.commit(msg);
}
```

### Canonical Test Blocks (add verbatim to tests/unit/core/tasks-json-recovery.test.ts)

```typescript
describe('core/tasks-json-recovery', () => {
  let dir: string;
  let git: SimpleGit;

  beforeEach(async () => {
    ({ dir, git } = await makeRepo());
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const tasksPath = () => join(dir, 'tasks.json');

  it('PATH A — clean disk: re-applies ONLY the legitimate status delta', async () => {
    const seed = makeValidBacklog({ s1Status: 'Implementing' });
    await commitBacklog(git, dir, seed, 'seed');

    // disk is clean (unchanged from seed) — recover with legitimate delta {S1 → Complete}
    const result = await recoverTasksJson(tasksPath(), { itemId: 'P1.M1.T1.S1', status: 'Complete' }, { repoPath: dir });

    expect(result).toEqual({ restored: false, source: 'disk', reason: 're-applied legitimate status delta' });
    const after = await readTasksJSON(dir);
    expect(findSubtask(after, 'P1.M1.T1.S1')!.status).toBe('Complete');
  });

  it('PATH A — discards an unauthorized agent mutation of an UNRELATED item (needs baseline)', async () => {
    const baseline = makeValidBacklog({ s1Status: 'Implementing', s2Status: 'Planned' }); // pre-agent snapshot
    await commitBacklog(git, dir, baseline, 'baseline');

    // agent mutated S2 (unrelated) to Complete on disk; S1 still Implementing. Disk still VALID.
    const mutated = makeValidBacklog({ s1Status: 'Implementing', s2Status: 'Complete' });
    await writeFile(join(dir, 'tasks.json'), JSON.stringify(mutated, null, 2));

    const result = await recoverTasksJson(
      tasksPath(),
      { itemId: 'P1.M1.T1.S1', status: 'Complete' },
      { baselineBacklog: baseline, repoPath: dir }
    );

    expect(result.source).toBe('disk');
    const after = await readTasksJSON(dir);
    expect(findSubtask(after, 'P1.M1.T1.S1')!.status).toBe('Complete'); // legitimate delta applied
    expect(findSubtask(after, 'P1.M1.T1.S2')!.status).toBe('Planned');  // unauthorized mutation DISCARDED (baseline value)
  });

  it('PATH B — truncated/invalid JSON: restores last valid version from git + re-applies delta', async () => {
    const seed = makeValidBacklog({ s1Status: 'Implementing' });
    await commitBacklog(git, dir, seed, 'seed valid');

    // corrupt on disk (truncated write)
    await writeFile(join(dir, 'tasks.json'), '{ "truncated');

    const result = await recoverTasksJson(tasksPath(), { itemId: 'P1.M1.T1.S1', status: 'Complete' }, { repoPath: dir });

    expect(result.restored).toBe(true);
    expect(result.source).toBe('git');
    expect(result.reason).toMatch(/restored from commit/);
    const after = await readTasksJSON(dir);
    expect(findSubtask(after, 'P1.M1.T1.S1')!.status).toBe('Complete'); // legitimate delta applied on top of restore
    // structure restored intact
    expect(after.backlog[0].milestones[0].tasks[0].subtasks).toHaveLength(2);
  });

  it('PATH B — preserves Researching status across a git restore', async () => {
    // committed version has S2 = Researching (background research in flight)
    const seed = makeValidBacklog({ s1Status: 'Implementing', s2Status: 'Researching' });
    await commitBacklog(git, dir, seed, 'seed with researching');

    // corrupt on disk
    await writeFile(join(dir, 'tasks.json'), 'NOT JSON {{{');

    const result = await recoverTasksJson(tasksPath(), { itemId: 'P1.M1.T1.S1', status: 'Complete' }, { repoPath: dir });

    expect(result.restored).toBe(true);
    const after = await readTasksJSON(dir);
    expect(findSubtask(after, 'P1.M1.T1.S1')!.status).toBe('Complete');    // legitimate delta
    expect(findSubtask(after, 'P1.M1.T1.S2')!.status).toBe('Researching'); // PRESERVED — not dropped to Planned
  });

  it('PATH C — total failure is non-fatal: leaves state as-is and returns a typed result (never throws)', async () => {
    // no committed history at all → gitFileHistory returns [] → no valid version → PATH C
    await writeFile(join(dir, 'tasks.json'), '{ "truncated'); // corrupt, never committed

    const result = await recoverTasksJson(tasksPath(), { itemId: 'P1.M1.T1.S1', status: 'Complete' }, { repoPath: dir });

    expect(result.restored).toBe(false);
    expect(result.source).toBe('disk');
    expect(result.reason).toMatch(/recovery failed/);
    // on-disk state untouched (still the truncated bytes)
    const raw = await readFile(join(dir, 'tasks.json'), 'utf-8');
    expect(raw).toBe('{ "truncated');
  });
});

// tiny test-local helpers (add above the describe or in the same file)
function findSubtask(backlog: Backlog, id: string) {
  for (const p of backlog.backlog) for (const m of p.milestones) for (const t of m.tasks)
    for (const s of t.subtasks) if (s.id === id) return s;
  return undefined;
}
```

### Canonical Doc Block (insert into docs/ARCHITECTURE.md, Mode A)

Insert as a new subsection immediately AFTER `### State Persistence Patterns` and BEFORE the `---` that precedes `## Task Hierarchy and Execution Flow`:

```markdown
### tasks.json Protection & Smart Recovery

Agents routinely corrupt `tasks.json` despite the forbidden-operations rules — truncated writes, partial edits, or schema-invalid mutations. The pipeline survives this without human intervention via **smart recovery** (PRD §5.1), invoked by the orchestrator after every agent run.

**Re-apply the legitimate delta.** After each agent invocation the orchestrator re-reads `tasks.json` from disk and re-applies **only** the legitimate status change from that run (the item just implemented or interrupted), discarding any other unauthorized mutations the agent made. Reconstruction is performed from the orchestrator's pre-agent in-memory backlog snapshot so unrelated status scribbles are dropped.

**Recover from corruption.** If `tasks.json` fails to parse or validate, the system walks git commit history (prior versions of the file), locates the last valid JSON, restores it, then re-applies any in-flight status changes on top.

**Preserve background-research status.** Items marked `Researching` or `Retrying` survive a restore — they are carried forward from the restored version and never dropped back to `Planned`. (There is no `Ready` status; readiness is tracked internally by the research queue.)

**Non-fatal.** A single corrupting agent never terminates the session. If no valid version can be recovered, the failure is logged and on-disk state is left as-is; recovery always returns a typed result for observability and never throws to the caller.

```typescript
import { recoverTasksJson } from './core/tasks-json-recovery.js';

// After each agent run, in the orchestrator:
const result = await recoverTasksJson(
  sessionTasksPath,
  { itemId: currentItem.id, status: 'Complete' },
  { baselineBacklog: this.backlog, repoPath: process.cwd() }
);
// result: { restored: boolean; source: 'disk' | 'git'; reason?: string }
```
```

### Integration Points

```yaml
SOURCE (the change):
  - new file: src/core/tasks-json-recovery.ts
      + import { dirname, relative, resolve } from 'node:path'
      + import types { Backlog, Status } + { BacklogSchema } from './models.js'
      + import { readTasksJSON, writeTasksJSON } from './session-utils.js'
      + import { validateBacklogState } from './state-validator.js'
      + import { gitFileHistory, gitReadFileAtCommit } from '../tools/git-mcp.js'   # S1
      + import { getLogger } from '../utils/logger.js'
      + export interface TasksJsonRecoveryResult { restored; source; reason? }
      + export interface RecoverTasksJsonOptions { baselineBacklog?; repoPath? }
      + internal setItemStatus(backlog, itemId, status)  # readonly-cast idiom
      + export async function recoverTasksJson(tasksPath, legitimateDelta, opts?): Promise<TasksJsonRecoveryResult>  # 3-path, non-fatal
  - new file: tests/unit/core/tasks-json-recovery.test.ts   # real tmpdir + real git; NO vi.mock
  - edit: docs/ARCHITECTURE.md   # + "### tasks.json Protection & Smart Recovery" subsection (Mode A)

NOT TOUCHED (scope guardrails):
  - src/core/state-validator.ts          # CONSUMED (validateBacklogState + cast-idiom pattern)
  - src/core/session-utils.ts            # CONSUMED (readTasksJSON, writeTasksJSON, atomicWrite)
  - src/core/task-orchestrator.ts        # S3 territory (wires recoverTasksJson in after each agent run)
  - src/core/models.ts                   # CONSUMED (Status, Backlog, BacklogSchema) — NO 'Ready' added
  - src/tools/git-mcp.ts                 # S1 territory (supplies gitFileHistory/gitReadFileAtCommit)
  - src/config/constants.ts              # R4 adds NO env var (routine takes opts, not env)
  - src/utils/git-commit.ts              # PROTECTED_FILES rules unchanged
  - README.md, docs/WORKFLOWS.md         # Mode B, deferred to P5.M3
  - tests/unit/tools/git-mcp.test.ts     # S1 territory
  - any other existing test file

PRODUCES (the contract S3 consumes):
  - recoverTasksJson(tasksPath, { itemId, status }, { baselineBacklog?, repoPath? }): Promise<TasksJsonRecoveryResult>
      ALWAYS resolves (never throws). S3 calls it after each agent run in executeSubtask, passing the orchestrator's
      pre-agent #backlog as baselineBacklog so unauthorized mutations are discarded.

CONSUMES:
  - readTasksJSON/writeTasksJSON (session-utils)   # session-dir based read/write
  - validateBacklogState (state-validator)         # isValid gate
  - BacklogSchema/Status/Backlog (models)          # parse + types
  - gitFileHistory/gitReadFileAtCommit (git-mcp, S1)  # history walk + blob fetch (THROW on failure → PATH C)
  - getLogger (utils/logger)                       # structured logging
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After Task 2 (module) + Task 3 (docs):
npm run validate
# = npm run lint && npm run format:check && npm run typecheck
#   lint      = eslint . --ext .ts
#   format:check = prettier --check "**/*.{ts,js,json,md,yml,yaml}"   (includes docs/ARCHITECTURE.md)
#   typecheck = tsc --noEmit -p tsconfig.build.json   (excludes tests/; only src/ is typechecked)
# Expected: zero errors. The new module is small + type-neutral.
# If prettier --check fails (common on the new .ts or the ARCHITECTURE.md edit), run:
npm run format        # WRITES the prettier-compliant form
npm run validate      # re-check; expect zero errors.
# Common failure: forgetting the '.js' suffix on a '../xxx.js' import, or swapping sessionDir/relPath.
```

### Level 2: Unit Tests (Component Validation)

```bash
# RED step (after Task 1, before Task 2) — MUST fail first (TDD):
npm run test:run -- tasks-json-recovery
# Expected: the new it() cases FAIL (module/import missing). RED confirmed.

# GREEN step (after Task 2):
npm run test:run -- tasks-json-recovery
# Expected: all green — 5 it() cases (2× PATH A, 2× PATH B, 1× PATH C) using a REAL tmpdir + REAL git repo.

# Full suite (confirm no regression elsewhere — esp. git-mcp tests via S1, state-validator, session-utils):
npm run test:run
# Expected: all green.
# NOTE: the real-git tests shell out to git; if a test environment has no git binary, this surfaces as PATH C
#       (non-fatal) inside the tests themselves — but CI/dev machines have git. If flaky, re-run.
```

### Level 3: Integration Testing (System Validation)

```bash
# Confirm the consumer (none today — S3 is Planned) will import cleanly: tsc on src/ covers the new export.
npm run typecheck
# Expected: zero errors (recoverTasksJson + the two interfaces are well-typed; S1 imports resolve once S1 lands).

# Scope-guard regression check — confirm we did NOT over-reach:
git diff --stat
# Expected: ONLY src/core/tasks-json-recovery.ts + tests/unit/core/tasks-json-recovery.test.ts + docs/ARCHITECTURE.md.

git diff src/core/state-validator.ts src/core/session-utils.ts src/core/task-orchestrator.ts src/core/models.ts src/tools/git-mcp.ts src/config/constants.ts src/utils/git-commit.ts
# Expected: EMPTY.

# ARCHITECTURE.md edit landed in the right place (inside State Management, after State Persistence Patterns):
grep -n "### tasks.json Protection & Smart Recovery" docs/ARCHITECTURE.md
# Expected: exactly 1 match, located BETWEEN "### State Persistence Patterns" and "## Task Hierarchy and Execution Flow".
```

### Level 4: Creative & Domain-Specific Validation

```bash
# NON-FATAL invariant — recoverTasksJson must NEVER throw to the caller:
grep -n "throw" src/core/tasks-json-recovery.ts
# Expected: throw sites ONLY inside the inner try/catch blocks of PATH B (JSON.parse/BacklogSchema.parse that are caught
#           per-commit) and inside consumed primitives (readTasksJSON/git* — wrapped by the OUTER try/catch).
#           The OUTER function's final statement MUST be a `return` (the catch), never a re-throw.

# NO-Ready invariant — Researching/Retrying only; no 'Ready' status introduced:
grep -rn "Ready" src/core/tasks-json-recovery.ts
# Expected: NO matches (only 'Researching'/'Retrying' in comments/JSDoc).

# Preserve-status invariant — setItemStatus mutates ONLY the target item:
grep -n "setItemStatus\|status: Status\|\.status = " src/core/tasks-json-recovery.ts
# Expected: setItemStatus defined + called exactly once per path (PATH A and PATH B); it mutates only item.id === itemId.

# Baseline-preferred invariant — PATH A uses baselineBacklog ?? diskBacklog:
grep -n "baselineBacklog" src/core/tasks-json-recovery.ts
# Expected: 1 match in the PATH A base-selection line (`opts?.baselineBacklog ?? diskBacklog`) + the interface field + JSDoc.

# Non-fatal test coverage — PATH C is actually exercised:
grep -n "PATH C\|non-fatal\|recovery failed" tests/unit/core/tasks-json-recovery.test.ts
# Expected: ≥1 match (the total-failure test asserts reason matches /recovery failed/ and on-disk state untouched).

# Docs Mode A present + markdown-lint clean (if run):
npm run docs:lint 2>/dev/null || true   # optional; markdownlint on docs/**/*.md — the new subsection must be lint-clean
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` passes (eslint + prettier --check + tsc --noEmit, zero errors).
- [ ] `npm run test:run` passes (all green; the 5 new `it` cases in `tasks-json-recovery.test.ts` + every existing assertion).
- [ ] RED step observed before GREEN (the new assertions failed before Task 2 — TDD).

### Feature Validation

- [ ] PATH A (clean disk): legitimate delta applied; on-disk `tasks.json` reconciled; returns `{ restored:false, source:'disk', ... }`.
- [ ] PATH A (baseline supplied): unauthorized agent mutation of an unrelated item is discarded (reconstructed from baseline).
- [ ] PATH B (corrupt disk): last valid version restored from git history; legitimate delta re-applied; returns `{ restored:true, source:'git', ... }`.
- [ ] PATH B: `Researching`/`Retrying` items are preserved across the restore (not dropped to `Planned`).
- [ ] PATH C (total failure): non-fatal — logs + returns `{ restored:false, source:'disk', reason:/recovery failed/ }`; on-disk state untouched; **never throws**.
- [ ] No `Ready` status introduced anywhere.

### Code Quality Validation

- [ ] Reuses `readTasksJSON`/`writeTasksJSON`/`validateBacklogState`/`BacklogSchema`/S1 git primitives — no duplicated parse/validate/git logic.
- [ ] Path bridging correct: `sessionDir = dirname(tasksPath)` for read/write; `relPath = relative(repoPath, tasksPath)` for git.
- [ ] `setItemStatus` mutates only the target item via the readonly-cast idiom (mirrors `state-validator.ts`); `structuredClone` before mutation.
- [ ] Follows existing module conventions (ESM `.js` imports, `getLogger`, async functions, full JSDoc).
- [ ] Scope guardrails respected (state-validator/session-utils/task-orchestrator/models/git-mcp/constants/git-commit untouched).

### Documentation & Deployment

- [ ] Full JSDoc on `recoverTasksJson` + `TasksJsonRecoveryResult` + `RecoverTasksJsonOptions` (Mode A).
- [ ] `docs/ARCHITECTURE.md` gains the `### tasks.json Protection & Smart Recovery` subsection in the State Management section.
- [ ] No new environment variables (R4 uses `opts`, not env) — no `.env`/`.env.example`/constants.ts change needed.

---

## Anti-Patterns to Avoid

- ❌ Don't make `recoverTasksJson` throw on failure — it MUST be non-fatal (PATH C logs + returns). A single corrupting agent must never terminate the session.
- ❌ Don't pass `tasksPath` directly to `readTasksJSON`/`writeTasksJSON` (they take the session **directory**) or to the git primitives without making it repo-**relative** — bridge the paths explicitly.
- ❌ Don't introduce or reference a `Ready` status — it does not exist in the enum. Preserve `Researching`/`Retrying` only.
- ❌ Don't reset non-target items to `Planned` on the restore path — mutate only the target item; Researching/Retrying survive automatically.
- ❌ Don't skip the baseline on PATH A if you want to discard unauthorized mutations — without `opts.baselineBacklog`, unrelated agent mutations can't be detected.
- ❌ Don't mock `simple-git` or `node:fs` in the recovery tests — use a REAL tmpdir + REAL `git init` for honest recovery verification (the contract's preferred approach).
- ❌ Don't touch `task-orchestrator.ts` (S3 territory), `git-mcp.ts` (S1 territory), or `constants.ts` (R4 adds no env var).
- ❌ Don't reimplement parse/validate/git logic — reuse `readTasksJSON` (parse+schema), `validateBacklogState`, and S1's `gitFileHistory`/`gitReadFileAtCommit`.
- ❌ Don't catch and swallow the outer error into silence — PATH C must `logger.error(...)` AND return a typed `reason`.
