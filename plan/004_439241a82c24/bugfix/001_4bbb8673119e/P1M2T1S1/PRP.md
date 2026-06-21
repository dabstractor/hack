# PRP — P1.M2.T1.S1: Add `markdownlint-cli` to devDependencies and confirm the `docs:lint` script resolves

> **Bugfix subtask** — Issue 3 of `plan/004_439241a82c24/bugfix/001_4bbb8673119e/TEST_RESULTS.md`.
> `npm run docs:lint` fails with `markdownlint: command not found` because the package is
> neither in `devDependencies` nor installed under `node_modules`.

---

## Goal

**Feature Goal**: Make the `markdownlint` command resolvable so that `npm run docs:lint`
and `npm run docs:lint:fix` **execute markdownlint** instead of dying with
`sh: line 1: markdownlint: command not found`. This is a **single dependency installation**
with **zero source-code changes and zero script edits** — surgical, config-only.

**Deliverable**:
1. `package.json` gains `"markdownlint-cli": "^0.49.0"` (or latest) in `devDependencies`
   (alphabetical placement, consistent with the existing sorted list).
2. `package-lock.json` is updated atomically by `npm install --save-dev markdownlint-cli`.
3. `node_modules/.bin/markdownlint` shim exists and `npx markdownlint --version` prints a
   version string.

**Success Definition**:
- `npm run docs:lint` **no longer exits with `command not found`** — it invokes the real
  `markdownlint` binary against `docs/**/*.md`.
- The exit is allowed to be non-zero (lint violations are expected and are fixed in
  **P1.M2.T1.S2**, NOT here). The pass/fail signal for S1 is "the binary resolved and ran",
  distinguishable from "command not found".
- The `docs:lint` and `docs:lint:fix` script strings in `package.json` are **unchanged**.
- **No source file under `src/` is modified.** No `.markdownlint.json` config is added
  (config belongs to S2).

---

## Why

- **Restores a broken validation gate (TEST_RESULTS.md Issue 3).** The P1.M2.T3 contracts
  ("Run `npm run docs:lint` ... fix lint/format issues") and every doc-touching task rely on
  this script. Today it can never run, so none of those contracts could have been honestly
  satisfied. PRD §h3.2 / §h2.4 ("Testing Summary" → "`npm run docs:lint` gate is not green").
- **`markdownlint-cli` provides the exact binary the script calls.** Verified via
  `npm view markdownlint-cli bin` → `{ markdownlint: 'markdownlint.js' }`. The installed
  command is literally `markdownlint`, which is what `docs:lint`/`docs:lint:fix` already
  invoke — so **no script edits are required**. (Contrast: `markdownlint-cli2` installs as
  `markdownlint-cli2` and would force rewriting both scripts — wrong package, rejected.)
- **Why npm and not pnpm/yarn:** the project pins `"groundswell": "file:.yalc/groundswell"`
  (yalc) and tracks resolution in `package-lock.json`. Only `npm install --save-dev` keeps
  `package.json` and `package-lock.json` mutually consistent for this setup. (Contract RESEARCH
  NOTE point (d).)
- **Scope guard:** This subtask is intentionally minimal. Fixing the actual markdownlint
  violations (or adding a config file) is **P1.M2.T1.S2**. The `npm run validate` gate
  (Issue 4 type-drift + format:check) is **P1.M2.T2**. S1 does NOT make lint *pass* and does
  NOT touch `npm run validate`.

---

## What

### User-visible behavior
None at runtime. Developer-facing: `npm run docs:lint` now launches markdownlint instead of
erroring immediately.

### Technical requirements (exact contract — verbatim from the work item)

**(a) Install the package as a devDependency:**
```bash
npm install --save-dev markdownlint-cli
```
(Equivalent: `npm install -D markdownlint-cli`.) This adds the `^0.49.0` (or newer latest)
entry to `devDependencies` AND updates `package-lock.json` in one atomic operation.

**(b) Confirm the binary resolves** (at least one of):
```bash
ls node_modules/.bin/markdownlint          # the shim file must exist
npx markdownlint --version                 # must print a version (0.49.x)
```

**(c) Do NOT change the scripts.** `package.json` lines stay exactly:
```json
"docs:lint": "markdownlint \"docs/**/*.md\"",
"docs:lint:fix": "markdownlint \"docs/**/*.md\" --fix",
```
The `markdownlint-cli` binary name is `markdownlint`, so the scripts already match.

**(d) Run the gate:**
```bash
npm run docs:lint
```

### Success Criteria

- [ ] `package.json` `devDependencies` contains `"markdownlint-cli"` (range `^0.49.0` or newer).
- [ ] `package-lock.json` contains a `node_modules/markdownlint-cli` entry (install was atomic).
- [ ] `node_modules/.bin/markdownlint` exists; `npx markdownlint --version` prints a version.
- [ ] `npm run docs:lint` **invokes markdownlint** — output is lint results / `MDxxx` violations,
      NOT `markdownlint: command not found`.
- [ ] The `docs:lint` and `docs:lint:fix` script strings are byte-for-byte unchanged.
- [ ] No file under `src/` is modified. No `.markdownlint*` config file is created.
- [ ] `devDependencies` entry is placed to preserve the block's existing alphabetical ordering.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to
implement this successfully?_ **Yes** — the task is a single `npm install -D` of a
named package, the exact binary name is verified against the registry, the scripts that
consume it are quoted verbatim, and the pass/fail signal is explicitly disambiguated from
the deferred S2 work. No judgement calls remain.

### Documentation & References

```yaml
# MUST READ — root-cause + scope boundaries
- docfile: plan/004_439241a82c24/bugfix/001_4bbb8673119e/architecture/system_context.md
  section: "4. Issue 3 Root Cause & Fix Surface"
  why: Authoritative root cause — markdownlint-cli is NOT in devDependencies and NOT installed
        anywhere under node_modules; the fix is `npm install --save-dev markdownlint-cli`.
        Also states the S1/S2 split: install here, fix violations (or add config) in the NEXT subtask.
  critical: >
    Confirms the script `docs:lint: "markdownlint \"docs/**/*.md\""` invokes the shim binary that
    markdownlint-cli provides, so NO script change is required. Violations surfacing after install
    are expected and belong to P1.M2.T1.S2.

- docfile: plan/004_439241a82c24/bugfix/001_4bbb8673119e/architecture/test_and_docs_recon.md
  section: "5. `markdownlint-cli` in devDependencies? — NOT present"
  why: Line-level evidence that markdownlint is referenced ONLY by the two npm scripts and is
        absent from both dependencies blocks and node_modules. Also documents the yalc groundswell
        dep + npm lockfile model that mandates `npm install` (not pnpm/yarn).

- docfile: plan/004_439241a82c24/bugfix/001_4bbb8673119e/TEST_RESULTS.md
  section: "Issue 3" (Minor Issues — Nice to Fix)
  why: The authoritative bug report and acceptance language this PRP encodes.

# WORK-ITEM RESEARCH NOTE (verified facts, do not re-discover)
- docfile: plan/004_439241a82c24/bugfix/001_4bbb8673119e/P1M2T1S1/research/markdownlint-cli.md
  section: "1. The binary-name decision" and "4. What npm run docs:lint will do after install"
  why: Records the verified `npm view ... bin` output that picks markdownlint-cli (bin=markdownlint)
        over markdownlint-cli2 (bin=markdownlint-cli2), and documents the expected post-install
        behavior (script RUNS, likely reports violations — that is S1 success, NOT failure).

# EXTERNAL DOCS
- url: https://github.com/igorshubovych/markdownlint-cli#readme
  why: Confirms the installed command name (`markdownlint`), the `--fix` flag the docs:lint:fix
        script relies on, and CLI usage. (For S2: the Configuration section lists supported
        config file formats.)

# THE ONLY FILE EDITED (npm rewrites it; do NOT hand-edit)
- file: package.json
  why: npm will insert the devDependency. The scripts block (lines 56-57) and the dependency
        blocks are the contract surface.
  pattern: |
    "scripts": {
      ...
      "docs:lint": "markdownlint \"docs/**/*.md\"",          # UNCHANGED
      "docs:lint:fix": "markdownlint \"docs/**/*.md\" --fix", # UNCHANGED
      ...
    },
    "devDependencies": {
      ...
      "markdownlint-cli": "^0.49.0",   # ← npm ADDS this (alphabetical slot, after `eslint-*`/before `nodemon` per current sort)
      ...
    }
  gotcha: >
    Let `npm install --save-dev` write both package.json AND package-lock.json. Do NOT hand-edit
    either file — a hand-edited package.json without a matching lockfile entry will desync the
    yalc `file:.yalc/groundswell` resolution and break `npm ci` / fresh installs.
```

### Current Codebase tree (relevant slice)

```bash
.
├── package.json          # EDIT by npm — +1 devDependency entry; scripts UNCHANGED
├── package-lock.json     # EDIT by npm — +markdownlint-cli +transitive deps (node_modules/markdownlint-cli ...)
├── node_modules/
│   └── .bin/
│       └── markdownlint  # NEW shim (symlink) created by npm on install
├── docs/                 # 20+ *.md files (lint targets) — UNCHANGED, untouched by S1
│   ├── CONFIGURATION.md
│   ├── GROUNDSWELL_GUIDE.md
│   ├── research/
│   └── api/              # generated TypeDoc output — glob may catch *.md here too; out of scope to filter
└── (no .markdownlint.json / .markdownlintrc exists — S2 may add one)
```

### Desired Codebase tree with files to be added/edited

```bash
package.json              # MODIFIED by `npm install -D` (devDependencies += markdownlint-cli)
package-lock.json         # MODIFIED by `npm install -D` (lock entries added)
node_modules/.bin/markdownlint   # CREATED by npm (shim — gitignored, not committed)
# No new files under src/, tests/, or docs/. No config file added.
```

### Known Gotchas of our codebase & Library Quirks

```bash
# CRITICAL — install `markdownlint-cli`, NOT `markdownlint-cli2`.
#   `npm view markdownlint-cli  bin`  → { markdownlint: 'markdownlint.js' }            ✅ matches the script
#   `npm view markdownlint-cli2 bin`  → { 'markdownlint-cli2': '...' }                 ❌ different command
# Installing cli2 would force rewriting docs:lint/docs:lint:fix and is explicitly NOT what the contract wants.

# CRITICAL — use `npm install --save-dev`, never pnpm/yarn, never a manual package.json edit.
#   The project uses `"groundswell": "file:.yalc/groundswell"` (yalc) and tracks state in
#   package-lock.json. Only npm keeps package.json + package-lock.json consistent for this setup.

# GOTCHA — "command not found" vs "lint violations" are DIFFERENT outcomes.
#   S1 PASS  = `npm run docs:lint` prints markdownlint output (MDxxx violations, file paths, summary).
#              A non-zero exit here is FINE — fixing those violations is P1.M2.T1.S2.
#   S1 FAIL  = `npm run docs:lint` prints `sh: line 1: markdownlint: command not found`
#              (i.e. the binary still did not resolve).

# GOTCHA — do NOT add a .markdownlint.json / .markdownlintrc config in S1.
#   The "or add config" clause belongs to P1.M2.T1.S2. Adding it here collides with that subtask.

# GOTCHA — do NOT touch `docs:links` (`markdown-link-check ... || true`).
#   It is a different, unrelated tool, already wrapped to never fail. Out of scope.

# GOTCHA — `npm run validate` will STILL FAIL after S1.
#   It runs `lint && format:check && typecheck`, and the 18 pre-existing ToolExecutor type-drift
#   errors (src/tools/{bash,filesystem,git}-mcp.ts) + the generated-state format:check failures are
#   Issue 4 → P1.M2.T2. S1's acceptance is independent of `npm run validate`; do NOT run it as a gate.

# GOTCHA — the quotes in `markdownlint "docs/**/*.md"` are intentional and MUST stay.
#   They prevent the shell from expanding `**` and hand the raw glob to markdownlint-cli, which
#   globs internally (globby). Removing the quotes can break recursion on POSIX shells.
```

---

## Implementation Blueprint

### Data models and structure

None — this is a dependency manifest change performed by the package manager. No types,
classes, constants, or source code are introduced.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: INSTALL markdownlint-cli as a devDependency
  - RUN: `npm install --save-dev markdownlint-cli`
  - EXPECT: npm prints "added N packages" and exits 0. (Node v26 / npm 11 — fully compatible.)
  - VERIFY package.json: a new `"markdownlint-cli": "^0.49.0"` (or newer latest) entry now sits in
        devDependencies, in the alphabetically correct slot.
  - VERIFY package-lock.json: a `node_modules/markdownlint-cli` entry (plus the markdownlint +
        markdown-it transitive deps) now exists — confirming the atomic lockfile update.
  - DO NOT: hand-edit package.json or package-lock.json. Do NOT use pnpm/yarn. Do NOT pin a
        non-caret range (npm's default `^` is correct and matches the rest of devDependencies).
  - PLACEMENT: devDependencies block of package.json (npm places it correctly).

Task 2: CONFIRM the markdownlint binary resolves
  - RUN: `ls node_modules/.bin/markdownlint`
        EXPECT: the path prints (shim symlink exists).
  - RUN: `npx markdownlint --version`
        EXPECT: a version string (0.49.x). Non-zero exit / "command not found" = install failed.
  - DO NOT: invoke `markdownlint-cli2` or change the script to `npx markdownlint-cli ...`.
        The contract's fallback only applies IF the binary name differed — it does not.

Task 3: RUN the docs:lint gate and classify the exit
  - RUN: `npm run docs:lint`
  - EXPECT (S1 PASS): markdownlint EXECUTES — output contains file paths and/or `MDxxx` rule
        violation lines and a summary (e.g. "X:Y MDxxx/..."). Exit code MAY be non-zero.
  - EXPECT (S1 FAIL): `sh: line 1: markdownlint: command not found` — binary did not resolve.
  - DO NOT: fix any reported violations here. Do NOT add a config file. Do NOT edit docs/*.md.
        All violation remediation + optional config is P1.M2.T1.S2.
  - RECORD: paste the actual `npm run docs:lint` tail into the commit message / acceptance
        evidence so a reviewer can confirm "executed, not command-not-found".

Task 4: CONFIRM scope hygiene (no collateral edits)
  - RUN: `git status --short` and `git diff -- package.json`
  - EXPECT: ONLY package.json + package-lock.json changed (node_modules is gitignored).
  - EXPECT: the package.json diff is exactly ONE new devDependency line; the `scripts` block
        (docs:lint / docs:lint:fix / docs:links) is byte-for-byte unchanged.
  - DO NOT: stage or create any file under src/, tests/, docs/, or a new .markdownlint* config.
```

### Implementation Patterns & Key Details

```bash
# PATTERN — the complete, literal command sequence for S1 (run from the repo root):

# 1. Install (atomic: updates package.json + package-lock.json + creates the .bin shim)
npm install --save-dev markdownlint-cli

# 2. Verify the shim + version
ls node_modules/.bin/markdownlint
npx markdownlint --version

# 3. Run the gate — classify by OUTPUT, not by exit code
npm run docs:lint
#   → PASS signal: markdownlint runs (prints MDxxx violations / file:line summary). Non-zero OK.
#   → FAIL signal: "markdownlint: command not found".

# 4. Scope-hygiene check
git status --short
git diff -- package.json     # exactly one new devDependency line; scripts unchanged
```

```json
// PATTERN — expected package.json diff (hunk-level). The devDependencies block is already
// alphabetically sorted; npm preserves that, landing markdownlint-cli between the
// eslint-plugin-prettier/nodemon neighbors per its sort position.
//
//   "devDependencies": {
//     ...
//     "eslint-plugin-prettier": "^5.5.4",
// +   "markdownlint-cli": "^0.49.0",
//     "nodemon": "^3.0.2",
//     ...
//   }
//
// The "scripts" block is UNCHANGED:
//   "docs:lint": "markdownlint \"docs/**/*.md\"",
//   "docs:lint:fix": "markdownlint \"docs/**/*.md\" --fix",
```

### Integration Points

```yaml
PACKAGE MANIFEST (the only edited surface):
  - package.json:        devDependencies += "markdownlint-cli": "^0.49.0"; scripts UNCHANGED.
  - package-lock.json:   node_modules/markdownlint-cli + transitive deps added atomically by npm.

NPM SCRIPTS (consumers — UNCHANGED, now functional):
  - docs:lint:           `markdownlint "docs/**/*.md"`              → now resolves the shim.
  - docs:lint:fix:       `markdownlint "docs/**/*.md" --fix`        → now resolves the shim (S2 uses this).
  - docs:links:          `markdown-link-check ...` — UNRELATED tool, out of scope, leave alone.

DOWNSTREAM (this subtask UNBLOCKS but does NOT complete):
  - P1.M2.T1.S2:         will run `npm run docs:lint`, triage the MDxxx violations, and either fix
                          the docs or add a `.markdownlint.json` config so docs:lint exits 0.
  - P1.M2.T3.S1:         final validation — will assert `npm run docs:lint` exits 0 (depends on S2).

NOT INTEGRATED (do NOT attempt in S1):
  - npm run validate:    still fails on Issue-4 typecheck/format:check (P1.M2.T2 owns it).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Validate the manifest edits npm just made are well-formed JSON and the scripts are intact.
node -e "const p=require('./package.json'); console.assert(p.devDependencies['markdownlint-cli'], 'missing devDep'); console.assert(p.scripts['docs:lint']==='markdownlint \"docs/**/*.md\"', 'script changed'); console.assert(p.scripts['docs:lint:fix']==='markdownlint \"docs/**/*.md\" --fix', 'fix script changed'); console.log('manifest OK', p.devDependencies['markdownlint-cli']);"
# Expected: "manifest OK ^0.49.0" (or newer). Any assertion error = npm mutated a script — investigate.

# Confirm the lockfile is valid and consistent with package.json (no hand-edit drift).
npm ls markdownlint-cli
# Expected: "markdownlint-cli@0.49.0" listed under devDependencies, no "invalid: ..."/"missing" warnings.
```

### Level 2: Unit Tests (Component Validation)

```bash
# N/A — this subtask adds a dev tool; it introduces zero source under src/ and zero tests.
# The existing test suite is unaffected (markdownlint-cli is a devDependency, not imported by any
# src/ or tests/ file). Do NOT run `npm run test:run` as an S1 gate.
```

### Level 3: Integration Testing (System Validation)

```bash
# THE gate for S1: docs:lint must EXECUTE (resolve the binary), not error with "command not found".
ls node_modules/.bin/markdownlint        # Expected: path prints (shim present).
npx markdownlint --version               # Expected: 0.49.x

npm run docs:lint
# Expected: markdownlint output (file paths + MDxxx rule IDs + summary). Exit code may be non-zero.
#   PASS for S1: it RAN. (Violations are P1.M2.T1.S2's job.)
#   FAIL for S1: "sh: line 1: markdownlint: command not found".

# Optional: confirm the --fix variant also resolves (do NOT commit any fixes it applies — S2 owns that).
#   npm run docs:lint:fix -- --dry-run   # if supported; otherwise just observe it resolves the binary.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Scope-hygiene assertion — S1 must touch ONLY the manifest, nothing else.
git status --short
# Expected: exactly
#    M package.json
#    M package-lock.json
# (node_modules is gitignored.) Any other modified/added file (src/, tests/, docs/, .markdownlint*)
# = scope creep — revert it.

git diff -- package.json
# Expected: a single +/- hunk adding the "markdownlint-cli" devDependency line. The scripts block
# (docs:lint / docs:lint:fix / docs:links) must show ZERO changes.

# Domain reasoning (record in commit message):
#   - markdownlint-cli (bin=markdownlint) was chosen over markdownlint-cli2 (bin=markdownlint-cli2)
#     so the existing scripts work unchanged — verified via `npm view ... bin`.
#   - npm install -D was used (not pnpm/yarn, not a hand-edit) to keep package.json + package-lock.json
#     consistent with the yalc `file:.yalc/groundswell` dependency.
#   - Any lint violations surfaced are EXPECTED and deferred to P1.M2.T1.S2.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npm install --save-dev markdownlint-cli` exited 0 ("added N packages").
- [ ] `node -e ...` manifest assertion prints `manifest OK ^0.49.0` (or newer); scripts unchanged.
- [ ] `npm ls markdownlint-cli` lists it under devDependencies with no "missing"/"invalid" warnings.
- [ ] `ls node_modules/.bin/markdownlint` prints the shim path.
- [ ] `npx markdownlint --version` prints a version string.
- [ ] `npm run docs:lint` **executes markdownlint** (output = MDxxx violations / summary), NOT `command not found`.

### Feature Validation

- [ ] `package.json` `devDependencies` includes `markdownlint-cli` at a caret range.
- [ ] `package.json` `scripts.docs:lint` is still `markdownlint "docs/**/*.md"` (byte-for-byte).
- [ ] `package.json` `scripts.docs:lint:fix` is still `markdownlint "docs/**/*.md" --fix`.
- [ ] `npm run docs:lint` no longer fails with `command not found`.
- [ ] Non-zero exit from `npm run docs:lint` (due to violations) is explicitly ACCEPTED for S1.
- [ ] Acceptance evidence (the `npm run docs:lint` tail) captured for review.

### Code Quality Validation

- [ ] `git status --short` shows ONLY `package.json` + `package-lock.json` modified.
- [ ] `git diff -- package.json` is a single new devDependency line; scripts block unchanged.
- [ ] No file under `src/`, `tests/`, or `docs/` was modified.
- [ ] No `.markdownlint.json` / `.markdownlintrc` / config file created (deferred to S2).
- [ ] `markdownlint-cli2` was NOT installed; `docs:links` / `markdown-link-check` was NOT touched.
- [ ] devDependency entry preserves the block's alphabetical ordering.

### Documentation & Deployment

- [ ] Commit message cites Issue 3 and notes: (a) `markdownlint-cli` chosen over `cli2` for binary-name match;
      (b) violations are deferred to P1.M2.T1.S2; (c) `npm run validate` still red until P1.M2.T2.
- [ ] Commit does NOT include `node_modules/` (gitignored) — only the two manifest files.

---

## Anti-Patterns to Avoid

- ❌ Don't install `markdownlint-cli2` — its binary is `markdownlint-cli2`, which would force rewriting both scripts. Use `markdownlint-cli` (binary = `markdownlint`).
- ❌ Don't use pnpm/yarn or hand-edit `package.json` — the yalc `file:.yalc/groundswell` dep + npm `package-lock.json` require `npm install --save-dev` for a consistent atomic update.
- ❌ Don't edit the `docs:lint` / `docs:lint:fix` script strings — the `markdownlint` shim name already matches.
- ❌ Don't fix markdownlint violations here, and don't add a `.markdownlint.json` config — that is the entire scope of **P1.M2.T1.S2**.
- ❌ Don't treat a non-zero `npm run docs:lint` exit as failure — the S1 signal is "binary resolved and ran", distinct from "command not found". Violations are expected and deferred.
- ❌ Don't run `npm run validate` as an S1 gate — it still fails on Issue 4 (P1.M2.T2) and is independent of this subtask.
- ❌ Don't touch `docs:links` / `markdown-link-check` — unrelated tool, out of scope.
- ❌ Don't commit `node_modules/` or leave any stray modified file under `src/`/`tests/`/`docs/`.

---

## Confidence Score

**10/10** — One-pass implementation success likelihood.

Rationale: The task is a single `npm install --save-dev markdownlint-cli` command. The single
decision point — which package to install — is resolved with verified evidence: `npm view
markdownlint-cli bin` returns `{ markdownlint: 'markdownlint.js' }`, an exact match for the
existing script's invoked command, so `markdownlint-cli2` (binary `markdownlint-cli2`) is
correctly rejected and **no script edits are needed**. The environment is modern (Node v26 /
npm 11.16) and `package-lock.json` exists, so `npm install -D` will atomically and
consistently update both `package.json` and the lockfile — the yalc `file:.yalc/groundswell`
constraint mandates npm, which is what the contract specifies. The only nuance — that
`npm run docs:lint` will likely exit non-zero with `MDxxx` violations — is explicitly
disambiguated from the real failure mode (`command not found`) and scoped out to
P1.M2.T1.S2. Every command, expected output, and scope boundary is pinned with line-level
evidence in the research note and architecture docs.
