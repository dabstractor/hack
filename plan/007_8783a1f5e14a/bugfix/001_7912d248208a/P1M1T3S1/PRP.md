# PRP — P1.M1.T3.S1: Add an auth-store behavior assertion to validate-groundswell.ts

## Goal

**Feature Goal**: Add a **non-mocked, behavior-level** check to `src/scripts/validate-groundswell.ts`
that instantiates the REAL `node_modules/groundswell` `PiHarness`, seeds a temp `auth.json`, and
asserts `harness.authStorage.getApiKey('zai')` resolves the on-disk credential. This closes the
verification gap (PRD §9.5 / Issue 4) that let the stale `AuthStorage.inMemory()` dist ship: today
the validator only checks that exports are *importable*, so it printed `✓ All validations passed!`
against a broken build.

**Deliverable**: A new async function `validateAuthStoreBehavior(): Promise<boolean>` in
`src/scripts/validate-groundswell.ts`, wired into the `results` object and `main()`, plus an
updated JSDoc header documenting what the check validates.

**Success Definition**:
- `npm run validate:groundswell` **PASSES** (exit 0) against the current **fixed** dist
  (`node_modules/groundswell` → symlink to `~/projects/groundswell`, using `AuthStorage.create()`),
  and prints a success line for the auth-store behavior check.
- The same check would **FAIL** (exit 1) if the deployed dist still used `AuthStorage.inMemory()`
  — i.e. `getApiKey('zai')` returns `undefined` (or any value ≠ the seeded constant) → logged via
  `logError` → `results.authStoreBehavior = false` → script exits 1.
- `npm run typecheck` (`tsc --noEmit`) passes on the modified file (the `private authStorage`
  access is handled via a structural cast — see Gotchas).
- The script mirrors the existing `logSection` / `logSuccess` / `logError` / `results` / `allPassed`
  style of the surrounding checks.

## Why

- **Business value**: Issue 1 (Critical) shipped because `validate:groundswell` could not detect a
  stale/unfixed Groundswell dist — it only grepped exports and version. The documented primary
  onboarding flow (`pi /login` → `auth.json`) silently failed at the first LLM call. A behavior
  assertion makes this regression impossible to ship again.
- **Integration**: Lives inside the existing validator that CI/local devs already run
  (`npm run validate:groundswell`). It is the complementary, *deterministic* counterpart to the
  vitest integration test `tests/integration/config/pi-harness-auth.test.ts` (P1.M1.T1.S1) —
  except the validator runs under **tsx** (no vitest alias), so it can exercise the harness
  **in-process** without a subprocess.
- **Scope boundary**: This subtask is ONLY the validator hardening (Issue 4 / T2.S2 fix #3). It does
  NOT touch Groundswell, the harness source, the preflight, or the existing auth tests. It depends
  on P1.M1.T2 (fixed dist already deployed) being complete — which it is.

## What

Add `validateAuthStoreBehavior()` to `src/scripts/validate-groundswell.ts`. It:

1. Creates a temp dir via `mkdtempSync(join(tmpdir(), 'gs-auth-check-'))`.
2. Saves the current `process.env.PI_CODING_AGENT_DIR`, then sets it to the temp dir.
3. Writes `<tmpDir>/auth.json` with `{ zai: { type: 'api_key', key: 'gs-validation-test-key' } }`.
4. Instantiates `const harness = new PiHarness()` and calls `await harness.initialize()` (no
   options → default → `AuthStorage.create()` reads the temp `auth.json`).
5. Reads `const key = await harness.authStorage.getApiKey('zai')` and asserts it equals
   `'gs-validation-test-key'`.
6. In a `finally`: `await harness.terminate()`, restores `PI_CODING_AGENT_DIR` (deletes it if it
   was originally unset), and `rmSync(tmpDir, { recursive: true, force: true })`.
7. Returns `true` on success; `catch`es, logs via `logError`, and returns `false` on any failure.

### Success Criteria

- [ ] New `validateAuthStoreBehavior(): Promise<boolean>` exists and follows the existing style.
- [ ] `results` object gains `authStoreBehavior: false` and `main()` sets it via the new function.
- [ ] `npm run validate:groundswell` exits 0 against the current (fixed) dist and prints the new
      success line.
- [ ] `npm run typecheck` passes (no `private` access error).
- [ ] JSDoc header documents the new auth-store behavior check.
- [ ] Strict-equality assertion (`=== 'gs-validation-test-key'`) guarantees a stale
      `AuthStorage.inMemory()` dist (→ `undefined`) fails the check.

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, could they implement this successfully?_
**Yes** — the PiHarness/AuthStorage API signatures, the `private` typecheck gotcha, the tsx-vs-vitest
dist-resolution contrast, the lazy `PI_CODING_AGENT_DIR` read, and the exact existing style to mirror
are all specified below with verifiable file references.

### Documentation & References

```yaml
# MUST READ — the file being modified (exact current style to mirror)
- file: src/scripts/validate-groundswell.ts
  why: The whole script. Mirror validateImports()/validateDecorators() (async, try/catch,
        logSuccess/logError, return boolean), the results object, and main()'s wiring.
  pattern: 'async function validateX(): Promise<boolean> { logSection(...); try { await import(...);
            logSuccess(...); return true; } catch (e) { logError(...); return false; } }'
  gotcha: Existing fns use dynamic `await import('groundswell')`. You MAY use a static top-level
          `import { PiHarness } from 'groundswell'` instead (both packages are confirmed installed)
          — but a dynamic import keeps failures inside try/catch and matches the file's style.

# MUST READ — the sibling non-mocked test; the CRITICAL CONTRAST (do NOT copy its subprocess hack)
- file: tests/integration/config/pi-harness-auth.test.ts
  why: Proves the exact assertion we need (seed auth.json → getApiKey('zai') === seeded key). Its
        header comment explains WHY it uses a tsx SUBPROCESS.
  critical: That test uses a subprocess ONLY because vitest.config.ts sets `resolve.alias.groundswell`
            → the sibling checkout. The validate script runs under `tsx` (NOT vitest) → NO alias →
            `import 'groundswell'` already resolves to the real node_modules/groundswell dist.
            THEREFORE: in THIS file, instantiate PiHarness IN-PROCESS. DO NOT spawn a subprocess.
            DO NOT add any alias/mock. Copying the subprocess pattern here is wrong.

# MUST READ — root-cause analysis (why the check must be non-mocked)
- docfile: plan/007_8783a1f5e14a/bugfix/001_7912d248208a/architecture/auth_resolution_blindspot.md
  why: Documents the stale-dist bug, the preflight/harness divergence, and that every auth test
        vi.mock('groundswell') so none touched the real dist. Justifies a NON-mocked check.
  section: "What the New Integration Test Must Do" + "Isolation Gotchas"

# PiHarness API (constructor, initialize, terminate, private authStorage)
- file: node_modules/groundswell/dist/harnesses/pi-harness.d.ts
  why: Confirms `new PiHarness()` (no-arg; see @example in the JSDoc), `initialize(options?):
        Promise<void>` (idempotent; no-arg → AuthStorage.create() default), `terminate():
        Promise<void>` (idempotent).
  critical: 'authStorage' is declared `private authStorage;` (null until initialize()). DIRECT
            access `harness.authStorage` FAILS `tsc --noEmit`. You MUST cast — see Implementation
            Patterns. JS does NOT enforce `private` at runtime, so the cast is safe.

# AuthStorage API (create vs inMemory, getApiKey signature/return type)
- file: node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.d.ts
  why: 'static create(authPath?): AuthStorage' (file-backed) vs 'static inMemory(data?): AuthStorage'
        (empty). 'getApiKey(providerId, options?: { includeFallback?: boolean }):
        Promise<string | undefined>'. Priority: runtime override → auth.json → OAuth → ENV VAR →
        fallback. auth.json (priority 2) wins over an env var (priority 4).
  gotcha: getApiKey is ASYNC — must `await`. Returns `string | undefined`.

# Proof that PI_CODING_AGENT_DIR is read LAZILY (runtime set works)
- file: node_modules/@earendil-works/pi-coding-agent/dist/config.js
  why: 'getAgentDir()' (line ~404) reads `process.env.PI_CODING_AGENT_DIR` at CALL TIME, and
        `AuthStorage.create()` (auth-storage.js) calls `getAgentDir()` inside `create()`. PiHarness
        calls `AuthStorage.create()` inside `initialize()`. So setting process.env.PI_CODING_AGENT_DIR
        BEFORE `await harness.initialize()` causes the default store to read your temp auth.json.
        (Also confirmed by the PRD's verified /tmp/repro.mts.)
```

### Current Codebase tree (relevant slice)

```bash
src/scripts/
  validate-groundswell.ts   # <-- MODIFY (add validateAuthStoreBehavior + results wiring + JSDoc)
  validate-api.ts
node_modules/groundswell -> ../../groundswell   # symlink to the FIXED repo (already deployed by T2)
node_modules/@earendil-works/pi-coding-agent/    # devDep ^0.79.8 (AuthStorage, getAgentDir)
tests/integration/config/
  pi-harness-auth.test.ts   # sibling non-mocked test (P1.M1.T1.S1) — reference, not modified
```

### Desired Codebase tree with files to be added/changed

```bash
src/scripts/validate-groundswell.ts   # MODIFIED — one new fn + results key + main() line + JSDoc
# (no new files)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL 1 — `private authStorage` breaks tsc --noEmit on direct access.
//   `harness.authStorage` is `private` in PiHarness's type. TypeScript rejects it.
//   FIX: cast through a structural type (JS does not enforce private at runtime):
//     const storage = (harness as unknown as { authStorage: AuthStorage | null }).authStorage;
//     if (!storage) { logError('...'); return false; }
//     const key = await storage.getApiKey('zai');   // Promise<string | undefined>
//   This is THE make-or-break detail for `npm run typecheck`.

// CRITICAL 2 — do NOT use a subprocess or vi.mock here.
//   The sibling test (tests/integration/config/pi-harness-auth.test.ts) spawns tsx because
//   vitest.config.ts aliases 'groundswell' → the sibling checkout. This validator runs under
//   `tsx` directly (no vitest, no alias), so a plain in-process `new PiHarness()` already hits the
//   real node_modules/groundswell dist. A subprocess/mock here would defeat the purpose.

// CRITICAL 3 — set PI_CODING_AGENT_DIR BEFORE initialize(); restore it correctly in finally.
//   getAgentDir() reads it lazily at initialize()-time. Save the original: if it was undefined,
//   `delete process.env.PI_CODING_AGENT_DIR` (do NOT set the string 'undefined').

// QUIRK 4 — terminate() is async (Promise<void>). `await harness?.terminate()` in finally; guard
//   with `?.` in case `new PiHarness()`/initialize() threw before assignment.

// ROBUSTNESS 5 — assert STRICT equality (=== 'gs-validation-test-key'), not just truthiness.
//   A stale inMemory() dist returns `undefined` → fails. Even in the unlikely case an inMemory
//   store fell back to an env var, the env value != our seeded constant → still fails. This makes
//   the guard immune to a developer's shell env (no need to clear ZAI_API_KEY, though you may).

// STYLE 6 — the existing script uses dynamic `await import('groundswell')` inside each check so a
//   missing/throwing import is caught and logged (not a hard crash). Prefer matching that style:
//   `const { PiHarness } = await import('groundswell');` inside the function, and a type-only
//   `import type { AuthStorage } from '@earendil-works/pi-coding-agent';` at the top for the cast.
```

## Implementation Blueprint

### Data models and structure

No new data models. The check is purely behavioral. The only type introduced is a **type-only**
import for the structural cast:

```typescript
import type { AuthStorage } from '@earendil-works/pi-coding-agent';
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/scripts/validate-groundswell.ts — imports
  - ADD top-level type import: `import type { AuthStorage } from '@earendil-works/pi-coding-agent';`
  - EXTEND the existing `import { existsSync } from 'node:fs';` to also import
    `mkdtempSync, writeFileSync, rmSync`.
  - ADD `import { tmpdir } from 'node:os';` (join is already imported from 'node:path').
  - DO NOT add a static value import of AuthStorage/PiHarness unless you choose the static style;
    the reference below uses a dynamic `await import('groundswell')` to match the file's pattern.

Task 2: ADD `validateAuthStoreBehavior(): Promise<boolean>` (place it after validateDecorators)
  - IMPLEMENT per the "Implementation Patterns" reference below.
  - MIRROR style of validateImports()/validateDecorators(): logSection → try → logSuccess →
    return true | catch → logError → return false.
  - NAMING: `validateAuthStoreBehavior` (exact, per the work-item contract).
  - RETURN: boolean (true = file-backed AuthStorage.create() working; false = stale/broken).

Task 3: MODIFY the `results` object and `main()` to wire in the new check
  - In the `results` object initializer, ADD: `authStoreBehavior: false,`
  - In `main()`, after `results.decorators = await validateDecorators();`, ADD:
      `results.authStoreBehavior = await validateAuthStoreBehavior();`
  - PRESERVE all existing checks and the `allPassed = Object.values(results).every(r => r)` logic
    (adding a key to `results` automatically folds it into the final pass/fail — do not change that).

Task 4: UPDATE the JSDoc header comment (top of file) — Mode A docs
  - Add a bullet under the existing @remarks documenting the new check, e.g.:
      "* Auth-store behavior: instantiates the real `PiHarness`, seeds a temp `auth.json`
        (via `PI_CODING_AGENT_DIR`), and asserts `harness.authStorage.getApiKey('zai')` resolves
        the on-disk key — fails if the deployed `node_modules/groundswell` dist still uses
        `AuthStorage.inMemory()` (PRD §9.2.6 / §9.5)."

Task 5: VALIDATE (do not skip — see Validation Loop)
  - `npm run typecheck` MUST pass (verifies the private-access cast).
  - `npm run validate:groundswell` MUST exit 0 against the current (fixed) dist.
```

### Implementation Patterns & Key Details

Reference implementation for `validateAuthStoreBehavior` (adapt names/logging to taste, but keep
the cast, the ordering, and the strict equality):

```typescript
/**
 * Validates that the deployed `node_modules/groundswell` PiHarness uses a FILE-BACKED auth store
 * (PRD §9.2.6 / §9.5). Seeds a temp `auth.json` and asserts the harness resolves it — fails if
 * the dist is stale (still `AuthStorage.inMemory()`), which silently ignores `~/.pi/agent/auth.json`.
 */
async function validateAuthStoreBehavior(): Promise<boolean> {
  logSection('Validating PiHarness auth-store behavior (file-backed)');

  const EXPECTED_KEY = 'gs-validation-test-key';
  const previousDir = process.env.PI_CODING_AGENT_DIR; // may be undefined
  const tmpDir = mkdtempSync(join(tmpdir(), 'gs-auth-check-'));
  let harness: { terminate(): Promise<void> } | undefined;

  try {
    // Point the SDK's default AuthStorage.create() at our temp dir (read lazily at initialize()-time).
    process.env.PI_CODING_AGENT_DIR = tmpDir;
    writeFileSync(
      join(tmpDir, 'auth.json'),
      JSON.stringify({ zai: { type: 'api_key', key: EXPECTED_KEY } })
    );

    // Real (non-mocked) import — the validate script runs under tsx (no vitest alias), so this
    // resolves to the actual node_modules/groundswell dist.
    const { PiHarness } = await import('groundswell');
    harness = new PiHarness();
    await harness.initialize(); // no options → AuthStorage.create() default → reads tmpDir/auth.json

    // authStorage is `private` in PiHarness; cast to access at runtime (JS does not enforce private).
    const authStorage = (harness as unknown as {
      authStorage: AuthStorage | null;
    }).authStorage;
    if (!authStorage) {
      logError('PiHarness.authStorage is null after initialize() — default file-backed store was not built');
      return false;
    }

    const key = await authStorage.getApiKey('zai'); // Promise<string | undefined>
    if (key !== EXPECTED_KEY) {
      logError(
        `PiHarness did NOT resolve auth.json (got ${JSON.stringify(key)}). ` +
          'The deployed node_modules/groundswell dist is likely stale (AuthStorage.inMemory) — re-link/rebuild Groundswell.'
      );
      return false;
    }

    logSuccess(`PiHarness resolved auth.json-only credential for 'zai' (file-backed AuthStorage.create() working)`);
    return true;
  } catch (error) {
    logError(`Auth-store behavior check failed: ${error}`);
    return false;
  } finally {
    try {
      await harness?.terminate(); // idempotent; releases refs
    } catch {
      /* ignore */
    }
    // Restore correctly: delete the key if it was originally unset (avoid setting 'undefined').
    if (previousDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousDir;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
```

`main()` wiring (minimal diff):

```typescript
const results = {
  installation: false,
  version: false,
  imports: false,
  decorators: false,
  nodeVersion: false,
  authStoreBehavior: false, // <-- ADD
};

// ... existing calls ...
results.decorators = await validateDecorators();
results.authStoreBehavior = await validateAuthStoreBehavior(); // <-- ADD
```

### Integration Points

```yaml
NO database / routes / config changes. Single-file source edit:
  - file: src/scripts/validate-groundswell.ts
  - npm script affected: "validate:groundswell" (already exists: `tsx src/scripts/validate-groundswell.ts`)
  - note: validate:groundswell is NOT part of the standard "validate" script
          (lint + format:check + typecheck + test:run). It is invoked explicitly by CI/devs and
          by the T2.S2 output-verification step. The new check inherits tsx execution semantics.
TYPECHECK SCOPE: tsconfig.build.json includes "src/**/*" → validate-groundswell.ts IS typechecked by
                 `npm run typecheck`. The private-access cast is required for this to pass.
```

## Validation Loop

### Level 1: Syntax & Style (run after editing — fix before proceeding)

```bash
# Type check — THIS IS THE CRITICAL GATE for the `private authStorage` cast.
npx tsc --noEmit -p tsconfig.build.json
# Expected: zero errors. If it errors on `authStorage` access, you forgot the structural cast.

# Lint + format (project scripts)
npm run lint
npm run format:check
# Expected: clean. If lint flags the cast, use the `as unknown as { ... }` form (not `as any`).
```

### Level 2: Unit Tests

N/A — `validate-groundswell.ts` is a standalone script, not unit-tested. Its "test" is running it
(Level 3). (The behavioral coverage of this exact assertion already lives in
`tests/integration/config/pi-harness-auth.test.ts` from P1.M1.T1.S1.)

### Level 3: Integration / Script Execution (the real validation)

```bash
# Run the validator against the CURRENT (fixed) dist. MUST exit 0 and print the new success line.
npm run validate:groundswell
echo "exit=$?"   # Expected: exit=0
# Expected stdout includes:
#   ═══ Validating PiHarness auth-store behavior (file-backed) ═══
#   ✓ PiHarness resolved auth.json-only credential for 'zai' (file-backed AuthStorage.create() working)
#   ✓ All validations passed!

# Confirm the deployed dist is the FIXED one (sanity — proves the check runs against the right code):
grep -n "AuthStorage.create()\|AuthStorage.inMemory()" node_modules/groundswell/dist/harnesses/pi-harness.js
# Expected: line ~103 shows `this.authStorage = options?.authStorage ?? AuthStorage.create();`
# (NOT `AuthStorage.inMemory()`). If you see inMemory(), the dist is stale and the check SHOULD fail.
```

### Level 4: Prove the check detects a STALE dist (optional but recommended once)

The whole point is that a stale `AuthStorage.inMemory()` dist FAILS. To prove the failure path
without reverting the real link, temporarily force the in-memory path and confirm exit 1:

```bash
# Quick proof (restore immediately after): monkey-check by pointing the env at an EMPTY dir so
# auth.json is absent — getApiKey('zai') returns undefined → check fails.
PI_CODING_AGENT_DIR="$(mktemp -d)" npm run validate:groundswell; echo "exit=$?"
# Expected with the REAL (fixed) dist: the check still PASSes, because the harness reads auth.json
#   from PI_CODING_AGENT_DIR — which is empty here → getApiKey returns undefined → FAIL.
#   (i.e. the check correctly fails when the seeded credential is missing.) Restore your shell env.
```

> Note: the strict-equality assertion (`=== 'gs-validation-test-key'`) GUARANTEES the stale-dist
> failure mode regardless of env: `inMemory()` returns `undefined` ≠ constant → `return false`. No
> manual stale-build is required to trust this; Level 4 is only for extra confidence.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` passes (no `private authStorage` error — cast is in place).
- [ ] `npm run lint` passes; `npm run format:check` passes.
- [ ] `npm run validate:groundswell` exits 0 and prints the new success line.

### Feature Validation

- [ ] `validateAuthStoreBehavior()` exists, is async, returns `Promise<boolean>`.
- [ ] `results.authStoreBehavior` is added and set in `main()`.
- [ ] `allPassed` correctly includes the new key (it iterates `Object.values(results)`).
- [ ] Check would fail (returns false) against `AuthStorage.inMemory()` (strict-equality assertion).
- [ ] `finally` always restores `PI_CODING_AGENT_DIR` (deletes if previously unset) and `rmSync`s tmp.
- [ ] JSDoc header documents the new check.

### Code Quality Validation

- [ ] Mirrors existing `logSection` / `logSuccess` / `logError` style.
- [ ] No subprocess, no `vi.mock`, no vitest alias interaction (runs under tsx).
- [ ] No hardcoded paths; uses `tmpdir()` + `mkdtempSync`.
- [ ] Imports added without removing/duplicating existing ones.

### Documentation & Deployment

- [ ] JSDoc header (Mode A) updated — no separate docs subtask.
- [ ] No new env vars introduced (reuses existing `PI_CODING_AGENT_DIR`, restored in `finally`).

---

## Anti-Patterns to Avoid

- ❌ **Do NOT spawn a subprocess** (unlike the sibling vitest test). This script runs under tsx with
  no alias — instantiate `PiHarness` in-process.
- ❌ **Do NOT `vi.mock` anything** — the whole value is exercising the REAL dist.
- ❌ **Do NOT access `harness.authStorage` without the structural cast** — `tsc --noEmit` will fail.
- ❌ **Do NOT set `process.env.PI_CODING_AGENT_DIR = undefined`** (stores the string `'undefined'`);
  `delete` the key when it was originally unset.
- ❌ **Do NOT forget `await`** on `getApiKey`/`initialize`/`terminate` (all return Promises).
- ❌ **Do NOT assert truthiness** — use strict `=== 'gs-validation-test-key'` so an env fallback
  can't mask a stale dist.
- ❌ **Do NOT modify Groundswell, the harness source, preflight, or existing tests** — out of scope.
```
