# Test Patterns — `tests/unit/core/task-orchestrator.test.ts`

Target file: `/home/dustin/projects/hacky-hack/tests/unit/core/task-orchestrator.test.ts` (4790 lines).
Source under test: `/home/dustin/projects/hacky-hack/src/core/task-orchestrator.ts`.

---

## 1. `vi.mock` blocks

The file mocks **9 modules** at the top level (lines 32–146). There is **NO `vi.mock` for `git-mcp`** anywhere in this test file (confirmed: zero matches for `git-mcp`/`git_mcp`). `git-mcp` is not imported by `task-orchestrator.ts` at all.

### 1a. `git-commit` mock (the relevant one for smartCommit) — lines 53–57

```ts
// Mock the git-commit module for smartCommit tests
vi.mock('../../../src/utils/git-commit.js', () => ({
  smartCommit: vi.fn(),
  filterProtectedFiles: vi.fn((files: string[]) => files),
  formatCommitMessage: vi.fn((msg: string) => msg),
}));
```

Note: `smartCommit` is a bare `vi.fn()` (no default implementation) — each test sets its own `mockResolvedValue`/`mockRejectedValue`, and the relevant `describe` blocks `mockReset()` it in `beforeEach`.

### 1b. Full mock object inventory (all vi.mock blocks)

| Lines | Module path | Exports mocked |
|---|---|---|
| 33–35 | `../../../src/utils/logger.js` | `getLogger: vi.fn(() => mockLogger)` (mockLogger from `vi.hoisted`, lines 26–31) |
| 38–45 | `../../../src/utils/task-utils.js` | `...actual` (importOriginal), then `getNextPendingItem: vi.fn()` |
| 48–51 | `../../../src/core/scope-resolver.js` | `resolveScope: vi.fn()`, `parseScope: vi.fn()` |
| 54–57 | `../../../src/utils/git-commit.js` | `smartCommit`, `filterProtectedFiles`, `formatCommitMessage` (see 1a) |
| 66–82 | `../../../src/agents/agent-factory.js` | `...actual` + `createCleanupAgent: vi.fn(() => ({ prompt: vi.fn(() => Promise.resolve({ status: 'success', data: 'no cleanup needed' })) }))` — so the DEFAULT `createCleanupRunner()` reports success → 2 smartCommit calls |
| 86–109 | `../../../src/core/research-queue.js` | `...actual` + `ResearchQueue: vi.fn().mockImplementation(...)` (enqueue/getPRP/processNext/getStats/waitForPRP/researchNow/deletePRP). `importOriginal` preserves the real `ResearchTimeoutError` so `instanceof` works. |
| 112–115 | `../../../src/core/session-utils.js` | `atomicWrite: vi.fn().mockResolvedValue(undefined)`, `readTasksJSON: vi.fn().mockResolvedValue({ backlog: [] })` |
| 122–130 | `../../../src/core/tasks-json-recovery.js` | `recoverTasksJson: vi.fn().mockResolvedValue({ restored:false, source:'disk', reason:'re-applied legitimate status delta', backlog: undefined })` |
| 135–145 | `../../../src/agents/prp-runtime.js` | `PRPRuntime: vi.fn().mockImplementation(() => ({ executeSubtask: vi.fn().mockResolvedValue({ success:true, validationResults:[], artifacts:[], error:undefined, fixAttempts:0 }) }))` |

### Cleanup-agent mock rationale (lines 58–65, verbatim)
```ts
// Mock the cleanup agent factory so the DEFAULT createCleanupRunner() (P3.M1.T3.S3)
// does not attempt real agent/LLM construction in orchestrator tests. The mock
// agent's prompt resolves success, so tests that exercise the default-runner
// success path (two-phase commit → 2 smartCommit calls) still observe 2 commits.
// Tests that need a specific cleanup outcome inject their own cleanupRunner
// spy via the TaskOrchestrator options (see buildOrchestrator).
```

---

## 2. `vi.mocked` bindings

**`vi.mocked(...)` is NOT used anywhere in this file** (zero matches). Instead the
file casts imported mocked symbols to local `mock*` variables using two patterns:

**Pattern A — `as ReturnType<typeof vi.fn>`** (used for the session-utils / recovery bindings):
```ts
// lines 117–119
import { atomicWrite, readTasksJSON } from '../../../src/core/session-utils.js';
const mockAtomicWrite = atomicWrite as ReturnType<typeof vi.fn>;
const mockReadTasksJSON = readTasksJSON as ReturnType<typeof vi.fn>;

// lines 131–132
import { recoverTasksJson } from '../../../src/core/tasks-json-recovery.js';
const mockRecoverTasksJson = recoverTasksJson as ReturnType<typeof vi.fn>;
```

**Pattern B — `as any`** (used for the three core mock bindings, lines 152–155):
```ts
// Import mocked functions
import { getNextPendingItem } from '../../../src/utils/task-utils.js';
import { resolveScope } from '../../../src/core/scope-resolver.js';
import { smartCommit } from '../../../src/utils/git-commit.js';

// Cast mocked functions
const mockGetNextPendingItem = getNextPendingItem as any;
const mockResolveScope = resolveScope as any;
const mockSmartCommit = smartCommit as any;
```

So the smartCommit binding is **`const mockSmartCommit = smartCommit as any;`** (line 155), not `vi.mocked(smartCommit)`. The logger mock object (`mockLogger`) comes from `vi.hoisted` (lines 26–31) and is referenced directly (no cast).

---

## 3. Orchestrator construction & `currentSession`/`metadata.path`

There is **no shared `beforeEach` that constructs the orchestrator** at the top-level
`describe('TaskOrchestrator')`. The top-level `beforeEach` (line 228) only does
`vi.clearAllMocks()`. Each `it` constructs its own orchestrator inline. There is a
`createMockSessionManager` factory (lines 220–228) used by virtually every test.

### Mock SessionManager factory — lines 220–228
```ts
const createMockSessionManager = (currentSession: any): SessionManager => {
  const mockManager = {
    currentSession,
    updateItemStatus: vi.fn().mockResolvedValue(currentSession?.taskRegistry),
    loadBacklog: vi.fn().mockResolvedValue(currentSession?.taskRegistry),
    flushUpdates: vi.fn().mockResolvedValue(undefined),
  } as unknown as SessionManager;
  return mockManager;
};
```

### Canonical `currentSession` shape (repeated verbatim in ~every test), e.g. lines 869–881
```ts
const currentSession = {
  metadata: {
    id: '001_14b9dc2a33c7',
    hash: '14b9dc2a33c7',
    path: '/plan/001_14b9dc2a33c7',          // ← the literal smartCommit reads
    createdAt: new Date(),
    parentSession: null,
  },
  prdSnapshot: '# Test PRD',
  taskRegistry: testBacklog,
  currentItemId: null,
};
const mockManager = createMockSessionManager(currentSession);
const orchestrator = new TaskOrchestrator(mockManager);
```

### Constructor signature (source `task-orchestrator.ts` lines 171–188)
```ts
constructor(
  sessionManager: SessionManager,
  scope?: Scope,
  noCache: boolean = false,
  researchQueueConcurrency: number = 3,
  cacheTtlMs: number = 24 * 60 * 60 * 1000,
  prpCompression: PRPCompressionLevel = 'standard',
  retryConfig?: Partial<TaskRetryConfig>,
  options?: TaskOrchestratorOptions   // { cleanupRunner?: CleanupRunner }
) { ... this.#cleanupRunner = options?.cleanupRunner ?? createCleanupRunner(); }
```

So an injected `cleanupRunner` spy is passed positionally as the **8th arg** via
the options bag. Example: `new TaskOrchestrator(mockManager, undefined, undefined, undefined, undefined, undefined, undefined, { cleanupRunner: spyRunner })`.

### Shared `buildOrchestrator` builder (two-phase tests) — lines 1059–1090
This builder injects an optional `cleanupRunner` spy through the options bag:
```ts
const buildOrchestrator = (cleanupRunner?: (ctx: any) => Promise<any>) => {
  mockSmartCommit.mockResolvedValue('abc123def456');
  const testBacklog = createTestBacklog([]);
  const currentSession = { metadata: { id:'001_14b9dc2a33c7', hash:'14b9dc2a33c7',
    path:'/plan/001_14b9dc2a33c7', createdAt:new Date(), parentSession:null },
    prdSnapshot:'# Test PRD', taskRegistry: testBacklog, currentItemId: null };
  const mockManager = createMockSessionManager(currentSession);
  const orchestrator = new TaskOrchestrator(
    mockManager, undefined, undefined, undefined, undefined, undefined, undefined,
    cleanupRunner ? { cleanupRunner } : undefined
  );
  return { orchestrator, mockManager };
};
```

### How `metadata.path` is "not available" (negative test) — lines 1033–1041
```ts
metadata: {
  ...
  path: undefined as unknown as string, // No path available
  ...
},
```
This drives the `'Session path not available for smart commit'` warning branch.

---

## 4. Existing tests for the `'Complete'` skip path — **ABSENT**

**There is NO test that exercises the `executeSubtask` early-return for an
already-`Complete` subtask.** Confirmed by:
- No match for `Already complete`, `already complete`, `Status.Complete`, or any
  `it(` title referencing a skipped-already-complete subtask.
- Grepping the full `it(` title list (96 titles) — none target the skip path.
- The orchestrator source DOES contain the guard (this is the gap):

```ts
// src/core/task-orchestrator.ts lines 773–784
async executeSubtask(subtask: Subtask): Promise<void> {
  // Skip subtasks that are already Complete (e.g. on --continue resume).
  // Without this, every resume re-runs every completed subtask, wasting
  // 10+ min each and producing duplicate commits whose only changed file
  // is regenerated execution telemetry.
  if (subtask.status === 'Complete') {
    this.#logger.info(
      { subtaskId: subtask.id },
      'Already complete, skipping'
    );
    return;
  }
```

**Implication for new work:** a test passing `createTestSubtask('...', '...', 'Complete')` into `orchestrator.executeSubtask(...)` and asserting `mockLogger.info` was called with `{ subtaskId }`, 'Already complete, skipping' AND that `mockSmartCommit`/`prpRuntime.executeSubtask`/`updateItemStatus` were NOT called would be net-new coverage. None of those assertions exist today.

The closest existing skip path is the **dependency-blocked** skip (lines 2512–2574):
- `it('should skip execution when dependencies are not satisfied'...)` asserts the
  `'Subtask blocked on dependencies, skipping'` warn log (different branch,
  `task-orchestrator.ts` lines 840–843). This is the closest analog to model a new
  "already complete, skipping" test on.

---

## 5. How `Subtask` objects are constructed in tests

A **helper factory `createTestSubtask`** is used everywhere (lines 166–176):

```ts
const createTestSubtask = (
  id: string,
  title: string,
  status: Status,
  dependencies: string[] = [],
  context_scope: string = 'Test scope'
) => ({
  id,
  type: 'Subtask' as const,
  title,
  status,
  story_points: 2,
  dependencies,
  context_scope,
});
```

Sister factories `createTestTask` (177–187), `createTestMilestone` (189–199),
`createTestPhase` (201–211), `createTestBacklog` (213–215) nest these into a full
backlog: `createTestBacklog(phases) => ({ backlog: phases })`.

**Status is passed as a string literal** (the `Status` type is imported from
`src/core/models.js`, line 22). Typical call:
```ts
const subtask = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
```

**There is NO `createTestSubtask(..., 'Complete', ...)` call anywhere in the file.**
Every status value passed to the factory in test bodies is `'Planned'`. (Complete
statuses appear only as literal in-object mutations in dependency tests, e.g. lines
2740 & 2758 set `.status = 'Complete'` on existing subtasks to satisfy dependencies —
not to drive the executeSubtask skip path.)

---

## 6. How `tasks.json` is set up — **all mocked, no real fs / temp dir**

There is **no temp directory, no real `fs` write, no in-memory file map.** All
tasks.json touchpoints are mocked at the module boundary:

- **`readTasksJSON`** — `vi.fn().mockResolvedValue({ backlog: [] })` at line 114;
  re-cast to `mockReadTasksJSON`. The recovery suite overrides it per-test
  (e.g. line 4449 `mockReadTasksJSON.mockResolvedValue(recoveredBacklog)`).
- **`atomicWrite`** — `vi.fn().mockResolvedValue(undefined)` at line 113;
  re-cast to `mockAtomicWrite`.
- **`recoverTasksJson`** — `vi.fn().mockResolvedValue({ restored:false, ... })` at
  lines 123–130; re-cast to `mockRecoverTasksJson`.

The recovery `describe` block resets these in its `beforeEach` (lines 4318–4331):
```ts
describe('executeSubtask — smart recovery after agent run (PRD §5.1, R4 S3)', () => {
  beforeEach(() => {
    mockRecoverTasksJson.mockReset();
    mockRecoverTasksJson.mockResolvedValue({ restored:false, source:'disk', reason:'re-applied legitimate status delta' });
    mockReadTasksJSON.mockReset();
    mockReadTasksJSON.mockResolvedValue(createTestBacklog([]));
    mockAtomicWrite.mockReset();
    mockAtomicWrite.mockResolvedValue(undefined);
    mockSmartCommit.mockReset();
    mockSmartCommit.mockResolvedValue(undefined);   // falsy → "No files to commit"
  });
```

The "session directory" string the orchestrator reads/writes against
(`'/plan/001_x/tasks.json'`, `'/plan/001_x'`) is just a literal derived from
`currentSession.metadata.path` in the mock session — no real path resolution. The
backlog used by tests is the in-memory `taskRegistry` object on the mock session,
built via the `createTest*` factories.

---

## 7. Testing framework & helpers used

**Framework:** Vitest. Imports (line 21):
```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
```
(`afterEach` is imported inline only in the parallel-research `describe` at line 4510
via `vi.unstubAllEnvs()` — it is not in the top import.)

**Mock helpers used:**
- `vi.fn()`, `vi.fn(() => ...)`, `vi.fn().mockImplementation(...)`
- `vi.hoisted(...)` for the shared `mockLogger` (lines 26–31)
- `vi.mock(path, factory)` / `vi.mock(path, async importOriginal => ...)`
- `vi.clearAllMocks()` (top-level `beforeEach`, line 229) and `vi.stubEnv` /
  `vi.unstubAllEnvs` (parallel-research tests)

**Assertion helpers used** (sampled — exhaustive):
- `toHaveBeenCalledTimes(n)`, `toHaveBeenCalledWith(...)`, `toHaveBeenNthCalledWith(n, ...)`
- `not.toHaveBeenCalled()`
- `expect.objectContaining(...)`, `expect.any(Object)`, `expect.stringContaining(...)`
- `resolves.toBeUndefined()`, `rejects.toThrow(...)`, `toHaveLength(...)`, `toEqual(...)`, `toBe(...)`
- `.mock.calls.at(-1)`, `.mock.calls.map(c => c[1])`, `.mockImplementation(async (id,status) => ...)`
- `.mockResolvedValueOnce(...).mockResolvedValueOnce(...)` (sequential resolves, lines 1198–1200 & 1222–1224)
- `.mockReset()` in per-`describe` `beforeEach` (NOT `mockClear`)

**`toHaveBeenCalledBefore` / `toHaveBeenCalledAfter` are NOT used** (zero matches).
Ordering is instead asserted positionally via `toHaveBeenNthCalledWith(1, ...)` /
`(2, ...)` and by inspecting `.mock.calls.at(-1)`.

**Test doc convention:** every `it` body is commented in a **SETUP / EXECUTE / VERIFY**
three-block style (see lines 866, 868, 892 etc.). New tests should follow this.

---

## 8. Pre-cleanup (survival) & post-cleanup `smartCommit({generateMessage:true})` assertions

These are the canonical assertions to model new tests on. They live in two
`describe` blocks: `'smartCommit integration'` (lines 859–1052) and
`'two-phase commit + cleanup seam'` (lines 1054–1319). Both `beforeEach` blocks
call `mockSmartCommit.mockReset()`.

### 8a. Two-call assertion (survival + post-cleanup, both `{ generateMessage: true }`) — lines 893–908
```ts
// VERIFY: two-phase commit — exactly TWO smartCommit calls, both with
// { generateMessage: true }: survival commit then post-cleanup commit.
expect(mockSmartCommit).toHaveBeenCalledTimes(2);
expect(mockSmartCommit).toHaveBeenNthCalledWith(
  1,
  '/plan/001_14b9dc2a33c7',
  'P1.M1.T1.S1: Test Subtask',
  { generateMessage: true }
);
expect(mockSmartCommit).toHaveBeenNthCalledWith(
  2,
  '/plan/001_14b9dc2a33c7',
  'cleanup: doc reorganization',
  { generateMessage: true }
);
```
(Identical assertion duplicated in the two-phase suite at lines 1127–1138.)

The call contract mirrors the source (`task-orchestrator.ts`):
- **Survival / pre-cleanup** — lines 1031–1034: `smartCommit(sessionPath, \`${subtask.id}: ${subtask.title}\`, { generateMessage: true })`
- **Post-cleanup** — lines 1082–1086: `smartCommit(sessionPath, 'cleanup: doc reorganization', { generateMessage: true })`, only when `cleanupOk` is true.

### 8b. "Only survival ran (post-cleanup skipped)" assertion — lines 1158–1163
Used when the cleanup runner returned `{ success:false }`:
```ts
// VERIFY: survival commit ran (once), post-cleanup commit SKIPPED.
expect(mockSmartCommit).toHaveBeenCalledTimes(1);
expect(mockSmartCommit).toHaveBeenCalledWith(
  '/plan/001_14b9dc2a33c7',
  'P1.M1.T1.S1: Test Subtask',
  { generateMessage: true }
);
```

### 8c. Other smartCommit-adjacent assertions in the same suites
- `'should log commit hash when smartCommit succeeds'` (lines 910–942): asserts
  `mockLogger.info` called with `{ commitHash: 'abc123def456' }, 'Survival commit created'`.
- `'should log when smartCommit returns null'` (945–977): asserts `'No substance to commit (survival commit empty)'`.
- `'should log error but not fail subtask when smartCommit throws'` (979–1017): `mockRejectedValue(new Error('Git operation failed'))` → asserts `'Smart commit failed'` log AND that `updateItemStatus` was still called with `'Complete'` (commit failure is non-fatal).
- `'should log warning when session path is not available'` (1019–1051): `path: undefined` → asserts `'Session path not available for smart commit'` warn and `mockSmartCommit` NOT called.
- `'should make ZERO smartCommit calls ... on the FAILED path'` (1241–1285): forces `prpRuntime.executeSubtask` to `{success:false}` → asserts `mockSmartCommit` NOT called and cleanup `spyRunner` NOT called.
- Survival-null-then-post-ok (1196–1218): `mockResolvedValueOnce(null).mockResolvedValueOnce('posthash')`.
- Survival-ok-then-post-null (1220–1239): asserts `'No cleanup changes to commit'`.

---

## Architecture summary

- **Mocks are module-level via `vi.mock`** (hoisted). All real I/O paths
  (`session-utils`, `tasks-json-recovery`, `git-commit`, `prp-runtime`,
  `agent-factory`, `research-queue`) are stubbed — the suite is fully hermetic.
- **Bindings** use `as ReturnType<typeof vi.fn>` (for the typed session/recovery
  mocks) or `as any` (for `getNextPendingItem`, `resolveScope`, `smartCommit`).
  **`vi.mocked()` is never used.**
- **No shared orchestrator fixture.** Top-level `beforeEach` only clears mocks;
  each `it` builds its own session + orchestrator. Two shared local builders exist
  in narrower scopes: `buildOrchestrator` (two-phase, line 1059) and `setup()`
  (recovery, line 4333) and `buildOrchestratorWithQueue` (parallel research, line 4508).
- **`session.metadata.path`** is a hardcoded literal (`'/plan/001_14b9dc2a33c7'`
  or `'/plan/001_x'`) on the mock session; smartCommit receives it as its first arg.
- **Cleanup runner** is injected via the 8th constructor arg `{ cleanupRunner }`;
  by default it uses the mocked `createCleanupAgent` which resolves success.
- **Two-phase commit** = survival smartCommit (pre-cleanup) → cleanup runner →
  `flushUpdates()` → post-cleanup smartCommit. Both smartCommit calls carry
  `{ generateMessage: true }`.

## Open gaps for new test authoring
1. **`executeSubtask` 'Complete' skip path is uncovered** — no test passes a
   `Complete`-status subtask. Source guard at `task-orchestrator.ts:778–784`,
   logs `{ subtaskId }`, 'Already complete, skipping'. A new test should assert
   the info log + that `mockSmartCommit`, `prpRuntime.executeSubtask`,
   `updateItemStatus`, and the cleanup runner are all NOT invoked.
2. **No `createTestSubtask(..., 'Complete', ...)` helper usage** — every factory
   call passes `'Planned'`. A new test must be the first to pass `'Complete'`.
3. **No `git-mcp` mock exists** in this file — if new work touches git-mcp, a
   fresh `vi.mock('../../../src/tools/git-mcp.js', ...)` block would need to be
   added (none to copy from here).

## Start here
Open `/home/dustin/projects/hacky-hack/tests/unit/core/task-orchestrator.test.ts`
lines 639–1052 (the `describe('executeSubtask')` parent + `smartCommit
integration` child) — this is the exact `describe` scope into which a new
"already complete, skipping" test belongs, and the source of the smartCommit
assertion patterns to mirror. Then cross-reference the source guard at
`src/core/task-orchestrator.ts:773–784`.