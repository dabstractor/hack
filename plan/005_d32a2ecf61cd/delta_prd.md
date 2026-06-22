# Delta PRD — Pipeline Resilience & Self-Healing (Session 005)

> **Scope driver:** diff of `plan/004_439241a82c24/prd_snapshot.md` → current `PRD.md`.
> **Diff profile:** purely additive — 37 lines added, **0 removed/modified**. Four
> cohesive feature clusters, all under a single theme: making the execution loop and
> state layer survive hung agents, planning gaps, and `tasks.json` corruption without
> human intervention, plus a doc-sync rule so delta sessions ship coherent docs.
> **Prior session (004):** implemented the **Agent Harness System** (Phase P1, Complete).
> That work is untouched by this delta — see "Completed work NOT affected" below.

## 1. What Changed (Exact Deltas)

| PRD location | Addition | Essence |
| ------------ | -------- | ------- |
| §4.2 (Inner Loop) | "Deadline & Fallback" bullet | Background research is deadline-guarded (`RESEARCH_TIMEOUT`, default 5 min). Orchestrator polls (process liveness + PRP artifact presence) instead of blocking indefinitely; on expiry it abandons the in-flight research and re-researches the item **synchronously, inline**. |
| §4.5 (NEW section) | "Issue-Driven Re-planning Loop" | Coder Agent gains a third outcome `issue` (distinct from `success`/`fail`) = recoverable *planning* gap. Flow: capture feedback → delete stale PRP → reset to `Planned` → re-research with `<issue_feedback>` injected → bounded by `ISSUE_RETRY_MAX` (default 3). |
| §5.1 | "`tasks.json` Protection & Smart Recovery" block | After every agent run, re-read `tasks.json` and re-apply **only** the legitimate status delta. On parse/schema failure, restore last valid version from **git history**, re-applying in-flight changes. Preserve `Researching`/`Ready` status. Non-fatal + logged. |
| §6.1 + §6.4 | "Documentation Sync (two-mode rule)" + Delta "Doc Impact Declaration" | Docs are never a standalone subtask. **Mode A** (`DOCS:` line inside the implementing subtask's `context_scope`) for docs that subtask touches; **Mode B** (a final "Sync changeset-level documentation" task depending on all implementing subtasks) for cross-cutting docs. Delta items must declare their doc impact at authoring time. |
| §9.2.2 | "Resilience Tuning" env vars | `RESEARCH_TIMEOUT` (default 300s) and `ISSUE_RETRY_MAX` (default 3). |
| §9.3.2 | 3 orchestrator bullets | Mirror notes for Research Deadline, Issue-Driven Re-planning, and `tasks.json` Restore. |

**Nothing removed. Nothing in §9.4 (harness), §9.2.4 (safeguard), or session/delta/bug-hunt
logic changed** — Session 004's completed harness work is stable.

---

## 2. Delta Requirements (the only work this session)

### Phase P5 — Pipeline Resilience & Self-Healing

**Theme:** Add self-healing to the execution loop and state layer so a single hung
agent, planning gap, or corrupting agent cannot stall or terminate the pipeline.
No new subsystems — these are enhancements to **existing** orchestrator/state/retry
components (file inventory below). Groundswell is unchanged (external, read-only).

#### P5.M1 — Execution-Loop Resilience (research deadline + issue re-planning + doc-sync rule)

**R1 — Background research deadline & fallback (PRD §4.2, §9.2.2, §9.3.2).**
`src/core/research-queue.ts` (`ResearchQueue`) currently has no timeout. Wrap each
background PRP generation in a deadline read from `RESEARCH_TIMEOUT` (default `300`
seconds). The orchestrator polls for completion (process liveness **and** presence of
the PRP artifact), and on deadline expiry **abandons** the in-flight research and
re-researches the item **synchronously, inline** — it must never block indefinitely.
Wire the env var through `src/config/` (constants + ConfigService normalization,
mirroring how Session 004 added `PRP_AGENT_HARNESS`).
- **DOCS (Mode A):** `docs/CONFIGURATION.md` — document `RESEARCH_TIMEOUT` under the
  env-var reference (default 300s, semantics per §4.2).
- **DOCS (Mode A):** JSDoc on the new deadline/fallback function(s).

**R2 — Issue-driven re-planning loop (PRD §4.5, §9.2.2, §9.3.2).**
Introduce the Coder Agent `issue` outcome — **distinct** from `fail` (implementation
problem → existing fix-and-retry path) and `success`. An `issue` signals a *recoverable
planning gap* (missing context, wrong assumptions, ambiguous requirements).
- Extend the executor result/outcome type to carry `success | fail | issue` plus an
  issue message (`src/agents/prp-executor.ts` currently models `ExecutionResult.success:
  boolean`).
- On `issue`: (1) save the message to `issue_feedback.md` in the session dir; (2) delete
  the offending PRP so it cannot be reused; (3) reset the item to `Planned` (NOT
  `Failed`); (4) re-research with `<issue_feedback>` injected into the PRP-generation
  prompt; (5) bound retries by `ISSUE_RETRY_MAX` (default `3`) before the item hard-fails.
  Wire this into `src/core/task-retry-manager.ts` (existing retry infra) and
  `src/agents/prp-generator.ts` / `src/agents/prompts/prp-blueprint-prompt.ts` (feedback
  injection point). Keep the item's original ID and dependency links; do **not** cancel
  background research on dependents (they simply block until the re-planned item completes).
- **DOCS (Mode A):** `docs/CONFIGURATION.md` — document `ISSUE_RETRY_MAX` (default 3).
- **DOCS (Mode A):** `docs/WORKFLOWS.md` — add an "Issue-driven re-planning" subsection
  describing the `success`/`fail`/`issue` tri-state and the reset→re-research flow.
- **Awareness:** `issue_feedback.md` is covered by the existing catch-all protected rule
  ("Any file directly in `$SESSION_DIR/` root"). No change to the explicit Protected Files
  list is required.

**R3 — Documentation two-mode sync rule (PRD §6.1, §6.4) — prompt/contract change.**
This is primarily a **prompt-engineering** requirement, not new runtime code:
- Update `src/agents/prompts/architect-prompt.ts` (Task Breakdown System Prompt) to encode
  the two-mode rule: Mode A (`DOCS:` line inside the implementing subtask's
  `context_scope`) and Mode B (a final "Sync changeset-level documentation" task depending
  on all implementing subtasks). Docs are never a standalone subtask — mirror the existing
  implicit-TDD rule.
- Update `src/agents/prompts/prp-blueprint-prompt.ts` (Delta PRD Generation / blueprint)
  so each affected item in a delta declares its documentation impact at authoring time
  (a Mode A `DOCS:` line or a Mode B changeset-level note).
- **No standalone docs file to update** — this requirement *is* the doc-sync mechanism.
  (Changeset-level docs for this delta itself are handled by the Mode B requirement at the
  end of §3.)

#### P5.M2 — State Resilience (`tasks.json` protection & smart recovery)

**R4 — `tasks.json` Protection & Smart Recovery (PRD §5.1, §9.3.2).**
Agents corrupt `tasks.json` despite the forbidden-operations rules (§5.2) — truncated
writes, partial edits, schema-invalid mutations. The system must survive this without
human intervention. Enhance `src/core/state-validator.ts` (has validation/repair +
`createBackup`) and `src/core/task-orchestrator.ts` (status persists via
`sessionManager.updateItemStatus`):
- **Re-apply after every agent run:** re-read `tasks.json` and re-apply **only** the
  legitimate status change from that run (the item just implemented or interrupted),
  discarding any other unauthorized mutations.
- **Recover from corruption:** on parse/validation failure, walk **git commit history**
  (prior versions of the file) to locate the last valid JSON, restore it, then re-apply
  in-flight status changes on top. Leverage existing git utilities
  (`src/utils/git-commit.ts`, `src/core/checkpoint-manager.ts` restore infra).
- **Preserve background-research status:** items marked `Researching` or `Ready` by the
  background research queue must survive a restore — not be dropped back to `Planned`.
- **Non-fatal:** a single corrupting agent must never terminate the session. Restore is
  automatic and logged.
- **DOCS (Mode A):** `docs/ARCHITECTURE.md` — document the smart-recovery behavior in the
  state-management section (re-apply legitimate delta, git-history restore, non-fatal).
- **DOCS (Mode A):** JSDoc on the new restore/re-apply functions.

---

## 3. Sync Changeset-Level Documentation (Mode B — depends on all above)

Once R1–R4 land, sync the cross-cutting docs that only make sense as a whole:
- **`README.md`** — if it lists pipeline capabilities/resilience features, add a
  "Self-healing / resilience" blurb covering the research deadline, issue re-planning,
  and `tasks.json` recovery.
- **`docs/WORKFLOWS.md`** — ensure the execution-loop and state-recovery narratives are
  coherent end-to-end (R2/R4 add per-item subsections; this task reconciles them into a
  single "Pipeline Resilience" overview if one is warranted).
- This is a **single final task depending on all implementing subtasks** (per the Mode B
  rule this delta itself introduces in R3).

---

## 4. Completed Work NOT Affected (reference, don't re-implement)

- **Session 004 — Harness System (Phase P1, all Complete).** `src/config/{constants,types,environment}.ts`
  harness constants/types, `configureHarness()`, `qualifyModel()`/`getModel()` provider
  qualification, `HarnessProviderMismatchError`, agent-factory `harness` field, parity
  tests, and `docs/{CONFIGURATION,GROUNDSWELL_GUIDE}.md` harness sections are **stable**.
  New env vars (`RESEARCH_TIMEOUT`, `ISSUE_RETRY_MAX`) should follow the **same config
  patterns** Session 004 established (constants → ConfigService normalization →
  `docs/CONFIGURATION.md`). Do **not** touch harness/provider/parity code.
- **Phases 1–3 (sessions 001–003):** session/task/delta/bug-hunt/fix-cycle logic, protected-
  file rules, nested-execution guard, MCP tools, CLI commands — all unchanged by this diff.

## 5. Leverage Prior Research

- `plan/004_439241a82c24/architecture/implementation_notes.md` §1–§8 — config patterns,
  test-fragility rule (update tests in the **same** subtask as code), validation gates
  (`npm run validate` = lint + format:check + typecheck; `npm run test:run`), Groundswell
  is read-only/yalc-linked, `configureEnvironment()` runs at module load.
- `plan/004_439241a82c24/architecture/system_context.md` §4 — project facts: Node 20+ / TS
  5.2+ / ESM, Vitest + `vi.stubEnv`/`vi.unstubAllEnvs()`, `tests/setup.ts`.
- `plan/004_439241a82c24/architecture/delta_impact.md` §E — confirms session manager,
  task orchestrator, task patcher, prd-differ, fix-cycle workflows, prompts, CLI are
  untouched by Session 004 (this delta *does* touch orchestrator/retry/state/prompts —
  use the file inventory in §2 above, not the Session-004 "NOT changing" list).
- **No new external research needed** — all targets are existing hacky-hack source files
  plus git utilities already in-repo.

## 6. Out of Scope

- Building new harness adapters or changing provider/model resolution (Session 004).
- Changes to delta-detection, task-patching, bug-hunt/fix-cycle, or protected-file rules.
- Modifying `PRD.md` (human-owned, read-only) or Groundswell sources (external dependency).
- The `issue_feedback.md` file is implicitly protected by the existing
  "Any file directly in `$SESSION_DIR/` root" rule — no Protected Files list edit needed.
