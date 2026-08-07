# PRP — P1.M1.T1.S2: Fix the masked test assertion in `git-mcp.test.ts` (`maxEntries` → `maxCount`)

> Bugfix 001, **BUG-001 (CRITICAL)** — test-half of the fix. S1 (parallel) changes the source
> `src/tools/git-mcp.ts:590` from `{ maxEntries: count }` to `{ maxCount: count }`. **S2 corrects the
> unit-test assertion that validated the BROKEN contract** (`tests/unit/tools/git-mcp.test.ts:977`) —
> the exact reason CI stayed green despite the critical bug. Surgical, test-only, 2 tokens. The
> real-simple-git integration + end-to-end `auto` tests are **P1.M1.T2** (out of scope).

---

## Goal

**Feature Goal**: Correct the masked assertion at `tests/unit/tools/git-mcp.test.ts:977` from
`{ maxEntries: 2 }` to `{ maxCount: 2 }` (and its inline comment at line 975), so the unit test
validates the correct simple-git `LogOptions` contract. After S2, the test PASSES against S1's fixed
source AND would FAIL if the bug (`maxEntries`) is reintroduced — turning a CI-blind assertion into a
genuine first-line regression defense.

**Deliverable**: `tests/unit/tools/git-mcp.test.ts` — two token edits (line 975 comment + line 977
assertion). No other line in the file (or any file) changes.

**Success Definition**:
- `tests/unit/tools/git-mcp.test.ts:977` asserts `expect(mockGitInstance.log).toHaveBeenCalledWith({ maxCount: 2 })`.
- The inline comment at line 975 says `log called with maxCount`.
- `npx vitest run tests/unit/tools/git-mcp.test.ts` is GREEN (the :977 case now matches S1's source).
- No other assertion, mock setup, or test in the file is modified.
- `npm run lint && npm run format:check` clean.

---

## Why

- **Removes the CI blind spot.** The assertion encoded the bug: it asserted `maxEntries` against a
  bare `vi.fn()` mock that ignores its arguments, so the test passed while validating the WRONG option
  name. This is why BUG-001 (a critical, default-config-breaking bug) shipped with a green suite.
  Correcting the assertion makes the test assert the real `LogOptions` contract (`maxCount`), so the
  same bug would now fail the build.
- **Completes the BUG-001 fix's test half.** S1 fixes the source; without S2, S1's change makes the
  existing test FAIL (it asserts the old `maxEntries`). S2 restores green and locks in the correct
  contract. (Deeper real-simple-git coverage is T2.)
- **One-pass, zero-risk.** Two tokens (a comment word + an object-key name) in one test file. The mock
  setup, the return-value assertion, and every other test are untouched.
- **AGENTS.md Rule 5 (out-of-spec corrective fix).** A test-only correction to existing behavior; no
  PRD entry blocking.

---

## What

### User-visible behavior
None (test-only; no user/config/API surface).

### Technical requirements (exact contract)

**File:** `tests/unit/tools/git-mcp.test.ts`, in the `describe('getRecentCommitMessages', …)` block.

**Edit 1 — line 975 (inline comment):**
```ts
// BEFORE:
// VERIFY — full messages (subject + body), newest-first; log called with maxEntries
// AFTER:
// VERIFY — full messages (subject + body), newest-first; log called with maxCount
```

**Edit 2 — line 977 (the assertion):**
```ts
// BEFORE:
expect(mockGitInstance.log).toHaveBeenCalledWith({ maxEntries: 2 });
// AFTER:
expect(mockGitInstance.log).toHaveBeenCalledWith({ maxCount: 2 });
```

**Do NOT change** anything else: the `mockGitInstance.log.mockResolvedValue({ all: […], latest: {…} })`
setup, the `expect(result).toEqual(['feat: add thing\n\nbody', 'fix: other'])` return-value assertion,
the `count === 0` short-circuit test, the "fewer than count commits" test, the production source
(`git-mcp.ts` — S1 owns it), or `git-commit.test.ts` (it mocks `getRecentCommitMessages` itself).

### Success Criteria
- [ ] Line 977 asserts `{ maxCount: 2 }` (not `{ maxEntries: 2 }`).
- [ ] Line 975 comment says `maxCount` (not `maxEntries`).
- [ ] `npx vitest run tests/unit/tools/git-mcp.test.ts` green (the :977 case passes against S1's source).
- [ ] No other line/file modified.
- [ ] `npm run lint && npm run format:check` clean.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — the exact two lines (verified by grep + sed against the live file), the
verbatim before/after, the masking-mechanism explanation, the S1 dependency, the scope boundary
(test-only; integration tests are T2), and the executable validation command are all below.

### Documentation & References

```yaml
# MUST READ — the bug report + the masking root cause + the S1/S2/T2 split
- docfile: plan/012_7dd502f7feb9/bugfix/001_662720d16c77/architecture/system_context.md
  why: Confirms the masked assertion (git-mcp.test.ts:977 asserts maxEntries against an arg-ignoring
        vi.fn) is WHY CI was green. Pins the exact line + the S2 ownership.
  critical: S2 is the TEST fix ONLY. The source fix (git-mcp.ts:590) is S1. The integration tests are T2.

# MUST READ — S1's contract (the source change S2's assertion must match) + the masking mechanism
- docfile: plan/012_7dd502f7feb9/bugfix/001_662720d16c77/P1M1T1S1/PRP.md
  section: "What" → "The change" and "Known Gotchas" → the "git-mcp.test.ts:977 WILL fail after S1" note
  why: S1 changes the source to { maxCount: count }; S2's assertion must expect { maxCount: 2 } to match.
        S1's PRP explicitly flags that :977 fails after S1 and is owned by S2.
- docfile: plan/012_7dd502f7feb9/bugfix/001_662720d16c77/P1M1T1S2/research/test-assertion-fix.md
  section: "2. The exact two edits" and "3. WHY CI was green despite the critical bug"
  why: Verbatim before/after (verified against the live file) + the masking explanation.

# PATTERN FILE — the only file edited
- file: tests/unit/tools/git-mcp.test.ts
  why: Line 975 (comment) + line 977 (assertion) — the ONLY two maxEntries references in the file
        (grep-confirmed). Both sit in the describe('getRecentCommitMessages') block.
  pattern: "expect(mockGitInstance.log).toHaveBeenCalledWith({ maxEntries: 2 })  →  { maxCount: 2 }"
  gotcha: Do NOT touch the mockGitInstance.log.mockResolvedValue(...) setup (canned data; the mock
        ignoring args is fine — the assertion is what validates the option name). Do NOT touch the
        expect(result).toEqual(...) return-value assertion or any other it() block.

# VERIFIED FACTS
- fact: "grep -n 'maxEntries|maxCount' tests/unit/tools/git-mcp.test.ts → exactly two hits: L975 (comment), L977 (assertion). Nothing else in the file references the option name."
- fact: "S1 changes src/tools/git-mcp.ts:590 to { maxCount: count }. After S1, the :977 assertion (maxEntries) FAILS; S2 corrects it to maxCount → green."
- fact: "mockGitInstance.log is a bare vi.fn() that ignores arguments (returns canned commit data) — that's why the old assertion passed while validating the wrong key. The corrected assertion ({ maxCount: 2 }) makes the test a real regression defense."
- fact: "node_modules/simple-git/.../log.d.ts:17 defines maxCount?: number (no maxEntries) — the corrected assertion matches the real contract."
```

### Current Codebase tree (relevant slice)

```bash
tests/unit/tools/git-mcp.test.ts        # EDIT — line 975 comment + line 977 assertion (2 tokens)
src/tools/git-mcp.ts                    # READ-ONLY in S2 (S1 owns the source fix at :590)
tests/unit/utils/git-commit.test.ts     # UNCHANGED (mocks getRecentCommitMessages — unaffected)
```

### Desired Codebase tree with files to be added/edited

```bash
tests/unit/tools/git-mcp.test.ts        # MODIFIED (2 tokens: comment word + object key)
# No other files. No source edits (S1). No docs (test-only). No new files.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — S2 is the TEST fix ONLY. Do NOT edit src/tools/git-mcp.ts (S1 owns it) or add
//   integration tests (T2 owns P1.M1.T2.S1/S2). The orchestrator split source-fix / test-fix /
//   integration-tests deliberately.

// CRITICAL — change EXACTLY two tokens. grep confirms only L975 (comment) + L977 (assertion)
//   reference maxEntries in the file. Do not "clean up" any other line.

// GOTCHA — do NOT touch the mockGitInstance.log.mockResolvedValue({ all:[...], latest:{...} }) setup.
//   The mock ignoring its arguments is intentional/harmless — the toHaveBeenCalledWith assertion is
//   what validates the option name. The canned commit data is still valid for the return-value test.

// GOTCHA — after the edit, the :977 assertion validates the REAL simple-git contract ({ maxCount }).
//   This is the regression-defense value: if the source ever reverts to maxEntries, this test fails.
//   (Real-simple-git coverage that would ALSO catch it is T2 — additive, not a replacement.)

// GOTCHA — S2's gate is the unit suite GREEN (the :977 case now matches S1's source). S2 does NOT
//   need the empirical real-simple-git smoke (that's S1/T2's proof) — the unit test with the corrected
//   assertion is S2's deliverable.

// GOTCHA — prettier is ERROR-enforced, but a comment-word + object-key rename inside an existing call
//   won't trip it. Run `npm run fix` only if format:check complains.

// GOTCHA — typecheck is unaffected (this is a test-file change; the test already typechecks — the
//   object literal { maxCount: 2 } is structurally fine for toHaveBeenCalledWith's matcher).
```

---

## Implementation Blueprint

### Data models and structure
None — a 2-token edit (a comment word + an object-key name) in one test file.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT tests/unit/tools/git-mcp.test.ts — correct the assertion + comment
  - LINE 975 (comment): `log called with maxEntries` → `log called with maxCount`.
  - LINE 977 (assertion): `{ maxEntries: 2 }` → `{ maxCount: 2 }`.
  - DO NOT change the mockGitInstance.log setup, the expect(result).toEqual(...) assertion, any other
        it() block, the production source, or any other file.
  - EXPECTED: the :977 case now asserts the correct simple-git contract; after S1 lands, the suite is green.

Task 2: VERIFY
  - RUN: npx vitest run tests/unit/tools/git-mcp.test.ts   → all green (incl. the corrected :977 case).
        (If :977 still fails, S1's source change hasn't landed yet — confirm S1 is in place; the
        assertion correction assumes the source now calls { maxCount }.)
  - RUN: npm run lint && npm run format:check   → clean (run `npm run fix` only if it complains).
  - EXPECTED: green + clean. No other suite is affected by this test-only change.
```

### Implementation Patterns & Key Details

```ts
// ---- tests/unit/tools/git-mcp.test.ts: the 2-token diff ----
// BEFORE (L975 + L977):
      // VERIFY — full messages (subject + body), newest-first; log called with maxEntries
      expect(result).toEqual(['feat: add thing\n\nbody', 'fix: other']);
      expect(mockGitInstance.log).toHaveBeenCalledWith({ maxEntries: 2 });
// AFTER:
      // VERIFY — full messages (subject + body), newest-first; log called with maxCount
      expect(result).toEqual(['feat: add thing\n\nbody', 'fix: other']);
      expect(mockGitInstance.log).toHaveBeenCalledWith({ maxCount: 2 });

// WHY this matters (the masking that S2 removes): mockGitInstance.log is a bare vi.fn() that IGNORES
// its arguments (returns canned commit data). So the old assertion ({ maxEntries }) passed while
// validating the WRONG option name — CI was green despite the critical bug. The corrected assertion
// ({ maxCount }) makes the test a real regression defense: a source revert to maxEntries now FAILS it.
```

### Integration Points

```yaml
SIBLING SUBTASKS (do NOT do them here):
  - P1.M1.T1.S1 (source fix): src/tools/git-mcp.ts:590 { maxEntries: count } → { maxCount: count }.
        S2's corrected assertion matches S1's source.
  - P1.M1.T2.S1 (integration test): real simple-git against a temp git repo — catches an invalid
        option name at the integration layer (additive regression defense, beyond S2's unit assertion).
  - P1.M1.T2.S2 (end-to-end test): generateCommitMessage under default `auto` config (LLM mocked only)
        asserts it doesn't throw on a >1-commit repo.

NO SOURCE/CONSUMER CHANGES: S2 is test-only. The production fix (S1) is what restores the `auto`
  commit-style; S2 makes the unit test reflect + defend the correct contract.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run lint                 # clean (comment word + object-key rename inside an existing call)
npm run format:check         # clean (run `npm run fix` only if it complains)
# typecheck is unaffected (test-file change). Expected: clean.
```

### Level 2: Unit Tests (S2's gate)

```bash
npx vitest run tests/unit/tools/git-mcp.test.ts
# Expected: ALL green, including the corrected :977 case (now asserts { maxCount: 2 }, matching S1's
# source). If :977 fails with "expected { maxEntries: 2 } … received { maxCount: 2 }", the edit didn't
# land; if it fails the other way, S1's source change isn't in place yet. Do NOT run the full suite as
# the gate — this test-only change can't affect other suites.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S2 — the real-simple-git integration test is P1.M1.T2.S1 (out of scope). S2's unit
# assertion (with the corrected option name) is its deliverable; the integration layer is additive.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A — a 2-token test edit. Domain checks (record in commit message):
#   - The assertion now validates the real simple-git LogOptions contract ({ maxCount }), matching
#     node_modules/simple-git/.../log.d.ts:17 (maxCount?: number; no maxEntries).
#   - Removing the mask: the test would now FAIL if the source reverts to maxEntries (real regression
#     defense, vs. the old arg-ignoring-vi.fn pass-through).
#   - Test-only; no source/consumer/docs change. AGENTS.md Rule 5 corrective fix.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/tools/git-mcp.test.ts` green (corrected :977 case passes).

### Feature Validation
- [ ] Line 977 asserts `{ maxCount: 2 }`.
- [ ] Line 975 comment says `maxCount`.
- [ ] The mockGitInstance.log setup, the `expect(result).toEqual(...)`, and every other test UNCHANGED.

### Code Quality Validation
- [ ] Only `tests/unit/tools/git-mcp.test.ts` modified (2 tokens).
- [ ] No source file (`git-mcp.ts`) or other test file touched.
- [ ] No integration tests added (T2 owns those).

### Documentation & Deployment
- [ ] No docs (test-only; no user-facing surface).
- [ ] Commit message notes: corrected the masked assertion (maxEntries → maxCount) so the unit test
      validates the real simple-git contract; removes the CI blind spot; source fix = S1; integration
      tests = T2.

---

## Anti-Patterns to Avoid

- ❌ Don't edit `src/tools/git-mcp.ts` — the source fix is S1. S2 is test-only.
- ❌ Don't add integration tests (real simple-git / end-to-end `auto`) — that's P1.M1.T2.S1/S2.
- ❌ Don't touch the `mockGitInstance.log.mockResolvedValue(...)` setup — the mock ignoring args is
      fine; the `toHaveBeenCalledWith` assertion is what validates the option name.
- ❌ Don't change more than the 2 tokens (L975 comment + L977 assertion) — grep confirms those are the
      only `maxEntries` references in the file.
- ❌ Don't run the full test suite as S2's gate — a test-only change in one file can't affect other
      suites; gate on `git-mcp.test.ts` green.
- ❌ Don't treat a lingering :977 failure as an S2 bug if S1 hasn't landed — the corrected assertion
      assumes S1's source now calls `{ maxCount }`. Confirm S1 is in place first.
- ❌ Don't add a PRD entry as a blocker — this is an AGENTS.md Rule 5 out-of-spec corrective fix
      (test correction to existing behavior).

---

## Confidence Score

**10/10** — one-pass implementation success likelihood.

Rationale: This is a two-token edit (a comment word + an object-key name) on two verified lines of one
test file (grep-confirmed: L975 + L977 are the only `maxEntries` references). The before/after is
verbatim; the masking mechanism (arg-ignoring `vi.fn`) is explained; the S1 dependency (source now
calls `{ maxCount }`) is documented; the scope boundary (test-only; source = S1; integration = T2) is
crisp; and the gate (`npx vitest run tests/unit/tools/git-mcp.test.ts` green) is concrete. There are
no external/runtime unknowns — the only prerequisite is that S1's source change is in place, which is
explicitly flagged.