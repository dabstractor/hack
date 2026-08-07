# PRP — P1.M1.T3.S1: Review and update changeset-level documentation for the BUG-001 fix

> Bugfix 001, **changeset-level documentation sync (Mode B, SOW §5)** — the catch-all doc sweep for the
> entire BUG-001 changeset. BUG-001 was the critical default-config defect where
> `getRecentCommitMessages()` passed simple-git `{ maxEntries: count }` instead of `{ maxCount: count }`,
> breaking the DEFAULT `auto` commit-style on every commit. The fix (T1.S1 + T1.S2, commits
> `bba784b`/`4294f29`) is a one-token source change + test-assertion fix; T2.S1/T2.S2 add regression
> tests. **This task verifies that `README.md` and `docs/*.md` are consistent with the fix.** Research
> conclusion: **no edit is needed (no-op)** — no doc names `maxEntries`/`maxCount`, the docs already
> describe the *intended* `auto` behavior the fix restores, the JSDoc is accurate, and there is no
> changelog area to annotate. This PRP makes the verification deterministic and supplies a contingency
> edit if, contrary to expectation, a stale reference is found.

---

## Goal

**Feature Goal**: Run the item-specified grep sweep over `README.md` and `docs/*.md` to confirm the
changeset-level documentation is consistent with the BUG-001 fix (`maxEntries` → `maxCount`). Apply a
deterministic decision gate: if any doc names `maxEntries` or makes a claim inconsistent with the fix,
correct it (docs only); otherwise record the "verified accurate, no edit needed (no-op)" finding and
close. Per the item: this is the catch-all Mode-B docs sync for the changeset.

**Deliverable**:
1. **A confirmed-accurate documentation state** — `README.md` and `docs/*.md` verified to contain no
   `maxEntries` reference and no claim inconsistent with the fix.
2. **A verification record** at
   `plan/012_7dd502f7feb9/bugfix/001_662720d16c77/P1M1T3S1/research/changeset-doc-review.md`
   (already authored during planning — the implementing agent **re-runs** §6 of that note and appends
   the executed-command output + dated "verified / no-op" line).
3. **(Contingency, only if a stale/inconsistent reference is found)**: a minimal docs-only edit to the
   offending `README.md` / `docs/*.md` file per the procedure in *Implementation Blueprint → Task C*.

**Success Definition**:
- The grep sweep returns ZERO `maxEntries`/`maxCount` references in `README.md` or `docs/*.md`, and
  every commit-style doc reference describes the intended behavior the fix restores — OR any
  stale/inconsistent reference found has been corrected.
- Confirmed there is no changelog/release-notes/bug-fixes section requiring a BUG-001 note.
- The `getRecentCommitMessages` JSDoc confirmed accurate (informational only — JSDoc is source, out of
  this task's docs-only scope; do NOT edit it).
- The verification note records the executed grep output and the dated no-op determination.
- If any doc file was edited: `npx prettier --check <edited-file>` passes.
- **No modification to source code, tests, config, `PRD.md`, `spec/**`, `tasks.json`,
  `prd_snapshot.md`, or the `getRecentCommitMessages` JSDoc** (those are owned by T1/T2 / humans /
  the orchestrator). Docs-only.

## User Persona

N/A — internal documentation accuracy. The "users" are future readers of the reference docs who must
not see a stale `maxEntries` reference or a claim that contradicts the now-fixed `auto` behavior.

## Why

- **Closes the changeset-level docs loop.** BUG-001 was a corrective fix (AGENTS.md Rule 5) that
  restores existing intended behavior; it adds no feature/config/CLI/API. The Mode-B sweep confirms
  the docs need no change to match it — the docs already describe the spec, and the code now matches.
- **Low-risk, bounded scope.** Expected outcome is zero edits; the work is a verification with a
  deterministic decision gate and a ready contingency. No code, tests, config, spec, or PRD changes.
- **Scope discipline.** T1.S1 owns the source fix; T1.S2 owns the unit-assertion fix; T2.S1/T2.S2 own
  regression tests. **T3.S1 owns ONLY README.md / docs/*.md accuracy w.r.t. BUG-001.** Zero file
  overlap with T1/T2 except reading their outputs.

## What

### User-visible behavior
None. Documentation-only. No runtime, CLI, config, or API surface change.

### Technical requirements (exact contract)

**Task A — Re-run the verification grep** (the item's specified terms + the research note's §6):

```bash
# (a) The bug/fix option name + the helper internals — must be absent from changeset docs.
grep -rni 'maxEntries\|maxCount\|getRecentCommitMessages' README.md docs/*.md
# (b) The commit-style feature refs — must describe the INTENDED behavior (which the fix restores).
grep -rni 'PRP_COMMIT_STYLE\|auto.*learn\|stagecoach' README.md docs/ARCHITECTURE.md docs/CONFIGURATION.md
# (c) Changelog/release-notes area — must be absent (so the "add a BUG-001 note" branch does not apply).
ls CHANGELOG* CHANGES* HISTORY* RELEASE* 2>/dev/null
grep -ni '## changelog\|## release notes\|## what.s new' README.md docs/*.md
```

**Task B — Apply the decision gate** (deterministic):

| grep result on README.md / docs/*.md | Action |
| ------------------------------------ | ------ |
| (a) empty; (b) only intended-behavior descriptions (`auto` learns / ≤1 degrades / `0` disables); (c) no changelog file or section | **NO-OP.** Record the finding (Task D). |
| (a) returns any `maxEntries` reference in a doc | **EDIT** per Task C (replace with `maxCount` or remove the internal-option mention). |
| (b) reveals a claim inconsistent with the fix (e.g. asserts the buggy behavior, or a now-false statement about `auto`) | **EDIT** per Task C. |

**Expected result (from planning research): the NO-OP branch.** Ground truth (verified this session):
zero `maxEntries`/`maxCount`/`getRecentCommitMessages` matches in any `*.md` (excluding `node_modules`
and the `/plan/` research workspace); the commit-style docs (`README.md:172,426-428`,
`docs/ARCHITECTURE.md:927-954`, `docs/CONFIGURATION.md:94,251-257`) describe the intended behavior;
no `CHANGELOG*`/`CHANGES*`/`HISTORY*`/`RELEASE*` file at root and no changelog section header.

**Task C — Contingency edit (ONLY if the gate routes here).** If a stale/inconsistent reference is
found, edit **only** that doc file, preserving the file's existing voice:
- A `maxEntries` reference → replace with `maxCount` (the simple-git `LogOptions` property) or, better,
  remove the internal-option mention entirely and keep the user-facing description ("the last N commit
  messages"). Docs should not name simple-git internals.
- A claim inconsistent with the fix → reword to match PRD §5.1's intended `auto` contract (learns from
  history; ≤1-commit / `EXAMPLES=0` → degrades to `plain`).
- Then run `npx prettier --check <edited-file>` (and `npx prettier --write <edited-file>` if needed).
- **Do NOT** add a BUG-001 entry to a changelog that does not exist, and **do NOT** invent a new doc
  section — this corrective fix warrants no new feature documentation.

**Task D — Record the finding** (runs in BOTH branches):

1. Open
   `plan/012_7dd502f7feb9/bugfix/001_662720d16c77/P1M1T3S1/research/changeset-doc-review.md`.
2. Under its §6, append the **executed** grep output (paste the actual lines printed) and a dated
   line: `VERIFIED <ISO date>: README.md + docs/*.md consistent with BUG-001 fix (maxEntries→maxCount).
   Changelog area: none. Edit applied: <none | file + one-line summary>. No-op confirmed.`
3. The work item's commit message states the outcome verbatim (see *Validation Loop → recording*).

### Success Criteria
- [ ] Task A grep (a)/(b)/(c) executed; output captured.
- [ ] Decision gate (Task B) applied; the branch taken is documented.
- [ ] (NO-OP branch) No file under `README.md` / `docs/` was modified for BUG-001 reasons.
- [ ] (EDIT branch) Only the stale doc edited; `npx prettier --check <file>` green.
- [ ] Verification note appended with executed grep output + dated determination.
- [ ] No changes to source code, tests, config, `PRD.md`, `spec/**`, `tasks.json`, `prd_snapshot.md`,
      or the `getRecentCommitMessages` JSDoc.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes.** The exact
grep commands, the deterministic decision gate, the verified ground-truth doc state (which lines say
what), the contingency edit wording, the docs-only scope boundary, the recording format, and the
executable validation commands are all below.

### Documentation & References
```yaml
# MUST READ — the planning-time ground truth + re-verification recipe (this task's own research note)
- docfile: plan/012_7dd502f7feb9/bugfix/001_662720d16c77/P1M1T3S1/research/changeset-doc-review.md
  section: "1. The BUG-001 changeset", "2. Grep sweep", "3. The JSDoc", "4. Changelog area — NONE", "6. Re-verification recipe"
  why: Pins the exact current doc lines (README.md:172,426-428; ARCHITECTURE.md:927-954; CONFIGURATION.md:94,251-257),
        proves zero maxEntries/maxCount/getRecentCommitMessages matches, and gives the copy-paste re-verification commands.
  critical: Expected outcome is NO-OP. Only edit if re-running §6 reveals a maxEntries reference or a
        claim inconsistent with the fix that the planning sweep did not find.

# MUST READ — the bug report (what the fix changed and why)
- docfile: plan/012_7dd502f7feb9/bugfix/001_662720d16c77/TEST_RESULTS.md
  section: h3.0 "Issue 1: getRecentCommitMessages() passes an invalid simple-git option (maxEntries instead of maxCount)"
  why: Establishes the exact root cause (src/tools/git-mcp.ts:590), the fix (maxEntries→maxCount), and the
        "Fix" + "Recommendations" wording. Confirms the fix is purely source+test — no docs were touched.

# EDITS-OK FILES (only these may be edited, and ONLY in the EDIT branch)
- file: README.md
  why: commit-style refs at L172 (two-phase commits) + L426-428 (PRP_COMMIT_FORMAT/STYLE/STYLE_EXAMPLES config rows) — expected accurate, no edit.
- file: docs/ARCHITECTURE.md
  why: "Commit Message Format (Two-Layer Model)" L927-954 — describes intended auto behavior; expected accurate, no edit.
- file: docs/CONFIGURATION.md
  why: L94 ([pipeline] keys) + L251-257 (env-var reference) — describe intended behavior; expected accurate, no edit.
- file: docs/*.md  # any other doc — swept for maxEntries/stale claims; none expected.

# INFORMATIONAL — the fix outputs this task verifies against (do NOT edit)
- file: src/tools/git-mcp.ts
  why: getRecentCommitMessages now uses `git.log({ maxCount: count })` (T1.S1). Its JSDoc (L560-595) is
        user-facing and accurate (never named maxEntries). The JSDoc is SOURCE — out of this task's docs-only scope.
- file: tests/unit/tools/git-mcp.test.ts
  why: assertion now `{ maxCount: 2 }` (T1.S2). Source/test — out of scope.
- file: tests/integration/git-mcp-log.test.ts, tests/integration/git-commit-generate.test.ts
  why: regression tests (T2.S1 / T2.S2). Test-only — out of scope; T2.S2 is parallel and produces no docs.

# FORMAT GATE (markdown formatting, project-wide)
- command: "npx prettier --check README.md docs/*.md"   # run only if an edit was made
  why: package.json `format:check` lints **/*.md with prettier. There is .markdownlint.json but no
        markdownlint npm script — prettier is the deterministic gate.
```

### Current Codebase tree (docs surface only)

```bash
README.md                 # commit-style refs: L172 (two-phase), L426-428 (config table) — intended-behavior, no internals
docs/
├── ARCHITECTURE.md       # "Commit Message Format (Two-Layer Model)" L927-954 — intended behavior, no internals
├── CONFIGURATION.md      # L94 ([pipeline] keys), L251-257 (env-var ref) — intended behavior, no internals
├── CUSTOM_TOOLS.md       # L567,650,644 — generic simple-git usage/mock examples; UNRELATED to BUG-001
├── TESTING.md            # L590,601 — generic vi.mock('simple-git') example; UNRELATED to BUG-001
└── (CLI_REFERENCE.md, CUSTOM_AGENTS.md, INSTALLATION.md, user-guide.md, WORKFLOWS.md, GROUNDSWELL_GUIDE.md — no maxEntries/commit-style-internals)
# NO CHANGELOG* / CHANGES* / HISTORY* / RELEASE* at repo root.
src/tools/git-mcp.ts      # getRecentCommitMessages + its JSDoc (L560-595) — SOURCE, out of docs-only scope
```

### Desired Codebase tree with files to be added/changed

```bash
# Expected (NO-OP branch): no source/doc files change.
plan/012_7dd502f7feb9/bugfix/001_662720d16c77/P1M1T3S1/research/changeset-doc-review.md
    # EDIT (append executed grep output + dated "verified / no-op" line under §6) — the durable artifact.

# Contingency (EDIT branch only): at most ONE doc file under README.md / docs/*.md edited for a stale
# maxEntries reference or an inconsistent claim, then prettier --check'd.
```

### Known Gotchas of our codebase & Library Quirks
```bash
# CRITICAL (scope): This task may edit ONLY README.md / docs/*.md for BUG-001 accuracy. It MUST NOT
#   touch source code, tests, config, PRD.md, spec/**, tasks.json, prd_snapshot.md, .gitignore, or the
#   getRecentCommitMessages JSDoc (JSDoc is source; the source fix is T1.S1's job, already complete).

# CRITICAL (this is a corrective fix): BUG-001 restores INTENDED behavior — it adds no feature. Do NOT
#   invent a new doc section or changelog entry for a "new feature". The item's "add a BUG-001 note"
#   branch applies ONLY if a changelog/release-notes area already exists (it does not).

# GOTCHA (the docs describe the SPEC, not the bug): README/ARCHITECTURE/CONFIGURATION already say
#   "auto learns from history; ≤1 commit degrades to plain; EXAMPLES=0 disables". Those statements were
#   the SPEC and are now TRUE post-fix. They are NOT stale — do not "correct" them.

# GOTCHA (formatting): package.json has no `markdownlint` script (only .markdownlint.json config). The
#   deterministic markdown gate is prettier (`npm run format:check` covers **/*.md). Run
#   `npx prettier --check <file>` only on a file you actually edited.

# GOTCHA (workspace noise): recursive greps may hit .pi-subagents/artifacts/*.md (scratch research
#   outputs) and plan/** (the research workspace). Those are NOT changeset docs — exclude them.
```

## Implementation Blueprint

### Data models and structure
N/A — documentation-only task. No data models, schemas, or types.

### Implementation Tasks (ordered by dependencies)

```yaml
Task A: VERIFY — re-run the BUG-001 doc grep sweep
  - RUN (a): grep -rni 'maxEntries\|maxCount\|getRecentCommitMessages' README.md docs/*.md
  - RUN (b): grep -rni 'PRP_COMMIT_STYLE\|auto.*learn\|stagecoach' README.md docs/ARCHITECTURE.md docs/CONFIGURATION.md
  - RUN (c): ls CHANGELOG* CHANGES* HISTORY* RELEASE* 2>/dev/null; grep -ni '## changelog\|## release notes\|## what.s new' README.md docs/*.md
  - CAPTURE: the exact printed lines (for the verification note).
  - EXPECTED: (a) empty; (b) README.md:172,426-428 + ARCHITECTURE.md:927-954 + CONFIGURATION.md:94,251-257 (intended behavior); (c) no file, no section header.

Task B: DECIDE — apply the decision gate (table in "What → Technical requirements")
  - IF (a) empty AND (b) shows only intended-behavior descriptions AND (c) finds no changelog -> NO-OP branch -> Task D.
  - IF (a) returns any maxEntries reference OR (b) reveals an inconsistent claim -> EDIT branch -> Task C.

Task C (EDIT branch ONLY): CORRECT a stale/inconsistent reference (docs only)
  - EDIT: only the single offending doc file under README.md / docs/*.md.
  - WORDING: a maxEntries mention -> `maxCount` (the simple-git LogOptions property) OR remove the
             internal-option mention and keep the user-facing description. An inconsistent claim ->
             reword to PRD §5.1's intended auto contract (learns from history; ≤1/EXAMPLES=0 -> plain).
  - PRESERVE: the file's existing voice/markdown style; do not invent a new section or changelog.
  - FORMAT: npx prettier --write <file> then npx prettier --check <file>  (must be green).
  - THEN: go to Task D.

Task D: RECORD the finding (BOTH branches)
  - APPEND to: plan/012_7dd502f7feb9/bugfix/001_662720d16c77/P1M1T3S1/research/changeset-doc-review.md (§6)
      * the executed grep output from Task A,
      * a dated line: "VERIFIED <ISO date>: ... consistent with BUG-001 fix. Changelog area: none.
        Edit applied: <none | file + summary>. No-op confirmed."
  - PREPARE the commit message (see Validation Loop → recording).
  - SCOPE: do NOT modify any file outside this task's edit set.
```

### Implementation Patterns & Key Details
```bash
# Pattern: user-facing config-table row (correct, leave alone) — README.md:427
#   "| `PRP_COMMIT_STYLE` | No | `auto` | Style layer ... auto (learn from history), plain, conventional, or gitmoji |"
# -> Describes the INTENDED behavior the fix restores. NOT stale. NO EDIT.

# Pattern: conceptual two-layer description (correct, leave alone) — docs/ARCHITECTURE.md:945-947
#   "Style layer. PRP_COMMIT_STYLE governs ... auto (default) learns from history: the generation
#    request includes the last PRP_COMMIT_STYLE_EXAMPLES ... A repo with ≤1 commit ... degrades to plain."
# -> Describes the SPEC, now TRUE post-fix. NOT stale. NO EDIT.

# Contingency pattern (only if a maxEntries reference is found in a doc): replace with the user-facing
#   description, e.g. "...fetches the last N commit messages..." — docs should not name simple-git internals.
```

### Integration Points
```yaml
DOCUMENTATION:
  - files in scope: README.md, docs/*.md (BUG-001 accuracy only)
  - pattern: "user-facing description of auto-learns-from-history / ≤1-degrades / 0-disables — no internal option names expected"

COMMIT (recording):
  - the work item's commit message MUST state the outcome, e.g.:
      NO-OP: "Verify changeset-level docs consistent with BUG-001 fix (maxEntries→maxCount); no doc edits needed"
      EDIT:  "Correct stale BUG-001 reference in <file> (maxEntries→maxCount / inconsistent claim)"
  - if the orchestrator's commit-of-record only fires on file changes, the appended verification note
    is the committed artifact that carries the determination.

NONE OF: src/, tests/, config, PROMPTS.md, spec/, PRD.md, tasks.json, prd_snapshot.md, .gitignore
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
# Re-verification grep (the core of this task)
grep -rni 'maxEntries\|maxCount\|getRecentCommitMessages' README.md docs/*.md
# EXPECTED: no output (the bug & fix live only in source/tests).

grep -rni 'PRP_COMMIT_STYLE\|auto.*learn\|stagecoach' README.md docs/ARCHITECTURE.md docs/CONFIGURATION.md
# EXPECTED: README.md:172,426-428; ARCHITECTURE.md:927-954; CONFIGURATION.md:94,251-257 — intended behavior.

ls CHANGELOG* CHANGES* HISTORY* RELEASE* 2>/dev/null || true   # EXPECTED: no such file
grep -ni '## changelog\|## release notes\|## what.s new' README.md docs/*.md || true   # EXPECTED: no match

# Markdown formatting — run ONLY if Task C edited a file
npx prettier --check README.md docs/*.md   # green; or npx prettier --write <file> first
# (No markdownlint npm script exists; prettier is the gate. .markdownlint.json is editor-only.)

# Expected: grep returns the expected lines; prettier --check passes (or N/A if no edit).
```

### Level 2: Unit Tests (Component Validation)
```bash
# N/A — documentation-only task; no code under test. (Do not run the TS test suite for this task;
# it is unaffected. If run for sanity, `npm run typecheck` + `npm run test:run` should be unchanged
# from the post-T1/T2 green state.)
```

### Level 3: Integration Testing (System Validation)
```bash
# Confirm the T1 outputs this task verifies against are present (informational, read-only).
grep -n 'maxCount' src/tools/git-mcp.ts                 # EXPECTED: git.log({ maxCount: count }) at ~L590
grep -n 'maxCount' tests/unit/tools/git-mcp.test.ts     # EXPECTED: { maxCount: 2 } at ~L977 (T1.S2)
grep -n 'maxEntries' src/ tests/                        # EXPECTED: no remaining maxEntries in source/tests

# Confirm no forbidden file was accidentally modified
git status --porcelain | grep -E '^\s*[AM]\s+(src/|spec/|PRD\.md|.*tasks\.json|prd_snapshot|.*\.ts)' \
  && echo "VIOLATION: out-of-scope file touched" || echo "OK: no source/spec/PRD/test files modified"
# Expected: "OK: no source/spec/PRD/test files modified" (plus, in the EDIT branch, the one edited doc).
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Human-readable accuracy read of the three key passages.
sed -n '170,174p' README.md
sed -n '424,430p' README.md
sed -n '925,955p' docs/ARCHITECTURE.md
sed -n '255,258p' docs/CONFIGURATION.md
# Read each and confirm: (a) none names maxEntries; (b) none asserts the buggy behavior; (c) each
# describes the intended auto contract that the fix now makes true. If any fails, apply Task C.
```

### Recording (required in both branches)
- Append the executed Task A output + a dated `VERIFIED ... / no-op` line to
  `plan/012_7dd502f7feb9/bugfix/001_662720d16c77/P1M1T3S1/research/changeset-doc-review.md` §6.
- The work item commit message states the outcome (NO-OP vs EDIT) verbatim.

## Final Validation Checklist

### Technical Validation
- [ ] Level 1 grep (a) empty; (b) shows intended-behavior refs only; (c) no changelog.
- [ ] (EDIT branch only) `npx prettier --check <edited-file>` green.
- [ ] No out-of-scope file modified (`git status` check at Level 3).

### Feature Validation
- [ ] Decision gate applied and the taken branch documented.
- [ ] Verification note appended with executed grep output + dated determination.
- [ ] T1 outputs confirmed present (`maxCount` in source + unit test; no residual `maxEntries`).

### Code Quality Validation
- [ ] (EDIT branch) edit preserves the doc's existing voice/markdown style.
- [ ] (EDIT branch) no user-facing description was changed to name simple-git internals.
- [ ] Recording note is clear enough to audit the determination later.

### Documentation & Deployment
- [ ] The determination (no-op or edit summary) is captured in the commit message.
- [ ] No new environment variables or config (N/A for this task).

---

## Anti-Patterns to Avoid
- ❌ Don't "correct" the docs' `auto`-learns-from-history / ≤1-degrades / `0`-disables statements — they describe the SPEC, which the fix now makes TRUE. They are not stale.
- ❌ Don't invent a new doc section or changelog entry — BUG-001 is a corrective fix, not a new feature, and no changelog area exists.
- ❌ Don't edit the `getRecentCommitMessages` JSDoc, source, tests, config, `PRD.md`, `spec/**`, `tasks.json`, or `prd_snapshot.md` — they are owned by T1/T2 / humans / the orchestrator (and the JSDoc is already accurate).
- ❌ Don't treat `.pi-subagents/artifacts/*.md` or `plan/**` grep hits as changeset docs — they are scratch research outputs / the research workspace; exclude them.
- ❌ Don't skip recording the finding just because no file changed — the determination itself is the deliverable.
- ❌ Don't run the full TS test/lint suite and then treat unrelated pre-existing diagnostics as this task's failure — this task touches no code.