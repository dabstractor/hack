# Research Notes — P5.M2.T1.S1 (git file-history + file-restore utilities)

## simple-git (^3.30.0) API verification (from node_modules/simple-git/dist/typings)

### `.log(options)` → `LogResult`
- `LogOptions<T = DefaultLogFields>` (`dist/src/lib/tasks/log.d.ts`):
  `{ file?: string; format?: T; from?; maxCount?: number; to?; symmetric?; ... }`
- `DefaultLogFields` = `{ hash; date; message; refs; body; author_name; author_email }`
- `LogResult<T>` (`dist/typings/response.d.ts:411`):
  `{ all: ReadonlyArray<T & ListLogLine>; total: number; latest: (T & ListLogLine) | null }`
- **`.log({ file: 'path' })`** → entries are NEWEST-FIRST by default. A file with NO commit
  history returns `{ all: [], total: 0, latest: null }` — **no throw**. So `gitFileHistory`
  must return `[]` on no-history (only throw on real git errors).
- Map `entry.hash → commit`, `entry.date → date`.

### `.show(option)` → `string`
- Signature (`dist/typings/simple-git.d.ts:907`):
  `show(option: string | TaskOptions, callback?): Response<string>`
- `.show('HEAD:tasks.json')` runs `git show HEAD:tasks.json` → outputs the **blob content** as a
  string (for `<tree-ish>:<path>` syntax git prints the file contents to stdout). This is the
  blob-fetch primitive for `gitReadFileAtCommit` and the first half of `gitRestoreFile`.
- **Fallback** (identical git invocation, most bulletproof): `.raw(['show', `${commit}:${filePath}`])` → `Response<string>`.

## Decision: stubbed simple-git test approach (NOT a separate real-repo file)

The named test file `tests/unit/tools/git-mcp.test.ts` already declares a **module-level**
`vi.mock('simple-git', ...)` (L19–27) that returns `mockGitInstance` for ALL simple-git usage
in that file. A "real ephemeral git repo" test placed in the SAME file would still hit the
mock → impossible without messy `vi.doMock`/dynamic-import gymnastics.

Therefore the **stubbed approach** (explicitly allowed by the item contract: "or stub simple-git
methods") is the correct, one-pass-safe path:
- Add `log: vi.fn()` and `show: vi.fn()` to `mockGitInstance`.
- `gitFileHistory` / `gitReadFileAtCommit`: pure stub assertions.
- `gitRestoreFile`: stub `show` for the blob, but use a **real tmpdir** for the atomicWrite
  write target (node:fs/promises is NOT mocked by the existing file, so atomicWrite writes for
  real — verifying the restore end-to-end). Mock `existsSync` already returns `true` so
  `validateRepositoryPath` passes for the tmpdir.

(A real-repo integration test can OPTIONALLY be added in a SEPARATE file later, but it is not
required by the validation gates and is out of scope for one-pass success here.)

## Pattern decisions

1. **Add to `src/tools/git-mcp.ts`** (contract's primary option) — reuses the module-private
   `validateRepositoryPath` helper (DRY) and matches "Follow the existing module patterns".
2. **THROW on failure** (NOT the existing `{success, error}` object pattern) — per the contract
   signatures (`Promise<{commit,date}[]>`, `Promise<string>`, `Promise<void>`) + "throw on
   non-zero exit". This is a DELIBERATE pattern difference; S2's smart-recovery will use try/catch.
3. **Optional trailing `repoPath?` param** (default `process.cwd()`) on each fn — consistency
   with the module (every existing fn takes a path) + lets S2 / tests target a specific repo.
   Order: repoPath is ALWAYS the LAST optional.
4. **Internal utilities only** — do NOT add MCP tool schemas, do NOT touch the `GitMCP` class.
5. `gitRestoreFile` imports `atomicWrite` from `../core/session-utils.js` (explicitly sanctioned
   by contract; session-utils does NOT import from tools → no circular dep).

## Validation gates (implementation_notes.md §10)
`npm run validate` (eslint + prettier --check + tsc --noEmit) + `npm run test:run` (vitest run).
Coverage is NOT enforced by either gate (only `test:coverage` enforces the 100% thresholds).
