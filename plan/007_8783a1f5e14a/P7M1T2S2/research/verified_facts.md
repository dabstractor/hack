# P7.M1.T2.S2 — Verified Facts (empirically confirmed from primary sources)

Every item below was read directly from the Groundswell repo, `node_modules`, or the hacky-hack
integration layer on 2026-06-29. Primary sources cited inline.

---

## §1 — The exact lines to change (pi-harness.ts initialize, lines ~143–145)

File: `~/projects/groundswell/src/harnesses/pi-harness.ts` (read in full).

Current code (with the preceding comment):
```ts
    // Headless registry: no disk (no agentDir/models.json/auth.json). Env-var key resolution
    // is built into AuthStorage.getApiKey (GOTCHA #7).
    this.authStorage = AuthStorage.inMemory();
    this.modelRegistry = ModelRegistry.inMemory(this.authStorage);

    // Store options; apiKey is applied per-provider in resolveModel (GOTCHA #8).
    this.options = options ?? null;
```

The surrounding `initialize()` structure (verified):
- Idempotent guard FIRST: `if (this.sdk) return;`
- Lazy SDK import in try/catch.
- THEN the two store-construction lines (the target).
- THEN `this.options = options ?? null;` (unchanged).

The `?? AuthStorage.create()` / `?? ModelRegistry.create(this.authStorage)` replacement goes on the
TWO store lines only. The `this.options = options ?? null` line stays.

`AuthStorage` + `ModelRegistry` are ALREADY value-imported at the top of the file:
```ts
import { ModelRegistry, AuthStorage } from "@earendil-works/pi-coding-agent";
```
→ No new value import needed in pi-harness.ts.

The private fields are already declared with the right types (lines ~88–100):
```ts
private sdk: typeof import("@earendil-works/pi-coding-agent") | null = null;
private authStorage: AuthStorage | null = null;
private modelRegistry: ModelRegistry | null = null;
private options: HarnessOptions | null = null;
```

`terminate()` (lines ~155–163) nulls all four fields — UNCHANGED (still correct).

---

## §2 — The static factory signatures (verbatim from node_modules .d.ts via groundswell_auth_api.md §2/§3)

`AuthStorage` (`@earendil-works/pi-coding-agent/dist/core/auth-storage.d.ts`):
```ts
static create(authPath?: string): AuthStorage;       // FILE-BACKED; default join(getAgentDir(),'auth.json')
static fromStorage(storage: AuthStorageBackend): AuthStorage;
static inMemory(data?: AuthStorageData): AuthStorage; // accepts a SEED AuthStorageData
```
- `AuthStorage.create()` default path = `join(getAgentDir(), "auth.json")` = `~/.pi/agent/auth.json`
  (overridable via `PI_CODING_AGENT_DIR`; groundswell_auth_api.md §6).
- `AuthStorage.inMemory(data = {})` accepts a seed → `{ zai: { type: "api_key", key: "..." } }`.

`ModelRegistry` (`@earendil-works/pi-coding-agent/dist/core/model-registry.d.ts`):
```ts
static create(authStorage: AuthStorage, modelsJsonPath?: string): ModelRegistry;  // FILE-BACKED; default models.json
static inMemory(authStorage: AuthStorage): ModelRegistry;                         // built-ins only (no models.json)
```
- BOTH require a caller-supplied `AuthStorage` (no overload builds its own).
- `ModelRegistry.create(authStorage)` merges `~/.pi/agent/models.json` (custom providers); `.inMemory()`
  uses built-ins only. The notes' "required" sketch uses `.create()` — preferred (reads models.json too).

`AuthStorageData` / `AuthCredential` (backing types):
```ts
export type ApiKeyCredential = { type: "api_key"; key: string; env?: Record<string, string> };
export type AuthStorageData   = Record<string, AuthCredential>;
```

`AuthStorage` is tolerant of a MISSING file: the constructor calls `this.reload()` which catches into
`loadError`/`errors` (drained via `drainErrors()`). So `AuthStorage.create()` does NOT throw when
`~/.pi/agent/auth.json` is absent — it just has no stored creds (env/fallback resolution still runs).

---

## §3 — HarnessOptions: the type-safe seam (src/types/harnesses.ts)

File: `~/projects/groundswell/src/types/harnesses.ts` (read in full).

Current `HarnessOptions` (lines 70–84):
```ts
export interface HarnessOptions {
  endpoint?: string;
  apiKey?: string;
  sessionId?: string;
  timeout?: number;
  headers?: Record<string, string>;
}
```

The type doc EXPLICITLY sanctions per-harness extension (verbatim, lines ~57–62):
> "Harness implementations MAY extend this with harness-specific fields (e.g. `skillsDirs?: string[]`
> on a `pi` adapter) per PRD §7.5."

→ Adding `authStorage?: AuthStorage` + `modelRegistry?: ModelRegistry` is the sanctioned seam.
   These are Pi-harness-specific, but the `HarnessOptions` interface doc permits it (and the notes
   §T2.S2 mandate adding them THERE, not in a Pi-only sub-interface, so hacky-hack can pass them via
   the shared type). A type-only import is required at the top of harnesses.ts:
```ts
import type { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
```
   (harnesses.ts is a pure-types module — type-only import is erased at runtime, keeps it pure.)

The `Harness.initialize(options?: HarnessOptions)` signature (line ~300) is UNCHANGED (still optional
HarnessOptions). `ClaudeCodeHarnessOptions extends HarnessOptions` (claude-code-harness.ts:69) — adding
optional fields is purely additive; no consumer breaks.

---

## §4 — Blast radius of the HarnessOptions change (grep across groundswell `src/`)

`HarnessOptions` consumers (non-test):
- `src/core/agent.ts` — reads `resolvedHarnessOptions.sessionId` only (additive fields ignored). ✓
- `src/types/agent.ts` — `harnessOptions?: HarnessOptions` on agent/prompt configs. ✓
- `src/utils/harness-config.ts` — `resolveHarnessConfig` returns `HarnessOptions`; builds it from
  endpoint/apiKey/sessionId/timeout/headers. ✓ (additive fields pass through via spread).
- `src/harnesses/claude-code-harness.ts` — `ClaudeCodeHarnessOptions extends HarnessOptions`. ✓
- `src/index.ts` — re-exports `HarnessOptions`. ✓ (now also re-exports AuthStorage/ModelRegistry types
  transitively; consumers resolve them from pi-coding-agent — already a dep).

→ ZERO call sites construct `HarnessOptions` with `authStorage`/`modelRegistry` today. The change is
   purely additive. No existing test or consumer breaks.

---

## §5 — Existing pi-harness tests that touch initialize/authStorage (and whether they break)

`grep -rln "AuthStorage.inMemory|AuthStorage.create|ModelRegistry.inMemory|ModelRegistry.create"`
across `src/__tests__/` → **ZERO hits**. No test pins the factory NAME.

`src/__tests__/unit/providers/pi-harness-initialize.test.ts` (read in full) uses REAL imports (no vi.mock).
Relevant assertions under the new `create()` default:
- `expect(harness.modelRegistry instanceof ModelRegistry).toBe(true)` → STILL TRUE (`create()` returns a
  ModelRegistry instance). ✓
- `expect(harness.authStorage).not.toBeNull()` → STILL TRUE. ✓
- Idempotency ("should not rebuild the registry on second call", "same sdk reference") → STILL TRUE
  (guard is `if (this.sdk) return;`, unaffected). ✓
- "should store options as null when not provided" → STILL TRUE (`this.options = options ?? null`). ✓

THE ONLY behavioral side-effect of switching to `create()`: `initialize()` with NO options now reads
the REAL `~/.pi/agent/auth.json` + `~/.pi/agent/models.json` at construction (the developer's actual
files). For the tests above this is benign (they assert shape, not contents), BUT it is:
  (a) non-deterministic (depends on host creds), and
  (b) a credential-hygiene concern (reads real secrets into test process memory).
→ FIX: in `pi-harness-initialize.test.ts`, set `PI_CODING_AGENT_DIR` to a temp dir in `beforeEach`
   (unset in `afterEach`) so `getAgentDir()` resolves to an isolated, empty temp dir for ALL initialize
   calls — deterministic + no real-cred reads. Then ADD new tests that (i) inject an in-memory seed via
   `options.authStorage` and assert it is the store used, and (ii) seed an `auth.json` in the temp dir
   and assert the file-backed default consults it.

---

## §6 — CRITICAL: hacky-hack consumes groundswell `dist/`, and it is a COPY not a symlink

Verified:
```
$ readlink -f ~/projects/hacky-hack/node_modules/groundswell
/home/dustin/projects/hacky-hack/node_modules/groundswell     # NOT a symlink target
$ file ~/projects/hacky-hack/node_modules/groundswell
... directory
```
Contents: only `dist/` + `LICENSE` + `package.json` + `README.md` (matches groundswell `files: ["dist","LICENSE"]`
+ npm's auto-README). hacky-hack `package.json` declares `"groundswell": "^1.0.0"` (line 77) — a version
range, NOT `link:`/`file:`.

`scripts/test-import-resolution.ts` even states the expectation: "ℹ️ No npm linked packages found (this is OK)".

→ IMPLICATION: editing `~/projects/groundswell/src/harnesses/pi-harness.ts` does NOT update
   `~/projects/hacky-hack/node_modules/groundswell/dist/`. For hacky-hack to CONSUME the change:
   1. Rebuild groundswell dist: `cd ~/projects/groundswell && npm run build` (`tsc` → `dist/`).
   2. Propagate the fresh dist into hacky-hack's `node_modules/groundswell`. The established dev
      mechanism here is `npm link` (run `npm link` in groundswell, then `npm link groundswell` in
      hacky-hack), which REPLACES the copy with a symlink to the source tree (picks up future rebuilds
      automatically). VERIFY after linking: `readlink -f node_modules/groundswell` must point at
      `~/projects/groundswell`.
   The work item's OUTPUT contract gates on `npm run validate:groundswell` + `tests/unit/groundswell/imports.test.ts`
   — those import from `node_modules/groundswell/dist/index.js`, so they ONLY see the change AFTER step 2.

This is the single most important non-obvious fact for this cross-repo task. It is a TRACKED cross-cutting
change (PRD §9.2.6 / §9.5) — the commit message must state that the Groundswell repo was edited and the
dist rebuilt + re-linked.

---

## §7 — Groundswell-side validation commands (verified against package.json scripts)

Groundswell `package.json` scripts (verbatim):
- `"build": "tsc"` (emits `dist/`)
- `"lint": "tsc --noEmit"`  ← this is the TYPECHECK (NOT eslint; there is no eslint/prettier here)
- `"test": "vitest run"`
- `"test:watch": "vitest"`

`vitest.config.ts` (verbatim): `include: ['src/__tests__/**/*.test.ts', ...], globals: true` — **NO
coverage thresholds block** (confirmed: no `coverage:` key). So unlike hacky-hack there is NO 100%
coverage gate to satisfy. Coverage is best-effort.

→ Groundswell validation = `npm run lint && npm test`. Focused: `npx vitest run src/__tests__/unit/providers/pi-harness-initialize.test.ts src/__tests__/unit/harnesses-types.test.ts`.

`tsconfig.json`: `strict: true`, `moduleResolution: bundler`, `isolatedModules: true`, `rootDir: ./src`,
`exclude: ["node_modules","dist","src/__tests__"]`. NOTE: tests are EXCLUDED from the build (`tsc`) —
they're type-checked separately by vitest's esbuild (no `tsc` on tests unless you run `tsc` with a test
tsconfig; `npm run lint` = `tsc --noEmit` on `include: ["src/**/*"]` = NO tests). So test type errors
surface only at `npm test` runtime via esbuild (syntax) — TS type errors in tests are NOT caught by
`npm run lint`. Keep test types clean anyway.

---

## §8 — hacky-hack-side verification (the OUTPUT contract)

- `npm run validate:groundswell` → `tsx src/scripts/validate-groundswell.ts` (read in full). It does:
  `npm list groundswell`, version-check, then `import('groundswell')` and checks the named exports
  (`Workflow, Agent, Prompt, createAgent, createWorkflow, createPrompt`) are accessible. `PiHarness`
  is NOT in that required-exports list → the validator does NOT catch a PiHarness regression, but it
  DOES confirm the dist still imports cleanly (no broken build). The change is additive, so this passes.
- `tests/unit/groundswell/imports.test.ts` — gates on `validateNpmLink()` (from
  `src/utils/validate-groundswell-link.js`); skips gracefully if link fails. It exercises core imports.
  With the dist rebuilt + re-linked, it must stay green. (The `HarnessOptions` type change is additive
  → no import the test makes is affected.)
- The hacky-hack behavioral PAYOFF (auth.json honored) is validated end-to-end by T2.S3 (seed a temp
  `~/.pi/agent/auth.json` via `PI_CODING_AGENT_DIR`, assert a `pi`+`zai` run resolves). T2.S2 only
  enables the seam; T2.S3 proves the matrix.

---

## §9 — Coordination with parallel/adjacent work items (no conflict)

- **T2.S1** (parallel, in progress): hacky-hack-side `resolveApiKeyForProvider` + provider-aware
  `configureEnvironment`. Its PRP's Success Definition explicitly says: *"Default `pi`+`zai` run succeeds
  with ONLY a valid `~/.pi/agent/auth.json` … pi's file-backed `AuthStorage` (once T2.S2 lands) resolves
  natively. (With T2.S2 absent, this path is caught by the T3 preflight — not a T2.S1 regression.)"*
  → T2.S1 forwards `undefined` for the auth.json-only path and RELIES on T2.S2 to make pi consult the
  file. NO overlap: T2.S1 touches ONLY hacky-hack `src/config/*` + `src/agents/agent-factory.ts`; T2.S2
  touches ONLY groundswell `src/harnesses/pi-harness.ts` + `src/types/harnesses.ts` + groundswell tests.
- **T2.S3** (next): owns the full resolution-order + auth.json-on-disk test matrix in hacky-hack. T2.S2
  must not write those (it would duplicate T2.S3's owned scope). T2.S2's new groundswell-side tests are
  the in-repo initialize() behavior (inject seam + file-backed default), NOT the hacky-hack pipeline matrix.
- **T3** (later): the fail-fast preflight consumes `AuthStorage.hasAuth(provider)` (groundswell_auth_api.md
  §2). T2.S2's file-backed default makes `hasAuth('zai')` reflect auth.json → the preflight becomes
  accurate. T2.S2 does NOT touch the preflight.

---

## §10 — Scope boundaries (what T2.S2 does NOT do)

- Does NOT change `resolveModel()` / `setRuntimeApiKey` wiring (the per-provider override path is correct
  and unchanged; it composes with file-backed auth — runtime override is highest priority per §2).
- Does NOT change `terminate()` (still nulls the 4 fields; correct for both in-memory and file-backed).
- Does NOT change `normalizeModel()` / the `ClaudeCodeHarness`.
- Does NOT read auth.json from hacky-hack (that's pi's job via the file-backed AuthStorage; T2.S1 forwards
  undefined for source #3).
- Does NOT add the `authStorage`/`modelRegistry` fields to the deprecated `ProviderOptions`
  (`src/types/providers.ts`) — that type is `@deprecated`; the sanctioned seam is `HarnessOptions`.
- Does NOT modify hacky-hack source (no hacky-hack `.ts` edits — only groundswell repo + groundswell tests).
- Does NOT modify PRD.md / tasks.json / prd_snapshot.md / .gitignore (READ-ONLY).
