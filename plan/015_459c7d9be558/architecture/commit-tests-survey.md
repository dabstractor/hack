# Commit-Related Test Survey — Delta 015 (§9.10 / §5.1 / §4.5.1)

> Research artifact for downstream PRP agents. Summarizes the current state of
> every commit/tool-safety test file and identifies what must change to satisfy
> the §9.10 Commit Generation & Agent Tool Safety delta.

---

## File-by-File Findings

### 1. `tests/unit/utils/git-commit.test.ts` — 2233 lines

**Describe blocks:** `filterProtectedFiles`, `parseItemPosition`,
`buildTaskPrefix`, `formatCommitMessage`, `smartCommit` (nested: `successful
operations`, `input validation`, `error handling`, `logging behavior`),
`edge cases`, `generateCommitMessage` (nested: `style resolution (PRP_COMMIT_STYLE)`),
`smartCommit generateMessage option`, `smartCommit position option`,
`buildFallbackCommitMessage`, `restore_critical_files`,
`smartCommit restore_critical_files wiring`.

**Co-Authored-By PRESENCE assertions:** **NO** — the inversion has already been
done. The `formatCommitMessage` block has a dedicated test ("NEVER adds a
Co-Authored-By trailer in ANY output") that asserts `not.toContain('Co-Authored-By')`
and `not.toMatch(/noreply@anthropic\.com/)` across plain, prefixed, and
banner-strip modes.

**⚠️ CRITICAL BUG (blocking):** Nearly every `formatCommitMessage` and
`smartCommit` `toBe` assertion expects a trailing `>` character on the message
string (e.g. `expect(result).toBe('cleanup: doc reorganization>')`,
`expect(result).toBe('1.2.1.1: add utility>')`). The production
`formatCommitMessage` returns the bare subject (or `prefix: subject`) with **no**
trailing `>`. These assertions are **currently failing** — they appear to be
half-edited artifacts of a partial Co-Authored-By-trailer inversion (the `>`
was likely a leftover from concatenating a trailer that was then deleted). The
stray `>` must be stripped from every `toBe` / `toHaveBeenCalledWith` expected
value. Severity: **blocker** — the test suite is red for all formatCommitMessage
and smartCommit commit-message assertions.

**commit-message-agent references:** **YES** — heavily coupled. The file mocks
`commit-message-agent.js` (`createCommitMessageAgent`, `buildCommitMessageSystemPrompt`)
at the top, imports those symbols, and uses `mockCreateCommitMessageAgent` /
`mockBuildCommitMessageSystemPrompt` throughout the `generateCommitMessage` and
`smartCommit generateMessage option` describe blocks. When Milestone 1.2 deletes
`commit-message-agent.ts`, this mock and all references must be rewired to mock
the `stagecoach` binary invocation instead.

**Bash denylist:** No.
**Forbidden operations / remote mutation:** No.

---

### 2. `tests/unit/agents/commit-message-agent.test.ts` — 383 lines

**Describe blocks:** `createCommitMessageAgent`, `buildCommitMessageSystemPrompt`.

**Co-Authored-By PRESENCE assertions:** The tests assert the **system-prompt
text** contains the literal `Co-Authored-By` (e.g. `expect(cfg.system).toContain('Co-Authored-By')`).
These are checking that the prompt's discipline wording *mentions* the trailer
(to forbid it), **not** asserting trailer presence in commit output. However,
this is moot because:

**commit-message-agent references:** **YES** — the **entire file** exists solely
to test `src/agents/commit-message-agent.ts`. When Milestone 1.2 deletes that
module, this test file must be **deleted entirely** (or replaced with stagecoach
binary-exec tests if binary wiring is unit-tested separately).

**Bash denylist:** No.
**Forbidden operations / remote mutation:** No.

---

### 3. `tests/integration/smart-commit.test.ts` — 621 lines

**Describe blocks:** `commit triggering after subtask completion`,
`commit message formatting`, `protected files filtering`, `commit hash and
logging`, `error handling`, `edge cases`.

**Co-Authored-By PRESENCE assertions:** **NO** — already inverted. Two tests
explicitly assert `not.toContain('Co-Authored-By')`. The mock
`formatCommitMessage` returns `msg` verbatim (no trailer, no `>` artifact).

**commit-message-agent references:** **NO** — mocks `git-commit.js` at a higher
level; does not import or mock `commit-message-agent.js`.

**Bash denylist:** No.
**Forbidden operations / remote mutation:** No.

---

### 4. `tests/integration/git-commit-generate.test.ts` — 97 lines

**Describe block:** `generateCommitMessage — default auto config, real git
(LLM mocked only)`.

**Co-Authored-By PRESENCE assertions:** No.

**commit-message-agent references:** **YES** — mocks
`commit-message-agent.js` via `vi.importActual` (keeps the real
`buildCommitMessageSystemPrompt`, mocks only `createCommitMessageAgent`).
Imports `createCommitMessageAgent` for mock reference. When Milestone 1.2
removes the agent module, this test must be rewired to mock the stagecoach
binary boundary instead. The test's value (exercising the full `auto` config
path with real git) should be preserved — only the mock target changes.

**Bash denylist:** No.
**Forbidden operations / remote mutation:** No.

---

### 5. `tests/unit/tools/bash-mcp.test.ts` — 772 lines

**Describe blocks:** `BashMCP class`, `bashTool schema`, `executeBashCommand`
(nested: `successful execution`, `failed execution`, `timeout handling`,
`spawn error handling`, `working directory handling`, `shell security`,
`command parsing`), `edge cases`.

**Co-Authored-By PRESENCE assertions:** No.
**commit-message-agent references:** No.

**Bash denylist behavior:** **NO** — there is **no denylist** in the current
`bash-mcp.ts` implementation, and **no tests** for any command filtering. The
bash tool uses `spawn(command, { shell: true })` with **zero** pre-exec
validation. This is a **complete gap** — the §9.10.3 denylist
(`git push`, `git remote`, `git config`, `gh repo`, `gh api -X PATCH|POST|DELETE`,
`curl`/`wget` to `api.github.com`, `default_branch`, etc.) must be implemented
in `bash-mcp.ts` AND new tests written to cover every denylisted pattern +
fail-closed semantics + allowlisted commands (`npx vitest run`, `npm test`,
`npx tsc --noEmit`). Severity: **gap — entirely new test coverage needed**.

**Forbidden operations / remote mutation:** No.

---

### 6. `tests/unit/tools/git-mcp.test.ts` — 1341 lines

**Describe blocks:** `GitMCP class`, tool-schema blocks (`gitStatusTool`,
`gitDiffTool`, `gitAddTool`, `gitCommitTool`), `gitStatus`, `gitDiff`,
`gitAdd`, `gitCommit`, `edge cases`, `security patterns`, `gitFileHistory`,
`getRecentCommitMessages`, `gitReadFileAtCommit`, `gitRestoreFile`,
`gitListStagedDeletions`, `gitRestoreFileFromHead`, `gitUnstagePath`.

**Co-Authored-By PRESENCE assertions:** No.
**commit-message-agent references:** No.
**Bash denylist:** No.
**Forbidden operations / remote mutation:** No.

**Note for §5.1 plumbing commit:** `git-mcp.ts` uses the `simple-git` library
(`git.commit()`, `git.add()`, etc.) — **not** raw git plumbing. The §5.1
snapshot-based atomic commit requires `git write-tree` → `git commit-tree` →
`git update-ref` (CAS). These low-level plumbing commands are **not** exposed
by any current `git-mcp.ts` function and have **no test coverage**. New
plumbing functions + tests must be added (either new `git-mcp.ts` exports using
`simple-git`'s `.raw()` / `.catFile()` or direct `child_process` argv-vector
execs per §5.1's "never `sh -c`" requirement).

---

### 7. `tests/integration/forbidden-operations.test.ts` — 1107 lines

**Describe blocks:** `FilesystemMCP write protection`, `BashMCP .gitignore
protection`, `BashMCP pipeline command protection`, `session directory
constraints`, `error message verification`, `integration with real agent`,
`edge cases`, `complete protected files coverage`.

**Co-Authored-By PRESENCE assertions:** No.
**commit-message-agent references:** No.

**Bash denylist behavior:** **PARTIAL / MISLEADING.** Tests for `.gitignore`
pattern blocking and pipeline-command blocking (`prd/run-prd.sh`, `./tsk`,
`tsk`, `npm run prd`) exist — **but** they use a **test-local** `validateBashCommand()`
helper function defined in the test file itself. They do **NOT** test the actual
`bash-mcp.ts` production code (which has no denylist). The real
`bashMCP.executeTool('bash__execute_bash', ...)` calls that DO appear in a few
tests (e.g. "should allow adding valid patterns to .gitignore", "should allow
normal commands like npm test") just assert the mock spawn was called — they
exercise no filtering. Severity: **the existing "protection" tests are
effectively testing nothing in production code.**

**Forbidden operations / remote mutation:** **NO** — there are **zero** tests
for `git push`, `git remote`, `git update-ref`, `git config`, `gh repo edit`,
`gh api -X PATCH`, `curl`/`wget` to `api.github.com`, or `default_branch`
mutation. This is a **complete gap** per §9.10.3. These commands must be added
to the production denylist and covered by new tests.

---

### 8. `tests/unit/config/prp-commit-style.test.ts` — 149 lines

**Describe blocks:** `getPrpCommitStyle`, `getPrpCommitStyleExamples`.

Tests `PRP_COMMIT_STYLE` (auto/plain/conventional/gitmoji, case-insensitive) and
`PRP_COMMIT_STYLE_EXAMPLES` (allow-0 deviation). No Co-Authored-By, no
commit-message-agent, no denylist, no forbidden ops. Clean — no changes needed
for this delta.

---

### 9. `tests/unit/config/prp-commit-format.test.ts` — 123 lines

**Describe block:** `getPrpCommitFormat`.

Tests `PRP_COMMIT_FORMAT` (task-prefix/plain, case-sensitive). No Co-Authored-By,
no commit-message-agent, no denylist, no forbidden ops. Clean — no changes needed
for this delta.

---

## Cross-Cutting Summary

### Co-Authored-By Trailer Inversion (§9.10.2)

| File | Status | Action |
|------|--------|--------|
| `git-commit.test.ts` | ⚠️ Partially done + **broken** | Strip stray `>` from all `toBe` expected values (blocker — tests are red). The explicit ABSENCE test is already correct. |
| `commit-message-agent.test.ts` | N/A | **Delete entire file** (module being removed in M1.2). |
| `smart-commit.test.ts` | ✅ Already inverted | No change needed. |
| `git-commit-generate.test.ts` | N/A | Rewire mock target from agent to stagecoach binary (M1.2). |

### Bash Denylist (§9.10.3)

**Production code:** `bash-mcp.ts` currently has **zero** command filtering.
The §9.10.3 denylist must be implemented as a pre-exec gate in
`executeBashCommand()` before the `spawn()` call.

**Test coverage:** **None** exists for any denylisted pattern. New tests needed
for every forbidden command class + fail-closed ambiguous matches + allowlisted
test gates.

### Remote-Mutation / Forbidden Operations (§9.10.3)

**No tests exist** for `git push`, `git remote`, `gh repo`, GitHub-API writes,
or `default_branch` mutation anywhere in the test suite. The
`forbidden-operations.test.ts` file's existing "protection" tests use a
test-local helper, not production code.

### Per-Role Tool Matrix (§9.10.3)

No tests exist for per-role tool scoping. Current `agent-factory.ts` exposes
`MCP_TOOLS` (bash + filesystem + git) **uniformly** to every agent (architect,
researcher, coder, qa, cleanup). New tests needed to verify research/planner/coder
agents get no `bash`; commit agent gets no `bash` and only `git_commit`;
validation agent gets denylisted `bash`.

### `commit-message-agent.ts` Removal Ripple (§9.10.1)

Three test files import/mock `commit-message-agent.js`:
1. `commit-message-agent.test.ts` — **delete entirely**.
2. `git-commit.test.ts` — rewire mock from agent factory to stagecoach binary exec.
3. `git-commit-generate.test.ts` — rewire mock from agent factory to stagecoach binary exec.

### §5.1 Snapshot Plumbing Gap

`git-mcp.ts` uses `simple-git` high-level API. No `write-tree` / `commit-tree` /
`update-ref` functions exist. No tests for atomic commit mechanics, CAS refusal,
or recovery recipes. All new for Milestone 1.1.