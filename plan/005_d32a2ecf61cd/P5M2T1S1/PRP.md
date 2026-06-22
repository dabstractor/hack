# PRP — P5.M2.T1.S1: Add git file-history + file-restore utilities to git-mcp.ts

## Goal

**Feature Goal**: Add three **generic, async, typed** git-history/file-restore utility functions to `src/tools/git-mcp.ts` that enable the smart-recovery routine (P5.M2.T1.S2) to walk a file's commit history and restore a prior valid version from git. The three functions:
- `gitFileHistory(filePath, repoPath?)` → ordered list of `{ commit, date }` entries that touched `filePath` (newest-first), wrapping simple-git's `.log({ file })`.
- `gitReadFileAtCommit(filePath, commit, repoPath?)` → the file's blob content (string) at `commit`, wrapping `git show <commit>:<path>` (simple-git `.show`).
- `gitRestoreFile(filePath, commit?, repoPath?)` → writes the blob at `commit` (default `HEAD`) to disk via `atomicWrite`, restoring a prior valid version of the file.

These are **internal utilities consumed by S2** (the smart-recovery routine), NOT new MCP tools.

**Deliverable**:
1. `src/tools/git-mcp.ts` — three new exported async functions (`gitFileHistory`, `gitReadFileAtCommit`, `gitRestoreFile`) with full JSDoc; one new exported result type (`GitFileHistoryEntry`); one new import (`atomicWrite` from `../core/session-utils.js`); appended export statements. The existing `gitStatus`/`gitDiff`/`gitAdd`/`gitCommit`, the `GitMCP` class, all tool schemas, and `validateRepositoryPath` are **unchanged**.
2. `tests/unit/tools/git-mcp.test.ts` — extend the existing mock (`mockGitInstance` gains `log` + `show`), extend the existing value import, and add NEW `describe` blocks (RED-first, then GREEN) covering: history happy-path + ordering + call args + empty-history + error/reject; read-at-commit happy-path + call args + error/reject; restore happy-path (writes the prior content to a real tmpdir via `atomicWrite`) + error/reject.

**Success Definition**: `npm run validate` (eslint + prettier --check + tsc --noEmit) and `npm run test:run` (vitest run) both green; the new `describe` blocks pass; every existing `git-mcp.test.ts` assertion still passes (the additions are mock-and-import compatible, not behavior-changing); `git diff --stat` shows ONLY `src/tools/git-mcp.ts` + `tests/unit/tools/git-mcp.test.ts`; the `GitMCP` class and its `tools` array / `registerToolExecutor` calls are untouched.

## User Persona

**Target User**: The pipeline orchestrator (specifically the smart-recovery routine built in **P5.M2.T1.S2**).

**Use Case**: After an agent run corrupts `tasks.json` (truncated write / partial edit / schema-invalid mutation), the orchestrator calls `gitFileHistory('tasks.json')` to find the commits that touched it, `gitReadFileAtCommit('tasks.json', <lastGoodHash>)` to fetch the last valid blob, and `gitRestoreFile('tasks.json', <lastGoodHash>)` to restore it to disk before re-applying the in-flight status delta (PRD §5.1 "tasks.json Protection & Smart Recovery").

**User Journey**: orchestrator agent run → re-read `tasks.json` from disk → parse fails → `gitFileHistory(path)` → pick last-good commit → `gitReadFileAtCommit(path, commit)` (or `gitRestoreFile(path, commit)`) → valid JSON is back on disk → re-apply in-flight status → continue. None of these utilities know about `tasks.json` specifically — they are generic over any `filePath`.

**Pain Points Addressed**: PRD §5.1 — "Agents routinely corrupt `tasks.json` ... The system must survive this without human intervention." Today there is **no** way to read or restore a prior version of a file from git history (see `delta_impact.md` R4 + `implementation_notes.md` §5: only `gitStatus/gitDiff/gitAdd/gitCommit` exist). This subtask supplies the missing primitives.

## Why

- **Business value**: Closes the **first half of R4** ("tasks.json Protection & Smart Recovery", PRD §5.1, §9.3.2). Without git-history/restore primitives, S2's smart-recovery routine has nothing to build on — there is no `gitLog`/`gitShow`/`gitRestore` in the codebase today. These three generic functions are the foundation S2 composes into the recovery flow.
- **Scope boundary**: This subtask owns the **git-history/restore PRIMITIVES only**. S2 (`P5.M2.T1.S2`) owns the **smart-recovery routine** (re-apply legitimate status delta + git-history restore + the Mode B `ARCHITECTURE.md` smart-recovery narrative). S3 (`P5.M2.T1.S3`) wires it into the orchestrator after each agent run. This subtask produces ONLY the three functions + their tests. Do NOT write the recovery routine, do NOT touch `src/core/state-validator.ts` or `task-orchestrator.ts`, do NOT edit `docs/` or `ARCHITECTURE.md`.
- **Why `git-mcp.ts` (not a new file)**: the contract's primary option ("Implement new exported functions in `git-mcp.ts` ... or a new `src/tools/git-history.ts`"). Adding to `git-mcp.ts` reuses the module-private `validateRepositoryPath` helper (DRY) and matches "Follow the existing module patterns". A separate file would require either re-exporting or duplicating path validation. Keep it in `git-mcp.ts`.

## What

### User-visible behavior

None directly — these are internal library functions (not MCP tools, not CLI commands). The observable downstream effect (in S2/S3) is: after a corrupting agent run, the orchestrator can recover `tasks.json` (or any file) from git history automatically, without human intervention.

### Technical requirements (the CONTRACT)

1. **Three new exported async functions** in `src/tools/git-mcp.ts`, signatures (with the optional trailing `repoPath?` the module convention requires):
   ```ts
   gitFileHistory(filePath: string, repoPath?: string): Promise<GitFileHistoryEntry[]>
   gitReadFileAtCommit(filePath: string, commit: string, repoPath?: string): Promise<string>
   gitRestoreFile(filePath: string, commit?: string, repoPath?: string): Promise<void>
   ```
   - `repoPath` defaults to `process.cwd()` (every existing function in this module takes a path — this keeps them consistent and lets S2/tests target a specific repo). `repoPath` is ALWAYS the last optional param.
   - `commit` (in `gitRestoreFile`) defaults to `'HEAD'` (restore the committed version of the file). `commit` is a git revision (full hash, short hash, or symbolic ref like `HEAD`/`HEAD~1`); git validates it — invalid revisions cause git to error, which the function surfaces as a thrown `Error`.
2. **THROW on failure — NOT the `{ success, error }` object pattern.** This is a DELIBERATE pattern difference from the existing `gitStatus`/`gitDiff`/`gitAdd`/`gitCommit` functions (which return `{ success: false, error }`). The contract signatures return plain typed data (`{commit,date}[]` / `string` / `void`) and CONTRACT #1 says "throw on non-zero exit". S2's smart-recovery will consume these via `try/catch`. On success return the typed data; on any failure (path validation, non-zero git exit, write error) **throw an `Error`** with a descriptive message. Do NOT swallow errors into a result object.
3. **`gitFileHistory` returns `[]` on no-history (does NOT throw).** simple-git's `.log({ file })` for a file with no commit history returns `{ all: [], total: 0, latest: null }` (no error). Map that to `[]`. Only throw on real git errors (e.g., repo/path problems).
4. **`gitReadFileAtCommit` uses `git show <commit>:<path>`** via simple-git `.show(\`${commit}:${filePath}\`)`, returning the blob content as a string. (`.raw(['show', \`${commit}:${filePath}\`])` is an equivalent fallback — same git invocation — use it only if `.show()` is problematic.)
5. **`gitRestoreFile` fetches the blob then writes it via `atomicWrite`**: `const content = await git.show(\`${commit}:${filePath}\`); await atomicWrite(resolve(safePath, filePath), content);`. The write target is `resolve(safePath, filePath)` (the file path resolved against the validated repo root), so the restored file lands in the repo regardless of cwd. Import `atomicWrite` from `../core/session-utils.js`.
6. **Reuse `validateRepositoryPath`** (the existing module-private helper) for path validation in all three functions, exactly as the existing four functions do — `const safePath = await validateRepositoryPath(repoPath); const git = simpleGit(safePath);`. If validation fails (path missing / not a git repo) it throws, which propagates (per requirement #2).
7. **Internal utilities only — do NOT register MCP tools.** Do NOT add tool schemas (`gitFileHistoryTool` etc.), do NOT add to the `GitMCP.tools` array, do NOT add `registerToolExecutor` calls, do NOT touch the `GitMCP` class. These are plain exported functions for S2 to import directly.
8. **Full JSDoc** on all three functions + `GitFileHistoryEntry` (Mode A docs, per contract). Mirror the JSDoc style of the existing functions (`@remarks`, `@param`, `@returns`, `@throws`, `@example`).
9. **TDD (RED before GREEN — `implementation_notes.md` §7).** Write the failing `describe` blocks in `tests/unit/tools/git-mcp.test.ts` FIRST; confirm RED (`npm run test:run -- git-mcp`); then implement the functions; then confirm GREEN.
10. **No external doc file (Mode A docs = JSDoc only).** Do NOT edit `docs/ARCHITECTURE.md`, `docs/WORKFLOWS.md`, `README.md`, or any `docs/*` file. The smart-recovery narrative is deferred to S2 (per contract).
11. **Generic over any file path.** The functions must NOT be `tasks.json`-specific. They take `filePath` as an opaque string. (S2 will call them with `'tasks.json'`.)

### Success Criteria

- [ ] `gitFileHistory`, `gitReadFileAtCommit`, `gitRestoreFile` are exported from `src/tools/git-mcp.ts`.
- [ ] `gitFileHistory` returns `{ commit, date }[]` mapped from `git.log({ file }).all` (newest-first), returns `[]` on no-history, throws on git error.
- [ ] `gitReadFileAtCommit` returns the blob string from `git show <commit>:<path>`, throws on git error.
- [ ] `gitRestoreFile` writes the blob at `commit` (default `HEAD`) to `resolve(safePath, filePath)` via `atomicWrite`, throws on git error or write failure.
- [ ] All three THROW on failure (not `{ success, error }`), reuse `validateRepositoryPath`, and take an optional trailing `repoPath`.
- [ ] The `GitMCP` class, its `tools` array, all tool schemas, and `validateRepositoryPath` are unchanged.
- [ ] New `describe` blocks in `git-mcp.test.ts` pass; RED observed before GREEN (TDD).
- [ ] `npm run validate` passes (zero errors: eslint + prettier --check + tsc --noEmit).
- [ ] `npm run test:run` passes (all green).
- [ ] `git diff --stat` shows ONLY `src/tools/git-mcp.ts` + `tests/unit/tools/git-mcp.test.ts`.

## All Needed Context

### Context Completeness Check

_Pass_: An agent with zero codebase knowledge can implement this from (a) the three verbatim function bodies in "Implementation Blueprint → Implementation Patterns", (b) the exact mock additions + describe blocks in "Implementation Tasks", (c) the verified simple-git API (`LogResult.all` newest-first with `hash`/`date`; `.show(rev:path)` returns the blob string) and (d) the verified validation commands. Every reference resolves to a real file/line in the tree today. No inference required — it is three small functions (each ~5–10 lines of logic) + a stubbed test extension that mirrors the existing ~400 lines of mock-based tests in the same file.

### Documentation & References

```yaml
# MUST READ — the PRIMARY file edited (the target module)
- file: src/tools/git-mcp.ts
  why: |
    The module to extend. It already wraps simple-git (simpleGit(safePath)) for gitStatus/gitDiff/gitAdd/gitCommit.
    KEY THINGS TO REUSE:
      - validateRepositoryPath(path?) — module-private helper (L~155). validates path exists + has .git, returns realpath.
        REUSE IT in all three new functions exactly as the existing four do: `const safePath = await validateRepositoryPath(repoPath); const git = simpleGit(safePath);`
      - The IMPORT BLOCK (L21–30): `import { existsSync, realpathSync } from 'node:fs'; import { resolve, join } from 'node:path'; import { simpleGit, type StatusResult, type CommitResult, type Options } from 'simple-git'; import { GitError } from 'simple-git'; import { MCPHandler, type Tool } from 'groundswell';`
        ADD: `import { atomicWrite } from '../core/session-utils.js';` (after the groundswell import).
      - The EXPORT BLOCK at the very bottom: `export type { ... }; export { gitStatusTool, ..., gitStatus, gitDiff, gitAdd, gitCommit };`
        APPEND the three functions + GitFileHistoryEntry type to BOTH the `export type` and `export` statements (see Tasks).
      - The GitMCP class (bottom, before exports) — DO NOT TOUCH (these are internal utilities, not MCP tools).
  pattern: |
    # EXISTING function body shape (e.g. gitDiff) — follow this STRUCTURE but THROW on error instead of returning {success,error}:
    async function gitDiff(input: GitDiffInput): Promise<GitDiffResult> {
      try {
        const safePath = await validateRepositoryPath(input.path);
        const git = simpleGit(safePath);
        let diff: string;
        ... // git op
        return { success: true, diff };   // <-- the NEW fns do NOT do this; they `return diff;` and let errors throw
      } catch (error) {
        return { success: false, error: ... };   // <-- the NEW fns do NOT catch-and-wrap; they re-throw (see Implementation Patterns)
      }
    }
  gotcha: |
    - The existing four functions return {success, error} objects and SWALLOW errors. The THREE NEW functions MUST NOT follow that error pattern — they THROW on failure (per CONTRACT #1 + the contract signatures returning plain typed data). This is a deliberate difference; do not auto-copy the try/catch wrapper.
    - These are INTERNAL utilities: do NOT add tool schemas, do NOT touch the GitMCP class, do NOT register tool executors.
    - `join` is already imported but `gitRestoreFile` needs `resolve` (also already imported) for the atomicWrite target. No new node:path import needed.

# MUST READ — the atomicWrite dependency (imported into git-mcp.ts by this subtask)
- file: src/core/session-utils.ts
  why: |
    `atomicWrite(targetPath: string, data: string): Promise<void>` (L~90) writes data via temp-file + rename (crash-safe).
    gitRestoreFile imports it: `import { atomicWrite } from '../core/session-utils.js';`.
    Signature: `atomicWrite(targetPath, data)`. It throws SessionFileError on write/rename failure (propagates — correct for THROW-on-failure).
  section: "atomicWrite()"
  gotcha: |
    - session-utils.ts does NOT import from src/tools/ → NO circular dependency. Importing core from a tool module is explicitly
      sanctioned by the item contract ("writes the blob to disk via atomicWrite"). No other src/tools/*.ts imports core today, but
      that is a non-issue here (no cycle, contract-blessed).
    - atomicWrite resolves the temp file in dirname(targetPath); the parent dir must exist. For gitRestoreFile the parent is
      resolve(safePath, dirname(filePath)) — which exists because it's inside a real git repo. Safe.

# MUST READ — the test file to extend (mock-based, RED-first)
- file: tests/unit/tools/git-mcp.test.ts
  why: |
    The named test target. It ALREADY declares a MODULE-LEVEL `vi.mock('simple-git', () => ({ simpleGit: vi.fn(() => mockGitInstance), GitError: ... }))`
    (L19–27) that intercepts ALL simple-git usage in this file. `mockGitInstance = { status, diff, add, commit }` (L~56).
    This means a "real ephemeral git repo" test in THIS file is impossible (the mock intercepts it) — so use the STUBBED approach
    (explicitly allowed by the contract: "or stub simple-git methods").
    WHAT TO ADD:
      1. `log: vi.fn()` and `show: vi.fn()` to `mockGitInstance` (so gitFileHistory/gitReadFileAtCommit/gitRestoreFile can be stubbed).
      2. Extend the value import from '../../../src/tools/git-mcp.js' with: gitFileHistory, gitReadFileAtCommit, gitRestoreFile + type GitFileHistoryEntry.
      3. NEW describe blocks (verbatim in "Implementation Tasks") for history / read-at-commit / restore (RED-first).
      4. For gitRestoreFile's happy-path: write to a REAL tmpdir (node:fs/promises mkdtemp) to exercise atomicWrite end-to-end — node:fs/promises is NOT mocked by this file, so atomicWrite writes for real. existsSync (mocked, returns true) lets validateRepositoryPath pass for the tmpdir.
  pattern: |
    # EXISTING mock + stub idiom (mirror it for log/show):
    const mockGitInstance = { status: vi.fn(), diff: vi.fn(), add: vi.fn(), commit: vi.fn() };
    ...
    mockGitInstance.diff.mockResolvedValue('diff --git ...');
    const result = await gitDiff(input);
    expect(result.success).toBe(true);
    expect(mockGitInstance.diff).toHaveBeenCalledWith(['--cached']);
  gotcha: |
    - Do NOT remove or weaken the existing module-level `vi.mock('simple-git', ...)`. Adding `log`/`show` to mockGitInstance is additive and safe (the existing four tests don't touch them; afterEach `vi.clearAllMocks()` is compatible).
    - Do NOT modify any existing assertion or import — only ADD.
    - The existing afterEach does `vi.clearAllMocks()` — this resets call counts between tests, which is fine for the new fns too.
    - Test files are EXCLUDED from `npm run typecheck` (tsconfig.build.json excludes tests). Import paths need only be RUNTIME-correct (vitest resolves them). The existing 3-level `../../../src/tools/git-mcp.js` path is proven — match it for the extended import (it's the SAME import statement, just with more named bindings).
    - vitest.config.ts enforces 100% coverage ONLY via `npm run test:coverage`, NOT via `npm run test:run` or `npm run validate`. Coverage is therefore NOT a gate for this subtask (implementation_notes.md §10). Still aim for good coverage of the new branches.

# REFERENCE — the contract for this subtask (verbatim item description)
- file: plan/005_d32a2ecf61cd/architecture/implementation_notes.md
  why: §5 "NO git file-history utilities exist — R4 builds them from scratch" confirms the current git-mcp.ts surface and the exact simple-git primitives to wrap (.log({file}), .show, raw git show). §7 (same-commit TDD). §10 (validation gates).
  section: "§5, §7, §10"

# REFERENCE — R4 scope boundary + what S2/S3 own (do not duplicate)
- file: plan/005_d32a2ecf61cd/architecture/delta_impact.md
  why: R4 "What must change" item 1 = THIS subtask (git history utilities NEW). Item 2 = S2 (smart-recovery routine: re-apply delta + git-history restore). Item 3 = S3 (orchestrator integration). Confirms these utilities are generic over any file, consumed by S2.
  section: "R4 — tasks.json Protection & Smart Recovery"

# REFERENCE — PRD source of truth (smart-recovery rationale)
- file: PRD.md
  why: §5.1 "tasks.json Protection & Smart Recovery" — "the system walks git commit history (prior versions of the file) to locate the last valid JSON, restores it". §9.3.2 mentions the orchestrator restore-on-corruption. These utilities implement the primitives that make that walk possible.
  section: "§5.1 (esp. the tasks.json Protection & Smart Recovery block), §9.3.2"

# REFERENCE — simple-git API (verified against installed typings)
- url: https://github.com/steveukx/git-js/blob/master/docs/PLUGIN-GUIDE.md#log (and src/typings)
  why: |
    Verified API from node_modules/simple-git/dist/typings (this is the source of truth, not the web):
      - git.log({ file }) → LogResult { all: ReadonlyArray<DefaultLogFields & ListLogLine>; total; latest } — NEWEST-FIRST. DefaultLogFields = { hash, date, message, refs, body, author_name, author_email }. No-history file ⇒ { all: [], total: 0, latest: null } (no throw).
      - git.show(option: string | string[]) → Promise<string> — runs `git show <option>`. `git show <commit>:<path>` prints the BLOB CONTENT. So `git.show(`${commit}:${filePath}`)` returns the file content string.
      - git.raw([...commands]) → Promise<string> — equivalent fallback for the blob fetch: `git.raw(['show', `${commit}:${filePath}`])`.
  critical: |
    - .log entries are NEWEST-FIRST by default (git log order) — the test asserts ordering on this.
    - .show(`<commit>:<path>`) returns the file CONTENT (not a commit diff) because git treats `<tree-ish>:<path>` as a blob reference. Do not confuse it with `git show <commit>` (which shows the commit + diff).
    - map entry.hash → "commit", entry.date → "date" in GitFileHistoryEntry.

# REFERENCE — the in-flight / sibling PRPs (do not duplicate / do not conflict)
- file: plan/005_d32a2ecf61cd/P5M1T3S2/PRP.md
  why: Runs in parallel; edits src/agents/prompts.ts + tests under tests/unit/agents/prompts/. ZERO overlap with this subtask (different module, different test directory). The parallel-execution-context note requires reading it as a contract — confirmed: it produces no git-mcp.ts or git-mcp.test.ts change.
- file: (future) plan/005_d32a2ecf61cd/P5M2T1S2/PRP.md
  why: S2 is the CONSUMER of these three functions. It is Planned (not yet written). This subtask's signatures (above) are the contract S2 will import against — do NOT change the function names, param order, or THROW-on-failure semantics without breaking S2.
```

### Current Codebase tree (relevant slice)

```bash
src/tools/
└── git-mcp.ts                       # <-- EDIT: +3 fns (gitFileHistory/gitReadFileAtCommit/gitRestoreFile), +GitFileHistoryEntry, +atomicWrite import, +exports

src/core/
└── session-utils.ts                 # <-- DO NOT TOUCH (atomicWrite is imported FROM here, already exists)

tests/unit/tools/
└── git-mcp.test.ts                  # <-- EDIT: +log/show on mockGitInstance, +import bindings, +3 describe blocks

# Out of scope (do NOT touch):
src/core/state-validator.ts          # S2 territory (smart-recovery routine)
src/core/task-orchestrator.ts        # S3 territory (orchestrator wiring)
src/utils/git-commit.ts              # PROTECTED_FILES rules (unchanged per delta)
docs/ARCHITECTURE.md                 # Mode B narrative deferred to S2
docs/WORKFLOWS.md, README.md         # Mode B, deferred to P5.M3
src/agents/prompts.ts                # P5.M1.T3.S2 (parallel sibling)
```

### Desired Codebase tree with files to be modified

```bash
src/tools/
└── git-mcp.ts                       # MODIFIED (additive): +atomicWrite import, +3 fns + GitFileHistoryEntry, +exports

tests/unit/tools/
└── git-mcp.test.ts                  # MODIFIED (additive): +log/show mock methods, +import bindings, +3 describe blocks
```

> **File-placement decision**: Both edits land in EXISTING files — no new modules. Adding to `git-mcp.ts` (not a new `git-history.ts`) reuses the module-private `validateRepositoryPath` and matches the contract's primary option. The test stays in the single named file per the contract, using the stubbed approach (the module-level `vi.mock('simple-git')` makes a real-repo test impossible there).

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: The THREE new functions THROW on failure — they do NOT return { success, error }.
//   The existing gitStatus/gitDiff/gitAdd/gitCommit swallow errors into result objects. Do NOT copy that.
//   CONTRACT #1 ("throw on non-zero exit") + the contract signatures (Promise<{commit,date}[]>, Promise<string>, Promise<void>)
//   require THROW. S2's smart-recovery will use try/catch. If you wrap in try/catch-and-return-{success,error}, S2 breaks.

// CRITICAL: gitFileHistory returns [] on NO HISTORY (does NOT throw). simple-git .log({ file }) for a never-committed
//   file returns { all: [], total: 0, latest: null } with NO error. Map that to []. Only throw on real git errors.

// CRITICAL: gitReadFileAtCommit uses `git show <commit>:<path>` — git.show(`${commit}:${filePath}`) returns the BLOB CONTENT
//   (the file's bytes), NOT a commit diff. This is because git treats `<tree-ish>:<path>` as a blob reference. Verify in the
//   test by asserting the returned string equals the stubbed blob content.

// CRITICAL: These are INTERNAL utilities. Do NOT add tool schemas (gitFileHistoryTool etc.), do NOT touch the GitMCP class,
//   do NOT register tool executors. They are plain exported functions S2 imports directly.

// CRITICAL: Reuse the module-private validateRepositoryPath in all three functions (do NOT duplicate path validation).
//   `const safePath = await validateRepositoryPath(repoPath); const git = simpleGit(safePath);` — same as the existing four fns.
//   validateRepositoryPath throws on missing path / non-git dir — that throw propagates (correct for THROW-on-failure).

// CRITICAL: gitRestoreFile writes to resolve(safePath, filePath) — the file path resolved against the VALIDATED repo root,
//   NOT against process.cwd(). This ensures the restored file lands inside the repo regardless of cwd. Use `resolve` (already imported).

// GOTCHA: The test file already declares `vi.mock('simple-git', ...)` module-wide (returns mockGitInstance). A real-repo test
//   in the SAME file is impossible — the mock intercepts simpleGit(). Use the STUBBED approach (add log/show to mockGitInstance).
//   The contract explicitly allows this ("or stub simple-git methods").

// GOTCHA: node:fs (existsSync, realpathSync) IS mocked by the test file; node:fs/promises is NOT. So atomicWrite (which uses
//   fs/promises writeFile/rename/unlink) writes for REAL. For gitRestoreFile's happy-path test, write to a real tmpdir to verify
//   the restore end-to-end (existsSync mock returns true → validateRepositoryPath passes for the tmpdir).

// GOTCHA: tsconfig.build.json EXCLUDES tests. So `npm run typecheck` (tsc --noEmit -p tsconfig.build.json) does NOT typecheck
//   test files. Test import paths need only be RUNTIME-correct (vitest resolves them). The 3-level `../../../src/tools/git-mcp.js`
//   path is proven — extend the EXISTING import statement (don't add a second one).

// GOTCHA: ESM import specifiers use `.js` in `.ts` files. The atomicWrite import in git-mcp.ts is `'../core/session-utils.js'`
//   (matches session-utils.ts's own `.js`-suffix imports).

// GOTCHA: vitest.config.ts sets coverage thresholds to 100% — but coverage is enforced ONLY by `npm run test:coverage`,
//   NOT by `npm run test:run` or `npm run validate` (implementation_notes.md §10). Coverage is NOT a gate. Still cover the new branches.

// GOTCHA: .log({ file }) returns entries NEWEST-FIRST (git log default order). The test asserts that ordering. Do not reverse it.

// GOTCHA: The optional repoPath param MUST be the LAST param on each function (so positional calls still work):
//   gitFileHistory(filePath, repoPath?) / gitReadFileAtCommit(filePath, commit, repoPath?) / gitRestoreFile(filePath, commit?, repoPath?).
//   commit defaults to 'HEAD' in gitRestoreFile (restore the committed version).
```

## Implementation Blueprint

### Data models and structure

One new exported result type (the history entry). The other two functions return primitives (`string`, `void`). No input interfaces (the contract signatures use primitive params, not input objects — do not introduce `GitFileHistoryInput` etc.).

```typescript
// === CANONICAL — add to src/tools/git-mcp.ts (place with the other RESULT INTERFACES, ~after GitCommitResult) ===

/**
 * A single file-history entry: a commit that touched a given file path.
 *
 * @remarks
 * Returned by {@link gitFileHistory}. Entries are NEWEST-FIRST (matching
 * `git log` default ordering). `commit` is the full commit hash; `date` is the
 * ISO-ish date string reported by git for the commit.
 */
interface GitFileHistoryEntry {
  /** Full commit SHA that touched the file */
  commit: string;
  /** Commit date as reported by git (author date, ISO-ish) */
  date: string;
}
```

### Implementation Patterns & Key Details

```typescript
// === IMPORT — add after the groundswell import (L30) in src/tools/git-mcp.ts ===
import { atomicWrite } from '../core/session-utils.js';


// === FUNCTION BODIES — add with the other tool executors (e.g. after gitCommit, before the GitMCP class) ===

// CRITICAL PATTERN: these THROW on failure (NOT {success,error}). validateRepositoryPath throws → propagates.
// git op throws → propagates. atomicWrite throws → propagates. S2 wraps in try/catch.

/**
 * List the commit history of a single file path (newest-first).
 *
 * @remarks
 * Wraps simple-git's `git.log({ file })`. Returns one entry per commit that touched
 * `filePath`, newest commit first. A file with no commit history returns an empty
 * array (NOT an error) — git itself returns no rows for such a path.
 *
 * Generic over any file path — not `tasks.json`-specific. Used by the smart-recovery
 * routine (P5.M2.T1.S2) to locate the last valid committed version of `tasks.json`
 * after an agent corrupts it (PRD §5.1).
 *
 * @param filePath - Repository-relative path of the file to inspect.
 * @param repoPath - Path to the git repository (optional, defaults to cwd).
 * @returns Array of `{ commit, date }` entries, newest-first. Empty if the file has no history.
 * @throws {Error} If `repoPath` is not a git repository, or if `git log` fails.
 *
 * @example
 * ```ts
 * const history = await gitFileHistory('tasks.json', '/path/to/repo');
 * // [{ commit: 'abc123…', date: '2024-06-21…' }, { commit: 'def456…', date: '2024-06-20…' }]
 * ```
 */
async function gitFileHistory(
  filePath: string,
  repoPath?: string
): Promise<GitFileHistoryEntry[]> {
  // PATTERN: validate then operate (same as gitStatus/gitDiff/...)
  const safePath = await validateRepositoryPath(repoPath);
  const git = simpleGit(safePath);

  // CRITICAL: .log({ file }) is NEWEST-FIRST; no-history file ⇒ { all: [], total: 0, latest: null } (no throw).
  // GOTCHA: a thrown error here (bad repo, git failure) propagates — do NOT catch-and-wrap into {success,error}.
  const logResult = await git.log({ file: filePath });

  return logResult.all.map(entry => ({
    commit: entry.hash,
    date: entry.date,
  }));
}

/**
 * Read the content of a file at a specific commit (blob fetch).
 *
 * @remarks
 * Runs `git show <commit>:<filePath>` via simple-git `.show(...)`, returning the
 * blob content as a string. `commit` may be a full hash, short hash, or symbolic
 * ref (`HEAD`, `HEAD~1`, …). Invalid revisions / missing paths cause git to error,
 * which is thrown (do NOT swallow).
 *
 * Generic over any file path. The smart-recovery routine uses this to fetch the
 * last valid blob of `tasks.json` before restoring it (PRD §5.1).
 *
 * @param filePath - Repository-relative path of the file.
 * @param commit - Git revision (hash or symbolic ref like `HEAD`) to read at.
 * @param repoPath - Path to the git repository (optional, defaults to cwd).
 * @returns The file's blob content at `commit`, as a string.
 * @throws {Error} If `repoPath` is not a git repository, the revision/path is invalid, or `git show` fails.
 *
 * @example
 * ```ts
 * const content = await gitReadFileAtCommit('tasks.json', 'abc123', '/path/to/repo');
 * const parsed = JSON.parse(content); // last valid version
 * ```
 */
async function gitReadFileAtCommit(
  filePath: string,
  commit: string,
  repoPath?: string
): Promise<string> {
  const safePath = await validateRepositoryPath(repoPath);
  const git = simpleGit(safePath);

  // CRITICAL: git show <commit>:<path> prints the BLOB CONTENT (not a commit diff) because
  // git treats `<tree-ish>:<path>` as a blob reference. .show() returns it as a string.
  // Equivalent fallback (if .show() ever misbehaves): await git.raw(['show', `${commit}:${filePath}`]);
  return git.show(`${commit}:${filePath}`);
}

/**
 * Restore a file to a prior committed version by writing its blob to disk.
 *
 * @remarks
 * Fetches the blob at `commit` (default `HEAD`) via `git show <commit>:<filePath>`,
 * then writes it to `resolve(repoPath, filePath)` using {@link atomicWrite}
 * (temp-file + rename, crash-safe). This restores a prior valid version of the file.
 *
 * Generic over any file path. The smart-recovery routine uses this to restore the
 * last valid `tasks.json` after an agent corrupts it, before re-applying in-flight
 * status changes (PRD §5.1).
 *
 * @param filePath - Repository-relative path of the file to restore.
 * @param commit - Git revision to restore from (optional, defaults to `HEAD`).
 * @param repoPath - Path to the git repository (optional, defaults to cwd).
 * @returns Resolves once the file has been atomically written to disk.
 * @throws {Error} If `repoPath` is not a git repository, the revision/path is invalid, `git show` fails, or the atomic write fails.
 *
 * @example
 * ```ts
 * // Restore the last committed tasks.json after corruption:
 * await gitRestoreFile('tasks.json', 'HEAD', '/path/to/repo');
 * ```
 */
async function gitRestoreFile(
  filePath: string,
  commit: string = 'HEAD',
  repoPath?: string
): Promise<void> {
  const safePath = await validateRepositoryPath(repoPath);
  const git = simpleGit(safePath);

  // 1. fetch the blob at the target commit
  const content = await git.show(`${commit}:${filePath}`);

  // 2. write it to disk atomically (restore the file). resolve() against the repo root so it lands in the repo.
  await atomicWrite(resolve(safePath, filePath), content);
}


// === EXPORTS — append to the existing export block at the bottom of git-mcp.ts ===
// (the existing block is: `export type { ... };` then `export { gitStatusTool, ..., gitStatus, gitDiff, gitAdd, gitCommit };`)
// ADD `GitFileHistoryEntry` to the `export type { ... }` list and the 3 functions to the `export { ... }` list:
export type {
  GitStatusInput,
  GitDiffInput,
  GitAddInput,
  GitCommitInput,
  GitStatusResult,
  GitDiffResult,
  GitAddResult,
  GitCommitResult,
  GitFileHistoryEntry, // <-- ADD
};
export {
  gitStatusTool,
  gitDiffTool,
  gitAddTool,
  gitCommitTool,
  gitStatus,
  gitDiff,
  gitAdd,
  gitCommit,
  gitFileHistory,        // <-- ADD
  gitReadFileAtCommit,   // <-- ADD
  gitRestoreFile,        // <-- ADD
};
```

### Implementation Tasks (ordered by dependencies — strict TDD: RED first)

```yaml
Task 1: STUB the failing tests (RED — before Task 2)
  Step 1a — tests/unit/tools/git-mcp.test.ts: extend mockGitInstance with log + show
    - LOCATE: `const mockGitInstance = { status: vi.fn(), diff: vi.fn(), add: vi.fn(), commit: vi.fn() };` (L~56)
    - CHANGE to: `{ status: vi.fn(), diff: vi.fn(), add: vi.fn(), commit: vi.fn(), log: vi.fn(), show: vi.fn() };`
  Step 1b — tests/unit/tools/git-mcp.test.ts: extend the value import from '../../../src/tools/git-mcp.js'
    - ADD these named bindings to the EXISTING import (do NOT add a second import line):
        gitFileHistory, gitReadFileAtCommit, gitRestoreFile
    - ADD to the EXISTING `type` import (the `type { ... }` in the same import statement):
        GitFileHistoryEntry
    - ADD at the top of the file (with the other node imports): `import { mkdtemp, readFile, rm } from 'node:fs/promises';` and `import { tmpdir } from 'node:os';` (join is already imported from 'node:path').
  Step 1c — tests/unit/tools/git-mcp.test.ts: add the THREE new describe blocks (verbatim from the canonical test blocks below)
    as NEW sibling describes inside the outer `describe('tools/git-mcp', () => { ... })`, at the END (after 'security patterns').
    DO NOT modify any existing assertion or import.
  VERIFY RED: `npm run test:run -- git-mcp` → the new `it` cases FAIL (the functions don't exist yet → import error OR not-a-function). RED step confirmed.

Task 2: IMPLEMENT the functions in src/tools/git-mcp.ts (makes Task 1 GREEN)
  Step 2a — add the atomicWrite import: `import { atomicWrite } from '../core/session-utils.js';` (after the groundswell import, L30).
  Step 2b — add the GitFileHistoryEntry interface (verbatim from "Data models and structure") with the other RESULT INTERFACES (~after GitCommitResult).
  Step 2c — add the three functions (verbatim from "Implementation Patterns & Key Details") after gitCommit, BEFORE the GitMCP class.
      GOTCHA — THROW on failure: do NOT wrap in try/catch-and-return-{success,error}. Let validateRepositoryPath / git ops / atomicWrite throw.
      GOTCHA — gitFileHistory returns [] on no-history (the .log({file}) no-history case) — do NOT throw for that.
      GOTCHA — gitRestoreFile writes to resolve(safePath, filePath), and commit defaults to 'HEAD'.
  Step 2d — extend the export block: add `GitFileHistoryEntry` to `export type { ... }` and the 3 functions to `export { ... }`.
  DO NOT touch: the GitMCP class, tool schemas, registerToolExecutor calls, validateRepositoryPath, or the existing four functions.

Task 3: VERIFY (validation gates — run after Task 2)
  - RUN: `npm run validate` (lint + prettier --check + tsc --noEmit) — expect zero errors.
      If prettier --check fails, run `npm run format` (writes) then `npm run validate`.
  - RUN: `npm run test:run` (vitest run) — expect all green incl. the new describe blocks + every existing assertion.
  - SCOPE-VERIFY: `git diff --stat` must show ONLY `src/tools/git-mcp.ts` + `tests/unit/tools/git-mcp.test.ts`.
      `git diff src/core/ docs/ src/agents/ src/utils/git-commit.ts` must be EMPTY.
  - THROW-VERIFY: `grep -n "success: false" src/tools/git-mcp.ts` → the ONLY matches must be inside gitStatus/gitDiff/gitAdd/gitCommit
      (the existing four). The three new functions must have ZERO `success: false` / ZERO `{ success:` patterns (they throw, not return-error).
  - CONTENT-VERIFY: `grep -n "gitFileHistory\|gitReadFileAtCommit\|gitRestoreFile\|atomicWrite" src/tools/git-mcp.ts`
      → the three fns + the atomicWrite import + the exports are all present.
```

### Canonical test blocks (add verbatim to tests/unit/tools/git-mcp.test.ts)

```typescript
// === CANONICAL — add as NEW sibling describes inside the outer describe('tools/git-mcp', ...), at the END ===

  describe('gitFileHistory', () => {
    it('should return mapped history entries (newest-first)', async () => {
      // SETUP
      mockGitInstance.log.mockResolvedValue({
        all: [
          { hash: 'aaa111', date: '2024-06-21T10:00:00', message: 'latest' },
          { hash: 'bbb222', date: '2024-06-20T10:00:00', message: 'older' },
        ],
        total: 2,
        latest: { hash: 'aaa111', date: '2024-06-21T10:00:00', message: 'latest' },
      } as never);

      // EXECUTE
      const result = await gitFileHistory('tasks.json', './repo');

      // VERIFY — newest-first, hash→commit, date→date
      expect(result).toEqual([
        { commit: 'aaa111', date: '2024-06-21T10:00:00' },
        { commit: 'bbb222', date: '2024-06-20T10:00:00' },
      ]);
      expect(mockGitInstance.log).toHaveBeenCalledWith({ file: 'tasks.json' });
    });

    it('should return an empty array when the file has no history', async () => {
      // SETUP — no-history file: .log({file}) returns empty all (NO error)
      mockGitInstance.log.mockResolvedValue({
        all: [],
        total: 0,
        latest: null,
      } as never);

      // EXECUTE
      const result = await gitFileHistory('never-committed.txt');

      // VERIFY — [] (NOT a throw)
      expect(result).toEqual([]);
    });

    it('should default repoPath to process.cwd()', async () => {
      // SETUP
      mockGitInstance.log.mockResolvedValue({ all: [], total: 0, latest: null } as never);

      // EXECUTE
      await gitFileHistory('tasks.json');

      // VERIFY — simpleGit was called (path validation passed), log was called with the file
      expect(mockSimpleGit).toHaveBeenCalled();
      expect(mockGitInstance.log).toHaveBeenCalledWith({ file: 'tasks.json' });
    });

    it('should throw when the repository path is invalid', async () => {
      // SETUP
      mockExistsSync.mockReturnValue(false);

      // EXECUTE + VERIFY — validateRepositoryPath throws → propagates (NOT a {success:false} return)
      await expect(gitFileHistory('tasks.json', '/nonexistent')).rejects.toThrow(
        /Repository path not found/
      );
    });

    it('should throw when git.log fails', async () => {
      // SETUP
      mockGitInstance.log.mockRejectedValue(new Error('git log failed'));

      // EXECUTE + VERIFY — git error propagates as a throw
      await expect(gitFileHistory('tasks.json')).rejects.toThrow('git log failed');
    });
  });

  describe('gitReadFileAtCommit', () => {
    it('should return the blob content at the given commit', async () => {
      // SETUP — git show <commit>:<path> returns the BLOB CONTENT
      mockGitInstance.show.mockResolvedValue('{"version":"prior"}');

      // EXECUTE
      const content = await gitReadFileAtCommit('tasks.json', 'abc123', './repo');

      // VERIFY
      expect(content).toBe('{"version":"prior"}');
      expect(mockGitInstance.show).toHaveBeenCalledWith('abc123:tasks.json');
    });

    it('should default repoPath to process.cwd()', async () => {
      // SETUP
      mockGitInstance.show.mockResolvedValue('content');

      // EXECUTE
      await gitReadFileAtCommit('tasks.json', 'HEAD');

      // VERIFY
      expect(mockSimpleGit).toHaveBeenCalled();
      expect(mockGitInstance.show).toHaveBeenCalledWith('HEAD:tasks.json');
    });

    it('should throw when the repository path is invalid', async () => {
      // SETUP
      mockExistsSync.mockReturnValue(false);

      // EXECUTE + VERIFY
      await expect(
        gitReadFileAtCommit('tasks.json', 'HEAD', '/nonexistent')
      ).rejects.toThrow(/Repository path not found/);
    });

    it('should throw when git.show fails (bad revision/path)', async () => {
      // SETUP
      mockGitInstance.show.mockRejectedValue(new Error('fatal: path does not exist'));

      // EXECUTE + VERIFY
      await expect(gitReadFileAtCommit('tasks.json', 'deadbeef')).rejects.toThrow(
        'fatal: path does not exist'
      );
    });
  });

  describe('gitRestoreFile', () => {
    it('should write the blob content to disk via atomicWrite (real tmpdir)', async () => {
      // SETUP — real tmpdir so atomicWrite (node:fs/promises, NOT mocked) writes for real.
      // existsSync is mocked (returns true) so validateRepositoryPath passes for the tmpdir.
      const dir = await mkdtemp(join(tmpdir(), 'git-restore-'));
      mockGitInstance.show.mockResolvedValue('{"version":"restored"}');

      try {
        // EXECUTE — restore the HEAD version of tasks.json into the tmpdir
        await gitRestoreFile('tasks.json', 'HEAD', dir);

        // VERIFY — the prior content is now on disk
        const content = await readFile(join(dir, 'tasks.json'), 'utf-8');
        expect(content).toBe('{"version":"restored"}');
        expect(mockGitInstance.show).toHaveBeenCalledWith('HEAD:tasks.json');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('should default commit to HEAD when omitted', async () => {
      // SETUP
      mockGitInstance.show.mockResolvedValue('content');
      const dir = await mkdtemp(join(tmpdir(), 'git-restore-default-'));
      try {
        // EXECUTE
        await gitRestoreFile('tasks.json', undefined, dir);

        // VERIFY — show called with HEAD:<path> (default commit)
        expect(mockGitInstance.show).toHaveBeenCalledWith('HEAD:tasks.json');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('should throw when the repository path is invalid', async () => {
      // SETUP
      mockExistsSync.mockReturnValue(false);

      // EXECUTE + VERIFY
      await expect(gitRestoreFile('tasks.json', 'HEAD', '/nonexistent')).rejects.toThrow(
        /Repository path not found/
      );
    });

    it('should throw when git.show fails', async () => {
      // SETUP
      mockGitInstance.show.mockRejectedValue(new Error('fatal: bad revision'));

      // EXECUTE + VERIFY
      await expect(gitRestoreFile('tasks.json', 'deadbeef')).rejects.toThrow(
        'fatal: bad revision'
      );
    });
  });
// === END CANONICAL TEST BLOCKS ===
```

### Integration Points

```yaml
SOURCE (the change):
  - edit: src/tools/git-mcp.ts
      + import { atomicWrite } from '../core/session-utils.js'
      + interface GitFileHistoryEntry { commit: string; date: string }
      + async function gitFileHistory(filePath, repoPath?): Promise<GitFileHistoryEntry[]>
      + async function gitReadFileAtCommit(filePath, commit, repoPath?): Promise<string>
      + async function gitRestoreFile(filePath, commit = 'HEAD', repoPath?): Promise<void>
      + export GitFileHistoryEntry type + the three functions

TESTS (the validation):
  - edit: tests/unit/tools/git-mcp.test.ts
      + log: vi.fn(), show: vi.fn() on mockGitInstance
      + import bindings: gitFileHistory, gitReadFileAtCommit, gitRestoreFile + type GitFileHistoryEntry
      + import { mkdtemp, readFile, rm } from 'node:fs/promises'; import { tmpdir } from 'node:os';
      + 3 new describe blocks (history / read-at-commit / restore)

NOT TOUCHED (scope guardrails):
  - src/core/state-validator.ts          # S2 territory (smart-recovery routine)
  - src/core/task-orchestrator.ts        # S3 territory (orchestrator wiring)
  - src/core/session-utils.ts            # atomicWrite is IMPORTED from here (already exists); no change
  - src/utils/git-commit.ts              # PROTECTED_FILES rules unchanged (per delta_impact.md)
  - the GitMCP class / tool schemas / registerToolExecutor in git-mcp.ts  # internal utilities, NOT MCP tools
  - validateRepositoryPath in git-mcp.ts # reused as-is (module-private helper)
  - docs/ARCHITECTURE.md, docs/WORKFLOWS.md, README.md  # Mode B narrative deferred to S2 / P5.M3
  - src/agents/prompts.ts + tests/unit/agents/prompts/*  # P5.M1.T3.S2 parallel sibling (zero overlap)

PRODUCES (the contract S2 consumes):
  - gitFileHistory(filePath, repoPath?) : Promise<{commit, date}[]>   # walk a file's commit history (newest-first)
  - gitReadFileAtCommit(filePath, commit, repoPath?) : Promise<string> # fetch a prior blob
  - gitRestoreFile(filePath, commit = 'HEAD', repoPath?) : Promise<void> # restore a prior version to disk
  All THROW on failure (S2 will try/catch). Generic over any filePath (S2 calls with 'tasks.json').

CONSUMES:
  - simple-git .log({ file }) / .show(`<commit>:<path>`)   # the primitives these wrap
  - src/core/session-utils.ts atomicWrite                  # the crash-safe write for gitRestoreFile
  - git-mcp.ts module-private validateRepositoryPath       # reused path validation
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After Task 2 (functions) + Task 1 (tests):
npm run validate
# = npm run lint && npm run format:check && npm run typecheck
#   lint      = eslint . --ext .ts
#   format:check = prettier --check "**/*.{ts,js,json,md,yml,yaml}"
#   typecheck = tsc --noEmit -p tsconfig.build.json   (NOTE: excludes tests/ — only src/ is typechecked)
# Expected: zero errors. Three small additive functions + additive test blocks are type-neutral.
# If prettier --check fails, run:
npm run format        # WRITES the prettier-compliant form
npm run validate      # re-check; expect zero errors.
# Common failure: forgetting the `.js` suffix on the atomicWrite import (`'../core/session-utils.js'`).
```

### Level 2: Unit Tests (Component Validation)

```bash
# RED step (after Task 1, before Task 2) — MUST fail first (TDD):
npm run test:run -- git-mcp
# Expected: the new `it` cases FAIL (the functions don't exist yet → import error or "not a function"). Existing assertions pass.

# GREEN step (after Task 2):
npm run test:run -- git-mcp
# Expected: all green incl. the 13 new `it` cases (5 history + 4 read-at-commit + 4 restore) + every existing assertion.

# Full suite (confirm no regression elsewhere):
npm run test:run
# Expected: all green.
```

### Level 3: Integration Testing (System Validation)

```bash
# Confirm the consumers (none today — S2 is Planned) will import cleanly: tsc on src/ covers the new exports.
npm run typecheck
# Expected: zero errors (the three fns + GitFileHistoryEntry are well-typed; atomicWrite import resolves).

# Scope-guard regression check — confirm we did NOT over-reach:
git diff --stat
# Expected: ONLY src/tools/git-mcp.ts + tests/unit/tools/git-mcp.test.ts.

git diff src/core/ docs/ src/agents/ src/utils/git-commit.ts
# Expected: EMPTY (state-validator, session-utils, orchestrator, docs, prompts, protected-file rules untouched).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# THROW-on-failure invariant — the three new fns must THROW, not return {success,error}:
grep -n "success: false\|{ success" src/tools/git-mcp.ts
# Expected: matches ONLY inside gitStatus/gitDiff/gitAdd/gitCommit (the existing four). The three new fns must have NONE.

# Content-presence check — the three fns + the atomicWrite import + exports all landed:
grep -n "gitFileHistory\|gitReadFileAtCommit\|gitRestoreFile\|atomicWrite\|GitFileHistoryEntry" src/tools/git-mcp.ts
# Expected: ≥10 matches (import line, interface, 3 fn defs, 3 export refs, type export).

# Call-args check — .log({ file }) and .show(`<commit>:<path>`) are used correctly:
grep -n "git.log({ file\|git.show(\`" src/tools/git-mcp.ts
# Expected: 2 matches (one log in gitFileHistory, one show each in gitReadFileAtCommit + gitRestoreFile = 3 show; total ≥2).

# MCP-tool-leak check — these are internal utilities, NOT new MCP tools:
grep -n "gitFileHistoryTool\|gitReadFileAtCommitTool\|gitRestoreFileTool" src/tools/git-mcp.ts
# Expected: NO matches (do not add tool schemas). The GitMCP.tools array still lists exactly 4 tools.

# No-docs-leak check — no external doc file was touched (Mode A = JSDoc only):
test -z "$(git diff --name-only docs/)" && echo "docs/ untouched: OK" || echo "FAIL: docs/ was modified"
# Expected: "docs/ untouched: OK".
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` passes (eslint + prettier --check + tsc --noEmit, zero errors).
- [ ] `npm run test:run` passes (all green; the 13 new `it` cases + every existing assertion in `git-mcp.test.ts`).
- [ ] RED step observed before GREEN (the new assertions failed before Task 2 — TDD).

### Feature Validation

- [ ] `gitFileHistory(filePath, repoPath?)` returns `{ commit, date }[]` mapped from `git.log({ file }).all` (newest-first), returns `[]` on no-history, throws on git error.
- [ ] `gitReadFileAtCommit(filePath, commit, repoPath?)` returns the blob string from `git show <commit>:<path>`, throws on git error.
- [ ] `gitRestoreFile(filePath, commit = 'HEAD', repoPath?)` writes the blob to `resolve(safePath, filePath)` via `atomicWrite`, throws on git error or write failure.
- [ ] All three THROW on failure (verify `grep "success: false"` shows ZERO new matches in the three functions).
- [ ] All three reuse `validateRepositoryPath` and accept an optional trailing `repoPath`.
- [ ] The functions are generic over any `filePath` (not `tasks.json`-hardcoded).

### Code Quality Validation

- [ ] The `GitMCP` class, its `tools` array (still exactly 4 tools), all tool schemas, and `registerToolExecutor` calls are unchanged.
- [ ] `validateRepositoryPath` is reused (not duplicated).
- [ ] Full JSDoc on the three functions + `GitFileHistoryEntry` (Mode A docs).
- [ ] The `atomicWrite` import uses the `.js` suffix (`'../core/session-utils.js'`).
- [ ] Existing assertions in `git-mcp.test.ts` still pass (additive mock + import, not behavior-changing).
- [ ] `git diff --stat` shows ONLY `src/tools/git-mcp.ts` + `tests/unit/tools/git-mcp.test.ts`.

### Documentation & Deployment

- [ ] The new functions are self-documenting (full JSDoc with @remarks/@param/@returns/@throws/@example).
- [ ] No new environment variables (n/a — pure library functions).
- [ ] No external doc file touched (git diff on `docs/` = EMPTY; Mode A = JSDoc, narrative deferred to S2).

---

## Anti-Patterns to Avoid

- ❌ Don't wrap the three new functions in `try/catch` that returns `{ success: false, error }` — they MUST THROW on failure (the contract signatures return plain typed data + CONTRACT #1 "throw on non-zero exit"). S2's smart-recovery relies on try/catch semantics. Auto-copying the existing four functions' error pattern breaks S2.
- ❌ Don't make `gitFileHistory` throw on a no-history file — `.log({ file })` returns `{ all: [], total: 0 }` (no error); return `[]`. Only throw on real git errors.
- ❌ Don't confuse `git show <commit>:<path>` (returns the BLOB CONTENT) with `git show <commit>` (returns commit + diff). The `<tree-ish>:<path>` syntax is the blob-fetch primitive; verify in the test that the returned string equals the stubbed content.
- ❌ Don't add MCP tool schemas / register these as MCP tools / touch the `GitMCP` class — they are INTERNAL utilities (exported functions) S2 imports directly.
- ❌ Don't write to `resolve(process.cwd(), filePath)` in `gitRestoreFile` — write to `resolve(safePath, filePath)` (the validated repo root) so the file lands in the repo regardless of cwd.
- ❌ Don't use a "real ephemeral git repo" test in the SAME `git-mcp.test.ts` file — the module-level `vi.mock('simple-git', ...)` intercepts all simple-git usage there. Use the STUBBED approach (add `log`/`show` to `mockGitInstance`), which the contract explicitly allows. (gitRestoreFile's happy-path still writes to a REAL tmpdir to exercise atomicWrite — that's the real `node:fs/promises`, which is NOT mocked.)
- ❌ Don't change the function names, param order, or THROW-on-failure semantics — S2 (`P5.M2.T1.S2`, the consumer) imports against exactly these signatures. The optional trailing `repoPath` is the ONE sanctioned extension.
- ❌ Don't duplicate `validateRepositoryPath` — reuse the module-private helper.
- ❌ Don't edit `src/core/state-validator.ts`, `src/core/task-orchestrator.ts`, `src/utils/git-commit.ts`, or any `docs/*` file — those are S2/S3/P5.M3 territory. This subtask is ONLY the primitives + their tests.
- ❌ Don't edit `src/core/session-utils.ts` — `atomicWrite` is imported FROM it (already exists); no change there.
- ❌ Don't write the functions before the failing tests (breaks implicit-TDD; `implementation_notes.md` §7).
- ❌ Don't modify any existing assertion or import in `git-mcp.test.ts` — only ADD (extend `mockGitInstance`, extend the existing import statement, add new describe blocks).

---

## Success Metrics

**Confidence Score: 9/10** — This is a small, well-bounded subtask: three short additive async functions (~5–10 lines of logic each) in an existing module plus a stubbed test extension that mirrors the existing ~400 lines of mock-based tests in the same file. Every reference resolves to a real file/line in the tree today; the simple-git API is verified against the installed typings (`.log({ file })` → `LogResult.all` newest-first with `hash`/`date`; `.show('<commit>:<path>')` → blob content string); the three function bodies are provided verbatim (with the THROW-on-failure pattern explicitly called out as a deliberate difference from the existing four functions); the atomicWrite import path is confirmed (no circular dependency — session-utils doesn't import tools); and the test additions are provided verbatim with the exact mock mutations (`mockGitInstance` gains `log`/`show`) and the real-tmpdir write for `gitRestoreFile`. `npm run validate` + `npm run test:run` are the only gates (coverage is NOT a gate — implementation_notes.md §10). Residual risk is purely mechanical: (a) accidentally copying the `{ success, error }` pattern instead of throwing (guarded by the THROW-VERIFY grep in Level 4 + repeated anti-patterns), (b) the no-history-returns-`[]` vs throw decision (guarded by an explicit test case + the Known Gotchas), and (c) scope creep into S2/S3 territory (guarded by the scope-guard `git diff` checks in Level 3/4 + the anti-patterns). Parallel safety is clean: P5.M1.T3.S2 edits `src/agents/prompts.ts` + `tests/unit/agents/prompts/*` — disjoint module and disjoint test directory; zero overlap. The optional `repoPath` param is the single sanctioned signature extension and is documented as the contract S2 imports against. One-pass success is highly likely.
