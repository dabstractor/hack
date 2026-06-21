# Bug Fix Requirements

## Overview

End-to-end QA validation of **Session 004 — Pluggable Agent Harness System** (delta
phase: wire Groundswell's pluggable harness into the PRP pipeline per PRD §9.4).

Testing performed:
- Read PRD §9.2.2 / §9.2.3 / §9.2.4 / §9.3.3 / §9.4 and the delta_prd.md.
- Mapped every P1.M1 / P1.M2 subtask to its implementation and ran its tests.
- Ran the full session-004 test surface (`config/*`, `tools/mcp-tool-parity`,
  `agents/cache-key-isolation`, `agents/agent-factory`) plus `npm run validate`.
- Performed root-cause analysis on every failure (including controlled probes that
  register `PiHarness` / `registerDefaultHarnesses` to confirm the fix).

Overall assessment: The **configuration, model-qualification, endpoint-guard,
parity, cache-isolation, and documentation** deliverables are solid and their tests
pass. However, the **end-to-end integration is broken**: the harness is configured
but never *registered* with Groundswell's `HarnessRegistry`, so `createAgent()`
throws for **every** persona factory and the pipeline cannot instantiate a single
agent. This directly violates the P1.M1.T2.S2 acceptance criteria ("All persona
factories must still create agents without throwing … full `npm run test:run` must
pass with no regressions"). A second issue makes the optional `claude-code`
harness permanently unusable, contradicting PRD §9.4.1.

## Critical Issues (Must Fix)

### Issue 1: `createAgent()` throws "Harness 'pi' is not registered" for all persona factories — pipeline cannot create any agent

**Severity**: Critical
**PRD Reference**: §9.3.3 (Agent Runtime & Personas), §9.4.2 (`configureHarnesses()`
startup wiring), §9.4.3 (feature parity), §9.5 Roadmap step 1. Task contract:
P1.M1.T2.S2 ("All persona factories must still create agents without throwing …
`npm run test:run` must pass with no regressions").

**Expected Behavior**: After startup, `createArchitectAgent()`,
`createResearcherAgent()`, `createCoderAgent()`, and `createQAAgent()` must each
return a live Groundswell `Agent` without throwing, because the configured harness
(`pi`) is available for instantiation.

**Actual Behavior**: Every persona factory throws synchronously at the
`createAgent(config)` call:

```
Error: Harness 'pi' is not registered
  ❯ new Agent        ../groundswell/src/core/agent.ts:131:13
  ❯ Module.createAgent ../groundswell/src/core/factory.ts:61:10
  ❯ Module.createArchitectAgent src/agents/agent-factory.ts:242:10
```

5 tests in `tests/unit/agents/agent-factory.test.ts` fail:
- `should create multiple agents without MCP server registration conflicts`
- `should create architect agent successfully`
- `should create researcher agent successfully`
- `should create coder agent successfully`
- `should create QA agent successfully`

**Steps to Reproduce**:
```bash
npm run test:run -- agents/agent-factory
# → 5 failures, all "Error: Harness 'pi' is not registered"
```
Or directly:
```bash
npx tsx -e "import('./src/agents/agent-factory.js').then(m => m.createArchitectAgent())"
# → Error: Harness 'pi' is not registered
```

**Root Cause** (confirmed by analysis + probe):
`src/config/harness.ts` `configureHarness()` calls Groundswell's
`configureHarnesses({ defaultHarness, defaultModelProvider, harnessDefaults })`.
That function **only stores the default-config singleton** — it does **not**
register any harness instance in the `HarnessRegistry`. Groundswell's
`new Agent(...)` then does `HarnessRegistry.getInstance().get('pi')`, finds nothing,
and throws. The registration step that the architecture notes document —
`registerDefaultHarnesses()` (`plan/004_439241a82c24/architecture/external_deps.md`
§5: "idempotent — registers `pi` and `claude-code` instances") — is **never called
anywhere** in `src/`:

```bash
$ grep -rn "registerDefaultHarnesses\|new PiHarness\|registry.register" src/
# (no matches)
```

Confirmation probe (added temporarily, then removed): registering `PiHarness`
immediately before `createAgent()` makes the throw disappear:
```ts
HarnessRegistry.getInstance().register(new PiHarness());
createAgent({ name, system, model: 'zai/GLM-4.7', harness: 'pi', mcps: [] }); // ✓ no throw
```

**Suggested Fix**: Register the `pi` harness inside `configureHarness()` so the
runtime is usable by default. Two viable approaches:

1. Preferred (default path only — `claude-code` is always rejected for `zai`
   anyway per Issue 2 / PRD §9.2.4):
   ```ts
   // src/config/harness.ts
   import { configureHarnesses, PiHarness, HarnessRegistry } from 'groundswell';
   // ...
   const registry = HarnessRegistry.getInstance();
   if (!registry.has('pi')) {
     registry.register(new PiHarness());
   }
   configureHarnesses({ defaultHarness: harness, defaultModelProvider: DEFAULT_MODEL_PROVIDER, ... });
   ```
   (Why not `registerDefaultHarnesses()` from `groundswell/harnesses`: that
   subpath is not in the published package `exports`, and it imports
   `ClaudeCodeHarness` → `@anthropic-ai/claude-agent-sdk`, which is not
   installed and would crash module load. Registering only `PiHarness` from the
   main entry avoids both problems and matches the z.ai-default stance.)

2. Add the missing test coverage that the contract asked for: an assertion that
   `createArchitectAgent()` / `createResearcherAgent()` / `createCoderAgent()` /
   `createQAAgent()` all execute without throwing **after** registration.

Whichever approach is chosen, the fix must be validated by running
`npm run test:run -- agents/agent-factory` and confirming all 5 tests go green.

---

## Major Issues (Should Fix)

### Issue 2: The `claude-code` harness is permanently unusable — compatibility guard checks a hardcoded constant instead of the resolved provider

**Severity**: Major
**PRD Reference**: §9.4.1 (`claude-code` listed as a supported optional harness),
§9.4.3 ("Requesting the z.ai provider on `claude-code` is a configuration error"
— implies `anthropic` on `claude-code` is valid), §9.2.4 note ("selecting it
requires switching to `anthropic/*` models and disabling this safeguard").

**Expected Behavior**: Per PRD §9.4.1 / §9.2.4, a user who selects
`PRP_AGENT_HARNESS=claude-code` together with `anthropic/*` model overrides (and
the appropriate endpoint) should be able to use the `claude-code` runtime. The
mismatch error should fire **only** when `claude-code` is combined with the `zai`
provider.

**Actual Behavior**: `configureHarness()` in `src/config/harness.ts` compares
against the compile-time constant `DEFAULT_MODEL_PROVIDER` (always `'zai'`):

```ts
// Step 4: Enforce harness↔provider compatibility
if (harness === 'claude-code' && DEFAULT_MODEL_PROVIDER === 'zai') {
  throw new HarnessProviderMismatchError(harness, DEFAULT_MODEL_PROVIDER);
}
```

Because `DEFAULT_MODEL_PROVIDER` is a hardcoded `'zai'` literal, this branch
**always** throws whenever `harness === 'claude-code'` — regardless of what model
overrides the user supplied. There is no code path that reads the *actual*
provider segment from the resolved model strings (`getModel(...)` /
`ANTHROPIC_DEFAULT_*_MODEL`). The "pluggable" harness system therefore cannot
actually plug in `claude-code`.

**Steps to Reproduce** (probe test, since no first-class test asserts the positive
`claude-code` + anthropic case):
```ts
vi.stubEnv('PRP_AGENT_HARNESS', 'claude-code');
vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4');
vi.stubEnv('ANTHROPIC_DEFAULT_HAIKU_MODEL',  'anthropic/claude-haiku');
vi.stubEnv('ANTHROPIC_DEFAULT_OPUS_MODEL',   'anthropic/claude-opus');
expect(() => configureHarness()).toThrow(/incompatible|Mismatch/i); // ← wrongly throws
```

**Suggested Fix**: Derive the effective provider from the resolved model string(s)
rather than the constant. E.g. inspect `getModel('sonnet').split('/')[0]` (or
introduce a `getResolvedProvider()` helper) and only throw
`HarnessProviderMismatchError` when that effective provider is `zai`. Keep the
default (`pi` + `zai`) path exactly as-is. This realises the "selected
independently" guarantee in PRD §9.4.2 and the §9.4.1 claim that `claude-code` is
a supported option.

(Note: fully exercising `claude-code` at runtime also requires the
`@anthropic-ai/claude-agent-sdk` optional dependency to be installed; that is an
environment/dependency concern and can be tracked separately. The code-level guard
should still be corrected so the configuration is no longer rejected on principle.)

---

## Minor Issues (Nice to Fix)

### Issue 3: `npm run docs:lint` is non-functional — the markdownlint gate the doc tasks rely on cannot run

**Severity**: Minor
**PRD Reference**: P1.M2.T3.S1 / P1.M2.T3.S2 contracts ("Run `npm run docs:lint`
(markdownlint) and `npm run format:check`; fix lint/format issues introduced.").

**Expected Behavior**: `npm run docs:lint` runs markdownlint against `docs/**/*.md`
so documentation formatting can be validated.

**Actual Behavior**:
```bash
$ npm run docs:lint
> markdownlint "docs/**/*.md"
sh: line 1: markdownlint: command not found
```
`markdownlint` / `markdownlint-cli` is **not** listed in `package.json`
`devDependencies`, so the script always fails. Both doc subtasks therefore could
not have actually passed their stated validation gate.

**Steps to Reproduce**: `npm run docs:lint` → exits non-zero with
`command not found`.

**Suggested Fix**: Add `markdownlint-cli` (and a `markdownlint` shim or use
`npx markdownlint-cli`) to `devDependencies`, or adjust the script to
`markdownlint-cli2` / `npx markdownlint-cli "docs/**/*.md"`. (Formatting of the
two new doc sections already passes `prettier --check`.)

### Issue 4: `npm run validate` fails on pre-existing TypeScript errors in MCP tool files (ToolExecutor type drift)

**Severity**: Minor (pre-existing, not introduced by Session 004, but it blocks the
`npm run validate` gate that every Session-004 task contract requires)

**PRD Reference**: §9.3.3 (tools via `MCPHandler`); Session-004 task contracts
repeatedly require "`npm run validate` must pass".

**Expected Behavior**: `npm run validate` (=`lint && format:check && typecheck`)
exits 0.

**Actual Behavior**: `npm run typecheck` reports 18 errors in
`src/tools/bash-mcp.ts`, `src/tools/filesystem-mcp.ts`, and `src/tools/git-mcp.ts`:

```
error TS2345 / TS2352: Argument of type '…ToolExecutor' (from groundswell/dist/types/providers)
is not assignable to parameter of type '…ToolExecutor' (from groundswell/dist/core/mcp-handler).
Types of parameters 'request' and 'input' are incompatible.
Type 'unknown' is not assignable to type 'ToolExecutionRequest'.
```
There are two structurally different `ToolExecutor` definitions in the consumed
Groundswell dist (`types/providers` vs `core/mcp-handler`), and the MCP tool
`registerToolExecutor` calls straddle them. (`format:check` also flags 5 generated
state files under `artifacts/` and `plan/` — the glob catches pipeline state.)

**Steps to Reproduce**: `npm run typecheck` → 18 errors.

**Suggested Fix**: Align the tool callbacks with the `MCPHandler.ToolExecutor`
signature (`(req: ToolExecutionRequest) => Promise<ToolExecutionResult>`,
returning `{ content, isError }`). Narrow the `unknown` input or route the
existing `(input) => Result` callbacks through a small adapter. Separately,
exclude `artifacts/**` and `plan/**` from the `format` glob so generated state
doesn't fail `format:check`. (Confirmed pre-existing: at the pre-Session-004
commit `e3d82f4` the same `typecheck` produced 24 errors — Session 004 did not
introduce them, but it also did not leave the gate green.)

## Testing Summary

- Total tests performed (Session-004 surface): 84 unit tests across 7 relevant
  files, plus `validate`/`typecheck`/`docs:lint`/`format:check` gates, plus
  controlled probes (register `PiHarness`; claude-code + anthropic config).
- Passing: 79 of 84 in the Session-004 surface (all `config/*`,
  `tools/mcp-tool-parity`, `agents/cache-key-isolation`, and the non-creation
  cases of `agents/agent-factory`).
- Failing: 5 (all in `tests/unit/agents/agent-factory.test.ts` — the persona
  factory creation tests; see Issue 1).
- Areas with good coverage:
  - Constants/types/error-class definitions (P1.M1.T1.S1).
  - `configureHarness()` env reading, default fallback, invalid-value rejection,
    and `claude-code`+`zai` mismatch (P1.M1.T1.S2 / P1.M2.T1.S2).
  - Model qualification / provider-prefix idempotency (P1.M1.T2.S1).
  - Provider-endpoint guard decision table + "constrains the provider, not the
    harness" messaging (P1.M2.T1.S1).
  - MCP tool discovery parity + `MCPHandler` execution dispatch (P1.M2.T2.S1).
  - Cache-key isolation across harness × provider/model (P1.M2.T2.S2).
  - `docs/CONFIGURATION.md` and `docs/GROUNDSWELL_GUIDE.md` content (P1.M2.T3).
- Areas needing more attention:
  - **End-to-end agent instantiation** — no test (and no startup code) actually
    registers a harness instance, so the pipeline cannot create any agent
    (Issue 1).
  - **Positive `claude-code` path** — only the rejection case is tested; the
    valid `claude-code` + anthropic configuration is untested and unimplemented
    (Issue 2).
  - The `npm run validate` and `npm run docs:lint` gates are not green, so the
    contracts' validation criteria are not demonstrably met (Issues 3–4).
