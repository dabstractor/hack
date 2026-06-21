# Research: Groundswell Harness API surface (P1.M1.T1.S2)

## ⚠️ CRITICAL FINDING — Groundswell public surface does NOT export the test helpers

The work-item CONTRACT states:

> "Groundswell exports `configureHarnesses`, `resetGlobalHarnessConfig` (tests)."
> "Reset global harness config between tests via Groundswell's `resetGlobalHarnessConfig()`."
> "A configured global harness singleton (queryable via Groundswell `getGlobalHarnessConfig()`)."

**This assumption is only HALF correct.** Empirically verified in this project's vitest setup:

| Function                   | Importable from `'groundswell'`? | Where it actually lives                                                          |
| -------------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| `configureHarnesses`       | ✅ YES (typeof === 'function')   | re-exported in `dist/index.js`                                                   |
| `getGlobalHarnessConfig`   | ❌ NO (typeof === 'undefined')   | only in `dist/utils/harness-config.js`, `@internal`                              |
| `resetGlobalHarnessConfig` | ❌ NO (typeof === 'undefined')   | only in `dist/utils/harness-config.js`, `@internal`, "FOR TESTING PURPOSES ONLY" |

### Proof (runtime probe, 2026-06-20)

```
const g = await import('groundswell');
typeof g.configureHarnesses       === 'function'   ✓
typeof g.getGlobalHarnessConfig   === 'undefined'  ✗   ← contract assumed 'function'
typeof g.resetGlobalHarnessConfig === 'undefined'  ✗   ← contract assumed 'function'
```

### Why deep-path imports are ALSO blocked

`node_modules/groundswell` → symlink → `.yalc/groundswell`, and Groundswell's
`package.json` `exports` field is restricted to the root only:

```json
"exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } }
```

Under Node ESM resolution, `import ... from 'groundswell/dist/utils/harness-config.js'`
is REJECTED by the `exports` map (no subpath exposed). The vitest `resolve.alias`
maps ONLY the exact specifier `'groundswell'` → `~/projects/groundswell/dist/index.js`,
so subpath imports are not intercepted either. Relying on deep imports of an
`@internal` symbol would be brittle and semantically wrong.

## ✅ RESOLUTION — mock `configureHarnesses` (verified working)

The robust, idiomatic solution is to **mock `configureHarnesses`** via
`vi.mock('groundswell', ...)` and assert on the call args. Verified in this repo:

```
vi.mock('groundswell', () => ({ configureHarnesses: vi.fn(), ... }));
...
configureHarnesses({ defaultHarness: 'pi' });
expect(configureHarnesses).toHaveBeenCalledWith({ defaultHarness: 'pi' });   ✓ PASS
```

### Why this fully satisfies the S2 contract

- **Throw cases** (claude-code+zai, invalid harness): the wrapper throws BEFORE
  calling `configureHarnesses`, so no singleton state is touched — no reset needed.
- **Success cases** (default 'pi', explicit 'pi'): assert `configureHarnesses` was
  called with the exact `{ defaultHarness, defaultModelProvider, harnessDefaults }`
  object. This verifies the _output_ of `configureHarness()` directly — which is the
  actual deliverable. The real singleton gets configured identically in production
  (non-test) imports; we simply cannot _query_ it from outside the package, and we
  don't need to for S2.

Precedent: `vi.mock` is used throughout this codebase (task-patcher.test.ts,
dependency-validator.test.ts, prp-executor.test.ts mocks agent-factory itself).
`vi.mock('groundswell', ...)` is hoisted + scoped per test file, so it does NOT
leak into `agent-factory.test.ts` (which uses the real `configureHarnesses`).

---

## configureHarnesses() validation behavior (verified from dist source)

`~/projects/groundswell/dist/utils/harness-config.js` — `configureHarnesses(config)`:

1. Validates `config.defaultHarness ∈ {'pi','claude-code'}` — throws
   `Error("Invalid default harness: \"X\". Supported harnesses: \"pi\", \"claude-code\"")`
2. Validates each key of `config.harnessDefaults` (if present) is a valid HarnessId.
3. **Does NOT validate `defaultModelProvider`** (open set — any string accepted).

⇒ Groundswell happily accepts `{ defaultHarness:'claude-code', defaultModelProvider:'zai' }`.
This is WHY the PRP pipeline must own `HarnessProviderMismatchError` (PRD §9.2.4/§9.4.3).

## GlobalHarnessConfig type shape (verified — types/harnesses.d.ts)

```ts
export interface GlobalHarnessConfig {
  defaultHarness: HarnessId; // 'pi' | 'claude-code'  (required)
  harnessDefaults?: Partial<Record<HarnessId, HarnessOptions>>; // optional, keyed by HarnessId
  defaultModelProvider?: ModelProviderId; // optional, OPEN set
}
```

`HarnessOptions` is an interface with optional fields including `apiKey`. So
`harnessDefaults: { 'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY } }`
is type-valid (matches PRD §9.4.2 example verbatim).
