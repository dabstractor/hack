# S4 Codebase Analysis — Numbered bugfix iteration LIFECYCLE test suite

## Goal of this research
Pin the EXACT test patterns, factories, and mock seams S4 must use to write the
end-to-end numbered-iteration **lifecycle** test suite (contract items 3a-e).
S4 is TEST-ONLY (no source change). It must consume S1 (helper), S2 (creation),
S3 (detection) as contracts and prove they work together as a system.

---

## FACT 1 — S4 is test-only; S1/S2/S3 are the contracts

- **S1 (Complete):** `nextBugfixDir(sessionPath, hashSeed)` +
  `generateBugfixHash(seed?)` in `src/core/session-utils.ts`. Read-only helper,
  returns `{ dir, sequence }`. ENOENT→seq 1, max+1 otherwise. Uses
  `/^(\d{3})_/` regex + `hashPRDContent(seed).slice(0,12)`.
- **S2 (Implementing → treat as contract):** `runQACycle` in
  `src/workflows/prp-pipeline.ts` now calls
  `const { dir: bugfixSessionPath } = await nextBugfixDir(sessionPath, testResults.summary ?? JSON.stringify(testResults.bugs))`
  instead of flat `resolve(sessionPath,'bugfix')`. The `readdir` mock was added
  to `prp-pipeline.test.ts` (ENOENT default). **ALREADY LANDED in tests** (lines
  24-29 readdir mock; line 814 numbered-dir test; line 929 `002_` test).
- **S3 (Ready → treat as contract):** `#detectInterruptedBugfix` rewritten to
  scan numbered `bugfix/NNN_hash/` children via `readdir({withFileTypes:true})`,
  sort DESC, apply per-child `#isBugfixChildInterrupted` check, return
  most-recent interrupted or null. Swaps `BacklogSchema`→`BacklogReadSchema`.
  **NOT YET LANDED in source** (current source at 2054-2110 is still the FLAT
  version using `BacklogSchema`). S4 must assume S3 lands as specified.

**Implication for S4:** S4's lifecycle tests must stub `readdir` to return
numbered Dirent children (the S3 scan contract) AND stub `mockStat`/`mockReadFile`
with NNN-disambiguation (per-child state). The existing resume suite (lines
936-1113) uses `stubMissingTasks()` which stubs by SUFFIX (`endsWith(
'TEST_RESULTS.md')`) — that works for the FLAT dir but for NUMBERED children the
paths are `…/bugfix/001_<hash>/TEST_RESULTS.md`, so suffix matching STILL works
for single-child cases. For MULTI-child cases, S4 must disambiguate by the NNN
prefix in the path (`s.includes('001_')` vs `s.includes('002_')`).

---

## FACT 2 — The exact test factories + mock seams (prp-pipeline.test.ts)

### Test data factories (lines 252+, 975+):
- `createTestSession(backlog, prdContent?, sessionPath='/plan/001_14b9dc2a33c7')` —
  builds a SessionState; `sessionPath` sets `metadata.path`. Used by the resume
  suite as `buildBugHuntPipeline(sessionPath='/tmp/plan/008_test')` (line 975).
- `createTestBacklog([...phases])`, `createTestPhase/Milestone/Task/Subtask` —
  build the hierarchy. Status strings: 'Complete' | 'Planned' | 'Implementing'.
- `createMockSessionManager(session)` — returns a manager with `currentSession`.
- `createMockTaskOrchestrator()` — `{ processNextItem, rebuildQueue, ... }`.

### Module-level mocks (lines 17-182):
- `vi.mock('node:fs/promises', …)` (17-29): `readFile, writeFile, mkdir, copyFile,
  stat, readdir` (readdir added by S2, ENOENT default). Casts at 176-177:
  `const mockReadFile = readFile as any; const mockStat = stat as any;`.
  **S4 needs `const mockReaddir = readdir as any;`** (or use
  `vi.mocked((await import('node:fs/promises')).readdir)` per-test like S2 does).
- `vi.mock('../../../src/core/session-utils.js', …)` (36-45): `...actual` spread
  → REAL `nextBugfixDir` flows through (calls the mocked `readdir`). Only
  `resolvePRD` + `writeDeltaPRD` overridden.
- `vi.mock('../../../src/workflows/bug-hunt-workflow.js', …)` (89-100):
  `BugHuntWorkflow: vi.fn().mockImplementation(() => ({ run: vi.fn() }))`.
  Cast: `const MockBugHuntWorkflow = BugHuntWorkflow as any;` (181).
- `vi.mock('../../../src/workflows/fix-cycle-workflow.js', …)` (103-112):
  `FixCycleWorkflow: vi.fn().mockImplementation(() => ({ run: vi.fn() }))`.
  Cast: `const MockFixCycleWorkflow = FixCycleWorkflow as any;` (182).

### The runQACycle fix-spawn setup pattern (lines 814-872, mirror it):
```ts
const backlog = createTestBacklog([createTestPhase('P1','Phase 1','Complete',[
  createTestMilestone('P1.M1','Milestone 1','Complete',[
    createTestTask('P1.M1.T1','Task 1','Complete',[
      createTestSubtask('P1.M1.T1.S1','Subtask 1','Complete'),
    ]),
  ]),
])]);
const mockSession = createTestSession(backlog);
const mockManager = createMockSessionManager(mockSession);
const pipeline = new PRPPipeline('./test.md');
(pipeline as any).sessionManager = mockManager;
(pipeline as any).taskOrchestrator = createMockTaskOrchestrator();
(pipeline as any).mode = 'bug-hunt';  // forces QA to run

MockBugHuntWorkflow.mockImplementation(() => ({
  run: vi.fn().mockResolvedValue({ hasBugs: true, bugs: [...], summary: '...', recommendations: [] }),
}));
MockFixCycleWorkflow.mockClear();
MockFixCycleWorkflow.mockImplementation(() => ({
  run: vi.fn().mockResolvedValue({ hasBugs: false, bugs: [], summary: '...', recommendations: [] }),
}));
```

### The resume-suite shared helpers (lines 936-998, reuse them):
- `CLEAN_RESULTS`, `BUG_RESULTS`, `VALID_BACKLOG_JSON` constants.
- `buildBugHuntPipeline(sessionPath?)` — wires an all-Complete backlog pipeline
  in bug-hunt mode.
- `stubMissingTasks()` — stubs `mockStat` so `TEST_RESULTS.md` present +
  `tasks.json` ENOENT (interrupted). **NOTE: this stubs by SUFFIX, so it works
  for BOTH flat and numbered single-child paths.** For multi-child, S4 writes a
  custom `mockStat.mockImplementation` that disambiguates by NNN.

---

## FACT 3 — What S2/S3 already cover (S4 must NOT duplicate)

### S2's creation tests (ALREADY LANDED, lines 814-933):
- `creates a numbered bugfix/NNN_hash/ dir (not flat bugfix/) when bugs found`
  (814) — asserts `mkdir` called with `/bugfix[\\/]\d{3}_[a-f0-9]{12}$/`.
- `creates 002_ when a 001_ bugfix iteration already exists` (929) — overrides
  `readdir` to return `[{name:'001_aaaaaaaaaaaa', isDirectory:()=>true}]`,
  asserts `mkdir` called with `/bugfix[\\/]002_[a-f0-9]{12}$/`.

### S3's detection scan tests (per S3 PRP Task 4 — updates the resume suite):
S3 updates the existing 7 resume tests (936-1113) to stub `readdir` per-test,
AND adds multi-child scan tests:
- most-recent-interrupted wins (001+002 both interrupted → 002).
- healthy-most-recent → older-interrupted (001 interrupted + 002 healthy → 001).
- both healthy → null.
- ENOENT on bugfix/ → null.
- non-ENOENT readdir → rethrow.
- no numbered children (empty / non-NNN_) → null.
- child without TEST_RESULTS.md → skipped.

### THE GAP S4 FILLS (the LIFECYCLE):
S2 proves creation in isolation; S3 proves detection in isolation. **Neither
proves the full multi-iteration lifecycle as a coherent system:**
1. **Two-iteration creation lifecycle** (contract 3a+3b): call `runQACycle`
   TWICE on the same session (mocked bug-hunt + fix each time), assert
   `bugfix/001_<hash>/` AND `bugfix/002_<hash>/` BOTH received `mkdir` (001
   PRESERVED, not overwritten), AND `TEST_RESULTS.md` was copied into EACH.
   S2's existing tests mock a SINGLE `runQACycle` call; S4 chains TWO calls on
   the same pipeline, with `readdir` returning the prior iteration's dir on the
   2nd call (simulating the on-disk state advancing).
2. **Detect-most-recent-interrupted across the lifecycle** (contract 3c):
   after creating 001 (interrupted) + 002 (interrupted), a 3rd `runQACycle`
   call's detection returns 002 (most recent), not 001. This is the S3 scan
   exercised THROUGH `runQACycle` (end-to-end), not just the private method.
3. **Healthy-skip across the lifecycle** (contract 3d): 001 healthy + 002
   interrupted → detection returns 002 (001 skipped), AND a fresh hunt does NOT
   run (resume pre-empts).
4. **Resume targets the correct numbered dir** (contract 3e): detection returns
   `…/bugfix/002_<hash>/` → `#runBugFixCycle` (via `MockFixCycleWorkflow`) is
   called with THAT exact numbered path (not 001, not flat).

These are INTEGRATION-style lifecycle tests — they exercise creation+detection
TOGETHER across multiple `runQACycle` invocations, which is the contract's
explicit intent ("Tests must cover: First iteration creates 001; Second
iteration creates 002 (001 preserved); detect finds most recent interrupted;
detect skips healthy; resume works on correct numbered dir").

---

## FACT 4 — How to simulate "on-disk state advancing" across runQACycle calls

The challenge: `runQACycle` is called multiple times on the same pipeline, but
the filesystem is mocked. To simulate "iteration 1 created 001_, now iteration 2
sees 001_ on disk," S4 must make `readdir` return DIFFERENT results on the 2nd
call. Two clean approaches:

### Approach A — `mockResolvedValueOnce` chaining (preferred, matches S2 line 932):
```ts
const { readdir } = await import('node:fs/promises');
const mockReaddir = vi.mocked(readdir);
// 1st runQACycle: bugfix/ doesn't exist yet → ENOENT (default mock).
// 2nd runQACycle: 001_ now "exists" → return it.
mockReaddir
  .mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
  .mockResolvedValueOnce([{ name: '001_aaaaaaaaaaaa', isDirectory: () => true }] as any);
await pipeline.runQACycle();  // creates 001_
await pipeline.runQACycle();  // sees 001_, creates 002_
```
**GOTCHA:** the default `readdir` mock (line 27-29) is `mockRejectedValue(ENOENT)`.
`mockResolvedValueOnce`/`mockRejectedValueOnce` override ONE call then fall back
to the default. So chaining works IF the only `readdir` calls per `runQACycle`
are from `nextBugfixDir` (creation path). BUT once S3 lands, `#detectInterruptedBugfix`
ALSO calls `readdir` BEFORE creation. So each `runQACycle` may issue TWO readdir
calls (detect, then create). S4 must account for this: chain enough
`Once` values, OR reset+re-stub between calls.

### Approach B — `mockImplementation` with a mutable "disk state" closure (robust):
```ts
const diskChildren: string[] = [];  // simulate bugfix/ children on disk
mockReaddir.mockImplementation(async () =>
  diskChildren.map(name => ({ name, isDirectory: () => true }) as any)
);
// mkdir "creates" a dir → push to diskChildren to reflect on next readdir
const { mkdir } = await import('node:fs/promises');
vi.mocked(mkdir).mockImplementation(async (p: any) => {
  const s = String(p);
  const m = s.match(/bugfix[\\/](\d{3}_[a-f0-9]{12})$/);
  if (m) diskChildren.push(m[1]);
  return undefined;
});
await pipeline.runQACycle();  // detect(null, empty) → create 001_ → disk=[001_]
await pipeline.runQACycle();  // detect(null, 001_ healthy) → create 002_ → disk=[001_,002_]
```
**This is the LIFECYCLE pattern** — a simulated filesystem that advances with
each `mkdir`. It lets S4 assert "001 preserved" by checking `diskChildren`
still contains `001_*` after the 2nd run, and "002 created" by checking it
contains `002_*`. **Recommended for the two-iteration creation test (3a+3b).**

**GOTCHA:** the detection path (S3) calls `stat`/`readFile` per child. For the
creation lifecycle (no interrupted children), stub `mockStat` to ENOENT for any
`bugfix/NNN_/TEST_RESULTS.md` path (so detection sees no bug report → returns
null → fresh hunt runs → creation proceeds). Use:
```ts
mockStat.mockImplementation(async (p: any) => {
  const s = String(p);
  if (s.endsWith('TEST_RESULTS.md')) {
    const err = new Error('ENOENT') as NodeJS.ErrnoException; err.code='ENOENT'; throw err;
  }
  return {};
});
```

---

## FACT 5 — Multi-child detection disambiguation (contract 3c/3d/3e)

For tests where `bugfix/` has MULTIPLE numbered children in different states,
`mockStat` + `mockReadFile` must disambiguate by the NNN in the path. Pattern
(from S3 PRP "Implementation Patterns"):
```ts
mockStat.mockImplementation(async (p: any) => {
  const s = String(p);
  // 001_: healthy (both files present)
  if (s.includes('001_')) return {};
  // 002_: interrupted (TEST_RESULTS.md present, tasks.json missing)
  if (s.includes('002_') && s.endsWith('TEST_RESULTS.md')) return {};
  const err = new Error('ENOENT') as NodeJS.ErrnoException; err.code = 'ENOENT'; throw err;
});
mockReadFile.mockImplementation(async (p: any) => {
  const s = String(p);
  if (s.includes('001_')) return VALID_BACKLOG_JSON;  // 001 healthy
  return '';  // 002 unreadable (not reached — stat ENOENT first)
});
mockReaddir.mockResolvedValue([
  { name: '001_aaaaaaaaaaaa', isDirectory: () => true },
  { name: '002_bbbbbbbbbbbb', isDirectory: () => true },
] as any);
// EXPECT: detection returns …/bugfix/002_bbbbbbbbbbbb (002 interrupted, 001 skipped)
```
**Asserting resume targets the correct dir (3e):**
```ts
expect(MockFixCycleWorkflow).toHaveBeenCalledWith(
  expect.stringMatching(/bugfix[\\/]002_bbbbbbbbbbbb$/),  // the EXACT interrupted child
  expect.any(String), expect.anything(), expect.anything(), expect.anything()
);
expect(MockBugHuntWorkflow).not.toHaveBeenCalled();  // resume pre-empted fresh hunt
```

---

## FACT 6 — The runQACycle resume gate (source, confirms the flow)

`src/workflows/prp-pipeline.ts:1795-1820`:
```ts
const shouldDetect = this.mode !== 'validate' &&
  process.env.SKIP_BUG_FINDING !== 'true' &&
  !sessionPath.toLowerCase().includes('bugfix');
if (shouldDetect) {
  const interruptedDir = await this.#detectInterruptedBugfix(sessionPath);
  if (interruptedDir) {
    finalResults = await this.#runBugFixCycle(interruptedDir, prdContent);
    // ... skip fresh hunt ...
  }
}
```
So for S4's lifecycle tests: `mode='bug-hunt'`, `SKIP_BUG_FINDING` unset,
`sessionPath` NOT containing 'bugfix' (the MAIN session) → detection runs. If it
returns a dir, `#runBugFixCycle` (→ `MockFixCycleWorkflow`) is called with that
dir and the fresh hunt is SKIPPED. If null, fresh hunt runs (creation path).

**GOTCHA:** `mode='bug-hunt'` is REQUIRED — without it, an all-Complete backlog
would short-circuit QA (`runQACycle` returns early for completed sessions unless
bug-hunt forces it). The existing tests set `(pipeline as any).mode = 'bug-hunt'`.

---

## FACT 7 — Validation gate + scope fences

- `vitest.config.ts`: 100/100/100/100 on `src/**/*.ts`. S4 adds NO source → no
  coverage risk from S4 itself. But S4's tests must PASS or `npm run validate`
  fails. S4 tests run under `npm run test:run`.
- `package.json`: `npm run validate` = lint + format:check + typecheck + test:run.
- **Scope fences:** S4 is TEST-ONLY. It edits ONLY
  `tests/unit/workflows/prp-pipeline.test.ts` (adding a new `describe(
  'numbered bugfix iteration lifecycle', …)` block). It does NOT touch source
  (S1/S2/S3 own that), does NOT touch other test files, does NOT touch PRD.md/
  tasks.json/prd_snapshot.md/vitest.config.ts.
- **No duplication:** S4's lifecycle tests are DISTINCT from S2's single-call
  creation tests (814-933) and S3's per-component detection tests (936-1113).
  S4 chains MULTIPLE runQACycle calls and/or exercises creation+detection
  TOGETHER — the integration/lifecycle perspective neither sibling covers.

---

## FACT 8 — The `002_` hash in assertions

`nextBugfixDir` hashes `testResults.summary ?? JSON.stringify(testResults.bugs)`
via `hashPRDContent(...).slice(0,12)`. The hash is DETERMINISTIC for a given
seed but the NNN comes from the dir listing. So in S4's lifecycle tests, assert
the NNN prefix (`/bugfix[\\/]001_/`, `/bugfix[\\/]002_/`) rather than the full
hash UNLESS the test controls the seed + mocks `createHash`. The existing S2
tests use `/bugfix[\\/]\d{3}_[a-f0-9]{12}$/` (shape only) or `/bugfix[\\/]002_[a-f0-9]{12}$/`
(NNN + shape). S4 should do the same — assert NNN + 12-hex shape, not the exact
hash bytes, to avoid coupling to the createHash mock.

For the "exact interrupted child" assertion (3e), use the SAME hash string in
both the `readdir` mock Dirent name AND the assertion: e.g. stub
`{name:'002_bbbbbbbbbbbb',...}` then assert
`expect.stringMatching(/bugfix[\\/]002_bbbbbbbbbbbb$/)`. This is robust because
the detection path RETURNS the dir it scanned (the path S3's
`#detectInterruptedBugfix` constructs is `resolve(bugfixDir, e.name)` — the
EXACT name from the readdir mock). So the hash in the Dirent name IS the hash in
the resumed path. (Confirmed by S3 PRP "What §b": `resolve(bugfixDir, e.name)`.)