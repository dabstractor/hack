# Research — G2.1 neutralization integration test through the real BashMCP path

P1.M1.T2.S2 (bugfix 001). One new `it()` in
`tests/integration/prp-executor-integration.test.ts` that exercises the §9.9 G2.1
neutralization path (`src/agents/prp-executor.ts` ~L553) through the REAL executor with
the REAL BashMCP (the agent is still mocked to avoid LLM calls), proving the contrast the
unit test (mocked `execute_bash`) cannot: a neutralized gate bypasses BashMCP entirely
while a sibling real gate in the same PRP runs for real.

## 1. The integration test harness (verified)

`tests/integration/prp-executor-integration.test.ts` mocks only the LLM boundary and keeps
everything else real:
- `vi.mock('../../src/agents/agent-factory.js', …)` — spreads `vi.importActual` + overrides
  `createCoderAgent: vi.fn()` (so the agent is a mock object, NOT a real Groundswell agent).
- `vi.mock('../../src/agents/prompts.js', …)` — stubs `PRP_BUILDER_PROMPT`.
- `vi.mock('../../src/utils/retry.js', …)` — `retryAgentPrompt` wraps the string return into
  `{status:'success', data, error:null}` (so `#extractResponseContent` extracts the payload).
  Also mocks `withAgentDeadline` (identity pass-through) + others.
- `vi.mock('../../src/core/checkpoint-manager.js', …)` — no disk writes.
- **NOT mocked: BashMCP, the logger, gate-semantics.** The executor instantiates its OWN real
  `BashMCP` (`this.#bashMCP`); gates run via `this.#bashMCP.execute_bash({ command, cwd:
  process.cwd(), timeout: 120000 })`. The real `getLogger('PRPExecutor')` emits the §9.9 info
  log (fire-and-forget; not asserted here — that's S1's unit-test job).

`createMockPRPDocument(taskId, validationGates?)` is the factory. Default = 4 gates (levels
1–3 real `echo`, level 4 manual/null). The `sessionPath = process.cwd()` (repo root) — gates
execute at the project root.

Existing patterns to mirror: the "real BashMCP" success test (L132–167), the "skip manual
gates" test (L236–261), and the "null command + manual=false" test (L236+). All assert via
`result.validationResults.find(r => r.level === N)` and read `success/skipped/exitCode/stdout`.

## 2. The two result interfaces (verified — src/agents/prp-executor.ts)

```ts
// L42 — per-gate result (what #runValidationGates pushes)
export interface ValidationGateResult {
  readonly level: 1 | 2 | 3 | 4 | 5;
  readonly description: string;
  readonly success: boolean;
  readonly command: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;   // null iff skipped (manual/null/neutralized); a number iff executed
  readonly skipped: boolean;
  readonly timedOut: boolean;
}

// L100 — execute() return
export interface ExecutionResult {
  readonly success: boolean;          // invariant: success === (outcome === 'success')
  readonly outcome?: 'success' | 'fail' | 'issue';
  readonly issueMessage?: string;
  readonly validationResults: ValidationGateResult[];
  readonly artifacts: string[];
  readonly error?: string;
  readonly fixAttempts: number;
}
```

**Important — `result.outcome` IS a real field** (the work item's "(a) result.outcome is
'success'" is correct). The existing integration tests assert `result.success === true`; both
are valid per the documented invariant (`success === (outcome === 'success')`). Assert BOTH
for robustness: `expect(result.success).toBe(true)` AND `expect(result.outcome).toBe('success')`.

## 3. The neutralization result shape (verified — prp-executor.ts ~L553–574)

When `isNegatedFileExistenceGate(gate.command)` is true, BEFORE `execute_bash` is reached:
```ts
this.#logger.info({ level, description, command }, 'non-monotonic negative-existence gate neutralized … (§9.9)');
results.push({
  level: gate.level, description: gate.description, success: true,
  command: gate.command, stdout: '', stderr: '',
  exitCode: null, skipped: true, timedOut: false,
});
continue;   // ← execute_bash NEVER called for this gate
```
So a neutralized gate has EXACTLY: `skipped: true`, `success: true`, `exitCode: null`,
`stdout: ''`, `stderr: ''`, `command` = the negated string. Aggregation
`allPassed = every(r => r.success || r.skipped)` counts it as passed → `outcome: 'success'`.

An EXECUTED real gate (e.g. `echo ok`) gets `exitCode: result.exitCode ?? null` (= `0` for
echo), `skipped: false`, and `stdout` carrying the echo output — proving it went through the
real BashMCP path.

## 4. Picking the negated-gate target — make neutralization load-bearing

The detector matches `! test -f X` / `test ! -f X` (leading or inner bang, `-f`/`-e`/`-d`).
The work item suggests `! test -f src/hooks/index.ts`, but **that file does NOT exist** in the
repo — so `! test -f <nonexistent>` would PASS (exit 0) if executed, and the test would NOT
prove neutralization is load-bearing (the gate passes whether neutralized or not).

**Use `! test -f package.json` instead.** `package.json` EXISTS at the repo root (= the
`process.cwd()` where BashMCP runs), so `! test -f package.json` would EXIT 1 (FAIL) if
executed. Therefore the test's `outcome === 'success'` is ONLY achievable because the gate was
neutralized — a strictly stronger proof that the §9.9 path is doing real work through the real
executor. `package.json` is bulletproof (the project cannot run without it; the test runs at
the repo root).

(Since the gate is NEUTRALIZED it never executes regardless — but targeting an existing file
makes the "would-fail-without-neutralization" property explicit and meaningful.)

## 5. File-disjoint from S1 (parallel-execution safe)

- **S1 (P1.M1.T2.S1)** edits `tests/unit/agents/prp-executor.test.ts` — adds a logger
  `vi.mock` + a log-reason assertion to the EXISTING G2.1 unit case (mocked `execute_bash`).
- **S2 (this task)** edits `tests/integration/prp-executor-integration.test.ts` — adds ONE new
  `it()` exercising the REAL BashMCP path. Different file, different concern (integration vs
  unit log assertion). **Zero overlap.** No shared mock factory, no shared describe block.
- Both consume the SAME unchanged source (`prp-executor.ts:553`). S2 does NOT mock the logger
  (the real one emits the info log harmlessly; S1's logger mock is unit-file-local).

## 6. Test design (the new it())

Place inside the EXISTING `describe('execute() with real dependencies')` block, after the
"skip manual gates" / "capture stdout/stderr" tests. Mirror the existing custom-gate-array +
`createMockPRPDocument(id, gates)` + `mockAgent.prompt.mockResolvedValue(success JSON)` +
`new PRPExecutor(sessionPath)` + `await executor.execute(prp, prpPath)` pattern.

Gate set (4 gates, matching the default shape; level 2 is the negated gate):
- level 1: real `echo "real gate executed"` (manual:false) — proves BashMCP runs for real.
- level 2: `! test -f package.json` (manual:false) — G2.1 neutralized target.
- level 3: real `echo "second real gate"` (manual:false) — second real execution.
- level 4: manual/null (manual:true) — mirrors the existing manual-skip pattern.

Assertions (the contract's a/b/c):
- (a) overall: `result.success === true` AND `result.outcome === 'success'`.
- (b) level-2 (neutralized): `skipped === true`, `success === true`, `exitCode === null`,
  `command === '! test -f package.json'`, `stdout === ''`, `stderr === ''`.
- (c) level-1 (real, the discriminator): `skipped === false`, `exitCode` NOT null (`=== 0`),
  `stdout` contains `'real gate executed'`. (This is the integration value: it proves real
  BashMCP executed a sibling gate while the negated gate bypassed it.)

No timeout option needed on this success-path test (it passes first try; the existing success
tests omit it). Add `{ timeout: 10000 }` only if CI proves flaky (the failure-path test uses
it because it does fix-retries; this one does not).

## 7. Non-break / scope
- ONLY edits `tests/integration/prp-executor-integration.test.ts` (one new `it()`). No
  source/config/docs changes (the item's "DOCS: none"). The §9.9 behavior already exists in
  source — this test proves it holds end-to-end (hardening, not new behavior).
- Does NOT assert the info-log message (that's S1's unit-test scope). Does NOT mock the logger.
- Does NOT touch the unit test file (S1 owns it).