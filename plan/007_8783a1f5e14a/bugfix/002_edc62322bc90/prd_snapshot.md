# Bug Fix Requirements

## Overview

Adversarial end-to-end validation of delta session **007 (D1)**, which implemented three PRD
sections against the otherwise-complete pipeline:

1. **PRD §9.6** — Logging Architecture (lazy loggers + synchronous destinations; fix ~10s CLI teardown stall)
2. **PRD §9.2.6** — Provider-Agnostic Authentication Model (default `pi`+`zai`, honoring `~/.pi/agent/auth.json`)
3. **PRD §9.2.7** — Fail-Fast Authentication Preflight (abort at startup before any session/agent work)

### Quality assessment: HIGH

The three core workstreams are **correctly and thoroughly implemented**. Every explicit PRD
acceptance criterion was verified empirically against the **built `dist/`** (not just unit-test
mocks), including non-mocked subprocess verification of the cross-repo Groundswell
`AuthStorage.create()` change. The lazy-logger migration (31 files) is provably complete
(TypeScript-verified: zero missed call sites, zero exported loggers that would break consumers).

The findings below are **narrow edge cases around the *placement* of the preflight**, not defects
in the auth resolution, logging teardown, or cross-repo contract — all of which are solid.

### Verification performed (all PASSED)

| Area | Acceptance criterion | Result |
| --- | --- | --- |
| §9.6.3 | `hack --help`, `-h`, `--version`, invalid flag each return < 2s | ✅ **~560 ms** each (clean env, no auth) |
| §9.6.3 | No top-level `getLogger(...)` in `src/` | ✅ `rg "^(export )?(const\|let) \w+ = getLogger\(" src/` → 0 hits |
| §9.6.3 | No `transport:` key in logger config | ✅ `rg "transport\s*:" src/utils/logger.ts` → 0 hits |
| §9.6.3 | No worker threads spawned; fast teardown | ✅ teardown suite spies `worker_threads.Worker` (not called); 560 ms total vs. the historical ~10 s |
| §9.2.6 | `ZAI_API_KEY`-only succeeds under `pi`+`zai` | ✅ preflight passes, `--dry-run` exits 0 |
| §9.2.6 | `~/.pi/agent/auth.json`-only succeeds (no env vars) | ✅ preflight passes; **non-mocked** `pi-harness-auth.test.ts` resolves the on-disk key against the real deployed `node_modules/groundswell@1.0.1` dist |
| §9.2.6 | Empty/whitespace credential treated as "not configured" | ✅ whitespace `ZAI_API_KEY="   "` → preflight fails |
| §9.2.6 | `ANTHROPIC_AUTH_TOKEN` accepted only for `anthropic` provider | ✅ under default `zai` it is correctly ignored → preflight fails |
| §9.2.6 | `PRP_API_KEY` override = highest precedence | ✅ |
| §9.2.7 | No-credential run → exit 1, **one** actionable message, **no** session dir, **no** agent | ✅ verified exit 1, single message naming harness+provider+model+sources+remediation, and no new `plan/NNN_*` dir created |
| §9.2.7 | `claude-code` harness checks the `anthropic` provider | ✅ with `anthropic/*` model + anthropic cred → proceeds |
| Redaction | API keys / tokens / passwords still redacted after the single-root refactor | ✅ verified in built dist for **both** pretty and JSON paths |
| Child loggers | Inherit parent `correlationId` after refactor | ✅ verified in built dist |
| Cross-repo | Groundswell `pi-harness.ts` uses `AuthStorage.create()` (file-backed) | ✅ live in `node_modules/groundswell/dist` (3 hits) and in `~/projects/groundswell/src` |
| Docs (T4) | `.env.example`, `README.md`, `INSTALLATION.md`, `CONFIGURATION.md` reflect `pi /login`/`ZAI_API_KEY` primary; Anthropic demoted | ✅ no stale "Anthropic-primary" framing found |
| Regression | Lazy-logger migration left no missed call sites | ✅ `tsc --noEmit` clean; full suite grep for `logger is not a function` / `getLogger is not` → **0** hits |

> Note on the wider test suite: the full `npm run test:run` reports 212 failing tests across 31
> files. **None are caused by this delta.** They are pre-existing failures from earlier sessions
> — stale `context_scope` test fixtures (`context_scope must start with "CONTRACT DEFINITION:"`),
> stale mocks (`No "ResearchTimeoutError" export is defined on the mock`), and the `npm link` →
> published-tarball Groundswell tooling migration (`groundswell-linker.test.ts` expects a symlink;
> the install is now a real v1.0.1 tarball). The 9 delta-owned test files pass **171/171**.

---

## Critical Issues (Must Fix)

_None._

---

## Major Issues (Should Fix)

### Issue 1: Auth preflight blocks pure-local CLI modes (`--validate-prd`, `--dry-run`) that make zero API calls

**Severity**: Major

**PRD Reference**: §9.2.7 (preflight placement) vs. §4.x / CLI surface (`--validate-prd`,
`--dry-run`). The PRD's stated *motivation* for the preflight is "a misconfigured credential … is
not detected until the first agent actually calls the model." These two modes never call a model.

**Expected behavior**: `hack --validate-prd PRD.md` and `hack --prd PRD.md --dry-run` should run
without any API credential configured, because they perform only local work:

- `PRDValidator` (`src/utils/prd-validator.ts`) imports **only** the local PRD differ, `fs/promises`,
  and `node:path` — it contains no agent, harness, model, or prompt import. It is a static PRD
  markdown linter.
- `--dry-run` is documented as *"Show plan without executing"* — it prints args and returns 0
  before any pipeline/agent is constructed.

**Actual behavior**: Both modes are gated by `runAuthPreflight()` (and, for the no-credential
case, abort there) because `main()` runs the preflight unconditionally after `configureEnvironment()`
and *before* the `--validate-prd` / `--dry-run` early-return branches:

```ts
// src/index.ts  main()
configureEnvironment();
await runAuthPreflight();          // <-- aborts here with no credential
await ensureHarnessInitialized();
const logger = getLogger('App', {...});
...
if (args.dryRun) { ...; return 0; }
if (args.validatePrd) { ...; return result.valid ? 0 : 1; }
```

Repro (built CLI, scrubbed env, empty auth dir):

```bash
TMP=$(mktemp -d)
env -u ZAI_API_KEY -u PRP_API_KEY -u ANTHROPIC_API_KEY \
    -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_OAUTH_TOKEN \
    PI_CODING_AGENT_DIR="$TMP" \
    node dist/index.js --prd PRD.md --validate-prd
# → exit 1
# ❌ Authentication preflight failed: no credential configured for provider 'zai' ...
# Remediation: pi /login  /  export ZAI_API_KEY=…
```

The same command **succeeds (exit 0, "Status: ✅ VALID")** once any throwaway credential is
present — proving auth is unnecessary for this operation.

**User impact**:

- The failure message actively **misleads** users: it instructs them to run `pi /login` or
  `export ZAI_API_KEY=…`, implying API access is genuinely required to lint a local markdown file.
- It breaks the natural onboarding sequence: a new user writing a `PRD.md` would reasonably run
  `--validate-prd` to check it *before* setting up API access, and is blocked.
- Both flags are documented in `hack --help` (`--validate-prd  Validate PRD and exit without
  running pipeline`).

**Suggested fix**: Move the preflight (and `ensureHarnessInitialized()`) to *after* the
pure-local early-return branches, i.e. gate only paths that actually invoke an agent / construct
`PRPPipeline`. Concretely, in `main()`:

```ts
configureEnvironment();

// Local-only modes that never invoke an agent — run them credential-free.
if (args.dryRun)   { /* print plan */; return 0; }
if (args.validatePrd) { /* validate, print report */; return result.valid ? 0 : 1; }

// Only paths that reach the pipeline need credentials + an initialized harness.
await runAuthPreflight();
await ensureHarnessInitialized();
```

This preserves every §9.2.7 acceptance criterion (the no-credential abort still happens before any
session dir / agent for the agent-invoking paths) while unblocking the two local-only modes.
`--help` / `--version` / `inspect` already short-circuit earlier in `parseCLIArgs()` and are
unaffected.

(If the team prefers to keep the preflight strictly "before everything," an alternative is to
exempt these two flags inside `runAuthPreflight()` — but the cleaner fix is the reordering above,
which matches the PRD's "before any agent run" wording literally.)

---

## Minor Issues (Nice to Fix)

### Issue 2: `claude-code` harness + default `zai` models throws an uncaught raw stack trace at module load (before the preflight / clean error path)

**Severity**: Minor

**PRD Reference**: §9.4.3 (harness↔provider compatibility) interacting with §9.2.7 (fail-fast
clean error). The combination is genuinely invalid (`claude-code` is Anthropic-only), so an error
is correct — but the *form* of the error undermines the fail-fast UX the preflight was added to
provide.

**Expected behavior**: An invalid `PRP_AGENT_HARNESS=claude-code` + default `zai` model
configuration should fail at startup with a single, actionable, human-readable message and exit
code 1 (consistent with the §9.2.7 preflight's error UX).

**Actual behavior**: `configureHarness()` is invoked at **module-evaluation time** via
`src/agents/agent-factory.ts` (`const RESOLVED_HARNESS = configureHarness()`), which is pulled
into `dist/index.js`'s static import graph. When the harness/provider mismatch is detected it
throws `HarnessProviderMismatchError` **before `main()` runs** — so the error is never caught by
`main().catch(...)` and surfaces as an uncaught exception with a raw Node stack trace and the
"Node.js v26.2.0" banner. The auth preflight (which has the clean single-line error handler) is
**unreachable** for this case.

Repro:

```bash
TMP=$(mktemp -d)
env -u ZAI_API_KEY -u PRP_API_KEY -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN \
    PI_CODING_AGENT_DIR="$TMP" PRP_AGENT_HARNESS=claude-code \
    node dist/index.js --prd PRD.md --dry-run
# → exit 1, but printed as:
#   file:///.../dist/config/harness.js:119
#           throw new HarnessProviderMismatchError(harness, resolvedProvider);
#                 ^
#   HarnessProviderMismatchError: Harness 'claude-code' is incompatible with provider 'zai' ...
#       at configureHarness (.../dist/config/harness.js:119:15)
#       at .../dist/agents/agent-factory.js:38:26
#       at ModuleJob.run ...
#   Node.js v26.2.0
```

(The same raw stack trace is printed whether or not a credential is present, because
`configureHarness()` runs before the preflight.)

**User impact**: Low — `claude-code` is the explicitly non-default, second-class harness, and the
configuration is genuinely invalid. But a user who fat-fingers `PRP_AGENT_HARNESS=claude-code`
while keeping default models gets an intimidating stack trace instead of the friendly one-liner
the rest of the startup errors produce.

**Suggested fix (options)**:

1. **Preferred**: move `configureHarness()` out of module-eval scope in `agent-factory.ts` (make it
   lazy, mirroring the REQ-L2 logger pattern), and invoke it explicitly on the `main()` startup
   path *after* `configureEnvironment()` and *before* `runAuthPreflight()`, wrapping it so its
   error renders via the same clean handler as `AuthPreflightError`.
2. Or: add `HarnessProviderMismatchError` to the `main().catch()` handler alongside
   `AuthPreflightError` so that — even if it still throws at module load in some import order — at
   least any path that reaches `main()` renders it cleanly. (This alone won't fix the
   module-load ordering, hence option 1 is preferred.)

---

## Testing Summary

- **Total tests performed**: 27 distinct scenarios across the built CLI, unit/integration suites,
  acceptance greps, type analysis, and non-mocked subprocess verification.
- **Passing**: 25 (all §9.6 logging acceptance, all §9.2.6 auth resolution cases, all §9.2.7
  preflight acceptance, redaction, child-logger inheritance, cross-repo Groundswell fix, docs
  consistency, zero-regression confirmation).
- **Failing (this delta's scope)**: 2 — Issue 1 (Major) and Issue 2 (Minor), both detailed above.
- **Areas with good coverage**:
  - Default `pi`+`zai` auth path end-to-end (override / env / auth.json / empty / wrong-provider).
  - Logging teardown (timing, worker-thread absence, lazy instantiation, single root, redaction,
    child inheritance) — verified on the built dist.
  - Fail-fast preflight abort (exit 1, single message, no session dir, no agent).
  - Cross-repo Groundswell `auth.json` honoring — verified non-mocked.
- **Areas needing more attention**:
  - Preflight *placement* relative to local-only CLI modes (Issue 1).
  - Clean error rendering for harness/provider mismatch (Issue 2).
  - (Out of scope but noted) The 212 pre-existing failing tests in the wider suite are unrelated to
    this delta and should be addressed separately (stale fixtures/mocks, `npm link`→tarball
    tooling migration).
