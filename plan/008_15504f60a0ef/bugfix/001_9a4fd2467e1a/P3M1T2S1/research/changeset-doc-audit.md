# Research: P3.M1.T2.S1 — Changeset-level documentation sync

## Scope
This is the **Mode B** changeset-level doc sweep. Mode A (per-file JSDoc) was
done by each implementing subtask. This task updates the high-level overview
docs so they describe the CURRENT behavior, not the pre-bugfix behavior.

## The changeset (5 behavioral changes to document)
Cross-referenced to bug-report sections (h2.1–h2.3) and the implementing subtasks:

| # | Behavior (post-fix) | Source location | Bug-report issue |
|---|---------------------|-----------------|------------------|
| C1 | Delta-session breakdown runs over `delta_prd.md` even when a patched backlog exists. `decomposePRD()` checks `isDelta` BEFORE `hasBacklog`; merges architect-decomposed tasks with patched statuses (modified→Planned, removed→Obsolete). | `src/workflows/prp-pipeline.ts` decomposePRD() (~L1170+) | Issue 1 (h3.0) — P1.M1.T1.S1/S2 |
| C2 | Added requirements are decomposed into tasks in BOTH the delta path (via C1's breakdown over `delta_prd.md`) AND the integrate path (`integrateIntoCurrentSessionResponse`). `patchBacklog` 'added' case is a documented no-op that DELEGATES to the breakdown (not a silent drop). | `src/core/task-patcher.ts` (~L104); `prp-pipeline.ts` integrateIntoCurrentSessionResponse (~L940) | Issue 2 (h3.1) — P1.M2.T1.S1/S2 |
| C3 | `executeBacklog()` aborts (hard fatal) on empty backlog instead of swallowing. | `src/workflows/prp-pipeline.ts` executeBacklog() (~L1486) | Issue 5 (h3.4) — P2.M1.T1.S1/S2 |
| C4 | `ContextScopeSchema` is strict on WRITE (architect output), lenient on READ (`ContextScopeReadSchema`/`BacklogReadSchema` via `readTasksJSON`/`loadSession`). Legacy/hand-edited sessions load without lockout. | `src/core/models.ts` (~L809-904); `src/core/session-utils.ts` readTasksJSON uses `BacklogReadSchema` | Issue 3B (h3.2) — P2.M2.T1.S1/S2 |
| C5 | Bugfix sessions use numbered `bugfix/NNN_<12hexhash>/` iterations via `nextBugfixDir()`, archiving (not overwriting) prior iterations. `#detectInterruptedBugfix()` scans numbered children. | `src/core/session-utils.ts` nextBugfixDir() (~L847); `src/workflows/prp-pipeline.ts` runQACycle (~L1863), detectInterruptedBugfix (~L2046) | Issue 4 (h3.3) — P3.M1.T1.S1/S2/S3/S4 |

## Document inventory (what exists + what needs updating)

### README.md (813 lines)
Stale delta/bugfix references found:
- **L44**: `- **Delta Sessions**: Only re-execute changed tasks when PRDs are updated`
  → Add: added requirements are now decomposed into new tasks.
- **L126**: `**Delta Sessions**: Automatically detect PRD changes and only execute affected tasks`
  → Same augmentation.
- **L205-211 "### Delta Session (PRD Changes)"**: only shows `--mode delta` command.
  → Add a short paragraph: the delta breakdown now runs over `delta_prd.md`, so ADDED
  requirements produce NEW Phase→Milestone→Task→Subtask items (not just re-exec of
  modified tasks). Reference C1/C2.
- **L291 options table**: `--mode` row lists `normal, delta, bug-hunt, validate`.
  → No change needed (modes unchanged).
- **No bugfix-numbering mention** → Add a short note (in the Bug Hunt section ~L216 or a
  new subsection) that each bug-hunt iteration that finds bugs creates
  `bugfix/NNN_hash/`, preserving prior iterations (C5). The session-path shape is now
  `plan/NNN_hash/bugfix/NNN_hash/` (PRD §5.1).

### docs/ARCHITECTURE.md (1048 lines)
- **L84-112 "## Resolved-Document Invariant"**: correct, no change (this landed earlier).
- **L129 "Delta Sessions: Creates linked sessions when PRDs are modified"**: OK.
- **L631-652 "## State Management and Persistence" → "### Session Directory Structure"**:
  shows `002_a1b2c3d4e5f6/ # Delta session` and `parent_session.txt`. Need to ADD the
  numbered bugfix subtree shape: `bugfix/NNN_hash/`.
- **L701-722 "### PRD Hash-Based Change Detection"**: shows delta session creation.
- **L724-755 "### Delta Sessions"**: mermaid diagram + "Old tasks.json is NOT copied /
  Architect will regenerate". **THIS IS THE KEY STALE SECTION.** The diagram note
  "Architect will regenerate" is now TRUE for added requirements (previously unreachable).
  Update the diagram note + add: breakdown input is `delta_prd.md`; patched statuses
  (modified→Planned, removed→Obsolete) are merged with freshly-decomposed added tasks.
  Reflect C1/C2.

### docs/WORKFLOWS.md (1548 lines)
- **L314-354 "### Phase 3: Delta Handling"**: 7-step process currently says:
  "5. Apply patches to backlog via TaskPatcher / 7. Save patched backlog to delta session".
  **STALE**: omits the writeDeltaPRD step AND that decomposePRD later runs the breakdown
  over delta_prd.md and merges. Update to: write `delta_prd.md`, save patched backlog,
  THEN decomposePRD runs over `delta_prd.md` (architect invoked) and merges decomposed
  added-tasks with patched statuses (C1/C2).
- **L355+ "### Phase 4: Backlog Execution"**: entry condition "Backlog available (from
  decomposition or delta)" → add note that empty backlog now HARD-ABORTS (C3, Issue 5).
- **QA Cycle / FixCycleWorkflow section (~L460+)**: currently describes a single flat
  bugfix dir. Update to numbered `bugfix/NNN_hash/` iterations (C5).

### docs/TESTING.md (1079 lines)
- **L29-50 "### 100% Coverage Requirement"**: OK.
- **L54-83 "### Deterministic Testing"**: states "No real file system operations: File I/O
  is mocked". **PARTIALLY STALE**: the file-lock (P3.M1.T2.S1) and tasks-json-recovery
  suites use REAL tmpdir (no fs mock) because O_EXCL / real I/O is untestable against mocks.
  Update to reflect BOTH patterns coexist (module-mocked for pure logic; real-tmpdir for
  fs/concurrency semantics).
- **L432-517 "### Groundswell Agent Mocking Pattern"**: documents the file-contract mock
  pattern. Confirm it matches current (PRP-generator now mocks file-as-contract return
  path — P2.M3.T1.S1).
- Add a note: the suite is GREEN post-changeset (Issue 3A fixed the rotted mocks:
  ResearchTimeoutError re-export, PRP-generator file-contract path, groundswell module
  mock — P2.M3.T1.S1/S2/S3).

## Doc-conventions observed (to follow, not invent)
- H1 page title, `**Status**: Published` / `**Last Updated**: YYYY-MM-DD` / `**Version**`
  header block at top of WORKFLOWS.md, ARCHITECTURE.md, TESTING.md (NOT README.md).
  → Bump `Last Updated` to today (2026-01-25 per the existing file mtimes) and bump
  `Version` patch (e.g. 1.0.0 → 1.0.1) on the 3 docs that get material edits.
- README.md uses `###` subsections under `##` and inline ` ```bash ` blocks for commands.
- ARCHITECTURE.md uses mermaid `sequenceDiagram` blocks for flows — match for the delta
  diagram update.
- Code refs use `path/to/file.ts` inline (no line numbers — they rot). Follow that: describe
  behaviors by function name (decomposePRD, nextBugfixDir, patchBacklog), not line numbers.
- PRD citations as `(PRD §4.3)`, `(PRD §5.1)` — reuse the existing citation style.

## Validation approach for a docs-only task
- `npm run lint` / `npm run typecheck` — N/A (no .ts touched). Must still pass.
- `npm run test:run` — must remain GREEN (docs don't affect tests; this is a guard that
  the implementer didn't accidentally touch source).
- **Manual doc-review gate**: `grep -ni` for each STALE phrase after edits to prove zero
  remaining references to the old (pre-fix) behavior. Concrete greps listed in the PRP.
- Optional: `npx markdownlint` if configured — check `package.json` (none found; skip).

## Pitfalls (Mode B doc-sync specific)
1. ❌ Don't add line numbers to doc prose — they rot. Reference functions/paths only.
2. ❌ Don't describe IMPLEMENTATION details (the merge algorithm, the regex) — docs are
   overview-level; JSDoc (Mode A) already has the details. Keep doc edits behavioral.
3. ❌ Don't bump doc Version major (1.x→2.x) for a bugfix changeset — patch bump only.
4. ❌ Don't touch docs that aren't stale (CONFIGURATION.md, CLI_REFERENCE.md, user-guide.md)
   — scope creep risks conflicts with P6 doc tasks.
5. ❌ Don't duplicate the PRD — cite it (§4.3, §4.4, §5.1) rather than restate.
6. ✅ DO run the "stale-phrase grep" gate after editing — it's the only objective proof
   the old behavior is fully removed from the docs.