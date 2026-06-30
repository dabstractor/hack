name: "P1.M1.T2.S1 — Commit the Groundswell working-tree fix with a conventional commit"
description: |

---

## Goal

**Feature Goal**: Commit the already-written, file-backed `AuthStorage.create()` fix in the
**separate Groundswell repository** (`~/projects/groundswell`) as a single atomic conventional
commit on `main`, then rebuild the gitignored `dist/` and verify it contains the fix. This is
the prerequisite for P1.M1.T2.S2 (link the fixed dist into hacky-hack) and for the eventual
semantic-release auto-publish of Groundswell v1.0.1.

**Deliverable**: One new git commit on `~/projects/groundswell` `main` containing all 5 modified
files (2 source + 3 tests), with a `fix(harnesses):` conventional-commit message; a freshly
rebuilt `~/projects/groundswell/dist/` whose `dist/harnesses/pi-harness.js` calls
`AuthStorage.create()` (not `inMemory()`); and a clean `git status`. **No hacky-hack files
change in this subtask.**

**Success Definition**:
- `cd ~/projects/groundswell && git status --short` → **empty** (all 5 files committed).
- `git log -1 --format='%s'` → `fix(harnesses): use file-backed AuthStorage.create() over inMemory() to honor ~/.pi/agent/auth.json (PRD §9.2.6)`.
- `git show --stat HEAD` → exactly the 5 files below, no more.
- `npm run build` (in groundswell) exits 0.
- `grep -n 'AuthStorage\.\(create\|inMemory\)()' dist/harnesses/pi-harness.js` shows
  `this.authStorage = options?.authStorage ?? AuthStorage.create();` and does **not** show
  `AuthStorage.inMemory()` in the constructor body.

## User Persona (if applicable)

**Target User**: Maintainer of the cross-repo Groundswell dependency (and, downstream, every
hacky-hack user who authenticates via `pi /login`).

**Use Case**: Land the file-backed auth fix on Groundswell `main` so that (a) the local `npm link`
verification (P1.M1.T2.S2) and the integration test (P1.M1.T1) can run against committed code,
and (b) a subsequent push triggers semantic-release to publish v1.0.1.

**Pain Points Addressed**: Today the fix exists only in Groundswell's **uncommitted** working
tree. It cannot be deployed, linked reproducibly, or published until it is committed. The
stale published v1.0.0 (`AuthStorage.inMemory()`) ignores `~/.pi/agent/auth.json`, so every
`pi /login` user hits a deep "No API key found for zai" failure (PRD §9.2.6 / §9.2.7).

## Why

- **PRD §9.2.6 / §9.5 compliance**: "`pi` auth.json … **This must be honored**". The Groundswell
  fix switches the `pi` harness from `AuthStorage.inMemory()` to `AuthStorage.create()`, which
  reads `~/.pi/agent/auth.json`. Committing it is the irreducible first step to honoring that.
- **PRD Issue 1 (Critical) root cause**: the fix is written but uncommitted (and un-deployed).
  This subtask closes the "written but uncommitted" half; S2 closes the "un-deployed" half.
- **Atomicity**: the 5 files are one logical change (types addition enables pi-harness option
  injection; the tests assert the new behavior). Committing them together keeps the repo
  bisectable and the commit self-consistent. Committing a subset would leave a broken tree.
- **Release mechanism**: Groundswell uses semantic-release; a `fix(harnesses):` commit on push
  → patch → auto-publishes v1.0.1. This commit message is crafted to feed that pipeline.

## What

A **cross-repo git operation** in `~/projects/groundswell` (NOT hacky-hack). Three actions:

### Action 1 — Stage all 5 modified files

```bash
cd ~/projects/groundswell
git add src/harnesses/pi-harness.ts \
        src/types/harnesses.ts \
        src/__tests__/unit/harnesses-types.test.ts \
        src/__tests__/unit/providers/pi-harness-initialize.test.ts \
        src/__tests__/unit/providers/pi-harness-resolvemodel.test.ts
```

### Action 2 — Commit with the exact conventional-commit message

```bash
git commit -m "fix(harnesses): use file-backed AuthStorage.create() over inMemory() to honor ~/.pi/agent/auth.json (PRD §9.2.6)"
```

### Action 3 — Rebuild dist and verify

```bash
npm run build
grep -n 'AuthStorage\.\(create\|inMemory\)()' dist/harnesses/pi-harness.js
# Expect: this.authStorage = options?.authStorage ?? AuthStorage.create();
```

### Constraints (DO/DON'T)

- **DO** stage exactly those 5 files (the working tree contains exactly these 5 modifications —
  no untracked files, no other changes). Using `git add -A` is acceptable ONLY because the
  working tree is verified clean except for these 5; the explicit form above is preferred.
- **DO** use the exact commit message verbatim (semantic-release parses `fix(harnesses):` → patch).
- **DO** rebuild dist after committing (dist is gitignored, so the commit does not include it;
  rebuilding guarantees freshness for the S2 link step).
- **DON'T** push to GitHub (CI-gated; tracked separately; out of scope for this subtask).
- **DON'T** run `npm publish` (CI-gated via semantic-release; out of scope).
- **DON'T** run `npm link` in either repo (that is P1.M1.T2.S2).
- **DON'T** modify ANY hacky-hack file (no source, no lockfile, no docs — all deferred to S2+).
- **DON'T** amend, squash, or split the commit. One atomic commit of all 5 files.

### Success Criteria

- [ ] `git status --short` (groundswell) is empty.
- [ ] `git log -1 --format='%s'` matches the exact message above.
- [ ] `git show --stat HEAD` lists exactly the 5 files.
- [ ] `npm run build` (groundswell) exits 0.
- [ ] `grep … dist/harnesses/pi-harness.js` shows `AuthStorage.create()` in the constructor body.

## All Needed Context

### Context Completeness Check

_Pass._ A developer who has never seen either repo can execute this from the exact commands
above. The fix is already written (no code to author); this is a pure git + build + verify
operation. The only non-obvious facts — that dist is gitignored, that the repo uses
semantic-release, that all 5 files must be committed atomically — are documented below with
verification commands.

### Documentation & References

```yaml
# MUST READ - Include these in your context window

- docfile: plan/007_8783a1f5e14a/bugfix/001_7912d248208a/architecture/deployment_strategy.md
  why: Authoritative deployment strategy. Confirms (a) the fix is written-but-uncommitted in
        ~/projects/groundswell, (b) dist is gitignored, (c) semantic-release publishes on push
        from a fix: commit, (d) the npm-link local path is the S2 deliverable, (e) push/publish
        is CI-gated and out of scope here.
  section: "Recommended Approach for This Bugfix" + "Cross-Repo Considerations"
  critical: |
    The strategy explicitly scopes THIS subtask as step 1 ("Commit the groundswell fix") only.
    Steps 2 (npm link) and 3 (publish path documentation) belong to S2 and the CI follow-up.
    The implementer MUST NOT push or publish here — those require GitHub/npm credentials held
    by CI, not the agent.

- docfile: PRD.md  (hacky-hack)
  section: §9.2.6 ("Provider-Agnostic Authentication Model" — "`pi` auth.json … must be honored")
  why: The PRD reference cited in the commit message footer. Confirms the fix's rationale.

- file: ~/projects/groundswell/src/harnesses/pi-harness.ts
  why: Primary source file being committed. Shows the exact changed lines.
  pattern: |
    // File-backed by default (PRD §9.2.6): AuthStorage.create() reads ~/.pi/agent/auth.json
    // (overridable via PI_CODING_AGENT_DIR); ModelRegistry.create() reads models.json.
    this.authStorage = options?.authStorage ?? AuthStorage.create();
    this.modelRegistry = options?.modelRegistry ?? ModelRegistry.create(this.authStorage);
  gotcha: |
    `dist/` is gitignored in groundswell — `git status` does NOT list dist changes, and the
    commit will NOT include dist. CI rebuilds dist before publishing. The local rebuild in
    Action 3 is only to guarantee the S2 link step picks up fresh artifacts.

- file: ~/projects/groundswell/src/types/harnesses.ts
  why: Second source file being committed. Adds the `authStorage?` / `modelRegistry?` options
        to HarnessOptions that pi-harness.ts consumes (the two are an atomic pair).
  pattern: |
    import type { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
    // … in HarnessOptions:
    authStorage?: AuthStorage;
    modelRegistry?: ModelRegistry;

- file: ~/projects/groundswell/.gitignore
  why: Confirms `dist/` is gitignored (so the rebuild does not dirty the tree and the commit
        excludes it). Also confirms no other working-tree noise will be swept into the commit.
  gotcha: |
    If `git status` shows ANYTHING beyond the 5 known files (e.g. dist/, coverage/, a stray
    file), STOP — do not `git add -A`. Stage only the 5 explicit paths. The verified pre-state
    is exactly 5 modified tracked files and nothing else.
```

### Current Codebase tree (relevant slice — `~/projects/groundswell`)

```bash
~/projects/groundswell/                  # SEPARATE REPO — all work happens here
├── src/
│   ├── harnesses/
│   │   └── pi-harness.ts                # ← COMMIT (AuthStorage.create() at initialize)
│   ├── types/
│   │   └── harnesses.ts                 # ← COMMIT (+ authStorage?/modelRegistry? options)
│   └── __tests__/unit/
│       ├── harnesses-types.test.ts      # ← COMMIT (option typings)
│       └── providers/
│           ├── pi-harness-initialize.test.ts    # ← COMMIT (file-backed default)
│           └── pi-harness-resolvemodel.test.ts  # ← COMMIT (resolve behavior)
├── dist/                                # gitignored — rebuilt by `npm run build`, NOT committed
│   └── harnesses/pi-harness.js          # md5 d3de7234… (fixed) — verify post-build
├── .gitignore                           # dist/ listed here
├── .releaserc.json                      # semantic-release config (fix: → patch → 1.0.1)
└── package.json                         # name: groundswell, version: 1.0.0, ESM
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. The 5 existing modified files become a single committed changeset on main.
# dist/ is rebuilt (gitignored) but not committed.
~/projects/groundswell/  →  one new commit on `main` (HEAD advances by 1).
```

### Known Gotchas of our codebase & Library Quirks

```bash
# CRITICAL: This is a CROSS-REPO operation. ALL git/build commands run in ~/projects/groundswell,
#   NOT ~/projects/hacky-hack. cd there first. Do not touch hacky-hack's tree at all.

# CRITICAL: dist/ is gitignored in groundswell. The commit contains ONLY the 5 src/ files.
#   `git status` will show dist/ changes as NOTHING (ignored). This is correct and expected.
#   The rebuild (Action 3) refreshes dist/ for the S2 link step; it does not enter the commit.

# CRITICAL: stage all 5 files atomically. The types addition (authStorage?/modelRegistry?) is
#   consumed by pi-harness.ts (options?.authStorage). Committing pi-harness.ts without the types
#   would compile-fail on a fresh checkout (the optional-field access would error under strict
#   mode). Committing types without pi-harness.ts would be a dead, unused-options change.
#   The 3 test files assert the new behavior and must ship together. ONE commit, all 5.

# CRITICAL: use the EXACT commit message. semantic-release classifies by the leading
#   `fix(harnesses):` token — a patch bump (1.0.0 → 1.0.1) on push. Rewording the type
#   (e.g. `feat:` → minor, or missing the colon/scope) changes the release semantics.

# GOTCHA (pre-commit hooks): groundswell may have a pre-commit or husky hook (lint/test/build).
#   If `git commit` triggers one that fails, READ the failure — most likely a test in the 3
#   committed test files, which should pass (they were authored with the fix). Do NOT bypass
#   with --no-verify unless a hook is confirmed broken; fix the root cause instead.

# GOTCHA (npm run build): `npm run build` in groundswell runs `tsc` (or the configured build
#   script) emitting to dist/. It is idempotent — dist already contains the fix (md5 d3de7234…).
#   Re-running is belt-and-suspenders to guarantee the S2 link picks up fresh artifacts. If it
#   fails, the most likely cause is a TypeScript error in the committed src/ — which would mean
#   the fix itself is broken and this subtask CANNOT complete until the source compiles.

# GOTCHA (no push): semantic-release runs ONLY on push to main in CI. Committing locally does
#   NOT publish. The publish (and hacky-hack's lockfile bump) is a separate, CI-gated step.
#   Do NOT `git push` here.
```

## Implementation Blueprint

### Data models and structure

None. No code is authored in this subtask — the fix is already written in the working tree.
This is a git + build + verify operation only.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY pre-state (read-only sanity check — prevents committing the wrong thing)
  - RUN: cd ~/projects/groundswell && git status --short
  - EXPECT: exactly 5 lines (the files listed below), no untracked files, no other changes.
        M src/__tests__/unit/harnesses-types.test.ts
        M src/__tests__/unit/providers/pi-harness-initialize.test.ts
        M src/__tests__/unit/providers/pi-harness-resolvemodel.test.ts
        M src/harnesses/pi-harness.ts
        M src/types/harnesses.ts
  - RUN: git branch --show-current   → expect "main"
  - IF the output differs (extra files, wrong branch, missing files): STOP. The working tree
      has drifted from the PRD/contract assumptions. Re-read deployment_strategy.md before
      proceeding; do NOT blindly `git add -A`.

Task 1: STAGE the 5 files explicitly
  - RUN: cd ~/projects/groundswell
  - RUN: git add src/harnesses/pi-harness.ts \
            src/types/harnesses.ts \
            src/__tests__/unit/harnesses-types.test.ts \
            src/__tests__/unit/providers/pi-harness-initialize.test.ts \
            src/__tests__/unit/providers/pi-harness-resolvemodel.test.ts
  - VERIFY: git status --short → 5 staged (green `A`/`M`) lines, no unstaged remainder.
  - DO NOT: use `git add -A` or `git add .` UNLESS Task 0 confirmed the tree is otherwise clean.
      The explicit form is safer and self-documenting.

Task 2: COMMIT with the exact conventional-commit message
  - RUN: git commit -m "fix(harnesses): use file-backed AuthStorage.create() over inMemory() to honor ~/.pi/agent/auth.json (PRD §9.2.6)"
  - EXPECT: commit succeeds; HEAD advances by 1. If a pre-commit hook runs and fails, read the
      output — do not use --no-verify to bypass unless the hook is confirmed broken.
  - VERIFY: git log -1 --format='%s' → prints the exact message above (single line).
  - VERIFY: git show --stat HEAD → lists exactly the 5 staged files (+111/-11 lines total).

Task 3: REBUILD dist (gitignored — refreshes artifacts for the S2 link step)
  - RUN: cd ~/projects/groundswell && npm run build
  - EXPECT: exits 0 (idempotent; dist already contained the fix). If it fails on a TypeScript
      error in src/, the fix itself is broken — STOP and surface the error; this subtask cannot
      complete until src/ compiles.
  - NOTE: dist/ is gitignored, so `git status` remains clean after the build.

Task 4: VERIFY the rebuilt dist contains the fix
  - RUN: grep -n 'AuthStorage\.\(create\|inMemory\)()' dist/harnesses/pi-harness.js
  - EXPECT (MUST match): a line containing
        this.authStorage = options?.authStorage ?? AuthStorage.create();
    (at ~line 103). The grep will ALSO show comment lines mentioning AuthStorage.create() at
    ~lines 72 and 99 — that is fine. What matters is the executable assignment uses create().
  - EXPECT (MUST NOT appear in the constructor body): AuthStorage.inMemory() as the default
      assignment. (Comment mentions of inMemory() in the "inject for tests" note are fine.)
```

### Implementation Patterns & Key Details

```bash
# PATTERN: Conventional Commit for semantic-release (Angular format).
#   <type>(<scope>): <imperative subject>  →  footer/ref optional.
#   fix(harnesses): use file-backed AuthStorage.create() over inMemory() to honor ~/.pi/agent/auth.json (PRD §9.2.6)
#   ↑ type=fix  →  patch bump (1.0.0 → 1.0.1) on the next semantic-release CI run after push.
#   scope=harnesses  →  groups with the prior "fix(harnesses): forward systemPrompt…" commit.
#
# PATTERN: Atomic cross-file commit. The 5 files form one logical change:
#   - types/harnesses.ts     : adds the optional fields the harness reads
#   - harnesses/pi-harness.ts: reads those fields (options?.authStorage ?? AuthStorage.create())
#   - 3 test files           : assert the new default + injection behavior
#   Splitting them would leave the repo non-bisectable / non-compiling at intermediate commits.
#
# PATTERN: gitignored build artifacts are rebuilt, not committed. dist/ ships via CI rebuild
#   on publish; locally it only needs to be fresh for the dev link (S2).
```

### Integration Points

```yaml
DATABASE:
  - none
CONFIG:
  - none (no hacky-hack or groundswell config changes)
ROUTES:
  - none
BUILD / TOOLING:
  - `npm run build` in ~/projects/groundswell (rebuilds gitignored dist/). No package.json,
    tsconfig, or .releaserc changes.
DEPENDENCIES:
  - DEPENDS-ON (completed): P1.M1.T1.S1 — the non-mocked integration test
      (tests/integration/config/pi-harness-auth.test.ts) is already written and RED, waiting for
      the fixed dist. This commit produces the fix that S2 will link in to turn it GREEN.
  - ENABLES (downstream): P1.M1.T2.S2 — `npm link` the committed+rebuilt groundswell into
      hacky-hack and verify auth.json resolution (turns the P1.M1.T1 test green).
  - ENABLES (later, CI-gated): push → semantic-release → npm v1.0.1 → hacky-hack
      `npm install groundswell@latest` + lockfile commit (production deployment).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# The "source" here is the committed diff; confirm it is well-formed and complete.
cd ~/projects/groundswell

# Confirm the commit landed with the right message and exactly 5 files.
git log -1 --format='%s'
# Expected: fix(harnesses): use file-backed AuthStorage.create() over inMemory() to honor ~/.pi/agent/auth.json (PRD §9.2.6)

git show --stat HEAD
# Expected: exactly 5 files:
#   src/harnesses/pi-harness.ts
#   src/types/harnesses.ts
#   src/__tests__/unit/harnesses-types.test.ts
#   src/__tests__/unit/providers/pi-harness-initialize.test.ts
#   src/__tests__/unit/providers/pi-harness-resolvemodel.test.ts
# Total: +111/-11 (approx).

# Confirm the working tree is now clean (dist rebuild did not dirty it — it's gitignored).
git status --short
# Expected: empty output.

# Build (the project's own compile gate).
npm run build
# Expected: exits 0. If it reports TypeScript errors in src/, the fix is broken — STOP.
```

### Level 2: Unit Tests (Groundswell's own suite — confirms the fix + tests are self-consistent)

```bash
cd ~/projects/groundswell

# Run the groundswell test suite (at minimum the 3 committed test files + anything they touch).
npm test
# Expected: all pass — the 3 committed test files were authored alongside the fix and should be
# green. If a committed test fails, the fix/test pair is inconsistent and the commit is invalid;
# surface the failure rather than declaring success.
#
# If `npm test` runs the full suite and surfaces PRE-EXISTING unrelated failures, focus on the
# 3 pi-harness / harnesses-types files: they must pass. Document any unrelated pre-existing
# failures but do not attempt to fix them here (out of scope for this subtask).
```

### Level 3: Integration Testing (dist verification — the core deliverable check)

```bash
cd ~/projects/groundswell

# THE definitive gate: the rebuilt dist must use the file-backed auth store.
grep -n 'AuthStorage\.\(create\|inMemory\)()' dist/harnesses/pi-harness.js
# Expected (MUST be present in the executable constructor body, ~line 103):
#   this.authStorage = options?.authStorage ?? AuthStorage.create();
# Expected (MUST NOT be the default assignment):
#   this.authStorage = AuthStorage.inMemory();   ← stale, must be gone from the constructor body

# md5 sanity (optional): the rebuilt dist should match the known-fixed hash (or be functionally
# identical — a rebuild can differ in whitespace/comments but the AuthStorage call must be create()).
md5sum dist/harnesses/pi-harness.js
# Pre-fix/stale hash was d3de7234… is the FIXED hash; the rebuild should reproduce create().

# Confirm the stale dist (the one hacky-hack currently consumes) is DIFFERENT — this proves
# the fix is real and deployment (S2) is still needed:
md5sum ~/projects/hacky-hack/node_modules/groundswell/dist/harnesses/pi-harness.js
# Expected: 54cea962… (stale, inMemory) — DIFFERENT from the committed dist. This is the gap S2 closes.
```

### Level 4: Creative & Domain-Specific Validation

```bash
cd ~/projects/groundswell

# Conventional-commit lint (if groundswell has commitlint / commitizen configured).
npx commitlint --from HEAD~1 --to HEAD 2>/dev/null || \
  echo "(commitlint not configured — skip; the message follows the Angular convention by construction)"
# Expected: passes if configured; the `fix(harnesses): …` form is canonical.

# semantic-release dry-run (simulates the version bump WITHOUT publishing). Confirms the commit
# will produce a patch (1.0.1) on push — validating the release semantics of the message.
npx semantic-release --dry-run 2>&1 | grep -iE 'release|version|1\.0\.1|no releas' || true
# Expected: indicates a patch release (1.0.1) is queued. (This may require npm/GH env vars to
# run fully; if it errors on auth, the dry-run still logs the planned version in most configs.
# This is an OPTIONAL confirmation, not a hard gate.)

# DO NOT push (CI-gated). DO NOT publish. DO NOT npm link (S2). DO NOT touch hacky-hack files.
```

## Final Validation Checklist

### Technical Validation

- [ ] Task 0: `git status --short` (groundswell) showed exactly the 5 expected files on `main` before staging.
- [ ] Task 1: all 5 files staged (explicit `git add` of each path).
- [ ] Task 2: commit created; `git log -1 --format='%s'` == exact message; `git show --stat HEAD` == 5 files.
- [ ] Task 3: `npm run build` (groundswell) exits 0.
- [ ] Task 4: `grep … dist/harnesses/pi-harness.js` shows `AuthStorage.create()` in the constructor body.
- [ ] `git status --short` is empty post-build (dist is gitignored).

### Feature Validation

- [ ] The commit message is a valid `fix(harnesses):` conventional commit (semantic-release → patch).
- [ ] All 5 files committed atomically (source + types + tests as one logical change).
- [ ] The rebuilt dist uses `options?.authStorage ?? AuthStorage.create()` (file-backed default).
- [ ] The stale hacky-hack `node_modules/groundswell` dist is confirmed different (S2's job to fix).

### Code Quality Validation

- [ ] No `git add -A` used unless the pre-state was verified clean (explicit paths preferred).
- [ ] No `--no-verify` used to bypass a failing hook (root cause addressed instead).
- [ ] No push, no publish, no npm link, no hacky-hack file changes (scope discipline).
- [ ] Commit is not amended/squashed/split after creation (one atomic commit).

### Documentation & Deployment

- [ ] No hacky-hack docs changes (this is a cross-repo git op; docs sync is P1.M4.T1.S1/S2).
- [ ] The publish path (push → semantic-release → 1.0.1 → hacky-hack lockfile bump) is documented
      as a CI-gated follow-up, not executed here.

---

## Scope Boundaries (DO NOT EXPAND)

This subtask is **commit + rebuild dist + verify** in the **groundswell** repo ONLY. The
following are explicitly OUT OF SCOPE and owned by sibling subtasks:

- ❌ `npm link` in either repo, or updating hacky-hack's `node_modules/groundswell` → **P1.M1.T2.S2**.
- ❌ `npm install groundswell@latest` / lockfile bump in hacky-hack → CI-gated follow-up (post S2).
- ❌ Hardening `validate-groundswell.ts` (auth-store assertion + symlink detection) → **P1.M1.T3**.
- ❌ Pushing to GitHub / `npm publish` → CI-gated (semantic-release on push); requires credentials.
- ❌ Modifying ANY hacky-hack file (source, lockfile, docs, tests) → deferred to S2 / P1.M4.
- ❌ Fixing pre-existing unrelated groundswell test failures (if any surface in Level 2) → out of scope.
- ❌ Running the hacky-hack integration test (P1.M1.T1) — it will stay RED until S2 links the dist.

---

## Anti-Patterns to Avoid

- ❌ Don't `git add -A` blindly — verify the 5-file pre-state first; stage explicit paths.
- ❌ Don't commit a subset of the 5 files — the types/harness/test trio is atomic (non-compiling
  or dead-code intermediate states otherwise).
- ❌ Don't reword the commit message — `fix(harnesses):` drives the semantic-release patch bump.
- ❌ Don't `--no-verify` past a failing hook — read it; a committed-test failure means the fix is
  inconsistent with its tests and the commit is invalid.
- ❌ Don't push, publish, or link here — each is a separate, scoped, often CI-gated step.
- ❌ Don't touch hacky-hack's tree — this subtask's entire footprint is `~/projects/groundswell`.
- ❌ Don't commit `dist/` — it's gitignored by design; CI rebuilds on publish. (You can't, anyway.)
- ❌ Don't amend the commit after the fact "to tidy" — one clean atomic commit is the deliverable.

---

**Confidence Score: 9.5/10** for one-pass implementation success. The fix is already written and
verified in the working tree (5 files, +111/-11, dist rebuilt with the correct `AuthStorage.create()`
call, md5 confirmed). This subtask is a deterministic git + build + verify sequence with exact
commands and a single canonical commit message. The 0.5 residual risk is operational: a
groundswell pre-commit hook firing unexpectedly, or a stale/drifted working tree differing from
the verified pre-state — both are guarded by Task 0's explicit pre-state check and the "STOP and
read" guidance for hook failures.
