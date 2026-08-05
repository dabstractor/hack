# System Context — CLI Dispatch, Repo-Root Bootstrap & Error Handling

## Overview

The `hack` CLI is a TypeScript (tsx) application using **Commander.js v14.0.2** for argument
parsing. Entry point is `src/index.ts` (`main()`), which delegates CLI parsing to
`src/cli/index.ts` (`parseCLIArgs()`). Subcommands (inspect, artifacts, validate-state, cache,
config, task, status) are registered as Commander `.command(...).action(...)` handlers inside
`parseCLIArgs()`. The repo-root resolver lives in `src/utils/repo-root.ts`.

---

## 1. CLI Dispatch Flow (the BUG-001 root cause)

```
src/index.ts: main()
  │
  ├─ 1. parseCLIArgs()                          [src/cli/index.ts:274]
  │     │
  │     ├─ program = new Command()
  │     ├─ program.option('--repo-root <path>'...)   ← global flags registered
  │     ├─ program.action(() => {})                  ← default no-op action
  │     ├─ program.command('inspect').action(...)
  │     ├─ program.command('artifacts').action(...)
  │     ├─ program.command('validate-state').action(...)
  │     ├─ program.command('cache').action(...)
  │     ├─ program.command('config').action(...)      ← ONLY patched handler (line 608)
  │     ├─ const taskAction = async (...) => { resolve('plan'); ... }
  │     ├─ program.command('task').action(taskAction)
  │     ├─ program.command('status').action(taskAction)
  │     │
  │     └─ program.parse(process.argv)  [line 853]
  │          │  ← DISPATCHES to matched .action() handler
  │          │  ← process.cwd() === INVOCATION_CWD at this point
  │          │
  │          ├─ SUBCOMMAND PATH: action handler runs → process.exit(0/1)
  │          │   (main() NEVER reaches step 2-3 below)
  │          │
  │          └─ DEFAULT PATH: no-op action returns → parseCLIArgs() returns
  │
  ├─ 2. resolveRepositoryRoot(INVOCATION_CWD, ...)    [src/index.ts:147]
  │      ← ONLY reached for the default (no-subcommand) path
  │
  └─ 3. process.chdir(repoRoot)                       [src/index.ts:150]
       ← TOO LATE for subcommands: they already exit'd in step 1
```

### Key Insight

Subcommand `.action()` handlers execute **inside** `program.parse()` (step 1), which is **inside**
`parseCLIArgs()`, which is called at `main()` line 132 — **before** the `resolveRepositoryRoot` +
`process.chdir` at lines 147-150. Subcommands call `process.exit()` before `main()` continues,
so they **never** benefit from the bootstrap chdir.

### The INVOCATION_CWD Constant

Captured at module load (`src/index.ts:55`):
```ts
const INVOCATION_CWD = process.cwd();
```
This is the directory where the user invoked `hack`. It is used by `main()` for the
`resolveRepositoryRoot()` call and for pre-resolving explicit `--prd` paths (relative paths
resolve against INVOCATION_CWD, not repoRoot).

---

## 2. Repo-Root Resolution API (`src/utils/repo-root.ts`)

### Core Function

```ts
export function resolveRepositoryRoot(
  startDir: string,
  opts?: { explicit?: string }
): { repoRoot: string; invocationCwd: string }
```
- **Default** (no `opts.explicit`): walks upward from `startDir` to nearest `.git` entry
  (§9.8.2).
- **Explicit** (`opts.explicit` set): resolves the path, verifies `.git` presence (§9.8.6).
- Sets module singletons `_repoRoot` and `_invocationCwd` for later `getRepoRoot()` /
  `getInvocationCwd()` reads.
- **Throws `NotARepositoryError`** if no `.git` found.

### Singletons

```ts
export function getRepoRoot(): string       // throws if not yet resolved
export function getInvocationCwd(): string  // throws if not yet resolved
```

### NotARepositoryError (`src/utils/repo-root.ts:65-93`)

```ts
export class NotARepositoryError extends Error {
  readonly searchedFrom: string;
  readonly explicit: boolean;
  constructor(searchedFrom: string, opts?: { explicit?: boolean }) {
    // message: "No .git entry found at or above \"<path>\". Run inside a git repository,
    //           or pass --repo-root <path>." (or explicit variant)
    super(remediation);
    this.name = 'NotARepositoryError';
    ...
  }
}
```

---

## 3. Error Handling Architecture (BUG-002 context)

### Two Disjoint Rendering Paths

**Path A — Main pipeline** (`src/index.ts:397-423`): `main().catch()` has 4 dedicated clean arms
for typed error classes + 1 default arm that dumps the full stack trace:

| Arm | Error Class | Rendering |
|-----|-------------|-----------|
| Clean | `AuthPreflightError` | `\n❌ <message>` + exit 1 (no stack) |
| Clean | `HarnessProviderMismatchError` | `\n❌ <message>` + exit 1 |
| Clean | `UnsupportedHarnessError` | `\n❌ <message>` + exit 1 |
| Clean | `NotARepositoryError` | `\n❌ <message>` + exit 1 |
| **Default** | Everything else (incl. hack-config validation) | `\n❌ Fatal error in main(): <Error obj>` **+ full stack trace** |

**Path B — Subcommand action handlers** (`src/cli/index.ts`): each of the 6 subcommands wraps its
body in `try/catch` that renders ALL errors via `logger().error(...)`, which prepends a
`[<uuid>] [CLI]` request-id banner. No typed-error-specific handling.

### Typed Error Class Inventory

| Class | Defined In | `this.name` | Has `main().catch()` arm? |
|-------|-----------|-------------|--------------------------|
| `NotARepositoryError` | `src/utils/repo-root.ts:65` | `'NotARepositoryError'` | YES |
| `AuthPreflightError` | `src/config/types.ts:219` | `'AuthPreflightError'` | YES |
| `HarnessProviderMismatchError` | `src/config/types.ts:175` | `'HarnessProviderMismatchError'` | YES |
| `UnsupportedHarnessError` | `src/config/types.ts:142` | `'UnsupportedHarnessError'` | YES |
| `EnvironmentValidationError` | `src/config/types.ts:79` | `'EnvironmentValidationError'` | **NO** (hits default) |
| *(none)* — hack-config errors | — | — | **NO** (plain `Error`, hits default) |

**No `HackConfigError` class exists anywhere in the codebase.** All 9 validation throw sites in
`src/config/hack-config.ts` use bare `throw new Error(...)`.

---

## 4. Hack Config Validation Flow (BUG-003 context)

### Validation Call Chain

```
hack config validate [<file>]        real startup (index.ts main)
      │                                        │
      ▼                                        ▼
config.ts #validateAction          loadHackConfig(repoRoot)
  per file:                           per tier (global → project → project-local):
    parseHackFile(file) ──┐             parseHackFile(file)
    validateHackTier(...)─┤             validateHackTier(parsed, file, tier)  ← FIX SITE for BUG-003
                           │             mergeTier(merged, parsed, tier, sources)
  collects errors          │           seedProcessEnv / seedAuthOverrideKey
  exit 1 / exit 0          │           logEffectiveConfigTrace
                           │
                           └─► validateHackTier(parsed, file, tier)
                                 for each [section, keys]:
                                   ├ secrets policy (per key, §9.7.6)
                                   ├ unknown section/key warnings
                                   └ validateFieldValue (per key: type/range/enum)
                                              ▲
                                              └ NO cross-key path ← BUG-003
                                 [post-loop relational check goes here]
```

Both runtime paths (CLI lint + startup) funnel through `validateHackTier`, so any fix added
there is automatically exercised by both.

### HACK_CONFIG_SCHEMA `[commit]` Section

```ts
commit: {
  retry_max: { type: 'int', min: 1 },
  retry_delay_ms: { type: 'int', min: 0 },
  retry_delay_cap_ms: { type: 'int', min: 0 },  // relational cap>=delay deferred (cross-key)
  classifier_retry_max: { type: 'int', min: 1 },
},
```

The `HackConfigFieldSpec` interface has no relational metadata field — cross-key validation
requires a separate post-validation step, not a schema change.

---

## 5. Commander.js Hook Support (the BUG-001 fix enabler)

**Version:** `commander@14.0.2` (`package.json:75`).

**Hook types** (`node_modules/commander/typings/index.d.ts:368`):
```ts
export type HookEvent = 'preSubcommand' | 'preAction' | 'postAction';
```

**`hook()` method** (`typings/index.d.ts:540-549`):
```ts
hook(
  event: HookEvent,
  listener: (thisCommand: Command, actionCommand: Command) => void | Promise<void>
): this;
```

**`preAction` fires before the action of the matched command.** When registered on `program`:
- `thisCommand` is always `program`.
- `actionCommand` is the specific command whose action is about to run.
- **For subcommands:** the hook fires with `(program, subcommand)`.
- **For the default path:** the hook fires with `(program, program)`.

A single `program.hook('preAction', ...)` registered before `program.parse()` intercepts ALL
action handlers (including subcommands) at a single point — the ideal fix for BUG-001.

**Cascade behavior:** Commander fires hooks for each command in the path. For a subcommand
invocation, the program's preAction fires once. For the default action, it also fires once.
An idempotency guard (`_bootstrapped` flag) prevents double execution.