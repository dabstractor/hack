# Research — P1.M1.T2.S1: Add §9.9 neutralization log-reason assertion to the executor neutralization unit test

## 1. What this task does (test-only hardening)

The executor neutralizes non-monotonic negated file-existence gates (PRD §9.9 G2.1) and emits an
info-level reason log. The existing neutralization unit test
(`tests/unit/agents/prp-executor.test.ts:258` — `it('neutralizes a negated file-existence gate (G2.1)…')`)
asserts the RESULT shape (skipped/success/exitCode) and that `execute_bash` is NOT called for the
neutralized command — but it does NOT assert the §9.9 reason log is emitted. **T2.S1 makes the logger
observable and adds the log assertion.** No source/config/docs change — test-only.

## 2. The log call under test (verified in-repo)

`src/agents/prp-executor.ts:554-560` (inside `#runValidationGates`, after the `isNegatedFileExistenceGate`
check):
```ts
this.#logger.info(
  { level: gate.level, description: gate.description, command: gate.command },
  'non-monotonic negative-existence gate neutralized — file existence is owned by the task graph / is a cleanup step, not a terminal-state assertion (§9.9)'
);
```
So `info` is called with **two args**: a context object (carrying `command`) and a message string
(containing `neutralized` + `§9.9`). The assertion target = `info` called with
`(objectContaining({ command: negCmd }), stringContaining('neutralized'))`.

**`this.#logger` is set ONCE in the constructor** (`src/agents/prp-executor.ts:262`:
`this.#logger = getLogger('PRPExecutor')`). The executor only ever calls `.info`, `.warn`, `.error`
(grep-confirmed: `#logger.info|warn|error`; never `.trace|.debug|.fatal|.child`). So the mock needs
those three as live spies; the other three + `child()` are interface-completeness/defensive.

## 3. The Logger interface to mock (verified — `src/utils/logger.ts`)

```ts
export interface Logger {
  trace(...): void;  // 2 overloads: (msg, ...args) | (obj, msg?, ...args)
  debug(...): void;  // same
  info(...):  void;  // same  ← the neutralization call uses the (obj, msg) form
  warn(...):  void;  // same
  error(...): void;  // same
  fatal(...): void;  // same
  child(bindings: Record<string, unknown>): Logger;
}
```
`getLogger(component: string): Logger` returns a `Logger`. Mocking the module so `getLogger` returns a
spyable object makes `this.#logger.*` observable.

## 4. The mock pattern (file-level vi.mock — survives the file's afterEach)

The test file's `afterEach(() => { vi.clearAllMocks(); })` (L155) **clears call history but PRESERVES
mock implementations** (clearAllMocks ≠ resetAllMocks). So a `getLogger: vi.fn(() => mockLogger)`
factory survives every test — getLogger keeps returning the same shared `mockLogger`, and each test
starts with clean spy call history. This is the key compatibility fact.

**The mock (add at the top of `tests/unit/agents/prp-executor.test.ts`, alongside the existing
agent-factory/prompts/bash-mcp/retry/checkpoint-manager mocks):**
```ts
// Mock the logger module so the §9.9 neutralization info-log is observable (P1.M1.T2.S1).
// getLogger returns ONE shared spyable logger (closure); clearAllMocks in afterEach preserves the
// () => mockLogger impl, so this survives every test. The executor captures it once in its ctor
// (this.#logger = getLogger('PRPExecutor')), so getLogger() in a test returns the SAME instance.
vi.mock('../../../src/utils/logger.js', () => {
  const mockLogger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => mockLogger), // returns the same logger (interface-complete; executor never calls it)
  };
  return { getLogger: vi.fn(() => mockLogger) };
});
```
Then in the test, retrieve the shared instance:
```ts
import { getLogger } from '../../../src/utils/logger.js';
// … after await executor.execute(prp, prpPath):
const logger = getLogger('PRPExecutor'); // same mockLogger the executor captured in its ctor
expect(logger.info).toHaveBeenCalledWith(
  expect.objectContaining({ command: negCmd }),
  expect.stringContaining('neutralized')
);
```

**Why getLogger() in the test returns the executor's logger:** the executor calls `getLogger('PRPExecutor')`
in its ctor → the mock returns `mockLogger` (closure). The test calls `getLogger('PRPExecutor')` → the
SAME `mockLogger`. So `logger.info` IS the spy the executor invoked. (The `getLogger` arg is irrelevant
to the mock; it always returns mockLogger.)

## 5. The assertion (added to the EXISTING neutralization test, ~L313)

Append a third VERIFY block to the existing `it('neutralizes a negated file-existence gate (G2.1)…')`
case (after the "execute_bash NOT called" block at ~L308-314):
```ts
// VERIFY (P1.M1.T2.S1): the §9.9 neutralization reason was logged at info level.
// info is called as (contextObj, msgString); assert the neutralized-command context + the reason text.
const logger = getLogger('PRPExecutor');
expect(logger.info).toHaveBeenCalledWith(
  expect.objectContaining({ command: negCmd }),
  expect.stringContaining('neutralized')
);
```
(Alternative — a NEW adjacent `it()` case — is also acceptable per the contract, but appending to the
existing case is more cohesive: the test is ABOUT neutralization, so asserting both the result shape
and the reason log in one place is clearest. The existing assertions stay unchanged.)

**Why `toHaveBeenCalledWith` works despite multiple info calls:** the executor also logs
`info({ prpTaskId }, 'Starting PRP execution')` at L332. `toHaveBeenCalledWith(matcher1, matcher2)`
passes if info was called with the given args AT LEAST ONCE — it does not require ALL calls to match.
So the neutralization call is found among the calls. (If stricter matching is ever wanted, use
`expect(logger.info.mock.calls).toContainEqual([…])` — but toHaveBeenCalledWith + objectContaining is
the contract's intent and is robust.)

## 6. Why this doesn't break the other tests in the file

- The executor's logger calls (`.info`/`.warn`/`.error` at L332/393/432/554/603) are fire-and-forget
  (no return value is checked anywhere). Mocking them as `vi.fn()` (returns `undefined`) changes no
  behavior — they become no-ops with recorded calls. Every existing test continues to pass.
- No existing test asserts on logging (grep-confirmed: the file asserts on `mockAgent.prompt`,
  `mockExecuteBash`, `mockCreateCoderAgent`, result shapes — never on the logger). So adding the mock
  introduces zero new constraints for existing tests.
- The constructor test (`new PRPExecutor(sessionPath)`) calls `getLogger('PRPExecutor')` → returns
  mockLogger → no throw. Fine.
- `afterEach(clearAllMocks)` clears the spies' history between tests; the getLogger `() => mockLogger`
  impl is preserved → every test gets a fresh-history, same-instance logger.

## 7. Implicit-TDD note (honesty)

This is test-hardening of an EXISTING, already-working code path (the log is already emitted by
`prp-executor.ts:554`). So this is NOT a RED→GREEN TDD cycle for new behavior — it's adding an
assertion that the EXISTING behavior holds. The test passes immediately once the mock + assertion are
added (no source change needed). The contract's `npx vitest run … — all tests must pass including the
new assertion` is the gate. (If the assertion somehow fails, it means the log line was changed/removed
in source — that would itself be the finding.)

## 8. Parallel-execution / file-disjoint check

- **vs P1.M1.T1.S1 (in-flight):** S1 edits `src/agents/prompts.ts` (G1.4 bullet) + `PROMPTS.md` +
  `tests/unit/agents/prompts.test.ts`. T2.S1 edits ONLY `tests/unit/agents/prp-executor.test.ts`.
  **Zero file overlap.** T2.S1 is independent of S1's prompt change (it tests the executor's runtime
  log, not prompt content).
- **vs P1.M1.T2.S2 (next, planned):** S2 adds a real-BashMCP integration test for G2.1 neutralization.
  T2.S1 is the UNIT test (mocked BashMCP) that asserts the log; S2 is the INTEGRATION test (real
  BashMCP) that asserts end-to-end. Distinct files, complementary coverage. T2.S1 owns the log-reason
  assertion; S2 owns the real-path execution.

## 9. Decisions locked

- **Mock at the module boundary** (`vi.mock('../../../src/utils/logger.js')`), NOT by injecting a fake
  logger into the executor (the executor constructs its own logger via getLogger — the module mock is
  the only clean interception point without changing source).
- **getLogger returns ONE shared spyable logger** (closure) → the test retrieves the same instance via
  `getLogger('PRPExecutor')`. Robust against `clearAllMocks` (impl preserved).
- **All 6 level methods + child() mocked** (interface-complete; executor only uses info/warn/error but
  completeness is defensive and the contract asks for it).
- **Assertion appended to the EXISTING neutralization test** (~L313), not a new `it()` (cohesive; the
  case is about neutralization).
- **No source/config/docs change** — test-only (the item's "DOCS: none"). The log line already exists
  at `prp-executor.ts:554`; this task only proves it's emitted.