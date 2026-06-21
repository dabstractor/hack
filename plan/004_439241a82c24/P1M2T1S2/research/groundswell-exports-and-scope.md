# Research: Groundswell harness helpers + M2.T1.S2 scope analysis

Consolidates the TWO load-bearing facts for the Harness/provider compatibility
rejection test (P1.M2.T1.S2). Re-verified against current source on 2026-06-20.

## 1. ⚠️ `getGlobalHarnessConfig` / `resetGlobalHarnessConfig` are UNREACHABLE

The work-item CONTRACT literally says:

> "`getGlobalHarnessConfig().defaultHarness === 'pi'`"
> "reset Groundswell global config with `resetGlobalHarnessConfig()` in afterEach"

**This is impossible as written.** Groundswell defines both helpers (they exist in
`~/projects/groundswell/src/utils/harness-config.ts` — `getGlobalHarnessConfig`
line 158, `resetGlobalHarnessConfig` line 222, the latter marked
"FOR TESTING PURPOSES ONLY"), but they are **NOT re-exported from the package root**:

- `~/projects/groundswell/package.json` `exports` field exposes **ONLY `.`**:
  ```json
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } }
  ```
- `~/projects/groundswell/dist/index.js` (the file the vitest `resolve.alias`
  maps the bare specifier `'groundswell'` to) re-exports from
  `./utils/harness-config.js` **only `configureHarnesses`**:
  ```js
  export { configureHarnesses } from './utils/harness-config.js'; // line 21
  ```
- There is NO `export * from './utils/...'` wildcard at the root, and the
  `exports` map BLOCKS any deep-path import like
  `'groundswell/dist/utils/harness-config.js'`.
- `src/utils/index.ts` line 4 DOES export all four, but that barrel is itself not
  re-exported from the package root, so it is unreachable from this project.

P1.M1.T1.S2 already runtime-probed this in the vitest context and recorded
`typeof getGlobalHarnessConfig === 'undefined'` and
`typeof resetGlobalHarnessConfig === 'undefined'`. (A fresh top-level
`import('groundswell')` from this repo throws on a missing
`@anthropic-ai/claude-agent-sdk` peer before reaching the named exports, which is
further evidence the package is not safely importable beyond its declared
surface.)

### ✅ Working alternative (verified by P1.M1.T1.S2, green in this repo)

Mock `configureHarnesses` and assert on its call args. This is the idiomatic,
file-scoped pattern already used in `tests/unit/config/harness-config.test.ts`:

```ts
vi.mock('groundswell', () => ({ configureHarnesses: vi.fn() }));
import { configureHarnesses } from 'groundswell';
// ... configureHarness(); ...
expect(configureHarnesses).toHaveBeenCalledWith(
  expect.objectContaining({ defaultHarness: 'pi', defaultModelProvider: 'zai' })
);
```

**How this maps to the contract's intent:**

| Contract phrase (literal)                          | Reality / working equivalent                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `getGlobalHarnessConfig().defaultHarness === 'pi'` | Unreachable. Assert `configureHarnesses` was called with `{ defaultHarness: 'pi', ... }` (the output).        |
| `resetGlobalHarnessConfig()` in `afterEach`        | Unreachable. Use `vi.clearAllMocks()` in `beforeEach` + `vi.unstubAllEnvs()` in `afterEach` (global default). |
| Query the configured singleton                     | Not possible from outside the package. The mock captures the config object instead.                           |

`vi.mock` is hoisted + scoped per test file, so it does NOT leak into
`agent-factory.test.ts` (which imports the real `configureHarnesses`).

---

## 2. Scope: what is NEW vs already covered by P1.M1.T1.S2

P1.M1.T1.S2 (Complete) created `tests/unit/config/harness-config.test.ts`, which
ALREADY asserts the four startup-path cases:

| Case                                                   | harness-config.test.ts (M1.T1.S2)                                                                  | M2.T1.S2 adds                                                                                                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) env unset / explicit `pi` + `zai` succeeds         | ✅ returns 'pi', `configureHarnesses` called with `defaultHarness:'pi'`                            | Re-affirm via the **compatibility** lens; no new behavior.                                                                                                                                      |
| (b) `claude-code` + `zai` throws + cites §9.2.4        | ✅ throws `HarnessProviderMismatchError`, message contains §9.2.4, `configureHarnesses` NOT called | **NEW**: assert message explicitly _points to switching harness or model provider_ (current msg "Select a compatible harness/provider pair." is too vague → tighten it).                        |
| (c) `claude-code` is a _structurally valid_ harness id | ❌ NOT asserted anywhere                                                                           | **HEADLINE NEW assertion**: `SUPPORTED_HARNESSES.includes('claude-code') === true`; distinguish "unknown id" (plain `Error`, case d) from "incompatible pair" (`HarnessProviderMismatchError`). |
| (d) invalid value → plain Error listing supported ids  | ✅                                                                                                 | Re-use as the _contrast_ proving claude-code is NOT rejected as unknown.                                                                                                                        |

**Net new deliverable for M2.T1.S2:**

1. The **structural-validity** test (case c) — claude-code is a known id, rejected
   ONLY for the z.ai provider mismatch. This is the genuinely novel coverage.
2. The **actionable-guidance** message assertion (case b) — requires tightening
   the `HarnessProviderMismatchError` message in `src/config/types.ts` so it
   explicitly names BOTH remediation paths (switch harness → `pi`, OR switch
   provider → `anthropic/*`). Surgical string edit; preserves all tokens already
   asserted by existing tests.

### Message-edit safety analysis (verified)

Current message (`src/config/types.ts` lines 153–155):

```
`Harness '${harness}' is incompatible with provider '${provider}' (PRD §9.2.4). `
  + `Select a compatible harness/provider pair.`
```

Existing message assertions in the repo (grep-confirmed, exhaustive):

- `tests/unit/config/harness.test.ts` (S1): `message` contains `'claude-code'` AND `'zai'`.
- `tests/unit/config/harness-config.test.ts` (M1.T1.S2): `message` contains `'§9.2.4'`.

No file asserts the exact full string. Therefore a tightened message is SAFE as
long as it still contains the three tokens: **`claude-code`**, **`zai`**, **`§9.2.4`**.
The tightened message keeps the interpolation `Harness '${harness}' ... provider '${provider}'`,
so 'claude-code' and 'zai' are preserved automatically; §9.2.4 is kept verbatim.

Target message (aligned with `architecture/implementation_notes.md §1` which
prescribed "Switch to PRP_AGENT_HARNESS=pi or use anthropic/\* models."):

```
`Harness '${harness}' is incompatible with provider '${provider}' (PRD §9.2.4). `
  + `Switch the harness to 'pi' (PRP_AGENT_HARNESS=pi) or switch the model provider to anthropic/* models.`
```

---

## 3. Disjointness from the parallel P1.M2.T1.S1

P1.M2.T1.S1 (running in parallel) creates `src/config/endpoint-guard.ts` +
`tests/unit/config/endpoint-guard.test.ts` and refactors the provider-ENDPOINT
guard. That is **orthogonal** to this item: it constrains the provider ENDPOINT
(URL); M2.T1.S2 constrains the harness×provider PAIR (id compatibility). The two
test files are disjoint (`endpoint-guard.test.ts` vs `harness-provider-compat.test.ts`)
and touch disjoint source (`endpoint-guard.ts` vs `types.ts` message string).
No merge conflict.
