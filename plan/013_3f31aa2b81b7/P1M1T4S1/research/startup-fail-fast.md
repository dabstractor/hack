# Research Notes — P1.M1.T4.S1

## validateAllReasoningLevels() on the startup path + ReasoningConfigError main().catch arm

The startup fail-fast integration for the Per-Role Reasoning Level feature (PRD §9.2.9 #4).
A bad reasoning env value (e.g. `PRP_REASONING_AGENT=ultra`) must abort at startup with exit 1 +
an actionable message, BEFORE any session is created or agent invoked.

---

## 1. Startup sequence in src/index.ts main() (verified — full file read)

```
parseCLIArgs()                                        (early exit on subcommand)
getRepoRoot()                                         (§9.8 bootstrap ran in preAction hook)
setupGlobalHandlers(args.verbose)
loadHackConfig(repoRoot)                              (.hack seeding → process.env)
applyHackCliDefaults(args, mergedHackConfig)
existsSync(args.prd) guard → "PRD file not found"    (return 1)
configureEnvironment()                                ← §G calls this :181
getLogger('App', …)
if (args.dryRun) … return 0                           (credential-free early return)
if (args.validatePrd) … return 0/1                    (credential-free early return)
configureHarness()                                    (harness/provider compat — clean error arm)
await runAuthPreflight()                              ← §G calls this :266
await ensureHarnessInitialized()                      ← agent creation follows
… PRPPipeline creation + run …
```

**Insertion point (§G spec, authoritative):** "AFTER configureEnvironment() (:181) and the
credential-free early-returns, BEFORE any agent is created — i.e. alongside/after runAuthPreflight()
(:266)." → **Insert `validateAllReasoningLevels()` immediately AFTER `await runAuthPreflight();`
and BEFORE `await ensureHarnessInitialized();`** (groups the two fail-fast startup checks; both run
after env is resolved incl. .hack seeding, before any agent/session).

Current code in that region (verbatim):
```ts
  // CRITICAL: Fail-fast auth preflight (PRD §9.2.7). Aborts here if no credential
  // is configured for the selected harness + provider/model — BEFORE any session
  // directory is created or any agent is invoked.
  await runAuthPreflight();

  // CRITICAL: Initialize the agent harness before any agent runs.
  // The harness is registered at module-load but never initialized; without
  // this, every agent.prompt() fails instantly (see ensureHarnessInitialized()).
  await ensureHarnessInitialized();
```

## 2. main().catch arms (verified — index.ts end of file)

Existing clean arms (each: `console.error(\`\n❌ ${error.message}\`); process.exit(1);`, NO stack):
- `AuthPreflightError`
- `HarnessProviderMismatchError`
- `UnsupportedHarnessError`
- `NotARepositoryError`
- `HackConfigError`
- `EnvironmentValidationError`
- (fallback) `console.error('\n❌ Fatal error in main():', error); process.exit(1);`

**New arm to ADD** (mirrors the others exactly — same `❌ ${error.message}` + `process.exit(1)`, no stack):
```ts
    if (error instanceof ReasoningConfigError) {
      console.error(`\n❌ ${error.message}`); // §9.2.9 #4: invalid reasoning level — actionable one-liner (no stack)
      process.exit(1);
    }
```
Place it among the clean arms (after `EnvironmentValidationError`, before the generic fallback).
Order is functionally irrelevant (instanceof is mutually exclusive) — place for readability next to
the other config-validation arms.

## 3. Imports required in src/index.ts

- **NEW import line** — index.ts has NO existing `./config/constants.js` import (grep-verified):
  `import { validateAllReasoningLevels } from './config/constants.js';`
- **EXTEND existing types import** — add `ReasoningConfigError` to the `./config/types.js` named import:
  ```ts
  import {
    AuthPreflightError,
    EnvironmentValidationError,
    HackConfigError,
    HarnessProviderMismatchError,
    ReasoningConfigError,        // ← ADD (keep alphabetical order — prettier)
    UnsupportedHarnessError,
  } from './config/types.js';
  ```

## 4. INPUT contracts (all VERIFIED present in working tree — T1.S1/T1.S2 COMPLETE)

### validateAllReasoningLevels() — src/config/constants.ts:1811
```ts
export function validateAllReasoningLevels(): void {
  getReasoningAgent();
  getReasoningBreakdown();
  getReasoningBugFinder();
  getReasoningValidation();
  getReasoningImpl();
}
```
Synchronous (`(): void`). Calls all 5 getters in sequence. Each getter throws `ReasoningConfigError`
on an invalid value (via `resolveReasoningLevel`). No-op (returns void) when all five resolve.

### ReasoningConfigError — src/config/types.ts:322
```ts
export class ReasoningConfigError extends Error {
  readonly key: string;    // env-var NAME (e.g. 'PRP_REASONING_AGENT')
  readonly value: string;  // the invalid raw value
  constructor(opts: { key: string; value: string }) {
    super(buildReasoningErrorMessage(opts));
    this.name = 'ReasoningConfigError';   // ← set in ctor → instanceof + clean rendering work
    this.key = opts.key;
    this.value = opts.value;
  }
}
```
`this.name = 'ReasoningConfigError'` is set in the constructor (mirrors AuthPreflightError) so
`error instanceof ReasoningConfigError` and the clean `main().catch` arm both work.

### The error MESSAGE (buildReasoningErrorMessage, module-local in types.ts)
```
Invalid reasoning level for 'PRP_REASONING_AGENT': 'ultra'. Accepted (case-insensitive): off, minimal, low, medium, high, xhigh.
```
Names the offending key, the bad value, AND the full accepted-values list — actionable per §9.7.7.

### The 5 env vars + defaults (for test cases)
| Env var | Default |
|---------|---------|
| PRP_REASONING_AGENT | high |
| PRP_REASONING_BREAKDOWN_AGENT | high |
| PRP_REASONING_BUG_FINDER_AGENT | high |
| PRP_REASONING_VALIDATION_AGENT | high |
| PRP_REASONING_IMPL_AGENT | off |

Vocabulary (case-insensitive): `off, minimal, low, medium, high, xhigh`. Empty/whitespace → unset →
default. Invalid (e.g. `ultra`, `loud`, `yes`) → throws.

## 5. TEST STRATEGY — two-tier, mirroring auth-preflight.test.ts exactly

`tests/unit/config/auth-preflight.test.ts` is the template. It has TWO sections:
1. **Unit tests** of `runAuthPreflight()` directly (in-process; groundswell mocked).
2. **Integration tests** via `spawnSync(dist/index.js)` (proves exit 1 + stderr message + no session dir).

My new file `tests/unit/config/reasoning-fail-fast.test.ts` mirrors this:

### 5a. UNIT tests — validateAllReasoningLevels() directly
`validateAllReasoningLevels` is synchronous, reads ONLY process.env via the getters, and is in
constants.ts (which does NOT import groundswell → NO groundswell mock needed). Cases:
- invalid `PRP_REASONING_AGENT=ultra` → `expect(() => validateAllReasoningLevels()).toThrow(ReasoningConfigError)`; message contains key + value + accepted list.
- invalid on a DIFFERENT role (`PRP_REASONING_IMPL_AGENT=loud`) → throws; message names `PRP_REASONING_IMPL_AGENT` (proves all 5 are validated, not just agent).
- valid `PRP_REASONING_VALIDATION_AGENT=xhigh` → `expect(() => validateAllReasoningLevels()).not.toThrow()` (void).
- empty/whitespace `PRP_REASONING_AGENT='   '` → treated as unset → default → no throw.
- all-unset (defaults) → no throw (void).
- case-insensitive valid `PRP_REASONING_AGENT=HIGH` → no throw.

Env hygiene: copy auth-preflight's pattern — `beforeEach` clears the 5 REASONING vars (defense
against tests/setup.ts dotenv leak; .env is clean today but be robust), `afterEach(vi.unstubAllEnvs)`.

### 5b. INTEGRATION tests — spawnSync(dist/index.js), mirror the auth-preflight "acceptance (a)" block
`dist/index.js` IS built (verified) → spawn tests will RUN (not skip). Template the auth-preflight
spawn block exactly: temp PI_CODING_AGENT_DIR, `spec/SPEC.md` as prdAbs, scrubbed env, session-dir
before/after diff.

**CRITICAL ordering gotcha:** `validateAllReasoningLevels()` runs AFTER `await runAuthPreflight()`
(per §G). So in a spawn test, an invalid reasoning env with SCRUBBED creds would hit the
**AuthPreflightError first** (auth checked before reasoning). To isolate the reasoning fail-fast:
- SET `ZAI_API_KEY: 'zai-test-key'` (so auth preflight PASSES), AND
- SET `PRP_REASONING_AGENT: 'ultra'` (invalid → reasoning error).
Then assert exit 1 + the reasoning message on stderr (NOT the auth message), + no session dir.

Case: "invalid reasoning env aborts at startup: exit 1, single message, NO session dir"
```ts
const env = { PATH, HOME, USER, SHELL, PI_CODING_AGENT_DIR: tmp, ZAI_API_KEY: 'zai-test-key', PRP_REASONING_AGENT: 'ultra' };
const res = spawnSync(process.execPath, [CLI, '--prd', prdAbs], { encoding:'utf8', timeout:20_000, env });
expect(res.status).toBe(1);
expect(res.stderr).toContain('Invalid reasoning level');   // the reasoning message
expect(res.stderr).toContain('PRP_REASONING_AGENT');
expect(res.stderr).toContain('ultra');
expect(res.stderr).toContain('off, minimal, low, medium, high, xhigh');
expect(res.stderr).not.toContain('Authentication preflight failed'); // auth PASSED
// no new plan/<NNN>_<hash>/ session dir
```

Counterpart (optional, robustness): valid reasoning env + valid creds → passes the validation gate
(reaches ensureHarnessInitialized / pipeline — but may fail later without a real model; assert only
that the reasoning error is ABSENT and exit is NOT a reasoning error). Lighter: a `--dry-run` with
invalid reasoning env exits 0 (dry-run returns BEFORE the validation gate — proves the gate is
AFTER the credential-free early returns). This mirrors auth-preflight's dry-run control.

## 6. do-not-touch / scope boundaries

- **T3.S3 (parallel, in flight)**: owns the 5 createQAAgent call sites in workflows/core. T4.S1
  touches ONLY src/index.ts (imports + 1 insertion + 1 catch arm) + the new test file. No overlap.
- Do NOT edit: constants.ts (validateAllReasoningLevels/getters — T1.S2), types.ts
  (ReasoningConfigError — T1.S1), harness.ts (runAuthPreflight), agent-factory.ts, any workflow.
- The `.hack` enum path already fail-fasts inside loadHackConfig (T2.S2 — case-insensitive enum
  validation in the loader). T4.S1 covers the SHELL/ENV path (PRP_REASONING_*=ultra in the
  environment), which is NOT validated until a getter runs — hence the explicit startup pass.
- No docs files (P1.M2 owns changeset docs). The message format is the user-facing surface and is
  covered by the ReasoningConfigError JSDoc (T1.S1). A brief inline comment at the insertion point
  (like the existing runAuthPreflight comment) is the only in-code documentation.

## 7. Validation commands (verified in package.json)

```
npm run build          # tsc -p tsconfig.build.json (needed for spawn tests against dist/index.js)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json
npm run lint           # eslint . --ext .ts
npm run format:check   # prettier --check
npx vitest run tests/unit/config/reasoning-fail-fast.test.ts
npx vitest run tests/unit/config/auth-preflight.test.ts   # regression — index.ts edit must not break it
```

## 8. Exact before/after for src/index.ts

IMPORTS — before:
```ts
import {
  AuthPreflightError,
  EnvironmentValidationError,
  HackConfigError,
  HarnessProviderMismatchError,
  UnsupportedHarnessError,
} from './config/types.js';
```
IMPORTS — after:
```ts
import { validateAllReasoningLevels } from './config/constants.js';   // NEW line
// …
import {
  AuthPreflightError,
  EnvironmentValidationError,
  HackConfigError,
  HarnessProviderMismatchError,
  ReasoningConfigError,           // NEW (alphabetical)
  UnsupportedHarnessError,
} from './config/types.js';
```
(Place the new constants import in import-order with the other config imports — after
hack-config/harness/types, before cli/index, OR grouped with config. The linter/prettier will
flag ordering; run `npm run format` if needed.)

INSERTION — before:
```ts
  await runAuthPreflight();

  // CRITICAL: Initialize the agent harness before any agent runs.
```
INSERTION — after:
```ts
  await runAuthPreflight();

  // CRITICAL: Fail-fast reasoning-level validation (PRD §9.2.9 #4). Validates every per-role
  // reasoning env var against the vocabulary BEFORE any session is created or agent invoked —
  // a bad level surfaces as an actionable startup error, not a deep runtime failure inside the
  // first agent call. No-op (void) when all five resolve; throws ReasoningConfigError on any
  // invalid value (caught by main().catch's clean arm below).
  validateAllReasoningLevels();

  // CRITICAL: Initialize the agent harness before any agent runs.
```

CATCH ARM — before (last clean arm + fallback):
```ts
    if (error instanceof EnvironmentValidationError) {
      console.error(`\n❌ ${error.message}`);
      process.exit(1);
    }
    console.error('\n❌ Fatal error in main():', error);
    process.exit(1);
```
CATCH ARM — after:
```ts
    if (error instanceof EnvironmentValidationError) {
      console.error(`\n❌ ${error.message}`);
      process.exit(1);
    }
    if (error instanceof ReasoningConfigError) {
      console.error(`\n❌ ${error.message}`); // §9.2.9 #4: invalid reasoning level — actionable one-liner (no stack)
      process.exit(1);
    }
    console.error('\n❌ Fatal error in main():', error);
    process.exit(1);
```