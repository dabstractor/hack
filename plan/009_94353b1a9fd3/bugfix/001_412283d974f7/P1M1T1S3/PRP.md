# PRP — P1.M1.T1.S3: Simplify config handler — remove redundant `resolveRepositoryRoot` inline call

> Bugfix 001, **BUG-001** cleanup. S1 (LANDED) added `bootstrapRepoRoot()`; S2 (CONTRACT, parallel)
> registered a `preAction` hook so repo-root resolution + chdir run before ANY action handler. S3 is
> the small follow-up: the `config` subcommand's `.action()` handler (cli/index.ts:599-621) STILL
> calls `resolveRepositoryRoot` inline — redundant after the hook. S3 swaps it for `getRepoRoot()`
> (the hook-bootstrapped singleton) and removes the now-stale comment. **No behavior change; source-
> only refactor of `src/cli/index.ts`; no new tests; no docs.**

---

## Goal

**Feature Goal**: In `src/cli/index.ts`, replace the config `.action()` handler's redundant inline
`resolveRepositoryRoot(process.cwd(), …)` call with a `getRepoRoot()` singleton read (the preAction
hook from S2 already bootstrapped repo-root resolution + chdir before the handler runs). Remove the
stale comment that justified the inline call. Drop `resolveRepositoryRoot` from the file's import
(it becomes unused) and import `getRepoRoot` instead.

**Deliverable**:
1. **`src/cli/index.ts`** — 3 edits (all in this one file): (a) swap the repo-root import
   (`resolveRepositoryRoot` → `getRepoRoot`); (b) in the config handler, delete the stale comment +
   the `explicit`/`resolveRepositoryRoot` extraction and replace with `const repoRoot = getRepoRoot();`;
   (c) leave the catch block unchanged.

**Success Definition**:
- The config handler reads the hook-bootstrapped singleton via `getRepoRoot()` — no redundant
  `resolveRepositoryRoot` call, no `process.cwd()` / `program.opts().repoRoot` re-reading (the hook
  already consumed `--repo-root`).
- `resolveRepositoryRoot` is no longer imported or used in `src/cli/index.ts` (grep-confirmed: it was
  used only at the config handler's L608 + the comment).
- The stale comment ("Subcommand dispatch runs BEFORE the bootstrap chdir … getRepoRoot() THROWS …
  Resolve repoRoot ourselves") is gone, replaced by a concise comment noting the hook did the work.
- `npm run typecheck && npm run lint && npm run format:check` clean (lint MUST pass — the import
  removal eliminates the would-be unused `resolveRepositoryRoot`).
- No behavior change: the existing cli + config tests stay green (the hook bootstraps the same root
  the inline call would have computed).

---

## Why

- **Removes dead/redundant code.** After S2's `preAction` hook, repo-root resolution + chdir happen
  once, before any action handler. The config handler's inline `resolveRepositoryRoot(process.cwd(),
  …)` is a redundant second resolution. It was harmless (`resolveRepositoryRoot` doesn't chdir; S1's
  `_bootstrapped` guard prevents a second chdir, and the result is the same root), but it's misleading
  — its `process.cwd()` is the hook-chdir'd repo root (not INVOCATION_CWD), and the comment justifying
  it describes a precondition that no longer holds.
- **Single source of truth.** With the hook as the one bootstrap point, every action handler —
  including `config` — should read the singleton via `getRepoRoot()`. Keeping one handler on the old
  inline path is an inconsistency that invites confusion (e.g., a future reader wondering why `config`
  re-resolves when the hook already did).
- **Cleans up a stale comment.** The comment block (cli/index.ts:601-606) explains why the handler
  resolves the repo root itself ("getRepoRoot() THROWS — singleton unset"). That rationale is
  obsolete post-hook. Leaving it documents a non-existent constraint.
- **Scope discipline.** S3 touches ONLY `src/cli/index.ts`. It does NOT modify `src/utils/repo-root.ts`
  (S1), `src/index.ts` (S2's main swap), the hook itself (S2), the other subcommand `.action()` bodies,
  or `ConfigCommand`. No new tests (internal refactor, no behavior change — the item's DOCS: none).

---

## What

### User-visible behavior
None (internal refactor). `hack config init|show|validate|path` behaves exactly as before — the hook
bootstraps the same repo root the inline call computed, so `ConfigCommand(repoRoot)` receives the
identical value.

### Technical requirements (exact contract)

**File — `src/cli/index.ts`** (the ONLY file edited; 3 edits):

**(1) Import (L44)** — swap the repo-root symbol:
```ts
// BEFORE:
import { resolveRepositoryRoot } from '../utils/repo-root.js';
// AFTER:
import { getRepoRoot } from '../utils/repo-root.js';
```
(Verified: `resolveRepositoryRoot` is used in this file ONLY at the config handler's L608 + the L602
comment. After edit (2) removes both, it's unused → MUST be dropped from the import, else
`@typescript-eslint/no-unused-vars` fails.)

**(2) Config handler (L599-621)** — delete the stale comment + the `explicit`/`resolveRepositoryRoot`
extraction; replace with the singleton read. Concretely, replace this block:
```ts
        // Subcommand dispatch runs BEFORE the bootstrap chdir (src/index.ts main():
        // parseCLIArgs → subcommand early-return → [later] resolveRepositoryRoot +
        // chdir), so process.cwd() here === INVOCATION_CWD and getRepoRoot() THROWS
        // (singleton unset). Resolve repoRoot ourselves (default upward traversal).
        // Commander passes declared positional args in order, then the parsed
        // options object: (action, file, options).
        const explicit = (program.opts() as { repoRoot?: string }).repoRoot;
        const { repoRoot } = resolveRepositoryRoot(
          process.cwd(),
          explicit ? { explicit } : undefined
        );
```
with:
```ts
        // The preAction hook already resolved the repo root + chdir'd (PRD §9.8.3);
        // read the hook-bootstrapped singleton.
        const repoRoot = getRepoRoot();
```
(The `await new ConfigCommand(repoRoot).execute(action, options, typeof file === 'string' ? file : undefined);`
line immediately below is UNCHANGED. The `(action, file, options)` signature is self-evident from the
`.action(async (action, file, options) => …)` declaration — the positional-args note in the removed
comment doesn't need to be preserved.)

**(3) Catch block (L617-621)** — UNCHANGED:
```ts
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger().error(`Config command failed: ${errorMessage}`);
        process.exit(1);
      }
```
(After S2's hook, a `NotARepositoryError` no longer reaches this catch — it's thrown in the hook
before the try block and propagates to `main().catch()`'s dedicated clean arm. This catch now only
handles `ConfigCommand.execute` errors (config validation / file I/O), which still render via
`logger().error`. Per the item's note (d), it stays as-is.)

### Success Criteria
- [ ] Config handler reads `const repoRoot = getRepoRoot();` (no `resolveRepositoryRoot`, no `explicit`,
      no `process.cwd()` / `program.opts().repoRoot` re-read).
- [ ] `resolveRepositoryRoot` removed from `src/cli/index.ts`'s import; `getRepoRoot` imported instead.
- [ ] Stale comment gone; replaced by the concise hook-did-the-work comment.
- [ ] Catch block unchanged.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] Existing cli + config tests green (no behavior change).

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — the exact current code (with line numbers), the exact before/after for
all 3 edits, the verified fact that `resolveRepositoryRoot` is used only at the config handler (so the
import swap is safe), the rationale for why `getRepoRoot()` can't throw here (the hook ran first), the
nil test impact (verified per file), and the executable validation commands.

### Documentation & References

```yaml
# MUST READ — Step 4 (the verbatim before/after this PRP implements)
- docfile: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/architecture/bug_001_fix_strategy.md
  section: "Step 4: Simplify the `config` handler (`src/cli/index.ts:599-621`)"
  why: Gives the identical before/after code for the inline-call → getRepoRoot() swap. Confirms it's
        a pure simplification (the hook makes the inline call redundant).

# MUST READ — the S2 CONTRACT (the preAction hook that makes S3 possible)
- file: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/P1M1T1S2/PRP.md
  why: S2 registers `program.hook('preAction', …)` before `program.parse()` and swaps main()'s
        resolve+chdir for `getRepoRoot()`. S2 explicitly notes it KEEPS `resolveRepositoryRoot` in the
        cli import (config handler still uses it) and DEFERS the config simplification to S3. S3 is
        that deferred simplification. If S2 is NOT yet landed, S3's `getRepoRoot()` in the handler
        would throw (singleton unset before the hook) — the orchestrator sequences S2 before S3.

# MUST READ — S3 design + verified facts (authored with this PRP)
- docfile: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/P1M1T1S3/research/config-handler-simplify-design.md
  section: "1. The exact diff" and "2. Why getRepoRoot() can't throw here" and "3. Test impact = nil"
  why: grep-confirmed resolveRepositoryRoot is used only at L608 (safe import removal); the hook-ran-
        first rationale; the per-file test-impact analysis (config.test.ts → ConfigCommand direct;
        acceptance → subprocess; index.test.ts → S2 mock already provides getRepoRoot).

# PATTERN FILE — the ONLY file edited (current state verified in-repo)
- file: src/cli/index.ts
  why: L44 (the import to swap), L586-625 (the `.command('config')` … `.action()` handler — the stale
        comment L601-606, the inline resolve L607-611, the ConfigCommand call L612, the catch L617-621).
  pattern: "import { resolveRepositoryRoot } from '../utils/repo-root.js';  →  import { getRepoRoot } from '../utils/repo-root.js';"
  gotcha: Do NOT remove `resolveRepositoryRoot` from src/utils/repo-root.ts (S1 owns it; it's still
        exported and used by index.ts's main swap path + integration tests' own assertions). S3 only
        stops IMPORTING it in cli/index.ts.

# READ-ONLY — the singleton S3 reads (consume, don't modify)
- file: src/utils/repo-root.ts
  why: getRepoRoot() (L148) — reads the process-global singleton; throws a clear message if unset
        (won't happen — the hook set it before the handler runs). resolveRepositoryRoot (L128) — STILL
        EXPORTED (S3 doesn't touch this file; integration tests import it for their own assertions).
  critical: getRepoRoot() throws if the singleton is unset. That's ONLY possible if S2's hook didn't
        run — which means S2 isn't landed yet. Flag sequencing, don't add a fallback bootstrap.

# READ-ONLY — the hook that bootstraps the singleton (S2's edit; S3 consumes its effect)
- file: src/cli/index.ts   # the program.hook('preAction', …) block S2 adds before program.parse
  why: Confirms the singleton is set before ANY action handler (root default + subcommands) runs.

# TEST FILES — verify they stay green; do NOT edit (verified unaffected)
- file: tests/unit/cli/commands/config.test.ts
  why: Tests ConfigCommand DIRECTLY (`new ConfigCommand(repoRoot)` with a real tmpdir) — does NOT go
        through the cli/index.ts handler. Unaffected by S3.
- file: tests/integration/config/hack-config-acceptance.test.ts
  why: Subprocess-based (Layer B: spawnSync the real CLI in a git tmpdir). The real hook bootstraps →
        getRepoRoot() works → ConfigCommand gets the right root. Layer A imports resolveRepositoryRoot
        for ITS OWN assertions — still exported. Unaffected.
- file: tests/unit/cli/index.test.ts
  why: S2 added a vi.mock('../../../src/utils/repo-root.js', () => ({ resolveRepositoryRoot, bootstrapRepoRoot,
        getRepoRoot: vi.fn(() => '/mock-repo') })). After S3, cli/index.ts imports getRepoRoot (mocked).
        Verify no test in this file ASSERTS resolveRepositoryRoot was called by the config handler (the
        grep showed only the mock, no call-assertion — confirm at implementation time).

# VERIFIED API SURFACE
- getRepoRoot(): string — reads the singleton set by bootstrapRepoRoot (throws if unset).
- resolveRepositoryRoot(startDir, opts?: { explicit?: string }): { repoRoot: string; … } — STILL EXPORTED
      (S3 only stops using it in cli/index.ts).
```

### Current Codebase tree (relevant slice)

```bash
src/cli/index.ts                 # EDIT — swap import (L44) + simplify config handler (L599-621)
src/utils/repo-root.ts           # READ-ONLY (S1 — getRepoRoot/resolveRepositoryRoot/bootstrapRepoRoot unchanged)
src/index.ts                     # READ-ONLY (S2's main() swap — not touched by S3)
src/cli/commands/config.ts       # READ-ONLY (ConfigCommand — config.test.ts exercises it directly)
tests/unit/cli/commands/config.test.ts        # UNCHANGED (tests ConfigCommand directly)
tests/integration/config/hack-config-acceptance.test.ts  # UNCHANGED (subprocess; real hook bootstraps)
tests/unit/cli/index.test.ts                  # UNCHANGED (S2's repo-root mock already provides getRepoRoot)
```

### Desired Codebase tree with files to be edited

```bash
src/cli/index.ts                 # MODIFIED (import swap + handler simplification — the ONLY edit)
# No other files. No new tests. No docs (internal refactor — matches the item's "DOCS: none").
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — S3 touches ONLY src/cli/index.ts. Do NOT modify src/utils/repo-root.ts (S1),
//   src/index.ts (S2's main swap), the preAction hook (S2), other .action() bodies, or ConfigCommand.

// CRITICAL — resolveRepositoryRoot is used in cli/index.ts ONLY at the config handler (L608 + the L602
//   comment) — grep-confirmed. After removing both, it's UNUSED → MUST be dropped from the import
//   (L44) or @typescript-eslint/no-unused-vars FAILS. Swap the import to { getRepoRoot }.

// CRITICAL — getRepoRoot() THROWS if the singleton is unset. That can ONLY happen if S2's preAction
//   hook didn't run (i.e., S2 isn't landed). The orchestrator sequences S2 before S3. Do NOT add a
//   fallback bootstrapRepoRoot()/try-catch in the handler to "defend" against it — that masks a real
//   sequencing bug. If getRepoRoot() throws at runtime, flag the S2 sequencing.

// CRITICAL — do NOT remove resolveRepositoryRoot from src/utils/repo-root.ts. It's still EXPORTED and
//   used elsewhere (src/index.ts via S2's swap reads getRepoRoot, but integration tests import
//   resolveRepositoryRoot for their own assertions). S3 only stops IMPORTING it in cli/index.ts.

// GOTCHA — the catch block (L617-621) STAYS. After S2, NotARepositoryError no longer reaches it (the
//   hook throws before the try block → propagates to main().catch()'s clean arm). The catch now only
//   handles ConfigCommand.execute errors. Per the item's note (d), leave it unchanged.

// GOTCHA — the removed comment's last line ("Commander passes declared positional args in order, then
//   the parsed options object: (action, file, options)") is self-evident from the .action(async
//   (action, file, options) => …) signature — it does NOT need to be preserved.

// GOTCHA — no behavior change: the hook bootstraps the SAME repo root the inline resolveRepositoryRoot
//   computed (it reads the same --repo-root + does the same upward traversal). So ConfigCommand
//   receives the identical repoRoot. The refactor is observably a no-op.

// GOTCHA — prettier is ERROR-enforced (prettier/prettier: error). Run `npm run fix` before format:check.

// GOTCHA — 100% coverage is enforced suite-wide, but S3 REMOVES code (the inline call + comment), so
//   it cannot reduce coverage. No new branches are added. No coverage concern for S3.

// GOTCHA — do NOT run the full `npm run test:run` as the gate (orthogonal pre-existing failures per
//   the architecture docs). S3's gate: typecheck + lint + format + the cli/config test files.
```

---

## Implementation Blueprint

### Data models and structure
None — S3 is a 3-edit source refactor (import swap + comment/call replacement). No types/constants/classes.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/cli/index.ts — swap the import (L44)
  - CHANGE `import { resolveRepositoryRoot } from '../utils/repo-root.js';` →
        `import { getRepoRoot } from '../utils/repo-root.js';`
  - This is safe ONLY after Task 2 removes the L608 usage. (Do Task 2 in the same edit pass so the
        file is never left with an unused import mid-flight — but if doing them separately, do Task 2
        first, then Task 1.)
  - DO NOT remove resolveRepositoryRoot from src/utils/repo-root.ts.

Task 2: EDIT src/cli/index.ts — simplify the config handler (L599-621)
  - DELETE the stale comment block (L601-606: "Subcommand dispatch runs BEFORE the bootstrap chdir …
        getRepoRoot() THROWS … Resolve repoRoot ourselves" + the positional-args note).
  - DELETE the `explicit` extraction + the `resolveRepositoryRoot` call (L607-611).
  - REPLACE with the 2-line comment + `const repoRoot = getRepoRoot();` (per "Technical requirements" (2)).
  - KEEP: the `await new ConfigCommand(repoRoot).execute(action, options, typeof file === 'string' ?
        file : undefined);` line (L612) and the catch block (L617-621) UNCHANGED.
  - DO NOT touch the `.command('config')` declaration, the options, or any other handler.

Task 3: FORMAT + VERIFY
  - RUN: npm run fix (lint:fix + prettier --write) → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/cli/commands/config.test.ts   # ConfigCommand direct — must stay green.
  - RUN: npx vitest run tests/unit/cli/index.test.ts             # S2's repo-root mock provides getRepoRoot.
  - (OPTIONAL) npx vitest run tests/integration/config/hack-config-acceptance.test.ts  # subprocess; real hook.
  - EXPECTED: all clean. If lint flags unused resolveRepositoryRoot, confirm Task 1 swapped the import.
        If typecheck flags getRepoRoot not exported, confirm src/utils/repo-root.ts:148 (S1 LANDED).
        If a cli test asserts resolveRepositoryRoot was called by the handler, that assertion is now
        stale — but the grep showed none; verify at implementation time and update if present.
```

### Implementation Patterns & Key Details

```ts
// ---- src/cli/index.ts: the import swap (L44) ----
import { getRepoRoot } from '../utils/repo-root.js';   // was: { resolveRepositoryRoot }

// ---- src/cli/index.ts: the config handler after S3 (L599-621) ----
    .action(async (action, file, options) => {
      try {
        // The preAction hook already resolved the repo root + chdir'd (PRD §9.8.3);
        // read the hook-bootstrapped singleton.
        const repoRoot = getRepoRoot();
        await new ConfigCommand(repoRoot).execute(
          action,
          options,
          typeof file === 'string' ? file : undefined
        );
        process.exit(0);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger().error(`Config command failed: ${errorMessage}`);
        process.exit(1);
      }
    });
```

### Integration Points

```yaml
DEPENDS ON (must be LANDED before S3 is correct):
  - P1.M1.T1.S1 (bootstrapRepoRoot helper): LANDED — getRepoRoot reads the singleton it sets.
  - P1.M1.T1.S2 (preAction hook + main swap): CONTRACT (parallel) — the hook sets the singleton before
        the config handler runs. Without S2, getRepoRoot() in the handler THROWS (singleton unset).
        The orchestrator sequences S2 before S3; if getRepoRoot() throws at runtime, flag S2 sequencing.

NO PRODUCTION/DOCS CHANGE beyond src/cli/index.ts. repo-root.ts (S1), index.ts (S2), the hook (S2),
  ConfigCommand, and other handlers are UNCHANGED. No new tests (internal refactor, no behavior change).
NO OTHER INTEGRATION: the refactor is observably a no-op (the hook bootstraps the same root). Downstream
  (ConfigCommand.execute) receives the identical repoRoot.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint                 # eslint . --ext .ts — clean (the resolveRepositoryRoot import is GONE → no unused-var)
npm run format:check         # prettier --check — clean
# Expected: all clean. If lint flags unused `resolveRepositoryRoot`, confirm Task 1 swapped the import to
#   { getRepoRoot }. If lint flags `getRepoRoot` unused, confirm Task 2 actually uses it (it does).
```

### Level 2: Unit Tests (no behavior change → existing tests must stay green)

```bash
npx vitest run tests/unit/cli/commands/config.test.ts   # ConfigCommand direct — unaffected by S3
npx vitest run tests/unit/cli/index.test.ts             # S2's repo-root mock provides getRepoRoot → green
# Expected: both green. config.test.ts doesn't touch the handler (ConfigCommand direct), so it's a pure
#   regression signal for ConfigCommand. index.test.ts exercises the handler via parseCLIArgs with the
#   mocked getRepoRoot → '/mock-repo'. If a test in index.test.ts asserted resolveRepositoryRoot was
#   CALLED by the handler, it now fails — update it (grep showed none; verify at implementation time).
# Do NOT run the full `npm run test:run` — orthogonal pre-existing failures (per the architecture docs).
```

### Level 3: Integration Testing (subprocess — the real hook bootstraps)

```bash
# OPTIONAL — the acceptance test drives `hack config` via the real CLI in a git tmpdir. After S3 the
# real preAction hook bootstraps → getRepoRoot() returns the right root → ConfigCommand works. This is
# the end-to-end proof that the refactor is a no-op:
npx vitest run tests/integration/config/hack-config-acceptance.test.ts
# Expected: green (Layer B subprocess + Layer A's own resolveRepositoryRoot assertions — still exported).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No MCP/DB/HTTP surface. Domain checks (record in commit message):
#   - The config handler reads getRepoRoot() (the hook-bootstrapped singleton) — no redundant resolve.
#   - resolveRepositoryRoot no longer imported in cli/index.ts (grep: 0 usages after the edit).
#   - getRepoRoot() can't throw here (the hook ran first); if it did, that's an S2 sequencing bug.
#   - No behavior change (the hook bootstraps the same root the inline call computed).
#   - The catch block is unchanged (now only handles ConfigCommand.execute errors).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean (resolveRepositoryRoot removed from cli/index.ts import; getRepoRoot used).
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/cli/commands/config.test.ts` green.
- [ ] `npx vitest run tests/unit/cli/index.test.ts` green.

### Feature Validation
- [ ] Config handler: `const repoRoot = getRepoRoot();` (no `resolveRepositoryRoot`, no `explicit`,
      no `process.cwd()`/`program.opts().repoRoot` re-read).
- [ ] `resolveRepositoryRoot` removed from `src/cli/index.ts`'s import; `getRepoRoot` imported.
- [ ] Stale comment gone; concise hook-did-the-work comment in its place.
- [ ] Catch block unchanged.

### Code Quality Validation
- [ ] ONLY `src/cli/index.ts` is edited.
- [ ] `src/utils/repo-root.ts` (S1), `src/index.ts` (S2), the hook (S2), ConfigCommand, other handlers UNCHANGED.
- [ ] `resolveRepositoryRoot` still EXPORTED from repo-root.ts (S3 only stops importing it in cli/index.ts).
- [ ] No fallback bootstrap/try-catch added around `getRepoRoot()` (would mask an S2 sequencing bug).
- [ ] No behavior change (refactor is observably a no-op).

### Documentation & Deployment
- [ ] No docs change (internal refactor — matches the item's "DOCS: none").
- [ ] Commit message notes: redundant inline resolveRepositoryRoot removed (the S2 hook bootstraps);
      getRepoRoot() singleton read; stale comment removed; no behavior change; S2 = the enabling dependency.

---

## Anti-Patterns to Avoid

- ❌ Don't add a fallback `bootstrapRepoRoot()` / try-catch around `getRepoRoot()` in the handler — the
      hook ran first (S2), so the singleton is set. A fallback masks a real S2 sequencing bug.
- ❌ Don't leave `resolveRepositoryRoot` in the cli/index.ts import after removing its only usage —
      `no-unused-vars` fails. Swap the import to `{ getRepoRoot }`.
- ❌ Don't remove `resolveRepositoryRoot` from `src/utils/repo-root.ts` — it's still exported and used by
      integration tests' own assertions + S2's path. S3 only stops IMPORTING it in cli/index.ts.
- ❌ Don't touch the catch block — after S2, `NotARepositoryError` no longer reaches it (the hook throws
      first); it now only handles `ConfigCommand.execute` errors. Per the item's note (d), leave it.
- ❌ Don't modify `src/utils/repo-root.ts` (S1), `src/index.ts` (S2), the hook (S2), ConfigCommand, or
      other handlers — S3 is the config handler simplification ONLY.
- ❌ Don't add new tests — this is an internal refactor with no behavior change (the item's DOCS: none;
      OUTPUT is the refactor). Existing tests stay green.
- ❌ Don't run the full `npm run test:run` as the gate — orthogonal pre-existing failures. Use the cli +
      config test files.
- ❌ Don't preserve the removed comment's positional-args note ("Commander passes declared positional
      args in order…") — it's self-evident from the `.action(async (action, file, options) => …)` signature.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a 3-edit source-only refactor of a single file, with the exact current code and
before/after verified in-repo (line numbers confirmed). The key safety facts are grep-verified:
`resolveRepositoryRoot` is used in `cli/index.ts` only at the config handler (so the import swap is
clean — no other usage orphans it), and `getRepoRoot()` is exported from `repo-root.ts:148` (S1
LANDED). The test impact is verified nil per file (config.test.ts → ConfigCommand direct; acceptance →
subprocess with the real hook; index.test.ts → S2's mock already provides getRepoRoot). The one
sequencing caveat (getRepoRoot() throws if S2's hook didn't run) is explicitly flagged with a "flag,
don't defend" rule. Residual risks: (a) an undiscovered test in index.test.ts asserting the handler
called resolveRepositoryRoot (grep showed none; verify at implementation time — trivial to update);
(b) a prettier nit (auto-fixed). No external/runtime unknowns.