# PRP — P1.M3.T1.S1: commit-identity-guard test — walk src/ for forbidden identity literals

> Session 015, **P1.M3.T1.S1 — the §9.10.2 structural backstop**. PRD §9.10.2 ("Commit-Identity
> Structural Guard") requires a self-source-scan test that FAILS THE BUILD if any **non-comment**
> production line under `src/` (and `cmd/` if present) contains a forbidden identity/attribution
> literal. The behavioral fix is already done (`formatCommitMessage` at `src/utils/git-commit.ts:227–246`
> emits no `Co-Authored-By` trailer); the forbidden strings today survive ONLY in 13 comment-line
> citations of the removed incident (verified). This task ships the **guard test** so the
> hardcoded-`Co-Authored-By` bug (incident 1) can never regress. **No `src/` changes — one new test
> file.** Mirrors stagecoach's FR-39a discipline.

---

## Goal

**Feature Goal**: Create a self-source-scan guard test that recursively walks every **production**
`.ts` file under `src/` (and `.go` under `cmd/` if present), skips test files + the guard's own file +
**comment lines** (full-line `//`, `*`-prefixed JSDoc, and lines inside `/* … */` blocks), and FAILS
if any non-comment line contains a forbidden identity/attribution literal — while asserting `> 0`
production files were visited (so a path-resolution bug cannot pass vacuously). The guard targets
call-site string literals, NOT bare substrings inside comments.

**Deliverable** (one new file):
- **`tests/unit/guards/commit-identity-guard.test.ts`** (CREATE — new `tests/unit/guards/` dir) — a
  pure detector (`findLineViolations`) + a filesystem walker + TWO describe blocks:
  (1) `describe('commit-identity-guard > detector')` — unit-tests the detector on synthetic
  positive/negative lines (proves it FIRES on a forbidden literal and ignores comments/benign code —
  satisfies PRD §9.10.2's "fires when injected" acceptance criterion WITHOUT mutating the tree);
  (2) `describe('commit-identity-guard > self-source-scan (PRD §9.10.2)')` — walks the real `src/`
  (+`cmd/` if present), asserts ZERO violations and `filesVisited > 0`. Header JSDoc documents the
  FR-39a discipline + cites §9.10.2.

**Success Definition**:
- The self-source-scan reports **zero** forbidden-literal hits on the current tree (the 13 comment
  citations are skipped).
- The self-source-scan **fires** when a forbidden literal (e.g. a `Co-Authored-By` string, or a
  `git config user.name` / `['config','user.email']` write, or a `GIT_COMMITTER_NAME` env literal) is
  fed to the detector — proven by the `describe('detector')` unit block on synthetic positive lines.
- The guard asserts `> 0` production files visited (no vacuous pass from a path-resolution bug).
- No comment-line citation of the incident causes a false failure (the 13 real citations are skipped).
- `npm run test:run -- tests/unit/guards/commit-identity-guard.test.ts` GREEN; `npm run lint` + `npm run
  format:check` clean (the new `.ts` test file passes eslint + prettier); `git diff --name-only` =
  EXACTLY the new test file.

---

## Why

- **§9.10.2 requires STRUCTURAL enforcement, not just a behavioral rule.** Incident 1 showed a
  hardcoded `Co-Authored-By: Claude <noreply@anthropic.com>` literal violating §5.1's
  identity-transparency rule on EVERY work-item commit — a behavioral requirement with **no
  enforcement** regressed the moment it was written. A self-source-scan guard makes the prohibition a
  compile/test-time invariant: the literal cannot land in production code without failing the build.
- **The behavioral fix alone is insufficient.** `formatCommitMessage` no longer emits the trailer
  (done). But a future edit could re-introduce a hardcoded trailer, a `GIT_AUTHOR_*` env injection,
  or a `git config user.name` write — none of which the behavioral tests (which assert
  `formatCommitMessage`'s output) would catch if the regression were in a DIFFERENT code path. The
  guard scans ALL production source, closing that gap.
- **Comment-skipping is load-bearing.** The 13 comment-line citations of the incident (JSDoc + `//`)
  document WHY the rule exists; the guard MUST skip them so the docs don't self-trip. The PRD
  explicitly says "Comment lines … are skipped so doc citations of the incident do not self-trip."
- **"fires when injected" is a hard acceptance criterion.** A guard that silently passes on a planted
  violation is worthless. The `describe('detector')` unit block proves the detector logic on
  synthetic inputs deterministically — no flaky tree-mutation.
- **Scope discipline.** One new test file, no `src/` changes. The behavioral-test inversion
  (P1.M3.T2.S1 — stray-`>` bug + trailer-absence assertions in `git-commit.test.ts`) is a SEPARATE
  file/slice. The guard is the structural backstop; T2.S1 is the behavioral assertion. Disjoint.

---

## What

### User-visible behavior
None beyond the test suite. Observable change: one new green test file under `tests/unit/guards/`. The
guard becomes a permanent CI gate: any future PR that introduces a forbidden identity literal into
production source fails the build.

### Technical requirements (exact contract)

**File:** `tests/unit/guards/commit-identity-guard.test.ts` (CREATE; create the `tests/unit/guards/`
directory).

**Header JSDoc (DOCS — item LOGIC §5):** document the FR-39a-style discipline (the guard mirrors
stagecoach's identity-invariant structural self-source-scan) + cite **PRD §9.10.2 "structural
enforcement (self-source-scan test)"**. State: walks production `src/` (+`cmd/` if present); skips
test files + the guard's own file + comment lines; fails on forbidden identity/attribution literals
in non-comment lines; asserts `> 0` files visited.

**Imports:** `describe, expect, it` from `vitest`; `readdirSync, readFileSync, existsSync` from
`node:fs`; `join, relative, extname, basename` from `node:path`; `fileURLToPath` from `node:url`;
`dirname` from `node:path`.

**REPO_ROOT resolution (path-resolution-bug-proof — mirror prp-template-validation.test.ts):**
```ts
const __filename = fileURLToPath(import.meta.url);     // …/tests/unit/guards/commit-identity-guard.test.ts
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '../../..');      // repo root (3 levels up from tests/unit/guards/)
const SRC_DIR = join(REPO_ROOT, 'src');
const CMD_DIR = join(REPO_ROOT, 'cmd');
```
(Use `resolve`/`join` — resolve from the TEST FILE's location, NOT `process.cwd()`. The
`filesVisited > 0` assertion catches a wrong root.)

**The forbidden-literal detector (PURE — unit-testable):**
```ts
// A non-comment line is a VIOLATION if it contains any of these as a call-site string literal.
// Case-insensitive trailer tokens; exact env-var names; cargo-culted strings as written.
const TRAILER_TOKENS = [/co-authored-by/i, /co-authored/i, /coauthor/i];
const CARGO_CULT = [/noreply@anthropic\.com/i, /Generated with \[Claude Code\]/, /🤖 Generated/];
const IDENTITY_ENV = [
  'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_DATE',
  'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_COMMITTER_DATE',
];
// identity-config writes: user.name/user.email as args to a git-config call.
// Shell form: `git config user.name` / `git config user.email`.
// Array form: ['config', 'user.name'] / ['config', 'user.email'].
const CONFIG_WRITE = [
  /\bgit\s+config\s+user\.(name|email)\b/i,
  /\[\s*['"]config['"]\s*,\s*['"]user\.(name|email)['"]\s*\]/,
];

/** Returns the list of forbidden literals matched in a non-comment line (empty = clean). */
function findLineViolations(line: string): string[] {
  const hits: string[] = [];
  for (const re of TRAILER_TOKENS) { const m = line.match(re); if (m) hits.push(m[0]); }
  for (const re of CARGO_CULT) { const m = line.match(re); if (m) hits.push(m[0]); }
  for (const name of IDENTITY_ENV) { if (line.includes(name)) hits.push(name); }
  for (const re of CONFIG_WRITE) { const m = line.match(re); if (m) hits.push(`user.${m[1]}`); }
  return hits;
}
```

**Comment-skip state machine (per scanned line):**
```ts
/** Walks one file's lines, returning violations for NON-COMMENT lines. */
function scanFileContent(absPath: string, relPath: string): Violation[] {
  const violations: Violation[] = [];
  const lines = readFileSync(absPath, 'utf8').split('\n');
  let inBlock = false; // inside a /* … */ block
  lines.forEach((raw, idx) => {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) return; // still inside the block → skip the whole line
      inBlock = false;
      line = line.slice(end + 2); // code after the closing */ (rare; usually empty)
    }
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) return;           // full-line // comment
    if (trimmed.startsWith('*')) return;            // JSDoc continuation (or */ … *-prefixed)
    if (trimmed.startsWith('/*')) {
      // a block START on this line
      const end = line.indexOf('*/', line.indexOf('/*') + 2);
      if (end === -1) { inBlock = true; return; }   // block opens, doesn't close → enter block, skip
      line = line.slice(end + 2);                   // inline /* … */ → check the remainder
      if (!line.trim()) return;
    }
    // (note: trailing // comments on a code line are NOT stripped — verified no such line in src/
    //  contains a forbidden literal today; document as a known limitation.)
    const hits = findLineViolations(line);
    for (const literal of hits) violations.push({ file: relPath, line: idx + 1, literal });
  });
  return violations;
}
```

**Recursive walker (skip test files + the guard's own file):**
```ts
const TEST_SUFFIXES = ['_test.go', '.test.ts', '.spec.ts'];
const OWN_FILE = basename(fileURLToPath(import.meta.url)); // commit-identity-guard.test.ts

function walk(dir: string, ext: '.ts' | '.go', acc: { files: string[]; violations: Violation[] }): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, ext, acc);
    else if (entry.isFile() && extname(entry.name) === ext) {
      if (TEST_SUFFIXES.some(s => entry.name.endsWith(s))) continue; // skip tests
      if (entry.name === OWN_FILE) continue;                          // skip the guard itself
      acc.files.push(abs);
      acc.violations.push(...scanFileContent(abs, relative(REPO_ROOT, abs)));
    }
  }
}
```

**The two describe blocks:**

```ts
describe('commit-identity-guard > detector', () => {
  // Proves the detector FIRES on forbidden literals + ignores comments/benign code.
  it('flags a Co-Authored-By string literal', () => {
    expect(findLineViolations('const trailer = "Co-Authored-By: Claude"')).toContain('Co-Authored-By');
  });
  it('flags coauthor case-insensitively', () => {
    expect(findLineViolations('x(COAUTHOR)')).toHaveLengthGreaterThan(0);
  });
  it('flags noreply@anthropic.com', () => {
    expect(findLineViolations('return "Claude <noreply@anthropic.com>"')).toContain('noreply@anthropic.com');
  });
  it('flags a GIT_COMMITTER_NAME env literal', () => {
    expect(findLineViolations("process.env.GIT_COMMITTER_NAME = 'bot'")).toContain('GIT_COMMITTER_NAME');
  });
  it('flags a shell-form git config user.name write', () => {
    expect(findLineViolations('await exec("git config user.name bot")')).toContain('user.name');
  });
  it('flags an array-form [config, user.email] write', () => {
    expect(findLineViolations("git(['config', 'user.email', 'bot@x.com'])")).toContain('user.email');
  });
  it('does NOT flag benign config (core.editor)', () => {
    expect(findLineViolations('git config core.editor vim')).toEqual([]);
  });
  it('does NOT flag npm test / plain code', () => {
    expect(findLineViolations('await run("npm test")')).toEqual([]);
    expect(findLineViolations('')).toEqual([]);
  });
});

describe('commit-identity-guard > self-source-scan (PRD §9.10.2)', () => {
  it('reports ZERO forbidden identity literals across production src/ (+cmd/ if present)', () => {
    const acc: { files: string[]; violations: Violation[] } = { files: [], violations: [] };
    walk(SRC_DIR, '.ts', acc);
    walk(CMD_DIR, '.go', acc); // no-op today (cmd/ absent); future-proofs
    // Prevent a vacuous pass from a path-resolution bug:
    expect(acc.files.length, 'must visit > 0 production files (path-resolution sanity)').toBeGreaterThan(0);
    // The headline assertion — zero forbidden hits:
    expect(acc.violations).toEqual([]);
    // (On failure, print every violation with file:line:literal for fast triage:)
    if (acc.violations.length) {
      console.error(acc.violations.map(v => `${v.file}:${v.line}: ${v.literal}`).join('\n'));
    }
  });
});
```
(`Violation = { file: string; line: number; literal: string }`. Adjust matcher helper names to taste;
`toHaveLengthGreaterThan` may need `expect.arrayContaining`/`expect(...).not.toEqual([])` if vitest
lacks that matcher — use `expect(findLineViolations(...).length).toBeGreaterThan(0)`.)

### Success Criteria
- [ ] `tests/unit/guards/commit-identity-guard.test.ts` exists; `tests/unit/guards/` dir created.
- [ ] Self-source-scan walks `src/` `.ts` (+`cmd/` `.go` if present), skips `_test.go`/`.test.ts`/
      `.spec.ts` + the guard's own file, skips comment lines (`//`, `*`-prefixed, inside `/* */`).
- [ ] Self-source-scan asserts `violations === []` AND `filesVisited > 0` on the current tree.
- [ ] The 13 verified comment-line citations in src/ are NOT flagged (no false failure).
- [ ] `describe('detector')` proves the detector FIRES on `Co-Authored-By`, `coauthor`(case-insens),
      `noreply@anthropic.com`, `GIT_COMMITTER_NAME`, `git config user.name`, `['config','user.email']`;
      and does NOT flag `git config core.editor` / `npm test` / empty.
- [ ] Header JSDoc documents FR-39a discipline + cites §9.10.2.
- [ ] `git diff --name-only` = EXACTLY `tests/unit/guards/commit-identity-guard.test.ts`.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the
single new file's full structure (imports, REPO_ROOT resolution, the pure detector, the comment-skip
state machine, the recursive walker, both describe blocks), the verified list of 13 comment-line
citations that MUST be skipped (so the implementer can confirm the comment logic against real data),
the proof that cmd/ is absent today (conditional walk), the path-resolution-via-`import.meta.url`
pattern (from prp-template-validation.test.ts), the vitest runner + coverage-floor facts, and the
"fires when injected" strategy (synthetic detector unit tests, not tree mutation). See
`research/commit-identity-guard-strategy.md` for per-claim evidence.

### Documentation & References
```yaml
# MUST READ — PRD §9.10.2 (the contract this guard implements)
- docfile: spec/ (§9.10.2 "Commit-Identity Structural Guard" — the "Requirement — structural enforcement (self-source-scan test)" + acceptance criteria)
  why: Defines the EXACT forbidden-literal classes, the skip rules (test files + own file + comment lines), the "fires when injected" acceptance criterion, and the ">0 files visited" anti-vacuous-pass requirement.
  critical: Comment lines (//, /* … */, *-prefixed JSDoc) are skipped so doc citations don't self-trip; the guard targets CALL-SITE string literals, not bare substrings in comments.

# MUST READ — this subtask's research (the 13 verified comment citations + the design)
- docfile: plan/015_459c7d9be558/P1M3T1S1/research/commit-identity-guard-strategy.md
  section: "1. current src/ PROVES comment-skip is load-bearing (VERIFIED 13 citations)", "2. cmd/ absent", "3. Test infra", "4. detector contract", "5. fires-when-injected (no tree mutation)", "6. header DOCS", "7. validation", "8. disjointness"
  why: The exact file:line table of the 13 comment-line citations the guard must skip; the cmd/-absent fact; the vitest/coverage-floor facts; the path-resolution pattern; the detector design (pure fn + 2 describe blocks); the synthetic-unit-test approach to "fires when injected".

# THE PRODUCTION CODE THE GUARD WALKS (read-only — the behavioral fix is already done here)
- file: src/utils/git-commit.ts
  why: READ-ONLY. formatCommitMessage (227-246) — confirmed: strips [PRP Auto], layers task-prefix, NO trailer. The guard walks this file (and all src/); its 10 comment-line citations (206/208/239/240/303/393/726/727/859/860) MUST be skipped by the comment logic.
  pattern: "return withPrefix;  // (no Co-Authored-By trailer — the behavioral fix). The 10 *-prefixed + //-prefixed lines ABOVE citing the removed literal are the comment-skip test data."

# THE PATTERN FILE for path resolution (mirror its fileURLToPath/dirname/join approach)
- file: tests/unit/prp-template-validation.test.ts
  why: The established pattern for resolving repo-relative paths from a test file: fileURLToPath(import.meta.url) + dirname + join. Use it for REPO_ROOT (3 levels up from tests/unit/guards/) — NOT process.cwd() (cwd-based resolution is exactly the path bug the >0 assertion exists to catch).
  pattern: "import { readFileSync } from 'node:fs'; import { fileURLToPath } from 'node:url'; import { dirname, join } from 'node:path';"

# THE WALKED DIRS (read-only)
- file: src/   # walk all .ts production files (the headline surface)
- file: cmd/   # ABSENT today; the walk is wrapped in existsSync(cmd) so it future-proofs for .go without breaking filesVisited>0

# COVERAGE CONFIG (confirms the new test file is excluded from coverage measurement)
- file: vitest.config.ts
  why: coverage is a FLOOR (~90%), NOT 100% (L39-53); tests are EXCLUDED from measurement (exclude: ['**/*.test.ts', '**/*.spec.ts']). So the new guard file has NO coverage obligation; the gate is the test passing + lint/format clean.

# THE SURVEY (context — the test-suite state this guard joins)
- docfile: plan/015_459c7d9be558/architecture/commit-tests-survey.md
  section: "Cross-Cutting Summary > Co-Authored-By Trailer Inversion (§9.10.2)"
  why: Confirms NO self-source-scan test exists today (the gap this task closes) and maps the test-suite state.

# PARALLEL-SIBLING CONTRACT (disjoint — no conflict)
- docfile: plan/015_459c7d9be558/P1M2T3S2/PRP.md
  why: In-flight previous. Edits OTHER test files (deletes commit-message-agent.test.ts; rewires git-commit-generate.test.ts; cleans protected-files.test.ts). This task CREATES a new file (tests/unit/guards/commit-identity-guard.test.ts) — ZERO overlap. No merge conflict.
```

### Current Codebase tree (relevant slice)
```bash
src/utils/git-commit.ts                      # READ-ONLY — walked; formatCommitMessage (227-246) is the done behavioral fix; 10 comment citations to skip
src/tools/git-mcp.ts                         # READ-ONLY — walked; 2 comment citations (673-674) to skip
src/cli/commands/config.ts                   # READ-ONLY — walked; 1 comment citation (291) to skip
cmd/                                         # ABSENT — the .go walk is conditional (existsSync)
tests/unit/guards/                           # NEW dir (create) — guard lives here
tests/unit/guards/commit-identity-guard.test.ts  # NEW — this task's deliverable
tests/unit/prp-template-validation.test.ts   # READ-ONLY pattern — fileURLToPath/dirname/join path resolution
vitest.config.ts                             # READ-ONLY — coverage floor (~90%); tests excluded from measurement
```

### Desired Codebase tree with files to be added
```bash
tests/unit/guards/commit-identity-guard.test.ts   # NEW — the self-source-scan guard (header JSDoc + pure detector + walker + 2 describe blocks)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — The comment-skip rule is LOAD-BEARING. 13 comment-line citations of the incident survive
//   in src/ (10 in git-commit.ts, 2 in git-mcp.ts, 1 in config.ts — all *-prefixed JSDoc or //).
//   WITHOUT the skip logic the guard false-trips on its own doc citations. Verify against the table
//   in research §1: every match must be skipped; zero non-comment matches must exist today.

// CRITICAL — Resolve REPO_ROOT from import.meta.url (fileURLToPath + dirname + 3× ..), NOT process.cwd().
//   The PRD's ">0 files visited" assertion exists to catch a path-resolution bug; using cwd defeats it
//   (cwd is whatever the runner was invoked from). Mirror prp-template-validation.test.ts.

// CRITICAL — The cmd/ walk is CONDITIONAL. cmd/ does NOT exist today (verified). Wrap in
//   if (existsSync(CMD_DIR)) walk(CMD_DIR, '.go', acc); so it future-proofs without breaking
//   filesVisited > 0 (src/ alone satisfies it).

// CRITICAL — The detector must be a PURE function (findLineViolations(line)) shared by BOTH describe
//   blocks. The describe('detector') block feeds it SYNTHETIC positive/negative lines (NOT a mutated
//   tree) to prove "fires when injected" deterministically. Mutating the real src/ at test time is
//   flaky + dangerous — don't.

// CRITICAL — user.name/user.email detection requires git-config CONTEXT. Do NOT flag a bare user.name
//   in a comment or unrelated code. Match the shell form (git config user.name) OR the array form
//   (['config', 'user.name']). A bare user.name in a JSDoc is already skipped by the comment rule, but
//   a non-comment bare user.name (rare) should NOT be flagged unless it's in a config call. The two
//   CONFIG_WRITE regexes encode this precisely.

// CRITICAL — trailer tokens (Co-Authored-By / Co-Authored / coauthor) are case-INSENSITIVE; the env
//   literals (GIT_AUTHOR_*/GIT_COMMITTER_*) are EXACT (they're env-var names). The cargo-cult strings
//   are matched as written (noreply@anthropic.com case-insensitive is fine; the emoji/bracket strings
//   verbatim). Don't lowercase the env literals or you'd false-match e.g. a comment `git_author_name`.

// GOTCHA — vitest may not have toHaveLengthGreaterThan; use expect(arr.length).toBeGreaterThan(0) or
//   expect(arr).not.toEqual([]). Prefer the explicit .length check.

// GOTCHA — Trailing // comments on a CODE line (e.g. `const x = 1; // Co-Authored-By`) are NOT
//   stripped by the comment-skip state machine (it only skips FULL comment lines + block contents).
//   VERIFIED: no such line exists in the current src/ tree (all 13 matches are full comment lines).
//   Document this as a known limitation in the header JSDoc; if a future false-positive appears, strip
//   from the first unquoted //. Do NOT over-engineer a string-aware lexer now.

// GOTCHA — coverage is a FLOOR (~90%), NOT 100%, and tests are EXCLUDED from measurement. The new
//   guard file has NO coverage obligation. Gate = the test passing + lint/format clean.

// GOTCHA — Block-comment state must be tracked ACROSS lines: a /* on line N that doesn't close until
//   line N+k means lines N+1..N+k-1 are inside the block and skipped. Handle the /* … */ on the SAME
//   line (inline) too. The scanFileContent state machine in the What section encodes this.

// GOTCHA — Skip the guard's OWN file by basename (commit-identity-guard.test.ts) — it contains the
//   forbidden literals as TEST FIXTURES (the positive cases), which would self-trip otherwise. (It
//   also ends in .test.ts so the test-suffix skip catches it first; belt-and-suspenders both.)

// GOTCHA — Do NOT run the full `npm run test:run` as the semantic gate (orthogonal pre-existing
//   failures per the survey — e.g. M1.T3 collateral). Gate on the new guard file + typecheck/lint/
//   format. typecheck excludes tests/ but lint/format include .ts test files.

// CRITICAL — NO production (src/) changes. This is a guard TEST only. git diff --name-only must be
//   EXACTLY tests/unit/guards/commit-identity-guard.test.ts.
```

---

## Implementation Blueprint

### Data models and structure
No runtime data models. The "structure" is the test file's local types + helpers:
- `type Violation = { file: string; line: number; literal: string };`
- the forbidden-literal regex/string constants (TRAILER_TOKENS, CARGO_CULT, IDENTITY_ENV, CONFIG_WRITE);
- the pure `findLineViolations(line): string[]`;
- `scanFileContent(absPath, relPath): Violation[]` (comment-skip state machine);
- `walk(dir, ext, acc)` (recursive, skip test suffixes + own file);
- REPO_ROOT/SRC_DIR/CMD_DIR resolution via `import.meta.url`.

### Implementation Tasks (ordered)
```yaml
Task 1: CREATE tests/unit/guards/commit-identity-guard.test.ts  (the whole guard)
  - HEADER JSDoc: document the FR-39a-style discipline + cite PRD §9.10.2 "structural enforcement
    (self-source-scan test)". State the walk surface (src/ .ts + cmd/ .go if present), the skips
    (test suffixes + own file + comment lines), the forbidden classes, the >0-files assertion, and
    the known limitation (trailing //-comment on a code line is not stripped).
  - IMPORTS: vitest (describe/expect/it); node:fs (readdirSync/readFileSync/existsSync);
    node:path (join/relative/extname/basename/dirname/resolve); node:url (fileURLToPath).
  - REPO_ROOT resolution: fileURLToPath(import.meta.url) → dirname → resolve(__dirname, '../../..').
    SRC_DIR = join(REPO_ROOT,'src'); CMD_DIR = join(REPO_ROOT,'cmd').
  - CONSTANTS: the 4 forbidden-literal arrays (TRAILER_TOKENS case-insens; CARGO_CULT; IDENTITY_ENV
    exact; CONFIG_WRITE two regexes for shell + array forms). Violation type.
  - PURE DETECTOR findLineViolations(line): iterate the 4 classes, collect hits, return string[].
  - COMMENT-SKIP STATE MACHINE scanFileContent(absPath, relPath): readFileSync → split('\n') →
    forEach line with inBlock state (see the What section's verbatim algorithm) → for non-comment
    lines call findLineViolations → push Violation{file:relPath, line:idx+1, literal}.
  - WALKER walk(dir, ext, acc): readdirSync withFileTypes → recurse dirs → for files of `ext`, skip
    TEST_SUFFIXES + OWN_FILE basename → push to acc.files + scanFileContent into acc.violations.
  - describe('commit-identity-guard > detector'): ≥8 it cases (positive: Co-Authored-By string,
    coauthor case-insens, noreply@anthropic.com, GIT_COMMITTER_NAME, git config user.name,
    ['config','user.email']; negative: git config core.editor, npm test, empty).
  - describe('commit-identity-guard > self-source-scan (PRD §9.10.2)'): walk(SRC_DIR,'.ts',acc) +
    walk(CMD_DIR,'.go',acc); expect(acc.files.length).toBeGreaterThan(0); expect(acc.violations).toEqual([]);
    on failure console.error the file:line:literal list.
  - PLACEMENT: tests/unit/guards/commit-identity-guard.test.ts (create the guards/ dir).
  - EXPECTED: both describe blocks GREEN. The self-source-scan's violations==[] holds because the 13
    citations are comment lines (skipped) and there are zero non-comment matches today.

Task 2: FORMAT + VERIFY
  - RUN: npm run fix            # prettier --write + eslint --fix (the new .ts test file)
  - RUN: npm run lint           # eslint . --ext .ts — clean (the test file passes)
  - RUN: npm run format:check   # prettier --check — clean
  - (npm run typecheck excludes tests/ — unaffected; run project-wide only if the session requires.)
  - RUN: npx vitest run tests/unit/guards/commit-identity-guard.test.ts   # BOTH describe blocks GREEN.
  - VERIFY the "fires when injected" property structurally: the describe('detector') positive cases
    are the proof (no tree mutation needed).
  - VERIFY comment-skip: temporarily confirm (read-only, NOT committed) that the 13 src/ citations
    are comment lines — the self-source-scan passing IS that confirmation.
  - RUN: git diff --name-only   # EXACTLY tests/unit/guards/commit-identity-guard.test.ts.
  - DO NOT run the full npm run test:run as the semantic gate (orthogonal pre-existing failures).
  - DO NOT edit any src/ file.
  - EXPECTED: lint/format clean; the guard file green; exactly one new file in the diff.
```

### Implementation Patterns & Key Details
```ts
// ---- REPO_ROOT (path-resolution-bug-proof; mirror prp-template-validation.test.ts) ----
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative, extname, basename } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '../../..');   // tests/unit/guards/ → repo root
const SRC_DIR = join(REPO_ROOT, 'src');
const CMD_DIR = join(REPO_ROOT, 'cmd');

// ---- the pure detector (shared by both describe blocks) ----
const TRAILER_TOKENS = [/co-authored-by/i, /co-authored/i, /coauthor/i];
const CARGO_CULT = [/noreply@anthropic\.com/i, /Generated with \[Claude Code\]/, /🤖 Generated/];
const IDENTITY_ENV = ['GIT_AUTHOR_NAME','GIT_AUTHOR_EMAIL','GIT_AUTHOR_DATE',
                      'GIT_COMMITTER_NAME','GIT_COMMITTER_EMAIL','GIT_COMMITTER_DATE'];
const CONFIG_WRITE = [/\bgit\s+config\s+user\.(name|email)\b/i,
                      /\[\s*['"]config['"]\s*,\s*['"]user\.(name|email)['"]\s*\]/];

function findLineViolations(line: string): string[] {
  const hits: string[] = [];
  for (const re of TRAILER_TOKENS) { const m = line.match(re); if (m) hits.push(m[0]); }
  for (const re of CARGO_CULT) { const m = line.match(re); if (m) hits.push(m[0]); }
  for (const name of IDENTITY_ENV) { if (line.includes(name)) hits.push(name); }
  for (const re of CONFIG_WRITE) { const m = line.match(re); if (m) hits.push(`user.${m[1]}`); }
  return hits;
}

// ---- comment-skip state machine (per file) ----
function scanFileContent(absPath: string, relPath: string): Violation[] {
  const violations: Violation[] = [];
  const lines = readFileSync(absPath, 'utf8').split('\n');
  let inBlock = false;
  lines.forEach((raw, idx) => {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) return;
      inBlock = false;
      line = line.slice(end + 2);
    }
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) return;
    if (trimmed.startsWith('*')) return;
    if (trimmed.startsWith('/*')) {
      const start = line.indexOf('/*');
      const end = line.indexOf('*/', start + 2);
      if (end === -1) { inBlock = true; return; }
      line = line.slice(end + 2);
      if (!line.trim()) return;
    }
    for (const literal of findLineViolations(line))
      violations.push({ file: relPath, line: idx + 1, literal });
  });
  return violations;
}

// ---- the headline assertion ----
it('reports ZERO forbidden identity literals across production src/ (+cmd/ if present)', () => {
  const acc = { files: [] as string[], violations: [] as Violation[] };
  walk(SRC_DIR, '.ts', acc);
  walk(CMD_DIR, '.go', acc); // no-op today (cmd/ absent)
  expect(acc.files.length, 'must visit > 0 production files').toBeGreaterThan(0);
  expect(acc.violations).toEqual([]);
  if (acc.violations.length)
    console.error(acc.violations.map(v => `${v.file}:${v.line}: ${v.literal}`).join('\n'));
});
```

### Integration Points
```yaml
NEW TEST (tests/unit/guards/commit-identity-guard.test.ts):
  - resolves REPO_ROOT from import.meta.url (NOT cwd); walks src/ .ts (+ cmd/ .go if existsSync).
  - skips _test.go/.test.ts/.spec.ts + the guard's own basename + comment lines.
  - pure findLineViolations + comment-skip state machine + recursive walker.
  - 2 describe blocks: detector (synthetic positive/negative) + self-source-scan (real tree, zero violations, >0 files).

NO CHANGES TO (hard boundary):
  - src/ (NO production changes — the behavioral fix is already done at git-commit.ts:227-246).
  - any existing test file (P1.M2.T3.S2 owns those; P1.M3.T2.S1 owns git-commit.test.ts behavioral inversion).
  - PRD.md/spec/* (human-owned), tasks.json, prd_snapshot.md, PROMPTS.md.

PERMANENT CI GATE (the guard's value):
  - Once merged, any future PR introducing a forbidden identity literal into production source FAILS
    the build (this test). That is the §9.10.2 structural backstop.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # prettier --write + eslint --fix on the new .ts test file
npm run lint           # eslint . --ext .ts — clean
npm run format:check   # prettier --check — clean
# (npm run typecheck excludes tests/ — unaffected. Run project-wide only if the session requires.)
# Expected: all clean. Likely failure: a prettier/eslint nit (re-run `npm run fix`).
```

### Level 2: The Guard Test (Component Validation)
```bash
# The new guard — BOTH describe blocks MUST be GREEN:
npx vitest run tests/unit/guards/commit-identity-guard.test.ts
# Expected: detector block green (≥8 cases); self-source-scan block green (violations==[] + filesVisited>0).
# If self-source-scan FAILS with violations → either (a) a real forbidden literal landed in a non-comment
#   src/ line (investigate — the printed file:line:literal pinpoints it), or (b) the comment-skip logic
#   is wrong (one of the 13 citations is being scanned as code — check scanFileContent's inBlock/startswith rules).
# If filesVisited === 0 → REPO_ROOT resolution is wrong (check the resolve(__dirname,'../../..') depth).
# If a detector positive case FAILS → the regex/literal is wrong (check CONFIG_WRITE / TRAILER_TOKENS).
```

### Level 3: Regression / Single-File Confirmation
```bash
git diff --name-only    # Expected: EXACTLY tests/unit/guards/commit-identity-guard.test.ts
# Confirm no stray src/ edit:
git diff --name-only | grep -E '^src/|PRD.md|spec/|tasks.json|prd_snapshot.md' && echo "STRAY EDIT — ABORT" || echo "scope OK"
# Expected: "scope OK" (only the new test file).
# Confirm the guard will catch a regression (read-only sanity, NOT committed): mentally trace that
# findLineViolations('const t = "Co-Authored-By: x"') → ['Co-Authored-By'] (covered by the detector unit test).
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP (a static self-source-scan). Domain reasoning (record in commit message):
#   1. The guard is the §9.10.2 STRUCTURAL backstop — the hardcoded Co-Authored-By bug (incident 1) cannot
#      regress without failing this build.
#   2. Comment-skipping is verified against 13 real src/ citations (10 git-commit.ts + 2 git-mcp.ts +
#      1 config.ts) — all are *-prefixed JSDoc or //-prefixed; none are flagged.
#   3. The "fires when injected" acceptance criterion is satisfied by the describe('detector') unit block
#      (synthetic positive lines) — no flaky tree mutation.
#   4. The >0-files-visited assertion prevents a vacuous pass from a path-resolution bug (REPO_ROOT via
#      import.meta.url, not cwd).
#   5. The cmd/ walk is conditional (cmd/ absent today); future-proofs for a Go binary without breaking
#      the filesVisited>0 assertion (src/ alone satisfies it).
#   6. No production code changed — pure structural guard.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/guards/commit-identity-guard.test.ts` GREEN (both describe blocks).
- [ ] `git diff --name-only` = EXACTLY `tests/unit/guards/commit-identity-guard.test.ts`.

### Feature Validation
- [ ] Self-source-scan walks `src/` `.ts` (+`cmd/` `.go` if present); skips test suffixes + own file + comments.
- [ ] Self-source-scan asserts `violations === []` AND `filesVisited > 0` on the current tree.
- [ ] The 13 comment-line citations are NOT flagged (comment-skip verified).
- [ ] `describe('detector')` FIRES on Co-Authored-By / coauthor(case-insens) / noreply@anthropic.com /
      GIT_COMMITTER_NAME / `git config user.name` / `['config','user.email']`; does NOT flag
      `git config core.editor` / `npm test` / empty.

### Code Quality Validation
- [ ] REPO_ROOT resolved from `import.meta.url` (not `process.cwd()`).
- [ ] `findLineViolations` is pure + shared by both describe blocks.
- [ ] Comment-skip state machine handles full-line `//`, `*`-prefixed JSDoc, and `/* … */` blocks
      (multi-line + inline).
- [ ] `user.name`/`user.email` detection requires git-config context (shell or array form), not bare.
- [ ] Trailer tokens case-insensitive; env literals exact; cargo-cult strings as written.
- [ ] Header JSDoc documents FR-39a discipline + cites §9.10.2.

### Documentation & Deployment
- [ ] No `src/` changes; no PRD.md/spec/*/tasks.json/prd_snapshot.md/PROMPTS.md changes.
- [ ] No new env var.
- [ ] Commit message records: §9.10.2 structural guard; the 13 comment-citations-verified baseline;
      the pure-detector + synthetic-unit-test approach to "fires when injected"; the import.meta.url
      path resolution; the cmd/ conditional walk; the permanent-CI-gate value.

---

## Anti-Patterns to Avoid

- ❌ Don't edit `src/`. The behavioral fix is already done (`formatCommitMessage`, git-commit.ts:227-246).
      This task is a guard TEST only. `git diff --name-only` must be the one new test file.
- ❌ Don't resolve REPO_ROOT from `process.cwd()`. cwd is whatever invoked the runner; the PRD's
      `>0 files visited` assertion exists precisely to catch a path-resolution bug, and cwd-based
      resolution defeats it. Use `fileURLToPath(import.meta.url)` + `dirname` + `resolve(__dirname, '../../..')`.
- ❌ Don't skip the comment-line logic. 13 comment-line citations of the incident survive in src/;
      without the `//` / `*` / `/* … */` skip rules the guard false-trips on its own doc citations.
      Verify against the research §1 table.
- ❌ Don't mutate the real src/ tree to prove "fires when injected." That's flaky + dangerous. Prove it
      with a `describe('detector')` unit block feeding the PURE detector synthetic positive/negative lines.
- ❌ Don't flag bare `user.name`/`user.email`. The PRD requires git-config CONTEXT — shell form
      (`git config user.name`) or array form (`['config', 'user.name']`). A bare `user.name` in a
      comment is already skipped; a bare `user.name` in non-comment code (rare) must NOT be flagged
      without the config proximity. The two CONFIG_WRITE regexes encode this.
- ❌ Don't lowercase the env literals (`GIT_AUTHOR_*` etc.). They're exact env-var names; case-sensitive
      matching avoids false-matching comment text like `git_author_name`. (Trailer tokens ARE
      case-insensitive; cargo-cult/env are not.)
- ❌ Don't forget to skip the guard's OWN file. It contains the forbidden literals as test fixtures
      (the positive cases) — it would self-trip. (The `.test.ts` suffix skip catches it first; add the
      basename skip as belt-and-suspenders.)
- ❌ Don't make the cmd/ walk unconditional. `cmd/` is ABSENT today; wrap in `if (existsSync(CMD_DIR))`
      so the `filesVisited > 0` assertion holds from `src/` alone (it would fail if the only walked dir
      were an absent `cmd/`).
- ❌ Don't run the full `npm run test:run` as the semantic gate (orthogonal pre-existing failures per
      the survey). Gate = the new guard file + lint/format. typecheck excludes tests/; lint/format
      include `.ts` test files.
- ❌ Don't over-engineer a string-aware lexer for trailing `//` comments. Verified: no src/ code line
      has a trailing `//` comment containing a forbidden literal today (all 13 matches are full comment
      lines). Document the limitation in the header JSDoc; ship the simpler full-line-skip state machine.
- ❌ Don't conflate this guard with the behavioral-test inversion (P1.M3.T2.S1). This task = the
      STRUCTURAL backstop (walks all production src/). T2.S1 = the BEHAVIORAL assertion
      (`formatCommitMessage` output has no trailer, in `git-commit.test.ts`). Different files, disjoint.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a single, self-contained new test file with no production-code change and no
coverage obligation (tests are excluded from measurement; coverage is a floor). The detector contract,
the comment-skip state machine, the recursive walker, the REPO_ROOT resolution, and both describe
blocks are specified verbatim. The non-obvious traps are documented with verified evidence: (1) the 13
comment-line citations that MUST be skipped (the exact file:line table — the comment logic is
testable against real data); (2) cmd/ is absent → conditional walk; (3) REPO_ROOT via
`import.meta.url` not cwd; (4) "fires when injected" via synthetic detector unit tests (no tree
mutation); (5) `user.name`/`user.email` requires git-config context; (6) env literals exact, trailer
tokens case-insensitive; (7) skip the guard's own file; (8) no trailing-`//`-comment stripping needed
(verified baseline). The path-resolution + walker + detector patterns are quoted from the existing
`prp-template-validation.test.ts`. The work is file-disjoint from the parallel P1.M2.T3.S2 (other test
files) and from P1.M3.T2.S1 (`git-commit.test.ts`). Residual risks: (a) a vitest matcher name
(`toHaveLengthGreaterThan` — mitigated: use `.length).toBeGreaterThan(0)`); (b) a prettier/eslint nit
on the new file (auto-fixed via `npm run fix`); (c) the comment-skip state machine missing an edge
case (mitigated: verified against the 13 real citations + the `describe('detector')` block proves the
non-comment path). No runtime/network/LLM unknowns — a static self-source-scan + in-process assertions.