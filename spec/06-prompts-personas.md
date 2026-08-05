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
- **Validation-gate monotonicity (§9.9):** gate commands MUST be monotonic terminal-state assertions. Negative file-existence gates (`! test -f`, `test ! -f`) and create-then-delete cleanup gates are forbidden; express scope boundaries as Success Criteria or `manual` Level-4 gates, and never delete a throwaway artifact during the coder's turn. The executor neutralizes any non-monotonic gate that slips through.
- **Output:** A markdown file adhering to a strict template.
- **Single-PRP default with strict batching gates:** A PRP call writes exactly **ONE** PRP — the one it was asked for — not several batched into one session. Batching is permitted _only_ as an optimization for tightly-coupled items, at a _higher_ bar (not a lower one): before any second PRP is written, the agent must hold the full task-tree and full-PRD context, run 3–5 subagent research calls _per item_ (the research budget is per PRP, so an N-PRP batch needs ~N× the research), pass a per-item "No Prior Knowledge" check, and declare the batch explicitly. **When in doubt, write one.** This prevents the thin, under-researched PRPs that batching produced in the past.

### 6.3 PRP Execution Prompt ("The Builder")

- **Role:** Senior Engineer.
- **Goal:** Execute the PRP contract.
- **Logic:**
  - **CRITICAL:** Read PRP first.
  - **Progressive Validation:** Level 1 (Lint/Type), Level 2 (Unit Test), Level 3 (Integration), Level 4 (Manual/Creative).
  - **Terminal-state re-execution (§9.9):** the executor re-runs every gate as a batch against the final filesystem state after the coder finishes; non-monotonic gates (negative file-existence, cleanup `test ! -f`) are neutralized to skipped.
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
