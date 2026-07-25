# PRP — P3.M1.T2.S1: Update README.md and docs/ARCHITECTURE.md for delta workflow and bugfix numbering

---

## Goal

**Feature Goal**: Sync the **high-level overview documentation** (README.md,
docs/ARCHITECTURE.md, docs/WORKFLOWS.md, docs/TESTING.md) to the bugfix
changeset so the docs describe the CURRENT behavior and contain **zero stale
references** to the five pre-fix behaviors. This is the **Mode B**
changeset-level doc sweep — Mode A (per-file JSDoc) was already done by each
implementing subtask; this task updates only the cross-cutting overview docs.

The five changeset behaviors (cross-referenced to bug-report h2.1–h2.3 and the
implementing subtasks) that MUST be reflected:

| # | Behavior (post-fix) | Bug issue | Implementing subtask |
|---|---------------------|-----------|----------------------|
| **C1** | Delta-session breakdown runs over `delta_prd.md` even when a patched backlog exists; `decomposePRD()` checks `isDelta` BEFORE `hasBacklog` and merges architect-decomposed tasks with patched statuses (modified→Planned, removed→Obsolete). | Issue 1 (h3.0) | P1.M1.T1.S1/S2 |
| **C2** | Added requirements are decomposed into tasks in BOTH the delta path (via C1) AND the integrate path (`integrateIntoCurrentSessionResponse`); `patchBacklog` 'added' case is a documented **no-op that delegates** to the breakdown (NOT a silent drop). | Issue 2 (h3.1) | P1.M2.T1.S1/S2 |
| **C3** | `executeBacklog()` HARD-ABORTS (fatal) on empty backlog instead of swallowing. | Issue 5 (h3.4) | P2.M1.T1.S1/S2 |
| **C4** | `ContextScopeSchema` is strict on WRITE (architect output) but **lenient on READ** (`ContextScopeReadSchema`/`BacklogReadSchema`); legacy/hand-edited sessions load without lockout. | Issue 3B (h3.2) | P2.M2.T1.S1/S2 |
| **C5** | Bugfix sessions use numbered `bugfix/NNN_<12hexhash>/` iterations via `nextBugfixDir()`, ARCHIVING (not overwriting) prior iterations; `#detectInterruptedBugfix()` scans numbered children. | Issue 4 (h3.3) | P3.M1.T1.S1/S2/S3/S4 |

**Deliverable** (4 doc files, **MODIFY only** — no new files, no source changes):
1. **`README.md`** — UPDATE delta-session feature blurbs (L44, L126,
   "### Delta Session (PRD Changes)" L205-211) to state that ADDED requirements
   are now decomposed into new tasks (C1/C2). ADD a short note that each
   bug-hunt iteration creates `bugfix/NNN_hash/`, preserving prior iterations
   (C5); session path is now `plan/NNN_hash/bugfix/NNN_hash/` (PRD §5.1).
2. **`docs/ARCHITECTURE.md`** — UPDATE "### Delta Sessions" (L724-755):
   rewrite the stale mermaid note ("Architect will regenerate" was previously
   unreachable) + add that the breakdown input is `delta_prd.md` and patched
   statuses merge with decomposed added-tasks (C1/C2). UPDATE "### Session
   Directory Structure" (L631-652) to show the numbered `bugfix/NNN_hash/`
   subtree (C5).
3. **`docs/WORKFLOWS.md`** — UPDATE "### Phase 3: Delta Handling" (L314-354):
   add the `writeDeltaPRD` step + that `decomposePRD` later runs the architect
   over `delta_prd.md` and merges (C1/C2). UPDATE "### Phase 4: Backlog
   Execution" entry condition: empty backlog HARD-ABORTS (C3). UPDATE the
   QA/`FixCycleWorkflow` section (~L460+): numbered `bugfix/NNN_hash/`
   iterations (C5).
4. **`docs/TESTING.md`** — UPDATE "### Deterministic Testing" (L54-83): the
   suite now has TWO coexisting patterns — module-mocked (pure logic) AND
   real-tmpdir (fs/concurrency semantics, e.g. file-lock + recovery suites);
   state the suite is GREEN post-changeset (C4 + Issue 3A's mock fixes —
   P2.M3.T1.S1/S2/S3). Confirm "### Groundswell Agent Mocking Pattern" reflects
   the file-contract return path.

**Success Definition**:
- After edits, each of the 6 known stale phrases returns **0 hits** (verified by
  the grep gate in Validation Level 2):
  `grep -c "only execute changed tasks" README.md` == 0 (or the phrase is
  rewritten to also mention added-requirement decomposition),
  `grep -c "Architect will regenerate" docs/ARCHITECTURE.md` == 0,
  `grep -c "Old tasks.json is NOT copied" docs/ARCHITECTURE.md` == 0,
  `grep -c "Save patched backlog to delta session" docs/WORKFLOWS.md` == 0
  (rewritten to include the writeDeltaPRD + decompose-over-delta_prd.md steps),
  `grep -c "No real file system operations" docs/TESTING.md` == 0 (rewritten to
  describe the dual mock/real-tmpdir pattern).
- All 4 docs describe the 5 changeset behaviors (C1–C5) by FUNCTION NAME
  (`decomposePRD`, `nextBugfixDir`, `patchBacklog`, `executeBacklog`,
  `ContextScopeReadSchema`) — NOT by line number.
- `npm run docs:lint` GREEN (markdownlint is configured — `package.json` L57).
- `npm run lint && npm run typecheck` GREEN (no .ts touched — guard against
  accidental source edits).
- `npm run test:run` GREEN (docs don't affect tests — guard against accidental
  source edits).
- Version headers bumped: `Last Updated` → current date, `Version` patch bump
  (1.0.0 → 1.0.1) on the 3 docs (`ARCHITECTURE.md`, `WORKFLOWS.md`,
  `TESTING.md`) that get material edits.

---

## User Persona (if applicable)

**Target User**: A new contributor or operator reading the docs to understand
the delta workflow, bug-fix lifecycle, or testing approach.
**Use Case**: Contributor reads docs/ARCHITECTURE.md "### Delta Sessions" to
understand what happens when they add a requirement to PRD.md — and the doc
correctly says the added requirement is decomposed into new tasks (not
silently dropped).
**User Journey**: read README delta blurb → run `--mode delta` after adding a
PRD section → new task appears → contributor trusts the docs.
**Pain Points Addressed**: The docs currently describe the PRE-bugfix behavior
(delta breakdown unreachable → adds dropped; flat bugfix dir; red test suite;
read-time schema lockout). A reader who trusts the docs is misled; this task
makes docs == reality.

---

## Why

- **Contract item 5 (DOCS)**: "This IS the changeset-level documentation sync
  task." Mode A JSDoc rode with each implementing subtask; Mode B sweeps the
  overview docs that span the whole changeset.
- **Bug-report h2.0 / h2.4**: the QA validation found the 5 issues; the fixes
  shipped across P1/P2/P3. The docs must not keep describing the broken
  behavior or future contributors will be misled and future QA will re-flag
  the doc/code drift.
- **Scope discipline**: this is the LAST subtask of P3.M1.T2 ("Sync
  changeset-level documentation"). It must not touch source, must not touch
  docs outside the 4 listed (CONFIGURATION.md / CLI_REFERENCE.md / user-guide.md
  are owned by P6 / out of scope), and must not duplicate the PRD (cite §4.3,
  §4.4, §5.1 rather than restate).

---

## What

Edits are **behavioral, overview-level** — describe WHAT the pipeline does now,
not the implementation algorithm (Mode A JSDoc already has details). Reference
functions/paths, never line numbers. Cite the PRD rather than restate it.

### Success Criteria

- [ ] README.md delta blurbs mention added-requirement decomposition (C1/C2).
- [ ] README.md documents numbered `bugfix/NNN_hash/` iterations (C5).
- [ ] ARCHITECTURE.md "### Delta Sessions" reflects breakdown-over-delta_prd.md
      + merge (C1/C2); stale "Architect will regenerate" note removed/rewritten.
- [ ] ARCHITECTURE.md "### Session Directory Structure" shows the
      `bugfix/NNN_hash/` subtree (C5).
- [ ] WORKFLOWS.md "### Phase 3: Delta Handling" includes writeDeltaPRD +
      decompose-over-delta_prd.md + merge (C1/C2).
- [ ] WORKFLOWS.md "### Phase 4: Backlog Execution" notes empty-backlog
      hard-abort (C3).
- [ ] WORKFLOWS.md QA/FixCycle section documents numbered bugfix iterations (C5).
- [ ] TESTING.md "### Deterministic Testing" describes the dual
      module-mock + real-tmpdir pattern; states suite is GREEN (C4 + 3A fixes).
- [ ] `npm run docs:lint` GREEN.
- [ ] `npm run lint && npm run typecheck && npm run test:run` GREEN (no source touched).
- [ ] Version `Last Updated` + patch bump on the 3 materially-edited docs.
- [ ] All 6 stale-phrase greps return 0 hits (or the phrase is rewritten to be
      accurate — see Validation Level 2).

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — YES. This PRP lists the exact files,
the exact sections (with current line anchors), the exact stale phrases to
remove/rewrite, the exact new behavior to state, the doc-conventions to follow
(version-header format, mermaid diagrams, PRD citation style), and the exact
validation gates (including the configured `npm run docs:lint`).

### Documentation & References

```yaml
# MUST READ - the 5 changeset behaviors (verify against source before writing prose)
- file: src/workflows/prp-pipeline.ts
  why: (C1) decomposePRD() delta branch now checks isDelta BEFORE hasBacklog and
       merges decomposed added-tasks with patched statuses. (C3) executeBacklog()
       hard-aborts on empty backlog. (C2) integrateIntoCurrentSessionResponse()
       handles added requirements. (C5) runQACycle() uses nextBugfixDir() for
       numbered bugfix/NNN_hash/ creation; #detectInterruptedBugfix() scans numbered children.
  pattern: describe by FUNCTION NAME (decomposePRD, executeBacklog, runQACycle,
           nextBugfixDir, #detectInterruptedBugfix) — never line numbers.

- file: src/core/session-utils.ts
  why: (C5) nextBugfixDir(sessionPath, hashSeed) returns {dir, sequence} where
       dir = resolve(sessionPath,'bugfix','NNN_<12hex>'). (C4) readTasksJSON uses
       BacklogReadSchema (lenient) while writeTasksJSON uses BacklogSchema (strict).

- file: src/core/task-patcher.ts
  why: (C2) patchBacklog 'added' case is a documented no-op that DELEGATES to
       the delta-session breakdown (not a silent drop). 'modified'→Planned,
       'removed'→Obsolete still apply.

- file: src/core/models.ts
  why: (C4) ContextScopeSchema (strict, write-time) vs ContextScopeReadSchema
       (lenient, read-time); BacklogReadSchema wraps the lenient subtask/task/
       milestone/phase schemas.

# MUST READ - the docs to edit (exact sections + stale phrases)
- file: README.md
  why: lines 44, 126, 205-211 (delta blurbs + "### Delta Session" subsection).
       Stale phrase: "only execute changed tasks" (2 occurrences) — rewrite to
       also state added requirements are decomposed into new tasks.
  pattern: '###' subsections under '##', inline ```bash command blocks.
  gotcha: README has NO version header — do not add one.

- file: docs/ARCHITECTURE.md
  why: "### Delta Sessions" (~L724-755) — mermaid diagram note "Architect will
       regenerate" + "Old tasks.json is NOT copied" are STALE (the regenerate
       path was unreachable pre-fix; now it runs). "### Session Directory
       Structure" (~L631-652) — add the bugfix/NNN_hash/ subtree.
  pattern: mermaid sequenceDiagram blocks; PRD citations as "(PRD §4.3)".
  gotcha: HAS a version header (Status/Last Updated/Version) — bump it.

- file: docs/WORKFLOWS.md
  why: "### Phase 3: Delta Handling" (~L314-354) — 7-step process omits
       writeDeltaPRD and the decompose-over-delta_prd.md + merge. "### Phase 4:
       Backlog Execution" (~L355+) — entry condition should note empty-backlog
       hard-abort. QA/FixCycleWorkflow section (~L460+) — flat bugfix dir → numbered.
  pattern: Duration/Purpose/Entry Conditions/Process/Exit Conditions/Output blocks.
  gotcha: HAS a version header — bump it.

- file: docs/TESTING.md
  why: "### Deterministic Testing" (~L54-83) — states "No real file system
       operations: File I/O is mocked" which is PARTIALLY STALE (file-lock +
       recovery suites use real tmpdir). "### Groundswell Agent Mocking Pattern"
       (~L432-517) — confirm it shows the file-contract return path.
  pattern: CRITICAL PATTERN callouts, ```ts code blocks.
  gotcha: HAS a version header — bump it. Suite is GREEN post-changeset — state it.

- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P3M1T2S1/research/changeset-doc-audit.md
  why: the full per-section stale-content audit + doc-conventions observed.
  section: "Document inventory" (per-file edit list), "Doc-conventions observed",
           "Pitfalls".
```

### Current Codebase tree (doc slice)

```bash
README.md                 # 813 lines — delta blurbs + command examples
docs/
  ARCHITECTURE.md         # 1048 lines — System Overview, Delta Sessions, State Mgmt
  WORKFLOWS.md            # 1548 lines — Phase 3 Delta Handling, Phase 4 Execution, QA Cycle
  TESTING.md              # 1079 lines — Coverage, Deterministic Testing, Mocking Strategies
  CONFIGURATION.md        # OUT OF SCOPE (P6)
  CLI_REFERENCE.md        # OUT OF SCOPE (P6)
  user-guide.md           # OUT OF SCOPE
```

### Desired Codebase tree

```bash
# NO new files. The same 4 files, MODIFIED in place:
README.md                 # delta blurbs updated + bugfix-numbering note added
docs/ARCHITECTURE.md      # Delta Sessions + Session Directory Structure updated
docs/WORKFLOWS.md         # Phase 3 + Phase 4 + QA/FixCycle updated
docs/TESTING.md           # Deterministic Testing + (confirm) Groundswell mock pattern
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL: This is a DOCS-ONLY task. Do NOT touch any .ts file. The gates
# `npm run lint && npm run typecheck && npm run test:run` MUST stay GREEN purely
# as a GUARD that no source was accidentally edited.

# CRITICAL: markdownlint IS configured (package.json L57: "docs:lint":
# markdownlint "docs/**/*.md"). Run `npm run docs:lint` — it lints all docs/*.md.
# NOTE: README.md is at repo ROOT, not under docs/, so markdownlint's glob
# "docs/**/*.md" does NOT cover it. Lint README.md separately if a rule applies:
#   npx markdownlint README.md
# Common markdownlint failures: MD022 (blanks around headings), MD040 (fenced
# code blocks need a language), MD009 (trailing whitespace). Keep code fences
# tagged (```bash / ```typescript / ```mermaid) and leave blank lines around headings.

# GOTCHA: docs reference behaviors — cite the PRD (§4.3, §4.4, §5.1) rather than
# restate it, and reference FUNCTIONS (decomposePRD, nextBugfixDir) not line
# numbers (line numbers rot and will be re-flagged by future QA).

# GOTCHA: version headers exist ONLY on docs/{ARCHITECTURE,WORKFLOWS,TESTING}.md
# (Status/Last Updated/Version). README.md has none — do not add one. Bump
# Version PATCH only (1.0.0 → 1.0.1) for a bugfix changeset, never major.

# GOTCHA: the bugfix changeset is itself running under a numbered bugfix session
# (plan/008_.../bugfix/001_9a4fd2467e1a/). The docs you write must describe THIS
# numbered-iteration mechanism (C5) — which is exactly what produced this session.

# CRITICAL: scope — do NOT edit CONFIGURATION.md, CLI_REFERENCE.md, user-guide.md,
# CUSTOM_AGENTS.md, CUSTOM_TOOLS.md, CUSTOM_WORKFLOWS.md, INSTALLATION.md,
# GROUNDSWELL_GUIDE.md. Those are owned by P6 (Sync Changeset-Level Documentation)
# or are out of scope. Only the 4 listed files.
```

---

## Implementation Blueprint

### Implementation Strategy

This is an editorial task, not a coding task. The strategy is:
1. **Read each stale section** (anchors given above) against the CURRENT source
   behavior (re-verify C1–C5 in the source files listed in References).
2. **Edit minimally** — rewrite only the stale sentences/notes; do not restructure
   whole sections (restructures risk markdownlint failures and merge conflicts).
3. **Run the grep gate** (Validation Level 2) after each file to prove zero stale
   phrases remain.
4. **Run `npm run docs:lint`** and fix any markdownlint violations.
5. **Bump version headers** on the 3 docs that get material edits.

### Implementation Tasks (ordered by dependencies — docs are independent, but edit lowest-risk first)

```yaml
Task 1: MODIFY docs/ARCHITECTURE.md — Delta Sessions + Session Directory Structure
  - EDIT "### Delta Sessions" (~L724-755):
      * Rewrite the mermaid `Note over SM: Old tasks.json is NOT copied /
        Architect will regenerate` block: the "regenerate" path is now REACHABLE
        and runs over delta_prd.md. New note text: delta session writes
        delta_prd.md (the diff slice); the architect breakdown later runs over
        delta_prd.md (not the full PRD), decomposing ADDED requirements into new
        Phase→Milestone→Task→Subtask items, then merges them with the patched
        statuses (modified→Planned, removed→Obsolete). Cite PRD §4.3 step 5/6.
      * Remove the stale "Architect will regenerate" line IF it implies the old
        unreachable behavior; replace with the accurate breakdown-over-delta_prd.md
        description.
  - EDIT "### Session Directory Structure" (~L631-652):
      * ADD the numbered bugfix subtree to the tree diagram:
            ├── bugfix/
            │   ├── 001_<12hexhash>/     # 1st bug-hunt iteration (archived)
            │   │   ├── tasks.json
            │   │   └── ...
            │   └── 002_<12hexhash>/     # 2nd iteration (prior preserved)
        Cite PRD §4.4 step 3 / §5.1 ("plan/NNN_hash/bugfix/NNN_hash/").
  - FOLLOW pattern: existing mermaid sequenceDiagram blocks; "(PRD §x.y)" citations.
  - NAMING: reference decomposePRD(), nextBugfixDir() — never line numbers.
  - BUMP header: Last Updated → today; Version 1.0.0 → 1.0.1.
  - GOTCHA: do NOT describe the merge ALGORITHM (that's Mode A JSDoc in
        prp-pipeline.ts); docs state the behavior (added→new tasks, modified→Planned).

Task 2: MODIFY docs/WORKFLOWS.md — Phase 3 + Phase 4 + QA/FixCycle
  - EDIT "### Phase 3: Delta Handling" (~L314-354):
      * In the 7-step Process list, INSERT after the patch step: a
        writeDeltaPRD(delta_prd.md) step, AND a note that decomposePRD() — running
        AFTER this phase — invokes the architect over delta_prd.md and merges the
        decomposed added-tasks with the patched statuses (C1/C2).
      * Rewrite the stale step 7 "Save patched backlog to delta session" to make
        clear the patched backlog is a STARTING point that the breakdown then
        AUGMENTS with decomposed added-tasks (not the final word).
  - EDIT "### Phase 4: Backlog Execution" (~L355+):
      * Entry Conditions: add that an EMPTY backlog is a hard fatal abort
        (executeBacklog throws; does NOT swallow). Cite Issue 5 / PRD §4.2.
  - EDIT the QA Cycle / FixCycleWorkflow section (~L460+):
      * Replace the flat-`bugfix/` description with numbered `bugfix/NNN_hash/`
        iterations created via nextBugfixDir(); prior iterations are ARCHIVED,
        not overwritten. Cite PRD §4.4 step 3.
  - FOLLOW pattern: Duration/Purpose/Entry Conditions/Process/Exit/Output blocks.
  - BUMP header: Last Updated → today; Version 1.0.0 → 1.0.1.
  - GOTCHA: keep the existing "Uses DeltaAnalysisWorkflow / patchBacklog" code
        snippet but add the writeDeltaPRD + decompose-over-delta_prd.md context.

Task 3: MODIFY README.md — delta blurbs + bugfix-numbering note
  - EDIT L44: "- **Delta Sessions**: Only re-execute changed tasks when PRDs are updated"
      → "- **Delta Sessions**: Re-execute changed tasks AND decompose newly-added
         requirements into new tasks when PRDs are updated"
  - EDIT L126: "Automatically detect PRD changes and only execute affected tasks"
      → "Automatically detect PRD changes — re-execute affected tasks and decompose
         newly-added requirements into new tasks"
  - EDIT "### Delta Session (PRD Changes)" (~L205-211):
      * After the `--mode delta` command block, ADD 1-2 sentences: the delta
        breakdown runs over delta_prd.md (the diff slice), so ADDED requirements
        produce new tasks; modified requirements are reset to Planned and removed
        ones to Obsolete. Cite PRD §4.3.
  - ADD a short bugfix-numbering note in the "### Bug Hunt Mode" block (~L216) or
      a new subsection: each bug-hunt iteration that finds bugs creates a numbered
      `bugfix/NNN_hash/` directory under the session, preserving prior iterations
      for the audit trail (plan/NNN_hash/bugfix/NNN_hash/). Cite PRD §4.4 / §5.1.
  - FOLLOW pattern: '###' subsections, ```bash command blocks, no version header.
  - GOTCHA: README has NO version header — do NOT add one. Do NOT touch the
        options table at L291 (modes are unchanged).

Task 4: MODIFY docs/TESTING.md — Deterministic Testing + Groundswell mock pattern
  - EDIT "### Deterministic Testing" (~L54-83):
      * Rewrite the bullet "No real file system operations: File I/O is mocked"
        to reflect the DUAL pattern: most suites mock fs (deterministic, fast);
        BUT suites testing fs/concurrency SEMANTICS (the file-lock mutex in
        src/core/file-lock.ts, the tasks-json-recovery git-history restore) use a
        REAL tmpdir (mkdtemp/rm) because O_EXCL locking and real I/O are
        untestable against mocked fs. Reference both test files as examples.
      * ADD a line: the suite is GREEN post-changeset (the rotted mocks flagged
        in Issue 3A — ResearchTimeoutError re-export, PRP-generator file-contract
        path, groundswell module mock — were fixed in P2.M3.T1).
  - CONFIRM "### Groundswell Agent Mocking Pattern" (~L432-517) shows the
        file-contract return path (the PRP-generator now writes a PRP.md file and
        returns a path, not inline content). If it still shows the old inline
        return, update it.
  - BUMP header: Last Updated → today; Version 1.0.0 → 1.0.1.
  - GOTCHA: keep the "100% Coverage Requirement" section unchanged (still true).

Task 5: VALIDATE — grep gate + markdownlint + no-source-guard
  - RUN the stale-phrase greps (Validation Level 2) — all must return 0 (or the
        phrase must be verifiably rewritten to be accurate).
  - RUN `npm run docs:lint` — fix any violations in the 3 edited docs.
  - RUN `npx markdownlint README.md` — README is outside the docs/ glob.
  - RUN `npm run lint && npm run typecheck && npm run test:run` — GREEN guard
        that no source was accidentally edited.
  - RUN `npm run validate` (the full gate) — GREEN.
```

### Implementation Patterns & Key Details

```text
# Pattern: accurate delta-workflow prose (use this phrasing, cite PRD §4.3)
"When a PRD is modified, the pipeline creates a delta session, writes
delta_prd.md (the structured diff slice), and saves the patched parent backlog.
The architect breakdown then runs OVER delta_prd.md (not the full PRD),
decomposing ADDED requirements into new Phase→Milestone→Task→Subtask items and
MERGING them with the patched statuses (modified → Planned, removed → Obsolete).
(PRD §4.3 step 5/6.)"

# Pattern: accurate bugfix-numbering prose (cite PRD §4.4 step 3 / §5.1)
"Each bug-hunt iteration that finds bugs creates a new NUMBERED bugfix session
under bugfix/ — bugfix/001_<hash>/, bugfix/002_<hash>/, … — via nextBugfixDir().
Prior iterations are ARCHIVED on disk, not overwritten, preserving the audit
trail. The session-path shape is plan/NNN_hash/bugfix/NNN_hash/. (PRD §4.4 / §5.1.)"

# Pattern: accurate read-schema prose (cite Issue 3B / PRD §5.1)
"tasks.json validation is STRICT on write (architect output must follow the
CONTRACT DEFINITION format) but LENIENT on read — legacy, hand-edited, or
externally-authored sessions load without lockout via BacklogReadSchema.
(PRD §5.1 recovery orientation.)"

# Pattern: version-header bump (docs/{ARCHITECTURE,WORKFLOWS,TESTING}.md ONLY)
**Status**: Published
**Last Updated**: 2026-01-25      # ← today
**Version**: 1.0.1                # ← patch bump from 1.0.0

# GOTCHA: cite PRD sections, don't restate them. Reference functions, not lines.
```

### Integration Points

```yaml
NO DATABASE / NO ROUTES / NO CONFIG / NO SOURCE CHANGES.

DOCUMENTATION:
  - bump: docs/ARCHITECTURE.md, docs/WORKFLOWS.md, docs/TESTING.md version headers
          (Last Updated + patch Version). README.md has NO header — do not add.
  - lint: npm run docs:lint (covers docs/**/*.md); npx markdownlint README.md (root).

DOWNSTREAM / OUT OF SCOPE (do NOT edit):
  - docs/CONFIGURATION.md, docs/CLI_REFERENCE.md → P6.M1.T1.S2/S3 (env-var + CLI reference)
  - docs/user-guide.md, CUSTOM_*.md, INSTALLATION.md, GROUNDSWELL_GUIDE.md → other owners
```

---

## Validation Loop

### Level 1: Syntax & Style (markdown + accidental-source guard)

```bash
# Markdown lint — configured in package.json ("docs:lint": markdownlint "docs/**/*.md")
npm run docs:lint                 # lints docs/ARCHITECTURE.md, WORKFLOWS.md, TESTING.md
npx markdownlint README.md        # README is at root, NOT under docs/ glob

# GUARD: no source accidentally edited (must be GREEN and unchanged)
npm run lint                      # eslint — zero errors
npm run typecheck                 # tsc --noEmit — zero errors
git diff --stat -- 'src/**/*.ts'  # MUST show no changes (empty output)

# Expected: docs:lint clean; lint+typecheck clean; zero src/ diffs.
```

### Level 2: Stale-Phrase Grep Gate (objective proof the old behavior is gone)

```bash
# Each MUST return 0 — OR the phrase must be verifiably rewritten to be accurate
# (paste the rewritten sentence into the PRP/commit to prove accuracy).
echo "README 'only execute changed tasks': $(grep -c 'only execute changed tasks' README.md)"
echo "ARCH  'Architect will regenerate':   $(grep -c 'Architect will regenerate' docs/ARCHITECTURE.md)"
echo "ARCH  'Old tasks.json is NOT copied':$(grep -c 'Old tasks.json is NOT copied' docs/ARCHITECTURE.md)"
echo "WORK  'Save patched backlog to delta session': $(grep -c 'Save patched backlog to delta session' docs/WORKFLOWS.md)"
echo "TEST  'No real file system operations':        $(grep -c 'No real file system operations' docs/TESTING.md)"

# Positive grep — the NEW behavior MUST now appear in the right docs:
echo "C1/C2 added-requirement decomposition (README):  $(grep -c 'added requirement' README.md)"
echo "C5 numbered bugfix (ARCH):                       $(grep -c 'NNN_hash\|NNN_<' docs/ARCHITECTURE.md)"
echo "C1 delta_prd.md breakdown (WORKFLOWS):           $(grep -c 'delta_prd.md' docs/WORKFLOWS.md)"
echo "C3 empty-backlog abort (WORKFLOWS):              $(grep -ci 'empty backlog.*abort\|abort.*empty backlog' docs/WORKFLOWS.md)"
echo "C4 lenient read / BacklogReadSchema (TESTING):   $(grep -c 'BacklogReadSchema\|lenient.*read' docs/TESTING.md)"
# Expected: stale greps == 0; positive greps >= 1 each.
```

### Level 3: Full Validation Gate

```bash
# The project's canonical gate — docs-only change must keep it GREEN
npm run validate                  # lint && format:check && typecheck && test:run
# Expected: GREEN. (docs aren't compiled/linted by eslint, but this proves no
# source was touched and the suite stays green.)
```

### Level 4: Manual Doc-Review (human-readable accuracy)

```bash
# Render-check: eyeball the edited sections for accuracy and tone.
# (No tooling — open each of the 4 files at the edited sections and verify:)
#   - README.md ~L44, L126, L205-211, L216 (delta + bugfix)
#   - docs/ARCHITECTURE.md ~L631-652 (dir tree), ~L724-755 (delta sessions)
#   - docs/WORKFLOWS.md ~L314-354 (Phase 3), ~L355+ (Phase 4), ~L460+ (QA/FixCycle)
#   - docs/TESTING.md ~L54-83 (Deterministic Testing)
# Verify: each edit describes CURRENT behavior, cites the PRD, references functions
# (not line numbers), and matches the Mode-B "overview not implementation" tone.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] Level 1: `npm run docs:lint` GREEN; `npx markdownlint README.md` GREEN
- [ ] Level 1 guard: `npm run lint && npm run typecheck` GREEN; `git diff --stat -- 'src/**/*.ts'` EMPTY
- [ ] Level 2: all 5 stale-phrase greps return 0 (or phrase verifiably rewritten)
- [ ] Level 2: all 5 positive-behavior greps return ≥ 1
- [ ] Level 3: `npm run validate` GREEN

### Feature Validation

- [ ] README.md: delta blurbs mention added-requirement decomposition (C1/C2)
- [ ] README.md: numbered bugfix iterations documented (C5)
- [ ] ARCHITECTURE.md: Delta Sessions section reflects breakdown-over-delta_prd.md + merge (C1/C2)
- [ ] ARCHITECTURE.md: Session Directory Structure shows bugfix/NNN_hash/ subtree (C5)
- [ ] WORKFLOWS.md: Phase 3 includes writeDeltaPRD + decompose-over-delta_prd.md + merge (C1/C2)
- [ ] WORKFLOWS.md: Phase 4 notes empty-backlog hard-abort (C3)
- [ ] WORKFLOWS.md: QA/FixCycle documents numbered bugfix iterations (C5)
- [ ] TESTING.md: Deterministic Testing describes dual mock + real-tmpdir pattern; states GREEN (C4 + 3A)
- [ ] No stale references to old (pre-fix) behavior remain in any of the 4 docs

### Code Quality Validation

- [ ] Edits reference FUNCTIONS (decomposePRD, nextBugfixDir, patchBacklog,
      executeBacklog, ContextScopeReadSchema) — NOT line numbers
- [ ] Edits cite the PRD (§4.3, §4.4, §5.1) rather than restating it
- [ ] Edits are overview-level (behavior), not implementation-level (algorithm)
- [ ] Version headers bumped (Last Updated + patch) on the 3 materially-edited docs
- [ ] No files outside the 4 in scope were touched

### Documentation & Deployment

- [ ] markdownlint passes on all edited docs + README
- [ ] mermaid diagrams (if edited) still render (valid sequenceDiagram syntax)
- [ ] No broken internal doc links introduced

---

## Anti-Patterns to Avoid

- ❌ **Do NOT touch any `.ts` source file.** This is docs-only; the lint/typecheck/
      test gates exist purely as a guard. If they go red, you edited source — revert.
- ❌ **Do NOT edit docs outside the 4 in scope** (CONFIGURATION.md, CLI_REFERENCE.md,
      user-guide.md, CUSTOM_*.md, INSTALLATION.md, GROUNDSWELL_GUIDE.md). Those are
      P6 / other-owner territory.
- ❌ **Do NOT reference line numbers in doc prose.** They rot and future QA will
      re-flag the drift. Reference functions/paths only.
- ❌ **Do NOT restate the PRD.** Cite it (`(PRD §4.3)`) — restating creates a
      second source of truth that drifts.
- ❌ **Do NOT describe the implementation algorithm** (the merge logic, the regex
      in nextBugfixDir). That's Mode A JSDoc. Docs state the BEHAVIOR.
- ❌ **Do NOT bump the doc Version major** (1.x → 2.x) for a bugfix changeset —
      patch bump only (1.0.0 → 1.0.1).
- ❌ **Do NOT add a version header to README.md** — it has none and never did.
- ❌ **Do NOT skip the grep gate.** It is the only objective proof the stale
      behavior is fully removed; "I think I got them all" is not acceptable.
- ❌ **Do NOT forget `npx markdownlint README.md`** — the `docs/**/*.md` glob in
      `npm run docs:lint` does NOT cover the repo-root README.
- ❌ **Do NOT restructure whole sections.** Edit the stale sentences/notes in
      place; restructures risk markdownlint failures and merge conflicts.