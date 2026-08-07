# PRP — P1.M1.T2.S1: Integration test for `getRecentCommitMessages` (real simple-git, temp repo)

> Bugfix 001, **regression-prevention test** (TEST_RESULTS.md Recommendation #2). BUG-001 was a critical
> default-config-breaking bug (`getRecentCommitMessages` passed simple-git `{ maxEntries }` instead of
> `{ maxCount }`) that CI missed because the unit test asserted the broken contract against an
> arg-ignoring `vi.fn` mock. S1 fixed the source (`maxCount`); S2 (parallel) fixes the unit assertion.
> **T2.S1 adds the integration test that calls the REAL simple-git against a throwaway temp git repo**,
> so an invalid option name fails the build instead of being masked. Test-only — no source/docs change.

---

## Goal

**Feature Goal**: Create an integration test that exercises `getRecentCommitMessages` end-to-end against
a REAL git repo (real `simple-git`, no mocks), proving the function uses a valid `log()` option and
returns commit messages newest-first. If the source ever reverts to an invalid option (`maxEntries`),
the real `git log` throws `fatal: ambiguous argument…` and this test FAILS — the regression net the
unit-test mock could not provide.

**Deliverable**: **`tests/integration/git-mcp-log.test.ts`** (NEW) — three test cases against a shared
seeded temp git repo (5 commits): `count < total` (3 of 5), `count === total` (5 of 5), and
`count === 0` (short-circuit → `[]`). Real `simpleGit` for setup (init/add/commit); real
`getRecentCommitMessages` under test. **No `vi.mock` of `simple-git` or `git-mcp.js`.**

**Success Definition**:
- `getRecentCommitMessages(3, dir)` returns the 3 NEWEST commit messages, newest-first.
- `getRecentCommitMessages(5, dir)` returns all 5, newest-first.
- `getRecentCommitMessages(0, dir)` returns `[]` (short-circuit; no git call).
- The test uses the REAL simple-git + REAL `getRecentCommitMessages` (no mocks) — so an invalid `log()`
  option would throw and fail the test (the regression-catching property).
- `npx vitest run tests/integration/git-mcp-log.test.ts` is GREEN; `npm run lint && npm run format:check` clean.
- **No source/config/docs files modified.** (S1 owns the source fix; S2 owns the unit assertion.)

---

## Why

- **Closes the CI blind spot that let BUG-001 ship.** The unit test mocked `simpleGit` → an object whose
  `.log` was a bare `vi.fn()` ignoring its argument, so it passed while the source used the wrong option
  name. A real-git integration test cannot be fooled this way: an invalid option makes real `git log`
  throw. This is the exact defense TEST_RESULTS.md Recommendation #2 requests.
- **Validates the FIXED source end-to-end.** S1 corrected `maxEntries` → `maxCount`. This test proves
  the fix works against a real repo (not just against a corrected mock assertion) — newest-first
  ordering, full-message extraction, the `count === 0` short-circuit.
- **Hermetic + isolated.** The temp repo lives in the OS tmpdir (outside the project); the test seeds
  its own commits with its own git identity. It never touches the project's git state.
- **Scope discipline.** T2.S1 = the helper-level real-git integration test. S1 = source fix (Complete).
  S2 = unit-assertion fix (parallel, different file). T2.S2 = end-to-end `generateCommitMessage`-under
  `auto` test (next). No overlap.

---

## What

### User-visible behavior
None (test-only). No user/config/API/runtime surface change (the item's "DOCS: none").

### Technical requirements (exact contract)

**File — `tests/integration/git-mcp-log.test.ts`** (NEW). Structure:

**Imports** (NO `vi.mock` anywhere):
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { simpleGit } from 'simple-git';                              // REAL — for setup
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getRecentCommitMessages } from '../../src/tools/git-mcp.js'; // REAL — under test
```

**Shared setup** — `beforeEach` creates + inits + configures + seeds a 5-commit repo; `afterEach`
cleans up:
```ts
let dir: string;
// Seeded in chronological order; commit 5 is the NEWEST (git log is newest-first).
const MSGS = ['commit 1', 'fix: commit 2', 'docs: commit 3', 'refactor: commit 4', 'feat: commit 5'];
// NEWEST-FIRST expected order: ['feat: commit 5', 'refactor: commit 4', 'docs: commit 3', 'fix: commit 2', 'commit 1']

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'git-log-test-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');   // hermetic — don't rely on global git config
  await git.addConfig('user.name', 'Test');
  for (let i = 0; i < MSGS.length; i++) {
    writeFileSync(join(dir, `file${i}.txt`), `content ${i}\n`);
    await git.add('.');
    await git.commit(MSGS[i]);
  }
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});
```

**Three test cases** (the contract's count < total / count === total / count === 0):
```ts
describe('getRecentCommitMessages — real simple-git against a temp git repo', () => {
  it('returns the N newest commit messages, newest-first (count < total: 3 of 5)', async () => {
    const result = await getRecentCommitMessages(3, dir);
    expect(result).toEqual(['feat: commit 5', 'refactor: commit 4', 'docs: commit 3']);
  });

  it('returns all commits newest-first when count === total (5 of 5)', async () => {
    const result = await getRecentCommitMessages(5, dir);
    expect(result).toEqual([
      'feat: commit 5', 'refactor: commit 4', 'docs: commit 3', 'fix: commit 2', 'commit 1',
    ]);
  });

  it('returns [] for count === 0 (short-circuit, no git call)', async () => {
    const result = await getRecentCommitMessages(0, dir);
    expect(result).toEqual([]);
  });
});
```

### Success Criteria
- [ ] File `tests/integration/git-mcp-log.test.ts` created; vitest glob (`tests/**/*.{test,spec}.ts`) picks it up.
- [ ] NO `vi.mock` of `'simple-git'` or `'../../src/tools/git-mcp.js'` (the whole point — real lib).
- [ ] Shared `beforeEach` seeds a real 5-commit repo (init + addConfig + 5× write/add/commit); `afterEach` rmSync.
- [ ] `count < total` (3 of 5) → the 3 newest messages, newest-first.
- [ ] `count === total` (5 of 5) → all 5, newest-first.
- [ ] `count === 0` → `[]`.
- [ ] `npx vitest run tests/integration/git-mcp-log.test.ts` GREEN; `npm run lint && npm run format:check` clean.
- [ ] No source/config/docs files modified.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the verbatim
test file (imports + setup + 3 cases), the verified fact that `validateRepositoryPath` accepts an
external tmpdir (so NO mock is needed), the simple-git `log({ maxCount })` contract, the temp-repo
pattern from the architecture doc, the regression-catching rationale, and the executable validation
commands are all below.

### Documentation & References

```yaml
# MUST READ — the regression this test prevents + Recommendation #2
- docfile: plan/012_7dd502f7feb9/bugfix/001_662720d16c77/prd_snapshot.md   # (or TEST_RESULTS.md)
  section: "Recommendations" (item 2: "Add an integration test that calls the REAL simple-git (not a vi.fn mock) against a throwaway temp git repo")
  why: This test IS that recommendation. The bug report explains WHY the unit mock masked the bug.

# MUST READ — the test design + the validateRepositoryPath verification (authored with this PRP)
- docfile: plan/012_7dd502f7feb9/bugfix/001_662720d16c77/P1M1T2S1/research/real-simple-git-integration-test.md
  section: "3. CRITICAL verification — validateRepositoryPath accepts an external tmpdir" and "6. Test design" and "7. Why this catches the regression"
  why: Proves validateRepositoryPath is NOT project-scoped (external tmpdir passes — NO mock needed),
        the exact 3-case design, and why a source revert to maxEntries makes this test throw+fail.
        READ BEFORE IMPLEMENTING — it resolves the contract's path-restriction caution.

# MUST READ — the FIXED source this test consumes (S1, Complete)
- file: src/tools/git-mcp.ts
  why: getRecentCommitMessages (uses git.log({ maxCount: count }) post-S1) + validateRepositoryPath
        (accepts any path with .git — verified). The test imports getRecentCommitMessages UNCHANGED.
  pattern: "if (count === 0) return []; const safePath = await validateRepositoryPath(repoPath); const git = simpleGit(safePath); const logResult = await git.log({ maxCount: count }); return logResult.all.map(e => e.message);"

# PATTERN FILE — the temp-repo convention in this codebase
- file: tests/unit/config/hack-config.test.ts
  why: The mkdtempSync(join(tmpdir(),'prefix-')) + rmSync({recursive,true,force:true}) pattern. Mirror it.
  pattern: "dir = mkdtempSync(join(tmpdir(), 'hack-config-')); … rmSync(dir, { recursive: true, force: true });"

# VERIFIED FACTS
- fact: "validateRepositoryPath (src/tools/git-mcp.ts) does resolve → existsSync → .git check → realpathSync. NO project-scoping. An OS tmpdir with a real .git (from git init) PASSES. Do NOT mock it."
- fact: "getRecentCommitMessages post-S1 uses git.log({ maxCount: count }). git.log returns .all newest-first; LogEntry.message is the (trimmed) message. An invalid option (maxEntries) makes git throw 'fatal: ambiguous argument…' → the await rejects → the test fails. (No separate doesNotThrow assertion needed.)"
- fact: "vitest.config.ts include glob = 'tests/**/*.{test,spec}.ts' → tests/integration/git-mcp-log.test.ts is picked up automatically."
- fact: "simple-git ^3.30.0 is installed; its LogOptions defines maxCount?: number (NO maxEntries). git.commit(msg) + git.add('.') + git.init() + git.addConfig(k,v) are the setup primitives."
- fact: "git commit requires user.name + user.email; set via addConfig after init (hermetic — CI may lack global config)."
- fact: "On macOS tmpdir() is /tmp → realpath /private/tmp; realpathSync handles this inside validateRepositoryPath. No test-side concern."
```

### Current Codebase tree (relevant slice)

```bash
tests/integration/git-mcp-log.test.ts   # NEW — real-simple-git integration test (3 cases)
src/tools/git-mcp.ts                    # READ-ONLY (S1's fixed getRecentCommitMessages — consumed unchanged)
tests/unit/tools/git-mcp.test.ts        # READ-ONLY in T2.S1 (S2 owns the unit-assertion fix)
```

### Desired Codebase tree with files to be added/edited

```bash
tests/integration/git-mcp-log.test.ts   # NEW (the ONLY file T2.S1 creates)
# No source/config/docs changes. No new files elsewhere.
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL — do NOT vi.mock('simple-git') and do NOT vi.mock('../../src/tools/git-mcp.js'). The
//   ENTIRE VALUE of this test is that the real simple-git runs against a real repo, so an invalid
//   log() option throws. Mocking either re-introduces the BUG-001 mask. (The contract's "mock
//   validateRepositoryPath only if strictly necessary" does NOT apply — see the next gotcha.)

// CRITICAL — validateRepositoryPath is NOT project-scoped (verified: resolve→existsSync→.git→realpath).
//   An OS tmpdir with a real .git passes. Do NOT mock validateRepositoryPath, do NOT use tests/tmp/,
//   do NOT add a passthrough. The contract's caution ("may require inside the project") is a false
//   alarm — confirmed against the implementation. The temp repo satisfies the validator directly.

// CRITICAL — git log is NEWEST-FIRST. If you seed commits 1,2,3,4,5 chronologically, the log returns
//   [5,4,3,2,1]. So getRecentCommitMessages(3) returns [msg5, msg4, msg3] (the 3 NEWEST), NOT the 3
//   oldest. Assert the expected arrays in newest-first order (see the test cases).

// GOTCHA — git commit requires user.name + user.email. Set them via addConfig('user.email',…) and
//   addConfig('user.name',…) AFTER init, BEFORE the first commit. (CI may have no global git identity;
//   setting it hermetically avoids a "Author identity unknown" failure.)

// GOTCHA — each commit needs ≥1 changed file. Write a UNIQUE file per commit (file0.txt, file1.txt, …)
//   so `git add('.')` has something to stage. Re-writing the same file works too, but unique files are
//   clearer and avoid any "nothing to commit" edge case.

// GOTCHA — simple-git's LogEntry.message is the commit message; for single-line commits it's the
//   trimmed subject. The exact-array toEqual is expected to hold. If a platform yields a trailing
//   newline, trim before comparing: `expect(result.map(m => m.trim())).toEqual([...])`. (simple-git
//   trims .message for single-line commits, so this is a fallback, not the expected path.)

// GOTCHA — the count===0 case short-circuits BEFORE validateRepositoryPath (the guard is the function's
//   first line). So it returns [] even though the beforeEach repo exists — that's fine; the repo is
//   just unused for that case. (Under a maxEntries regression, count===0 STILL passes because it never
//   reaches git.log — but cases 1 & 2 catch the regression. That's by design.)

// GOTCHA — use `await` for all simple-git calls (init/addConfig/add/commit) and for
//   getRecentCommitMessages (it's async). Vitest supports async beforeEach/it natively.

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check (the test block may need
//   minor formatting). typecheck is unaffected (this is a test-file; integration tests are in the
//   test tsconfig, not tsconfig.build.json).

// GOTCHA — do NOT run the full `npm run test:run` as the gate. Gate on the new integration file green
//   + lint + format. (Running it requires git installed in the env — standard on dev/CI machines.)
```

---

## Implementation Blueprint

### Data models and structure
None — a single test file. No types/classes/source. The "structure" is the shared seeded-repo setup +
3 assertion cases.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE tests/integration/git-mcp-log.test.ts
  - IMPORTS (NO vi.mock): vitest primitives; simpleGit from 'simple-git'; mkdtempSync/writeFileSync/rmSync
        from 'node:fs'; tmpdir from 'node:os'; join from 'node:path'; getRecentCommitMessages from
        '../../src/tools/git-mcp.js'.
  - SHARED SETUP: `let dir: string;` + the MSGS array (5 chronological messages). beforeEach: mkdtempSync
        → simpleGit(dir).init() → addConfig user.email + user.name → loop 5× (writeFileSync(fileN) →
        add('.') → commit(MSGS[i])). afterEach: rmSync(dir, { recursive: true, force: true }).
  - 3 CASES (per "Technical requirements"): count<total (3→newest 3), count===total (5→all, newest-first),
        count===0 (→[]). Use exact-array toEqual against the newest-first expected arrays.
  - NAMING: it('returns the N newest commit messages, newest-first (count < total: 3 of 5)'), etc.
  - PLACEMENT: tests/integration/git-mcp-log.test.ts.
  - DO NOT: vi.mock anything; mock validateRepositoryPath; use tests/tmp/; reverse the expected order;
        or add a separate "doesNotThrow" assertion (the await rejecting IS the failure signal).
  - EXPECTED: all 3 cases pass against S1's fixed source (maxCount). If a case throws
        `fatal: ambiguous argument 'maxCount=…'`, that's a real simple-git problem to investigate (maxCount
        IS valid — re-check the simple-git version); if it throws `maxEntries`, S1's fix isn't in place.

Task 2: VERIFY
  - RUN: npx vitest run tests/integration/git-mcp-log.test.ts → ALL 3 GREEN.
  - RUN: npm run lint && npm run format:check → clean (run `npm run fix` if format complains).
  - (OPTIONAL regression proof) Temporarily revert git-mcp.ts to { maxEntries } → re-run → cases 1 & 2
        FAIL with the git fatal error → revert back. (This confirms the test's regression-catching
        value; do NOT commit the revert.)
  - EXPECTED: 3 green + clean. If the beforeEach fails on `git init`/`commit`, confirm git is installed
        and the addConfig identity calls landed. If a message-order assertion fails, confirm newest-first
        ordering (commit 5 is newest, not commit 1).
```

### Implementation Patterns & Key Details

```ts
// ---- the shared seeded-repo setup (hermetic; real simple-git) ----
import { simpleGit } from 'simple-git';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getRecentCommitMessages } from '../../src/tools/git-mcp.js';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

let dir: string;
const MSGS = ['commit 1', 'fix: commit 2', 'docs: commit 3', 'refactor: commit 4', 'feat: commit 5'];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'git-log-test-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  for (let i = 0; i < MSGS.length; i++) {
    writeFileSync(join(dir, `file${i}.txt`), `content ${i}\n`);
    await git.add('.');
    await git.commit(MSGS[i]);
  }
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// ---- the 3 cases (newest-first: 'feat: commit 5' is the newest) ----
describe('getRecentCommitMessages — real simple-git against a temp git repo', () => {
  it('returns the N newest commit messages, newest-first (count < total: 3 of 5)', async () => {
    const result = await getRecentCommitMessages(3, dir);
    expect(result).toEqual(['feat: commit 5', 'refactor: commit 4', 'docs: commit 3']);
  });
  it('returns all commits newest-first when count === total (5 of 5)', async () => {
    const result = await getRecentCommitMessages(5, dir);
    expect(result).toEqual(['feat: commit 5', 'refactor: commit 4', 'docs: commit 3', 'fix: commit 2', 'commit 1']);
  });
  it('returns [] for count === 0 (short-circuit, no git call)', async () => {
    const result = await getRecentCommitMessages(0, dir);
    expect(result).toEqual([]);
  });
});

// WHY no mock: if the source reverts to git.log({ maxEntries }), real git throws
// `fatal: ambiguous argument 'maxEntries=N'…` → getRecentCommitMessages(N) rejects → the await in
// cases 1 & 2 throws → the test FAILS. That's the regression net BUG-001's unit mock couldn't provide.
```

### Integration Points

```yaml
DEPENDS ON (must be LANDED before T2.S1 is correct):
  - P1.M1.T1.S1 (source fix, Complete): getRecentCommitMessages uses git.log({ maxCount }). T2.S1
        consumes this fixed source unchanged.

NO SOURCE/CONSUMER CHANGES: T2.S1 is test-only. getRecentCommitMessages + validateRepositoryPath +
  simple-git are all consumed unchanged (real). No vi.mock anywhere.

SIBLING SUBTASKS (do NOT do them here):
  - P1.M1.T1.S2 (unit-assertion fix, parallel): edits tests/unit/tools/git-mcp.test.ts — a DIFFERENT
        file (unit mock layer). Zero overlap with this integration file.
  - P1.M1.T2.S2 (end-to-end auto test, next): drives generateCommitMessage under default `auto` config
        with only the LLM mocked. T2.S1 is the narrower helper-level real-git test; T2.S2 is the whole
        auto-path test. Complementary, distinct files.

NO DOCS (the item's "DOCS: none"). The vitest glob picks up the new file automatically — no config change.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run lint                 # clean
npm run format:check         # clean (run `npm run fix` if it complains)
# typecheck: integration tests live under the test tsconfig (not tsconfig.build.json), so `npm run
# typecheck` (build) is unaffected. If the project typechecks tests separately, confirm clean.
# Expected: clean. The test is straightforward async vitest; no type complexity.
```

### Level 2: The integration test (the PRIMARY gate)

```bash
npx vitest run tests/integration/git-mcp-log.test.ts
# Expected: ALL 3 GREEN. If a case throws `fatal: ambiguous argument 'maxEntries=…'`, S1's source fix
#   isn't in place (confirm src/tools/git-mcp.ts uses maxCount). If it throws `maxCount=…`, that's a
#   real simple-git problem (maxCount IS valid — re-check the version). If a message-ORDER assertion
#   fails, confirm newest-first (commit 5 is newest). If beforeEach fails on commit, confirm the
#   addConfig identity calls + unique files per commit.
```

### Level 3: Regression-catching proof (OPTIONAL — confirms the test's value, do NOT commit the revert)

```bash
# Temporarily revert the source to the BUGGY option, re-run, confirm cases 1 & 2 FAIL, then revert back:
#   sed -i 's/maxCount: count/maxEntries: count/' src/tools/git-mcp.ts   # TEMPORARY
#   npx vitest run tests/integration/git-mcp-log.test.ts                  # → cases 1 & 2 FAIL (git fatal)
#   git checkout src/tools/git-mcp.ts                                     # RESTORE the fix
# Expected (during the temporary revert): cases 1 & 2 throw `fatal: ambiguous argument 'maxEntries=N'…`
#   and FAIL; case 3 (count===0) still passes (short-circuit). This PROVES the test catches the exact
#   BUG-001 regression. (Do NOT commit the revert — restore the maxCount fix before finishing.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No MCP/DB/HTTP surface beyond local git. Domain checks (record in commit message):
#   - Real simple-git (no mock) exercises the actual log() option — an invalid name throws+fails (regression net).
#   - validateRepositoryPath accepts the external tmpdir (verified) — no mock/workaround needed.
#   - Newest-first ordering proven (commit 5 is the newest; getRecentCommitMessages(3) returns the 3 newest).
#   - count===0 short-circuit proven (returns [] without touching git).
#   - Hermetic: own git identity (addConfig) + own temp repo + rmSync cleanup; no project git state touched.
#   - Test-only; no source/consumer/docs change. Directly implements TEST_RESULTS.md Recommendation #2.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/integration/git-mcp-log.test.ts` GREEN (3 cases).

### Feature Validation
- [ ] `tests/integration/git-mcp-log.test.ts` created; vitest glob picks it up.
- [ ] NO `vi.mock` of `'simple-git'` or `'../../src/tools/git-mcp.js'` (real lib under test).
- [ ] Shared `beforeEach` seeds a real 5-commit temp repo (init + addConfig identity + 5× write/add/commit).
- [ ] `count < total` (3) → 3 newest, newest-first; `count === total` (5) → all 5, newest-first; `count === 0` → `[]`.
- [ ] `validateRepositoryPath` NOT mocked (the external tmpdir passes it directly — verified).

### Code Quality Validation
- [ ] ONLY `tests/integration/git-mcp-log.test.ts` created (no source/config/docs/other-test changes).
- [ ] Hermetic git identity via `addConfig` (no reliance on global git config).
- [ ] `afterEach` rmSync cleans up the temp repo.
- [ ] Assertions prove BOTH correctness and newest-first ordering (exact-array `toEqual`).

### Documentation & Deployment
- [ ] No docs change (test-only; no user-facing surface — the item's "DOCS: none").
- [ ] Commit message notes: real-simple-git integration test for getRecentCommitMessages (BUG-001
      regression net per Recommendation #2); no mocks; 3 cases (count < total / === total / === 0);
      source fix = S1; unit-assertion fix = S2; end-to-end auto test = T2.S2.

---

## Anti-Patterns to Avoid

- ❌ Don't `vi.mock('simple-git')` or `vi.mock('../../src/tools/git-mcp.js')` — that's the BUG-001 mask
      this test exists to remove. The real lib must run.
- ❌ Don't mock `validateRepositoryPath` — it's verified NOT project-scoped (external tmpdir passes).
      Mocking it would re-mask the path-validation layer. The temp repo satisfies it directly.
- ❌ Don't use `tests/tmp/` or a project-internal path — the OS tmpdir works (validateRepositoryPath
      accepts any path with `.git`); an external temp repo keeps the test isolated from project git state.
- ❌ Don't reverse the expected order — git log is NEWEST-FIRST; commit 5 (last seeded) is the newest.
      `getRecentCommitMessages(3)` returns the 3 NEWEST, not the 3 oldest.
- ❌ Don't skip `addConfig('user.email'/'user.name')` — `git commit` requires an identity; CI may lack a
      global one. Set it hermetically after `init`.
- ❌ Don't seed commits without a changed file — each commit needs ≥1 staged change (write a unique
      `fileN.txt` per commit before `add('.')`).
- ❌ Don't add a separate `expect(...).not.toThrow()` assertion — if the real `git.log` throws (invalid
      option), the `await` rejects and the `it` fails automatically. The exact-array `toEqual` is enough.
- ❌ Don't edit `src/tools/git-mcp.ts` (S1 owns the source) or `tests/unit/tools/git-mcp.test.ts` (S2
      owns the unit assertion) — T2.S1 is the integration file ONLY.
- ❌ Don't commit the optional Task-2 regression-revert (it's a temporary proof; restore `maxCount`).
- ❌ Don't run the full `npm run test:run` as the gate — gate on the new integration file green + lint +
      format. (Requires git installed — standard on dev/CI.)

---

## Confidence Score

**10/10** — one-pass implementation success likelihood.

Rationale: This is a single new test file whose design is fully specified (verbatim imports + setup + 3
cases), consuming a source fix (S1) that is already Complete and verified in-repo (`maxCount`). The one
contract caution — that `validateRepositoryPath` might reject an external tmpdir — is verified FALSE
(reading the implementation: it's resolve→existsSync→`.git`→realpath, no project-scoping), so NO mock is
needed and the test stays end-to-end real. The temp-repo pattern is established in this codebase
(`mkdtempSync`/`rmSync`/`simpleGit(dir).init()` per external_deps.md + hack-config.test.ts). The
regression-catching property is provable (Task 2's optional revert confirms cases 1 & 2 fail under
`maxEntries`). The git-identity hermeticity gotcha is called out. The only environmental prerequisite is
`git` installed (standard). The vitest glob picks up the file automatically. No external/runtime
unknowns.