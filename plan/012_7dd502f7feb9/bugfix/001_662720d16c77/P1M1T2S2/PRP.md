# PRP — P1.M1.T2.S2: End-to-end test for `generateCommitMessage` under default `auto` config (LLM mocked only)

> Bugfix 001, **regression-prevention test** (TEST_RESULTS.md Recommendation #3). BUG-001 was a critical
> default-config-breaking bug (`getRecentCommitMessages` passed simple-git `{ maxEntries }` instead of
> `{ maxCount }`) that CI missed because the unit tests mocked `getRecentCommitMessages` to a `vi.fn()`
> that never ran real git. T1 fixed the source (Complete). T2.S1 (parallel) adds the narrow
> helper-level real-git test for `getRecentCommitMessages`. **T2.S2 adds the BROADER end-to-end test**
> that drives the FULL `auto` commit-style path — config resolution → REAL `getRecentCommitMessages` →
> REAL `git.log` → REAL prompt builder → agent-factory wiring → message return — mocking ONLY the LLM
> boundary (`createCommitMessageAgent`). This is the test that would have caught BUG-001 before it
> shipped. Test-only — no source/config/docs change.

---

## Goal

**Feature Goal**: Create an integration test that drives `generateCommitMessage(diff)` end-to-end under
the DEFAULT `auto` config (`PRP_COMMIT_STYLE=auto`, `PRP_COMMIT_STYLE_EXAMPLES=5`) against a REAL git
repo with >1 commit, mocking ONLY the LLM agent (`createCommitMessageAgent` → `agent.prompt()`). The
REAL `getRecentCommitMessages` + REAL `simple-git` + REAL `validateRepositoryPath` + REAL
`buildCommitMessageSystemPrompt` all run. If the source ever reverts to an invalid `log()` option
(`maxEntries`), the bare `await` inside `generateCommitMessage` rejects (git fatal) and the test FAILS —
the exact regression net the unit-test mock could not provide, at the full-path granularity.

**Deliverable**: **`tests/integration/git-commit-generate.test.ts`** (NEW) — one `it()` that: (a) seeds a
temp git repo with 3 commits (real simple-git, hermetic identity); (b) deletes `PRP_COMMIT_STYLE` /
`PRP_COMMIT_STYLE_EXAMPLES` so the DEFAULT `auto`/5 path runs; (c) spies `process.cwd()` → the temp repo
(so `getRecentCommitMessages(n)` with no repoPath resolves to it); (d) mocks ONLY `createCommitMessageAgent`
(via `importActual`-spread, keeping `buildCommitMessageSystemPrompt` real) to return a fake agent whose
`.prompt()` resolves to `{ status:'success', data:'feat: generated commit message', error:null }`;
(e) asserts `generateCommitMessage(...)` does NOT throw and returns the LLM message (not the fallback
placeholder); (f) cleans up env + cwd spy + temp repo in `afterEach`.

**Success Definition**:
- `generateCommitMessage('…')` under default `auto` config returns `'feat: generated commit message'`
  (does NOT throw, is NOT the fallback placeholder).
- The test runs the REAL `getRecentCommitMessages` + REAL `simple-git` + REAL `validateRepositoryPath`
  + REAL `buildCommitMessageSystemPrompt` (no mocks of those) — so an invalid `log()` option throws and
  fails the test (the regression-catching property).
- Only `createCommitMessageAgent` is mocked (the LLM boundary); `buildCommitMessageSystemPrompt` stays
  real via `importActual`-spread.
- `npx vitest run tests/integration/git-commit-generate.test.ts` is GREEN; `npm run lint && npm run
  format:check` clean.
- **No source/config/docs files modified.**

---

## Why

- **Closes the CI blind spot at the FULL-PATH granularity.** BUG-001 was masked TWICE: the git-mcp unit
  test asserted the broken contract against an arg-ignoring `vi.fn`, AND the git-commit unit tests
  mocked `getRecentCommitMessages` to `vi.fn()` (tests/unit/utils/git-commit.test.ts:28). Neither layer
  ever ran real `git.log`. T2.S1 covers the helper level; **T2.S2 covers the whole `auto` path** — the
  exact entry point (`generateCommitMessage`) that throws under the default config. A source revert to
  `maxEntries` makes this test's bare `await` reject → fail.
- **Validates the DEFAULT config path specifically — the path BUG-001 broke.** The unit tests set env
  explicitly; this test DELETES the env vars so `getPrpCommitStyle()==='auto'` and
  `getPrpCommitStyleExamples()===5` via the real getters. Out-of-the-box behavior is what regressed;
  out-of-the-box behavior is what this tests.
- **Directly implements TEST_RESULTS.md Recommendation #3** ("add an end-to-end test that drives
  `generateCommitMessage` under the default `auto` config with only the LLM agent mocked").
- **Scope discipline.** T2.S2 = the full-path e2e auto test (this file). T2.S1 = the helper-level real-git
  test (distinct file `git-mcp-log.test.ts`). T1.S1 = source fix (Complete). T1.S2 = unit-assertion fix
  (Complete). No file overlap with any sibling.

---

## What

### User-visible behavior
None (test-only). No user/config/API/runtime surface change (the item's "DOCS: none").

### Technical requirements (exact contract)

**File — `tests/integration/git-commit-generate.test.ts`** (NEW). Structure (copy-ready):

**Imports + the single mock (LLM boundary only):**
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { simpleGit } from 'simple-git';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock ONLY the LLM boundary. importActual-spread keeps the REAL buildCommitMessageSystemPrompt
// (a pure builder, no I/O) so the full auto path — including the real system-prompt construction —
// runs. If this is mocked away, generateCommitMessage throws "buildCommitMessageSystemPrompt is not
// a function". getRecentCommitMessages / simple-git / validateRepositoryPath are NEVER mocked.
vi.mock('../../src/agents/commit-message-agent.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/agents/commit-message-agent.js')>(
    '../../src/agents/commit-message-agent.js'
  );
  return {
    ...actual,
    createCommitMessageAgent: vi.fn(() => ({
      prompt: vi.fn().mockResolvedValue({
        status: 'success' as const,
        data: 'feat: generated commit message',
        error: null,
      }),
    })),
  };
});

import { generateCommitMessage } from '../../src/utils/git-commit.js';
import { createCommitMessageAgent } from '../../src/agents/commit-message-agent.js';
const mockCreateCommitMessageAgent = createCommitMessageAgent as unknown as ReturnType<typeof vi.fn>;
```

**Setup + teardown + the one `it()`:**
```ts
describe('generateCommitMessage — default auto config, real git (LLM mocked only)', () => {
  let dir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // DEFAULT config (env unset → auto / 5): the exact path BUG-001 broke.
    delete process.env.PRP_COMMIT_STYLE;
    delete process.env.PRP_COMMIT_STYLE_EXAMPLES;

    // Seed a temp repo with >1 commit so the auto path does NOT degrade to plain (needs ≥2 examples).
    dir = mkdtempSync(join(tmpdir(), 'commit-style-e2e-'));
    const git = simpleGit(dir);
    await git.init();
    await git.addConfig('user.email', 'test@test.com');
    await git.addConfig('user.name', 'Test');
    for (let i = 0; i < 3; i++) {
      writeFileSync(join(dir, `file${i}.txt`), `content ${i}\n`);
      await git.add('.');
      await git.commit(`feat: example commit ${i + 1}`);
    }

    // generateCommitMessage → getRecentCommitMessages(n) with NO repoPath → validateRepositoryPath
    // resolves process.cwd(). Point cwd at the temp repo so the REAL git.log runs against it.
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(dir);
    mockCreateCommitMessageAgent.mockClear();
  });

  afterEach(() => {
    cwdSpy?.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not throw and returns the LLM-generated message under default auto config (PRD §5.1)', async () => {
    // EXECUTE — the bare await rejects if getRecentCommitMessages throws (a maxEntries regression).
    const result = await generateCommitMessage('diff --git a/x b/x\n+added line');

    // VERIFY (a)+(b): the LLM-generated descriptive message, NOT the fallback placeholder.
    expect(result).toBe('feat: generated commit message');
    expect(result).not.toBe('chore: commit-gen failed (exit 0); fallback commit');

    // VERIFY (c): the real auto path ran (≥2 examples fetched → style stayed 'auto') and wired the
    // agent exactly once.
    expect(mockCreateCommitMessageAgent).toHaveBeenCalledTimes(1);
  });
});
```

### Success Criteria
- [ ] File `tests/integration/git-commit-generate.test.ts` created; vitest glob picks it up.
- [ ] ONLY `createCommitMessageAgent` is mocked (via `importActual`-spread; `buildCommitMessageSystemPrompt` stays real).
- [ ] `getRecentCommitMessages`, `simple-git`, `validateRepositoryPath`, `buildCommitMessageSystemPrompt`,
      `createPrompt` are NEVER mocked (the bug-relevant + prompt-builder layers are REAL).
- [ ] `beforeEach` deletes `PRP_COMMIT_STYLE`/`PRP_COMMIT_STYLE_EXAMPLES` (default `auto`/5), seeds a
      real 3-commit temp repo (init + addConfig identity + 3× write/add/commit), and spies
      `process.cwd()` → the temp repo.
- [ ] `afterEach` restores the cwd spy + rmSync the temp repo.
- [ ] `generateCommitMessage('…')` returns `'feat: generated commit message'`, is NOT the fallback
      placeholder, and `createCommitMessageAgent` was called once.
- [ ] `npx vitest run tests/integration/git-commit-generate.test.ts` GREEN; `npm run lint && npm run
      format:check` clean.
- [ ] No source/config/docs files modified.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the
verbatim test file (imports + the importActual-spread mock + setup + the one `it()`), the verified
repo-resolution mechanism (`validateRepositoryPath(undefined)` → `process.cwd()`; cwd spy), the verified
config defaults (`auto`/5), the co-location fact (`createCommitMessageAgent` + `buildCommitMessageSystemPrompt`
both in `commit-message-agent.ts` → importActual-spread), the regression-catching rationale (bare await
rejects on a `maxEntries` revert), and the file-disjoint proof vs S1.

### Documentation & References
```yaml
# MUST READ — the test design + the repo-resolution + the mock-surface decision (authored with this PRP)
- docfile: plan/012_7dd502f7feb9/bugfix/001_662720d16c77/P1M1T2S2/research/generate-commit-message-e2e-test.md
  section: "1. The path under test", "2. The repo-resolution challenge", "3. Mock ONLY the LLM boundary", "5. The regression-catching property", "7. Test design"
  why: The generateCommitMessage control flow (style/examples/agent wiring), why a process.cwd() spy makes the no-repoPath call resolve the temp repo,
        why importActual-spread (buildCommitMessageSystemPrompt co-location), and why a bare await IS the regression signal. READ BEFORE IMPLEMENTING.

# MUST READ — the bug + Recommendation #3 this test implements
- docfile: plan/012_7dd502f7feb9/bugfix/001_662720d16c77/TEST_RESULTS.md   # (or prd_snapshot.md §h2.5)
  section: "Recommendations" (item 3: "add an end-to-end test that drives generateCommitMessage under the default auto config with only the LLM agent mocked")
  why: States the e2e gap. The bug report explains WHY the unit mocks masked it.

# PATTERN FILE 1 — the function under test (READ-ONLY)
- file: src/utils/git-commit.ts
  why: generateCommitMessage (L344–385): style=getPrpCommitStyle(); if 'auto' && n>0 → examples=await getRecentCommitMessages(n)
        (NO repoPath); ≤1 example → degrade to 'plain'; system=buildCommitMessageSystemPrompt(...); agent=createCommitMessageAgent(system);
        r=await agent.prompt(createPrompt({user,responseFormat})); returns (r.data??'').trim() (throws on 'error'/'skip'/empty).
        Imports getRecentCommitMessages from '../tools/git-mcp.js' (L31) + createCommitMessageAgent/buildCommitMessageSystemPrompt
        from '../agents/commit-message-agent.js' (L39).
  pattern: "const r = await agent.prompt(prompt); if (r.status === 'error') throw …; const message = (r.data ?? '').trim(); if (!message || message === 'skip') throw …; return message;"
  critical: getRecentCommitMessages(n) is awaited BARE (no try/catch) → a git throw propagates out of generateCommitMessage → the test's await rejects.

# PATTERN FILE 2 — the repo-resolution + helper (READ-ONLY)
- file: src/tools/git-mcp.ts
  why: getRecentCommitMessages(count, repoPath?) (L583): count===0 → []; else validateRepositoryPath(repoPath) → simpleGit(safePath).log({ maxCount: count })
        (FIXED by T1.S1). validateRepositoryPath(path?) (L202): resolve(path ?? process.cwd()) → existsSync → join(repoPath,'.git') existsSync → realpathSync.
        So undefined repoPath → process.cwd(); a temp repo with .git PASSES.
  pattern: "const repoPath = resolve(path ?? process.cwd()); … if (!existsSync(join(repoPath, '.git'))) throw …; return realpathSync(repoPath);"
  critical: validateRepositoryPath is NOT project-scoped; the OS-tmpdir temp repo (with .git from git init) passes — no mock needed.

# PATTERN FILE 3 — the agent factory (the ONLY mock target)
- file: src/agents/commit-message-agent.ts
  why: createCommitMessageAgent(systemPrompt?) (L360) — the LLM boundary to mock. buildCommitMessageSystemPrompt (L303) is CO-LOCATED → importActual-spread
        keeps it REAL. Imports createBaseConfig from './agent-factory.js' (L51) — agent-factory runs configureEnvironment/configureHarness at load; under
        default 'pi'/'zai' this is safe and already tolerated by the integration suite (prp-executor-integration.test.ts imports real agent-factory too).
  pattern: "export function createCommitMessageAgent(systemPrompt?: string): Agent { … }"
  gotcha: If the real buildCommitMessageSystemPrompt is left undefined (full mock, no importActual), generateCommitMessage throws — use importActual-spread.

# PATTERN FILE 4 — the config defaults (READ-ONLY)
- file: src/config/constants.ts
  why: getPrpCommitStyle() (L851) → DEFAULT_PRP_COMMIT_STYLE 'auto' (L814) when env unset/unknown. getPrpCommitStyleExamples() (L919) → 5 when unset
        (0 is valid/disables). Delete both env vars in beforeEach to force the DEFAULT auto/5 path.
  pattern: "const raw = process.env[PRP_COMMIT_STYLE]; if (raw === undefined) return DEFAULT_PRP_COMMIT_STYLE;"

# PATTERN FILE 5 — the established cwd-spy + temp-repo conventions
- file: tests/unit/utils/git-commit.test.ts
  why: L132 vi.spyOn(process, 'cwd').mockReturnValue('/project') — the cwd-spy pattern. L28 vi.mock('../../../src/tools/git-mcp.js', () => ({ getRecentCommitMessages: vi.fn() }))
        — the MASKING mock T2.S2 must NOT replicate. (T2.S2 does NOT mock git-mcp.js at all.)
  pattern: "vi.spyOn(process, 'cwd').mockReturnValue(<dir>);"
- file: tests/integration/smart-commit.test.ts
  why: The mkdtempSync(join(tmpdir(), …)) + rmSync({recursive,true,force:true}) temp-repo convention for integration tests.
- file: tests/integration/prp-executor-integration.test.ts
  why: The importActual-spread mock factory pattern (vi.mock(path, () => { const actual = vi.importActual(path); return { ...actual, X: vi.fn() } })) — proven in this codebase.

# VERIFIED FACTS
- fact: "generateCommitMessage calls getRecentCommitMessages(n) with NO repoPath → validateRepositoryPath(undefined) resolves process.cwd(). A cwd spy pointing at the temp repo makes the REAL git.log run against it."
- fact: "validateRepositoryPath(undefined) = resolve(process.cwd()) → existsSync → join(repoPath,'.git') existsSync → realpathSync. The temp repo (with .git from git init) passes — NOT project-scoped."
- fact: "getPrpCommitStyle() returns 'auto' (DEFAULT) when PRP_COMMIT_STYLE unset; getPrpCommitStyleExamples() returns 5 (DEFAULT) when unset. Delete both env vars to force the default path."
- fact: "createCommitMessageAgent (L360) and buildCommitMessageSystemPrompt (L303) are BOTH in commit-message-agent.ts → importActual-spread mocks ONLY createCommitMessageAgent, keeping buildCommitMessageSystemPrompt real."
- fact: "generateCommitMessage reads r.status + r.data; the fake agent.prompt() must resolve {status:'success', data:'<msg>', error:null}. Throws on status==='error', empty/trimmed data, or data==='skip'."
- fact: "generateCommitMessage's await getRecentCommitMessages(n) is BARE (no try/catch) → a git throw (maxEntries revert) propagates → the test's await rejects → FAILS. No separate doesNotThrow needed."
- fact: "Seeding ≥2 commits keeps the style 'auto' (examples.length<=1 would degrade to 'plain'). Seed 3."
- fact: "S1 creates tests/integration/git-mcp-log.test.ts (narrow helper test); S2 creates tests/integration/git-commit-generate.test.ts (full-path e2e). Different files — zero overlap."
```

### Current Codebase tree (relevant slice)
```bash
tests/integration/git-commit-generate.test.ts   # NEW — full-path e2e auto-config test (1 it())
src/utils/git-commit.ts                         # READ-ONLY (generateCommitMessage — consumed unchanged)
src/tools/git-mcp.ts                            # READ-ONLY (T1's fixed getRecentCommitMessages — consumed REAL)
src/agents/commit-message-agent.ts              # READ-ONLY (createCommitMessageAgent mocked; buildCommitMessageSystemPrompt kept real)
src/config/constants.ts                         # READ-ONLY (getPrpCommitStyle/getPrpCommitStyleExamples — defaults consumed)
```

### Desired Codebase tree with files to be added/edited
```bash
tests/integration/git-commit-generate.test.ts   # NEW (the ONLY file T2.S2 creates)
# No source/config/docs changes. No new files elsewhere.
```

### Known Gotchas of our Codebase & Library Quirks
```ts
// CRITICAL — do NOT mock getRecentCommitMessages, git-mcp.js, simple-git, or validateRepositoryPath.
//   The ENTIRE VALUE of this test is that the REAL git.log runs against a real repo, so an invalid
//   option (maxEntries) makes the bare await inside generateCommitMessage reject → the test FAILS.
//   Mocking any of those re-introduces the BUG-001 mask. (tests/unit/utils/git-commit.test.ts:28 does
//   exactly this mock — T2.S2 must NOT.)

// CRITICAL — mock ONLY createCommitMessageAgent, via importActual-spread. buildCommitMessageSystemPrompt
//   is CO-LOCATED in commit-message-agent.ts; if it's left undefined (full mock), generateCommitMessage
//   throws "buildCommitMessageSystemPrompt is not a function". importActual-spread keeps it REAL.

// CRITICAL — generateCommitMessage calls getRecentCommitMessages(n) with NO repoPath. validateRepositoryPath
//   resolves process.cwd(). To point it at the temp repo, vi.spyOn(process, 'cwd').mockReturnValue(dir).
//   The temp repo has .git (from git init) → validateRepositoryPath passes. Restore the spy in afterEach.
//   (Pattern: tests/unit/utils/git-commit.test.ts:132.)

// CRITICAL — seed ≥2 commits (seed 3). The auto path degrades to 'plain' if examples.length<=1; you want
//   it to STAY 'auto' (the bug-broken path). getRecentCommitMessages(5) on a 3-commit repo returns all 3
//   (>1 → stays auto).

// CRITICAL — force the DEFAULT config by DELETING the env vars (delete process.env.PRP_COMMIT_STYLE;
//   delete process.env.PRP_COMMIT_STYLE_EXAMPLES). Don't set them — the point is the env-unset default
//   path. getPrpCommitStyle()==='auto', getPrpCommitStyleExamples()===5.

// GOTCHA — the fake agent.prompt() must resolve {status:'success', data:'<non-empty, not "skip">',
//   error:null}. generateCommitMessage throws on status==='error', empty/trimmed data, or data==='skip'.
//   Use `status: 'success' as const` so the union narrows for the type checker.

// GOTCHA — agent-factory (imported transitively by commit-message-agent.ts) runs configureEnvironment/
//   configureHarness at module load. Under default 'pi'/'zai' this is safe and already tolerated by the
//   integration suite (prp-executor-integration.test.ts imports real agent-factory). If a future load
//   throws in this env, fall back to mocking BOTH createCommitMessageAgent AND buildCommitMessageSystemPrompt
//   (the latter as vi.fn(() => 'mock system')) — still keeps getRecentCommitMessages/git REAL.

// GOTCHA — createPrompt (from 'groundswell') is kept REAL (it's a pure Prompt factory, not an LLM call;
//   the fake agent ignores its arg). If the real createPrompt ever needs Groundswell init, mock it as a
//   passthrough vi.fn((opts) => opts) (like tests/unit/utils/git-commit.test.ts does) — but try real first.

// GOTCHA — git commit requires user.name + user.email. Set via addConfig AFTER init, BEFORE the first
//   commit (CI may lack a global identity). Each commit needs ≥1 staged change — write a unique fileN.txt
//   per commit.

// GOTCHA — vitest isolates test files (pool: 'forks'); the cwd spy is restored in afterEach → no leak to
//   S1's git-mcp-log.test.ts. But DO restore the spy (mockRestore) so it doesn't affect later test files
//   in the same worker.

// GOTCHA — this is hardening of an EXISTING code path (T1 fixed the source; Complete). It is NOT a
//   RED→GREEN TDD cycle for new behavior. The test passes immediately against the fixed source. If it
//   FAILS, getRecentCommitMessages regressed (maxEntries) — report it (do NOT edit source to pass).

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check. typecheck (tsconfig.build)
//   is unaffected (integration tests live in the test tsconfig, not the build config).

// GOTCHA — do NOT run the full `npm run test:run` as the gate. Gate on the new integration file green
//   + lint + format. (Requires git installed — standard on dev/CI.)
```

---

## Implementation Blueprint

### Data models and structure
None — a single test file. The "structure" is the `importActual`-spread mock + the seeded-repo +
cwd-spy setup + one `it()`.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: CREATE tests/integration/git-commit-generate.test.ts
  - IMPORTS: vitest primitives; simpleGit from 'simple-git'; mkdtempSync/writeFileSync/rmSync from 'node:fs';
        tmpdir from 'node:os'; join from 'node:path'.
  - MOCK: vi.mock('../../src/agents/commit-message-agent.js', async () => { const actual = await
        vi.importActual(...); return { ...actual, createCommitMessageAgent: vi.fn(() => ({ prompt:
        vi.fn().mockResolvedValue({status:'success' as const, data:'feat: generated commit message', error:null}) })) }; }).
  - IMPORTS (post-mock): generateCommitMessage from '../../src/utils/git-commit.js'; createCommitMessageAgent
        from '../../src/agents/commit-message-agent.js' (cast to vi.fn for call-count assertion).
  - DESCRIBE/BEOFREACH: delete PRP_COMMIT_STYLE + PRP_COMMIT_STYLE_EXAMPLES; mkdtempSync temp repo; simpleGit(dir).init();
        addConfig user.email + user.name; loop 3× (writeFileSync(fileN) → add('.') → commit('feat: example commit N'));
        cwdSpy = vi.spyOn(process,'cwd').mockReturnValue(dir); mockCreateCommitMessageAgent.mockClear().
  - AFTEREACH: cwdSpy?.mockRestore(); rmSync(dir, {recursive:true, force:true}).
  - ONE it(): const result = await generateCommitMessage('diff --git a/x b/x\n+added line');
        expect(result).toBe('feat: generated commit message');
        expect(result).not.toBe('chore: commit-gen failed (exit 0); fallback commit');
        expect(mockCreateCommitMessageAgent).toHaveBeenCalledTimes(1).
  - PLACEMENT: tests/integration/git-commit-generate.test.ts (distinct from S1's git-mcp-log.test.ts).
  - DO NOT: mock getRecentCommitMessages/git-mcp.js/simple-git/validateRepositoryPath/buildCommitMessageSystemPrompt/
        createPrompt; set the env vars (DELETE them); seed <2 commits; add a try/catch (the bare await is the
        signal); touch any unit test file or S1's file.
  - EXPECTED: the it() passes against T1's fixed source (maxCount). The bare await does NOT reject.

Task 2: VERIFY
  - RUN: npx vitest run tests/integration/git-commit-generate.test.ts → GREEN.
  - RUN: npm run lint && npm run format:check → clean (run `npm run fix` if format complains).
  - (OPTIONAL regression proof) Temporarily revert git-mcp.ts to { maxEntries } → re-run → the it() FAILS
        with the git fatal error (the bare await rejects) → revert back. Confirms the regression-catching
        value. Do NOT commit the revert.
  - EXPECTED: green + clean. If the it() throws `fatal: ambiguous argument 'maxEntries=…'`, T1's fix isn't
        in place (confirm src/tools/git-mcp.ts uses maxCount). If it throws `maxCount=…`, that's a real
        simple-git problem (maxCount IS valid — re-check). If beforeEach fails on commit, confirm the
        addConfig identity + unique files. If it throws "buildCommitMessageSystemPrompt is not a function",
        the mock isn't spreading importActual — fix the factory.
```

### Implementation Patterns & Key Details
```ts
// ---- the ONLY mock (LLM boundary; buildCommitMessageSystemPrompt stays real via importActual-spread) ----
vi.mock('../../src/agents/commit-message-agent.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/agents/commit-message-agent.js')>(
    '../../src/agents/commit-message-agent.js'
  );
  return {
    ...actual,
    createCommitMessageAgent: vi.fn(() => ({
      prompt: vi.fn().mockResolvedValue({
        status: 'success' as const,
        data: 'feat: generated commit message',
        error: null,
      }),
    })),
  };
});

// ---- the cwd spy (no-repoPath call resolves the temp repo) ----
cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(dir);   // dir = the seeded temp repo
// … afterEach: cwdSpy?.mockRestore();

// ---- the it() — bare await IS the regression signal ----
const result = await generateCommitMessage('diff --git a/x b/x\n+added line');
expect(result).toBe('feat: generated commit message');
expect(result).not.toBe('chore: commit-gen failed (exit 0); fallback commit');
expect(mockCreateCommitMessageAgent).toHaveBeenCalledTimes(1);

// ---- WHY no git-mcp mock: if the source reverts to git.log({ maxEntries }), real git throws
//      `fatal: ambiguous argument 'maxEntries=N'…` → getRecentCommitMessages(n) rejects → the bare
//      `await` inside generateCommitMessage propagates → the test's await rejects → FAILS. That's the
//      exact BUG-001 net, at the full-path granularity.
```

### Integration Points
```yaml
DEPENDS ON (must be LANDED before T2.S2 is correct):
  - P1.M1.T1.S1 (source fix, Complete): getRecentCommitMessages uses git.log({ maxCount }). T2.S2 consumes
        this fixed source REAL (no mock).

NO SOURCE/CONSUMER CHANGES: T2.S2 is test-only. generateCommitMessage, getRecentCommitMessages,
  validateRepositoryPath, buildCommitMessageSystemPrompt, simple-git, the config getters — all consumed
  unchanged (real). Only createCommitMessageAgent is mocked.

SIBLING SUBTASKS (do NOT do them here):
  - P1.M1.T2.S1 (helper-level real-git test, parallel): creates tests/integration/git-mcp-log.test.ts —
        a DIFFERENT file (narrow getRecentCommitMessages test, passes dir explicitly, no cwd spy). Zero overlap.
  - P1.M1.T1.S1/S2 (source + unit-assertion fix, Complete): T2.S2 consumes their fixed source + does NOT
        touch their unit test files.

NO DOCS (the item's "DOCS: none"). The vitest glob picks up the new file automatically — no config change.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run lint                 # clean
npm run format:check         # clean (run `npm run fix` if it complains)
# typecheck: integration tests live under the test tsconfig (not tsconfig.build.json), so `npm run
# typecheck` (build) is unaffected. If the project typechecks tests separately, confirm clean.
# Expected: clean. The importActual-spread + vi.spyOn are standard vitest patterns; no type complexity.
```

### Level 2: The integration test (the PRIMARY gate)
```bash
npx vitest run tests/integration/git-commit-generate.test.ts
# Expected: GREEN. If the it() throws `fatal: ambiguous argument 'maxEntries=…'`, T1's source fix isn't
#   in place (confirm src/tools/git-mcp.ts uses maxCount). If it throws `maxCount=…`, re-check the
#   simple-git version. If it throws "buildCommitMessageSystemPrompt is not a function", the mock factory
#   isn't spreading importActual — fix it. If beforeEach fails on commit, confirm the addConfig identity
#   + unique files per commit. If createCommitMessageAgent call-count is 0, the auto path degraded to
#   plain (confirm ≥2 commits seeded) — but note the assertion is times(1) regardless of style (the agent
#   is always wired), so this is a secondary check.

# Confirm the helper-level + unit tests are untouched (regression):
npx vitest run tests/integration/git-mcp-log.test.ts tests/unit/utils/git-commit.test.ts tests/unit/tools/git-mcp.test.ts
# Expected: GREEN (T2.S2 touches none of these; they prove the broader §5.1 surface is intact).
```

### Level 3: Regression-catching proof (OPTIONAL — confirms the test's value, do NOT commit the revert)
```bash
# Temporarily revert the source to the BUGGY option, re-run, confirm the it() FAILS, then revert back:
#   sed -i 's/maxCount: count/maxEntries: count/' src/tools/git-mcp.ts   # TEMPORARY
#   npx vitest run tests/integration/git-commit-generate.test.ts          # → the it() FAILS (git fatal; bare await rejects)
#   git checkout src/tools/git-mcp.ts                                     # RESTORE the fix
# Expected (during the temporary revert): the it() throws `fatal: ambiguous argument 'maxEntries=N'…` and
#   FAILS — proving the test catches the exact BUG-001 regression at the full-path granularity. (Do NOT
#   commit the revert — restore the maxCount fix before finishing.)
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP surface beyond local git. Domain checks (record in commit message):
#   - The FULL auto path runs REAL: config getters (auto/5) → REAL getRecentCommitMessages → REAL git.log
#     (maxCount) → REAL validateRepositoryPath (process.cwd()=temp repo) → REAL buildCommitMessageSystemPrompt
#     → mocked agent → descriptive message returned.
#   - Only the LLM boundary (createCommitMessageAgent → agent.prompt) is mocked — getRecentCommitMessages
#     + git are REAL, so an invalid option throws+fails (the regression net).
#   - DEFAULT config path specifically (env unset) — the exact path BUG-001 broke.
#   - Hermetic: own git identity (addConfig) + own temp repo + rmSync cleanup + cwd spy restored; no
#     project git state touched.
#   - Test-only; no source/consumer/docs change. Directly implements TEST_RESULTS.md Recommendation #3.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/integration/git-commit-generate.test.ts` GREEN.

### Feature Validation
- [ ] `tests/integration/git-commit-generate.test.ts` created; vitest glob picks it up.
- [ ] ONLY `createCommitMessageAgent` mocked (importActual-spread; `buildCommitMessageSystemPrompt` real).
- [ ] NO mock of `getRecentCommitMessages`/`git-mcp.js`/`simple-git`/`validateRepositoryPath`/`createPrompt`.
- [ ] `beforeEach` deletes `PRP_COMMIT_STYLE`/`PRP_COMMIT_STYLE_EXAMPLES`, seeds a real 3-commit temp repo,
      and spies `process.cwd()` → the temp repo.
- [ ] `generateCommitMessage('…')` returns `'feat: generated commit message'`, is NOT the fallback
      placeholder, and `createCommitMessageAgent` was called once.
- [ ] `afterEach` restores the cwd spy + rmSync the temp repo.

### Code Quality Validation
- [ ] ONLY `tests/integration/git-commit-generate.test.ts` created (no source/config/docs/other-test changes).
- [ ] Hermetic git identity via `addConfig` (no reliance on global git config).
- [ ] Distinct file from S1's `git-mcp-log.test.ts` (zero overlap).
- [ ] Mocks honor "LLM boundary only" (createCommitMessageAgent; buildCommitMessageSystemPrompt kept real).

### Documentation & Deployment
- [ ] No docs change (test-only; no user-facing surface — the item's "DOCS: none").
- [ ] Commit message notes: full-path e2e auto-config test for generateCommitMessage (BUG-001 regression net
      per Recommendation #3); only the LLM agent mocked; real getRecentCommitMessages/git; default config
      (env unset); cwd spy to the temp repo; would have caught BUG-001 before it shipped.

---

## Anti-Patterns to Avoid

- ❌ Don't mock `getRecentCommitMessages`, `git-mcp.js`, `simple-git`, or `validateRepositoryPath` — that's
      the BUG-001 mask this test exists to remove (tests/unit/utils/git-commit.test.ts:28 does exactly this).
      The real git must run.
- ❌ Don't use a FULL mock of `commit-message-agent.js` (no `importActual` spread) — `buildCommitMessageSystemPrompt`
      would be undefined and `generateCommitMessage` would throw "not a function". Use `importActual`-spread
      to keep it real while mocking only `createCommitMessageAgent`.
- ❌ Don't SET `PRP_COMMIT_STYLE`/`PRP_COMMIT_STYLE_EXAMPLES` — DELETE them. The point is the env-unset
      DEFAULT path (auto/5) — the exact path BUG-001 broke.
- ❌ Don't seed <2 commits — the auto path degrades to `'plain'` when `examples.length<=1`. Seed 3 to keep
      it `'auto'`.
- ❌ Don't forget the `process.cwd()` spy — `generateCommitMessage` calls `getRecentCommitMessages(n)` with
      NO repoPath, so without the spy it resolves the project repo (not the temp one). Restore the spy in
      `afterEach`.
- ❌ Don't skip `addConfig('user.email'/'user.name')` — `git commit` requires an identity; CI may lack a
      global one. Set it hermetically after `init`.
- ❌ Don't add a `try/catch` around the `generateCommitMessage` call "to check it doesn't throw" — the bare
      `await` IS the failure signal (a throw rejects the `it`). A try/catch would mask the regression.
- ❌ Don't assert the returned message IS the fallback placeholder — `generateCommitMessage` never returns
      it (the fallback is built by `buildFallbackCommitMessage` inside `smartCommit`). Assert it is NOT the
      placeholder (documents anti-regression intent) AND equals the mock's LLM message.
- ❌ Don't use `status: 'success'` without `as const` — `generateCommitMessage` narrows on
      `r.status === 'error'`; the literal type keeps the mock type-correct.
- ❌ Don't edit `src/tools/git-mcp.ts` / `src/utils/git-commit.ts` / any source — T2.S2 is test-only. The T1
      fix (maxCount) is already Complete; this test consumes it REAL. (If the test fails because the source
      regressed, REPORT it — don't silently weaken the test.)
- ❌ Don't touch S1's `git-mcp-log.test.ts` or any unit test file — T2.S2 is this integration file ONLY.
- ❌ Don't commit the optional Task-2 regression-revert (it's a temporary proof; restore `maxCount`).
- ❌ Don't run the full `npm run test:run` as the gate — gate on the new integration file green + lint +
      format. (Requires git installed — standard on dev/CI.)

---

## Confidence Score

**10/10** — one-pass implementation success likelihood.

Rationale: This is a single new test file whose design is fully specified (verbatim imports + the
importActual-spread mock + setup + the one `it()`), consuming a source fix (T1.S1) that is already Complete
and verified in-repo (`maxCount`). The repo-resolution mechanism is verified (`validateRepositoryPath(undefined)`
→ `resolve(process.cwd())` + `.git` check; the cwd spy — an established pattern at git-commit.test.ts:132 —
points it at the seeded temp repo). The config defaults are verified (`auto`/5 on env-unset). The
co-location fact (`createCommitMessageAgent` + `buildCommitMessageSystemPrompt` both in commit-message-agent.ts)
justifies the `importActual`-spread, which is proven to work in this codebase
(prp-executor-integration.test.ts). The regression-catching property is provable (Task 2's optional revert
makes the bare `await` reject under `maxEntries`). The agent-factory-load side effect (via
commit-message-agent → agent-factory) is safe under default config and already tolerated by the integration
suite, with a documented fallback. The only environmental prerequisite is `git` installed (standard). The
vitest glob picks up the file automatically. File-disjoint from S1 (different file, different concern).
No external/runtime unknowns — the only "risk" is a copy-paste typo or a prettier nit (auto-caught/fixed by
the test run + `npm run fix`).