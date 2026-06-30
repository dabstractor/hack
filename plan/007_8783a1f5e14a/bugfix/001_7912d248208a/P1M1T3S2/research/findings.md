# Research Findings — P1.M1.T3.S2 (symlink/dist-freshness detection)

## Current state of the file being modified
`src/scripts/validate-groundswell.ts` — after P1.M1.T3.S1 (COMPLETE) it already contains:
- `validateInstallation()` (sync) — runs `execSync('npm list groundswell')`, parses the version,
  and **informationally** logs `-> ` links from npm-list text output. Does NOT use `fs.lstatSync`.
- `validateAuthStoreBehavior()` (async) — the HARD behavior gate from T3.S1.
- `results` object keys: `installation, version, imports, decorators, nodeVersion, authStoreBehavior`.
- Top imports: `import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';`
  (+ `join` from path, `execSync` from child_process, `tmpdir` from os, `type { AuthStorage }`).
- Style helpers: `logSection`, `logSuccess`, `logWarning`, `logError`, `log`.
- `allPassed = Object.values(results).every(r => r)` — adding a `results` key auto-folds it in.

## Verified facts (this session)
- `node_modules/groundswell` IS a symlink right now (npm link applied by T2).
  - `fs.lstatSync(...).isSymbolicLink()` → **true**.
  - `fs.readlinkSync(...)` → `'../../groundswell'` (raw relative target).
  - `fs.realpathSync(...)` → `'/home/dustin/projects/groundswell'` (absolute).
- Deployed dist is the FIXED one:
  - `node_modules/groundswell/dist/harnesses/pi-harness.js` line 103:
    `this.authStorage = options?.authStorage ?? AuthStorage.create();`
  - `grep -c 'AuthStorage.create()'` → **3**; `grep -c 'AuthStorage.inMemory()'` → **0**.
- `npm list groundswell` output (current): `└── groundswell@1.0.0 -> ./../groundswell`
  → the existing `validateInstallation()` regex `/groundswell@([\d.]+)/` would match `1.0.0`.
- `tsconfig.build.json` `include: ["src/**/*"]` → validate-groundswell.ts IS typechecked by `npm run typecheck`.
- ESLint (`.eslintrc.json`):
  - `@typescript-eslint/no-explicit-any`: **warn** (use structural casts, never `any`).
  - `@typescript-eslint/no-floating-promises`: **error** → a SYNC function avoids this entirely.

## Design decisions encoded in the PRP
1. ADD a new SYNC `validateLinkStatus(): boolean` (matches sync fs ops + `validateInstallation`/`validateNodeVersion` style; avoids floating-promise lint risk).
2. Wire `results.linkStatus` immediately after `results.installation` in `main()`.
3. Logic:
   - symlink → `readlinkSync` → `logSuccess('Groundswell linked from: <target>')` → `return true`.
   - tarball → read `dist/harnesses/pi-harness.js`; `hasFix = includes('AuthStorage.create()')`,
     `hasStale = includes('AuthStorage.inMemory()')`.
       * `hasFix && !hasStale` → `logSuccess` → `return true`.
       * stale → `logWarning` → `return true` (INFORMATIONAL; hard gate is `validateAuthStoreBehavior`).
       * pi-harness.js missing → `logWarning` → `return true`.
   - `lstatSync` throws (nothing installed) → `catch` → `logError` → `return false`.
4. TRIM the now-redundant `-> ` symlink-logging branch out of `validateInstallation()` (that concern
   moves to `validateLinkStatus`, which is more robust than parsing npm-list text). Keep npm-list
   install/version confirmation in `validateInstallation`.
5. Imports: extend the top-level fs import with `lstatSync, readFileSync, readlinkSync`.
6. [Mode A] docs — JSDoc header bullet only; no user-facing/config surface change.

## Two-layer stale-dist detection (per contract §OUTPUT)
- Layer 1 (HARD): `validateAuthStoreBehavior()` (T3.S1) — runs for every install, fails exit 1 on stale.
- Layer 2 (INFORMATIONAL): `validateLinkStatus()` (this task) — reports link vs tarball; for tarballs,
  greps the dist for the fix. Never hard-fails on a stale tarball (warns + points at Layer 1).
