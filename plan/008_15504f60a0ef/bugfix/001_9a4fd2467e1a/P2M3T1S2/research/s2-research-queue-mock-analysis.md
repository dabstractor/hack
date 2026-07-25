# S2 Research — research-queue mock re-exports for ResearchTimeoutError instanceof checks

## 1. Contract recap (item 3 LOGIC)
- Grep `tests/` for `vi.mock.*research-queue`.
- For each file that mocks `research-queue.js` AND uses `ResearchTimeoutError`
  (directly or via `instanceof` in the **code under test**): switch the
  `vi.mock` to `async importOriginal`, spread real exports, then override
  `ResearchQueue`.
- Files that mock research-queue but don't touch `ResearchTimeoutError`: no
  change REQUIRED — but applying the fix proactively is low-risk and removes
  latent fragility (see §6).
- DOCS: none (test-only).
- OUTPUT: all research-queue mock-related tests pass; no instanceof TypeError.

## 2. Verified mock sites (grep `vi.mock.*research-queue` in tests/)

| # | File | Line | Uses `importOriginal`? | Status |
|---|------|------|------------------------|--------|
| 1 | `tests/unit/core/task-orchestrator.test.ts` | 98 | ✅ YES (async) | **PASSES 120/120** — canonical pattern, NO CHANGE |
| 2 | `tests/unit/core/task-traversal.test.ts`     | 58 | ❌ NO            | **FAILS 9 tests** — NEEDS FIX |
| 3 | `tests/unit/core/task-dependencies.test.ts`  | 51 | ❌ NO            | PASSES (latent) — fix proactively (see §6) |

(`ResearchTimeoutError` is referenced by only 2 test files:
`tests/unit/core/research-queue.test.ts` [tests the class itself — no mock] and
`tests/unit/core/task-orchestrator.test.ts` [already correct]. Neither
`task-traversal` nor `task-dependencies` names the symbol.)

## 3. The ACTUAL root cause (verified by running vitest)

The failure is NOT "the test file uses ResearchTimeoutError." Neither
`task-traversal` nor `task-dependencies` references it. The failure is that the
**code under test** does an `instanceof ResearchTimeoutError` check, and the
mock clobbered the class.

### The smoking gun — `src/core/task-orchestrator.ts:903`
```ts
import { ResearchQueue, ResearchTimeoutError } from './research-queue.js';   // line 49
…
const notEnqueued =
  error instanceof Error &&
  /No PRP available|not been enqueued/i.test(error.message);
if (error instanceof ResearchTimeoutError || notEnqueued) {   // ← line 903
```

`task-orchestrator.ts` imports `ResearchTimeoutError` from `./research-queue.js`.
When a test mocks `research-queue.js` WITHOUT `importOriginal`, the mock factory
returns ONLY `{ ResearchQueue: vi.fn(...) }` — so the module's `ResearchTimeoutError`
binding is `undefined`. When `executeSubtask` reaches line 903 (which happens
whenever a subtask's PRP is missing — the `getPRP()` mock returns `null`),
`error instanceof undefined` throws:

```
Error: [vitest] No "ResearchTimeoutError" export is defined on the
"../../../src/core/research-queue.js" mock. Did you forget to return it
from "vi.mock"?
```

### Why task-traversal FAILS but task-dependencies PASSES (same mock shape!)
Both `task-traversal.test.ts:58` and `task-dependencies.test.ts:51` use the
IDENTICAL non-`importOriginal` mock. The difference is **which code paths the
tests drive**:

- **task-traversal** tests drive `processNextItem` → `executeSubtask`. The mock's
  `getPRP()` returns `null`, so the orchestrator throws "No PRP available",
  which lands in the `catch` at line ~900 and hits the `instanceof
  ResearchTimeoutError` check at line 903 → **TypeError**. 9 of its tests fail.
- **task-dependencies** tests ONLY exercise `canExecute()` /
  `getBlockingDependencies()` / dependency-graph construction. They never call
  `executeSubtask`, so line 903 is never reached → the clobbered class is never
  dereferenced → **passes today**.

So task-dependencies' passing is **accidental** — it's one future test away from
the identical failure. The robust fix applies the `importOriginal` pattern to
BOTH files (defense-in-depth + matches the canonical task-orchestrator pattern).
Applying it to task-dependencies is behavior-preserving (its current tests still
pass) and removes the latent landmine.

## 4. The canonical fix pattern — from `task-orchestrator.test.ts:98`
```ts
vi.mock('../../../src/core/research-queue.js', async importOriginal => {
  const actual =
    await importOriginal<
      typeof import('../../../src/core/research-queue.js')
    >();
  return {
    ...actual,                                   // ← preserve ResearchTimeoutError
    ResearchQueue: vi.fn().mockImplementation(() => ({
      enqueue: vi.fn().mockResolvedValue(undefined),
      getPRP: vi.fn().mockReturnValue(null),
      processNext: vi.fn().mockResolvedValue(undefined),
      getStats: vi.fn().mockReturnValue({ queued: 0, researching: 0, cached: 0 }),
      waitForPRP: vi.fn().mockResolvedValue({ id: 'default-prp', title: 'cached PRP' }),
      researchNow: vi.fn().mockResolvedValue({ id: 'default-prp', title: 'inline PRP' }),
      deletePRP: vi.fn().mockResolvedValue(undefined),
    })),
  };
});
```

**Key elements to replicate exactly:**
1. Factory is `async importOriginal => { ... }` (NOT a sync `() => ({...})`).
2. `const actual = await importOriginal<typeof import('...research-queue.js')>();`
   (the generic is the module's type — copy verbatim from task-orchestrator.test.ts).
3. Return `{ ...actual, ResearchQueue: vi.fn().mockImplementation(...) }` —
   spread FIRST, override SECOND, so `actual.ResearchTimeoutError` survives.
4. The `ResearchQueue` mock body can match each file's EXISTING mock body
   verbatim (task-traversal and task-dependencies both currently use
   `{ enqueue, getPRP, processNext, getStats }` — keep exactly those; do NOT
   invent `waitForPRP`/`researchNow`/`deletePRP` unless the file already had
   them, to avoid behavior drift). The spread already carries the real class,
   so the only structural change is wrapping the existing body in
   `{ ...actual, ResearchQueue: <existing> }`.

### Minimal diff for task-traversal.test.ts (lines 58-67 currently)
BEFORE:
```ts
vi.mock('../../../src/core/research-queue.js', () => ({
  ResearchQueue: vi.fn().mockImplementation(() => ({
    enqueue: vi.fn().mockResolvedValue(undefined),
    getPRP: vi.fn().mockReturnValue(null),
    processNext: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn().mockReturnValue({ queued: 0, researching: 0, cached: 0 }),
  })),
}));
```
AFTER:
```ts
vi.mock('../../../src/core/research-queue.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../src/core/research-queue.js')>();
  return {
    ...actual,
    ResearchQueue: vi.fn().mockImplementation(() => ({
      enqueue: vi.fn().mockResolvedValue(undefined),
      getPRP: vi.fn().mockReturnValue(null),
      processNext: vi.fn().mockResolvedValue(undefined),
      getStats: vi.fn().mockReturnValue({ queued: 0, researching: 0, cached: 0 }),
    })),
  };
});
```
Identical transformation for `task-dependencies.test.ts:51-60`.

## 5. Verification (run order — do these, all must be green)
```bash
npx vitest run tests/unit/core/task-traversal.test.ts     # 9 failures → 0
npx vitest run tests/unit/core/task-dependencies.test.ts   # stays green (no regression)
npx vitest run tests/unit/core/task-orchestrator.test.ts   # stays green (untouched, reference)
npx vitest run tests/unit/core/research-queue.test.ts      # stays green (no mock of research-queue here)
npx vitest run tests/unit/core/                             # whole core suite green for these files
npm run typecheck                                           # the importOriginal generic must typecheck
npm run lint && npm run format:check
npm run test:run                                            # full suite (note: other suites may still fail for UNRELATED reasons — see §8)
```
**Scope-bounded success criterion**: the "No ResearchTimeoutError export is
defined" error must be GONE from the entire suite (grep the full run output).

## 6. The "no change needed" judgment call (task-dependencies)
The contract says: *"For files that mock research-queue but don't touch
ResearchTimeoutError, no change needed."* Strictly, task-dependencies qualifies.
BUT: its mock is byte-identical to task-traversal's (the one that's ON FIRE),
and its passing is purely accidental (no test reaches line 903). Leaving it as-is
means the next person who adds a `processNextItem`/`executeSubtask` test to that
file will hit the identical TypeError and have to re-derive the root cause.

**Decision (PRP will mandate the fix on BOTH files):** apply the `importOriginal`
pattern to task-dependencies too. It is (a) behavior-preserving for its current
tests, (b) removes a latent landmine, (c) makes all three research-queue-mocking
files use ONE consistent pattern (task-orchestrator already does), and (d)
trivially satisfies the contract's "no change NEEDED" (allowed ≠ forbidden). The
risk of applying it is ~zero (proven by task-orchestrator.test.ts passing with
the same pattern). This is the higher-quality, defense-in-depth choice and the
PRP will document the rationale explicitly so the implementing agent doesn't
"helpfully" skip task-dependencies and leave the landmine.

## 7. Source-side context (read-only — do NOT edit)
- `src/core/research-queue.ts:73` — `export class ResearchTimeoutError extends Error`
  (the real class; the mock must preserve THIS identity).
- `src/core/research-queue.ts:449` — `throw new ResearchTimeoutError(...)` (the
  throw site inside `ResearchQueue.researchNow`'s deadline path — NOT exercised
  by these mocks since `ResearchQueue` is mocked, but documents why the class
  identity matters).
- `src/core/task-orchestrator.ts:49` — `import { ResearchQueue, ResearchTimeoutError } from './research-queue.js'`
- `src/core/task-orchestrator.ts:903` and `:906` — the TWO `instanceof
  ResearchTimeoutError` checks (the failure site). Line 906 is reached only on
  the timeout path; line 903 is the gate that fires on EVERY missing-PRP error.
- `src/core/index.ts:15` — `export { ResearchQueue, ResearchTimeoutError } from './research-queue.js'`
  (barrel re-export; irrelevant to the mock identity, but confirms the symbol is public).

## 8. Scope fences / non-goals
- DO NOT edit `src/` at all (test-only fix; the source `instanceof` checks are
  CORRECT — the bug is purely that mocks clobber the class).
- DO NOT touch `task-orchestrator.test.ts` (already canonical; passing 120/120).
- DO NOT touch `research-queue.test.ts` (it tests the REAL class; no research-queue mock).
- DO NOT fix the OTHER rotted suites (PRP-generator file-contract path = S1,
  running in parallel; groundswell module mock = S3; executeBacklog = P2.M1,
  already complete; ContextScopeSchema = P2.M2, already complete). S2's success
  criterion is narrowly: the `ResearchTimeoutError` instanceof TypeError is
  eliminated from the research-queue-mocking test files. The full `npm run
  test:run` may STILL be red due to S1/S3 and other unrelated rot — that is
  EXPECTED and out of scope. Do not chase unrelated failures.
- Zero file overlap with parallel S1 (S1 edits
  `tests/unit/agents/prp-generator.test.ts` + `src/agents/prp-generator.ts`;
  S2 edits `tests/unit/core/task-traversal.test.ts` +
  `tests/unit/core/task-dependencies.test.ts`). No conflict possible.

## 9. Coverage note
`vitest.config.ts` enforces 100% on `src/**/*.ts`. S2 edits ONLY `tests/` — no
`src/` change — so coverage is unaffected (the `instanceof` branches at
task-orchestrator.ts:903/906 are already covered by the passing
task-orchestrator.test.ts). No coverage risk.