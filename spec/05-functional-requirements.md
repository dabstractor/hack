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

**Commit Message Format (Standardized Task-Prefix):**

Smart Commit's `stagecoach` MUST emit commit messages in a standardized, machine-parseable **task-prefix** format that encodes the implementing item's hierarchical position in the backlog, instead of decorating messages with free-form banners or Conventional-Commit scopes:

`<phase>.<milestone>.<task>.<subtask>: <descriptive commit message>`

- **The prefix is the item's 1-indexed position** along its Phase → Milestone → Task → Subtask path. Example: phase 1, milestone 2, task 1, subtask 1 renders as `1.2.1.1: add createDeferredPromise utility and utils barrel`.
- **Elide trailing levels the item does not use.** When the hierarchy terminates at Task (no subtask), the subtask segment is omitted rather than rendered as zero — e.g. `1.2.1: build CLI entry point`. The same elision applies to any unused trailing level, so the prefix is always the shortest string that still identifies the item.
- **The prefix _replaces_, it does not stack with, decoration.** The legacy `[PRP Auto]` banner and Conventional-Commit scope encoding (`feat(P1.M2.T2.S1): …`) MUST NOT be prepended. The task-prefix already encodes the item's position; layering both on top is redundant cruft and is the exact source of the `[PRP Auto] … feat(P…) …` noise in the history. The descriptive message is the LLM-generated summary, kept verbatim — only the decoration is stripped.
- **Non-task commits carry no prefix.** Commits not tied to a backlog item — `initial commit`, the Smart Commit Resilience fallback above (`chore: commit-gen failed (exit N); fallback commit`), out-of-hierarchy toolchain scaffolding — use a plain message with no task-prefix. This guarantees the prefix always unambiguously signals "this commit implements a real backlog item."
- **Bugfix sessions use their own numbering.** A bugfix commit's prefix is taken from the bugfix session's own Phase → Milestone → Task → Subtask decomposition (the bug report is broken down with the same hierarchy as a main session; §4.4), never the parent session's indices, so main-session and bugfix histories stay mutually legible.

**Configurability (`PRP_COMMIT_FORMAT`):** the task-prefix scheme is the default but MUST be opt-out, so a project that prefers a clean, hand-curated history is not forced into machine-generated prefixes:

- `PRP_COMMIT_FORMAT=task-prefix` (default): the standardized `<phase>.<milestone>.<task>.<subtask>: <message>` format above.
- `PRP_COMMIT_FORMAT=plain`: no prefix decoration at all; the commit message is just the descriptive text `stagecoach` produces (or the fallback placeholder). Use when the project wants human-authored messages without machine-generated prefixes.

When `task-prefix` is selected but the commit is not a backlog item (fallback / scaffolding / initial), the formatter MUST degrade to `plain` rather than emit a malformed or zero-filled prefix. Toggling the format affects only newly generated messages; existing history is never rewritten.

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

**Tasks-Not-Yet-Generated Window (Breakdown-in-Progress):**

There is a necessary, legitimate window during §4.1 Initialization & Breakdown in which the Session Manager has already created the session directory (`plan/NNN_hash/`, stamped with `.prd_hash` and friends) but the Architect Agent has not yet finished decomposition and written `tasks.json`. During this window `SESSION_DIR/` exists while `SESSION_DIR/tasks.json` does not. The same absence arises when a breakdown run was interrupted before `tasks.json` was written. This is a normal transient state, not an error.

**Problem.** The `task` / `status` subcommand (and any consumer of the Task File Discovery Priority above) resolves the latest session, derives the `tasks.json` path, prints its `Using main tasks: …` source note, then `readFile(tasksFile)` throws `ENOENT`. Today this surfaces as a scary `ERROR: … Task command failed: ENOENT: no such file or directory, open '…/tasks.json'` complete with a request id and stack trace — implying breakage during what is actually ordinary pre-breakdown progress.

**Requirement.** When a _discovered_ (auto-resolved) tasks file is absent solely because the session directory exists but its `tasks.json` has not been generated yet, the command MUST treat this as the “breakdown-in-progress” state and inform the user instead of erroring:

- **Detection.** After resolving the target session but _before_ parsing, if the resolved tasks file (`SESSION_DIR/tasks.json`, or the bugfix fallback when the discovery priority selects it) does not exist (`ENOENT`) **and the session directory itself does exist**, classify the state as breakdown-in-progress. (When `findLatestSession` returns no session at all, the existing “No sessions found” path applies unchanged — see the acceptance criteria for how the two empty states are distinguished.)
- **Message.** Emit a single, calm, human-readable notice to **stderr** naming the session and explaining that `tasks.json` is generated during PRD breakdown and is not available yet — re-run shortly, or run the pipeline (`hack --continue`) to (re)generate it. This notice **replaces** the `Using main tasks: …` source note for this state (printing both would be self-contradictory). Under `--output json`, emit a structured object instead, e.g. `{ "status": "awaiting_breakdown", "session": "NNN_hash" }`, so scripts get clean stdout.
- **Exit code.** `0`. This is an observation of a valid transient state, not a failure; a non-zero exit would break shell scripts, prompts, and aliases that poll `hack status` while a run warms up.
- **Scope — discovery only.** This graceful behavior applies exclusively to _auto-resolved_ tasks files (the Task File Discovery Priority above). An explicit `--file <path>` override that points at a non-existent file remains a **hard error** — the user asked for a specific file, so a missing one is a real mistake, not a transient state.
- **All discovery-based actions.** `task` (list), `status` (alias), and `task next` MUST all degrade gracefully for this state; in particular `next` reports “no tasks available yet (breakdown in progress)” rather than crashing.
- **Distinct from recovery.** This is the read-only observation path; it MUST NOT trigger the §5.1 `tasks.json` corruption-recovery (that path is for parse/validation failures and git-history restore, keyed off a _present-but-broken_ file) nor the §4.4 interrupted-bugfix-breakdown re-entry (scoped to bugfix children that have a `TEST_RESULTS.md`). A simply-absent `tasks.json` on a read-only `status` query is _reported_, not “repaired.”

**Acceptance criteria.**

- `hack status` run against a session whose directory exists but whose `tasks.json` is absent prints the calm “tasks not generated yet / breakdown in progress” notice naming the session and exits `0` — no `ERROR`, no `ENOENT`, no request id, no stack trace.
- `hack task` and `hack task next` behave identically for the same state.
- `hack status --output json` emits the structured `awaiting_breakdown` object and exits `0`.
- `hack status --file /nonexistent/tasks.json` still exits non-zero with a clear “file not found” error (explicit override is not softened).
- `hack status` with _no_ sessions at all still exits non-zero with the existing “No sessions found” message — the two empty states (“no sessions” vs “session exists, no `tasks.json` yet”) are distinguished, not collapsed.
