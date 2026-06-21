---
name: "P1.M2.T2.S1 — Replace `as ToolExecutor` casts with type-safe adapters"
task_id: "P1.M2.T2.S1"
issue_ref: "Issue 4 (ToolExecutor type drift) — 18 typecheck errors in src/tools/*.ts"
prd_ref: "§9.3.3 (tools via MCPHandler); Bug Fix Requirements §Minor.Issue4"
scope: "Type-level fix only — no runtime/behavior change, no new deps, no mocking"
---

# PRP — Replace `as ToolExecutor` casts with type-safe adapters

## Goal

**Feature Goal**: Eliminate all 18 TypeScript compilation errors in `src/tools/bash-mcp.ts`,
`src/tools/filesystem-mcp.ts`, and `src/tools/git-mcp.ts` that are caused by binding the **wrong**
`ToolExecutor` type alias to `MCPHandler.registerToolExecutor()` call sites — **without changing
runtime behavior or any exported callback signature**.

**Deliverable**: The 9 `registerToolExecutor(...)` call sites across the three tool modules are
rewritten to pass an **inline adapter** `async (input: unknown) => fn(input as XxxInput)` whose type
`(input: unknown) => Promise<XxxResult>` is directly assignable to the local `ToolExecutor`
(`(input: unknown) => Promise<unknown>`) that `registerToolExecutor` expects. The now-unused
`type ToolExecutor` import is removed from all three files.

**Success Definition**:
- `npx tsc --noEmit -p tsconfig.build.json` reports **0 errors total** (down from exactly 18, all
  in `src/tools/*.ts`).
- `npm run test:run -- tools/mcp-tool-parity` reports **6 tests passing** (unchanged baseline).
- The 9 exported callback functions (`executeBashCommand`, `readFile`, `writeFile`, `globFiles`,
  `grepSearch`, `gitStatus`, `gitDiff`, `gitAdd`, `gitCommit`) keep their exact original signatures
  and source bodies — they are NOT modified (they are imported/used elsewhere and re-exported).
- No runtime behavior change: identical callbacks are invoked with identical single bare `input`
  argument (the adapter is a transparent passthrough that exists only to satisfy the type checker).

## Why

- **Restores the `npm run validate` gate** (`lint && format:check && typecheck`). Every Session-004
  task contract requires "`npm run validate` must pass" — these 18 errors block that gate in
  isolation. (The `format:check` half is fixed by the sibling task P1.M2.T2.S2; this task owns the
  `typecheck` half.)
- **Removes an unsound cast.** The current `fn as ToolExecutor` casts against the *providers*
  `ToolExecutor` — a structurally different alias that does **not** match the runtime contract. The
  adapter binds to the *correct* (`mcp-handler`-local) contract and keeps the one safe narrowing
  assertion (`input as XxxInput`) localized to where it is justified by runtime JSON-schema
  validation.
- **Pre-existing, not introduced by Session 004** (confirmed at pre-Session commit `e3d82f4`: 24
  errors there; 18 now), but it must be left green so the fix tasks' validation gates are real.

## What

User-visible behavior: **none** (the pipeline runs identically). This is a type-level repair.

Technical requirement: replace each `fn as ToolExecutor` argument to `registerToolExecutor` with an
inline arrow adapter, and delete `type ToolExecutor` from the three `groundswell` import lines.

### Success Criteria

- [ ] `npx tsc --noEmit -p tsconfig.build.json` → 0 errors (was 18).
- [ ] `npm run test:run -- tools/mcp-tool-parity` → 6 tests pass.
- [ ] No `as ToolExecutor` token remains anywhere in `src/tools/*.ts` (`grep -rn "as ToolExecutor" src/tools/` is empty).
- [ ] `grep -n "type ToolExecutor" src/tools/*.ts` is empty (the import is dropped from all 3 files).
- [ ] All 9 callback functions remain verbatim (`git diff` shows edits only at the 9 call sites and
      the 3 import lines; the `async function fn(...)` definitions are untouched).

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement this
successfully?_ **Yes** — this PRP includes the exact root cause (two structurally different
`ToolExecutor` aliases in the consumed `groundswell` dist), the exact 9 call sites with line
numbers, the exact before/after code, the runtime contract proof, the import-line edits, the scope
boundaries (what NOT to touch), and the exact validation commands with verified current outputs.

### Documentation & References

```yaml
# MUST READ — root-cause investigation (full call-site inventory + both ToolExecutor definitions)
- docfile: plan/004_439241a82c24/bugfix/001_4bbb8673119e/architecture/tool_executor_type_drift.md
  why: Authoritative research brief. Proves via static analysis + mcp-handler.js runtime inspection
       that the MCPHandler-local ToolExecutor = (input: unknown) => Promise<unknown> is the correct
       contract; the providers ToolExecutor the modules import is a DIFFERENT callback. Lists all 9
       call sites with predicted line:col and the 18-error accounting (9 sites × TS2345 + TS2352).
  critical: The local ToolExecutor is NOT exported from groundswell's public barrel — so it cannot
       be named via `import { type ToolExecutor } from 'groundswell'`. The fix MUST bind to the
       local shape structurally (via the adapter's inferred type), NOT by importing the type.

- docfile: plan/004_439241a82c24/bugfix/001_4bbb8673119e/architecture/system_context.md
  section: §5a
  why: Cross-file dependency map + the shared `import { MCPHandler, type Tool, type ToolExecutor } from 'groundswell'`
       line across all three files; confirms the runtime contract that executors are invoked with a
       single bare `input` arg and their return is JSON.stringified.

# The three target source files (read the call sites + the import line; do NOT edit the callbacks)
- file: src/tools/bash-mcp.ts
  why: 1 registerToolExecutor call site (line 272) + import line (~line 30) to edit. Callback
       executeBashCommand(input: BashToolInput): Promise<BashToolResult> defined at line 131 — DO NOT EDIT.
- file: src/tools/filesystem-mcp.ts
  why: 4 registerToolExecutor call sites (file_read/file_write/glob_files/grep_search ~lines 512-528)
       + import line to edit. Callbacks readFile/writeFile/globFiles/grepSearch defined at lines
       296/349/394/436 — DO NOT EDIT.
- file: src/tools/git-mcp.ts
  why: 4 registerToolExecutor call sites (git_status/git_diff/git_add/git_commit ~lines 505-508,
       single-line form) + import line to edit. Callbacks gitStatus/gitDiff/gitAdd/gitCommit defined
       at lines 289/351/385/420 — DO NOT EDIT. NOTE: the comment at the call block says
       "Register tool executors with ToolExecutor cast" — update that comment to drop "with
       ToolExecutor cast" phrasing since the cast is removed.

# The groundswell dist types that define BOTH ToolExecutor aliases (read-only, for understanding)
- file: .yalc/groundswell/dist/core/mcp-handler.d.ts
  why: Line 13: `export type ToolExecutor = (input: unknown) => Promise<unknown>;` — the LOCAL type
       registerToolExecutor expects (line 45). This is the correct binding target.
  gotcha: This alias is NOT in the public barrel export list (.yalc/groundswell/dist/index.d.ts
       re-exports only the PROVIDERS ToolExecutor). Do NOT try to import it via a deep path —
       `skipLibCheck` is on, but deep imports are brittle; use the inline adapter instead.
- file: .yalc/groundswell/dist/types/providers.d.ts
  why: `export type ToolExecutor = (request: ToolExecutionRequest) => Promise<ToolExecutionResult>;`
       — the WRONG alias the tool modules currently import. ToolExecutionResult = { content; isError }
       which shares NO fields with the tool result shapes (e.g. BashToolResult = { success; stdout;
       stderr; exitCode }) — this is why the current `as ToolExecutor` cast is unsound (TS2352).
- file: .yalc/groundswell/dist/core/mcp-handler.js
  why: Runtime proof. createToolExecutor returns `async input => { ...; return executor(input); }`
       — executors are invoked with ONE bare `input` arg and the return is JSON.stringified. Confirms
       the MCPHandler-local type is the runtime contract; the providers ToolExecutor describes a
       different callback (harness.execute()), not the one registerToolExecutor consumes.

# The test file — explicitly OUT OF SCOPE (do NOT touch), but read to understand why it's safe
- file: tests/unit/tools/mcp-tool-parity.test.ts
  why: Lines 6-8 import type ToolExecutor/ToolExecutionRequest/ToolExecutionResult FROM groundswell
       for the test's OWN stub (lines 117-123: a ToolExecutor delegating to mcp.executeTool). The
       test file has ZERO imports from src/tools/*.ts. tsconfig.build.json excludes tests/ (include:
       src/**/* only). Therefore dropping `type ToolExecutor` from the source files CANNOT affect it.
  gotcha: Do NOT remove these types from groundswell or from any test file. They are legitimately
       used by the parity test's stub and must keep resolving.
```

### Current Codebase tree (relevant slice)

```bash
src/tools/
├── bash-mcp.ts            # 1 call site (line 272) + import line (~line 30)  ← EDIT
├── filesystem-mcp.ts      # 4 call sites (lines ~512-528) + import line      ← EDIT
└── git-mcp.ts             # 4 call sites (lines ~505-508) + import line      ← EDIT

tests/unit/tools/
└── mcp-tool-parity.test.ts # OUT OF SCOPE — independent stub, excluded from build

.yalc/groundswell/dist/
├── core/mcp-handler.d.ts   # LOCAL ToolExecutor = (input: unknown) => Promise<unknown>  [correct target]
├── types/providers.d.ts    # PROVIDERS ToolExecutor = (req) => Promise<Result>          [wrong — currently imported]
└── index.d.ts              # barrel re-exports ONLY providers ToolExecutor + MCPHandler class

tsconfig.build.json         # include: src/**/* ; exclude: tests  → only src is type-checked
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. Three existing files edited in place:
src/tools/bash-mcp.ts       # 1 adapter substitution + import trim
src/tools/filesystem-mcp.ts # 4 adapter substitutions + import trim
src/tools/git-mcp.ts        # 4 adapter substitutions + import trim + comment reword
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: groundswell ships TWO structurally different `ToolExecutor` type aliases.
//   (1) providers  (public barrel, currently imported):  (request: ToolExecutionRequest) => Promise<ToolExecutionResult>
//   (2) mcp-handler-local (NOT exported from barrel):    (input: unknown) => Promise<unknown>
// MCPHandler.registerToolExecutor expects (2). The current code casts to (1). Result: 18 errors.

// CRITICAL: the local ToolExecutor (2) is NOT re-exported by .yalc/groundswell/dist/index.d.ts
//   (barrel exports the MCPHandler *class* + the providers ToolExecutor alias). So you CANNOT name
//   the local type via `import { type ToolExecutor } from 'groundswell'` — that always resolves to
//   (1). The adapter's INFERED type must structurally match (2); do not try to import the local alias.

// CONTRAVARIANCE: a function `(input: BashToolInput) => Promise<BashToolResult>` is NOT assignable to
//   `(input: unknown) => Promise<unknown>` directly (unknown is not assignable to BashToolInput).
//   => Simply DROPPING the `as ToolExecutor` cast is NOT sufficient (you'd get a different TS2345).
//   => The adapter widens the PARAMETER to unknown and narrows INSIDE: `async (input: unknown) => fn(input as BashToolInput)`.
//      That yields type (input: unknown) => Promise<BashToolResult>, which IS assignable to
//      (input: unknown) => Promise<unknown> (covariant return, identical param). ✓

// SAFETY of `input as XxxInput`: the tool's JSON-schema (defined in the `*Tool` const passed to
//   registerServer) validates the input shape at runtime before the executor is called. The cast is
//   a localized, justified narrowing — strictly safer than the old blanket `fn as ToolExecutor`.

// DO NOT change the exported callback function signatures (executeBashCommand / readFile / ...).
//   They are re-exported via `export type { XxxInput, XxxResult }` blocks and used elsewhere.
//   The adapter WRAPS them; it does not redefine them.

// DO NOT touch tests/unit/tools/mcp-tool-parity.test.ts. It imports ToolExecutor/
//   ToolExecutionRequest/ToolExecutionResult from groundswell for ITS OWN stub and never imports
//   from src/tools/*.ts. It is also excluded from tsconfig.build.json scope.

// tsconfig.build.json = { include: ["src/**/*"], exclude: ["node_modules","dist","tests"] }.
//   So `npx tsc --noEmit -p tsconfig.build.json` only checks src/ — the test file is never compiled
//   by this command (it's compiled by the plain `vitest`/`tsc` path instead).
```

## Implementation Blueprint

### Data models and structure

None. This task adds no models, schemas, or runtime state. It is purely a type-level repair of
existing call sites.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/tools/bash-mcp.ts — replace the single `as ToolExecutor` cast with an adapter
  - FIND (constructor, ~line 272):
      this.registerToolExecutor(
        'bash',
        'execute_bash',
        executeBashCommand as ToolExecutor
      );
  - REPLACE WITH:
      this.registerToolExecutor(
        'bash',
        'execute_bash',
        async (input: unknown) => executeBashCommand(input as BashToolInput)
      );
  - NAMING: anonymous inline arrow; param named `input` (matches the MCPHandler-local contract).
  - DEPENDENCIES: `BashToolInput` is already in scope (defined as `interface BashToolInput` near
    the top of the same file). No new import needed.
  - PRESERVE: the `async function executeBashCommand(input: BashToolInput): Promise<BashToolResult>`
    definition at line 131 — DO NOT EDIT it.

Task 2: EDIT src/tools/bash-mcp.ts — drop the now-unused `type ToolExecutor` from the import
  - FIND: `import { MCPHandler, type Tool, type ToolExecutor } from 'groundswell';`
  - REPLACE WITH: `import { MCPHandler, type Tool } from 'groundswell';`
  - GOTCHA: keep `MCPHandler` (used as the base class via `extends`/`super()`) and `type Tool`
    (used by the `tools = [bashTool]` array's typed tool consts). Only `ToolExecutor` is unused
    after Task 1.

Task 3: EDIT src/tools/filesystem-mcp.ts — replace the 4 `as ToolExecutor` casts with adapters
  - FIND (constructor, ~lines 512-528): the four calls passing
    `readFile as ToolExecutor`, `writeFile as ToolExecutor`, `globFiles as ToolExecutor`,
    `grepSearch as ToolExecutor`.
  - REPLACE WITH, respectively:
      async (input: unknown) => readFile(input as FileReadInput)
      async (input: unknown) => writeFile(input as FileWriteInput)
      async (input: unknown) => globFiles(input as GlobFilesInput)
      async (input: unknown) => grepSearch(input as GrepSearchInput)
    (each as the 3rd argument to its registerToolExecutor call).
  - DEPENDENCIES: FileReadInput/FileWriteInput/GlobFilesInput/GrepSearchInput are all in scope
    (defined in the same file; re-exported near the bottom).
  - PRESERVE: the four `async function fn(input: XxxInput): Promise<XxxResult>` definitions at
    lines 296/349/394/436 — DO NOT EDIT them.

Task 4: EDIT src/tools/filesystem-mcp.ts — drop `type ToolExecutor` from the import
  - FIND: `import { MCPHandler, type Tool, type ToolExecutor } from 'groundswell';`
  - REPLACE WITH: `import { MCPHandler, type Tool } from 'groundswell';`

Task 5: EDIT src/tools/git-mcp.ts — replace the 4 single-line `as ToolExecutor` casts
  - FIND (constructor, ~lines 505-508):
      this.registerToolExecutor('git', 'git_status', gitStatus as ToolExecutor);
      this.registerToolExecutor('git', 'git_diff', gitDiff as ToolExecutor);
      this.registerToolExecutor('git', 'git_add', gitAdd as ToolExecutor);
      this.registerToolExecutor('git', 'git_commit', gitCommit as ToolExecutor);
  - REPLACE WITH, respectively:
      this.registerToolExecutor('git', 'git_status', async (input: unknown) => gitStatus(input as GitStatusInput));
      this.registerToolExecutor('git', 'git_diff', async (input: unknown) => gitDiff(input as GitDiffInput));
      this.registerToolExecutor('git', 'git_add', async (input: unknown) => gitAdd(input as GitAddInput));
      this.registerToolExecutor('git', 'git_commit', async (input: unknown) => gitCommit(input as GitCommitInput));
  - NOTE: git-mcp.ts call sites are currently SINGLE-LINE (cast + call on one line). Keeping them
    single-line is fine (prettier width permits it); if the line exceeds the print width,
    `npx prettier --write src/tools/git-mcp.ts` in Level 1 will wrap it — that is acceptable.
  - PRESERVE: the four `async function fn(input: XxxInput): Promise<XxxResult>` definitions at
    lines 289/351/385/420 — DO NOT EDIT them.

Task 6: EDIT src/tools/git-mcp.ts — drop `type ToolExecutor` from the import AND reword the stale comment
  - FIND import: `import { MCPHandler, type Tool, type ToolExecutor } from 'groundswell';`
  - REPLACE import WITH: `import { MCPHandler, type Tool } from 'groundswell';`
  - FIND comment (just above the call block, ~line 504):
      // PATTERN: Register tool executors with ToolExecutor cast
  - REPLACE comment WITH:
      // PATTERN: Register tool executors (type-safe adapters match MCPHandler's local ToolExecutor)
  - WHY: the phrase "with ToolExecutor cast" becomes false after the edit; update for accuracy.

Task 7: VERIFY (no edits — run validation gates; see Validation Loop)
  - RUN: `npx tsc --noEmit -p tsconfig.build.json` → expect 0 errors (was 18).
  - RUN: `grep -rn "as ToolExecutor" src/tools/` → expect empty.
  - RUN: `grep -n "type ToolExecutor" src/tools/*.ts` → expect empty.
  - RUN: `npm run test:run -- tools/mcp-tool-parity` → expect 6 tests pass.
```

### Implementation Patterns & Key Details

```typescript
// THE ADAPTER PATTERN (the entire fix in one line per call site):
//
// BEFORE (unsound cast against the WRONG ToolExecutor alias):
this.registerToolExecutor(
  'bash',
  'execute_bash',
  executeBashCommand as ToolExecutor   // providers alias; TS2352 + TS2345
);

// AFTER (inline adapter; type inferred as (input: unknown) => Promise<BashToolResult>):
this.registerToolExecutor(
  'bash',
  'execute_bash',
  async (input: unknown) => executeBashCommand(input as BashToolInput)
);

// WHY THIS TYPE-CHECKS (and the bare function does not):
//   - Param: `input: unknown` is IDENTICAL to the MCPHandler-local ToolExecutor's param.
//            (Dropping the cast entirely fails because the bare fn's param is BashToolInput and
//             unknown is not assignable to BashToolInput — contravariance.)
//   - Return: Promise<BashToolResult> is assignable to Promise<unknown> (covariant return). ✓
//   - Net: the arrow's type matches `(input: unknown) => Promise<unknown>` exactly. No cast on the
//     OUTER expression; the only assertion (`input as BashToolInput`) is the one justified by the
//     tool's runtime JSON-schema validation.

// RUNTIME EQUIVALENCE: the adapter is a transparent passthrough. mcp-handler.js invokes executors as
//   `return executor(input);` with one bare arg. The adapter forwards that exact arg to the same
//   callback that was previously bound, and returns its exact return value. No behavioral diff.

// IMPORT EDIT PATTERN (all three files):
import { MCPHandler, type Tool, type ToolExecutor } from 'groundswell';  // BEFORE
import { MCPHandler, type Tool } from 'groundswell';                     // AFTER
// ToolExecutor becomes unused once the 9 casts are gone. MCPHandler (base class) and Tool
// (tool-const typing) remain required — verify with grep before deleting:
//   grep -n "MCPHandler\|type Tool\b" src/tools/<file>.ts
```

### Integration Points

```yaml
DATABASE: none
CONFIG:   none
ROUTES:   none
# No new exports/imports between modules. The change is localized to the 3 tool modules' constructors
# and import lines. No other src/ file references the removed `as ToolExecutor` casts.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After editing each file (or after all edits), confirm no type/lint/format regressions.
npx tsc --noEmit -p tsconfig.build.json          # PRIMARY GATE — expect 0 errors (was 18)
npx eslint src/tools/bash-mcp.ts src/tools/filesystem-mcp.ts src/tools/git-mcp.ts --ext .ts
npx prettier --check "src/tools/**/*.ts"         # if any adapter line wrapped oddly, format it:
# npx prettier --write src/tools/git-mcp.ts src/tools/bash-mcp.ts src/tools/filesystem-mcp.ts

# Sanity greps (must be EMPTY — confirms the cast + import are fully removed):
grep -rn "as ToolExecutor" src/tools/            # expect: no matches
grep -rn "type ToolExecutor" src/tools/          # expect: no matches

# Expected: tsc 0 errors; eslint clean; prettier check passes; both greps empty.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The parity test exercises REAL tool registration + dispatch through MCPHandler.executeTool.
# It must remain green — it is the behavioral regression guard for this change.
npm run test:run -- tools/mcp-tool-parity
# Expected: "Test Files 1 passed (1)", "Tests 6 passed (6)".

# Run the full tools test surface to be safe (no new tests are required — this is a type fix):
npm run test:run -- tools
# Expected: all tool tests pass.
```

### Level 3: Integration Testing (System Validation)

```bash
# Confirm the build compiles end-to-end (the actual `build` script uses the same tsconfig.build.json).
npm run build
# Expected: exit 0, dist/ produced, no TS errors. (This is the strongest proof the type fix is real.)

# Optional: smoke-check that a tool module still instantiates and registers its executors.
npx tsx -e "import('./src/tools/bash-mcp.js').then(m => { const b = new m.BashMCP(); console.log('bash registered ok'); })"
# Expected: prints "bash registered ok" with no throw (executor wiring unchanged at runtime).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# This is a type-level fix with no domain/creative surface. The relevant extra checks:
# (a) Confirm the test file still resolves its OWN groundswell type imports (must be unaffected):
grep -n "ToolExecutor\|ToolExecutionRequest\|ToolExecutionResult" tests/unit/tools/mcp-tool-parity.test.ts
# Expected: lines 6-8 and 117-123 still reference these — they import FROM groundswell, NOT from src.
#           Do NOT edit this file.

# (b) Confirm no other src/ file relied on the removed casts (there should be none):
grep -rn "as ToolExecutor" src/
# Expected: empty (all 9 sites were in src/tools/; none elsewhere).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit -p tsconfig.build.json` reports **0 errors** (verified baseline: 18).
- [ ] `npm run build` exits 0.
- [ ] `npm run test:run -- tools/mcp-tool-parity` → **6 tests pass** (verified baseline: 6 pass).
- [ ] `npm run test:run -- tools` → all tool tests pass.
- [ ] `npx eslint src/tools/*.ts` → clean.
- [ ] `npx prettier --check "src/tools/**/*.ts"` → passes.
- [ ] `grep -rn "as ToolExecutor" src/tools/` → empty.
- [ ] `grep -rn "type ToolExecutor" src/tools/` → empty.

### Feature Validation

- [ ] All 9 call sites converted to inline `async (input: unknown) => fn(input as XxxInput)` adapters.
- [ ] All 3 `groundswell` import lines trimmed to `import { MCPHandler, type Tool } from 'groundswell';`.
- [ ] The 9 exported callback function definitions are **byte-for-byte unchanged** (`git diff` on the
      `async function fn(...)` blocks = empty).
- [ ] The git-mcp.ts stale comment ("with ToolExecutor cast") reworded.
- [ ] `tests/unit/tools/mcp-tool-parity.test.ts` **not modified**.

### Code Quality Validation

- [ ] No new patterns introduced — the inline-arrow-adapter is idiomatic TS for contravariant bridging.
- [ ] No runtime behavior change (transparent passthrough; identical callback, identical single arg).
- [ ] No new dependencies; no config changes; no migrations.
- [ ] The one remaining assertion (`input as XxxInput`) is localized and justified by runtime
      JSON-schema validation (documented in the gotcha block).

### Documentation & Deployment

- [ ] Self-documenting adapters (`input: unknown` parameter name matches the MCPHandler contract).
- [ ] Updated inline comment in git-mcp.ts reflects the new (cast-free) approach.

---

## Anti-Patterns to Avoid

- ❌ Don't replace the cast with `as unknown as ToolExecutor` (double cast) — that silences the
  compiler but preserves the wrong-type binding and is strictly worse than the current code.
- ❌ Don't change the exported callback function signatures to `(input: unknown) => Promise<unknown>`.
  They are re-exported and consumed elsewhere; widening them loses type safety for all callers and
  expands scope beyond this task.
- ❌ Don't try to import the MCPHandler-local `ToolExecutor` via a deep path
  (`.yalc/groundswell/dist/core/mcp-handler.js`) — it is not in the package `exports`, the barrel
  never re-exports it, and deep imports into yalc'd dist are brittle. The adapter binds structurally.
- ❌ Don't touch `tests/unit/tools/mcp-tool-parity.test.ts` — its `ToolExecutor` import is for its
  own stub and is excluded from the build scope; it is provably independent of this change.
- ❌ Don't add new tests or fixtures — this is a type-level fix; the existing parity test is the
  behavioral regression guard and is sufficient.
- ❌ Don't bundle the `.prettierignore`/`artifacts`/`plan` exclusion into this task — that is the
  sibling task **P1.M2.T2.S2** (format:check half of Issue 4). This task owns ONLY the typecheck half.

---

## Confidence Score & Success Metric

**Confidence Score: 10/10** for one-pass implementation success.

Rationale: the root cause is fully diagnosed (two structurally different `ToolExecutor` aliases; the
public barrel exports the wrong one), the runtime contract is proven (mcp-handler.js invokes
`executor(input)` with one bare arg), all 9 call sites are enumerated with exact line numbers, the
exact before/after code is given, the contravariance reason the bare-function approach fails is
documented, the scope boundaries (what NOT to touch, including the provably-independent test file)
are explicit, and the validation commands have been run against the current tree to capture the
verified baseline (18 errors; 6 parity tests passing). The fix is mechanical and localized to 3
files with zero behavioral risk.

**Validation**: an AI agent unfamiliar with this codebase can implement this by following Tasks 1–7
verbatim and confirming the 8 checklist items in Final Validation → Technical Validation.
