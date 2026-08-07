# Research — P1.M1.T1.S2 (correct the masked test assertion: maxEntries → maxCount)

S2 is the test-half of the BUG-001 fix. S1 (parallel) changes the source
`src/tools/git-mcp.ts:590` from `{ maxEntries: count }` to `{ maxCount: count }`. S2 corrects the
unit-test assertion that *validated the broken contract* — the reason CI stayed green despite the
critical bug. Tiny, surgical, test-only.

## 1. S1's fix (the contract S2 consumes — assume landed)

`src/tools/git-mcp.ts:590` (verified CURRENT state: still `maxEntries` — S1 not yet landed):
```ts
const logResult = await git.log({ maxEntries: count });   // CURRENT (broken)
```
After S1:
```ts
const logResult = await git.log({ maxCount: count });     // S1 lands this
```
After S1, `tests/unit/tools/git-mcp.test.ts:977` FAILS (it asserts the old `maxEntries`) — this is
the EXPECTED transient failure S2 owns. S2 corrects it so the suite goes green again AND the test
becomes a real regression defense.

## 2. The exact two edits (verified against the live test file)

`grep -n "maxEntries\|maxCount" tests/unit/tools/git-mcp.test.ts` returns EXACTLY two hits —
nothing else in the file references the option name:
- **Line 975** (inline comment): `// VERIFY — full messages (subject + body), newest-first; log called with maxEntries`
  → change `maxEntries` → `maxCount`.
- **Line 977** (the assertion): `expect(mockGitInstance.log).toHaveBeenCalledWith({ maxEntries: 2 });`
  → change `{ maxEntries: 2 }` → `{ maxCount: 2 }`.

Surrounding context (the `it` block under `describe('getRecentCommitMessages', …)`):
```ts
      // EXECUTE
      const result = await getRecentCommitMessages(2, './repo');

      // VERIFY — full messages (subject + body), newest-first; log called with maxEntries   ← L975 (edit)
      expect(result).toEqual(['feat: add thing\n\nbody', 'fix: other']);
      expect(mockGitInstance.log).toHaveBeenCalledWith({ maxEntries: 2 });                    ← L977 (edit)
```

## 3. WHY CI was green despite the critical bug (the masking mechanism)

`mockGitInstance.log` is a bare `vi.fn()` (set up earlier in the block via
`mockGitInstance.log.mockResolvedValue({ all: […], latest: {…} })`). A bare `vi.fn()` **ignores its
arguments** — it returns the canned commit data regardless of what option object is passed. So
`toHaveBeenCalledWith({ maxEntries: 2 })` PASSED while validating the WRONG option name: the test
never proved the source used a valid simple-git key. The git-commit.test.ts layer additionally mocks
`getRecentCommitMessages` to `vi.fn()` (`tests/unit/utils/git-commit.test.ts:28`), so neither layer
ever exercised real simple-git. **Net: the assertion encoded the bug, so the bug was invisible to CI.**

After S2, the assertion checks `{ maxCount: 2 }`. If the bug is ever reintroduced (source reverts to
`maxEntries`), this assertion FAILS — the test becomes a genuine first-line defense. (Deeper
real-simple-git coverage is P1.M1.T2.S1/S2 — out of scope here.)

## 4. What stays UNCHANGED (do not touch)

- The `mockGitInstance.log.mockResolvedValue({ all: […], latest: {…} })` setup — it's canned commit
  data; the mock ignoring args is fine (the assertion is what validates the option name).
- The `expect(result).toEqual(['feat: add thing\n\nbody', 'fix: other'])` assertion — verifies the
  return mapping (unchanged behavior).
- The `count === 0` short-circuit test and the "fewer than count commits" test (other `it` blocks) —
  unaffected.
- The production source (`git-mcp.ts`) — S1 owns it.
- `git-commit.test.ts` — unaffected (mocks `getRecentCommitMessages` itself).

## 5. S2's gate (the suite goes green)

After the 2 edits, `npx vitest run tests/unit/tools/git-mcp.test.ts` → all green (the :977 case now
asserts the correct `{ maxCount: 2 }`, matching S1's source). S2's gate is this suite green; S2 does
NOT need the empirical real-simple-git smoke (that's S1/T2's proof).

## 6. Scope boundaries

- S2 = the 2-token test edit ONLY (line 975 comment + line 977 assertion).
- S1 (parallel) = the source fix at `git-mcp.ts:590`.
- T2 (P1.M1.T2.S1/S2) = real-simple-git integration test + end-to-end `auto` generateCommitMessage test.
- No docs (test-only; no user-facing surface). No PRD entry (AGENTS.md Rule 5 corrective fix).

## 7. Validation

- `npx vitest run tests/unit/tools/git-mcp.test.ts` → green (S2's gate).
- `npm run lint && npm run format:check` → clean (a comment + an object-key rename won't trip prettier;
  run `npm run fix` only if it complains).
- typecheck is unaffected (test-file change; the test already typechecks).