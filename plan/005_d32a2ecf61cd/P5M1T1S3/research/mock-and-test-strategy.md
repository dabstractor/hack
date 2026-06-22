# Mock & Test Strategy — P5.M1.T1.S3

How to wire the TDD tests in `tests/unit/core/task-orchestrator.test.ts` (PRIMARY) and
`tests/unit/core/research-queue.test.ts` (SECONDARY for `researchNow`). Mirrors the existing
mock idioms already present in those files. **No network, no real agent, no real PRPGenerator.**

## 1. CRITICAL: the research-queue.js module mock MUST preserve `ResearchTimeoutError`

### The trap
The orchestrator (after S3) imports BOTH symbols from the same module:
```ts
import { ResearchQueue, ResearchTimeoutError } from './research-queue.js';
```
The CURRENT module mock in `task-orchestrator.test.ts` (lines ~60-69) REPLACES the entire module:
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
This returns ONLY `ResearchQueue`. Under `vi.mock`, the real module is never loaded → the
orchestrator's `import { ResearchTimeoutError }` resolves to **`undefined`** →
`error instanceof ResearchTimeoutError` becomes `error instanceof undefined` → **TypeError at
runtime** ("Right-hand side of instanceof is not callable"). Tests crash.

### The fix — switch to `async importOriginal` + spread `...actual`
This exact idiom is ALREADY used in this test file for `task-utils.js` (lines ~37-45). Apply it
to `research-queue.js`:
```ts
vi.mock('../../../src/core/research-queue.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../src/core/research-queue.js')>();
  return {
    ...actual,                       // ← preserves the REAL ResearchTimeoutError (S2 export)
    ResearchQueue: vi.fn().mockImplementation(() => ({
      enqueue: vi.fn().mockResolvedValue(undefined),
      getPRP: vi.fn().mockReturnValue(null),
      processNext: vi.fn().mockResolvedValue(undefined),
      getStats: vi.fn().mockReturnValue({ queued: 0, researching: 0, cached: 0 }),
      // NEW defaults so EVERY existing executeSubtask test stays green (waitForPRP resolves, no fallback):
      waitForPRP: vi.fn().mockResolvedValue({ id: 'default-prp', title: 'cached PRP' }),
      researchNow: vi.fn().mockResolvedValue({ id: 'default-prp', title: 'inline PRP' }),
    })),
  };
});
```
Now `ResearchTimeoutError` is the REAL class (S2's export) → the orchestrator's `instanceof`
check works in tests, AND the test can construct `new ResearchTimeoutError(id, secs)` to make the
mock `waitForPRP` throw it.

> **Why the defaults matter:** S3 adds a `waitForPRP` call to `executeSubtask`. The existing ~15
> `executeSubtask` tests (describe block at line ~574) will now invoke `waitForPRP`. With the
> default resolving to a PRP, NO fallback fires → status count stays 3 (Researching, Implementing,
> Complete) → existing assertions stay GREEN. Without the default, `waitForPRP` would be
> `undefined` → every existing executeSubtask test would TypeError. (implementation_notes.md §7
> implicit-TDD rule: update consuming tests in the same subtask.)

## 2. How the test reaches the mock instance

`this.researchQueue` is a `readonly researchQueue: ResearchQueue` **PUBLIC field** on the
orchestrator (line ~88). And `this.prpRuntime` is exposed via a **public getter** (line ~252).
So per-test the test can OVERRIDE the default mock methods on the live instance:
```ts
const orchestrator = new TaskOrchestrator(mockManager);
const queue = orchestrator.researchQueue as any;
queue.waitForPRP = vi.fn().mockRejectedValue(new ResearchTimeoutError('P5.M1.T1.S3', 300));
queue.researchNow = vi.fn().mockResolvedValue({ id: 'inline-prp', title: 'inline' });
```
No need to reach into private `#` fields.

## 3. The PRIMARY failing test (task-orchestrator.test.ts) — write FIRST (RED)

Inside the existing `describe('executeSubtask', () => { ... })` block (line ~574). Two cases:

### (a) abandonment → inline re-research → subtask proceeds (the core contract)
```ts
it('falls back to synchronous inline re-research when waitForPRP abandons (PRD §4.2)', async () => {
  const testBacklog = createTestBacklog([]);            // reuse existing factory
  const currentSession = { /* same shape as sibling tests: metadata/prdSnapshot/taskRegistry/currentItemId */ };
  const mockManager = createMockSessionManager(currentSession);
  const orchestrator = new TaskOrchestrator(mockManager);

  // CONFIGURE the mock researchQueue for abandonment
  const queue = orchestrator.researchQueue as any;
  queue.waitForPRP = vi.fn().mockRejectedValue(new ResearchTimeoutError('P1.M1.T1.S1', 300));
  queue.researchNow = vi.fn().mockResolvedValue({ id: 'inline-prp', title: 'Inline re-research' });

  const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');

  // EXECUTE
  await orchestrator.executeSubtask(subtask);

  // VERIFY: waitForPRP called once; researchNow called exactly once (the inline fallback)
  expect(queue.waitForPRP).toHaveBeenCalledTimes(1);
  expect(queue.researchNow).toHaveBeenCalledTimes(1);
  expect(queue.researchNow).toHaveBeenCalledWith(subtask, expect.anything()); // backlog passed

  // VERIFY: subtask PROCEEDED to the normal execution path (prpRuntime ran) and completed
  expect(orchestrator.prpRuntime.executeSubtask).toHaveBeenCalledTimes(1);
  expect(mockManager.updateItemStatus).toHaveBeenLastCalledWith('P1.M1.T1.S1', 'Complete');

  // VERIFY: abandonment + inline re-research logged at info level (PRD §4.2)
  expect(mockLogger.info).toHaveBeenCalledWith(
    expect.objectContaining({ subtaskId: 'P1.M1.T1.S1' }),
    expect.stringContaining('abandoned'),
  );

  // VERIFY: status progression still exactly 3 (fallback adds NO status change)
  expect(mockManager.updateItemStatus).toHaveBeenCalledTimes(3); // Researching, Implementing, Complete
});
```

### (b) real (non-timeout) generation error propagates → Failed (NOT swallowed as abandonment)
```ts
it('propagates a non-timeout research error instead of falling back', async () => {
  const currentSession = { /* ...same shape... */ };
  const mockManager = createMockSessionManager(currentSession);
  const orchestrator = new TaskOrchestrator(mockManager);
  const queue = orchestrator.researchQueue as any;
  const realError = new Error('research infra down');
  queue.waitForPRP = vi.fn().mockRejectedValue(realError);   // NOT a ResearchTimeoutError
  queue.researchNow = vi.fn();                               // must NOT be called

  const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');

  // EXECUTE: rejects (real error propagated out via the outer catch → rethrown)
  await expect(orchestrator.executeSubtask(subtask)).rejects.toThrow('research infra down');

  // VERIFY: NO inline fallback
  expect(queue.researchNow).not.toHaveBeenCalled();
  // VERIFY: item marked Failed (NOT stuck in Researching/Implementing)
  expect(mockManager.updateItemStatus).toHaveBeenLastCalledWith('P1.M1.T1.S1', 'Failed');
});
```
> NOTE on (b): placement of the research-wait INSIDE the existing try/catch is what makes this
> work — the real error hits the outer catch (step 15 in the flow doc) → `setStatus(Failed)` →
> rethrow. If the implementer places the research-wait ABOVE the try, this test will fail (error
> leaks, item stuck). That's a deliberate structural guardrail (see orchestrator-flow-analysis §2).

### RED first
Before implementing: `npm run test:run -- task-orchestrator`. (a) fails because the orchestrator
doesn't call waitForPRP/researchNow yet (researchNow `not.toHaveBeenCalled` is vacuously true but
`waitForPRP` was never called → `toHaveBeenCalledTimes(1)` fails; and `prpRuntime.executeSubtask`
assertion shape is fine). (b) fails because no waitForPRP call exists yet. After implementing,
both go GREEN.

## 4. The SECONDARY test (research-queue.test.ts) — `researchNow` unit coverage

The item's primary test is in task-orchestrator.test.ts (it stubs the queue). But `researchNow`
is a NEW public queue method — add a small unit test in `research-queue.test.ts` for its own
contract (generate inline + cache). Reuses the EXISTING module mock there:
```ts
// already at top of research-queue.test.ts:
vi.mock('../../../src/agents/prp-generator.js', () => ({ PRPGenerator: vi.fn() }));
import { PRPGenerator } from '../../../src/agents/prp-generator.js';
const MockPRPGenerator = PRPGenerator as any;
```
New `describe('researchNow', () => { ... })`:
```ts
it('generates synchronously inline and caches the result (PRD §4.2 fallback path)', async () => {
  const expectedPRP: PRPDocument = { /* a minimal PRPDocument stub matching src/core/models.ts */ } as any;
  const mockGenerate = vi.fn().mockResolvedValue(expectedPRP);
  MockPRPGenerator.mockImplementation(() => ({ generate: mockGenerate }));
  const queue = new ResearchQueue(mockSessionManager, 3, false, 86_400_000);

  const out = await queue.researchNow(task, backlog);

  expect(out).toBe(expectedPRP);                       // returned inline result
  expect(mockGenerate).toHaveBeenCalledTimes(1);       // one inline generate
  expect(mockGenerate).toHaveBeenCalledWith(task, backlog);
  expect(queue.getPRP(task.id)).toBe(expectedPRP);     // CACHED (getPRP returns it)
});

it('returns the cached result without re-generating if one already exists (dedup guard)', async () => {
  const cached: PRPDocument = { /* ... */ } as any;
  const mockGenerate = vi.fn();
  MockPRPGenerator.mockImplementation(() => ({ generate: mockGenerate }));
  const queue = new ResearchQueue(mockSessionManager, 3, false, 86_400_000);
  // seed the cache directly (simulating an inline result already present)
  (queue as any).results.set(task.id, cached);

  const out = await queue.researchNow(task, backlog);

  expect(out).toBe(cached);
  expect(mockGenerate).not.toHaveBeenCalled();        // did NOT re-generate
});

it('does not delete from researching (background cleanup is processNext.finally)', async () => {
  // Ensures researchNow leaves in-flight tracking intact (dedup relies on it).
  const mockGenerate = vi.fn().mockResolvedValue(prp);
  MockPRPGenerator.mockImplementation(() => ({ generate: mockGenerate }));
  const queue = new ResearchQueue(mockSessionManager, 3, false, 86_400_000);
  const bg = Promise.resolve(prp);
  (queue as any).researching.set(task.id, bg);         // simulate a still-running background job

  await queue.researchNow(task, backlog);

  expect((queue as any).researching.has(task.id)).toBe(true);  // STILL tracked
});
```
Mirror the existing `describe('enqueue', ...)` / `describe('getPRP', ...)` block's setup
(mockSessionManager, `beforeEach(vi.clearAllMocks)`, the deferred-promise helper where needed).

## 5. PRPDocument stub shape for the mocks

`PRPDocument` is the interface in `src/core/models.ts` (~line 1236). For the orchestrator mock
(defaults + abandonment case) a minimal stub object is fine — the orchestrator discards the
return value (orchestrator-flow-analysis §6), so shape is not validated. For the
research-queue.test.ts case, cast `as any` or build a fuller object; the test only asserts
identity (`toBe`), not field validation, so a cast is acceptable and matches the existing
research-queue.test.ts style.

## 6. Why no fake timers needed here (unlike S2)

S2 needed fake timers because it tested the deadline race directly. S3 tests the ORCHESTRATOR's
REACTION to a pre-decided abandonment: the mock `waitForPRP` synchronously rejects with a real
`ResearchTimeoutError`, and the mock `researchNow` synchronously resolves. No `setTimeout`, no
deadline, no `getResearchTimeoutSeconds()` is exercised by the orchestrator test. So
**`vi.useFakeTimers()` is NOT needed** in task-orchestrator.test.ts — leave the file's real-timer
default intact (no `afterEach(vi.useRealTimers)` to add). This avoids the S2 pitfall of fake-timer
leakage into sibling describe blocks.
