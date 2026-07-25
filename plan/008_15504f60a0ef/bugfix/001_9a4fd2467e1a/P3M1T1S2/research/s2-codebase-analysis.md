# P3.M1.T1.S2 — Codebase Analysis (runQACycle numbered bugfix dirs)

## 1. The exact edit site: runQACycle() lines 1858-1885

File: `src/workflows/prp-pipeline.ts`

Current code (inside `if (testResults.hasBugs)` try-block, Phase 2 "Fix Cycle"):

```ts
// Create a bugfix child session directory. The FixCycleWorkflow
// validates that its sessionPath contains 'bugfix' (PRD §5.1: bug
// fix operations must only occur in bugfix sessions). We create a
// bugfix/ subdirectory under the current session, copy TEST_RESULTS.md
// into it (the workflow reads it from there), and pass that path.
const { resolve } = await import('node:path');
const { mkdir, copyFile } = await import('node:fs/promises');
const bugfixSessionPath = resolve(sessionPath, 'bugfix');          // ← line 1862: FLAT
await mkdir(bugfixSessionPath, { recursive: true });
const testResultsPath = resolve(sessionPath, 'TEST_RESULTS.md');
try {
  await copyFile(testResultsPath, resolve(bugfixSessionPath, 'TEST_RESULTS.md'));
} catch {
  // TEST_RESULTS.md may not exist if writeBugReport skipped (no critical/major
  // bugs); copy bug_hunt_results.json as fallback.
  await copyFile(
    resolve(sessionPath, 'bug_hunt_results.json'),
    resolve(bugfixSessionPath, 'TEST_RESULTS.md')
  ).catch(() => { /* nothing to copy — fix-cycle will error on load */ });
}
this.logger.info(`[PRPPipeline] Bugfix session: ${bugfixSessionPath}`);

const fixResults = await this.#runBugFixCycle(bugfixSessionPath, prdContent);
```

**What S2 changes:** replace line 1862
(`const bugfixSessionPath = resolve(sessionPath, 'bugfix')`) with a call to
`nextBugfixDir(sessionPath, hashSeed)`. Everything else stays:
- `mkdir(bugfixSessionPath, { recursive: true })` — STILL NEEDED (nextBugfixDir is
  read-only per S1's contract; mkdir creates `bugfix/NNN_hash/` AND the parent
  `bugfix/` if absent).
- `copyFile(...TEST_RESULTS.md...)` into `bugfixSessionPath` — unchanged (now
  copies into the numbered dir).
- `#runBugFixCycle(bugfixSessionPath, prdContent)` — unchanged (path still
  contains `'bugfix'` → FixCycleWorkflow's `includes('bugfix')` check passes).

## 2. The S1 helper contract (nextBugfixDir)

From `plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P3M1T1S1/PRP.md`:

- Lives in **`src/core/session-utils.ts`** (exported).
- Signature: `nextBugfixDir(sessionPath: string, hashSeed: string): Promise<{ dir: string; sequence: number }>`
- Returns `{ dir, sequence }` where `dir = resolve(sessionPath, 'bugfix', 'NNN_<12hexhash>')`.
- **Read-only** (no mkdir inside). ENOENT on `bugfix/` → sequence 1 (first
  iteration). Existing `NNN_` children scanned → max+1.
- 12-hex hash = `hashPRDContent(hashSeed).slice(0, 12)`.
- Also exports `generateBugfixHash(seed?)` (S2 doesn't strictly need it —
  `nextBugfixDir` does the hashing internally — but it's available if S2 wants a
  decoupled hash).

**S2's destructure:** `const { dir: bugfixSessionPath } = await nextBugfixDir(sessionPath, hashSeed);`

## 3. The hash seed: derive from testResults (in scope)

`testResults: TestResults` (src/core/models.ts:2102) is in scope at the edit site
(assigned at Phase 1, line ≈1847 `finalResults = testResults;`, used in the
`if (testResults.hasBugs)` guard). Good seed candidates:
- `testResults.summary` (string) — human-readable summary.
- `JSON.stringify(testResults.bugs)` — deterministic per distinct bug set.

**Recommended:** `hashSeed = testResults.summary ?? JSON.stringify(testResults.bugs)`.
The contract item 2 says "The hash seed can be derived from the bug report content."
`summary` is the most natural "bug report content" available inline (the full
markdown report is on disk at `TEST_RESULTS.md` but reading it back just for a
seed is redundant — `summary` is the in-memory proxy). FALLBACK: if `summary` is
empty, use `JSON.stringify(testResults.bugs)`; if that's also empty, use a
timestamp/uniqueness seed.

**Determinism note:** the SAME bugs on a re-run produce the SAME hash → the SAME
`NNN_<hash>` dir name. But sequence numbering (NNN) is driven by the dir LISTING
(not the hash), so a re-run after a prior iteration exists gets a NEW NNN
(`002_`, `003_`) even with an identical hash. The hash just makes the suffix
meaningful. This is the correct PRD §4.4 behavior.

## 4. Import strategy: where does nextBugfixDir come from?

`prp-pipeline.ts` currently uses **dynamic `await import('node:path')`** and
**`await import('node:fs/promises')`** inside `runQACycle` (lines 1860-1861).
This is the existing local style (avoids top-level imports for fs in this method).

For `nextBugfixDir` from `src/core/session-utils.ts`, **add a top-level static
import** — this is the conventional pattern for app modules (the file surely
already imports other `src/core/*` modules statically). Check: does
`prp-pipeline.ts` already import from `../core/session-utils.js`?
- If YES → add `nextBugfixDir` to that existing import.
- If NO → add a new `import { nextBugfixDir } from '../core/session-utils.js';`
  at the top with the other `../core/*` imports.

**Do NOT use a dynamic import for the app module** — `nextBugfixDir` is a pure
app-layer utility, not an fs primitive; a static import matches the rest of the
file's `src/core/*` imports. The dynamic `await import('node:fs/promises')` for
`mkdir`/`copyFile` stays (preserve existing local style).

## 5. What happens to `const { resolve } = await import('node:path')`?

`resolve` is still needed for: `resolve(sessionPath, 'TEST_RESULTS.md')`,
`resolve(bugfixSessionPath, 'TEST_RESULTS.md')`,
`resolve(sessionPath, 'bug_hunt_results.json')`. KEEP the
`const { resolve } = await import('node:path')` line. Only the
`bugfixSessionPath` assignment changes.

## 6. Test impact (tests/unit/workflows/prp-pipeline.test.ts)

- **Lines 621-810 (`describe('runQACycle')`):** the "forwards PARALLEL_RESEARCH"
  tests (692-810) DO exercise the fix-spawn branch (`hasBugs: true`) and assert
  `MockFixCycleWorkflow` is called with `expect.any(String)` for the session path.
  They do NOT assert the exact `bugfix/` path string, so swapping to
  `bugfix/NNN_hash/` should leave them GREEN — **BUT** they will now hit the real
  `nextBugfixDir` which calls `readdir` on `sessionPath/bugfix/`. If `sessionPath`
  in those tests is a fake string (not a real dir), `readdir` throws ENOENT →
  nextBugfixDir returns `{ sequence: 1, dir: '<fake>/bugfix/001_<hash>' }` (ENOENT
  is the first-iteration path). Then `mkdir('<fake>/bugfix/001_<hash>', {recursive:true})`
  runs against the REAL filesystem → **test pollution / spurious dir creation**.

  **Mitigation:** the existing tests ALREADY mock `BugHuntWorkflow` and
  `FixCycleWorkflow` (via `vi.mock`). Check whether `node:fs/promises` is also
  mocked in `prp-pipeline.test.ts`. If NOT, the existing tests already tolerate
  real `mkdir`/`copyFile` calls (the `await import('node:fs/promises')` dynamic
  import may or may not be interceptable by `vi.mock`). The implementer MUST
  verify the existing tests stay GREEN after the change — if the dynamic
  `mkdir` now writes to a numbered path under a fake sessionPath, tests may
  either (a) silently create dirs in CWD or (b) throw. **If green breaks, the
  fix is to mock `nextBugfixDir`** via `vi.mock('../core/session-utils.js', …)`
  OR mock `node:fs/promises` readdir/mkdir. Prefer mocking `nextBugfixDir` (clean
  unit boundary) — return `{ dir: '/fake/bugfix/001_deadbeefcafe', sequence: 1 }`.

- **Lines 809-990 (`describe('resume interrupted bugfix breakdowns')`):** these
  test `#detectInterruptedBugfix` (S3's territory) AND the resume branch in
  `runQACycle` (lines 1807-1825). They mock `mockStat`/`mockReadFile` checking
  for `bugfix/TEST_RESULTS.md` (FLAT path). **S3** will update these to scan
  numbered children. S2 does NOT touch `#detectInterruptedBugfix` (≈line 2045) —
  but the resume branch (1807-1825) calls `#detectInterruptedBugfix` which still
  checks the FLAT `bugfix/`. **Mutual-consistency concern (PRD/architecture doc):**
  if S2 makes creation use `bugfix/NNN_hash/` but S3 hasn't landed, then a
  session interrupted AFTER S2's change (numbered dir) won't be detected by the
  pre-S3 flat-dir scan. **This is EXPECTED and OK** — S2 and S3 land together as
  P3.M1.T1; the interim is only a problem if QA is interrupted mid-phase. The
  plan_status shows S3 as the immediately-following subtask. S2's PRP must note
  this dependency but NOT implement S3's scan (scope fence).

  **For S2's own tests:** focus on the CREATION path (Phase 2 fix-spawn). Assert
  `nextBugfixDir` is called with `sessionPath` + a seed derived from
  `testResults`, and that `mkdir` + `copyFile` + `#runBugFixCycle` receive the
  numbered `dir`.

## 7. 100% coverage gate

`vitest.config.ts` enforces 100/100/100/100 on `src/**/*.ts`. The NEW branch S2
introduces is essentially zero (it's a one-line replacement of a `resolve(...)`
call with a `nextBugfixDir(...)` call + destructure). The only "branch" is the
`await` — already async context. **Risk: LOW.** The main coverage risk is if the
implementer adds a seed-selection ternary (e.g.
`testResults.summary ?? JSON.stringify(...)`); each branch of THAT ternary needs
a test. Keep the seed derivation SIMPLE (single expression, no branching) to
avoid coverage overhead, OR cover both branches.

## 8. Scope fences (S2 vs siblings)

- **S1** (nextBugfixDir helper) — DONE as contract; S2 imports it.
- **S3** (#detectInterruptedBugfix scan) — SEPARATE; S2 does NOT touch line 2045+.
- **S4** (lifecycle tests) — SEPARATE; S2 adds only the creation-path unit test
  it needs for coverage (don't write the full lifecycle suite — that's S4).
- **P3.M1.T2.S1** (README/ARCHITECTURE docs) — SEPARATE; S2 = no docs (contract
  item 5 DOCS: none).
- **PRD.md / tasks.json / prd_snapshot.md / vitest.config.ts** — READ-ONLY.
- **FixCycleWorkflow** — READ-ONLY (path still contains 'bugfix'; architecture
  doc confirms).

## 9. Validation commands (verified)

- `npm run validate` = lint + format:check + typecheck + test:run.
- `npx vitest run tests/unit/workflows/prp-pipeline.test.ts` — the affected suite.
- `npx vitest run --coverage` — 100/100/100/100 gate.
- `grep -n "nextBugfixDir" src/workflows/prp-pipeline.ts` — confirms the import + call landed.
- `grep -n "resolve(sessionPath, 'bugfix')" src/workflows/prp-pipeline.ts` — should be GONE from runQACycle (still present in #detectInterruptedBugfix until S3).

## 10. The minimal, surgical change (recommended implementation)

```ts
// BEFORE (line 1860-1862):
const { resolve } = await import('node:path');
const { mkdir, copyFile } = await import('node:fs/promises');
const bugfixSessionPath = resolve(sessionPath, 'bugfix');

// AFTER:
const { resolve } = await import('node:path');
const { mkdir, copyFile } = await import('node:fs/promises');
const { dir: bugfixSessionPath } = await nextBugfixDir(
  sessionPath,
  testResults.summary ?? JSON.stringify(testResults.bugs)
);
```

Plus a top-level static import of `nextBugfixDir` from `../core/session-utils.js`.
EVERYTHING ELSE in the block (mkdir, copyFile x2, logger.info, #runBugFixCycle) is
UNCHANGED — they already operate on `bugfixSessionPath`, which is now the
numbered dir. This is the lowest-risk, highest-fidelity read of the contract.