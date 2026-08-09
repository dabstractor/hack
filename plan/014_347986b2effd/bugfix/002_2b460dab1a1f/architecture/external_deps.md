# External Dependencies & APIs — bugfix 002

All fixes are internal to the existing codebase; the only "external" surface is the Node.js
standard library. No new runtime dependencies are introduced.

## `node:fs` — `realpathSync` (BUG-003)
- Signature: `realpathSync(path): string` — synchronously resolves `.`, `..`, and symbolic links to
  the canonical absolute path.
- Throws on ENOENT (broken symlink / missing path) and on other I/O errors (EACCES, ELOOP, etc.).
- BUG-003 wraps it in `try/catch` with a lexical `path.resolve` fallback (`dedupKey`), so a
  non-resolvable token never crashes resolution.
- NOT currently imported in `src/core/session-utils.ts` (add `import { realpathSync } from 'node:fs';`).
- The async `stat` already used is from `node:fs/promises` (line 33-34) — keep using that for the
  existence/isFile checks; only the visited *key* uses `realpathSync`.

## `node:path` — `resolve` (already imported, line 35)
- `resolve(baseDir, token)` → lexical absolute normalization (does NOT resolve symlinks). This is the
  CURRENT (buggy) dedup key and remains the fallback inside `dedupKey`.

## `console.warn` (BUG-002)
- Writes to `process.stderr`, synchronously. This is the project's chosen channel for stale-include
  warnings (PRD §2.3 requires stderr; the pino logger writes stdout, so it is intentionally NOT used).
  BUG-002 reuses the exact message format already used in `expandIncludesRecursive`.

## Test framework — `vitest`
- Spies: `vi.spyOn(console, 'warn').mockImplementation(() => {})`; assertions
  `toHaveBeenCalledTimes(1)` and `String(spy.mock.calls[0][0]).toContain('<token>')`.
- Real filesystem scaffolding (project convention): `mkdtempSync`/`writeFileSync`/`rmSync` from
  `node:fs`, `tmpdir()` from `node:os`, `join` from `node:path`. Do NOT `vi.mock('node:fs/promises')`.
- BUG-003 additionally uses `symlinkSync` from `node:fs` to build the alias fixture.

## Docs / lint tooling
- `npm run docs:check` (`scripts/check-docs.ts`) validates docs consistency — re-run after JSDoc edits.
- `typedoc` reads JSDoc; keep `@remarks`/`@param`/`@example` well-formed (no broken `{@link}`).
- `eslint`/`prettier` enforce style; `npm run typecheck` (tsc --noEmit) must stay green.