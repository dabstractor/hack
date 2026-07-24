# Product Requirements Document: Autonomous PRP Development Pipeline

## 1. Executive Summary

The **PRP (Product Requirement Prompt) Pipeline** is an agentic software development system designed to convert a high-level Product Requirements Document (PRD) into a fully implemented, tested, and polished codebase with minimal human intervention.

Unlike standard "coding agents" that drift and lose context, this pipeline uses a **structured, phase-based architecture**. It breaks large projects into atomic units, generates highly context-aware "Product Requirement Prompts" (PRPs) for every single task, and enforces rigorous validation loops. It features self-healing capabilities through iterative bug hunting and handles changing requirements via "Delta Sessions."

## 2. Core Philosophy & Concepts

### 2.1 The "PRP" Concept

The central thesis is that AI fails at complex coding tasks due to context dilution. A **PRP** is a focused, information-dense "micro-PRD" for a single task that includes:

- The specific goal.
- Curated context (file paths, specific code snippets).
- Implementation strategy.
- Validation gates (syntax, unit test, integration, manual).
- "No Prior Knowledge" guarantee: An agent should need _only_ the PRP to succeed.

### 2.2 The Session Model

The system creates an immutable audit trail of development.

- **Session:** A directory containing the state of a specific run (tasks, architecture notes, code).
- **Delta Logic:** If the master PRD changes, the system does not overwrite the current session. It creates a linked **Delta Session** that focuses only on the differences (new/modified features) while preserving completed work.

### 2.3 Distributed (Multi-File) PRDs

A PRD of any real size may be authored across multiple files (architecture, API, data model, companion docs) and assembled into one canonical document at load time. A split PRD MUST behave identically to a monolithic one everywhere downstream.

- **Include directive:** An `@path/to/file.md` token is an _include directive_ — it is replaced inline by the referenced file's contents. A line of the form `@path/to/file.md` (optional leading whitespace, nothing else) is always expanded; the `@path` token is also honored inline anywhere on a line (e.g. inside a markdown table cell or in prose).
- **Expansion rules:** A token expands only when _both_ (1) **boundary** — the `@` is at the start of the line or preceded by a non-path character (so `foo@bar.com` and mid-word `@` are left literal), and (2) **existence** — the path resolves to an existing file. Ordinary prose `@mentions` that don't resolve stay verbatim and silent. Includes resolve **project-root-relative** (relative to the entry PRD's directory, regardless of which file contains the directive) and are expanded **recursively with cycle detection** up to `PRD_INCLUDE_MAX_DEPTH` (default 10).
- **Idempotency:** Re-resolving already-resolved content MUST yield identical bytes. This is the property that guarantees hash/snapshot consistency.
- **Single canonical document downstream:** Hashing (§4.1 step 2; §4.3 delta detection), `prd_snapshot.md` writes, delta-PRD inputs, integration/validation/bug-finder prompts, and `prd_selectors`/mdsel section indexing (§4.2) all operate over the **fully-resolved, include-expanded document**, never the raw entry file. mdsel runs over a materialized resolved copy so selectors reference the merged document.
- **Agent guidance:** Agent prompts that embed PRD content MUST state that the text they receive is already the complete merged document (agents must not chase includes themselves).
- **Markers (optional):** When `PRD_INCLUDE_MARKERS` is set, resolved output emits `<!-- @include: path -->` / `<!-- @end-include -->` comment markers. A `.md` token that fails to resolve (stale include) MUST emit a stderr warning.

## 3. System Architecture

The new system must implement four distinct processing engines:

1.  **Session Manager:** Handles state, directory structures (`plan/001_hash`), and PRD diffing.
2.  **Task Orchestrator:** Manages the JSON backlog, dependency resolution, and status updates (replacing the `tsk` CLI).
3.  **Agent Runtime:** Drives the agent loop through a pluggable **harness** (default `pi` / pi.dev; `claude-code` optional) that is orthogonal to the LLM provider, to run specific personas (Architect, Researcher, Coder, QA). See §9.4.
4.  **Pipeline Controller:** The main loop handling the sequence of operations, parallelization, and error recovery.

## 4. User Workflows

### 4.1 Initialization & Breakdown

1.  **Input:** User provides a `PRD.md`.
2.  **State Check:** System hashes the PRD — computed over the **fully-resolved, include-expanded document** (§2.3), not the raw entry file — and checks for existing sessions.
3.  **Architecture Research:** Before planning, an agent explores the codebase to validate feasibility and store findings in `architecture/`.
4.  **Decomposition:** The **Architect Agent** breaks the PRD down into a strict hierarchy (Phase > Milestone > Task > Subtask) stored in a structured format (e.g., JSON).

### 4.2 The Execution Loop (The "Inner Loop")

For every item in the backlog (iterating Phase -> Milestone -> Task -> Subtask):

1.  **Parallel Research (Optional):** While Task $N$ is implementing, a background supervisor researches a **chain** of up to `RESEARCH_DEPTH` (default 2) items ahead, rather than a single item. This collapses both failure modes of a single-slot prefetch: "fast implementer → stall waiting for $N+1$" and "slow implementer → wasted idle capacity." The supervisor keeps prefetching the next item in the chain while the orchestrator consumes completed PRPs one at a time.
    - **Deadline & Fallback:** Each background research is guarded by a configurable deadline (`RESEARCH_TIMEOUT`, default 30 minutes / 1800s; see §9.2.2). The orchestrator polls for completion — checking process liveness and the presence of the PRP artifact — rather than blocking indefinitely, and tolerates legitimately long research (a heartbeat surfaces only after a grace period, so normal research isn't spammed) while still failing fast on a genuinely stuck supervisor. If the deadline is exceeded (typically because the agent crashed or stopped responding), the background work is abandoned and the item is re-researched synchronously, inline. This prevents a single hung agent from stalling the whole pipeline.
    - **Propagation to Bugfix Sub-Pipeline:** When bug hunting finds bugs and spawns a bugfix sub-pipeline (§4.4), the parallel-research settings (`PARALLEL_RESEARCH` and `RESEARCH_DEPTH`) MUST be forwarded to the child. The main session's items are already Complete by then, so all real item execution — and therefore all prefetching — happens inside the bugfix child; without forwarding, prefetch is silently disabled for the entire phase that needs it.
2.  **PRP Generation:**
    - The **Researcher Agent** analyzes the task, the codebase, and external docs.
    - Produces a `PRP.md` file containing the "contract" for the implementation.
    - **Selective PRD Section Extraction:** Each subtask carries a `prd_selectors` field (e.g. `["h2.1", "h3.0"]`) computed from a generated PRD section index. The Researcher receives only the referenced PRD sections instead of the full PRD document, keeping its context window focused on the relevant requirements. When selectors are absent or extraction fails, the full PRD is used as a fallback.
3.  **Implementation:**
    - The **Coder Agent** reads the `PRP.md`.
    - Executes the plan.
    - Must pass 4 levels of "Progressive Validation" defined in the PRP.
4.  **Cleanup & Commit (two-phase commit):**
    - **Pre-cleanup commit (survival):** Before the (long, interruptible) cleanup agent runs, the orchestrator commits the item's substance — source changes, its `plan/` work directory, and its `Complete` status — via the **Smart Commit** tool (`stagecoach`). Committing before cleanup guarantees a force-interrupt here can no longer leave an item "Complete on disk but uncommitted," the state that orphans `plan/` directories forever (the cleanup agent is forbidden from touching `plan/`; see §5.1).
    - **Cleanup:** Temporary artifacts are removed; documentation is moved to `docs/`.
    - **State is saved:** `tasks.json` updated.
    - **Post-cleanup commit:** The cleanup agent's documentation reorganization is committed in a second `stagecoach` call.

### 4.3 The "Delta" Workflow (Change Management)

If the user modifies `PRD.md` mid-project:

1.  **Detection:** System detects hash mismatch (computed from `prd_snapshot.md` content).
    - **Change Classification:** Detected changes are classified by an LLM-driven binary classifier as **COSMETIC** (trivial: whitespace/formatting) or **SUBSTANTIVE** (semantically significant). A parallel **CLEAN/DIRTY** classifier guards generated artifacts (e.g., the delta PRD). These classifiers MUST distinguish **transient API failures** (empty output, connection errors, rate limits, overloaded) from invalid model responses, retrying up to a bounded count (default 4) before giving up. On exhaustion they MUST fail to the **protective/conservative default** (treat as SUBSTANTIVE / DIRTY) — never silently fall through to "could not classify" and proceed unprotected through a SUBSTANTIVE change.
2.  **Response Selection (mid-session changes):** When a change is detected on an active session, the user selects how to handle it:
    - **Delta session** (default path, steps 3–7 below): spawn a linked session scoped to the diffs.
    - **Integrate into current session:** fold the new requirements into the running session's task hierarchy. **The original `prd_snapshot.md` MUST be preserved until _after_ integration succeeds** — the integration agent diffs the original snapshot against the current PRD, and PRD-change detection itself hashes `prd_snapshot.md` as its baseline. Refreshing the snapshot at integration time erases the very diff the agent needs (and silently swallows unapplied changes); the snapshot is refreshed only once integration has applied.
    - **`--accept-prd-changes`:** accept PRD edits as the new baseline _without_ generating a delta session. Use when `PRD.md` was edited (docs/refinements reflecting already-finished work) but the work is complete and validated, so the next run should stay idempotent instead of spawning a delta. Across all `PRD_CHANGED_*` session states it cancels any queued `.pending_delta_hash`, refreshes `prd_snapshot.md` to the current PRD, and exits/resumes idempotently.
    - **Validate/bug-hunt re-runs reuse the completed session:** When invoked in validate-only (`--validate`) or bug-hunt-only (`--bug-hunt`) mode against an already-completed session that has a pending PRD change, the system MUST **reuse the latest completed session** instead of forking an empty delta session — an empty delta has no `tasks.json` and would make the validate/bug-hunt gates bail with "no tasks to act on." The PRD change is intentionally left pending (not actioned) so the _next normal_ run (without `--validate`) still processes it into a proper delta session. This keeps one-off re-runs idempotent while preserving the queued change.
3.  **Delta Session:** Creates a new session directory linked to the previous one via `delta_from.txt`.
4.  **Delta Analysis:** An agent compares Old PRD vs. New PRD.
5.  **Delta PRD Generation (with retry logic):**
    - Agent generates `delta_prd.md` focusing only on differences.
    - If delta PRD not created on first attempt, system demands agent retry.
    - Session fails fast if delta PRD cannot be generated after retry.
    - Incomplete delta sessions detect and regenerate missing delta PRDs on resume.
    - **Breakdown MUST consume the delta PRD:** The task breakdown/decomposition for a delta session MUST run over `delta_prd.md` (the diffs), _not_ the full PRD. Implementations that build the breakdown prompt once at load time risk embedding the full PRD and silently ignoring the delta; the breakdown input MUST be (re)bound to the delta content _after_ `delta_prd.md` is generated.
6.  **Task Patching:**
    - Identifies new requirements -> Adds new tasks.
    - Identifies modified requirements -> Marks affected existing tasks for "Update/Re-implementation".
    - Identifies removed requirements -> Marks tasks as "Obsolete".
    - Phase indexing searches for matching IDs (handles non-sequential phase IDs in delta sessions).
7.  **Resume:** The pipeline continues execution using the updated backlog.

### 4.4 The QA & Bug Hunt Loop

Once all tasks are complete, or if run in `bug-hunt` mode:

1.  **Validation Scripting:** An agent generates a custom `validate.sh` based on the PRD requirements and codebase tools, then runs it. Validation runs on a dedicated **`VALIDATION_AGENT`** (a reasoning-tier agent, default `pizr`; see §9.2.3) under its own watchdog budget **`VALIDATION_TIMEOUT`** (default 7200s / 2h — validation legitimately runs full test suites), overriding the generic agent timeout for this call only.
    - **Abort-on-failure:** If validation does not finish (non-zero exit), the run MUST abort _before_ cleanup, commit, and bug-hunt. Proceeding on a half-validated build is forbidden. (A watchdog-killed validation is a hard failure, never retried — see §9.3.2.)
2.  **Creative Bug Hunt:** The **QA Agent** (Adversarial Persona, reasoning-tier `pizr`) creates a `TEST_RESULTS.md` report. It looks for logic gaps, not just failing tests.
    - **No-issues marker:** When the bug finder reports _no_ bugs, the bugfix directory MUST record a `NO_ISSUES_FOUND.md` marker (timestamp, session tested, a `tasks.json` hash so a stale marker is obvious once the task set changes, and the bug-finder agent). This distinguishes "already hunted clean" from "never hunted." The marker is removed if a later hunt _does_ find bugs, so the directory always reflects the latest result; a clean result is persisted (committed) just like a real bug report.
3.  **The Fix Cycle (Self-Contained Sessions):**
    - If critical/major bugs are found, a self-contained "Bug Fix" sub-pipeline starts.
    - Each bug hunt iteration creates a new numbered session: `bugfix/001_hash/`, `bugfix/002_hash/`, etc.
    - Bug reports (`TEST_RESULTS.md`) and tasks are stored within the bugfix session directory.
    - It treats the `TEST_RESULTS.md` as a mini-PRD and runs the **standard full task breakdown** (the same Phase→Milestone→Task→Subtask decomposition as a main session) — there is no separate "simplified" bug-fix breakdown mode; cleanup runs for bug-fix sessions just as for main sessions.
    - It loops (Fix -> Re-test) until the QA Agent reports no issues.
    - **Resume interrupted breakdowns:** If a recursive bug-fix run is killed _between_ committing the bug report and finishing task breakdown, the bugfix session is left with a `TEST_RESULTS.md` but no `tasks.json`. The pipeline MUST auto-detect this (report present, `tasks.json` missing/empty/corrupt) and re-enter on the same path the bug-hunt stage uses when it first finds bugs, so PHASE 0 regenerates the missing `tasks.json`. This check is skipped in `--validate`/`--skip-bug-finding` and suppressed inside bug-fix children (no re-entry loop).
4.  **Interactive Prompts:**
    - User is prompted before starting a new bug hunt on a completed session.
    - User is prompted before resuming an incomplete bug fix cycle, with option to archive and start fresh.
5.  **Artifact Preservation:**
    - Bug fix artifacts are archived (not deleted) for audit trail and debugging history.
    - Session structure: `plan/NNN_hash/bugfix/NNN_hash/` contains `tasks.json`, `TEST_RESULTS.md`, and (on a clean hunt) `NO_ISSUES_FOUND.md`.

### 4.5 The Issue-Driven Re-planning Loop

The Coder Agent reports one of three outcomes per item: `success`, `fail`, or `issue`. An `issue` signals a _recoverable planning gap_ — the PRP was insufficient (missing context, wrong assumptions, ambiguous requirements) but the work itself is still valid. This is deliberately distinct from a hard `fail`, which indicates an implementation problem handled by the existing fix-and-retry path.

When an agent reports `issue`:

1.  **Capture Feedback:** The issue message is saved to `issue_feedback.md` in the session directory.
2.  **Invalidate Stale Plan:** The offending PRP is deleted so it cannot be reused.
3.  **Reset State:** The item is reset to `Planned` (not `Failed`).
4.  **Re-research with Feedback:** Research runs again, with `<issue_feedback>` injected into the PRP-generation prompt so the new PRP directly addresses the reported gap.
5.  **Bound the Loop:** Re-planning retries up to `ISSUE_RETRY_MAX` (default 3; see §9.2.2) times before the item hard-fails.

**Rationale:** Without this channel, every PRP gap becomes a permanent dead item that forces human intervention. The `issue` result turns planning gaps into self-correcting retries, while real implementation failures stay on the fix-and-retry path.

**Status interaction:** An item undergoing re-planning keeps its original ID and dependency links; only its PRP and status are reset. Background research on its dependents is not cancelled, but those dependents cannot proceed until the re-planned item completes.

### 4.6 Adopt Mode (`--adopt-prd`): Legacy Codebase Adoption

To integrate the pipeline into an _already-implemented_ project after writing the PRD — without wasting a full breakdown + implementation pass "building" code that already exists — `--adopt-prd` declares the PRD the source of truth for an already-shipped codebase. On a **fresh project** (no `plan/` sessions yet) it:

1. Creates a baseline session and stamps it with an `.adopted` marker.
2. Seeds a single completed `tasks.json` (one Phase → Milestone → Task → "Adopt existing codebase" Subtask, all `Complete`) **with no breakdown and no agent tokens**, so `is_session_complete` is true and this session becomes the idempotent baseline that future deltas diff against.
3. Sets `SKIP_EXECUTION_LOOP=true`: implementation is skipped, but **validation + bug hunt still run** against the real codebase + PRD.

The next `PRD.md` edit produces a normal delta session, so deltas drive ongoing development from the adopted baseline.

**Guard rails:**

- `--adopt-prd` **requires** the PRD to exist; a missing PRD MUST exit loudly rather than scribbling session files near the filesystem root.
- It applies **only to fresh projects**; if sessions already exist the flag is a no-op misuse (warn and proceed with normal session resolution).
- A hard guard MUST reject an empty `SESSION_DIR` before breakdown/validation so collapsed root paths can never be written, and session creation MUST `mkdir -p "$PLAN_DIR"` first so the session path is always nested under it.

## 5. Functional Requirements

### 5.1 State & File Management

- **Must** maintain a `tasks.json` file as the single source of truth.
- **Must** create a `plan/` directory structure: `plan/{sequence}_{hash}/`.
- **Must** support bugfix session structure: `plan/{sequence}_{hash}/bugfix/{sequence}_{hash}/`.
- **Must** support "Smart Commit": Automatically staging changes while protecting pipeline state files.
- **Must** handle graceful shutdown (finish current task before exiting on SIGINT).
- **Must** implement nested execution guard via `PRP_PIPELINE_RUNNING` environment variable.
- **Must** validate session paths in bug fix mode (must contain "bugfix" in path).

**Protected Files (NEVER delete or move):**

- `$SESSION_DIR/tasks.json` - Pipeline state tracking
- `$SESSION_DIR/prd_snapshot.md` - PRD snapshot for session
- `$SESSION_DIR/delta_prd.md` - Delta PRD for incremental sessions
- `$SESSION_DIR/delta_from.txt` - Delta session linkage
- `$SESSION_DIR/TEST_RESULTS.md` - Bug report file
- `PRD.md` - Product requirements document (human-owned)
- Any file matching `*tasks*.json` pattern
- Any file directly in `$SESSION_DIR/` root (never move to subdirectories)

**`tasks.json` Protection & Smart Recovery:**

Agents routinely corrupt `tasks.json` despite the forbidden-operations rules (§5.2) — truncated writes, partial edits, or schema-invalid mutations. The system must survive this without human intervention:

- **Re-apply after every agent run:** After each agent invocation, the orchestrator re-reads `tasks.json` and re-applies only the _legitimate_ status change from that run (the item just implemented or interrupted), discarding any other unauthorized mutations.
- **Recover from corruption:** If `tasks.json` fails to parse or validate, the system walks git commit history (prior versions of the file) to locate the last valid JSON, restores it, then re-applies any in-flight status changes on top.
- **Preserve background-research status (snapshot before revert):** Items marked `Researching` or `Ready` by the background research queue must survive a restore. To do this reliably, the restore logic snapshots the live `Researching`/`Ready` item IDs from the **working-tree `tasks.json` before** the git revert (the authoritative copy of what the research supervisor actually wrote), then re-applies them afterward gated on **filesystem evidence**: an item is set back to `Ready` only if its `PRP.md` exists, and to `Researching` only if its `research/` directory exists. This must not depend on an in-memory index that can drift out of sync with the supervisor.
- **Non-fatal:** A single corrupting agent must never terminate the session. Restore is automatic and logged.

**Critical-File Deletion Protection (`PRD.md` / `PRP.md`):**

The autonomous bug finder, the validation fixer, and especially the cleanup agent sometimes delete `PRD.md` and `**/PRP.md`. Because Smart Commit stages with `git add -A`, any such deletion would otherwise be committed permanently — silently wiping the real PRD and every PRP on every bug-fix run. Two layers protect them, mirroring the `tasks.json` recovery:

- **Prompt layer:** every deletion-capable agent prompt (cleanup, bug hunter, bug-fix breakdown, post-validation fix) forbids `rm` / `git rm` / `git clean` / `mv` against `PRD.md`, any `PRP.md`, or anything under `plan/`, and forbids treating pipeline-state files as "temporary."
- **Mechanical layer (`restore_critical_files`):** invoked from Smart Commit right after staging, it detects staged _deletions_ of `PRD.md`/`PRP.md` (`git diff --cached --diff-filter=D`) and undoes them — restoring the file from `HEAD` when it existed there, or unstaging the deletion when the file was created and deleted in the same run. `PRD.md` and `PRP.md` are thus guaranteed to survive every commit.

**Orphaned-`plan/` Recovery (interrupted-run survival):**

A force-interrupted prior run can leave an item "Complete" in the working tree but never committed — stranding its `plan/` work directory and the status change as untracked/unstaged. Because the cleanup agent is forbidden from touching `plan/` and no later commit would reach this item, a blind skip ("already Completed → return") would orphan that work forever. Two guards close this:

- **Skip-recovery:** on the Completed-skip path, the orchestrator checks the item's status in _HEAD's_ `tasks.json` (not the working tree). If HEAD does not also record it Complete, it runs Smart Commit immediately to persist the stranded `plan/` directory + status.
- **Pre-cleanup commit:** see §4.2 step 4 — the item's substance is committed _before_ the cleanup agent runs, so an interrupt during cleanup can no longer produce the orphaning state.

**Smart Commit Resilience (commit-gen retry + fallback):**

Smart Commit delegates commit-message generation to an LLM tool (`stagecoach`). That call is one-shot and transient-API-sensitive — a generation timeout here is LLM-API slowness, not a stuck subprocess, and the index is left untouched with the lock released on the rescue exit — so it _should_ be retried. This is the opposite situation from an agent-subprocess hang (see below).

- **Bounded retry with backoff:** commit-generation is retried up to `COMMIT_RETRY_MAX` (default 5) attempts with exponential backoff (`COMMIT_RETRY_DELAY`, default 10s, doubling, capped at 120s).
- **Last-resort fallback:** if generation is still failing after all retries, the staged work MUST NOT be stranded uncommitted — the system falls back to a plain `git commit` with a clearly-labeled placeholder message (e.g. `chore: commit-gen failed (exit N); fallback commit`) so the substance is preserved and can be reworded later.
- **Distinct from agent-subprocess timeouts:** a watchdog timeout (exit 124) on a _research/implementation/validation_ call MUST NOT be retried (a hung subprocess would just re-hang), whereas a generation-timeout on the _commit_ call MUST be retried. The two timeout sources are treated differently by design.

**`tasks.json` Write Concurrency (lost-update prevention):**

`tasks.json` is an unlocked read-modify-write resource, and two callers write it concurrently in this pipeline: the **foreground executor** (`Implementing`/`Complete`) and the **background research supervisor** (`Researching`/`Ready` for depth-chained items). Their read-modify-write cycles can interleave, and the losing interleave clobbers a status back (e.g. the supervisor reverts `N:Implementing` → `N:Ready` because it read the file before the executor's write landed). The same window affects the restore/recovery path. This MUST be prevented:

- **Process-level mutual exclusion:** every read-modify-write of `tasks.json` MUST be serialized under an exclusive lock (e.g. `flock` on a sibling lockfile), scoped so it is safe under recursion and the backgrounded supervisor. Both the orchestrator's status writes and the restore/recovery path go through the same locked accessor.
- **Atomic writes:** `tasks.json` MUST be written atomically — write to a temp file then `rename` onto the target (atomic on the same filesystem) — so concurrent readers never see a half-written file and a crash mid-write cannot corrupt it. (Atomic writes alone do not prevent lost updates — process-level mutual exclusion does — but they make every writer crash-safe.)

### 5.2 Agent Capabilities

- **Tooling:** Agents must have access to:
  - File I/O (Read/Write).
  - Shell execution (for running tests/linters).
  - Search (Grep/Glob).
  - Web Research (for fetching docs).
- **Context Management:** The system must inject specific context (Previous session notes, Architecture docs) into agent prompts.

**Agent Operational Boundaries (FORBIDDEN OPERATIONS):**

Each agent type has strictly defined output scopes and forbidden operations to prevent pipeline corruption:

| Agent Type     | Allowed Output Scope                  | Forbidden Operations                           |
| -------------- | ------------------------------------- | ---------------------------------------------- |
| Task Breakdown | `tasks.json`, `architecture/`         | PRD.md, source code, .gitignore                |
| Research (PRP) | `PRP.md`, `research/`                 | tasks.json, source code, prd_snapshot.md       |
| Implementation | `src/`, `tests/`, `lib/`              | plan/, PRD.md, tasks.json, pipeline scripts    |
| Cleanup        | `docs/` organization                  | plan/, PRD.md, tasks.json, session directories |
| Task Update    | `tasks.json` modifications            | PRD.md, source code, prd_snapshot.md           |
| Validation     | `validate.sh`, `validation_report.md` | plan/, source code, tasks.json                 |
| Bug Hunter     | `TEST_RESULTS.md` (if bugs found)     | plan/, source code, tasks.json                 |

**Universal Forbidden Operations (all agents):**

- Never modify `PRD.md` (human-owned document)
- Never add `plan/`, `PRD.md`, or task files to `.gitignore`
- Never run `prd`, `run-prd.sh`, or `tsk` commands (prevents recursive execution)
- Never create session-pattern directories (`[0-9]*_*`) outside designated locations

### 5.3 Task Management

- Support status: `Planned`, `Researching`, `Implementing`, `Complete`, `Failed`, `Obsolete`.
- Support scopes: User can execute specific scopes (`--scope=milestone`, `--task=3`).

**`prd task` Subcommand:**

Provides convenient wrapper to interact with tasks in the current session:

```bash
prd task              # Show tasks for current session
prd task next         # Get next task
prd task status       # Show status
prd task -f <file>    # Override with specific file
```

`prd status` is aliased to `prd task` for git muscle memory (`git status` / `prd status`).

**Task File Discovery Priority:**

1. Incomplete bugfix session tasks (`SESSION_DIR/bugfix/NNN_hash/tasks.json`)
2. Main session tasks (`SESSION_DIR/tasks.json`)

## 6. Critical Prompts & Personas

The system relies on specific, highly-engineered prompts. These must be preserved in the rewrite.

### 6.1 Task Breakdown System Prompt

- **Role:** Lead Technical Architect.
- **Goal:** Decompose PRD into strict JSON.
- **Constraint:** "Validate before breaking down." Spawn sub-agents to research before defining tasks.
- **Logic:** Implicit TDD (tests are part of the subtask, not separate).
- **Reasoning Budget:** Decomposition runs at the **maximum reasoning budget** (extended-thinking `xhigh` equivalent), because synthesizing research into a strict Phase→Milestone→Task→Subtask hierarchy is the most reasoning-intensive step. The "demand write" retry (when breakdown output is missing/invalid) uses the same budget.
- **Documentation Sync (two-mode rule):** Documentation is never a standalone subtask; it rides with the work, mirroring the TDD rule:
  - **Mode A (doc-with-work):** Docs a subtask directly touches — config, public API, CLI, env vars, exported types — are updated _inside_ that subtask's `context_scope`, declared via a `DOCS:` line.
  - **Mode B (changeset-level):** Cross-cutting docs that only make sense once the whole change lands (README, feature overviews, architecture summaries) become a **final "Sync changeset-level documentation" task** that depends on all implementing subtasks.

### 6.2 PRP Creation Prompt ("The Blueprint")

- **Role:** Product Owner / Researcher.
- **Goal:** Create a `PRP.md` that ensures "One-pass implementation success."
- **Process:**
  1.  Codebase Analysis (Find similar patterns).
  2.  Internal/External Research.
  3.  Template Filling (Context, Implementation Steps, Validation Gates).
- **Output:** A markdown file adhering to a strict template.
- **Single-PRP default with strict batching gates:** A PRP call writes exactly **ONE** PRP — the one it was asked for — not several batched into one session. Batching is permitted _only_ as an optimization for tightly-coupled items, at a _higher_ bar (not a lower one): before any second PRP is written, the agent must hold the full task-tree and full-PRD context, run 3–5 subagent research calls _per item_ (the research budget is per PRP, so an N-PRP batch needs ~N× the research), pass a per-item "No Prior Knowledge" check, and declare the batch explicitly. **When in doubt, write one.** This prevents the thin, under-researched PRPs that batching produced in the past.

### 6.3 PRP Execution Prompt ("The Builder")

- **Role:** Senior Engineer.
- **Goal:** Execute the PRP contract.
- **Logic:**
  - **CRITICAL:** Read PRP first.
  - **Progressive Validation:** Level 1 (Lint/Type), Level 2 (Unit Test), Level 3 (Integration), Level 4 (Manual/Creative).
  - Failure Protocol: Fix and retry until validation passes.

### 6.4 Delta PRD Generation Prompt

- **Role:** Change Manager.
- **Input:** Old PRD, New PRD, Completed Tasks.
- **Goal:** Generate a "Delta PRD" focusing _only_ on the diffs, referencing existing implementations to avoid work duplication.
- **Doc Impact Declaration:** Each affected item in the delta must declare its documentation impact at authoring time (a Mode A `DOCS:` line or a Mode B changeset-level note, per §6.1), so delta sessions ship with up-to-date docs instead of stale READMEs.

### 6.5 Creative Bug Finding Prompt

- **Role:** Adversarial QA Engineer.
- **Input:** PRD, Completed Tasks.
- **Phases:**
  1.  Scope Analysis.
  2.  Creative E2E Testing (Happy path + Edge cases).
  3.  Adversarial Testing (Unexpected inputs).
- **Output:** `TEST_RESULTS.md` (only if bugs exist).

### 6.6 PRD Brainstormer Prompt ("Requirements Interrogation Engine")

- **Role:** Requirements Interrogation and Convergence Engine.
- **Goal:** Produce comprehensive PRDs through aggressive questioning rather than invention.
- **Four-Phase Model:**
  1.  **Discovery:** Initial requirements gathering.
  2.  **Interrogation:** Deep questioning to uncover gaps and ambiguities.
  3.  **Convergence:** Consolidating answers into coherent specifications.
  4.  **Finalization:** Final PRD generation with testability validation.
- **Key Rules:**
  - Maintains a Decision Ledger for tracking confirmed facts.
  - Linear questioning rule (no parallel questions that could invalidate each other).
  - All specifications must have testability requirements.
  - Impossibility detection for conflicting requirements.

## 7. Improvements for the Rewrite

While the Bash script is functional, the rewrite in a higher-level language (Python/Go/Rust) must address these limitations:

1.  **Concurrency Control:** The bash script uses background subshells (`&`) which are hard to monitor. The rewrite should use proper async/await patterns or thread pools for "Parallel Research."
2.  **Structured State:** Replace `jq` parsing with native JSON serialization/deserialization to prevent corruption of `tasks.json`.
3.  **Observability:** structured logging instead of `print -P` (see §9.6 for the logging architecture — lazy loggers and synchronous destinations are mandatory).
4.  **Tool Abstraction:** Instead of relying on `tsk` CLI, integrate the task management logic directly into the codebase.
5.  **Error Handling:** Stronger retry logic and exception handling for API calls and tool failures — including a **fail-fast auth preflight** (§9.2.7) so credential misconfiguration is caught at startup instead of deep inside the first agent run.
6.  **Provider-Agnostic Authentication:** Authenticate the **resolved provider** (`~/.pi/agent/auth.json` or the provider's native env var, e.g. `ZAI_API_KEY`), not Anthropic-shell env vars; `ANTHROPIC_AUTH_TOKEN` is a backward-compat alias, never a hard requirement (see §9.2.6).

## 8. Development Roadmap (Bootstrap)

To implement this PRD, the following self-bootstrapping sequence is recommended:

1.  **Core:** Implement the `Task` and `Session` data structures.
2.  **Orchestrator:** Implement the logic to iterate through the JSON hierarchy.
3.  **Prompts:** Port the HEREDOC prompts into a template engine (e.g., Jinja2).
4.  **Agent Interface:** Build the wrapper to send these prompts to the LLM.
5.  **CLI:** Build the entry point to trigger the pipeline.

## 9. Technical Specification (Groundswell Implementation)

This section details the implementation strategy leveraging the local [Groundswell](~/projects/groundswell) library.

### 9.1 Technology Stack

- **Runtime**: Node.js 20+ / TypeScript 5.2+
- **Core Framework**: Groundswell (local library at `~/projects/groundswell`)
- **Agent Harness**: `pi` (pi.dev) — the vendor-neutral, **first-class default** runtime. `claude-code` is a **second-class, parity-maintained** option retained specifically for users locked into Anthropic's walled-garden ecosystem (e.g. subscribers who want to spend an Anthropic coding-plan quota); see §9.4.
- **LLM Provider**: z.ai (Anthropic-compatible API), orthogonal to the harness; the default provider. Authentication is **provider-aware** (see §9.2.6) and does **not** assume Anthropic credentials.
- **State Management**: Groundswell `@ObservedState` & `Workflow` persistence

### 9.2 Environment Configuration

The system uses a layered environment configuration strategy with proper fallback handling.

#### 9.2.1 Configuration Source Priority

Configuration is loaded in the following order (later sources override earlier ones):

1. **Shell Environment**: Inherited environment variables
2. **`.env` File**: Local project configuration (automatically loaded by test setup)
3. **Runtime Overrides**: Explicit environment variable settings

#### 9.2.2 Required Environment Variables

- **API Connection** — **provider-native, not a single hard-coded env var.** See §9.2.6 for the complete auth model. Summary:
  - Default path (`pi` + `zai`): authenticate via `pi /login` (writes `~/.pi/agent/auth.json`) **or** `export ZAI_API_KEY=…`. **No Anthropic env var is required.**
  - `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`: accepted **only** for the `anthropic` provider (and as a backward-compat alias: when `ANTHROPIC_AUTH_TOKEN` is set and `ANTHROPIC_API_KEY` is unset, the former is mapped to the latter). They must **never** be a hard requirement of the default path.
  - `ANTHROPIC_BASE_URL`: provider endpoint, resolved against the selected provider; defaults to `https://api.z.ai/api/anthropic` **only** when the provider is `zai` (see §9.2.4 safeguard).

- **Agent Runtime (Harness)**:
  - `PRP_AGENT_HARNESS`: Agent runtime/SDK to use — `pi` (pi.dev, default) or `claude-code`. Orthogonal to the LLM provider; see §9.4.

- **Pipeline Control**:
  - `PRP_PIPELINE_RUNNING`: Guard to prevent nested execution (set to PID when pipeline starts)
  - `SKIP_BUG_FINDING`: Skip bug hunt stage; also identifies bug fix mode when `true`
  - `SKIP_EXECUTION_LOOP`: Internal flag to skip task execution while allowing validation/bug hunt
  - `PARALLEL_RESEARCH`: Enable background (parallel) PRP research (`true`/`false`, default `false`; CLI `-r`/`--parallel-research`). MUST be forwarded — along with `RESEARCH_DEPTH` — into the bugfix sub-pipeline (§4.2, §4.4), where all real item execution occurs.

- **Resilience Tuning**:
  - `RESEARCH_TIMEOUT`: Deadline in seconds for background (parallel) research before falling back to synchronous re-research (default 1800 / 30 min; see §4.2). A grace period precedes the heartbeat so legitimately long research is not flagged as stuck.
  - `RESEARCH_DEPTH`: How many items ahead the background research supervisor prefetches as a chain (default 2; see §4.2).
  - `ISSUE_RETRY_MAX`: Maximum number of issue-driven re-planning attempts per item before it hard-fails (default 3; see §4.5).

- **Bug Hunt Configuration**:
  - `BUG_FINDER_AGENT`: Agent used for bug discovery (default: `pizr`, reasoning-tier; see §9.2.3)
  - `BUG_RESULTS_FILE`: Bug report output file (default: `TEST_RESULTS.md`)
  - `BUGFIX_SCOPE`: Granularity for bug fix tasks (default: `subtask`)

- **Validation Control**:
  - `VALIDATION_AGENT`: Agent that generates and runs `validate.sh` (default: `pizr`, reasoning-tier; see §9.2.3). Overrides the generic `$AGENT` for the validation call only.
  - `VALIDATION_TIMEOUT`: Watchdog budget in seconds for the validation call (default: 7200 / 2h — validation legitimately runs full test suites). Overrides the generic agent timeout for the validation call only.

#### 9.2.3 Model Selection

Models are specified as provider-qualified strings (`provider/model`), independent of the harness (see §9.4). The pipeline reads model names from the environment at runtime and qualifies them with the `zai` provider.

The pipeline uses **separate model roles** so cost, speed, and reasoning depth can be tuned per phase. Heavy reasoning and fast codegen are independently configurable, and the reasoning-intensive steps pin the maximum thinking budget:

- **Research role (`AGENT`)** — architecture research and PRP creation. Balanced model, normal reasoning budget. Backed by `ANTHROPIC_DEFAULT_SONNET_MODEL` (default: `glm-5.2` → resolved as `zai/glm-5.2`).
- **Reasoning role (`BREAKDOWN_AGENT` / `BUG_FINDER_AGENT` / `VALIDATION_AGENT`)** — task decomposition, creative bug discovery, and validation. These run on the balanced model but at the **maximum reasoning budget** (extended-thinking `xhigh`), because synthesizing research into a strict Phase→Milestone→Task→Subtask hierarchy, adversarial bug-finding, and validating against the full PRD are the most reasoning-intensive steps. (In the bash pipeline these are the `pizr` agent — `pi` with `--thinking xhigh`.)
- **Implementation role (`IMPL_AGENT`)** — code-writing steps: PRP execution and post-validation fix. Faster codegen. Backed by `ANTHROPIC_DEFAULT_HAIKU_MODEL` (default: `glm-5-turbo` → resolved as `zai/glm-5-turbo`; bash identifier `piznt`).

These values should be read from the environment at runtime, not hardcoded. Model strings are never harness-qualified (e.g., `pi/zai/glm-5.2` is invalid). Model ids are **lowercase** as registered in the Pi model registry (run `pi --list-models zai` to verify available ids).

#### 9.2.4 API Endpoint Safeguards

**CRITICAL**: All tests and validation scripts enforce the z.ai **provider** endpoint:

- Tests will fail immediately if `ANTHROPIC_BASE_URL` is set to Anthropic's official API (`https://api.anthropic.com`)
- Validation scripts block execution to prevent accidental API usage
- Warnings are issued for non-z.ai endpoints (excluding localhost/mock/test endpoints)

This prevents the massive usage spikes that occurred when tests were accidentally configured to use Anthropic's production API.

> **Harness note.** This safeguard constrains the LLM **provider** (z.ai), not the **harness**. Because the default `pi` harness can run any provider, the pipeline defaults to `pi` + `zai` so the safeguard stays effective. The optional `claude-code` harness is **Anthropic-only** and therefore incompatible with the z.ai provider — selecting it requires switching to `anthropic/*` models and disabling this safeguard (see §9.4).

#### 9.2.5 Nested Execution Guard

**Problem:** Agents could accidentally invoke `run-prd.sh` during implementation, causing recursive execution and corrupted pipeline state.

**Solution:** The pipeline sets `PRP_PIPELINE_RUNNING` environment variable at script entry and validates it before proceeding.

**Guard Logic:**

1. On pipeline start, check if `PRP_PIPELINE_RUNNING` is already set
2. If set, only allow execution if BOTH conditions are true:
   - `SKIP_BUG_FINDING=true` (legitimate bug fix recursion)
   - `PLAN_DIR` contains "bugfix" (validates bugfix context)
3. If validation fails, exit with clear error message
4. On valid entry, set `PRP_PIPELINE_RUNNING` to current PID

**Session Creation Guards:**

- In bug fix mode, prevent creating sessions in main `plan/` directory
- Bug fix session paths must contain "bugfix" in the path
- Provides debug logging showing `PLAN_DIR`, `SESSION_DIR`, and `SKIP_BUG_FINDING` values

#### 9.2.6 Authentication Model (Provider-Agnostic)

**Strategic framing.** Anthropic's ecosystem became a walled garden after the original spec was written, so Anthropic is downgraded to a second-class citizen. The default use case is now the vendor-neutral `pi` harness, whose natural auth flows are pi-native (`pi /login` → `auth.json`, or the provider's own env var). Auth must therefore be **provider-aware**: it authenticates the provider of the resolved model (default `zai`), and it must not gate the pipeline on Anthropic-shell conventions.

**Problem (root cause of the auth bypass).** The original design assumed Anthropic shell conventions as the primary auth path: `ANTHROPIC_AUTH_TOKEN` was the single required credential, mapped to `ANTHROPIC_API_KEY`, captured into each agent config, and forwarded into the harness. Under the `pi`-default model this is wrong on three counts:

1. **Wrong contract for `pi` users.** `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` are Anthropic-shell conventions. A `pi` user authenticates through pi's native sources — `pi /login` writing `~/.pi/agent/auth.json`, or the provider's own env var (`ZAI_API_KEY`, etc.). Requiring an Anthropic env var is an unnatural hard gate, and `pi`'s native env lookup for `zai` consults `ZAI_API_KEY`, **not** the Anthropic names.
2. **`auth.json` is silently ignored.** Groundswell's `PiHarness.initialize()` constructs `AuthStorage.inMemory()` + `ModelRegistry.inMemory(...)`. An in-memory auth store reads **only** runtime overrides and env vars — it never reads the `~/.pi/agent/auth.json` file. Consequently a user who runs `pi /login` (the canonical `pi` auth flow) has a valid `zai` credential on disk that the pipeline cannot see. (The Anthropic env var only works today because hacky-hack force-injects it as a provider-keyed runtime override, bypassing pi's normal resolution — not because pi reads it natively for `zai`.)
3. **Empty-string shadowing.** `createBaseConfig()` forwards `process.env.ANTHROPIC_API_KEY ?? ''`. When the Anthropic env vars are unset, an empty string is threaded into the agent config; pi currently ignores an empty override, but the contract is fragile and obscures "unset" from "misconfigured".

**Resolved auth resolution order (per selected provider).** The pipeline authenticates the **provider of the resolved model** (default `zai`), not Anthropic. Auth for a given provider is resolved in this order; the first available source wins:

1. **Explicit override** — a non-empty pipeline-level credential passed via the harness `options.apiKey` (e.g. a future `--api-key` flag or `PRP_API_KEY` env var). Highest precedence; forwarded only when non-empty.
2. **Provider-native env var** — the env var pi assigns to that provider (`ZAI_API_KEY` for `zai`, `ANTHROPIC_API_KEY` / `ANTHROPIC_OAUTH_TOKEN` for `anthropic`, etc.), resolved via pi's `getEnvApiKey(provider)` mapping.
3. **`pi` auth.json** — `~/.pi/agent/auth.json`, written by `pi /login` / `pi /auth`. **This must be honored** (see Groundswell contract change below); it is the canonical auth flow for interactive `pi` users.

**`ANTHROPIC_AUTH_TOKEN` demotion.** `ANTHROPIC_AUTH_TOKEN` is no longer required and is not the documented primary path. It MAY be accepted as a backward-compat alias (mapped to `ANTHROPIC_API_KEY` when the latter is unset) so existing Anthropic-provider setups keep working. It must never be the only accepted credential, and the default (`pi` + `zai`) path must not depend on it.

**Groundswell contract change (auth.json support).** Because hacky-hack is the `pi` harness's primary consumer, the harness MUST consult pi's on-disk auth store rather than an in-memory one. Concretely, `pi` harness initialization must replace `AuthStorage.inMemory()` with `AuthStorage.create()` (file-backed `FileAuthStorageBackend`, default path `getAgentDir()/auth.json`) — or accept a caller-supplied, file-backed `authStorage` / `ModelRegistry`. hacky-hack must NOT inject an empty `apiKey` into the harness options; it forwards an override only when a non-empty credential is explicitly resolved (§9.2.7). Track as a cross-cutting change against `~/projects/groundswell` `src/harnesses/pi-harness.ts`.

**Provider-aware base URL.** The endpoint (`ANTHROPIC_BASE_URL` today) is a property of the **provider**, not a global Anthropic setting. It must be resolved against the selected provider and default to the z.ai endpoint only when the provider is `zai`. The §9.2.4 safeguard remains in force for the `zai` provider.

#### 9.2.7 Authentication Preflight (Fail-Fast)

**Problem.** `validateEnvironment()` exists but is never invoked on the pipeline's startup path — only by `scripts/validate-api.ts`. A misconfigured credential (the single most common install failure) is therefore not detected until the first agent actually calls the model, where it surfaces as a deep, misleading error (`Pi agent execution failed: No API key found for zai.`) inside `decomposePRD`, after a session directory has already been created and an `ERROR_REPORT.md` written.

**Requirement.** The pipeline MUST run an auth preflight on the startup path, after `configureEnvironment()` and before `ensureHarnessInitialized()` / any agent run. The preflight resolves the selected **harness + provider/model** and verifies that at least one auth source from §9.2.6 is available for that provider.

**Failure behavior.** On failure, the pipeline MUST abort **before** creating a session or invoking an agent, and emit an actionable error naming:

- the selected harness and provider/model,
- every auth source that was checked and found empty (override, the provider env var name, and the `~/.pi/agent/auth.json` path),
- the exact remediation (`pi /login`, or `export <PROVIDER>_API_KEY=…`).

**Empty-string policy.** The preflight MUST treat empty / whitespace-only credentials as "not configured." Empty strings must never be forwarded into harness options as auth (eliminating the `?? ''` shadowing).

**Harness-specific check.** For the `claude-code` harness, the preflight verifies an Anthropic credential (that harness is Anthropic-only). For the `pi` harness, the preflight uses the provider-aware resolution in §9.2.6.

**Acceptance criteria.**

- A run with **no** credential configured for the selected provider aborts at startup with a single actionable message and exit code `1` — **no** session directory is created, **no** agent is invoked.
- A run authenticated via `~/.pi/agent/auth.json` alone (no env vars) succeeds under the `pi` + `zai` default.
- A run authenticated via `ZAI_API_KEY` alone succeeds under the `pi` + `zai` default.
- A run authenticated via `ANTHROPIC_AUTH_TOKEN` succeeds **only** when the provider is `anthropic` (or via the backward-compat alias); it is **not** required by the default path.

#### 9.2.8 Provider-Neutral Configuration Naming

**Problem.** Several pipeline-global configuration env vars still carry the `ANTHROPIC_` prefix — a legacy of the original Anthropic-first design (`ANTHROPIC_BASE_URL`, `ANTHROPIC_DEFAULT_OPUS_MODEL` / `..._SONNET_MODEL` / `..._HAIKU_MODEL`). Under the `pi` + `zai` default (§9.1, §9.2.6) this is actively misleading: the names imply a hard Anthropic dependency when in fact they configure the vendor-neutral pipeline (the LLM endpoint and the model-quality tiers). The tier names themselves (`opus`/`sonnet`/`haiku`) are Anthropic model-family names, compounding the same smell.

**Requirement.** Pipeline-global configuration env vars MUST be provider-neutral (the `PRP_*` namespace already used by `PRP_API_KEY`, `PRP_AGENT_HARNESS`, `PRP_PIPELINE_RUNNING`). A vendor name may appear ONLY in a variable that is genuinely that vendor-provider's own native credential (e.g. `ZAI_API_KEY`, `ANTHROPIC_API_KEY`), never in a pipeline-global setting.

**Canonical names.**

| Canonical (provider-neutral) | Legacy alias (deprecated)        | Purpose                                                     | Default                                                 |
| ---------------------------- | -------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| `PRP_API_BASE_URL`           | `ANTHROPIC_BASE_URL`             | LLM provider endpoint, resolved per provider (§9.2.4)       | `https://api.z.ai/api/anthropic` when provider is `zai` |
| `PRP_MODEL_HIGH`             | `ANTHROPIC_DEFAULT_OPUS_MODEL`   | Highest-quality model tier                                  | `glm-5.2`                                               |
| `PRP_MODEL_BALANCED`         | `ANTHROPIC_DEFAULT_SONNET_MODEL` | Balanced/default tier — planning & research roles (`AGENT`) | `glm-5.2`                                               |
| `PRP_MODEL_FAST`             | `ANTHROPIC_DEFAULT_HAIKU_MODEL`  | Fast/codegen tier — implementation role (`IMPL_AGENT`)      | `glm-5-turbo`                                           |

**Model-tier rename.** The internal tiers are renamed from Anthropic model-family names to vendor-neutral quality tiers: `opus` → `high`, `sonnet` → `balanced`, `haiku` → `fast`. This touches `MODEL_NAMES`, `MODEL_ENV_VARS`, `getModel(tier)`, the `ModelTier` type, and the agent factory's per-persona tier selection (§9.2.3). The role→tier mapping is unchanged: planning/research → `balanced`; implementation → `fast`.

**Backward compatibility.** The legacy `ANTHROPIC_*` names MUST remain readable as deprecated aliases: when a canonical var is unset, the loader falls back to the legacy alias and emits a one-time deprecation warning naming the canonical replacement. The legacy aliases are slated for removal in a future major version. `.env.example` documents only the canonical names (legacy names appear solely in a deprecation note).

**Scope / transition.** This is a forward requirement. When implemented, it updates §9.2.2, §9.2.3, and §9.2.4 to reference the canonical names as primary, the env loader (`config/environment.ts`, `config/constants.ts`) to read canonical-first with legacy fallback, and `.env.example`. **Until then, the `ANTHROPIC_*` names shown in §9.2.2–§9.2.4 remain in effect** (so the current code, which reads those names, stays in spec).

**Exception — Anthropic-provider credentials.** `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` are NOT renamed: they are the `anthropic` provider's own native credentials, consulted only when the resolved provider is `anthropic` (§9.2.6). Provider-native credential names are correct; only pipeline-global vars are neutralized.

### 9.3 System Components (Groundswell Mapping)

#### 9.3.1 Pipeline Controller (`MainWorkflow`)

The entry point will be a class extending `Workflow` that manages the high-level lifecycle.

```typescript
import { Workflow, Step, ObservedState, Task } from 'groundswell';

class PRPPipeline extends Workflow {
  @ObservedState() sessionPath: string;
  @ObservedState() taskState: TaskRegistry;

  @Step()
  async initializeSession() {
    // Hash PRD, check for deltas, setup plan/ directory
  }

  @Task()
  async executePhase() {
    // Triggers the main loop
  }
}
```

#### 9.3.2 Task Orchestrator

Leverage Groundswell's hierarchical `@Task` feature.

- **Recursive Workflow**: Instead of a flat loop, the `TaskExecutor` can be a recursive workflow where each Phase/Milestone/Task is a sub-workflow.
- **Concurrency**: Use `@Task({ concurrent: true })` for "Parallel Research" where applicable (e.g., researching next tasks while current one executes).
- **Depth-Chained Research Queue**: The background supervisor researches a chain of up to `RESEARCH_DEPTH` items ahead while the current item executes, prefetching the next as each completes (§4.2). Each generation is wrapped in a deadline (`RESEARCH_TIMEOUT`); on expiry the queue abandons the in-flight research and the orchestrator re-researches the item synchronously.
- **Issue-Driven Re-planning**: The orchestrator treats a Coder Agent `issue` result as a signal to delete the stale PRP, reset the item to `Planned`, and re-research with the captured feedback injected, bounded by `ISSUE_RETRY_MAX` (§4.5).
- **`tasks.json` Restore**: After every agent run the orchestrator re-applies only the legitimate status delta and, on parse/validation failure, restores the last valid version from git history before re-applying (§5.1). Research statuses (`Researching`/`Ready`) are snapshotted from the working tree _before_ the revert and re-applied afterward using filesystem evidence (PRP.md/research/ existence), so they survive without depending on an in-memory supervisor index.
- **Watchdog kills are terminal:** Retry loops (the bash `run_with_retry` / `run_with_retry_stdin` and their Groundswell equivalents) MUST treat a watchdog kill (exit 124) as a hard failure — a hung process will simply re-hang, so churning retries is wrong. This applies to validation under `VALIDATION_TIMEOUT` (§4.4): a watchdog-killed validation aborts the run and is not retried.
- **Stateless single-shot invocations:** Agent calls that are stateless by nature (cleanup, mid-session task update, validation, post-validation fix, bug-finder, per-item PRP execution) MUST NOT create or resume sessions. They are single-shot or operate on freshly-built prompts, so enabling session persistence only creates orphaned sessions that serve no purpose (the bash equivalent is the `--no-session` flag).

#### 9.3.3 Agent Runtime & Personas

Agents are instantiated using Groundswell's `createAgent` factory or by extending the `Agent` class, and execute through the configured **harness** (default `pi` / pi.dev; `claude-code` optional — see §9.4).

- **Tooling**: Use `MCPHandler` to register local system tools. Tools execute locally through Groundswell regardless of the active harness; the harness only reports tool calls back.
  - `BashTool`: For executing validation scripts and git commands.
  - `FileTool`: For reading/writing PRPs and code.
  - `WebSearchTool`: For external documentation.
- **Prompt Delivery (no argv-size limit):** Prompts frequently embed the full PRD and can exceed 128 KB. They MUST be delivered to the agent as a programmatic message body (stdin/stream), never as an argv string — argv strings are capped by the kernel's `MAX_ARG_STRLEN` (131,072 bytes) and fail with a hard `E2BIG` that no wrapper can recover from. Any temp files backing these prompts MUST be cleaned up on both graceful and hard-killed (SIGTERM/SIGKILL/power-loss) exits. When a temp file backs a retry loop, it MUST be (re-)written on _every_ attempt: if the agent or the system cleans `/tmp` mid-run, a write-once temp file fails forever on every later retry, whereas re-writing is cheap and makes retries resilient.

#### 9.3.4 Prompt Engineering (From PROMPTS.md)

The critical prompts from `PROMPTS.md` must be ported to a structured format compatible with Groundswell's `Prompt` object.

- **Templates**: Convert raw HEREDOC prompts into TypeScript template literals or external text files loaded at runtime.
- **Structured Output**: For the **Architect Agent**, use Zod schemas to enforce the strict JSON output format required for `tasks.json`.

```typescript
// Example Architect Prompt Definition
const architectPrompt = createPrompt({
  name: 'architect_breakdown',
  user: prdContent,
  system: TASK_BREAKDOWN_SYSTEM_PROMPT, // Ported from PROMPTS.md
  responseFormat: z.object({
    backlog: z.array(
      z.object({
        type: z.literal('Phase'),
        // ... full schema definition
      })
    ),
  }),
});
```

### 9.4 Agent Harness System (Runtime Selection)

This project adopts Groundswell's pluggable **harness** model (Groundswell PRD §7). The **harness** is the agent runtime/SDK that drives prompting, tool execution, and streaming; it is **orthogonal** to the LLM **provider/model**. The two are selected independently. **Primacy:** `pi` is the first-class default; `claude-code` is a second-class, parity-maintained option retained for Anthropic loyalists (see §9.1). Auth for either harness is provider-aware (§9.2.6) and gated by a fail-fast preflight (§9.2.7).

#### 9.4.1 Supported Harnesses

| Harness       | SDK / Package                                       | Default?      | Notes                                                                                                                                                          |
| ------------- | --------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pi`          | Pi SDK — `@earendil-works/pi-coding-agent` (pi.dev) | **Yes**       | Vendor-neutral runtime; runs any LLM provider (incl. z.ai). MCP, Skills, and LSP are supplied by Groundswell's `MCPHandler`.                                   |
| `claude-code` | Claude Code SDK — `@anthropic-ai/claude-agent-sdk`  | No (optional) | Anthropic-only models. Incompatible with the z.ai provider (see §9.2.4). Retained as a parity-maintained fallback for users locked into Anthropic's ecosystem. |

**Default selection.** `PRP_AGENT_HARNESS` defaults to `pi` (pi.dev). This is the only harness compatible with the project's default z.ai provider and the §9.2.4 cost safeguard.

#### 9.4.2 Configuration

```ts
import { configureHarnesses } from 'groundswell';

configureHarnesses({
  defaultHarness: 'pi', // vendor-neutral, first-class default (pi.dev)
  defaultModelProvider: 'zai', // LLM host — independent of harness
  harnessDefaults: {
    // 'pi': auth resolved provider-natively (override / env var / ~/.pi/agent/auth.json);
    //       see §9.2.6. Do NOT inject an empty apiKey — forward an override only when non-empty.
    'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY }, // Anthropic-only harness
  },
});
```

- **`PRP_AGENT_HARNESS`** (`pi` | `claude-code`, default `pi`): selects the runtime.
- Harness selection cascades: global default → agent config → prompt overrides.
- Harness-specific options (e.g. `skillsDirs` on `pi`) MAY extend the base `HarnessOptions`.

#### 9.4.3 Critical Rules

- **The harness never appears in the model string.** `pi/zai/glm-5.2` and `cc/anthropic/...` are **invalid**. Always use `provider/model` (e.g. `zai/glm-5.2`).
- **Provider/harness compatibility.** `claude-code` runs `anthropic/*` models only. Requesting the z.ai provider on `claude-code` is a configuration error surfaced at `initialize()`/`execute()`.
- **Feature parity.** All features (MCP tools, skills, hooks, `AgentResponse`, caching, workflow events) MUST work identically across both harnesses. Tool execution flows through `MCPHandler` for both, so `pi`'s lack of built-in MCP/LSP is **not** a capability gap.
- **Cache isolation.** Cache keys incorporate **both** the harness and the provider/model.

#### 9.4.4 Capability Reference

| Capability        | `pi`                                                | `claude-code`                     |
| ----------------- | --------------------------------------------------- | --------------------------------- |
| MCP               | via Groundswell `MCPHandler`                        | built-in **and** via `MCPHandler` |
| Skills            | ✓ native (agentskills.io; loads `~/.claude/skills`) | ✓ native (system prompt)          |
| LSP               | via MCP plugins through `MCPHandler`                | via MCP plugins                   |
| Streaming         | ✓                                                   | ✓                                 |
| Sessions          | ✓                                                   | ✓                                 |
| Extended Thinking | ✓                                                   | ✓                                 |
| LLM providers     | any                                                 | Anthropic only                    |

### 9.5 Implementation Roadmap

1.  **Project Setup**:
    - Initialize TypeScript project.
    - Link `groundswell` (`npm link ~/projects/groundswell`).
    - Implement the **provider-agnostic auth bootstrap** (§9.2.6): resolve the selected provider's credential via override → provider env var (`ZAI_API_KEY` for `zai`) → `~/.pi/agent/auth.json`; forward a non-empty override only.
    - Implement the **fail-fast auth preflight** (§9.2.7): abort before any agent run with an actionable error when no credential is resolvable for the selected harness + provider/model.
    - **Cross-repo:** switch the `pi` harness to a file-backed `AuthStorage` (`AuthStorage.create()`) in `~/projects/groundswell` `src/harnesses/pi-harness.ts` so `~/.pi/agent/auth.json` is honored.
    - Call `configureHarnesses({ defaultHarness: 'pi', defaultModelProvider: 'zai' })` at startup (see §9.4).

2.  **Core Workflows**:
    - Implement `SessionManager` (Filesystem operations).
    - Implement `ArchitectAgent` (using `PROMPTS.md` logic).

3.  **Execution Engine**:
    - Implement `PRPGenerator` (Researcher).
    - Implement `CodeExecutor` (Coder).
    - Integrate `Groundswell`'s caching to save money/time on repeated architectural queries.

4.  **Validation & QA**:
    - Implement `QAAgent` (Bug Hunter).
    - Wrap validation scripts in a `ValidationWorkflow` step.

### 9.6 Logging Architecture (Lazy Loggers & Synchronous Destinations)

Cross-cutting requirement for the structured-logging subsystem (the §7.3 "Observability" improvement). The pipeline is a **CLI that calls `process.exit()` on every code path** — `--help`, `--version`, PRD validation, and full pipeline runs alike — so logging must be designed for fast process teardown, not for long-running services.

#### 9.6.1 Problem

`getLogger()` historically configured every logger with a pino **transport**:

```ts
transport: { target: 'pino-pretty', options: { /* ... */ } }
```

A pino transport spawns a **worker thread** (`ThreadStream`) per logger. pino registers one `process.on('exit', onExit)` handler per `ThreadStream` (`pino/lib/transport.js`), and that handler runs `stream.flushSync()` + `sleep(100)` + `stream.end()` **synchronously** during exit. Meanwhile, **31 modules** called `getLogger('…')` at **top-level (module-evaluation) scope**. Because `getLogger()`'s cache is keyed by context string and every module used a distinct context, each top-level call constructed an independent logger (and its own worker thread) during `import` — before the CLI parsed any arguments.

Measured consequences (the bug that motivated this section):

- Every invocation — `--help`, `-h`, `--version`, `-V`, unknown flags (exit 1), `inspect --help` — took ~10.7s wall time but only ~1.6s CPU.
- Commander printed help and called `process.exit(0)` at ~+535ms, yet the process did not terminate for ~10s more (the event loop was frozen).
- Exactly 13 pino `exit` handlers ran **sequentially**, totaling **10,111ms** — the entire stall.
- Stubbing `ThreadStream` shutdown reduced `--help` from 10.71s to 1.94s, confirming the cost is teardown-bound, not work-bound.

The stall is therefore deterministic and argument-independent: the loggers are created at import time, so every code path pays for them regardless of whether it logs a single line.

#### 9.6.2 Requirements

These requirements are **binding** for any code that constructs or configures a logger.

**REQ-L1 — Synchronous destinations only (no worker-thread transports).**
The CLI must never configure a pino `transport:` (which spawns a worker thread). Pretty-printing, when enabled, must run in-process via a synchronous destination stream — for example `pino-pretty` applied as a direct destination rather than as a transport target:

```ts
// FORBIDDEN in this CLI: spawns a worker thread + a blocking exit handler
pino({ transport: { target: 'pino-pretty' /* ... */ } });

// REQUIRED: pretty-print as a synchronous in-process destination
import pretty from 'pino-pretty';
pino(
  {
    /* ...config */
  },
  pretty({ colorize: true /* ... */ })
);
```

Transports exist to keep logging off the hot path of long-running **services**; in a CLI that exits via `process.exit()`, each transport adds one worker-thread spawn and one blocking exit handler. The machine-readable (JSON) path already uses a sync destination; the human-readable path must match it.

**REQ-L2 — Lazy logger instantiation (no module-scope loggers).**
Loggers must not be constructed at module top-level scope. A top-level `const logger = getLogger('Foo')` forces the logger to be built during `import` — before the CLI has parsed arguments or decided whether to run — which defeats every short-circuit code path (`--help`, validation, dry-run). Loggers must be obtained lazily:

- Hold the logger behind a lazy accessor (e.g. a private field populated on first use, or a memoized module-local `function logger()`), so it is constructed only by code paths that actually log.
- All existing top-level `const logger = getLogger(...)` declarations in `src/` must be migrated to lazy instantiation when this section is implemented.

`getLogger()`'s existing context-keyed cache already prevents duplicate instances per context; laziness additionally prevents construction on code paths that never log.

**REQ-L3 — Single root logger per process.**
Components running in the same process should derive their loggers from a single shared root rather than each constructing an independent logger, bounding the total number of destinations to **one per process** (one synchronous stream, zero worker threads).

#### 9.6.3 Acceptance Criteria

- `hack --help`, `hack -h`, `hack --version`, and an invalid flag each return in **under 2 seconds** (target <1s excluding cold Node/module load), with no `ThreadStream` worker threads spawned during the invocation.
- No `getLogger(...)` call exists at module top-level scope in `src/`. (Verification: `rg -n "^(export )?(const|let) \w+ = getLogger\(" src/` must return zero hits.)
- No `transport:` key appears in any logger configuration under `src/`; pretty-printing is delivered via a synchronous stream destination.
- A syscall-level trace of `hack --help` shows no multi-second blocking `epoll_pwait`/`futex` attributable to process exit.
