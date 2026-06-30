# Research Notes — P1.M1.T2.S1 (lazy-ify RESOLVED_HARNESS in agent-factory.ts)

## Baseline measurements (verified before writing PRP)

| Gate | Command | Result |
|---|---|---|
| Target test file | `npm run test:run -- agents/agent-factory` | **23/23 pass** |
| Typecheck (full src/) | `npx tsc --noEmit -p tsconfig.build.json` | **0 errors** (clean — src/ fully typechecks) |
| `main()` explicit `configureHarness()` call | `rg configureHarness src/index.ts` | **none** (confirms S2 not yet done — correct pre-S2 state) |

→ My change (agent-factory.ts only) must keep agent-factory test at 23/23 and typecheck at 0.

## Current module-eval side effects to REMOVE (src/agents/agent-factory.ts lines 45-53)

```ts
// PATTERN: Configure environment at module load time (intentional side effect)   ← REMOVE
// CRITICAL: This must execute before any agent creation                          ← REMOVE
configureEnvironment();                                                            ← REMOVE
/**                                                                                 ← REMOVE (JSDoc)
 * Resolved agent harness — captured once at startup from configureHarness()
 * (PRD §9.4.2 cascade: global default unless overridden). configureHarness() also
 * populates Groundswell's global singleton via configureHarnesses().
 */
const RESOLVED_HARNESS: AgentHarness = configureHarness();                         ← REMOVE (→ lazy)
```

## The REQ-L2 pattern to mirror (ALREADY in this same file, lines 56-57)

```ts
let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('AgentFactory'));
```
The lazy harness accessor must use the SAME shape (`let _x: T | undefined; const x = (): T => { if (_x === undefined) {...} return _x; }`).

## The exact replacement (from contract + architecture §3)

```ts
let _resolvedHarness: AgentHarness | undefined;
const resolvedHarness = (): AgentHarness => {
  if (_resolvedHarness === undefined) {
    configureEnvironment();
    _resolvedHarness = configureHarness();
  }
  return _resolvedHarness;
};
```
And `createBaseConfig` reads `harness: resolvedHarness()` (was `harness: RESOLVED_HARNESS`, line 179).

## WHY ordering inside the accessor matters (configureEnvironment BEFORE configureHarness)

`src/config/harness.ts` JSDoc (line 105): "AFTER `configureEnvironment()` (which maps ANTHROPIC_AUTH_TOKEN → ANTHROPIC_API_KEY)". And `src/config/environment.ts` line 63: "Must be called before configureHarness() and ensureHarnessInitialized()." So the accessor MUST call configureEnvironment() first, then configureHarness(). The contract pins this order.

## WHY the 5 agent-creation tests stay green (the non-obvious invariant)

`createArchitectAgent()` etc. do:
```ts
const baseConfig = createBaseConfig('architect');   // ← calls resolvedHarness() FIRST
const config = { ...baseConfig, system: ..., mcps: MCP_TOOLS };
return createAgent(config);                          // ← needs PiHarness registered
```
Inside `createBaseConfig`, the returned object literal evaluates `harness: resolvedHarness()` — which lazily runs `configureHarness()` → registers `PiHarness` via `HarnessRegistry` — BEFORE the config object is returned and BEFORE `createAgent(config)` runs. So registration completes in time. The lazy deferral does NOT change the within-call ordering; it only moves the FIRST occurrence from module-load to first-createBaseConfig.

## WHY configureHarness() is safe to call more than once (idempotency)

Verified in `src/config/harness.ts` (Step 4.5, line 150): `if (!registry.has('pi')) { registry.register(new PiHarness()); }`. The `has()` guard prevents the "Provider 'pi' is already registered" throw on a second call. `configureHarnesses()` (Groundswell) is a config-singleton setter (idempotent). So the lazy accessor (S1) and the explicit main() call (S2) can both invoke it safely; the accessor caches so its own repeat calls are a no-op.

## Coverage: both memoization branches are ALREADY exercised in-process (no new test needed)

The vitest 100% branch gate applies to `src/agents/agent-factory.ts` (it's a normal importable module — see architecture system_context.md §6). The new accessor has one branch:
- `_resolvedHarness === undefined` → TRUE (run side effects) — hit on the FIRST `createBaseConfig()` call.
- `_resolvedHarness === undefined` → FALSE (return cached) — hit on EVERY subsequent `createBaseConfig()` call.

`tests/unit/agents/agent-factory.test.ts` calls `createBaseConfig()` many times (it.each over 4 personas × multiple tests = 20+ calls) WITHOUT `vi.resetModules()`, so module state is shared → both branches are covered. **No new in-process test is required for S1.** (S3 is the subprocess acceptance test for the clean-error path, which is S2's deliverable to enable.)

## The "empty string fallback" test (line 148) — still passes

That test deletes `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL` and asserts `config.env.*` → `''`. By the time it runs (it is NOT the first test; the `it.each` persona tests run earlier), `_resolvedHarness` is already cached → `configureEnvironment()` is NOT re-invoked → the deleted vars stay deleted → `resolveApiKeyForProvider() ?? ''` → `''` and `process.env.ANTHROPIC_BASE_URL ?? ''` → `''`. Same outcome as today. (configureEnvironment is idempotent regardless.)

## Scope discipline — what S1 does NOT do (owned by S2/S3)

- ❌ Insert explicit `configureHarness()` in `main()` (index.ts) → **P1.M1.T2.S2**.
- ❌ Extend `main().catch()` for `HarnessProviderMismatchError` → **P1.M1.T2.S2**.
- ❌ Subprocess acceptance test (claude-code+zai → clean exit 1) → **P1.M1.T2.S3**.
- ❌ Any test file change → none required (existing suite covers memoization + harness='pi').
- ❌ Touch index.ts, harness.ts, types.ts, or any other src/ file.

## S1 is SAFE IN ISOLATION (before S2 lands)

- Local-only modes (`--help`/`--version`/`--dry-run`/`--validate-prd`): after S1 these NEVER trigger `configureHarness()` at all (no module-load call; no agent created). Previously a `claude-code+zai` mismatch crashed at module load EVEN for `--help`. S1 alone fixes that half.
- Agent paths: the mismatch throw now surfaces during the first `createBaseConfig()` (deep in pipeline construction) rather than at module load. It propagates up; `main().catch()` currently renders non-AuthPreflightError errors as "Fatal error in main():" (exit 1, caught — not an uncaught module-load crash). S1 is strictly no-worse; S2 makes it a clean one-liner. This sequencing is documented in architecture §4 ("sequencing matters").
