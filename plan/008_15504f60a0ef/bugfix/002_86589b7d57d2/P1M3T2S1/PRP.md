# PRP — P1.M3.T2.S1: Wire `smartCommit` `position` option + update `[PRP Auto]` tests

> Bugfix 002, **BUG-003 (MAJOR) — S3 (smartCommit wiring + call sites + [PRP Auto] test cleanup)**. PRD §5.1
> mandates the standardized `<phase>.<milestone>.<task>.<subtask>:` task-prefix and FORBIDS the legacy
> `[PRP Auto]` banner. **S1 (P1.M3.T1.S1, COMPLETE)** shipped `getPrpCommitFormat()`/`PrpCommitFormat` in
> `src/config/constants.ts` (verified lines 723/736/760). **S2 (P1.M3.T1.S2, COMPLETE)** shipped the pure
> `ItemPosition` / `parseItemPosition` / `buildTaskPrefix` exports + the reworked
> `formatCommitMessage(message, position?: ItemPosition | null)` in `src/utils/git-commit.ts` (drops
> `[PRP Auto]`, branches task-prefix/plain on `getPrpCommitFormat()`, PRESERVES the `Co-Authored-By` trailer).
> The 3 internal `smartCommit → formatCommitMessage` wrap sites still call it with ONE arg (position
> omitted → plain) — i.e. **the task-prefix never lights up in a real commit yet**. **This item (S3)** is the
> wiring slice that closes that gap: it extends `SmartCommitOptions` with `position?: ItemPosition | null`,
> threads `options.position` into ALL THREE wrap sites, passes `position: parseItemPosition(subtask.id)` from
> the two subtask call sites in `task-orchestrator.ts`, OMITS position at the two non-backlog sites
> (`task-orchestrator.ts:1113`, `bug-hunt-workflow.ts:503`), and updates the `[PRP Auto]` test assertions.
> **S4 (P1.M3.T1.S3, parallel)** relaxes the stagecoach agent prompt — disjoint file. The architecture
> contract (`architecture/bug-003-commit-format.md` §"Call sites" table + §"S3") prescribes the exact
> outcome; this PRP fuses that spec with the codebase's **verbatim current call-site code** (line numbers
> verified post-S2), the **`readonly` SmartCommitOptions field convention**, the **`parseItemPosition`
> graceful-`null` contract**, and the **vitest integration-test mock pattern**.

---

## Goal

**Feature Goal**: Wire the S2 `position` parameter through `smartCommit` and its callers so that committed
subtasks carry the PRD §5.1 `<phase>.<milestone>.<task>.<subtask>:` task-prefix (task-prefix mode, the
default), while non-backlog commits degrade to plain (no prefix), and NO commit carries `[PRP Auto]`. This
makes the task-prefix format — already implemented and unit-tested by S2 at the `formatCommitMessage` level —
actually appear in real pipeline commits.

**Deliverable**:
1. **`src/utils/git-commit.ts`** — EXTEND `SmartCommitOptions` with `readonly position?: ItemPosition | null;`
   (the `ItemPosition` type is already exported from this same module — NO new import). Thread
   `options.position` into all THREE `formatCommitMessage` wrap sites inside `smartCommit` (current lines
   **626** happy, **637-639** fallback, **643** default). Fix the stale step-6 JSDoc comment in `smartCommit`'s
   doc block ("Create commit with `[PRP Auto]` prefix and `Co-Authored-By` trailer" → "Create commit via
   `formatCommitMessage` (task-prefix or plain per PRD §5.1) + `Co-Authored-By` trailer").
2. **`src/core/task-orchestrator.ts`** — EXTEND the import at line 43 (`import { smartCommit } from '../utils/git-commit.js';`)
   to also import `parseItemPosition`. At the TWO subtask call sites (**:801** skip-recovery, **:1061**
   survival): add `position: parseItemPosition(subtask.id)` to the existing `{ generateMessage: true }`
   options object. At **:1113** (post-cleanup): OMIT position (non-backlog → plain; do NOT pass an options
   position field).
3. **`src/workflows/bug-hunt-workflow.ts`** — NO source change (the **:503** call site already omits options
   entirely → plain). Confirmed by inspection; this file needs NO edit. (Listed here to make the
   "non-backlog sites omit position" contract explicit and verified.)
4. **`tests/unit/utils/git-commit.test.ts`** — ADD smartCommit-level tests verifying `options.position`
   FLOWS THROUGH to `gitCommit`'s message: (a) default-path + position → task-prefix commit message;
   (b) generateMessage-path + position → task-prefix commit message (LLM subject wrapped under prefix);
   (c) position `null`/omitted → plain (regression: existing behavior preserved). The S2-rewritten
   `parseItemPosition`/`buildTaskPrefix`/`formatCommitMessage` blocks + the existing position-omitting
   smartCommit tests stay GREEN unchanged.
5. **`tests/integration/smart-commit.test.ts`** — UPDATE the format-related assertions: (a) line 11 file
   comment (drop the stale `[PRP Auto] …` format description); (b) lines 45-47 `formatCommitMessage` mock
   (drop the stale `[PRP Auto]` prepend → plain subject + trailer); (c) lines 328-346 `should format commit
   message with subtask ID and title` (assert the 3rd options arg carries
   `{ generateMessage: true, position: parseItemPosition('P3.M4.T1.S3') }`); (d) lines 348-360
   `should add [PRP Auto] prefix to commit message` → REWRITE to assert task-prefix/plain + no `[PRP Auto]`.
   **COORDINATION NOTE:** this file is pre-existing RED on BUG-004 category-(a) harness-init (P1.M4.T2.S2's
   scope); S3 owns the FORMAT assertions only — do NOT fix harness-init here.

**Success Definition**:
- `SmartCommitOptions` has a `readonly position?: ItemPosition | null` field.
- All three `smartCommit` wrap sites pass `options.position` as the 2nd arg to `formatCommitMessage`.
- `task-orchestrator.ts:801` and `:1061` pass `position: parseItemPosition(subtask.id)`; `:1113` and
  `bug-hunt-workflow.ts:503` omit position (→ plain, no prefix).
- A committed subtask (task-prefix mode, env unset) reads
  `<phase>.<milestone>.<task>.<subtask>: <llm-or-fallback-subject>\n\nCo-Authored-By: Claude <noreply@anthropic.com>`.
- A non-backlog commit reads `<subject>\n\nCo-Authored-By: Claude <noreply@anthropic.com>` (plain, no prefix).
- NO committed message contains `[PRP Auto]` (verified across all paths).
- `npm run typecheck && npm run lint && npm run format:check` clean.
- `npx vitest run tests/unit/utils/git-commit.test.ts` GREEN (existing + new wiring tests).
- `tests/unit/agents/commit-message-agent.test.ts` still GREEN (no regression — S3 does not touch it).
- The `tests/integration/smart-commit.test.ts` format assertions are logically correct (file remains RED on
  harness-init until P1.M4.T2.S2 — out of S3 scope; verified by typecheck, not full run).

---

## User Persona (if applicable)

**Target User**: Maintainer / pipeline operator reading the git history + the coder pipeline
(`task-orchestrator`, `bug-hunt-workflow`) that calls `smartCommit`. End users are unaffected (internal
commit-message wiring).

**Use Case**: Each committed subtask carries a machine-parseable `<n.n.n.n>:` position prefix (default)
over the LLM/fallback subject; operators may opt into a clean hand-curated history via
`PRP_COMMIT_FORMAT=plain`. Non-backlog commits (post-cleanup, bug-hunt marker) stay plain.

**Pain Points Addressed**: The task-prefix (implemented by S2) never reaches real commits because
`smartCommit` doesn't thread `position`; the git log shows plain `[PRP Auto]`-free subjects but NO machine
position — defeating the §5.1 goal of a parseable, position-encoded history.

---

## Why

- **BUG-003 S3: the prefix is built but never wired.** S2 shipped `formatCommitMessage(message, position?)`
  + the pure helpers, but `smartCommit` still calls `formatCommitMessage(...)` with ONE arg at all three wrap
  sites (`:626/:637-639/:643`). Without a position, `formatCommitMessage` emits PLAIN (position absent →
  plain per §5.1). So the `<n.n.n.n>:` task-prefix — the entire point of the BUG-003 fix — never appears in a
  real pipeline commit. This slice threads `position` from the subtask call sites through `smartCommit` into
  `formatCommitMessage`, closing the loop.
- **S1+S2 are the input; S3 is the consumer.** S1 gave the config toggle; S2 gave the formatter + parser +
  builder. S3 consumes them: `SmartCommitOptions.position` carries an `ItemPosition`; the call sites compute
  it via `parseItemPosition(subtask.id)`. No new pure logic — pure wiring.
- **Graceful `null` makes the wiring trivially safe.** `parseItemPosition` returns `null` on a malformed id.
  `formatCommitMessage` treats `null`/`undefined` as plain. So `position: parseItemPosition(subtask.id)`
  (which type-checks as `ItemPosition | null`) is safe even if a future id shape mismatches — it degrades to
  plain rather than throwing. No try/catch needed at the call sites.
- **Non-backlog sites stay plain by design.** PRD §5.1: "When task-prefix selected but commit is not a
  backlog item → degrade to plain." The post-cleanup commit (`:1113`, message `'cleanup: doc reorganization'`)
  and the bug-hunt marker (`:503`, message `'chore(qa): bug hunt clean…'`) are NOT backlog items → they omit
  `position` → plain subject. Wiring position into them would produce bogus prefixes like
  `1.2.1.1: cleanup: doc reorganization` over a commit that is NOT item `1.2.1.1`.
- **Bugfix sessions need no special-casing.** Per the contract, bugfix sessions have their OWN P/M/T/S ids;
  `parseItemPosition(subtask.id)` yields the current session's indices. (This item's own id,
  `P1.M3.T2.S1`, is a bugfix-session id — it parses cleanly to `{1,3,2,1}`.) Confirmed in a test.
- **Scope discipline.** This slice touches 3 source files (`git-commit.ts`, `task-orchestrator.ts`,
  [`bug-hunt-workflow.ts` is read-only]) + 2 test files (`git-commit.test.ts`, `smart-commit.test.ts`). It
  does NOT touch the S2 pure functions, S1 config, S4's agent prompt, `constants.ts`, or `CONFIGURATION.md`.

---

## What

### User-visible behavior
After S3, real pipeline commits change shape:
- **Subtask commits** (survival + skip-recovery, `task-orchestrator.ts:801/:1061`): subject becomes
  `<n.n.n.n>: <LLM-or-fallback subject>` (task-prefix mode, default) — e.g. `1.2.1.1: add createDeferredPromise
  utility` — instead of the bare LLM subject. The `Co-Authored-By` trailer is preserved.
- **Non-backlog commits** (`:1113` post-cleanup, `:503` bug-hunt marker): UNCHANGED — plain subject + trailer
  (no prefix), as before S3.
- **No commit carries `[PRP Auto]`** (already true after S2; S3 does not reintroduce it).

### Technical requirements (exact contract — from architecture/bug-003-commit-format.md §"Call sites" + §"S3")

**(a) `src/utils/git-commit.ts` — extend `SmartCommitOptions` + thread `position` into the 3 wrap sites.**

Extend the interface (current lines 247-257) — add the `position` field alongside `generateMessage`, matching
the `readonly` convention:

```ts
export interface SmartCommitOptions {
  /** When `true`, delegate commit-message generation to the stagecoach LLM
   * agent, which reads the staged diff. Default (omitted / `false`): use the
   * caller-provided `message` verbatim (backward compatible). */
  readonly generateMessage?: boolean;

  /**
   * Optional backlog-item position (PRD §5.1 "Commit Message Format"). When
   * supplied AND {@link getPrpCommitFormat} returns `'task-prefix'` (the
   * DEFAULT), the standardized `<phase>.<milestone>.<task>[.<subtask>]:` prefix
   * is layered onto the commit subject. When `null`/`undefined` (non-backlog
   * commits), OR when the format is `'plain'`, the subject is emitted plain.
   * Pass {@link parseItemPosition} of the implementing item's id — a `null`
   * result (malformed id) degrades gracefully to plain (no throw).
   */
  readonly position?: ItemPosition | null;
}
```

Thread `options.position` into all THREE wrap sites inside `smartCommit` (the `ItemPosition` type is already
in scope — same module — NO import change):

```ts
// :626 — generateMessage HAPPY path:
formattedMessage = formatCommitMessage(generated, options.position);

// :637-639 — generateMessage FALLBACK path (multiline, keep the line break):
formattedMessage = formatCommitMessage(
  buildFallbackCommitMessage(genError),
  options.position
);

// :643 — DEFAULT path (option omitted / generateMessage !== true):
formattedMessage = formatCommitMessage(message, options.position);
```

Fix the stale step-6 JSDoc line in `smartCommit`'s `@remarks` block (the `6. Create commit with [PRP Auto]
prefix and Co-Authored-By trailer` line):
```
6. Create commit via formatCommitMessage (task-prefix or plain per PRD §5.1) + Co-Authored-By trailer
```

**(b) `src/core/task-orchestrator.ts` — extend import + pass `position` at the 2 subtask sites.**

Extend the import (line 43):
```ts
import { smartCommit, parseItemPosition } from '../utils/git-commit.js';
```

At the TWO subtask call sites, add `position: parseItemPosition(subtask.id)` to the existing options object:
```ts
// :801 (skip-recovery) — options becomes:
{ generateMessage: true, position: parseItemPosition(subtask.id) }

// :1061 (survival commit) — options becomes:
{ generateMessage: true, position: parseItemPosition(subtask.id) }
```

At **:1113** (post-cleanup, NON-backlog): leave the options as `{ generateMessage: true }` — OMIT `position`
(plain subject for a non-backlog commit). Do NOT add a `position: null` (omitting is cleaner; `undefined`
and `null` both → plain).

**(c) `src/workflows/bug-hunt-workflow.ts` — NO source change.**

The **:503** call site already calls `smartCommit(sessionPath, 'chore(qa): bug hunt clean…')` with NO options
(default path → `options.position` is `undefined` → plain). Confirmed; no edit. (Listed to make the
non-backlog contract explicit + verified.)

**(d) Tests.**

See "Implementation Tasks" Task 4/5/6 for the exact test edits. Summary:
- `tests/unit/utils/git-commit.test.ts`: ADD smartCommit-level position-flow tests (the wiring verification).
- `tests/integration/smart-commit.test.ts`: update the stale file comment, the `formatCommitMessage` mock,
  the commit-message-formatting test (3rd-arg assertion), and REWRITE the `[PRP Auto]` test.
- `tests/unit/agents/commit-message-agent.test.ts`: NO change (verify still passes).

### Success Criteria
- [ ] `SmartCommitOptions` has `readonly position?: ItemPosition | null`.
- [ ] All three `smartCommit` `formatCommitMessage` wrap sites pass `options.position` as the 2nd arg.
- [ ] `task-orchestrator.ts` imports `parseItemPosition` from `'../utils/git-commit.js'`.
- [ ] `task-orchestrator.ts:801` + `:1061` pass `position: parseItemPosition(subtask.id)`.
- [ ] `task-orchestrator.ts:1113` OMITS position; `bug-hunt-workflow.ts:503` omits options entirely.
- [ ] New unit test: default-path `smartCommit(...,{position})` → gitCommit message has the task-prefix.
- [ ] New unit test: generateMessage-path `smartCommit(...,{generateMessage:true,position})` → gitCommit
      message has the task-prefix over the LLM subject.
- [ ] New unit test: `position: null` (or omitted) → plain gitCommit message (regression preserved).
- [ ] New unit test: a bugfix-session id (e.g. `P1.M3.T2.S1`) parses + prefixes correctly (no special-casing).
- [ ] `tests/integration/smart-commit.test.ts`: no assertion expects `[PRP Auto]` in output; the formatting
      test asserts the 3rd options arg; the rewritten format test asserts task-prefix/plain + no `[PRP Auto]`.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] `tests/unit/utils/git-commit.test.ts` + `tests/unit/agents/commit-message-agent.test.ts` GREEN.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the exact
current call-site code + line numbers (verified post-S2), the verbatim `SmartCommitOptions` extension, the
exact 3 wrap-site edits, the `parseItemPosition` import + graceful-`null` contract, the non-backlog
omit-position rule with rationale, the per-test edit list (which assertions to add/rewrite/drop), the
BUG-004 harness-init coordination boundary, the npm scripts, and the hard scope boundary. See
`research/01-codebase-facts.md` for per-claim evidence.

### Documentation & References
```yaml
# MUST READ — the authoritative architecture spec (Call-sites table + S3 block prescribe the outcome)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-003-commit-format.md
  section: "Call sites (verified — only 2 files call smartCommit)" AND "S3 — wire smartCommit + call sites + update tests"
  why: Prescribes EXACTLY: extend SmartCommitOptions.position; thread into BOTH wrap sites; sites #1/#2 pass
       parseItemPosition(subtask.id); sites #3/#4 omit (plain); update the [PRP Auto] test assertions.
  critical: Sites #3 (task-orchestrator.ts:1113) + #4 (bug-hunt-workflow.ts:503) are NON-backlog → MUST omit
            position (plain). Wiring position into a non-backlog commit produces a bogus prefix.

# MUST READ — PRD §5.1 (the contract this realizes)
- file: PRD.md
  section: "5.1 Commit Message Format (Standardized Task-Prefix)"
  why: "Format: <phase>.<milestone>.<task>.<subtask>: <message>." "Elide trailing unused levels." "When
       task-prefix selected but commit is not a backlog item → degrade to plain." "[PRP Auto] banner and
       Conventional-Commit scope MUST NOT be prepended."
  critical: default task-prefix; non-backlog → plain; the subtask-id is the SOLE position carrier.

# THE FILE TO EDIT (source) — extend SmartCommitOptions + thread position into the 3 wrap sites
- file: src/utils/git-commit.ts
  why: EDIT — extend SmartCommitOptions (247-257) with `readonly position?: ItemPosition | null`; thread
       options.position into the 3 wrap sites (626 happy, 637-639 fallback, 643 default); fix the stale
       step-6 JSDoc line. NO import change (ItemPosition is in-scope, same module).
  pattern_field: "match the existing `readonly generateMessage?: boolean;` field style (readonly + JSDoc)."
  critical: ItemPosition is EXPORTED from this same module (S2) — do NOT re-import it. `position` is OPTIONAL
            + `| null` so existing 2-arg callers (S2 unit tests that omit it) compile unchanged AND a caller
            can pass parseItemPosition(id) directly (which may return null → graceful plain).

# THE FILE TO EDIT (source) — extend import + pass position at the 2 subtask call sites
- file: src/core/task-orchestrator.ts
  why: EDIT — extend import (43) to add parseItemPosition; add `position: parseItemPosition(subtask.id)` to
       the options at :801 (skip-recovery) + :1061 (survival); OMIT position at :1113 (post-cleanup).
  pattern_import: "`import { smartCommit } from '../utils/git-commit.js';` — ADD parseItemPosition to the
                   SAME named-import list (single import statement)."
  pattern_options: "the existing `{ generateMessage: true }` object literal — ADD the position key inside it."
  critical: subtask.id is ALWAYS 4-level (SubtaskSchema regex src/core/models.ts:~353) → parseItemPosition
            returns a 4-level position. parseItemPosition CAN return null (malformed) → that's fine (plain).
            Do NOT wrap in try/catch — parseItemPosition is pure + never throws.

# READ-ONLY (NO change) — the non-backlog call site already omits options
- file: src/workflows/bug-hunt-workflow.ts
  why: CONFIRMED — :503 calls smartCommit(sessionPath, 'chore(qa): bug hunt clean…') with NO 3rd arg →
       options.position is undefined → plain. NO edit needed (do not add a position: null).
  critical: Adding options here would be wrong — this is a non-backlog commit (bug-hunt marker), must stay plain.

# THE INPUT CONTRACT (S1+S2 — COMPLETE; symbols S3 consumes)
- file: src/config/constants.ts            # S1 (COMPLETE): getPrpCommitFormat()/PrpCommitFormat (723/736/760)
- file: src/utils/git-commit.ts            # S2 (COMPLETE): ItemPosition/parseItemPosition/buildTaskPrefix/formatCommitMessage(message,position?)
  why: READ-ONLY. S3 CONSUMES these. formatCommitMessage already accepts position as its OPTIONAL 2nd param
       (S2 made it optional precisely so the 3 single-arg wrap sites compile unchanged until S3). parseItemPosition
       returns ItemPosition | null; formatCommitMessage treats null/undefined → plain (graceful).
  critical: Do NOT modify these symbols. S3 only threads the existing position param through SmartCommitOptions.

# THE TEST FILE TO EDIT — ADD smartCommit-level position-flow tests
- file: tests/unit/utils/git-commit.test.ts
  why: EDIT — ADD ~3-4 tests verifying options.position flows through smartCommit → formatCommitMessage →
       gitCommit (default-path + generateMessage-path → task-prefix; null/omitted → plain regression; bugfix-id
       parse+prefix). The S2-rewritten formatCommitMessage/parseItemPosition/buildTaskPrefix blocks + the
       existing position-omitting smartCommit tests STAY GREEN unchanged.
  pattern_test: "copy the existing `smartCommit generateMessage option` happy-path test (line ~1032) structure:
                 mock gitStatus/gitAdd/gitDiff/mockCreateCommitMessageAgent/gitCommit; call smartCommit with the
                 position option; assert mockGitCommit was called with the prefixed message string."
  critical: The env-stub harness (`beforeEach(delete PRP_COMMIT_FORMAT) + afterEach(vi.unstubAllEnvs)`) from S2
            applies here too — task-prefix is the DEFAULT so env-UNSET must yield the prefix; add a plain-opt-out
            case via vi.stubEnv. A leftover stub would flip a task-prefix assertion to plain.

# THE TEST FILE TO EDIT — update the stale format assertions (COORDINATE with P1.M4.T2.S2 harness-init)
- file: tests/integration/smart-commit.test.ts
  why: EDIT (format assertions only) — line 11 file comment; lines 45-47 formatCommitMessage mock; lines 328-346
       formatting test (3rd-arg assertion); lines 348-360 the '[PRP Auto] prefix' test → REWRITE.
  pattern_mock: "`vi.mock('../../src/utils/git-commit.js', () => ({ … formatCommitMessage: vi.fn((msg) => …) }))`
                 — update the mock impl to drop '[PRP Auto]' (plain subject + trailer)."
  pattern_assert: "`expect(mockSmartCommit).toHaveBeenCalledWith(sessionPath, expectedMessage, expect.objectContaining({…}))`
                   — the orchestrator now passes a 3rd arg; assert it via objectContaining."
  critical: This file is PRE-EXISTING-RED on BUG-004 category-(a) harness-init (P1.M4.T2.S2's scope: "PiHarness
            not initialized. Call initialize() first."). S3 owns the FORMAT assertions ONLY — do NOT fix the
            harness-init setup. The file stays RED until P1.M4.T2.S2; S3's gate = typecheck + logical correctness.

# READ-ONLY — verify no regression (S4 owns the prompt; S3 must not break it)
- file: tests/unit/agents/commit-message-agent.test.ts
  why: READ-ONLY. S4 (parallel) owns this file. S3 must NOT touch it. Run it GREEN to confirm the agent still
       forbids emitting [PRP Auto]/Co-Authored-By (unchanged after S3). The `toContain('[PRP Auto]')` +
       `toContain('Co-Authored-By')` assertions stay valid (the hard rule still mentions those tokens).

# OUT OF SCOPE (hard boundary — DO NOT TOUCH in S3)
- file: src/agents/commit-message-agent.ts                      # S4 (P1.M3.T1.S3) — stagecoach prompt relaxation
- file: tests/unit/agents/commit-message-agent.test.ts          # S4 — verify only, do not edit
- file: src/config/constants.ts                                  # S1 (COMPLETE)
- file: src/utils/git-commit.ts formatCommitMessage/parseItemPosition/buildTaskPrefix/ItemPosition DEFINITIONS  # S2 (COMPLETE) — consume only
- file: docs/CONFIGURATION.md                                    # S1 (COMPLETE)
- the BUG-004 harness-init fix in tests/integration/smart-commit.test.ts  # P1.M4.T2.S2
```

### Current Codebase tree (relevant slice)
```bash
src/config/constants.ts                       # READ-ONLY (S1 DONE): getPrpCommitFormat/PrpCommitFormat (723/736/760)
src/utils/git-commit.ts                       # EDIT: +SmartCommitOptions.position; thread options.position into 3 wrap sites (626/637-639/643); fix step-6 JSDoc
src/core/task-orchestrator.ts                 # EDIT: +parseItemPosition import (43); +position at :801/:1061; OMIT at :1113
src/workflows/bug-hunt-workflow.ts            # READ-ONLY: :503 already omits options (non-backlog → plain)
src/core/models.ts                            # READ-ONLY: SubtaskSchema id regex (~353) — subtask.id is always 4-level
tests/unit/utils/git-commit.test.ts           # EDIT: +smartCommit position-flow tests (existing tests unchanged)
tests/integration/smart-commit.test.ts        # EDIT (format assertions only; file pre-existing-red on harness-init — P1.M4.T2.S2)
tests/unit/agents/commit-message-agent.test.ts # READ-ONLY: verify no regression
```

### Desired Codebase tree with files to be added/edited
```bash
src/utils/git-commit.ts                       # MODIFIED (SmartCommitOptions + 3 wrap-site args + 1 JSDoc line)
src/core/task-orchestrator.ts                 # MODIFIED (import + 2 call-site option additions; :1113 untouched)
tests/unit/utils/git-commit.test.ts           # MODIFIED (new smartCommit position-flow tests; existing unchanged)
tests/integration/smart-commit.test.ts        # MODIFIED (format assertions: comment + mock + formatting test + [PRP Auto] rewrite)
# (no new files; no new deps)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — `position` MUST be `ItemPosition | null` (not just `ItemPosition`). parseItemPosition returns
//   `null` on a malformed id; the call sites pass `position: parseItemPosition(subtask.id)` which type-checks
//   as `ItemPosition | null`. formatCommitMessage already accepts `ItemPosition | null` (S2) and treats
//   null/undefined → plain. So the field type MUST be `ItemPosition | null` to match the call-site value.
//   A bare `ItemPosition` field type would force a non-null assertion at the call sites.

// CRITICAL — OMIT position at the non-backlog sites, do NOT pass `position: null`. task-orchestrator.ts:1113
//   (post-cleanup) + bug-hunt-workflow.ts:503 (bug-hunt marker) are NOT backlog items → they must degrade to
//   plain. Omitting the field (undefined) and passing null BOTH yield plain in formatCommitMessage, but
//   omitting is cleaner + signals intent ("no item"). Wiring position into a non-backlog commit would emit a
//   bogus `<n.n.n.n>:` prefix over a commit that is NOT that item — a correctness bug.

// CRITICAL — ItemPosition is in-scope in src/utils/git-commit.ts (exported by S2 in the SAME module). Do NOT
//   add an import for it. Only src/core/task-orchestrator.ts needs a new import (`parseItemPosition`); even
//   there, the ItemPosition TYPE is not referenced directly (it's inferred via parseItemPosition's return +
//   the SmartCommitOptions.position field) — import parseItemPosition only.

// CRITICAL — parseItemPosition is PURE + never throws. Do NOT wrap `parseItemPosition(subtask.id)` in
//   try/catch. A malformed id → null → graceful plain (the intended degradation). Wrapping it would mask
//   nothing + add noise.

// GOTCHA — bugfix sessions have their OWN P/M/T/S numbering. parseItemPosition(subtask.id) yields the CURRENT
//   session's indices (e.g. P1.M3.T2.S1 → {1,3,2,1}). No special-casing, no remapping. Confirm in a test.

// GOTCHA — the smartCommit unit tests share a file-wide beforeEach (vi.clearAllMocks + cwd spies). The new
//   position-flow tests that stub PRP_COMMIT_FORMAT=plain MUST add a nested afterEach(vi.unstubAllEnvs) (copy
//   from S2's formatCommitMessage describe block) to avoid env-bleed into the next test. Task-prefix cases
//   rely on env-UNSET (the default) — a leftover plain stub would flip them to plain.

// GOTCHA — bugfix BUG-004: the FULL `npm run test:run` is PRE-EXISTING-RED (178 failures — P1.M4 scope). Do
//   NOT use it as the gate. Gate = typecheck + lint + format:check + tests/unit/utils/git-commit.test.ts +
//   tests/unit/agents/commit-message-agent.test.ts. tests/integration/smart-commit.test.ts is RED on
//   harness-init (P1.M4.T2.S2) — S3 updates its format assertions but cannot make it GREEN.

// GOTCHA — prettier is ERROR-enforced (format:check). The new test blocks + the rewritten mock may reflow;
//   run `npm run fix` (lint:fix + prettier --write) BEFORE format:check. Let the formatter own alignment.

// CRITICAL — DO NOT modify formatCommitMessage / parseItemPosition / buildTaskPrefix / ItemPosition (S2
//   COMPLETE), constants.ts (S1 COMPLETE), commit-message-agent.ts + its test (S4 parallel), or the
//   harness-init setup in smart-commit.test.ts (P1.M4.T2.S2). S3 ships ONLY: SmartCommitOptions.position +
//   the 3 wrap-site args + the task-orchestrator import/call-sites + the 2 test files' format coverage.
```

---

## Implementation Blueprint

### Data models and structure
No new data models. S3 reuses S2's `ItemPosition` (exported from `src/utils/git-commit.ts`) and adds ONE
optional field to `SmartCommitOptions` (`readonly position?: ItemPosition | null`). No ORM/pydantic (TS).

### Implementation Tasks (ordered to keep the gate GREEN at each checkpoint)
```yaml
Task 1: EDIT src/utils/git-commit.ts — extend SmartCommitOptions + thread position (the wiring)
  - STEP 1a — ADD `readonly position?: ItemPosition | null;` to SmartCommitOptions (lines 247-257) + its JSDoc
    (per "Technical requirements (a)"). ItemPosition is in-scope (same module) — NO import change.
  - STEP 1b — THREAD options.position into the 3 wrap sites:
      :626 (happy):  formatCommitMessage(generated, options.position);
      :637-639 (fallback, multiline):  formatCommitMessage(buildFallbackCommitMessage(genError), options.position);
      :643 (default):  formatCommitMessage(message, options.position);
  - STEP 1c — FIX the stale step-6 JSDoc line in smartCommit's @remarks ("Create commit with [PRP Auto] prefix…"
    → "Create commit via formatCommitMessage (task-prefix or plain per PRD §5.1) + Co-Authored-By trailer").
  - AFTER Task 1: no behavior change yet (no caller passes position) → existing tests stay GREEN.
  - VERIFY: `npm run typecheck` clean (the optional position field + the in-scope ItemPosition type).

Task 2: EDIT src/core/task-orchestrator.ts — import + 2 call-site position additions
  - STEP 2a — EXTEND import (line 43): `import { smartCommit, parseItemPosition } from '../utils/git-commit.js';`
  - STEP 2b — :801 (skip-recovery): options `{ generateMessage: true }` → `{ generateMessage: true, position: parseItemPosition(subtask.id) }`.
  - STEP 2c — :1061 (survival): options `{ generateMessage: true }` → `{ generateMessage: true, position: parseItemPosition(subtask.id) }`.
  - STEP 2d — :1113 (post-cleanup): LEAVE options `{ generateMessage: true }` UNCHANGED (OMIT position — non-backlog).
  - AFTER Task 2: real subtask commits now carry the task-prefix (env default = task-prefix). No unit test asserts
    task-orchestrator's commit format at the e2e level (that's smart-commit.test.ts, RED on harness-init).
  - VERIFY: `npm run typecheck` clean (parseItemPosition import + the options literal type-checks against SmartCommitOptions).

Task 3: CONFIRM src/workflows/bug-hunt-workflow.ts — NO edit
  - READ :503: `smartCommit(sessionPath, 'chore(qa): bug hunt clean…')` — NO 3rd arg → plain. CORRECT. No edit.

Task 4: EDIT tests/unit/utils/git-commit.test.ts — ADD smartCommit position-flow tests
  - ADD (inside `describe('smartCommit')` or `describe('smartCommit generateMessage option')`) a nested env-stub
    harness: `afterEach(() => { vi.unstubAllEnvs(); });` (+ a `beforeEach(() => { delete process.env.PRP_COMMIT_FORMAT; })`
    if a plain-opt-out case is added). Cases (env UNSET = task-prefix DEFAULT):
    • DEFAULT path + position → task-prefix: smartCommit('/project','msg',{position:parseItemPosition('P1.M2.T1.S1')})
      → mockGitCommit message === '1.2.1.1: msg\n\nCo-Authored-By: Claude <noreply@anthropic.com>'.
    • generateMessage path + position → task-prefix over LLM subject: smartCommit('/project','fallback',
      {generateMessage:true,position:parseItemPosition('P1.M2.T1.S1')}) with a fake agent returning 'feat(api): add endpoint'
      → mockGitCommit message === '1.2.1.1: feat(api): add endpoint\n\nCo-Authored-By: Claude <noreply@anthropic.com>'.
    • position null → plain (regression): smartCommit('/project','msg',{position:null})
      → mockGitCommit message === 'msg\n\nCo-Authored-By: …' (no prefix, no [PRP Auto]).
    • FALLBACK path + position → task-prefix over the placeholder: smartCommit('/project','fallback',
      {generateMessage:true,position:parseItemPosition('P1.M2.T1.S1')}) with the agent ALWAYS throwing
      → mockGitCommit message STARTS WITH '1.2.1.1: chore: commit-gen failed' (+ trailer). (Optional but high-value:
      proves the fallback wrap site also threads position.)
    • BUGFIX-ID coverage: assert parseItemPosition('P1.M3.T2.S1') deep-equals {phase:1,milestone:3,task:2,subtask:1}
      and buildTaskPrefix → '1.3.2.1' (confirms bugfix-session numbering needs no special-casing). (This may already
      be covered by S2's parseItemPosition block for a 4-level id — ADD only if P1.M3.T2.S1 specifically isn't.)
    • Across all cases: expect(message).not.toContain('[PRP Auto]').
  - DO NOT modify the existing position-omitting smartCommit tests (they assert plain → still valid).
  - VERIFY: `npx vitest run tests/unit/utils/git-commit.test.ts` GREEN (existing + new wiring tests).

Task 5: EDIT tests/integration/smart-commit.test.ts — update format assertions (COORDINATE harness-init = P1.M4.T2.S2)
  - STEP 5a — line 11 file comment: `Commit message format: [PRP Auto] {subtask.id}: {subtask.title}` → reword to
    describe the §5.1 task-prefix/plain format (e.g. "Commit subject: task-prefix `<n.n.n.n>:` over the message
    (subtasks, default) or plain (non-backlog) + Co-Authored-By trailer (PRD §5.1). No [PRP Auto].").
  - STEP 5b — lines 45-47 formatCommitMessage mock: drop `[PRP Auto]` →
    `(msg: string) => \`${msg}\n\nCo-Authored-By: Claude <noreply@anthropic.com>\`` (plain subject + trailer).
  - STEP 5c — lines 328-346 formatting test: the orchestrator now passes a 3rd options arg. UPDATE the
    `expect(mockSmartCommit).toHaveBeenCalledWith(...)` to assert the 3rd arg via
    `expect.objectContaining({ generateMessage: true, position: parseItemPosition('P3.M4.T1.S3') })`.
    (Add parseItemPosition to the test's import from '../../src/utils/git-commit.js'.) The 2-arg form FAILS
    post-S2 (the orchestrator already passed {generateMessage:true} pre-S3); post-S3 it also carries position.
  - STEP 5d — lines 348-360 `should add [PRP Auto] prefix to commit message`: REWRITE. Rename to e.g.
    `should layer the task-prefix and NOT emit [PRP Auto] when position is supplied`. Assert the new behavior:
    e.g. `formatCommitMessage('msg', parseItemPosition('P1.M2.T1.S1'))` → `.toContain('1.2.1.1: msg')` +
    `.not.toContain('[PRP Auto]')` + `.toContain('Co-Authored-By: Claude <noreply@anthropic.com>')`.
    (If the mock at 5b is kept simplistic (ignores position), call the REAL-ish behavior by asserting the
    Co-Authored-By trailer + no [PRP Auto]; OR import + call parseItemPosition to build a position. Prefer
    importing the real helpers since the module is mocked — the mock only stubs smartCommit/filterProtectedFiles/
    formatCommitMessage; the test can still construct a position via the imported (mocked) parseItemPosition if
    the mock exposes it. If the mock does NOT expose parseItemPosition, hardcode the expected prefix string in the
    assertion.)
  - DO NOT touch the harness-init setup / beforeEach (BUG-004 category-a, P1.M4.T2.S2). The file stays RED on
    harness-init; S3's gate for this file = typecheck + logical correctness of the format assertions.
  - VERIFY: `npm run typecheck` clean for this file (the new parseItemPosition import + objectContaining).

Task 6: VERIFY + FORMAT
  - RUN: npm run fix  → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/utils/git-commit.test.ts                          # EDITED → GREEN (existing + new wiring).
  - RUN: npx vitest run tests/unit/agents/commit-message-agent.test.ts              # regression → GREEN (S3 untouched).
  - RUN: npx vitest run tests/unit/config/prp-commit-format.test.ts                 # S1 regression → GREEN.
  - DO NOT run the full `npm run test:run` (pre-existing red — BUG-004, P1.M4 scope).
  - DO NOT expect tests/integration/smart-commit.test.ts GREEN (harness-init pending P1.M4.T2.S2).
  - EXPECTED: typecheck/lint/format clean; the 3 unit files GREEN. If typecheck fails → the SmartCommitOptions
    field type is wrong (not `ItemPosition | null`), or the task-orchestrator import/option-literal is malformed.
    If git-commit.test.ts fails → an env stub bled across cases (add the nested afterEach unstub) OR a position-
    flow assertion's expected string is off (recheck buildTaskPrefix output for the id used).
```

### Implementation Patterns & Key Details
```ts
// ---- src/utils/git-commit.ts: SmartCommitOptions extension (Task 1a) ----
export interface SmartCommitOptions {
  readonly generateMessage?: boolean;
  /** Optional backlog-item position (PRD §5.1). When supplied AND getPrpCommitFormat()==='task-prefix'
   *  (the DEFAULT), the <phase>.<milestone>.<task>[.<subtask>]: prefix layers onto the subject. null/undefined
   *  (non-backlog) OR format==='plain' → plain subject. Pass parseItemPosition(item.id); null degrades to plain. */
  readonly position?: ItemPosition | null;   // ItemPosition is in-scope (same module, S2 export) — NO import
}

// ---- the 3 wrap-site edits (Task 1b) ----
// happy (line 626):
formattedMessage = formatCommitMessage(generated, options.position);
// fallback (lines 637-639, keep multiline):
formattedMessage = formatCommitMessage(
  buildFallbackCommitMessage(genError),
  options.position
);
// default (line 643):
formattedMessage = formatCommitMessage(message, options.position);

// ---- src/core/task-orchestrator.ts: import + call-site wiring (Task 2) ----
import { smartCommit, parseItemPosition } from '../utils/git-commit.js';   // line 43 (ADD parseItemPosition)

// :801 (skip-recovery) and :1061 (survival) — the options object becomes:
{ generateMessage: true, position: parseItemPosition(subtask.id) }
// :1113 (post-cleanup, NON-backlog) — UNCHANGED:
{ generateMessage: true }   // OMIT position → plain (PRD §5.1 non-backlog rule)

// ---- tests/unit/utils/git-commit.test.ts: a position-flow test (Task 4) ----
it('generateMessage + position → task-prefix over the LLM subject (PRD §5.1)', async () => {
  // …mock gitStatus/gitAdd/gitDiff/mockCreateCommitMessageAgent/mockGitCommit per the happy-path test…
  mockCreateCommitMessageAgent.mockReturnValue(
    makeFakeAgent({ status: 'success', data: 'feat(api): add endpoint', error: null })
  );
  await smartCommit('/project', 'fallback msg', {
    generateMessage: true,
    position: parseItemPosition('P1.M2.T1.S1'),   // env UNSET → task-prefix default
  });
  expect(mockGitCommit).toHaveBeenCalledWith({
    path: '/project',
    message: '1.2.1.1: feat(api): add endpoint\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
  });
});

// ---- tests/integration/smart-commit.test.ts: the 3rd-arg assertion (Task 5c) ----
expect(mockSmartCommit).toHaveBeenCalledWith(
  sessionPath,
  'P3.M4.T1.S3: Implement smart commit workflow',
  expect.objectContaining({
    generateMessage: true,
    position: parseItemPosition('P3.M4.T1.S3'),   // S3 wiring: the orchestrator now passes position
  })
);
```

### Integration Points
```yaml
GIT-COMMIT.TS (src/utils/git-commit.ts):
  - +SmartCommitOptions.position (readonly ItemPosition | null); thread options.position into the 3 wrap sites;
    fix the stale step-6 JSDoc line.
  - PRESERVE: formatCommitMessage/parseItemPosition/buildTaskPrefix/ItemPosition definitions (S2 COMPLETE),
    SmartCommitOptions.generateMessage, smartCommit signature (3rd param stays SmartCommitOptions?).

TASK-ORCHESTRATOR.TS (src/core/task-orchestrator.ts):
  - +parseItemPosition import; +position at :801 (skip-recovery) + :1061 (survival); OMIT at :1113 (post-cleanup).
  - PRESERVE: the message strings, the generateMessage:true flags, the recovery/two-phase control flow.

BUG-HUNT-WORKFLOW.TS (src/workflows/bug-hunt-workflow.ts):
  - NO change (:503 already omits options → plain).

TESTS (tests/unit/utils/git-commit.test.ts):
  - +smartCommit position-flow tests (default-path/generateMessage-path → task-prefix; null/omitted → plain;
    bugfix-id coverage). Existing tests UNCHANGED (omit position → plain).

TESTS (tests/integration/smart-commit.test.ts):
  - UPDATE line 11 comment; lines 45-47 mock; lines 328-346 3rd-arg assertion; REWRITE lines 348-360 [PRP Auto] test.
  - DO NOT touch harness-init setup (P1.M4.T2.S2).

DOWNSTREAM / PARALLEL:
  - S4 (P1.M3.T1.S3, parallel) edits commit-message-agent.ts + its test — DISJOINT files; no conflict.
  - P1.M4.T2.S2 fixes the smart-commit.test.ts harness-init — coordinate; S3 lands the format assertions, S2-of-M4
    lands the harness-init; together they make the file GREEN.

OUT OF SCOPE (hard boundary):
  - formatCommitMessage/parseItemPosition/buildTaskPrefix/ItemPosition (S2), constants.ts + CONFIGURATION.md (S1),
    commit-message-agent.ts + its test (S4), the smart-commit.test.ts harness-init (P1.M4.T2.S2).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first — the new test blocks may reflow)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — clean
npm run lint           # eslint . --ext .ts — clean
npm run format:check   # prettier --check — clean
# Expected: all clean. Likely failures:
#   - typecheck error if SmartCommitOptions.position type is not `ItemPosition | null` (the call sites pass
#     parseItemPosition(id): ItemPosition | null → a bare ItemPosition field forces a non-null assertion).
#   - typecheck error if the task-orchestrator import omits parseItemPosition, or the option literal is malformed.
#   - lint error if an unused import slips in (e.g. importing ItemPosition type that isn't referenced).
```

### Level 2: Unit Tests (Component Validation)
```bash
# The EDITED unit file — MUST be GREEN (existing + new wiring tests):
npx vitest run tests/unit/utils/git-commit.test.ts
# Regression — the agent S3 must NOT break (S4 owns it; S3 untouched):
npx vitest run tests/unit/agents/commit-message-agent.test.ts
# S1 config regression (proves the format toggle still works):
npx vitest run tests/unit/config/prp-commit-format.test.ts
# Expected: all green. If git-commit.test.ts fails → (a) env stub bled across cases (add nested afterEach unstub);
#   (b) a position-flow assertion's expected prefix string is off (recheck buildTaskPrefix for the id used);
#   (c) a position null/omitted case flipped to a prefix (recheck the env — task-prefix is DEFAULT, so the
#   plain case needs position absent/null, NOT env=plain, unless explicitly testing the plain opt-out).
# Do NOT run the full `npm run test:run` — pre-existing red (BUG-004, P1.M4 scope).
```

### Level 3: Integration / Regression (System Validation)
```bash
# Confirm the SmartCommitOptions field + the 3 wrap-site args landed:
grep -n "readonly position?: ItemPosition | null" src/utils/git-commit.ts        # 1 hit
grep -n "formatCommitMessage(" src/utils/git-commit.ts | grep "options.position" # 3 hits (the wrap sites)
# Confirm the task-orchestrator import + the 2 subtask call sites + the OMIT site:
grep -n "parseItemPosition" src/core/task-orchestrator.ts                        # 1 import + 2 call sites = 3 hits
grep -n "position: parseItemPosition(subtask.id)" src/core/task-orchestrator.ts  # 2 hits (:801, :1061)
grep -n "cleanup: doc reorganization" src/core/task-orchestrator.ts              # 1 hit (:1113) — confirm NO position nearby
# Confirm bug-hunt stays option-less (NO change):
grep -n "bug hunt clean" src/workflows/bug-hunt-workflow.ts                      # 1 hit; confirm smartCommit( has no 3rd arg
# Confirm no [PRP Auto] is EMITTED anywhere (S2 already stripped it; S3 must not reintroduce):
grep -rn "PRP Auto" src/utils/git-commit.ts src/core/task-orchestrator.ts src/workflows/bug-hunt-workflow.ts
#   expect: ZERO hits in source (only the defense-in-depth strip regex in formatCommitMessage may mention the
#   string — that's S2's, unchanged).
# Confirm the integration test no longer expects [PRP Auto] in output:
grep -n "toContain('\[PRP Auto\]')" tests/integration/smart-commit.test.ts       # expect ZERO (rewritten in Task 5d)
grep -n "should add \[PRP Auto\]" tests/integration/smart-commit.test.ts         # expect ZERO (renamed)
# Build emits dist/ cleanly (proves the options type + imports compile):
npx tsc -p tsconfig.build.json
# Expected: all greps return the expected hit counts; build clean; no [PRP Auto] emitted in source.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP/LLM (pure wiring + tests). Domain checks (record in commit message):
#   1. Subtask commits now carry the <n.n.n.n>: task-prefix (default task-prefix mode) — verified by the
#      new git-commit.test.ts generateMessage+position case (mockGitCommit message has the prefix).
#   2. Non-backlog commits stay plain (no prefix) — verified: :1113 + :503 omit position; the position null/
#      omitted unit case asserts plain.
#   3. No commit carries [PRP Auto] — verified by the grep (zero source hits) + the not.toContain assertions.
#   4. Bugfix-session ids need no special-casing — verified: parseItemPosition('P1.M3.T2.S1') → {1,3,2,1} →
#      prefix '1.3.2.1' (this item's own id).
#   5. The fallback wrap site ALSO threads position (high-value coverage) — the always-throwing-agent case
#      asserts a prefixed placeholder commit ('1.2.1.1: chore: commit-gen failed…').
#   6. Graceful degradation: a malformed subtask.id → parseItemPosition returns null → plain commit (no throw,
#      no try/catch at the call site). formatCommitMessage(null) → plain.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/utils/git-commit.test.ts` GREEN (existing + new wiring tests).
- [ ] `npx vitest run tests/unit/agents/commit-message-agent.test.ts` GREEN (regression).
- [ ] `npx vitest run tests/unit/config/prp-commit-format.test.ts` GREEN (S1 regression).

### Feature Validation
- [ ] `SmartCommitOptions.position` (`readonly ItemPosition | null`) added.
- [ ] All 3 `smartCommit` wrap sites pass `options.position` to `formatCommitMessage`.
- [ ] `task-orchestrator.ts` imports `parseItemPosition`; :801 + :1061 pass `position: parseItemPosition(subtask.id)`.
- [ ] `task-orchestrator.ts:1113` OMITS position; `bug-hunt-workflow.ts:503` omits options entirely (non-backlog → plain).
- [ ] New unit tests: default-path+position → task-prefix; generateMessage+position → task-prefix; null/omitted → plain.
- [ ] `tests/integration/smart-commit.test.ts` format assertions updated (no `[PRP Auto]` expected; 3rd-arg asserted).
- [ ] No committed message contains `[PRP Auto]` (grep zero source hits).

### Code Quality Validation
- [ ] `position` field is `readonly` + `ItemPosition | null` (matches the `generateMessage` field style + the call-site value type).
- [ ] `parseItemPosition` import added to task-orchestrator.ts only (NOT to bug-hunt-workflow.ts, NOT to git-commit.ts).
- [ ] No try/catch around `parseItemPosition(subtask.id)` (it's pure + never throws; null degrades to plain).
- [ ] Step-6 JSDoc line in smartCommit's @remarks fixed (no stale `[PRP Auto]` claim).
- [ ] Only the 3 named source files + 2 test files touched (`bug-hunt-workflow.ts` is read-only/confirmed).
- [ ] Existing position-omitting smartCommit unit tests + S2's formatCommitMessage/parseItemPosition/buildTaskPrefix blocks UNCHANGED.

### Documentation & Deployment
- [ ] DOCS: none beyond S1/S2 (the call-site wiring is internal). The step-6 JSDoc reword rides with the change
      (Mode A). No docs/ edits.
- [ ] Commit message records: BUG-003 S3; the wiring (SmartCommitOptions.position + 3 wrap sites + 2 call sites);
      the non-backlog omit rule (§5.1); the graceful-null degradation; the bugfix-session numbering (no
      special-casing); the coordination note on smart-commit.test.ts harness-init (P1.M4.T2.S2).

---

## Anti-Patterns to Avoid

- ❌ Don't make `SmartCommitOptions.position` a bare `ItemPosition`. The call sites pass `parseItemPosition(subtask.id)`
      which is `ItemPosition | null` (null on a malformed id). The field MUST be `ItemPosition | null` to type-check
      without a non-null assertion. formatCommitMessage (S2) already accepts `ItemPosition | null`.
- ❌ Don't wire position into the non-backlog sites. `task-orchestrator.ts:1113` (post-cleanup) and
      `bug-hunt-workflow.ts:503` (bug-hunt marker) are NOT backlog items — they MUST degrade to plain (PRD §5.1).
      Omit the position field there. Wiring it would emit a bogus `<n.n.n.n>:` prefix over a commit that is not
      that item.
- ❌ Don't wrap `parseItemPosition(subtask.id)` in try/catch. It's pure + never throws; a malformed id → null →
      graceful plain (the intended degradation). A try/catch masks nothing + adds noise.
- ❌ Don't re-import `ItemPosition` in `src/utils/git-commit.ts`. It's exported by S2 in the SAME module — it's
      already in scope. Only `src/core/task-orchestrator.ts` needs a new import (`parseItemPosition`); even there,
      the `ItemPosition` TYPE is not referenced directly (inferred via parseItemPosition's return + the field type).
- ❌ Don't modify the S2 pure functions (`formatCommitMessage`/`parseItemPosition`/`buildTaskPrefix`/`ItemPosition`),
      S1's `constants.ts`, S4's `commit-message-agent.ts` + its test, or `CONFIGURATION.md`. Those are S2/S1/S4.
- ❌ Don't fix the `tests/integration/smart-commit.test.ts` harness-init ("PiHarness not initialized"). That's
      BUG-004 category-(a), P1.M4.T2.S2's scope. S3 owns the FORMAT assertions only; coordinate — the file stays
      RED on harness-init until P1.M4.T2.S2.
- ❌ Don't forget the env-stub harness in the new position-flow unit tests. Task-prefix is the DEFAULT (env unset);
      if a plain-opt-out case stubs `PRP_COMMIT_FORMAT=plain`, a nested `afterEach(vi.unstubAllEnvs)` is REQUIRED
      or the stub bleeds into the next test and flips a task-prefix assertion to plain. Copy S2's harness.
- ❌ Don't leave the 2-arg `toHaveBeenCalledWith` assertion in `smart-commit.test.ts` (lines 328-346). The
      orchestrator now passes a 3rd options arg `{ generateMessage: true, position: parseItemPosition(id) }`;
      the 2-arg form FAILS. Assert the 3rd arg via `expect.objectContaining({...})`.
- ❌ Don't run the full `npm run test:run` as the gate — it's pre-existing red (BUG-004, 178 failures, P1.M4 scope).
      Gate = typecheck + lint + format:check + the 3 named unit files. `smart-commit.test.ts` stays RED on
      harness-init (P1.M4.T2.S2) — verify its format assertions by typecheck, not a green run.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a small, fully-specified WIRING slice — 3 source files (~15 lines of real change) + 2 test
files. The input contract (S1 `getPrpCommitFormat` + S2 `formatCommitMessage(message, position?)` /
`parseItemPosition` / `buildTaskPrefix` / `ItemPosition`) is **already merged and verified present**; the
`position` param of `formatCommitMessage` was made OPTIONAL by S2 *precisely* so this slice can thread it
without touching the formatter. The exact current call-site code + line numbers are verified post-S2
(`:801/:1061/:1113`, `bug-hunt:503`; wrap sites `:626/:637-639/:643`); the graceful-`null` contract makes the
wiring trivially safe (no try/catch, no non-null assertions); the non-backlog omit rule + the bugfix-session
numbering note are both explained and test-covered. The non-obvious risks are all enumerated + mitigated:
(a) the field type MUST be `ItemPosition | null` (else a non-null assertion is forced — caught at typecheck);
(b) OMIT position at the 2 non-backlog sites (else a bogus prefix — caught by grep + the plain unit case);
(c) `ItemPosition` is in-scope in git-commit.ts (don't re-import — caught by lint unused-import);
(d) env-stub bleed in the new unit tests (nested afterEach — caught at Level 2);
(e) the 2-arg `toHaveBeenCalledWith` in smart-commit.test.ts breaks post-S3 (use objectContaining — caught at
typecheck/logical review since the file is RED on harness-init);
(f) coordinate with P1.M4.T2.S2 on the harness-init (don't fix it here). The deterministic typecheck + the
3-file unit gate confirm correctness in one pass; the one file that can't be GREEN-verified (smart-commit.test.ts)
is gated by typecheck + the parallel P1.M4.T2.S2 landing.