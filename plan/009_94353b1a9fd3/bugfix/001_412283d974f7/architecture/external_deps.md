# External Dependencies

## Commander.js

- **Version:** `commander@14.0.2` (`package.json:75`)
- **Typings:** `node_modules/commander/typings/index.d.ts`
- **Hook Support:** Fully supported. `HookEvent = 'preSubcommand' | 'preAction' | 'postAction'`.
  `program.hook('preAction', listener)` fires before any action handler (program-level default
  AND subcommands). The listener receives `(thisCommand, actionCommand)`.
- **preAction timing:** Fires AFTER options are parsed (so `program.opts()` has `--repo-root`
  available) but BEFORE the action handler body runs. This is the critical timing that makes it
  the ideal fix point for BUG-001.
- **Error propagation:** If a preAction hook throws, the error propagates through
  `program.parse()` → caller. It does NOT enter the action handler's try/catch (the handler
  hasn't started yet). This is the desired behavior for `NotARepositoryError`.

## smol-toml

- **Purpose:** TOML 1.0 parsing for `.hack` configuration files.
- **Used in:** `src/config/hack-config.ts:8` (`import { parse, TomlError } from 'smol-toml'`)
- **Relevant to:** BUG-003 (validation flow operates on parsed TOML output).

## Testing Framework

- **Vitest** (`vitest.config.ts`)
- **Test patterns:**
  - Unit tests: `tests/unit/` (Vitest with mocks)
  - Integration tests: `tests/integration/` (real tmpdirs, `spawnSync` subprocess invocations)
  - Subprocess helper pattern (from `tests/integration/repo-root-acceptance.test.ts`):
    ```ts
    const tsxBin = resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
    const absIndex = resolve(process.cwd(), 'src/index.ts');
    const runCli = (args, cwd) => spawnSync(tsxBin, [absIndex, ...args], { cwd, encoding: 'utf8' });
    ```
  - Git repo fixture: `makeRepo()` creates a `git init` tmpdir.
  - Nested subdir: `mkdirSync(join(repo, 'src/deep/nested'), { recursive: true })`.

## No New Dependencies Required

All three bug fixes use existing project infrastructure (Commander hooks, Vitest, existing
typed-error patterns). No `npm install` needed.