name: "P1.M1.T2.S1 — Lazy-ify RESOLVED_HARNESS in agent-factory.ts (remove module-eval configureHarness() side effect)"
description: |

---

## Goal

**Feature Goal**: Eliminate the two module-evaluation side effects at the top of
`src/agents/agent-factory.ts` (`configureEnvironment();` and `const RESOLVED_HARNESS =
configureHarness();`) by converting the resolved harness into a **memoized lazy accessor**
(`resolvedHarness()`), mirroring the REQ-L2 logger pattern already used in that same file.
Importing `index.ts` (and thus `agent-factory.ts`, which sits in its static import graph) must no
longer call `configureHarness()` at module load — so a `claude-code`+`zai` mismatch no longer
crashes the process with an uncaught stack trace *before* `main()` runs.

**Deliverable**: A single edited source file — `src/agents/agent-factory.ts` — with (a) the two
module-eval side effects removed, (b) a `let _resolvedHarness` / `const resolvedHarness` lazy
accessor that calls `configureEnvironment()` then `configureHarness()` on first invocation, (c)
`createBaseConfig()` reading `harness: resolvedHarness()`, and (d) the stale `@remarks` JSDoc and
inline "module load time" comment updated to state the harness is resolved **lazily**. No new
files, no test changes, no changes to any other source file. (The explicit `main()` call +
`main().catch()` extension that turns the mismatch into a clean one-liner are **P1.M1.T2.S2**;
the subprocess acceptance test is **P1.M1.T2.S3**.)

**Success Definition**:
- `npx tsc --noEmit -p tsconfig.build.json` → **0 errors** (baseline is 0; must stay 0).
- `npm run test:run -- agents/agent-factory` → **23/23 pass** (incl. the 5 persona-creation tests
  that depend on `PiHarness` being registered — see "Why the 5 tests stay green").
- `rg -n "configureHarness\(\)|configureEnvironment\(\)" src/agents/agent-factory.ts` shows these
  calls ONLY inside the `resolvedHarness()` accessor body — NEVER at module top-level.
- `rg -n "RESOLVED_HARNESS" src/` → **0 hits** (the old const is gone; `resolvedHarness()` replaces it).
- No new module-top-level side effects introduced (accessor is `let`+`const`, not a bare call).

## User Persona (if applicable)

**Target User**: CLI user who sets `PRP_AGENT_HARNESS=claude-code` (or any harness config) —
especially fat-fingered / invalid configs — and any user invoking pure-local modes
(`--help`, `--version`, `--dry-run`, `--validate-prd`).

**Use Case**: A user runs `hack --help` or `hack --prd PRD.md --dry-run` with a
`claude-code`+`zai` mismatch configured. Today this crashes at module load with a raw Node stack
trace. After S1, these modes never invoke `configureHarness()` at all → no crash.

**User Journey**:
1. User exports `PRP_AGENT_HARNESS=claude-code` while keeping default `zai` models.
2. Runs any `hack` command. Node evaluates `dist/index.js`'s static import graph.
3. **Before S1**: `agent-factory.ts` module-eval calls `configureHarness()` → throws
   `HarnessProviderMismatchError` before `main()` → uncaught raw stack trace.
4. **After S1**: module load runs NO side effect; `main()` runs; for local-only modes the harness
   is never resolved; for agent paths it is resolved lazily and (after S2) rendered cleanly.

**Pain Points Addressed**: Module-load crashes that bypass the friendly `main().catch()` error path
and present an intimidating `Node.js v26.2.0` stack banner instead of an actionable message
(PRD bugfix §h3.3 / Issue 2; PRD §9.4.3 "surfaced at initialize()/execute(), not module load").

## Why

- **PRD §9.6.2 REQ-L2 conformance**: the lazy-accessor pattern is mandated for module-level
  singletons that have side effects. `RESOLVED_HARNESS` is exactly such a singleton (it runs
  `configureHarness()`, which registers a `PiHarness` and throws on mismatch). The file already
  applies this pattern to its `_logger` — S1 extends it to the resolved harness.
- **PRD bugfix §h3.3 (Issue 2, Preferred option)**: "move `configureHarness()` out of
  module-eval scope in `agent-factory.ts` (make it lazy, mirroring the REQ-L2 logger pattern)".
  S1 is the first half of that fix; S2 supplies the explicit `main()` call + clean catch.
- **PRD §9.4.3**: the harness/provider mismatch should surface at `initialize()`/`execute()`, not
  at module load. Surfacing it at module load is itself a deviation from the PRD's stated location.
- **Unblocks local-only modes**: `--help`/`--version`/`--dry-run`/`--validate-prd` make zero API
  calls and need no harness resolution; S1 ensures they never trigger it.

## What

A surgical edit to **one** source file (`src/agents/agent-factory.ts`). Four coordinated changes:

### Change A — remove the two module-eval side effects (lines ~45-53)

Delete the block:
```ts
// PATTERN: Configure environment at module load time (intentional side effect)
// CRITICAL: This must execute before any agent creation
configureEnvironment();
/**
 * Resolved agent harness — captured once at startup from configureHarness()
 * (PRD §9.4.2 cascade: global default unless overridden). configureHarness() also
 * populates Groundswell's global singleton via configureHarnesses().
 */
const RESOLVED_HARNESS: AgentHarness = configureHarness();
```

### Change B — add the memoized lazy accessor (in the same region, before the existing `_logger` block)

```ts
// PATTERN: Lazy-accessor singleton (PRD §9.6.2 REQ-L2) — mirrors the _logger pattern below.
// configureHarness() is deferred out of module-eval scope so importing this module (and thus
// index.ts's static import graph) no longer throws HarnessProviderMismatchError at load time
// (bugfix §h3.3 / PRD §9.4.3: mismatch surfaces at first agent creation, not module load).
// configureEnvironment() MUST run before configureHarness() (env.ts: "Must be called before
// configureHarness()"); both are idempotent — HarnessRegistry.has('pi') guards double-registration
// and configureHarnesses() is a config-singleton setter — so repeat accessor calls are a no-op.
let _resolvedHarness: AgentHarness | undefined;
const resolvedHarness = (): AgentHarness => {
  if (_resolvedHarness === undefined) {
    configureEnvironment();
    _resolvedHarness = configureHarness();
  }
  return _resolvedHarness;
};
```

### Change C — update `createBaseConfig()` to read the accessor (line ~179)

```ts
// BEFORE:
    harness: RESOLVED_HARNESS,
// AFTER:
    harness: resolvedHarness(),
```

### Change D — update the stale doc claims (rides WITH the code change, Mode A)

- Top-of-file `@remarks` JSDoc: the line "Environment configuration is performed at module load
  time to ensure ANTHROPIC_AUTH_TOKEN is mapped to ANTHROPIC_API_KEY before any agents are created."
  → reword to state the harness/env are resolved **lazily** via an accessor on first agent creation
  (not at module load), citing bugfix PRD §h3.3 and PRD §9.6.2 REQ-L2.

### Constraints (DO/DON'T)

- **DO** keep the `configureEnvironment` and `configureHarness` imports (they are now called inside
  the accessor, not at top-level). Do NOT remove them.
- **DO** preserve the existing `_logger`/`logger()` accessor block unchanged (it is the pattern
  being mirrored, and is unrelated to this change).
- **DO** call `configureEnvironment()` BEFORE `configureHarness()` inside the accessor (ordering is
  load-bearing — see "Why ordering matters").
- **DON'T** add an explicit `configureHarness()` call to `main()` in `src/index.ts` → that's S2.
- **DON'T** extend `main().catch()` for `HarnessProviderMismatchError` → that's S2.
- **DON'T** touch any test file, `index.ts`, `harness.ts`, `types.ts`, `environment.ts`, or any
  other source file. S1's footprint is `src/agents/agent-factory.ts` ONLY.
- **DON'T** export `resolvedHarness` or `_resolvedHarness` (the old `RESOLVED_HARNESS` was
  module-local, not exported — keep the symbol surface unchanged).
- **DON'T** introduce any other module-top-level side effect (the accessor pair `let`+`const` is a
  declaration, not a call — that satisfies REQ-L2).

### Why the 5 persona-creation tests stay green (critical invariant)

The factory functions (`createArchitectAgent`, etc.) call `createBaseConfig(persona)` FIRST, then
spread it into the config passed to `createAgent(config)`. Inside `createBaseConfig`, the returned
object literal evaluates `harness: resolvedHarness()` — which lazily runs `configureHarness()` →
registers `PiHarness` via `HarnessRegistry` — BEFORE the object is returned and BEFORE
`createAgent(config)` runs. So registration completes in time. Lazy deferral moves the FIRST
occurrence from module-load to first-`createBaseConfig`-call but does NOT change within-call
ordering. (Confirmed: baseline `agents/agent-factory` → 23/23; the 5 creation tests use the real
sibling groundswell via the vitest alias, where `configureHarness()` registers a real `PiHarness`.)

### Success Criteria

- [ ] `src/agents/agent-factory.ts` has NO module-top-level `configureHarness()`/`configureEnvironment()` calls.
- [ ] A `resolvedHarness()` lazy accessor (mirroring `_logger`/`logger()`) is present; it calls
      `configureEnvironment()` then `configureHarness()` on first invocation and caches.
- [ ] `createBaseConfig()` reads `harness: resolvedHarness()`.
- [ ] `rg -n "RESOLVED_HARNESS" src/` → 0 hits.
- [ ] `npx tsc --noEmit -p tsconfig.build.json` → 0 errors.
- [ ] `npm run test:run -- agents/agent-factory` → 23/23 pass.

## All Needed Context

### Context Completeness Check

_Pass._ A developer who has never seen this repo can implement this from the three file references
below + the exact before/after blocks. The change is four coordinated edits to one source file;
the failure modes (broken ordering, removed import, uncovered memoization branch, touching S2's
scope) are enumerated below with the reason each is avoided.

### Documentation & References

```yaml
# MUST READ - Include these in your context window

- file: src/agents/agent-factory.ts
  why: TARGET FILE. Lines 45-53 are the module-eval side effects to remove; lines 56-57 are the
        REQ-L2 _logger pattern to mirror; line 179 (harness: RESOLVED_HARNESS) is the read site.
  pattern: |
    # The mirror target (lines 56-57) — copy this shape for the harness:
    let _logger: Logger | undefined;
    const logger = (): Logger => (_logger ??= getLogger('AgentFactory'));
    # The new accessor (replaces lines 45-53):
    let _resolvedHarness: AgentHarness | undefined;
    const resolvedHarness = (): AgentHarness => {
      if (_resolvedHarness === undefined) {
        configureEnvironment();
        _resolvedHarness = configureHarness();
      }
      return _resolvedHarness;
    };
  gotcha: |
    createBaseConfig's returned object literal evaluates `harness: resolvedHarness()` — this runs
    configureHarness() (registers PiHarness) BEFORE the object is returned and BEFORE createAgent()
    runs in the factory functions. Do NOT move the resolvedHarness() call to AFTER createAgent or
    into a separate deferred promise — the within-call ordering is load-bearing for the 5 tests.

- file: src/config/harness.ts
  why: Confirms configureHarness() is idempotent (Step 4.5: `if (!registry.has('pi')) registry.register(...)`)
        and that it MUST run AFTER configureEnvironment() (JSDoc line 105). Also the source of the
        HarnessProviderMismatchError thrown on claude-code+zai (the throw being deferred is the fix).
  pattern: |
    export function configureHarness(): AgentHarness { ... }   // throws on mismatch; idempotent via has() guard
  critical: |
    Do NOT modify harness.ts — its logic is correct and out of scope (architecture §5). S1 only
    changes WHERE configureHarness() is invoked (module-load → lazy), not WHAT it does.

- file: src/config/environment.ts
  why: Confirms configureEnvironment() is idempotent (maps AUTH_TOKEN→API_KEY only if unset; sets
        BASE_URL only if unset) and the ordering rule "Must be called before configureHarness()"
        (line 63). Justifies calling configureEnvironment() first inside the accessor.
  gotcha: |
    configureEnvironment() is also called in main() (src/index.ts line 119). Calling it again
    inside the accessor is safe (idempotent). The accessor exists so that agent-factory.ts works
    even when imported by a path that did NOT go through main() (e.g. unit tests, workflows).

- docfile: plan/007_8783a1f5e14a/bugfix/002_edc62322bc90/architecture/system_context.md
  section: §3 (Issue 2 root cause + fix) and §4 (sequencing between Issue 1 and Issue 2)
  why: Authoritative root cause + the exact lazy-accessor recipe (the code blocks in this PRP are
        quoted from §3). §4 documents that S1 must land BEFORE S2 (the main() explicit call) and
        that S1 is safe in isolation. §6 documents the coverage reality (index.ts is subprocess-
        only; agent-factory.ts is in-process — ensure memoization branch covered).
  critical: |
    §3 "Idempotency note" + §4 establish the contract: S1 = lazy-ify ONLY; S2 = main() call +
    catch extension; S3 = subprocess test. Do NOT do S2/S3 work here — they will conflict and
    break the task sequencing.

- docfile: plan/007_8783a1f5e14a/bugfix/002_edc62322bc90/architecture/test-conventions.md
  section: §3 (module isolation) and §6 (existing assertions)
  why: Confirms tests/unit/agents/agent-factory.test.ts does NOT mock groundswell and does NOT use
        vi.resetModules() — so module state is shared across tests, which is WHY the memoization's
        two branches (undefined→init, cached→noop) are both covered in-process by the existing
        suite. No new test is required for S1.

- docfile: PRD.md  (hacky-hack)
  section: §9.6.2 (REQ-L2 lazy-accessor pattern) and §9.4.3 (mismatch surfaced at initialize/execute)
  why: The PRD basis for the lazy pattern and the "not at module load" requirement. Cite both in
        the updated @remarks JSDoc (Change D).
```

### Current Codebase tree (relevant slice)

```bash
src/
├── index.ts                 # main() — already reordered by P1.M1.T1.S1 (NO configureHarness call yet; that's S2)
├── agents/
│   └── agent-factory.ts     # ← TARGET FILE (4 edits; footprint = this file ONLY)
└── config/
    ├── harness.ts           # configureHarness() — idempotent, UNCHANGED
    ├── environment.ts       # configureEnvironment() — idempotent, UNCHANGED
    └── types.ts             # AgentHarness / HarnessProviderMismatchError — UNCHANGED
tests/unit/agents/
└── agent-factory.test.ts    # REGRESSION GATE — 23 tests, MUST stay green (no change needed)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# No new files. One existing file modified in place:
src/agents/agent-factory.ts   # -2 module-eval side effects, +1 lazy accessor, 1 read-site update, JSDoc refresh
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: call configureEnvironment() BEFORE configureHarness() inside the accessor.
//   environment.ts: "Must be called before configureHarness() and ensureHarnessInitialized()."
//   harness.ts JSDoc: configureHarness "AFTER configureEnvironment() (which maps AUTH_TOKEN→API_KEY)".
//   Reversing the order would leave ANTHROPIC_API_KEY unmapped when configureHarness builds harnessDefaults.
//
// CRITICAL: keep configureEnvironment + configureHarness IMPORTED (do not delete the imports).
//   They move from module-top-level call sites to accessor-body call sites — the imports stay.
//
// CRITICAL: do NOT export resolvedHarness / _resolvedHarness. RESOLVED_HARNESS was module-local;
//   exporting it would widen the symbol surface and is out of scope.
//
// GOTCHA (within-call ordering): the factory fns are `const baseConfig = createBaseConfig(p);
//   const config = {...baseConfig, ...}; return createAgent(config);`. createBaseConfig evaluates
//   `harness: resolvedHarness()` in its returned literal, so configureHarness() (PiHarness
//   registration) finishes BEFORE createAgent(config) runs. Do NOT refactor createBaseConfig to
//   defer resolvedHarness() — that would break the 5 agent-creation tests.
//
// GOTCHA (coverage): the vitest 100% branch gate applies to agent-factory.ts in-process. The new
//   accessor's two branches (undefined→init / cached→noop) are BOTH exercised by the existing
//   agent-factory.test.ts (first createBaseConfig → init; subsequent calls → cached), because that
//   file shares module state (no vi.resetModules). No new test is needed for S1.
//
// GOTCHA (the "empty string fallback" test, line 148): by the time it runs, _resolvedHarness is
//   already cached (earlier it.each persona tests ran first) → configureEnvironment() is NOT
//   re-invoked → the test's deleted ANTHROPIC_API_KEY/BASE_URL stay deleted → resolveApiKeyForProvider()
//   ?? '' and process.env.ANTHROPIC_BASE_URL ?? '' both yield ''. Test still passes. Do not "fix" it.
//
// GOTCHA (sequencing): S1 must NOT add the explicit configureHarness() call to main() (index.ts)
//   nor extend main().catch(). Those are P1.M1.T2.S2. Doing them here breaks the task split and
//   will conflict with S2's edits to the same main() region. S1 is safe in isolation: local-only
//   modes never resolve the harness; agent paths defer to first createBaseConfig (caught by
//   main().catch as a generic Fatal error until S2 renders it cleanly — strictly no-worse than today).
```

## Implementation Blueprint

### Data models and structure

None. No new types, interfaces, or exported symbols. This is a control-flow refactor of one module.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/agents/agent-factory.ts — remove the two module-eval side effects
  - LOCATE: the block at lines ~45-53:
        // PATTERN: Configure environment at module load time (intentional side effect)
        // CRITICAL: This must execute before any agent creation
        configureEnvironment();
        /**
         * Resolved agent harness — captured once at startup from configureHarness() ...
         */
        const RESOLVED_HARNESS: AgentHarness = configureHarness();
  - DELETE that entire block (comment, the bare configureEnvironment() call, the JSDoc, and the
      RESOLVED_HARNESS const declaration).
  - PRESERVE: the imports of configureEnvironment (from ../config/environment.js) and
      configureHarness (from ../config/harness.js) — they stay (now used inside the accessor).
  - PRESERVE: the _logger/logger() block immediately below (lines 56-57) — it is the mirror
      target and is unrelated to this change.
  - VERIFY: `rg -n "RESOLVED_HARNESS" src/agents/agent-factory.ts` → 0 hits after this task
      (the read site is updated in Task 3).

Task 2: MODIFY src/agents/agent-factory.ts — add the memoized lazy accessor
  - PLACE: in the same region where the deleted block was (above the _logger block, near the top
      of the module after the imports and before the MCP singletons).
  - ADD (verbatim from the contract / architecture §3):
        let _resolvedHarness: AgentHarness | undefined;
        const resolvedHarness = (): AgentHarness => {
          if (_resolvedHarness === undefined) {
            configureEnvironment();
            _resolvedHarness = configureHarness();
          }
          return _resolvedHarness;
        };
  - NAMING: `_resolvedHarness` (private cache, underscore-prefixed to match `_logger`); the
      accessor `resolvedHarness` (lowerCamelCase function, matching `logger`).
  - ORDERING: configureEnvironment() MUST be the first statement inside the `if`; configureHarness()
      second. Do not reorder.
  - COMMENT: add a brief comment citing PRD §9.6.2 REQ-L2 + bugfix §h3.3 (see Change B above).
  - VERIFY: `rg -n "configureHarness\(\)|configureEnvironment\(\)" src/agents/agent-factory.ts`
      → BOTH appear ONLY inside the resolvedHarness() body, never at module top-level.

Task 3: MODIFY src/agents/agent-factory.ts — update createBaseConfig() read site
  - LOCATE: in createBaseConfig()'s returned object literal (line ~179):
        harness: RESOLVED_HARNESS,
  - REPLACE WITH:
        harness: resolvedHarness(),
  - PRESERVE: every other field of the returned object (name, system, model, enableCache,
      enableReflection, maxTokens, env). Do NOT touch the getModel/resolveApiKeyForProvider logic.

Task 4: MODIFY src/agents/agent-factory.ts — refresh stale doc claims (Mode A, rides with code)
  - LOCATE: the top-of-file @remarks JSDoc containing "Environment configuration is performed at
      module load time to ensure ANTHROPIC_AUTH_TOKEN is mapped to ANTHROPIC_API_KEY before any
      agents are created."
  - REWORD: state that the harness/env are resolved LAZILY via an accessor on first agent creation
      (not at module load), citing bugfix PRD §h3.3 and PRD §9.6.2 REQ-L2. Keep the rest of the
      @remarks (persona/token/model description) intact.
  - NOTE: the inline "PATTERN: Configure environment at module load time" comment is removed in
      Task 1 (it rode the deleted block). The new accessor comment (Task 2) replaces its intent.

Task 5: VERIFY (no code change — validation only)
  - RUN: npx tsc --noEmit -p tsconfig.build.json → 0 errors (baseline 0).
  - RUN: npm run test:run -- agents/agent-factory → 23/23 pass.
  - RUN: rg -n "RESOLVED_HARNESS" src/ → 0 hits.
  - RUN: npx prettier --check src/agents/agent-factory.ts → pass.
```

### Implementation Patterns & Key Details

```ts
// PATTERN: Lazy-accessor singleton (PRD §9.6.2 REQ-L2). Identical shape to the file's existing
// _logger/logger() pair — a private `let _x: T | undefined` + a `const x = (): T =>` accessor that
// initializes on first call and caches. This keeps the symbol module-local (not exported) and
// removes ALL module-eval side effects: importing the module no longer runs configureHarness().
let _resolvedHarness: AgentHarness | undefined;
const resolvedHarness = (): AgentHarness => {
  if (_resolvedHarness === undefined) {
    configureEnvironment();      // MUST be first (env.ts: "before configureHarness()")
    _resolvedHarness = configureHarness();  // idempotent via HarnessRegistry.has('pi') guard
  }
  return _resolvedHarness;        // cached on every subsequent call → no-op repeat
};

// PATTERN: read the accessor inside createBaseConfig's returned literal so registration completes
// before the config reaches createAgent():
export function createBaseConfig(persona: AgentPersona): AgentConfig {
  ...
  return {
    ...,
    harness: resolvedHarness(),   // ← lazy init happens here, before createAgent() in the factory fns
    ...,
  };
}
```

### Integration Points

```yaml
DATABASE:
  - none
CONFIG:
  - none (no env-var additions; reads existing PRP_AGENT_HARNESS via configureHarness)
ROUTES:
  - none
BUILD / TOOLING:
  - none (no package.json, tsconfig, or vitest.config changes)
DEPENDENCIES:
  - DEPENDS-ON (completed): P1.M1.T1.S1 — main() already reordered (logger up; dry-run/validate-prd
      early-returns before preflight+harness). S1's lazy accessor composes cleanly with that.
  - ENABLES (downstream): P1.M1.T2.S2 — insert the explicit configureHarness() call in main()
      (between the local-only early-returns and runAuthPreflight) + extend main().catch() for
      HarnessProviderMismatchError. S1 removed the module-load call; S2 adds the clean-path call.
  - ENABLES (downstream): P1.M1.T2.S3 — subprocess acceptance test (claude-code+zai → clean exit 1,
      no raw stack). Only meaningful after S2 renders the error cleanly.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After the edits — confirm no formatting regression on the changed file.
npx prettier --check src/agents/agent-factory.ts
# Expected: passes. If prettier reformats the accessor, run `--write` and re-check.

# Lint (eslint . --ext .ts — picks up src/).
npm run lint
# Expected: zero NEW errors in src/agents/agent-factory.ts.

# Typecheck — THE PRIMARY LEVEL-1 GATE (baseline is 0 errors across all of src/).
npx tsc --noEmit -p tsconfig.build.json
# Expected: 0 errors. If a new error appears (e.g. "_resolvedHarness possibly undefined" or
# "configureHarness is not a function"), STOP and re-read: the imports MUST remain; the accessor
# MUST use `if (_resolvedHarness === undefined)` (not ??=, since configureEnvironment must run too).
```

### Level 2: Unit Tests (Primary Validation — Component)

```bash
# PRIMARY GATE — the 23-test regression suite for the target file.
npm run test:run -- agents/agent-factory
# Expected: Test Files 1 passed | Tests 23 passed.
# Specifically these 5 MUST stay green (they depend on PiHarness registration via configureHarness):
#   - should create architect agent successfully
#   - should create researcher agent successfully
#   - should create coder agent successfully
#   - should create QA agent successfully
#   - should create multiple agents without MCP server registration conflicts
# Plus "should set harness to the resolved runtime (default pi)" (config.harness === 'pi') and
# "should use empty string fallback when env vars are not set" (see gotcha — still passes).
# IF a creation test FAILS with "Harness 'pi' is not registered": you broke within-call ordering —
#   resolvedHarness() must be evaluated in createBaseConfig's literal BEFORE createAgent runs.

# Broader config + agents regression guard (the delta-owned auth surface).
npm run test:run -- config/auth-preflight config/auth-resolution config/auth-resolver agents/agent-factory
# Expected: all pass. configureHarness() still throws on claude-code+zai in-process (only WHERE in
# the lifecycle it surfaces changes). No behavior change to the auth resolver.
```

### Level 3: Integration Testing (Cross-module — no module-load throw)

```bash
# PROOF that importing the module graph no longer throws at module load (the core fix).
# Probe A — default path: importing agent-factory (transitively index.ts) with NO env and a
# claude-code+zai mismatch must NOT throw at import time anymore.
npx tsx -e "
  process.env.PRP_AGENT_HARNESS = 'claude-code';
  delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
  // Import alone must not throw (module load runs no side effect now):
  await import('./src/agents/agent-factory.js');
  console.log('OK: module imported without throwing at load time');
"
# Expected: "OK: module imported without throwing at load time"
#   (Before S1 this printed a raw HarnessProviderMismatchError stack at import.)

# Probe B — the harness IS still resolved (and still throws on mismatch) when actually used:
npx tsx -e "
  process.env.PRP_AGENT_HARNESS = 'claude-code';
  delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
  const { createBaseConfig } = await import('./src/agents/agent-factory.js');
  try { createBaseConfig('architect'); console.log('UNEXPECTED: did not throw'); }
  catch (e) { console.log('OK threw on use:', e.constructor.name); }
"
# Expected: "OK threw on use: HarnessProviderMismatchError"
#   (Proves the mismatch is deferred to first USE, not removed — exactly the S1 contract.
#    S2 will render this as a clean one-liner via main().catch().)

# NOTE: do NOT assert a clean exit-1 subprocess here — that requires S2's main() call + catch
# extension, and is the deliverable of P1.M1.T2.S3. S1 only defers the throw out of module load.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Coverage sanity for the new accessor's two branches (in-process; architecture §6 says
# agent-factory.ts IS in-process instrumented, unlike index.ts).
npm run test:run -- agents/agent-factory  # (already run in Level 2)
# Both branches (undefined→init, cached→noop) are covered by the existing suite (first
# createBaseConfig call vs subsequent calls, shared module state). No new test needed.
# Optional: if you want explicit confirmation, run with coverage on just this file:
#   npx vitest run agents/agent-factory --coverage 2>/dev/null | grep agent-factory
# Expected: 100% branches for src/agents/agent-factory.ts. (Do NOT chase coverage on src/index.ts —
# it is subprocess-only and intentionally 0% in-process per architecture §6.)

# Static grep gates (the Definition-of-Done checks).
rg -n "RESOLVED_HARNESS" src/                                 # → 0 hits
rg -n "^(export )?(const|let) .*= (configureHarness|configureEnvironment)\(\)" src/agents/agent-factory.ts
                                                              # → 0 hits (no module-top-level side-effect call)
rg -n "configureHarness\(\)" src/agents/agent-factory.ts      # → only inside resolvedHarness() body
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1: `npx prettier --check src/agents/agent-factory.ts` passes.
- [ ] Level 1: `npm run lint` → no new errors in `src/agents/agent-factory.ts`.
- [ ] Level 1: `npx tsc --noEmit -p tsconfig.build.json` → 0 errors (baseline 0).
- [ ] Level 2: `npm run test:run -- agents/agent-factory` → 23/23 pass (incl. the 5 creation tests).
- [ ] Level 2: `npm run test:run -- config/auth-preflight config/auth-resolution config/auth-resolver agents/agent-factory` → all pass.
- [ ] Level 3: Probe A (import with claude-code+zai mismatch) does NOT throw at load; Probe B throws on first `createBaseConfig` use.
- [ ] Only `src/agents/agent-factory.ts` modified; no other src/ or test file touched.

### Feature Validation

- [ ] No module-top-level `configureHarness()`/`configureEnvironment()` calls remain in agent-factory.ts.
- [ ] `resolvedHarness()` accessor mirrors the `_logger`/`logger()` REQ-L2 shape.
- [ ] Accessor calls `configureEnvironment()` BEFORE `configureHarness()` (ordering preserved).
- [ ] `createBaseConfig()` reads `harness: resolvedHarness()`.
- [ ] `rg -n "RESOLVED_HARNESS" src/` → 0 hits.
- [ ] Top `@remarks` JSDoc updated (lazy, not module-load; cites bugfix §h3.3 + PRD §9.6.2 REQ-L2).

### Code Quality Validation

- [ ] `_resolvedHarness`/`resolvedHarness` are module-local (NOT exported — symbol surface unchanged).
- [ ] The `configureEnvironment` + `configureHarness` imports are retained (now used in the accessor).
- [ ] The `_logger`/`logger()` block is byte-unchanged (it is the mirror target, not in scope).
- [ ] No other module-top-level side effect introduced.

### Documentation & Deployment

- [ ] No env vars added (reads existing `PRP_AGENT_HARNESS`).
- [ ] Inline accessor comment + top `@remarks` reflect the lazy resolution (Mode A, done with the code).
- [ ] No README/docs/CONFIGURATION changes here (cross-cutting docs sync is P1.M1.T3).

---

## Scope Boundaries (DO NOT EXPAND)

This subtask is the **lazy-ify of `RESOLVED_HARNESS` in agent-factory.ts ONLY**. The following are
explicitly OUT OF SCOPE and owned by sibling subtasks:

- ❌ Inserting the explicit `configureHarness()` call in `main()` (src/index.ts) → **P1.M1.T2.S2**.
- ❌ Extending `main().catch()` for `HarnessProviderMismatchError` → **P1.M1.T2.S2**.
- ❌ The subprocess acceptance test (claude-code+zai → clean exit 1, no raw stack) → **P1.M1.T2.S3**.
- ❌ Modifying `src/config/harness.ts`, `environment.ts`, `types.ts`, or `src/index.ts` → out of scope.
- ❌ Any change to `tests/unit/agents/agent-factory.test.ts` or any other test file → none required.
- ❌ Cross-cutting docs (README, CLI_REFERENCE, CONFIGURATION, INSTALLATION) → **P1.M1.T3**.
- ❌ The 212 pre-existing failing tests in the wider suite → unrelated to this delta (per PRD Overview).
- ❌ Running `npm run test:coverage` as a hard gate on `src/index.ts` → it is subprocess-only and
  intentionally 0% in-process (architecture §6); the authoritative acceptance is the subprocess suite (S3).

---

## Anti-Patterns to Avoid

- ❌ Don't reorder configureEnvironment/configureHarness inside the accessor — env MUST run first.
- ❌ Don't use `_resolvedHarness ??= configureHarness()` alone — that would skip the required
  `configureEnvironment()` call (the `??=` form can only express one RHS; the explicit `if` is needed).
- ❌ Don't delete the `configureEnvironment`/`configureHarness` imports — they move into the accessor.
- ❌ Don't export `_resolvedHarness`/`resolvedHarness` — `RESOLVED_HARNESS` was module-local.
- ❌ Don't defer `resolvedHarness()` out of `createBaseConfig`'s literal (e.g. into a lazy agent field) —
  the within-call ordering (register PiHarness BEFORE createAgent) is load-bearing for the 5 tests.
- ❌ Don't add the main() call or extend main().catch here — that's S2; doing it now breaks sequencing.
- ❌ Don't "fix" the `agent-factory.test.ts` "empty string fallback" test — it still passes (see gotcha).
- ❌ Don't introduce any other module-top-level side effect — the `let`+`const` pair is a declaration.
- ❌ Don't chase in-process coverage on `src/index.ts` — it is subprocess-only by design.

---

**Confidence Score: 9.5/10** for one-pass implementation success. The change is four coordinated
surgical edits to a single file, with an exact before/after quoted from architecture §3 and a
same-file mirror target (`_logger`/`logger()`). Both regression gates are verified green at baseline
(agent-factory 23/23, typecheck 0 errors), the within-call ordering invariant that keeps the 5
creation tests green is documented and load-bearing, and the two memoization branches are covered
in-process by the existing suite. The 0.5 residual risk is purely a discipline risk: an implementer
tempted to "also do S2" (add the main() call + catch) or to refactor `createBaseConfig`'s literal
must be held to the narrow S1 scope defined above.
