# PRP — P1.M1.T1.S2: Wire `configureHarnesses()` at startup with harness↔provider compatibility guard

---

## Goal

**Feature Goal**: Add a `configureHarness()` initialization function that reads
`PRP_AGENT_HARNESS` from the environment, validates it against `SUPPORTED_HARNESSES`,
**enforces** the `claude-code` + z.ai incompatibility (PRD §9.2.4 / §9.4.3) by
throwing `HarnessProviderMismatchError`, then calls Groundswell's
`configureHarnesses()` — and wire it into `src/agents/agent-factory.ts` so it runs
deterministically right after the existing top-level `configureEnvironment()` call.

**Deliverable**:

1. **`src/config/harness.ts`** — NEW file exporting `configureHarness(): AgentHarness`
   (reads env → validates → compat-check → `configureHarnesses()`; returns the
   resolved harness value for downstream consumption).
2. **`src/agents/agent-factory.ts`** — EDIT: add `import { configureHarness }` and a
   single top-level `configureHarness();` call directly beneath the existing
   `configureEnvironment();` side effect.
3. **`tests/unit/config/harness-config.test.ts`** — NEW failing-first unit test file
   covering all four contract cases (implicit TDD: RED → GREEN).

**Success Definition**:

- `PRP_AGENT_HARNESS` unset → harness resolves to `'pi'`, no throw,
  `configureHarnesses` called with `{ defaultHarness:'pi', defaultModelProvider:'zai', harnessDefaults:{ 'claude-code': { apiKey } } }`.
- Explicit `pi` + `zai` → succeeds, `configureHarnesses` invoked with `defaultHarness:'pi'`.
- Explicit `claude-code` + `zai` → throws `HarnessProviderMismatchError` (name + message cite §9.2.4).
- Invalid `PRP_AGENT_HARNESS` value → throws with a supported-harnesses message.
- `npm run validate` passes (lint + format:check + typecheck).
- `npm run test:run -- config` passes with **100% coverage** on the new file.
- Full `npm run test:run` stays green (no regression — `agent-factory.test.ts` unaffected).

---

## Why

- **Completes the harness startup wiring (PRD §9.4.2 / §9.5).** Groundswell's
  `configureHarnesses()` validates **only** harness ids — it does NOT reject
  `claude-code` + `zai` (verified — `defaultModelProvider` is an open set). The PRP
  pipeline therefore OWNS the compatibility guard (PRD §9.4.3). S2 is where that
  guard lives and fires.
- **Unblocks P1.M1.T2.S2.** The agent-factory `harness` field will consume the
  `AgentHarness` value that `configureHarness()` resolves and the configured global
  singleton that `configureHarnesses()` populates.
- **Cost safeguard (PRD §9.2.4).** Defaulting to `pi` + `zai` keeps the z.ai provider
  endpoint guard effective; hard-rejecting `claude-code` + `zai` prevents a
  misconfiguration that would otherwise route to Anthropic's production API.
- **Out of scope (hard boundary):** qualifying model strings (`zai/<model>` — that is
  M1.T2.S1), adding a `harness` field to `AgentConfig` (M1.T2.S2), docs (M2.T3),
  making the provider env-configurable (later milestones). The compat check compares
  against the `DEFAULT_MODEL_PROVIDER` constant only.

---

## What

### User-visible behavior

None at the CLI surface — this is a startup configuration side effect. The only
observable runtime effects are: (a) Groundswell's global harness singleton is
populated on import of `agent-factory.ts`, and (b) a misconfigured
`PRP_AGENT_HARNESS=claude-code` (with the default z.ai provider) crashes startup
with a clear, actionable error instead of silently misbehaving.

### Technical requirements (exact contract)

**`src/config/harness.ts`** exports one function:

```ts
export function configureHarness(): AgentHarness;
```

Logic, in order:

1. Read `const raw = process.env.PRP_AGENT_HARNESS ?? DEFAULT_HARNESS;` (`DEFAULT_HARNESS === 'pi'`).
2. **Validate:** `if (!SUPPORTED_HARNESSES.includes(raw as AgentHarness))` →
   `throw new Error(...)` with a message that **lists the supported harnesses**
   (e.g. `Unsupported PRP_AGENT_HARNESS value: "<raw>". Supported harnesses: pi, claude-code.`).
   Throw a plain `Error` here (this is an _unknown value_ failure, distinct from a
   _compatibility_ failure).
3. `const harness = raw as AgentHarness;` (now type-safe — validated in step 2).
4. **Enforce compatibility:** `if (harness === 'claude-code' && DEFAULT_MODEL_PROVIDER === 'zai')`
   → `throw new HarnessProviderMismatchError(harness, DEFAULT_MODEL_PROVIDER);`
   (S1's constructor already cites PRD §9.2.4 in its message).
5. `configureHarnesses({ defaultHarness: harness, defaultModelProvider: DEFAULT_MODEL_PROVIDER, harnessDefaults: { 'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY } } });`
6. `return harness;` (resolved value for downstream consumers — P1.M1.T2.S2).

**`src/agents/agent-factory.ts`** — exactly two additions, adjacent to the existing
top-level `configureEnvironment();`:

```ts
import { configureHarness } from '../config/harness.js';
...
configureEnvironment();
configureHarness();   // ← NEW: read env → validate → compat-check → configureHarnesses()
```

### Success Criteria

- [ ] `configureHarness()` is exported from `src/config/harness.ts`.
- [ ] Env unset → returns `'pi'`, no throw, `configureHarnesses` called with
      `defaultHarness:'pi'`, `defaultModelProvider:'zai'`, and a `harnessDefaults`
      object containing the `'claude-code'` key with `apiKey`.
- [ ] Explicit `pi` → same as above with `defaultHarness:'pi'`.
- [ ] `claude-code` (provider zai) → throws `HarnessProviderMismatchError`
      (`instanceof`, `.name === 'HarnessProviderMismatchError'`,
      `.harness === 'claude-code'`, `.provider === 'zai'`).
- [ ] Invalid value (e.g. `'bogus'`) → throws a plain `Error` whose message lists
      supported harnesses (`pi`, `claude-code`) and echoes the bad value.
- [ ] `agent-factory.ts` calls `configureHarness()` exactly once at top level,
      immediately after `configureEnvironment()`.
- [ ] `npm run validate` exits 0; `npm run test:run` exits 0 with 100% coverage on
      `src/config/harness.ts`.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to
implement this successfully?_ **Yes** — every reference below is a concrete file path,
with the exact pattern to copy and the exact symbols to consume. The single
non-obvious gotcha (Groundswell does NOT export the reset/query helpers) is
documented with a verified workaround.

### Documentation & References

```yaml
# MUST READ — the dependency contract (S1 produces the inputs S2 consumes)
- file: plan/004_439241a82c24/P1M1T1S1/PRP.md
  why: Defines the EXACT symbols S2 imports — DEFAULT_HARNESS ('pi'),
       DEFAULT_MODEL_PROVIDER ('zai'), SUPPORTED_HARNESSES (['pi','claude-code'] as const),
       PRP_AGENT_HARNESS ('PRP_AGENT_HARNESS' env-var name), AgentHarness (type),
       HarnessProviderMismatchError (class, constructor cites §9.2.4).
  critical: >
    S2 runs in PARALLEL with S1 but CONSUMES S1's outputs. Treat S1's PRP as a contract.
    Do NOT redefine these symbols — import them. If a symbol seems missing, S1 is not yet
    merged; assume it lands exactly as S1's PRP specifies.

- docfile: plan/004_439241a82c24/architecture/implementation_notes.md
  section: "1. WHERE the compatibility check must live" and "5. configureEnvironment() already runs at module load"
  why: Authoritative ordering rule (configureEnvironment → compat check → configureHarnesses)
       and the exact guard snippet to adapt. §1 confirms configureHarnesses does NOT reject
       claude-code+zai (open-set provider) — so the PRP pipeline owns the rule.

- docfile: plan/004_439241a82c24/P1M1T1S2/research/groundswell-harness-api.md
  section: "CRITICAL FINDING" and "RESOLUTION — mock configureHarnesses"
  why: >
    The work-item CONTRACT claims getGlobalHarnessConfig / resetGlobalHarnessConfig are
    importable from 'groundswell'. THIS IS FALSE (verified: both undefined at runtime;
    package exports map exposes only '.'). Tests MUST mock configureHarnesses via
    vi.mock('groundswell') instead of reset/querying the real singleton. Full proof + the
    working mock pattern are in this file.

- docfile: plan/004_439241a82c24/P1M1T1S2/research/integration-and-tests.md
  section: "100% coverage mapping" and "File-disjoint from S1"
  why: Maps the 4 test cases onto branch coverage; confirms zero file overlap with S1.

# PATTERN FILES — copy existing conventions exactly
- file: src/config/environment.ts
  why: Structural template for the new harness.ts — a top-level configure*() function
        that reads process.env with ?? defaults and performs an intentional side effect.
  pattern: "export function configureEnvironment(): void { if (process.env.X && !process.env.Y) {...} }"
  gotcha: environment.ts maps ANTHROPIC vars; harness.ts is a SEPARATE concern (harness/provider
          selection). Keep them in separate files (do NOT append harness logic to environment.ts).

- file: src/agents/agent-factory.ts
  why: The file to EDIT — locate the existing top-level `configureEnvironment();` call
        (line ~38, beneath the imports) and add `configureHarness();` directly below it.
  pattern: "// PATTERN: Configure environment at module load time (intentional side effect)"
  critical: >
    The call MUST be top-level (not inside a function) so it runs at import time, exactly
    like configureEnvironment(). Keep the existing JSDoc comment explaining the side effect
    and add a matching comment for configureHarness().

- file: tests/unit/config/environment.test.ts
  why: Test-layout template — describe/it blocks, SETUP/EXECUTE/VERIFY comments, ESM .js
        import specifiers, vi.stubEnv usage.
  pattern: "vi.stubEnv('VAR','val'); ... expect(fn).toThrow();"

- file: tests/unit/agents/prp-executor.test.ts
  why: Precedent for vi.mock at the top of a test file (it mocks agent-factory itself).
  pattern: "vi.mock('groundswell', () => ({ configureHarnesses: vi.fn(), ... }));"
```

### Current Codebase tree (relevant slice)

```bash
src/config/
├── constants.ts     # S1 owns — S2 imports DEFAULT_HARNESS, DEFAULT_MODEL_PROVIDER, SUPPORTED_HARNESSES, PRP_AGENT_HARNESS
├── environment.ts   # REFERENCE for configure*() pattern; configureEnvironment() runs at agent-factory load
├── types.ts         # S1 owns — S2 imports AgentHarness, HarnessProviderMismatchError
└── harness.ts       # ← S2 CREATES (configureHarness)
src/agents/
└── agent-factory.ts # ← S2 EDITS (+1 import, +1 top-level call adjacent to configureEnvironment())
tests/unit/config/
├── environment.test.ts  # EXISTING — test-layout reference
├── harness.test.ts      # S1 CREATES (constants/types/error) — distinct filename, no collision
└── harness-config.test.ts # ← S2 CREATES (configureHarness behavior)
```

### Desired Codebase tree with files to be added/edited

```bash
src/config/harness.ts                          # NEW — configureHarness(): AgentHarness
src/agents/agent-factory.ts                    # EDIT — +import configureHarness; +top-level call
tests/unit/config/harness-config.test.ts       # NEW — 4 contract cases, mock configureHarnesses
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — Groundswell's public surface does NOT export getGlobalHarnessConfig or
// resetGlobalHarnessConfig (both undefined at runtime; package `exports` exposes only '.').
// The work-item CONTRACT's "reset via resetGlobalHarnessConfig / query via getGlobalHarnessConfig"
// is UNUSABLE as written. Instead, MOCK configureHarnesses and assert on call args:
//     vi.mock('groundswell', () => ({ configureHarnesses: vi.fn() }));
//     ... expect(configureHarnesses).toHaveBeenCalledWith({ defaultHarness:'pi', ... });
// Verified working in this repo (see research/groundswell-harness-api.md).

// CRITICAL — configureHarnesses is imported from 'groundswell' (bare specifier), NOT a deep path.
//     import { configureHarnesses } from 'groundswell';   // ✓ (only this is exported)
// Deep imports like 'groundswell/dist/utils/harness-config.js' are BLOCKED by the exports map.

// CRITICAL — ordering is load-bearing. In agent-factory.ts the new call MUST sit directly
// beneath the existing top-level configureEnvironment();, because configureHarness() reads
// process.env.ANTHROPIC_API_KEY for the harnessDefaults binding, and configureEnvironment()
// is what maps ANTHROPIC_AUTH_TOKEN → ANTHROPIC_API_KEY. Wrong order → apiKey undefined.

// GOTCHA — the two throw sites use DIFFERENT error types on purpose:
//   * unknown harness value      → plain Error (message lists supported harnesses)
//   * claude-code + zai mismatch → HarnessProviderMismatchError (from S1)
// Do not unify them; the contract distinguishes "unknown value" from "incompatible pair".

// GOTCHA — 100% coverage is enforced (vitest.config.ts). src/config/harness.ts has 4 branches;
// the 4 contract test cases (a–d) map 1:1 onto them. The `&& DEFAULT_MODEL_PROVIDER === 'zai'`
// sub-condition's TRUE side is case (c); FALSE side is cases (a)/(b).

// GOTCHA — prettier is an ERROR (eslint `prettier/prettier: error`). Run `npm run fix`
// (lint:fix + format) before `npm run validate`. Do NOT use `any` in src/ (it's `warn`,
// but prefer the validated `AgentHarness` cast after the includes() check).

// CRITICAL — DEFAULT_MODEL_PROVIDER is the 'zai' constant (S1); it is NOT read from env in S2.
// Therefore claude-code ALWAYS throws here (correct per PRD §9.4.1). Keep the explicit
// `&& DEFAULT_MODEL_PROVIDER === 'zai'` comparison for self-documentation + forward-compat.
```

---

## Implementation Blueprint

### Data models and structure

No new data models — S2 consumes S1's types/constants. The only "model" is the
`configureHarness()` function signature and the `GlobalHarnessConfig` object it
builds (Groundswell-owned type, shape verified):

```ts
// Groundswell's GlobalHarnessConfig (types/harnesses.d.ts) — for reference only:
//   { defaultHarness: HarnessId; defaultModelProvider?: ModelProviderId;
//     harnessDefaults?: Partial<Record<HarnessId, HarnessOptions>>; }
```

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)

```yaml
Task 1: CREATE tests/unit/config/harness-config.test.ts   (RED — must fail before impl)
  - IMPORT: configureHarness from '../../../src/config/harness.js';
            HarnessProviderMismatchError, type AgentHarness from '../../../src/config/types.js';
            SUPPORTED_HARNESSES, DEFAULT_HARNESS, DEFAULT_MODEL_PROVIDER from '../../../src/config/constants.js'.
  - MOCK: vi.mock('groundswell', () => ({ configureHarnesses: vi.fn() }));  (hoisted to top)
          then `const { configureHarnesses } = await import('groundswell');` inside tests, OR
          import statically after the mock. Use vi.clearAllMocks() in beforeEach (global setup
          also does this) and vi.unstubAllEnvs() in afterEach (global setup also does this).
  - FOLLOW pattern: tests/unit/config/environment.test.ts (describe/it, SETUP/EXECUTE/VERIFY
    comments, ESM .js specifiers) + tests/unit/agents/prp-executor.test.ts (vi.mock precedent).
  - CASES (the 4 contract scenarios — map 1:1 to branch coverage):
      (a) PRP_AGENT_HARNESS unset (delete it) → configureHarness() returns 'pi', no throw,
          configureHarnesses called once with { defaultHarness:'pi', defaultModelProvider:'zai',
          harnessDefaults:{ 'claude-code': { apiKey: <stubbed ANTHROPIC_API_KEY> } } }.
      (b) vi.stubEnv('PRP_AGENT_HARNESS','pi') → returns 'pi', no throw,
          configureHarnesses.toHaveBeenCalledWith({ defaultHarness:'pi', ... }).
      (c) vi.stubEnv('PRP_AGENT_HARNESS','claude-code') → expect(() => configureHarness())
          .toThrow(HarnessProviderMismatchError); assert .name, .harness==='claude-code',
          .provider==='zai', and message contains '§9.2.4'. Assert configureHarnesses was
          NOT called (vi.mocked(configureHarnesses).not.toHaveBeenCalled()).
      (d) vi.stubEnv('PRP_AGENT_HARNESS','bogus') → expect(...).toThrow(Error);
          assert error.message contains 'bogus' AND lists both 'pi' and 'claude-code'.
          Assert configureHarnesses NOT called.
  - NAMING: describe('config/harness'); it('should ...') per case.
  - PLACEMENT: tests/unit/config/harness-config.test.ts  (distinct from S1's harness.test.ts).
  - EXPECTED NOW: import of '../../../src/config/harness.js' fails → RED.

Task 2: CREATE src/config/harness.ts   (GREEN — the function)
  - IMPORT: configureHarnesses from 'groundswell';
            DEFAULT_HARNESS, DEFAULT_MODEL_PROVIDER, SUPPORTED_HARNESSES, PRP_AGENT_HARNESS
              from './constants.js';
            type AgentHarness, HarnessProviderMismatchError from './types.js'.
    (NOTE: PRP_AGENT_HARNESS is imported for readability; the env read is
     process.env[PRP_AGENT_HARNESS] — equivalent to process.env.PRP_AGENT_HARNESS.)
  - IMPLEMENT: export function configureHarness(): AgentHarness with the 6-step logic in
    "Technical requirements" above.
  - NAMING: configureHarness (camelCase, mirrors configureEnvironment).
  - FOLLOW pattern: src/config/environment.ts (single configure*() function, JSDoc @remarks +
    @example, intentional side effect noted).
  - GOTCHA: validate with SUPPORTED_HARNESSES.includes() BEFORE the `as AgentHarness` cast.
  - GOTCHA: two distinct throw sites — plain Error for unknown value,
    HarnessProviderMismatchError for the claude-code+zai pair.
  - PLACEMENT: src/config/harness.ts (NEW file).
  - EXPECTED: harness-config.test.ts cases (a)–(d) turn GREEN; 100% coverage of harness.ts.

Task 3: EDIT src/agents/agent-factory.ts   (GREEN — wire the startup call)
  - ADD import: `import { configureHarness } from '../config/harness.js';`  (near the existing
    '../config/environment.js' import).
  - ADD call: a single top-level `configureHarness();` line directly beneath the existing
    `configureEnvironment();` (around line 38, inside the "// PATTERN: Configure environment
    at module load time" block). Add a matching comment noting the side effect + ordering.
  - DO NOT: touch createBaseConfig, the persona functions, MCP_TOOLS, or any other line.
  - EXPECTED: agent-factory.test.ts stays GREEN (PRP_AGENT_HARNESS unset at load → 'pi' → no throw).

Task 4: FORMAT + VERIFY
  - RUN: `npm run fix` (lint:fix + prettier --write) then `npm run validate` then
    `npm run test:run -- config` then `npm run test:run` (full suite regression).
  - EXPECTED: all green, zero lint/type/format errors, 100% coverage on src/config/harness.ts,
    no regression in agent-factory.test.ts or any other suite.
```

### Implementation Patterns & Key Details

```ts
// ---- src/config/harness.ts (NEW) ----

import { configureHarnesses } from 'groundswell';
import {
  DEFAULT_HARNESS,
  DEFAULT_MODEL_PROVIDER,
  PRP_AGENT_HARNESS,
  SUPPORTED_HARNESSES,
} from './constants.js';
import type { AgentHarness } from './types.js';
import { HarnessProviderMismatchError } from './types.js';

/**
 * Configure the global agent harness at startup (PRD §9.4.2 / §9.5).
 *
 * @remarks
 * Reads `PRP_AGENT_HARNESS` (default `'pi'`), validates it against
 * `SUPPORTED_HARNESSES`, enforces harness↔provider compatibility (PRD §9.2.4 /
 * §9.4.3 — `claude-code` is Anthropic-only and rejects the default `zai`
 * provider), then delegates to Groundswell `configureHarnesses()`.
 *
 * Intentional side effect: populates the global harness singleton. Must run
 * AFTER `configureEnvironment()` (which maps ANTHROPIC_AUTH_TOKEN → API_KEY) so
 * the `harnessDefaults` apiKey binding is populated.
 *
 * @returns The resolved, validated harness id (for downstream consumption).
 * @throws {Error} If `PRP_AGENT_HARNESS` is not a supported harness id.
 * @throws {HarnessProviderMismatchError} If `claude-code` is selected with the
 *   default `zai` provider.
 */
export function configureHarness(): AgentHarness {
  const raw = process.env[PRP_AGENT_HARNESS] ?? DEFAULT_HARNESS;

  if (!(SUPPORTED_HARNESSES as readonly string[]).includes(raw)) {
    throw new Error(
      `Unsupported PRP_AGENT_HARNESS value: "${raw}". ` +
        `Supported harnesses: ${SUPPORTED_HARNESSES.join(', ')}.`
    );
  }

  const harness = raw as AgentHarness;

  if (harness === 'claude-code' && DEFAULT_MODEL_PROVIDER === 'zai') {
    throw new HarnessProviderMismatchError(harness, DEFAULT_MODEL_PROVIDER);
  }

  configureHarnesses({
    defaultHarness: harness,
    defaultModelProvider: DEFAULT_MODEL_PROVIDER,
    harnessDefaults: {
      'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY },
    },
  });

  return harness;
}

// ---- src/agents/agent-factory.ts (EDIT — two additions) ----
// 1) near existing import:
//      import { configureHarness } from '../config/harness.js';
// 2) directly beneath the existing top-level `configureEnvironment();`:
//      configureHarness();
//        // PATTERN: Configure harness at module load (intentional side effect).
//        // MUST run after configureEnvironment() so ANTHROPIC_API_KEY is mapped.

// ---- tests/unit/config/harness-config.test.ts (NEW — key assertions) ----
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// CRITICAL: mock configureHarnesses (Groundswell does NOT export the reset/query helpers)
vi.mock('groundswell', () => ({
  configureHarnesses: vi.fn(),
}));

import { configureHarness } from '../../../src/config/harness.js';
import { configureHarnesses } from 'groundswell';
import { HarnessProviderMismatchError } from '../../../src/config/types.js';
import {
  DEFAULT_MODEL_PROVIDER,
  SUPPORTED_HARNESSES,
} from '../../../src/config/constants.js';

describe('config/harness', () => {
  beforeEach(() => {
    vi.clearAllMocks(); // global setup also clears; belt-and-suspenders
    delete process.env.PRP_AGENT_HARNESS;
    vi.stubEnv('ANTHROPIC_API_KEY', 'stubbed-key');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('(a) defaults to pi when PRP_AGENT_HARNESS unset', () => {
    delete process.env.PRP_AGENT_HARNESS;
    const h = configureHarness();
    expect(h).toBe('pi');
    expect(configureHarnesses).toHaveBeenCalledWith({
      defaultHarness: 'pi',
      defaultModelProvider: DEFAULT_MODEL_PROVIDER,
      harnessDefaults: { 'claude-code': { apiKey: 'stubbed-key' } },
    });
  });

  it('(b) explicit pi + zai succeeds', () => {
    vi.stubEnv('PRP_AGENT_HARNESS', 'pi');
    expect(configureHarness()).toBe('pi');
    expect(configureHarnesses).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultHarness: 'pi',
        defaultModelProvider: 'zai',
      })
    );
  });

  it('(c) claude-code + zai throws HarnessProviderMismatchError and does NOT call configureHarnesses', () => {
    vi.stubEnv('PRP_AGENT_HARNESS', 'claude-code');
    expect(() => configureHarness()).toThrow(HarnessProviderMismatchError);
    const err = (() => {
      try {
        configureHarness();
      } catch (e) {
        return e as HarnessProviderMismatchError;
      }
    })();
    expect(err.name).toBe('HarnessProviderMismatchError');
    expect(err.harness).toBe('claude-code');
    expect(err.provider).toBe('zai');
    expect(err.message).toContain('§9.2.4');
    expect(configureHarnesses).not.toHaveBeenCalled();
  });

  it('(d) invalid value throws a supported-harnesses message', () => {
    vi.stubEnv('PRP_AGENT_HARNESS', 'bogus');
    expect(() => configureHarness()).toThrow(Error);
    expect(() => configureHarness()).toThrow(/bogus/);
    expect(() => configureHarness()).toThrow(/pi.*claude-code|claude-code.*pi/);
    expect(configureHarnesses).not.toHaveBeenCalled();
  });
});
```

### Integration Points

```yaml
AGENT-FACTORY STARTUP (src/agents/agent-factory.ts):
  - location: top-level, directly beneath existing `configureEnvironment();` (~line 38)
  - add: "import { configureHarness } from '../config/harness.js';"
  - add: "configureHarness();"
  - ordering rationale: configureEnvironment maps AUTH_TOKEN→API_KEY; configureHarness reads
        ANTHROPIC_API_KEY for harnessDefaults. Order is load-bearing.

CONSUMERS (downstream — DO NOT EDIT in this subtask):
  - P1.M1.T2.S2: src/agents/agent-factory.ts AgentConfig gains a `harness: AgentHarness` field,
        populated from the value configureHarness() resolves / the global singleton configureHarnesses() sets.
  - P2/M2 docs/tests reference configureHarness() and SUPPORTED_HARNESSES.

GROUNDWELL SINGLETON (read-only from this project's perspective):
  - configureHarnesses() stores into a module-private singleton inside Groundswell
        (NOT queryable from 'groundswell' — see Known Gotchas). The cascade is consumed
        internally by Groundswell's Agent.initialize() at agent creation time. No direct
        getGlobalHarnessConfig() call is possible or needed from this project.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After writing each file — auto-fix first, then verify.
npm run fix                  # = lint:fix + prettier --write
npm run validate             # = lint && format:check && typecheck   (MUST be green)

# Targeted checks (optional, faster feedback):
npx eslint src/config/harness.ts src/agents/agent-factory.ts tests/unit/config/harness-config.test.ts
npx tsc --noEmit -p tsconfig.build.json
npx prettier --check src/config/harness.ts src/agents/agent-factory.ts tests/unit/config/harness-config.test.ts

# Expected: Zero errors. Most likely failure: prettier nit (re-run `npm run fix`) or a
# type error from importing a symbol S1 hasn't merged yet (confirm against S1's PRP table).
```

### Level 2: Unit Tests (Component Validation)

```bash
# The new suite (must pass and cover 100% of src/config/harness.ts):
npm run test:run -- config

# Equivalent explicit paths:
npx vitest run tests/unit/config/harness-config.test.ts
npx vitest run tests/unit/config/harness.test.ts   # S1's suite — must still pass (no regression)

# Full unit suite regression check (MUST stay green — proves agent-factory.test.ts etc. unbroken):
npm run test:run

# Coverage report for the new file (vitest.config.ts enforces 100% thresholds):
npx vitest run tests/unit/config/harness-config.test.ts --coverage

# Expected: all pass. If coverage < 100% on src/config/harness.ts, one of the 4 branches
# (a–d) is unexercised — ensure each contract case is a separate it() block.
```

### Level 3: Integration Testing (System Validation)

```bash
# Verify the startup wiring fires on real import (uses the REAL configureHarnesses,
# PRP_AGENT_HARNESS unset → 'pi' → no throw). This proves the agent-factory.ts edit
# didn't break module load:
npx vitest run tests/unit/agents/agent-factory.test.ts

# Build emits dist/ cleanly (proves the new import compiles + resolves under tsc):
npx tsc -p tsconfig.build.json

# Expected: agent-factory.test.ts fully green; build succeeds with no errors.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No MCP/DB/HTTP in this subtask. Domain-specific reasoning (record in commit message):
#   1. configureHarnesses receives harnessDefaults with the 'claude-code' key even when
#      harness==='pi' — intentional, matches PRD §9.4.2 verbatim; Groundswell validates
#      keys are valid HarnessIds (both 'pi' and 'claude-code' pass).
#   2. The compat guard compares against DEFAULT_MODEL_PROVIDER ('zai' constant), so
#      claude-code ALWAYS throws in S2 — correct per PRD §9.4.1 (Anthropic-only harness
#      incompatible with z.ai provider). Provider-env-configurability is out of scope.
#   3. Ordering invariant: deleting/reordering the configureHarness() line below
#      configureEnvironment() would leave harnessDefaults.apiKey undefined — verified
#      by case (a) asserting apiKey === 'stubbed-key' (mapped from the stubbed env).
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` exits 0 (lint + format:check + typecheck).
- [ ] `npm run test:run -- config` exits 0 (both S1's harness.test.ts and S2's harness-config.test.ts).
- [ ] `npm run test:run` (full suite) exits 0 — no regression (esp. `agent-factory.test.ts`).
- [ ] Coverage on `src/config/harness.ts` is 100% (statements/branches/functions/lines).
- [ ] `npx tsc -p tsconfig.build.json` compiles with no errors.

### Feature Validation

- [ ] Env unset → `configureHarness()` returns `'pi'`, `configureHarnesses` called once
      with `{ defaultHarness:'pi', defaultModelProvider:'zai', harnessDefaults:{ 'claude-code': { apiKey } } }`.
- [ ] Explicit `pi` → returns `'pi'`, `configureHarnesses` called with `defaultHarness:'pi'`.
- [ ] `claude-code` → throws `HarnessProviderMismatchError` (`.name`, `.harness`, `.provider`,
      message cites §9.2.4); `configureHarnesses` NOT called.
- [ ] Invalid value → throws `Error` listing supported harnesses; `configureHarnesses` NOT called.
- [ ] `agent-factory.ts` calls `configureHarness()` at top level, immediately after `configureEnvironment()`.

### Code Quality Validation

- [ ] `configureHarness()` lives in its own file `src/config/harness.ts` (single responsibility).
- [ ] Follows `configureEnvironment()` structural pattern (JSDoc @remarks + @example, side-effect note).
- [ ] `configureHarnesses` imported from `'groundswell'` (NOT a deep path).
- [ ] No use of `getGlobalHarnessConfig` / `resetGlobalHarnessConfig` (unexported — see Gotchas).
- [ ] Tests use `vi.mock('groundswell', ...)` to assert call args (no singleton query/reset).
- [ ] No `any` in `src/` (cast to `AgentHarness` only AFTER `SUPPORTED_HARNESSES.includes()` validation).

### Documentation & Deployment

- [ ] JSDoc on `configureHarness()` with @remarks (ordering requirement) + @throws + @returns.
- [ ] Inline comment in `agent-factory.ts` explaining the ordering invariant.
- [ ] No new env vars introduced (reads existing `PRP_AGENT_HARNESS`, `ANTHROPIC_API_KEY`).

---

## Anti-Patterns to Avoid

- ❌ Don't import `getGlobalHarnessConfig` / `resetGlobalHarnessConfig` from `'groundswell'` —
  they are NOT exported (verified `undefined`); the contract's reset/query approach is broken.
  Mock `configureHarnesses` instead.
- ❌ Don't import Groundswell internals via deep paths (`'groundswell/dist/...'`) — blocked by
  the package `exports` map, and the helpers are `@internal`.
- ❌ Don't put the `configureHarness()` call anywhere except directly beneath the existing
  top-level `configureEnvironment();` — ordering is load-bearing (API_KEY mapping).
- ❌ Don't unify the two throw sites — unknown-value (plain `Error`) vs incompatible-pair
  (`HarnessProviderMismatchError`) are deliberately distinct per the contract.
- ❌ Don't cast `raw as AgentHarness` BEFORE validating with `SUPPORTED_HARNESSES.includes()` —
  that would let an unknown value reach the compat check unsoundly.
- ❌ Don't read the model provider from env in S2 — compare against the `DEFAULT_MODEL_PROVIDER`
  constant only (provider env-configurability is a later milestone; out of scope).
- ❌ Don't edit `src/config/constants.ts`, `src/config/types.ts`, or `tests/unit/config/harness.test.ts`
  — those are S1's files (parallel execution; consume, don't modify).
- ❌ Don't append harness logic to `environment.ts` — keep concerns separate (new `harness.ts`).
- ❌ Don't qualify model strings or add a `harness` field to `AgentConfig` — those are M1.T2.
- ❌ Don't skip the failing-test-first (RED) step — the project mandates implicit TDD.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: The change is small and self-contained (one new ~25-line function, a two-line
agent-factory edit, one new test file). The inputs (S1's symbols) are exactly specified in
S1's PRP; the Groundswell `configureHarnesses` signature and `GlobalHarnessConfig` shape are
verified against the built `dist/`; the validation commands (`npm run validate`,
`npm run test:run -- config`) are verified executable in this repo. The ONE non-obvious trap
— Groundswell not exporting the reset/query helpers, which invalidates the contract's literal
testing recipe — is fully documented with an empirically verified workaround
(`vi.mock('groundswell')`). Residual risk: a prettier formatting nit (auto-fixed via
`npm run fix`) or a 100%-coverage miss on one branch (trivially closed by keeping the 4 cases
as distinct `it()` blocks — already specified).
