# PRP — P3.M2.T4.S2: Mechanical layer — `restore_critical_files` in smartCommit

---

## Goal

**Feature Goal**: Implement the **mechanical safety net** of PRD §5.1's
"Critical-File Deletion Protection (`PRD.md` / `PRP.md`)" — the second of the
two mandated layers (prompt layer is P3.M2.T4.S1, mechanical layer is THIS
item). PRD §5.1 requires that *Smart Commit*, immediately after staging with
`git add`, detect any staged **deletions** of `PRD.md` or any `**/PRP.md`
(`git diff --cached --diff-filter=D`) and **undo them** — restoring the file
from `HEAD` when it existed there, or unstaging the deletion when the file was
created-and-deleted in the same run. This guarantees `PRD.md` and every `PRP.md`
**survive every commit** even when an upstream agent (cleanup / bug hunter /
bug-fix breakdown / post-validation fix) deleted them despite the prompt-layer
prohibition.

Today Smart Commit stages with `gitAdd(modified + untracked)` (the equivalent
of `git add -A` over the filtered set), and its commit-side guard
`PROTECTED_FILES` (src/utils/git-commit.ts:52-58) lists `PRD.md` but **NOT**
`PRP.md` (confirmed: architecture/phase_findings.md:77). Worse,
`filterProtectedFiles` only *prevents staging* of `PRD.md` — it does nothing
about a **deletion that is already staged** (an agent ran `git rm` /
`rm`+`gitAdd`). A staged deletion of `PRD.md` or `**/PRP.md` sails straight
into the commit. S2 closes that hole mechanically.

**Deliverable** (2 modified production files + 2 modified test files; **no** new
files at the module level — new functions go INTO existing files; **no** config,
**no** new dependencies):

1. **`src/tools/git-mcp.ts`** — ADD three small wrapped git operations that
   `git-commit.ts` currently has no equivalent for (verified: research/02 §"no
   `.raw(` / `.checkout(` / `.reset([` anywhere in `src/`"):
   - `gitListStagedDeletions(repoPath?)` → runs
     `git diff --cached --diff-filter=D --name-only` via `git.diff([...])`
     (array form — a single string THROWS `TaskConfigurationError`), returns
     `{ success; files?: string[]; error? }`.
   - `gitRestoreFileFromHead(path, repoPath?)` → `git.checkout(['HEAD','--',path])`
     (clears the staged deletion in the index AND restores the working tree in
     ONE call — verified against installed simple-git@3.30.0, research/01 Q4).
     This is the HEAD-tracked-deletion branch. (It is intentionally a NEW
     function — the existing `gitRestoreFile` is index-blind and INSUFFICIENT:
     `git.show`+`atomicWrite` writes the working tree only and leaves the file
     STILL staged-as-deleted; research/01 Q2a.)
   - `gitUnstagePath(path, repoPath?)` → `git.reset(['HEAD','--',path])`
     (unstage; exit 0 with no error even when the path is absent from HEAD —
     the created-and-deleted-in-same-run branch; research/01 Q2b).
   - Add the three to the export blocks (`export {...}` and `export type {...}`
     where applicable).
2. **`src/utils/git-commit.ts`** — ADD `restore_critical_files(repoRoot: string):
   Promise<void>` and INVOCATION of it inside `smartCommit` right after the
   `gitAdd` success check (between current L377 and L385, BEFORE the
   stagecoach `gitDiff({staged:true})` + `gitCommit`). The function: list
   staged deletions; for each deletion whose basename is `PRD.md` OR `PRP.md`
   (the contract's target set), detect existence-in-HEAD (non-throwing
   `git ls-tree`) → if in HEAD, `gitRestoreFileFromHead`; else `gitUnstagePath`;
   log a `warn` per restored/unstaged path. Non-fatal: any per-path error is
   logged and the loop continues (a single path failing must not abort the
   commit — mirrors smartCommit's never-fail-on-commit contract).
3. **`tests/unit/tools/git-mcp.test.ts`** — ADD unit tests for the three new
   helpers (mirror the `gitRestoreFile` test shape; the mock instance needs
   `diff: vi.fn()`, `checkout: vi.fn()`, `reset: vi.fn()`, `raw: vi.fn()`).
4. **`tests/unit/utils/git-commit.test.ts`** — ADD a
   `describe('restore_critical_files')` block + extend the existing
   `vi.mock('../../../src/tools/git-mcp.js', ...)` block and import list to
   include the three new functions; add tests covering: (a) PRD.md staged
   deletion in HEAD → restored via checkout; (b) `plan/.../PRP.md` staged
   deletion in HEAD → restored; (c) created-and-deleted PRP.md (not in HEAD)
   → unstaged via reset; (d) non-critical deletion (`src/foo.ts`) → NOT
   touched; (e) restore is invoked from smartCommit after gitAdd and BEFORE
   gitDiff/gitCommit; (f) a restore helper throwing is caught and logged
   (commit still proceeds).

**Success Definition**:
- `restore_critical_files` exists, is exported from git-commit.ts, and is
  invoked from `smartCommit` exactly once, AFTER the `gitAdd` success check and
  BEFORE the commit-message resolution (`gitDiff({staged:true})` +
  `gitCommit`).
- A staged deletion of root `PRD.md` is restored from HEAD (index cleared +
  working tree restored) and NOT committed.
- A staged deletion of any `**/PRP.md` (e.g. `plan/008_.../P3M2T4S2/PRP.md`) is
  restored from HEAD (or, if created-and-deleted in the run, unstaged) and NOT
  committed.
- A staged deletion of a non-critical file (`src/foo.ts`) is left alone (the
  commit proceeds normally with that deletion included).
- The three new git-mcp helpers use the **array argument form** for
  `git.diff`/`git.checkout`/`git.reset` (the varargs/string forms are silently
  lossy or throw — research/01 Q1, Q2a, Q2b).
- Restore failures are logged (`logger().warn`) and non-fatal — the commit
  still runs.
- `npm run validate` GREEN.
- `git diff --name-only` shows EXACTLY `src/tools/git-mcp.ts`,
  `src/utils/git-commit.ts`, `tests/unit/tools/git-mcp.test.ts`,
  `tests/unit/utils/git-commit.test.ts` (plus the S1 files if S1 lands in the
  same branch — S1 owns `src/agents/prompts.ts` + `tests/unit/agents/prompts.test.ts`;
  no overlap with this PRP's files).

---

## User Persona (if applicable)

**Target User**: The autonomous pipeline (no human in the loop). Transitively
the workflows that drive Smart Commit: `src/core/task-orchestrator.ts:1032`
(pre-cleanup survival commit) and `:1084` (post-cleanup commit), both with
`{ generateMessage: true }`. The protection also covers any future `smartCommit`
call site.

**Use Case**: An agent — despite the P3.M2.T4.S1 prompt-layer prohibition —
deletes `PRD.md` or `plan/.../PRP.md` (or runs `git rm`). `git status` reports
the deletion; Smart Commit's `gitAdd(modified + untracked)` stages it; without
the mechanical layer the very next `gitCommit` would commit the deletion,
permanently wiping the PRD or a PRP on every bug-fix run. Post-S2:
`restore_critical_files` runs between staging and commit, detects the staged
deletion, restores from HEAD (or unstages), and the commit proceeds WITHOUT
the deletion.

**User Journey**:
`executeSubtask` → (agent deletes PRP.md) → `smartCommit({generateMessage:true})`
→ `gitStatus` → `filterProtectedFiles` (PRD.md already excluded from STAGING,
but a deletion can still be staged via `gitAdd` of the modified-list or via an
explicit `git rm`) → `gitAdd` → **`restore_critical_files(repoRoot)`** (NEW:
detects staged deletion of `PRP.md`, runs `git checkout HEAD -- <path>`,
clearing the index + restoring the file) → `gitDiff({staged:true})` (sees the
CORRECTED staged set, no deletion) → stagecoach generates a message →
`gitCommit` (commits everything EXCEPT the deletion) → PRP.md intact on disk +
in HEAD.

**Pain Points Addressed**: PRD §5.1 (h3.9) — silent permanent loss of `PRD.md`
/ `PRP.md` on commit. The prompt layer (S1) is the behavioral front line;
this item is the **mechanical backstop** that catches the cases where an agent
deletes despite the prompt. PRD §5.1 mandates both layers; S2 completes
P3.M2.T4.

---

## Why

- **PRD compliance**: PRD §5.1 (h3.9) names a Prompt layer and a Mechanical
  layer. The mechanical layer is quoted verbatim: *"invoked from Smart Commit
  right after staging, it detects staged deletions of `PRD.md`/`PRP.md`
  (`git diff --cached --diff-filter=D`) and undoes them — restoring the file
  from `HEAD` when it existed there, or unstaging the deletion when the file
  was created and deleted in the same run. `PRD.md` and `PRP.md` are thus
  guaranteed to survive every commit."* This PRP implements exactly that.
- **Work-item contract (LOGIC)** — item-by-item mapping:
  - **(a) Create `restore_critical_files` function in `src/utils/git-commit.ts`.**
    → Task 5.
  - **(b) After `gitAdd` in smartCommit, run
    `git diff --cached --diff-filter=D --name-only` to find staged deletions.**
    → Task 1 (`gitListStagedDeletions` in git-mcp.ts) + Task 5
    (invocation). Wrapped in git-mcp.ts to honor the codebase's single-git-I/O-
    module layering (research/02 §Layering).
  - **(c) For any staged deletion of `PRD.md` or matching `**/PRP.md`: if the
    file existed in HEAD, restore it from HEAD via `git checkout HEAD -- <path>`
    (or `gitRestoreFile`); if it was created-and-deleted in the same run (not
    in HEAD), unstage it via `git reset HEAD -- <path>`.**
    → Tasks 1 (`gitRestoreFileFromHead` = `git.checkout(['HEAD','--',path])`)
    and 1 (`gitUnstagePath` = `git.reset(['HEAD','--',path])`), plus the
    existence-in-HEAD check (non-throwing `git ls-tree`, research/01 Q3).
    The contract offers "(or `gitRestoreFile`)" — but research/01 Q2a proves
    the existing `gitRestoreFile` is INSUFFICIENT (index-blind). The
    `git.checkout` one-shot is strictly better AND is what `git checkout HEAD
    -- <path>` means literally, so this PRP uses `gitRestoreFileFromHead`
    (checkout) as the primary, and the `git.reset` path for the not-in-HEAD
    case. The existing `gitRestoreFile` is left UNCHANGED (other callers — the
    `tasks.json` recovery path — rely on its working-tree-only semantics).
  - **(d) Log warnings when restoring.**
    → Task 5: `logger().warn(...)` per restored/unstaged path (reuses the
    module-scoped `logger()` factory — no new logger needed).
  - **(e) This guarantees `PRD.md`/`PRP.md` survive every commit.**
    → Because `restore_critical_files` runs BEFORE the stagecoach
    `gitDiff({staged:true})` AND before `gitCommit`, the corrected staged set
    is what gets both read-for-generation and committed.
- **Contract item 2 (INPUT)**: *"Prompt-layer prohibitions from P3.M2.T4.S1."*
  → S1 is the behavioral front line; S2 is the mechanical backstop. They are
  INDEPENDENT (no code dependency between them). S2 works whether or not S1
  has landed. (See `parallel_execution_context`: S1 edits `prompts.ts`;
  S2 edits `git-commit.ts` + `git-mcp.ts` — zero file overlap.)
- **Contract item 4 (OUTPUT)**: *"restore_critical_files function, invoked
  from smartCommit after staging. Completes P3.M2.T4."* → This PRP delivers
  exactly that and is the final subtask of M2.T4.
- **Contract item 5 (DOCS)**: *"[Mode A] JSDoc on restore_critical_files
  documenting the staged-deletion-detection and restore logic. This rides WITH
  the work."* → Mode A. JSDoc on `restore_critical_files` + the three new
  git-mcp helpers (the repo's convention is thorough JSDoc on every exported
  git-mcp function — see `gitRestoreFile`, `gitDiff` JSDoc). No `.env.example`,
  no `docs/`, no README.

---

## What

Two modified production files (`src/tools/git-mcp.ts`, `src/utils/git-commit.ts`),
two modified test files (`tests/unit/tools/git-mcp.test.ts`,
`tests/unit/utils/git-commit.test.ts`). **No** new modules, **no** config, **no**
new dependencies, **no** `prompts.ts` (S1 owns it), **no** `agent-factory.ts`
(P3.M2.T3.S1 owns it), **no** workflow files (`task-orchestrator.ts` — the call
sites already exist and need no change; `restore_critical_files` is invoked
INSIDE `smartCommit`, so both `smartCommit` call sites are covered
transparently).

### Success Criteria

- [ ] **`src/tools/git-mcp.ts`** adds three exported functions following the
      existing result-object convention (`{ success: boolean; ...; error? }`)
      and the `validateRepositoryPath` → `simpleGit(safePath)` pattern:
      - `gitListStagedDeletions(repoPath?: string): Promise<{success; files?: string[]; error?}>`
        using `git.diff(['--cached','--diff-filter=D','--name-only'])` (ARRAY form),
        splitting on newlines + trimming + filtering empties.
      - `gitRestoreFileFromHead(path: string, repoPath?: string): Promise<{success; error?}>`
        using `git.checkout(['HEAD','--',path])` (ARRAY form — NOT varargs).
      - `gitUnstagePath(path: string, repoPath?: string): Promise<{success; error?}>`
        using `git.reset(['HEAD','--',path])` (ARRAY form).
      All three added to the `export {...}` block (git-mcp.ts:664-671) and any
      new result interfaces to the `export type {...}` block (git-mcp.ts:643-651).
- [ ] **`src/utils/git-commit.ts`** adds `export async function restore_critical_files(repoRoot: string): Promise<void>`:
      - Calls `gitListStagedDeletions(repoRoot)`.
      - For each deleted path: if `basename(path) === 'PRD.md' || basename(path) === 'PRP.md'`
        (covers root `PRD.md` and any `**/PRP.md`; basename match avoids
        `node_modules` false positives — research/02 §"no fast-glob needed"),
        check existence-in-HEAD (non-throwing `git.raw(['ls-tree','--name-only','HEAD','--',path])`
        — OR equivalently attempt `gitRestoreFileFromHead` and fall back to
        `gitUnstagePath` on failure; see Implementation Blueprint for the
        recommended two-strategy approach), then restore or unstage; log
        `logger().warn(...)`.
      - Non-fatal: each per-path operation is wrapped so a throw is caught,
        logged, and the loop continues.
      - IMPORTS the three new functions from `'../tools/git-mcp.js'` (adds them
        to the existing line-23 import).
- [ ] **`smartCommit`** invokes `await restore_critical_files(repoRoot)`
      EXACTLY ONCE, after the `gitAdd` success check (current git-commit.ts L377)
      and BEFORE the commit-message resolution block (current L385, the
      `if (options?.generateMessage)` / `gitDiff({staged:true})` + `gitCommit`).
      This ordering is MANDATORY so the stagecoach diff + commit see the
      corrected staged set.
- [ ] **`tests/unit/tools/git-mcp.test.ts`** adds unit tests for the three new
      helpers: (a) `gitListStagedDeletions` returns parsed paths from the raw
      diff string (including the trailing-newline trim); (b)
      `gitRestoreFileFromHead` calls `git.checkout(['HEAD','--',path])` with the
      ARRAY argument (assert the mock was called with an array, NOT varargs);
      (c) `gitUnstagePath` calls `git.reset(['HEAD','--',path])` with the ARRAY
      argument; (d) each returns `{success:false, error}` on a thrown git error.
      Extend the shared `mockGitInstance` with `diff/checkout/reset/raw: vi.fn()`.
- [ ] **`tests/unit/utils/git-commit.test.ts`** adds a
      `describe('restore_critical_files')` block AND extends the existing
      `vi.mock('../../../src/tools/git-mcp.js', ...)` block + import list to
      include the three new functions. Tests cover: PRD.md deletion in HEAD →
      checkout called; PRP.md deletion in HEAD → checkout called; PRP.md
      created-and-deleted (not in HEAD) → reset called; non-critical deletion →
      neither called; restore is invoked inside `smartCommit` after `gitAdd`
      and before `gitDiff`/`gitCommit` (assert call order); a restore helper
      throwing is caught + logged + commit still runs.
- [ ] JSDoc on `restore_critical_files` documents the
      staged-deletion-detection + restore-from-HEAD / unstage logic (Mode A,
      rides with the work).
- [ ] `npm run validate` GREEN.
- [ ] `git diff --name-only` shows EXACTLY the four files above (plus S1's two
      if co-located; no `prompts.ts`, no `agent-factory.ts`, no
      `task-orchestrator.ts`, no `prp-executor.ts`).

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — YES. This PRP names: the two
production files + exact insertion points (git-commit.ts L377→L385;
git-mcp.ts export blocks at L643-651 / L664-671); the three new git-mcp
functions with their EXACT simple-git calls and the array-argument requirement
(verified against installed simple-git@3.30.0 — research/01); the existence-
in-HEAD non-throwing check (`git ls-tree`); the `basename` match strategy for
`PRD.md` + `**/PRP.md` (no fast-glob needed); the result-object convention
(`{success; error?}`); the test mock patterns for BOTH test files (function-
mock for git-commit.test.ts, instance-mock for git-mcp.test.ts); the npm
script names; and the explicit out-of-scope list (S1's prompts.ts,
P3.M2.T3.S1's agent-factory.ts, the existing `gitRestoreFile` semantics).

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/utils/git-commit.ts
  why: PRIMARY TARGET (the smartCommit function + where restore_critical_files lives).
       L23 = the git-mcp import to EXTEND.
       L52-58 = PROTECTED_FILES (lists PRD.md, NOT PRP.md — the gap this PRP closes on the commit side).
       L76-80 = filterProtectedFiles (basename-match pattern to REUSE for the critical-set check).
       L370-377 = gitAdd block (INSERT restore_critical_files AFTER this success check).
       L385-456 = message-resolution (stagecoach gitDiff{staged:true}) + gitCommit (restore MUST run BEFORE this block).
       L44-45 = the lazy logger() factory (REUSE — restore_critical_files is in the same module).
  pattern: |
           // INSERTION POINT (between current L377 and L385):
           if (!addResult.success) {
             logger().error(`Git add failed: ${addResult.error}`);
             return null;
           }

           // ── Critical-File Deletion Protection (PRD §5.1, mechanical layer) ──
           // Runs AFTER staging, BEFORE commit-message resolution + gitCommit, so the
           // stagecoach gitDiff({staged:true}) + gitCommit see the corrected staged set.
           await restore_critical_files(repoRoot);

           // Resolve the commit message ... (existing code continues at current L385)
  gotcha: restore_critical_files MUST run BEFORE the `if (options?.generateMessage)` block
          (L385) — because that block calls `gitDiff({staged:true})` to feed stagecoach, and
          the staged diff must reflect the post-restore state (no critical-file deletion).
          Running it after gitCommit is useless (the deletion is already committed).

- file: src/tools/git-mcp.ts
  why: ADD the three new wrapped functions here (git-commit.ts must NOT import simpleGit directly —
       research/02 §Layering confirms git-mcp.ts is the ONLY module that imports simpleGit).
       L24 = `simpleGit` import; L29 = `GitError` import; L160-185 = validateRepositoryPath (REUSE).
       L367-390 = gitDiff (the existing `git.diff(['--cached'])` pattern — model gitListStagedDeletions on it).
       L560-598 = gitRestoreFile (the existing show+atomicWrite pattern; LEAVE UNCHANGED — its index-blind
                  semantics are correct for the tasks.json recovery callers; the NEW gitRestoreFileFromHead
                  is a SEPARATE function using git.checkout).
       L643-651 = `export type {...}` block (ADD new result interfaces here).
       L664-671 = `export {...}` block (ADD the three new functions here).
  pattern: |
           // NEW: list staged deletions (research/01 Q1 — ARRAY form is MANDATORY).
           export interface GitListDeletionsResult {
             success: boolean;
             files?: string[];   // repo-relative paths, staged-as-deleted
             error?: string;
           }
           export async function gitListStagedDeletions(
             repoPath?: string
           ): Promise<GitListDeletionsResult> {
             try {
               const safePath = await validateRepositoryPath(repoPath);
               const git = simpleGit(safePath);
               // CRITICAL: array form — a single STRING throws TaskConfigurationError (research/01 Q1).
               const raw = await git.diff(['--cached', '--diff-filter=D', '--name-only']);
               // raw is UNTRIMMED by default → split + trim + filter empties.
               const files = raw.split('\n').map(s => s.trim()).filter(Boolean);
               return { success: true, files };
             } catch (error) {
               return { success: false, error: error instanceof Error ? error.message : String(error) };
             }
           }

           // NEW: restore a HEAD-tracked deleted file (clears index + worktree in ONE call — research/01 Q2a/Q4).
           export interface GitRestoreFromHeadResult { success: boolean; error?: string; }
           export async function gitRestoreFileFromHead(
             path: string,
             repoPath?: string
           ): Promise<GitRestoreFromHeadResult> {
             try {
               const safePath = await validateRepositoryPath(repoPath);
               const git = simpleGit(safePath);
               // CRITICAL: ARRAY form. The varargs `git.checkout('HEAD','--',path)` is silently lossy —
               // getTrailingOptions keeps only the first primitive, dropping '--'/path → runs `git checkout HEAD` (research/01 Q2a).
               await git.checkout(['HEAD', '--', path]);
               return { success: true };
             } catch (error) {
               return { success: false, error: error instanceof Error ? error.message : String(error) };
             }
           }

           // NEW: unstage a path (never-in-HEAD created-and-deleted branch — research/01 Q2b).
           export async function gitUnstagePath(
             path: string,
             repoPath?: string
           ): Promise<GitRestoreFromHeadResult> {
             try {
               const safePath = await validateRepositoryPath(repoPath);
               const git = simpleGit(safePath);
               // `git reset HEAD -- <path>`: exit 0, no error even if path absent from HEAD.
               // ARRAY form; do NOT use git.reset([path]) (ambiguous).
               await git.reset(['HEAD', '--', path]);
               return { success: true };
             } catch (error) {
               return { success: false, error: error instanceof Error ? error.message : String(error) };
             }
           }
  gotcha: simple-git@3.30.0 has NO `.restore()` and NO `.lsFiles()` methods (research/01) —
          calling either throws TypeError. Use `.diff([...])`, `.checkout([...])`, `.reset([...])`.
          For the existence-in-HEAD check, use `.raw(['ls-tree','--name-only','HEAD','--',path])`
          (empty output ⇒ absent, exit 0, non-throwing). catFile(['-e',`HEAD:${path}`]) THROWS when absent.

- file: plan/008_15504f60a0ef/P3M2T4S2/research/01-simple-git-mechanics.md
  why: VERIFIED simple-git@3.30.0 mechanics (Q1 list staged deletions; Q2a restore; Q2b unstage;
       Q3 existence-in-HEAD; Q4 single-checkout-restores-both). Cited against the installed
       compiled source. This is the authoritative reference for the exact method calls.

- file: plan/008_15504f60a0ef/P3M2T4S2/research/02-codebase-mock-conventions.md
  why: Layering decision (new git ops go in git-mcp.ts), result-object convention, the EXACT
       vi.mock + import + vi.mocked patterns for BOTH test files, npm script names, and the
       smartCommit insertion point (after gitAdd L377, before message resolution L385).

- file: plan/008_15504f60a0ef/P3M2T4S1/PRP.md
  why: The S1 PRP (prompt layer). It is a CONTRACT this PRP builds upon: S1 edits
       src/agents/prompts.ts + tests/unit/agents/prompts.test.ts; this PRP edits git-commit.ts +
       git-mcp.ts + their tests. ZERO file overlap. S1's prompt prohibitions are the behavioral
       front line; this PRP's restore_critical_files is the mechanical backstop. Both are required
       by PRD §5.1; they work together but are code-independent. DO NOT touch S1's files.

- file: plan/008_15504f60a0ef/architecture/phase_findings.md
  why: §PHASE 3 → "smartCommit (git-commit.ts:131)" line 77 confirms:
       "PROTECTED_FILES includes PRD.md, prd_snapshot.md, delta_prd.md, TEST_RESULTS.md —
        but NOT PRP.md or plan/ dirs." This is the gap the mechanical layer closes for PRP.md
       (and the staged-deletion gap for PRD.md, which filterProtectedFiles does not cover).
       Read-only reference; do NOT modify (plan/ is protected).
  section: "### smartCommit (git-commit.ts:131)" ~L75-79

- url: https://git-scm.com/docs/git-status#_short_format
  why: canonical meaning of the `XY` status codes (`D ` = staged deletion). Background only.
- url: https://git-scm.com/docs/git-checkout#_description
  why: proves `git checkout <tree-ish> -- <pathspec>` overwrites index AND working tree in one call (Q4).
- url: https://git-scm.com/docs/git-reset
  why: proves `git reset [<tree-ish>] -- <pathspec>` unstages with no error when the path is absent from HEAD.
- url: https://github.com/steveukx/git-js
  why: simple-git repo; documents `.raw()`, `.status()` codes, `.checkout()`, `.reset()`.
```

### Current Codebase tree (relevant slice)

```bash
src/tools/
  git-mcp.ts                # PRIMARY TARGET (add 3 wrapped git functions + result interfaces; export them)
src/utils/
  git-commit.ts             # PRIMARY TARGET (add restore_critical_files; invoke from smartCommit; extend git-mcp import)
src/core/
  task-orchestrator.ts      # UNCHANGED — smartCommit call sites at L1032 + L1084 (restore runs INSIDE smartCommit → covered)
tests/unit/tools/
  git-mcp.test.ts           # MODIFY: extend mockGitInstance (diff/checkout/reset/raw) + add tests for the 3 new helpers
tests/unit/utils/
  git-commit.test.ts        # MODIFY: extend vi.mock + import block; add describe('restore_critical_files')
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new modules. All new code is ADDED INTO existing files:
src/tools/git-mcp.ts
  + interface GitListDeletionsResult { success; files?; error? }
  + interface GitRestoreFromHeadResult { success; error? }     # shared by restore + unstage
  + gitListStagedDeletions(repoPath?)    # git diff --cached --diff-filter=D --name-only
  + gitRestoreFileFromHead(path, repoPath?)  # git checkout ['HEAD','--',path]  (index + worktree in one call)
  + gitUnstagePath(path, repoPath?)      # git reset ['HEAD','--',path]
  + (export all three + the result interfaces)
src/utils/git-commit.ts
  + restore_critical_files(repoRoot)     # the mechanical safety pass (list→basename-match→restore|unstage, warn-log, non-fatal)
  + invocation in smartCommit (after gitAdd success check, before message resolution)
  + (extend the git-mcp import to include the 3 new functions)
tests/unit/tools/git-mcp.test.ts
  + mockGitInstance.diff / .checkout / .reset / .raw (vi.fn())
  + describe('gitListStagedDeletions' / 'gitRestoreFileFromHead' / 'gitUnstagePath') unit tests
tests/unit/utils/git-commit.test.ts
  + extend vi.mock('../../../src/tools/git-mcp.js') + import to include the 3 new functions + vi.mocked bindings
  + describe('restore_critical_files') — happy path, PRP.md glob, created-and-deleted, non-critical untouched,
    invocation-order, non-fatal-on-throw
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL (research/01 Q1): git.diff() REJECTS a single-string argument with TaskConfigurationError.
// MUST pass an ARRAY: git.diff(['--cached','--diff-filter=D','--name-only']). Output is UNTRIMMED → split+trim+filter.

// CRITICAL (research/01 Q2a): git.checkout() varargs form is SILENTLY LOSSY.
// git.checkout('HEAD','--',path) → runs `git checkout HEAD` (drops '--'/path). MUST pass an ARRAY:
// git.checkout(['HEAD','--',path]).

// CRITICAL (research/01 Q2b): git.reset([path]) without 'HEAD'/'--' is ambiguous. MUST use
// git.reset(['HEAD','--',path]).

// CRITICAL (research/01 Q2a BLOCKER): the EXISTING gitRestoreFile() (git-mcp.ts:582) is INSUFFICIENT
// to undo a staged deletion — it does git.show()+atomicWrite to the WORKING TREE ONLY and never touches
// the index, so the file stays staged-as-deleted. The NEW gitRestoreFileFromHead uses git.checkout which
// clears the index AND restores the worktree in ONE call. Do NOT reuse gitRestoreFile for this feature;
// leave it unchanged (the tasks.json recovery callers depend on its index-blind semantics).

// CRITICAL (research/01): simple-git@3.30.0 has NO .restore() and NO .lsFiles() methods — calling either
// throws TypeError. Use .diff([...]) / .checkout([...]) / .reset([...]) / .raw([...]).

// GOTCHA (research/01 Q3): existence-in-HEAD check. catFile(['-e',`HEAD:${path}`]) THROWS when absent.
// show(`HEAD:${path}`) also throws. The NON-THROWING check is git.raw(['ls-tree','--name-only','HEAD','--',path])
// → empty string ⟹ absent, exit 0. (Or: skip the explicit check and use the two-strategy fallback — see Blueprint.)

// GOTCHA (research/02 §Layering): src/utils/git-commit.ts must NOT import simpleGit directly. All git I/O
// is encapsulated in src/tools/git-mcp.ts. New git ops (checkout/reset/diff-filter) go there as wrapped functions.

// GOTCHA (smartCommit ordering): restore_critical_files MUST run AFTER gitAdd (L370-377) and BEFORE the
// `if (options?.generateMessage)` block (L385). The stagecoach path calls gitDiff({staged:true}) at L387 —
// if restore runs AFTER that, the generated commit message would describe the deletion; if it runs after
// gitCommit (L438), the deletion is already committed. Insert at the single correct point (Blueprint shows it).

// GOTCHA (vi.mock hoisting): vi.mock('../../../src/tools/git-mcp.js', ...) is HOISTED above imports.
// The mock object MUST list every named export the test imports. When you add the 3 new functions to the
// test's import line, you MUST also add them to the vi.mock block — else the import yields undefined and
// vi.mocked(undefined) throws at module-eval time.

// GOTCHA (basename match vs glob): the contract says "PRD.md or matching **/PRP.md". `git diff --name-only`
// returns LITERAL repo-relative paths. A basename check (basename(p)==='PRD.md' || basename(p)==='PRP.md')
// covers root PRD.md AND every plan/{seq}_{hash}/{task}/PRP.md WITHOUT fast-glob AND without node_modules
// false positives. Do NOT introduce fast-glob for this.

// GOTCHA (non-fatal contract): smartCommit has a never-fail-on-commit contract (returns null on error, never throws).
// restore_critical_files MUST honor it: wrap each per-path operation in try/catch, log via logger().warn, continue.
// A git-mcp helper returning {success:false} is logged but does NOT abort the loop or rethrow.
```

---

## Implementation Blueprint

### Data models and structure

No domain data models change. The only new types are the two small result
interfaces in git-mcp.ts:

```typescript
/** Result of gitListStagedDeletions. */
export interface GitListDeletionsResult {
  success: boolean;
  /** Repo-relative paths currently staged as deletions (index `D`). */
  files?: string[];
  error?: string;
}

/** Result of gitRestoreFileFromHead and gitUnstagePath (shared shape). */
export interface GitRestoreFromHeadResult {
  success: boolean;
  error?: string;
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/tools/git-mcp.ts — add three wrapped git operations
  - ADD interface GitListDeletionsResult { success: boolean; files?: string[]; error?: string; }
  - ADD interface GitRestoreFromHeadResult { success: boolean; error?: string; }
  - ADD `export async function gitListStagedDeletions(repoPath?: string): Promise<GitListDeletionsResult>`:
      * const safePath = await validateRepositoryPath(repoPath); const git = simpleGit(safePath);
      * const raw = await git.diff(['--cached','--diff-filter=D','--name-only']);   // ARRAY form (research/01 Q1)
      * const files = raw.split('\n').map(s => s.trim()).filter(Boolean);
      * return { success: true, files };
      * catch → return { success: false, error: message }.
  - ADD `export async function gitRestoreFileFromHead(path: string, repoPath?: string): Promise<GitRestoreFromHeadResult>`:
      * await git.checkout(['HEAD','--',path]);   // ARRAY form (research/01 Q2a) — clears index + restores worktree
      * return { success: true }; catch → { success:false, error }.
  - ADD `export async function gitUnstagePath(path: string, repoPath?: string): Promise<GitRestoreFromHeadResult>`:
      * await git.reset(['HEAD','--',path]);   // ARRAY form (research/01 Q2b); exit 0 even if path not in HEAD
      * return { success: true }; catch → { success:false, error }.
  - FOLLOW pattern: the existing gitDiff (L367-390) and gitRestoreFile (L560-598) — validateRepositoryPath →
    simpleGit → try/catch → {success, error?}. JSDoc on each (the repo documents every git-mcp function).
  - NAMING: `git` + verb + noun, matching gitStatus/gitAdd/gitCommit/gitRestoreFile.
  - PLACEMENT: alongside gitRestoreFile (after it, before the `// ===== MCP SERVER =====` section at L600).
  - EXPORT: add the 3 functions to the `export {...}` block (L664-671) and the 2 interfaces to the
    `export type {...}` block (L643-651).
  - DO NOT modify the existing gitRestoreFile (its index-blind semantics are correct for tasks.json recovery).

Task 2: MODIFY src/utils/git-commit.ts — extend the git-mcp import
  - CHANGE L23 `import { gitStatus, gitAdd, gitCommit, gitDiff } from '../tools/git-mcp.js';` to ALSO import
    gitListStagedDeletions, gitRestoreFileFromHead, gitUnstagePath.
  - GOTCHA: keep the `.js` extension (ESM/NodeNext convention).

Task 3: MODIFY src/utils/git-commit.ts — add restore_critical_files
  - ADD `export async function restore_critical_files(repoRoot: string): Promise<void>`.
  - LOGIC (JSDoc this — Mode A "rides with the work"):
      1. const delResult = await gitListStagedDeletions(repoRoot);
         if (!delResult.success || !delResult.files?.length) return;   // nothing staged-as-deleted → no-op
      2. for (const path of delResult.files) {
           const name = basename(path);   // already imported from 'node:path' (git-commit.ts:25)
           if (name !== 'PRD.md' && name !== 'PRP.md') continue;   // non-critical → leave it staged
           // existence-in-HEAD: try restore-from-HEAD first; if it fails (not in HEAD), unstage instead.
           // (This two-strategy approach AVOIDS a separate ls-tree call — see Blueprint note.)
           const restore = await gitRestoreFileFromHead(path, repoRoot);
           if (restore.success) {
             logger().warn(`Restored critical file from HEAD (staged deletion undone): ${path}`);
           } else {
             // Likely created-and-deleted in the same run (not in HEAD) → unstage the deletion.
             const unstage = await gitUnstagePath(path, repoRoot);
             if (unstage.success) {
               logger().warn(`Unstaged critical file deletion (not in HEAD): ${path}`);
             } else {
               logger().warn(`Could not restore/unstage critical file ${path}: ${unstage.error ?? restore.error}`);
             }
           }
         }
  - GOTCHA: wrap the whole body (or each iteration) so a throw never escapes — smartCommit's never-fail-on-commit
    contract means restore_critical_files is best-effort/non-fatal. (The git-mcp helpers themselves already
    catch and return {success:false}, so they won't throw; but keep a top-level try/catch for defense.)
  - REUSE: the module-scoped `logger()` factory (L44-45) — no new logger. `basename` is already imported (L25).
  - PLACEMENT: define restore_critical_files ABOVE smartCommit (near the other helper functions, after
    filterProtectedFiles ~L80 or after the stagecoach helpers), so the function is declared before smartCommit uses it.

Task 4: MODIFY src/utils/git-commit.ts — invoke restore_critical_files from smartCommit
  - INSERT exactly ONE call, AFTER the gitAdd success check (current L377 `return null;`) and BEFORE the
    commit-message resolution block (current L385 `let formattedMessage: string;`):
        // ── Critical-File Deletion Protection (PRD §5.1, mechanical layer) ──
        // Detect staged deletions of PRD.md / **/PRP.md and undo them, so the stagecoach
        // gitDiff({staged:true}) + gitCommit below see a deletion-free staged set.
        await restore_critical_files(repoRoot);
  - DO NOT gate on options.generateMessage — restore runs for BOTH the default and stagecoach paths
    (every smartCommit commit must be protected).
  - DO NOT change the return value or control flow on restore failure (best-effort: restore_critical_files
    swallows its own errors).

Task 5: MODIFY tests/unit/tools/git-mcp.test.ts — unit-test the 3 new helpers
  - EXTEND mockGitInstance (currently { status, diff, add, commit, log, show }) with: diff (already present —
    ensure), checkout: vi.fn(), reset: vi.fn(), raw: vi.fn().
  - ADD `describe('gitListStagedDeletions')`:
      * it('returns parsed paths from raw diff output'): mockGitInstance.diff.mockResolvedValue(
          'PRD.md\nplan/008_x/P3M2T4S2/PRP.md\nsrc/foo.ts\n'); → expect files === ['PRD.md','plan/.../PRP.md','src/foo.ts'].
      * it('handles trailing newline / empties'): diff returns 'PRD.md\n\n' → files === ['PRD.md'].
      * it('passes ARRAY form to git.diff'): assert mockGitInstance.diff called with an ARRAY (not a string).
      * it('returns {success:false,error} on git error'): diff.mockRejectedValue(new Error('boom')) → {success:false}.
  - ADD `describe('gitRestoreFileFromHead')`:
      * it('calls git.checkout with ARRAY ["HEAD","--",path]'): assert toHaveBeenCalledWith(['HEAD','--',path]).
      * it('returns {success:false,error} on error').
  - ADD `describe('gitUnstagePath')`:
      * it('calls git.reset with ARRAY ["HEAD","--",path]'): assert to_have_been_called_with array.
      * it('returns {success:false,error} on error').
  - FOLLOW pattern: the existing gitRestoreFile tests (mkdtemp + readFile for atomicWrite; the new helpers
    only run git commands so no real fs needed — just stub the mockGitInstance method).
  - GOTCHA: ensure validateRepositoryPath passes — node:fs existsSync/realpathSync are already mocked
    (tests/unit/tools/git-mcp.test.ts:18-23 per research/02).

Task 6: MODIFY tests/unit/utils/git-commit.test.ts — wire mocks + add restore_critical_files tests
  - EXTEND the vi.mock('../../../src/tools/git-mcp.js', ...) block (L15-20) to ALSO stub:
      gitListStagedDeletions: vi.fn(),
      gitRestoreFileFromHead: vi.fn(),
      gitUnstagePath: vi.fn(),
  - EXTEND the import (L49-54) to import those three; add vi.mocked bindings after L70.
  - ADD `describe('restore_critical_files')`:
      * it('restores a staged PRD.md deletion from HEAD'):
          mockGitListStagedDeletions.mockResolvedValue({success:true, files:['PRD.md']});
          mockGitRestoreFileFromHead.mockResolvedValue({success:true});
          await restore_critical_files('/project');
          → expect(mockGitRestoreFileFromHead).toHaveBeenCalledWith('PRD.md','/project');
          → expect(mockGitUnstagePath).not.toHaveBeenCalled();
          → expect(mockLogger.warn).toHaveBeenCalled() (restored message).
      * it('restores a nested PRP.md deletion from HEAD') (plan/008_x/P3M2T4S2/PRP.md).
      * it('unstages a PRP.md deletion not in HEAD (created-and-deleted)'):
          mockGitRestoreFileFromHead.mockResolvedValue({success:false,error:'not in HEAD'});
          mockGitUnstagePath.mockResolvedValue({success:true});
          → expect mockGitUnstagePath called with path; restore NOT the final action.
      * it('leaves non-critical deletions staged'):
          files:['src/foo.ts'] → neither restore nor unstage called.
      * it('logs but does not throw when a helper fails'): both restore+unstage {success:false} → logger.warn,
          restore_critical_files resolves (no throw).
      * it('no-ops when gitListStagedDeletions returns no files').
  - ADD/EXTEND a smartCommit integration-style test proving invocation ORDER:
      * mockGitStatus returns a PRP.md in modified (simulating a deletion path in the modified list),
        mockGitAdd stages it, mockGitListStagedDeletions returns ['plan/.../PRP.md'],
        mockGitRestoreFileFromHead resolves success, mockGitCommit resolves hash.
      * assert call order: mockGitAdd → mockGitListStagedDeletions → mockGitRestoreFileFromHead →
        (if generateMessage) mockGitDiff → mockGitCommit. Use `expect(mockX).toHaveBeenCalledBefore(mockY)`
        (vitest supports toHaveBeenCalledBefore). The KEY assertion: restore helpers called AFTER gitAdd and
        BEFORE gitCommit (and before gitDiff on the stagecoach path).
  - FOLLOW pattern: the existing "successful operations" SETUP/EXECUTE/VERIFY tests (git-commit.test.ts:277-337).

Task 7: JSDoc (Mode A — rides with the work)
  - restore_critical_files: document the staged-deletion-detection + restore-from-HEAD / unstage logic,
    the basename match for PRD.md + **/PRP.md, the non-fatal/best-effort contract, and the PRD §5.1 reference.
  - the 3 git-mcp helpers: JSDoc each (model on gitRestoreFile/gitDiff), noting the array-argument requirement
    and (for gitRestoreFileFromHead) that it clears index + worktree in one call — distinct from gitRestoreFile.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: restore_critical_files — best-effort, basename-match, two-strategy.
// Reuse module-scoped logger() (L44-45) and basename (imported L25). No new imports except the 3 git-mcp functions.

import { gitStatus, gitAdd, gitCommit, gitDiff,
         gitListStagedDeletions, gitRestoreFileFromHead, gitUnstagePath } from '../tools/git-mcp.js';

/**
 * Mechanical critical-file deletion protection (PRD §5.1).
 *
 * Invoked from {@link smartCommit} immediately AFTER staging (`gitAdd`) and
 * BEFORE commit-message resolution / `gitCommit`. Detects any paths staged as
 * DELETIONS (`git diff --cached --diff-filter=D`) whose basename is `PRD.md`
 * or `PRP.md` (covers root `PRD.md` and every `**/PRP.md`) and undoes the
 * deletion:
 *   - if the file exists in HEAD → `git checkout HEAD -- <path>` restores the
 *     working tree AND clears the staged deletion from the index in one call;
 *   - if it was created-and-deleted in the same run (not in HEAD) →
 *     `git reset HEAD -- <path>` unstages the deletion.
 *
 * Non-fatal / best-effort (honors smartCommit's never-fail-on-commit contract):
 * per-path failures are logged via `logger().warn` and the loop continues. A
 * thrown error never escapes. This is the MECHANICAL backstop to the prompt
 * layer (P3.M2.T4.S1); together they guarantee `PRD.md` and every `PRP.md`
 * survive every commit.
 *
 * @param repoRoot - Repository root path (process.cwd() at the smartCommit call site).
 */
export async function restore_critical_files(repoRoot: string): Promise<void> {
  try {
    const del = await gitListStagedDeletions(repoRoot);
    if (!del.success || !del.files?.length) return;
    for (const path of del.files) {
      const name = basename(path);
      if (name !== 'PRD.md' && name !== 'PRP.md') continue;  // non-critical: leave staged
      try {
        const restore = await gitRestoreFileFromHead(path, repoRoot);
        if (restore.success) {
          logger().warn(`Restored critical file from HEAD (staged deletion undone): ${path}`);
          continue;
        }
        // restore failed → likely not in HEAD (created-and-deleted same run) → unstage instead.
        const unstage = await gitUnstagePath(path, repoRoot);
        if (unstage.success) {
          logger().warn(`Unstaged critical file deletion (not in HEAD): ${path}`);
        } else {
          logger().warn(`Could not restore/unstage critical file ${path}: ${unstage.error ?? restore.error}`);
        }
      } catch (perPath) {
        logger().warn(`restore_critical_files: per-path error for ${path}: ${toErrorMessage(perPath)}`);
      }
    }
  } catch (error) {
    logger().warn(`restore_critical_files: aborted: ${toErrorMessage(error)}`);
  }
}

// NOTE on the two-strategy approach (restore-then-unstage) vs an explicit ls-tree existence check:
// `gitRestoreFileFromHead` returns {success:false} when the path is absent from HEAD (git.checkout fails).
// Treating that failure as the signal to UNSTAGE is simpler and equally correct — it avoids an extra
// `git ls-tree` round-trip and handles the rare phantom-entry case defensively. (Research/01 Q3 documents
// the non-throwing ls-tree check as the alternative if you prefer explicit existence detection.)

// PATTERN: the git-mcp wrappers each follow the existing result-object convention and catch internally.
// (See Documentation & References → src/tools/git-mcp.ts pattern block for the full implementations.)

// PATTERN: smartCommit insertion — the single correct point:
//   ... gitAdd({path: repoRoot, files: filteredFiles}) ...
//   if (!addResult.success) { logger().error(...); return null; }
//   await restore_critical_files(repoRoot);        // <<< INSERT HERE (PRD §5.1 mechanical layer)
//   let formattedMessage: string;
//   if (options?.generateMessage) { const diffResult = await gitDiff({path: repoRoot, staged: true}); ... }
//   ...
//   const commitResult = await gitCommit({path: repoRoot, message: formattedMessage});
```

### Integration Points

```yaml
DATABASE:
  - none

CONFIG:
  - none (no .env.example, no constants.ts, no new env vars). The critical-file set
    (PRD.md basename + PRP.md basename) is hardcoded per PRD §5.1 — not operator-tunable.

ROUTES:
  - none (no CLI surface; mechanical internal safety, invoked from smartCommit)

DOWNSTREAM / UPSTREAM:
  - CONSUMES P3.M2.T4.S1 (prompt layer): S1's prompt prohibitions reduce how OFTEN restore fires;
    S2 catches the residual cases. Code-independent (S1 edits prompts.ts; S2 edits git-commit.ts/git-mcp.ts).
  - CONSUMED BY: every smartCommit call site is covered transparently:
      src/core/task-orchestrator.ts:1032 (pre-cleanup survival commit)
      src/core/task-orchestrator.ts:1084 (post-cleanup commit)
    No call-site change required — restore runs INSIDE smartCommit.
  - COMPLETES P3.M2.T4 (Critical-File Deletion Protection): S1 (prompt) + S2 (mechanical) together
    satisfy PRD §5.1's two-layer mandate.
  - Does NOT affect: tasks.json recovery (uses the index-blind gitRestoreFile — left unchanged),
    the commit-gen retry/fallback (P3.M1.T4 — untouched), orphaned-plan/ recovery (P3.M2.T5 — separate).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After editing src/tools/git-mcp.ts and src/utils/git-commit.ts:
npm run lint           # ESLint — zero errors (new functions follow existing patterns)
npm run format:check   # Prettier — zero diffs (run `npm run format` to auto-fix)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — zero errors
                         # (confirms the new result interfaces + exports typecheck; confirms the
                         #  extended git-mcp import in git-commit.ts resolves; confirms restore_critical_files
                         #  is declared before smartCommit uses it if you placed it above smartCommit)

# Combined gate:
npm run lint && npm run format:check && npm run typecheck
# Expected: GREEN.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The new git-mcp helpers:
npx vitest run tests/unit/tools/git-mcp.test.ts
# Expected: GREEN. New describe blocks for gitListStagedDeletions / gitRestoreFileFromHead / gitUnstagePath pass;
#   assertions that git.diff/git.checkout/git.reset were called with ARRAY arguments pass (the critical
#   simple-git pitfall guard). Existing gitRestoreFile tests still pass (unchanged).

# The restore_critical_files + smartCommit invocation tests:
npx vitest run tests/unit/utils/git-commit.test.ts
# Expected: GREEN. New describe('restore_critical_files') passes; the smartCommit invocation-order test
#   passes (restore helpers called after gitAdd, before gitDiff/gitCommit). Existing smartCommit tests still
#   pass — EXCEPT: any test that asserts the EXACT call list of the git-mcp mock may need the new
#   restore-mock wiring (gitListStagedDeletions must be stubbed to return {success:true, files:[]} or
#   {success:false} so smartCommit's restore call is a no-op in pre-existing happy-path tests). If a
#   pre-existing smartCommit test breaks because restore_critical_files now runs and calls
#   gitListStagedDeletions, stub mockGitListStagedDeletions.mockResolvedValue({success:true, files:[]})
#   in beforeEach so existing tests are unaffected. Investigate before editing.

# Full suite:
npm run test:run
# Expected: GREEN.
```

### Level 3: Integration Testing (System Validation)

```bash
# This PRP adds an internal mechanical safety pass; there is no new endpoint/CLI. Integration validation
# is a BEHAVIORAL check against a real (temp) git repo: stage a deletion of a tracked PRP.md, run
# restore_critical_files (or smartCommit), and assert the deletion is NOT committed. If the repo has an
# existing integration test harness for git-commit, extend it; otherwise the Level-2 unit tests with
# faithfully-mocked git behavior are sufficient (the simple-git mechanics are verified in research/01).

# Manual grep checks — prove the wiring landed:
grep -n "restore_critical_files" src/utils/git-commit.ts
# Expected: a function DEFINITION + exactly ONE invocation inside smartCommit (after gitAdd, before gitCommit).

grep -nE "gitListStagedDeletions|gitRestoreFileFromHead|gitUnstagePath" src/tools/git-mcp.ts
# Expected: 3 definitions + 3 export entries.

grep -nE "\.diff\(\['--cached', '--diff-filter=D'" src/tools/git-mcp.ts
grep -nE "\.checkout\(\['HEAD', '--'" src/tools/git-mcp.ts
grep -nE "\.reset\(\['HEAD', '--'" src/tools/git-mcp.ts
# Expected: one match each — proving the ARRAY forms are used (NOT varargs/string forms).

# Confirm the invocation point is BETWEEN gitAdd and the message-resolution/gitCommit:
awk '/smartCommit\(/,0' src/utils/git-commit.ts | grep -nE "gitAdd\(|restore_critical_files\(|generateMessage|gitDiff\(|gitCommit\(" | head
# Expected ordering: gitAdd( ... ) → restore_critical_files( ... ) → (generateMessage?) gitDiff( ... ) → gitCommit( ... )
```

### Level 4: Creative & Domain-Specific Validation

```bash
# (Optional, belt-and-suspenders) Real-repo behavioral check in a throwaway temp dir — proves the
# simple-git mechanics end-to-end (research/01 was static source analysis; this locks it in):
tmp=$(mktemp -d) && cd "$tmp" && git init -q && git config user.email t@t && git config user.name t
echo "PRD" > PRD.md && mkdir -p plan/x && echo "PRP" > plan/x/PRP.md
git add -A && git commit -qm init
# simulate an agent deleting + staging the deletion:
git rm -q PRD.md plan/x/PRP.md
# at this point `git diff --cached --diff-filter=D --name-only` lists both. Run restore_critical_files
# (or a tiny node -e script importing it) against "$tmp", then:
git status --porcelain
# Expected: NEITHER PRD.md NOR plan/x/PRP.md shows as a staged deletion (D ); both restored to HEAD content.

# Also confirm the created-and-deleted branch: create an untracked PRP.md, stage it, then git rm it,
# so it is staged-as-deleted but NOT in HEAD → restore_critical_files should unstage (git reset HEAD --)
# rather than error.

# Confirm scope — only the four expected files changed:
git diff --name-only
# Expected EXACTLY:
#   src/tools/git-mcp.ts
#   src/utils/git-commit.ts
#   tests/unit/tools/git-mcp.test.ts
#   tests/unit/utils/git-commit.test.ts
# (plus S1's src/agents/prompts.ts + tests/unit/agents/prompts.test.ts if S1 lands in the same branch;
#  plus plan/008_.../P3M2T4S2/ research/PRP artifacts, which are not source). If prompts.ts,
#  agent-factory.ts, task-orchestrator.ts, prp-executor.ts, or any workflow appears, STOP — out of scope
#  / collides with S1 or P3.M2.T3.S1 or P3.M2.T5.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed successfully.
- [ ] `npm run lint` GREEN (zero errors).
- [ ] `npm run format:check` GREEN (zero diffs).
- [ ] `npm run typecheck` GREEN (zero errors).
- [ ] `npm run test:run` GREEN (full suite).
- [ ] `npm run validate` GREEN (the project's combined gate).

### Feature Validation

- [ ] `gitListStagedDeletions`, `gitRestoreFileFromHead`, `gitUnstagePath` exist in git-mcp.ts and are exported.
- [ ] Each new git-mcp helper uses the ARRAY argument form for `git.diff`/`git.checkout`/`git.reset` (Level 3 grep confirms).
- [ ] `restore_critical_files` exists, is exported from git-commit.ts, and restores/unstages critical-file staged deletions (basename `PRD.md` or `PRP.md`).
- [ ] `restore_critical_files` is invoked EXACTLY ONCE from `smartCommit`, AFTER the `gitAdd` success check and BEFORE the commit-message-resolution block (Level 3 awk confirms ordering).
- [ ] A staged deletion of `PRD.md` is restored from HEAD and NOT committed.
- [ ] A staged deletion of any `**/PRP.md` is restored from HEAD (or unstaged if not in HEAD) and NOT committed.
- [ ] A staged deletion of a non-critical file (`src/foo.ts`) is left staged (the commit includes it).
- [ ] Restore failures are logged (`logger().warn`) and non-fatal — the commit still runs.
- [ ] The existing `gitRestoreFile` (index-blind) is UNCHANGED (tasks.json recovery callers unaffected).
- [ ] JSDoc on `restore_critical_files` documents the staged-deletion-detection + restore/unstage logic (Mode A).
- [ ] `git diff --name-only` shows EXACTLY the four expected files (plus optional S1 files).

### Code Quality Validation

- [ ] Follows existing patterns: git-mcp wrapped-function convention (`validateRepositoryPath` → `simpleGit` → `{success,error?}`); git-commit.ts lazy-logger + basename reuse; test SETUP/EXECUTE/VERIFY style.
- [ ] File placement unchanged (no new modules — new code added INTO existing files).
- [ ] Anti-patterns avoided: no `simpleGit` import in git-commit.ts; no varargs `git.checkout(...)` / single-string `git.diff(...)`; no reuse of the index-blind `gitRestoreFile` for staged-deletion undo; no fast-glob (basename match suffices); no out-of-scope file edits.
- [ ] Dependencies properly managed: no new dependencies; reuses `simple-git`, `node:path` basename, existing logger.

### Documentation & Deployment

- [ ] Mode A: no new env vars, no config file changes, no README/docs/ edits. JSDoc rides with the work.
- [ ] The PRD §5.1 "Mechanical layer (`restore_critical_files`)" requirement is now satisfied; combined with S1 (prompt layer), P3.M2.T4 "Critical-File Deletion Protection" is COMPLETE.

---

## Anti-Patterns to Avoid

- ❌ **Don't import `simpleGit` into `src/utils/git-commit.ts`.** All git I/O is encapsulated in
     `src/tools/git-mcp.ts` (research/02 §Layering). Add the three new wrapped functions THERE and import them.
- ❌ **Don't use varargs `git.checkout('HEAD','--',path)` or a single-string `git.diff('...')`.** Both are
     silently wrong or throw. ALWAYS pass an ARRAY (research/01 Q1, Q2a). This is the #1 simple-git pitfall.
- ❌ **Don't reuse the existing `gitRestoreFile` to undo a staged deletion.** It is index-blind
     (`git.show`+`atomicWrite` writes the working tree only) — the file stays staged-as-deleted. Use the NEW
     `gitRestoreFileFromHead` (`git.checkout(['HEAD','--',path])`) which clears index + worktree in one call.
- ❌ **Don't call `.restore()` or `.lsFiles()` on the simple-git instance.** Neither exists in 3.30.0 — both
     throw `TypeError` (research/01). Use `.checkout([...])` / `.reset([...])` / `.diff([...])` / `.raw([...])`.
- ❌ **Don't place the `restore_critical_files` invocation AFTER the `gitDiff({staged:true})` stagecoach call
     or after `gitCommit`.** It MUST run right after `gitAdd` so the stagecoach diff AND the commit see the
     corrected (deletion-free) staged set. The single correct insertion point is documented in the Blueprint.
- ❌ **Don't make `restore_critical_files` fatal.** smartCommit has a never-fail-on-commit contract. Wrap
     per-path ops in try/catch, log via `logger().warn`, and continue. A throw must never escape into
     smartCommit's control flow.
- ❌ **Don't introduce `fast-glob` to resolve `**/PRP.md`.** `git diff --name-only` returns literal paths;
     a `basename(p) === 'PRP.md'` test covers every PRP.md without node_modules false positives.
- ❌ **Don't edit `src/agents/prompts.ts`** (S1 owns it), **`src/agents/agent-factory.ts`** (P3.M2.T3.S1 owns it),
     **`src/core/task-orchestrator.ts`** (smartCommit call sites need NO change — restore runs inside smartCommit),
     or **`prp-executor.ts`** (out of scope).
- ❌ **Don't modify the existing `gitRestoreFile`.** Its index-blind semantics are correct for the
     `tasks.json` recovery callers; changing it would break P3.M2.T1. Add `gitRestoreFileFromHead` as a sibling.
- ❌ **Don't forget to extend the `vi.mock` block when you extend the test import.** `vi.mock` is hoisted; the
     mock object MUST list every named export the test imports, else the import is `undefined` and
     `vi.mocked(undefined)` throws at module-eval time (research/02).
- ❌ **Don't add config, env vars, or docs.** Mode A — JSDoc only.

---

## Confidence Score

**9/10** for one-pass implementation success.

Rationale: The git mechanics are fully verified against the **installed**
`simple-git@3.30.0` compiled source (research/01 — every method call, argument
shape, and pitfall traced), not README commentary. The codebase layering and
mock/test conventions are documented with exact file:line references and
verbatim patterns (research/02). The two non-obvious blockers — (1) the existing
`gitRestoreFile` is index-blind and INSUFFICIENT for staged-deletion undo, and
(2) simple-git's varargs/string forms are silently lossy/throwing — are both
called out with the exact fix (new `gitRestoreFileFromHead` via
`git.checkout([...])`; array forms everywhere). The single correct insertion
point in smartCommit (after `gitAdd`, before message resolution) is pinned to
exact line numbers and proven by the awk ordering check. The contract maps 1:1
to the tasks. The -1 is for the two judgment calls: (a) whether to stub
`gitListStagedDeletions` in pre-existing happy-path smartCommit tests so they
remain no-ops (Task 6 notes this), and (b) the two-strategy (restore-then-unstage)
vs explicit `ls-tree` existence-check choice — both are correct and the PRP
recommends the simpler two-strategy form with the alternative documented. No
external dependencies, no runtime control-flow change beyond the single inserted
`await`, no parallel-PR collision (scoped strictly to git-mcp.ts + git-commit.ts
+ their tests; S1 owns prompts.ts; P3.M2.T3.S1 owns agent-factory.ts).