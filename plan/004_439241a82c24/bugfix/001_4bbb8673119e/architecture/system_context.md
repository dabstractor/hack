# System Context — Session 004 Bugfix (001)

> Consolidated architectural findings grounding the task breakdown for the 4 issues
> in the bugfix PRD. Read this BEFORE implementing any subtask.

## 1. CRITICAL: Dual Groundswell Environments

The single most important architectural fact for this bugfix:

| Context                           | Resolves `groundswell` →                                             | Has `@earendil-works/pi-coding-agent`? | Has `@anthropic-ai/claude-agent-sdk`? |
| --------------------------------- | -------------------------------------------------------------------- | -------------------------------------- | ------------------------------------- |
| **Tests (vitest)**                | `/home/dustin/projects/groundswell/dist/index.js` (sibling checkout) | **YES**                                | **YES**                               |
| **Runtime (tsx / `npm run dev`)** | `node_modules/groundswell` (yalc copy, `file:.yalc/groundswell`)     | **NO**                                 | **NO**                                |

This is driven by `vitest.config.ts` → `resolve.alias.groundswell` pointing at the sibling
checkout. The sibling checkout has a full `node_modules/` tree; the yalc'd copy ships only `dist/`.

**Implications:**

- The PRD's probe ("registering `PiHarness` makes the throw disappear") is TRUE **in the test
  environment** because the sibling groundswell has `@earendil-works/pi-coding-agent` installed
  (statically imported at the top of `dist/harnesses/pi-harness.js`).
- At runtime, importing `groundswell` itself fails: `mcp-handler.js` has a **static** import of
  `@anthropic-ai/claude-agent-sdk`, which is missing from the yalc tree. This is a **separate,
  pre-existing** environment/dependency concern (cf. PRD Issue 2 note, Issue 4 "pre-existing").
- **The acceptance criteria for Issue 1 is the test suite** (`npm run test:run -- agents/agent-factory`
  → 5 tests green). The fix must work in the vitest environment.

## 2. Issue 1 Root Cause & Fix Surface

**File:** `src/config/harness.ts` — `configureHarness()`.

**Root cause:** `configureHarness()` calls Groundswell's `configureHarnesses({...})`, which only
stores a _config singleton_ (`globalHarnessConfig` in `dist/utils/harness-config.js`). It does **not**
register any harness _instance_ in the `HarnessRegistry`. `new Agent(...)` →
`HarnessRegistry.getInstance().get('pi')` → `undefined` → throws `"Harness 'pi' is not registered"`.

**Confirmed API surface (from sibling + yalc dist):**

- `HarnessRegistry` (singleton): `getInstance()`, `register(provider)` (throws if already
  registered), `has(id) → boolean`, `get(id) → instance | undefined`. Exported from main barrel.
- `PiHarness`: `id = "pi"`, no-arg constructor `new PiHarness()`. Exported from main barrel.
- `configureHarnesses(config)`: validates + stores config only. Exported from main barrel.
- `registerDefaultHarnesses(registry?)`: registers both `pi` and `claude-code` instances. **NOT**
  exported from the main barrel; lives on the `groundswell/harnesses` subpath, which is **NOT** in
  the published `package.json` `exports` map (only `"."` is declared).

**Fix (PRD preferred):** Inside `configureHarness()`, import `{ PiHarness, HarnessRegistry }` from
`'groundswell'` and register idempotently:

```ts
const registry = HarnessRegistry.getInstance();
if (!registry.has('pi')) {
  registry.register(new PiHarness());
}
```

This must run BEFORE `configureHarnesses()` (or at least before any `createAgent()` call). Since
`configureHarness()` is called at module-load in `agent-factory.ts`, placing it there satisfies the
ordering constraint.

**Test mock impact (CRITICAL):** `tests/unit/config/harness-config.test.ts` and
`harness-provider-compat.test.ts` BOTH mock the entire groundswell module:

```ts
vi.mock('groundswell', () => ({ configureHarnesses: vi.fn() }));
```

After the fix, `configureHarness()` imports `PiHarness` + `HarnessRegistry` from groundswell. These
mocks MUST be updated to stub `HarnessRegistry.getInstance()` and `PiHarness` so the mocked
`configureHarness()` still works. Without this, the mock makes `HarnessRegistry` → `undefined` and
the test throws.

`tests/unit/agents/agent-factory.test.ts` does NOT mock groundswell (uses real sibling checkout), so
the real `configureHarness()` at module-load registers `PiHarness` in the real registry → `createAgent()`
succeeds. **The 5 currently-failing tests will pass once registration is added.**

## 3. Issue 2 Root Cause & Fix Surface

**File:** `src/config/harness.ts` — Step 4 (provider compatibility guard).

**Root cause:** The guard compares `DEFAULT_MODEL_PROVIDER` (a compile-time `'zai'` constant) instead
of the _resolved_ provider. So `harness === 'claude-code'` always throws, regardless of model overrides.

**Resolved-provider derivation:** `src/config/environment.ts` exports `getModel(tier)` which returns a
provider-qualified string (e.g. `'zai/GLM-4.7'` or `'anthropic/claude-sonnet-4'` if
`ANTHROPIC_DEFAULT_SONNET_MODEL` is overridden). The effective provider =
`getModel('sonnet').split('/')[0]`. No circular import: `environment.ts` does not import `harness.ts`.

**Fix:**

```ts
import { getModel } from './environment.js';
// ...
const resolvedProvider = getModel('sonnet').split('/')[0];
if (harness === 'claude-code' && resolvedProvider === 'zai') {
  throw new HarnessProviderMismatchError(harness, resolvedProvider);
}
```

This keeps the default `pi + zai` path exactly as-is and realises the "selected independently"
guarantee (PRD §9.4.2). The error is thrown ONLY when claude-code is combined with the effective
`zai` provider.

**Coverage concern:** The vitest config enforces 100% branch coverage on `src/**/*.ts`. New branches:

- `!registry.has('pi')` true/false (Issue 1 registration guard)
- `harness === 'claude-code' && resolvedProvider === 'zai'` true/false (Issue 2 guard)

Both branches must be exercised by tests (existing + new positive claude-code+anthropic case).

## 4. Issue 3 Root Cause & Fix Surface

**`npm run docs:lint`** → `markdownlint "docs/**/*.md"` → `sh: markdownlint: command not found`.
`markdownlint-cli` is NOT in `devDependencies` and not installed anywhere under `node_modules`.

**Fix:** Add `markdownlint-cli` to `devDependencies` (run `npm install --save-dev markdownlint-cli`).
The script `docs:lint: "markdownlint \"docs/**/*.md\""` invokes the `markdownlint` shim binary that
`markdownlint-cli` provides. After install, `npm run docs:lint` may surface lint violations in the
existing `docs/**/*.md` files that must be fixed (or `.markdownlint.json` config added) to make the
gate green.

## 5. Issue 4 Root Cause & Fix Surface

### 5a. ToolExecutor type drift (18 typecheck errors)

Three files import the WRONG `ToolExecutor` type:

```ts
import { MCPHandler, type Tool, type ToolExecutor } from 'groundswell';
```

The barrel re-exports `ToolExecutor` from `dist/types/providers.d.ts`:
`(request: ToolExecutionRequest) => Promise<ToolExecutionResult>`. But
`MCPHandler.registerToolExecutor()` (in `dist/core/mcp-handler.d.ts`) expects a **structurally
different** local type: `(input: unknown) => Promise<unknown>`. Each of the 9 call sites produces
2 errors (TS2352 on the unsound `as ToolExecutor` cast + TS2345 on the incompatible argument) = 18.

**Call sites (verified):**

- `src/tools/bash-mcp.ts:272` — `executeBashCommand(input: BashToolInput): Promise<BashToolResult>`
- `src/tools/filesystem-mcp.ts:513,518,523,528` — `readFile`, `writeFile`, `globFiles`, `grepSearch`
- `src/tools/git-mcp.ts:505,506,507,508` — `gitStatus`, `gitDiff`, `gitAdd`, `gitCommit`

**Runtime contract (confirmed from `dist/core/mcp-handler.js`):** executors are invoked with a single
bare `input` argument; the return is treated as `unknown` (stringified via `JSON.stringify`). So the
MCPHandler-local type `(input: unknown) => Promise<unknown>` is the correct runtime contract.

**Fix:** Remove the `as ToolExecutor` cast and the `ToolExecutor` import from each file. Wrap each
callback in an inline adapter that satisfies `(input: unknown) => Promise<unknown>`:

```ts
this.registerToolExecutor('bash', 'execute_bash', async (input: unknown) =>
  executeBashCommand(input as BashToolInput)
);
```

A function `(input: unknown) => Promise<BashToolResult>` IS assignable to
`(input: unknown) => Promise<unknown>` (covariant return, identical param). The internal
`input as BashToolInput` assertion is safe because the tool schema guarantees the input shape.

**Scope note:** `tsconfig.build.json` (`include: ["src/**/*"]`, `exclude: ["tests"]`) means the
typecheck only covers `src/`. Test files are NOT checked by `npm run typecheck`.
`tests/unit/tools/mcp-tool-parity.test.ts` imports `ToolExecutor`/`ToolExecutionRequest`/
`ToolExecutionResult` from groundswell directly (for its own stubs) — unaffected by this fix.

### 5b. Prettier format:check glob catches generated state

`.prettierignore` excludes `node_modules/ dist/ coverage/ package-lock.json pnpm-lock.yaml .eslintcache`
but NOT `artifacts/` or `plan/`. The `format:check` glob `"**/*.{ts,js,json,md,yml,yaml}"` sweeps
machine-generated files (`artifacts/**/checkpoints.json`, `plan/**/tasks.json`, etc.), failing
`format:check` → failing `npm run validate`.

**Fix:** Add `artifacts/` and `plan/` to `.prettierignore`.

## 6. Test Infrastructure Notes

- `vitest.config.ts`: `environment: 'node'`, `globals: true`, `setupFiles: ['./tests/setup.ts']`,
  **100% coverage thresholds** (statements/branches/functions/lines) on `src/**/*.ts`.
- `tests/setup.ts`: loads `.env`, runs `validateProviderEndpoint()` (from `src/config/endpoint-guard.js`)
  on load AND in every `beforeEach`. Fails on `api.anthropic.com`, warns on non-z.ai endpoints. Must
  not be broken by any fix.
- `resolve.alias`: `groundswell` → sibling checkout (see §1). `@` → `./src`, `#` → `./src/agents`.

## 7. Validation Gates (Definition of Done)

After ALL fixes, the following must pass:

1. `npm run test:run -- agents/agent-factory` → 0 failures (5 currently-failing tests green).
2. `npm run test:run` (full suite) → 0 failures, 100% coverage maintained.
3. `npm run typecheck` → 0 errors (currently 18).
4. `npm run docs:lint` → exits 0 (currently `command not found`).
5. `npm run format:check` → exits 0 (currently fails on generated state files).
6. `npm run validate` (=`lint && format:check && typecheck`) → exits 0.
