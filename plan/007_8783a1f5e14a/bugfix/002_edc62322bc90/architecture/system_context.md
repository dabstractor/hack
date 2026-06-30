# System Context — Bugfix 002 (Startup Preflight Placement & Harness Error Path)

> Scope: Two narrow startup-path defects in delta 007 (D1). Both touch the **`main()` startup
> ordering in `src/index.ts`** and the **module-eval side effect in `src/agents/agent-factory.ts`**.
> The auth resolution, logging teardown, and cross-repo Groundswell contract are verified SOLID
> and are NOT in scope. See `prd-constraints.md` for the verbatim PRD text and `test-conventions.md`
> for how to write/run the tests.

---

## 1. The startup flow today (as-built)

`dist/index.js` is the entry (`bin.hack`). Its static import graph is evaluated by Node **before
`main()` runs**. The relevant edges:

```
src/index.ts
  └─ import { PRPPipeline } from './workflows/prp-pipeline.js'        (STATIC)
       ├─ import { DeltaAnalysisWorkflow } from './delta-analysis-workflow.js'  (STATIC)
       │     └─ import { createQAAgent } from '../agents/agent-factory.js'      (STATIC)  ← line 24
       └─ import { BugHuntWorkflow } from './bug-hunt-workflow.js'              (STATIC)
             └─ import { createQAAgent } from '../agents/agent-factory.js'      (STATIC)  ← line 32
```

`src/agents/agent-factory.ts` performs **two module-eval side effects** (top of file):

```ts
// PATTERN: Configure environment at module load time (intentional side effect)
configureEnvironment();
const RESOLVED_HARNESS: AgentHarness = configureHarness();   // ← throws on claude-code+zai
```

So **the moment `dist/index.js` is imported, `configureHarness()` runs** — regardless of which CLI
mode was requested. Then `main()` executes:

```ts
// src/index.ts main()
const parseResult = parseCLIArgs();        // --help/-h/--version/inspect short-circuit + exit() HERE
...
configureEnvironment();
await runAuthPreflight();                  // ← Issue 1: blocks dry-run/validate-prd with no cred
await ensureHarnessInitialized();
const logger = getLogger('App', {...});    // logger created AFTER preflight+harness
...
if (args.dryRun)    { ...; return 0; }     // ← unreachable with no credential
if (args.validatePrd){ ...; return ...; }
... new PRPPipeline(...) ...               // only THIS path needs an agent / API
```

`main()` is launched via `void main().catch(...)` which has a clean handler ONLY for
`AuthPreflightError`:

```ts
void main().catch((error: unknown) => {
  if (error instanceof AuthPreflightError) {
    console.error(`\n❌ ${error.message}`);   // clean one-liner
    process.exit(1);
  }
  console.error('\n❌ Fatal error in main():', error);
  process.exit(1);
});
```

---

## 2. Root cause — Issue 1 (MAJOR): preflight blocks pure-local modes

`runAuthPreflight()` + `ensureHarnessInitialized()` run **unconditionally** before the
`--dry-run` / `--validate-prd` early-return branches. Both local modes make **zero** API calls:

- `--dry-run` → prints args, `return 0` (documented "Show plan without executing").
- `--validate-prd` → `new PRDValidator().validate(prd)`. `PRDValidator`
  (`src/utils/prd-validator.ts`) imports ONLY `prd-differ`, `node:fs/promises`, `node:path` —
  no agent/harness/model/prompt import. It is a static markdown linter.

With no credential, the preflight aborts (exit 1) and prints a message instructing `pi /login` /
`export ZAI_API_KEY=…` — which misleads users (API access is not required to lint a local file).

**Fix (per bugfix PRD §h3.2 "Suggested fix"):** move the two local-only early-return branches to
**before** `runAuthPreflight()` / `ensureHarnessInitialized()`. The logger must be created earlier
(it is currently created AFTER the preflight). Logger creation is independent of the preflight and
harness, and is already lazy w.r.t. §9.6.2 REQ-L2 (it lives inside `main()`, not at module
top-level), so moving it up the `main()` body is safe and does NOT regress the §9.6.3 `--help`
timing (help/version exit inside `parseCLIArgs()` before `main()`'s body runs).

Resulting order:
```ts
configureEnvironment();
const logger = getLogger('App', {...});          // moved up — independent of creds/harness
if (args.dryRun)     { ...; return 0; }          // credential-free
if (args.validatePrd){ ...; return result.valid ? 0 : 1; }   // credential-free
await runAuthPreflight();                        // agent paths only
await ensureHarnessInitialized();
... new PRPPipeline(...) ...
```

This preserves EVERY §9.2.7 acceptance criterion: the no-credential abort still happens before any
session dir / agent is created **for the agent-invoking paths** (the only paths the preflight's
motivation — "not detected until the first agent actually calls the model" — applies to).

---

## 3. Root cause — Issue 2 (MINOR): `configureHarness()` throws at module load

`configureHarness()` is invoked at **module-evaluation time** via `const RESOLVED_HARNESS =
configureHarness()` in `agent-factory.ts` (line ~58). Because `agent-factory.ts` is in the static
import graph of `index.ts` (via the two workflows — see §1), this runs **before `main()`**.

When `PRP_AGENT_HARNESS=claude-code` + default `zai` provider, `configureHarness()` throws
`HarnessProviderMismatchError` during module eval. That throw is NEVER caught by
`main().catch()` (main hasn't started), so Node prints a **raw stack trace + "Node.js v26.2.0"
banner** instead of the friendly one-liner the rest of startup produces. The auth preflight's clean
handler is **unreachable** for this case.

Note: the combination IS genuinely invalid (`claude-code` is Anthropic-only — PRD §9.4.3 /
§9.2.4). An error is correct; only the **form** (raw stack vs clean message) is the defect. PRD
§9.4.3 actually says the mismatch should be "surfaced at `initialize()`/`execute()`" — surfacing it
at module load is itself a deviation from the PRD's stated location.

**Fix (per bugfix PRD §h3.3, Preferred option):**
1. **Make `RESOLVED_HARNESS` lazy** in `agent-factory.ts`, mirroring the REQ-L2 logger pattern
   already used in that same file (`const logger = (): Logger => (_logger ??= getLogger('AgentFactory'))`).
   Convert:
   ```ts
   configureEnvironment();
   const RESOLVED_HARNESS = configureHarness();
   ```
   into a memoized accessor:
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
   and update `createBaseConfig()` to read `harness: resolvedHarness()`. This removes the
   module-eval side effect entirely → importing `index.ts` no longer throws.
2. **Invoke `configureHarness()` explicitly on the `main()` startup path**, AFTER
   `configureEnvironment()` and BEFORE `runAuthPreflight()` (i.e. in the reordered region from
   Issue 1, after the local-only early returns), so it runs only on agent-invoking paths and its
   `HarnessProviderMismatchError` is caught by `main().catch()`.

**Error rendering:** add `HarnessProviderMismatchError` to the `main().catch()` handler alongside
`AuthPreflightError` so it renders as the same clean `❌ <message>` + `process.exit(1)` one-liner
(the `HarnessProviderMismatchError` message already contains the actionable remediation — see
`src/config/types.ts` constructor). This is belt-and-suspenders: even if some future import order
causes it to throw before main, any path that reaches main renders it cleanly.

**Idempotency note:** `configureHarness()` is safe to call twice (once in `main()`, once lazily in
`agent-factory.ts` when `createBaseConfig` first runs). The `HarnessRegistry.has('pi')` guard
prevents double-registration; `configureHarnesses()` (Groundswell) is a config-singleton setter.
The lazy accessor caches the resolved value so the second call is a no-op.

---

## 4. Interaction between the two fixes (sequencing matters)

Both fixes modify the **same region of `main()`** (the startup ordering) and the error handler at
the bottom of `index.ts`. They MUST be sequenced, not done in parallel, to avoid conflicts:

1. **Issue 1 first** — reorder `main()` (move logger up; move local-only early-returns before
   preflight). This establishes the new ordering skeleton.
2. **Issue 2 second** — (a) lazy-ify `RESOLVED_HARNESS` in `agent-factory.ts`; (b) insert the
   explicit `configureHarness()` call in the gap between the early returns and `runAuthPreflight()`
   that Issue 1 created; (c) extend the `main().catch()` handler.

After BOTH fixes, the startup ordering is:
```ts
configureEnvironment();
const logger = getLogger('App', {...});          // moved up
if (args.dryRun)     { ...; return 0; }          // credential-free, harness-free
if (args.validatePrd){ ...; return ...; }        // credential-free, harness-free
configureHarness();                              // ← NEW explicit call (Issue 2); clean error on throw
await runAuthPreflight();                        // agent paths only
await ensureHarnessInitialized();
```

For `--dry-run`/`--validate-prd`, NEITHER the harness NOR the preflight runs → truly local.
For agent paths, `configureHarness()` runs first and its mismatch error is rendered cleanly.

---

## 5. Files in scope (authoritative)

| File | Change | Issue |
| --- | --- | --- |
| `src/index.ts` | Reorder `main()` (logger up; local-only early-returns before preflight+harness); add explicit `configureHarness()` call; extend `main().catch()` for `HarnessProviderMismatchError`. | 1 + 2 |
| `src/agents/agent-factory.ts` | Lazy-ify `RESOLVED_HARNESS` (remove module-eval `configureHarness()` + top-level `configureEnvironment()` side effects); `createBaseConfig` reads via accessor. | 2 |
| `src/config/harness.ts` | **No logic change** — `configureHarness()` / `runAuthPreflight()` / `ensureHarnessInitialized()` already exported and correct. (Possibly JSDoc tweak re: where it's called.) | — |
| `src/config/types.ts` | **No change** — `HarnessProviderMismatchError` / `AuthPreflightError` already have clean, actionable messages. | — |

### NOT in scope (do not touch)
- `src/config/harness.ts` logic, `runAuthPreflight`, `resolveApiKeyForProvider`, `AuthPreflightError`.
- `src/utils/prd-validator.ts` (already local-only; no change needed).
- `src/cli/index.ts` (`parseCLIArgs` / `--help`/`--version`/`inspect` short-circuits already exit
  before `main()`'s body — unaffected by the reorder).
- Groundswell cross-repo (`~/projects/groundswell`) — the `AuthStorage.create()` contract is verified
  live and correct.
- The logging subsystem (§9.6) — verified solid; do NOT introduce any module-top-level logger.

---

## 6. Test impact & strategy

Existing tests that MUST still pass (regression guard):
- `tests/unit/config/auth-preflight.test.ts` — incl. the subprocess acceptance `(a)` that runs
  `--prd PRD.md` (no `--validate-prd`/`--dry-run`) with scrubbed env and asserts exit 1 +
  preflight message + no session dir. **This still holds**: that command goes to the pipeline path
  → preflight still runs → exit 1.
- `tests/unit/config/harness-provider-compat.test.ts`, `harness-config.test.ts`, `harness.test.ts` —
  assert `configureHarness()` throws `HarnessProviderMismatchError` in-process. **Still holds**:
  `configureHarness()` still throws on `claude-code`+`zai`; only WHERE in the process lifecycle it
  surfaces changes (now a clean main()-level error, not a module-load crash).

New tests to add (see `test-conventions.md` for exact patterns):
- **Issue 1:** subprocess acceptance — `--validate-prd` AND `--dry-run` each exit 0 with a
  SCRUBBED env (no credential) and `PI_CODING_AGENT_DIR` pointed at an empty temp dir. Must assert
  `res.status === 0`, the expected local-mode output, and that NO `plan/NNN_*` session dir is
  created. Use the `spawnSync` + `describeOrSkip` (build-guarded) pattern.
- **Issue 2:** subprocess acceptance — `PRP_AGENT_HARNESS=claude-code` + default `zai` model +
  scrubbed env → exit 1, stderr contains the friendly `Harness 'claude-code' is incompatible`
  message (the `HarnessProviderMismatchError` text), and stderr does NOT contain a raw
  `at ModuleJob.run` / `Node.js v` stack banner. Use `spawnSync` so module-load ordering is
  exercised for real (in-process vitest would mask it via the groundswell alias + hoisted mocks).

⚠️ **Coverage reality for `src/index.ts` (verified against `coverage/coverage-final.json`):**
`main()` is NOT exported and auto-runs via `void main().catch()`, so no in-process vitest test
calls it. It is exercised ONLY via `spawnSync(dist/index.js, ...)` subprocesses, which do **not**
contribute to the v8 in-process coverage instrumenter. The committed `coverage/` report shows
`src/index.ts` at **0%** (322/322 statements with 0 hits) — i.e. the 100% gate is **NOT currently
green for this file** (the wider suite already has 212 pre-existing failures unrelated to this
delta, per the bugfix PRD Overview). **Implication for implementers:** do NOT chase a phantom
100% on `index.ts`, do NOT add `/* istanbul ignore */` comments, and do NOT block on coverage.
The **authoritative acceptance path is the subprocess `spawnSync` suite** — mirror the existing
`auth-preflight.test.ts` acceptance `(a)` and `logger-teardown.test.ts` patterns. For
`src/agents/agent-factory.ts` (Issue 2 lazy accessor), in-process coverage DOES apply (it's a
normal importable module) — ensure the lazy `resolvedHarness()` accessor and its memoization
branch are covered in-process as usual.

---

## 7. Documentation surface to sync (Mode B — final task)

Cross-cutting docs that describe the preflight/startup ordering or the two CLI modes and will read
stale after this changeset (verified via grep):
- `README.md` — §Configuration (line ~242: "A startup preflight aborts ... if none is present") and
  §Troubleshooting (line ~372: preflight abort description). Add the exemption for local-only modes.
- `docs/CLI_REFERENCE.md` — `--dry-run` (line ~195) / `--validate-prd` (line ~205) semantics;
  note they require no credentials.
- `docs/CONFIGURATION.md` — line ~127 ("validates this at startup and fails fast"); flag table.
- `docs/INSTALLATION.md` — onboarding sequence (validate a PRD before auth).

Per-file JSDoc on the changed symbols (`main()`, `RESOLVED_HARNESS` accessor,
`main().catch()`) → Mode A, updated WITH the implementing subtask (no separate doc subtask).
