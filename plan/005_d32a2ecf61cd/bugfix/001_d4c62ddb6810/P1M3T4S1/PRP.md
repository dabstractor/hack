name: "P1.M3.T4.S1 — Sync changeset-level docs (README + overview) for validate-script & integration-test changes"
description: |

---

## Goal

**Feature Goal**: Update `README.md` (and verify any cross-cutting overview docs) so the
developer-facing documentation accurately reflects two real changes in this bugfix changeset:
(1) the `npm run validate` commit-gate now includes the full test suite (`test:run`), and
(2) the integration-test surface gained the R4 `tasks.json` smart-recovery E2E test — without
overclaiming R1–R4 coverage and without duplicating `docs/TESTING.md`.

**Deliverable**: A single, surgical edit to `README.md` (the `npm run validate` row in the
"Available Scripts" table), plus read-only verification of `docs/ARCHITECTURE.md` and
`docs/WORKFLOWS.md`. All formatting checks green.

**Success Definition**: `npm run format:check` passes and `npm run validate` is green; the README
script table unambiguously conveys that `npm run validate` runs lint + format:check + typecheck +
test:run; no false claims about R1–R4 integration coverage; no duplication of `docs/TESTING.md`.

## User Persona (if applicable)

**Target User**: Developers/contributors reading the README to understand the commit-time gate.

**Use Case**: A contributor wants the single command to run before committing and reads the script
table in `README.md`.

**Pain Points Addressed**: The current row says only "Run all validation checks" — opaque about
whether it runs the test suite. After the P1.M2.T1.S1 change, `validate` DOES run `test:run`, so
the README row should say so.

## Why

- The `validate` script was strengthened in P1.M2.T1.S1 to include `test:run` (so commit `4e6d2ef`'s
  kind of regression is caught at commit time). `docs/TESTING.md` was already updated; the README
  script table is the one remaining overview location that is still stale/ambiguous.
- This is the **Mode B changeset-level doc-sync** task. It intentionally does NOT restate what
  `docs/TESTING.md` already says.
- Bug report PRD context: §6.3 Progressive Validation gates; Mode B doc sync.

## What

A docs-only change to the project root `README.md`:

1. Update the `npm run validate` row in the **Available Scripts** table so its description
   unambiguously includes the test suite (lint + format:check + typecheck + test:run).
2. (Conditional, read-only) Confirm there is no README "Self-Healing & Resilience" section to update
   on this branch (there is not — it exists only on `main`).
3. (Conditional, read-only) Confirm `docs/ARCHITECTURE.md` and `docs/WORKFLOWS.md` do not reference
   the developer `npm run validate` npm script (they describe a different concept — the pipeline's
   own L1–L4 code-validation gates / QA workflows).

### Success Criteria

- [ ] `README.md` validate row description conveys "includes the full test suite".
- [ ] `npm run format:check` is green (table is prettier-aligned).
- [ ] `npm run validate` (lint + format:check + typecheck + test:run) is green.
- [ ] No claim added that integration tests cover "R1–R4 flows" (false on this branch — see Context).
- [ ] No content duplicated from `docs/TESTING.md`.

## All Needed Context

### Context Completeness Check

_Pass._ All exact line numbers, tooling facts, column widths, and gotchas are listed below. An
agent new to this repo can perform the edit and validation with no further discovery.

### Documentation & References

```yaml
# MUST READ — the task contract & research notes
- file: plan/005_d32a2ecf61cd/bugfix/001_d4c62ddb6810/P1M3T4S1/research/doc-scope-reality.md
  why: Records the detached-HEAD reality; explains why scope is NARROW and why R1–R2 claims are false.
  critical: README line numbers in the contract (627–631, 120–138) are MAIN's numbering; working-dir
    README differs (table at 596–609, no resilience section). DO NOT trust contract line numbers.

- file: plan/005_d32a2ecf61cd/bugfix/001_d4c62ddb6810/architecture/system_context.md
  why: Git topology + key commits; confirms working dir is detached HEAD child of b03ed87.
  section: "Git Topology (CRITICAL)"

- file: plan/005_d32a2ecf61cd/bugfix/001_d4c62ddb6810/architecture/test-infrastructure.md
  why: Issue 2 (validate script) + related docs inventory; confirms README validate row is the target.
  section: "Issue 2: Validate Script" -> "Related Documentation"

# FILES TO EDIT
- file: README.md
  why: The ONLY file to edit. Contains the "Available Scripts" table with the stale validate row.
  pattern: Markdown table prettier-aligned (pipe tables). Column widths auto-managed by prettier.
  gotcha: |
    The exact line is 608: `| \`npm run validate\`      | Run all validation checks       |`
    The "Description" column is 31 chars wide (set by "Type check without compilation" at line 602).
    Keep the new description <= 31 chars to avoid reflowing every row, OR run `npm run format`
    afterward to let prettier re-align the whole table (both are acceptable).

# FILES TO VERIFY (read-only) — DO NOT EDIT unless they reference the npm validate script
- file: docs/TESTING.md
  why: ALREADY updated by P1.M2.T1.S1 with the commit-gate callout. DO NOT DUPLICATE.
  pattern: Already contains "npm run validate enforces all layers at commit time — it runs lint,
    format:check, typecheck, and test:run" and a "Commit-time gate" callout.

- file: docs/ARCHITECTURE.md
  why: Has a "Validation Gates" section (~line 486) describing the PIPELINE's L1–L4 gates applied to
    AI-generated code — a DIFFERENT concept from the developer `npm run validate` commit script.
  gotcha: Does NOT mention the npm script. No edit expected. Verify only.

- file: docs/WORKFLOWS.md
  why: Describes QA/BugHunt/FixCycle workflows. Its only `validate` token (line ~395) is the CLI
    `--mode validate` mode, not the npm script.
  gotcha: Does NOT mention the npm validate script. No edit expected. Verify only.

# TOOLING FACTS
- file: package.json
  why: Confirms `"validate": "npm run lint && npm run format:check && npm run typecheck && npm run test:run"`
    (already changed by P1.M2.T1.S1). The README row must match THIS reality.

- file: .prettierignore
  why: Confirms README.md is NOT ignored (excluded: node_modules, dist, coverage, locks, .eslintcache,
    artifacts/, plan/). So README.md IS subject to `npm run format:check`.
  gotcha: `npm run docs:lint` (markdownlint "docs/**/*.md") does NOT cover root README.md — only
    prettier formatting applies to README.
```

### Current Codebase tree (relevant subset)

```bash
README.md                 # <-- EDIT: Available Scripts table, validate row (line 608)
docs/
├── TESTING.md            # <-- already updated (P1.M2.T1.S1); DO NOT duplicate
├── ARCHITECTURE.md       # <-- verify only (pipeline L1-L4 gates, not npm validate)
└── WORKFLOWS.md          # <-- verify only (QA workflows; `validate` = CLI mode)
package.json              # <-- reference only: validate already includes test:run
.prettierignore           # <-- reference only: README not ignored
plan/.../P1M3T4S1/
├── PRP.md                # <-- this file
└── research/doc-scope-reality.md   # <-- MUST READ reality note
```

### Desired Codebase tree with files to be added/changed

```bash
README.md                 # MODIFIED: validate table row description (1 line)
# (no files added)
```

### Known Gotchas of our codebase & Library Quirks

```bash
# CRITICAL: Working dir is a DETACHED HEAD (bbd8ce3) child of b03ed87. It does NOT contain main's
#   R1/R2/R3 source or the README "Self-Healing & Resilience" section. The contract's line numbers
#   (627-631, 120-138) are from main and are WRONG for the working dir. Trust the research note.

# CRITICAL: R1 (deadline) and R2 (issue-replan) integration tests are BLOCKED — those features are
#   NOT implemented in src/ on this branch (see P1.M3.T1.S1/P1.M3.T2.S1 issue_feedback.md). Only the
#   R4 tasks-json-recovery E2E test exists. DO NOT add text claiming "integration tests cover R1-R4".

# GOTCHA: README.md is NOT covered by markdownlint (`npm run docs:lint` globs docs/**/*.md only).
#   Only prettier (`npm run format:check`) enforces README formatting — keep the table prettier-aligned.

# GOTCHA: The Available Scripts table "Description" column is 31 chars wide. If your new description
#   exceeds 31 chars, prettier will widen the column and re-pad EVERY row when you run `npm run format`.
#   That is acceptable but noisy; prefer a <=31-char description (e.g. "Lint, format, typecheck & tests").
```

## Implementation Blueprint

### Data models and structure

N/A — documentation-only task. No data models, schemas, or ORM changes.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY reality (read-only, ~2 min)
  - READ plan/005_d32a2ecf61cd/bugfix/001_d4c62ddb6810/P1M3T4S1/research/doc-scope-reality.md
  - RUN: `grep -n "validate" README.md` and confirm the validate row is at line ~608 (NOT 627-631).
  - RUN: `grep -in "self-heal\|resilien\|recover\|re-plan\|deadline" README.md`
    EXPECTED: zero matches (no Self-Healing & Resilience section on this branch). If zero, the
    contract's conditional clause does NOT apply → SKIP adding any resilience section.
  - RUN: `grep -n "npm run validate\|validate script\|validate.*test:run" docs/ARCHITECTURE.md docs/WORKFLOWS.md`
    EXPECTED: zero matches referencing the npm commit-gate script. (ARCHITECTURE.md "Validation
    Gates" = the pipeline's L1-L4 code gates; WORKFLOWS.md `validate` = CLI --mode. Different concept.)
    If zero, NO edit to these docs is required.

Task 2: EDIT README.md — update the `npm run validate` table row (THE deliverable)
  - FILE: README.md, "### Available Scripts" section, validate row (~line 608).
  - OLD:  `| \`npm run validate\`      | Run all validation checks       |`
  - NEW (recommended, 31 chars — fits existing column width, no table reflow):
           `| \`npm run validate\`      | Lint, format, typecheck & tests |`
    (Alternative ≤31-char phrasings are acceptable: "All checks incl. test:run" (27),
     "Lint, format, typecheck, tests" (30). Anything that conveys "includes the test suite".)
  - DO NOT add a "Self-Healing & Resilience" section (absent on this branch — Task 1 confirmed).
  - DO NOT add claims about R1-R4 integration coverage (false on this branch).
  - DO NOT restate the detailed commit-gate callout — that already lives in docs/TESTING.md.
  - OPTIONAL (only if it reads naturally and does NOT duplicate TESTING.md): a single one-line
    note under "### Running Tests" pointing to `npm run validate` as the pre-commit command.
    If in doubt, OMIT it — the table row is sufficient and the safest minimal change.

Task 3: FORMAT — re-align the table and verify
  - RUN: `npm run format`   # prettier --write; re-pads the table if the new description changed width
  - RUN: `git diff README.md` to confirm ONLY the intended row(s) changed (and prettier padding).

Task 4: VALIDATE — full gate must stay green
  - RUN: `npm run format:check`        # MUST pass (README is not prettier-ignored)
  - RUN: `npm run validate`            # lint + format:check + typecheck + test:run — MUST be green
  - EXPECTED: all pass. test:run must remain green (the P1.M1.T1 logger regression is already fixed).
```

### Implementation Patterns & Key Details

```markdown
<!-- The Available Scripts table is a prettier pipe-table. Existing validate row: -->
| `npm run validate`      | Run all validation checks       |

<!-- Recommended replacement (31-char description fits the existing 31-wide column): -->
| `npm run validate`      | Lint, format, typecheck & tests |

<!-- After editing, run `npm run format`. Prettier owns column padding; do NOT hand-pad unless
     you are certain of the width. `npm run format:check` is the gate that must pass. -->
```

```bash
# Decision tree for the conditional doc checks:
# 1. README "Self-Healing & Resilience" section present?
#      -> On this branch: NO (grep returns nothing). -> SKIP. Do not create one.
# 2. docs/ARCHITECTURE.md / docs/WORKFLOWS.md reference the npm `validate` script?
#      -> On this branch: NO (they describe pipeline L1-L4 gates / QA workflows). -> NO edit.
#      -> If a future grep DOES find a stale reference, make it consistent with the script
#         (lint + format:check + typecheck + test:run), mirroring docs/TESTING.md wording without
#         duplicating its callout blocks.
```

### Integration Points

```yaml
DOCUMENTATION:
  - primary: "README.md -> ### Available Scripts table -> npm run validate row"
  - consistency_source: "package.json scripts.validate (already: lint && format:check && typecheck && test:run)"
  - do_not_touch: "docs/TESTING.md (already has the detailed commit-gate callout from P1.M2.T1.S1)"

NO CODE CHANGES:
  - this task edits ONLY markdown. No src/, no package.json, no tests.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# README.md is subject to prettier (not in .prettierignore). markdownlint does NOT cover root README.
npm run format            # re-align the table after the edit (prettier --write)
npm run format:check      # MUST pass — this is the contract's required formatting gate

# Expected: "All matched files use Prettier code style!" (0 errors).
# If format:check fails on README.md, run `npm run format` again and re-check.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Docs-only change must not break the suite. Run the full commit gate (includes test:run):
npm run validate
# = npm run lint && npm run format:check && npm run typecheck && npm run test:run

# Expected: all four stages green. (The P1.M1.T1 logger regression is already fixed, so the
# previously-failing progress-display tests now pass.)

# Optional: spot-check the validation tests still green:
npm run test:run -- tests/unit/logger.test.ts
```

### Level 3: Integration Testing (System Validation)

N/A for a docs-only change. `npm run validate` (Level 2) already exercises `test:run`, which
includes the existing integration suite (e.g. `tests/integration/core/tasks-json-recovery-e2e.test.ts`).
No service startup or endpoints are involved.

### Level 4: Creative & Domain-Specific Validation

```bash
# Manual doc-accuracy review (human-readable checks):
grep -n "npm run validate" README.md           # confirm the row reads as intended
git diff --stat                                # confirm ONLY README.md changed (no stray edits)
git diff README.md                             # confirm the table edit + prettier padding only

# Anti-overclaim guard: ensure NO false R1-R4 coverage text was added:
grep -in "r1\|r2\|r3\|r4\|deadline\|re-plan\|issue.*retry\|self-healing\|resilience" README.md
# Expected: no new resilience-flow claims (the pre-existing README has none on this branch).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run format:check` passes (README.md prettier-aligned).
- [ ] `npm run validate` is green (lint + format:check + typecheck + test:run).
- [ ] `git diff` shows ONLY README.md changed (no accidental edits to src/, package.json, or docs/).

### Feature Validation

- [ ] README `npm run validate` row description conveys the full test suite is included.
- [ ] Verified (read-only) README has no Self-Healing & Resilience section to update (skipped — absent).
- [ ] Verified (read-only) ARCHITECTURE.md / WORKFLOWS.md don't reference the npm validate script (no edit).
- [ ] No false "R1–R4 integration coverage" claim added.
- [ ] No duplication of `docs/TESTING.md` content.

### Code Quality Validation

- [ ] Table edit follows existing prettier pipe-table conventions.
- [ ] Description phrasing is concise and consistent with the script table's voice.
- [ ] No hardcoded stale info — description matches `package.json` `scripts.validate`.

### Documentation & Deployment

- [ ] The single source of truth for the detailed commit-gate remains `docs/TESTING.md`; README points
      to the command without restating the callout.

---

## Anti-Patterns to Avoid

- ❌ Don't trust the contract's line numbers (627–631 / 120–138) — they are `main`'s. Grep the working
  README for the actual row.
- ❌ Don't add a "Self-Healing & Resilience" section — it doesn't exist on this branch (only on `main`).
- ❌ Don't claim integration tests cover "R1–R4 flows" — R1/R2 features and their tests are NOT
  implemented on this branch (blocked). Only the R4 recovery E2E test exists.
- ❌ Don't duplicate the commit-gate callout already in `docs/TESTING.md`.
- ❌ Don't edit `docs/ARCHITECTURE.md` / `docs/WORKFLOWS.md` unless they actually reference the npm
  `validate` script (they don't — verify, don't assume).
- ❌ Don't hand-pad the table and skip `npm run format`; prettier owns alignment, and `format:check`
  is the gate.
- ❌ Don't touch `package.json`, `src/`, or any tests — this is docs-only.
