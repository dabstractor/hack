# Doc-Surface Audit — P1.M5.T1.S1 (Mode B sweep)

> Per SOW §5 Mode B: ONLY cross-cutting overview docs. Per-file/touched docs
> (CONFIGURATION.md, JSDocs) were already updated Mode A by the implementing
> subtasks. This audit records exactly what each overview doc says TODAY and
> what the shipped changeset delta requires.

## The shipped changeset (Bugfix 002) — three behaviors to surface
| Behavior | Source (verified in `src/`) | What it means for docs |
|---|---|---|
| **BUG-001 renumber-on-collision merge** | `src/core/backlog-merger.ts` renumber helpers + 3 append points (was skip-on-collision) | delta sessions PRESERVE added requirements even when the architect's fresh-from-`P1` IDs collide with the patched ID space — IDs are renumbered to unique, hierarchy-consistent values instead of dropped |
| **BUG-002 classifier wiring** | `src/workflows/prp-pipeline.ts` `initializeSession` (COSMETIC→absorb, SUBSTANTIVE→delta) + `decomposePRD` (DIRTY artifact guard) | COSMETIC PRD changes are absorbed (snapshot refresh) WITHOUT spawning a delta session; a DIRTY `delta_prd.md` aborts breakdown |
| **BUG-003 task-prefix commit format** | `src/utils/git-commit.ts` `formatCommitMessage`/`buildTaskPrefix`/`parseItemPosition`; `src/config/constants.ts` `getPrpCommitFormat` | commit history NO LONGER carries `[PRP Auto]`; task-prefix `<p>.<m>.<t>.<s>:` default, `PRP_COMMIT_FORMAT=plain` opt-out, `Co-Authored-By` trailer PRESERVED |

## Verified implementation facts (read directly — docs must match these)
- `getPrpCommitFormat()` → `'task-prefix'` (DEFAULT) | `'plain'` (opt-out). ANY other/empty value → `task-prefix` (`constants.ts:760`).
- `formatCommitMessage(msg, position?)`: strips stray `[PRP Auto]` banner; task-prefix + position → `<prefix>: <subject>`; plain/no-position → bare subject; ALWAYS appends `\n\nCo-Authored-By: Claude <noreply@anthropic.com>` (preserved, NOT removed); NEVER emits `[PRP Auto]` (`git-commit.ts:214-226`).
- `buildTaskPrefix({1,2,1,1})` → `1.2.1.1`; `{1,2,1}` → `1.2.1` (trailing-level ELISION).
- Non-backlog commits (cleanup, bug-hunt, initial) carry NO prefix (degrade to plain).

## Doc surface inventory (current state + required edit)

### README.md — env-var + feature sections (MUST edit)
- **`[PRP Auto]` hits:** ZERO (grep). ✅ Nothing to remove. Executor re-verifies.
- **Env-var table (`README.md:320-334`, "Environment Variables"):** does NOT list `PRP_COMMIT_FORMAT`. → ADD a curated row (task-prefix default / plain opt-out), linking to `docs/CONFIGURATION.md#resilience-tuning`. (Table is a curated SUBSET — do not dump every var; follow existing row density.)
- **Delta Session (`README.md:205-217`):** says added→decomposed, modified→Planned, removed→Obsolete; does NOT mention (a) renumber-merge preserving added reqs on ID collision, (b) COSMETIC skip. → ADD 1-2 lines: COSMETIC changes are absorbed without a delta session (classifier); added reqs survive ID collisions via renumber-merge.
- **Self-Healing (`README.md:164`):** already mentions classifier retry + protective default (accurate). Does NOT say COSMETIC→absorb/skip-delta. → Optional light touch: keep accurate; do not duplicate CONFIGURATION.md.

### docs/ARCHITECTURE.md — delta/change-detection/commit flow (MUST edit)
- **Change Detection (`docs/ARCHITECTURE.md:714-737`):** describes PURE SHA-256 hash compare; line 736 "Modified PRD → Create delta session with parent reference" is now INACCURATE. → ADD: a SUBSTANTIVE modification creates a delta session; a COSMETIC one is absorbed (snapshot refresh) without one (classifier). Link to CONFIGURATION.md.
- **Delta Sessions (`docs/ARCHITECTURE.md:738-784`):** prose references "Issue 1/2" + `hasBacklog` gate fix from an EARLIER changeset, but does NOT mention the renumber-on-collision merge from THIS changeset. → ADD a line: architect IDs are renumbered against the patched ID space on collision (no added requirement is dropped). Keep it accurate to what shipped.
- **Two-Phase Commit (`docs/ARCHITECTURE.md:838-843`):** describes stagecoach/smartCommit but NOT the task-prefix format. → ADD one line: commit subjects use the `<p>.<m>.<t>.<s>:` task-prefix (`PRP_COMMIT_FORMAT`, default) — no `[PRP Auto]` banner; link to CONFIGURATION.md for the flag.

### docs/WORKFLOWS.md — delta/change-detection workflow (MUST edit)
- **Phase 3: Delta Handling (`docs/WORKFLOWS.md:314-348`):**
  - Entry conditions say "PRD hash changed". → ADD: a hash change first passes the COSMETIC/SUBSTANTIVE classifier; COSMETIC is absorbed without a delta session.
  - Process step 8 (merge): does not mention renumber-on-collision. → ADD a clause: architect items whose fresh IDs collide are renumbered-and-appended (never dropped).
  - Does not mention the CLEAN/DIRTY artifact guard around `delta_prd.md` consumption. → ADD one bullet: `decomposePRD` classifies `delta_prd.md`; a DIRTY artifact aborts breakdown.
- **Delta Session Flow mermaid (`docs/WORKFLOWS.md:612-630`):** flowchart starts "PRD Changed" → straight to delta. → Optional: leave the mermaid (it documents the delta path once entered, which is still accurate). Prefer prose edit in Phase 3 over restructuring the diagram.

### docs/CONFIGURATION.md (DO NOT EDIT — Mode A done, LINK to it)
- `PRP_COMMIT_FORMAT` (line 165) and `CLASSIFIER_RETRY_MAX` (line 164) already documented under `### Resilience Tuning` (line 151). All cross-cutting doc edits LINK here (anchor: `#resilience-tuning`) instead of duplicating per-flag detail.

## Scope guardrails
- Mode B = overview docs only. Do NOT touch per-file/Mode-A docs (CONFIGURATION.md, JSDocs in prp-pipeline.ts/backlog-merger.ts/git-commit.ts) — already done.
- Do NOT duplicate per-flag detail; LINK to CONFIGURATION.md.
- If a doc already matches the shipped behavior, LEAVE IT (no churn).
- Keep edits ACCURATE to what was actually implemented (verified facts above).

## Validation
- `grep -rn "\[PRP Auto\]" README.md docs/ARCHITECTURE.md docs/WORKFLOWS.md` → ZERO (no stale banner in user-facing docs).
- `npx markdownlint-cli2 README.md docs/ARCHITECTURE.md docs/WORKFLOWS.md` (project has .markdownlint.json) and/or `npx prettier --check`.
- Manual: each edited section reads accurately; PRD § refs correct (§4.3 delta/classifier, §5.1 commit format).