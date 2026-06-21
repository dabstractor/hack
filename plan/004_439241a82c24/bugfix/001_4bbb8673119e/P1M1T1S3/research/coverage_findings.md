# Research Notes — P1.M1.T1.S3

> Coverage / call-graph findings gathered while writing the PRP. Read-only research —
> no source or test files were modified.

## 1. Post-S1/S2 baseline (verified by running tests)

Command: `npm run test:run -- config/ agents/agent-factory agents/cache-key-isolation tools/mcp-tool-parity`

```
Test Files  8 passed (8)
Tests       107 passed (107)
```

All 5 previously-failing persona-factory creation tests are GREEN:

- `should create architect agent successfully`
- `should create researcher agent successfully`
- `should create coder agent successfully`
- `should create QA agent successfully`
- `should create multiple agents without MCP server registration conflicts`

So **end-to-end agent creation already works** after S1+S2. This subtask's "verify"
half is a confirmation pass, not a repair.

## 2. Targeted coverage on `src/config/harness.ts` (current state)

Command: `npm run test:run -- config/harness-config agents/agent-factory --coverage`

```
harness.ts | 100 Stmts | 100 Branch | 100 Funcs | 100 Lines
```

The registration guard currently reads as 100% branch. **BUT** — this number is
misleading and is precisely why the contract still demands an explicit skip-branch
test (see §3).

## 3. Why an explicit `has()→true` test is still required

### 3a. The guard under test (`src/config/harness.ts:84`)

```ts
const registry = HarnessRegistry.getInstance();
if (!registry.has('pi')) {
  // ← TWO arcs: taken (register) / skipped
  registry.register(new PiHarness());
}
```

### 3b. Current mock hardwires the skip arc away

Both config test files (S2) use:

```ts
vi.mock('groundswell', () => ({
  configureHarnesses: vi.fn(),
  HarnessRegistry: {
    getInstance: () => ({ has: () => false, register: vi.fn() }),
  },
  PiHarness: class MockPiHarness {},
}));
```

`has: () => false` ⇒ `!has('pi') === true` ⇒ the **register arc is always taken**;
the **skip arc is never entered** by the config tests.

### 3c. The real-registry path (agent-factory.test.ts) also never skips

`configureHarness()` is invoked **exactly once** in the entire codebase — at
module-load of `src/agents/agent-factory.ts:46`:

```ts
const RESOLVED_HARNESS: AgentHarness = configureHarness();
```

The `createXxxAgent()` factories call `createAgent(config)` directly (lines
209/240/268/296), NOT `configureHarness()`. So even with the REAL singleton
registry, `configureHarness()` runs once → `has('pi')→false` → register. The
skip arc is **not deterministically exercised** anywhere.

### 3d. Why coverage still reports 100% despite §3b/§3c

`@vitest/coverage-v8` derives "branches" from V8 native block coverage. For a
single-statement `if (cond) stmt;` (no `else`) where the condition is always
truthy in the exercised paths, the provider frequently reports only the **taken**
arc and does not emit/flag the **skip** arc as uncovered. This is a known
imprecision of the v8 provider vs. istanbul/c8.

**Implication:** the 100% number is fragile and coincidental. The contract's
explicit `has()→true` test makes the skip path **deterministically exercised and
asserted** (not merely coverage-counted) — robust against any future change to
the mock, the call graph, or the coverage provider. This is the correct
engineering choice and is mandated by the work item.

## 4. Mock-controllability requirement (the one real test-code change)

To assert "register NOT called when has()→true", the mock's `has` must be
**reconfigurable per test**. The current `has: () => false` arrow fn is not.

`vi.mock` factories are hoisted ABOVE top-level `const`s, so outer-scope
variables cannot be referenced unless declared via `vi.hoisted`. The documented,
working pattern (see vitest docs URL in PRP):

```ts
const { mockHas, mockRegister } = vi.hoisted(() => ({
  mockHas: vi.fn(() => false),
  mockRegister: vi.fn(),
}));

vi.mock('groundswell', () => ({
  configureHarnesses: vi.fn(),
  HarnessRegistry: {
    getInstance: () => ({ has: mockHas, register: mockRegister }),
  },
  PiHarness: class MockPiHarness {},
}));
```

Then:

- `beforeEach`: `mockHas.mockReturnValue(false); mockRegister.mockClear();`
  (plus existing `vi.clearAllMocks()` / env reset).
- New test: `mockHas.mockReturnValue(true); configureHarness();
expect(mockRegister).not.toHaveBeenCalled();`

This is the ONLY structural change to the mock; all existing assertions
(`configureHarnesses.toHaveBeenCalledWith(...)`, etc.) stay valid because
`mockHas` defaults to `false` (same behavior as today).

## 5. IMPORTANT: do NOT run the full `npm run test:run --coverage`

The full suite imports `src/utils/prd-validation-executor.ts` and
`src/utils/cli-help-executor.ts`, whose module load boots live pipeline
executors that self-SIGTERM/SIGKILL after 10s (observed during research:
`[PrdValidationExecutor] PRD validation timed out after 10s, sending SIGTERM`).
This is the "do not run this project" hazard. The contract's validation scope is
the **targeted subset only**:

- `npm run test:run -- config/ agents/agent-factory agents/cache-key-isolation tools/mcp-tool-parity`
- `npm run test:run -- config/harness-config --coverage`

Both are safe (no pipeline executor import).

## 6. Files touched by this subtask

| File                                                             | Change                                                                                                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/config/harness-config.test.ts`                       | Refactor `vi.mock` to use `vi.hoisted` controllable `mockHas`/`mockRegister`; add 1 skip-branch test case; update `beforeEach` resets. |
| (optionally `tests/unit/config/harness-provider-compat.test.ts`) | Alternative host for the skip test — contract allows either. PRP picks `harness-config.test.ts`.                                       |

**No source files change.** S1 shipped the production code; S2 shipped the mock
skeleton; S3 is test-only verification + the explicit skip-branch case.
