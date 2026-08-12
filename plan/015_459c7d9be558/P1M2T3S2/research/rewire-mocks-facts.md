# Research — P1.M2.T3.S2: Rewire test mocks + delete commit-message-agent.test.ts

> Load-bearing facts captured by direct inspection of the hacky-hack working tree
> (session 015), AFTER the parallel sibling P1.M2.T3.S1 has already run (the
> production module `commit-message-agent.ts` is GONE) and AFTER P1.M2.T2.S1
> rewrote `generateCommitMessage` to the stagecoach binary + rewired the big unit
> test. **This subtask is test-files-only.**

## 0. SCOPE CORRECTION (read first — the work item's 3-file list is stale)

The work item description lists `git-commit.test.ts` as needing rewiring. **It is
ALREADY DONE.** P1.M2.T2.S1 (which lands before this task) fully rewired
`git-commit.test.ts` to the stagecoach binary boundary. Verified at research time:

- `tests/unit/utils/git-commit.test.ts` (now **2621** lines, grew from the
  survey's 2233) **passes 111/111** (`npx vitest run` → `Test Files 1 passed`).
- It has **ZERO** references to `commit-message-agent` / `createCommitMessageAgent` /
  `buildCommitMessageSystemPrompt`. It mocks `../../../src/utils/stagecoach-resolver.js`
  (→ `/fake/stagecoach`) and `node:child_process` (`spawn: vi.fn()`), with a
  `fakeChild`/`spawnReturning` helper (lines 108–150) that emits stdout/stderr/close.
- So this task must **VERIFY, NOT re-rewire** `git-commit.test.ts`. Re-rewiring it
  would duplicate/conflict with T2.S1's landed work (parallel_execution_context rule).

The **real** scope (4 files: 1 delete, 1 rewire, 1 clean, 1 optional-comment-cleanup):

| File | Action | Why |
| ---- | ------ | --- |
| `tests/unit/agents/commit-message-agent.test.ts` | **DELETE** | Tests only the deleted module; fails to load now. |
| `tests/integration/git-commit-generate.test.ts` | **REWIRE** | Imports the deleted module → `Failed to load url … Does the file exist?` (load error). Rewire to the stagecoach binary boundary. |
| `tests/unit/protected-files.test.ts` | **CLEAN dead mock** | Has a dead `vi.mock('…/commit-message-agent.js')` (factory-only, lines 29–35) + stale comment. Not load-breaking, but dead code referencing a deleted module. Assigned to S2 by the sibling S1 PRP. |
| `tests/unit/agents/cleanup-agent.test.ts` | **OPTIONAL comment cleanup** | Stale COMMENT refs only (lines 9, 12, 26, 111), incl. `@see {@link ./commit-message-agent.test.ts}` which dangles once that test is deleted. Comments don't break; accuracy cleanup. |
| `tests/unit/utils/git-commit.test.ts` | **VERIFY only (do NOT edit)** | Already rewired by T2.S1; passes 111/111. |

## 1. The production module is GONE (S1 ran) — confirmed

`ls src/agents/commit-message-agent.ts` → **No such file or directory**. The sibling
P1.M2.T3.S1 deleted it. Consequence: any test that `import`s it (typed) fails to
LOAD under vitest:
- `git-commit-generate.test.ts`: `Error: Failed to load url
  ../../src/agents/commit-message-agent.js … Does the file exist?` (confirmed).
- `commit-message-agent.test.ts`: same (delete it).

## 2. The binary-exec boundary to mock (the new mock target)

`generateCommitMessage(repoRoot: string, _diff?: string)` in `src/utils/git-commit.ts`
(lines 307–360) now:
1. `const bin = resolveStagecoachBinary();` — from `src/utils/stagecoach-resolver.js`.
2. Builds `argv = ['--dry-run', '--single']`; if `getPrpCommitStyle() !== 'auto'`,
   pushes `--format <style>`; pushes `--provider <PRP_AGENT_HARNESS ?? 'pi'>` and
   `--model <getModel('balanced')>`.
3. `spawn(bin, argv, { cwd: repoRoot, env, stdio:['ignore','pipe','pipe'] })`,
   collecting child stdout/stderr via EventEmitters, resolving on `close(0)` →
   `stdout.trim()`; rejecting with `AgentError` on non-zero/empty/spawn-error.

So the mock boundary is **`resolveStagecoachBinary` + `node:child_process.spawn`**
— NOT the deleted agent factory. `_diff` is now UNUSED (the old agent consumed it;
stagecoach reads the real index itself).

## 3. The spawn-mock pattern to mirror (from git-commit.test.ts, T2.S1)

`tests/unit/utils/git-commit.test.ts` lines 108–150 define the canonical helper.
Mirror it in the rewired integration test for consistency:

- `vi.mock('<path>/stagecoach-resolver.js', () => ({ resolveStagecoachBinary: vi.fn() }))`
  — factory is BARE (no top-level vars → vitest hoist-safe). Wire the return in `beforeEach`.
- `vi.mock('node:child_process', () => ({ spawn: vi.fn() }))` — bare factory; wire
  `mockSpawn.mockImplementation(...)` in `beforeEach`.
- `fakeChild({stdout, stderr, exitCode, spawnError})`: an `EventEmitter` with
  `.stdout`/`.stderr` EventEmitters; uses `process.nextTick(() => {…emit…})` so the
  listeners `generateCommitMessage` attaches synchronously after `spawn()` returns
  are registered BEFORE emission. Pair with `mockSpawn.mockImplementation(() => fakeChild(…))`
  (NOT `mockReturnValue`) — call-time creation is required.
- `spawnReturning(opts) = () => fakeChild(opts)` wrapper for `mockImplementation`.

`EventEmitter` is imported from `node:events`. `Buffer.from(str)` for stdout data.

## 4. git-commit-generate.test.ts — original purpose is OBSOLETE; preserve "auto path" value

The original file (97 lines) was a regression net for **BUG-001**: `getRecentCommitMessages`
passed `simple-git` `{maxEntries}` instead of `{maxCount}`, breaking the default
`auto` config path. **That code path is GONE** — T2.S1 removed `getRecentCommitMessages`
from `generateCommitMessage` entirely; generation now delegates to stagecoach (which
does its own history learning). So the BUG-001 scenario no longer exists in the code.

The work item says: *"Preserve the test's value (exercising the full auto config path)."*
Under the new architecture, the "auto config path" through `generateCommitMessage` is:
config resolution (`getPrpCommitStyle()` → `'auto'` when env unset → **do NOT push `--format`**;
stagecoach's native history-learned auto applies) → argv construction → spawn → stdout
return. The rewired test preserves this value by asserting the DEFAULT config produces a
stagecoach invocation with `['--dry-run','--single',...]` and **NO `--format`**, returning
the canned stdout. (A real temp git repo is kept so `repoRoot` is a valid cwd and the
"integration" character is preserved, though `generateCommitMessage` no longer reads git
itself — stagecoach would, but stagecoach is mocked at the spawn boundary.)

Signature note: `generateCommitMessage(repoRoot, _diff?)` — first arg is now **repoRoot**
(cwd), NOT diff. The old call `generateCommitMessage('diff …')` must become
`generateCommitMessage(dir)`. `process.cwd` spy is no longer needed (gone path).

## 5. protected-files.test.ts — exact dead block to remove (lines 29–35)

```ts
// Mock the stagecoach commit-message agent factory so the default-path
// smartCommit (no options) never instantiates a real agent via the static
// import chain (git-commit.ts → commit-message-agent.ts → agent-factory.ts,
// which constructs `new GitMCP()` at module eval).
vi.mock('../../src/agents/commit-message-agent.js', () => ({
  createCommitMessageAgent: vi.fn(),
}));
```
The comment's import chain (`git-commit.ts → commit-message-agent.ts`) is **broken**
(T2.S1 cut it) and the module is **deleted** (S1). The mock is factory-only (no typed
import in this file) → it does NOT break the load, but it is dead code + a stale
comment. **Remove the whole block (comment + vi.mock).** Do NOT touch anything else
in protected-files.test.ts.

**Pre-existing failure (out of scope):** protected-files.test.ts currently FAILS at
**line 746** (`expect(mockGitAdd).toHaveBeenCalledWith({ files: […'tasks.json'…] })`) —
a **staging-behavior** assertion, collateral from the M1.T3 snapshot-based smartCommit
rewrite. It is **unrelated to commit-message-agent** and **NOT this task's fix**
(behavioral; another task's domain). Removing the dead mock does NOT affect it. This
task's success for protected-files.test.ts = "dead mock removed; no NEW failure
introduced; the line-746 failure is pre-existing and untouched."

## 6. cleanup-agent.test.ts — comment-only (optional accuracy cleanup)

Comment refs at lines 9, 12, 26 (`@see {@link ./commit-message-agent.test.ts}`), 111
(`// KEY divergence from commit-message-agent`). These are inert (comments don't
break), but the `@see` link dangles once `commit-message-agent.test.ts` is deleted.
Optional: reword to past-tense / remove the dangling `@see`. Not required for green.

## 7. Validation environment (verified package.json)

| Script | Definition |
| ------ | ---------- |
| `lint` | `eslint . --ext .ts` |
| `format:check` | `prettier --check "**/*.{ts,js,json,md,yml,yaml}"` |
| `typecheck` | `tsc --noEmit -p tsconfig.build.json` (build program = `src/` only; tests excluded) |
| `test:run` | `vitest run` |
| `docs:check` | `tsx scripts/check-docs.ts` |
| `validate` | `lint && format:check && typecheck && test:run && docs:check` |
| `fix` | `lint:fix && format` (prettier --write) |

Notes:
- `validate` now **ends with `docs:check`** (new since prior sessions). `test:run`
  precedes it — a red test stops the chain before docs:check.
- `typecheck` excludes tests (tsconfig.build.json) → dangling test imports were never
  caught by typecheck (this is WHY the load failure surfaces only at `vitest run`).
- The work item says "All tests green (except the known stray `>` bug … fixed in
  P1.M3.T2.S1)." The stray-`>` bug appears **already resolved** (0 `>`-ending `toBe`
  matches in git-commit.test.ts; it passes 111/111). The remaining red in the commit
  area is the **protected-files.test.ts line-746 staging failure** (pre-existing,
  unrelated) — NOT the stray `>`. Frame validation as "no NEW failures; files I touch
  are green (git-commit-generate.test.ts) or have only their pre-existing unrelated
  failure (protected-files.test.ts line 746)."

## 8. The targeted green check for THIS task

After this task:
- `tests/unit/agents/commit-message-agent.test.ts` → **gone**.
- `tests/integration/git-commit-generate.test.ts` → **GREEN** (rewired to stagecoach boundary).
- `tests/unit/protected-files.test.ts` → dead mock removed; **same pre-existing line-746
  failure** (unrelated, out of scope); no NEW failure.
- `tests/unit/agents/cleanup-agent.test.ts` → comments cleaned (optional); GREEN.
- `tests/unit/utils/git-commit.test.ts` → **untouched, GREEN** (111/111, T2.S1).
- `grep -rln "commit-message-agent\|createCommitMessageAgent\|buildCommitMessageSystemPrompt" tests/` → **ZERO** (all test refs gone).