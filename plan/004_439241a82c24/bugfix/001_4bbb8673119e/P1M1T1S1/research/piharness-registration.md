# Research — P1.M1.T1.S1 (Register PiHarness idempotently in configureHarness)

Surgical bugfix for Issue 1 (TEST_RESULTS.md): `createAgent()` throws
`"Harness 'pi' is not registered"` because `configureHarnesses()` only stores a
config singleton and never populates the `HarnessRegistry`.

## 1. Verified Groundswell API surface (`~/projects/groundswell/dist/index.js`)

Main barrel exports (all three used by this fix):
```js
17: export { HarnessRegistry, ProviderRegistry } from './harnesses/harness-registry.js';
19: export { PiHarness } from './harnesses/pi-harness.js';
21: export { configureHarnesses } from './utils/harness-config.js';
```
→ Safe to import all three from a single `'groundswell'` specifier.

## 2. HarnessRegistry singleton behavior (`dist/harnesses/harness-registry.js`)

```js
static getInstance()        // lazy singleton; fresh empty Map until first call
register(provider) {
  if (this.providers.has(provider.id)) {
    throw new Error(`Provider '${provider.id}' is already registered`); // ← THROWS
  }
  this.providers.set(provider.id, provider);
}
has(id) { return this.providers.has(id); }  // boolean — use as the idempotency guard
get(id) { return this.providers.get(id); }  // undefined when missing (does NOT throw)
```
**Mandatory consequence:** `configureHarness()` runs at module-load in
`agent-factory.ts`. Without the `if (!registry.has('pi'))` guard, the SECOND
import of agent-factory (common across test files) would throw
`"Provider 'pi' is already registered"`. The guard is NON-NEGOTIABLE.

## 3. PiHarness (`dist/harnesses/pi-harness.js`)

- `export class PiHarness { id = "pi"; ... }` — no-arg constructor.
- Top-of-file STATIC import: `import { ModelRegistry, AuthStorage } from "@earendil-works/pi-coding-agent";`
  - This resolves FINE under the vitest alias (sibling checkout has the package installed).
  - It does NOT resolve in the yalc runtime tree — but that is a **pre-existing, separate**
    environment concern (TEST_RESULTS.md Issue 4 / system_context.md §1). This subtask's
    acceptance is the **test suite**, which runs in the alias environment.

## 4. Why NOT `registerDefaultHarnesses()` from `groundswell/harnesses`

(system_context.md §2, groundswell_harness_registry.md §1)
- NOT exported from the main barrel — only the `'.'` path is in the published `exports` map.
- It imports `ClaudeCodeHarness` → `@anthropic-ai/claude-agent-sdk`, which is not installed
  and would crash module load.
- Manual `new PiHarness()` registration avoids both problems and matches the z.ai-default stance
  (claude-code is always rejected for zai per Issue 2 anyway).

## 5. Current state of `src/config/harness.ts`

- File is typecheck-clean (`npx tsc --noEmit -p tsconfig.build.json` reports ZERO errors in harness.ts).
- Current groundswell import (single named import): `import { configureHarnesses } from 'groundswell';`
- `configureHarness()` has 6 numbered steps. The registration block goes AFTER Step 4
  (provider-compat guard) and BEFORE Step 5 (the `configureHarnesses()` call). Ordering rationale:
  registering before or after `configureHarnesses()` both work (registry ≠ config singleton),
  but placing it between Step 4 and Step 5 keeps the "validate → configure" narrative and matches
  the system_context.md §2 example. The contract pins this placement exactly — follow it.
- Return value (`harness: AgentHarness`) is UNCHANGED.

## 6. CRITICAL scope boundary — what NOT to touch in S1

- **Step 4 guard logic** (`DEFAULT_MODEL_PROVIDER === 'zai'`) must NOT change — Issue 2's
  resolved-provider fix is a separate subtask (P1.M1.T2.S1). Changing it here would violate
  the "do not change Step 4's DEFAULT_MODEL_PROVIDER logic here" contract clause.
- **Test files** (`harness-config.test.ts`, `harness-provider-compat.test.ts`) are NOT touched
  in S1 — they `vi.mock('groundswell', () => ({ configureHarnesses: vi.fn() }))`, so after this
  fix `HarnessRegistry`/`PiHarness` will be `undefined` under those mocks and those tests WILL
  FAIL. That is EXPECTED and is fixed in S2. The contract explicitly says: do NOT run the full
  test suite in S1; run only `npx tsc --noEmit -p tsconfig.build.json`.

## 7. Validation for S1 (source-only)

- `npx tsc --noEmit -p tsconfig.build.json` → must report NO NEW errors in `src/config/harness.ts`.
  (Pre-existing 18 errors in `src/tools/*-mcp.ts` — Issue 4 — are unrelated and out of scope.)
- Do NOT run `npm run test:run` (mock-based config tests fail until S2).
- Do NOT run `npm run validate` (it includes the full test/typecheck suite).
