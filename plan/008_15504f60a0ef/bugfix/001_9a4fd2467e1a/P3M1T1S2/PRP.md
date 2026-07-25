# PRP — P3.M1.T1.S2: Update runQACycle() to create numbered bugfix/NNN_hash/ directories

---

## Goal

**Feature Goal**: Replace the flat `resolve(sessionPath, 'bugfix')` directory
creation in `runQACycle()` (PRD §4.4 step 3, §5.1; bugfix doc Issue 4) with a
call to the S1 `nextBugfixDir()` helper so each bug-hunt iteration that finds
bugs creates a **numbered `bugfix/NNN_hash/`** child — archiving (not
overwriting) prior iterations. The `mkdir({ recursive: true })`,
`TEST_RESULTS.md` copy, and `#runBugFixCycle(...)` call all stay; only the
**path source** changes from flat to numbered. The path still contains
`'bugfix'`, so `FixCycleWorkflow`'s validation (PRD §5.1) is unchanged.

**Deliverable**:
1. **`src/workflows/prp-pipeline.ts`** — MODIFY `runQACycle()` (≈lines 1858-1885):
   - **ADD** `nextBugfixDir` to the **existing** `../core/session-utils.js`
     top-level import block (line ≈62 — already imports from that module; just
     extend it). **No new import line.**
   - **REPLACE** line 1862
     (`const bugfixSessionPath = resolve(sessionPath, 'bugfix');`) with:
     ```ts
     const { dir: bugfixSessionPath } = await nextBugfixDir(
       sessionPath,
       testResults.summary ?? JSON.stringify(testResults.bugs)
     );
     ```
   - **PRESERVE** verbatim: the `const { resolve } = await import('node:path')`
     line (still needed for TEST_RESULTS.md / bug_hunt_results.json paths), the
     `const { mkdir, copyFile } = await import('node:fs/promises')` line, the
     `mkdir(bugfixSessionPath, { recursive: true })` call, BOTH `copyFile(...)`
     calls (primary TEST_RESULTS.md + the bug_hunt_results.json fallback), the
     `logger.info` line, and the `#runBugFixCycle(bugfixSessionPath, prdContent)`
     call. All operate on `bugfixSessionPath`, which is now the numbered dir.
2. **`tests/unit/workflows/prp-pipeline.test.ts`** — MODIFY:
   - **ADD `readdir` to the existing `vi.mock('node:fs/promises', …)` block**
     (lines 17-23) as `readdir: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))`
     — so the REAL `nextBugfixDir` (exposed via the `session-utils.js` mock's
     `...actual` spread, line 30-38) gets a controlled ENOENT → sequence 1
     instead of `TypeError: readdir is not a function`. **This is the single
     most important test-stability fix** (see Known Gotchas).
   - **ADD** a unit test asserting the numbered-dir creation path:
     `nextBugfixDir` is called with `sessionPath` + a seed derived from
     `testResults`; `mkdir` receives a path matching `/bugfix\/001_<12hex>$/`;
     `#runBugFixCycle` receives that same numbered path.
3. **(No other files.)** No docs (contract item 5 DOCS: none). No
   `#detectInterruptedBugfix` change (that's S3). No lifecycle suite (S4).

**Success Definition**:
- When `runQACycle()` finds bugs (`testResults.hasBugs === true`), it creates
  `<sessionPath>/bugfix/NNN_<12hexhash>/` (NNN = next sequence from the
  `bugfix/` listing; 12hex = `hashPRDContent(seed).slice(0,12)`), NOT the flat
  `<sessionPath>/bugfix/`.
- Re-running QA after a prior numbered iteration exists creates `002_<hash>/`,
  `003_<hash>/`, … — prior iterations are preserved (archived, not overwritten).
- `mkdir({ recursive: true })` still creates both the numbered child AND the
  parent `bugfix/` when absent.
- `TEST_RESULTS.md` is copied INTO the numbered dir; `#runBugFixCycle` runs in
  the numbered dir.
- The path still contains `'bugfix'` → `FixCycleWorkflow` validation passes.
- All existing `runQACycle` tests stay GREEN (the `readdir` mock addition makes
  `nextBugfixDir` return cleanly); `npm run validate` GREEN; 100% coverage on
  `src/**/*.ts` preserved.

---

## User Persona (if applicable)

**Target User**: The pipeline's QA loop — internal caller, not a human.
**Use Case**: A bug-hunt iteration finds bugs → `runQACycle` calls
`nextBugfixDir(sessionPath, bugReportContent)` → gets `{ dir, sequence }` →
`mkdir(dir)` → copies `TEST_RESULTS.md` → runs `#runBugFixCycle(dir, prdContent)`.
Each iteration gets a unique `bugfix/NNN_hash/`, archiving prior iterations.
**User Journey**: QA run #1 (bugs found) → `bugfix/001_<hash>/` created &
fixed. QA run #2 (more bugs) → `bugfix/002_<hash>/` created (001 preserved).
**Pain Points Addressed**: Today only ONE flat `bugfix/` dir exists per session;
re-running QA overwrites the prior iteration — no audit trail. PRD §4.4 step 3
& §5.1 mandate numbered iterations `bugfix/001_hash/`, `bugfix/002_hash/`.

---

## Why

- **PRD compliance**: PRD §4.4 step 3 — *"Each bug hunt iteration creates a new
  numbered session: `bugfix/001_hash/`, `bugfix/002_hash/`, etc."*; §5.1 —
  *"Session structure: `plan/NNN_hash/bugfix/NNN_hash/`"*. The bugfix doc Issue 4
  (h3.3) classifies the current flat-dir behavior as a Minor defect with this
  exact fix: *"Number bugfix sessions (`bugfix/NNN_hash/`) … archive rather than
  overwrite prior iterations."*
- **Audit trail**: numbering preserves prior bugfix iterations (no overwrite),
  enabling the audit/recovery semantics PRD §4.4 expects.
- **Foundational for S3**: `#detectInterruptedBugfix()` (S3) must scan numbered
  `bugfix/NNN_hash/` children — it can only do so once `runQACycle` CREATES them
  (S2). S2 and S3 land together as P3.M1.T1 (mutual consistency per architecture
  doc).
- **Consistency**: uses the S1 `nextBugfixDir` helper, which mirrors the EXISTING
  `NNN_hash` convention for top-level sessions — no new naming scheme.

### Out of scope (hard fences)
- **`#detectInterruptedBugfix()` scan rewrite** → S3 (≈line 2045). S2 does NOT
  touch detection; it only changes CREATION.
- **Full numbered-iteration lifecycle tests** → S4. S2 adds only the
  creation-path unit test it needs for coverage + to lock the new behavior.
- **README.md / docs/ARCHITECTURE.md** → P3.M1.T2.S1. S2 = no docs (contract
  item 5 DOCS: none — covered by S1's JSDoc).
- **`FixCycleWorkflow`** → READ-ONLY (path still contains `'bugfix'`; architecture
  doc confirms the `includes('bugfix')` check passes unchanged).
- **`nextBugfixDir` / `generateBugfixHash` helpers themselves** → S1 (DONE as
  contract). S2 IMPORTS `nextBugfixDir` only.
- **`PRD.md` / `tasks.json` / `prd_snapshot.md` / `vitest.config.ts`** → READ-ONLY.

---

## What

### User-visible behavior
None at the CLI/config surface (internal behavior change). Operators who re-run
QA after bugs were fixed will observe (in logs + on disk) a new
`bugfix/NNN_hash/` directory per iteration instead of a single overwritten
`bugfix/`.

### Technical requirements (exact contract — item 3)

**(a) The edit (`prp-pipeline.ts` runQACycle ≈line 1862).** A one-line
replacement + a one-symbol import addition. The import: `prp-pipeline.ts` ALREADY
imports from `../core/session-utils.js` (line ≈62, a multi-symbol import block).
**ADD `nextBugfixDir`** to that existing block — do NOT create a new import line.
Then:

```ts
// BEFORE (line 1860-1862):
const { resolve } = await import('node:path');
const { mkdir, copyFile } = await import('node:fs/promises');
const bugfixSessionPath = resolve(sessionPath, 'bugfix');

// AFTER:
const { resolve } = await import('node:path');
const { mkdir, copyFile } = await import('node:fs/promises');
// PRD §4.4 step 3 / §5.1: numbered bugfix/NNN_hash/ iteration (archives prior
// iterations instead of overwriting a flat bugfix/ dir). nextBugfixDir is
// read-only (returns the path + sequence); mkdir below creates it (+ parent
// bugfix/ if absent). The path still contains 'bugfix' for FixCycleWorkflow.
const { dir: bugfixSessionPath } = await nextBugfixDir(
  sessionPath,
  testResults.summary ?? JSON.stringify(testResults.bugs)
);
```

**Everything below this line is UNCHANGED** (it all references `bugfixSessionPath`):
`await mkdir(bugfixSessionPath, { recursive: true })`, the
`testResultsPath`/`copyFile` try block (+ `bug_hunt_results.json` fallback
`.catch`), `logger.info(...)`, and
`const fixResults = await this.#runBugFixCycle(bugfixSessionPath, prdContent)`.

**(b) Hash seed.** `testResults: TestResults` (src/core/models.ts:2102) is in
scope at the edit site. Use `testResults.summary ?? JSON.stringify(testResults.bugs)`
as the seed:
- `summary` is the natural in-memory "bug report content" proxy (the contract
  item 2 says "The hash seed can be derived from the bug report content").
- `?? JSON.stringify(testResults.bugs)` is the fallback if `summary` is
  empty/undefined (keeps the seed deterministic per distinct bug set).
- **Determinism note:** the SAME bugs → the SAME hash → but NNN is driven by the
  dir LISTING (max+1), so a re-run after a prior iteration gets a NEW NNN
  (`002_`, `003_`) even with an identical hash. Correct PRD §4.4 behavior.

**(c) Test mock addition (`prp-pipeline.test.ts` lines 17-23).** The existing
`vi.mock('node:fs/promises', …)` lists `readFile, writeFile, mkdir, copyFile,
stat` but **NOT `readdir`**. S1's real `nextBugfixDir` (exposed to tests via the
`session-utils.js` mock's `...actual` spread at line 30-38) calls
`readdir(bugfixDir, { withFileTypes: true })`. Without `readdir` in the fs mock,
that call is `undefined` → `TypeError`, breaking ALL existing `runQACycle`
fix-spawn tests (lines 692-810). **ADD:**

```ts
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn(),
  readdir: vi
    .fn()
    .mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  //    ↑ ENOENT → nextBugfixDir treats it as "first iteration" → sequence 1.
  //      Clean, deterministic, no real FS access. Per-test tests can override
  //      with vi.mocked(readdir).mockResolvedValue([...]) for the numbered test.
}));
```

**(d) New unit test (`prp-pipeline.test.ts`, inside `describe('runQACycle', …)`
≈line 621).** Add a case that exercises the fix-spawn branch (`hasBugs: true`)
and asserts the numbered-dir creation:

```ts
it('creates a numbered bugfix/NNN_hash/ dir (not flat bugfix/) when bugs found', async () => {
  // SETUP — all-Complete backlog, bug-hunt mode, bugs found, fix resolves clean
  // (mirror the existing 'forwards PARALLEL_RESEARCH' test setup lines 692-740)
  // …backlog + mockSession + mockManager + pipeline wiring + MockBugHuntWorkflow(hasBugs:true) + MockFixCycleWorkflow(hasBugs:false)…

  // OVERRIDE the default ENOENT readdir mock to assert sequence 1 path shape:
  const { readdir } = await import('node:fs/promises');
  vi.mocked(readdir).mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

  // EXECUTE
  await pipeline.runQACycle();

  // VERIFY — mkdir was called with a numbered bugfix/NNN_hash/ path
  const { mkdir } = await import('node:fs/promises');
  expect(mkdir).toHaveBeenCalledWith(
    expect.stringMatching(/bugfix[\\/]\d{3}_[a-f0-9]{12}$/),
    { recursive: true }
  );
  // VERIFY — #runBugFixCycle (via MockFixCycleWorkflow) received the SAME numbered path
  expect(MockFixCycleWorkflow).toHaveBeenCalledWith(
    expect.stringMatching(/bugfix[\\/]\d{3}_[a-f0-9]{12}$/),
    expect.any(String),
    expect.anything(),
    expect.anything(),
    expect.anything()   // the parallel-config object (shape varies by env)
  );
});
```

### Success Criteria
- [ ] `runQACycle` with `hasBugs:true` calls `nextBugfixDir(sessionPath, <seed>)`
      and uses the returned `dir` as `bugfixSessionPath` (no more flat
      `resolve(sessionPath,'bugfix')`).
- [ ] `mkdir` is called with a path matching `/bugfix[\\/]\d{3}_[a-f0-9]{12}$/`
      (numbered, 3-digit sequence, 12-hex hash).
- [ ] `#runBugFixCycle` receives that same numbered path.
- [ ] `TEST_RESULTS.md` (or the `bug_hunt_results.json` fallback) is copied into
      the numbered dir (the copyFile calls are unchanged but now target the
      numbered path).
- [ ] Prior iterations are preserved: a second QA run with an existing
      `bugfix/001_<hash>/` yields `bugfix/002_<hash>/` (assertable by overriding
      `readdir` to return `[{name:'001_aaaaaaaaaaaa', isDirectory:()=>true}]`).
- [ ] All existing `runQACycle` tests stay GREEN (the `readdir` ENOENT mock makes
      `nextBugfixDir` return sequence 1 cleanly).
- [ ] `npm run validate` GREEN; 100% coverage on `src/**/*.ts` preserved.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** This is a 2-file change (one source edit of ~5 lines + one test edit).
Its correctness hinges on nine pre-proven facts, all pinned with file:line anchors
below: (1) the **exact edit site** — `runQACycle` line 1862
`const bugfixSessionPath = resolve(sessionPath, 'bugfix')`; (2) **everything
below line 1862 is UNCHANGED** (mkdir/copyFile/logger/#runBugFixCycle all operate
on `bugfixSessionPath`); (3) **`prp-pipeline.ts` ALREADY imports from
`../core/session-utils.js`** (line ≈62) — just extend that block with
`nextBugfixDir`, no new import line; (4) **`testResults: TestResults` is in scope**
at the edit site (assigned Phase 1, used in the `hasBugs` guard) and has
`.summary` + `.bugs` (src/core/models.ts:2102) for the seed; (5) **the S1
`nextBugfixDir` contract** — `Promise<{dir, sequence}>`, read-only, ENOENT→seq 1,
mirrors the `NNN_hash` convention; (6) **the test file ALREADY mocks
`session-utils.js` with `...actual`** (line 30-38) so the REAL `nextBugfixDir`
flows through — BUT the `node:fs/promises` mock (line 17-23) LACKS `readdir`, so
the real `nextBugfixDir`'s `readdir(...)` is `undefined` → TypeError unless
`readdir` is added to the fs mock (THE critical test-stability gotcha); (7) the
existing `runQACycle` fix-spawn tests (692-810) assert `MockFixCycleWorkflow` with
`expect.any(String)` for the path — they DON'T pin the exact `bugfix/` string, so
swapping to numbered leaves them GREEN as long as `readdir` is mocked; (8)
**`FixCycleWorkflow`'s `includes('bugfix')` check** passes unchanged on
`bugfix/NNN_hash/` (architecture doc confirms); (9) **100% branch coverage** —
the source change is branch-free (a one-line replacement in an already-async
context); the only coverage risk is the seed-selection `??` expression, which
should be covered by tests exercising both `summary`-present and `summary`-empty
inputs OR kept as a single non-branching expression.

### Documentation & References
```yaml
# MUST READ — the PRD spec (provided in selected_prd_content)
- docfile: PRD.md (bugfix doc)
  section: "Issue 4: Bugfix sessions use a flat bugfix/ directory" (h3.3) +
       "Overview" (h2.0, names Issue 4 as in-scope)
  why: Issue 4 is the normative rule S2 implements — "Number bugfix sessions
       (bugfix/NNN_hash/) … archive rather than overwrite prior iterations."
       Cites PRD §4.4 step 3 + §5.1.
  critical: The NNN_hash pattern is mandated by PRD §5.1 "plan/NNN_hash/bugfix/NNN_hash/".
            The flat `resolve(sessionPath,'bugfix')` at prp-pipeline.ts:1862 is the
            exact line to replace.

# MUST READ — this subtask's research (proven facts about the working tree)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P3M1T1S2/research/s2-codebase-analysis.md
  section: §1 (exact edit site + verbatim BEFORE/AFTER), §2 (S1 helper contract),
       §3 (hash seed derivation), §4 (import strategy — extend existing block),
       §5 (resolve stays), §6 (test impact — the readdir-mock gap + resume-branch
       mutual-consistency note), §7 (coverage), §8 (scope fences), §9 (validation),
       §10 (the minimal surgical change)
  why: Proves the one-line edit, the existing-import-block extension, the in-scope
       testResults seed, the CRITICAL readdir-mock gap that breaks existing tests
       if missed, and that all downstream code is path-agnostic.

# MUST READ — S1 contract (the helper this PRP consumes)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P3M1T1S1/PRP.md
  section: "Goal" (nextBugfixDir signature + read-only contract) + "What §a"
       (the helper body + ENOENT→seq1 semantics)
  why: S2 CONSUMES nextBugfixDir(sessionPath, hashSeed) → Promise<{dir, sequence}>.
       It is read-only (S2 owns mkdir). ENOENT on bugfix/ → sequence 1. Mirrors
       the NNN_hash convention. S2 must NOT reimplement it.

# MUST READ — architecture reference (cited by the contract's RESEARCH NOTE)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/architecture/bugfix_numbering.md
  section: "### Current State" (the flat-dir code at ~1730) + "### Fix Strategy"
       step 3 ("Update runQACycle() to create numbered directories") + "### Key
       File Paths" (runQACycle at ~1700) + "### Mutual Consistency Note" +
       "### FixCycleWorkflow Path Validation"
  why: Confirms the flat current state, the numbered fix strategy, the exact
       method/location, that creation+detection must stay mutually consistent
       (S3's job), and that FixCycleWorkflow's includes('bugfix') check passes
       unchanged on the numbered path.

# THE FILE TO EDIT — source (the runQACycle creation path)
- file: src/workflows/prp-pipeline.ts
  section: (1) top-level import block from '../core/session-utils.js' (≈line 62) —
       ADD nextBugfixDir to it; (2) runQACycle Phase 2 fix-spawn block (≈1858-1885) —
       REPLACE line 1862 only.
  why: This is the sole creation site for bugfix dirs. Everything downstream
       (mkdir, copyFile, #runBugFixCycle) is path-agnostic — it operates on
       `bugfixSessionPath`, so changing only the path SOURCE is sufficient.
  pattern: the existing dynamic `await import('node:path')` / `await import('node:fs/promises')`
       local style (preserve it — only the bugfixSessionPath assignment changes).
  gotcha: ADD nextBugfixDir to the EXISTING session-utils.js import block (line 62),
       NOT a new import line. Do NOT remove the `const { resolve } = await import('node:path')`
       line (still needed for TEST_RESULTS.md / bug_hunt_results.json paths). Do NOT
       touch #detectInterruptedBugfix (~line 2045) — that's S3.

# THE FILE TO EDIT — tests (the readdir mock gap + new creation-path test)
- file: tests/unit/workflows/prp-pipeline.test.ts
  section: (1) vi.mock('node:fs/promises', …) block (lines 17-23) — ADD readdir
       with an ENOENT default; (2) describe('runQACycle') (≈621) — ADD the
       numbered-dir creation test.
  why: Without adding readdir to the fs mock, the REAL nextBugfixDir (exposed via
       the session-utils.js mock's ...actual spread at line 30-38) throws TypeError
       on readdir(...) → breaks ALL existing runQACycle fix-spawn tests. The new
       test locks the numbered-dir creation behavior.
  pattern: the existing 'forwards PARALLEL_RESEARCH + RESEARCH_DEPTH to
       FixCycleWorkflow' tests (692-810) — mirror their setup (all-Complete
       backlog, bug-hunt mode, MockBugHuntWorkflow hasBugs:true, MockFixCycleWorkflow
       hasBugs:false). Use vi.mocked(readdir).mockRejectedValueOnce(...) and
       expect.stringMatching(/bugfix[\\/]\d{3}_[a-f0-9]{12}$/).
  gotcha: the existing fs mock does NOT list readdir — adding it is MANDATORY or
       the real nextBugfixDir crashes. Default to ENOENT (→ sequence 1, clean).
       For the "second iteration" assertion, override readdir to return a Dirent-like
       array [{name:'001_aaaaaaaaaaaa', isDirectory:()=>true}]. The MockFixCycleWorkflow
       5th arg (parallel config) varies by env — use expect.anything() for it.

# CONTRACT INPUTS (read-only)
- file: src/core/session-utils.ts
  section: nextBugfixDir (added by S1, ≈line 755+).
  why: Confirms the helper signature + read-only contract S2 consumes. S2 does NOT edit it.

- file: src/core/models.ts
  section: TestResults interface (line 2102) — hasBugs, bugs, summary fields.
  why: Confirms testResults.summary + testResults.bugs are the seed sources.

- file: vitest.config.ts
  why: 100/100/100/100 thresholds on src/**/*.ts — the source change is branch-free;
       the only coverage risk is the seed ?? fallback (cover both or keep simple).
- file: package.json
  why: npm run validate = lint + format:check + typecheck + test:run (the green gate).
```

### Current Codebase tree (relevant slice)
```bash
src/
  workflows/
    prp-pipeline.ts            # EDIT — +nextBugfixDir to existing session-utils import; replace line 1862
  core/
    session-utils.ts           # READ-ONLY (S1) — nextBugfixDir lives here
    models.ts                  # READ-ONLY — TestResults interface (seed source)
tests/
  unit/
    workflows/
      prp-pipeline.test.ts     # EDIT — +readdir to fs mock; +numbered-dir creation test
vitest.config.ts               # READ-ONLY — 100% coverage thresholds
package.json                   # READ-ONLY — npm run validate gate
PRD.md (bugfix doc)            # READ-ONLY — Issue 4 (h3.3) + §4.4/§5.1
```

### Desired Codebase tree with files to be added and responsibility of file
```bash
src/workflows/prp-pipeline.ts            # MODIFIED — runQACycle creates numbered bugfix/NNN_hash/ dirs
tests/unit/workflows/prp-pipeline.test.ts # MODIFIED — readdir fs-mock + numbered-dir creation unit test
# (no NEW files)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL (readdir missing from the fs mock — THE test-stability fix):
// tests/unit/workflows/prp-pipeline.test.ts:17-23 mocks node:fs/promises WITH
// readFile/writeFile/mkdir/copyFile/stat but WITHOUT readdir. The session-utils.js
// mock (line 30-38) uses `...actual` (importOriginal spread), so the REAL
// nextBugfixDir from S1 flows through — and it calls readdir(bugfixDir, {withFileTypes:true}).
// Without readdir in the fs mock, that call is `undefined` → TypeError → EVERY
// existing runQACycle fix-spawn test (692-810) breaks. FIX: add
//   readdir: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
// to the fs mock. ENOENT → nextBugfixDir returns sequence 1 (clean, no real FS).

// CRITICAL (extend the EXISTING import, don't add a new line): prp-pipeline.ts:62
// already has a multi-symbol import block from '../core/session-utils.js'. ADD
// nextBugfixDir to THAT block. A second `import { nextBugfixDir } from '../core/session-utils.js'`
// line would be a duplicate-import lint error.

// CRITICAL (keep `const { resolve } = await import('node:path')`): line 1860.
// resolve is STILL needed for resolve(sessionPath,'TEST_RESULTS.md'),
// resolve(bugfixSessionPath,'TEST_RESULTS.md'), and
// resolve(sessionPath,'bug_hunt_results.json'). Only the bugfixSessionPath
// ASSIGNMENT (line 1862) changes — the resolve destructure stays.

// CRITICAL (everything below line 1862 is path-agnostic): mkdir(bugfixSessionPath),
// copyFile(..., resolve(bugfixSessionPath, 'TEST_RESULTS.md')), the fallback
// copyFile, logger.info, and #runBugFixCycle(bugfixSessionPath, prdContent) all
// operate on the `bugfixSessionPath` variable. Since you only change WHAT that
// variable holds (flat → numbered), NONE of those lines need editing. This is
// why the change is surgical and low-risk.

// CRITICAL (FixCycleWorkflow check passes unchanged): FixCycleWorkflow validates
// sessionPath.includes('bugfix'). The numbered path 'sessionPath/bugfix/001_<hash>/'
// STILL contains 'bugfix', so the check passes. Do NOT touch FixCycleWorkflow
// (architecture doc confirms).

// CRITICAL (mutual consistency with S3 — don't break the interim): #detectInterruptedBugfix
// (~line 2045) currently scans the FLAT bugfix/ dir. After S2 lands (numbered
// creation) but BEFORE S3 lands (numbered scan), a session interrupted mid-fix
// won't be auto-resumed. This is EXPECTED — S2 and S3 land together as P3.M1.T1.
// S2 does NOT touch #detectInterruptedBugfix (scope fence). Just NOTE the
// dependency in the commit/PR.

// GOTCHA (seed determinism vs sequence): nextBugfixDir hashes the seed for the
// 12-hex SUFFIX only. The NNN prefix comes from scanning the dir LISTING (max+1).
// So identical bugs (same hash) on a re-run still get a NEW NNN (002_, 003_) —
// correct archive behavior. Don't try to make the seed drive NNN.

// GOTCHA (100% coverage + the `??` operator): `testResults.summary ?? JSON.stringify(...)`
// is a nullish-coalescing EXPRESSION, not a branch statement — but vitest/instanbul
// MAY count it as a branch. If coverage flags it, add a test with summary:'' (or
// undefined) to exercise the fallback. Prefer keeping the seed as a single
// expression (no if/else) to minimize branch surface.

// GOTCHA (MockFixCycleWorkflow 5th arg): the existing tests (692-810) assert the
// 5th arg is { parallelResearch, researchDepth }. In the new test, use
// expect.anything() for it (or stub env like the existing tests do) so the
// assertion doesn't耦合 to env state.

// GOTCHA (Dirent mock shape for the "second iteration" assertion): if you add a
// test that a prior bugfix/001_<hash>/ exists, override readdir to return
// [{ name: '001_aaaaaaaaaaaa', isDirectory: () => true }] — needs .name (string)
// + .isDirectory() (fn→bool), matching S1's helper expectations.
```

---

## Implementation Blueprint

### Data models and structure
No new data models. S2 consumes S1's `nextBugfixDir` return type
(`{ dir: string; sequence: number }`) and the existing `TestResults` interface
(`src/core/models.ts:2102`) for the seed. No type-level additions.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: MODIFY src/workflows/prp-pipeline.ts — extend import + replace line 1862
  - EDIT the existing top-level import from '../core/session-utils.js' (≈line 62):
    ADD `nextBugfixDir` to the destructured symbol list (preserve all existing
    symbols; keep alphabetical/clean order matching the file's style).
  - EDIT runQACycle Phase 2 fix-spawn block (≈line 1862): REPLACE
      const bugfixSessionPath = resolve(sessionPath, 'bugfix');
    WITH:
      const { dir: bugfixSessionPath } = await nextBugfixDir(
        sessionPath,
        testResults.summary ?? JSON.stringify(testResults.bugs)
      );
    (add a 2-3 line comment above citing PRD §4.4 step 3 / §5.1 + that the path
     still contains 'bugfix' for FixCycleWorkflow.)
  - PRESERVE verbatim: the `const { resolve } = await import('node:path')` line
    (1860), the `const { mkdir, copyFile } = await import('node:fs/promises')`
    line (1861), mkdir(bugfixSessionPath, {recursive:true}) (1863), the copyFile
    try/catch block (1864-1880), logger.info (1881), #runBugFixCycle (1884-1886).
  - FOLLOW pattern: the existing dynamic-import local style for fs/path; the
    existing import-block extension style for app modules.
  - GOTCHA: do NOT add a second import line for session-utils (extend the block).
    do NOT remove the resolve destructure. do NOT touch #detectInterruptedBugfix.

Task 2: MODIFY tests/unit/workflows/prp-pipeline.test.ts — readdir mock + new test
  - EDIT the vi.mock('node:fs/promises', …) block (lines 17-23): ADD
      readdir: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
    (ENOENT default → nextBugfixDir returns sequence 1 cleanly; no real FS).
  - ADD a test inside describe('runQACycle', …) (≈line 621, near the existing
    'forwards PARALLEL_RESEARCH' tests at 692-810):
      it('creates a numbered bugfix/NNN_hash/ dir (not flat bugfix/) when bugs found', async () => {
        // SETUP: mirror lines 692-740 (all-Complete backlog, mockSession,
        //   mockManager, pipeline wiring, mode='bug-hunt', MockBugHuntWorkflow
        //   hasBugs:true with bugs[], MockFixCycleWorkflow hasBugs:false).
        // OVERRIDE readdir default (already ENOENT — sequence 1):
        //   (no override needed for the seq-1 case; the mock default suffices)
        // EXECUTE: await pipeline.runQACycle();
        // VERIFY:
        //   const { mkdir } = await import('node:fs/promises');
        //   expect(mkdir).toHaveBeenCalledWith(
        //     expect.stringMatching(/bugfix[\\/]\d{3}_[a-f0-9]{12}$/),
        //     { recursive: true }
        //   );
        //   expect(MockFixCycleWorkflow).toHaveBeenCalledWith(
        //     expect.stringMatching(/bugfix[\\/]\d{3}_[a-f0-9]{12}$/),
        //     expect.any(String), expect.anything(), expect.anything(), expect.anything()
        //   );
      });
  - (OPTIONAL, for the archive/sequence behavior) ADD:
      it('creates 002_ when a 001_ bugfix iteration already exists', async () => {
        // …same setup…
        // const { readdir } = await import('node:fs/promises');
        // vi.mocked(readdir).mockResolvedValueOnce([
        //   { name: '001_aaaaaaaaaaaa', isDirectory: () => true },
        // ]);
        // await pipeline.runQACycle();
        // const { mkdir } = await import('node:fs/promises');
        // expect(mkdir).toHaveBeenCalledWith(
        //   expect.stringMatching(/bugfix[\\/]002_[a-f0-9]{12}$/),
        //   { recursive: true }
        // );
      });
    (This also covers the readdir success-branch if coverage flags it.)
  - FOLLOW pattern: the existing 'forwards PARALLEL_RESEARCH' test setup (692-740).
  - GOTCHA: the fs mock MUST get readdir or the real nextBugfixDir throws
    TypeError and ALL runQACycle fix-spawn tests break. The MockFixCycleWorkflow
    5th arg (parallel config) varies by env → use expect.anything().

Task 3: VERIFY — no regressions
  - RUN npm run typecheck → exit 0 (nextBugfixDir import resolves; destructure types).
  - RUN npx vitest run tests/unit/workflows/prp-pipeline.test.ts → ALL green
    (existing runQACycle + resume tests UNCHANGED in behavior; new test green).
  - RUN npx vitest run --coverage → 100/100/100/100 on src/**/*.ts (the source
    change is branch-free; if the `??` flags a branch, add the summary-empty case).
  - RUN npm run validate → GREEN.
  - RUN npm run build → succeeds.
  - VERIFY only the two intended files changed: git diff --name-only →
    src/workflows/prp-pipeline.ts, tests/unit/workflows/prp-pipeline.test.ts.
```

### Implementation Patterns & Key Details
```ts
// PATTERN: extend the existing session-utils import (prp-pipeline.ts ≈line 62).
// BEFORE (illustrative):  import { hashPRD, createSessionDirectory } from '../core/session-utils.js';
// AFTER:                  import { hashPRD, createSessionDirectory, nextBugfixDir } from '../core/session-utils.js';
// (extend the EXISTING block — do NOT add a second import line.)

// PATTERN: the surgical one-line replacement (prp-pipeline.ts ≈line 1862):
// BEFORE:  const bugfixSessionPath = resolve(sessionPath, 'bugfix');
// AFTER:
const { dir: bugfixSessionPath } = await nextBugfixDir(
  sessionPath,
  testResults.summary ?? JSON.stringify(testResults.bugs)
);
// Everything below (mkdir, copyFile x2, logger.info, #runBugFixCycle) is
// UNCHANGED — it all operates on `bugfixSessionPath`, now the numbered dir.

// PATTERN: the readdir fs-mock fix (prp-pipeline.test.ts lines 17-23):
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn(),
  readdir: vi.fn().mockRejectedValue(                      // ← MANDATORY addition
    Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) // → nextBugfixDir seq 1
  ),
}));

// PATTERN: assert the numbered path shape (new test):
expect(mkdir).toHaveBeenCalledWith(
  expect.stringMatching(/bugfix[\\/]\d{3}_[a-f0-9]{12}$/),  // NNN_<12hex>
  { recursive: true }
);

// CRITICAL: readdir MUST be in the fs mock or the real nextBugfixDir (exposed via
//   the session-utils.js mock's ...actual spread) throws TypeError → all runQACycle
//   fix-spawn tests break. This is THE test-stability fix.
// CRITICAL: keep `const { resolve } = await import('node:path')` — still needed.
// CRITICAL: do NOT touch #detectInterruptedBugfix (~line 2045) — that's S3.
// CRITICAL: the path still contains 'bugfix' → FixCycleWorkflow check passes.
```

### Integration Points
```yaml
PRP-PIPELINE (src/workflows/prp-pipeline.ts):
  - extend import: ADD `nextBugfixDir` to the existing '../core/session-utils.js' block (≈line 62).
  - replace: runQACycle line 1862 (flat resolve → nextBugfixDir destructure).
  - unchanged: resolve destructure, mkdir, copyFile (both), logger.info, #runBugfixCycle.

TESTS (tests/unit/workflows/prp-pipeline.test.ts):
  - add to fs mock: `readdir: vi.fn().mockRejectedValue(<ENOENT>)`.
  - add test: 'creates a numbered bugfix/NNN_hash/ dir when bugs found' (+ optional 002_ case).

NO SESSION-UTILS EDIT (nextBugfixDir is S1's, READ-ONLY for S2).
NO #detectInterruptedBugfix EDIT (S3).
NO DOCS (contract item 5 DOCS: none; covered by S1 JSDoc + P3.M1.T2.S1).
NO FIXCYCLEWORKFLOW (path still contains 'bugfix').
NO PRD.md / NO tasks.json / NO prd_snapshot.md / NO vitest.config.ts.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run typecheck        # tsc --noEmit → exit 0 (nextBugfixDir import + destructure compile)
npm run lint             # eslint . --ext .ts → no new violations (no duplicate import)
npm run format:check     # prettier --check; run `npm run format` if it complains
# Expected: Zero errors. The change is a 1-line replacement + 1-symbol import extension.
```

### Level 2: Unit Tests (Component Validation)
```bash
npx vitest run tests/unit/workflows/prp-pipeline.test.ts   # incl. existing runQACycle + new numbered-dir test
npx vitest run --coverage                                  # 100/100/100/100 on src/**/*.ts
npm run test:run                                           # full suite green
# Expected: ALL green. The readdir ENOENT mock keeps existing runQACycle fix-spawn
# tests green; the new test asserts the numbered path. If the `??` seed flags a
# coverage branch, add a summary-empty case.
```

### Level 3: Integration Testing (System Validation)
```bash
npm run validate      # lint + format:check + typecheck + test:run → GREEN
npm run build         # tsc -p tsconfig.build.json → succeeds

# Behavioral smoke (real FS, temp tree — confirms end-to-end numbering):
node --input-type=module -e "
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
// Build a minimal stand-in: this smoke just confirms nextBugfixDir numbering
// integrates with mkdir — full runQACycle requires the whole pipeline harness.
import { nextBugfixDir } from './dist/core/session-utils.js';
const tmp = '/tmp/bugfix-smoke-' + Date.now();
mkdirSync(tmp, { recursive: true });
const r1 = await nextBugfixDir(tmp, 'report-A');
await mkdirSync(r1.dir, { recursive: true });           // simulate runQACycle mkdir
const r2 = await nextBugfixDir(tmp, 'report-B');
await mkdirSync(r2.dir, { recursive: true });
console.log('iter1:', r1.sequence, r1.dir.endsWith('/bugfix/001_'));
console.log('iter2:', r2.sequence, r2.dir.endsWith('/bugfix/002_'));
console.log('001 preserved:', existsSync(r1.dir));
rmSync(tmp, { recursive: true, force: true });
"
# EXPECT: iter1: 1 true ; iter2: 2 true ; 001 preserved: true
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Confirm nextBugfixDir is imported + called in prp-pipeline.ts:
rg -n "nextBugfixDir" src/workflows/prp-pipeline.ts   # EXPECT: 1 import + 1 call site (in runQACycle)

# Confirm the flat resolve(sessionPath, 'bugfix') is GONE from runQACycle (still in #detectInterruptedBugfix until S3):
rg -n "resolve\(sessionPath, 'bugfix'\)" src/workflows/prp-pipeline.ts
# EXPECT: 1 match ONLY (in #detectInterruptedBugfix ≈line 2048, S3's territory — NOT in runQACycle)

# Confirm the fs mock now includes readdir:
rg -n "readdir" tests/unit/workflows/prp-pipeline.test.ts   # EXPECT: ≥1 (the mock + any per-test override)

# Confirm the numbered-path assertion exists:
rg -n "bugfix\[\\\\\\\\/\\\\\\\\\]\\\\d\{3\}_" tests/unit/workflows/prp-pipeline.test.ts
# EXPECT: ≥1 (the stringMatching assertion for NNN_<12hex>)

# Confirm only the two intended files changed:
git diff --name-only
# EXPECT: src/workflows/prp-pipeline.ts, tests/unit/workflows/prp-pipeline.test.ts
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` exit 0.
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run).
- [ ] `npm run build` succeeds.
- [ ] 100% coverage on `src/**/*.ts` preserved.

### Feature Validation
- [ ] `runQACycle` with `hasBugs:true` creates `bugfix/NNN_<12hex>/` (not flat
      `bugfix/`), verified by `mkdir` called with a path matching
      `/bugfix[\\/]\d{3}_[a-f0-9]{12}$/`.
- [ ] `#runBugFixCycle` receives the numbered path.
- [ ] `TEST_RESULTS.md` (or `bug_hunt_results.json` fallback) copied into the
      numbered dir.
- [ ] A second QA run with an existing `001_<hash>/` creates `002_<hash>/`
      (prior iteration preserved).
- [ ] Path still contains `'bugfix'` (FixCycleWorkflow validation unchanged).
- [ ] All existing `runQACycle` + resume tests stay GREEN (readdir ENOENT mock).

### Code Quality Validation
- [ ] `nextBugfixDir` added to the EXISTING session-utils import block (no dup line).
- [ ] Only line 1862 changed in runQACycle; everything downstream path-agnostic.
- [ ] The `const { resolve } = await import('node:path')` line preserved.
- [ ] `#detectInterruptedBugfix` UNTOUCHED (S3's scope).
- [ ] Seed derivation is a single expression (`summary ?? JSON.stringify(bugs)`).

### Documentation & Deployment
- [ ] No docs changes (contract item 5 DOCS: none — S1 JSDoc + P3.M1.T2.S1 cover it).
- [ ] A code comment above the new line cites PRD §4.4 step 3 / §5.1 + the
      FixCycleWorkflow 'bugfix' invariant.
- [ ] Commit/PR notes the S3 mutual-consistency dependency (detection scan lands next).

---

## Anti-Patterns to Avoid
- ❌ Don't **forget `readdir` in the `node:fs/promises` mock** — the REAL
  `nextBugfixDir` (exposed via the session-utils.js mock's `...actual` spread)
  calls `readdir(...)`. Without it in the fs mock, the call is `undefined` →
  TypeError → ALL existing `runQACycle` fix-spawn tests (692-810) break. This is
  THE test-stability fix.
- ❌ Don't add a **second `import { nextBugfixDir } from '../core/session-utils.js'`**
  line — `prp-pipeline.ts` already imports from that module (line ≈62). EXTEND
  the existing block or eslint flags a duplicate import.
- ❌ Don't remove the **`const { resolve } = await import('node:path')`** line —
  `resolve` is still needed for `TEST_RESULTS.md` / `bug_hunt_results.json` paths.
- ❌ Don't edit **`#detectInterruptedBugfix`** (~line 2045) — that's S3. S2 only
  changes CREATION (runQACycle), not DETECTION. Note the mutual-consistency
  dependency in the commit but don't implement S3's scan.
- ❌ Don't reimplement `nextBugfixDir` — it's S1's contract. S2 IMPORTS it.
- ❌ Don't touch `FixCycleWorkflow` — the numbered path still contains `'bugfix'`,
  so its `includes('bugfix')` validation passes unchanged (architecture doc confirms).
- ❌ Don't make the seed drive NNN — the hash is for the 12-hex SUFFIX only; NNN
  comes from the dir listing (max+1). Identical bugs on a re-run still get a new NNN.
- ❌ Don't add an `if/else` for seed selection if a single `??` expression suffices —
  branches add coverage overhead. If you must branch, cover both paths.
- ❌ Don't write the full numbered-iteration lifecycle suite — that's S4. S2 adds
  only the creation-path unit test it needs (+ optional 002_ case for the archive
  behavior).
- ❌ Don't touch PRD.md, tasks.json, prd_snapshot.md, or vitest.config.ts.

---

## Confidence Score

**9/10** — One-pass success likelihood is very high. S2 is a surgical 2-file
change: one source line replaced (1862) + one symbol added to an existing import
block, plus one mandatory test-mock addition (`readdir` to the fs mock) and one
new unit test. Every edit site is pinned with file:line anchors, and the key
insight — that **everything below line 1862 is path-agnostic** (mkdir/copyFile/
logger/#runBugFixCycle all operate on `bugfixSessionPath`) — means the change is
genuinely a one-line path-SOURCE swap with zero downstream edits. The correctness
rests on nine pre-proven facts: the exact edit site, the path-agnostic
downstream code, the existing session-utils import block (extend, don't dup), the
in-scope `testResults` seed, the S1 `nextBugfixDir` contract (read-only, ENOENT→1),
the **critical `readdir` fs-mock gap** (the single test-stability fix, explicitly
called out), the existing tests' `expect.any(String)` path assertions (tolerate
the numbered swap), the FixCycleWorkflow `'bugfix'` invariant, and the
branch-free source change (minimal coverage risk). The scope fences are airtight:
S2 edits ONLY `prp-pipeline.ts` (runQACycle) + `prp-pipeline.test.ts`; S1 owns
the helper, S3 owns detection, S4 owns the lifecycle suite, P3.M1.T2.S1 owns
docs — zero file overlap. The single notable risk — the `??` seed expression
flagging a coverage branch — is mitigated by an optional summary-empty test case.
The S3 mutual-consistency interim (creation numbered before detection numbered)
is expected and documented; S2+S3 land together as P3.M1.T1.