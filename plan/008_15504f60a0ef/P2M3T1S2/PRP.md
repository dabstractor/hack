# PRP — P2.M3.T1.S2: Add `prd status` CLI alias to `prd task`

---

## Goal

**Feature Goal**: Make `prd status` behave **identically** to `prd task` across
its entire surface (list / next / status-summary / `-f` / `-o`), satisfying **PRD
§5.3**'s *"`prd status` is aliased to `prd task` for git muscle memory
(`git status` / `prd status`)."* This is a **commander.js CLI wiring change** in
`src/cli/index.ts` (register a second top-level `.command('status')` that shares
the SAME action handler as `task`), plus a matching detection-block branch that
normalizes `status` invocations to `subcommand: 'task'` for downstream callers.
It closes out milestone **P2.M3**.

**Deliverable**:
1. **`src/cli/index.ts`** — MODIFY:
   - **Extract** the `task` command's inline `async (action, options) => {…}`
     action handler (currently ~100 lines, lines ≈494–585) into a **named,
     reusable local `const`** (e.g. `taskAction`) declared **before** the two
     `.command()` registrations.
   - **Register a second top-level command `status`** (immediately after the
     `task` registration) that mirrors `task`'s `.description`, `.argument`, and
     `.option`s **exactly** and **shares the same `taskAction`** handler — no
     duplicated handler body.
   - **Add a detection-block branch** `if (args[0] === 'status')` (in the block
     at ≈line 589–625, alongside the existing `inspect`/`artifacts`/`cache`/
     `task` branches) that returns `{ subcommand: 'task', options: {} }`
     (identical to the existing `task` branch — the `status` invocation is
     normalized to `task` for downstream callers).
2. **`tests/unit/cli/index.test.ts`** — ADD a focused
   `describe('prd status alias (PRD §5.3)', …)` block asserting `status` is
   wired as a true alias of `task` (parity of behavior + the new detection-block
   branch is exercised for 100% branch coverage).
3. **`docs/CLI_REFERENCE.md`** — **[Mode A — rides with the work]** ADD a short
   `### Task Management` subsection documenting `prd task` and `prd status`
   (alias) with their actions and options, in the existing `## Commands` section.

**Success Definition**:
- `npm run dev -- status` produces the **exact same output** as `npm run dev -- task`
  (default list-all behavior); `npm run dev -- status next` ≡ `npm run dev -- task next`;
  `npm run dev -- status status` ≡ `npm run dev -- task status`.
- `rg -n "\.command\('status'\)" src/cli/index.ts` → exactly one match.
- `rg -n "args\[0\] === 'status'" src/cli/index.ts` → exactly one match (the new
  detection branch).
- The new test block exists and PASSES, and **100% coverage on `src/**/*.ts` is
  preserved** (the new `status` branch is exercised).
- `npm run validate` GREEN (lint + format:check + typecheck + `vitest run`).

---

## User Persona (if applicable)

**Target User**: Pipeline operator / developer running the CLI locally.
**Use Case**: The user runs `prd status` out of git-muscle-memory habit (mirrors
`git status`) and expects to see the same task list that `prd task` shows.
**User Journey**: `prd status` → default list-all output (same as `prd task`).
Optionally `prd status next` → next executable subtask; `prd status status` →
status-counts summary; `prd status -f path/tasks.json` / `-o json` → overrides.
**Pain Points Addressed**: Today `prd status` is an unknown command (commander
errors or mis-parses); users expect the git-style alias promised by PRD §5.3.

---

## Why

- **PRD compliance**: PRD §5.3 (h3.11) explicitly mandates the alias:
  *"`prd status` is aliased to `prd task` for git muscle memory."*
- **Item contract (item 3 LOGIC)**: *"register a 'status' subcommand that
  delegates to the same handler as the 'task' subcommand … .command('status')
  with the same description, argument, and options as task, sharing the same
  action handler … a case … that returns {subcommand:'task', options} for 'status'
  invocations."* S2 implements exactly this.
- **Closes P2.M3**: item 4 — *"Completes P2.M3."*
- **Ergonomics**: Matches the muscle-memory documented for users (`git status`).

### Out of scope (hard fences)
- **The `task` action handler's LOGIC** → DO NOT change list/next/status logic.
  Only **extract** the existing body into a named const; no behavioral edit.
- **Other subcommands** (`inspect`, `artifacts`, `validate-state`, `cache`) → NOT
  touched.
- **The `parseCLIArgs` return-type union** → DO NOT add a phantom `'status'`
  member. The detection block **normalizes** `status`→`task`, so the existing
  `{ subcommand: 'task'; options }` member already covers it (adding a member
  nothing returns would be dead code). (See "What" §c for full rationale.)
- **Any other CLI/doc** → DO NOT document or alter other subcommands in
  `docs/CLI_REFERENCE.md` (only the new `### Task Management` subsection).
- **`PRD.md` / `tasks.json` / `prd_snapshot.md`** → READ-ONLY.
- **Zero file overlap with parallel S1** — S1 edits `src/agents/prompts.ts` +
  `tests/unit/agents/prompts.test.ts`; S2 edits `src/cli/index.ts` +
  `tests/unit/cli/index.test.ts` + `docs/CLI_REFERENCE.md`. No conflict possible.

---

## What

### User-visible behavior
`prd status` works as a full alias of `prd task`:

```bash
prd status            # ≡ prd task           → list all tasks (default)
prd status next       # ≡ prd task next      → next executable subtask
prd status status     # ≡ prd task status    → status-counts summary
prd status -f <file>  # ≡ prd task -f <file> → override tasks.json path
prd status -o json    # ≡ prd task -o json   → JSON output
```

### Technical requirements (exact contract — item 3)

**(a) Extract the shared handler.** In `src/cli/index.ts`, the `task` command is
currently registered with an inline `.action(async (action, options) => { … })`
whose body spans ≈lines 494–585 (try/catch; dynamic `import('node:fs/promises')`;
readFile/JSON.parse; `next` branch; `status` branch; default list branch;
`process.exit(0)` on success, `process.exit(1)` on error). **Move that entire
body into a named local const declared ABOVE the registrations:**

```ts
  // Shared action handler for `task` and its `status` alias (PRD §5.3).
  // Extracted so both .command('task') and .command('status') share identical
  // behavior without duplicating the body.
  const taskAction = async (action: string, options: TaskActionOptions): Promise<void> => {
    try {
      // … existing body, unchanged …
      process.exit(0);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger().error(`Task command failed: ${errorMessage}`);
      process.exit(1);
    }
  };
```

Define the options type inline or as a small inline type; mirror the existing
option keys (`-f/--file <path>`, `-o/--output <format>`). The simplest, lowest-
risk approach: keep the parameter signature as commander passes it
(`async (action: string, options: { file?: string; output?: string })`).

**(b) Register the `status` alias command.** Immediately AFTER the existing
`program.command('task')…` block, ADD a second command that mirrors `task`'s
`.description`, `.argument`, `.option`s and uses the SAME `taskAction`:

```ts
  // Add status subcommand — alias of `task` (PRD §5.3: git muscle memory)
  program
    .command('status')
    .description('Display and query pipeline tasks (alias of `task`)')
    .argument('[action]', 'Action: (none), next, status', '')
    .option('-f, --file <path>', 'Override tasks.json file path')
    .option('-o, --output <format>', 'Output format (table, json)', 'table')
    .action(taskAction);
```

Keep the existing `task` registration **identical except** its `.action(...)` now
references `taskAction` instead of the inline lambda.

**GOTCHA — the `description` for `status`:** keep it short and consistent with
the existing one-liner style used by the other subcommands (`inspect`:
`'Inspect session details'`, `cache`: `'Manage the PRP cache'`). The wording
`'Display and query pipeline tasks (alias of `task`)'` makes the aliasing
discoverable in `--help`. (Do NOT copy the `task` description verbatim without
the alias note — that would hide the relationship.)

**(c) Add the detection-block branch.** In the block at ≈line 589–625 (the
`if (args.length > 0 && args[0] === '…')` chain for `inspect`/`artifacts`/
`validate-state`/`cache`/`task`), ADD a `status` branch **alongside** the
existing `task` branch:

```ts
  if (args.length > 0 && args[0] === 'status') {
    // 'status' is an alias of 'task' (PRD §5.3). The action() handler already
    // ran (and called process.exit); this return is type-safety-only, mirroring
    // the 'task' branch exactly.
    return {
      subcommand: 'task',
      options: {},
    };
  }
```

**Why normalize `status`→`task` rather than add a union member:** the contract
item 3 literally says the detection block should *"return {subcommand:'task',
options} for 'status' invocations."* A new `{ subcommand: 'status'; … }` union
member would be produced nowhere if the block returns `'task'` — dead code. And
the existing `'task'` member already represents "task/its alias was invoked."
So the return-type union (line ≈248) is **unchanged**.

**NOTE — execution model:** like every other subcommand branch here, by the time
this code runs, `program.parse(process.argv)` has ALREADY executed `taskAction`
(which calls `process.exit(0)` on success / `process.exit(1)` on error). The
`return { subcommand: 'task', … }` is therefore reached only in the (unreachable)
success path — this is the EXISTING pattern for `inspect`/`artifacts`/`cache`/
`task`; the new `status` branch mirrors it byte-for-byte. Do not "fix" this.

**(d) Regression test.** In `tests/unit/cli/index.test.ts`, ADD a
`describe('prd status alias (PRD §5.3)', …)` block. The new `if (args[0] ===
'status')` branch is **new code in `src/`** under the 100%-coverage include glob,
so it MUST be driven by a test or coverage fails. Two approaches (pick one —
both work; see research §6):

**Approach A (parity via process.exit — simplest, mirrors existing test style):**
The `taskAction` reads `plan/tasks.json` (which EXISTS in this repo) and, on
success, calls `process.exit(0)` (mocked to throw `'process.exit(0)'`).
`['status']` and `['task']` must therefore behave identically. To keep the test
deterministic and decoupled from the real repo tree, mock `node:fs/promises`
`readFile` to return a minimal valid backlog JSON.

```ts
// At top of file, alongside the existing vi.mock('node:fs', ...):
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () =>
    JSON.stringify({ backlog: [] })  // minimal valid tasks.json
  ),
}));
import { readFile as mockReadFile } from 'node:fs/promises';
const mockReadFileFn = mockReadFile as any;

describe('prd status alias (PRD §5.3)', () => {
  beforeEach(() => {
    mockReadFileFn.mockResolvedValue(JSON.stringify({ backlog: [] }));
  });

  it('should route "status" identically to "task" (both invoke the task handler)', () => {
    setArgv(['status']);
    expect(() => parseCLIArgs()).toThrow('process.exit(0)'); // default list → success exit
    setArgv(['task']);
    expect(() => parseCLIArgs()).toThrow('process.exit(0)');
  });

  it('should normalize "status" to subcommand "task" in the detection block', () => {
    // Drive the new branch for 100% coverage. With readFile mocked to a valid
    // backlog, the handler exits(0); we assert the parity holds for the alias.
    setArgv(['status']);
    expect(() => parseCLIArgs()).toThrow('process.exit(0)');
  });

  it('should support the same actions as task (status next / status status)', () => {
    setArgv(['status', 'next']);
    expect(() => parseCLIArgs()).toThrow('process.exit(0)');
    setArgv(['status', 'status']);
    expect(() => parseCLIArgs()).toThrow('process.exit(0)');
  });
});
```

**Approach B (lower-level):** mock `node:fs/promises` `readFile` to **throw** an
error so the handler's catch → `process.exit(1)` runs, and assert both
`['status']` and `['task']` throw `'process.exit(1)'`. This still proves parity
and covers the new branch. Use A unless A is flaky.

**CRITICAL coverage note:** whichever approach, the test MUST actually execute
the `args[0] === 'status'` true-branch (i.e. `parseCLIArgs()` is called with
`['status']`). If it is not exercised, `vitest run --coverage` drops below 100%
branches on `src/cli/index.ts` and `npm run validate` fails.

**(e) Docs [Mode A].** In `docs/CLI_REFERENCE.md`, inside the existing
`## Commands` section (which currently has `### Pipeline Execution`,
`### Scoped Execution`, `### Special Modes`), ADD a `### Task Management`
subsection:

```markdown
### Task Management

The CLI provides task-querying subcommands for inspecting the current session's
backlog:

| Command | Description |
|---------|-------------|
| `prd task`            | List all tasks in the current session (default action) |
| `prd task next`       | Show the next executable (Planned) subtask |
| `prd task status`     | Show a status-counts summary (grouped by status) |
| `prd status`          | **Alias of `prd task`** (git muscle memory; see PRD §5.3) |

**Options:**

| Option | Description |
|--------|-------------|
| `-f, --file <path>`    | Override the `tasks.json` file path |
| `-o, --output <format>`| Output format: `table` (default) or `json` |

```bash
# List all tasks
prd task
# Same thing, git-style
prd status

# Get the next executable subtask (JSON)
prd status next -o json
```
```

Keep the table/list style consistent with the existing `## Options` tables in
the file. Do NOT document `inspect`/`artifacts`/`cache` (out of scope).

### Success Criteria
- [ ] `prd status` ≡ `prd task` across all actions/options (manual smoke check).
- [ ] Exactly one `.command('status')` and one `args[0] === 'status'` branch in
      `src/cli/index.ts`.
- [ ] The `task` handler body is **shared** (extracted to one named const), not
      duplicated.
- [ ] New `describe('prd status alias (PRD §5.3)')` block exists and PASSES, and
      drives the new `status` branch (100% branch coverage preserved).
- [ ] `docs/CLI_REFERENCE.md` has the new `### Task Management` subsection.
- [ ] `npm run validate` GREEN; `npm run build` succeeds; 100% coverage on
      `src/**/*.ts` preserved.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** This is a 3-file change (one CLI module + one test + one doc section).
Its correctness hinges on six non-obvious facts, all pinned below with exact
file:line anchors: (1) the `task` command's action handler is an inline
≈100-line lambda at `src/cli/index.ts:≈494–585` that must be **extracted**, not
duplicated; (2) the registration seam — add a second top-level `.command('status')`
immediately after the `task` block, sharing the extracted handler; (3) the
detection-block chain at ≈line 589–625 where each subcommand returns a type-
safety-only object AFTER `program.parse()` has already run the action handler;
(4) the **aliasing semantics** — `prd status` ≡ `prd task` (DEFAULT list), and
making `status` a FULL alias (every `prd status X` ≡ `prd task X`) is the safe,
contract-compliant reading; (5) the union at line ≈248 is **unchanged** because
`status` normalizes to `task`; (6) **100% branch coverage** is enforced
(`vitest.config.ts` thresholds 100/100/100/100 on `src/**/*.ts`) — the new
`status` detection branch MUST be driven by a test. The scope fences are airtight
(no logic change, no other subcommand, no union change, zero overlap with S1).

### Documentation & References
```yaml
# MUST READ — the PRD spec
- docfile: PRD.md
  section: "5.3 Task Management" (h3.11) — the "`prd status` is aliased to
           `prd task` for git muscle memory" bullet.
  why: The ENTIRE normative rule S2 implements.
  critical: The alias target is the `prd task` COMMAND (default list), which
            means `status` should be a full alias (status next/status status
            also work), not only the bare `status`.

# MUST READ — this subtask's research (proven facts about the working tree)
- docfile: plan/008_15504f60a0ef/P2M3T1S2/research/s2-codebase-analysis.md
  section: §1 (contract), §2 (union — unchanged), §3 (task registration site),
       §4 (aliasing ambiguity + resolution), §5 (detection block seam),
       §6 (test approach + inspect.test.ts pattern), §7 (docs seam),
       §8 (validation), §9 (scope fences)
  why: Proves every edit site, the aliasing resolution, the 100%-coverage risk,
       and the exact test to write.

# MUST READ — architecture reference (cited by the contract itself)
- docfile: plan/008_15504f60a0ef/architecture/signatures.md
  section: (CLI structure is implicit in the contract; no CLI-specific section,
           but the doc is the project's signature reference)
  why: The contract's RESEARCH NOTE points here for CLI structure context.

# THE FILE TO EDIT (CLI wiring)
- file: src/cli/index.ts
  section: parseCLIArgs (line ≈247). Three edit sites:
       (1) extract task handler to a named const before the `task` registration;
       (2) add `.command('status')` after the `task` registration (≈line 499);
       (3) add `if (args[0] === 'status')` branch in the detection chain
           (≈line 589–625, alongside the `task` branch).
  why: This is where commander.js subcommands are registered and where the
       post-parse detection block normalizes which subcommand ran.
  pattern: Every existing subcommand (`inspect`, `artifacts`, `validate-state`,
       `cache`, `task`) follows the same two-part pattern: a `.command(…).action(…)`
       registration, then a sibling `if (args[0] === '<name>') { return {…} }`
       branch. The new `status` command + branch must mirror this exactly.
  gotcha: Do NOT add a `'status'` member to the return-type union — the
       detection branch returns `subcommand: 'task'` (normalization), so the
       existing `'task'` member already represents it. Do NOT change the task
       handler's list/next/status logic — only EXTRACT it. Do NOT touch
       inspect/artifacts/validate-state/cache.

# THE FILE TO EDIT (regression + coverage test)
- file: tests/unit/cli/index.test.ts
  section: existing top-level `describe('cli/index', …)`; add a sibling
       `describe('prd status alias (PRD §5.3)', …)`.
  why: Locks the alias behavior AND exercises the new `status` detection branch
       (required for 100% branch coverage on src/cli/index.ts).
  pattern: `setArgv([...])` + `parseCLIArgs()` + `expect(...).toThrow(...)`
       — the EXACT style of the existing scope/PRD-file tests in this file.
       The file already mocks `node:fs` (existsSync) and logger; for the alias
       test ALSO mock `node:fs/promises` `readFile` (the task handler imports it
       dynamically) to keep the test deterministic.
  gotcha: MUST actually call `parseCLIArgs()` with `['status']` so the new
       branch is executed — otherwise `npm run validate` fails on coverage.
       Prefer mocking readFile to return a minimal valid backlog
       (`{ backlog: [] }`) so the handler exits(0) cleanly.

# THE FILE TO EDIT (docs — Mode A, rides with the work)
- file: docs/CLI_REFERENCE.md
  section: `## Commands` (add `### Task Management` subsection). The file
           currently has NO documentation of the `task` subcommand.
  why: PRD/contract item 5 requires documenting the alias. Mode A = the doc
       change rides WITH this work (not a separate doc-sweep subtask).
  pattern: mirror the file's existing markdown tables (see `## Options` tables)
       and fenced bash code blocks (see `## Examples`).
  gotcha: ONLY document `task` + `status` (the alias). Do NOT add docs for
       inspect/artifacts/cache/etc. (out of scope).

# CONTRACT INPUTS (read-only — owned by other layers)
- file: vitest.config.ts
  section: coverage.include = ['src/**/*.ts']; thresholds 100/100/100/100.
  why: Confirms the new `status` branch is coverage-gated. A test MUST exercise
       it or `npm run validate` fails.
  gotcha: READ-ONLY for S2 (do not edit config).

- file: package.json
  section: scripts.validate = lint + format:check + typecheck + test:run.
  why: The green gate.
```

### Current Codebase tree (relevant slice)
```bash
src/
  cli/
    index.ts                 # EDIT — extract taskAction; +.command('status'); +status detection branch
    commands/                # untouched (inspect, artifacts, validate-state, cache)
tests/
  unit/
    cli/
      index.test.ts          # EDIT — +describe('prd status alias (PRD §5.3)')
      commands/
        inspect.test.ts      # READ-ONLY — subcommand-test pattern reference
docs/
  CLI_REFERENCE.md           # EDIT — +### Task Management subsection
vitest.config.ts             # READ-ONLY — 100% coverage thresholds
package.json                 # READ-ONLY — `npm run validate` gate
PRD.md                       # READ-ONLY — §5.3 (h3.11) source of truth
```

### Desired Codebase tree with files to be added and responsibility of file
```bash
src/cli/index.ts             # MODIFIED — taskAction extracted; +status command (alias); +status detection branch
tests/unit/cli/index.test.ts # MODIFIED — +describe block (alias parity + covers new branch)
docs/CLI_REFERENCE.md        # MODIFIED — +### Task Management subsection (task + status alias)
# (no NEW files)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL (don't duplicate the handler): the `task` action handler is ~100
// lines (try/catch, dynamic import('node:fs/promises'), readFile/JSON.parse,
// next/status/default branches, process.exit(0)/exit(1)). EXTRACT it to ONE
// named const and have BOTH .command('task') and .command('status') pass that
// const to .action(). Do NOT copy-paste the body into the status registration.

// CRITICAL (aliasing target): PRD §5.3 says `prd status` is aliased to
// `prd task`. The DEFAULT action of `prd task` is list-all. So `prd status`
// (bare) → list-all. Making `status` a FULL alias (so `prd status next` ≡
// `prd task next`, etc.) is the safe, contract-compliant reading ("same
// description, argument, and options as task, sharing the same action handler").
// Implement the full alias — it strictly satisfies the bare-alias requirement.

// CRITICAL (union unchanged): the contract says the detection block should
// "return {subcommand:'task', options} for 'status' invocations." That
// NORMALIZES status→task, so the existing `{ subcommand: 'task'; options }`
// union member already covers it. Do NOT add a phantom `{ subcommand: 'status' }`
// member — it would be produced nowhere (dead code) and is explicitly NOT what
// the contract asks for.

// CRITICAL (100% branch coverage): vitest.config.ts enforces 100/100/100/100 on
// src/**/*.ts. The new `if (args[0] === 'status')` branch is NEW src/ code and
// MUST be executed by a test. The describe block in index.test.ts must call
// parseCLIArgs() with ['status'] — or `npm run validate` fails on coverage.

// GOTCHA (execution model — do not "fix" it): by the time the detection-block
// chain runs, program.parse(process.argv) has ALREADY invoked the matching
// action handler, which calls process.exit(0) on success / exit(1) on error.
// So each `if (args[0] === '<name>') { return {…} }` branch is reached only in
// the (unreachable) success path — this is the EXISTING pattern for ALL
// subcommands (inspect/artifacts/validate-state/cache/task). The new status
// branch mirrors it byte-for-byte. Do not try to restructure this.

// GOTCHA (test mocking): the task handler does `await import('node:fs/promises')`
// and reads the tasks file. tests/unit/cli/index.test.ts currently mocks
// node:fs (existsSync) + logger but NOT node:fs/promises. For a deterministic
// alias test, add `vi.mock('node:fs/promises', …)` returning a minimal valid
// backlog JSON `{ backlog: [] }` so the handler exits(0) (thrown as
// 'process.exit(0)'). This avoids coupling to the real repo tree.

// GOTCHA (commander command collision): `task` ALREADY accepts `prd task status`
// (action='status' → status-counts summary). Registering a TOP-LEVEL
// .command('status') does NOT collide, because commander routes `prd status`
// (status as the FIRST positional) to the new top-level command, while
// `prd task status` routes status as an ARGUMENT to the task command. Both
// coexist. Verify with a quick manual smoke: `npm run dev -- status` and
// `npm run dev -- task status` should BOTH work (and mean different things —
// the former is list-all, the latter is the status-counts summary). This is
// correct per PRD §5.3.

// CRITICAL (scope): do NOT edit any other subcommand, the task handler's LOGIC,
// PRD.md, tasks.json, prd_snapshot.md, vitest.config.ts, or any docs other than
// the new CLI_REFERENCE.md subsection. Zero file overlap with parallel S1.
```

---

## Implementation Blueprint

### Data models and structure
None. S2 adds NO new types/constants/models. (The optional `TaskActionOptions`
inline type for the extracted handler param is the only type-level addition, and
it only names the existing `{ file?: string; output?: string }` shape commander
already passes.)

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: MODIFY src/cli/index.ts — extract taskAction + register status alias + detection branch
  - LOCATE the `program.command('task')…` block (≈line 487) and its inline
    `.action(async (action, options) => { … })` (body ≈lines 494–585).
  - EXTRACT that body into `const taskAction = async (action, options) => { … }`
    declared ABOVE the `task` registration (before the `// Add task subcommand`
    comment). Keep the body byte-for-byte identical (only move it).
  - CHANGE the `task` registration's `.action(async (action, options) => {...})`
    to `.action(taskAction)`.
  - ADD a second `.command('status')` block immediately AFTER the task block:
      program
        .command('status')
        .description('Display and query pipeline tasks (alias of `task`)')
        .argument('[action]', 'Action: (none), next, status', '')
        .option('-f, --file <path>', 'Override tasks.json file path')
        .option('-o, --output <format>', 'Output format (table, json)', 'table')
        .action(taskAction);
  - ADD, in the detection-block chain (≈line 589–625), a `status` branch
    alongside the existing `task` branch:
      if (args.length > 0 && args[0] === 'status') {
        return { subcommand: 'task', options: {} };
      }
  - PRESERVE: every other subcommand, the `task` handler LOGIC, the return-type
    union (line ≈248, UNCHANGED), and all default-pipeline code below.
  - FOLLOW pattern: the two-part (registration + detection branch) shape used by
    inspect/artifacts/validate-state/cache/task.
  - GOTCHA: do NOT add a 'status' union member (normalization → 'task').
    do NOT change list/next/status logic. do NOT touch other subcommands.

Task 2: MODIFY tests/unit/cli/index.test.ts — add alias + coverage test
  - ADD `vi.mock('node:fs/promises', …)` near the existing `vi.mock('node:fs', …)`,
    returning a minimal valid backlog JSON via `readFile: vi.fn(async () =>
    JSON.stringify({ backlog: [] }))`. Import + alias it for per-test override.
  - ADD a `describe('prd status alias (PRD §5.3)', …)` block with cases that:
      * route `['status']` and `['task']` to the SAME outcome (both exit(0))
        → proves alias + exercises the new detection branch (coverage);
      * route `['status','next']` and `['status','status']` to exit(0) → proves
        full-alias surface.
  - FOLLOW pattern: `setArgv([...])` + `parseCLIArgs()` + `expect(...).toThrow(...)`
    — the existing style in this file.
  - GOTCHA: MUST actually invoke parseCLIArgs() with ['status'] so the new src/
    branch is covered (else `npm run validate` fails on 100% branch coverage).

Task 3: MODIFY docs/CLI_REFERENCE.md — add ### Task Management subsection
  - LOCATE `## Commands` (after `### Special Modes` or as a new sibling).
  - ADD `### Task Management` with a command table (`prd task`, `prd task next`,
    `prd task status`, `prd status` alias), an options table (`-f`, `-o`), and
    a fenced bash example block.
  - FOLLOW pattern: the file's existing markdown tables (`## Options`) and fenced
    code blocks (`## Examples`).
  - GOTCHA: document ONLY task + status alias. Do NOT document inspect/artifacts/
    cache (out of scope).

Task 4: VERIFY — no regressions
  - RUN `npm run typecheck` → exit 0 (extracted handler typechecks; union
    unchanged; status command compiles).
  - RUN `npx vitest run tests/unit/cli/index.test.ts` → ALL green incl. new block.
  - RUN `npx vitest run --coverage` → 100/100/100/100 on src/**/*.ts (the new
    status branch is covered by Task 2).
  - RUN `npm run validate` → GREEN.
  - RUN `npm run build` → succeeds.
  - SMOKE: `npm run dev -- task` vs `npm run dev -- status` → identical output;
    `npm run dev -- task status` vs `npm run dev -- status` → DIFFERENT (the
    former is status-counts, the latter is list-all) — this is correct per PRD.
  - VERIFY only the three intended files changed: `git diff --name-only` →
    src/cli/index.ts + tests/unit/cli/index.test.ts + docs/CLI_REFERENCE.md.
```

### Implementation Patterns & Key Details
```ts
// PATTERN: two-part subcommand (registration + detection branch). src/cli/index.ts
// (existing) — every subcommand looks like this; the new `status` mirrors it:

// ---- registration ----
program
  .command('status')
  .description('Display and query pipeline tasks (alias of `task`)')
  .argument('[action]', 'Action: (none), next, status', '')
  .option('-f, --file <path>', 'Override tasks.json file path')
  .option('-o, --output <format>', 'Output format (table, json)', 'table')
  .action(taskAction);   // ← SHARED with .command('task'), not duplicated

// ---- detection branch (type-safety-only; program.parse already ran the action) ----
if (args.length > 0 && args[0] === 'status') {
  return { subcommand: 'task', options: {} };   // ← normalize status → task
}

// PATTERN: extract the shared handler so both commands reuse ONE body.
const taskAction = async (
  action: string,
  options: { file?: string; output?: string }
): Promise<void> => {
  try {
    const { readFile } = await import('node:fs/promises');
    // … unchanged: read tasks file, dispatch on action ('next'|'status'|default),
    //     process.exit(0) on success …
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger().error(`Task command failed: ${errorMessage}`);
    process.exit(1);
  }
};
// then: program.command('task')…   .action(taskAction);
//       program.command('status')…  .action(taskAction);

// PATTERN (test): parity + coverage. tests/unit/cli/index.test.ts
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => JSON.stringify({ backlog: [] })),
}));
describe('prd status alias (PRD §5.3)', () => {
  it('routes "status" identically to "task" and covers the new branch', () => {
    setArgv(['status']);
    expect(() => parseCLIArgs()).toThrow('process.exit(0)');
    setArgv(['task']);
    expect(() => parseCLIArgs()).toThrow('process.exit(0)');
  });
  it('supports the full alias surface (status next / status status)', () => {
    for (const action of ['next', 'status']) {
      setArgv(['status', action]);
      expect(() => parseCLIArgs()).toThrow('process.exit(0)');
    }
  });
});

// CRITICAL: the new `if (args[0] === 'status')` branch is NEW src/ code under
//   the 100%-coverage include glob. The `['status']` invocation in the test MUST
//   run parseCLIArgs() so the branch is executed. (It does.)
// CRITICAL: do NOT add a 'status' union member — normalize to 'task'.
// CRITICAL: `prd status` (bare) and `prd task status` mean DIFFERENT things and
//   that is correct (bare status = list-all alias; `task status` = status-counts).
```

### Integration Points
```yaml
CLI (src/cli/index.ts):
  - add: `.command('status')` registration sharing `taskAction`.
  - add: `if (args[0] === 'status')` detection branch → `{ subcommand: 'task' }`.
  - refactor: extract the `task` inline handler to a named `taskAction` const.
  - unchanged: the `parseCLIArgs` return-type union; the `task` handler LOGIC;
    all other subcommands; all default-pipeline option parsing.

TESTS (tests/unit/cli/index.test.ts):
  - add: `vi.mock('node:fs/promises', …)` (minimal valid backlog).
  - add: `describe('prd status alias (PRD §5.3)')` block (alias parity + branch coverage).

DOCS (docs/CLI_REFERENCE.md):
  - add: `### Task Management` subsection (command table, options table, example).

NO DATABASE / NO ROUTES / NO ENV VARS / NO CONFIG KEYS / NO OTHER SUBCOMMANDS /
NO PRD.md / NO tasks.json
  — pure CLI-alias wiring + test + doc.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run typecheck      # tsc --noEmit → exit 0 (extracted handler, status cmd, union unchanged)
npm run lint           # eslint . --ext .ts → no new violations
npm run format:check   # prettier; run `npm run format` if it complains
# Expected: Zero errors. The refactor (extract handler) + additive command/branch
# should trip no rule.
```

### Level 2: Unit Tests (Component Validation)
```bash
npx vitest run tests/unit/cli/index.test.ts          # incl. new alias describe block
npx vitest run --coverage                            # 100/100/100/100 on src/**/*.ts
npm run test:run                                     # full suite green
# Expected: ALL green. The new `status` detection branch is exercised (else
# coverage fails). Existing cli/index tests still pass (the refactor is
# behavior-preserving: same handler, now shared).
```

### Level 3: Integration Testing (System Validation)
```bash
npm run validate      # lint + format:check + typecheck + test:run → GREEN
npm run build         # compiles dist → succeeds

# Manual smoke (alias parity + the bare-status vs task-status distinction):
npm run dev -- task          > /tmp/t.txt
npm run dev -- status        > /tmp/s.txt
diff /tmp/t.txt /tmp/s.txt   # EXPECT: no diff (status ≡ task, default list)

npm run dev -- status next   # EXPECT: "Next task: …" or "No tasks remaining."
npm run dev -- status status # EXPECT: "Task status summary:" + counts
npm run dev -- task status   # EXPECT: SAME as `status status` (status-counts)
# (Confirms `prd status` (bare) = list-all, while `prd task status` =
#  status-counts — both correct per PRD §5.3.)
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Confirm exactly one status command + one status detection branch:
rg -n "\.command\('status'\)" src/cli/index.ts          # EXPECT: one match
rg -n "args\[0\] === 'status'" src/cli/index.ts         # EXPECT: one match

# Confirm the union was NOT bloated with a phantom 'status' member:
rg -n "subcommand: 'status'" src/cli/index.ts           # EXPECT: no match (normalized to 'task')

# Confirm the task handler body is shared, not duplicated:
rg -n "Task command failed" src/cli/index.ts            # EXPECT: one match (single catch block)

# Confirm the new doc subsection exists:
rg -n "### Task Management" docs/CLI_REFERENCE.md       # EXPECT: one match
rg -n "prd status" docs/CLI_REFERENCE.md                # EXPECT: one+ match (alias documented)

# Confirm only the three intended files changed:
git diff --name-only
# EXPECT: src/cli/index.ts, tests/unit/cli/index.test.ts, docs/CLI_REFERENCE.md
#   (NO other subcommand file, NO PRD.md/tasks.json/prd_snapshot.md, NO config.)
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` exit 0 (handler extracted, status command compiles,
      union unchanged).
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + `vitest run`).
- [ ] `npm run build` succeeds.
- [ ] 100% coverage on `src/**/*.ts` preserved (new `status` branch covered).

### Feature Validation
- [ ] `prd status` ≡ `prd task` (default list); `status next` ≡ `task next`;
      `status status` ≡ `task status`; `-f`/`-o` honored.
- [ ] Exactly one `.command('status')` and one `args[0] === 'status'` branch.
- [ ] The `task` handler body is shared (single `taskAction`), not duplicated.
- [ ] `docs/CLI_REFERENCE.md` has the `### Task Management` subsection.
- [ ] Manual smoke: `prd status` and `prd task` produce identical output.

### Code Quality Validation
- [ ] Follows the existing two-part subcommand pattern (registration + detection).
- [ ] The extracted handler is behavior-preserving (only moved, not edited).
- [ ] The `status` description notes the alias (discoverable in `--help`).
- [ ] Test mocks `node:fs/promises` for determinism (not coupled to repo tree).

### Documentation & Deployment
- [ ] `### Task Management` doc consistent with existing table/code-block style.
- [ ] No new env vars / config keys / routes (pure CLI alias).
- [ ] No out-of-scope docs edits.

---

## Anti-Patterns to Avoid
- ❌ Don't **duplicate** the `task` action handler into the `status` registration
  — extract it to one named `taskAction` and share it.
- ❌ Don't add a phantom `{ subcommand: 'status' }` **union member** — the
  detection branch normalizes `status`→`task` (the existing member covers it).
- ❌ Don't change the `task` handler's **logic** (list/next/status) — only move it.
- ❌ Don't forget to **drive the new `status` branch** in a test, or 100% branch
  coverage fails `npm run validate`.
- ❌ Don't confuse `prd status` (bare, = list-all alias) with `prd task status`
  (= status-counts summary) — they are DIFFERENT and both must keep working.
- ❌ Don't touch inspect/artifacts/validate-state/cache, the union, PRD.md,
  tasks.json, prd_snapshot.md, or vitest.config.ts.
- ❌ Don't document other subcommands in `docs/CLI_REFERENCE.md` (only task+status).
- ❌ Don't restructure the detection-block's "type-safety-only after
  `program.parse`" execution model — mirror it byte-for-byte.

---

## Confidence Score

**9/10** — One-pass success likelihood is very high. S2 is a 3-file, behavior-
preserving change: (1) **extract** an existing ≈100-line action handler to a
named const (no logic edit), (2) register a second top-level commander command
that **shares** that const, (3) add a 4-line detection branch that mirrors the
existing `task` branch, plus a parity/coverage test and a doc subsection. The
correctness rests on six pre-proven facts: the exact edit sites (task
registration ≈487, handler body ≈494–585, detection chain ≈589–625), the
aliasing semantics (full alias of the `task` command surface), the union-unchanged
normalization (status→task), the existing two-part subcommand pattern to mirror,
the commander command-collision resolution (bare `status` vs `task status`
coexist correctly), and the 100%-branch-coverage gate (the test MUST invoke
`['status']`). The single notable risk — the coverage gate — is explicitly
handled by the test design (the `['status']` invocation drives the new branch).
Zero file overlap with parallel S1. The remaining 1/10 is ordinary
mock-fidelity risk on `node:fs/promises` (mitigated by mocking `readFile` to a
minimal valid backlog).