# PRP — P1.M2.T3.S1: Delete `commit-message-agent.ts` + remove imports/factory wiring

---

## Goal

**Feature Goal**: Complete PRD §9.10.1's "Supersedes the in-process agent" step by
**deleting** `src/agents/commit-message-agent.ts` (the 385-line in-process
re-implementation of stagecoach — 4 style-mode system prompts, the gitmoji table,
the `createCommitMessageAgent` factory) now that P1.M2.T2.S1 has rewritten
`generateCommitMessage` to delegate to the real `stagecoach` binary. Verify that
**no production (`src/`) code** references the deleted module, and add the
contract's DOCS note to `generateCommitMessage`'s JSDoc. **No new code, no new
exports** — pure subtraction + one JSDoc augmentation.

**Deliverable**:
1. **DELETE** `src/agents/commit-message-agent.ts` (entire file).
2. **VERIFY** `src/utils/git-commit.ts` no longer imports `createCommitMessageAgent` /
   `buildCommitMessageSystemPrompt` / `getRecentCommitMessages` from the deleted
   module (P1.M2.T2.S1 already removed them — confirm by grep; remove a stray line
   ONLY if one lingers).
3. **GREP-CONFIRM** no other `src/` file references the deleted module.
4. **AUGMENT** the `generateCommitMessage` JSDoc (rewritten by T2.S1) with the
   contract's verbatim note: *"Supersedes the in-process agent — the previous
   `commit-message-agent.ts` and its style-learning machinery are removed in favor
   of stagecoach delegation (§9.10.1)."*

**Success Definition**:
- `src/agents/commit-message-agent.ts` does not exist.
- `grep -rn "commit-message-agent" src/` returns **ZERO** (production is clean).
- `grep -rn "createCommitMessageAgent\|buildCommitMessageSystemPrompt" src/utils/git-commit.ts` returns **ZERO** (T2.S1's cut confirmed).
- `createBaseConfig` in `agent-factory.ts` is **not orphaned** (still multi-used) → no lint fallout.
- `generateCommitMessage`'s JSDoc carries the "Supersedes the in-process agent … (§9.10.1)" note.
- `npm run lint && npm run format:check && npm run typecheck` are **GREEN** (these gates exclude/ignore the test files — see Validation).
- `npm run test:run` is **EXPECTED-RED on exactly 2 test files** (`commit-message-agent.test.ts`, `git-commit-generate.test.ts`) that import the deleted module — **owned by the immediately-following P1.M2.T3.S2** ("Rewire test mocks + delete commit-message-agent.test.ts"). S1 does NOT touch test files.
- **No** changes to `agent-factory.ts`, `stagecoach-resolver.ts`, `getRecentCommitMessages`'s definition in `git-mcp.ts`, `smartCommit`, `formatCommitMessage`, or any `docs/*.md`.

---

## User Persona (if applicable)

**Target User**: **Maintainer** of the commit pipeline. Not end-user-facing.

**Use Case**: After T2.S1 rewrote `generateCommitMessage` to call the real
`stagecoach` binary, the in-process `commit-message-agent.ts` is dead code (a
drift-prone re-implementation that incidentally caused incident 1 — the hardcoded
`Co-Authored-By: Claude` trailer). Deleting it removes the drift vector for good.

**Pain Points Addressed**: Eliminates the dead re-implementation; ensures the
single source of commit-message generation is the identity-transparent
`stagecoach` binary (PRD §9.10.1).

---

## Why

- **PRD §9.10.1 is explicit: "Supersedes the in-process agent."** *"The previous
  in-process 'stagecoach LLM commit-message agent' (`commit-message-agent.ts`)
  and its style-learning machinery are removed in favor of this delegation.
  stagecoach's own output discipline … replaces the in-process rules."* T2.S1
  stopped `git-commit.ts` from *consuming* the agent; T3.S1 removes the *provider*.
- **Removes the incident-1 drift vector.** The hardcoded `Co-Authored-By: Claude`
  trailer lived in this in-process re-implementation. Deleting the file makes a
  regression structurally impossible (no code path can re-acquire it).
- **No orphan, no fallout.** The module's only production importer (`git-commit.ts`)
  was already cut by T2.S1; `createBaseConfig` (which the deleted factory called)
  remains used by 5+ other personas → no lint error in `agent-factory.ts`.
- **Strict S1/S2 split.** S1 = production source (delete + verify + JSDoc). S2 =
  all test files (delete `commit-message-agent.test.ts` + rewire the mocks in
  `git-commit-generate.test.ts` / `protected-files.test.ts`). This PRP respects
  that boundary — S1 touches **no test file**.
- **Out of scope (hard boundary):** `commit-message-agent.test.ts` deletion (S2),
  test-mock rewiring (S2), the `getRecentCommitMessages` *definition* in
  `git-mcp.ts` (leave it), `agent-factory.ts` (untouched), the `generateCommitMessage`
  *body* / `smartCommit` / `formatCommitMessage` / `stagecoach-resolver.ts` (T2.S1 /
  unchanged), the commit-identity structural guard (P1.M3), the bash denylist / tool
  matrix (P1.M4), any `docs/*.md` (DOCS = Mode A — the JSDoc note is the only doc
  artifact), `PRD.md`, `tasks.json`.

---

## What

### User-visible behavior

None at runtime/CLI. Observable change: one source file (`src/agents/commit-message-agent.ts`)
is gone; `generateCommitMessage`'s JSDoc gains one `@remarks` line. No behavior
change anywhere (T2.S1 already routed generation to stagecoach).

### Technical requirements (exact contract)

**DELETE** `src/agents/commit-message-agent.ts`. It exports exactly two symbols
(grep-verified at lines 303 + 363): `buildCommitMessageSystemPrompt` and
`createCommitMessageAgent`. Both had a single production consumer (`git-commit.ts`),
already removed by T2.S1. Module-internal (4 style-mode prompt constants + gitmoji
table) die with the file.

**VERIFY** (grep — expect ZERO; the parallel T2.S1 already did the removal):
```bash
grep -rn "commit-message-agent" src/                                           # ZERO
grep -rn "createCommitMessageAgent\|buildCommitMessageSystemPrompt" src/utils/git-commit.ts   # ZERO
grep -rn "getRecentCommitMessages" src/utils/git-commit.ts                     # ZERO (T2.S1 cut it)
```
If — and only if — a stray import line lingers in `git-commit.ts` (T2.S1 contract
not fully honored), remove that one line. Do not otherwise edit `git-commit.ts`.

**AUGMENT** the `generateCommitMessage` JSDoc (T2.S1 rewrote it for §9.10.1) with
the verbatim DOCS note as a `@remarks` line (do not duplicate T2.S1's existing
remarks — augment):

```ts
// Inside generateCommitMessage's existing @remarks block, add (Mode A — §9.10.1):
/**
 * … (T2.S1's existing binary-delegation remarks) …
 *
 * Supersedes the in-process agent — the previous `commit-message-agent.ts` and
 * its style-learning machinery are removed in favor of stagecoach delegation
 * (§9.10.1). The in-process re-implementation (which drift-acquired a hardcoded
 * `Co-Authored-By: Claude` trailer — incident 1) is gone; stagecoach's own
 * output discipline (emit only the message; no prefix, no banner, no trailer)
 * replaces it.
 * … (T2.S1's remaining @param/@returns/@example) …
 */
```

### Success Criteria

- [ ] `src/agents/commit-message-agent.ts` deleted.
- [ ] `grep -rn "commit-message-agent" src/` → ZERO.
- [ ] `git-commit.ts` has no import of the deleted module / its symbols (grep ZERO).
- [ ] `createBaseConfig` still multi-used in `agent-factory.ts` (not orphaned).
- [ ] `generateCommitMessage` JSDoc carries the "Supersedes the in-process agent … (§9.10.1)" note.
- [ ] `npm run lint && npm run format:check && npm run typecheck` GREEN.
- [ ] No `src/` change other than the delete + the one JSDoc augmentation line. No test file touched.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed?_
**Yes** — the exact file to delete, the exact two exports that die, the precise
grep commands to verify production cleanliness, the proof that `createBaseConfig`
is NOT orphaned (5+ other consumers listed), the verbatim JSDoc note to add, the
CRITICAL fact that the parallel T2.S1 already cleaned `git-commit.ts` (so this is
verify-not-rewrite), and — most importantly — the precise GREEN/RED validation map
proving that `lint`/`format:check`/`typecheck` stay GREEN while ONLY `test:run`
goes red on exactly 2 S2-owned files (with the reason: `tsconfig.build.json`
excludes `tests`, eslint has no `import/no-unresolved`). The non-obvious S1/S2
boundary is enumerated file-by-file. See `research/delete-agent-facts.md`.

### Documentation & References

```yaml
# MUST READ — PRD section this implements
- docfile: PRD.md   # (provided in selected_prd_content §9.10.1)
  section: §9.10.1 "Commit-Message Generation (stagecoach delegation, message-only)" → "Supersedes the in-process agent"
  why: >
    "The previous in-process 'stagecoach LLM commit-message agent' (commit-message-agent.ts)
    and its style-learning machinery are removed in favor of this delegation." THE deletion mandate.
  critical: This is the "Supersedes" clause; the DOCS note S1 adds cites §9.10.1 verbatim.

# MUST READ — the parallel sibling CONTRACT (what git-commit.ts looks like when S1 implements)
- docfile: plan/015_459c7d9be558/P1M2T2S1/PRP.md
  section: "Technical requirements" (import churn: removes createCommitMessageAgent/
           buildCommitMessageSystemPrompt/createPrompt/z/getRecentCommitMessages/
           getPrpCommitStyleExamples; KEEPS getPrpCommitStyle; rewrites generateCommitMessage
           to the stagecoach binary; rewires git-commit.test.ts) + "Anti-Patterns"
           ("Don't delete commit-message-agent.ts … that's P1.M2.T3.S1/S1")
  why: >
    T2.S1 LANDS BEFORE S1. It already (a) removed git-commit.ts's imports of the agent,
    (b) removed getRecentCommitMessages from git-commit.ts, (c) rewired git-commit.test.ts
    to drop its agent mock/import. So S1's clauses (b)/(c)/(d) are VERIFY-not-rewrite.
    Treat T2.S1 as a CONTRACT — assume it landed exactly as specified.

# MUST READ — this subtask's research (the deletion map + the gate map)
- docfile: plan/015_459c7d9be558/P1M2T3S1/research/delete-agent-facts.md
  section: "1 (the 2 exports that die)", "2 (file-by-file deletion map: 1 prod + 4 tests)",
           "3 (T2.S1 already cleaned git-commit.ts → S1 = verify)", "4 (createBaseConfig not orphaned)",
           "5 (GREEN/RED gate map: typecheck excludes tests; eslint has no import/no-unresolved)",
           "6 (the verbatim DOCS note)", "7 (out of scope)"
  why: >
    The single most important non-obvious fact: after S1, `npm run typecheck`/`lint`/`format:check`
    are GREEN (tsconfig.build.json excludes tests; eslint has no missing-module rule); ONLY
    `npm run test:run` is RED on exactly 2 S2-owned test files. Plus the S1/S2 boundary.

# THE FILE TO DELETE
- file: src/agents/commit-message-agent.ts
  why: >
    DELETE entirely (385 lines). Exports: buildCommitMessageSystemPrompt (line 303),
    createCommitMessageAgent (line 363). Both single-consumer (git-commit.ts, already cut by T2.S1).
    Consumes createBaseConfig from agent-factory (NOT orphaned — see below). The 4 style-mode
    prompt constants + the gitmoji table are module-internal; they die with the file.

# THE FILE TO VERIFY (not edit, unless a stray line lingers)
- file: src/utils/git-commit.ts
  why: >
    T2.S1 already removed its imports of createCommitMessageAgent/buildCommitMessageSystemPrompt
    AND getRecentCommitMessages (one of the 6 unused). S1 GREP-VERIFIES zero references; removes a
    stray line ONLY if present. S1 ALSO augments generateCommitMessage's JSDoc here (the DOCS note).
  pattern: "grep -rn 'commit-message-agent\\|createCommitMessageAgent\\|buildCommitMessageSystemPrompt\\|getRecentCommitMessages' src/utils/git-commit.ts  # expect ZERO"
  gotcha: Do NOT touch the generateCommitMessage BODY, smartCommit, formatCommitMessage, or the
          stagecoach-resolver import (all T2.S1 / unchanged). ONLY the JSDoc @remarks is augmented.

# NOT-ORPHANED PROOF (read-only)
- file: src/agents/agent-factory.ts
  why: >
    createBaseConfig (line 308) is called by the architect/coder/researcher/qa/bug-finder personas
    (lines 370, 408, 447, 494, 548). Deleting commit-message-agent.ts (one consumer) does NOT orphan
    it → no @typescript-eslint/no-unused-vars error in agent-factory. UNCHANGED by S1.
  pattern: "const baseConfig = createBaseConfig('architect', …);  // ×5 personas"

# CONFIG FILES THAT DEFINE THE GATE (read-only — the GREEN/RED map)
- file: tsconfig.build.json
  why: >
    include: ["src/**/*"], exclude: [..., "tests"]. So `npm run typecheck` = `tsc --noEmit -p
    tsconfig.build.json` typechecks ONLY src/ → stays GREEN after the delete (no src/ file
    references the deleted module).
- file: .eslintrc.json
  why: >
    No `import/no-unresolved` rule; the test override turns off no-unused-vars for tests. So
    `npm run lint` does NOT flag the dangling test imports of the deleted module → stays GREEN.
- file: vitest.config.ts
  why: >
    include: ['tests/**/*.{test,spec}.ts'] → vitest collects the 2 breaker test files
    (commit-message-agent.test.ts, git-commit-generate.test.ts) → test:run RED. S2's domain.

# THE DOCS-CONTRACT SOURCE (Mode A — the JSDoc note)
- docfile: PRD.md   # §9.10.1 (provided)
  section: "Supersedes the in-process agent"
  why: The verbatim note S1 adds to generateCommitMessage's JSDoc: "Supersedes the in-process
        agent — the previous commit-message-agent.ts and its style-learning machinery are removed
        in favor of stagecoach delegation (§9.10.1)."

# SEQUENCED-SIBLING (comes AFTER S1 — owns the test files; do NOT implement)
- docfile: plan/015_459c7d9be558/P1M2T3S2/PRP.md   # (planned; not yet written at research time)
  why: >
    S2 = "Rewire test mocks + delete commit-message-agent.test.ts". S2 owns ALL test references:
    deletes commit-message-agent.test.ts, rewires git-commit-generate.test.ts (vi.mock +
    createCommitMessageAgent import → stagecoach binary mock), and removes the dead vi.mock in
    protected-files.test.ts. S1 leaves every test file untouched so S2 has a clean, non-conflicting
    surface. T3 (S1+S2) is validated as a unit for the full `npm run validate`.
```

### Current Codebase tree (relevant slice)

```bash
src/agents/commit-message-agent.ts        # ← DELETE (385 lines; 2 exports, both single-consumer)
src/agents/agent-factory.ts               # UNCHANGED (createBaseConfig NOT orphaned — 5+ consumers)
src/utils/git-commit.ts                   # VERIFY-clean (T2.S1 cut the imports) + AUGMENT generateCommitMessage JSDoc
src/utils/stagecoach-resolver.ts          # UNCHANGED (T2.S1/T1.S1)
src/tools/git-mcp.ts                      # UNCHANGED (getRecentCommitMessages definition stays; only git-commit.ts stopped importing it)
tests/unit/agents/commit-message-agent.test.ts      # S2 DELETES (S1 does NOT touch)
tests/integration/git-commit-generate.test.ts       # S2 REWIRES (S1 does NOT touch)
tests/unit/protected-files.test.ts                  # S2 removes dead vi.mock (S1 does NOT touch)
tests/unit/agents/cleanup-agent.test.ts             # stale comments only (optional S2/doc cleanup; S1 does NOT touch)
plan/015_459c7d9be558/P1M2T3S1/research/delete-agent-facts.md   # THIS ITEM'S RESEARCH NOTE
```

### Desired Codebase tree with files to be added

```bash
# NO new files. ONE deletion + ONE JSDoc augmentation:
src/agents/commit-message-agent.ts        # DELETED
src/utils/git-commit.ts                   # generateCommitMessage JSDoc gains the "Supersedes the in-process agent" @remarks line
# (No docs/*.md — DOCS = Mode A: the JSDoc note is the only doc artifact.)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — T2.S1 (parallel, lands FIRST) already cleaned git-commit.ts. S1's clauses (b)/(c)/(d)
//   are VERIFY (grep → 0), not rewrite. If git-commit.ts STILL shows an import of
//   createCommitMessageAgent/buildCommitMessageSystemPrompt/getRecentCommitMessages, that means
//   T2.S1's contract was not honored — remove that ONE stray line. Otherwise do NOT edit git-commit.ts
//   except for the JSDoc augmentation. (research §3.)

// CRITICAL — typecheck stays GREEN after the delete. tsconfig.build.json includes ONLY src/**
//   (excludes tests). `npm run typecheck` = `tsc --noEmit -p tsconfig.build.json` → typechecks src/
//   only. No src/ file references the deleted module → no TS2307. Do NOT expect typecheck to flag
//   the dangling test imports — it won't (tests aren't in the build program). (research §5.)

// CRITICAL — lint stays GREEN after the delete. .eslintrc.json has NO `import/no-unresolved` rule,
//   and the test override turns off @typescript-eslint/no-unused-vars for tests. The dangling test
//   imports of the deleted module are NOT flagged. S1 introduces NO unused import (it only deletes
//   + adds a JSDoc comment). (research §5.)

// CRITICAL — test:run is EXPECTED-RED on exactly 2 files after S1: tests/unit/agents/commit-message-agent.test.ts
//   (imports the deleted module) and tests/integration/git-commit-generate.test.ts (typed import +
//   vi.importActual of the deleted module). These are S2's domain. DO NOT "fix" them — S1 touching
//   test files would collide with S2. The full `npm run validate` is RED only at the final test:run
//   step; lint/format/typecheck (the first 3) pass. (research §2/§5.)

// CRITICAL — createBaseConfig is NOT orphaned. commit-message-agent.ts was ONE of 5+ consumers
//   (architect/coder/researcher/qa/bug-finder in agent-factory.ts). Deleting it leaves createBaseConfig
//   still multi-used → no no-unused-vars error in agent-factory. Do NOT touch agent-factory.ts.
//   (research §4.)

// CRITICAL — DO NOT touch any test file. S2 owns ALL of them: commit-message-agent.test.ts (delete),
//   git-commit-generate.test.ts (rewire), protected-files.test.ts (remove dead vi.mock). protected-files.test.ts
//   has only a vi.mock FACTORY (no typed import) → it does NOT break typecheck and its vi.mock becomes a
//   dead no-op at runtime (factory supplies the module); S2 cleans it. cleanup-agent.test.ts has only
//   COMMENT references → no break. S1 leaves all four untouched. (research §2.)

// GOTCHA — getRecentCommitMessages is DEFINED in src/tools/git-mcp.ts (and may be used there).
//   T2.S1 removed its IMPORT from git-commit.ts (one of the 6 unused). S1 only CONFIRMS git-commit.ts
//   no longer imports it; do NOT delete its definition in git-mcp.ts (out of scope; other code may use it).

// GOTCHA — the JSDoc augmentation is on generateCommitMessage, whose JSDoc T2.S1 rewrote. T2.S1 lands
//   FIRST (sequential), so S1 edits the JSDoc T2.S1 wrote — no merge conflict. AUGMENT the existing
//   @remarks (add the "Supersedes the in-process agent … (§9.10.1)" line); do not duplicate T2.S1's
//   binary-delegation remarks. Mode A (JSDoc only) — no docs/*.md.

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` (prettier --write) after the JSDoc edit in
//   case the added @remarks line reflows, then `npm run format:check`.

// GOTCHA — the work item says "remove imports/factory wiring" and "remove the getRecentCommitMessages
//   import … if it was only used by the auto-style resolution." This work is ALREADY DONE by T2.S1.
//   S1's job is to VERIFY (grep) and, only if needed, mop up a stray line — NOT to re-do T2.S1's work.
```

---

## Implementation Blueprint

### Data models and structure

None. This is a pure deletion + one JSDoc comment line. No types, no schemas, no
new symbols. The two exports that die (`buildCommitMessageSystemPrompt`,
`createCommitMessageAgent`) have no surviving production consumer (T2.S1 cut it).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY git-commit.ts is already clean (T2.S1 cut the imports)
  - RUN: grep -rn "commit-message-agent" src/utils/git-commit.ts            # expect ZERO
  - RUN: grep -rn "createCommitMessageAgent\|buildCommitMessageSystemPrompt" src/utils/git-commit.ts  # expect ZERO
  - RUN: grep -rn "getRecentCommitMessages" src/utils/git-commit.ts         # expect ZERO
  - IF any return a hit: remove that ONE stray import line (T2.S1 contract not honored). ELSE: leave git-commit.ts
    unchanged except for the Task-3 JSDoc augmentation.

Task 2: DELETE src/agents/commit-message-agent.ts
  - ACTION: delete the entire file (385 lines). Exports buildCommitMessageSystemPrompt (303) +
    createCommitMessageAgent (363) — both single-consumer (git-commit.ts, already cut by T2.S1).
  - VERIFY no orphan: grep -rn "createBaseConfig" src/agents/agent-factory.ts  # still 5+ uses (architect/coder/qa/…) → NOT orphaned
  - VERIFY production clean: grep -rn "commit-message-agent" src/             # ZERO

Task 3: AUGMENT the generateCommitMessage JSDoc (DOCS contract — Mode A)
  - EDIT src/utils/git-commit.ts: inside generateCommitMessage's existing @remarks block (T2.S1 rewrote it
    for §9.10.1), ADD the verbatim note:
        "Supersedes the in-process agent — the previous `commit-message-agent.ts` and its
         style-learning machinery are removed in favor of stagecoach delegation (§9.10.1). The
         in-process re-implementation (which drift-acquired a hardcoded `Co-Authored-By: Claude`
         trailer — incident 1) is gone; stagecoach's own output discipline (emit only the message;
         no prefix, no banner, no trailer) replaces it."
  - AUGMENT (do not duplicate T2.S1's remarks). Keep T2.S1's @param/@returns/@example intact.

Task 4: FORMAT + VERIFY (the GREEN gate)
  - RUN: npm run fix                                  # prettier --write (in case the @remarks line reflows)
  - RUN: npm run lint && npm run format:check && npm run typecheck   # ALL GREEN
  - RUN: grep -rn "commit-message-agent" src/         # ZERO (production clean)
  - RUN: git diff --name-only                         # expect ONLY: (deletion of) src/agents/commit-message-agent.ts + src/utils/git-commit.ts
  - EXPECTED: lint/format/typecheck GREEN; production grep ZERO.
  - DO NOT run `npm run test:run` or `npm run validate` as a PASS gate — test:run is EXPECTED-RED on the
    2 S2-owned test files (commit-message-agent.test.ts, git-commit-generate.test.ts). See Validation Loop.
  - OPTIONAL scoped confirmation (production-adjacent suite untouched by the delete):
    npx vitest run tests/unit/utils/git-commit.test.ts   # T2.S1 rewired it → green (not affected by the delete)
```

### Implementation Patterns & Key Details

```ts
// ---- Task 3: the JSDoc augmentation (Mode A) — augment T2.S1's existing @remarks ----
// Inside src/utils/git-commit.ts, generateCommitMessage's JSDoc (T2.S1 wrote the binary-delegation
// remarks). ADD this block to the @remarks (verbatim from the work item's DOCS clause + §9.10.1):
/**
 * … (T2.S1's existing remarks: stagecoach --dry-run --single, reads the index, provider/model/format
 *    forwarding, AgentError on failure …) …
 *
 * Supersedes the in-process agent — the previous `commit-message-agent.ts` and its style-learning
 * machinery are removed in favor of stagecoach delegation (§9.10.1). The in-process re-implementation
 * (which drift-acquired a hardcoded `Co-Authored-By: Claude` trailer — incident 1) is gone;
 * stagecoach's own output discipline (emit only the message; no prefix, no banner, no trailer)
 * replaces it.
 *
 * @param repoRoot - … (T2.S1's)
 * @param _diff - … (T2.S1's)
 * @returns … (T2.S1's)
 * @throws {AgentError} … (T2.S1's)
 * @example … (T2.S1's)
 */
```

```bash
# ---- Task 1/2: the verify-and-delete command sequence ----
grep -rn "commit-message-agent" src/utils/git-commit.ts && echo "STRAY — remove" || echo "clean (T2.S1 cut it)"
grep -rn "createCommitMessageAgent\|buildCommitMessageSystemPrompt" src/utils/git-commit.ts && echo "STRAY" || echo "clean"
rm src/agents/commit-message-agent.ts
grep -rn "commit-message-agent" src/ && echo "FAIL — production ref remains" || echo "production clean ✓"
grep -rn "createBaseConfig" src/agents/agent-factory.ts | head   # expect 5+ matches → not orphaned ✓
```

### Integration Points

```yaml
DELETION (src/agents/commit-message-agent.ts):
  - file removed entirely; exports buildCommitMessageSystemPrompt + createCommitMessageAgent gone.
  - NO production importer remains (git-commit.ts cut by T2.S1; verified by grep).

VERIFY (src/utils/git-commit.ts):
  - imports of the deleted module / its symbols: ZERO (T2.S1 cut them; S1 confirms).
  - generateCommitMessage JSDoc: + the "Supersedes the in-process agent … (§9.10.1)" @remarks line.
  - generateCommitMessage BODY / smartCommit / formatCommitMessage / stagecoach-resolver import: UNCHANGED.

NOT TOUCHED (hard boundary):
  - agent-factory.ts (createBaseConfig stays; not orphaned), stagecoach-resolver.ts (T1.S1/T2.S1),
    git-mcp.ts (getRecentCommitMessages definition stays), formatCommitMessage, smartCommit, restore_critical_files.
  - ALL test files (commit-message-agent.test.ts, git-commit-generate.test.ts, protected-files.test.ts,
    cleanup-agent.test.ts) — S2 owns them.
  - docs/*.md (DOCS = Mode A — the JSDoc note is the only doc artifact), PRD.md, tasks.json, package.json.
```

---

## Validation Loop

> **Read this before judging S1 "failed".** S1 is the production-source half of T3.
> After S1, `npm run lint`, `npm run format:check`, and `npm run typecheck` are all
> **GREEN**; ONLY `npm run test:run` is RED — on exactly **2 test files** that import
> the deleted module, both owned by the immediately-following **P1.M2.T3.S2**. S1's
> correct gate is the production-source triple below; the full `npm run validate`
> (which ends in `test:run`) is green only after S2 lands. T3 (S1+S2) is validated
> as a unit. **Do NOT "fix" the red test files — that collides with S2.**

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix            # prettier --write (run first — the added @remarks line may reflow)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — GREEN (build program = src/ only; tests excluded)
npm run lint           # eslint . --ext .ts — GREEN (no import/no-unresolved rule; no unused import introduced)
npm run format:check   # prettier --check — GREEN
# Expected: all GREEN. typecheck ignores tests (tsconfig.build.json excludes them), so the dangling
#   test imports of the deleted module are NOT seen. lint has no missing-module rule.
```

### Level 2: Production-Clean Verification (the S1 gate)

```bash
# Production must reference the deleted module ZERO times:
grep -rn "commit-message-agent" src/                                          # ZERO
grep -rn "createCommitMessageAgent\|buildCommitMessageSystemPrompt" src/      # ZERO
grep -rn "getRecentCommitMessages" src/utils/git-commit.ts                    # ZERO (T2.S1 cut it)
# createBaseConfig must NOT be orphaned (agent-factory still multi-uses it):
grep -rc "createBaseConfig" src/agents/agent-factory.ts                       # ≥5 (not orphaned)
# Only the 2 expected files changed:
git diff --name-only      # Expect: (deletion) src/agents/commit-message-agent.ts + src/utils/git-commit.ts
# Expected: production grep ZERO; createBaseConfig ≥5 uses; diff limited to the 2 files.
```

### Level 3: Test-Run — EXPECTED-RED on 2 S2-owned files (NOT S1's gate)

```bash
# OPTIONAL scoped check — confirm the delete did NOT regress the production-adjacent suite:
npx vitest run tests/unit/utils/git-commit.test.ts   # T2.S1 rewired it → GREEN (unaffected by the delete)

# DO NOT expect the FULL test:run to pass — it is EXPECTED-RED here, by design:
npm run test:run
#   → FAILS on:
#     • tests/unit/agents/commit-message-agent.test.ts      (imports the deleted module) → S2 DELETES
#     • tests/integration/git-commit-generate.test.ts       (typed import + vi.importActual) → S2 REWIRES
#   These are P1.M2.T3.S2's explicit domain. S1 MUST NOT edit them. The full `npm run validate`
#   (which chains test:run last) is GREEN only after S2 lands.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No runtime/CLI behavior change (T2.S1 already routed generation to stagecoach). Domain checks
# (record in commit message):
#   1. commit-message-agent.ts is gone; grep src/ → 0 references (the in-process re-implementation
#      that caused incident 1's hardcoded Co-Authored-By: Claude trailer is structurally eliminated).
#   2. createBaseConfig is NOT orphaned (5+ other personas use it) → agent-factory lint-clean.
#   3. generateCommitMessage's JSDoc now cites §9.10.1's "Supersedes the in-process agent" clause.
#   4. S1 touched NO test file — the red test:run is entirely S2's (T3.S1+S2 atomic for full validate).
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npm run lint` GREEN; `npm run format:check` GREEN; `npm run typecheck` GREEN.
- [ ] `grep -rn "commit-message-agent" src/` → ZERO (production clean).
- [ ] `git-commit.ts` has no import of the deleted module / its symbols (grep ZERO).
- [ ] `createBaseConfig` still multi-used in `agent-factory.ts` (≥5; not orphaned).
- [ ] `git diff --name-only` = `src/agents/commit-message-agent.ts` (deleted) + `src/utils/git-commit.ts` (JSDoc only).

### Feature Validation

- [ ] `src/agents/commit-message-agent.ts` deleted.
- [ ] `generateCommitMessage` JSDoc carries the "Supersedes the in-process agent … (§9.10.1)" note.
- [ ] No production behavior change (T2.S1 already routed generation to stagecoach).
- [ ] `npm run test:run` red ONLY on the 2 S2-owned files (expected); the production-adjacent
      `tests/unit/utils/git-commit.test.ts` is GREEN (unaffected).

### Code Quality Validation

- [ ] Pure subtraction + one JSDoc line — no new code, no new exports.
- [ ] No test file touched (S1/S2 boundary respected).
- [ ] No `docs/*.md` edited (Mode A — the JSDoc note is the only doc artifact).
- [ ] `agent-factory.ts` / `stagecoach-resolver.ts` / `git-mcp.ts` / `formatCommitMessage` / `smartCommit` UNCHANGED.

### Documentation & Deployment

- [ ] Mode-A JSDoc note present on `generateCommitMessage` (verbatim "Supersedes the in-process agent … §9.10.1").
- [ ] Commit message notes: deleted the in-process commit-message-agent.ts (§9.10.1 "Supersedes");
      T2.S1 had already cut git-commit.ts's imports (S1 = verify); createBaseConfig not orphaned;
      the 2 red test files are S2's domain (T3.S1+S2 atomic for full `npm run validate`).

---

## Anti-Patterns to Avoid

- ❌ Don't edit any test file (`commit-message-agent.test.ts`, `git-commit-generate.test.ts`,
      `protected-files.test.ts`, `cleanup-agent.test.ts`) — S2 owns ALL of them. S1 touching tests
      collides with S2 and inverts the stated plan. (research §2/§7.)
- ❌ Don't re-do T2.S1's work. The imports of `createCommitMessageAgent` /
      `buildCommitMessageSystemPrompt` / `getRecentCommitMessages` in `git-commit.ts` were ALREADY
      removed by T2.S1 (it lands first). S1's clauses (b)/(c)/(d) are GREP-VERIFY (expect 0); mop up
      a stray line ONLY if one lingers. (research §3.)
- ❌ Don't panic at a red `npm run test:run` / `npm run validate`. After S1, ONLY `test:run` is red,
      and only on the 2 S2-owned files. `lint`/`format:check`/`typecheck` are GREEN (tsconfig.build.json
      excludes tests; eslint has no import/no-unresolved). S1's gate is the production-source triple.
      Do NOT "fix" the red tests. (research §5.)
- ❌ Don't delete or edit `getRecentCommitMessages`'s DEFINITION in `src/tools/git-mcp.ts`. T2.S1
      removed its IMPORT from `git-commit.ts` (one of the 6 unused). Other code may still use the
      definition — leave it. S1 only confirms `git-commit.ts` no longer imports it.
- ❌ Don't touch `agent-factory.ts`. `createBaseConfig` is NOT orphaned (5+ personas use it); deleting
      one consumer (the commit-message factory) leaves it multi-used → no lint error.
- ❌ Don't duplicate T2.S1's `generateCommitMessage` JSDoc remarks. AUGMENT the existing `@remarks`
      with the "Supersedes the in-process agent … (§9.10.1)" line; keep T2.S1's @param/@returns/@example.
- ❌ Don't edit any `docs/*.md` — DOCS = Mode A (the JSDoc note is the only doc artifact).
- ❌ Don't expect `npm run typecheck` to catch the dangling test imports — it won't (build program is
      `src/` only). Don't add the test files to the build program to "force" detection — out of scope.
- ❌ Don't delete `commit-message-agent.test.ts` "while you're at it" — that's S2's explicit deliverable
      and would create a merge collision.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a pure subtraction (delete one file) + one JSDoc line, with the
heavy lifting (cutting `git-commit.ts`'s imports + rewriting `generateCommitMessage` +
rewiring `git-commit.test.ts`) already done by the parallel T2.S1 which lands first.
The deletion map is grep-verified: exactly one production importer (`git-commit.ts`,
already cleaned) and four test files (all S2's). `createBaseConfig` is proven
non-orphaned (5+ consumers). The genuinely non-obvious risk — that the implementing
agent sees a red `npm run test:run` / `npm run validate` and mistakenly concludes
S1 broke the tree — is pre-empted by the precise GREEN/RED gate map (proven from
`tsconfig.build.json` excluding tests + eslint lacking `import/no-unresolved`):
`lint`/`format:check`/`typecheck` are GREEN; only `test:run` is red, on exactly the
2 S2-owned files. The S1/S2 boundary is enumerated file-by-file so the implementer
does not touch tests. The verbatim DOCS note is supplied. Residual risks: (a) a
stray import line in `git-commit.ts` if T2.S1's contract was imperfectly honored
(caught by the Task-1 grep, trivially removed); (b) a prettier reflow of the added
`@remarks` line (auto-fixed by `npm run fix`). No new logic, no new types, no
runtime change — the deletion cannot introduce a behavioral regression.