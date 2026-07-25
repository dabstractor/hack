# P6.M1.T1.S2 — Verified Implementation Facts (for docs/ARCHITECTURE.md)

Source: direct codebase reads of `src/agents/agent-factory.ts`, `src/config/constants.ts`,
`src/config/environment.ts`, `src/core/task-orchestrator.ts`, `src/core/session-manager.ts`,
`src/core/file-lock.ts`, `src/core/session-utils.ts`, `src/utils/git-commit.ts`,
`src/agents/prp-executor.ts`, `src/workflows/validation-workflow.ts`,
`src/workflows/bug-hunt-workflow.ts`, `src/workflows/prp-pipeline.ts`,
`src/workflows/fix-cycle-workflow.ts`, `src/cli/index.ts`. All line numbers current as of
session 008.

---

## (a) Resolved-document invariant — PRD §2.3

- **Resolver**: `resolvePRD(prdPath)` — `src/core/session-utils.ts:564` (internal worker
  `resolveIncludesInternal` :416; helper `resolveIncludes` :366). Expands `@path/to/file.md`
  include directives.
- **Resolution rules**: a token expands only when (1) **boundary** — the `@` is at the start
  of a line OR preceded by a non-path char (`foo@bar.com` stays literal); AND (2)
  **existence** — the path resolves to an existing file. Resolved **project-root-relative**
  (relative to the entry PRD's directory). **Recursive with cycle detection** up to
  `PRD_INCLUDE_MAX_DEPTH` (default 10). **Idempotent** (re-resolving yields identical bytes).
- **Downstream threading (single canonical document)**: `session-utils.ts:279` hashes the
  *resolved* document; `snapshotPRD` (:1080) resolves before writing `prd_snapshot.md`;
  `createDeltaSession`/`findSessionByHash` key off the resolved hash; `prd-selector.ts`
  (mdsel index + `prd_selectors` extraction) runs over the materialized resolved copy
  (`prd_snapshot.md`). Hashing, delta detection, delta-PRD inputs, integration/validation/
  bug-finder prompts, and `prd_selectors` ALL operate over the fully-resolved document.
- **Env knobs**: `PRD_INCLUDE_MAX_DEPTH` (default 10), `PRD_INCLUDE_MARKERS` (emit
  `<!-- @include: path -->` / `<!-- @end-include -->` markers). A stale include warns on stderr.
- **Agent guidance**: agent prompts that embed PRD content state the text is the complete
  merged document (agents must not chase includes).
- **Current doc state**: ARCHITECTURE.md already has a brief `##### Resolved-document
  invariant` subsection under "1. Session Manager" (deferred to "P6"). This task supplies
  the **top-level capability framing** the doc currently lacks.

## (b) Three model roles + reasoning budget — PRD §9.2.3 / §6.1

- **`ROLE_CONFIG`** (`src/agents/agent-factory.ts`, ~lines 253-258) — single source of truth:
  - `research:      { tier: 'balanced' }`                         → normal reasoning budget (`thinking` omitted)
  - `reasoning:     { tier: 'balanced', thinking: 'xhigh' }`      → MAXIMUM reasoning budget
  - `implementation:{ tier: 'fast' }`                             → normal budget (`thinking` omitted)
- **Tiers** (`MODEL_NAMES`, `src/config/constants.ts:44-50`): `high = glm-5.2`,
  `balanced = glm-5.2`, `fast = glm-5-turbo`. Model strings are **provider-qualified**
  (`zai/glm-5.2`), **never harness-qualified**.
- **Env vars**: canonical `MODEL_ENV_VARS = {high:PRP_MODEL_HIGH, balanced:PRP_MODEL_BALANCED,
  fast:PRP_MODEL_FAST}` (:70-73); legacy `LEGACY_MODEL_ENV_VARS = {high:
  ANTHROPIC_DEFAULT_OPUS_MODEL, balanced: ANTHROPIC_DEFAULT_SONNET_MODEL, fast:
  ANTHROPIC_DEFAULT_HAIKU_MODEL}` (:92-95) — read ONLY when canonical unset, triggers a
  ONE-TIME deprecation warning (slated for future removal).
- **`getModel(tier)`** (`src/config/environment.ts`): canonical-first, then legacy w/ warning.
- **Tier rename**: opus→high, sonnet→balanced, haiku→fast. (DEFAULT values unchanged.)
- **Persona → role mapping** (confirmed from each factory body):
  | Persona   | Factory (agent-factory.ts) | Role          | Tier resolved | Reasoning budget | Purpose |
  |-----------|----------------------------|---------------|---------------|------------------|---------|
  | Architect | `createArchitectAgent` (:354) → `createBaseConfig('architect','reasoning')`     | Reasoning      | balanced (glm-5.2)   | **xhigh** | Task decomposition / breakdown |
  | Researcher| `createResearcherAgent` (:386) → `createBaseConfig('researcher','research')`    | Research       | balanced (glm-5.2)   | normal    | PRP creation / codebase research |
  | Coder     | `createCoderAgent` (:419) → `createBaseConfig('coder','implementation')`       | Implementation | fast (glm-5-turbo)   | normal    | PRP execution / post-validation fix |
  | QA        | `createQAAgent` (:453) → `createBaseConfig('qa','reasoning')`                   | Reasoning      | balanced (glm-5.2)   | **xhigh** | Validation + bug-finder (`BUG_FINDER_AGENT`/`VALIDATION_AGENT`, default `pizr`) |
  | Cleanup   | `createCleanupAgent` (:506) → `createBaseConfig('cleanup','implementation')`   | Implementation | fast (glm-5-turbo)   | normal    | Post-validation doc reorg (stateless single-shot) |
- **`ThinkingLevel`** type (`agent-factory.ts:123`): `'off'|'low'|'medium'|'high'|'xhigh'|'max'`.
  Rides on the config object for downstream harness wiring; Groundswell `AgentConfig` does not
  model thinking natively.
- **Reasoning-role realizations**: `VALIDATION_AGENT` (default `pizr`, constants.ts:704/720),
  `BUG_FINDER_AGENT` (default `pizr`, :843/859) — both = the `qa` persona (balanced @ xhigh).
- **bash-identifier equivalence (PRD §9.2.3, for cross-ref only)**: research = `pi`,
  reasoning = `pizr` (`pi --thinking xhigh`), implementation = `piznt`.

## (c) Two-phase commit + integrity protections — PRD §4.2 step 4 / §5.1

### Two-phase commit (`src/core/task-orchestrator.ts`, `executeSubtask`, ~:1056-1124)
1. **Pre-cleanup survival commit** (:1061 `smartCommit(...)`): runs BEFORE the long/interruptible
   cleanup agent. Persists the item's substance — source changes + its `plan/` work directory +
   `Complete` status — so a force-interrupt during cleanup can no longer leave an item
   "Complete on disk but uncommitted" (the state that orphans `plan/` dirs forever; cleanup is
   forbidden from touching `plan/`).
2. **Cleanup** (:1077-1090 `this.#cleanupRunner({...})`): best-effort, isolated, NEVER fatal.
   Removes temp artifacts, moves docs to `docs/`, leaves `tasks.json` intact.
3. **Post-cleanup commit** (:1113 `smartCommit(..., 'cleanup: doc reorganization', ...)`): runs
   ONLY when cleanup succeeded; commits the doc reorganization.

### stagecoach commit-message generation (`src/agents/commit-message-agent.ts`)
`smartCommit` (`src/utils/git-commit.ts`) delegates commit-message authorship to an LLM
(stagecoach) with **bounded retry + exponential backoff** and a **last-resort placeholder**
fallback (honors smartCommit's never-fail-on-commit contract).

### flock mutex on tasks.json RMW (`src/core/file-lock.ts`, PRD §5.1)
Process-level mutual-exclusion serializing every read-modify-write of `tasks.json`. Two layers:
(1) **in-process async mutex + re-entrancy** (Map keyed by session dir — safe under recursion);
(2) **O_EXCL lockfile** `<sessionDir>/tasks.json.lock` (cross-process). Accessor:
**`withLockedTasksJSON(sessionDir, fn)`**. Invoked from: `session-manager.ts:917` (saveBacklog —
the per-item delta-merge write) and `tasks-json-recovery.ts:283` + `:357`.

### restore_critical_files (`src/utils/git-commit.ts:288`, called from smartCommit :468/:469)
**Mechanical** critical-file deletion protection (the backstop to the prompt layer,
P3.M2.T4.S1). Runs AFTER staging, BEFORE commit. Detects staged **deletions** via
`git diff --cached --diff-filter=D`. Protected basenames: **`PRD.md`** and **`PRP.md`**
(covers root `PRD.md` + every nested `PRP.md`). Strategy: if file exists in HEAD →
`git checkout HEAD -- <path>` (restores working tree + clears staged deletion); else
`git reset HEAD -- <path>` (unstages). **Non-fatal/best-effort** — per-path failures logged,
smartCommit always proceeds.

### tasks.json smart recovery (`src/core/tasks-json-recovery.ts`) — ALREADY documented
Re-apply legitimate status delta after every agent run; restore last valid version from git
history on parse/validation failure; preserve `Researching`/`Retrying` statuses across restore.
(ARCHITECTURE.md §"tasks.json Protection & Smart Recovery" is accurate — confirm it stays in
sync; note it says "There is no Ready status" which matches the code.)

### Orphaned-`plan/` recovery / skip-recovery (`src/core/task-orchestrator.ts:1287`, :781)
PRD §5.1 "Orphaned-`plan/` Recovery → Skip-recovery": before skipping an item, the orchestrator
checks **HEAD's** `tasks.json` for the item's Completed status. If the working tree shows
Complete but HEAD disagrees (= stranded `plan/`), it runs `smartCommit` to persist the stranded
state before skipping (:799-803 "Completed in working tree but not in HEAD — stranded plan/
detected; running recovery commit"). Unreadable HEAD tasks.json is treated as stranded
(non-fatal, :1330).

### Watchdog kills are terminal (PRD §9.3.2)
A watchdog kill = EITHER `result.timedOut === true` (Node watchdog) OR `result.exitCode === 124`
(`timeout` coreutil). BOTH are **terminal/hard-failure** — the fix-and-retry loop aborts WITHOUT
retrying (`prp-executor.ts:386-394`; `validation-workflow.ts:22-29`; `isWatchdogKillResult`).
A watchdog-killed validation aborts the run BEFORE bug-hunt and is not retried (a hung process
re-hangs on retry).

### NO_ISSUES_FOUND.md marker (`src/workflows/bug-hunt-workflow.ts:480-594`)
Clean bug hunt (no critical/major/minor) → write `NO_ISSUES_FOUND.md` + commit (:505). Bugs
found → remove a stale marker (:594). Distinguishes "already hunted (clean)" from "never
hunted" (PRD §4.4).

## (d) Adopt mode — PRD §4.6 (`--adopt-prd`)
- **CLI flag**: `--adopt-prd` (`src/cli/index.ts:324`) → `args.adoptPrd` → `PRPPipeline` (`src/index.ts:256`).
- **State**: `PRPPipeline.adoptPrd` (`src/workflows/prp-pipeline.ts:203`), `skipExecutionLoop` (:212).
- **Guard rails** (prp-pipeline.ts:659-698):
  - **Requires the PRD to exist** — missing PRD exits loudly (never scribbles session files near filesystem root).
  - **Fresh-project only** — if sessions already exist, it's a no-op (warn + proceed with normal session resolution, :667-671).
  - **Rejects empty `SESSION_DIR`** + `mkdir -p "$PLAN_DIR"` first.
- **`seedAdoptedBaseline()`** (`src/core/session-manager.ts:~841`):
  - Writes the **`.adopted`** marker (`:864`).
  - Seeds a single completed baseline `tasks.json` — one Phase → Milestone → Task → "Adopt
    existing codebase" Subtask, ALL `Complete` — via `createAdoptedBaseline()` +
    `writeTasksJSON` (BacklogSchema.parse + atomicWrite). **No breakdown, no agent tokens** →
    `is_session_complete` is true → this becomes the idempotent baseline future deltas diff
    against.
  - Updates the in-memory task registry so `decomposePRD()` auto-skips the Architect (zero tokens).
- **`skipExecutionLoop = true`** (:698) → `executeBacklog()` skipped (:1258).
- **Validation + bug-hunt STILL run** (PRD §4.6; :1260 log "Skipping execution loop (adopt
  mode / SKIP_EXECUTION_LOOP); validation + bug-hunt still run"). Next `PRD.md` edit produces a
  normal delta session against the adopted baseline.

## (e) Stale-reference sweep (CONFIRMED)
Greps on the current `docs/ARCHITECTURE.md`:
- `single-slot|single slot` → **none**
- `simplified bug-fix|simplified bug` → **none**
- `opus|sonnet|haiku|ANTHROPIC_DEFAULT` → **none**

So NONE of the stale framing exists today. Requirement (e) = grep-verify absence + ensure the
new content introduces none (use high/balanced/fast + canonical names). The only tier-ish terms
in the doc today are `glm-5.2` (correct) and `zai/glm-5.2` (correct). No `ANTHROPIC_DEFAULT_*`.

## Validation gates (docs/ARCHITECTURE.md)
- `npx prettier --check docs/ARCHITECTURE.md` — format:check scope is `**/*.md`; NOT in `.prettierignore`. **HARD gate.**
- `npm run docs:lint` (= `markdownlint "docs/**/*.md"`) — `.markdownlintignore` excludes only `docs/api/`, so ARCHITECTURE.md IS linted. **Currently PASSES clean** (verified). Config: `default:true, MD013:false, MD024:{siblings_only:true}, MD036:false`. ⇒ Keep MD040-safe (every new fenced block needs a language tag: ```mermaid/```typescript/```text/```json), no MD024 dup headings within siblings.
- `npm run validate` — full suite (lint && format:check && typecheck && test:run); format:check is the step covering this doc.
- `git diff --name-only` = exactly `docs/ARCHITECTURE.md` (+ this PRP's `plan/` artifacts).

## Current ARCHITECTURE.md structure (headings) — for precise placement
```
# Architecture Overview
## System Overview
   ### Design Philosophy / ### High-Level Architecture / ### System Flow Description
## Four Core Processing Engines
   ### 1. Session Manager          (has brief "##### Resolved-document invariant")
   ### 2. Task Orchestrator
   ### 3. Agent Runtime            (has "#### Agent Types" table — needs role/tier/budget columns)
   ### 4. Pipeline Controller
## Groundswell Framework Integration
## Multi-Agent Architecture
## State Management and Persistence
   ### tasks.json Protection & Smart Recovery   (accurate; keep)
## Task Hierarchy and Execution Flow
## See Also
```

## Placement plan for the four new behaviors
- **(a) Resolved-document invariant** → NEW top-level `## Resolved-Document Invariant (Distributed PRDs)` section after `## System Overview` (full capability framing); trim the brief Session-Manager subsection to a one-line cross-reference to avoid duplication.
- **(b) Three model roles + reasoning budget** → NEW top-level `## Model Roles & Reasoning Budget` section (after Multi-Agent Architecture); ALSO refresh the `#### Agent Types` table in §3 Agent Runtime to add Role / Tier / Reasoning-budget columns.
- **(c) Two-phase commit + integrity protections** → NEW `### Two-Phase Commit (Per-Item Survival)` + `### State Integrity Protections` subsections under `## State Management and Persistence` (adjacent to the existing tasks.json-recovery subsection), covering: two-phase commit, flock mutex, restore_critical_files, orphaned-plan recovery, watchdog kills terminal, NO_ISSUES_FOUND marker.
- **(d) Adopt mode** → NEW top-level `## Adopt Mode (--adopt-prd)` section (after Task Hierarchy / before See Also).
- **(e) Stale sweep** → grep-verify (none found); ensure new text uses high/balanced/fast + canonical env-var names.
- Update `## Table of Contents` to list the four new sections.