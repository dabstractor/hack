# Delta PRD — Session 008

> **Delta from:** `plan/007_8783a1f5e14a/` (Auth & Logging Hardening — §9.6, §9.2.6, §9.2.7; **implemented**).
> **Scope:** Every difference between the session-007 snapshot and the current `PRD.md`. The codebase already implements PRD §1–9.5 plus the three 007 sections; **do not re-implement any of it.**
> **Change size:** ~3,925 words added, ~409 modified/removed, across 12 PRD sections and 15 distinct requirements → this is a **large, multi-domain delta**, organized into five implementation phases plus a final changeset-level documentation phase.

## 0. What Changed (Diff Summary)

| Area | PRD § | Status | Summary |
|---|---|---|---|
| **A. Distributed (multi-file) PRDs** | §2.3, §4.1 | **NEW** | `@path` include directives resolved into one canonical document; hashing/snapshot/selectors/prompts run over the resolved doc |
| **B. Selective PRD section extraction** | §4.2 | **NEW** | Per-subtask `prd_selectors` → Researcher receives only referenced PRD sections |
| **C. Depth-chained parallel research** | §4.2, §9.2.2, §9.3.2 | **MODIFIED** | Single-slot prefetch → chain of `RESEARCH_DEPTH` (default 2); `RESEARCH_TIMEOUT` default 300→1800s; forwarded to bugfix child |
| **D. Two-phase commit** | §4.2 | **MODIFIED** | Pre-cleanup commit (survival) + post-cleanup commit via `stagecoach` |
| **E. `tasks.json` & file integrity** | §5.1 | **MODIFIED/NEW** | Snapshot-before-revert w/ FS evidence; critical-file (`PRD.md`/`PRP.md`) deletion protection; orphaned-`plan/` recovery; smart-commit commit-gen retry+fallback; write concurrency (`flock` + atomic writes) |
| **F. Orchestrator hardening** | §9.3.2, §9.3.3 | **NEW** | Watchdog-kills-terminal (exit 124 hard fail); stateless single-shot invocations (no orphaned sessions); prompt delivery never via argv + temp-file cleanup on hard kill |
| **G. Delta workflow hardening** | §4.3 | **MODIFIED/NEW** | COSMETIC/SUBSTANTIVE + CLEAN/DIRTY LLM classifiers w/ protective default; response selection (`--accept-prd-changes`, integrate-into-current, validate/bug-hunt reuse); breakdown MUST consume `delta_prd.md` |
| **H. Validation & QA hardening** | §4.4, §9.2.2 | **MODIFIED/NEW** | `VALIDATION_AGENT`/`VALIDATION_TIMEOUT`; abort-on-failure; `NO_ISSUES_FOUND.md` marker; standard full breakdown for bugfix (not simplified); resume interrupted bugfix breakdowns |
| **I. Adopt mode** | §4.6 | **NEW** | `--adopt-prd` baseline session for already-shipped codebases |
| **J. Model roles & reasoning budget** | §9.2.3, §6.1, §6.2 | **MODIFIED** | Separate research/reasoning/implementation roles; reasoning steps at max budget (`xhigh`); single-PRP default with strict batching gates |
| **K. Provider-neutral config naming** | §9.2.8 | **NEW (forward)** | `ANTHROPIC_*` → `PRP_*` canonical names; tier rename `opus/sonnet/haiku` → `high/balanced/fast`; legacy aliases retained (forward/deprecated) |
| **L. Task mgmt alias** | §5.3 | **NEW (trivial)** | `prd status` aliased to `prd task` |

**Removed requirements:** none.

**Data-quality note (non-blocking):** the §2.3 "Include directive" bullet in `PRD.md` itself is internally garbled — the `@path/to/file.md` example token was accidentally expanded against itself while the spec was being written. The canonical, surviving sentence is: *"A line of the form `@path/to/file.md` (optional leading whitespace, nothing else) is always expanded; the `@path` token is also honored inline anywhere on a line."* Implement to that intent; do not try to parse the corrupted prefix.

## 1. Phase 1 — Distributed PRD Resolution & Selective Section Extraction (Areas A + B)

**PRD refs:** §2.3 (`h3.2`), §4.1 step 2 (`h3.3`), §4.2 step 2 (`h3.4`). **Dependencies:** none — foundational; everything downstream consumes the resolved document.

### Requirement 1.1 — Include-expansion resolver (§2.3)

Add a resolver that turns a multi-file PRD into one canonical document at load time.

- **Include directive:** a line of the form `@path/to/file.md` (optional leading whitespace, nothing else) is always expanded; the `@path` token is also honored inline anywhere on a line (e.g. a markdown table cell or prose). Expanded inline by the referenced file's contents.
- **Expansion rules:** a token expands only when **both** (1) *boundary* — the `@` is at line start or preceded by a non-path character (`foo@bar.com` and mid-word `@` stay literal), and (2) *existence* — the path resolves to an existing file. Ordinary prose `@mentions` that don't resolve stay verbatim and silent.
- **Resolution base:** project-root-relative (relative to the **entry** PRD's directory, regardless of which file contains the directive), expanded **recursively with cycle detection** up to `PRD_INCLUDE_MAX_DEPTH` (default 10).
- **Idempotency:** re-resolving already-resolved content MUST yield identical bytes (the property that guarantees hash/snapshot consistency).
- **Markers (optional):** when `PRD_INCLUDE_MARKERS` is set, resolved output emits `<!-- @include: path -->` / `<!-- @end-include -->`. A `.md` token that fails to resolve (stale include) MUST emit a stderr warning.

**Existing code to modify:** PRD loading is `SessionManager.initialize()` → `hashPRD(this.prdPath)` (`src/core/session-manager.ts:294`) and `hashPRD` reads the raw file (`src/core/session-utils.ts`). Insert the resolver between "read entry file" and "hash/snapshot" so **all** downstream consumers (§1.2 below) receive resolved bytes.

### Requirement 1.2 — Single canonical document downstream (§2.3, §4.1)

Hashing (§4.1 step 2), `prd_snapshot.md` writes (`writePrdSnapshot`, `src/core/session-utils.ts:721`), delta-PRD inputs, integration/validation/bug-finder prompts, and `prd_selectors`/section indexing ALL operate over the fully-resolved, include-expanded document — never the raw entry file. mdsel/section-indexing runs over a materialized resolved copy.

- **Agent guidance:** any agent prompt that embeds PRD content MUST state the text is already the complete merged document (agents must not chase includes themselves).

### Requirement 1.3 — Selective PRD section extraction (§4.2, Area B) — NEW

Each subtask carries a `prd_selectors` field (e.g. `["h2.1", "h3.0"]`) computed from a generated PRD section index over the **resolved** document. The Researcher receives only the referenced sections instead of the full PRD, keeping its context focused. **Fallback:** when selectors are absent or extraction fails, the full PRD is used.

- No `prd_selectors` / section-index code exists in `src/` today — this is greenfield. The section index already exists as `prd_index.txt` per session (see `plan/008_.../prd_index.txt`); reuse/extend that scheme to compute selectors per subtask at breakdown time and extract at PRP-generation time.

**Mode A docs (ride with the work):** JSDoc on the new resolver + selector-extraction functions; `.env.example` gains `PRD_INCLUDE_MAX_DEPTH` / `PRD_INCLUDE_MARKERS`; `docs/CONFIGURATION.md` gains a "Distributed PRDs" subsection; `docs/ARCHITECTURE.md` notes the resolved-document invariant.

## 2. Phase 2 — Model Roles, Reasoning Budget & Provider-Neutral Configuration (Areas J + K + L)

**PRD refs:** §9.2.3 (`h4.2`), §9.2.8 (`h4.7`), §6.1 (`h3.12`), §6.2 (`h3.13`), §5.3 (`h3.11`). **Dependencies:** none (foundational; Phase 4's `pizr`/`VALIDATION_AGENT` reference this).

### Requirement 2.1 — Separate model roles (§9.2.3, Area J) — MODIFIED

Today `agent-factory.ts` resolves `getModel('sonnet')` for planning/research and `getModel('haiku')` for the coder (`src/agents/agent-factory.ts:175,290`). Generalize to **three roles** so cost/speed/reasoning-depth are independently tunable:

- **Research role (`AGENT`)** — architecture research + PRP creation. Balanced model, normal budget.
- **Reasoning role (`BREAKDOWN_AGENT` / `BUG_FINDER_AGENT` / `VALIDATION_AGENT`)** — decomposition, creative bug discovery, validation. Balanced model but at the **maximum reasoning budget** (extended-thinking `xhigh`).
- **Implementation role (`IMPL_AGENT`)** — PRP execution + post-validation fix. Fast codegen tier.

### Requirement 2.2 — Maximum reasoning budget for decomposition (§6.1) — MODIFIED

Decomposition runs at the **maximum reasoning budget** (`xhigh` equivalent) because synthesizing research into a strict Phase→Milestone→Task→Subtask hierarchy is the most reasoning-intensive step. The "demand write" retry (breakdown output missing/invalid) uses the same budget. Wire this into the Architect agent config (the `pi` harness `--thinking xhigh` lever).

### Requirement 2.3 — Single-PRP default with strict batching gates (§6.2) — MODIFIED

A PRP call writes exactly **ONE** PRP. Batching is permitted only as an optimization for tightly-coupled items at a *higher* bar: before any second PRP, the agent must hold the full task-tree + full-PRD context, run 3–5 subagent research calls *per item*, pass a per-item "No Prior Knowledge" check, and declare the batch explicitly. **When in doubt, write one.** This is a prompt-content change to the PRP Creation Prompt (`src/agents/prompts/prp-blueprint-prompt.ts` / `src/agents/prompts.ts`).

### Requirement 2.4 — Provider-neutral configuration naming (§9.2.8, Area K) — NEW (forward)

Pipeline-global config vars MUST be provider-neutral (`PRP_*` namespace). A vendor name appears ONLY in a variable that is genuinely that vendor-provider's own native credential (`ZAI_API_KEY`, `ANTHROPIC_API_KEY`).

- **Canonical names (legacy alias retained, deprecated):**
  | Canonical | Legacy alias | Purpose | Default |
  |---|---|---|---|
  | `PRP_API_BASE_URL` | `ANTHROPIC_BASE_URL` | provider endpoint (§9.2.4) | z.ai endpoint when provider `zai` |
  | `PRP_MODEL_HIGH` | `ANTHROPIC_DEFAULT_OPUS_MODEL` | highest tier | `glm-5.2` |
  | `PRP_MODEL_BALANCED` | `ANTHROPIC_DEFAULT_SONNET_MODEL` | balanced (research role) | `glm-5.2` |
  | `PRP_MODEL_FAST` | `ANTHROPIC_DEFAULT_HAIKU_MODEL` | fast (impl role) | `glm-5-turbo` |
- **Tier rename:** `opus`→`high`, `sonnet`→`balanced`, `haiku`→`fast`. Touches `MODEL_NAMES`, `MODEL_ENV_VARS`, `getModel(tier)`, the `ModelTier` type, and the agent factory's per-persona tier selection (`src/config/constants.ts:43,65`; `src/agents/agent-factory.ts`). Role→tier mapping unchanged.
- **Backward compatibility:** loader reads **canonical-first with legacy fallback**; emits a one-time deprecation warning naming the canonical replacement. `.env.example` documents only canonical names (legacy in a deprecation note). Provider-native credentials `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` are NOT renamed.
- **Transition clause:** the PRD itself says this is a *forward requirement* — "*Until then, the `ANTHROPIC_*` names remain in effect*." Implement canonical-first-with-fallback so both old and new work; treat full removal as out of scope.

### Requirement 2.5 — `prd status` alias (§5.3, Area L) — trivial

Alias `prd status` to `prd task` for git muscle memory (`git status`/`prd status`). CLI wiring in `src/cli/` command registration.

**Mode A docs:** `.env.example` (canonical names + deprecation note + new vars from other phases); `docs/CONFIGURATION.md` model/auth/endpoint prose → canonical; JSDoc on `getModel`/tier constants. (Provider-neutral doc rewrite is also touched by the §9.2.6 work landed in 007 — reconcile, don't duplicate.)

## 3. Phase 3 — Execution-Loop Resilience & State Integrity (Areas C + D + E + F)

**PRD refs:** §4.2 steps 1 & 4 (`h3.4`), §5.1 (`h3.9`), §9.3.2 (`h4.9`), §9.3.3 (`h4.10`). **Dependencies:** the concurrency task (3.2) depends on the depth-chain task (3.1); everything else builds on the existing `smartCommit` / `tasks-json-recovery` / `ResearchQueue`.

### Milestone 3.A — Inner-Loop Concurrency & Commit Integrity

#### Requirement 3.1 — Depth-chained parallel research (§4.2, Area C) — MODIFIED
Today `ResearchQueue` (`src/core/research-queue.ts`) is a concurrency *pool* (`maxSize`, default 3), not a depth-chained prefetch. Change the driver so a background **supervisor** researches a **chain** of up to `RESEARCH_DEPTH` (default 2) items ahead, prefetching the next as the orchestrator consumes each completed PRP. This collapses both failure modes of single-slot prefetch: "fast implementer → stall waiting for N+1" and "slow implementer → wasted idle capacity."

- **Deadline:** each generation is guarded by `RESEARCH_TIMEOUT` — change default **300 → 1800s (30 min)** in `DEFAULT_RESEARCH_TIMEOUT_SECONDS` (`src/config/constants.ts:198`) and the doc. A grace period precedes the heartbeat so legitimately long research isn't flagged; the deadline still fails fast on a genuinely stuck supervisor.
- **Propagation to bugfix child:** when bug hunting spawns a bugfix sub-pipeline (§4.4), `PARALLEL_RESEARCH` and `RESEARCH_DEPTH` MUST be forwarded to the child — all real item execution (and therefore all prefetching) happens inside the bugfix child. Add `PARALLEL_RESEARCH` (CLI `-r`/`--parallel-research`, default `false`) and `RESEARCH_DEPTH` (default 2) env vars.

#### Requirement 3.2 — `tasks.json` write concurrency (lost-update prevention) (§5.1) — NEW
Two callers write `tasks.json` concurrently: the foreground executor (`Implementing`/`Complete`) and the background research supervisor (`Researching`/`Ready` for depth-chained items). Their read-modify-write cycles interleave and the losing interleave clobbers a status back.

- **Process-level mutual exclusion:** every read-modify-write of `tasks.json` serialized under an exclusive lock (e.g. `flock` on a sibling lockfile), safe under recursion and the backgrounded supervisor. Orchestrator status writes and the restore/recovery path share one locked accessor.
- **Atomic writes:** write to a temp file then `rename` onto the target (atomic on the same filesystem) so concurrent readers never see a half-written file and a crash mid-write cannot corrupt it. (Atomic writes make each writer crash-safe; mutual exclusion prevents lost updates.)

#### Requirement 3.3 — Two-phase commit (§4.2, Area D) — MODIFIED
Replace the single end-of-item commit with a two-phase commit around the cleanup agent:

- **Pre-cleanup commit (survival):** before the long, interruptible cleanup agent runs, the orchestrator commits the item's substance — source changes, its `plan/` work directory, and its `Complete` status — via the Smart Commit tool (`stagecoach`). This guarantees a force-interrupt here can no longer leave an item "Complete on disk but uncommitted" (the orphaning state; cleanup is forbidden from touching `plan/`, §5.1).
- **Cleanup:** temporary artifacts removed; docs moved to `docs/`; `tasks.json` saved.
- **Post-cleanup commit:** the cleanup agent's doc reorganization is committed in a second `stagecoach` call.

`smartCommit` (`src/utils/git-commit.ts:131`) is currently single-phase and takes a pre-formatted message; it must gain the `stagecoach` LLM commit-message-generation delegation + the two call sites.

#### Requirement 3.4 — Smart Commit resilience (§5.1) — NEW
`stagecoach` commit-message generation is one-shot and transient-API-sensitive (a generation timeout is LLM-API slowness, not a stuck subprocess; the index is left untouched + lock released on rescue) → it **should** be retried:

- **Bounded retry w/ backoff:** up to `COMMIT_RETRY_MAX` (default 5), exponential backoff `COMMIT_RETRY_DELAY` (default 10s, doubling, capped 120s).
- **Last-resort fallback:** if still failing, the staged work MUST NOT be stranded — fall back to a plain `git commit` with a labeled placeholder (`chore: commit-gen failed (exit N); fallback commit`).
- **Distinct from agent-subprocess timeouts:** a watchdog kill (exit 124) on a research/implementation/validation call MUST NOT be retried (a hung subprocess re-hangs); a generation timeout on the *commit* call MUST be retried. The two sources are treated differently by design (see also 3.6).

### Milestone 3.B — Crash, Deletion & Prompt Safety

#### Requirement 3.5 — Restore snapshot-before-revert with FS evidence (§5.1) — MODIFIED
`tasks-json-recovery.ts` currently preserves `Researching`/`Retrying` items by mutating only the target item (PATH A/B), and the code comment notes "There is NO `Ready` status." Change to: snapshot the live `Researching`/`Ready` item IDs from the **working-tree `tasks.json` before** the git revert, then re-apply afterward **gated on filesystem evidence** — an item is set back to `Ready` only if its `PRP.md` exists, and to `Researching` only if its `research/` directory exists. Must not depend on an in-memory index that drifts. (This may require introducing/clarifying the `Ready` status if not present.)

#### Requirement 3.6 — Watchdog kills are terminal (§9.3.2) — NEW
Retry loops (the bash `run_with_retry` / `run_with_retry_stdin` and their Groundswell equivalents) MUST treat a watchdog kill (exit 124) as a hard failure — a hung process will simply re-hang, so churning retries is wrong. Applies to validation under `VALIDATION_TIMEOUT` (Phase 4): a watchdog-killed validation aborts the run and is not retried. Wire this distinction into `src/utils/retry.ts`.

#### Requirement 3.7 — Stateless single-shot invocations (§9.3.2) — NEW
Agent calls that are stateless by nature (cleanup, mid-session task update, validation, post-validation fix, bug-finder, per-item PRP execution) MUST NOT create or resume sessions. They are single-shot or operate on freshly-built prompts; enabling session persistence only creates orphaned sessions (the bash equivalent is the `--no-session` flag). Audit agent-creation call sites in `src/agents/` and disable session persistence for these personas.

#### Requirement 3.8 — Critical-file deletion protection (§5.1) — NEW
The bug finder, validation fixer, and especially the cleanup agent sometimes delete `PRD.md` and `**/PRP.md`. Because Smart Commit stages with `git add -A`, any such deletion would be committed permanently. Two layers, mirroring `tasks.json` recovery:

- **Prompt layer:** every deletion-capable agent prompt (cleanup, bug hunter, bug-fix breakdown, post-validation fix) forbids `rm`/`git rm`/`git clean`/`mv` against `PRD.md`, any `PRP.md`, or anything under `plan/`, and forbids treating pipeline-state files as "temporary."
- **Mechanical layer (`restore_critical_files`):** invoked from Smart Commit right after staging, it detects staged *deletions* of `PRD.md`/`PRP.md` (`git diff --cached --diff-filter=D`) and undoes them — restoring from `HEAD` when it existed there, or unstaging when created-and-deleted in the same run. Guarantees `PRD.md`/`PRP.md` survive every commit.

#### Requirement 3.9 — Orphaned-`plan/` recovery (§5.1) — NEW
A force-interrupted prior run can leave an item "Complete" in the working tree but never committed, stranding its `plan/` dir + status. Two guards:

- **Skip-recovery:** on the Completed-skip path, the orchestrator checks the item's status in *HEAD's* `tasks.json` (not the working tree); if HEAD doesn't also record it Complete, run Smart Commit immediately to persist the stranded `plan/` dir + status.
- **Pre-cleanup commit:** (3.3) — committing before cleanup means an interrupt during cleanup can no longer produce the orphaning state.

#### Requirement 3.10 — Prompt delivery (no argv-size limit) (§9.3.3) — NEW
Prompts that embed the full PRD can exceed 128 KB and MUST be delivered as a programmatic message body (stdin/stream), never as an argv string — argv is capped by the kernel's `MAX_ARG_STRLEN` (131,072 bytes) and fails with a hard `E2BIG` no wrapper can recover from. (The `pi` harness already uses `session.prompt(request.prompt)` programmatically, so the main path is fine — this is a defensive guard + audit that no agent invocation shells out with the prompt as an argument.) Any temp files backing prompts MUST be cleaned up on **both** graceful and hard-killed (SIGTERM/SIGKILL/power-loss) exits; when a temp file backs a retry loop it MUST be (re-)written on **every** attempt.

**Mode A docs:** `.env.example` gains `PARALLEL_RESEARCH`, `RESEARCH_DEPTH`, `COMMIT_RETRY_MAX`, `COMMIT_RETRY_DELAY`, `VALIDATION_*` (Phase 4); `docs/CONFIGURATION.md` research/commit/resilience prose; JSDoc on `smartCommit`, `recoverTasksJson`, `restore_critical_files`, the locked accessor, and the depth-chained supervisor.

## 4. Phase 4 — Delta Workflow & QA Hardening (Areas G + H)

**PRD refs:** §4.3 (`h3.5`), §4.4 (`h3.6`), §9.2.2 (`h4.1`). **Dependencies:** soft dep on Phase 2 (the `pizr` reasoning agent / `VALIDATION_AGENT` defaults).

### Requirement 4.1 — Change classification (§4.3) — NEW
Detected changes are classified by an **LLM-driven binary classifier** as **COSMETIC** (trivial: whitespace/formatting) or **SUBSTANTIVE** (semantically significant). A parallel **CLEAN/DIRTY** classifier guards generated artifacts (e.g. the delta PRD). Both MUST distinguish **transient API failures** (empty output, connection errors, rate limits, overloaded) from invalid model responses, retrying up to a bounded count (default 4) before giving up; on exhaustion they MUST fail to the **protective/conservative default** (treat as SUBSTANTIVE / DIRTY) — never silently fall through to "could not classify" and proceed unprotected through a SUBSTANTIVE change. (`prd-differ.ts` does structural diffing + `hasSignificantChanges` today; add the LLM classifier layer on top.)

### Requirement 4.2 — Response selection for mid-session changes (§4.3) — NEW
When a change is detected on an active session, the user selects how to handle it:

- **Delta session** (default, steps 3–7).
- **Integrate into current session:** fold new requirements into the running session's task hierarchy. **The original `prd_snapshot.md` MUST be preserved until *after* integration succeeds** (the integration agent diffs the original snapshot against the current PRD; PRD-change detection itself hashes `prd_snapshot.md` as baseline). Refreshing the snapshot at integration time erases the diff and silently swallows unapplied changes; refresh only once integration has applied.
- **`--accept-prd-changes`:** accept PRD edits as the new baseline *without* a delta session (docs/refinements reflecting already-finished work). Across all `PRD_CHANGED_*` states it cancels any queued `.pending_delta_hash`, refreshes `prd_snapshot.md` to the current PRD, and exits/resumes idempotently.
- **Validate/bug-hunt re-runs reuse the completed session:** in `--validate`/`--bug-hunt` mode against an already-completed session with a pending change, MUST reuse the latest completed session (an empty delta has no `tasks.json` and would make the gates bail). The change is left pending so the next normal run processes it.

### Requirement 4.3 — Breakdown MUST consume the delta PRD (§4.3) — NEW
Delta-session task breakdown MUST run over `delta_prd.md` (the diffs), *not* the full PRD. Building the breakdown prompt once at load time risks embedding the full PRD and silently ignoring the delta; the breakdown input MUST be (re)bound to the delta content *after* `delta_prd.md` is generated.

### Requirement 4.4 — Validation control + abort-on-failure (§4.4, §9.2.2) — NEW
Validation generates a custom `validate.sh` from PRD + codebase tools, **then runs it**. It runs on a dedicated **`VALIDATION_AGENT`** (reasoning-tier, default `pizr`; §9.2.3) under its own watchdog budget **`VALIDATION_TIMEOUT`** (default 7200s / 2h — validation legitimately runs full suites), overriding the generic agent timeout for this call only.

- **Abort-on-failure:** if validation does not finish (non-zero exit), the run MUST abort *before* cleanup, commit, and bug-hunt. A watchdog-killed validation is a hard failure, never retried (§9.3.2, Req 3.6).

### Requirement 4.5 — `BUG_FINDER_AGENT` default → `pizr` (§4.4, §9.2.2) — MODIFIED
`BUG_FINDER_AGENT` default changes `glp` → `pizr` (reasoning-tier). The QA Agent is the reasoning persona at max budget.

### Requirement 4.6 — `NO_ISSUES_FOUND.md` marker (§4.4) — NEW
When the bug finder reports *no* bugs, the bugfix directory MUST record a `NO_ISSUES_FOUND.md` marker (timestamp, session tested, a `tasks.json` hash so a stale marker is obvious once the task set changes, and the bug-finder agent). Distinguishes "already hunted clean" from "never hunted." Removed if a later hunt *does* find bugs (the directory always reflects the latest result); a clean result is persisted/committed like a real bug report. Bugfix session structure gains `NO_ISSUES_FOUND.md` (on a clean hunt). (`bug-hunt-workflow.ts` writes `TEST_RESULTS.md` at `src/workflows/bug-hunt-workflow.ts:438`; add the marker path.)

### Requirement 4.7 — Standard full breakdown for bugfix + resume interrupted breakdowns (§4.4) — MODIFIED
Bug-fix treats `TEST_RESULTS.md` as a mini-PRD and runs the **standard full task breakdown** (the same Phase→Milestone→Task→Subtask decomposition as a main session) — there is no separate "simplified" bug-fix breakdown mode; cleanup runs for bug-fix sessions as for main sessions.

- **Resume interrupted breakdowns:** if a recursive bug-fix run is killed *between* committing the bug report and finishing breakdown, the bugfix session has `TEST_RESULTS.md` but no `tasks.json`. The pipeline MUST auto-detect this (report present, `tasks.json` missing/empty/corrupt) and re-enter on the same path the bug-hunt stage uses when it first finds bugs, regenerating the missing `tasks.json`. Skipped in `--validate`/`--skip-bug-finding` and suppressed inside bug-fix children (no re-entry loop).

**Mode A docs:** `.env.example` gains `VALIDATION_AGENT`/`VALIDATION_TIMEOUT`, updates `BUG_FINDER_AGENT` default; `docs/CONFIGURATION.md` delta/validation/QA prose; JSDoc on the classifiers, response-selection handlers, and the `NO_ISSUES_FOUND.md` writer.

## 5. Phase 5 — Adopt Mode (Area I)

**PRD refs:** §4.6 (`h3.8`). **Dependencies:** none (independent user-facing feature).

### Requirement 5.1 — `--adopt-prd` baseline adoption (§4.6) — NEW
On a **fresh project** (no `plan/` sessions yet), `--adopt-prd` declares the PRD the source of truth for an already-shipped codebase without wasting a breakdown + implementation pass:

1. Creates a baseline session and stamps it with an `.adopted` marker.
2. Seeds a single completed `tasks.json` (one Phase → Milestone → Task → "Adopt existing codebase" Subtask, all `Complete`) **with no breakdown and no agent tokens**, so `is_session_complete` is true and this session becomes the idempotent baseline that future deltas diff against.
3. Sets `SKIP_EXECUTION_LOOP=true`: implementation skipped, but **validation + bug hunt still run** against the real codebase + PRD.

The next `PRD.md` edit produces a normal delta session, so deltas drive ongoing development from the adopted baseline.

**Guard rails:**
- `--adopt-prd` **requires** the PRD to exist; a missing PRD MUST exit loudly rather than scribbling session files near the filesystem root.
- Applies **only to fresh projects**; if sessions already exist the flag is a no-op misuse (warn and proceed with normal session resolution).
- A hard guard MUST reject an empty `SESSION_DIR` before breakdown/validation so collapsed root paths can never be written; session creation MUST `mkdir -p "$PLAN_DIR"` first so the session path is always nested under it.

No adopt code exists in `src/` today (greenfield CLI flag + session-seeding path in `src/cli/` and `src/core/session-manager.ts`).

**Mode A docs:** `docs/CLI_REFERENCE.md` + `README.md` gain the `--adopt-prd` flag; `docs/CONFIGURATION.md` notes the adopt lifecycle.

## 6. Phase 6 — Sync Changeset-Level Documentation (Mode B)

Cross-cutting docs that only make sense once the whole delta lands. Runs LAST; depends on every implementing subtask. Per-file Mode A docs (`.env.example`, `docs/CONFIGURATION.md`, `docs/INSTALLATION.md`, JSDoc) ride with their implementing subtasks and are NOT duplicated here.

### Requirement 6.1 — Changeset-level doc sweep

- **`README.md`:** add the distributed-PRD feature, the `--adopt-prd` / `--accept-prd-changes` / `--validate` / `--bug-hunt` flags, the canonical (`PRP_*`) config names (with the `ANTHROPIC_*` deprecation note), the depth-chained research + two-phase commit + integrity-protection behavior, and the `prd status` alias. Reconcile with the §9.2.6 auth rewrite landed in 007.
- **`docs/ARCHITECTURE.md`:** refresh top-level capability framing for the resolved-document invariant (§2.3), the three model roles + reasoning budget, the two-phase commit + integrity protections, and the adopt mode. Ensure no stale "single-slot prefetch" / "simplified bug-fix breakdown" framing remains.
- **`docs/CONFIGURATION.md`:** the canonical reference for all new/renamed env vars; legacy names appear only in a deprecation table.

## 7. Dependency Graph & Ordering

```
Phase 1 (Distributed PRD)  ──┐
Phase 2 (Model roles/naming)─┤── both foundational, parallel-safe
                             │
Phase 3 (Exec-loop integrity)│── 3.2 deps 3.1; 3.5 deps existing recovery; else independent
Phase 4 (Delta & QA)  ◀──── soft dep on Phase 2 (pizr / VALIDATION_AGENT)
Phase 5 (Adopt mode)  ─────── independent
Phase 6 (Mode B docs) ◀──── depends on ALL implementing subtasks
```

Recommended shippable order: **2 → 1 → 3 → 4 → 5 → 6** (Phase 2 first so the `pizr`/role identity Phase 4 references is real; Phase 1 next so the resolved-document invariant is in place before integrity work that touches snapshot/hash paths). Phases 1, 2, 5 are mutually independent and may be parallelized.

## 8. Acceptance Criteria (cross-phase)

- A multi-file PRD with `@includes` hashes/snapshots identically to its manually-merged equivalent; re-resolving is byte-identical (idempotency). Subtask `prd_selectors` extract only the referenced sections, falling back to full PRD.
- `MODEL_NAMES`/`MODEL_ENV_VARS` use `high/balanced/fast` tiers; `getModel()` reads `PRP_MODEL_*` canonical-first with `ANTHROPIC_*` legacy fallback + deprecation warning. Decomposition/bug-finder/validation run at `xhigh`.
- Background research prefetches a `RESEARCH_DEPTH`-chain; `RESEARCH_TIMEOUT` default is 1800s; settings forwarded to bugfix children. `tasks.json` writes are `flock`-serialized + atomic.
- Every item commit is two-phase (pre/post cleanup via `stagecoach`); commit-gen retries up to `COMMIT_RETRY_MAX` then falls back to a placeholder commit. `PRD.md`/`PRP.md` survive every commit (deletions undone). Orphaned-`plan/` is recovered on the skip path.
- Watchdog-killed validation (exit 124) aborts and is not retried; stateless personas create no sessions; no prompt is passed via argv.
- Change classification fails protective (SUBSTANTIVE/DIRTY) on exhaustion; `--accept-prd-changes`/integrate/validate-reuse paths behave per §4.3; `NO_ISSUES_FOUND.md` is written/committed on a clean hunt; bugfix uses the standard full breakdown and resumes interrupted breakdowns.
- `--adopt-prd` on a fresh project seeds a complete baseline, skips execution, runs validation+bug-hunt; guard rails reject missing PRD / existing sessions / empty `SESSION_DIR`.
- `prd status` == `prd task`. `.env.example`, `README.md`, `docs/CONFIGURATION.md`, `docs/ARCHITECTURE.md`, `docs/CLI_REFERENCE.md` reflect all of the above; legacy names appear only in deprecation notes.

## 9. Out of Scope

- Full **removal** of legacy `ANTHROPIC_*` config aliases (§9.2.8 transition clause — canonical-first-with-fallback only).
- Re-implementing anything from PRD §1–9.5 or the three §9.6/§9.2.6/§9.2.7 sections landed in session 007.
- Any feature not present in the diff above.