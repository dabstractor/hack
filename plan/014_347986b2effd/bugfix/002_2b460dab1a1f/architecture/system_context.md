# System Context — Distributed-PRD Include Dedup Bugfix (plan 014 / bugfix 002)

## Project
`hacky-hack` — Autonomous PRP Development Pipeline. TypeScript (Node ≥ 20), ESM (`"type": "module"`).
Toolchain: `vitest` (tests), `eslint` + `prettier` (lint/format), `tsc` (typecheck), `typedoc` (docs).
Run targets: `npm run test:run`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run docs:check`.

> NOTE on research method: per the project `AGENTS.md` ("NEVER run this project within this directory — catastrophic meltdown of in-progress implementation"), research was performed **read-only by direct file inspection** rather than by spawning builder subagents. All findings below are verified against the live source at HEAD. No code was executed or modified during research.

## Feature Under Fix
PRD §2.3 — Distributed (multi-file) PRD include resolution: `@path/to/file.md` directives are
recursively expanded inline into a single canonical resolved document. Implemented in
`src/core/session-utils.ts` (`resolvePRD`, `expandIncludesRecursive`, `neutralizeResolvableTokens`).
Configuration surface in `src/config/constants.ts` (`PRD_INCLUDE_MARKERS`, `PRD_INCLUDE_MAX_DEPTH`,
`getPrdIncludeMarkers()`, `getPrdIncludeMaxDepth()`).

## Key Implementation Facts (verified at HEAD)

### Token regex (single source of truth)
`src/core/session-utils.ts:422`
```ts
const RESOLVE_TOKEN = /(?<![\w./-])@([A-Za-z0-9_./-]+)/g;
```
- Token char-class is `[A-Za-z0-9_./-]`. The deliberate `@!` marker prefix is "structurally
  non-resolvable" because `! ∉ [A-Za-z0-9_./-]` → the token group cannot start → zero captures on
  re-scan. This is what makes marker-on output a true idempotent fixed point even when real files
  named `include` / `end-include` / `include-ref` exist (locked by the `BUG-001` collision test).

### Marker emission (the actually-emitted format)
`expandIncludesRecursive` (expanded include block) and `elisionRefComment` (elided ref):
```
<!-- @!include: <token> -->       (open)
<!-- @!end-include -->            (close)
<!-- @!include-ref: <token> -->   (elided 2nd+ encounter, markers on)
```
These are emitted regardless of what the JSDoc/PRD literal example says.

### Stale-include warning (the working path)
In `expandIncludesRecursive`, after the `stat()` + recursion attempt, when
`replacement === undefined && token.endsWith('.md')`:
```ts
console.warn(`[prd-resolver] stale include '@${token}': path does not resolve to an existing file (${abs})`);
```
Routed through `console.warn` (→ `process.stderr`, sync) because the pino logger writes to stdout
(PRD §2.3 requires **stderr**). **This works on the normal recursive path only — NOT at the depth gate.**

### Depth gate (BUG-002 site)
`src/core/session-utils.ts` — `neutralizeResolvableTokens(content, baseDir, markers)`:
called when `depth >= maxDepth` (line ~503). For each `@token`: `stat()` it; if it resolves to an
existing FILE → ELIDE (drop, or `@!include-ref` when markers on); if ENOENT/dir → leave verbatim.
**By design it emits NO stale-include warning** (its JSDoc literally says "Emits NO stale-include
warning (elision = success; verbatim = non-resolving prose, which is silent)"). This is the BUG-002
defect: a stale `.md` at the gate survives verbatim with zero stderr warnings, violating the
unconditional §2.3 MUST.

### Dedup visited set (BUG-003 site)
- `expandIncludesRecursive` signature: `(content, baseDir, maxDepth, depth, visited: Set<string>, markers)`.
  `visited` is a **single shared global-flat set** passed by reference (no per-branch copy).
- `abs = resolve(baseDir, token)` (Node `path.resolve` — **lexical** absolute normalization, NOT
  symlink-resolving).
- First-encounter elision check: `if (visited.has(abs))` → elide (line ~516).
- Mark-visited (only for files, after `st.isFile()`): `visited.add(abs)` (line ~525), **before** descending.
- **Entry pre-seed** in `resolvePRD` body, `src/core/session-utils.ts:716`:
  `new Set<string>([absEntry])` where `absEntry = resolve(prdPath)`.
- All three sites key on the **lexical** `abs`/`absEntry` → two symlinks to the same physical file
  get distinct keys → file expanded twice → dedup defeated. This is BUG-003.

### Imports already present in session-utils.ts
- `import { resolve, join, dirname, basename } from 'node:path';` (line 35)
- `import { stat, mkdir, ... } from 'node:fs/promises';` (line 33-34) — async `stat`
- `realpathSync` is **NOT** currently imported → BUG-003 fix must add
  `import { realpathSync } from 'node:fs';`

## Test Layout (where each bug's test belongs)
- `tests/unit/core/prd-markers.test.ts` — markers, **stale-warning**, idempotency, getter.
  - Existing stale-warning tests (within-depth): mock `vi.spyOn(console,'warn')`, assert
    `toHaveBeenCalledTimes(1)` and `toContain('<token>')`.
  - BUG-002 new test belongs here (depth-gate stale `.md` warns).
  - Existing `BUG-001` collision test + N2 marker-ref test live here (behavior already locked).
- `tests/unit/core/prd-resolve.test.ts` — recursion, **global-flat dedup & elision**, base invariant,
  **max depth gate**, silent verbatim, error branches.
  - BUG-003 new test belongs here (symlink-alias dedup). Uses `mkdtempSync`/`writeFileSync` from
    `node:fs` real tmpdir (NOT a module mock) — add `symlinkSync` for the alias.
- Tests use REAL tmpdirs (explicit project decision: boundary/existence/recursion logic is only
  trustworthy against real files; do NOT `vi.mock('node:fs/promises')`).

## Documentation Surface (for §5 doc-sync)
- `src/config/constants.ts:1282-1290` — **STALE** JSDoc for `PRD_INCLUDE_MARKERS` (says `@include`/
  `@end-include`). BUG-001 Mode-A target.
- `src/core/session-utils.ts` JSDoc:
  - `neutralizeResolvableTokens` doc says "Emits NO stale-include warning" — BUG-002 Mode-A target.
  - `resolvePRD` `@remarks` STALE-INCLUDE-WARNING bullet says "depth-exceeded tokens … emit NO warning"
    — BUG-002 Mode-A target (becomes wrong after fix).
  - `resolvePRD` `@remarks` GLOBAL-FLAT-DEDUP bullet says "keyed on the resolved absolute path" —
    BUG-003 Mode-A target (→ "canonical realpath-resolved").
  - `expandIncludesRecursive` `@param visited` — BUG-003 Mode-A target.
- `docs/CONFIGURATION.md:310` — **already correct** (`@!include`/`@!end-include`). Verify only.
- `README.md:135,145` — **already correct** (`@!include`). Verify only; possibly note symlink-safe dedup.
- `docs/ARCHITECTURE.md`, `docs/CLI_REFERENCE.md` — contain `@include`/marker/dedup references;
  verify accuracy (Mode-B final sweep).

## PRD Selector Map (structure index)
- `h2.0` Overview · `h2.3` Minor Issues · `h2.3/h3.0` Issue 1 (markers/JSDoc) · `h2.3/h3.1` Issue 2
  (depth-gate stale warn) · `h2.3/h3.2` Issue 3 (symlink dedup) · `h2.4` Testing Summary ·
  `h2.5` Recommendations (contains per-bug fix guidance).