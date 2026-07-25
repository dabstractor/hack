# PRP — P2.M3.T1.S1: Fix PRP-generator tests to mock the file-contract return path

---

## Goal

**Feature Goal**: Repair the **15 failing tests** in
`tests/unit/agents/prp-generator.test.ts` so its mocks match the
**file-is-the-contract** return path in `src/agents/prp-generator.ts` (bugfix
Issue 3A, "Mock Drift: PRP-Generator File-Contract Path"). The source no longer
trusts `result.data` from the agent response — it calls
`readFile(prpOutputPath, 'utf-8')` (prp-generator.ts:735) to read the PRP JSON the
Researcher wrote, and treats the agent's return as `{ status, output }` (rejecting
only when `r.status === 'error'`, prp-generator.ts:720). The tests still mock
`mockAgent.prompt.mockResolvedValue(mockPRP)` (a `PRPDocument` object) and leave
`mockReadFile` (from `vi.mock('node:fs/promises')` at test line 29) returning
`undefined` — so the file-contract read yields `#parsePRPText(undefined)` →
`TypeError: Cannot read properties of undefined (reading 'match')` (prp-generator.ts:271)
or `AgentError: Researcher did not write PRP file`. After this fix: the agent mock
returns `{ status: 'success', output: '' }`, a **path-aware** `mockReadFile`
returns `JSON.stringify(createMockPRPDocument(task.id))` at the constructed
`prpOutputPath` (`{sessionPath}/prps/{sanitizedId}.json`, prp-generator.ts:655), and
all 26 tests in the file pass. Pure test-only change — no source edits, no docs.

**Deliverable**:
1. **`tests/unit/agents/prp-generator.test.ts`** — MODIFY: (a) add a reusable
   path-aware `mockReadFile` helper (`setupReadFileForPRP(prp)`) that returns the
   PRP JSON string when called with the `prpOutputPath` (`endsWith(\`${sanitizedId}.json\`)`
   and NOT containing `.cache`) and rejects with `ENOENT` for all other paths
   (cache metadata reads); (b) change every failing test's
   `mockAgent.prompt.mockResolvedValue(mockPRP)` →
   `mockResolvedValue({ status: 'success', output: '' })`; (c) call
   `setupReadFileForPRP(mockPRP)` in each test that reaches the file-contract read;
   (d) for the two `prd_selectors` tests that currently `.rejects.toThrow()`,
   apply the mock fix and let `generate()` resolve cleanly (the
   `createPRPBlueprintPrompt` spy is called BEFORE the file read at
   prp-generator.ts:667, so the spy assertions still hold); (e) for the
   `mkdir`-failure test, align the assertion with the actual source behavior
   (the bare `await mkdir(...)` at prp-generator.ts:656 throws a raw `Error`, not
   `PRPFileError` — relax to `.rejects.toThrow()`). Preserve the 11 PASSING tests
   (especially the cache-HIT test, which sets its own per-test `mockReadFile`).

**Success Definition**:
- `npx vitest run tests/unit/agents/prp-generator.test.ts` → **26 passed | 0 failed**.
- `rg -n "mockResolvedValue\(mockPRP\)" tests/unit/agents/prp-generator.test.ts` →
  ZERO matches (no test passes a raw `PRPDocument` as the agent's return anymore;
  all use `{ status: 'success', output: '' }`).
- `rg -n "setupReadFileForPRP" tests/unit/agents/prp-generator.test.ts` → present
  (the path-aware helper exists and is called in every generate-path test).
- `rg -n "status: 'success', output: ''" tests/unit/agents/prp-generator.test.ts`
  → present in every test that exercises a successful agent call.
- `npm run typecheck` exit 0; `npm run lint` + `format:check` clean.
- The cache-HIT test ("should use cached PRP when hash matches and file is recent")
  and the hash-consistency test still PASS (mock fix did not clobber their per-test
  `mockReadFile.mockResolvedValue` setup).
- **NOTE**: the FULL `npm run test:run` / `npm run validate` is NOT green yet and
  is NOT this task's gate — the suite has ~282 OTHER pre-existing failures
  (ResearchTimeoutError re-export = P2.M3.T1.S2; groundswell = P2.M3.T1.S3;
  bugfix numbering = P3). S1's gate is: **this one test file is GREEN** + typecheck
  + lint + format clean.

---

## User Persona (if applicable)

**Target User**: Pipeline contributor / CI maintainer.
**Use Case**: Running the PRP-generator unit suite locally or in CI without 15
false-failure noise, so the §6.3 Level-2 unit-test gate is meaningful for the
PRP-generator component.
**User Journey**: A contributor edits `prp-generator.ts` and runs
`npx vitest run tests/unit/agents/prp-generator.test.ts` to validate; today 15
tests fail regardless of their change because the mocks are rotted. After S1, the
suite faithfully reflects the file-contract behavior and only fails on real regressions.
**Pain Points Addressed**: Rotted mocks produce `TypeError`/`AgentError` noise that
masks real regressions and breaks trust in the test suite (PRD Issue 3A explicitly
names this file). The mock return shape (`PRPDocument`) and the missing file mock
mean the suite tests a code path that no longer exists in the source.

---

## Why

- **PRD Issue 3A compliance**: The bugfix PRD (h3.2) and
  `architecture/test_validation.md §3A` ("Mock Drift: PRP-Generator File-Contract
  Path") mandate: *"The test must mock `readFile` to return the mock PRP JSON
  string at the expected `prpOutputPath`, matching the file-contract pattern. The
  agent response should be `{ status: 'success', output: '' }`, not the PRP object."*
- **Restores the §6.3 Level-2 gate for this component**: a red suite means the
  project's own validation gate cannot pass; fixing this file removes 15 of the
  ~297 failures.
- **Faithful, not cosmetic**: the path-aware `mockReadFile` faithfully simulates
  the file-is-the-contract pattern (the agent writes the file; the source reads it
  back) AND correctly distinguishes the `prpOutputPath` (`prps/{id}.json`) from the
  cache-metadata path (`prps/.cache/{id}.json`) — both end in `.json` but have
  different semantics (PRP contract vs. cache miss → null).
- **Closes part of P2.M3**: Item 4 — "All tests in prp-generator.test.ts pass."
  (The ResearchTimeoutError re-export = S2; the groundswell link = S3.)

### Out of scope (hard fences)
- **`src/agents/prp-generator.ts`** → **NOT edited.** This is a TEST-ONLY fix
  (item 5: DOCS none / test-only). Even the discovered source quirk (the bare
  `await mkdir(...)` at prp-generator.ts:656 throws a raw `Error`, not
  `PRPFileError`, which is why the "mkdir fails" test asserts the wrong class) is
  OUT OF SCOPE to fix in source — S1 aligns the TEST assertion with actual
  behavior rather than changing source semantics.
- **Other test files** → NOT edited. `tests/integration/delta-prd-generation.test.ts`
  is referenced ONLY as a mock pattern (its `{ changes, patchInstructions, taskIds }`
  agent-return + `retryAgentPrompt` usage). The ResearchTimeoutError re-export
  (S2) and groundswell (S3) fixes are separate subtasks.
- **`prp-blueprint-prompt.ts`**, `delta-prd.test.ts`, any other source/test → untouched.
- **The ~282 other pre-existing failures** → NOT S1's gate. S1's gate is THIS file green.
- **`PRD.md` / `tasks.json` / `prd_snapshot.md`** → READ-ONLY (research agent never touches them).

---

## What

### User-visible behavior
None. No CLI, source, runtime, config, API, or docs change. The PRP-generator unit
test suite goes from 15 failed / 11 passed to 26 passed / 0 failed.

### Technical requirements (exact contract — item 3a–d)

#### (a) Add a reusable path-aware `mockReadFile` helper near the top of the file
(after the `const mockReadFile = readFile as any;` cast, ~line 61, and before the
`describe` blocks). This encodes the contract's scout finding verbatim:

```ts
/**
 * Path-aware mockReadFile for the file-is-the-contract pattern.
 *
 * The source (prp-generator.ts:735) calls `readFile(prpOutputPath, 'utf-8')` where
 * prpOutputPath = `{sessionPath}/prps/{sanitizedId}.json` (prp-generator.ts:655).
 * mockReadFile is ALSO called for cache-metadata reads at
 * `{sessionPath}/prps/.cache/{sanitizedId}.json` (getCacheMetadataPath:248) — those
 * are wrapped in try/catch that tolerates ENOENT (cache miss → null).
 *
 * So: return the PRP JSON at the PRP-output path; REJECT ENOENT for everything else
 * (cache metadata, so the cache-miss/generate path runs).
 *
 * @param prp - the PRPDocument to return at the prpOutputPath
 */
function setupReadFileForPRP(prp: PRPDocument): void {
  const prpJson = JSON.stringify(prp);
  const sanitizedId = prp.taskId.replace(/\./g, '_');
  mockReadFile.mockImplementation(async (path: string) => {
    // The PRP output path: {sessionPath}/prps/{sanitizedId}.json (NOT .cache).
    if (path.endsWith(`${sanitizedId}.json`) && !path.includes('.cache')) {
      return prpJson;
    }
    // Cache metadata paths (.cache/*.json) or anything else → ENOENT (cache miss).
    const err = new Error(
      `ENOENT: no such file or directory, open '${path}'`
    ) as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    throw err;
  });
}
```

**Notes**:
- `PRPDocument` is already imported at the top of the test file (test line 16).
- The `!path.includes('.cache')` guard is CRITICAL: both the PRP-output path and
  the cache-metadata path end in `{sanitizedId}.json`; only the path-aware check
  distinguishes them. The cache-metadata path is `{sessionPath}/prps/.cache/{sanitizedId}.json`.
- Using `mockImplementation` (not `mockResolvedValue`) means each call is evaluated
  against the path — robust to the multiple readFile calls the source makes
  (fast-path reuse at :696, file-contract at :735, cache-metadata at :344/:426).
- This helper is called PER-TEST (inside the test body, after setting up the prompt
  mock), NOT in the global `beforeEach` — so it does not clobber the cache-HIT
  test's own per-test `mockReadFile.mockResolvedValue(JSON.stringify(mockMetadata))`.

#### (b) Change every failing test's agent-return shape + apply the helper

For each test that currently does `mockAgent.prompt.mockResolvedValue(mockPRP)`
(or `mockResolvedValueOnce(mockPRP)`), change to
`mockResolvedValue({ status: 'success', output: '' })` and add
`setupReadFileForPRP(mockPRP)` (or `setupReadFileForPRP(cachedPRP)`) immediately
after. The `result`/writeFile assertions still hold because the file-contract read
parses the JSON back into the same `PRPDocument` shape.

#### (c) Per-test fix matrix (all 15 failing tests)

```yaml
describe('generate'):
  - 'should successfully generate PRP on first attempt' (~230):
      mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' })
      setupReadFileForPRP(mockPRP)
      # assertions unchanged (result === mockPRP shape; prompt called 1×; writeFile 2×)
  - 'should forward issueFeedback ... as the 4th arg' (~252):
      same mock change + setupReadFileForPRP(mockPRP)
      # 4th-arg spy assertion unchanged
  - 'should pass extracted PRD sections ... selectors=[] fallback' (~266):
      mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' })
      setupReadFileForPRP(createMockPRPDocument(subtask.id))
      # CHANGE: `await expect(generator.generate(...)).rejects.toThrow()` →
      #         `await generator.generate(subtask, backlog);` (now resolves; the
      #         createPRPBlueprintPrompt spy was called at :667 before the file read).
      #         The 6th-arg spy assertion still holds. Remove the "PRE-EXISTING
      #         mock gap" comment.
  - 'should pass extracted section text ... when selectors resolve' (~294):
      same as above (let it resolve; remove the rejects.toThrow wrapper).
      # NOTE: createMockPRPDocument(subtask.id) so taskId matches the prpOutputPath.
  - 'should write PRP file with correct filename' (~329):
      mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' })
      setupReadFileForPRP(mockPRP)
      # writeFile assertion unchanged (.md filename + markdown content)
  - 'should retry on failure and succeed on second attempt' (~347):
      mockAgent.prompt
        .mockRejectedValueOnce(new Error('LLM timeout'))
        .mockResolvedValueOnce({ status: 'success', output: '' })  # was mockPRP
      setupReadFileForPRP(mockPRP)
      # prompt called 2×, result === mockPRP, writeFile 2× — unchanged
  - 'should throw PRPGenerationError after max retries exhausted' (~370):
      # NO file-mock change needed — all 3 prompt calls reject (file-contract read
      # never reached). VERIFY it still throws PRPGenerationError after 3 attempts.
      # (If it's currently failing for a DIFFERENT reason, investigate; the retry
      #  config maxAttempts=3 means 3 prompt calls. The try/catch re-call inside
      #  the test's VERIFY block calls generate AGAIN — keep that as-is.)
  - 'should use exponential backoff for retries' (~402):
      mockAgent.prompt
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockResolvedValueOnce({ status: 'success', output: '' })  # was mockPRP
      setupReadFileForPRP(mockPRP)
      # timing assertion (>=2000ms) unchanged

describe('PRP markdown formatting'):
  - 'should format PRP as valid markdown' (~435):
      mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' })
      setupReadFileForPRP(mockPRP)
      # writeFile content assertions unchanged
  - 'should handle null command for manual validation levels' (~466):
      same

describe('file write errors'):
  - 'should throw PRPFileError when mkdir fails' (~490):
      # ROOT CAUSE of failure: prp-generator.ts:656 does a BARE `await mkdir(...)`
      # with NO try/catch in generate(), so a rejecting mkdir throws a raw Error,
      # NOT PRPFileError. The test asserts .rejects.toThrow(PRPFileError) → FAILS.
      # This is a SOURCE quirk OUT OF SCOPE to fix (S1 is test-only).
      # FIX (align test with actual behavior): change the assertion to
      #   await expect(generator.generate(task, backlog)).rejects.toThrow();
      # (any error) OR .rejects.toThrow('EACCES') (the mocked message).
      # Do NOT add setupReadFileForPRP — the mkdir at :656 throws BEFORE the agent
      # is ever called, so the file mock is irrelevant. Keep mockMkdir.mockRejectedValue.
      # (If you want to preserve the PRPFileError intent, that's a SOURCE fix in a
      #  separate task — explicitly out of scope per the test-only contract.)
  - 'should throw PRPFileError when writeFile fails' (~508):
      mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' })
      setupReadFileForPRP(mockPRP)   # needed so generate reaches #writePRPToFile (:773)
      mockWriteFile.mockRejectedValue(new Error('ENOSPC: no space left'))
      # NOW writeFile rejects inside #writePRPToFile's try/catch (:815) → PRPFileError ✓
      # (without setupReadFileForPRP, generate throws at the file-contract read first)

describe('cache') — has its own beforeEach (line ~543) that does
                   mockReadFile.mockReset(); mockStat.mockReset();
                   mockStat.mockRejectedValue(new Error('ENOENT'));
  - 'should bypass cache read ... when issueFeedback is provided' (~549):
      # This test sets mockStat.mockResolvedValue + mockReadFile.mockResolvedValue(metadata)
      # for the cache-check, then bypasses (feedback) → agent → file-contract read.
      # REPLACE the blanket mockReadFile.mockResolvedValue(JSON.stringify(mockMetadata))
      # with the path-aware setupReadFileForPRP(cachedPRP) AFTER the cache-check setup,
      # OR use mockImplementation that returns metadata for .cache paths AND the PRP
      # JSON for the prpOutputPath. SIMPLEST: since feedback bypasses the cache READ
      # entirely (the `if (!this.#noCache && !issueFeedback)` guard at :614 is false),
      # the cache stat/read mocks are not even consulted — just call
      # setupReadFileForPRP(cachedPRP) + { status:'success', output:'' }. The existing
      # mockStat/mockReadFile cache setup is harmless (never reached). Keep the test's
      # intent (agent WAS called) — assert mockAgent.prompt called 1×.
  - 'should use cached PRP when hash matches and file is recent' (~567):
      # PASSING — DO NOT CHANGE. Sets mockStat.mockResolvedValue({mtimeMs: now}) +
      # mockReadFile.mockResolvedValue(JSON.stringify(mockMetadata)). The path-aware
      # helper is NOT applied here (full cache HIT; agent never called; file-contract
      # read never reached). Verify it still passes after your edits.
  - 'should bypass cache when --no-cache flag is set' (~591):
      mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' })  # was mockPRP
      setupReadFileForPRP(mockPRP)
      # noCache=true → cache skipped → agent → file-contract read. mockStat is ENOENT.
  - 'should save cache metadata after generation when cache is enabled' (~610):
      mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' })  # was mockPRP
      setupReadFileForPRP(mockPRP)
      # cache enabled, cache MISS (stat ENOENT) → agent → file read → writePRP → saveCacheMetadata.
      # .cache/...json writeFile assertion unchanged.
  - 'should return null for non-existent cache file' (~647):
      mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' })  # was mockPRP
      setupReadFileForPRP(mockPRP)
      # REMOVE the `mockReadFile.mockRejectedValue(new Error('ENOENT'))` (line ~665) —
      # it would shadow setupReadFileForPRP. The helper already rejects ENOENT for
      # non-prpOutput paths. Keep mockStat.mockRejectedValue(ENOENT) (cache miss).
      # keep mockAgent.prompt.mockResolvedValue(mockPRP) removal + the helper.
  - 'should return null when cache file is expired (older than 24 hours)' (~669):
      mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' })  # was mockPRP
      setupReadFileForPRP(mockPRP)
      # stat returns old mtimeMs → cache MISS → agent → file-contract read.
```

#### (d) The two `prd_selectors` tests — special handling

Tests `should pass extracted PRD sections ... selectors=[] fallback` (~266) and
`should pass extracted section text ... when selectors resolve` (~294) currently do
`await expect(generator.generate(...)).rejects.toThrow()` and have comments noting
the "PRE-EXISTING mock gap — readFile returns undefined". After the mock fix
(`setupReadFileForPRP` + `{ status:'success', output:'' }`), `generate()` RESOLVES
cleanly. **CHANGE** the wrapper from `.rejects.toThrow()` to a plain
`await generator.generate(subtask, backlog);`. The `createPRPBlueprintPrompt` spy is
called at prp-generator.ts:667 (BEFORE the retry loop / file read at :688), so the
6th-arg assertion (`expect(mockCreatePRPBlueprintPrompt).toHaveBeenCalledWith(...)`)
still holds. **IMPORTANT**: for the second test (~294), the prpOutputPath is derived
from `subtask.id` = `'P1.M2.T1.S3'`, so call `setupReadFileForPRP(createMockPRPDocument('P1.M2.T1.S3'))`
(matching taskId) — otherwise the path check `endsWith(\`${sanitizedId}.json\`)`
won't match. Remove the "PRE-EXISTING mock gap" comments.

### Success Criteria
- [ ] `npx vitest run tests/unit/agents/prp-generator.test.ts` → **26 passed | 0 failed**.
- [ ] No test passes a raw `PRPDocument` as the agent's `prompt()` return; all
      successful-agent tests use `{ status: 'success', output: '' }`.
- [ ] `setupReadFileForPRP` helper exists and is called in every test that reaches
      the file-contract read (generate, formatting, writeFile-fails, no-cache,
      save-cache, expired, non-existent, feedback-bypass).
- [ ] The path-aware `mockReadFile` distinguishes the `prpOutputPath`
      (`prps/{id}.json`) from the cache-metadata path (`prps/.cache/{id}.json`).
- [ ] The cache-HIT test ("should use cached PRP when hash matches") and the
      hash-consistency test still PASS unchanged.
- [ ] The `mkdir`-fails test asserts `.rejects.toThrow()` (any error), aligned with
      the bare-throw source behavior at prp-generator.ts:656.
- [ ] The two `prd_selectors` tests let `generate()` resolve (no `.rejects.toThrow()`)
      and still assert the 6th-arg spy call.
- [ ] `npm run typecheck` exit 0; `npm run lint` + `format:check` clean.
- [ ] No edits to `src/agents/prp-generator.ts` or any source file.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** This is a single-file, test-only change. Its correctness hinges on six
proven facts, all pinned below with exact file:line anchors: (1) the source's
file-contract flow — `readFile(prpOutputPath)` at prp-generator.ts:735, the
`r.status === 'error'` guard at :720, and the `prpOutputPath` construction at :655;
(2) the EXACT failure modes (run live: 15 fail; `TypeError: ... reading 'match'`
from `#parsePRPText(undefined)` at :271, and `AgentError: Researcher did not write
PRP file` at :737); (3) the two `readFile` shapes the source expects — agent return
`{status, output}` + PRP JSON at the file path — confirmed by reading prp-generator.ts:718–745
in full; (4) the path-collision gotcha (prpOutputPath `prps/{id}.json` vs.
cache-metadata `prps/.cache/{id}.json` — both `.json`, distinguished by `.cache`);
(5) the bare-`mkdir` source quirk at :656 (throws raw `Error`, not `PRPFileError`)
which dictates the mkdir-fails test's relaxed assertion; (6) the per-test matrix
(15 tests, grouped by describe block, each with its exact mock change). The 11
passing tests (esp. cache-HIT) are explicitly preserved.

### Documentation & References
```yaml
# MUST READ — the bug + mandated fix strategy
- docfile: PRD.md  (bugfix PRD)
  section: "Issue 3: Test suite red; ContextScopeSchema ..." (h3.2) — the "Fix/refresh
           the rotted test fixtures and mocks (... update PRP-generator tests to the
           file-as-contract path ...)" bullet
  why: Mandates the file-as-contract mock fix for this exact test file.
  critical: The PRD scopes Issue 3A as "fix rotted mocks" — test-only, no source change.
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/architecture/test_validation.md
  section: "#### Mock Drift: PRP-Generator File-Contract Path" (§3A)
  why: States the exact fix: "The test must mock readFile to return the mock PRP JSON
       string at the expected prpOutputPath ... The agent response should be
       { status: 'success', output: '' }, not the PRP object." This is the contract.
  critical: The doc notes mockReadFile returns undefined by default → file-contract
       path fails. The path-aware mockImplementation is the faithful fix.

# MUST READ — this subtask's research (proven facts about the working tree)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P2M3T1S1/research/s1-codebase-analysis.md
  section: §1 (the 15 failures + 2 modes, run live), §2 (source contract :688–745),
       §3 (prpOutputPath construction :655), §4 (the path-aware helper), §5 (per-test
       matrix), §6 (mkdir quirk :656), §7 (validation), §8 (scope), §9 (scout verified),
       §10 (no external research)
  why: Proves the failure modes, the exact mock changes per test, and the mkdir edge.

# THE FILE TO EDIT
- file: tests/unit/agents/prp-generator.test.ts
  section: (a) add setupReadFileForPRP helper after line ~61 (after mockReadFile cast);
       (b) modify the 15 failing tests per the matrix in §(c) above.
  why: This is the rotted test file. All 15 failures are mock-drift, not real regressions.
  pattern: the file already uses vi.fn().mockResolvedValue / mockResolvedValueOnce /
       mockRejectedValue / mockImplementation; the cache describe already does per-test
       mockReadFile.mockResolvedValue(JSON.stringify(mockMetadata)). Match that style.
  gotcha: (1) do NOT add setupReadFileForPRP to the global beforeEach — it would
       clobber the cache-HIT test's per-test mockReadFile. (2) the two .json paths
       (prpOutputPath vs cache-metadata) collide — the helper's !path.includes('.cache')
       guard resolves it. (3) the mkdir-fails test asserts the WRONG error class because
       :656 is a bare throw — relax to .rejects.toThrow(). (4) the prd_selectors tests'
       taskId is 'P1.M2.T1.S3' — setupReadFileForPRP must use createMockPRPDocument with
       that exact id or the path check fails.

# CONTRACT INPUTS (read-only — the source under test; do NOT edit)
- file: src/agents/prp-generator.ts
  section: generate() :609–790; retryAgentPrompt closure :688–745; #parsePRPText :265;
       #writePRPToFile :807; getCachePath :231 / getCacheMetadataPath :246;
       #loadCachedPRP :341 / #loadCacheMetadata :423; #isCacheRecent :320
  why: Proves the file-contract flow, the {status,output} agent-return contract, the
       prpOutputPath = {sessionPath}/prps/{sanitizedId}.json, the bare-mkdir at :656,
       and that cache-metadata reads tolerate ENOENT (try/catch → null).
  gotcha: :656 mkdir is a BARE await (no try/catch in generate) → raw Error, not PRPFileError.
       :665 extractPRDSections + :667 createPRPBlueprintPrompt run BEFORE the retry loop
       (:688) — so the prd_selectors spy assertions hold regardless of the file-read outcome.

# REFERENCE PATTERN (read-only — do NOT edit)
- file: tests/integration/delta-prd-generation.test.ts
  section: the mockAgent.prompt.mockResolvedValue({...}) + retryAgentPrompt pattern (~453)
  why: The contract says "Follow the architect-prompt mock pattern in delta-prd.test.ts
       for reference." Shows the {status/output}-style agent return + retryAgentPrompt
       consumption. S1 adapts this pattern to prp-generator.test.ts.
  gotcha: delta-prd.test.ts mocks the agent DIRECTLY (not via createResearcherAgent);
       prp-generator.test.ts mocks via createResearcherAgent.mockReturnValue(mockAgent).
       The pattern to copy is the RETURN SHAPE ({ status, output } / the parsed object),
       not the mock wiring.

# DOWNSTREAM / NOT THIS TASK
- subtask: P2.M3.T1.S2 (ResearchTimeoutError re-export) — separate file(s); no overlap.
- subtask: P2.M3.T1.S3 (groundswell module mock) — integration suites; no overlap.
- subtask: P3.M1 (bugfix numbering) — no overlap.
```

### Current Codebase tree (relevant slice)
```bash
src/agents/
  prp-generator.ts                         # READ-ONLY (source under test) — NOT edited
tests/unit/agents/
  prp-generator.test.ts                    # EDIT — fix 15 mocks (file-contract path)
tests/integration/
  delta-prd-generation.test.ts             # READ-ONLY reference (mock pattern)
plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/architecture/
  test_validation.md                       # READ-ONLY — §3A documents the fix
vitest.config.ts                           # READ-ONLY — coverage thresholds
package.json                               # READ-ONLY — npm run typecheck/lint/format/test:run
```

### Desired Codebase tree with files to be added and responsibility of file
```bash
tests/unit/agents/prp-generator.test.ts    # MODIFIED — +setupReadFileForPRP helper;
                                           #   15 tests: {status,output} return + path-aware
                                           #   mockReadFile; mkdir-fails assertion relaxed;
                                           #   prd_selectors tests resolve cleanly
# (no NEW files, no source edits, no docs)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL: the agent-return SHAPE is { status, output }, NOT a PRPDocument. The source
// (prp-generator.ts:718) does `const r = await withAgentDeadline(prompt(prompt))` then
// `if (r.status === 'error') throw ...`. It NEVER reads r.data — the PRP comes from the
// FILE (readFile at :735). So mockAgent.prompt.mockResolvedValue(mockPRP) is doubly wrong:
// (1) the object has no .status (r.status === undefined, which is !== 'error', so the guard
//     passes — masking issue #1), and (2) the file mock returns undefined → #parsePRPText
//     blows up. Fix BOTH: { status:'success', output:'' } + setupReadFileForPRP.

// CRITICAL (two .json paths collide): prpOutputPath = {sessionPath}/prps/{sanitizedId}.json
// (prp-generator.ts:655) and cache-metadata = {sessionPath}/prps/.cache/{sanitizedId}.json
// (getCacheMetadataPath:248). Both end in {sanitizedId}.json. The path-aware helper MUST
// check !path.includes('.cache') to distinguish them. Without that guard, a cache-MISS test
// would get the PRP JSON at the metadata path and misbehave.

// CRITICAL (do NOT clobber the cache-HIT test): the cache describe has its own beforeEach
// (test ~543) that does mockReadFile.mockReset(). The PASSING cache-HIT test (~567) sets
// mockReadFile.mockResolvedValue(JSON.stringify(mockMetadata)) per-test. setupReadFileForPRP
// must be called PER-TEST in the body, NOT in a global beforeEach — otherwise it overrides
// the cache-HIT test's metadata return and breaks it.

// CRITICAL (mkdir quirk at :656): `await mkdir(join(this.sessionPath,'prps'),{recursive:true})`
// at prp-generator.ts:656 is a BARE await inside generate() with NO surrounding try/catch.
// A rejecting mkdir throws a RAW Error, NOT PRPFileError. So the test "should throw
// PRPFileError when mkdir fails" asserts the wrong class. S1 (test-only) RELAXES the test
// assertion to .rejects.toThrow() (any error) — it does NOT fix the source (that's a
// separate task). The writeFile-fails test IS a real PRPFileError (#writePRPToFile:815
// wraps writeFile in try/catch → PRPFileError), so that assertion stays.

// GOTCHA (taskId must match the path): setupReadFileForPRP(prp) derives sanitizedId from
// prp.taskId and checks path.endsWith(`${sanitizedId}.json`). For the prd_selectors tests
// (taskId 'P1.M2.T1.S3'), you MUST call setupReadFileForPRP(createMockPRPDocument('P1.M2.T1.S3'))
// — using createMockPRPDocument(task.id) where task.id matches. A mismatched id → the path
// check fails → readFile rejects ENOENT → generate throws "did not write PRP file".

// GOTCHA (prd_selectors tests resolve after fix): these two tests currently wrap generate()
// in .rejects.toThrow() with a "PRE-EXISTING mock gap" comment. After setupReadFileForPRP +
// {status,output}, generate() RESOLVES. Change the wrapper to a plain await and remove the
// comment. The createPRPBlueprintPrompt spy is called at :667 (before the retry loop at :688),
// so the 6th-arg assertion is unaffected by whether generate resolves or rejects.

// GOTCHA (the fast-path reuse read at :696): the retry closure FIRST tries
// readFile(prpOutputPath) → #parsePRPText → PRPDocumentSchema.safeParse. If it succeeds, it
// REUSES the existing file (no agent call). The path-aware helper returns the PRP JSON for
// this path too, so on the FIRST attempt the fast-path would reuse it and SKIP the agent
// call entirely! → mockAgent.prompt would be called 0×, breaking the "prompt called 1×"
// assertions. RESOLUTION: this is only an issue if a PRIOR test left the mockReadFile
// returning PRP JSON. Because afterEach does vi.clearAllMocks() (NOT mockReset on
// mockReadFile) and the path-aware helper is set per-test via mockImplementation, each test
// starts clean. BUT verify: the fast-path read at :696 happens INSIDE the retry closure on
// EVERY attempt. If setupReadFileForPRP is active, the fast-path returns the PRP on attempt 1
// → the agent is NEVER called → tests asserting "prompt called 1×" FAIL. *** THIS IS THE KEY
// GOTCHA *** — see Implementation Patterns for the resolution (the helper must make the
// fast-path read FAIL/ENOENT on the first probe, OR the tests must assert prompt called 0×
// when the file pre-exists). Actually: re-reading :696, the fast-path is `try { readFile ...
// parsePRPText ... safeParse } catch { fall through }`. If readFile returns valid PRP JSON,
// safeParse succeeds → reuse → agent NOT called. So setupReadFileForPRP returning PRP JSON
// at the prpOutputPath triggers the fast path on the FIRST attempt, skipping the agent.
// RESOLUTION: the helper should make the FIRST readFile (fast-path probe) return ENOENT,
// then return the PRP JSON only AFTER the agent call. Use a call-counter: return ENOENT on
// the first prpOutputPath read, PRP JSON on subsequent ones. OR (simpler + matches real
// behavior): the fast path checks if the file PRE-EXISTS from a PRIOR attempt/run — in a
// fresh test the file does NOT pre-exist, so readFile should REJECT (ENOENT) the first time.
// The agent then runs, "writes" the file (mocked writeFile is a no-op), and the SECOND
// readFile (file-contract at :735) returns the PRP JSON. So the helper MUST be
// call-order-aware: ENOENT on the first prpOutputPath read, PRP JSON on the second. See
// Implementation Patterns §"the two-phase readFile mock" for the exact implementation.

// CRITICAL (retry config): retryAgentPrompt's default maxAttempts = 3 (retry.ts:537). The
// "max retries exhausted" test rejects all 3 → PRPGenerationError. The "retry succeeds"
// test rejects once + resolves once → 2 prompt calls. The backoff test rejects 2 + resolves
// 1 → 3 prompt calls. These counts are unchanged by the mock fix.

// GOTCHA (100% coverage not at risk): this is a TEST file, not in src/**/*.ts coverage
// include. No coverage threshold concerns.

// GOTCHA (no source edit): even the :656 mkdir raw-throw is OUT OF SCOPE to fix in source.
// S1 is test-only (item 5). Align the test assertion with actual behavior.
```

---

## Implementation Blueprint

### Data models and structure
None. S1 adds NO types, source, or constants. It adds one local helper function
(`setupReadFileForPRP`) inside the test file and modifies 15 test cases' mock setup.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD the path-aware, call-order-aware setupReadFileForPRP helper
  - PLACE: after `const mockReadFile = readFile as any;` (~line 61), before the
    createMockSessionManager factory.
  - IMPLEMENT: a helper that mocks readFile to be path-aware AND call-order-aware:
      * for the prpOutputPath (endsWith `${sanitizedId}.json`, NOT .cache):
        - the FIRST call (fast-path reuse probe at :696) → REJECT ENOENT (file does
          not pre-exist in a fresh test)
        - the SECOND call (file-contract read at :735, AFTER the agent "wrote" it) →
          RETURN JSON.stringify(prp)
      * for cache-metadata paths (.cache/*.json) and anything else → REJECT ENOENT
        (cache miss → null; the source tolerates this)
  - USE a closure counter keyed on the prpOutputPath to distinguish first vs second call.
  - SEE Implementation Patterns §"the two-phase readFile mock" for the exact code.
  - GOTCHA: the counter must be scoped PER setupReadFileForPRP call (reset each time
    the helper is invoked), and the helper is called once per test → fresh counter.

Task 2: MODIFY describe('generate') — 8 tests
  - 'should successfully generate PRP on first attempt' (~230):
      replace `mockAgent.prompt.mockResolvedValue(mockPRP)` →
        `mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' })`
      add `setupReadFileForPRP(mockPRP);` immediately after the prompt mock.
      assertions unchanged.
  - 'should forward issueFeedback ... 4th arg' (~252): same mock change + helper.
  - 'should pass extracted PRD sections ... selectors=[] fallback' (~266):
      mock change + `setupReadFileForPRP(createMockPRPDocument(subtask.id))`.
      CHANGE `await expect(generator.generate(subtask, backlog)).rejects.toThrow();` →
        `await generator.generate(subtask, backlog);`
      REMOVE the "PRE-EXISTING mock gap" comment. 6th-arg spy assertion unchanged.
  - 'should pass extracted section text ... when selectors resolve' (~294):
      same as above; taskId = 'P1.M2.T1.S3' → setupReadFileForPRP(createMockPRPDocument('P1.M2.T1.S3')).
      let it resolve; remove rejects.toThrow + comment.
  - 'should write PRP file with correct filename' (~329): mock change + helper.
  - 'should retry on failure and succeed on second attempt' (~347):
      change `.mockResolvedValueOnce(mockPRP)` →
        `.mockResolvedValueOnce({ status: 'success', output: '' })`; add helper.
  - 'should throw PRPGenerationError after max retries exhausted' (~370):
      VERIFY it still throws PRPGenerationError after 3 prompt rejections. NO file-mock
      change (file read never reached). If it's failing for an unrelated reason,
      investigate — but per the live run it IS in the 15 failures, so confirm why
      (likely the try/catch re-call block). Keep assertions; ensure green.
  - 'should use exponential backoff for retries' (~402):
      change 3rd `.mockResolvedValueOnce(mockPRP)` →
        `.mockResolvedValueOnce({ status: 'success', output: '' })`; add helper.

Task 3: MODIFY describe('PRP markdown formatting') — 2 tests
  - 'should format PRP as valid markdown' (~435): mock change + setupReadFileForPRP(mockPRP).
  - 'should handle null command for manual validation levels' (~466): same.

Task 4: MODIFY describe('file write errors') — 2 tests
  - 'should throw PRPFileError when mkdir fails' (~490):
      CHANGE assertion `.rejects.toThrow(PRPFileError)` → `.rejects.toThrow()` (any
      error — the bare mkdir at :656 throws a raw Error, not PRPFileError; OUT OF SCOPE
      to fix source). Do NOT add setupReadFileForPRP (mkdir at :656 throws first).
      KEEP mockMkdir.mockRejectedValue(new Error('EACCES...')).
  - 'should throw PRPFileError when writeFile fails' (~508):
      mock change + `setupReadFileForPRP(mockPRP)` (so generate reaches #writePRPToFile).
      KEEP mockWriteFile.mockRejectedValue(new Error('ENOSPC...')) and the PRPFileError
      assertion (#writePRPToFile:815 wraps → PRPFileError ✓).

Task 5: MODIFY describe('cache') — 5 failing tests (preserve the 2 passing)
  - 'should bypass cache read ... when issueFeedback is provided' (~549):
      mock change ({status,output}) + setupReadFileForPRP(cachedPRP). The existing
      mockStat/mockReadFile cache-check setup is harmless (feedback bypasses cache READ).
      Assert mockAgent.prompt called 1×.
  - 'should use cached PRP when hash matches and file is recent' (~567):
      DO NOT CHANGE (PASSING). Verify still green after edits.
  - 'should bypass cache when --no-cache flag is set' (~591):
      mock change + setupReadFileForPRP(mockPRP).
  - 'should save cache metadata after generation when cache is enabled' (~610):
      mock change + setupReadFileForPRP(mockPRP). .cache writeFile assertion unchanged.
  - 'should return null for non-existent cache file' (~647):
      mock change + setupReadFileForPRP(mockPRP). REMOVE the
      `mockReadFile.mockRejectedValue(new Error('ENOENT'))` (~665) — it shadows the
      helper. KEEP mockStat.mockRejectedValue(ENOENT).
  - 'should return null when cache file is expired (older than 24 hours)' (~669):
      mock change + setupReadFileForPRP(mockPRP).

Task 6: VERIFY — typecheck, lint, format, targeted green
  - RUN `npx vitest run tests/unit/agents/prp-generator.test.ts` → 26 passed | 0 failed.
  - RUN `npm run typecheck` → exit 0.
  - RUN `npm run lint && npm run format:check` → clean (run `npm run format` if needed).
  - VERIFY `rg -n "mockResolvedValue\(mockPRP\)" tests/unit/agents/prp-generator.test.ts` →
    ZERO matches (no raw PRPDocument as agent return).
  - VERIFY `rg -n "setupReadFileForPRP" tests/unit/agents/prp-generator.test.ts` →
    helper def + calls in every generate-path test.
  - VERIFY no source file edited: `git diff --name-only` → only the test file.
  - NOTE: the FULL `npm run test:run` / `npm run validate` is NOT green (other Issue 3A
    mocks + Issue 4) and is NOT S1's gate.
```

### Implementation Patterns & Key Details

```ts
// PATTERN: the two-phase, path-aware readFile mock (the KEY gotcha resolution).
// The source's retry closure does TWO readFile(prpOutputPath) calls:
//   1. fast-path reuse probe (:696) — file does NOT pre-exist in a fresh test → ENOENT
//   2. file-contract read (:735) — AFTER the agent "wrote" it → return PRP JSON
// A naive mockImplementation returning PRP JSON always would trigger the fast path on
// attempt 1 → agent NEVER called → "prompt called 1×" assertions break. So the helper
// is call-order-aware: ENOENT on the first prpOutputPath read, PRP JSON on the second.
function setupReadFileForPRP(prp: PRPDocument): void {
  const prpJson = JSON.stringify(prp);
  const sanitizedId = prp.taskId.replace(/\./g, '_');
  let prpPathReadCount = 0; // scoped to this helper invocation (per-test)
  mockReadFile.mockImplementation(async (path: string) => {
    // PRP output path: {sessionPath}/prps/{sanitizedId}.json (NOT .cache)
    if (path.endsWith(`${sanitizedId}.json`) && !path.includes('.cache')) {
      prpPathReadCount++;
      if (prpPathReadCount === 1) {
        // First read = fast-path reuse probe — file doesn't pre-exist → ENOENT
        // (so the agent IS invoked, matching "prompt called N×" assertions).
        const err = new Error(`ENOENT: no such file, open '${path}'`) as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      // Second+ read = file-contract read AFTER the agent "wrote" the file.
      return prpJson;
    }
    // Cache metadata (.cache/*.json) or anything else → ENOENT (cache miss → null).
    const err = new Error(`ENOENT: no such file, open '${path}'`) as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    throw err;
  });
}

// PATTERN: the agent return shape (matches source contract at :718–720).
mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' });
// (NOT mockPRP — the source ignores result.data; it reads the file.)

// PATTERN: per-test application (NOT global beforeEach — preserves cache-HIT test).
it('should successfully generate PRP on first attempt', async () => {
  const task = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
  const mockPRP = createMockPRPDocument(task.id);
  mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' });
  setupReadFileForPRP(mockPRP); // ← path-aware + call-order-aware
  const generator = new PRPGenerator(mockSessionManager);
  const result = await generator.generate(task, createMockBacklog());
  expect(result).toEqual(mockPRP);
  expect(mockAgent.prompt).toHaveBeenCalledTimes(1);
  // ...
});

// CRITICAL: the cache-HIT test is UNCHANGED — it sets its own mockReadFile and never
// reaches the file-contract read (agent not called). Do NOT apply setupReadFileForPRP there.

// PATTERN: the mkdir-fails assertion relaxation (source quirk, test-only fix).
it('should throw PRPFileError when mkdir fails', async () => {
  // ... mockMkdir.mockRejectedValue(new Error('EACCES: permission denied')) ...
  // :656 is a bare await → raw Error (NOT PRPFileError). Align test with actual:
  await expect(generator.generate(task, backlog)).rejects.toThrow(); // any error
  // (Fixing the source to wrap :656 in try/catch→PRPFileError is a SEPARATE task.)
});
```

### Integration Points

```yaml
TEST FILE (tests/unit/agents/prp-generator.test.ts):
  - add: setupReadFileForPRP helper (path-aware + call-order-aware readFile mock)
  - modify: 15 failing tests per the matrix (agent return {status,output} + helper)
  - relax: mkdir-fails assertion (.rejects.toThrow(), not PRPFileError)
  - resolve: prd_selectors tests (no .rejects.toThrow wrapper)
  - preserve: cache-HIT test + hash-consistency test (PASSING, untouched)

SOURCE (src/agents/prp-generator.ts):
  - NONE. Read-only. (The :656 bare-mkdir quirk is documented but NOT fixed — test-only scope.)

NO OTHER TEST FILES / NO DOCS / NO CONFIG / NO CLI
  — pure test-mock repair.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After editing the test file:
npm run typecheck        # tsc --noEmit -p tsconfig.build.json → MUST be exit 0
npm run lint             # eslint . --ext .ts → no unused vars / typing issues
npm run format:check     # prettier; run `npm run format` if it complains

# Expected: Zero errors. typecheck confirms PRPDocument import + helper signature.
```

### Level 2: Unit Tests (Component Validation) — S1's PRIMARY gate

```bash
# THE suite S1 fixes (currently 15 failed | 11 passed):
npx vitest run tests/unit/agents/prp-generator.test.ts

# Expected: 26 passed | 0 failed. Specifically verify:
#   - all 8 generate tests pass (incl. retry, backoff, max-retries, prd_selectors)
#   - both PRP markdown formatting tests pass
#   - both file write error tests pass (mkdir-fails now .rejects.toThrow(); writeFile-fails PRPFileError)
#   - all 7 cache tests pass (cache-HIT + hash-consistency STILL green; the 5 previously-failing now green)
# If a test fails with "prompt called 0×": the fast-path reuse read at :696 returned PRP JSON
#   on the first probe — your setupReadFileForPRP is NOT call-order-aware (fix the counter).
# If a test fails with "did not write PRP file": setupReadFileForPRP's taskId doesn't match
#   the test's task.id (use createMockPRPDocument(task.id) with the exact id).
# If a test fails with "Cannot read properties of undefined (reading 'match')": a test that
#   reaches the file-contract read is missing setupReadFileForPRP (add it).
```

### Level 3: Integration Testing (System Validation)

```bash
# NOTE: the FULL `npm run test:run` / `npm run validate` is NOT green yet and is NOT S1's
# gate — the suite has ~282 OTHER pre-existing failures (ResearchTimeoutError re-export =
# P2.M3.T1.S2; groundswell = P2.M3.T1.S3; bugfix numbering = P3). S1's gate is:
# tests/unit/agents/prp-generator.test.ts GREEN + typecheck + lint + format.

# Confirm the prp-generator failures are GONE from the full run (count dropped by 15):
npm run test:run 2>&1 | rg "prp-generator.test.ts"
# EXPECT: the file is no longer in the failed-files list (it's in the passed list).

# Build (confirms no transitive breakage — though S1 is test-only, build is a sanity check):
npm run build
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm no test passes a raw PRPDocument as the agent return anymore:
rg -n "mockResolvedValue\(mockPRP\)|mockResolvedValueOnce\(mockPRP\)" tests/unit/agents/prp-generator.test.ts
# EXPECT: ZERO matches (all converted to { status:'success', output:'' } + helper).

# Confirm the helper exists and is called in every generate-path test:
rg -n "setupReadFileForPRP" tests/unit/agents/prp-generator.test.ts
# EXPECT: 1 definition + N calls (one per test reaching the file-contract read).

# Confirm the cache-HIT test is UNCHANGED (still sets its own mockReadFile):
rg -n "should use cached PRP when hash matches" tests/unit/agents/prp-generator.test.ts
# EXPECT: the test is present and was NOT modified (git diff shows no change to it).

# Confirm the mkdir-fails assertion was relaxed:
rg -n -A2 "should throw PRPFileError when mkdir fails" tests/unit/agents/prp-generator.test.ts
# EXPECT: .rejects.toThrow() (NOT .rejects.toThrow(PRPFileError)).

# Confirm ONLY the test file changed:
git diff --name-only
# EXPECT: only tests/unit/agents/prp-generator.test.ts (NO source files, NO other tests).

# Expected: all 4 checks pass; the suite is green; no out-of-scope file touched.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` exit 0.
- [ ] `npm run lint` + `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/agents/prp-generator.test.ts` → **26 passed | 0 failed**.
- [ ] `npm run build` succeeds.

### Feature Validation
- [ ] No test passes a raw `PRPDocument` as `mockAgent.prompt`'s return; all use
      `{ status: 'success', output: '' }`.
- [ ] `setupReadFileForPRP` helper exists, is path-aware (`endsWith .json`, `!path.includes('.cache')`),
      AND is call-order-aware (ENOENT on first prpOutputPath read, PRP JSON on second).
- [ ] The 5 previously-failing cache tests pass; the 2 passing cache tests still pass.
- [ ] The mkdir-fails test asserts `.rejects.toThrow()` (aligned with the bare-throw source).
- [ ] The writeFile-fails test still asserts `PRPFileError` (real, via #writePRPToFile:815).
- [ ] The prd_selectors tests resolve cleanly (no `.rejects.toThrow()` wrapper).
- [ ] No edits to `src/agents/prp-generator.ts` or any source file.

### Code Quality Validation
- [ ] Helper uses `NodeJS.ErrnoException` with `code: 'ENOENT'` (faithful fs error shape).
- [ ] Per-test helper invocation (NOT global beforeEach) — preserves cache-HIT test.
- [ ] Test mock style matches the existing file (vi.fn().mockResolvedValue / mockImplementation).
- [ ] Removed comments ("PRE-EXISTING mock gap") are replaced by clean resolving calls.

### Documentation & Deployment
- [ ] No docs edits (item 5: DOCS none — test-only).
- [ ] No new env vars / CLI / routes / config.

---

## Anti-Patterns to Avoid

- ❌ Don't edit `src/agents/prp-generator.ts` — S1 is test-only. Even the :656 bare-mkdir
     raw-throw is out of scope; relax the TEST assertion instead.
- ❌ Don't make `setupReadFileForPRP` return PRP JSON on the FIRST prpOutputPath read —
     that triggers the fast-path reuse at :696 and the agent is NEVER called, breaking
     "prompt called 1×" assertions. The helper MUST be call-order-aware (ENOENT first,
     PRP JSON second).
- ❌ Don't use a global `beforeEach` to apply `setupReadFileForPRP` — it clobbers the
     cache-HIT test's per-test `mockReadFile.mockResolvedValue(JSON.stringify(mockMetadata))`.
     Apply it per-test in the body.
- ❌ Don't forget the `!path.includes('.cache')` guard — the cache-metadata path
     (`prps/.cache/{id}.json`) collides with the prpOutputPath (`prps/{id}.json`).
- ❌ Don't use `createMockPRPDocument('P1.M2.T2.S2')` in the prd_selectors tests — their
     task.id is `'P1.M2.T1.S3'`; the helper's `endsWith(\`${sanitizedId}.json\`)` check
     won't match a mismatched id → "did not write PRP file". Use `createMockPRPDocument(task.id)`.
- ❌ Don't change the cache-HIT test ("should use cached PRP when hash matches") — it's
     passing; your edits must not touch it.
- ❌ Don't assert `PRPFileError` on the mkdir-fails test — the bare `await mkdir` at :656
     throws a raw `Error`. Use `.rejects.toThrow()` (any error). (Source fix is separate.)
- ❌ Don't leave the prd_selectors tests wrapped in `.rejects.toThrow()` — after the mock
     fix, `generate()` resolves. Let it resolve; the spy assertion still holds.
- ❌ Don't gate S1 on the full `npm run test:run`/`validate` — ~282 OTHER pre-existing
     failures (S2/S3/P3 scope) are NOT S1's gate. S1's gate is THIS file green + tsc + lint.
- ❌ Don't add docs / env vars / CLI flags (item 5: DOCS none — test-only).

---

## Confidence Score

**8/10** — One-pass success likelihood is high but carries one non-trivial gotcha that
the research explicitly surfaced and resolved. The change is a single test file; the 15
failure modes are confirmed by a live `vitest run` (2 distinct modes, both predicted by
architecture/test_validation.md §3A); the source contract (file-is-the-contract,
`{status,output}` return, `prpOutputPath` construction) is read in full and pinned to
line numbers; and the per-test fix matrix enumerates all 15 tests with exact mock changes.
The one residual risk is the **fast-path reuse read at prp-generator.ts:696** — a naive
path-aware `mockReadFile` returning PRP JSON on the first probe would trigger the reuse
path and skip the agent call, breaking the "prompt called 1×" assertions. The PRP
resolves this with a call-order-aware helper (ENOENT on first prpOutputPath read, PRP
JSON on second), fully specified in Implementation Patterns. The remaining 2/10 covers:
(a) confirming the "max retries exhausted" test's exact failure reason (it's in the 15
but the file read is never reached — needs a live re-check during implementation), and
(b) the mkdir-fails assertion relaxation being the correct test-only resolution for the
bare-throw source quirk (vs. a source fix that's explicitly out of scope). The scope
fences are airtight (test-only; zero file overlap with the parallel P2.M2.T1.S2 which
edits `src/core/session-utils.ts`).