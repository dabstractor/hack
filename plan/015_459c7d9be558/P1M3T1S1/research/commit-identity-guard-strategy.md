# Research — P1.M3.T1.S1: commit-identity-guard test — walk src/ for forbidden identity literals

## 0. What this task IS (a new self-source-scan GUARD test — no production code)

Creates ONE new test file `tests/unit/guards/commit-identity-guard.test.ts` (PRD §9.10.2 "structural
enforcement (self-source-scan test)"). **No `src/` changes** — the behavioral fix is ALREADY done
(`formatCommitMessage` at git-commit.ts:227–246 strips `[PRP Auto]`, layers the task-prefix, and emits
NO trailer). The guard is the structural backstop so the bug (a hardcoded
`Co-Authored-By: Claude <noreply@anthropic.com>` literal) can NEVER regress.

## 1. The current src/ tree PROVES the comment-skip rule is load-bearing (VERIFIED)

`grep -rn` for the forbidden literals in `src/` returns ONLY comment lines — every match is a JSDoc
(`*`-prefixed) or `//`-prefixed citation of the removed incident. If the guard did NOT skip comments,
it would false-trip on its own doc citations:

| file:line | trimmed-start | content (forbidden literal in a COMMENT) |
|-----------|---------------|------------------------------------------|
| src/utils/git-commit.ts:206 | `*` | `* - NEVER appends a \`Co-Authored-By\` trailer …` |
| src/utils/git-commit.ts:208 | `*` | `* … the prior unconditional \`Co-Authored-By: Claude <noreply@anthropic.com>\`` |
| src/utils/git-commit.ts:239 | `//` | `// Identity-transparent (PRD §5.1): NO Co-Authored-By trailer …` |
| src/utils/git-commit.ts:240 | `//` | `// author. The prior hardcoded \`Co-Authored-By: Claude <noreply@anthropic.com>\`` |
| src/utils/git-commit.ts:303 | `*` | `* drift-acquired a hardcoded \`Co-Authored-By: Claude\` trailer …` |
| src/utils/git-commit.ts:393 | `*` | `* \`Co-Authored-By\` trailer).` |
| src/utils/git-commit.ts:726 | `*` | `* … no \`user.name\`/\`user.email\` config write …` |
| src/utils/git-commit.ts:727 | `*` | `* \`GIT_AUTHOR_*\`/\`GIT_COMMITTER_*\` env on any git subprocess …` |
| src/utils/git-commit.ts:859 | `//` | `// … MUST NOT set user.name/user.email …` |
| src/utils/git-commit.ts:860 | `//` | `// or pass GIT_AUTHOR_*/GIT_COMMITTER_* env …` |
| src/tools/git-mcp.ts:673 | `*` | `* … sets no \`user.name\`/\`user.email\` …` |
| src/tools/git-mcp.ts:674 | `*` | `* \`GIT_AUTHOR_*\`/\`GIT_COMMITTER_*\` env.` |
| src/cli/commands/config.ts:291 | `*` | `* … (no \`user.email\` config needed).` |

→ **13 comment-line citations** that the guard MUST skip. There are **zero** non-comment occurrences
(the behavioral fix is complete). This is the verified baseline the guard's "zero violations"
assertion runs against.

## 2. cmd/ does NOT exist (the `cmd/` branch is conditional "if present")

`ls -d cmd/` → NO. So the guard walks **src/ only** today; the `cmd/` `.go` walk is wrapped in
`if (existsSync(cmdDir))` so it future-proofs without breaking the `filesVisited > 0` assertion
(src/ alone satisfies it — many files).

## 3. Test infra (VERIFIED)

- **Runner:** vitest (`npm run test:run` = `vitest run`). Test files: `tests/**/*.{test,spec}.ts`.
- **Coverage:** a FLOOR (~90%), NOT 100% (vitest.config.ts L39-53). The new guard file is a TEST →
  EXCLUDED from coverage measurement (`exclude: ['**/*.test.ts', '**/*.spec.ts', …]`). So no coverage
  obligation; the gate is the test itself passing.
- **Path-resolution pattern** (from tests/unit/prp-template-validation.test.ts): use
  `fileURLToPath(import.meta.url)` + `dirname` + `join` to resolve the repo root from the TEST FILE's
  own location (NOT `process.cwd()`) — this is what makes the `filesVisited > 0` assertion meaningful
  (a cwd-based path bug is exactly what the PRD wants to catch).
- **NEW dir:** `tests/unit/guards/` does not exist yet → CREATE it + the test file. (The item's
  suggested path `tests/unit/guards/commit-identity-guard.test.ts`.)

## 4. The detector contract (PRD §9.10.2 + item LOGIC §d)

A non-comment line is a VIOLATION if it contains ANY of (as a string literal / call-site argument):

| class | literals | case |
|-------|----------|------|
| trailer tokens | `Co-Authored-By`, `Co-Authored`, `coauthor` | case-INsensitive |
| cargo-culted strings | `noreply@anthropic.com`, `Generated with [Claude Code]`, `🤖 Generated` | as written (case-sensitive is fine; the strings are distinctive) |
| git-identity env literals | `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_AUTHOR_DATE`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`, `GIT_COMMITTER_DATE` | case-sensitive (they're exact env-var names) |
| identity-config writes | `user.name` / `user.email` as args to a git-config call — shell form `git config user.name` OR array form `['config', 'user.name']` / `['config', 'user.email']` | the `user.name`/`user.email` literal in git-config proximity |

**Comment-skip rules** (item LOGIC §c + PRD): a line is SKIPPED (not checked) if:
1. currently inside a `/* … */` block (track state across lines; `/*` enters, `*/` exits), OR
2. the trimmed line starts with `//` (full-line comment), OR
3. the trimmed line starts with `*` (JSDoc continuation — handles `*`-prefixed doc lines even when
   the block-tracker might miss a boundary).

(Edge case: a CODE line with a TRAILING `// comment` containing a forbidden literal — e.g.
`const x = 1; // Co-Authored-By note`. Verified: NO such line exists in the current src/ tree — all
13 matches are FULL comment lines. The guard checks the full non-comment-starting line; if a future
trailing-comment false-positive appears, strip from the first `//`. Document this as a limitation.)

## 5. The "fires when injected" acceptance criterion (PRD §9.10.2) — handle WITHOUT tree mutation

PRD §9.10.2 acceptance: "The self-source-scan FIRES when a forbidden literal is temporarily injected
into a production file, then reverts green when removed." Mutating the real src/ tree at test time is
flaky + dangerous. **Cleaner approach: a `describe('detector')` unit block** that runs the SAME pure
detector function over SYNTHETIC positive/negative lines. Positive lines (the detector MUST flag):
`'const trailer = "Co-Authored-By: Claude"'`, `'execGit(["config", "user.name"])'`,
`'process.env.GIT_COMMITTER_NAME = "bot"'`, `'git config user.email bot@example.com'`,
`'// eslint Co-Authored'` (wait — that's a comment → NEGATIVE). Negative lines (MUST NOT flag): the
13 real comment citations above, `'git config core.editor vim'`, `'npm test'`, `''`. This proves the
detector "fires" deterministically, satisfying the acceptance criterion without touching the tree.

→ **Design: split the detector into a pure function** `findLineViolations(line: string): string[]`
(returns the matched literals) that BOTH the `describe('detector')` unit block AND the
`describe('self-source-scan')` filesystem-walk block call. DRY + unit-testable.

## 6. The guard file's own header (DOCS requirement — item LOGIC §5)

The test-file header JSDoc MUST document the FR-39a-style discipline (mirrors stagecoach's
identity-invariant structural guard) + cite PRD §9.10.2 "structural enforcement (self-source-scan
test)." This is the Mode-A-equivalent doc artifact for a test file (no external docs/*.md).

## 7. Validation for a guard test

- **Gate:** `npm run test:run -- tests/unit/guards/commit-identity-guard.test.ts` GREEN (both
  describe blocks). Plus `npm run typecheck && npm run lint && npm run format:check` clean (the new
  .ts test file must pass eslint + prettier; typecheck excludes tests/ but lint/format include them).
- **The guard is self-verifying:** if a forbidden literal lands in a production file, this very test
  fails the build. So the "fires when injected" property is structurally guaranteed by the test's
  existence + the detector unit block.
- **Do NOT** run the full `npm run test:run` as the semantic gate (orthogonal pre-existing failures
  per the survey — e.g. the M1.T3 collateral). Gate on the new guard file + typecheck/lint/format.
- **No production code changes.** `git diff --name-only` = EXACTLY the new test file.

## 8. Disjointness / scope

- **NEW file only:** `tests/unit/guards/commit-identity-guard.test.ts`. No `src/` edits.
- **Parallel sibling P1.M2.T3.S2** (in-flight) edits TEST files (deletes commit-message-agent.test.ts,
  rewires git-commit-generate.test.ts, cleans protected-files.test.ts) — ZERO overlap with the new
  guard file. No merge conflict.
- **P1.M3.T2.S1** (later) inverts the behavioral tests in `tests/unit/utils/git-commit.test.ts`
  (stray-`>` bug + trailer-absence assertions) — a DIFFERENT file. This task's guard is the STRUCTURAL
  backstop; T2.S1 is the BEHAVIORAL assertion. Disjoint.
- **READ-ONLY:** src/utils/git-commit.ts (the walked production code), PRD §9.10.2, the survey.