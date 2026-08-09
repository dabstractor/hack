# External Dependencies & Stack — §2.3 Idempotency Bugfixes

## New dependencies
**None.** Both fixes are pure-TypeScript edits to an existing module. No packages are added,
removed, or upgraded. `package.json` / `package-lock.json` are NOT modified.

## Existing stack used (unchanged)
- **Runtime**: Node.js standard library only.
  - `node:fs` — `stat` (existence check), file reads via the module's `readUTF8FileStrict`.
  - `node:path` — `resolve`, `dirname` (project-root-relative base invariant).
  - `console.warn` → `process.stderr` (the stale-include warning channel; pino writes stdout, §2.3
    requires stderr — unchanged).
- **Config surface** (`src/config/constants.ts`, read-only for this changeset):
  - `getPrdIncludeMaxDepth()` — env `PRD_INCLUDE_MAX_DEPTH`, default 10.
  - `getPrdIncludeMarkers()` — env `PRD_INCLUDE_MARKERS`, default off.
- **Test runner**: `vitest` (`vitest.config.ts`). Tests use a REAL `mkdtempSync` tmpdir (NOT a mocked
  `node:fs`) — the boundary/existence/recursion logic is only trustworthy against real files (this is
  the established convention in `prd-markers.test.ts` / `prd-resolve.test.ts`; the bugfix tests must
  follow it — do NOT mock `node:fs/promises`).
- **LSP/types**: `tsc` (`tsconfig.json`); the module is ESM (`.js` import specifiers in tests).

## Regex contract (the crux of BUG-001)
`RESOLVE_TOKEN = /(?<![\w./-])@([A-Za-z0-9_./-]+)/g` (`src/core/session-utils.ts:422`) is a FIXED
one-line contract shared conceptually with the module-private `INCLUDE_TOKEN` in the older
`resolveIncludes` path. Any marker-format change is validated AGAINST this regex (not by changing the
regex). Path class = `[A-Za-z0-9_./-]` (letters, digits, `_`, `.`, `/`, `-`). `:` and space are NOT
path chars.

## Risk / blast radius
- Minimal. Both triggers are pathological under defaults (marker-word file collision requires a file
  literally named `include`/`end-include`/`include-ref`; deep-chain idempotency break requires an
  11+ deep linear chain at default `maxDepth=10`).
- No public API signature changes (`resolvePRD(prdPath, opts?)` is unchanged; `ResolveOpts` unchanged).
- No network, no DB, no native modules, no build-tooling changes.