# BUG-002 Fix Strategy — Clean Error Rendering for Config Validation

## Problem

Two rendering inconsistencies:

1. **`.hack` validation errors** (BOM, type/range/enum, secrets) are thrown as plain `Error`
   and reach `main().catch()`'s DEFAULT arm (`src/index.ts:421`), which prints a full stack
   trace. The messages are correct and actionable, but the stack trace is scary and
   inconsistent with the clean single-line arms for typed errors.

2. **Subcommand `NotARepositoryError` rendering:** The `config` handler catches
   `NotARepositoryError` in its own try/catch and renders via `logger().error()` with a
   `[uuid] [CLI]` request-id banner instead of the clean `❌` line. (BUG-001's preAction hook
   fix already addresses this by moving the resolveRepositoryRoot call to the hook, so
   `NotARepositoryError` propagates to `main().catch()`'s dedicated arm.)

## Fix: Typed `HackConfigError` + Clean Catch Arm

### Step 1: Define `HackConfigError` in `src/config/types.ts`

Follow the existing typed-error class convention (`this.name = 'HackConfigError'`):

```ts
/**
 * Error thrown when a `.hack` configuration file fails validation
 * (PRD §9.7.6/§9.7.7: BOM, parse failure, secrets policy, type/range/enum).
 *
 * @remarks
 * Surfaced as a clean startup error via main().catch()'s dedicated arm,
 * mirroring NotARepositoryError/AuthPreflightError (§9.2.7 fail-fast philosophy).
 */
export class HackConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HackConfigError';
  }
}
```

**Location:** `src/config/types.ts` — alongside the existing `EnvironmentValidationError`,
`UnsupportedHarnessError`, `HarnessProviderMismatchError`, and `AuthPreflightError`. This file
is the established home for typed config errors.

### Step 2: Convert throw sites in `src/config/hack-config.ts`

Replace all 9 `throw new Error(...)` with `throw new HackConfigError(...)`:

| Line | Function | Context |
|------|----------|---------|
| 83 | `parseHackFile` | BOM detected |
| 90 | `parseHackFile` | TOML parse failure |
| 774 | `validateHackTier` | Secrets policy violation (§9.7.6) |
| 815 | `validateFieldValue` | Boolean type mismatch |
| 820 | `validateFieldValue` | String type mismatch |
| 826 | `validateFieldValue` | Integer type mismatch |
| 832 | `validateFieldValue` | Integer range (below min) |
| 837 | `validateFieldValue` | Integer range (above max) |
| 847 | `validateFieldValue` | Enum value not accepted |

Add import: `import { HackConfigError } from './types.js';`

### Step 3: Add clean arm to `main().catch()` (`src/index.ts`)

Insert before the default arm (line 421):

```ts
if (error instanceof HackConfigError) {
  console.error(`\n❌ ${error.message}`); // §9.7.7: actionable one-line startup error
  process.exit(1);
}
```

Also consider adding `EnvironmentValidationError` to the same pass (it currently hits the
default arm with a stack trace for the same reason):

```ts
if (error instanceof EnvironmentValidationError) {
  console.error(`\n❌ ${error.message}`);
  process.exit(1);
}
```

### Step 4: Update the `validateFieldValue` doc comment (`hack-config.ts:799-803`)

The current comment says: "A plain `throw new Error` reaches `main().catch()`'s default arm
(index.ts:401) → exit 1." Update to reflect the new `HackConfigError` + dedicated clean arm.

### Step 5: Config handler rendering (BUG-001 interaction)

After BUG-001's preAction hook fix, `NotARepositoryError` no longer reaches the config handler's
catch block (it's thrown in the hook before the action's try block). So the config handler's
generic `logger().error()` catch no longer processes `NotARepositoryError`.

For other errors that DO reach the config handler's catch (e.g., file I/O errors from
`ConfigCommand.execute()`), consider adding an `instanceof HackConfigError` check that renders
via `console.error(\`\n❌ ${error.message}\`)` instead of `logger().error()`. This is optional
since `ConfigCommand.execute()` has its own inner catch (`config.ts:155`) that already renders
config validation errors via `console.error(chalk.red(...))`.

### Files Changed

| File | Change |
|------|--------|
| `src/config/types.ts` | Add `HackConfigError` class |
| `src/config/hack-config.ts` | Import `HackConfigError`; convert 9 throw sites; update doc comment |
| `src/index.ts` | Add `HackConfigError` + `EnvironmentValidationError` clean arms to `main().catch()` |

### Note on Subcommand Rendering (post-BUG-001)

After BUG-001's fix, `.hack` validation errors thrown during subcommand execution would
propagate through `program.parse()` → `parseCLIArgs()` → `main()` → `main().catch()`. This
means the `HackConfigError` clean arm in `main().catch()` handles them correctly for ALL paths
(default + subcommands), because subcommands no longer have their own resolveRepositoryRoot
calls that could trigger validation.

However, note that `.hack` is currently loaded only in `main()` (line ~175, after parseCLIArgs
returns), NOT during subcommand execution. So `.hack` validation errors only occur on the
default pipeline path. The clean arm still applies.

### Risks

1. **Existing tests that catch `Error`:** Tests using `expect(fn).rejects.toThrow()` or
   `expect(e instanceof Error).toBe(true)` still pass (HackConfigError extends Error). Tests
   checking `e.message` still pass (message content unchanged). Only tests asserting on the
   specific `Error` constructor or `error.constructor.name === 'Error'` would need updating.

2. **`hack config validate` CLI path:** The validate action (`config.ts:489-528`) catches errors
   per-file and collects them in an array. It uses `e instanceof Error ? e.message : String(e)`,
   which works identically with `HackConfigError` (same `.message` property). No change needed.