# System Context — Bugfix 002 Corrective Changeset

## What this project is
A TypeScript **PRP (Product Requirement Prompt) pipeline** (`src/`) that decomposes a
`PRD.md` into a `Phase > Milestone > Task > Subtask` backlog, then researches + executes
each item via Groundswell LLM agents. It supports **delta sessions**: when the PRD changes
mid-run, it diffs the snapshot vs. the new PRD, patches the backlog, and re-breaks-down the
ADDED requirements through an Architect agent.

The authoritative spec is `PRD.md` (root). `AGENTS.md` governs workflow discipline:
bugfixes that restore intended behavior may be made directly in `src/`/`tests/`
(rule 5); the changes in this bugfix set are all **restoring existing PRD-specified
behavior** (§4.3, §4.4, §5.1), so they are in-scope corrective work, not new features.

## The four bugs (all verified against HEAD `727db29`)
| ID | Severity | One-line | Primary files |
|----|----------|----------|---------------|
| BUG-001 | Critical | ADDED requirements dropped — `mergeBacklogs` skips architect items whose fresh IDs collide | `src/core/backlog-merger.ts`, `src/workflows/prp-pipeline.ts` |
| BUG-002 | Major | COSMETIC/SUBSTANTIVE + CLEAN/DIRTY LLM classifiers are implemented but never called | `src/core/change-classifier.ts`, `src/workflows/prp-pipeline.ts`, `src/core/session-manager.ts` |
| BUG-003 | Major | `[PRP Auto]` banner still prepended; `PRP_COMMIT_FORMAT`/task-prefix (§5.1) unimplemented | `src/utils/git-commit.ts`, `src/config/constants.ts`, `src/core/task-orchestrator.ts`, `src/agents/commit-message-agent.ts` |
| BUG-004 | Major | Test suite red (179 failed / 20 files) → §4.4 validate gate cannot pass | `tests/integration/**` |

## Cross-cutting facts every subtask must respect
- **Type definitions** live in `src/core/models.ts`: `Backlog` (`{ readonly backlog: Phase[] }`),
  `Phase` (id `^P\d+$`), `Milestone` (`^P\d+\.M\d+$`), `Task` (`^P\d+\.M\d+\.T\d+$`),
  `Subtask` (`^P\d+\.M\d+\.T\d+\.S\d+$`). The id-regexes do **not** enforce cross-level
  consistency, so any renumbering MUST keep a descendant's prefix equal to its parent id.
- **Config convention** (`src/config/constants.ts`): env vars follow a triple —
  `NAME` const, `DEFAULT_NAME`, `get<Name>()` getter (reads `process.env[NAME] ?? DEFAULT`,
  validates → falls back to default). String/enum getters: `getValidationAgent` style.
  NO `process.env` reads live outside `constants.ts` getters.
- **LLM invocation**: classifiers use `createQAAgent()` (`src/agents/agent-factory.ts`) →
  Groundswell `Agent.prompt(prompt)`. This requires `PiHarness` initialized
  (`src/config/harness.ts` `ensureHarnessInitialized()`). If the harness is NOT
  initialized when a classifier runs, it throws → the classifier's `retry()` exhausts →
  **protective default** fires (SUBSTANTIVE for change, DIRTY for artifact). This is the
  intended fail-safe and must be preserved.
- **Backlog merge is a pure, synchronous transform** (`mergeBacklogs(patched, architect)`).
  It must remain pure (no I/O, no validation — `SessionManager.saveBacklog` validates on write).
- **Logging**: use `getLogger('<name>')()` from `src/utils/logger.js`; emit `warn` on every
  de-dup/skip so drops are observable (never silent).
- **TDD**: every subtask implies write-failing-test → implement → pass. Several existing
  tests ASSERT THE BUGGY BEHAVIOR and must be corrected as part of the implementing subtask.

## Recommended execution order (dependency rationale)
1. **BUG-001** (Critical, highest value) — `backlog-merger.ts` + `prp-pipeline.ts` merge sites.
2. **BUG-002** — `prp-pipeline.ts` (`initializeSession` detection) + `decomposePRD`. Shares
   `prp-pipeline.ts` with BUG-001, so sequence after it to avoid merge conflicts.
3. **BUG-003** — touches `git-commit.ts`/`constants.ts`/`task-orchestrator.ts`/
   `commit-message-agent.ts`; independent of BUG-001/002, can run parallel but ordered third.
4. **BUG-004** — sweep the **pre-existing** red (not caused by 001–003). Must run AFTER
   001–003 so the final `vitest run` baseline includes their new tests; its "verify green"
   subtask depends on all code-change subtasks.
5. **Docs sync** (Mode B) — last; depends on every implementing subtask.

## Modes A vs B (documentation, per SOW §5)
- **Mode A (rides with the work):** each implementing subtask updates the doc it directly
  touches — e.g. BUG-003's config subtask updates `docs/CONFIGURATION.md`; BUG-002's
  classifier-wiring subtask corrects the misleading JSDoc at `prp-pipeline.ts:~846`.
- **Mode B (final sweep):** the last task updates changeset-level/overview docs
  (`README.md`, `docs/ARCHITECTURE.md` feature sections) that only make sense once the whole
  delta is in place.