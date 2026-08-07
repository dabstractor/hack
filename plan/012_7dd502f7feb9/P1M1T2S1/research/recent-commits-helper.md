# Research — P1.M1.T2.S1: `getRecentCommitMessages(count)` in `src/tools/git-mcp.ts`

## 1. What this task does

Add one small exported async helper that fetches the last `count` commit messages from a repo
(newest-first), mirroring the existing `gitFileHistory` function. It is the **style-examples fetcher**
for the §5.1 commit-message style layer: P1.M1.T4.S1 (`generateCommitMessage` auto-mode) will call
`getRecentCommitMessages(examplesCount)` to inject recent commit messages as style examples. No other
dependencies. Self-contained in `src/tools/git-mcp.ts` + its unit test.

## 2. The exact mirror template — `gitFileHistory` (src/tools/git-mcp.ts:539)

```ts
async function gitFileHistory(filePath: string, repoPath?: string): Promise<GitFileHistoryEntry[]> {
  const safePath = await validateRepositoryPath(repoPath);
  const git = simpleGit(safePath);
  const logResult = await git.log({ file: filePath });
  return logResult.all.map(entry => ({ commit: entry.hash, date: entry.date }));
}
```
**The new function is identical except:** (a) takes `count: number` instead of `filePath`, (b) guards
`count === 0` → `return []` FIRST (before any git/validate call — so `getRecentCommitMessages(0)` works
even outside a repo, matching `PRP_COMMIT_STYLE_EXAMPLES=0` disables-learning), (c) calls
`git.log({ maxEntries: count })` instead of `git.log({ file })`, (d) maps `entry.message` (full
subject+body) instead of hash/date.

```ts
async function getRecentCommitMessages(count: number, repoPath?: string): Promise<string[]> {
  if (count === 0) return [];                       // short-circuit BEFORE validate (no git call)
  const safePath = await validateRepositoryPath(repoPath);
  const git = simpleGit(safePath);
  const logResult = await git.log({ maxEntries: count });
  return logResult.all.map(entry => entry.message); // newest-first; full message (subject + body)
}
```

## 3. Verified codebase conventions (grounded in source)

- **`validateRepositoryPath(path?)`** (L202): `resolve(path ?? process.cwd())` → `existsSync` check →
  `.git` check → `realpathSync`. Throws plain `Error('Repository path not found: …')` /
  `Error('Not a git repository: …')`. Reused unchanged — do NOT modify it.
- **`simpleGit`** is imported from `'simple-git'` (L24) and constructed as `simpleGit(safePath)`.
  `git.log({...})` returns a `LogResult` whose `.all` is an array of `LogEntry` (newest-first by
  default). Each `LogEntry` has `.hash`, `.date`, `.message` (full message). `maxEntries` is the
  simple-git option for "limit to N" (equivalent to `git log -N`).
- **Export style**: git-mcp.ts does NOT use inline `export async function`. Functions are declared
  `async function name(...)` and re-exported via a single `export { … }` block at **L830**. Follow
  this convention: declare `async function getRecentCommitMessages` (no `export` keyword) and ADD
  `getRecentCommitMessages,` to the `export { … }` block. (The contract's "export async function"
  wording describes that it IS exported, not the inline-export syntax.)
- **JSDoc**: gitFileHistory's JSDoc (L525-538) is the template — `@remarks` explaining the use case,
  `@param` / `@returns` / `@throws` / `@example`. Mirror it; document the count=0 short-circuit +
  fewer-than-count-returns-all behaviors.
- **No logging in these helpers**: gitFileHistory does NOT log. getRecentCommitMessages should not
  log either (keep it a pure pass-through, mirroring the template).

## 4. The simple-git `log({ maxEntries })` contract (verified)

- `git.log({ maxEntries: count })` returns `{ all: LogEntry[], total, latest }` where `.all` is
  **newest-first** (matches `git log` default ordering — same as `gitFileHistory`'s `.all`).
- A repo with **fewer than `count` commits** returns all available entries (`.all.length < count`);
  simple-git does NOT error. So no special handling — the `.map` just yields fewer strings.
- `LogEntry.message` is the **full commit message** (subject + body, as git stores it). The caller
  (T4) will split to subject if it wants; for style examples the full message is most useful (per
  architecture note §F1.D).
- A log failure (e.g. corrupt repo) rejects → propagates as a thrown Error (mirroring gitFileHistory's
  `git log failed` test at L946).

## 5. Test pattern to mirror (tests/unit/tools/git-mcp.test.ts)

The test file ALREADY mocks simple-git: `simpleGit: vi.fn(() => mockGitInstance)` (L28), and
`mockGitInstance.log` is a `vi.fn()` (used by the gitFileHistory tests at L879). The `gitFileHistory`
describe block (L876) is the exact template:

```ts
describe('gitFileHistory', () => {
  it('should return mapped history entries (newest-first)', async () => {
    mockGitInstance.log.mockResolvedValue({
      all: [{ hash:'aaa111', date:'…', message:'latest' }, { hash:'bbb222', date:'…', message:'older' }],
      total: 2, latest: { hash:'aaa111', date:'…', message:'latest' },
    } as never);
    const result = await gitFileHistory('tasks.json', './repo');
    expect(result).toEqual([{ commit:'aaa111', date:'…' }, { commit:'bbb222', date:'…' }]);
    expect(mockGitInstance.log).toHaveBeenCalledWith({ file: 'tasks.json' });
  });
  // … error-path tests: nonexistent repo path (existsSync false → throws), log rejects → throws …
});
```

**The new describe block (mirror it):**
```ts
describe('getRecentCommitMessages', () => {
  it('returns the full commit messages, newest-first', async () => {
    mockGitInstance.log.mockResolvedValue({
      all: [{ hash:'a', date:'d1', message:'feat: add thing\n\nbody' }, { hash:'b', date:'d2', message:'fix: other' }],
      total: 2, latest: { hash:'a', date:'d1', message:'feat: add thing\n\nbody' },
    } as never);
    const result = await getRecentCommitMessages(2, './repo');
    expect(result).toEqual(['feat: add thing\n\nbody', 'fix: other']);
    expect(mockGitInstance.log).toHaveBeenCalledWith({ maxEntries: 2 });
  });

  it('returns [] for count === 0 WITHOUT calling simpleGit (no git call)', async () => {
    mockSimpleGit.mockClear();
    const result = await getRecentCommitMessages(0, './repo');
    expect(result).toEqual([]);
    expect(mockSimpleGit).not.toHaveBeenCalled();   // short-circuit before validate/simpleGit
  });

  it('returns all available when the repo has fewer than count commits (no error)', async () => {
    mockGitInstance.log.mockResolvedValue({
      all: [{ hash:'only', date:'d', message:'solo commit' }], total: 1,
      latest: { hash:'only', date:'d', message:'solo commit' },
    } as never);
    const result = await getRecentCommitMessages(5, './repo');   // asked 5, got 1
    expect(result).toEqual(['solo commit']);                     // no throw — simple-git returns fewer
  });

  it('throws when the repo path is invalid (validateRepositoryPath)', async () => {
    mockExistsSync.mockReturnValue(false);                       // mirror the gitFileHistory nonexistent-path test
    await expect(getRecentCommitMessages(3, '/nonexistent')).rejects.toThrow(/Repository path not found/);
  });

  it('propagates a git log failure', async () => {
    mockGitInstance.log.mockRejectedValue(new Error('git log failed'));
    await expect(getRecentCommitMessages(3, './repo')).rejects.toThrow('git log failed');
  });
});
```
Also add `getRecentCommitMessages` to the import list (L47 area, alongside `gitFileHistory`).

## 6. Coverage note (vitest enforces 100% on src/**/*.ts)

The new function adds 2 branches: `count === 0` (true/false). Both are covered (the count=0 test hits
the true side; every other test hits the false side). `validateRepositoryPath`'s internal branches are
already covered by the existing gitFileHistory tests (shared helper). No coverage gap.

## 7. Parallel-execution / file-disjoint check

- **vs P1.M1.T1.S2 (in-flight):** S2 edits `src/config/hack-config.ts` (schema wiring) + its test.
  T2.S1 edits `src/tools/git-mcp.ts` + `tests/unit/tools/git-mcp.test.ts`. **Zero file overlap.**
  T2.S1 is independent of the schema wiring (it just provides the helper T4 will call).
- **Downstream (T4):** P1.M1.T4.S1 imports `getRecentCommitMessages` from `../tools/git-mcp.js` and
  calls it with the resolved `PRP_COMMIT_STYLE_EXAMPLES` count when style=auto + count>0. T2.S1 MUST
  land (export the function) before T4 can wire it. The `count===0` short-circuit is what makes
  `PRP_COMMIT_STYLE_EXAMPLES=0` (disable learning) a no-op call site in T4.

## 8. Decisions locked

- **Declare `async function getRecentCommitMessages` (NO inline `export`)** + add to the `export { … }`
  block at L830 — matches the file's convention (all sibling functions use this pattern).
- **`count === 0` guard FIRST** (before `validateRepositoryPath`) → `getRecentCommitMessages(0)` is a
  pure no-op (no repo needed) — cleanest for the `PRP_COMMIT_STYLE_EXAMPLES=0` disable case.
- **Return `entry.message`** (full subject+body), newest-first — per architecture note §F1.D
  ("for style examples, the full message is most useful"). The caller splits to subject if it wants.
- **No logging** in the function (mirror gitFileHistory — these helpers are pure pass-throughs).
- **Reuse `validateRepositoryPath` unchanged** (it already validates + realpathSyncs + throws clearly).
- **Mirror the `gitFileHistory` test describe** (same mock setup; same error-path tests) — keeps the
  file's test style consistent and covers all branches.