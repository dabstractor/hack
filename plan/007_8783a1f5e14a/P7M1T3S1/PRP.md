---
name: "P7.M1.T3.S1 — Wire the fail-fast auth preflight onto the startup path"
description: |
  Add `runAuthPreflight()` (src/config/harness.ts) + `AuthPreflightError` (src/config/types.ts) and invoke
  `await runAuthPreflight()` in `src/index.ts` `main()` AFTER `configureEnvironment()` and BEFORE
  `ensureHarnessInitialized()` / `new PRPPipeline(...)` (PRD §9.2.7 / architecture/implementation_notes.md
  §T3.S1). The preflight resolves the selected harness + provider/model and verifies ≥1 auth source for
  that provider: (1) hacky-hack override/env via the DONE T2.S1 `resolveApiKeyForProvider(provider)` (which
  `.trim()`s — empty/whitespace == "not configured"); (2) pi's file-backed `AuthStorage.create()
  .getAuthStatus(provider).configured` (the SAME resolver the harness uses at runtime — auth.json).
  CRITICAL empirical fact: `AuthStorage.hasAuth()` is TOO LENIENT (returns `true` for whitespace-only env),
  so the auth.json half uses `getAuthStatus(provider).configured` (which is `false` for the `environment`
  source and `true` only for a stored/runtime/fallback credential). `claude-code` harness → check the
  `anthropic` credential (Anthropic-only). On failure: throw `AuthPreflightError` (ONE actionable message
  naming harness+provider/model, every empty source, the exact remediation); `main()` prints it + exit 1 —
  NO session dir created, NO agent invoked. [Mode A] JSDoc on `runAuthPreflight()`; add a troubleshooting
  subsection + refresh the env/auth framing in `docs/INSTALLATION.md`. Coverage-sufficient test
  `tests/unit/config/auth-preflight.test.ts` (T3.S2 owns the full acceptance matrix).
---

## Goal

**Feature Goal**: A misconfigured credential aborts the pipeline at startup — immediately after
`configureEnvironment()`, before any session directory is created or any agent is invoked — with a
single actionable error message and exit code 1. This replaces today's behavior where a missing
credential surfaces as a deep, misleading error (`Pi agent execution failed: No API key found for zai.`)
inside `decomposePRD`, after a session dir + `ERROR_REPORT.md` are already written.

**Deliverable**:
1. **`src/config/types.ts` (MODIFIED)** — add the `AuthPreflightError` class (mirrors the existing
   `HarnessProviderMismatchError` pattern: structured fields `{ harness, provider, model }`, builds the
   PRD §9.2.7 actionable message in its constructor).
2. **`src/config/harness.ts` (MODIFIED)** — add the exported `async function runAuthPreflight():
   Promise<void>` (alongside `ensureHarnessInitialized` + `resolveApiKeyForProvider`). It reuses the
   DONE T2.S1 resolver + pi's `AuthStorage.create().getAuthStatus(provider).configured`; throws
   `AuthPreflightError` on failure. Add `import { AuthStorage } from '@earendil-works/pi-coding-agent'`
   + `import { getModel } from './environment.js'`.
3. **`src/index.ts` (MODIFIED)** — invoke `await runAuthPreflight()` between `configureEnvironment()`
   (L113) and `ensureHarnessInitialized()` (L118); update the top-level `.catch()` to detect
   `AuthPreflightError` and print ONE clean message + `process.exit(1)`.
4. **`tests/unit/config/auth-preflight.test.ts` (NEW)** — coverage-sufficient suite (success-via-env,
   success-via-auth.json, failure-throws-`AuthPreflightError`, claude-code branch). Keeps the 100% gate
   green; T3.S2 owns the full acceptance matrix.
5. **`docs/INSTALLATION.md` (MODIFIED — Mode A)** — add a troubleshooting subsection for the preflight
   failure mode + remediation; refresh Quick Start step 4 + the env-var table so `pi /login` /
   `ZAI_API_KEY` is the documented primary path and `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY` are
   demoted to optional `anthropic`-provider aliases.

**Success Definition** (maps to PRD §9.2.7 acceptance + the work-item OUTPUT contract):
- A run with **no** credential for the selected provider aborts at startup with ONE actionable message
  and exit code `1` — **no** session directory is created, **no** agent is invoked.
- A run authenticated via `~/.pi/agent/auth.json` alone (no env) proceeds under the `pi` + `zai` default.
- A run authenticated via `ZAI_API_KEY` alone proceeds under the `pi` + `zai` default.
- A whitespace-only `ZAI_API_KEY`/`PRP_API_KEY` is treated as "not configured" (aborts).
- `claude-code` harness verifies an Anthropic credential.
- `npm run validate` passes; `npm run test:coverage` stays at 100% on `src/**` (new branches covered).

## User Persona (if applicable)

**Target User**: Every `hack` user — especially a new installer who ran `pi /login` (or set `ZAI_API_KEY`)
and hit the opaque `No API key found for zai.` deep failure on their first run.

**Use Case**: A user with a misconfigured credential runs `hack run PRD.md`. Today this fails deep inside
`decomposePRD` after a session dir + ERROR_REPORT.md are created (misleading, costly). After T3.S1 it
fails at startup with: the selected harness+provider/model, every empty source checked, and the exact
remediation command.

**User Journey**: `hack run PRD.md` → `parseCLIArgs()` → `setupGlobalHandlers()` → `configureEnvironment()`
→ **`runAuthPreflight()`** (NEW) → [no credential? → `AuthPreflightError` → clean message → exit 1,
  no session dir] OR [credential present → `ensureHarnessInitialized()` → `new PRPPipeline(...).run()`].

**Pain Points Addressed**: PRD §9.2.7 problem — `validateEnvironment()` exists but is never on the startup
path (only `scripts/validate-api.ts`); the single most common install failure (a bad credential) is not
detected until the first agent calls the model.

## Why

- **Business value**: This is the fail-fast half of the auth workstream (T2.S1 → T3.S1 → T3.S2). T2.S1
  stopped forwarding fake/empty credentials and made `pi`+`zai` work with `pi /login`/`ZAI_API_KEY`; T3.S1
  makes a genuinely-missing credential visible at the earliest possible moment, with an actionable fix.
- **Integration with existing features**: Consumes the DONE T2.S1 resolver (`resolveApiKeyForProvider`,
  `getResolvedProvider`, `getModel`) + the DONE T2.S2 file-backed `AuthStorage` (honors
  `~/.pi/agent/auth.json`). The preflight uses `AuthStorage.create().getAuthStatus(provider)` — the SAME
  resolver the `pi` harness uses at runtime — so it is drift-proof (no hand-rolled `~/.pi/agent/auth.json`
  reader that can diverge from pi).
- **Problems solved / for whom**: For every installer — the opaque deep failure becomes a one-line,
  copy-pasteable fix. For maintainers — fewer "why did it create a session dir then crash?" reports.

## What

User-visible behavior: a misconfigured credential no longer reaches the agent layer; it aborts at startup
with a single actionable message. Internally, `runAuthPreflight()` is a thin gate on `main()`'s startup
path that combines two checks: the hacky-hack resolver (override/env, empty-string-safe) and pi's
file-backed `AuthStorage.getAuthStatus().configured` (auth.json).

### Success Criteria

- [ ] `runAuthPreflight()` is exported from `src/config/harness.ts` and invoked in `main()` after
      `configureEnvironment()` and before `ensureHarnessInitialized()`.
- [ ] No-credential run aborts with `AuthPreflightError` → `main()` prints ONE message + `exit 1`.
- [ ] `auth.json`-only run (no env) proceeds (T3.S1 unit test proves the predicate passes).
- [ ] `ZAI_API_KEY`-only run proceeds (resolver short-circuits).
- [ ] Whitespace-only `ZAI_API_KEY`/`PRP_API_KEY` aborts (empty-string policy).
- [ ] `claude-code` harness checks the `anthropic` credential.
- [ ] The failure message names: selected harness + provider/model; every empty source (override
      `PRP_API_KEY`, the provider env-var name e.g. `ZAI_API_KEY`, the `~/.pi/agent/auth.json` path);
      the exact remediation (`pi /login` or `export ZAI_API_KEY=…`).
- [ ] `npm run validate` passes; `npm run test:coverage` 100% on `src/**`.

## All Needed Context

### Context Completeness Check

If someone knew nothing about this codebase, would they have everything needed? **Yes.** The
authoritative contract is `architecture/implementation_notes.md §T3.S1` (the exact insertion point + the
preflight predicate + the harness-specific check). The load-bearing empirical finding — that
`AuthStorage.hasAuth()` is too lenient (passes whitespace env) and `getAuthStatus().configured` is the
correct gate — is in `research/verified_facts.md §3` with the full 6-row probe matrix. The DONE T2.S1
resolver/forwarding contract is quoted verbatim in §2. The AuthStorage API surface + the
`PI_CODING_AGENT_DIR` test-isolation requirement are in §4/§8. The files to edit are listed under
Deliverable. The PRD binding is §9.2.7 (primary) + §9.2.6.

### Documentation & References

```yaml
# MUST READ — authoritative, file-level contract for this exact subtask
- file: plan/007_8783a1f5e14a/architecture/implementation_notes.md
  why: "§T3.S1 is the verbatim contract — the insertion point (`configureEnvironment();
        await runAuthPreflight(); await ensureHarnessInitialized();`), the preflight predicate
        (`AuthStorage.hasAuth`/`getAuthStatus` — the SAME resolver the harness uses at runtime),
        the claude-code → anthropic check, the empty/whitespace policy, and the failure message contents."
  section: "T3 — Fail-Fast Authentication Preflight → T3.S1"
  critical: "It says use AuthStorage.hasAuth/getAuthStatus. EMPIRICALLY (verified_facts §3) hasAuth is
             too lenient (whitespace env → true); the correct auth.json gate is
             `getAuthStatus(provider).configured`. Use that."

# MUST READ — every load-bearing empirical finding (the 6-row hasAuth/getAuthStatus matrix,
# the import path, the test-isolation requirement, the stale INSTALLATION.md, the main() line numbers)
- file: plan/007_8783a1f5e14a/P7M1T3S1/research/verified_facts.md
  why: "§1 the exact main() line numbers + that the preflight runs before the logger exists (use console);
        §2 the DONE T2.S1 resolver verbatim (consume, don't reimplement); §3 THE critical finding —
        hasAuth vs getAuthStatus().configured + the verified correct predicate; §4 AuthStorage import +
        API surface + missing-file tolerance; §5 harness/provider/model resolution; §6 the error pattern;
        §7 main() catch handling + no-logger-at-preflight; §8 PI_CODING_AGENT_DIR test isolation;
        §9 the test pattern; §10 coverage + T3.S1/T3.S2 boundary; §11 the stale INSTALLATION.md; §12/§13
        validation commands + acceptance greps."
  section: "§1–§14 (read all)"

# MUST READ — the pi-side AuthStorage/AuthStatus API surface (verbatim from node_modules .d.ts)
- file: plan/007_8783a1f5e14a/architecture/groundswell_auth_api.md
  why: "§2 AuthStorage class (create/inMemory/hasAuth/getAuthStatus/getApiKey), the AuthStatus shape
        {configured; source?: 'stored'|'runtime'|'environment'|'fallback'|...}, the getApiKey() priority
        (runtime → auth.json api_key → oauth → env → fallback), missing-file tolerance; §6 getAgentDir()
        = ~/.pi/agent overridable via PI_CODING_AGENT_DIR."
  section: "§2, §6"
  critical: "getAuthStatus(provider).configured is the gate (NOT hasAuth). AuthStatus.source='stored' is
             auth.json api_key; source='environment' is the env var (configured=false). AuthStorage.create()
             does NOT throw on a missing auth.json."

# MUST READ — the PRD requirement being satisfied (binding)
- file: PRD.md
  why: "§9.2.7 is the requirement (preflight after configureEnvironment before any agent run; failure
        aborts with harness+provider/model + every empty source + exact remediation; empty/whitespace ==
        not configured; claude-code → anthropic; acceptance: auth.json-only succeeds, ZAI-only succeeds,
        AUTH_TOKEN succeeds only under anthropic). §9.2.6 is the auth model the predicate mirrors."
  section: "9.2.7 (primary), 9.2.6 (auth resolution order)"

# MUST READ — the files under edit
- file: src/config/harness.ts
  why: "Add runAuthPreflight() alongside ensureHarnessInitialized() + resolveApiKeyForProvider(). Reuse
        the SHIPPED resolveApiKeyForProvider + getResolvedProvider; add getModel import + AuthStorage import."
  pattern: "resolveApiKeyForProvider (the resolver) + ensureHarnessInitialized (the runtime forwarder) are
            the exact functions whose contract runAuthPreflight mirrors. Follow their JSDoc + naming style."
  gotcha: "Do NOT reimplement the resolver or read ~/.pi/agent/auth.json by hand — that drifts from pi.
           Use AuthStorage.create().getAuthStatus(provider).configured for the auth.json half."
- file: src/config/types.ts
  why: "Add AuthPreflightError. Mirror HarnessProviderMismatchError EXACTLY (structured fields →
        actionable message built in the constructor; `this.name='AuthPreflightError'`)."
  pattern: "class X extends Error { readonly fields...; constructor(fields){ super(msg); this.name=... } }."
- file: src/index.ts
  why: "Insert `await runAuthPreflight()` between configureEnvironment() (L113) and
        ensureHarnessInitialized() (L118); update the top-level .catch() (L~226) to detect
        AuthPreflightError → console.error(`\\n❌ ${err.message}`) + process.exit(1)."
  gotcha: "The root logger is created at L121 (AFTER the preflight) → use console.error in main()'s
           handler, NOT a logger (sidesteps PRD §9.6 lazy-logger rules). Import AuthPreflightError at the
           top of index.ts (a class import is fine; REQ-L2 only restricts getLogger())."

# MUST READ — the PATTERN to follow for the test (groundswell mock + temp-dir isolation)
- file: tests/unit/config/harness-provider-compat.test.ts
  why: "The established vi.mock('groundswell', factory) pattern (harness.ts imports groundswell → the mock
        is REQUIRED to import harness.ts). beforeEach: vi.clearAllMocks() + delete/stub env;
        afterEach: vi.unstubAllEnvs()."
  pattern: "Module-level vi.mock('groundswell', () => ({ configureHarnesses: vi.fn(), HarnessRegistry:
            { getInstance: () => ({ has: () => false, register: vi.fn() }) }, PiHarness: class {} }))."

# MUST READ — the INPUT PRP (the resolver/forwarding contract T3.S1 consumes)
- file: plan/007_8783a1f5e14a/P7M1T2S1/PRP.md
  why: "Defines resolveApiKeyForProvider priority + the 'forward only when non-empty' rule + getResolvedProvider
        + getModel. T3.S1 consumes these EXACT exports (DONE/shipped)."
# MUST READ — the PARALLEL PRP (T3.S1 runs while T2.S3 implements; T2.S3 added the devDep T3.S1 imports)
- file: plan/007_8783a1f5e14a/P7M1T2S3/PRP.md
  why: "T2.S3 (implementing in parallel) added `@earendil-works/pi-coding-agent` as a devDep (^0.79.8) for
        its AuthStorage test import. T3.S1 imports AuthStorage in src/ from the SAME package. Confirm it
        resolves; if a package.json edit is needed, keep ONE entry (prefer `dependencies`)."

# REFERENCE — the pi-side AuthStorage type defs (confirm before asserting against them)
- file: node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.d.ts
  why: "Confirm getAuthStatus(provider): AuthStatus + AuthStatus = {configured:boolean; source?; label?}
        and AuthStorage.create(authPath?) signatures before coding the predicate."

# REFERENCE — vitest config (the coverage gate contract)
- file: vitest.config.ts
  why: "coverage 100% on src/** (test files excluded). Every runAuthPreflight branch (override/env early
        return; auth.json early return; failure throw; claude-code provider swap) must be hit."
```

### Current Codebase tree (relevant slice)

```bash
src/
  index.ts               # ← EDIT: insert `await runAuthPreflight()` L113→L118; update top-level .catch()
  config/
    harness.ts           # ← EDIT: add runAuthPreflight(); add AuthStorage + getModel imports
    types.ts             # ← EDIT: add AuthPreflightError class
    environment.ts       # READ — getResolvedProvider() + getModel() (DONE T2.S1; consume)
    constants.ts         # READ — PRP_AGENT_HARNESS, DEFAULT_HARNESS, PRP_API_KEY (exist; no edit)
    endpoint-guard.ts    # READ ONLY (§9.2.4 safeguard — must stay intact/green)
tests/
  setup.ts               # READ — dotenv.config() pollutes env; clear auth vars per test
  unit/config/
    auth-preflight.test.ts            # ← NEW (coverage-sufficient; T3.S2 owns the acceptance matrix)
    harness-provider-compat.test.ts   # REFERENCE pattern (vi.mock('groundswell') + env stubbing)
    environment.test.ts               # REFERENCE pattern (vi.stubEnv / afterEach)
docs/
  INSTALLATION.md        # ← EDIT (Mode A): preflight troubleshooting + refresh env/auth framing
plan/007_8783a1f5e14a/
  architecture/implementation_notes.md   # §T3.S1 — authoritative contract
  architecture/groundswell_auth_api.md   # §2/§6 — AuthStorage/AuthStatus/getAgentDir API
  P7M1T2S1/PRP.md                        # INPUT resolver contract (DONE)
  P7M1T2S3/PRP.md                        # parallel — added the devDep T3.S1 imports
  P7M1T3S1/research/verified_facts.md    # every empirical finding
  P7M1T3S1/PRP.md                        # this file
```

### Desired Codebase tree with files added and changed

```bash
src/config/types.ts                    # MODIFIED — +AuthPreflightError
src/config/harness.ts                  # MODIFIED — +runAuthPreflight() (exported, async); +AuthStorage/getModel imports
src/index.ts                           # MODIFIED — invoke runAuthPreflight(); handle AuthPreflightError in .catch()
tests/unit/config/auth-preflight.test.ts # NEW      — coverage-sufficient preflight suite
docs/INSTALLATION.md                   # MODIFIED (Mode A) — preflight troubleshooting + env/auth framing
# (PRD.md, tasks.json, prd_snapshot.md, .gitignore — READ ONLY, never touch)
# Optional: package.json — promote @earendil-works/pi-coding-agent to dependencies IF a direct src/ import
#           requires it (it resolves as the existing devDep; see Gotchas).
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — AuthStorage.hasAuth() is TOO LENIENT. Probed empirically (verified_facts §3): for a
// WHITESPACE-ONLY ZAI_API_KEY='   ', hasAuth('zai') returns TRUE (it only checks "does the source exist",
// not "is it non-empty"). Using hasAuth would violate PRD §9.2.7 (whitespace == not configured).
// The CORRECT auth.json gate is `AuthStorage.create().getAuthStatus(provider).configured` — which is
// `false` for the `environment` source (rows 3/4/6) and `true` ONLY for a resolvable
// stored/runtime/fallback credential (row 2: source='stored', configured=true).
// So the predicate is:
//   if (resolveApiKeyForProvider(provider)) return;                                  // override/env (trimmed)
//   if (AuthStorage.create().getAuthStatus(provider).configured) return;             // auth.json
//   throw new AuthPreflightError({ harness, provider, model });

// CRITICAL — AuthStorage is NOT re-exported by groundswell (grep node_modules/groundswell/dist/index.d.ts
// → 0 hits). Import it from '@earendil-works/pi-coding-agent'. That package is ALREADY a devDep (^0.79.8,
// added by the parallel T2.S3) and resolves from root under NodeNext ESM
// (node --input-type=module -e "import('@earendil-works/pi-coding-agent')..." → AuthStorage.create=function).
// hacky-hack is a local CLI → devDeps are always present locally; AND pi-coding-agent is a transitive
// RUNTIME dep via groundswell's PiHarness.initialize() `await import(...)`. So the src/ import works.
// OPTIONAL correctness: promote it to `dependencies` (keep ONE package.json entry; do not duplicate).
// VERIFY before coding: node --input-type=module -e "import('@earendil-works/pi-coding-agent')
//   .then(m=>console.log(typeof m.AuthStorage?.create, typeof m.AuthStorage?.inMemory))"
// → 'function function'.

// CRITICAL — TEST ISOLATION. AuthStorage.create() reads the developer's REAL ~/.pi/agent/auth.json
// unless PI_CODING_AGENT_DIR is overridden. On the dev machine a real auth.json likely EXISTS → a
// "no-credential" test would WRONGLY pass (find a stored credential). EVERY preflight test MUST:
//   beforeEach: mkdtempSync(tmpdir()/'preflight-') → vi.stubEnv('PI_CODING_AGENT_DIR', tmp) → clear auth env.
//   afterEach:  vi.unstubAllEnvs(); rmSync(tmp,{recursive:true,force:true}).
// ALSO clear ZAI_API_KEY/ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN/ANTHROPIC_OAUTH_TOKEN/PRP_API_KEY/
// ANTHROPIC_DEFAULT_SONNET_MODEL in beforeEach — tests/setup.ts runs dotenv.config() (pollutes from .env).

// CRITICAL — runAuthPreflight runs BEFORE the root logger exists (logger created at src/index.ts:121,
// AFTER the preflight's insertion point between L113 and L118). Use console.error in main()'s handler,
// NOT a logger. (Sidesteps PRD §9.6 lazy-logger rules — no logger is constructed.)

// CRITICAL — Read the harness id DIRECTLY from env (`process.env[PRP_AGENT_HARNESS] ?? DEFAULT_HARNESS`),
// NOT via configureHarness(). configureHarness() is called lazily at module-load in agent-factory.ts,
// NOT in main(); its timing is not guaranteed at preflight time. The preflight must be independent.

// GOTCHA — claude-code is Anthropic-only. For that harness, check the 'anthropic' credential regardless
// of the resolved model: `checkProvider = harness === 'claude-code' ? 'anthropic' : getResolvedProvider()`.
// (A claude-code + zai model mismatch is a SEPARATE error caught later by configureHarness() →
//  HarnessProviderMismatchError; NOT the preflight's job.)

// GOTCHA — getAuthStatus()/hasAuth() are SYNC (return directly). Only getApiKey() is async. So the
// AuthStorage half of runAuthPreflight is sync. Make runAuthPreflight `async` ONLY to match the
// architecture sketch's `await runAuthPreflight()` (await on a sync value is a no-op); or make it sync
// and drop the await — either is fine, but `async` matches the documented contract.

// GOTCHA — AuthStorage.create() is missing-file tolerant (constructor reload() catches into loadError;
// does NOT throw when ~/.pi/agent/auth.json is absent). Safe to construct unconditionally.

// GOTCHA — AuthPreflightError must build the PRD §9.2.7 message in its constructor (mirror
// HarnessProviderMismatchError). The message MUST name: the selected harness + provider/model; EVERY
// empty source checked (override PRP_API_KEY; the provider env-var name — zai→ZAI_API_KEY,
// anthropic→ANTHROPIC_API_KEY/ANTHROPIC_OAUTH_TOKEN; the ~/.pi/agent/auth.json path); the exact
// remediation (`pi /login` or `export ZAI_API_KEY=…`). ONE message, exit 1.

// GOTCHA — coverage gate is 100% on src/** (vitest.config.ts). Every runAuthPreflight branch must be hit:
// (a) override/env non-empty → early return; (b) auth.json configured → early return; (c) nothing → throw;
// (d) claude-code → anthropic swap. T3.S1 ships a COVERAGE-SUFFICIENT suite; T3.S2 owns the full
// acceptance matrix — do NOT duplicate T3.S2's cases (no-session-dir integration test, etc.).

// GOTCHA — Do NOT modify or remove validateEnvironment() (src/config/environment.ts). It is NOT on the
// startup path (only scripts/validate-api.ts:154 calls it) but is kept for back-compat. The preflight
// REPLACES its (missing) startup role without touching it.

// GOTCHA — docs/INSTALLATION.md is STALE (still says ANTHROPIC_AUTH_TOKEN | Yes / `export
// ANTHROPIC_AUTH_TOKEN=...` as the documented flow). Post-T2.S1+T3.S1 the primary path is pi /login /
// ZAI_API_KEY. Mode A: add a preflight troubleshooting subsection + refresh Quick Start step 4 + the
// env table. Do NOT touch README.md (Mode B, owned by T4.S1).
```

## Implementation Blueprint

### Data models and structure

No persistence/data-model changes. The new shapes are one error class + one gate function:

```ts
// ===== src/config/types.ts =====
/**
 * Error thrown by the fail-fast auth preflight when no credential is configured for the
 * selected harness + provider/model (PRD §9.2.7).
 *
 * @remarks
 * Thrown by {@link runAuthPreflight} (src/config/harness.ts) when neither the hacky-hack
 * resolver (override/env) NOR pi's file-backed AuthStorage (~/.pi/agent/auth.json) resolves a
 * credential for the provider of the resolved model. The pipeline aborts at startup — before any
 * session directory is created or any agent is invoked.
 *
 * The message names: the selected harness + provider/model; every empty source checked
 * (override `PRP_API_KEY`, the provider env-var name, the `~/.pi/agent/auth.json` path); and the
 * exact remediation.
 *
 * @example
 * ```ts
 * import { AuthPreflightError } from './config/types.js';
 *
 * throw new AuthPreflightError({ harness: 'pi', provider: 'zai', model: 'zai/glm-5.2' });
 * ```
 */
export class AuthPreflightError extends Error {
  /** The selected agent harness id (e.g. 'pi', 'claude-code'). */
  readonly harness: string;
  /** The provider whose credential was missing (e.g. 'zai', 'anthropic'). */
  readonly provider: string;
  /** The resolved provider/model string (e.g. 'zai/glm-5.2'). */
  readonly model: string;

  constructor(opts: { harness: string; provider: string; model: string }) {
    super(buildPreflightMessage(opts));
    this.name = 'AuthPreflightError';
    this.harness = opts.harness;
    this.provider = opts.provider;
    this.model = opts.model;
  }
}

/**
 * Build the PRD §9.2.7 actionable preflight failure message.
 * (Module-local helper; exported only if tests need it. Pure — no process.env reads beyond the
 *  provider→env-var-name mapping.)
 */
function buildPreflightMessage(opts: {
  harness: string;
  provider: string;
  model: string;
}): string {
  const { harness, provider, model } = opts;
  const envVars =
    provider === 'anthropic'
      ? 'ANTHROPIC_API_KEY / ANTHROPIC_OAUTH_TOKEN'
      : provider === 'zai'
        ? 'ZAI_API_KEY'
        : `${provider.toUpperCase()}_API_KEY`;
  const authPath = process.env.PI_CODING_AGENT_DIR
    ? `${process.env.PI_CODING_AGENT_DIR}/auth.json`
    : '~/.pi/agent/auth.json';
  const exportCmd =
    provider === 'anthropic'
      ? 'export ANTHROPIC_API_KEY=<your-key>'
      : `export ${provider === 'zai' ? 'ZAI_API_KEY' : `${provider.toUpperCase()}_API_KEY`}=<your-key>`;
  return (
    `Authentication preflight failed: no credential configured for provider '${provider}' ` +
    `(harness '${harness}', model '${model}').\n\n` +
    `Checked sources (all empty):\n` +
    `  • Override:     PRP_API_KEY\n` +
    `  • Environment:  ${envVars}\n` +
    `  • pi auth.json: ${authPath}\n\n` +
    `Remediation (pick one):\n` +
    `  • pi /login                       # writes ${authPath}\n` +
    `  • ${exportCmd}   # provider-native env var`
  );
}
```

```ts
// ===== src/config/harness.ts (ADD — alongside ensureHarnessInitialized) =====
import { AuthStorage } from '@earendil-works/pi-coding-agent';
import { getModel, getResolvedProvider } from './environment.js';
import { DEFAULT_HARNESS, PRP_AGENT_HARNESS } from './constants.js';
import { AuthPreflightError } from './types.js';

/**
 * Run the fail-fast auth preflight (PRD §9.2.7).
 *
 * @remarks
 * Invoked in `main()` AFTER {@link configureEnvironment} and BEFORE
 * {@link ensureHarnessInitialized} / `new PRPPipeline(...)`. Resolves the selected
 * harness + provider/model and verifies that at least one auth source (PRD §9.2.6) is
 * available for that provider:
 *   1. hacky-hack override/env — {@link resolveApiKeyForProvider} (trims; empty/whitespace
 *      == "not configured").
 *   2. pi's file-backed `AuthStorage.create()` — `getAuthStatus(provider).configured` (the
 *      SAME resolver the `pi` harness uses at runtime; honors `~/.pi/agent/auth.json`).
 *
 * For the `claude-code` harness the check targets the `anthropic` provider (that harness is
 * Anthropic-only). On failure, throws {@link AuthPreflightError} — the pipeline then aborts
 * at startup with exit code 1, BEFORE any session directory is created or any agent is invoked.
 *
 * @throws {AuthPreflightError} When no credential is resolvable for the selected provider.
 *
 * @example
 * ```ts
 * import { runAuthPreflight } from './config/harness.js';
 *
 * configureEnvironment();
 * await runAuthPreflight();        // throws AuthPreflightError if misconfigured
 * await ensureHarnessInitialized();
 * ```
 */
export async function runAuthPreflight(): Promise<void> {
  const harness = process.env[PRP_AGENT_HARNESS] ?? DEFAULT_HARNESS;
  const model = getModel('sonnet');
  const provider = harness === 'claude-code' ? 'anthropic' : getResolvedProvider();

  // Source 1+2: hacky-hack override/env (empty/whitespace == not configured via .trim()).
  if (resolveApiKeyForProvider(provider)) {
    return; // configured
  }

  // Source 3: pi file-backed AuthStorage — auth.json (SAME resolver the harness uses at runtime).
  // getAuthStatus().configured is false for the env source (incl. whitespace) and true only for a
  // stored/runtime/fallback credential — so whitespace env does NOT pass here.
  const authStatus = AuthStorage.create().getAuthStatus(provider);
  if (authStatus.configured) {
    return; // configured (auth.json)
  }

  throw new AuthPreflightError({ harness, provider, model });
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY the AuthStorage import resolves (gate the preflight)
  - RUN: node --input-type=module -e "import('@earendil-works/pi-coding-agent')
      .then(m=>console.log(typeof m.AuthStorage?.create, typeof m.AuthStorage?.inMemory))
      .catch(e=>console.log('FAIL',e.code))"
  - EXPECT: 'function function'. (The package is a devDep ^0.79.8 added by parallel T2.S3 + a transitive
    runtime dep via groundswell's PiHarness.) If 'FAIL ERR_MODULE_NOT_FOUND' → add/promote
    "@earendil-works/pi-coding-agent" in package.json (prefer `dependencies`; keep ONE entry) + npm install.
  - VERIFY getAuthStatus/getAuthStatus type: read node_modules/@earendil-works/pi-coding-agent/dist/core/
    auth-storage.d.ts (hasAuth(provider):boolean; getAuthStatus(provider):AuthStatus;
    AuthStatus={configured:boolean; source?:...; label?}).
  - DEPENDENCY: T2.S3 settled (the devDep exists). T2.S1 DONE (resolver shipped).

Task 1: ADD AuthPreflightError to src/config/types.ts
  - ADD the AuthPreflightError class + the module-local buildPreflightMessage(opts) helper (see Data models).
  - FOLLOW pattern: HarnessProviderMismatchError (structured fields → actionable message in the ctor;
    `this.name='AuthPreflightError'`). Place it right after HarnessProviderMismatchError.
  - NAMING: `AuthPreflightError`; readonly fields `harness`, `provider`, `model`.
  - MESSAGE contents (PRD §9.2.7): selected harness+provider/model; the 3 empty sources (PRP_API_KEY;
    provider env-var name — zai→ZAI_API_KEY, anthropic→ANTHROPIC_API_KEY/ANTHROPIC_OAUTH_TOKEN;
    ~/.pi/agent/auth.json or $PI_CODING_AGENT_DIR/auth.json); the 2 remediation commands (pi /login;
    export <PROVIDER>_API_KEY=…).
  - DEPENDENCY: none (pure module; no circular import — types.ts imports nothing from harness.ts).

Task 2: ADD runAuthPreflight() to src/config/harness.ts
  - ADD imports: `import { AuthStorage } from '@earendil-works/pi-coding-agent';`,
    `import { getModel, getResolvedProvider } from './environment.js';` (getResolvedProvider already
    imported — extend the existing import), `import { DEFAULT_HARNESS, PRP_AGENT_HARNESS } from
    './constants.js';` (PRP_API_KEY already imported), `import { AuthPreflightError } from './types.js';`
    (HarnessProviderMismatchError already imported from types — extend if combined).
  - ADD: the exported `async function runAuthPreflight(): Promise<void>` (see Data models). Place it right
    after ensureHarnessInitialized(). Add the full JSDoc (PRD §9.2.7; insertion point; the two sources;
    claude-code → anthropic; empty/whitespace policy; throws AuthPreflightError).
  - PREDICATE (exact — verified_facts §3):
      const harness = process.env[PRP_AGENT_HARNESS] ?? DEFAULT_HARNESS;
      const model = getModel('sonnet');
      const provider = harness === 'claude-code' ? 'anthropic' : getResolvedProvider();
      if (resolveApiKeyForProvider(provider)) return;                              // override/env
      if (AuthStorage.create().getAuthStatus(provider).configured) return;         // auth.json
      throw new AuthPreflightError({ harness, provider, model });
  - DO NOT reimplement resolveApiKeyForProvider / getResolvedProvider / getModel (DONE T2.S1).
  - DO NOT read ~/.pi/agent/auth.json by hand (drifts from pi — use AuthStorage.create()).
  - DEPENDENCY: Task 1 (AuthPreflightError).

Task 3: WIRE runAuthPreflight() into src/index.ts main() + handle AuthPreflightError
  - ADD import: `import { AuthPreflightError } from './config/types.js';` at the top
    (and ensure runAuthPreflight is added to the existing `import { ensureHarnessInitialized } from
    './config/harness.js';` line).
  - INSERT `await runAuthPreflight();` BETWEEN `configureEnvironment();` (L113) and
    `await ensureHarnessInitialized();` (L118). Exact result:
        configureEnvironment();
        await runAuthPreflight();      // NEW — abort here if no credential (PRD §9.2.7)
        await ensureHarnessInitialized();
  - UPDATE the top-level handler (src/index.ts ~L226 `void main().catch((error) => {...})`) to detect
    AuthPreflightError and print ONE clean message + exit 1; fall through to the existing handler for all
    other errors:
        void main().catch((error: unknown) => {
          if (error instanceof AuthPreflightError) {
            console.error(`\n❌ ${error.message}`);   // ONE actionable message (PRD §9.2.7)
            process.exit(1);
          }
          console.error('\n❌ Fatal error in main():', error);
          process.exit(1);
        });
  - WHY console.error (not a logger): the root logger is created at L121, AFTER the preflight — no logger
    exists at preflight time. This sidesteps PRD §9.6 lazy-logger rules.
  - DEPENDENCY: Tasks 1–2.

Task 4: CREATE tests/unit/config/auth-preflight.test.ts (coverage-sufficient)
  - FOLLOW pattern: tests/unit/config/harness-provider-compat.test.ts (vi.mock('groundswell', factory) +
    env stubbing) + tests/unit/config/environment.test.ts (vi.stubEnv / afterEach vi.unstubAllEnvs).
  - SCAFFOLDING (see Data models §test below): module-level `vi.mock('groundswell', () => ({...}))`;
    AUTH_VARS clearAuthEnv() helper; a temp-dir `PI_CODING_AGENT_DIR` beforeEach/afterEach (MANDATORY —
    verified_facts §8).
  - describe('runAuthPreflight'):
      * it('proceeds when ZAI_API_KEY is set (override/env path)') — stub ZAI_API_KEY; expect
        runAuthPreflight() to resolve (not throw). [covers the resolveApiKeyForProvider early-return]
      * it('proceeds when only ~/.pi/agent/auth.json is present (auth.json path)') — clear env; write a
        seeded auth.json ({zai:{type:'api_key',key:'k'}}) into the temp PI_CODING_AGENT_DIR; expect
        runAuthPreflight() to resolve. [covers the getAuthStatus().configured early-return — PRD §9.2.7
        auth.json-only acceptance]
      * it('throws AuthPreflightError when no credential is configured') — clear env; NO auth.json;
        expect(runAuthPreflight()).rejects.toThrow(AuthPreflightError); assert the message names harness
        'pi', provider 'zai', model 'zai/glm-5.2', 'ZAI_API_KEY', '~/.pi/agent/auth.json'/'pi /login'.
        [covers the throw branch]
      * it('treats whitespace-only ZAI_API_KEY as not configured (aborts)') — stub ZAI_API_KEY='   ';
        NO auth.json; expect rejects.toThrow(AuthPreflightError). [proves the empty-string policy — hasAuth
        would wrongly pass; getAuthStatus().configured correctly fails]
      * it('checks the anthropic credential for the claude-code harness') — stub PRP_AGENT_HARNESS=
        'claude-code'; NO anthropic credential; expect rejects.toThrow(AuthPreflightError) with provider
        'anthropic' in the message. [covers the claude-code → anthropic swap]
  - NAMING: tests/unit/config/auth-preflight.test.ts. Use `await expect(runAuthPreflight()).rejects.toThrow(...)`.
  - COVERAGE: must hit every runAuthPreflight branch (100% gate). The 5 tests above do. Add a 6th only if
    a branch (e.g. override via PRP_API_KEY) is uncovered.
  - DO NOT duplicate T3.S2's acceptance/integration matrix (no-session-dir, end-to-end main() wiring,
    AUTH_TOKEN-only-for-anthropic, etc.).
  - DEPENDENCY: Tasks 1–3.

Task 5: DOCS (Mode A) — docs/INSTALLATION.md
  - ADD a Troubleshooting subsection (after the existing "Tests fail with API error" entry, before
    "EACCES permission errors") titled e.g. "Startup fails with 'Authentication preflight failed'":
      What you see: the preflight message (quote the shape from buildPreflightMessage).
      Why: no credential resolvable for the selected harness + provider/model (PRD §9.2.7).
      How to fix: `pi /login` (writes ~/.pi/agent/auth.json) OR `export ZAI_API_KEY=<your-key>`;
      for the anthropic provider / claude-code harness: `export ANTHROPIC_API_KEY=<your-key>`.
  - UPDATE Quick Start step 4 ("Configure environment variables") so the PRIMARY path is:
      `pi /login`  OR  `export ZAI_API_KEY=<your-key>`  (drop `export ANTHROPIC_AUTH_TOKEN=...` as primary).
  - UPDATE the "Required Variables" / "Optional Variables" env table: ZAI_API_KEY (and pi /login) is the
    primary; ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY demoted to optional anthropic-provider aliases.
    Keep ANTHROPIC_BASE_URL (default https://api.z.ai/api/anthropic) and the model-override rows.
  - UPDATE the "Environment Variable Mapping" note: drop "AUTH_TOKEN mapped to API_KEY" as the PRIMARY
    flow (it's now a provider-conditional alias for anthropic only); note the preflight runs at startup.
  - DO NOT touch README.md (Mode B → T4.S1).
  - DEPENDENCY: Tasks 1–4.

Task 6: VALIDATE (the full gate)
  - RUN: npm run typecheck
  - RUN: npm run lint && npm run format:check      (run npm run format if it complains)
  - RUN: npx vitest run tests/unit/config/auth-preflight.test.ts
  - RUN: npx vitest run tests/unit/config/                          # all config tests green
  - RUN: npm run validate                           # lint + format:check + typecheck + test:run
  - RUN: npm run test:coverage                      # 100% on src/** (new runAuthPreflight branches covered)
  - RUN (acceptance greps): see Validation Loop Level 3.
  - DEPENDENCY: Tasks 4–5.
```

### Implementation Patterns & Key Details

```ts
// ── The verified preflight predicate (NOT hasAuth — it's too lenient on whitespace env) ───
export async function runAuthPreflight(): Promise<void> {
  const harness = process.env[PRP_AGENT_HARNESS] ?? DEFAULT_HARNESS;
  const model = getModel('sonnet');
  const provider = harness === 'claude-code' ? 'anthropic' : getResolvedProvider();

  // 1+2: override/env (resolveApiKeyForProvider trims → empty/whitespace == not configured).
  if (resolveApiKeyForProvider(provider)) return;

  // 3: auth.json via pi's file-backed AuthStorage (the SAME resolver the harness uses at runtime).
  //    getAuthStatus().configured is false for the `environment` source → whitespace env does NOT pass.
  if (AuthStorage.create().getAuthStatus(provider).configured) return;

  throw new AuthPreflightError({ harness, provider, model });
}

// ── main() wiring (src/index.ts) ──────────────────────────────────────────────────────────
configureEnvironment();
await runAuthPreflight();      // NEW — PRD §9.2.7 fail-fast gate
await ensureHarnessInitialized();

// ── main()'s top-level catch (src/index.ts) ───────────────────────────────────────────────
void main().catch((error: unknown) => {
  if (error instanceof AuthPreflightError) {
    console.error(`\n❌ ${error.message}`);   // ONE actionable message; no stack, no "Fatal" prefix
    process.exit(1);
  }
  console.error('\n❌ Fatal error in main():', error);
  process.exit(1);
});

// ── auth-preflight.test.ts scaffolding (the MANDATORY temp-dir isolation) ─────────────────
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('groundswell', () => ({
  configureHarnesses: vi.fn(),
  HarnessRegistry: { getInstance: () => ({ has: () => false, register: vi.fn() }) },
  PiHarness: class MockPiHarness {},
}));

import { runAuthPreflight } from '../../../src/config/harness.js';
import { AuthPreflightError } from '../../../src/config/types.js';

const AUTH_VARS = ['ZAI_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_OAUTH_TOKEN',
  'PRP_API_KEY','ANTHROPIC_DEFAULT_SONNET_MODEL','PRP_AGENT_HARNESS'] as const;
let tmpAgentDir: string;
beforeEach(() => {
  vi.clearAllMocks();
  for (const v of AUTH_VARS) delete process.env[v];
  tmpAgentDir = mkdtempSync(join(tmpdir(), 'preflight-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', tmpAgentDir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(tmpAgentDir, { recursive: true, force: true });
});

it('proceeds when only ~/.pi/agent/auth.json is present (auth.json path)', async () => {
  // NO env vars set. Seed auth.json in the temp PI_CODING_AGENT_DIR.
  writeFileSync(join(tmpAgentDir, 'auth.json'),
    JSON.stringify({ zai: { type: 'api_key', key: 'auth-json-key' } }));
  await expect(runAuthPreflight()).resolves.toBeUndefined();   // auth.json-only succeeds (PRD §9.2.7)
});

it('throws AuthPreflightError when no credential is configured', async () => {
  // NO env, NO auth.json (tmpAgentDir is empty).
  await expect(runAuthPreflight()).rejects.toThrow(AuthPreflightError);
  await expect(runAuthPreflight()).rejects.toThrow(/provider 'zai'/);
});

it('treats whitespace-only ZAI_API_KEY as not configured (aborts)', async () => {
  vi.stubEnv('ZAI_API_KEY', '   ');   // hasAuth would WRONGLY return true; getAuthStatus().configured=false
  await expect(runAuthPreflight()).rejects.toThrow(AuthPreflightError);   // empty-string policy (PRD §9.2.7)
});
```

### Integration Points

```yaml
CODE (src/config/types.ts):
  - ADD `AuthPreflightError` class + module-local `buildPreflightMessage(opts)` helper.

CODE (src/config/harness.ts):
  - ADD exported `async function runAuthPreflight(): Promise<void>`.
  - ADD imports: `AuthStorage` from '@earendil-works/pi-coding-agent'; extend `getModel`/`getResolvedProvider`
    import from './environment.js'; extend `DEFAULT_HARNESS`/`PRP_AGENT_HARNESS` from './constants.js';
    extend `AuthPreflightError` import from './types.js'.

CODE (src/index.ts):
  - ADD `runAuthPreflight` to the harness.js import; ADD `AuthPreflightError` import from './config/types.js'.
  - INSERT `await runAuthPreflight();` between configureEnvironment() and ensureHarnessInitialized().
  - UPDATE the top-level .catch() to handle AuthPreflightError (clean message + exit 1).

TESTS (NEW): tests/unit/config/auth-preflight.test.ts (coverage-sufficient; T3.S2 owns the matrix).

DOCS (Mode A): docs/INSTALLATION.md — preflight troubleshooting subsection + env/auth framing refresh.

DEPENDENCY (OPTIONAL): package.json — if the AuthStorage src/ import does not resolve, add/promote
  "@earendil-works/pi-coding-agent" (prefer `dependencies`; keep ONE entry). It already resolves as the
  T2.S3 devDep + a transitive runtime dep, so this is likely a no-op.

NO CHANGES TO:
  src/config/environment.ts       (DONE T2.S1 — resolveApiKeyForProvider/getResolvedProvider/getModel/configureEnvironment consumed)
  src/config/constants.ts         (PRP_AGENT_HARNESS/DEFAULT_HARNESS/PRP_API_KEY already exist)
  src/config/endpoint-guard.ts    (§9.2.4 safeguard — READ ONLY)
  src/config/harness.ts resolver/forwarding (DONE T2.S1 — runAuthPreflight CONSUMES, not modifies)
  src/scripts/validate-api.ts     (validateEnvironment() stays for back-compat)
  ~/projects/groundswell/**       (T2.S2 owns the file-backed AuthStorage)
  README.md                       (Mode B → T4.S1)
  PRD.md, tasks.json, prd_snapshot.md, .gitignore   (READ ONLY — never touch)
```

## Validation Loop

> Run after the relevant task group. Fix before proceeding to the next level. All commands run in
> `~/projects/hacky-hack`.

### Level 1: Import-resolution + Syntax & Style (after Tasks 0–3)

```bash
cd ~/projects/hacky-hack

# Task 0 gate: AuthStorage importable + the type surface.
node --input-type=module -e "import('@earendil-works/pi-coding-agent').then(m=>console.log(typeof m.AuthStorage?.create, typeof m.AuthStorage?.inMemory)).catch(e=>console.log('FAIL',e.code))"
# Expected: 'function function'. If FAIL → add/promote @earendil-works/pi-coding-agent in package.json.

npm run typecheck     # tsc --noEmit -p tsconfig.build.json — catches import/signature/AuthStatus-shape errors
npm run lint          # eslint . --ext .ts — zero errors
npm run format:check  # run `npm run format` if it complains
```
Expected: all pass. typecheck is the primary catcher of a bad `AuthStorage` import, a wrong
`getAuthStatus`/`AuthStatus` usage, or a missing `AuthPreflightError` field.

### Level 2: Unit + Coverage (after Tasks 4)

```bash
cd ~/projects/hacky-hack

# The new file alone (fast iteration).
npx vitest run tests/unit/config/auth-preflight.test.ts
# Expected: all 5 cases pass (env-proceeds, auth.json-proceeds, no-credential-throws,
#           whitespace-throws, claude-code-anthropic).

# The full config suite — existing config tests unaffected.
npx vitest run tests/unit/config/
# Expected: all green — auth-resolver.test.ts (T2.S1), auth-resolution.test.ts (T2.S3, if present),
#           environment.test.ts, harness-config.test.ts, harness-provider-compat.test.ts,
#           endpoint-guard.test.ts, harness.test.ts + the new file.

# Full suite + 100% coverage gate. INSPECT the runAuthPreflight + AuthPreflightError branch %.
npm run validate          # lint + format:check + typecheck + test:run
npm run test:coverage     # 100% statements/branches/functions/lines on src/**
# Expected: all pass; new runAuthPreflight branches at 100%.
```

### Level 3: Acceptance greps (the §9.2.7 invariants)

```bash
cd ~/projects/hacky-hack
# runAuthPreflight is invoked on the startup path, between configureEnvironment and ensureHarnessInitialized.
rg -n "runAuthPreflight" src/index.ts
# Expected: ≥1 hit; located between configureEnvironment() and ensureHarnessInitialized().

# runAuthPreflight is exported from harness.ts (T3.S2 / consumers import it).
rg -n "export (async )?function runAuthPreflight" src/config/harness.ts
# Expected: 1 hit.

# The preflight uses AuthStorage (the drift-proof primitive), NOT a hand-rolled process.env-only check.
rg -n "AuthStorage" src/config/harness.ts
# Expected: ≥1 hit.

# The gate is getAuthStatus(...).configured (NOT hasAuth — too lenient on whitespace env).
rg -n "getAuthStatus" src/config/harness.ts
# Expected: ≥1 hit. (If `hasAuth` appears instead, STOP — see verified_facts §3; it passes whitespace env.)

# AuthPreflightError exists + main() handles it.
rg -n "class AuthPreflightError" src/config/types.ts   # 1 hit
rg -n "AuthPreflightError" src/index.ts                # ≥1 hit (the catch handler)

# validateEnvironment is UNCHANGED (back-compat).
git diff --stat src/config/environment.ts   # Expected: (no changes)
# endpoint-guard untouched.
git diff --stat src/config/endpoint-guard.ts   # Expected: (no changes)
# Expected: all greps return the stated results.
```

### Level 4: Behavioral smoke (the §9.2.7 OUTPUT contract)

```bash
cd ~/projects/hacky-hack

# (a) No credential → aborts at startup with exit 1 + ONE message (use a clean temp PI_CODING_AGENT_DIR so
#     the dev's real auth.json doesn't satisfy the check). Capture exit code.
tmpdir_pf=$(mktemp -d)
PI_CODING_AGENT_DIR="$tmpdir_pf" ZAI_API_KEY= ANTHROPIC_API_KEY= ANTHROPIC_AUTH_TOKEN= \
  npx tsx -e "import('./src/index.js')" >/tmp/pf_out.txt 2>&1; echo "exit=$?"
grep -q "Authentication preflight failed" /tmp/pf_out.txt && echo "MESSAGE OK"
rm -rf "$tmpdir_pf"
# Expected: exit=1 (non-zero) and "MESSAGE OK". NOTE: src/index.js is the built entry; if only tsx src/index.ts
# exists, run `npx tsx src/index.ts --help` first (should NOT trip the preflight — preflight is after parseCLIArgs
# only on the pipeline path). For the abort test, invoke the pipeline path (e.g. --prd PRD.md) under the clean env.

# (b) ZAI_API_KEY-only proceeds past the preflight (does not throw AuthPreflightError at the gate).
ZAI_API_KEY=zai-smoke npx tsx -e "import('./src/config/harness.js').then(async m=>{ await m.runAuthPreflight(); console.log('PASSED PRE-AGENT') })"
# Expected: 'PASSED PRE-AGENT' (no throw). (Use a clean PI_CODING_AGENT_DIR if the dev's auth.json would mask this.)

# (c) auth.json-only proceeds (seed a temp auth.json; no env).
tmpdir_pf=$(mktemp -d); mkdir -p "$tmpdir_pf"
printf '%s' '{"zai":{"type":"api_key","key":"k"}}' > "$tmpdir_pf/auth.json"
PI_CODING_AGENT_DIR="$tmpdir_pf" ZAI_API_KEY= npx tsx -e "import('./src/config/harness.js').then(async m=>{ await m.runAuthPreflight(); console.log('AUTH.JSON OK') })"
rm -rf "$tmpdir_pf"
# Expected: 'AUTH.JSON OK' (auth.json-only succeeds — PRD §9.2.7).

# (d) whitespace ZAI_API_KEY aborts (empty-string policy).
ZAI_API_KEY='   ' npx tsx -e "import('./src/config/harness.js').then(async m=>{ try{await m.runAuthPreflight();console.log('WRONGLY PASSED')}catch(e){console.log('CORRECTLY ABORTED:',e.name)} })"
# Expected: 'CORRECTLY ABORTED: AuthPreflightError' (NOT 'WRONGLY PASSED').
# Expected: each smoke prints the stated value (sanity; the authoritative matrix is Level 2 + T3.S2).
```

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: `AuthStorage` import resolves (`create`+`inMemory` = functions); `npm run typecheck`,
      `npm run lint`, `npm run format:check` all pass.
- [ ] Level 2: `npx vitest run tests/unit/config/auth-preflight.test.ts` passes (5 cases);
      `npx vitest run tests/unit/config/` fully green (existing + new); `npm run validate` passes;
      `npm run test:coverage` shows 100% on `src/**` (new `runAuthPreflight` + `AuthPreflightError` branches).
- [ ] Level 3: acceptance greps return the stated results (runAuthPreflight between the two startup calls;
      exported; uses AuthStorage; uses getAuthStatus(...).configured NOT hasAuth; AuthPreflightError handled
      in main; environment.ts + endpoint-guard.ts unchanged).
- [ ] Level 4: behavioral smokes print the expected values (no-cred → exit 1 + message; ZAI-only proceeds;
      auth.json-only proceeds; whitespace aborts).

### Feature Validation (PRD §9.2.7 + work-item OUTPUT)
- [ ] `runAuthPreflight()` invoked in `main()` after `configureEnvironment()` and before
      `ensureHarnessInitialized()` / `new PRPPipeline(...)`.
- [ ] No-credential run aborts at startup with ONE message + exit `1` — NO session dir created, NO agent invoked.
- [ ] auth.json-only run (no env) proceeds under `pi`+`zai`.
- [ ] ZAI_API_KEY-only run proceeds under `pi`+`zai`.
- [ ] Whitespace-only `ZAI_API_KEY`/`PRP_API_KEY` aborts (empty-string policy).
- [ ] `claude-code` harness checks the `anthropic` credential.
- [ ] The failure message names harness+provider/model, every empty source (PRP_API_KEY, provider env-var
      name, ~/.pi/agent/auth.json path), and the exact remediation (pi /login / export <PROVIDER>_API_KEY=…).
- [ ] `validateEnvironment()` is NOT on the startup path and is left intact (back-compat).

### Code Quality Validation
- [ ] `AuthPreflightError` mirrors `HarnessProviderMismatchError` (structured fields → ctor-built message).
- [ ] `runAuthPreflight()` CONSUMES the DONE T2.S1 resolver/getResolvedProvider/getModel (no reimplementation).
- [ ] The auth.json half uses `AuthStorage.create().getAuthStatus(provider).configured` (NOT `hasAuth` — too
      lenient on whitespace env; NOT a hand-rolled file reader — drifts from pi).
- [ ] No circular import (types.ts imports nothing from harness.ts; harness.ts imports getModel from environment.ts).
- [ ] main()'s handler uses `console.error` (no logger exists at preflight time) — sidesteps PRD §9.6.
- [ ] The harness id is read DIRECTLY from `process.env[PRP_AGENT_HARNESS]` (independent of configureHarness()).

### Documentation & Scope
- [ ] JSDoc on `runAuthPreflight()` (PRD §9.2.7; insertion point; two sources; claude-code→anthropic; throws).
- [ ] `docs/INSTALLATION.md`: preflight troubleshooting subsection added; Quick Start step 4 + env table
      refreshed (pi /login / ZAI_API_KEY primary; ANTHROPIC_* demoted).
- [ ] NO edits to README.md (Mode B → T4.S1), environment.ts/endpoint-guard.ts/constants.ts (DONE/READ ONLY),
      validateEnvironment(), the groundswell repo, or the full acceptance matrix (T3.S2).
- [ ] PRD.md, tasks.json, prd_snapshot.md, .gitignore untouched (READ ONLY).

---

## Anti-Patterns to Avoid

- ❌ Don't use `AuthStorage.hasAuth(provider)` as the gate — it returns `true` for a WHITESPACE-ONLY env var
      (probed empirically), violating PRD §9.2.7. Use `getAuthStatus(provider).configured` (false for the
      `environment` source; true only for a stored/runtime/fallback credential).
- ❌ Don't reimplement `resolveApiKeyForProvider` / `getResolvedProvider` / `getModel` or read
      `~/.pi/agent/auth.json` by hand — they're DONE (T2.S1) / pi's job (T2.S2). Drift = silent breakage.
- ❌ Don't `import { AuthStorage } from 'groundswell'` — groundswell does NOT re-export it (verified).
      Use `from '@earendil-works/pi-coding-agent'` (already a devDep + transitive runtime dep).
- ❌ Don't call `runAuthPreflight()` via `configureHarness()` to read the harness id — configureHarness() is
      lazy (module-load in agent-factory.ts), not guaranteed to have run. Read `process.env[PRP_AGENT_HARNESS]
      ?? DEFAULT_HARNESS` directly.
- ❌ Don't construct a logger in the preflight — the root logger is created at src/index.ts:121, AFTER the
      preflight. Use `console.error` in main()'s handler (sidesteps PRD §9.6 lazy-logger rules).
- ❌ Don't `process.exit()` inside `runAuthPreflight()` — throw `AuthPreflightError` (testable, matches the
      existing thrown-error pattern; main() does the exit at the boundary).
- ❌ Don't forget the MANDATORY `PI_CODING_AGENT_DIR` temp-dir isolation in tests — `AuthStorage.create()`
      reads the dev's REAL `~/.pi/agent/auth.json`, so a "no-credential" test would WRONGLY pass if the dev
      is logged in. Clear auth env vars in beforeEach too (setup.ts runs dotenv.config()).
- ❌ Don't duplicate T3.S2's acceptance/integration matrix (no-session-dir-on-fail, end-to-end main() wiring,
      AUTH_TOKEN-only-for-anthropic, ZAI-only end-to-end). T3.S1 ships coverage-sufficient tests ONLY.
- ❌ Don't modify/`remove validateEnvironment()` — it's NOT on the startup path (only validate-api.ts calls
      it) but is kept for back-compat. The preflight REPLACES its missing startup role.
- ❌ Don't treat the `claude-code` harness the same as `pi` — claude-code is Anthropic-only; check the
      `anthropic` credential for it. (A claude-code+zai mismatch is a SEPARATE error caught by
      configureHarness() → HarnessProviderMismatchError, not the preflight.)
- ❌ Don't touch README.md (Mode B → T4.S1), endpoint-guard.ts, the groundswell repo, or
      PRD.md/tasks.json/prd_snapshot.md/.gitignore (READ ONLY).

---

## Confidence Score

**9/10** — one-pass implementation success likelihood. The DONE T2.S1 resolver + the DONE T2.S2 file-backed
AuthStorage are the entire input contract (quoted verbatim). The single load-bearing decision — that
`hasAuth()` is too lenient and `getAuthStatus().configured` is the correct gate — is empirically proven
with a 6-row matrix (verified_facts §3) and mapped to concrete assertions. The error pattern, the test
pattern, the main() insertion point (exact line numbers), and the test-isolation requirement are all
cited. The one residual risk is the optional `@earendil-works/pi-coding-agent` package.json promotion —
gated on a one-line verification that already returns `function function`, so it is very likely a no-op.
Coverage is bounded (5 focused tests hit every branch); T3.S2 owns the broader matrix.
