# System Context: BUG-001 — getRecentCommitMessages() invalid simple-git option

## Bug Summary

`getRecentCommitMessages()` in `src/tools/git-mcp.ts:590` passes `{ maxEntries: count }`
to `simple-git`'s `git.log()`. The simple-git `LogOptions` interface defines the property
as `maxCount?: number`, NOT `maxEntries`. simple-git passes the unrecognized key through
as a literal positional git argument, so `git log maxEntries=5` fails with
`fatal: ambiguous argument 'maxEntries=5': unknown revision or path not in the working tree.`

Under the DEFAULT configuration (`PRP_COMMIT_STYLE=auto`, `PRP_COMMIT_STYLE_EXAMPLES=5`),
this causes EVERY pipeline commit to silently degrade to the placeholder
`chore: commit-gen failed (exit 0); fallback commit`, losing the LLM-generated
descriptive message entirely. The headline `auto` commit-style feature is 100% non-functional.

## Empirical Verification

Confirmed empirically against the real repository (simple-git ^3.30.0):

```
git.log({ maxEntries: 3 })  → THREW: fatal: ambiguous argument 'maxEntries=3': unknown revision or path not in the working tree.
git.log({ maxCount: 3 })    → ok: 3

Default config path (env unset):
  style=auto n=5
  getRecentCommitMessages(5) → THREW: fatal: ambiguous argument 'maxEntries=5'...
```

## Root Cause Chain

```
generateCommitMessage()                     [src/utils/git-commit.ts:344]
  ├── style = getPrpCommitStyle()           → 'auto' (DEFAULT)
  ├── n = getPrpCommitStyleExamples()       → 5 (DEFAULT)
  ├── style === 'auto' && n > 0 → TRUE
  └── examples = await getRecentCommitMessages(n)   [src/tools/git-mcp.ts:583]
        └── git.log({ maxEntries: count })          ← BUG: should be maxCount
              └── THROWS (git fatal error)

smartCommit() retry wrapper                 [src/utils/git-commit.ts:660]
  ├── retry(() => generateCommitMessage(diff))
  ├── isTransientError(gitFatalError) → FALSE (git message not transient)
  └── retry() rethrows on first attempt
        └── catch block (git-commit.ts:687-700)
              └── buildFallbackCommitMessage() → 'chore: commit-gen failed (exit 0); fallback commit'
```

## Affected Callers (4 call sites)

All pass `{ generateMessage: true }` to `smartCommit`:

1. `src/core/task-orchestrator.ts:801`  — pre-cleanup stranded-state commit
2. `src/core/task-orchestrator.ts:1064` — post-subtask commit (PRP §4.2)
3. `src/core/task-orchestrator.ts:1119` — post-cleanup commit
4. `src/workflows/bug-hunt-workflow.ts:503` — bug-hunt workflow commit

## Test Masking (Why CI Is Green)

Two layers of mocking prevent the bug from being caught:

### Layer 1: git-mcp.test.ts:977
```typescript
// The test asserts the WRONG option name against a vi.fn mock that ignores arguments
expect(mockGitInstance.log).toHaveBeenCalledWith({ maxEntries: 2 });
```
The `mockGitInstance.log` is a bare `vi.fn()` — it never calls real simple-git, so the
invalid option name passes silently. The assertion itself validates the broken contract.

### Layer 2: git-commit.test.ts:28
```typescript
vi.mock('../../../src/tools/git-mcp.js', () => ({
  getRecentCommitMessages: vi.fn(),  // fully mocked — never hits real simple-git
  // ...
}));
```
The `getRecentCommitMessages` mock returns `undefined` by default (beforeEach resets to `[]`).
Style-resolution tests (line 1085+) call `mockGetRecentCommitMessages.mockResolvedValue([...])`
to provide canned data, so `generateCommitMessage` never exercises the real git-log call.

## Config Defaults (Confirmed)

| Config | Default | Source |
|--------|---------|--------|
| `PRP_COMMIT_STYLE` | `'auto'` | `src/config/constants.ts:814` (`DEFAULT_PRP_COMMIT_STYLE`) |
| `PRP_COMMIT_STYLE_EXAMPLES` | `5` | `src/config/constants.ts:897` (`DEFAULT_PRP_COMMIT_STYLE_EXAMPLES`) |

## Simple-Git API Reference

**Installed version**: `^3.30.0` (package.json)

**LogOptions interface** (`node_modules/simple-git/dist/src/lib/tasks/log.d.ts`):
```typescript
export type LogOptions<T = DefaultLogFields> = {
    file?: string;
    format?: T;
    from?: string;
    mailMap?: boolean;
    maxCount?: number;   // ← CORRECT property
    multiLine?: boolean;
    splitter?: string;
    strictDate?: boolean;
    symmetric?: boolean;
    to?: string;
};
```
**No `maxEntries` property exists.** simple-git passes unknown keys as literal git CLI
arguments, which git rejects with a fatal error.

## Test Infrastructure Context

- **Test runner**: vitest ^1.6.1, pool: 'forks', globals: true
- **Test pattern**: `tests/**/*.{test,spec}.ts`
- **Integration tests**: `tests/integration/` directory exists; `smart-commit.test.ts` is there
  but it mocks `git-commit.ts` itself, so it doesn't test real git operations
- **Temp repo pattern**: `mkdtempSync(join(tmpdir(), 'prefix-'))` + `rmSync(dir, {recursive:true})`
  cleanup — used extensively in `tests/unit/config/hack-config.test.ts` and `tests/integration/smart-commit.test.ts`
- **No existing "createTestRepo" helper** — tests inline the temp-repo creation

## Fix Scope

1. **One-character-class fix**: `src/tools/git-mcp.ts:590` — change `maxEntries` → `maxCount`
2. **Test assertion fix**: `tests/unit/tools/git-mcp.test.ts:977` — change `{ maxEntries: 2 }` → `{ maxCount: 2 }`
3. **Regression prevention**: Add integration test(s) using REAL simple-git against a temp git repo,
   so an invalid option name fails the build instead of being masked by mocks.