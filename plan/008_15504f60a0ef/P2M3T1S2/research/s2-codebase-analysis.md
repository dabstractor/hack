# S2 Codebase Analysis — `prd status` CLI alias

## 1. The contract (item 3 LOGIC)
- Register a `status` subcommand in `src/cli/index.ts` that delegates to the SAME
  handler as the `task` subcommand.
- Use commander `.command('status')` with the same description/argument/options as
  `task`, sharing the same action handler.
- Add `'status'` to the subcommand union type (return type of `parseCLIArgs`,
  ~line 248).
- Add a case in the subcommand detection block (~line 589+) that returns
  `{ subcommand: 'task', options }` for `status` invocations.
- DOCS: update `docs/CLI_REFERENCE.md` (Mode A — rides with the work).

## 2. Edit site — `parseCLIArgs` return type union (line ~248)
```ts
export function parseCLIArgs():
  | ValidatedCLIArgs
  | { subcommand: 'inspect'; options: InspectorOptions }
  | { subcommand: 'artifacts'; options: Record<string, unknown> }
  | { subcommand: 'validate-state'; options: Record<string, unknown> }
  | { subcommand: 'cache'; options: CacheOptions }
  | { subcommand: 'task'; options: Record<string, unknown> } {
```
`'status'` does NOT need to be a NEW union member — item 3 says the detection
block should return `{ subcommand: 'task', ... }` for `status` invocations. So
the union stays unchanged. (Confirming: the contract literally says "returns
{subcommand:'task', options} for 'status' invocations" — so `status` is
normalized to `task`.)

**Correction to item 3 wording:** "Add 'status' to the subcommand union type at
line 248" is satisfied by reusing the existing `'task'` member (the detection
block maps `status`→`task`). Do NOT add a phantom `'status'` member that nothing
produces — that would be dead code. The union is already complete.

## 3. Edit site — `task` command registration (~line 487-499)
```ts
  program
    .command('task')
    .description('Display and query pipeline tasks')
    .argument('[action]', 'Action: (none), next, status', '')
    .option('-f, --file <path>', 'Override tasks.json file path')
    .option('-o, --output <format>', 'Output format (table, json)', 'table')
    .action(async (action, options) => { ... });
```

## 4. The CRITICAL ambiguity / gotcha — which behavior does `prd status` alias?

PRD §5.3 says: *"`prd status` is aliased to `prd task` for git muscle memory
(`git status` / `prd status`)."*

So `prd status` ≡ `prd task` (the DEFAULT list-all behavior), NOT
`prd task status` (the status-counts behavior).

But there is a SECOND reading: the contract item 3 says register `status` "with
the same description, argument, and options as `task`, sharing the same action
handler." If we do that, `prd status` (no further arg) → action handler runs
with `action=''` → DEFAULT list-all branch. `prd status next` → next-task
branch. `prd status status` → status-counts branch. This makes `status` a FULL
alias of the entire `task` command surface (every `prd task X` works as
`prd status X`).

That is the SAFEST interpretation — it makes `prd status` a true alias of
`prd task` across the whole surface, which satisfies "aliased to `prd task`"
comprehensively and matches "same description, argument, and options as task,
sharing the same action handler." **Use this.**

### Implementation: extract the shared handler
The `task` action handler is an inline `async (action, options) => {...}` of
~100 lines (lines ~494-585). To "share" it between two `.command()` calls we
extract it to a named local function, e.g.:

```ts
const taskAction = async (action: string, options: {...}): Promise<void> => {
  try { ... existing body ... } catch (error) { ... }
};
```

then:
```ts
program.command('task').description(...).argument(...).option(...).option(...).action(taskAction);
program.command('status').description(...).argument(...).option(...).option(...).action(taskAction);
```

The `status` command should NOT duplicate the 100-line body. Extract once, reuse.

## 5. Edit site — subcommand detection block (~line 589-625)
After the existing `if (args[0] === 'task') { return { subcommand: 'task', ... } }`
block, ADD (before it, or after it — order irrelevant since these run AFTER
`program.parse` which already executed the action handler; the return is "type
safety only"):

```ts
  if (args.length > 0 && args[0] === 'status') {
    // 'status' is an alias of 'task' (PRD §5.3 — git muscle memory).
    // The action() handler already executed; normalize to 'task' for callers.
    return { subcommand: 'task', options: {} };
  }
```

NOTE: Just like the other subcommand blocks, `program.parse()` already ran the
action handler (which calls `process.exit(0)` on success / `process.exit(1)` on
error). The return statement is only reached in the (unreachable) success path
for type-completeness — identical to how `inspect`/`artifacts`/`cache`/`task`
blocks already work. So the new block mirrors the existing `task` block exactly.

## 6. Tests — `tests/unit/cli/index.test.ts`
Current file only tests the DEFAULT pipeline path (`parseArgs()` throws if a
subcommand is returned). There is NO existing test for `task`, `inspect`, etc.
in this file (they're in `tests/unit/cli/commands/`).

For S2 we add a focused `describe('prd status alias (PRD §5.3)', ...)` block:
- `it('should route "status" to the task subcommand')` → `setArgv(['status'])`,
  call `parseCLIArgs()` (which will execute the action handler → mock fs/promises
  readFile, or expect process.exit(1) on missing file). 

**GOTCHA**: the `task` action handler does `await import('node:fs/promises')` and
`readFile(tasksFile)`. The existing test mocks `node:fs` (existsSync) and
logger, but NOT `node:fs/promises`. For a clean unit test of the ALIAS wiring,
the simplest assertion is: `parseCLIArgs()` with `['status']` returns/throws in
the same way as with `['task']`. Since the handler reads `plan/tasks.json` which
exists in this repo, the action handler will likely succeed and `process.exit(0)`
(thrown as `process.exit(0)`). So assert: `expect(() => parseCLIArgs()).toThrow('process.exit(0)')`
— AND assert the SAME for `['task']` to prove parity. Mock `node:fs/promises`
readFile to be safe & deterministic (return a minimal valid backlog JSON) and
avoid real-filesystem coupling.

Alternatively, mirror how `inspect.test.ts` tests subcommands (separate file
under `tests/unit/cli/commands/`). Check that file's pattern.

## 7. Docs — `docs/CLI_REFERENCE.md`
Currently has NO documentation of the `task` subcommand at all (grep for
`prd task` returns nothing in CLI_REFERENCE.md). The "Commands" section has
"Pipeline Execution", "Scoped Execution", "Special Modes". There is no
"Subcommands" section.

Mode A says update to document the `status` alias. Minimal, in-scope change:
add a short "### Task Management" (or "### Inspection & Task Subcommands")
subsection documenting `prd task` and `prd status` (alias) with the actions
(list/next/status) and options (-f, -o). Keep it tight and consistent with
existing doc style. Do NOT document `inspect`/`artifacts`/etc. (out of scope).

## 8. Validation commands
- `npm run typecheck` (return-type union unchanged; new `.command('status')`
  compiles; extracted handler typechecks)
- `npm run lint`
- `npm run format:check` (run `npm run format` if it complains)
- `npm run test:run` (new describe block passes; existing tests green)
- `npm run validate` (the full gate)
- `npm run build`
- Coverage: vitest.config.ts enforces 100% on `src/**/*.ts`. The extracted
  handler is the SAME code (just moved into a const), so branches are unchanged.
  The new detection-block branch `if (args[0] === 'status')` is a NEW branch —
  it MUST be exercised by a test (the alias test) or coverage drops below 100%.
  ⚠️ This is the #1 risk: add a test that actually drives `args[0] === 'status'`
  through `parseCLIArgs` so the branch is covered.

## 9. Scope fences
- DO NOT edit any other subcommand (inspect, artifacts, validate-state, cache).
- DO NOT change the `task` action handler's LOGIC — only EXTRACT it to a shared
  const.
- DO NOT add `'status'` as a new union member (reuses 'task'; see §2).
- DO NOT edit PRD.md / tasks.json / prd_snapshot.md.
- Zero file overlap with parallel S1 (S1 edits src/agents/prompts.ts +
  tests/unit/agents/prompts.test.ts; S2 edits src/cli/index.ts +
  tests/unit/cli/index.test.ts + docs/CLI_REFERENCE.md).