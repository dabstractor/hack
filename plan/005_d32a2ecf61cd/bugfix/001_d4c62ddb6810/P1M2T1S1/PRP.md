# PRP — P1.M2.T1.S1: Add `test:run` to the `validate` script and update `docs/TESTING.md`

> **Bugfix subtask** — Issue 2 of
> `plan/005_d32a2ecf61cd/bugfix/001_d4c62ddb6810/TEST_RESULTS.md`.
> `npm run validate` runs only static checks (`lint && format:check && typecheck`) and does
> NOT include `test:run`, so the logger regression (Issue 1) shipped with a **false-green**
> commit-time gate. This subtask makes the convenience script a complete, self-contained gate.

---

## ⚠️ STOP — READ THIS PRECONDITION BLOCK FIRST ⚠️

The work-item contract assumes the implementation runs on *"the fixed codebase from
P1.M1.T1.S1"* (≈ `main@4e6d2ef` with the logger regression fixed), where the **only** red
thing is the 14 progress-display tests. **That assumption does NOT hold on the current tree.**
Verified at PRP-authoring time (see `research/validate-script-precondition.md`):

| Probe (run these FIRST) | Current result | Meaning |
| --- | --- | --- |
| `git merge-base --is-ancestor 4e6d2ef HEAD && echo YES \|\| echo NO` | **NO** | `main@4e6d2ef` is NOT an ancestor of HEAD — tree diverged |
| `git rev-parse --short HEAD` | `a2a762e` | current branch descends from `b03ed87`/`93be68d` |
| `npm run typecheck; echo $?` | **exit 2** | 2 errors in `tasks-json-recovery.ts` (missing `gitFileHistory`/`gitReadFileAtCommit`) |
| `npm run validate; echo $?` | **exit 2** | `validate` is **ALREADY RED** (fails at typecheck via `&&`) |
| `npm run test:run 2>&1 \| tail -3` | **250 failed \| 5454 passed \| 70 skipped** | the test suite is massively broken — NOT just the 14 progress-display tests |
| `grep -nE "export.*(gitFileHistory\|gitReadFileAtCommit)" src/tools/git-mcp.ts` | **no matches** | branch is internally inconsistent (recovery module w/o its git-history deps) |
| `grep -nE "getResearchTimeoutSeconds\|ISSUE_RETRY_MAX" src/config/constants.ts` | **no matches** | R1/R2 resilience constants absent on this branch |

**Why this matters:** On the current tree, `npm run validate` is already failing at
`typecheck` BEFORE `test:run` could ever run (`&&` short-circuits). Adding `&& npm run test:run`
therefore has **zero behavioral effect on the current tree** — and the contract's verification
("`npm run validate` must exit 0") **cannot be satisfied here** because the tree is pre-existingly
broken on two unrelated axes that this subtask does not own.

**Therefore Task 1 is a hard precondition gate.** Two outcomes:

- **Branch A — GREEN TREE** (e.g. `main@4e6d2ef` with the logger fix applied; static gates
  pass and `test:run` is green): proceed to Task 2 (edit `package.json`) + Task 3 (edit
  `docs/TESTING.md`) + Task 4 (run `npm run validate` → confirm **exit 0**). Full success.
- **Branch B — CURRENT TREE (red)** (`typecheck` fails, 250 tests fail): STILL make the two
  edits in Task 2 + Task 3 — they are **unconditionally correct** and implement Issue 2's
  intent (self-contained gate). Then run `npm run validate` in Task 4, **observe it exits
  non-zero at the pre-existing `typecheck` failure**, and document the breakdown + divergence
  in the task result. Do NOT try to fix the 2 typecheck errors or the 250 test failures — they
  are out of scope (tree reconciliation is an orchestrator concern, see "Why the current tree
  is red" below). The subtask is **correct** as long as the edits land and are verified per
  Task 4's subtask-local checks (a)–(c).

This PRP is written to succeed in either scenario. The two edits are correct regardless of
which branch the implementer lands on.

---

## Goal

**Feature Goal**: Turn `npm run validate` from a **static-only** gate
(`lint && format:check && typecheck`) into a **complete, self-contained** commit-time gate
that also runs the full test suite (`… && npm run test:run`), so that no future regression
(e.g. Issue 1's logger breakage) can ship with a false-green `validate`. Also document the
change in `docs/TESTING.md` so developers know `validate` is the single complete gate.

**Deliverable**:
1. `package.json` — the `validate` script gains `&& npm run test:run`:
   `"validate": "npm run lint && npm run format:check && npm run typecheck && npm run test:run"`.
2. `docs/TESTING.md` — a note (in the "Test Commands" subsection, primary; optional one-liner
   in "Layered Testing Approach") stating `npm run validate` now includes `test:run`.

**Success Definition**:
- `package.json` `scripts.validate` ends with `&& npm run test:run` (verified by a `node -e`
  assertion; well-formed JSON).
- `docs/TESTING.md` contains the note that `npm run validate` includes `test:run`.
- `npm run test:run` is a resolvable script (the appended name is valid).
- **Branch A only:** `npm run validate` exits 0 (all gates green on a green tree).
- **Branch B (current tree):** the two edits land and are verified per Task 4 (a)–(c);
  `npm run validate` is documented as pre-existingly red (typecheck + tests), NOT caused by
  this subtask.

---

## Why

- **Closes the false-green hole (TEST_RESULTS.md Issue 2).** Commit `4e6d2ef` shipped the logger
  regression (Issue 1) with `npm run validate` green, because `validate` never ran the tests.
  The PRD §6.3 Progressive Validation gates and every resilience subtask contract require
  "pass `npm run validate` + `npm run test:run`" — but the convenience script alone gave a
  false-green. Adding `test:run` makes the gate self-contained (contract prefers Option (a)
  over documenting a static-only gate).
- **The edit is correct on every tree.** Whether the suite is green or red, `validate`
  *should* include the tests — that is the entire point. On a green tree it stays green and
  now covers tests; on a red tree it surfaces the breakage honestly instead of hiding it.
- **Zero behavioral change on the current (red) tree.** Because `validate` already fails at
  `typecheck` via `&&` short-circuit, appending `&& npm run test:run` does not change its exit
  on the current tree. It only takes effect once the tree is reconciled to a green state —
  which is exactly when you want the stronger gate.
- **`prebuild` hook becomes meaningful.** `"prebuild": "npm run validate"` will now block a
  build if any test fails. This is the intended behavior (don't ship untested builds).
- **Scope discipline.** This is S1 = the script edit + the doc note only. Fixing the logger
  regression was P1.M1.T1. The pre-existing typecheck/test breakage on the current tree
  (missing `gitFileHistory`/`getResearchTimeoutSeconds`, etc.) is a **tree reconciliation**
  problem, NOT this subtask. Integration tests are P1.M3. README/overview doc sync is P1.M3.T4.

---

## What

### User-visible behavior
None at runtime. Developer-facing: `npm run validate` now runs the full test suite after the
static checks; `npm run build` (via the `prebuild` hook) now also requires a green test suite.

### Technical requirements (exact contract)

**(a) `package.json` — change the `validate` script** from:
```json
"validate": "npm run lint && npm run format:check && npm run typecheck"
```
to:
```json
"validate": "npm run lint && npm run format:check && npm run typecheck && npm run test:run"
```
(Hand-edit the single `scripts.validate` string. `npm run` does not rewrite `package.json`
for manual script edits. Preserve the `=== Validation ===` section-comment grouping above it
and the `fix` script below it unchanged.)

**(b) `docs/TESTING.md` — add a note** in the **"Test Commands"** subsection (primary location),
immediately after the Test Commands bash code block (which ends with `vitest run --bail=1`
followed by the closing ` ``` `), and before `### Coverage Reports`. Insert:

```markdown

> **Commit-time gate:** The `npm run validate` convenience script runs the **complete**
> pre-commit gate, in order — `npm run lint && npm run format:check && npm run typecheck
> && npm run test:run`. It is the single command to run before committing and includes the
> full test suite (`test:run`), not just static checks.

```

Optionally (to satisfy the contract's named "Layered Testing Approach" section), also add a
one-line cross-reference at the end of the `### Layered Testing Approach` section (after the
"- **E2E tests…**" bullet, before `### API Endpoint Enforcement`):

```markdown

> **Note:** `npm run validate` enforces all layers at commit time — it runs `lint`,
> `format:check`, `typecheck`, **and `test:run`** (the full unit + integration + E2E suite).

```

(Do at least the primary note. The second is optional but recommended for discoverability.)

### Success Criteria
- [ ] `package.json` `scripts.validate` is exactly
      `npm run lint && npm run format:check && npm run typecheck && npm run test:run`.
- [ ] The `=== Validation ===` comment grouping and the `fix` script are unchanged.
- [ ] `docs/TESTING.md` "Test Commands" subsection contains a note stating `npm run validate`
      includes `test:run`.
- [ ] `npm run test:run` resolves as a script (the appended name is valid).
- [ ] **Branch A:** `npm run validate` exits 0.
- [ ] **Branch B:** edits verified per Task 4 (a)–(c); `npm run validate` redness documented as
      pre-existing (not caused by this subtask).

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to
implement this successfully?_ **Yes** — the change is a literal string append to one
`package.json` script plus a verbatim markdown note at a pinned location, with the appended
script name (`test:run`) verified to already exist, and a hard precondition gate (Task 1)
that tells the agent exactly what to do on a green tree vs the current red tree. No judgement
calls remain.

### Documentation & References

```yaml
# MUST READ — the authoritative bug report + suggested fix
- docfile: plan/005_d32a2ecf61cd/bugfix/001_d4c62ddb6810/TEST_RESULTS.md
  section: "Minor Issues > Issue 2"
  why: Root cause (validate is static-only → false green that let the logger regression ship),
        the suggested fix (Option (a): add && npm run test:run), and the PRD §6.3 Progressive
        Validation reference.
  critical: >
    The contract prefers Option (a) (make validate self-contained) over Option (b) (document
    that validate is static-only). Implement Option (a).

# MUST READ — precondition finding (authored with this PRP)
- docfile: plan/005_d32a2ecf61cd/bugfix/001_d4c62ddb6810/P1M2T1S1/research/validate-script-precondition.md
  section: "0. CRITICAL PRECONDITION FINDING"
  why: Documents that the current tree (a2a762e) is NOT main@4e6d2ef; validate is ALREADY red
        (typecheck exit 2); test:run has 250 pre-existing failures. Gives the exact probe
        commands and the Branch A / Branch B decision logic.
  critical: >
    On the current tree, appending && npm run test:run has ZERO behavioral effect (validate
    already fails at typecheck via &&). The edits are still correct and must be made; the
    red gate is pre-existing and out of scope.

# MUST READ — architecture context for Issue 2
- docfile: plan/005_d32a2ecf61cd/bugfix/001_d4c62ddb6810/architecture/test-infrastructure.md
  section: "Issue 2: Validate Script" and "Related Documentation"
  why: Confirms the current validate string, the target string, and that CONTRIBUTING.md does
        NOT exist (no action there) while README.md:608 already lists validate accurately.
- docfile: plan/005_d32a2ecf61cd/bugfix/001_d4c62ddb6810/architecture/system_context.md
  section: "Git Topology (CRITICAL)" and "The Three Issues > Issue 2"
  why: Confirms all PRD issues are against main@4e6d2ef and the divergence from the current HEAD.

# THE FILES EDITED
- file: package.json
  why: Contains the scripts block. The validate script (in the "=== Validation ===" group) is
        the single line to change.
  pattern: |
    "=== Validation ===": "",
    "validate": "npm run lint && npm run format:check && npm run typecheck",   # ← append " && npm run test:run"
    "fix": "npm run lint:fix && npm run format",
  gotcha: >
    Hand-edit ONLY the validate string. Do not let any tooler reformat the scripts block.
    Preserve the empty-string section-comment entries ("=== Validation ===": "") verbatim.

- file: docs/TESTING.md
  why: The testing-strategy doc. The "### Test Commands" subsection (under "## Running Tests and
        Coverage Reports") is the natural home for the note; the code block there ends with
        `vitest run --bail=1` before `### Coverage Reports`.
  pattern: |
    ### Test Commands
    The project provides several npm scripts for running tests:
    ```bash
    ...
    npm run test:bail
    # or
    vitest run --bail=1
    ```
    ← INSERT the "> **Commit-time gate:** …" note HERE
    ### Coverage Reports
  gotcha: >
    Insert AFTER the closing ``` of the Test Commands code block and BEFORE "### Coverage Reports".
    Keep the blockquote (`>`) formatting so prettier is happy.
```

### Current Codebase tree (relevant slice)

```bash
package.json        # EDIT — scripts.validate += " && npm run test:run"
docs/TESTING.md     # EDIT — add note in "### Test Commands" (+ optional "### Layered Testing Approach")
# No new files. No source files. No test files.
```

### Desired Codebase tree with files to be added/edited

```bash
package.json        # MODIFIED — one script string (validate)
docs/TESTING.md     # MODIFIED — one (or two) note insertions
```

### Known Gotchas of our codebase & Library Quirks

```bash
# CRITICAL — PRECONDITION DIVERGENCE. The current tree (a2a762e) is NOT main@4e6d2ef.
#   `git merge-base --is-ancestor 4e6d2ef HEAD` → NO. validate is ALREADY red (typecheck exit 2:
#   tasks-json-recovery.ts imports gitFileHistory/gitReadFileAtCommit which are absent on this
#   branch). test:run has 250 pre-existing failures. Run Task 1's probes BEFORE editing. The two
#   edits are still correct on BOTH trees — make them regardless, then characterize the gate exit.

# CRITICAL — on the current (red) tree, appending && npm run test:run changes NOTHING observable.
#   `&&` short-circuits at the failing `typecheck`, so test:run is never reached. Do NOT interpret
#   the unchanged-red validate as a defect of this subtask — it is pre-existing. Document it.

# GOTCHA — `prebuild` runs validate. After this edit, `npm run build` requires a green test suite.
#   That is intended (no false greens). On the current broken tree, builds already fail at
#   typecheck, so no marginal change until the tree is reconciled.

# GOTCHA — prettier is enforced as ERROR. After editing docs/TESTING.md, run
#   `npx prettier --write docs/TESTING.md` (or `npm run fix`) before `npm run format:check`.
#   Keep the inserted note as a blockquote (`> `) to match surrounding style.

# GOTCHA — do NOT create CONTRIBUTING.md. It does not exist on main and is out of scope.
#   The contract's doc target is docs/TESTING.md only (Mode A).

# GOTCHA — do NOT update README.md here. README.md:608 already lists validate accurately.
#   README/overview doc sync is P1.M3.T4. Keep this subtask to package.json + docs/TESTING.md.

# GOTCHA — the 2 typecheck errors (tasks-json-recovery.ts) and the 250 test failures are NOT
#   yours to fix. They exist because the current branch predates main's commits 0a6d55a (git
#   history primitives) and d9a4d9a/182d8da (R1/R2 resilience constants). Reconciling the tree
#   is an orchestrator decision, not this subtask.
```

---

## Implementation Blueprint

### Data models and structure
None — a one-line script-string change plus a markdown note. No types, constants, or code.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: PRECONDITION PROBE  (MANDATORY FIRST — do not skip)
  - RUN: `git merge-base --is-ancestor 4e6d2ef HEAD && echo "ON_MAIN_LINEAGE" || echo "DIVERGED"`
  - RUN: `npm run typecheck >/dev/null 2>&1; echo "typecheck exit: $?"`
  - RUN: `npm run validate >/dev/null 2>&1; echo "validate exit: $?"`
  - RUN: `npm run test:run 2>&1 | tail -3`
  - BRANCH A (typecheck exit 0 AND test:run shows 0 failed):
      * The tree is green. Proceed to Task 2 → Task 3 → Task 4 (expect validate exit 0).
  - BRANCH B (typecheck exit != 0 OR test:run shows failures — CURRENT TREE STATE):
      * The tree is pre-existingly red. STILL proceed to Task 2 → Task 3 (the edits are correct).
      * In Task 4, expect `npm run validate` to exit non-zero at the SAME pre-existing gate
        (typecheck on the current tree). Document the breakdown; do NOT fix unrelated failures.
  - PLACEMENT: run from repo root.

Task 2: EDIT package.json — append test:run to the validate script
  - LOCATE: the `=== Validation ===` group in `scripts`:
        "validate": "npm run lint && npm run format:check && npm run typecheck",
  - CHANGE TO (append exactly ` && npm run test:run`):
        "validate": "npm run lint && npm run format:check && npm run typecheck && npm run test:run",
  - DO NOT TOUCH: any other script (especially `fix`, `test`, `test:run`, `prebuild`), the
        `=== Validation ===` empty-string comment entry, dependencies, or any other key.
  - VERIFY the appended script name exists: `"test:run": "vitest run"` is already in `scripts`.
  - PLACEMENT: package.json `scripts.validate` (in-place string edit).

Task 3: EDIT docs/TESTING.md — add the commit-time-gate note
  - PRIMARY: in the `### Test Commands` subsection (under `## Running Tests and Coverage Reports`),
        insert the `> **Commit-time gate:** …` blockquote immediately AFTER the closing ``` of the
        Test Commands bash code block (the block ends with `vitest run --bail=1`) and BEFORE
        `### Coverage Reports`. Use the verbatim note text from the "Technical requirements (b)".
  - OPTIONAL (recommended): append a one-line `> **Note:** …` blockquote at the end of the
        `### Layered Testing Approach` section (after the E2E-tests bullet, before
        `### API Endpoint Enforcement`) — see "Technical requirements (b)".
  - DO NOT: rewrite other sections, reflow the Table of Contents (the note is inline, no new
        heading), or touch any code blocks.
  - PLACEMENT: docs/TESTING.md, the two subsections named above.

Task 4: VERIFY  (run in both branches; outcome differs)
  - RUN (subtask-local correctness — MUST pass in BOTH branches):
      (a) node -e "const s=require('./package.json').scripts; console.assert(s.validate==='npm run lint && npm run format:check && npm run typecheck && npm run test:run','validate WRONG: '+s.validate); console.log('validate OK:',s.validate);"
          EXPECT: "validate OK: npm run lint && npm run format:check && npm run typecheck && npm run test:run"
      (b) npm run | grep -E "^\s*(test:run|validate)\s"   # both scripts list (names resolve)
      (c) grep -n "npm run validate" docs/TESTING.md        # the note is present
  - RUN (the gate — characterize, do NOT assume 0):
      (d) npm run validate; echo "validate exit: $?"
  - EXPECTED:
      * Branch A: (d) exits 0 (all four gates green). Full success.
      * Branch B (current tree): (d) exits non-zero at the pre-existing typecheck failure
        (before test:run is reached). Record which gate failed and the failure count. The
        subtask is CORRECT per (a)–(c); the red gate is pre-existing and out of scope.
  - RUN (format hygiene on the edited doc): `npx prettier --check docs/TESTING.md`
      (if it fails: `npx prettier --write docs/TESTING.md` then re-check).
  - DO NOT: attempt to fix the 2 typecheck errors or any test failures in this subtask.
```

### Implementation Patterns & Key Details

```jsonc
// PATTERN — the exact package.json diff (one string).

//   "=== Validation ===": "",
//   "validate": "npm run lint && npm run format:check && npm run typecheck",
// becomes:
//   "validate": "npm run lint && npm run format:check && npm run typecheck && npm run test:run",
//   "fix": "npm run lint:fix && npm run format",
```

```markdown
<!-- PATTERN — the exact docs/TESTING.md insertion (primary), after the Test Commands code block: -->

… (existing bash code block ending with `vitest run --bail=1` then ```) …

> **Commit-time gate:** The `npm run validate` convenience script runs the **complete**
> pre-commit gate, in order — `npm run lint && npm run format:check && npm run typecheck
> && npm run test:run`. It is the single command to run before committing and includes the
> full test suite (`test:run`), not just static checks.

### Coverage Reports
```

### Integration Points

```yaml
NPM SCRIPTS (consumers of the edit):
  - validate:        now ends with `&& npm run test:run` (the only change).
  - test:run:        pre-existing (`vitest run`) — invoked by validate after the static gates.
  - prebuild:        `"prebuild": "npm run validate"` — builds now require a green suite (intended).

DOCS (the note):
  - docs/TESTING.md "### Test Commands": primary note that validate includes test:run.
  - docs/TESTING.md "### Layered Testing Approach": optional one-line cross-reference.

NOT INTEGRATED (do NOT touch in this subtask):
  - README.md:608 (`| npm run validate | Run all validation checks |`) — already accurate; P1.M3.T4 owns README sync.
  - CONTRIBUTING.md — does not exist; out of scope.
  - The 2 typecheck errors (tasks-json-recovery.ts) and 250 test failures — tree reconciliation, orchestrator concern.
```

### Why the current tree is red (for the task-result write-up — NOT to fix here)

```
The current branch (a2a762e) diverged before main@4e6d2ef and is missing two sets of commits
that later code on this branch depends on:
  - 0a6d55a (git history primitives gitFileHistory/gitReadFileAtCommit in src/tools/git-mcp.ts)
    → tasks-json-recovery.ts (added here by 6e80a4f) imports them → 2 typecheck errors.
  - d9a4d9a / 182d8da (R1 RESEARCH_TIMEOUT/getResearchTimeoutSeconds, R2 ISSUE_RETRY_MAX)
    → research-timeout.test.ts / issue-retry-max.test.ts call missing functions → test failures.
Plus environment-specific failures (groundswell-linker / npm-link vs yalc) and other pre-existing
breakage on this branch. NONE of this is caused by P1.M2.T1.S1 (which edits only package.json +
docs/TESTING.md). Reconciling the tree onto main@4e6d2ef (or forward-porting the missing commits)
is an orchestrator decision.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# JSON well-formed + the script value is exactly right (subtask-local, MUST pass both branches):
node -e "const s=require('./package.json').scripts; console.assert(s.validate==='npm run lint && npm run format:check && npm run typecheck && npm run test:run','validate WRONG: '+s.validate); console.log('validate OK:',s.validate);"

# Doc formatting (prettier is ERROR-enforced):
npx prettier --check docs/TESTING.md
# If it fails: npx prettier --write docs/TESTING.md && npx prettier --check docs/TESTING.md

# Lint the edited doc isn't required (eslint targets .ts only), but format:check covers it.
```

### Level 2: Unit Tests (Component Validation)

```bash
# N/A — this subtask adds no source and no tests. It only changes a script string + a doc note.
# (The full test suite is invoked BY the new validate script in Level 3.)
```

### Level 3: Integration Testing (System Validation)

```bash
# THE gate. Characterize the exit; do NOT assume 0.
npm run validate; echo "validate exit: $?"
#   Branch A (green tree): exit 0  — all of lint, format:check, typecheck, test:run pass.
#   Branch B (current tree): exit non-zero at the pre-existing typecheck failure
#     (tasks-json-recovery.ts → gitFileHistory/gitReadFileAtCommit). && short-circuits before
#     test:run. This is PRE-EXISTING and out of scope; document it, do not fix it.

# Confirm the appended script name resolves (subtask-local):
npm run | grep -E "test:run|validate"

# Confirm the doc note is present:
grep -n "npm run validate" docs/TESTING.md
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Branch A only — prove the new gate ordering actually reaches test:run on a green tree:
#   (static gates pass, then vitest runs). On the current tree this is not observable
#   (typecheck short-circuits), so skip unless on Branch A.
#
# Reasoning to record in the commit message / task result (both branches):
#   - validate is now self-contained: lint + format:check + typecheck + test:run (Issue 2, Option a).
#   - The edit is a single string append; the appended name (test:run) already exists.
#   - On the current divergent tree, validate was already red at typecheck; appending test:run
#     is a no-op there and only takes effect once the tree is reconciled to a green state.
#   - prebuild (npm run validate) now requires a green suite — intended (no false greens).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] Task 1 precondition probe executed; Branch A or B recorded (with HEAD sha).
- [ ] `node -e` assertion prints `validate OK: npm run lint && npm run format:check && npm run typecheck && npm run test:run`.
- [ ] `npx prettier --check docs/TESTING.md` passes (or was auto-fixed).
- [ ] `npm run | grep test:run` lists `test:run` (appended name resolves).

### Feature Validation
- [ ] `package.json` `scripts.validate` ends with `&& npm run test:run`; nothing else in the block changed.
- [ ] `docs/TESTING.md` "Test Commands" subsection contains the commit-time-gate note.
- [ ] **Branch A:** `npm run validate` exits 0.
- [ ] **Branch B:** `npm run validate` exit code + failing gate recorded as pre-existing (not this subtask).

### Code Quality Validation
- [ ] Only `package.json` and `docs/TESTING.md` are modified — no source, no tests.
- [ ] The `=== Validation ===` comment grouping and the `fix` script are unchanged.
- [ ] No CONTRIBUTING.md created; no README.md edit (out of scope — P1.M3.T4).
- [ ] No attempt to fix the 2 typecheck errors or any of the 250 test failures.
- [ ] Doc note uses blockquote (`>`) formatting consistent with the file.

### Documentation & Deployment
- [ ] `docs/TESTING.md` clearly states `npm run validate` includes `test:run`.
- [ ] Task result states which branch (A/B) was taken, the HEAD sha, and (Branch B) the
      pre-existing red-gate breakdown, so the orchestrator/human can reconcile the tree.

---

## Anti-Patterns to Avoid

- ❌ Don't skip the Task 1 precondition probe — the current tree is red and diverged from `main@4e6d2ef`.
- ❌ Don't interpret a non-zero `npm run validate` on the current tree as a defect of this subtask — it fails at the pre-existing `typecheck` error, BEFORE `test:run`.
- ❌ Don't try to fix the 2 typecheck errors (`tasks-json-recovery.ts`) or any of the 250 test failures — out of scope; tree reconciliation is an orchestrator concern.
- ❌ Don't choose Option (b) (document validate as static-only). The contract prefers Option (a): make it self-contained.
- ❌ Don't edit any script other than `validate` (leave `fix`, `test`, `test:run`, `prebuild`, the section comments untouched).
- ❌ Don't create `CONTRIBUTING.md` or edit `README.md` — both out of scope (README sync is P1.M3.T4).
- ❌ Don't let prettier fail on the edited doc — run `npx prettier --write docs/TESTING.md` if needed.
- ❌ Don't add a new `##` heading to TESTING.md (which would require a Table-of-Contents update) — use an inline blockquote note.

---

## Confidence Score

**Branch A (green tree, e.g. `main@4e6d2ef` with the logger fix): 10/10.** A literal
single-string append to `package.json` (verified target string) plus a verbatim markdown note
at a pinned location; the appended script name (`test:run`) already exists; `npm run validate`
exits 0 by construction (all four gates green). No unknowns.

**Branch B (current red tree): 10/10 for the deliverable, with an honest verification caveat.**
The two edits are unconditionally correct and verifiable via Task 4 (a)–(c). `npm run validate`
stays red, but that redness is **pre-existing** (typecheck: `tasks-json-recovery.ts` → missing
`gitFileHistory`/`gitReadFileAtCommit`; tests: 250 failures from missing R1/R2 constants +
environment mismatches), NOT caused by this subtask. On the current tree the edit is even a
**behavioral no-op** (validate already short-circuits at typecheck), so there is zero risk of
making anything worse. The PRP documents the divergence thoroughly for orchestrator
reconciliation.

**Overall note (outside the PRP's control):** the only residual risk is orchestrator-level —
whether the tree gets reconciled to `main@4e6d2ef` (Branch A, validate goes green and now
covers tests) or stays on the divergent HEAD (Branch B, validate stays pre-existingly red).
Either way, the implementing agent cannot fail if it follows Task 1's branch logic and makes
the two correct edits.
