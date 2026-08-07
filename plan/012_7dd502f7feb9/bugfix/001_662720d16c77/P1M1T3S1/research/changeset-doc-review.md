# Research — P1.M1.T3.S1: Review/update changeset-level docs for the BUG-001 fix

> Changeset-level documentation sync (Mode B, SOW §5) for BUG-001. BUG-001 was the critical default-config
> defect where `getRecentCommitMessages()` passed simple-git `{ maxEntries: count }` instead of
> `{ maxCount: count }`, making the DEFAULT `auto` commit-style throw on every commit and silently fall
> back to the placeholder. The fix (T1.S1 + T1.S2, commits `bba784b`/`4294f29`) is a one-token source
> change + test-assertion fix; T2.S1/T2.S2 add regression tests. **This task (T3.S1) verifies the
> changeset-level docs (README.md + docs/*.md) are consistent with the fix — and finds they already are.**

## 0. TL;DR (the finding)

**This is a NO-OP — confirm and close.** No changeset-level doc references the `maxEntries` bug, the
`maxCount` fix, or `getRecentCommitMessages` internals. Every doc that describes the commit-style
feature already describes the **intended** `auto` behavior (which the fix RESTORES), so they were
aspirationally correct and are now actually correct. There is no CHANGELOG/release-notes/bug-fixes
section to add a BUG-001 note to. The `getRecentCommitMessages` JSDoc is user-facing and accurate
(never named the internal option). Per the item description: *"If no changeset-level docs reference
this area, this subtask is a no-op (confirm and close)."* → that is the resolution. The determination
is recorded (this note + the commit message).

## 1. The BUG-001 changeset (what actually changed)

Commits `bba784b` (source fix, T1.S1) + `4294f29` (test-assertion fix, T1.S2) + `13687f0` (regression
test, T2.S1) + `629cffe` (research for T2.S2). **Files changed by the fix — ALL source or test:**
- `src/tools/git-mcp.ts` — `git.log({ maxEntries: count })` → `git.log({ maxCount: count })` (line ~590).
- `tests/unit/tools/git-mcp.test.ts` — assertion `{ maxEntries: 2 }` → `{ maxCount: 2 }` (line ~977).
- `tests/integration/git-mcp-log.test.ts` — NEW real-simple-git regression test (T2.S1).
- `tests/integration/git-commit-generate.test.ts` — NEW e2e auto-config test (T2.S2, in progress; test-only, no docs).

**No doc files were touched by any fix subtask.** The fix is a corrective bugfix (AGENTS.md Rule 5) —
it restores existing intended behavior; it adds no feature, config key, CLI flag, or API surface.

## 2. Grep sweep — README.md + docs/*.md (the item's specified terms)

Command: `grep -rni 'maxEntries\|maxCount\|PRP_COMMIT_STYLE\|getRecentCommitMessages\|commit.style\|commit message\|stagecoach\|Conventional Commit\|gitmoji' README.md docs/*.md`

**Result for `maxEntries` / `maxCount`: ZERO matches.** No changeset-level doc names the buggy option
or the fix. (Confirmed by a recursive sweep over ALL `*.md` excluding `node_modules` and `/plan/` —
also zero. The only simple-git mentions in docs are `docs/CUSTOM_TOOLS.md:567,650` and
`docs/TESTING.md:590,601`, which are generic usage/mock examples unrelated to the log option.)

**Result for the commit-style feature** — all references describe the INTENDED behavior:

| File:line | What it says | Affected by fix? |
| --------- | ------------ | ---------------- |
| `README.md:172` | "Two-phase commits … via the Smart Commit tool (`stagecoach`)" (high-level) | ✅ Accurate (no internals) |
| `README.md:426-428` | Config-table rows: `PRP_COMMIT_FORMAT`, `PRP_COMMIT_STYLE` (`auto` = "learn from history"), `PRP_COMMIT_STYLE_EXAMPLES` (`0` disables) | ✅ Accurate — describes the FIXED (intended) behavior |
| `docs/ARCHITECTURE.md:927-954` | "Commit Message Format (Two-Layer Model)" — position + style layers; `auto` learns from history; ≤1-commit → `plain` degradation; prefix double-up interaction | ✅ Accurate — describes intended behavior |
| `docs/CONFIGURATION.md:94,251-257` | `[pipeline]` keys + env-var reference for `PRP_COMMIT_STYLE`/`PRP_COMMIT_STYLE_EXAMPLES` (auto learns; ≤1 degrades; `0` disables) | ✅ Accurate — describes intended behavior |
| `docs/CUSTOM_TOOLS.md:644` | Generic "Commit message is required" example | ✅ Unrelated to BUG-001 |

None of these name `maxEntries`/`maxCount`, none claim the buggy behavior, and none are now stale.
The docs described the SPEC; the fix makes the CODE match the spec. **No edit needed.**

## 3. The `getRecentCommitMessages` JSDoc (src/tools/git-mcp.ts:560-595)

Read in full. It is **user-facing and accurate** and never names the internal `log()` option:
- "Fetch the most recent commit messages from a repository (PRD §5.1 commit-style layer)."
- "Returns the FULL commit message (subject + body) … newest-first."
- "`count === 0` short-circuits to `[]` BEFORE any filesystem/git access."
- "A repository with fewer than `count` commits returns all available entries."
- `@throws {Error}` if not a git repo or `git.log` fails.

Post-fix this is all true (and it was true before the fix too — it never claimed `maxEntries`).
The item note confirms: *"The getRecentCommitMessages JSDoc accurately describes the function and
does not mention internal option names."* **No JSDoc edit needed.** (JSDoc is source, anyway — out of
this task's docs-only scope per AGENTS.md.)

## 4. Changelog / release-notes / bug-fixes area — NONE EXISTS

`grep -ni 'changelog\|release note\|## changes\|bug fix\|## version\|## history\|## what.s new' README.md docs/*.md` returned only generic "bug fix workflow" / pipeline references (the QA bug-hunt
pipeline — `docs/CONFIGURATION.md:282,646`, `docs/user-guide.md:809`, `docs/WORKFLOWS.md`, `README.md:798`),
**not** a changelog/release-notes section. No `CHANGELOG*`/`CHANGES*`/`HISTORY*`/`RELEASE*` file at the
repo root. So the item's *"If the README has a changelog, bug-fixes section, or release notes area,
add a brief note about BUG-001"* branch does **not apply** — there is nowhere to add such a note.

## 5. Scope & constraints (AGENTS.md)

- This is a **planning / Mode-B docs task**: edit DOCS ONLY, never source code, tests, config,
  `PRD.md`, `spec/**`, `tasks.json`, or `prd_snapshot.md`. (The source JSDoc is therefore out of scope.)
- The fix is corrective (Rule 5) — it restores intended behavior; it does **not** warrant a new
  doc section describing a new feature (there is no new feature).
- Recording the no-op finding is the deliverable (this note + the commit message), consistent with
  every sibling subtask in this changeset having a `research/` note.

## 6. Deterministic re-verification recipe (for the implementing agent)

```bash
# (a) Re-confirm NO doc names the buggy/fix option or the helper internals.
grep -rni 'maxEntries\|maxCount\|getRecentCommitMessages' README.md docs/*.md
# EXPECTED: zero matches (the bug & its fix live only in source/tests).

# (b) Re-confirm the commit-style docs describe the INTENDED behavior (which the fix restores).
grep -rni 'PRP_COMMIT_STYLE\|auto.*learn\|stagecoach' README.md docs/ARCHITECTURE.md docs/CONFIGURATION.md
# EXPECTED: README.md:172,426-428; ARCHITECTURE.md:927-954; CONFIGURATION.md:94,251-257 — all describe
#   auto-learns-from-history / ≤1-degrades / 0-disables, i.e. the FIXED behavior. None name maxEntries.

# (c) Re-confirm there is no changelog/release-notes area to update.
ls CHANGELOG* CHANGES* HISTORY* RELEASE* 2>/dev/null; grep -ni '## changelog\|## release notes\|## what.s new' README.md docs/*.md
# EXPECTED: no file; no section header.
```

**Decision gate:** If (a) is empty AND (b) shows only intended-behavior descriptions AND (c) finds no
changelog → **NO-OP**; record the finding (§7). If (a) returns any `maxEntries` reference or (b)
reveals a claim inconsistent with the fix → apply the contingency edit in the PRP (docs only), then
`npx prettier --check <file>`.

---

## 7. Executed re-verification (implementation run, P1.M1.T3.S1)

The §6 recipe was re-run during implementation against the post-fix tree. Captured output below is
verbatim from the terminal.

### (a) `maxEntries` / `maxCount` / `getRecentCommitMessages` in changeset docs

```bash
$ grep -rni 'maxEntries\|maxCount\|getRecentCommitMessages' README.md docs/*.md
# (no output; grep exit 1 = no matches)
```

**Result: ZERO matches.** No changeset-level doc names the buggy option, the fix option, or the
helper internals.

### (b) Commit-style feature refs (must describe the INTENDED behavior)

```bash
$ grep -rni 'PRP_COMMIT_STYLE\|auto.*learn\|stagecoach' README.md docs/ARCHITECTURE.md docs/CONFIGURATION.md
README.md:172:- **Two-phase commits** — each item commits **twice** via the Smart Commit tool (`stagecoach`):
README.md:426:| `PRP_COMMIT_FORMAT`         | No       | `task-prefix`       | **Position layer** … Orthogonal to `PRP_COMMIT_STYLE`. …
README.md:427:| `PRP_COMMIT_STYLE`          | No       | `auto`              | **Style layer** for the descriptive message `stagecoach` writes — `auto` (learn from history), `plain`, `conventional`, or `gitmoji`. …
README.md:428:| `PRP_COMMIT_STYLE_EXAMPLES` | No       | `5`                 | Commits sent as style examples under `auto`; `0` disables learning (degrades to `plain`). …
docs/ARCHITECTURE.md:927:Each subtask commits in **two phases** via the Smart Commit tool — `stagecoach` — …
docs/ARCHITECTURE.md:930:2. **Post-cleanup commit** — _after_ cleanup reorganizes docs …
docs/ARCHITECTURE.md:936:A generated commit message is governed by **two orthogonal layers** …
docs/ARCHITECTURE.md:941:| Style    | `PRP_COMMIT_STYLE`  | `auto`        | The wording of the descriptive message itself |
docs/ARCHITECTURE.md:945:**Style layer.** `PRP_COMMIT_STYLE` governs the descriptive message `stagecoach` actually writes …
docs/ARCHITECTURE.md:947:- `auto` (default) **learns from history**: … A repo with ≤1 commit — or `PRP_COMMIT_STYLE_EXAMPLES=0` — has nothing to learn, so `auto` degrades to the `plain` contract.
docs/ARCHITECTURE.md:954:**Interaction between the layers.** Both layers apply in sequence and independently. …
docs/CONFIGURATION.md:94:| `[pipeline]` | … `commit_style`, `commit_style_examples` | … `PRP_COMMIT_STYLE`, `PRP_COMMIT_STYLE_EXAMPLES` |
docs/CONFIGURATION.md:251:| `COMMIT_RETRY_MAX`          | … stagecoach commit-message-generation attempts …
docs/CONFIGURATION.md:252:| `COMMIT_RETRY_DELAY`        | … stagecoach … retries …
docs/CONFIGURATION.md:253:| `COMMIT_RETRY_DELAY_CAP`    | … stagecoach … backoff. …
docs/CONFIGURATION.md:256:| `PRP_COMMIT_STYLE`          | … `auto` (default) learns the project's style … degrades to `plain` when the repo has ≤1 commit. …
docs/CONFIGURATION.md:257:| `PRP_COMMIT_STYLE_EXAMPLES` | … `0` **disables** style learning (degrades to `plain`) …
```

Every match describes the **intended** contract (auto learns from history; ≤1 commit /
`EXAMPLES=0` → degrades to `plain`; explicit modes replace the examples). None names `maxEntries`,
none asserts the buggy behavior, none is now stale. These statements were the SPEC; the fix makes
the CODE match the spec.

### (c) Changelog / release-notes area

```bash
$ ls CHANGELOG* CHANGES* HISTORY* RELEASE* 2>/dev/null
# (no output)
$ grep -ni '## changelog\|## release notes\|## what.s new' README.md docs/*.md
# (no output; grep exit 1 = no matches)
```

**Result:** No `CHANGELOG*`/`CHANGES*`/`HISTORY*`/`RELEASE*` file at the repo root, and no
changelog/release-notes section header in README.md or any `docs/*.md`. The item's "add a BUG-001
note to an existing changelog" branch does **not** apply (there is nowhere to add it).

### Level 3 informational confirmations (read-only)

- `src/tools/git-mcp.ts:590` → `const logResult = await git.log({ maxCount: count });` (T1.S1 fix
  present).
- `tests/unit/tools/git-mcp.test.ts:977` → `expect(mockGitInstance.log).toHaveBeenCalledWith({
  maxCount: 2 });` (T1.S2 assertion fix present).
- The only `maxEntries` occurrences under `src/`/`tests/` are in the **regression-test comments**
  (`tests/integration/git-mcp-log.test.ts:6,12,78`, `tests/integration/git-commit-generate.test.ts:6,82`)
  — these intentionally describe the historical bug the regression tests guard against. There is **no
  residual `maxEntries` in any code path**.

### Decision-gate outcome

- (a) empty ✓
- (b) only intended-behavior descriptions (none name `maxEntries`, none assert the buggy behavior) ✓
- (c) no changelog file or section header ✓

**→ Decision gate routes to the NO-OP branch.** No `README.md` or `docs/*.md` file was modified for
BUG-001 reasons. `npx prettier --check` is N/A (no doc edited). No source code, test, config,
`PRD.md`, `spec/**`, `tasks.json`, `prd_snapshot.md`, or `.gitignore` was modified by this task (the
only working-tree change attributable to this task lives under `plan/.../P1M1T3S1/` — this note).

> VERIFIED 2026-08-07: README.md + docs/*.md consistent with BUG-001 fix (maxEntries→maxCount).
> Changelog area: none. Edit applied: none. No-op confirmed.

**Suggested commit message (NO-OP branch):**
`Verify changeset-level docs consistent with BUG-001 fix (maxEntries→maxCount); no doc edits needed`