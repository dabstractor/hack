# PRP — P1.M1.T3.S2: Add symlink/dist-freshness detection for npm-link dev setups

## Goal

**Feature Goal**: Add a **second, informational layer** of stale-dist detection to
`src/scripts/validate-groundswell.ts` that reports whether `node_modules/groundswell` is a **symlink**
(`npm link` dev setup) or a **plain directory** (published npm tarball), and — for the tarball case —
greps the deployed `dist/harnesses/pi-harness.js` to confirm it contains the §9.2.6 fix
(`AuthStorage.create()`, **not** `AuthStorage.inMemory()`). This closes PRD §9.5 / Issue 4: today the
validator only parses `npm list` text and *notes* `-> ` links without ever asserting the install is a
real symlink or that a published tarball actually carries the fix. Combined with the **hard** behavior
assertion from P1.M1.T3.S1, this gives **two layers** of stale-dist detection.

**Deliverable**: A new SYNC function `validateLinkStatus(): boolean` in
`src/scripts/validate-groundswell.ts` (uses `fs.lstatSync(...).isSymbolicLink()` + `fs.readlinkSync` +
`fs.readFileSync` of the dist), wired into the `results` object as a `linkStatus` key and called from
`main()` right after `validateInstallation()`. Plus a trimmed `validateInstallation()` (its redundant
npm-list `-> ` symlink logging moves to the new, more robust function) and an updated JSDoc header.

**Success Definition**:
- `npm run validate:groundswell` **PASSES** (exit 0) against the current **fixed, symlinked** dist
  (`node_modules/groundswell -> ../../groundswell`) and prints a new section:
  `═══ Validating groundswell link status (symlink vs tarball) ═══` with
  `✓ Groundswell linked from: ../../groundswell` (the `readlinkSync` raw target).
- The check is **informational**: even if a published tarball were stale (`AuthStorage.inMemory()`
  present), `validateLinkStatus()` logs a **warning** and returns `true` — it does **not** flip the
  overall exit code. The **hard** gate remains `validateAuthStoreBehavior()` from P1.M1.T3.S1.
- `npm run typecheck` (`tsc --noEmit -p tsconfig.build.json`) passes — the new fn is SYNC, uses only
  `node:fs` sync APIs, and needs **no** `private`-access cast (unlike T3.S1).
- `npm run lint` + `npm run format:check` pass (no `any`, no floating promises).

## Why

- **Business value**: Issue 1 (Critical) escaped because `validate:groundswell` could not tell a real
  `npm link` symlink from a plain npm tarball directory, and never inspected the deployed dist
  content. A developer running `npm run validate:groundswell` against a stale **published** tarball
  saw `✓ All validations passed!` while the harness silently used `AuthStorage.inMemory()`. Reporting
  link-vs-tarball + a dist-content grep for the fix makes this drift immediately visible.
- **Integration**: Lives inside the existing validator CI/devs already run
  (`npm run validate:groundswell`). It is the *informational* companion to the *deterministic hard*
  gate (`validateAuthStoreBehavior()`, T3.S1) and to the vitest integration test
  (`tests/integration/config/pi-harness-auth.test.ts`, T1.S1).
- **Scope boundary**: This subtask is ONLY the link-status/dist-freshness enhancement (Issue 4 /
  T2.S2 fix #1). It does NOT touch Groundswell, the harness source, the preflight, auth tests, or the
  T3.S1 behavior check. It depends on P1.M1.T3.S1 being complete (it is) and on P1.M1.T2 (fixed dist
  already deployed via `npm link`; it is).

## What

Add `validateLinkStatus()` to `src/scripts/validate-groundswell.ts`. It:

1. Computes `const groundswellPath = join(process.cwd(), 'node_modules', 'groundswell');` (same
   `process.cwd()` convention as `validateVersionCompatibility()`).
2. Calls `const stat = lstatSync(groundswellPath);` (NOTE: `lstatSync`, **not** `statSync` — `statSync`
   follows the link and would report `isSymbolicLink() === false`).
3. **If `stat.isSymbolicLink()`** → `const target = readlinkSync(groundswellPath);`
   → `logSuccess(\`Groundswell linked from: ${target}\`);` → `return true;`
   (Trust the source repo for the dev case; the behavior check is the hard gate for both cases.)
4. **Else (plain directory = published tarball)** → verify the deployed dist:
   - `const distPath = join(groundswellPath, 'dist', 'harnesses', 'pi-harness.js');`
   - If `!existsSync(distPath)` → `logWarning(...)` → `return true;` (can't verify; informational).
   - `const src = readFileSync(distPath, 'utf-8');`
   - `const hasFix = src.includes('AuthStorage.create()');`
   - `const hasStale = src.includes('AuthStorage.inMemory()');`
   - If `hasFix && !hasStale` → `logSuccess('Groundswell installed from registry; dist/harnesses/pi-harness.js contains the §9.2.6 fix (AuthStorage.create())');` → `return true;`
   - Else (stale) → `logWarning('Groundswell installed from registry (tarball) but dist appears STALE — pi-harness.js uses AuthStorage.inMemory() instead of AuthStorage.create(). Run npm install groundswell@latest or npm link groundswell. (Informational; the auth-store behavior check is the hard gate.)');` → `return true;`  **← returns true: NOT a hard failure.**
5. **`catch`** any `lstatSync` throw (e.g. nothing installed) → `logError(...)` → `return false;`.

Also:
- **`validateInstallation()`**: remove the now-redundant `if (result.includes(' -> '))` symlink-logging
  branch (that responsibility moves to `validateLinkStatus`, which uses the more robust
  `lstatSync().isSymbolicLink()` instead of parsing `npm list` text). Keep its `npm list groundswell`
  install confirmation + version parse.
- **`main()`**: add `results.linkStatus = validateLinkStatus();` immediately after
  `results.installation = validateInstallation();`.
- **JSDoc header**: add a bullet documenting the link-status check ([Mode A] docs).

### Success Criteria

- [ ] New SYNC `validateLinkStatus(): boolean` exists, placed near `validateInstallation()`.
- [ ] `results` object gains `linkStatus: false`; `main()` sets it after `installation`, before `version`.
- [ ] Uses `lstatSync` (not `statSync`) so symlinks are detected as symlinks.
- [ ] Symlink → `readlinkSync` target logged; tarball+fix → success; tarball+stale → **warning, return true**.
- [ ] `npm run validate:groundswell` exits 0 against the current (symlinked, fixed) dist and prints the new section.
- [ ] `npm run typecheck` / `npm run lint` / `npm run format:check` all pass.
- [ ] JSDoc header documents the new check.

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, could they implement this successfully?_
**Yes** — the exact current function to mirror, the `lstatSync`-vs-`statSync` gotcha, the confirmed
dist line to grep, the `no-floating-promises` reason to stay SYNC, the verified `readlinkSync` raw
output, and the precise `results`/`main()` wiring are all specified below with verifiable references.

### Documentation & References

```yaml
# MUST READ — the file being modified (exact current style + results/main wiring)
- file: src/scripts/validate-groundswell.ts
  why: The whole script. Mirror validateInstallation()/validateNodeVersion() (SYNC, try/catch,
        logSuccess/logWarning/logError, return boolean). See the `results` object and main() wiring
        for where to add the `linkStatus` key + call.
  pattern: 'function validateX(): boolean { logSection(...); try { ...; logSuccess(...); return true; }
            catch (e) { logError(...); return false; } }'
  gotcha: 'validateInstallation() ALREADY has a redundant `if (result.includes(" -> "))` symlink-logging
           branch that parses npm-list TEXT. That branch is now superseded — remove it (the new fn uses
           the more robust fs.lstatSync().isSymbolicLink()). Keep the npm-list install/version confirmation.'

# MUST READ — sibling task that added the HARD behavior gate (T3.S1, COMPLETE)
- file: plan/007_8783a1f5e14a/bugfix/001_7912d248208a/P1M1T3S1/PRP.md
  why: Establishes the two-layer model. THIS task (T3.S2) is the INFORMATIONAL layer; T3.S1 is the
        HARD layer. Do not duplicate the behavior assertion — reference it as the hard gate in your
        warning text. Also confirms validate-groundswell.ts runs under `tsx` (no vitest alias) and
        IS typechecked by tsconfig.build.json (include: ["src/**/*"]).
  critical: 'T3.S1 made validateAuthStoreBehavior() a HARD gate (returns false → exit 1). T3.S2 must
             NOT also hard-fail on a stale tarball — it warns + returns true. Two layers, one hard.'

# MUST READ — deployment strategy (why symlink vs tarball matters; verified npm-link state)
- docfile: plan/007_8783a1f5e14a/bugfix/001_7912d248208a/architecture/deployment_strategy.md
  why: Documents that the bug was a STALE PUBLISHED TARBALL (node_modules/groundswell a plain dir, not
        a symlink) and that the local fix is deployed via `npm link` (→ symlink to ~/projects/groundswell).
        Justifies checking the dist CONTENT only for the tarball case.
  section: "Current State (verified)" + "Recommended Approach ... npm link for immediate local verification"

# MUST READ — root-cause analysis (why stale dist escapes detection)
- docfile: plan/007_8783a1f5e14a/bugfix/001_7912d248208a/architecture/auth_resolution_blindspot.md
  why: Explains the inMemory-vs-create dist divergence that this check greps for.
  section: stale-dist / deployed-pi-harness discussion

# CONFIRMED deployed dist line (grep target) — the FIXED dist
- file: node_modules/groundswell/dist/harnesses/pi-harness.js
  why: 'Line 103 is `this.authStorage = options?.authStorage ?? AuthStorage.create();`. Verified this
        session: `AuthStorage.create()` appears 3x, `AuthStorage.inMemory()` appears 0x. A STALE 1.0.0
        tarball instead shows `AuthStorage.inMemory()` and lacks `?? AuthStorage.create()`.'
  critical: 'Grep for the literal substrings: includes("AuthStorage.create()") [fix present] and
             includes("AuthStorage.inMemory()") [stale marker]. Do NOT regex-match the assignment line.'

# Node fs API — symlink detection MUST use lstat, not stat
- url: https://nodejs.org/api/fs.html#fslstatsyncpath-options
  why: 'fs.lstatSync(path).isSymbolicLink() is the ONLY correct way to detect a symlink WITHOUT following
        it. fs.statSync() FOLLOWS the link → reports the target → isSymbolicLink() === false. This is the
        #1 implementation gotcha.'
  critical: 'Import lstatSync, readFileSync, readlinkSync from "node:fs" (extend the existing top-level
             import; do NOT add a dynamic await import("node:fs") for these — sync is fine and matches
             validateNodeVersion/validateInstallation).'

# PRD §9.5 / §9.2.6 — the fix this check greps for
- file: PRD.md
  why: §9.2.6 (Provider-Agnostic Auth) mandates file-backed AuthStorage.create(); §9.5 references
        `npm run validate:groundswell` as the output-verification step that failed to catch the stale dist.
```

### Current Codebase tree (relevant slice)

```bash
src/scripts/
  validate-groundswell.ts   # <-- MODIFY (add validateLinkStatus + results.linkStatus + main() line;
                            #                 trim validateInstallation() ->branch; update JSDoc)
  validate-api.ts
node_modules/groundswell -> ../../groundswell   # symlink to the FIXED repo (deployed by T2)
node_modules/groundswell/dist/harnesses/pi-harness.js   # line 103: ?? AuthStorage.create()  (FIXED)
```

### Desired Codebase tree with files to be added/changed

```bash
src/scripts/validate-groundswell.ts   # MODIFIED — one new sync fn + results key + main() line +
                                      #            trimmed validateInstallation() branch + JSDoc bullet
# (no new files)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL 1 — use lstatSync, NOT statSync, to detect a symlink.
//   fs.statSync() follows the link and reports the TARGET's stats → isSymbolicLink() === false.
//   fs.lstatSync() does NOT follow the link → isSymbolicLink() === true for node_modules/groundswell.
//   This is THE make-or-break detail for correct symlink detection.

// CRITICAL 2 — this check is INFORMATIONAL; it must NOT hard-fail on a stale tarball.
//   A stale published tarball (AuthStorage.inMemory() present) must log logWarning(...) AND return true.
//   The HARD gate is validateAuthStoreBehavior() (P1.M1.T3.S1). Returning false here would make the
//   script exit 1 on the informational check — contradicting the contract. Only return false on a real
//   fs error (e.g. node_modules/groundswell missing entirely → lstatSync throws).

// CRITICAL 3 — make the function SYNC (return boolean, not Promise<boolean>).
//   eslint rule `@typescript-eslint/no-floating-promises` is "error". lstatSync/readlinkSync/readFileSync
//   are all SYNC, so a sync fn needs no awaits and cannot create a floating promise. This matches the
//   existing sync fns validateInstallation()/validateNodeVersion(). Wire with
//   `results.linkStatus = validateLinkStatus();` (NO `await`).

// QUIRK 4 — readlinkSync returns the RAW link target, which may be RELATIVE.
//   Verified this session: readlinkSync('node_modules/groundswell') → '../../groundswell' (relative).
//   That's fine to log as-is ("linked from: ../../groundswell"). If you prefer the absolute resolved
//   path, add `import { realpathSync }` and log realpathSync(groundswellPath) → '/home/dustin/projects/groundswell'.
//   Either is acceptable; logging the raw readlinkSync target matches the contract wording.

// ROBUSTNESS 5 — grep for literal substrings, not a line regex.
//   `src.includes('AuthStorage.create()')` and `src.includes('AuthStorage.inMemory()')`. Verified:
//   fixed dist has create() (3x) and NO inMemory(); stale 1.0.0 tarball has inMemory() and lacks the
//   `?? AuthStorage.create()` fallback. Fix-present = hasFix && !hasStale.

// SCOPE 6 — the dist-content grep runs ONLY for the tarball (non-symlink) case.
//   For a symlink, trust the source repo (the behavior check covers both). This matches the contract
//   ("If it is NOT a symlink (published tarball), verify the deployed dist").

// STYLE 7 — extend the EXISTING top-level fs import rather than adding a new import line.
//   Current: `import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';`
//   New:     `import { existsSync, lstatSync, readFileSync, readlinkSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';`
//   (validateVersionCompatibility already does a dynamic `await import('node:fs')` for readFileSync —
//   leave it; adding a top-level readFileSync is harmless and not a duplicate-binding error.)
```

## Implementation Blueprint

### Data models and structure

No new data models. No new types (this fn is SYNC and only touches `node:fs` + the existing string
loggers — unlike T3.S1, there is **no** `private`-access cast, **no** `AuthStorage`/`PiHarness` import).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/scripts/validate-groundswell.ts — imports
  - EXTEND the existing top-level import to also bring in lstatSync, readFileSync, readlinkSync:
      import { existsSync, lstatSync, readFileSync, readlinkSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
  - DO NOT add new imports for PiHarness/AuthStorage (not used here).

Task 2: ADD `validateLinkStatus(): boolean` (place it immediately after validateInstallation)
  - SYNC function (return boolean — NOT Promise<boolean>), per CRITICAL 3.
  - MIRROR style of validateInstallation()/validateNodeVersion(): logSection → try → logSuccess/logWarning →
    return true | catch → logError → return false.
  - NAMING: `validateLinkStatus` (exact, per the work-item contract; results key `linkStatus`).
  - IMPLEMENT per the "Implementation Patterns" reference below.

Task 3: TRIM validateInstallation()'s redundant symlink-logging branch
  - REMOVE the `if (result.includes(' -> ')) { ... logSuccess('Groundswell linked from: ...') }` block
    (now handled more robustly by validateLinkStatus via fs.lstatSync). Keep the rest: the `npm list
    groundswell` execSync call, the version-regex parse, and the success/error returns.

Task 4: MODIFY the `results` object and `main()` to wire in the new check
  - In the `results` object initializer, ADD: `linkStatus: false,`
  - In `main()`, immediately after `results.installation = validateInstallation();`, ADD:
      `results.linkStatus = validateLinkStatus();`   (NO await — sync)
  - PRESERVE the `allPassed = Object.values(results).every(r => r)` logic (adding a key auto-folds it in;
    since the new fn returns true on the informational warning path, it won't spuriously fail the gate).

Task 5: UPDATE the JSDoc header comment (top of file) — Mode A docs
  - Add a bullet under the existing @remarks documenting the new check, e.g.:
      "* Link status: detects whether node_modules/groundswell is a symlink (npm link dev setup) or a
        plain directory (published tarball); for tarball installs, greps dist/harnesses/pi-harness.js
        for the §9.2.6 fix (AuthStorage.create(), not AuthStorage.inMemory()). Informational — the hard
        stale-dist gate is the auth-store behavior check above (PRD §9.5 / Issue 4)."

Task 6: VALIDATE (do not skip — see Validation Loop)
  - `npm run typecheck` MUST pass.
  - `npm run lint` + `npm run format:check` MUST pass.
  - `npm run validate:groundswell` MUST exit 0 and print the new link-status section.
```

### Implementation Patterns & Key Details

Reference implementation for `validateLinkStatus` (adapt logging text to taste, but keep the
`lstatSync`, the sync signature, the substring greps, and the **return true on stale** rule):

```typescript
/**
 * Reports whether node_modules/groundswell is a symlink (npm link dev setup) or a plain directory
 * (published npm tarball). For tarball installs, greps dist/harnesses/pi-harness.js to confirm the
 * deployed build carries the §9.2.6 fix (AuthStorage.create(), not AuthStorage.inMemory()).
 *
 * INFORMATIONAL: never hard-fails on a stale tarball — logs a warning and returns true. The hard
 * stale-dist gate is validateAuthStoreBehavior() (PRD §9.5 / Issue 4).
 */
function validateLinkStatus(): boolean {
  logSection('Validating groundswell link status (symlink vs tarball)');

  const groundswellPath = join(process.cwd(), 'node_modules', 'groundswell');

  try {
    // CRITICAL: lstatSync (NOT statSync) so we see the link itself, not its target.
    const stat = lstatSync(groundswellPath);

    if (stat.isSymbolicLink()) {
      // npm link dev setup — trust the source repo; behavior check is the hard gate.
      const target = readlinkSync(groundswellPath); // raw target (may be relative, e.g. '../../groundswell')
      logSuccess(`Groundswell linked from: ${target}`);
      return true;
    }

    // Plain directory → published npm tarball. Verify the deployed dist carries the §9.2.6 fix.
    const distPath = join(groundswellPath, 'dist', 'harnesses', 'pi-harness.js');
    if (!existsSync(distPath)) {
      logWarning(
        `Groundswell installed as a published tarball, but ${distPath} was not found — cannot verify dist freshness.`
      );
      return true; // informational
    }

    const src = readFileSync(distPath, 'utf-8');
    const hasFix = src.includes('AuthStorage.create()');
    const hasStale = src.includes('AuthStorage.inMemory()');

    if (hasFix && !hasStale) {
      logSuccess(
        'Groundswell installed from registry; dist/harnesses/pi-harness.js contains the §9.2.6 fix (AuthStorage.create()).'
      );
      return true;
    }

    // Stale published tarball — WARNING only (the hard gate is validateAuthStoreBehavior).
    logWarning(
      'Groundswell installed from registry (tarball) but dist appears STALE — ' +
        'pi-harness.js uses AuthStorage.inMemory() instead of AuthStorage.create(). ' +
        'Run `npm install groundswell@latest` or `npm link groundswell`. ' +
        '(Informational; the auth-store behavior check is the hard gate.)'
    );
    return true; // CRITICAL: NOT a hard failure.
  } catch (error) {
    logError(`Failed to determine groundswell link status: ${error}`);
    return false; // real failure (e.g. node_modules/groundswell missing)
  }
}
```

`main()` wiring (minimal diff — show surrounding lines for placement):

```typescript
results.nodeVersion = validateNodeVersion();
results.installation = validateInstallation();
results.linkStatus = validateLinkStatus(); // <-- ADD (sync; no await)
results.version = await validateVersionCompatibility();
results.imports = await validateImports();
results.decorators = await validateDecorators();
results.authStoreBehavior = await validateAuthStoreBehavior();
```

`validateInstallation()` trim (remove the redundant `-> ` branch; keep the npm-list confirmation):

```typescript
// BEFORE (remove this whole if/else link branch):
//   if (result.includes(' -> ')) { const match = ...; logSuccess(`Groundswell linked from: ...`); }
//   else { ...version parse... }

// AFTER (validateInstallation just confirms install + version; link detection is validateLinkStatus):
    const versionMatch = result.match(/groundswell@([\d.]+)/);
    if (versionMatch) {
      logSuccess(`Groundswell installed: ${versionMatch[1]}`);
    } else {
      logSuccess('Groundswell installed');
    }
    return true;
```

### Integration Points

```yaml
NO database / routes / config changes. Single-file source edit:
  - file: src/scripts/validate-groundswell.ts
  - npm script affected: "validate:groundswell" (already exists: `tsx src/scripts/validate-groundswell.ts`).
  - note: validate:groundswell is NOT part of the standard "validate" script
          (lint + format:check + typecheck + test:run). It is invoked explicitly by CI/devs and by the
          T2.S2 output-verification step. The new check inherits tsx execution semantics.
TYPECHECK SCOPE: tsconfig.build.json include: ["src/**/*"] → validate-groundswell.ts IS typechecked by
                 `npm run typecheck`. (No private-access cast this time → low typecheck risk.)
ESLINT: no-explicit-any=warn (don't use `any`); no-floating-promises=error (mitigated by SYNC fn).
```

## Validation Loop

### Level 1: Syntax & Style (run after editing — fix before proceeding)

```bash
# Type check
npx tsc --noEmit -p tsconfig.build.json
# Expected: zero errors. (New fn is sync, no private cast — should be clean.)

# Lint + format (project scripts)
npm run lint
npm run format:check
# Expected: clean. If lint flags an unused import, remove it. Do NOT use `any`.
```

### Level 2: Unit Tests

N/A — `validate-groundswell.ts` is a standalone script, not unit-tested. Its "test" is running it
(Level 3). (The behavioral stale-dist coverage already lives in
`tests/integration/config/pi-harness-auth.test.ts` from P1.M1.T1.S1, and the hard dist gate is
`validateAuthStoreBehavior()` from P1.M1.T3.S1.)

### Level 3: Integration / Script Execution (the real validation)

```bash
# Run the validator against the CURRENT (symlinked, fixed) dist. MUST exit 0 and print the new section.
npm run validate:groundswell
echo "exit=$?"   # Expected: exit=0
# Expected stdout includes (current install is a symlink):
#   ═══ Validating groundswell link status (symlink vs tarball) ═══
#   ✓ Groundswell linked from: ../../groundswell
#   ✓ All validations passed!

# Confirm the deployed dist is the FIXED one (sanity — proves the dist-grep branch sees the right code):
grep -c "AuthStorage.create()" node_modules/groundswell/dist/harnesses/pi-harness.js   # → 3
grep -c "AuthStorage.inMemory()" node_modules/groundswell/dist/harnesses/pi-harness.js  # → 0
# (If you see inMemory()>0 and create()=0, the dist is stale — the symlink branch above is taken
#  because of `npm link`, so the dist grep is NOT exercised in the current state; see Level 4.)

# Confirm the path the code constructs actually resolves (process.cwd() convention sanity):
node -e "const fs=require('fs'),p=require('path');const g=p.join(process.cwd(),'node_modules','groundswell');console.log('isSym:',fs.lstatSync(g).isSymbolicLink(),'readlink:',fs.readlinkSync(g))"
# → isSym: true  readlink: ../../groundswell
```

### Level 4: Prove the tarball+stale path warns WITHOUT failing (optional but recommended once)

The current install is a symlink, so the **dist-grep branch** is not exercised by a normal run. To
prove the informational warning path returns `true` (not a hard failure), exercise the *predicate*
in isolation against synthetic content — no need to unlink the real install:

```bash
# Replicate the exact predicate against (a) a fixed dist string and (b) a stale dist string.
node -e '
  const check = (src) => {
    const hasFix = src.includes("AuthStorage.create()");
    const hasStale = src.includes("AuthStorage.inMemory()");
    if (hasFix && !hasStale) return "success -> return true";
    return "WARNING (stale) -> return true (informational, NOT a hard failure)";
  };
  console.log("fixed:", check("this.authStorage = options?.authStorage ?? AuthStorage.create();"));
  console.log("stale:", check("this.authStorage = AuthStorage.inMemory();"));
'
# Expected:
#   fixed: success -> return true
#   stale: WARNING (stale) -> return true (informational, NOT a hard failure)
# This proves a stale PUBLISHED TARBALL logs a warning + returns true; the HARD failure is left to
# validateAuthStoreBehavior() (P1.M1.T3.S1), which exit-1s on a real stale dist. Two layers, one hard.

# (Optional, if you want to exercise the real tarball branch end-to-end:) temporarily swap the symlink
# for a throwaway dir whose dist is stale, run the validator, confirm exit stays 0 with a ⚠ line, then
# restore: `npm link groundswell`. Only do this on a clean tree you can restore.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` passes (new fn is sync, no private cast).
- [ ] `npm run lint` passes; `npm run format:check` passes.
- [ ] `npm run validate:groundswell` exits 0 and prints the new link-status section + success line.

### Feature Validation

- [ ] `validateLinkStatus(): boolean` exists, is **sync**, returns `boolean`.
- [ ] Uses `lstatSync` (NOT `statSync`) so symlinks are detected correctly.
- [ ] Symlink → `readlinkSync` target logged via `logSuccess`.
- [ ] Tarball + fix → `logSuccess`; tarball + stale → `logWarning` **and returns true** (not hard fail).
- [ ] `results.linkStatus` added and set in `main()` right after `results.installation` (no `await`).
- [ ] `allPassed` correctly includes the new key; a stale-tarball warning does NOT flip exit code.
- [ ] `validateInstallation()`'s redundant `-> ` symlink branch removed (concern moved to `validateLinkStatus`).
- [ ] JSDoc header documents the new check.

### Code Quality Validation

- [ ] Mirrors existing `logSection` / `logSuccess` / `logWarning` / `logError` style.
- [ ] No `any`; no floating promises (sync fn).
- [ ] Extends the existing top-level `node:fs` import (no duplicate dynamic import required).
- [ ] No subprocess, no `vi.mock`, no vitest alias interaction (runs under tsx).
- [ ] No hardcoded absolute paths; uses `process.cwd()` convention from `validateVersionCompatibility`.

### Documentation & Deployment

- [ ] JSDoc header (Mode A) updated — no separate docs subtask.
- [ ] No new env vars introduced.

---

## Anti-Patterns to Avoid

- ❌ **Do NOT use `statSync`** to detect a symlink — it follows the link and reports `isSymbolicLink() === false`. Use `lstatSync`.
- ❌ **Do NOT make the stale-tarball case a hard failure** (do not `return false` on a stale dist). The contract mandates an informational **warning** + `return true`; the hard gate is `validateAuthStoreBehavior()` (T3.S1).
- ❌ **Do NOT make the function async** unless you also `await` it everywhere — `no-floating-promises` is `error`. Prefer SYNC (all fs calls used are sync).
- ❌ **Do NOT grep the assignment line with a regex** — use `src.includes('AuthStorage.create()')` / `includes('AuthStorage.inMemory()')` literal substrings.
- ❌ **Do NOT run the dist-content grep for the symlink case** — only for the plain-directory (tarball) case (per contract).
- ❌ **Do NOT forget to remove the redundant `-> ` branch** in `validateInstallation()` — otherwise two "linked from" lines appear (npm-list text + readlinkSync).
- ❌ **Do NOT duplicate the auth-store behavior assertion** — that is T3.S1's job; this task only reports link/tarball + dist freshness informationally.
- ❌ **Do NOT modify Groundswell, the harness source, preflight, auth tests, or T3.S1's check** — out of scope.

---

**Confidence Score: 9/10** — single-file, sync, well-specified; the only residual uncertainty is the
implementer's choice of `readlinkSync` (raw relative) vs `realpathSync` (absolute) for the logged
target, both of which are explicitly sanctioned above.
