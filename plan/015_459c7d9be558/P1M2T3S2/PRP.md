# PRP — P1.M2.T3.S2: Rewire test mocks + delete `commit-message-agent.test.ts`

---

## Goal

**Feature Goal**: Finish PRD §9.10.1's "Supersedes the in-process agent" fallout in
the **test suite** now that the parallel sibling P1.M2.T3.S1 has **deleted**
`src/agents/commit-message-agent.ts` and P1.M2.T2.S1 has **rewritten**
`generateCommitMessage` to delegate to the `stagecoach` binary. Concretely: **delete**
the test file that tests only the deleted module; **rewire** the integration test that
imports the deleted module to mock the stagecoach **binary-exec boundary**
(`resolveStagecoachBinary` + `node:child_process.spawn`) instead of the deleted agent
factory; **clean** the dead `vi.mock` of the deleted module in another test file; and
**optionally** refresh stale comments. **No production (`src/`) changes** — this is the
test-half of T3 (S1 = production delete; S2 = test rewire). `git-commit.test.ts` is
**already rewired by T2.S1** (passes 111/111) and must NOT be touched again.

**Deliverable** (4 test files; no `src/` changes):
1. **DELETE** `tests/unit/agents/commit-message-agent.test.ts` (entire file — tests only the deleted module; fails to load now).
2. **REWIRE** `tests/integration/git-commit-generate.test.ts` — replace the `vi.mock('../../src/agents/commit-message-agent.js', …)` + `import { createCommitMessageAgent }` with mocks of the stagecoach binary boundary (`resolveStagecoachBinary` + `node:child_process.spawn`), mirroring T2.S1's `fakeChild`/`spawnReturning` pattern from `git-commit.test.ts`. Preserve the test's value: exercising the DEFAULT `auto` config path (assert the stagecoach argv carries `--dry-run --single` and **no** `--format` under auto, and the canned stdout is returned). Add a test-file-level comment noting the mock-rewiring rationale (DOCS contract).
3. **CLEAN** `tests/unit/protected-files.test.ts` — remove the **dead** `vi.mock('../../src/agents/commit-message-agent.js', …)` block + its stale comment (the import chain it describes is broken; the module is deleted). Do NOT touch anything else in this file.
4. **OPTIONALLY** refresh stale **comments** in `tests/unit/agents/cleanup-agent.test.ts` (a `@see {@link ./commit-message-agent.test.ts}` that dangles once that file is deleted).

**Success Definition** (the contract from the work item + the discovered real state):
- `tests/unit/agents/commit-message-agent.test.ts` does not exist.
- `tests/integration/git-commit-generate.test.ts` **loads and passes** (rewired to the stagecoach binary boundary; no reference to the deleted module).
- `tests/unit/protected-files.test.ts` has **no** `vi.mock('…/commit-message-agent.js')` and **no** import of its symbols.
- `tests/unit/utils/git-commit.test.ts` is **unchanged** (already rewired by T2.S1; passes 111/111).
- `grep -rln "commit-message-agent\|createCommitMessageAgent\|buildCommitMessageSystemPrompt" tests/` → **ZERO** (every test reference to the deleted module is gone).
- **No NEW test failures introduced.** The rewired `git-commit-generate.test.ts` is GREEN. (`git-commit.test.ts` stays GREEN.) The pre-existing `protected-files.test.ts:746` staging failure (collateral from the M1.T3 smartCommit rewrite, **unrelated** to this task) is left untouched — it is not this task's fix. The work item's "stray `>` bug" appears already resolved (git-commit.test.ts passes 111/111 with zero `>`-ending assertions).
- `npm run lint`, `npm run format:check`, `npm run typecheck` are GREEN (test edits don't affect these: `typecheck` excludes `tests/`; `lint`/`format:check` apply to `.ts` incl. tests but the edits are clean).
- **No** `src/` file is modified (S1 owns production; this is test-only).

---

## User Persona (if applicable)

**Target User**: **Maintainer** of the commit pipeline's test suite. Not end-user-facing.

**Use Case**: After S1 deleted `commit-message-agent.ts` and T2.S1 routed
`generateCommitMessage` to the stagecoach binary, the tests that mocked/imported the
deleted module are dead or load-broken. This task mops them up so the suite reflects
the new (single, identity-transparent) stagecoach-delegation architecture.

**Pain Points Addressed**: Eliminates the load-broken `git-commit-generate.test.ts`
and the dead `commit-message-agent.test.ts`; removes a dead `vi.mock` landmine in
`protected-files.test.ts`; keeps the test suite honest about the §9.10.1 delegation.

---

## Why

- **PRD §9.10.1 "Supersedes the in-process agent" has a test half.** S1 removed the
  production module; the tests that referenced it must follow or the suite is red
  (load errors) / dishonest (dead mocks). T3 = S1 (production) + S2 (tests), validated
  as a unit for the full `npm run validate`.
- **The mock TARGET moved.** `generateCommitMessage` no longer calls an in-process
  agent factory; it `spawn`s the `stagecoach` binary (resolved via
  `resolveStagecoachBinary`). Tests that previously mocked `createCommitMessageAgent`
  must now mock the **binary-exec boundary** — exactly as T2.S1 already did in
  `git-commit.test.ts` (the canonical pattern to mirror).
- **`git-commit.test.ts` is already done.** T2.S1 rewired it (passes 111/111; zero
  agent refs; mocks `stagecoach-resolver.js` + `node:child_process.spawn` with a
  `fakeChild` helper). This task must **verify, not re-rewire** it — re-rewiring would
  collide with T2.S1's landed work.
- **Scope discipline.** The stray-`>` behavioral bug (survey §1) is **already resolved**
  in the current tree (T2.S1's rewrite cleaned it); the remaining commit-area red is the
  unrelated `protected-files.test.ts:746` staging failure (M1.T3 collateral). Neither is
  this task's fix. This task only rewires mock targets + deletes the dead test file.
- **Out of scope (hard boundary):** any `src/` file (S1/T2.S1 own production), the
  `generateCommitMessage` body / `smartCommit` / `formatCommitMessage` /
  `stagecoach-resolver.ts`, the `git-commit.test.ts` file (T2.S1 — verify only), the
  protected-files line-746 staging failure (behavioral, another task), the bash denylist
  / tool matrix (P1.M4), the commit-identity structural guard (P1.M3), any `docs/*.md`
  (DOCS = test-file-level comments only), `PRD.md`, `tasks.json`, `package.json`.

---

## What

### User-visible behavior

None at runtime/CLI. Observable change: one test file is deleted; one integration test
is rewired (mocks the stagecoach binary boundary); one unit test file loses a dead mock;
comments optionally refreshed. No production behavior change.

### Technical requirements (exact contract)

**A. DELETE `tests/unit/agents/commit-message-agent.test.ts`** (entire file). It exists
solely to test `src/agents/commit-message-agent.ts`, which S1 deleted. It now fails to
load (`Failed to load url … commit-message-agent.js … Does the file exist?`).

**B. REWIRE `tests/integration/git-commit-generate.test.ts`** — it currently:
- `vi.mock('../../src/agents/commit-message-agent.js', async () => { const actual = await vi.importActual<…>(…); return { …actual, createCommitMessageAgent: vi.fn(…) } })`
- `import { createCommitMessageAgent } from '../../src/agents/commit-message-agent.js'`
- drives the `auto` path + asserts `mockCreateCommitMessageAgent` called once + result is `'feat: generated commit message'`.

Rewire to mock the **stagecoach binary-exec boundary** instead (mirroring
`git-commit.test.ts` lines 31–42 + 108–150):
- `vi.mock('../../src/utils/stagecoach-resolver.js', () => ({ resolveStagecoachBinary: vi.fn(() => '/fake/stagecoach') }))` (bare factory — hoist-safe).
- `vi.mock('node:child_process', () => ({ spawn: vi.fn() }))` (bare factory).
- Import `spawn` from `node:child_process` and `resolveStagecoachBinary` from the resolver; `vi.mocked(...)` both.
- A `fakeChild` helper (EventEmitter + `process.nextTick` emission — copy the idiom from `git-commit.test.ts`) + wire `mockSpawn.mockImplementation(() => fakeChild({ stdout: 'feat: generated commit message\n' }))` in `beforeEach`.
- **Signature change:** `generateCommitMessage(repoRoot, _diff?)` — first arg is now **repoRoot** (cwd), not diff. Call `generateCommitMessage(dir)`. Drop the `process.cwd` spy (the old `getRecentCommitMessages`→`validateRepositoryPath`→`process.cwd` path is gone).
- **Preserve the test's value** (the DEFAULT `auto` config path): assert the spawn argv includes `--dry-run` + `--single` and **does NOT include `--format`** (because `getPrpCommitStyle()` → `'auto'` → no `--format` push; stagecoach's native history-learned auto applies), and the returned message equals the canned stdout. (The original BUG-001 `maxEntries`/`maxCount` regression scenario no longer exists — T2.S1 removed `getRecentCommitMessages` from `generateCommitMessage`.)
- **DOCS contract:** add/keep a test-file-level top comment noting the mock-rewiring rationale (in-process agent removed per §9.10.1; mocks now target the stagecoach binary boundary).

**C. CLEAN `tests/unit/protected-files.test.ts`** — remove this exact block (comment + vi.mock, currently ~lines 29–35):
```ts
// Mock the stagecoach commit-message agent factory so the default-path
// smartCommit (no options) never instantiates a real agent via the static
// import chain (git-commit.ts → commit-message-agent.ts → agent-factory.ts,
// which constructs `new GitMCP()` at module eval).
vi.mock('../../src/agents/commit-message-agent.js', () => ({
  createCommitMessageAgent: vi.fn(),
}));
```
The comment's import chain is **broken** (T2.S1 cut `git-commit.ts → commit-message-agent.ts`) and the module is **deleted** (S1). The mock is factory-only (no typed import here) so it does NOT break the load, but it is dead code + a stale comment. Remove the whole block. **Do NOT touch anything else** in `protected-files.test.ts` (its line-746 staging failure is pre-existing and out of scope).

**D. (OPTIONAL) refresh stale comments in `tests/unit/agents/cleanup-agent.test.ts`** — comment-only refs at lines 9, 12, 26 (`@see {@link ./commit-message-agent.test.ts}` — dangles once that test is deleted), 111. Comments are inert (don't break), but the `@see` link dangles. Optional accuracy cleanup: reword to past tense / drop the `@see`. Not required for green.

### Success Criteria

- [ ] `tests/unit/agents/commit-message-agent.test.ts` deleted.
- [ ] `tests/integration/git-commit-generate.test.ts` rewired to the stagecoach binary boundary; loads + passes; zero deleted-module refs.
- [ ] `tests/unit/protected-files.test.ts` dead `vi.mock('…/commit-message-agent.js')` + stale comment removed; no other change.
- [ ] `grep -rln "commit-message-agent\|createCommitMessageAgent\|buildCommitMessageSystemPrompt" tests/` → ZERO.
- [ ] `tests/unit/utils/git-commit.test.ts` UNCHANGED (verify-only; still passes 111/111).
- [ ] `npm run lint`, `npm run format:check`, `npm run typecheck` GREEN.
- [ ] No NEW test failures; rewired `git-commit-generate.test.ts` GREEN; pre-existing
      `protected-files.test.ts:746` failure left untouched (out of scope).
- [ ] Test-file-level comment noting the mock-rewiring rationale present in `git-commit-generate.test.ts` (DOCS contract).

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed?_
**Yes** — the corrected scope (git-commit.test.ts already done by T2.S1 — verify only),
the exact 4 test files + per-file action, the proof that the production module is
already deleted (S1 ran), the exact binary-exec boundary to mock
(`resolveStagecoachBinary` + `node:child_process.spawn`), the canonical `fakeChild`/
`spawnReturning` pattern to mirror (git-commit.test.ts lines 108–150), the full
reference implementation of the rewired integration test, the exact dead-mock block
to remove from protected-files.test.ts, the precise validation framing (which
pre-existing failures are NOT this task's), and the exact grep that proves completion
(zero test refs to the deleted module). All non-obvious facts are in
`research/rewire-mocks-facts.md`.

### Documentation & References

```yaml
# MUST READ — PRD section this implements
- docfile: PRD.md   # (provided in selected_prd_content §9.10.1)
  section: §9.10.1 "Supersedes the in-process agent"
  why: >
    "The previous in-process 'stagecoach LLM commit-message agent' (commit-message-agent.ts)
    and its style-learning machinery are removed in favor of this delegation." THE mandate whose
    test fallout this task mops up.
  critical: The mock TARGET moved from the agent factory to the stagecoach binary-exec boundary.

# MUST READ — the sibling CONTRACT (S1 = production delete; S2 = this task = test rewire)
- docfile: plan/015_459c7d9be558/P1M2T3S1/PRP.md
  section: "What" (DELETE src/agents/commit-message-agent.ts) + "Validation Loop"
           (test:run EXPECTED-RED on commit-message-agent.test.ts + git-commit-generate.test.ts → S2's domain)
  why: >
    S1 deleted the production module (CONFIRMED at research time: `ls` → No such file).
    S1's PRP explicitly assigns S2: delete commit-message-agent.test.ts, rewire
    git-commit-generate.test.ts, remove the dead vi.mock in protected-files.test.ts.
    Treat S1 as LANDED. S1 touches NO test file; S2 touches NO src/ file.

# MUST READ — the parallel T2.S1 CONTRACT (it rewrote generateCommitMessage + rewired git-commit.test.ts)
- docfile: plan/015_459c7d9be558/P1M2T2S1/PRP.md
  section: "Technical requirements" (generateCommitMessage → stagecoach --dry-run --single binary exec)
           + "rewires git-commit.test.ts" (the canonical fakeChild/spawnReturning spawn-mock pattern)
  why: >
    T2.S1 LANDED: generateCommitMessage now spawn()s the stagecoach binary (resolveStagecoachBinary +
    node:child_process.spawn), and git-commit.test.ts is ALREADY rewired (passes 111/111). So S2's
    clause "rewire git-commit.test.ts" is ALREADY DONE — verify, do NOT re-rewire. The spawn-mock
    pattern to mirror in git-commit-generate.test.ts IS T2.S1's git-commit.test.ts fakeChild helper.

# MUST READ — this subtask's research (THE load-bearing facts + scope correction)
- docfile: plan/015_459c7d9be558/P1M2T3S2/research/rewire-mocks-facts.md
  section: "0 (SCOPE CORRECTION: git-commit.test.ts already done — verify only)",
           "1 (module GONE — confirmed)", "2 (the binary-exec boundary to mock)",
           "3 (the fakeChild/spawnReturning pattern to mirror)", "4 (generate-test original purpose OBSOLETE; preserve auto-path value)",
           "5 (exact protected-files dead block to remove + the pre-existing line-746 failure is OUT OF SCOPE)",
           "6 (cleanup-agent comment-only)", "7 (validate now ends with docs:check; stray > already resolved)",
           "8 (the targeted green check)"
  why: >
    The single most important non-obvious fact: the work item's 3-file list is STALE — git-commit.test.ts
    is already rewired (T2.S1). The real scope is 4 files (delete/rewire/clean/optional-comment). Plus the
    exact boundary, pattern, dead block, and validation framing.

# MUST READ — the binary-exec boundary (read-only; do NOT edit)
- file: src/utils/git-commit.ts
  why: >
    generateCommitMessage (lines 307–360): `const bin = resolveStagecoachBinary();` then
    `spawn(bin, ['--dry-run','--single', ...], { cwd: repoRoot, env, stdio:['ignore','pipe','pipe'] })`,
    collecting child stdout via EventEmitters, resolving stdout.trim() on close(0), AgentError otherwise.
    `_diff` is UNUSED. THIS is the boundary the rewired integration test must mock.
  pattern: "const bin = resolveStagecoachBinary(); const argv = ['--dry-run','--single']; if (style!=='auto') argv.push('--format',style); argv.push('--provider',…); argv.push('--model',…); spawn(bin, argv, {cwd: repoRoot, …});"
  gotcha: First arg is repoRoot (cwd), NOT diff. Under auto (env unset) NO --format is pushed — assert that.

# MUST READ — the canonical spawn-mock pattern to MIRROR (read-only; do NOT edit)
- file: tests/unit/utils/git-commit.test.ts
  why: >
    T2.S1's rewired file. Lines 31–42: vi.mock stagecoach-resolver.js (→ /fake/stagecoach) + vi.mock
    node:child_process (spawn: vi.fn()). Lines 108–150: fakeChild({stdout,stderr,exitCode,spawnError})
    (EventEmitter + process.nextTick emission) + spawnReturning(opts) wrapper; wired via
    mockSpawn.mockImplementation in beforeEach. COPY this idiom into the rewired integration test.
  pattern: "function fakeChild(opts){ const child=new EventEmitter(); child.stdout=new EventEmitter(); child.stderr=new EventEmitter(); process.nextTick(()=>{ if(stdout) child.stdout.emit('data',…); child.emit('close', exitCode); }); return child; }"
  gotcha: Use mockImplementation(() => fakeChild(…)) NOT mockReturnValue — call-time creation is required
          so listeners attach before emission. Bare vi.mock factories (no top-level vars) — hoist-safe.

# THE FILE TO REWIRE
- file: tests/integration/git-commit-generate.test.ts
  why: >
    Currently 97 lines. vi.mock + vi.importActual + typed import of commit-message-agent.js → LOAD ERROR
    now (module deleted). Rewire per "B" above. Original BUG-001 purpose is obsolete (getRecentCommitMessages
    removed from generateCommitMessage). Preserve "auto config path" value via the stagecoach argv assertions.
  gotcha: generateCommitMessage(repoRoot, _diff?) — call with dir, NOT a diff string. Drop the process.cwd spy.

# THE FILE TO CLEAN (dead mock)
- file: tests/unit/protected-files.test.ts
  why: >
    Remove ONLY the dead vi.mock('…/commit-message-agent.js') block + its stale comment (~lines 29–35).
    The line-746 staging failure is PRE-EXISTING (M1.T3 collateral) and OUT OF SCOPE — do not touch it.
  gotcha: The mock is factory-only (no typed import) → removing it changes NO runtime behavior; pure dead-code removal.

# CONFIG FILES THAT DEFINE THE GATE (read-only)
- file: tsconfig.build.json
  why: include ["src/**/*"], exclude […, "tests"]. So `npm run typecheck` IGNORES tests → dangling test
       imports were never caught by typecheck; the load error surfaces only at `vitest run`.
- file: package.json
  why: scripts.test:run = `vitest run`; scripts.validate = `lint && format:check && typecheck && test:run && docs:check`
       (docs:check = `tsx scripts/check-docs.ts` is NEW at the tail). A red test:run halts before docs:check.

# OPTIONAL comment cleanup
- file: tests/unit/agents/cleanup-agent.test.ts
  why: Comment-only refs (lines 9, 12, 26 @see dangle, 111). Inert; optional accuracy cleanup. Not required for green.
```

### Current Codebase tree (relevant slice)

```bash
src/agents/commit-message-agent.ts                       # DELETED (S1 ran) — confirmed gone
src/utils/git-commit.ts                                  # READ-ONLY — generateCommitMessage spawn boundary (T2.S1)
src/utils/stagecoach-resolver.ts                         # READ-ONLY — resolveStagecoachBinary() (T1.S1)
tests/unit/agents/commit-message-agent.test.ts           # ← DELETE (tests only the deleted module)
tests/integration/git-commit-generate.test.ts            # ← REWIRE to stagecoach binary boundary (load-broken now)
tests/unit/protected-files.test.ts                       # ← CLEAN dead vi.mock (line-746 staging failure = pre-existing, out of scope)
tests/unit/agents/cleanup-agent.test.ts                  # ← OPTIONAL comment refresh (dangling @see)
tests/unit/utils/git-commit.test.ts                      # VERIFY ONLY (T2.S1 rewired; passes 111/111) — do NOT edit
plan/015_459c7d9be558/P1M2T3S2/research/rewire-mocks-facts.md   # THIS ITEM'S RESEARCH NOTE
```

### Desired Codebase tree with files to be added

```bash
# NO new files. One deletion + two edits + one optional comment edit:
tests/unit/agents/commit-message-agent.test.ts           # DELETED
tests/integration/git-commit-generate.test.ts            # REWIRED (stagecoach binary boundary mocks + auto-path assertions + rationale comment)
tests/unit/protected-files.test.ts                       # dead commit-message-agent vi.mock + stale comment REMOVED (nothing else changed)
tests/unit/agents/cleanup-agent.test.ts                  # (optional) stale @see/comments refreshed
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — git-commit.test.ts is ALREADY REWIRED by T2.S1 (passes 111/111; zero agent refs;
//   mocks stagecoach-resolver.js + node:child_process.spawn). DO NOT edit it. The work item's
//   clause "(b) rewire git-commit.test.ts" is ALREADY SATISFIED — verify only. Re-rewiring collides
//   with T2.S1's landed work. (research §0.)

// CRITICAL — the production module is GONE (S1 ran). Any test that IMPORTS it (typed) fails to LOAD
//   under vitest: "Failed to load url … commit-message-agent.js … Does the file exist?" So:
//   commit-message-agent.test.ts → DELETE; git-commit-generate.test.ts → REWIRE. A factory-only
//   vi.mock with NO typed import (protected-files.test.ts) does NOT break the load — it's dead, clean it.
//   (research §1/§5.)

// CRITICAL — the mock TARGET is the stagecoach BINARY-EXEC boundary, NOT the deleted agent factory.
//   generateCommitMessage calls resolveStagecoachBinary() then spawn(bin, argv, …). Mock BOTH:
//   vi.mock('<path>/stagecoach-resolver.js', () => ({ resolveStagecoachBinary: vi.fn() })) AND
//   vi.mock('node:child_process', () => ({ spawn: vi.fn() })). Mirror T2.S1's fakeChild/spawnReturning
//   helper (git-commit.test.ts 108–150). (research §2/§3.)

// CRITICAL — vi.mock factories must be HOIST-SAFE: no top-level variables referenced inside the
//   factory (vitest hoists vi.mock above imports). Return a BARE vi.fn() from the factory and wire the
//   implementation in beforeEach via mockSpawn.mockImplementation(…). T2.S1's git-commit.test.ts does
//   exactly this — copy the discipline. (research §3.)

// CRITICAL — use mockImplementation(() => fakeChild(…)), NOT mockReturnValue(fakeChild(…)). The child
//   must be CREATED at spawn-call time (after generateCommitMessage attaches its stdout/close listeners
//   synchronously following spawn()), and emission deferred via process.nextTick so listeners attach
//   before emit. mockReturnValue would create the child once at setup and emit before listeners exist.
//   (research §3; git-commit.test.ts fakeChild JSDoc.)

// CRITICAL — generateCommitMessage(repoRoot, _diff?) signature: FIRST arg is repoRoot (cwd), NOT diff.
//   _diff is UNUSED (stagecoach reads the real index itself). The old test call
//   generateCommitMessage('diff …') must become generateCommitMessage(dir). The process.cwd spy is
//   no longer needed (the getRecentCommitMessages→validateRepositoryPath→cwd path is gone). (research §4.)

// CRITICAL — the integration test's ORIGINAL purpose (BUG-001: getRecentCommitMessages maxEntries vs
//   maxCount) is OBSOLETE — T2.S1 removed getRecentCommitMessages from generateCommitMessage. Do NOT
//   try to preserve that scenario. Preserve the "auto config path" value instead: assert the spawn argv
//   has --dry-run + --single and NO --format under auto, and returns the canned stdout. (research §4.)

// CRITICAL — protected-files.test.ts has a PRE-EXISTING failure at line 746 (a staging-behavior
//   assertion: mockGitAdd.toHaveBeenCalledWith({files:[…'tasks.json'…]})). It is M1.T3 smartCommit-rewrite
//   collateral, UNRELATED to commit-message-agent. DO NOT fix it — it's another task's domain. Removing
//   the dead vi.mock does NOT affect it. (research §5.)

// CRITICAL — the work item says "All tests green (except the known stray > bug … fixed in P1.M3.T2.S1)."
//   The stray-`>` bug is ALREADY RESOLVED in the current tree (0 `>`-ending toBe matches; git-commit.test.ts
//   passes 111/111). The remaining commit-area red is the protected-files.test.ts:746 staging failure
//   (pre-existing, unrelated). Do NOT chase the stray `>` — it's gone. (research §7.)

// GOTCHA — validate now ENDS with `docs:check` (tsx scripts/check-docs.ts). test:run precedes it, so a
//   red test halts the chain before docs:check. The DOCS contract for THIS task is test-file-level comments
//   (not docs/*.md) — add a rationale comment in the rewired git-commit-generate.test.ts. (research §7.)

// GOTCHA — typecheck EXCLUDES tests (tsconfig.build.json). So typecheck will NOT flag the rewired test's
//   imports — only `vitest run` exercises them. Always validate test changes with `npx vitest run <file>`,
//   not typecheck. (research §7.)

// GOTCHA — run `npm run fix` (prettier --write) after editing the test files, then `npm run format:check`.
//   prettier owns formatting across *.ts incl. tests.
```

---

## Implementation Blueprint

### Data models and structure

None. This is test-only: one deletion, one rewrite of a test file's mock layer, one
dead-mock removal, optional comment edits. No types, no schemas, no production symbols.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: DELETE tests/unit/agents/commit-message-agent.test.ts
  - ACTION: delete the entire file. It tests only src/agents/commit-message-agent.ts (deleted by S1);
    it now fails to load. No other file imports from it (the dangling @see in cleanup-agent.test.ts is
    a comment, handled in Task 4).
  - VERIFY: grep -rln "commit-message-agent.test" tests/   # only cleanup-agent.test.ts COMMENT (Task 4)

Task 2: REWIRE tests/integration/git-commit-generate.test.ts (the load-broken integration test)
  - REPLACE the vi.mock('../../src/agents/commit-message-agent.js', async () => {…importActual…}) +
    `import { createCommitMessageAgent }` with:
      vi.mock('../../src/utils/stagecoach-resolver.js', () => ({ resolveStagecoachBinary: vi.fn(() => '/fake/stagecoach') }));
      vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
  - IMPORTS: `import { spawn } from 'node:child_process';`, `import { resolveStagecoachBinary } from '../../src/utils/stagecoach-resolver.js';`,
    `import { EventEmitter } from 'node:events';`. Keep `import { generateCommitMessage } from '../../src/utils/git-commit.js';`.
    REMOVE the createCommitMessageAgent import + mockCreateCommitMessageAgent.
  - ADD a fakeChild helper (EventEmitter + process.nextTick emission) mirroring git-commit.test.ts:108–150
    (copy the idiom; a minimal success-only variant is fine for this single test).
  - beforeEach: delete PRP_COMMIT_STYLE / PRP_COMMIT_STYLE_EXAMPLES env; mockResolveStagecoachBinary.mockReturnValue('/fake/stagecoach');
    mockSpawn.mockImplementation(() => fakeChild({ stdout: 'feat: generated commit message\n' })).
    Keep a minimal real temp git repo (one commit) so repoRoot/dir is a valid cwd (preserves integration character).
    DROP the process.cwd spy (obsolete path).
  - TEST BODY: const result = await generateCommitMessage(dir);
      expect(result).toBe('feat: generated commit message');
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      const argv = mockSpawn.mock.calls[0][1] as string[];
      expect(argv).toEqual(expect.arrayContaining(['--dry-run', '--single']));
      expect(argv).not.toContain('--format');   // auto → stagecoach native default applies
  - DOCS: add/keep a test-file top comment noting the mock rewiring rationale (in-process agent removed
    per §9.10.1; mocks now target the stagecoach binary boundary, not the deleted factory).
  - NAMING/PLACEMENT: keep the file at tests/integration/git-commit-generate.test.ts; keep the describe block name.

Task 3: CLEAN tests/unit/protected-files.test.ts (remove dead mock ONLY)
  - REMOVE the block (comment + vi.mock):
      // Mock the stagecoach commit-message agent factory so the default-path …
      // import chain (git-commit.ts → commit-message-agent.ts → agent-factory.ts, …).
      vi.mock('../../src/agents/commit-message-agent.js', () => ({ createCommitMessageAgent: vi.fn() }));
  - DO NOT touch any other line in protected-files.test.ts. The line-746 staging failure is pre-existing
    (M1.T3 collateral) and out of scope.
  - VERIFY after edit: npx vitest run tests/unit/protected-files.test.ts  → same line-746 failure as before
    (no NEW failure introduced by removing the dead mock).

Task 4 (OPTIONAL): refresh stale comments in tests/unit/agents/cleanup-agent.test.ts
  - Lines 9, 12, 26 (`@see {@link ./commit-message-agent.test.ts}` — dangles once Task 1 deletes it), 111.
    Comments are inert; this is accuracy cleanup only. Reword to past tense / drop the dangling @see.
  - NOT required for green; skip if it risks churn.

Task 5: FORMAT + VERIFY (the gate)
  - RUN: npm run fix   (prettier --write on the edited test files)
  - RUN: npm run lint && npm run format:check && npm run typecheck    # GREEN (tests excluded from typecheck; edits clean)
  - RUN: npx vitest run tests/integration/git-commit-generate.test.ts  # GREEN (rewired)
  - RUN: npx vitest run tests/unit/utils/git-commit.test.ts            # GREEN 111/111 (UNTOUCHED — confirm T2.S1 still green)
  - RUN: npx vitest run tests/unit/protected-files.test.ts             # same pre-existing line-746 failure (no NEW failure)
  - RUN: grep -rln "commit-message-agent\|createCommitMessageAgent\|buildCommitMessageSystemPrompt" tests/   # ZERO
  - RUN: git diff --name-only   # expect ONLY test files (no src/)
  - EXPECTED: git-commit-generate.test.ts GREEN; commit-message-agent.test.ts gone; protected-files.test.ts
    dead mock gone (line-746 pre-existing failure unchanged); git-commit.test.ts untouched+green; grep ZERO.
  - NOTE: the FULL `npm run validate` may still be RED if the pre-existing protected-files.test.ts:746 failure
    (or any other pre-existing red) blocks test:run → docs:check. That pre-existing red is NOT this task's
    regression. This task's gate = the targeted checks above (rewired file green; no NEW failure; grep ZERO).
```

### Implementation Patterns & Key Details

```ts
// ---- Task 2: the rewired tests/integration/git-commit-generate.test.ts (reference) ----
// Mirrors T2.S1's git-commit.test.ts spawn-mock idiom (fakeChild + bare vi.mock factories).
// Preserves the "auto config path" value: under default config, stagecoach is invoked with
// --dry-run --single and NO --format (stagecoach's native history-learned auto applies).

/**
 * Integration test for `generateCommitMessage` under the DEFAULT `auto` config (PRD §9.10.1).
 *
 * @remarks
 * Mock-rewiring note (P1.M2.T3.S2 / §9.10.1): the in-process commit-message agent
 * (`commit-message-agent.ts`) was REMOVED in favor of delegating to the `stagecoach`
 * binary. This test therefore mocks the binary-exec BOUNDARY — the stagecoach resolver
 * (`resolveStagecoachBinary`) + `node:child_process.spawn` — NOT the deleted agent
 * factory. Under the default `auto` config (`PRP_COMMIT_STYLE` unset),
 * `generateCommitMessage` must invoke stagecoach with `--dry-run --single` and NO
 * `--format` (stagecoach's native history-learned auto applies), returning its stdout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { simpleGit } from 'simple-git';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';

// Mock the stagecoach binary resolver so generateCommitMessage never looks for a real native binary.
// Bare factory (hoist-safe); return value wired in beforeEach.
vi.mock('../../src/utils/stagecoach-resolver.js', () => ({
  resolveStagecoachBinary: vi.fn(() => '/fake/stagecoach'),
}));

// Mock node:child_process.spawn so generateCommitMessage never execs a real process.
// Implementation wired in beforeEach (mirrors tests/unit/utils/git-commit.test.ts).
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { generateCommitMessage } from '../../src/utils/git-commit.js';
import { spawn } from 'node:child_process';
import { resolveStagecoachBinary } from '../../src/utils/stagecoach-resolver.js';

const mockSpawn = vi.mocked(spawn);
const mockResolveStagecoachBinary = vi.mocked(resolveStagecoachBinary);

// Minimal fake child: emits stdout 'data' then 'close'(0). Mirrors git-commit.test.ts fakeChild,
// deferring emission via process.nextTick so listeners attach before emit.
function fakeChild(stdout: string): EventEmitter {
  const child = new EventEmitter();
  (child as { stdout: EventEmitter }).stdout = new EventEmitter();
  (child as { stderr: EventEmitter }).stderr = new EventEmitter();
  process.nextTick(() => {
    (child as { stdout: EventEmitter }).stdout.emit('data', Buffer.from(stdout));
    child.emit('close', 0);
  });
  return child;
}

describe('generateCommitMessage — default auto config (stagecoach binary boundary mocked)', () => {
  let dir: string;

  beforeEach(async () => {
    // DEFAULT config (env unset → auto): the path under test.
    delete process.env.PRP_COMMIT_STYLE;
    delete process.env.PRP_COMMIT_STYLE_EXAMPLES;

    mockResolveStagecoachBinary.mockReturnValue('/fake/stagecoach');
    mockSpawn.mockImplementation((() => fakeChild('feat: generated commit message\n')) as never);

    // Real temp repo so repoRoot (cwd passed to spawn) is a valid dir (preserves integration character).
    dir = mkdtempSync(join(tmpdir(), 'commit-stagecoach-e2e-'));
    const git = simpleGit(dir);
    await git.init();
    await git.addConfig('user.email', 'test@test.com');
    await git.addConfig('user.name', 'Test');
    writeFileSync(join(dir, 'file.txt'), 'content\n');
    await git.add('.');
    await git.commit('feat: example commit');
  });

  afterEach(() => {
    mockSpawn.mockReset();
    mockResolveStagecoachBinary.mockReset();
    rmSync(dir, { recursive: true, force: true });
  });

  it('invokes stagecoach --dry-run --single (no --format under auto) and returns stdout (PRD §9.10.1)', async () => {
    const result = await generateCommitMessage(dir);
    expect(result).toBe('feat: generated commit message');

    // Auto path: spawn called once with --dry-run --single and NO --format.
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const argv = mockSpawn.mock.calls[0][1] as string[];
    expect(argv).toEqual(expect.arrayContaining(['--dry-run', '--single']));
    expect(argv).not.toContain('--format');
  });
});
```

```ts
// ---- Task 3: the exact block to REMOVE from tests/unit/protected-files.test.ts ----
// (comment + vi.mock — currently ~lines 29–35). The import chain it cites is broken
// (git-commit.ts → commit-message-agent.ts was cut by T2.S1) and the module is deleted (S1).
//   // Mock the stagecoach commit-message agent factory so the default-path
//   // smartCommit (no options) never instantiates a real agent via the static
//   // import chain (git-commit.ts → commit-message-agent.ts → agent-factory.ts,
//   // which constructs `new GitMCP()` at module eval).
//   vi.mock('../../src/agents/commit-message-agent.js', () => ({
//     createCommitMessageAgent: vi.fn(),
//   }));
// → delete the above 7 lines. Leave every other line in protected-files.test.ts untouched.
```

### Integration Points

```yaml
TEST EDITS (no src/ changes):
  - tests/unit/agents/commit-message-agent.test.ts        # DELETED
  - tests/integration/git-commit-generate.test.ts         # REWIRED: vi.mock stagecoach-resolver.js + node:child_process;
                                                           #   fakeChild helper; generateCommitMessage(dir); auto-path argv assertions; rationale comment
  - tests/unit/protected-files.test.ts                    # dead commit-message-agent vi.mock + stale comment REMOVED (only)
  - tests/unit/agents/cleanup-agent.test.ts               # (optional) stale @see/comments refreshed

NOT TOUCHED (hard boundary):
  - src/** (S1/T2.S1 own production; this task is test-only)
  - tests/unit/utils/git-commit.test.ts (T2.S1 rewired; passes 111/111 — verify only)
  - protected-files.test.ts line-746 staging assertion (pre-existing M1.T3 failure; out of scope)
  - any docs/*.md (DOCS = test-file-level comments only)
  - PRD.md, tasks.json, package.json, tsconfig*, vitest.config.ts
```

---

## Validation Loop

> **Read this before judging S2 "failed".** S2 is the test-half of T3. Its gate is
> **targeted**: the rewired `git-commit-generate.test.ts` is GREEN; `commit-message-agent.test.ts`
> is gone; the dead mock in `protected-files.test.ts` is removed; `git-commit.test.ts` is
> untouched and GREEN; and **zero** test references to the deleted module remain. The
> pre-existing `protected-files.test.ts:746` staging failure (M1.T3 collateral, unrelated
> to commit-message-agent) is **left untouched** — it is not this task's regression. The
> full `npm run validate` may still be RED on that pre-existing failure; that does NOT
> mean S2 failed.

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix            # prettier --write on the edited test files
npm run lint           # eslint . --ext .ts — GREEN (edits are clean; no unused imports introduced)
npm run format:check   # prettier --check — GREEN
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — GREEN (build program = src/ only; tests EXCLUDED → the
                       #   rewired test imports are NOT typechecked here; validate them via vitest below)
# Expected: all GREEN. typecheck ignores tests by design (tsconfig.build.json excludes them).
```

### Level 2: Targeted Test Runs (the S2 gate)

```bash
# The rewired integration test — MUST be GREEN:
npx vitest run tests/integration/git-commit-generate.test.ts

# The big unit test — UNTOUCHED, confirm T2.S1 still green:
npx vitest run tests/unit/utils/git-commit.test.ts          # 111/111

# protected-files: dead mock removed; the line-746 staging failure is PRE-EXISTING (unchanged):
npx vitest run tests/unit/protected-files.test.ts           # same line-746 failure as before; NO new failure

# Expected: git-commit-generate.test.ts GREEN; git-commit.test.ts GREEN (111/111);
#   protected-files.test.ts has ONLY its pre-existing line-746 failure (removing the dead mock
#   introduced no new failure). If protected-files.test.ts gains a NEW failure after the dead-mock
#   removal, debug it — but the line-746 staging assertion must NOT be "fixed" here.
```

### Level 3: Completion Verification (the grep gate)

```bash
# Every test reference to the deleted module must be gone:
grep -rln "commit-message-agent\|createCommitMessageAgent\|buildCommitMessageSystemPrompt" tests/    # ZERO
# (cleanup-agent.test.ts may still have COMMENT refs if Task 4 was skipped — comments are inert;
#  if Task 4 was done, zero matches including comments.)

# Only test files changed (no src/):
git diff --name-only        # expect ONLY: (deletion) tests/unit/agents/commit-message-agent.test.ts
                             #               + tests/integration/git-commit-generate.test.ts
                             #               + tests/unit/protected-files.test.ts
                             #               + (optional) tests/unit/agents/cleanup-agent.test.ts
# Expected: grep ZERO (or comment-only in cleanup-agent if Task 4 skipped); diff limited to test files.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No runtime/CLI behavior change (production untouched). Domain checks (record in commit message):
#   1. commit-message-agent.test.ts is gone; the suite no longer collects a load-broken file.
#   2. git-commit-generate.test.ts loads + passes, mocking the stagecoach binary boundary
#      (resolveStagecoachBinary + spawn), asserting the auto path (no --format). Its obsolete
#      BUG-001 maxEntries/maxCount scenario (getRecentCommitMessages removed by T2.S1) is gone.
#   3. protected-files.test.ts dead commit-message-agent vi.mock removed; the line-746 staging
#      failure is pre-existing (M1.T3) and untouched.
#   4. git-commit.test.ts UNTOUCHED (T2.S1 rewired it; passes 111/111).
#   5. No src/ file modified (S1/S2 boundary respected; T3 = S1 production + S2 tests).
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npm run lint` GREEN; `npm run format:check` GREEN; `npm run typecheck` GREEN.
- [ ] `npx vitest run tests/integration/git-commit-generate.test.ts` GREEN (rewired).
- [ ] `npx vitest run tests/unit/utils/git-commit.test.ts` GREEN 111/111 (untouched).
- [ ] `npx vitest run tests/unit/protected-files.test.ts` has ONLY the pre-existing line-746
      failure (no NEW failure from the dead-mock removal).
- [ ] `grep -rln "commit-message-agent\|createCommitMessageAgent\|buildCommitMessageSystemPrompt" tests/` → ZERO (or comment-only in cleanup-agent if Task 4 skipped).
- [ ] `git diff --name-only` = test files only (no `src/`).

### Feature Validation

- [ ] `tests/unit/agents/commit-message-agent.test.ts` deleted.
- [ ] `tests/integration/git-commit-generate.test.ts` rewired to the stagecoach binary boundary
      (`resolveStagecoachBinary` + `node:child_process.spawn`); auto-path assertions (no `--format`);
      rationale comment present.
- [ ] `tests/unit/protected-files.test.ts` dead `vi.mock('…/commit-message-agent.js')` + stale comment removed.
- [ ] `tests/unit/utils/git-commit.test.ts` UNCHANGED (verify-only).
- [ ] No NEW test failures introduced.

### Code Quality Validation

- [ ] Mirrors T2.S1's `fakeChild`/bare-`vi.mock` spawn-mock idiom (consistency with git-commit.test.ts).
- [ ] vi.mock factories are hoist-safe (no top-level vars); `mockImplementation` (not `mockReturnValue`).
- [ ] Test-file-level comment noting the mock-rewiring rationale (DOCS contract).
- [ ] Additive/scoped edits only — no production change; no unrelated test edited.

### Documentation & Deployment

- [ ] Test-file-level rationale comment present in `git-commit-generate.test.ts` (in-process agent
      removed per §9.10.1; mocks target the stagecoach binary boundary).
- [ ] Commit message notes: deleted commit-message-agent.test.ts; rewired git-commit-generate.test.ts
      to the stagecoach binary boundary (mirroring T2.S1's git-commit.test.ts); removed the dead mock
      in protected-files.test.ts; verified git-commit.test.ts already rewired by T2.S1; the
      protected-files line-746 failure is pre-existing (M1.T3) and out of scope.

---

## Anti-Patterns to Avoid

- ❌ Don't re-rewire `git-commit.test.ts` — T2.S1 ALREADY did it (passes 111/111; zero agent refs;
      mocks stagecoach-resolver + child_process.spawn). The work item's clause "(b)" is satisfied.
      Verify only; editing it collides with T2.S1. (research §0.)
- ❌ Don't mock the deleted `commit-message-agent` factory anywhere — it's gone. The mock TARGET is the
      stagecoach binary-exec boundary (`resolveStagecoachBinary` + `node:child_process.spawn`). (research §2.)
- ❌ Don't reference top-level variables inside a `vi.mock` factory — vitest hoists `vi.mock` above
      imports. Return a BARE `vi.fn()` and wire the implementation in `beforeEach`. (research §3.)
- ❌ Don't use `mockReturnValue(fakeChild(…))` — the child must be created at spawn-call time (after
      `generateCommitMessage` attaches its listeners). Use `mockImplementation(() => fakeChild(…))` with
      `process.nextTick`-deferred emission. (research §3.)
- ❌ Don't call `generateCommitMessage('diff …')` — the first arg is now **repoRoot** (cwd), not diff
      (`_diff` is unused). Call `generateCommitMessage(dir)`. Drop the obsolete `process.cwd` spy.
      (research §4.)
- ❌ Don't try to preserve the BUG-001 `maxEntries`/`maxCount` scenario — `getRecentCommitMessages` was
      removed from `generateCommitMessage` by T2.S1. Preserve the "auto config path" value via the
      stagecoach argv assertions (no `--format` under auto). (research §4.)
- ❌ Don't "fix" the `protected-files.test.ts:746` staging failure — it's pre-existing M1.T3 collateral,
      unrelated to commit-message-agent. Remove ONLY the dead `vi.mock` block. (research §5.)
- ❌ Don't chase the "stray `>` bug" — it's already resolved (git-commit.test.ts passes 111/111; zero
      `>`-ending assertions). The work item's caveat is stale. (research §7.)
- ❌ Don't edit any `src/` file — S1 owns production; S2 is test-only. (S1/S2 boundary.)
- ❌ Don't expect `npm run typecheck` to validate the rewired test — it excludes `tests/`. Always run
      `npx vitest run <file>` for test changes. (research §7.)
- ❌ Don't edit `docs/*.md` — the DOCS contract is test-file-level comments only (add the rationale
      comment in `git-commit-generate.test.ts`).

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a test-only mop-up (1 delete + 1 rewire + 1 dead-mock removal + optional
comments) whose scope is precisely pinned by direct inspection: the production module is already
gone (S1 ran), `git-commit.test.ts` is already rewired (T2.S1, passes 111/111 — verify only), and
the remaining real work is exactly 3 files. The rewired integration test has a complete reference
implementation that mirrors T2.S1's canonical `fakeChild`/bare-`vi.mock` spawn-mock idiom (copied
from `git-commit.test.ts`), correctly handles the signature change (`generateCommitMessage(dir)`,
not diff), and preserves the "auto config path" value via concrete argv assertions (no `--format`
under auto). The exact dead-mock block to remove from `protected-files.test.ts` is quoted verbatim.
The genuinely non-obvious risks are pre-empted: (1) the stale work-item clause "rewire
git-commit.test.ts" (already done — flagged as verify-only); (2) the obsolete BUG-001 purpose of
the integration test (reframed to the auto-path); (3) the pre-existing `protected-files.test.ts:746`
failure (explicitly out of scope, with the proof that dead-mock removal doesn't affect it); (4) the
already-resolved stray-`>` (don't chase it); (5) the hoist-safe `vi.mock` discipline + `mockImplementation`
(not `mockReturnValue`). The completion grep (`tests/` → zero deleted-module refs) is unambiguous.
Residual risks: a prettier reflow (auto-fixed by `npm run fix`) and the optional cleanup-agent
comment edit (inert if skipped). No production change means no behavioral regression is possible.