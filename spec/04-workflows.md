## 4. User Workflows

### 4.1 Initialization & Breakdown

1.  **Input:** User provides a `PRD.md`.
2.  **State Check:** System hashes the PRD — computed over the **fully-resolved, include-expanded document** (§2.3), not the raw entry file — and checks for existing sessions.
3.  **Architecture Research:** Before planning, an agent explores the codebase to validate feasibility and store findings in `architecture/`.
4.  **Decomposition:** The **Architect Agent** breaks the PRD down into a strict hierarchy (Phase > Milestone > Task > Subtask) stored in a structured format (e.g., JSON).
    - **Baseline `.gitignore` scaffolding:** the decomposition MUST include a first, dependency-root subtask that creates — or, if one exists, **extends (never overwrites)** — a baseline `.gitignore` at the repo root (dependency dirs, build output, OS/IDE cruft) before any feature implementation subtask. Full requirement + rationale: §5.1 "Baseline `.gitignore` (breakdown scaffolding)".

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
    - Must pass 4 levels of "Progressive Validation" defined in the PRP. Gates are re-executed as a batch against the terminal filesystem state and MUST be monotonic; see §9.9.
4.  **Cleanup & Commit (two-phase commit):**
    - **Pre-cleanup commit (survival):** Before the (long, interruptible) cleanup agent runs, the orchestrator commits the item's substance — source changes, its `plan/` work directory, and its `Complete` status — via **Smart Commit** (§5.1). Committing before cleanup guarantees a force-interrupt here can no longer leave an item "Complete on disk but uncommitted," the state that orphans `plan/` directories forever (the cleanup agent is forbidden from touching `plan/`; see §5.1).
    - **Cleanup:** Temporary artifacts are removed; documentation is moved to `docs/`.
    - **State is saved:** `tasks.json` updated.
    - **Post-cleanup commit:** The cleanup agent's documentation reorganization is committed in a second Smart Commit call.

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
