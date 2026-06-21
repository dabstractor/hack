# Implementation Notes & Gotchas (Session 004)

Critical subtleties the PRP implementation agents must internalize.

## 1. WHERE the compatibility check must live

`configureHarnesses()` validates the **harness id** (`'pi'|'claude-code'`) and the
keys of `harnessDefaults`, but **NOT** `defaultModelProvider` (open set).
So Groundswell will happily accept `{ defaultHarness:'claude-code', defaultModelProvider:'zai' }`.

Therefore the **PRP pipeline** owns the rule (PRD §9.4.3 / §9.2.4):

> `claude-code` runs Anthropic-only; requesting the z.ai provider on `claude-code`
> is a configuration error surfaced at `initialize()`/`execute()`.

**Implementation:** add a guard in the PRP startup/config path (e.g. a new
`configureHarness()`/`initHarness()` function in `src/config/` or within
`agent-factory.ts`), invoked right after `configureEnvironment()`:

```ts
import { configureHarnesses } from 'groundswell';
const harness = (process.env.PRP_AGENT_HARNESS ?? 'pi') as AgentHarness;
if (harness === 'claude-code' && DEFAULT_PROVIDER === 'zai') {
  throw new HarnessProviderMismatchError(
    'claude-code harness is Anthropic-only and incompatible with the z.ai provider (PRD §9.2.4). ' +
      'Switch to PRP_AGENT_HARNESS=pi or use anthropic/* models.'
  );
}
configureHarnesses({
  defaultHarness: harness,
  defaultModelProvider: 'zai',
  harnessDefaults: { 'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY } },
});
```

## 2. Model string flow (single source of truth)

`createBaseConfig()` → `model = getModel('sonnet')` → `createAgent({ ..., model })`.
Groundswell's `parseModelSpec` parses `provider/model`. So as soon as `getModel()`
returns `zai/GLM-4.7`, every persona agent gets the correct provider-qualified string.

**Prefer ONE helper** (e.g. `qualifyModel(name): string` returning `name.includes('/') ? name : 'zai/' + name`)
so the qualification rule cannot drift between `getModel()`, `MODEL_NAMES`, and `validate-api.ts`.

**Never** produce `pi/zai/GLM-4.7` — `parseModelSpec` throws on 3-segment strings.

## 3. Test fragility — update tests in the SAME subtask as the code

`tests/unit/agents/agent-factory.test.ts` hard-asserts `config.model === 'GLM-4.7'`.
That assertion breaks the moment `getModel()` returns `zai/GLM-4.7`. Per implicit-TDD,
the implementation subtask must update the assertion to `'zai/GLM-4.7'` (and may add a
`config.harness` assertion) in the same commit so the suite stays green.

## 4. Groundswell is a yalc-linked dependency

`package.json`: `"groundswell": "file:.yalc/groundswell"`. It is **read-only** from
this project. Do NOT edit `~/projects/groundswell/src` to "fix" anything — if an
export seems missing, re-verify against the built `dist/` and the source tables in
`external_deps.md`. All required exports (`configureHarnesses`, `parseModelSpec`,
types, adapters) are confirmed present.

## 5. `configureEnvironment()` already runs at module load

`agent-factory.ts` calls `configureEnvironment()` at import time (top-level side effect).
The harness wiring must be added adjacent to that call so ordering is deterministic:
`configureEnvironment()` (maps token/base url) → harness/provider compatibility check
→ `configureHarnesses()`. Tests that import the factory will trigger this chain.

## 6. docs/GROUNDSWELL_GUIDE.md is a CREATE, not an edit

It does not exist in `hacky-hack/docs/`. The doc subtask must **create** it (with at
least the Harness System section per PRD §9.4). A prior-session copy lives at
`plan/003_b3d3efdaf0ed/docs/GROUNDSWELL_GUIDE.md` and may be referenced for tone, but
the new file must live at `docs/GROUNDSWELL_GUIDE.md`.

## 7. Validation gates (Definition of Done per subtask)

Every subtask implies: failing test → implement → pass. Before marking a subtask done:

- `npm run validate` passes (lint + format:check + typecheck).
- `npm run test:run` (relevant unit tests) passes.
- No regression in untouched suites.

## 8. Ordering / dependencies (for the orchestrator)

- `M1.T1` (harness env + wiring) and `M1.T2` (model qualification) are independent
  config changes but both feed `M2` (tests/docs depend on both being in place).
- Within `M1.T1`: S1 (constants/types/env read) before S2 (startup call + compat guard).
- Within `M1.T2`: S1 (qualify defaults) before S2 (factory literals + types).
- `M2.T1`/`M2.T2`/`M2.T3` are mutually independent but all depend on `M1` complete.
