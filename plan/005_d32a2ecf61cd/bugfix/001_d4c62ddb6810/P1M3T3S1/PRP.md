---
name: "P1.M3.T3.S1 — tasks-json-recovery E2E Integration Test (R4)"
description: |
  End-to-end integration test exercising the corrupt-disk → git-restore → delta-apply →
  Researching-preservation flow of `recoverTasksJson` using REAL git operations, a REAL
  SessionManager, and REAL disk. Also closes a discovered precondition gap: the two git
  history primitives that `recoverTasksJson` imports are currently MISSING from
  `src/tools/git-mcp.ts`, which must be implemented first or the test cannot pass.
---

# PRP — P1.M3.T3.S1: tasks-json-recovery E2E Integration Test (R4)

## Goal

**Feature Goal**: Add a passing integration test at `tests/integration/core/tasks-json-recovery-e2e.test.ts`
that exercises the full R4 smart-recovery flow (`recoverTasksJson` PATH B) end-to-end against a real
git repository and real `SessionManager`, proving that a corrupted `tasks.json` is restored from git
history, the legitimate status delta is re-applied, and items left in `Researching` status are
preserved (never dropped to `Planned`). Optionally also cover PATH A (clean disk re-apply).

**Deliverable**:
1. Two git history primitives (`gitFileHistory`, `gitReadFileAtCommit` + the `GitFileHistoryEntry`
   type) **implemented and exported** from `src/tools/git-mcp.ts` — they are currently imported by
   `tasks-json-recovery.ts` but are MISSING (see **CRITICAL PRECONDITION** below).
2. The file `tests/integration/core/tasks-json-recovery-e2e.test.ts` passing `npx vitest run`.

**Success Definition**:
- `npx vitest run tests/integration/core/tasks-json-recovery-e2e.test.ts` → all tests pass.
- `npx vitest run tests/unit/core/tasks-json-recovery.test.ts` → all 5 tests pass (the 2 PATH B
  tests that currently FAIL become GREEN once the git primitives exist).
- `npm run validate` (lint + format:check + typecheck) → green.
- No production behavior change beyond adding the two pure git-readonly primitives.

## Why

- The Session 005 validation report (PRD §h2.4 / Issue 3) flagged that R1–R4 have strong **unit**
  coverage but **no integration tests** exercising the real seams (orchestrator ↔ recovery ↔ disk/git).
- This work item (P1.M3.T3.S1) adds the R4 integration test: it proves the recovery routine works
  against a real git repo (not mocks), closing the gap noted in Issue 3.
- The discovered precondition gap (missing git primitives) is a real defect: it currently makes the
  R4 PATH B unit tests fail and would silently break production recovery. Fixing it is in-scope and
  required for the test to pass.

## What

A new integration test that, in a real tmpdir git repository with a real `SessionManager`:
1. Commits a valid `tasks.json` containing a subtask in `Researching` status.
2. Corrupts `tasks.json` on disk (writes invalid JSON).
3. Calls the real `recoverTasksJson(...)` with a legitimate `{ itemId, status: 'Complete' }` delta.
4. Asserts the result is `{ restored: true, source: 'git' }`.
5. Reads the restored `tasks.json` from disk and asserts: valid JSON, the target item is `Complete`
   (delta applied), AND the `Researching` subtask is still `Researching` (preserved from git).
6. (Optional) PATH A: with a clean disk, asserts `{ restored: false, source: 'disk' }`.

### Success Criteria

- [ ] `gitFileHistory` + `gitReadFileAtCommit` exist and are exported from `src/tools/git-mcp.ts`.
- [ ] Existing 2 failing PATH B unit tests in `tests/unit/core/tasks-json-recovery.test.ts` now pass.
- [ ] New `tests/integration/core/tasks-json-recovery-e2e.test.ts` passes corrupt-disk → git-restore
      → delta-apply → Researching-preservation end-to-end with REAL `git init`/`add`/`commit`.
- [ ] `npm run validate` is green; new test passes via `npx vitest run`.

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement this
successfully?_ **Yes** — this PRP includes the exact missing-primitive signatures, the existing git
function pattern to follow, the exact `recoverTasksJson` contract, the `SessionManager` setup
pattern copied from the existing e2e test, and the fixture builder from the existing unit test.

### ⚠️ CRITICAL PRECONDITION — DISCOVERED GAP (must fix FIRST)

The two git history primitives that `src/core/tasks-json-recovery.ts` **imports** at line 42:

```ts
import { gitFileHistory, gitReadFileAtCommit } from '../tools/git-mcp.js';
```

**DO NOT EXIST** in `src/tools/git-mcp.ts`. Verified:

```
$ npx tsx -e "import('./src/tools/git-mcp.js').then(m => console.log(typeof m.gitFileHistory, typeof m.gitReadFileAtCommit))"
undefined undefined
```

The existing export block (`src/tools/git-mcp.ts` lines ~531-539) only exports `gitStatus`,
`gitDiff`, `gitAdd`, `gitCommit` (+ their tool descriptors). There is NO `gitFileHistory` or
`gitReadFileAtCommit`, and NO `GitFileHistoryEntry` type anywhere in `src/`.

**Consequence** (confirmed by running the suite):

```
$ npx vitest run tests/unit/core/tasks-json-recovery.test.ts
Tests  2 failed | 3 passed (5)
```

The 2 failing tests are exactly the PATH B (git-restore) cases. Mechanism: `recoverTasksJson`
calls `gitFileHistory(...)` which is `undefined` → throws `TypeError: gitFileHistory is not a
function` → caught by the outer non-fatal guard → returns PATH C result
`{ restored: false, source: 'disk', reason: 'recovery failed: ...' }`. So `result.restored` is
`false` where the test expects `true`.

**Therefore**: the e2e test's core assertion `{ restored: true, source: 'git' }` is **impossible**
until these two primitives are implemented. Implementing them is Task 1 (a prerequisite), even
though the work item description framed this as "test-only". The contract itself states the input
is "Real git primitives from src/tools/git-mcp.ts" — they must therefore be real.

### Documentation & References

```yaml
# MUST READ — the recovery routine under test (imports the missing primitives at line 42)
- file: src/core/tasks-json-recovery.ts
  why: The function under test. Note line 42 import (MISSING), lines 188-210 PATH B git-walk logic,
        `sessionDir = dirname(resolve(tasksPath))` (first arg is the tasks.json FILE path, NOT a dir),
        `relPath = relative(repoPath, resolve(tasksPath))`, and the outer try/catch (never throws).
  pattern: recoverTasksJson(tasksPath, {itemId,status}, {baselineBacklog?, repoPath?})
  gotcha: First arg `tasksPath` is the tasks.json FILE path. The work-item description loosely
          calls it "sessionPath" — that is imprecise. Follow the unit test: pass `join(dir,'tasks.json')`.

# MUST READ — the existing unit test; COPY its git setup pattern + Backlog fixture verbatim
- file: tests/unit/core/tasks-json-recovery.test.ts
  why: Already uses real tmpdir git repos (simple-git init/add/commit). Its `makeRepo()`,
        `commitBacklog()`, `makeValidBacklog()`, and `findSubtask()` helpers are the canonical
        pattern. The e2e test should reuse the same `makeValidBacklog` structure (context_scope MUST
        match ContextScopeSchema — see fixture).
  pattern: simpleGit(dir) → git.init() → git.addConfig('user.email'/'user.name') → writeFile tasks.json → git.add('tasks.json') → git.commit(msg)
  gotcha: context_scope in makeValidBacklog uses the literal 'CONTRACT DEFINITION:...' seed — keep it
          or BacklogSchema validation fails. cleanup = `rm(dir,{recursive:true,force:true})` in afterEach.

# MUST READ — the git tool module where the 2 MISSING primitives must be added
- file: src/tools/git-mcp.ts
  why: Target file for Task 1. Copy the existing `gitStatus`/`gitDiff` async-function pattern
        (try/validateRepositoryPath/simpleGit/.../catch). See lines 289-350 (gitStatus) for the shape.
  pattern: "async function gitXxx(...) { try { const safePath = await validateRepositoryPath(repoPath);
            const git = simpleGit(safePath); ... } catch (e) { ... } }"
  gotcha: The recovery primitives must NOT swallow errors into {success:false} — they must THROW on
          git failure (recoverTasksJson's PATH C depends on the throw) and return [] for no-history.
          So they differ slightly from gitStatus's {success,error} envelope.

# MUST READ — architecture spec with exact signatures for the missing primitives
- docfile: plan/005_d32a2ecf61cd/bugfix/001_d4c62ddb6810/architecture/resilience-features.md
  why: §'R4: tasks.json Protection & Smart Recovery' gives the EXACT signatures the primitives must
        satisfy (GitFileHistoryEntry has a `.commit` field — used at recoverTasksJson.ts:196).
  section: "R4 ... Git Primitives" and "R4 ... Recovery Routine"

# READ — existing e2e integration test for the SessionManager setup + mock pattern
- file: tests/integration/core/task-orchestrator-e2e.test.ts
  why: Lines 197-260 show `createSessionState()` + `setupTestEnvironment()`: how to build a real
        SessionManager (`new SessionManager(prdPath, planDir)`), create the nested session dir tree,
        write tasks.json + prd_snapshot.md + delta_from.txt, and `loadSession(sessionPath)`.
  pattern: mkdtempSync(tmpdir()) → write PRD.md → mkdir session tree → write tasks.json → new SessionManager(prdPath,planDir) → loadSession(path)
  gotcha: SessionManager writes/reads tasks.json at resolve(sessionPath,'tasks.json') — directly in
          the session dir, NOT a 'prp-sessions/<id>' subfolder (the work-item description's path hint
          is wrong; trust src/core/session-utils.ts readTasksJSON/writeTasksJSON).

# READ — confirms tasks.json location = resolve(sessionPath, 'tasks.json')
- file: src/core/session-utils.ts
  why: writeTasksJSON(sessionPath) (line 397) and readTasksJSON(sessionPath) (line 492) both do
        resolve(sessionPath,'tasks.json'). recoverTasksJson delegates to these via sessionDir.

# simple-git API reference (for implementing the primitives)
- url: https://github.com/steveukx/git-js/blob/main/docs/PLUGIN-GUIDE.md
  why: simple-git log/show usage. gitFileHistory: `const log = await git.log({ file: relPath })`
        → log.all is NEWEST-FIRST [{hash,date,message,...}]. gitReadFileAtCommit:
        `await git.show([`${commitHash}:${relPath}`])` → file content string.
  critical: git.log({file}) does NOT follow renames (acceptable here). Use repoPath-resolved git.
            relPath must be repo-relative (recoverTasksJson already computes it correctly).
```

### Current Codebase tree (relevant slice)

```bash
src/core/
  tasks-json-recovery.ts     # recoverTasksJson (under test) — imports MISSING primitives @line 42
  session-manager.ts         # SessionManager class (new SessionManager(prdPath, planDir))
  session-utils.ts           # readTasksJSON/writeTasksJSON (tasks.json @ sessionPath/tasks.json)
  models.ts                  # Backlog, Status, Phase/Milestone/Task/Subtask types
src/tools/
  git-mcp.ts                 # gitStatus/gitDiff/gitAdd/gitCommit EXIST; gitFileHistory/gitReadFileAtCommit MISSING
tests/unit/core/
  tasks-json-recovery.test.ts# 5 tests; 2 PATH B currently FAIL (will pass after Task 1)
tests/integration/core/
  task-orchestrator-e2e.test.ts # SessionManager + tmpdir setup pattern to copy
tests/fixtures/
  simple-prd.ts              # mockSimplePRD fixture (for prd_snapshot.md)
```

### Desired Codebase tree with files to be added/modified

```bash
src/tools/git-mcp.ts                                   # MODIFY — add gitFileHistory, gitReadFileAtCommit, GitFileHistoryEntry + export them
tests/integration/core/tasks-json-recovery-e2e.test.ts # CREATE — the e2e integration test
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: gitFileHistory / gitReadFileAtCommit are imported by tasks-json-recovery.ts:42 but
// are MISSING from git-mcp.ts (undefined). MUST implement them in Task 1 or EVERYTHING fails.
// Verified: npx tsx -e "...console.log(typeof m.gitFileHistory)" → undefined

// GOTCHA: recoverTasksJson's first arg is the tasks.json FILE path, not a session dir.
//   const sessionDir = dirname(resolve(tasksPath));   // tasks-json-recovery.ts:160
//   const relPath = relative(repoPath, resolve(tasksPath));  // must be repo-relative for git
// Pass join(sessionPath, 'tasks.json') — NOT the bare session dir.

// GOTCHA: The git primitives must THROW on git errors (NOT return {success:false}) so
// recoverTasksJson's outer try/catch routes to PATH C. gitFileHistory returns [] for no-history.

// GOTCHA: gitFileHistory must be NEWEST-FIRST (recoverTasksJson walks history and restores the
// "LAST VALID committed version" = newest valid). simple-git's git.log({file}) is newest-first by default. GOOD.

// GOTCHA: Backlog fixture context_scope MUST match ContextScopeSchema or BacklogSchema.parse fails
// (used in PATH B restore). Copy the exact 'CONTRACT DEFINITION:...' seed from the unit test fixture.

// GOTCHA: For git to have history of tasks.json at a nested session path, the e2e test must
// `git init` at the repo ROOT and `git add` the tasks.json AT its nested relative path. Then
// recoverTasksJson's relPath = relative(repoRoot, sessionPath/tasks.json) resolves correctly.
// Simpler alternative (matches the unit test): git init at the session dir root and put tasks.json
// directly there — relPath becomes 'tasks.json'. Either works; the unit-test style is lower-risk.

// GOTCHA: simple-git requires user.email/user.name config before commit in a fresh repo
// (git.addConfig('user.email','test@test.test')). The unit test's makeRepo() already does this.

// GOTCHA: cleanup MUST use rmSync/rm with {recursive:true, force:true} in afterEach (tmpdirs leak).
```

## Implementation Blueprint

### Data models and structure

No new production data models. Add ONE local type to `src/tools/git-mcp.ts`:

```typescript
// Add to src/tools/git-mcp.ts (alongside the other result types)
export interface GitFileHistoryEntry {
  readonly commit: string;   // full or abbreviated hash; recoverTasksJson reads entry.commit
  readonly date?: string;
  readonly message?: string;
  readonly author?: string;
}
```

`recoverTasksJson` already exists and is unchanged. The e2e test reuses the `Backlog`/`Status`
types from `src/core/models.ts` and the `makeValidBacklog`-style fixture from the unit test.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/tools/git-mcp.ts — implement + export the two MISSING git history primitives
  - WHY: They are imported by src/core/tasks-json-recovery.ts:42 but are currently `undefined`.
         Without them the 2 PATH B unit tests FAIL and the e2e test cannot pass. THIS IS THE BLOCKER.
  - IMPLEMENT:
      export interface GitFileHistoryEntry { commit: string; date?: string; message?: string; author?: string; }
      export async function gitFileHistory(filePath: string, repoPath?: string): Promise<GitFileHistoryEntry[]>
        // - safePath = await validateRepositoryPath(repoPath); const git = simpleGit(safePath);
        // - const log = await git.log({ file: filePath });   // NEWEST-FIRST by default
        // - map log.all → [{ commit: e.hash, date: e.date, message: e.message, author: e.author_name }]
        // - return [] if log.all is empty (no history) — do NOT throw for empty history
        // - THROW on git errors (let the caller's try/catch handle → PATH C)
      export async function gitReadFileAtCommit(filePath: string, commitHash: string, repoPath?: string): Promise<string>
        // - safePath = await validateRepositoryPath(repoPath); const git = simpleGit(safePath);
        // - return await git.show([`${commitHash}:${filePath}`]);   // file content at commit
        // - THROW on git errors (caller handles → PATH C)
  - FOLLOW pattern: existing gitStatus() at src/tools/git-mcp.ts:289-350 (try/validateRepositoryPath/simpleGit/...).
  - DIFFERENCE from gitStatus: these return raw typed results (not {success,error} envelopes) and
    THROW on error so recoverTasksJson's PATH C catches. Empty history → gitFileHistory returns [].
  - ADD to the export block (src/tools/git-mcp.ts ~line 531): include gitFileHistory, gitReadFileAtCommit
    and `export type { GitFileHistoryEntry };` (or inline the type export).
  - GOTCHA: validateRepositoryPath requires a `.git` dir to exist at repoPath — the e2e test must
    `git init` the repo before calling. (recoverTasksJson already passes repoPath from opts.)

Task 2: VERIFY the 2 previously-failing PATH B unit tests now pass (regression gate, no file change)
  - RUN: npx vitest run tests/unit/core/tasks-json-recovery.test.ts
  - EXPECT: 5 passed (was 2 failed | 3 passed). If still failing, Task 1 is wrong — fix before Task 3.
  - WHY: proves the primitives satisfy recoverTasksJson's real usage before building the e2e test on top.

Task 3: CREATE tests/integration/core/tasks-json-recovery-e2e.test.ts
  - IMPLEMENT an integration test that exercises corrupt-disk → git-restore → delta-apply →
    Researching-preservation end-to-end with REAL git operations + a REAL SessionManager.
  - STRUCTURE (follow contract steps a–i):
      (a) tmpdir via mkdtempSync; `git init` (simple-git); addConfig user.email/user.name.
      (b) Build a valid Backlog via a makeValidBacklog() helper (COPY from the unit test — keep the
          exact context_scope seed). Put ONE subtask in 'Researching', the target subtask 'Implementing'.
      (c) Write tasks.json to the session dir (resolve(sessionPath,'tasks.json')); git add + commit.
      (d) (Optional but recommended for "integration" flavor) construct a real SessionManager via
          new SessionManager(prdPath, planDir) + loadSession(sessionPath) — copy setupTestEnvironment()
          from task-orchestrator-e2e.test.ts:222. This proves tasks.json is read from the real location.
          If wiring a full SessionManager proves heavy, you MAY call recoverTasksJson directly against
          the tmpdir (the unit-test style) — but prefer the SessionManager path to justify "e2e".
      (e) Corrupt: writeFileSync(tasksPath, '{ corrupted')  // invalid JSON on disk
      (f) Call recoverTasksJson(tasksPath, { itemId: 'P1.M1.T1.S1', status: 'Complete' },
              { baselineBacklog: trustedBacklog, repoPath: <git repo root> })
      (g) assert result deep-equals-ish { restored: true, source: 'git' } (reason /restored from commit/)
      (h) readTasksJSON(sessionDir) → assert target subtask status === 'Complete' (delta applied) AND
          the 'Researching' subtask is STILL 'Researching' (preserved from git, NOT dropped to Planned).
      (i) OPTIONAL extra test — PATH A: with a clean (valid) disk tasks.json, call recoverTasksJson
          with the same delta → assert { restored: false, source: 'disk' } and the delta was applied.
  - FOLLOW pattern: tests/unit/core/tasks-json-recovery.test.ts (git setup + Backlog fixture + findSubtask)
                    AND tests/integration/core/task-orchestrator-e2e.test.ts (SessionManager setup).
  - NAMING: describe('tasks-json-recovery e2e (R4)') with it('PATH B — corrupt disk → git restore ...'),
            it('PATH B — Researching subtask preserved across git restore'), and optionally
            it('PATH A — clean disk re-applies only the legitimate delta').
  - CLEANUP: afterEach(() => rmSync(tmpDir, { recursive: true, force: true })).
  - PLACEMENT: tests/integration/core/tasks-json-recovery-e2e.test.ts
  - NO module-wide vi.mock needed (mirrors the unit test, which uses real git). If you construct a
    SessionManager that transitively imports logger, the P1.M1.T1.S1 optional-chaining fix already
    guards process.setMaxListeners — no stubbing required.

Task 4: RUN all validation gates (see Validation Loop)
  - npx vitest run tests/integration/core/tasks-json-recovery-e2e.test.ts  → all green
  - npx vitest run tests/unit/core/tasks-json-recovery.test.ts             → 5 green (was 2 red)
  - npm run validate                                                        → green
  - npm run test:run                                                        → green (no regressions)
```

### Implementation Patterns & Key Details

```typescript
// ---- Task 1: the two git primitives (place near gitStatus in src/tools/git-mcp.ts) ----
export interface GitFileHistoryEntry {
  readonly commit: string;
  readonly date?: string;
  readonly message?: string;
  readonly author?: string;
}

export async function gitFileHistory(
  filePath: string,
  repoPath?: string
): Promise<GitFileHistoryEntry[]> {
  // THROWS on git error (recoverTasksJson PATH C relies on this); returns [] for no history.
  const safePath = await validateRepositoryPath(repoPath);
  const git = simpleGit(safePath);
  const log = await git.log({ file: filePath }); // NEWEST-FIRST
  return log.all.map((e) => ({
    commit: e.hash,
    date: e.date,
    message: e.message,
    author: e.author_name,
  }));
}

export async function gitReadFileAtCommit(
  filePath: string,
  commitHash: string,
  repoPath?: string
): Promise<string> {
  // THROWS on git error (recoverTasksJson PATH C relies on this).
  const safePath = await validateRepositoryPath(repoPath);
  const git = simpleGit(safePath);
  return await git.show([`${commitHash}:${filePath}`]); // file content at commit
}

// Remember to ADD both to the export block at the bottom of git-mcp.ts (~line 531):
//   export { ..., gitFileHistory, gitReadFileAtCommit };

// ---- Task 3: e2e test skeleton ----
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { recoverTasksJson } from '../../../src/core/tasks-json-recovery.js';
import { readTasksJSON } from '../../../src/core/session-utils.js';
import type { Backlog } from '../../../src/core/models.js';

// (reuse makeValidBacklog + findSubtask from tests/unit/core/tasks-json-recovery.test.ts —
//  import or copy them; keep the exact context_scope seed so BacklogSchema parses)

describe('tasks-json-recovery e2e (R4)', () => {
  let repoRoot: string;
  let sessionPath: string;
  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'recovery-e2e-'));
    const git = simpleGit(repoRoot);
    await git.init(); await git.addConfig('user.email','t@t.t'); await git.addConfig('user.name','T');
    sessionPath = repoRoot; // simplest: tasks.json lives at repoRoot/tasks.json → relPath 'tasks.json'
    // (OR nest: sessionPath = join(repoRoot,'plan','001_xxx'); mkdirSync recursive)
  });
  afterEach(() => { rmSync(repoRoot, { recursive: true, force: true }); });

  it('PATH B — corrupt disk → git restore + delta apply + Researching preserved', async () => {
    const trusted = makeValidBacklog({ s1Status: 'Implementing', s2Status: 'Researching' });
    writeFileSync(join(sessionPath,'tasks.json'), JSON.stringify(trusted, null, 2));
    const git = simpleGit(repoRoot);
    await git.add('tasks.json'); await git.commit('seed valid');
    // corrupt
    writeFileSync(join(sessionPath,'tasks.json'), '{ corrupted');
    const result = await recoverTasksJson(
      join(sessionPath, 'tasks.json'),
      { itemId: 'P1.M1.T1.S1', status: 'Complete' },
      { baselineBacklog: trusted, repoPath: repoRoot }
    );
    expect(result.restored).toBe(true);
    expect(result.source).toBe('git');
    const after = await readTasksJSON(sessionPath);
    expect(findSubtask(after,'P1.M1.T1.S1')!.status).toBe('Complete');
    expect(findSubtask(after,'P1.M1.T1.S2')!.status).toBe('Researching'); // PRESERVED
  });
});
```

### Integration Points

```yaml
EXPORTS (src/tools/git-mcp.ts):
  - add to export block (~line 531): gitFileHistory, gitReadFileAtCommit
  - add type export: GitFileHistoryEntry
  - rationale: src/core/tasks-json-recovery.ts:42 already imports these names — just make them real.

NO DATABASE / NO CONFIG / NO ROUTES changes. This is test + 2 readonly git-utility functions only.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After Task 1 (git-mcp.ts) and Task 3 (new test):
npm run lint               # ESLint across src + tests (0 errors expected)
npm run format:check       # Prettier check (0 errors expected); run `npm run format` to autofix
npm run typecheck          # tsc --noEmit (0 errors; new functions + test must typecheck)
# If format:check fails: npm run format  (then re-run format:check)
```

### Level 2: Unit Tests (Component Validation) — THE KEY GATE

```bash
# This MUST go from 2-failed → 5-passed after Task 1. Run BEFORE writing the e2e test.
npx vitest run tests/unit/core/tasks-json-recovery.test.ts
# Expected: Test Files 1 passed | Tests 5 passed. If any PATH B test still fails, Task 1 is wrong.
```

### Level 3: Integration Testing (the new test)

```bash
# The deliverable test:
npx vitest run tests/integration/core/tasks-json-recovery-e2e.test.ts
# Expected: all tests pass. Inspect any failure carefully — a git restore that returns
# {restored:false,source:'disk'} means the primitives (Task 1) are not wired/throwing as expected.
```

### Level 4: Full Suite + Convenience Gate

```bash
npm run test:run           # Full suite — confirm no regressions (esp. progress-display.test.ts stays green)
npm run validate           # lint + format:check + typecheck (P1.M2.T1.S1 made this the static gate)
# Expected: green across the board.
```

## Final Validation Checklist

### Technical Validation

- [ ] Task 1: `gitFileHistory` + `gitReadFileAtCommit` + `GitFileHistoryEntry` implemented & exported in `src/tools/git-mcp.ts`.
- [ ] `npx tsx -e "import('./src/tools/git-mcp.js').then(m=>console.log(typeof m.gitFileHistory, typeof m.gitReadFileAtCommit))"` prints `function function`.
- [ ] Level 1: `npm run lint`, `npm run format:check`, `npm run typecheck` all green.
- [ ] Level 2: `npx vitest run tests/unit/core/tasks-json-recovery.test.ts` → 5 passed (was 2 failed).
- [ ] Level 3: `npx vitest run tests/integration/core/tasks-json-recovery-e2e.test.ts` → all passed.
- [ ] Level 4: `npm run test:run` green; `npm run validate` green.

### Feature Validation

- [ ] E2E test asserts `{ restored: true, source: 'git' }` on the corrupt-disk → git-restore path.
- [ ] E2E test asserts the `Researching` subtask is preserved (still `Researching`) after restore.
- [ ] E2E test asserts the legitimate `Complete` delta was applied to the target subtask.
- [ ] (Optional) PATH A test asserts `{ restored: false, source: 'disk' }` on a clean disk.

### Code Quality Validation

- [ ] New git primitives follow the existing `gitStatus`/`gitDiff` pattern in `git-mcp.ts`.
- [ ] E2E test follows the existing tmpdir + simple-git + afterEach rmSync cleanup convention.
- [ ] No new module-wide `vi.mock` introduced (the unit test uses none; keep it that way).
- [ ] No production behavior change beyond two pure read-only git utility functions.

### Documentation & Deployment

- [ ] No user-facing docs change (test-only + internal git utility) — matches work-item DOCS: "none".

---

## Anti-Patterns to Avoid

- ❌ Don't write the e2e test first and watch it fail on `{restored:false}` — implement Task 1 (the
  missing git primitives) FIRST and confirm the 2 PATH B unit tests go green before writing the e2e test.
- ❌ Don't make `gitFileHistory`/`gitReadFileAtCommit` return `{success,error}` envelopes like
  `gitStatus` — they must return raw results and THROW on error (recoverTasksJson PATH C depends on throws).
- ❌ Don't make `gitFileHistory` throw on empty history — return `[]` (recoverTasksJson treats `[]`
  as PATH C "no valid version", non-fatally).
- ❌ Don't pass the bare session DIR as `recoverTasksJson`'s first arg — it expects the tasks.json
  FILE path (it does `dirname(resolve(tasksPath))` internally). Use `join(sessionPath,'tasks.json')`.
- ❌ Don't invent a `Ready` status when asserting preservation — only `Researching`/`Retrying` are
  preserved (there is no `Ready` in the Status union).
- ❌ Don't skip the `afterEach` `rmSync(...,{recursive:true,force:true})` — tmpdirs leak without it.
- ❌ Don't forget `git.addConfig('user.email'/'user.name')` before `git.commit` in a fresh repo.

---

## Success Metrics

**Confidence Score**: 8/10 for one-pass implementation success.

The one risk is Task 1 (implementing the two missing git primitives): they are precisely specified
in the architecture doc and the existing `gitStatus` pattern is a clear template, but simple-git's
`git.log({file})` / `git.show([hash:path])` API details must be matched exactly (newest-first ordering,
throw-vs-return semantics). Once Task 2 (the unit-test regression gate) is green, the e2e test (Task 3)
is low-risk because it reuses the already-passing unit test's git setup and Backlog fixture verbatim.
