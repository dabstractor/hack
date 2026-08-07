# PRP — P1.M1.T2.S1: `getRecentCommitMessages(count)` in `src/tools/git-mcp.ts`

> PRD §5.1 commit-message **style layer** helper. Adds one small exported async function that fetches
> the last `count` commit messages (newest-first) from a repo, mirroring the existing `gitFileHistory`
> function. It is the **style-examples fetcher**: P1.M1.T4.S1 (`generateCommitMessage` auto-mode) calls
> `getRecentCommitMessages(examplesCount)` to inject recent commit messages as style examples for the
> `stagecoach` agent. Self-contained — `src/tools/git-mcp.ts` + its unit test. No other dependencies.

---

## Goal

**Feature Goal**: Add `getRecentCommitMessages(count: number, repoPath?: string): Promise<string[]>`
to `src/tools/git-mcp.ts`, returning the full commit message (subject + body) of each of the last
`count` commits, newest-first. Mirror the `gitFileHistory` pattern exactly (`validateRepositoryPath` →
`simpleGit(safePath)` → `git.log({...})` → `logResult.all.map(...)`), using `{ maxEntries: count }` and
mapping `entry.message`. Short-circuit `count === 0` → `[]` before any git/validate call. Export it via
the existing `export { … }` block. Add JSDoc + a unit-test describe block.

**Deliverable**:
1. **`src/tools/git-mcp.ts`** — (a) the new `async function getRecentCommitMessages` (declared without
   inline `export`, mirroring siblings) + its JSDoc, placed near `gitFileHistory` (~L539); (b) add
   `getRecentCommitMessages,` to the `export { … }` block at L830.
2. **`tests/unit/tools/git-mcp.test.ts`** — (a) add `getRecentCommitMessages` to the import list
   (~L47); (b) append a `describe('getRecentCommitMessages')` block mirroring the `gitFileHistory`
   describe (L876), covering: happy-path (messages newest-first + `log` called with `{ maxEntries }`),
   `count === 0` short-circuit (returns `[]` without calling `simpleGit`), fewer-than-count (returns
   all available, no error), invalid-repo-path (validateRepositoryPath throws), and log-failure
   propagation.

**Success Definition**:
- `getRecentCommitMessages(2, repoPath)` returns `['<msg1>', '<msg2>']` (newest-first, full messages)
  and calls `simpleGit(safePath).log({ maxEntries: 2 })`.
- `getRecentCommitMessages(0, anything)` returns `[]` and does NOT call `simpleGit`/`validateRepositoryPath`.
- A repo with fewer than `count` commits returns all available (no error — `git.log` just returns fewer).
- An invalid `repoPath` throws via `validateRepositoryPath` (`Repository path not found` / `Not a git repository`).
- A `git.log` failure propagates as a thrown `Error`.
- `npx vitest run tests/unit/tools/git-mcp.test.ts` GREEN (new describe + all existing); `npm run
  typecheck && npm run lint && npm run format:check` clean.
- **No other source files modified.** No docs (the function is an internal helper consumed by T4).

---

## Why

- **Provides the style-examples fetcher the §5.1 style layer needs.** PRD §5.1 `PRP_COMMIT_STYLE=auto`
  (default) requires the commit-message generation request to include the last
  `PRP_COMMIT_STYLE_EXAMPLES` (default 5) commit messages as style examples. T4
  (`generateCommitMessage` wiring) needs a clean helper to fetch them; this is it.
- **`count === 0` short-circuit enables the disable-learning knob.** `PRP_COMMIT_STYLE_EXAMPLES=0`
  disables style learning (§5.1). T4 passes the resolved count straight through; this helper's
  `count === 0 → []` guard makes that a pure no-op call site (no repo access needed) — clean and safe.
- **Mirrors a proven pattern.** `gitFileHistory` (L539) already does `validateRepositoryPath` →
  `simpleGit` → `git.log` → `.all.map(...)`. The new function is the same shape with `{ maxEntries }`
  + `entry.message`. Low risk, consistent with the file's conventions.
- **Scope discipline.** T2.S1 = the helper + its unit test. T1.S2 (parallel) wires the `.hack` schema
  (different file). T3 builds the dynamic prompt. T4 wires `generateCommitMessage` to call this helper.
  No overlap.

---

## What

### User-visible behavior
None directly (an internal helper). Indirectly, once T4 lands: when `PRP_COMMIT_STYLE=auto`, the
commit-message generator receives recent commit messages as style examples, producing messages that
match the project's existing style.

### Technical requirements (exact contract)

**File 1 — `src/tools/git-mcp.ts`** (2 edits):

**(a) The function + JSDoc** — place near `gitFileHistory` (immediately after it, ~L555, before
`gitReadFileAtCommit`'s JSDoc). Declare WITHOUT inline `export` (the file re-exports via the block at
L830 — mirror every sibling):
```ts
/**
 * Fetch the most recent commit messages from a repository (PRD §5.1 commit-style layer).
 *
 * @remarks
 * Returns the FULL commit message (subject + body) of each of the last `count` commits, newest-first
 * (matching `git log` default ordering). Used by the commit-message style layer to inject recent
 * history as style examples when `PRP_COMMIT_STYLE=auto` (§5.1): the caller passes the resolved
 * `PRP_COMMIT_STYLE_EXAMPLES` count.
 *
 * - `count === 0` short-circuits to `[]` BEFORE any filesystem/git access — so a `0` count (which
 *   disables style learning per §5.1) is a pure no-op, even outside a repository.
 * - A repository with fewer than `count` commits returns all available entries (no error — `git.log`
 *   simply returns fewer).
 *
 * Mirrors {@link gitFileHistory}'s `validateRepositoryPath` → `simpleGit` → `git.log` pattern.
 *
 * @param count - How many recent commit messages to fetch. `0` → `[]` (no git call).
 * @param repoPath - Path to the git repository (optional, defaults to cwd).
 * @returns Array of full commit-message strings (subject + body), newest-first. Empty if `count === 0`
 *          or the repository has no commits.
 * @throws {Error} If `repoPath` is not a git repository (via {@link validateRepositoryPath}), or if
 *         `git.log` fails.
 *
 * @example
 * ```ts
 * const msgs = await getRecentCommitMessages(5, '/path/to/repo');
 * // ['feat: add thing\n\nbody', 'fix: other', …]  (newest-first)
 * ```
 */
async function getRecentCommitMessages(
  count: number,
  repoPath?: string
): Promise<string[]> {
  if (count === 0) return []; // short-circuit BEFORE validate (no git call) — PRP_COMMIT_STYLE_EXAMPLES=0
  const safePath = await validateRepositoryPath(repoPath);
  const git = simpleGit(safePath);
  const logResult = await git.log({ maxEntries: count });
  return logResult.all.map(entry => entry.message); // newest-first; full message (subject + body)
}
```

**(b) The export block** (L830) — add `getRecentCommitMessages,` (e.g. immediately after `gitFileHistory,`):
```ts
export {
  // … existing exports …
  gitFileHistory,
  getRecentCommitMessages,   // ← NEW
  gitReadFileAtCommit,
  // … rest unchanged …
};
```

**File 2 — `tests/unit/tools/git-mcp.test.ts`** (2 edits):
- Add `getRecentCommitMessages` to the import from `'../../../src/tools/git-mcp.js'` (~L47, alongside
  `gitFileHistory`).
- Append a `describe('getRecentCommitMessages', …)` block (mirror the `gitFileHistory` describe at
  L876) with the 5 cases under "Implementation Patterns" below.

### Success Criteria
- [ ] `getRecentCommitMessages` declared in `src/tools/git-mcp.ts` (no inline `export`) with the JSDoc above.
- [ ] `getRecentCommitMessages` added to the `export { … }` block (L830).
- [ ] `count === 0` returns `[]` and does NOT call `simpleGit` (verified by the unit test).
- [ ] Happy path: returns `entry.message` per commit, newest-first; `log` called with `{ maxEntries: count }`.
- [ ] Fewer-than-count commits → returns all available (no error).
- [ ] Invalid `repoPath` → throws via `validateRepositoryPath`; `git.log` failure → propagates.
- [ ] `npx vitest run tests/unit/tools/git-mcp.test.ts` GREEN; `npm run typecheck && npm run lint && npm run format:check` clean.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the exact
mirror template (`gitFileHistory` with line numbers), the verbatim new function + JSDoc, the verified
simple-git `log({ maxEntries })` contract (newest-first; fewer-than-count returns all; `entry.message`
is full subject+body), the export-block convention (no inline `export`), the test-file's existing
simple-git mock (`simpleGit: vi.fn(() => mockGitInstance)` with `mockGitInstance.log` a `vi.fn()`),
the exact test cases mirroring the `gitFileHistory` describe, and the executable validation commands.

### Documentation & References

```yaml
# MUST READ — the architecture note specifying this helper
- docfile: plan/012_7dd502f7feb9/architecture/implementation-status.md
  section: "F1.D — Recent-commits helper (src/tools/git-mcp.ts)"
  why: Specifies the signature, the gitFileHistory pattern to mirror, the count===0 short-circuit,
        maxEntries usage, entry.message return, and the export-block placement.

# MUST READ — the function + test design (authored with this PRP)
- docfile: plan/012_7dd502f7feb9/P1M1T2S1/research/recent-commits-helper.md
  section: "2. The exact mirror template" and "4. The simple-git log({maxEntries}) contract" and "5. Test pattern"
  why: The verbatim new function, the simple-git log contract (newest-first; fewer-than-count = no
        error; entry.message = full subject+body), the export convention (no inline export), and the
        exact 5 test cases mirroring gitFileHistory. READ BEFORE IMPLEMENTING.

# PATTERN FILE 1 — the source file (the mirror template + insertion sites)
- file: src/tools/git-mcp.ts
  why: gitFileHistory (L539 — the EXACT template: validateRepositoryPath → simpleGit → git.log → .all.map).
        validateRepositoryPath (L202 — reused unchanged). The export { … } block (L830 — add the new name).
        simpleGit imported from 'simple-git' (L24); GitError (L29) for error typing (not needed here).
  pattern: "async function gitFileHistory(filePath, repoPath?) { const safePath = await validateRepositoryPath(repoPath); const git = simpleGit(safePath); const logResult = await git.log({ file: filePath }); return logResult.all.map(entry => ({…})); }"
  gotcha: Do NOT use inline `export async function` — the file declares functions plain and re-exports
        them via the `export { … }` block at L830. Follow the convention.

# PATTERN FILE 2 — the test file (the mock + the describe to mirror)
- file: tests/unit/tools/git-mcp.test.ts
  why: Mocks simple-git at L28 (`simpleGit: vi.fn(() => mockGitInstance)`); mockGitInstance.log is a
        vi.fn() (used by the gitFileHistory test at L879). The gitFileHistory describe (L876) is the
        template for the new describe. mockExistsSync / mockRealpathSync / mockSimpleGit casts at L62-66.
        The import list (~L42-60) — add getRecentCommitMessages alongside gitFileHistory.
  pattern: "mockGitInstance.log.mockResolvedValue({ all: [{ hash, date, message }], total, latest } as never); … expect(mockGitInstance.log).toHaveBeenCalledWith({ maxEntries: 2 });"
  gotcha: mock the LogResult with `as never` (the file's existing pattern) — simple-git's LogResult type
        is strict; the cast matches the gitFileHistory test. existsSync defaults to true; the
        invalid-path test overrides mockExistsSync.mockReturnValue(false).

# READ-ONLY — the helper reused unchanged
- file: src/tools/git-mcp.ts   # validateRepositoryPath (L202)
  why: resolve(path ?? cwd) → existsSync check → .git check → realpathSync. Throws plain Error on bad
        path. Reused as-is — do NOT modify.

# VERIFIED FACTS
- fact: "gitFileHistory (L539) is the exact mirror: validateRepositoryPath → simpleGit(safePath) → git.log({file}) → logResult.all.map(entry => ({commit: entry.hash, date: entry.date}))."
- fact: "simple-git git.log({ maxEntries: count }) returns { all: LogEntry[], total, latest }; .all is newest-first; fewer-than-count commits returns all available (NO error)."
- fact: "LogEntry.message is the FULL commit message (subject + body) — what the style layer wants (architecture §F1.D)."
- fact: "git-mcp.ts does NOT use inline `export` on functions — they're declared `async function name` and re-exported via the `export { … }` block at L830. Follow this convention."
- fact: "tests/unit/tools/git-mcp.test.ts mocks simple-git as `simpleGit: vi.fn(() => mockGitInstance)` (L28); mockGitInstance.log is a vi.fn() (L879 uses it). No new mock needed — reuse mockGitInstance.log."
- fact: "vitest 100% coverage on src: the new function adds 2 branches (count===0 true/false) — both covered by the count=0 test + every other test."
```

### Current Codebase tree (relevant slice)

```bash
src/tools/git-mcp.ts                 # EDIT — +getRecentCommitMessages (near L539) + export-block entry (L830)
tests/unit/tools/git-mcp.test.ts     # EDIT — +import + describe('getRecentCommitMessages') block
```

### Desired Codebase tree with files to be edited

```bash
src/tools/git-mcp.ts                 # MODIFIED (1 function + JSDoc + 1 export-block line)
tests/unit/tools/git-mcp.test.ts     # MODIFIED (1 import + 1 describe block)
# No other files. No docs (internal helper). No new files.
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL — do NOT declare the function with inline `export` (i.e. NOT `export async function`).
//   git-mcp.ts declares functions plain (`async function name`) and re-exports them via the
//   `export { … }` block at L830. Every sibling (gitFileHistory, gitReadFileAtCommit, …) follows this.
//   The contract's "export async function" wording describes that it IS exported, not the syntax.

// CRITICAL — put the `if (count === 0) return [];` guard FIRST, BEFORE validateRepositoryPath. This
//   makes getRecentCommitMessages(0) a pure no-op (no repo access) — which is exactly what
//   PRP_COMMIT_STYLE_EXAMPLES=0 (disable style learning, §5.1) needs at the T4 call site.

// CRITICAL — return entry.message (the FULL subject + body), NOT entry.hash or a split subject. The
//   architecture note §F1.D: "for style examples, the full message is most useful." The caller (T4)
//   splits to subject if it wants.

// CRITICAL — git.log({ maxEntries: count }) returns newest-first (git log default), same as
//   gitFileHistory's .all. Do NOT reverse. A repo with fewer than count commits returns all available
//   (no error) — do NOT add a special "fewer than count" branch; .map just yields fewer strings.

// GOTCHA — simple-git's LogResult type is strict; in tests cast the mock value with `as never` (the
//   file's existing pattern at L879-891). Include `total` + `latest` fields to match the shape.

// GOTCHA — mockGitInstance.log already exists as a vi.fn() (the gitFileHistory tests use it). Do NOT
//   add a new mock; reuse mockGitInstance.log.mockResolvedValue(…) / .mockRejectedValue(…).

// GOTCHA — the invalid-repo-path test must override mockExistsSync.mockReturnValue(false) for ITS call
//   (the file default is existsSync → true). Restore in the test or rely on beforeEach clearAllMocks
//   (check the file's beforeEach — mirror the gitFileHistory nonexistent-path test at ~L938).

// GOTCHA — reuse validateRepositoryPath UNCHANGED. Do NOT modify it (it's shared by every git-mcp
//   function; modifying it would ripple across the file's other tests).

// GOTCHA — no logging in the function. gitFileHistory doesn't log; mirror it (pure pass-through).

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check (the JSDoc + test block
//   may need minor formatting).

// GOTCHA — vitest 100% coverage on src: the new function's 2 branches (count===0 true/false) are both
//   covered by the new tests. validateRepositoryPath's branches are already covered by gitFileHistory's
//   tests (shared helper). No coverage gap.
```

---

## Implementation Blueprint

### Data models and structure
None new — the function returns `string[]` (the built-in). It reuses `validateRepositoryPath`'s
`string` return + simple-git's `LogResult`/`LogEntry` types (already imported transitively via
`simpleGit`). No interfaces/constants/classes.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/tools/git-mcp.ts — add the function + JSDoc (near L539)
  - INSERT the `async function getRecentCommitMessages(count, repoPath?)` + its JSDoc immediately
        AFTER gitFileHistory (ends ~L554) and BEFORE gitReadFileAtCommit's JSDoc (~L566). Verbatim
        code from "Technical requirements (a)".
  - The `count === 0` guard is the FIRST line (before validateRepositoryPath).
  - DO NOT: use inline `export`, add logging, modify validateRepositoryPath, or reverse the .all order.
  - EXPECTED: typecheck clean (LogResult.all[i].message is a string; Promise<string[]> holds).

Task 2: EDIT src/tools/git-mcp.ts — add to the export block (L830)
  - ADD `getRecentCommitMessages,` to the `export { … }` block, immediately after `gitFileHistory,`
        (keeps the log-related helpers grouped).
  - DO NOT reorder the existing exports.
  - EXPECTED: the function is now importable from 'src/tools/git-mcp.js'.

Task 3: EDIT tests/unit/tools/git-mcp.test.ts — import + describe block
  - ADD `getRecentCommitMessages` to the import from '../../../src/tools/git-mcp.js' (~L47, alongside
        gitFileHistory).
  - APPEND `describe('getRecentCommitMessages', () => { … })` (mirror the gitFileHistory describe at
        L876) with these 5 cases:
      1. it('returns the full commit messages, newest-first'): mockGitInstance.log.mockResolvedValue(
         { all: [{hash:'a',date:'d1',message:'feat: add thing\n\nbody'},{hash:'b',date:'d2',message:'fix: other'}],
         total:2, latest:{hash:'a',date:'d1',message:'feat: add thing\n\nbody'} } as never);
         const result = await getRecentCommitMessages(2, './repo');
         expect(result).toEqual(['feat: add thing\n\nbody','fix: other']);
         expect(mockGitInstance.log).toHaveBeenCalledWith({ maxEntries: 2 }).
      2. it('returns [] for count === 0 WITHOUT calling simpleGit (no git call)'): mockSimpleGit.mockClear();
         const result = await getRecentCommitMessages(0, './repo');
         expect(result).toEqual([]); expect(mockSimpleGit).not.toHaveBeenCalled().
      3. it('returns all available when the repo has fewer than count commits (no error)':
         mockGitInstance.log.mockResolvedValue({ all:[{hash:'only',date:'d',message:'solo commit'}], total:1,
         latest:{hash:'only',date:'d',message:'solo commit'} } as never);
         const result = await getRecentCommitMessages(5, './repo'); expect(result).toEqual(['solo commit']).
      4. it('throws when the repo path is invalid (validateRepositoryPath)'): mockExistsSync.mockReturnValue(false);
         await expect(getRecentCommitMessages(3, '/nonexistent')).rejects.toThrow(/Repository path not found/).
         (Mirror the gitFileHistory nonexistent-path test ~L938; restore existsSync after if the file's
         beforeEach doesn't clearAllMocks the node:fs mock — confirm against the file's setup.)
      5. it('propagates a git log failure'): mockGitInstance.log.mockRejectedValue(new Error('git log failed'));
         await expect(getRecentCommitMessages(3, './repo')).rejects.toThrow('git log failed').
  - NAMING: it('<behavior in plain words>').
  - PLACEMENT: append the describe at the end of the existing file (or alongside gitFileHistory's describe).
  - EXPECTED: all 5 cases pass; existing git-mcp tests stay green (purely additive).

Task 4: FORMAT + VERIFY
  - RUN: npm run fix (lint:fix + prettier --write) → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/tools/git-mcp.test.ts → ALL GREEN (new describe + existing).
  - EXPECTED: all clean. If typecheck flags `entry.message`, confirm simple-git's LogEntry has `.message`
        (it does). If a test fails on the count=0 short-circuit not skipping simpleGit, confirm the guard
        is the FIRST line (before validateRepositoryPath). If the invalid-path test fails, confirm
        mockExistsSync was overridden for that case (default is true).
```

### Implementation Patterns & Key Details

```ts
// ---- src/tools/git-mcp.ts: the new function (place after gitFileHistory, ~L554) ----
async function getRecentCommitMessages(
  count: number,
  repoPath?: string
): Promise<string[]> {
  if (count === 0) return []; // short-circuit BEFORE validate (no git call) — PRP_COMMIT_STYLE_EXAMPLES=0
  const safePath = await validateRepositoryPath(repoPath);
  const git = simpleGit(safePath);
  const logResult = await git.log({ maxEntries: count });
  return logResult.all.map(entry => entry.message); // newest-first; full message (subject + body)
}

// ---- src/tools/git-mcp.ts: the export block (L830) — add after gitFileHistory, ----
export {
  // …
  gitFileHistory,
  getRecentCommitMessages, // ← NEW
  gitReadFileAtCommit,
  // …
};

// ---- tests/unit/tools/git-mcp.test.ts: the new describe (mirror gitFileHistory's at L876) ----
describe('getRecentCommitMessages', () => {
  it('returns the full commit messages, newest-first', async () => {
    mockGitInstance.log.mockResolvedValue({
      all: [
        { hash: 'a', date: 'd1', message: 'feat: add thing\n\nbody' },
        { hash: 'b', date: 'd2', message: 'fix: other' },
      ],
      total: 2,
      latest: { hash: 'a', date: 'd1', message: 'feat: add thing\n\nbody' },
    } as never);
    const result = await getRecentCommitMessages(2, './repo');
    expect(result).toEqual(['feat: add thing\n\nbody', 'fix: other']);
    expect(mockGitInstance.log).toHaveBeenCalledWith({ maxEntries: 2 });
  });

  it('returns [] for count === 0 WITHOUT calling simpleGit (no git call)', async () => {
    mockSimpleGit.mockClear();
    const result = await getRecentCommitMessages(0, './repo');
    expect(result).toEqual([]);
    expect(mockSimpleGit).not.toHaveBeenCalled();
  });

  it('returns all available when the repo has fewer than count commits (no error)', async () => {
    mockGitInstance.log.mockResolvedValue({
      all: [{ hash: 'only', date: 'd', message: 'solo commit' }],
      total: 1,
      latest: { hash: 'only', date: 'd', message: 'solo commit' },
    } as never);
    const result = await getRecentCommitMessages(5, './repo');
    expect(result).toEqual(['solo commit']);
  });

  it('throws when the repo path is invalid (validateRepositoryPath)', async () => {
    mockExistsSync.mockReturnValue(false);
    await expect(getRecentCommitMessages(3, '/nonexistent')).rejects.toThrow(/Repository path not found/);
  });

  it('propagates a git log failure', async () => {
    mockGitInstance.log.mockRejectedValue(new Error('git log failed'));
    await expect(getRecentCommitMessages(3, './repo')).rejects.toThrow('git log failed');
  });
});
```

### Integration Points

```yaml
DOWNSTREAM (T2.S1 ENABLES this — separate subtask, do NOT do it here):
  - P1.M1.T4.S1 (generateCommitMessage wiring): imports `getRecentCommitMessages` from
        '../tools/git-mcp.js' and calls it with the resolved PRP_COMMIT_STYLE_EXAMPLES count when
        style=auto + count>0; injects the returned messages as style examples. T2.S1 MUST land (export
        the function) before T4 can wire it. The count===0 short-circuit makes PRP_COMMIT_STYLE_EXAMPLES=0
        a no-op call site in T4.

NO SOURCE INTEGRATION beyond the new helper: validateRepositoryPath + simpleGit are reused unchanged.
  No config/constants/docs change (the function is an internal helper; the env vars are S1's; the .hack
  schema is S2's). No CLI surface.

NO OTHER CALLERS today (T4 is the first consumer; grep `getRecentCommitMessages` returns only the new
  definition + test until T4 lands).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run after the edits)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint && npm run format:check   # clean
# Expected: clean. typecheck cannot fail on a function whose body mirrors a passing sibling; if it does,
#   a typo in the simple-git API (maxEntries / entry.message) — re-check against gitFileHistory.
```

### Level 2: Unit Tests (the PRIMARY gate)

```bash
npx vitest run tests/unit/tools/git-mcp.test.ts
# Expected: ALL GREEN — the new describe (5 cases) + every existing git-mcp test. If the count=0 case
#   fails (simpleGit WAS called), confirm the `if (count === 0) return [];` guard is the FIRST line.
#   If the invalid-path case fails, confirm mockExistsSync.mockReturnValue(false) for that case. If the
#   happy-path message mapping fails, confirm you map `entry.message` (not hash/date).
```

### Level 3: Integration Testing (System Validation)

```bash
# Smoke: fetch the last 3 real commit messages from THIS repo (proves the real simple-git path works).
npx tsx -e "
import { getRecentCommitMessages } from './src/tools/git-mcp.ts';
getRecentCommitMessages(3).then(msgs => console.log(msgs)).catch(e => { console.error(e); process.exit(1); });
"
# Expected: an array of ≤3 strings (the last 3 commit messages of this repo, newest-first). Proves the
# real simple-git git.log({maxEntries}) path + entry.message extraction end-to-end.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No MCP/DB/HTTP surface beyond git (local). Domain checks (record in commit message):
#   - Mirrors gitFileHistory (validateRepositoryPath → simpleGit → git.log → .all.map).
#   - count===0 short-circuits BEFORE validate (pure no-op; PRP_COMMIT_STYLE_EXAMPLES=0 safe).
#   - Returns entry.message (full subject+body), newest-first (git log default).
#   - Fewer-than-count commits returns all available (no error — simple-git behavior).
#   - Reuses validateRepositoryPath unchanged; no logging (pure pass-through).
#   - Exported via the export { … } block (file convention — no inline export).
#   - T4 (generateCommitMessage) is the consumer; T2.S1 just provides the helper.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/tools/git-mcp.test.ts` GREEN (new describe + all existing).

### Feature Validation
- [ ] `getRecentCommitMessages` declared in `src/tools/git-mcp.ts` (no inline `export`) with JSDoc.
- [ ] `getRecentCommitMessages` added to the `export { … }` block (L830).
- [ ] `count === 0` → `[]` and does NOT call `simpleGit` (unit-test verified).
- [ ] Happy path returns `entry.message` per commit, newest-first; `log` called with `{ maxEntries: count }`.
- [ ] Fewer-than-count commits → returns all available (no error).
- [ ] Invalid `repoPath` → throws via `validateRepositoryPath`; `git.log` failure → propagates.

### Code Quality Validation
- [ ] Only `src/tools/git-mcp.ts` (function + JSDoc + 1 export line) + `tests/unit/tools/git-mcp.test.ts` (import + describe) modified.
- [ ] Function mirrors `gitFileHistory` (same validate/simpleGit/log/.all.map shape).
- [ ] Declared WITHOUT inline `export` (file convention); re-exported via the `export { … }` block.
- [ ] `validateRepositoryPath` reused UNCHANGED; no logging added.
- [ ] JSDoc documents params, return, count=0 short-circuit, fewer-than-count-returns-all (Mode A).

### Documentation & Deployment
- [ ] No docs change (internal helper consumed by T4; the user-facing style layer docs land with T3/T4).
- [ ] Commit message notes: getRecentCommitMessages helper added (mirrors gitFileHistory); count=0
      short-circuit; consumer = P1.M1.T4.S1 (generateCommitMessage auto-mode example injection).

---

## Anti-Patterns to Avoid

- ❌ Don't declare the function with inline `export` (`export async function`) — the file declares
      functions plain and re-exports via the `export { … }` block at L830. Mirror every sibling.
- ❌ Don't put the `count === 0` guard AFTER `validateRepositoryPath` — it must be FIRST so
      `getRecentCommitMessages(0)` is a pure no-op (no repo access) for the `PRP_COMMIT_STYLE_EXAMPLES=0`
      disable case.
- ❌ Don't return `entry.hash`, a split subject, or reversed order — return `entry.message` (full
      subject+body), newest-first (git log default, same as gitFileHistory's `.all`).
- ❌ Don't add a special "fewer than count" branch — `git.log({ maxEntries })` already returns all
      available without error; `.map` just yields fewer strings.
- ❌ Don't modify `validateRepositoryPath` — it's shared by every git-mcp function; reuse it unchanged.
- ❌ Don't add logging to the function — gitFileHistory doesn't log; keep it a pure pass-through.
- ❌ Don't add a new simple-git mock in the test — reuse `mockGitInstance.log` (already a vi.fn(), used
      by the gitFileHistory tests). Cast the LogResult mock with `as never` (the file's pattern).
- ❌ Don't forget to override `mockExistsSync.mockReturnValue(false)` for the invalid-path test (the file
      default is existsSync → true).
- ❌ Don't touch `constants.ts`, `.env.example`, `hack-config.ts`, or any docs — S1/S2 own the config
      layer; T2.S1 is just the git helper. No overlap.
- ❌ Don't run the full `npm run test:run` as the gate — use the targeted git-mcp suite (orthogonal suite
      state per the architecture docs).

---

## Confidence Score

**10/10** — one-pass implementation success likelihood.

Rationale: This is a single small helper that is a near-verbatim variant of an existing, passing
function (`gitFileHistory` at L539) — same `validateRepositoryPath` → `simpleGit` → `git.log` →
`.all.map` shape, differing only in the log option (`{ maxEntries }` vs `{ file }`) and the mapped
field (`entry.message` vs `{hash, date}`). The simple-git `log({ maxEntries })` contract is verified
(newest-first; fewer-than-count returns all; `entry.message` is full subject+body). The export
convention (no inline `export`; re-export via the block at L830) is confirmed against every sibling.
The test file already mocks `simpleGit → mockGitInstance` with `.log` as a `vi.fn()`, and the
`gitFileHistory` describe (L876) is the exact template for the new describe (5 cases specified
verbatim). The `count === 0` short-circuit is the one design decision (guard FIRST, before validate) —
specified explicitly. Coverage is trivially maintained (2 branches, both tested). No external/runtime
unknowns — even the Level-3 smoke (last 3 commits of this repo) is deterministic.