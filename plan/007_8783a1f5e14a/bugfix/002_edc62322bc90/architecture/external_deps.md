# External Dependencies & Contracts — Bugfix 002

## 1. Groundswell (sibling repo `~/projects/groundswell`)

**NOT touched by this bugfix.** Verified live in `dist/` and `node_modules/groundswell@1.0.1`:
- `pi-harness.ts` uses `AuthStorage.create()` (file-backed) — 3 hits in the deployed dist.
- `configureHarnesses()`, `HarnessRegistry.getInstance()`, `PiHarness` are the symbols consumed by
  `src/config/harness.ts`. These are mocked in unit tests (`vi.mock('groundswell', ...)` — see
  `test-conventions.md` §3) and exercised for real only via `tsx` subprocess runners
  (`tests/integration/config/pi-harness-auth.test.ts`).

No contract change is required for Issues 1 or 2. Do NOT modify the cross-repo.

## 2. `@earendil-works/pi-coding-agent`

Exports `AuthStorage` (consumed in `runAuthPreflight` for the `getAuthStatus(provider).configured`
check). Unchanged. In unit tests it reads the real on-disk `PI_CODING_AGENT_DIR/auth.json` — tests
MUST point `PI_CODING_AGENT_DIR` at a fresh `mkdtempSync` dir to avoid touching the real
`~/.pi/agent/auth.json`.

## 3. Node / process lifecycle assumptions

- `main()` is launched via `void main().catch(...)`. **Module-eval throws are NOT caught by it** —
  this is the crux of Issue 2. Any side effect that can throw MUST be moved inside `main()` (or
  behind a lazy accessor invoked from `main()`) to be covered by the clean error handler.
- `parseCLIArgs()` (in `src/cli/index.ts`) calls `process.exit()` for `--help`/`-h`/`--version`/
  `-V`/unknown-flag/`inspect` — these exit BEFORE `main()`'s body. They are therefore unaffected by
  reordering inside `main()`. Confirm any new early-return is placed AFTER `parseCLIArgs()` returns
  (it already is).

## 4. Vitest aliasing caveat (critical for Issue 2 tests)

`vitest.config.ts` sets `resolve.alias.groundswell → ../groundswell/dist/index.js`, and every
config/harness unit test additionally `vi.mock('groundswell', ...)`. This means **in-process vitest
tests CANNOT reproduce a module-load crash** — the static import graph is resolved against the
mock/alias, not the real bundle, and `vi.mock` is hoisted before imports. To prove Issue 2's fix
(no raw stack trace at startup) you MUST use `spawnSync(process.execPath, [dist/index.js, ...])`
with a scrubbed env, exactly like `auth-preflight.test.ts`'s acceptance `(a)` block.
