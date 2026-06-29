---
name: "P7.M1.T2.S2 — Cross-repo Groundswell: honor ~/.pi/agent/auth.json in PiHarness.initialize()"
description: |
  CROSS-REPO change against `~/projects/groundswell` (NOT hacky-hack). `PiHarness.initialize()`
  (src/harnesses/pi-harness.ts lines ~143–145) currently hard-codes `this.authStorage = AuthStorage.inMemory()`
  + `this.modelRegistry = ModelRegistry.inMemory(this.authStorage)`. An in-memory store NEVER reads
  `~/.pi/agent/auth.json`, so a user who runs `pi /login` (the canonical pi auth flow) has a valid `zai`
  credential on disk that the pipeline cannot see (PRD §9.2.6 problem #2). Replace with:
    this.authStorage   = options?.authStorage   ?? AuthStorage.create();                   // file-backed
    this.modelRegistry = options?.modelRegistry ?? ModelRegistry.create(this.authStorage); // file-backed
  Both `AuthStorage.create()` and `ModelRegistry.create(authStorage)` are file-backed factories that
  default to `getAgentDir()/auth.json` + `getAgentDir()/models.json` (=`~/.pi/agent/*`, overridable via
  `PI_CODING_AGENT_DIR`); both REQUIRE a caller-supplied AuthStorage (architecture/groundswell_auth_api.md
  §2/§3). Add the type-safe injection seam `authStorage?: AuthStorage` + `modelRegistry?: ModelRegistry`
  to `HarnessOptions` (src/types/harnesses.ts — explicitly sanctioned per-harness extension, PRD §7.5).
  Keep `initialize()` idempotent (`if (this.sdk) return;`) and `terminate()` nulling the fields. Sanitize
  + extend Groundswell's own `pi-harness-initialize.test.ts` (isolate `PI_CODING_AGENT_DIR` to a temp dir;
  seed `AuthStorage.inMemory({ zai: { type:'api_key', key:'...' } })` via the new seam; assert the
  file-backed default consults a seeded `auth.json`). REBUILD groundswell `dist` AND re-link it into
  hacky-hack (hacky-hack consumes a COPY of `dist/`, not a symlink — verified_facts.md §6). Verify
  hacky-hack still links: `npm run validate:groundswell` + `tests/unit/groundswell/imports.test.ts`.
  NOTE in the commit that this is a tracked cross-cutting change against the Groundswell repo per
  PRD §9.2.6/§9.5. Satisfies PRD §9.2.6 ("Groundswell contract change"); unblocks T2.S3 (auth.json matrix)
  and makes T3's preflight (`AuthStorage.hasAuth`) accurate. Mode A docs ride with the work: inline JSDoc
  on `initialize()` + `HarnessOptions` (Groundswell's own doc surface — no hacky-hack doc edits here).
---

## Goal

**Feature Goal**: `PiHarness.initialize()` honors pi's on-disk auth store by default. When a caller
passes no options, the harness now builds a **file-backed** `AuthStorage.create()` (reads
`~/.pi/agent/auth.json`) and `ModelRegistry.create(authStorage)` (reads `~/.pi/agent/models.json`),
instead of an in-memory store that only ever saw runtime overrides + env vars. A caller MAY inject a
custom `authStorage`/`modelRegistry` via the new `HarnessOptions` seam (e.g. tests seed
`AuthStorage.inMemory({ zai: {...} })`, or hacky-hack could pass a custom store). This is the
Groundswell half of PRD §9.2.6's "auth.json support" contract change; the hacky-hack half (forwarding
`undefined` so pi resolves natively) is owned by the parallel T2.S1.

**Deliverable** (all in `~/projects/groundswell` — NONE in hacky-hack):
1. **`src/types/harnesses.ts` (MODIFIED)** — add a type-only import of `AuthStorage`/`ModelRegistry` from
   `@earendil-works/pi-coding-agent`; add `authStorage?: AuthStorage` + `modelRegistry?: ModelRegistry`
   to the `HarnessOptions` interface; refresh the `HarnessOptions` JSDoc to document the pi-harness
   injection seam (PRD §7.5).
2. **`src/harnesses/pi-harness.ts` (MODIFIED)** — in `initialize()`, replace the two hard-coded
   `inMemory()` lines with the `options?.authStorage ?? AuthStorage.create()` /
   `options?.modelRegistry ?? ModelRegistry.create(this.authStorage)` seam; update the preceding comment
   + the `initialize()` JSDoc (drop "headless/no-disk" framing; state the file-backed default + the
   `PI_CODING_AGENT_DIR` override + the injection seam). Leave the idempotent guard, the lazy SDK import,
   the `this.options = options ?? null` line, `resolveModel()`, and `terminate()` UNCHANGED.
3. **`src/__tests__/unit/providers/pi-harness-initialize.test.ts` (MODIFIED/EXTENDED)** — isolate
   `PI_CODING_AGENT_DIR` to a fresh temp dir in `beforeEach` (unset in `afterEach`) so NO real
   `~/.pi/agent/auth.json`/`models.json` is read by the default path (determinism + credential hygiene);
   add a `describe('auth.json / injectable storage')` block asserting (a) `options.authStorage` (in-memory
   seed) is the store the harness uses; (b) `options.modelRegistry` is honored; (c) the default
   (no options) is file-backed and consults a seeded `auth.json` written into the temp `PI_CODING_AGENT_DIR`.
4. **`src/__tests__/unit/harnesses-types.test.ts` (MODIFIED, minimal)** — add a type assertion that
   `HarnessOptions` now accepts the two optional fields (mirrors the existing "should allow all fields to
   be optional" pattern); optional but keeps the type-suite honest.
5. **REBUILD + RE-LINK** — `cd ~/projects/groundswell && npm run build` (regenerate `dist/`); re-link
   into hacky-hack so the fresh `dist` is consumed (currently a COPY, not a symlink — see §6; the
   established dev mechanism is `npm link`). VERIFY `readlink -f
   ~/projects/hacky-hack/node_modules/groundswell` resolves to the source tree afterward.
6. **Commit note (Mode A)** — the commit message states this is a tracked cross-cutting change against
   the Groundswell repo (PRD §9.2.6 / §9.5), and that groundswell `dist` was rebuilt + re-linked.

**Success Definition** (maps to the work-item OUTPUT contract + PRD §9.2.6):
- `PiHarness.initialize()` with NO options builds a file-backed `AuthStorage` whose default path is
  `~/.pi/agent/auth.json` (overridable via `PI_CODING_AGENT_DIR`); `~/.pi/agent/auth.json` is therefore
  honored end-to-end (a `zai` credential written by `pi /login` is visible to the registry).
- A caller can inject `{ authStorage, modelRegistry }` via `HarnessOptions`; the harness uses them as-is.
- `initialize()` stays idempotent; `terminate()` still nulls all four fields; the existing
  `pi-harness-initialize.test.ts` assertions (instanceof/not-null/idempotency) stay green.
- Groundswell: `npm run lint` (`tsc --noEmit`) + `npm test` pass (incl. the new/extended tests).
- hacky-hack: `npm run validate:groundswell` + `tests/unit/groundswell/imports.test.ts` pass against the
  rebuilt + re-linked dist.

## User Persona (if applicable)

**Target User**: The `pi`-default user who authenticated via `pi /login` (writing `~/.pi/agent/auth.json`)
or `pi /auth`, and was previously **invisible** to the pipeline (PRD §9.2.6 problem #2: "a valid `zai`
credential on disk that the pipeline cannot see"). Also: Groundswell's own test authors (who need a clean
inject seam to seed auth without touching disk).

**Use Case**: `pi /login` once → `hack run PRD.md`. Today this fails deep inside `decomposePRD` with
`No API key found for zai.` because the harness built an in-memory store. After T2.S2 (+T2.S1), the same
on-disk credential is resolved by the harness's file-backed `AuthStorage.getApiKey('zai')`.

**User Journey**: `pi /login` → `hack run PRD.md` → `ensureHarnessInitialized()` (T2.S1 forwards
`undefined`, no fake key) → `PiHarness.initialize()` builds `AuthStorage.create()` → at execute() time
`AuthStorage.getApiKey('zai')` reads auth.json → `zai/glm-5.2` resolves → agents run.

**Pain Points Addressed**: (1) the silent invisibility of `~/.pi/agent/auth.json`; (2) no clean seam to
inject a test auth store (tests either relied on the old in-memory default or couldn't isolate).

## Why

- **Business value**: This is the Groundswell half of the auth model that makes the vendor-neutral `pi`
  harness the true default (PRD §9.2.6 "Groundswell contract change"). Without it, the canonical `pi /login`
  flow cannot work and T2.S1's "forward `undefined`, let pi resolve natively" path has nothing to resolve
  against. It is the keystone enabler for T2.S3 (auth.json matrix) and makes T3's preflight
  (`AuthStorage.hasAuth`) accurate.
- **Integration with existing features**: hacky-hack is the `pi` harness's PRIMARY consumer; the
  `pi /login` flow is pi's canonical auth path. The injection seam also gives Groundswell's own tests a
  deterministic path (seed in-memory, no host-cred reads).
- **Problems solved / for whom**: For every `pi`+`zai` user (the default) — the on-disk credential is
  finally honored. For Groundswell maintainers — a type-safe seam to inject auth/model stores.

## What

User-visible behavior (from a `pi` user's seat): a credential written by `pi /login` to
`~/.pi/agent/auth.json` is now resolved by the harness without any env var. The harness gains two optional
`HarnessOptions` fields (`authStorage`, `modelRegistry`) for callers that want to supply their own
file-backed or in-memory stores. No public method signature changes (`initialize(options?)` stays
optional `HarnessOptions`; `terminate()` unchanged). Behavioral risk is contained to "what store does
`initialize()` build when no options are given" — from in-memory (env/overrides only) to file-backed
(env/overrides/auth.json/models.json), which is strictly MORE capable and is the documented contract.

### Success Criteria

- [ ] `initialize()` no options → builds `AuthStorage.create()` (file-backed; default
      `getAgentDir()/auth.json`) and `ModelRegistry.create(authStorage)` (file-backed; default
      `getAgentDir()/models.json`). (Assert via the file-consultation test, §Tasks.)
- [ ] `initialize({ authStorage: AuthStorage.inMemory({...}) })` → the harness uses the INJECTED store
      (not a freshly-built one). Assert via reference identity (`harness.authStorage === injected`).
- [ ] `initialize({ modelRegistry })` → the harness uses the injected registry (`harness.modelRegistry === injected`).
- [ ] `initialize()` stays idempotent (second call is a no-op; same store reference preserved).
- [ ] `terminate()` nulls `sdk`/`authStorage`/`modelRegistry`/`options` (unchanged behavior).
- [ ] `HarnessOptions` has the new optional `authStorage?: AuthStorage` + `modelRegistry?: ModelRegistry`
      fields; `import type { AuthStorage, ModelRegistry }` added to `src/types/harnesses.ts`.
- [ ] Groundswell tests do NOT read the real `~/.pi/agent/auth.json` (isolated via temp `PI_CODING_AGENT_DIR`).
- [ ] `npm run lint && npm test` pass in groundswell (incl. new/extended tests).
- [ ] groundswell `dist` rebuilt (`npm run build`) and re-linked into hacky-hack;
      `npm run validate:groundswell` + `tests/unit/groundswell/imports.test.ts` pass in hacky-hack.

## All Needed Context

### Context Completeness Check

If someone knew nothing about this codebase, would they have everything needed? **Yes.** The two-line
edit + the type-seam are fully specified (verbatim current + required code below). The pi-side factory
API surface is `architecture/groundswell_auth_api.md` §2/§3/§6. Every load-bearing finding (the file-backed
defaults, the inject seam, the **copy-not-symlink** dist propagation, the test-isolation need, the
Groundswell validation scripts, the scope boundaries vs T2.S1/T2.S3/T3) is in
`P7M1T2S2/research/verified_facts.md`. The PRD binding is §9.2.6 (+§9.5, §7.5).

### Documentation & References

```yaml
# MUST READ — authoritative, file-level contract for this exact subtask
- file: plan/007_8783a1f5e14a/architecture/implementation_notes.md
  why: "§T2.S2 is the verbatim contract — the current vs required two-line initialize() body, the
        HarnessOptions extension, the idempotency/terminate invariants, the test-seeding requirement
        (AuthStorage.inMemory({ zai:{type:'api_key',key:'...'} })), and the hacky-hack link verification."
  section: "T2 — Provider-Agnostic Authentication Model → T2.S2"

# MUST READ — the pi-side AuthStorage/ModelRegistry API surface (verbatim from node_modules .d.ts)
- file: plan/007_8783a1f5e14a/architecture/groundswell_auth_api.md
  why: "§2 AuthStorage.create(authPath?)/inMemory(data?)/fromStorage + FileAuthStorageBackend default
        join(getAgentDir(),'auth.json') + the getApiKey() priority order (runtime→auth.json api_key→
        auth.json oauth→env→fallback) + the MISSING-FILE tolerance; §3 ModelRegistry.create(authStorage,
        modelsJsonPath?)/inMemory(authStorage) (both REQUIRE a caller AuthStorage; create() reads
        models.json, inMemory() built-ins only); §6 getAgentDir() = ~/.pi/agent overridable via
        PI_CODING_AGENT_DIR."
  section: "§2, §3, §6"
  critical: "AuthStorage.create() does NOT throw on a missing auth.json (constructor calls reload() which
             catches into loadError). So initialize() is safe when the file is absent."

# MUST READ — every load-bearing assumption, empirically verified (incl. the copy-not-symlink finding)
- file: plan/007_8783a1f5e14a/P7M1T2S2/research/verified_facts.md
  why: "§1 the exact lines + surrounding initialize() structure; §2 the static factory sigs + AuthStorageData;
        §3 HarnessOptions seam + the type-doc sanction; §4 zero blast radius; §5 the existing test
        assertions that stay green + WHY + the PI_CODING_AGENT_DIR isolation fix; §6 CRITICAL: hacky-hack
        consumes a COPY of dist (readlink/file proof) → must rebuild + npm link; §7 groundswell validation
        scripts (lint=tsc --noEmit; NO coverage threshold); §8 hacky-hack verification; §9–§10 scope
        boundaries (no overlap with T2.S1/T2.S3/T3; no ProviderOptions edit)."
  section: "§1–§10 (read all)"

# MUST READ — the PRD requirement being satisfied (binding)
- file: PRD.md
  why: "§9.2.6 'Groundswell contract change (auth.json support)' — the verbatim requirement this subtask
        implements; §7.5 (HarnessOptions per-harness extension sanction); §9.5 roadmap step 1 (cross-repo:
        switch pi harness to AuthStorage.create()); §9.2.7 (T3 preflight consumes AuthStorage.hasAuth —
        T2.S2 makes it accurate)."
  section: "9.2.6 (primary: 'Groundswell contract change'), 7.5, 9.5, 9.2.7"

# MUST READ — the file under edit (the two-line change target + idempotent guard + fields + terminate)
- file: ~/projects/groundswell/src/harnesses/pi-harness.ts
  why: "THE primary edit target. initialize() lines ~143–145 (AuthStorage.inMemory()/ModelRegistry.inMemory).
        AuthStorage+ModelRegistry are ALREADY value-imported at the top — no new value import needed."
  pattern: "Keep `if (this.sdk) return;` idempotent guard FIRST; keep the try/catch lazy SDK import; keep
            `this.options = options ?? null`; keep resolveModel()'s setRuntimeApiKey/find flow UNCHANGED
            (composes with file-backed auth — runtime override is highest priority); keep terminate()
            nulling sdk/authStorage/modelRegistry/options."
  gotcha: "Switching to AuthStorage.create() makes initialize() read ~/.pi/agent/auth.json + models.json.
           Benign for correctness (missing-file tolerant), but TESTS must isolate PI_CODING_AGENT_DIR to a
           temp dir (determinism + no host-cred reads) — see Tasks."

# MUST READ — the file under edit (the HarnessOptions injection seam)
- file: ~/projects/groundswell/src/types/harnesses.ts
  why: "Add the type-only import + the two optional fields. The interface doc ALREADY sanctions per-harness
        extension (PRD §7.5) — adding authStorage?/modelRegistry? there is the mandated seam."
  pattern: "Add `import type { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';` at top.
            Append the two optional fields to HarnessOptions with JSDoc. Do NOT add them to the deprecated
            ProviderOptions (src/types/providers.ts)."
  gotcha: "harnesses.ts is a PURE-TYPES module (no runtime emission). The import MUST be `import type` so
           it is erased at compile time and the module stays type-only."

# MUST READ — the existing initialize/terminate tests (to sanitize + extend, NOT break)
- file: ~/projects/groundswell/src/__tests__/unit/providers/pi-harness-initialize.test.ts
  why: "Uses REAL imports (no vi.mock) — proves the SDK loads. Asserts instanceof/not-null/idempotency
        (all still pass under create()). ADD the PI_CODING_AGENT_DIR isolation + the new inject/file-backed
        describe block here."
  pattern: "Mirror the existing `describe('Registry + AuthStorage built')` + `describe('Idempotent Behavior')`
            style (vitest globals; @ts-expect-error to read private fields). Use `vi.stubEnv('PI_CODING_AGENT_DIR', tmpDir)`
            in beforeEach + delete/restore in afterEach."
  gotcha: "Set PI_CODING_AGENT_DIR BEFORE harness.initialize() (getAgentDir() reads it at AuthStorage.create()
           time). Seed auth.json with `JSON.stringify({ zai: { type: 'api_key', key: 'test-zai-key' } })`
           into `${tmpDir}/auth.json` for the file-backed-consultation test."

# REFERENCE — the type-suite (add a minimal assertion for the new optional fields)
- file: ~/projects/groundswell/src/__tests__/unit/harnesses-types.test.ts
  why: "Already asserts HarnessOptions shape ('should have slimmed fields', 'should allow all fields to be
        optional'). Add the two new optional fields to those assertions to keep the type-suite honest."

# REFERENCE — the validate-groundswell script (the hacky-hack-side link check)
- file: ~/projects/hacky-hack/src/scripts/validate-groundswell.ts
  why: "Does `npm list groundswell` + `import('groundswell')` + checks named exports. Confirms the rebuilt
        dist imports cleanly. NOTE: PiHarness is NOT in its required-exports list, so it won't catch a
        PiHarness regression directly — but a broken dist (e.g. a bad type re-export) WILL fail the import."
```

### Current Codebase tree (relevant slice — `~/projects/groundswell`)

```bash
~/projects/groundswell/
  src/
    harnesses/
      pi-harness.ts            # ← EDIT: initialize() lines ~143–145 (inMemory → create + seam)
      claude-code-harness.ts   # unchanged (ClaudeCodeHarnessOptions extends HarnessOptions — additive OK)
    types/
      harnesses.ts             # ← EDIT: +import type {AuthStorage,ModelRegistry}; +2 optional fields + JSDoc
      providers.ts             # READ ONLY (deprecated ProviderOptions — do NOT touch)
    index.ts                   # re-exports HarnessOptions — additive, no edit needed
    core/agent.ts              # reads HarnessOptions.sessionId only — additive OK, no edit
    utils/harness-config.ts    # resolveHarnessConfig returns HarnessOptions — additive OK, no edit
  src/__tests__/unit/
    providers/
      pi-harness-initialize.test.ts   # ← EDIT/EXTEND: PI_CODING_AGENT_DIR isolation + inject/file-backed tests
      pi-harness-resolvemodel.test.ts # unchanged (vi.mock-based; orthogonal)
      pi-harness-execute.test.ts      # unchanged
      ... (other pi-harness-*.test.ts) # unchanged
    harnesses-types.test.ts           # ← EDIT (minimal): assert new optional HarnessOptions fields
    harnesses-config-types.test.ts    # unchanged
  package.json                # scripts: build=tsc, lint=tsc --noEmit, test=vitest run (NO coverage threshold)
  vitest.config.ts            # include src/__tests__/**, globals:true, NO coverage thresholds
  tsconfig.json               # strict, moduleResolution=bundler, isolatedModules; excludes tests from build
  dist/                       # ← REBUILD via `npm run build`; then re-link into hacky-hack
# hacky-hack side (verification only — NO source edits in T2.S2):
~/projects/hacky-hack/
  node_modules/groundswell/   # currently a COPY of dist (NOT a symlink) → re-link via `npm link`
  src/scripts/validate-groundswell.ts
  tests/unit/groundswell/imports.test.ts
  package.json                # "groundswell": "^1.0.0" (version range, not link:/file:)
```

### Desired Codebase tree with files added/changed

```bash
~/projects/groundswell/src/types/harnesses.ts                      # MODIFIED — +type import; +authStorage?/modelRegistry? on HarnessOptions; +JSDoc
~/projects/groundswell/src/harnesses/pi-harness.ts                 # MODIFIED — initialize() 2-line seam + comment + JSDoc
~/projects/groundswell/src/__tests__/unit/providers/pi-harness-initialize.test.ts  # MODIFIED/EXTENDED — PI_CODING_AGENT_DIR isolation + inject/file-backed describe
~/projects/groundswell/src/__tests__/unit/harnesses-types.test.ts  # MODIFIED (minimal) — assert new optional fields
~/projects/groundswell/dist/                                     # REBUILT — `npm run build` (tsc)
~/projects/hacky-hack/node_modules/groundswell                    # RE-LINKED — `npm link groundswell` (copy → symlink to source tree)
# (PRD.md, tasks.json, prd_snapshot.md, .gitignore — READ ONLY, never touch; no hacky-hack src edits)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — hacky-hack consumes a COPY of groundswell dist, NOT a symlink (verified_facts.md §6).
//   readlink -f ~/projects/hacky-hack/node_modules/groundswell → resolves to itself (not a target);
//   file → "directory"; package.json declares "groundswell":"^1.0.0" (version range, not link:/file:).
// IMPLICATION: editing ~/projects/groundswell/src/* does NOT update hacky-hack's node_modules/groundswell/dist.
// You MUST: (1) `cd ~/projects/groundswell && npm run build`; (2) re-link into hacky-hack
//   (`cd ~/projects/groundswell && npm link` then `cd ~/projects/hacky-hack && npm link groundswell`),
//   which replaces the copy with a symlink to the source tree (picks up future rebuilds).
// VERIFY after linking: `readlink -f ~/projects/hacky-hack/node_modules/groundswell` → ~/projects/groundswell.
// The OUTPUT-contract checks (validate:groundswell / imports.test.ts) import from dist → they ONLY pass post-link.

// CRITICAL — AuthStorage.create() reads ~/.pi/agent/auth.json + ModelRegistry.create() reads models.json
// at CONSTRUCTION time (initialize()). AuthStorage is missing-file tolerant (reload() catches into loadError;
// no throw), so initialize() never breaks when the files are absent. BUT in TESTS the default path would
// read the DEVELOPER'S real ~/.pi/agent/auth.json (non-deterministic + credential-hygiene risk).
// FIX: set PI_CODING_AGENT_DIR to a fresh temp dir in beforeEach (vi.stubEnv), unset in afterEach.
// getAgentDir() honors PI_CODING_AGENT_DIR (groundswell_auth_api.md §6) → all AuthStorage.create() calls
// resolve to the temp dir. Seed ${tmpDir}/auth.json for the file-backed-consultation test.

// CRITICAL — AuthStorage + ModelRegistry are ALREADY value-imported in pi-harness.ts (top of file):
//   `import { ModelRegistry, AuthStorage } from "@earendil-works/pi-coding-agent";`
// So initialize() can call AuthStorage.create()/ModelRegistry.create() with NO new value import.
// harnesses.ts (pure-types module) needs a TYPE-ONLY import: `import type { AuthStorage, ModelRegistry }`.

// GOTCHA — Both ModelRegistry.create(authStorage, modelsJsonPath?) and ModelRegistry.inMemory(authStorage)
// REQUIRE a caller-supplied AuthStorage (no overload builds its own — groundswell_auth_api.md §3). So the
// modelRegistry seam MUST default to `ModelRegistry.create(this.authStorage)` (use the just-built authStorage),
// NOT `ModelRegistry.create()` (which would need its own authStorage and isn't the contract).

// GOTCHA — The idempotent guard is `if (this.sdk) return;` (NOT `if (this.authStorage)`). It is evaluated
// FIRST, before any store construction. Do not change the guard or reorder. A second initialize() is a
// no-op and preserves the FIRST store references (test: "should not rebuild the registry on second call").

// GOTCHA — resolveModel() does `this.authStorage.setRuntimeApiKey(spec.provider, this.options.apiKey)`
// BEFORE modelRegistry.find(). This composes correctly with file-backed auth: runtime override is the
// HIGHEST-priority source in AuthStorage.getApiKey() (groundswell_auth_api.md §2 priority order). So an
// injected apiKey still wins over auth.json. Do NOT touch resolveModel().

// GOTCHA — Groundswell `npm run lint` is `tsc --noEmit` on `include: ["src/**/*"]` which EXCLUDES tests
// (tsconfig excludes src/__tests__). So test-file TYPE errors are NOT caught by `npm run lint` — only by
// `npm test` (vitest/esbuild, syntax-level). Keep test types clean regardless.

// GOTCHA — Groundswell vitest.config.ts has NO coverage thresholds (unlike hacky-hack's 100% gate). So
// there is no coverage pressure — but still aim to cover the new branches (inject-authStorage-used,
// inject-modelRegistry-used, file-backed-default-consults-seeded-auth.json).

// GOTCHA — Do NOT add authStorage?/modelRegistry? to the deprecated ProviderOptions (src/types/providers.ts).
// That type is @deprecated and the sanctioned seam is HarnessOptions (PRD §7.5 / implementation_notes §T2.S2).

// GOTCHA — This task touches ONLY the groundswell repo (+ groundswell tests). Do NOT edit hacky-hack src/*
// (T2.S1 owns the hacky-hack side). Do NOT write the hacky-hack resolution-matrix / auth.json-on-disk
// tests (T2.S3 owns those). Do NOT touch the T3 preflight.
```

## Implementation Blueprint

### Data models and structure

No persistence/data-model changes. The only new "shapes" are two optional fields on an existing
interface + the two-line initialize() body. Verbatim:

```ts
// ===== ~/projects/groundswell/src/types/harnesses.ts (MODIFY) =====
// ADD at the top with the other type imports (type-only — keeps the module pure-types):
import type { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';

// EXTEND the existing HarnessOptions interface (append the two optional fields + JSDoc):
export interface HarnessOptions {
  /** API endpoint override */
  endpoint?: string;
  /** API key (forwarded to the LLM provider) */
  apiKey?: string;
  /** Session/resume id */
  sessionId?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Custom headers */
  headers?: Record<string, string>;

  /**
   * Caller-supplied Pi `AuthStorage` (pi harness only; PRD §7.5 per-harness extension).
   *
   * When omitted, the pi harness builds a file-backed `AuthStorage.create()` whose default path is
   * `getAgentDir()/auth.json` (= `~/.pi/agent/auth.json`, overridable via `PI_CODING_AGENT_DIR`) —
   * so a credential written by `pi /login` is honored (PRD §9.2.6). Pass an in-memory store
   * (`AuthStorage.inMemory({ zai: { type:'api_key', key:'...' } })`) to inject/seed auth for tests.
   */
  authStorage?: AuthStorage;

  /**
   * Caller-supplied Pi `ModelRegistry` (pi harness only; PRD §7.5 per-harness extension).
   *
   * When omitted, the pi harness builds a file-backed `ModelRegistry.create(this.authStorage)`
   * (reads `getAgentDir()/models.json`). Must be paired with a compatible `authStorage`.
   */
  modelRegistry?: ModelRegistry;
}

// ===== ~/projects/groundswell/src/harnesses/pi-harness.ts initialize() (MODIFY 2 lines + comment + JSDoc) =====
async initialize(options?: HarnessOptions): Promise<void> {
  // Idempotent guard (mirror ClaudeCodeHarness L233-235).
  if (this.sdk) return;

  // Lazy SDK import (mirror ClaudeCodeHarness L237-248).
  try {
    this.sdk = await import("@earendil-works/pi-coding-agent");
  } catch (error) {
    throw new Error(
      `Failed to load @earendil-works/pi-coding-agent: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
  if (!this.sdk) {
    throw new Error("Failed to load @earendil-works/pi-coding-agent: Import returned null");
  }

  // File-backed by default: AuthStorage.create() reads ~/.pi/agent/auth.json (overridable via
  // PI_CODING_AGENT_DIR) so a `pi /login` credential is honored end-to-end (PRD §9.2.6). Callers
  // MAY inject their own authStorage/modelRegistry (e.g. tests seed AuthStorage.inMemory({...})).
  // getApiKey() priority: runtime override → auth.json api_key → auth.json oauth → env → fallback.
  this.authStorage = options?.authStorage ?? AuthStorage.create();
  this.modelRegistry = options?.modelRegistry ?? ModelRegistry.create(this.authStorage);

  // Store options; apiKey is applied per-provider in resolveModel (GOTCHA #8).
  this.options = options ?? null;
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD the HarnessOptions injection seam (src/types/harnesses.ts)
  - ADD type-only import: `import type { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';`
    (place with the existing `import type { ... } from './sdk-primitives.js'` block; TYPE-ONLY keeps the
    pure-types module runtime-empty).
  - APPEND to the `HarnessOptions` interface: `authStorage?: AuthStorage;` and `modelRegistry?: ModelRegistry;`
    with the JSDoc above (cite PRD §7.5 + §9.2.6 + the PI_CODING_AGENT_DIR override + the in-memory test seed).
  - DO NOT touch the deprecated ProviderOptions (src/types/providers.ts) or any other type.
  - VERIFY: `cd ~/projects/groundswell && npm run lint` (tsc --noEmit) — the new type-only import must
    resolve (pi-coding-agent is a direct dep; skipLibCheck:true).
  - DEPENDENCY: none (this is the type foundation).

Task 2: CHANGE initialize() to the file-backed default + seam (src/harnesses/pi-harness.ts)
  - REPLACE the two lines (currently `this.authStorage = AuthStorage.inMemory();` +
    `this.modelRegistry = ModelRegistry.inMemory(this.authStorage);`) with the seam in Data models above.
  - REPLACE the preceding comment ("Headless registry: no disk...") with the file-backed explanation
    (cites PRD §9.2.6; the PI_CODING_AGENT_DIR override; the getApiKey priority; the inject seam).
  - UPDATE the initialize() JSDoc: drop "builds a headless ModelRegistry.inMemory(...)" / "Headless";
    state "builds a file-backed AuthStorage.create()/ModelRegistry.create() honoring ~/.pi/agent/auth.json
    (PRD §9.2.6), unless the caller injects authStorage/modelRegistry (PRD §7.5)."
  - KEEP: the `if (this.sdk) return;` idempotent guard (FIRST), the try/catch lazy SDK import, the
    `this.options = options ?? null` line, `resolveModel()` (setRuntimeApiKey+find), and `terminate()`.
  - VERIFY: `npm run lint` + `npx vitest run src/__tests__/unit/providers/pi-harness-initialize.test.ts`
    (existing assertions: instanceof/not-null/idempotency must still pass).
  - DEPENDENCY: Task 1.

Task 3: SANITIZE + EXTEND pi-harness-initialize.test.ts
  - ADD to the top of the file (with the other imports): `import { AuthStorage } from '@earendil-works/pi-coding-agent';`
    and `import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';` + `import { tmpdir } from 'node:os';`
    + `import { join } from 'node:path';`.
  - ADD an outer beforeEach (shared by both describe blocks): create a temp dir, `vi.stubEnv('PI_CODING_AGENT_DIR', tmpDir)`
    so NO real ~/.pi/agent/* is read by the default path. afterEach: `vi.unstubAllEnvs();` + `rmSync(tmpDir, {recursive:true, force:true})`.
  - KEEP all existing assertions green (they assert shape, not contents — still pass under create()).
  - ADD `describe('auth.json support + injectable storage (PRD §9.2.6)')`:
      * it('uses an injected authStorage as-is (reference identity)') —
        `const auth = AuthStorage.inMemory({ zai: { type:'api_key', key:'injected-key' } });`
        `await harness.initialize({ authStorage: auth });`
        `// @ts-expect-error expect(harness.authStorage).toBe(auth);`  (SAME reference, not a rebuild)
      * it('uses an injected modelRegistry as-is (reference identity)') — build
        `const auth = AuthStorage.inMemory({ zai: {...} }); const reg = ModelRegistry.create(auth);`
        `await harness.initialize({ authStorage: auth, modelRegistry: reg }); expect(harness.modelRegistry).toBe(reg);`
        (import ModelRegistry — already imported at top of the test file).
      * it('default (no options) is file-backed and consults a seeded auth.json') — write
        `${tmpDir}/auth.json` with `JSON.stringify({ zai: { type:'api_key', key:'from-file-key' } })`;
        `await harness.initialize();` (no options → AuthStorage.create() reads the temp auth.json);
        assert the credential is visible: `// @ts-expect-error const auth = harness.authStorage;`
        `expect(await auth!.getApiKey('zai')).toBe('from-file-key');` (proves the file was consulted).
      * it('default (no options) tolerates a missing auth.json (no throw, no stored creds)') — ensure
        `${tmpDir}/auth.json` is absent; `await expect(harness.initialize()).resolves.not.toThrow();`
        `// @ts-expect-error expect(await harness.authStorage!.getApiKey('zai')).toBeUndefined();`
  - VERIFY: `npx vitest run src/__tests__/unit/providers/pi-harness-initialize.test.ts` — all green,
    incl. the new block. CONFIRM no test reads the real `~/.pi/agent/auth.json` (the temp-dir isolation).
  - DEPENDENCY: Tasks 1–2.

Task 4: MINIMAL harnesses-types.test.ts assertion (keep the type-suite honest)
  - In `describe('HarnessOptions')`, add the two new optional fields to the existing "should have slimmed
    fields" / "should allow all fields to be optional" assertions (e.g. construct an options object with
    `authStorage`/`modelRegistry` omitted → still valid; and assert `options.authStorage` is undefined by
    default). Optionally add an explicit `it('accepts optional authStorage/modelRegistry (pi inject seam)')`.
  - NOTE: these fields are typed as `AuthStorage`/`ModelRegistry` (instances), so the test constructs
    minimal stand-ins only if asserting presence — omitting them is the simpler assertion.
  - VERIFY: `npx vitest run src/__tests__/unit/harnesses-types.test.ts`.
  - DEPENDENCY: Task 1.

Task 5: REBUILD + RE-LINK (cross-repo propagation — CRITICAL)
  - RUN: `cd ~/projects/groundswell && npm run build`   # tsc → regenerates dist/ (incl. dist/types/harnesses.d.ts
    with the new fields + dist/harnesses/pi-harness.js with the seam).
  - RUN: `cd ~/projects/groundswell && npm link`        # registers the source tree as a linkable.
  - RUN: `cd ~/projects/hacky-hack && npm link groundswell`  # REPLACES the copy in node_modules/groundswell
    with a symlink to ~/projects/groundswell (so future rebuilds are picked up automatically).
  - VERIFY (binding): `readlink -f ~/projects/hacky-hack/node_modules/groundswell` → resolves to
    `/home/dustin/projects/groundswell` (symlink confirmed).
  - VERIFY (binding): the new field is in the consumed dist:
    `grep -n "authStorage" ~/projects/hacky-hack/node_modules/groundswell/dist/types/harnesses.d.ts` → ≥1 hit.
  - WHY: hacky-hack consumes groundswell dist via a COPY today (verified_facts.md §6); without rebuild +
    re-link, the OUTPUT-contract checks (validate:groundswell / imports.test.ts) test the STALE dist.
  - DEPENDENCY: Tasks 1–4.

Task 6: VALIDATE (both repos)
  - GROUNDSWELL: `cd ~/projects/groundswell && npm run lint && npm test`
    (lint = tsc --noEmit; test = vitest run — full suite incl. new/extended tests).
  - HACKY-HACK: `cd ~/projects/hacky-hack && npm run validate:groundswell && npx vitest run tests/unit/groundswell/imports.test.ts`
    (confirms the rebuilt+relinked dist imports cleanly + the link is valid).
  - DEPENDENCY: Task 5.
```

### Implementation Patterns & Key Details

```ts
// ── initialize() — the file-backed default + inject seam (pi-harness.ts) ────────────────────
async initialize(options?: HarnessOptions): Promise<void> {
  if (this.sdk) return;                                    // idempotent guard FIRST (unchanged)
  try { this.sdk = await import("@earendil-works/pi-coding-agent"); }
  catch (error) { /* … unchanged descriptive error … */ }
  if (!this.sdk) throw new Error("…Import returned null");

  // File-backed by default (PRD §9.2.6): AuthStorage.create() reads ~/.pi/agent/auth.json
  // (overridable via PI_CODING_AGENT_DIR); ModelRegistry.create() reads models.json. Callers MAY
  // inject their own (PRD §7.5) — e.g. tests seed AuthStorage.inMemory({ zai: {...} }).
  this.authStorage   = options?.authStorage   ?? AuthStorage.create();
  this.modelRegistry = options?.modelRegistry ?? ModelRegistry.create(this.authStorage);
  this.options = options ?? null;                          // unchanged
}

// ── pi-harness-initialize.test.ts — the temp-dir isolation + the file-backed-consultation test ──
import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('PiHarness - initialize()', () => {
  let tmpAgentDir: string;
  beforeEach(() => {
    tmpAgentDir = mkdtempSync(join(tmpdir(), 'pi-auth-'));
    vi.stubEnv('PI_CODING_AGENT_DIR', tmpAgentDir);   // isolate: NO real ~/.pi/agent/* reads
    harness = new PiHarness();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tmpAgentDir, { recursive: true, force: true });
    /* … existing HarnessRegistry reset … */
  });

  describe('auth.json support + injectable storage (PRD §9.2.6)', () => {
    it('default (no options) consults a seeded auth.json (file-backed)', async () => {
      writeFileSync(join(tmpAgentDir, 'auth.json'),
        JSON.stringify({ zai: { type: 'api_key', key: 'from-file-key' } }));
      await harness.initialize();                       // no options → AuthStorage.create() → reads file
      // @ts-expect-error - reading private field
      expect(await harness.authStorage.getApiKey('zai')).toBe('from-file-key');
    });
    it('uses an injected authStorage as-is (reference identity)', async () => {
      const auth = AuthStorage.inMemory({ zai: { type: 'api_key', key: 'injected' } });
      await harness.initialize({ authStorage: auth });
      // @ts-expect-error
      expect(harness.authStorage).toBe(auth);           // SAME ref — not rebuilt
    });
    it('uses an injected modelRegistry as-is', async () => {
      const auth = AuthStorage.inMemory({ zai: { type: 'api_key', key: 'injected' } });
      const reg = ModelRegistry.create(auth);
      await harness.initialize({ authStorage: auth, modelRegistry: reg });
      // @ts-expect-error
      expect(harness.modelRegistry).toBe(reg);
    });
    it('tolerates a missing auth.json (no throw, no creds)', async () => {
      await expect(harness.initialize()).resolves.not.toThrow();   // auth.json absent in tmpAgentDir
      // @ts-expect-error
      expect(await harness.authStorage.getApiKey('zai')).toBeUndefined();
    });
  });
});
```

### Integration Points

```yaml
CODE (~/projects/groundswell/src/types/harnesses.ts):
  - ADD: `import type { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';`
  - EXTEND HarnessOptions: +`authStorage?: AuthStorage` +`modelRegistry?: ModelRegistry` (+ JSDoc).

CODE (~/projects/groundswell/src/harnesses/pi-harness.ts):
  - initialize(): replace 2 lines with the seam; refresh preceding comment + JSDoc. (AuthStorage +
    ModelRegistry already value-imported.) KEEP idempotent guard, lazy SDK import, options assignment,
    resolveModel(), terminate().

TESTS (~/projects/groundswell/src/__tests__/unit/providers/pi-harness-initialize.test.ts):
  - ADD PI_CODING_AGENT_DIR temp-dir isolation (beforeEach/afterEach) across BOTH describe blocks.
  - ADD `describe('auth.json support + injectable storage')`: inject-authStorage-identity;
    inject-modelRegistry-identity; default-consults-seeded-auth.json; missing-file-tolerant.

TESTS (~/projects/groundswell/src/__tests__/unit/harnesses-types.test.ts):
  - EXTEND the HarnessOptions assertions to cover the two new optional fields (minimal).

BUILD + LINK (cross-repo):
  - `cd ~/projects/groundswell && npm run build`     # regenerate dist/
  - `cd ~/projects/groundswell && npm link`
  - `cd ~/projects/hacky-hack && npm link groundswell`   # copy → symlink
  - VERIFY: readlink -f ~/projects/hacky-hack/node_modules/groundswell → /home/dustin/projects/groundswell

NO CHANGES TO:
  ~/projects/groundswell/src/harnesses/claude-code-harness.ts   (ClaudeCodeHarnessOptions extends HarnessOptions — additive OK)
  ~/projects/groundswell/src/types/providers.ts                 (deprecated ProviderOptions — READ ONLY)
  ~/projects/groundswell/src/core/agent.ts, src/utils/harness-config.ts, src/index.ts  (additive pass-through)
  ~/projects/groundswell/src/harnesses/pi-harness.ts resolveModel()/terminate()         (unchanged)
  ANY ~/projects/hacky-hack/src/** file                         (T2.S1 owns the hacky-hack side)
  PRD.md, tasks.json, prd_snapshot.md, .gitignore               (READ ONLY — never touch)
```

## Validation Loop

> Run after the relevant task group. Fix before proceeding to the next level. NOTE: T2.S2 is a
> GROUNDSWELL-repo change — most commands run in `~/projects/groundswell`; the final level runs in
> `~/projects/hacky-hack` against the rebuilt + re-linked dist.

### Level 1: Typecheck (after Tasks 1–2)

```bash
cd ~/projects/groundswell
npm run lint            # = tsc --noEmit (strict, moduleResolution=bundler). Primary catcher of:
                        #   - a bad `import type { AuthStorage, ModelRegistry }` in harnesses.ts
                        #   - a malformed options?.authStorage reference in initialize()
                        #   - a stale JSDoc `{@link}` if you add one
# Expected: zero errors.
```

### Level 2: Unit Tests (after Tasks 3–4)

```bash
cd ~/projects/groundswell

# The sanitized + extended initialize/terminate suite (the core of this task).
npx vitest run src/__tests__/unit/providers/pi-harness-initialize.test.ts

# The type-suite (minimal HarnessOptions field assertion).
npx vitest run src/__tests__/unit/harnesses-types.test.ts

# The adjacent pi-harness suites — confirm no collateral (resolveModel uses authStorage).
npx vitest run src/__tests__/unit/providers/pi-harness-resolvemodel.test.ts
npx vitest run src/__tests__/unit/providers/

# Full suite (no coverage threshold in groundswell, but run it whole).
npm test
# Expected: all pass. If a suite relied on the OLD in-memory default reading real creds, it is now
# isolated by PI_CODING_AGENT_DIR — re-confirm determinism (run twice, same result).
```

### Level 3: Acceptance greps (the §9.2.6 contract invariants)

```bash
cd ~/projects/groundswell
# The hard-coded inMemory() calls are GONE from initialize().
rg -n "AuthStorage\.inMemory|ModelRegistry\.inMemory" src/harnesses/pi-harness.ts
# Expected: ZERO hits in initialize() (the only legitimate inMemory use is in TESTS via the inject seam).

# The file-backed default + seam are present.
rg -n "options\?\.\authStorage\s*\?\?\s*AuthStorage\.create|options\?\.\modelRegistry\s*\?\?\s*ModelRegistry\.create" src/harnesses/pi-harness.ts
# Expected: 2 hits (the two seam lines).

# The HarnessOptions injection seam is present + type-imported.
rg -n "authStorage\?:\s*AuthStorage|modelRegistry\?:\s*ModelRegistry" src/types/harnesses.ts
rg -n "import type \{[^}]*AuthStorage[^}]*\} from '@earendil-works/pi-coding-agent'" src/types/harnesses.ts
# Expected: 2 hits (the fields) + 1 hit (the type import).

# The inject seam is NOT added to the deprecated ProviderOptions.
rg -n "authStorage|modelRegistry" src/types/providers.ts
# Expected: ZERO hits (the deprecated type is untouched).

# Tests do NOT read the real ~/.pi/agent (PI_CODING_AGENT_DIR isolation).
rg -n "PI_CODING_AGENT_DIR" src/__tests__/unit/providers/pi-harness-initialize.test.ts
# Expected: ≥1 hit (the vi.stubEnv isolation).
```
Expected: all greps return the stated results.

### Level 4: Cross-repo build + re-link + hacky-hack verification (after Task 5)

```bash
# Rebuild groundswell dist.
cd ~/projects/groundswell && npm run build
# Expected: tsc emits dist/ with no errors.

# Re-link into hacky-hack (replaces the COPY with a symlink to the source tree).
cd ~/projects/groundswell && npm link
cd ~/projects/hacky-hack && npm link groundswell

# CONFIRM the link is now a symlink to the source tree (was a copy before).
readlink -f ~/projects/hacky-hack/node_modules/groundswell
# Expected: /home/dustin/projects/groundswell

# CONFIRM the rebuilt dist carries the change.
grep -n "authStorage" ~/projects/hacky-hack/node_modules/groundswell/dist/types/harnesses.d.ts
# Expected: ≥1 hit (the new optional field is in the consumed type).

# hacky-hack OUTPUT-contract checks (import from the rebuilt dist).
cd ~/projects/hacky-hack
npm run validate:groundswell
# Expected: ✓ all named exports accessible; link validated.

npx vitest run tests/unit/groundswell/imports.test.ts
# Expected: RUNNING GROUNDSWELL IMPORT TESTS … all pass (the HarnessOptions change is additive → no
# imported symbol the test checks is affected).
```
Expected: the link is a symlink to the source tree; the rebuilt dist carries the new field; both hacky-hack
checks pass.

### Level 5: Behavioral smoke (proves auth.json is honored end-to-end via the harness)

```bash
# Seed an isolated ~/.pi/agent/auth.json, then prove the default harness reads it.
cd ~/projects/groundswell
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/agent"
echo '{"zai":{"type":"api_key","key":"smoke-zai-key"}}' > "$TMPDIR/agent/auth.json"
PI_CODING_AGENT_DIR="$TMPDIR/agent" npx tsx -e "
  import('./dist/harnesses/pi-harness.js').then(async ({ PiHarness }) => {
    const h = new PiHarness();
    await h.initialize();                       // no options → file-backed AuthStorage.create()
    const auth = (h).authStorage;               // @ts-ignore private
    console.log(await auth.getApiKey('zai'));   // expect: smoke-zai-key (proves auth.json honored)
  });
"
# Expected: smoke-zai-key
rm -rf "$TMPDIR"
```
Expected: prints `smoke-zai-key` — proving the file-backed default consults auth.json. (The full
resolution matrix — env vars, override precedence, whitespace handling — is owned by T2.S3 in hacky-hack.)

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: `cd ~/projects/groundswell && npm run lint` passes (tsc --noEmit, zero errors).
- [ ] Level 2: `cd ~/projects/groundswell && npm test` passes, incl. the new
      `auth.json support + injectable storage` describe block + the sanitized existing tests.
- [ ] Level 3: acceptance greps return the stated results (no `inMemory()` in initialize(); seam present;
      fields + type-import present; ProviderOptions untouched; PI_CODING_AGENT_DIR isolation present).
- [ ] Level 4: groundswell `dist` rebuilt; hacky-hack re-linked (symlink to source tree confirmed);
      `validate:groundswell` + `tests/unit/groundswell/imports.test.ts` pass.
- [ ] Level 5: behavioral smoke prints `smoke-zai-key` (auth.json honored end-to-end).

### Feature Validation (PRD §9.2.6 + work-item OUTPUT)
- [ ] `initialize()` no options → file-backed `AuthStorage.create()` (default `~/.pi/agent/auth.json`) +
      `ModelRegistry.create(authStorage)`.
- [ ] A `zai` credential in `~/.pi/agent/auth.json` is resolvable via `harness.authStorage.getApiKey('zai')`.
- [ ] `options.authStorage` is used as-is (reference identity, not rebuilt).
- [ ] `options.modelRegistry` is used as-is.
- [ ] `initialize()` stays idempotent; `terminate()` nulls all four fields.
- [ ] The default path tolerates a missing `auth.json` (no throw).
- [ ] Tests never read the real `~/.pi/agent/auth.json` (PI_CODING_AGENT_DIR temp-dir isolation).

### Code Quality Validation
- [ ] The `import { AuthStorage, ModelRegistry }` in harnesses.ts is TYPE-ONLY (`import type`) — keeps the
      pure-types module runtime-empty.
- [ ] `authStorage?`/`modelRegistry?` are on `HarnessOptions` (sanctioned per PRD §7.5), NOT on the
      deprecated `ProviderOptions`.
- [ ] The modelRegistry default uses `ModelRegistry.create(this.authStorage)` (the just-built authStorage),
      not a standalone `ModelRegistry.create()`.
- [ ] `resolveModel()` / `terminate()` / the idempotent guard are unchanged.
- [ ] JSDoc on `initialize()` + `HarnessOptions` reflects the file-backed default + the inject seam.

### Documentation & Cross-Repo Tracking
- [ ] Inline JSDoc refreshed on `initialize()` (drop "headless"; cite PRD §9.2.6) and on the new
      `HarnessOptions` fields (cite PRD §7.5).
- [ ] Commit message notes this is a TRACKED cross-cutting change against the Groundswell repo
      (PRD §9.2.6 / §9.5) and that `dist` was rebuilt + re-linked into hacky-hack.
- [ ] No hacky-hack doc surface touched (this subtask edits only Groundswell repo + Groundswell tests).

---

## Anti-Patterns to Avoid

- ❌ Don't edit `~/projects/hacky-hack/src/**` — T2.S1 owns the hacky-hack side (resolver + forwarding).
      T2.S2 edits ONLY the Groundswell repo (+ Groundswell tests).
- ❌ Don't rebuild/re-link out of order — `npm run build` (groundswell) MUST happen BEFORE
      `npm link groundswell` (hacky-hack), or hacky-hack consumes a stale dist. And verify the link is a
      symlink afterward (it's currently a COPY — verified_facts.md §6).
- ❌ Don't forget the `PI_CODING_AGENT_DIR` test isolation — without it, `initialize()` (no options) reads
      the DEVELOPER'S real `~/.pi/agent/auth.json` (non-deterministic + credential hygiene). Isolate in
      beforeEach across BOTH existing describe blocks.
- ❌ Don't make the `import { AuthStorage, ModelRegistry }` in harnesses.ts a VALUE import — harnesses.ts
      is a pure-types module; it MUST be `import type` (erased at compile time).
- ❌ Don't add `authStorage?`/`modelRegistry?` to the deprecated `ProviderOptions` (src/types/providers.ts)
      — the sanctioned seam is `HarnessOptions` (PRD §7.5).
- ❌ Don't default modelRegistry to `ModelRegistry.create()` with no authStorage — both factories REQUIRE a
      caller-supplied AuthStorage; use `ModelRegistry.create(this.authStorage)` (the just-built store).
- ❌ Don't change the idempotent guard (`if (this.sdk) return;`) or reorder it — it must run FIRST, before
      any store construction, or re-init would rebuild stores and break the "same reference on second call" test.
- ❌ Don't touch `resolveModel()`'s `setRuntimeApiKey`/`find` flow — it composes correctly with file-backed
      auth (runtime override is the highest-priority source; the file adds a LOWER-priority source).
- ❌ Don't write the hacky-hack resolution-matrix / auth.json-on-disk tests here — those are T2.S3's owned
      scope. T2.S2 adds only the in-repo initialize() behavior tests.
- ❌ Don't rely on `npm run lint` to catch TEST type errors — groundswell's tsconfig EXCLUDES `src/__tests__`
      from the build; `npm run lint` (tsc --noEmit) only checks `src/**/*` (non-test). Test type errors
      surface only at `npm test` (esbuild/syntax). Keep test types clean regardless.
- ❌ Don't modify PRD.md, tasks.json, prd_snapshot.md, or .gitignore (READ-ONLY).

---

## Confidence Score

**9/10** — one-pass implementation success likelihood. The core change is a two-line edit + a two-field
type addition, both fully specified with verbatim current/required code, and verified against the
node_modules `.d.ts` signatures and the existing test suite (which keeps passing). The single residual
uncertainty is the precise re-link mechanics for hacky-hack (it consumes a dist COPY today; the
`npm link`-based path is the documented standard and is verified achievable), which is mitigated by the
explicit Level-4 verification (readlink + grep + validate:groundswell + imports.test.ts). All scope
boundaries vs the parallel T2.S1 and the downstream T2.S3/T3 are explicitly fenced.
