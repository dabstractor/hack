name: "P1.M1.T2.S2 — Explicit configureHarness() call in main() + extend main().catch() for HarnessProviderMismatchError"
description: |

---

## Goal

**Feature Goal**: Complete the Issue-2 fix by (a) inserting an **explicit `configureHarness()` call**
in `src/index.ts`'s `main()`, in the gap P1.M1.T1.S1 created between the local-only early-returns
(`--dry-run` / `--validate-prd`) and `await runAuthPreflight()`; and (b) **extending the
`main().catch()` handler** to special-case `HarnessProviderMismatchError` exactly like
`AuthPreflightError` (clean `❌ <message>` + `process.exit(1)`). Together these make a
`claude-code`+`zai` mismatch surface on the agent-invoking path as a friendly one-liner
**caught by `main().catch()`** instead of crashing the process — and guarantee clean rendering even
if the throw ever occurs on another path.

**Deliverable**: A single edited source file — `src/index.ts` — with (a) one new import line
(`HarnessProviderMismatchError` from `./config/types.js`, alongside the existing `AuthPreflightError`),
(b) one new `configureHarness()` call inserted in the `main()` startup gap (after the local-only
early-returns, before `runAuthPreflight()`), (c) the `configureHarness` symbol added to the existing
`./config/harness.js` import, and (d) one new `instanceof` arm in `main().catch()`. Plus a
`@remarks` JSDoc note on `main()` (Mode A — rides with the code change). **No new files, no test
changes, no logic changes to any other source file.**

**Success Definition**:
- `npx tsc --noEmit -p tsconfig.build.json` → **0 errors** (baseline is 0; must stay 0).
- `npm run test:run -- config/auth-preflight config/auth-resolution config/auth-resolver agents/agent-factory` → **all pass** (baseline 70/70). The `configureHarness()` call is idempotent, so the pi+zai default path is unchanged.
- `npm run test:run -- agents/agent-factory` → **23/23 pass** (the explicit call + lazy accessor cache cleanly; the 5 persona-creation tests stay green).
- `rg -n "configureHarness\(\)" src/index.ts` → **1 hit**, located between the `validatePrd` early-return and `runAuthPreflight()`.
- `rg -n "HarnessProviderMismatchError" src/index.ts` → **2 hits** (the import + the `instanceof` arm in `main().catch()`).

> **EMPIRICALLY VERIFIED PRE-STATE (run before writing this PRP):**
> - `src/index.ts` already reflects P1.M1.T1.S1's reorder: `configureEnvironment()` (L119) →
>   `getLogger('App', …)` (L122) → `if (args.dryRun)` (L134) → `if (args.validatePrd)` (L148) →
>   `await runAuthPreflight()` (L195) → `await ensureHarnessInitialized()` (L200). The **GAP** for
>   the new `configureHarness()` call is between the end of the `validatePrd` block (~L193) and
>   `await runAuthPreflight()` (L195).
> - `main().catch()` (L315-321) special-cases ONLY `AuthPreflightError`; everything else falls through
>   to `console.error('\n❌ Fatal error in main():', error)`.
> - `configureHarness` is NOT yet imported in index.ts — the existing harness.js import (L39-42)
>   pulls `ensureHarnessInitialized` + `runAuthPreflight` only.
> - `HarnessProviderMismatchError` (src/config/types.ts:141) message already carries harness +
>   provider + `§9.2.4` + both remediations (switch harness to `pi` OR switch provider to
>   `anthropic/*`). **No message formatting needed** — it renders verbatim as the clean one-liner.
> - `src/agents/agent-factory.ts` already has the P1.M1.T2.S1 lazy `resolvedHarness()` accessor
>   (L53-60); `createBaseConfig` reads `harness: resolvedHarness()` (L186). So when the pipeline
>   later runs `createBaseConfig`, the accessor is a **no-op cache hit** (the explicit `main()` call
>   populated it first).
> - Baseline: typecheck = **0 errors**; `agents/agent-factory` + the three config/auth suites = **70/70 pass**.

## User Persona (if applicable)

**Target User**: CLI user who (mis)configures `PRP_AGENT_HARNESS=claude-code` while keeping default
`zai` models — a genuinely invalid combo (PRD §9.4.3) — and every user who runs any agent path,
whose startup deserves the same clean error UX as the auth preflight.

**Use Case**: A user fat-fingers `PRP_AGENT_HARNESS=claude-code` and runs `hack --prd PRD.md`.
Before S2: a raw Node stack trace + "Node.js v26.2.0" banner (the throw bypassed `main().catch()`
because it happened at module load). After S1+S2: the throw is deferred to the explicit
`configureHarness()` call inside `main()`, caught by `main().catch()`, and rendered as a single
actionable `❌ Harness 'claude-code' is incompatible …` line + exit 1.

**User Journey**:
1. User sets `PRP_AGENT_HARNESS=claude-code` + default zai models, runs an agent-invoking command.
2. `main()` runs `configureEnvironment()` → (local-only early-returns skipped) → **`configureHarness()`**
   (NEW) → throws `HarnessProviderMismatchError`.
3. `void main().catch(...)` catches it → the NEW `instanceof HarnessProviderMismatchError` arm prints
   `❌ <message>` + `process.exit(1)`. Clean, actionable, consistent with the auth preflight.
4. (Valid `pi`+`zai` config: `configureHarness()` returns `'pi'` and registers `PiHarness`;
   `ensureHarnessInitialized()` runs; pipeline proceeds. Behavior unchanged.)

**Pain Points Addressed**: PRD bugfix §h3.3 (Issue 2) — module-load crash bypassing the fail-fast
clean-error path; an intimidating stack trace instead of the friendly one-liner the rest of startup
produces. S2 is the second half of the fix (S1 deferred the throw; S2 renders it cleanly).

## Why

- **PRD §9.2.7 fail-fast UX consistency**: the auth preflight already renders as a single actionable
  `❌` line via `main().catch()`. The harness/provider mismatch is an analogous startup-time config
  error and deserves the same treatment.
- **PRD §9.4.3 location**: the mismatch should surface at startup/initialize, not at module load.
  S1 deferred it out of module-eval; S2 puts it on the `main()` startup path where it can be caught
  and rendered cleanly.
- **PRD bugfix §h3.3 (Issue 2, Preferred option)**: "invoke `configureHarness()` explicitly on the
  `main()` startup path … wrapping it so its error renders via the same clean handler as
  `AuthPreflightError`." S2 is exactly that.
- **Defense in depth**: even if some future import order causes `HarnessProviderMismatchError` to
  throw on a path that reaches `main()` (rather than at module load), the `main().catch()` arm now
  renders it cleanly. Belt-and-suspenders.
- **Default path untouched**: `configureHarness()` is idempotent (`HarnessRegistry.has('pi')` guard;
  `configureHarnesses()` is a config-singleton setter). On the valid `pi`+`zai` path it returns
  `'pi'` and registers `PiHarness` exactly as the lazy accessor did — and the accessor's later call
  from `createBaseConfig` is a no-op cache hit.

## What

A surgical edit to **one** source file (`src/index.ts`). Four coordinated changes:

### Change A — extend the `./config/harness.js` import to include `configureHarness`

The existing import (L39-42) is:
```ts
import {
  ensureHarnessInitialized,
  runAuthPreflight,
} from './config/harness.js';
```
Add `configureHarness`:
```ts
import {
  configureHarness,
  ensureHarnessInitialized,
  runAuthPreflight,
} from './config/harness.js';
```

### Change B — add `HarnessProviderMismatchError` to the `./config/types.js` import

The existing import (L43) is:
```ts
import { AuthPreflightError } from './config/types.js';
```
Add `HarnessProviderMismatchError`:
```ts
import { AuthPreflightError, HarnessProviderMismatchError } from './config/types.js';
```

### Change C — insert the explicit `configureHarness()` call in `main()`'s startup gap

Locate the region after the `--validate-prd` early-return block and BEFORE `await runAuthPreflight()`
(the "agent paths only" region created by P1.M1.T1.S1). Insert:
```ts
  // CRITICAL: Configure the agent harness eagerly on the agent-invoking path (bugfix §h3.3 / Issue 2).
  // configureHarness() resolves PRP_AGENT_HARNESS, validates it, enforces harness↔provider
  // compatibility (throws HarnessProviderMismatchError on claude-code+zai — PRD §9.4.3), and
  // registers PiHarness. Run AFTER configureEnvironment() and the local-only early-returns, BEFORE
  // runAuthPreflight()/ensureHarnessInitialized(). Idempotent: the lazy resolvedHarness() accessor in
  // agent-factory.ts becomes a no-op cache hit when createBaseConfig later runs. Errors are rendered
  // cleanly by the main().catch() HarnessProviderMismatchError arm below.
  configureHarness();
```
(Place it directly above the existing `// CRITICAL: Fail-fast auth preflight (PRD §9.2.7) …`
comment that precedes `await runAuthPreflight()`.)

### Change D — extend `main().catch()` with a `HarnessProviderMismatchError` arm

The existing handler (L315-321) is:
```ts
void main().catch((error: unknown) => {
  if (error instanceof AuthPreflightError) {
    console.error(`\n❌ ${error.message}`); // ONE actionable message (PRD §9.2.7)
    process.exit(1);
  }
  console.error('\n❌ Fatal error in main():', error);
  process.exit(1);
});
```
Add the new arm (place it alongside the `AuthPreflightError` arm — order between the two `instanceof`
checks does not matter since they are distinct error classes):
```ts
void main().catch((error: unknown) => {
  if (error instanceof AuthPreflightError) {
    console.error(`\n❌ ${error.message}`); // ONE actionable message (PRD §9.2.7)
    process.exit(1);
  }
  if (error instanceof HarnessProviderMismatchError) {
    console.error(`\n❌ ${error.message}`); // actionable: names harness+provider+§9.2.4+both remediations
    process.exit(1);
  }
  console.error('\n❌ Fatal error in main():', error);
  process.exit(1);
});
```

### Change E — update the `main()` `@remarks` JSDoc (Mode A — rides with the code)

The current `main()` `@remarks` (set by P1.M1.T1.S1) lists the startup steps:
```
 * 1. Configures environment
 * 2. Creates root logger (independent of credentials/harness)
 * 3. Handles pure-local modes (--dry-run, --validate-prd) credential-free
 * 4. Runs auth preflight + harness initialization (agent paths only, §9.2.7)
 * 5. Creates pipeline instance, runs pipeline, displays results
```
Insert a new step between the current (3) and (4) documenting the explicit `configureHarness()` call,
and add a line noting its mismatch error renders via the same clean `main().catch()` handler as
`AuthPreflightError`. Renumber so the list stays sequential. Keep the existing "Pure-local modes …
run BEFORE the §9.2.7 credential preflight and harness init (bugfix PRD §h3.2)" note intact.

### Constraints (DO/DON'T)

- **DO** place the `configureHarness()` call AFTER `configureEnvironment()` and AFTER the
  `--dry-run`/`--validate-prd` early-returns, but BEFORE `await runAuthPreflight()`. That exact
  ordering is load-bearing (see "Why the exact placement matters").
- **DO** call `configureHarness()` WITHOUT `await` — it is synchronous (`export function configureHarness(): AgentHarness`).
- **DO** keep the `main().catch()` `AuthPreflightError` arm byte-unchanged; ADD a sibling
  `HarnessProviderMismatchError` arm. Do not merge them into one `if`.
- **DO** preserve `process.exit(1)` in the new arm (matches the AuthPreflightError arm's exit code).
- **DON'T** touch `src/agents/agent-factory.ts` — the lazy `resolvedHarness()` accessor shipped in
  P1.M1.T2.S1 is correct and stays as-is (it becomes a no-op cache hit after the explicit call).
- **DON'T** modify `src/config/harness.ts`, `environment.ts`, or `types.ts` — their logic is correct
  and out of scope (architecture §5).
- **DON'T** wrap `configureHarness()` in a try/catch inside `main()` — let it throw; `void
  main().catch(...)` is the single clean handler. A local try/catch would duplicate the rendering.
- **DON'T** add the subprocess acceptance test (claude-code+zai → clean exit 1) — that's
  **P1.M1.T2.S3**. This subtask ships the code; S3 ships the test.
- **DON'T** change the exit code for a valid `pi`+`zai` config (it must still proceed to the pipeline).
- **DON'T** add `configureHarness()` to the local-only early-return branches (`--dry-run` /
  `--validate-prd`) — those paths are intentionally harness-free (Issue 1 / P1.M1.T1.S1).

### Why the exact placement matters (load-bearing ordering)

```
configureEnvironment();              // L119 — maps AUTH_TOKEN→API_KEY (MUST precede configureHarness)
const logger = getLogger('App', …);  // L122 — independent of creds/harness
if (args.dryRun) { …; return 0; }    // L134 — local-only, harness-free
if (args.validatePrd) { …; return …; } // L148 — local-only, harness-free
configureHarness();                  // ← NEW (this subtask): agent paths only; clean error on throw
await runAuthPreflight();            // L195 — agent paths only
await ensureHarnessInitialized();    // L200
```

- **After `configureEnvironment()`**: `configureHarness()` reads env to build `harnessDefaults`
  (apiKey binding). env.ts JSDoc states it "MUST be called before configureHarness()".
- **After local-only early-returns**: `--dry-run`/`--validate-prd` must NOT resolve the harness
  (Issue 1). Placing `configureHarness()` after their `return` statements means those paths never
  reach it.
- **Before `runAuthPreflight()`**: the harness/provider mismatch is a more fundamental config error
  than a missing credential, and its message is self-contained; surfacing it first gives the clearest
  signal. (Order relative to `runAuthPreflight` is not strictly load-bearing, but "harness config
  before auth check" is the natural reading and matches the bugfix PRD §h3.3 ordering.)

### Why behavior is identical for valid configs

`configureHarness()` is **idempotent**: Step 4.5 is `if (!registry.has('pi')) registry.register(new
PiHarness())`, and `configureHarnesses()` is a config-singleton setter. The explicit `main()` call
AND the lazy `resolvedHarness()` accessor in `agent-factory.ts` BOTH call `configureHarness()` —
and that is safe: the accessor has its OWN `_resolvedHarness` cache (independent of `main()`), so
on the agent path `configureHarness()` runs twice (once in `main()`, once when `createBaseConfig`
first runs). The second call hits the `HarnessRegistry.has('pi') === true` guard (no
double-register) and re-runs `configureHarnesses()` (re-stores the same config singleton, a no-op).
So the `pi`+`zai` default path is byte-identical in observable behavior.

### Success Criteria

- [ ] `import { configureHarness, ensureHarnessInitialized, runAuthPreflight } from './config/harness.js';`
      is present (Change A).
- [ ] `import { AuthPreflightError, HarnessProviderMismatchError } from './config/types.js';`
      is present (Change B).
- [ ] A `configureHarness();` call exists in `main()` between the `validatePrd` early-return and
      `await runAuthPreflight()` (Change C).
- [ ] `main().catch()` has an `if (error instanceof HarnessProviderMismatchError)` arm printing
      `❌ <message>` + `process.exit(1)` (Change D).
- [ ] `main()` `@remarks` JSDoc documents the explicit `configureHarness()` call + clean error
      rendering (Change E, Mode A).
- [ ] `npx tsc --noEmit -p tsconfig.build.json` → 0 errors.
- [ ] `npm run test:run -- config/auth-preflight config/auth-resolution config/auth-resolver agents/agent-factory` → all pass.
- [ ] Only `src/index.ts` modified; no other src/ or test file touched.

## All Needed Context

### Context Completeness Check

_Pass._ A developer who has never seen this repo can implement this from the four file references
below + the exact before/after blocks. The change is five coordinated edits (2 imports, 1 call, 1
catch arm, 1 JSDoc note) to a single source file; the failure modes (wrong placement, await on a
sync fn, local try/catch, touching S1/S3 scope, modifying harness.ts) are enumerated below with the
reason each is avoided.

### Documentation & References

```yaml
# MUST READ - Include these in your context window

- file: src/index.ts
  why: TARGET FILE. L39-42 (harness.js import to extend), L43 (types.js import to extend),
        L148-195 (the GAP for the configureHarness() call), L315-321 (main().catch() to extend).
  pattern: |
    # The exact GAP (between the validatePrd early-return block and the preflight):
    #   ... logger.info('='.repeat(60) + '\n');
    #   return result.valid ? 0 : 1;
    # }                                          ← end of validatePrd block (~L193)
    #                                            ← INSERT configureHarness() HERE
    # // CRITICAL: Fail-fast auth preflight (PRD §9.2.7) ...
    # await runAuthPreflight();
  gotcha: |
    `configureHarness()` is SYNCHRONOUS (returns AgentHarness, not a Promise). Call it WITHOUT
    `await`. `runAuthPreflight()` and `ensureHarnessInitialized()` ARE async (they await). Do not
    homogenize the call styles.

- file: src/config/harness.ts
  why: Confirms configureHarness() is synchronous, idempotent (Step 4.5 `if (!registry.has('pi'))`),
        throws HarnessProviderMismatchError on claude-code+zai (Step 4), and MUST run AFTER
        configureEnvironment(). Justifies the placement and the no-await call.
  pattern: |
    export function configureHarness(): AgentHarness {   // SYNC — no Promise
      // Step 4: Enforce harness↔provider compatibility
      const resolvedProvider = getResolvedProvider();
      if (harness === 'claude-code' && resolvedProvider === 'zai') {
        throw new HarnessProviderMismatchError(harness, resolvedProvider);   // ← the throw S2 renders
      }
      // Step 4.5: idempotent registration
      const registry = HarnessRegistry.getInstance();
      if (!registry.has('pi')) { registry.register(new PiHarness()); }
      ...
    }
  critical: |
    Do NOT modify harness.ts — its logic is correct and out of scope (architecture §5). S2 only
    changes WHERE configureHarness() is invoked (now explicitly in main(), plus the clean catch).

- file: src/config/types.ts
  why: Confirms HarnessProviderMismatchError's constructor + message. The message ALREADY contains
        harness + provider + §9.2.4 + both remediations — so the catch arm just prints error.message
        verbatim (no formatting needed, mirroring the AuthPreflightError arm).
  pattern: |
    export class HarnessProviderMismatchError extends Error {
      constructor(harness: AgentHarness, provider: ModelProvider) {
        super(
          `Harness '${harness}' is incompatible with provider '${provider}' (PRD §9.2.4). ` +
          `Switch the harness to 'pi' (PRP_AGENT_HARNESS=pi) or switch the model provider to anthropic/* models.`
        );
        this.name = 'HarnessProviderMismatchError';
        ...
      }
    }
  critical: |
    The catch arm is `console.error(\`\n❌ ${error.message}\`)` — IDENTICAL in shape to the
    AuthPreflightError arm. Do not build a custom message; the class's own message is the actionable
    one-liner. error.harness / error.provider are also available if needed, but the message suffices.

- file: src/agents/agent-factory.ts
  why: Confirms the P1.M1.T2.S1 lazy resolvedHarness() accessor is in place (L53-60) and
        createBaseConfig reads `harness: resolvedHarness()` (L186). The explicit main() call and the
        accessor BOTH call configureHarness() — this is safe (idempotent). The accessor's own cache
        (_resolvedHarness) is independent, but configureHarness()'s internal idempotency
        (HarnessRegistry.has('pi')) prevents any double-registration side effect.
  gotcha: |
    Do NOT touch agent-factory.ts. Its accessor stays as-is. After S2, on the agent path the flow is:
    main() configureHarness() (registers PiHarness) → … pipeline → createBaseConfig() →
    resolvedHarness() (cache miss on _resolvedHarness, so it calls configureHarness() AGAIN →
    hits the has('pi')===true guard → no-op register → returns 'pi'). Safe.

- docfile: plan/007_8783a1f5e14a/bugfix/002_edc62322bc90/architecture/system_context.md
  section: §3 (Issue 2 root cause + fix, esp. "Error rendering" + "Idempotency note") and §4 (sequencing)
  why: Authoritative root cause + the exact recipe (the code blocks in this PRP are quoted from §3/§4).
        §4 documents S1 must land BEFORE S2 (✅ done) and that S2 = main() call + catch extension.
        §6 documents the coverage reality (index.ts is subprocess-only, 0% in-process — do NOT chase
        coverage; authoritative acceptance is the subprocess suite, which is S3).
  critical: |
    §3 "Idempotency note" + §4 establish the contract: S1 (lazy-ify) ✅ done; S2 (main() call +
    catch) = THIS subtask; S3 (subprocess test) = next. Do NOT do S3 work here — it will add a test
    file and is out of scope. §6 warns: do NOT add istanbul-ignore or block on index.ts coverage.

- docfile: plan/007_8783a1f5e14a/bugfix/002_edc62322bc90/architecture/test-conventions.md
  section: §4 (subprocess patterns) and §6 (existing HarnessProviderMismatchError assertions)
  why: Confirms the EXISTING in-process tests (harness-provider-compat.test.ts, harness-config.test.ts,
        harness.test.ts) already assert configureHarness() throws HarnessProviderMismatchError
        in-process with the right shape/message. Those stay green — S2 changes only WHERE in the
        process lifecycle the throw surfaces for the CLI path, not the throw itself. Also documents
        the subprocess spawnSync pattern S3 will use (not needed for S2 itself, but informs why S2
        ships code-only).
  critical: |
    Do NOT add a subprocess test here — that's S3. S2 is code-only; the existing in-process suites
    are the regression gate. The subprocess acceptance (claude-code+zai → clean exit 1, no raw
    stack) is S3's deliverable.

- docfile: PRD.md  (hacky-hack)
  section: §9.2.7 (fail-fast clean error UX) and §9.4.3 (mismatch surfaced at startup/initialize)
  why: The PRD basis for the clean-error rendering and the "not at module load" requirement. Cite
        both in the updated main() @remarks JSDoc (Change E).
```

### Current Codebase tree (relevant slice)

```bash
src/
├── index.ts                 # ← TARGET FILE (2 imports extended, 1 call inserted, 1 catch arm, JSDoc note)
├── agents/
│   └── agent-factory.ts     # lazy resolvedHarness() accessor (P1.M1.T2.S1 ✅) — UNCHANGED
└── config/
    ├── harness.ts           # configureHarness() — sync, idempotent, UNCHANGED
    ├── environment.ts       # configureEnvironment() — idempotent, UNCHANGED
    └── types.ts             # HarnessProviderMismatchError / AuthPreflightError — UNCHANGED
tests/unit/config/
├── auth-preflight.test.ts          # REGRESSION GATE — subprocess acceptance (a) still holds
├── harness-provider-compat.test.ts # REGRESSION GATE — in-process throw still holds
├── harness-config.test.ts          # REGRESSION GATE — in-process throw still holds
└── harness.test.ts                 # REGRESSION GATE — class-level constructor tests
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# No new files. One existing file modified in place:
src/index.ts   # +configureHarness to harness.js import, +HarnessProviderMismatchError to types.js import,
               #  +configureHarness() call in main() gap, +catch arm, +@remarks JSDoc note
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: configureHarness() is SYNCHRONOUS. Call it WITHOUT `await`. Contrast with
//   runAuthPreflight() and ensureHarnessInitialized(), which ARE async. Do not homogenize.
//
// CRITICAL: place configureHarness() AFTER configureEnvironment() and AFTER the dryRun/validatePrd
//   early-returns, but BEFORE runAuthPreflight(). env.ts JSDoc: "Must be called before
//   configureHarness()". The local-only modes must stay harness-free (Issue 1 / P1.M1.T1.S1).
//
// CRITICAL: do NOT wrap configureHarness() in a local try/catch inside main(). Let it throw; the
//   `void main().catch(...)` handler is the single clean rendering point. A local try/catch would
//   duplicate the ❌ message logic and split the error path.
//
// CRITICAL: keep the catch arm IDENTICAL in shape to the AuthPreflightError arm:
//   console.error(`\n❌ ${error.message}`); process.exit(1);
//   Do NOT add a custom message — HarnessProviderMismatchError's own message is the actionable
//   one-liner (it already names harness+provider+§9.2.4+both remediations).
//
// GOTCHA (idempotency / double-call): main() calls configureHarness() explicitly, and the lazy
//   resolvedHarness() accessor in agent-factory.ts calls it again when createBaseConfig runs.
//   This is SAFE: configureHarness()'s Step 4.5 `if (!registry.has('pi'))` prevents double-register,
//   and configureHarnesses() is a config-singleton setter. The pi+zai default path is byte-identical.
//
// GOTCHA (distinct error classes): AuthPreflightError and HarnessProviderMismatchError are siblings
//   (both extend Error), NOT in a subclass relationship. Two separate `instanceof` arms are needed;
//   a single `if (error instanceof AuthPreflightError)` will NOT catch HarnessProviderMismatchError.
//
// GOTCHA (coverage): src/index.ts is subprocess-only — main() is not exported and auto-runs via
//   `void main().catch()`, so no in-process vitest test calls it. The v8 in-process instrumenter shows
//   index.ts at 0% (architecture §6). Do NOT chase in-process coverage, do NOT add istanbul-ignore,
//   do NOT block on it. The authoritative acceptance path is the subprocess spawnSync suite (S3).
//
// GOTCHA (existing in-process suites stay green): harness-provider-compat / harness-config /
//   harness.test already assert configureHarness() throws HarnessProviderMismatchError in-process.
//   S2 changes only WHERE the throw surfaces for the CLI lifecycle (now a clean main()-level error),
//   not the throw itself. Those tests import configureHarness directly and call it — unaffected.
//
// GOTCHA (sequencing): S2 must NOT add the subprocess acceptance test (claude-code+zai → clean exit 1)
//   — that's P1.M1.T2.S3. S2 ships code-only; S3 ships the test that proves the clean rendering
//   end-to-end via spawnSync.
```

## Implementation Blueprint

### Data models and structure

None. No new types, interfaces, or exported symbols. This is a control-flow + error-handling edit
to one module's startup path.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/index.ts — extend the harness.js import (Change A)
  - LOCATE: L39-42:
        import {
          ensureHarnessInitialized,
          runAuthPreflight,
        } from './config/harness.js';
  - ADD `configureHarness` to the named-import list (alphabetical/leading position is fine):
        import {
          configureHarness,
          ensureHarnessInitialized,
          runAuthPreflight,
        } from './config/harness.js';
  - VERIFY: `rg -n "configureHarness" src/index.ts` → at least 1 hit (the import; more after Task 3).

Task 2: MODIFY src/index.ts — extend the types.js import (Change B)
  - LOCATE: L43:
        import { AuthPreflightError } from './config/types.js';
  - ADD HarnessProviderMismatchError:
        import { AuthPreflightError, HarnessProviderMismatchError } from './config/types.js';
  - VERIFY: `rg -n "HarnessProviderMismatchError" src/index.ts` → 1 hit so far (the import; 2 after Task 4).

Task 3: MODIFY src/index.ts — insert the explicit configureHarness() call in main() (Change C)
  - LOCATE: the end of the `if (args.validatePrd) { … }` block (the `return result.valid ? 0 : 1;`
      and its closing `}`), which sits immediately above the
      `// CRITICAL: Fail-fast auth preflight (PRD §9.2.7)` comment + `await runAuthPreflight();`.
  - INSERT (between the validatePrd block close and the preflight comment):
        // CRITICAL: Configure the agent harness eagerly on the agent-invoking path (bugfix §h3.3 / Issue 2).
        // configureHarness() resolves PRP_AGENT_HARNESS, validates it, enforces harness↔provider
        // compatibility (throws HarnessProviderMismatchError on claude-code+zai — PRD §9.4.3), and
        // registers PiHarness. Run AFTER configureEnvironment() and the local-only early-returns,
        // BEFORE runAuthPreflight()/ensureHarnessInitialized(). Idempotent: the lazy resolvedHarness()
        // accessor in agent-factory.ts becomes a no-op cache hit when createBaseConfig later runs.
        // Errors are rendered cleanly by the main().catch() HarnessProviderMismatchError arm below.
        configureHarness();
  - NO `await` — configureHarness is synchronous.
  - PRESERVE: the preflight comment + `await runAuthPreflight()` + `await ensureHarnessInitialized()`
      below it — byte-unchanged.
  - VERIFY: `rg -n "configureHarness\(\)" src/index.ts` → exactly 1 hit, located above runAuthPreflight.

Task 4: MODIFY src/index.ts — extend main().catch() (Change D)
  - LOCATE: the `void main().catch((error: unknown) => { ... });` block at the bottom of the file.
  - ADD a sibling arm immediately AFTER the existing AuthPreflightError arm (and BEFORE the generic
      `console.error('\n❌ Fatal error in main():', error)` fallthrough):
        if (error instanceof HarnessProviderMismatchError) {
          console.error(`\n❌ ${error.message}`); // actionable: harness+provider+§9.2.4+both remediations
          process.exit(1);
        }
  - PRESERVE: the AuthPreflightError arm byte-unchanged; the generic fallthrough stays as the last arm.
  - VERIFY: `rg -n "HarnessProviderMismatchError" src/index.ts` → exactly 2 hits (import + catch arm).

Task 5: MODIFY src/index.ts — update main() @remarks JSDoc (Change E, Mode A — rides with code)
  - LOCATE: the `@remarks` block on `main()` (currently lists steps 1-5; set by P1.M1.T1.S1).
  - INSERT a new step documenting the explicit configureHarness() call, between the local-only-modes
      step and the preflight step. Renumber so the list stays sequential. Add a one-line note that the
      mismatch error renders via the same clean main().catch() handler as AuthPreflightError.
  - PRESERVE: the existing "Pure-local modes (--dry-run, --validate-prd) … run BEFORE the §9.2.7
      credential preflight and harness init (bugfix PRD §h3.2)" note (it is still accurate).
  - CITE: bugfix PRD §h3.3 (Issue 2) and PRD §9.4.3.

Task 6: VERIFY (no code change — validation only)
  - RUN: npx tsc --noEmit -p tsconfig.build.json → 0 errors (baseline 0).
  - RUN: npm run test:run -- config/auth-preflight config/auth-resolution config/auth-resolver agents/agent-factory → all pass.
  - RUN: npm run test:run -- agents/agent-factory → 23/23 pass.
  - RUN: npx prettier --check src/index.ts → pass.
  - RUN: rg -n "configureHarness\(\)" src/index.ts → exactly 1 hit (in main(), above runAuthPreflight).
  - RUN: rg -n "HarnessProviderMismatchError" src/index.ts → exactly 2 hits (import + catch arm).
```

### Implementation Patterns & Key Details

```ts
// PATTERN: fail-fast clean-error rendering via main().catch() instanceof arms.
// Each known startup config error gets its own arm that prints `❌ <error.message>` + exit 1,
// matching the §9.2.7 single-actionable-message UX. The generic fallthrough (Fatal error) is the
// last resort for unexpected errors.
void main().catch((error: unknown) => {
  if (error instanceof AuthPreflightError) {
    console.error(`\n❌ ${error.message}`);   // PRD §9.2.7
    process.exit(1);
  }
  if (error instanceof HarnessProviderMismatchError) {
    console.error(`\n❌ ${error.message}`);   // PRD §9.4.3 / §9.2.4 — actionable one-liner (this subtask)
    process.exit(1);
  }
  console.error('\n❌ Fatal error in main():', error);
  process.exit(1);
});

// PATTERN: eager idempotent singleton init on the path that needs it.
// configureHarness() is called explicitly in main() (agent path) AND lazily in agent-factory.ts's
// accessor. Both are safe — configureHarness()'s internal `if (!registry.has('pi'))` guard makes
// the second call a no-op. This mirrors how configureEnvironment() is already called in both
// main() and the accessor (P1.M1.T2.S1).
configureHarness();   // SYNC — no await; registers PiHarness + stores Groundswell config singleton
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
  - DEPENDS-ON (completed): P1.M1.T1.S1 — main() reordered (logger up; dry-run/validate-prd early-returns
      before preflight+harness). S2's configureHarness() call slots into the gap that created.
  - DEPENDS-ON (completed): P1.M1.T2.S1 — agent-factory.ts has the lazy resolvedHarness() accessor.
      S2's explicit main() call + the accessor's lazy call are both safe (idempotent configureHarness).
  - ENABLES (downstream): P1.M1.T2.S3 — subprocess acceptance test (claude-code+zai → clean exit 1,
      no raw stack). Only meaningful after S2 renders the error cleanly via main().catch().
  - ENABLES (downstream): P1.M1.T3 — docs sync (the clean-error UX for harness mismatch is now real;
      README/CLI_REFERENCE/CONFIGURATION can document it).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After the edits — confirm no formatting regression on the changed file.
npx prettier --check src/index.ts
# Expected: passes. If prettier reformats the multi-line import or the catch arm, run
# `npx prettier --write src/index.ts` and re-check.

# Lint (eslint . --ext .ts — picks up src/).
npm run lint
# Expected: zero NEW errors in src/index.ts.

# Typecheck — THE PRIMARY LEVEL-1 GATE (baseline is 0 errors across all of src/).
npx tsc --noEmit -p tsconfig.build.json
# Expected: 0 errors. If a new error appears (e.g. "HarnessProviderMismatchError is not exported
# from ./config/types.js" or "configureHarness is not a function"), STOP and re-read:
#   - types.ts exports `HarnessProviderMismatchError` (verified: class at L141, `export class`).
#   - harness.js exports `configureHarness` (it was already imported for ensureHarnessInitialized
#     from the same module — just add it to the named-import list).
# If you accidentally added `await configureHarness()`, tsc will NOT error (await on a non-promise
# is legal in TS) but it is semantically wrong — grep to confirm NO `await` precedes the call.
```

### Level 2: Unit Tests (Regression Gates)

```bash
# PRIMARY GATE — the existing auth + agent-factory suites must stay green.
npm run test:run -- config/auth-preflight config/auth-resolution config/auth-resolver agents/agent-factory
# Expected: Test Files 4 passed | Tests 70 passed (baseline).
#   - auth-preflight: the subprocess acceptance (a) `--prd PRD.md` (no --validate-prd/--dry-run) with
#     scrubbed env → exit 1 + preflight message + no session dir STILL HOLDS: that command goes to
#     the pipeline path → configureHarness() (NEW) runs first → on default pi+zai it does NOT throw →
#     runAuthPreflight() runs → exit 1 (no credential). The preflight message is still the one printed.
#   - harness-provider-compat / harness-config / harness.test: in-process configureHarness() throw
#     assertions UNCHANGED — they import configureHarness directly and call it; S2 doesn't touch that.

# Agent-factory specifically — the 5 persona-creation tests depend on PiHarness registration.
npm run test:run -- agents/agent-factory
# Expected: 23/23 pass. The explicit main() call is NOT in the agent-factory import path (index.ts
# imports agent-factory, not vice versa), so the in-process agent-factory tests are unaffected;
# the lazy accessor still registers PiHarness on first createBaseConfig.
```

### Level 3: Integration Testing (in-process + manual probes — no test-file change)

```bash
# Probe A — the throw now happens on the main() path (caught by main().catch), NOT at module load.
# Importing the module graph must NOT throw (S1 already ensured this; S2 keeps it true).
npx tsx -e "
  process.env.PRP_AGENT_HARNESS = 'claude-code';
  delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
  // Importing index.ts's graph must not throw at load (module-eval side effect removed by S1):
  await import('./src/agents/agent-factory.js');
  console.log('OK: module imported without throwing at load time');
"
# Expected: "OK: module imported without throwing at load time"

# Probe B — the explicit configureHarness() still throws on mismatch (the throw is the correct
# behavior; S2 only changes HOW it's rendered). Call configureHarness directly:
npx tsx -e "
  process.env.PRP_AGENT_HARNESS = 'claude-code';
  delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
  const { configureHarness } = await import('./src/config/harness.js');
  try { configureHarness(); console.log('UNEXPECTED: did not throw'); }
  catch (e) {
    console.log('OK threw:', e.constructor.name, '| message:', e.message.split('.')[0]);
  }
"
# Expected: "OK threw: HarnessProviderMismatchError | message: Harness 'claude-code' is incompatible with provider 'zai'"

# NOTE: do NOT assert a clean exit-1 SUBPROCESS here — that requires the built dist/index.js and is
# the deliverable of P1.M1.T2.S3. S2 ships the code; S3 ships the spawnSync proof. The two probes
# above confirm the in-process behavior (no module-load throw; throw-on-use still works).

# Optional: build the dist and run the bugfix PRD §h3.3 repro manually (NOT a committed test —
# that's S3; this is a one-off sanity check the implementer may run):
#   npm run build
#   TMP=$(mktemp -d); env -u ZAI_API_KEY -u PRP_API_KEY -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN \
#     PI_CODING_AGENT_DIR="$TMP" PRP_AGENT_HARNESS=claude-code \
#     node dist/index.js --prd PRD.md --dry-run
#   # Expected (post-S2): exit 1, stderr = "❌ Harness 'claude-code' is incompatible with provider 'zai' …"
#   #   and stderr does NOT contain "at ModuleJob.run" / "Node.js v".
#   rm -rf "$TMP"
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Static grep gates (the Definition-of-Done checks).
rg -n "configureHarness\(\)" src/index.ts                # → exactly 1 hit (in main(), above runAuthPreflight)
rg -n "HarnessProviderMismatchError" src/index.ts        # → exactly 2 hits (import + catch arm)
rg -n "await configureHarness" src/index.ts              # → 0 hits (must NOT be awaited)

# Confirm the two error classes are siblings (not subclass-related) — justifies two instanceof arms:
npx tsx -e "
  import('./src/config/types.js').then(t => {
    const a = new t.AuthPreflightError({harness:'pi',provider:'zai',model:'zai/glm-5.2'});
    const h = new t.HarnessProviderMismatchError('claude-code','zai');
    console.log('AuthPreflight instanceof HarnessMismatch?', a instanceof t.HarnessProviderMismatchError);
    console.log('HarnessMismatch instanceof AuthPreflight?', h instanceof t.AuthPreflightError);
  });
"
# Expected: false / false → two distinct arms are required (a single instanceof cannot cover both).

# DO NOT run `npm run test:coverage` as a gate on src/index.ts — it is subprocess-only and
# intentionally 0% in-process (architecture §6). The authoritative acceptance is the subprocess
# spawnSync suite (S3). Do NOT add istanbul-ignore comments.
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1: `npx prettier --check src/index.ts` passes.
- [ ] Level 1: `npm run lint` → no new errors in `src/index.ts`.
- [ ] Level 1: `npx tsc --noEmit -p tsconfig.build.json` → 0 errors (baseline 0).
- [ ] Level 2: `npm run test:run -- config/auth-preflight config/auth-resolution config/auth-resolver agents/agent-factory` → 70/70 pass.
- [ ] Level 2: `npm run test:run -- agents/agent-factory` → 23/23 pass.
- [ ] Level 3: Probe A (import with claude-code+zai) does NOT throw at load; Probe B (call configureHarness) throws on use.
- [ ] Only `src/index.ts` modified; no other src/ or test file touched.

### Feature Validation

- [ ] `configureHarness` added to the `./config/harness.js` named import (Change A).
- [ ] `HarnessProviderMismatchError` added to the `./config/types.js` named import (Change B).
- [ ] `configureHarness()` call present in `main()` between the `validatePrd` early-return and `runAuthPreflight()` (Change C); NOT awaited.
- [ ] `main().catch()` has a `HarnessProviderMismatchError` arm printing `❌ <message>` + `process.exit(1)` (Change D).
- [ ] `main()` `@remarks` JSDoc documents the explicit call + clean error rendering (Change E).
- [ ] `rg -n "configureHarness\(\)" src/index.ts` → exactly 1 hit; `rg -n "await configureHarness" src/index.ts` → 0 hits.
- [ ] `rg -n "HarnessProviderMismatchError" src/index.ts` → exactly 2 hits (import + catch arm).

### Code Quality Validation

- [ ] The catch arm is identical in shape to the AuthPreflightError arm (`❌ ${error.message}` + exit 1).
- [ ] No local try/catch around `configureHarness()` in `main()` (let it throw to `main().catch()`).
- [ ] The `AuthPreflightError` arm is byte-unchanged; the new arm is a sibling, not a merge.
- [ ] No changes to `agent-factory.ts`, `harness.ts`, `types.ts`, `environment.ts`, or any test file.
- [ ] No `/* istanbul ignore */` and no in-process coverage chasing on `src/index.ts`.

### Documentation & Deployment

- [ ] No env vars added (reads existing `PRP_AGENT_HARNESS`).
- [ ] `main()` `@remarks` JSDoc updated (Mode A — done with the code); cites bugfix §h3.3 + PRD §9.4.3.
- [ ] No README/docs/CLI_REFERENCE changes here (cross-cutting docs sync is P1.M1.T3).

---

## Scope Boundaries (DO NOT EXPAND)

This subtask is **the explicit `configureHarness()` call in `main()` + the `main().catch()`
extension + the `main()` JSDoc note** in `src/index.ts` ONLY. The following are explicitly OUT OF
SCOPE and owned by sibling subtasks:

- ❌ The subprocess acceptance test (claude-code+zai → clean exit 1, no raw stack) → **P1.M1.T2.S3**.
- ❌ Modifying `src/agents/agent-factory.ts` (lazy accessor shipped in P1.M1.T2.S1) → done, untouched.
- ❌ Modifying `src/config/harness.ts`, `environment.ts`, or `types.ts` → out of scope (architecture §5).
- ❌ Cross-cutting docs (README, CLI_REFERENCE, CONFIGURATION, INSTALLATION) → **P1.M1.T3**.
- ❌ The 212 pre-existing failing tests in the wider suite → unrelated to this delta (per PRD Overview).
- ❌ Running `npm run test:coverage` as a hard gate on `src/index.ts` → it is subprocess-only and
  intentionally 0% in-process (architecture §6); the authoritative acceptance is the subprocess suite (S3).

---

## Anti-Patterns to Avoid

- ❌ Don't `await configureHarness()` — it is synchronous; awaiting is semantically wrong (even though
  tsc won't error on it). Grep to confirm no `await` precedes the call.
- ❌ Don't place `configureHarness()` before the `--dry-run`/`--validate-prd` early-returns — those
  paths are intentionally harness-free (Issue 1 / P1.M1.T1.S1).
- ❌ Don't place `configureHarness()` before `configureEnvironment()` — env.ts requires env config first.
- ❌ Don't wrap `configureHarness()` in a local try/catch — let it throw to `main().catch()`, which is
  the single clean rendering point.
- ❌ Don't build a custom message in the catch arm — `HarnessProviderMismatchError.message` is already
  the actionable one-liner; print it verbatim (`❌ ${error.message}`).
- ❌ Don't merge the two `instanceof` arms into one `if` — `AuthPreflightError` and
  `HarnessProviderMismatchError` are siblings, not subclass-related (verified in Level 4).
- ❌ Don't touch `agent-factory.ts`, `harness.ts`, `types.ts`, or any test file — S2's footprint is
  `src/index.ts` ONLY.
- ❌ Don't add the subprocess test here — that's S3; S2 is code-only.
- ❌ Don't chase in-process coverage on `src/index.ts` or add `/* istanbul ignore */` — it is
  subprocess-only by design (architecture §6).
- ❌ Don't change the exit code or behavior for a valid `pi`+`zai` config — `configureHarness()` is
  idempotent; the default path proceeds exactly as before.

---

**Confidence Score: 9.5/10** for one-pass implementation success. The change is five coordinated
surgical edits to a single file (2 imports extended, 1 sync call inserted in a verified-existing gap,
1 catch arm mirroring an existing arm, 1 JSDoc note), with exact before/after blocks quoted from
architecture §3/§4. The `HarnessProviderMismatchError` message is already the actionable one-liner
(verified against types.ts), the gap for the call is empirically confirmed present (P1.M1.T1.S1 ✅),
and both regression gates are green at baseline (typecheck 0 errors; auth + agent-factory 70/70).
The 0.5 residual risk is purely a discipline risk: an implementer tempted to "also add the S3 test",
"await the sync call", "wrap it in a local try/catch", or "merge the two instanceof arms" must be
held to the narrow S2 scope defined above.
