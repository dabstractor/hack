# Research: ToolExecutor Type Drift Bug

## Summary

The three MCP tool modules (`bash-mcp.ts`, `filesystem-mcp.ts`, `git-mcp.ts`) import a `ToolExecutor`
type from `groundswell`'s **public barrel** — which resolves to the *providers* definition
`dist/types/providers.d.ts`: `(request: ToolExecutionRequest) => Promise<ToolExecutionResult>`.
However, `MCPHandler.registerToolExecutor()` (defined in `dist/core/mcp-handler.d.ts`) expects a
**structurally different, locally-declared** `ToolExecutor`: `(input: unknown) => Promise<unknown>`.
Because the public barrel never re-exports the `MCPHandler`-local `ToolExecutor`, the tool modules
cast their concrete callbacks `as ToolExecutor` (the providers version) and pass them to
`registerToolExecutor`. Under `strict` mode, each of the 9 call sites produces **two** errors — one
TS2352 on the unsound `as` cast and one TS2345 on the incompatible argument — totalling **18 errors**.
The runtime contract matches the `MCPHandler`-local type (executors are invoked with a bare `input`,
never a `ToolExecutionRequest`), so the providers `ToolExecutor` is the wrong type to bind against.

## Findings

### 1. Every `registerToolExecutor` call site (9 total)

All three files share the same import line:

```ts
import { MCPHandler, type Tool, type ToolExecutor } from 'groundswell';
```

**`src/tools/bash-mcp.ts`** — lines 272–276:

```ts
this.registerToolExecutor(
  'bash',
  'execute_bash',
  executeBashCommand as ToolExecutor
);
```

Concrete callback signature:
```ts
async function executeBashCommand(input: BashToolInput): Promise<BashToolResult>
```
where `BashToolInput = { command: string; cwd?: string; timeout?: number }` and
`BashToolResult = { success: boolean; stdout: string; stderr: string; exitCode: number | null; error?: string }`.

**`src/tools/filesystem-mcp.ts`** — lines 512–531 (4 calls):

```ts
this.registerToolExecutor('filesystem', 'file_read',   readFile   as ToolExecutor);
this.registerToolExecutor('filesystem', 'file_write',  writeFile  as ToolExecutor);
this.registerToolExecutor('filesystem', 'glob_files',  globFiles  as ToolExecutor);
this.registerToolExecutor('filesystem', 'grep_search', grepSearch as ToolExecutor);
```

Concrete callback signatures (representative):
```ts
async function readFile(input: FileReadInput):   Promise<FileReadResult>   // { success; content?; error? }
async function writeFile(input: FileWriteInput): Promise<FileWriteResult>  // { success; error? }
async function globFiles(input: GlobFilesInput): Promise<GlobFilesResult>  // { success; matches?; error? }
async function grepSearch(input: GrepSearchInput): Promise<GrepSearchResult> // { success; matches?; error? }
```

**`src/tools/git-mcp.ts`** — lines 506–509 (4 calls):

```ts
this.registerToolExecutor('git', 'git_status', gitStatus as ToolExecutor);
this.registerToolExecutor('git', 'git_diff',   gitDiff   as ToolExecutor);
this.registerToolExecutor('git', 'git_add',    gitAdd    as ToolExecutor);
this.registerToolExecutor('git', 'git_commit', gitCommit as ToolExecutor);
```

Concrete callback signatures (representative):
```ts
async function gitStatus(input: GitStatusInput):  Promise<GitStatusResult>  // { success; branch?; staged?; modified?; untracked?; error? }
async function gitDiff(input: GitDiffInput):      Promise<GitDiffResult>    // { success; diff?; error? }
async function gitAdd(input: GitAddInput):        Promise<GitAddResult>     // { success; stagedCount?; error? }
async function gitCommit(input: GitCommitInput):  Promise<GitCommitResult>  // { success; commitHash?; error? }
```

### 2. `ToolExecutor` (providers) — the type the modules actually import

**File:** `.yalc/groundswell/dist/types/providers.d.ts`

```ts
export type { ToolExecutionRequest, ToolExecutionResult };

/**
 * Tool executor callback function
 * Delegates tool execution to the MCPHandler
 */
export type ToolExecutor = (request: ToolExecutionRequest) => Promise<ToolExecutionResult>;
```

This is re-exported through the public barrel:
- `.yalc/groundswell/dist/types/index.d.ts`:
  `export type { … ToolExecutionRequest, ToolExecutionResult, ToolExecutor, … } from './providers.js';`
- `.yalc/groundswell/dist/index.d.ts`:
  `export type { … ToolExecutionRequest, ToolExecutionResult, ToolExecutor, … } from './types/index.js';`

So `import { type ToolExecutor } from 'groundswell'` resolves to **this** providers definition.

### 3. `ToolExecutor` (MCPHandler-local) — the type `registerToolExecutor` expects

**File:** `.yalc/groundswell/dist/core/mcp-handler.d.ts`

```ts
/**
 * Tool executor function type
 */
export type ToolExecutor = (input: unknown) => Promise<unknown>;

export declare class MCPHandler {
    // …
    registerToolExecutor(serverName: string, toolName: string, executor: ToolExecutor): void;
    // …
}
```

This local `ToolExecutor` is **NOT** re-exported from the public barrel (`dist/index.d.ts` only
re-exports the `MCPHandler` *class*, not its companion `ToolExecutor` type alias). The two
`ToolExecutor` aliases are therefore **structurally different**:

| Definition | Signature | Source |
|---|---|---|
| **providers** (imported by tool modules) | `(request: ToolExecutionRequest) => Promise<ToolExecutionResult>` | `dist/types/providers.d.ts` |
| **MCPHandler-local** (expected by `registerToolExecutor`) | `(input: unknown) => Promise<unknown>` | `dist/core/mcp-handler.d.ts` |

### 4. `ToolExecutionRequest` and `ToolExecutionResult` definitions

**File:** `.yalc/groundswell/dist/types/harnesses.d.ts` (re-exported through `providers.d.ts`)

```ts
/**
 * Tool execution request (PRD §7.10). Copied VERBATIM from providers.ts.
 */
export interface ToolExecutionRequest {
    /** Tool name (may be namespaced: "server__tool") */
    name: string;
    /** Tool input parameters */
    input: unknown;
}

/**
 * Tool execution result (PRD §7.10). Copied VERBATIM from providers.ts.
 */
export interface ToolExecutionResult {
    /** Result content */
    content: string | unknown;
    /** Whether the execution resulted in an error */
    isError: boolean;
}
```

Note: the concrete result shapes used by the tool modules (e.g. `BashToolResult` with
`success/stdout/stderr/exitCode`) share **no fields** with `ToolExecutionResult` (`content/isError`),
which is why the `as ToolExecutor` casts are unsound (see Finding 6).

### 5. `registerToolExecutor` method signature

**File:** `.yalc/groundswell/dist/core/mcp-handler.d.ts`

```ts
/**
 * Register a custom tool executor for an inprocess tool
 * @param serverName Server name
 * @param toolName Tool name
 * @param executor Executor function
 */
registerToolExecutor(serverName: string, toolName: string, executor: ToolExecutor): void;
```

`ToolExecutor` here binds to the **MCPHandler-local** alias `(input: unknown) => Promise<unknown>`
(Finding 3), NOT the providers alias the tool modules import.

**Runtime confirmation** (`.yalc/groundswell/dist/core/mcp-handler.js`): executors are stored
verbatim and later invoked with a single bare `input` argument — never wrapped in a
`ToolExecutionRequest`. In `createToolExecutor`:

```js
return async (input) => {
  const executor = this.toolExecutors.get(fullName);
  // …
  return executor(input);   // ← single arg, raw input
};
```

And `executeTool` / `toAgentSDKServer` / `toPiCustomTools` all call `registered.executor(input)`
with one argument and treat the return as `unknown` (stringified via `JSON.stringify`). This proves
the **MCPHandler-local** type is the correct runtime contract; the providers `ToolExecutor` describes
a *different* callback (the one harnesses pass into `harness.execute()`), not the one
`registerToolExecutor` consumes.

### 6. Root cause of the 18 typecheck errors (static analysis)

Under `tsconfig.json` (`"strict": true` → `strictFunctionTypes` enabled), each of the 9
`registerToolExecutor` call sites yields **two** errors (9 × 2 = **18**):

**(a) TS2352 on the `as ToolExecutor` cast** — the concrete callback is not assignable to the
providers `ToolExecutor` in either direction:
- Parameter (contravariant): `ToolExecutionRequest` (`{ name; input }`) is **not** assignable to
  e.g. `BashToolInput` (`{ command; cwd?; timeout? }`) — no `command` field — so the function is not
  assignable in the forward direction; the reverse also fails because `BashToolInput` lacks
  `name`/`input`.
- Therefore `expr as ToolExecutor` is reported as a possibly-mistaken conversion (TS2352),
  suggesting `as unknown as ToolExecutor`.

**(b) TS2345 on passing the cast value to `registerToolExecutor`** — even after the (errored) cast,
the expression is typed as the **providers** `ToolExecutor` `(request: ToolExecutionRequest) => Promise<ToolExecutionResult>`,
which is not assignable to the **MCPHandler-local** parameter type `(input: unknown) => Promise<unknown>`
because of parameter contravariance (`unknown` is not assignable to `ToolExecutionRequest`).

Predicted error locations (the cast column = the `as ToolExecutor` token; the arg column = the
`registerToolExecutor(` call):

| File | Function | Cast line | Call line |
|---|---|---|---|
| `src/tools/bash-mcp.ts` | `executeBashCommand` | 275 | 272 |
| `src/tools/filesystem-mcp.ts` | `readFile` | 515 | 512 |
| `src/tools/filesystem-mcp.ts` | `writeFile` | 520 | 517 |
| `src/tools/filesystem-mcp.ts` | `globFiles` | 525 | 522 |
| `src/tools/filesystem-mcp.ts` | `grepSearch` | 530 | 527 |
| `src/tools/git-mcp.ts` | `gitStatus` | 506 | 506 |
| `src/tools/git-mcp.ts` | `gitDiff` | 507 | 507 |
| `src/tools/git-mcp.ts` | `gitAdd` | 508 | 508 |
| `src/tools/git-mcp.ts` | `gitCommit` | 509 | 509 |

(For `git-mcp.ts` the call and cast are on the same single line, so both errors report that line.)

**Implication for the fix (not applied — research only):** the correct binding is to the
**MCPHandler-local** `ToolExecutor` shape `(input: unknown) => Promise<unknown>`. Because that alias
is not exported from the public barrel, the tool modules cannot name it via
`import { type ToolExecutor } from 'groundswell'`. A minimal fix either (i) widens each callback to
`(input: unknown) => Promise<unknown>` and drops the `as ToolExecutor` cast entirely, or (ii) imports
the MCPHandler-local type via a deep path if/when groundswell re-exports it. Option (i) is the
smallest-scope, runtime-correct change.

### 7. Prettier `format:check` glob vs `.prettierignore`

**`package.json` scripts:**
```json
"format:check": "prettier --check \"**/*.{ts,js,json,md,yml,yaml}\""
```

**`.prettierignore` (complete contents):**
```
node_modules/
dist/
coverage/
package-lock.json
pnpm-lock.yaml
.eslintcache
```

The glob `"**/*.{ts,js,json,md,yml,yaml}"` matches everything under the repo root not excluded by
`.prettierignore`. Crucially, `.prettierignore` does **not** list `artifacts/` or `plan/`, so
generated state files — e.g. `artifacts/**/*.md` and `plan/**/*.json` (machine-written, often not
prettier-formatted) — are swept into the check and will fail `format:check`. `npm run validate`
chains `lint && format:check && typecheck`, so these generated files break the whole validate gate
independently of the typecheck errors.

## Sources

- Kept: `src/tools/bash-mcp.ts` — full contents; `registerToolExecutor` at lines 272–276; callback `executeBashCommand(input: BashToolInput): Promise<BashToolResult>`.
- Kept: `src/tools/filesystem-mcp.ts` — 4 `registerToolExecutor` calls at lines 512–531; concrete callback signatures.
- Kept: `src/tools/git-mcp.ts` — 4 `registerToolExecutor` calls at lines 506–509; concrete callback signatures.
- Kept: `.yalc/groundswell/dist/types/providers.d.ts` — public `ToolExecutor = (request: ToolExecutionRequest) => Promise<ToolExecutionResult>`; re-exports `ToolExecutionRequest`/`ToolExecutionResult`.
- Kept: `.yalc/groundswell/dist/types/harnesses.d.ts` — `ToolExecutionRequest { name: string; input: unknown }` and `ToolExecutionResult { content: string | unknown; isError: boolean }`.
- Kept: `.yalc/groundswell/dist/core/mcp-handler.d.ts` — local `ToolExecutor = (input: unknown) => Promise<unknown>`; `registerToolExecutor(serverName, toolName, executor: ToolExecutor)`.
- Kept: `.yalc/groundswell/dist/core/mcp-handler.js` — runtime proof executors are invoked as `executor(input)` (single bare arg, return treated as `unknown`).
- Kept: `.yalc/groundswell/dist/index.d.ts` + `dist/types/index.d.ts` — barrel only re-exports the **providers** `ToolExecutor` and the `MCPHandler` *class* (not its local `ToolExecutor` alias).
- Kept: `package.json` (`format:check` glob), `.prettierignore` (no `artifacts/`/`plan/` entries), `tsconfig.json`/`tsconfig.build.json` (`strict: true`).
- Dropped: none — every source read was directly on-point.

## Gaps

- **No shell access.** The available toolset for this subagent is `read` + `write` only — there is no
  `bash`/exec tool. Consequently the exact verbatim `tsc` error strings (TS2352/TS2345 messages with
  line:col) and the exact `prettier --check` failing-file list could **not** be captured by running
  the commands. The 18-error accounting (Finding 6) is derived from static type analysis of the
  imported vs. expected `ToolExecutor` shapes and matches the reported count (9 call sites × 2
  errors). A follow-up run of `npx tsc --noEmit -p tsconfig.build.json` and
  `npx prettier --check "artifacts/**/*.md" "plan/**/*.json"` should be executed in an environment
  with shell access to confirm exact line:col and the precise set of unformatted generated files.
- The exact list of generated files under `artifacts/` and `plan/` that fail `format:check` was not
  enumerated (directory listing was unavailable with the current toolset).
- Whether groundswell intends to re-export the MCPHandler-local `ToolExecutor` from its public barrel
  (which would be the upstream-correct fix) is not determinable from the installed `dist/` alone.

## Supervisor coordination

Not contacted. The task is a self-contained static investigation and was completed with the
available `read`/`write` tools; the only material limitation (no shell for verbatim command output)
is documented in Gaps and does not require a decision.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Research-only task: produced the requested investigation (full file contents, both ToolExecutor definitions, ToolExecutionRequest/Result, registerToolExecutor signature, 18-error root-cause accounting, prettier glob analysis) as a single Markdown brief at the specified output path. Scope was not widened — no source files were modified; only the report file was written."
    }
  ],
  "changedFiles": [
    "plan/004_439241a82c24/bugfix/001_4bbb8673119e/architecture/tool_executor_type_drift.md (created — research brief only)"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "npx tsc --noEmit -p tsconfig.build.json",
      "result": "not-run",
      "summary": "Subagent toolset is read/write only (no shell). Could not execute. 18-error accounting derived via static analysis of imported ToolExecutor (providers) vs registerToolExecutor's expected ToolExecutor (MCPHandler-local); predicted TS2352 on each `as ToolExecutor` cast + TS2345 on each registerToolExecutor argument, 9 sites × 2 = 18."
    },
    {
      "command": "npx prettier --check \"artifacts/**/*.md\" \"plan/**/*.json\"",
      "result": "not-run",
      "summary": "Subagent toolset is read/write only (no shell). Could not execute. Static evidence confirms the issue: format:check glob is \"**/*.{ts,js,json,md,yml,yaml}\" and .prettierignore omits artifacts/ and plan/, so generated state files are swept into the check."
    }
  ],
  "validationOutput": [],
  "residualRisks": [
    "Exact verbatim tsc error strings/line:col and the precise prettier failing-file list are unverified because no shell was available; a shell-enabled follow-up should run both commands to confirm.",
    "The recommended minimal fix (widen callbacks to (input: unknown) => Promise<unknown> and drop the `as ToolExecutor` cast) is runtime-correct per mcp-handler.js but has not been applied or compile-verified (research-only mandate)."
  ],
  "noStagedFiles": true,
  "notes": "Root cause is a type-alias collision: groundswell ships two structurally different `ToolExecutor` aliases. The public barrel exports the providers version `(request: ToolExecutionRequest) => Promise<ToolExecutionResult>`, but MCPHandler.registerToolExecutor expects its local version `(input: unknown) => Promise<unknown>`, which is NOT re-exported. The tool modules cast to the wrong (providers) alias. Runtime contract (mcp-handler.js calls `executor(input)` with one bare arg) confirms the MCPHandler-local type is correct. 9 registerToolExecutor call sites × 2 errors each = 18 typecheck errors, matching the reported count. Separately, prettier format:check fails on generated artifacts/ and plan/ files because .prettierignore does not exclude those directories."
}
```
